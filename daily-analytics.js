#!/usr/bin/env node
/**
 * Daily Analytics - Superloja Angola
 * Analisa engagement e performance de posts Facebook
 * Salva relatorio em DATA_DIR/analytics/report_YYYY-MM-DD.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (_) {}

// ─── Config ──────────────────────────────────────────────────────────────────
const DATA_DIR     = process.env.DATA_DIR      || 'C:\\superloja\\data';
const ANALYTICS_DIR = process.env.ANALYTICS_DIR || DATA_DIR + '/analytics';
const PAGE_ID      = process.env.FB_PAGE_ID    || process.env.FACEBOOK_PAGE_ID || '230190170178019';
const PAGE_TOKEN   = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN;
const STORE_API_URL = process.env.STORE_API_URL || 'https://superloja.vip/api/store-api/superloja/';
const API_KEY      = process.env.SUPERLOJA_API_KEY;
const API_SECRET   = process.env.SUPERLOJA_API_SECRET;

if (!PAGE_TOKEN) {
  console.error('[Analytics] ERRO: FB_PAGE_TOKEN ausente no .env');
  process.exit(1);
}
if (!API_KEY || !API_SECRET) {
  console.error('[Analytics] ERRO: SUPERLOJA_API_KEY/SECRET ausente no .env');
  process.exit(1);
}

if (!fs.existsSync(ANALYTICS_DIR)) {
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
}

// Data em WAT (UTC+1): a meia-noite de Luanda ainda e 23h UTC, logo toISOString()
// escreveria no ficheiro do dia anterior e destruiria o relatorio ja gerado.
function isoDateWAT(d) { return new Date(d.getTime() + 3600000).toISOString().substring(0, 10); }

// ─── HTTPS helper ─────────────────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(`Graph API: ${json.error.message}`));
          resolve(json);
        } catch (e) {
          reject(new Error(`JSON Parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ─── Busca posts do Facebook ──────────────────────────────────────────────────
// Campos agregados (type/picture/link/name/description/caption/story) estao
// depreciados desde a Graph v3.3 e fazem a chamada inteira falhar.
async function fetchFacebookPosts() {
  const fields = [
    'id', 'message', 'created_time', 'status_type', 'permalink_url', 'shares',
    'attachments{media_type}',
    'likes.summary(total_count).limit(0)',
    'comments.summary(total_count).limit(0)'
  ].join(',');

  const url = `https://graph.facebook.com/v25.0/${PAGE_ID}/posts?fields=${fields}&access_token=${PAGE_TOKEN}&limit=25`;
  const response = await httpsGet(url);
  return response.data || [];
}

// ─── Seguidores reais (base da taxa de engagement) ────────────────────────────
async function fetchFollowers() {
  try {
    const url = `https://graph.facebook.com/v25.0/${PAGE_ID}?fields=followers_count,fan_count&access_token=${PAGE_TOKEN}`;
    const r = await httpsGet(url);
    return r.followers_count || r.fan_count || 0;
  } catch (_) {
    return 0;
  }
}

// ─── Calcula engagement por post ─────────────────────────────────────────────
function calculateEngagement(posts, followers) {
  const base = followers > 0 ? followers : 1;
  return posts.map(post => {
    const likes    = post.likes?.summary?.total_count || 0;
    const comments = post.comments?.summary?.total_count || 0;
    const shares   = post.shares?.count || post.shares || 0;
    const total    = likes + comments + shares;
    const rate     = ((total / base) * 100).toFixed(2) + '%';

    return {
      id: post.id,
      message: post.message?.substring(0, 100) || '(sem texto)',
      created_time: post.created_time,
      type: post.attachments?.data?.[0]?.media_type || post.status_type || 'status',
      permalink: post.permalink_url,
      engagement: { likes, comments, shares, total, rate }
    };
  });
}

// ─── Analisa CTAs ──────────────────────────────────────────────────────────────
function analyzeCTAs(posts) {
  const ctas = {};
  const cta_patterns = [
    { pattern: /comprar|compre|order|encomende/i,           label: 'Comprar' },
    { pattern: /clique|click|aqui|saiba mais/i,             label: 'Clique/Saiba Mais' },
    { pattern: /seguir|follow|subscribe/i,                  label: 'Seguir' },
    { pattern: /confira|descubra|veja/i,                    label: 'Confira' },
    { pattern: /oferta|promo|desconto|sale/i,               label: 'Oferta/Desconto' },
    { pattern: /interessado|contacta|whatsapp|dm|contact/i, label: 'Contacte' }
  ];

  posts.forEach(post => {
    const text = post.message || '';
    cta_patterns.forEach(({ pattern, label }) => {
      if (pattern.test(text)) ctas[label] = (ctas[label] || 0) + 1;
    });
  });

  return Object.entries(ctas)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Recomendacoes ────────────────────────────────────────────────────────────
function generateRecommendations(engagements, ctas) {
  const recommendations = [];

  if (ctas.length > 0) {
    recommendations.push({
      priority: 'high',
      title: `CTA "${ctas[0].label}" teve ${ctas[0].count} posts - manter estrategia`,
      action: `Aumentar posts com CTA: ${ctas[0].label}`
    });
  }

  const avgEngagement = engagements.length > 0
    ? engagements.reduce((sum, p) => sum + p.engagement.total, 0) / engagements.length
    : 0;

  if (avgEngagement < 10) {
    recommendations.push({
      priority: 'high',
      title: 'Engagement baixo - revisar conteudo',
      action: 'Testar horarios diferentes (09h, 15h, 18h) e formatos (video, carousel)'
    });
  } else if (avgEngagement > 50) {
    recommendations.push({
      priority: 'medium',
      title: 'Engagement alto - manter cadencia',
      action: 'Continuar com estrategia atual'
    });
  }

  const sorted = [...engagements].sort((a, b) => b.engagement.total - a.engagement.total);
  const topPost = sorted[0];
  if (topPost) {
    recommendations.push({
      priority: 'medium',
      title: `Post com ${topPost.engagement.total} interacoes - type: ${topPost.type}`,
      action: `Replicar formato: ${topPost.type} com texto similar`
    });
  }

  return recommendations;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    console.log('[Analytics] Iniciando analise diaria...');

    const posts = await fetchFacebookPosts();
    if (!posts || posts.length === 0) {
      // Sem posts nao ha nada a acrescentar. Escrever um relatorio vazio aqui
      // apagaria a analise FB+IG que o analytics-intelligence.js ja produziu.
      console.warn('[Analytics] Nenhum post encontrado - relatorio existente preservado');
      return;
    }

    const followers       = await fetchFollowers();
    const engagements     = calculateEngagement(posts, followers);
    const ctas            = analyzeCTAs(posts);
    const recommendations = generateRecommendations(engagements, ctas);

    const today     = isoDateWAT(new Date());
    const timestamp = new Date().toISOString();

    const totalEngagement = engagements.reduce((sum, p) => sum + p.engagement.total, 0);
    const avgEngagement   = (totalEngagement / posts.length).toFixed(2);

    const reportPath = path.join(ANALYTICS_DIR, `report_${today}.json`);

    // Este script so acrescenta a analise de CTAs; o relatorio FB+IG completo e
    // do analytics-intelligence.js. Fundir em vez de sobrescrever preserva-o.
    let report = {};
    try {
      if (fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch (e) {
      console.warn('[Analytics] Relatorio existente ilegivel, a recriar:', e.message);
      report = {};
    }

    const existingRecs = Array.isArray(report.recommendations) ? report.recommendations : [];
    const seen = new Set(existingRecs.map(r => r.title));

    report = {
      ...report,
      generated_at: timestamp,
      date: today,
      summary: {
        ...(report.summary || {}),
        cta_total_posts:      posts.length,
        cta_total_engagement: totalEngagement,
        cta_avg_engagement:   avgEngagement,
        top_cta:              ctas[0]?.label || 'N/A'
      },
      engagement_by_post: engagements.slice(0, 10),
      cta_analysis:       ctas,
      recommendations: existingRecs.concat(recommendations.filter(r => !seen.has(r.title))),
      meta: {
        ...(report.meta || {}),
        page_id:        PAGE_ID,
        period:         '25 posts recentes',
        posts_analyzed: posts.length,
        followers_base: followers || 'desconhecido'
      }
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[Analytics] Relatorio salvo: ${reportPath} (seguidores base: ${followers || '?'})`);

    console.log(`\nRELATORIO DIARIO - SUPERLOJA ANGOLA\n`);
    console.log(`Data: ${today}`);
    console.log(`Posts analisados: ${posts.length}`);
    console.log(`Engajamento total: ${totalEngagement}`);
    console.log(`Media por post: ${avgEngagement}`);
    console.log(`\nTop CTAs:\n${ctas.slice(0, 3).map((c, i) => `  ${i+1}. ${c.label}: ${c.count}x`).join('\n')}`);
    console.log(`\nRecomendacoes:\n${recommendations.slice(0, 3).map((r, i) => `  ${i+1}. [${r.priority}] ${r.title}`).join('\n')}`);
    console.log(`\nDetalhes: ${reportPath}`);

  } catch (error) {
    console.error('[Analytics] Erro fatal:', error.message);
    process.exit(1);
  }
}

main();
