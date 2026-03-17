import { Request, Response } from 'express';
import { configService } from '../../services/ConfigService';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import ChatMessage from '../../models/ChatMessage';
import Config from '../../models/Config';
import Dataset from '../../models/Dataset';
import Session from '../../models/Session';
import Admin from '../../models/Admin'; // We won't delete this, but good to know
import mongoose from 'mongoose';

// Existing stats logic
export const getStats = async (req: Request, res: Response) => {
  try {
    const configStats = configService.getCacheStats();
    const aiStats = aiLoadBalancer.getStats();
    const memoryUsage = process.memoryUsage();

    res.json({
      config: configStats,
      ai: aiStats,
      system: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
      },
    });
  } catch (error) {
    console.error('Error fetching cache stats:', error);
    res.status(500).json({ error: 'Failed to fetch cache stats' });
  }
};

// Existing clear cache logic
export const clearCache = async (req: Request, res: Response) => {
  try {
    const configCleared = configService.clearCache();
    const conversationsCleared = aiLoadBalancer.clearAllConversations();

    res.json({
      message: 'RAM Cache cleared successfully',
      details: {
        configItemsRemoved: configCleared,
        conversationsRemoved: conversationsCleared,
      },
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
};

// [NEW] Data Export
export const exportData = async (req: Request, res: Response) => {
  try {
    console.log('📦 Starting Data Export...');
    const exportData = {
      timestamp: new Date().toISOString(),
      chatMessages: await ChatMessage.find({}),
      configs: await Config.find({}),
      datasets: await Dataset.find({}),
      sessions: await Session.find({}),
      // Exclude Admin/Auth credentials for security, or include them encrypted?
      // Users usually want to export *their* data. Let's include what we can safely.
    };

    const filename = `data_export_${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(JSON.stringify(exportData, null, 2));

    console.log(`✅ Data Export successful: ${filename}`);
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
};

// [NEW] Factory Reset
export const resetSystem = async (req: Request, res: Response) => {
  try {
    const { confirmation } = req.body;

    if (confirmation !== 'reset-my-system') {
      return res.status(400).json({ error: 'Invalid confirmation code.' });
    }

    console.log('⚠️ FACTORY RESET TRIGGERED');

    // 1. Clear RAM Cache first
    configService.clearCache();
    aiLoadBalancer.clearAllConversations();

    // 2. Drop Collections
    // We KEEP 'admins' (Admin model) to avoid locking the user out.
    // We DELETE operational data.

    await ChatMessage.deleteMany({});
    console.log('   🗑️ ChatHistory wiped.');

    await Config.deleteMany({}); // Optional: User said "everything".
    // If we delete configs, API keys are gone.
    console.log('   🗑️ Configurations wiped.');

    await Dataset.deleteMany({});
    console.log('   🗑️ Datasets wiped.');

    await Session.deleteMany({});
    console.log('   🗑️ Sessions wiped.');

    // Also clear internal Auth Credentials (managed by MongoAuthService)
    // Accessing the collection directly via Mongoose connection
    try {
      await mongoose.connection.collection('authcredentials').deleteMany({});
      console.log('   🗑️ AuthCredentials wiped.');
    } catch (e) {
      console.warn(
        '   ⚠️ Could not wipe AuthCredentials (maybe collection missing)',
      );
    }

    console.log('✅ FACTORY RESET COMPLETE');

    res.json({ message: 'System has been reset successfully.' });
  } catch (error: any) {
    console.error('CRITICAL ERROR during Factory Reset:', error);
    res.status(500).json({ error: 'Failed to reset system: ' + error.message });
  }
};
