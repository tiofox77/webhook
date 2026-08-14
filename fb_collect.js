require('dotenv').config();
const https = require('https');
const fs = require('fs');
const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_PAGE_TOKEN;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: 'Bearer '+TOKEN } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
        try { resolve({ status: r.statusCode, json: JSON.parse(d) }); }
        catch(e) { reject(new Error('JSON parse: '+e.message+'\n'+d.slice(0,200))); }
      });
    }).on('error', reject);
  });
}

(async () => {
  // 1. Pega todos os posts (paginando)
  let allPosts = [];
  let nextUrl = 'https://graph.facebook.com/v25.0/'+PAGE_ID+'/posts?fields=id,message,created_time,permalink_url,status_type,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)&limit=25';
  let page = 0;
  while (nextUrl && page < 4) {
    const r = await get(nextUrl);
    if (r.json.error) { console.log('ERR page', page, r.json.error); break; }
    allPosts = allPosts.concat(r.json.data || []);
    nextUrl = r.json.paging?.next || null;
    page++;
  }
  console.log('Total posts:', allPosts.length);

  // 2. Para cada post, buscar insights de reach/impressions
  for (const p of allPosts) {
    const u = 'https://graph.facebook.com/v25.0/'+p.id+'/insights?metric=post_reach,post_impressions,post_engaged_users,post_reactions_by_type_total';
    const r = await get(u);
    if (r.json.error) {
      p._insights_err = r.json.error.message;
      continue;
    }
    const d = r.json.data || [];
    p.reach = d.find(x=>x.name==='post_reach')?.values?.[0]?.value || 0;
    p.impressions = d.find(x=>x.name==='post_impressions')?.values?.[0]?.value || 0;
    p.engaged_users = d.find(x=>x.name==='post_engaged_users')?.values?.[0]?.value || 0;
    p.reactions_by_type = d.find(x=>x.name==='post_reactions_by_type_total')?.values?.[0]?.value || null;
  }

  fs.writeFileSync('C:/Users/fox/superloja-analise/fb_all.json', JSON.stringify(allPosts, null, 2));
  console.log('saved C:/Users/fox/superloja-analise/fb_all.json');

  // Print summary table
  const rows = allPosts.map((p,i) => {
    const r = p.reactions?.summary?.total_count || 0;
    const c = p.comments?.summary?.total_count || 0;
    const s = p.shares?.count || 0;
    const reach = p.reach || 0;
    const impr = p.impressions || 0;
    const eng = p.engaged_users || 0;
    const er = reach>0 ? ((r+c+s)/reach*100).toFixed(2) : 'n/a';
    return {
      '#': i+1, id: p.id, date: p.created_time?.slice(0,10), type: p.status_type,
      reactions: r, comments: c, shares: s, reach, impressions: impr, eng_users: eng, ER_pct: er,
      msg: (p.message||'').replace(/\n/g,' ').slice(0,40)
    };
  });
  console.table(rows);
})();
