# Live Call Answering

This document explains **why "direct live call answer" does not work today**, what
*does* work, and how the new `LiveCallService` is set up so true live answering can
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

## Configuring the TTS model

The spoken response uses a configurable TTS engine via `CallTtsModel`:

| Value        | Engine                                                            |
| ------------ | ---------------------------------------------------------------- |
| `auto`       | Use the Admin Panel Voice config (Gemini → Google Cloud → OpenAI → ElevenLabs → Google Free waterfall) |
| `gemini`     | Gemini TTS (`gemini-2.5-flash-preview-tts`) — best Sinhala/Tamil |
| `openai`     | OpenAI TTS (`tts-1` / `tts-1-hd`)                                |
| `elevenlabs` | ElevenLabs (premium)                                             |
| `google`     | Google TTS                                                       |

Set it with the `CALL_TTS_MODEL` environment variable, or at runtime via
`liveCallService.setTtsModel(...)`. `synthesizeCallSpeech(text, language, model)`
applies the choice (falling back safely if the engine can't handle the language).

## Environment variables

| Variable                       | Purpose                                                        | Default        |
| ------------------------------ | ------------------------------------------------------------- | -------------- |
| `LIVE_CALL_MODE`               | `reject-reply` (default) or `live-answer`                      | `reject-reply` |
| `CALL_TTS_MODEL`               | `auto` / `gemini` / `openai` / `elevenlabs` / `google`        | `auto`         |
| `CALL_LIVE_GREETING`           | Greeting spoken when a call is answered live                   | Sinhala default |
| `DEFAULT_LANGUAGE`             | Fallback language for synthesis                                | `si`           |
| `WHATSAPP_CALLING_API_TOKEN`   | Business Calling API token (required for live answer)          | —              |
| `WHATSAPP_PHONE_NUMBER_ID`     | Business Calling API phone number id (required for live answer)| —              |

## Summary

- **Today:** calls are answered via `reject-reply` (smart text + TTS voice note),
  with a **configurable TTS model**.
- **Live answering** is wired as a gated provider; it activates only with the
  WhatsApp Business Calling API + a media bridge + Meta verification, and falls
  back safely otherwise.
