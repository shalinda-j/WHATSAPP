import { isDeprecatedGeminiModel } from '../services/AIProviderSeeder';
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
