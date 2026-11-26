import { createIdbStoreClient } from './idb.util';

interface FakeOpenRequest {
  onupgradeneeded?: () => void;
  onblocked?: () => void;
  onsuccess?: () => void;
  onerror?: () => void;
  result?: IDBDatabase;
  error?: DOMException | null;
}

describe('idb.util', () => {
  const createdDbNames: string[] = [];

  function uniqueDbName(prefix: string): string {
    const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createdDbNames.push(name);
    return name;
  }

  afterEach(async () => {
    for (const dbName of createdDbNames.splice(0)) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  });

  it('performs round-trip CRUD operations and does not block subsequent version upgrades', async () => {
    const dbName = uniqueDbName('idb_crud');
    const client = createIdbStoreClient(dbName, 1, ['s1', 's2']);

    await client.put('s1', 'k1', { hello: 'world' });
    expect(await client.get<{ hello: string }>('s1', 'k1')).toEqual({ hello: 'world' });

    await client.delete('s1', 'k1');
    expect(await client.get('s1', 'k1')).toBeNull();

    await client.put('s1', 'k2', 'v2');
    await client.put('s2', 'k3', 'v3');
    await client.clearStore('s1');
    expect(await client.get('s1', 'k2')).toBeNull();
    expect(await client.get<string>('s2', 'k3')).toBe('v3');

    await client.clearAll();
    expect(await client.get('s2', 'k3')).toBeNull();

    // Verify db.onversionchange closes the cached DB so a v2 open does not block
    const upgraded = await new Promise<boolean>((resolve) => {
      const req = indexedDB.open(dbName, 2);
      req.onsuccess = () => {
        req.result.close();
        resolve(true);
      };
      req.onblocked = () => resolve(false);
      req.onerror = () => resolve(false);
    });
    expect(upgraded).toBeTrue();
  });

  it('recovers openDb() after an open rejection instead of caching the rejected promise', async () => {
    const dbName = uniqueDbName('idb_open_reject');
    const client = createIdbStoreClient(dbName, 1, ['s1']);
    const originalOpen = indexedDB.open.bind(indexedDB);

    let callCount = 0;
    spyOn(indexedDB, 'open').and.callFake((name: string, version?: number) => {
      callCount++;
      if (callCount === 1) {
        const fakeReq: FakeOpenRequest = {
          error: new DOMException('Open failed', 'AbortError'),
        };
        queueMicrotask(() => {
          fakeReq.onerror?.();
        });
        return fakeReq as unknown as IDBOpenDBRequest;
      }
      return originalOpen(name, version);
    });

    await expectAsync(client.put('s1', 'k', 'val')).toBeRejected();
    expect(callCount).toBe(1);

    await expectAsync(client.put('s1', 'k', 'val')).toBeResolved();
    expect(callCount).toBe(2);
    expect(await client.get<string>('s1', 'k')).toBe('val');
  });

  it('propagates original error and recovers openDb() when indexedDB.open() throws synchronously', async () => {
    const dbName = uniqueDbName('idb_sync_throw');
    const client = createIdbStoreClient(dbName, 1, ['s1']);
    const originalOpen = indexedDB.open.bind(indexedDB);

    let callCount = 0;
    const syncError = new DOMException('Blocked by storage policy', 'SecurityError');
    spyOn(indexedDB, 'open').and.callFake((name: string, version?: number) => {
      callCount++;
      if (callCount === 1) {
        throw syncError;
      }
      return originalOpen(name, version);
    });

    let caught: unknown;
    try {
      await client.put('s1', 'k', 'val');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(syncError);
    expect(callCount).toBe(1);

    await expectAsync(client.put('s1', 'k', 'val')).toBeResolved();
    expect(callCount).toBe(2);
    expect(await client.get<string>('s1', 'k')).toBe('val');
  });

  it('rejects on req.onblocked, resets dbPromise, and closes a late onsuccess DB', async () => {
    const dbName = uniqueDbName('idb_blocked');
    const client = createIdbStoreClient(dbName, 1, ['s1']);
    const originalOpen = indexedDB.open.bind(indexedDB);

    const lateDbCloseSpy = jasmine.createSpy('close');
    let blockedReq: FakeOpenRequest | null = null;
    let callCount = 0;

    spyOn(indexedDB, 'open').and.callFake((name: string, version?: number) => {
      callCount++;
      if (callCount === 1) {
        blockedReq = {
          result: { close: lateDbCloseSpy } as unknown as IDBDatabase,
        };
        queueMicrotask(() => {
          blockedReq?.onblocked?.();
        });
        return blockedReq as unknown as IDBOpenDBRequest;
      }
      return originalOpen(name, version);
    });

    await expectAsync(client.put('s1', 'k', 'v1')).toBeRejectedWithError(/blocked/i);

    // Trigger late onsuccess on the first request — must close the late DB
    blockedReq!.onsuccess?.();
    expect(lateDbCloseSpy).toHaveBeenCalledTimes(1);

    // Next operation opens fresh
    await expectAsync(client.put('s1', 'k', 'v2')).toBeResolved();
    expect(callCount).toBe(2);
    expect(await client.get<string>('s1', 'k')).toBe('v2');
  });

  it('resets cached dbPromise on db.onversionchange and db.onclose', async () => {
    const dbName = uniqueDbName('idb_lifecycle');
    const client = createIdbStoreClient(dbName, 1, ['s1']);

    let openCount = 0;
    const closeSpies: jasmine.Spy[] = [];
    const fakeDbs: Array<{
      onversionchange: ((ev: IDBVersionChangeEvent) => void) | null;
      onclose: ((ev: Event) => void) | null;
      close: jasmine.Spy;
      transaction: () => unknown;
    }> = [];

    spyOn(indexedDB, 'open').and.callFake(() => {
      openCount++;
      const closeSpy = jasmine.createSpy(`close_${openCount}`);
      closeSpies.push(closeSpy);
      const fakeDb = {
        onversionchange: null as ((ev: IDBVersionChangeEvent) => void) | null,
        onclose: null as ((ev: Event) => void) | null,
        close: closeSpy,
        transaction: () => {
          const tx = {
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
            error: null as DOMException | null,
            objectStore: () => ({
              put: () => {
                const req = {
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                  error: null as DOMException | null,
                };
                queueMicrotask(() => {
                  req.onsuccess?.();
                  tx.oncomplete?.();
                });
                return req;
              },
            }),
          };
          return tx;
        },
      };
      fakeDbs.push(fakeDb);
      const req: FakeOpenRequest = {
        result: fakeDb as unknown as IDBDatabase,
      };
      queueMicrotask(() => {
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    });

    await client.put('s1', 'k1', 'v1');
    expect(openCount).toBe(1);

    fakeDbs[0].onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent);
    expect(closeSpies[0]).toHaveBeenCalledTimes(1);

    await client.put('s1', 'k2', 'v2');
    expect(openCount).toBe(2);

    fakeDbs[1].onclose?.(new Event('close'));
    await client.put('s1', 'k3', 'v3');
    expect(openCount).toBe(3);
  });

  it('put() waits for tx.oncomplete and propagates QuotaExceededError on tx.onerror/tx.onabort', async () => {
    const dbName = uniqueDbName('idb_tx_complete');
    const client = createIdbStoreClient(dbName, 1, ['s1']);

    let mode: 'complete' | 'txError' | 'txAbort' | 'reqError' = 'complete';
    let currentTx: {
      oncomplete: (() => void) | null;
      onerror: (() => void) | null;
      onabort: (() => void) | null;
      error: DOMException | null;
    } | null = null;
    let currentReq: {
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
      error: DOMException | null;
    } | null = null;

    spyOn(indexedDB, 'open').and.callFake(() => {
      const fakeDb = {
        onversionchange: null,
        onclose: null,
        close: () => {},
        transaction: () => {
          currentTx = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: null,
          };
          return {
            get oncomplete() {
              return currentTx!.oncomplete;
            },
            set oncomplete(fn: (() => void) | null) {
              currentTx!.oncomplete = fn;
            },
            get onerror() {
              return currentTx!.onerror;
            },
            set onerror(fn: (() => void) | null) {
              currentTx!.onerror = fn;
            },
            get onabort() {
              return currentTx!.onabort;
            },
            set onabort(fn: (() => void) | null) {
              currentTx!.onabort = fn;
            },
            get error() {
              return currentTx!.error;
            },
            objectStore: () => ({
              put: () => {
                currentReq = {
                  onsuccess: null,
                  onerror: null,
                  error: null,
                };
                queueMicrotask(() => {
                  if (mode === 'reqError') {
                    currentReq!.error = new DOMException('Req fail', 'DataError');
                    currentReq!.onerror?.();
                  } else {
                    currentReq!.onsuccess?.();
                  }
                });
                return currentReq;
              },
            }),
          };
        },
      };
      const req: FakeOpenRequest = {
        result: fakeDb as unknown as IDBDatabase,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req as unknown as IDBOpenDBRequest;
    });

    // 1. req.onsuccess alone must NOT resolve put() until tx.oncomplete fires
    let resolved = false;
    const p1 = client.put('s1', 'k', 'v').then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBeFalse();
    currentTx!.oncomplete?.();
    await p1;
    expect(resolved).toBeTrue();

    // 2. tx.onabort with QuotaExceededError after req.onsuccess must reject put()
    mode = 'txAbort';
    const p2 = client.put('s1', 'k', 'v');
    await Promise.resolve();
    await Promise.resolve();
    currentTx!.error = new DOMException('Quota exceeded', 'QuotaExceededError');
    currentTx!.onabort?.();
    await expectAsync(p2).toBeRejectedWithError(/Quota exceeded/);

    // 3. tx.onerror must reject put()
    mode = 'txError';
    const p3 = client.put('s1', 'k', 'v');
    await Promise.resolve();
    await Promise.resolve();
    currentTx!.error = new DOMException('Tx failed', 'UnknownError');
    currentTx!.onerror?.();
    await expectAsync(p3).toBeRejectedWithError(/Tx failed/);

    // 4. req.onerror must reject put()
    mode = 'reqError';
    await expectAsync(client.put('s1', 'k', 'v')).toBeRejectedWithError(/Req fail/);
  });

  it('handles req.onerror and tx.onabort gracefully with console.warn in get, delete, and clearStore', async () => {
    const dbName = uniqueDbName('idb_resilience');
    const client = createIdbStoreClient(dbName, 1, ['s1']);
    const warnSpy = spyOn(console, 'warn');

    spyOn(indexedDB, 'open').and.callFake(() => {
      const fakeDb = {
        onversionchange: null,
        onclose: null,
        close: () => {},
        transaction: () => {
          const tx = {
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
            error: new DOMException('Aborted', 'AbortError'),
            objectStore: () => ({
              get: () => {
                const req = {
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                  error: new DOMException('Get fail', 'DataError'),
                };
                queueMicrotask(() => req.onerror?.());
                return req;
              },
              delete: () => {
                queueMicrotask(() => tx.onabort?.());
              },
              clear: () => {
                queueMicrotask(() => tx.onabort?.());
              },
            }),
          };
          return tx;
        },
      };
      const req: FakeOpenRequest = {
        result: fakeDb as unknown as IDBDatabase,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req as unknown as IDBOpenDBRequest;
    });

    expect(await client.get('s1', 'k1')).toBeNull();
    await expectAsync(client.delete('s1', 'k1')).toBeResolved();
    await expectAsync(client.clearStore('s1')).toBeResolved();
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('fast-returns an empty Map from getMany when keys array is empty without opening IndexedDB', async () => {
    const openSpy = spyOn(indexedDB, 'open').and.callThrough();
    const client = createIdbStoreClient(uniqueDbName('idb_getmany_empty'), 1, ['s1']);

    const res = await client.getMany<string>('s1', []);
    expect(res.size).toBe(0);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('reads multiple keys via getMany over a single readonly transaction and ignores missing keys', async () => {
    const client = createIdbStoreClient(uniqueDbName('idb_getmany_single_tx'), 1, ['s1']);
    await client.put('s1', 'k1', { v: 1 });
    await client.put('s1', 'k2', { v: 2 });

    expect(await client.get<{ v: number }>('s1', 'k1')).toEqual({ v: 1 });

    const origTx = IDBDatabase.prototype.transaction;
    let txCount = 0;
    spyOn(IDBDatabase.prototype, 'transaction').and.callFake(function (
      this: IDBDatabase,
      storeNames: string | Iterable<string>,
      mode?: IDBTransactionMode
    ) {
      txCount++;
      return origTx.call(this, storeNames, mode);
    });

    const result = await client.getMany<{ v: number }>('s1', ['k1', 'missing', 'k2', 'k1']);
    expect(txCount).toBe(1);
    expect(result.size).toBe(2);
    expect(result.get('k1')).toEqual({ v: 1 });
    expect(result.get('k2')).toEqual({ v: 2 });
    expect(result.has('missing')).toBeFalse();
  });
});
