# WhatsApp AI Bot Development Skill

## Overview

This skill provides specialized assistance for developing and maintaining the WhatsApp AI Bot project. Use this for common development tasks, debugging, and feature implementation.

## Triggers

- User asks about WhatsApp bot development
- User mentions commands, voice processing, AI providers, or CRM
- User needs help with message handling or workflows

## Common Development Tasks

### 1. Adding a New Command

```typescript
// Step 1: Create command file in src/app/commands/
// Example: src/app/commands/MyCommand.ts

import { ICommand } from '../interfaces/ICommand';
import { proto } from '@whiskeysockets/baileys';
import { sendMessage, getSenderJid } from '../../services/whatsapp';

export class MyCommand implements ICommand {
  name = 'mycommand';
  description = 'Description of what this command does';
  aliases = ['alias1', 'alias2'];

  async execute(
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string,
  ): Promise<void> {
    const jid = getSenderJid(message);
    if (!jid) return;

    // Command logic here
    await sendMessage(jid, 'Response message', sessionId);
  }
}

// Step 2: Register in src/app/commands/index.ts
import { MyCommand } from './MyCommand';
commandDispatcher.register(new MyCommand());
```

### 2. Adding a New AI Provider

```typescript
// Step 1: Create service in src/services/
// Example: src/services/NewProvider.ts

import { AIService, AIChatMessage } from '../interfaces/AIService';

export class NewProviderService implements AIService {
  name = 'NewProvider (model-name)';
  private apiKey: string;
  private model: string;

  constructor(config: { apiKey: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'default-model';
  }

  async generateResponse(history: AIChatMessage[]): Promise<string> {
    // Implement API call
    const response = await fetch('https://api.newprovider.com/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: history,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

// Step 2: Add to AILoadBalancer.ts
import { NewProviderService } from './NewProvider';

// In loadServices():
if (conf.providerType === 'newprovider') {
  this.services.push(
    new NewProviderService({
      apiKey: conf.apiKey,
      model: conf.aiModel,
      providerType: 'newprovider',
    }),
  );
}

// Step 3: Add to priority map
const priorityMap: Record<string, number> = {
  GroqService: 1,
  GeminiService: 2,
  OpenRouterService: 3,
  OpenAIService: 4,
  NewProviderService: 5, // Add here
};
```

### 3. Creating a New API Route

```typescript
// Step 1: Create route file in src/server/routes/
// Example: src/server/routes/myroute.ts

import { Router, Request, Response } from 'express';
import MyModel from '../../models/MyModel';

const router = Router();

// GET all items
router.get('/', async (req: Request, res: Response) => {
  try {
    const items = await MyModel.find();
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// POST create item
router.post('/', async (req: Request, res: Response) => {
  try {
    const item = new MyModel(req.body);
    await item.save();
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ error: 'Failed to create item' });
  }
});

export default router;

// Step 2: Register in src/server/app.ts
import myRouteRouter from './routes/myroute';
app.use('/api/myroute', authenticateToken, myRouteRouter);
```

### 4. Adding a New Mongoose Model

```typescript
// Create in src/models/MyModel.ts

import mongoose, { Schema, Document } from 'mongoose';

export interface IMyModel extends Document {
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MyModelSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    isActive: { type: Boolean, default: true },
  } as any,
  { timestamps: true },
);

export default mongoose.model(
  'MyModel',
  MyModelSchema as any,
) as unknown as mongoose.Model<IMyModel>;
```

### 5. Creating a New Frontend Page

```typescript
// Create in client/src/pages/MyPage.tsx

import { useState, useEffect } from 'react';
import { api } from '../config';

interface MyData {
  _id: string;
  name: string;
}

export default function MyPage() {
  const [data, setData] = useState<MyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await api.get('/api/myroute');
      setData(res.data);
    } catch (error) {
      console.error('Failed to fetch:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">My Page</h1>
      {/* Content here */}
    </div>
  );
}

// Add route in client/src/App.tsx
<Route path="/mypage" element={<MyPage />} />

// Add navigation in client/src/components/Layout.tsx
{ name: 'My Page', path: '/mypage', icon: IconComponent }
```

