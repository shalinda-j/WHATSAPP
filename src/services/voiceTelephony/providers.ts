import {
  IVoiceTelephonyProvider,
  OutboundCallRequest,
  OutboundCallResult,
  ProviderReadiness,
} from './IVoiceTelephonyProvider';

/**
 * Base class — shared readiness + "not implemented" stubs so each adapter
 * stays a few lines. Provider-specific runtime wiring lives in subclasses
 * that override `initiateCall` once the operator wires credentials.
 */
abstract class BaseProvider implements IVoiceTelephonyProvider {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly requiredEnv: string[];
  readonly supportsLiveCalls: boolean = true;
  readonly supportsOutbound: boolean = true;

  readiness(): ProviderReadiness {
    const missing = this.requiredEnv.filter((e) => !process.env[e]);
    return {
      ready: missing.length === 0,
      missing,
      notes: this.notes(),
    };
  }

  protected notes(): string | undefined {
    return undefined;
  }

  async initiateCall(_req: OutboundCallRequest): Promise<OutboundCallResult> {
    throw new Error(
      `${this.displayName} live-call wiring is not implemented yet. Set the required env vars to enable.`,
    );
  }
}

/**
 * Twilio Programmable Voice — easiest to onboard. Works internationally
 * and accepts inbound SIP trunks from Sri Lankan ISPs via SIP origination.
 */
class TwilioProvider extends BaseProvider {
  readonly name = 'twilio';
  readonly displayName = 'Twilio';
  readonly requiredEnv = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
  ];

  protected notes(): string | undefined {
    return '$0.013/min outbound, $20/mo per phone number. Set TWILIO_VOICE_WEBHOOK_URL for inbound media handling.';
  }
}

/**
 * Generic SIP trunk — works with any provider that gives you SIP credentials
 * (username, password, host). Covers most ISP-grade trunks.
 */
class GenericSipProvider extends BaseProvider {
  readonly name = 'sip_generic';
  readonly displayName = 'Generic SIP trunk';
  readonly requiredEnv = ['SIP_HOST', 'SIP_USERNAME', 'SIP_PASSWORD'];

  protected notes(): string | undefined {
    return 'Standard SIP/RTP over UDP/TLS. Optional: SIP_PORT, SIP_TRANSPORT (udp|tcp|tls). Bring-your-own trunk.';
  }
}

/**
 * SLT-Mobitel SIP trunk preset. Same generic SIP under the hood; the
 * preset documents the SLT-specific defaults so operators don't have to
 * dig through the SLT business-voice docs.
 */
class SLTMobitelProvider extends BaseProvider {
  readonly name = 'slt_mobitel';
  readonly displayName = 'SLT-Mobitel SIP';
  readonly requiredEnv = [
    'SLT_SIP_HOST',
    'SLT_SIP_USERNAME',
    'SLT_SIP_PASSWORD',
  ];

  protected notes(): string | undefined {
    return 'SLT-Mobitel business voice / SIP trunk. Request SIP credentials from SLT business team. Defaults to TLS on port 5061.';
  }
}

class DialogProvider extends BaseProvider {
  readonly name = 'dialog';
  readonly displayName = 'Dialog SIP';
  readonly requiredEnv = [
    'DIALOG_SIP_HOST',
    'DIALOG_SIP_USERNAME',
    'DIALOG_SIP_PASSWORD',
  ];

  protected notes(): string | undefined {
    return 'Dialog Axiata enterprise voice / SIP trunk. Request credentials from Dialog business team.';
  }
}

class HutchProvider extends BaseProvider {
  readonly name = 'hutch';
  readonly displayName = 'Hutch SIP';
  readonly requiredEnv = [
    'HUTCH_SIP_HOST',
    'HUTCH_SIP_USERNAME',
    'HUTCH_SIP_PASSWORD',
  ];

  protected notes(): string | undefined {
    return 'Hutch business voice / SIP trunk. Request credentials from Hutch business team.';
  }
}

/**
 * WhatsApp Cloud API — official Meta API. Allows actual WhatsApp voice
 * calls once your number is approved + Cloud API enabled.
 */
class WhatsAppCloudProvider extends BaseProvider {
  readonly name = 'whatsapp_cloud';
  readonly displayName = 'WhatsApp Cloud API (Meta)';
  readonly requiredEnv = [
    'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
    'WHATSAPP_CLOUD_ACCESS_TOKEN',
  ];

  protected notes(): string | undefined {
    return 'Official Meta WhatsApp Business Platform. Free messaging + voice. Requires Meta business verification and Cloud API enablement.';
  }
}

class VoiceTelephonyRegistry {
  private providers: IVoiceTelephonyProvider[] = [
    new TwilioProvider(),
    new GenericSipProvider(),
    new SLTMobitelProvider(),
    new DialogProvider(),
    new HutchProvider(),
    new WhatsAppCloudProvider(),
  ];

  list(): Array<{
    name: string;
    displayName: string;
    requiredEnv: string[];
    supportsLiveCalls: boolean;
    supportsOutbound: boolean;
    readiness: ProviderReadiness;
  }> {
    return this.providers.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      requiredEnv: p.requiredEnv,
      supportsLiveCalls: p.supportsLiveCalls,
      supportsOutbound: p.supportsOutbound,
      readiness: p.readiness(),
    }));
  }

  get(name: string): IVoiceTelephonyProvider | null {
    return this.providers.find((p) => p.name === name) ?? null;
  }

  /**
   * Pick the provider explicitly named in input, or fall back to the env
   * pin (`VOICE_TELEPHONY_PROVIDER`), or the first one whose readiness is
   * `ready: true`. Returns null when nothing is configured.
   */
  pickReady(preferred?: string): IVoiceTelephonyProvider | null {
    if (preferred) {
      const p = this.get(preferred);
      if (p && p.readiness().ready) return p;
    }
    const pinned = process.env.VOICE_TELEPHONY_PROVIDER;
    if (pinned) {
      const p = this.get(pinned);
      if (p && p.readiness().ready) return p;
    }
    return this.providers.find((p) => p.readiness().ready) ?? null;
  }
}

export const voiceTelephonyRegistry = new VoiceTelephonyRegistry();
