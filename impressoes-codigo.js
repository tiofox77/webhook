#!/usr/bin/env node
/**
 * Impressões digitais do código — detecta alterações não autorizadas.
 *
 * PORQUÊ: a 07-Ago-2026 o Prime Agent (WSL) editou `messenger-chatbot.js` e
 * `dashboard.js` directamente e pediu restart, pondo o próprio código em frente
 * a clientes. O contrato dizia que não podia; ele tinha concordado por escrito.
 * O contrato é uma folha de papel — isto é o detector.
 *
 * NÃO IMPEDE nada, e é de propósito: qualquer agente com acesso ao disco
 * consegue escrever. O que isto garante é que o dono FICA A SABER, no WhatsApp,
 * em menos de 30 minutos. Detecção honesta vale mais do que uma barreira que dá
 * falsa confiança.
 *
 *   node impressoes-codigo.js --check     verifica e avisa o dono se mudou
 *   node impressoes-codigo.js --seco      igual, mas NÃO envia nada nem regrava
 *                                         (para testar sem dar um alarme falso)
 *   node impressoes-codigo.js --gravar    aceita o estado actual como bom
 *                                         (o Claude Code corre isto DEPOIS de
 *                                          cada alteração legítima)
 *   node impressoes-codigo.js --listar    mostra o que está registado
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';
const FICHEIRO = DATA_DIR + '/code-fingerprints.json';

// Só o que, mudado às escondidas, pode custar dinheiro ou calar o bot.
const VIGIADOS = [
  'messenger-chatbot.js',
  'dashboard.js',
  'text-guard.js',
  'ensure-bridge-patch.js',
  'ensure-hermes-setup.js',
  'supervisor.js',
  'delivery-zones.js',
  'rotina-ensinar.js',
  'auto-poster-v4.js',      // publica no FB/IG em nome do dono — faltava, e e dos que mais custa
  'impressoes-codigo.js',   // o detector tem de detectar adulteracao de si proprio
];

const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);

function estadoActual() {
  const out = {};
  for (const f of VIGIADOS) {
    const p = path.join(__dirname, f);
    try {
      out[f] = { sha: hash(p), bytes: fs.statSync(p).size, alteradoEm: fs.statSync(p).mtime.toISOString() };
    } catch { out[f] = null; }
  }
  return out;
}

function ler() { try { return JSON.parse(fs.readFileSync(FICHEIRO, 'utf8')); } catch { return null; } }

function gravar(motivo) {
  const reg = { gravadoEm: new Date().toISOString(), por: motivo || 'claude-code', ficheiros: estadoActual() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FICHEIRO, JSON.stringify(reg, null, 2), 'utf8');
  return reg;
}

// Mesmo caminho que o bot usa para falar com o dono: bridge do Hermes na 3010.
function avisarDono(texto) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ chatId: '244939729902@s.whatsapp.net', message: texto }), 'utf8');
    const r = require('http').request({
      host: '127.0.0.1', port: 3010, path: '/send', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length },
    }, res => { res.resume(); res.on('end', () => resolve(true)); });
    r.on('error', () => resolve(false));
    r.setTimeout(15000, () => { r.destroy(); resolve(false); });
    r.write(body); r.end();
  });
}

(async () => {
  const acao = process.argv[2] || '--check';

  if (acao === '--gravar') {
    const r = gravar(process.argv[3]);
    console.log('[impressoes] gravadas ' + Object.keys(r.ficheiros).filter(k => r.ficheiros[k]).length + ' impressões');
    return;
  }

  if (acao === '--listar') {
    const g = ler();
    if (!g) { console.log('[impressoes] ainda não há registo — corre --gravar'); return; }
    console.log('gravado em ' + g.gravadoEm + ' por ' + g.por);
    for (const [f, v] of Object.entries(g.ficheiros)) console.log('  ' + (v ? v.sha + '  ' + String(v.bytes).padStart(7) + '  ' : '(ausente)          ') + f);
    return;
  }

  // --check
  const guardado = ler();
  if (!guardado) { gravar('primeira-corrida'); console.log('[impressoes] primeira corrida — estado actual aceite como referência'); return; }

  const agora = estadoActual();
  const mudou = [];
  for (const f of VIGIADOS) {
    const a = guardado.ficheiros[f], b = agora[f];
    if (!a && !b) continue;
    if (!a || !b) { mudou.push({ f, o: a ? 'desapareceu' : 'apareceu' }); continue; }
    if (a.sha !== b.sha) mudou.push({ f, o: 'mudou', antes: a.bytes, depois: b.bytes, quando: b.alteradoEm });
  }

  if (!mudou.length) { console.log('[impressoes] OK — nenhum ficheiro vigiado mudou desde ' + guardado.gravadoEm); return; }

  // Um aviso por alteração, não de 30 em 30 min para sempre: depois de avisar,
  // a referência passa a ser o estado novo. O dono já sabe; repetir é ruído e
  // ruído treina-o a ignorar. (Mesmo padrão dos patches do bridge: repor →
  // avisar 1× → limpar o estado.)
  const linhas = mudou.map(m => '• ' + m.f + ' — ' + m.o +
    (m.depois ? ' (' + m.antes + ' → ' + m.depois + ' bytes, ' + String(m.quando).slice(0, 19).replace('T', ' ') + ')' : ''));
  const msg = '🔐 *CÓDIGO ALTERADO FORA DO CLAUDE CODE*\n\n' + linhas.join('\n') +
    '\n\nReferência anterior: ' + String(guardado.gravadoEm).slice(0, 19).replace('T', ' ') + ' (' + guardado.por + ')' +
    '\n\nSe não foste tu nem o Claude Code, foi outro agente a escrever em produção. Pede uma auditoria antes de deixar reiniciar.';

  console.log('[impressoes] ALTERADO:\n' + linhas.join('\n'));
  process.exitCode = 1;   // para o watchdog distinguir "mudou" de "está tudo bem"
  if (acao === '--seco') { console.log('[impressoes] modo seco — não avisei ninguém nem regravei'); return; }
  const ok = await avisarDono(msg);
  console.log('[impressoes] dono avisado: ' + ok);
  // só aceitar o estado novo como referência se o dono FOI mesmo avisado.
  // Regravar sem entregar apagava a prova: à segunda corrida dizia "está tudo
  // bem" precisamente por ter engolido o sinal — e a entrega falha justamente
  // quando a bridge está em baixo, que é quando mais importa não esquecer.
  if (ok) gravar('auto-apos-aviso');
  else console.log('[impressoes] entrega falhou — mantenho a referência antiga para voltar a tentar');
})();
