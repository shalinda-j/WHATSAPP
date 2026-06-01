import { WhatsAppCallingClient } from './WhatsAppCallingClient';
import { MediaBridge, MediaSession } from './MediaBridge';
import { liveCallService } from '../LiveCallService';

/**
 * WhatsAppCallingService — orchestrates a single inbound WhatsApp Business
 * Calling API call from webhook event to answered, voiced call.
 *
 * Flow when Meta posts a `calls` webhook with status 'ringing'/'connect':
 *   1. Build the WebRTC MediaBridge from the caller's offer SDP.
 *   2. Hand LiveCallService an IncomingCallContext whose `acceptCall` +
 *      `streamAudio` hooks are wired to the Calling API + MediaBridge.
 *   3. LiveCallService.selectProvider() now sees a live-capable transport
 *      (acceptCall + streamAudio present + creds configured) and routes to
 *      BusinessCallingApiProvider, which accepts the call and streams TTS.
 *
 * If WebRTC (werift) or credentials are unavailable, the context carries no
 * media hooks, so LiveCallService transparently falls back to reject+reply —
 * preserving the honest-gating contract end to end.
 */

interface MetaCallEvent {
  id: string; // call_id
  from: string; // caller wa_id / phone
  event?: string; // 'connect' | 'terminate' | ...
  status?: string; // 'ringing' | 'connect' | ...
  session?: { sdp_type?: string; sdp?: string };
  // Meta nests the offer under `session` on connect events.
}

// Track active media sessions so terminate events can tear them down.
const activeSessions = new Map<string, MediaSession>();

export class WhatsAppCallingService {
  /**
   * Entry point for the webhook. `sessionId` is an opaque id used for logging
   * and CallLog rows (defaults to the phone number id / tenant slug).
   */
  static async handleWebhookCall(
    call: MetaCallEvent,
    sessionId: string,
  ): Promise<void> {
    const event = call.event || call.status;

    // Terminate / hang-up: clean up any media session we opened.
    if (event === 'terminate') {
      const session = activeSessions.get(call.id);
      if (session) {
        await session.close();
        activeSessions.delete(call.id);
        console.log(`📞 Live call ${call.id} terminated, media closed`);
      }
      return;
    }

    const offerSdp = call.session?.sdp;
    const client = WhatsAppCallingClient.fromEnv();

    // No creds → we can't talk to the Calling API at all. Let LiveCallService
    // run its fallback (it will produce a reject+reply via Baileys path if a
    // session exists; otherwise it just declines through the API if it can).
    if (!client) {
      console.warn(
        '📞 Incoming Business Calling API call but no API credentials ' +
          'configured — cannot answer live.',
      );
      return;
    }

    // No offer SDP → nothing to negotiate; reject cleanly.
    if (!offerSdp) {
      await client.reject(call.id).catch(() => undefined);
      return;
    }

    // Build the media bridge. Null means WebRTC unavailable → reject+reply.
    const media = await MediaBridge.fromOffer(offerSdp);

    await liveCallService.handleIncomingCall({
      callId: call.id,
      from: call.from,
      sessionId,
      // Control-plane reject is always available via the Calling API.
      rejectCall: async (callId) => {
        await client.reject(callId);
      },
      // Media hooks only present when WebRTC negotiated successfully. Their
      // presence is exactly what flips LiveCallService into live-answer mode.
      acceptCall: media
        ? async (callId) => {
            await client.accept(callId, media.answerSdp);
            activeSessions.set(callId, media);
          }
        : undefined,
      streamAudio: media
        ? async (_callId, audio) => {
            await media.playAudio(audio);
          }
        : undefined,
    });
  }

  /** True when both the API creds and the WebRTC stack are available. */
  static async canAnswerLive(): Promise<boolean> {
    return (
      WhatsAppCallingClient.fromEnv() !== null &&
      (await MediaBridge.isAvailable())
    );
  }
}
