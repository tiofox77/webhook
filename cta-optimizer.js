#!/usr/bin/env node
/**
 * CTA Optimizer — RELATÓRIO HONESTO do desempenho real dos CTAs.
 *
 * (Reescrito 2026-07-21: a versão antiga usava dados SIMULADOS hardcoded e uma
 *  lista de CTAs desactualizada — recomendava sempre "FOMO" por causa de números
 *  inventados. Agora lê o ledger REAL e os CTAs REAIS do auto-poster.)
 *
 * NÃO decide nada — quem escolhe o CTA é o bandit dentro do auto-poster-v4.js
 * (getNextCta, a partir do mesmo posts-ledger.json). Isto é só o RELATÓRIO
 * semanal para o dono ver que CTA está a ganhar. Fonte única, zero divergência.
 */

const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (_) {}

const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const LEDGER_FILE = path.join(DATA_DIR, 'posts-ledger.json');
const POSTER_FILE = path.join(__dirname, 'auto-poster-v4.js');

// Labels reais dos CTAs — extraídos dos comentários `// N — label` do
// auto-poster (leitura, sem executar o poster) para nunca divergirem.
function ctaLabels() {
  const labels = {};
  try {
    const src = fs.readFileSync(POSTER_FILE, 'utf8');
    const ini = src.indexOf('const CTA_TEMPLATES = [');
    const bloco = src.slice(ini, src.indexOf('];', ini));
    const re = /\/\/\s*(\d+)\s*(?:—|–|-)\s*([^\n(]+)/g;
    let m;
    while ((m = re.exec(bloco))) labels[m[1]] = m[2].trim();
  } catch (_) {}
  return labels;
}

function main() {
  let led;
  try { led = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')); }
  catch (e) { console.log('⚠️ CTA: sem ledger para analisar (' + e.message + ')'); return; }

  const posts = led.posts || [];
  const labels = ctaLabels();

  // agrupar score real por CTA (mesma métrica do bandit: só posts com métricas colhidas)
  const stats = {};
  posts.forEach(p => {
    if (p.ctaIdx == null || !p.metrics) return;
    (stats[p.ctaIdx] = stats[p.ctaIdx] || []).push(p.metrics.score || 0);
  });
  const comMetricas = Object.values(stats).reduce((a, v) => a + v.length, 0);
  const comScore = posts.filter(p => p.metrics && (p.metrics.score || 0) > 0).length;

  const ranking = Object.keys(stats).map(i => {
    const v = stats[i];
    return { idx: +i, label: labels[i] || ('CTA ' + i), posts: v.length,
             media: Math.round(v.reduce((a, x) => a + x, 0) / v.length * 10) / 10 };
  }).sort((a, b) => b.media - a.media);

  // O bandit do auto-poster só pondera com >=8 posts com métricas.
  if (comMetricas < 8 || comScore < 3) {
    console.log('📊 CTA — ainda a recolher dados reais:');
    console.log('• ' + posts.length + ' posts publicados | ' + comMetricas + ' já com métricas | ' + comScore + ' com engajamento > 0.');
    console.log('O bot continua em ROTAÇÃO (dá a volta aos ' + (Object.keys(labels).length || 10) + ' CTAs por igual) até haver sinal real.');
    console.log('Nota: o engajamento das páginas está quase nulo — o problema não é o CTA, é o ALCANCE. Ver os reports por plataforma.');
    return;
  }

  console.log('📊 CTA — desempenho REAL (score = gostos + 3×coment + 5×partilhas):');
  ranking.slice(0, 3).forEach((r, i) => console.log((i + 1) + '. [' + r.idx + '] ' + r.label + ' → ' + r.media + ' pts (' + r.posts + ' posts)'));
  const pior = ranking[ranking.length - 1];
  if (pior && ranking.length > 3) console.log('Mais fraco: [' + pior.idx + '] ' + pior.label + ' → ' + pior.media + ' pts');
  console.log('O bot já favorece o melhor automaticamente (bandit 65/35). Reforça o padrão do #1 nos próximos posts.');
}

main();
