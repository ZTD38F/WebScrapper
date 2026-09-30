const $ = (id) => document.getElementById(id);

let activeContext = null;
let currentRun = null;
let currentSettings = {};
let analysis = null;
let schema = { rowSelector: "", fields: [] };
let previewRows = [];
let busy = false;

async function rpc(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Extension command failed");
  return response.data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStatus(value) {
  const el = $("status");
  if (!el) return;
  el.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setPageState(text, kind = "") {
  const el = $("pageState");
  el.textContent = text;
  el.className = "statePill" + (kind ? " " + kind : "");
}

function setBusy(value, title = "Extracting…", text = "WebScrapper is collecting rows from the page.") {
  busy = Boolean(value);
  $("run").disabled = busy || !schema.fields.length;
  $("refreshPage").disabled = busy;
  $("reanalyze").disabled = busy;
  $("progressCard").classList.toggle("hidden", !busy);
  if (busy) {
    $("progressTitle").textContent = title;
    $("progressText").textContent = text;
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(label + " is not valid JSON: " + error.message);
  }
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function visibleKeys(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) {
      if (key.startsWith("_")) continue;
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

function renderTable(table, rows, limit = 100) {
  clearNode(table);
  const safeRows = Array.isArray(rows) ? rows.slice(0, limit) : [];
  if (!safeRows.length) return;

  const keys = visibleKeys(safeRows);
  if (!keys.length) return;

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const key of keys) {
    const th = document.createElement("th");
    th.textContent = key;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of safeRows) {
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

function csvCell(value) {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return '"' + s.replaceAll('"', '""') + '"';
}

function rowsToCsv(rows) {
  const keys = visibleKeys(rows);
  return [
    keys.map(csvCell).join(","),
    ...(rows || []).map((row) => keys.map((key) => csvCell(row?.[key])).join(","))
  ].join("\r\n");
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

function settingsFromUi() {
  return {
    ...currentSettings,
    endpoint: $("aiEndpoint").value.trim(),
    model: $("aiModel").value.trim(),
    apiKey: $("aiKey").value,
    serverUrl: $("serverUrl").value.trim(),
    serverToken: $("serverToken").value,
    useServer: $("useServer").checked,
    profileId: $("profileId").value.trim() || "default",
    remoteScreenshot: $("remoteScreenshot").checked,
    remoteVision: $("remoteVision").checked
  };
}

async function saveSettingsSilently() {
  currentSettings = settingsFromUi();
  await rpc("WS_SAVE_SETTINGS", { settings: currentSettings });
}

function syncRawSchema() {
  $("rowSelector").value = schema.rowSelector || "";
  $("fields").value = JSON.stringify(schema.fields || [], null, 2);
}

function renderFieldChips() {
  const root = $("fieldChips");
  clearNode(root);
  for (const field of schema.fields.slice(0, 8)) {
    const chip = document.createElement("span");
    chip.className = "fieldChip";
    chip.textContent = field.name || "field";
    root.appendChild(chip);
  }
  if (schema.fields.length > 8) {
    const more = document.createElement("span");
    more.className = "fieldChip";
    more.textContent = "+" + (schema.fields.length - 8);
    root.appendChild(more);
  }
}

function renderFieldsEditor() {
  const root = $("fieldsEditor");
  clearNode(root);

  schema.fields.forEach((field, index) => {
    const row = document.createElement("div");
    row.className = "fieldRow";

    const name = document.createElement("input");
    name.value = field.name || "field";
    name.setAttribute("aria-label", "Column name");
    name.addEventListener("change", async () => {
      schema.fields[index].name = name.value.trim() || "field";
      syncRawSchema();
      renderFieldChips();
      await refreshPreview().catch((error) => setStatus(error.message));
    });

    const attribute = document.createElement("select");
    attribute.setAttribute("aria-label", "Column type");
    for (const value of ["text", "href", "src", "alt", "value", "html"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "text" ? "Text" : value.toUpperCase();
      attribute.appendChild(option);
    }
    attribute.value = field.attribute || "text";
    attribute.addEventListener("change", async () => {
      schema.fields[index].attribute = attribute.value;
      syncRawSchema();
      await refreshPreview().catch((error) => setStatus(error.message));
    });

    const remove = document.createElement("button");
    remove.className = "fieldRemove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove column";
    remove.addEventListener("click", async () => {
      schema.fields.splice(index, 1);
      syncRawSchema();
      renderFieldChips();
      renderFieldsEditor();
      await refreshPreview().catch((error) => setStatus(error.message));
      $("run").disabled = !schema.fields.length;
    });

    const selector = document.createElement("div");
    selector.className = "fieldSelector";
    selector.textContent = (field.selector || ":scope") + " → " + (field.attribute || "text");

    row.append(name, attribute, remove, selector);
    root.appendChild(row);
  });
}

function updateDetectedSummary() {
  const count = Number(analysis?.auto?.count || previewRows.length || 0);
  const fieldCount = schema.fields.length;
  if (!fieldCount) {
    $("detectedSummary").textContent = "No structured list detected";
    $("paginationText").textContent = "Open Customize or Advanced to define what should be extracted.";
    return;
  }

  $("detectedSummary").textContent =
    (count ? count + " records detected" : "Data detected") + " · " + fieldCount + " columns";

  if (analysis?.pagination?.selector) {
    $("paginationQuick").classList.remove("hidden");
    $("paginationHint").textContent = analysis.pagination.text
      ? "Detected: " + analysis.pagination.text
      : "Next / Load More detected";
    $("paginationText").textContent = "The current page looks ready for one-click extraction.";
  } else {
    $("paginationQuick").classList.add("hidden");
    $("paginationText").textContent = "The current page looks ready for one-click extraction.";
  }
}

function applySchema(next, preview = []) {
  schema = {
    rowSelector: String(next?.rowSelector || ""),
    fields: Array.isArray(next?.fields) ? next.fields.map((field) => ({ ...field })) : []
  };

  if (!schema.fields.length && analysis?.url) {
    schema = {
      rowSelector: "body",
      fields: [{ name: "text", selector: ":scope", attribute: "text" }]
    };
  }

  previewRows = Array.isArray(preview) ? preview : [];
  syncRawSchema();
  renderFieldChips();
  renderFieldsEditor();
  renderTable($("previewTable"), previewRows, 12);
  $("previewCount").textContent = previewRows.length + (previewRows.length === 1 ? " row" : " rows");
  updateDetectedSummary();
  $("run").disabled = busy || !schema.fields.length;
}

async function loadContext() {
  activeContext = await rpc("WS_GET_ACTIVE_CONTEXT");
  $("pageTitle").textContent = activeContext.title || "Untitled page";
  $("pageUrl").textContent = activeContext.url || "";
  $("startUrl").placeholder = activeContext.url || "Blank = current tab";
  return activeContext;
}

async function refreshPreview() {
  if (!schema.fields.length) {
    previewRows = [];
    renderTable($("previewTable"), []);
    $("previewCount").textContent = "0 rows";
    return;
  }
  const result = await rpc("WS_PREVIEW_ACTIVE", { config: schema });
  previewRows = result?.rows || [];
  renderTable($("previewTable"), previewRows, 12);
  $("previewCount").textContent = previewRows.length + (previewRows.length === 1 ? " row" : " rows");
}

async function analyzeCurrent() {
  if (busy) return;
  setPageState("Analyzing");
  $("detectedSummary").textContent = "Analyzing page…";
  $("paginationText").textContent = "Finding repeated records and useful columns.";

  try {
    await loadContext();
    analysis = await rpc("WS_ANALYZE_ACTIVE");

    const auto = analysis?.auto || { rowSelector: "", fields: [] };
    $("pagination").value = analysis?.pagination?.selector ? "next" : "none";
    $("followPages").checked = Boolean(analysis?.pagination?.selector);

    applySchema(auto, analysis?.preview?.rows || []);
    if (!previewRows.length) await refreshPreview();

    setPageState("Ready", "ready");
    setStatus({
      page: analysis.url,
      detectedRows: analysis.auto?.count || 0,
      fields: schema.fields.map((field) => field.name),
      pagination: analysis.pagination || null
    });
  } catch (error) {
    setPageState("Unavailable", "error");
    $("detectedSummary").textContent = "Can't access the current page";
    $("paginationText").textContent = error.message;
    $("run").disabled = true;
    setStatus(error.message);
  }
}

function configFromUi() {
  let detailFields = [];
  try {
    detailFields = parseJson($("detailFields").value || "[]", "Detail fields");
  } catch (error) {
    throw error;
  }

  const follow = $("followPages").checked;
  const advancedPagination = $("pagination").value;
  const pagination = follow
    ? (advancedPagination === "none" ? "next" : advancedPagination)
    : "none";

  return {
    startUrl: $("startUrl").value.trim(),
    useCurrentTab: !$("startUrl").value.trim(),
    rowSelector: schema.rowSelector,
    fields: schema.fields.map((field) => ({ ...field })),
    pagination,
    nextSelector: $("nextSelector").value.trim(),
    maxPages: Number($("maxPages").value) || 0,
    waitMs: Number($("waitMs").value) || 1200,
    includeFrames: $("includeFrames").checked,
    detail: {
      enabled: $("detailEnabled").checked,
      urlField: $("detailUrlField").value.trim() || "url",
      rowSelector: $("detailRowSelector").value.trim(),
      fields: Array.isArray(detailFields) ? detailFields : [],
      waitMs: Number($("waitMs").value) || 1200
    }
  };
}

async function loadSettings() {
  currentSettings = await rpc("WS_GET_SETTINGS");
  $("aiEndpoint").value = currentSettings.endpoint || "";
  $("aiModel").value = currentSettings.model || "";
  $("aiKey").value = currentSettings.apiKey || "";
  $("serverUrl").value = currentSettings.serverUrl || "http://127.0.0.1:8787";
  $("serverToken").value = currentSettings.serverToken || "";
  $("useServer").checked = Boolean(currentSettings.useServer);
  $("profileId").value = currentSettings.profileId || "default";
  $("remoteScreenshot").checked = Boolean(currentSettings.remoteScreenshot);
  $("remoteVision").checked = Boolean(currentSettings.remoteVision);
}

async function loadRuns(selectId) {
  const runs = await rpc("WS_LIST_RUNS");
  const select = $("runs");
  clearNode(select);

  if (!runs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No runs yet";
    select.appendChild(option);
    currentRun = null;
    $("runMeta").textContent = "No saved runs yet.";
    renderTable($("resultsTable"), []);
    return;
  }

  for (const run of runs) {
    const option = document.createElement("option");
    option.value = run.id;
    option.textContent = (run.rowCount ?? 0) + " rows · " + (run.title || run.startUrl || "run");
    select.appendChild(option);
  }

  if (selectId && runs.some((run) => run.id === selectId)) select.value = selectId;
  await openRun(select.value);
}

async function openRun(id) {
  if (!id) return;
  currentRun = await rpc("WS_GET_RUN", { id });
  const meta = currentRun?.meta;
  if (!meta) return;
  const when = meta.createdAt ? new Date(meta.createdAt).toLocaleString() : "";
  $("runMeta").textContent =
    currentRun.rows.length + " rows · " + (meta.pages || 1) + " pages" +
    (meta.stopReason ? " · " + meta.stopReason : "") +
    (when ? " · " + when : "");
  renderTable($("resultsTable"), currentRun.rows, 100);
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

    const title = document.createElement("strong");
    title.textContent = job.name + " · " + job.periodMinutes + " min";

    const actions = document.createElement("div");
    actions.className = "inlineActions";

    const run = document.createElement("button");
    run.className = "ghostButton";
    run.textContent = "Run";
    run.addEventListener("click", async () => {
      try {
        setStatus("Running scheduled scraper…");
        const result = await rpc("WS_RUN_JOB", { id: job.id });
        await loadRuns(result.meta?.id);
        await loadJobs();
        setStatus(result.meta || result);
      } catch (error) {
        setStatus(error.message);
      }
    });

    const del = document.createElement("button");
    del.className = "ghostButton dangerText";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      await rpc("WS_DELETE_JOB", { id: job.id });
      await loadJobs();
    });

    actions.append(run, del);
    row.append(title, actions);
    card.appendChild(row);

    if (job.lastError) {
      const note = document.createElement("p");
      note.className = "helperText";
      note.textContent = "Last error: " + job.lastError;
      card.appendChild(note);
    }
    root.appendChild(card);
  }
}

async function importRemoteResult(job) {
  const result = job?.result;
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (!rows.length) return null;

  const saved = await rpc("WS_CREATE_RUN", {
    meta: {
      source: "server",
      title: result.title || activeContext?.title || "Server extraction",
      startUrl: result.url || activeContext?.url || "",
      endUrl: result.endUrl || result.url || "",
      pages: result.pages || 1,
      stopReason: result.stopReason || "completed",
      fields: result.schema?.fields || schema.fields
    },
    rows
  });
  return saved?.meta?.id || null;
}

async function runOnServer(config) {
  await saveSettingsSilently();
  $("progressValue").textContent = "Queued";
  $("progressText").textContent = "Sending the extraction to your self-hosted worker…";

  let job = await rpc("WS_SERVER_ENQUEUE", {
    config,
    settings: currentSettings,
    options: {
      profileId: $("profileId").value.trim() || "default",
      screenshot: $("remoteScreenshot").checked,
      vision: $("remoteVision").checked
    }
  });

  while (["queued", "running"].includes(String(job?.status))) {
    $("progressValue").textContent = job.status === "running" ? "Running" : "Queued";
    $("progressText").textContent =
      job.status === "running"
        ? "The self-hosted browser is extracting the page."
        : "Waiting for a server worker.";
    await sleep(1100);
    job = await rpc("WS_SERVER_GET_JOB", { id: job.id, settings: currentSettings });
  }

  if (job?.status !== "succeeded") {
    throw new Error(job?.error || "Server extraction ended with status " + String(job?.status || "unknown"));
  }

  const localId = await importRemoteResult(job);
  if (localId) await loadRuns(localId);
  return job;
}

async function runExtraction(forceServer = false) {
  if (busy) return;
  if (!schema.fields.length) await analyzeCurrent();
  if (!schema.fields.length) throw new Error("No fields are configured");

  const config = configFromUi();
  setBusy(true, "Extracting…", "Collecting rows and following the page when needed.");
  setPageState("Extracting");
  $("progressValue").textContent = "Working";

  try {
    const shouldUseServer = forceServer || $("useServer").checked;
    let result;

    if (shouldUseServer) {
      result = await runOnServer(config);
      setStatus(result);
    } else {
      result = await rpc("WS_RUN_SCRAPER", { config });
      await loadRuns(result.meta.id);
      setStatus(result.meta);
    }

    setPageState("Done", "ready");
    $("progressValue").textContent = "Done";
    $("progressText").textContent = "Extraction completed successfully.";
  } finally {
    setBusy(false);
  }
}

$("refreshPage").addEventListener("click", () => analyzeCurrent());
$("reanalyze").addEventListener("click", () => analyzeCurrent());

$("customizeExtraction").addEventListener("click", () => {
  $("customizer").classList.toggle("hidden");
});

$("addField").addEventListener("click", async () => {
  let number = schema.fields.length + 1;
  const names = new Set(schema.fields.map((field) => field.name));
  let name = "column_" + number;
  while (names.has(name)) name = "column_" + (++number);
  schema.fields.push({ name, selector: ":scope", attribute: "text" });
  syncRawSchema();
  renderFieldChips();
  renderFieldsEditor();
  $("customizer").classList.remove("hidden");
  await refreshPreview().catch((error) => setStatus(error.message));
});

$("run").addEventListener("click", async () => {
  try {
    await runExtraction(false);
  } catch (error) {
    setPageState("Error", "error");
    setStatus(error.message);
  }
});

$("runRemote").addEventListener("click", async () => {
  try {
    await runExtraction(true);
  } catch (error) {
    $("serverStatus").textContent = error.message;
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
    setStatus("Screenshot saved.");
  } catch (error) {
    setStatus(error.message);
  }
});

$("runs").addEventListener("change", async () => {
  try {
    await openRun($("runs").value);
  } catch (error) {
    setStatus(error.message);
  }
});

$("refreshRuns").addEventListener("click", () => loadRuns().catch((error) => setStatus(error.message)));

$("exportJson").addEventListener("click", () => {
  if (!currentRun) return setStatus("Run an extraction first.");
  downloadBlob(
    "webscrapper-" + currentRun.meta.id + ".json",
    "application/json",
    JSON.stringify(currentRun.rows, null, 2)
  );
});

$("exportCsv").addEventListener("click", () => {
  if (!currentRun) return setStatus("Run an extraction first.");
  downloadBlob(
    "webscrapper-" + currentRun.meta.id + ".csv",
    "text/csv;charset=utf-8",
    "\ufeff" + rowsToCsv(currentRun.rows)
  );
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

$("runBulk").addEventListener("click", async () => {
  try {
    const urls = $("bulkUrls").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!urls.length) throw new Error("Add at least one URL");
    setBusy(true, "Bulk extraction…", "Processing " + urls.length + " URLs.");
    const result = await rpc("WS_RUN_BULK", { config: configFromUi(), urls });
    await loadRuns(result.runs?.at(-1)?.id);
    setStatus(result);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
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

$("runAgent").addEventListener("click", async () => {
  try {
    const goal = $("agentGoal").value.trim();
    if (!goal) throw new Error("Enter an agent goal");
    await saveSettingsSilently();
    setBusy(true, "AI agent…", "The agent is observing the page and choosing safe browser actions.");
    const result = await rpc("WS_RUN_AGENT", {
      goal,
      maxSteps: Number($("agentMaxSteps").value) || 0,
      settings: currentSettings
    });
    if (result.savedRun?.id) await loadRuns(result.savedRun.id);
    setStatus(result);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
});

$("saveJob").addEventListener("click", async () => {
  try {
    const config = configFromUi();
    config.startUrl = config.startUrl || activeContext?.url || "";
    config.useCurrentTab = false;
    if (!config.startUrl) throw new Error("A scheduled scraper needs a page URL");

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

$("serverHealth").addEventListener("click", async () => {
  try {
    await saveSettingsSilently();
    $("serverStatus").textContent = "Testing…";
    const health = await rpc("WS_SERVER_HEALTH", { settings: currentSettings });
    $("serverStatus").textContent =
      "Connected · " + (health.workers || 1) + " worker" + ((health.workers || 1) === 1 ? "" : "s");
    setStatus(health);
  } catch (error) {
    $("serverStatus").textContent = error.message;
    setStatus(error.message);
  }
});

$("viewAllTools").addEventListener("click", () => {
  $("advancedPanel").classList.remove("hidden");
  $("advancedPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("closeAdvanced").addEventListener("click", () => {
  $("advancedPanel").classList.add("hidden");
});

$("fields").addEventListener("change", async () => {
  try {
    const fields = parseJson($("fields").value || "[]", "Raw fields");
    if (!Array.isArray(fields)) throw new Error("Raw fields must be an array");
    schema.fields = fields;
    schema.rowSelector = $("rowSelector").value.trim();
    renderFieldChips();
    renderFieldsEditor();
    await refreshPreview();
  } catch (error) {
    setStatus(error.message);
  }
});

$("rowSelector").addEventListener("change", async () => {
  schema.rowSelector = $("rowSelector").value.trim();
  await refreshPreview().catch((error) => setStatus(error.message));
});

$("followPages").addEventListener("change", () => {
  if ($("followPages").checked && $("pagination").value === "none") $("pagination").value = "next";
});

$("aiSuggest").addEventListener("click", async () => {
  try {
    await saveSettingsSilently();
    setBusy(true, "AI field detection…", "Asking your configured model for a declarative extraction schema.");
    const suggested = await rpc("WS_AI_SUGGEST", { settings: currentSettings });
    applySchema(suggested, []);
    await refreshPreview();
    $("customizer").classList.remove("hidden");
    setStatus(suggested);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
});

$("saveSettings").addEventListener("click", async () => {
  try {
    await saveSettingsSilently();
    setStatus("Settings saved locally.");
  } catch (error) {
    setStatus(error.message);
  }
});

async function boot() {
  try {
    await Promise.all([loadSettings(), loadRuns(), loadJobs()]);
    await analyzeCurrent();
  } catch (error) {
    setPageState("Error", "error");
    setStatus(error.message);
  }
}

boot();
