import { transcribeAudio as geminiTranscribeAudio } from './gemini';

/**
 * Transcribe audio using Gemini's multimodal capabilities
 * @param audioBuffer Buffer containing the audio data
 * @returns Transcribed text
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
    try {
        console.log('   🎙️ Transcribing audio with Gemini...');

        // Convert Buffer to Base64 for Gemini
        const audioBase64 = audioBuffer.toString('base64');

        // Use Gemini's multimodal transcription
        const transcription = await geminiTranscribeAudio(audioBase64, 'audio/ogg');

        return transcription;
    } catch (error: any) {
        console.error('❌ Transcription error:', error.message || error);
        throw new Error('Failed to transcribe audio');
    }
}

/**
 * Generate speech from text
 * NOTE: Gemini does not support TTS. Voice responses are disabled.
 * This function throws an error to signal that TTS is not available.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
    console.log('   ⚠️ TTS is disabled (Gemini does not support text-to-speech)');
    throw new Error('TTS not supported - Gemini only mode');
}
