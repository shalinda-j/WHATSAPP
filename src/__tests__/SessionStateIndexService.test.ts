import { reconcileSessionStateExpiresAtIndex } from '../services/SessionStateIndexService';

describe('reconcileSessionStateExpiresAtIndex', () => {
  it('converts an existing ordinary expiresAt index to TTL with collMod', async () => {
    const collection = {
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'expiresAt_1', key: { expiresAt: 1 } },
      ]),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collection),
      command: jest.fn().mockResolvedValue({ ok: 1 }),
    };

    await expect(reconcileSessionStateExpiresAtIndex(db)).resolves.toBe(
      'converted',
    );
    expect(db.command).toHaveBeenCalledWith({
      collMod: 'sessionstates',
      index: {
        keyPattern: { expiresAt: 1 },
        expireAfterSeconds: 0,
      },
    });
    expect(collection.dropIndex).not.toHaveBeenCalled();
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  it('recreates the index as TTL when collMod is unavailable', async () => {
    const collection = {
      indexes: jest
        .fn()
        .mockResolvedValue([{ name: 'legacy_expires', key: { expiresAt: 1 } }]),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue('expiresAt_1'),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collection),
      command: jest.fn().mockRejectedValue(new Error('collMod unauthorized')),
    };

    await expect(reconcileSessionStateExpiresAtIndex(db)).resolves.toBe(
      'recreated',
    );
    expect(collection.dropIndex).toHaveBeenCalledWith('legacy_expires');
    expect(collection.createIndex).toHaveBeenCalledWith(
      { expiresAt: 1 },
      { name: 'expiresAt_1', expireAfterSeconds: 0 },
    );
  });

  it('creates the TTL index when the collection does not exist yet', async () => {
    const namespaceMissing = Object.assign(new Error('namespace not found'), {
      codeName: 'NamespaceNotFound',
    });
    const collection = {
      indexes: jest.fn().mockRejectedValue(namespaceMissing),
      dropIndex: jest.fn(),
      createIndex: jest.fn().mockResolvedValue('expiresAt_1'),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collection),
      command: jest.fn(),
    };

    await expect(reconcileSessionStateExpiresAtIndex(db)).resolves.toBe(
      'created',
    );
    expect(collection.createIndex).toHaveBeenCalledWith(
      { expiresAt: 1 },
      { name: 'expiresAt_1', expireAfterSeconds: 0 },
    );
  });

  it('leaves an existing TTL index unchanged', async () => {
    const collection = {
      indexes: jest.fn().mockResolvedValue([
        {
          name: 'expiresAt_1',
          key: { expiresAt: 1 },
          expireAfterSeconds: 0,
        },
      ]),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    };
    const db = {
      collection: jest.fn().mockReturnValue(collection),
      command: jest.fn(),
    };

    await expect(reconcileSessionStateExpiresAtIndex(db)).resolves.toBe(
      'unchanged',
    );
    expect(db.command).not.toHaveBeenCalled();
    expect(collection.dropIndex).not.toHaveBeenCalled();
    expect(collection.createIndex).not.toHaveBeenCalled();
  });
});
