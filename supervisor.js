#!/usr/bin/env node
/**
 * SuperLoja Services Supervisor
 * -----------------------------
 * Mantém vivos os serviços node do webhook-server. Sem dependências externas.
 *
 * Regras por serviço (a cada CHECK_MS):
 *   1. HTTP GET a localhost:porta+healthPath responde (qualquer status) → saudável, não faz nada.
 *      (Cobre instâncias externas: ex. reverse-proxy SYSTEM no boot, dashboard elevado — não duplica.)
 *   2. Sem resposta e porta livre → spawn do serviço (logs em data/logs/<nome>.log).
 *   3. Sem resposta mas porta ocupada (zombie doutro contexto) → tenta taskkill; se falhar,
 *      regista alerta em supervisor.log e tenta de novo no próximo ciclo.
 *
 * Backoff: >5 restarts em 2 min → pausa de 5 min para esse serviço.
 * Lockfile: só uma instância do supervisor (data/supervisor.lock com PID).
 *
 * Arranque no logon: "SuperLoja Supervisor.vbs" na pasta Startup do utilizador.
 * Restart manual/Hermes: restart-services.cmd (ou .sh).
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const DATA_DIR = process.env.DATA_DIR || 'C:/superloja/data';
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOCK_FILE = path.join(DATA_DIR, 'supervisor.lock');
const SUP_LOG = path.join(LOG_DIR, 'supervisor.log');
const CHECK_MS = 20000;

const SERVICES = [
  { name: 'dashboard',    script: 'dashboard.js',         port: 3333, healthPath: '/dashboard', env: { DASHBOARD_PORT: '3333' } },
  { name: 'chatbot',      script: 'messenger-chatbot.js', port: 3335, healthPath: '/' },
  { name: 'intelligence', script: 'intelligence-api.js',  port: 3336, healthPath: '/' },
  { name: 'proxy',        script: 'reverse-proxy.js',     port: 8080, healthPath: '/', env: { PROXY_DASHBOARD_PORT: '3333' } },
  // Tunnel público superloja.cc → 8080. Health: /ready das métricas; fallback: processo existe
  // (instâncias manuais antigas sem --metrics não respondem ao /ready mas não devem ser duplicadas).
  { name: 'cloudflared', exe: path.join(__dirname, 'cloudflared.exe'),
    args: ['--config', path.join(process.env.USERPROFILE || 'C:/Users/fox', '.cloudflared', 'config.yml'),
           '--metrics', '127.0.0.1:20241', 'tunnel', 'run'],
    port: 20241, healthPath: '/ready', processName: 'cloudflared.exe' },
];

fs.mkdirSync(LOG_DIR, { recursive: true });

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function slog(msg) {
  const line = '[' + ts() + '] ' + msg + '\n';
  try { fs.appendFileSync(SUP_LOG, line); } catch {}
  process.stdout.write(line);
}

// ---- lock de instância única ----
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; } // EPERM = vivo mas elevado (não é nosso, mas existe)
}
try {
  if (fs.existsSync(LOCK_FILE)) {
    const old = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (old && old !== process.pid && pidAlive(old)) {
      process.stdout.write('[supervisor] ja existe instancia (PID ' + old + ') — a sair.\n');
      process.exit(0);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
} catch (e) { /* lock é best-effort */ }

// ---- checks ----
function httpHealthy(port, healthPath) {
  return new Promise(resolve => {
    const req = http.get({ hostname: 'localhost', port, path: healthPath, timeout: 6000 }, res => {
      res.resume();
      resolve(true); // qualquer resposta HTTP = processo vivo
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function portBusy(port) {
  return new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 3000 });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => resolve(false));
  });
}

function pidOnPort(port) {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', timeout: 10000 });
    for (const line of out.split('\n')) {
      if (line.includes('LISTENING') && new RegExp(':' + port + '\\s').test(line)) {
        const pid = parseInt(line.trim().split(/\s+/).pop(), 10);
        if (pid) return pid;
      }
    }
  } catch {}
  return null;
}

// ---- spawn ----
const state = {}; // name -> { restarts: [timestamps], pausedUntil: 0, child }

