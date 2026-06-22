import { generateSpeech } from './voice';
import { callAssistant } from './CallAssistantService';
import CallLog from '../models/CallLog';

/**
 * LiveCallService — pluggable incoming-call answering for WhatsApp.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE EXPECTING LIVE AUDIO TO WORK
 * ───────────────────────────────────────────────────────────────────────────
 * "Direct live call answer" (pick up the call and TALK back inside the call,
 * not via a voice note) is NOT possible on the transport this project currently
 * uses. That is a hard platform limitation, NOT a bug in our code:
 *
 *   • This bot talks to WhatsApp through Baileys (@whiskeysockets/baileys),
 *     which is a reverse-engineered WhatsApp *Web* client.
 *   • WhatsApp voice/video calls are carried over WebRTC with end-to-end
 *     encryption (SRTP). Baileys does NOT implement a WebRTC media stack.
 *   • Because of that, Baileys can only *detect* an incoming call offer and
 *     *reject* it (`sock.rejectCall`). It cannot ACCEPT a call, and it cannot
 *     send or receive the live audio stream. There is no "answer with audio"
 *     primitive to call.
 *
 * So on Baileys the only sane behaviour is the "reject + smart reply" flow
 * (RejectReplyProvider below), which is what ships today.
 *
 * The ONLY way to genuinely answer a WhatsApp call live with synthesized speech
 * is to move that phone number onto the official **WhatsApp Business Calling
 * API** (Meta Cloud API) and bridge its SIP/WebRTC media to a media server that
 * plays our TTS audio. That requires Meta Business verification (still pending
 * for this project) plus a media bridge. LiveCallService is structured so that
 * backend can be dropped in via `BusinessCallingApiProvider` WITHOUT touching
 * the rest of the codebase — but until those credentials + media bridge exist,
 * `canAnswerLive()` returns false and we transparently fall back to reject+reply.
 *
 * What IS fully working and configurable today: the TTS model used to generate
 * the spoken response (see `CallTtsModel` / `synthesizeCallSpeech`).
 * ───────────────────────────────────────────────────────────────────────────
 */

export type LiveCallMode = 'reject-reply' | 'live-answer';

/**
 * TTS engine used to voice the call response. `auto` defers to the global
 * Voice provider configured in the Admin Panel (the existing generateSpeech
 * waterfall: Gemini → Google Cloud → OpenAI → ElevenLabs → Google Free).
 */
export type CallTtsModel =
  | 'auto'
  | 'gemini'
  | 'openai'
  | 'elevenlabs'
  | 'google';

export interface IncomingCallContext {
  callId: string;
  from: string;
  sessionId: string;
  /** Always available on Baileys. */
  rejectCall: (callId: string, from: string) => Promise<void>;
  /**
   * Only present when the transport can actually accept a call with media
   * (i.e. the Business Calling API provider). Baileys never supplies these,
   * which is exactly why live answering stays gated behind a capability check.
   */
  acceptCall?: (callId: string, from: string) => Promise<void>;
  streamAudio?: (callId: string, audio: Buffer) => Promise<void>;
}

export interface CallAnswerResult {
  handled: boolean;
  mode: LiveCallMode;
  /** true only when audio was actually streamed into a live call. */
  answeredLive: boolean;
  responseText?: string;
}

/**
 * A provider knows HOW to deal with an incoming call on a given transport.
 * Swapping transports (Baileys → Business Calling API) = swapping the provider.
 */
export interface ILiveCallProvider {
  readonly name: string;
  /** Can this provider, for this specific call, pick up and stream audio? */
  canAnswerLive(ctx: IncomingCallContext): boolean;
  handle(ctx: IncomingCallContext): Promise<CallAnswerResult>;
}

/**
 * A resolved, decrypted snapshot of the panel-managed live-call settings,
 * captured per call so providers read consistent values without async work
 * mid-negotiation.
 */
