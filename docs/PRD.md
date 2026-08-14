# PRD — SuperLoja: sistema de vendas gerido por IA

> **Reescrito de raiz a 2026-08-08.** Todos os números foram medidos no sistema a correr,
> nenhum copiado da versão anterior.
>
> **Documento vivo.** Depois de cada mudança relevante, atualiza a secção afetada aqui e
> o CHANGELOG em `docs/ARQUITETURA.html`. Antes de propor seja o que for, lê a **§8** —
> cada armadilha lá listada custou uma venda ou horas de trabalho.

---

## 1. Visão

Uma loja de eletrónica em Luanda onde **a IA atende, aprende e propõe** — e o dono decide
tudo o que envolve dinheiro ou promessas.

O sistema hoje sabe fazer três coisas bem: **atender** (responde em ~2s, em português de
Angola, com o catálogo real na mão), **publicar** (222 posts em 30 dias, sozinho) e
**analisar** (cérebros que cruzam conversas, stock e anúncios).

Sabe fazer mal duas: **fechar** e **medir**. Ver §5.

---

## 2. Utilizadores

| Quem | Interface | O que faz |
|---|---|---|
| **Dono (Carlos)** | Dashboard `:3333` + WhatsApp (244939729902) | aprova planos, confirma factos, responde escalados |
| **Clientes** | WhatsApp · Messenger · Instagram | compram; **nunca** falam com o Hermes |
| **Claude Code** | CLI no Windows | implementa e testa — **o único que escreve código** |
| **Hermes** (MiniMax-M3) | CLI (`-t memory,skills`) + crons | decide dúvidas de negócio e anúncios |
| **Prime Agent** | WSL → `/api/prime/*` | audita, investiga, recomenda — nunca aplica |
| **Fugu / Haiku** | APIs | Fugu raciocina · Haiku escreve |

Contrato do Prime Agent: `C:\superloja\data\prime-agent\README.md`.

---

## 3. Requisitos funcionais

Estado: ✅ feito · 🔶 parcial · ⬜ backlog · 🔴 partido

### Atendimento

- ✅ Três plataformas no mesmo processo (`:3335`), um só cérebro
- ✅ Resposta em ~2s: Haiku → reserva MiniMax → reserva Fugu → **fallback honesto**
- ✅ Catálogo completo com stock e descrições (paginado — `per_page` fixo truncava)
- ✅ Zonas de entrega: 16, todas confirmadas pelo dono; levantamento grátis oferecido
  automaticamente quando a taxa ≥ 3.000 Kz
- ✅ **Presença humana no WhatsApp** (13-Ago): "a escrever…" + espera proporcional
  (0,9–4s) antes de cada resposta a cliente; o disjuntor é relido **depois** da espera
- ✅ **Memória de quem volta** (13-Ago): `perfil-clientes.js` — zona, modelo do
  telemóvel, interesses e encomendas, **só do que o cliente disse**, extracção
  determinística, injectado no prompt após 12h. O que ele diz agora ganha sempre
- ✅ **Voz responde a voz** (13-Ago): nota de voz do cliente → resposta também em
  nota de voz (`tts-superloja.py`: Edge pt-PT primeiro, **Kokoro 100% local como
  rede automática** — modelo em `data/tts/`, fora do venv; texto pós-guarda, ptt
  nativo via bridge). Texto segue sempre primeiro; falha na voz nunca custa a
  resposta; se o Kokoro assumir, aparece WARN `[VOZ] Edge TTS falhou` no log
- ✅ **Fichas técnicas** (13-Ago): o investigador (Hermes + web_search) pesquisa o
  produto uma vez → `data/crm/fichas-tecnicas.json` → o bot injecta no prompt
  quando o produto está em conversa (nome na mensagem ou mostrado; a foto converge
  porque a visão identifica pelo nome). Política (preço/garantia/entrega) NUNCA
  entra; `nao_confirmado` nunca se afirma. Rotas: `GET /api/produtos/fichas`,
  `POST /api/produtos/ficha {nome}`, `POST /api/produtos/fichas/gerar {quantos}`
- ✅ Notas de voz transcritas **localmente** (faster-whisper, grátis, a voz não sai da máquina)
- ✅ Visão: o bot vê fotos e diz que produto é
- ✅ Foto citada → produto exacto (cruza `messageId` com `quotedId`)
- ✅ Disjuntor anti-loop + handoff; **pausas persistem em disco** desde 07-Ago
- ✅ Releitura da pausa **antes de enviar** — a IA pensa até 75s e o dono pode assumir a
  conversa nesse intervalo
- ✅ Follow-up de abandono (60 min) e reengajamento (3-30 dias, com catálogo)
- ✅ Avisos ao dono com número do cliente (`wa.me/`) e foto do artigo
- ✅ Destinatários das notificações editáveis no dashboard (máx. 5, com botão Testar)
- 🔴 **Handoff não existe no Messenger/Instagram** — 29 respostas do dono, 0 handoffs (§5)
- 🔴 **DM do Instagram não entrega** — falta Acesso Avançado (App Review). 12 clientes a
  falar para o vazio
- ⬜ Dicionário de gírias de Luanda ("brinco" = earbuds, "digital" = display LED)

### Anúncios (Meta)

- ✅ `/api/ads` (estrutura ao vivo) e `/api/ads/action` com confirmações literais
- ✅ Auditor de regras fixas: bid cap, subgasto, CTR baixo, cliques sem conversas
- ✅ **Cérebro dos anúncios** diário: decide por conjunto num conjunto fechado de ações,
  plano → WhatsApp do dono + painel no dashboard
