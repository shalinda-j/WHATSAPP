import axios from 'axios';
import type { IResponse, IServerData } from '../interfaces/Cep';
import { BaseCommand } from '../utils/BaseCommand';
import { proto } from '@whiskeysockets/baileys';

/**
 * Command to query postal code information
 */
export class CepCommand extends BaseCommand {
  name = 'cep';
  description = 'Search information for a Brazilian postal code';

  async execute(message: proto.IWebMessageInfo, args: string[]): Promise<void> {
    const jid = message.key.remoteJid;
    if (!jid) return;

    await this.sendTyping(message);

    // Validate arguments
    if (args.length === 0) {
      await this.reply(message,
        '⚠️ Please provide a postal code.\n\n📖 *Usage:* !cep 01310-100',
      );
      return;
    }

    const cep = args[0].replace(/\D/g, ''); // Remove non-numeric characters

    if (cep.length !== 8) {
      await this.reply(message,
        '⚠️ Invalid postal code! The code must have 8 digits.',
      );
      return;
    }

    try {
      const { data }: IResponse = await axios.get<IServerData>(
        `https://brasilapi.com.br/api/cep/v1/${cep}`,
      );

      await this.reply(message,
        `📮 *Postal Code Information*\n\n` +
        `*Postal Code:* ${data.cep}\n` +
        `*Street:* ${data.street}\n` +
        `*Neighborhood:* ${data.neighborhood}\n` +
        `*City:* ${data.city}\n` +
        `*State:* ${data.state}`,
      );
    } catch (error) {
      console.error('Error fetching postal code:', error);
      await this.reply(message, '⚠️ Postal code not found or service unavailable.');
    }
  }
}
