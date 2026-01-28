import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not defined in .env');
    process.exit(1);
}

const clearSession = async () => {
    try {
        await mongoose.connect(MONGODB_URI, {
            serverApi: {
                version: '1',
                strict: true,
                deprecationErrors: true,
            }
        });
        console.log('✅ Connected to MongoDB');

        // Define the schema/model just like in the app
        const AuthSchema = new mongoose.Schema({
            key: { type: String, required: true, unique: true },
            value: { type: mongoose.Schema.Types.Mixed, required: true }
        } as any);

        let AuthModel;
        try {
            AuthModel = mongoose.model('AuthCredentials');
        } catch {
            AuthModel = mongoose.model('AuthCredentials', AuthSchema as any);
        }

        console.log('🗑️ Clearing session data...');
        const result = await AuthModel.deleteMany({});
        console.log(`✅ Deleted ${result.deletedCount} session documents.`);

    } catch (error) {
        console.error('❌ Error clearing session:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
};

clearSession();
