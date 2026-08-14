/**
 * Entregas - Superloja Angola
 * Identifica a zona de Luanda a partir do texto do cliente e estima a taxa.
 *
 * Ponto de partida: Kilamba / armazem.
 * Taxas confirmadas pelo dono: Kilamba 500, Gamek 2000, Viana 3000, Zango 2000/3000.
 * As restantes zonas entram como ESTIMATIVA (confirmado:false) e o bot anuncia-as
 * como aproximadas ate serem confirmadas no dashboard.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR    = process.env.DATA_DIR || 'C:\\superloja\\data';
const CONFIG_DIR  = path.join(DATA_DIR, 'config');
const ZONES_FILE  = path.join(CONFIG_DIR, 'delivery-zones.json');

// ─── Tabela base ──────────────────────────────────────────────────────────────
// taxa: Kz | confirmado: preco dado pelo dono (true) ou estimativa nossa (false)
// aliases: como o cliente realmente escreve (incluindo erros comuns e variantes k/c/qu)
const DEFAULT_ZONES = [
  { id: 'levantamento', nome: 'Levantamento no armazém', taxa: 0, confirmado: true, tier: 0,
    aliases: ['levantar', 'levantamento', 'passo ai', 'passo la', 'vou buscar', 'vou ai buscar',
              'armazem', 'armazém', 'na loja', 'recolher', 'pickup'] },

  { id: 'kilamba', nome: 'Kilamba', taxa: 500, confirmado: true, tier: 1,
    aliases: ['kilamba', 'quilamba', 'cilamba', 'centralidade do kilamba', 'kk5000', 'kk 5000',
              'kilamba kiaxi', 'quilamba quiaxi', 'sequele do kilamba'] },

  { id: 'gamek', nome: 'Gamek', taxa: 2000, confirmado: true, tier: 2,
    aliases: ['gamek', 'gamec', 'game k', 'gameck', 'gamek a', 'gamek b'] },

  { id: 'viana', nome: 'Viana', taxa: 3000, confirmado: true, tier: 3,
    aliases: ['viana', 'vila de viana', 'estalagem', 'kikuxi', 'quicuxi', 'baia de viana',
              'zona industrial de viana', 'vila flor', 'capalanga', 'kapalanga'] },

  // O dono indicou "2000 ou 3000" — dividido por distancia: Zango 0-2 perto, 3-5 longe.
  { id: 'zango_perto', nome: 'Zango 0–2', taxa: 2000, confirmado: true, tier: 3,
    aliases: ['zango 0', 'zango 1', 'zango 2', 'zango0', 'zango1', 'zango2',
              'zango i', 'zango ii', 'nzango 1', 'nzango 2'] },

  { id: 'zango_longe', nome: 'Zango 3–5', taxa: 3000, confirmado: true, tier: 4,
    aliases: ['zango 3', 'zango 4', 'zango 5', 'zango3', 'zango4', 'zango5',
              'zango iii', 'zango iv', 'zango v', 'nzango 3', 'nzango 4', 'nzango 5'] },

  // "zango" sem numero — ambiguo: o bot deve perguntar qual.
  { id: 'zango', nome: 'Zango (falta o número)', taxa: 3000, confirmado: false, tier: 4,
    ambiguo: 'Zango tem preços diferentes (0–2: 2.000 Kz | 3–5: 3.000 Kz). Pergunta qual é.',
    aliases: ['zango', 'nzango'] },

  // ─── Estimativas por confirmar ──────────────────────────────────────────────
  { id: 'camama', nome: 'Camama', taxa: 1000, confirmado: false, tier: 1,
    aliases: ['camama', 'kamama', 'camama 1', 'camama 2', 'sapu', 'sapú'] },

  { id: 'talatona', nome: 'Talatona', taxa: 1500, confirmado: false, tier: 2,
    aliases: ['talatona', 'talatona sul', 'belas business park', 'bbp', 'nova vida',
              'condominio nova vida', 'lar do patriota', 'patriota', 'benfica', 'kifica',
              'morro bento', 'moro bento', 'cabolombo', 'via expressa'] },

  { id: 'golfe', nome: 'Golfe / Palanca', taxa: 2000, confirmado: false, tier: 2,
    aliases: ['golfe', 'golf', 'golfe 1', 'golfe 2', 'palanca', 'palanka', 'vila estoril',
              'estoril', 'mundial', 'bairro mundial'] },

  { id: 'centro', nome: 'Centro (Ingombota / Maianga / Alvalade)', taxa: 2000, confirmado: false, tier: 3,
    aliases: ['ingombota', 'ingombotas', 'maianga', 'alvalade', 'mutamba', 'kinaxixi', 'kinaxixe',
              'coqueiros', 'maculusso', 'miramar', 'ilha de luanda', 'ilha', 'marginal',
              'baixa', 'baixa de luanda', 'centro', 'cidade', 'vila alice', 'prenda',
              'cassenda', 'kassenda', 'sao paulo', 'são paulo', 'marcal', 'marçal',
              'rocha pinto', 'cassequel', 'kassequel', 'terra nova', 'bairro popular'] },

  { id: 'rangel', nome: 'Rangel / Sambizanga', taxa: 2500, confirmado: false, tier: 3,
    aliases: ['rangel', 'sambizanga', 'nga mutamba', 'petrangol', 'hoji ya henda',
              'hoji-ya-henda', 'operario', 'operário', 'neves bendinha', 'valodia'] },

  { id: 'cazenga', nome: 'Cazenga', taxa: 3000, confirmado: false, tier: 4,
    aliases: ['cazenga', 'kazenga', 'tala hady', 'talahady', 'mabor', 'asa branca',
              'cazenga popular', '11 de novembro'] },

  { id: 'cacuaco', nome: 'Cacuaco', taxa: 3500, confirmado: false, tier: 5,
    aliases: ['cacuaco', 'kacuaco', 'kikolo', 'quicolo', 'boa vista', 'sequele', 'sekele',
              'panguila', 'funda', 'kifangondo', 'quifangondo'] },

  { id: 'belas', nome: 'Belas / Ramiros', taxa: 3000, confirmado: false, tier: 4,
    aliases: ['belas', 'ramiros', 'barra do kwanza', 'barra do cuanza', 'futungo',
              'samba', 'corimba', 'benfica belas', 'vila de belas'] },

  { id: 'catete', nome: 'Catete / Bita', taxa: 4000, confirmado: false, tier: 5,
    aliases: ['catete', 'katete', 'bita', 'vila de catete', 'bom jesus', 'calumbo'] }
];

// ─── Fora de Luanda ───────────────────────────────────────────────────────────
// Provincias e cidades fora da area de entrega. O bot NAO inventa solucao:
// diz que confirma com a equipa e escala ao admin (<<HUMANO>>).
const FORA_DE_LUANDA = [
  'cabinda', 'zaire', 'soyo', 'mbanza congo', 'uige', 'uíge', 'bengo', 'caxito',
  'cuanza norte', 'kwanza norte', 'ndalatando', 'cuanza sul', 'kwanza sul', 'sumbe',
  'porto amboim', 'malanje', 'malange', 'lunda norte', 'dundo', 'lunda sul', 'saurimo',
  'benguela', 'lobito', 'catumbela', 'baia farta', 'huambo', 'bie', 'bié', 'cuito', 'kuito',
  'moxico', 'luena', 'cuando cubango', 'kuando kubango', 'menongue', 'namibe', 'moçamedes',
  'mocamedes', 'huila', 'huíla', 'lubango', 'cunene', 'ondjiva', 'santa clara',
  'cazombo', 'cabinda cidade', 'landana', 'cacongo'
];

function detectProvincia(text) {
  const alvo = normalize(text);
  if (!alvo) return null;
  for (const p of FORA_DE_LUANDA) {
    const a = normalize(p);
    if (new RegExp('(^|\\s)' + a.replace(/\s+/g, '\\s+') + '($|\\s)').test(alvo)) return p;
  }
  return null;
}

// ─── Normalizacao ─────────────────────────────────────────────────────────────
// Tira acentos, pontuacao e uniformiza k/c/qu (em Angola escreve-se Kilamba/Quilamba,
// Cacuaco/Kacuaco... e o cliente mistura tudo).
function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phonetic(s) {
  return normalize(s)
    .replace(/qu/g, 'k')
    .replace(/c(?=[aou])/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/ss/g, 's')
    .replace(/z/g, 's');
}

// ─── Config persistida (editavel no dashboard) ────────────────────────────────
function loadZones() {
  try {
    if (fs.existsSync(ZONES_FILE)) {
      const saved = JSON.parse(fs.readFileSync(ZONES_FILE, 'utf8'));
      if (Array.isArray(saved.zonas) && saved.zonas.length) {
        // Alias novos do codigo entram mesmo em configs antigas ja gravadas.
        return saved.zonas.map(z => {
          const base = DEFAULT_ZONES.find(d => d.id === z.id);
          return base ? { ...base, ...z, aliases: base.aliases } : z;
        });
      }
    }
  } catch (e) { /* config corrompida: cai nos defaults */ }
  return DEFAULT_ZONES;
}

