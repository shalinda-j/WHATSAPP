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

## Iteration 4 (2026-06-30) — deferred HIGH items resolved, backend tsc clean
- [x] ConfigService keyed-config leak (Finding 1) — **REJECTED on verification**: Dataset.key is `unique:true, sparse:true` GLOBALLY (not compound with tenantId), so only ONE row can ever exist per key (AI_PERSONALITY/COMPANY_INFO/BOOKING_CONFIG/CONVERSATION_EXAMPLES) across the whole DB — a 2nd tenant can't create its own (E11000). Per-key config is global-by-design; ConfigService returning that single row is correct, NOT a cross-tenant leak. (3rd false positive caught by verifying the architectural premise — would've been a wasted ~10-file refactor + pointless per-tenant cache keys.)
- [x] getDynamicKnowledgeBase (Finding 2) — REAL: knowledge/megatext datasets are NOT keyed, so they can be per-tenant; the unscoped read concatenated every tenant's KB. Main bot path already used the scoped getKnowledgeBaseForAI, so fixed the real tenant-aware caller: scoped the Dataset query (legacy-tolerant) + namespaced cache by tenantId in ConfigService + ConfigurationManagerService.getAIKnowledgeBase, threaded tenantId from the marketing /chat route (JWT tenantId).
- [x] AgentOrchestrator provider/model override — FIXED: added providerOverride/modelOverride to AgentContext, orchestrator copies them from AgentConfig into ctxWithPrompt, all 5 agents forward them to sendMessageRaw. providerOverride now actually works (used for provider ordering). NOTE: modelOverride is forwarded but sendMessageRaw currently accepts-and-ignores it (no per-provider model switching) — a deeper downstream gap left for later.

## Coverage note
4 iterations have now swept the full codebase: services (75), agents (17), channels (9), server/app (64), models (35), utils/config, all frontend pages, index.ts message flow, whatsapp.ts session manager, commands, AI/config layer. ~95 fixes applied; 3 findings rejected on architectural verification (calendar shared-cal, AgentRegistry empty-allowlist, ConfigService global-key). Findings are drying up (loop-until-dry).

## Iteration 5 (2026-06-30) — self-review + final hunt DONE, backend tsc clean
3 agents: 2 adversarial self-reviews of the sweep's own edits + 1 hunt on un-swept files.

### REGRESSION I introduced — caught + fixed
- HumanizerService.processQueue (my iteration-3 rate-cap fix): the rate-capped head of the SHARED cross-session queue blocked every other session behind it (sleep+continue on index 0 forever). Rewrote: rotate blocked (rate-capped / no-socket / retryable-error) messages to the tail; sleep only ONCE per full pass when every message is blocked (consecutiveSkips guard) — no starvation, no busy-spin.

### Self-review nuance — fixed
- whatsapp.ts conflict branch: was resetting generic retryCounters on every 440-conflict, so a session flapping generic↔conflict never reached the MAX_RETRIES give-up. Removed the reset — generic counter now resets only on a successful 'open' (conflicts still tracked separately, never count toward the cap).

### Self-review CLEAN (strong validation)
- Tenant-scoping review of ALL 20+ changed queries: empty findings. withTenantScope $and-nesting correct everywhere; no $or collisions; WebhookService callers all pass tenantId in the correct 3rd-arg position; findOneAndUpdate/Delete filters match the right docs.

### Final hunt — un-swept files
- groqModels.ts: my decommissioned-pattern list missed the retired undotted llama3-8b-8192 / llama3-70b-8192 family → broadened to /^llama3-/i (current models use dotted 'llama-3.x', so safe).
- custom.ts: no per-request timeout (OpenAI SDK 10-min default) → socket leak after the LB's outer timeout moved on. Added withTimeout + { timeout } matching openai/groq/openrouter.
- Verified clean: MongoAuthService (BufferJSON round-trip, clearState), provider !hasSystem fallback (dead in live path — LB always supplies a system msg), voiceTelephony providers (intentional stubs).

## Status: CONVERGING
5 iterations, ~99 fixes, full-codebase coverage + a self-review that caught 1 of my own regressions. 3 architectural false-positives rejected. The 2nd self-review (tenant queries) and most of the provider hunt came back clean — findings have largely dried up. Iterations 4-5 changes are NOT yet committed/pushed (iterations 1-3 are, commit cae53fe).

## Iteration 6 (2026-06-30) — re-verify + final convergence round, backend tsc clean
- [x] Re-verified the iteration-5 HumanizerService.processQueue rewrite by tracing all edge cases (capped-head, all-no-socket, mixed): rotates blocked messages, sleeps once per full pass, guaranteed termination. Correct.
- [x] Auth/security middleware review (auth.ts/validation.ts/rateLimit.ts/tenantContext.ts/socket.ts): CLEAN — real jwt.verify (sig+expiry), no missing-return bypass, role checks consistent, validateObjectId correct, rateLimit per-IP+path behind trust proxy. Strong assurance.
- [x] Remaining-services review (SLA/segmentation/budget/approval/RAG/CRM/history): mostly clean (atomic $inc, escaped regex, $and-nesting correct). ONE finding — fixed:
  - ConversationHistory keyed by bare JID only (userId unique) → a customer messaging two tenants shared ONE merged AI history row (cross-tenant conversation-content leak + corrupted context). Added tenantId field + compound unique {userId,tenantId} index; threaded optional tenantId through all 5 service methods (legacy-tolerant: undefined→userId-only) + AILoadBalancer call sites + index.ts (msg.tenantId / defaultTenantId). SAFE for the single-tenant live deploy: TenantBootstrapService already backfills tenantId on conversationhistories at boot, so scoped reads/writes still match existing rows (no history reset). Multi-tenant operator action documented: drop the legacy userId_1 index.

