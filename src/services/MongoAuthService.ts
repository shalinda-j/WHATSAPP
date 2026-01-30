import { proto, AuthenticationState, SignalDataTypeMap, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

// Use require to bypass top-level type inference issues with Mongoose
const mongoose = require('mongoose');

// --- Mongoose Schema ---
const AuthSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, default: 'default' }, // Added to partition sessions
    key: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true }
});

// Compound unique index to allow same 'key' across different 'sessionId'
AuthSchema.index({ sessionId: 1, key: 1 }, { unique: true });

// Prevent overwriting model if it already exists (hot reload safety)
let AuthModel: any;
try {
    AuthModel = mongoose.model('AuthCredentials');
} catch (error) {
    AuthModel = mongoose.model('AuthCredentials', AuthSchema);
}

// --- MongoDB Connection Helper ---
export const connectToMongoDB = async (uri: string): Promise<void> => {
    try {
        await mongoose.connect(uri, {
            serverApi: {
                version: '1',
                strict: true,
                deprecationErrors: true,
            }
        });

        // Send a ping to confirm a successful connection (Mongoose way)
        await mongoose.connection.db.admin().command({ ping: 1 });
        console.log("✅ Pinged your deployment. You successfully connected to MongoDB!");

        // --- Migration: Drop stale `key_1` index if it exists ---
        try {
            const collection = mongoose.connection.db.collection('authcredentials');
            const indexes = await collection.indexes();
            const staleIndex = indexes.find((idx: any) => idx.name === 'key_1');
            if (staleIndex) {
                await collection.dropIndex('key_1');
                console.log("🔧 Dropped stale 'key_1' index from authcredentials collection.");
            }
        } catch (migrationError: any) {
            // Ignore if index doesn't exist or collection doesn't exist yet
            if (migrationError.codeName !== 'IndexNotFound' && migrationError.codeName !== 'NamespaceNotFound') {
                console.warn("⚠️ Migration warning:", migrationError.message);
            }
        }

    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
    }
};

// --- Auth Adapter ---
export const useMongoDBAuthState = async (sessionId: string = 'default'): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void>, clearState: () => Promise<void> }> => {

    // Helper to read data
    const readData = async (key: string): Promise<any> => {
        try {
            const data = await AuthModel.findOne({ sessionId, key });
            if (data && data.value) {
                return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            console.error(`Error reading auth key ${key} for session ${sessionId}:`, error);
            return null;
        }
    };

    // Helper to write data
    const writeData = async (key: string, value: any): Promise<void> => {
        try {
            const jsonValue = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
            await AuthModel.findOneAndUpdate(
                { sessionId, key },
                { value: jsonValue },
                { upsert: true, new: true }
            );
        } catch (error) {
            console.error(`Error writing auth key ${key} for session ${sessionId}:`, error);
        }
    };

    // Helper to remove data
    const removeData = async (key: string): Promise<void> => {
        try {
            await AuthModel.deleteOne({ sessionId, key });
        } catch (error) {
            console.error(`Error deleting auth key ${key} for session ${sessionId}:`, error);
        }
    };

    // Explicitly expose method to clear entire session
    const clearState = async (): Promise<void> => {
        try {
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
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(key, value));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', creds);
        },
        clearState
    };
};
