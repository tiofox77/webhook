// Consolida a lista de interesse existente pelo CONCEITO (mesma lógica do bot).
// Corre uma vez: os 14 registos de "1x" incluem 9 frases diferentes para o
// mesmo pedido, o que fazia o filtro count>=2 do cérebro nunca ver nada.
const fs = require('fs');
const F = 'C:/superloja/data/crm/wishlist.json';

const STOP_DESEJO = new Set(['para', 'com', 'sem', 'tipo', 'estilo', 'acessorio', 'acessorios',
  'produto', 'produtos', 'cliente', 'clientes', 'pediu', 'pedido', 'pedidos', 'solicitado',
  'especifico', 'especifica', 'verdade', 'claro', 'nunca', 'mencionado', 'mencionados',
  'faixa', 'nesta', 'neste', 'retorno', 'fotos', 'foto', 'mais', 'muito', 'outro', 'outra']);
const termos = s => [...new Set(String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter(t => t.length >= 4 && !STOP_DESEJO.has(t)).map(t => t.replace(/s$/, '')))];
function achar(lista, produto) {
  const t = termos(produto);
  if (!t.length) return null;
  for (const w of lista) {
    const tw = w.termos && w.termos.length ? w.termos : termos(w.produto);
    const comuns = t.filter(x => tw.includes(x)).length;
    if (comuns && comuns / Math.min(t.length, tw.length) >= 0.5) return w;
  }
  return null;
}

const antes = JSON.parse(fs.readFileSync(F, 'utf8'));
fs.writeFileSync(F.replace('.json', '.backup-' + Date.now() + '.json'), JSON.stringify(antes, null, 2), 'utf8');

const novo = [];
for (const it of antes) {
  const alvo = achar(novo, it.produto);
  if (!alvo) {
    novo.push({
      produto: it.produto, produtoKey: String(it.produto).toLowerCase().trim(),
      termos: termos(it.produto), count: it.count || 1,
      variantes: it.variantes || [], clientes: it.clientes || [],
      plataformas: it.plataformas || [], primeiro: it.primeiro, ultimo: it.ultimo
    });
    continue;
  }
  alvo.count += (it.count || 1);
  if (it.produto !== alvo.produto && !alvo.variantes.includes(it.produto)) alvo.variantes.push(it.produto);
  (it.clientes || []).forEach(c => { if (!alvo.clientes.includes(c)) alvo.clientes.push(c); });
  (it.plataformas || []).forEach(p => { if (!alvo.plataformas.includes(p)) alvo.plataformas.push(p); });
  if (it.primeiro && (!alvo.primeiro || it.primeiro < alvo.primeiro)) alvo.primeiro = it.primeiro;
  if (it.ultimo && (!alvo.ultimo || it.ultimo > alvo.ultimo)) alvo.ultimo = it.ultimo;
}
novo.sort((a, b) => (b.count || 0) - (a.count || 0));
fs.writeFileSync(F, JSON.stringify(novo, null, 2), 'utf8');

console.log('antes: ' + antes.length + ' itens  ->  depois: ' + novo.length + ' itens');
console.log('');
for (const w of novo) {
  console.log('  ' + String(w.count + 'x').padEnd(5) + w.produto.slice(0, 46).padEnd(48) +
    (w.variantes.length ? '(+' + w.variantes.length + ' frases)' : ''));
}
const uteis = novo.filter(w => w.count >= 2);
console.log('\nchegam ao cérebro (count>=2): ' + uteis.length + ' — ' + (uteis.map(w => w.produto.slice(0, 30)).join(' | ') || 'nenhum'));
