#!/usr/bin/env node
/**
 * Reverse Proxy - Superloja
 * Routes requests to:
 * - /dashboard → localhost:3338 (dashboard atual)
 * - /api/posts → localhost:3334 (webhook server)
 * - /webhook → localhost:3334 (webhook server)
 * Port: 8080 (HTTP) or 443 (HTTPS if configured)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const url = require('url');

const PROXY_PORT = process.env.PROXY_PORT || 8080;
// O dashboard atual é servido pelo supervisor em 3333 (dashboard.js com
// DASHBOARD_PORT=3333). Default alinhado com isso (era 3338, ficou órfão e
// causava 502 no /dashboard via proxy/túnel). Override com PROXY_DASHBOARD_PORT.
const DASHBOARD_PORT = process.env.PROXY_DASHBOARD_PORT || 3333;
// 3335 = messenger-chatbot.js — único servidor que trata /webhook (verificação Meta)
// e /api/conversations, /api/leads.
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3335;
const CHATBOT_PORT = 3335;
const INTELLIGENCE_PORT = 3336;

console.log(`🌐 Reverse Proxy iniciando na porta ${PROXY_PORT}`);
console.log(`  → /dashboard/* → localhost:${DASHBOARD_PORT}`);
console.log(`  → /intelligence/* → localhost:${INTELLIGENCE_PORT}`);
console.log(`  → /messenger/* → localhost:${CHATBOT_PORT}`);
console.log(`  → /webhook/* → localhost:${WEBHOOK_PORT}`);
console.log(`  → /api/* → localhost:${WEBHOOK_PORT}`);

/**
 * Proxy request to target
 */
function proxyRequest(req, res, targetPort, targetPath = null) {
  const parsedUrl = url.parse(req.url, true);
  const path = targetPath || parsedUrl.pathname + (parsedUrl.search || '');
  
  const options = {
    hostname: 'localhost',
    port: targetPort,
    path: path,
    method: req.method,
    headers: Object.assign({}, req.headers, { 'x-proxied': '1' })
  };
  // x-proxied: marca pedidos vindos de fora (LAN/túnel público via este proxy).
  // O dashboard usa isto para recusar ações de ESCRITA na conta Meta (ativar/
  // eliminar anúncios = gastos reais) a quem não esteja no localhost direto.

  // Remove hop-by-hop headers
  delete options.headers['connection'];
  delete options.headers['keep-alive'];
  delete options.headers['transfer-encoding'];
  delete options.headers['upgrade'];

  const proxyReq = http.request(options, (proxyRes) => {
    // Pass through status and headers
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error(`[Proxy Error] ${targetPort}${path}:`, e.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Bad Gateway - ${targetPort} unavailable`);
  });

  req.pipe(proxyReq);
}

/**
 * Main server
 */
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  // Preservar query string ao reescrever o path (Meta envia hub.mode/hub.verify_token
  // na query — sem isso a verificação do webhook falha com 403)
  const search = parsedUrl.search || '';

  // Route to dashboard
  if (pathname.startsWith('/dashboard')) {
    const dashboardPath = (pathname.replace('/dashboard', '') || '/') + search;
    proxyRequest(req, res, DASHBOARD_PORT, dashboardPath);
  }

  // Route to Intelligence API
  else if (pathname.startsWith('/intelligence')) {
    const intelligencePath = (pathname.replace('/intelligence', '') || '/') + search;
    proxyRequest(req, res, INTELLIGENCE_PORT, intelligencePath);
  }

  // Route to Messenger Chatbot
  else if (pathname.startsWith('/messenger')) {
    const chatbotPath = (pathname.replace('/messenger', '') || '/') + search;
    proxyRequest(req, res, CHATBOT_PORT, chatbotPath);
  }

  // Route to webhook server
  else if (pathname.startsWith('/webhook') || pathname.startsWith('/api')) {
    proxyRequest(req, res, WEBHOOK_PORT, pathname + search);
  }
  
  // Root
  else if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>Superloja - Proxy</title>
          <style>
            body { font-family: Arial; text-align: center; padding: 50px; background: #f0f0f0; }
            a { display: block; margin: 20px; font-size: 18px; }
          </style>
        </head>
        <body>
          <h1>🏪 Superloja Proxy</h1>
          <a href="/dashboard">📊 Dashboard</a>
          <a href="/webhook">/webhook</a>
          <a href="/api">/api</a>
        </body>
      </html>
    `);
  }
  
  // 404
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`✅ Proxy listening on port ${PROXY_PORT}`);
  console.log(`   http://localhost:${PROXY_PORT}/dashboard`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM - shutting down gracefully...');
  server.close(() => process.exit(0));
});
