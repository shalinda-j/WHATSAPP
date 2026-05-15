# Operator setup guide

This guide walks an operator through bringing a fresh deployment from
"server booted, MongoDB connected" to "every channel + agent producing
end-to-end conversations."

For the architectural overview see [`CLAUDE.md`](../CLAUDE.md). This
document is the runbook.

## 1. Prerequisites

| What                          | How to get it                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB connection string     | MongoDB Atlas free tier is enough for evaluation. Point `MONGODB_URI` at it.                                                                                      |
| `JWT_SECRET`                  | Any 32+ char random string. Used to sign admin login tokens.                                                                                                      |
| `ENCRYPTION_KEY`              | 32 char string. Used to encrypt stored API keys at rest.                                                                                                          |
| At least one LLM provider key | Groq (free tier, fastest), Gemini (free tier, slowest), OpenRouter or OpenAI. Set as `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY`. |

Everything else (Telegram bot tokens, SendGrid API keys, Meta Page
Access Tokens, etc.) is supplied **through the admin UI** at `/channels`
after the server is running — never as environment variables.

## 2. First boot

1. `npm install`
2. `npm run build`
3. `npm run start` (or `npm run dev` for hot reload)
4. The server logs will show three milestones in order:

   ```
   🏢 Created default tenant
   🔁 Auto-migrated 0 legacy row(s) ...   (only on first boot with existing data)
   📡 Registered channels: whatsapp, telegram, instagram, facebook, email
   🤖 Registered agents: lead_qualifier, personalization, deal_agent, content_recommender, campaign_generator, segmentation, follow_up
   ```

5. Visit `http://localhost:8080/` and complete the admin setup wizard.

## 3. Connect WhatsApp

WhatsApp uses the QR-code session manager (the legacy path that
pre-dates this platform refactor):

1. Go to **Linked Devices** in the admin UI.
2. Scan the QR with the WhatsApp account that will host the bot.
3. The session row should flip to `connected` within ~30 seconds.

## 4. Connect Telegram (optional)

1. Open [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`,
   follow the prompts, copy the bot token.
2. In the admin UI go to **Channels** → **Connect channel**.
3. Pick **telegram**, paste the bot token, click Connect.
4. The connection row flips to `active` when the adapter's `getMe`
   probe succeeds. If it shows `failed`, the `lastError` field
   surfaces the exact reason.
5. Send a message to your bot. The orchestrator routes it through the
   same agent decision tree WhatsApp messages go through.

## 5. Connect Email (optional)

1. Get a SendGrid API key with the `mail.send` scope.
2. Verify the From address you'll send from in the SendGrid sender
   authentication UI.
3. In **Channels** → **Connect channel**, pick **email**, fill in
   `provider=sendgrid`, the API key, and your verified From address.
4. (Optional) Configure the SendGrid Event Webhook to point at
   `https://YOUR-DOMAIN/api/webhooks/sendgrid` so delivery / bounce /
   open / spamreport events update the corresponding
   `CampaignExecution` rows in real time.

## 6. Connect Instagram / Facebook Messenger (optional, requires Meta verification)

1. Complete Meta business verification + app review with
   `instagram_manage_messages` and `pages_messaging` permissions.
   ETA: ~2-3 weeks of paperwork — this is the only piece of the rollout
   the platform code cannot accelerate.
2. Once Meta approves:
   - Save your Page Access Token + page/business account id in
     **Channels** → **Connect channel**.
   - Configure Meta's webhook URL to point at
     `https://YOUR-DOMAIN/api/webhooks/instagram/default` (or
     `/facebook/default`), supplying the `verifyToken` you put on
     `ChannelConnection.config.verifyToken`.
3. The handshake GET is automatic — the platform echoes
   `hub.challenge` once the verify token matches.

## 7. Enable agents

All 7 agents ship `mode='disabled'`. To enable:

1. Go to **Agents Hub**.
2. For each agent you want active, switch the mode to either:
   - `approval` — the agent's proposed outbound goes to **Approval Queue**
     for operator review before being sent. **Recommended starting mode.**
   - `autonomous` — the agent's outbound is sent automatically.
3. For each agent you've enabled, watch **Traces** for the first 10-20
   messages — that view shows confidence scores, prompt versions,
   token usage, and reflection notes for every execution.

Recommended enablement order:

1. `personalization` (greetings — lowest risk)
2. `lead_qualifier` (BANT extraction)
3. `content_recommender` (knowledge-base lookups)
4. `deal_agent` (closing — start in approval mode)
5. `campaign_generator` (operator-invoked from `/campaigns`)
6. `segmentation` (operator-invoked from `/segments`)
7. `follow_up` (cron-driven — runs every 5 min against dormant Leads)

## 8. Create your first marketing campaign

1. Go to **Campaigns** → **New campaign**. Pick channels + a name.
2. On the new row, click **Generate variants**. Type the audience
   description + goal, pick variant count. The `campaign_generator`
   agent will produce 1-5 AI variants persisted on the campaign.
3. Optionally link the campaign to a **Segment**: go to **Segments**
   → **Describe a segment**, type a natural-language description.
   The `segmentation` agent compiles it to a rule set; review and
   save. Then on the campaign, set `segmentId` to point at it.
4. Launch the campaign. The sender ticks every 30 seconds, respects
   the campaign's rateLimitPerMinute + quietHours.

## 9. Observability

- `/health` — full readiness probe. Returns 200 only when MongoDB is
  connected, lists every channel's adapter status, and reports agent
  mode counts.
- `/agents/traces` — every agent execution with confidence, tokens,
  cost, latency, side effects, reflection notes.
- `/agents/approvals` — outbound waiting for human approval.
- `/marketing-insights` — per-channel funnel + AI-generated
  recommendations once campaigns are running.

## 10. Multi-tenant deployments

Single-tenant deployments don't need to think about tenants — the
`default` tenant is auto-created and every legacy row is auto-migrated
to it at boot.

For multi-tenant SaaS deployments:

1. Use `POST /api/tenants` to create new tenant slugs.
2. Set the `X-Tenant-Slug` header on every authenticated API call to
   select the active tenant (the `resolveTenant` middleware honours it).
3. Each tenant has its own `ChannelConnection` rows, brand voice,
   budget caps, and (post the next data-migration phase) its own
   Lead / Contact / etc. namespaces.

## Troubleshooting

| Symptom                                                               | Most likely cause                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health` returns 503 with `Database not connected`                   | `MONGODB_URI` is wrong or the Atlas IP allowlist doesn't include your server's IP                                                                        |
| `Channel adapter ... failed: getMe failed` (Telegram)                 | Bot token wrong, or your server can't reach `api.telegram.org` from this network                                                                         |
| `Channel adapter ... failed: From email address not verified` (Email) | Verify the sender in SendGrid first                                                                                                                      |
| Agent log says `agent_silent`                                         | The agent decided the right response was no response. Normal — check the reflection note.                                                                |
| Agent log says `budget_per_conversation`                              | The per-conversation token cap hit. Raise it on the agent's row, or accept the cap.                                                                      |
| Campaign queued but nothing sent                                      | Check `quietHours` on the campaign — sender skips ticks during quiet windows. Also confirm WhatsApp (or whatever channel) is `connected` in `/channels`. |
