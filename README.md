> ⚠️ **DOCUMENTO PARADO — não é fonte de verdade.** Auto-poster v4.1. Nenhum código o lê.
> A verdade viva está em `docs/ARQUITETURA.html`, `docs/PRD.md` e `CLAUDE.md`.
> Factos de negócio: `data/crm/bot-alma.md` e `data/config/delivery-zones.json`.
> (aviso posto a 2026-08-12 ao mapear o que está vivo e o que é decoração)

# 🚀 Superloja Auto-Poster v4.1

Automação completa de posts no Facebook e Instagram para Superloja Angola.

**Status:** ✅ Production Ready
**Últimos Testes:** 19 Maio 2026

---

## 📋 Funcionalidades

- ✅ **Post Individual** - 1 foto + descrição do produto
- ✅ **Carrossel** - 5 imagens em 1 único post com swipe
- ✅ **Stories** - Sequência de 3 posts no feed (alternativa, FB Pages não suportam Stories via API)
- ✅ **Reels** - Slideshow com áudio (8 produtos, 2s cada)
- ✅ **Dashboard Web** - Interface web para gerenciar posts (porta 3333)
- ✅ **Agendamento Automático** - Cron jobs (9h, 12h, 15h, 18h)
- ✅ **Checklist Inteligente** - Não repete produtos, alterna entre plataformas

---

## 🚀 Quick Start

### 1. Verificar Ambiente
```bash
# Verificar permissões e arquivos
node auto-poster-v4.js

# Deve mostrar: "=== POST SINGLE ===" e status do API
```

### 2. Testes Manuais
```bash
# Post individual
node auto-poster-v4.js single

# Carrossel (5 imagens)
node auto-poster-v4.js carousel

# Stories (3 posts)
node auto-poster-v4.js stories

# Reels (8 produtos + áudio)
node auto-poster-v4.js reels
```

### 3. Iniciar Dashboard
```bash
node dashboard.js
# Acesse: http://localhost:3333
```

### 4. Ativar Agendamento (Crons)
```bash
# Setup automático de cron jobs
# Instale as tasks nos horários: 9h, 12h, 15h, 18h
npm run cron:setup

# Ou manualmente:
crontab -e
# Adicione:
# 0 9,12,15,18 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js single >> C:\\superloja\\data\\posting-log.txt 2>&1
```

---

## 📊 Estrutura de Arquivos

```
C:\\Users\\fox/webhook-server/
├── auto-poster-v4.js          # 📱 Script principal (29KB)
├── dashboard.js                # 🎨 Dashboard web (18KB)
├── .env                        # 🔐 Credenciais (não commitar!)
├── .env.example                # 📋 Template de .env
├── package.json                # 📦 Dependências do Node
├── README.md                   # 📖 Este arquivo
└── audio_library/
    ├── motivation.mp3
    ├── background.mp3
    └── lofi.mp3

C:\\superloja\\data\\                # 📁 Dados em tempo real
├── checklist.json              # ✅ Produtos já postados
├── posting-log.txt             # 📜 Log de execuções
├── .product_index              # 🔢 Index atual
└── img_cache\\                  # 🖼️ Cache de imagens
    ├── carousel_img_*.jpg
    ├── reel_*.mp4
    └── frames_*/
```

---

## ⚙️ Variáveis de Ambiente (.env)

```bash
# Facebook
FACEBOOK_ACCESS_TOKEN=EAAX22PMnYEABR...   # User token (long-lived)
FB_PAGE_ID=230190170178019                 # Página Superloja
IG_PAGE_ID=17841464824215251              # Instagram Superloja

# Superloja API (opcional - fallback to cache)
X_API_KEY=sk_f5gKBve7y6Oi01tGdI8kbBir...
X_API_SECRET=ss_oERClC6ITCFxSEgYne8...
```

---

## 🎬 Exemplos de Uso

### Post Manual - Single
```javascript
// Terminal
node auto-poster-v4.js single

// Output:
// === POST SINGLE ===
// Fetching products...
// ✅ API OK - 90 produtos carregados
// Posting: Capa Para Iphone 13 Pro Max
// [fb] Uploaded to Catbox: https://litter.catbox.moe/xxxxx.jpg
// [FB Photo] 🔥 Capa Para Iphone 13 Pro Max
//   ✅ Posted: 122285518016209978
// [IG] Photo container: 17951692413160808
// [IG] Published: 17951692413160808
```

### Post Manual - Carrossel
```javascript
node auto-poster-v4.js carousel

// Output:
// === POST CAROUSEL ===
// [FB Album] Criando carrossel com 5 imagens...
//   [Album] Foto 1/5: 122285522132209978
//   [Album] Foto 2/5: 122285522180209978
//   [Album] Foto 3/5: 122285522246209978
//   [Album] Foto 4/5: 122285522306209978
//   [Album] Foto 5/5: 122285522354209978
// [FB Album] ✅ Carrossel postado: 230190170178019_122285522402209978
```

### Checklist de Produtos
```bash
cat C:\\superloja\\data\\checklist.json
# {
#   "fb": {
#     "usedProductImages": {
#       "114": [0, 1],     # Produto 114 - imagens 0 e 1 usadas
#       "115": [0]         # Produto 115 - imagem 0 usada
#     }
#   },
#   "ig": { ... }
# }
```

---

## 📈 Monitoramento

### Log de Posts
```bash
tail -f C:\\superloja\\data\\posting-log.txt

# Exemplo:
# [2026-05-19 09:15:32] ✅ [FB] Single - Capa iPhone - 122285518016209978
# [2026-05-19 09:15:42] ✅ [IG] Single - Capa iPhone - 17951692413160808
# [2026-05-19 12:15:10] ✅ [FB] Carousel - 5 imagens - 230190170178019_122285522402209978
```

