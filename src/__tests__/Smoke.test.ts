/**
 * Cross-module import smoke. Verifies every major surface boots
 * without exceptions at import time. Catches the failure mode where
 * a refactor accidentally introduces a TDZ / circular-import / static
 * initialiser error that the type-checker wouldn't see.
 *
 * Pure import test — does NOT connect to Mongo, does NOT call agents,
 * does NOT start any timer. Each `require` is wrapped in expect()
 * so a regression in any one module fails as one specific test, not
 * a global Jest crash.
 */

describe('Module import smoke', () => {
  it('imports every channel adapter and the router', () => {
    expect(() => require('../channels')).not.toThrow();
    expect(() => require('../channels/WhatsAppAdapter')).not.toThrow();
    expect(() => require('../channels/TelegramAdapter')).not.toThrow();
    expect(() => require('../channels/InstagramAdapter')).not.toThrow();
    expect(() => require('../channels/FacebookMessengerAdapter')).not.toThrow();
    expect(() => require('../channels/EmailAdapter')).not.toThrow();
  });

  it('imports every specialist agent', () => {
    expect(() => require('../agents/LeadQualifierAgent')).not.toThrow();
    expect(() => require('../agents/PersonalizationAgent')).not.toThrow();
    expect(() => require('../agents/DealAgent')).not.toThrow();
    expect(() => require('../agents/ContentRecommenderAgent')).not.toThrow();
    expect(() => require('../agents/CampaignGeneratorAgent')).not.toThrow();
    expect(() => require('../agents/SegmentationAgent')).not.toThrow();
    expect(() => require('../agents/FollowUpAgent')).not.toThrow();
  });

  it('imports every prompt file', () => {
    expect(() => require('../agents/prompts/lead-qualifier-v1')).not.toThrow();
    expect(() => require('../agents/prompts/personalization-v1')).not.toThrow();
    expect(() => require('../agents/prompts/deal-agent-v1')).not.toThrow();
    expect(() =>
      require('../agents/prompts/content-recommender-v1'),
    ).not.toThrow();
    expect(() =>
      require('../agents/prompts/campaign-generator-v1'),
    ).not.toThrow();
    expect(() => require('../agents/prompts/segmentation-v1')).not.toThrow();
    expect(() => require('../agents/prompts/followup-v1')).not.toThrow();
  });

  it('imports the marketing services', () => {
    expect(() => require('../services/CampaignService')).not.toThrow();
    expect(() => require('../services/SegmentationService')).not.toThrow();
    expect(() => require('../services/SegmentRuleCompiler')).not.toThrow();
    expect(() => require('../services/MarketingInsightsService')).not.toThrow();
    expect(() => require('../services/FollowUpScheduler')).not.toThrow();
    expect(() => require('../services/TenantBootstrapService')).not.toThrow();
  });

  it('imports the multi-tenant model + middleware', () => {
    expect(() => require('../models/Tenant')).not.toThrow();
    expect(() => require('../models/ChannelConnection')).not.toThrow();
    expect(() => require('../models/MarketingCampaign')).not.toThrow();
    expect(() => require('../models/ContactSegment')).not.toThrow();
    expect(() => require('../models/CampaignExecution')).not.toThrow();
    expect(() => require('../server/middleware/tenantContext')).not.toThrow();
  });

  it('imports every API route file', () => {
    expect(() => require('../server/routes/channels')).not.toThrow();
    expect(() => require('../server/routes/campaigns')).not.toThrow();
    expect(() => require('../server/routes/segments')).not.toThrow();
    expect(() => require('../server/routes/tenants')).not.toThrow();
    expect(() => require('../server/routes/marketingInsights')).not.toThrow();
  });

  it('the orchestrator + registry + intent classifier load', () => {
    expect(() => require('../services/AgentOrchestrator')).not.toThrow();
    expect(() => require('../agents/AgentRegistry')).not.toThrow();
    expect(() => require('../services/IntentClassifierService')).not.toThrow();
  });
});