function saveZones(zonas) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const payload = { atualizado_em: new Date().toISOString(), origem: 'Kilamba / armazém', zonas };
  fs.writeFileSync(ZONES_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

// ─── Identificacao ────────────────────────────────────────────────────────────
/**
 * Procura a zona no texto. O alias mais LONGO ganha: "zango 3" tem de vencer "zango",
 * e "kilamba kiaxi" tem de vencer "kilamba".
 * @returns {null|{zona,taxa,confirmado,ambiguo,alias,confianca}}
 */
function detectZone(text, zonas) {
  const list = zonas || loadZones();
  const alvo  = normalize(text);
  const alvoF = phonetic(text);
  if (!alvo) return null;

  let best = null;
  for (const z of list) {
    for (const alias of (z.aliases || [])) {
      const a  = normalize(alias);
      const aF = phonetic(alias);
      // \b nas duas pontas: "ilha" nao pode casar dentro de "familha"
      const hit = new RegExp('(^|\\s)' + a.replace(/\s+/g, '\\s+') + '($|\\s)').test(alvo);
      const hitF = !hit && aF.length >= 4 &&
                   new RegExp('(^|\\s)' + aF.replace(/\s+/g, '\\s+') + '($|\\s)').test(alvoF);
      if (!hit && !hitF) continue;
      const score = a.length + (hit ? 10 : 0); // match exacto vale mais que o fonetico
      if (!best || score > best.score) {
        best = { score, zona: z, alias, exacto: hit };
      }
    }
  }
  if (!best) return null;

  const z = best.zona;
  return {
    zonaId:     z.id,
    zona:       z.nome,
    taxa:       z.taxa,
    confirmado: !!z.confirmado,
    ambiguo:    z.ambiguo || null,
    alias:      best.alias,
    confianca:  best.exacto ? 'alta' : 'media'
  };
}

/**
 * Estimativa pronta a usar, com a frase que o bot pode dizer.
 */
function estimate(text) {
  const zonas = loadZones();
  // fora de Luanda primeiro: "Cabinda" nunca deve cair no "qual é o teu bairro?"
  const prov = detectProvincia(text);
  if (prov) {
    return { encontrado: true, foraDeCobertura: true, provincia: prov, taxa: null, confirmado: false,
             frase: null,
             pergunta: 'Só entregamos em Luanda de momento. Diz ao cliente que vais CONFIRMAR com a equipa se há forma de enviar para ' + prov + ' — e escala ao humano.' };
  }
  const hit = detectZone(text, zonas);
  if (!hit) {
    return { encontrado: false, frase: null,
             pergunta: 'Em que zona de Luanda estás? (bairro/município) Assim digo-te já a taxa de entrega.' };
  }
  if (hit.ambiguo) {
    return { encontrado: true, ...hit, frase: null, pergunta: hit.ambiguo };
  }
  const kz = hit.taxa.toLocaleString('pt-PT');
  const frase = hit.taxa === 0
    ? 'Podes levantar no nosso armazém no Kilamba — sem custo de entrega.'
    : hit.confirmado
      ? `Entrega para ${hit.zona}: ${kz} Kz.`
      : `Entrega para ${hit.zona}: cerca de ${kz} Kz (confirmo já com a equipa).`;
  return { encontrado: true, ...hit, frase, pergunta: null };
}

/** Bloco de texto para injectar no prompt do bot. */
function promptBlock() {
  const zonas = loadZones();
  const linha = z => `- ${z.nome}: ${z.taxa === 0 ? 'grátis' : z.taxa.toLocaleString('pt-PT') + ' Kz'}` +
                     (z.confirmado ? '' : ' (ESTIMATIVA — diz "cerca de" e que confirmas)');
  const conf   = zonas.filter(z => z.confirmado && !z.ambiguo);
  const estim  = zonas.filter(z => !z.confirmado && !z.ambiguo);
  return [
    '',
    'ENTREGAS (partimos do Kilamba / armazém) — TAXAS REAIS, nunca inventes outras:',
    ...conf.map(linha),
    'Estimativas (ainda por confirmar — anuncia como aproximadas):',
    ...estim.map(linha),
    '- Zango: pergunta SEMPRE qual (0–2 = 2.000 Kz | 3–5 = 3.000 Kz).',
    '- Zona fora desta lista ou que não reconheces: NÃO inventes preço. Pergunta o bairro e diz que confirmas já.',
    '- FORA DE LUANDA (Cabinda, Benguela, Huambo, Lubango, Lobito, qualquer outra província): NÃO inventes soluções nem prometas "arranjar maneira". Diz com honestidade que de momento só entregamos em Luanda, que vais CONFIRMAR com a equipa se há forma de enviar para lá, e TERMINA com a linha oculta <<HUMANO>>cliente de [província] — fora de Luanda, confirmar envio<<FIM>> para o responsável assumir.',
    '- NUNCA faças somas de cabeça (erras). Apresenta SEMPRE em separado: "11.500 Kz + 500 Kz de entrega".',
    '- Não anuncies "total entre X e Y". Se o cliente tem várias opções, dá o preço de cada uma + a taxa à parte.',
    // 4-Ago, Jordão: adaptador de 8.000 Kz + 5.000 Kz de entrega no Centro (62%
    // do produto). Ele respondeu "entrega está muito caro" e só AÍ o bot ofereceu
    // o levantamento. A regra vive aqui, colada à tabela, porque é aqui que a
    // decisão é tomada — solta no meio das outras regras, o bot ignorava-a.
    '- ⚠️ REGRA DO LEVANTAMENTO: sempre que a taxa da zona for igual ou superior a METADE do preço do produto,',
    '  apresenta as DUAS opções NA MESMA mensagem, sem esperar que o cliente reclame:',
    '  "Entrega em <zona>: X Kz (total Y). Ou levantas grátis no nosso armazém do Kilamba e pagas só os X Kz do produto."',
    '  Exemplo real: produto 8.000 Kz + Centro 5.000 Kz → dizer logo que o levantamento é grátis.'
  ].join('\n');
}

module.exports = { loadZones, saveZones, detectZone, detectProvincia, estimate, promptBlock, normalize, DEFAULT_ZONES, ZONES_FILE };
