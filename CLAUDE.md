# WhatsApp AI Bot - Project Instructions

## Project Context
This is a WhatsApp AI Bot with voice capabilities, CRM integration, multi-AI provider load balancing, and real-time chat interface.

## Key Technologies
- **Backend**: Express.js, TypeScript, MongoDB (Mongoose)
- **Frontend**: React, Vite, Tailwind CSS, Socket.io
- **WhatsApp**: @whiskeysockets/baileys
- **AI**: Multiple providers (Gemini, OpenAI, Groq, OpenRouter)

## Build Commands
```bash
npm run dev          # Development server with hot reload
npm run client       # Frontend dev server only
npm run dev:all      # Both backend and frontend
npm run build        # Production build
npm run test         # Run tests
```

## Project Structure
```
src/
├── index.ts           # Main entry, WhatsApp message handling
├── server/            # Express routes, middleware, controllers
├── models/            # Mongoose schemas
├── services/          # Business logic (AI, Voice, NLP, etc.)
├── app/               # Command handlers and utilities
└── config/            # Configuration files

client/src/
├── pages/             # React page components
├── components/        # Reusable UI components
└── services/          # Client-side services
```

## Development Patterns

### Adding a New Command
1. Create file in `src/app/commands/` implementing `ICommand`
2. Register in `src/app/commands/index.ts`

### Adding a New API Route
1. Create route file in `src/server/routes/`
2. Register in `src/server/app.ts` with auth middleware

### Adding a New Model
1. Create model in `src/models/` with interface and schema
2. Use the `as any` pattern to avoid TypeScript deep instantiation errors

## TypeScript Configuration
- Frontend uses relaxed settings: `noUnusedLocals: false`
- Model pattern: `mongoose.model('Name', Schema as any) as unknown as mongoose.Model<IModel>`

## Error Handling
- 503: Database not connected - check MongoDB status
- 429: Rate limit exceeded - fallback to next AI provider
- Always use try-catch in async handlers

## Code Style
- Use emoji prefixes for console logs (📩, 🤖, ✅, ❌, ⚠️)
- Handle null/undefined before using JID
- Fire-and-forget for non-critical operations

## Testing
- Run `npm run test` before committing
- Add tests for new business logic
- Maintain minimum 80% coverage for critical paths

## Memory & Skills
- See `.claude/memory/` for detailed architecture docs
- See `.claude/skills/development.md` for common patterns
- See `.claude/SOP-TEAM-AGENT-ARCHITECTURE.md` for team workflow