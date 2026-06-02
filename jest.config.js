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
  // CI runs on a ~2GB heap. ts-jest's per-file type-checking plus heavy module
  // graphs (baileys, node-nlp, mongoose) across parallel workers exhausted it
  // (heap OOM, exit 134). isolatedModules skips the redundant in-test type
  // check — `tsc --noEmit` already gates types in its own job — and capping
  // worker memory lets Jest recycle workers before they balloon.
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
      },
    ],
  },
  workerIdleMemoryLimit: '512MB',
};
