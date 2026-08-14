#!/usr/bin/env node
'use strict';

// Lançamento confirmado pelo dono em 13-Ago-2026: $2/dia, 7 dias, iniciar hoje.
// Cria tudo PAUSED primeiro; só ativa depois de campanha+conjunto+criativo+anúncio existirem.

const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const guard = require('./text-guard.js');

const TOKEN = process.env.FB_AD_TOKEN || process.env.META_AD_TOKEN || process.env.FB_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '';
const ACCOUNT = 'act_' + String(process.env.FB_AD_ACCOUNT || process.env.META_AD_ACCOUNT || '354926190710586').replace(/^act_/, '');
const PAGE = process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || '230190170178019';
const IG = process.env.IG_PAGE_ID || process.env.INSTAGRAM_ACCOUNT_ID || '';
const GRAPH = '/v21.0/';
const DIR = path.join(process.env.DATA_DIR || 'C:/superloja/data', 'campanhas', 'fones-carregadores-massiva');
const PLAN_FILE = path.join(DIR, 'campaign-plan.json');
const IDS_FILE = path.join(DIR, 'meta-ids.json');
const DAILY_BUDGET = '200';
const DAYS = 7;

function request(method, endpoint, body = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ ...body, access_token: TOKEN }).toString();
    const req = https.request({ hostname: 'graph.facebook.com', path: GRAPH + endpoint + (method === 'GET' ? '?' + params : ''), method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(params) } }, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => {
        let json; try { json = JSON.parse(data); } catch { return reject(new Error('Resposta inválida da Meta')); }
        if (json.error) return reject(new Error(json.error.message + ' (code ' + json.error.code + ')'));
        resolve(json);
      });
    });
    req.setTimeout(45000, () => req.destroy(new Error('Meta API timeout')));
    req.on('error', reject); if (method !== 'GET') req.write(params); req.end();
  });
}

async function main() {
  if (!TOKEN) throw new Error('Token de anúncios Meta não configurado');
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  if (!Array.isArray(plan.products) || plan.products.length !== 8) throw new Error('Plano/criativos incompletos');
  const existing = fs.existsSync(IDS_FILE) ? JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')) : null;

  await request('GET', ACCOUNT, { fields: 'id,name,account_status,currency,timezone_name' });
  const ids = existing || { createdAt: new Date().toISOString(), state: 'CREATING', dailyBudgetUsd: 2, days: DAYS, maximumUsd: 14 };
  const save = () => fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2), 'utf8');
  save();

  const hashes = ids.imageHashes || [];
  if (hashes.length !== plan.products.length) {
    hashes.length = 0;
    for (const product of plan.products) {
      const image = fs.readFileSync(product.imagem).toString('base64');
      const uploaded = await request('POST', ACCOUNT + '/adimages', { bytes: image });
      const key = uploaded.images && Object.keys(uploaded.images)[0];
      if (!key) throw new Error('Upload sem hash para ' + product.nome);
      hashes.push(uploaded.images[key].hash);
    }
  }
  ids.imageHashes = hashes; save();

  if (!ids.campaign) {
    const campaign = await request('POST', ACCOUNT + '/campaigns', {
      name: plan.name + ' — 13 Ago', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED',
      special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false'
    });
    ids.campaign = campaign.id; save();
  }

  const interests = JSON.parse(fs.readFileSync(path.join(path.dirname(DIR), '_interesses.json'), 'utf8'))
    .filter(x => ['Headphones', 'Bluetooth', 'Mobile phone accessories', 'Consumer electronics', 'Online shopping'].includes(x.name));
  const targeting = {
    geo_locations: { regions: [{ key: '4514' }] }, age_min: 18, age_max: 65,
    interests: interests.map(x => ({ id: x.id, name: x.name })),
    targeting_automation: { advantage_audience: 1 }
  };
  const end = new Date(Date.now() + DAYS * 86400000).toISOString();
  if (!ids.adset) {
    const adset = await request('POST', ACCOUNT + '/adsets', {
      name: 'Compradores Luanda — Fones e Carregadores — Advantage+', campaign_id: ids.campaign,
      optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      daily_budget: DAILY_BUDGET, start_time: new Date(Date.now() + 120000).toISOString(), end_time: end,
      targeting: JSON.stringify(targeting), promoted_object: JSON.stringify({ page_id: PAGE }), status: 'PAUSED'
    });
    ids.adset = adset.id; ids.audience = targeting; save();
  }

  const story = { page_id: PAGE };
  story.link_data = {
    message: guard.sanitizarAnuncio(plan.caption), link: guard.WHATSAPP_LINK,
    child_attachments: plan.products.map((p, i) => ({
      link: 'https://wa.me/' + guard.WHATSAPP_DIGITOS + '?text=' + encodeURIComponent('Olá! Quero o produto ' + (i + 1) + ': ' + p.nome),
      image_hash: hashes[i], name: p.titulo.slice(0, 40), description: 'Pagas na entrega · Luanda',
      call_to_action: { type: 'WHATSAPP_MESSAGE' }
    })),
    call_to_action: { type: 'WHATSAPP_MESSAGE' }, multi_share_end_card: 'false'
  };
  if (!ids.creative) {
    let creative;
    try {
      creative = await request('POST', ACCOUNT + '/adcreatives', { name: 'Venda Massiva Fones + Carregadores — Carrossel', object_story_spec: JSON.stringify(story) });
    } catch (e) {
      story.link_data.call_to_action = { type: 'SHOP_NOW' };
      story.link_data.child_attachments.forEach(x => { x.call_to_action = { type: 'SHOP_NOW' }; });
      creative = await request('POST', ACCOUNT + '/adcreatives', { name: 'Venda Massiva Fones + Carregadores — Carrossel WA', object_story_spec: JSON.stringify(story) });
      ids.ctaFallback = 'SHOP_NOW para wa.me';
    }
    ids.creative = creative.id; save();
  }

  if (!ids.ad) {
    const ad = await request('POST', ACCOUNT + '/ads', {
      name: 'Fones + Carregadores — WhatsApp — FB e IG', adset_id: ids.adset,
      creative: JSON.stringify({ creative_id: ids.creative }), status: 'PAUSED'
    });
    ids.ad = ad.id; ids.state = 'READY_PAUSED'; save();
  }

  // Estrutura completa: ativar filhos primeiro e campanha por último.
  await request('POST', ids.ad, { status: 'ACTIVE' });
  await request('POST', ids.adset, { status: 'ACTIVE' });
  await request('POST', ids.campaign, { status: 'ACTIVE' });
  ids.state = 'ACTIVE_SUBMITTED'; ids.activatedAt = new Date().toISOString(); save();

  console.log(JSON.stringify({ ok: true, state: ids.state, campaign: ids.campaign, adset: ids.adset, creative: ids.creative,
    ad: ids.ad, dailyBudgetUsd: 2, maximumUsd: 14, endsAt: end,
    manager: 'https://business.facebook.com/adsmanager/manage/ads?act=' + ACCOUNT.replace('act_', '') + '&selected_campaign_ids=' + ids.campaign }, null, 2));
}

main().catch(e => { console.error(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
