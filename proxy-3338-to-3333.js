#!/usr/bin/env node
/**
 * Minimal HTTP proxy: 3338 → 3333
 * Serve apenas para fazer o reverse-proxy.js SYSTEM (que aponta para 3338)
 * conseguir chegar ao dashboard v3.0 (que corre em 3333).
 *
 * Não é a solução ideal — o ideal seria matar o proxy SYSTEM e arrancar
 * um novo. Mas como corre como SYSTEM não é matável do user session.
 * Este proxy leve resolve o problema sem privilégios admin.
 */

const http = require('http');

const LISTEN_PORT = 3338;
const TARGET_PORT = 3333;

console.log(`[proxy-3338] forwarding :${LISTEN_PORT} → :${TARGET_PORT}`);

const server = http.createServer((req, res) => {
  const opts = {
    hostname: 'localhost',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error(`[proxy-3338] error: ${e.message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Bad Gateway: ${TARGET_PORT} unavailable`);
  });

  req.pipe(proxyReq);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[proxy-3338] listening on 127.0.0.1:${LISTEN_PORT}`);
});