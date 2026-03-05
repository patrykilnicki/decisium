---
name: embed-prompts-after-edit
description: Regenerates prompts-embedded.ts after editing agent prompts. Use when editing any .md file in packages/agents/prompts/ (orchestrator-agent.md, main-agent.md, ask-subagent.md, root-agent.md, router-agent.md) or when the user mentions updating prompts.
---

# Embed Prompts After Edit

## Rule

After editing any prompt file in `packages/agents/prompts/`, always run:

```bash
pnpm exec tsx scripts/embed-prompts.ts
```

## When to Run

- Edit to `orchestrator-agent.md`, `main-agent.md`, `ask-subagent.md`, `root-agent.md`, or `router-agent.md`
- User asks to change, update, or modify agent prompts
- User mentions "embed prompts" or "regenerate prompts"

## What It Does

The script reads the .md prompt files and writes `packages/agents/prompts/prompts-embedded.ts`. The app imports prompts from the embedded file (for serverless/Vercel); edits to .md alone are not applied until the embed script runs.
