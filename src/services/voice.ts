import { transcribeAudio as openaiTranscribeAudio } from './openai';
import { transcribeAudio as geminiTranscribeAudio } from './gemini';
import { getAudioUrl } from 'google-tts-api';
import OpenAI from 'openai';
import axios from 'axios';
import VoiceConfig from '../models/VoiceConfig';

// Language detection patterns
const SINHALA_UNICODE_RANGE = /[\u0D80-\u0DFF]/;
const TAMIL_UNICODE_RANGE = /[\u0B80-\u0BFF]/;
const HINDI_UNICODE_RANGE = /[\u0900-\u097F]/;

// Common Sinhala words (romanized) for language detection
const SINHALA_ROMANIZED_WORDS = [
  'mage',
  'nama',
  'mama',
  'oyata',
  'api',
  'kohomada',
  'kohomath',
  'honda',
  'neda',
  'neh',
  'enna',
  'matta',
  'pahada',
  'karanna',
  'balanna',
  'thiyenna',
  'ganna',
  'denna',
  'avilla',
  'yanna',
  'enna',
  'kale',
  'kota',
  'eta',
  'methana',
  'ethana',
  'aruwen',
  'karapu',
  'hithe',
  'theruma',
  'hithuna',
  'kiwwa',
  'katha',
  'karanawa',
  'balanawa',
  'thiyenawa',
  'gananawa',
  'mokada',
  'mokak',
  'kumana',
  'kawda',
  'kawuru',
  'etrin',
  'mehema',
  'ubata',
  'oba',
  'thamai',
  'wage',
  'witarai',
  'sambandha',
  'wadha',
  'pahath',
  'lokuya',
  'kudu',
  'honda',
  'narak',
  'sathutu',
  'duka',
  'katayuthu',
  'karadara',
  'sarpa',
  'ayubowan',
  'suba',
  'pathum',
  'nivasala',
  'gedara',
  'iskole',
  'kendaraya',
  'roshalaya',
  'asepasala',
];

// Common English words for language detection
const COMMON_ENGLISH_WORDS = new Set([
  'the',
  'is',
  'are',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'my',
  'your',
  'it',
  'and',
  'or',
  'but',
  'what',
  'how',
  'can',
  'could',
  'please',
  'hello',
  'hi',
  'thank',
  'thanks',
  'yes',
  'no',
  'okay',
  'ok',
  'not',
  'do',
  'does',
  'did',
  'will',
  'would',
  'should',
  'have',
  'has',
  'been',
  'was',
  'were',
  'am',
  'be',
  'being',
  'this',
  'that',
  'these',
  'those',
  'a',
  'an',
  'want',
  'need',
  'like',
  'know',
  'think',
  'see',
  'get',
  'make',
  'go',
  'come',
  'take',
  'give',
  'find',
  'tell',
  'ask',
  'work',
  'call',
  'try',
  'leave',
  'put',
  'mean',
  'keep',
  'let',
  'begin',
  'seem',
  'help',
  'show',
  'hear',
  'play',
  'run',
  'move',
  'live',
  'believe',
  'hold',
  'bring',
]);

/**
 * Detect the language of transcribed text
 * Returns language code and confidence
 */
export function detectLanguage(text: string): {
  lang: string;
  confidence: number;
} {
  const normalizedText = text.toLowerCase().trim();

  // Check for Sinhala Unicode characters
  if (SINHALA_UNICODE_RANGE.test(text)) {
    return { lang: 'si', confidence: 0.95 };
  }

  // Check for Tamil Unicode characters
  if (TAMIL_UNICODE_RANGE.test(text)) {
    return { lang: 'ta', confidence: 0.95 };
  }

  // Check for Hindi Unicode characters
  if (HINDI_UNICODE_RANGE.test(text)) {
    return { lang: 'hi', confidence: 0.95 };
  }

  // Check for romanized Sinhala
  const words = normalizedText.split(/\s+/);
  let sinhalaWordCount = 0;
  let englishWordCount = 0;

  for (const word of words) {
    if (
      SINHALA_ROMANIZED_WORDS.some(
        (sw) => word.includes(sw) || sw.includes(word),
      )
    ) {
      sinhalaWordCount++;
    }
    if (COMMON_ENGLISH_WORDS.has(word)) {
      englishWordCount++;
    }
  }

  const totalWords = words.length;
  const sinhalaRatio = sinhalaWordCount / Math.max(totalWords, 1);
  const englishRatio = englishWordCount / Math.max(totalWords, 1);

  // If more Sinhala-like words detected, it's likely romanized Sinhala
  if (sinhalaRatio > 0.15 && sinhalaRatio >= englishRatio) {
    return { lang: 'si', confidence: 0.7 + sinhalaRatio * 0.2 };
  }

  // Check if text looks like English (mostly alphabetic with common English words)
  const isLikelyEnglish =
    /^[a-zA-Z0-9\s\p{P}!?.,;&'"()+\-*#@%$^\[\]{}|\\/<>=`~]+$/u.test(
      normalizedText,
    );

  if (isLikelyEnglish && englishRatio > 0.1) {
    return { lang: 'en', confidence: 0.8 + englishRatio * 0.15 };
  }

  // Default to English if text is ASCII but no clear language detected
  if (isLikelyEnglish) {
    return { lang: 'en', confidence: 0.5 };
  }

  // Default to Sinhala (system's primary language)
  return { lang: 'si', confidence: 0.5 };
}

