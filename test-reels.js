#!/usr/bin/env node
/**
 * test-reels.js — Gera vídeos reel de teste com:
 *   - Rotação de estilos/áudio partilhada com auto-poster-v4.js (sem repetição)
 *   - Logo superloja.vip via overlay de imagem PNG
 *   - Transições xfade suaves e variadas entre frames
 *
 * Uso: node test-reels.js [num_produtos] [num_reels]
 * Output: C:\superloja\data\reels-teste\
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || 'C:\\superloja\\data';
const AUDIO_DIR  = __dirname + '/audio_library';
const OUTPUT_DIR = path.join(DATA_DIR, 'reels-teste');
const TMP_DIR    = path.join(DATA_DIR, 'img_cache');

const AUDIO_STATE_FILE = path.join(DATA_DIR, 'audio-state.json');
const REEL_STATE_FILE  = path.join(DATA_DIR, 'reel-state.json');
const LOGO_PATH        = path.join(TMP_DIR, 'logo.png');
const LOGO_URL         = 'https://superloja.vip/favicon.ico';

const TRANS_DURATION = 0.4; // segundos de sobreposição entre frames

// Transições variadas — rodam por frame
const TRANSITIONS = [
  'fade', 'dissolve', 'slideleft', 'slideright',
  'wipeleft', 'fadeblack', 'wiperight', 'circlecrop',
];

const REEL_STYLES = [
  { id: 0, name: 'Portrait_Fast',      w: 1080, h: 1920, spf: 1.5 },
  { id: 1, name: 'Square_Standard',    w: 1080, h: 1080, spf: 2.0 },
  { id: 2, name: 'Portrait_Cinematic', w: 1080, h: 1920, spf: 3.0 },
];

const REEL_INTROS = [
  'Ofertas imperdíveis na Superloja!',
  'Tecnologia acessível em Angola!',
  'Os melhores preços de Luanda!',
  'Stock limitado — aproveita já!',
  'Qualidade premium, preço justo!',
  'Entrega rápida em Luanda!',
];

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR,    { recursive: true });

// ─── ffmpeg ───────────────────────────────────────────────────────────────────
function findFfmpeg() {
  const candidates = [
    'C:\\Users\\fox\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try { return execSync('where ffmpeg', { stdio: ['ignore','pipe','ignore'] }).toString().split(/\r?\n/)[0].trim(); } catch (_) {}
  return 'ffmpeg';
}

// ─── Path POSIX para ffmpeg ───────────────────────────────────────────────────
const p = (s) => s.replace(/\\/g, '/');

// ─── Download ─────────────────────────────────────────────────────────────────
function download(url, dest) {
  try {
    execSync(`curl -L -s -o "${p(dest)}" "${url}"`, { timeout: 30000 });
    const buf = fs.readFileSync(dest);
    if (buf.length < 500) throw new Error(`Ficheiro muito pequeno (${buf.length}B)`);
    return true;
  } catch (e) {
    console.log(`  ⚠️  Download falhou ${url.slice(-50)}: ${e.message}`);
    return false;
  }
}

// ─── Logo PNG ─────────────────────────────────────────────────────────────────
function ensureLogo(ff) {
  if (fs.existsSync(LOGO_PATH)) {
    const b = fs.readFileSync(LOGO_PATH);
    if (b[0] === 0x89 && b[1] === 0x50 && b.length > 500) {
      console.log('  🖼️  Logo: cache OK');
      return LOGO_PATH;
    }
  }
  console.log('  🖼️  Logo: a descarregar...');
  const ico = path.join(TMP_DIR, '_fav.ico');
  if (!download(LOGO_URL, ico)) return null;
  try {
    execSync(`"${ff}" -y -i "${p(ico)}" -update 1 -frames:v 1 "${p(LOGO_PATH)}"`, { timeout: 15000, stdio: 'pipe' });
    const b = fs.readFileSync(LOGO_PATH);
    if (b[0] === 0x89 && b[1] === 0x50) {
      console.log('  🖼️  Logo: ICO→PNG OK');
      try { fs.unlinkSync(ico); } catch (_) {}
      return LOGO_PATH;
    }
  } catch (_) {}
  console.log('  ⚠️  Logo: falhou — watermark de texto');
  return null;
}

// ─── Audio rotation (Fisher-Yates, sem repetição) ─────────────────────────────
function nextAudio() {
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  if (!files.length) return null;
  let state = { queue: [], lastUsed: null };
  try { if (fs.existsSync(AUDIO_STATE_FILE)) state = JSON.parse(fs.readFileSync(AUDIO_STATE_FILE, 'utf8')); } catch (_) {}
  if (!state.queue.length) {
    const s = [...files];
    for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [s[i],s[j]]=[s[j],s[i]]; }
    if (s.length > 1 && s[0] === state.lastUsed) s.push(s.shift());
    state.queue = s;
  }
  const chosen = state.queue.shift();
  state.lastUsed = chosen;
  fs.writeFileSync(AUDIO_STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`  🎵 Áudio: ${chosen} (${state.queue.length} na fila)`);
  return path.join(AUDIO_DIR, chosen);
}

// ─── Reel config rotation ─────────────────────────────────────────────────────
function nextReelConfig() {
  let state = { styleIdx: 0, introIdx: 0, count: 0 };
  try { if (fs.existsSync(REEL_STATE_FILE)) state = JSON.parse(fs.readFileSync(REEL_STATE_FILE, 'utf8')); } catch (_) {}
  const style = REEL_STYLES[state.styleIdx % REEL_STYLES.length];
  const intro = REEL_INTROS[state.introIdx % REEL_INTROS.length];
  state.styleIdx++; state.introIdx++; state.count++;
  fs.writeFileSync(REEL_STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`  🎬 Estilo: ${style.name} (${style.w}x${style.h}, ${style.spf}s/frame)`);
  console.log(`  💬 Intro: "${intro}"`);
  return { style, intro };
}

// ─── Criar reel MP4 ──────────────────────────────────────────────────────────
async function createReel(products, audioPath, style, logoPath, outputPath) {
  const { w, h, spf, name } = style;
  const ts       = Date.now();
  const tmpDir   = path.join(TMP_DIR, 'frames_' + ts);
  const step1Out = path.join(tmpDir, 'step1.mp4'); // slideshow + xfade
  const step2Out = path.join(tmpDir, 'step2.mp4'); // + logo
  fs.mkdirSync(tmpDir, { recursive: true });

  const ff = findFfmpeg();

  // 1. Download frames
  console.log(`  ⬇️  ${products.length} imagens...`);
  const frames = [];
  for (let i = 0; i < products.length; i++) {
    const imgRaw = products[i].images?.[0] || products[i].image || '';
    const imgUrl = imgRaw.startsWith('http') ? imgRaw : ('https://superloja.vip' + imgRaw);
    const dest   = path.join(tmpDir, `f${String(i).padStart(3,'0')}.jpg`);
    const ok = download(imgUrl, dest);
    console.log(`    [${i+1}/${products.length}] ${ok ? '✅' : '⚠️ '} ${products[i].name?.slice(0,35)}`);
    if (ok) frames.push(dest);
  }
  if (!frames.length) throw new Error('Nenhuma imagem disponível');

  const N = frames.length;
  const totalDur = (N * spf - (N - 1) * TRANS_DURATION).toFixed(3);

  // ── STEP 1: Slideshow com xfade ──────────────────────────────────────────
  // Cada frame é um input com -loop 1. O filtergraph é escrito num ficheiro
  // para evitar problemas de quoting no shell.
  console.log(`  🖼️  Step 1: ${N} frames + xfade transitions (${name})...`);

  // Construir filtergraph
  const fg = [];

  // Scale + pad + setsar cada input
  for (let i = 0; i < N; i++) {
    fg.push(
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `setsar=1,format=yuv420p[s${i}]`
    );
  }

  // Encadear xfade
  let prev = 's0';
  for (let i = 0; i < N - 1; i++) {
    const trans  = TRANSITIONS[i % TRANSITIONS.length];
    const offset = (i * (spf - TRANS_DURATION)).toFixed(3);
    const out    = i === N - 2 ? 'vout' : `x${i}`;
    fg.push(`[${prev}][s${i+1}]xfade=transition=${trans}:duration=${TRANS_DURATION}:offset=${offset}[${out}]`);
    prev = out;
  }
  if (N === 1) {
    // Sem xfade: renomear s0→vout
    fg.push(`[s0]null[vout]`);
  }

  // Escrever filtergraph em ficheiro (evita quoting hell no Windows)
  const fgFile = path.join(tmpDir, 'fg1.txt');
  fs.writeFileSync(fgFile, fg.join(';\n'));

  // Inputs: cada frame como -loop 1 com duração = spf + margem
  const inputs = frames.map(f =>
    `-loop 1 -t ${(spf + TRANS_DURATION).toFixed(3)} -i "${p(f)}"`
  ).join(' ');

  const cmd1 = `"${ff}" -y ${inputs} -filter_complex_script "${p(fgFile)}" -map "[vout]" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -t ${totalDur} "${p(step1Out)}"`;

  execSync(cmd1, { timeout: 300000, stdio: 'pipe' });
  const sz1 = fs.statSync(step1Out).size;
  if (sz1 < 50000) throw new Error(`Step 1 muito pequeno: ${sz1}B`);
  console.log(`  ✅ Step 1 OK (${(sz1/1024/1024).toFixed(1)}MB)`);

  // ── STEP 2: Logo overlay ──────────────────────────────────────────────────
  let videoForAudio = step1Out;

  if (logoPath && fs.existsSync(logoPath)) {
    console.log('  🖼️  Step 2: overlay logo...');
    const logoW = Math.round(w * 0.16); // 16% da largura
    const fgLogo = [
      `[1:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=0.88[logo]`,
      `[0:v][logo]overlay=W-w-24:H-h-24[vout]`
    ].join(';\n');
    const fgLogoFile = path.join(tmpDir, 'fg_logo.txt');
    fs.writeFileSync(fgLogoFile, fgLogo);

    const cmd2 = `"${ff}" -y -i "${p(step1Out)}" -i "${p(logoPath)}" -filter_complex_script "${p(fgLogoFile)}" -map "[vout]" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${p(step2Out)}"`;
    try {
      execSync(cmd2, { timeout: 120000, stdio: 'pipe' });
      const sz2 = fs.statSync(step2Out).size;
      console.log(`  ✅ Step 2 logo OK (${(sz2/1024/1024).toFixed(1)}MB)`);
      videoForAudio = step2Out;
    } catch (e) {
      console.log('  ⚠️  Logo overlay falhou — sem logo');
    }
  } else {
    // Fallback: drawtext com nome da marca
    console.log('  🖼️  Step 2: watermark texto...');
    const sz = Math.round(h * 0.035);
    const wm = `drawtext=text='superloja.vip':fontcolor=white:fontsize=${sz}:box=1:boxcolor=black@0.55:boxborderw=6:x=w-tw-20:y=h-th-20`;
    const cmd2 = `"${ff}" -y -i "${p(step1Out)}" -vf "${wm}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${p(step2Out)}"`;
    try {
      execSync(cmd2, { timeout: 120000, stdio: 'pipe' });
      videoForAudio = step2Out;
    } catch (e) {
      console.log('  ⚠️  Watermark falhou — usando vídeo sem marca');
    }
  }

  // ── STEP 3: Mux áudio ────────────────────────────────────────────────────
  if (audioPath && fs.existsSync(audioPath)) {
    console.log(`  🎵 Step 3: muxing ${path.basename(audioPath)}...`);
    const cmd3 = `"${ff}" -y -stream_loop -1 -i "${p(videoForAudio)}" -stream_loop -1 -i "${p(audioPath)}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 128k -t ${totalDur} "${p(outputPath)}"`;
    try {
      execSync(cmd3, { timeout: 120000, stdio: 'pipe' });
      console.log('  ✅ Step 3 áudio OK');
    } catch (e) {
      console.log('  ⚠️  Mux áudio falhou — sem áudio');
      fs.copyFileSync(videoForAudio, outputPath);
    }
  } else {
    fs.copyFileSync(videoForAudio, outputPath);
  }

  // Limpar tmp
  try { fs.readdirSync(tmpDir).forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {} }); fs.rmdirSync(tmpDir); } catch (_) {}

  const finalSz = fs.statSync(outputPath).size;
  const finalMB = (finalSz / 1024 / 1024).toFixed(2);
  console.log(`  💾 ${path.basename(outputPath)} (${finalMB}MB, ${totalDur}s)`);
  return outputPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const numProds  = parseInt(process.argv[2], 10) || 5;
  const numReels  = parseInt(process.argv[3], 10) || 3;

  console.log('═'.repeat(64));
  console.log('🎬  SUPERLOJA — Gerador de Reels de Teste v2');
  console.log(`📁  ${OUTPUT_DIR}`);
  console.log(`📦  ${numProds} produtos/reel  |  🎬 ${numReels} reels`);
  console.log('═'.repeat(64));

  const ff = findFfmpeg();
  const logoPath = ensureLogo(ff);

  const cache    = JSON.parse(fs.readFileSync(path.join(__dirname, 'products-cache.json'), 'utf8'));
  const allProds = cache.products || cache;

  // Índice actual (leitura sem avançar em modo teste)
  let startIdx = 0;
  const idxFile = path.join(DATA_DIR, '.product_index');
  try { startIdx = parseInt(fs.readFileSync(idxFile, 'utf8').trim(), 10) || 0; } catch (_) {}

  const results = [];

  for (let r = 0; r < numReels; r++) {
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`🎬  Reel ${r + 1}/${numReels}`);

    const { style } = nextReelConfig();
    const audioPath  = nextAudio();

    // Produtos sequenciais (offset por reel para não repetir no mesmo batch)
    const offset   = (startIdx + r * numProds) % allProds.length;
    const selected = Array.from({ length: numProds }, (_, i) => allProds[(offset + i) % allProds.length]);
    console.log(`  📦 Produtos [${offset}..${(offset+numProds-1)%allProds.length}]: ${selected.map(p=>p.name?.slice(0,20)).join(', ')}`);

    const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out = path.join(OUTPUT_DIR, `reel_${r+1}_${style.name}_${ts}.mp4`);

    try {
      await createReel(selected, audioPath, style, logoPath, out);
      results.push({ r: r+1, style: style.name, out, ok: true });
    } catch (e) {
      console.error(`  ❌ Falhou: ${e.message?.slice(0, 200)}`);
      results.push({ r: r+1, style: style.name, ok: false, err: e.message?.slice(0, 100) });
    }
  }

  console.log(`\n${'═'.repeat(64)}`);
  console.log('📊  RESULTADO:');
  results.forEach(r => {
    if (r.ok) {
      const sz = (fs.statSync(r.out).size / 1024 / 1024).toFixed(2);
      console.log(`  ✅ Reel ${r.r} [${r.style}]  ${path.basename(r.out)}  (${sz}MB)`);
    } else {
      console.log(`  ❌ Reel ${r.r} [${r.style}]  ${r.err}`);
    }
  });
  console.log(`\n📁  ${OUTPUT_DIR}`);
  console.log('═'.repeat(64));
})().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
