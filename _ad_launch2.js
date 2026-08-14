// Campanha "Fones & Cabos" — 7 dias, $2/dia, interesses reais, carrossel CTWA.
// Cria TUDO em PAUSED (0 gasto). Ativar é passo separado.
const https = require('https'), fs = require('fs'), path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const guard = require('./text-guard.js');

const TOK = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '';
const ACC = 'act_' + (process.env.FB_AD_ACCOUNT || '354926190710586');
const PAGE = '230190170178019';
const PHONE = guard.WHATSAPP_DIGITOS;
const GRAPH = '/v21.0/';
const DIR = 'C:/superloja/data/campanhas';

const cards = JSON.parse(fs.readFileSync(DIR + '/_cards2.json', 'utf8'));
const interesses = JSON.parse(fs.readFileSync(DIR + '/_interesses.json', 'utf8'))
  .filter(i => i.name !== 'Online');                     // "Online" é genérico demais
const copy = fs.readFileSync(DIR + '/_copy2.txt', 'utf8');
const campo = (k) => { const m = copy.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')); return m ? m[1].trim() : ''; };
const TEXTO = guard.sanitizarAnuncio(campo('TEXTO'));    // guarda + contacto oficial visível/clicável
const DESC = campo('DESC') || 'Pagamento na entrega';
const titulos = [1, 2, 3, 4, 5, 6].map(n => campo('T' + n));

function post(p, body) {
  return new Promise((resolve) => {
    const data = new URLSearchParams({ ...body, access_token: TOK }).toString();
    const req = https.request({ hostname: 'graph.facebook.com', path: GRAPH + p, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d.slice(0, 200) }); } }); });
    req.on('error', e => resolve({ err: e.message })); req.write(data); req.end();
  });
}
const fail = (l, r) => { console.log('❌ ' + l + ': ' + JSON.stringify(r.error || r).slice(0, 280)); process.exit(1); };

(async () => {
  const fim = new Date(Date.now() + 7 * 86400000).toISOString();

  // 1) imagens → hashes
  for (const c of cards) {
    const r = await post(ACC + '/adimages', { bytes: fs.readFileSync(c.imagem).toString('base64') });
    const k = r.images && Object.keys(r.images)[0];
    if (!k) fail('upload ' + c.id, r);
    c.hash = r.images[k].hash;
    console.log('🖼  ' + c.id + ' → ' + c.hash.slice(0, 10) + '…');
  }

  // 2) campanha
  const CAMPF = DIR + '/_camp2.json';
  let campId; try { campId = JSON.parse(fs.readFileSync(CAMPF, 'utf8')).id; } catch (_) {}
  if (!campId) {
    const c = await post(ACC + '/campaigns', { name: 'SL Fones & Cabos — CTWA 7d', objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED', special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false' });
    if (!c.id) fail('campaign', c);
    campId = c.id; fs.writeFileSync(CAMPF, JSON.stringify({ id: campId }));
  }
  console.log('📦 campanha PAUSED ' + campId);

  // 3) adset: $2/dia, 7 dias, Luanda, interesses reais
  const targeting = {
    geo_locations: { regions: [{ key: '4514' }] },        // Luanda Province
    age_min: 18, age_max: 65,                            // Advantage+ exige max 65
    interests: interesses.map(i => ({ id: i.id, name: i.name })),
    targeting_automation: { advantage_audience: 1 }
  };
  const s = await post(ACC + '/adsets', {
    name: 'SL Fones&Cabos — interesses Luanda', campaign_id: campId,
    // SEM bid cap: com LOWEST_COST_WITH_BID_CAP $0.30 a entrega ficou estrangulada
    // (gastou $0.06 em 48h = 1% do ritmo, só 219 impressões). Automático é o certo.
    optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: '200', end_time: fim,
    targeting: JSON.stringify(targeting),
    promoted_object: JSON.stringify({ page_id: PAGE }), status: 'PAUSED'
  });
  if (!s.id) fail('adset', s);
  console.log('🎯 adset PAUSED ' + s.id + ' ($2/dia, 7 dias, ' + interesses.length + ' interesses)');

  // 4) creative carrossel (6 cards) com CTA WhatsApp
  const oss = { page_id: PAGE, link_data: {
    message: TEXTO, link: 'https://wa.me/' + PHONE,
    child_attachments: cards.map((c, i) => ({
      link: 'https://wa.me/' + PHONE + '?text=' + encodeURIComponent('Olá! Quero o ' + c.nome),
      image_hash: c.hash, name: (titulos[i] || c.nome).slice(0, 40), description: DESC,
      call_to_action: { type: 'WHATSAPP_MESSAGE' }
    })),
    call_to_action: { type: 'WHATSAPP_MESSAGE' }, multi_share_end_card: 'false'
  } };
  let cr = await post(ACC + '/adcreatives', { name: 'SL Fones&Cabos carrossel WA', object_story_spec: JSON.stringify(oss) });
  if (!cr.id) {
    console.log('⚠️  WHATSAPP_MESSAGE recusado (' + JSON.stringify(cr.error || cr).slice(0, 120) + ') — fallback tráfego wa.me');
    oss.link_data.child_attachments.forEach(a => { a.call_to_action = { type: 'SHOP_NOW' }; });
    oss.link_data.call_to_action = { type: 'SHOP_NOW' };
    cr = await post(ACC + '/adcreatives', { name: 'SL Fones&Cabos carrossel wa.me', object_story_spec: JSON.stringify(oss) });
    if (!cr.id) fail('creative', cr);
  }
  console.log('🎨 creative ' + cr.id);

  // 5) anúncio
  const ad = await post(ACC + '/ads', { name: 'SL Fones&Cabos carrossel', adset_id: s.id,
    creative: JSON.stringify({ creative_id: cr.id }), status: 'PAUSED' });
  if (!ad.id) fail('ad', ad);
  console.log('📢 anúncio PAUSED ' + ad.id);

  fs.writeFileSync(DIR + '/_ids2.json', JSON.stringify({ campaign: campId, adset: s.id, creative: cr.id, ad: ad.id }, null, 2));
  console.log('\n✅ CRIADA EM PAUSA (0 gasto). Orçamento máx: $14 (2/dia × 7 dias)');
  console.log('Meta: https://business.facebook.com/adsmanager/manage/ads?act=354926190710586&selected_campaign_ids=' + campId);
})();
