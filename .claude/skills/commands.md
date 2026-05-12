# Commands Skill

Guide for implementing and managing WhatsApp bot commands.

## Triggers
- User asks about adding or modifying commands
- User wants to understand command system architecture
- User needs help with command registration

## Command Architecture

### Interface Definition
Located: `src/app/interfaces/ICommand.ts`

```typescript
export interface ICommand {
  name: string;           // Command name without ! prefix
  description: string;    // Help text description
  aliases?: string[];     // Alternative names
  execute(
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string
  ): Promise<void>;
}
```

### Dispatcher Pattern
Located: `src/app/utils/CommandDispatcher.ts`

- `register(command)` - Add command to registry
- `dispatch(name, message, args, sessionId)` - Execute command
- `hasCommand(name)` - Check if command exists
- `getCommand(name)` - Get command instance
- `getAllCommands()` - List all commands

### Registration
Located: `src/app/commands/index.ts`

Commands auto-register when module loads:
```typescript
commandDispatcher.register(new HelpCommand());
commandDispatcher.register(new PingCommand());
// ... etc
```

## Creating a New Command

### Step 1: Create Command Class
```typescript
// src/app/commands/WeatherCommand.ts
import { ICommand } from '../interfaces/ICommand';
import { proto } from '@whiskeysockets/baileys';
import { sendMessage, getSenderJid } from '../../services/whatsapp';

export class WeatherCommand implements ICommand {
  name = 'weather';
  description = 'Get weather information';
  aliases = ['clima', 'tempo'];

  async execute(
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string
  ): Promise<void> {
    const jid = getSenderJid(message);
    if (!jid) return;

    // Validate args
    if (args.length === 0) {
      await sendMessage(jid, '⚠️ Usage: !weather <city>', sessionId);
      return;
    }

    // Process command
    const city = args.join(' ');
    try {
      const weather = await fetchWeather(city);
      await sendMessage(jid, `🌤️ Weather in ${city}: ${weather}`, sessionId);
    } catch (error) {
      await sendMessage(jid, '❌ Could not fetch weather', sessionId);
    }
  }
}
```

### Step 2: Register Command
```typescript
// src/app/commands/index.ts
import { WeatherCommand } from './WeatherCommand';
commandDispatcher.register(new WeatherCommand());
```

## Existing Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `!help` | - | Show available commands |
| `!ping` | - | Test bot response |
| `!clear` | - | Clear conversation history |
| `!register` | `!join`, `!apply` | Start registration form |
| `!jobs` | - | Show job listings |
| `!book` | `!visit`, `!schedule` | Start booking flow |
| `!payment` | `!pay`, `!bank` | Show payment details |
| `!cv` | - | CV submission info |
| `!stop` | `!unsubscribe` | Opt out of auto-registration |
| `!start` | `!subscribe` | Opt back into auto-registration |

## Legacy Commands

Commands not yet converted to class-based are in `handleCommand()` in `src/index.ts`:
- `!help`, `!ping`, `!clear`, `!register`, `!jobs`, `!book`, etc.

These use switch-case pattern and should be migrated to class-based commands.

## Best Practices

1. **Always check JID**
   ```typescript
   const jid = getSenderJid(message);
   if (!jid) return;
   ```

2. **Validate arguments**
   ```typescript
   if (args.length === 0) {
     await sendMessage(jid, '⚠️ Usage: !command <arg>', sessionId);
     return;
   }
   ```

3. **Handle errors gracefully**
   ```typescript
   try {
     // operation
   } catch (error) {
     await sendMessage(jid, '❌ Something went wrong', sessionId);
   }
   ```

4. **Use descriptive error messages**
   - Include usage examples
   - Use emoji for visual feedback
   - Be helpful, not technical

5. **Test commands**
   - Test with valid input
   - Test with missing arguments
   - Test error handling
   - Test aliases

## Configuration-Based Commands

Some commands use configuration from Datasets:
- `!help` - Uses `HELP_MESSAGE` dataset
- `!jobs` - Uses `JOBS_MESSAGE` dataset
- `!ping` - Uses `PING_MESSAGE` dataset

Configure via Admin Panel → Datasets.