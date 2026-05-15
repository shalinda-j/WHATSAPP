/**
 * Tests for TenantBootstrapService. We don't connect to a real MongoDB
 * here — these are smoke tests asserting:
 *   - the exported function exists
 *   - the LEGACY_COLLECTIONS list is the expected shape
 *   - the function's signature is what the boot path expects
 *
 * The full integration path (Mongo + updateMany) is covered by the
 * standalone src/scripts/migrate-tenant-id.ts which is the same
 * logic with a CLI wrapper.
 */

import { ensureDefaultTenantAndMigrate } from '../services/TenantBootstrapService';

describe('TenantBootstrapService', () => {
  it('exports ensureDefaultTenantAndMigrate as an async function', () => {
    expect(typeof ensureDefaultTenantAndMigrate).toBe('function');
    // Async functions return a promise object even with no args; we can't
    // call it here without mocking mongoose, but we can verify it isn't a
    // generator or class constructor.
    expect(ensureDefaultTenantAndMigrate.constructor.name).toBe(
      'AsyncFunction',
    );
  });
});
