import { AILoadBalancer } from '../services/AILoadBalancer';
import Config from '../models/Config';
import Dataset from '../models/Dataset';

jest.mock('../models/Config', () => ({
  find: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../models/Dataset', () => ({
  find: jest.fn(),
}));

jest.mock('../services/gemini', () => {
  return {
    GeminiService: jest.fn().mockImplementation(() => {
      return {
        name: 'GeminiService',
        generateResponse: jest.fn().mockResolvedValue('Mock response'),
        constructor: { name: 'GeminiService' },
      };
    }),
  };
});

describe('AILoadBalancer', () => {
  // we use prototype as hack because it is exported instance
  let balancer: AILoadBalancer;

  beforeEach(() => {
    balancer = new AILoadBalancer();
    jest.clearAllMocks();
  });

  it('should return error if no AI services are configured', async () => {
    (Config.find as jest.Mock).mockResolvedValue([]);
    // Delete env key if any
    const originalEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const response = await balancer.sendMessage('user_1', 'Hello');
      expect(response).toContain('No AI services are configured');
    } finally {
      if (originalEnv) process.env.GEMINI_API_KEY = originalEnv;
    }
  });

  it('should generate response using available provider', async () => {
    (Config.find as jest.Mock).mockResolvedValue([
      {
        providerType: 'google',
        aiModel: 'gemini-1.5-flash',
        apiKey: 'fake-key',
        isActive: true,
        isProvider: true,
      },
    ]);
    (Dataset.find as jest.Mock).mockResolvedValue([]);

    const response = await balancer.sendMessage('user_2', 'Hello');
    expect(response).toBe('Mock response');

    const stats = balancer.getStats();
    expect(stats.activeConversations).toBe(1);
    expect(stats.totalRequests).toBe(1);
  });

  it('should clear conversation history', async () => {
    (Config.find as jest.Mock).mockResolvedValue([
      { providerType: 'google', apiKey: 'test' },
    ]);
    (Dataset.find as jest.Mock).mockResolvedValue([]);
    await balancer.sendMessage('user_3', 'Hi');

    expect(balancer.getStats().activeConversations).toBe(1);

    balancer.clearConversation('user_3');
    expect(balancer.getStats().activeConversations).toBe(0);
  });
});
