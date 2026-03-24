# WhatsApp Bot Admin Panel

## Overview

A full-stack WhatsApp bot management platform built with Node.js/TypeScript backend and React frontend. It provides an admin panel to manage WhatsApp sessions, configure AI providers, handle leads, run marketing campaigns, and configure automation workflows.

## Architecture

- **Backend**: Node.js + TypeScript + Express, running on port 8080
- **Frontend**: React + Vite + TailwindCSS, running on port 5000 (proxies API to backend)
- **Database**: MongoDB (external, via `MONGODB_URI`)
- **Real-time**: Socket.io
- **WhatsApp**: @whiskeysockets/baileys library for multi-device support

## Project Structure

```
/
├── src/                  # Backend TypeScript source
│   ├── index.ts          # Main entry point
│   ├── server/           # Express app, routes, middleware
│   ├── services/         # Business logic (AI, WhatsApp, NLP, etc.)
│   ├── models/           # Mongoose models
│   ├── app/              # Commands and utilities
│   └── config/           # Configuration files
├── client/               # React frontend (Vite)
│   └── src/              # Frontend source
├── scripts/              # Utility scripts
└── model.nlp             # Pre-trained NLP model
```

## Environment Variables

Required environment variables (see `.env.example`):

- `MONGODB_URI` — MongoDB connection string (required for most features)
- `JWT_SECRET` — JWT secret for admin panel auth
- `ENCRYPTION_KEY` — 32-character encryption key for API key storage
- `PORT` — Server port (default: 8080)
- `NODE_ENV` — Environment (development/production)
- `GEMINI_API_KEY` — Google Gemini AI key (optional)
- `OPENAI_API_KEY` — OpenAI key for voice/STT/TTS (optional)
- `GROQ_API_KEY` — Groq AI key (optional)
- `OPENROUTER_API_KEY` — OpenRouter key (optional)

## Development

The `Start application` workflow runs both services concurrently:
- Backend: `npm run dev` (ts-node-dev with hot reload)
- Frontend: `npm run client` (Vite dev server on port 5000)

## Deployment

- **Target**: VM (always-running, needed for WhatsApp WebSocket connections)
- **Build**: `npm run build` (builds client then compiles TypeScript)
- **Run**: `node dist/index.js`

## Key Features

- Multi-session WhatsApp management
- AI provider configuration (Gemini, OpenAI, Groq, OpenRouter)
- NLP-based message routing
- Lead capture and CRM
- Marketing campaign management
- Webhook integrations
- Voice message transcription and TTS
- Booking system
- Form builder
- Knowledge base management
