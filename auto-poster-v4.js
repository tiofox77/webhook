#!/usr/bin/env node
/**
 * Superloja Auto-Poster v4.3
 * Posts to Facebook and Instagram via Meta Graph API v21.0
 * Fixes: sequential product loop, reels endpoint, single slideshow, IG polling, logo watermark
 */

require('dotenv').config({ path: __dirname + '/.env' });
const https    = require('https');
const { execSync } = require('child_process');
const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');

// Prefixo de data em todos os logs para que o dashboard possa contar posts de hoje
const _log = console.log.bind(console);
console.log = (...a) => _log(`[${new Date().toISOString().slice(0,10)}]`, ...a);

// ─── Config ───────────────────────────────────────────────────────────────────
const DATA_DIR           = process.env.DATA_DIR || 'C:\\superloja\\data';
const AUDIO_DIR          = __dirname + '/audio_library';
const postTemplates      = require('./post-templates.js');
const creativeCaption    = require('./creative-caption.js');  // Fugu pensa (briefs), Haiku escreve
const textGuard          = require('./text-guard.js');
const CHECKLIST_FILE     = DATA_DIR + '/checklist.json';
const PRODUCT_INDEX_FILE = DATA_DIR + '/.product_index';
const POST_STATE_FILE    = DATA_DIR + '/post-state.json';  // rastreamento por ID
const CTA_STATE_FILE     = DATA_DIR + '/cta-state.json';
const AUDIO_STATE_FILE   = DATA_DIR + '/audio-state.json';
const REEL_STATE_FILE    = DATA_DIR + '/reel-state.json';

const FB_PAGE_ID      = process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '230190170178019';
const IG_PAGE_ID      = process.env.IG_PAGE_ID || process.env.INSTAGRAM_ACCOUNT_ID || '17841464824215251';
const ACCESS_TOKEN    = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN;
const WHATSAPP_LINK   = process.env.WHATSAPP_LINK || 'https://wa.me/244954949595';

// Logo SuperLojas completo — PNG transparente local
const LOGO_COMPLETE_TP = path.join(__dirname, 'assets', 'logo-complete-tp.png');
const LOGO_CACHE = DATA_DIR + '/img_cache/logo.png';

function ensureLogoPng() {
  if (fs.existsSync(LOGO_COMPLETE_TP)) {
    const b = fs.readFileSync(LOGO_COMPLETE_TP);
    if (b[0] === 0x89 && b[1] === 0x50 && b.length > 1000) return LOGO_COMPLETE_TP;
  }
  if (fs.existsSync(LOGO_CACHE)) {
    const b = fs.readFileSync(LOGO_CACHE);
    if (b[0] === 0x89 && b[1] === 0x50 && b.length > 500) return LOGO_CACHE;
  }
  return null;
}

function buildLogoDrawtext(w, h) {
  const sz = Math.round(h * 0.035);
  return `drawtext=text='superloja.vip':fontcolor=white:fontsize=${sz}:box=1:boxcolor=black@0.55:boxborderw=6:x=w-tw-20:y=h-th-20`;
}

// Transições xfade variadas — rodam por par de frames
const XFADE_TRANSITIONS = [
  'fade', 'dissolve', 'slideleft', 'slideright',
  'wipeleft', 'fadeblack', 'wiperight', 'circlecrop',
];
const XFADE_DURATION = 0.4; // segundos de sobreposição

// ─── Reel styles (rodam em sequência, sem repetir o anterior) ─────────────────
// Tipo 0: Retrato Rápido  9:16 1.5s/frame — melhor alcance no IG
// Tipo 1: Quadrado Padrão 1:1  2.0s/frame — compatível com FB e IG
// Tipo 2: Retrato Cinema  9:16 3.0s/frame — produto premium, mais tempo de leitura
const REEL_STYLES = [
  { id: 0, name: 'Portrait Fast',      w: 1080, h: 1920, spf: 1.5 },
  { id: 1, name: 'Square Standard',    w: 1080, h: 1080, spf: 2.0 },
  { id: 2, name: 'Portrait Cinematic', w: 1080, h: 1920, spf: 3.0 },
];

// Captions de abertura para reels — rodam sem repetir
const REEL_INTROS = [
  'Ofertas imperdíveis na Superloja!',
  'Tecnologia acessível em Angola!',
  'Os melhores preços de Luanda!',
  'Stock limitado — aproveita já!',
  'Qualidade premium, preço justo!',
  'Entrega rápida em Luanda!',
];

const REEL_HASHTAGS = [
  '#superloja #angola #luanda #tecnologia #ofertas',
  '#superloja #compras #angola #gadgets #luanda',
  '#superloja #reels #angola #tech #promoções',
  '#superloja #luanda #acessórios #electronica',
];

// ─── CTA State ────────────────────────────────────────────────────────────────
function loadCtaState() {
  try {
    if (fs.existsSync(CTA_STATE_FILE)) return JSON.parse(fs.readFileSync(CTA_STATE_FILE, 'utf8'));
  } catch (_) {}
  return { ctaType: 0, count: 0 };
}

function saveCtaState(state) {
  fs.writeFileSync(CTA_STATE_FILE, JSON.stringify(state, null, 2));
}

// Formata preço da store API ("7000.00" → "7.000 Kz"). Remove os centimos, nunca inflaciona.
function fmtPrice(p) {
  let s = String(p == null ? '' : p).trim().replace(/[^\d.,]/g, '');
  if (!s) return '0 Kz';
  s = s.replace(/[.,]\d{2}$/, '');            // remover ".00" de centimos
  const n = parseInt(s.replace(/[.,]/g, ''), 10) || 0;  // remover separadores de milhar
  return (n > 0 ? n.toLocaleString('pt-BR') : '0') + ' Kz';
}

// CTAs optimizados com marketing data (hook forte + urgência genuína + prova social + fricção mínima)
const CTA_TEMPLATES = [
  // 0 — Urgência stock + prazo real (alta conversão 9h-14h WAT)
  `⚠️ Últimas unidades! Stock a esgotar — não esperes mais.\n📦 Pedes antes das 14h → Entrega HOJE em Luanda.\n📲 ${WHATSAPP_LINK}`,
  // 1 — Social proof. 12-Ago: era "+500 clientes em Luanda já escolheram a
  // SuperLoja" — número que ninguém pode sustentar (352 pessoas falaram com o
  // bot; 6 encomendas registadas, 0 entregues). E era o CTA MAIS usado: 52 dos
  // 113 posts com CTA. Trocado por uma frase verdadeira, sem número inventado.
  `👥 Cada vez mais gente em Luanda compra connosco. E tu?\n💬 Respondemos em minutos — fala connosco agora!\n📲 ${WHATSAPP_LINK}`,
  // 2 — Entrega expressa (hook de delivery, top ER FB manhã)
  `🚀 Pedes HOJE, recebes HOJE! Entrega expressa em Luanda.\n✅ Pagamento na entrega disponível — sem risco.\n📲 ${WHATSAPP_LINK}`,
  // 3 — FOMO temporal (escassez + prazo de corte)
  `🔥 Stock a acabar! Oferta válida apenas hoje.\n⏰ Garante o teu antes que esgote — encomenda agora.\n📲 ${WHATSAPP_LINK}`,
  // 4 — Custo-benefício + facilidade (reduz fricção)
  `💰 Melhor preço em Luanda | Qualidade garantida.\n🛵 Entregamos em casa, sem complicações. Pagamento na entrega.\n📲 ${WHATSAPP_LINK}`,
  // 5 — Interacção (hook de pergunta → aumenta comentários e alcance orgânico)
  `👇 Qual é o teu favorito? Comenta abaixo!\n🎯 Garantimos o melhor preço. Fala connosco.\n📲 ${WHATSAPP_LINK}`,
  // 6 — Exclusividade para seguidores (cria sentido de pertença)
  `🎁 Preço especial exclusivo para os nossos seguidores!\n📦 Entrega rápida | Atendimento imediato via WhatsApp.\n📲 ${WHATSAPP_LINK}`,
  // 7 — Confiança + sem risco (elimina objecção de compra online Angola)
  // 12-Ago: dizia "Devolução em 7 dias" — FALSO nos dois pontos. A política
  // confirmada pelo dono (bot-alma.md:31-32) é 1 DIA para verificar e SÓ TROCA,
  // nunca dinheiro de volta. Saiu em 9 posts, o último a 11-Ago 17h02 no FB e no
  // IG. A guarda apanha-o ("devolução/reembolso prometido") mas este ficheiro
  // nunca a chamava. Agora diz a verdade — e a verdade vende melhor.
  `✅ Pagamento na entrega | 1 dia para verificares | Trocamos se não servir.\n💬 Encomendar é simples: WhatsApp → escolhes → entregamos.\n${WHATSAPP_LINK}`,
  // 8 — Prova social local (ancoragem geográfica Angola converte)
  // 12-Ago: dizia "já entregámos mais de 1.000 pedidos". O sistema regista 6
  // encomendas (4 canceladas, 2 pendentes) e ZERO entregues. Número que ninguém
  // pode sustentar → fora, por causa da lei 1. Se o dono tiver o número real das
  // vendas de balcão, pode pô-lo aqui — mas tem de ser ele a confirmá-lo.
  `🏆 A tua loja de tecnologia em Luanda — entregamos em casa em menos de 24h.\n📲 Atendimento imediato: ${WHATSAPP_LINK}`,
  // 9 — Clean/directo (top formato IG: menos texto, mais conversão)
  `📦 Disponível agora | Entrega em Luanda\n💬 Encomenda já → ${WHATSAPP_LINK}`,
];

