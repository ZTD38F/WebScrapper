const $ = (id) => document.getElementById(id);
let activeContext = null;
let currentRun = null;

async function rpc(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Extension command failed");
  return response.data;
}

function setStatus(value) {
  $("status").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(label + " is not valid JSON: " + error.message);
  }
}

function configFromUi() {
  const fields = parseJson($("fields").value || "[]", "Fields");
  if (!Array.isArray(fields)) throw new Error("Fields JSON must be an array");
  return {
    startUrl: $("startUrl").value.trim(),
    useCurrentTab: !$("startUrl").value.trim(),
    rowSelector: $("rowSelector").value.trim(),
    fields,
    pagination: $("pagination").value,
    nextSelector: $("nextSelector").value.trim(),
    maxPages: Number($("maxPages").value) || 0,
    waitMs: Number($("waitMs").value) || 1200,
    includeFrames: $("includeFrames").checked,
    detail: {
      enabled: $("detailEnabled").checked,
      urlField: $("detailUrlField").value.trim() || "url",
      rowSelector: $("detailRowSelector").value.trim(),
      fields: parseJson($("detailFields").value || "[]", "Detail fields"),
      waitMs: Number($("waitMs").value) || 1200
    }
  };
}

function settingsFromUi() {
  return {
    endpoint: $("aiEndpoint").value.trim(),
    model: $("aiModel").value.trim(),
    apiKey: $("aiKey").value
  };
}

function setSchema(schema) {
  $("rowSelector").value = schema?.rowSelector || "";
  $("fields").value = JSON.stringify(schema?.fields || [], null, 2);
}

