#!/usr/bin/env node
/**
 * Superloja Messenger Chatbot v1.0
 * Facebook/Instagram DM Listener + Auto-Responder
 * Location: C:\\Users\\fox/webhook-server/messenger-chatbot.js
 * 
 * Features:
 * - Listen to incoming messages (Facebook Messenger + Instagram DM)
 * - AI classification (purchase intent, question, complaint)
 * - Auto-respond with contextual replies
 * - Log conversations to CRM/DB
 * - Escalate to human if needed
 */

require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const APP_PORT = process.env.CHATBOT_PORT || 3335;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'superloja_webhook_secret_2026';
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const API_BASE = 'https://graph.facebook.com/v21.0';

const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const deliveryZones = require('./delivery-zones.js');
const textGuard = require('./text-guard.js');   // guarda anti-alucinação (nº, preços, políticas)
const perfilClientes = require('./perfil-clientes.js');   // o bot lembra-se de quem volta (só factos que o cliente disse)
const productPhotos = require('./product-photos.js');
const catalogPdf = require('./catalog-pdf.js');
const CONVERSATIONS_LOG = DATA_DIR + '/crm/conversations.json';
const LEADS_LOG = DATA_DIR + '/crm/leads.json';
const TRAINING_LOG = DATA_DIR + '/crm/chatbot-training.json';   // respostas humanas do dono (ouro p/ aprender)
const KNOWLEDGE_FILE = DATA_DIR + '/crm/chatbot-knowledge.json'; // FAQ destilada que alimenta o bot
const CONSULTAS_FILE = DATA_DIR + '/crm/perguntas-hermes.json';  // dúvidas que o bot faz ao Hermes
const LAST_ACTIVITY_LOG = DATA_DIR + '/crm/last-user-activity.json'; // inclui mensagens suprimidas pelo disjuntor

// Memória curta dos textos que o BOT enviou — para distinguir echo-do-bot de resposta HUMANA do dono
const recentBotSends = new Map();
function rememberBotSend(text) {
  recentBotSends.set((text || '').trim(), Date.now());
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, t] of recentBotSends) if (t < cutoff) recentBotSends.delete(k);
}
function wasSentByBot(text) { return recentBotSends.has((text || '').trim()); }

// Deduplicação por message-id (mid): o Meta reenvia o mesmo webhook (retries/subscrição
// dupla) → sem isto o bot responde 2× à mesma mensagem.
const processedMids = new Map();
function alreadyProcessed(mid) {
  if (!mid) return false;
  const now = Date.now();
  for (const [k, t] of processedMids) if (now - t > 10 * 60 * 1000) processedMids.delete(k);
  if (processedMids.has(mid)) return true;
  processedMids.set(mid, now);
  return false;
}

// ─── Filtro de RAJADA (13-Ago) ───────────────────────────────────────────────
// Caso real (10:15): a MESMA frase chegou 8x em 25 segundos com mids DIFERENTES
// (o dedup por mid não a apanha) — é o botão de pergunta pronta do Messenger
// tocado em rajada, ou o bug dos ice-breakers da Meta. O disjuntor viu "mesma
// mensagem 3x", pausou o bot 1h... e era um CLIENTE REAL, que perguntou
// "Quanto costa?" a seguir e levou silêncio.
// Regra: mesmo remetente + mesmo texto em <60s = máquina/botão → processa-se a
// PRIMEIRA e ignoram-se as cópias, sem alimentar o disjuntor. Repetição com
// mais de 60s de intervalo continua a ser humana (frustração/loop) e o
// disjuntor continua a tratá-la — a separação é o tempo.
const _rajada = new Map();   // senderId -> { texto, quando }
function ehRajada(senderId, texto) {
  const t = String(texto || '').trim();
  if (t.length < 3) return false;   // "sim"/"ok" repetidos não contam
  const now = Date.now();
  if (_rajada.size > 500) { for (const [k, v] of _rajada) if (now - v.quando > 120000) _rajada.delete(k); }
  const ant = _rajada.get(String(senderId));
  _rajada.set(String(senderId), { texto: t, quando: now });
  return !!(ant && ant.texto === t && now - ant.quando < 60000);
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString();
  const logFile = DATA_DIR + '/logs/chatbot.log';
  const entry = `[${ts}] [${level}] ${msg}\n`;

  if (!fs.existsSync(DATA_DIR + '/logs')) fs.mkdirSync(DATA_DIR + '/logs', { recursive: true });
  fs.appendFileSync(logFile, entry);
  // NÃO usar console.log: o supervisor redirige stdout para o MESMO chatbot.log
  // → cada linha ficava duplicada. O appendFileSync acima é a única escrita.
}

function ensureDirs() {
  [DATA_DIR, DATA_DIR + '/crm', DATA_DIR + '/logs'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function loadJSON(filepath) {
  try {
    return fs.existsSync(filepath) ? JSON.parse(fs.readFileSync(filepath, 'utf8')) : [];
  } catch (e) {
    log('WARN', `Failed to load ${filepath}: ${e.message}`);
    return [];
  }
}

function saveJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// "Sem retorno" só é verdade se não entrou mensagem nenhuma. Conversations.json
// regista turnos respondidos, mas o disjuntor pode suprimir uma mensagem antes de
// ela virar conversa. Este mapa persiste TODA atividade de entrada primeiro.
function registarAtividadeCliente(senderId, platform) {
  try {
    let actividade = loadJSON(LAST_ACTIVITY_LOG);
    if (!actividade || Array.isArray(actividade) || typeof actividade !== 'object') actividade = {};
    actividade[String(senderId)] = { at: new Date().toISOString(), platform };
    const ids = Object.keys(actividade);
    if (ids.length > 1000) {
      ids.sort((a, b) => Date.parse(actividade[b].at || 0) - Date.parse(actividade[a].at || 0))
        .slice(1000).forEach(id => delete actividade[id]);
    }
    saveJSON(LAST_ACTIVITY_LOG, actividade);
  } catch (e) {
    log('WARN', '[ATIVIDADE] não consegui registar entrada: ' + e.message);
  }
}

// ─── Admin Carlos + encomendas ────────────────────────────────────────────────
const CARLOS_PHONE = process.env.DONO_PHONE || '244939729902';                 // E.164 sem + (destinatário por omissão)
const CARLOS_JID = CARLOS_PHONE + '@s.whatsapp.net';
const ORDERS_LOG = DATA_DIR + '/crm/orders.json';
const NOTIFICADOS_FILE = DATA_DIR + '/crm/notificacoes.json';
const WISHLIST_LOG = DATA_DIR + '/crm/wishlist.json'; // produtos pedidos que NÃO temos (procura/stock)
const _wishNotified = new Map();                       // anti-spam de notificação por produto
const HERMES_BRIDGE = { host: '127.0.0.1', port: 3010 }; // bridge WhatsApp do HERMES

// ⚠️ ESTES NÚMEROS RECEBEM DADOS DE CLIENTES (nome, morada, telefone, o que
// comprou). Um número errado aqui é uma fuga de dados de terceiros — por isso o
// dashboard valida o formato e a lista fica registada em ficheiro.
// NÃO dá acesso de administração: o portão do Hermes vive no bridge (ALLOWED_USERS).
// Editável em :3333 → Atendimento → "Quem recebe as notificações".
let _notifCache = { at: 0, lista: null };
function numerosNotificados() {
  if (_notifCache.lista && Date.now() - _notifCache.at < 30000) return _notifCache.lista;
  let lista = [];
  try {
    const db = JSON.parse(fs.readFileSync(NOTIFICADOS_FILE, 'utf8'));
    lista = (db.numeros || []).map(n => String(n).replace(/\D/g, '')).filter(n => n.length >= 9 && n.length <= 15);
  } catch {}
  // sem ficheiro (ou ficheiro vazio/corrompido) volta ao número do dono: nunca
  // se pode ficar sem destinatário nenhum e perder uma encomenda em silêncio
  if (!lista.length) lista = [CARLOS_PHONE];
  _notifCache = { at: Date.now(), lista: [...new Set(lista)] };
  return _notifCache.lista;
}

function _enviarBridge(chatId, text, attempt) {
  attempt = attempt || 1;
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ chatId, message: text }), 'utf8');
    const req = require('http').request(
      { host: HERMES_BRIDGE.host, port: HERMES_BRIDGE.port, path: '/send', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.success) return resolve(true); } catch {}
        retry();
      }); });
    req.on('error', retry);
    req.setTimeout(12000, () => { req.destroy(); retry(); });
    req.write(body); req.end();
    function retry() {
      if (attempt < 2) { setTimeout(() => _enviarBridge(chatId, text, attempt + 1).then(resolve), 3000); }
      else resolve(false);
    }
  });
}

// Notifica TODOS os números configurados. Devolve true se ao menos um recebeu —
// o que interessa é a informação chegar a alguém, não a toda a gente.
async function notifyCarlos(text) {
  const nums = numerosNotificados();
  const res = await Promise.all(nums.map(n => _enviarBridge(n + '@s.whatsapp.net', text)));
  const ok = res.filter(Boolean).length;
  if (ok) log('INFO', '[AVISO] entregue a ' + ok + '/' + nums.length + ' número(s)');
  else log('WARN', '[AVISO] bridge Hermes indisponível — nenhum dos ' + nums.length + ' número(s) recebeu');
  return ok > 0;
}

// ─── Presença humana no WhatsApp (13-Ago) ────────────────────────────────────
// O Messenger já marcava "visto" e "a escrever…" (sendAction); o WhatsApp
// respondia instantâneo — resposta no mesmo segundo denuncia robô, e o
// anti-spam do WhatsApp sinaliza contas "perfeitas demais" (zero typing,
// presença sempre igual). O bridge tem POST /typing DE FÁBRICA (upstream, não
// é patch nosso): mostra "a escrever…" e espera-se um tempo proporcional ao
// tamanho da resposta antes de enviar. Só nas conversas com CLIENTES — as
// notificações ao dono (_enviarBridge) e os crons não levam atraso artificial.
function _avisarAEscrever(chatId) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ chatId }), 'utf8');
    const req = require('http').request(
      { host: HERMES_BRIDGE.host, port: HERMES_BRIDGE.port, path: '/typing', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { res.on('data', () => {}); res.on('end', () => resolve(true)); });
    req.on('error', () => resolve(false));   // best-effort: sem typing ainda se envia
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  });
}
// ~18ms por caractere (ritmo de quem escreve depressa no telemóvel), entre
// 0,9s e 4s. O tecto é BAIXO de propósito: o disjuntor relê a pausa depois
// desta espera, e cada segundo aqui é um segundo em que o dono pode ter
// assumido a conversa — 4s de janela é aceitável, 10s não era.
function _tempoDeEscrita(texto) {
  return Math.max(900, Math.min(4000, 900 + String(texto || '').length * 18));
}

// Envia texto a um cliente do WhatsApp pelo bridge do Hermes (mesma via do notifyCarlos).
// Devolve {ok} — uma falha aqui significa que o cliente NAO recebeu nada.
async function sendWhatsApp(chatId, text) {
  // "a escrever…" + pausa humana, e RELER o disjuntor no fim: se o dono assumiu
  // a conversa durante estes segundos, aborta — não se fala por cima dele.
  await _avisarAEscrever(chatId);
  await new Promise(r => setTimeout(r, _tempoDeEscrita(text)));
  try {
    if (_dj(String(chatId)).pausadoAte > Date.now()) {
      log('WARN', `[HANDOFF] resposta abortada — assumiste a conversa enquanto o bot "escrevia" (${chatId})`);
      return { ok: false, error: 'pausado-durante-escrita' };
    }
  } catch (_) {}
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ chatId, message: text }), 'utf8');
    const req = require('http').request(
      { host: HERMES_BRIDGE.host, port: HERMES_BRIDGE.port, path: '/send', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => {
        let j = {}; try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch {}
        if (j.success) return resolve({ ok: true });
        log('ERROR', `WhatsApp send FALHOU (cliente não recebeu): ${j.error || 'HTTP ' + res.statusCode}`);
        resolve({ ok: false, error: j.error || 'HTTP ' + res.statusCode });
      }); });
    req.on('error', e => { log('ERROR', `WhatsApp bridge inacessível: ${e.message}`); resolve({ ok: false, error: e.message }); });
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
}

// ─── Fotos no WhatsApp: anexo real, não link ──────────────────────────────────
// O /send-media do bridge só aceita ficheiro LOCAL: descarrega-se a imagem do
// produto para um cache e envia-se o caminho. Cache por hash do URL (reutiliza
// entre clientes; os URLs do catálogo são estáveis).
const WA_MEDIA_DIR = DATA_DIR + '/tmp/wa-media';

function downloadToFile(url, destPath, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error('demasiados redirects'));
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadToFile(res.headers.location, destPath, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 10 * 1024 * 1024) { req.destroy(); return reject(new Error('imagem >10MB')); } chunks.push(c); });
      res.on('end', () => {
        try { fs.writeFileSync(destPath, Buffer.concat(chunks)); resolve(destPath); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout no download')); });
  });
}

async function sendWhatsAppImage(chatId, imageUrl, caption) {
  try {
    // caminho local (BD de fotos reais / cache da internet): envia directo, sem download
    if (/^[A-Za-z]:[\\/]/.test(imageUrl) && fs.existsSync(imageUrl)) {
      const body0 = Buffer.from(JSON.stringify({ chatId, filePath: imageUrl, mediaType: 'image', caption: caption || undefined }), 'utf8');
      return await new Promise((resolve) => {
        const rq = require('http').request(
          { host: HERMES_BRIDGE.host, port: HERMES_BRIDGE.port, path: '/send-media', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body0.length } },
          res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => {
            let j = {}; try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch {}
            // messageId: é o que permite saber A QUE FOTO o cliente respondeu
            resolve(j.success ? { ok: true, messageId: j.messageId } : { ok: false, error: j.error || 'HTTP ' + res.statusCode });
          }); });
        rq.on('error', e => resolve({ ok: false, error: e.message }));
        rq.setTimeout(90000, () => { rq.destroy(); resolve({ ok: false, error: 'timeout no envio' }); });
        rq.write(body0); rq.end();
      });
    }
    if (!fs.existsSync(WA_MEDIA_DIR)) fs.mkdirSync(WA_MEDIA_DIR, { recursive: true });
    // limpeza oportunista: ficheiros com mais de 7 dias
    try {
      const agora = Date.now();
      for (const f of fs.readdirSync(WA_MEDIA_DIR)) {
        const p = WA_MEDIA_DIR + '/' + f;
        if (agora - fs.statSync(p).mtimeMs > 7 * 86400000) fs.unlinkSync(p);
      }
    } catch {}

    const hash = require('crypto').createHash('sha1').update(imageUrl).digest('hex').slice(0, 16);
    const extM = imageUrl.match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
    const ext = extM ? extM[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
    const filePath = WA_MEDIA_DIR + '/' + hash + '.' + ext;

    if (!fs.existsSync(filePath)) await downloadToFile(imageUrl, filePath);

    const body = Buffer.from(JSON.stringify({ chatId, filePath, mediaType: 'image', caption: caption || undefined }), 'utf8');
    return await new Promise((resolve) => {
      const req = require('http').request(
        { host: HERMES_BRIDGE.host, port: HERMES_BRIDGE.port, path: '/send-media', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
        res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => {
          let j = {}; try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch {}
          if (j.success) return resolve({ ok: true });
          resolve({ ok: false, error: j.error || 'HTTP ' + res.statusCode });
        }); });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.setTimeout(90000, () => { req.destroy(); resolve({ ok: false, error: 'timeout no envio' }); });
      req.write(body); req.end();
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Envia um DOCUMENTO local (PDF do catálogo) ao cliente do WhatsApp via bridge.
// ─── Voz responde a voz (13-Ago) ─────────────────────────────────────────────
// Em Luanda os clientes FALAM: o Nilton mandou 12 notas de voz seguidas. O bot
// ouvia (faster-whisper) mas respondia sempre em texto. Agora, quando a mensagem
// do cliente foi uma nota de voz, a resposta vai TAMBÉM em voz — o texto segue
// sempre primeiro (preços por escrito ficam no histórico do cliente).
// Edge TTS (pt-PT, voz Raquel) no MESMO venv do whisper; o bridge converte para
// ogg/opus e entrega como nota de voz nativa (ptt) — tudo de fábrica, sem patch.
// A voz sintetiza o texto JÁ GUARDADO (botResponse pós-formatForPlatform): a
// lei 4 aplica-se ao que se ouve tanto quanto ao que se lê.
const TTS_VOZ = process.env.TTS_VOZ || 'pt-PT-RaquelNeural';
const TTS_MAX_CHARS = 450;   // ~30s de voz; acima disto só texto

function _textoParaVoz(t) {
  return String(t || '')
    .replace(/https?:\/\/\S+/g, ' no nosso site ')
    .replace(/wa\.me\/\S+/g, ' no nosso WhatsApp ')
    .replace(/(\d[\d.]*)\s*Kz\b/gi, '$1 kwanzas')
    .replace(/[*_~`]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function sintetizarVoz(texto) {
  return new Promise((resolve) => {
    const limpo = _textoParaVoz(texto);
    if (!limpo || limpo.length > TTS_MAX_CHARS) return resolve(null);
    const dir = DATA_DIR + '/tmp/wa-media';
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const base = dir + '/voz_' + Date.now().toString(36);
    // o texto vai por FICHEIRO (UTF-8): na linha de comandos os acentos
    // corrompem-se (cp1252) e há o tecto dos 32k chars do Windows
    try { fs.writeFileSync(base + '.txt', limpo, 'utf8'); } catch { return resolve(null); }
    // tts-superloja.py: Edge (pt-PT, melhor voz) com queda automática para o
    // Kokoro LOCAL (pt-BR, sem rede) — o Edge é um serviço não-oficial e pode
    // morrer sem aviso; com isto nenhum cliente fica sem voz por causa disso.
    const { execFile } = require('child_process');
    execFile(STT_PY, [__dirname + '/tts-superloja.py', '--file', base + '.txt', '--out', base + '.mp3'],
      { timeout: 60000 }, (err, stdout) => {
        try { fs.unlinkSync(base + '.txt'); } catch (_) {}
        if (err || !fs.existsSync(base + '.mp3')) return resolve(null);
        // quando o motor local assume é sinal de que o Edge caiu — fica no log
        if (/motor=kokoro/.test(String(stdout || ''))) log('WARN', '[VOZ] Edge TTS falhou — o Kokoro local assumiu (voz pt-BR)');
        resolve(base + '.mp3');
      });
  });
}

function sendWhatsAppAudio(chatId, filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve({ ok: false, error: 'ficheiro não existe' });
    const body = Buffer.from(JSON.stringify({ chatId, filePath, mediaType: 'audio' }), 'utf8');
    const req = require('http').request(
      { host: HERMES_BRIDGE.host, port: HERMES_BRIDGE.port, path: '/send-media', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => {
        let j = {}; try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch {}
        resolve(j.success ? { ok: true } : { ok: false, error: j.error || 'HTTP ' + res.statusCode });
      }); });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(60000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
}

function sendWhatsAppDoc(chatId, filePath, caption, fileName) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve({ ok: false, error: 'ficheiro não existe' });
    const body = Buffer.from(JSON.stringify({ chatId, filePath, mediaType: 'document', caption: caption || undefined, fileName: fileName || 'Catalogo-SuperLoja.pdf' }), 'utf8');
    const req = require('http').request(
      { host: HERMES_BRIDGE.host, port: HERMES_BRIDGE.port, path: '/send-media', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => {
        let j = {}; try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch {}
        resolve(j.success ? { ok: true } : { ok: false, error: j.error || 'HTTP ' + res.statusCode });
      }); });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(120000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
}

// Envia um DOCUMENTO local (PDF) via Meta (multipart, attachment type "file").
function sendFileMeta(recipientId, filePath, fileName) {
  return new Promise((resolve) => {
    let doc; try { doc = fs.readFileSync(filePath); } catch (e) { return resolve(false); }
    const B = '----SuperLojaDoc' + Math.random().toString(36).slice(2);
    const parte = (n, v) => Buffer.from('--' + B + '\r\nContent-Disposition: form-data; name="' + n + '"\r\n\r\n' + v + '\r\n', 'utf8');
    const body = Buffer.concat([
      parte('recipient', JSON.stringify({ id: recipientId })),
      parte('message', JSON.stringify({ attachment: { type: 'file', payload: { is_reusable: false } } })),
      Buffer.from('--' + B + '\r\nContent-Disposition: form-data; name="filedata"; filename="' + (fileName || 'Catalogo.pdf') + '"\r\nContent-Type: application/pdf\r\n\r\n', 'utf8'),
      doc, Buffer.from('\r\n--' + B + '--\r\n', 'utf8')
    ]);
    const req = https.request({ hostname: 'graph.facebook.com', path: `/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + B, 'Content-Length': body.length } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); if (j.error) log('WARN', 'sendFileMeta erro: ' + j.error.message); resolve(!j.error); } catch { resolve(false); } }); });
    req.on('error', () => resolve(false));
    req.setTimeout(120000, () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  });
}

// Gera o catálogo PDF (template rotativo por omissão) e devolve o caminho.
// categoria/filtro opcionais para catálogo personalizado.
// max: default 200 (= catálogo completo). O dono pode forçar um número menor
// (ex: "manda só os 10 primeiros fones"). Se filtrou por categoria/filtro, o
// limite já é natural.
let _catTplIdx = 0;
async function gerarCatalogoBot(opts) {
  opts = opts || {};
  const produtos = await fetchCatalogFull();
  if (!produtos.length) throw new Error('catálogo indisponível');
  // roda os templates para variar; cliente pode pedir um específico via opts.template
  const tpls = catalogPdf.listarTemplates();
  const template = opts.template && tpls.includes(opts.template) ? opts.template : tpls[_catTplIdx++ % tpls.length];
  return await catalogPdf.gerarCatalogo(produtos, {
    template, categoria: opts.categoria, filtro: opts.filtro, ids: opts.ids,
    titulo: opts.titulo || 'SuperLoja Angola',
    slug: (opts.slug || opts.categoria || opts.filtro || 'geral').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24),
    max: opts.max || 200
  });
}

// ─── IA (AISA) — bot humano com contexto + visão ──────────────────────────────
const AI_CONFIG_FILE = DATA_DIR + '/ai-config.json';
const WHATSAPP = '+244 954 949 595';
const WA_LINK = 'https://wa.me/244954949595';   // link directo clicável (não só o número)
const SITE = 'https://superloja.vip';
const SUPERLOJA_KEY = process.env.SUPERLOJA_API_KEY || '';
const SUPERLOJA_SECRET = process.env.SUPERLOJA_API_SECRET || '';

// Envia uma FOTO (attachment) ao cliente via Meta send API
function sendImage(recipientId, imageUrl) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({
      recipient: { id: recipientId },
      message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } }
    }), 'utf8');
    const req = https.request({ hostname: 'graph.facebook.com', path: `/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); if (j.error) log('WARN', 'sendImage erro: ' + j.error.message); resolve(!j.error); } catch { resolve(false); } }); });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}
// Envia um FICHEIRO local como imagem (multipart) — para as fotos da BD do admin
// e as descarregadas da internet, que nao tem URL publico para a Meta ir buscar.
function sendImageFile(recipientId, filePath) {
  return new Promise((resolve) => {
    let img;
    try { img = fs.readFileSync(filePath); } catch (e) { log('WARN', 'sendImageFile: ' + e.message); return resolve(false); }
    const ext = filePath.toLowerCase().split('.').pop();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const B = '----SuperLojaForm' + Math.random().toString(36).slice(2);
    const parte = (nome, valor) => Buffer.from('--' + B + '\r\nContent-Disposition: form-data; name="' + nome + '"\r\n\r\n' + valor + '\r\n', 'utf8');
    const body = Buffer.concat([
      parte('recipient', JSON.stringify({ id: recipientId })),
      parte('message', JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: false } } })),
      Buffer.from('--' + B + '\r\nContent-Disposition: form-data; name="filedata"; filename="foto.' + ext + '"\r\nContent-Type: ' + mime + '\r\n\r\n', 'utf8'),
      img,
      Buffer.from('\r\n--' + B + '--\r\n', 'utf8')
    ]);
    const req = https.request({ hostname: 'graph.facebook.com', path: `/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + B, 'Content-Length': body.length } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); if (j.error) log('WARN', 'sendImageFile erro: ' + j.error.message); resolve(!j.error); } catch { resolve(false); } }); });
    req.on('error', () => resolve(false));
    req.setTimeout(60000, () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  });
}

// Link wa.me com texto pré-preenchido do produto (fecha a venda no WhatsApp com 1 clique)
function waProductLink(prodName) { return WA_LINK + '?text=' + encodeURIComponent('Olá! Quero encomendar: ' + (prodName || '')); }

function loadAIConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf8'));
    if (!c.apiKey && process.env.ANTHROPIC_API_KEY) c.apiKey = process.env.ANTHROPIC_API_KEY;
    return c;
  } catch { return { provider: 'aisa', model: 'claude-haiku-4-5-20251001', apiKey: process.env.ANTHROPIC_API_KEY || '' }; }
}

// Catálogo de produtos (cache 10 min) — para o bot saber preços/stock reais
let catalogCache = { at: 0, text: '', list: [] };
function catalogoPagina(pagina) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'superloja.vip',
      path: '/api/store-api/superloja/products?per_page=100&page=' + pagina + '&store=superloja',
      headers: { 'X-Api-Key': SUPERLOJA_KEY, 'X-Api-Secret': SUPERLOJA_SECRET, Accept: 'application/json' }
    };
    https.get(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}
// PAGINA: `per_page=90` com 86 produtos funcionava por sorte — ao 91º o bot
// passaria a dizer "não temos esse produto" sobre produtos reais.
// E leva a DESCRIÇÃO no texto: sem ela o bot não sabe responder "tem 2 metros?"
// ou "quanto dura a bateria?" e ou escala ao dono ou inventa.
async function fetchCatalog() {
  if (Date.now() - catalogCache.at < 10 * 60 * 1000 && catalogCache.text) return catalogCache;
  const inStock = [];
  try {
    for (let pg = 1; pg <= 10; pg++) {
      const j = await catalogoPagina(pg);
      const raw = (j && j.data) || [];
      if (!raw.length) break;
      inStock.push(...raw.filter(p => p.stock == null || Number(p.stock) > 0));
      const total = Number((j && j.total) || 0);
      if (raw.length < 100 || (total && (inStock.length >= total))) break;
    }
    if (!inStock.length) return catalogCache;   // API morta: fica a cache antiga
    const fmt = p => { const n = parseInt(String(p.price || '').replace(/[^\d]/g, '').replace(/\d{2}$/, ''), 10) || 0; return n.toLocaleString('pt-BR') + ' Kz'; };
    // Tipo de ligação dos FONES derivado do nome+descrição — nunca adivinhado
    // pelo modelo. 13-Ago: o bot listou o "Fone De Ouvido Bluetooth" (Lenovo)
    // em "Fones com fio" — Bluetooth com fio é contradição nos termos — e pôs
    // lá também o "Fones de ouvido" de 16.500, cuja ficha não diz NADA sobre o
    // tipo. A classificação passa a estar escrita no catálogo que ele lê:
    // dado, não inferência. (Mesma família do caso Cacaia, 04-Ago.)
    const tipoDeLigacao = (p) => {
      const nome = String(p.name).toLowerCase();
      const t = (nome + ' ' + String(p.description || '')).toLowerCase();
      if (!/fone|auricular|earbud|headset/.test(nome)) return '';
      if (/adapt|microfone|caixa|coluna/.test(nome)) return '';
      if (/\b(tws|bluetooth|sem fio|wireless)\b/.test(t)) return ' [SEM FIO — liga por Bluetooth]';
      if (/\bcom fio\b/.test(t)) return ' [COM FIO]';
      // a loja não diz o tipo (o X83, campeão de vendas, é um destes) — antes de
      // desistir, ver se a FICHA TÉCNICA do investigador confirmou o MODELO
      // exacto (tipico:false). Ficha "típica do tipo" não chega: um nome
      // genérico como "Fones de ouvido" pode ser qualquer coisa.
      try {
        const db = loadFichas();
        const f = Object.values(db).find(x => String(x.nome).toLowerCase().trim() === nome.trim());
        if (f && !f.tipico && f.ficha) {
          const blob = JSON.stringify(f.ficha).toLowerCase();
          if (/bluetooth|sem fio|tws|wireless/.test(blob)) return ' [SEM FIO — liga por Bluetooth]';
          if (/com fio/.test(blob)) return ' [COM FIO]';
        }
        // VISÃO sobre a foto do catálogo (13-Ago, pedido do dono): evidência
        // directa sobre AQUELE exemplar — promove mesmo sem modelo exacto.
        // Foi o que resolveu o "Fones de ouvido" de 16.500: a ficha da loja
        // não dizia nada, a foto mostrou TWS com caixa de carga.
        if (f && f.visao) {
          if (f.visao.tipo_ligacao === 'sem fio') return ' [SEM FIO — confirmado pela foto do produto]';
          if (f.visao.tipo_ligacao === 'com fio') return ' [COM FIO — confirmado pela foto do produto]';
        }
      } catch (_) {}
      return ' [tipo não indicado na ficha — NÃO afirmes se é com ou sem fio]';
    };
    const text = inStock.map(p => {
      const desc = String(p.description || '').replace(/\s+/g, ' ').trim();
      return '- ' + p.name + ': ' + fmt(p) +
        tipoDeLigacao(p) +
        (Number(p.stock) === 1 ? ' (última unidade)' : '') +
        (desc ? ' — ' + desc.slice(0, 110) : '');
    }).join('\n');
    const images = {};
    inStock.forEach(p => {
      const img = (p.images && p.images[0]) || p.image || null;
      const s = typeof img === 'string' ? img : (img && (img.url || img.src || img.path)) || '';
      if (s) images[p.name.toLowerCase()] = s.startsWith('http') ? s : (SITE + s);
    });
    catalogCache = { at: Date.now(), text, list: inStock, images };
  } catch (e) { log('WARN', 'catalogo: ' + e.message); }
  return catalogCache;
}

// Lista completa de produtos (objectos crus) — para o catálogo PDF
async function fetchCatalogFull() {
  const c = await fetchCatalog();
  return (c && c.list) || [];
}

