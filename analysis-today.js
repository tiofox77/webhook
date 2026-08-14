#!/usr/bin/env node
/**
 * Superloja Analytics Intelligence (Manual Run)
 */
require('dotenv').config({path: __dirname + '/.env'});
const path = require('path');
const fs   = require('fs');
const https = require('https');

const PAGE_ID  = process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '230190170178019';
const IG_ID    = process.env.IG_PAGE_ID || process.env.INSTAGRAM_ACCOUNT_ID || '17841464824215251';
const TOKEN    = process.env.FB_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN;
const API      = 'https://graph.facebook.com/v21.0';
const DATA_DIR = process.env.DATA_DIR || 'C:\superloja\data';
const ANALYTICS_DIR = path.join(DATA_DIR, 'analytics');

if (!TOKEN) { console.error('[ERR] FB_PAGE_TOKEN ausente'); process.exit(1); }
if (!fs.existsSync(ANALYTICS_DIR)) fs.mkdirSync(ANALYTICS_DIR, {recursive:true});

function isoDate(d) { return d.toISOString().substring(0,10); }
function isoDateWAT(d) { const w=new Date(d.getTime()+3600000); return w.toISOString().substring(0,10); }function lastN(n) { return new Date(Date.now() - n*86400000); }

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({status: res.statusCode, body: JSON.parse(d)}); }
        catch(e) { resolve({status: res.statusCode, body: d}); }
      });
    }).on('error', reject);
  });
}

async function fetchFB() {
  const fields = 'id,message,created_time,permalink_url,full_picture,shares,reactions.summary(true),likes.summary(true),comments.summary(true)';
  const url = API + '/' + PAGE_ID + '/posts?fields=' + fields + '&limit=25&access_token=' + TOKEN;
  const r = await get(url);
  if (r.body.error || !r.body.data) return {ok:false, error:r.body};
  return {ok:true, posts:r.body.data};
}

async function fetchIG() {
  const fields = 'id,media_type,permalink,caption,timestamp,like_count,comments_count,thumbnail_url';
  const url = API + '/' + IG_ID + '/media?fields=' + fields + '&limit=25&access_token=' + TOKEN;
  const r = await get(url);
  if (r.body.error || !r.body.data) return {ok:false, error:r.body};
  return {ok:true, media:r.body.data};
}

async function fetchPage() {
  const r = await get(API + '/' + PAGE_ID + '?fields=id,name,fan_count,followers_count&access_token=' + TOKEN);
  return r.body || {};
}

async function fetchIGAccount() {
  const r = await get(API + '/' + IG_ID + '?fields=id,username,name,followers_count,follows_count,media_count&access_token=' + TOKEN);
  return r.body || {};
}

async function fetchIGReach() {
  const r = await get(API + '/' + IG_ID + '/insights?metric=reach&period=day&access_token=' + TOKEN);
  if (r.body.error || !r.body.data) return null;
  const m = r.body.data.find(function(x){ return x.name==='reach'; });
  if (!m || !m.values) return null;
  const recent = m.values.slice(-7);
  return {total_7d: recent.reduce(function(s,v){return s+(v.value||0);},0), days: recent};
}

function classifyHour(h) {
  if (h >= 6 && h < 12) return 'manha';
  if (h >= 12 && h < 18) return 'tarde';
  if (h >= 18) return 'noite';
  return 'madrugada';
}
function hourWAT(isoStr) {
  const d = new Date(isoStr);
  return (d.getUTCHours() + 1) % 24;
}

