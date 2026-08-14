// Corrige o item mal etiquetado da lista de interesse.
// Evidência: conversa de Hélio de Lemos — "Quero aqueles tipo brinco." O bot
// respondeu que "brinco" é um acessório que não temos e ofereceu pulseira e
// pingente de carro. Em Luanda "brinco" são os earbuds sem fio, e a loja tem
// cinco modelos em stock. Não era falta de produto: era falta de vocabulário.
// Deixar o registo como "earrings/9x pedido" faria o dono comprar bijutaria.
const fs = require('fs');
const F = 'C:/superloja/data/crm/wishlist.json';
const wl = JSON.parse(fs.readFileSync(F, 'utf8'));
fs.writeFileSync(F.replace('.json', '.backup-brinco-' + Date.now() + '.json'), JSON.stringify(wl, null, 2), 'utf8');

const it = wl.find(w => /brinc|earring/i.test(w.produto));
if (!it) { console.log('item não encontrado — nada a fazer'); process.exit(0); }

console.log('ANTES: "' + it.produto + '"  count=' + it.count + '  clientes=' + (it.clientes || []).length + '  estado=' + (it.estado || 'novo'));
it.produto = 'Earbuds pedidos como "brinco" — TEMOS 5 modelos em stock';
it.produtoKey = 'earbuds pedidos como brinco';
it.estado = 'adicionado';
it.estadoEm = new Date().toISOString();
it.nota = 'Não era falta de stock: "brinco" = earbuds em Luanda e o bot não sabia a palavra, ' +
          'respondeu "não temos" e ofereceu pulseira/pingente. Vocabulário corrigido no prompt do bot (30-Jul-2026). ' +
          'As ' + it.count + ' menções vêm de 1 conversa re-extraída pela destilação, não de ' + it.count + ' clientes. ' +
          'O que FALTA mesmo é repor os earbuds esgotados: Fones TWS sem fio (7.000 Kz) e Disney T19 (14.000 Kz).';
fs.writeFileSync(F, JSON.stringify(wl, null, 2), 'utf8');
console.log('DEPOIS: "' + it.produto + '"  estado=' + it.estado);
console.log('\nnota gravada:\n  ' + it.nota);