function loadKnowledge() {
  try { return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8')); } catch { return null; }
}
// Bloco de FAQ/tom aprendido das conversas reais (vazio até o 1º "learn")
function knowledgePromptBlock() {
  const k = loadKnowledge();
  if (!k) return '';
  let b = '\nCONHECIMENTO APRENDIDO das conversas reais desta loja (usa-o!):\n';
  (k.faq || []).slice(0, 15).forEach(f => { b += 'P: ' + f.pergunta + '\nR: ' + f.resposta + '\n'; });
  if (k.tom) b += 'Tom/estilo do dono a imitar: ' + k.tom + '\n';
  if (k.evitar && k.evitar.length) b += 'Evitar: ' + k.evitar.join('; ') + '\n';
  return b;
}

// ─── Disjuntor anti-loop ──────────────────────────────────────────────────────
// Sinais de que algo esta errado numa conversa:
//   (a) o cliente manda a MESMA mensagem 3x seguidas (outro bot? pessoa frustrada);
//   (b) o bot da a MESMA resposta 3x seguidas (loop de IA);
//   (c) avalanche: >=25 respostas ao mesmo cliente em 10 min (soco de seguranca).
// Em qualquer caso: PARA de responder a esse cliente por 1h e chama o Carlos.
// LICAO REAL (2026-07-17, cliente heldermaka): uma encomenda legitima em Angola
// e uma rajada de mensagens CURTAS — 10 trocas em 2 minutos ("Zango 1", nome,
// telefone...). O limiar antigo de 10/10min cortou uma VENDA a meio. Loops
// verdadeiros sao apanhados por (a)/(b) — a contagem e so um tecto patologico.
const _disjuntor = new Map();   // senderId -> {clienteMsgs:[], botMsgs:[], quando:[], pausadoAte, avisado}

// ─── Persistência da pausa (handoff + disjuntor) ──────────────────────────────
// O estado vivia só em memória: a cada restart a pausa evaporava e o bot voltava
// a falar POR CIMA do dono. CASO REAL (30-Jul, Catarina Sabalo): o dono assumiu
// às 08:57:49, o bot reiniciou às 08:58:17 e às 08:58:25 já respondia à cliente.
// Com ~7 arranques por dia, isto não era excepção — era rotina (43 das 72 pausas
// apanharam um restart dentro da própria hora).
//
// ⚠️ REGRA: TODA a escrita de `pausadoAte` passa por _pausar()/_despausar().
// Nunca escrever `g.pausadoAte = ...` à mão. A proposta original contou os
// caminhos com um grep por `3600000` — que só apanha quem PÕE a pausa, nunca
// quem a LEVANTA — e esqueceu o /api/admin/consultas/responder. Um caminho de
// limpeza esquecido faz o disco ressuscitar pausas já resolvidas: o bot fica
// MUDO com o cliente à espera, e nem o restart o cura.
const STATE_FILE = DATA_DIR + '/crm/bot-state.json';

function salvarDisjuntor() {
  // Escrita SÍNCRONA de propósito, sem debounce: no Windows o bot é morto por
  // terminação forçada e NENHUM hook de saída corre (nem SIGTERM, nem 'exit').
  // Uma escrita adiada meio segundo evaporava. São ~6 escritas por dia de um
  // ficheiro com menos de 1 KB.
  try {
    const estado = {};
    for (const [sid, g] of _disjuntor) {
      if (g.pausadoAte > Date.now()) {              // só pausas AINDA activas
        estado[sid] = {
          pausadoAte: g.pausadoAte,
          motivoPausa: g.motivoPausa || null,       // null e não 'disjuntor': não inventar a causa
          encaminhadas: g.encaminhadas || 0         // o travão dos 6 avisos ao dono tem de sobreviver,
        };                                          // senão cada restart dá direito a mais 6 WhatsApps
      }
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify({ disjuntor: estado }, null, 2));
  } catch (e) { log('WARN', '[STATE] não gravei a pausa: ' + e.message); }
}

function restaurarDisjuntor() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;         // primeira vez: arranca sem estado, como antes
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    let n = 0;
    for (const [sid, s] of Object.entries((d && d.disjuntor) || {})) {
      if (!(s.pausadoAte > Date.now())) continue;   // pausa já expirada: não ressuscitar
      _disjuntor.set(sid, {
        clienteMsgs: [], botMsgs: [], quando: [],   // detecção de loop é de tempo real: não se restaura
        pausadoAte: s.pausadoAte,
        motivoPausa: s.motivoPausa || undefined,
        encaminhadas: s.encaminhadas || 0,
        // `avisado` fica SEMPRE a false: o setTimeout de 1h que o desliga morre
        // com o processo. Restaurá-lo a true prendia-o para sempre e o próximo
        // disparo do disjuntor calava o bot SEM avisar o dono nem deixar erro no
        // log. O pior caso assim é um aviso repetido — que até é informação útil.
        avisado: false
      });
      n++;
    }
    if (n) log('INFO', `[STATE] ${n} pausa(s) restaurada(s) do disco`);
  } catch (e) { log('WARN', '[STATE] não restaurei as pausas: ' + e.message); }
}

// Únicos donos da escrita de pausadoAte — gravam sempre, memória e disco.
function _pausar(senderId, ate, motivo) {
  const g = _dj(String(senderId));
  g.pausadoAte = ate;
  g.motivoPausa = motivo;        // 'handoff' ou 'disjuntor': é o que o log usa para dizer quem calou o bot
  salvarDisjuntor();
  return g;
}
function _despausar(senderId) {
  const g = _dj(String(senderId));
  g.pausadoAte = 0;
  g.avisado = false;
  g.motivoPausa = null;
  g.encaminhadas = 0;            // conversa devolvida ao bot: o travão dos avisos recomeça do zero
  salvarDisjuntor();             // SEM isto o disco ressuscitava a pausa no restart seguinte
  return g;
}

// Aqui e NÃO dentro do app.listen: se algum _dj() corresse antes do restauro,
// criava a entrada a zeros e o `if (!_disjuntor.has(...))` abaixo impedia o
// restauro de a repor.
restaurarDisjuntor();

function _dj(senderId) {
  if (!_disjuntor.has(senderId)) _disjuntor.set(senderId, { clienteMsgs: [], botMsgs: [], quando: [], pausadoAte: 0, avisado: false });
  if (_disjuntor.size > 500) { const k = _disjuntor.keys().next().value; _disjuntor.delete(k); }
  return _disjuntor.get(senderId);
}

// true = conversa pausada; quem chama NAO deve responder
// Assinatura de texto para comparar respostas "quase iguais" (o loop da conversa
// da Joelma, 27-Jul: o bot repetiu "qual dos fones preferes?" 3x com palavras
// diferentes, por isso a comparação exata NÃO o apanhou).
function _assinatura(txt) {
  return String(txt || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')      // sem acentos
    .replace(/[^a-z0-9 ]/g, ' ')                            // sem emojis/pontuação
    .split(/\s+/).filter(p => p.length > 3).sort().join(' ').slice(0, 120);
}
// A PERGUNTA é o que revela o loop: na conversa da Joelma o bot perguntou
// "qual dos fones?" três vezes com frases diferentes. Comparar o texto todo não
// apanhava; comparar só as perguntas (com stems de 5 letras) apanha.
function _perguntas(txt) {
  const t = String(txt || '');
  const frases = t.split(/(?<=[?])/).filter(f => f.includes('?'));
  const termos = new Set();
  frases.forEach(f => {
    _assinatura(f).split(' ').filter(Boolean).forEach(p => termos.add(p.slice(0, 5)));
  });
  return termos;
}
function _parecidas(a, b) {
  // 1) mesma pergunta repetida (o caso real)
  const PA = _perguntas(a), PB = _perguntas(b);
  if (PA.size >= 2 && PB.size >= 2) {
    let c = 0; PA.forEach(p => { if (PB.has(p)) c++; });
    if (c >= 2 && c / Math.min(PA.size, PB.size) >= 0.5) return true;
  }
  // 2) resposta inteira quase igual
  const A = new Set(_assinatura(a).split(' ').filter(Boolean));
  const B = new Set(_assinatura(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return false;
  let comuns = 0; A.forEach(p => { if (B.has(p)) comuns++; });
  return comuns / Math.max(A.size, B.size) >= 0.6;
}
// Cliente frustrado: emojis de irritação, setas para cima ("já pedi isto"),
// mensagens minúsculas repetidas. Insistir aqui perde a venda.
const RE_FRUSTRACAO = /^(\s*[👆👇🙄😤😡😠🤨😒⁉️❓?]{1,6}\s*)$|🙄|😤|😡|😠|👆{2,}|\?{3,}/u;

function disjuntorBloqueia(senderId, senderName, platform, msgCliente) {
  const g = _dj(senderId);
  if (g.pausadoAte > Date.now()) return true;

  const m = String(msgCliente || '').trim();
  if (m.length >= 2) {
    g.clienteMsgs.push(m); g.clienteMsgs = g.clienteMsgs.slice(-3);
    if (g.clienteMsgs.length === 3 && g.clienteMsgs.every(x => x === m)) {
      return disjuntorDispara(senderId, senderName, platform,
        'o cliente mandou a MESMA mensagem 3x seguidas ("' + m.slice(0, 60) + '") — pode ser outro bot ou alguém frustrado');
    }
  }
  // FRUSTRAÇÃO: 2 sinais nas últimas 3 mensagens → passa para humano já
  if (RE_FRUSTRACAO.test(m)) {
    g.frustracao = (g.frustracao || 0) + 1;
    if (g.frustracao >= 2) {
      g.frustracao = 0;
      return disjuntorDispara(senderId, senderName, platform,
        'CLIENTE FRUSTRADO (mandou "' + m.slice(0, 20) + '") — o bot estava a não resolver; assume tu a conversa');
    }
  }
  return false;
}

// chamar depois de cada resposta enviada; true = acabou de disparar
function disjuntorRegistaResposta(senderId, senderName, platform, resposta) {
  const g = _dj(senderId);
  const agora = Date.now();
  g.quando.push(agora); g.quando = g.quando.filter(t => agora - t < 600000);
  const r = String(resposta || '').trim();
  g.botMsgs.push(r); g.botMsgs = g.botMsgs.slice(-3);

  if (g.botMsgs.length === 3 && g.botMsgs.every(x => x === r) && r.length > 10) {
    return disjuntorDispara(senderId, senderName, platform, 'o bot deu a MESMA resposta 3x seguidas — loop de IA');
  }
  // REPETIÇÃO POR SEMELHANÇA: 2 respostas parecidas seguidas já é loop
  // (a exata só apanhava copy-paste; o loop real usa palavras diferentes)
  if (g.botMsgs.length >= 2 && r.length > 25 && _parecidas(g.botMsgs[g.botMsgs.length - 2], r)) {
    return disjuntorDispara(senderId, senderName, platform,
      'o bot repetiu a MESMA pergunta/ideia com outras palavras ("' + r.slice(0, 50) + '...") — estava em círculos');
  }
  // PROMESSA REPETIDA: "vou confirmar com a equipa" 2x sem resolver nada.
  // 13-Ago (Feliciano): a espiral usou OUTRAS palavras — "vou chamar o dono",
  // "o responsável já vem", "vou passar-te ao dono" — seis promessas em 20 min
  // sem o regex as ver, com o cliente a irritar-se. As variantes de escalamento
  // contam como a mesma promessa: à 2ª sem resolução, cala e encaminha.
  if (/vou (confirmar|verificar|chamar|passar-te)|deixa que (eu )?(confirmo|verifico)|volto já|confirmo isso|o (dono|respons[áa]vel|chefe|colega) (j[áa] )?(vem|est[áa] a caminho)/i.test(r)) {
    g.promessas = (g.promessas || 0) + 1;
    if (g.promessas >= 2) {
      g.promessas = 0;
      return disjuntorDispara(senderId, senderName, platform,
        'o bot prometeu "vou confirmar" 2x e não resolveu — o cliente está à espera de uma resposta REAL');
    }
  }
  if (g.quando.length >= 25) {
    return disjuntorDispara(senderId, senderName, platform, 'avalanche: ' + g.quando.length + ' respostas em 10 minutos');
  }
  return false;
}

// "Fones de ouvido X83 (preto) x1" e "Fones de ouvido X83" são a MESMA coisa;
// "Fones X83" e "Fones Pro6" não são. O MODELO (token com letra+dígito) é o
// discriminador — comparar só as palavras dava "fones ouvido" para ambos.
function _tokensProduto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    // ⚠️ NÃO filtrar /^x\d+$/: comia o modelo "X83". Só quantidades mesmo
    // ("1x", "x1"). E números ficam — "iPhone 13" ≠ "iPhone 11".
    .filter(p => p && p.length >= 2 && !/^\d+x$/.test(p) && !/^x\d$/.test(p));
}
function mesmoProduto(a, b) {
  const ta = _tokensProduto(a), tb = _tokensProduto(b);
  if (!ta.length || !tb.length) return false;
  const modelo = t => t.filter(x => /\d/.test(x));   // x83, pro6, 13, 11pro
  const ma = modelo(ta), mb = modelo(tb);
  if (ma.length && mb.length && !ma.some(m => mb.includes(m))) return false;   // X83 ≠ Pro6
  const comuns = ta.filter(t => tb.includes(t)).length;
  return comuns / Math.min(ta.length, tb.length) >= 0.6;
}

// Aviso ao dono COM A FOTO do produto. Ver o artigo em vez de ler o nome poupa
// o passo de ir ao catálogo confirmar o que o cliente pediu — sobretudo quando
// há 7 cabos Tipo C e 5 fones diferentes. Se a foto falhar, o texto vai na mesma:
// um aviso sem foto é infinitamente melhor do que aviso nenhum.
async function notifyCarlosComFoto(texto, nomeProduto) {
  try {
    const p = nomeProduto ? acharProdutoCatalogo(nomeProduto) : null;
    const url = p ? findProductImage(p.name) : null;
    if (url) {
      const nums = numerosNotificados();
      const res = await Promise.all(nums.map(n => sendWhatsAppImage(n + '@s.whatsapp.net', url, texto)));
      const ok = res.filter(r => r && r.ok).length;
      if (ok) { log('INFO', '[AVISO] foto de "' + p.name.slice(0, 40) + '" entregue a ' + ok + '/' + nums.length); return true; }
      log('WARN', '[AVISO] foto falhou em todos — envio só o texto');
    }
  } catch (e) { log('WARN', '[AVISO] foto: ' + String(e.message).slice(0, 80)); }
  return notifyCarlos(texto);
}

// REVENDA/ENTREGA POR TERCEIROS — detecção DETERMINÍSTICA, não por marcador.
// A regra no prompt fez o bot recusar-se a organizar (bem), mas ele esqueceu o
// <<HUMANO>> e o dono nunca soube. Isto envolve dinheiro e alguém que não é
// cliente: não pode depender de a IA se lembrar de escrever uma etiqueta.
// ⚠️ SEM \b no fim: com ele, "aceitou 4mil" (a mensagem real da Catarina) não
// casava — o \b exigia fronteira entre o "4" e o "m" de "mil", que não existe.
const RE_REVENDA = /\b(aceit(ou|aram)\s+\d|o\s+cliente\s+(quer|pediu|aceitou|disse)|vou\s+entregar|estou\s+a\s+entregar|para\s+um\s+cliente\s+meu|para\s+revend|pre[çc]o\s+de\s+revenda|revender)/i;
function escalarRevenda(senderId, senderName, platform, msgCliente) {
  notifyCarlos('🤝 *REVENDA / ENTREGA POR TERCEIRO* (' + platform + ')\n👤 ' + senderName + linhaContacto(senderId) +
    '\n💬 "' + String(msgCliente || '').slice(0, 160) + '"\n\n' +
    'Não é um cliente normal — fala de entregar ou revender. O bot NÃO combinou nada (preços de revenda são teus). Trata tu.');
  log('INFO', `[REVENDA] ${senderName} (${platform}) → escalado ao dono`);
}

// FOTO ENVIADA → PRODUTO. O WhatsApp, ao citar uma foto nossa, não devolve a
// legenda — só um esboço da mensagem. O bot via "[foto sem legenda]" e ficava
// sem saber a que produto o cliente apontava, mesmo tendo-a acabado de enviar.
// Guardar messageId→produto resolve-o de forma exacta (não por adivinhação).
const _fotosEnviadas = new Map();          // messageId -> { produto, quando }
function registarFotoEnviada(messageId, produto) {
  if (!messageId || !produto) return;
  _fotosEnviadas.set(String(messageId), { produto, quando: Date.now() });
  // limpeza: 6h chega para qualquer conversa viva
  if (_fotosEnviadas.size > 400) {
    const limite = Date.now() - 6 * 3600000;
    for (const [k, v] of _fotosEnviadas) if (v.quando < limite) _fotosEnviadas.delete(k);
  }
}
function produtoDaFotoCitada(quotedId) {
  const e = quotedId ? _fotosEnviadas.get(String(quotedId)) : null;
  return e && Date.now() - e.quando < 6 * 3600000 ? e.produto : null;
}

// Linha de contacto para os avisos ao dono: sem o número ele lê "245264...@lid"
// e não consegue ligar ao cliente que ficou a meio da compra.
function linhaContacto(senderId) {
  const t = logConversation._telefone;
  if (t) return '\n📞 +' + t + '  (wa.me/' + t + ')';
  return senderId ? '\n🆔 ' + String(senderId).slice(0, 30) : '';
}

// BURACO NEGRO (30-Jul, conversa do Francisbel): o disjuntor pausou bem, mas o
// cliente continuou a escrever 3 vezes e essas mensagens desapareceram —
// não ficaram no CRM, o log não guardava o texto, e o dono nunca as viu.
// São as mensagens MAIS valiosas da conversa: um cliente ainda interessado a
// tentar explicar-se. Agora: registar sempre e encaminhar ao dono (com travão).
function disjuntorEncaminha(senderId, senderName, platform, msgCliente) {
  const g = _dj(senderId);
  const texto = String(msgCliente || '').trim();
  if (!texto) return;
  g.encaminhadas = (g.encaminhadas || 0) + 1;
  // gravar JÁ: o salvarDisjuntor só corria em _pausar/_despausar, por isso o
  // disco ficava eternamente em 0 e o travão não sobrevivia ao restart — com
  // ~7 arranques por dia, o dono levava mais 6 mensagens da mesma conversa a
  // cada um. O comentário do salvarDisjuntor prometia isto; o código não fazia.
  salvarDisjuntor();
  if (g.encaminhadas > 6) return;                       // não inundar o dono
  const restam = Math.max(0, Math.round((g.pausadoAte - Date.now()) / 60000));
  notifyCarlos('💬 *CLIENTE CONTINUA A ESCREVER* (bot pausado, ' + restam + ' min)\n👤 ' + senderName +
    ' (' + platform + ')' + linhaContacto(senderId) +
    '\n💬 "' + texto.slice(0, 200) + '"\n\nResponde tu — o bot está calado nesta conversa.' +
    (g.encaminhadas === 6 ? '\n\n(paro de te reencaminhar esta conversa para não te encher)' : ''));
}

function disjuntorDispara(senderId, senderName, platform, razao) {
  const g = _pausar(senderId, Date.now() + 3600000, 'disjuntor');   // 1h sem respostas automáticas (grava em disco)
  if (!g.avisado) {
    g.avisado = true;
    setTimeout(() => { g.avisado = false; }, 3600000);
    notifyCarlos('🔌 *BOT INTERROMPIDO nesta conversa* (' + platform + ')\n👤 ' + senderName + linhaContacto(senderId) +
      '\n⚠ Motivo: ' + razao + '\nParei as respostas automáticas a este cliente por 1 HORA. Responde tu no ' +
      (platform === 'whatsapp' ? 'WhatsApp' : platform === 'instagram' ? 'Instagram' : 'Messenger') + '.');
    log('ERROR', `[DISJUNTOR] ${senderName} (${platform}) pausado 1h — ${razao}`);
  }
  return true;
}

// IA pendurada = cliente sem resposta nenhuma. Corta aos 75s e cai no fallback.
function comTimeout(promessa, ms) {
  return Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(new Error('IA não respondeu em ' + (ms / 1000) + 's')), ms))]);
}

// Se a plataforma estiver em baixo, TODAS as respostas falham. Sem travao, o
// Carlos levava um WhatsApp por cada mensagem de cada cliente.
const _failNotified = new Map();
function shouldNotifyFail(senderId) {
  const agora = Date.now();
  for (const [k, t] of _failNotified) if (agora - t > 3600000) _failNotified.delete(k);
  if (_failNotified.has(senderId)) return false;      // 1 aviso por cliente/hora
  if (_failNotified.size >= 5) return false;          // no maximo 5 avisos/hora no total
  _failNotified.set(senderId, agora);
  return true;
}

