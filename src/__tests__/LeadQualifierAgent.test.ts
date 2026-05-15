/**
 * Smoke tests for LeadQualifierAgent.canHandle() — the sub-millisecond
 * keyword pass that the orchestrator uses to decide whether this agent
 * should even attempt the LLM-backed execute(). The keyword list is
 * intentionally multilingual (English + Romanised Sinhala + a few
 * country names) so this test fixture pins the "what scores high"
 * contract.
 *
 * execute() (the LLM call) is NOT tested here — it requires the
 * aiLoadBalancer + LLM provider responses, and is covered behaviourally
 * by integration runs against real Groq/Gemini in staging.
 */

import { LeadQualifierAgent } from '../agents/LeadQualifierAgent';
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

describe('LeadQualifierAgent.canHandle', () => {
  const agent = new LeadQualifierAgent();

  it('returns 0 for messages that contain no trigger tokens', async () => {
    expect(await agent.canHandle(ctx('hello, how are you'))).toBe(0);
    expect(await agent.canHandle(ctx('thanks!'))).toBe(0);
  });

  it('returns 0 for extremely short input', async () => {
    expect(await agent.canHandle(ctx('a'))).toBe(0);
  });

  it('scores a job-related query above 0.5', async () => {
    const score = await agent.canHandle(ctx('I am looking for a job in Japan'));
    expect(score).toBeGreaterThan(0.5);
  });

  it('scores higher with more relevant keywords', async () => {
    const single = await agent.canHandle(ctx('any work?'));
    const dense = await agent.canHandle(
      ctx('Looking for a factory job in Japan, what about visa and salary?'),
    );
    expect(dense).toBeGreaterThan(single);
  });

  it('handles Romanised Sinhala overseas-jobs phrasing', async () => {
    const score = await agent.canHandle(
      ctx('mata rakiya bandagan denna puluwanda Japan eke'),
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it('caps the score below 1.0 regardless of keyword density', async () => {
    const score = await agent.canHandle(
      ctx(
        'job jobs vacancy vacancies apply opportunity work rakiya rakiyak welada wedek wadak rassawak rassawa japan korea qatar dubai saudi oman welding caregiver factory construction hotel experience salary visa training interested',
      ),
    );
    expect(score).toBeLessThan(1.0);
    expect(score).toBeLessThanOrEqual(0.95);
  });
});