- ✅ Só `pausar` é execução direta; dinheiro e público exigem valor + sim explícito
- 🔴 **104 decisões propostas em 9 dias, zero aplicadas** — e as pausas que pede apontam a
  conjuntos que já terminaram (§5)
- 🔴 **`campanha-ativa.json` diz 9 anúncios activos; ao vivo há 1** — e é este ficheiro que
  alimenta a saudação do bot a quem chega do anúncio (§5)
- ⬜ Comparar plano com resultado (o histórico existe, falta o comparador)

### Aprendizagem contínua

- ✅ Destilação 10h/22h: conversas → FAQ + tom; ensinadas preservadas
- ✅ Conselho de Vendas diário: Fugu avalia com dados, Haiku redige
- ✅ `aprendizagens-confirmadas.json` injetadas nos prompts
- ✅ Guarda anti-alucinação com excepções + 19 testes de regressão
- 🔴 **Três tectos atingidos em silêncio**: FAQ 40/40, aprendizagens 40 (código corta a 30),
  Conselho 100/100 com 65 por decidir. Nenhum falha com erro — apenas param de aprender
- 🔴 **O dossiê corta 87% das aprendizagens** antes de as dar ao cérebro (§5)
- 🔴 **Zero conversas convertidas** para aprender: 6 encomendas, 4 canceladas, 2 pendentes

### Auditoria externa (Prime Agent)

- ✅ `GET /api/prime/briefing` — contexto todo num pedido, com estado **calculado**
- ✅ `POST /api/prime/recomendacao` — valida frontmatter e exige `armadilhas_verificadas`
- ✅ Fila com estados no dashboard; urgência alta → WhatsApp
- ✅ Sentido inverso: o dono pergunta em `entrada/`, fecha sozinho com `responde_a:`
- ✅ **Barreira técnica** (07-Ago): `impressoes-codigo.js` + chave `X-Prime-Key` sem restart
- ⬜ Ligar conversa → venda (61 refs, **0** com venda; 222 posts, **0** atribuídos)

### Dashboard (`:3333`)

- ✅ Visão Geral (cockpit + painel do Prime Agent) · Campanhas · Atendimento · Posts/Analytics · Conselho
- ✅ **Produtos a entrar na loja** (13-Ago): o Hermes propõe (`POST /api/produtos/rascunho`,
  com sugestões de correcção determinísticas — duplicados, preço fora da grelha de 500 Kz,
  descrição fraca, o que a guarda cortaria); o dono **escreve o stock** e publica
  (`POST /api/produtos/publicar`, `confirmacao:"PUBLICAR"`, só localhost/X-Hermes-Key).
  Regra de desenho: **o stock é sempre do dono** — ninguém mais sabe o que chegou ao
  armazém. A API da loja ignora `is_active:false` (nasce visível) e o DELETE é definitivo,
  por isso nada sobe sem o clique dele. ⚠️ A loja tem **debug ligado em produção**
  (erros devolvem SQL + caminho do servidor) — corrigir é de quem fez o site.
- 🔴 **25 das 40 rotas de ESCRITA não têm autenticação nenhuma** — incluindo publicar no Facebook/Instagram, apagar posts da Meta e eliminar campanhas. E os `GET /api/prime/*` servem **29 KB** do dossiê do negócio (catálogo, preços, margens, entregas, vendas) a quem alcançar a porta 3333 — que escuta em **todas** as interfaces
- 🔶 **Só 16 dos 86 blocos de rota verificam autenticação.** Rotas que publicam, gastam ou
  apagam (`/api/execute`, `/api/campaign/schedule`, `/api/carousel/publish`,
  `/api/campaign` DELETE, `/api/entregas` POST) respondem a qualquer pedido que alcance a
  porta 3333 — e a 3333 escuta em todas as interfaces

---

## 4. Requisitos não-funcionais (invioláveis)

1. **Nenhum facto de negócio se inventa.** Só o que o dono confirmou.
2. **O Hermes nunca fala com clientes.** Tem terminal.
3. **Dinheiro só com aprovação explícita.**
4. **A guarda vem por último**, sobre tudo o que sai para um cliente.
5. **UTF-8 sempre.** `--data-binary @ficheiro`, nunca `curl -d` inline com acentos.
6. **Português de Angola** em código, comentários e mensagens.
7. **Reiniciar por sinal**, nunca por `taskkill`.
8. **Só o Claude Code escreve código.** Verificado por `impressoes-codigo.js`.
9. **Contacto único nos anúncios.** Todo anúncio deve mostrar e abrir `+244 954 949 595`
   (`wa.me/244954949595`). `sanitizarAnuncio()` remove contactos estranhos e garante
   o CTA; `/api/ads/action` bloqueia a ativação se o contacto faltar ou for diferente.
   O número pessoal do dono e o número da SOFTEC nunca são destinos de anúncio.

---

## 5. Os números que doem (08-Ago-2026)

| | |
|---|---|
| Produtos | **86** (84 com stock, 2 esgotados) |
| **Com uma única unidade** | **36 — 43% do catálogo** esgota-se com uma venda |
| Stock total | 188 unidades · 1.440.200 Kz |
| Conversas | 330, de **89 clientes** (261 WhatsApp · 31 Instagram · 27 Messenger) |
| Encomendas | 6 — 4 canceladas, 2 pendentes, **0 concluídas** |
| Posts em 30 dias | 222 (105 com código de referência) |
| **Vendas atribuídas a post** | **0** — o ciclo nunca fechou uma única vez |
| Gasto em anúncios | $208.49 · 934.456 impressões · 23.441 cliques |
| **Desse gasto, em tráfego que a Meta não mede** | **$109 — 52%** |
| Custo por encomenda fechada | **indefinido — não há nenhuma** |