// A ALMA do bot — identidade/voz/valores/factos — vive num ficheiro EDITÁVEL
// (bot-alma.md), como o SOUL.md do Hermes. Editável à mão ou pelo Hermes, sem
// tocar no código. Fallback: se faltar, usa a identidade base embutida (nunca parte).
const ALMA_FILE = DATA_DIR + '/crm/bot-alma.md';
const ALMA_FALLBACK = [
  'És o(a) atendente humano da SuperLoja (superloja.vip), loja de tecnologia e acessórios em Luanda, Angola.',
  'Falas português de Angola, com calor e naturalidade — como uma pessoa real, NUNCA como robô. Curto e directo (é chat), 1-4 frases, emojis q.b.',
  'HONESTIDADE: nunca inventes preços, produtos, stock ou políticas.',
  'Entrega rápida em Luanda partindo do Kilamba; pagamento na entrega; site superloja.vip; WhatsApp +244 954 949 595.'
].join('\n');
function loadAlma() {
  try {
    // apaga só comentários (# ...), MANTÉM os títulos markdown (## ...)
    const txt = fs.readFileSync(ALMA_FILE, 'utf8')
      .split('\n').filter(l => !/^#(?!#)/.test(l.trim())).join('\n').trim();
    return txt || ALMA_FALLBACK;
  } catch { return ALMA_FALLBACK; }
}

function buildSystemPrompt(catalogText, senderId, msgTexto) {
  // data local de Luanda (WAT = UTC+1) — sem ela a IA não converte "sábado" em data
  const agoraWAT = new Date(Date.now() + 3600000);
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const hoje = agoraWAT.toISOString().slice(0, 10) + ' (' + dias[agoraWAT.getUTCDay()] + ')';
  return [
    loadAlma(),                         // ← a ALMA editável (identidade, voz, valores, factos)
    '',
    'HOJE é ' + hoje + '.',
    'Link WhatsApp clicável: ' + WA_LINK,
    'NÚMERO DE WHATSAPP: usa SEMPRE +244 954 949 595 (wa.me/244954949595). NUNCA inventes, modifiques ou uses placeholders (X, 9X, XXX, etc.). Se o cliente pedir contacto, dá APENAS este.',
    '',
    // 29-Jul (conversa do Jovane): o bot disse "Tipo C por 4.500 Kz" — mas há SETE
    // cabos Tipo C no catálogo, de 4.500 a 12.000 Kz. O cliente ia à loja pedir "o
    // Tipo C" e a expectativa de preço rebentava. Generalizar preço por categoria
    // é tão mau como inventar.
    'PREÇOS — REGRA DURA: NUNCA dês preço a uma CATEGORIA ("os cabos Tipo C custam X",',
    '"os fones estão a Y"). Existem vários produtos parecidos com preços MUITO diferentes',
    '(ex: "Cabo de Dados Tipo C para USB" 4.500 Kz vs "Cabo Tipo C" 12.000 Kz).',
    'Diz SEMPRE o NOME COMPLETO do produto ao lado do preço, exactamente como está no catálogo.',
    'Se o cliente pedir uma categoria ("quero um cabo tipo C"), lista 2-3 opções com nome',
    'completo e preço de cada, e pergunta qual quer — nunca respondas com um preço só.',
    '',
    // 29-Jul, Hélio de Lemos: "Quero aqueles tipo brinco." O bot respondeu
    // *"brinco é um acessório que não temos"* — e a loja tem CINCO modelos de
    // earbuds. Em Luanda os earbuds sem fio chamam-se "brincos" (são pequenos e
    // ficam na orelha). A venda morreu num problema de vocabulário, não de stock.
    'COMO O CLIENTE FALA (não é o nome do catálogo):',
    '- "brinco"/"brincos"/"aqueles tipo brinco" = EARBUDS/fones sem fio pequenos (TWS). Mostra os fones sem fio com preço.',
    // 30-Jul, Francisbel: "o fones que eu estou a falar e digital" — o bot
    // perguntou DUAS vezes o que era "digital", tendo acabado de listar os
    // "Fones sem fio TWS transparentes, com display LED de energia".
    '- "digital" (em fones) = com DISPLAY/écran LED que mostra a bateria. É o "Fones de ouvido sem fio TWS transparentes, com display LED de energia".',
    '  Se o cliente disser "digital", mostra ESSE directamente com o preço — não perguntes o que quer dizer.',
    '- ANTES de dizeres que não temos algo, traduz a palavra do cliente para o OBJECTO FÍSICO e procura esse objecto no catálogo.',
    '  Só depois de não haver nada do mesmo tipo é que dizes que não temos. Um cliente que ouve "não temos" vai-se embora.',
    '- Se o cliente usar uma palavra que não reconheces, pergunta "é para os ouvidos / para carregar / para o telefone?" — não presumas que é outro produto.',
    // A regra que teria salvo a venda do Francisbel
    '- ANTES de pedires um esclarecimento, RELÊ o que acabaste de enviar: se a resposta já está na lista que mandaste,',
    '  APONTA para ela ("é este: <nome completo> — <preço>, é o que tem display") em vez de perguntar. Perguntar o que já',
    '  respondeste faz o cliente pensar que não estás a prestar atenção.',
    '- NUNCA faças a mesma pergunta de esclarecimento duas vezes. Se não percebeste à segunda, oferece 2 opções concretas',
    '  com nome e preço e deixa-o escolher ("é o X de 7.500 ou o Y de 8.500?").',
    '- "tá bom", "ok", "certo" a seguir a uma pergunta tua NÃO é uma resposta à pergunta — é o cliente a desligar-se.',
    '  Nesse momento para de perguntar: mostra o produto mais provável com foto e preço.',
    '',
    // 27-Jul, Joelma: "Todos funcionam mesmo para iPhone 15? A este valor? Já tive
    // experiências não muito boas a esses preços." O bot respondeu "preciso de
    // confirmar com a equipa" — uma objeção de CONFIANÇA tratada como falta de dados.
    // 3-Ago, Maria angelina: pediu "capa para iPhone 12 Pro", o bot ofereceu
    // "12 Pro Max" DUAS vezes, ela corrigiu ("Eu disse IPhone 12 Pro") e ele
    // insistiu no Max. Uma capa de 12 Pro Max NÃO serve num 12 Pro.
    // 4/5-Ago, Sílvio Calvino: clicou no anúncio duas vezes (19h38 e 8h16 do dia
    // seguinte) e recebeu DUAS VEZES a mesma lista de 9 produtos, como se fosse
    // a primeira vez. Quem volta é quem está mais perto de comprar.
    // 4-Ago, Jordão: adaptador de 8.000 Kz + entrega no Centro de 5.000 Kz =
    // 62% do preço. Ele disse "entrega está muito caro" e só então o bot ofereceu
    // o levantamento grátis. Oferecer ANTES evita a objeção.
    // MEDIDO (25-Jul a 5-Ago): 53 clientes ficaram em silêncio depois de uma
    // resposta do bot. 45 deles morreram numa PERGUNTA ABERTA ("qual destes te
    // interessa?", "o que procuras?"). Só 1 desistiu depois de lhe pedirem os
    // dados — quem entra no fluxo de encomenda, fecha. O problema é o fecho.
    // 2-6 Ago: 14 clientes engataram e ZERO encomendas. Vários morreram no
    // último passo — "qual é o teu nome completo?" (Marissaura, Ladisau_G) e o
    // Anthony Gabriel levou 10 mensagens até ao telefone. Pedir nome, depois
    // bairro, depois telefone são 3 idas e voltas no momento mais frágil.
    'RECOLHER OS DADOS DA ENCOMENDA — TUDO DE UMA VEZ:',
    '- Quando o cliente já escolheu o produto, pede as TRÊS coisas numa só mensagem, em lista curta:',
    '  "Para fechar preciso só de 3 coisas (podes mandar tudo numa mensagem): 1) nome completo 2) bairro/rua 3) número de telefone."',
    '- NUNCA peças um dado, esperes, e peças o seguinte. Cada pergunta extra é uma oportunidade de o cliente desistir.',
    '- Se ele mandar só parte, agradece e pede APENAS o que falta, nomeando-o ("falta-me só o bairro").',
    '- Assim que tiveres os três, confirma o total com entrega e regista a encomenda — não voltes a perguntar nada.',
    '',
    'COMO FECHAR CADA MENSAGEM (isto decide a venda):',
    '- NUNCA termines com uma pergunta aberta do tipo "qual destes te interessa?" ou "o que procuras?".',
    '  Obrigar o cliente a escolher entre 9 coisas, no telemóvel, faz com que ele não responda de todo.',
    '- Em vez disso, fecha SEMPRE de uma destas formas (por ordem de preferência):',
    '  1) RECOMENDA UM e faz pergunta de sim/não: "O mais vendido é o Fones de ouvido X83 — 9.500 Kz. Queres esse?"',
    '  2) DÁ NÚMEROS e pede só o número: "Responde só com o número: 1, 2 ou 3."',
    '  3) PROPÕE O PASSO SEGUINTE tu: "Mando-te a foto dos dois mais procurados?" / "Digo-te o total com entrega?"',
    '- Se o cliente já disse o que quer, não voltes a perguntar: avança para morada e nome.',
    '- O X83 (9.500 Kz) é o campeão de vendas da loja — é a recomendação segura quando ele não sabe o que quer.',
    '',
    // 14-Ago: a parte POSITIVA do anti-tique. As proibições acima existiam e
    // saíam na mesma; isto dá ao modelo um molde concreto por mensagem.
    'ABERTURA DESTA MENSAGEM — ' + MOLDE_DE_ABERTURA[(_semente(senderId) + String(msgTexto || '').length) % MOLDE_DE_ABERTURA.length],
    '- NÃO REPITAS O TEU PRÓPRIO MOLDE: lê as tuas mensagens anteriores no histórico acima. Se a última começou por',
    '  "Olá", "Perfeito", "Ótimo", "Boa pergunta", "Combinado" ou "Ah, entendi" — esta NÃO pode começar por nenhuma dessas.',
    '- Saudação ("Olá", "Oi", "Bom dia") SÓ se esta for a primeira mensagem que lhe mandas hoje. Ninguém cumprimenta 4× na mesma conversa.',
    '- No máximo UM emoji por mensagem, e nunca o mesmo da mensagem anterior. Mensagem sem emoji também é boa.',
    '',
    // ANTECIPAR — vive AQUI e não no blocoCampanha de propósito: aquele bloco
    // evapora quando campanha-ativa.json passa 24h, e levava o cross-sell com ele.
    'ANTECIPAR O PASSO SEGUINTE (sugerir sem inventar):',
    '- Depois de o cliente escolher o produto principal — e SÓ depois — podes sugerir UM complemento, um só,',
    '  com o NOME COMPLETO e o preço exactos do catálogo. Nunca dois, nunca antes de fechar o principal.',
    '- A sugestão vai em PERGUNTA COM SUPOSIÇÃO VERIFICÁVEL, nunca como afirmação de compatibilidade:',
    '  "O teu carrega por USB-C, certo? Se sim, tenho o Cabo de Dados Tipo C para USB — 4.500 Kz."',
    '  ⛔ NUNCA "este cabo serve no teu telemóvel" — não sabes, e afirmar compatibilidade já custou uma venda (1-Ago, Laidy Inês).',
    '- CLIENTE INDECISO (já lhe mostraste e não escolheu, ou diz "não sei", "qual é melhor?"): NÃO repitas a lista.',
    '  RECOMENDA UM com uma razão verdadeira (preço, ser o mais vendido, ter display de bateria) e fecha com sim/não.',
    '  Mais opções a um indeciso é o que mata a conversa.',
    '- MEMÓRIA: se o bloco de perfil trouxer zona/modelo/interesses, usa-os com naturalidade ("ainda é para o Camama?").',
    '  Se vier vazio, não finjas que te lembras. E NUNCA digas que tens ficha, registo ou histórico dele — lembras-te do que ELE contou.',
    '',
    'VENDER SEM MENTIR (é isto, e é tudo):',
    '- ESCASSEZ: só a REAL. Se a linha do catálogo disser "(última unidade)", podes dizê-lo. Se não disser, não há pressa nenhuma.',
    '  ⛔ PROIBIDO inventar pressa: "só hoje", "está a acabar", "últimas unidades", "aproveita antes que suba", "o preço vai mudar".',
    '- PROVA SOCIAL: só o X83 é o campeão de vendas confirmado. ⛔ De qualquer outro produto NÃO inventes popularidade',
    '  ("toda a gente leva", "vendemos imensos"), nem números de vendas, nem opiniões de outros clientes.',
    '- TIRAR O RISCO — o teu argumento mais forte e 100% verdade. Diz sempre o MECANISMO na MESMA frase:',
    '  "não pagas nada agora — só pagas quando o produto chegar à tua mão." / "tens 1 dia para testar; se não estiver bem, trocamos."',
    '  ⛔ Nunca escrevas "sem risco" sozinho: sem o motivo colado, a frase é apagada e o cliente fica sem o argumento.',
    '- TOTAL TRANSPARENTE: assim que souberes o bairro, dá o TOTAL (produto + entrega) sem ele pedir.',
    '- ESCADA DE PREÇO: se hesita no valor, mostra o mais barato E o melhor, ambos com nome e preço do catálogo, e diz a',
    '  diferença concreta. Nunca desvalorizes o mais caro nem inventes defeitos no mais barato.',
    '- QUEM HESITA NÃO SE PERDE: se adiar, aceita bem e regista com <<DEPOIS>>. Não insistas nem mandes "então?".',
    '⛔ NUNCA: pressão ("decide agora"), culpa ("vais perder"), urgência inventada, desconto ou preço negociado (só o dono),',
    '  prometer brinde, insistir depois de um não. Cliente pressionado não volta.',
    '- UM facto por frase curta: se uma frase tiver problema, o sistema apaga essa frase inteira — frases curtas garantem',
    '  que o preço e o produto sobrevivem mesmo que outra coisa caia.',
    '',
    'PERGUNTAR — SÓ QUANDO MUDA A RESPOSTA:',
    '- Antes de perguntares, verifica: dá para responder com o catálogo, o histórico ou a lista que acabaste de enviar?',
    '  Se sim, RESPONDE — não perguntes. Medido: dos 53 clientes que se calaram, 45 morreram numa pergunta.',
    '- Só estas quatro justificam pergunta: modelo exacto (capas/cabos), uso real (telemóvel vs PC vs carro),',
    '  bairro (para o total), e com/sem fio quando ele disse só "fones". Todo o resto: assume o mais provável e mostra.',
    '- FORMATO OBRIGATÓRIO — pergunta com PALPITE embutido, para a conversa andar mesmo sem resposta:',
    '  "Deve ser Android, certo? Se for, é o Cabo de Dados Tipo C para USB — 4.500 Kz."',
    '- Cola sempre a RAZÃO à pergunta ("é que a capa do modelo ao lado não entra") — sem razão soa a formulário.',
    '- UMA pergunta por mensagem. Se ele não respondeu à anterior, NÃO a reformules: dá 2 opções numeradas com nome e preço.',
    '',
    'ENTREGA CARA EM PRODUTO BARATO: se a taxa da zona for mais de metade do preço do produto,',
    'apresenta as DUAS opções na mesma mensagem — entrega ao domicílio E levantamento grátis no armazém do Kilamba —',
    'em vez de esperar que o cliente reclame do valor.',
    '',
    'CLIENTE QUE JÁ FALOU CONTIGO (vês o histórico acima):',
    '- NÃO recomeces do zero nem repitas a lista toda. Cumprimenta como quem já o conhece e RETOMA onde ficaram:',
    '  "Olá de novo! 😊 Da última vez estavas a ver o <produto>. Ainda queres esse ou preferes ver outra coisa?"',
    '- Se ele repetir a frase padrão do anúncio ("posso saber mais informações sobre isto?"), é porque voltou a clicar —',
    '  não é um cliente novo. Refere o que já tinham falado.',
    '',
    'MODELO EXACTO — 12 Pro ≠ 12 Pro Max ≠ 12:',
    '- "Pro", "Pro Max", "Plus", "Mini" e o número são modelos DIFERENTES. Uma capa do modelo errado não serve e volta para trás.',
    '- Se o cliente pedir um modelo que NÃO está no catálogo, diz claramente que não tens PARA ESSE e mostra o que tens,',
    '  avisando que é outro modelo ("tenho para o 12 Pro Max, mas não serve no 12 Pro"). Nunca ofereças o parecido como se servisse.',
    '- Se o cliente te CORRIGIR o modelo, aceita a correção à primeira. Repetir o modelo errado depois de corrigido perde o cliente.',
    '',
    // 1-Ago, Laidy Inês: o bot afirmou que o "Cabo ... Para Galaxy S24" era
    // "USB-C para Lightning (a entrada do iPhone)". A descrição só diz
    // "Carregador USB-C" — inventou a ponta, e contra o próprio nome do produto.
    'ESPECIFICAÇÕES QUE O CATÁLOGO NÃO TEM (pontas, comprimento, potência, cor, bateria):',
    '- Se houver FICHA TÉCNICA do produto mais abaixo, responde por ela — é para isso que existe.',
    '- FONES: cada um vem marcado [SEM FIO] ou [COM FIO] no catálogo. Agrupa e responde por ESSA marca, nunca pelo teu palpite — Bluetooth/TWS é SEM FIO por definição, nunca o listes como "com fio". Se a marca disser "tipo não indicado", di-lo honestamente em vez de escolheres um grupo.',
    '- Se a descrição não diz, NÃO inventes. Nem sequer deduzas a partir do nome.',
    '- Diz o que sabes ("é um cabo USB-C, para Galaxy S24") e oferece confirmar o resto com a equipa.',
    '- NUNCA afirmes uma ponta/compatibilidade que contrarie o nome do produto (um cabo "Para Galaxy" não é Lightning de iPhone).',
    '',
    // 3-Ago: um cliente escreveu em francês e levou resposta em português.
    'LÍNGUA: responde na MESMA língua em que o cliente escreveu (francês, inglês, espanhol...).',
    'Se não dominares, usa português simples e pergunta se prefere outra língua — mas nunca ignores que ele não escreveu em português.',
    '',
    // 4-Ago, Joel Bengui: 4 mensagens, combinou "aguardarei por si amanhã" e o
    // bot ainda não sabia QUE PRODUTO ele queria. Ele julga que está tratado.
    'NÃO FECHES ENTREGA SEM PRODUTO: antes de confirmar dia, hora ou levantamento, tens de saber QUAL o produto.',
    'Se o cliente marcar um encontro sem ter escolhido, diz-lho de forma directa na MESMA mensagem:',
    '"Combinado — só preciso de saber qual queres para deixar preparado." Nunca deixes o cliente sair a pensar que está tratado quando não está.',
    '',
    'OBJEÇÃO DE CONFIANÇA ("é muito barato", "já me correu mal", "isso é original?", "funciona mesmo?"):',
    '- NÃO respondas "vou confirmar". O cliente não quer dados — quer garantia de que não é enganado.',
    '- Responde com o que a loja REALMENTE oferece e que resolve o medo dele:',
    '  só pagas quando recebes (não pagas nada adiantado) · tens 1 dia depois de receber para testar · se não estiver bem, trocamos.',
    '- Só depois disso é que perguntas qual quer. Nunca prometas nada além disto.',
    '',
    // 30-Jul, Catarina Sabalo: "Aceitou 4mil" — era uma ENTREGADORA/revendedora a
    // falar do cliente dela, e o bot tratou-a como compradora. Deu 4 mensagens de
    // confusão mútua (chegou a explicar-lhe que a mensagem citada era dele próprio).
    'QUEM NÃO É O COMPRADOR (entregador, revendedor, alguém a agir por outra pessoa) — PARA TUDO:',
    '- Sinais: "aceitou X mil", "o cliente quer/pediu", "vou entregar", "é para um cliente meu", "quanto fica para revender",',
    '  "estou a entregar", "o comprador disse", ou qualquer valor combinado por ti que não seja o preço do catálogo.',
    '- NÃO recolhas dados de entrega, NÃO confirmes valores, NÃO organizes nada. Não sabes quem é esta pessoa nem',
    '  que acordo tem com a loja — combinações com entregadores e preços de revenda são decisão EXCLUSIVA do dono.',
    '- Responde com EDUCAÇÃO e sem acusar (pode ser um parceiro nosso): agradece, explica que combinações de entrega e',
    '  revenda são tratadas pela equipa, e diz que já vais chamar alguém. Nada de "tu não és o comprador".',
    '  TERMINA obrigatoriamente com: <<HUMANO>>revenda/entrega — só o dono decide<<FIM>>',
    '- Excepção: um cliente a comprar para SI que diz "amanhã levanto" ou "vou buscar" é comprador normal — continua normalmente.',
    '',
    // A promoção vem de um ficheiro que SÓ o dono edita. Ficheiro vazio (o
    // estado normal) = não existe promoção, e o bot tem de o dizer assim.
    (function () {
      const p = promocaoAtiva();
      return p
        ? 'PROMOÇÃO A DECORRER (autorizada pelo dono — diz EXACTAMENTE isto, não acrescentes nada):\n"' + p.texto + '"'
        : 'NÃO HÁ PROMOÇÃO NENHUMA a decorrer. Se o cliente pedir desconto, diz com simpatia que o preço é fixo ' +
          'e realça o que a loja dá de verdade: pagas na entrega, 1 dia para verificar, troca se houver problema. NUNCA inventes descontos.';
    })(),
    '',
    'CATÁLOGO ACTUAL (nome: preço) — usa SÓ estes; nunca inventes produtos ou preços:',
    catalogText || '(catálogo indisponível de momento — pede ao cliente o nome do produto)',
    blocoCampanha(senderId),            // ← o que está no anúncio agora (cliente diz "isto") + CTA rotativo
    blocoMostrados(senderId),           // ← o que ESTE cliente já viu (para "quero esse")
    perfilClientes.bloco(senderId),     // ← memória de quem volta (zona, modelo, interesses — só o que ELE disse)
    blocoFichas(senderId, msgTexto),    // ← fichas técnicas dos produtos em conversa (investigador + web)
    knowledgePromptBlock(),
    deliveryZones.promptBlock(),
    'REGRAS:',
    // Esta regra vivia DENTRO do bloco do anúncio — que desaparece quando o
    // campanha-ativa.json fica velho. Resultado: 7+ clientes voltaram a ouvir
    // "não consigo ver a publicação" exactamente quando o bloco faltava.
    // Agora é incondicional: com ou sem lista do anúncio, esta frase nunca sai.
    '- Se o cliente disser "isto/isso/quero mais informações" sem nomear produto, veio de um anúncio ou publicação nossa.',
    '  NUNCA digas "não consigo ver a publicação" nem parecido. Se tens a lista do anúncio acima, usa-a;',
    '  se não tens, mostra 2-3 produtos populares do catálogo (fones, cabos, capas) e pergunta qual procura.',
    // SOFTECANGOLA (30-Jul): foto de produto com legenda "Olá tem esse artigo?" —
    // o bot respondeu às cegas. Agora o bridge DESCARREGA a foto (visão real);
    // este marcador só aparece quando o download falhou.
    '- Se a mensagem disser "[o cliente enviou uma FOTO que nao consegues ver...": o download da foto falhou.',
    '  É quase sempre a foto de um PRODUTO (do nosso anúncio ou de outra loja). Sê honesto ("a foto não me chegou',
    '  bem") e usa a legenda + a lista do anúncio para adivinhar: mostra os 2-3 produtos mais prováveis com nome',
    '  completo e preço, e pergunta se é um deles. Nunca digas só "não sei o que é".',
    '- Se a mensagem disser "[o cliente enviou esta FOTO...": a imagem VEM ANEXADA — olha-a e segue as regras de',
    '  "CLIENTE ENVIOU FOTO" abaixo (identificar no catálogo, dar nome completo e preço).',
    '- NUNCA uses markdown (**negrito**, __itálico__, listas com #). Isto é chat: o cliente vê os asteriscos crus. Escreve texto simples.',
    '- Se perguntam preço/disponibilidade de algo no catálogo, responde com o preço real.',
    '- Se enviarem uma FOTO de um produto: identifica-o e PROCURA no catálogo. Se tivermos igual/parecido, dá o nome e o PREÇO real e oferece enviar a foto. Diz sempre o preço quando o produto existe.',
    '- Nunca prometas o que não podes cumprir. Sê honesto se não souberes.',
    '',
    'PRODUTO QUE NÃO TEMOS (por texto OU por foto):',
    '- IMPORTANTE: só regista desejo se for um TIPO de produto que realmente não vendemos (ex: drones, frigoríficos). Se tens equivalentes no catálogo (mesmo tipo: fones, cabos, capas, colunas...), MOSTRA-OS com preço em vez de dizer que não temos.',
    // 10-Ago, Buanda da Silva: pediu microfone COM FIO PARA PC. O catálogo só
    // tem "Microfone sem fio para celular". A regra de cima ("mesmo tipo →
    // mostra em vez de dizer que não temos") tratou-os como o mesmo produto: o
    // bot mostrou o de telemóvel e só dois turnos depois é que admitiu que não
    // servia. Pelo meio disse "vou confirmar" duas vezes, o disjuntor calou-o e
    // o dono teve de assumir a conversa às 21h15. MESMO TIPO NÃO É MESMO USO.
    '- ⚠️ MESMO TIPO ≠ MESMO USO. Se o que temos serve para OUTRA COISA (microfone de telemóvel quando pedem para PC, cabo de Android quando pedem de iPhone, coluna pequena quando pedem para festa), NÃO é "temos". Diz as três coisas NA MESMA mensagem, sem rodeios: (1) o que temos, com nome e preço; (2) que esse é para outro uso e por isso não te serve; (3) se queres que encomendemos o certo.',
    '- ⛔ Nunca respondas em geral ("temos vários modelos", "temos a partir de X") quando o cliente perguntou por um produto concreto. Nomeia o produto do catálogo, com o preço, ou diz que não temos esse. Uma resposta vaga faz o cliente desaparecer.',
    '- Se for mesmo algo que não vendemos: sê honesto (não temos), oferece alternativa se houver, e TERMINA com a linha oculta: <<DESEJO>>nome do produto<<FIM>>',
    '- Se o cliente pedir um produto que TEMOS mas está ESGOTADO (sem stock): diz que esgotou e que avisas quando voltar, e TERMINA com: <<DESEJO>>nome do produto | esgotado<<FIM>>',
    '- Se o cliente pedir um MODELO/marca específica que não temos (mesmo tendo o tipo): mostra o equivalente E regista: <<DESEJO>>modelo pedido<<FIM>>',
    '- OFERECE SEMPRE ENCOMENDAR: depois de dizeres que não temos, pergunta se ele prefere que ENCOMENDEMOS. Confirmado pelo dono (10-Ago). As encomendas levam um SINAL adiantado.',
    '- ⛔ NUNCA digas quanto tempo demora uma encomenda, nem o valor do sinal. Não sabes, e inventar prazo já custou vendas. Quem diz isso é o dono.',
    '- Se o cliente ACEITAR encomendar (ou perguntar prazo/valor): NÃO prometas nada — TERMINA com <<HUMANO>><<FIM>> para o dono assumir e dar as condições. Uma vez só; não repitas "vou confirmar".',
    '',
    'CLIENTE ENVIOU FOTO (visão AISA):',
    '- Olha a imagem. Identifica o produto (é o que ele procura).',
    '- OBRIGATÓRIO: mostra SEMPRE preço real e mete <<FOTO>> do produto identificado <<FIM>>.',
    '- Se tens equivalente idêntico ou compatível no catálogo: oferece directamente com preço (não perguntes "qual é o teu aparelho?").',
    '- SÓ faz uma pergunta de clarificação se houver AMBÍGUIDADE real entre 2 ou mais produtos do catálogo (ex: adaptador HDMI pode ser USB-C+HDMI ou USB-A+HDMI — pergunta UMA vez fechada, não aberta).',
    '- Termina com CTA de fechar venda: "Confirma bairro que te entrego?"',
    '',
    'ENVIAR FOTOS — REGRA OBRIGATÓRIA (NUNCA repitas a oferta sem enviar):',
    '- SEMPRE que mencionares um produto do catálogo e deres o preço, TERMINA com a linha oculta para enviar a foto:',
    '  <<FOTO>>nome exacto do produto do catálogo<<FIM>>',
    '- Esta regra vale mesmo se o cliente só disse "fone", "tem fones?", "quero ver", "quanto custa?" — se vais listar produtos COM PREÇO, anexa sempre a foto.',
    '- Se listares 3 produtos: mete 3 marcadores (um por produto). Limite: 3 fotos por mensagem (<<FOTO>> × 3).',
    '- Quando o cliente identifica o produto do ANÚNCIO actual (via blocoCampanha acima), o <<FOTO>> é OBRIGATÓRIO na primeira resposta — não fales dos fones sem enviar a foto.',
    '- Como: "Já te mando as fotos! 📸" seguido do marcador.',
    '- As fotos que envias LEVAM LEGENDA com nome e preço — por isso quando o cliente',
    '  responde a uma foto, a legenda citada aparece na mensagem dele: usa-a para saber qual é.',
    '',
    'O CLIENTE DIZ "QUERO ESSE" / "É ESSE" / "O PRIMEIRO" / responde a uma foto:',
    '- NÃO reenvies fotos nem repitas a lista. Olha a lista "PRODUTOS QUE JÁ MOSTRASTE"',
    '  acima e o texto citado na mensagem dele, e identifica o produto.',
    '- Se ficares com dúvida entre 2 ou 3, pergunta UMA vez de forma fechada e numerada',
    '  (ex: "É o 1 (Bluetooth 11.500) ou o 2 (Mini 8.000)?") — nunca com pergunta aberta.',
    '- Assim que souberes qual é, AVANÇA: confirma o produto e pede a morada para calcular a entrega.',
    '',
    'LINKS (nunca dês só o número — dá links clicáveis):',
    (logConversation._platform === 'whatsapp'
      ? '- Esta conversa JÁ é no WhatsApp: NUNCA mandes o link do WhatsApp (o cliente já cá está — fica ridículo). Fecha a venda AQUI. Para mais produtos partilha só o site: ' + SITE
      : '- Para fechar no WhatsApp usa o link directo: ' + WA_LINK + ' (podes acrescentar o produto).\n- Para ver mais produtos, partilha o site: ' + SITE),
    '',
    'FECHAR ENCOMENDA (importante — fecha a venda AQUI mesmo, não mandes para outro lado):',
    '- Quando o cliente quer comprar, recolhe com naturalidade (1-2 dados de cada vez, sem parecer formulário):',
    '  1) Nome completo  2) Morada/rua + bairro (para entrega em Luanda)  3) Número de telefone  4) Produto(s) e quantidade.',
    '- Confirma os itens e o total antes de fechar.',
    '- Quando tiveres TUDO (nome+morada+telefone+itens), agradece e diz que a encomenda foi registada e que a equipa vai ligar a confirmar. E TERMINA a tua mensagem com esta linha OCULTA (será removida antes de chegar ao cliente):',
    '  <<PEDIDO>>{"nome":"...","morada":"...","telefone":"...","itens":"...","total":"...","plataforma":"messenger|instagram"}<<FIM>>',
    '',
    'ENVIAR CATÁLOGO PDF (quando o cliente pede "catálogo", "lista de produtos", "o que têm", "manda tudo", "preços"):',
    '- Diz que vais enviar o catálogo em PDF (ex: "já te envio o nosso catálogo completo! 📄") e TERMINA com a linha oculta:',
    '  <<CATALOGO>>{"categoria":"opcional se pediu só uma categoria","filtro":"opcional palavra-chave ex fones"}<<FIM>>',
    '- Se o cliente pediu só um tipo (ex "catálogo de capas"), põe isso em filtro. Catálogo geral: <<CATALOGO>>{}<<FIM>>',
    '',
    'DÚVIDA FACTUAL/DE NEGÓCIO que não sabes responder (garantia, factura, compatibilidade, prazos, política...):',
    '- NÃO inventes. Diz ao cliente com naturalidade que vais confirmar já e voltas com a resposta certa, e TERMINA com esta linha oculta (o nosso sistema consulta e aprende a resposta):',
    '  <<CONSULTAR>>a pergunta exacta do cliente<<FIM>>',
    '- Usa isto só para o que REALMENTE não sabes — não para preços/produtos do catálogo (esses já sabes).',
    // 10-Ago, Buanda: o bot consultou DUAS vezes sobre o mesmo microfone que
    // ele próprio já tinha nomeado e cotado. À segunda, o disjuntor pausou-o 1h
    // e o cliente ficou a falar para o vazio. Consultar sobre o que já se sabe
    // é a forma mais cara de não responder.
    '- ⛔ UMA VEZ SÓ por assunto. Se já nomeaste e cotaste um produto nesta conversa, NÃO abras consulta sobre esse mesmo produto — remata com o que sabes e diz claramente o que não sabes. Repetir "vou confirmar" faz o sistema calar-te e o cliente fica à espera.',
    '- Se a dúvida é só "temos ou não temos", NUNCA consultes: o catálogo está aqui em cima e tu já tens a resposta.',
    '',
    'PEDIR AJUDA HUMANA (quando a conversa é complexa):',
    '- Se for reclamação séria, negociação de preço, ou o cliente está irritado/confuso, diz ao cliente que vais chamar um colega e TERMINA com esta linha oculta:',
    '  <<HUMANO>>razão curta<<FIM>>',
    // 13-Ago, Feliciano Pascoal: depois de escalar, o bot disse "já estou aqui
    // com o responsável" e "o dono já está a confirmar contigo" — mentiras, seis
    // promessas em 20 min, cliente furioso. O dono foi avisado UMA vez e chega.
    '- ⛔ DEPOIS de escalares: a ÚNICA verdade é "o dono já foi avisado e responde-te logo que puder". NUNCA digas que ele "já vem", "está aqui" ou "está a confirmar" — não sabes onde ele está, e inventar a presença dele já deixou um cliente furioso 30 minutos à espera de ninguém.',
    '- Se o cliente insistir na demora: pede desculpa UMA vez, diz com honestidade que pode demorar um pouco, e pede o contacto/pedido dele para o dono responder directo. NÃO voltes a escalar nem a prometer que alguém vem já.',
    '',
    'CLIENTE DIZ QUE COMPRA DEPOIS (importante — nunca percas esta venda):',
    '- Se o cliente disser que compra mais tarde ("depois compro", "no sábado", "fim do mês", "quando receber o salário", "amanhã passo aí", "para a semana"...), responde com simpatia ("combinado, fico à tua espera!") e TERMINA com esta linha oculta:',
    '  <<DEPOIS>>{"quando":"AAAA-MM-DD","nota":"o que o cliente disse","produto":"produto de interesse ou vazio"}<<FIM>>',
    '- Calcula a data real a partir de HOJE: "sábado" = o próximo sábado; "fim do mês" = último dia deste mês; "quando receber/salário" = dia 1 do próximo mês; vago ("depois", "logo vejo") = daqui a 3 dias.',
    '- A data tem de ser FUTURA e no formato AAAA-MM-DD. Não perguntes a data ao cliente — estima tu.'
  ].join('\n');
}

// Destila a FAQ/tom das conversas reais + respostas humanas do dono (usa AISA)
async function learnFromConversations() {
  const cfg = loadAIConfig();
  if (!cfg.apiKey) throw new Error('IA sem chave');
  const convos = loadJSON(CONVERSATIONS_LOG).filter(c =>
    c.userMessage && c.userMessage !== '[imagem]' &&
    !c.userMessage.startsWith('[o cliente enviou'));   // placeholder de áudio/foto: não é pergunta real
  const training = loadJSON(TRAINING_LOG);
  if (convos.length < 3 && training.length < 1) throw new Error('Poucos dados para aprender (' + convos.length + ' conversas)');
  // Sem conversas NOVAS desde a última destilação: não gastar AISA nem agitar a
  // FAQ (reescrever com os mesmos dados dava churn 13↔14 e apagava nuances).
  // A mensagem casa com /Poucos dados/ do cron → silêncio no WhatsApp.
  const ultimaTs = convos.length ? convos[convos.length - 1].timestamp : '';
  const prev = loadKnowledge();
  if (prev && prev.ultimaConversa === ultimaTs && (prev.baseadoEm || {}).conversas === convos.length) {
    throw new Error('Poucos dados novos — nada mudou desde a última aprendizagem');
  }
  const convDesc = convos.slice(-60).map(c =>
    'CLIENTE (' + (c.platform || '?') + '): ' + c.userMessage +
    '\nBOT' + (c.entregue === false ? ' (NÃO ENTREGUE — o cliente nunca viu esta resposta)' : '') + ': ' +
    String(c.botResponse || '').replace(/\s+/g, ' ').slice(0, 120)).join('\n');
  const humanDesc = training.slice(-40).map(t => 'PERGUNTA: ' + (t.pergunta || '?') + '\nDONO RESPONDEU: ' + t.respostaHumana).join('\n');
  const text = await aiChat(cfg, [{
    role: 'user',
    content: 'És analista de atendimento da SuperLoja (Luanda). A partir das conversas reais e das respostas que o DONO deu à mão, cria um manual de FAQ para o bot responder sozinho como o dono responderia.\n\n' +
      'CONVERSAS RECENTES:\n' + convDesc + '\n\n' +
      'RESPOSTAS REAIS DO DONO (imita este estilo e substância):\n' + (humanDesc || '(ainda nenhuma)') + '\n\n' +
      'Responde APENAS JSON: {"faq":[{"pergunta":"...","resposta":"..."}],"tom":"1 frase sobre o estilo do dono","evitar":["..."],' +
      '"ideiasVenda":["até 2 ideias de VENDA que as conversas sugerem (produto muito pedido, objeção repetida, oportunidade concreta), máx 140 chars cada; [] se nada de novo"],' +
      '"procuradosSemTer":["produtos CONCRETOS que clientes pediram e a loja NÃO tinha (ou estava esgotado) — só nomes de produto, [] se nenhum"]} — 8-15 FAQ, respostas curtas em pt-Angola, concretas (preços/produtos/entrega reais que aparecem nas conversas).'
  }], 1600);
  let data;
  try { data = JSON.parse(text.trim().replace(/```json|```/g, '').trim()); }
  catch { throw new Error('IA devolveu formato inválido'); }
  // PRESERVAR o que o Hermes/dono ensinou (fonte:'hermes'): a destilação
  // reescreve a FAQ a partir das conversas e APAGAVA os ensinamentos manuais
  // (factos de negócio confirmados: garantia, factura, troca...). Esses são
  // curados — ganham sempre; a IA só renova o resto.
  const anterior = loadKnowledge() || {};
  // Preserva-se tudo o que foi ENSINADO (não destilado): consultas respondidas
  // pelo Hermes, factos confirmados pelo dono, correcções do Claude Code.
  // 13-Ago: o filtro era `fonte === 'hermes'` À LETRA e a resposta do microfone
  // CONFIRMADA PELO DONO (fonte "dono (13-Ago) via claude-code") foi deitada
  // fora na re-destilação seguinte — um facto do dono não pode valer menos que
  // uma resposta do agente.
  const ensinados = (anterior.faq || []).filter(f => f.fonte && /hermes|dono|claude|ensinad/i.test(String(f.fonte)));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9À-ſ ]/gi, '').trim();
  const jaEnsinado = new Set(ensinados.map(f => norm(f.pergunta)));
  // ⚠️ O BOT APRENDE DAS PRÓPRIAS RESPOSTAS — e por isso canoniza os próprios
  // erros. A resposta à pergunta MAIS FREQUENTE do negócio ("posso saber mais
  // informações sobre isto?") ficou gravada a terminar em "Qual destes te
  // interessa?" — o fecho que perdeu 45 clientes. Depois disso, nenhuma regra de
  // prompt vencia: a FAQ é um exemplo concreto e o modelo copia-o.
  // Filtro: nunca guardar como conhecimento uma resposta que fecha em aberto.
  // 13-Ago: o \s*\? exigia o "?" LOGO a seguir — "qual destes te interessa?",
  // a frase exacta que perdeu os 45 clientes e motivou este filtro, nunca
  // casava (tem "te interessa" pelo meio). Duas entradas com "qual destes te
  // servia?/queres?" viveram na FAQ curada por causa disto. Até 25 chars entre
  // o gatilho e o "?". Perguntas de ESPECIFICAÇÃO ("qual é o teu iPhone?") não
  // começam por "qual destes" e continuam a passar — essas são necessárias.
  const RE_FECHO_MAU = /(qual destes|qual deles|qual desses)[^?\n]{0,25}\?|o que (procuras|preferes)\s*\?/i;
  const limpas = (data.faq || []).filter(f => {
    if (!RE_FECHO_MAU.test(String(f.resposta || ''))) return true;
    log('INFO', '[APRENDER] descartada FAQ com fecho aberto: "' + String(f.pergunta).slice(0, 50) + '"');
    return false;
  });
  data.faq = [...ensinados, ...limpas.filter(f => !jaEnsinado.has(norm(f.pergunta)))].slice(0, 40);
  data.generatedAt = new Date().toISOString();
  data.baseadoEm = { conversas: convos.length, respostasHumanas: training.length, ensinadosPreservados: ensinados.length };
  data.ultimaConversa = ultimaTs;
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(data, null, 2), 'utf8');
  // Rede de segurança da LISTA DE INTERESSE: produtos procurados que a IA do chat
  // não marcou com <<DESEJO>> na hora. Só regista termos NOVOS (a destilação
  // reanalisa as mesmas conversas — sem este filtro duplicava contagens).
  try {
    const wlAtual = loadJSON(WISHLIST_LOG);
    for (const p of (data.procuradosSemTer || []).slice(0, 5)) {
      const nome = String(p || '').trim();
      // temas de FAQ não são produtos: a destilação registou "Entrega fora de
      // Luanda" e "Especificações de bateria" como desejos de compra
      // âncoras no INÍCIO do nome — "especifica" solto apanhava "Carregadores
      // de parede (nunca especificados)", que é um produto legítimo
      if (/^(entrega|especifica[çc]|garantia|prazo|pagamento|informa[çc]|d[úu]vida|hor[áa]rio)/i.test(nome) ||
          /entrega (fora|gr[áa]tis)|especifica[çc][õo]es de/i.test(nome)) continue;
      // por CONCEITO, não pela string: a destilação reanalisa as mesmas
      // conversas e re-frasea o mesmo pedido, o que enchia a lista de gémeos
      if (nome.length >= 3 && nome.length <= 80 && !acharDesejo(wlAtual, nome)) {
        recordWish(nome, null, 'distilacao');
      }
    }
  } catch (_) {}
  // Ideias de venda extraídas das conversas → Conselho de Vendas (dashboard :3333).
  // Best-effort: falhar aqui nunca pode partir a aprendizagem da FAQ.
  try {
    for (const ideia of (data.ideiasVenda || []).slice(0, 2)) {
      if (!ideia || String(ideia).trim().length < 15) continue;
      const body = JSON.stringify({ de: 'bot-loja', tipo: 'ideia', texto: String(ideia).slice(0, 300) });
      const r = require('http').request({ host: '127.0.0.1', port: 3333, path: '/api/conselho', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
      r.on('error', () => {});
      r.setTimeout(8000, () => r.destroy());
      r.write(body); r.end();
      log('INFO', '[CONSELHO] ideia do bot postada: ' + String(ideia).slice(0, 80));
    }
  } catch (_) {}
  return data;
}

// Histórico recente da conversa deste cliente (para o bot ter contexto)
function getHistory(senderId, maxTurns) {
  const convos = loadJSON(CONVERSATIONS_LOG).filter(c => c.senderId === senderId).slice(-(maxTurns || 6));
  const msgs = [];
  for (const c of convos) {
    if (c.userMessage) msgs.push({ role: 'user', content: c.userMessage });
    if (c.botResponse) msgs.push({ role: 'assistant', content: c.botResponse });
  }
  return msgs;
}

// O tipo REAL da imagem, lido dos primeiros bytes. Não se pode confiar no
// Content-Type do CDN nem no mime que o telemóvel declara: a API da Anthropic
// compara os bytes com o media_type e rejeita com HTTP 400 se discordarem.
// Aconteceu a um cliente real (Osvalfo, 30-Jul 07:57 — cabeçalho dizia PNG,
// bytes eram JPEG): ficou sem o preço do produto que fotografou.
function mimeReal(buf, fallback) {
  if (!buf || buf.length < 12) return fallback || 'image/jpeg';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return fallback || 'image/jpeg';   // desconhecido: a Anthropic só aceita estes 4
}

// Baixa uma imagem (URL do Messenger/produto) e devolve bloco base64 p/ visão
function fetchImageBlock(url) {
  return new Promise((resolve) => {
    try {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { // seguir redirect (CDN FB)
          return fetchImageBlock(r.headers.location).then(resolve);
        }
        const ch = []; let size = 0;
        r.on('data', c => { size += c.length; if (size < 5 * 1024 * 1024) ch.push(c); });
        r.on('end', () => {
          if (!ch.length) return resolve(null);
          const buf = Buffer.concat(ch);
          const ct = (r.headers['content-type'] || 'image/jpeg').split(';')[0];
          resolve({ type: 'image', source: { type: 'base64', media_type: mimeReal(buf, ct), data: buf.toString('base64') } });
        });
      }).on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

// ─── NOTAS DE VOZ: transcrever localmente ────────────────────────────────────
// Em Angola muita gente manda áudio em vez de escrever. Até aqui isso era uma
// venda perdida: no WhatsApp o bot pedia texto, no Messenger nem respondia.
// faster-whisper local (grátis, sem chave, a voz do cliente não sai da máquina).
const STT_PY = 'C:\\Users\\fox\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe';
const STT_SCRIPT = __dirname + '\\transcrever-audio.py';
// 'small' e nao 'base': medido com a mesma nota de voz de 9s —
//   base  (2.7s): "o pré-cudus fones Bluetooth. Vou seis entregão no quilamba"
//   small (3.8s): "o preço dos fones Bluetooth. Vocês entregam no Quilamba"
// O base destruía exactamente as palavras que decidem a venda (preço, entregam).
// +1.1s por 100% das palavras-chave certas é troca fácil.
const STT_MODELO = process.env.STT_MODELO || 'small';

function _descarregar(url, destino) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? require('http') : https;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return _descarregar(r.headers.location, destino).then(resolve, reject);
      }
      if (r.statusCode !== 200) return reject(new Error('HTTP ' + r.statusCode));
      const ch = []; let tam = 0;
      r.on('data', c => { tam += c.length; if (tam <= 12 * 1024 * 1024) ch.push(c); });
      r.on('end', () => {
        if (!ch.length) return reject(new Error('vazio'));
        fs.writeFileSync(destino, Buffer.concat(ch));
        resolve(destino);
      });
    }).on('error', reject);
  });
}

