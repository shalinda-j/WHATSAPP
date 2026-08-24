# WhatsApp Marketing Automation Platform

A full-stack, multi-tenant, multi-channel marketing automation platform built on TypeScript. Originally a WhatsApp-only bot via [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys); now a complete CRM + AI agent orchestration system with WhatsApp, Telegram, and Email channels.

## Features

| Category         | Capabilities                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Channels**     | WhatsApp (Baileys), Telegram (long-poll), Email (SendGrid); Instagram/Facebook stubs pending Meta verification                |
| **AI Agents**    | Lead Qualifier, Personalization, Deal Closer, Content Recommender; Campaign Generator, Segmentation, Follow-up (cron-invoked) |
| **CRM**          | Contacts, Deals (Kanban pipeline), Activities, Lead Registrations with CV upload                                              |
| **Marketing**    | Campaigns, Segments (rule compiler → MongoDB), Content Studio (DALL-E / Stability AI), Approval Queue                         |
| **Admin Panel**  | React 18 + Vite + TailwindCSS dashboard with real-time Socket.io updates                                                      |
| **Multi-tenant** | Per-tenant credentials, plans, brand voice, budget caps                                                                       |

## Quick Start

### Prerequisites

- Node.js 22.22+
- MongoDB 6+ (Atlas or local)
- At least one AI provider key (Gemini, OpenAI, Groq, or OpenRouter)

### Install & Run

```bash
# Clone and install
git clone <repo-url>
cd WHATSAPP
npm install
cd client && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env — see Environment Variables below

# Development (backend + frontend concurrently)
npm run dev:all

# Production build
npm run build
npm run start
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Required
MONGODB_URI=mongodb://localhost:27017/whatsapp-bot
JWT_SECRET=your-secret-key-min-32-chars
ENCRYPTION_KEY=your-32-char-encryption-key

# AI Providers (at least one required)
GEMINI_API_KEY=your-gemini-key
OPENAI_API_KEY=your-openai-key
GROQ_API_KEY=your-groq-key
OPENROUTER_API_KEY=your-openrouter-key

# Optional — Email channel
SENDGRID_API_KEY=your-sendgrid-key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# Optional — Content Studio image generation
STABILITY_API_KEY=your-stability-key

# Optional — Admin panel port (default 8080)
PORT=8080
```

## Development Commands

```bash
npm run dev          # Backend with hot reload (ts-node-dev)
npm run client       # Frontend dev server (Vite, port 5000)
npm run dev:all      # Both concurrently
npm run build        # Production build (backend + frontend)
npm run lint         # ESLint
npm run test         # Jest tests
```

## Architecture

```
src/
├── index.ts                    # Entry point — message handler, agent orchestrator
├── server/
│   ├── app.ts                  # Express 5 app, middleware, route registration
│   ├── routes/                 # API routes (20+ routers)
│   └── middleware/             # Auth, tenant resolution, rate limiting
├── services/
│   ├── AILoadBalancer.ts       # Priority fallback: Groq → Gemini → OpenRouter → OpenAI
│   ├── AgentOrchestrator.ts    # Routes messages to specialist agents
│   ├── whatsapp.ts             # Baileys session manager (multi-session)
│   └── ...                     # 35+ other services
├── agents/                     # IAgent implementations
├── channels/                   # IChannelAdapter: WhatsApp, Telegram, Email, stubs
├── models/                     # 34 Mongoose models
└── config/                     # AI personality, prompts

client/src/
├── pages/                      # 17 admin panel pages
├── components/                 # Reusable components incl. workflow builder
└── hooks/                      # useDebounce, etc.
```

## Message Flow

```
Incoming Message
    ↓ Security check (SecurityService)
    ↓ Rate limit (1 s/user)
    ↓ Booking / Lead / Form active flow?  → handle → done
    ↓ Command (!prefix)?                  → CommandDispatcher → done
    ↓ NLP cache hit?                      → cached answer → done
    ↓ Agent Orchestrator
        ├── LeadQualifierAgent
        ├── PersonalizationAgent
        ├── DealAgent           ← triggers booking flow on shouldStartBookingFlow
        └── ContentRecommenderAgent
    ↓ AI Load Balancer (fallback chain)
    ↓ Text or Voice (TTS) response
```

## Admin Panel

Access at `http://localhost:8080` after starting the server.

Default login is created on first run — check server logs for credentials, or set `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` (or `ADMIN_USERNAME` / `ADMIN_PASSWORD`) in `.env`. (There is no `ADMIN_EMAIL` — the seeder reads a username, not an email.)

Key pages:

| Page           | Path         | Purpose                                     |
| -------------- | ------------ | ------------------------------------------- |
| Dashboard      | `/dashboard` | System overview, device status              |
| Sessions       | `/sessions`  | WhatsApp device management + QR             |
| CRM            | `/crm`       | Contacts, Deals, Activities, Registrations  |
| Agents Hub     | `/agents`    | Configure AI agents, approval queue, skills |
| Campaigns      | `/campaigns` | Create and launch marketing campaigns       |
| Content Studio | `/content`   | AI image generation for campaigns           |
| Channels       | `/channels`  | Telegram, Email, WhatsApp connections       |
| Datasets       | `/datasets`  | Knowledge base, AI personality, commands    |
| Workflows      | `/workflows` | Visual automation builder                   |
| Insights       | `/insights`  | Marketing analytics                         |

## Multi-tenant Setup

Single-tenant deployments work out of the box (a `default` tenant is auto-created). For multi-tenant:

1. Create tenants via **Admin → Tenants**
2. Add per-tenant channel credentials via **Channels**
3. Send `X-Tenant-Slug: <slug>` header from your client, or configure subdomain routing

Backfill existing data: `npx ts-node src/scripts/migrate-tenant-id.ts [--dry-run]`

## Security Notes

- All API routes require JWT authentication (`Authorization: Bearer <token>`)
- API keys stored encrypted (AES-256 via CryptoService)
- Meta webhook payloads verified with HMAC-SHA256 (`X-Hub-Signature-256`)
- CORS restricted to configured origins in production
- Rate limiting on all write endpoints

## License

MIT
