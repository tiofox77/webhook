#!/usr/bin/env node
/**
 * Operações da rotina "Ensinar bot superloja" — um único ponto de entrada.
 *
 * PORQUE EXISTE: a rotina fazia `curl` com flags que variavam a cada corrida, e
 * cada variação pedia permissão nova ao dono. A alternativa seria autorizar
 * `curl` a tudo — mas este agente lê conversas de clientes (nome, morada,
 * telefone), e curl aberto deixaria enviá-las para qualquer sítio da internet.
 * Este script só fala com localhost:3333 e localhost:3335. Nada mais.
 *
 * Uso:
 *   node rotina-ensinar.js saude
 *   node rotina-ensinar.js destilar
 *   node rotina-ensinar.js consultas
 *   node rotina-ensinar.js atendimento
 *   node rotina-ensinar.js ensinar <ficheiro.json>   ({pergunta, resposta})
 *
 * O `ensinar` recebe um FICHEIRO e não texto na linha de comandos: acentos e
 * emoji em argumentos de shell no Windows chegavam corrompidos ("preço" →
 * "pre?o") e iam assim para a FAQ do bot.
 */
const http = require('http');
const fs = require('fs');

const PORTAS = { bot: 3335, dashboard: 3333 };

function pedir(porta, caminho, metodo, corpo) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? Buffer.from(JSON.stringify(corpo), 'utf8') : null;
    const req = http.request({
      host: '127.0.0.1', port: porta, path: caminho, method: metodo || 'GET',
      headers: dados ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': dados.length } : {}
    }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(ch).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ' — ' + txt.slice(0, 200)));
        try { resolve(JSON.parse(txt)); } catch { resolve({ raw: txt.slice(0, 400) }); }
      });
    });
    req.on('error', e => reject(new Error('serviço em baixo: ' + e.message)));
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')); });
    if (dados) req.write(dados);
    req.end();
  });
}

const acoes = {
  async saude() {
    const r = await pedir(PORTAS.bot, '/health');
    return { bot: r.status || 'ok', followup: r.followup };
  },
  async destilar() {
    const r = await pedir(PORTAS.bot, '/api/chatbot/learn', 'POST', {});
    return { faq: r.faq, baseadoEm: r.baseadoEm, tom: r.tom };
  },
  async consultas() {
    const r = await pedir(PORTAS.bot, '/api/admin/consultas');
    const lista = Array.isArray(r) ? r : (r.consultas || []);
    return { total: lista.length, porResponder: lista.filter(x => !x.resolvido).map(x => ({
      id: x.id, cliente: x.senderName, pergunta: x.pergunta, quando: x.criadoEm })) };
  },
  async atendimento() {
    const r = await pedir(PORTAS.dashboard, '/api/atendimento');
    return r.stats || r;
  },
  async ensinar(ficheiro) {
    if (!ficheiro) throw new Error('falta o ficheiro: node rotina-ensinar.js ensinar <ficheiro.json>');
    const p = JSON.parse(fs.readFileSync(ficheiro, 'utf8'));
    if (!p.pergunta || !p.resposta) throw new Error('o ficheiro precisa de {"pergunta":"...","resposta":"..."}');
    const r = await pedir(PORTAS.bot, '/api/admin/aprender', 'POST', p);
    return { ensinado: p.pergunta.slice(0, 60), resultado: r };
  },
};

(async () => {
  const acao = process.argv[2];
  if (!acoes[acao]) {
    console.log('acções: ' + Object.keys(acoes).join(' | '));
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(await acoes[acao](process.argv[3]), null, 2));
  } catch (e) {
    // falhar aqui não pode partir a rotina: ela regista e continua
    console.log(JSON.stringify({ erro: String(e.message).slice(0, 200) }, null, 2));
    process.exit(2);
  }
})();
