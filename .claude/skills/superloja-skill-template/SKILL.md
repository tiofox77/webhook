---
name: superloja-skill-template
description: Modelo/exemplo de skill SuperLoja carregada a partir da pasta externa do projeto (.claude/skills). Serve de referência para criar novas skills que o Hermes consegue puxar sem falhar.
trigger: quando o dono pede um "modelo de skill", "exemplo de skill", "template de skill", ou quer saber como criar uma skill SuperLoja que o Hermes carregue sem falhar
category: reference
---

# Modelo de Skill SuperLoja (carregada da pasta externa)

Esta skill **vive fora** de `~/.hermes/skills/` — está em
`C:\superloja\webhook-server\.claude\skills\` e o Hermes vê-a porque essa pasta
foi adicionada a `skills.external_dirs` no `config.yaml`. Se estás a ler isto
dentro do Hermes, o pipeline funciona. ✅

## Regras para uma skill NÃO falhar

1. **Localização**: `C:\superloja\webhook-server\.claude\skills\<nome>\SKILL.md`
   (uma pasta por skill, ficheiro sempre chamado `SKILL.md`).
2. **Frontmatter obrigatório** (o bloco `---` no topo):
   - `name:` — sem isto o Hermes rejeita com "Skill '' not found".
   - `description:` — resumo curto do que faz.
   - `trigger:` — as palavras/situações em que o Hermes deve puxar a skill.
     É ISTO que o faz saber QUANDO usá-la.
3. **Depois de criar ou editar**: no WhatsApp manda `/reload-skills` ao Hermes
   (ou reinicia o gateway) para ele re-scanear e registar a skill.

## Como duplicar

Copia esta pasta, muda o `name:`, a `description:`, o `trigger:` e o corpo.
Mantém o `SKILL.md`. Corre `/reload-skills`. Pronto.

## Corpo da skill

Aqui escreves as instruções/procedimento que queres que o Hermes siga quando a
skill é puxada — comandos, endpoints, regras. Exemplo real do projeto:
`GET http://localhost:3333/api/ads` lista os anúncios pagos com estado do Meta.
