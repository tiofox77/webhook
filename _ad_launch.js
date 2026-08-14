// Lançador do anúncio carrossel Click-to-WhatsApp — cria TUDO em PAUSED (zero gasto).
// Só ativar (passo separado) gasta dinheiro. Segue a receita facebook-ads-messenger-campaign.
const https = require('https'), fs = require('fs'), path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const guard = require('./text-guard.js');

const TOK = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '';
const ACC = 'act_' + (process.env.FB_AD_ACCOUNT || '354926190710586');
const PAGE = '230190170178019';
const PHONE = '244954949595';
const GRAPH = '/v21.0/';
const pkg = JSON.parse(fs.readFileSync('C:/superloja/data/campanhas/campanha-adaptadores-carregadores.json', 'utf8'));

function post(p, body) {
  return new Promise((resolve) => {
    const data = new URLSearchParams({ ...body, access_token: TOK }).toString();
    const req = https.request({ hostname: 'graph.facebook.com', path: GRAPH + p, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d.slice(0, 200) }); } }); });
    req.on('error', e => resolve({ err: e.message })); req.write(data); req.end();
  });
}
const fail = (label, r) => { console.log('❌ ' + label + ': ' + JSON.stringify(r.error || r).slice(0, 260)); process.exit(1); };

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const end = now + 3 * 86400;

  // 1) Upload das 3 imagens → image_hash
  const cards = pkg.anuncio.cards;
  for (const c of cards) {
    const b64 = fs.readFileSync(c.imagem).toString('base64');
    const r = await post(ACC + '/adimages', { bytes: b64 });
    const key = r.images && Object.keys(r.images)[0];
    if (!key) fail('upload img ' + c.productId, r);
    c.hash = r.images[key].hash;
    console.log('🖼  img ' + c.productId + ' → hash ' + c.hash.slice(0, 12) + '…');
  }

  // 2) Campaign (PAUSED) — reutiliza se já existir (evita órfãs em retries)
  const CAMPF = 'C:/superloja/data/campanhas/_camp.json';
  let campId; try { campId = JSON.parse(fs.readFileSync(CAMPF, 'utf8')).id; } catch (_) {}
  if (!campId) {
    const camp = await post(ACC + '/campaigns', {
      name: 'SL Adaptadores&Carregadores — CTWA', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED',
      special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false'
    });
    if (!camp.id) fail('campaign', camp);
    campId = camp.id; fs.writeFileSync(CAMPF, JSON.stringify({ id: campId }));
  }
  console.log('📦 campaign PAUSED ' + campId);

  // 3) AdSet (PAUSED) — $2/dia, termina em 3 dias, Luanda; idade 18-65 (Advantage+ exige max>=65)
  const adset = await post(ACC + '/adsets', {
    name: 'SL Adapt&Carreg AO-Luanda', campaign_id: campId,
    optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', bid_amount: '30',
    daily_budget: '200', end_time: String(end),
    targeting: JSON.stringify({ geo_locations: { regions: [{ key: '4514' }] }, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 1 } }),
    promoted_object: JSON.stringify({ page_id: PAGE }), status: 'PAUSED'
  });
  if (!adset.id) fail('adset', adset);
  console.log('🎯 adset PAUSED ' + adset.id + ' ($2/dia, fim em 3 dias, Luanda 18-44)');

  // 4) Creative carrossel (3 cards, CTA WhatsApp)
  const oss = {
    page_id: PAGE,
    link_data: {
      message: guard.sanitizarAnuncio(pkg.anuncio.texto_principal),
      link: 'https://wa.me/' + PHONE,
      child_attachments: cards.map(c => ({
        link: c.link, image_hash: c.hash, name: c.titulo,
        description: pkg.anuncio.descricao_cards, call_to_action: { type: 'WHATSAPP_MESSAGE' }
      })),
      call_to_action: { type: 'WHATSAPP_MESSAGE' },
      multi_share_end_card: 'false'
    }
  };
  let creative = await post(ACC + '/adcreatives', { name: 'SL Adapt&Carreg carrossel WA', object_story_spec: JSON.stringify(oss) });
  if (!creative.id) {
    console.log('⚠️  creative WHATSAPP_MESSAGE falhou (' + JSON.stringify(creative.error || creative).slice(0, 160) + ') — fallback p/ tráfego wa.me');
    oss.link_data.child_attachments.forEach(a => { a.call_to_action = { type: 'SHOP_NOW' }; });
    oss.link_data.call_to_action = { type: 'SHOP_NOW' };
    creative = await post(ACC + '/adcreatives', { name: 'SL Adapt&Carreg carrossel wa.me', object_story_spec: JSON.stringify(oss) });
    if (!creative.id) fail('creative', creative);
    console.log('🎨 creative (fallback SHOP_NOW→wa.me) ' + creative.id);
  } else {
    console.log('🎨 creative (WHATSAPP_MESSAGE) ' + creative.id);
  }

  // 5) Ad (PAUSED)
  const ad = await post(ACC + '/ads', { name: 'SL Adapt&Carreg carrossel', adset_id: adset.id, creative: JSON.stringify({ creative_id: creative.id }), status: 'PAUSED' });
  if (!ad.id) fail('ad', ad);
  console.log('📢 ad PAUSED ' + ad.id);

  fs.writeFileSync('C:/superloja/data/campanhas/_ids.json', JSON.stringify({ campaign: campId, adset: adset.id, creative: creative.id, ad: ad.id }, null, 2));
  console.log('\n✅ TUDO CRIADO EM PAUSA (0 gasto). ids guardados em data/campanhas/_ids.json');
  console.log('Preview/gestão: https://business.facebook.com/adsmanager/manage/ads?act=354926190710586&selected_campaign_ids=' + campId);
})();
