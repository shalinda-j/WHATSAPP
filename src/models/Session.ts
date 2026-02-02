import mongoose, { Document, Schema } from 'mongoose';

interface ISession {
    sessionId: string;
    sessionName?: string;
    status: 'connecting' | 'connected' | 'disconnected' | 'scan_qr' | 'reconnecting';
    qr?: string;
    phoneNumber?: string;
    createdAt: Date;
    updatedAt: Date;
}

const SessionSchema = new Schema<ISession>({
    sessionId: { type: String, required: true, unique: true },
    sessionName: { type: String },
    status: {
        type: String,
        enum: ['connecting', 'connected', 'disconnected', 'scan_qr', 'reconnecting'],
        default: 'disconnected'
    },
    qr: { type: String },
    phoneNumber: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Modern Mongoose 7+ pre-save hook (no 'next' callback needed for async)
SessionSchema.pre('save', async function () {
    this.updatedAt = new Date();
});

const Session = mongoose.model('Session', SessionSchema as any) as unknown as mongoose.Model<ISession>;

export default Session;