// ─── Posts Ledger (ciclo fechado de aprendizagem) ────────────────────────────
// Cada post publicado fica registado com a metadata (CTA, produtos, formato);
// o dashboard colhe o engajamento 40h+ depois e a escolha de CTA passa a ser
// ponderada pelo desempenho REAL em vez de rotação cega.
const LEDGER_FILE = DATA_DIR + '/posts-ledger.json';
function ledgerLoad() {
  try { return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')); } catch (_) { return { posts: [] }; }
}
function ledgerRecord(entry) {
  try {
    const led = ledgerLoad();
    led.posts.unshift(Object.assign({ ts: new Date().toISOString(), metrics: null }, entry));
    if (led.posts.length > 500) led.posts = led.posts.slice(0, 500);
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(led, null, 2));
  } catch (e) { console.log('[Ledger] erro:', e.message); }
}

// Código de venda único p/ atribuição de conversão (registado em sales-refs.json;
// o dono/Hermes regista vendas por código e o post ganha crédito real no ledger)
const SALES_FILE = DATA_DIR + '/sales-refs.json';
function newSalesRef(source, products) {
  try {
    const db = fs.existsSync(SALES_FILE) ? JSON.parse(fs.readFileSync(SALES_FILE, 'utf8')) : { refs: [] };
    let code;
    for (let i = 0; i < 20; i++) {
      code = 'SL-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      if (!db.refs.find(r => r.code === code)) break;
    }
    db.refs.unshift({ code, source, products: (products || []).slice(0, 3), createdAt: new Date().toISOString(), sales: [] });
    if (db.refs.length > 400) db.refs = db.refs.slice(0, 400);
    fs.writeFileSync(SALES_FILE, JSON.stringify(db, null, 2));
    return code;
  } catch (e) { return 'SL-' + Date.now().toString(36).toUpperCase().slice(-5); }
}
function salesCtaLine(code) {
  return `🛒 Encomenda direta: https://wa.me/244954949595?text=${encodeURIComponent('Quero o código ' + code)}`;
}

// ─── Directivas de aprendizagem (fecho do ciclo) ─────────────────────────────
// O dashboard destila o histórico → marketing-insights.json.directivas.
// O auto-poster aplica-as DETERMINISTICAMENTE aqui: os posts diários passam a
// obedecer ao que os dados mostram converter (formato, preço na caption, pergunta).
const INSIGHTS_PATH = DATA_DIR + '/marketing-insights.json';
function getDirectives() {
  try {
    const ins = JSON.parse(fs.readFileSync(INSIGHTS_PATH, 'utf8'));
    return ins.directivas || {};
  } catch { return {}; }
}
// Perguntas rotativas p/ gerar comentários (quando a directiva pede)
const SMART_QUESTIONS = [
  'Qual a tua cor favorita? Comenta 👇',
  'Já tens o teu? Conta-nos nos comentários!',
  'Qual preferes — este ou o outro modelo? 👇',
  'Marca um amigo que ia gostar disto!',
];
let _qIdx = 0;
// Monta as linhas de caption respeitando as directivas aprendidas.
// Devolve as linhas do meio (preço + entrega + pergunta) para o post inserir.
function smartCaptionLines(product, dir) {
  const lines = [];
  if (dir.precoNaCaption !== false) lines.push(fmtPrice(product.price)); // default: mostra preço
  lines.push('Entrega rapida em Luanda');
  if (dir.incluirPergunta === true) { lines.push(''); lines.push(SMART_QUESTIONS[_qIdx++ % SMART_QUESTIONS.length]); }
  return lines;
}

function getNextCta() {
  const state = loadCtaState();
  // Desempenho real por CTA (score = gostos + 3×comentários + 5×partilhas, colhido pelo dashboard)
  const stats = {};
  ledgerLoad().posts.forEach(p => {
    if (p.ctaIdx == null || !p.metrics) return;
    (stats[p.ctaIdx] = stats[p.ctaIdx] || []).push(p.metrics.score || 0);
  });
  const samples = Object.values(stats).reduce((a, v) => a + v.length, 0);
  let ctaType;
  // Sinal mínimo antes de explorar. `avg > 0` não chega: a recolha de métricas
  // esteve partida até 08-Ago e, quando foi reparada, apareceram 6 likes
  // repartidos por 100 posts — o "melhor" CTA tinha média 0,06. Com isso o
  // bandit fixava-se num tipo em 65% das publicações por causa de 3 gostos de
  // diferença, e deixava de explorar. Rotação honesta é melhor do que
  // convergir em ruído: só se escolhe quando há pelo menos 1 ponto de média
  // (≈1 gosto por post) para distinguir.
  const SINAL_MINIMO = 1;
  if (samples >= 8) {
    // bandit simples: 65% explora o melhor conhecido, 35% mantém rotação (exploração)
    const avg = i => { const v = stats[i]; return v && v.length ? v.reduce((a, x) => a + x, 0) / v.length : -1; };
    const best = CTA_TEMPLATES.map((_, i) => i).sort((a, b) => avg(b) - avg(a))[0];
    if (Math.random() < 0.65 && avg(best) >= SINAL_MINIMO) {
      ctaType = best;
      console.log(`[CTA] Ponderado: tipo ${ctaType} (melhor média real: ${Math.round(avg(best))} pts em ${stats[ctaType].length} posts)`);
    } else if (avg(best) > 0 && avg(best) < SINAL_MINIMO) {
      console.log(`[CTA] Sinal fraco de mais para escolher (melhor média ${avg(best).toFixed(2)} pts em ${samples} amostras) — mantenho rotação`);
    }
  }
  if (ctaType == null) {
    ctaType = state.ctaType % CTA_TEMPLATES.length;
    state.ctaType++;
    console.log(`[CTA] Rotação: tipo ${ctaType}`);
  }
  state.count++;
  saveCtaState(state);
  const cta = CTA_TEMPLATES[ctaType];
  // expõe o índice usado para o ledger (mantém retorno string p/ compatibilidade)
  getNextCta.lastIdx = ctaType;
  return cta;
}

