import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { withPersistentProfile } from "./browser.js";
import { inferSchemaFromText, inferSchemaFromVision } from "./ai.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpUrl(value) {
  const url = new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) URLs are supported");
  return url.href;
}

function safeName(value) {
  return String(value || "artifact").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140);
}

function normalizeSpec(payload = {}) {
  return {
    url: httpUrl(payload.url || payload.startUrl),
    profileId: String(payload.profileId || "default"),
    rowSelector: String(payload.rowSelector || ""),
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    pagination: ["none", "next", "infinite"].includes(payload.pagination) ? payload.pagination : "none",
    nextSelector: String(payload.nextSelector || ""),
    maxPages: Math.max(0, Math.floor(Number(payload.maxPages) || 0)),
    waitMs: Math.max(100, Math.floor(Number(payload.waitMs) || 1000)),
    screenshot: Boolean(payload.screenshot),
    vision: Boolean(payload.vision),
    ai: payload.ai && typeof payload.ai === "object" ? payload.ai : {},
    detail: {
      enabled: Boolean(payload.detail?.enabled),
      urlField: String(payload.detail?.urlField || "url"),
      rowSelector: String(payload.detail?.rowSelector || ""),
      fields: Array.isArray(payload.detail?.fields) ? payload.detail.fields : [],
      waitMs: Math.max(100, Math.floor(Number(payload.detail?.waitMs) || Number(payload.waitMs) || 1000))
    }
  };
}

async function detectSchema(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden";
    };
    const safeClasses = (el) => Array.from(el.classList || [])
      .filter((c) => c && c.length < 48 && !/[0-9a-f]{12,}/i.test(c))
      .slice(0, 3);
    const esc = (v) => CSS.escape(String(v));

    const selectorFor = (el, stop) => {
      if (!el || !(el instanceof Element)) return "";
      if (el.id && document.querySelectorAll("#" + esc(el.id)).length === 1) return "#" + esc(el.id);
      const parts = [];
      let cur = el;
      while (cur && cur !== stop && cur !== document.documentElement) {
        let part = cur.tagName.toLowerCase();
        const cls = safeClasses(cur);
        if (cls.length) part += cls.map((c) => "." + esc(c)).join("");
        parts.unshift(part);
        cur = cur.parentElement;
        if (parts.length >= 5) break;
      }
      return parts.join(" > ");
    };

    const relative = (root, el) => {
      if (root === el) return ":scope";
      const parts = [];
      let cur = el;
      while (cur && cur !== root) {
        let part = cur.tagName.toLowerCase();
        const cls = safeClasses(cur).slice(0, 2);
        if (cls.length) part += cls.map((c) => "." + esc(c)).join("");
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    };

    let best = null;
    for (const parent of Array.from(document.body?.querySelectorAll("*") || []).slice(0, 15000)) {
      const children = Array.from(parent.children || []).filter(visible);
      if (children.length < 3 || children.length > 300) continue;
      const groups = new Map();
      for (const child of children) {
        const key = child.tagName + "|" + safeClasses(child).slice(0, 2).sort().join(".");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(child);
      }
      for (const group of groups.values()) {
        if (group.length < 3) continue;
        const ratio = group.length / children.length;
        if (ratio < 0.45) continue;
        const avgText = group.slice(0, 8).reduce((n, el) => n + clean(el.innerText).length, 0) / Math.min(8, group.length);
        if (avgText < 5) continue;
        const score = group.length * ratio * Math.log2(avgText + 2);
        if (!best || score > best.score) best = { parent, group, score };
      }
    }

    if (!best) return { rowSelector: "", fields: [] };
    const card = best.group[0];
    let rowSelector = selectorFor(card);
    const cls = safeClasses(card);
    if (cls.length) {
      const simple = card.tagName.toLowerCase() + cls.map((c) => "." + esc(c)).join("");
      if (document.querySelectorAll(simple).length >= best.group.length) rowSelector = simple;
    }

    const fields = [];
    const add = (name, el, attribute) => {
      if (!el) return;
      const selector = relative(card, el);
      if (!selector) return;
      if (fields.some((f) => f.selector === selector && f.attribute === attribute)) return;
      let n = name;
      let i = 2;
      while (fields.some((f) => f.name === n)) n = name + "_" + i++;
      fields.push({ name: n, selector, attribute });
    };

    const title = card.querySelector("h1,h2,h3,h4,[role=heading],strong,b");
    if (title) add("title", title, "text");
    const link = card.querySelector("a[href]");
    if (link) {
      if (!title && clean(link.innerText)) add("title", link, "text");
      add("url", link, "href");
    }
    const image = card.querySelector("img[src],img[data-src]");
    if (image) add("image", image, "src");

    const priceRx = /(?:€|\$|£|¥|₹|₽|USD|EUR|GBP)\s*\d|\d[\d\s.,]*\s*(?:€|\$|£|¥|₹|₽|USD|EUR|GBP)/i;
    const candidates = Array.from(card.querySelectorAll("*")).filter((el) => el.children.length < 4 && clean(el.innerText).length < 160);
    const price = candidates.find((el) => priceRx.test(clean(el.innerText)));
    if (price) add("price", price, "text");

    return { rowSelector, fields };
  });
}

