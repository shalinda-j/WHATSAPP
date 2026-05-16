/**
 * Content generation provider abstraction. Image-first; video/audio adapters
 * implement the same shape so the route layer stays provider-agnostic.
 */

export type AssetType = 'image' | 'video' | 'audio';

export interface ImageGenInput {
  prompt: string;
  negativePrompt?: string;
  /** Provider-native size string (e.g. '1024x1024'). The service maps a
   *  small set of aliases (`square`, `landscape`, `portrait`) before calling. */
  size?: string;
  /** Hint that the provider may ignore. Defaults to the provider's own default. */
  model?: string;
}

export interface ImageGenResult {
  url?: string;
  inlineBase64?: string;
  costUsd?: number;
  meta?: Record<string, unknown>;
}

export interface IImageGenProvider {
  /** Unique key used in env + admin selector. */
  readonly name: string;
  /** Default model id if the caller doesn't specify one. */
  readonly defaultModel: string;
  /** Env vars required for this provider to be `ready`. */
  readonly requiredEnv: string[];
  /** Returns true when every requiredEnv var is set. */
  isReady(): boolean;
  generate(input: ImageGenInput): Promise<ImageGenResult>;
}
