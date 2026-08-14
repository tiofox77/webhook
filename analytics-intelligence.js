#!/usr/bin/env node
/**
 * Superloja Analytics Intelligence v1.0
 * Analiza comentários, products pedidos, leads, oportunidades
 * Location: C:\\Users\\fox/webhook-server/analytics-intelligence.js
 */

require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https');
const fs = require('fs');
const path = require('path');

// ������ Config ������������������������������������������������������������������������������������������������������������������������������������
const PAGE_ID = process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '230190170178019';
const IG_PAGE_ID = process.env.IG_PAGE_ID || process.env.INSTAGRAM_ACCOUNT_ID || '17841464824215251';
const ACCESS_TOKEN = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN;
const API_BASE = 'https://graph.facebook.com/v21.0';

const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const INTELLIGENCE_FILE = DATA_DIR + '/intelligence/report.json';
const PRODUCTS_MISS_FILE = DATA_DIR + '/intelligence/products-missing.json';
const LEADS_FILE = DATA_DIR + '/intelligence/leads-found.json';
const OPPORTUNITIES_FILE = DATA_DIR + '/intelligence/opportunities-lost.json';

// ������ Utils ��������������������������������������������������������������������������������������������������������������������������������������
function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

function ensureDirs() {
  [DATA_DIR, DATA_DIR + '/intelligence', DATA_DIR + '/logs'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function loadJSON(filepath) {
  try {
    return fs.existsSync(filepath) ? JSON.parse(fs.readFileSync(filepath, 'utf8')) : {};
  } catch (e) {
    log('WARN', `Failed to load ${filepath}: ${e.message}`);
    return {};
  }
}

function saveJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// ������ API Calls ������������������������������������������������������������������������������������������������������������������������������
async function apiCall(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ ...params, access_token: ACCESS_TOKEN }).toString();
    
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

// ������ Product Keywords ��������������������������������������������������������������������������������������������������������������
const PRODUCT_KEYWORDS = {
  'adaptador': ['adaptador', 'adapter', 'adaptadores'],
  'cabo': ['cabo', 'cable', 'fio'],
  'fone': ['fone', 'headphone', 'earphone', 'auricular'],
  'ventosa': ['ventosa', 'suction', 'ventosas'],
  'carregador': ['carregador', 'charger', 'carrega'],
  'bateria': ['bateria', 'battery', 'baterias'],
  'protetor': ['protetor', 'proteção', 'capa', 'case', 'protetor de tela'],
  'vidro': ['vidro temperado', 'glass', 'tempered'],
  'película': ['película', 'film screen'],
  'usb': ['usb', 'usb-c', 'usb c', 'lightning']
};

function extractProducts(text) {
  const products = [];
  const lower = text.toLowerCase();
  
  for (const [product, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      products.push(product);
    }
  }
  
  return [...new Set(products)]; // Remove duplicates
}

// ������ Sentiment Analysis (Simple) ������������������������������������������������������������������������������������
function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  
  // Positive
  const positive = /(ótimo|excelente|perfeito|adorei|amei|muito bom|recomendo|top|legal|bom|gostei|happy|love|amazing|great)/i;
  
  // Negative
  const negative = /(péssimo|horrível|ruim|problema|defeito|não funciona|decepcionado|triste|mal|sad|bad|terrible|broken|complain)/i;
  
  // Question/Inquiry
  const question = /(\?|como|qual|quanto|tem|disponível|stock|quando|pode|sabe)/i;
  
  const score = (positive.test(lower) ? 1 : 0) + (negative.test(lower) ? -1 : 0);
  const isQuestion = question.test(lower);
  
  if (score > 0) return { sentiment: 'positive', isQuestion };
  if (score < 0) return { sentiment: 'negative', isQuestion };
  return { sentiment: 'neutral', isQuestion };
}

// ������ Extract Leads from Comments ����������������������������������������������������������������������������������������
function extractLead(comment) {
  const name = comment.from?.name || 'Unknown';
  const userId = comment.from?.id;
  const text = comment.message;
  const { sentiment, isQuestion } = analyzeSentiment(text);
  const products = extractProducts(text);
  
  return {
    userId,
    name,
    text: text.substring(0, 200),
    sentiment,
    isQuestion,
    products,
    timestamp: comment.created_time,
    type: isQuestion ? 'inquiry' : (sentiment === 'negative' ? 'complaint' : 'mention')
  };
}

// ������ Get Recent Posts ��������������������������������������������������������������������������������������������������������������
async function getRecentPosts() {
  log('INFO', 'Fetching recent posts...');
  
  try {
    const data = await apiCall(`/${PAGE_ID}/posts`, {
      fields: 'id,message,created_time,comments.limit(100){message,from,created_time}',
      limit: 10
    });
    
    return data.data || [];
  } catch (e) {
    log('ERROR', `Failed to fetch posts: ${e.message}`);
    return [];
  }
}

