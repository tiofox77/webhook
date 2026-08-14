/**
 * produtos-rascunho.js — fila de produtos propostos, antes de irem para a loja.
 *
 * PORQUÊ ISTO EXISTE
 * A API da loja aceita escrita (testado a 12-Ago: POST devolve 201, DELETE 200),
 * mas escrever lá directamente é perigoso por três razões medidas nesse teste:
 *   1. o `is_active:false` é IGNORADO — o produto nasce visível no site;
 *   2. o DELETE apaga de vez, sem confirmação nem lixeira;
 *   3. falta o campo `category` (texto, ≠ category_id) e o INSERT rebenta.
 * Por isso o Hermes PROPÕE aqui e quem PUBLICA é o dono, no dashboard (lei 3).
 *
 * O STOCK É SEMPRE DO DONO. O Hermes não pode saber quantas unidades chegaram
 * ao armazém; um stock inventado põe o bot a vender o que não existe. O produto
 * só sobe à loja quando o dono escrever o número.
 */
const fs = require('fs');
const https = require('https');
const textGuard = require('./text-guard.js');

const DATA_DIR = process.env.DATA_DIR || 'C:/superloja/data';
const FICHEIRO = DATA_DIR + '/produtos-rascunho.json';
const LOJA_HOST = 'superloja.vip';
const LOJA_BASE = '/api/store-api/superloja';

// Categorias que a loja conhece hoje. Se aparecer uma nova, é sinal de que o
// catálogo mudou — melhor avisar do que inventar um category_id à sorte.
const CATEGORIAS = { Electronica: { category_id: 1, subcategory_id: 1 } };

function carregar() {
  try { const j = JSON.parse(fs.readFileSync(FICHEIRO, 'utf8')); return Array.isArray(j) ? j : []; }
  catch { return []; }
}
function guardar(lista) {
  fs.writeFileSync(FICHEIRO, JSON.stringify(lista, null, 2), 'utf8');
}

// ─── Normalização para detectar duplicados ───────────────────────────────────
// O catálogo já tem "Mouse Sem Fio" (8.000) e "Mouse Sem-Fio" (7.500) — dois
// registos quase iguais que fizeram o bot cotar o preço errado três vezes.
// Sem hífens, sem acentos e sem plurais, os dois colapsam no mesmo texto.
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(\w+)s\b/g, '$1')
    .trim();
}

/**
 * Sugestões de correcção — determinísticas, sobre o rascunho e o catálogo real.
 * Não corrige nada sozinho: mostra ao dono o que está estranho e porquê.
 * Cada sugestão traz `campo` e, quando dá, `valorSugerido` para o botão aplicar.
 */