/**
 * Transcreve uma nota de voz. Aceita URL (Messenger/Instagram) ou Buffer
 * (WhatsApp, que chega do bridge em base64 — não há URL público).
 * Devolve o texto, ou null se não der. NUNCA lança: um áudio que não se
 * percebe tem de acabar em "escreve-me em texto", não numa conversa sem resposta.
 */
async function transcreverAudio(urlOuBuffer) {
  const tmp = require('os').tmpdir() + '\\sl-voz-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.ogg';
  try {
    if (Buffer.isBuffer(urlOuBuffer)) fs.writeFileSync(tmp, urlOuBuffer);
    else await _descarregar(String(urlOuBuffer), tmp);

    const texto = await new Promise((resolve) => {
      require('child_process').execFile(STT_PY, [STT_SCRIPT, tmp, STT_MODELO],
        { timeout: 90000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' },
        (e, stdout, stderr) => {
          if (e && !stdout) { log('WARN', '[ÁUDIO] transcrição falhou: ' + String((stderr || e.message)).slice(0, 120)); return resolve(null); }
          resolve(String(stdout || '').trim() || null);
        });
    });
    // uma transcrição de 2 letras é ruído, não uma pergunta
    return texto && texto.length >= 3 ? texto.slice(0, 600) : null;
  } catch (e) {
    log('WARN', '[ÁUDIO] ' + String(e.message).slice(0, 100));
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Chama a IA (AISA/OpenAI-compat) com system + histórico + mensagem actual
function aiChat(cfg, messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const isSakana = cfg.provider === 'sakana';
    const payload = { model: cfg.model || 'claude-haiku-4-5-20251001', messages };
    if (!isSakana) payload.max_tokens = maxTokens || 400;   // a Fugu rebenta com max_tokens
    const bodyBuf = Buffer.from(JSON.stringify(payload), 'utf8');
    // MiniMax (reserva do Hermes) fala Anthropic mas noutro host/prefixo
    const isMinimax = cfg.provider === 'minimax';
    const host = cfg.provider === 'openai' ? 'api.openai.com' : cfg.provider === 'aisa' ? 'api.aisa.one'
               : isSakana ? 'api.sakana.ai' : isMinimax ? 'api.minimax.io' : 'api.anthropic.com';
    const isOpenAIStyle = cfg.provider === 'openai' || cfg.provider === 'aisa' || isSakana;
    const headers = isOpenAIStyle
      ? { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + cfg.apiKey, 'Content-Length': bodyBuf.length }
      : { 'Content-Type': 'application/json; charset=utf-8', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': bodyBuf.length };
    const caminho = isOpenAIStyle ? '/v1/chat/completions' : (isMinimax ? '/anthropic/v1/messages' : '/v1/messages');
    const r = https.request({ hostname: host, path: caminho, method: 'POST', headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); // Buffer.concat: não parte multi-byte entre chunks
      res.on('error', reject);   // sem isto, um erro aqui não tem listener e MATA o processo do bot inteiro
      res.on('end', () => {
        const cru = Buffer.concat(chunks).toString('utf8');
        // O STATUS vem primeiro. A AISA devolveu 402 com {"error":"..."} e isso
        // apanhámos — mas um 402/429/5xx cujo corpo não traga a chave "error"
        // (ou venha em HTML de gateway) caía no `resolve(txt || '')` e o bot
        // respondia por padrões sem um único WARN. Pôr o código NA MENSAGEM é o
        // que faz semSaldoOuAuth (que casa /402/, /429/) accionar a reserva.
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let det = '';
          try { const j = JSON.parse(cru); det = (j.error && (j.error.message || j.error)) || j.message || ''; }
          catch { det = cru.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
          return reject(new Error('HTTP ' + res.statusCode + ' ' + String(det).slice(0, 160)));
        }
        try {
          const j = JSON.parse(cru);
          if (j.error) return reject(new Error(j.error.message || JSON.stringify(j.error)));
          // Acesso tolerante: a AISA é uma camada de tradução para o Claude
          // (fala Anthropic por trás de um endpoint OpenAI) e pode mudar de
          // forma numa actualização. `?.` para que uma forma estranha dê
          // undefined em vez de rebentar — um TypeError aqui não casava com
          // valePenaReserva e matava a cadeia toda.
          const bruto = isOpenAIStyle
            ? (j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text)
            : (j.content?.[0]?.text ?? j.content);
          // content pode vir como ARRAY de blocos: sem isto o array passava o
          // teste !txt, chegava intacto ao processMarkers e rebentava lá fora
          // do try/catch — o cliente do Messenger não recebia NADA, nem o
          // fallback, e o log só dizia "matchAll is not a function".
          const txt = Array.isArray(bruto)
            ? bruto.map(b => (typeof b === 'string' ? b : (b && (b.text || b.content)) || '')).filter(Boolean).join('\n').trim()
            : (typeof bruto === 'string' ? bruto : '');
          // 200 com forma inesperada: rejeitar em vez de devolver '' — assim
          // fica no log e tem chance de reserva, em vez de morrer em silêncio
          if (!txt) return reject(new Error('resposta sem texto utilizavel de ' + cfg.provider));
          resolve(txt);
        } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.setTimeout(isSakana ? 90000 : 45000, () => r.destroy(new Error('timeout IA')));
    r.write(bodyBuf); r.end();
  });
}

// CADEIA DE RESERVA (29-Jul: a carteira da AISA esgotou — HTTP 402 — e o bot
// passou horas a responder "não percebi" a clientes que vinham do anúncio pago).
// Ordem por rapidez/custo, e cada uma com CARTEIRA DIFERENTE (é isso que salva):
//   1. AISA/Haiku    principal — rápida e barata
//   2. MiniMax        reserva do Hermes (chave dele, ~1.8s) — carteira separada
//   3. Sakana/Fugu    último recurso — lenta e caríssima, mas quase nunca falha
// Só depois disto é que se cai no fallback por padrões (respostas genéricas).
function semSaldoOuAuth(err) {
  const m = String((err && err.message) || err || '').toLowerCase();
  return /insufficient|wallet|balance|quota|credit|billing|payment|401|402|403|invalid api key|unauthor|rate.?limit|429/.test(m);
}
// Vale a pena tentar outra carteira? Saldo/auth (a razão original), mas também
// 5xx do provedor, resposta inutilizável, 4xx e falhas de rede. O TIMEOUT fica
// de fora de propósito: 45s da AISA + a reserva era esperar demasiado com o
// cliente à espera. Tudo o resto falha DEPRESSA, logo a reserva ainda cabe.
//
// 11-Ago: a lista era só saldo/5xx e por isso a cadeia foi SALTADA nas duas
// únicas vezes que teve oportunidade de correr — chatbot.log 30-Jul 07:57 e
// 07-Ago 13:27, ambas 'HTTP 400 ... image'. A MiniMax estava viva as duas vezes.
// Em Luanda um corte de rede (ENOTFOUND/ECONNRESET) é banal e também não casava.
function valePenaReserva(err) {
  const m = String((err && err.message) || err || '').toLowerCase();
  return semSaldoOuAuth(err) ||
    /http [45]\d\d|sem texto utilizavel|bad gateway|service unavailable/.test(m) ||
    /econnreset|enotfound|etimedout|econnrefused|socket hang up|epipe|certificate/.test(m);
}
// Avisar o dono — com a VERDADE do que aconteceu. Antes, a mensagem saía ANTES
// de qualquer reserva ser tentada e dizia "continua a atender os clientes";
// se as reservas também falhassem, o dono ficava descansado com o bot mudo.
// Regra: se ninguém salvou, avisa SEMPRE (o cliente está a levar resposta
// genérica agora). Se a reserva salvou, só avisa se for carteira/chave — que é
// o que ele tem de ir resolver; um 5xx passageiro não vale uma notificação.
function avisarFalhaIA(provider, err, reservaQueSalvou) {
  const chave = reservaQueSalvou ? 'salvo' : 'sem-resposta';
  if (reservaQueSalvou && !semSaldoOuAuth(err)) return;   // 5xx passageiro que a reserva cobriu: silêncio
  avisarFalhaIA._ate = avisarFalhaIA._ate || {};
  if (avisarFalhaIA._ate[chave] > Date.now()) return;
  avisarFalhaIA._ate[chave] = Date.now() + 6 * 3600000;
  const motivo = String((err && err.message) || err || '').slice(0, 80);
  try {
    notifyCarlos(reservaQueSalvou
      ? '⚠️ *IA principal do bot indisponível*\n' + provider + ': "' + motivo + '"\n' +
        'O bot está a responder pela reserva (' + reservaQueSalvou + ') — continua a atender os clientes.\n\n' +
        '👉 Verifica o saldo em console.aisa.one.'
      : '🚨 *O bot está a dar respostas genéricas AGORA*\n' + provider + ': "' + motivo + '"\n' +
        'Nenhuma reserva conseguiu responder. Os clientes estão a receber a resposta de recurso.');
  } catch (_) {}
}
function chaveMinimaxDoHermes() {
  try {
    const env = fs.readFileSync('C:/Users/fox/.hermes/.env', 'utf8');
    const m = env.match(/^MINIMAX_API_KEY=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}
async function aiChatComReserva(cfg, messages, maxTokens) {
  const reservas = [];
  const minimax = chaveMinimaxDoHermes();
  if (minimax) reservas.push({ nome: 'MiniMax (Hermes)', cfg: { provider: 'minimax', apiKey: minimax, model: 'MiniMax-M3' } });
  const sakana = (process.env.SAKANA_API_KEY || '').trim();
  if (sakana) reservas.push({ nome: 'Sakana/Fugu', cfg: { provider: 'sakana', apiKey: sakana, model: process.env.SAKANA_MODEL || 'fugu' } });

  try {
    return await aiChat(cfg, messages, maxTokens);
  } catch (e) {
    if (!valePenaReserva(e) || !reservas.length) { avisarFalhaIA(cfg.provider, e, null); throw e; }
    log('WARN', `[IA] ${cfg.provider} indisponível (${String(e.message).slice(0, 45)}) — a tentar reservas`);
    let ultimo = e;
    for (const r of reservas) {
      try {
        const txt = await aiChat(r.cfg, messages, maxTokens);
        log('INFO', `[IA] resposta pela reserva: ${r.nome}`);
        avisarFalhaIA(cfg.provider, e, r.nome);   // depois de saber que salvou, não antes
        return txt;
      } catch (e2) { ultimo = e2; log('WARN', `[IA] reserva ${r.nome} falhou: ${String(e2.message).slice(0, 60)}`); }
    }
    avisarFalhaIA(cfg.provider, e, null);
    throw ultimo;
  }
}

// Resposta humana com IA: contexto + catálogo + visão. Devolve null se IA indisponível.
async function aiReply(senderId, messageText, imageUrls) {
  const cfg = loadAIConfig();
  if (!cfg.apiKey) return null;
  const cat = await fetchCatalog();
  const messages = [{ role: 'system', content: buildSystemPrompt(cat.text, senderId, messageText) }];
  for (const m of getHistory(senderId, 6)) messages.push(m);
  // mensagem actual (texto + imagens)
  const blocks = [];
  if (messageText) blocks.push({ type: 'text', text: messageText });
  for (const u of (imageUrls || []).slice(0, 3)) {
    // string = URL para descarregar (Messenger); objecto = bloco já pronto
    // (WhatsApp: o bridge entrega a imagem em base64, não há URL público)
    const b = (u && typeof u === 'object') ? u : await fetchImageBlock(u);
    if (b) blocks.push(b);
  }
  if (!blocks.length) blocks.push({ type: 'text', text: '(cliente enviou uma mensagem sem texto)' });
  // se só há texto, manda string simples; se há imagem, manda array de blocos
  messages.push({ role: 'user', content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks });
  return await aiChatComReserva(cfg, messages, 400);   // ← reserva se a AISA ficar sem saldo
}

// ─── Comentários em posts (FB feed + IG) ──────────────────────────────────────
const PAGE_ID_SELF = process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '';
const processedComments = new Map();
function commentSeen(id) {
  if (!id) return true;
  const now = Date.now();
  for (const [k, t] of processedComments) if (now - t > 30 * 60 * 1000) processedComments.delete(k);
  if (processedComments.has(id)) return true;
  processedComments.set(id, now); return false;
}
// Responder publicamente a um comentário (FB: /{id}/comments ; IG: /{id}/replies)
function replyToComment(commentId, message, platform) {
  return new Promise((resolve) => {
    const path = platform === 'instagram' ? `/v21.0/${commentId}/replies` : `/v21.0/${commentId}/comments`;
    const body = Buffer.from('message=' + encodeURIComponent(message) + '&access_token=' + PAGE_ACCESS_TOKEN, 'utf8');
    const req = https.request({ hostname: 'graph.facebook.com', path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); if (j.error) log('WARN', 'replyComment: ' + j.error.message); resolve(!!j.id); } catch { resolve(false); } }); });
    req.on('error', () => resolve(false)); req.write(body); req.end();
  });
}
// Resposta PRIVADA a um comentário (abre DM com quem comentou) — só FB
function privateReply(commentId, message) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ recipient: { comment_id: commentId }, message: { text: message } }), 'utf8');
    const req = https.request({ hostname: 'graph.facebook.com', path: `/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { res.on('data', () => {}); res.on('end', () => resolve(true)); });
    req.on('error', () => resolve(false)); req.write(body); req.end();
  });
}
// Gera resposta curta e pública a um comentário (usa catálogo)
async function aiCommentReply(text) {
  const cfg = loadAIConfig();
  if (!cfg.apiKey) return null;
  const cat = await fetchCatalog();
  const sys = 'És a SuperLoja (Luanda). Responde a um COMENTÁRIO público num post, de forma MUITO curta (1 frase), simpática, pt-Angola. Se perguntam preço/produto e está no catálogo, dá o preço. Convida a mandar DM ou WhatsApp ' + WA_LINK + ' para encomendar. Catálogo:\\n' + (cat.text || '') +
    '\n\nREGRA NÚMEROS: NUNCA inventes, modifiques ou uses placeholders (X, 9X, XXX, etc.) para o número de WhatsApp. O número real e único é +244 954 949 595 (wa.me/244954949595). Se algum dia precisares do teu próprio contacto, usa EXACTAMENTE este.';
  // com reserva: um comentário num post PATROCINADO é tráfego pago. Se a AISA
  // ficar sem saldo, sem isto todos os comentários caíam no texto enlatado.
  try { return await aiChatComReserva(cfg, [{ role: 'system', content: sys }, { role: 'user', content: text || '(comentário sem texto)' }], 150); }
  catch { return null; }
}
async function handleComment(commentId, text, fromId, platform) {
  if (commentSeen(commentId)) return;
  if (fromId && String(fromId) === String(PAGE_ID_SELF)) return; // ignora comentários da própria página
  let reply = await aiCommentReply(text);
  // GUARDA anti-alucinação — aqui é MAIS crítico que na DM: o comentário fica
  // PÚBLICO por baixo do post e no Instagram a Meta não deixa editar por API.
  // Foi esta superfície que publicou um número de WhatsApp inventado em 7 posts
  // (22-25 Jul). O prompt do aiCommentReply já pede para não inventar — a lei 4
  // diz que isso não chega, a guarda tem de correr por cima.
  if (reply) {
    try {
      reply = textGuard.sanitizarTexto(reply, {
        onRemove: (motivo, frase) => log('WARN', '[GUARDA] removido do comentário (' + motivo + '): ' + String(frase).slice(0, 70))
      });
    } catch (_) {}
  }
  // a guarda pode esvaziar a frase toda (era 1 frase só) — e um comentário
  // vazio é rejeitado pelo Graph API: cair no texto seguro.
  if (!reply || !reply.trim()) reply = 'Olá! 👋 Obrigado pelo comentário! Manda-nos DM ou WhatsApp ' + WA_LINK + ' que ajudamos já. 🛍️';
  const ok = await replyToComment(commentId, reply, platform);
  if (platform !== 'instagram') { await privateReply(commentId, 'Olá! 👋 Vi o teu comentário. Como te posso ajudar? Diz-me o produto e trato de tudo! 🛍️'); }
  log('INFO', `💬 Comentário (${platform}) respondido: "${String(text||'').slice(0,30)}" → ${ok ? 'ok' : 'falhou'}`);
  // regista como conversa (para o CRM/aprendizagem)
  logConversation._platform = platform + '-comentario';
  logConversation('comment_' + fromId, 'Comentário', text || '[comentário]', 'comment', reply);
}

// ─── Acção de remetente: "visto" + "a escrever…" (toque humano) ───────────────
function sendAction(recipientId, action) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ recipient: { id: recipientId }, sender_action: action }), 'utf8');
    const req = https.request({ hostname: 'graph.facebook.com', path: `/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } },
      res => { res.on('data', () => {}); res.on('end', () => resolve(true)); });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

// ─── Intent Classification ───────────────────────────────────────────────────
function classifyIntent(text) {
  text = text.toLowerCase().trim();
  
  // Purchase intent
  if (/quanto|preço|custa|comprar|quero|pedir|encomendar|disponível|stock|tem/i.test(text)) {
    return { intent: 'purchase', confidence: 0.9 };
  }
  
  // Question/help
  if (/como|qual|pode|ajuda|sabe|info|info|função|serve/i.test(text)) {
    return { intent: 'question', confidence: 0.85 };
  }
  
  // Complaint/issue
  if (/problema|defeito|quebrado|não funciona|ruim|pior|não gosto|reclamação/i.test(text)) {
    return { intent: 'complaint', confidence: 0.9 };
  }
  
  // Greeting
  if (/oi|olá|opa|e aí|hey|sup/i.test(text)) {
    return { intent: 'greeting', confidence: 0.95 };
  }
  
  // Default
  return { intent: 'unknown', confidence: 0.5 };
}

// ─── Generate Response ───────────────────────────────────────────────────────
function generateResponse(intent, senderName = 'Cliente') {
  const responses = {
    greeting: [
      `Olá ${senderName}! 👋 Bem-vindo à SuperLoja. Em que posso ajudar?`,
      `Olá! Tudo bem? 😊 Aqui é a SuperLoja. Queres saber de algum produto?`,
    ],
    purchase: [
      `Boa! 🛍️ Que produto procuras? Temos fones, cabos, adaptadores, capas e muito mais.\n\n📱 Vê o catálogo: ${SITE}`,
      `Boa escolha! 💰 Diz-me qual é o produto e digo-te já o preço e a entrega.`,
    ],
    question: [
      `Claro! 📖 Faz lá a tua pergunta que eu ajudo.`,
      `Com todo o gosto! 🤝 O que queres saber?`,
    ],
    complaint: [
      `Lamento muito! 😟 Quero resolver isso. Podes contar-me o que aconteceu?\n\n📞 Se preferires falar directamente: ${WA_LINK}`,
      `Peço desculpa! 😔 Vamos resolver. Dá-me mais detalhes para te ajudar melhor.`,
    ],
    unknown: [
      `Desculpa, não percebi bem 🤔 Podes explicar de outra maneira?`,
      `Não apanhei essa 😅 Diz-me de outra forma que eu ajudo.`,
    ]
  };
  
  const opts = responses[intent] || responses.unknown;
  return opts[Math.floor(Math.random() * opts.length)];
}

// Quando a IA está EM BAIXO (carteira, provedor), as respostas enlatadas por
// intenção enganam: o Manuel Jorge descreveu a TV Sony dele e ouviu "Boa
// escolha! 💰 Diz-me qual é o produto" — três frases dessas seguidas e o
// disjuntor teve de o pausar. Saudações/obrigados continuam com as enlatadas
// (são certeiras); para o resto, honestidade: houve falha e o dono foi avisado.
function respostaSemIA(intent, senderName) {
  if (intent === 'greeting' || intent === 'thanks') return generateResponse(intent, senderName);
  return 'Peço desculpa — estou com uma falha técnica neste momento e não consigo responder como devia 🙏 ' +
         'A equipa já foi avisada. Deixa aqui o nome do produto que procuras (ou a tua dúvida) ' +
         'que respondemos assim que possível.';
}

// ─── Send Message via Messenger ───────────────────────────────────────────────
async function sendMessage(recipientId, messageText) {
  rememberBotSend(messageText); // marca como envio do bot (p/ não confundir com resposta humana)
  return new Promise((resolve, reject) => {
    // UTF-8 explícito: buffer + charset — garante emojis/acentos sem mojibake
    const bodyBuf = Buffer.from(JSON.stringify({
      recipient: { id: recipientId },
      message: { text: messageText }
    }), 'utf8');

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': bodyBuf.length
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          // json.error aqui significa que o cliente NAO recebeu nada. Sinalizamos
          // para quem chama nao poder registar "enviado" como se tivesse corrido bem.
          if (json.error) {
            log('ERROR', `Meta send FALHOU (cliente não recebeu): ${json.error.message}`);
            json.__falhou = json.error.message;
          }
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);

    req.write(bodyBuf);
    req.end();
  });
}

// ─── Log Conversation ───────────────────────────────────────────────────────
// Arquivo permanente: o ficheiro activo guarda as últimas 1000, mas o que sai
// vai para um .jsonl append-only — material de treino nunca se perde.
const CONVERSATIONS_ARCHIVE = DATA_DIR + '/crm/conversations-archive.jsonl';

function logConversation(senderId, senderName, messageText, intent, botResponse, extra) {
  let convos = loadJSON(CONVERSATIONS_LOG);

  convos.push({
    timestamp: new Date().toISOString(),
    senderId,
    senderName,
    // NÚMERO REAL: o WhatsApp identifica por @lid e o dono via "245264...@lid",
    // sem conseguir ligar ao cliente. O bridge resolve-o (mapa da sessão) e
    // guarda-se aqui — é o que permite telefonar a quem ficou a meio da compra.
    ...(logConversation._telefone ? { telefone: logConversation._telefone } : {}),
    platform: logConversation._platform || 'messenger',
    userMessage: messageText,
    intent,
    botResponse,
    // entregue=false: o bot respondeu mas o cliente NUNCA viu (ex: bloqueio da
    // Meta no Instagram). Sem isto, a aprendizagem trata conversas mortas como
    // diálogos completos.
    entregue: extra && extra.entregue === false ? false : true,
    modo: (extra && extra.modo) || 'ia',
    ...(extra && extra.fotos ? { fotos: extra.fotos } : {}),
    ...(extra && extra.pedido ? { pedido: true } : {}),
    ...(extra && extra.humano ? { humano: true } : {}),
    ...(extra && extra.consultou ? { consultou: true } : {}),
    status: 'pending_followup'
  });

  if (convos.length > 1000) {
    const sair = convos.slice(0, convos.length - 1000);
    try {
      fs.appendFileSync(CONVERSATIONS_ARCHIVE, sair.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');
    } catch (e) { log('WARN', `arquivo de conversas falhou: ${e.message}`); }
    convos = convos.slice(-1000);
  }
  saveJSON(CONVERSATIONS_LOG, convos);

  log('INFO', `[${senderName}] Intent: ${intent} | User: "${String(messageText || '').substring(0, 50)}"...`);
}

// ─── Captura de resposta HUMANA do dono (echo que não é do bot) ───────────────
// É ouro para o bot aprender a responder como o dono. Emparelha com a última
// pergunta do cliente e guarda no repositório de treino.
function recordHumanAnswer(customerId, platform, answerText) {
  if (!answerText || wasSentByBot(answerText)) return; // ignora echoes do próprio bot
  const convos = loadJSON(CONVERSATIONS_LOG);
  const lastQ = [...convos].reverse().find(c => c.senderId === customerId && c.userMessage && c.userMessage !== '[imagem]');
  const training = loadJSON(TRAINING_LOG);
  training.push({
    timestamp: new Date().toISOString(),
    platform,
    customerId,
    pergunta: lastQ ? lastQ.userMessage : null,
    respostaHumana: answerText,
  });
  saveJSON(TRAINING_LOG, training.slice(-2000));
  log('INFO', `[APRENDER] resposta humana capturada (${platform}) → treino: "${answerText.slice(0, 40)}"`);
}

// ─── Extract Lead Info ───────────────────────────────────────────────────────
function extractAndLogLead(senderId, senderName, intent) {
  if (intent !== 'purchase' && intent !== 'complaint') return;
  
  let leads = loadJSON(LEADS_LOG);
  
  // Check if lead already exists
  const existing = leads.find(l => l.senderId === senderId);
  if (existing) {
    existing.lastContact = new Date().toISOString();
    existing.intents.push(intent);
  } else {
    leads.push({
      senderId,
      name: senderName,
      firstContact: new Date().toISOString(),
      lastContact: new Date().toISOString(),
      intents: [intent],
      status: 'active',
      notes: ''
    });
  }
  
  saveJSON(LEADS_LOG, leads);
  log('INFO', `[LEAD] ${senderName} | Intent: ${intent}`);
}

// A IA escreve markdown (**negrito**), mas nenhuma destas plataformas o renderiza
// como o modelo espera: Messenger/Instagram mostram os asteriscos crus ao cliente,
// e o WhatsApp usa *um* asterisco para negrito. Convertemos no codigo — pedir a
// IA para nao usar markdown funciona a maior parte das vezes, o que nao chega.
// LEVANTAMENTO GRÁTIS quando a entrega é cara — DETERMINÍSTICO.
// O Jordão ia perder-se num adaptador de 8.000 Kz com 5.000 Kz de entrega (62%)
// e só reagiu porque reclamou. Pus a regra no prompt duas vezes (solta e colada
// à tabela de taxas) e o bot ignorou-a nas duas. Isto não é conselho: é uma
// opção real da loja (levantamento no Kilamba é grátis e confirmado), por isso
// acrescenta-se no fim, como a guarda faz com o resto.
const RE_JA_FALA_LEVANTAR = /levant|passar? (c[áa]|aqui|no armaz)|vir buscar|buscar (a[íi]|no armaz)/i;
function acrescentarLevantamento(texto) {
  const t = String(texto || '');
  if (!t.trim() || RE_JA_FALA_LEVANTAR.test(t)) return t;
  if (!/entrega|entregamos/i.test(t)) return t;      // não é conversa de entrega
  // A TAXA vem da tabela, não da prosa: extrair o número do texto apanhava o
  // TOTAL em vez da taxa ("entrega Kilamba 700 Kz = 9.200 Kz" → 9.200) e falhava
  // quando o número vinha antes da palavra ("Viana fica a 4.000 Kz de entrega").
  let zona = null;
  try { zona = deliveryZones.detectZone(t); } catch {}
  const taxa = zona && Number(zona.taxa);
  if (!Number.isFinite(taxa) || taxa < 3000) return t;
  return t.trimEnd() + '\n\nSe preferires poupar a entrega, podes levantar no nosso armazém do Kilamba — aí não pagas nada de entrega. 😊';
}

// 14-Ago: "qual destes te interessa?" está PROIBIDO em dois sítios do prompt e
// mesmo assim saiu 12× em 13-14 Ago — e voltou a sair no teste da alma nova.
// Proibir não segura; o repertório positivo ajudou mas não chega. Última linha
// de defesa, determinística, no ponto onde tudo passa antes do cliente ler:
// reescreve-se a pergunta aberta por um fecho dirigido. Foi esta frase que
// matou 45 de 53 conversas (medido 05-Ago) — vale um regex.
const RE_FECHO_ABERTO = /\s*(qual (destes|deles|desses)[^?\n]{0,25}\?|o que (procuras|preferes)\s*\?|em que posso ajudar\s*\?)\s*$/i;
function fecharDirigido(t) {
  const s = String(t || '');
  if (!RE_FECHO_ABERTO.test(s)) return s;
  // se a resposta numerou opções, pedir o número; senão, sim/não sobre o 1º item
  const temNumeros = /(^|\n)\s*\d[\).\s-]/.test(s);
  const novo = temNumeros ? 'Responde só com o número que eu trato do resto. 😊'
                          : 'Queres que te reserve esse?';
  return s.replace(RE_FECHO_ABERTO, ' ' + novo);
}

function formatForPlatform(text, platform) {
  let t = fecharDirigido(String(text || ''));
  if (platform === 'whatsapp') {
    t = t.replace(/\*\*([\s\S]+?)\*\*/g, '*$1*');   // **x** -> *x* (negrito do WhatsApp)
    t = t.replace(/__([\s\S]+?)__/g, '_$1_');       // __x__ -> _x_ (italico)
  } else {
    t = t.replace(/\*\*([\s\S]+?)\*\*/g, '$1');     // Meta: sem markdown, tirar
    t = t.replace(/__([\s\S]+?)__/g, '$1');
  }
  // GUARDA anti-alucinação: último ponto antes de o cliente ler. Remove
  // telefones/emails/links inventados e promessas falsas (descontos, entrega
  // grátis, garantias com prazo, devolução de dinheiro). As políticas reais
  // vêm da FAQ curada; o que a IA inventa aqui, o cliente cobrava depois.
  try {
    t = textGuard.sanitizarTexto(t, {
      onRemove: (motivo, frase) => log('WARN', '[GUARDA] removido da resposta (' + motivo + '): ' + String(frase).slice(0, 70))
    });
  } catch (_) {}
  return t;
}

// ─── Atendimento WhatsApp ─────────────────────────────────────────────────────
// O bridge do Hermes encaminha para aqui QUEM NAO E O ADMIN. O Hermes nunca ve
// estas mensagens: ele tem terminal/ficheiros e nao pode ficar exposto a
// estranhos. Este bot so sabe de catalogo, precos e entregas.
// Mesmo cerebro do Messenger (aiReply + processMarkers), transporte diferente.
// ─── DEBOUNCE BATCHING (14-Ago) ──────────────────────────────────────────────
// Quem escreve no telemóvel manda a ideia em pedaços: "Kilamba" + "Coluna de 17
// mil" no MESMO segundo. Cada mensagem disparava o bot em separado e ele
// respondia duas vezes desencontrado — respondeu à zona sem saber o produto e ao
// produto sem ligar à zona. Medido: 38 casos reais (<15s), incluindo
// "Kilamba bloco u16" + "980765322" (morada e telefone de UMA encomenda,
// processados desligados).
// O filtro ehRajada() só apanha CÓPIAS; mensagens DIFERENTES em rajada passavam.
// Agora espera-se 1,2s de silêncio, juntam-se as mensagens e responde-se UMA vez
// ao conjunto — é o que um humano faz: deixa a pessoa acabar de escrever.
// Só para TEXTO: uma foto ou nota de voz é processada logo (têm o seu caminho).
const _batchWA = new Map();   // chatId -> { partes[], imagens[], nome, telefone, timer }
const BATCH_MS = Math.min(4000, Math.max(400, Number(process.env.BATCH_DEBOUNCE_MS) || 1200));