## Status: CONVERGED (pending one final confirmation)
6 iterations, ~100 fixes, full-codebase coverage. Last two rounds were validation-heavy: tenant-query review clean, auth review clean, only 1 actionable finding in the entire final services+auth sweep (fixed). 3 architectural false-positives correctly rejected; 1 self-introduced regression caught + fixed. Findings have dried up.
Commits: iterations 1-3 pushed (cae53fe). Iterations 4-6 staged in working tree, NOT yet committed.

## Iteration 7 (2026-06-30) — completeness critic caught 2 bugs in MY iteration-6 change, both fixed. tsc clean (backend + frontend)
The critic verified the ConversationHistory change AND found 2 real defects I introduced:
- HIGH — missed caller: GeminiCommand (`!ai`/`!ask`/`!chat`/`!gpt`) called sendMessage/clearConversation WITHOUT tenantId, so a customer whose first message was `!ask` got a tenantId-less history row; later main-path (defaultTenantId) writes then hit E11000 forever (caught/swallowed) → permanent AI-memory loss + log spam. Fixes:
  - Root: TenantBootstrapService now drops the legacy `userId_1` index at boot AFTER ensuring the compound {userId,tenantId} index exists (fail-safe: keeps the old index if the compound can't build). Eliminates the E11000 for ALL callers, present + future.
  - Continuity: added getDefaultTenantId() cached accessor to TenantBootstrapService; threaded into GeminiCommand + VoiceHandler so command + main paths share one tenant-scoped history row.
  - Also fixed the same `callogs`→`calllogs` typo in TenantBootstrapService's backfill list.
- LOW — AILoadBalancer.historyCache was keyed by userId only (in front of the now-scoped DB read) → would re-leak cross-tenant context in multi-tenant. Keyed by `${tenantId}:${userId}` at all 4 sites.
Completeness scan (Part B) was CLEAN: schedulers all wired, slaTracker pure+scoped, VoiceHandler orphaned dead code, synthetic-key callers (workflow/call_agent_greeting) don't collide with real JIDs. No systematic gap.

## ✅ CONVERGED (2026-06-30 → 07-01)
7 iterations + a runtime-test pass. ~104 fixes. Full backend + frontend tsc: 0 errors. **Full `npm run build` (client + backend): SUCCESS**. **Jest suite: 181/181 passing across 18 suites.** Iteration-7 edits independently reviewed: clean. Full-codebase coverage.

### Iteration 8 (2026-07-01) — ran the test suite (runtime verification)
- `npm test` is safe as configured (runInBand, maxWorkers 1, transpile-only, 512MB cap); invoke jest's real JS entry on Windows (`node node_modules/jest/bin/jest.js`) — the `node node_modules/.bin/jest` script form fails in Git Bash (executes the shell wrapper as JS).
- 1 test broke: `IpAllowlist.test.ts › "prefers the first hop in x-forwarded-for"` asserted the OLD insecure XFF-spoofing behavior that the iteration-1 security fix removed. Updated it to assert req.ip-first (+ added a last-hop-fallback regression guard). All green after.
- Verification trifecta now complete: tsc + build + tests.
- Pre-existing bugs fixed in iterations 1-4 (~95). Iterations 5-7 were verification rounds: they found only defects in the sweep's OWN newly-added code (1 Humanizer regression, the ConversationHistory follow-ons) — all fixed. The last completeness scan found NO pre-existing systematic gaps.
- 3 architectural false-positives rejected via premise-verification (calendar shared-cal, AgentRegistry empty-allowlist, ConfigService global-key).
- Reviews that came back fully clean: tenant-query nesting (it.5), auth/security middleware (it.6), completeness Part B (it.7).
Findings have dried up: the only things surfacing now are in code added THIS sweep, which is stable and verified. Further hunting has ~zero marginal yield on pre-existing bugs.

## Commit status
- Iterations 1-3: committed + pushed (cae53fe, branch fix/integration-defects-2026-06-26).
- Iterations 4-7: staged in working tree, NOT yet committed. Ready to commit/push on request.

## Remaining (operator/owner actions, NOT code bugs)
- Multi-tenant: the boot index-drop now handles ConversationHistory automatically; no manual step needed.
- Deferred deeper gap (documented, not a regression): sendMessageRaw accepts modelOverride but doesn't apply it per-provider (providerOverride DOES work). Would need per-provider model switching.
- DigitalOcean↔GitHub access still blocked (separate infra issue) — owner must re-authorize for auto-deploy.
