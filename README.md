# Zeno — V2 AI Sales Agent

Next.js 16 + Prisma 7 + Postgres 16. AI sales agent for Allianz-Tiriac Protect (Romanian life insurance).

## Prerequisites

- **Node.js 22+** (developed on v22.14.0)
- **npm 10+**
- **Docker Desktop** (for local Postgres)
- **git**

## First-time setup on a new machine

```bash
# 1. Clone
git clone <this-repo-url> Zeno
cd Zeno

# 2. Install dependencies
npm install

# 3. Create your local .env
cp .env.example .env
# Then edit .env and fill in real values (see "Required env vars" below).
# IMPORTANT: .env is gitignored — secrets are NOT in this repo.
# Bring the .env from your other machine (USB / 1Password / etc.).

# 4. Start Postgres (port 5435 — 5434 is reserved on Vasi's main machine)
docker compose up -d

# 5. Run database migrations
npx prisma migrate deploy

# 6. Generate the Prisma client
npx prisma generate

# 7. Seed baseline data (users, products, questions, agents, skill-packs, simulator persona)
npx prisma db seed

# 8. Start the dev server
npm run dev
# → http://localhost:3000
```

## Required env vars

See `.env.example` for the full list. Minimum to run dev locally:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (default points at the Docker container on `localhost:5435`) |
| `OPENAI_API_KEY` | LLM calls (required) |
| `ANTHROPIC_API_KEY` | LLM calls (required) |
| `JWT_SECRET` | Session signing — any 64-char hex |
| `ENCRYPTION_KEY` | PII encryption — 64-char hex (32 bytes) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin login |
| `APP_URL` | `http://localhost:3000` for dev |
| `PAYMENT_PROVIDER` | `mock` for dev |
| `EMAIL_PROVIDER` | `mock` for dev |

## Common scripts

```bash
npm run dev         # Next.js dev server
npm run build       # Production build
npm test            # Vitest unit tests
npm run test:e2e    # Vitest e2e tests
npm run simulate    # Run customer simulation against the running app
npx prisma studio   # DB browser at localhost:5555
```

## Customer simulation

The simulation harness drives synthetic customers through the chat. It expects the app to be running (`npm run dev`).

```bash
npm run dev          # terminal 1
npm run simulate     # terminal 2
```

Admin dashboard: http://localhost:3000/admin/simulation

## Project layout

- `app/` — Next.js App Router (chat, admin, API routes)
- `lib/agents/` — agent definitions and the agent runtime
- `lib/simulation/` — customer simulation runner, personas, scenarios
- `prisma/` — schema, migrations, seeds
- `docs/` — design specs and the master transformation plan