function downloadBlob(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function csvCell(value) {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return '"' + s.replaceAll('"', '""') + '"';
}

function rowsToCsv(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return [keys.map(csvCell).join(","), ...rows.map((row) => keys.map((key) => csvCell(row?.[key])).join(","))].join("\r\n");
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function renderPreview(rows) {
  const table = $("preview");
  clearNode(table);
  if (!rows?.length) return;

  const keys = [];
  const seen = new Set();
  for (const row of rows.slice(0, 100)) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const key of keys) {
    const th = document.createElement("th");
    th.textContent = key;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows.slice(0, 100)) {
    const tr = document.createElement("tr");
    for (const key of keys) {
      const td = document.createElement("td");
      const value = row?.[key];
      td.textContent = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

async function loadContext() {
  activeContext = await rpc("WS_GET_ACTIVE_CONTEXT");
  $("pageInfo").textContent = (activeContext.title || "Untitled") + " — " + (activeContext.url || "");
  if (!$("startUrl").value) $("startUrl").placeholder = activeContext.url || "Blank = current tab";
}

async function loadSettings() {
  const settings = await rpc("WS_GET_SETTINGS");
  $("aiEndpoint").value = settings.endpoint || "";
  $("aiModel").value = settings.model || "";
  $("aiKey").value = settings.apiKey || "";
}

async function loadRuns(selectId) {
  const runs = await rpc("WS_LIST_RUNS");
  const select = $("runs");
  clearNode(select);

  for (const run of runs) {
    const option = document.createElement("option");
    option.value = run.id;
    option.textContent = new Date(run.createdAt).toLocaleString() + " · " + (run.rowCount ?? 0) + " rows · " + (run.title || run.startUrl || "run");
    select.appendChild(option);
  }

  if (selectId && runs.some((r) => r.id === selectId)) select.value = selectId;
  if (select.value) await openRun(select.value);
  else {
    currentRun = null;
    $("runMeta").textContent = "No saved runs yet.";
    renderPreview([]);
  }
}

async function openRun(id) {
  currentRun = await rpc("WS_GET_RUN", { id });
  const meta = currentRun?.meta;
  $("runMeta").textContent = meta
    ? (meta.rowCount || currentRun.rows.length) + " rows · " + meta.pages + " pages · stop: " + meta.stopReason
    : "";
  renderPreview(currentRun?.rows || []);
}

async function loadJobs() {
  const jobs = await rpc("WS_LIST_JOBS");
  const root = $("jobs");
  clearNode(root);

  for (const job of jobs) {
    const card = document.createElement("div");
    card.className = "job";

    const row = document.createElement("div");
    row.className = "jobRow";
    const text = document.createElement("div");
    text.textContent = job.name + " · every " + job.periodMinutes + " min";
    row.appendChild(text);

    const buttons = document.createElement("div");
    buttons.className = "actions";
    const run = document.createElement("button");
    run.textContent = "Run";
    run.addEventListener("click", async () => {
      try {
        setStatus("Running scheduled job…");
        const result = await rpc("WS_RUN_JOB", { id: job.id });
        setStatus(result.meta || result);
        await loadRuns(result.meta?.id);
        await loadJobs();
      } catch (error) {
        setStatus(error.message);
      }
    });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger";
    del.addEventListener("click", async () => {
      await rpc("WS_DELETE_JOB", { id: job.id });
      await loadJobs();
    });

    buttons.append(run, del);
    row.appendChild(buttons);
    card.appendChild(row);

    const details = document.createElement("div");
    details.className = "muted";
    details.textContent = (job.config?.startUrl || "") + (job.lastError ? " · last error: " + job.lastError : "");
    card.appendChild(details);
    root.appendChild(card);
  }
}

$("analyze").addEventListener("click", async () => {
  try {
    setStatus("Analyzing current page…");
    const snapshot = await rpc("WS_ANALYZE_ACTIVE");
    setSchema(snapshot.auto);
    setStatus({
      url: snapshot.url,
      detectedRows: snapshot.auto?.count || 0,
      fields: snapshot.auto?.fields || [],
      forms: snapshot.forms?.length || 0,
      links: snapshot.links?.length || 0,
      images: snapshot.images?.length || 0
    });
  } catch (error) {
    setStatus(error.message);
  }
});

$("aiSuggest").addEventListener("click", async () => {
  try {
    const settings = settingsFromUi();
    await rpc("WS_SAVE_SETTINGS", { settings });
    setStatus("Asking configured AI provider for a declarative schema…");
    const schema = await rpc("WS_AI_SUGGEST", { settings });
    setSchema(schema);
    setStatus(schema);
  } catch (error) {
    setStatus(error.message);
  }
});

$("run").addEventListener("click", async () => {
  try {
    const config = configFromUi();
    setStatus("Scraping…");
    const result = await rpc("WS_RUN_SCRAPER", { config });
    setStatus(result.meta);
    await loadRuns(result.meta.id);
  } catch (error) {
    setStatus(error.message);
  }
});

$("runBulk").addEventListener("click", async () => {
  try {
    const urls = $("bulkUrls").value
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!urls.length) throw new Error("Add at least one URL to the bulk list");
    const config = configFromUi();
    setStatus("Running " + urls.length + " URLs…");
    const result = await rpc("WS_RUN_BULK", { config, urls });
    setStatus(result);
    await loadRuns(result.runs?.at(-1)?.id);
  } catch (error) {
    setStatus(error.message);
  }
});

$("runs").addEventListener("change", async () => {
  try {
    if ($("runs").value) await openRun($("runs").value);
  } catch (error) {
    setStatus(error.message);
  }
});

$("refreshRuns").addEventListener("click", () => loadRuns().catch((e) => setStatus(e.message)));

$("exportJson").addEventListener("click", () => {
  if (!currentRun) return setStatus("Select a run first.");
  downloadBlob("webscrapper-" + currentRun.meta.id + ".json", "application/json", JSON.stringify(currentRun.rows, null, 2));
});

$("exportCsv").addEventListener("click", () => {
  if (!currentRun) return setStatus("Select a run first.");
  downloadBlob("webscrapper-" + currentRun.meta.id + ".csv", "text/csv;charset=utf-8", "\ufeff" + rowsToCsv(currentRun.rows));
});

$("deleteRun").addEventListener("click", async () => {
  try {
    const id = $("runs").value;
    if (!id) return;
    await rpc("WS_DELETE_RUN", { id });
    await loadRuns();
  } catch (error) {
    setStatus(error.message);
  }
});

$("screenshot").addEventListener("click", async () => {
  try {
    const dataUrl = await rpc("WS_TAKE_SCREENSHOT");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "webscrapper-screenshot-" + Date.now() + ".png";
    a.click();
    setStatus("Visible-tab screenshot saved.");
  } catch (error) {
    setStatus(error.message);
  }
});

$("fillForm").addEventListener("click", async () => {
  try {
    const fields = parseJson($("formFields").value, "Form fields");
    if (!Array.isArray(fields)) throw new Error("Form fields must be an array");
    const result = await rpc("WS_FILL_FORM", { fields });
    setStatus(result);
  } catch (error) {
    setStatus(error.message);
  }
});

$("saveJob").addEventListener("click", async () => {
  try {
    const config = configFromUi();
    config.startUrl = config.startUrl || activeContext?.url || "";
    config.useCurrentTab = false;
    if (!config.startUrl) throw new Error("A scheduled scraper needs a start URL");

    const job = await rpc("WS_SAVE_JOB", {
      job: {
        name: $("jobName").value.trim() || "Scheduled scraper",
        periodMinutes: Number($("periodMinutes").value) || 60,
        enabled: true,
        config
      }
    });
    setStatus(job);
    await loadJobs();
  } catch (error) {
    setStatus(error.message);
  }
});

$("saveSettings").addEventListener("click", async () => {
  try {
    const settings = settingsFromUi();
    await rpc("WS_SAVE_SETTINGS", { settings });
    setStatus("AI settings saved locally in extension storage.");
  } catch (error) {
    setStatus(error.message);
  }
});

Promise.all([loadContext(), loadSettings(), loadRuns(), loadJobs()])
  .then(() => setStatus("Ready."))
  .catch((error) => setStatus(error.message));
