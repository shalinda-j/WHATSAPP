# Features Roadmap

A prioritised backlog of features that fit the current architecture (multi-channel, multi-tenant, multi-agent marketing automation on TypeScript + MongoDB).

Each item carries a rough **Impact** (business value) and **Effort** (engineering size) tag so the team can pick items off the top.

Legend: Impact = 🔥 high · ✨ medium · 🌱 nice-to-have · Effort = S (≤1d) · M (2–5d) · L (>1 week)

---

## 1. Quick wins (ship in the next sprint)

| #   | Feature                                              | Impact | Effort | Notes                                                                                                           |
| --- | ---------------------------------------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| 1.1 | **Best-time-to-send hint per contact**               | 🔥     | S      | Already track `ChatMessage` timestamps; compute per-JID modal hour and surface in `CampaignService.tickSender`. |
| 1.2 | **Quiet-hours per tenant (timezone-aware)**          | 🔥     | S      | Extend `Tenant` schema with `quietHours{start,end,tz}`; reuse in campaign + follow-up tickers.                  |
| 1.3 | **Lead auto-tagging from intent classifier**         | 🔥     | S      | Pipe `IntentClassifierService` output into `Lead.tags`; powers segmentation.                                    |
| 1.4 | **Conversation summary on lead card**                | ✨     | S      | One Gemini call over last N `ChatMessage`s, cached on `Lead.lastSummary`.                                       |
| 1.5 | **Resend last campaign to non-responders**           | ✨     | S      | Re-query `CampaignExecution` for `delivered && !replied`, queue follow-up variant.                              |
| 1.6 | **CSV/Excel export on Leads, Campaigns, CRM pages**  | 🔥     | S      | Frontend-only (PapaParse + xlsx).                                                                               |
| 1.7 | **Saved segments — favourite filters on Leads page** | ✨     | S      | Persist filter JSON to `Admin.preferences`.                                                                     |
| 1.8 | **Slack/Discord webhook for ops alerts**             | 🔥     | S      | New outbound `WebhookService` channel for "QR expired", "budget cap hit", "approval pending > 1h".              |

## 2. Channel expansion

| #   | Feature                                     | Impact | Effort | Notes                                                                                             |
| --- | ------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------- |
| 2.1 | **SMS adapter (Twilio / Dialog / Mobitel)** | 🔥     | M      | Implement `IChannelAdapter`; great fallback for WhatsApp delivery failures.                       |
| 2.2 | **WhatsApp Cloud API (official) adapter**   | 🔥     | L      | Run side-by-side with Baileys; required for verified business badge + template messages at scale. |
| 2.3 | **Viber & LINE adapters**                   | ✨     | M      | High value for SEA tenants.                                                                       |
| 2.4 | **Web chat widget (embeddable JS)**         | 🔥     | M      | New `WebChatAdapter`; opens funnel beyond messaging apps.                                         |
| 2.5 | **Voice channel — outbound IVR campaigns**  | ✨     | L      | Extend `VoiceCallAgentService` + Twilio Programmable Voice.                                       |
| 2.6 | **Instagram & FB Messenger — finish stubs** | ✨     | M      | Already scaffolded; complete after Meta verification.                                             |

## 3. Marketing & growth

| #   | Feature                                    | Impact | Effort | Notes                                                                                     |
| --- | ------------------------------------------ | ------ | ------ | ----------------------------------------------------------------------------------------- |
| 3.1 | **Visual journey builder (drag-and-drop)** | 🔥     | L      | React Flow on the frontend, persist as `Workflow` graph; replaces ad-hoc follow-up rules. |
| 3.2 | **A/B testing on campaign variants**       | 🔥     | M      | `CampaignService.launch` accepts `variants[]` with split %, log to `experimentLogger`.    |
| 3.3 | **Drip / nurture sequences**               | 🔥     | M      | New `NurtureSequence` model; `FollowUpScheduler` runs steps.                              |
| 3.4 | **Referral & loyalty program engine**      | ✨     | M      | `Referral` model, unique link per `Lead`, attribution on inbound.                         |
| 3.5 | **Surveys, polls & quiz flows**            | ✨     | M      | Extends `FormService` with branching + scoring.                                           |
| 3.6 | **Landing-page builder linked to forms**   | 🌱     | L      | Renders `FormTemplate` as a public page with tenant theme.                                |
| 3.7 | **UTM tracking & attribution**             | 🔥     | S      | Capture `utm_*` on inbound links → `Lead.attribution`.                                    |
| 3.8 | **Predictive lead scoring (ML)**           | 🔥     | M      | Train on `Lead.outcome` history; expose score in CRM.                                     |
| 3.9 | **Churn / dormancy prediction**            | ✨     | M      | Daily job, surface "at-risk" segment.                                                     |

