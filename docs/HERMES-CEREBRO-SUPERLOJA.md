# Hermes, cérebro da SuperLoja

**Estado em 30 de Julho de 2026.** Documento de contexto: o que o agente decide,
com que dados, o que a loja tem de mudar para vender mais, e onde estão os limites.
Números todos verificados na API e na Meta nesta data — nenhum é estimativa.

---

## 1. A loja em números reais

| | |
|---|---|
| Produtos no catálogo | **86** (84 com stock, 2 esgotados) |
| Faixa de preço | 2.000 – 17.000 Kz |
| Produtos com **1 única unidade** | **36** (42% do catálogo) |
| Produtos com stock ≤ 2 | **55** (64%) |
| Sem descrição útil | 12 |
| Nomes com erros/sujidade | 18 |
| Categorias usadas | **1** ("Electronica") — a API oferece 21 |
| Conversas de clientes registadas | 151 |
| Conjuntos de anúncios ativos | 11 |
| Canal de venda | WhatsApp **+244 954 949 595** |

**Esgotados agora:** `Fones de ouvido TWS sem fio` (7.000 Kz) · `Fones de ouvido
Bluetooth sem fio Disney T19` (14.000 Kz). São **earbuds** — exactamente a
categoria mais pedida no atendimento e a que melhor converte nos anúncios.
Repor este stock é a compra mais rentável que existe hoje.

---

## 2. Quem decide o quê

```
                            ┌──────────────────────────────┐
   Cliente (WhatsApp,       │  BOT DA LOJA  :3335          │  responde 95% em ~2s
   Messenger, Instagram) ──►│  Haiku → MiniMax → Fugu      │
                            │  → padrões                    │
                            └───────┬──────────────────────┘
                                    │ não sabe responder
                    ┌───────────────┴────────────────┐
                    │                                │
            dúvida TÉCNICA                   dúvida de NEGÓCIO
         (compatibilidade, specs)         (preço, stock, prazo, política)
                    │                                │
                 FUGU responde              FUGU analisa o caso
                                                     │
                                            HERMES (cérebro) decide
                                                     │
                                            GUARDA valida o texto
                                            ┌────────┴────────┐
                                       aprovada          reprovada
                                            │                 │
                                    bot entrega +      vai ao DONO com
                                    aprende (FAQ)      a sugestão pronta
```

**A fronteira que não se atravessa:** o Hermes tem terminal e acesso à máquina.
Se falasse com clientes, um cliente mal-intencionado teria uma porta para a
máquina. Por isso é invocado sempre com `-t memory,skills` — **nunca**
`terminal`, `file` ou `code_execution`. **O Hermes decide e redige; o bot entrega.**

### Divisão por natureza da tarefa

| IA | Papel | Porquê |
|---|---|---|
| **Haiku** (AISA) | escrever: chat, captions, resumos | ~2s, barata — é quem aguenta volume |
| **Fugu** (Sakana) | raciocinar: estratégia, análise, ideias | pensa fundo (5-90s), caríssima |
| **Hermes** (agente) | decidir com contexto do negócio | é o único que *conhece a loja* (~25s) |
| **MiniMax** | reserva de saldo | carteira separada da AISA |

> **Fugu pensa · Haiku escreve · Hermes decide · o bot entrega.**

### Onde o Hermes decide, a partir de hoje

1. **Dúvidas de negócio do atendimento** — `/api/hermes/cerebro`, crons 10h/22h.
2. **Anúncios do Facebook/Instagram** — `/api/ads/cerebro`, **novo**, corre todas
   as noites. O auditor automático diz *o que está mal* por regras fixas; o
   Hermes decide *o que fazer* com stock, aprendizagens e procura em conta.
   Devolve um plano de ações de um **conjunto fechado** (`manter`, `pausar`,
   `trocar_criativo`, `subir_orcamento`, `descer_orcamento`, `alargar_publico`,
   `corrigir_link`, `prolongar`) e **não executa nada** — o dono aprova.
3. **Follow-up de abandono no WhatsApp** — `/api/hermes/followup`: a Fugu
   avalia oportunidade/pressão e os sinais de procura; o Hermes escolhe apenas
   `nao_enviar`, `perguntar_interesse` ou `enviar_catalogo`; a AISA redige sem
   nomes/preços/promessas e o bot executa depois de reler a atividade. Se houver
   catálogo, o PDF leva todos os produtos atualmente em stock. O Hermes nunca
   escolhe itens individuais nem envia.

### O que fica sempre com o dono

Gastar ou parar dinheiro · criar política nova (garantia, devolução, prazos) ·
preços · entregas fora de Luanda · qualquer coisa que a guarda tenha cortado.

---

## 3. Vender: o que os dados já provaram