// ─── API helper ───────────────────────────────────────────────────────────────
function apiCall(endpoint, params = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const allParams = { ...params, access_token: ACCESS_TOKEN };
    const body = new URLSearchParams(allParams).toString();

    if (method === 'POST') {
      const options = {
        hostname: 'graph.facebook.com',
        path: `/v21.0/${endpoint}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Superloja-Auto-Poster/4.3'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse: ${data.slice(0, 200)}`)); }
        });
      }).on('error', reject);
      req.write(body);
      req.end();
      return;
    }

    // GET
    const url = `https://graph.facebook.com/v21.0/${endpoint}?${body}`;
    https.get(url, { headers: { 'User-Agent': 'Superloja-Auto-Poster/4.3' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

// ─── File helpers ─────────────────────────────────────────────────────────────
function downloadImage(url, dest) {
  try {
    execSync(`curl -L -s -o "${dest}" "${url}"`, { timeout: 30000 });
    const stat = fs.statSync(dest);
    if (stat.size === 0) throw new Error('0 bytes');
    const buf = fs.readFileSync(dest);
    const valid = (buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50);
    if (!valid) throw new Error('Not a valid image (' + stat.size + ' bytes)');
    return true;
  } catch (e) {
    console.log(`[Download] Failed ${url.slice(0, 60)}: ${e.message}`);
    return false;
  }
}

function uploadFileCurl(winPath, host, timeParam, retries = 3) {
  const url = host === 'litterbox'
    ? 'https://litterbox.catbox.moe/resources/internals/api.php'
    : 'https://catbox.moe/user/api.php';
  const curlPath = winPath.replace(/\\/g, '/');
  for (let i = 0; i < retries; i++) {
    try {
      let cmd = `curl -s --max-time 180 -F "reqtype=fileupload"`;
      if (timeParam) cmd += ` -F "time=${timeParam}"`;
      cmd += ` -F "fileToUpload=@${curlPath}" "${url}"`;
      const result = execSync(cmd, { timeout: 200000, maxBuffer: 50 * 1024 * 1024, shell: true }).toString().trim();
      if (result && result.startsWith('http')) return result;
      if (result && result.toLowerCase().includes('paused') && host === 'catbox') {
        return uploadFileCurl(winPath, 'litterbox', '72h', 2);
      }
    } catch (e) {
      if (i < retries - 1) execSync('sleep 2');
      else throw e;
    }
  }
  return null;
}

function uploadToHost(filepath) {
  // Tenta catbox permanente, fallback para litterbox 72h
  const result = uploadFileCurl(filepath, 'catbox', null, 3);
  if (result) return result;
  console.log('[Upload] catbox falhou, usando litterbox 72h...');
  return uploadFileCurl(filepath, 'litterbox', '72h', 3);
}

// ─── Audio rotation (sem repetir até esgotar todas as músicas) ────────────────
function loadAudioState() {
  try {
    if (fs.existsSync(AUDIO_STATE_FILE))
      return JSON.parse(fs.readFileSync(AUDIO_STATE_FILE, 'utf8'));
  } catch (_) {}
  return { queue: [], lastUsed: null };
}

function saveAudioState(state) {
  fs.writeFileSync(AUDIO_STATE_FILE, JSON.stringify(state, null, 2));
}

function nextAudio() {
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  if (files.length === 0) return null;

  const state = loadAudioState();

  // Fila vazia → embaralhar todas (Fisher-Yates) e recriar
  if (state.queue.length === 0) {
    const shuffled = [...files];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Garantir que a primeira da nova fila não é igual à última tocada
    if (shuffled.length > 1 && shuffled[0] === state.lastUsed) {
      shuffled.push(shuffled.shift());
    }
    state.queue = shuffled;
  }

  const chosen = state.queue.shift();
  state.lastUsed = chosen;
  saveAudioState(state);

  console.log(`[Audio] ${chosen} (${state.queue.length} restantes na fila)`);
  return AUDIO_DIR + '/' + chosen;
}

// ─── Reel state (rotação de estilos e conteúdo) ────────────────────────────────
function loadReelState() {
  try {
    if (fs.existsSync(REEL_STATE_FILE))
      return JSON.parse(fs.readFileSync(REEL_STATE_FILE, 'utf8'));
  } catch (_) {}
  return { styleIdx: 0, introIdx: 0, hashtagIdx: 0, count: 0 };
}

function saveReelState(state) {
  fs.writeFileSync(REEL_STATE_FILE, JSON.stringify(state, null, 2));
}

function getNextReelConfig() {
  const state = loadReelState();
  const style    = REEL_STYLES[state.styleIdx    % REEL_STYLES.length];
  const intro    = REEL_INTROS[state.introIdx    % REEL_INTROS.length];
  const hashtags = REEL_HASHTAGS[state.hashtagIdx % REEL_HASHTAGS.length];

  state.styleIdx++;
  state.introIdx++;
  state.hashtagIdx++;
  state.count++;
  saveReelState(state);

  console.log(`[Reel] Estilo: ${style.name} (${style.w}x${style.h}, ${style.spf}s/frame)`);
  return { style, intro, hashtags };
}

// ─── ffmpeg discovery ─────────────────────────────────────────────────────────
function findFfmpeg() {
  const candidates = [
    'C:\\Users\\fox\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const out = execSync('where ffmpeg', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim();
    if (out) return out;
  } catch (_) {}
  return 'ffmpeg'; // espera que esteja no PATH
}

// ─── Post State — rastreamento de produtos por ID (persiste no disco) ────────
// Garante que nenhum produto se repete até toda a lista ser percorrida,
// mesmo com reinício do PC, do webhook, ou mudança de ordem da API.
// Estado separado por plataforma: FB e IG avançam de forma independente.
// Ficheiro: DATA_DIR/post-state.json
//   { "v": 2, "fb": { "postedIds": [...], "cycleCount": N }, "ig": { ... } }

function loadPostState() {
  try {
    if (fs.existsSync(POST_STATE_FILE)) {
      const d = JSON.parse(fs.readFileSync(POST_STATE_FILE, 'utf8'));
      if (d && d.v === 2) return d;
    }
  } catch (_) {}
  // Migração do estado antigo (.product_index / checklist.json)
  return { v: 2, fb: { postedIds: [], cycleCount: 0 }, ig: { postedIds: [], cycleCount: 0 } };
}

function savePostState(state) {
  fs.writeFileSync(POST_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Seleciona `count` produtos de forma SEQUENCIAL, rastreando por ID de produto.
 * - Não repete nenhum produto até toda a lista da API ser percorrida.
 * - Estado persiste em disco: reiniciar o PC ou o webhook não causa repetição.
 * - FB e IG têm fila independente — podem estar em pontos diferentes da lista.
 * - Quando todos os produtos forem postados, o ciclo reinicia automaticamente
 *   e um log indica quantas voltas completas já foram dadas.
 */
function getProductsSequential(products, platform, count) {
  if (products.length === 0) return [];

  const state   = loadPostState();
  const plat    = state[platform] || { postedIds: [], cycleCount: 0 };
  state[platform] = plat;

  // IDs disponíveis = todos os IDs da API que ainda NÃO foram postados neste ciclo
  const allIds   = products.map(p => String(p.id));
  const postedSet = new Set(plat.postedIds);

  // Filtrar em ordem da API (garante sequência estável independente de reinícios)
  let pending = allIds.filter(id => !postedSet.has(id));

  if (pending.length === 0) {
    // Ciclo completo — reiniciar fila para esta plataforma
    plat.cycleCount++;
    plat.postedIds = [];
    postedSet.clear();
    pending = [...allIds];
    console.log(`[PostState] ${platform.toUpperCase()}: ciclo #${plat.cycleCount} iniciado (${products.length} produtos)`);
  }

  // Construir mapa de id → produto
  const byId = {};
  products.forEach(p => { byId[String(p.id)] = p; });

  const selected = [];
  const nowPosted = [];

  for (const pid of pending) {
    if (selected.length >= count) break;
    const product = byId[pid];
    if (!product) continue;
    const images = product.images || [];
    if (!images.length) continue;

    // Escolher primeira imagem disponível (string URL)
    const img = images[0];
    const imgStr = typeof img === 'string' ? img : (img?.url || img?.src || img?.path || '');
    if (!imgStr) continue;

    selected.push({ product, image: imgStr, imgIdx: 0 });
    nowPosted.push(pid);
  }

  // Persistir: adicionar IDs recém-postados
  plat.postedIds = [...plat.postedIds, ...nowPosted];
  savePostState(state);

  const remaining = allIds.length - plat.postedIds.length;
  console.log(`[PostState] ${platform.toUpperCase()}: postados ${plat.postedIds.length}/${allIds.length} neste ciclo (restam ${remaining})`);

  return selected;
}

// ─── Selecao MANUAL de produtos ─────────────────────────────────────────────────
// Se MANUAL_PRODUCT_IDS (csv de ids) estiver setado, usa exatamente esses produtos
// na ordem escolhida (1a imagem de cada). Senao, cai no sequencial automatico.
function getSelectedByIds(products, idsCsv) {
  const ids = String(idsCsv).split(',').map(s => s.trim()).filter(Boolean);
  const byId = {};
  products.forEach(p => { byId[String(p.id)] = p; });
  const selected = [];
  for (const id of ids) {
    const product = byId[id];
    if (!product) { console.log(`[Manual] produto ${id} nao encontrado`); continue; }
    const images = product.images || [];
    if (!images.length) { console.log(`[Manual] produto ${id} sem imagens`); continue; }
    const img = images[0];
    const imgStr = typeof img === 'string' ? img : (img?.url || img?.src || img?.path || '');
    if (!imgStr) continue;
    selected.push({ product, image: imgStr, imgIdx: 0 });
  }
  return selected;
}

function pickProducts(products, platform, count) {
  const manual = process.env.MANUAL_PRODUCT_IDS;
  if (manual && manual.trim()) {
    const sel = getSelectedByIds(products, manual);
    if (sel.length) {
      console.log(`[Manual] ${sel.length} produto(s) escolhido(s) manualmente`);
      return sel;
    }
    console.log('[Manual] nenhum produto valido — usando selecao automatica');
  }
  return getProductsSequential(products, platform, count);
}

// ─── Products API ──────────────────────────────────────────────────────────────
function getProducts() {
  console.log('[Products] Fetching from Superloja API...');
  try {
    // per_page=200: com 90 e 86 produtos faltavam 4 para o catálogo dos posts
    // passar a sair truncado sem ninguém notar
    const url = `https://superloja.vip/api/store-api/superloja/products?per_page=200&page=1&store=superloja`;
    const data = execSync(
      `curl -s -H "X-Api-Key: ${process.env.SUPERLOJA_API_KEY}" -H "X-Api-Secret: ${process.env.SUPERLOJA_API_SECRET}" "${url}"`,
      { timeout: 30000 }
    );
    const json = JSON.parse(data.toString());
    const raw = json.data || json.products || [];
    // stock-aware: nunca promover produto esgotado
    const products = raw.filter(p => p.stock == null || Number(p.stock) > 0);
    if (raw.length !== products.length) console.log(`[Products] ${raw.length - products.length} produto(s) sem stock excluído(s)`);
    if (products.length > 0) {
      console.log(`[Products] API OK — ${products.length} produtos`);
      // auto-refresca a cache a cada fetch bem-sucedido: o fallback nunca fica
      // mais velho que o último post que correu (antes tinha 45 dias!)
      try {
        fs.writeFileSync(__dirname + '/products-cache.json',
          JSON.stringify({ updatedAt: new Date().toISOString(), products: raw }, null, 2), 'utf8');
      } catch (_) {}
      return products;
    }
  } catch (e) {
    console.log(`[Products] API falhou: ${e.message.slice(0, 100)}`);
  }

  // Fallback: cache local — COM filtro de stock (a cache guarda o raw) e aviso de idade
  const cacheFile = __dirname + '/products-cache.json';
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const list = (cached.products || cached.data || []).filter(p => p.stock == null || Number(p.stock) > 0);
      const idadeDias = cached.updatedAt ? Math.round((Date.now() - Date.parse(cached.updatedAt)) / 86400000) : '?';
      console.log(`[Products] Cache local — ${list.length} produtos com stock (idade: ${idadeDias} dia(s))`);
      if (idadeDias === '?' || idadeDias > 3) console.log('[Products] AVISO: cache velha — stock pode estar errado');
      return list;
    } catch (e) { console.error('[Products] Cache error:', e.message); }
  }

  return [];
}

// ─── Image URL helper (upload para Catbox se necessário) ──────────────────────
async function resolveImageUrl(rawUrl, platform) {
  const fullUrl = rawUrl.startsWith('http') ? rawUrl : 'https://superloja.vip' + rawUrl;

  // Para IG: URL directa funciona se for pública
  if (platform === 'ig') return fullUrl;

  // Para FB: download + reupload via Catbox para garantir acessibilidade
  const tmpDir = DATA_DIR + '/img_cache';
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = tmpDir + `/img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;

  if (!downloadImage(fullUrl, tmpFile)) return fullUrl;

  try {
    const uploaded = uploadToHost(tmpFile);
    if (uploaded && uploaded.startsWith('http')) return uploaded;
  } catch (e) { console.log(`[Upload] ${e.message}`); }

  return fullUrl;
}

// ─── Edicao de imagem — ESTILO 2: faixa laranja com nome + preco ─────────────
// Normaliza p/ 1080x1080, faixa da marca embaixo (nome + "Entrega em Luanda" +
// preco a direita) e marca d'agua superloja.vip no topo. Usa ffmpeg (drawbox/drawtext).
function editProductPhoto(localImagePath, product, ffmpeg) {
  if (!ffmpeg) return localImagePath;
  const tmpDir = DATA_DIR + '/img_cache';
  const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const outFile    = `${tmpDir}/edited_${stamp}.jpg`;
  const nameFile   = `${tmpDir}/name_${stamp}.txt`;
  const priceFile  = `${tmpDir}/price_${stamp}.txt`;
  const scriptFile = `${tmpDir}/fgedit_${stamp}.txt`;
  const pp = s => s.replace(/\\/g, '/');
  // escapa o ":" do drive p/ filtergraph lido de arquivo: precisa "\\:" (backslash duplo)
  const ff = s => pp(s).replace(/:/g, '\\\\:');
  try {
    let name = String(product.name || '').trim();
    if (name.length > 30) name = name.slice(0, 29) + '…';
    const priceStr = fmtPrice(product.price);
    fs.writeFileSync(nameFile, name, 'utf8');
    fs.writeFileSync(priceFile, priceStr, 'utf8');

    const FONT  = ff('C:/Windows/Fonts/arial.ttf');
    const FONTB = ff('C:/Windows/Fonts/arialbd.ttf');
    const W = 1080, H = 1080, BAR = 150, BY = H - BAR;
    const logoPath = ensureLogoPng();
    const LOGO_W = 220;

    let fg, cmd;
    if (logoPath) {
      // Logo overlay no topo-direito, faixa laranja + textos embaixo
      // Cada filterchain numa linha, separada por ; (nunca vírgula antes de \n)
      const chain1 = [
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white`,
        `drawbox=x=0:y=${BY}:w=${W}:h=${BAR}:color=0xEA580C@1:t=fill`,
        `drawtext=fontfile=${FONTB}:textfile=${ff(nameFile)}:expansion=none:fontcolor=white:fontsize=44:x=44:y=${BY + 28}`,
        `drawtext=fontfile=${FONT}:text=Entrega em Luanda:fontcolor=0xFFD9C2:fontsize=26:x=44:y=${BY + 92}`,
        `drawtext=fontfile=${FONTB}:textfile=${ff(priceFile)}:expansion=none:fontcolor=white:fontsize=56:x=w-tw-44:y=${BY + 46}[styled]`
      ].join(',');
      const chain2 = `[1:v]scale=${LOGO_W}:-1,format=rgba,colorchannelmixer=aa=0.92[logo]`;
      const chain3 = `[styled][logo]overlay=W-w-16:16[vout]`;
      fg = [chain1, chain2, chain3].join(';\n');
      fs.writeFileSync(scriptFile, fg, 'utf8');
      cmd = `"${ffmpeg}" -y -i "${pp(localImagePath)}" -i "${pp(logoPath)}" -filter_complex_script "${pp(scriptFile)}" -map "[vout]" -q:v 3 "${pp(outFile)}"`;
    } else {
      fg = '[0:v]' + [
        `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white`,
        `drawbox=x=0:y=${BY}:w=${W}:h=${BAR}:color=0xEA580C@1:t=fill`,
        `drawtext=fontfile=${FONTB}:textfile=${ff(nameFile)}:expansion=none:fontcolor=white:fontsize=44:x=44:y=${BY + 28}`,
        `drawtext=fontfile=${FONT}:text=Entrega em Luanda:fontcolor=0xFFD9C2:fontsize=26:x=44:y=${BY + 92}`,
        `drawtext=fontfile=${FONTB}:textfile=${ff(priceFile)}:expansion=none:fontcolor=white:fontsize=56:x=w-tw-44:y=${BY + 46}`,
        `drawtext=fontfile=${FONT}:text=superloja.vip:fontcolor=white:fontsize=26:box=1:boxcolor=black@0.45:boxborderw=7:x=w-tw-22:y=22`
      ].join(',') + '[vout]';
      fs.writeFileSync(scriptFile, fg, 'utf8');
      cmd = `"${ffmpeg}" -y -i "${pp(localImagePath)}" -filter_complex_script "${pp(scriptFile)}" -map "[vout]" -q:v 3 "${pp(outFile)}"`;
    }
    execSync(cmd, { timeout: 30000, stdio: 'pipe' });

    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
      console.log(`[Edit] Estilo 2 aplicado: ${name}`);
      return outFile;
    }
  } catch (e) {
    console.log(`[Edit] Falhou (${String(e.message).slice(0, 80)}) — usando imagem original`);
  } finally {
    [nameFile, priceFile, scriptFile].forEach(f => { try { fs.unlinkSync(f); } catch {} });
  }
  return localImagePath;
}

