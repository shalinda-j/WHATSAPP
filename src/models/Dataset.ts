import mongoose, { Schema, Document } from 'mongoose';

export interface IDataset extends Document {
    name: string;
    content: string;
    scope: 'JCETI' | 'GLOBAL' | 'SG' | 'ALL';
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const DatasetSchema = new Schema({
    name: { type: String, required: true },
    content: { type: String, required: true },
    scope: {
        type: String,
        enum: ['JCETI', 'GLOBAL', 'SG', 'ALL'],
        default: 'ALL'
    },
    isActive: { type: Boolean, default: true }
} as any, {
    timestamps: true
});

export default mongoose.model('Dataset', DatasetSchema as any) as unknown as mongoose.Model<IDataset>;