## 4. AI / agent enhancements

| #   | Feature                                           | Impact | Effort | Notes                                                                              |
| --- | ------------------------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------- |
| 4.1 | **RAG over uploaded tenant docs (PDF/DOCX)**      | 🔥     | M      | Build on `AgentRAGService`; add file upload UI + chunking + vector store.          |
| 4.2 | **Sentiment & emotion tagging per message**       | 🔥     | S      | Lightweight classifier; surface red/yellow flags on Chat page.                     |
| 4.3 | **Auto-translate inbound/outbound (Si/Ta/En/Hi)** | 🔥     | M      | Detect → translate → respond in user's language.                                   |
| 4.4 | **Voice cloning per tenant brand**                | ✨     | M      | ElevenLabs voice-id stored on `Tenant.brandVoice`.                                 |
| 4.5 | **Human-in-the-loop co-pilot for live chat**      | 🔥     | M      | Operator sees AI-suggested reply; one click to send/edit.                          |
| 4.6 | **Auto prompt-tuning from approval-queue edits**  | 🔥     | M      | When operator edits a draft, push diff to `AgentPromptVersion` as training signal. |
| 4.7 | **Multi-modal agent (image + voice in)**          | ✨     | M      | Gemini already supports it; wire image inbound through orchestrator.               |
| 4.8 | **Per-agent latency & cost dashboard**            | 🔥     | S      | Aggregate `AgentExecution` + `AgentBudgetLedger`.                                  |

## 5. Sales / CRM

| #   | Feature                                          | Impact | Effort | Notes                                                                      |
| --- | ------------------------------------------------ | ------ | ------ | -------------------------------------------------------------------------- |
| 5.1 | **Pipeline / Kanban view on CRM**                | 🔥     | M      | Stage column persisted on `Lead.stage`.                                    |
| 5.2 | **Quote & invoice generation (PDF)**             | 🔥     | M      | New `Quote` model + PDFKit; send via WhatsApp doc.                         |
| 5.3 | **Payment links (Stripe + PayHere)**             | 🔥     | M      | Tenant-scoped credentials in `ChannelConnection`; webhook closes the deal. |
| 5.4 | **Two-way Google / Outlook calendar sync**       | ✨     | M      | Extend `GoogleCalendarService` with watch channels.                        |
| 5.5 | **Auto-handoff to human when AI confidence low** | 🔥     | S      | Threshold on orchestrator score → route to operator queue.                 |
| 5.6 | **SLA & response-time tracking**                 | ✨     | S      | Add `firstResponseAt` / `slaBreached` on `ChatMessage`.                    |

## 6. Operator & admin tooling

| #   | Feature                                                 | Impact | Effort | Notes                                                            |
| --- | ------------------------------------------------------- | ------ | ------ | ---------------------------------------------------------------- |
| 6.1 | **Role-based access control (RBAC) per tenant**         | 🔥     | M      | `Role` model: owner / marketer / agent / viewer; gate routes.    |
| 6.2 | **Multi-user invites + magic-link onboarding**          | 🔥     | M      | Extends `Admin` model.                                           |
| 6.3 | **2FA (TOTP) + optional SSO (Google / SAML)**           | 🔥     | M      | Use `speakeasy` for TOTP.                                        |
| 6.4 | **Audit log of all admin actions**                      | 🔥     | S      | New `AuditEvent` model; middleware logs writes.                  |
| 6.5 | **In-app notification centre + browser push**           | ✨     | M      | Backed by existing Socket.io.                                    |
| 6.6 | **Onboarding wizard for new tenants**                   | 🔥     | M      | First-run flow: connect channel → import contacts → seed prompt. |
| 6.7 | **White-label tenants (custom logo / domain / colour)** | ✨     | M      | Persist `Tenant.brand`, render on Login + emails.                |
| 6.8 | **Per-tenant public API + API-key management**          | ✨     | M      | Reuse `authenticateToken` with `X-Api-Key`.                      |

## 7. Integrations

