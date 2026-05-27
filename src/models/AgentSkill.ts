import mongoose, { Schema, Document } from 'mongoose';

/**
 * A reusable "skill" — a self-contained block of instructions (a marketing
 * framework, a qualification methodology, a tone guide, etc.) that the
 * operator authors ONCE in the Skills tab and then assigns to one or more
 * agents. At inference time the AgentOrchestrator concatenates the
 * promptSection of every active assigned skill onto the agent's base
 * system prompt — so adding BANT to LeadQualifier doesn't require editing
 * the LeadQualifier's prompt or shipping new code.
 *
 * Categories help the UI group skills (Sales / Marketing / Support /
 * Personalisation / Tone) but aren't enforced semantically.
 */
export type SkillCategory =
  | 'sales'
  | 'marketing'
  | 'support'
  | 'personalisation'
  | 'tone'
  | 'other';

export interface IAgentSkill extends Document {
  tenantId: mongoose.Types.ObjectId;
  /** Human-readable name shown in the UI (e.g. "BANT Qualification"). */
  name: string;
  /** Short description shown on the card. */
  description?: string;
  category: SkillCategory;
  /**
   * Prompt fragment that teaches this skill. Concatenated into the agent's
   * system prompt at runtime. Keep concise — ~200-600 chars works best
   * since multiple skills may stack.
   */
  promptSection: string;
  /**
   * Optional inline example pairs that get treated like RAG training
   * data for the agents this skill is assigned to. Saves the operator
   * uploading them separately for each agent.
   */
  exampleSnippets: Array<{
    input: string;
    expectedOutput: string;
    tags: string[];
  }>;
  /** Names of agents this skill is currently assigned to. */
  assignedAgents: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AgentSkillSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String },
    category: {
      type: String,
      enum: [
        'sales',
        'marketing',
        'support',
        'personalisation',
        'tone',
        'other',
      ],
      default: 'other',
      index: true,
    },
    promptSection: { type: String, required: true },
    exampleSnippets: {
      type: [
        {
          input: { type: String, required: true },
          expectedOutput: { type: String, required: true },
          tags: { type: [String], default: [] },
        },
      ],
      default: [],
    },
    assignedAgents: { type: [String], default: [], index: true },
    isActive: { type: Boolean, default: true, index: true },
  } as any,
  { timestamps: true },
);

AgentSkillSchema.index({ tenantId: 1, assignedAgents: 1, isActive: 1 });

const __AgentSkillModel =
  mongoose.models.AgentSkill ||
  mongoose.model('AgentSkill', AgentSkillSchema as any);
export default __AgentSkillModel as unknown as mongoose.Model<IAgentSkill>;
