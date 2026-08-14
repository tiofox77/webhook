#!/usr/bin/env node
/**
 * Repoe a configuracao do Hermes de que a SuperLoja depende.
 *
 * PORQUE ISTO EXISTE: `hermes update` reescreve o venv e o config.yaml. Quando
 * isso acontece, o cerebro perde a capacidade de INVESTIGAR — o toolset `web`
 * fica sem backend e `web_search` nem entra no schema do agente. Nao ha erro
 * nenhum: o cerebro simplesmente deixa de pesquisar e ninguem repara, ate
 * alguem notar que ele voltou a escalar perguntas que sabia responder.
 *
 * Irmao do `ensure-bridge-patch.js` (que repoe os patches do bridge). Ambos
 * sao idempotentes e correm no watchdog de 30 em 30 minutos.
 *
 * Uso:  node ensure-hermes-setup.js          (repoe o que faltar)
 *       node ensure-hermes-setup.js --check  (so verifica; sai 1 se faltar)
 *
 * Codigos de saida: 0 = tudo bem | 1 = faltava algo | 2 = avaria (nao concluiu)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCAL = process.env.LOCALAPPDATA || 'C:\\Users\\fox\\AppData\\Local';
const VENV_PY = process.env.HERMES_PYTHON ||
  path.join(LOCAL, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe');
const CONFIG = process.env.HERMES_CONFIG ||
  path.join(process.env.USERPROFILE || 'C:\\Users\\fox', '.hermes', 'config.yaml');
const CHECK_ONLY = process.argv.includes('--check');

const emFalta = [];
const reposto = [];
const avarias = [];

// ── 1. ddgs no venv do Hermes ────────────────────────────────────────────────
// Backend de pesquisa gratuito e sem chave. Sem ele, `web.backend: ddgs` fica a
// apontar para um pacote que nao existe e a pesquisa falha em silencio.
function verificarDdgs() {
  if (!fs.existsSync(VENV_PY)) { avarias.push('venv do Hermes nao encontrado: ' + VENV_PY); return null; }
  try {
    execFileSync(VENV_PY, ['-c', 'import ddgs'], { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch { return false; }
}
function reporDdgs() {
  try {
    execFileSync(VENV_PY, ['-m', 'pip', 'install', 'ddgs', '--quiet'], { stdio: 'ignore', timeout: 300000 });
    execFileSync(VENV_PY, ['-c', 'import ddgs'], { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch (e) { avarias.push('pip install ddgs falhou: ' + String(e.message || e).slice(0, 120)); return false; }
}

// ── 1b. faster-whisper (transcrever notas de voz dos clientes) ───────────────
// Local e gratuito. Sem ele o bot volta a pedir "escreve em texto" a quem manda
// audio — e em Angola muita gente so manda audio.
function verificarWhisper() {
  if (!fs.existsSync(VENV_PY)) return null;   // avaria ja registada pelo ddgs
  try {
    execFileSync(VENV_PY, ['-c', 'import faster_whisper'], { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch { return false; }
}
function reporWhisper() {
  try {
    execFileSync(VENV_PY, ['-m', 'pip', 'install', 'faster-whisper', '--quiet'], { stdio: 'ignore', timeout: 900000 });
    execFileSync(VENV_PY, ['-c', 'import faster_whisper'], { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch (e) { avarias.push('pip install faster-whisper falhou: ' + String(e.message || e).slice(0, 120)); return false; }
}

// ── 1c. TTS — a voz do bot (13-Ago) ──────────────────────────────────────────
// edge-tts (voz pt-PT, cloud nao-oficial) + kokoro-onnx (100% local, a rede de
// seguranca). O `hermes update` reinstala o venv e levava os dois — sem eles o
// bot volta a so-texto EM SILENCIO, que e exactamente o tipo de avaria que
// ninguem nota. Os ficheiros do modelo Kokoro (~350MB) vivem FORA do venv
// (C:/superloja/data/tts) de proposito: sobrevivem ao update; aqui so se
// verifica que existem — descarregar 350MB automaticamente num check de 30 em
// 30 min seria pior que a avaria.
const TTS_DIR = process.env.TTS_DIR || 'C:\\superloja\\data\\tts';
function verificarTts() {
  if (!fs.existsSync(VENV_PY)) return null;
  try {
    execFileSync(VENV_PY, ['-c', 'import edge_tts, kokoro_onnx, soundfile'], { stdio: 'ignore', timeout: 60000 });
  } catch { return false; }
  if (!fs.existsSync(path.join(TTS_DIR, 'kokoro-v1.0.onnx')) ||
      !fs.existsSync(path.join(TTS_DIR, 'voices-v1.0.bin'))) {
    avarias.push('modelo Kokoro em falta em ' + TTS_DIR + ' (o Edge continua a funcionar; sem rede local de TTS)');
  }
  return true;
}
function reporTts() {
  try {
    execFileSync(VENV_PY, ['-m', 'pip', 'install', 'edge-tts', 'kokoro-onnx', 'soundfile', '--quiet'], { stdio: 'ignore', timeout: 900000 });
    execFileSync(VENV_PY, ['-c', 'import edge_tts, kokoro_onnx, soundfile'], { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch (e) { avarias.push('pip install edge-tts/kokoro-onnx falhou: ' + String(e.message || e).slice(0, 120)); return false; }
}

// ── 2. web.backend no config.yaml ────────────────────────────────────────────
// Editado linha a linha (nao com regex sobre o ficheiro todo): o config tem
// centenas de chaves e um replace global podia acertar noutro bloco.
function lerBlocoWeb() {
  if (!fs.existsSync(CONFIG)) { avarias.push('config.yaml nao encontrado: ' + CONFIG); return null; }
  const linhas = fs.readFileSync(CONFIG, 'utf8').split(/\r?\n/);
  const i = linhas.findIndex(l => l === 'web:');
  if (i < 0) { avarias.push('bloco "web:" nao existe no config.yaml'); return null; }
  let fim = i + 1;
  while (fim < linhas.length && /^\s+\S/.test(linhas[fim])) fim++;
  return { linhas, i, fim };
}
function verificarConfigWeb() {
  const b = lerBlocoWeb();
  if (!b) return null;
  const campos = ['backend', 'search_backend', 'extract_backend'];
  const maus = [];
  for (const campo of campos) {
    const l = b.linhas.slice(b.i + 1, b.fim).find(x => new RegExp('^\\s+' + campo + ':').test(x));
    const valor = l ? l.split(':')[1].trim().replace(/^['"]|['"]$/g, '') : '';
    if (valor !== 'ddgs') maus.push(campo);
  }
  return maus.length ? maus : true;
}
function reporConfigWeb(campos) {
  const b = lerBlocoWeb();
  if (!b) return false;
  let mudou = 0;
  for (let n = b.i + 1; n < b.fim; n++) {
    const m = b.linhas[n].match(/^(\s+)(backend|search_backend|extract_backend):.*$/);
    if (m && campos.includes(m[2])) { b.linhas[n] = m[1] + m[2] + ': ddgs'; mudou++; }
  }
  if (!mudou) { avarias.push('nao consegui escrever os campos web no config.yaml'); return false; }
  const bak = CONFIG + '.bak-antes-web';
  if (!fs.existsSync(bak)) fs.copyFileSync(CONFIG, bak);
  fs.writeFileSync(CONFIG, b.linhas.join('\n'), 'utf8');
  return true;
}

// ── Execucao ─────────────────────────────────────────────────────────────────
const temDdgs = verificarDdgs();
if (temDdgs === false) emFalta.push({ nome: 'pacote ddgs (pesquisa web do cerebro)', repor: reporDdgs });

const temWhisper = verificarWhisper();
if (temWhisper === false) emFalta.push({ nome: 'faster-whisper (transcrever notas de voz)', repor: reporWhisper });

const temTts = verificarTts();
if (temTts === false) emFalta.push({ nome: 'TTS da voz do bot (edge-tts + kokoro-onnx)', repor: reporTts });

const cfgWeb = verificarConfigWeb();
if (Array.isArray(cfgWeb)) emFalta.push({ nome: 'web.backend no config.yaml (' + cfgWeb.join(', ') + ')', repor: () => reporConfigWeb(cfgWeb) });

if (avarias.length && !emFalta.length) {
  console.log('[hermes-setup] AVARIA: ' + avarias.join(' | '));
  process.exit(2);
}

if (!emFalta.length) {
  console.log('[hermes-setup] OK — pesquisa web (ddgs + config.yaml), transcricao (faster-whisper) e voz do bot (edge-tts + kokoro local)');
  process.exit(0);
}

console.log('[hermes-setup] EM FALTA (' + emFalta.length + '): ' + emFalta.map(x => x.nome).join(', '));
if (CHECK_ONLY) {
  console.log('[hermes-setup] --check: nao alterei nada. Corre sem --check para repor.');
  process.exit(1);
}

for (const item of emFalta) {
  if (item.repor()) reposto.push(item.nome);
}
if (reposto.length) console.log('[hermes-setup] reposto: ' + reposto.join(', '));
if (avarias.length) console.log('[hermes-setup] AVARIA: ' + avarias.join(' | '));
process.exit(reposto.length === emFalta.length ? 0 : 2);
