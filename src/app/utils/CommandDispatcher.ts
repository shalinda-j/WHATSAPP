import type { ICommand } from '../interfaces/ICommand';
import { proto } from '@whiskeysockets/baileys';
import { sendMessage } from '../../services/whatsapp';

/**
 * Dispatcher responsible for managing and executing commands
 */
class CommandDispatcher {
  private commands: Map<string, ICommand> = new Map();
  private aliases: Map<string, string> = new Map();

  /**
   * Registers a command in the dispatcher
   * @param command - Command instance to be registered
   */
  register(command: ICommand): void {
    this.commands.set(command.name, command);

    // Register aliases if they exist
    if (command.aliases && command.aliases.length > 0) {
      command.aliases.forEach((alias) => {
        this.aliases.set(alias, command.name);
      });
    }
  }

  /**
   * Dispatches a command for execution
   * @param commandName - Command name (or alias)
   * @param message - WhatsApp message
   * @param args - Command arguments
   */
  async dispatch(
    commandName: string,
    message: proto.IWebMessageInfo,
    args: string[],
    sessionId: string,
  ): Promise<void> {
    console.log(`   📤 Dispatching command: "${commandName}"`);

    // Resolve alias to real command name
    const resolvedName = this.aliases.get(commandName) || commandName;
    console.log(`   🔍 Resolved to: "${resolvedName}"`);

    const command = this.commands.get(resolvedName);

    if (command) {
      console.log(`   ✅ Command found: ${command.name}`);
      try {
        console.log(`   ⚡ Executing command...`);
        await command.execute(message, args, sessionId);
        console.log(`   ✅ Command executed successfully`);
      } catch (error) {
        console.error(
          `   ❌ Error executing command '${resolvedName}':`,
          error,
        );
        try {
          // Use sendMessage instead of message.reply
          const jid = message.key.remoteJid;
          if (jid) {
            await sendMessage(
              jid,
              '⚠️ An error occurred while executing the command. Please try again later.',
              sessionId,
            );
          }
        } catch (replyError) {
          console.error(`   ❌ Failed to send error reply:`, replyError);
        }
      }
    } else {
      console.log(`   ⚠️ Command not found: "${commandName}"`);
      console.log(
        `   📋 Available commands: ${Array.from(this.commands.keys()).join(
          ', ',
        )}`,
      );
    }
  }

  /**
   * Gets a command by name or alias
   */
  getCommand(name: string): ICommand | undefined {
    const resolvedName = this.aliases.get(name) || name;
    return this.commands.get(resolvedName);
  }

  /**
   * Returns all registered commands
   */
  getAllCommands(): ICommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Checks if a command exists
   */
  hasCommand(name: string): boolean {
    const resolvedName = this.aliases.get(name) || name;
    return this.commands.has(resolvedName);
  }
}

export const commandDispatcher = new CommandDispatcher();