★ **Multi-produto vence.** Carrosséis/listas de 5-9 produtos convertem ~9:1
contra produto único. O anúncio "MEGA OFERTA 8 produtos" fez **140 conversas por
$13.97** — $0.10 por conversa, o melhor da conta.

★ **Os 4 vencedores atuais** custam **$0.08–$0.11 por conversa**: Capas iPhone
(62 conversas), MEGA OFERTA (140), IG "Descubra" (94), "Encontre Tudo" (76).

★ **5 conjuntos com otimização errada queimaram ~$20 sem uma única conversa
contável** — REACH, PAGE_LIKES, LINK_CLICKS, LANDING_PAGE_VIEWS. Só campanhas com
otimização **CONVERSATIONS** (Click-to-WhatsApp) medem conversas de WhatsApp.
Auditar a otimização **antes** de julgar o criativo.

★ **Sem bid cap.** Um teto de $0.30 estrangulou duas campanhas a ~1% do ritmo
esperado. Usar sempre custo automático (`LOWEST_COST_WITHOUT_CAP`).

★ **Ganchos de Luanda duplicam o CTR.** "Preso no trânsito de Luanda?" levou o
CTR de 0.90% → 1.96% contra descrição genérica.

★ **Preço fora da legenda.** Preço explícito na caption piora o desempenho — vai
na imagem e na conversa.

★ **Nunca preço por categoria.** Há **7 cabos Tipo C de 4.500 a 12.000 Kz**.
Dizer "os Tipo C são 4.500" faz o cliente chegar com a expectativa errada.
Nome completo sempre ao lado do preço.

### O que perde vendas no atendimento (aprendido a doer)

- **Vocabulário.** Um cliente pediu *"aqueles tipo brinco"* — em Luanda, earbuds.
  O bot respondeu que não temos e ofereceu **pulseira e pingente**. A loja tem
  cinco modelos de fones sem fio. Venda perdida por dicionário, não por stock.
- Prometer "vou confirmar" mais de uma vez sem resolver.
- Repetir a mesma pergunta (o cliente responde 🙄 e desaparece).
- Reenviar fotos depois de o cliente já ter escolhido.
- Legenda de foto com o preço de outro produto.
- Dizer "não consigo ver a publicação" a quem vem do anúncio.

---

## 4. Que produtos sugerir: os três baldes

### Balde 1 — Esgotados com procura ativa (ação imediata)
`Fones TWS sem fio` 7.000 Kz e `Disney T19` 14.000 Kz. Earbuds são a categoria
mais pedida e a que converte a $0.10/conversa. **Cada dia esgotado é venda
perdida diária.**

### Balde 2 — Pedidos que não temos
Da lista de interesse (`GET /api/interesse`), depois de agrupada por conceito:
**Caixa de Som** (~8.000 Kz), **Mouse**, **Pen-drive**, **Cartão de memória**,
**carregadores de parede/portáteis**. Todos com 1 cliente cada — sinal fraco mas
real, e todos são acessórios de baixo custo e alta rotação.

> ⚠️ **Ler contagens com cuidado.** A destilação reanalisa as mesmas conversas e
> re-frasea o mesmo pedido: 9 registos de "brinco" eram **1 cliente**. Decidir
> compras exige **menções** e **clientes distintos** separados. Já vão etiquetados
> assim nos prompts.

### Balde 3 — Potencial não explorado
- **36 produtos com uma só unidade.** Os que geram procura merecem 5-10 unidades;
  os outros são capital preso. Cruzar com os que aparecem nas conversas.
- **Produtos que engajam mas não vendem** — normalmente falta foto melhor, preço
  competitivo ou um ângulo de utilidade concreto, não público.
- **Categoria única.** Todos os 86 produtos estão em "Electronica" e a API tem 21
  categorias com subcategorias. Sem categorias reais não há navegação no site,
  nem filtros, nem SEO por categoria.

---

## 5. SEO: o que fazer

### Site (superloja.vip) — maior impacto, menor custo

**Limpar os nomes dos produtos.** 18 dos 86 estão sujos e cada um custa buscas:

```
"Cabo De Carregamento RÁPidp Usb-C Extra Longo Para Galaxy S24"   → RÁPidp
"Cabo De AlimentaÇÃO Usb-C Para Dc"                                → caixa errada
"Leitor De CartãO Usb-C"                                           → caixa errada
"Cabo Usb 3.0 Para Disco RíGido Sata |||"                          → "|||"
"Fones de ouvido  TWS sem fio"                                     → espaço duplo
"Capa transparente para Iphonne 13Pro Max"                         → Iphonne
"2 Em  1 Cabo Adaptador"                                           → vago + espaço duplo
```