interface ResolvedSettings {
  mode: LiveCallMode;
  ttsModel: CallTtsModel;
  liveGreeting: string;
  defaultLanguage: string;
  callingConfigured: boolean;
}

/**
 * Map our high-level CallTtsModel onto the voice-provider name that
 * generateSpeech's waterfall understands. Returns undefined for `auto` (and
 * anything unmapped) so generateSpeech keeps its Admin-Panel-configured order.
 */
function callTtsModelToVoiceProvider(
  ttsModel: CallTtsModel,
): string | undefined {
  switch (ttsModel) {
    case 'gemini':
      return 'gemini-tts';
    case 'openai':
      return 'openai';
    case 'elevenlabs':
      return 'elevenlabs';
    case 'google':
      return 'google-free';
    case 'auto':
    default:
      return undefined;
  }
}

/**
 * Map our high-level CallTtsModel onto a concrete voice-provider name and pass
 * it straight to generateSpeech so the requested engine LEADS the waterfall for
 * this synthesis. `auto` passes no preference, deferring to the Admin Panel
 * Voice config. generateSpeech still falls back safely if the requested engine
 * is unavailable for the target language. This keeps the TTS model a
 * first-class, configurable knob for calls without forking the voice waterfall.
 */
export async function synthesizeCallSpeech(
  text: string,
  language: string,
  ttsModel: CallTtsModel = 'auto',
): Promise<Buffer> {
  const preferredProvider = callTtsModelToVoiceProvider(ttsModel);
  return generateSpeech(text, language, preferredProvider);
}

/**
 * Baileys provider: cannot answer live, so it delegates to the existing
 * CallAssistantService (reject the call + send a smart text + voice-note reply).
 * This is the safe default and is always available.
 */
class RejectReplyProvider implements ILiveCallProvider {
  readonly name = 'baileys-reject-reply';

  canAnswerLive(): boolean {
    return false; // Baileys has no media stack — never able to answer live.
  }

  async handle(ctx: IncomingCallContext): Promise<CallAnswerResult> {
    await callAssistant.handleIncomingCall(
      ctx.callId,
      ctx.from,
      ctx.sessionId,
      ctx.rejectCall,
    );
    return { handled: true, mode: 'reject-reply', answeredLive: false };
  }
}

/**
 * WhatsApp Business Calling API provider — the real "live answer" path.
 *
 * This is an honestly-labelled integration point, NOT a working implementation.
 * To switch it on you need ALL of:
 *   1. The number onboarded to the WhatsApp Business Calling API (Meta Cloud
 *      API) with Business verification approved.
 *   2. WHATSAPP_CALLING_API_TOKEN + WHATSAPP_PHONE_NUMBER_ID configured.
 *   3. A media bridge (WebRTC/SIP) that can accept the call's SDP offer and
 *      play our PCM/Opus TTS buffer into the RTP stream.
 *
 * When those exist, `IncomingCallContext` will carry `acceptCall` + `streamAudio`
 * and the body below should: accept the call → synthesizeCallSpeech(greeting) →
 * streamAudio(...). Until then `canAnswerLive` is false and we never get here.
 */
class BusinessCallingApiProvider implements ILiveCallProvider {
  readonly name = 'whatsapp-business-calling-api';

  constructor(private readonly snapshot: () => ResolvedSettings) {}

  canAnswerLive(ctx: IncomingCallContext): boolean {
    // Need both the API credentials AND a transport that actually exposes the
    // accept + media-stream hooks. Baileys supplies neither.
    return (
      this.snapshot().callingConfigured &&
      typeof ctx.acceptCall === 'function' &&
      typeof ctx.streamAudio === 'function'
    );
  }