function sugestoes(p, catalogo) {
  const out = [];
  const nome = String(p.nome || '');
  const desc = String(p.descricao || '');
  const preco = Number(p.preco);

  // 1. DUPLICADO — o mais caro dos erros: dois registos do mesmo produto com
  //    preços diferentes, e o bot escolhe o errado.
  const n = norm(nome);
  for (const c of (catalogo || [])) {
    const cn = norm(c.name);
    if (!cn || !n) continue;
    const igual = cn === n;
    const contido = cn.length > 6 && n.length > 6 && (cn.includes(n) || n.includes(cn));
    if (igual || contido) {
      out.push({
        nivel: igual ? 'grave' : 'aviso',
        campo: 'nome',
        texto: (igual ? 'JÁ EXISTE no catálogo' : 'Muito parecido com um produto que já existe') +
          ': "' + c.name + '" a ' + Number(c.price).toLocaleString('pt-BR') + ' Kz (id ' + c.id + ').' +
          (igual ? ' Publicar isto cria um duplicado — o bot passa a cotar preços diferentes para a mesma coisa.'
                 : ' Confirma que não é o mesmo produto com outro nome.'),
      });
    }
  }

  // 2. PREÇO — a grelha da loja é de 500 em 500 Kz (medido: 23 preços distintos,
  //    só um fora da grelha). Um preço fora dela destoa e complica a guarda.
  if (!Number.isFinite(preco) || preco <= 0) {
    out.push({ nivel: 'grave', campo: 'preco', texto: 'Preço em falta ou inválido.' });
  } else if (preco % 500 !== 0) {
    const perto = Math.round(preco / 500) * 500;
    out.push({
      nivel: 'aviso', campo: 'preco', valorSugerido: perto,
      texto: 'Preço fora da grelha da loja (múltiplos de 500 Kz). O mais perto é ' + perto.toLocaleString('pt-BR') + ' Kz.',
    });
  }
  // margem, só quando o custo foi mesmo declarado
  const custo = Number(p.custo);
  if (Number.isFinite(custo) && custo > 0 && Number.isFinite(preco) && preco > 0) {
    const m = preco / custo;
    if (m < 1.5) out.push({
      nivel: 'grave', campo: 'preco',
      texto: 'Margem de apenas ' + m.toFixed(2) + '× sobre o custo declarado (' + custo.toLocaleString('pt-BR') + ' Kz). Confirma se compensa.',
    });
  }

  // 3. DESCRIÇÃO — 43% do catálogo tem "Produto de qualidade" e 40% tem menos de
  //    25 caracteres úteis. É por isso que o bot não sabe responder a perguntas
  //    de USO e acaba a dizer "vou confirmar".
  const descUtil = desc.replace(/produto de qualidade/gi, '').trim();
  if (!descUtil) {
    out.push({ nivel: 'grave', campo: 'descricao', texto: 'Sem descrição útil. O bot vai ficar sem resposta para "serve para quê?" e cai no "vou confirmar".' });
  } else if (descUtil.length < 40) {
    out.push({ nivel: 'aviso', campo: 'descricao', texto: 'Descrição muito curta (' + descUtil.length + ' caracteres úteis). Diz para que serve e com o que é compatível — é o que o cliente pergunta.' });
  }
  if (/produto de qualidade/i.test(desc)) {
    out.push({ nivel: 'aviso', campo: 'descricao', texto: 'Contém o texto-tipo "Produto de qualidade", que não diz nada. 36 produtos do catálogo já o têm.' });
  }

  // 4. NOME
  if (nome.trim().split(/\s+/).length < 2) {
    out.push({ nivel: 'aviso', campo: 'nome', texto: 'Nome de uma palavra só. O catálogo já tem "Ventosas", "Mouse", "Microfone" — e o bot não consegue distingui-los quando o cliente pergunta.' });
  }
  if (nome && nome === nome.toUpperCase() && /[A-Z]{4,}/.test(nome)) {
    out.push({ nivel: 'aviso', campo: 'nome', valorSugerido: nome.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), texto: 'Nome todo em maiúsculas.' });
  }
  // número do modelo colado ao preço envenena a extracção da guarda ("X83 9.500
  // Kz" lia-se 839.500). Com dois pontos no nome o problema desaparece.
  if (/\d\s*$/.test(nome.trim())) {
    out.push({ nivel: 'aviso', campo: 'nome', texto: 'O nome acaba em número. Quando o bot escrever "' + nome.trim() + ' 9.500 Kz", o número do modelo cola-se ao preço. Põe o modelo entre parênteses.' });
  }

  // 5. CATEGORIA
  if (!CATEGORIAS[p.categoria]) {
    out.push({ nivel: 'grave', campo: 'categoria', texto: 'Categoria "' + (p.categoria || '(vazia)') + '" desconhecida. A loja só conhece: ' + Object.keys(CATEGORIAS).join(', ') + '. Sem ela o INSERT rebenta.' });
  }

  // 6. GUARDA — o que sairia cortado se este texto fosse para um cliente
  try {
    const cortes = [];
    textGuard.sanitizarTexto(nome + '\n' + desc, { onRemove: (motivo, frase) => cortes.push(motivo + ': "' + String(frase).slice(0, 60) + '"') });
    for (const c of cortes) out.push({ nivel: 'grave', campo: 'descricao', texto: 'A guarda anti-alucinação cortaria isto — ' + c + '. Promessa que a loja não confirmou.' });
  } catch (_) {}

  return out;
}

