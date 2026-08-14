require('dotenv').config();
const https = require('https');
const fs = require('fs');
const PAGE_ID = process.env.FB_PAGE_ID;
const FB_TOKEN = process.env.FB_PAGE_TOKEN;
const IG_ID = process.env.IG_PAGE_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

const get = url => new Promise((resolve, reject) => {
  https.get(url, { headers: { Authorization: 'Bearer ' + (url.includes('/' + IG_ID + '/') ? IG_TOKEN : FB_TOKEN) } }, r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => {
      try { resolve({ status: r.statusCode, json: JSON.parse(d) }); }
      catch (e) { reject(new Error('JSON parse: ' + e.message)); }
    });
  }).on('error', reject);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== FACEBOOK ===');
  const fbR = await get('https://graph.facebook.com/v25.0/' + PAGE_ID + '/posts?fields=id,message,created_time,permalink_url,status_type,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)&limit=25');
  const fbPosts = (fbR.json.data || []);
  console.log('FB posts:', fbPosts.length);
  for (const p of fbPosts) {
    const insUrl = 'https://graph.facebook.com/v25.0/' + p.id + '/insights?metric=post_reactions_by_type_total,post_clicks,post_video_views,post_video_complete_views_30s,post_video_views_15s';
    const insR = await get(insUrl);
    if (insR.json.data) {
      const d = insR.json.data;
      p.reactions_by_type = d.find(x => x.name === 'post_reactions_by_type_total')?.values?.[0]?.value || null;
      p.clicks = d.find(x => x.name === 'post_clicks')?.values?.[0]?.value || 0;
      p.video_views = d.find(x => x.name === 'post_video_views')?.values?.[0]?.value || 0;
      p.video_complete_30s = d.find(x => x.name === 'post_video_complete_views_30s')?.values?.[0]?.value || 0;
      p.video_views_15s = d.find(x => x.name === 'post_video_views_15s')?.values?.[0]?.value || 0;
    }
    await sleep(100);
  }
  const pageInfo = await get('https://graph.facebook.com/v25.0/' + PAGE_ID + '?fields=id,name,fan_count,followers_count');
  fs.writeFileSync('C:/Users/fox/superloja-analise/fb_v2.json', JSON.stringify({ page: pageInfo.json, posts: fbPosts }, null, 2));
  console.log('Saved fb_v2.json');

  console.log('=== INSTAGRAM ===');
  const igR = await get('https://graph.facebook.com/v25.0/' + IG_ID + '/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count&limit=25');
  const igMedia = (igR.json.data || []);
  console.log('IG media:', igMedia.length);
  for (const m of igMedia) {
    const insUrl = 'https://graph.facebook.com/v25.0/' + m.id + '/insights?metric=reach,total_interactions,saved,likes,comments';
    const insR = await get(insUrl);
    if (insR.json.data) {
      const d = insR.json.data;
      m.reach = d.find(x => x.name === 'reach')?.values?.[0]?.value || 0;
      m.total_interactions = d.find(x => x.name === 'total_interactions')?.values?.[0]?.value || 0;
      m.saved = d.find(x => x.name === 'saved')?.values?.[0]?.value || 0;
    }
    await sleep(100);
  }
  const igInfo = await get('https://graph.facebook.com/v25.0/' + IG_ID + '?fields=id,username,media_count,followers_count,follows_count');
  fs.writeFileSync('C:/Users/fox/superloja-analise/ig_v2.json', JSON.stringify({ account: igInfo.json, media: igMedia }, null, 2));
  console.log('Saved ig_v2.json');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
