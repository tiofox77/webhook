/**
 * creative-caption.js — captions criativas para os posts: "Fugu pensa, Haiku escreve".
 *
 * A Fugu gera semanalmente um BANCO DE IDEIAS criativas (ângulos/ganchos) com base
 * nos dados reais — fica em data/creative-briefs.json (gerado pelo dashboard,
 * POST /api/creative-briefs/rebuild). Este módulo:
 *   - nextBrief(formato): tira a próxima ideia do banco (rotação persistida)
 *   - aiCaption(produtos, formato, dir): Haiku (AISA) escreve a caption final
 *     no ângulo da ideia, respeitando as diretivas de aprendizagem.
 *     Devolve NULL se algo falhar → quem chama usa o template clássico (fallback).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const guard = require('./text-guard.js');

const DATA_DIR = process.env.DATA_DIR || 'C:/superloja/data';
const BRIEFS_FILE = path.join(DATA_DIR, 'creative-briefs.json');
const AI_CONFIG = path.join(DATA_DIR, 'ai-config.json');

function loadBriefs() {
  try { return JSON.parse(fs.readFileSync(BRIEFS_FILE, 'utf8')); } catch { return null; }
}

// Próxima ideia (rotação persistida; prefere ideias do formato pedido)
function nextBrief(formato) {
  const db = loadBriefs();
  if (!db || !Array.isArray(db.ideias) || !db.ideias.length) return null;
  const doFormato = db.ideias.filter(i => !i.formato || i.formato === 'qualquer' || i.formato === formato);
  const pool = doFormato.length ? doFormato : db.ideias;
  const idx = (db.proxIdx || 0) % pool.length;
  db.proxIdx = (db.proxIdx || 0) + 1;
  try { fs.writeFileSync(BRIEFS_FILE, JSON.stringify(db, null, 2), 'utf8'); } catch {}
  return pool[idx];
}

function aisaChat(prompt, maxTokens) {
  return new Promise((resolve) => {
    let cfg; try { cfg = JSON.parse(fs.readFileSync(AI_CONFIG, 'utf8')); } catch { resolve(null); return; }
    if (!cfg.apiKey) { resolve(null); return; }
    const payload = JSON.stringify({ model: cfg.model || 'claude-haiku-4-5-20251001', max_tokens: maxTokens || 400, messages: [{ role: 'user', content: prompt }] });
    const req = https.request({ hostname: 'api.aisa.one', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey, 'Content-Length': Buffer.byteLength(payload) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { const j = JSON.parse(d); resolve((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || null); }
        catch (e) { resolve(null); }
      }); });
    req.on('error', () => resolve(null));
    req.setTimeout(25000, () => { req.destroy(); resolve(null); });
    req.write(payload); req.end();
  });
}

/**
 * Caption criativa. produtos: [{name, price}...]; formato: single|carousel|stories|reels;
 * dir: diretivas do insights (precoNaCaption, estiloCaption, incluirPergunta, evitar).
 * Devolve string (SÓ o corpo — sem CTA/hashtags, quem chama junta) ou null (fallback).
 */
async function aiCaption(produtos, formato, dir) {
  try {
    const ideia = nextBrief(formato);
    const d = dir || {};
    const nomes = (produtos || []).map(p => p.name).filter(Boolean).slice(0, 9);
    if (!nomes.length) return null;
    const regras = [
      'português de Angola, tratamento por "tu"',
      '2-4 linhas curtas, emojis com moderação',
      (d.precoNaCaption === false ? 'NUNCA menciones preços (vão na imagem)' : 'podes mencionar preço como âncora'),
      (d.incluirPergunta ? 'termina com uma PERGUNTA que gere comentários' : 'termina com frase de fecho forte'),
      'NÃO uses asteriscos/markdown', 'NÃO inventes especificações nem promoções',
      // O CTA com o contacto REAL é acrescentado pelo código depois desta caption.
      // Sem esta proibição o modelo inventava números (ex.: "+244 923 456 789").
      'PROIBIDO escrever números de telefone, contactos, WhatsApp ou links — são adicionados automaticamente depois. O único número da loja é ' + guard.WHATSAPP_FMT + ', mas NÃO o escrevas.',
      (Array.isArray(d.evitar) && d.evitar.length ? 'EVITA: ' + d.evitar.join('; ') : '')
    ].filter(Boolean).join('\n- ');
    const prompt =
      'Escreve APENAS o corpo de uma caption de ' + formato + ' para a SuperLoja (eletrónica, Luanda).\n' +
      (ideia ? 'ÂNGULO CRIATIVO OBRIGATÓRIO (ideia da estratega): "' + (ideia.angulo || '') + '"' +
        (ideia.gancho ? ' — gancho sugerido: "' + ideia.gancho + '"' : '') + '\n' : '') +
      'PRODUTO(S): ' + nomes.join(', ') + '\n' +
      'REGRAS:\n- ' + regras + '\n' +
      'Responde SÓ com o texto da caption, sem aspas nem explicações.';
    const out = await aisaChat(prompt, 300);
    if (!out) return null;
    let limpo = String(out).trim().replace(/^["']|["']$/g, '').replace(/\*+/g, '');
    // GUARDA determinística: remove contactos/links/emails inventados e frases
    // com factos falsos (descontos, entrega grátis, garantias, prazos, preços
    // fora do catálogo). Corre SEMPRE — o prompt pede, a guarda garante.
    limpo = guard.sanitizarTexto(limpo, {
      permitirPreco: d.precoNaCaption !== false,
      precosValidos: (produtos || []).map(p => Number(p.price)).filter(n => n > 0),
      onRemove: (motivo, frase) => console.log('[Caption] GUARDA removeu (' + motivo + '): "' + String(frase).slice(0, 60) + '"')
    });
    // sanidade: nem vazio nem um ensaio (se a guarda cortou demasiado → fallback)
    if (limpo.length < 20 || limpo.length > 600) return null;
    return limpo;
  } catch { return null; }
}

module.exports = { aiCaption, nextBrief, loadBriefs };
