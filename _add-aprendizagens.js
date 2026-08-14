// Registra as aprendizagens desta sessão (30-Jul-2026) no ficheiro permanente.
// Estas entram em TODOS os prompts via insightsPromptBlock().
const fs = require('fs');
const F = 'C:/superloja/data/crm/aprendizagens-confirmadas.json';
const db = JSON.parse(fs.readFileSync(F, 'utf8'));
const lista = Array.isArray(db) ? db : (db.aprendizagens || db.itens);

const novas = [
  {
    id: 'vocabulario-brinco-earbuds',
    texto: 'VOCABULÁRIO DO CLIENTE MATA VENDAS: em Luanda os earbuds sem fio chamam-se "brincos". Um cliente pediu "aqueles tipo brinco" e o bot respondeu que não temos — tendo 5 modelos de fones sem fio em stock. REGRA: traduzir a palavra do cliente para o OBJECTO FÍSICO e procurar esse objecto no catálogo ANTES de dizer que não temos.',
    fonte: 'conversa Hélio de Lemos (WhatsApp) — venda perdida por vocabulário, não por stock',
    confirmadaEm: '2026-07-30'
  },
  {
    id: 'earbuds-esgotados-com-procura',
    texto: 'PROCURA ATIVA SEM STOCK: os "Fones de ouvido TWS sem fio" (7.000 Kz) e os "Disney T19" (14.000 Kz) estão ESGOTADOS e são exactamente a categoria mais pedida no atendimento e a que melhor converte nos anúncios. Repor stock de earbuds baratos é a prioridade de compra.',
    fonte: 'catálogo API (stock=0) + lista de interesse + campanhas CTWA a $0.10/conversa',
    confirmadaEm: '2026-07-30'
  },
  {
    id: 'otimizacao-errada-queima-dinheiro',
    texto: 'OTIMIZAÇÃO ERRADA QUEIMA ORÇAMENTO: 5 conjuntos ativos com REACH/PAGE_LIKES/LINK_CLICKS/LANDING_PAGE_VIEWS somaram ~$20 sem UMA conversa contável. Só campanhas com otimização CONVERSATIONS (Click-to-WhatsApp) medem conversas. Auditar a otimização antes de julgar o criativo.',
    fonte: 'cérebro Hermes sobre insights Meta reais 2026-07-30',
    confirmadaEm: '2026-07-30'
  },
  {
    id: 'contagens-por-frase-sao-falsas',
    texto: 'CONTAR PEDIDOS POR FRASE INFLA A PROCURA: a destilação reanalisa as mesmas conversas e re-frasea o mesmo pedido, logo 9 registos de "brinco" eram 1 único cliente. Decidir compras exige MENÇÕES e CLIENTES DISTINTOS separados — nunca só a contagem de registos.',
    fonte: 'auditoria da lista de interesse 2026-07-30 (14 itens → 6 após agrupar por conceito)',
    confirmadaEm: '2026-07-30'
  }
];

let add = 0;
for (const n of novas) {
  if (lista.some(a => a.id === n.id)) { console.log('já existia: ' + n.id); continue; }
  lista.push(n); add++;
  console.log('+ ' + n.id);
}
fs.writeFileSync(F, JSON.stringify(Array.isArray(db) ? lista : db, null, 2), 'utf8');
console.log('\naprendizagens: ' + (lista.length - add) + ' -> ' + lista.length);
