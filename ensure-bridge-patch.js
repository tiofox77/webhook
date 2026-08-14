#!/usr/bin/env node
/**
 * Reaplica os patches locais ao bridge WhatsApp do Hermes.
 *
 * PORQUE ISTO EXISTE: `hermes update` reescreve bridge.js e leva os patches
 * atras. Quando isso acontece o WhatsApp da loja volta ao silencio (clientes
 * descartados) e o Hermes volta a responder dentro de grupos — sem aviso.
 * Este script deteta e repoe. E idempotente: correr as vezes que for preciso.
 *
 * Uso:  node ensure-bridge-patch.js          (aplica se faltar)
 *       node ensure-bridge-patch.js --check  (so verifica; sai 1 se faltar)
 */

const fs = require('fs');
const path = require('path');

const BRIDGE = process.env.HERMES_BRIDGE_JS ||
  path.join(process.env.LOCALAPPDATA || 'C:\\Users\\fox\\AppData\\Local',
            'hermes', 'hermes-agent', 'scripts', 'whatsapp-bridge', 'bridge.js');

const CHECK_ONLY = process.argv.includes('--check');
const MARKER = 'routeToStoreBot';

// ─── Os patches ───────────────────────────────────────────────────────────────
// Cada um: um marcador (ja aplicado?), o texto a procurar e o substituto.
const PATCHES = [
  {
    nome: 'import http',
    marcador: "import httpMod from 'http'",
    procurar: "import qrcode from 'qrcode-terminal';",
    substituir: "import qrcode from 'qrcode-terminal';\nimport httpMod from 'http';   // PATCH LOCAL: router admin/cliente (routeToStoreBot)",
  },
  {
    nome: 'routeToStoreBot()',
    marcador: 'function routeToStoreBot',
    procurar: 'const messageQueue = [];',
    substituir: `// ─── PATCH LOCAL (nao e upstream) — router admin/cliente ─────────────────────
// Clientes (nao-admin) vao para o bot da loja em vez do Hermes. Desligado por
// omissao: sem STORE_BOT_URL o comportamento e o original (descartar).
const STORE_BOT_URL = process.env.STORE_BOT_URL || '';

function routeToStoreBot(chatId, senderId, msg) {
  if (!STORE_BOT_URL) return;
  // status@broadcast = ESTADOS dos contactos, nao conversas. Sem este corte o
  // bot respondia aos status das pessoas (aconteceu: 10 respostas em 16-Jul).
  if (String(chatId).includes('status') || String(chatId).endsWith('@broadcast')) return;
  try {
    const mc = getMessageContent(msg);
    let text = mc?.conversation || mc?.extendedTextMessage?.text ||
               mc?.imageMessage?.caption || mc?.videoMessage?.caption || '';
    if (!text.trim()) {
      // Notas de voz e fotos sao comuns em Angola. Ignorar em silencio deixava
      // o cliente sem resposta nenhuma — em vez disso o bot pede texto.
      const kind = mc?.audioMessage ? 'audio' : mc?.imageMessage ? 'imagem'
                 : mc?.videoMessage ? 'video' : mc?.stickerMessage ? 'sticker' : '';
      if (!kind) return;   // reaccoes/protocolo: nada a responder
      try { console.log(JSON.stringify({ event: 'store_bot_media_only', kind, chatId })); } catch {}
      text = '[o cliente enviou um ' + kind + ' que nao consegues ver neste canal. ' +
             'Pede-lhe com simpatia para escrever em texto o que precisa]';
    }
    const payload = Buffer.from(JSON.stringify({
      chatId,
      senderId,
      senderName: (msg.pushName || senderId.replace(/@.*/, '')),
      text,
      messageId: msg.key?.id || '',
    }), 'utf8');
    const u = new URL(STORE_BOT_URL);
    const req = httpMod.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length },
    }, (res) => { res.resume(); });
    // O bridge NUNCA pode cair por causa disto: engolir tudo.
    req.on('error', (e) => {
      try { console.log(JSON.stringify({ event: 'store_bot_error', error: e.message, chatId })); } catch {}
    });
    req.setTimeout(5000, () => req.destroy());
    req.write(payload); req.end();
    try { console.log(JSON.stringify({ event: 'routed_to_store_bot', chatId, senderId })); } catch {}
  } catch (e) {
    try { console.log(JSON.stringify({ event: 'store_bot_error', error: e.message, chatId })); } catch {}
  }
}

const messageQueue = [];`,
  },
  {
    nome: 'contexto de mensagem citada (reply)',
    // ⚠️ o marcador TEM de existir literalmente no texto inserido (includes é
    // case-sensitive). Estava 'esta' minúsculo vs 'ESTA' no código → nunca
    // casava → o patch era re-aplicado a CADA corrida e o prefixo do reply
    // saía triplicado nas mensagens dos clientes.
    marcador: 'respondeu a ESTA tua mensagem',
    procurar: `    if (!text.trim()) {`,
    substituir: `    // PATCH LOCAL: se o cliente RESPONDEU a uma mensagem nossa (reply/quote),
    // juntar o texto citado. Sem isto "quero esse" chegava ao bot sem contexto e
    // ele reenviava fotos ao calhas (conversa da Joelma, 27-Jul).
    try {
      const ctx = mc?.extendedTextMessage?.contextInfo || mc?.imageMessage?.contextInfo
               || mc?.videoMessage?.contextInfo || mc?.audioMessage?.contextInfo;
      const q = ctx?.quotedMessage;
      if (q) {
        const qt = q.conversation || q.extendedTextMessage?.text
                || q.imageMessage?.caption || q.videoMessage?.caption
                || (q.imageMessage ? '[foto sem legenda]' : q.documentMessage?.fileName || '');
        if (qt) text = '[o cliente respondeu a ESTA tua mensagem: "' + String(qt).slice(0, 180) + '"] ' + text;
      }
    } catch {}
    if (!text.trim()) {`,
  },
  {
    nome: 'foto COM legenda (o bot não sabia que havia imagem)',
    // SOFTECANGOLA 30-Jul: mandou a foto de um produto com a legenda "Olá tem
    // esse artigo?" — a linha do caption entregava SÓ o texto e o bot respondeu
    // às cegas ("não consegui identificar qual é o artigo"). O marcador de média
    // só cobria fotos SEM legenda (text vazio).
    marcador: 'enviou uma FOTO que nao consegues ver',
    procurar: `    if (!text.trim()) {
      // Notas de voz e fotos sao comuns em Angola.`,
    substituir: `    // PATCH LOCAL: foto/video COM legenda — sem isto o bot recebia so a legenda
    // e nem sabia que havia imagem (o cliente aponta "esse artigo" para o nada).
    if (text.trim() && mc?.imageMessage) {
      text = '[o cliente enviou uma FOTO que nao consegues ver, com a legenda:] ' + text;
    } else if (text.trim() && mc?.videoMessage) {
      text = '[o cliente enviou um VIDEO que nao consegues ver, com a legenda:] ' + text;
    }
    if (!text.trim()) {
      // Notas de voz e fotos sao comuns em Angola.`,
  },
  {
    nome: 'visão: descarregar a foto do cliente (base64 para o bot)',
    // Sem isto o bot só sabia que "havia uma foto" — agora VÊ a foto (a visão
    // da AISA identifica o produto, como já acontece no Messenger).
    marcador: 'store_bot_image_dl_fail',
    procurar: `    const payload = Buffer.from(JSON.stringify({
      chatId,
      senderId,
      senderName: (msg.pushName || senderId.replace(/@.*/, '')),
      text,
      messageId: msg.key?.id || '',
    }), 'utf8');
    const u = new URL(STORE_BOT_URL);
    const req = httpMod.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length },
    }, (res) => { res.resume(); });
    // O bridge NUNCA pode cair por causa disto: engolir tudo.
    req.on('error', (e) => {
      try { console.log(JSON.stringify({ event: 'store_bot_error', error: e.message, chatId })); } catch {}
    });
    req.setTimeout(5000, () => req.destroy());
    req.write(payload); req.end();
    try { console.log(JSON.stringify({ event: 'routed_to_store_bot', chatId, senderId })); } catch {}`,
    substituir: `    // PATCH LOCAL (visão): se veio FOTO, descarrega e envia em base64 — o bot
    // passa a VER a imagem. Falhou o download? Segue o marcador "nao consegues
    // ver" e o bot responde com honestidade. O envio ficou async, sempre com
    // catch: o bridge NUNCA pode cair por causa disto.
    (async () => {
      let imageBase64 = null, imageMime = null;
      try {
        const im = mc?.imageMessage;
        if (im && sock && Number(im.fileLength || 0) < 4194304) {
          const buf = await Promise.race([
            downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
            new Promise((_, rj) => setTimeout(() => rj(new Error('timeout download')), 12000)),
          ]);
          if (buf && buf.length) {
            imageBase64 = Buffer.from(buf).toString('base64');
            imageMime = im.mimetype || 'image/jpeg';
            // a foto VAI anexada: trocar os avisos "nao consegues ver"
            text = String(text || '')
              .replace('[o cliente enviou uma FOTO que nao consegues ver, com a legenda:]',
                       '[o cliente enviou ESTA FOTO anexada, com a legenda:]')
              .replace(/^\\[o cliente enviou um imagem que nao consegues ver[\\s\\S]*\\]$/,
                       '[o cliente enviou esta FOTO sem legenda — olha a imagem e identifica o produto]');
          }
        }
      } catch (e) {
        try { console.log(JSON.stringify({ event: 'store_bot_image_dl_fail', error: String(e.message || e).slice(0, 120), chatId })); } catch {}
      }
      const payload = Buffer.from(JSON.stringify({
        chatId,
        senderId,
        senderName: (msg.pushName || senderId.replace(/@.*/, '')),
        text,
        messageId: msg.key?.id || '',
        imageBase64, imageMime,
      }), 'utf8');
      const u = new URL(STORE_BOT_URL);
      const req = httpMod.request({
        hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length },
      }, (res) => { res.resume(); });
      req.on('error', (e) => {
        try { console.log(JSON.stringify({ event: 'store_bot_error', error: e.message, chatId })); } catch {}
      });
      req.setTimeout(20000, () => req.destroy());
      req.write(payload); req.end();
      try { console.log(JSON.stringify({ event: 'routed_to_store_bot', chatId, senderId, img: !!imageBase64 })); } catch {}
    })().catch(() => {});`,
  },
  {
    nome: 'voz: descarregar a nota de voz do cliente (base64 para transcrever)',
    // Patch SEPARADO do da visão (e aplicado depois): quando este nasceu, o
    // bridge já tinha a visão aplicada e um patch que reescrevesse o bloco
    // inteiro deixava de encontrar a âncora original. Aditivo = sobrevive.
    // Em Angola muita gente manda áudio; o bot transcreve-o com faster-whisper.
    marcador: 'store_bot_audio_dl_fail',
    procurar: `      let imageBase64 = null, imageMime = null;
      try {
        const im = mc?.imageMessage;`,
    substituir: `      let imageBase64 = null, imageMime = null, audioBase64 = null, audioMime = null;
      // PATCH LOCAL (voz): nota de voz -> base64 -> o bot transcreve localmente.
      try {
        const au = mc?.audioMessage;
        if (au && sock && Number(au.fileLength || 0) < 12582912) {
          const bufA = await Promise.race([
            downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
            new Promise((_, rj) => setTimeout(() => rj(new Error('timeout download audio')), 15000)),
          ]);
          if (bufA && bufA.length) { audioBase64 = Buffer.from(bufA).toString('base64'); audioMime = au.mimetype || 'audio/ogg'; }
        }
      } catch (e) {
        try { console.log(JSON.stringify({ event: 'store_bot_audio_dl_fail', error: String(e.message || e).slice(0, 120), chatId })); } catch {}
      }
      try {
        const im = mc?.imageMessage;`,
  },
  {
    nome: 'voz: enviar o audio ao bot no payload',
    marcador: 'imageBase64, imageMime, audioBase64, audioMime,',
    procurar: `        imageBase64, imageMime,
      }), 'utf8');`,
    substituir: `        imageBase64, imageMime, audioBase64, audioMime,
      }), 'utf8');`,
  },
  {
    nome: 'numero de telefone: resolver o @lid para o numero real',
    // O WhatsApp identifica o cliente por @lid e o numero real nunca chegava ao
    // sistema — o dono via "245264443002975@lid" e nao conseguia ligar-lhe.
    // O bridge JA construia o mapa lidToPhone (2912 entradas) mas NUNCA o usava:
    // codigo morto. A sessao guarda os dois sentidos:
    //   lid-mapping-<numero>.json          -> conteudo = LID   (mapa ja existente)
    //   lid-mapping-<LID>_reverse.json     -> conteudo = numero (ficheiro directo)
    // Testado: 40 em 40 clientes do CRM resolvidos.
    marcador: 'senderPhone,',
    procurar: `      const payload = Buffer.from(JSON.stringify({
        chatId,
        senderId,`,
    substituir: `      let senderPhone = '';
      try {
        const lidNum = String(senderId || '').replace(/[@:].*/, '');
        senderPhone = lidToPhone[lidNum] || '';
        if (!senderPhone && /^\\d+\$/.test(lidNum)) {
          try {
            senderPhone = String(JSON.parse(readFileSync(
              path.join(SESSION_DIR, 'lid-mapping-' + lidNum + '_reverse.json'), 'utf8')) || '').replace(/\\D/g, '');
          } catch {}
        }
        // conversa normal (nao-LID): o numero ja esta no proprio JID
        if (!senderPhone && /@s\\.whatsapp\\.net\$/.test(String(senderId || ''))) {
          senderPhone = String(senderId).replace(/[@:].*/, '');
        }
      } catch {}
      const payload = Buffer.from(JSON.stringify({
        chatId,
        senderId,
        senderPhone,`,
  },
  {
    nome: 'id da mensagem citada (saber a QUE foto o cliente respondeu)',
    // O WhatsApp cita a foto sem a legenda ("[foto sem legenda]") — o bot ficava
    // sem saber que produto era, mesmo tendo-a acabado de enviar. Com o stanzaId
    // o bot cruza com o messageId que guardou ao enviar. Exacto, sem adivinhar.
    // ⚠️ o marcador tem de existir LITERALMENTE no texto inserido — pus
    // 'quotedId,' (com vírgula) e o texto tem 'quotedId:' → o --check dizia
    // sempre "em falta" e o watchdog ia duplicar o patch de 30 em 30 min.
    marcador: 'quotedId:',
    procurar: `        imageBase64, imageMime, audioBase64, audioMime,
      }), 'utf8');`,
    substituir: `        imageBase64, imageMime, audioBase64, audioMime,
        quotedId: (mc?.extendedTextMessage?.contextInfo || mc?.imageMessage?.contextInfo
                || mc?.videoMessage?.contextInfo || mc?.audioMessage?.contextInfo)?.stanzaId || '',
      }), 'utf8');`,
  },
  {
    nome: 'avisarHandoff()',
    marcador: 'function avisarHandoff',
    procurar: 'function routeToStoreBot(chatId, senderId, msg) {',
    substituir: `// PATCH LOCAL: o DONO respondeu a um cliente pelo telefone → calar o bot da
// loja nessa conversa (senao o cliente ouve duas vozes: a do dono e a do bot).
function avisarHandoff(chatId) {
  if (!STORE_BOT_URL) return;
  try {
    const u = new URL(STORE_BOT_URL);
    const corpo = Buffer.from(JSON.stringify({ chatId, minutos: 60 }), 'utf8');
    const req = httpMod.request({
      hostname: u.hostname, port: u.port || 80, path: '/api/admin/handoff', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': corpo.length },
    }, (res) => { res.resume(); });
    req.on('error', () => {});
    req.setTimeout(5000, () => req.destroy());
    req.write(corpo); req.end();
    console.log(JSON.stringify({ event: 'handoff_dono_assumiu', chatId }));
  } catch {}
}

function routeToStoreBot(chatId, senderId, msg) {`,
  },
  {
    nome: 'handoff quando o dono responde',
    marcador: 'avisarHandoff(chatId);',
    procurar: `      if (msg.key.fromMe) {
        if (isGroup || chatId.includes('status')) continue;`,
    substituir: `      if (msg.key.fromMe) {
        if (isGroup || chatId.includes('status')) continue;

        // PATCH LOCAL: se NAO e eco de um /send nosso e o chat NAO e do admin,
        // entao foi o dono a escrever do telefone a um cliente → handoff.
        try {
          if (!recentlySentIds.has(msg.key.id) &&
              !matchesAllowedUser(chatId, ALLOWED_USERS, SESSION_DIR)) {
            avisarHandoff(chatId);
          }
        } catch {}`,
  },
  {
    nome: 'bloquear grupos no inbound',
    marcador: "reason: 'group_disabled'",
    procurar: `      if (!msg.key.fromMe) {
        if (WHATSAPP_MODE === 'self-chat') {`,
    substituir: `      if (!msg.key.fromMe) {
        // PATCH LOCAL: nunca processar mensagens de GRUPO. A allowlist abaixo
        // testa o REMETENTE, e em grupo o remetente pode ser o proprio dono — o
        // que faria o Hermes responder dentro do grupo, com terminal/ficheiros
        // activos, a frente de todos. O group_policy do adapter e config morta
        // (gateway/platforms/whatsapp.py le e ignora), por isso o corte e aqui.
        if (isGroup) {
          try {
            console.log(JSON.stringify({
              event: 'ignored',
              reason: 'group_disabled',
              chatId,
              senderId,
            }));
          } catch {}
          continue;
        }
        if (WHATSAPP_MODE === 'self-chat') {`,
  },
  {
    nome: 'encaminhar clientes',
    marcador: 'routeToStoreBot(chatId, senderId, msg);',
    procurar: `        if (!matchesAllowedUser(senderId, ALLOWED_USERS, SESSION_DIR)) {
          try {`,
    substituir: `        if (!matchesAllowedUser(senderId, ALLOWED_USERS, SESSION_DIR)) {
          // PATCH LOCAL: quem nao e admin NUNCA chega ao Hermes (terminal/
          // ficheiros expostos). Vai para o bot da loja, que so sabe de
          // catalogo/precos/entregas.
          routeToStoreBot(chatId, senderId, msg);
          try {`,
  },
];