function handleWhatsAppComBatch(chatId, senderName, messageText, imagens, telefone) {
  const id = String(chatId);
  const temMedia = (imagens && imagens.length);
  const b = _batchWA.get(id);
  // media ou mensagem citada: processa já (e leva junto o que estiver em espera)
  if (temMedia || /\[o cliente respondeu a ESTA/.test(String(messageText || ''))) {
    if (b) {
      clearTimeout(b.timer); _batchWA.delete(id);
      messageText = [...b.partes, messageText].filter(Boolean).join('\n');
      imagens = [...(b.imagens || []), ...(imagens || [])];
    }
    return handleWhatsApp(chatId, senderName, messageText, imagens, telefone);
  }
  if (b) {
    clearTimeout(b.timer);
    b.partes.push(String(messageText || ''));
    b.nome = senderName || b.nome; b.telefone = telefone || b.telefone;
  } else {
    _batchWA.set(id, { partes: [String(messageText || '')], imagens: [], nome: senderName, telefone, timer: null });
  }
  const est = _batchWA.get(id);
  est.timer = setTimeout(() => {
    _batchWA.delete(id);
    const junto = est.partes.filter(Boolean).join('\n');
    if (est.partes.length > 1) log('INFO', `[BATCH] ${est.nome}: ${est.partes.length} mensagens juntas numa resposta — "${junto.slice(0, 60).replace(/\n/g, ' | ')}"`);
    handleWhatsApp(chatId, est.nome, junto, est.imagens, est.telefone)
      .catch(e => log('ERROR', `[BATCH] ${e.message}`));
  }, BATCH_MS);
  return Promise.resolve();
}

async function handleWhatsApp(chatId, senderName, messageText, imagens, telefone) {
  imagens = imagens || [];
  logConversation._platform = 'whatsapp';
  logConversation._telefone = telefone || '';
  registarAtividadeCliente(chatId, 'whatsapp');
  // memória de cliente: extracção determinística (zona/modelo) do que ELE disse
  try { perfilClientes.aprender(chatId, senderName, messageText, 'whatsapp', deliveryZones); } catch (_) {}
  if (ehRajada(chatId, messageText)) { log('INFO', `[RAJADA] cópia ignorada de ${senderName} (whatsapp): "${String(messageText).slice(0, 50)}"`); return; }
  if (disjuntorBloqueia(chatId, senderName, 'whatsapp', messageText)) {
    // dizer QUEM calou o bot: passei a diagnosticar handoffs como se fossem
    // loops do disjuntor por causa desta linha
    log('WARN', `[${(_dj(chatId).motivoPausa || 'disjuntor').toUpperCase()}] bot calado — msg de ${senderName} (whatsapp): "${String(messageText || '').slice(0, 60)}"`);
    // o cliente continua a falar — guardar (material de aprendizagem) e passar ao dono
    logConversation(chatId, senderName, messageText, 'pausado', '', { entregue: false, modo: 'pausado-' + (_dj(chatId).motivoPausa || 'disjuntor') });
    disjuntorEncaminha(chatId, senderName, 'whatsapp', messageText);
    return;
  }
  const { intent } = classifyIntent(messageText || (imagens.length ? 'foto' : ''));
  let botResponse = null;
  let mode = 'ia';
  try {
    botResponse = await comTimeout(aiReply(chatId, messageText, imagens), 75000);
    if (!botResponse) { mode = 'fallback'; botResponse = respostaSemIA(intent, senderName); }
  } catch (e) {
    log('WARN', `IA falhou (${e.message}) — fallback honesto`);
    mode = 'fallback';
    botResponse = respostaSemIA(intent, senderName);
  }

  const clean = await processMarkers(botResponse, chatId, senderName, 'whatsapp');
  // rede de segurança: se a IA não pôs o <<HUMANO>>, o código põe
  if (RE_REVENDA.test(String(messageText || '')) && !clean.humano) {
    clean.humano = true;
    escalarRevenda(chatId, senderName, 'whatsapp', messageText);
  }
  botResponse = clean.reply;

  botResponse = acrescentarLevantamento(formatForPlatform(botResponse, 'whatsapp'));

  // Mesma razão do bloco equivalente no Messenger: a pausa foi lida à ENTRADA
  // (linha ~1599), a IA pensou até 75s, e o dono pode ter assumido a conversa
  // entretanto. Sem esta releitura o bot fala por cima dele sem restart nenhum.
  if (_dj(chatId).pausadoAte > Date.now()) {
    log('WARN', `[${(_dj(chatId).motivoPausa || 'handoff').toUpperCase()}] resposta abortada — assumiste a conversa enquanto a IA pensava (${chatId})`);
    logConversation(chatId, senderName, messageText, 'pausado', '',
      { entregue: false, modo: 'pausado-' + (_dj(chatId).motivoPausa || 'handoff') });
    return;
  }

  const r = await sendWhatsApp(chatId, botResponse);

  // Catálogo PDF pedido → gerar e enviar como documento
  if (clean.catalogo) {
    try {
      const cat = await gerarCatalogoBot(clean.catalogo);
      const dr = await sendWhatsAppDoc(chatId, cat.path, 'Catálogo SuperLoja 📄', 'Catalogo-SuperLoja.pdf');
      if (dr.ok) marcarCatalogoEnviado(chatId);   // trava reenvios nas próximas 6h
      log(dr.ok ? 'INFO' : 'WARN', `[CATALOGO] ${cat.template} (${cat.produtos} prod) → ${dr.ok ? 'enviado' : 'falhou: ' + dr.error} (whatsapp)`);
      if (!dr.ok) await sendWhatsApp(chatId, 'Tive um problema a enviar o PDF 😅 mas vê tudo em ' + SITE);
    } catch (e) { log('WARN', `[CATALOGO] ${e.message}`); await sendWhatsApp(chatId, 'O catálogo online está sempre actualizado em ' + SITE + ' 🛍️'); }
  }

  // Fotos como ANEXO real, resolvidas em cadeia: BD do admin -> catalogo ->
  // internet (validada). Se nada existir: honestidade, nunca foto errada.
  let fotosOk = 0;
  for (const ped of clean.fotoPedidos.slice(0, 3)) {
    let alvo = null;
    try { alvo = await productPhotos.resolvePhoto(ped.nome, ped.catalogUrl); } catch {}
    if (!alvo) {
      log('INFO', `[FOTO] nada encontrado para "${ped.nome.slice(0, 30)}" — resposta honesta`);
      await sendWhatsApp(chatId, 'Afinal ainda não tenho foto do ' + ped.nome + ' aqui no sistema 🙈 Mas o produto está disponível — se quiseres confirmo-te os detalhes!');
      continue;
    }
    // LEGENDA na foto: sem ela, quando o cliente responde "quero esse" citando a
    // imagem, não há texto nenhum que identifique o produto (aconteceu com a
    // Joelma: 3 fotos sem legenda → o bot não soube qual era e reenviou tudo).
    const fr = await sendWhatsAppImage(chatId, alvo.valor, legendaProduto(ped.nome));
    if (fr.ok) {
      fotosOk++;
      registarMostrado(chatId, ped.nome);
      // guardar QUAL produto é esta foto: quando o cliente lhe responde, o
      // WhatsApp cita a mensagem sem a legenda ("[foto sem legenda]") e o bot
      // ficava sem saber a que produto ele apontava (conversa do Cacaia, 4-Ago).
      registarFotoEnviada(fr.messageId, ped.nome);
      log('INFO', `[FOTO] enviada (${alvo.origem}) para "${ped.nome.slice(0, 30)}"`);
      continue;
    }
    log('WARN', `[WHATSAPP] anexo falhou (${fr.error})${ped.catalogUrl ? ' — a enviar link' : ''}`);
    if (ped.catalogUrl) await sendWhatsApp(chatId, ped.catalogUrl);
  }

  if (!r.ok) {
    // abort porque o DONO assumiu durante a pausa de "a escrever…": não é uma
    // falha de entrega — avisá-lo com "Responde tu no WhatsApp" quando ele JÁ
    // está a responder seria ruído. Regista-se e sai em silêncio.
    if (r.error === 'pausado-durante-escrita') {
      logConversation(chatId, senderName, messageText, intent, botResponse,
        { entregue: false, modo: 'pausado-handoff', pedido: clean.pedido, humano: clean.humano, consultou: clean.consultou });
      return;
    }
    log('ERROR', `❌ NÃO ENTREGUE [whatsapp] a ${senderName}: ${r.error}`);
    if (shouldNotifyFail(chatId)) notifyCarlos('⚠️ *RESPOSTA NÃO ENTREGUE* (whatsapp)\n' +
      '👤 ' + senderName + linhaContacto(chatId) + '\n💬 Cliente: ' + String(messageText).slice(0, 90) +
      '\n🚫 Motivo: ' + r.error + '\nResponde tu no WhatsApp.');
    // Regista na mesma: a pergunta do cliente é material de aprendizagem
    // mesmo quando a entrega falha (antes, perdia-se com o return).
    // As etiquetas vão TAMBÉM neste ramo: uma encomenda ou um escalamento não
    // deixam de ter acontecido só porque a mensagem não chegou ao cliente.
    logConversation(chatId, senderName, messageText, intent, botResponse,
      { entregue: false, modo: mode, pedido: clean.pedido, humano: clean.humano, consultou: clean.consultou });
    return;
  }
  log('INFO', `✅ Resposta [${mode}] a ${senderName} (whatsapp)${clean.fotoUrls.length ? ' [+' + fotosOk + '/' + clean.fotoUrls.length + ' foto anexo]' : ''}${clean.pedido ? ' [ENCOMENDA]' : ''}${clean.humano ? ' [ESCALADO]' : ''}`);
  // voz responde a voz: se a mensagem do cliente foi uma nota de voz, a mesma
  // resposta segue também em áudio. Fire-and-forget: o texto JÁ FOI entregue —
  // uma falha aqui não pode custar a resposta, por isso só se regista no log.
  if (/nota de voz; isto é a transcrição/.test(String(messageText || ''))) {
    (async () => {
      try {
        const ficheiro = await sintetizarVoz(botResponse);
        if (!ficheiro) { log('INFO', '[VOZ] resposta longa demais ou síntese falhou — foi só texto'); return; }
        const vr = await sendWhatsAppAudio(chatId, ficheiro);
        log(vr.ok ? 'INFO' : 'WARN', `[VOZ] nota de voz ${vr.ok ? 'enviada' : 'falhou: ' + vr.error} a ${senderName}`);
        try { fs.unlinkSync(ficheiro); } catch (_) {}
      } catch (e) { log('WARN', '[VOZ] ' + e.message); }
    })();
  }
  disjuntorRegistaResposta(chatId, senderName, 'whatsapp', botResponse);
  logConversation(chatId, senderName, messageText, intent, botResponse,
    { entregue: true, modo: mode, fotos: fotosOk || undefined,
      pedido: clean.pedido, humano: clean.humano, consultou: clean.consultou });
  extractAndLogLead(chatId, senderName, intent);
  maybeAutoLearn();
  if (clean.humano) { _lastLearn = 0; maybeAutoLearn(); }
}

// ─── Handle Incoming Message ───────────────────────────────────────────────────
async function handleMessage(senderId, senderName, messageText, imageUrls) {
  imageUrls = imageUrls || [];
  // limpar o telefone do WhatsApp: é estado partilhado entre mensagens e, sem
  // isto, um aviso do Messenger podia sair com o número do último cliente do
  // WhatsApp — dados de uma pessoa colados aos de outra.
  logConversation._telefone = '';
  const platf = logConversation._platform || 'messenger';
  registarAtividadeCliente(senderId, platf);
  // memória de cliente: extracção determinística (zona/modelo) do que ELE disse
  try { perfilClientes.aprender(senderId, senderName, messageText, platf, deliveryZones); } catch (_) {}
  // rajada: cópias da mesma mensagem em <60s (botão/reentrega) — responde-se à 1ª, ignora-se o resto
  if (ehRajada(senderId, messageText)) { log('INFO', `[RAJADA] cópia ignorada de ${senderName} (${platf}): "${String(messageText).slice(0, 50)}"`); return; }
  if (disjuntorBloqueia(senderId, senderName, platf, messageText)) {
    log('WARN', `[${(_dj(senderId).motivoPausa || 'disjuntor').toUpperCase()}] bot calado — msg de ${senderName} (${platf}): "${String(messageText || '').slice(0, 60)}"`);
    logConversation(senderId, senderName, messageText, 'pausado', '', { entregue: false, modo: 'pausado-' + (_dj(senderId).motivoPausa || 'disjuntor') });
    disjuntorEncaminha(senderId, senderName, platf, messageText);
    return;
  }
  // toque humano: marca "visto" e mostra "a escrever…" enquanto a IA pensa
  sendAction(senderId, 'mark_seen');
  sendAction(senderId, 'typing_on');
  const { intent } = classifyIntent(messageText || (imageUrls.length ? 'foto' : ''));
  let botResponse = null;
  let mode = 'ia';
  try {
    // 1) tenta resposta humana com IA (contexto + catálogo + visão)
    botResponse = await comTimeout(aiReply(senderId, messageText, imageUrls), 75000);
    if (!botResponse) { mode = 'fallback'; botResponse = respostaSemIA(intent, senderName); }
  } catch (e) {
    log('WARN', `IA falhou (${e.message}) — fallback honesto`);
    mode = 'fallback';
    botResponse = respostaSemIA(intent, senderName);
  }
  // Processar marcadores ocultos (encomenda / pedido de humano) e limpá-los da resposta
  const platform = logConversation._platform || 'messenger';
  const clean = await processMarkers(botResponse, senderId, senderName, platform);
  if (RE_REVENDA.test(String(messageText || '')) && !clean.humano) {
    clean.humano = true;
    escalarRevenda(senderId, senderName, platform, messageText);
  }
  botResponse = acrescentarLevantamento(formatForPlatform(clean.reply, platform));

  // A pausa foi lida à ENTRADA (linha ~1703) mas a IA pensou até 75s. Nesse
  // intervalo o dono pode ter assumido a conversa pelo telemóvel — e esta
  // resposta sairia POR CIMA dele, sem restart nenhum pelo meio. Reler mesmo
  // antes de enviar; sem isto a persistência da pausa parece não funcionar.
  if (_dj(senderId).pausadoAte > Date.now()) {
    log('WARN', `[${(_dj(senderId).motivoPausa || 'handoff').toUpperCase()}] resposta abortada — assumiste a conversa enquanto a IA pensava (${senderId})`);
    logConversation(senderId, senderName, messageText || '[imagem]', 'pausado', '',
      { entregue: false, modo: 'pausado-' + (_dj(senderId).motivoPausa || 'handoff') });
    return;
  }

  try {
    let falha = null;
    if (botResponse) {
      const r = await sendMessage(senderId, botResponse);
      if (r && r.__falhou) falha = r.__falhou;
    }
    // Catálogo PDF pedido → gerar e enviar como ficheiro (Meta multipart)
    if (clean.catalogo && !falha) {
      try {
        const cat = await gerarCatalogoBot(clean.catalogo);
        const ok = await sendFileMeta(senderId, cat.path, 'Catalogo-SuperLoja.pdf');
        if (ok) marcarCatalogoEnviado(senderId);   // trava reenvios nas próximas 6h
        log(ok ? 'INFO' : 'WARN', `[CATALOGO] ${cat.template} (${cat.produtos} prod) → ${ok ? 'enviado' : 'falhou'} (${platform})`);
        if (!ok) await sendMessage(senderId, formatForPlatform('Vê o catálogo completo em ' + SITE + ' 🛍️', platform));
      } catch (e) { log('WARN', `[CATALOGO] ${e.message}`); }
    }
    // fotos em cadeia (BD admin -> catalogo -> internet); ficheiro local sobe
    // por multipart, URL vai directo. Nada encontrado = honestidade sem foto.
    for (const ped of clean.fotoPedidos.slice(0, 3)) {
      let alvo = null;
      try { alvo = await productPhotos.resolvePhoto(ped.nome, ped.catalogUrl); } catch {}
      if (!alvo) {
        log('INFO', `[FOTO] nada para "${ped.nome.slice(0, 30)}" (${platform}) — resposta honesta`);
        await sendMessage(senderId, formatForPlatform('Afinal ainda não tenho foto do ' + ped.nome + ' aqui no sistema 🙈 Mas o produto está disponível — confirmo-te os detalhes se quiseres!', platform));
        continue;
      }
      const ok = alvo.tipo === 'ficheiro'
        ? await sendImageFile(senderId, alvo.valor)
        : await sendImage(senderId, alvo.valor);
      if (ok) log('INFO', `[FOTO] enviada (${alvo.origem}) para "${ped.nome.slice(0, 30)}" (${platform})`);
      else if (alvo.tipo === 'ficheiro' && ped.catalogUrl) await sendImage(senderId, ped.catalogUrl);   // plano B
    }

    if (falha) {
      // A resposta foi gerada mas NAO chegou ao cliente. Sem isto, o cliente fica
      // sem resposta e ninguem da por ela (o log dizia "enviado" na mesma).
      log('ERROR', `❌ NÃO ENTREGUE [${platform}] a ${senderName}: ${falha}`);
      if (shouldNotifyFail(senderId)) notifyCarlos('⚠️ *RESPOSTA NÃO ENTREGUE* (' + platform + ')\n' +
        '👤 ' + senderName + linhaContacto(senderId) + '\n' +
        '💬 Cliente: ' + String(messageText || '[imagem]').slice(0, 90) + '\n' +
        '🤖 O bot queria responder: ' + String(botResponse).slice(0, 120) + '\n' +
        '🚫 Motivo: ' + falha + '\n' +
        'Responde tu manualmente no ' + (platform === 'instagram' ? 'Instagram' : 'Messenger') + '.');
    } else {
      log('INFO', `✅ Resposta [${mode}] a ${senderName}${imageUrls.length ? ' (com ' + imageUrls.length + ' imagem)' : ''}${clean.fotoUrls.length ? ' [+' + clean.fotoUrls.length + ' foto]' : ''}${clean.pedido ? ' [ENCOMENDA]' : ''}${clean.humano ? ' [ESCALADO]' : ''}`);
    }
    if (!falha) disjuntorRegistaResposta(senderId, senderName, platform, botResponse);
    logConversation(senderId, senderName, messageText || '[imagem]', intent, botResponse,
      { entregue: !falha, modo: mode, fotos: clean.fotoUrls.length || undefined,
        pedido: clean.pedido, humano: clean.humano, consultou: clean.consultou });
    extractAndLogLead(senderId, senderName, intent);
    maybeAutoLearn(); // aprende sempre (debounced 1x/hora); conversa complexa força já abaixo
    if (clean.humano) { _lastLearn = 0; maybeAutoLearn(); } // complexa → reaprende já
  } catch (e) {
    // AQUI o cliente ficou SEM RESPOSTA NENHUMA (nem fallback saiu) — escalar.
    log('ERROR', `Falha ao responder a ${senderName}: ${e.message}`);
    if (shouldNotifyFail(senderId)) notifyCarlos('🚨 *BOT FALHOU — cliente sem resposta* (' + platf + ')\n' +
      '👤 ' + senderName + linhaContacto(senderId) + '\n💬 Cliente: ' + String(messageText || '[imagem]').slice(0, 90) +
      '\n🐛 Erro: ' + String(e.message).slice(0, 100) + '\nResponde tu manualmente.');
  }
}

// Encontra a URL da imagem de um produto pelo nome (match aproximado)
// ─── O QUE ESTÁ NO ANÚNCIO agora (clientes chegam a dizer "isto") ────────────
// Quem clica no anúncio chega com a mensagem padrão do Meta ("posso saber mais
// informações sobre ISTO?"). Sem esta lista o bot respondia "não consigo ver a
// publicação" — 7 clientes do anúncio levaram essa resposta em 29-Jul.
// Ficheiro gerado por sync-campanha-ativa.js (cron).
// Famílias por palavra no nome — serve para o cross-sell: quem vem por fones
// leva um cabo, quem vem por cabo leva um carregador. Sem isto o bot mostrava
// sempre os MESMOS 3 produtos do anúncio e a conversa era um disco riscado.
// `carreg` e não `carregador`: o catálogo tem "Carregagdor USB" (erro de escrita
// real) e com o nome completo esse produto caía em 'outro' — e ia ser sugerido
// como complemento a quem já vinha por carregadores.
const FAMILIAS = [
  ['audio', /fone|auricul|earbud|\btws\b|headset|ouvido/i],
  ['som', /caixa de som|coluna|speaker/i],
  ['cabo', /\bcabo\b|\bfio\b/i],
  ['carregar', /carreg|adaptador|fonte|tomada/i],
  ['energia', /power ?bank|bateria|pilha/i],
  ['protecao', /capa|pelicula|película|vidro/i],
  ['periferico', /rato|mouse|teclado|pen ?drive|cart[ãa]o|leitor|hub/i],
];
function familiaDe(nome) {
  for (const [f, re] of FAMILIAS) if (re.test(String(nome || ''))) return f;
  return 'outro';
}
// Só estas famílias servem de complemento. Sem esta lista, "mais barato de uma
// família nova" sugeria Ventosas (2.000) e Adesivos para rodas de carro (4.000)
// a quem veio comprar fones — 'outro' é onde vive o ruído do catálogo.
const FAMILIAS_COMPLEMENTO = ['protecao', 'energia', 'som', 'periferico', 'audio', 'cabo', 'carregar'];
// Rotação estável: o MESMO cliente vê a mesma abertura durante a conversa (não
// muda a meio), clientes diferentes vêem aberturas diferentes, e ao dia seguinte
// muda. Sem isto todos recebiam a frase idêntica — foi a queixa do dono.
// ⚠️ MEDIDO: 45 dos 53 clientes que desapareceram morreram numa PERGUNTA ABERTA
// ("qual destes te interessa?"). Três dos CTAs originais eram exactamente isso —
// e o blocoCampanha obriga o bot a usar o CTA, portanto era o próprio código a
// forçar a pergunta que matava as conversas. Agora todos pedem UMA coisa fácil:
// um sim/não, um número, ou o bairro. Nunca "escolhe entre 9".
const CTAS_ANUNCIO = [
  'O mais vendido é o Fones de ouvido X83 — 9.500 Kz. Queres esse?',
  'Responde só com o número do que queres (ex: 1) e eu trato do resto.',
  'Mando-te já a foto do X83, que é o que mais sai?',
  'Diz-me só o teu bairro que eu calculo o total com a entrega.',
  'Queres que te mande as fotos dos 3 mais procurados?',
];
// ANTI-TIQUE (14-Ago). MEDIDO em 268 respostas desde 1-Ago: 66% abrem com
// saudação ("Olá 👋" 46×) ou interjeição ("Perfeito" 18×, "Boa pergunta" 13×).
// E "qual destes te interessa?" — PROIBIDO em DOIS sítios deste prompt — saiu
// 12× só em 13-14 Ago. Lição: proibições negativas não seguram; o modelo precisa
// de um sítio POSITIVO para onde ir. É o que já resulta nos CTAS_ANUNCIO:
// rotação determinística. Aqui roda por MENSAGEM (não por dia), para variar
// dentro da mesma conversa.
const MOLDE_DE_ABERTURA = [
  'Entra DIRECTO: a primeira palavra é o produto, o preço ou o sim/não. Zero interjeições, zero saudação.',
  'Abre com UMA palavra curta de confirmação ("Certo.", "Entendido.", "Boa escolha.") e passa já ao facto.',
  'Abre pela acção que já fizeste ("Já vi qual é.", "Fui ver o catálogo.", "Já te separei as fotos.").',
  'Abre repetindo a palavra que o cliente usou ("Sem fio, então...", "Para o Smart 7...") e continua daí.',
];
function _semente(senderId) {
  const s = String(senderId || '') + new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
}
function blocoCampanha(senderId) {
  try {
    const f = DATA_DIR + '/campanha-ativa.json';
    const st = fs.statSync(f);
    if (Date.now() - st.mtimeMs > 24 * 3600000) return '';          // desatualizado: não arriscar
    const db = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!db.produtos || !db.produtos.length) return '';
    const sem = _semente(senderId);
    const cta = CTAS_ANUNCIO[sem % CTAS_ANUNCIO.length];
    const inicio = db.produtos.length > 3 ? (sem % db.produtos.length) : 0;

    // cross-sell: produtos com stock de FAMÍLIAS que o anúncio não cobre,
    // mais baratos primeiro (é o que se junta ao carrinho sem pensar)
    const noAnuncio = new Set(db.produtos.map(p => familiaDe(p.nome)));
    const extras = (catalogCache.list || [])
      .filter(p => {
        const fam = familiaDe(p.name);
        return Number(p.stock) > 0 && !noAnuncio.has(fam) && FAMILIAS_COMPLEMENTO.includes(fam);
      })
      .sort((a, b) => Number(a.price) - Number(b.price))
      .slice(0, 3);

    return '\nESTÁ NO AR UM ANÚNCIO NOSSO com estes produtos (muitos clientes chegam do anúncio e dizem "isto", "isso", "esse", "vi a publicação"):\n' +
      db.produtos.map((p, i) => (i + 1) + '. ' + p.nome + ' — ' + p.preco.toLocaleString('pt-BR') + ' Kz').join('\n') +
      '\nSE o cliente disser "isto/isso/esse" ou "quero mais informações" SEM dizer o produto: NÃO digas que não vês a publicação. ' +
      'Assume que vem do anúncio.\n' +
      // A LISTA TODA, não 3: o cliente escolhe pelo número e a conversa anda em
      // vez de ficar a perguntar "qual queres?" às cegas.
      'MOSTRA A LISTA NUMERADA ACIMA (todos, um por linha, nome completo e preço de cada) para ele poder dizer "quero o 3".\n' +
      'Se forem mais de 6, começa no nº ' + (inicio + 1) + ' e dá a volta à lista — assim clientes diferentes vêem produtos diferentes.\n' +
      (extras.length
        ? 'DEPOIS de ele escolher (ou se disser que nenhum serve), sugere UM destes como complemento, com nome e preço exactos: ' +
          extras.map(p => p.name + ' (' + Number(p.price).toLocaleString('pt-BR') + ' Kz)').join(', ') +
          '. Sugere no máximo UM por mensagem e só depois do produto principal — nunca antes.\n'
        : '') +
      // jambanelsonp (29-Jul): "Sim, manda só fotografias" → o bot voltou a
      // perguntar "qual?". Quem pede fotos sem especificar quer VER, não conversar.
      'Se o cliente pedir FOTOS sem dizer de qual ("manda fotos", "manda só fotografias"): NÃO perguntes qual — ' +
      'envia já as fotos dos 3 primeiros produtos da lista (um <<FOTO>>nome<<FIM>> para cada um) e pergunta no fim qual preferiu.\n' +
      'CHAMADA À AÇÃO desta conversa — termina com ESTA e NÃO acrescentes outra pergunta a seguir: "' + cta + '"\n' +
      'NUNCA feches com "qual destes te interessa?" nem "o que procuras?" — foi assim que se perderam 45 clientes.\n' +
      'NUNCA repitas a mesma frase de abertura ou a mesma pergunta duas vezes na mesma conversa. ' +
      'Se já perguntaste qual quer, não voltes a perguntar: avança para morada e entrega.\n' +
      // sem isto o bot escrevia "Cabo Tipo C, Micro USB e extra longo por 4.500 Kz"
      // — e há um "Cabo Tipo C" de 12.000 Kz no catálogo (falha do Jovane, 29-Jul).
      'AO CITAR ESTES PRODUTOS: copia o NOME COMPLETO exactamente como está na lista acima, um por linha, ' +
      'com o seu próprio preço. NUNCA juntes vários produtos num só preço ("cabos por 4.500") nem encurtes o nome.\n';
  } catch { return ''; }
}

