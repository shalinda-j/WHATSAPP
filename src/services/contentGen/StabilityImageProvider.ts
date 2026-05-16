import axios from 'axios';
import {
  IImageGenProvider,
  ImageGenInput,
  ImageGenResult,
} from './IContentGenProvider';

/**
 * Stability AI v2beta SDXL adapter. Returns the generated image as base64
 * since Stability's API does not host the asset.
 *
 * Credential source order:
 *   1. Active Config row with providerType='image-stability'.
 *   2. STABILITY_API_KEY env var.
 */
export class StabilityImageProvider implements IImageGenProvider {
  readonly name = 'stability';
  readonly defaultModel = 'stable-diffusion-xl-1024-v1-0';
  readonly requiredEnv = ['STABILITY_API_KEY'];

  private cachedKey: string | null = null;
  private cachedModel: string | null = null;
  private cacheLoadedAt = 0;
  private static readonly CACHE_TTL_MS = 60 * 1000;

  private async refreshCache(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < StabilityImageProvider.CACHE_TTL_MS) {
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Config = require('../../models/Config').default;
      const row = await Config.findOne({
        providerType: 'image-stability',
        isActive: true,
      });
      this.cachedKey = (row?.apiKey as string | undefined) ?? null;
      this.cachedModel = (row?.aiModel as string | undefined) ?? null;
    } catch (err) {
      console.error('StabilityImageProvider config refresh failed:', err);
    } finally {
      this.cacheLoadedAt = Date.now();
    }
  }

  private getApiKey(): string | null {
    return this.cachedKey || process.env.STABILITY_API_KEY || null;
  }

  isReady(): boolean {
    void this.refreshCache();
    return !!this.getApiKey();
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    await this.refreshCache();
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(
        'Stability image provider not configured. Add an image-stability entry in Configuration → Image Providers, or set STABILITY_API_KEY.',
      );
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
          Authorization: `Bearer ${apiKey}`,
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
        model: input.model || this.cachedModel || this.defaultModel,
        size: input.size,
        seed: data.seed,
        finishReason: data.finish_reason,
        credentialSource: this.cachedKey ? 'config-db' : 'env',
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
