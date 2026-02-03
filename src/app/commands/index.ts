import { commandDispatcher } from '../utils/CommandDispatcher';

// Import all commands
import { EconomyCommand } from './EconomyCommand';
import { QuoteCommand } from './QuoteCommand';
import { CepCommand } from './CepCommand';
import { ProfileCommand } from './ProfileCommand';
import { HelpCommand } from './HelpCommand';
import { GeminiCommand } from './GeminiCommand';
import { SinhalaCommand } from './SinhalaCommand';

/**
 * Initializes and registers all available commands
 */
export const initializeCommands = (): void => {
  // Register all commands
  commandDispatcher.register(new HelpCommand());
  commandDispatcher.register(new EconomyCommand());
  commandDispatcher.register(new QuoteCommand());
  commandDispatcher.register(new CepCommand());
  commandDispatcher.register(new ProfileCommand());

  // AI Commands
  commandDispatcher.register(new GeminiCommand());
  commandDispatcher.register(new SinhalaCommand());

  console.log(
    `✅ ${commandDispatcher.getAllCommands().length} commands registered`,
  );
};

// Initialize commands immediately when the module is loaded
initializeCommands();

import { proto } from '@whiskeysockets/baileys';
import { getMessageText } from '../../services/whatsapp';

// ... (existing imports)

/**
 * Main command handler
 * Processes messages starting with '!' and dispatches to the appropriate command
 */
export const CommandHandler = async (
  message: proto.IWebMessageInfo,
  sessionId: string,
): Promise<void> => {
  const text = getMessageText(message);

  // Ignore messages that are not commands
  if (!text.startsWith('!')) return;

  // Extract command and arguments
  const commandText = text.slice(1); // Remove '!'
  const [commandName, ...args] = commandText.split(' ');

  // Dispatch to the appropriate command
  await commandDispatcher.dispatch(
    commandName.toLowerCase(),
    message,
    args,
    sessionId,
  );
};
