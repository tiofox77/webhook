// Ativa a campanha (campaign→adset→ad = ACTIVE). Este é o passo que faz gastar.
const https = require('https'), fs = require('fs'), path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const TOK = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '';
const ids = JSON.parse(fs.readFileSync('C:/superloja/data/campanhas/_ids.json', 'utf8'));

function post(id, body) {
  return new Promise((resolve) => {
    const data = new URLSearchParams({ ...body, access_token: TOK }).toString();
    const req = https.request({ hostname: 'graph.facebook.com', path: '/v21.0/' + id, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d.slice(0, 200) }); } }); });
    req.on('error', e => resolve({ err: e.message })); req.write(data); req.end();
  });
}
function get(id) {
  return new Promise((resolve) => {
    https.get('https://graph.facebook.com/v21.0/' + id + '?fields=effective_status&access_token=' + encodeURIComponent(TOK),
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } }); });
  });
}

(async () => {
  for (const [label, id] of [['campanha', ids.campaign], ['conjunto', ids.adset], ['anúncio', ids.ad]]) {
    const r = await post(id, { status: 'ACTIVE' });
    console.log((r.success || r.id ? '✅' : '❌') + ' ' + label + ' → ACTIVE ' + (r.success || r.id ? '' : JSON.stringify(r.error || r).slice(0, 200)));
    if (!(r.success || r.id)) { console.log('PAREI — nível ' + label + ' não ativou (nada abaixo foi ativado).'); process.exit(1); }
  }
  console.log('\n--- estado final (Meta pode pôr em revisão antes de entregar) ---');
  for (const [label, id] of [['campanha', ids.campaign], ['conjunto', ids.adset], ['anúncio', ids.ad]]) {
    const s = await get(id);
    console.log('  ' + label + ': ' + (s.effective_status || '?'));
  }
})();
