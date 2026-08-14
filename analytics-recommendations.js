#!/usr/bin/env node
/**
 * Superloja Angola - Analytics Intelligence com RecomendaÃ§Ãµes CrÃ­ticas (00h WAT)
 * AnÃ¡lisa posts FB/IG, compara trends, detecta problemas, recomenda aÃ§Ãµes
 * Location: C:\\Users\\fox/webhook-server/analytics-recommendations.js
 */

require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https');
const fs = require('fs');
const path = require('path');

// â”€â”€â”€ CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PAGE_ID = process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '230190170178019';
const IG_PAGE_ID = process.env.IG_PAGE_ID || process.env.INSTAGRAM_ACCOUNT_ID || '17841464824215251';
const PAGE_TOKEN = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN;
const API_BASE = 'https://graph.facebook.com/v21.0';
const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const ANALYTICS_DIR = process.env.ANALYTICS_DIR || DATA_DIR + '/analytics';
const REPORT_FILE = ANALYTICS_DIR + '/recommendations-report.json';

if (!fs.existsSync(ANALYTICS_DIR)) {
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
}

// â”€â”€â”€ METRICAS CRITICAS PARA ANGOLA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const THRESHOLDS = {
  engagement_rate_min: 2.0,        // % â€” abaixo disso Ã© fraco
  reach_min: 500,                  // pessoas â€” mÃ­nimo esperado
  cpc_max: 100,                    // Kz â€” custo por clique mÃ¡ximo
  likes_min: 50,                   // MÃ­nimo de likes para post "bom"
  comments_min: 5,                 // ComentÃ¡rios esperados
  shares_min: 2,                   // Shares mÃ­nimos
};