| #   | Feature                                         | Impact | Effort | Notes                                                                           |
| --- | ----------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------- |
| 7.1 | **Zapier / Make.com app**                       | 🔥     | M      | Expose REST triggers (lead created, message received) + actions (send message). |
| 7.2 | **Shopify + WooCommerce sync (orders → leads)** | 🔥     | M      | Webhook ingestion + abandoned-cart recovery campaigns.                          |
| 7.3 | **HubSpot / Salesforce bidirectional sync**     | ✨     | L      | Map `Lead` ↔ contact.                                                           |
| 7.4 | **Google Sheets connector for import/export**   | ✨     | S      | Useful for SMB tenants.                                                         |
| 7.5 | **Meta Ads / Google Ads lead-form ingestion**   | 🔥     | M      | Auto-create `Lead` from ad webhooks.                                            |
| 7.6 | **n8n self-hosted workflow node**               | 🌱     | M      | Open-source alternative to Zapier.                                              |

## 8. Compliance, security & privacy

| #   | Feature                                               | Impact | Effort | Notes                                                      |
| --- | ----------------------------------------------------- | ------ | ------ | ---------------------------------------------------------- |
| 8.1 | **GDPR / PDPA data-export & erase per contact**       | 🔥     | M      | `/api/leads/:id/export`, `/api/leads/:id/forget`.          |
| 8.2 | **Opt-in / opt-out per channel + STOP keyword**       | 🔥     | S      | Already partly there; harden + log to `ChannelConnection`. |
| 8.3 | **End-to-end encrypted attachments at rest**          | ✨     | M      | Reuse `CryptoService` for media uploads.                   |
| 8.4 | **IP allowlist + session-timeout config per tenant**  | ✨     | S      | Express middleware.                                        |
| 8.5 | **Per-tenant data residency (region-pinned MongoDB)** | 🌱     | L      | Connection-string router.                                  |
| 8.6 | **PII redaction in logs + AI prompts**                | 🔥     | M      | Regex/NER pass before logging or sending to LLM.           |

## 9. Analytics & reporting

| #   | Feature                                             | Impact | Effort | Notes                                            |
| --- | --------------------------------------------------- | ------ | ------ | ------------------------------------------------ |
| 9.1 | **Customisable dashboards (drag-drop widgets)**     | ✨     | L      | React Grid Layout.                               |
| 9.2 | **Scheduled PDF/CSV reports to email**              | 🔥     | S      | Reuse `EmailAdapter` + cron.                     |
| 9.3 | **Cohort analysis (retention by acquisition week)** | ✨     | M      | Aggregation pipeline on `Lead`.                  |
| 9.4 | **Funnel visualisation per campaign**               | 🔥     | M      | sent → delivered → opened → replied → converted. |
| 9.5 | **Real-time live activity stream**                  | 🌱     | S      | Socket.io already in place.                      |

## 10. Platform & DevOps

| #    | Feature                                                      | Impact | Effort | Notes                                                                                 |
| ---- | ------------------------------------------------------------ | ------ | ------ | ------------------------------------------------------------------------------------- |
| 10.1 | **BullMQ + Redis job queue**                                 | 🔥     | M      | Replace in-process timers (`tickSender`, `FollowUpScheduler`) for horizontal scaling. |
| 10.2 | **Health & status page (`/status`)**                         | 🔥     | S      | Per-channel + per-provider uptime.                                                    |
| 10.3 | **Per-tenant backup & restore**                              | 🔥     | M      | Dump tenant-scoped collections to S3/R2.                                              |
| 10.4 | **Auto-scaling WhatsApp session pool**                       | ✨     | L      | Pre-warm sessions, recycle on QR-expiry.                                              |
| 10.5 | **OpenTelemetry tracing across orchestrator → agents → LLM** | ✨     | M      | One trace per inbound message.                                                        |
| 10.6 | **Mobile companion app (React Native — operator inbox)**     | 🌱     | L      | Reuse REST + Socket.io.                                                               |
| 10.7 | **Plugin SDK — third-party agents**                          | 🌱     | L      | Publish `IAgent` + `IChannelAdapter` as npm packages.                                 |

---

## Suggested next 30 days (if forced to pick 5)

1. **1.8 Slack ops webhook** — instant operations win.
2. **2.1 Twilio SMS adapter** — first non-Meta channel, unlocks fallback delivery.
3. **3.2 Campaign A/B testing** — directly raises conversion on existing volume.
4. **4.1 RAG over tenant docs** — biggest leap in agent quality for the least infra change.
5. **10.1 BullMQ queue** — removes the single-process ceiling before scale becomes urgent.

> Add items here as the team validates demand — keep this file as the canonical "what's next" board.