**A leitura honesta:** o sistema atende bem e publica muito. O funil está partido no fim
(nada fecha) e no meio (nada se mede). Trabalhar em mais automação de topo de funil antes
de resolver isto é adicionar caudal a um cano furado.

### Cinco coisas partidas, por ordem de dano

1. **Handoff ausente no Messenger/Instagram** — 58 conversas onde o bot fala por cima do
   dono. A correcção óbvia ("eco que não reconheço = o dono") **já foi tentada e revertida
   a 07-Ago**: a Página envia a saudação automática da Business Suite e respostas enlatadas
   do próprio bot. Decidir pelo `app_id`, nunca por texto. O `[ECHO-DIAG]` já o regista.
2. **O dossiê corta 87% das aprendizagens** — `.slice(0,1800)` sobre 14.020 caracteres. O
   cérebro decide sem 33 das 40 coisas que já se provaram. As políticas perdem 47%.
3. **`campanha-ativa.json` mente ao bot** — 9 activos declarados, 1 real. O bot apresenta
   produtos que já saíram do ar.
4. **Zero atribuição post→venda** — 61 códigos, 0 vendas. Sem isto não há como saber que
   anúncio funciona.
5. **Catálogo sem custo nem prova social** — `ae_cost` nulo em 86/86. Nenhuma decisão de
   margem ou desconto é informada.

---

## 6. Backlog priorizado

0. **Pôr o gateway do Hermes a reiniciar-se sozinho** — esteve em baixo **132,7h em 30
   dias (18,4%)**, sem rede de segurança: a tarefa `Hermes_Gateway` só dispara no logon,
   com `RestartCount=0`. É a maior perda de serviço medida em todo o sistema e a
   correcção é de configuração, não de código (**dono**: acrescentar reinício automático
   e um gatilho periódico à tarefa agendada). O vigia já avisa quando cai; falta deixar
   de cair.
1. **Fechar o funil** — perceber porque 4 de 6 encomendas foram canceladas e as 2
   pendentes não avançam (uma há 8 dias, com 3 reconfirmações)
0b. **Pôr `META_APP_SECRET` no `.env`** (**dono**, 2 min) — o `POST /webhook` está
   exposto na Internet (cloudflared) e só verifica a assinatura da Meta quando este
   segredo existir. Sem ele, qualquer um que descubra a URL pode injectar mensagens
   falsas. Copiar o **App Secret** do painel da Meta (Configurações → Básico) e
   reiniciar. O código já está pronto — só falta a chave.
1a. **Prolongar "Encontre Tudo" no Ads Manager** (**dono**, 1 min) — aprovado a 13-Ago
   mas a rota da casa não sabe subir orçamento vitalício: campanha "🌟 Encontre Tudo",
   orçamento vitalício +$14, fim 20-Ago. Os outros 2 vencedores já estão no ar ($4/dia).
   E **verificar a 14-Ago se a Meta voltou a debitar** — a prova real da reactivação.
1b. **Pôr saldo na AISA** (**dono**) — a carteira está a **zero** desde algures antes de
   11-Ago. O bot continua a atender porque a MiniMax assume, mas isso é a carteira do
   Hermes a pagar o atendimento, e a MiniMax é a única rede que resta: a Sakana é
   inalcançável (ver §7 da ARQUITETURA). Verificar em `console.aisa.one`.
2. **Handoff Messenger/Instagram** — diagnóstico pelo `app_id` primeiro, patch depois
3. **Descolar os `.slice()` do dossiê** — dar ao cérebro tudo o que já se provou
4. **Corrigir `campanha-ativa.json`** — usar o estado efectivo, não o cru
5. **Atribuição post→venda** — começar pelo manual (`refCode` opcional em `/api/orders/estado`)
6. **Levantar os três tectos** (FAQ, aprendizagens, Conselho)
7. **Autenticar as rotas que publicam e gastam** no dashboard
8. **Repor stock** — 36 produtos a uma venda de esgotar; earbuds em falta com procura activa
8b. **Descrever o catálogo a sério** (**dono**, dados da loja) — 43% dos produtos têm
   a descrição-tipo "Produto de qualidade" e 40% têm menos de 25 caracteres úteis;
   quatro chamam-se só "Ventosas", "Mouse", "Microfone", "Multi-carregador". É a
   razão de o bot não conseguir responder a uma pergunta de **uso** sem consultar.
   Corrigir também os duplicados "Mouse Sem Fio" (8.000) vs "Mouse Sem-Fio" (7.500):
   o bot já cotou o de 8.000 a 7.500 três vezes e nenhuma guarda apanha isso.
9. **Acesso Avançado Instagram DM** (App Review — dono)
10. Gírias de Luanda · limpar nomes e descrições do catálogo
11. **Fichas técnicas para o resto do catálogo** — ~80 produtos sem ficha; gerar
   por lotes de 5 (`POST /api/produtos/fichas/gerar`, 1-3 min cada no investigador)
   e depois pendurar no cron do "Chatbot Aprende" para produtos novos

---

## 7. Como verificar mudanças (receitas)

