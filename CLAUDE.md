# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-channel, multi-tenant marketing automation platform built on TypeScript. Originally a WhatsApp-only bot via @whiskeysockets/baileys; now supports WhatsApp + Telegram + Email channels live (Instagram/Facebook adapters stubbed pending Meta business verification). A multi-agent orchestrator routes inbound messages to specialist agents (lead qualification, personalization, deal closing, content recommendation) and runs operator-invoked agents (campaign variant generation, segmentation, follow-up) on top of the same prompt-version + budget + feedback machinery. Express admin API, MongoDB for persistence, multiple AI providers (Gemini, OpenAI, Groq, OpenRouter) with automatic load balancing.

## Development Commands

```bash
# Development server (backend with hot reload)
npm run dev

# Frontend dev server (Vite on port 5000)
npm run client

# Run both backend and frontend concurrently
npm run dev:all

# Build production
npm run build        # Builds both client and backend
npm run build:client # Build frontend only

# Linting
npm run lint

# Tests
npm run test

# Production server
npm run start
```

## Architecture

### Core Layers

1. **WhatsApp Layer** (`src/services/whatsapp.ts`)
   - Session management via `WhatsAppSessionManager` class
   - Multi-session support with MongoDB auth state storage
   - Message handlers registered via `onMessage()` callback
   - Voice message queuing with retry on connection failure

2. **Message Processing** (`src/index.ts`)
   - Main entry point and message handler
   - Flow: Security check → Booking/Lead/Form flows → Commands → AI response
   - Rate limiting (1s between messages per user)
   - Language detection (Sinhala, Tamil, Hindi, English)
   - Voice transcription with fallback chain (OpenAI → Gemini)
   - Voice response generation with TTS

3. **Command System** (`src/app/commands/`)
   - Interface-based: All commands implement `ICommand` interface
   - Dispatcher pattern: `commandDispatcher` registers and routes commands
   - Class-based commands: `!help`, `!ping`, `!register`, `!jobs`, `!book`, etc.
   - Legacy switch-case fallback in `handleCommand()` for script commands

4. **AI Layer** (`src/services/AILoadBalancer.ts`)
   - Priority-based fallback: Groq → Gemini → OpenRouter → OpenAI
   - Persistent conversation history via `ConversationHistoryService`
   - Auto-learning from conversations via `KnowledgeTrainingService`
   - Usage tracking in MongoDB Config collection

4b. **Multi-agent orchestrator** (`src/services/AgentOrchestrator.ts`, `src/agents/`)

- Specialist agents implement `IAgent`: `canHandle()` is a sub-millisecond keyword pass, `execute()` is the LLM-backed body
- Registered conversational agents: `LeadQualifierAgent`, `PersonalizationAgent`, `DealAgent`, `ContentRecommenderAgent`
- Operator/cron-invoked agents: `CampaignGeneratorAgent`, `SegmentationAgent`, `FollowUpAgent`
- Orchestrator gates execution on budget caps + agent mode (`autonomous` / `approval` / `disabled`)
- Approval mode routes proposed outbound to `AgentApprovalQueue` for operator review
- Feedback flywheel: Lead/Booking outcome changes correlate back to recent agent executions via `agentReflectionService.correlateLeadOutcome` / `correlateBookingOutcome`

5. **Admin API** (`src/server/app.ts`)
   - Express 5.x with CORS, JSON parsing
   - MongoDB connection middleware with retry
   - Protected routes via `authenticateToken` JWT middleware
   - Socket.io for real-time dashboard updates

6. **Frontend** (`client/`)
   - React 18 + Vite + TailwindCSS
   - Pages: Sessions, Chat, Leads, CRM, Analytics, Forms, Workflows, etc.
   - Marketing pages: Channels, Campaigns, Segments, Marketing Insights, Tenants
   - Socket.io client for live updates

7. **Multi-channel layer** (`src/channels/`)
   - `IChannelAdapter` interface + `ChannelRouter` registry — outbound `send()` + inbound dispatch in a channel-agnostic surface
   - Live adapters: `WhatsAppAdapter` (delegates outbound to legacy session manager; legacy onMessage still owns inbound to avoid double-processing), `TelegramAdapter` (long-poll via axios, `getMe` health probe), `EmailAdapter` (SendGrid v3 REST via axios)
   - Stub adapters: `InstagramAdapter`, `FacebookMessengerAdapter` — code present, waiting on Meta business verification
   - `channelRouter.onInbound(handler)` lets the orchestrator subscribe once; the WhatsApp adapter skips inbound dispatch to keep the legacy chain authoritative