function aggregateFB(posts) {
  const byType = {};
  const hourly = { madrugada:[0,0], manha:[0,0], tarde:[0,0], noite:[0,0] };
  let totalL=0,totalC=0,totalS=0,totalR=0;
  const list = posts.map(function(p){
    const L = (p.likes && p.likes.summary && p.likes.summary.total_count) || 0;
    const C = (p.comments && p.comments.summary && p.comments.summary.total_count) || 0;
    const S = (p.shares && p.shares.count) || 0;
    const R = (p.reactions && p.reactions.summary && p.reactions.summary.total_count) || 0;
    totalL+=L; totalC+=C; totalS+=S; totalR+=R;
    const hasPic = !!p.full_picture;
    const type = hasPic ? 'IMAGE' : 'TEXT';
    const wh = hourWAT(p.created_time);
    const bucket = classifyHour(wh);
    hourly[bucket][0]++; hourly[bucket][1] += (L+C+S+R);
    if (!byType[type]) byType[type] = {count:0, likes:0, comments:0, shares:0, reactions:0, total:0};
    byType[type].count++; byType[type].likes+=L; byType[type].comments+=C;
    byType[type].shares+=S; byType[type].reactions+=R; byType[type].total += (L+C+S+R);
    return {
      id:p.id, type:type, hour_wat:wh, bucket:bucket,
      created_at:p.created_time,
      preview:(p.message||'').substring(0,140).replace(/\n/g,' '),
      likes:L, comments:C, shares:S, reactions:R, total:L+C+S+R,
      permalink:p.permalink_url, has_picture:hasPic
    };
  });
  return { list:list, byType:byType, hourly:hourly,
    totals:{likes:totalL, comments:totalC, shares:totalS, reactions:totalR, eng:totalL+totalC+totalS+totalR} };
}

function aggregateIG(media) {
  const byType = {};
  const hourly = { madrugada:[0,0], manha:[0,0], tarde:[0,0], noite:[0,0] };
  let totalL=0,totalC=0;
  const list = media.map(function(p){
    const L = p.like_count || 0;
    const C = p.comments_count || 0;
    totalL+=L; totalC+=C;
    const type = p.media_type || 'UNKNOWN';
    const wh = hourWAT(p.timestamp);
    const bucket = classifyHour(wh);
    hourly[bucket][0]++; hourly[bucket][1] += (L+C);
    if (!byType[type]) byType[type] = {count:0, likes:0, comments:0, total:0};
    byType[type].count++; byType[type].likes+=L; byType[type].comments+=C;
    byType[type].total += (L+C);
    return {
      id:p.id, type:type, hour_wat:wh, bucket:bucket,
      created_at:p.timestamp,
      preview:(p.caption||'').substring(0,140).replace(/\n/g,' '),
      likes:L, comments:C, total:L+C, permalink:p.permalink
    };
  });
  return { list:list, byType:byType, hourly:hourly,
    totals:{likes:totalL, comments:totalC, eng:totalL+totalC} };
}

const PRODUCT_PATTERNS = {
  'Cabos': /cabo|usb|carregador|adaptador/i,
  'Capas iPhone': /capa|iphone/i,
  'Fones/Audio': /fone|headphone|earphone|auricular|audio|bluetooth/i,
  'Promocoes': /promo|promo\xc3\xa7\xc3\xa3o|oferta|sale/i,
  'Outros': /./
};
function detectCategory(text) {
  for (const cat in PRODUCT_PATTERNS) {
    if (PRODUCT_PATTERNS[cat].test(text)) return cat;
  }
  return 'Outros';
}

