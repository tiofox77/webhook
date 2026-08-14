/**
 * Templates server-side para os POSTS AUTOMATICOS (single/reels) — sharp + SVG.
 * Espelham o visual do Carrossel Pro do dashboard (que e canvas de browser e
 * nao corre no node). 6 estilos, rotacao SEM repeticao (fila embaralhada em
 * data/template-state.json, como o audio dos reels) — cada post do dia sai
 * diferente do anterior.
 *
 * renderCard(photoPath, product, outPath[, tplId]) -> tplId usado (ou throw).
 * Quem chama faz fallback para o estilo antigo (ffmpeg) se isto falhar.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const STATE_FILE = path.join(DATA_DIR, 'template-state.json');
const W = 1080, H = 1080;

const TEMPLATES = ['montra-verde', 'montra-laranja', 'loja-verde', 'loja-laranja', 'bilhete', 'polaroid'];

// paletas (iguais ao cpVipPal do dashboard)
const PAL = {
  verde:   { accent: '#10b981', a700: '#047857', a900: '#064e3b', tint: '#d1fae5', tint50: '#ecfdf5', ink: '#06281d', dark: '#04140e', muted: '#5b7a6f', border: '#b6e8d3' },
  laranja: { accent: '#f97316', a700: '#c2410c', a900: '#7c2d12', tint: '#ffedd5', tint50: '#fff7ed', ink: '#431407', dark: '#1a0a02', muted: '#9a7b6a', border: '#fed7aa' }
};

// ─── rotacao sem repeticao ────────────────────────────────────────────────────
function nextTemplate() {
  let st = { queue: [], lastUsed: null };
  try { st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  if (!Array.isArray(st.queue) || !st.queue.length) {
    const q = [...TEMPLATES];
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    if (q.length > 1 && q[0] === st.lastUsed) q.push(q.shift());
    st.queue = q;
  }
  const chosen = st.queue.shift();
  st.lastUsed = chosen;
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), 'utf8'); } catch {}
  return chosen;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function precoKz(p) {
  let s = String(p == null ? '' : p).trim().replace(/[^\d.,]/g, '');
  s = s.replace(/[.,]\d{2}$/, '');
  const n = parseInt(s.replace(/[.,]/g, ''), 10) || 0;
  return n.toLocaleString('pt-BR');
}

// quebra aproximada (Arial bold ~0.56em por char)
function wrap(nome, maxChars, maxLinhas) {
  const palavras = String(nome || '').split(/\s+/);
  const linhas = [];
  let l = '';
  for (const p of palavras) {
    if ((l + ' ' + p).trim().length > maxChars) { if (l) linhas.push(l); l = p; }
    else l = (l + ' ' + p).trim();
    if (linhas.length === maxLinhas) break;
  }
  if (l && linhas.length < maxLinhas) linhas.push(l);
  if (linhas.length === maxLinhas && palavras.join(' ').length > linhas.join(' ').length) {
    linhas[maxLinhas - 1] = linhas[maxLinhas - 1].replace(/.{3}$/, '') + '…';
  }
  return linhas;
}
const tspans = (linhas, x, y, lh) => linhas.map((l, i) => '<tspan x="' + x + '" y="' + (y + i * lh) + '">' + esc(l) + '</tspan>').join('');

async function fotoBuf(photoPath, w, h, radius) {
  const r = radius || 0;
  const img = await sharp(photoPath).resize(w, h, { fit: 'cover', position: 'attention' }).png().toBuffer();
  if (!r) return img;
  const mask = Buffer.from('<svg width="' + w + '" height="' + h + '"><rect width="' + w + '" height="' + h + '" rx="' + r + '" fill="#fff"/></svg>');
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

// foto dentro de cartao branco, opcionalmente inclinado
async function cartaoFoto(photoPath, w, h, pad, radius, rotDeg) {
  const foto = await fotoBuf(photoPath, w - pad * 2, h - pad * 2, Math.max(radius - 8, 8));
  const base = Buffer.from('<svg width="' + w + '" height="' + h + '"><rect width="' + w + '" height="' + h + '" rx="' + radius + '" fill="#ffffff"/></svg>');
  let card = await sharp(base).composite([{ input: foto, left: pad, top: pad }]).png().toBuffer();
  if (rotDeg) card = await sharp(card).rotate(rotDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return card;
}

const picotado = (y, cor) => {
  let s = '';
  for (let x = 24; x < W; x += 52) s += '<circle cx="' + x + '" cy="' + y + '" r="10" fill="' + cor + '"/>';
  return s;
};

// ─── render principal ─────────────────────────────────────────────────────────
async function renderCard(photoPath, product, outPath, tplId) {
  const tpl = tplId || nextTemplate();
  const nome = String(product.name || '').slice(0, 60);
  const preco = precoKz(product.price);
  const P = /laranja/.test(tpl) ? PAL.laranja : PAL.verde;
  const camadas = [];
  let baseSvg, topoSvg;

  if (tpl === 'montra-verde' || tpl === 'montra-laranja') {
    const linhas = wrap(nome, 34, 2);
    baseSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><radialGradient id="bg" cx="35%" cy="30%" r="90%"><stop offset="0%" stop-color="#ffffff"/><stop offset="60%" stop-color="' + P.tint50 + '"/><stop offset="100%" stop-color="' + P.tint + '"/></radialGradient></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/>' +
      Array.from({ length: 22 }, (_, i) => '<line x1="' + (i * 90 - H) + '" y1="0" x2="' + (i * 90) + '" y2="' + H + '" stroke="' + P.a700 + '" stroke-width="10" opacity="0.05"/>').join('') +
      '</svg>';
    camadas.push({ input: await cartaoFoto(photoPath, 640, 560, 14, 24, -2), left: 200, top: 190 });
    const rodY = H - 230;
    topoSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      // selo TOP
      '<g transform="translate(' + (W - 120) + ',118) rotate(-7)">' +
      '<circle r="64" fill="' + P.a700 + '"/>' +
      '<text y="4" font-family="Arial" font-size="30" font-weight="900" fill="#fff" text-anchor="middle">TOP</text>' +
      '<text y="28" font-family="Arial" font-size="14" font-weight="800" fill="#fff" text-anchor="middle">QUALIDADE</text></g>' +
      // fio + etiqueta pendurada
      '<path d="M ' + (W - 214) + ' 585 Q ' + (W - 290) + ' 470 760 240" stroke="' + P.a900 + '" stroke-width="4" fill="none"/>' +
      '<g transform="translate(' + (W - 214) + ',645) rotate(5)">' +
      '<rect x="-150" y="-85" width="300" height="170" rx="20" fill="' + P.accent + '"/>' +
      '<circle cx="-116" cy="0" r="12" fill="#fff"/>' +
      '<text x="26" y="-44" font-family="Arial" font-size="20" font-weight="800" fill="' + P.dark + '" text-anchor="middle">SÓ</text>' +
      '<text x="26" y="16" font-family="Arial" font-size="56" font-weight="900" fill="' + P.dark + '" text-anchor="middle">' + preco + '</text>' +
      '<text x="26" y="52" font-family="Arial" font-size="26" font-weight="900" fill="' + P.dark + '" text-anchor="middle">Kz</text></g>' +
      // rodape picotado
      '<rect y="' + rodY + '" width="' + W + '" height="' + (H - rodY) + '" fill="' + P.a900 + '"/>' + picotado(rodY, P.tint50) +
      '<text font-family="Arial" font-size="42" font-weight="900" fill="#ffffff">' + tspans(linhas, 56, rodY + 72, 50) + '</text>' +
      '<text x="56" y="' + (H - 52) + '" font-family="Arial" font-size="22" font-weight="700" fill="' + P.tint + '">Entrega em Luanda • pagas na entrega • superloja.vip</text>' +
      '<circle cx="' + (W - 140) + '" cy="' + (rodY + (H - rodY) / 2 - 12) + '" r="60" fill="' + P.accent + '"/>' +
      '<text x="' + (W - 140) + '" y="' + (rodY + (H - rodY) / 2 + 6) + '" font-family="Arial" font-size="46" fill="' + P.dark + '" text-anchor="middle">✆</text>' +
      '</svg>';

  } else if (tpl === 'loja-verde' || tpl === 'loja-laranja') {
    const linhas = wrap(nome, 36, 2);
    baseSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="' + P.tint50 + '"/></linearGradient></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/>' +
      '<rect x="' + (W - 320) + '" y="56" width="260" height="42" rx="21" fill="' + P.tint + '" stroke="' + P.border + '" stroke-width="2"/>' +
      '<text x="' + (W - 190) + '" y="84" font-family="Arial" font-size="19" font-weight="800" fill="' + P.a700 + '" text-anchor="middle">Entrega em Luanda</text>' +
      '<text x="54" y="90" font-family="Arial" font-size="34" font-weight="900" fill="' + P.a700 + '">SUPERLOJA</text>' +
      '</svg>';
    camadas.push({ input: await cartaoFoto(photoPath, 730, 560, 12, 28, 0), left: Math.round((W - 730) / 2), top: 150 });
    topoSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<text font-family="Arial" font-size="50" font-weight="900" fill="' + P.ink + '">' + tspans(linhas, 60, 794, 56) + '</text>' +
      '<rect x="60" y="900" width="120" height="42" rx="21" fill="' + P.tint + '" stroke="' + P.border + '"/>' +
      '<text x="120" y="928" font-family="Arial" font-size="20" font-weight="800" fill="' + P.a700 + '" text-anchor="middle">Novo</text>' +
      '<text x="' + (W - 64) + '" y="' + (H - 250) + '" font-family="Arial" font-size="24" font-weight="700" fill="' + P.muted + '" text-anchor="end">só</text>' +
      '<text x="' + (W - 64) + '" y="' + (H - 172) + '" font-family="Arial" font-size="78" font-weight="900" fill="' + P.a700 + '" text-anchor="end">' + preco + ' <tspan font-size="34">Kz</tspan></text>' +
      '<rect x="60" y="' + (H - 142) + '" width="520" height="82" rx="18" fill="' + P.accent + '"/>' +
      '<circle cx="111" cy="' + (H - 101) + '" r="21" fill="' + P.dark + '"/>' +
      '<text x="111" y="' + (H - 92) + '" font-family="Arial" font-size="26" fill="' + P.accent + '" text-anchor="middle">✆</text>' +
      '<text x="148" y="' + (H - 90) + '" font-family="Arial" font-size="30" font-weight="900" fill="' + P.dark + '">Encomenda já no WhatsApp</text>' +
      '</svg>';

  } else if (tpl === 'bilhete') {
    const linhas = wrap(nome, 26, 2);
    const tX = 70, tY = 180, tW = W - 140, tH = H - 400, stub = tX + Math.round(tW * 0.66);
    let barras = '', bx = stub + 40;
    while (bx < tX + tW - 80) { const bw = 2 + ((bx * 7) % 5); barras += '<rect x="' + bx + '" y="' + (tY + tH - 150) + '" width="' + bw + '" height="86" fill="#1c1917"/>'; bx += bw + 3 + ((bx * 3) % 6); }
    baseSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="' + W + '" height="' + H + '" fill="#0b1220"/>' +
      Array.from({ length: 90 }, (_, i) => '<circle cx="' + ((i * 97) % W) + '" cy="' + ((i * 211) % H) + '" r="2.2" fill="#fff" opacity="0.08"/>').join('') +
      '<rect x="' + tX + '" y="' + tY + '" width="' + tW + '" height="' + tH + '" rx="26" fill="#fffdf8"/>' +
      '<circle cx="' + tX + '" cy="' + (tY + tH / 2) + '" r="26" fill="#0b1220"/>' +
      '<circle cx="' + (tX + tW) + '" cy="' + (tY + tH / 2) + '" r="26" fill="#0b1220"/>' +
      '</svg>';
    camadas.push({ input: await fotoBuf(photoPath, stub - tX - 88, tH - 240, 18), left: tX + 44, top: tY + 64 });
    topoSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<g transform="translate(' + (tX + 92) + ',' + (tY + 60) + ') rotate(-45)"><rect x="-160" y="-26" width="320" height="52" fill="#f97316"/>' +
      '<text y="9" font-family="Arial" font-size="26" font-weight="900" fill="#fff" text-anchor="middle">OFERTA</text></g>' +
      '<line x1="' + stub + '" y1="' + (tY + 30) + '" x2="' + stub + '" y2="' + (tY + tH - 30) + '" stroke="#b9b2a4" stroke-width="3" stroke-dasharray="14 12"/>' +
      '<text font-family="Arial" font-size="32" font-weight="900" fill="#1c1917">' + tspans(linhas, tX + 44, tY + tH - 120, 40) + '</text>' +
      '<text x="' + (stub + 130) + '" y="' + (tY + 80) + '" font-family="Arial" font-size="22" font-weight="800" fill="#78716c" text-anchor="middle">SUPERLOJA</text>' +
      '<text x="' + (stub + 130) + '" y="' + (tY + 165) + '" font-family="Arial" font-size="58" font-weight="900" fill="#c2410c" text-anchor="middle">' + preco + '</text>' +
      '<text x="' + (stub + 130) + '" y="' + (tY + 205) + '" font-family="Arial" font-size="30" font-weight="900" fill="#c2410c" text-anchor="middle">Kz</text>' +
      '<rect x="' + (stub + 45) + '" y="' + (tY + 240) + '" width="170" height="46" rx="23" fill="#10b981"/>' +
      '<text x="' + (stub + 130) + '" y="' + (tY + 271) + '" font-family="Arial" font-size="21" font-weight="800" fill="#04140e" text-anchor="middle">VÁLIDO HOJE</text>' +
      barras +
      '<text x="' + (stub + 130) + '" y="' + (tY + tH - 34) + '" font-family="Arial" font-size="18" font-weight="700" fill="#78716c" text-anchor="middle">superloja.vip</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 120) + '" font-family="Arial" font-size="30" font-weight="800" fill="#e2e8f0" text-anchor="middle">Encomenda no WhatsApp • +244 954 949 595</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 72) + '" font-family="Arial" font-size="22" font-weight="700" fill="#10b981" text-anchor="middle">Entrega rápida em Luanda — pagas quando recebes</text>' +
      '</svg>';

  } else { // polaroid
    const linhas = wrap(nome, 22, 2);
    baseSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0d1117"/><stop offset="100%" stop-color="#141b12"/></linearGradient>' +
      '<radialGradient id="g1"><stop offset="0%" stop-color="rgba(16,185,129,0.22)"/><stop offset="100%" stop-color="rgba(16,185,129,0)"/></radialGradient>' +
      '<radialGradient id="g2"><stop offset="0%" stop-color="rgba(249,115,22,0.20)"/><stop offset="100%" stop-color="rgba(249,115,22,0)"/></radialGradient></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/>' +
      '<circle cx="' + (W * 0.18) + '" cy="' + (H * 0.22) + '" r="340" fill="url(#g1)"/>' +
      '<circle cx="' + (W * 0.85) + '" cy="' + (H * 0.75) + '" r="380" fill="url(#g2)"/>' +
      '<text x="54" y="90" font-family="Arial" font-size="34" font-weight="900" fill="#e7e5e4">SUPERLOJA</text>' +
      '</svg>';
    // polaroid: foto + moldura branca com legenda, inclinada como um todo
    const pW = 620, pH = 760;
    const foto = await fotoBuf(photoPath, pW - 64, pH - 200, 0);
    const polSvg =
      '<svg width="' + pW + '" height="' + pH + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="' + pW + '" height="' + pH + '" fill="#fafaf7"/>' +
      '<text font-family="Comic Sans MS, Segoe Print, cursive" font-size="32" font-style="italic" fill="#292524" text-anchor="middle">' +
      tspans(linhas, Math.round(pW / 2) - 60, pH - 108, 40) + '</text></svg>';
    let pol = await sharp(Buffer.from(polSvg)).png().composite([{ input: foto, left: 32, top: 32 }]).toBuffer();
    pol = await sharp(pol).rotate(3, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    camadas.push({ input: pol, left: Math.round(W / 2 - pW / 2 - 20), top: Math.round(H * 0.47 - pH / 2 - 20) });
    const bx2 = Math.round(W / 2 + pW / 2 - 60), by2 = Math.round(H * 0.47 + pH / 2 - 80);
    let burst = '';
    for (let i = 0; i < 28; i++) { const r = i % 2 ? 120 : 100, a = i * Math.PI / 14; burst += (i ? 'L' : 'M') + Math.round(Math.cos(a) * r) + ' ' + Math.round(Math.sin(a) * r) + ' '; }
    topoSvg =
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<g transform="translate(' + Math.round(W / 2 - pW / 2 + 30) + ',' + Math.round(H * 0.47 - pH / 2 - 6) + ') rotate(-28)"><rect x="-90" y="-26" width="180" height="52" fill="#e8dcae" opacity="0.85"/></g>' +
      '<g transform="translate(' + Math.round(W / 2 + pW / 2 - 40) + ',' + Math.round(H * 0.47 - pH / 2 + 14) + ') rotate(32)"><rect x="-90" y="-26" width="180" height="52" fill="#e8dcae" opacity="0.85"/></g>' +
      '<g transform="translate(' + bx2 + ',' + by2 + ') rotate(-8)">' +
      '<path d="' + burst + 'Z" fill="#f97316" stroke="#10b981" stroke-width="6"/>' +
      '<text y="-34" font-family="Arial" font-size="20" font-weight="800" fill="#1a0a02" text-anchor="middle">APENAS</text>' +
      '<text y="10" font-family="Arial" font-size="44" font-weight="900" fill="#1a0a02" text-anchor="middle">' + preco + '</text>' +
      '<text y="42" font-family="Arial" font-size="24" font-weight="900" fill="#1a0a02" text-anchor="middle">Kz</text></g>' +
      '<text x="' + (W / 2) + '" y="' + (H - 96) + '" font-family="Arial" font-size="30" font-weight="800" fill="#e7e5e4" text-anchor="middle">WhatsApp +244 954 949 595</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 52) + '" font-family="Arial" font-size="22" font-weight="700" fill="#86efac" text-anchor="middle">Entrega em Luanda • superloja.vip</text>' +
      '</svg>';
  }

  const base = await sharp(Buffer.from(baseSvg)).png().toBuffer();
  await sharp(base)
    .composite([...camadas, { input: Buffer.from(topoSvg), left: 0, top: 0 }])
    .jpeg({ quality: 92 })
    .toFile(outPath);
  return tpl;
}

module.exports = { renderCard, nextTemplate, TEMPLATES };
