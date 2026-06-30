# Bug-Fix Loop Progress

Standing goal: fix every bug/error/issue. Loop continues until clean.

## Gate status
- backend `tsc --noEmit`: 0 errors
- frontend `tsc -b`: 0 errors

## Iteration 1 (2026-06-30) — DONE: 34 fixes, tsc clean
4 parallel hunters (services / agents+channels / server+app / models+utils+config).
Each finding verified against source before fixing. One finding rejected on verification.

### Fixed — server/app routes (cross-tenant IDOR cluster + misc)
- datasets.ts: GET/:id, PUT/:id/language, POST key-upsert, PUT/:id, PUT/:id key-fallback, DELETE/:id → all now `withTenantScope`
- forms.ts: GET /templates/:id → tenant-scoped
- knowledge.ts: GET /:id → tenant-scoped
- sessions.ts: GET / (list), GET/:id, PUT/:id/name, DELETE/:id (ownership check before deleteSession) → tenant-scoped
- analytics.ts: GET /datasets → tenant-scoped
- config.ts: PUT/:id → 404 instead of 200/null on missing id

### Fixed — services
- ipAllowlist.ts: prefer Express req.ip (trust proxy=1); never trust spoofable first XFF token
- FollowUpScheduler.ts: dormant leads re-messaged every 5min forever → bump updatedAt + new Lead.lastFollowUpAt after dispatch
- optOut.ts: removed ambiguous STOP words NO/END/EPA (normal "no" answers); markContactOptedOut optional tenantId scope; isPhoneOptedOut now symmetric (suffix-regex) with write path
- voice.ts: generateSpeech selects newest ACTIVE VoiceConfig (was newest-any), preserves explicit-disabled throw
- KnowledgeTrainingService.ts: escapeRegex at 3 RegExp/$regex sites (metachars killed auto-learning)
- BookingService.ts: handleSpecificDateRequest strict YYYY-MM-DD parse (non-ISO passed validation → Invalid Date)
- AutoRegistrationService.ts: dedupe lookup tenant-scoped (number was claimed globally by first tenant)
- ConversationEnrichmentService.ts: bare DD/MM requires date context (ratios "9/10","3/4 cup" wrongly set follow_up)
- AgentReflectionService.ts: expireStaleApprovals atomic claim (overlapping ticks double-wrote -1 feedback)

