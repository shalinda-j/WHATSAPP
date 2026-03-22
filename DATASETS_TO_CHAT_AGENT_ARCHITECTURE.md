# Datasets to Chat Agent Connection Architecture

This document explains how the two datasets sections connect to the chat agent.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              WHATSAPP AI BOT ARCHITECTURE                               │
│                        Datasets → Chat Agent Connection Flow                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FRONTEND LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌──────────────────────┐         ┌──────────────────────┐                            │
│   │   Datasets.tsx       │         │  ChatInterface.tsx   │                            │
│   │   (Admin Panel)      │         │  (Live Chat)         │                            │
│   ├──────────────────────┤         ├──────────────────────┤                            │
│   │ • Create/Edit/Delete │         │ • View conversations │                            │
│   │ • Upload files       │         │ • Send messages      │                            │
│   │ • Set scope/category │         │ • Real-time updates  │                            │
│   │ • Toggle active      │         │ • WebSocket listener │                            │
│   └──────────┬───────────┘         └──────────┬───────────┘                            │
│              │                                │                                        │
│              │ REST API                       │ REST API + WebSocket                   │
│              ▼                                ▼                                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  BACKEND LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│   │                           EXPRESS.JS SERVER ROUTES                               │  │
│   │                                                                                  │  │
│   │   ┌─────────────────────┐        ┌─────────────────────┐                         │  │
│   │   │ /api/datasets       │        │ /api/chat/*         │                         │  │
│   │   │ (CRUD operations)   │        │ (Send/Receive)      │                         │  │
│   │   └──────────┬──────────┘        └──────────┬──────────┘                         │  │
│   │              │                              │                                    │  │
│   └──────────────┼──────────────────────────────┼────────────────────────────────────┘  │
│                  │                              │                                       │
│                  ▼                              ▼                                       │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              MONGODB DATABASE                                     │  │
│   │                                                                                  │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │                           Dataset Collection                               │  │  │
│   │   │                                                                           │  │  │
│   │   │   Document Structure:                                                     │  │  │
│   │   │   {                                                                       │  │  │
│   │   │     _id: ObjectId,                                                        │  │  │
│   │   │     name: String,           // e.g., "Company Info", "FAQ"                │  │  │
│   │   │     content: Mixed,         // Text or JSON data                          │  │  │
│   │   │     scope: String,          // e.g., "ALL", "JCETI", "ISRAEL"             │  │  │
│   │   │     category: String,       // "company", "faq", "promotion", "other"     │  │  │
│   │   │     key: String,            // Unique key for config lookups              │  │  │
│   │   │     isActive: Boolean       // Enable/disable for AI context              │  │  │
│   │   │   }                                                                       │  │  │
│   │   │                                                                           │  │  │
│   │   │   Example Documents:                                                      │  │  │
│   │   │   ┌─────────────────────────────────────────────────────────────────────┐ │  │  │
│   │   │   │ { key: "AI_PERSONALITY", content: "You are a helpful..." }          │ │  │  │
│   │   │   │ { key: "JOB_TYPES", content: ["Electrician", "Plumber", ...] }      │ │  │  │
│   │   │   │ { key: "BOOKING_KEYWORDS", content: ["tomorrow", "today", ...] }    │ │  │  │
│   │   │   │ { name: "Israel Jobs", scope: "ISRAEL", content: "Job details..." } │ │  │  │
│   │   │   └─────────────────────────────────────────────────────────────────────┘ │  │  │
│   │   │                                                                           │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                                  │  │
│   │   ┌───────────────────────┐        ┌───────────────────────┐                      │  │
│   │   │   ChatMessage         │        │   NLPCache            │                      │  │
│   │   │   Collection          │        │   Collection          │                      │  │
│   │   │   (Conversation       │        │   (Learned            │                      │  │
│   │   │    History)           │        │    responses)         │                      │  │
│   │   └───────────────────────┘        └───────────────────────┘                      │  │
│   │                                                                                  │  │
│   └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ Dataset.find({ isActive: true })
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                            SERVICE LAYER (The Connection)                               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                          ConfigService.ts                                        │   │
│   │                          (src/services/ConfigService.ts)                         │   │
│   │                                                                                  │   │
│   │   ┌────────────────────────────────────────────────────────────────────────┐    │   │
│   │   │   getDynamicKnowledgeBase()                                            │    │   │
│   │   │                                                                        │    │   │
│   │   │   1. Fetch all active datasets from MongoDB                            │    │   │
│   │   │   2. Format each dataset as markdown section                           │    │   │
│   │   │   3. Combine with static knowledge base                                │    │   │
│   │   │   4. Cache result (1-minute TTL for performance)                       │    │   │
│   │   │                                                                        │    │   │
│   │   │   Returns:                                                             │    │   │
│   │   │   ┌────────────────────────────────────────────────────────────────┐  │    │   │
│   │   │   │ # Knowledge Base (Company: Jayalath Global)                    │  │    │   │
│   │   │   │ [Static company info...]                                        │  │    │   │
│   │   │   │                                                                 │  │    │   │
│   │   │   │ # Dynamic Datasets (From Admin Panel)                          │  │    │   │
│   │   │   │                                                                 │  │    │   │
│   │   │   │ ## Company Info (company)                                      │  │    │   │
│   │   │   │ We are Jayalath Global...                                      │  │    │   │
│   │   │   │ ---                                                             │  │    │   │
│   │   │   │                                                                 │  │    │   │
│   │   │   │ ## FAQ (faq)                                                    │  │    │   │
│   │   │   │ Q: What services? A: We offer...                               │  │    │   │
│   │   │   │ ---                                                             │  │    │   │
│   │   │   │                                                                 │  │    │   │
│   │   │   │ ## Israel Jobs (ISRAEL)                                         │  │    │   │
│   │   │   │ Electrician positions available...                              │  │    │   │
│   │   │   │ ---                                                             │  │    │   │
│   │   │   └────────────────────────────────────────────────────────────────┘  │    │   │
│   │   │                                                                        │    │   │
│   │   └────────────────────────────────────────────────────────────────────────┘    │   │
│   │                                                                                  │   │
│   │   Other Methods:                                                                 │   │
│   │   • getAIPersonality() → Returns AI behavior instructions                       │   │
│   │   • getConversationExamples() → Training examples for AI                         │   │
│   │   • getJobTypes() → Available job categories                                     │   │
│   │   • getBookingKeywords() → Words that trigger booking flow                       │   │
│   │   • getCountries() → Job placement destinations                                 │   │
│   │                                                                                  │   │
│   └──────────────────────────────────┬───────────────────────────────────────────────┘   │
│                                      │                                                  │
│                                      │ getAIKnowledgeBase()                              │
│                                      ▼                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    ConfigurationManagerService.ts                                │   │
│   │                    (src/services/ConfigurationManagerService.ts)                 │   │
│   │                                                                                  │   │
│   │   • Wrapper around ConfigService with additional caching                        │   │
│   │   • Provides getAIKnowledgeBase() to AILoadBalancer                             │   │
│   │   • Manages TTL-based cache (default: 1 minute)                                 │   │
│   │                                                                                  │   │
│   └──────────────────────────────────┬───────────────────────────────────────────────┘   │
│                                      │                                                  │
│                                      │ configurationManager.getAIKnowledgeBase()         │
│                                      ▼                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                          AILoadBalancer.ts                                       │   │
│   │                          (src/services/AILoadBalancer.ts)                        │   │
│   │                                                                                  │   │
│   │   ┌────────────────────────────────────────────────────────────────────────┐    │   │
│   │   │   getInitialHistory()                                                   │    │   │
│   │   │                                                                         │    │   │
│   │   │   Builds the conversation context sent to AI:                           │    │   │
│   │   │                                                                         │    │   │
│   │   │   1. Fetch AI Personality (behavior instructions)                      │    │   │
│   │   │   2. Fetch Knowledge Base (datasets + static info)                     │    │   │
│   │   │   3. Fetch Conversation Examples (training samples)                    │    │   │
│   │   │   4. Combine into system message                                        │    │   │
│   │   │                                                                         │    │   │
│   │   │   Result:                                                               │    │   │
│   │   │   [                                                                      │    │   │
│   │   │     {                                                                    │    │   │
│   │   │       role: "system",                                                   │    │   │
│   │   │       content: "${AI_PERSONALITY}\n\n${KNOWLEDGE_BASE}"                │    │   │
│   │   │     },                                                                   │    │   │
│   │   │     { role: "user", content: "Example question..." },                  │    │   │
│   │   │     { role: "assistant", content: "Example answer..." }                │    │   │
│   │   │   ]                                                                      │    │   │
│   │   │                                                                         │    │   │
│   │   └────────────────────────────────────────────────────────────────────────┘    │   │
│   │                                                                                  │   │
│   │   sendMessage(userId, message)                                                   │   │
│   │   │                                                                              │   │
│   │   │   1. Load AI providers (Gemini, OpenAI, Groq, OpenRouter)                   │   │
│   │   │   2. Get/create conversation history for user                               │   │
│   │   │   3. Add user message to history                                            │   │
│   │   │   4. Try each AI provider in priority order                                 │   │
│   │   │   5. Return AI response                                                     │   │
│   │   │                                                                              │   │
│   │   └──────────────────────────────────────────────────────────────────────────┐   │   │
│   │                                                                                  │   │
│   └──────────────────────────────────┬───────────────────────────────────────────────┘   │
│                                      │                                                  │
└──────────────────────────────────────┼──────────────────────────────────────────────────┘
                                       │
                                       │ aiLoadBalancer.sendMessage()
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              AI PROVIDERS LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐         │
│   │   Gemini    │    │   OpenAI    │    │    Groq     │    │   OpenRouter    │         │
│   │   Service   │    │   Service   │    │   Service   │    │    Service      │         │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └────────┬────────┘         │
│          │                  │                  │                    │                  │
│          │                  │                  │                    │                  │
│          ▼                  ▼                  ▼                    ▼                  │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                        AI API Calls (with Dataset Context)                       │   │
│   │                                                                                  │   │
│   │   The conversation history (containing datasets) is sent to the AI API          │   │
│   │   as the system prompt, giving the AI access to all configured knowledge.       │   │
│   │                                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ AI Response
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                            MESSAGE FLOW (src/index.ts)                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                          onMessage Handler                                       │   │
│   │                          (Main WhatsApp Message Handler)                         │   │
│   │                                                                                  │   │
│   │   ┌────────────────────────────────────────────────────────────────────────┐    │   │
│   │   │                                                                        │    │   │
│   │   │   1. Receive WhatsApp message (text or voice)                          │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   2. Save user message to DB & emit to WebSocket                       │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   3. Check for booking/lead flows                                      │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   4. Check for commands (!help, !register, etc.)                       │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   5. Try Local NLP Cache (if enabled)                                  │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ├──► [HIT] Return cached response                                 │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   6. Call AILoadBalancer.sendMessage() ◄── DATASETS INJECTED HERE     │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   7. Learn from AI response (update NLP cache)                         │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   8. Save bot response to DB & emit to WebSocket                       │    │   │
│   │   │      │                                                                  │    │   │
│   │   │      ▼                                                                  │    │   │
│   │   │   9. Send response to WhatsApp user                                    │    │   │
│   │   │                                                                        │    │   │
│   │   └────────────────────────────────────────────────────────────────────────┘    │   │
│   │                                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                            OUTPUT LAYER                                                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌──────────────────────┐         ┌──────────────────────┐                            │
│   │   WhatsApp User      │         │   Admin Dashboard    │                            │
│   │   (Receives reply)   │         │   (Live Chat)        │                            │
│   │                      │         │                      │                            │
│   │   The AI response    │         │   Real-time message  │                            │
│   │   contains knowledge │         │   updates via        │                            │
│   │   from datasets!     │         │   WebSocket          │                            │
│   └──────────────────────┘         └──────────────────────┘                            │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key Connection Points

### 1. **Dataset Model → ConfigService**
```typescript
// ConfigService.ts:334-377
async getDynamicKnowledgeBase(): Promise<string> {
  // Fetch ALL active datasets from MongoDB
  const datasets = await Dataset.find({ isActive: true });

  // Format each dataset as markdown
  datasets.forEach((ds) => {
    dynamicContent += `\n## ${ds.name} (${ds.scope})\n${ds.content}\n---\n`;
  });

  // Combine with static knowledge
  return `${JOB_KNOWLEDGE_BASE}${dynamicContent}`;
}
```

### 2. **ConfigService → ConfigurationManagerService**
```typescript
// ConfigurationManagerService.ts:322-340
async getAIKnowledgeBase(): Promise<string> {
  return await configService.getDynamicKnowledgeBase();
}
```

### 3. **ConfigurationManagerService → AILoadBalancer**
```typescript
// AILoadBalancer.ts:150-166
private async getInitialHistory(): Promise<AIChatMessage[]> {
  const knowledgeBase = await configurationManager.getAIKnowledgeBase();
  const aiPersonality = await configurationManager.getAIPersonality();

  return [{
    role: 'system',
    content: `${aiPersonality}\n\n${knowledgeBase}`
  }];
}
```

### 4. **AILoadBalancer → AI Providers**
```typescript
// AILoadBalancer.ts:169-230
async sendMessage(userId: string, message: string): Promise<string> {
  // Get/create conversation history (includes datasets)
  let history = this.conversationHistory.get(userId);
  if (!history) {
    history = await this.getInitialHistory(); // <-- Datasets loaded here!
    this.conversationHistory.set(userId, history);
  }

  // Send to AI providers
  const response = await service.generateResponse(history);
  return response;
}
```

## Data Flow Summary

```
┌─────────────────┐
│  Admin creates  │
│  dataset in UI  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Saved to       │
│  MongoDB        │
│  Dataset model  │
└────────┬────────┘
         │
         │ (When user sends message)
         ▼
┌─────────────────┐
│  ConfigService  │
│  fetches all    │
│  active datasets│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Formats as     │
│  markdown       │
│  knowledge base │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AILoadBalancer │
│  adds to system │
│  prompt         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AI Provider    │
│  (Gemini/       │
│  OpenAI/etc)    │
│  generates      │
│  response       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  WhatsApp user  │
│  receives AI    │
│  reply with     │
│  dataset info   │
└─────────────────┘
```

## Configuration Keys

The following dataset keys are used for specific configurations:

| Key | Purpose | Used By |
|-----|---------|---------|
| `AI_PERSONALITY` | AI behavior instructions | AILoadBalancer |
| `CONVERSATION_EXAMPLES` | Training examples | AILoadBalancer |
| `JOB_TYPES` | Available job categories | LeadService |
| `BOOKING_KEYWORDS` | Trigger words for booking | index.ts |
| `BOOKING_CONFIG` | Booking flow settings | BookingService |
| `COMPANY_INFO` | Company details | ConfigService |
| `HUMANIZER_CONFIG` | Message delay settings | HumanizerService |
| `COUNTRIES` | Job placement destinations | FormService |
| `EXPERIENCE_LEVELS` | Experience options | FormService |

## Performance Optimization

1. **Caching**: ConfigService caches datasets for 1 minute (TTL: 60,000ms)
2. **Lazy Loading**: Datasets are only fetched when a message arrives
3. **Cache Invalidation**: `clearCache()` method available for manual refresh

## Scope-based Filtering

Datasets support scope-based organization:
- `ALL` - Global knowledge (available to all users)
- `JCETI` - JCETI-specific information
- `ISRAEL` - Israel job market info
- Custom scopes for different regions/companies

Currently, all active datasets are loaded regardless of scope, but the architecture supports filtering by scope if needed in the future.