async function pageSnapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: String(document.body?.innerText || "").slice(0, 160000),
    htmlSample: String(document.body?.outerHTML || "").slice(0, 200000)
  }));
}

async function extractRows(page, schema) {
  const rowSelector = String(schema.rowSelector || "").trim();
  const fields = Array.isArray(schema.fields) ? schema.fields : [];

  return page.evaluate(({ rowSelector, fields }) => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const roots = rowSelector ? Array.from(document.querySelectorAll(rowSelector)) : [document.body];

    const valueOf = (el, attribute) => {
      if (!el) return "";
      if (attribute === "text") return clean(el.innerText || el.textContent);
      if (attribute === "html") return el.innerHTML || "";
      if (attribute === "href") return el.href || el.getAttribute("href") || "";
      if (attribute === "src") return el.currentSrc || el.src || el.getAttribute("src") || el.getAttribute("data-src") || "";
      if (attribute === "value") return "value" in el ? el.value : el.getAttribute("value") || "";
      return "";
    };

    return roots.map((root, index) => {
      const row = {};
      for (const field of fields) {
        let target = root;
        if (field.selector && field.selector !== ":scope") {
          try { target = root.querySelector(field.selector); } catch { target = null; }
        }
        row[field.name || "field"] = valueOf(target, field.attribute || "text");
      }
      row._sourceUrl = location.href;
      row._row = index;
      return row;
    });
  }, { rowSelector, fields });
}

async function findNextSelector(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return Boolean(r.width && r.height);
    };
    const direct = document.querySelector("a[rel=next]");
    if (direct && visible(direct)) return "a[rel=next]";
    const rx = /^(next|next page|more|load more|continue|›|»|→|след|далее|nākam)/i;
    const candidates = Array.from(document.querySelectorAll("a,button,[role=button]")).filter(visible);
    for (const el of candidates) {
      const label = String(el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim();
      if (!rx.test(label)) continue;
      if (el.id) return "#" + CSS.escape(el.id);
      const classes = Array.from(el.classList || []).filter(Boolean).slice(0, 3);
      const selector = el.tagName.toLowerCase() + classes.map((c) => "." + CSS.escape(c)).join("");
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch {}
    }
    return "";
  });
}

function rowKey(row) {
  return JSON.stringify(Object.entries(row || {}).filter(([key]) => key !== "_row").sort(([a],[b]) => a.localeCompare(b)));
}

async function screenshotArtifact(page, jobId, name = "full-page.jpg") {
  const dir = path.join(config.artifactsDir, safeName(jobId));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, safeName(name));
  await page.screenshot({
    path: filePath,
    fullPage: true,
    type: "jpeg",
    quality: config.screenshotQuality
  });
  return {
    name: path.basename(filePath),
    path: filePath,
    relativePath: path.relative(config.artifactsDir, filePath).replaceAll(path.sep, "/")
  };
}

