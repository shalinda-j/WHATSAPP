# Live Call Answering

This document explains **why "direct live call answer" does not work today**, what
_does_ work, and how the new `LiveCallService` is set up so true live answering can
be switched on later without rewriting the app.

## TL;DR — why it doesn't answer calls live

The bot talks to WhatsApp through **Baileys** (`@whiskeysockets/baileys`), a
reverse-engineered WhatsApp **Web** client. WhatsApp voice/video calls run over
**WebRTC with end-to-end encryption (SRTP)**, and **Baileys does not implement a
WebRTC media stack**. As a result Baileys can only:

- **detect** an incoming call offer (`sock.ev.on('call', ...)`, `status === 'offer'`), and
- **reject** it (`sock.rejectCall(callId, from)`).

It **cannot accept a call** and it **cannot send/receive the live audio stream**.
There is simply no "answer with audio" function to call. This is a hard platform
limitation, **not a bug** in this project — the original `CallAssistantService`
header comment says the same thing.

So when a call comes in, the only thing we can honestly do on Baileys is reject it
and immediately follow up with a smart reply (text + voice note).

## What works today (the default: `reject-reply`)

`LiveCallService` routes every incoming call to a **provider**. On Baileys the
selected provider is `RejectReplyProvider`, which delegates to the existing
`CallAssistantService`:

1. Reject the call (Baileys limitation).
2. Detect the caller's language.
3. Generate a smart reply via the agent orchestrator (falls back to a multilingual template).
4. Send a text reply **and** a TTS voice note.
5. Log the call to `CallLog`.

The **TTS model is configurable** (see below) — that part is fully real and testable.

## What it takes to ACTUALLY answer live

True "pick up the call and talk back inside the call" requires moving the number
onto the official **WhatsApp Business Calling API** (Meta Cloud API) and bridging
its media to a server that plays our TTS audio. Concretely, all of:

1. The number onboarded to the **WhatsApp Business Calling API** with **Meta
   Business verification approved** (currently pending for this project — the same
   blocker as the Instagram/Facebook adapters).
2. `WHATSAPP_CALLING_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` configured.
3. A **media bridge** (WebRTC/SIP) that accepts the call's SDP offer and plays our
   PCM/Opus TTS buffer into the RTP stream.

`LiveCallService` already contains the integration point for this:
`BusinessCallingApiProvider`. It stays **gated** behind a capability check
(`canAnswerLive()`), so:

- If you set `LIVE_CALL_MODE=live-answer` **without** the credentials + a
  media-capable transport, the service logs a warning and **safely falls back** to
  `reject-reply`. It never pretends to have answered a call it couldn't.
- When the credentials + media bridge exist, the incoming-call context will carry
  `acceptCall` + `streamAudio` hooks, `canAnswerLive()` returns true, and the
  provider accepts the call and streams the synthesized greeting.

This means the rest of the codebase does **not** change when live answering becomes
available — you only implement the media bridge and supply the hooks.

## The live-answer implementation (`src/services/whatsappCalling/`)

The Business Calling API path is **now implemented** (it ships disabled, gated on
credentials + the optional WebRTC dependency). Three pieces:

| File                        | Role                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WhatsAppCallingClient.ts`  | Control plane. Calls Graph API `POST /{phone_number_id}/calls` to `accept` / `reject` / `terminate`, exchanging SDP.                                                                        |
| `MediaBridge.ts`            | Media plane. Builds a WebRTC peer from the caller's offer SDP (via optional `werift`), transcodes TTS audio to 48 kHz Opus with the bundled ffmpeg, and streams 20 ms frames into the call. |
| `WhatsAppCallingService.ts` | Orchestration. Takes a webhook call event, wires `acceptCall` + `streamAudio` hooks to the above, and hands an `IncomingCallContext` to `LiveCallService`.                                  |

Inbound events arrive at the public webhook **`POST /api/webhooks/whatsapp-calling`**
(with a `GET` handshake for Meta verification). The webhook verifies
`X-Hub-Signature-256` when `WHATSAPP_APP_SECRET` is set, returns `200` immediately,
then processes each `entry[].changes[].value.calls[]` asynchronously.

### Flow

```
Meta → POST /api/webhooks/whatsapp-calling   (call event + offer SDP)
     → WhatsAppCallingService.handleWebhookCall
     → MediaBridge.fromOffer(offerSdp)        (WebRTC answer SDP)
     → LiveCallService.handleIncomingCall({ acceptCall, streamAudio, … })
     → BusinessCallingApiProvider.handle
         → client.accept(callId, answerSdp)   (Graph API)
         → synthesizeCallSpeech(greeting)     (configurable TTS)
         → media.playAudio(audio)             (Opus → RTP → caller hears it)