// â”€â”€â”€ API HELPER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function apiGet(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ 
      ...params, 
      access_token: PAGE_TOKEN 
    }).toString();
    
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v21.0${endpoint}?${query}`,
      method: 'GET',
      headers: { 'User-Agent': 'Superloja-Analytics/1.0' }
    };
    
    https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).end();
  });
}

// â”€â”€â”€ FETCH POSTS (ÃšLTIMOS 25) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchFacebookPosts() {
  try {
    const fields = 'id,message,created_time,type,permalink_url,' +
      'likes.summary(true).limit(0),' +
      'comments.summary(true).limit(0),' +
      'shares.limit(0)';
    
    const response = await apiGet(`/${PAGE_ID}/posts`, {
      fields,
      limit: 25
    });
    
    return (response.data || []).map(post => ({
      id: post.id,
      message: post.message || '',
      created_time: post.created_time,
      type: post.type,
      permalink: post.permalink_url,
      likes: post.likes?.summary?.total_count || 0,
      comments: post.comments?.summary?.total_count || 0,
      shares: post.shares || 0,
      platform: 'facebook'
    }));
  } catch (error) {
    console.error('[FB Posts Error]', error.message);
    return [];
  }
}

async function fetchInstagramMedia() {
  try {
    const response = await apiGet(`/${IG_PAGE_ID}/media`, {
      fields: 'id,caption,media_type,timestamp,' +
        'like_count,comments_count,engagement,impressions,reach',
      limit: 25
    });
    
    return (response.data || []).map(media => ({
      id: media.id,
      caption: media.caption || '',
      type: media.media_type,
      created_time: media.timestamp,
      likes: media.like_count || 0,
      comments: media.comments_count || 0,
      engagement: media.engagement || 0,
      reach: media.reach || 0,
      impressions: media.impressions || 0,
      platform: 'instagram'
    }));
  } catch (error) {
    console.error('[IG Media Error]', error.message);
    return [];
  }
}

// â”€â”€â”€ CALCULAR ENGAJAMENTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calculateEngagement(posts) {
  return posts.map(post => {
    const total_interactions = post.likes + post.comments + (post.shares || 0);
    const reach = post.reach || post.impressions || 1000; // estimate
    const engagement_rate = ((total_interactions / reach) * 100).toFixed(2);
    
    return {
      ...post,
      total_interactions,
      reach,
      engagement_rate: parseFloat(engagement_rate),
      health: getPostHealth(total_interactions, parseFloat(engagement_rate))
    };
  });
}

function getPostHealth(interactions, engagement_rate) {
  if (engagement_rate > 5) return 'ðŸŸ¢ EXCELENTE';
  if (engagement_rate > 2) return 'ðŸŸ¡ BOM';
  if (engagement_rate > 1) return 'ðŸŸ  FRACO';
  return 'ðŸ”´ MUITO FRACO';
}

// â”€â”€â”€ ANALISAR TIPOS DE POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function analyzePostTypes(posts) {
  const types = {};
  
  posts.forEach(post => {
    const type = post.type || 'unknown';
    if (!types[type]) {
      types[type] = {
        count: 0,
        total_engagement: 0,
        avg_engagement: 0,
        posts: []
      };
    }
    types[type].count++;
    types[type].total_engagement += post.total_interactions;
    types[type].posts.push(post);
  });
  
  // Calcular mÃ©dias
  Object.keys(types).forEach(type => {
    types[type].avg_engagement = (types[type].total_engagement / types[type].count).toFixed(1);
  });
  
  return types;
}

// â”€â”€â”€ COMPARAR COM HISTÃ“RICO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function loadHistoricalData() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    const historicalFile = path.join(ANALYTICS_DIR, `report_${dateStr}.json`);
    
    if (fs.existsSync(historicalFile)) {
      return JSON.parse(fs.readFileSync(historicalFile, 'utf8'));
    }
  } catch (e) {}
  return null;
}

// â”€â”€â”€ GERAR RECOMENDAÃ‡Ã•ES (PUBLICO ANGOLA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateRecommendations(currentAnalysis, historical) {
  const recommendations = [];
  
  // 1. Engagement rate baixo
  if (currentAnalysis.avg_engagement_rate < THRESHOLDS.engagement_rate_min) {
    recommendations.push({
      priority: 'CRÃTICA',
      category: 'Engagement Fraco',
      message: `âš ï¸ Engagement rate ${currentAnalysis.avg_engagement_rate}% estÃ¡ ABAIXO de ${THRESHOLDS.engagement_rate_min}%`,
      action: '1ï¸âƒ£ ADICIONAR CTA URGENTE: "Qual achas?" ou "Encomenda jÃ¡ WhatsApp: [link]"\n2ï¸âƒ£ BOOST COM ADS: 2-3 USD/dia em Facebook Catalog Sales\n3ï¸âƒ£ MUDAR HORÃRIOS: 09hâ†’12h, 15hâ†’18h, testar se funciona melhor',
      expected_improvement: 'Engagement +30-50%'
    });
  }
  
  // 2. Comparar com ontem
  if (historical) {
    const diff = currentAnalysis.avg_engagement_rate - (historical.avg_engagement_rate || 0);
    if (diff < -1) {
      recommendations.push({
        priority: 'ALTA',
        category: 'Queda de Performance',
        message: `ðŸ“‰ Engagement caiu ${Math.abs(diff).toFixed(1)}% vs ontem`,
        action: 'Revisar captions â€” adicionar urgÃªncia ou CTA mais claro (WhatsApp direct link)',
        expected_improvement: 'Engagement +20%'
      });
    }
  }
  
  // 3. AnÃ¡lise por tipo de post
  const postTypeAnalysis = currentAnalysis.post_types || {};
  const topType = Object.entries(postTypeAnalysis).sort((a, b) => 
    parseFloat(b[1].avg_engagement) - parseFloat(a[1].avg_engagement)
  )[0];
  
  if (topType) {
    recommendations.push({
      priority: 'INFO',
      category: 'Melhor Formato',
      message: `âœ… ${topType[0].toUpperCase()} performando melhor (avg ${topType[1].avg_engagement} interaÃ§Ãµes)`,
      action: `Aumentar frequÃªncia deste tipo de post (estava ${topType[1].count}x em 25 posts)`,
      expected_improvement: 'ConsistÃªncia +40%'
    });
  }
  
  // 4. Posts com reach baixo
  const lowReachPosts = currentAnalysis.posts.filter(p => p.reach < THRESHOLDS.reach_min);
  if (lowReachPosts.length > 5) {
    recommendations.push({
      priority: 'ALTA',
      category: 'Reach Baixo',
      message: `ðŸŽ¯ ${lowReachPosts.length} posts com reach < ${THRESHOLDS.reach_min} pessoas`,
      action: 'Boostar com ads Facebook (Superloja - Catalog Sales, 2-3 USD/dia recomendado)',
      expected_improvement: 'Reach +200-300%'
    });
  }
  
  // 5. HorÃ¡rios crÃ­ticos
  recommendations.push({
    priority: 'RECOMENDAÃ‡ÃƒO',
    category: 'â° HorÃ¡rios Otimizados (Angola)',
    message: 'ðŸ‡¦ðŸ‡´ PÃºblico em Angola mais ativo: 12-14h (pausa almoÃ§o) + 18-21h (noite)',
    action: 'HORÃRIOS RECOMENDADOS:\nâ€¢ 09h â†’ MANTER (manhÃ£ cedo OK)\nâ€¢ 12h â†’ NOVO (pausa almoÃ§o, pico alto)\nâ€¢ 15h â†’ MANTER (tarde OK)\nâ€¢ 18h â†’ MANTER (noite comeÃ§a)\nâ€¢ 21h â†’ CONSIDERAR (noite profunda, engagement mÃ¡ximo)',
    expected_improvement: 'Reach +25%, Engagement +15%'
  });
  
  // 6. CTA Analysis
  const ctas = extractCTAs(currentAnalysis.posts);
  const bestCTA = Object.entries(ctas).sort((a, b) => b[1].engagement - a[1].engagement)[0];
  if (bestCTA) {
    recommendations.push({
      priority: 'INFO',
      category: 'CTA Recomendado',
      message: `ðŸ“± Melhor CTA: "${bestCTA[0]}" (avg ${bestCTA[1].engagement} interaÃ§Ãµes)`,
      action: 'Usar este CTA em prÃ³ximos posts',
      expected_improvement: 'CTR +15%'
    });
  }
  
  // 7. Problema: Sem comentÃ¡rios
  const noCmtPosts = currentAnalysis.posts.filter(p => p.comments === 0);
  if (noCmtPosts.length > 10) {
    recommendations.push({
      priority: 'ALTA',
      category: 'ðŸ’¬ Falta de ComentÃ¡rios',
      message: `${noCmtPosts.length}/${currentAnalysis.posts.length} posts SEM comentÃ¡rios (silÃªncio pÃºblico)`,
      action: 'NOVO PADRÃƒO DE CAPTION:\n"ðŸ”¥ [Produto]\nðŸ’° [PreÃ§o] Kz\nâ“ Qual achas? Comenta abaixo!\nðŸ“± Encomenda: WhatsApp [link]"\n\nPergunta SIMPLES forÃ§a comentÃ¡rios. Algoritmo IG/FB ama comentÃ¡rios = mais reach.',
      expected_improvement: 'ComentÃ¡rios +200%, Reach +50%'
    });
  }
  
  return recommendations;
}

function extractCTAs(posts) {
  const ctas = {};
  const ctaPatterns = [
    { pattern: /WhatsApp|whatsapp|wa\.me/i, label: 'WhatsApp Direct' },
    { pattern: /encomendar|encomenda|compre|order/i, label: 'Encomendar' },
    { pattern: /clique|click|saiba mais|aqui/i, label: 'Clique Aqui' },
    { pattern: /aproveita|stock limitado|urgente/i, label: 'UrgÃªncia' },
    { pattern: /confira|veja|descubra/i, label: 'Confira' }
  ];
  
  posts.forEach(post => {
    const text = (post.message || post.caption || '').toLowerCase();
    ctaPatterns.forEach(({ pattern, label }) => {
      if (pattern.test(text)) {
        if (!ctas[label]) {
          ctas[label] = { count: 0, engagement: 0 };
        }
        ctas[label].count++;
        ctas[label].engagement += post.total_interactions;
      }
    });
  });
  
  return ctas;
}

// â”€â”€â”€ RELATÃ“RIO FINAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function generateReport() {
  console.log('[Analytics Recommendations] Iniciando anÃ¡lise Ã s 0 horas WAT...');
  
  const fbPosts = await fetchFacebookPosts();
  const igMedia = await fetchInstagramMedia();
  const allPosts = [...fbPosts, ...igMedia];
  
  if (allPosts.length === 0) {
    console.error('[Error] Nenhum post encontrado nas Ãºltimas 24h');
    return null;
  }
  
  const postsWithEngagement = calculateEngagement(allPosts);
  const postTypes = analyzePostTypes(postsWithEngagement);
  const historical = loadHistoricalData();
  
  const summary = {
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().split('T')[0],
    total_posts: postsWithEngagement.length,
    facebook: fbPosts.length,
    instagram: igMedia.length,
    
    metrics: {
      avg_engagement_rate: (postsWithEngagement.reduce((sum, p) => sum + p.engagement_rate, 0) / postsWithEngagement.length).toFixed(2),
      avg_interactions: (postsWithEngagement.reduce((sum, p) => sum + p.total_interactions, 0) / postsWithEngagement.length).toFixed(1),
      total_reach: postsWithEngagement.reduce((sum, p) => sum + p.reach, 0),
      avg_likes: (postsWithEngagement.filter(p => p.likes > 0).reduce((sum, p) => sum + p.likes, 0) / Math.max(1, postsWithEngagement.filter(p => p.likes > 0).length)).toFixed(1),
      avg_comments: (postsWithEngagement.reduce((sum, p) => sum + p.comments, 0) / postsWithEngagement.length).toFixed(1)
    },
    
    post_types: postTypes,
    
    top_posts: postsWithEngagement
      .sort((a, b) => b.total_interactions - a.total_interactions)
      .slice(0, 5)
      .map(p => ({
        platform: p.platform,
        type: p.type,
        engagement: p.total_interactions,
        rate: p.engagement_rate + '%',
        health: p.health
      })),
    
    bottom_posts: postsWithEngagement
      .sort((a, b) => a.total_interactions - b.total_interactions)
      .slice(0, 3)
      .map(p => ({
        platform: p.platform,
        engagement: p.total_interactions,
        rate: p.engagement_rate + '%',
        health: p.health
      })),
    
    posts: postsWithEngagement,
    avg_engagement_rate: parseFloat(
      (postsWithEngagement.reduce((sum, p) => sum + p.engagement_rate, 0) / postsWithEngagement.length).toFixed(2)
    )
  };

  const recommendations = generateRecommendations(summary, historical);

  const currentRate = summary.avg_engagement_rate;
  const historicalRate = historical ? parseFloat(historical.metrics?.avg_engagement_rate || 0) : 0;

  const report = {
    ...summary,
    recommendations,
    comparison_with_yesterday: historical ? {
      engagement_change: (currentRate - historicalRate).toFixed(2) + '%',
      trend: currentRate > historicalRate ? 'UP' : 'DOWN'
    } : null
  };

  // Salvar relatório por data (para histórico) e como ficheiro fixo
  const dateStr = new Date().toISOString().split('T')[0];
  const dailyFile = ANALYTICS_DIR + `/report_${dateStr}.json`;
  fs.writeFileSync(dailyFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`âœ… RelatÃ³rio salvo: ${REPORT_FILE}`);
  
  return report;
}

// â”€â”€â”€ FORMATAR PARA WHATSAPP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatForWhatsApp(report) {
  if (!report) return null;
  
  let message = `ðŸ“Š *ANALYTICS SUPERLOJA* â€” ${report.date}\n\n`;
  
  message += `*ðŸ“ˆ MÃ‰TRICAS GERAIS*\n`;
  message += `Posts Ãºltimas 24h: ${report.total_posts} (FB: ${report.facebook}, IG: ${report.instagram})\n`;
  message += `Engagement Rate: ${report.metrics.avg_engagement_rate}%\n`;
  message += `Reach Total: ${report.metrics.total_reach.toLocaleString()} pessoas\n`;
  message += `Avg InteraÃ§Ãµes: ${report.metrics.avg_interactions}\n\n`;
  
  message += `*ðŸ† TOP 3 POSTS*\n`;
  report.top_posts.slice(0, 3).forEach((post, i) => {
    message += `${i + 1}. ${post.platform.toUpperCase()} | ${post.engagement} interaÃ§Ãµes | ${post.health}\n`;
  });
  message += `\n`;
  
  if (report.recommendations && report.recommendations.length > 0) {
    message += `*âš ï¸ RECOMENDAÃ‡Ã•ES CRÃTICAS*\n`;
    const critical = report.recommendations.filter(r => r.priority === 'CRÃTICA');
    const high = report.recommendations.filter(r => r.priority === 'ALTA');
    
    if (critical.length > 0) {
      message += `ðŸ”´ CRÃTICA: ${critical[0].message}\nðŸ’¡ AÃ§Ã£o: ${critical[0].action}\n\n`;
    }
    
    if (high.length > 0) {
      message += `ðŸŸ  ALTA: ${high[0].message}\nðŸ’¡ AÃ§Ã£o: ${high[0].action}\n\n`;
    }
  }
  
  if (report.comparison_with_yesterday) {
    message += `*ðŸ“Š vs ONTEM*\n`;
    message += `${report.comparison_with_yesterday.trend} ${report.comparison_with_yesterday.engagement_change}\n\n`;
  }
  
  message += `âœ… RelatÃ³rio completo em: C:\\superloja\\data/analytics/recommendations-report.json`;
  
  return message;
}

// â”€â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(async () => {
  try {
    const report = await generateReport();
    
    if (report) {
      const whatsappMsg = formatForWhatsApp(report);
      console.log('\n' + whatsappMsg);
      
      // Output para Hermes cron (serÃ¡ capturado e enviado via WhatsApp)
      console.log('\n---HERMES_OUTPUT_START---');
      console.log(whatsappMsg);
      console.log('---HERMES_OUTPUT_END---');
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();

