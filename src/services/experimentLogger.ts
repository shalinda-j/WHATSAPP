/**
 * Experiment Logger Service
 * Logs autoresearch experiment results to MongoDB
 */

import mongoose from 'mongoose';

// Use require to avoid TypeScript type instantiation issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Schema, model } = require('mongoose');

const experimentSchema = new Schema(
  {
    experimentId: { type: String, required: true, unique: true },
    commit: { type: String, required: true },
    valBpb: { type: Number, required: true },
    peakMemoryMb: { type: Number, required: true },
    changesMade: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    kept: { type: Boolean, default: false },
    status: { type: String, enum: ['keep', 'discard', 'crash'], default: 'discard' },
    trainingSeconds: { type: Number },
    totalTokensM: { type: Number },
    numSteps: { type: Number },
    numParamsM: { type: Number },
    mfuPercent: { type: Number },
    depth: { type: Number },
  },
  { timestamps: true, collection: 'experiment_results' }
);

experimentSchema.index({ experimentId: 1 });
experimentSchema.index({ timestamp: -1 });
experimentSchema.index({ valBpb: 1 });

// Use mongoose.models to avoid recompilation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExperimentResult: any = mongoose.models.ExperimentResult || model('ExperimentResult', experimentSchema);

/**
 * Experiment Logger
 */
export class ExperimentLogger {
  private static instance: ExperimentLogger;

  public static getInstance(): ExperimentLogger {
    if (!ExperimentLogger.instance) {
      ExperimentLogger.instance = new ExperimentLogger();
    }
    return ExperimentLogger.instance;
  }

  async logExperiment(params: {
    commit: string;
    valBpb: number;
    peakMemoryMb: number;
    changesMade: string;
    status: string;
    trainingSeconds?: number;
    totalTokensM?: number;
    numSteps?: number;
    numParamsM?: number;
    mfuPercent?: number;
    depth?: number;
  }): Promise<void> {
    const experimentId = `${params.commit}_${Date.now()}`;
    await ExperimentResult.create({ ...params, experimentId, kept: params.status === 'keep' });
    console.log(`[ExperimentLogger] Logged: val_bpb=${params.valBpb}, status=${params.status}`);
  }

  async syncFromTsv(tsvContent: string): Promise<number> {
    const lines = tsvContent.trim().split('\n');
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length < 5) continue;
      const [commit, valBpbStr, memoryGbStr, status, description] = parts;
      const valBpb = parseFloat(valBpbStr) || 0;
      const peakMemoryMb = (parseFloat(memoryGbStr) || 0) * 1024;
      const existing = await ExperimentResult.findOne({ commit, valBpb, changesMade: description });
      if (!existing) {
        await this.logExperiment({ commit, valBpb, peakMemoryMb, changesMade: description, status });
        count++;
      }
    }
    return count;
  }

  async getBestExperiments(limit = 10) {
    return ExperimentResult.find({ status: 'keep' }).sort({ valBpb: 1 }).limit(limit).lean();
  }

  async getRecentExperiments(limit = 20) {
    return ExperimentResult.find().sort({ timestamp: -1 }).limit(limit).lean();
  }

  async getStatistics() {
    const totalExperiments = await ExperimentResult.countDocuments();
    const keptExperiments = await ExperimentResult.countDocuments({ status: 'keep' });
    const crashedExperiments = await ExperimentResult.countDocuments({ status: 'crash' });
    const bestResult = await ExperimentResult.findOne({ status: 'keep' }).sort({ valBpb: 1 }).lean();
    const avgResult = await ExperimentResult.aggregate([
      { $match: { status: 'keep' } },
      { $group: { _id: null, avgValBpb: { $avg: '$valBpb' } } },
    ]);
    return {
      totalExperiments,
      keptExperiments,
      crashedExperiments,
      bestValBpb: bestResult?.valBpb ?? null,
      avgValBpb: avgResult[0]?.avgValBpb ?? null,
      improvementRate: totalExperiments > 0 ? (keptExperiments / totalExperiments) * 100 : 0,
    };
  }

  async clearOldExperiments(keepCount = 100): Promise<number> {
    const experiments = await ExperimentResult.find().sort({ timestamp: -1 }).skip(keepCount).select('_id');
    if (experiments.length === 0) return 0;
    const ids = experiments.map((e: any) => e._id);
    return (await ExperimentResult.deleteMany({ _id: { $in: ids } })).deletedCount;
  }
}

export const experimentLogger = ExperimentLogger.getInstance();
export default experimentLogger;