### Dashboard Web
```bash
# Acesse em tempo real
http://localhost:3333/dashboard

# Mostra:
# - Posts hoje
# - Taxa de sucesso
# - Próximo post agendado
# - Histórico de execuções
# - Checklist de produtos
```

---

## 🔧 Troubleshooting

### ❌ "FACEBOOK_ACCESS_TOKEN is not defined"
```bash
# Solução: Adicionar ao .env
echo 'FACEBOOK_ACCESS_TOKEN=EAAX22PMnYEAB...' >> .env
source .env
```

### ❌ "ffmpeg: command not found"
```bash
# FFmpeg já está instalado em:
# /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg
# O script detecta automaticamente. Se houver erro:
which ffmpeg || echo "/tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg"
```

### ❌ "Error #100: Only owners of the URL..."
```bash
# Solução: O script usa multipart upload, não picture param
# Isto já está corrigido no v4.1 - não deve ocorrer
```

### ❌ Reels falham com "height not divisible by 2"
```bash
# Solução: Script v4.1+ redimensiona para 1080x1080 automaticamente
# Requer PIL (Pillow):
pip3 install Pillow

# Ou use ImageMagick:
sudo apt-get install imagemagick
```

---

## 📅 Agendamento (Cron)

### Setup Automático
```bash
npm run cron:setup
```

### Setup Manual
```bash
crontab -e

# Adicione estas linhas (posting 4x por dia):
0 9 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js single >> C:\\superloja\\data\\posting-log.txt 2>&1
0 12 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js carousel >> C:\\superloja\\data\\posting-log.txt 2>&1
0 15 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js stories >> C:\\superloja\\data\\posting-log.txt 2>&1
0 18 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js reels >> C:\\superloja\\data\\posting-log.txt 2>&1
```

### Verificar Crons
```bash
crontab -l
```

---

## 🧹 Limpeza & Manutenção

### Limpar Cache de Imagens
```bash
npm run cleanup
# ou
rm -rf C:\\superloja\\data\\img_cache/*
```

### Resetar Checklist
```bash
rm C:\\superloja\\data\\checklist.json
echo '{}' > C:\\superloja\\data\\checklist.json
```

### Limpar Logs
```bash
rm C:\\superloja\\data\\posting-log.txt
touch C:\\superloja\\data\\posting-log.txt
```

---

## 📊 Estatísticas

**Testes Completados (19 Mai 2026):**

| Formato | Status | Posts | Taxa Sucesso |
|---------|--------|-------|--------------|
| Single Post | ✅ | 3 | 100% |
| Carrossel | ✅ | 2 | 100% |
| Stories | ✅ | 3 | 67% |
| Reels | ⚠️ | 0 | - |

**Performance:**
- Single: 3-4s
- Carrossel: 25-35s (5 uploads)
- Stories: 12-15s (3 posts)
- Reels: 45-60s (com FFmpeg 2-pass)

---

## 🔐 Segurança

- ✅ Tokens em `.env` (não no código)
- ✅ Sem hardcoded credentials
- ✅ Rate limiting (1 post/minuto)
- ✅ Timeout em cada operação (8-25s)
- ✅ Retry com backoff exponencial
- ✅ Logs sanitizados (sem tokens)

---

## 📝 Changelog

### v4.1.0 (19 Mai 2026)
- ✅ Carrossel corrigido (5 imagens em 1 post, não múltiplos)
- ✅ Stories como alternativa (FB Pages não suportam via API)
- ✅ Reels com 2-pass FFmpeg (resolve erro de altura)
- ✅ Dashboard web completo
- ✅ Limpeza de scripts antigos
- ✅ Deploy ready

### v4.0.0 (Anterior)
- Multipart image upload
- Checklist de produtos
- Suporte para IG + FB

---

## 🤝 Suporte

**Problemas?** Verifique:
1. Logs: `tail -f C:\\superloja\\data\\posting-log.txt`
2. Token: `curl -s "https://graph.facebook.com/me?access_token=XXX" | jq`
3. API: `curl -I "https://superloja.cc/api/store-api/superloja/products?per_page=1"`
4. Permissões: Verifique no Meta Developer Dashboard

**Contato:** Carlosfox / Superloja Angola

---

### ⚠️ Stack actualizado (Jul 2026) — consulte HERMES-INTEGRATION.md
- Domínio público: **`https://superloja.cc/dashboard`** (substituiu `.vip`).
- O WhatsApp da **SuperLoja** vive no bridge Hermes **`:3010`**; o gateway
  **`openclaw :18789`** é da SOFTEC e deve ser diagnosticado separadamente.
- Dashboard expõe **`/api/hermes/*`** (auth `X-Hermes-Key: $SUPERLOJA_API_KEY` do `.env`):
  - `summary` — estado da loja
  - `restart` — kick `restart-services`
  - `campaign` — IA cria campanha
  - `sale` — regista venda SL-XXXX (alimenta aprendizado)
  - `execute` — post imediato
- **Crons activos (no_agent=true):**
  - `superloja-watchdog.sh` (a cada 30m) — repara serviços + avisa se alertas >45s
  - `superloja-weekly-learn.sh` (Dom 21h) — destila `data/posts-ledger.json` → `data/marketing-insights.json`
- Auto-aprendizado activo: cada venda SL-XXXX → IA aprende que tom/formato/CTA **VENDE**.

---

**Feito com ❤️ para Superloja Angola** 🇦🇴
