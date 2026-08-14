// Testa as peças puras das correcções, com o MESMO código que ficou no ficheiro.
const fs = require('fs');
const src = fs.readFileSync('C:/superloja/webhook-server/messenger-chatbot.js', 'utf8');
let falhas = 0;
const ok = (nome, cond, extra) => { console.log((cond ? 'OK   ' : 'FALHA') + ' | ' + nome + (cond ? '' : '  → ' + extra)); if (!cond) falhas++; };

// ── 1. mimeReal: extraída do ficheiro real, não reescrita ─────────────────────
const mMime = src.match(/function mimeReal\(buf, fallback\) \{[\s\S]*?\n\}/);
eval(mMime[0]);
ok('JPEG real declarado como PNG → corrige', mimeReal(Buffer.from([0xFF,0xD8,0xFF,0xE0,0,0,0,0,0,0,0,0]), 'image/png') === 'image/jpeg');
ok('PNG real → PNG', mimeReal(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,0]), 'image/jpeg') === 'image/png');
ok('GIF real → GIF', mimeReal(Buffer.from('GIF89a______', 'latin1'), 'image/jpeg') === 'image/gif');
ok('WEBP real → WEBP', mimeReal(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'image/png') === 'image/webp');
ok('bytes desconhecidos → fallback', mimeReal(Buffer.from('nada disto aqui', 'latin1'), 'image/png') === 'image/png');
ok('buffer curto não rebenta', mimeReal(Buffer.from([1,2]), 'image/jpeg') === 'image/jpeg');

// ── 2. Normalização do content (o caso que deixava o cliente em silêncio) ─────
const norm = (bruto) => Array.isArray(bruto)
  ? bruto.map(b => (typeof b === 'string' ? b : (b && (b.text || b.content)) || '')).filter(Boolean).join('\n').trim()
  : (typeof bruto === 'string' ? bruto : '');
ok('string normal passa igual', norm('Olá! Temos sim.') === 'Olá! Temos sim.');
ok('array de blocos Anthropic → texto', norm([{ type: 'text', text: 'Temos sim' }, { type: 'text', text: '17.000 Kz' }]) === 'Temos sim\n17.000 Kz');
ok('array de strings → texto', norm(['a', 'b']) === 'a\nb');
ok('objecto estranho → vazio (aciona reserva)', norm({ weird: 1 }) === '');
ok('null → vazio (aciona reserva)', norm(null) === '');
ok('array vazio → vazio (aciona reserva)', norm([]) === '');

// ── 3. valePenaReserva: os 2 casos reais do log passam a accionar a cadeia ────
const mSaldo = src.match(/function semSaldoOuAuth\(err\) \{[\s\S]*?\n\}/);
const mVale = src.match(/function valePenaReserva\(err\) \{[\s\S]*?\n\}/);
eval(mSaldo[0]); eval(mVale[0]);
ok('30-Jul: HTTP 400 image media type → reserva', valePenaReserva(new Error('HTTP 400 messages.4.content.1.image.source.base64: The image was specified using the image/png media type, but the image appears to be a image/jpeg image')));
ok('07-Ago: HTTP 400 Could not process image → reserva', valePenaReserva(new Error('HTTP 400 Could not process image')));
ok('DNS em baixo (Luanda) → reserva', valePenaReserva(new Error('getaddrinfo ENOTFOUND api.aisa.one')));
ok('socket hang up → reserva', valePenaReserva(new Error('socket hang up')));
ok('ECONNRESET → reserva', valePenaReserva(new Error('read ECONNRESET')));
ok('402 sem saldo (o caso original) → reserva', valePenaReserva(new Error('HTTP 402 insufficient wallet balance')));
ok('TIMEOUT continua FORA de propósito', valePenaReserva(new Error('timeout IA')) === false, 'não pode accionar: 45s+reserva é esperar demais');

// ── 4. Marcador órfão (corte por max_tokens na cauda) ─────────────────────────
const limpar = (t) => t.replace(/<<[A-Z]+>>[\s\S]*$/, '').trim();
const cortado = 'Perfeito, Helder! Fica registado. 🎉\n<<PEDIDO>>{"nome":"Helder Maka","telefone":"9428';
ok('encomenda cortada não vaza dados ao cliente', limpar(cortado) === 'Perfeito, Helder! Fica registado. 🎉');
ok('sem telefone do cliente no que sai', !limpar(cortado).includes('9428'));
ok('resposta normal fica intacta', limpar('Temos sim, 17.000 Kz. Queres que reserve? 😊') === 'Temos sim, 17.000 Kz. Queres que reserve? 😊');
ok('setas do cliente (<<) minúsculas não são tocadas', limpar('era <<isto>> que querias?') === 'era <<isto>> que querias?');

console.log('\n' + (falhas ? falhas + ' FALHAS' : 'todos passaram'));
process.exit(falhas ? 1 : 0);
