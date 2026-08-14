#!/usr/bin/env node
/**
 * sync-campanha-ativa.js — diz ao BOT o que está a ser anunciado agora.
 *
 * Porquê: os clientes que clicam no anúncio chegam ao WhatsApp com a mensagem
 * padrão do Meta ("Olá! Posso saber mais informações sobre isto?"). O bot não
 * tinha ideia do que era "isto" e respondia "não consigo ver a publicação" —
 * 7 clientes do anúncio levaram essa resposta em 29-Jul. Agora o bot sabe.
 *
 * Lê os anúncios ACTIVE da conta Meta, extrai os produtos dos carrosséis,
 * cruza com o catálogo e escreve data/campanha-ativa.json (o bot injeta no prompt).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const TOK = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '';
const ACC = String(process.env.FB_AD_ACCOUNT || process.env.META_AD_ACCOUNT || '354926190710586').replace(/^act_/, '');
const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const OUT = path.join(DATA_DIR, 'campanha-ativa.json');

function g(p) {
  return new Promise((resolve) => {
    https.get('https://graph.facebook.com/v21.0/' + p + (p.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(TOK),
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } }); })
      .on('error', () => resolve({}));
  });
}
function catalogo() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'products-cache.json'), 'utf8'));
    return (c.products || c.data || c || []).filter(p => p.stock == null || Number(p.stock) > 0);
  } catch { return []; }
}
(async () => {
  if (!TOK) { console.log('sem token — nada a sincronizar'); process.exit(0); }
  const ads = (await g('act_' + ACC + '/ads?fields=name,effective_status,adset{end_time},creative{object_story_spec,effective_object_story_id}&limit=50')).data || [];
  // `effective_status === 'ACTIVE'` NÃO significa que o anúncio está a entregar.
  // A Meta mantém o objecto do anúncio ACTIVE mesmo depois de o CONJUNTO ter
  // chegado ao fim — e aí não entrega nada. Medido a 12-Ago: os 9 anúncios
  // "ACTIVE" tinham todos o conjunto terminado, quatro deles desde 2024, e a
  // conta não gasta um cêntimo desde 09-Ago. Mesmo assim este ficheiro dizia
  // "9 activos" e o bot injectava "ESTÁ NO AR UM ANÚNCIO NOSSO" no prompt, com
  // ordem para assumir que um "isto" vago vinha do anúncio. Três dias a dizer
  // aos clientes que havia campanha quando não havia.
  // (O dashboard já fazia isto certo — lifecycleStatus() em dashboard.js:7879.)
  const agora = Date.now();
  const acabou = (a) => {
    const fim = a.adset && a.adset.end_time ? Date.parse(a.adset.end_time) : NaN;
    return Number.isFinite(fim) && fim < agora;
  };
  const ativos = ads.filter(a => a.effective_status === 'ACTIVE' && !acabou(a));
  const terminados = ads.filter(a => a.effective_status === 'ACTIVE' && acabou(a)).length;
  if (terminados) console.log('[campanha] ' + terminados + ' anúncio(s) dizem ACTIVE mas o conjunto já acabou — ignorados');
  const cat = catalogo();
  const encontrados = new Map();
  for (const ad of ativos) {
    const ld = ((ad.creative || {}).object_story_spec || {}).link_data || {};
    const kids = ld.child_attachments || [];
    for (const k of kids) {
      const titulo = String(k.name || '');
      // 1) FONTE FIÁVEL: o link do card leva "?text=Olá! Quero o <nome exacto>".
      //    (Casar pelo preço do título dava produtos errados — vários custam 9.500 Kz.)
      let nomeLink = '';
      try {
        const m = String(k.link || '').match(/[?&]text=([^&]+)/);
        if (m) nomeLink = decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/^.*?quero o\s*/i, '').trim();
      } catch {}
      let p = null;
      if (nomeLink) {
        const alvo = nomeLink.toLowerCase();
        p = cat.find(x => String(x.name).toLowerCase() === alvo)
         || cat.find(x => String(x.name).toLowerCase().includes(alvo) || alvo.includes(String(x.name).toLowerCase()));
      }
      // 2) fallback: preço do título + palavras em comum (menos fiável)
      if (!p) {
        const precoTxt = (titulo.match(/([\d.]+)\s*Kz/i) || [])[1];
        const preco = precoTxt ? Number(precoTxt.replace(/\./g, '')) : null;
        const palavras = titulo.toLowerCase().replace(/[\d.,]|kz|—|-/g, ' ').split(/\s+/).filter(w => w.length > 3);
        const candidatos = preco ? cat.filter(x => Math.abs(Number(x.price) - preco) < 1) : cat;
        p = candidatos.find(x => palavras.some(w => String(x.name).toLowerCase().includes(w))) || candidatos[0] || null;
      }
      if (p && !encontrados.has(String(p.id))) {
        encontrados.set(String(p.id), { id: p.id, nome: p.name, preco: Number(p.price), tituloAnuncio: titulo });
      }
    }
  }
  // ── POSTS IMPULSIONADOS (13-Ago) ────────────────────────────────────────────
  // Os anúncios vencedores da conta ("MEGA OFERTA", "Descubra") não são
  // carrosséis com links — são POSTS antigos promovidos (object_story_id), e o
  // extractor acima só sabe ler child_attachments. Reactivados a 13-Ago, o sync
  // dizia "2 anúncios ACTIVE, 0 produtos" e o bot ficava sem bloco de campanha.
  // Aqui: buscar a MENSAGEM do post e casar os nomes com o CATÁLOGO VIVO.
  // ⚠️ Lei 1: os preços do texto do post são de 2024 — usa-se SEMPRE o preço de
  // hoje do catálogo, e as divergências ficam no log para o dono saber.
  let textoStory = '';
  const normP = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const ad of ativos) {
    const sid = (ad.creative || {}).effective_object_story_id;
    if (!sid) continue;
    let post = null;
    try { post = await g(sid + '?fields=message'); } catch {}
    const msg = String((post && post.message) || '');
    if (!msg) continue;
    if (!textoStory) textoStory = msg.slice(0, 220);
    const msgNorm = normP(msg);
    for (const p of cat) {
      if (encontrados.has(String(p.id))) continue;
      const n = normP(p.name);
      if (n.length < 8 || !msgNorm.includes(n)) continue;
      encontrados.set(String(p.id), { id: p.id, nome: p.name, preco: Number(p.price), tituloAnuncio: 'post: ' + String(ad.name || '').slice(0, 40) });
      // o post promete um preço antigo? avisar — o cliente vê o post e o bot
      // diz o preço de hoje; se divergirem, o dono deve saber antes do cliente.
      const perto = msg.slice(Math.max(0, msg.toLowerCase().indexOf(p.name.toLowerCase().slice(0, 12))), 400);
      const precoPost = (perto.match(/([\d]{1,3}(?:\.\d{3})+|\d{4,6})[,.]?\d*\s*Kz/i) || [])[1];
      if (precoPost) {
        const nPost = Number(String(precoPost).replace(/\./g, ''));
        if (Number.isFinite(nPost) && Math.abs(nPost - Number(p.price)) >= 1) {
          console.log('[campanha] ⚠️ preço divergente: "' + p.name + '" — post diz ' + nPost + ' Kz, catálogo diz ' + Number(p.price) + ' Kz (o bot usa o do catálogo)');
        }
      }
    }
  }

  const db = {
    atualizadoEm: new Date().toISOString(),
    anunciosAtivos: ativos.length,
    textoAnuncio: (() => {
      const a = ativos[0];
      const ld = a ? ((a.creative || {}).object_story_spec || {}).link_data || {} : {};
      return String(ld.message || '').slice(0, 220) || textoStory;
    })(),
    produtos: [...encontrados.values()]
  };
  fs.writeFileSync(OUT, JSON.stringify(db, null, 2), 'utf8');
  console.log('campanha-ativa.json: ' + db.produtos.length + ' produto(s) de ' + ativos.length + ' anúncio(s) ACTIVE');
  db.produtos.forEach(p => console.log('  • ' + p.nome + ' — ' + p.preco.toLocaleString('pt-BR') + ' Kz  (card: "' + p.tituloAnuncio + '")'));
})();
