import {
  isDeprecatedGeminiModel,
  isPaidOnlyGeminiModel,
} from '../services/AIProviderSeeder';
import { coerceToSupportedGeminiModel } from '../config/geminiModels';
import { GEMINI_DEFAULT_MODEL } from '../config/brand';

/**
 * Guards the production incident where the bot replied with the canned
 * "we'll get back to you shortly" lead-fallback to every user: the configured
 * Gemini model (gemini-1.5-flash-latest) had been retired by Google and 404'd
 * on every call. These tests keep the deprecation list honest so a retired
 * model is always rewritten on boot.
 */
describe('isDeprecatedGeminiModel', () => {
  it.each([
    'gemini-1.0-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-exp',
    'gemini-pro',
    'gemini-pro-vision',
  ])('flags retired model %s', (model) => {
    expect(isDeprecatedGeminiModel(model)).toBe(true);
  });

  it.each([
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3.5-flash',
  ])('does not flag current model %s', (model) => {
    expect(isDeprecatedGeminiModel(model)).toBe(false);
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(isDeprecatedGeminiModel('  GEMINI-1.5-FLASH  ')).toBe(true);
  });

  it('treats null/undefined/empty as not deprecated (nothing to migrate)', () => {
    expect(isDeprecatedGeminiModel(null)).toBe(false);
    expect(isDeprecatedGeminiModel(undefined)).toBe(false);
    expect(isDeprecatedGeminiModel('')).toBe(false);
  });

  it('the chosen default model is not itself deprecated', () => {
    expect(isDeprecatedGeminiModel(GEMINI_DEFAULT_MODEL)).toBe(false);
  });
});

/**
 * Guards the SECOND production incident: the DB was pinned to gemini-3.5-flash,
 * which is paid-only/preview and 429s on every call with a free-tier key —
 * again collapsing every reply into the canned template. The boot migration
 * must rewrite paid-only 3.x models to the free-tier default.
 */
describe('isPaidOnlyGeminiModel', () => {
  it.each([
    'gemini-3.5-flash',
    'gemini-3.5-pro',
    'gemini-3.0-flash',
    'gemini-3-flash',
    'GEMINI-3.5-FLASH',
  ])('flags paid-only 3.x model %s', (model) => {
    expect(isPaidOnlyGeminiModel(model)).toBe(true);
  });

  it.each([
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-1.5-flash',
  ])('does not flag free-tier / non-3.x model %s', (model) => {
    expect(isPaidOnlyGeminiModel(model)).toBe(false);
  });

  it('treats null/undefined/empty as not paid-only', () => {
    expect(isPaidOnlyGeminiModel(null)).toBe(false);
    expect(isPaidOnlyGeminiModel(undefined)).toBe(false);
    expect(isPaidOnlyGeminiModel('')).toBe(false);
  });

  it('the free-tier default is not flagged as paid-only', () => {
    expect(isPaidOnlyGeminiModel(GEMINI_DEFAULT_MODEL)).toBe(false);
  });
});

/**
 * Runtime coercion is the belt-and-braces guard: every Gemini call passes its
 * model through this, so even a stale DB row (gemini-3.5-flash) never reaches
 * the API and can never 429/404 the whole AI chain into the canned template.
 */
describe('coerceToSupportedGeminiModel', () => {
  it('rewrites a paid-only 3.x model to the free-tier default', () => {
    expect(coerceToSupportedGeminiModel('gemini-3.5-flash')).toBe(
      GEMINI_DEFAULT_MODEL,
    );
  });

  it('rewrites a retired model to the default', () => {
    expect(coerceToSupportedGeminiModel('gemini-1.5-flash-latest')).toBe(
      GEMINI_DEFAULT_MODEL,
    );
  });

  it('leaves a supported free-tier model untouched', () => {
    expect(coerceToSupportedGeminiModel('gemini-2.5-flash-lite')).toBe(
      'gemini-2.5-flash-lite',
    );
    expect(coerceToSupportedGeminiModel('gemini-2.5-pro')).toBe(
      'gemini-2.5-pro',
    );
  });

  it('falls back to the default for empty/null input', () => {
    expect(coerceToSupportedGeminiModel('')).toBe(GEMINI_DEFAULT_MODEL);
    expect(coerceToSupportedGeminiModel(null)).toBe(GEMINI_DEFAULT_MODEL);
  });
});