// Baixa a imagem do produto, desenha um TEMPLATE de marca (sharp+SVG, rotação
// sem repetição — post-templates.js) e sobe p/ host publico. Se o template
// falhar, cai no estilo 2 classico (ffmpeg); se tudo falhar, URL original.
// tplFixo: reels/carrossel passam UM template para o conjunto inteiro ficar
// consistente; posts single deixam rodar.
async function prepareEditedImage(rawImage, product, ffmpeg, tplFixo) {
  const fullUrl = rawImage.startsWith('http') ? rawImage : 'https://superloja.vip' + rawImage;
  try {
    const tmpDir = DATA_DIR + '/img_cache';
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const dl = `${tmpDir}/src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
    if (!downloadImage(fullUrl, dl)) return fullUrl;

    // 1) template bonito (novo)
    try {
      const tplOut = dl.replace(/\.jpg$/, '_tpl.jpg');
      const usado = await postTemplates.renderCard(dl, product, tplOut, tplFixo || undefined);
      console.log(`[Template] ${usado}`);
      const up1 = uploadToHost(tplOut);
      if (up1 && up1.startsWith('http')) return up1;
    } catch (e) { console.log(`[Template] falhou (${String(e.message).slice(0, 50)}) — estilo clássico`); }

    // 2) estilo 2 clássico (fallback)
    const edited = editProductPhoto(dl, product, ffmpeg);
    const uploaded = uploadToHost(edited);
    if (uploaded && uploaded.startsWith('http')) return uploaded;
  } catch (e) { console.log(`[Edit] prepare falhou: ${String(e.message).slice(0, 60)}`); }
  return fullUrl;
}

// ─── Facebook posting ─────────────────────────────────────────────────────────
// GUARDA anti-alucinação para o que é PUBLICADO. Lei 4: corre sempre no fim,
// sobre tudo o que sai. Este ficheiro publicou 247 posts sem NUNCA a chamar —
// era o mesmo buraco dos comentários (corrigido a 11-Ago) e é a superfície do
// incidente de 22-25 Jul (número de WhatsApp inventado em 7 posts publicados).
// Aqui é pior que numa DM: fica público, e no Instagram a Meta não deixa editar
// a caption por API — um post errado só se corrige apagando.
// Aplicada nas CINCO funções de publicação, no último momento antes da API, para
// que nenhum caminho novo de caption lhe escape.
// Devolve a caption limpa, ou null quando não há nada seguro para publicar —
// e nesse caso NÃO se publica. Nunca devolver o texto original por a guarda o
// ter esvaziado: o caso em que ela apaga tudo é precisamente o caso em que o
// texto era todo mau (ex.: uma frase única com um número de WhatsApp inventado).
// Um "fallback" para o original seria republicar exactamente o que ela travou.
function limparCaption(caption, onde) {
  const t = String(caption || '');
  let limpa;
  try {
    limpa = textGuard.sanitizarTexto(t, {
      onRemove: (motivo, frase) => console.log(`[GUARDA] ${onde}: removido (${motivo}): ${String(frase).slice(0, 70)}`),
    });
  } catch (e) {
    // guarda avariada = não sabemos se é seguro. Não publicar às cegas.
    console.log('[GUARDA] falhou em ' + onde + ': ' + e.message + ' — post cancelado');
    return null;
  }
  if (!limpa || !limpa.trim()) {
    console.log(`[GUARDA] ${onde}: a caption ficou vazia depois de limpar — post CANCELADO (nada é publicado)`);
    return null;
  }
  return limpa;
}

async function postFbPhoto(imageUrl, caption) {
  caption = limparCaption(caption, 'FB foto');
  if (caption === null) return null;   // guarda travou: nao publicar
  const tmpDir = DATA_DIR + '/img_cache';
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const tmpFile = tmpDir + `/fb_${Date.now()}.jpg`;
  const fullUrl = imageUrl.startsWith('http') ? imageUrl : 'https://superloja.vip' + imageUrl;

  if (!downloadImage(fullUrl, tmpFile)) {
    console.log('[FB Photo] Download falhou');
    return null;
  }

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('access_token', ACCESS_TOKEN);
    form.append('source', fs.createReadStream(tmpFile));
    form.append('caption', caption);
    form.append('published', 'true');

    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v21.0/${FB_PAGE_ID}/photos`,
      method: 'POST',
      headers: form.getHeaders()
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.id) console.log(`[FB Photo] Postado: ${json.id}`);
          else console.log(`[FB Photo] Erro: ${json.error?.message}`);
          resolve(json);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
    form.pipe(req);
  });
}

