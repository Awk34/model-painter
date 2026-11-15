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
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const storeName of storeNames) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  };

  const clearSingleStore = async (storeName: string): Promise<void> => {
    try {
      const db = await openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Ignore clear errors
    }
  };

  return {
    async get<T>(storeName: string, key: string): Promise<T | null> {
      try {
        const db = await openDb();
        return await new Promise<T | null>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).get(key);
          req.onsuccess = () => resolve((req.result as T) ?? null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return null;
      }
    },

    async put<T>(storeName: string, key: string, value: T): Promise<void> {
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const req = tx.objectStore(storeName).put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch {
        // Ignore quota or transient IndexedDB errors
      }
    },

    async delete(storeName: string, key: string): Promise<void> {
      try {
        const db = await openDb();
        await new Promise<void>((resolve) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } catch {
        // Ignore deletion errors
      }
    },

    clearStore: clearSingleStore,

    async clearAll(): Promise<void> {
      await Promise.all(storeNames.map(clearSingleStore));
    },
  };
}

