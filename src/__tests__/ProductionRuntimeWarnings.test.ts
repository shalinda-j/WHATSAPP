import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import SessionState from '../models/SessionState';
import { validateEnvironment } from '../config/env';

function collectTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : collectTypeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('Mongoose update options', () => {
  it('does not use the deprecated new: true option in production TypeScript', () => {
    const offenders = collectTypeScriptFiles(join(process.cwd(), 'src'))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .map((line, index) => ({ path, line, lineNumber: index + 1 })),
      )
      .filter(({ line }) => /\bnew\s*:\s*true\b/.test(line))
      .map(
        ({ path, lineNumber }) =>
          `${path.replace(`${process.cwd()}/`, '')}:${lineNumber}`,
      );

    expect(offenders).toEqual([]);
  });

  it('declares exactly one TTL index for SessionState.expiresAt', () => {
    const expiresAtIndexes = SessionState.schema
      .indexes()
      .filter(([fields]) => fields.expiresAt === 1);

    expect(expiresAtIndexes).toHaveLength(1);
    expect(expiresAtIndexes[0][1]).toMatchObject({ expireAfterSeconds: 0 });
  });

  it('does not claim AI is broken when providers may be stored in MongoDB', () => {
    const previousEnv = { ...process.env };
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      process.env.JWT_SECRET = 'j'.repeat(32);
      process.env.ENCRYPTION_KEY = 'e'.repeat(32);
      process.env.MONGODB_URI = 'mongodb://localhost/runtime-warning-test';
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      validateEnvironment();

      const warnings = warn.mock.calls.flat().join(' ');
      expect(warnings).not.toContain('AI features will not work');
      expect(warnings.toLowerCase()).toContain('database-configured providers');
    } finally {
      process.env = previousEnv;
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