/** Cria um rascunho. NÃO toca na loja. */
function criarRascunho(dados) {
  const nome = String(dados.nome || '').trim();
  if (!nome) throw new Error('nome obrigatório');
  const lista = carregar();
  const r = {
    id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nome,
    preco: Number(dados.preco) || 0,
    custo: Number(dados.custo) || null,
    descricao: String(dados.descricao || '').trim(),
    categoria: String(dados.categoria || 'Electronica').trim(),
    imagens: Array.isArray(dados.imagens) ? dados.imagens.slice(0, 6) : [],
    porque: String(dados.porque || '').slice(0, 400),   // a evidência que justifica stockar
    proposto: String(dados.proposto || 'Hermes'),
    estado: 'rascunho',
    criadoEm: new Date().toISOString(),
  };
  lista.push(r);
  guardar(lista);
  return r;
}

function definirEstado(id, estado, nota) {
  const lista = carregar();
  const r = lista.find((x) => x.id === id);
  if (!r) throw new Error('rascunho não encontrado');
  r.estado = estado;
  if (nota) r.nota = String(nota).slice(0, 300);
  r.actualizadoEm = new Date().toISOString();
  guardar(lista);
  return r;
}

function pedirLoja(metodo, caminho, corpo) {
  return new Promise((resolve, reject) => {
    const body = corpo ? Buffer.from(JSON.stringify(corpo), 'utf8') : null;
    const req = https.request({
      hostname: LOJA_HOST, path: LOJA_BASE + caminho, method: metodo,
      headers: Object.assign({
        'X-Api-Key': process.env.SUPERLOJA_API_KEY || '',
        'X-Api-Secret': process.env.SUPERLOJA_API_SECRET || '',
        Accept: 'application/json',
      }, body ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length } : {}),
    }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(j || {});
        // A loja devolve excepções cruas do Laravel (debug ligado em produção):
        // cortar para não despejar SQL e caminhos do servidor no dashboard.
        reject(new Error('HTTP ' + res.statusCode + ' ' + String((j && j.message) || d).slice(0, 160)));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout a falar com a loja')));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Publica na loja. O STOCK vem de fora e é obrigatório — é o acto humano.
 * `alteracoes` deixa o dono corrigir campos (preço, nome, descrição) sem ter de
 * pedir ao Hermes outra versão.
 */
async function publicar(id, stock, alteracoes) {
  const lista = carregar();
  const r = lista.find((x) => x.id === id);
  if (!r) throw new Error('rascunho não encontrado');
  if (r.estado === 'publicado') throw new Error('já foi publicado (id da loja: ' + r.idLoja + ')');

  const n = Number(stock);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error('stock tem de ser um número inteiro ≥ 0 — e é o dono que o diz');
  }
  Object.assign(r, alteracoes || {});

  const cat = CATEGORIAS[r.categoria];
  if (!cat) throw new Error('categoria desconhecida: ' + r.categoria);

  const corpo = {
    name: r.nome,
    price: Number(r.preco),
    currency: 'Kz',
    stock: n,
    description: r.descricao,
    category: r.categoria,          // TEXTO — obrigatório, e diferente do id
    category_id: cat.category_id,
    subcategory_id: cat.subcategory_id,
  };
  if (r.imagens && r.imagens.length) corpo.images = r.imagens;

  const criado = await pedirLoja('POST', '/products', corpo);
  r.estado = 'publicado';
  r.idLoja = criado.id;
  r.stock = n;
  r.publicadoEm = new Date().toISOString();
  guardar(lista);
  return { rascunho: r, produto: criado };
}

/**
 * Apagar da loja. Definitivo — a loja não tem lixeira.
 * Marca também o rascunho correspondente, se existir: sem isto a fila local
 * ficava a dizer "publicado id120" apontando para um produto que já não existe,
 * e a próxima pessoa a ler o ficheiro acreditava nela.
 */
async function apagarDaLoja(idLoja) {
  const r = await pedirLoja('DELETE', '/products/' + encodeURIComponent(idLoja));
  const lista = carregar();
  const alvo = lista.find((x) => String(x.idLoja) === String(idLoja));
  if (alvo) {
    alvo.estado = 'apagado';
    alvo.apagadoEm = new Date().toISOString();
    guardar(lista);
  }
  return r;
}

module.exports = { carregar, criarRascunho, definirEstado, sugestoes, publicar, apagarDaLoja, norm, CATEGORIAS };