async function postFbCarousel(images, caption) {
  caption = limparCaption(caption, 'FB carrossel');
  if (caption === null) return null;   // guarda travou: nao publicar
  console.log(`[FB Carousel] ${images.length} imagens...`);
  const attachedMedia = [];

  for (let i = 0; i < Math.min(images.length, 10); i++) {
    const fullUrl = images[i].startsWith('http') ? images[i] : 'https://superloja.vip' + images[i];
    let publicUrl = fullUrl;

    // Upload para Catbox para garantir que o FB consegue aceder
    const tmpFile = DATA_DIR + `/img_cache/carousel_${Date.now()}_${i}.jpg`;
    if (downloadImage(fullUrl, tmpFile)) {
      const uploaded = uploadToHost(tmpFile);
      if (uploaded) publicUrl = uploaded;
    }

    try {
      const res = await apiCall(`${FB_PAGE_ID}/photos`, { url: publicUrl, published: 'false' }, 'POST');
      if (res?.id) {
        attachedMedia.push({ media_fbid: res.id });
        console.log(`  [${i+1}/${images.length}] OK: ${res.id}`);
      } else {
        console.log(`  [${i+1}/${images.length}] Erro: ${res?.error?.message}`);
      }
    } catch (e) { console.log(`  [${i+1}] Exception: ${e.message}`); }

    await sleep(1500);
  }

  if (attachedMedia.length === 0) {
    console.log('[FB Carousel] Nenhuma imagem carregada, usando foto simples...');
    return postFbPhoto(images[0], caption);
  }

  const feedRes = await apiCall(`${FB_PAGE_ID}/feed`, {
    message: caption,
    attached_media: JSON.stringify(attachedMedia)
  }, 'POST');

  if (feedRes?.id) console.log(`[FB Carousel] Postado: ${feedRes.id}`);
  else {
    console.log('[FB Carousel] Feed falhou, fallback foto simples...', feedRes?.error?.message);
    return await postFbPhoto(images[0], caption);
  }
  return feedRes;
}

async function postFbVideo(videoUrl, title, description) {
  console.log(`[FB Video] Enviando: ${videoUrl.slice(0, 60)}...`);
  const res = await apiCall(`${FB_PAGE_ID}/videos`, {
    file_url: videoUrl,
    title,
    description
  }, 'POST');
  if (res?.id) console.log(`[FB Video] Postado: ${res.id}`);
  else console.log(`[FB Video] Erro: ${res?.error?.message}`);
  return res;
}

// ─── Instagram posting ────────────────────────────────────────────────────────
async function postIgPhoto(imageUrl, caption) {
  caption = limparCaption(caption, 'IG foto');
  if (caption === null) return null;   // guarda travou: nao publicar
  const fullUrl = imageUrl.startsWith('http') ? imageUrl : 'https://superloja.vip' + imageUrl;

  const container = await apiCall(`${IG_PAGE_ID}/media`, {
    image_url: fullUrl,
    media_type: 'IMAGE',
    caption
  }, 'POST');

  const containerId = container?.id;
  if (!containerId) {
    console.log(`[IG Photo] Container falhou: ${container?.error?.message}`);
    return null;
  }

  await sleep(4000);
  const pub = await apiCall(`${IG_PAGE_ID}/media_publish`, { creation_id: containerId }, 'POST');
  if (pub?.id) console.log(`[IG Photo] Publicado: ${pub.id}`);
  else console.log(`[IG Photo] Publish erro: ${pub?.error?.message}`);
  return pub;
}

async function postIgCarousel(imageUrls, caption) {
  caption = limparCaption(caption, 'IG carrossel');
  if (caption === null) return null;   // guarda travou: nao publicar
  console.log(`[IG Carousel] ${imageUrls.length} imagens...`);
  const childIds = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const fullUrl = imageUrls[i].startsWith('http') ? imageUrls[i] : 'https://superloja.vip' + imageUrls[i];
    try {
      const res = await apiCall(`${IG_PAGE_ID}/media`, {
        image_url: fullUrl,
        media_type: 'IMAGE'
      }, 'POST');
      if (res?.id) {
        childIds.push(res.id);
        console.log(`  [${i+1}/${imageUrls.length}] OK: ${res.id}`);
      } else {
        console.log(`  [${i+1}/${imageUrls.length}] Erro: ${res?.error?.message}`);
      }
    } catch (e) { console.log(`  [${i+1}] Exception: ${e.message}`); }
    await sleep(1000);
  }

  if (childIds.length < 2) {
    console.log(`[IG Carousel] Minimo 2 imagens, got ${childIds.length}`);
    return;
  }

  const container = await apiCall(`${IG_PAGE_ID}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption
  }, 'POST');

  if (!container?.id) {
    console.log(`[IG Carousel] Container erro: ${container?.error?.message}`);
    return;
  }

  await sleep(5000);
  const pub = await apiCall(`${IG_PAGE_ID}/media_publish`, { creation_id: container.id }, 'POST');
  if (pub?.id) console.log(`[IG Carousel] Publicado: ${pub.id}`);
  else console.log(`[IG Carousel] Publish erro: ${pub?.error?.message}`);
  return pub;
}

/**
 * Publica um Reel no Instagram com polling de status.
 * O IG exige polling de GET /{id}?fields=status_code até FINISHED antes de publicar.
 */
async function postIgReel(videoUrl, caption) {
  caption = limparCaption(caption, 'IG reel');
  if (caption === null) return null;   // guarda travou: nao publicar
  console.log(`[IG Reels] Criando container...`);

  const container = await apiCall(`${IG_PAGE_ID}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: 'true'
  }, 'POST');

  const containerId = container?.id;
  if (!containerId) {
    console.log(`[IG Reels] Container falhou: ${container?.error?.message}`);
    return null;
  }

  console.log(`[IG Reels] Container: ${containerId} — aguardando processamento...`);

  // Polling até status FINISHED (máx 3 minutos)
  const maxWait = 180000;
  const pollInterval = 6000;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    await sleep(pollInterval);
    try {
      const status = await apiCall(containerId, { fields: 'status_code,status' });
      const code = status?.status_code;
      console.log(`  [IG Reels] Status: ${code}`);
      if (code === 'FINISHED') break;
      if (code === 'ERROR' || code === 'EXPIRED') {
        console.log(`[IG Reels] Processamento falhou: ${code} — ${status?.status}`);
        return null;
      }
    } catch (e) { console.log(`  [IG Reels] Polling error: ${e.message}`); }
  }

  const pub = await apiCall(`${IG_PAGE_ID}/media_publish`, { creation_id: containerId }, 'POST');
  if (pub?.id) console.log(`[IG Reels] Publicado: ${pub.id}`);
  else console.log(`[IG Reels] Publish erro: ${pub?.error?.message}`);
  return pub;
}

