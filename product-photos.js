/**
 * Fotos de produtos - resolucao em cadeia:
 *   1) BD de fotos REAIS enviadas pelo admin  (data/fotos-reais/ + index.json)
 *   2) foto do catalogo (ja tratada por quem chama)
 *   3) pesquisa na INTERNET com validacao — 3 motores:
 *      Bing scraping (oportunista; serve casca de ads a IPs marcados),
 *      Openverse API (estavel, sem chave, CC/flickr) e
 *      Wikimedia Commons API (estavel; thumb 800px).
 *      Traducao pt->en + recuo progressivo + relevancia >=2 termos + bytes magicos.
 * Se nada servir: null — quem chama responde com honestidade, sem foto.
 * (DDG i.js: 403 fixo desde 2026-07 — abandonado.)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const FOTOS_DIR = path.join(DATA_DIR, 'fotos-reais');
const INDEX_FILE = path.join(FOTOS_DIR, 'index.json');
const NET_CACHE = path.join(DATA_DIR, 'tmp', 'net-photos');

function slug(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return {}; }
}
function saveIndex(idx) {
  if (!fs.existsSync(FOTOS_DIR)) fs.mkdirSync(FOTOS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), 'utf8');
}

// ─── 1) BD do admin ───────────────────────────────────────────────────────────
function getRealPhoto(nomeProduto) {
  const idx = loadIndex();
  const alvo = slug(nomeProduto);
  if (!alvo) return null;
  // match exacto por slug, depois por inclusao (nomes de catalogo sao longos)
  let hit = idx[alvo];
  if (!hit) {
    const k = Object.keys(idx).find(s => alvo.includes(s) || s.includes(alvo));
    if (k) hit = idx[k];
  }
  if (hit && fs.existsSync(path.join(FOTOS_DIR, hit.ficheiro))) {
    return path.join(FOTOS_DIR, hit.ficheiro);
  }
  return null;
}

function addPhoto(nomeProduto, buffer, ext, origem) {
  const s = slug(nomeProduto);
  if (!s) throw new Error('nome de produto vazio');
  if (!buffer || buffer.length < 5000) throw new Error('imagem demasiado pequena (<5KB)');
  if (buffer.length > 10 * 1024 * 1024) throw new Error('imagem >10MB');
  if (!fs.existsSync(FOTOS_DIR)) fs.mkdirSync(FOTOS_DIR, { recursive: true });
  const ficheiro = s + '.' + (ext || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
  fs.writeFileSync(path.join(FOTOS_DIR, ficheiro), buffer);
  const idx = loadIndex();
  idx[s] = { produto: nomeProduto, ficheiro, origem: origem || 'admin', addedAt: new Date().toISOString() };
  saveIndex(idx);
  return { slug: s, ficheiro };
}

function listPhotos() {
  const idx = loadIndex();
  return Object.entries(idx).map(([s, v]) => ({ slug: s, ...v,
    existe: fs.existsSync(path.join(FOTOS_DIR, v.ficheiro)) }));
}

// ─── helpers http ─────────────────────────────────────────────────────────────
function fetchRaw(url, extraHeaders, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error('demasiados redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'en-US,en;q=0.9'
      }, extraHeaders || {})
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const loc = res.headers.location.startsWith('http') ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchRaw(loc, extraHeaders, redirects + 1).then(resolve, reject);
      }
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 8 * 1024 * 1024) { req.destroy(); reject(new Error('>8MB')); } chunks.push(c); });
      res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// assinaturas magicas: só aceitar ficheiros que SAO mesmo imagens
function tipoImagem(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E) return 'png';
  if (buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// ─── 3) pesquisa na internet (DDG Images) ─────────────────────────────────────
async function searchInternetPhoto(nomeProduto) {
  const q = String(nomeProduto || '').trim();
  if (!q) return null;

  // cache: mesma pesquisa nao vai 2x a internet
  if (!fs.existsSync(NET_CACHE)) fs.mkdirSync(NET_CACHE, { recursive: true });
  const cacheKey = crypto.createHash('sha1').update(q.toLowerCase()).digest('hex').slice(0, 16);
  for (const ext of ['jpg', 'png', 'webp']) {
    const p = path.join(NET_CACHE, cacheKey + '.' + ext);
    if (fs.existsSync(p)) return { filePath: p, origem: 'internet(cache)', url: null };
  }

  // Bing Images (o DDG i.js passou a dar 403 fixo — 2026-07-17). O layout do
  // Bing VARIA entre pedidos: umas vezes vem cheio de resultados, outras so
  // publicidade — dai o retry com acumulacao. O JSON vem HTML-escapado em
  // atributos m="{...}"; murl+titulo tem de sair do MESMO objecto {...}
  // (regex solta pela pagina dava templos tailandeses para "fones X83").
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const STOP = new Set(['de', 'da', 'do', 'com', 'para', 'sem', 'the', 'and', 'por']);
  const tokens = norm(q).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t));

  // pt -> en: o Openverse (e a web em geral) responde muito melhor em ingles.
  // Codigos de modelo (x83...) passam intactos.
  const MAPA = [
    [/caixa\s+de\s+som|coluna/g, 'bluetooth speaker'], [/fones?\s*(de\s*ouvido)?|auriculares/g, 'wireless earbuds'],
    [/capa/g, 'phone case'], [/carregador/g, 'charger'], [/cabo/g, 'usb cable'],
    [/relogio|smartwatch/g, 'smartwatch'], [/teclado/g, 'keyboard'], [/rato|mouse/g, 'computer mouse'],
    [/telemovel|celular/g, 'smartphone'], [/ventosa/g, 'suction mount'], [/leitor\s+de\s+cartao/g, 'card reader'],
    [/portatil/g, 'portable'], [/sem\s+fio/g, 'wireless'], [/bluetooth/g, 'bluetooth']
  ];
  let qEn = norm(q);
  for (const [re2, en] of MAPA) qEn = qEn.replace(re2, en);
  qEn = qEn.split(/\s+/).filter((v, i, a) => v && a.indexOf(v) === i).join(' ');
  const tokensEn = qEn.split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t));

  const vistos = new Set();
  const results = [];

  // 1) Bing (oportunista: quando o layout vem bom e otimo; muitas vezes vem casca)
  try {
    const page = await fetchRaw('https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&form=HDRSC2');
    if (page.code === 200) {
      const html = page.body.toString('utf8')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
      const re = /\{[^{}]*?"murl":"([^"]+)"[^{}]*?\}/g;
      let mm;
      while ((mm = re.exec(html))) {
        try {
          const u = JSON.parse('"' + mm[1] + '"');
          if (!/^https?:\/\//.test(u) || vistos.has(u)) continue;
          vistos.add(u);
          const t = JSON.parse('"' + ((mm[0].match(/"t":"([^"]*)"/) || [])[1] || '') + '"');
          // RELEVANCIA implacavel: o Bing mete publicidade no meio (Epic Games,
          // relogios russos...) — foto ERRADA ao cliente e pior que nenhuma.
          const tn = norm(t);
          const acertos = tokens.filter(k => tn.includes(k)).length;
          const minimo = tokens.length >= 3 ? 2 : 1;
          if (acertos >= minimo) results.push({ image: u, title: t, acertos: acertos + 10 }); // bing relevante ganha prioridade
        } catch {}
      }
    }
  } catch { /* bing em baixo: segue para o openverse */ }

  // 2) Openverse (API estavel, sem chave, CC — fotos reais de flickr/wikimedia).
  // A pesquisa e AND de todos os termos: "portable" ou um codigo "x83" matam
  // tudo. Recuo progressivo: query completa -> sem codigos de modelo -> nucleo.
  const nucleo = (qEn.match(/bluetooth speaker|wireless earbuds|phone case|usb cable|smartwatch|keyboard|computer mouse|smartphone|charger|card reader|power bank|tablet/) || [])[0];
  const tentativas = [...new Set([
    qEn,
    tokensEn.filter(t => !/\d/.test(t)).join(' '),
    nucleo
  ].filter(Boolean))];
  for (const tq of tentativas) {
    if (results.some(r => r.acertos < 10)) break;   // openverse ja rendeu
    try {
      const ov = await fetchRaw('https://api.openverse.org/v1/images/?q=' + encodeURIComponent(tq) +
        '&page_size=8&license_type=all', { Accept: 'application/json' });
      if (ov.code !== 200) continue;
      const j = JSON.parse(ov.body.toString('utf8'));
      for (const r of (j.results || [])) {
        if (!r.url || vistos.has(r.url)) continue;
        vistos.add(r.url);
        const tn = norm(r.title || '');
        const acertos = tokensEn.filter(k => tn.includes(k)).length;
        const minimo = tokensEn.length >= 3 ? 2 : 1;
        if (acertos >= minimo) results.push({ image: r.url, title: r.title || '', acertos });
      }
    } catch { /* proxima tentativa */ }
  }

  // 3) Wikimedia Commons (API aberta, estavel; fotos reais tipo JBL/UE Boom).
  // Thumb de 800px: tamanho ideal p/ WhatsApp sem descarregar originais de 20MB.
  if (results.filter(r => r.acertos < 10).length < 2) {
    for (const tq of tentativas) {
      try {
        const cm = await fetchRaw('https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
          encodeURIComponent(tq) + '&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json',
          { 'User-Agent': 'SuperLoja/1.0' });
        if (cm.code !== 200) continue;
        const pages = Object.values(((JSON.parse(cm.body.toString('utf8')).query || {}).pages) || {});
        let novos = 0;
        for (const p of pages) {
          const ii = (p.imageinfo || [])[0] || {};
          const u = ii.thumburl || ii.url;
          const t = String(p.title || '').replace(/^File:/, '');
          if (!u || vistos.has(u)) continue;
          vistos.add(u);
          const tn = norm(t);
          const acertos = tokensEn.filter(k => tn.includes(k)).length;
          const minimo = tokensEn.length >= 3 ? 2 : 1;
          if (acertos >= minimo) { results.push({ image: u, title: t, acertos }); novos++; }
        }
        if (novos >= 2) break;
      } catch { /* proxima tentativa */ }
    }
  }

  if (!results.length) return null;
  results.sort((a, b) => b.acertos - a.acertos);   // mais relevante primeiro

  // tentar os primeiros candidatos ate um validar como imagem real
  for (const r of results.slice(0, 6)) {
    if (!r.image) continue;
    try {
      const img = await fetchRaw(r.image);
      if (img.code !== 200) continue;
      const tipo = tipoImagem(img.body);
      if (!tipo || img.body.length < 15000) continue;   // <15KB = icone/thumbnail, nao serve
      const p = path.join(NET_CACHE, cacheKey + '.' + tipo);
      fs.writeFileSync(p, img.body);
      return { filePath: p, origem: 'internet', url: r.image, titulo: r.title || '' };
    } catch { /* proximo candidato */ }
  }
  return null;
}

// ─── resolucao completa (para o chatbot) ──────────────────────────────────────
// catalogUrl: a foto do catalogo se existir (quem chama ja a tem)
// devolve {tipo:'ficheiro'|'url', valor, origem} ou null
async function resolvePhoto(nomeProduto, catalogUrl) {
  const real = getRealPhoto(nomeProduto);
  if (real) return { tipo: 'ficheiro', valor: real, origem: 'admin' };
  if (catalogUrl) return { tipo: 'url', valor: catalogUrl, origem: 'catalogo' };
  try {
    const net = await searchInternetPhoto(nomeProduto);
    if (net) return { tipo: 'ficheiro', valor: net.filePath, origem: net.origem };
  } catch (e) { /* internet falhou: cai no null */ }
  return null;
}

module.exports = { getRealPhoto, addPhoto, listPhotos, searchInternetPhoto, resolvePhoto, slug, FOTOS_DIR };
