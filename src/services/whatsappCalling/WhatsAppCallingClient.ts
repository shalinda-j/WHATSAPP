import axios, { AxiosInstance } from 'axios';

/**
 * WhatsAppCallingClient — thin wrapper over the official WhatsApp Business
 * Calling API (Meta Cloud API / Graph API).
 *
 * This is the control-plane half of live call answering. It does NOT carry
 * audio — it only tells Meta to accept/reject/terminate a call and exchanges
 * the SDP (session description) that the media plane (MediaBridge) produces.
 *
 * Endpoint shape (Graph API v21.0+):
 *   POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/calls
 *   body: { messaging_product: 'whatsapp', call_id, action, session? }
 *     action: 'pre_accept' | 'accept' | 'reject' | 'terminate'
 *     session: { sdp_type: 'answer', sdp: '<our answer SDP>' }   (accept/pre_accept)
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/calling
 *
 * Credentials come from env (single-tenant) or are passed in (multi-tenant,
 * resolved from the encrypted ChannelConnection.credentials by the caller).
 */

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface WhatsAppCallingCreds {
  /** Permanent / system-user access token with whatsapp_business_messaging. */
  accessToken: string;
  /** The WABA phone number id that owns the call. */
  phoneNumberId: string;
}

export type CallAction = 'pre_accept' | 'accept' | 'reject' | 'terminate';

export class WhatsAppCallingClient {
  private readonly http: AxiosInstance;
  private readonly phoneNumberId: string;

  constructor(creds: WhatsAppCallingCreds) {
    this.phoneNumberId = creds.phoneNumberId;
    this.http = axios.create({
      baseURL: GRAPH_BASE,
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Resolve credentials from environment. Returns null when not configured so
   * callers can cleanly fall back to reject+reply.
   */
  static fromEnv(): WhatsAppCallingClient | null {
    const accessToken =
      process.env.WHATSAPP_CALLING_API_TOKEN ||
      process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
      '';
    const phoneNumberId =
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ||
      '';
    if (!accessToken || !phoneNumberId) return null;
    return new WhatsAppCallingClient({ accessToken, phoneNumberId });
  }

  /**
   * Accept an incoming call. `answerSdp` is the SDP answer produced by our
   * MediaBridge after it ingested the caller's offer. Once Meta receives this,
   * the RTP media path is established and we can stream audio.
   */
  async accept(callId: string, answerSdp: string): Promise<void> {
    await this.post({
      call_id: callId,
      action: 'accept',
      session: { sdp_type: 'answer', sdp: answerSdp },
    });
  }

  /**
   * Optional two-phase accept: signal intent to answer (stops the caller's
   * ringback faster) before the media path is fully ready. Meta recommends
   * pre_accept → accept for lower perceived latency.
   */
  async preAccept(callId: string, answerSdp: string): Promise<void> {
    await this.post({
      call_id: callId,
      action: 'pre_accept',
      session: { sdp_type: 'answer', sdp: answerSdp },
    });
  }

  /** Decline the call without answering (control-plane reject). */
  async reject(callId: string): Promise<void> {
    await this.post({ call_id: callId, action: 'reject' });
  }

  /** Hang up an answered call. */
  async terminate(callId: string): Promise<void> {
    await this.post({ call_id: callId, action: 'terminate' });
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    const payload = { messaging_product: 'whatsapp', ...body };
    try {
      await this.http.post(`/${this.phoneNumberId}/calls`, payload);
    } catch (err: any) {
      const detail = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message;
      throw new Error(
        `WhatsApp Calling API ${String(body.action)} failed: ${detail}`,
      );
    }
  }
}