Um nome bom tem **a palavra que a pessoa escreve** + marca/modelo + a medida:
`Cabo USB-C 3 metros para Samsung Galaxy` vende melhor que
`Cabo De Carregamento RÁPidp Usb-C Extra Longo`. O cabo "extra longo" tem versões
de 0,25 m a 10 m — dizer o comprimento é a diferença entre encontrar e não encontrar.

**Preencher as 12 descrições em falta.** As descrições passaram a entrar no
prompt do bot e do cérebro: agora o bot responde "tem 2 metros?" em vez de
escalar ao dono. **Cada descrição escrita é uma pergunta que deixa de travar uma venda.**

**Palavras que o mercado local escreve:** `fones bluetooth Luanda`,
`carregador tipo C Angola`, `powerbank Luanda`, `capa iPhone Luanda`,
`entrega Luanda 24h`, `brincos sem fio` (sim — as pessoas procuram assim).

### Instagram e Facebook

- **Carrossel multi-produto e Reels curtos ganham.** Produto único com legenda
  genérica não passa de 1 ponto de engajamento.
- **Horas de ouro reais: 18h–24h**, com pico às 22h.
- **Pergunta no fim da legenda** gera comentários — e um comentário vale 3× um gosto.
- **Bio/perfil** tem de ter: `wa.me/244954949595` clicável, "Entregas em Luanda
  <24h" e o site. Sem isto o alcance orgânico não converte.
- **Hashtags locais** (`#luanda #angola #superloja` + categoria) valem mais que genéricas.
- **Nunca número de telefone na caption** — a guarda remove; o CTA é acrescentado
  pelo código. Nunca prometer entrega grátis nem garantias na legenda.

---

## 6. A API da SuperLoja: o que dá e o que falta

Base: `https://superloja.vip/api/store-api/superloja` (`X-Api-Key` + `X-Api-Secret`).

### Funciona (e já está a ser usado)
| Recurso | Nota |
|---|---|
| `GET /products` | paginado (`per_page`, `page`, `total`) — 86 produtos |
| `?search=fone` | **busca a sério** (devolveu 13 resultados) |
| `?in_stock=1` | filtra stock (84 de 86) |
| `?sort=price` | ordena por preço |
| `GET /categories` | 21 categorias com subcategorias |
| `GET /` (loja) | id, nome, slug, descrição, logo |

Campos por produto: `id, name, slug, price, original_price, currency, images,
category, subcategory_id, badge, rating, review_count, stock, description,
variants, is_featured, is_active, flash_sale_start/end, created_at, updated_at,
ae_product_id, ae_source_url, ae_cost, ae_currency, ae_last_synced_at`.

### Não existe (404)
`/orders` · `/customers` · `/stock` · `/analytics` · `/reviews`

### Existe mas está vazio — e é isso que dói
| Campo | Estado | O que se perde |
|---|---|---|
| `ae_cost` | **0 de 86 preenchidos** | sem custo não há **margem**: nenhuma decisão de anúncio sabe se a venda dá lucro |
| `rating` / `review_count` | **0 em todos** | sem prova social nas legendas nem no site |
| `original_price` | null | não se pode mostrar "antes 9.000, agora 7.500" |
| `variants` | null | as 7 versões de Tipo C são 7 produtos soltos em vez de variantes |
| `sort=best_selling` | **ignorado** (devolve o mesmo que um valor inválido) | não se sabe o que vende mais pela API |

### O que a API devia trazer, por ordem de valor

1. **`GET /orders`** — vendas com data, produtos, valor, estado. Hoje o cérebro
   decide anúncios com *conversas* como proxy; com vendas reais decide por
   **receita e margem**. É o dado que falta mais.
2. **`ae_cost` preenchido** (ou um campo `cost`) — sem custo, "subir orçamento" é
   sempre um palpite. Com custo, o cérebro escolhe o que anunciar por lucro.
3. **`sort=best_selling` a funcionar** (ou `sales_count` no produto) — os posts e
   os anúncios passariam a promover o que já se sabe que vende.
4. **`GET /analytics`** — visitas, produtos mais vistos, buscas sem resultado.
   *"Buscas sem resultado"* é a lista de compras ideal: o que as pessoas procuram
   no site e não encontram.
5. **`stock_history`** — quando esgotou e quanto tempo esteve esgotado, para
   medir venda perdida em vez de a adivinhar.
6. **`variants`** — agrupar os 7 Tipo C por comprimento acaba com a confusão de
   preços que já custou uma conversa.
7. **`rating`/`reviews`** — mesmo 5 avaliações reais mudam uma legenda.

---

## 7. Melhorias, por ordem de retorno

