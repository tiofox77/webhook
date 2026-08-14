> ⚠️ **DOCUMENTO PARADO — não é fonte de verdade.** Integração do Hermes, 30-Jul. Nenhum código o lê.
> A verdade viva está em `docs/ARQUITETURA.html`, `docs/PRD.md` e `CLAUDE.md`.
> Factos de negócio: `data/crm/bot-alma.md` e `data/config/delivery-zones.json`.
> (aviso posto a 2026-08-12 ao mapear o que está vivo e o que é decoração)

# Integração Hermes ↔ Dashboard SuperLoja

O dashboard (porta **3333**, gerido pelo supervisor) expõe uma API dedicada ao agente
Hermes para gerir o sistema de vendas por WhatsApp/voz.

## Autenticação
Todos os endpoints `/api/hermes/*` exigem o header:
```
X-Hermes-Key: <valor de SUPERLOJA_API_KEY no C:\superloja\webhook-server\.env>
```
O Hermes já tem acesso a esse `.env` — ler a var e enviar no header. Sem chave → 401.

## Endpoints

### 1. Estado do sistema — `GET /api/hermes/summary`
Para responder "como está a loja?" no WhatsApp. Devolve:
```json
{
  "alertas": ["⚠️ Serviço em baixo: chatbot/webhook Meta"],
  "servicos": {"dashboard":true,"chatbot_webhook":true,"intelligence":true,"proxy_publico":true,"whatsapp_bridge_loja_3010":true,"openclaw_softec_18789":true},
  "posts_hoje": 12, "taxa_sucesso_pct": 100, "proximo_post": "10/07/2026 09:00",
  "catalogo": "13/90 produtos usados",
  "engajamento": {"total":31,"er_pct":3,"alcance":1020},
  "recomendacao_principal": {"title":"...","action":"..."},
  "campanhas_activas": [{"name":"...","posts":10,"agendados":10}]
}
```

### 1b. Diagnóstico barato do cérebro — `GET /api/hermes/status`

Em localhost não exige chave. Verifica Python/CLI, `ddgs`, os campos `web.*` e
as portas 3333/3335/3010. Não chama o modelo e não envia mensagens:

```bash
curl -s http://127.0.0.1:3333/api/hermes/status
```
`alertas` vem pronto para reencaminhar ao dono. **Sugestão de cron Hermes (30 min):**
se `alertas` não estiver vazio, enviar WhatsApp ao dono.

### 2. Reiniciar serviços — `POST /api/hermes/restart`
Quando o dono pede "reinicia os serviços". Dispara `restart-services.cmd`
(mata os serviços da sessão e relança o supervisor, que cura tudo em ~15s).
Alternativa via shell: `C:\superloja\webhook-server\restart-services.sh` (seguro em bash/WSL).

### 3. Criar campanha por comando — `POST /api/hermes/campaign`
Dono diz: "cria campanha de fones, 5 dias, urgência" → Hermes chama:
```json
{"name":"Campanha Fones","days":5,"perDay":2,"tone":"urgencia","objective":"vendas","schedule":true}
```
- `tone`: urgencia | emocional | beneficio | divertido
- `objective`: vendas | alcance | engajamento
- `schedule:false` → só gera o plano (para o dono aprovar antes)
- Resposta: `message` pronto para WhatsApp + `campaign.id` (cancelável via `DELETE /api/campaign?id=`)

A IA usa o Cérebro de Marketing + aprendizagens do histórico real (horas de ouro,
formatos que funcionam) automaticamente.

### 4. Registar VENDA por código — `POST /api/hermes/sale`
Cada post publicado leva um código único (SL-XXXX) no link wa.me. Quando um cliente
compra dizendo o código, o dono manda ao Hermes: **"venda SL-3F2A 15000"** → Hermes chama:
```json
{"code":"SL-3F2A","valor":15000,"nota":"opcional"}
```
Resposta `message` pronta p/ WhatsApp (confirma origem/produtos do código). A venda
credita o post no ledger → a IA aprende que tom/formato/CTA **VENDE** (sinal supremo,
pesa mais que engajamento nos prompts). Ver stats: `GET /api/sales` (sem auth, localhost).

