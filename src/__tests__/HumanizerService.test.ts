import { HumanizerService } from '../services/HumanizerService';
import * as whatsapp from '../services/whatsapp';

jest.mock('../services/whatsapp', () => ({
  getSocket: jest.fn(),
  sendTyping: jest.fn(),
}));

describe('HumanizerService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should calculate typing delay and send message', async () => {
    const mockSendMessage = jest.fn().mockResolvedValue(true);
    (whatsapp.getSocket as jest.Mock).mockReturnValue({
      sendMessage: mockSendMessage,
    });

    const promise = HumanizerService.sendHumanizedMessage(
      '123@s.whatsapp.net',
      'Hello world',
    );

    jest.runAllTimersAsync();

    const result = await promise;

    expect(result).toBe(true);
    expect(whatsapp.sendTyping).toHaveBeenCalledWith(
      '123@s.whatsapp.net',
      'default',
    );
    expect(mockSendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', {
      text: 'Hello world',
    });
  });

  it('should return false if socket is not found', async () => {
    (whatsapp.getSocket as jest.Mock).mockReturnValue(null);

    const result = await HumanizerService.sendHumanizedMessage(
      '123@s.whatsapp.net',
      'Hello world',
    );

    expect(result).toBe(false);
    expect(whatsapp.sendTyping).not.toHaveBeenCalled();
  });
});
