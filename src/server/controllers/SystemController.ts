import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { configService } from '../../services/ConfigService';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import ChatMessage from '../../models/ChatMessage';
import Config from '../../models/Config';
import Dataset from '../../models/Dataset';
import Session from '../../models/Session';
import Admin from '../../models/Admin';
import mongoose from 'mongoose';
import type { AuthRequest } from '../middleware/auth';

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
    const conversationsCleared = await aiLoadBalancer.clearAllConversations();

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
    // SECURITY: never include Config.apiKey (or Config.value, which holds
    // session tokens for the unofficial ChatGPT/Claude providers) in the
    // export.
    //
    // Config.apiKey is stored via a Mongoose getter that DECRYPTS on
    // .toJSON() — so `await Config.find({})` followed by JSON.stringify
    // would write plaintext provider keys into the download. Two layers
    // of defence:
    //   1. `.lean()` skips Mongoose getters (no decryption happens).
    //   2. Projection `'-apiKey -value'` strips the encrypted fields
    //      entirely so the file never contains them.
    const safeConfigs = await Config.find({}, '-apiKey -value').lean();
    const exportData = {
      timestamp: new Date().toISOString(),
      chatMessages: await ChatMessage.find({}).lean(),
      configs: safeConfigs,
      datasets: await Dataset.find({}).lean(),
      sessions: await Session.find({}).lean(),
      // Admin/Auth credentials intentionally excluded.
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
//
// SECURITY: the previous version of this endpoint accepted ANY authenticated
// caller and a literal string 'reset-my-system' as the only guard, which
// meant a stolen / XSS-leaked JWT could wipe the entire database. We now
// require the caller's own admin password as a second factor. The string
// confirmation is still required so the operator can't trigger this by
// accident via a curl-with-cookie misclick.
export const resetSystem = async (req: AuthRequest, res: Response) => {
  try {
    const { confirmation, password } = req.body ?? {};

    if (confirmation !== 'reset-my-system') {
      return res.status(400).json({ error: 'Invalid confirmation code.' });
    }
    if (typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({
        error: 'Admin password is required to authorise a factory reset.',
      });
    }

    // Look the admin up by the JWT's id rather than trusting any
    // username/email in the body — the body is attacker-controlled.
    const adminId = req.user?.id;
    if (!adminId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(401).json({ error: 'Admin account no longer exists.' });
    }
    const passwordOk = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordOk) {
      // Identical error wording for "wrong password" and "missing password"
      // so an attacker can't probe for valid admin IDs.
      return res.status(403).json({ error: 'Password verification failed.' });
    }

    console.log(
      `⚠️ FACTORY RESET TRIGGERED by admin=${admin.username ?? adminId}`,
    );

    // 1. Clear RAM Cache first
    configService.clearCache();
    await aiLoadBalancer.clearAllConversations();

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
