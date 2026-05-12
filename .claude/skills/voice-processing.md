# Voice Processing Skill

Guide for voice message handling, transcription, and synthesis.

## Triggers
- User asks about voice messages or transcription
- User wants to implement voice features
- User needs help with TTS/STT configuration

## Voice Flow

```
Voice Message Received
    ↓
Download Audio (downloadWhatsAppAudio)
    ↓
Transcribe (transcribeAudioWithLanguage)
    ↓
Language Detection
    ↓
AI Processing (text prompt)
    ↓
Response Generation
    ↓
TTS (generateSpeech) → Voice Response
    ↓
FFmpeg Conversion (OGG/Opus)
    ↓
Send Voice Note (sendVoiceMessage)
```

## Transcription (STT)

### Providers
Located: `src/services/voice.ts`

**Primary: OpenAI Whisper**
```typescript
await openai.audio.transcriptions.create({
  model: 'whisper-1',
  file: audioBuffer,
});
```

**Fallback: Gemini**
```typescript
await geminiTranscribeAudio(audioBase64, mimeType);
```

### Language Detection
After transcription, language is detected:
- Returns: `{ text, detectedLanguage, languageConfidence }`
- Languages: `si` (Sinhala), `ta` (Tamil), `hi` (Hindi), `en` (English)

### Error Handling
If transcription fails:
1. Try fallback provider
2. Send retry message in detected/requested language
3. Default to Sinhala for unknown languages

## Synthesis (TTS)

### Providers
Located: `src/services/voice.ts`

**Primary: OpenAI TTS**
```typescript
await openai.audio.speech.create({
  model: 'tts-1',
  voice: 'nova',
  input: text,
});
```

**Fallback: Google TTS API**
```typescript
await googleTtsAPI.getAudioBase64(text, { lang: 'si' });
```

### Language Support
| Language | Code | TTS Voice |
|----------|------|-----------|
| Sinhala | `si` | Google TTS |
| Tamil | `ta` | Google TTS |
| Hindi | `hi` | Google TTS |
| English | `en` | OpenAI Nova |

## Voice Configuration

### Response Modes
Located: `VoiceConfig` model

| Mode | Behavior |
|------|----------|
| `voice-only` | Reply with voice note only (default) |
| `text-only` | Reply with text only |
| `voice-and-text` | Send both text and voice |

Configure via Admin Panel → Voice Config

## FFmpeg Conversion

WhatsApp requires OGG/Opus format for voice notes:

```typescript
ffmpeg(inputPath)
  .toFormat('ogg')
  .audioCodec('libopus')
  .audioFrequency(48000)
  .audioChannels(1)
  .save(outputPath);
```

## Voice Queue

When connection unavailable, voice messages queue for retry:
- Max queue size: 50 messages
- Max retries: 3
- Retry delay: 5 seconds
- Processed when connection restored

## Debugging Voice

### Transcription Logs
```
🎤 Voice message detected! Downloading...
📦 Audio buffer size: X bytes
📝 Transcription: "..."
🌐 Language: si (95%)
```

### TTS Logs
```
🗣️ Generating voice response in language: si...
🔄 FFmpeg conversion started...
✅ FFmpeg conversion complete
📦 Converted OGG size: X bytes
✅ Voice message sent successfully
```

### Common Issues

**Issue: Transcription empty**
- Check audio buffer size (min 100 bytes)
- Verify OpenAI API key
- Check Whisper API status
- Fallback to Gemini should activate

**Issue: TTS fails**
- Check OpenAI API key for TTS
- Verify Google TTS availability
- Check text length (max 4096 chars)
- FFmpeg must be installed

**Issue: Voice note won't send**
- Check socket connection state
- Verify OGG/Opus conversion succeeded
- Check converted buffer size (min 50 bytes)
- Message queued for retry if disconnected

## Configuration

Required in `.env`:
```bash
OPENAI_API_KEY=<key>  # For Whisper STT and TTS
GEMINI_API_KEY=<key>  # Fallback transcription
```

Optional TTS settings in Admin Panel:
- Default language
- Response mode
- Voice selection