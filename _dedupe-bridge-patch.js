// Remove as cópias duplicadas do patch de reply no bridge.js (ficou 3× porque
// o marcador do ensure-bridge-patch.js tinha caixa errada e nunca casava).
const fs = require('fs');
const path = require('path');
const BRIDGE = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\fox\\AppData\\Local',
  'hermes', 'hermes-agent', 'scripts', 'whatsapp-bridge', 'bridge.js');

let src = fs.readFileSync(BRIDGE, 'utf8');
fs.writeFileSync(BRIDGE + '.bak-antes-dedupe', src, 'utf8');

// O bloco completo do patch, tal como o ensure o insere (sem o "if (!text.trim()) {"
// final que pertence ao código original).
const BLOCO =
`    // PATCH LOCAL: se o cliente RESPONDEU a uma mensagem nossa (reply/quote),
    // juntar o texto citado. Sem isto "quero esse" chegava ao bot sem contexto e
    // ele reenviava fotos ao calhas (conversa da Joelma, 27-Jul).
    try {
      const ctx = mc?.extendedTextMessage?.contextInfo || mc?.imageMessage?.contextInfo
               || mc?.videoMessage?.contextInfo || mc?.audioMessage?.contextInfo;
      const q = ctx?.quotedMessage;
      if (q) {
        const qt = q.conversation || q.extendedTextMessage?.text
                || q.imageMessage?.caption || q.videoMessage?.caption
                || (q.imageMessage ? '[foto sem legenda]' : q.documentMessage?.fileName || '');
        if (qt) text = '[o cliente respondeu a ESTA tua mensagem: "' + String(qt).slice(0, 180) + '"] ' + text;
      }
    } catch {}
`;

let n = 0;
let pos = 0;
while ((pos = src.indexOf(BLOCO, pos)) !== -1) { n++; pos += BLOCO.length; }
console.log('cópias do bloco encontradas: ' + n);
if (n <= 1) { console.log('nada a remover.'); process.exit(0); }

// manter a PRIMEIRA, remover as restantes
const primeira = src.indexOf(BLOCO);
const antes = src.slice(0, primeira + BLOCO.length);
let resto = src.slice(primeira + BLOCO.length);
let removidas = 0;
while (resto.includes(BLOCO)) { resto = resto.replace(BLOCO, ''); removidas++; }
src = antes + resto;
fs.writeFileSync(BRIDGE, src, 'utf8');
console.log('removidas: ' + removidas + ' cópia(s). Ficou 1.');

// verificação: quantas vezes o prefixo aparece agora
const m = (src.match(/respondeu a ESTA tua mensagem/g) || []).length;
console.log('ocorrências de "respondeu a ESTA tua mensagem" no ficheiro: ' + m + ' (1 é o correcto)');
process.exit(m === 1 ? 0 : 1);
