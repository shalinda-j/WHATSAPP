import OpenAI from 'openai';
import {
  IImageGenProvider,
  ImageGenInput,
  ImageGenResult,
} from './IContentGenProvider';

/**
 * DALL-E / `gpt-image-1` adapter. Sized aliases are mapped to the closest
 * native size; we don't reject custom sizes since the API gates that itself.
 */
export class OpenAIImageProvider implements IImageGenProvider {
  readonly name = 'openai';
  readonly defaultModel = 'gpt-image-1';
  readonly requiredEnv = ['OPENAI_API_KEY'];

  isReady(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  private mapSize(size?: string): string {
    if (!size) return '1024x1024';
    const alias: Record<string, string> = {
      square: '1024x1024',
      landscape: '1792x1024',
      portrait: '1024x1792',
    };
    return alias[size] ?? size;
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    if (!this.isReady()) {
      throw new Error('OPENAI_API_KEY not set');
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = input.model || this.defaultModel;
    const size = this.mapSize(input.size);

    // The SDK exposes the v1 images surface; both DALL-E 3 and gpt-image-1
    // accept this signature. Negative prompts are appended to the main prompt
    // since the API doesn't take them as a separate field.
    const prompt = input.negativePrompt
      ? `${input.prompt}\n\nAvoid: ${input.negativePrompt}`
      : input.prompt;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (client.images.generate as any)({
      model,
      prompt,
      size,
      n: 1,
    });

    const first = res?.data?.[0] ?? {};
    return {
      url: first.url,
      inlineBase64: first.b64_json,
      meta: {
        provider: 'openai',
        model,
        size,
        revisedPrompt: first.revised_prompt,
      },
    };
  }
}