### Fixed — agents
- ContentRecommenderAgent.ts: send untruncated answer to customer (400-char prompt summary was the reply); contact lookup tenant-scoped
- DealAgent.ts: lead lookup tenant-scoped (was corrupting other tenant's CRM)
- PersonalizationAgent.ts: contact lookup tenant-scoped
- AgentRegistry.ts: REJECTED behavior change (empty agentBindings=[] is the model default meaning "all eligible"; only fixed the misleading comment)

### Fixed — models/utils
- scripts/migrate-tenant-id.ts: 'callogs' → 'calllogs' (CallLog rows were never backfilled)
- CRM.ts: name derivation moved to pre('validate') (was dead code; required-name ValidationError fired first)
- ConversationHistory.ts: TTL NaN guard (malformed retention env → TTL index ignored)
- utils/ConfigMigrationGuide.ts: removed top-level side effects (logged + ran on import)

## Iteration 2 (2026-06-30) — deferred items DONE, fresh hunt running
- [x] GoogleCalendar/Booking availability tenant-scope — REJECTED on verification: app uses ONE shared Google calendar (CALENDAR_ID='primary', single creds), so the DB double-booking guard SHOULD be global; per-tenant scoping would let two tenants book the same shared slot. Finding's per-tenant-calendar premise doesn't match the code. (2nd false positive caught by verification.)
- [x] KioskInviteService.resolveContact: threaded tenantId (legacy-tolerant) into both findById + $or lookups; passed input.tenantId (issue) and invite.tenantId (redeem). Defense-in-depth — the actual conversion write was already tenant-scoped via CRMService.updateContact.
- [x] server/app.ts: extracted defaultFormHandler from forms.ts; registered PUBLIC `app.get('/api/forms/default')` BEFORE the authenticated /api/forms mount; removed the dead post-mount bypass middleware. /default is now genuinely public for the bot.
- [x] Fresh hunt (4 hunters) DONE — findings verified + fixed below. Both backend `tsc` + frontend `tsc -b` clean.

### Iteration 2 fresh-hunt fixes — backend
- index.ts: agent-path media language detection used synthetic English note → now uses customer caption (mirrors AI path); leadFlowState unbounded Map → insertion-order cap (10k) with recency refresh
- HumanizerService.processQueue: per-session rate cap was a no-op (queued msgs flushed instantly, uncounted) → honor checkRateCap + recordSend when draining
- WebhookService.triggerWebhook: cross-tenant PII leak (HIGH) — business events fanned to EVERY tenant's webhooks → added tenantId param (legacy-tolerant) + threaded through all 5 callers (BookingService, LeadService [+now stamps lead.tenantId], FormService, kiosk, index.ts)
- tenants.ts: requireAdmin admitted tenant-bound admins (role defaults to 'admin') → renamed requireSuperAdmin, mirrors resolveTenant's super-admin definition (no tenantId binding OR super_admin role). Was cross-tenant priv-esc + DoS (HIGH)
- voiceTelephony.ts: CallLog.create now stamps tenantId (was surfacing in every tenant's call-log list via legacy fallback)
- chat.ts: GET /conversations contact lookup tenant-scoped (cross-tenant name leak)
- leads.ts: GET /:id/messages ChatMessage query tenant-scoped (cross-tenant chat leak)
- optOut.isPhoneOptedOut: added tenantId scope + threaded from FollowUpScheduler(x2), CampaignService, bulk.ts (one tenant's opt-out was suppressing all tenants)
- CampaignService: opt-out gate now channel-aware (email matched by address, not phone digits — fixed both missed email opt-outs AND false-positive suppression of valid emails); rate-limit slice now computed from actual tick interval, not hard-coded /2
- LeadScoringService: scoreInbound/onConversion tenant-scoped + threaded from index.ts + ConversionService

### Iteration 2 fresh-hunt fixes — frontend
- FollowUp.tsx: unguarded c.phone.includes() crashed the whole page on phoneless contacts (HIGH) → guarded; + timeZone:'UTC' on 2 nextFollowUp renders
- ChatInterface.tsx: stale-closure used frozen selectedUser → activeSelectedUser ref (unread badge incremented on the open chat)
- workflowExecution.ts: AI node fetched auth-gated /api/chat (no token, no such route) → /api/marketing/chat with bearer token (was always falling back to canned response)
- agents.ts (backend): GET /:name 404'd reserved names BEFORE the literal /skills route → next() falls through (AgentsHub Skills panel was permanently empty)

### Rejected on verification (architecturally wrong)
- GoogleCalendar/Booking availability per-tenant scope — single shared calendar, global guard is correct
- AgentRegistry empty-allowlist behavior — [] is the model default meaning "all eligible"

## Iteration 3 (2026-06-30) — remaining frontend findings DONE, fresh hunt running
- [x] Campaigns.tsx: variant-image picker was a silent no-op (GenerateResult is an ephemeral preview — no campaign id/variant mediaUrl to PATCH) → retain picked URL in genImageUrl state, pre-fill newImageUrl, surface selected image in the suggestion box
- [x] FormBuilder.tsx: fetchSubmissions/updateStatus/exportCSV migrated from raw fetch() to the shared `api` axios instance (baseURL + 401/403 auth-failure interceptor + blob export)
- [x] VoiceConsultant.tsx: push-to-talk quick-tap race → wantRecordingRef intent flag; startRecording bails if released during getUserMedia; release handlers always fire (not gated on state)
- [x] Calendar.tsx: "Upcoming" now an independent cross-month fetch (current + next real month, deduped), refreshed on create/status-change — was derived only from the browsed month
- [x] CRM.tsx: removed duplicate fetchDashboard() on mount (the [sessionFilter] effect already fires on mount)
- [x] VoiceAgentHub.tsx: audio object URL now revoked on any terminal outcome (play-reject / ended / error), not just onended — leaked when autoplay blocked
- [x] Fresh hunt (3 hunters) DONE — verified + fixed below. Backend `tsc` clean.

### Iteration 3 fresh-hunt fixes — core WhatsApp manager (src/services/whatsapp.ts)
- startSession/deleteSession race: a session deleted DURING startup's awaits re-linked (socket set + handlers registered after the early deletedSessions check) → re-check deletedSessions before sessions.set + a connection.update top-guard for delete-mid-connect; tears the socket down
- 440-conflict retries shared the generic retryCounters with MAX_RETRIES → separate conflictCounters map (never counts toward MAX_RETRIES); reset the other on error-class change; clear retryCounters on give-up so a later manual start isn't instantly capped; reset conflict streak on 'open'/delete/logout
- sendMediaMessage: no connection-state check + no try/catch → unhandled rejection mid-reconnect. Now mirrors sendMessage (requires 'connected', returns false on error)

### Iteration 3 fresh-hunt fixes — commands / intent / AI
- groq.ts: default model 'mixtral-8x7b-32768' is decommissioned (404s every call; Groq is priority 1 → primary always fails, constant Gemini fallover) → new src/config/groqModels.ts coerceToSupportedGroqModel() applied in constructor
- IntentClassifierService: substring keyword match fired short tokens inside words ('hi'⊂'this', 'hey'⊂'they') → word-boundary match for single-word keywords, substring kept for phrases/URLs
- app/commands/QuoteCommand: !everyone/!mencionar dropped the admin's typed announcement (sent only the bare @mention list) → prepend text; removed dead quotedText
- SecurityService: removed 'always answer' jailbreak keyword (false-positived "can you always answer in Sinhala?" → silent security-refusal)
- agents.ts: route restructured to a `next('route')` guard before the asyncHandler (more robust than the prior annotation; same skills-panel fix)

## Iteration 4 — TODO (deferred: HIGH but large/core-path; do carefully)
- [ ] **ConfigService tenant-scoping (2x HIGH, latent in single-tenant deploy)**: ConfigService.get()/getAIPersonality()/getCompanyInfo()/getBookingConfig()/getDynamicKnowledgeBase() read Dataset with NO tenant filter and cache GLOBALLY by key → in a multi-tenant deploy, tenant B's bot serves tenant A's personality/KB/company-info on the MAIN reply path (AILoadBalancer.buildSystemContent → configurationManager → configService). Fix needs: thread tenantId through ConfigService + configurationManager + AILoadBalancer + all callers (gemini.ts, marketing.ts) and namespace the cache by tenantId. Large, touches core path — do as a focused unit with full AILoadBalancer call-graph verification.
- [ ] AgentOrchestrator: config.providerOverride/modelOverride are dead (never forwarded to agent sendMessageRaw calls) — operator's pinned provider/model silently ignored. Carry into AgentContext + forward in each agent.
- [ ] Continue fresh hunt on any remaining un-swept areas (models edge cases, remaining providers openai/openrouter/custom, voiceTelephony providers).