// ─── "QUERO ESSE": saber a que produto o cliente se refere ───────────────────
// O cliente responde a uma FOTO (reply) ou diz "quero esse/o primeiro". Para o
// bot entender são precisas 2 coisas: (1) a foto vai com LEGENDA (nome+preço), que
// aparece citada no reply; (2) o bot lembra-se do que mostrou a este cliente.
// Normaliza para comparar nomes de produto (o catálogo tem espaços duplos,
// maiúsculas irregulares e acentos: "Fones de ouvido  X83", "RÁPidp").
function _normProd(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
/**
 * Encontra o produto do catálogo que corresponde ao nome pedido.
 *
 * ⚠️ 29-Jul (conversa do Jovane): o matching antigo (`a.includes(b) || b.includes(a)`
 * com .find()) devolvia o PRIMEIRO produto cujo nome estivesse contido na query —
 * por isso "Fones de ouvido Pro6 TWS" (8.500 Kz) casava com "Fones de ouvido"
 * (16.500 Kz) e o cliente recebeu a foto do Pro6 legendada a 16.500 Kz.
 * Agora: exacto > quem contém a query inteira > o mais próximo em comprimento.
 */
function acharProdutoCatalogo(nome, lista) {
  const cat = lista || catalogCache.list || [];
  const q = _normProd(nome);
  if (!q || !cat.length) return null;
  const exacto = cat.find(x => _normProd(x.name) === q);
  if (exacto) return exacto;
  const cands = cat.filter(x => { const a = _normProd(x.name); return a && (a.includes(q) || q.includes(a)); });
  if (cands.length) {
    cands.sort((x, y) => {
      const ax = _normProd(x.name), ay = _normProd(y.name);
      const cx = ax.includes(q) ? 1 : 0, cy = ay.includes(q) ? 1 : 0;   // quem contém a query toda ganha
      if (cx !== cy) return cy - cx;
      return Math.abs(ax.length - q.length) - Math.abs(ay.length - q.length);   // e o mais próximo em tamanho
    });
    return cands[0];
  }
  // último recurso: maior nº de palavras significativas em comum (≥2)
  const pal = q.split(' ').filter(w => w.length > 3);
  let melhor = null, melhorN = 0;
  cat.forEach(x => {
    const a = _normProd(x.name);
    const n = pal.filter(w => a.includes(w)).length;
    if (n > melhorN) { melhorN = n; melhor = x; }
  });
  return melhorN >= 2 ? melhor : null;
}
function legendaProduto(nome) {
  const n = String(nome || '').trim();
  if (!n) return undefined;
  const p = acharProdutoCatalogo(n);
  // sem correspondência fiável NÃO se inventa preço: legenda fica só com o nome
  return p ? (p.name + ' — ' + Number(p.price).toLocaleString('pt-BR') + ' Kz') : n;
}
// 14-Ago (Rainho Alberto): o cliente pediu catálogo ("Manda mesmo") e RECEBEU,
// depois disse só "Ok" e o bot re-emitiu <<CATALOGO>> — segundo PDF em 40s. E o
// follow-up mandou um TERCEIRO uma hora depois, a quem já o tinha. Regra-de-
// -prompt não chega (o modelo reemite o marcador num "Ok"): guarda determinística.
// Um catálogo por cliente a cada 6h — do marcador OU do follow-up.
const _catalogoEnviado = new Map();   // chatId -> timestamp do último catálogo
const CATALOGO_JANELA_MS = 6 * 3600000;
function catalogoRecente(chatId) {
  const t = _catalogoEnviado.get(String(chatId));
  return !!(t && Date.now() - t < CATALOGO_JANELA_MS);
}
function marcarCatalogoEnviado(chatId) {
  _catalogoEnviado.set(String(chatId), Date.now());
  if (_catalogoEnviado.size > 800) {   // LRU simples
    const corte = Date.now() - CATALOGO_JANELA_MS;
    for (const [k, v] of _catalogoEnviado) if (v < corte) _catalogoEnviado.delete(k);
  }
}

// 14-Ago: o catálogo era a ponta de um padrão — o modelo reemite QUALQUER
// marcador num "Ok"/"sim". A auditoria mediu o dono avisado 2-3× por conversa
// (<<HUMANO>>, alguns a 47s) e o cérebro a responder 2× à mesma pergunta
// (<<CONSULTAR>>, caso Buanda). Cooldown determinístico genérico por
// chatId+chave, com uma janela por tipo de acção.
const _accaoRecente = new Map();   // "chatId|chave" -> timestamp
function accaoRecente(chatId, chave, janelaMs) {
  const t = _accaoRecente.get(String(chatId) + '|' + chave);
  return !!(t && Date.now() - t < janelaMs);
}
function marcarAccao(chatId, chave) {
  _accaoRecente.set(String(chatId) + '|' + chave, Date.now());
  if (_accaoRecente.size > 2000) {
    const corte = Date.now() - 6 * 3600000;
    for (const [k, v] of _accaoRecente) if (v < corte) _accaoRecente.delete(k);
  }
}
// pergunta normalizada, para "quanto dura a bateria?" e "a bateria dura quanto"
// contarem como a mesma consulta
function _chaveConsulta(pergunta) {
  return String(pergunta || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3).sort().join(' ').slice(0, 60);
}

const _mostrados = new Map();   // chatId -> [{nome, preco, quando}]
function registarMostrado(chatId, nome) {
  try {
    const p = (catalogCache.list || []).find(x => {
      const a = String(x.name || '').toLowerCase(), b = String(nome || '').toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    const lista = _mostrados.get(String(chatId)) || [];
    const item = { nome: (p && p.name) || String(nome), preco: p ? Number(p.price) : null, quando: Date.now() };
    if (!lista.some(x => x.nome === item.nome)) lista.push(item);
    _mostrados.set(String(chatId), lista.slice(-8));
  } catch (_) {}
}
// bloco para o prompt: o que este cliente JÁ viu, numerado (permite "o 2")
function blocoMostrados(chatId) {
  const lista = (_mostrados.get(String(chatId)) || []).filter(x => Date.now() - x.quando < 6 * 3600000);
  if (!lista.length) return '';
  return '\nPRODUTOS QUE JÁ MOSTRASTE A ESTE CLIENTE (por ordem — usa isto quando ele disser "quero esse", "o primeiro", "o de 8 mil" ou responder a uma foto):\n' +
    lista.map((x, i) => (i + 1) + '. ' + x.nome + (x.preco ? ' — ' + x.preco.toLocaleString('pt-BR') + ' Kz' : '')).join('\n') + '\n';
}

// ─── Fichas técnicas (13-Ago) ────────────────────────────────────────────────
// Geradas pelo investigador (Hermes + web_search) via dashboard e guardadas em
// fichas-tecnicas.json. Aqui só se LÊ: entra no prompt a ficha dos produtos em
// conversa (mostrados a este cliente + nomeados na mensagem dele), no máximo 2
// — o prompt já é grande. É isto que deixa o bot responder a perguntas técnicas
// em 2s em vez de cair no "vou confirmar" (o catálogo diz "Produto de
// qualidade" em 43% das fichas e não sustenta pergunta nenhuma).
const FICHAS_FILE = DATA_DIR + '/crm/fichas-tecnicas.json';
let _fichasCache = { at: 0, db: {} };
function loadFichas() {
  if (Date.now() - _fichasCache.at < 60000) return _fichasCache.db;
  try { _fichasCache = { at: Date.now(), db: JSON.parse(fs.readFileSync(FICHAS_FILE, 'utf8')) }; }
  catch { _fichasCache = { at: Date.now(), db: {} }; }
  return _fichasCache.db;
}
function _normFicha(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function blocoFichas(chatId, msgTexto) {
  const db = loadFichas();
  const ids = Object.keys(db);
  if (!ids.length) return '';
  const candidatos = [];
  // 1) produtos nomeados na mensagem DELE (nome do catálogo contido no texto)
  const msg = _normFicha(msgTexto);
  if (msg) {
    for (const id of ids) {
      const n = _normFicha(db[id].nome);
      if (n.length >= 8 && msg.includes(n)) candidatos.push(id);
    }
  }
  // 2) produtos que o bot mostrou a ESTE cliente (mais recente primeiro)
  const vistos = (_mostrados.get(String(chatId)) || []).slice().reverse();
  for (const v of vistos) {
    const id = ids.find(i => _normFicha(db[i].nome) === _normFicha(v.nome));
    if (id && !candidatos.includes(id)) candidatos.push(id);
  }
  if (!candidatos.length) return '';
  const blocos = candidatos.slice(0, 2).map((id) => {
    const x = db[id]; const f = x.ficha || {};
    return 'FICHA TÉCNICA — ' + x.nome + (x.tipico ? ' (specs TÍPICAS deste tipo de produto, não do exemplar exacto)' : '') + ':\n' +
      (f.para_que_serve ? '- Serve para: ' + f.para_que_serve + '\n' : '') +
      (f.compatibilidade && f.compatibilidade.length ? '- Compatível com: ' + f.compatibilidade.join('; ') + '\n' : '') +
      (f.specs && f.specs.length ? '- Specs: ' + f.specs.join(' · ') + '\n' : '') +
      (f.nao_confirmado && f.nao_confirmado.length ? '- ⛔ NÃO CONFIRMADO (nunca afirmes; se perguntarem, oferece confirmar com a equipa): ' + f.nao_confirmado.join('; ') + '\n' : '');
  });
  return '\nFICHAS TÉCNICAS dos produtos em conversa (pesquisadas pelo nosso investigador — usa-as para responder a perguntas técnicas TU MESMO, sem "vou confirmar"):\n' +
    blocos.join('') +
    'O que não está na ficha nem no catálogo continua a NÃO se inventar.\n';
}

function findProductImage(name) {
  const imgs = catalogCache.images || {};
  const q = (name || '').toLowerCase().trim();
  if (!q) return null;
  if (imgs[q]) return imgs[q];
  // Mesma armadilha da legenda: escolher pelo nome mais LONGO fazia
  // "Fones de ouvido X83" apanhar a foto de outro produto com nome comprido.
  // A escolha certa é o produto que a legenda também vai usar — assim a foto e
  // o preço nunca se separam.
  const p = acharProdutoCatalogo(name);
  if (p) {
    const chave = String(p.name || '').toLowerCase().trim();
    if (imgs[chave]) return imgs[chave];
    const alt = Object.keys(imgs).find(k => _normProd(k) === _normProd(p.name));
    if (alt) return imgs[alt];
  }
  // fallback conservador: correspondência mais próxima em comprimento
  const qn = _normProd(q);
  let best = null, melhorDif = Infinity;
  for (const k of Object.keys(imgs)) {
    const kn = _normProd(k);
    if (kn.includes(qn) || qn.includes(kn)) {
      const dif = Math.abs(kn.length - qn.length);
      if (dif < melhorDif) { best = imgs[k]; melhorDif = dif; }
    }
  }
  return best;
}

// Regista um produto desejado (que não temos) e avisa o Carlos — sinal de procura/stock.
// Agrupa por produto (conta pedidos); notifica no 1º pedido e a cada milestone (2,3,5,10...),
// com anti-spam de 1x/hora por produto.
// Palavras que a IA cola às descrições e que não identificam produto nenhum —
// sem as tirar, "Acessórios tipo 'brinco'" e "Brincos/earrings" ficam a contar
// como dois produtos diferentes.
const STOP_DESEJO = new Set(['para', 'com', 'sem', 'tipo', 'estilo', 'acessorio', 'acessorios',
  'produto', 'produtos', 'cliente', 'clientes', 'pediu', 'pedido', 'pedidos', 'solicitado',
  'especifico', 'especifica', 'verdade', 'claro', 'nunca', 'mencionado', 'mencionados',
  'faixa', 'nesta', 'neste', 'retorno', 'fotos', 'foto', 'mais', 'muito', 'outro', 'outra']);
function _termosDesejo(s) {
  // ̀-ͯ escrito com escapes de propósito: marcas combinatórias
  // literais no ficheiro já nos deram um susto (bytes estranhos numa edição)
  return [...new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(t => t.length >= 4 && !STOP_DESEJO.has(t))
    .map(t => t.replace(/s$/, '')))];   // brinco/brincos = o mesmo pedido
}
// Agrupa pelo CONCEITO, não pela frase. A IA descreve o mesmo pedido de 9
// maneiras ("brinco", "Brincos/earrings", "Earrings/brincos"…) e com chave
// exacta ficavam 9 itens de 1x — nenhum chegava ao filtro count>=2 do cérebro,
// ou seja a lista de interesse existia mas não influenciava decisão nenhuma.
function acharDesejo(wl, produto) {
  const t = _termosDesejo(produto);
  if (!t.length) return wl.find(w => w.produtoKey === produto.toLowerCase().trim()) || null;
  for (const w of wl) {
    const tw = w.termos && w.termos.length ? w.termos : _termosDesejo(w.produto);
    const comuns = t.filter(x => tw.includes(x)).length;
    if (comuns && comuns / Math.min(t.length, tw.length) >= 0.5) return w;
  }
  return null;
}
function recordWish(produto, cliente, platform) {
  try {
    const key = produto.toLowerCase().trim();
    const wl = loadJSON(WISHLIST_LOG);
    let item = acharDesejo(wl, produto);
    if (!item) {
      item = { produto, produtoKey: key, termos: _termosDesejo(produto), count: 0,
               variantes: [], clientes: [], plataformas: [], primeiro: new Date().toISOString() };
      wl.push(item);
    }
    // guardar a frase original: agrupar contagens não pode apagar o que o
    // cliente realmente disse (é isso que diz ao dono o que comprar)
    item.variantes = item.variantes || [];
    if (produto !== item.produto && !item.variantes.includes(produto)) item.variantes.push(produto);
    // `count` conta REGISTOS, não clientes: a destilação reanalisa as mesmas
    // conversas e re-frasea o mesmo pedido, logo 9 registos podiam ser 1 cliente
    // (foi o caso do "brinco"). Quem decide compras precisa dos dois números.
    item.count++;
    item.registos = item.count;
    item.ultimo = new Date().toISOString();
    if (cliente && !item.clientes.includes(cliente)) item.clientes.push(cliente);
    if (platform && !item.plataformas.includes(platform)) item.plataformas.push(platform);
    saveJSON(WISHLIST_LOG, wl);
    log('INFO', `[DESEJO] "${produto}" (${item.count}x) → lista de desejos`);
    // notificar Carlos: 1º pedido, milestones, e nunca mais de 1x/hora por produto
    const last = _wishNotified.get(key) || 0;
    const milestone = [1, 2, 3, 5, 10, 20, 50].includes(item.count);
    if ((milestone || Date.now() - last > 6 * 3600 * 1000) && Date.now() - last > 60 * 60 * 1000) {
      _wishNotified.set(key, Date.now());
      notifyCarlos('💡 *PROCURA (não temos)*\nProduto: ' + produto + '\nJá pedido ' + item.count + 'x por ' + item.clientes.length + ' cliente(s) (' + item.plataformas.join('/') + ')\nVale a pena stockar?');
    }
  } catch (e) { log('WARN', '[DESEJO] ' + e.message); }
}

// Detecta <<FOTO>> / <<DESEJO>> / <<PEDIDO>> / <<HUMANO>>, age e limpa a resposta
async function processMarkers(reply, senderId, senderName, platform) {
  const out = { reply: reply || '', pedido: false, humano: false, fotoUrls: [], fotoPedidos: [], catalogo: null };
  // FOTOS — pode haver várias; recolhe as URLs (enviadas após o texto)
  const fotos = [...out.reply.matchAll(/<<FOTO>>([\s\S]*?)<<FIM>>/g)];
  for (const m of fotos) {
    out.reply = out.reply.replace(m[0], '').trim();
    const nome = m[1].trim();
    // 14-Ago: o modelo reemite <<FOTO>> num "Ok" e reenvia a mesma foto (caso
    // Joelma). Não reenviar a MESMA foto ao mesmo cliente em 15 min — mas um
    // produto DIFERENTE passa (a chave é por produto).
    const chaveF = 'foto:' + _chaveConsulta(nome).slice(0, 30);
    if (accaoRecente(senderId, chaveF, 15 * 60000)) {
      log('INFO', `[FOTO] "${nome.slice(0, 30)}" ignorada — já enviada a ${senderName} há <15min`);
      continue;
    }
    marcarAccao(senderId, chaveF);
    const url = findProductImage(nome);
    if (url) out.fotoUrls.push(url);
    else log('INFO', `[FOTO] sem imagem de catálogo para "${nome.slice(0,30)}"`);
    // nome sempre registado: o WhatsApp resolve em cadeia (BD admin → catálogo → internet)
    out.fotoPedidos.push({ nome, catalogUrl: url || null });
    try { perfilClientes.interessouSe(senderId, nome); } catch (_) {}   // memória: perguntou por este produto
  }
  // CATÁLOGO PDF — gera e marca para envio (o handler da plataforma envia o doc)
  const mc = out.reply.match(/<<CATALOGO>>([\s\S]*?)<<FIM>>/);
  if (mc) {
    out.reply = out.reply.replace(mc[0], '').trim();
    // não reenviar a quem já recebeu nas últimas 6h (o "Ok" do Rainho reemitia
    // o marcador). O texto de acompanhamento fica; só o PDF é que não repete.
    if (catalogoRecente(senderId)) {
      log('INFO', `[CATALOGO] ignorado — já enviado a ${senderName} nas últimas 6h`);
    } else {
      let o = {}; try { o = JSON.parse(mc[1].trim()); } catch {}
      out.catalogo = { categoria: o.categoria || null, filtro: o.filtro || null, template: o.template || null };
    }
  }
  // LISTA DE DESEJOS — produto que não temos; regista e avisa o Carlos
  const md = [...out.reply.matchAll(/<<DESEJO>>([\s\S]*?)<<FIM>>/g)];
  for (const m of md) {
    out.reply = out.reply.replace(m[0], '').trim();
    const produto = (m[1] || '').trim();
    if (produto) recordWish(produto, senderName, platform);
    try { if (produto) perfilClientes.interessouSe(senderId, produto + ' (não tínhamos)'); } catch (_) {}
  }
  // ENCOMENDA
  const mp = out.reply.match(/<<PEDIDO>>([\s\S]*?)<<FIM>>/);
  if (mp) {
    out.pedido = true;
    out.reply = out.reply.replace(mp[0], '').trim();
    let ped = {};
    try { ped = JSON.parse(mp[1].trim()); } catch {}
    ped.plataforma = platform; // plataforma REAL do webhook (não a adivinhada pela IA)
    ped.senderId = senderId;
    ped.timestamp = new Date().toISOString();
    ped.id = 'enc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    ped.estado = 'pendente';   // pendente → confirmada → entregue | cancelada

    // Taxa calculada pelo codigo a partir da morada: a IA nao faz a conta nem
    // escolhe o preco. Se a zona nao for identificada, fica para o Carlos decidir.
    const ent = deliveryZones.estimate(ped.morada || '');
    ped.entrega = ent.foraDeCobertura
      ? { zona: 'FORA DE LUANDA (' + ent.provincia + ')', taxa: null, confirmado: false, nota: 'confirmar com a equipa se há envio' }
      : ent.encontrado && !ent.ambiguo
        ? { zona: ent.zona, taxa: ent.taxa, confirmado: ent.confirmado, confianca: ent.confianca }
        : { zona: null, taxa: null, confirmado: false, nota: 'zona não identificada na morada' };

    // DUPLICADOS (2-Ago): o Nilton apareceu 4x na lista — 1 venda registada 4
    // vezes porque a IA reemite o marcador sempre que o cliente reconfirma
    // morada/produto. O dono via 5 encomendas pendentes onde havia 2, e podia
    // ligar (ou entregar) quatro vezes ao mesmo cliente.
    // Mesma pessoa + mesmo produto + ainda pendente + <24h = É A MESMA venda:
    // actualiza-se a existente em vez de criar outra.
    const orders = loadJSON(ORDERS_LOG);
    const agoraMs = Date.now();
    const iguais = orders.filter(o =>
      String(o.senderId || '') === String(ped.senderId || '') &&
      (!o.estado || o.estado === 'pendente') &&
      agoraMs - Date.parse(o.timestamp || 0) < 24 * 3600000 &&
      mesmoProduto(o.itens, ped.itens));
    const duplicada = iguais.length ? iguais[iguais.length - 1] : null;
    if (duplicada) {
      // actualiza a existente (a última versão dos dados é a boa) e NÃO volta a
      // avisar o dono — mas continua o processamento dos outros marcadores
      Object.assign(duplicada, ped, { id: duplicada.id, timestamp: duplicada.timestamp,
        actualizadoEm: new Date().toISOString(), reconfirmacoes: (duplicada.reconfirmacoes || 0) + 1 });
      saveJSON(ORDERS_LOG, orders);
      log('INFO', `[ENCOMENDA] ${ped.nome || '?'} reconfirmou — actualizei ${duplicada.id} em vez de duplicar`);
      if (!out.reply) out.reply = 'Já tenho a tua encomenda registada! ✅ A nossa equipa vai ligar a confirmar. Obrigado! 🛍️';
    } else {
    orders.push(ped); saveJSON(ORDERS_LOG, orders);
    try { perfilClientes.encomendou(senderId, (ped.itens || ped.produto || 'encomenda') + ''); } catch (_) {}

    const linhaEntrega = ped.entrega.taxa === null
      ? '🚚 Entrega: ZONA POR CONFIRMAR (' + (ped.morada || '?') + ')'
      : '🚚 Entrega: ' + ped.entrega.zona + ' — ' + ped.entrega.taxa.toLocaleString('pt-PT') + ' Kz' +
        (ped.entrega.confirmado ? '' : ' (estimativa, confirma)');

    // DOIS números de propósito: o que o cliente escreveu (pode estar errado ou
    // ser de outra pessoa) e o do WhatsApp de onde falou (resolvido do @lid).
    // Quando falham as chamadas para o primeiro, é o segundo que salva a venda.
    const waNum = logConversation._telefone || '';
    const digitado = String(ped.telefone || '').replace(/\D/g, '');
    const linhaWA = waNum && waNum !== digitado
      ? '\n💬 WhatsApp: +' + waNum + '  (wa.me/' + waNum + ')'
      : (waNum ? '  (wa.me/' + waNum + ')' : '');

    const msg = '🛒 *NOVA ENCOMENDA* (' + ped.plataforma + ')\n' +
      '👤 ' + (ped.nome || '?') + '\n' +
      '📍 ' + (ped.morada || '?') + '\n' +
      '📞 ' + (ped.telefone || '?') + linhaWA + '\n' +
      '📦 ' + (ped.itens || '?') + '\n' +
      '💰 ' + (ped.total || 'a confirmar') + '\n' +
      linhaEntrega + '\n' +
      '— SuperLoja bot';
    // com a FOTO do artigo: o dono vê logo o que foi vendido, sem ir ao catálogo
    notifyCarlosComFoto(msg, ped.itens);
    log('INFO', `[ENCOMENDA] ${ped.nome || '?'} | ${ped.itens || '?'} → Carlos notificado`);
    if (!out.reply) out.reply = 'Encomenda registada! ✅ A nossa equipa vai ligar já a confirmar. Obrigado! 🛍️';
    }   // fim do ramo "encomenda nova" (o outro ramo actualizou uma duplicada)
  }
  // PROMESSA DE COMPRA ("depois compro", "no sábado"...) — marcar para cobrar na data
  const mdp = out.reply.match(/<<DEPOIS>>([\s\S]*?)<<FIM>>/);
  if (mdp) {
    out.reply = out.reply.replace(mdp[0], '').trim();
    let p = {};
    try { p = JSON.parse(mdp[1].trim()); } catch {}
    // guarda-costas do código: a data tem de ser válida e futura (a IA às vezes erra)
    let quando = String(p.quando || '').slice(0, 10);
    const hoje = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(quando) || quando <= hoje) {
      const d = new Date(Date.now() + 3 * 86400000 + 3600000);   // fallback: +3 dias
      quando = d.toISOString().slice(0, 10);
    }
    const promessas = loadJSON(PROMESSAS_LOG);
    // 1 promessa activa por cliente: nova promessa substitui a anterior não cobrada
    const idx = promessas.findIndex(x => x.senderId === senderId && !x.cobrado);
    const nova = {
      senderId, senderName, plataforma: platform,
      quando, nota: String(p.nota || '').slice(0, 140), produto: String(p.produto || '').slice(0, 80),
      criadoEm: new Date().toISOString(), cobrado: false
    };
    if (idx >= 0) promessas[idx] = nova; else promessas.push(nova);
    saveJSON(PROMESSAS_LOG, promessas);
    log('INFO', `[PROMESSA] ${senderName} (${platform}) → cobrar em ${quando}${nova.produto ? ' (' + nova.produto + ')' : ''}`);
  }
  // CONSULTAR HERMES — dúvida factual/negócio. AO VIVO: o cérebro tenta decidir
  // JÁ (~30s) e o bot entrega na mesma conversa; a fila das 10h/22h e o dono
  // continuam como rede de segurança para o que o cérebro não aprovar.
  const mcon = out.reply.match(/<<CONSULTAR>>([\s\S]*?)<<FIM>>/);
  if (mcon) {
    out.reply = out.reply.replace(mcon[0], '').trim();
    const pergunta = (mcon[1] || '').trim();
    // 14-Ago: sem dedup, um "Ok" reemitia <<CONSULTAR>> e disparava o cérebro
    // 2× → o bot respondeu 2× à mesma pergunta (caso Buanda, 57s). Não reabrir a
    // mesma consulta (por cliente+pergunta normalizada) em 10 min.
    const chaveC = 'consulta:' + _chaveConsulta(pergunta);
    if (pergunta && accaoRecente(senderId, chaveC, 10 * 60000)) {
      log('INFO', `[CONSULTAR] ${senderName}: mesma pergunta em <10min — não reabri consulta nem chamei o cérebro`);
      if (!out.reply) out.reply = 'Ainda estou a confirmar isso — já volto com a resposta! 😊';
    } else if (pergunta) {
      marcarAccao(senderId, chaveC);
      const cons = loadJSON(CONSULTAS_FILE);
      const novaConsulta = { id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), chatId: senderId, senderName, platform, pergunta, criadoEm: new Date().toISOString(), resolvido: false };
      cons.push(novaConsulta);
      saveJSON(CONSULTAS_FILE, cons.slice(-200));
      out.consultou = true;
      log('INFO', `[CONSULTAR] ${senderName} (${platform}): "${pergunta.slice(0, 60)}" → cérebro ao vivo (fila como rede de segurança)`);
      cerebroAoVivo(novaConsulta.id, senderId, senderName, platform, pergunta);
      if (shouldNotifyFail('consulta:' + senderId)) notifyCarlos('❓ *DÚVIDA DE CLIENTE* (' + platform + ')\nCliente: ' + senderName + linhaContacto(senderId) +
        '\nPergunta: ' + pergunta + '\n(o cérebro Hermes está a tentar responder AO VIVO — se não aprovar, fica na fila para ti)');
    }
    if (!out.reply) out.reply = 'Deixa-me confirmar isso certinho e já volto com a resposta! 😊';
  }
  // PEDIDO DE HUMANO
  const mh = out.reply.match(/<<HUMANO>>([\s\S]*?)<<FIM>>/);
  if (mh) {
    out.humano = true;
    out.reply = out.reply.replace(mh[0], '').trim();
    const razao = (mh[1] || '').trim();
    // 14-Ago: o modelo reemitia <<HUMANO>> a cada "Ok" e o dono era avisado
    // 2-3× por conversa (medido: alguns a 47s). Cooldown de 30 min por cliente
    // — mas a chave inclui a razão normalizada, por isso um motivo NOVO
    // (o cliente passou de "preço" para "reclamação") passa na mesma. Alerta
    // repetido = alerta ignorado; a lei 2/3 depende de o dono ligar a estes.
    const chaveH = 'humano:' + _chaveConsulta(razao);
    if (accaoRecente(senderId, chaveH, 30 * 60000)) {
      log('INFO', `[ESCALADO] ${senderName}: aviso repetido em <30min (mesma razão) — não re-notifiquei o dono`);
    } else {
      marcarAccao(senderId, chaveH);
      notifyCarlos('🙋 *CONVERSA PRECISA DE TI* (' + platform + ')\nCliente: ' + senderName + linhaContacto(senderId) +
        '\nMotivo: ' + razao + '\nEntra no ' + (platform === 'instagram' ? 'Instagram' : platform === 'whatsapp' ? 'WhatsApp' : 'Messenger') + ' para assumir.');
      log('INFO', `[ESCALADO] ${senderName} | ${razao} → Carlos notificado`);
    }
    if (!out.reply) out.reply = 'Vou chamar já um colega para te ajudar melhor. Um momento! 🙌';
  }
  // MARCADOR ÓRFÃO — rede determinística. Todos os marcadores são pedidos ao
  // modelo NO FIM da mensagem, e o tecto de 400 tokens corta pela cauda: um
  // corte no sítio errado deixa '<<PEDIDO>>{"nome":"...","telefone":"9428...'
  // sem o '<<FIM>>' que as regexes acima exigem — e o cliente receberia os
  // próprios dados em texto cru. Ainda não aconteceu (0 em 321 respostas
  // guardadas), mas custa uma linha e o que está em jogo é uma encomenda.
  const orfao = out.reply.match(/<<[A-Z]+>>[\s\S]*$/);
  if (orfao) {
    log('WARN', '[MARCADOR] cortado a meio, removido antes de enviar: ' + orfao[0].slice(0, 90));
    out.reply = out.reply.replace(/<<[A-Z]+>>[\s\S]*$/, '').trim();
    if (!out.reply) out.reply = 'Deixa-me confirmar isso certinho e já volto com a resposta! 😊';
  }
  return out;
}

// CÉREBRO AO VIVO — a dúvida não espera pela fila das 10h/22h: o Hermes decide
// já (~30s, no dashboard :3333 que tem os factos+guarda) e o bot entrega na
// MESMA conversa. Só respostas APROVADAS (guarda limpa + seguro:true) chegam ao
// cliente; o resto fica na fila para o dono, como antes. A resposta vira FAQ —
// a próxima vez que perguntarem, o bot responde em 2s sem incomodar ninguém.
function cerebroAoVivo(consultaId, chatId, senderName, platform, pergunta) {
  const corpo = Buffer.from(JSON.stringify({ pergunta }), 'utf8');
  const req2 = require('http').request({
    host: '127.0.0.1', port: 3333, path: '/api/hermes/cerebro', method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': corpo.length },
  }, res2 => {
    let d = ''; res2.on('data', c => d += c);
    res2.on('end', async () => {
      try {
        const r = JSON.parse(d);
        if (!r || !r.aprovada || !r.resposta) {
          const motivo = (r && r.motivo) || 'sem resposta';
          log('INFO', `[CEREBRO-VIVO] não aprovada (${motivo}) — fica na fila p/ o dono`);
          // 10-Ago, Buanda: o cérebro respondeu em 43s e reprovou-se a si próprio
          // DUAS vezes. "Fica na fila p/ o dono" era só um INFO no log — a fila
          // é lida às 10h e às 22h, e a consulta só foi resolvida às 05:37 do dia
          // seguinte: 8h30 com o cliente à espera, e o dono teve de assumir a
          // conversa à mão sem saber que havia uma resposta pronta a um toque.
          // O cliente está à espera AGORA; o dono tem de saber AGORA.
          try {
            notifyCarlos('🧠 *O cérebro não aprovou a resposta* (' + platform + ')\n' +
              'Cliente: ' + senderName + '\nPerguntou: "' + String(pergunta).slice(0, 120) + '"\n' +
              'Motivo: ' + String(motivo).slice(0, 80) +
              (r && r.resposta ? '\n\nO que ele ia responder:\n"' + String(r.resposta).slice(0, 240) + '"' : '') +
              '\n\n👉 O cliente está à espera. Responde-lhe ou aprova no dashboard.');
          } catch (_) {}
          return;
        }
        // TERCEIRO caminho de envio — e o de janela maior. Este pedido espera
        // até 240s pelo cérebro (req2.setTimeout mais abaixo) e é disparado sem
        // await, de dentro do processMarkers: quando o fluxo principal aborta em
        // 1713/1827 por o dono ter assumido a conversa, ESTE já vai em voo e
        // entregava por cima dele na mesma. A correcção dos 75s fechou dois
        // caminhos e deixou este aberto — a mesma guarda tem de estar aqui.
        if (_dj(String(chatId)).pausadoAte > Date.now()) {
          log('WARN', `[CEREBRO-VIVO] resposta abortada — assumiste a conversa enquanto o cérebro pensava (${chatId})`);
          return;
        }
        const envio = await enviarAoCliente(chatId, platform, r.resposta);
        if (!envio.ok) { log('WARN', `[CEREBRO-VIVO] resposta pronta mas envio falhou: ${envio.error}`); return; }
        // marcar resolvida — o cron das 10h/22h não pode responder 2ª vez
        const cons = loadJSON(CONSULTAS_FILE);
        const c = cons.find(x => x.id === consultaId);
        if (c) { c.resolvido = true; c.resolvidoEm = new Date().toISOString(); c.via = 'cerebro-ao-vivo'; c.resposta = String(r.resposta).slice(0, 300); saveJSON(CONSULTAS_FILE, cons); }
        // ensinar: vira FAQ para a próxima vez ser instantânea
        try {
          const normq = s => String(s || '').toLowerCase().replace(/[^a-z0-9À-ſ ]/gi, '').trim();
          const k = loadKnowledge() || { faq: [] };
          k.faq = k.faq || [];
          if (!k.faq.some(f => normq(f.pergunta) === normq(pergunta))) {
            k.faq.unshift({ pergunta: pergunta.slice(0, 160), resposta: String(r.resposta).slice(0, 400), ensinado: true, fonte: 'cérebro Hermes (ao vivo)', em: new Date().toISOString() });
            k.faq = k.faq.slice(0, 40);
            fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(k, null, 2), 'utf8');
          }
        } catch {}
        log('INFO', `[CEREBRO-VIVO] respondido a ${senderName} (${platform}) em ${r.segundos || '?'}s e ensinado à FAQ`);
        // AUTO-FICHA guiada pela procura (14-Ago): se a pergunta era TÉCNICA
        // sobre um produto do catálogo SEM ficha, gera-se a ficha em fundo. O
        // cliente de agora já foi respondido; o PRÓXIMO que perguntar sobre este
        // produto tem resposta instantânea (a ficha entra no prompt) em vez de
        // outro "vou confirmar". As 75 fichas em falta preenchem-se sozinhas, na
        // ordem em que os clientes realmente perguntam — o sinal de procura mais
        // honesto que há. Fire-and-forget: nunca atrasa nem parte o atendimento.
        autoGerarFicha(pergunta, chatId);
      } catch (e) { log('WARN', '[CEREBRO-VIVO] ' + e.message); }
    });
  });
  req2.on('error', e => log('WARN', '[CEREBRO-VIVO] dashboard indisponível: ' + e.message));
  req2.setTimeout(240000, () => req2.destroy());
  req2.write(corpo); req2.end();
}

// A pergunta é técnica sobre um produto do catálogo que ainda não tem ficha?
// Se sim, pede ao dashboard para a gerar (investigador + web + visão). Uma vez
// por produto: a ficha fica guardada e o disparo seguinte vê-a e não repete.
const RE_TECNICA = /bateria|autonomia|carga|dura|compat[íi]vel|funciona (com|no|em)|liga (a|ao|no)|entrada|conector|usb|bluetooth|sem fio|com fio|potenc|watt|volt|mah|alcance|cancelamento|ru[íi]do|anc|resolu[çc]|polega|tamanho|medida|cor|material/i;
function autoGerarFicha(pergunta, chatId) {
  try {
    if (!RE_TECNICA.test(String(pergunta || ''))) return;   // não é técnica
    let p = acharProdutoCatalogo(pergunta);
    // se a pergunta não nomeia bem o produto ("demora carga?"), usar o que o
    // bot ACABOU de mostrar a este cliente — é quase de certeza sobre esse
    if (!p && chatId) {
      const vistos = (_mostrados.get(String(chatId)) || []).filter(x => Date.now() - x.quando < 30 * 60000);
      if (vistos.length) p = acharProdutoCatalogo(vistos[vistos.length - 1].nome);
    }
    if (!p) return;                                          // não casa produto do catálogo
    const fichas = loadFichas();
    const jaTem = Object.values(fichas).some(f => String(f.nome).toLowerCase() === String(p.name).toLowerCase() && (f.ficha || f.visao));
    if (jaTem) return;                                       // já tem ficha
    const corpo = Buffer.from(JSON.stringify({ nome: p.name }), 'utf8');
    const req = require('http').request({
      host: '127.0.0.1', port: 3333, path: '/api/produtos/ficha', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': corpo.length },
    }, res => { res.on('data', () => {}); res.on('end', () => log('INFO', `[AUTO-FICHA] gerada para "${p.name.slice(0, 40)}" (pergunta técnica sem ficha)`)); });
    req.on('error', () => {});
    req.setTimeout(200000, () => req.destroy());
    req.write(corpo); req.end();
  } catch (_) {}
}

// Reaprendizagem debounced (máx 1x/hora) — mantém o bot sempre a melhorar
let _lastLearn = 0;
function maybeAutoLearn() {
  if (Date.now() - _lastLearn < 60 * 60 * 1000) return;
  _lastLearn = Date.now();
  learnFromConversations().then(k => log('INFO', `[APRENDER-AUTO] ${(k.faq || []).length} FAQ`)).catch(() => {});
}

