const DB_NAME = "webscrapper";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("runs")) {
        db.createObjectStore("runs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("rows")) {
        const rows = db.createObjectStore("rows", { keyPath: "key" });
        rows.createIndex("runId", "runId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

async function rowKeysForRun(db, id) {
  const tx = db.transaction("rows", "readonly");
  const request = tx.objectStore("rows").index("runId").getAllKeys(IDBKeyRange.only(id));
  const keys = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  await waitTransaction(tx);
  return keys;
}

export async function saveRun(meta, rows) {
  if (!meta?.id) throw new Error("Run id is required");
  const safeRows = Array.isArray(rows) ? rows : [];
  const db = await openDb();
  const oldKeys = await rowKeysForRun(db, meta.id);
  const tx = db.transaction(["runs", "rows"], "readwrite");
  tx.objectStore("runs").put({ ...meta, rowCount: safeRows.length });
  const rowStore = tx.objectStore("rows");
  for (const key of oldKeys) rowStore.delete(key);
  for (let i = 0; i < safeRows.length; i += 1) {
    rowStore.put({
      key: meta.id + ":" + String(i).padStart(12, "0"),
      runId: meta.id,
      index: i,
      value: safeRows[i]
    });
  }
  await waitTransaction(tx);
  db.close();
}

export async function createRun(meta = {}, rows = []) {
  const id = String(meta.id || crypto.randomUUID());
  const existing = await getRun(id);
  if (existing.meta) throw new Error("Run already exists: " + id);
  const now = new Date().toISOString();
  await saveRun({
    ...meta,
    id,
    createdAt: meta.createdAt || now,
    updatedAt: meta.updatedAt || now
  }, rows);
  return getRun(id);
}

export async function listRuns() {
  const db = await openDb();
  const tx = db.transaction("runs", "readonly");
  const request = tx.objectStore("runs").getAll();
  const runs = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  await waitTransaction(tx);
  db.close();
  return runs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getRun(id) {
  const db = await openDb();
  const tx = db.transaction(["runs", "rows"], "readonly");
  const metaRequest = tx.objectStore("runs").get(id);
  const index = tx.objectStore("rows").index("runId");
  const rowRequest = index.getAll(IDBKeyRange.only(id));

  const [meta, storedRows] = await Promise.all([
    new Promise((resolve, reject) => {
      metaRequest.onsuccess = () => resolve(metaRequest.result || null);
      metaRequest.onerror = () => reject(metaRequest.error);
    }),
    new Promise((resolve, reject) => {
      rowRequest.onsuccess = () => resolve(rowRequest.result || []);
      rowRequest.onerror = () => reject(rowRequest.error);
    })
  ]);

  await waitTransaction(tx);
  db.close();
  storedRows.sort((a, b) => a.index - b.index);
  return { meta, rows: storedRows.map((entry) => entry.value) };
}

export async function updateRun(id, patch = {}) {
  const current = await getRun(id);
  if (!current.meta) throw new Error("Run not found: " + id);
  const metaPatch = patch.meta && typeof patch.meta === "object" ? patch.meta : {};
  const rows = Array.isArray(patch.rows) ? patch.rows : current.rows;
  const nextMeta = {
    ...current.meta,
    ...metaPatch,
    id,
    createdAt: current.meta.createdAt,
    updatedAt: new Date().toISOString()
  };
  await saveRun(nextMeta, rows);
  return getRun(id);
}

export async function deleteRun(id) {
  const db = await openDb();
  const tx = db.transaction(["runs", "rows"], "readwrite");
  tx.objectStore("runs").delete(id);
  const index = tx.objectStore("rows").index("runId");
  const cursorRequest = index.openCursor(IDBKeyRange.only(id));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await waitTransaction(tx);
  db.close();
  return true;
}
