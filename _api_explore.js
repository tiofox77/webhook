// Explora a API da SuperLoja: que campos traz hoje e que endpoints existem.
const https = require('https'), path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const KEY = process.env.SUPERLOJA_API_KEY || '';
const SEC = process.env.SUPERLOJA_API_SECRET || '';
const BASE = '/api/store-api/superloja';

function get(rota) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'superloja.vip', path: rota, method: 'GET',
      headers: { 'X-Api-Key': KEY, 'X-Api-Secret': SEC, Accept: 'application/json' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (e) {}
        resolve({ status: res.statusCode, json: j, cru: d.slice(0, 160) });
      });
    });
    req.on('error', e => resolve({ status: 0, erro: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, erro: 'timeout' }); });
    req.end();
  });
}
(async () => {
  console.log('=== 1. CAMPOS que a API traz por produto (o que já temos) ===');
  const p = await get(BASE + '/products?per_page=3&page=1&store=superloja');
  const arr = (p.json && (p.json.data || p.json.products)) || [];
  if (arr[0]) {
    Object.entries(arr[0]).forEach(([k, v]) => {
      const t = Array.isArray(v) ? 'array(' + v.length + ')' : typeof v;
      const amostra = t === 'object' && v ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60);
      console.log('  ' + k.padEnd(22) + t.padEnd(12) + amostra);
    });
    console.log('\n  meta da resposta:', JSON.stringify(Object.keys(p.json || {})));
    if (p.json.meta || p.json.total) console.log('  paginação:', JSON.stringify(p.json.meta || { total: p.json.total }).slice(0, 120));
  } else {
    console.log('  status ' + p.status + ' | ' + (p.cru || p.erro));
  }

  console.log('\n=== 2. QUE OUTROS ENDPOINTS existem? (tentativas) ===');
  const tentativas = [
    ['categorias', BASE + '/categories?store=superloja'],
    ['pedidos/vendas', BASE + '/orders?store=superloja'],
    ['stock', BASE + '/stock?store=superloja'],
    ['clientes', BASE + '/customers?store=superloja'],
    ['mais vendidos', BASE + '/products?store=superloja&sort=best_selling&per_page=5'],
    ['procurados/busca', BASE + '/search?q=fone&store=superloja'],
    ['loja/info', BASE + '?store=superloja'],
    ['analytics/visitas', BASE + '/analytics?store=superloja'],
    ['reviews', BASE + '/reviews?store=superloja'],
  ];
  for (const [nome, rota] of tentativas) {
    const r = await get(rota);
    const ok = r.status >= 200 && r.status < 300;
    let resumo = '';
    if (ok && r.json) {
      const chaves = Object.keys(r.json);
      const d = r.json.data || r.json;
      resumo = 'chaves: ' + chaves.slice(0, 5).join(',') + (Array.isArray(d) ? ' | ' + d.length + ' itens' : '');
    } else {
      resumo = r.erro || String(r.cru || '').replace(/\s+/g, ' ').slice(0, 90);
    }
    console.log('  ' + (ok ? '✅' : '❌') + ' ' + nome.padEnd(18) + '[' + r.status + '] ' + resumo);
  }
})();
