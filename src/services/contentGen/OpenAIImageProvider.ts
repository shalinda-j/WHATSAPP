import OpenAI from 'openai';
import {
  IImageGenProvider,
  ImageGenInput,
  ImageGenResult,
} from './IContentGenProvider';

/**
 * DALL-E / `gpt-image-1` adapter. Sized aliases are mapped to the closest
 * native size; we don't reject custom sizes since the API gates that itself.
 *
 * Credential source order:
 *   1. Active Config row with providerType='image-openai' (set via the
 *      Configuration → Image Providers tab; encrypted in Mongo).
 *   2. OPENAI_API_KEY env var (legacy / single-tenant deployments).
 * The Config row also wins for `defaultModel` when present.
 */
export class OpenAIImageProvider implements IImageGenProvider {
  readonly name = 'openai';
  readonly defaultModel = 'gpt-image-1';
  readonly requiredEnv = ['OPENAI_API_KEY'];

  private cachedKey: string | null = null;
  private cachedModel: string | null = null;
  private cacheLoadedAt = 0;
  private static readonly CACHE_TTL_MS = 60 * 1000;

  private async refreshCache(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < OpenAIImageProvider.CACHE_TTL_MS) {
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Config = require('../../models/Config').default;
      const row = await Config.findOne({
        providerType: 'image-openai',
        isActive: true,
      });
      this.cachedKey = (row?.apiKey as string | undefined) ?? null;
      this.cachedModel = (row?.aiModel as string | undefined) ?? null;
    } catch (err) {
      // DB might not be ready at boot — keep last-known cache values.
      console.error('OpenAIImageProvider config refresh failed:', err);
    } finally {
      this.cacheLoadedAt = Date.now();
    }
  }

  private getApiKey(): string | null {
    return this.cachedKey || process.env.OPENAI_API_KEY || null;
  }

  isReady(): boolean {
    // Fire-and-forget cache refresh so the *next* sync check is accurate,
    // without blocking this call. On boot the first `isReady()` may return
    // false even when a Config row exists; the second call will be correct.
    void this.refreshCache();
    return !!this.getApiKey();
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
    // Block on the cache refresh here so the actual generation request never
    // races with a stale cache.
    await this.refreshCache();
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(
        'OpenAI image provider not configured. Add an image-openai entry in Configuration → Image Providers, or set OPENAI_API_KEY.',
      );
    }
    const client = new OpenAI({ apiKey });
    const model = input.model || this.cachedModel || this.defaultModel;
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
        credentialSource: this.cachedKey ? 'config-db' : 'env',
      },
    };
  }
}
