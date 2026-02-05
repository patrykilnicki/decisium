# Daily Intelligence SaaS

A personal daily journaling and AI-powered reflection assistant built with Next.js, DeepAgents, and Supabase.

## Features

- **Daily Flow**: Chat-like interface for daily journaling with event-based memory (no threads)
- **Ask AI**: Traditional chat interface with thread-based memory for deep exploration
- **Automatic Summaries**: Daily, weekly, and monthly summaries generated automatically
- **Semantic Memory**: Vector-based semantic search across your history
- **DeepAgents**: Powered by LangChain DeepAgents with built-in planning and subagents

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Server Actions
- **Database**: Supabase (PostgreSQL with pgvector)
- **AI**: DeepAgents (LangChain.js), OpenAI/Anthropic/OpenRouter
- **Authentication**: Supabase Auth

## Setup

### Prerequisites

- Node.js 20+
- pnpm
- Supabase account
- OpenAI API key (or Anthropic/OpenRouter)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd decisium
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your credentials:

- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key
- `OPENAI_API_KEY`: Your OpenAI API key (or `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`)
- `CRON_SECRET`: Secret for securing cron endpoints

4. Set up Supabase database:

Run the migrations in `supabase/migrations/`:

- `001_initial_schema.sql` - Creates all tables
- `002_enable_pgvector.sql` - Enables pgvector extension
- `003_indexes.sql` - Creates performance indexes

You can run these via Supabase Dashboard SQL Editor or using Supabase CLI.

5. **Backfill embeddings (required for memory search):**  
   Ask AI and semantic memory search use the `embeddings` table only. If you have existing `daily_events` or summaries (e.g. from `004_seed_ui_designer_data.sql`) but no embeddings, memory retrieval returns nothing. Run:

   ```bash
   pnpm backfill-embeddings
   ```

   Optional: `pnpm backfill-embeddings --user-id=<UUID>` to limit to one user.

6. Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. If Ask AI shows "No relevant memories found." despite having events/summaries, run `pnpm backfill-embeddings` (see step 5).

7. **Run the task worker (required for Daily and Ask AI responses):**  
   Sending a message in Daily or Ask AI creates a **pending task** in the database. A separate worker process must be running to claim and run those tasks (classify, retrieve memory, generate response, save events). If the worker is not running, messages will stay in a "thinking" / pending state and the agent will never reply.

   **Option A – one command (recommended for local dev):** run both Next.js and the worker together:

   ```bash
   pnpm dev:all
   ```

   **Option B – two terminals:** run `pnpm dev` in one terminal and `pnpm task-worker` in another. The worker needs the same env (e.g. `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) to process tasks.

   **Production (Vercel):** Tasks are processed **immediately** after enqueueing (fire-and-forget), so users get responses right away. Vercel Cron also runs `/api/cron/process-tasks` every minute as a backup to catch any failures or missed tasks (see [Cron Jobs](#cron-jobs)).

## Project Structure

```
decisium/
├── app/                    # Next.js App Router
│   ├── daily/             # Daily flow pages
│   ├── ask/               # Ask AI flow pages
│   ├── api/               # API routes
│   └── actions/           # Server actions
├── components/             # React components
│   ├── auth/              # Authentication components
│   ├── daily/             # Daily UI components
│   ├── ask/                # Ask AI UI components
│   └── layout/             # Layout components
├── lib/                    # Utility libraries
│   ├── supabase/           # Supabase clients
│   ├── memory/             # Memory retrieval
│   └── embeddings/         # Embedding generation
├── packages/
│   └── agents/             # DeepAgents package
│       ├── core/           # Root agent
│       ├── tools/          # Custom tools
│       └── schemas/         # Type schemas
└── supabase/
    └── migrations/         # Database migrations
```

## Architecture

### Daily Flow

- Event-based: Each message is atomic, no conversation threads
- Automatic classification: Notes, questions, or note+question
- One-shot responses: Agent responds to questions but doesn't continue conversation

### Ask AI Flow

- Thread-based: Full conversation context maintained
- Memory retrieval: Hierarchical search (monthly → weekly → daily → raw)
- Deep exploration: Agent uses full context for comprehensive answers

### Memory System

- Hierarchical: Monthly summaries → Weekly summaries → Daily summaries → Raw events
- Semantic search: Vector embeddings with pgvector
- Progressive condensation: History becomes more condensed as it ages

### DeepAgents

- Root agent orchestrates all workflows
- Uses built-in planning (`write_todos`) for task decomposition
- Spawns subagents via `task` tool for specialized work
- File system tools manage large contexts

### Task processing (worker / cron)

Daily and Ask AI run **agent workloads in the background** (enqueue task → return immediately → worker or cron processes the task). This matches **LangChain/LangGraph** and **industry** practice:

- **LangGraph** is described as a runtime for *"long-running, stateful agents"* with *"durable execution"* ([LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)). The [LangSmith Deployment](https://docs.langchain.com/oss/javascript/langgraph/deploy) doc states that *"Traditional hosting platforms are built for stateless, short-lived web applications. LangSmith Cloud is purpose-built for stateful, long-running agents that require persistent state and **background execution**."*
- **LangSmith production** uses a **queue + workers** model: *"Queue scalability: As you add more instances, they increase run throughput linearly... Each attempt for each run will be handled by a single instance"* ([Scalability & resilience](https://docs.langchain.com/langgraph-platform/scalability-and-resilience)).
- **Industry guidance** is to decouple orchestration from HTTP: keep endpoints thin (validate, auth) and delegate LLM/agent work to a separate service or queue so you avoid timeouts, get retries, and scale independently.

So we use a **worker** (local: `pnpm task-worker` or `pnpm dev:all`) or **cron-invoked processing** (production: `/api/cron/process-tasks` every minute) rather than running the full agent pipeline inside the request.

## Cron Jobs

**Production (Vercel):** Tasks are processed **immediately** after enqueueing (no waiting). The cron job `/api/cron/process-tasks` runs every minute as a backup to catch failures or missed tasks—no separate worker process needed.

Other cron jobs:

- **Process tasks (Daily / Ask AI)**: `GET /api/cron/process-tasks` (every 1 min – processes pending agent tasks)
- **Daily Summary**: `POST /api/cron/daily-summary` (run daily at 20:00–22:00 user timezone)
- **Weekly Summary**: `POST /api/cron/weekly-summary` (run weekly on Sundays)
- **Monthly Summary**: `POST /api/cron/monthly-summary` (run monthly on 1st)

Include `Authorization: Bearer <CRON_SECRET>` header for manual POST triggers.

Example with Vercel Cron:

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-summary",
      "schedule": "0 20 * * *"
    }
  ]
}
```

## Development

### Type Checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
```

### Building

```bash
pnpm build
```

## License

Private - All rights reserved
