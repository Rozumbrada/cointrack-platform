/**
 * Scan-fronta v prohlížeči — drží upnuté soubory (fotky/PDF) a parsed data
 * v IndexedDB, dokud Gemini neodpoví. Mobilní app má stejnou frontu nezávisle
 * (Room DB), takže každé zařízení udržuje svojí vlastní queue.
 *
 * Stavy:
 *   pending    — čeká na AI rozpoznání
 *   processing — extractor právě běží (lock proti paralelním retry)
 *   ready      — AI úspěšně rozpoznala, čeká na potvrzení uživatelem
 *   failed     — definitivní chyba (smazat / nahrát znovu ručně)
 *
 * Po finálním uložení dokladu ze "ready" záznamu se položka maže.
 */
import { ParsedDocument } from "./gemini";

export type ScanQueueStatus = "pending" | "processing" | "ready" | "failed";

export interface ScanQueueRecord {
  id: string;             // crypto.randomUUID
  profileSyncId: string;  // ke kterému profilu patří
  status: ScanQueueStatus;
  fileName: string;
  fileType: string;       // MIME — image/* nebo application/pdf
  fileSize: number;
  /** File obsah jako Blob — IndexedDB to umí ukládat nativně. */
  fileBlob: Blob;
  /** Po úspěšné extrakci JSON s parsovanými daty. */
  parsed?: ParsedDocument;
  /** Po úspěšném uploadu storage key (pro pozdější save). */
  storageKey?: string;
  attempts: number;
  lastError?: string;
  createdAt: number;      // epoch ms
  lastAttemptAt: number;
}

const DB_NAME = "cointrack-scan-queue";
const DB_VERSION = 1;
const STORE = "items";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("profileSyncId", "profileSyncId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueFile(args: {
  profileSyncId: string;
  file: File;
  initialError?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const record: ScanQueueRecord = {
    id,
    profileSyncId: args.profileSyncId,
    status: "pending",
    fileName: args.file.name || "doklad",
    fileType: args.file.type || "application/octet-stream",
    fileSize: args.file.size,
    fileBlob: args.file,
    attempts: 0,
    lastError: args.initialError,
    createdAt: Date.now(),
    lastAttemptAt: 0,
  };
  await withStore("readwrite", (store) => reqToPromise(store.put(record)));
  return id;
}

export async function listForProfile(profileSyncId: string): Promise<ScanQueueRecord[]> {
  return withStore("readonly", (store) => {
    return new Promise<ScanQueueRecord[]>((resolve, reject) => {
      const idx = store.index("profileSyncId");
      const req = idx.getAll(IDBKeyRange.only(profileSyncId));
      req.onsuccess = () => {
        const arr = (req.result as ScanQueueRecord[]).sort(
          (a, b) => b.createdAt - a.createdAt,
        );
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function getRecord(id: string): Promise<ScanQueueRecord | null> {
  return withStore("readonly", async (store) => {
    const req = store.get(id);
    const r = await reqToPromise(req);
    return (r as ScanQueueRecord) ?? null;
  });
}

export async function getPendingForRetry(): Promise<ScanQueueRecord[]> {
  return withStore("readonly", (store) => {
    return new Promise<ScanQueueRecord[]>((resolve, reject) => {
      const idx = store.index("status");
      const req = idx.getAll(IDBKeyRange.only("pending"));
      req.onsuccess = () => {
        const arr = (req.result as ScanQueueRecord[]).sort(
          (a, b) => a.lastAttemptAt - b.lastAttemptAt || a.createdAt - b.createdAt,
        );
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function updateRecord(
  id: string,
  patch: Partial<ScanQueueRecord>,
): Promise<void> {
  await withStore("readwrite", async (store) => {
    const existing = (await reqToPromise(store.get(id))) as ScanQueueRecord | undefined;
    if (!existing) return;
    const merged = { ...existing, ...patch };
    await reqToPromise(store.put(merged));
  });
}

export async function deleteRecord(id: string): Promise<void> {
  await withStore("readwrite", (store) => reqToPromise(store.delete(id)));
}

export async function resetStuckProcessing(): Promise<void> {
  // Pokud tab spadl/zavřel se s PROCESSING, vrátí na PENDING ať se retry pokusí znovu
  const stuck = await withStore("readonly", (store) => {
    return new Promise<ScanQueueRecord[]>((resolve, reject) => {
      const idx = store.index("status");
      const req = idx.getAll(IDBKeyRange.only("processing"));
      req.onsuccess = () => resolve(req.result as ScanQueueRecord[]);
      req.onerror = () => reject(req.error);
    });
  });
  for (const r of stuck) {
    await updateRecord(r.id, { status: "pending" });
  }
}
