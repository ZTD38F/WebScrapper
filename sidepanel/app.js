const $ = (id) => document.getElementById(id);
let activeContext = null;
let currentRun = null;
let schemaFields = [];

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
  syncFieldsToJson();
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

function normalizeField(field, index) {
  return {
    name: String(field?.name || "field_" + (index + 1)),
    selector: String(field?.selector || ""),
    attribute: String(field?.attribute || "text")
  };
}

function syncFieldsToJson() {
  $("fields").value = JSON.stringify(schemaFields, null, 2);
}

function renderFieldEditor() {
  const root = $("fieldEditor");
  clearNode(root);

  if (!schemaFields.length) {
    const empty = document.createElement("p");
    empty.className = "emptyState";
    empty.textContent = "No repeated records were detected. Add a field or open Advanced extraction settings.";
    root.appendChild(empty);
    syncFieldsToJson();
    return;
  }

  schemaFields.forEach((field, index) => {
    const card = document.createElement("div");
    card.className = "fieldCard";

    const row = document.createElement("div");
    row.className = "fieldRow";

    const name = document.createElement("input");
    name.value = field.name;
    name.placeholder = "Column name";
    name.setAttribute("aria-label", "Column name");
    name.addEventListener("input", () => {
      schemaFields[index].name = name.value;
      syncFieldsToJson();
    });

    const attribute = document.createElement("select");
    attribute.setAttribute("aria-label", "Value type");
    for (const [value, label] of [["text", "Text"], ["href", "Link"], ["src", "Image"], ["value", "Value"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      attribute.appendChild(option);
    }
    attribute.value = field.attribute;
    attribute.addEventListener("change", () => {
      schemaFields[index].attribute = attribute.value;
      syncFieldsToJson();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "iconButton danger";
    remove.textContent = "×";
    remove.title = "Remove field";
    remove.setAttribute("aria-label", "Remove " + field.name);
    remove.addEventListener("click", () => {
      schemaFields.splice(index, 1);
      renderFieldEditor();
    });

    row.append(name, attribute, remove);
    card.appendChild(row);

    const details = document.createElement("details");
    details.className = "fieldSelector";
    const summary = document.createElement("summary");
    summary.textContent = "Selector";
    const selector = document.createElement("input");
    selector.value = field.selector;
    selector.placeholder = ".price";
    selector.setAttribute("aria-label", "Selector for " + field.name);
    selector.addEventListener("input", () => {
      schemaFields[index].selector = selector.value;
      syncFieldsToJson();
    });
    details.append(summary, selector);
    card.appendChild(details);
    root.appendChild(card);
  });

  syncFieldsToJson();
}

function setSchema(schema) {
  $("rowSelector").value = schema?.rowSelector || "";
  schemaFields = (schema?.fields || []).map(normalizeField);
  renderFieldEditor();
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

async function analyzeCurrentPage({ quiet = false } = {}) {
  $("analyze").disabled = true;
  $("detectionSummary").textContent = "Understanding the page…";
  if (!quiet) setStatus("Analyzing current page…");

  try {
    const snapshot = await rpc("WS_ANALYZE_ACTIVE");
    setSchema(snapshot.auto);
    const count = snapshot.auto?.count || 0;
    const fieldCount = snapshot.auto?.fields?.length || 0;
    $("detectionSummary").textContent = count
      ? "Found " + count + " likely records and " + fieldCount + " suggested fields."
      : "No repeated list detected. You can add fields manually.";
    if (!quiet) {
      setStatus({
        url: snapshot.url,
        detectedRows: count,
        fields: snapshot.auto?.fields || [],
        forms: snapshot.forms?.length || 0,
        links: snapshot.links?.length || 0,
        images: snapshot.images?.length || 0
      });
    }
    return snapshot;
  } catch (error) {
    $("detectionSummary").textContent = "Automatic analysis could not run on this page.";
    throw error;
  } finally {
    $("analyze").disabled = false;
  }
}

$("analyze").addEventListener("click", () => {
  analyzeCurrentPage().catch((error) => setStatus(error.message));
});

$("addField").addEventListener("click", () => {
  schemaFields.push(normalizeField({}, schemaFields.length));
  renderFieldEditor();
  const cards = $("fieldEditor").querySelectorAll(".fieldCard");
  cards[cards.length - 1]?.querySelector("input")?.focus();
});

$("fields").addEventListener("change", () => {
  try {
    const fields = parseJson($("fields").value || "[]", "Fields");
    if (!Array.isArray(fields)) throw new Error("Fields JSON must be an array");
    schemaFields = fields.map(normalizeField);
    renderFieldEditor();
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

$("runAgent").addEventListener("click", async () => {
  try {
    const goal = $("agentGoal").value.trim();
    if (!goal) throw new Error("Enter an agent goal");
    const settings = settingsFromUi();
    await rpc("WS_SAVE_SETTINGS", { settings });
    setStatus("Agent is working…");
    const result = await rpc("WS_RUN_AGENT", {
      goal,
      maxSteps: Number($("agentMaxSteps").value) || 0,
      settings
    });
    setStatus(result);
    if (result.savedRun?.id) await loadRuns(result.savedRun.id);
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
  .then(async () => {
    await analyzeCurrentPage({ quiet: true });
    setStatus("Ready to scrape.");
  })
  .catch((error) => setStatus(error.message));
