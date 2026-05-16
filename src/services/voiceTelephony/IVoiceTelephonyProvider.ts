/**
 * Voice telephony provider abstraction. Same pattern as channel adapters —
 * every provider (Twilio, generic SIP, regional SLT/Dialog/Hutch trunks,
 * WhatsApp Cloud API) implements this shape so the orchestrator stays
 * provider-agnostic.
 *
 * Adapters declared here are mostly stubs today. Real bidirectional voice
 * needs runtime SIP/RTP plumbing that we cannot exercise without the
 * operator's account credentials + a registered SIP trunk. The interface
 * is finalized now so the moment credentials arrive, only the provider's
 * methods need to be filled in — no orchestrator / UI changes required.
 */

export type CallDirection = 'inbound' | 'outbound';
export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'answered'
  | 'completed'
  | 'failed'
  | 'no-answer'
  | 'busy';

export interface OutboundCallRequest {
  /** E.164 number for PSTN or `sip:user@host` for SIP-direct. */
  to: string;
  /** Caller-ID / from-number. Defaults to the provider's primary line. */
  from?: string;
  /** Webhook the provider POSTs media + status updates to. */
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundCallResult {
  providerCallId: string;
  status: CallStatus;
}

export interface ProviderReadiness {
  ready: boolean;
  missing: string[];
  notes?: string;
}

export interface IVoiceTelephonyProvider {
  /** Stable lowercase identifier — used in routes, configs, UI. */
  readonly name: string;
  /** Human-friendly label shown in the admin UI. */
  readonly displayName: string;
  /** Env vars required for `ready: true`. */
  readonly requiredEnv: string[];
  /** Whether this provider supports live two-way audio (vs. voice-note only). */
  readonly supportsLiveCalls: boolean;
  /** Whether this provider supports initiating outbound calls. */
  readonly supportsOutbound: boolean;

  readiness(): ProviderReadiness;

  /**
   * Place an outbound call. Implementations should return a provider-side
   * call id immediately so the caller can correlate later webhooks. Throws
   * if the provider isn't `ready` or if it doesn't support outbound.
   */
  initiateCall(req: OutboundCallRequest): Promise<OutboundCallResult>;
}