// ─── Execucao ─────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(BRIDGE)) {
    console.error('[patch] bridge.js NAO ENCONTRADO: ' + BRIDGE);
    process.exit(2);
  }

  let src = fs.readFileSync(BRIDGE, 'utf8');
  const emFalta = PATCHES.filter(p => !src.includes(p.marcador));

  if (emFalta.length === 0) {
    console.log('[patch] OK — os ' + PATCHES.length + ' patches estao aplicados');
    return;
  }

  console.log('[patch] EM FALTA (' + emFalta.length + '/' + PATCHES.length + '): ' +
              emFalta.map(p => p.nome).join(', '));

  if (CHECK_ONLY) {
    console.log('[patch] --check: nao alterei nada. Corre sem --check para repor.');
    process.exit(1);
  }

  // Backup antes de tocar (mantem o primeiro original, nao o sobrescreve)
  const bak = BRIDGE + '.bak-original';
  if (!fs.existsSync(bak)) { fs.copyFileSync(BRIDGE, bak); console.log('[patch] backup: ' + bak); }

  const aplicados = [];
  for (const p of emFalta) {
    if (!src.includes(p.procurar)) {
      console.error('[patch] FALHOU "' + p.nome + '": o ponto de ancoragem mudou no upstream.');
      console.error('[patch] O bridge NAO foi alterado. E preciso rever o patch a mao.');
      process.exit(3);   // nao gravar nada pela metade
    }
    src = src.replace(p.procurar, p.substituir);
    aplicados.push(p.nome);
  }

  fs.writeFileSync(BRIDGE, src, 'utf8');
  console.log('[patch] reaplicados: ' + aplicados.join(', '));
  console.log('[patch] reinicia o bridge para carregar (mata o PID da porta 3010; o gateway ressuscita-o).');
}

main();
