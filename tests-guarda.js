// Testa a guarda com as frases REAIS que ela cortou (e que eram verdade),
// mais as invenções que tem de continuar a apanhar.
const g = require('./text-guard.js');

const casos = [
  // ── tem de DEIXAR PASSAR: políticas confirmadas e recolha de dados ──
  ['Pagas só quando o produto chegar na tua mão, sem risco nenhum.', true],
  ['Tens a vantagem de só pagares quando o produto chegar na tua mão.', true],
  ['Entregamos em qualquer bairro de Luanda em menos de 24 horas.', true],
  ['Se te der mais jeito, entregamos onde estiveres em qualquer bairro de Luanda.', true],
  ['Para fechar preciso só de 3 coisas: 1) nome completo 2) bairro e rua 3) telefone.', true],
  ['Qual é a tua rua e bairro? Assim calculo a entrega.', true],
  ['Não corres risco: só pagas quando receberes e tens 1 dia para verificar.', true],
  ['Tens 1 dia depois de receber para verificar', true],
  ['Não devolvemos dinheiro, só trocamos', true],
  ['Entrega no Kilamba são 500 Kz', true],
  ['Fala connosco no +244 954 949 595', true],
  // ── tem de REMOVER: invenções ──
  ['Compra sem risco nenhum connosco!', false],
  ['A nossa loja fica na Rua Comandante Valodia, nº 45.', false],
  ['Podes passar na Avenida Deolinda Rodrigues, 120.', false],
  ['Temos garantia de 6 meses', false],
  ['Fazemos devolução do dinheiro em 7 dias', false],
  ['Entrega grátis para toda a Luanda', false],
  ['Liga para o +244 923 456 789', false],
  ['Entrega em 3 a 5 dias úteis', false],
  // ── ENCOMENDAS (política confirmada pelo dono a 10-Ago): o bot pode OFERECER
  //    encomendar e dizer QUE leva sinal — nunca o prazo nem o VALOR do sinal.
  ['Não temos esse, mas posso encomendar. Queres?', true],
  ['As encomendas levam um sinal adiantado.', true],
  ['A encomenda demora 7 a 10 dias', false],
  ['Posso encomendar, chega em 2 semanas', false],
  ['O sinal é de 50%', false],
  ['Levamos um sinal de 5.000 Kz', false],
  // ⚠️ REAL (10-Ago): o padrão do sinal incluía "entrada" e cortava esta frase —
  //    nesta loja "entrada" é um CONECTOR, não um adiantamento.
  ['Temos o Microfone sem fio para celular, com entrada USB-C, por 17.000 Kz', true],
  ['Tem entrada USB-C e custa 5.500 Kz', true],

  // 11-Ago: a excepção do "sem risco" exigia as palavras EXACTAS "receber"/
  // "chegar" e o bot escreve conjugado. Esta frase — verdadeira, e entregue a um
  // cliente real a 14-Jul — era apagada POR INTEIRO. Mesmo erro de 06-Ago,
  // noutra conjugação. As duas primeiras têm de PASSAR; as duas seguintes têm de
  // continuar a ser cortadas, senão a excepção abriu demais.
  ['A gente confirma disponibilidade, preço e entrega rápida em Luanda — pagas quando receberes, sem risco!', true],
  ['Pagas quando o produto chegares a tua casa, sem risco nenhum.', true],
  ['Compra sem risco nenhum!', false],
  ['Sem risco, garantimos tudo.', false],

  // 13-Ago (Feliciano): o bot inventou a presença do dono depois de escalar —
  // 'já estou com o responsável' era mentira e o cliente ficou 30 min à espera
  // de ninguém. Corta-se a presença inventada; 'foi avisado' é verdade e passa.
  ['Já estou aqui com o responsável para te confirmar o preço.', false],
  ['O dono já está a confirmar os detalhes contigo agora mesmo.', false],
  ['O dono já foi avisado e responde-te logo que puder. 😊', true],
  ['Avisei o dono agora mesmo — ele vai responder assim que puder.', true],

  // 13-Ago: a guarda cortava a VERDADE do levantamento grátis (zona a 0 Kz,
  // confirmada pelo dono) — 'sem pagares nada de entrega' num contexto de
  // LEVANTAR passou a ter excepção. Entrega ao domicílio grátis continua falsa.
  ['Podes passar cá e levantar a encomenda em pessoa sem pagares nada de entrega (0 Kz).', true],
  ['Levantamento no armazém do Kilamba é grátis.', true],
  ['Entrega grátis para tua casa!', false],
  ['O envio é gratuito em Luanda.', false],
];

let ok = 0;
for (const [texto, devePassar] of casos) {
  const removidos = [];
  const limpo = g.sanitizarTexto(texto, { onRemove: (m) => removidos.push(m) });
  const passou = limpo.trim().length > 0 && !removidos.length;
  const bom = passou === devePassar;
  if (bom) ok++;
  console.log((bom ? 'OK    ' : 'FALHA ') + (devePassar ? 'passa ' : 'remove') + ' | ' + texto.slice(0, 66));
  if (!bom) console.log('        motivo: ' + (removidos.join(', ') || '(esvaziou a frase)'));
}
console.log('\n' + ok + '/' + casos.length);
process.exit(ok === casos.length ? 0 : 1);