// ─── Reels slideshow (ffmpeg) — xfade transitions + logo PNG overlay ──────────
/**
 * Cria MP4 slideshow com:
 *   Step 1 — xfade transitions variadas entre frames (scale + pad + setsar por input)
 *   Step 2 — overlay do logo PNG (ou drawtext fallback)
 *   Step 3 — mux áudio em loop
 * Retorna URL pública (Catbox) do vídeo.
 */
async function createReelsSlideshow(products, audioPath, style) {
  const { w, h, spf, name } = style;
  const tmpDir    = DATA_DIR + '/img_cache';
  const ts        = Date.now();
  const framesDir = path.join(tmpDir, 'frames_' + ts);
  fs.mkdirSync(framesDir, { recursive: true });

  const ffmpeg = findFfmpeg();
  const pp = (s) => s.replace(/\\/g, '/'); // caminhos POSIX para ffmpeg
  console.log(`  [Reels] ${name} ${w}x${h} ${spf}s/frame`);

  // ── 1. Download das imagens + template de marca por frame ─────────────────
  // UM template para o reel inteiro (consistente dentro do video, varia entre
  // reels — rotação sem repetição). Falha de template = frame crua (como antes).
  const tplReel = (() => { try { return postTemplates.nextTemplate(); } catch { return null; } })();
  if (tplReel) console.log(`  [Reels] template: ${tplReel}`);
  const framePaths = [];
  for (let i = 0; i < products.length; i++) {
    const prod   = products[i];
    const rawImg = prod.image || prod.product?.images?.[0] || prod.images?.[0];
    const imgUrl = typeof rawImg === 'string' ? rawImg : (rawImg?.url || rawImg?.src || '');
    if (!imgUrl) continue;
    const fullUrl   = imgUrl.startsWith('http') ? imgUrl : 'https://superloja.vip' + imgUrl;
    const framePath = path.join(framesDir, `frame_${String(i).padStart(3, '0')}.jpg`);
    if (!downloadImage(fullUrl, framePath)) continue;
    if (tplReel) {
      try {
        const p2 = prod.product || prod;
        const tplPath = framePath.replace(/\.jpg$/, '_tpl.jpg');
        await postTemplates.renderCard(framePath, { name: p2.name, price: p2.price }, tplPath, tplReel);
        framePaths.push(tplPath);
        continue;
      } catch (e) { console.log(`  [Reels] template falhou na frame ${i}: ${String(e.message).slice(0, 40)}`); }
    }
    framePaths.push(framePath);
  }
  if (framePaths.length === 0) throw new Error('Nenhuma frame disponivel para o reel');

  const N          = framePaths.length;
  const totalDur   = parseFloat((N * spf - (N - 1) * XFADE_DURATION).toFixed(3));
  const step1Mp4   = path.join(framesDir, 'step1.mp4');
  const step2Mp4   = path.join(framesDir, 'step2.mp4');
  const outputMp4  = path.join(tmpDir, `reel_${ts}.mp4`);

  // ── 2. Step 1 — Ken Burns (zoom) + fundo desfocado por clip, depois xfade ──
  // Estilo CapCut: cada imagem vira um clip com fundo desfocado (em vez de barras
  // pretas) e um zoom lento (Ken Burns). Depois cadeia de transicoes xfade.
  const FPS  = 30;
  const DURF = Math.round(spf * FPS);
  console.log(`  [Step 1] ${N} clips Ken Burns + fundo desfocado @${FPS}fps...`);

  const fgW = Math.round(w * 0.88), fgH = Math.round(h * 0.82); // produto com margem
  const clipPaths = [];
  for (let i = 0; i < N; i++) {
    const clip = path.join(framesDir, `clip_${i}.mp4`);
    // bg = imagem a cobrir o frame, desfocada e levemente escurecida (recua);
    // fg = produto nitido centrado; zoompan = zoom lento (Ken Burns).
    const fgc = [
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=26:2,eq=brightness=-0.06:saturation=1.12[bg]`,
      `[0:v]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[comp]`,
      `[comp]zoompan=z='min(1.002+on*0.0005,1.08)':x='(iw-iw/min(1.002+on*0.0005,1.08))/2':y='(ih-ih/min(1.002+on*0.0005,1.08))/2':d=${DURF}:s=${w}x${h}:fps=${FPS},setsar=1,format=yuv420p[v]`
    ].join(';\n');
    const fgcFile = path.join(framesDir, `fgc_${i}.txt`);
    fs.writeFileSync(fgcFile, fgc);
    // input FRAME-UNICO (sem -loop): zoompan gera os DURF frames com zoom suave
    const cmdc = `"${ffmpeg}" -y -i "${pp(framePaths[i])}" -filter_complex_script "${pp(fgcFile)}" -map "[v]" -frames:v ${DURF} -r ${FPS} -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${pp(clip)}"`;
    try {
      execSync(cmdc, { timeout: 120000, stdio: 'pipe' });
      clipPaths.push(clip);
    } catch (e) {
      // fallback: clip estatico com fundo desfocado (sem zoom)
      const fgs = [
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=26:2,eq=brightness=-0.06:saturation=1.12[bg]`,
        `[0:v]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`
      ].join(';\n');
      const fgsFile = path.join(framesDir, `fgs_${i}.txt`);
      fs.writeFileSync(fgsFile, fgs);
      const cmdcf = `"${ffmpeg}" -y -loop 1 -t ${spf} -i "${pp(framePaths[i])}" -filter_complex_script "${pp(fgsFile)}" -map "[v]" -r ${FPS} -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${pp(clip)}"`;
      try { execSync(cmdcf, { timeout: 120000, stdio: 'pipe' }); clipPaths.push(clip); console.log(`  [Step 1] clip ${i}: fallback estatico`); }
      catch (_) { console.log(`  [Step 1] clip ${i} falhou de vez`); }
    }
  }
  if (clipPaths.length === 0) { cleanDir(framesDir); throw new Error('Nenhum clip gerado'); }

  const M = clipPaths.length;
  const inputs1 = clipPaths.map(c => `-i "${pp(c)}"`).join(' ');
  const fgLines = [];
  if (M === 1) {
    fgLines.push('[0:v]null[vslide]');
  } else {
    let prev = '0:v';
    for (let i = 0; i < M - 1; i++) {
      const trans  = XFADE_TRANSITIONS[i % XFADE_TRANSITIONS.length];
      // offset da i-esima transicao = (i+1)*(spf-xfade): cada clip aparece spf-xfade
      // solo antes de cruzar com o proximo (total = M*spf - (M-1)*xfade)
      const offset = ((i + 1) * (spf - XFADE_DURATION)).toFixed(3);
      const out    = i === M - 2 ? 'vslide' : `x${i}`;
      fgLines.push(`[${prev}][${i + 1}:v]xfade=transition=${trans}:duration=${XFADE_DURATION}:offset=${offset}[${out}]`);
      prev = out;
    }
  }
  const fgFile1 = path.join(framesDir, 'fg1.txt');
  fs.writeFileSync(fgFile1, fgLines.join(';\n'));
  console.log(`  [Step 1] xfade (${XFADE_TRANSITIONS.slice(0, M - 1).join(', ')})`);

  const cmd1 = `"${ffmpeg}" -y ${inputs1} -filter_complex_script "${pp(fgFile1)}" -map "[vslide]" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${pp(step1Mp4)}"`;

  try {
    execSync(cmd1, { timeout: 300000, stdio: 'pipe' });
    const sz = fs.statSync(step1Mp4).size;
    if (sz < 50000) throw new Error(`Muito pequeno: ${sz}B`);
    console.log(`  [Step 1] OK (${(sz/1024/1024).toFixed(1)} MB)`);
  } catch (e) {
    cleanDir(framesDir);
    throw new Error('[Step 1] ' + e.message.slice(-300));
  }

  // ── 3. Step 2 — logo overlay ──────────────────────────────────────────────
  const logoPng   = ensureLogoPng();
  let videoForAudio = step1Mp4;

  if (logoPng) {
    console.log(`  [Step 2] Overlay logo PNG...`);
    const logoW  = Math.round(w * 0.16);
    const fgLogo = [
      `[1:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=0.88[logo]`,
      `[0:v][logo]overlay=W-w-24:H-h-24[vout]`
    ].join(';\n');
    const fgFile2 = path.join(framesDir, 'fg2.txt');
    fs.writeFileSync(fgFile2, fgLogo);

    const cmd2 = `"${ffmpeg}" -y -i "${pp(step1Mp4)}" -i "${pp(logoPng)}" -filter_complex_script "${pp(fgFile2)}" -map "[vout]" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${pp(step2Mp4)}"`;
    try {
      execSync(cmd2, { timeout: 120000, stdio: 'pipe' });
      console.log(`  [Step 2] Logo OK`);
      videoForAudio = step2Mp4;
    } catch (_) {
      console.log('  [Step 2] Logo falhou — usando drawtext fallback');
      const wm  = buildLogoDrawtext(w, h);
      const cmd2b = `"${ffmpeg}" -y -i "${pp(step1Mp4)}" -vf "${wm}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${pp(step2Mp4)}"`;
      try { execSync(cmd2b, { timeout: 120000, stdio: 'pipe' }); videoForAudio = step2Mp4; } catch (_2) {}
    }
  } else {
    console.log('  [Step 2] Logo PNG indisponível — drawtext...');
    const wm    = buildLogoDrawtext(w, h);
    const cmd2b = `"${ffmpeg}" -y -i "${pp(step1Mp4)}" -vf "${wm}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${pp(step2Mp4)}"`;
    try { execSync(cmd2b, { timeout: 120000, stdio: 'pipe' }); videoForAudio = step2Mp4; } catch (_) {}
  }

  // ── 4. Step 3 — mux áudio ─────────────────────────────────────────────────
  const hasAudio = audioPath && fs.existsSync(audioPath);
  if (hasAudio) {
    console.log(`  [Step 3] Muxing ${path.basename(audioPath)}...`);
    // As faixas têm intros calmas de 15-30s — um reel de 16s colado ao 0:00
    // ficava monótono. Saltamos para a zona do DROP (~30-45% da faixa, com
    // variação aleatória para o mesmo mp3 não soar sempre igual) e damos
    // punch com loudnorm padrão de streaming + fades curtos.
    let seek = 0;
    try {
      const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
      const durOut = execSync(`"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${pp(audioPath)}"`,
        { timeout: 15000, stdio: 'pipe' }).toString().trim();
      const dur = parseFloat(durOut) || 0;
      if (dur > totalDur + 25) {
        const zona = 0.30 + Math.random() * 0.15;                     // 30-45%
        seek = Math.min(Math.floor(dur * zona), Math.floor(dur - totalDur - 5));
        seek = Math.max(seek, 10);
      }
    } catch (_) { /* sem ffprobe: comportamento antigo (0:00) */ }
    if (seek) console.log(`  [Step 3] Áudio a partir de ${seek}s (zona do drop)`);
    const fadeOutSt = Math.max(totalDur - 1.2, 0).toFixed(1);
    const cmd3 = [
      `"${ffmpeg}"`, '-y',
      `-stream_loop -1 -i "${pp(videoForAudio)}"`,
      seek ? `-ss ${seek}` : '',
      `-stream_loop -1 -i "${pp(audioPath)}"`,
      '-map 0:v:0 -map 1:a:0',
      `-af "loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.6,afade=t=out:st=${fadeOutSt}:d=1.2"`,
      '-c:v copy -c:a aac -b:a 160k',
      `-t ${totalDur}`,
      `"${pp(outputMp4)}"`
    ].join(' ');
    try {
      execSync(cmd3, { timeout: 120000, stdio: 'pipe' });
      console.log(`  [Step 3] Audio OK`);
    } catch (_) {
      console.log('  [Step 3] Audio mux falhou — usando sem áudio');
      fs.copyFileSync(videoForAudio, outputMp4);
    }
  } else {
    fs.copyFileSync(videoForAudio, outputMp4);
  }

  // ── 5. Validar + Upload ────────────────────────────────────────────────────
  const finalSize = fs.statSync(outputMp4).size;
  if (finalSize < 50000) {
    cleanDir(framesDir);
    throw new Error(`MP4 final inválido (${finalSize} bytes)`);
  }

  console.log(`  [Upload] Enviando para Catbox (${(finalSize/1024/1024).toFixed(1)} MB)...`);
  const videoUrl = uploadToHost(outputMp4);
  if (!videoUrl) {
    cleanDir(framesDir);
    throw new Error('Upload do video falhou');
  }
  console.log(`  [Upload] OK: ${videoUrl}`);

  // ── 6. Limpar temporários ──────────────────────────────────────────────────
  cleanDir(framesDir);
  try { fs.unlinkSync(outputMp4); } catch (_) {}

  return videoUrl;
}

// Remove directório de frames após upload
function cleanDir(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} });
      fs.rmdirSync(dir);
    }
  } catch (_) {}
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Post functions ───────────────────────────────────────────────────────────
async function postSingle() {
  console.log('\n=== POST SINGLE ===');
  const dir = getDirectives();
  // Aprendizagem: se os dados mostram que carrossel converte melhor, o slot "single"
  // publica um carrossel em vez de 1 foto (aplica o learning #1: carrosséis > posts únicos).
  // Match tolerante: a AISA pode devolver "carrossel (fones, acessórios...)".
  if (/carrossel|carousel/i.test(dir.formatoPreferido || '')) {
    console.log('[Directiva] formatoPreferido=' + dir.formatoPreferido + ' → single vira carrossel');
    return postCarousel();
  }
  const products = getProducts();
  const selected = pickProducts(products, 'ig', 1);
  if (selected.length === 0) { console.log('Sem produtos disponiveis'); return; }

  const { product, image } = selected[0];
  const cta = getNextCta();
  const ctaIdx = getNextCta.lastIdx;
  const refCode = newSalesRef('auto-single', [product.name]);
  // Corpo criativo: Haiku escreve no ângulo da ideia da Fugu; fallback = template clássico
  const corpoIA = await creativeCaption.aiCaption([product], 'single', dir);
  if (corpoIA) console.log('[Single] caption criativa (ideia Fugu + Haiku)');
  const caption = [
    ...(corpoIA ? [corpoIA] : [`${product.name}`, ...smartCaptionLines(product, dir)]),
    '',
    cta,
    '',
    salesCtaLine(refCode),
    '',
    '#superloja #angola #luanda #compras'
  ].join('\n');

  console.log(`[Single] Produto: ${product.name}`);

  // Estilo 2: edita a foto (faixa com nome + preco) uma vez p/ FB e IG
  const editedUrl = await prepareEditedImage(image, product, findFfmpeg());

  try {
    const r = await postFbPhoto(editedUrl, caption);
    if (r?.id) ledgerRecord({ postId: r.id, platform: 'facebook', source: 'auto-single', format: 'foto', ctaIdx, refCode, hour: new Date().getUTCHours() + 1, products: [product.name] });
  }
  catch (e) { console.log('[FB Error]', e.message); }

  await sleep(3000);

  try {
    const r = await postIgPhoto(editedUrl, caption);
    if (r?.id) ledgerRecord({ postId: r.id, platform: 'instagram', source: 'auto-single', format: 'foto', ctaIdx, refCode, hour: new Date().getUTCHours() + 1, products: [product.name] });
  }
  catch (e) { console.log('[IG Error]', e.message); }
}

