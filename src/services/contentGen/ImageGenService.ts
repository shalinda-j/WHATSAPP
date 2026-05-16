import { OpenAIImageProvider } from './OpenAIImageProvider';
import { StabilityImageProvider } from './StabilityImageProvider';
import {
  IImageGenProvider,
  ImageGenInput,
  ImageGenResult,
} from './IContentGenProvider';

/**
 * Picks an image-gen provider by name or by readiness. Caller can pin a
 * provider via input or via `CONTENT_IMAGE_PROVIDER`; otherwise the service
 * walks the priority order and returns the first one with credentials set.
 */
class ImageGenService {
  private providers: IImageGenProvider[] = [
    new OpenAIImageProvider(),
    new StabilityImageProvider(),
  ];

  list(): Array<{
    name: string;
    defaultModel: string;
    ready: boolean;
    missing: string[];
  }> {
    return this.providers.map((p) => ({
      name: p.name,
      defaultModel: p.defaultModel,
      ready: p.isReady(),
      missing: p.requiredEnv.filter((e) => !process.env[e]),
    }));
  }

  private pick(preferred?: string): IImageGenProvider | null {
    if (preferred) {
      const exact = this.providers.find((p) => p.name === preferred);
      if (exact && exact.isReady()) return exact;
    }
    const fromEnv = process.env.CONTENT_IMAGE_PROVIDER;
    if (fromEnv) {
      const match = this.providers.find((p) => p.name === fromEnv);
      if (match && match.isReady()) return match;
    }
    return this.providers.find((p) => p.isReady()) ?? null;
  }

  async generate(
    input: ImageGenInput & { provider?: string },
  ): Promise<{ provider: string; result: ImageGenResult }> {
    const chosen = this.pick(input.provider);
    if (!chosen) {
      const missing = this.providers
        .map((p) => p.requiredEnv.filter((e) => !process.env[e]).join(' or '))
        .filter(Boolean);
      throw new Error(
        `No image-gen provider configured. Set one of: ${missing.join(' / ')}`,
      );
    }
    const result = await chosen.generate(input);
    return { provider: chosen.name, result };
  }
}

export const imageGenService = new ImageGenService();
