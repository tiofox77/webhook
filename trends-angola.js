#!/usr/bin/env node
/**
 * Google Trends Angola (geo=AO) - o que os angolanos pesquisam (90 dias).
 *
 * API nao-oficial do Trends (a mesma que o site usa):
 *   1) o 1o pedido leva 429 MAS devolve o cookie NID — repete-se com ele;
 *   2) /api/explore da tokens por widget; /api/widgetdata/multiline da a serie;
 *   3) respostas vem com prefixo )]}' a remover.
 * Cada lote de 5 termos e normalizado ao seu proprio maximo (100), por isso
 * lotes diferentes NAO sao comparaveis directamente — usa-se um termo-ANCORA
 * ("iphone") presente em todos os lotes e escala-se tudo pela ancora.
 * Falha graciosa: mantem o ficheiro anterior e sai com codigo 0 (o sourcing
 * continua com as outras fontes).
 */

const https = require('https');
const fs = require('fs');

const OUT = 'C:/superloja/data/analytics/trends-angola.json';
const ANCORA = 'iphone';

// termos como os angolanos escrevem; 4 por lote + ancora = 5 (limite do Trends)
const LOTES = [
  ['fones bluetooth', 'power bank', 'smartwatch', 'capa de telemovel'],
  ['coluna bluetooth', 'teclado', 'mouse', 'carregador'],
  ['pen drive', 'disco externo', 'router wifi', 'tablet'],
];

function get(url, cookie) {
  return new Promise((res, rej) => {
    const r = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'pt-PT,pt;q=0.9',
        Cookie: cookie || ''
      }
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => res({ code: resp.statusCode, body: d, cookies: resp.headers['set-cookie'] || [] }));
    });
    r.on('error', rej);
    r.setTimeout(20000, () => { r.destroy(); rej(new Error('timeout')); });
  });
}

const espera = ms => new Promise(r => setTimeout(r, ms));
const semPrefixo = s => JSON.parse(s.replace(/^\)\]\}',?/, '').trim());

// O Trends da 429 com facilidade. Recuo exponencial: 10s, 30s, 60s.
async function getRetry(url, cookie) {
  for (let i = 0; i < 4; i++) {
    const r = await get(url, cookie);
    if (r.code !== 429) return r;
    if (i < 3) await espera([10000, 30000, 60000][i]);
  }
  throw new Error('HTTP 429 persistente (rate-limit do Google)');
}

async function lote(termos, nid) {
  const req = encodeURIComponent(JSON.stringify({
    comparisonItem: termos.map(k => ({ keyword: k, geo: 'AO', time: 'today 3-m' })),
    category: 0, property: ''
  }));
  const ex = await getRetry('https://trends.google.com/trends/api/explore?hl=pt&tz=-60&req=' + req, nid);
  if (ex.code !== 200) throw new Error('explore HTTP ' + ex.code);
  const widgets = semPrefixo(ex.body).widgets || [];
  const ts = widgets.find(w => w.id === 'TIMESERIES');
  if (!ts) throw new Error('sem widget TIMESERIES');
  await espera(4000);
  const ml = await getRetry('https://trends.google.com/trends/api/widgetdata/multiline?hl=pt&tz=-60&req=' +
    encodeURIComponent(JSON.stringify(ts.request)) + '&token=' + ts.token, nid);
  if (ml.code !== 200) throw new Error('multiline HTTP ' + ml.code);
  const pts = (semPrefixo(ml.body).default || {}).timelineData || [];
  if (!pts.length) throw new Error('serie vazia');
  return termos.map((t, i) => ({
    termo: t,
    media: pts.reduce((a, p) => a + (p.value[i] || 0), 0) / pts.length
  }));
}

async function main() {
  // cookie via o truque do 429
  const first = await get('https://trends.google.com/trends/explore?geo=AO&hl=pt');
  const nid = (first.cookies.find(c => c.startsWith('NID')) || '').split(';')[0];
  if (!nid) throw new Error('sem cookie NID (Google mudou o comportamento?)');

  const resultados = {};
  for (const grupo of LOTES) {
    const termos = [ANCORA, ...grupo];
    const r = await lote(termos, nid);
    const ancoraMedia = r.find(x => x.termo === ANCORA).media;
    if (ancoraMedia <= 0) throw new Error('ancora "' + ANCORA + '" sem volume — normalizacao impossivel');
    // escala: ancora = 100 em todos os lotes → lotes comparaveis entre si
    for (const x of r) {
      if (x.termo === ANCORA) continue;
      resultados[x.termo] = Math.round(x.media / ancoraMedia * 1000) / 10;
    }
    await espera(8000);  // gentileza com o rate-limit
  }

  const ranking = Object.entries(resultados)
    .map(([termo, indice]) => ({ termo, indice }))
    .sort((a, b) => b.indice - a.indice);

  const rep = {
    generatedAt: new Date().toISOString(),
    geo: 'AO', periodo: '90 dias', ancora: ANCORA + ' = 100',
    ranking,
    nota: 'Indice relativo ao volume de pesquisa de "' + ANCORA + '" em Angola (Google Trends, nao-oficial).'
  };
  fs.writeFileSync(OUT, JSON.stringify(rep, null, 2), 'utf8');
  console.log('ok: ' + ranking.length + ' termos | top: ' +
    ranking.slice(0, 3).map(r => r.termo + ' ' + r.indice).join(', '));
}

main().catch(e => {
  // nao apagar o ficheiro anterior: o sourcing usa o ultimo bom
  console.error('trends-angola FALHOU: ' + e.message);
  process.exit(1);
});
