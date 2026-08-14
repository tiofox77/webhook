/**
 * perfil-clientes.js — o bot lembra-se de quem volta.
 *
 * PORQUÊ: o bot só via as últimas 6 mensagens. O cliente que voltava no dia
 * seguinte era um estranho: repetia o bairro, o modelo do telemóvel, o que já
 * tinha perguntado. Duas vendas morreram por troca de modelo (12 Pro vs
 * 12 Pro Max) que o cliente JÁ tinha dito.
 *
 * LEI 1 APLICADA À MEMÓRIA: só se guarda o que o CLIENTE disse, com data.
 * Nada é inferido pela IA — a extracção é determinística (regex + detectZone).
 * Uma memória alucinada é pior do que nenhuma: o cliente cobra-a depois.
 */
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || 'C:/superloja/data';
const FICHEIRO = DATA_DIR + '/crm/perfil-clientes.json';
const MAX_PERFIS = 800;          // LRU: acima disto, sai o mais antigo
const MAX_INTERESSES = 6;

let _cache = null;
function _carregar() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(fs.readFileSync(FICHEIRO, 'utf8')); }
  catch { _cache = {}; }
  return _cache;
}
function _guardar() {
  // escrita síncrona, como o bot-state: nesta máquina nenhum hook de
  // encerramento corre — o que não está no disco perde-se no restart.
  const db = _carregar();
  const ids = Object.keys(db);
  if (ids.length > MAX_PERFIS) {
    ids.sort((a, b) => String(db[a].ultimaVez || '').localeCompare(String(db[b].ultimaVez || '')));
    for (const id of ids.slice(0, ids.length - MAX_PERFIS)) delete db[id];
  }
  try { fs.writeFileSync(FICHEIRO, JSON.stringify(db, null, 1), 'utf8'); } catch (_) {}
}

// Modelos de telemóvel que o CLIENTE declara ("tenho um iPhone 12 Pro", "meu
// Galaxy S24"). A ordem importa: "12 Pro Max" tem de ganhar a "12 Pro" — foi
// exactamente esta confusão que perdeu duas vendas.
const RE_MODELO = /\b(iphone\s?\d{1,2}\s?(?:pro\s?max|pro|plus|mini)?|galaxy\s?[asz]\d{1,3}(?:\s?(?:ultra|plus|fe))?|redmi(?:\s?note)?\s?\d{1,2}(?:\s?pro)?|poco\s?[a-z]\d{1,2}|huawei\s?[a-z]+\s?\d{1,2}|tecno\s?\w+|infinix\s?\w+|itel\s?\w+)\b/i;
// só quando fala DELE — não quando pergunta pelo catálogo ("têm capa iphone 13?")
const RE_MEU = /\b(meu|minha|tenho|uso|o meu|a minha)\b/i;

function _hoje() { return new Date().toISOString().slice(0, 10); }

/** Aprende do texto do cliente. Determinístico, zero IA, zero custo. */
function aprender(senderId, senderName, texto, plataforma, deliveryZones) {
  if (!senderId) return;
  const db = _carregar();
  const id = String(senderId);
  const p = db[id] || (db[id] = { criadoEm: new Date().toISOString() });
  p.ultimaVez = new Date().toISOString();
  p.plataforma = plataforma || p.plataforma;
  if (senderName && !/^User_\d+$/i.test(senderName)) p.nome = senderName;
  const t = String(texto || '');

  // zona de entrega — a MESMA detecção que calcula a taxa (nunca outra lógica).
  // Só com confiança alta e sem ambiguidade: uma zona errada na memória faz o
  // bot cobrar a taxa errada a TODAS as visitas futuras deste cliente.
  if (deliveryZones && t) {
    try {
      const z = deliveryZones.detectZone(t);
      if (z && z.zona && z.zonaId !== 'levantamento' && !z.ambiguo && z.confianca === 'alta') {
        p.zona = { nome: z.zona, quando: _hoje() };
      }
    } catch (_) {}
  }
  // modelo do telemóvel — só se fala do DELE
  if (RE_MEU.test(t)) {
    const m = t.match(RE_MODELO);
    if (m) p.modelo = { nome: m[1].replace(/\s+/g, ' ').trim(), quando: _hoje() };
  }
  _guardar();
}

/** Regista interesse num produto (chamado quando o bot identifica o produto). */
function interessouSe(senderId, produto) {
  if (!senderId || !produto) return;
  const db = _carregar();
  const p = db[String(senderId)];
  if (!p) return;
  p.interesses = p.interesses || [];
  const nome = String(produto).slice(0, 60);
  p.interesses = p.interesses.filter(i => i.nome !== nome);
  p.interesses.push({ nome, quando: _hoje() });
  if (p.interesses.length > MAX_INTERESSES) p.interesses = p.interesses.slice(-MAX_INTERESSES);
  _guardar();
}

/** Regista uma encomenda feita (chamado pelo processamento do <<PEDIDO>>). */
function encomendou(senderId, resumo) {
  if (!senderId) return;
  const db = _carregar();
  const p = db[String(senderId)];
  if (!p) return;
  p.encomendas = p.encomendas || [];
  p.encomendas.push({ resumo: String(resumo || '').slice(0, 80), quando: _hoje() });
  if (p.encomendas.length > 5) p.encomendas = p.encomendas.slice(-5);
  _guardar();
}

/**
 * Bloco para o prompt — só para quem VOLTA (>12h desde a primeira conversa) e
 * só factos datados. Curto de propósito: ≤ ~450 chars, o prompt já é grande.
 */
function bloco(senderId) {
  const db = _carregar();
  const p = db[String(senderId)];
  if (!p) return '';
  const idadeH = (Date.now() - Date.parse(p.criadoEm || 0)) / 3600000;
  const temFactos = p.zona || p.modelo || (p.interesses && p.interesses.length) || (p.encomendas && p.encomendas.length);
  if (idadeH < 12 || !temFactos) return '';
  const linhas = [];
  if (p.modelo) linhas.push('- O telemóvel DELE é um ' + p.modelo.nome + ' (disse-o a ' + p.modelo.quando + '). MODELO EXACTO: acessório de outro modelo não serve.');
  if (p.zona) linhas.push('- É de ' + p.zona.nome + ' (disse-o a ' + p.zona.quando + '). Usa a taxa dessa zona sem voltar a perguntar o bairro — confirma só se a entrega é para lá.');
  if (p.interesses && p.interesses.length) linhas.push('- Já se interessou por: ' + p.interesses.map(i => i.nome + ' (' + i.quando + ')').join(', ') + '.');
  if (p.encomendas && p.encomendas.length) {
    const u = p.encomendas[p.encomendas.length - 1];
    linhas.push('- Já fez encomenda connosco: ' + u.resumo + ' (' + u.quando + '). Trata-o como cliente da casa.');
  }
  if (!linhas.length) return '';
  return '\nCLIENTE QUE VOLTA — o que ELE PRÓPRIO te disse antes (usa com naturalidade, sem recitar datas):\n' +
    linhas.join('\n') +
    '\n⛔ Se algo parecer desactualizado ("mudei de telefone"), o que ele diz AGORA ganha sempre ao que está aqui.\n';
}

module.exports = { aprender, interessouSe, encomendou, bloco };