### 5. Gerar post imediato — `POST /api/execute` (sem auth Hermes; localhost)
Já existente: body `{action:"single"|"carousel"|"stories"|"reels", productIds?:[...]}`
dispara o auto-poster.

## Aprendizagem automática (não precisa de acção do Hermes)
- Cada post publicado fica registado em `data/posts-ledger.json` com a variação usada
  (tom/CTA/formato/hora). O dashboard colhe o engajamento 40h depois (a cada 6h)
  e re-destila as aprendizagens semanalmente (`data/marketing-insights.json`).
- A escolha de CTA do auto-poster é ponderada pelo desempenho real (bandit 65/35).
- Forçar manualmente: `POST /api/insights/rebuild` e `POST /api/ledger/harvest` (sem auth, localhost).

## Crons Hermes — actualizado 2026-07-17
~17 jobs "Superloja - *" instalados (watchdog 30m, backup 03h, stock 08h, promessas 10h,
aprendizagem 10h/22h, follow-ups 18h, posts 07/12/15/18h, analytics 00h/06h, Trends Seg 08h40,
sourcing Seg 09h, relatório CEO Seg 09h30, reaprender Dom 21h). Todos `--no-agent`
(stdout verbatim no WhatsApp; vazio = silêncio). A lista VIVA é a fonte de verdade:
`cd %LOCALAPPDATA%\hermes\hermes-agent && venv\Scripts\python.exe -m hermes_cli.main cron list`

## ⭐ REGRA DE OURO — Hermes e o bot da loja são UM sistema, não dois rivais
Há dois cérebros no número da loja (954949595): o **Hermes** (tu — agente admin,
com terminal) e o **bot da loja** (messenger-chatbot:3335 — atende clientes, sem
acesso à máquina). Para NÃO haver confusão:
- **Clientes** são atendidos SEMPRE pelo bot da loja (o bridge encaminha-os para lá). O Hermes NUNCA fala directamente com um cliente.
- Quando o DONO te pede algo virado ao cliente (mandar catálogo/foto/mensagem a alguém), **DELEGA ao bot da loja** — não reimplementes nem geres markdown. Um só executor = zero divergência.
- Fonte única de verdade: catálogo, preços, zonas de entrega, fotos — chama SEMPRE os endpoints do sistema, nunca inventes.

### Delegar ao bot da loja — `POST http://127.0.0.1:3335/api/admin/enviar` (localhost)
Faz o bot da loja executar uma ação virada ao cliente (e ASSUME a conversa: o bot
cala-se 1h para não responder por cima de ti). `chatId` = JID WhatsApp ou PSID Meta.
```bash
# mandar o catálogo a um cliente:
# Substituir '244XXXXXXXXX@s.whatsapp.net' pelo JID real do cliente (sem '+', formato E.164).
# Para o teu próprio número, ver `CARLOS_PHONE` em messenger-chatbot.js.
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"chatId":"244XXXXXXXXX@s.whatsapp.net","tipo":"catalogo","template":"revista"}' \
  http://127.0.0.1:3335/api/admin/enviar
# mandar uma mensagem tua ao cliente:  {"chatId":"...","tipo":"texto","texto":"Olá, é o Carlos da SuperLoja..."}
# mandar foto de um produto:           {"chatId":"...","tipo":"foto","produto":"Fone X83"}
```
Devolver a conversa ao bot quando acabares: `POST /api/admin/retomar {"chatId":"..."}`.

### O bot PERGUNTA-TE quando tem dúvida — consolida e ENSINA-O
Quando o bot da loja não sabe uma resposta factual/de negócio (garantia, factura,
compatibilidade, prazos...), regista a dúvida e diz ao cliente que confirma. Tu (Hermes):
```bash
# 1) ver dúvidas pendentes dos clientes
curl -s http://127.0.0.1:3335/api/admin/consultas   # {pendentes:[{id,chatId,senderName,pergunta}]}
# 2) responder: ENSINA o bot (fica na FAQ p/ sempre) + entrega a resposta ao cliente
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"id":"<id>","resposta":"<a resposta certa>","enviar":true}' \
  http://127.0.0.1:3335/api/admin/consultas/responder
```
Usa as TUAS capacidades (web, memória, raciocínio) para consolidar a resposta certa —
mas confirma factos de NEGÓCIO com o dono antes de os ensinar (não inventes políticas).
Depois de responderes, o bot responde sozinho da próxima vez (não volta a perguntar).

