# Testing Skill

Procedures and standards for testing the WhatsApp AI Bot.

## Triggers
- User asks about testing, unit tests, or quality assurance
- User wants to validate API endpoints or message flows
- User needs help debugging issues

## Test Organization

```
src/__tests__/           # Unit tests
  ├── services/         # Service tests
  ├── utils/            # Utility tests
  └── integration/      # Integration tests
```

## Running Tests

```bash
# Run all tests
npm run test

# Run specific test file
npx jest src/__tests__/AILoadBalancer.test.ts

# Run with coverage
npx jest --coverage

# Watch mode for development
npx jest --watch
```

## Unit Test Pattern

```typescript
import { MyService } from '../services/MyService';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    service = new MyService();
  });

  describe('methodName', () => {
    it('should handle valid input', async () => {
      const result = await service.methodName('valid');
      expect(result).toBeDefined();
    });

    it('should throw on invalid input', async () => {
      await expect(service.methodName(null))
        .rejects.toThrow('Invalid input');
    });
  });
});
```

## API Endpoint Testing

```typescript
import request from 'supertest';
import app from '../server/app';

describe('API Endpoint', () => {
  it('GET /api/resource should return data', async () => {
    const res = await request(app)
      .get('/api/resource')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('POST /api/resource should create item', async () => {
    const res = await request(app)
      .post('/api/resource')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(201);
  });
});
```

## Message Flow Testing

When testing message processing:

1. **Mock WhatsApp functions**
   ```typescript
   jest.mock('../services/whatsapp', () => ({
     sendMessage: jest.fn().mockResolvedValue(true),
     getSenderJid: jest.fn().mockReturnValue('test@s.whatsapp.net'),
   }));
   ```

2. **Test flow branches**
   - Booking flow handling
   - Lead flow handling
   - Form flow handling
   - Command dispatch
   - AI response

3. **Verify rate limiting**
   ```typescript
   it('should rate limit rapid messages', async () => {
     // First message should process
     await handler(msg1);
     // Second message within 1s should be skipped
     await handler(msg2);
     // Verify only one response sent
   });
   ```

## Mock Patterns

### Mock AI Provider
```typescript
jest.mock('../services/gemini', () => ({
  GeminiService: jest.fn().mockImplementation(() => ({
    generateResponse: jest.fn().mockResolvedValue('AI response'),
  })),
}));
```

### Mock Database
```typescript
jest.mock('../models/Session', () => ({
  findOne: jest.fn().mockResolvedValue({ sessionId: 'test' }),
  find: jest.fn().mockResolvedValue([]),
}));
```

## Validation Checklist

When validating changes:
- [ ] All existing tests pass
- [ ] New functionality has tests
- [ ] Edge cases covered
- [ ] Error handling tested
- [ ] Integration tests pass
- [ ] TypeScript compiles without errors

## Debugging Test Failures

1. Check mock implementations match actual signatures
2. Verify async operations are properly awaited
3. Check test isolation (no state leakage between tests)
4. Use `console.log` in tests for debugging
5. Run single test file to isolate issue