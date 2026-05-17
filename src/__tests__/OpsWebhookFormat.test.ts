import { _buildOpsPayload } from '../services/WebhookService';

describe('_buildOpsPayload', () => {
  const baseAlert = {
    level: 'warn' as const,
    title: 'Approval queue backlog',
    body: '25 pending approvals',
  };

  it('builds a Slack-compatible {text} payload', () => {
    const payload = _buildOpsPayload('slack', baseAlert) as { text: string };
    expect(payload.text).toContain('Approval queue backlog');
    expect(payload.text).toContain('25 pending approvals');
    expect(payload.text).toContain(':warning:');
  });

  it('builds a Discord embed payload with the level colour', () => {
    const payload = _buildOpsPayload('discord', baseAlert) as {
      content: string;
      embeds: Array<{ color: number; description: string }>;
    };
    expect(payload.content).toContain('Approval queue backlog');
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].color).toBe(0xf59e0b);
    expect(payload.embeds[0].description).toBe('25 pending approvals');
  });

  it('builds a generic JSON envelope with event=ops.alert', () => {
    const payload = _buildOpsPayload('generic', baseAlert) as {
      event: string;
      payload: { level: string; title: string; body: string };
    };
    expect(payload.event).toBe('ops.alert');
    expect(payload.payload.level).toBe('warn');
    expect(payload.payload.title).toBe('Approval queue backlog');
  });

  it('renders structured fields in the Slack message body', () => {
    const payload = _buildOpsPayload('slack', {
      ...baseAlert,
      fields: { pending: 25, agent: 'lead_qualifier' },
    }) as { text: string };
    expect(payload.text).toContain('pending');
    expect(payload.text).toContain('25');
    expect(payload.text).toContain('lead_qualifier');
  });

  it('passes the source url through to Discord embeds', () => {
    const payload = _buildOpsPayload('discord', {
      ...baseAlert,
      url: 'https://admin.example.com/approvals',
    }) as { embeds: Array<{ url?: string }> };
    expect(payload.embeds[0].url).toBe('https://admin.example.com/approvals');
  });

  it('escalates colour by level', () => {
    const info = _buildOpsPayload('discord', {
      ...baseAlert,
      level: 'info',
    }) as { embeds: Array<{ color: number }> };
    const critical = _buildOpsPayload('discord', {
      ...baseAlert,
      level: 'critical',
    }) as { embeds: Array<{ color: number }> };
    expect(info.embeds[0].color).toBe(0x3b82f6);
    expect(critical.embeds[0].color).toBe(0x991b1b);
  });
});