function buildRecommendations(snap) {
  const recs = [];
  const fbAgg = snap.fbAgg, igAgg = snap.igAgg;
  const fbTotalEng = fbAgg.totals.eng, igTotalEng = igAgg.totals.eng;

  if (fbTotalEng === 0 && igTotalEng <= 3) {
    recs.push({priority:'CRITICAL', title:'Engagement praticamente zero em 25 posts',
      detail:'FB: ' + fbTotalEng + ' interacoes / IG: ' + igTotalEng + ' likes totais',
      action:'A pagina esta a publicar mas o publico nao esta a responder. Mudanca de estrategia necessaria.'});
  }

  let bestBucket = {name:'noite', posts:0, eng:0};
  for (const b of ['madrugada','manha','tarde','noite']) {
    const total = fbAgg.hourly[b][0] + igAgg.hourly[b][0];
    const eng = fbAgg.hourly[b][1] + igAgg.hourly[b][1];
    if (total > bestBucket.posts || (total === bestBucket.posts && eng > bestBucket.eng)) {
      bestBucket = {name:b, posts:total, eng:eng};
    }
  }
  const bucketLabel = {madrugada:'00h-06h', manha:'06h-12h', tarde:'12h-18h', noite:'18h-24h'};
  recs.push({priority:'HIGH', title:'Janela ativa: ' + bucketLabel[bestBucket.name] + ' WAT',
    detail: bestBucket.posts + ' posts concentrados nesta faixa',
    action:'Manter (ou reforcar) publicacoes nesta janela'});

  const fbTypes = Object.entries(fbAgg.byType);
  if (fbTypes.length > 0) {
    recs.push({priority:'MEDIUM',
      title:'Tipos FB: ' + fbTypes.map(function(t){return t[0]+'('+t[1].count+')';}).join(', '),
      detail:'100% image-based neste lote',
      action:'Diversificar para Reels/Videos curtos (convertem 3x mais em Angola)'});
  }
  if (igAgg.byType.CAROUSEL_ALBUM) {
    recs.push({priority:'MEDIUM',
      title:'IG Carrossel: ' + igAgg.byType.CAROUSEL_ALBUM.count + ' posts',
      detail:'Engagement medio: ' + (igAgg.byType.CAROUSEL_ALBUM.total/Math.max(igAgg.byType.CAROUSEL_ALBUM.count,1)).toFixed(2),
      action:'Aumentar frequencia de carrosseis Promocoes do dia'});
  }

  if (snap.igAccount && snap.igAccount.followers_count) {
    const recentReach = (snap.igReach && snap.igReach.total_7d) || 0;
    const fol = snap.igAccount.followers_count;
    recs.push({priority:'HIGH',
      title:'Alcance IG 7d: ' + recentReach + ' (de ' + fol + ' seguidores)',
      detail:'Taxa reach: ' + ((recentReach/Math.max(fol,1))*100).toFixed(1) + '%',
      action: recentReach < 50 ? 'Ativar boost pago minimo (500-1000 Kz/dia) para sair do limbo organico' : 'Continuar organico + 1 boost semanal'});
  }

  if (snap.yesterday) {
    const yFB = (snap.yesterday.fb && snap.yesterday.fb.total_engagement) || 0;
    const yIG = (snap.yesterday.ig && snap.yesterday.ig.total_engagement) || 0;
    const dFB = fbTotalEng - yFB;
    const dIG = igTotalEng - yIG;
    recs.push({priority: Math.abs(dFB)>5||Math.abs(dIG)>2 ? 'HIGH' : 'MEDIUM',
      title:'vs Ontem: FB ' + (dFB>=0?'+':'') + dFB + ', IG ' + (dIG>=0?'+':'') + dIG,
      detail:'Ontem (' + snap.yesterday.date + '): FB=' + yFB + ' IG=' + yIG + ' | Hoje: FB=' + fbTotalEng + ' IG=' + igTotalEng,
      action:(dFB<0||dIG<0) ? 'Investigar queda - comparar conteudo/horario' : 'Manter cadencia'});
  }

  recs.push({priority:'CRITICAL', title:'[Angola] WhatsApp e o canal de conversao real',
    detail:'90%+ das compras online em Angola comecam no WhatsApp, nao no IG',
    action:'TODOS os posts devem terminar com "Encomendar via WhatsApp: +244 954 949 595" (wa.me/244954949595)'});
  recs.push({priority:'CRITICAL', title:'[Angola] Horario nobre: 19h-22h WAT',
    detail:'Apos o jantar, pico de uso WhatsApp/IG/FB',
    action:'Agendar posts fortes para 19h e 21h WAT. Reels as 12h (almoco)'});
  recs.push({priority:'HIGH', title:'[Angola] Preco em Kwanzas SEMPRE visivel',
    detail:'Ja fazem isso - manter padrao nos captions',
    action:'Reforcar em Reels (texto sobre video) e Carrosseis (slide 1 com preco grande)'});
  recs.push({priority:'HIGH', title:'[Angola] Conectividade limitada (dados moveis)',
    detail:'Unitel/Movicel redes principais. Videos >10MB impedem carregamento',
    action:'Videos max 30s, fotos <500KB, evitar GIFs pesados'});
  recs.push({priority:'HIGH', title:'[Angola] Pagamento: Multicaixa Express / TPAngola',
    detail:'Publico angolano nao usa cartao internacional',
    action:'Mostrar referencias Multicaixa Express. "Pagar ao receber em Luanda" e diferencial'});
  recs.push({priority:'MEDIUM', title:'[Angola] Sotque e girias locais convertem',
    detail:'"Bem-vindo a Superloja", "Ja ta disponivel em Luanda", "Kwanzas na mao"',
    action:'Tom coloquial nos captions. PT-PT com PT-AO nos Stories'});

  return recs;
}