/**
 * Get the current voice mode setting
 * @returns 'voice-only' | 'text-only' | 'voice-and-text'
 */
export async function getVoiceMode(): Promise<
  'voice-only' | 'text-only' | 'voice-and-text'
> {
  try {
    const config = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
    return config?.mode || 'voice-and-text';
  } catch (error) {
    console.error('Error fetching voice mode:', error);
    return 'voice-and-text'; // Default fallback
  }
}

/**
 * Check if voice agent is enabled
 * @returns boolean
 */
export async function isVoiceAgentEnabled(): Promise<boolean> {
  try {
    const config = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
    return config?.isActive ?? true;
  } catch (error) {
    console.error('Error checking voice agent status:', error);
    return true; // Default fallback
  }
}

/**
 * Get the current active voice configuration
 */
export async function getActiveVoiceConfig(): Promise<
  import('../models/VoiceConfig').IVoiceConfig | null
> {
  try {
    return await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
  } catch (error) {
    console.error('Error fetching voice config:', error);
    return null;
  }
}

export interface TranscriptionResult {
  text: string;
  detectedLanguage: string;
  languageConfidence: number;
}

/**
 * Transcribe audio using configured provider (Gemini or OpenAI)
 * @param audioBuffer Buffer containing the audio data
 * @returns Transcription result with detected language
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  try {
    const config = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
    const provider = config?.provider || 'google-free';

    let transcription = '';

    if (provider === 'openai' && config?.apiKey) {
      console.log('   🎙️ Transcribing audio with OpenAI Whisper...');
      try {
        transcription = await openaiTranscribeAudio(audioBuffer, config.apiKey);
      } catch (openaiErr: any) {
        console.warn(
          `   ⚠️ OpenAI STT failed: ${openaiErr.message}. Falling back to Gemini...`,
        );
        // Fallthrough to Gemini
      }
    }

    if (!transcription) {
      console.log('   🎙️ Transcribing audio with Gemini...');

      // Convert Buffer to Base64 for Gemini
      const audioBase64 = audioBuffer.toString('base64');

      // Use Gemini's multimodal transcription with language detection
      transcription = await geminiTranscribeAudio(audioBase64, 'audio/ogg');
    }

    // Detect language from transcription
    const langResult = detectLanguage(transcription);
    console.log(
      `   🌐 Detected language: ${
        langResult.lang
      } (confidence: ${langResult.confidence.toFixed(2)})`,
    );

    return transcription;
  } catch (error: any) {
    console.error('❌ Transcription error:', error.message || error);
    throw new Error('Failed to transcribe audio');
  }
}

/**
 * Transcribe audio and return full result with language detection
 */
export async function transcribeAudioWithLanguage(
  audioBuffer: Buffer,
): Promise<TranscriptionResult> {
  try {
    const config = await VoiceConfig.findOne({ isActive: true }).sort({
      updatedAt: -1,
    });
    const provider = config?.provider || 'google-free';

    let transcription = '';

    if (provider === 'openai' && config?.apiKey) {
      console.log('   🎙️ Transcribing audio with OpenAI Whisper...');
      try {
        transcription = await openaiTranscribeAudio(audioBuffer, config.apiKey);
      } catch (openaiErr: any) {
        console.warn(
          `   ⚠️ OpenAI STT failed: ${openaiErr.message}. Falling back to Gemini...`,
        );
      }
    }

    if (!transcription) {
      console.log('   🎙️ Transcribing audio with Gemini...');
      const audioBase64 = audioBuffer.toString('base64');
      transcription = await geminiTranscribeAudio(audioBase64, 'audio/ogg');
    }

    // Detect language from transcription
    const langResult = detectLanguage(transcription);
    console.log(
      `   🌐 Detected language: ${
        langResult.lang
      } (confidence: ${langResult.confidence.toFixed(2)})`,
    );

    return {
      text: transcription,
      detectedLanguage: langResult.lang,
      languageConfidence: langResult.confidence,
    };
  } catch (error: any) {
    console.error('❌ Transcription error:', error.message || error);
    throw new Error('Failed to transcribe audio');
  }
}

/**
 * Generate speech from text using configured provider
 * @param text Text to convert to speech
 * @param targetLanguage Optional target language code (si, en, ta, hi)
 */
