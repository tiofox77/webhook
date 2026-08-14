/**
 * Teste de regressão para catalog-pdf.js após mudanças:
 *   1) incluirEsgotados (default false, true inclui esgotados)
 *   2) max continua a funcionar como antes
 * Não chama a API - usa dataset sintético para ser rápido.
 */
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || 'C:\\superloja\\data';

const catalogPdf = require(path.join(__dirname, 'catalog-pdf.js'));

// Dataset sintético: 10 produtos, 3 esgotados
const produtos = [
  { id: 1, name: 'Capa iPhone 13', price: '7000.00', stock: 5, images: [] },
  { id: 2, name: 'Capa iPhone 14', price: '8000.00', stock: 0, images: [] },       // esgotado
  { id: 3, name: 'Cabo USB-C', price: '4500.00', stock: 12, images: [] },
  { id: 4, name: 'Fone Bluetooth', price: '11500.00', stock: null, images: [] },  // null = trata como disponível
  { id: 5, name: 'Fone TWS', price: '7000.00', stock: 0, images: [] },             // esgotado
  { id: 6, name: 'Mouse sem fio', price: '8500.00', stock: 3, images: [] },
  { id: 7, name: 'Caixa de som', price: '17000.00', stock: 2, images: [] },
  { id: 8, name: 'Capa iPhone 15', price: '9000.00', stock: 4, images: [] },
  { id: 9, name: 'Carregador 20W', price: '5500.00', stock: 0, images: [] },       // esgotado
  { id: 10, name: 'Adaptador USB', price: '3000.00', stock: 1, images: [] },
];

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌ FAIL:', label); }
}

console.log('\n=== TEST 1: comportamento por defeito (só com stock) ===');
let r = catalogPdf.filtrar(produtos, {});
assert(r.length === 7, `7 produtos com stock, recebido ${r.length}`);
assert(!r.find(p => p.id === 2), 'Esgotado #2 fora');
assert(!r.find(p => p.id === 5), 'Esgotado #5 fora');
assert(!r.find(p => p.id === 9), 'Esgotado #9 fora');
assert(r.find(p => p.id === 4), 'Stock null #4 dentro');

console.log('\n=== TEST 2: incluirEsgotados=true (mostra tudo) ===');
r = catalogPdf.filtrar(produtos, { incluirEsgotados: true });
assert(r.length === 10, `10 produtos totais, recebido ${r.length}`);
assert(r.find(p => p.id === 2), 'Esgotado #2 dentro');
assert(r.find(p => p.id === 9), 'Esgotado #9 dentro');

console.log('\n=== TEST 3: max continua a funcionar ===');
r = catalogPdf.filtrar(produtos, { max: 3 });
assert(r.length === 3, `max:3 devolve 3, recebido ${r.length}`);

console.log('\n=== TEST 4: filtro por palavra-chave (não regrediu) ===');
r = catalogPdf.filtrar(produtos, { filtro: 'iphone' });
assert(r.length === 3, `3 iPhones, recebido ${r.length}`);
assert(!r.find(p => p.id === 6), 'Mouse fora do filtro iphone');

console.log('\n=== TEST 5: ids específicos (não regrediu) ===');
r = catalogPdf.filtrar(produtos, { ids: [1, 3, 6] });
assert(r.length === 3, `3 ids específicos, recebido ${r.length}`);

console.log('\n=== TEST 6: filtro + incluirEsgotados combinados ===');
r = catalogPdf.filtrar(produtos, { filtro: 'fone', incluirEsgotados: true });
assert(r.length === 2, `Fones (com esgotado #5), recebido ${r.length}`);
assert(r.find(p => p.id === 5), 'Esgotado #5 agora dentro (filtro fone + incluirEsgotados)');

console.log(`\n=== Resultado: ${pass} pass, ${fail} fail ===\n`);

// Teste integrado: gerar PDF real (com imagens baixadas será lento, mas sem imagens falha em silêncio)
console.log('=== TEST 7: gerarCatalogo() ainda compila e devolve path ===');
(async () => {
  try {
    const out = await catalogPdf.gerarCatalogo(produtos, { template: 'atacado' });
    assert(!!out.path, `PDF gerado em ${out.path}`);
    assert(out.produtos === 7, `7 produtos (esgotados fora por defeito), recebido ${out.produtos}`);
    assert(out.template === 'atacado', `template atacado, recebido ${out.template}`);
    console.log(`\n📄 PDF: ${out.path} (${require('fs').statSync(out.path).size} bytes)`);
  } catch (e) {
    fail++; console.log('  ❌ FAIL gerarCatalogo:', e.message);
  }
  console.log(`\n=== Final: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
