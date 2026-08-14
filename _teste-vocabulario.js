// Testa se a regra de vocabulário resolve o caso real do Hélio ("tipo brinco").
// Usa o catálogo REAL e as MESMAS linhas de regra que o bot mete no prompt.
require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https'), fs = require('fs');

const REGRAS_NOVAS = [
  'COMO O CLIENTE FALA (não é o nome do catálogo):',
  '- "brinco"/"brincos"/"aqueles tipo brinco" = EARBUDS/fones sem fio pequenos (TWS). Mostra os fones sem fio com preço.',
  '- ANTES de dizeres que não temos algo, traduz a palavra do cliente para o OBJECTO FÍSICO e procura esse objecto no catálogo.',
  '  Só depois de não haver nada do mesmo tipo é que dizes que não temos. Um cliente que ouve "não temos" vai-se embora.',
  '- Se o cliente usar uma palavra que não reconheces, pergunta "é para os ouvidos / para carregar / para o telefone?" — não presumas que é outro produto.',
].join('\n');

const REGRA_PRECO = [
  'PREÇOS — REGRA DURA: NUNCA dês preço a uma CATEGORIA. Diz SEMPRE o NOME COMPLETO do produto ao lado do preço,',
  'exactamente como está no catálogo. Se o cliente pedir uma categoria, lista 2-3 opções com nome completo e preço de cada.',
].join('\n');

function catalogo() {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'superloja.vip',
      path: '/api/store-api/superloja/products?per_page=200&page=1&store=superloja',
      headers: { 'X-Api-Key': process.env.SUPERLOJA_API_KEY, 'X-Api-Secret': process.env.SUPERLOJA_API_SECRET, Accept: 'application/json' }
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d).data); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

function ia(system, user) {
  return new Promise((resolve, reject) => {
    const cfg = JSON.parse(fs.readFileSync('C:/superloja/data/ai-config.json', 'utf8'));
    const body = Buffer.from(JSON.stringify({
      model: cfg.model || 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    }), 'utf8');
    const r = https.request({
      hostname: 'api.aisa.one', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + cfg.apiKey, 'Content-Length': body.length }
    }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => {
        const cru = Buffer.concat(ch).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode + ' ' + cru.slice(0, 120)));
        try { const j = JSON.parse(cru); resolve(j.choices[0].message.content); } catch (e) { reject(e); }
      });
    });
    r.on('error', reject); r.setTimeout(60000, () => r.destroy(new Error('timeout')));
    r.write(body); r.end();
  });
}

(async () => {
  const prods = (await catalogo()).filter(p => p.stock == null || Number(p.stock) > 0);
  const catText = prods.map(p => {
    const d = String(p.description || '').replace(/\s+/g, ' ').trim();
    const n = parseInt(String(p.price || '').replace(/[^\d]/g, '').replace(/\d{2}$/, ''), 10) || 0;
    return '- ' + p.name + ': ' + n.toLocaleString('pt-BR') + ' Kz' + (d ? ' — ' + d.slice(0, 110) : '');
  }).join('\n');

  const base = 'És o atendimento da SuperLoja (eletrónica, Luanda). Português de Angola, tu, 2-4 linhas, sem markdown.\n\n' +
    REGRA_PRECO + '\n\n' + REGRAS_NOVAS + '\n\nCATÁLOGO ACTUAL (usa SÓ estes):\n' + catText;

  const semRegra = 'És o atendimento da SuperLoja (eletrónica, Luanda). Português de Angola, tu, 2-4 linhas, sem markdown.\n\n' +
    REGRA_PRECO + '\n\nCATÁLOGO ACTUAL (usa SÓ estes):\n' + catText;

  const casos = ['Quero aqueles tipo brinco.', 'tens brincos?', 'quero um pen drive'];
  console.log('catálogo: ' + prods.length + ' produtos com stock\n');
  for (const c of casos) {
    console.log('═══ CLIENTE: "' + c + '"');
    try { console.log('SEM a regra nova:\n  ' + (await ia(semRegra, c)).replace(/\n/g, '\n  ')); } catch (e) { console.log('  erro: ' + e.message); }
    try { console.log('COM a regra nova:\n  ' + (await ia(base, c)).replace(/\n/g, '\n  ')); } catch (e) { console.log('  erro: ' + e.message); }
    console.log('');
  }
})();