export async function generateSpeech(
  text: string,
  targetLanguage?: string,
): Promise<Buffer> {
  // Fetch config from DB
  const config = await VoiceConfig.findOne().sort({ updatedAt: -1 });

  // If voice is disabled in config, return empty buffer or throw generic error to be handled by caller
  if (config && !config.isActive) {
    console.log('   🔇 Voice Agent is disabled in Admin Config.');
    throw new Error('Voice Agent Disabled');
  }

  const provider = config?.provider || 'google-free';
  const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;

  // Detect language from text if not provided
  const lang = targetLanguage || detectLanguage(text).lang;
  console.log(
    `   🔊 Generating speech using provider: ${provider}, language: ${lang}`,
  );

  if (provider === 'elevenlabs') {
    try {
      if (!apiKey) {
        throw new Error('ElevenLabs API Key is missing in config');
      }

      const voiceId = config?.voiceId || 'pNInz6obpgDQGcFmaJcg'; // Default to a standard voice if none provided
      const modelId = config?.ttsModel || 'eleven_multilingual_v2';

      console.log(`   🎙️ Calling ElevenLabs TTS API (Voice ID: ${voiceId})...`);

      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        },
        {
          headers: {
            Accept: 'audio/mpeg',
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        },
      );

      return Buffer.from(response.data);
    } catch (err: any) {
      console.error(
        `   ⚠️ ElevenLabs TTS failed: ${err.message}. Falling back to Google Free.`,
      );
      // Fallback to Google
    }
  }

  if (provider === 'openai') {
    try {
      if (!apiKey) {
        throw new Error('OpenAI API Key is missing in config');
      }

      // Re-init OpenAI with new key if needed
      const client = new OpenAI({ apiKey: apiKey });

      console.log(
        `   🎙️ Calling OpenAI TTS API (Voice ID: ${
          config?.voiceId || 'alloy'
        })...`,
      );

      const mp3 = await client.audio.speech.create({
        model: (config?.ttsModel as any) || 'tts-1',
        voice: (config?.voiceId as any) || 'alloy',
        input: text,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      return buffer;
    } catch (err: any) {
      console.error(
        `   ⚠️ OpenAI TTS failed: ${err.message}. Falling back to Google Free.`,
      );
      // Fallback
    }
  }

  // Google TTS (Default/Fallback)
  return generateSpeechGoogle(text, lang);
}

/**
 * Generate speech using google-tts-api (Unofficial Free API)
 * Handles long text by splitting into multiple segments
 */
async function generateSpeechGoogle(
  text: string,
  targetLang?: string,
): Promise<Buffer> {
  try {
    // Detect language if not provided
    const lang = targetLang || detectLanguage(text).lang;
    console.log(`   🗣️ Google TTS - Language: ${lang}`);

    // For very long text, split into segments and combine
    const MAX_SEGMENT_LENGTH = 180; // Safe limit for Google TTS

    if (text.length <= MAX_SEGMENT_LENGTH) {
      return await generateSingleSegment(text, lang);
    }

    // Split long text into sentences
    const sentences = text.split(/(?<=[.!?।෴])\s+/);
    const segments: Buffer[] = [];
    let currentSegment = '';

    for (const sentence of sentences) {
      if ((currentSegment + ' ' + sentence).length <= MAX_SEGMENT_LENGTH) {
        currentSegment = currentSegment
          ? currentSegment + ' ' + sentence
          : sentence;
      } else {
        if (currentSegment) {
          try {
            segments.push(await generateSingleSegment(currentSegment, lang));
          } catch (e) {
            console.warn('   ⚠️ Segment generation failed, continuing...');
          }
        }
        currentSegment = sentence;
      }
    }

    // Don't forget the last segment
    if (currentSegment) {
      try {
        segments.push(await generateSingleSegment(currentSegment, lang));
      } catch (e) {
        console.warn('   ⚠️ Final segment generation failed');
      }
    }

    if (segments.length === 0) {
      throw new Error('All segments failed to generate');
    }

    // For single segment, return it directly
    if (segments.length === 1) {
      return segments[0];
    }

    // Combine multiple audio segments
    console.log(`   📦 Combining ${segments.length} audio segments...`);
    return Buffer.concat(segments);
  } catch (error: any) {
    console.error('❌ Google Speech generation error:', error.message || error);
    throw new Error('Failed to generate speech');
  }
}

/**
 * Generate a single audio segment using Google TTS
 */
async function generateSingleSegment(
  text: string,
  lang: string,
): Promise<Buffer> {
  // Truncate very long segments (safety net)
  let processText = text;
  if (text.length > 195) {
    console.warn('   ⚠️ Text segment too long, truncating...');
    processText = text.substring(0, 192) + '...';
  }

  const url = getAudioUrl(processText, {
    lang: lang,
    slow: false,
    host: 'https://translate.google.com',
  });

  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}
