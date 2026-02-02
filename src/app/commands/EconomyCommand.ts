import axios from 'axios';
import { BaseCommand } from '../utils/BaseCommand';
import { proto } from '@whiskeysockets/baileys';

/**
 * Command to query currency exchange rates
 */
export class EconomyCommand extends BaseCommand {
  name = 'cotacao';
  description = 'Shows current exchange rates (USD, BTC, EUR)';
  aliases = ['moeda', 'dolar', 'bitcoin'];

  async execute(message: proto.IWebMessageInfo, args: string[]): Promise<void> {
    await this.sendTyping(message);

    try {
      const { data } = await axios.get(
        'https://economia.awesomeapi.com.br/all/USD-BRL,BTC-BRL,EUR-BRL',
      );

      const getAllCurrencies = () => {
        return Object.keys(data)
          .map((key) => {
            return `\n💲 *${data[key].name} (${data[key].code})* \nCurrent value: R$ ${data[key].bid} \nHighest value: R$ ${data[key].high} \nLowest value: R$ ${data[key].low}\n`;
          })
          .join('');
      };

      await this.reply(message,
        `💎 *Current Exchange Rates* 💰🤑💹 \n${getAllCurrencies()}`,
      );
    } catch (error) {
      console.error('Error fetching exchange rates:', error);
      await this.reply(message,
        '⚠️ Unable to get exchange rates at the moment. Please try again later.',
      );
    }
  }
}