// ─── Express Routes ──────────────────────────────────────────────────────────
const app = express();
// 8mb: as fotos do WhatsApp chegam em base64 do bridge (limite de origem 4MB
// de ficheiro ≈ 5.3MB em base64); o default de 100kb rejeitava-as todas.
// `verify` guarda o corpo CRU: é sobre os bytes exactos que a Meta assina, e
// tem de ser o mesmo texto — re-serializar o JSON mudaria a assinatura.
app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// 14-Ago: o GET /webhook já valida o verify_token, mas o POST /webhook — que
// é a porta por onde entram as mensagens e está EXPOSTA na Internet (cloudflared
// superloja.cc/webhook) — não verificava a assinatura X-Hub-Signature-256. Quem
// descobrisse a URL podia injectar mensagens falsas de cliente e pôr o bot a
// responder/encomendar em nome de alguém. Agora verifica-se o HMAC-SHA256 do
// corpo cru com o APP_SECRET da Meta.
// ⚠️ SÓ activa quando META_APP_SECRET existir no .env: sem ele, mantém-se o
// comportamento actual (deixa passar) para não trancar o webhook por engano —
// mas fica um WARN no arranque a dizer que a porta está aberta.
const META_APP_SECRET = process.env.META_APP_SECRET || process.env.FB_APP_SECRET || process.env.APP_SECRET || '';
function assinaturaMetaValida(req) {
  if (!META_APP_SECRET) return true;   // não configurado: não bloquear (com aviso no arranque)
  try {
    const cab = String(req.headers['x-hub-signature-256'] || '');
    if (!cab.startsWith('sha256=')) return false;
    const esperado = 'sha256=' + require('crypto').createHmac('sha256', META_APP_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    const a = Buffer.from(cab); const b = Buffer.from(esperado);
    return a.length === b.length && require('crypto').timingSafeEqual(a, b);   // comparação em tempo constante
  } catch { return false; }
}

// Webhook verification (GET /webhook)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    log('INFO', '✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    log('WARN', '⚠️ Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook events (POST /webhook) — Messenger (object=page) + Instagram DM (object=instagram)
app.post('/webhook', (req, res) => {
  // autenticidade primeiro: se a assinatura da Meta não bate, é pedido forjado.
  // Responde-se 200 na mesma (não dar pistas a quem sonda) mas NÃO se processa.
  if (!assinaturaMetaValida(req)) {
    log('WARN', `[WEBHOOK] assinatura inválida — pedido ignorado (${req.socket.remoteAddress || '?'})`);
    return res.status(200).send('EVENT_RECEIVED');
  }
  const body = req.body;

  if (body.object !== 'page' && body.object !== 'instagram') {
    res.sendStatus(404);
    return;
  }
  const platform = body.object === 'instagram' ? 'instagram' : 'messenger';

  // Responde imediatamente (Meta exige < 20s) e processa em background
  res.status(200).send('EVENT_RECEIVED');

  (async () => {
    for (const entry of (body.entry || [])) {
      // COMENTÁRIOS em posts (entry.changes): FB field=feed item=comment; IG field=comments
      for (const ch of (entry.changes || [])) {
        try {
          const v = ch.value || {};
          if (ch.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
            await handleComment(v.comment_id, v.message, v.from && v.from.id, 'messenger');
          } else if (ch.field === 'comments') { // Instagram
            await handleComment(v.id, v.text, v.from && v.from.id, 'instagram');
          }
        } catch (e) { log('WARN', 'comment handler: ' + e.message); }
      }
      // Instagram usa entry.messaging tal como o Messenger (Messenger Platform unificado)
      for (const event of (entry.messaging || [])) {
        if (!event.message) continue;

        // ECHO: mensagem enviada PELA página. Se não foi o nosso bot, é o DONO a responder
        // à mão → captura como material de aprendizagem (ouro) + arma HANDOFF.
        // Antes (07-Ago): só capturava a resposta para treino e fazia continue.
        // O bot continuava a responder por cima do dono — 29 vezes em Messenger/IG,
        // 0 handoffs armados. Agora: se o echo não é do bot, o dono respondeu → calar o bot.
        if (event.message.is_echo) {
          // LOG DE DIAGNÓSTICO: registar todos os campos do echo para perceber a
          // estrutura real do webhook da Meta (Messenger vs Instagram). Responde a:
          // recipient.id vem null em Messenger? há app_id? há mid?
          try {
            log('INFO', '[ECHO-DIAG] ' + JSON.stringify({
              platform,
              sender: event.sender,
              recipient: event.recipient,
              app_id: event.message.app_id,
              mid: event.message.mid,
              hasText: !!event.message.text,
              hasAttachments: !!(event.message.attachments && event.message.attachments.length),
            }));
          } catch (_) {}

          if (event.message.text && !wasSentByBot(event.message.text)) {
            const customerId = event.recipient && event.recipient.id;
            recordHumanAnswer(customerId, platform, event.message.text);
          }
          // ⚠️ AQUI NÃO SE ARMA HANDOFF — e a razão é importante.
          // Houve aqui, entre as 14:59 e as 16:0x de 07-Ago, um bloco que fazia
          // _pausar(customerId, +1h, 'handoff') quando o eco não batia com o
          // wasSentByBot. Foi removido porque o pressuposto "eco que não
          // reconheço = o dono" é FALSO, e os nossos próprios dados provam-no:
          // em chatbot-training.json, das 29 "respostas humanas" capturadas,
          // 5 são "Oi! Como podemos ajudar?" (saudação automática da Business
          // Suite, em pt-BR) e 1 é uma resposta ENLATADA DO BOT que já escapou
          // ao wasSentByBot. Todas apareceram como PRIMEIRA mensagem de um
          // cliente novo — ou seja, o handoff calava o bot 1h a quem acabava
          // de chegar, antes de dizer o que queria.
          // Pior: privateReply() (linha ~1378) manda DM a quem comenta num post
          // e é a ÚNICA função de envio à Meta que NÃO chama rememberBotSend().
          // O eco dessa DM calaria o bot exactamente sobre o lead do anúncio pago.
          // O mesmo padrão (eco fora do registo de envios) já produziu 238
          // falsos handoffs em 34 clientes no WhatsApp — está documentado em
          // data/prime-agent/saida/2026-08-07-eco-send-falhado.md.
          // O [ECHO-DIAG] acima fica: é o diagnóstico que falta. Quando houver
          // ecos reais registados, decidir pelo `app_id` (que distingue o
          // remetente de forma fiável), NUNCA por comparação de texto.
          continue;
        }

        // dedup: ignora reenvios do mesmo mid (evita resposta duplicada)
        if (alreadyProcessed(event.message.mid)) { log('INFO', `mid repetido ignorado`); continue; }

        const senderId = event.sender.id;
        const senderName = `User_${senderId}`;

        // ECHO SEM FLAG: se o sender é o próprio PAGE_ID, isto é um echo que
        // chegou sem is_echo (bug da Meta ou da Business Suite). O bot respondia
        // à própria página com respostas enlatadas ("Que legal! 💰"). Ignorar.
        if (PAGE_ID_SELF && String(senderId) === String(PAGE_ID_SELF)) {
          log('WARN', `[ECHO-SEM-FLAG] sender = PAGE_ID (${platform}) — provável echo sem is_echo. mid=${event.message.mid || 'null'} texto="${String(event.message.text || '').slice(0, 50)}"`);
          continue;
        }

        let messageText = event.message.text || '';
        const anexos = event.message.attachments || [];
        const imageUrls = anexos
          .filter(a => a.type === 'image' && a.payload && a.payload.url)
          .map(a => a.payload.url);
        // ÁUDIO/VÍDEO: sem isto, quem mandava SÓ uma nota de voz não recebia
        // NADA — a condição abaixo era falsa e o bot nem chegava a correr.
        // Silêncio total é a pior resposta possível a um cliente.
        const audios = anexos.filter(a => (a.type === 'audio' || a.type === 'video') && a.payload && a.payload.url);
        if (!messageText && !imageUrls.length && audios.length) {
          const trans = await transcreverAudio(audios[0].payload.url).catch(() => null);
          messageText = trans
            ? '[o cliente enviou uma nota de voz; isto é a transcrição:] ' + trans
            : '[o cliente enviou um ' + (audios[0].type === 'video' ? 'vídeo' : 'áudio') +
              ' que não consegues ouvir. Pede-lhe com simpatia para escrever em texto o que precisa]';
          log('INFO', `[ÁUDIO] ${platform}: ${trans ? 'transcrito (' + trans.length + ' chars)' : 'sem transcrição — pedido texto'}`);
        }
        if (messageText || imageUrls.length) {
          logConversation._platform = platform; // tag da plataforma p/ o registo
          await handleMessage(senderId, senderName, messageText, imageUrls);
        }
      }
    }
  })().catch(e => log('ERROR', `Webhook processing error: ${e.message}`));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    followup: {
      delayMinutes: FOLLOWUP_DELAY_MIN,
      pollMinutes: FOLLOWUP_POLL_MIN,
      maxHours: FOLLOWUP_MAX_HOURS,
      windowWAT: '08:00-20:00'
    }
  });
});

// ─── Gestão de encomendas: estados + feedback pós-entrega ─────────────────────
// pendente → confirmada → entregue | cancelada. Quem escreve em orders.json é
// SEMPRE o chatbot (o dashboard só faz proxy) — um único escritor, sem corridas.
const ESTADOS_VALIDOS = ['pendente', 'confirmada', 'entregue', 'cancelada'];

function soLoopback(req, res) {
  const ip = req.socket.remoteAddress || '';
  if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ip)) {
    res.status(403).json({ error: 'loopback only' });
    return false;
  }
  return true;
}

async function enviarAoCliente(senderId, platform, texto) {
  if (platform === 'whatsapp') return sendWhatsApp(senderId, formatForPlatform(texto, 'whatsapp'));
  const r = await sendMessage(senderId, formatForPlatform(texto, platform));
  return (r && r.__falhou) ? { ok: false, error: r.__falhou } : { ok: true };
}

app.post('/api/orders/estado', async (req, res) => {
  if (!soLoopback(req, res)) return;
  const { id, estado, refCode } = req.body || {};
  if (!id || !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: 'id e estado válido obrigatórios (' + ESTADOS_VALIDOS.join('|') + ')' });
  const orders = loadJSON(ORDERS_LOG);
  const o = orders.find(x => x.id === id);
  if (!o) return res.status(404).json({ error: 'encomenda não encontrada' });

  o.estado = estado;
  o.estadoEm = new Date().toISOString();

  // refCode opcional (SL-XXXX): liga a encomenda ao post/anúncio que a originou.
  // Se o código existir em sales-refs.json, regista a venda no ledger (alimenta
  // a aprendizagem com conversão real). Se não existir, ignora em silêncio.
  if (refCode && !o.refCode) {
    o.refCode = String(refCode).trim().toUpperCase().replace(/^(?!SL-)/, 'SL-').replace(/^SL-SL-/, 'SL-');
    log('INFO', `[ENCOMENDA ${id}] refCode ligado: ${o.refCode}`);
  }

  let feedback = null;

  // Entregue → agradecer e pedir opinião (gera confiança e reviews)
  if (estado === 'entregue' && o.senderId && !o.feedbackEnviado) {
    const txt = 'Olá ' + (String(o.nome || '').split(' ')[0] || '') + '! 😊 A tua encomenda foi entregue. ' +
      'Correu tudo bem? Se gostaste, conta-nos — e se algo não estiver certo, resolvemos já. Obrigado por comprares na SuperLoja! 🛍️';
    const r = await enviarAoCliente(o.senderId, o.plataforma || 'messenger', txt);
    o.feedbackEnviado = r.ok;
    feedback = r.ok ? 'pedido de feedback enviado ao cliente' : 'feedback NÃO enviado: ' + r.error;
    log(r.ok ? 'INFO' : 'WARN', `[ENCOMENDA ${id}] entregue — ${feedback}`);
  }

  // Se há refCode e a encomenda foi entregue, creditar a venda no sales-refs
  // (alimenta a aprendizagem com conversão real — o "sinal supremo" do PRD).
  let vendaCreditada = null;
  if (o.refCode && estado === 'entregue') {
    try {
      const salesFile = path.join(DATA_DIR, 'sales-refs.json');
      const salesDb = JSON.parse(fs.readFileSync(salesFile, 'utf8'));
      const ref = (salesDb.refs || []).find(r => r.code === o.refCode);
      if (ref) {
        const valorNum = Number(String(o.total || '').replace(/[^0-9]/g, '')) || 0;
        ref.sales.push({ valor: valorNum, nota: 'encomenda ' + o.id, ts: new Date().toISOString() });
        fs.writeFileSync(salesFile, JSON.stringify(salesDb, null, 2), 'utf8');
        vendaCreditada = 'venda creditada no código ' + o.refCode + ' (' + (valorNum ? valorNum.toLocaleString('pt-BR') + ' Kz' : 'sem valor') + ')';
        log('INFO', `[ENCOMENDA ${id}] ${vendaCreditada}`);
      }
    } catch (e) { log('WARN', `[ENCOMENDA ${id}] refCode ${o.refCode} não creditado: ${e.message}`); }
  }

  saveJSON(ORDERS_LOG, orders);
  log('INFO', `[ENCOMENDA ${id}] estado → ${estado}`);
  res.json({ ok: true, id, estado, feedback, refCode: o.refCode || null, vendaCreditada });
});

// Pendentes há >4h e ainda sem lembrete: devolve e MARCA (o watchdog entrega ao dono)
app.post('/api/orders/lembretes', (req, res) => {
  if (!soLoopback(req, res)) return;
  const orders = loadJSON(ORDERS_LOG);
  const agora = Date.now();
  const antigas = orders.filter(o =>
    (o.estado || 'pendente') === 'pendente' && !o.lembreteEnviado &&
    o.timestamp && (agora - Date.parse(o.timestamp)) > 4 * 3600000);
  antigas.forEach(o => { o.lembreteEnviado = true; });
  if (antigas.length) saveJSON(ORDERS_LOG, orders);
  res.json({ ok: true, antigas: antigas.map(o => ({ id: o.id, nome: o.nome, itens: o.itens, total: o.total, ha: Math.round((agora - Date.parse(o.timestamp)) / 3600000) + 'h' })) });
});

// ─── Follow-up de conversas abandonadas no WhatsApp ──────────────────────────
// O bot respondeu a uma dúvida/intenção de compra e o cliente ficou em silêncio:
// após 60 min, envia UMA verificação curta e sem pressão. Não é o Hermes que
// fala com o cliente — o bot continua a ser o único executor virado para fora.
//
// Guardas anti-spam/erro:
// - só WhatsApp, só 08h–20h WAT, uma vez por cliente;
// - última resposta entregue e gerada normalmente (não fallback);
// - última intenção purchase/question e sem despedida/desinteresse explícito;
// - sem encomenda, promessa, consulta Hermes, handoff ou disjuntor ativo;
// - relê conversations.json imediatamente antes do envio: se o cliente respondeu
//   enquanto o job corria, cancela.
const FOLLOWUPS_LOG = DATA_DIR + '/crm/followups.json';
const PROMESSAS_LOG = DATA_DIR + '/crm/promessas.json';
const FOLLOWUP_DELAY_MIN = Math.min(180, Math.max(30, Number(process.env.FOLLOWUP_DELAY_MINUTES) || 60));
const FOLLOWUP_POLL_MIN = Math.min(60, Math.max(5, Number(process.env.FOLLOWUP_POLL_MINUTES) || 10));
const FOLLOWUP_MAX_HOURS = Math.min(48, Math.max(2, Number(process.env.FOLLOWUP_MAX_HOURS) || 24));
const FOLLOWUP_MAX_RUN = 5;
const RE_ENCERROU_INTERESSE = /\b(n[ãa]o quero|j[áa] n[ãa]o|sem interesse|deixa estar|agora n[ãa]o|n[ãa]o preciso|obrigad[oa]|at[ée] logo|tchau)\b/i;
const RE_RESPOSTA_PENDENTE = /\b(falha t[ée]cnica|vou (confirmar|verificar)|deixa-me confirmar|j[áa] volto|chamar (um |uma )?(colega|pessoa)|equipa.*avisad)/i;
// O bot pediu os dados da encomenda e o cliente calou-se: é o lead mais quente
// que existe — está a UMA mensagem de comprar. Nunca pode escapar ao follow-up.
const RE_PEDIU_DADOS = /\b(nome completo|teu nome|que bairro|confirma\s+(o\s+)?bairro|qual (é |e )?(o )?teu bairro|onde (ficas|moras|est[áa]s)|morada|n[úu]mero de telefone|teu (n[úu]mero|contacto))\b/i;

// ─── REENGAJAMENTO: clientes de dias atrás ───────────────────────────────────
// O follow-up normal só apanha 60min–24h. Quem falou há 3 dias ficava perdido
// para sempre. Estes levam o CATÁLOGO (dá-lhes algo novo para ver) em vez de
// um "ainda tens interesse?" — e só UMA vez a cada 30 dias, para não incomodar.
const REENGAJAR_DIAS_MIN = Math.max(2, Number(process.env.REENGAJAR_DIAS_MIN) || 3);
const REENGAJAR_DIAS_MAX = Math.min(90, Number(process.env.REENGAJAR_DIAS_MAX) || 30);
const REENGAJAR_INTERVALO_DIAS = 30;
// a conta-gotas: 3 por corrida (de 10 em 10 min) esvazia uma fila de 18 em ~1h,
// espalhado — e não parece um disparo em massa a partir do número da loja
const REENGAJAR_MAX_CORRIDA = Math.max(1, Number(process.env.REENGAJAR_MAX_CORRIDA) || 3);

// ⚠️ PROMOÇÃO É DECISÃO DO DONO — NUNCA DO BOT.
// Ficheiro vazio (o estado normal) = o bot não menciona promoção nenhuma.
// Só quando o dono escreve aqui é que existe algo a anunciar, e mesmo assim o
// texto passa pela guarda antes de sair. Sem isto, "gerar uma promoção" seria
// o bot a inventar descontos que a loja não vai honrar.
const PROMOCAO_FILE = DATA_DIR + '/promocao-ativa.json';
function promocaoAtiva() {
  try {
    const p = JSON.parse(fs.readFileSync(PROMOCAO_FILE, 'utf8'));
    if (!p || !p.ativa || !String(p.texto || '').trim()) return null;
    if (p.validaAte && Date.parse(p.validaAte) < Date.now()) return null;   // expirou
    return { texto: String(p.texto).trim().slice(0, 220), validaAte: p.validaAte || null };
  } catch { return null; }
}
let _followupRunning = false;

function horaWAT(ms) {
  return new Date(ms + 3600000).getUTCHours();
}
function dentroHorarioFollowup(ms) {
  const h = horaWAT(ms);
  return h >= 8 && h < 20;
}
// Mensagem para quem falou há dias: em vez de "ainda tens interesse?" (que a
// esta distância soa a cobrança), damos-lhe algo NOVO — o catálogo em stock —
// e um passo fácil. A promoção só entra se o dono tiver declarado uma.
function mensagemReengajar(c) {
  const primeiro = String(c.nome || '').trim().split(/\s+/)[0];
  const nome = primeiro && primeiro !== 'Cliente' && !/^User_/i.test(primeiro) ? ' ' + primeiro : '';
  const dias = Math.round(c.silencioMin / 1440);
  const promo = promocaoAtiva();
  return 'Olá' + nome + '! 😊 Falámos há ' + (dias <= 7 ? 'uns dias' : 'algum tempo') + ' e entretanto entrou coisa nova. ' +
    'Deixo-te aqui o catálogo com tudo o que temos em stock 📄' +
    (promo ? '\n\n' + promo.texto : '') +
    '\n\nSe vires algo que te sirva, responde só com o nome ou o número que eu digo-te o total com a entrega. ' +
    'Se já não precisares, sem problema — não volto a incomodar.';
}

function mensagemFollowup(c) {
  const primeiro = String(c.nome || '').trim().split(/\s+/)[0];
  const nome = primeiro && primeiro !== 'Cliente' && !/^User_/i.test(primeiro) ? ' ' + primeiro : '';
  // Se o bot já lhe tinha pedido os dados, perguntar "ainda tens interesse?" é
  // dar um passo atrás. Ele já escolheu — falta só fechar.
  if (RE_PEDIU_DADOS.test(String(c.ultima.botResponse || ''))) {
    return 'Olá' + nome + '! 😊 Faltou-me só os teus dados para fechar a encomenda: nome, bairro e telefone. ' +
      'Manda tudo numa mensagem que eu trato do resto — se entretanto mudaste de ideias, sem problema.';
  }
  if (c.ultima.intent === 'question') {
    return 'Olá' + nome + '! 😊 Consegui esclarecer a tua dúvida? Se ainda tiveres interesse, estou por aqui; se já não precisares, sem problema.';
  }
  return 'Olá' + nome + '! 😊 Só para saber: ainda tens interesse no produto que vimos? Se já não precisares, sem problema — estou por aqui se quiseres continuar.';
}

// O dashboard coordena o conselho: Fugu analisa, o agente Hermes decide e AISA
// redige. Esta chamada não envia nada; o bot continua a ser o único executor.
function pedirDebateFollowup(c) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      nome: c.nome,
      intent: c.ultima.intent,
      silencioMin: c.silencioMin,
      mensagemCliente: String(c.ultima.userMessage || '').slice(0, 900),
      respostaBot: String(c.ultima.botResponse || '').slice(0, 900)
    }), 'utf8');
    const req = require('http').request({
      host: '127.0.0.1', port: 3333, path: '/api/hermes/followup', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length }
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        let out;
        try { out = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reject(new Error('resposta inválida do conselho')); }
        if (res.statusCode >= 400 || !out || !out.ok) {
          return reject(new Error(String((out && out.error) || ('HTTP ' + res.statusCode)).slice(0, 180)));
        }
        resolve(out);
      });
    });
    req.on('error', reject);
    // Fugu e Hermes pensam em série. O timeout é maior do que o de cada modelo,
    // mas a corrida será novamente validada antes de qualquer envio.
    req.setTimeout(480000, () => req.destroy(new Error('timeout no debate do follow-up')));
    req.write(body);
    req.end();
  });
}

function followupAindaSilencioso(c) {
  const ultimas = loadJSON(CONVERSATIONS_LOG)
    .filter(x => String(x.senderId || '') === c.id)
    .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
  if (!ultimas[0] || ultimas[0].timestamp !== c.ultima.timestamp) return false;
  let actividade = loadJSON(LAST_ACTIVITY_LOG);
  if (!actividade || Array.isArray(actividade) || typeof actividade !== 'object') actividade = {};
  const ultimaEntrada = Date.parse((actividade[c.id] && actividade[c.id].at) || 0);
  if (Number.isFinite(ultimaEntrada) && ultimaEntrada > c.quando + 1000) return false;
  return _dj(c.id).pausadoAte <= Date.now();
}

function candidatosFollowup(dados) {
  const { convos, orders, done, promessas, consultas, actividade, agora } = dados;
  // ANTES: 1 follow-up por cliente PARA TODA A VIDA. Um cliente que volta dias
  // depois, engata numa conversa nova e desaparece outra vez nunca mais era
  // contactado. Agora o bloqueio é por EPISÓDIO: se ele voltou a escrever
  // depois do último follow-up, é uma conversa nova e merece nova oportunidade.
  const ultimoFollowup = {};
  done.forEach(f => {
    const id = String(f.senderId), t = Date.parse(f.at || 0);
    if (id && Number.isFinite(t) && t > (ultimoFollowup[id] || 0)) ultimoFollowup[id] = t;
  });
  const jaFeito = new Set(done.filter(f => f.seed || f.ok !== false).map(f => String(f.senderId)));
  // 14-Ago: uma falha de INFRAESTRUTURA (bridge em baixo, ECONNREFUSED, timeout)
  // não é culpa do cliente e NÃO o deve excluir do follow-up. O registo com
  // ok:false já não entra em `jaFeito` (a tentativa repete-se quando o bridge
  // voltar) — mas o CONTADOR de falhas apanhava-a, e à `>= 2` matava o lead
  // para sempre. Dois clientes reais (74041..., 50092...) nunca mais receberam
  // follow-up por causa de um problema NOSSO. Agora só as falhas de ENTREGA (o
  // canal recusou mesmo a mensagem) contam para o limite das 2.
  const RE_FALHA_INFRA = /econnrefused|econnreset|etimedout|socket hang up|timeout|bridge|inacess|indispon|502|503|504/i;
  const falhas = {};
  done.filter(f => f.ok === false && !f.seed && !RE_FALHA_INFRA.test(String(f.erro || ''))).forEach(f => {
    const id = String(f.senderId); falhas[id] = (falhas[id] || 0) + 1;
  });
  const comprou = new Set(orders.map(o => String(o.senderId)));
  const prometeu = new Set(promessas.filter(p => !p.cobrado).map(p => String(p.senderId)));
  const consultaMaisRecente = {};
  consultas.forEach(q => {
    const id = String(q.chatId || q.senderId || '');
    const t = Date.parse(q.criadoEm || q.resolvidoEm || 0);
    if (id && Number.isFinite(t) && (!consultaMaisRecente[id] || t > consultaMaisRecente[id])) {
      consultaMaisRecente[id] = t;
    }
  });
  // TODOS os números que recebem avisos ficam fora do follow-up: seria absurdo
  // o bot perguntar "ainda tens interesse?" a quem trabalha na loja.
  const proprios = new Set([...numerosNotificados().map(n => n + '@s.whatsapp.net'),
    CARLOS_JID, '244954949595@s.whatsapp.net']);

  // A ordem do ficheiro costuma ser cronológica, mas a seleção usa timestamp
  // explicitamente: uma importação/restauro fora de ordem não cria falso silêncio.
  const porCliente = {};
  for (const c of convos) {
    const id = String(c.senderId || '');
    const quando = Date.parse(c.timestamp || 0);
    if (!id || !Number.isFinite(quando) || id.includes('status') ||
        id.endsWith('@g.us') || id.endsWith('@broadcast') || id.startsWith('comment_')) continue;
    // guardar TODAS as mensagens do cliente: a intenção de compra pode estar a
    // meio da conversa e não na última mensagem (ver filtro mais abaixo)
    const ant = porCliente[id];
    const mensagens = ant ? ant.mensagens : [];
    mensagens.push(c);
    if (!ant || quando > ant.quando) {
      porCliente[id] = {
        id, ultima: c, plataforma: c.platform || 'messenger',
        nome: c.senderName || 'Cliente', quando, mensagens
      };
    } else {
      ant.mensagens = mensagens;
    }
  }

  const candidatos = [];
  for (const info of Object.values(porCliente)) {
    const id = info.id, u = info.ultima;
    // já teve follow-up MAS voltou a escrever depois disso → episódio novo
    const episodioNovo = ultimoFollowup[id] && info.quando > ultimoFollowup[id] + 60000;
    // reengajamento: passaram 30 dias desde o último contacto nosso — pode-se
    // voltar a falar com ele mesmo que já tenha tido follow-up nessa altura
    const podeReengajar = !ultimoFollowup[id] || (agora - ultimoFollowup[id]) > REENGAJAR_INTERVALO_DIAS * 86400000;
    if (info.plataforma !== 'whatsapp' || (jaFeito.has(id) && !episodioNovo && !podeReengajar) ||
        (falhas[id] || 0) >= 2 || comprou.has(id) || prometeu.has(id) || proprios.has(id)) continue;
    // Uma consulta criada para ESTA última mensagem pode ainda estar em curso ou
    // já ter recebido resposta do cérebro ao vivo. Consultas antigas não devem
    // bloquear para sempre uma conversa nova do mesmo cliente.
    if (consultaMaisRecente[id] && consultaMaisRecente[id] >= info.quando - 60000) continue;
    // Uma entrada posterior pode ter sido suprimida pelo disjuntor e, por isso,
    // não existir em conversations.json. Mesmo assim é retorno do cliente.
    const ultimaEntrada = Date.parse((actividade[id] && actividade[id].at) || 0);
    if (Number.isFinite(ultimaEntrada) && ultimaEntrada > info.quando + 1000) continue;
    // ⚠️ O INTENT DA ÚLTIMA MENSAGEM NÃO CHEGA. Quem está a meio de uma compra
    // responde "3" ou "Que é o fhone" — o classificador diz `unknown` e o
    // follow-up excluía exactamente os leads mais quentes da loja (Ladisau_G
    // escolheu o produto 3 e o bot já lhe pedia a morada; Anthony Gabriel ia na
    // 10ª mensagem a dar o telefone). Dois sinais melhores:
    //   1. o bot ter PEDIDO OS DADOS na última mensagem = está quase fechado
    //   2. intenção em QUALQUER mensagem da conversa, não só na última
    const pediuDados = RE_PEDIU_DADOS.test(String(u.botResponse || ''));
    const intencaoNaConversa = (info.mensagens || []).some(m => /purchase|question/.test(String(m.intent || '')));
    if (!pediuDados && !intencaoNaConversa && !/purchase|question/.test(String(u.intent || ''))) continue;
    if (u.entregue === false || u.modo === 'fallback' || String(u.modo || '').startsWith('pausado') ||
        u.pedido || u.humano || u.consultou) continue;
    if (!String(u.botResponse || '').trim() || RE_ENCERROU_INTERESSE.test(String(u.userMessage || '')) ||
        RE_RESPOSTA_PENDENTE.test(String(u.botResponse || ''))) continue;
    const silencioMin = Math.floor((agora - info.quando) / 60000);
    const dias = silencioMin / 1440;
    // dois patamares: o quente (60min–24h) e o reengajamento (3–30 dias)
    const quente = silencioMin >= FOLLOWUP_DELAY_MIN && silencioMin <= FOLLOWUP_MAX_HOURS * 60;
    const reengajar = !quente && dias >= REENGAJAR_DIAS_MIN && dias <= REENGAJAR_DIAS_MAX &&
      (!ultimoFollowup[id] || agora - ultimoFollowup[id] > REENGAJAR_INTERVALO_DIAS * 86400000);
    if (!quente && !reengajar) continue;
    const g = _dj(id);
    if (g.pausadoAte > agora) continue;
    candidatos.push({ ...info, silencioMin, tipo: reengajar ? 'reengajar' : 'quente',
      texto: reengajar ? mensagemReengajar(info) : mensagemFollowup(info) });
  }
  // ⚠️ ORDEM E TETO. A ordenação era só por conversa mais antiga — o que punha
  // 18 reengajamentos de 9 dias À FRENTE de dois leads a um passo de comprar.
  // Agora: quentes primeiro (sempre), e o reengajamento entra a conta-gotas
  // (máx 3 por corrida) — 18 catálogos de uma vez parece spam e arrisca o
  // número da loja ser marcado no WhatsApp.
  const quentes = candidatos.filter(c => c.tipo !== 'reengajar').sort((a, b) => a.quando - b.quando);
  const frios = candidatos.filter(c => c.tipo === 'reengajar').sort((a, b) => b.quando - a.quando)
    .slice(0, REENGAJAR_MAX_CORRIDA);
  return [...quentes, ...frios];
}

