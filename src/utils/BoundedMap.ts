/**
 * BoundedMap — a Map with LRU eviction and optional per-entry TTL.
 *
 * Replaces unbounded `new Map()` caches that would otherwise grow forever
 * in long-running processes (memory leak — Phase 2 fix).
 *
 * - `maxSize`: hard cap; oldest-touched entry evicted on overflow
 * - `ttlMs`:   optional default TTL; expired entries removed on access
 * - `cleanupIntervalMs`: optional periodic sweep for expired entries
 */
export interface BoundedMapOptions {
  maxSize: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class BoundedMap<K, V> {
  private readonly store = new Map<K, Entry<V>>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: BoundedMapOptions) {
    if (options.maxSize <= 0) {
      throw new Error('BoundedMap.maxSize must be > 0');
    }
    this.maxSize = options.maxSize;
    this.defaultTtlMs = options.ttlMs ?? 0;

    if (options.cleanupIntervalMs && options.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.sweepExpired(), options.cleanupIntervalMs);
      // Don't keep the process alive just for cleanup
      this.cleanupTimer.unref?.();
    }
  }

  get size(): number {
    return this.store.size;
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    // LRU bump: re-insert to mark as most-recently-used
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): this {
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : Number.POSITIVE_INFINITY;

    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Evict oldest (first-inserted == least-recently-used after LRU bumps)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { value, expiresAt });
    return this;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Remove all expired entries. Called automatically if cleanupIntervalMs was provided.
   */
  sweepExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Stop the periodic cleanup timer (call on shutdown).
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }

  private isExpired(entry: Entry<V>): boolean {
    return entry.expiresAt <= Date.now();
  }
}
