import {
  proto,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
} from '@whiskeysockets/baileys';

// Use require to bypass top-level type inference issues with Mongoose
import mongoose from 'mongoose';

// --- Mongoose Schema ---
// --- Interface for strict typing ---
interface IAuthCredentials {
  sessionId: string;
  key: string;
  value: any;
}

// --- Mongoose Schema ---
const AuthSchema = new mongoose.Schema<IAuthCredentials>({
  sessionId: { type: String, required: true, default: 'default' }, // Added to partition sessions
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
});

// Compound unique index to allow same 'key' across different 'sessionId'
AuthSchema.index({ sessionId: 1, key: 1 }, { unique: true });

// Safer model initialization: Check mongoose.models first to prevent OverwriteModelError
const AuthModel =
  (mongoose.models.AuthCredentials as any) ||
  (mongoose as any).model('AuthCredentials', AuthSchema);

// Register the monitoring listeners exactly once per process. mongoose.connection
// is a shared singleton, so registering them inside connectToMongoDB (which is
// called on every WhatsApp session start/reconnect) leaked one listener of each
// type per call → Node's "MaxListenersExceededWarning" and a slow memory leak
// that destabilised the connection every DB-backed page (CRM, etc.) relies on.
let mongoConnectionListenersRegistered = false;

// --- MongoDB Connection Helper ---
export const connectToMongoDB = async (uri: string): Promise<void> => {
  // Idempotent: if we're already connected there is nothing to do. Skipping the
  // connect loop here avoids re-pinging + re-running the index migration on
  // every session start, and (crucially) avoids re-registering the listeners.
  if (mongoose.connection.readyState === 1) return;

  const MAX_RETRIES = 5;
  const RETRY_DELAY = 5000; // 5 seconds

  // Add connection event handlers for monitoring — ONCE per process.
  if (!mongoConnectionListenersRegistered) {
    mongoConnectionListenersRegistered = true;

    mongoose.connection.on('connected', () => {
      console.log('📦 MongoDB connection established');
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB connection lost');
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
    });
  }

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      console.log(`⏳ Connecting to MongoDB (Attempt ${i}/${MAX_RETRIES})...`);

      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 30000, // 30 seconds for slower networks
        connectTimeoutMS: 60000, // 60 seconds connection timeout
        socketTimeoutMS: 90000, // 90 seconds socket timeout
        maxPoolSize: 10, // Connection pool size
        minPoolSize: 2, // Minimum connections in pool
        maxIdleTimeMS: 60000, // Close idle connections after 60s
        heartbeatFrequencyMS: 10000, // Check connection health every 10s
        serverApi: {
          version: '1' as const,
          strict: false,
          deprecationErrors: false,
        },
      });

      // Send a ping to confirm a successful connection (Mongoose way)
      if (mongoose.connection.db) {
        await mongoose.connection.db.admin().command({ ping: 1 });
        console.log(
          '✅ Pinged your deployment. You successfully connected to MongoDB!',
        );

        // --- Migration: Drop stale `key_1` index if it exists ---
        try {
          const collection =
            mongoose.connection.db.collection('authcredentials');
          const indexes = await collection.indexes();
          const staleIndex = indexes.find((idx: any) => idx.name === 'key_1');
          if (staleIndex) {
            await collection.dropIndex('key_1');
            console.log(
              "🔧 Dropped stale 'key_1' index from authcredentials collection.",
            );
          }
        } catch (migrationError: any) {
          // Ignore if index doesn't exist or collection doesn't exist yet
          if (
            migrationError.codeName !== 'IndexNotFound' &&
            migrationError.codeName !== 'NamespaceNotFound'
          ) {
            console.warn('⚠️ Migration warning:', migrationError.message);
          }
        }
      }

      // If successful, break the loop
      return;
    } catch (error: any) {
      console.error(
        `❌ MongoDB Connection Error (Attempt ${i}):`,
        error.message,
      );

      if (i < MAX_RETRIES) {
        console.log(`   Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      } else {
        console.error(
          '❌ Failed to connect to MongoDB after multiple attempts. Exiting.',
        );
        // We should probably let the process crash or handle it upstream,
        // but for now, swallowing it caused the timeout issues.
        // Let's rethrow or exit.
        // If we rethrow, startServer matches it.
        // But since this is async, let's keep it simple for now and just log final failure.
        // Ideally we should throw so startServer stops.
        throw error;
      }
    }
  }
};

// --- Auth Adapter ---
export const useMongoDBAuthState = async (
  sessionId = 'default',
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearState: () => Promise<void>;
}> => {
  // Add in-memory cache to prevent 'Bad MAC' decryption errors caused by slow DB reads/writes
  const cache: { [key: string]: any } = {};

  // Helper to read data
  const readData = async (key: string): Promise<any> => {
    try {
      if (cache[key] !== undefined) {
        return cache[key];
      }
      const data = await AuthModel.findOne({ sessionId, key });
      if (data && data.value) {
        const parsed = JSON.parse(
          JSON.stringify(data.value),
          BufferJSON.reviver,
        );
        cache[key] = parsed;
        return parsed;
      }
      cache[key] = null;
      return null;
    } catch (error) {
      console.error(
        `Error reading auth key ${key} for session ${sessionId}:`,
        error,
      );
      return null;
    }
  };

  // Helper to write data
  const writeData = async (key: string, value: any): Promise<void> => {
    try {
      cache[key] = value;
      const jsonValue = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
      await AuthModel.findOneAndUpdate(
        { sessionId, key },
        { value: jsonValue },
        { upsert: true, new: true },
      );
    } catch (error) {
      console.error(
        `Error writing auth key ${key} for session ${sessionId}:`,
        error,
      );
    }
  };

  // Helper to remove data
  const removeData = async (key: string): Promise<void> => {
    try {
      delete cache[key];
      await AuthModel.deleteOne({ sessionId, key });
    } catch (error) {
      console.error(
        `Error deleting auth key ${key} for session ${sessionId}:`,
        error,
      );
    }
  };

  // Explicitly expose method to clear entire session
  const clearState = async (): Promise<void> => {
    try {
      Object.keys(cache).forEach((k) => delete cache[k]);
      await AuthModel.deleteMany({ sessionId });
      console.log(`🧹 Cleared all auth data for session: ${sessionId}`);
    } catch (error) {
      console.error(`Error clearing session ${sessionId}:`, error);
    }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              if (value) {
                data[id] = value;
              }
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof typeof data]) {
              const value = (data[category as keyof typeof data] as any)[id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(key, value));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
    clearState,
  };
};

/**
 * Standalone function to clear auth data for a session
 * Can be called from outside the auth state initialization
 */
export const clearSessionAuthData = async (
  sessionId: string,
): Promise<void> => {
  try {
    const result = await AuthModel.deleteMany({ sessionId });
    console.log(
      `🧹 Cleared ${result.deletedCount} auth entries for session: ${sessionId}`,
    );
  } catch (error) {
    console.error(`Error clearing auth data for session ${sessionId}:`, error);
    throw error;
  }
};
