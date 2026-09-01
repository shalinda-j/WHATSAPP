import {
  AuthStateFactory,
  CoordinatedAuth,
  EarlyEventAdapter,
  LifecycleAggregateError,
  SessionIdentity,
  SessionLease,
  SessionLifecycleCoordinator,
  SessionRepository,
  SocketAuth,
  SocketFactory,
  SocketHandle,
} from '../services/SessionLifecycleCoordinator';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async (turns = 8) => {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
};

const waitForCall = async (mock: jest.Mock) => {
  for (let turn = 0; turn < 100 && mock.mock.calls.length === 0; turn += 1)
    await Promise.resolve();
  expect(mock).toHaveBeenCalled();
};

function manualScheduler() {
  let next = 0;
  const pending = new Map<
    number,
    { callback: () => void; milliseconds: number }
  >();
  return {
    scheduler: {
      setTimeout(callback: () => void, milliseconds: number) {
        next += 1;
        pending.set(next, { callback, milliseconds });
        return next;
      },
      clearTimeout(handle: unknown) {
        pending.delete(handle as number);
      },
    },
    run(milliseconds: number) {
      for (const [handle, entry] of [...pending]) {
        if (entry.milliseconds !== milliseconds) continue;
        pending.delete(handle);
        entry.callback();
      }
    },
    count(milliseconds: number) {
      return [...pending.values()].filter(
        (entry) => entry.milliseconds === milliseconds,
      ).length;
    },
  };
}

