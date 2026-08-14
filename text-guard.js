/**
 * text-guard.js — rede de segurança para TODO o texto gerado por IA que sai
 * para fora (posts, captions de campanha, rascunhos, respostas a clientes).
 *
 * Porquê: em 22-25 Jul 2026 o Haiku inventou números de WhatsApp em posts
 * publicados ("+244 923 456 789", "+244 923 XXX XXX") — o número real da loja
 * é +244 954 949 595. Prompts pedem, guardas garantem: esta função é
 * determinística e corre SEMPRE depois da IA, antes de publicar/enviar.
 *
 * Ordem importa: os nossos links são protegidos ANTES de mexer em telefones
 * (senão os dígitos dentro de "wa.me/244954949595" eram reescritos e o link
 * ficava destruído).
 */
const WHATSAPP_DIGITOS = '244954949595';
const WHATSAPP_FMT = '+244 954 949 595';
const WHATSAPP_LINK = 'https://wa.me/' + WHATSAPP_DIGITOS;
const PH_ABRE = '@@URL';   // placeholder visível (NUNCA usar caracteres de controlo)
const PH_FECHA = '@@';

function sanitizarContactos(texto) {
  if (!texto) return texto;
  let t = String(texto);

  // 0) proteger os NOSSOS links; apagar os estranhos
  const urls = [];
  t = t.replace(/https?:\/\/[^\s)]+/gi, (u) => {
    const nosso = /superloja\.vip/i.test(u) || new RegExp('wa\\.me/' + WHATSAPP_DIGITOS, 'i').test(u);
    if (!nosso) return '';
    urls.push(u);
    return PH_ABRE + (urls.length - 1) + PH_FECHA;
  });

  // 1) telefones normais: 8+ dígitos com separadores.
  //    [ \t] e não \s — com \s a regex atravessava o \n e colava duas linhas
  //    (o número no fim de uma linha juntava-se ao "+500" da linha seguinte).
  t = t.replace(/\+?\d[\d \t\-().]{6,}\d/g, (m) => {
    const d = m.replace(/\D/g, '');
    if (d.length < 8) return m;                        // preço/data/spec — não tocar
    if (d.endsWith('954949595')) return WHATSAPP_FMT;  // o nosso, normalizado
    return '';
  });

  // 1b) telefones MASCARADOS ("+244 923 XXX XXX", "9##-###-###") — a regra (1)
  //     não os via porque têm letras; foi assim que passou o post de 25-Jul 06:01
  t = t.replace(/\+?\d[\d \t\-.()]{0,10}[X#*?]{2,4}[\dX#*? \t\-.()]{0,14}/gi, (m) => {
    const corpo = m.replace(/[^\dX#*?]/gi, '');
    if (!/[X#*?]/i.test(corpo) || corpo.length < 6) return m;
    return '';
  });

  // 2) emails: a loja não dá suporte por email — só @superloja.vip sobrevive
  t = t.replace(/[\w.+-]+@[\w.-]+\.\w{2,}/gi, (e) => (/@superloja\.vip$/i.test(e) ? e : ''));

  // 3) rótulo de contacto órfão no FIM da linha (o número foi apagado acima):
  //    "Qual escolhes? Encomendar via WhatsApp:" → mantém a pergunta.
  const ROTULO_ORFAO = /[\s,;:–—-]*\b(?:encomendar\s+via\s+whats\s?app|encomenda[r]?\s+no\s+whats\s?app|whats\s?app|contacto|telefone)\b\s*[:\-–—]?\s*$/i;
  const temNumero = (s) => /\d{6,}/.test(s.replace(/\D/g, '')) || /\d{3}\s?\d{3}\s?\d{3}/.test(s);
  t = t.split('\n').map((linha) => {
    if (linha.indexOf(PH_ABRE) >= 0) return linha;     // linha com o nosso link
    if (temNumero(linha)) return linha;                // ainda tem número (o nosso)
    return linha.replace(ROTULO_ORFAO, '');
  }).filter((linha) => {
    const s = linha.trim();
    if (!s || s.indexOf(PH_ABRE) >= 0) return true;
    // linha que é só um convite a contactar, já sem número → não serve para nada
    const soConvite = /^[^\w]{0,3}\b(whats\s?app|contacto|telefone|liga|chama|encomendar)\b[\s\S]{0,25}$/i.test(s) && !temNumero(s);
    return !soConvite;
  }).join('\n');

  // 4) restaurar links e limpar espaços/pontuação soltos
  t = t.replace(new RegExp(PH_ABRE + '(\\d+)' + PH_FECHA, 'g'), (m, i) => (urls[Number(i)] !== undefined ? urls[Number(i)] : ''));
  return t.replace(/[ \t]{2,}/g, ' ').replace(/ +([.!?,;])/g, '$1').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** true se o texto contém um telefone que não é o nosso (real OU mascarado) */
function temContactoEstranho(texto) {
  const t = String(texto || '').replace(/https?:\/\/[^\s)]+/gi, '');   // links não contam
  const numericos = t.match(/\+?\d[\d\s\-().]{6,}\d/g) || [];
  if (numericos.some((m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 8 && !d.endsWith('954949595');
  })) return true;
  const mascarados = t.match(/\+?\d[\d\s\-.()]{0,10}[X#*?]{2,4}[\dX#*?\s\-.()]{0,14}/gi) || [];
  return mascarados.some((m) => {
    const corpo = m.replace(/[^\dX#*?]/gi, '');
    return /[X#*?]/i.test(corpo) && corpo.length >= 6;
  });
}

// ─── Factos que a IA NÃO pode inventar ──────────────────────────────────────
// Políticas REAIS (confirmadas pelo dono): entrega PAGA por zona (Kilamba 500,
// Viana 3000...), 1 dia para verificar, SÓ TROCA (não devolve dinheiro),
// factura sempre, entrega <24h em Luanda. Promessa diferente = o cliente cobra.
const PADROES_PROIBIDOS = [
  { nome: 'desconto/percentagem inventada', re: /\b\d{1,3}\s?%\s*(de\s*)?(desconto|off|redu[çc])/i },
  { nome: 'promoção numérica inventada', re: /\b(promo[çc][ãa]o|liquida[çc][ãa]o|saldo)s?\b[^.!?\n]{0,30}\b\d/i },
  // 13-Ago: cortava a VERDADE "levantar em pessoa sem pagares nada de entrega
  // (0 Kz)" — o levantamento no armazém é grátis (zona a 0 Kz, confirmado pelo
  // dono). A excepção abre para o contexto de LEVANTAMENTO; entrega ao
  // domicílio grátis continua a ser cortada, porque essa é mesmo falsa.
  { nome: 'entrega grátis (falso: há taxa por zona)', re: /\b(entrega|frete|envio|transporte)\b[^.!?\n]{0,20}\b(gr[áa]tis|gratuit|de gra[çc]a|sem custo|0\s?kz)/i,
    excecao: /\b(levanta\w+|armaz[ée]m|em pessoa|buscar|recolher|passar (c[áa]|a[íi]|na loja))\b/i },
  { nome: 'brinde/oferta grátis inventada', re: /\b(brinde|oferta|extra|b[óo]nus)\b[^.!?\n]{0,20}\b(gr[áa]tis|gratuit|de gra[çc]a)/i },
  // A política REAL é "1 dia para verificar" → esse prazo é verdade e passa.
  // Qualquer outro prazo de garantia (7 dias, 30 dias, 1 ano) é invenção.
  { nome: 'prazo de garantia inventado', re: /garantia\b[^.!?\n]{0,25}\b\d+\s*(dia|semana|m[êe]s|mes|ano)/i,
    excecao: /\b1\s*dia\b|\bum\s*dia\b/i },
  // A loja só TROCA. Dizer "não devolvemos dinheiro, trocamos" é a verdade e deve
  // passar; prometer devolução é que é proibido. Distingue-se pela negação.
  // A negação tem de vir IMEDIATAMENTE antes do verbo (até 2 palavras no meio),
  // senão "Reembolsamos… se não gostares" passava por causa do "não" solto.
  { nome: 'devolução/reembolso prometido (real: só troca)', re: /\b(devolu[çc]|devolv|reembols|dinheiro de volta|money back)/i,
    excecao: /\b(n[ãa]o|nunca|sem)\s+(\w+\s+){0,2}(devolu[çc]|devolv|reembols|dinheiro de volta)|\b(s[óo]|apenas)\s+troca|em\s+vez\s+de\s+(\w+\s+){0,2}(devolu[çc]|reembols|dinheiro)/i },
  // "Só troca" é a política confirmada. O tipo de artigo recebido na troca
  // (igual, equivalente, à escolha, novo) ainda NÃO foi confirmado pelo dono.
  { nome: 'condição de troca inventada', re: /\btroc(?:a|amos|ar|amos-te)\b[^.!?\n]{0,35}\b(por|pelo)\s+(?:(?:um|uma|outro|outra|o|a)\s+)?(?:(?:produto|artigo)\s+)?(?:igual|equivalente|novo|[àa]\s+escolha)\b/i },
  // Alegação comercial absoluta que cria uma garantia implícita. Pagamento na
  // entrega é verdade; dizer que por isso a compra é "sem risco" não está
  // confirmado e pode induzir o cliente em erro.
  // "sem risco" é permitido QUANDO vem com o mecanismo real que o justifica
  // (pagar na entrega, 1 dia para verificar, troca). Sem esta excepção a guarda
  // apagava o argumento de venda mais forte da loja — e é verdade confirmada.
  // 11-Ago: a excepção exigia as palavras EXACTAS "receber"/"chegar" e o bot
  // escreve conjugado. "pagas quando receberes, sem risco!" era apagado por
  // inteiro — a frase ficava vazia — e foi entregue assim a um cliente real
  // (User_4514968705449615, 14-Jul 18:11). É o mesmo erro de 06-Ago noutra
  // conjugação. Radicais em vez de palavras fechadas; isto só ABRE a porta,
  // nunca fecha: nada do que hoje passa pode passar a ser cortado.
  { nome: 'promessa de compra sem risco', re: /\b(sem|zero|nenhum)\s+risco\b|\bn[ãa]o\s+(?:tens?|há|existe)\s+risco\b/i,
    excecao: /\bpag(a\w*|ar\w*|amento)\b[^.!?\n]{0,45}\b(entrega\w*|receb\w+|cheg\w+|m[ãa]os?)\b|\b1\s*dia\b|\btroca(mos)?\b/i },
  // 13-Ago (Feliciano Pascoal): depois de escalar, o bot disse "Já estou aqui
  // com o responsável" e "o dono já está a confirmar os detalhes contigo agora
  // mesmo" — MENTIRA sobre a presença do dono, com o cliente irritado à espera
  // de alguém que não estava lá. A verdade permitida é "foi avisado / responde
  // logo que puder" (a excepção abre para essa forma).
  { nome: 'presença do dono inventada (só "foi avisado" é verdade)',
    re: /\bj[áa] est(ou|[áa])\s+(aqui\s+)?com o (dono|respons[áa]vel|chefe)\b|\bo (dono|respons[áa]vel|chefe)( j[áa])? (est[áa] (aqui|a confirmar|a ver|contigo)|vem j[áa]|j[áa] vem)\b/i,
    excecao: /\b(foi|j[áa] foi)\s+(avisad|notificad)|\bvai responder\b|\bresponde-te\b|\blogo que puder\b|\bentrar[áa] em contacto\b/i },
  { nome: 'prazo de entrega inventado (real: <24h Luanda)', re: /\b(entrega|chega)\b[^.!?\n]{0,20}\b(\d+\s*(a|-)\s*\d+\s*dias|\d+\s*(semana|m[êe]s))/i },
  // O dono autorizou o bot a OFERECER encomenda (10-Ago) mas o prazo é dele: o
  // padrão acima só apanha "entrega/chega", e "a encomenda demora 7 a 10 dias"
  // passava-lhe ao lado. Um prazo inventado numa encomenda é pior do que numa
  // entrega — o cliente espera semanas por algo que ninguém prometeu de facto.
  { nome: 'prazo de encomenda inventado (só o dono o diz)',
    re: /\b(encomend\w+|encomendar)\b[^.!?\n]{0,40}\b(\d+\s*(a|-|até)\s*\d+\s*(dias?|semanas?|m[êe]s(es)?)|\d+\s*(dias?|semanas?|m[êe]s(es)?))/i },
  // idem para o valor do sinal: pode dizer QUE leva sinal, não QUANTO.
  // ⚠️ SEM a palavra "entrada": aqui "entrada" é quase sempre um CONECTOR
  // ("microfone com entrada USB-C, 17.000 Kz") e o padrão cortava a frase que
  // apresentava o produto alternativo com o preço — a parte mais útil da
  // resposta. Apanhado a 10-Ago, no primeiro teste real depois de o escrever.
  // Mesma família do "brinco" = earbuds: o vocabulário local manda.
  { nome: 'valor de sinal inventado (só o dono o diz)',
    re: /\b(sinal|adiantament\w+)\b[^.!?\n]{0,30}\b(\d{1,3}\s?%|\d{1,3}[\s.]?\d{3}\s*kz)/i },
  { nome: 'stock inventado', re: /\b(stock|estoque)\b[^.!?\n]{0,15}\b(ilimitado|infinito|sempre dispon)/i },
  // ⚠️ PEDIR a morada ao cliente NÃO é inventar a nossa. Sem esta excepção, a
  // guarda apagava a mensagem que recolhe os dados da encomenda — exactamente o
  // passo que fecha a venda (apanhado a 6-Ago, com a resposta a ser censurada).
  // ⚠️ SEM \b no fim: com ele, "Rua X, nº 45" NUNCA era apanhado — o `\b` exigia
  // fronteira depois do "º", que é não-palavra tal como o espaço seguinte.
  // A guarda tinha este buraco desde sempre; só apareceu ao testá-la a sério.
  { nome: 'endereço físico inventado', re: /\b(rua|avenida|av\.|bairro)\s+[A-Z][\w\s]{3,30},?\s*(n[.º°]|nº|\d{1,4})/i,
    // "em qualquer bairro de Luanda em menos de 24 horas" casava com o padrão
    // (bairro + palavras + número) e era apagado — sendo política confirmada.
    excecao: /\b(teu|tua|teus|tuas|preciso|precisamos|manda|envia|diz-me|indica|confirma|qual [ée])\b|\bqualquer\b|\bmenos de\b|\bhoras?\b|\bminutos?\b/i },
];

/**
 * Remove frases com factos inventados. opts:
 *   - permitirPreco (bool) e precosValidos ([n]) → preços fora da lista apagados
 *   - onRemove(nome, frase) → log/alerta
 */
function sanitizarFactos(texto, opts) {
  if (!texto) return texto;
  const o = opts || {};
  const avisar = typeof o.onRemove === 'function' ? o.onRemove : () => {};
  // parte em frases só quando o ponto é seguido de espaço/fim (não parte
  // "3.500 Kz", "superloja.vip" nem emails)
  const partes = String(texto).split(/(?<=[.!?])(?=\s)|(?<=\n)/);
  const mantidas = partes.filter((frase) => {
    const f = frase.trim();
    if (!f) return true;
    for (const p of PADROES_PROIBIDOS) {
      // `excecao`: a política REAL da loja usa palavras que também aparecem nas
      // invenções ("garantia de 1 dia", "não devolvemos dinheiro, só trocamos").
      // Sem esta porta, a guarda censurava a verdade e o cliente ficava sem resposta.
      if (p.re.test(f) && !(p.excecao && p.excecao.test(f))) { avisar(p.nome, f); return false; }
    }
    // A classe [\d.,\s] aceita espaços, por isso o número do NOME do produto
    // colava-se ao preço seguinte: "X83 9.500 Kz" era lido como 839.500 Kz.
    // Acontece com o campeão de vendas da loja (X83) e com "Galaxy S24 4.500 Kz",
    // "Hy-T05 11.500 Kz". Com `precosValidos` ligado — como está nas captions
    // (dashboard.js) — isso é um preço que não existe em lista nenhuma e a frase
    // com os preços TODOS certos era apagada. Fronteira à esquerda: o preço não
    // pode vir imediatamente a seguir a outro dígito.
    const precos = f.match(/(?<![\d])\d[\d.,]{0,9}\s*(?:kz|aoa|kwanzas?)\b/gi) || [];
    if (precos.length) {
      if (o.permitirPreco === false) { avisar('preço na caption (diretiva diz para não pôr)', f); return false; }
      if (Array.isArray(o.precosValidos) && o.precosValidos.length) {
        const validos = o.precosValidos.map(Number);
        const inventado = precos.some((s) => {
          const n = Number(String(s).replace(/[^\d]/g, ''));
          return !validos.some((v) => Math.abs(v - n) < 1);
        });
        if (inventado) { avisar('preço inventado (não está no catálogo)', f); return false; }
      }
    }
    return true;
  });
  return mantidas.join('').replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Guarda completa: contactos + factos. É esta que deve ser usada por defeito. */
function sanitizarTexto(texto, opts) {
  return sanitizarFactos(sanitizarContactos(texto), opts);
}

/**
 * Texto destinado a post/anuncio: alem da guarda normal, GARANTE que o contacto
 * oficial fica visivel e clicavel. E idempotente para nao duplicar o CTA quando
 * um job e repetido. Nunca usar em respostas normais do bot (nao faz sentido
 * terminar cada mensagem ao cliente com o proprio numero da loja).
 */
function sanitizarAnuncio(texto, opts) {
  let t = sanitizarTexto(texto, opts);
  const temNumero = /(?:\+?244[\s.\-]*)?954[\s.\-]*949[\s.\-]*595\b/.test(t);
  const temLink = /https?:\/\/wa\.me\/244954949595\b/i.test(t);
  const extras = [];
  if (!temNumero) extras.push('📲 WhatsApp SuperLoja: ' + WHATSAPP_FMT);
  if (!temLink) extras.push(WHATSAPP_LINK);
  if (extras.length) t = (t ? t.trim() + '\n\n' : '') + extras.join('\n');
  return t;
}

module.exports = { sanitizarContactos, sanitizarFactos, sanitizarTexto, sanitizarAnuncio,
  temContactoEstranho, PADROES_PROIBIDOS, WHATSAPP_FMT, WHATSAPP_DIGITOS, WHATSAPP_LINK };
