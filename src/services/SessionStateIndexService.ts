interface MongoIndexDescription {
  name?: string;
  key?: Record<string, number>;
  expireAfterSeconds?: number;
}

interface SessionStateCollection {
  indexes(): Promise<MongoIndexDescription[]>;
  dropIndex(name: string): Promise<unknown>;
  createIndex(
    keys: Record<string, number>,
    options: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface SessionStateDatabase {
  collection(name: string): SessionStateCollection;
  command(command: Record<string, unknown>): Promise<unknown>;
}

export type SessionStateIndexReconcileResult =
  'unchanged' | 'created' | 'converted' | 'recreated';

const COLLECTION_NAME = 'sessionstates';
const EXPIRES_AT_KEY = { expiresAt: 1 };

export async function reconcileSessionStateExpiresAtIndex(
  db: SessionStateDatabase,
): Promise<SessionStateIndexReconcileResult> {
  const collection = db.collection(COLLECTION_NAME);
  let indexes: MongoIndexDescription[];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if ((error as { codeName?: string })?.codeName !== 'NamespaceNotFound') {
      throw error;
    }
    indexes = [];
  }
  const expiresAtIndex = indexes.find(
    (index) =>
      index.key?.expiresAt === 1 && Object.keys(index.key).length === 1,
  );

  if (expiresAtIndex?.expireAfterSeconds === 0) return 'unchanged';

  if (expiresAtIndex) {
    try {
      await db.command({
        collMod: COLLECTION_NAME,
        index: {
          keyPattern: EXPIRES_AT_KEY,
          expireAfterSeconds: 0,
        },
      });
      return 'converted';
    } catch {
      // Atlas users with readWrite can create/drop indexes but may not have the
      // dbAdmin permission required by collMod. Recreate only this index as a
      // safe compatibility fallback; application data is not modified.
      await collection.dropIndex(expiresAtIndex.name || 'expiresAt_1');
      await collection.createIndex(EXPIRES_AT_KEY, {
        name: 'expiresAt_1',
        expireAfterSeconds: 0,
      });
      return 'recreated';
    }
  }

  await collection.createIndex(EXPIRES_AT_KEY, {
    name: 'expiresAt_1',
    expireAfterSeconds: 0,
  });
  return 'created';
}
