import { randomUUID } from 'node:crypto';

export type SessionLease = string;

export interface SessionIdentity {
  sessionId: string;
  tenantId: string;
  sessionName?: string;
}

export type SessionPhase =
  | 'idle'
  | 'starting'
  | 'active'
  | 'reconnecting'
  | 'deleting'
  | 'deleted'
  | 'failed'
  | 'stopped';

export interface SessionRepository {
  claimGeneration(
    identity: SessionIdentity,
    lease: SessionLease,
    expiresAt: number,
    signal: AbortSignal,
  ): Promise<number | undefined>;
  recreateAndClaim(
    identity: SessionIdentity,
    lease: SessionLease,
    expiresAt: number,
    signal: AbortSignal,
  ): Promise<number>;
  validateLease(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<boolean>;
  renewLease(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
    expiresAt: number,
    signal: AbortSignal,
  ): Promise<boolean>;
  validateEventOwnership(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<boolean>;
  persistTombstone(
    identity: SessionIdentity,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<void>;
  releaseClaim(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface CoordinatedAuth {
  readonly state: unknown;
  saveCredentials(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<void>;
  writeKeys(
    identity: SessionIdentity,
    data: unknown,
    generation: number,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<void>;
  release(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface AuthStateFactory {
  create(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<CoordinatedAuth>;
  clear(
    identity: SessionIdentity,
    generation: number | undefined,
    lease: SessionLease,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface SocketAuth {
  readonly state: unknown;
  saveCredentials(): Promise<void>;
  writeKeys(data: unknown): Promise<void>;
}

export interface SocketHandle {
  logout(signal: AbortSignal): Promise<void>;
  end(reason: unknown, signal: AbortSignal): void | Promise<void>;
}

export interface EarlyEventAdapter {
  isOwner(): boolean;
  publish(event: unknown): Promise<boolean>;
}

export type OwnedEventRollback = () => void | Promise<void>;

export interface SocketFactory {
  create(input: {
    identity: SessionIdentity;
    generation: number;
    lease: SessionLease;
    auth: SocketAuth;
    events: EarlyEventAdapter;
    signal: AbortSignal;
  }): Promise<SocketHandle>;
}

export interface Scheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SessionSnapshot {
  identity: SessionIdentity;
  phase: SessionPhase;
  generation: number;
  lease?: SessionLease;
  hasSocket: boolean;
  failure?: unknown;
}

export type DisconnectReason =
  'restart-required' | 'conflict' | 'transient' | 'logged-out';

export interface DisconnectEvent {
  reason: DisconnectReason;
}

export class LifecycleAggregateError extends Error {
  constructor(
    readonly errors: unknown[],
    message: string,
  ) {
    super(message);
    this.name = 'AggregateError';
  }
}

class StaleOperationError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} start was cancelled as stale`);
  }
}

class MutationLane {
  private tail: Promise<void> = Promise.resolve();
  private failure?: unknown;
  private hasFailure = false;
  private sealed = false;
  private finalized = false;

  submit(operation: () => Promise<void>): Promise<void> {
    if (this.sealed) return Promise.resolve();
    const result = this.tail.then(operation);
    result.catch((error: unknown) => {
      if (!this.hasFailure) {
        this.hasFailure = true;
        this.failure =
          error === undefined ? new Error('mutation operation failed') : error;
      }
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    // EventEmitter callers commonly ignore these promises. Persistence failure is
    // retained for retirement, while the event-facing adapter never rejects.
    return result.then(
      () => undefined,
      () => undefined,
    );
  }

  seal(finalSave: () => Promise<void>): void {
    if (this.finalized) return;
    this.sealed = true;
    this.finalized = true;
    const result = this.tail.then(finalSave);
    result.catch((error: unknown) => {
      if (!this.hasFailure) {
        this.hasFailure = true;
        this.failure =
          error === undefined ? new Error('mutation operation failed') : error;
      }
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
  }

  async drain(): Promise<void> {
    await this.tail;
    if (this.hasFailure) throw this.failure;
  }
}

type CleanupFailureCategory = 'mutation-durability' | 'mandatory';
interface CleanupFailure {
  category: CleanupFailureCategory;
  error: unknown;
}
interface RetryableCleanup {
  run(): Promise<void>;
}

interface SessionRecord {
  identity: SessionIdentity;
  phase: SessionPhase;
  generation: number;
  lease?: SessionLease;
  epoch: number;
  deleteRequested: boolean;
  tombstoned: boolean;
  tail: Promise<void>;
  startPromise?: Promise<SocketHandle>;
  reconnectPromise?: Promise<SocketHandle>;
  deletePromise?: Promise<void>;
  socket?: SocketHandle;
  auth?: CoordinatedAuth;
  mutations?: MutationLane;
  resourceGeneration?: number;
  resourceLease?: SessionLease;
  mutationLaneRetired?: boolean;
  socketRetired?: boolean;
  logoutAttempted?: boolean;
  authReleased?: boolean;
  claimReleased?: boolean;
  durabilityFailure?: unknown;
  eventFailure?: unknown;
  failure?: unknown;
  publishedSocket?: SocketHandle;
  retryCount: number;
  reconnectTimer?: { handle: unknown; cancel(): void };
  scheduledOwner?: { generation: number; lease: SessionLease };
  heartbeatTimer?: unknown;
  leaseExpiresAt?: number;
  definitiveClearSucceeded?: boolean;
  activationSocket?: SocketHandle;
  activationRetired?: boolean;
  eventControllers?: Set<AbortController>;
  eventTasks?: Set<Promise<void>>;
  eventCleanupFailures?: unknown[];
  lateCleanups?: Set<RetryableCleanup>;
}

interface TimerEntry {
  cancel(error: Error): void;
}

const nativeScheduler: Scheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class SessionLifecycleCoordinator {
  private readonly records = new Map<string, SessionRecord>();
  private readonly timers = new Map<unknown, TimerEntry>();
  private readonly lateCleanupPromises = new Set<Promise<void>>();
  private readonly lateCleanupFailures: unknown[] = [];
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;
  private readonly configuredLeaseDurationMs: number;
  private readonly configuredOperationTimeoutMs: number;
  private readonly configuredHeartbeatIntervalMs: number;
  private readonly configuredConflictRetryMs: number;
  private readonly configuredTransientRetryMs: number;
  private readonly configuredMaxTransientRetries: number;

  constructor(
    private readonly dependencies: {
      authFactory: AuthStateFactory;
      socketFactory: SocketFactory;
      repository: SessionRepository;
      scheduler?: Scheduler;
      operationTimeoutMs?: number;
      logout?: (socket: SocketHandle, signal: AbortSignal) => Promise<void>;
      leaseFactory?: () => SessionLease;
      clock?: () => number;
      leaseDurationMs?: number;
      heartbeatIntervalMs?: number;
      conflictRetryMs?: number;
      transientRetryMs?: number;
      maxTransientRetries?: number;
      onSocketActivated?: (
        identity: SessionIdentity,
        generation: number,
        lease: SessionLease,
        socket: SocketHandle,
        signal: AbortSignal,
      ) => void | Promise<void>;
      onSocketRetired?: (
        identity: SessionIdentity,
        generation: number,
        lease: SessionLease,
        socket: SocketHandle,
        signal: AbortSignal,
      ) => void | Promise<void>;
      onOwnedEvent?: (
        identity: SessionIdentity,
        generation: number,
        lease: SessionLease,
        event: unknown,
        signal: AbortSignal,
        registerRollback: (rollback: OwnedEventRollback) => void,
      ) => void | Promise<void>;
    },
  ) {
    const leaseDuration = dependencies.leaseDurationMs ?? 30_000;
    const operationTimeout = dependencies.operationTimeoutMs ?? 5_000;
    const heartbeatInterval =
      dependencies.heartbeatIntervalMs ??
      Math.floor((leaseDuration - operationTimeout) / 2);
    if (!Number.isFinite(leaseDuration) || leaseDuration <= 0)
      throw new Error('leaseDurationMs must be a finite positive number');
    if (!Number.isFinite(operationTimeout) || operationTimeout <= 0)
      throw new Error('operationTimeoutMs must be a finite positive number');
    if (operationTimeout >= leaseDuration)
      throw new Error('operationTimeoutMs must be below leaseDurationMs');
    if (!Number.isFinite(heartbeatInterval) || heartbeatInterval <= 0)
      throw new Error('heartbeatIntervalMs must be a finite positive number');
    if (heartbeatInterval >= leaseDuration)
      throw new Error('heartbeatIntervalMs must be below leaseDurationMs');
    if (heartbeatInterval + operationTimeout >= leaseDuration)
      throw new Error(
        'heartbeatIntervalMs plus operationTimeoutMs must be below leaseDurationMs',
      );
    const conflictRetry = dependencies.conflictRetryMs ?? 5_000;
    const transientRetry = dependencies.transientRetryMs ?? 1_000;
    const maxTransientRetries = dependencies.maxTransientRetries ?? 3;
    for (const [label, value] of [
      ['conflictRetryMs', conflictRetry],
      ['transientRetryMs', transientRetry],
      ['maxTransientRetries', maxTransientRetries],
    ] as const) {
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0)
        throw new Error(`${label} must be a finite nonnegative integer`);
    }
    this.configuredLeaseDurationMs = leaseDuration;
    this.configuredOperationTimeoutMs = operationTimeout;
    this.configuredHeartbeatIntervalMs = heartbeatInterval;
    this.configuredConflictRetryMs = conflictRetry;
    this.configuredTransientRetryMs = transientRetry;
    this.configuredMaxTransientRetries = maxTransientRetries;
  }

  start(input: SessionIdentity | string): Promise<SocketHandle> {
    const identity = this.normalizeIdentity(input);
    const { sessionId } = identity;
    if (this.shuttingDown)
      return Promise.reject(new Error('session coordinator is shut down'));
    const record = this.record(identity);
    if (record.deleteRequested || record.tombstoned)
      return Promise.reject(
        new Error(`session ${sessionId} is deleted by tombstone`),
      );
    const activeSocket = this.getSocket(identity);
    if (activeSocket) return Promise.resolve(activeSocket);
    if (record.reconnectPromise) {
      return record.reconnectPromise.then((socket) => {
        if (this.getSocket(identity) !== socket) {
          throw new StaleOperationError(sessionId);
        }
        return socket;
      });
    }
    if (record.startPromise) return record.startPromise;
    if (record.durabilityFailure !== undefined) {
      return Promise.reject(
        new LifecycleAggregateError(
          [record.durabilityFailure],
          `session ${sessionId} is blocked by an auth durability failure`,
        ),
      );
    }
    if (
      record.phase === 'failed' &&
      (record.auth || record.socket || record.resourceLease)
    ) {
      return Promise.reject(
        new Error(`session ${sessionId} has resources requiring cleanup`),
      );
    }

    record.phase = 'starting';
    const epoch = record.epoch;
    const promise = this.enqueue(record, () =>
      this.startNow(sessionId, record, epoch, 'existing', true),
    );
    record.startPromise = promise;
    void promise
      .finally(() => {
        if (record.startPromise === promise) record.startPromise = undefined;
      })
      .catch(() => undefined);
    return promise;
  }

  delete(input: SessionIdentity | string): Promise<void> {
    const identity = this.normalizeIdentity(input);
    const { sessionId } = identity;
    if (this.shuttingDown) return this.shutdownPromise ?? Promise.resolve();
    const record = this.record(identity);
    if (record.deletePromise) return record.deletePromise;
    this.closeRecordGate(record, 'deleting');
    record.deleteRequested = true;
    record.tombstoned = true;
    const promise = this.enqueue(record, () =>
      this.deleteNow(sessionId, record),
    );
    record.deletePromise = promise;
    void promise
      .finally(() => {
        if (record.deletePromise === promise) record.deletePromise = undefined;
      })
      .catch(() => undefined);
    return promise;
  }

  createOrRecreate(input: SessionIdentity | string): Promise<SocketHandle> {
    const identity = this.normalizeIdentity(input);
    const { sessionId } = identity;
    if (this.shuttingDown)
      return Promise.reject(new Error('session coordinator is shut down'));
    const record = this.record(identity);
    this.closeRecordGate(record, 'deleting');
    record.deleteRequested = true;
    record.tombstoned = true;
    const recreateIntentEpoch = record.epoch;
    const promise = this.enqueue(record, async () => {
      await this.deleteNow(sessionId, record);
      if (this.shuttingDown || record.epoch !== recreateIntentEpoch)
        throw new StaleOperationError(sessionId);
      record.deleteRequested = false;
      record.tombstoned = false;
      record.epoch += 1;
      record.phase = 'starting';
      return this.startNow(sessionId, record, record.epoch, 'recreate', true);
    });
    record.startPromise = promise;
    void promise
      .finally(() => {
        if (record.startPromise === promise) record.startPromise = undefined;
      })
      .catch(() => undefined);
    return promise;
  }

  disconnect(
    input: SessionIdentity | string,
    generation: number,
    lease: SessionLease,
    event: DisconnectEvent,
  ): Promise<void> {
    const identity = this.normalizeIdentity(input);
    const { sessionId } = identity;
    const record = this.records.get(this.identityKey(identity));
    if (
      this.shuttingDown ||
      !record ||
      record.deleteRequested ||
      record.phase !== 'active' ||
      record.generation !== generation ||
      record.lease !== lease
    ) {
      return Promise.resolve();
    }
    if (event.reason === 'logged-out') {
      return this.createOrRecreate(identity).then(() => undefined);
    }
    if (record.reconnectPromise)
      return record.reconnectPromise.then(() => undefined);

    const oldSocket = record.socket;
    this.closeRecordGate(record, 'reconnecting');
    const epoch = record.epoch;
    const laneOperation = this.enqueue(record, async () => {
      if (record.deleteRequested || this.shuttingDown)
        return oldSocket as SocketHandle;
      const cleanupFailures = await this.retireOwnedResources(
        sessionId,
        record,
        'reconnect',
        false,
      );
      if (!this.hasOwnedResources(record)) this.clearResources(record);
      if (cleanupFailures.length > 0)
        throw new LifecycleAggregateError(
          cleanupFailures.map(({ error }) => error),
          `session ${sessionId} reconnect cleanup failed: ${cleanupFailures
            .map(({ error }) => this.errorMessage(error))
            .join('; ')}`,
        );
      if (record.deleteRequested || this.shuttingDown)
        return oldSocket as SocketHandle;
      if (
        event.reason === 'transient' &&
        record.retryCount >= this.configuredMaxTransientRetries
      ) {
        record.phase = 'stopped';
        return oldSocket as SocketHandle;
      }
      let retryDelay = 0;
      if (event.reason === 'conflict')
        retryDelay = this.configuredConflictRetryMs;
      if (event.reason === 'transient') {
        record.retryCount += 1;
        retryDelay = this.configuredTransientRetryMs;
      }
      if (retryDelay > 0) {
        record.phase = 'reconnecting';
        const retryAllowed = await this.waitForReconnect(
          record,
          epoch,
          generation,
          lease,
          retryDelay,
        );
        if (!retryAllowed) return oldSocket as SocketHandle;
      }
      record.phase = 'starting';
      return this.startNow(sessionId, record, epoch, 'existing', false);
    });
    const promise = laneOperation.catch((error: unknown) => {
      if (!record.deleteRequested && !this.shuttingDown) {
        record.phase = 'failed';
        record.failure = error;
      }
      throw error;
    });
    record.reconnectPromise = promise;
    void promise
      .finally(() => {
        if (record.reconnectPromise === promise)
          record.reconnectPromise = undefined;
      })
      .catch(() => undefined);
    return promise.then(() => undefined);
  }

  onConnectionUpdate(
    input: SessionIdentity | string,
    generation: number,
    lease: SessionLease,
    update: { statusCode?: number; loggedOut?: boolean; transient?: boolean },
  ): Promise<void> {
    const identity = this.normalizeIdentity(input);
    const reason: DisconnectReason | undefined = update.loggedOut
      ? 'logged-out'
      : update.statusCode === 515
        ? 'restart-required'
        : update.statusCode === 440
          ? 'conflict'
          : update.transient
            ? 'transient'
            : undefined;
    return reason
      ? this.disconnect(identity, generation, lease, { reason })
      : Promise.resolve();
  }

  handleConnectionUpdate(
    identity: SessionIdentity | string,
    generation: number,
    lease: SessionLease,
    update: { statusCode?: number; loggedOut?: boolean; transient?: boolean },
  ): void {
    void this.onConnectionUpdate(identity, generation, lease, update).catch(
      () => undefined,
    );
  }

  getSnapshot(input: SessionIdentity | string): SessionSnapshot | undefined {
    const identity = this.normalizeIdentity(input);
    const record = this.records.get(this.identityKey(identity));
    if (!record) return undefined;
    return {
      identity: record.identity,
      phase: record.phase,
      generation: record.generation,
      ...(record.lease ? { lease: record.lease } : {}),
      hasSocket: Boolean(record.socket),
      ...(record.failure === undefined ? {} : { failure: record.failure }),
    };
  }

  getSocket(input: SessionIdentity | string): SocketHandle | undefined {
    const identity = this.normalizeIdentity(input);
    const record = this.records.get(this.identityKey(identity));
    return !this.shuttingDown &&
      record?.phase === 'active' &&
      this.hasUnexpiredLocalLease(record) &&
      record.socket === record.publishedSocket
      ? record.publishedSocket
      : undefined;
  }

  getSnapshots(tenantId: string): SessionSnapshot[] {
    this.validateIdentityPart('tenantId', tenantId);
    const snapshots: SessionSnapshot[] = [];
    for (const record of this.records.values()) {
      if (record.identity.tenantId !== tenantId) continue;
      snapshots.push({
        identity: record.identity,
        phase: record.phase,
        generation: record.generation,
        ...(record.lease ? { lease: record.lease } : {}),
        hasSocket: Boolean(this.getSocket(record.identity)),
        ...(record.failure === undefined ? {} : { failure: record.failure }),
      });
    }
    return snapshots;
  }

  getActiveCount(tenantId: string): number {
    return this.getSnapshots(tenantId).filter(({ hasSocket }) => hasSocket)
      .length;
  }

  isCurrent(
    input: SessionIdentity | string,
    generation: number,
    lease: SessionLease,
  ): boolean {
    const identity = this.normalizeIdentity(input);
    const record = this.records.get(this.identityKey(identity));
    return Boolean(
      !this.shuttingDown &&
      record?.phase === 'active' &&
      record.socket &&
      record.generation === generation &&
      record.lease === lease &&
      this.hasUnexpiredLocalLease(record),
    );
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    for (const record of this.records.values()) {
      for (const controller of record.eventControllers ?? [])
        controller.abort();
      record.epoch += 1;
      record.lease = undefined;
    }
    // Existing lane work remains bounded and is allowed to observe the closed
    // intent gate so any resource returned by an in-flight factory can be
    // explicitly retired instead of becoming an unreachable late result.
    this.shutdownPromise = this.shutdownNow();
    return this.shutdownPromise;
  }

  private async shutdownNow(): Promise<void> {
    const retirements = [...this.records.entries()].map(([sessionId, record]) =>
      this.enqueue(record, () => this.retireForShutdown(sessionId, record)),
    );
    const settled = await Promise.allSettled(retirements);
    const lateFailures = await this.awaitLateCleanups();
    this.cancelPendingOperations(new Error('session coordinator is shut down'));
    const failures = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    failures.push(...lateFailures);
    if (failures.length > 0)
      throw new LifecycleAggregateError(
        failures,
        'session shutdown cleanup failed',
      );
  }

  private async startNow(
    sessionId: string,
    record: SessionRecord,
    epoch: number,
    mode: 'existing' | 'recreate',
    resetRetryCount: boolean,
  ): Promise<SocketHandle> {
    const lease = this.newLease(sessionId);
    const claimedExpiresAt = this.now() + this.leaseDurationMs();
    let generation: number | undefined;
    let auth: CoordinatedAuth | undefined;
    let socket: SocketHandle | undefined;
    try {
      await this.retryLateCleanups(record);
      generation = await this.bounded(
        'generation claim',
        (signal) =>
          mode === 'recreate'
            ? this.dependencies.repository.recreateAndClaim(
                record.identity,
                lease,
                claimedExpiresAt,
                signal,
              )
            : this.dependencies.repository.claimGeneration(
                record.identity,
                lease,
                claimedExpiresAt,
                signal,
              ),
        async (lateGeneration) => {
          if (lateGeneration === undefined) return;
          await this.bounded('late claim release', (signal) =>
            this.dependencies.repository.releaseClaim(
              record.identity,
              lateGeneration,
              lease,
              signal,
            ),
          );
        },
      );
      if (generation === undefined) {
        record.tombstoned = true;
        record.phase = 'deleted';
        throw new Error(`session ${sessionId} is deleted`);
      }
      record.resourceGeneration = generation;
      record.resourceLease = lease;
      record.leaseExpiresAt = claimedExpiresAt;
      record.definitiveClearSucceeded = false;
      record.claimReleased = false;
      this.assertIntent(sessionId, record, epoch);

      auth = await this.bounded(
        'auth creation',
        (signal) =>
          this.dependencies.authFactory.create(
            record.identity,
            generation as number,
            lease,
            signal,
          ),
        (lateAuth) =>
          this.runRetryableCleanup(record, () =>
            this.releaseAuth(
              record.identity,
              lateAuth,
              generation as number,
              lease,
            ),
          ),
      );
      record.auth = auth;
      record.authReleased = false;
      this.assertIntent(sessionId, record, epoch);
      await this.assertRepositoryLease(record.identity, generation, lease);

      const mutations = new MutationLane();
      record.mutations = mutations;
      record.mutationLaneRetired = false;
      socket = await this.bounded(
        'socket creation',
        (signal) =>
          this.dependencies.socketFactory.create({
            identity: record.identity,
            generation: generation as number,
            lease,
            signal,
            events: this.earlyEventAdapter(
              record,
              epoch,
              generation as number,
              lease,
            ),
            auth: {
              state: (auth as CoordinatedAuth).state,
              saveCredentials: () =>
                mutations.submit(() =>
                  this.bounded('credential save', (mutationSignal) =>
                    (auth as CoordinatedAuth).saveCredentials(
                      record.identity,
                      generation as number,
                      lease,
                      mutationSignal,
                    ),
                  ),
                ),
              writeKeys: (data) =>
                mutations.submit(() =>
                  this.bounded('key write', (mutationSignal) =>
                    (auth as CoordinatedAuth).writeKeys(
                      record.identity,
                      data,
                      generation as number,
                      lease,
                      mutationSignal,
                    ),
                  ),
                ),
            },
          }),
        (lateSocket) =>
          this.runRetryableCleanup(record, () =>
            this.bounded('late socket end', (signal) =>
              lateSocket.end('late socket creation', signal),
            ),
          ),
      );
      record.socket = socket;
      record.socketRetired = false;
      record.logoutAttempted = false;
      this.assertIntent(sessionId, record, epoch);
      await this.assertRepositoryLease(record.identity, generation, lease);
      this.assertIntent(sessionId, record, epoch);

      record.activationSocket = socket;
      record.activationRetired = false;
      if (this.dependencies.onSocketActivated) {
        await this.bounded(
          'socket activation hook',
          (signal) =>
            this.dependencies.onSocketActivated!(
              record.identity,
              generation as number,
              lease,
              socket as SocketHandle,
              signal,
            ),
          () => {
            record.activationRetired = false;
            return this.runRetryableCleanup(record, () =>
              this.retireActivation(record, generation as number, lease),
            );
          },
        );
      }

      this.assertIntent(sessionId, record, epoch);
      this.assertLocalLease(sessionId, record);
      await this.assertRepositoryLease(record.identity, generation, lease);
      this.assertIntent(sessionId, record, epoch);
      this.assertLocalLease(sessionId, record);

      record.generation = generation;
      record.lease = lease;
      record.phase = 'active';
      record.publishedSocket = socket;
      record.eventFailure = undefined;
      record.failure = undefined;
      if (resetRetryCount) record.retryCount = 0;
      this.scheduleHeartbeat(record, generation, lease);
      return socket;
    } catch (error) {
      const cleanupFailures = await this.retireOwnedResources(
        sessionId,
        record,
        'stale start',
        false,
      );
      if (!this.hasOwnedResources(record)) {
        this.clearResources(record);
      }
      if (
        !record.deleteRequested &&
        !this.shuttingDown &&
        record.phase !== 'deleted'
      ) {
        record.phase = 'failed';
        record.failure = record.eventFailure ?? error;
      }
      if (cleanupFailures.length > 0) {
        throw new LifecycleAggregateError(
          [error, ...cleanupFailures.map((failure) => failure.error)],
          `session ${sessionId} start cancelled: cleanup failed`,
        );
      }
      throw error;
    }
  }

  private async deleteNow(
    sessionId: string,
    record: SessionRecord,
  ): Promise<void> {
    const deleteLease = this.newLease(`${sessionId}:delete`);
    const generation =
      record.resourceGeneration || record.generation || undefined;
    record.phase = 'deleting';
    try {
      await this.bounded('tombstone persistence', (signal) =>
        this.dependencies.repository.persistTombstone(
          record.identity,
          deleteLease,
          signal,
        ),
      );
    } catch (error) {
      record.phase = 'failed';
      record.failure = error;
      throw error;
    }

    const cleanupFailures = await this.retireOwnedResources(
      sessionId,
      record,
      'delete',
      true,
    );

    if (!record.definitiveClearSucceeded) {
      try {
        await this.bounded('definitive auth clear', (signal) =>
          this.dependencies.authFactory.clear(
            record.identity,
            generation,
            deleteLease,
            signal,
          ),
        );
        record.definitiveClearSucceeded = true;
      } catch (error) {
        record.phase = 'failed';
        record.failure = error;
        throw new LifecycleAggregateError(
          [...cleanupFailures.map((failure) => failure.error), error],
          `session ${sessionId} deletion failed: ${this.errorMessage(error)}`,
        );
      }
    }

    const mandatoryFailures = cleanupFailures
      .filter(({ category }) => category === 'mandatory')
      .map(({ error }) => error);
    record.durabilityFailure = undefined;
    if (mandatoryFailures.length > 0) {
      const failure = new LifecycleAggregateError(
        mandatoryFailures,
        `session ${sessionId} deletion cleanup failed: ${mandatoryFailures
          .map((error) => this.errorMessage(error))
          .join('; ')}`,
      );
      record.phase = 'failed';
      record.failure = failure;
      throw failure;
    }
    this.clearResources(record);
    record.phase = 'deleted';
    record.failure = undefined;
  }

  private async retireForShutdown(
    sessionId: string,
    record: SessionRecord,
  ): Promise<void> {
    const failures = await this.retireOwnedResources(
      sessionId,
      record,
      'shutdown',
      false,
    );
    if (!this.hasOwnedResources(record)) this.clearResources(record);
    record.phase = 'stopped';
    if (failures.length > 0)
      throw new LifecycleAggregateError(
        failures.map(({ error }) => error),
        `session ${sessionId} retirement failed`,
      );
  }

  private async retireOwnedResources(
    _sessionId: string,
    record: SessionRecord,
    reason: string,
    logout: boolean,
  ): Promise<CleanupFailure[]> {
    const failures: CleanupFailure[] = [];
    const generation = record.resourceGeneration;
    const lease = record.resourceLease;

    for (const controller of record.eventControllers ?? []) controller.abort();
    if (record.eventTasks?.size)
      await Promise.allSettled([...record.eventTasks]);
    for (const error of record.eventCleanupFailures?.splice(0) ?? [])
      failures.push({ category: 'mandatory', error });

    if (
      !record.mutationLaneRetired &&
      record.auth &&
      record.mutations &&
      generation !== undefined &&
      lease
    ) {
      record.mutations.seal(() =>
        this.bounded('final auth save', (signal) =>
          record.auth!.saveCredentials(
            record.identity,
            generation,
            lease,
            signal,
          ),
        ),
      );
      try {
        await record.mutations.drain();
      } catch (error) {
        record.durabilityFailure = error;
        failures.push({ category: 'mutation-durability', error });
      } finally {
        record.mutationLaneRetired = true;
        record.mutations = undefined;
      }
    }

    const operations: Promise<void>[] = [];
    if (
      record.activationSocket &&
      !record.activationRetired &&
      generation !== undefined &&
      lease
    )
      operations.push(this.retireActivation(record, generation, lease));

    const socket = record.socket;
    if (socket && !record.socketRetired) {
      if (logout && !record.logoutAttempted) {
        record.logoutAttempted = true;
        operations.push(this.performLogout(socket).catch(() => undefined));
      }
      operations.push(
        this.bounded('socket end', (signal) => socket.end(reason, signal)).then(
          () => {
            record.socketRetired = true;
            if (record.socket === socket) record.socket = undefined;
          },
        ),
      );
    }

    const auth = record.auth;
    if (auth && !record.authReleased && generation !== undefined && lease)
      operations.push(
        this.releaseAuth(record.identity, auth, generation, lease).then(() => {
          record.authReleased = true;
          if (record.auth === auth) record.auth = undefined;
        }),
      );

    if (generation !== undefined && lease && !record.claimReleased)
      operations.push(
        this.bounded('claim release', (signal) =>
          this.dependencies.repository.releaseClaim(
            record.identity,
            generation,
            lease,
            signal,
          ),
        ).then(() => {
          record.claimReleased = true;
        }),
      );

    const settled = await Promise.allSettled(operations);
    for (const result of settled)
      if (result.status === 'rejected')
        failures.push({ category: 'mandatory', error: result.reason });

    try {
      await this.retryLateCleanups(record);
    } catch (error) {
      const errors =
        error instanceof LifecycleAggregateError ? error.errors : [error];
      for (const lateError of errors)
        failures.push({ category: 'mandatory', error: lateError });
    }
    return failures;
  }

  private async retireActivation(
    record: SessionRecord,
    generation: number,
    lease: SessionLease,
  ): Promise<void> {
    const socket = record.activationSocket;
    if (!socket || record.activationRetired) return;
    record.publishedSocket = undefined;
    if (this.dependencies.onSocketRetired)
      await this.bounded('socket retirement hook', (signal) =>
        this.dependencies.onSocketRetired!(
          record.identity,
          generation,
          lease,
          socket,
          signal,
        ),
      );
    record.activationRetired = true;
    record.activationSocket = undefined;
  }

  private async runRetryableCleanup(
    record: SessionRecord,
    operation: () => Promise<void>,
  ): Promise<void> {
    const task: RetryableCleanup = {
      run: async () => {
        await operation();
        record.lateCleanups?.delete(task);
      },
    };
    (record.lateCleanups ??= new Set()).add(task);
    await task.run();
  }

  private async retryLateCleanups(record: SessionRecord): Promise<void> {
    if (!record.lateCleanups?.size) return;
    const settled = await Promise.allSettled(
      [...record.lateCleanups].map((cleanup) => cleanup.run()),
    );
    const failures = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length)
      throw new LifecycleAggregateError(
        failures,
        'late resource cleanup failed',
      );
  }

  private hasOwnedResources(record: SessionRecord): boolean {
    return Boolean(
      (!record.mutationLaneRetired && record.mutations) ||
      (!record.socketRetired && record.socket) ||
      (!record.activationRetired && record.activationSocket) ||
      (!record.authReleased && record.auth) ||
      (!record.claimReleased &&
        record.resourceGeneration !== undefined &&
        record.resourceLease) ||
      record.eventTasks?.size ||
      record.lateCleanups?.size,
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async assertRepositoryLease(
    identity: SessionIdentity,
    generation: number,
    lease: SessionLease,
  ): Promise<void> {
    const valid = await this.bounded('lease validation', (signal) =>
      this.dependencies.repository.validateLease(
        identity,
        generation,
        lease,
        signal,
      ),
    );
    if (!valid) throw new StaleOperationError(identity.sessionId);
  }

  private assertIntent(
    sessionId: string,
    record: SessionRecord,
    epoch: number,
  ): void {
    if (this.shuttingDown || record.deleteRequested || record.epoch !== epoch)
      throw new StaleOperationError(sessionId);
  }

  private assertLocalLease(sessionId: string, record: SessionRecord): void {
    if (!this.hasUnexpiredLocalLease(record))
      throw new StaleOperationError(sessionId);
  }

  private waitForReconnect(
    record: SessionRecord,
    epoch: number,
    generation: number,
    lease: SessionLease,
    delayMs: number,
  ): Promise<boolean> {
    this.cancelReconnect(record);
    const scheduler = this.dependencies.scheduler ?? nativeScheduler;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let handle: unknown;
      const finish = (allowed: boolean) => {
        if (settled) return;
        settled = true;
        if (record.reconnectTimer?.handle === handle)
          record.reconnectTimer = undefined;
        record.scheduledOwner = undefined;
        resolve(allowed);
      };
      handle = scheduler.setTimeout(() => {
        const owner = record.scheduledOwner;
        finish(
          !this.shuttingDown &&
            !record.deleteRequested &&
            record.phase === 'reconnecting' &&
            record.epoch === epoch &&
            owner?.generation === generation &&
            owner.lease === lease,
        );
      }, delayMs);
      record.scheduledOwner = { generation, lease };
      record.reconnectTimer = {
        handle,
        cancel: () => {
          scheduler.clearTimeout(handle);
          finish(false);
        },
      };
    });
  }

  private cancelReconnect(record: SessionRecord): void {
    const pending = record.reconnectTimer;
    if (!pending) {
      record.scheduledOwner = undefined;
      return;
    }
    pending.cancel();
    if (record.reconnectTimer === pending) record.reconnectTimer = undefined;
    record.scheduledOwner = undefined;
  }

  private closeRecordGate(
    record: SessionRecord,
    phase: 'deleting' | 'reconnecting',
  ): void {
    this.cancelReconnect(record);
    this.cancelHeartbeat(record);
    for (const controller of record.eventControllers ?? []) controller.abort();
    record.epoch += 1;
    record.lease = undefined;
    record.phase = phase;
  }

  private clearResources(record: SessionRecord): void {
    this.cancelHeartbeat(record);
    record.socket = undefined;
    record.publishedSocket = undefined;
    record.auth = undefined;
    record.mutations = undefined;
    record.resourceGeneration = undefined;
    record.resourceLease = undefined;
    record.mutationLaneRetired = undefined;
    record.socketRetired = undefined;
    record.logoutAttempted = undefined;
    record.authReleased = undefined;
    record.claimReleased = undefined;
    record.lease = undefined;
    record.leaseExpiresAt = undefined;
    record.activationSocket = undefined;
    record.activationRetired = undefined;
  }

  private releaseAuth(
    identity: SessionIdentity,
    auth: CoordinatedAuth | undefined,
    generation: number,
    lease: SessionLease,
  ): Promise<void> {
    if (!auth) return Promise.resolve();
    return this.bounded('auth release', (signal) =>
      auth.release(identity, generation, lease, signal),
    );
  }

  private performLogout(socket: SocketHandle): Promise<void> {
    return this.bounded('socket logout', (signal) =>
      this.dependencies.logout
        ? this.dependencies.logout(socket, signal)
        : socket.logout(signal),
    );
  }

  private now(): number {
    return (this.dependencies.clock ?? Date.now)();
  }

  private leaseDurationMs(): number {
    return this.configuredLeaseDurationMs;
  }

  private hasUnexpiredLocalLease(record: SessionRecord): boolean {
    return (
      record.leaseExpiresAt !== undefined && this.now() < record.leaseExpiresAt
    );
  }

  private earlyEventAdapter(
    record: SessionRecord,
    epoch: number,
    generation: number,
    lease: SessionLease,
  ): EarlyEventAdapter {
    const owns = () =>
      !this.shuttingDown &&
      !record.deleteRequested &&
      record.epoch === epoch &&
      record.resourceGeneration === generation &&
      record.resourceLease === lease &&
      this.hasUnexpiredLocalLease(record) &&
      (record.phase === 'starting' || record.phase === 'active');
    return {
      isOwner: owns,
      publish: (event) => {
        if (!owns()) return Promise.resolve(false);
        const controller = new AbortController();
        (record.eventControllers ??= new Set()).add(controller);
        let rollback: OwnedEventRollback | undefined;
        let rolledBack = false;
        const compensate = async () => {
          if (!rollback || rolledBack) return;
          await this.runRetryableCleanup(record, () =>
            this.bounded('owned event rollback', () => rollback!()),
          );
          rolledBack = true;
        };
        const task = (async () => {
          try {
            const valid = await this.bounded(
              'event ownership validation',
              (signal) =>
                this.dependencies.repository.validateEventOwnership(
                  record.identity,
                  generation,
                  lease,
                  signal,
                ),
              undefined,
              controller.signal,
            );
            if (!valid || !owns()) return false;
            if (!this.dependencies.onOwnedEvent) return owns();
            await this.bounded(
              'owned event hook',
              (signal) =>
                this.dependencies.onOwnedEvent!(
                  record.identity,
                  generation,
                  lease,
                  event,
                  signal,
                  (candidate) => {
                    if (rollback)
                      throw new Error(
                        'owned event rollback already registered',
                      );
                    rollback = candidate;
                  },
                ),
              () => compensate(),
              controller.signal,
            );
            if (!rollback)
              throw new Error('owned event hook must register rollback');
            const stillValid =
              owns() &&
              !controller.signal.aborted &&
              (await this.bounded('event ownership revalidation', (signal) =>
                this.dependencies.repository.validateEventOwnership(
                  record.identity,
                  generation,
                  lease,
                  signal,
                ),
              ));
            if (!stillValid) await compensate();
            return stillValid;
          } catch (caughtError) {
            let error = caughtError;
            try {
              await compensate();
            } catch (rollbackError) {
              (record.eventCleanupFailures ??= []).push(rollbackError);
              error = new LifecycleAggregateError(
                [caughtError, rollbackError],
                'owned event rollback failed',
              );
            }
            if (owns())
              this.fenceEventHookFailure(record, generation, lease, error);
            return false;
          } finally {
            record.eventControllers?.delete(controller);
          }
        })();
        let tracked!: Promise<void>;
        tracked = task
          .then(() => undefined)
          .finally(() => {
            record.eventTasks?.delete(tracked);
          });
        (record.eventTasks ??= new Set()).add(tracked);
        return task;
      },
    };
  }

  private fenceEventHookFailure(
    record: SessionRecord,
    generation: number,
    lease: SessionLease,
    error: unknown,
  ): void {
    if (
      record.resourceGeneration !== generation ||
      record.resourceLease !== lease
    )
      return;
    const wasActive = record.phase === 'active';
    record.eventFailure = error;
    this.closeRecordGate(record, 'reconnecting');
    record.failure = error;
    if (!wasActive) return;
    const retirement = this.enqueue(record, async () => {
      const failures = await this.retireOwnedResources(
        record.identity.sessionId,
        record,
        'event publication failure',
        false,
      );
      record.phase = 'failed';
      if (failures.length)
        record.failure = new LifecycleAggregateError(
          [error, ...failures.map((failure) => failure.error)],
          `session ${record.identity.sessionId} event retirement failed`,
        );
    });
    void retirement.catch((retirementError: unknown) => {
      record.phase = 'failed';
      record.failure = new LifecycleAggregateError(
        [error, retirementError],
        `session ${record.identity.sessionId} event retirement failed`,
      );
    });
  }

  private scheduleHeartbeat(
    record: SessionRecord,
    generation: number,
    lease: SessionLease,
  ): void {
    const interval = this.configuredHeartbeatIntervalMs;
    const priorExpiry = record.leaseExpiresAt;
    this.cancelHeartbeat(record);
    const scheduler = this.dependencies.scheduler ?? nativeScheduler;
    record.heartbeatTimer = scheduler.setTimeout(() => {
      record.heartbeatTimer = undefined;
      if (
        this.shuttingDown ||
        record.deleteRequested ||
        record.phase !== 'active' ||
        record.generation !== generation ||
        record.lease !== lease
      )
        return;
      if (priorExpiry === undefined || this.now() >= priorExpiry) {
        this.fenceHeartbeatFailure(
          record,
          generation,
          lease,
          new Error('local lease expired before renewal'),
        );
        return;
      }
      const renewedExpiresAt = this.now() + this.leaseDurationMs();
      void this.bounded('lease renewal', (signal) =>
        this.dependencies.repository.renewLease(
          record.identity,
          generation,
          lease,
          renewedExpiresAt,
          signal,
        ),
      )
        .then((renewed) => {
          if (!renewed) throw new Error('lease renewal failed');
          if (this.now() >= priorExpiry)
            throw new Error('lease renewal settled after local lease expiry');
          if (
            this.shuttingDown ||
            record.deleteRequested ||
            record.phase !== 'active' ||
            record.generation !== generation ||
            record.lease !== lease ||
            record.resourceGeneration !== generation ||
            record.resourceLease !== lease
          )
            return;
          record.leaseExpiresAt = renewedExpiresAt;
          this.scheduleHeartbeat(record, generation, lease);
        })
        .catch((error: unknown) => {
          this.fenceHeartbeatFailure(record, generation, lease, error);
        });
    }, interval);
  }

  private fenceHeartbeatFailure(
    record: SessionRecord,
    generation: number,
    lease: SessionLease,
    error: unknown,
  ): void {
    if (
      this.shuttingDown ||
      record.deleteRequested ||
      record.resourceGeneration !== generation ||
      record.resourceLease !== lease ||
      (record.phase !== 'active' && record.phase !== 'reconnecting')
    )
      return;
    if (record.phase === 'active') this.closeRecordGate(record, 'reconnecting');
    record.failure = error;
    const retirement = this.enqueue(record, async () => {
      const failures = await this.retireOwnedResources(
        record.identity.sessionId,
        record,
        'lease renewal failure',
        false,
      );
      record.phase = 'failed';
      if (failures.length) {
        record.failure = new LifecycleAggregateError(
          [error, ...failures.map((failure) => failure.error)],
          `session ${record.identity.sessionId} lease retirement failed`,
        );
      }
    });
    void retirement.catch((retirementError: unknown) => {
      record.phase = 'failed';
      record.failure = new LifecycleAggregateError(
        [error, retirementError],
        `session ${record.identity.sessionId} lease retirement failed`,
      );
    });
  }

  private cancelHeartbeat(record: SessionRecord): void {
    if (record.heartbeatTimer === undefined) return;
    (this.dependencies.scheduler ?? nativeScheduler).clearTimeout(
      record.heartbeatTimer,
    );
    record.heartbeatTimer = undefined;
  }

  private bounded<T>(
    label: string,
    operation: (signal: AbortSignal) => Promise<T> | T,
    onLateResult?: (value: T) => Promise<void> | void,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    const scheduler = this.dependencies.scheduler ?? nativeScheduler;
    const timeoutMs = this.configuredOperationTimeoutMs;
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else
      parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    let timer: unknown;
    let settled = false;
    let rejectRace!: (error: Error) => void;
    const timeout = new Promise<never>((_, reject) => {
      rejectRace = reject;
      timer = scheduler.setTimeout(() => {
        controller.abort();
        reject(new Error(`${label} timed out`));
      }, timeoutMs);
    });
    this.timers.set(timer, {
      cancel: (error) => {
        if (settled) return;
        controller.abort();
        rejectRace(error);
      },
    });
    let external: Promise<T>;
    try {
      external = Promise.resolve(operation(controller.signal));
    } catch (error) {
      external = Promise.reject(error);
    }
    let raceSettled = false;
    let externalAccepted = false;
    const observedExternal = external;
    if (onLateResult) {
      this.trackLateCleanup(
        external.then(
          async (value) => {
            if (raceSettled && !externalAccepted) await onLateResult(value);
          },
          () => undefined,
        ),
      );
    }
    // Consume any resolution/rejection that arrives after timeout/cancellation.
    void observedExternal.catch(() => undefined);
    return Promise.race([observedExternal, timeout])
      .then((value) => {
        externalAccepted = true;
        return value;
      })
      .finally(() => {
        raceSettled = true;
        settled = true;
        scheduler.clearTimeout(timer);
        this.timers.delete(timer);
        parentSignal?.removeEventListener('abort', abortFromParent);
      });
  }

  private cancelPendingOperations(error: Error): void {
    const scheduler = this.dependencies.scheduler ?? nativeScheduler;
    for (const [timer, entry] of this.timers) {
      scheduler.clearTimeout(timer);
      entry.cancel(error);
    }
    this.timers.clear();
  }

  private trackLateCleanup(cleanup: Promise<void>): void {
    let tracked!: Promise<void>;
    tracked = cleanup
      .catch((error: unknown) => {
        this.lateCleanupFailures.push(error);
      })
      .finally(() => {
        this.lateCleanupPromises.delete(tracked);
      });
    this.lateCleanupPromises.add(tracked);
  }

  private async awaitLateCleanups(): Promise<unknown[]> {
    const failures: unknown[] = [];
    while (this.lateCleanupPromises.size > 0) {
      const pending = [...this.lateCleanupPromises];
      try {
        await this.bounded('late cleanup settlement', () =>
          Promise.all(pending).then(() => undefined),
        );
      } catch (error) {
        failures.push(error);
        break;
      }
    }
    failures.push(...this.lateCleanupFailures.splice(0));
    return failures;
  }

  private enqueue<T>(
    record: SessionRecord,
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = record.tail.then(operation);
    record.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private newLease(_sessionId: string): SessionLease {
    return (this.dependencies.leaseFactory ?? randomUUID)();
  }

  private normalizeIdentity(input: SessionIdentity | string): SessionIdentity {
    const identity =
      typeof input === 'string'
        ? { sessionId: input, tenantId: 'default' }
        : { ...input };
    this.validateIdentityPart('tenantId', identity.tenantId);
    this.validateIdentityPart('sessionId', identity.sessionId);
    return identity;
  }

  private validateIdentityPart(
    label: 'tenantId' | 'sessionId',
    value: unknown,
  ): asserts value is string {
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.includes('\u0000')
    )
      throw new Error(`${label} is an invalid session identity component`);
  }

  private identityKey(identity: SessionIdentity): string {
    return `${identity.tenantId}\u0000${identity.sessionId}`;
  }

  private record(identity: SessionIdentity): SessionRecord {
    const key = this.identityKey(identity);
    let record = this.records.get(key);
    if (!record) {
      record = {
        identity,
        phase: 'idle',
        generation: 0,
        epoch: 0,
        deleteRequested: false,
        tombstoned: false,
        tail: Promise.resolve(),
        retryCount: 0,
      };
      this.records.set(key, record);
    }
    return record;
  }
}
