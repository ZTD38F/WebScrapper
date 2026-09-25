import { saveRun, listRuns, getRun, deleteRun } from "./db.js";
import { inferFieldsWithProvider } from "./ai.js";

const JOBS_KEY = "ws_jobs_v1";
const SETTINGS_KEY = "ws_settings_v1";
const ALARM_PREFIX = "ws-job:";
const runningJobs = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  throw new Error(message);
}

function canScript(url) {
  return /^https?:\/\//i.test(String(url || "")) || /^file:\/\//i.test(String(url || ""));
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.id) fail("No active tab");
  return tab;
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) fail("Target tab was closed");
    if (tab.status === "complete") {
      await sleep(250);
      return tab;
    }
    await sleep(200);
  }
  fail("Timed out waiting for page load");
}

async function ensureContent(tabId, frameId = 0) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "WS_PING" }, { frameId });
    if (response?.ok) return;
  } catch (_) {}

  const tab = await chrome.tabs.get(tabId);
  if (!canScript(tab.url)) fail("This browser page cannot be scripted: " + String(tab.url || ""));

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["src/content.js"]
  });
  await sleep(100);
}

async function sendContent(tabId, message, frameId = 0) {
  await ensureContent(tabId, frameId);
  const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
  if (!response?.ok) fail(response?.error || "Content command failed");
  return response.data;
}

async function allFrameIds(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  if (!Array.isArray(frames) || !frames.length) return [0];
  return frames.map((f) => f.frameId);
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

async function putSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings || {} });
  return settings || {};
}

async function getJobs() {
  const data = await chrome.storage.local.get(JOBS_KEY);
  return Array.isArray(data[JOBS_KEY]) ? data[JOBS_KEY] : [];
}

async function putJobs(jobs) {
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
}

function normalizedConfig(input = {}) {
  return {
    startUrl: String(input.startUrl || "").trim(),
    useCurrentTab: Boolean(input.useCurrentTab),
    rowSelector: String(input.rowSelector || "").trim(),
    fields: Array.isArray(input.fields) ? input.fields : [],
    pagination: ["none", "next", "infinite"].includes(input.pagination) ? input.pagination : "none",
    nextSelector: String(input.nextSelector || "").trim(),
    maxPages: Math.max(0, Number(input.maxPages) || 0),
    waitMs: Math.max(250, Number(input.waitMs) || 1200),
    includeFrames: Boolean(input.includeFrames)
  };
}

function stableRowKey(row) {
  const entries = Object.entries(row || {})
    .filter(([key]) => key !== "_row")
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

async function scrapeFrames(tabId, config, pageNumber) {
  const frameIds = config.includeFrames ? await allFrameIds(tabId) : [0];
  const rows = [];
  let learnedFields = config.fields;

  for (const frameId of frameIds) {
    try {
      const result = await sendContent(tabId, {
        type: "WS_SCRAPE",
        config: { rowSelector: config.rowSelector, fields: learnedFields }
      }, frameId);

      if ((!learnedFields || !learnedFields.length) && result.fields?.length) {
        learnedFields = result.fields;
      }

      for (const row of result.rows || []) {
        rows.push({
          ...row,
          _frameId: frameId,
          _page: pageNumber
        });
      }
    } catch (error) {
      if (frameId === 0) throw error;
    }
  }

  return { rows, fields: learnedFields || [] };
}

async function waitForPageChange(tabId, before, minimumWait) {
  await sleep(minimumWait);
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const current = await sendContent(tabId, { type: "WS_GET_META" }, 0);
      if (current.url !== before.url || current.signature !== before.signature) return current;
    } catch (_) {
      await sleep(250);
      continue;
    }
    await sleep(350);
  }

  return null;
}