function processRunning(exeName) {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq ' + exeName + '" /FO CSV /NH', { encoding: 'utf8', timeout: 10000 });
    return out.toLowerCase().includes(exeName.toLowerCase());
  } catch { return false; }
}

function spawnService(svc) {
  const logFile = path.join(LOG_DIR, svc.name + '.log');
  const out = fs.openSync(logFile, 'a');
  const cmd  = svc.exe || process.execPath;
  const args = svc.exe ? (svc.args || []) : [path.join(BASE, svc.script)];
  const child = spawn(cmd, args, {
    cwd: BASE,
    env: Object.assign({}, process.env, svc.env || {}),
    stdio: ['ignore', out, out],
    windowsHide: true,
    detached: false,
  });
  state[svc.name].child = child;
  slog(svc.name + ': iniciado (PID ' + child.pid + ', porta ' + svc.port + ')');
  child.on('exit', (code, sig) => {
    slog(svc.name + ': terminou (code=' + code + ' sig=' + (sig || '') + ')');
  });
}

async function ensureService(svc) {
  const st = state[svc.name] = state[svc.name] || { restarts: [], pausedUntil: 0 };
  const now = Date.now();
  if (now < st.pausedUntil) return;

  if (await httpHealthy(svc.port, svc.healthPath)) return; // saudável (nosso ou externo)

  // fallback p/ serviços exe: instância legada sem endpoint de métricas — não duplicar
  if (svc.processName && processRunning(svc.processName)) return;

  if (await portBusy(svc.port)) {
    // porta ocupada mas sem resposta HTTP = zombie
    const pid = pidOnPort(svc.port);
    slog(svc.name + ': porta ' + svc.port + ' ocupada por zombie (PID ' + pid + ') — a tentar terminar');
    if (pid) {
      try { execSync('taskkill /F /PID ' + pid, { timeout: 10000, stdio: 'pipe' }); slog(svc.name + ': zombie ' + pid + ' terminado'); }
      catch { slog('ALERTA ' + svc.name + ': nao consegui matar PID ' + pid + ' (processo elevado?) — porta ' + svc.port + ' presa'); return; }
    } else return;
  }

  // backoff: 5 restarts em 2 min → pausa 5 min
  st.restarts = st.restarts.filter(t => now - t < 120000);
  if (st.restarts.length >= 5) {
    st.pausedUntil = now + 300000;
    slog('ALERTA ' + svc.name + ': 5 restarts em 2 min — pausa de 5 min (ver ' + svc.name + '.log)');
    return;
  }
  st.restarts.push(now);
  spawnService(svc);
}

async function tick() {

  // Pedido de restart do dashboard (botão 🔄): matar os FILHOS para o health-check
  // os relançar com o código novo. child.kill() do próprio pai funciona mesmo
  // quando o AV (Quick Heal) bloqueia taskkill/Stop-Process vindos de fora.
  try {
    const sig = path.join(DATA_DIR, 'restart-request.json');
    if (fs.existsSync(sig)) {
      try { fs.unlinkSync(sig); } catch {}
      slog('restart-request recebido: a reiniciar serviços para recarregar código');
      for (const name of Object.keys(state)) {
        const st = state[name];
        if (st && st.child && st.child.pid && !st.child.killed) {
          try { st.child.kill(); slog('  parou ' + name + ' (pid ' + st.child.pid + ')'); }
          catch (e) { slog('  falha a parar ' + name + ': ' + e.message); }
        }
      }
    }
  } catch (e) { slog('restart-request: ' + e.message); }
  for (const svc of SERVICES) {
    try { await ensureService(svc); }
    catch (e) { slog('erro no check de ' + svc.name + ': ' + e.message); }
  }
}

process.on('uncaughtException', e => slog('uncaught: ' + e.message));
process.on('unhandledRejection', e => slog('unhandled: ' + (e && e.message || e)));

slog('=== Supervisor iniciado (PID ' + process.pid + ') — servicos: ' + SERVICES.map(s => s.name + ':' + s.port).join(', ') + ' ===');
tick();
setInterval(tick, CHECK_MS);