async function postStories() {
  console.log('\n=== POST STORIES (reais, IG + FB) ===');
  // STORIES A SÉRIO desde 2026-07-10: IG media_type=STORIES + FB Page /photo_stories.
  // (Antes publicava 3 fotos no FEED — spam que alimentava a supressão do algoritmo.
  //  Stories aparecem no topo da app e desaparecem em 24h — distribuição gratuita.)
  const products = getProducts();
  const selected = pickProducts(products, 'ig', 3);
  if (selected.length === 0) { console.log('Sem produtos disponiveis'); return; }

  const ffmpeg = findFfmpeg();
  for (let i = 0; i < selected.length; i++) {
    const { product, image } = selected[i];
    try {
      console.log(`  [${i+1}/${selected.length}] ${product.name}`);
      const editedUrl = await prepareEditedImage(image, product, ffmpeg); // estilo 2 (nome+preço na imagem)
      const hour = new Date().getUTCHours() + 1;

      // IG Story: container STORIES → publish (sem caption; o texto vai na própria imagem)
      try {
        const c = await apiCall(`${IG_PAGE_ID}/media`, { image_url: editedUrl, media_type: 'STORIES' }, 'POST');
        if (c?.id) {
          await sleep(5000);
          const pub = await apiCall(`${IG_PAGE_ID}/media_publish`, { creation_id: c.id }, 'POST');
          if (pub?.id) {
            console.log(`    [IG Story] Publicado: ${pub.id}`);
            ledgerRecord({ postId: pub.id, platform: 'instagram', source: 'auto-stories', format: 'story', hour, products: [product.name] });
          } else console.log(`    [IG Story] publish erro: ${pub?.error?.message}`);
        } else console.log(`    [IG Story] container erro: ${c?.error?.message}`);
      } catch (e) { console.log('    [IG Story] erro:', e.message); }

      // FB Page Story: foto não-publicada → /photo_stories
      try {
        const up = await apiCall(`${FB_PAGE_ID}/photos`, { url: editedUrl, published: 'false' }, 'POST');
        if (up?.id) {
          const st = await apiCall(`${FB_PAGE_ID}/photo_stories`, { photo_id: up.id }, 'POST');
          if (st?.success || st?.post_id) {
            console.log(`    [FB Story] Publicado: ${st.post_id || 'ok'}`);
            ledgerRecord({ postId: st.post_id || up.id, platform: 'facebook', source: 'auto-stories', format: 'story', hour, products: [product.name] });
          } else console.log(`    [FB Story] erro: ${st?.error?.message}`);
        } else console.log(`    [FB Story] upload erro: ${up?.error?.message}`);
      } catch (e) { console.log('    [FB Story] erro:', e.message); }

    } catch (e) { console.log('    Erro:', e.message); }
    await sleep(2000);
  }
}

