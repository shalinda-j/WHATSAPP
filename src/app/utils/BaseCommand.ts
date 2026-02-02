import { proto } from '@whiskeysockets/baileys';
import { ICommand } from '../interfaces/ICommand';
import { sendTyping, sendMessage } from '../../services/whatsapp';

/**
 * Abstract base class for commands
 * Provides common functionality for all commands
 */
export abstract class BaseCommand implements ICommand {
  abstract name: string;
  abstract description: string;
  aliases?: string[];

  abstract execute(message: proto.IWebMessageInfo, args: string[], sessionId: string): Promise<void>;

  /**
   * Sends "typing..." state in the chat
   */
  protected async sendTyping(message: proto.IWebMessageInfo, sessionId: string): Promise<void> {
    const jid = message.key.remoteJid;
    if (jid) {
      await sendTyping(jid, sessionId);
    }
  }

  /**
   * Checks if the message was sent in a group
   */
  protected isGroup(message: proto.IWebMessageInfo): boolean {
    return message.key.remoteJid?.endsWith('@g.us') || false;
  }

  /**
   * Reply to a message
   */
  protected async reply(message: proto.IWebMessageInfo, text: string, sessionId: string): Promise<void> {
    const jid = message.key.remoteJid;
    if (jid) {
      await sendMessage(jid, text, sessionId);
    }
  }

  /**
   * Validates if the command is being executed in a group
   * Returns error message if not
   */
  protected async requireGroup(message: proto.IWebMessageInfo, sessionId: string): Promise<boolean> {
    const isGroup = this.isGroup(message);
    if (!isGroup) {
      await this.reply(message, '⚠️ This command can only be used in groups!', sessionId);
      return false;
    }
    return true;
  }

  /**
   * Validates if there are enough arguments
   */
  protected async validateArgs(
    message: proto.IWebMessageInfo,
    args: string[],
    minArgs: number,
    usage: string,
    sessionId: string,
  ): Promise<boolean> {
    if (args.length < minArgs) {
      await this.reply(message, `⚠️ Incorrect usage!\n\n📖 *Usage:* ${usage}`, sessionId);
      return false;
    }
    return true;
  }
}
