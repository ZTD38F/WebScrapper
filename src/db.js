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

export async function saveRun(meta, rows) {
  const db = await openDb();
  const tx = db.transaction(["runs", "rows"], "readwrite");
  tx.objectStore("runs").put({ ...meta, rowCount: rows.length });
  const rowStore = tx.objectStore("rows");
  for (let i = 0; i < rows.length; i += 1) {
    rowStore.put({
      key: meta.id + ":" + String(i).padStart(12, "0"),
      runId: meta.id,
      index: i,
      value: rows[i]
    });
  }
  await waitTransaction(tx);
  db.close();
}

export async function listRuns() {
  const db = await openDb();
  const tx = db.transaction("runs", "readonly");
  const request = tx.objectStore("runs").getAll();
  const runs = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
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

  db.close();
  storedRows.sort((a, b) => a.index - b.index);
  return { meta, rows: storedRows.map((entry) => entry.value) };
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
}
