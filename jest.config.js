/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  clearMocks: true,

  // --- Resource safeguards ---------------------------------------------
  // ts-jest's default mode builds a full TypeScript program + type-checker
  // for EVERY test file. With this codebase's dependency graph (baileys,
  // mongoose, googleapis, openai, xlsx) that is ~1-2 GB per worker, and the
  // default worker pool is (CPU cores - 1) processes — enough to exhaust RAM
  // and freeze the machine.
  //
  // Type safety is verified separately and cheaply via `tsc --noEmit`
  // (`npm run typecheck`), so Jest only needs to TRANSPILE, not type-check.
  // Transpile-only is driven by `"isolatedModules": true` in tsconfig.json,
  // which ts-jest honours to skip the in-memory type-checker entirely.

  // Run in a single worker by default. Override with `--maxWorkers=N` only
  // if you know the machine has the RAM headroom.
  maxWorkers: 1,

  // Recycle any worker whose heap grows past this, so a heavy import test
  // can never balloon unbounded.
  workerIdleMemoryLimit: '512MB',

  // These are pure import/unit tests; none should run long. A short timeout
  // surfaces an accidental hang (e.g. a real network/DB call) fast instead
  // of pinning the CPU.
  testTimeout: 15000,

  // Ensure the process always exits even if a module under test registers a
  // stray timer/handle at import time (schedulers, intervals).
  forceExit: true,
};
