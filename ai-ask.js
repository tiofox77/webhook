#!/usr/bin/env node
/**
 * ai-ask.js — pergunta rápida aos dois cérebros de IA da SuperLoja, em node
 * (sem curl/ficheiro/escape — evita as armadilhas de /tmp e acentos no Git Bash).
 *
 *   node ai-ask.js fugu  "pergunta de RACIOCÍNIO / análise / estratégia"
 *   node ai-ask.js haiku "texto a REDIGIR / resumir (caption, resposta)"
 *
 * fugu  = Sakana (api.sakana.ai) — pensa. SEM max_tokens, lento (~5-90s).
 * haiku = AISA   (api.aisa.one)  — escreve. COM max_tokens, rápido/barato.
 *
 * Regra: Fugu PENSA, Haiku ESCREVE. Imprime só o conteúdo da resposta.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (_) {}

const brain = (process.argv[2] || '').toLowerCase();
const prompt = process.argv[3];
if (!['fugu', 'haiku'].includes(brain) || !prompt) {
  console.error('Uso: node ai-ask.js <fugu|haiku> "a tua pergunta/texto"');
  process.exit(2);
}

let host, apiKey, payload, timeout;
if (brain === 'fugu') {
  apiKey = (process.env.SAKANA_API_KEY || '').trim();
  if (!apiKey) { console.error('Falta SAKANA_API_KEY no .env'); process.exit(2); }
  host = 'api.sakana.ai';
  timeout = 180000;
  // Fugu REBENTA com max_tokens — não o incluir.
  payload = JSON.stringify({ model: process.env.SAKANA_MODEL || 'fugu', messages: [{ role: 'user', content: prompt }] });
} else {
  const cfgPath = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'ai-config.json') : 'C:/superloja/data/ai-config.json';
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  apiKey = cfg.apiKey;
  host = 'api.aisa.one';
  timeout = 60000;
  payload = JSON.stringify({ model: cfg.model || 'claude-haiku-4-5-20251001', max_tokens: 700, messages: [{ role: 'user', content: prompt }] });
}

const req = https.request({
  hostname: host, path: '/v1/chat/completions', method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey, 'Content-Length': Buffer.byteLength(payload) }
}, res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      const txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (txt) { console.log(txt); }
      else { console.error('Erro IA (HTTP ' + res.statusCode + '): ' + JSON.stringify(j.error || j).slice(0, 300)); process.exit(1); }
    } catch (e) { console.error('HTTP ' + res.statusCode + ' resposta não-JSON: ' + d.slice(0, 200)); process.exit(1); }
  });
});
req.on('error', e => { console.error('Erro de rede: ' + e.message); process.exit(1); });
req.setTimeout(timeout, () => req.destroy(new Error('timeout ' + brain)));
req.write(payload); req.end();
