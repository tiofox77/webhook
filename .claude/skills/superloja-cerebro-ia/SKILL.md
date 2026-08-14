---
name: superloja-cerebro-ia
description: Faz o Hermes usar os DOIS cérebros de IA da SuperLoja ao máximo — Fugu (Sakana) para RACIOCINAR/analisar e AISA (Haiku) para ESCREVER. Regra "Fugu pensa, Haiku escreve". Cobre o caminho via dashboard (com dados reais) e o acesso direto às APIs.
trigger: quando o dono pede para criar/planear uma campanha, decidir "o que promover", analisar o mercado/desempenho, gerar captions/texto de marketing, pedir insights, "usa a Fugu", "raciocina sobre", "analisa os dados", ou qualquer decisão de marketing que precise de pensar antes de escrever
category: social-media
---

# Cérebro de IA da SuperLoja — Fugu pensa, Haiku escreve

A SuperLoja tem DOIS motores de IA. **NUNCA uses o teu próprio modelo (MiniMax)
para inventar análise de marketing ou captions** — usa estes:

| Cérebro | Para quê | Onde | Custo/velocidade |
|---|---|---|---|
| **Fugu** (Sakana) | RACIOCÍNIO: estratégia, análise, sourcing, relatórios, insights | `api.sakana.ai` | caro, lento (~60-90s) |
| **AISA** (Haiku) | ESCRITA: captions, texto de chat, resumos, FAQ | `api.aisa.one` | barato, rápido |

**Regra de ouro: Fugu PENSA → Haiku ESCREVE → só depois AGES.**

## Caminho preferido — pelo dashboard (:3333), com dados REAIS

Estes endpoints já correm na IA certa por dentro (Fugu quando `SAKANA_API_KEY`
existe) e vêm ancorados nos dados reais da loja + no "marketing brain". **Usa-os
sempre primeiro** — não refaças a análise à mão.

**1) FUGU raciocina** (GET, sem auth):
```bash
curl -s http://localhost:3333/api/sourcing          # categorias a que a audiência reage + Google Trends Angola
curl -s http://localhost:3333/api/reports/platforms  # o que funciona/morre em FB vs IG (formatos, horas)
curl -s http://localhost:3333/api/reports/campaigns   # desempenho das campanhas + o que melhorar
curl -s http://localhost:3333/api/analytics           # engajamento do dia, topCTA, recomendações
curl -s http://localhost:3333/api/atendimento         # desejos/wishlist e perguntas dos clientes
```

**2) HAIKU escreve** (POST) — as captions saem guiadas pelos insights da Fugu:
```bash
KEY=$(grep -E "^SUPERLOJA_API_KEY=" /c/superloja/webhook-server/.env | cut -d= -f2- | tr -d '"\r ')
curl -s -X POST -H "Content-Type: application/json" -H "X-Hermes-Key: $KEY" \
  -d '{"name":"Campanha Fones","days":3,"perDay":2,"tone":"urgencia","objective":"vendas","schedule":false}' \
  http://localhost:3333/api/hermes/campaign     # schedule:false = plano p/ aprovar antes de agendar
```

## Ciclo de decisão completo (o que "usar os dois ao máximo" significa)

1. **ANALISAR** com a Fugu → `GET /api/sourcing` + `/api/reports/platforms` (que categoria/rede/hora ganha).
2. **DECIDIR** os parâmetros da campanha a partir desses dados (produto, tom, objetivo).
3. **ESCREVER** com o Haiku → `POST /api/hermes/campaign` `schedule:false` (revê o plano).
4. **CRIAR/AGENDAR** → repetir com `schedule:true` (orgânico). Ads PAGOS: ver
   skill `superloja-production-system` §4b-BIS (não improvisar, 1 ad = 1 ad).
5. **RELATAR** ao dono: o que a Fugu concluiu + o que o Haiku escreveu + o que foi criado.

## Acesso DIRETO às APIs (avançado — só quando não há endpoint para a pergunta)

Para raciocínio/redação sem endpoint, usa o helper `ai-ask.js` (já trata das chaves,
do "Fugu sem max_tokens", dos timeouts e das armadilhas de escape/`/tmp` do Windows):

```bash
cd /c/superloja/webhook-server
# FUGU raciocina (lento ~5-90s, caro — só para pensar):
node ai-ask.js fugu "Devo entrar na categoria X em Luanda? Justifica com 3 razões."
# HAIKU escreve (rápido/barato — captions, respostas):
node ai-ask.js haiku "Escreve uma caption de 3 linhas para fones TWS, português de Angola, com emoji."
```

⚠️ **NUNCA chames estas APIs com `curl -d '{...}'` inline**: acentos (ã, é, ç)
corrompem o JSON → `"error parsing the body"`, e no Git Bash o `/tmp` do `node`
≠ `/tmp` do `curl`. O `ai-ask.js` faz o pedido em node (https), à prova disso.

## Disciplina

- Fugu = pensar (caro/lento) → NUNCA para volume nem para escrever texto final.
- Haiku = escrever/volume (barato/rápido) → NUNCA para decisões estratégicas sozinho.
- O teu modelo (MiniMax) coordena e executa comandos — não substitui nenhum dos dois.
- Factos de negócio (garantia, entrega, preços): só os confirmados pelo dono; nunca inventar.
