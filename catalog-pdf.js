/**
 * Catálogo PDF da SuperLoja — vários templates de loja, por categoria ou
 * personalizado. Cada produto: imagem + nome + preço; capa com logo; rodapé
 * com WhatsApp + site em todas as páginas.
 *
 * gerarCatalogo({ template, categoria, filtro, ids, titulo }) -> caminho do PDF.
 * Os TEMPLATES vivem em TEMPLATES{} — funções (doc, produtos, ctx). A
 * infraestrutura (imagens, capa, rodapé, preço) é partilhada.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DATA_DIR   = process.env.DATA_DIR || 'C:\\superloja\\data';
const OUT_DIR    = path.join(DATA_DIR, 'catalogos');
const IMG_CACHE  = path.join(DATA_DIR, 'tmp', 'catalog-img');
const LOGO       = path.join(__dirname, 'assets', 'superlojas-logo.png');
const LOGO_ALT   = path.join(__dirname, 'assets', 'logo-complete-tp.png');
const WHATSAPP   = '+244 954 949 595';
const SITE       = 'superloja.vip';
const A4 = { w: 595.28, h: 841.89 };

// paleta da marca
const C = {
  verde: '#10b981', verdeEsc: '#047857', verde900: '#064e3b',
  laranja: '#f97316', laranjaEsc: '#c2410c', laranja900: '#7c2d12',
  escuro: '#0f172a', escuro2: '#1e293b', claro: '#f8fafc', tintVerde: '#ecfdf5',
  tintLaranja: '#fff7ed', cinza: '#64748b', cinza2: '#94a3b8', ink: '#1e293b', branco: '#ffffff'
};

// ─── preço ──────────────────────────────────────────────────────────────────
function precoKz(p) {
  let s = String(p == null ? '' : p).trim().replace(/[^\d.,]/g, '');
  if (!s) return '';
  s = s.replace(/[.,]\d{2}$/, '');
  const n = parseInt(s.replace(/[.,]/g, ''), 10) || 0;
  return n > 0 ? n.toLocaleString('pt-BR') + ' Kz' : '';
}

// ─── imagens: descarregar para ficheiro local (pdfkit precisa de path/buffer) ──
function baixar(url, dest, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve) => {
    if (redirects > 3) return resolve(false);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'SuperLoja/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return baixar(loc, dest, redirects + 1).then(resolve);
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 8 * 1024 * 1024) { req.destroy(); resolve(false); } chunks.push(c); });
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          // só imagens reais (jpg/png) — pdfkit rebenta com svg/webp/gif
          const ok = (buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50);
          if (!ok || buf.length < 1000) return resolve(false);
          fs.writeFileSync(dest, buf); resolve(true);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(15000, () => { req.destroy(); resolve(false); });
  });
}

async function resolverImagens(produtos) {
  if (!fs.existsSync(IMG_CACHE)) fs.mkdirSync(IMG_CACHE, { recursive: true });
  const crypto = require('crypto');
  const mapa = {};
  for (const p of produtos) {
    let raw = (p.images && p.images[0]) || p.image;
    if (raw && typeof raw !== 'string') raw = raw.url || raw.src || raw.path;
    if (!raw) continue;
    const full = raw.startsWith('http') ? raw : 'https://superloja.vip' + raw;
    const ext = (full.match(/\.(jpe?g|png)(\?|$)/i) || [])[1] || 'jpg';
    const fp = path.join(IMG_CACHE, crypto.createHash('sha1').update(full).digest('hex').slice(0, 16) + '.' + ext.toLowerCase().replace('jpeg', 'jpg'));
    if (!fs.existsSync(fp)) { if (!(await baixar(full, fp))) continue; }
    mapa[p.id != null ? p.id : p.name] = fp;
  }
  return mapa;
}

// ─── infraestrutura de página ─────────────────────────────────────────────────
function logoPath() {
  if (fs.existsSync(LOGO)) return LOGO;
  if (fs.existsSync(LOGO_ALT)) return LOGO_ALT;
  return null;
}

// imagem "cover" dentro de um rect (recorta o excesso), com cantos opcionais
function imgCover(doc, imgPath, x, y, w, h, radius) {
  if (!imgPath) { doc.save().rect(x, y, w, h).fill(C.claro).restore(); return; }
  doc.save();
  if (radius) doc.roundedRect(x, y, w, h, radius).clip(); else doc.rect(x, y, w, h).clip();
  try { doc.image(imgPath, x, y, { cover: [w, h], align: 'center', valign: 'center' }); }
  catch { doc.rect(x, y, w, h).fill(C.claro); }
  doc.restore();
}
// imagem "contain" (mostra tudo, fundo branco)
function imgContain(doc, imgPath, x, y, w, h, bg) {
  doc.save().rect(x, y, w, h).fill(bg || C.branco).restore();
  if (!imgPath) return;
  try { doc.image(imgPath, x + 6, y + 6, { fit: [w - 12, h - 12], align: 'center', valign: 'center' }); } catch {}
}

// preço riscado: desenha o texto e uma linha por cima (pdfkit não tem strike)
function riscado(doc, x, y, texto, size, cor) {
  doc.font('Helvetica').fontSize(size).fillColor(cor).text(texto, x, y);
  const w = doc.widthOfString(texto);
  doc.moveTo(x, y + size * 0.55).lineTo(x + w, y + size * 0.55).lineWidth(1).stroke(cor);
  return w;
}
// scrim de gradiente (para texto ler sobre foto)
function scrim(doc, x, y, w, h, cor, op0, op1, vertical) {
  const g = vertical === false ? doc.linearGradient(x, y, x + w, y) : doc.linearGradient(x, y, x, y + h);
  g.stop(0, cor, op0).stop(1, cor, op1);
  doc.rect(x, y, w, h).fill(g);
}
// badge pill (Novo/Promo)
function badge(doc, x, y, txt, C) {
  if (!txt) return;
  doc.font('Helvetica-Bold').fontSize(9);
  const w = doc.widthOfString(txt) + 16;
  doc.roundedRect(x, y, w, 20, 10).fill(/promo/i.test(txt) ? C.laranja : C.verde);
  doc.fillColor('#ffffff').text(txt.toUpperCase(), x + 8, y + 5.5);
}
const heroDe = (produtos, imgs) => produtos.find(p => imgs[p.id != null ? p.id : p.name]) || produtos[0];

// rodapé em TODAS as páginas — chamado por página (após conteúdo)
function rodape(doc, cor) {
  const y = A4.h - 34;
  doc.save();
  doc.rect(0, y - 6, A4.w, 40).fill(cor || C.verdeEsc);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
    .text('WhatsApp ' + WHATSAPP, 40, y + 3, { continued: false });
  doc.font('Helvetica').fontSize(9).fillColor('#e8fff6')
    .text('Entrega em Luanda • pagas na entrega • ' + SITE, 40, y + 16);
  const pg = doc.page.pageNumber || 1;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
    .text(String(pg), A4.w - 60, y + 8, { width: 24, align: 'right' });
  doc.restore();
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────────
// Cada um: (doc, produtos, ctx{ imgs, titulo, precoKz, C, logo, imgCover, imgContain, rodape })
// controla a sua própria capa, paginação e rodapé.
const TEMPLATES = {};

// Template base funcional (grelha 2x3) — os designados entram depois.
TEMPLATES['grelha'] = function (doc, produtos, ctx) {
  const M = 40, cols = 2, rows = 3, gap = 18;
  const gridW = A4.w - M * 2, cellW = (gridW - gap * (cols - 1)) / cols;
  const topo = 120, fundo = A4.h - 60, cellH = (fundo - topo - gap * (rows - 1)) / rows;

  function capa() {
    doc.rect(0, 0, A4.w, A4.h).fill(C.verde);
    doc.rect(0, A4.h * 0.62, A4.w, A4.h * 0.38).fill(C.verde900);
    if (ctx.logo) { try { doc.image(ctx.logo, A4.w / 2 - 70, 150, { fit: [140, 140], align: 'center' }); } catch {} }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(40).text('CATÁLOGO', 0, 330, { align: 'center', width: A4.w });
    doc.fontSize(20).font('Helvetica').fillColor('#d1fae5').text(ctx.titulo || 'SuperLoja', 0, 385, { align: 'center', width: A4.w });
    doc.fontSize(13).fillColor('#ffffff').text('Entrega rápida em Luanda • pagamento na entrega', 0, A4.h * 0.66, { align: 'center', width: A4.w });
    doc.fontSize(15).font('Helvetica-Bold').fillColor('#ffffff').text('WhatsApp ' + WHATSAPP, 0, A4.h * 0.66 + 30, { align: 'center', width: A4.w });
    doc.fontSize(12).font('Helvetica').fillColor('#a7f3d0').text(SITE, 0, A4.h * 0.66 + 56, { align: 'center', width: A4.w });
  }

  function cabecalho() {
    doc.rect(0, 0, A4.w, 70).fill(C.verdeEsc);
    if (ctx.logo) { try { doc.image(ctx.logo, 30, 16, { fit: [40, 40] }); } catch {} }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('SuperLoja', 80, 22);
    doc.font('Helvetica').fontSize(11).fillColor('#d1fae5').text(ctx.titulo || 'Catálogo', 80, 44);
  }

  function cartao(p, x, y) {
    doc.save();
    doc.roundedRect(x, y, cellW, cellH, 10).fill(C.branco);
    doc.roundedRect(x, y, cellW, cellH, 10).lineWidth(1).stroke('#e2e8f0');
    const imgH = cellH * 0.58;
    ctx.imgContain(doc, ctx.imgs[p.id != null ? p.id : p.name], x + 1, y + 1, cellW - 2, imgH, C.claro);
    if (p.badge) {
      const bw = doc.font('Helvetica-Bold').fontSize(9).widthOfString(p.badge) + 14;
      doc.roundedRect(x + 10, y + 10, bw, 18, 9).fill(/promo/i.test(p.badge) ? C.laranja : C.verde);
      doc.fillColor('#ffffff').text(p.badge, x + 17, y + 14);
    }
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11)
      .text(String(p.name || '').slice(0, 44), x + 12, y + imgH + 10, { width: cellW - 24, height: 30, ellipsis: true });
    const pr = ctx.precoKz(p.price);
    const orig = p.original_price ? ctx.precoKz(p.original_price) : '';
    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.verdeEsc).text(pr, x + 12, y + cellH - 30);
    if (orig && orig !== pr) {
      const pw = doc.widthOfString(pr);
      doc.font('Helvetica').fontSize(10).fillColor(C.cinza2).text(orig, x + 16 + pw, y + cellH - 25);
      doc.moveTo(x + 16 + pw, y + cellH - 20).lineTo(x + 16 + pw + doc.widthOfString(orig), y + cellH - 20).lineWidth(1).stroke(C.cinza2);
    }
    doc.restore();
  }

  capa();
  let i = 0;
  while (i < produtos.length) {
    doc.addPage();
    cabecalho();
    ctx.rodape(doc, C.verdeEsc);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (i >= produtos.length) break;
        cartao(produtos[i++], M + c * (cellW + gap), topo + r * (cellH + gap));
      }
    }
  }
};

// ═══ REVISTA BOUTIQUE (editorial premium) — capa herói + 2 cartões-feature ═══
TEMPLATES['revista'] = function (doc, produtos, ctx) {
  const key = p => p.id != null ? p.id : p.name;
  const hero = heroDe(produtos, ctx.imgs);
  // — capa —
  const hImg = ctx.imgs[key(hero)];
  if (hImg) imgCover(doc, hImg, 0, 0, A4.w, A4.h); else doc.rect(0, 0, A4.w, A4.h).fill(C.verdeEsc);
  scrim(doc, 0, 0, A4.w, 240, C.escuro, 0.55, 0);
  scrim(doc, 0, 540, A4.w, 302, C.verdeEsc, 0, 0.94);
  doc.roundedRect(40, 40, 40, 40, 10).fill(C.laranja);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('SL', 40, 51, { width: 40, align: 'center' });
  doc.fontSize(46).fillColor('#f8fafc').text('SUPERLOJA', 0, 60, { align: 'center', width: A4.w, characterSpacing: 2 });
  doc.font('Helvetica').fontSize(11).fillColor('#e5e7eb').text('CATÁLOGO DE TECNOLOGIA · LUANDA', 0, 116, { align: 'center', width: A4.w, characterSpacing: 3 });
  doc.rect(A4.w / 2 - 45, 138, 90, 2).fill(C.laranja);
  // bloco destaque
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.laranja).text('EM DESTAQUE', 48, 586, { characterSpacing: 1 });
  doc.fontSize(28).fillColor('#ffffff').text(String(hero.name || '').slice(0, 42), 48, 606, { width: A4.w - 96, height: 70, ellipsis: true });
  const prH = ctx.precoKz(hero.price);
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#ffffff').text(prH, 48, 694);
  doc.roundedRect(48, 738, 250, 34, 17).fill(C.laranja);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('ENCOMENDE PELO WHATSAPP', 48, 748, { width: 250, align: 'center' });
  ['Pagamento na entrega', 'Entrega em Luanda', 'WhatsApp ' + WHATSAPP].forEach((t, i) => {
    const x = 48 + i * 170;
    doc.rect(x, 792, 8, 8).fill(C.verde);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(8.5).text(t, x + 12, 791, { width: 158 });
  });

  function cabecalho() {
    doc.rect(0, 0, A4.w, 70).fill(C.verdeEsc);
    if (ctx.logo) { try { doc.image(ctx.logo, 30, 15, { fit: [40, 40] }); } catch {} }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('SuperLoja', 80, 20);
    doc.font('Helvetica').fontSize(11).fillColor('#d1fae5').text(ctx.titulo || 'Catálogo', 80, 43);
    doc.rect(0, 68, A4.w, 2).fill(C.laranja);
  }
  function feature(p, top, imgEsquerda) {
    const x = 48, w = 499, h = 320, r = 16;
    doc.roundedRect(x, top + 6, w, h, r).fillOpacity(0.05).fill(C.escuro).fillOpacity(1);
    doc.roundedRect(x, top, w, h, r).fill('#ffffff');
    doc.roundedRect(x, top, w, h, r).lineWidth(1).stroke('#e5e7eb');
    const imgX = imgEsquerda ? x + 14 : x + w - 224, txtX = imgEsquerda ? x + 248 : x + 30;
    doc.roundedRect(imgX, top + 14, 210, 292, 10).fill('#f1f5f9');
    imgCover(doc, ctx.imgs[key(p)], imgX, top + 14, 210, 292, 10);
    badge(doc, imgX + 12, top + 26, p.badge, C);
    const cat = String((p.category && (p.category.name || p.category)) || 'SUPERLOJA').toUpperCase();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.laranja).text(cat, txtX, top + 30, { width: 229, characterSpacing: 1 });
    doc.fontSize(22).fillColor('#0f172a').text(String(p.name || '').slice(0, 46), txtX, top + 48, { width: 229, height: 56, ellipsis: true });
    if (p.description) doc.font('Helvetica').fontSize(11).fillColor('#475569').text(String(p.description).slice(0, 150), txtX, top + 112, { width: 229, height: 48, ellipsis: true });
    doc.rect(txtX, top + 172, 40, 2).fill(C.laranja);
    let py = top + 200;
    const pr = ctx.precoKz(p.price), orig = p.original_price ? ctx.precoKz(p.original_price) : '';
    if (orig && orig !== pr) { riscado(doc, txtX, py, orig, 13, C.cinza2); py += 20; }
    doc.font('Helvetica-Bold').fontSize(26).fillColor(C.verdeEsc).text(pr, txtX, py);
    doc.rect(txtX, top + 292, 8, 8).fill(C.verde);
    doc.font('Helvetica').fontSize(9.5).fillColor('#64748b').text('Pagamento na entrega', txtX + 12, top + 291);
  }

  let i = 0, par = true;
  while (i < produtos.length) {
    doc.addPage(); cabecalho();
    if (i < produtos.length) feature(produtos[i++], 88, par);   par = !par;
    if (i < produtos.length) feature(produtos[i++], 438, par);  par = !par;
    ctx.rodape(doc, C.verdeEsc);
  }
};

// ═══ LOOKBOOK LIFESTYLE — capa herói + faixas zigzag claro/escuro ═══
TEMPLATES['lookbook'] = function (doc, produtos, ctx) {
  const key = p => p.id != null ? p.id : p.name;
  const hero = heroDe(produtos, ctx.imgs);
  const hImg = ctx.imgs[key(hero)];
  if (hImg) imgCover(doc, hImg, 0, 0, A4.w, A4.h); else doc.rect(0, 0, A4.w, A4.h).fill(C.escuro);
  scrim(doc, 0, 0, A4.w, 180, C.escuro, 0.7, 0);
  scrim(doc, 0, 420, A4.w, 422, C.escuro, 0, 0.92);
  doc.roundedRect(40, 44, 40, 40, 8).fill(C.verde);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('S', 40, 52, { width: 40, align: 'center' });
  doc.fontSize(22).text('SuperLoja', 92, 50);
  doc.font('Helvetica').fontSize(8).fillColor('#ffffff').text('TECNOLOGIA & ACESSÓRIOS', 92, 78, { characterSpacing: 2 });
  doc.rect(44, 636, 84, 4).fill(C.laranja);
  doc.font('Helvetica').fontSize(12).fillColor(C.laranja).text('CATÁLOGO', 44, 648, { characterSpacing: 3 });
  doc.font('Helvetica-Bold').fontSize(52).fillColor('#ffffff').text('Tech &', 44, 666);
  doc.text('Lifestyle', 44, 718);
  doc.font('Helvetica').fontSize(12).fillColor('#cbd5e1').text((ctx.titulo || 'SuperLoja') + ' · Luanda', 44, 792);

  function faixa(p, top, imgEsquerda, escura) {
    const H = 401, imgW = 310, panelW = A4.w - imgW;
    if (escura) doc.rect(0, top, A4.w, H).fill(C.escuro); else doc.rect(0, top, A4.w, H).fill('#f8fafc');
    const imgX = imgEsquerda ? 0 : panelW, panelX = imgEsquerda ? imgW : 0;
    // meia-imagem com tinta de fundo temática
    scrim(doc, imgX, top, imgW, H, escura ? '#0b1220' : C.tintVerde, escura ? 1 : 1, escura ? 0.4 : 0.5, true);
    doc.rect(imgX, top, imgW, H).fillOpacity(escura ? 1 : 1).fill(escura ? '#0b1220' : C.tintVerde); doc.fillOpacity(1);
    const im = ctx.imgs[key(p)];
    if (im) { try { doc.image(im, imgX + 20, top + 30, { fit: [imgW - 40, H - 60], align: 'center', valign: 'center' }); } catch {} }
    const acc = escura ? C.laranja : C.verdeEsc, nomeCor = escura ? '#ffffff' : '#0f172a', muted = escura ? '#94a3b8' : '#64748b';
    badge(doc, imgX + 20, top + 24, p.badge, C);
    const tx = panelX + 30, tw = panelW - 60;
    let ty = top + 80;
    doc.font('Helvetica').fontSize(9).fillColor(acc).text(String((p.category && (p.category.name || p.category)) || 'SUPERLOJA').toUpperCase(), tx, ty, { characterSpacing: 2 }); ty += 18;
    const nome = String(p.name || ''); const nSize = nome.length > 18 ? 20 : 24;
    doc.font('Helvetica-Bold').fontSize(nSize).fillColor(nomeCor).text(nome.slice(0, 44), tx, ty, { width: tw, height: 58, ellipsis: true }); ty += 66;
    if (p.description) { doc.font('Helvetica').fontSize(10.5).fillColor(muted).text(String(p.description).slice(0, 140), tx, ty, { width: tw, height: 46, ellipsis: true }); ty += 54; }
    doc.rect(tx, ty, 40, 2).fill(acc); ty += 16;
    const pr = ctx.precoKz(p.price), orig = p.original_price ? ctx.precoKz(p.original_price) : '';
    if (orig && orig !== pr) { riscado(doc, tx, ty, orig, 12, muted); ty += 18; }
    doc.font('Helvetica-Bold').fontSize(30).fillColor(acc).text(pr, tx, ty); ty += 42;
    ['Pagamento na entrega', 'Entrega em Luanda'].forEach((t, i) => {
      const px = tx + i * 130;
      doc.roundedRect(px, ty, 122, 22, 11).lineWidth(1).stroke(acc);
      doc.font('Helvetica').fontSize(8.5).fillColor(acc).text(t, px, ty + 6.5, { width: 122, align: 'center' });
    });
  }

  let i = 0, z = 0;
  while (i < produtos.length) {
    doc.addPage();
    if (i < produtos.length) { faixa(produtos[i++], 0, z % 2 === 0, z % 2 === 1); z++; }
    if (i < produtos.length) { faixa(produtos[i++], 401, z % 2 === 0, z % 2 === 1); z++; }
    ctx.rodape(doc, C.escuro);
  }
};

// ═══ FEIRA VIBRANTE — 3 colunas densas, selos de preço, energia máxima ═══
TEMPLATES['feira'] = function (doc, produtos, ctx) {
  const key = p => p.id != null ? p.id : p.name;
  // capa: blocos verde/laranja
  doc.rect(0, 0, A4.w, A4.h).fill(C.laranja);
  doc.rect(0, 0, A4.w, A4.h / 2).fill(C.verde);
  doc.polygon([0, A4.h / 2], [A4.w, A4.h / 2 - 60], [A4.w, A4.h / 2 + 60], [0, A4.h / 2 + 120]).fill(C.verdeEsc);
  if (ctx.logo) { try { doc.image(ctx.logo, A4.w / 2 - 60, 120, { fit: [120, 120], align: 'center' }); } catch {} }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(52).text('MEGA', 0, 300, { align: 'center', width: A4.w });
  doc.fontSize(52).text('CATÁLOGO', 0, 356, { align: 'center', width: A4.w });
  doc.roundedRect(A4.w / 2 - 130, 440, 260, 46, 23).fill('#ffffff');
  doc.fillColor(C.laranjaEsc).fontSize(22).text('PREÇOS DE FEIRA', 0, 452, { align: 'center', width: A4.w });
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text('Entrega em Luanda • pagas na entrega', 0, 540, { align: 'center', width: A4.w });
  doc.fontSize(20).text('WhatsApp ' + WHATSAPP, 0, 570, { align: 'center', width: A4.w });

  const M = 24, cols = 3, rows = 4, gap = 12;
  const cw = (A4.w - M * 2 - gap * (cols - 1)) / cols;
  const topo = 96, ch = (A4.h - topo - 60 - gap * (rows - 1)) / rows;
  function cab() {
    doc.rect(0, 0, A4.w, 78).fill(C.laranja);
    doc.rect(0, 0, A4.w / 2, 78).fill(C.verde);
    if (ctx.logo) { try { doc.image(ctx.logo, 24, 18, { fit: [42, 42] }); } catch {} }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('OFERTAS SUPERLOJA', 0, 28, { align: 'center', width: A4.w });
  }
  function card(p, x, y) {
    doc.roundedRect(x, y, cw, ch, 8).fill('#ffffff');
    doc.roundedRect(x, y, cw, ch, 8).lineWidth(2).stroke(C.laranja);
    const imgH = ch * 0.5;
    imgContain(doc, ctx.imgs[key(p)], x + 3, y + 3, cw - 6, imgH, '#ffffff');
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9).text(String(p.name || '').slice(0, 40), x + 6, y + imgH + 6, { width: cw - 12, height: 24, ellipsis: true });
    // selo estrela de preço
    const cx = x + cw - 34, cy = y + ch - 32, R = 30;
    const pts = []; for (let k = 0; k < 20; k++) { const rr = k % 2 ? R : R * 0.72, a = k * Math.PI / 10 - Math.PI / 2; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
    doc.polygon(...pts).fill(C.verde);
    const pr = ctx.precoKz(p.price).replace(' Kz', '');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(pr.length > 5 ? 10 : 13).text(pr, cx - R, cy - 8, { width: R * 2, align: 'center' });
    doc.fontSize(8).text('Kz', cx - R, cy + 6, { width: R * 2, align: 'center' });
  }
  let i = 0;
  while (i < produtos.length) {
    doc.addPage(); cab();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { if (i >= produtos.length) break; card(produtos[i++], M + c * (cw + gap), topo + r * (ch + gap)); }
    ctx.rodape(doc, C.laranjaEsc);
  }
};

// ═══ ATACADO — lista de preços profissional, denso, secção por categoria ═══
TEMPLATES['atacado'] = function (doc, produtos, ctx) {
  const key = p => p.id != null ? p.id : p.name;
  // capa corporativa
  doc.rect(0, 0, A4.w, A4.h).fill(C.verde900);
  doc.rect(0, 300, A4.w, 6).fill(C.laranja);
  if (ctx.logo) { try { doc.image(ctx.logo, A4.w / 2 - 55, 150, { fit: [110, 110], align: 'center' }); } catch {} }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(38).text('LISTA DE PREÇOS', 0, 330, { align: 'center', width: A4.w });
  doc.font('Helvetica').fontSize(16).fillColor('#a7f3d0').text(ctx.titulo || 'SuperLoja Angola', 0, 384, { align: 'center', width: A4.w });
  doc.fontSize(12).fillColor('#ffffff').text('Preços especiais • entrega em Luanda • pagamento na entrega', 0, 460, { align: 'center', width: A4.w });
  doc.font('Helvetica-Bold').fontSize(15).text('Encomendas: WhatsApp ' + WHATSAPP, 0, 500, { align: 'center', width: A4.w });

  const M = 36, topo = 96, rowH = 62, porPag = Math.floor((A4.h - topo - 50) / rowH);
  function cab() {
    doc.rect(0, 0, A4.w, 70).fill(C.verde900);
    if (ctx.logo) { try { doc.image(ctx.logo, 30, 16, { fit: [38, 38] }); } catch {} }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text('SuperLoja — Lista de Preços', 78, 26);
    // cabeçalho de tabela
    doc.rect(M, 76, A4.w - M * 2, 22).fill(C.verdeEsc);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('PRODUTO', M + 74, 82);
    doc.text('PREÇO', A4.w - M - 110, 82, { width: 100, align: 'right' });
  }
  function linha(p, y, zebra) {
    if (zebra) doc.rect(M, y, A4.w - M * 2, rowH).fill(C.tintVerde);
    doc.rect(M, y + rowH - 1, A4.w - M * 2, 1).fill('#d1fae5');
    imgContain(doc, ctx.imgs[key(p)], M + 6, y + 6, 50, rowH - 12, '#ffffff');
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11).text(String(p.name || '').slice(0, 50), M + 68, y + 12, { width: A4.w - M * 2 - 68 - 130, height: 16, ellipsis: true });
    if (p.description) doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(String(p.description).slice(0, 80), M + 68, y + 30, { width: A4.w - M * 2 - 68 - 130, height: 22, ellipsis: true });
    const pr = ctx.precoKz(p.price), orig = p.original_price ? ctx.precoKz(p.original_price) : '';
    let py = y + 16;
    if (orig && orig !== pr) { doc.font('Helvetica').fontSize(9).fillColor(C.cinza2); const ow = doc.widthOfString(orig); doc.text(orig, A4.w - M - 10 - ow, py); doc.moveTo(A4.w - M - 10 - ow, py + 5).lineTo(A4.w - M - 10, py + 5).lineWidth(1).stroke(C.cinza2); py += 16; }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.laranjaEsc).text(pr, A4.w - M - 130, py, { width: 120, align: 'right' });
  }
  let i = 0;
  while (i < produtos.length) {
    doc.addPage(); cab();
    for (let r = 0; r < porPag; r++) { if (i >= produtos.length) break; linha(produtos[i++], topo + r * rowH, r % 2 === 1); }
    ctx.rodape(doc, C.verde900);
  }
};

// ─── seleção de produtos ──────────────────────────────────────────────────────
function filtrar(produtos, opts) {
  // Por defeito SÓ produtos com stock (UX do cliente: não prometer o que não há).
  // O dono pode passar { incluirEsgotados: true } para mostrar tudo (catálogo
  // institucional / "volta amanhã" / gerar desejo).
  let lista = opts.incluirEsgotados
    ? produtos.slice()
    : produtos.filter(p => p.stock == null || Number(p.stock) > 0);
  if (opts.ids && opts.ids.length) {
    const set = new Set(opts.ids.map(String));
    lista = lista.filter(p => set.has(String(p.id)));
  }
  if (opts.categoria) {
    const cat = opts.categoria.toLowerCase();
    lista = lista.filter(p => String((p.category && (p.category.name || p.category)) || '').toLowerCase().includes(cat));
  }
  if (opts.filtro) {
    const f = opts.filtro.toLowerCase();
    lista = lista.filter(p => (String(p.name || '') + ' ' + String(p.description || '')).toLowerCase().includes(f));
  }
  if (opts.max) lista = lista.slice(0, opts.max);
  return lista;
}

// ─── gerar ─────────────────────────────────────────────────────────────────────
async function gerarCatalogo(produtos, opts) {
  opts = opts || {};
  const tplNome = TEMPLATES[opts.template] ? opts.template : 'grelha';
  const lista = filtrar(produtos, opts);
  if (!lista.length) throw new Error('nenhum produto para o catálogo (filtro: ' + (opts.categoria || opts.filtro || 'todos') + ')');

  const imgs = await resolverImagens(lista);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const nomeFich = 'catalogo-' + tplNome + '-' + (opts.slug || 'geral') + '-' + Date.now() + '.pdf';
  const outPath = path.join(OUT_DIR, nomeFich);

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, info: { Title: 'Catálogo SuperLoja', Author: 'SuperLoja' } });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    const ctx = { imgs, titulo: opts.titulo || 'SuperLoja Angola', precoKz, C, logo: logoPath(), imgCover, imgContain, rodape, A4, WHATSAPP, SITE };
    try { TEMPLATES[tplNome](doc, lista, ctx); }
    catch (e) { doc.end(); return reject(e); }
    doc.end();
    stream.on('finish', () => resolve({ path: outPath, produtos: lista.length, template: tplNome, ficheiro: nomeFich }));
    stream.on('error', reject);
  });
}

module.exports = { gerarCatalogo, filtrar, precoKz, TEMPLATES, listarTemplates: () => Object.keys(TEMPLATES), OUT_DIR };
