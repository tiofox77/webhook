#!/usr/bin/env node
/**
 * Superloja Intelligence Dashboard API
 * Location: C:\\Users\\fox/webhook-server/intelligence-api.js
 * 
 * Routes:
 * GET /intelligence/summary â€” resumo geral
 * GET /intelligence/missing-products â€” produtos mais pedidos
 * GET /intelligence/high-value-leads â€” leads prontos pra converter
 * GET /intelligence/complaints â€” reclamaÃ§Ãµes nÃ£o respondidas
 */

const express = require('express');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const PORT = process.env.INTELLIGENCE_PORT || 3336;

const app = express();

// â”€â”€â”€ Utils â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function loadJSON(filepath) {
  try {
    return fs.existsSync(filepath) ? JSON.parse(fs.readFileSync(filepath, 'utf8')) : {};
  } catch (e) {
    return {};
  }
}

// â”€â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Summary
app.get('/intelligence/summary', (req, res) => {
  const report = loadJSON(DATA_DIR + '/intelligence/report.json');
  res.json({
    timestamp: report.timestamp,
    summary: report.summary,
    stats: {
      totalComments: report.allLeads?.length || 0,
      missingProductsCount: Object.keys(report.opportunities?.missingProducts || {}).length,
      complaintsCount: report.opportunities?.complaintsNotReplied?.length || 0,
      highValueLeadsCount: report.opportunities?.highValueLeads?.length || 0
    }
  });
});

// Missing products
app.get('/intelligence/missing-products', (req, res) => {
  const products = loadJSON(DATA_DIR + '/intelligence/products-missing.json');
  res.json({
    title: 'ðŸ›’ Produtos mais pedidos (fora de stock ou falta)',
    products: Array.isArray(products) ? products : [],
    message: 'Considere repor stock desses produtos â€” hÃ¡ demanda de clientes'
  });
});

// High-value leads
app.get('/intelligence/high-value-leads', (req, res) => {
  const leads = loadJSON(DATA_DIR + '/intelligence/leads-found.json');
  res.json({
    title: 'ðŸŽ¯ Leads prontos para converter',
    leads: Array.isArray(leads) ? leads : [],
    message: 'Clientes fazendo perguntas sobre produtos â€” responda AGORA!'
  });
});

// Complaints
app.get('/intelligence/complaints', (req, res) => {
  const complaints = loadJSON(DATA_DIR + '/intelligence/opportunities-lost.json');
  res.json({
    title: 'âš ï¸ ReclamaÃ§Ãµes nÃ£o respondidas',
    complaints: Array.isArray(complaints) ? complaints : [],
    message: 'Clientes insatisfeitos â€” responda para nÃ£o perder a reputaÃ§Ã£o!'
  });
});

// Full report
app.get('/intelligence/report', (req, res) => {
  const report = loadJSON(DATA_DIR + '/intelligence/report.json');
  res.json(report);
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// â”€â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.listen(PORT, () => {
  console.log(`ðŸ§  Intelligence API running on port ${PORT}`);
  console.log(`   GET /intelligence/summary`);
  console.log(`   GET /intelligence/missing-products`);
  console.log(`   GET /intelligence/high-value-leads`);
  console.log(`   GET /intelligence/complaints`);
  console.log(`   GET /intelligence/report (full)`);
});