8. **Multi-tenant layer**
   - `Tenant` model (slug, plan, status, brand voice, per-tenant budget caps)
   - `ChannelConnection` model (per-tenant credentials per channel)
   - `resolveTenant` middleware: `X-Tenant-Slug` header → JWT `tenantId` → `default` fallback; auto-creates the `default` tenant so single-tenant deployments keep working
   - Migration script: `npx ts-node src/scripts/migrate-tenant-id.ts [--dry-run] [--slug=default]` backfills `tenantId` on every legacy collection

9. **Marketing pipeline**
   - `MarketingCampaign` / `ContactSegment` / `CampaignExecution` models
   - `SegmentRuleCompiler` — pure compile-rules-to-Mongo function (12 unit tests)
   - `CampaignService.launch` — honours `segmentId` via `SegmentationService.materialise`, falls back to broadcast
   - `CampaignService.tickSender` — 30s interval, per-campaign rate limit, quiet hours, single-writer guard (queued → sending → sent)
   - `FollowUpScheduler` — 5-min interval, picks dormant Leads (`updatedAt < now − 5d`), gated on `AgentConfig.find({name:'follow_up'}).mode`

### Key Services

| Service                       | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `ConfigurationManagerService` | Centralized config from MongoDB Datasets |
| `HumanizerService`            | Message delay/queue for natural feel     |
| `FormService`                 | Dynamic multi-field form flows           |
| `BookingService`              | Appointment scheduling flow              |
| `LeadService`                 | Lead registration workflow               |
| `NLPService`                  | Local NLP cache for quick answers        |
| `VoiceCallAgentService`       | Auto-response to incoming calls          |
| `WebhookService`              | External webhook triggers                |

### MongoDB Models

Models in `src/models/`: Session, Config, Lead, Booking, ChatMessage, FormSubmission, FormTemplate, VoiceConfig, KnowledgeEntry, ConversationHistory, etc.

## Adding New Features

### Add a Command

```typescript
// 1. Create src/app/commands/NewCommand.ts
import { ICommand } from '../interfaces/ICommand';
import { proto } from '@whiskeysockets/baileys';
import { sendMessage, getSenderJid } from '../../services/whatsapp';

export class NewCommand implements ICommand {
  name = 'newcommand';
  description = 'Description';
  aliases = ['alias1'];

  async execute(
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string,
  ): Promise<void> {
    const jid = getSenderJid(message);
    if (!jid) return;
    await sendMessage(jid, 'Response', sessionId);
  }
}

// 2. Register in src/app/commands/index.ts
import { NewCommand } from './NewCommand';
commandDispatcher.register(new NewCommand());
```

### Add an AI Provider

1. Create service in `src/services/` implementing `AIService` interface
2. Add to `AILoadBalancer._doLoadServices()` with providerType check
3. Add to priority map in `AILoadBalancer`
4. Seed via Admin Panel → Config → AI Providers

### Add an API Route

1. Create router in `src/server/routes/`
2. Register in `src/server/app.ts` with `authenticateToken` middleware

## Environment Variables

Required in `.env`:

- `MONGODB_URI` - MongoDB connection string (required for admin panel)
- `JWT_SECRET` - Admin panel authentication
- `ENCRYPTION_KEY` - 32-char key for encrypting stored API keys
- `GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` - AI providers (at least one)

## Session Management

Sessions are stored in MongoDB with auth state. Key behaviors:

- Auto-starts all non-deleted sessions on boot
- QR code stored in DB, displayed in admin panel
- Conflict (440) handled with exponential backoff, NOT state wipe
- Logout (401) clears state and restarts for new QR
- `deletedSessions` set prevents auto-restart of deleted sessions

## Message Flow

```
Incoming Message
    ↓
Security Check (SecurityService)
    ↓
Rate Limit Check (1s/user)
    ↓
Booking Flow? → Handle → Return
    ↓
Lead Flow? → Handle → Return
    ↓
Form Flow? → Handle → Return
    ↓
Command (!prefix)? → Dispatch → Return
    ↓
NLP Cache Check
    ↓
AI Load Balancer (fallback chain)
    ↓
Voice? → TTS Response
Text? → Text Response
```

## Language Handling

- Default response language: Sinhala (`si`)
- Detection: Unicode script detection for Sinhala (U+0D80-U+0DFF), Tamil, Hindi
- English detected if only ASCII letters
- Voice messages: Language detected during transcription
- Response prompt appended with language instruction

## Debugging

Health check: `curl http://localhost:8080/health`

Key log markers:

- `📩` Message received
- `🤖` AI provider activity
- `✅` Success
- `❌` Error
- `⚠️` Warning
- `📞` Call handling
- `🎤` Voice processing
- `📅` Booking flow
- `📝` Lead/Form flow

## TypeScript Patterns

Use type assertion for Mongoose models to avoid deep instantiation errors:

```typescript
export default mongoose.model(
  'Model',
  Schema as any,
) as unknown as mongoose.Model<IModel>;
```

Always check JID before use:

```typescript
const jid = message.key?.remoteJid;
if (!jid) return;
```