```bash
# sintaxe antes de QUALQUER restart
node --check dashboard.js && node --check messenger-chatbot.js

# restart supervisionado (NUNCA taskkill nos serviços)
curl -s -X POST http://localhost:3333/api/system/restart \
  -H "Content-Type: application/json" -d '{"confirmation":"REINICIAR"}'

# guarda anti-alucinação — sempre que se tocar em text-guard.js
node tests-guarda.js                     # esperado: 31/31

# caminho da chamada à IA — sempre que se tocar em aiChat / cadeia de reserva
node tests-ia.js                         # esperado: 23/23
#   (mime real da imagem, parsing de formas inesperadas, que erros accionam a
#    reserva, marcador cortado a meio. Extrai as funções do ficheiro REAL — se
#    alguém as renomear, o teste rebenta em vez de passar a mentir.)

# auto-reparação: as TRÊS têm de dizer OK duas vezes seguidas
node ensure-bridge-patch.js --check      # 13 patches do bridge
node ensure-hermes-setup.js --check      # ddgs + faster-whisper
node impressoes-codigo.js --seco         # código não alterado às escondidas
#   (--seco e NAO --check: o --check, ao encontrar alteração, avisa e a seguir
#    grava o código intruso como nova referência — à segunda corrida diz "tudo bem")

# DEPOIS de alterar código legítimo — senão o watchdog dá alarme falso
node impressoes-codigo.js --gravar "claude-code: o que mudaste"

# o cliente do dashboard sobreviveu? (o JS vive num template literal)
#   no browser:  typeof showTab   → 'undefined' significa script morto
curl -s http://localhost:3333/dashboard | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const m=[...d.matchAll(/<script>([\s\S]*?)<\/script>/g)];m.forEach((x,i)=>{try{new Function(x[1]);console.log('bloco '+(i+1)+': OK')}catch(e){console.log('bloco '+(i+1)+': ERRO '+e.message)}})})"

# o dossiê do negócio está completo? (11 secções)
curl -s "http://localhost:3333/api/negocio/base?formato=texto" | grep "^== "

# ponte do Prime Agent — o que ele vê
curl -s "http://localhost:3333/api/prime/briefing?formato=texto&negocio=0"

# a validação recusa o que tem de recusar? (as três TÊM de dar erro)
curl -s -X POST http://localhost:3333/api/prime/recomendacao -H "Content-Type: application/json" -d '{"ficheiro":"../../../windows/win.ini"}'
curl -s -X POST http://localhost:3333/api/prime/recomendacao -H "Content-Type: application/json" -d '{"ficheiro":"_TEMPLATE.md"}'
curl -s -X POST http://localhost:3333/api/prime/recomendacao -H "Content-Type: application/json" -d '{"ficheiro":"nao-existe.md"}'

# follow-up: simula a seleção sem enviar nada
curl -s -X POST http://localhost:3335/api/followups/run -H "Content-Type: application/json" -d '{"dryRun":true}'

# cérebro dos anúncios (~45s; ENVIA WhatsApp ao dono — usar com intenção)
curl -s -X POST http://localhost:3333/api/ads/cerebro
```

**A IA responde mesmo?** Um teste de unidade não prova que a carteira tem saldo. Extrair
`aiChat` do ficheiro em produção e fazer **uma** chamada a sério é o que apanha um
`HTTP 402` — foi assim que se descobriu, a 11-Ago, que a carteira da AISA estava a zero
sem nada no log (nenhum cliente tinha escrito desde então). Fazer o mesmo com
`aiChatComReserva` prova que a cadeia salva a conversa. Custa cêntimos e é a única
verificação que distingue "o código está certo" de "o bot está a atender".

**Regra de ouro das verificações:** um `--check` que lê um ficheiro **não prova que
funciona**. Depois de repor, testar o **efeito** — fazer o agente pesquisar, mandar uma
mensagem a sério, ler o texto que chega à IA.

---

## 8. Armadilhas conhecidas — não repetir

### O código

