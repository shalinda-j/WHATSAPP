import axios from 'axios';
import {
  IImageGenProvider,
  ImageGenInput,
  ImageGenResult,
} from './IContentGenProvider';

/**
 * Stability AI v2beta SDXL adapter. Returns the generated image as base64
 * since Stability's API does not host the asset.
 */
export class StabilityImageProvider implements IImageGenProvider {
  readonly name = 'stability';
  readonly defaultModel = 'stable-diffusion-xl-1024-v1-0';
  readonly requiredEnv = ['STABILITY_API_KEY'];

  isReady(): boolean {
    return !!process.env.STABILITY_API_KEY;
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    if (!this.isReady()) {
      throw new Error('STABILITY_API_KEY not set');
    }

    const form = new FormData();
    form.append('prompt', input.prompt);
    if (input.negativePrompt) {
      form.append('negative_prompt', input.negativePrompt);
    }
    form.append('output_format', 'png');
    if (input.size) form.append('aspect_ratio', mapAspect(input.size));

    const res = await axios.post(
      'https://api.stability.ai/v2beta/stable-image/generate/core',
      form,
      {
        headers: {
          Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
          Accept: 'application/json',
        },
        timeout: 60000,
      },
    );

    const data = res.data ?? {};
    return {
      inlineBase64: data.image,
      meta: {
        provider: 'stability',
        model: input.model || this.defaultModel,
        size: input.size,
        seed: data.seed,
        finishReason: data.finish_reason,
      },
    };
  }
}

function mapAspect(size: string): string {
  // Map our aliases / pixel sizes to Stability's aspect_ratio enum.
  if (size === 'square' || size.startsWith('1024x1024')) return '1:1';
  if (size === 'landscape' || /^17\d\dx10\d\d$/.test(size)) return '16:9';
  if (size === 'portrait' || /^10\d\dx17\d\d$/.test(size)) return '9:16';
  return '1:1';
}
