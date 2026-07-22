# Bizcore Console

Multi-tenant SaaS operating system for businesses. A Super
Admin provisions boutique tenants; each tenant gets an isolated dashboard for
customers, communications, their website content, social media, and an AI
marketing assistant.

> **Status:** feature-complete against the original spec — multi-tenancy,
> auth, Super Admin panel, and all seven tenant dashboard modules are
> built and tenant-isolation audited. Automated tests (Vitest + Playwright)
> cover auth, RBAC, tenant isolation, and the core user flows.

## Stack

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, React Router, Axios, Recharts, lucide-react
- **Backend:** Node.js + Express + TypeScript, Prisma ORM (SQLite for local dev, one-line swap to PostgreSQL), JWT auth via httpOnly cookie, Multer, xlsx, node-cron, nodemailer + multi-provider SMS adapter
- **AI:** OpenAI API (server-side only, key never reaches the frontend)
- **Testing:** Vitest + Supertest (backend), Playwright (E2E)

## Project structure

```
kaleri-saree-console/
├── README.md
├── frontend/                # React app
│   └── src/
│       ├── components/      # Sidebar, TopBar, Button, Card, Modal, Table, SuperAdminShell
│       ├── pages/
│       │   ├── tenant/      # Login, Home, Customers, Communication, Website, SocialMedia, AIAssistant, Settings
│       │   └── super-admin/ # Businesses, AddBusiness, BusinessDetail, AuditLog
│       ├── api/
│       └── App.tsx
└── backend/                 # Express API
    ├── tests/               # Vitest + Supertest — auth, RBAC, tenant isolation, etc.
    └── src/
        ├── app.ts           # builds the Express app (no side effects — imported by tests)
        ├── index.ts         # entry point: app.listen + cron scheduler
        ├── routes/          # auth, customers, products, banners, offers, communication, social, ai, scheduling, settings, super-admin
        ├── integrations/    # instagram.ts, facebook.ts, whatsapp.ts, email.ts, sms.ts
        ├── middleware/      # auth, resolveTenant, authorize, rateLimit
        ├── jobs/            # cron scheduler
        └── prisma/schema.prisma
```

## Prerequisites

- Node.js 20+
- npm

## Backend setup

```bash
cd backend
npm install
cp .env.example .env       # fill in JWT_SECRET, CREDENTIAL_ENCRYPTION_KEY, OPENAI_API_KEY, etc.
npm run prisma:generate
npm run prisma:migrate     # applies migrations against the local SQLite db (dev.db)
npm run seed                # seeds the "Kaleri Saree" demo tenant + sample data
npm run dev                  # starts the API on http://localhost:4000
```

### Switching from SQLite to PostgreSQL

The schema at `backend/prisma/schema.prisma` avoids Postgres-only types
(native arrays, `Decimal`, real `enum`s) so it runs unmodified on either
database. To move to Postgres:

1. In `schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"` under `datasource db`.
2. Point `DATABASE_URL` in `.env` at your Postgres connection string.
3. Run `npm run prisma:migrate` again to apply migrations to the new database.

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env       # defaults work with the Vite dev proxy, no changes needed locally
npm run dev                 # starts the app on http://localhost:5173
```

The Vite dev server proxies `/api/*` requests to `http://localhost:4000`, so
run the backend alongside the frontend during development.

## Running both together

Open two terminals:

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

Then visit `http://localhost:5173`.

## Testing

**Backend (Vitest + Supertest)** — runs against an isolated SQLite database
(`backend/prisma/test.db`, gitignored), completely separate from `dev.db`.
Resets and reseeds automatically on every run.

```bash
cd backend
npm test              # run once
npm run test:watch    # watch mode
```

Covers: login/rate-limiting/forced-password-change, RBAC boundaries
(ADMIN vs SUPER_ADMIN), tenant isolation (cross-tenant access returns 404
for every resource type), customer CRUD + CSV import, dashboard summary
correctness, AI generation (mocked OpenAI — no real API calls or cost),
Settings credential encryption, and the WhatsApp/Instagram/Facebook/SMS
adapters' mock-vs-live behavior.

**E2E (Playwright)** — drives the real app in a browser against the real
backend. **Resets `backend/dev.db`** before running (same database
`npm run dev` uses) — stop any dev servers you're using for manual testing
first, since this will overwrite that data with a fresh seed.

```bash
cd frontend
npx playwright install chromium   # first time only
npm run test:e2e                  # headless
npm run test:e2e:ui               # interactive UI mode
```

Covers: role-based login redirect, the forced password-change flow,
Super Admin business lifecycle (create/suspend/reactivate, audit log),
and a smoke pass through every tenant dashboard module.

## Environment variables

See `backend/.env.example` and `frontend/.env.example` for the full list.
Notably:

- `OPENAI_API_KEY` — required for the AI Marketing Assistant; only ever read server-side. Leave blank to develop against the clean "not configured" state; adding a key later needs a backend restart, not a code change.
- `CREDENTIAL_ENCRYPTION_KEY` — 32-byte hex key used to encrypt per-tenant Meta/WhatsApp credentials at rest.
- `SMTP_*` — used to email temporary credentials to newly provisioned tenant admins. Works with any SMTP-speaking provider (SendGrid, Resend, SES, Postmark, ...) — see `backend/.env.example` for per-provider settings.
- `SMS_PROVIDER` (`twilio` | `msg91` | `textlocal`) plus that provider's own credentials — used for the same credential delivery, SMS side. Switching providers is an env var change only.
- Both email and SMS run in a clearly-flagged mock mode until configured; per-tenant WhatsApp/Instagram/Facebook credentials are configured separately, per business, via the Settings page.