async function executarFollowups(opcoes) {
  opcoes = opcoes || {};
  if (_followupRunning) return { ok: true, emCurso: true, candidatos: 0, enviados: 0 };
  _followupRunning = true;
  try {
    const agora = Date.now();
    const done = loadJSON(FOLLOWUPS_LOG);
    const candidatos = candidatosFollowup({
      convos: loadJSON(CONVERSATIONS_LOG),
      orders: loadJSON(ORDERS_LOG),
      done,
      promessas: loadJSON(PROMESSAS_LOG),
      consultas: loadJSON(CONSULTAS_FILE),
      actividade: (() => {
        const a = loadJSON(LAST_ACTIVITY_LOG);
        return a && !Array.isArray(a) && typeof a === 'object' ? a : {};
      })(),
      agora
    });

    // Seed de implantação: absorve conversas que já estavam silenciosas antes
    // desta lógica existir. Assim ninguém recebe de repente uma mensagem antiga.
    if (opcoes.seed) {
      candidatos.forEach(c => done.push({
        senderId: c.id, at: new Date().toISOString(), seed: true,
        motivo: 'existia antes do follow-up de 60 min', conversationAt: c.ultima.timestamp
      }));
      if (candidatos.length) saveJSON(FOLLOWUPS_LOG, done);
      return { ok: true, seed: true, marcados: candidatos.length };
    }

    const resumo = candidatos.map(c => ({
      nome: c.nome, silencioMin: c.silencioMin, intent: c.ultima.intent,
      enviavelAgora: dentroHorarioFollowup(agora), texto: c.texto
    }));
    if (opcoes.dryRun) {
      return { ok: true, dryRun: true, atrasoMin: FOLLOWUP_DELAY_MIN,
        horario: '08h-20h WAT', candidatos: resumo.length, detalhes: resumo };
    }
    if (!dentroHorarioFollowup(agora)) {
      return { ok: true, foraDoHorario: true, candidatos: candidatos.length, enviados: 0 };
    }

    const resultados = [];
    let doneAlterado = false;
    for (const c of candidatos.slice(0, FOLLOWUP_MAX_RUN)) {
      // Primeira trava: não se inicia um conselho para conversa que já mudou.
      if (!followupAindaSilencioso(c)) {
        resultados.push({ nome: c.nome, cancelado: 'cliente respondeu ou conversa foi assumida' });
        continue;
      }

      let conselho;
      try {
        conselho = await pedirDebateFollowup(c);
      } catch (e) {
        done.push({
          senderId: c.id, at: new Date().toISOString(), plataforma: 'whatsapp',
          ok: false, erro: String(e.message || e).slice(0, 180),
          motivo: 'debate_indisponivel', conversationAt: c.ultima.timestamp
        });
        doneAlterado = true;
        resultados.push({ nome: c.nome, silencioMin: c.silencioMin, ok: false, erro: e.message });
        log('WARN', `[FOLLOWUP-CONSELHO] ${c.nome}: ${e.message}`);
        continue;
      }

      // O Hermes pode concluir que insistir prejudica o lead. Essa decisão
      // também encerra o follow-up: não se volta a perguntar no ciclo seguinte.
      if (conselho.acao === 'nao_enviar') {
        done.push({
          senderId: c.id, at: new Date().toISOString(), plataforma: 'whatsapp',
          ok: true, enviado: false, acao: 'nao_enviar',
          motivo: String(conselho.motivo || 'decisão do Hermes').slice(0, 220),
          conversationAt: c.ultima.timestamp, debate: conselho.debate
        });
        doneAlterado = true;
        resultados.push({ nome: c.nome, silencioMin: c.silencioMin, ok: true, enviado: false, acao: 'nao_enviar' });
        log('INFO', `[FOLLOWUP-CONSELHO] ${c.nome}: Hermes decidiu não enviar`);
        continue;
      }

      let texto = String(conselho.mensagem || '').trim();
      let catalogo = null;
      let acao = conselho.acao;
      // Reengajamento: o catálogo É a razão de contactar alguém de dias atrás.
      // Sem ele a mensagem seria só "ainda te lembras de nós?" — e a esta
      // distância isso é incómodo, não venda. O conselho decide SE contacta;
      // o formato deste patamar já está decidido.
      if (c.tipo === 'reengajar' && acao !== 'nao_enviar') {
        acao = 'enviar_catalogo';
        if (!texto) texto = c.texto;
      }
      // 14-Ago: não reenviar catálogo a quem já o recebeu nas últimas 6h. O
      // Rainho pediu catálogo às 12:32 e o reengajamento mandou outro às 13:41 —
      // catálogo em duplicado numa hora. Degrada para a pergunta curta.
      if (acao === 'enviar_catalogo' && catalogoRecente(c.id)) {
        acao = 'perguntar_interesse';
        texto = mensagemFollowup(c);
        log('INFO', `[FOLLOWUP-CATALOGO] ${c.nome}: já recebeu catálogo há <6h — degradado para pergunta`);
      }
      if (acao === 'enviar_catalogo') {
        try {
          catalogo = await gerarCatalogoBot({
            template: 'grelha',
            max: 200,
            titulo: 'Catálogo SuperLoja — Produtos em stock',
            slug: 'catalogo-stock-followup'
          });
        } catch (e) {
          // Não prometemos um PDF que não conseguimos gerar: degrada para a
          // pergunta curta e segura, preservando a oportunidade sem inventar.
          catalogo = null;
          acao = 'perguntar_interesse';
          texto = mensagemFollowup(c);
          log('WARN', `[FOLLOWUP-CATALOGO] ${c.nome}: geração falhou, degradado para pergunta — ${e.message}`);
        }
      }
      if (!texto) {
        resultados.push({ nome: c.nome, cancelado: 'conselho sem mensagem aprovada' });
        continue;
      }

      // Trava final contra corrida: cobre todo o tempo gasto por Fugu, Hermes,
      // AISA e pelo gerador de PDF. Qualquer retorno do cliente cancela tudo.
      if (!followupAindaSilencioso(c)) {
        resultados.push({ nome: c.nome, cancelado: 'cliente respondeu durante o debate' });
        continue;
      }

      const r = await enviarAoCliente(c.id, 'whatsapp', texto);
      let catalogoResultado = null;
      if (r.ok && catalogo) {
        catalogoResultado = await sendWhatsAppDoc(
          c.id, catalogo.path, 'Seleção SuperLoja 📄', 'Sugestoes-SuperLoja.pdf');
        if (catalogoResultado.ok) marcarCatalogoEnviado(c.id);   // trava reenvios 6h
        else log('WARN', `[FOLLOWUP-CATALOGO] ${c.nome}: mensagem enviada, PDF falhou — ${catalogoResultado.error}`);
      }
      done.push({
        senderId: c.id, at: new Date().toISOString(), plataforma: 'whatsapp',
        ok: r.ok, enviado: r.ok, erro: r.error,
        motivo: 'silencio_' + c.silencioMin + 'min', acao,
        catalogo: catalogo ? {
          ok: !!(catalogoResultado && catalogoResultado.ok),
          erro: catalogoResultado && catalogoResultado.error,
          produtos: catalogo.produtos,
          escopo: 'todo_stock'
        } : null,
        conversationAt: c.ultima.timestamp, debate: conselho.debate
      });
      doneAlterado = true;
      resultados.push({
        nome: c.nome, silencioMin: c.silencioMin, ok: r.ok, enviado: r.ok,
        acao, catalogoOk: catalogo ? !!(catalogoResultado && catalogoResultado.ok) : null
      });
      log(r.ok ? 'INFO' : 'WARN',
        `[FOLLOWUP-ABANDONO] ${c.nome} (whatsapp, ${c.silencioMin}min, ${acao}) → ${r.ok ? 'enviado' : 'falhou: ' + r.error}`);
    }
    if (doneAlterado) saveJSON(FOLLOWUPS_LOG, done);
    return {
      ok: true, candidatos: candidatos.length,
      enviados: resultados.filter(x => x.enviado).length, resultados
    };
  } finally {
    _followupRunning = false;
  }
}

app.post('/api/followups/run', async (req, res) => {
  if (!soLoopback(req, res)) return;
  try {
    res.json(await executarFollowups({
      seed: !!(req.body && req.body.seed),
      dryRun: !!(req.body && req.body.dryRun)
    }));
  } catch (e) {
    log('WARN', '[FOLLOWUP-ABANDONO] corrida falhou: ' + e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Cobrar promessas de compra na data marcada ───────────────────────────────
// WhatsApp: cobra directo. Messenger: tenta (a janela de 24h da Meta pode
// bloquear → avisa o Carlos). Instagram: nem tenta (Meta bloqueia sempre) —
// avisa o Carlos para cobrar à mão. Cada promessa é cobrada UMA vez.
app.post('/api/promessas/run', async (req, res) => {
  if (!soLoopback(req, res)) return;
  const promessas = loadJSON(PROMESSAS_LOG);
  const hoje = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const devidas = promessas.filter(p => !p.cobrado && p.quando <= hoje);
  const resultados = [];

  for (const p of devidas.slice(0, 10)) {
    p.cobrado = true;
    p.cobradoEm = new Date().toISOString();

    if (p.plataforma === 'instagram') {
      p.resultado = 'manual (instagram bloqueado)';
      notifyCarlos('🗓 *PROMESSA DE COMPRA vence hoje* (instagram — cobra tu)\n👤 ' + p.senderName +
        (p.produto ? '\n📦 ' + p.produto : '') + '\n💬 "' + (p.nota || '') + '" (' + (p.criadoEm || '').slice(0, 10) + ')');
      resultados.push({ nome: p.senderName, plataforma: p.plataforma, ok: false, manual: true });
      continue;
    }

    let texto;
    try {
      const cfg = loadAIConfig();
      texto = await comTimeout(aiChatComReserva(cfg, [{ role: 'user', content:
        'És atendente da SuperLoja (Luanda). Este cliente prometeu comprar e o dia chegou:\n' +
        'PROMETEU: "' + (p.nota || 'comprar mais tarde') + '"' + (p.produto ? ' — produto: ' + p.produto : '') + '\n\n' +
        'Escreve UMA mensagem curta (1-2 frases, pt-Angola, calorosa, sem pressão) a relembrar com naturalidade. Sem markdown. Responde SÓ com a mensagem.' }], 200), 75000);
      texto = String(texto || '').trim();
    } catch { texto = null; }
    if (!texto) texto = 'Olá! 😊 Como combinado, passo só para relembrar' + (p.produto ? ' dos ' + p.produto : '') + ' — ainda te interessa? Entrega rápida em Luanda! 🛍️';

    const r = await enviarAoCliente(p.senderId, p.plataforma, texto);
    p.resultado = r.ok ? 'cobrado' : 'falhou: ' + r.error;
    if (!r.ok) {
      notifyCarlos('🗓 *PROMESSA vence hoje mas não consegui enviar* (' + p.plataforma + ')\n👤 ' + p.senderName +
        '\n💬 "' + (p.nota || '') + '"\n🚫 ' + r.error + '\nCobra tu manualmente.');
    }
    resultados.push({ nome: p.senderName, plataforma: p.plataforma, ok: r.ok });
    log(r.ok ? 'INFO' : 'WARN', `[PROMESSA] cobrada a ${p.senderName} (${p.plataforma}) → ${p.resultado}`);
  }

  if (devidas.length) saveJSON(PROMESSAS_LOG, promessas);
  res.json({ ok: true, devidas: devidas.length, resultados });
});

// ═══ PONTE DE COORDENAÇÃO Hermes ↔ bot da loja ═══════════════════════════════
// O Hermes (agente admin) NUNCA fala directamente com clientes (tem terminal —
// perigoso). Em vez disso DELEGA aqui: o bot da loja é o ÚNICO executor virado
// ao cliente. Assim os dois cérebros não se atropelam nem divergem (mesmo
// gerador de catálogo, mesmas fotos, mesmo formato, tudo registado).
//   POST /api/admin/enviar {chatId, plataforma?, tipo:"texto"|"catalogo"|"foto",
//                           texto?, template?, filtro?, produto?, assumir?}
// assumir!==false → PAUSA o bot para esse cliente 1h (o admin assumiu a conversa;
// o bot cala-se para não responder por cima). Retomar: /api/admin/retomar.

function detectarPlataforma(chatId) {
  const s = String(chatId || '');
  if (s.endsWith('@s.whatsapp.net') || s.endsWith('@lid') || s.endsWith('@g.us')) return 'whatsapp';
  return 'messenger';   // PSIDs numéricos da Meta
}

app.post('/api/admin/enviar', async (req, res) => {
  if (!soLoopback(req, res)) return;
  const { chatId, tipo, texto, template, filtro, categoria, produto, assumir } = req.body || {};
  if (!chatId) return res.status(400).json({ error: 'chatId obrigatório' });
  const plataforma = req.body.plataforma || detectarPlataforma(chatId);
  const resultado = { chatId, plataforma, acoes: [] };

  try {
    // 1) texto (nota/mensagem do admin)
    if ((tipo === 'texto' || !tipo) && texto) {
      const r = await enviarAoCliente(chatId, plataforma, texto);
      resultado.acoes.push({ texto: r.ok });
      if (!r.ok) resultado.erro = r.error;
    }
    // 2) catálogo PDF
    if (tipo === 'catalogo') {
      const cat = await gerarCatalogoBot({ template, filtro, categoria });
      const dr = plataforma === 'whatsapp'
        ? await sendWhatsAppDoc(chatId, cat.path, 'Catálogo SuperLoja 📄', 'Catalogo-SuperLoja.pdf')
        : { ok: await sendFileMeta(chatId, cat.path, 'Catalogo-SuperLoja.pdf') };
      resultado.acoes.push({ catalogo: dr.ok, template: cat.template, produtos: cat.produtos });
      if (!dr.ok) resultado.erro = dr.error || 'envio falhou';
    }
    // 3) foto de produto (cadeia BD→catálogo→internet)
    if (tipo === 'foto' && produto) {
      const alvo = await productPhotos.resolvePhoto(produto, findProductImage(produto));
      if (!alvo) { resultado.acoes.push({ foto: false, motivo: 'sem foto' }); }
      else if (plataforma === 'whatsapp') {
        const fr = alvo.tipo === 'ficheiro' ? await sendWhatsAppImage(chatId, alvo.valor) : await sendWhatsAppImage(chatId, alvo.valor);
        resultado.acoes.push({ foto: fr.ok, origem: alvo.origem });
      } else {
        const ok = alvo.tipo === 'ficheiro' ? await sendImageFile(chatId, alvo.valor) : await sendImage(chatId, alvo.valor);
        resultado.acoes.push({ foto: ok, origem: alvo.origem });
      }
    }

    // handoff: o admin assumiu → o bot cala-se para este cliente (evita atropelo)
    if (assumir !== false) {
      // 'handoff' e não 'disjuntor': faltava aqui (só o /api/admin/handoff o
      // marcava) e o log culpava o disjuntor por uma pausa criada pelo dono —
      // o mesmo diagnóstico errado que a correção de 04-Ago dizia ter arrumado.
      _pausar(chatId, Date.now() + 3600000, 'handoff');
      resultado.botPausado = '1h (admin assumiu a conversa)';
    }
    log('INFO', `[ADMIN→LOJA] ${tipo || 'texto'} para ${chatId} (${plataforma}) via Hermes`);
    res.json({ ok: !resultado.erro, ...resultado });
  } catch (e) {
    log('WARN', `[ADMIN→LOJA] ${e.message}`);
    res.status(500).json({ ok: false, error: e.message, ...resultado });
  }
});

// ═══ CONSOLIDAR RESPOSTAS + APRENDER (Hermes ↔ bot) ══════════════════════════
// Merge de uma Q→A na base de conhecimento que o bot usa no prompt. É assim que
// o Hermes "dá instruções para o bot aprender" — fica permanente (knowledgePromptBlock).
function aprenderFAQ(pergunta, resposta, extra) {
  const k = loadKnowledge() || { faq: [], tom: null, evitar: [] };
  k.faq = k.faq || [];
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9À-ſ ]/gi, '').trim();
  const i = k.faq.findIndex(f => norm(f.pergunta) === norm(pergunta));
  const entry = { pergunta: String(pergunta).slice(0, 200), resposta: String(resposta).slice(0, 600), fonte: 'hermes', em: new Date().toISOString() };
  if (i >= 0) k.faq[i] = entry; else k.faq.unshift(entry);   // novas ao topo (mais visíveis no prompt)
  k.faq = k.faq.slice(0, 40);
  if (extra && extra.tom) k.tom = String(extra.tom).slice(0, 200);
  if (extra && extra.evitar) k.evitar = Array.isArray(extra.evitar) ? extra.evitar.slice(0, 10) : k.evitar;
  k.generatedAt = new Date().toISOString();
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(k, null, 2), 'utf8');
  catalogCache.at = 0;   // (não afeta FAQ, mas força refresh geral se algo depender)
  // 14-Ago: uma pergunta que entra na FAQ deve FECHAR a consulta pendente igual.
  // Antes, a consulta só se resolvia pelo cérebro ao vivo ou pelo /responder da
  // fila — quando a resposta era posta na FAQ por outro caminho (dono/Claude
  // Code a corrigir à mão), a fila ficava órfã: 2 consultas apareciam "clientes
  // à espera há dias" quando já estavam respondidas (microfone/PC há 4 dias).
  try {
    const cons = loadJSON(CONSULTAS_FILE);
    let mudou = false;
    for (const q of cons) {
      if (q.resolvido) continue;
      if (norm(q.pergunta) === norm(pergunta)) {
        q.resolvido = true; q.resolvidoEm = new Date().toISOString(); q.via = 'faq-aprendida';
        mudou = true;
      }
    }
    if (mudou) saveJSON(CONSULTAS_FILE, cons);
  } catch (_) {}
  return k.faq.length;
}

// Ler / editar a ALMA do bot (identidade, voz, valores, factos) — como o SOUL.md
// do Hermes, mas do bot da loja. GET devolve o texto; POST substitui ou acrescenta.
app.get('/api/admin/alma', (req, res) => {
  if (!soLoopback(req, res)) return;
  let texto = ''; try { texto = fs.readFileSync(ALMA_FILE, 'utf8'); } catch {}
  res.json({ ok: true, alma: texto, ficheiro: ALMA_FILE });
});
app.post('/api/admin/alma', (req, res) => {
  if (!soLoopback(req, res)) return;
  const { texto, acrescentar } = req.body || {};
  if (!texto) return res.status(400).json({ error: 'texto obrigatório' });
  try {
    if (acrescentar) {
      let actual = ''; try { actual = fs.readFileSync(ALMA_FILE, 'utf8'); } catch {}
      fs.writeFileSync(ALMA_FILE, actual.replace(/\s*$/, '') + '\n' + texto + '\n', 'utf8');
    } else {
      fs.writeFileSync(ALMA_FILE, texto, 'utf8');
    }
    log('INFO', `[ALMA] actualizada (${acrescentar ? 'acrescento' : 'substituição'})`);
    res.json({ ok: true, chars: fs.statSync(ALMA_FILE).size });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Hermes ensina o bot directamente (instrução/conhecimento permanente)
app.post('/api/admin/aprender', (req, res) => {
  if (!soLoopback(req, res)) return;
  const { pergunta, resposta, tom, evitar } = req.body || {};
  if (!pergunta || !resposta) return res.status(400).json({ error: 'pergunta e resposta obrigatórias' });
  try {
    const total = aprenderFAQ(pergunta, resposta, { tom, evitar });
    log('INFO', `[APRENDER←HERMES] "${String(pergunta).slice(0, 50)}" → FAQ (${total})`);
    res.json({ ok: true, faqTotal: total });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Hermes vê as dúvidas pendentes dos clientes
app.get('/api/admin/consultas', (req, res) => {
  if (!soLoopback(req, res)) return;
  const cons = loadJSON(CONSULTAS_FILE);
  res.json({ pendentes: cons.filter(c => !c.resolvido), total: cons.length });
});

// Hermes responde a uma dúvida: ENSINA o bot (FAQ) + opcionalmente entrega ao cliente
app.post('/api/admin/consultas/responder', async (req, res) => {
  if (!soLoopback(req, res)) return;
  const { id, resposta, enviar } = req.body || {};
  if (!id || !resposta) return res.status(400).json({ error: 'id e resposta obrigatórios' });
  const cons = loadJSON(CONSULTAS_FILE);
  const q = cons.find(c => c.id === id);
  if (!q) return res.status(404).json({ error: 'consulta não encontrada' });
  try {
    const total = aprenderFAQ(q.pergunta, resposta);   // bot aprende: não volta a perguntar
    q.resolvido = true; q.resposta = resposta; q.resolvidoEm = new Date().toISOString();
    saveJSON(CONSULTAS_FILE, cons);
    let entregue = null;
    if (enviar !== false && q.chatId) {
      const r = await enviarAoCliente(q.chatId, q.platform || detectarPlataforma(q.chatId),
        'Sobre a tua pergunta: ' + resposta);
      entregue = r.ok;
      // ⚠️ Este é o caminho que a proposta original esqueceu: sem gravar aqui, o
      // disco continuava a dizer "pausado" depois de a dúvida estar respondida e
      // o restart seguinte ressuscitava a pausa — bot MUDO com o cliente a falar.
      _despausar(q.chatId);   // dúvida resolvida e entregue → bot volta ao normal (e o disco também)
    }
    log('INFO', `[CONSULTA RESOLVIDA] ${q.senderName}: aprendida (FAQ ${total})${entregue != null ? ' | entregue: ' + entregue : ''}`);
    res.json({ ok: true, faqTotal: total, entregueAoCliente: entregue });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// admin devolve a conversa ao bot (fim do handoff)
// HANDOFF AUTOMÁTICO: o bridge avisa aqui quando o DONO responde a um cliente
// pelo telefone. Sem isto o bot continuava a responder por cima do dono na mesma
// conversa (o cliente recebia duas vozes — foi o que aconteceu com a Joelma).
// ─── Quem recebe as notificações de encomenda ────────────────────────────────
app.get('/api/admin/notificacoes', (req, res) => {
  if (!soLoopback(req, res)) return;
  let db = {};
  try { db = JSON.parse(fs.readFileSync(NOTIFICADOS_FILE, 'utf8')); } catch {}
  res.json({ ok: true, numeros: numerosNotificados(),
    porOmissao: !db.numeros || !db.numeros.length, atualizadoEm: db.atualizadoEm || null,
    aviso: 'Estes números recebem nome, morada e telefone dos clientes. Não dão acesso de administração.' });
});

app.post('/api/admin/notificacoes', (req, res) => {
  if (!soLoopback(req, res)) return;
  const bruto = (req.body && req.body.numeros) || [];
  if (!Array.isArray(bruto)) return res.status(400).json({ error: 'numeros tem de ser uma lista' });

  const validos = [], rejeitados = [];
  for (const n of bruto) {
    const d = String(n).replace(/\D/g, '');
    if (!d) continue;
    // Angola: 244 + 9 dígitos. Aceita com ou sem indicativo e normaliza.
    // Sem isto, um lapso ("93400111") mandava dados de clientes para um desconhecido.
    const norm = d.length === 9 && /^9/.test(d) ? '244' + d : d;
    if (!/^\d{11,15}$/.test(norm)) { rejeitados.push({ numero: n, porque: 'formato inválido (usa 244XXXXXXXXX ou 9XXXXXXXX)' }); continue; }
    if (/^244/.test(norm) && !/^2449\d{8}$/.test(norm)) { rejeitados.push({ numero: n, porque: 'número angolano tem de ser 244 + 9 dígitos a começar por 9' }); continue; }
    validos.push(norm);
  }
  const lista = [...new Set(validos)];
  // nunca deixar a loja sem destinatário: uma encomenda que não avisa ninguém
  // é uma venda perdida em silêncio
  if (!lista.length) return res.status(400).json({ error: 'precisas de pelo menos UM número válido', rejeitados });
  if (lista.length > 5) return res.status(400).json({ error: 'máximo 5 números (cada um recebe dados de clientes)' });

  try {
    fs.writeFileSync(NOTIFICADOS_FILE, JSON.stringify({
      numeros: lista, atualizadoEm: new Date().toISOString()
    }, null, 2), 'utf8');
    _notifCache = { at: 0, lista: null };                 // força releitura
    log('INFO', '[AVISO] destinatários actualizados: ' + lista.map(n => '+' + n).join(', '));
    res.json({ ok: true, numeros: lista, rejeitados,
      message: lista.length + ' número(s) gravado(s)' + (rejeitados.length ? ' — ' + rejeitados.length + ' rejeitado(s)' : '') });
  } catch (e) { res.status(500).json({ error: 'não consegui gravar: ' + e.message }); }
});

// Envia uma mensagem de teste — a única forma de ter a certeza de que o número
// está certo antes de lá chegarem dados de um cliente real.
app.post('/api/admin/notificacoes/testar', async (req, res) => {
  if (!soLoopback(req, res)) return;
  const d = String((req.body && req.body.numero) || '').replace(/\D/g, '');
  const norm = d.length === 9 && /^9/.test(d) ? '244' + d : d;
  if (!/^\d{11,15}$/.test(norm)) return res.status(400).json({ error: 'número inválido' });
  const ok = await _enviarBridge(norm + '@s.whatsapp.net',
    '✅ *Teste da SuperLoja*\nEste número está configurado para receber as notificações de encomenda.\nSe não esperavas isto, avisa o dono da loja.');
  res.json({ ok, numero: norm, message: ok ? 'mensagem de teste enviada' : 'não consegui entregar (número errado ou bridge em baixo)' });
});

app.post('/api/admin/handoff', (req, res) => {
  if (!soLoopback(req, res)) return;
  const { chatId, minutos } = req.body || {};
  if (!chatId) return res.status(400).json({ error: 'chatId obrigatório' });
  const mins = Math.min(240, Math.max(5, Number(minutos) || 60));
  const jaEstava = _dj(String(chatId)).pausadoAte > Date.now();
  // 'handoff' para o log não culpar o disjuntor; _pausar grava também em disco
  _pausar(chatId, Date.now() + mins * 60000, 'handoff');
  if (!jaEstava) log('INFO', `[HANDOFF] dono assumiu ${chatId} — bot calado ${mins}min`);
  res.json({ ok: true, chatId, pausadoMinutos: mins, jaEstava });
});

app.post('/api/admin/retomar', (req, res) => {
  if (!soLoopback(req, res)) return;
  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: 'chatId obrigatório' });
  _despausar(chatId);
  log('INFO', `[ADMIN→LOJA] bot retomado para ${chatId}`);
  res.json({ ok: true, chatId, botRetomado: true });
});

// Clientes do WhatsApp, encaminhados pelo bridge do Hermes (patch em bridge.js).
// So aceita loopback: quem fala aqui e o bridge na mesma maquina.
app.post('/whatsapp', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ip)) {
    log('WARN', `[WHATSAPP] pedido rejeitado de ${ip} (só loopback)`);
    return res.status(403).json({ error: 'loopback only' });
  }
  const { chatId, senderName, text, messageId, imageBase64, imageMime, audioBase64, senderPhone, quotedId } = req.body || {};
  // uma FOTO ou uma NOTA DE VOZ são mensagens válidas — o texto não é obrigatório
  if (!chatId || (!text && !imageBase64 && !audioBase64)) return res.status(400).json({ error: 'chatId e text (ou imageBase64/audioBase64) obrigatórios' });
  // defesa em profundidade (o bridge também filtra): estados/broadcasts não são conversas
  if (String(chatId).includes('status') || String(chatId).endsWith('@broadcast') || String(chatId).endsWith('@g.us')) {
    return res.json({ ok: true, ignorado: 'não é conversa de cliente' });
  }
  if (messageId && alreadyProcessed(messageId)) { log('INFO', 'mid repetido ignorado (whatsapp)'); return res.json({ ok: true, duplicado: true }); }

  res.json({ ok: true });  // responde já; o bridge não fica à espera da IA
  const nome = senderName || 'Cliente';
  // VISÃO no WhatsApp: o bridge descarrega a imagem e entrega-a em base64
  // (não há URL público como no Messenger) — vira um bloco pronto para a IA.
  const imagens = [];
  if (imageBase64 && String(imageBase64).length <= 7 * 1024 * 1024) {
    // mimeReal sobre os bytes: o telemóvel do cliente também mente no mime e a
    // Anthropic rejeita o pedido inteiro (HTTP 400) quando não bate certo.
    const bufImg = Buffer.from(String(imageBase64), 'base64');
    imagens.push({ type: 'image', source: { type: 'base64', media_type: mimeReal(bufImg, String(imageMime || 'image/jpeg').split(';')[0]), data: String(imageBase64) } });
  }
  // NOTA DE VOZ: transcrever antes de responder. Assíncrono de propósito — o
  // bridge já recebeu o 200 e não fica à espera dos ~4s do whisper.
  (async () => {
    let msgTexto = text || '';
    // O bridge preenche o texto com "[o cliente enviou um audio/imagem que nao
    // consegues ver neste canal. Pede-lhe ... para escrever em texto]" sempre
    // que a mensagem chega sem legenda. Esse patch é ANTERIOR à transcrição de
    // voz e à visão — hoje o bot ouve e vê. Se o deixarmos ficar, a IA recebe
    // DUAS ordens contrárias na mesma mensagem: "pede-lhe texto" e logo a
    // seguir a transcrição. Ganha a primeira, e o cliente entra num ciclo:
    // manda nota de voz → o bot pede texto → manda outra nota de voz.
    // CASO REAL: Nilton p., 12 notas de voz seguidas, encomenda ainda pendente.
    const RE_SEM_CANAL = /\[o cliente enviou um \w+ que nao consegues ver neste canal\.[^\]]*\]/gi;
    const semPlaceholder = () => { msgTexto = msgTexto.replace(RE_SEM_CANAL, '').trim(); };
    if (imagens.length) semPlaceholder();   // temos a imagem em base64: o bot VÊ

    // o cliente respondeu a uma foto NOSSA? substituir o inútil "[foto sem
    // legenda]" pelo produto real que essa foto mostrava
    const prodCitado = produtoDaFotoCitada(quotedId);
    if (prodCitado) {
      const etiqueta = '[o cliente respondeu à FOTO que lhe enviaste de: "' + legendaProduto(prodCitado) + '"]';
      // termina em `"]` e não no primeiro `]`: a citação traz parêntesis
      // aninhados ("[foto sem legenda]") e cortar no primeiro deixava lixo
      const RE_CITACAO = /\[o cliente respondeu a ESTA tua mensagem:[\s\S]*?"\]/;
      msgTexto = RE_CITACAO.test(msgTexto)
        ? msgTexto.replace(RE_CITACAO, etiqueta)
        : etiqueta + ' ' + msgTexto;
      log('INFO', `[FOTO-CITADA] ${senderName}: respondeu à foto de "${prodCitado.slice(0, 34)}"`);
    }
    if (audioBase64) {
      const trans = await transcreverAudio(Buffer.from(String(audioBase64), 'base64'));
      if (trans) {
        semPlaceholder();   // ouvimos: apagar o "pede-lhe para escrever em texto"
        msgTexto = (msgTexto ? msgTexto + ' ' : '') + '[o cliente enviou uma nota de voz; isto é a transcrição:] ' + trans;
      } else {
        // sem transcrição o placeholder do bridge está CERTO — deixá-lo ficar
        msgTexto = msgTexto || '[o cliente enviou um áudio que não consegues ouvir. Pede-lhe com simpatia para escrever em texto o que precisa]';
      }
      log('INFO', `[ÁUDIO] whatsapp: ${trans ? 'transcrito — "' + trans.slice(0, 60) + '"' : 'sem transcrição — pedido texto'}`);
    }
    // via batch: junta mensagens partidas em pedaços numa só resposta
    return handleWhatsAppComBatch(chatId, nome, msgTexto, imagens, senderPhone);
  })().catch(e => {
    log('ERROR', `[WHATSAPP] ${e.message}`);
    if (shouldNotifyFail(chatId)) notifyCarlos('🚨 *BOT FALHOU — cliente sem resposta* (whatsapp)\n👤 ' + nome +
      '\n💬 Cliente: ' + String(text).slice(0, 90) + '\n🐛 Erro: ' + String(e.message).slice(0, 100) + '\nResponde tu no WhatsApp.');
  });
});

// Get conversations (API)
app.get('/api/conversations', (req, res) => {
  const convos = loadJSON(CONVERSATIONS_LOG);
  res.json(convos.slice(-100)); // Last 100
});

// Get leads (API)
app.get('/api/leads', (req, res) => {
  const leads = loadJSON(LEADS_LOG);
  res.json(leads);
});

// Encomendas recolhidas pelo bot (nome, morada, telefone, itens)
app.get('/api/orders', (req, res) => {
  res.json(loadJSON(ORDERS_LOG).slice(-100).reverse());
});

// Lista de desejos: produtos pedidos que não temos (ordenada por procura)
app.get('/api/wishlist', (req, res) => {
  res.json(loadJSON(WISHLIST_LOG).sort((a, b) => (b.count || 0) - (a.count || 0)));
});

// Aprender: destila FAQ/tom das conversas + respostas humanas → repositório de conhecimento
app.post('/api/chatbot/learn', async (req, res) => {
  try {
    const k = await learnFromConversations();
    log('INFO', `[APRENDER] conhecimento actualizado: ${(k.faq || []).length} FAQ`);
    res.json({ ok: true, faq: (k.faq || []).length, baseadoEm: k.baseadoEm, tom: k.tom });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Ver o que o bot já aprendeu
app.get('/api/chatbot/knowledge', (req, res) => {
  res.json(loadKnowledge() || { faq: [], generatedAt: null });
});

// Estatísticas do CRM (mensagens por plataforma, leads, treino)
app.get('/api/chatbot/stats', (req, res) => {
  const convos = loadJSON(CONVERSATIONS_LOG);
  const training = loadJSON(TRAINING_LOG);
  const byPlat = {};
  convos.forEach(c => { const p = c.platform || 'messenger'; byPlat[p] = (byPlat[p] || 0) + 1; });
  const clientes = new Set(convos.map(c => c.senderId));
  res.json({
    totalConversas: convos.length,
    porPlataforma: byPlat,
    clientesDistintos: clientes.size,
    leads: loadJSON(LEADS_LOG).length,
    respostasHumanasCapturadas: training.length,
    conhecimento: (loadKnowledge() || {}).generatedAt || 'ainda não gerado'
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────
ensureDirs();

app.listen(APP_PORT, () => {
  log('INFO', `🤖 Messenger Chatbot running on port ${APP_PORT}`);
  if (!META_APP_SECRET) log('WARN', '[WEBHOOK] META_APP_SECRET não configurado — o POST /webhook aceita qualquer pedido (assinatura não verificada). Põe META_APP_SECRET no .env para fechar.');
  else log('INFO', '[WEBHOOK] assinatura X-Hub-Signature-256 ativa ✓');
  log('INFO', `📍 Webhook: http://localhost:${APP_PORT}/webhook`);
  log('INFO', `📊 Conversations API: http://localhost:${APP_PORT}/api/conversations`);
  log('INFO', `👥 Leads API: http://localhost:${APP_PORT}/api/leads`);
  log('INFO', `🔁 Follow-up de abandono: ${FOLLOWUP_DELAY_MIN}min de silêncio, verificação cada ${FOLLOWUP_POLL_MIN}min, 08h-20h WAT`);

  // O primeiro ciclo espera 2 min para dar tempo ao deploy fazer seed das
  // conversas antigas. Depois corre internamente — não depende do cron das 18h.
  const arrancarFollowups = setTimeout(() => {
    executarFollowups({ automatico: true }).catch(e =>
      log('WARN', '[FOLLOWUP-ABANDONO] automático falhou: ' + e.message));
    const timer = setInterval(() => {
      executarFollowups({ automatico: true }).catch(e =>
        log('WARN', '[FOLLOWUP-ABANDONO] automático falhou: ' + e.message));
    }, FOLLOWUP_POLL_MIN * 60000);
    if (timer.unref) timer.unref();
  }, 2 * 60000);
  if (arrancarFollowups.unref) arrancarFollowups.unref();
});

process.on('SIGTERM', () => {
  log('INFO', 'Shutting down gracefully');
  process.exit(0);
});