// ������ Analyze Comments ����������������������������������������������������������������������������������������������������������������
async function analyzeComments() {
  log('INFO', '�x� Starting comment analysis...');
  
  const posts = await getRecentPosts();
  let allLeads = [];
  let productsMissing = {};
  let sentiment = { positive: 0, negative: 0, neutral: 0 };
  let types = { inquiry: 0, complaint: 0, mention: 0 };
  
  for (const post of posts) {
    const comments = post.comments?.data || [];
    
    log('INFO', `  Post ${post.id} has ${comments.length} comments`);
    
    for (const comment of comments) {
      const lead = extractLead(comment);
      allLeads.push(lead);
      
      // Count sentiment
      sentiment[lead.sentiment]++;
      types[lead.type]++;
      
      // Track missing products
      if (lead.sentiment === 'negative' || lead.isQuestion) {
        for (const product of lead.products) {
          productsMissing[product] = (productsMissing[product] || 0) + 1;
        }
      }
    }
  }
  
  return { allLeads, productsMissing, sentiment, types };
}

// ������ Identify Opportunities ������������������������������������������������������������������������������������������������
function identifyOpportunities(allLeads, productsMissing, sentiment) {
  const opportunities = {
    missingProducts: [],
    complaintsNotReplied: [],
    highValueLeads: [],
    sentimentTrends: { positive: 0, negative: 0, ratio: 0 }
  };
  
  // Missing products (most asked)
  opportunities.missingProducts = Object.entries(productsMissing)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([product, count]) => ({ product, demandCount: count }));
  
  // Complaints not replied
  opportunities.complaintsNotReplied = allLeads
    .filter(l => l.sentiment === 'negative')
    .slice(0, 20);
  
  // High-value leads (inquiries + positive = likely to buy)
  opportunities.highValueLeads = allLeads
    .filter(l => l.isQuestion && (l.sentiment === 'positive' || l.sentiment === 'neutral'))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);
  
  // Sentiment analysis
  const total = sentiment.positive + sentiment.negative + sentiment.neutral;
  opportunities.sentimentTrends = {
    positive: Math.round((sentiment.positive / total) * 100),
    negative: Math.round((sentiment.negative / total) * 100),
    neutral: Math.round((sentiment.neutral / total) * 100),
    ratio: total > 0 ? (sentiment.positive / Math.max(sentiment.negative, 1)).toFixed(2) : 0
  };
  
  return opportunities;
}

// ������ Generate Report ����������������������������������������������������������������������������������������������������������������
async function generateReport() {
  ensureDirs();
  
  log('INFO', '=================================');
  log('INFO', '�x` ANALYTICS INTELLIGENCE REPORT');
  log('INFO', '=================================');
  
  const { allLeads, productsMissing, sentiment, types } = await analyzeComments();
  const opportunities = identifyOpportunities(allLeads, productsMissing, sentiment);
  
  // Overall stats
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalComments: allLeads.length,
      commentTypes: types,
      sentimentBreakdown: sentiment,
      conversionInsights: `${opportunities.sentimentTrends.positive}% positive (${opportunities.sentimentTrends.ratio}:1 ratio)`
    },
    opportunities,
    allLeads: allLeads.slice(-50) // Last 50 for detail
  };
  
  // Save all findings
  saveJSON(INTELLIGENCE_FILE, report);
  saveJSON(PRODUCTS_MISS_FILE, opportunities.missingProducts);
  saveJSON(LEADS_FILE, opportunities.highValueLeads);
  saveJSON(OPPORTUNITIES_FILE, opportunities.complaintsNotReplied);
  
  // Print summary
  log('INFO', '');
  log('INFO', '�x� SUMMARY:');
  log('INFO', `  Total comments analyzed: ${allLeads.length}`);
  log('INFO', `  Types: ${JSON.stringify(types)}`);
  log('INFO', `  Sentiment: +${sentiment.positive} | -${sentiment.negative} | ~${sentiment.neutral}`);
  log('INFO', `  Positive ratio: ${opportunities.sentimentTrends.positive}%`);
  
  log('INFO', '');
  log('INFO', '�x: TOP 5 MISSING PRODUCTS:');
  opportunities.missingProducts.slice(0, 5).forEach((p, i) => {
    log('INFO', `  ${i+1}. ${p.product} - ${p.demandCount} mentions`);
  });
  
  log('INFO', '');
  log('INFO', '�a�️  COMPLAINTS NOT REPLIED:');
  opportunities.complaintsNotReplied.slice(0, 5).forEach((c, i) => {
    log('INFO', `  ${i+1}. ${c.name}: "${c.text}"`);
  });
  
  log('INFO', '');
  log('INFO', '�x}� HIGH-VALUE LEADS (Ready to convert):');
  opportunities.highValueLeads.slice(0, 5).forEach((l, i) => {
    log('INFO', `  ${i+1}. ${l.name} (asking about: ${l.products.join(', ')})`);
  });
  
  log('INFO', '');
  log('INFO', '�S& Report saved to:');
  log('INFO', `  - ${INTELLIGENCE_FILE}`);
  log('INFO', `  - ${PRODUCTS_MISS_FILE}`);
  log('INFO', `  - ${LEADS_FILE}`);
  log('INFO', `  - ${OPPORTUNITIES_FILE}`);
  
  return report;
}

// ������ Main ����������������������������������������������������������������������������������������������������������������������������������������
if (require.main === module) {
  generateReport().then(() => {
    log('INFO', '�S& Analytics completed');
    process.exit(0);
  }).catch(e => {
    log('ERROR', `Failed: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { generateReport, extractProducts, analyzeSentiment };