async function enrichDetails(context, rows, detail, isCancelled) {
  if (!detail.enabled || !detail.fields.length) return rows;
  const page = await context.newPage();
  try {
    for (let index = 0; index < rows.length; index += 1) {
      if (await isCancelled()) throw new Error("JOB_CANCELLED");
      const row = rows[index];
      const url = row?.[detail.urlField];
      if (!url || !/^https?:\/\//i.test(String(url))) continue;
      await page.goto(String(url), { waitUntil: "domcontentloaded" });
      await sleep(detail.waitMs);
      const extracted = await extractRows(page, {
        rowSelector: detail.rowSelector,
        fields: detail.fields
      });
      const first = extracted[0] || {};
      for (const [key, value] of Object.entries(first)) {
        if (key.startsWith("_")) continue;
        const outKey = Object.prototype.hasOwnProperty.call(row, key) && row[key] !== "" ? "detail_" + key : key;
        row[outKey] = value;
      }
      row._detailUrl = String(url);
    }
    return rows;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function executeScrapeJob({ jobId, payload, isCancelled = async () => false, heartbeat = async () => {} }) {
  const spec = normalizeSpec(payload);
  const started = Date.now();

  const ensureRunning = async () => {
    if (await isCancelled()) throw new Error("JOB_CANCELLED");
    if (config.maxJobMs > 0 && Date.now() - started > config.maxJobMs) throw new Error("JOB_TIMEOUT");
    await heartbeat();
  };

  return withPersistentProfile(spec.profileId, async ({ context, page, profileId }) => {
    await ensureRunning();
    await page.goto(spec.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    let schema = { rowSelector: spec.rowSelector, fields: spec.fields };
    const artifacts = [];

    if (!schema.rowSelector || !schema.fields.length) {
      const local = await detectSchema(page);
      schema = {
        rowSelector: schema.rowSelector || local.rowSelector,
        fields: schema.fields.length ? schema.fields : local.fields
      };
    }

    if (spec.vision) {
      const imageBuffer = await page.screenshot({
        fullPage: true,
        type: "jpeg",
        quality: config.screenshotQuality
      });
      const snap = await pageSnapshot(page);
      schema = await inferSchemaFromVision({ ...snap, imageBuffer }, spec.ai);
    } else if ((!schema.rowSelector || !schema.fields.length) && (spec.ai.endpoint || config.ai.endpoint)) {
      schema = await inferSchemaFromText(await pageSnapshot(page), spec.ai);
    }

    const rows = [];
    const seen = new Set();
    let pages = 0;
    let stagnation = 0;
    let stopReason = "completed";

    while (true) {
      await ensureRunning();
      pages += 1;

      const batch = await extractRows(page, schema);
      let added = 0;
      for (const row of batch) {
        const key = rowKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ ...row, _page: pages });
        added += 1;
      }

      if (spec.maxPages > 0 && pages >= spec.maxPages) {
        stopReason = "max-pages";
        break;
      }
      if (spec.pagination === "none") break;

      if (spec.pagination === "infinite") {
        const before = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await sleep(spec.waitMs);
        const after = await page.evaluate(() => document.documentElement.scrollHeight);
        if (!added && after <= before) stagnation += 1;
        else stagnation = 0;
        if (stagnation >= 3) {
          stopReason = "no-more-content";
          break;
        }
        continue;
      }

      let selector = spec.nextSelector;
      if (!selector) selector = await findNextSelector(page);
      if (!selector) {
        stopReason = "no-next-button";
        break;
      }

      const beforeUrl = page.url();
      const beforeBody = await page.locator("body").innerText().catch(() => "");
      const locator = page.locator(selector).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      await sleep(spec.waitMs);
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});

      const afterUrl = page.url();
      const afterBody = await page.locator("body").innerText().catch(() => "");
      if (beforeUrl === afterUrl && beforeBody === afterBody) {
        stopReason = "page-did-not-change";
        break;
      }
    }

    await enrichDetails(context, rows, spec.detail, isCancelled);

    if (spec.screenshot) {
      artifacts.push(await screenshotArtifact(page, jobId));
    }

    return {
      url: spec.url,
      endUrl: page.url(),
      profileId,
      pages,
      rowCount: rows.length,
      stopReason,
      schema,
      rows,
      artifacts,
      elapsedMs: Date.now() - started
    };
  });
}
