require('dotenv').config();
const https = require('https');
const fs = require('fs');
const IG = process.env.IG_PAGE_ID || process.env.INSTAGRAM_ACCOUNT_ID;
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: 'Bearer '+TOKEN } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
        try { resolve({ status: r.statusCode, json: JSON.parse(d) }); }
        catch(e) { reject(new Error('JSON parse: '+e.message)); }
      });
    }).on('error', reject);
  });
}

(async () => {
  // Pega conta IG info
  const me = await get('https://graph.facebook.com/v25.0/'+IG+'?fields=id,username,media_count,followers_count,follows_count');
  console.log('IG account:', JSON.stringify(me.json));

  // Pega 25 media
  let allMedia = [];
  let nextUrl = 'https://graph.facebook.com/v25.0/'+IG+'/media?fields=id,caption,timestamp,media_type,permalink,thumbnail_url,media_url,like_count,comments_count,insights.metric(impressions,reach,total_interactions,likes,comments,saved)&limit=25';
  let page = 0;
  while (nextUrl && page < 4) {
    const r = await get(nextUrl);
    if (r.json.error) { console.log('ERR page', page, r.json.error.message); break; }
    allMedia = allMedia.concat(r.json.data || []);
    nextUrl = r.json.paging?.next || null;
    page++;
  }
  console.log('Total IG media:', allMedia.length);

  // Para cada um, pegar insights
  for (const m of allMedia) {
    const insUrl = 'https://graph.facebook.com/v25.0/'+m.id+'/insights?metric=impressions,reach,total_interactions,likes,comments,saved,saved,video_views';
    const r = await get(insUrl);
    if (r.json.error) { m._err = r.json.error.message; continue; }
    const d = r.json.data || [];
    m.reach = d.find(x=>x.name==='reach')?.values?.[0]?.value || 0;
    m.impressions = d.find(x=>x.name==='impressions')?.values?.[0]?.value || 0;
    m.engagement = d.find(x=>x.name==='engagement')?.values?.[0]?.value || 0;
    m.saved = d.find(x=>x.name==='saved')?.values?.[0]?.value || 0;
    if (m.media_type === 'VIDEO') m.video_views = d.find(x=>x.name==='video_views')?.values?.[0]?.value || 0;
  }

  fs.writeFileSync('C:/Users/fox/superloja-analise/ig_all.json', JSON.stringify({ account: me.json, media: allMedia }, null, 2));
  console.log('saved C:/Users/fox/superloja-analise/ig_all.json');

  // Tabela
  const rows = allMedia.map((m,i) => {
    const er = m.reach>0 ? ((m.like_count+m.comments_count)/m.reach*100).toFixed(2) : 'n/a';
    return {
      '#': i+1, id: m.id, date: m.timestamp?.slice(0,10), type: m.media_type,
      likes: m.like_count, comments: m.comments_count,
      reach: m.reach, impr: m.impressions, eng: m.engagement, ER_pct: er,
      cap: (m.caption||'').replace(/\n/g,' ').slice(0,35)
    };
  });
  console.table(rows);
})();