## Debugging Tips

### Message Flow Debugging

```typescript
// Add logging in src/index.ts message handler
console.log(`📩 Message: "${text}" from ${jid}`);
console.log(`   Processing step: ${stepName}`);
```

### AI Provider Debugging

```typescript
// Enable debug logging in AILoadBalancer.ts
console.log(`🤖 Loaded ${this.services.length} AI services`);
console.log(`   Primary: ${this.services[0]?.constructor.name}`);
```

### Database Connection Debugging

```bash
# Check MongoDB connection
curl http://localhost:8080/health

# Expected response:
{
  "status": "ok",
  "database": {
    "status": "connected",
    "readyState": 1
  }
}
```

### Voice Processing Debugging

```typescript
// In src/services/voice.ts
console.log(`   🎙️ Transcribing audio with ${provider}...`);
console.log(`   🌐 Detected language: ${langResult.lang}`);
console.log(`   🔊 Generating speech using provider: ${provider}`);
```

## Testing Commands

```bash
# Run tests
npm run test

# Run specific test file
npx jest src/__tests__/AILoadBalancer.test.ts

# Run with coverage
npx jest --coverage

# Watch mode
npx jest --watch
```

## Common Issues & Solutions

### Issue: MongoDB 503 Error

**Solution**: Check MongoDB connection status and IP whitelist

```typescript
// Check in middleware
if (mongoose.connection.readyState !== 1) {
  return res.status(503).json({
    error: 'Service Unavailable',
    message: 'Database not connected.',
  });
}
```

### Issue: Voice Transcription Fails

**Solution**: Check provider config and fallback

```typescript
// Fallback chain: OpenAI -> Gemini
if (!transcription) {
  console.log('   🎙️ Transcribing audio with Gemini...');
  transcription = await geminiTranscribeAudio(audioBase64, 'audio/ogg');
}
```

### Issue: AI Provider Rate Limited

**Solution**: Load balancer automatically falls back to next provider

```typescript
// In AILoadBalancer.ts
for (let i = 0; i < this.services.length; i++) {
  try {
    return await service.generateResponse(history);
  } catch (error) {
    console.log(`   ⚠️ Retrying with fallback...`);
  }
}
```

### Issue: TypeScript Deep Instantiation Error

**Solution**: Use type assertion pattern

```typescript
export default mongoose.model(
  'ModelName',
  Schema as any,
) as unknown as mongoose.Model<IModel>;
```

## Best Practices

1. **Always check for null/undefined** before using WhatsApp JID
2. **Use try-catch** for all async operations in message handlers
3. **Fire and forget** for non-critical operations (NLP learning, usage tracking)
4. **Implement graceful shutdown** for database and socket cleanup
5. **Use environment variables** for sensitive configuration
6. **Log with emojis** for easy debugging (📩, 🤖, ✅, ❌, ⚠️)

## Quick Reference

### File Locations

| Task          | Location                       |
| ------------- | ------------------------------ |
| Add command   | `src/app/commands/`            |
| Add route     | `src/server/routes/`           |
| Add model     | `src/models/`                  |
| Add service   | `src/services/`                |
| Add page      | `client/src/pages/`            |
| Add component | `client/src/components/`       |
| AI config     | `src/config/ai-personality.ts` |

### API Response Format

```typescript
// Success
res.json({ data, message: 'Success' });

// Error
res.status(400).json({ error: 'Error type', message: 'Details' });

// Paginated
res.json({ data, total, page, limit });
```

### Socket Events

```typescript
// Emit
io.emit('new-message', messageData);
io.emit('session-status', sessionData);

// Listen
socket.on('new-message', handler);
socket.on('session-status', handler);
```
