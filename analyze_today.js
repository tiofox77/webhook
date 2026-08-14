const fs = require('fs');
const fb = JSON.parse(fs.readFileSync('/tmp/fb_all.json', 'utf8'));
const ig = JSON.parse(fs.readFileSync('/tmp/ig_all.json', 'utf8'));

// Helpers
const sum = (arr, k) => arr.reduce((a,b)=>a+(Number(b[k])||0),0);
const dayOf = iso => iso ? new Date(iso).toISOString().slice(0,10) : null;
const hourOf = iso => iso ? new Date(iso).getUTCHours() : null;

// FB analysis
const fb_eng = fb.map(p => ({
  id: p.id,
  date: dayOf(p.created_time),
  hour: hourOf(p.created_time),
  type: p.status_type,
  msg: (p.message||'').replace(/\n/g,' ').slice(0,80),
  reactions: p.reactions?.summary?.total_count || 0,
  comments: p.comments?.summary?.total_count || 0,
  shares: p.shares?.count || 0,
  reach: p.reach || 0,
  impressions: p.impressions || 0,
}));

const ig_eng = ig.media.map(m => ({
  id: m.id,
  date: dayOf(m.timestamp),
  hour: hourOf(m.timestamp),
  type: m.media_type,
  cap: (m.caption||'').replace(/\n/g,' ').slice(0,80),
  likes: m.like_count || 0,
  comments: m.comments_count || 0,
  reach: m.reach || 0,
  impressions: m.impressions || 0,
  engagement: m.engagement || 0,
}));

// Top performing posts
const fb_top = [...fb_eng].sort((a,b)=>(b.reactions+b.comments+b.shares)-(a.reactions+a.comments+a.shares)).slice(0,5);
const ig_top = [...ig_eng].sort((a,b)=>(b.likes+b.comments)-(a.likes+a.comments)).slice(0,5);

// By type breakdown
function byType(list, fields) {
  const out = {};
  for (const p of list) {
    out[p.type] = out[p.type] || { count: 0 };
    out[p.type].count++;
    for (const f of fields) out[p.type][f] = (out[p.type][f]||0) + (Number(p[f])||0);
  }
  for (const t of Object.keys(out)) {
    out[t].avg_engagement = out[t].count > 0 ? +((fields.reduce((a,f)=>a+(out[t][f]||0),0))/out[t].count).toFixed(2) : 0;
  }
  return out;
}

const fb_byType = byType(fb_eng, ['reactions','comments','shares']);
const ig_byType = byType(ig_eng, ['likes','comments']);

// By hour analysis
function byHour(list) {
  const h = Array(24).fill(0).map(()=>({posts:0, eng:0}));
  for (const p of list) {
    if (p.hour==null) continue;
    h[p.hour].posts++;
    h[p.hour].eng += (p.reactions||0)+(p.comments||0)+(p.shares||0)+(p.likes||0);
  }
  return h;
}
const fb_byHour = byHour(fb_eng);
const ig_byHour = byHour(ig_eng);

const report = {
  generated_at: new Date().toISOString(),
  date_target: '2026-07-06',
  pages: {
    facebook: { id: '230190170178019', name: 'Superloja', fans: 285, posts_last_25: fb_eng.length, posts_last_100: fb.length },
    instagram: { id: ig.account.id, username: ig.account.username, followers: ig.account.followers_count, media_count: ig.account.media_count, media_last_25: ig_eng.length, media_last_100: ig.media.length }
  },
  summary_25: {
    fb: { reactions: sum(fb_eng.slice(0,25),'reactions'), comments: sum(fb_eng.slice(0,25),'comments'), shares: sum(fb_eng.slice(0,25),'shares') },
    ig: { likes: sum(ig_eng.slice(0,25),'likes'), comments: sum(ig_eng.slice(0,25),'comments') }
  },
  summary_100: {
    fb: { reactions: sum(fb_eng,'reactions'), comments: sum(fb_eng,'comments'), shares: sum(fb_eng,'shares'), posts_with_engagement: fb_eng.filter(p=>(p.reactions+p.comments+p.shares)>0).length },
    ig: { likes: sum(ig_eng,'likes'), comments: sum(ig_eng,'comments'), posts_with_engagement: ig_eng.filter(p=>(p.likes+p.comments)>0).length }
  },
  fb_top_engagement: fb_top,
  ig_top_engagement: ig_top,
  fb_by_type: fb_byType,
  ig_by_type: ig_byType,
  fb_by_hour: fb_byHour,
  ig_by_hour: ig_byHour
};

fs.writeFileSync('C:/superloja/data/analytics/report_2026-07-06.json', JSON.stringify(report, null, 2));
console.log('Saved: C:\superloja\data\analytics\report_2026-07-06.json');
console.log('FB 25-post totals:', JSON.stringify(report.summary_25.fb));
console.log('IG 25-post totals:', JSON.stringify(report.summary_25.ig));
console.log('FB 100-post totals:', JSON.stringify(report.summary_100.fb));
console.log('IG 100-post totals:', JSON.stringify(report.summary_100.ig));
console.log('FB by type:', JSON.stringify(report.fb_by_type, null, 2));
console.log('IG by type:', JSON.stringify(report.ig_by_type, null, 2));
console.log('Top FB:');
fb_top.forEach(p => console.log(' -', p.date, p.hour+'h', p.type, '| eng='+(p.reactions+p.comments+p.shares), '|', p.msg));
console.log('Top IG:');
ig_top.forEach(p => console.log(' -', p.date, p.hour+'h', p.type, '| eng='+(p.likes+p.comments), '|', p.cap));
console.log('FB hour dist:');
fb_byHour.forEach((h,i) => { if (h.posts>0) console.log(' -', i+'h:', h.posts, 'posts,', h.eng, 'eng'); });
