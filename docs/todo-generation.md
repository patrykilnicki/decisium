# Integration To-Do Generation

This feature generates a normalized to-do list from connected app signals (Composio-backed integrations), then stores snapshots for UI and agent reuse.

## Trigger Modes

- **System-triggered**:
  - after `/api/integrations/[provider]/sync`
  - during `/api/cron/integration-sync`
  - dispatched via `dispatchTodoGenerationTask()`
- **Conversation-triggered**:
  - orchestrator can call `generate_todo_list` tool
  - supports `mode=latest|regenerate`

## API

- `GET /api/integrations/todos`
  - returns latest snapshot by default
  - supports query params: `mode`, `persist`, `maxItems`, `windowHours`
- `POST /api/integrations/todos`
  - explicit regenerate path (default mode: regenerate)
- `GET /api/integrations/todos/history`
  - paginated snapshot history

## Persistence

- Table: `todo_snapshots`
  - stores generated payload and generation window
  - supports replay and downstream processing

## Idempotency / Guardrails

- Dispatcher applies cooldown window to avoid duplicate task fan-out.
- Generator deduplicates by normalized `(provider + title)`.
- Deterministic priority scoring uses provider, urgency keywords, and context features.
