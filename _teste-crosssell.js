// Verifica que o cross-sell escolhe produtos de famílias que o anúncio NÃO cobre.
require('dotenv').config({ path: 'C:/superloja/webhook-server/.env' });
const https = require('https'), fs = require('fs');

const FAMILIAS = [
  ['audio', /fone|auricul|earbud|\btws\b|headset|ouvido/i],
  ['som', /caixa de som|coluna|speaker|bluetooth speaker/i],
  ['cabo', /\bcabo\b|\bfio\b/i],
  ['carregar', /carregador|adaptador|fonte|tomada/i],
  ['energia', /power ?bank|bateria|pilha/i],
  ['protecao', /capa|pelicula|película|vidro/i],
  ['periferico', /rato|mouse|teclado|pen ?drive|cart[ãa]o|leitor/i],
];
const familiaDe = n => (FAMILIAS.find(([, re]) => re.test(String(n || ''))) || ['outro'])[0];

const H = { 'X-Api-Key': process.env.SUPERLOJA_API_KEY, 'X-Api-Secret': process.env.SUPERLOJA_API_SECRET, Accept: 'application/json' };
https.get({ hostname: 'superloja.vip', path: '/api/store-api/superloja/products?per_page=200&page=1&store=superloja', headers: H }, r => {
  let d = ''; r.on('data', c => d += c);
  r.on('end', () => {
    const lista = JSON.parse(d).data.map(p => ({ name: p.name, price: p.price, stock: p.stock }));
    const db = JSON.parse(fs.readFileSync('C:/superloja/data/campanha-ativa.json', 'utf8'));

    const noAnuncio = new Set(db.produtos.map(p => familiaDe(p.nome)));
    console.log('famílias JÁ no anúncio: ' + [...noAnuncio].join(', '));

    const extras = lista.filter(p => Number(p.stock) > 0 && !noAnuncio.has(familiaDe(p.name)))
      .sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 3);

    console.log('\ncross-sell escolhido (mais baratos de famílias novas):');
    extras.forEach(p => console.log('  - ' + p.name + '  ' + Number(p.price).toLocaleString('pt-BR') + ' Kz  [' + familiaDe(p.name) + ']'));

    const cont = {};
    lista.forEach(p => { const f = familiaDe(p.name); cont[f] = (cont[f] || 0) + 1; });
    console.log('\ncatálogo por família: ' + JSON.stringify(cont));
    const mau = extras.filter(p => noAnuncio.has(familiaDe(p.name)));
    console.log('\n' + (mau.length ? 'FALHA: ' + mau.length + ' sugestão(ões) repetem família do anúncio' : 'OK: nenhuma sugestão repete família do anúncio'));
  });
});
