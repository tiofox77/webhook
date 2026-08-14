// Campanha nova "SL Multi-Produto — CTWA 7d": $2/dia × 7 dias ($14), carrossel
// de 8 produtos, otimização CONVERSATIONS, sem bid cap.
//
// PORQUE ASSIM (dados de 2-Ago, campanha anterior):
//  - $0.29/conversa contra $0.10 do "MEGA OFERTA 8 produtos" → repetir a fórmula
//    multi-produto (CTR 8.39% vs 1.80%)
//  - X83 no primeiro cartão: 4 das 6 vendas do histórico
//  - nada com stock 1 (esgota a meio e queima cliques)
//  - LOWEST_COST_WITHOUT_CAP: o bid cap de $0.30 já estrangulou 2 campanhas
//  - mesmo orçamento da anterior, para o teste do criativo ser limpo
//
// CRIA TUDO EM PAUSED — 0 gasto. Ativar é decisão do dono, passo separado.
const https = require('https'), fs = require('fs'), path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const guard = require('./text-guard.js');

const TOK = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '';
const ACC = 'act_' + (process.env.FB_AD_ACCOUNT || '354926190710586');
const PAGE = '230190170178019';
const PHONE = guard.WHATSAPP_DIGITOS;
const GRAPH = '/v21.0/';
const DIR = 'C:/superloja/data/campanhas';

const cards = JSON.parse(fs.readFileSync(DIR + '/_cards4.json', 'utf8'));
const interesses = JSON.parse(fs.readFileSync(DIR + '/_interesses.json', 'utf8')).filter(i => i.name !== 'Online');
const copy = fs.readFileSync(DIR + '/_copy4.txt', 'utf8');
const campo = (k) => { const m = copy.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')); return m ? m[1].trim() : ''; };
const TEXTO = guard.sanitizarAnuncio(campo('TEXTO'));
const DESC = campo('DESC') || 'Pagamento na entrega';
const titulos = cards.map((_, i) => campo('T' + (i + 1)));

function post(p, body) {
  return new Promise((resolve) => {
    const data = new URLSearchParams({ ...body, access_token: TOK }).toString();
    const req = https.request({ hostname: 'graph.facebook.com', path: GRAPH + p, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d.slice(0, 200) }); } }); });
    req.on('error', e => resolve({ err: e.message })); req.write(data); req.end();
  });
}
const fail = (l, r) => { console.log('❌ ' + l + ': ' + JSON.stringify(r.error || r).slice(0, 300)); process.exit(1); };

(async () => {
  if (!TOK) fail('token', { error: 'FB_PAGE_TOKEN em falta no .env' });
  const fim = new Date(Date.now() + 7 * 86400000).toISOString();

  for (const c of cards) {
    const r = await post(ACC + '/adimages', { bytes: fs.readFileSync(c.imagem).toString('base64') });
    const k = r.images && Object.keys(r.images)[0];
    if (!k) fail('upload ' + c.id, r);
    c.hash = r.images[k].hash;
    console.log('🖼  ' + c.nome.slice(0, 38).padEnd(40) + c.hash.slice(0, 10) + '…');
  }

  const CAMPF = DIR + '/_camp4.json';
  let campId; try { campId = JSON.parse(fs.readFileSync(CAMPF, 'utf8')).id; } catch (_) {}
  if (!campId) {
    const c = await post(ACC + '/campaigns', { name: 'SL Multi-Produto — CTWA 7d', objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED', special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false' });
    if (!c.id) fail('campaign', c);
    campId = c.id; fs.writeFileSync(CAMPF, JSON.stringify({ id: campId }));
  }
  console.log('📦 campanha PAUSED ' + campId);

  const targeting = {
    geo_locations: { regions: [{ key: '4514' }] },     // Luanda
    age_min: 18, age_max: 65,                          // Advantage+ exige max 65
    interests: interesses.map(i => ({ id: i.id, name: i.name })),
    targeting_automation: { advantage_audience: 1 }
  };
  const s = await post(ACC + '/adsets', {
    name: 'SL Multi-Produto — Luanda', campaign_id: campId,
    optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: '200', end_time: fim,
    targeting: JSON.stringify(targeting),
    promoted_object: JSON.stringify({ page_id: PAGE }), status: 'PAUSED'
  });
  if (!s.id) fail('adset', s);
  console.log('🎯 adset PAUSED ' + s.id + ' ($2/dia × 7 dias, ' + interesses.length + ' interesses)');

  // cada cartão abre o WhatsApp com o nome EXACTO do produto pré-escrito: é isso
  // que faz o bot saber logo o que o cliente quer (e não "quero isto")
  const oss = { page_id: PAGE, link_data: {
    message: TEXTO, link: 'https://wa.me/' + PHONE,
    child_attachments: cards.map((c, i) => ({
      link: 'https://wa.me/' + PHONE + '?text=' + encodeURIComponent('Olá! Quero o ' + c.nome),
      image_hash: c.hash, name: (titulos[i] || c.nome).slice(0, 40), description: DESC,
      call_to_action: { type: 'WHATSAPP_MESSAGE' }
    })),
    call_to_action: { type: 'WHATSAPP_MESSAGE' }, multi_share_end_card: 'false'
  } };
  let cr = await post(ACC + '/adcreatives', { name: 'SL Multi-Produto carrossel WA', object_story_spec: JSON.stringify(oss) });
  if (!cr.id) {
    console.log('⚠️  WHATSAPP_MESSAGE recusado (' + JSON.stringify(cr.error || cr).slice(0, 120) + ') — fallback wa.me');
    oss.link_data.child_attachments.forEach(a => { a.call_to_action = { type: 'SHOP_NOW' }; });
    oss.link_data.call_to_action = { type: 'SHOP_NOW' };
    cr = await post(ACC + '/adcreatives', { name: 'SL Multi-Produto carrossel wa.me', object_story_spec: JSON.stringify(oss) });
    if (!cr.id) fail('creative', cr);
  }
  console.log('🎨 creative ' + cr.id);

  const ad = await post(ACC + '/ads', { name: 'SL Multi-Produto carrossel', adset_id: s.id,
    creative: JSON.stringify({ creative_id: cr.id }), status: 'PAUSED' });
  if (!ad.id) fail('ad', ad);
  console.log('📢 anúncio PAUSED ' + ad.id);

  fs.writeFileSync(DIR + '/_ids4.json', JSON.stringify({ campaign: campId, adset: s.id, creative: cr.id, ad: ad.id }, null, 2), 'utf8');
  console.log('\n✅ CRIADA EM PAUSA — 0 gasto. Máximo se ativada: $14 ($2/dia × 7 dias)');
  console.log('Rever: https://business.facebook.com/adsmanager/manage/ads?act=354926190710586&selected_campaign_ids=' + campId);
})();