async function postCarousel() {
  console.log('\n=== POST CAROUSEL ===');
  const products = getProducts();
  const selected = pickProducts(products, 'ig', 5);
  if (selected.length < 2) { console.log('Produtos insuficientes'); return; }

  const dir = getDirectives();
  const cta = getNextCta();
  const ctaIdx = getNextCta.lastIdx;
  const refCode = newSalesRef('auto-carousel', selected.map(s => s.product.name));
  const capLines = [`Promocoes do dia na Superloja!`];
  if (dir.precoNaCaption !== false) capLines.push(`Desde ${fmtPrice(selected[0].product.price)}`);
  capLines.push('Entrega em Luanda');
  if (dir.incluirPergunta === true) { capLines.push(''); capLines.push(SMART_QUESTIONS[_qIdx++ % SMART_QUESTIONS.length]); }
  // Corpo criativo (ideia Fugu + Haiku); fallback = capLines clássicas
  const corpoIA = await creativeCaption.aiCaption(selected.map(s => s.product), 'carousel', dir);
  if (corpoIA) console.log('[Carousel] caption criativa (ideia Fugu + Haiku)');
  const caption = [
    ...(corpoIA ? [corpoIA] : capLines),
    '',
    cta,
    '',
    salesCtaLine(refCode),
    '',
    '#superloja #angola #luanda #compras'
  ].join('\n');

  // Um template consistente para o carrossel inteiro (varia entre dias)
  const ffmpeg = findFfmpeg();
  const tplCarrossel = postTemplates.nextTemplate();
  console.log(`[Carousel] template do dia: ${tplCarrossel}`);
  const images = [];
  for (const s of selected) {
    if (!s.image) continue;
    const editedUrl = await prepareEditedImage(s.image, s.product, ffmpeg, tplCarrossel);
    images.push(editedUrl);
  }
  if (images.length < 2) { console.log('Imagens insuficientes para carousel'); return; }

  const prodNames = selected.map(s => s.product.name);
  try {
    const r = await postFbCarousel(images, caption);
    if (r?.id) ledgerRecord({ postId: r.id, platform: 'facebook', source: 'auto-carousel', format: 'carrossel', ctaIdx, refCode, hour: new Date().getUTCHours() + 1, products: prodNames });
  }
  catch (e) { console.log('[FB Carousel Error]', e.message); }

  await sleep(3000);

  try {
    const r = await postIgCarousel(images, caption);
    if (r?.id) ledgerRecord({ postId: r.id, platform: 'instagram', source: 'auto-carousel', format: 'carrossel', ctaIdx, refCode, hour: new Date().getUTCHours() + 1, products: prodNames });
  }
  catch (e) { console.log('[IG Carousel Error]', e.message); }
}

async function postReels() {
  console.log('\n=== POST REELS ===');
  const products = getProducts();
  const selected = pickProducts(products, 'ig', 8);
  if (selected.length < 2) { console.log('Produtos insuficientes'); return; }

  // Obter estilo, intro e hashtags rotativos
  const { style, intro, hashtags } = getNextReelConfig();

  // Obter próxima música (sem repetição até esgotar o ciclo)
  const audioPath = nextAudio();

  const cta = getNextCta();
  // Corpo criativo (ideia Fugu + Haiku); fallback = intro clássica
  const corpoReels = await creativeCaption.aiCaption(selected.map(s => s.product), 'reels', getDirectives());
  if (corpoReels) console.log('[Reels] caption criativa (ideia Fugu + Haiku)');
  const caption = [
    ...(corpoReels ? [corpoReels] : [intro, `Produtos a partir de ${fmtPrice(selected[0].product.price)}`, `Entrega rapida em Luanda`]),
    '',
    cta,
    '',
    hashtags,
  ].join('\n');

  console.log(`[Reels] ${selected.length} produtos | estilo: ${style.name}`);

  // Criar slideshow UMA vez — URL reutilizada para FB e IG
  let videoUrl = null;
  try {
    videoUrl = await createReelsSlideshow(selected, audioPath, style);
  } catch (e) {
    console.log('[Reels] Falha ao criar slideshow:', e.message);
    return;
  }

  if (!videoUrl || !videoUrl.startsWith('http')) {
    console.log('[Reels] URL invalida, abortando');
    return;
  }

  // Facebook — /{page_id}/videos com content_category
  console.log('\n[FB Reels] Enviando...');
  try {
    const res = await apiCall(`${FB_PAGE_ID}/videos`, {
      file_url:         videoUrl,
      title:            `Superloja Angola — ${intro}`,
      description:      caption,
      content_category: 'OTHER',        // validado contra lista FB: {BEAUTY_FASHION,...,OTHER} — SHOPPING nao existe em /videos
    }, 'POST');
    if (res?.id) console.log(`[FB Reels] Postado: ${res.id}`);
    else console.log('[FB Reels] Erro:', res?.error?.message);
  } catch (e) { console.log('[FB Reels Error]', e.message); }

  await sleep(3000);

  // Instagram — com polling FINISHED antes de publicar
  console.log('\n[IG Reels] Enviando...');
  try {
    await postIgReel(videoUrl, caption);
  } catch (e) { console.log('[IG Reels Error]', e.message); }
}

// ─── Status / Reset ───────────────────────────────────────────────────────────
function showStatus() {
  const ps    = loadPostState();
  const cta   = loadCtaState();
  const audio = loadAudioState();
  const reel  = loadReelState();

  console.log('\n=== STATUS ===');
  console.log(`CTA posts enviados    : ${cta.count}`);
  // `cta` aqui é o ESTADO (loadCtaState), não um template: cta.ctaType é o
  // contador de rotação. A linha antiga dizia "Urgencia/Stock vs WhatsApp
  // Direct" como se houvesse 2 CTAs — há 10, e o rótulo saía sempre igual.
  const proximo = cta.ctaType % CTA_TEMPLATES.length;
  console.log(`Proximo CTA           : #${proximo} — "${String(CTA_TEMPLATES[proximo]).split('\n')[0].slice(0, 52)}"`);

  for (const plat of ['fb', 'ig']) {
    const p = ps[plat] || { postedIds: [], cycleCount: 0 };
    console.log(`\n--- Produtos ${plat.toUpperCase()} ---`);
    console.log(`  Ciclos completos      : ${p.cycleCount}`);
    console.log(`  Postados neste ciclo  : ${p.postedIds.length}`);
    console.log(`  Ultimos IDs postados  : [${p.postedIds.slice(-5).join(', ')}${p.postedIds.length > 5 ? '...' : ''}]`);
  }

  console.log('\n--- Reels ---');
  console.log(`Reels criados         : ${reel.count}`);
  const nextStyle = REEL_STYLES[reel.styleIdx % REEL_STYLES.length];
  console.log(`Proximo estilo        : ${nextStyle.name} (${nextStyle.w}x${nextStyle.h}, ${nextStyle.spf}s/frame)`);
  console.log(`Proxima intro         : "${REEL_INTROS[reel.introIdx % REEL_INTROS.length]}"`);

  console.log('\n--- Audio ---');
  console.log(`Ultima musica         : ${audio.lastUsed || 'nenhuma'}`);
  console.log(`Fila restante         : [${(audio.queue || []).join(', ') || 'vazia — vai embaralhar'}]`);
}

function resetChecklist() {
  savePostState({ v: 2, fb: { postedIds: [], cycleCount: 0 }, ig: { postedIds: [], cycleCount: 0 } });
  console.log('Post state (rastreamento de produtos por ID) resetado!');
}

function resetAll() {
  resetChecklist();
  saveAudioState({ queue: [], lastUsed: null });
  saveReelState({ styleIdx: 0, introIdx: 0, hashtagIdx: 0, count: 0 });
  saveCtaState({ ctaType: 0, count: 0 });
  console.log('Todos os estados resetados (checklist, audio, reel, cta)!');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || 'single';

switch (cmd) {
  case 'single':     postSingle().catch(e   => console.error('Error:', e.message)); break;
  case 'stories':    postStories().catch(e  => console.error('Error:', e.message)); break;
  case 'carousel':   postCarousel().catch(e => console.error('Error:', e.message)); break;
  case 'reels':      postReels().catch(e    => console.error('Error:', e.message)); break;
  case 'status':     showStatus(); break;
  case 'render-teste': (async () => {
    // Gera UM reel completo (templates + audio no drop) SEM postar — para
    // validar o pipeline visual sem tocar no Facebook/Instagram.
    const prods = getProducts();
    const sel = prods.slice(0, 4).map(p => ({ product: p, image: (p.images && p.images[0]) || p.image }));
    const audio = nextAudio();
    const out = await createReelsSlideshow(sel, audio, { id: 1, name: 'Square Standard', w: 1080, h: 1080, spf: 2.0 });
    console.log('REEL DE TESTE (não postado):', out);
  })().catch(e => console.error('Error:', e.message)); break;
  case 'reset':      resetChecklist(); break;
  case 'reset-all':  resetAll(); break;
  default:
    console.log('Uso: node auto-poster-v4.js [single|stories|carousel|reels|status|reset|reset-all]');
}