  async handle(ctx: IncomingCallContext): Promise<CallAnswerResult> {
    // Defensive: handle() is only reached when canAnswerLive() was true.
    if (!ctx.acceptCall || !ctx.streamAudio) {
      throw new Error(
        'BusinessCallingApiProvider.handle called without media hooks',
      );
    }
    const snap = this.snapshot();
    const language = snap.defaultLanguage;
    const greeting = snap.liveGreeting;

    await ctx.acceptCall(ctx.callId, ctx.from);
    const audio = await synthesizeCallSpeech(greeting, language, snap.ttsModel);
    await ctx.streamAudio(ctx.callId, audio);

    try {
      await CallLog.create({
        sessionId: ctx.sessionId,
        callerId: ctx.from,
        callerPhone: ctx.from.split('@')[0],
        startTime: new Date(),
        status: 'answered',
        direction: 'incoming',
        aiResponseText: greeting,
        language,
      });
    } catch (err) {
      console.error('Failed to write live CallLog row:', err);
    }

    return {
      handled: true,
      mode: 'live-answer',
      answeredLive: true,
      responseText: greeting,
    };
  }
}

class LiveCallService {
  // Snapshot captured at the start of each call so the (synchronous) provider
  // capability checks read consistent, panel-managed values.
  private current: ResolvedSettings = {
    mode: 'reject-reply',
    ttsModel: 'auto',
    liveGreeting: '',
    defaultLanguage: 'si',
    callingConfigured: false,
  };

  private readonly rejectReply = new RejectReplyProvider();
  private readonly businessCalling = new BusinessCallingApiProvider(
    () => this.current,
  );

  /**
   * Pull the latest panel-managed settings from LiveCallSettingsService.
   * Lazily imported to avoid a circular dependency at module load.
   */
  private async refreshSnapshot(): Promise<ResolvedSettings> {
    try {
      const { liveCallSettings } = await import('./LiveCallSettingsService');
      const s = await liveCallSettings.load();
      this.current = {
        mode: s.mode,
        ttsModel: s.ttsModel,
        liveGreeting: s.liveGreeting,
        defaultLanguage: s.defaultLanguage,
        callingConfigured: Boolean(s.apiToken && s.phoneNumberId),
      };
    } catch (err) {
      console.warn(
        '📞 LiveCallService: could not load panel settings, using last/defaults:',
        err,
      );
    }
    return this.current;
  }

  /** Current TTS model (panel-managed). Reads the cached snapshot. */
  getTtsModel(): CallTtsModel {
    return this.current.ttsModel;
  }

  getMode(): LiveCallMode {
    return this.current.mode;
  }

  /**
   * Pick the best provider for this call: the live-answer provider when the
   * operator asked for it AND the transport can actually do it; otherwise the
   * always-available reject+reply provider. We never silently "succeed" at a
   * live answer we cannot perform.
   */
  private selectProvider(ctx: IncomingCallContext): ILiveCallProvider {
    if (
      this.current.mode === 'live-answer' &&
      this.businessCalling.canAnswerLive(ctx)
    ) {
      return this.businessCalling;
    }
    if (this.current.mode === 'live-answer') {
      console.warn(
        '📞 live-answer mode requested, but no live-capable transport is ' +
          'available (missing API credentials or Baileys cannot stream call ' +
          'audio). Falling back to reject+reply. See LiveCallService docs.',
      );
    }
    return this.rejectReply;
  }

  async handleIncomingCall(
    ctx: IncomingCallContext,
  ): Promise<CallAnswerResult> {
    await this.refreshSnapshot();
    const provider = this.selectProvider(ctx);
    console.log(
      `📞 Incoming call from ${ctx.from} → provider="${provider.name}" ` +
        `(mode=${this.current.mode}, tts=${this.current.ttsModel})`,
    );
    try {
      return await provider.handle(ctx);
    } catch (error) {
      console.error(`❌ LiveCallService failed for ${ctx.from}:`, error);
      // Last-resort safety net: never leave a real call hanging.
      try {
        await ctx.rejectCall(ctx.callId, ctx.from);
      } catch {
        /* ignore */
      }
      return { handled: false, mode: this.current.mode, answeredLive: false };
    }
  }
}

export const liveCallService = new LiveCallService();