```

### What's still required to turn it on

1. **Meta Business verification** + the number onboarded to the WhatsApp Business
   Calling API (still pending — same blocker as the Instagram/Facebook adapters).
2. Set the env vars below (`LIVE_CALL_MODE=live-answer`, the token, phone number id,
   verify token, and app secret).
3. Install the optional WebRTC dependency: `npm i werift`. Without it, `MediaBridge`
   reports unavailable and the service falls back to reject+reply.
4. Subscribe the `calls` webhook field for your WABA in the Meta App dashboard,
   pointing at `https://<your-host>/api/webhooks/whatsapp-calling`.

> ⚠️ The real-time audio path (WebRTC/SRTP negotiation + RTP pacing) can only be
> verified against a live Meta-verified number. The code is complete and
> type-checked, but end-to-end audio has **not** been exercised in CI.

## Managing it from the Admin Panel

Everything above is manageable from the **Voice Agent Hub** page (no env editing
required). The **Live Call Answering** section there lets an operator:

- switch **answer mode** (`reject-reply` ↔ `live-answer`),
- pick the **call TTS model** and **test** it (plays a sample in the browser),
- set the **spoken greeting** and **default language**,
- enter the **Business Calling API** credentials (phone number id, access token,
  app secret, webhook verify token, Graph version), and
- see a **readiness banner** that tells you exactly why live answering is or
  isn't active (mode, credentials present, WebRTC media installed).

Persistence is handled by `LiveCallSettingsService`: settings are written to the
MongoDB `Config` collection (key `live_call_settings`) **and** a local JSON file,
exactly like `VoiceCallAgentService`. Secrets (`apiToken`, `appSecret`) are
**encrypted at rest** via `CryptoService` and never returned to the client — the
API exposes only `hasApiToken` / `hasAppSecret` booleans, and submitting a blank
secret field leaves the stored value untouched.

Environment variables remain valid as **defaults**: a field that hasn't been set
in the panel falls back to its env var, so existing env-based deployments keep
working until the operator saves from the panel (after which the panel wins).

API surface (all under `/api/call-agent`, auth + tenant scoped):

| Endpoint              | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `GET /live-settings`  | Current settings (secrets redacted) + valid options |
| `POST /live-settings` | Update any subset of settings                       |
| `GET /live-status`    | Readiness: mode, credentials, media, reason         |
| `POST /test-call-tts` | Synthesize with the configured call TTS model       |

## Configuring the TTS model

The spoken response uses a configurable TTS engine via `CallTtsModel`:

| Value        | Engine                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `auto`       | Use the Admin Panel Voice config (Gemini → Google Cloud → OpenAI → ElevenLabs → Google Free waterfall) |
| `gemini`     | Gemini TTS (`gemini-2.5-flash-preview-tts`) — best Sinhala/Tamil                                       |
| `openai`     | OpenAI TTS (`tts-1` / `tts-1-hd`)                                                                      |
| `elevenlabs` | ElevenLabs (premium)                                                                                   |
| `google`     | Google TTS                                                                                             |

Set it with the `CALL_TTS_MODEL` environment variable, or at runtime via
`liveCallService.setTtsModel(...)`. `synthesizeCallSpeech(text, language, model)`
applies the choice (falling back safely if the engine can't handle the language).

## Environment variables

| Variable                        | Purpose                                                       | Default         |
| ------------------------------- | ------------------------------------------------------------- | --------------- |
| `LIVE_CALL_MODE`                | `reject-reply` (default) or `live-answer`                     | `reject-reply`  |
| `CALL_TTS_MODEL`                | `auto` / `gemini` / `openai` / `elevenlabs` / `google`        | `auto`          |
| `CALL_LIVE_GREETING`            | Greeting spoken when a call is answered live                  | Sinhala default |
| `DEFAULT_LANGUAGE`              | Fallback language for synthesis                               | `si`            |
| `WHATSAPP_CALLING_API_TOKEN`    | Business Calling API token (or `WHATSAPP_CLOUD_ACCESS_TOKEN`) | —               |
| `WHATSAPP_PHONE_NUMBER_ID`      | WABA phone number id (or `WHATSAPP_CLOUD_PHONE_NUMBER_ID`)    | —               |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Token echoed back on the Meta `GET` verification handshake    | —               |
| `WHATSAPP_APP_SECRET`           | Meta app secret — enables `X-Hub-Signature-256` verification  | — (skipped)     |
| `WHATSAPP_GRAPH_VERSION`        | Graph API version for the calls endpoint                      | `v21.0`         |

## Summary

- **Today:** calls are answered via `reject-reply` (smart text + TTS voice note),
  with a **configurable TTS model**.
- **Live answering** is wired as a gated provider; it activates only with the
  WhatsApp Business Calling API + a media bridge + Meta verification, and falls
  back safely otherwise.
