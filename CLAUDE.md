# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp AI Bot - a multi-device WhatsApp bot built with TypeScript, using @whiskeysockets/baileys for WhatsApp connectivity, Express for the admin API, MongoDB for persistence, and multiple AI providers (Gemini, OpenAI, Groq, OpenRouter) with automatic load balancing.

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

5. **Admin API** (`src/server/app.ts`)

   - Express 5.x with CORS, JSON parsing
   - MongoDB connection middleware with retry
   - Protected routes via `authenticateToken` JWT middleware
   - Socket.io for real-time dashboard updates

6. **Frontend** (`client/`)
   - React 18 + Vite + TailwindCSS
   - Pages: Sessions, Chat, Leads, CRM, Analytics, Forms, Workflows, etc.
   - Socket.io client for live updates

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
