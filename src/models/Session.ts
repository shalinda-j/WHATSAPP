import mongoose from 'mongoose';

const SessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    sessionName: { type: String }, // User friendly name (e.g. "Support Line 1")
    status: {
        type: String,
        enum: ['connecting', 'connected', 'disconnected', 'scan_qr', 'reconnecting'],
        default: 'disconnected'
    },
    qr: { type: String }, // Current QR code if status is 'scan_qr'
    phoneNumber: { type: String }, // Connected phone number
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
SessionSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const Session = mongoose.model('Session', SessionSchema);

export default Session;
