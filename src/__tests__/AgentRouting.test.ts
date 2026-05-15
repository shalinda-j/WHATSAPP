/**
 * Cross-agent routing-contract tests. Each conversational agent's
 * canHandle() is a sub-millisecond keyword pass; together they form
 * the orchestrator's routing decision tree. These tests pin the
 * relative scoring so the agent that should win a turn keeps winning
 * after future keyword-list edits.
 */

import { PersonalizationAgent } from '../agents/PersonalizationAgent';
import { DealAgent } from '../agents/DealAgent';
import { ContentRecommenderAgent } from '../agents/ContentRecommenderAgent';
import { LeadQualifierAgent } from '../agents/LeadQualifierAgent';
import { FollowUpAgent } from '../agents/FollowUpAgent';
import { CampaignGeneratorAgent } from '../agents/CampaignGeneratorAgent';
import { SegmentationAgent } from '../agents/SegmentationAgent';
import { AgentContext } from '../types/agent';

function ctx(input: string): AgentContext {
  return {
    traceId: 'test-trace',
    sessionId: 'tenant-default',
    userId: '94771234567@s.whatsapp.net',
    channel: 'whatsapp',
    language: 'si',
    inputMessage: input,
    conversationHistory: [],
    metadata: {},
  };
}

describe('PersonalizationAgent.canHandle', () => {
  const agent = new PersonalizationAgent();

  it('scores greetings highly', async () => {
    expect(await agent.canHandle(ctx('hi'))).toBeGreaterThan(0);
    expect(await agent.canHandle(ctx('hello'))).toBeGreaterThan(0);
    expect(await agent.canHandle(ctx('ayubowan'))).toBeGreaterThan(0);
  });

  it('scores non-greeting questions low so LeadQualifier / DealAgent win on inquiries', async () => {
    // PersonalizationAgent has a short-message bonus, but the design
    // intent is that real inquiries route to the qualifier — so the
    // score here should be < the booking/qualification agents on the
    // same message.
    const c = ctx('how much does the visa cost?');
    const personScore = await agent.canHandle(c);
    expect(personScore).toBeLessThan(0.55);
  });
});

describe('DealAgent.canHandle', () => {
  const agent = new DealAgent();

  it('scores booking-intent text highly', async () => {
    const score = await agent.canHandle(ctx('I want to book an appointment'));
    expect(score).toBeGreaterThan(0.55);
  });

  it('returns 0 when no booking intent is present', async () => {
    expect(await agent.canHandle(ctx('thanks for the info'))).toBe(0);
  });

  it('caps below 1.0 even with maximum keyword density', async () => {
    const score = await agent.canHandle(
      ctx('book appointment schedule interview meeting tomorrow now please'),
    );
    expect(score).toBeLessThan(1.0);
  });
});

describe('ContentRecommenderAgent.canHandle', () => {
  const agent = new ContentRecommenderAgent();

  it('scores product/question text above 0', async () => {
    const score = await agent.canHandle(
      ctx('how does the training process work?'),
    );
    expect(score).toBeGreaterThan(0);
  });

  it('caps below 0.7 so LeadQualifier and DealAgent can outscore it', async () => {
    const score = await agent.canHandle(
      ctx(
        'how what why when where price cost fee salary visa training process detail',
      ),
    );
    expect(score).toBeLessThanOrEqual(0.7);
  });
});

describe('Non-conversational agents return 0 on inbound', () => {
  it.each([
    ['CampaignGeneratorAgent', new CampaignGeneratorAgent()],
    ['SegmentationAgent', new SegmentationAgent()],
    ['FollowUpAgent', new FollowUpAgent()],
  ])('%s.canHandle returns 0', async (_name, agent) => {
    expect(await agent.canHandle(ctx('hi there, looking for a job'))).toBe(0);
  });
});

describe('Cross-agent priority (the orchestrator picks the highest)', () => {
  const personalization = new PersonalizationAgent();
  const leadQualifier = new LeadQualifierAgent();
  const dealAgent = new DealAgent();
  const contentRecommender = new ContentRecommenderAgent();

  it('booking intent beats greeting on the same message', async () => {
    const c = ctx('hi, can I book an appointment for tomorrow?');
    const greetingScore = await personalization.canHandle(c);
    const bookingScore = await dealAgent.canHandle(c);
    expect(bookingScore).toBeGreaterThan(greetingScore);
  });

  it('job inquiry routes to LeadQualifier, not ContentRecommender', async () => {
    const c = ctx(
      'what jobs are available in Japan? interested in factory work',
    );
    const qualifyScore = await leadQualifier.canHandle(c);
    const contentScore = await contentRecommender.canHandle(c);
    expect(qualifyScore).toBeGreaterThan(contentScore);
  });
});
