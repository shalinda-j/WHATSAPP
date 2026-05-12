# Debugging Skill

Techniques and patterns for debugging the WhatsApp AI Bot.

## Triggers
- User reports an error or issue
- User asks how to debug a problem
- User wants to understand why something isn't working

## Log Analysis

### Emoji Markers Guide
| Marker | Meaning | Where |
|--------|---------|-------|
| `📩` | Message received | `src/index.ts` |
| `🤖` | AI provider activity | `AILoadBalancer.ts`, providers |
| `✅` | Success/Connected | Various |
| `❌` | Error/Failed | Error handlers |
| `⚠️` | Warning/Fallback | Various |
| `📞` | Call handling | `whatsapp.ts` |
| `🎤` | Voice processing | `voice.ts`, `index.ts` |
| `📅` | Booking flow | `BookingService.ts` |
| `📝` | Lead/Form flow | `LeadService.ts`, `FormService.ts` |
| `📲` | QR code scan | `whatsapp.ts` |
| `🔄` | Session reconnecting | `whatsapp.ts` |
| `🧹` | Cleanup operation | Various |
| `📤` | Sending message | `whatsapp.ts` |

### Enable Debug Logging
```bash
# In .env
DEBUG=true
```

### Log Location
```bash
# View live logs
pm2 logs whatsapp-bot

# Or with ts-node-dev
npm run dev  # Logs in terminal
```

## Health Check

```bash
curl http://localhost:8080/health
```

Response indicates:
- `status: "ok"` - Server running
- `database.status: "connected"` - MongoDB connected
- `database.readyState: 1` - Connection state codes:
  - 0 = disconnected
  - 1 = connected
  - 2 = connecting
  - 3 = disconnecting

## Common Issues

### Issue: "Database not connected" (503)

**Diagnosis**:
```bash
curl http://localhost:8080/health
# Check database.readyState
```

**Solutions**:
1. MongoDB Atlas: Add server IP to whitelist
2. Check connection string format
3. Verify database user credentials
4. Wait for connection retry (2s timeout)

### Issue: "No AI services are configured"

**Diagnosis**:
```bash
# Check Admin Panel → Config → AI Providers
# Or check logs for: "🤖 Loaded X AI services"
```

**Solutions**:
1. Add API key in `.env` or Admin Panel
2. Verify provider is active in Config
3. Check API key validity with provider
4. Restart server after adding keys

### Issue: WhatsApp won't connect

**Diagnosis**:
- QR code not appearing
- Session stuck in "connecting" state

**Solutions**:
1. Check `src/auth_info` directory exists (file mode)
2. For MongoDB: Check Session collection
3. Delete old session and restart
4. Check for conflict (440) in logs - wait for backoff

### Issue: Voice transcription fails

**Diagnosis**:
```bash
# Look for logs:
# "⚠️ Transcription returned empty result"
# "❌ Failed to download audio"
```

**Solutions**:
1. Check OpenAI API key for Whisper
2. Verify FFmpeg is installed
3. Check audio buffer size (> 100 bytes)
4. Fallback to Gemini transcription active

### Issue: AI responses are empty

**Diagnosis**:
```bash
# Look for logs:
# "⚠️ Empty response from AI"
```

**Solutions**:
1. Check conversation history state
2. Verify system prompt loaded
3. Check provider API quotas
4. Try `!clear` command to reset history

### Issue: Commands not working

**Diagnosis**:
```bash
# Look for logs:
# "⚠️ Command not found: X"
# "📋 Available commands: ..."
```

**Solutions**:
1. Verify command registered in `src/app/commands/index.ts`
2. Check command name (no ! prefix in registration)
3. Verify ICommand interface implementation
4. Check for typos in aliases

## Debugging Message Flow

Add detailed logging in `src/index.ts`:

```typescript
console.log(`📩 Message: "${text}" from ${jid}`);
console.log(`   Step 1: Security check passed`);
console.log(`   Step 2: Rate limit check - allowed`);
console.log(`   Step 3: Checking booking flow...`);
// ... etc
```

## Database Query Debugging

```typescript
// In any service
console.log('Query:', JSON.stringify(query));
console.log('Result:', JSON.stringify(result));
```

## WebSocket Debugging

```typescript
// In src/server/socket.ts
console.log('Socket connected:', socket.id);
console.log('Emitting event:', eventName, data);
```

## Performance Profiling

```typescript
const start = Date.now();
await operation();
console.log(`Operation took ${Date.now() - start}ms`);
```