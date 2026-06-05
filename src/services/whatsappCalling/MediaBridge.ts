import { spawn } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

/**
 * MediaBridge — the audio (media-plane) half of live call answering.
 *
 * WhatsApp calls use WebRTC: the caller sends an SDP **offer**, we must reply
 * with an SDP **answer**, then RTP/SRTP audio flows over the negotiated path.
 * Baileys can't do any of this; the Business Calling API gives us the offer SDP
 * in the webhook and expects our answer SDP back via WhatsAppCallingClient.
 *
 * This bridge:
 *   1. Builds an RTCPeerConnection (via `werift`, a pure-TypeScript WebRTC
 *      stack — no native build step, plays nice with the existing toolchain).
 *   2. Consumes the caller's offer SDP, produces our answer SDP.
 *   3. Accepts a TTS audio Buffer (mp3/wav), transcodes it to 48kHz mono Opus
 *      frames with ffmpeg (already bundled via @ffmpeg-installer), and writes
 *      those frames into the outbound RTP track so the caller hears our voice.
 *
 * `werift` is an OPTIONAL dependency. It is imported lazily so that:
 *   • builds/tests never break if it isn't installed, and
 *   • environments that only ever use reject+reply pay zero cost.
 * If it's missing, `isAvailable()` returns false and LiveCallService falls back
 * to reject+reply — exactly the honest-gating contract the service already has.
 */

// werift has no bundled @types in this project; treat as untyped at the seam.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Werift = any;

let weriftModule: Werift | null = null;
let weriftLoadAttempted = false;

async function loadWerift(): Promise<Werift | null> {
  if (weriftLoadAttempted) return weriftModule;
  weriftLoadAttempted = true;
  try {
    // Indirect import so bundlers/tsc don't hard-fail when werift is absent.
    weriftModule = await import('werift' as string);
  } catch {
    console.warn(
      '⚠️ MediaBridge: optional dependency "werift" not installed — live ' +
        'call audio is unavailable. Install it (npm i werift) to enable ' +
        'WhatsApp Business Calling API live answering.',
    );
    weriftModule = null;
  }
  return weriftModule;
}

export interface MediaSession {
  /** SDP answer to hand back to Meta via WhatsAppCallingClient.accept(). */
  answerSdp: string;
  /** Push a TTS audio buffer (mp3/wav) into the live call. */
  playAudio: (audio: Buffer) => Promise<void>;
  /** Tear down the peer connection. */
  close: () => Promise<void>;
}

export class MediaBridge {
  /** True only when the WebRTC stack is actually loadable. */
  static async isAvailable(): Promise<boolean> {
    return (await loadWerift()) !== null;
  }

  /**
   * Negotiate a media session from the caller's offer SDP.
   * Returns null when WebRTC is unavailable (caller should fall back).
   */
  static async fromOffer(offerSdp: string): Promise<MediaSession | null> {
    const werift = await loadWerift();
    if (!werift) return null;

    const { RTCPeerConnection, RTCRtpCodecParameters, MediaStreamTrack } =
      werift;

    const pc = new RTCPeerConnection({
      codecs: {
        audio: [
          new RTCRtpCodecParameters({
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            payloadType: 111,
          }),
        ],
      },
    });

    // Outbound track the caller will hear.
    const track = new MediaStreamTrack({ kind: 'audio' });
    pc.addTransceiver(track, { direction: 'sendrecv' });

    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    return {
      answerSdp: pc.localDescription.sdp,
      playAudio: (audio: Buffer) => MediaBridge.streamToTrack(audio, track),
      close: async () => {
        try {
          await pc.close();
        } catch {
          /* ignore */
        }
      },
    };
  }

  /**
   * Transcode a TTS buffer to 48kHz/stereo 20ms Opus frames and feed them to
   * the WebRTC audio track at real-time pace. ffmpeg comes from the bundled
   * @ffmpeg-installer binary the project already uses for voice notes.
   */
  private static streamToTrack(audio: Buffer, track: Werift): Promise<void> {
    return new Promise((resolve, reject) => {
      const ff = spawn(ffmpegInstaller.path, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0', // input: the TTS buffer (mp3/wav, auto-detected)
        '-ac',
        '2',
        '-ar',
        '48000',
        '-c:a',
        'libopus',
        '-frame_duration',
        '20',
        '-f',
        'data', // raw Opus packets
        'pipe:1',
      ]);

      const FRAME_MS = 20;
      const queue: Buffer[] = [];
      let draining = false;
      let ended = false;

      // Pace frames at 20ms so the caller hears natural-speed audio instead of
      // a burst. werift's track.writeRtp accepts an Opus payload per frame.
      const pump = () => {
        if (draining) return;
        draining = true;
        const tick = () => {
          if (queue.length === 0) {
            draining = false;
            if (ended) resolve();
            return;
          }
          const frame = queue.shift() as Buffer;
          try {
            track.writeRtp(frame);
          } catch {
            /* track may have closed mid-call */
          }
          setTimeout(tick, FRAME_MS);
        };
        tick();
      };

      ff.stdout.on('data', (chunk: Buffer) => {
        queue.push(chunk);
        pump();
      });
      ff.on('error', reject);
      ff.on('close', () => {
        ended = true;
        if (!draining) resolve();
      });

      ff.stdin.write(audio);
      ff.stdin.end();
    });
  }
}