function harness(
  overrides: Partial<{
    authFactory: AuthStateFactory;
    socketFactory: SocketFactory;
    repository: SessionRepository;
    logout: (socket: SocketHandle, signal: AbortSignal) => Promise<void>;
    operationTimeoutMs: number;
    leaseFactory: () => SessionLease;
    scheduler: {
      setTimeout(callback: () => void, milliseconds: number): unknown;
      clearTimeout(handle: unknown): void;
    };
    clock: () => number;
    leaseDurationMs: number;
    heartbeatIntervalMs: number;
    conflictRetryMs: number;
    transientRetryMs: number;
    maxTransientRetries: number;
    onSocketActivated: (
      identity: SessionIdentity,
      generation: number,
      lease: SessionLease,
      socket: SocketHandle,
      signal: AbortSignal,
    ) => void | Promise<void>;
    onSocketRetired: (
      identity: SessionIdentity,
      generation: number,
      lease: SessionLease,
      socket: SocketHandle,
      signal: AbortSignal,
    ) => void | Promise<void>;
    onOwnedEvent: (
      identity: SessionIdentity,
      generation: number,
      lease: SessionLease,
      event: unknown,
      signal: AbortSignal,
      registerRollback: (rollback: () => void | Promise<void>) => void,
    ) => void | Promise<void>;
  }> = {},
) {
  const events: string[] = [];
  const auth: CoordinatedAuth = {
    state: {},
    saveCredentials: jest.fn().mockResolvedValue(undefined),
    writeKeys: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const socket: SocketHandle = {
    logout: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
  };
  let generation = 0;
  const live = new Map<string, { generation: number; lease: SessionLease }>();
  const key = (identity: SessionIdentity) =>
    `${identity.tenantId}:${identity.sessionId}`;
  const repository: SessionRepository = overrides.repository ?? {
    claimGeneration: jest.fn(async (identity, lease) => {
      generation += 1;
      live.set(key(identity), { generation, lease });
      return generation;
    }),
    recreateAndClaim: jest.fn(async (identity, lease) => {
      generation += 1;
      live.set(key(identity), { generation, lease });
      return generation;
    }),
    validateLease: jest.fn(async (identity, expectedGeneration, lease) => {
      const value = live.get(key(identity));
      return value?.generation === expectedGeneration && value.lease === lease;
    }),
    renewLease: jest.fn(async (identity, expectedGeneration, lease) => {
      const value = live.get(key(identity));
      return value?.generation === expectedGeneration && value.lease === lease;
    }),
    validateEventOwnership: jest.fn(
      async (identity, expectedGeneration, lease) => {
        const value = live.get(key(identity));
        return (
          value?.generation === expectedGeneration && value.lease === lease
        );
      },
    ),
    persistTombstone: jest.fn(async (identity) => {
      live.delete(key(identity));
      events.push('tombstone');
    }),
    releaseClaim: jest.fn(async (identity, expectedGeneration, lease) => {
      const value = live.get(key(identity));
      if (value?.generation === expectedGeneration && value.lease === lease)
        live.delete(key(identity));
    }),
  };
  const authFactory: AuthStateFactory = overrides.authFactory ?? {
    create: jest.fn().mockResolvedValue(auth),
    clear: jest.fn(async () => {
      events.push('clear');
    }),
  };
  const socketFactory: SocketFactory = overrides.socketFactory ?? {
    create: jest.fn().mockResolvedValue(socket),
  };
  const coordinator = new SessionLifecycleCoordinator({
    authFactory,
    socketFactory,
    repository,
    operationTimeoutMs: overrides.operationTimeoutMs ?? 100,
    ...(overrides.logout ? { logout: overrides.logout } : {}),
    ...(overrides.leaseFactory ? { leaseFactory: overrides.leaseFactory } : {}),
    ...(overrides.scheduler ? { scheduler: overrides.scheduler } : {}),
    ...(overrides.clock ? { clock: overrides.clock } : {}),
    ...(overrides.leaseDurationMs
      ? { leaseDurationMs: overrides.leaseDurationMs }
      : {}),
    ...(overrides.heartbeatIntervalMs
      ? { heartbeatIntervalMs: overrides.heartbeatIntervalMs }
      : {}),
    ...(overrides.conflictRetryMs !== undefined
      ? { conflictRetryMs: overrides.conflictRetryMs }
      : {}),
    ...(overrides.transientRetryMs !== undefined
      ? { transientRetryMs: overrides.transientRetryMs }
      : {}),
    ...(overrides.maxTransientRetries !== undefined
      ? { maxTransientRetries: overrides.maxTransientRetries }
      : {}),
    ...(overrides.onSocketActivated
      ? { onSocketActivated: overrides.onSocketActivated }
      : {}),
    ...(overrides.onSocketRetired
      ? { onSocketRetired: overrides.onSocketRetired }
      : {}),
    ...(overrides.onOwnedEvent ? { onOwnedEvent: overrides.onOwnedEvent } : {}),
  });
  return {
    coordinator,
    auth,
    socket,
    authFactory,
    socketFactory,
    repository,
    events,
  };
}

function activeIdentity(
  coordinator: SessionLifecycleCoordinator,
  id: SessionIdentity | string = 'alpha',
) {
  const snapshot = coordinator.getSnapshot(id);
  if (!snapshot?.lease) throw new Error('expected active lease');
  return { generation: snapshot.generation, lease: snapshot.lease };
}

describe('SessionLifecycleCoordinator fail-closed lifecycle', () => {
  it('uses cryptographically shaped UUID leases by default and supports an injected lease factory', async () => {
    const defaults = harness();
    await defaults.coordinator.start('alpha');
    expect(activeIdentity(defaults.coordinator).lease).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const injected = harness({ leaseFactory: jest.fn(() => 'secure-lease') });
    await injected.coordinator.start('alpha');
    expect(activeIdentity(injected.coordinator).lease).toBe('secure-lease');
  });

  it('coalesces simultaneous starts and validates the claimed lease after auth and socket creation', async () => {
    const authReady = deferred<CoordinatedAuth>();
    const base = harness();
    const h = harness({
      authFactory: {
        create: jest.fn().mockReturnValue(authReady.promise),
        clear: jest.fn().mockResolvedValue(undefined),
      },
      socketFactory: base.socketFactory,
    });

    const first = h.coordinator.start('alpha');
    const second = h.coordinator.start('alpha');
    expect(first).toBe(second);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'starting',
    });
    authReady.resolve(base.auth);

    await expect(first).resolves.toBe(base.socket);
    expect(h.repository.validateLease).toHaveBeenCalledTimes(3);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'active',
    });
  });

  it('cold delete persists a tombstone and definitively clears auth with its delete lease', async () => {
    const h = harness();
    await h.coordinator.delete('cold');

    expect(h.repository.persistTombstone).toHaveBeenCalledWith(
      { sessionId: 'cold', tenantId: 'default' },
      expect.any(String),
      expect.any(AbortSignal),
    );
    const lease = (h.repository.persistTombstone as jest.Mock).mock.calls[0][1];
    expect(h.authFactory.clear).toHaveBeenCalledWith(
      { sessionId: 'cold', tenantId: 'default' },
      undefined,
      lease,
      expect.any(AbortSignal),
    );
    expect(h.coordinator.getSnapshot('cold')).toMatchObject({
      phase: 'deleted',
    });
  });

  it('cold recreate clears persisted auth before claiming and starting', async () => {
    const h = harness();
    (h.authFactory.clear as jest.Mock).mockImplementation(async () => {
      h.events.push('clear');
    });
    (h.repository.recreateAndClaim as jest.Mock).mockImplementation(
      async (id: string, lease: SessionLease) => {
        h.events.push('claim');
        return 1;
      },
    );
    (h.repository.validateLease as jest.Mock).mockResolvedValue(true);
    (h.socketFactory.create as jest.Mock).mockImplementation(async () => {
      h.events.push('socket');
      return h.socket;
    });

    await h.coordinator.createOrRecreate('cold');
    expect(h.events).toEqual(['tombstone', 'clear', 'claim', 'socket']);
  });

  it('a newer delete intent prevents a recreate blocked in definitive clear from reopening the session', async () => {
    const firstClear = deferred<void>();
    const h = harness();
    (h.authFactory.clear as jest.Mock)
      .mockReturnValueOnce(firstClear.promise)
      .mockResolvedValueOnce(undefined);

    const recreating = h.coordinator.createOrRecreate('alpha');
    await waitForCall(h.authFactory.clear as jest.Mock);
    const deleting = h.coordinator.delete('alpha');
    firstClear.resolve();

    await expect(recreating).rejects.toThrow(/stale|cancel/i);
    await deleting;
    expect(h.socketFactory.create).not.toHaveBeenCalled();
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'deleted',
    });
  });

  it('requires active phase plus exact generation and opaque lease for callback acceptance', async () => {
    const h = harness();
    await h.coordinator.start('alpha');
    const current = activeIdentity(h.coordinator);

    expect(
      h.coordinator.isCurrent('alpha', current.generation, current.lease),
    ).toBe(true);
    expect(h.coordinator.isCurrent('alpha', current.generation, 'wrong')).toBe(
      false,
    );
    expect(
      h.coordinator.isCurrent('alpha', current.generation + 1, current.lease),
    ).toBe(false);
  });

  it('invalidates callback acceptance synchronously on reconnect, delete, and shutdown', async () => {
    const reconnect = harness();
    await reconnect.coordinator.start('alpha');
    const a = activeIdentity(reconnect.coordinator);
    const reconnecting = reconnect.coordinator.onConnectionUpdate(
      'alpha',
      a.generation,
      a.lease,
      {
        statusCode: 515,
      },
    );
    expect(
      reconnect.coordinator.isCurrent('alpha', a.generation, a.lease),
    ).toBe(false);
    await reconnecting;

    const deleting = harness();
    await deleting.coordinator.start('alpha');
    const b = activeIdentity(deleting.coordinator);
    const deletion = deleting.coordinator.delete('alpha');
    expect(deleting.coordinator.isCurrent('alpha', b.generation, b.lease)).toBe(
      false,
    );
    await deletion;

    const stopping = harness();
    await stopping.coordinator.start('alpha');
    const c = activeIdentity(stopping.coordinator);
    const shutdown = stopping.coordinator.shutdown();
    expect(stopping.coordinator.getSocket('alpha')).toBeUndefined();
    expect(stopping.coordinator.isCurrent('alpha', c.generation, c.lease)).toBe(
      false,
    );
    await shutdown;
  });

  it('passes generation and lease through every auth mutation and absorbs mutations submitted after seal', async () => {
    let socketAuth!: SocketAuth;
    const h = harness({
      socketFactory: {
        create: jest.fn(async (input) => {
          socketAuth = input.auth;
          return h.socket;
        }),
      },
    });
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);

    await socketAuth.saveCredentials();
    await socketAuth.writeKeys({ key: 1 });
    expect(h.auth.saveCredentials).toHaveBeenCalledWith(
      { sessionId: 'alpha', tenantId: 'default' },
      identity.generation,
      identity.lease,
      expect.any(AbortSignal),
    );
    expect(h.auth.writeKeys).toHaveBeenCalledWith(
      { sessionId: 'alpha', tenantId: 'default' },
      { key: 1 },
      identity.generation,
      identity.lease,
      expect.any(AbortSignal),
    );

    const deletion = h.coordinator.delete('alpha');
    await expect(socketAuth.writeKeys({ late: true })).resolves.toBeUndefined();
    await deletion;
  });

  it('keeps undefined mutation rejection sticky as a normalized drain failure', async () => {
    let socketAuth!: SocketAuth;
    const h = harness({
      socketFactory: {
        create: jest.fn(async (input) => {
          socketAuth = input.auth;
          return h.socket;
        }),
      },
    });
    (h.auth.writeKeys as jest.Mock).mockRejectedValue(undefined);
    await h.coordinator.start('alpha');
    await expect(
      socketAuth.writeKeys({ broken: true }),
    ).resolves.toBeUndefined();
    const identity = activeIdentity(h.coordinator);

    await expect(
      h.coordinator.onConnectionUpdate(
        'alpha',
        identity.generation,
        identity.lease,
        { statusCode: 515 },
      ),
    ).rejects.toThrow(/mutation.*failed/i);
    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      /durability|mutation|blocked/i,
    );
    expect(h.repository.claimGeneration).toHaveBeenCalledTimes(1);
  });

  it('coalesces start during reconnect with the replacement instead of creating a second socket', async () => {
    const replacement = deferred<SocketHandle>();
    const nextSocket: SocketHandle = { logout: jest.fn(), end: jest.fn() };
    const h = harness({
      socketFactory: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ logout: jest.fn(), end: jest.fn() })
          .mockReturnValueOnce(replacement.promise),
      },
    });
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);
    const reconnecting = h.coordinator.onConnectionUpdate(
      'alpha',
      identity.generation,
      identity.lease,
      { statusCode: 515 },
    );
    const starting = h.coordinator.start('alpha');
    await flush();
    replacement.resolve(nextSocket);

    await reconnecting;
    await expect(starting).resolves.toBe(nextSocket);
    expect(h.socketFactory.create).toHaveBeenCalledTimes(2);
  });

  it('rejects a reconnect waiter when shutdown revokes the replacement', async () => {
    const finalSave = deferred<void>();
    const h = harness();
    (h.auth.saveCredentials as jest.Mock).mockReturnValue(finalSave.promise);
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);
    const reconnecting = h.coordinator.onConnectionUpdate(
      'alpha',
      identity.generation,
      identity.lease,
      { statusCode: 515 },
    );
    const startingDuringReconnect = h.coordinator.start('alpha');
    await waitForCall(h.auth.saveCredentials as jest.Mock);
    const shutdown = h.coordinator.shutdown();
    finalSave.resolve();

    await reconnecting;
    await expect(startingDuringReconnect).rejects.toThrow(/stale|cancel/i);
    await shutdown;
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it('treats 515 before, during, and after delete as a no-op', async () => {
    const clear = deferred<void>();
    const h = harness();
    (h.authFactory.clear as jest.Mock).mockReturnValue(clear.promise);
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);
    const deleting = h.coordinator.delete('alpha');

    await expect(
      h.coordinator.onConnectionUpdate(
        'alpha',
        identity.generation,
        identity.lease,
        {
          statusCode: 515,
        },
      ),
    ).resolves.toBeUndefined();
    clear.resolve();
    await deleting;
    await expect(
      h.coordinator.onConnectionUpdate(
        'alpha',
        identity.generation,
        identity.lease,
        {
          statusCode: 515,
        },
      ),
    ).resolves.toBeUndefined();
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it('a delete queued with 515 wins and prevents replacement adoption', async () => {
    const end = deferred<void>();
    const oldSocket: SocketHandle = {
      logout: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockReturnValue(end.promise),
    };
    const h = harness({
      socketFactory: { create: jest.fn().mockResolvedValue(oldSocket) },
    });
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);
    const reconnecting = h.coordinator.onConnectionUpdate(
      'alpha',
      identity.generation,
      identity.lease,
      { statusCode: 515 },
    );
    const startingDuringReconnect = h.coordinator.start('alpha');
    const deleting = h.coordinator.delete('alpha');
    end.resolve();

    await reconnecting;
    await expect(startingDuringReconnect).rejects.toThrow(
      /deleted|revoked|stale|cancel/i,
    );
    await deleting;
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'deleted',
    });
  });

  it('socket end rejection fences the old generation and blocks reconnect replacement', async () => {
    const h = harness({
      socketFactory: {
        create: jest.fn().mockResolvedValue({
          logout: jest.fn(),
          end: jest.fn().mockRejectedValue(new Error('end failed')),
        }),
      },
    });
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);

    await expect(
      h.coordinator.onConnectionUpdate(
        'alpha',
        identity.generation,
        identity.lease,
        {
          statusCode: 515,
        },
      ),
    ).rejects.toThrow('end failed');
    await flush();
    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      /retire|cleanup|end/i,
    );
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
    expect(
      h.coordinator.isCurrent('alpha', identity.generation, identity.lease),
    ).toBe(false);
  });

  it('offers a void connection-update adapter that consumes listener-facing failures', async () => {
    const h = harness({
      socketFactory: {
        create: jest.fn().mockResolvedValue({
          logout: jest.fn(),
          end: jest.fn().mockRejectedValue(new Error('listener end failed')),
        }),
      },
    });
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);

    expect(
      h.coordinator.handleConnectionUpdate(
        'alpha',
        identity.generation,
        identity.lease,
        { statusCode: 515 },
      ),
    ).toBeUndefined();
    await flush(30);
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it.each(['auth', 'socket'] as const)(
    '%s creation failure releases claimed resources before a retry',
    async (failurePoint) => {
      const h = harness();
      if (failurePoint === 'auth')
        (h.authFactory.create as jest.Mock).mockRejectedValueOnce(
          new Error('auth failed'),
        );
      else
        (h.socketFactory.create as jest.Mock).mockRejectedValueOnce(
          new Error('socket failed'),
        );

      await expect(h.coordinator.start('alpha')).rejects.toThrow(
        `${failurePoint} failed`,
      );
      expect(h.repository.releaseClaim).toHaveBeenCalledTimes(1);
      if (failurePoint === 'socket')
        expect(h.auth.release).toHaveBeenCalledTimes(1);
      await expect(h.coordinator.start('alpha')).resolves.toBe(h.socket);
    },
  );

  it('does not let a retry overwrite resources whose failed-start cleanup failed', async () => {
    const h = harness();
    (h.socketFactory.create as jest.Mock).mockRejectedValueOnce(
      new Error('socket failed'),
    );
    (h.auth.release as jest.Mock).mockRejectedValueOnce(
      new Error('release failed'),
    );

    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      'cleanup failed',
    );
    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      /cleanup|retire/i,
    );
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it('seals and drains socket-creation mutations before releasing auth and claim after rejection', async () => {
    const write = deferred<void>();
    const events: string[] = [];
    const auth: CoordinatedAuth = {
      state: {},
      saveCredentials: jest.fn(async () => {
        events.push('final-save');
      }),
      writeKeys: jest.fn(async () => {
        events.push('write-start');
        await write.promise;
        events.push('write-end');
      }),
      release: jest.fn(async () => {
        events.push('auth-release');
      }),
    };
    const base = harness();
    (base.repository.releaseClaim as jest.Mock).mockImplementation(async () => {
      events.push('claim-release');
    });
    const h = harness({
      authFactory: {
        create: jest.fn().mockResolvedValue(auth),
        clear: jest.fn().mockResolvedValue(undefined),
      },
      repository: base.repository,
      socketFactory: {
        create: jest.fn(async ({ auth: socketAuth }) => {
          void socketAuth.writeKeys({ pending: true });
          await flush();
          throw new Error('socket failed');
        }),
      },
    });

    const starting = h.coordinator.start('alpha');
    await waitForCall(auth.writeKeys as jest.Mock);
    await flush();
    expect(events).toEqual(['write-start']);
    expect(auth.release).not.toHaveBeenCalled();
    expect(base.repository.releaseClaim).not.toHaveBeenCalled();
    write.resolve();

    await expect(starting).rejects.toThrow('socket failed');
    expect(events).toEqual([
      'write-start',
      'write-end',
      'final-save',
      'auth-release',
      'claim-release',
    ]);
  });

  it('blocks retry when a failed socket creation also has a failed auth mutation drain', async () => {
    const h = harness({
      socketFactory: {
        create: jest.fn(async ({ auth: socketAuth }) => {
          void socketAuth.writeKeys({ broken: true });
          await flush();
          throw new Error('socket failed');
        }),
      },
    });
    (h.auth.writeKeys as jest.Mock).mockRejectedValue(
      new Error('key durability failed'),
    );

    await expect(h.coordinator.start('alpha')).rejects.toThrow();
    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      /durability|mutation|blocked/i,
    );
    expect(h.repository.claimGeneration).toHaveBeenCalledTimes(1);
  });

  it('ends a socket that resolves after its bounded creation already timed out', async () => {
    const socketReady = deferred<SocketHandle>();
    const lateSocket: SocketHandle = { logout: jest.fn(), end: jest.fn() };
    const h = harness({
      operationTimeoutMs: 5,
      socketFactory: { create: jest.fn().mockReturnValue(socketReady.promise) },
    });

    await expect(h.coordinator.start('alpha')).rejects.toThrow('timed out');
    socketReady.resolve(lateSocket);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lateSocket.end).toHaveBeenCalledWith(
      'late socket creation',
      expect.any(AbortSignal),
    );
  });

  it('revalidates intent after auth creation and drains stale auth during delete', async () => {
    const authReady = deferred<CoordinatedAuth>();
    const h = harness();
    (h.authFactory.create as jest.Mock).mockReturnValueOnce(authReady.promise);
    const starting = h.coordinator.start('alpha');
    await waitForCall(h.authFactory.create as jest.Mock);
    const deleting = h.coordinator.delete('alpha');
    authReady.resolve(h.auth);

    await expect(starting).rejects.toThrow(/stale|cancel/i);
    await deleting;
    expect(h.auth.release).toHaveBeenCalled();
    expect(h.socketFactory.create).not.toHaveBeenCalled();
  });

  it('revalidates intent after socket creation and ends a stale partial socket', async () => {
    const socketReady = deferred<SocketHandle>();
    const staleSocket: SocketHandle = { logout: jest.fn(), end: jest.fn() };
    const h = harness({
      socketFactory: { create: jest.fn().mockReturnValue(socketReady.promise) },
    });
    const starting = h.coordinator.start('alpha');
    await waitForCall(h.socketFactory.create as jest.Mock);
    const deleting = h.coordinator.delete('alpha');
    socketReady.resolve(staleSocket);

    await expect(starting).rejects.toThrow(/stale|cancel/i);
    await deleting;
    expect(staleSocket.end).toHaveBeenCalled();
    expect(h.auth.release).toHaveBeenCalled();
  });

  it('failed definitive clear retains a tombstone and prevents retry overwrite until recreate clears successfully', async () => {
    const h = harness();
    (h.authFactory.clear as jest.Mock)
      .mockRejectedValueOnce(new Error('clear failed'))
      .mockResolvedValueOnce(undefined);

    await expect(h.coordinator.delete('alpha')).rejects.toThrow('clear failed');
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
    });
    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      /deleted|tombstone/,
    );
    expect(h.repository.claimGeneration).not.toHaveBeenCalled();
    await h.coordinator.createOrRecreate('alpha');
    expect(h.authFactory.clear).toHaveBeenCalledTimes(2);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'active',
    });
  });

  it.each(['socket', 'auth', 'claim'] as const)(
    'retries only unfinished %s retirement after clear failure and never repeats successful cleanup',
    async (failedStep) => {
      const h = harness();
      const end = h.socket.end as jest.Mock;
      const release = h.auth.release as jest.Mock;
      const releaseClaim = h.repository.releaseClaim as jest.Mock;
      const selected =
        failedStep === 'socket'
          ? end
          : failedStep === 'auth'
            ? release
            : releaseClaim;
      selected.mockRejectedValueOnce(
        new Error(`${failedStep} retirement failed`),
      );
      (h.authFactory.clear as jest.Mock)
        .mockRejectedValueOnce(new Error('clear failed'))
        .mockResolvedValueOnce(undefined);
      await h.coordinator.start('alpha');

      await expect(h.coordinator.delete('alpha')).rejects.toThrow(
        'clear failed',
      );
      await expect(h.coordinator.createOrRecreate('alpha')).resolves.toBe(
        h.socket,
      );

      expect(selected).toHaveBeenCalledTimes(2);
      for (const operation of [end, release, releaseClaim]) {
        if (operation !== selected) expect(operation).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('retains and retries a socket whose mandatory end failed after definitive clear', async () => {
    const socket: SocketHandle = {
      logout: jest.fn().mockRejectedValue(new Error('logout failed')),
      end: jest
        .fn()
        .mockRejectedValueOnce(new Error('end failed'))
        .mockResolvedValueOnce(undefined),
    };
    const h = harness({
      socketFactory: { create: jest.fn().mockResolvedValue(socket) },
    });
    (h.auth.saveCredentials as jest.Mock).mockRejectedValue(
      new Error('save failed'),
    );
    await h.coordinator.start('alpha');

    const failure = await h.coordinator.delete('alpha').catch((error) => error);
    expect(failure).toBeInstanceOf(LifecycleAggregateError);
    expect((failure as LifecycleAggregateError).errors).toContainEqual(
      expect.objectContaining({ message: 'end failed' }),
    );
    expect(h.coordinator.getSocket('alpha')).toBeUndefined();
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
    });

    await expect(h.coordinator.shutdown()).resolves.toBeUndefined();
    expect(socket.end).toHaveBeenCalledTimes(2);
    expect(h.auth.release).toHaveBeenCalledTimes(1);
    expect(h.repository.releaseClaim).toHaveBeenCalledTimes(1);
    expect(h.authFactory.clear).toHaveBeenCalledTimes(1);
  });

  it('bounds injected logout and consumes its late rejection', async () => {
    const logout = deferred<void>();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    const h = harness({
      logout: jest.fn().mockReturnValue(logout.promise),
      operationTimeoutMs: 5,
    });
    await h.coordinator.start('alpha');
    await h.coordinator.delete('alpha');
    logout.reject(new Error('late logout'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', listener);

    expect(unhandled).toEqual([]);
    expect(h.socket.end).toHaveBeenCalled();
    expect(h.authFactory.clear).toHaveBeenCalled();
  });

  it('passes AbortSignal to the default socket logout and socket end operations', async () => {
    const h = harness();
    await h.coordinator.start('alpha');
    await h.coordinator.delete('alpha');

    expect(h.socket.logout).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(h.socket.end).toHaveBeenCalledWith(
      'delete',
      expect.any(AbortSignal),
    );
  });

  it.each(['claim', 'auth', 'socket'] as const)(
    'shutdown during %s closes all gates, waits the lane, and retires late resources',
    async (point) => {
      const wait = deferred<unknown>();
      const lateSocket: SocketHandle = { logout: jest.fn(), end: jest.fn() };
      const h = harness({ operationTimeoutMs: 10 });
      if (point === 'claim')
        (h.repository.claimGeneration as jest.Mock).mockReturnValueOnce(
          wait.promise,
        );
      if (point === 'auth')
        (h.authFactory.create as jest.Mock).mockReturnValueOnce(wait.promise);
      if (point === 'socket')
        (h.socketFactory.create as jest.Mock).mockReturnValueOnce(wait.promise);

      const starting = h.coordinator.start('alpha');
      if (point === 'claim')
        await waitForCall(h.repository.claimGeneration as jest.Mock);
      if (point === 'auth')
        await waitForCall(h.authFactory.create as jest.Mock);
      if (point === 'socket')
        await waitForCall(h.socketFactory.create as jest.Mock);
      const shutdown = h.coordinator.shutdown();
      await expect(h.coordinator.start('later')).rejects.toThrow('shut down');
      await expect(
        h.coordinator.onConnectionUpdate('alpha', 1, 'stale', {
          statusCode: 515,
        }),
      ).resolves.toBeUndefined();
      if (point === 'claim') wait.resolve(1);
      if (point === 'auth') wait.resolve(h.auth);
      if (point === 'socket') wait.resolve(lateSocket);
      await expect(starting).rejects.toThrow(/stale|cancel/i);
      await shutdown;
      if (point === 'socket') expect(lateSocket.end).toHaveBeenCalled();
      expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
        phase: 'stopped',
      });
    },
  );

  it('a callback submitted after shutdown is absorbed without creating work', async () => {
    const h = harness();
    await h.coordinator.start('alpha');
    const identity = activeIdentity(h.coordinator);
    await h.coordinator.shutdown();

    await expect(
      h.coordinator.onConnectionUpdate(
        'alpha',
        identity.generation,
        identity.lease,
        {
          statusCode: 515,
        },
      ),
    ).resolves.toBeUndefined();
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it('shutdown attempts every retirement and reports aggregate failures afterward', async () => {
    const h = harness({
      socketFactory: {
        create: jest.fn(async ({ identity }) => ({
          logout: jest.fn(),
          end: jest
            .fn()
            .mockRejectedValue(new Error(`end ${identity.sessionId}`)),
        })),
      },
    });
    await Promise.all([
      h.coordinator.start('alpha'),
      h.coordinator.start('beta'),
    ]);

    const failure = await h.coordinator
      .shutdown()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LifecycleAggregateError);
    expect((failure as LifecycleAggregateError).errors).toHaveLength(2);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'stopped',
    });
    expect(h.coordinator.getSnapshot('beta')).toMatchObject({
      phase: 'stopped',
    });
  });

  it('waits for late socket cleanup after shutdown starts and aggregates its rejection', async () => {
    const socketReady = deferred<SocketHandle>();
    const lateSocket: SocketHandle = {
      logout: jest.fn(),
      end: jest.fn().mockRejectedValue(new Error('late end failed')),
    };
    const h = harness({
      operationTimeoutMs: 5,
      socketFactory: { create: jest.fn().mockReturnValue(socketReady.promise) },
    });
    await expect(h.coordinator.start('alpha')).rejects.toThrow('timed out');

    let shutdownSettled = false;
    const shutdown = h.coordinator.shutdown().finally(() => {
      shutdownSettled = true;
    });
    await flush();
    expect(shutdownSettled).toBe(false);
    socketReady.resolve(lateSocket);

    const failure = await shutdown.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LifecycleAggregateError);
    expect((failure as LifecycleAggregateError).errors).toContainEqual(
      expect.objectContaining({ message: 'late end failed' }),
    );
  });

  it('fires one delayed conflict replacement and coalesces duplicate conflict events', async () => {
    const clock = manualScheduler();
    const identity = { sessionId: 'alpha', tenantId: 'tenant-a' };
    const h = harness({
      scheduler: clock.scheduler,
      conflictRetryMs: 50,
      operationTimeoutMs: 1_000,
    });
    await h.coordinator.start(identity);
    const owner = activeIdentity(h.coordinator, identity);

    const first = h.coordinator.disconnect(
      identity,
      owner.generation,
      owner.lease,
      { reason: 'conflict' },
    );
    const duplicate = h.coordinator.disconnect(
      identity,
      owner.generation,
      owner.lease,
      { reason: 'conflict' },
    );
    await flush(30);

    expect(clock.count(50)).toBe(1);
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
    clock.run(50);
    await Promise.all([first, duplicate]);

    expect(h.socketFactory.create).toHaveBeenCalledTimes(2);
    expect(h.coordinator.getSnapshot(identity)).toMatchObject({
      identity,
      phase: 'active',
      generation: owner.generation + 1,
    });
  });

  it('a fresh recreate cancels a stale conflict timer without an extra replacement', async () => {
    const clock = manualScheduler();
    const h = harness({
      scheduler: clock.scheduler,
      conflictRetryMs: 50,
      operationTimeoutMs: 1_000,
    });
    await h.coordinator.start('alpha');
    const owner = activeIdentity(h.coordinator);
    const conflict = h.coordinator.disconnect(
      'alpha',
      owner.generation,
      owner.lease,
      { reason: 'conflict' },
    );
    await flush(30);
    expect(clock.count(50)).toBe(1);

    const recreated = h.coordinator.createOrRecreate('alpha');
    expect(clock.count(50)).toBe(0);
    await conflict;
    await recreated;
    clock.run(50);
    await flush(20);

    expect(h.socketFactory.create).toHaveBeenCalledTimes(2);
    expect(h.repository.recreateAndClaim).toHaveBeenCalledTimes(1);
  });

  it('owns bounded transient retries and terminally stops without clearing auth', async () => {
    const clock = manualScheduler();
    const h = harness({
      scheduler: clock.scheduler,
      transientRetryMs: 25,
      maxTransientRetries: 2,
      operationTimeoutMs: 1_000,
    });
    await h.coordinator.start('alpha');

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const owner = activeIdentity(h.coordinator);
      const disconnecting = h.coordinator.disconnect(
        'alpha',
        owner.generation,
        owner.lease,
        { reason: 'transient' },
      );
      await flush(30);
      expect(clock.count(25)).toBe(1);
      expect(h.socketFactory.create).toHaveBeenCalledTimes(attempt);
      clock.run(25);
      await disconnecting;
      expect(h.socketFactory.create).toHaveBeenCalledTimes(attempt + 1);
    }

    const finalOwner = activeIdentity(h.coordinator);
    await h.coordinator.disconnect(
      'alpha',
      finalOwner.generation,
      finalOwner.lease,
      { reason: 'transient' },
    );

    expect(clock.count(25)).toBe(0);
    expect(h.socketFactory.create).toHaveBeenCalledTimes(3);
    expect(h.authFactory.clear).not.toHaveBeenCalled();
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'stopped',
      hasSocket: false,
    });
  });

  it('delays conflict reconnects and delete synchronously cancels the generation-bound retry', async () => {
    const clock = manualScheduler();
    const identity = { sessionId: 'alpha', tenantId: 'tenant-a' };
    const h = harness({
      scheduler: clock.scheduler,
      conflictRetryMs: 50,
      operationTimeoutMs: 1_000,
    });
    await h.coordinator.start(identity);
    const owner = activeIdentity(h.coordinator, identity);

    const disconnecting = h.coordinator.disconnect(
      identity,
      owner.generation,
      owner.lease,
      { reason: 'conflict' },
    );
    await flush(30);
    expect(clock.count(50)).toBe(1);
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);

    const deleting = h.coordinator.delete(identity);
    expect(clock.count(50)).toBe(0);
    await disconnecting;
    await deleting;
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it('persists logged-out deletion and creates one fresh scoped QR generation', async () => {
    const identity = { sessionId: 'alpha', tenantId: 'tenant-a' };
    const h = harness();
    await h.coordinator.start(identity);
    const owner = activeIdentity(h.coordinator, identity);

    await h.coordinator.disconnect(identity, owner.generation, owner.lease, {
      reason: 'logged-out',
    });

    expect(h.repository.persistTombstone).toHaveBeenCalledTimes(1);
    expect(h.authFactory.clear).toHaveBeenCalledTimes(1);
    expect(h.repository.recreateAndClaim).toHaveBeenCalledTimes(1);
    expect(h.repository.recreateAndClaim).toHaveBeenCalledWith(
      identity,
      expect.any(String),
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(h.socketFactory.create).toHaveBeenCalledTimes(2);
    expect(h.coordinator.getSnapshot(identity)).toMatchObject({
      identity,
      phase: 'active',
      generation: owner.generation + 1,
    });
  });

  it('a delete arriving during logged-out clear wins over fresh QR creation', async () => {
    const clear = deferred<void>();
    const h = harness();
    (h.authFactory.clear as jest.Mock)
      .mockReturnValueOnce(clear.promise)
      .mockResolvedValueOnce(undefined);
    await h.coordinator.start('alpha');
    const owner = activeIdentity(h.coordinator);

    const loggedOut = h.coordinator.disconnect(
      'alpha',
      owner.generation,
      owner.lease,
      { reason: 'logged-out' },
    );
    await waitForCall(h.authFactory.clear as jest.Mock);
    const deleting = h.coordinator.delete('alpha');
    clear.resolve();

    await expect(loggedOut).rejects.toThrow(/stale|cancel/i);
    await deleting;
    expect(h.repository.recreateAndClaim).not.toHaveBeenCalled();
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'deleted',
    });
  });

  it('shutdown arriving during logged-out clear prevents fresh QR creation', async () => {
    const clear = deferred<void>();
    const h = harness();
    (h.authFactory.clear as jest.Mock).mockReturnValue(clear.promise);
    await h.coordinator.start('alpha');
    const owner = activeIdentity(h.coordinator);

    const loggedOut = h.coordinator.disconnect(
      'alpha',
      owner.generation,
      owner.lease,
      { reason: 'logged-out' },
    );
    await waitForCall(h.authFactory.clear as jest.Mock);
    const shutdown = h.coordinator.shutdown();
    clear.resolve();

    await expect(loggedOut).rejects.toThrow(/stale|cancel/i);
    await shutdown;
    expect(h.repository.recreateAndClaim).not.toHaveBeenCalled();
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'stopped',
    });
  });

  it('renews the exact heartbeat lease with an advanced expiry and reschedules', async () => {
    const clock = manualScheduler();
    const h = harness({
      scheduler: clock.scheduler,
      clock: () => 5_000,
      leaseDurationMs: 600,
      heartbeatIntervalMs: 10,
      operationTimeoutMs: 100,
    });
    await h.coordinator.start('alpha');
    const owner = activeIdentity(h.coordinator);

    expect(clock.count(10)).toBe(1);
    clock.run(10);
    await flush(30);

    expect(h.repository.renewLease).toHaveBeenCalledWith(
      { sessionId: 'alpha', tenantId: 'default' },
      owner.generation,
      owner.lease,
      5_600,
      expect.any(AbortSignal),
    );
    expect(clock.count(10)).toBe(1);
  });

  it('derives a safe heartbeat and synchronously fences ownership at the exact local lease expiry', async () => {
    const clock = manualScheduler();
    let now = 1_000;
    const h = harness({
      scheduler: clock.scheduler,
      clock: () => now,
      leaseDurationMs: 500,
      operationTimeoutMs: 100,
    });

    await h.coordinator.start('alpha');
    const owner = activeIdentity(h.coordinator);
    expect(clock.count(200)).toBe(1);
    expect(h.coordinator.getSocket('alpha')).toBe(h.socket);

    now = 1_500;
    expect(
      h.coordinator.isCurrent('alpha', owner.generation, owner.lease),
    ).toBe(false);
    expect(h.coordinator.getSocket('alpha')).toBeUndefined();
  });

  it.each([
    { leaseDurationMs: -1 },
    { leaseDurationMs: 100, operationTimeoutMs: 100 },
    { leaseDurationMs: 100, heartbeatIntervalMs: 100 },
    {
      leaseDurationMs: 100,
      heartbeatIntervalMs: 60,
      operationTimeoutMs: 40,
    },
  ])('rejects unsafe lease timing configuration %#', (configuration) => {
    expect(() => harness(configuration)).toThrow(/lease|heartbeat|operation/i);
  });

  it('fences and retires the exact published socket once when heartbeat renewal returns false', async () => {
    const clock = manualScheduler();
    const retired = jest.fn();
    const h = harness({
      scheduler: clock.scheduler,
      heartbeatIntervalMs: 10,
      operationTimeoutMs: 1_000,
      onSocketRetired: retired,
    });
    (h.repository.renewLease as jest.Mock).mockResolvedValue(false);
    await h.coordinator.start('alpha');
    const owner = activeIdentity(h.coordinator);

    clock.run(10);
    await flush(50);

    expect(h.coordinator.getSocket('alpha')).toBeUndefined();
    expect(
      h.coordinator.isCurrent('alpha', owner.generation, owner.lease),
    ).toBe(false);
    expect(retired).toHaveBeenCalledTimes(1);
    expect(retired).toHaveBeenCalledWith(
      { sessionId: 'alpha', tenantId: 'default' },
      owner.generation,
      owner.lease,
      h.socket,
      expect.any(AbortSignal),
    );
    expect(h.socket.end).toHaveBeenCalledTimes(1);
    expect(h.auth.release).toHaveBeenCalledTimes(1);
    expect(h.repository.releaseClaim).toHaveBeenCalledTimes(1);
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
    });
  });

  it('consumes heartbeat renewal rejection and deterministically cancels delete and shutdown timers', async () => {
    const rejectedClock = manualScheduler();
    const retired = jest.fn();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    const rejected = harness({
      scheduler: rejectedClock.scheduler,
      heartbeatIntervalMs: 10,
      operationTimeoutMs: 1_000,
      onSocketRetired: retired,
    });
    (rejected.repository.renewLease as jest.Mock).mockRejectedValue(
      new Error('renew rejected'),
    );
    await rejected.coordinator.start('alpha');
    rejectedClock.run(10);
    await flush(50);
    process.off('unhandledRejection', listener);

    expect(unhandled).toEqual([]);
    expect(retired).toHaveBeenCalledTimes(1);
    expect(rejected.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
    });
    expect(rejected.socketFactory.create).toHaveBeenCalledTimes(1);

    for (const action of ['delete', 'shutdown'] as const) {
      const clock = manualScheduler();
      const h = harness({
        scheduler: clock.scheduler,
        heartbeatIntervalMs: 10,
        operationTimeoutMs: 1_000,
      });
      await h.coordinator.start('alpha');
      expect(clock.count(10)).toBe(1);
      await h.coordinator[action]('alpha');
      expect(clock.count(10)).toBe(0);
      clock.run(10);
      await flush(20);
      expect(h.repository.renewLease).not.toHaveBeenCalled();
    }
  });

  it('aborts and rolls back a pending owned-event publication when delete revokes ownership', async () => {
    const publication = deferred<void>();
    const rolledBack = jest.fn().mockResolvedValue(undefined);
    let events!: EarlyEventAdapter;
    let observedSignal!: AbortSignal;
    const hook = jest.fn(async (...args: unknown[]) => {
      observedSignal = args[4] as AbortSignal;
      const registerRollback = args[5] as (
        rollback: () => void | Promise<void>,
      ) => void;
      registerRollback(rolledBack);
      await publication.promise;
    });
    const h = harness({
      onOwnedEvent: hook,
      socketFactory: {
        create: jest.fn(async (input) => {
          events = input.events;
          return h.socket;
        }),
      },
    });
    await h.coordinator.start('alpha');

    const publishing = events.publish({ kind: 'qr' });
    await waitForCall(hook);
    const deleting = h.coordinator.delete('alpha');
    expect(observedSignal.aborted).toBe(true);
    publication.resolve();

    await expect(publishing).resolves.toBe(false);
    await deleting;
    expect(rolledBack).toHaveBeenCalledTimes(1);
  });

  it('publishes a starting-phase event only after exact repository ownership validation', async () => {
    const ownership = deferred<boolean>();
    const rollback = jest.fn().mockResolvedValue(undefined);
    const published = jest.fn(
      async (
        _identity: SessionIdentity,
        _generation: number,
        _lease: SessionLease,
        _event: unknown,
        _signal: AbortSignal,
        registerRollback: (rollback: () => void | Promise<void>) => void,
      ) => {
        registerRollback(rollback);
      },
    );
    let events!: EarlyEventAdapter;
    const h = harness({
      onOwnedEvent: published,
      socketFactory: {
        create: jest.fn(async (input) => {
          events = input.events;
          return h.socket;
        }),
      },
    });
    (h.repository.validateEventOwnership as jest.Mock).mockReturnValue(
      ownership.promise,
    );

    const starting = h.coordinator.start('alpha');
    await waitForCall(h.socketFactory.create as jest.Mock);
    const event = { kind: 'qr' };
    const publishing = events.publish(event);
    await waitForCall(h.repository.validateEventOwnership as jest.Mock);
    expect(published).not.toHaveBeenCalled();
    ownership.resolve(true);

    await expect(publishing).resolves.toBe(true);
    await starting;
    const owner = activeIdentity(h.coordinator);
    expect(published).toHaveBeenCalledWith(
      { sessionId: 'alpha', tenantId: 'default' },
      owner.generation,
      owner.lease,
      event,
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it('does not externally publish when repository event ownership is false', async () => {
    const published = jest.fn();
    let events!: EarlyEventAdapter;
    const h = harness({
      onOwnedEvent: published,
      socketFactory: {
        create: jest.fn(async (input) => {
          events = input.events;
          return h.socket;
        }),
      },
    });
    (h.repository.validateEventOwnership as jest.Mock).mockResolvedValue(false);
    await h.coordinator.start('alpha');

    await expect(events.publish({ kind: 'qr' })).resolves.toBe(false);
    expect(published).not.toHaveBeenCalled();
  });

  it('suppresses an early event when ownership becomes stale during validation', async () => {
    const ownership = deferred<boolean>();
    const published = jest.fn().mockResolvedValue(undefined);
    let events!: EarlyEventAdapter;
    const h = harness({
      onOwnedEvent: published,
      socketFactory: {
        create: jest.fn(async (input) => {
          events = input.events;
          await events.publish({ kind: 'qr' });
          return h.socket;
        }),
      },
    });
    (h.repository.validateEventOwnership as jest.Mock).mockReturnValue(
      ownership.promise,
    );

    const starting = h.coordinator.start('alpha');
    await waitForCall(h.repository.validateEventOwnership as jest.Mock);
    const deleting = h.coordinator.delete('alpha');
    expect(events.isOwner()).toBe(false);
    ownership.resolve(true);

    await expect(starting).rejects.toThrow(/stale|cancel/i);
    await deleting;
    expect(published).not.toHaveBeenCalled();
    expect(h.socket.end).toHaveBeenCalled();
    expect(h.auth.release).toHaveBeenCalled();
    expect(h.repository.releaseClaim).toHaveBeenCalled();
  });

  it('fails closed and cleans partial resources when an early publication hook rejects', async () => {
    let events!: EarlyEventAdapter;
    const h = harness({
      onOwnedEvent: jest.fn().mockRejectedValue(new Error('publish failed')),
      socketFactory: {
        create: jest.fn(async (input) => {
          events = input.events;
          await events.publish({ kind: 'qr' });
          return h.socket;
        }),
      },
    });

    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      /publish|stale|cancel/i,
    );
    expect(events.isOwner()).toBe(false);
    expect(h.auth.release).toHaveBeenCalledTimes(1);
    expect(h.repository.releaseClaim).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getSocket('alpha')).toBeUndefined();
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
    });
  });

  it('autonomously fails closed when an ignored early publication promise rejects', async () => {
    const hookFailure = new Error('async publish failed');
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    const h = harness({
      onOwnedEvent: jest.fn().mockRejectedValue(hookFailure),
      socketFactory: {
        create: jest.fn(async (input) => {
          void input.events.publish({ kind: 'qr' });
          return h.socket;
        }),
      },
    });

    await h.coordinator.start('alpha').catch(() => undefined);
    await flush(50);
    process.off('unhandledRejection', listener);

    expect(unhandled).toEqual([]);
    expect(h.coordinator.getSocket('alpha')).toBeUndefined();
    expect(h.socket.end).toHaveBeenCalledTimes(1);
    expect(h.auth.release).toHaveBeenCalledTimes(1);
    expect(h.repository.releaseClaim).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
      failure: hookFailure,
    });
  });

  it('compensates a partially published activation that rejects', async () => {
    const externallyPublished: SocketHandle[] = [];
    const activated = jest.fn(
      async (_identity, _generation, _lease, socket) => {
        externallyPublished.push(socket);
        throw new Error('activate failed');
      },
    );
    const retired = jest.fn(async (_identity, _generation, _lease, socket) => {
      const index = externallyPublished.indexOf(socket);
      if (index >= 0) externallyPublished.splice(index, 1);
    });
    const h = harness({
      onSocketActivated: activated,
      onSocketRetired: retired,
    });

    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      'activate failed',
    );
    expect(h.coordinator.getSocket('alpha')).toBeUndefined();
    expect(retired).toHaveBeenCalledTimes(1);
    expect(externallyPublished).toEqual([]);
    expect(h.socket.end).toHaveBeenCalledTimes(1);
    expect(h.auth.release).toHaveBeenCalledTimes(1);
    expect(h.repository.releaseClaim).toHaveBeenCalledTimes(1);
  });

  it.each(['delete', 'shutdown'] as const)(
    '%s during pending activation compensates publication and prevents adoption',
    async (action) => {
      const activation = deferred<void>();
      const activated = jest.fn().mockReturnValue(activation.promise);
      const retired = jest.fn().mockResolvedValue(undefined);
      const h = harness({
        onSocketActivated: activated,
        onSocketRetired: retired,
      });

      const starting = h.coordinator.start('alpha');
      await waitForCall(activated);
      const revoking =
        action === 'delete'
          ? h.coordinator.delete('alpha')
          : h.coordinator.shutdown();
      expect(h.coordinator.getSocket('alpha')).toBeUndefined();
      activation.resolve();

      await expect(starting).rejects.toThrow(/stale|cancel/i);
      await revoking;
      expect(retired).toHaveBeenCalledTimes(1);
      expect(h.socket.end).toHaveBeenCalledTimes(1);
      expect(h.auth.release).toHaveBeenCalledTimes(1);
      expect(h.repository.releaseClaim).toHaveBeenCalledTimes(1);
    },
  );

  it('passes injected-clock expiry to existing and recreate generation claims', async () => {
    let now = 1_000;
    const h = harness({ clock: () => now, leaseDurationMs: 250 });

    await h.coordinator.start('alpha');
    expect(h.repository.claimGeneration).toHaveBeenCalledWith(
      { sessionId: 'alpha', tenantId: 'default' },
      expect.any(String),
      1_250,
      expect.any(AbortSignal),
    );

    await h.coordinator.delete('alpha');
    now = 2_000;
    await h.coordinator.createOrRecreate('alpha');
    expect(h.repository.recreateAndClaim).toHaveBeenCalledWith(
      { sessionId: 'alpha', tenantId: 'default' },
      expect.any(String),
      2_250,
      expect.any(AbortSignal),
    );
  });

  it('rejects empty and NUL-bearing tenant/session identities before record access', async () => {
    const h = harness();
    const invalidIdentities: SessionIdentity[] = [
      { tenantId: '', sessionId: 'alpha' },
      { tenantId: 'tenant', sessionId: '   ' },
      { tenantId: 'a\u0000b', sessionId: 'c' },
      { tenantId: 'a', sessionId: 'b\u0000c' },
    ];

    for (const identity of invalidIdentities) {
      expect(() => h.coordinator.start(identity)).toThrow(
        /identity|tenant|session/i,
      );
      expect(() => h.coordinator.delete(identity)).toThrow(
        /identity|tenant|session/i,
      );
      expect(() => h.coordinator.createOrRecreate(identity)).toThrow(
        /identity|tenant|session/i,
      );
      expect(() => h.coordinator.getSnapshot(identity)).toThrow(
        /identity|tenant|session/i,
      );
      expect(() => h.coordinator.getSocket(identity)).toThrow(
        /identity|tenant|session/i,
      );
      expect(() => h.coordinator.isCurrent(identity, 1, 'lease')).toThrow(
        /identity|tenant|session/i,
      );
      expect(() =>
        h.coordinator.disconnect(identity, 1, 'lease', { reason: 'transient' }),
      ).toThrow(/identity|tenant|session/i);
    }
    expect(() => h.coordinator.getSnapshots('a\u0000b')).toThrow(/tenant/i);
    expect(h.repository.claimGeneration).not.toHaveBeenCalled();
  });

  it('scopes ownership and socket publication by the full tenant identity', async () => {
    const activated = jest.fn();
    const retired = jest.fn();
    const first = { sessionId: 'shared', tenantId: 'tenant-a' };
    const second = { sessionId: 'shared', tenantId: 'tenant-b' };
    const h = harness({
      onSocketActivated: activated,
      onSocketRetired: retired,
    });

    const socketA = await h.coordinator.start(first);
    const socketB = await h.coordinator.start(second);

    expect(h.coordinator.getSocket(first)).toBe(socketA);
    expect(h.coordinator.getSocket(second)).toBe(socketB);
    expect(h.coordinator.getSnapshots('tenant-a')).toHaveLength(1);
    expect(h.coordinator.getSnapshots('tenant-b')).toHaveLength(1);
    expect(activated).toHaveBeenCalledWith(
      first,
      expect.any(Number),
      expect.any(String),
      socketA,
      expect.any(AbortSignal),
    );
    await h.coordinator.delete(first);
    expect(h.coordinator.getSocket(first)).toBeUndefined();
    expect(h.coordinator.getSocket(second)).toBe(socketB);
    expect(retired).toHaveBeenCalledWith(
      first,
      expect.any(Number),
      expect.any(String),
      socketA,
      expect.any(AbortSignal),
    );
  });

  it('fences a heartbeat at expiry and blocks a later start', async () => {
    const timer = manualScheduler();
    let now = 1_000;
    const h = harness({
      scheduler: timer.scheduler,
      clock: () => now,
      leaseDurationMs: 200,
      heartbeatIntervalMs: 50,
      operationTimeoutMs: 25,
    });
    await h.coordinator.start('alpha');
    now = 1_200;
    timer.run(50);
    await flush(50);
    expect(h.repository.renewLease).not.toHaveBeenCalled();
    expect(h.socket.end).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
    });
    await expect(h.coordinator.start('alpha')).rejects.toThrow(
      /cleanup|resources|lease/i,
    );
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it('fences a renewal that resolves after its prior expiry', async () => {
    const timer = manualScheduler();
    const renewal = deferred<boolean>();
    let now = 1_000;
    const h = harness({
      scheduler: timer.scheduler,
      clock: () => now,
      leaseDurationMs: 200,
      heartbeatIntervalMs: 50,
      operationTimeoutMs: 100,
    });
    (h.repository.renewLease as jest.Mock).mockReturnValue(renewal.promise);
    await h.coordinator.start('alpha');
    timer.run(50);
    await waitForCall(h.repository.renewLease as jest.Mock);
    now = 1_200;
    renewal.resolve(true);
    await flush(50);
    expect(h.coordinator.getSocket('alpha')).toBeUndefined();
    expect(h.socket.end).toHaveBeenCalledTimes(1);
    expect(timer.count(50)).toBe(0);
  });

  it('retries failed retirement compensation on delete', async () => {
    const retired = jest
      .fn()
      .mockRejectedValueOnce(new Error('retirement hook failed'))
      .mockResolvedValueOnce(undefined);
    const h = harness({ onSocketRetired: retired });
    await h.coordinator.start('alpha');
    await expect(h.coordinator.delete('alpha')).rejects.toThrow(
      'retirement hook failed',
    );
    await expect(h.coordinator.delete('alpha')).resolves.toBeUndefined();
    expect(retired).toHaveBeenCalledTimes(2);
  });

  it('accounts rollback rejection after ownership revocation', async () => {
    const publication = deferred<void>();
    const rollbackError = new Error('rollback failed');
    let events!: EarlyEventAdapter;
    const h = harness({
      onOwnedEvent: async (
        _id,
        _generation,
        _lease,
        _event,
        _signal,
        register,
      ) => {
        register(jest.fn().mockRejectedValue(rollbackError));
        await publication.promise;
      },
      socketFactory: {
        create: jest.fn(async (input) => {
          events = input.events;
          return h.socket;
        }),
      },
    });
    await h.coordinator.start('alpha');
    const publishing = events.publish({ kind: 'qr' });
    await flush();
    const deleting = h.coordinator.delete('alpha');
    publication.resolve();
    await expect(publishing).resolves.toBe(false);
    const failure = await deleting.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LifecycleAggregateError);
    expect((failure as LifecycleAggregateError).errors).toContain(
      rollbackError,
    );
  });

  it('bounds an abort-ignoring event hook and compensates its late settlement', async () => {
    const timer = manualScheduler();
    const publication = deferred<void>();
    const rollback = jest.fn().mockResolvedValue(undefined);
    let events!: EarlyEventAdapter;
    const h = harness({
      scheduler: timer.scheduler,
      operationTimeoutMs: 10,
      onOwnedEvent: async (
        _id,
        _generation,
        _lease,
        _event,
        _signal,
        register,
      ) => {
        register(rollback);
        await publication.promise;
      },
      socketFactory: {
        create: jest.fn(async (input) => {
          events = input.events;
          return h.socket;
        }),
      },
    });
    await h.coordinator.start('alpha');
    const publishing = events.publish({ kind: 'qr' });
    await flush();
    timer.run(10);
    await expect(publishing).resolves.toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
    publication.resolve();
    await flush(20);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('retries failed late factory cleanup before a later start', async () => {
    const late = deferred<SocketHandle>();
    const timer = manualScheduler();
    const lateSocket: SocketHandle = {
      logout: jest.fn(),
      end: jest
        .fn()
        .mockRejectedValueOnce(new Error('late cleanup failed'))
        .mockResolvedValueOnce(undefined),
    };
    const replacement: SocketHandle = { logout: jest.fn(), end: jest.fn() };
    const h = harness({
      scheduler: timer.scheduler,
      operationTimeoutMs: 10,
      socketFactory: {
        create: jest
          .fn()
          .mockReturnValueOnce(late.promise)
          .mockResolvedValueOnce(replacement),
      },
    });
    const first = h.coordinator.start('alpha');
    await waitForCall(h.socketFactory.create as jest.Mock);
    timer.run(10);
    await expect(first).rejects.toThrow('timed out');
    late.resolve(lateSocket);
    await flush(30);
    await expect(h.coordinator.start('alpha')).resolves.toBe(replacement);
    expect(lateSocket.end).toHaveBeenCalledTimes(2);
  });

  it('records heartbeat cleanup failure without unhandled rejection', async () => {
    const timer = manualScheduler();
    const cleanupError = new Error('heartbeat end failed');
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    const h = harness({
      scheduler: timer.scheduler,
      heartbeatIntervalMs: 10,
      operationTimeoutMs: 100,
    });
    (h.repository.renewLease as jest.Mock).mockResolvedValue(false);
    (h.socket.end as jest.Mock).mockRejectedValue(cleanupError);
    await h.coordinator.start('alpha');
    timer.run(10);
    await flush(50);
    process.off('unhandledRejection', listener);
    expect(unhandled).toEqual([]);
    const failure = h.coordinator.getSnapshot('alpha')?.failure;
    expect(failure).toBeInstanceOf(LifecycleAggregateError);
    expect((failure as LifecycleAggregateError).errors).toContain(cleanupError);
  });

  it('uses all-settled reconnect cleanup and blocks replacement', async () => {
    const errors = [
      new Error('hook failed'),
      new Error('end failed'),
      new Error('auth failed'),
      new Error('claim failed'),
    ];
    const h = harness({
      onSocketRetired: jest.fn().mockRejectedValue(errors[0]),
    });
    (h.socket.end as jest.Mock).mockRejectedValue(errors[1]);
    (h.auth.release as jest.Mock).mockRejectedValue(errors[2]);
    (h.repository.releaseClaim as jest.Mock).mockRejectedValue(errors[3]);
    await h.coordinator.start('alpha');
    const owner = activeIdentity(h.coordinator);
    const failure = await h.coordinator
      .disconnect('alpha', owner.generation, owner.lease, {
        reason: 'restart-required',
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LifecycleAggregateError);
    expect((failure as LifecycleAggregateError).errors).toEqual(
      expect.arrayContaining(errors),
    );
    expect(h.socket.end).toHaveBeenCalled();
    expect(h.auth.release).toHaveBeenCalled();
    expect(h.repository.releaseClaim).toHaveBeenCalled();
    expect(h.socketFactory.create).toHaveBeenCalledTimes(1);
  });

  it('resets transient retries after successful explicit recreation', async () => {
    const timer = manualScheduler();
    const h = harness({
      scheduler: timer.scheduler,
      transientRetryMs: 10,
      maxTransientRetries: 1,
      operationTimeoutMs: 100,
    });
    await h.coordinator.start('alpha');
    let owner = activeIdentity(h.coordinator);
    let retry = h.coordinator.disconnect(
      'alpha',
      owner.generation,
      owner.lease,
      { reason: 'transient' },
    );
    await flush(30);
    timer.run(10);
    await retry;
    owner = activeIdentity(h.coordinator);
    await h.coordinator.disconnect('alpha', owner.generation, owner.lease, {
      reason: 'transient',
    });
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'stopped',
    });
    await h.coordinator.createOrRecreate('alpha');
    owner = activeIdentity(h.coordinator);
    retry = h.coordinator.disconnect('alpha', owner.generation, owner.lease, {
      reason: 'transient',
    });
    await flush(30);
    expect(timer.count(10)).toBe(1);
    timer.run(10);
    await expect(retry).resolves.toBeUndefined();
  });

  it.each([
    { conflictRetryMs: Number.NaN },
    { conflictRetryMs: -1 },
    { conflictRetryMs: 1.5 },
    { transientRetryMs: Number.POSITIVE_INFINITY },
    { transientRetryMs: -1 },
    { transientRetryMs: 1.5 },
    { maxTransientRetries: Number.NaN },
    { maxTransientRetries: -1 },
    { maxTransientRetries: 1.5 },
  ])('rejects invalid retry configuration %#', (configuration) => {
    expect(() => harness(configuration)).toThrow(/retry|transient|conflict/i);
  });

  it('does not supersede mandatory cleanup sharing a mutation error object', async () => {
    const shared = new Error('shared failure');
    let socketAuth!: SocketAuth;
    const h = harness({
      socketFactory: {
        create: jest.fn(async (input) => {
          socketAuth = input.auth;
          return h.socket;
        }),
      },
    });
    (h.auth.writeKeys as jest.Mock).mockRejectedValue(shared);
    (h.socket.end as jest.Mock).mockRejectedValue(shared);
    await h.coordinator.start('alpha');
    await socketAuth.writeKeys({ broken: true });
    const failure = await h.coordinator
      .delete('alpha')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LifecycleAggregateError);
    expect((failure as LifecycleAggregateError).errors).toContain(shared);
    expect(h.coordinator.getSnapshot('alpha')).toMatchObject({
      phase: 'failed',
    });
  });
});
