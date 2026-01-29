import mongoose, { Document, Schema, CallbackWithoutResultAndOptionalError } from 'mongoose';

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

SessionSchema.pre('save', function (next: CallbackWithoutResultAndOptionalError) {
    this.updatedAt = new Date();
    next();
});

const Session = mongoose.model('Session', SessionSchema as any) as unknown as mongoose.Model<ISession>;

export default Session;