| Armadilha | Regra |
|---|---|
| O JS do cliente vive num template literal em `dashboard.js` | `\n` de cliente escreve-se `\\n`; aspas em `onclick` → `&quot;` ou `data-*` + `this.dataset`; um erro mata o `<script>` **inteiro** e o dashboard fica mudo sem erro visível |
| `confirm()`/`alert()` suprimidos nos painéis | usar `metaConfirm`/`metaNotice` |
| Marcador de patch case-sensitive | `ensure-bridge-patch.js` aplicou o mesmo patch **108 vezes** porque o marcador dizia `esta` e o código `ESTA`. O texto tem de existir **literalmente** no que é inserido. `--check` duas vezes |
| Patches do bridge ancoram uns nos outros | novos patches devem ser **aditivos**, nunca reescrever blocos já patchados |
| **Dois patches certos que se contradizem** | o bridge punha "não consegues ouvir áudio, pede texto" e o bot **acrescentava** a transcrição a seguir: a IA recebia as duas ordens e obedecia à primeira. Ambos os `--check` diziam OK — o defeito estava na **composição**. Ler o texto final que chega à IA (`conversations.json` → `userMessage`) |
| `\b` no fim de uma alternância regex | "aceitou 4mil" não casava: o `\b` exigia fronteira entre `4` e `m`. Testar com a frase **real** do cliente |
| **A guarda não corre "sempre" — corre onde alguém a chamou** | vive dentro do `formatForPlatform()`. **Quatro** caminhos já nasceram sem ela: `cerebroAoVivo` (08-Ago), as respostas **públicas** a comentários (11-Ago) e o **`auto-poster-v4.js`, que publicou 247 posts sem a chamar uma única vez** (12-Ago). Um caminho novo de envio **tem de a chamar explicitamente** |
| Quando a guarda esvazia tudo, NÃO republicar o original | foi o meu primeiro instinto ("publicar vazio é pior") e está errado: o caso em que ela apaga tudo é o caso em que o texto era todo mau. Testado — um número de WhatsApp inventado voltava a passar. O certo é **cancelar** o envio |
| CTAs e textos de marketing também são factos de negócio | o CTA 7 prometeu **"Devolução em 7 dias"** em 9 posts publicados (a política é 1 dia + só troca); o CTA 8 inventou **"mais de 1.000 pedidos"** (há 6, nenhum entregue) e o CTA 1 **"+500 clientes"** (352 falaram com o bot) — e era o mais usado, 52 posts. Texto de venda escrito antes da lei 1 não fica isento dela |
| **`effective_status === 'ACTIVE'` não quer dizer que o anúncio entrega** | a Meta mantém o anúncio ACTIVE depois de o **conjunto** terminar. Medido a 12-Ago: 9 anúncios "ACTIVE" com o conjunto acabado, quatro desde **2024**, e zero gasto desde 09-Ago. O `sync-campanha-ativa.js` contava-os e o bot dizia aos clientes *"está no ar um anúncio nosso"* durante 3 dias sem campanha. Filtrar sempre pelo `end_time` do conjunto |
| Um cron **semanal** que falha perde a semana inteira | os diários recuperam (correram às 09h32 quando o gateway voltou); o *Reaprender Marketing* (domingo) falhou 09-Ago e só volta a tentar no domingo seguinte. Com o gateway a 18,4% de baixa, um semanal a hora fixa é frágil por desenho |
| **A re-destilação apaga o que não reconhece como "ensinado"** | a preservação era `fonte === 'hermes'` à letra — a resposta do mic **confirmada pelo dono** foi deitada fora na destilação seguinte. Quem grava um facto na FAQ tem de usar uma `fonte` que o filtro reconheça (`hermes|dono|claude|ensinad`), e quem mexer no filtro tem de re-testar com uma re-destilação |
| Cada padrão novo da guarda corre-se contra as FAQ VERDADEIRAS antes de entrar | 4ª censura de verdade confirmada: "levantar sem pagares nada de entrega (0 Kz)" caiu no padrão "entrega grátis". O levantamento É grátis. A auditoria pós-aprendizagem (guarda×FAQ) apanha isto — rodá-la sempre que se mexe na guarda ou na FAQ |
| **TODO marcador de acção precisa de cooldown determinístico por cliente** | o modelo reemite QUALQUER marcador num "Ok"/"sim" — catálogo (3× ao Rainho), HUMANO (dono avisado 3× por conversa), CONSULTAR (cérebro respondeu 2× ao Buanda), FOTO (Joelma). Cada marcador que dispara acção tem cooldown por cliente (`_accaoRecente` + chave normalizada); HUMANO deixa passar se a razão muda, FOTO se o produto muda. PEDIDO/DEPOIS já tinham dedup próprio |
| **Escritas de JSON críticas têm de ser atómicas (tmp + rename)** | o `sales-refs.json` corrompeu-se por uma escrita não-atómica que se sobrepôs a meio — JSON inválido 3 dias, atribuição morta, dashboard via 0 refs de 64, e o próximo `unshift` ia apagar tudo. `writeFileSync` directo num ficheiro que várias vias escrevem é uma bomba; `salesSave` passou a tmp+rename. Vale para qualquer JSON com escritas concorrentes |
| **Uma falha de infra não pode contar como desinteresse do cliente** | o follow-up excluía o lead à 2ª falha — mas as falhas eram `ECONNREFUSED` do bridge em baixo (culpa nossa). 2 leads mortos por isso. Distinguir sempre falha de ENTREGA (o canal recusou) de falha de INFRA (bridge/timeout/5xx): só a primeira conta para limites que penalizam o cliente |
| **Depois de escalar, o bot inventa a presença do dono** | "já estou aqui com o responsável" e "o dono está a confirmar contigo" são mentiras factuais (lei 1) que saíram a um cliente real 30 min seguidos. A única verdade pós-escalamento é "foi avisado, responde logo que puder" — a guarda corta o resto, e o disjuntor apanha as variantes ("vou chamar", "já vem") que o regex antigo não via |
| **Classificação de produto é DADO, não inferência do modelo** | o bot listou um "Fone Bluetooth" em "Fones com fio" e pôs lá também um fone cuja ficha não diz o tipo. Regra de prompt não chega: a marca [SEM FIO]/[COM FIO]/[não indicado] é derivada em degraus — nome+descrição → ficha de modelo exacto → **visão sobre a foto do catálogo** (`POST /api/produtos/visao`; a foto é d'AQUELE exemplar, promove sem modelo exacto) — e escrita no catálogo que ele lê. Erros de atributo com preço certo são invisíveis à guarda — a defesa é dar o atributo como dado |
| **Dedup por `mid` não chega: a rajada vem com mids diferentes** | a mesma frase chegou 8× em 25s (botão de pergunta pronta do Messenger / ice-breakers) e passou pelo `alreadyProcessed` — cada cópia tinha mid próprio. O disjuntor pausou 1h um cliente real. O filtro certo é por **conteúdo+tempo**: mesmo remetente + mesmo texto <60s → responde-se à 1ª e ignoram-se as cópias; >60s é humano e fica para o disjuntor |
| **A resposta do Hermes às consultas vira FAQ sem passar por regra nenhuma** | `/api/admin/consultas/responder` aprende o que o agente mandar — a regra "TEMOS OU NÃO TEMOS" só vive no `cerebroHermes()` do dashboard. Foi assim que uma resposta de enciclopédia ("um mic USB funciona quando o SO reconhece o dispositivo…") ficou 2 dias na FAQ a perder vendas. As regras de vendedor estão agora na skill do Hermes; se ele voltar a mandar enciclopédia, o buraco é este |
| A pesquisa web NÃO ganha à palavra do dono | a ficha técnica dizia "compatível com PC USB-C" (típico do tipo); o dono tinha dito "não serve". Quando conflituam, **pergunta-se ao dono** — a resposta certa era a nuance (portátil com USB-C sim, secretária sem USB-C não), mas só ele a podia confirmar |
| Uma lista de erros que "merecem" reserva é sempre curta demais | `valePenaReserva` só cobria saldo/5xx: nas **duas** vezes que a cadeia teve oportunidade real de correr (400 de imagem) foi saltada, com a reserva viva. Listar o que **não** merece (o timeout) é mais seguro que listar o que merece |
| Um aviso escrito antes do resultado mente | o WhatsApp ao dono dizia "está a responder pela reserva" **antes** de tentar a primeira. Construir a mensagem a partir do que **aconteceu**, nunca do que se espera |
| `?.` não é cosmética no parsing de respostas | um `TypeError` a ler a resposta do provedor não casa com nenhum regex de reserva e mata a cadeia toda; um `undefined` cai em "sem texto utilizavel" e **aciona** a reserva. Aceder com `?.` muda o comportamento, não só o estilo |
| Uma excepção fora do `try/catch` no caminho do Messenger cala o **lote inteiro** | sobe pelo `for (const event of entry.messaging)` e os clientes seguintes do mesmo webhook também ficam sem resposta. No WhatsApp o `.catch` avisa o dono; no Messenger só escreve no ficheiro |
| Ler o `media_type` de uma imagem do cabeçalho de quem a serve | a Anthropic compara com os bytes e rejeita o pedido **inteiro** com 400. Um cliente real (Osvalfo, 30-Jul) ficou sem resposta porque o CDN disse PNG e os bytes eram JPEG. `mimeReal()` lê os primeiros bytes |
| **"Mesmo tipo" tratado como "mesmo produto"** | a regra mandava mostrar o equivalente *em vez* de dizer que não temos — e "microfone" de telemóvel virou resposta a "microfone de PC". O bot só admitiu ao 2º turno, disse "vou confirmar" 2×, o disjuntor calou-o e o dono assumiu. **Mesmo tipo ≠ mesmo uso**: dizer o que temos, dizer que é para outro uso, oferecer encomendar — tudo na mesma mensagem |
| Uma regra certa debaixo do cabeçalho errado é uma regra que não existe | "diz claramente que não tens PARA ESSE" estava escrito desde sempre — mas debaixo de *"MODELO EXACTO — 12 Pro ≠ 12 Pro Max"*, 80 linhas acima. Fora do contexto dos telemóveis ninguém a aplicava. Ao acrescentar uma regra, verificar sob que cabeçalho ela cai |
| **`precosValidos` no caminho do cliente: medido, não serve** | apagaria **24 frases verdadeiras** (taxas de entrega, totais de encomenda, listas correctas) em 18 respostas reais, e **não apanha nada**: a grelha de preços é de 500 em 500 Kz, logo quase todo o preço inventado plausível calha num preço real de outro produto. Uma guarda de preços só faz sentido sobre o **par produto→preço**, nunca sobre o número solto. Não voltar a propor |
| Excepções da guarda com palavras fechadas | `\b(receber|chegar)\b` não casa "receberes"/"chegares" e o bot escreve conjugado: **"pagas quando receberes, sem risco!"** era apagado por inteiro. Usar radicais (`receb\w+`, `cheg\w+`). Alargar uma excepção só **abre** a porta — é seguro; apertar um padrão é que arrisca |
| Regex de preço a colar o número do nome do produto | `[\d.,\s]` aceitava espaços: **`X83 9.500 Kz` → 839.500 Kz**, no campeão de vendas da loja. Fronteira à esquerda `(?<![\d])` e sem `\s` na classe |
| Marcadores no **fim** da mensagem + tecto de tokens que corta pela cauda | um corte no sítio errado envia `<<PEDIDO>>{"nome":...,"telefone":...` em texto cru ao próprio cliente e a encomenda não fica registada. Há rede no fim do `processMarkers`, mas o desenho continua frágil |
| Contar caminhos de mutação com um grep pelo valor | `grep 'pausadoAte.*3600000'` só apanha quem **põe** a pausa, nunca quem a **levanta**. Toda a escrita passa por `_pausar()`/`_despausar()` |
| Persistir uma flag que um `setTimeout` desliga | `avisado` é reposto por um timer de 1h que **morre com o processo**. Só persistir estado que não dependa de um temporizador vivo |
| Escrita adiada antes de um restart | nesta máquina o bot é morto por terminação forçada e **nenhum** hook corre — nem `SIGTERM`, nem `exit`. Estado que precisa de sobreviver grava-se **síncrono** |
| Concluir que uma funcionalidade não existe sem confirmar o nome do campo | afirmei que nenhum dos 222 posts registava o CTA — procurava `ctaType`, o campo chama-se `ctaIdx`, e 103 registam-no. Antes de dizer "não existe", listar as chaves reais de um registo |
| Reparar a medição acorda optimizadores adormecidos | o *bandit* de CTA exigia média `> 0` e nunca disparava porque tudo era 0. Corrigida a colheita, passou a escolher com médias de **0,06** — ruído. Um optimizador precisa de **efeito mínimo**, não de "maior que zero", senão deixa de explorar por causa de 3 gostos |
| Colher métricas de conteúdo efémero | 110 stories eram colhidos às 40h e expiram às 24h: falhavam **sempre, por desenho**. 117 erros no ledger faziam parecer avaria o que era a pergunta errada |
| Pedir um campo que só existe nalguns tipos de objecto | `shares` existe nos carrosséis do Facebook e não nas fotos; a Meta responde `(#100)` e deita fora o pedido **inteiro**, perdendo likes e comentários. Repetir sem o campo em vez de perder o post |
| Estado calculado que calcula mal | `primeMelhorias()` lia `sales-refs.json` na pasta errada e com a forma errada: reportava 0 refs havendo 61, e a melhoria ficava eternamente "aberta". Pior que uma lista à mão — ninguém desconfia dela |
| No Windows, o `bash` do PATH é o do WSL | scripts com caminhos `/c/...` só funcionam no Git Bash |
| Saída de Python para o bot vem em cp1252 | `sys.stdout.reconfigure(encoding='utf-8')` |

### O bot e os clientes

| Armadilha | Regra |
|---|---|
| `per_page` fixo trunca o catálogo em silêncio | paginar até `total` — o bot passava a jurar que um produto não existia |
| **Prompt ignorado 3× seguidas** | procurar o comportamento em `chatbot-knowledge.json`: **o bot aprende das próprias respostas** e uma FAQ gravada vence qualquer regra abstracta |
| Regra de venda no prompt que o bot ignora | pus a mesma regra duas vezes e foi ignorada nas duas. Comportamento que custa dinheiro → **determinístico**, a seguir à guarda |
| Fecho aberto mata a venda | de 53 clientes em silêncio, **45 morreram numa pergunta aberta** e só 1 desistiu depois de lhe pedirem os dados. Fechar dirigido, sempre |
| Recolher dados da encomenda aos poucos | 14 clientes engatados, 0 vendas — vários morreram no "qual é o teu nome completo?". Pedir tudo **numa só mensagem** |
| A guarda pode censurar a VERDADE | dos 7 cortes auditados, **todos eram legítimos**. Padrões proibidos têm campo `excecao` |
| Extrair valores da prosa da IA | "entrega Kilamba 700 Kz = 9.200 Kz" → o regex apanha o **total**. Ir buscar à tabela (`detectZone`) |
| Vocabulário local | "brinco" = earbuds · "digital" = fones com display LED. Duas vendas perdidas |
| Modelo exacto | 12 Pro ≠ 12 Pro Max — o bot ofereceu o Max a quem pediu Pro, duas vezes |
| WhatsApp cita fotos **sem a legenda** | cruzar `messageId` com `quotedId`, nunca adivinhar pelo histórico |
| Formato de imagem para a AISA | é **Anthropic** (`source.base64`); `image_url` do OpenAI dá HTTP 400 |
| **"Eco que não reconheço = foi o dono"** | FALSO. A Página envia a saudação automática (5 de 29) e respostas enlatadas do bot. `privateReply()` é a única função de envio à Meta que não regista o envio. Distinguir pelo `app_id` |
| A pausa é lida à entrada, não antes de enviar | a IA pensa até 75s; sem reler, o bot fala por cima do dono **sem restart nenhum** |

### Operação e agentes

| Armadilha | Regra |
|---|---|
| **O aviso viaja pelo caminho avariado** | apareceu 3× no mesmo dia: alarme do gateway pela bridge que o gateway mata · alerta da bridge pela própria bridge · detector de código a gravar o intruso como referência quando não consegue avisar. Regra: o canal de emergência não pode depender de nada do que vigia, e só se marca "já avisei" **depois** de a mensagem sair |
| Fechar uma porta e deixar a do lado aberta | fechou-se `/api/system/restart` à chave do Prime e ficou `/api/hermes/restart` — outro mecanismo, sem confirmação, mesma consequência. Ao criar uma fronteira, procurar **todos** os caminhos que fazem a mesma coisa (`grep` pela ação, não pelo endpoint) |
| Contar caminhos de envio ao cliente | eram **três**, não dois: `sendWhatsApp`, `sendMessage` e o `cerebroAoVivo()` — este último espera até 240s e dispara sem `await`, por isso continua em voo depois de o fluxo principal abortar |
| Um comentário que promete o que o código não faz | "o travão dos 6 avisos tem de sobreviver" — e o incremento nunca gravava. Comentário que afirma comportamento é uma asserção: ou se testa, ou não se escreve |
| **Um alarme que corre dentro daquilo que vigia** | o watchdog é um cron do Hermes: se o gateway morre, o watchdog morre com ele — na execução **e** na entrega. Vigias vivem fora do vigiado, e avisam por um caminho que sobrevive (aqui: dashboard → bridge 3010) |
| Um filtro de alertas com a premissa errada | o watchdog descartava `/bridge WhatsApp/` porque um comentário dizia que "o canal migrou p/ o openclaw 18789" — não migrou. A 04-Ago a bridge esteve em baixo 3h, o alerta foi gerado e o filtro apagou-o: 2 posts perdidos em silêncio. Filtro de alerta sem data e sem prova é dívida escondida |
| Confundir ruído de arranque com avaria | `whatsapp connect timed out after 30s`: 17 vezes em 90 arranques, **15 recuperaram em ~31s**. A causa é o gateway desistir aos 30s quando a bridge demora ~58s a ficar pronta. O que importava estava noutro sítio: o gateway **desligado** 132,7h em 30 dias, sem reinício automático |
| Estado que só muda nas transições não é heartbeat | `gateway_state.json` diz `connected` mesmo com a sessão morta há 11h. Vigiar por **batimento** (`ticker_heartbeat`, reescrito de 60 em 60s), nunca por estado declarado |
| Contador de "já avisei" em memória | o dashboard reinicia várias vezes por dia e o mesmo aviso saía a cada restart. Guardar em disco |
| **Um agente não sabe que ferramentas tem** | perguntado com `-t memory,skills`, o Hermes respondeu "tenho terminal" — falso. Testar empiricamente, nunca pelo auto-relato |
| Um agente externo com acesso ao disco | o contrato é papel. `impressoes-codigo.js` no watchdog avisa o dono se um `.js` mudar fora do Claude Code |
| Uma proposta faseada aplicada na fase 2 sem a 1 | se a própria análise diz "precisa de diagnóstico primeiro", isso vale contra quem a escreveu |
| Diagnosticar pelo CRM sem confrontar com o log | o `userMessage` guarda o placeholder do bridge; parecia "áudio não transcrito" quando o log dizia "transcrito" à mesma hora ao segundo |
| Julgar campanha nova pelo total acumulado | a Meta tem 48-72h de aprendizagem. Comparar **dia N com dia N**, nunca acumulados |
| Testar o webhook com um `chatId` inventado | o `/send` falha a meio, o bridge lê o próprio eco como handoff do dono e cala o bot 1h. Limpar com `/api/admin/retomar` |
| Testar visão com uma imagem 1×1 px | `HTTP 400 Could not process image` — parece regressão e não é |
| Testar a lista de destinatários grava-a mesmo | um POST de teste com números inventados deixa-os a receber dados de clientes |
| Porta 3010 sem listener é NORMAL | on-demand; não "corrigir" |
| Confundir openclaw 18789 com o bridge da loja | canais separados: SuperLoja = 3010; openclaw 18789 = SOFTEC |
| `hermes update` apaga patches, o venv e a config | o watchdog repõe. **A falha mais traiçoeira**: sem `web.backend` não há erro nenhum — o `web_search` sai do schema e o cérebro volta a escalar em silêncio |

---

## 9. Onde está o conhecimento

**Lido por CÓDIGO, em execução** (mudar aqui muda o comportamento sem reiniciar nada):

| Ficheiro | Quem lê, quando |
|---|---|
| `data/crm/bot-alma.md` | o bot, **a cada mensagem**, sem cache (`loadAlma()`, `messenger-chatbot.js:795`) — é a **primeira** peça do prompt. Também `dashboard.js:1340` (cérebro) e `:6599` (política). Tem fallback embutido: se o ficheiro sumir, o bot não parte |
| `data/config/delivery-zones.json` | **a fonte das taxas de entrega** — 16 zonas, revistas pelo dono a 02-Ago. Quem quiser citar uma taxa, confirma aqui |
| `data/crm/chatbot-knowledge.json` | a FAQ curada que entra no prompt |
| `data/prime-agent/entrada/*.md` | varridos por pasta em `dashboard.js:1448` |

**Lido por AGENTES** (não por código — é contexto para quem decide):

| Ficheiro | Quem lê |
|---|---|
| `CLAUDE.md` (raiz) | Claude Code, ao abrir o projecto |
| `.claude/skills/*/SKILL.md` | o Hermes (`~/.hermes/config.yaml` → `skills.external_dirs`) e o Claude Code |
| `docs/ARQUITETURA.html` · `docs/PRD.md` · `docs/BOT-ESTRUTURA.html` | quem for lá. O `dashboard.js:6918-6920` só entrega os **caminhos** ao Prime Agent — nunca lhes lê o conteúdo |
| `data/prime-agent/README.md` | contrato do Prime Agent |
| `~/.claude/projects/.../memory/` | memória do Claude Code (índice em `MEMORY.md`) |

**Mortos** — ninguém os lê, e levaram banner de aviso a 12-Ago: `README.md`, `STATUS.md`,
`DEPLOYMENT_READY.md`, `INSTAGRAM_OPTIMIZATION.md`, `HERMES-INTEGRATION.md`,
`data/CATALOGO_FONES.md`.

> **A cópia sem dono apodrece.** A tabela de entregas estava escrita à mão em três sítios;
> o dono reviu-a a 02-Ago no JSON e as duas cópias (`SKILL.md` e
> `HERMES-CEREBRO-SUPERLOJA.md`) ficaram **11 dias** a dizer Kilamba 500 / Gamek 2000 /
> Viana 3000 — o Gamek a **metade** do preço real, dentro de um documento que o Hermes usa
> para decidir. Ao copiar um facto de negócio para um documento, escrever **na mesma linha**
> de onde ele veio e que é cópia.

### O que é editável sem programador, e o que não é

Do cérebro do bot (~20 KB), só **~4,3 KB** — a alma — vivem num `.md` editável.
Os outros **~15,5 KB** são **169 linhas de regras escritas em JavaScript** dentro do
`buildSystemPrompt` (`messenger-chatbot.js:804-1057`). Catálogo, FAQ, zonas e campanha
entram por API/JSON.

Na prática: identidade, voz e factos confirmados mudam-se no `bot-alma.md`. Mas as regras
de atendimento que mais mudam — política de encomendas, como fechar a venda, quando
consultar o cérebro — estão do lado do **JS** e precisam de um programador.
Há `GET/POST /api/admin/alma` no bot (`:3298-3303`, só loopback) mas **o dashboard não tem
botão** para ele: hoje a alma edita-se por `curl` ou à mão no ficheiro.