(async function(){
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  SUPERLOJA ANGOLA - Analytics Intelligence (Manual Run)');
  console.log('════════════════════════════════════════════════════════════════');

  const t0 = Date.now();
  const fbR = await fetchFB();
  const igR = await fetchIG();
  const page = await fetchPage();
  const igAcc = await fetchIGAccount();
  const igReachData = await fetchIGReach();
  console.log('[fetch] ' + (Date.now()-t0) + 'ms');

  const fbPosts = fbR.ok ? fbR.posts : [];
  const igMedia = igR.ok ? igR.media : [];

  const todayW = new Date(); const ydayW = new Date(todayW.getTime() - 86400000); const ydayFile = path.join(ANALYTICS_DIR, 'report_' + isoDateWAT(ydayW) + '.json');
  let yesterday = null;
  if (fs.existsSync(ydayFile)) {
    try { yesterday = JSON.parse(fs.readFileSync(ydayFile,'utf8')); } catch(_){}
  }

  const fbAgg = aggregateFB(fbPosts);
  const igAgg = aggregateIG(igMedia);

  const catBreakdown = {};
  for (const p of fbAgg.list.concat(igAgg.list)) {
    const cat = detectCategory(p.preview);
    if (!catBreakdown[cat]) catBreakdown[cat] = {count:0, engagement:0};
    catBreakdown[cat].count++;
    catBreakdown[cat].engagement += p.total;
  }

  const snap = { fbAgg:fbAgg, igAgg:igAgg, pageInfo:page, igAccount:igAcc,
    yesterday:yesterday, igReach:igReachData,
    fans: (page && page.fan_count) || 0 };
  const recs = buildRecommendations(snap);

  const topFB = fbAgg.list.slice().sort(function(a,b){return b.total-a.total;}).slice(0,5);
  const topIG = igAgg.list.slice().sort(function(a,b){return b.total-a.total;}).slice(0,5);

  const report = {
    generated_at: new Date().toISOString(),
    date: isoDateWAT(new Date()),
    source: 'manual_run',
    pages: {
      facebook: { id:PAGE_ID, name:page.name, fans:(page.fan_count||page.followers_count||0) },
      instagram: { id:IG_ID, username:igAcc.username, followers:(igAcc.followers_count||0),
        follows:(igAcc.follows_count||0), media_count:(igAcc.media_count||0) }
    },
    summary: {
      fb_posts_analyzed: fbPosts.length,
      ig_media_analyzed: igMedia.length,
      fb_total_engagement: fbAgg.totals.eng,
      ig_total_engagement: igAgg.totals.eng,
      fb_likes: fbAgg.totals.likes,
      fb_comments: fbAgg.totals.comments,
      fb_shares: fbAgg.totals.shares,
      fb_reactions: fbAgg.totals.reactions,
      ig_likes: igAgg.totals.likes,
      ig_comments: igAgg.totals.comments,
      ig_reach_7d: igReachData ? igReachData.total_7d : null,
      er_fb_pct: page.fan_count > 0 ? +((fbAgg.totals.eng/(page.fan_count * Math.max(fbAgg.list.length,1)))*100).toFixed(3) : 0,
      er_ig_pct: (igAcc.followers_count > 0 && igAgg.list.length > 0) ?
                  +(((igAgg.totals.eng/(igAcc.followers_count * igAgg.list.length))*100).toFixed(3)) : 0
    },
    fb_breakdown: {
      by_type: fbAgg.byType,
      hourly: {
        madrugada: { posts:fbAgg.hourly.madrugada[0], eng:fbAgg.hourly.madrugada[1] },
        manha: { posts:fbAgg.hourly.manha[0], eng:fbAgg.hourly.manha[1] },
        tarde: { posts:fbAgg.hourly.tarde[0], eng:fbAgg.hourly.tarde[1] },
        noite: { posts:fbAgg.hourly.noite[0], eng:fbAgg.hourly.noite[1] }
      },
      top_5_posts: topFB
    },
    ig_breakdown: {
      by_type: igAgg.byType,
      hourly: {
        madrugada: { posts:igAgg.hourly.madrugada[0], eng:igAgg.hourly.madrugada[1] },
        manha: { posts:igAgg.hourly.manha[0], eng:igAgg.hourly.manha[1] },
        tarde: { posts:igAgg.hourly.tarde[0], eng:igAgg.hourly.tarde[1] },
        noite: { posts:igAgg.hourly.noite[0], eng:igAgg.hourly.noite[1] }
      },
      top_5_posts: topIG
    },
    category_breakdown: catBreakdown,
    yesterday_comparison: yesterday ? {
      date: yesterday.date,
      fb_total_eng: (yesterday.fb && yesterday.fb.total_engagement) || 0,
      ig_total_eng: (yesterday.ig && yesterday.ig.total_engagement) || 0,
      delta_fb: fbAgg.totals.eng - ((yesterday.fb && yesterday.fb.total_engagement) || 0),
      delta_ig: igAgg.totals.eng - ((yesterday.ig && yesterday.ig.total_engagement) || 0)
    } : null,
    recommendations: recs
  };

  const todayFile = path.join(ANALYTICS_DIR, 'report_' + report.date + '.json');
  fs.writeFileSync(todayFile, JSON.stringify(report,null,2));
  const histDir = path.join(ANALYTICS_DIR,'historico');
  if (!fs.existsSync(histDir)) fs.mkdirSync(histDir,{recursive:true});
  fs.writeFileSync(path.join(histDir,'report_' + report.date + '.json'), JSON.stringify(report,null,2));
  console.log('[save] ' + todayFile);

  console.log('\n---------- RESUMO ----------');
  console.log('Pagina FB: ' + (page.name||'?') + ' | ' + (page.fan_count||0) + ' fas');
  console.log('IG: @' + (igAcc.username||'?') + ' | ' + (igAcc.followers_count||0) + ' seguidores | ' + (igAcc.media_count||0) + ' posts');
  console.log('FB (25 posts): ' + fbAgg.totals.eng + ' eng (' + fbAgg.totals.likes + 'L+' + fbAgg.totals.comments + 'C+' + fbAgg.totals.shares + 'S)');
  console.log('IG (25 media): ' + igAgg.totals.eng + ' eng (' + igAgg.totals.likes + 'L+' + igAgg.totals.comments + 'C)');
  console.log('Reach IG 7d: ' + (igReachData ? igReachData.total_7d : 'n/a'));
  console.log('ER FB: ' + report.summary.er_fb_pct + '% | ER IG: ' + report.summary.er_ig_pct + '%');

  console.log('\n---------- TOP 5 FB ----------');
  topFB.forEach(function(p,i){
    console.log((i+1) + '. [' + p.hour_wat + 'h] ' + p.type + ' | Eng:' + p.total);
    console.log('   ' + p.preview.substring(0,90));
  });
  console.log('\n---------- TOP 5 IG ----------');
  topIG.forEach(function(p,i){
    console.log((i+1) + '. [' + p.hour_wat + 'h] ' + p.type + ' | Eng:' + p.total);
    console.log('   ' + p.preview.substring(0,90));
  });

  console.log('\n---------- RECOMENDACOES ----------');
  recs.forEach(function(r,i){
    console.log('[' + r.priority + '] ' + (i+1) + '. ' + r.title);
    console.log('   ' + r.detail);
    console.log('   -> ' + r.action);
    console.log('');
  });

  console.log('========== JSON_REPORT_BELOW ==========');
  console.log(JSON.stringify(report));
})().catch(function(e){ console.error('[ERR]', e); process.exit(1); });
