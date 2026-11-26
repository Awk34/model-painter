export interface IdbStoreClient {
  get<T>(storeName: string, key: string): Promise<T | null>;
  put<T>(storeName: string, key: string, value: T): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
  clearStore(storeName: string): Promise<void>;
  clearAll(): Promise<void>;
}

/**
 * Creates a lightweight, typed IndexedDB key-value store client with lazy DB initialization.
 */
export function createIdbStoreClient(
  dbName: string,
  version: number,
  storeNames: readonly string[]
): IdbStoreClient {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) {
      return dbPromise;
    }
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable.'));
    }
    let pending: Promise<IDBDatabase> | null = null;
    let failedBeforeAssign = false;
    pending = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown, fallback: string) => {
        if (!settled) {
          settled = true;
          failedBeforeAssign = true;
          if (pending && dbPromise === pending) {
            dbPromise = null;
          }
          reject(err ?? new Error(fallback));
        }
      };

      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(dbName, version);
      } catch (err) {
        fail(err, `Failed to open IndexedDB ${dbName}`);
        return;
      }

      req.onupgradeneeded = () => {
        const db = req.result;
        for (const storeName of storeNames) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        }
      };
      req.onblocked = () => {
        fail(null, `IndexedDB open blocked for ${dbName}`);
      };
      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        db.onversionchange = () => {
          db.close();
          if (dbPromise === pending) {
            dbPromise = null;
          }
        };
        db.onclose = () => {
          if (dbPromise === pending) {
            dbPromise = null;
          }
        };
        resolve(db);
      };
      req.onerror = () => {
        fail(req.error, `Failed to open IndexedDB ${dbName}`);
      };
    });
    if (!failedBeforeAssign) {
      dbPromise = pending;
    }
    return pending;
  };

  const clearSingleStore = async (storeName: string): Promise<void> => {
    try {
      const db = await openDb();
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = finish;
        tx.onerror = () => {
          console.warn(`IDB clearStore(${storeName}) error:`, tx.error);
          finish();
        };
        tx.onabort = () => {
          console.warn(`IDB clearStore(${storeName}) aborted:`, tx.error);
          finish();
        };
      });
    } catch (err) {
      console.warn(`IDB clearStore(${storeName}) failed:`, err);
    }
  };

  return {
    async get<T>(storeName: string, key: string): Promise<T | null> {
      try {
        const db = await openDb();
        return await new Promise<T | null>((resolve) => {
          let settled = false;
          const finish = (value: T | null) => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          };
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).get(key);
          req.onsuccess = () => finish((req.result as T) ?? null);
          req.onerror = () => {
            console.warn(`IDB get(${storeName}, ${key}) error:`, req.error);
            finish(null);
          };
          tx.onabort = () => {
            console.warn(`IDB get(${storeName}, ${key}) aborted:`, tx.error);
            finish(null);
          };
        });
      } catch (err) {
        console.warn(`IDB get(${storeName}, ${key}) failed:`, err);
        return null;
      }
    },

    async put<T>(storeName: string, key: string, value: T): Promise<void> {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (err: unknown, fallback: string) => {
          if (!settled) {
            settled = true;
            reject(err ?? new Error(fallback));
          }
        };
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(value, key);
        req.onerror = () => fail(req.error, `IDB put(${storeName}, ${key}) request failed`);
        tx.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        tx.onerror = () =>
          fail(tx.error ?? req.error, `IDB put(${storeName}, ${key}) transaction error`);
        tx.onabort = () =>
          fail(tx.error ?? req.error, `IDB put(${storeName}, ${key}) transaction aborted`);
      });
    },

    async delete(storeName: string, key: string): Promise<void> {
      try {
        const db = await openDb();
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = finish;
          tx.onerror = () => {
            console.warn(`IDB delete(${storeName}, ${key}) error:`, tx.error);
            finish();
          };
          tx.onabort = () => {
            console.warn(`IDB delete(${storeName}, ${key}) aborted:`, tx.error);
            finish();
          };
        });
      } catch (err) {
        console.warn(`IDB delete(${storeName}, ${key}) failed:`, err);
      }
    },

    clearStore: clearSingleStore,

    async clearAll(): Promise<void> {
      await Promise.all(storeNames.map(clearSingleStore));
    },
  };
}

