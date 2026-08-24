/**
 * Baileys v7 is ESM-only while this application is still emitted as CommonJS.
 * Keep the module boundary in one place and preserve the native dynamic import
 * at runtime (TypeScript otherwise rewrites import() to require()).
 */
export type BaileysModule = typeof import('@whiskeysockets/baileys');

const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<BaileysModule>;

let baileysModule: Promise<BaileysModule> | undefined;

export function loadBaileys(): Promise<BaileysModule> {
  baileysModule ??= nativeImport('@whiskeysockets/baileys');
  return baileysModule;
}
