import type { Message } from 'whatsapp-web.js';
import { BaseCommand } from '../utils/BaseCommand';
import { commandDispatcher } from '../utils/CommandDispatcher';
import { client } from '../../services/whatsapp';

/**
 * Command to display all available commands with their descriptions and aliases
 */
export class HelpCommand extends BaseCommand {
  name = 'help';
  description = 'Shows all available commands with their descriptions';
  aliases = ['ajuda', 'comandos', 'commands'];

  async execute(message: Message, args: string[]): Promise<Message | void> {
    console.log('   📝 HelpCommand.execute() called');

    try {
      await this.sendTyping(message);
      console.log('   ✅ Typing indicator sent');
    } catch (e) {
      console.error('   ⚠️ Failed to send typing (continuing anyway)');
    }

    const commands = commandDispatcher.getAllCommands();
    console.log(`   📋 Found ${commands.length} commands`);

    // Build help message
    let helpMessage = '📚 *Available Commands*\n\n';
    helpMessage += '━━━━━━━━━━━━━━━━━━━━\n\n';

    commands.forEach((command) => {
      // Command name and description
      helpMessage += `🔹 *!${command.name}*\n`;
      helpMessage += `   ${command.description}\n`;

      // Show aliases if available
      if (command.aliases && command.aliases.length > 0) {
        const aliasesList = command.aliases
          .map((alias) => `!${alias}`)
          .join(', ');
        helpMessage += `   _Aliases:_ ${aliasesList}\n`;
      }

      helpMessage += '\n';
    });

    helpMessage += '━━━━━━━━━━━━━━━━━━━━\n\n';
    helpMessage += '💡 *Tip:* All commands start with `!`\n';
    helpMessage += '💬 Or just chat with me normally for AI responses!';

    console.log('   📤 Sending help message...');
    try {
      // Use client.sendMessage instead of message.reply to avoid markedUnread error
      await client.sendMessage(message.from, helpMessage);
      console.log('   ✅ Help message sent successfully');
    } catch (sendError) {
      console.error('   ❌ Failed to send help message:', sendError);
    }
  }
}