async function runScraper(rawConfig, source = "manual") {
  const config = normalizedConfig(rawConfig);
  let tab;
  let ownsTab = false;

  if (config.startUrl && !config.useCurrentTab) {
    tab = await chrome.tabs.create({ url: config.startUrl, active: false });
    ownsTab = true;
    await waitForTabComplete(tab.id);
  } else {
    tab = await activeTab();
    if (!canScript(tab.url)) fail("Open a normal HTTP(S) page first");
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const seen = new Set();
  const rows = [];
  let learnedFields = config.fields;
  let pageNumber = 0;
  let stagnation = 0;
  let stopReason = "completed";

  try {
    while (true) {
      pageNumber += 1;
      const pageConfig = { ...config, fields: learnedFields };
      const scraped = await scrapeFrames(tab.id, pageConfig, pageNumber);
      learnedFields = scraped.fields;

      let added = 0;
      for (const row of scraped.rows) {
        const key = stableRowKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
        added += 1;
      }

      if (config.maxPages > 0 && pageNumber >= config.maxPages) {
        stopReason = "max-pages";
        break;
      }

      if (config.pagination === "none") break;

      if (config.pagination === "infinite") {
        const scroll = await sendContent(tab.id, { type: "WS_SCROLL_MORE" }, 0);
        await sleep(config.waitMs);
        if (added === 0 && !scroll.changed) stagnation += 1;
        else stagnation = 0;
        if (stagnation >= 3) {
          stopReason = "no-more-content";
          break;
        }
        continue;
      }

      if (config.pagination === "next") {
        const before = await sendContent(tab.id, { type: "WS_GET_META" }, 0);
        let selector = config.nextSelector;
        if (!selector) {
          const next = await sendContent(tab.id, { type: "WS_FIND_NEXT" }, 0);
          selector = next?.selector || "";
        }

        if (!selector) {
          stopReason = "no-next-button";
          break;
        }

        await sendContent(tab.id, { type: "WS_CLICK", selector }, 0);
        const changed = await waitForPageChange(tab.id, before, config.waitMs);
        if (!changed) {
          stopReason = "page-did-not-change";
          break;
        }
        await waitForTabComplete(tab.id, 5000).catch(() => null);
      }
    }

    const endedAt = new Date().toISOString();
    const currentTab = await chrome.tabs.get(tab.id).catch(() => tab);
    const meta = {
      id: runId,
      source,
      createdAt: startedAt,
      endedAt,
      startUrl: config.startUrl || tab.url || "",
      endUrl: currentTab?.url || "",
      title: currentTab?.title || "",
      pages: pageNumber,
      stopReason,
      fields: learnedFields
    };

    await saveRun(meta, rows);
    return { meta: { ...meta, rowCount: rows.length }, rows };
  } finally {
    if (ownsTab && tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function saveJob(jobInput) {
  const jobs = await getJobs();
  const id = jobInput.id || crypto.randomUUID();
  const periodMinutes = Math.max(0.5, Number(jobInput.periodMinutes) || 60);
  const job = {
    id,
    name: String(jobInput.name || "Scheduled scraper"),
    enabled: jobInput.enabled !== false,
    periodMinutes,
    config: normalizedConfig({
      ...(jobInput.config || {}),
      startUrl: jobInput.config?.startUrl || jobInput.url || "",
      useCurrentTab: false
    }),
    createdAt: jobInput.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunAt: jobInput.lastRunAt || null,
    lastError: jobInput.lastError || null
  };

  const index = jobs.findIndex((x) => x.id === id);
  if (index >= 0) jobs[index] = job;
  else jobs.push(job);
  await putJobs(jobs);

  await chrome.alarms.clear(ALARM_PREFIX + id);
  if (job.enabled) {
    await chrome.alarms.create(ALARM_PREFIX + id, { periodInMinutes });
  }
  return job;
}

async function removeJob(id) {
  const jobs = (await getJobs()).filter((job) => job.id !== id);
  await putJobs(jobs);
  await chrome.alarms.clear(ALARM_PREFIX + id);
}

async function updateJobResult(id, error) {
  const jobs = await getJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return;
  jobs[index] = {
    ...jobs[index],
    lastRunAt: new Date().toISOString(),
    lastError: error ? String(error) : null
  };
  await putJobs(jobs);
}

async function runJob(id) {
  if (runningJobs.has(id)) return { skipped: true, reason: "already-running" };
  const jobs = await getJobs();
  const job = jobs.find((x) => x.id === id);
  if (!job) fail("Scheduled job not found");
  if (!job.config.startUrl) fail("Scheduled job needs a start URL");

  runningJobs.add(id);
  try {
    const result = await runScraper(job.config, "schedule:" + id);
    await updateJobResult(id, null);
    return result;
  } catch (error) {
    await updateJobResult(id, error?.message || String(error));
    throw error;
  } finally {
    runningJobs.delete(id);
  }
}

async function syncAlarms() {
  const jobs = await getJobs();
  for (const job of jobs) {
    await chrome.alarms.clear(ALARM_PREFIX + job.id);
    if (job.enabled) {
      await chrome.alarms.create(ALARM_PREFIX + job.id, {
        periodInMinutes: Math.max(0.5, Number(job.periodMinutes) || 60)
      });
    }
  }
}

async function openPanelForCurrentWindow() {
  const win = await chrome.windows.getLastFocused();
  if (win?.id) await chrome.sidePanel.open({ windowId: win.id });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  syncAlarms().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarms().catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-side-panel") openPanelForCurrentWindow().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const id = alarm.name.slice(ALARM_PREFIX.length);
  runJob(id).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case "WS_GET_ACTIVE_CONTEXT": {
        const tab = await activeTab();
        return { tabId: tab.id, url: tab.url || "", title: tab.title || "" };
      }
      case "WS_ANALYZE_ACTIVE": {
        const tab = await activeTab();
        return sendContent(tab.id, { type: "WS_ANALYZE" }, 0);
      }
      case "WS_AI_SUGGEST": {
        const tab = await activeTab();
        const snapshot = await sendContent(tab.id, { type: "WS_ANALYZE" }, 0);
        const settings = message.settings || await getSettings();
        return inferFieldsWithProvider(snapshot, settings);
      }
      case "WS_RUN_SCRAPER":
        return runScraper(message.config || {}, "manual");
      case "WS_LIST_RUNS":
        return listRuns();
      case "WS_GET_RUN":
        return getRun(message.id);
      case "WS_DELETE_RUN":
        await deleteRun(message.id);
        return true;
      case "WS_LIST_JOBS":
        return getJobs();
      case "WS_SAVE_JOB":
        return saveJob(message.job || {});
      case "WS_DELETE_JOB":
        await removeJob(message.id);
        return true;
      case "WS_RUN_JOB":
        return runJob(message.id);
      case "WS_GET_SETTINGS":
        return getSettings();
      case "WS_SAVE_SETTINGS":
        return putSettings(message.settings || {});
      case "WS_TAKE_SCREENSHOT": {
        const tab = await activeTab();
        return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      }
      case "WS_FILL_FORM": {
        const tab = await activeTab();
        return sendContent(tab.id, { type: "WS_FILL_FORM", fields: message.fields || [] }, 0);
      }
      default:
        fail("Unknown background command: " + String(message?.type));
    }
  };

  handle()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
