# SuperLoja — webhook-server

Loja de electrónica em Luanda, Angola. Este repositório é o cérebro: bot de
atendimento (WhatsApp/Messenger/Instagram), dashboard de gestão, anúncios Meta,
e o ciclo de aprendizagem que liga tudo.

**Português de Angola em todo o lado.** Código, comentários, mensagens ao
cliente, respostas ao dono. UTF-8 sempre.

## Antes de mexer em código, lê

| Documento | O que traz |
|---|---|
| `docs/BOT-ESTRUTURA.html` | armadilhas do bot — cada uma custou uma venda real |
| `docs/ARQUITETURA.html` | mapa do sistema + CHANGELOG (o que já foi tentado e falhou) |
| `docs/PRD.md` | §7 receitas de verificação · §8 mais armadilhas |

O CHANGELOG não é decoração: metade das ideias "novas" já foram tentadas e
estão lá com a razão de terem sido revertidas.

## Regra permanente

**Depois de cada mudança relevante, actualiza `docs/ARQUITETURA.html` (incluindo
o CHANGELOG) e `docs/PRD.md`.** Estes documentos são o que a próxima IA lê para
continuar; desactualizados, fazem mais mal do que bem.

## Os quatro agentes

| Quem | Papel | Escreve código? |
|---|---|---|
| **Claude Code** (Windows) | implementa e testa | ✅ o único |
| **Hermes** (MiniMax, via WhatsApp) | decide operação: dúvidas de negócio, anúncios, follow-up | ❌ |
| **Prime Agent** (WSL) | audita, investiga, recomenda — contrato em `C:/superloja/data/prime-agent/README.md` | ❌ |
| **AISA / Fugu** (APIs) | Fugu pensa · Haiku escreve | ❌ |

*Fugu pensa · Haiku escreve · Hermes decide · o bot entrega.*

## Leis que não se negoceiam

1. **Nunca inventar factos de negócio.** Garantia, entregas, horários, preços,
   promoções: só o que o dono confirmou (`data/crm/bot-alma.md`,
   `data/crm/aprendizagens-confirmadas.json`). Na dúvida, o bot diz que vai
   confirmar — nunca adivinha.
2. **O Hermes nunca fala com clientes.** Tem acesso ao terminal; expô-lo a
   desconhecidos é expor a máquina.
3. **Dinheiro é do dono.** Activar anúncios, mudar orçamentos, dar descontos:
   proposta sim, execução nunca sem aprovação explícita.
4. **A guarda vem por último.** `text-guard.js` corre sempre no fim, sobre tudo
   o que sai para um cliente. Prompt melhor não substitui guarda determinística
   — a IA já inventou um número de WhatsApp em 7 posts publicados.

## Portas

| Porta | Serviço |
|---|---|
| 3333 | dashboard (`dashboard.js`) |
| 3335 | bot (`messenger-chatbot.js`) |
| 3010 | bridge WhatsApp do Hermes — **on-demand**, DOWN é normal |
| 18789 | openclaw (mesmo número, outro gateway) |

## Reiniciar

Nunca por `taskkill` — o antivírus bloqueia kills externos. Por sinal:

```bash
curl -s -X POST http://localhost:3333/api/system/restart -H "Content-Type: application/json" -d '{"confirmation":"REINICIAR"}'
```

## Armadilhas que mordem já na primeira hora

- **`dashboard.js`: o JS do cliente vive num template literal.** Um `\n` singelo
  não escapado mata o script inteiro e o dashboard fica mudo sem erro visível.
  `confirm()` está suprimido dentro dos painéis.
- **Marcadores de patch são case-sensitive.** `ensure-bridge-patch.js` já
  aplicou o mesmo patch 108 vezes porque o marcador dizia `esta` e o código
  `ESTA`. O texto do marcador tem de existir *literalmente* no que é inserido.
- **`per_page` fixo trunca o catálogo em silêncio** — o bot passa a jurar que um
  produto não existe.
- **Estado em memória perde-se no restart** (`_dj`, `_mostrados`): o bot esquece
  que o dono assumiu a conversa e fala por cima dele.
- **No Windows, o `bash` do PATH é o do WSL, não o Git Bash.** Scripts com
  caminhos `/c/...` só funcionam no Git Bash.

Lista completa: `docs/BOT-ESTRUTURA.html` §6 e `docs/PRD.md` §8.

## Depois de alterar código

```bash
node impressoes-codigo.js --gravar "claude-code: <o que mudaste>"
```

O watchdog compara de 30 em 30 min e avisa o dono no WhatsApp se um `.js` vigiado mudar
sem passar por aqui — o Prime Agent já escreveu em produção uma vez (07-Ago). Se não
regravares, o próximo check dá alarme falso.

## Testes

```bash
node tests-guarda.js
```

19 casos de regressão da guarda anti-alucinação. Correr sempre que se tocar em
`text-guard.js` — a guarda já censurou verdades confirmadas ("só pagas quando o
produto chegar à tua mão") por falta de excepção.
