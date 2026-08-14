#!/usr/bin/env node
'use strict';

// Prepara uma campanha Meta de fones + carregadores com dados reais do catálogo.
// Por segurança, o modo padrão só cria ficheiros locais. A criação na Meta será
// feita numa etapa separada, depois de o dono confirmar orçamento e duração.

const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const guard = require('./text-guard.js');

const DATA_DIR = process.env.DATA_DIR || 'C:/superloja/data';
const OUT_DIR = path.join(DATA_DIR, 'campanhas', 'fones-carregadores-massiva');
const CACHE_FILE = path.join(__dirname, 'products-cache.json');
const STORE_ORIGIN = 'https://superloja.vip';
const PRODUCT_IDS = [39, 36, 91, 87, 82, 58, 72, 93];
const VERIFIED_LOCAL_SOURCES = {
  39: 'src4-39.jpg', 36: 'src4-36.jpg', 91: 'src4-91.jpg', 82: 'src4-82.jpg',
  58: 'src4-58.jpg', 72: 'foto-72.jpeg', 93: 'src4-93.jpg'
};

function escXml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SuperLoja-Campaign-Builder/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return download(new URL(res.headers.location, url).toString(), dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' em ' + url)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(dest); });
    }).on('error', reject);
  });
}

function loadProducts() {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const all = Array.isArray(raw) ? raw : (raw.data || raw.products || []);
  return PRODUCT_IDS.map(id => all.find(p => Number(p.id) === id)).filter(Boolean).filter(p => Number(p.stock || 0) >= 2);
}

function shortName(p) {
  const names = {
    39: 'Fones X83', 36: 'Fones Pro6 TWS', 91: 'Fones Bluetooth Lenovo',
    87: 'Fones Hyundai HY-T05', 82: 'Carregador USB-C',
    58: 'Cabo Tipo C para USB', 72: 'Cabo adaptador 2 em 1', 93: 'Cabo Micro USB 1,2 m'
  };
  return names[p.id] || p.name;
}

async function renderCard(product, index) {
  const imagePath = path.join(OUT_DIR, 'src-' + product.id + '.img');
  const rel = Array.isArray(product.images) ? product.images[0] : product.image;
  if (!rel) throw new Error('Produto sem imagem: ' + product.name);
  const url = /^https?:/.test(rel) ? rel : STORE_ORIGIN + rel;
  if (!fs.existsSync(imagePath)) {
    const verified = VERIFIED_LOCAL_SOURCES[product.id] && path.join(DATA_DIR, 'campanhas', VERIFIED_LOCAL_SOURCES[product.id]);
    if (verified && fs.existsSync(verified)) fs.copyFileSync(verified, imagePath);
    else await download(url, imagePath);
  }

  const name = shortName(product);
  const price = Math.round(Number(product.price)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' Kz';
  const accent = index < 4 ? '#f97316' : '#10b981';
  const overlay = Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="45%" stop-color="#07111f" stop-opacity="0"/><stop offset="100%" stop-color="#07111f" stop-opacity="0.96"/></linearGradient></defs>
    <rect width="1080" height="1080" fill="url(#g)"/>
    <rect x="48" y="45" rx="22" width="245" height="62" fill="${accent}"/>
    <text x="170" y="87" text-anchor="middle" font-family="Arial" font-weight="700" font-size="31" fill="white">SUPERLOJA.VIP</text>
    <text x="55" y="830" font-family="Arial" font-weight="800" font-size="52" fill="white">${escXml(name)}</text>
    <text x="55" y="910" font-family="Arial" font-weight="900" font-size="68" fill="${accent}">${escXml(price)}</text>
    <text x="55" y="980" font-family="Arial" font-weight="600" font-size="31" fill="white">Pagas na entrega  •  WhatsApp</text>
    <circle cx="1010" cy="70" r="38" fill="${accent}"/><text x="1010" y="82" text-anchor="middle" font-family="Arial" font-weight="900" font-size="35" fill="white">${index + 1}</text>
  </svg>`);
  const output = path.join(OUT_DIR, 'card-' + String(index + 1).padStart(2, '0') + '-' + product.id + '.png');
  await sharp(imagePath).rotate().resize(1080, 1080, { fit: 'contain', background: '#f8fafc' })
    .composite([{ input: overlay }]).png({ quality: 95 }).toFile(output);
  return { id: product.id, nome: product.name, titulo: name + ' — ' + price, preco: Number(product.price), stock: Number(product.stock), imagem: output };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const products = loadProducts();
  if (products.length !== PRODUCT_IDS.length) throw new Error('Algum produto escolhido está ausente ou com stock inferior a 2.');
  const cards = [];
  for (let i = 0; i < products.length; i++) cards.push(await renderCard(products[i], i));

  const caption = guard.sanitizarTexto(
    'Em Luanda, há duas certezas: o telefone fica sem carga e os fones desaparecem quando mais precisas. 😅\n\n' +
    'Escolhemos 8 opções em stock: fones Bluetooth, TWS e carregadores para o teu dia não parar. Vê os preços nos cartões, escolhe o número e fala connosco.\n\n' +
    'Pagas quando recebes e tens 1 dia para verificar o produto. Qual número queres reservar?'
  );
  const plan = {
    version: 1,
    createdAt: new Date().toISOString(),
    state: 'LOCAL_DRAFT',
    name: 'SL Venda Massiva — Fones + Carregadores',
    platforms: ['facebook', 'instagram'],
    destination: 'whatsapp',
    objective: 'OUTCOME_TRAFFIC',
    optimizationGoal: 'CONVERSATIONS',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    geography: 'Luanda',
    age: '18-65',
    audience: 'Advantage+ com sinais de fones, Bluetooth, acessórios móveis, eletrónica e compras online',
    format: 'carousel',
    caption,
    firstMessage: 'Olá! Quero o produto número {CARD_NUMBER}: {PRODUCT_NAME}',
    products: cards,
    money: { dailyBudgetUsd: null, days: null, maximumUsd: null, requiresOwnerConfirmation: true },
    safety: ['criar inicialmente em PAUSED', 'preços vêm do catálogo', 'stock mínimo de 2', 'ativação exige confirmação separada']
  };
  fs.writeFileSync(path.join(OUT_DIR, 'campaign-plan.json'), JSON.stringify(plan, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'caption.txt'), caption + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, output: OUT_DIR, cards: cards.length, state: plan.state, products: cards.map(c => ({ id: c.id, nome: c.nome, preco: c.preco, stock: c.stock })) }, null, 2));
}

main().catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
