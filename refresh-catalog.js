#!/usr/bin/env node
/**
 * Verificacao diaria do catalogo (00h WAT, chamado pelo superloja-analytics.sh).
 * - Puxa o catalogo REAL da API e refresca products-cache.json (o fallback do
 *   auto-poster nunca comeca o dia velho — chegou a ter 45 dias).
 * - Conta esgotados e valida que ha produtos suficientes para postar.
 * Silencio no sucesso; stdout so quando o dono precisa de saber (API morta,
 * catalogo vazio) — o cron entrega ao WhatsApp.
 */

require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https');
const fs = require('fs');

function fetchCatalog() {
  return new Promise((resolve, reject) => {
    // per_page=200: com 90 e 86 produtos estávamos a 4 produtos de a cache
    // começar a sair truncada em silêncio (o aviso abaixo apanha o próximo limite)
    const req = https.get('https://superloja.vip/api/store-api/superloja/products?per_page=200&page=1&store=superloja', {
      headers: {
        'X-Api-Key': process.env.SUPERLOJA_API_KEY || '',
        'X-Api-Secret': process.env.SUPERLOJA_API_SECRET || '',
        Accept: 'application/json'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const lista = j.data || j.products || [];
          // se o total da API for maior que o que veio, a cache está incompleta:
          // dizer alto, porque em silêncio isto vira "esse produto não existe"
          const total = Number(j.total || 0);
          if (total && lista.length < total)
            console.log('⚠️ CATÁLOGO TRUNCADO: a API tem ' + total + ' produtos e só vieram ' + lista.length + ' — subir per_page em refresh-catalog.js');
          resolve(lista);
        } catch (e) { reject(new Error('resposta inválida da API (' + res.statusCode + ')')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  try {
    const raw = await fetchCatalog();
    if (!raw.length) throw new Error('catálogo vazio');

    fs.writeFileSync(__dirname + '/products-cache.json',
      JSON.stringify({ updatedAt: new Date().toISOString(), products: raw }, null, 2), 'utf8');

    const comStock = raw.filter(p => p.stock == null || Number(p.stock) > 0);
    const esgotados = raw.length - comStock.length;

    // so falar se houver problema a serio para postar
    if (comStock.length < 5) {
      console.log('⚠️ Catálogo: só ' + comStock.length + ' produto(s) com stock (' + esgotados + ' esgotados de ' + raw.length + ').');
      console.log('Os posts de hoje vão repetir muito — repor stock ou ver o Sourcing.');
    }
    // sucesso: silencio (o alerta das 08h trata dos deltas de esgotados)
    process.exit(0);
  } catch (e) {
    console.log('🚨 Catálogo: a API da loja NÃO respondeu na verificação das 00h (' + e.message.slice(0, 60) + ').');
    console.log('Os posts de hoje vão usar a cache de ontem (filtrada por stock). Verificar superloja.vip.');
    process.exit(0);   // nao rebentar o resto do cron
  }
})();
