#!/usr/bin/env node

// Carrossel de Fones & TWS para Facebook + Instagram
// Executar do webhook-server onde .env está carregado

require('dotenv').config();
const FB_PAGE_ID = '230190170178019';
const IG_PAGE_ID = '17841464824215251';
const FB_PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN || process.env.FB_PAGE_TOKEN;

if (!FB_PAGE_TOKEN) {
  console.error('❌ Token não carregado. Verifique .env');
  process.exit(1);
}

console.log(`✅ Token carregado (últimas 20 chars: ...${FB_PAGE_TOKEN.slice(-20)})`);
console.log('📱 Carrossel de Fones & TWS\n');

const fetch = require('node-fetch');

// Produtos de fones
const produtos = [
  {
    name: 'TWS Pro Earbuds Bluetooth 5.1',
    price: '8.900 Kz',
    desc: '🎵 Áudio HiFi | 8h bateria',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1080&h=1080'
  },
  {
    name: 'Fone Over-Ear Noise Cancelling',
    price: '12.500 Kz',
    desc: '🔇 Cancelamento ativo | 30h',
    image: 'https://images.unsplash.com/photo-1487215078519-e21cc028cb29?w=1080&h=1080'
  },
  {
    name: 'Earbuds TWS Sport IP67',
    price: '6.500 Kz',
    desc: '⚡ À prova de água',
    image: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=1080&h=1080'
  },
  {
    name: 'Fone Gaming 7.1 Wireless',
    price: '11.200 Kz',
    desc: '🎮 Surround 7.1',
    image: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=1080&h=1080'
  },
  {
    name: 'TWS Compact 4g Ultra Leve',
    price: '3.800 Kz',
    desc: '✨ Mini + Potente',
    image: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=1080&h=1080'
  }
];

const caption = `🎧 FONE & TWS IMPERDÍVEL 🎧

📱 5 Modelos • Qualidade Premium × Preço Acessível

✅ TWS Pro - Som HiFi (8.900 Kz)
✅ Over-Ear - Conforto Total (12.500 Kz)
✅ Esportivo - IP67 (6.500 Kz)
✅ Gaming - 7.1 Surround (11.200 Kz)
✅ Compact - Ultra Leve 4g (3.800 Kz)

🚚 Entrega Grátis (Luanda)
✔️ Garantia 1 Ano

👉 wa.me/244954949595 (Encomende agora!)`;

// Post Instagram Carousel
async function postInstagramCarousel() {
  console.log('\n📸 [INSTAGRAM] Criando carrossel...');
  
  try {
    const childIds = [];
    
    for (let i = 0; i < produtos.length; i++) {
      const p = produtos[i];
      console.log(`  ⬆️  [${i+1}/${produtos.length}] ${p.name}...`);
      
      const form = new URLSearchParams();
      form.append('image_url', p.image);
      form.append('access_token', FB_PAGE_TOKEN);
      
      const res = await fetch(`https://graph.facebook.com/v21.0/${IG_PAGE_ID}/media`, {
        method: 'POST',
        body: form
      });
      
      const data = await res.json();
      if (data.id) {
        childIds.push(data.id);
        console.log(`    ✅ OK`);
      } else {
        console.log(`    ⚠️  ${data.error?.message || 'erro desconhecido'}`);
      }
      
      await new Promise(r => setTimeout(r, 1500));
    }
    
    if (childIds.length < 2) {
      console.log('\n  ❌ Mínimo 2 imagens necessário');
      return false;
    }
    
    console.log(`\n  🔗 Criando container com ${childIds.length} imagens...`);
    
    const carouselForm = new URLSearchParams();
    carouselForm.append('caption', caption);
    carouselForm.append('media_type', 'CAROUSEL');
    carouselForm.append('children', childIds.join(','));
    carouselForm.append('access_token', FB_PAGE_TOKEN);
    
    const containerRes = await fetch(`https://graph.facebook.com/v21.0/${IG_PAGE_ID}/media`, {
      method: 'POST',
      body: carouselForm
    });
    
    const container = await containerRes.json();
    if (!container.id) {
      console.log(`  ❌ Erro: ${container.error?.message}`);
      return false;
    }
    
    console.log(`  ✅ Container criado`);
    console.log('  ⏳ Aguardando processamento (8s)...');
    await new Promise(r => setTimeout(r, 8000));
    
    const publishRes = await fetch(
      `https://graph.facebook.com/v21.0/${IG_PAGE_ID}/media_publish?creation_id=${container.id}&access_token=${FB_PAGE_TOKEN}`,
      { method: 'POST' }
    );
    
    const pub = await publishRes.json();
    if (pub.id) {
      console.log(`  ✅ [IG CAROUSEL] SUCESSO! 🎉\n     ID: ${pub.id}`);
      return true;
    } else {
      console.log(`  ❌ Erro ao publicar: ${pub.error?.message}`);
      return false;
    }
    
  } catch(e) {
    console.log(`  ❌ Erro: ${e.message}`);
    return false;
  }
}

// Post Facebook Carousel (Album)
async function postFacebookCarousel() {
  console.log('\n👍 [FACEBOOK] Criando carrossel...');
  
  try {
    const attachedMedia = [];
    
    for (let i = 0; i < produtos.length; i++) {
      const p = produtos[i];
      console.log(`  ⬆️  [${i+1}/${produtos.length}] ${p.name}...`);
      
      const form = new URLSearchParams();
      form.append('url', p.image);
      form.append('published', 'false');
      form.append('access_token', FB_PAGE_TOKEN);
      
      const res = await fetch(`https://graph.facebook.com/v21.0/${FB_PAGE_ID}/photos`, {
        method: 'POST',
        body: form
      });
      
      const data = await res.json();
      if (data.id) {
        attachedMedia.push({ media_fbid: data.id });
        console.log(`    ✅ OK`);
      } else {
        console.log(`    ⚠️  ${data.error?.message}`);
      }
      
      await new Promise(r => setTimeout(r, 2000));
    }
    
    if (attachedMedia.length < 2) {
      console.log('\n  ❌ Mínimo 2 imagens necessário');
      return false;
    }
    
    console.log(`\n  🔗 Criando post com ${attachedMedia.length} imagens...`);
    
    const feedForm = new URLSearchParams();
    feedForm.append('message', caption);
    feedForm.append('access_token', FB_PAGE_TOKEN);
    feedForm.append('attached_media', JSON.stringify(attachedMedia));
    
    const postRes = await fetch(`https://graph.facebook.com/v21.0/${FB_PAGE_ID}/feed`, {
      method: 'POST',
      body: feedForm
    });
    
    const result = await postRes.json();
    if (result.id) {
      console.log(`  ✅ [FB CAROUSEL] SUCESSO! 🎉\n     ID: ${result.id}`);
      return true;
    } else {
      console.log(`  ❌ Erro: ${result.error?.message}`);
      return false;
    }
    
  } catch(e) {
    console.log(`  ❌ Erro: ${e.message}`);
    return false;
  }
}

// Main
(async () => {
  console.log('═'.repeat(60));
  const igOk = await postInstagramCarousel();
  const fbOk = await postFacebookCarousel();
  console.log('\n' + '═'.repeat(60));
  
  console.log('\n📊 FINAL:');
  console.log(`  Instagram: ${igOk ? '✅ SUCESSO' : '❌ FALHOU'}`);
  console.log(`  Facebook:  ${fbOk ? '✅ SUCESSO' : '❌ FALHOU'}`);
  console.log('');
  
  process.exit(igOk && fbOk ? 0 : 1);
})().catch(e => {
  console.error('❌ Fatal:', e.message);
  process.exit(1);
});