Ensinar proactivamente (sem ser dúvida do cliente): `POST /api/admin/aprender {"pergunta":"...","resposta":"...","tom?":"...","evitar?":[...]}` — mete na FAQ que o bot usa no prompt.
Ver o que se passa na loja: `GET http://localhost:3333/api/atendimento` (conversas, encomendas, desejos, receita).
O bot → Hermes já existe no sentido inverso: encomendas, `<<HUMANO>>` e falhas chegam-te por WhatsApp (notifyCarlos).

### CATÁLOGO PDF — quando o dono pede "catálogo"/"lista de produtos"/"preços"
⚠️ **NUNCA gerar markdown nem inventar o catálogo.** Existe um gerador de PDF de
loja pronto (5 estilos, com logo/imagens/preços/WhatsApp). Fluxo de 2 passos:

**1) Gerar o PDF:**
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"template":"revista","filtro":"","titulo":"SuperLoja Angola"}' \
  http://localhost:3333/api/catalogo/gerar
# devolve {"ok":true,"path":"C:\\superloja\\data\\catalogos\\catalogo-....pdf","produtos":84,...}
```
- `template`: `revista` (premium) | `lookbook` | `feira` | `atacado` (lista de preços) | `grelha`. Omite → usa revista.
- `filtro`: palavra-chave opcional (ex `"capa"`, `"fones"`) para catálogo parcial; `categoria` idem.
- Sem auth (localhost). O `path` é o PDF pronto no disco.

**2) Entregar o PDF** (NÃO colar o conteúdo como texto — enviar o FICHEIRO):
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"chatId":"<jid do dono/conversa>","filePath":"<path do passo 1>","mediaType":"document","fileName":"Catalogo-SuperLoja.pdf","caption":"Catálogo SuperLoja"}' \
  http://127.0.0.1:3010/send-media
```
O bridge 3010 aceita PDF (mediaType `document`). Provado 2026-07-18: gerar→enviar entrega o PDF.
Nota: clientes que escrevem à LOJA já recebem o PDF automaticamente do bot da loja
(messenger-chatbot, marcador `<<CATALOGO>>`) — este fluxo é para quando o DONO pede ao Hermes.

## Endpoints novos (2026-07-16/17, sem auth Hermes; localhost)
- `GET /api/atendimento` — conversas/encomendas/desejos/promessas + receita do bot
- `POST /api/orders/estado` `{id,estado}` — pendente|confirmada|entregue|cancelada (entregue → feedback ao cliente)
- `GET|POST /api/entregas[/testar]` — zonas de Luanda e taxas
- `GET|POST /api/sourcing[/rebuild]` — oportunidades AliExpress (procura real + pulso posts + Trends AO)
- `POST /api/hermes/followup` — conselho sem envio: Fugu analisa, Hermes escolhe ação fechada, AISA redige; se escolher `enviar_catalogo`, o bot gera o PDF com todos os produtos atualmente em stock
- No chatbot 3335: `POST /api/followups/run` (`{"dryRun":true}` audita sem enviar; automático a cada 10 min, 60 min de silêncio, 8h–20h), `POST /api/promessas/run`, `POST /api/orders/lembretes` (loopback)

## Nota: DOIS WhatsApp em números DIFERENTES (corrigido 2026-07-17)
⚠️ A versão anterior desta nota estava ERRADA ("bridge 3010 obsoleto") — não seguir.
- **Bridge Hermes 3010** = número da LOJA (**244954949595**, perfil "Superloja"). **NÃO é obsoleto**:
  tem o router de clientes (patch local em `bridge.js`) — admin→Hermes, clientes→bot da loja (3335),
  grupos/status bloqueados. Se cair, o gateway ressuscita-o (~18s). Patches auto-reparados pelo
  watchdog via `node C:\superloja\webhook-server\ensure-bridge-patch.js`.
- **Gateway openclaw 18789** = número da SOFTEC (244942705533) — outra empresa do dono, não tocar.
- As notificações ao dono (Carlos) saem pelo bridge 3010 via `POST /send {chatId,message}`.