| # | O quê | Porquê |
|---|---|---|
| 1 | **Repor earbuds** (TWS 7.000, Disney T19) | procura ativa + melhor conversão da conta |
| 2 | **Pausar os 5 conjuntos com otimização errada** | liberta ~$20 que não medem nada |
| 3 | **Limpar 18 nomes + escrever 12 descrições** | SEO, busca no site e respostas do bot, de uma vez |
| 4 | **Preencher custo dos produtos** | desbloqueia decisões por margem em vez de por conversa |
| 5 | **Categorizar a sério** (21 categorias disponíveis) | navegação, filtros e SEO por categoria |
| 6 | **Duplicar a fórmula MEGA OFERTA** noutra categoria | testar se o multi-produto replica |
| 7 | **Acesso Avançado ao Instagram DM** | 9 respostas do bot nunca chegaram ao cliente |
| 8 | **Stock dos 36 produtos de 1 unidade** | 42% do catálogo não aguenta um anúncio que funcione |

---

## 8. Automatismos a correr

| Quando | O quê |
|---|---|
| 7h / 12h / 15h / 18h | posts (Reels, Stories, Carrossel, Single) — ideia da Fugu + texto do Haiku |
| 8h | alerta de stock |
| 10h e 22h | bot destila conversas → FAQ; **conselho resolve dúvidas** (Fugu + Hermes) |
| 10h | cobrar promessas |
| cada 10 min, 8h–20h | follow-up de abandono WhatsApp após 60 min: Fugu analisa → Hermes decide → AISA redige → guarda/bot entregam (1×); se for catálogo, inclui todo o stock; cron 18h é rede de segurança |
| **00h** | analytics · catálogo · sync do anúncio · **debate do Conselho** · **plano do cérebro para os anúncios** |
| 3h | backup |
| 6h | intelligence (comentários, leads, produtos em falta) |
| cada 30 min | watchdog com auto-reparação |
| Seg 8h40 / 9h / 9h30 | trends · sourcing AliExpress · relatório CEO |
| Dom 1h / 21h | CTA optimizer · reaprender marketing + relatório executivo + ideias criativas |

O debate do Conselho e o plano dos anúncios eram **semanais**; passaram a
**diários** — o quadro tinha 39 ideias paradas à espera de domingo.

**Diagnóstico da ligação:** `GET http://localhost:3333/api/hermes/status`
confirma o runtime Hermes, `ddgs`, configuração e o bridge da loja 3010 sem
invocar IA nem enviar mensagens. O openclaw 18789 é o canal separado da SOFTEC
e não é dependência do atendimento da SuperLoja.

---

## 9. Regras de comportamento do cérebro

1. **Decidir com dados.** Ler `/api/overview`, `/api/ads/auditoria`,
   `/api/interesse`, `/api/reports/executivo` antes de propor.
2. **Não gastar sem autorização.** Preparar tudo — campanha em pausa, criativos,
   público — e mostrar. Ativar é do dono.
3. **Um facto novo só vira regra depois de o dono confirmar.** Aí vai para
   `aprendizagens-confirmadas.json` (entra em todos os prompts) e/ou `bot-alma.md`.
4. **Reportar com números e próximo passo.** "CTR 0.79% em 3.526 impressões →
   trocar o gancho" vale mais que "o anúncio está fraco".
5. **Nunca inventar factos da loja.** Garantia, devolução, prazos, promoções,
   entrega fora de Luanda: só o que está confirmado. A guarda determinística
   (`text-guard.js`) corre sempre depois da IA — se ela cortou, escala ao dono.
6. **Não falar com clientes.** Nunca. É o bot que entrega.

### As políticas reais (as únicas)

| Tema | A verdade |
|---|---|
| Garantia | 1 dia depois de receber para verificar |
| Devolução | **só troca** — nunca dinheiro de volta |
| Factura | sempre que o cliente pedir |
| Entrega Luanda | <24h, paga por zona. Kilamba 700 · Zango 0–2 2.000 · Zango 3–5 / Camama / Golfe-Palanca 3.000 · Gamek / Viana / Catete-Bita 4.000 · Talatona 4.500 · Centro / Cazenga 5.000 · Rangel-Sambizanga / Cacuaco / Belas-Ramiros 5.500 · levantamento 0 Kz |
| ⚠️ Fonte das taxas | cópia. A verdadeira é `data/config/delivery-zones.json` (16 zonas, revista pelo dono a 02-Ago). **Confirmar lá antes de citar** — esta cópia esteve 11 dias a dizer Kilamba 500, Gamek 2000, Viana 3000 |
| Fora de Luanda | possível, **valor confirmado pelo dono** — nunca prometer |
| Levantamento | armazém do Kilamba |
| Atendimento | 8h–20h, todos os dias |
| Pagamento | na entrega |
