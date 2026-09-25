(() => {
  "use strict";

  if (globalThis.__WEBSCRAPPER_CONTENT_LOADED__) return;
  globalThis.__WEBSCRAPPER_CONTENT_LOADED__ = true;

  const esc = (value) => {
    if (globalThis.CSS && typeof CSS.escape === "function") return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
  };

  const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

  function hashString(input) {
    let h = 2166136261;
    const s = String(input);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function getRoots() {
    const roots = [document];
    const seen = new Set(roots);
    let cursor = 0;
    while (cursor < roots.length) {
      const root = roots[cursor++];
      const elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const el of elements) {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot);
          roots.push(el.shadowRoot);
        }
      }
    }
    return roots;
  }

  function queryAllDeep(selector, root) {
    if (root && root.querySelectorAll) return Array.from(root.querySelectorAll(selector));
    const out = [];
    const seen = new Set();
    for (const r of getRoots()) {
      for (const el of r.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    }
    return out;
  }

  function queryOneDeep(selector, root) {
    if (root && root.querySelector) return root.querySelector(selector);
    for (const r of getRoots()) {
      const el = r.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }

  function stableClasses(el) {
    return Array.from(el.classList || [])
      .filter((c) => c && c.length <= 48 && !/^css-[a-z0-9]{6,}$/i.test(c) && !/[0-9a-f]{12,}/i.test(c))
      .slice(0, 3);
  }

  function segmentFor(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && document.querySelectorAll("#" + esc(el.id)).length === 1) return "#" + esc(el.id);
    const classes = stableClasses(el);
    let segment = tag + classes.map((c) => "." + esc(c)).join("");
    if (!el.parentElement) return segment;
    try {
      const same = Array.from(el.parentElement.children).filter((x) => x.matches(segment));
      if (same.length > 1) segment += ":nth-of-type(" + (Array.from(el.parentElement.children).indexOf(el) + 1) + ")";
    } catch (_) {}
    return segment;
  }

  function selectorFor(el, stopAt) {
    if (!(el instanceof Element)) return "";
    if (el.id && document.querySelectorAll("#" + esc(el.id)).length === 1) return "#" + esc(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur instanceof Element && cur !== stopAt && cur !== document.documentElement) {
      parts.unshift(segmentFor(cur));
      if (parts[0].startsWith("#")) break;
      cur = cur.parentElement;
      if (parts.length >= 6) break;
    }
    return parts.join(" > ");
  }

  function relativeSelector(root, el) {
    if (root === el) return ":scope";
    const directId = el.id ? "#" + esc(el.id) : "";
    if (directId) {
      try {
        if (root.querySelectorAll(directId).length === 1) return directId;
      } catch (_) {}
    }
    const parts = [];
    let cur = el;
    while (cur && cur !== root && cur instanceof Element) {
      let part = cur.tagName.toLowerCase();
      const classes = stableClasses(cur).slice(0, 2);
      if (classes.length) part += classes.map((c) => "." + esc(c)).join("");
      if (cur.parentElement) {
        try {
          const matches = Array.from(cur.parentElement.children).filter((x) => x.matches(part));
          if (matches.length > 1) {
            const sameTag = Array.from(cur.parentElement.children).filter((x) => x.tagName === cur.tagName);
            part += ":nth-of-type(" + (sameTag.indexOf(cur) + 1) + ")";
          }
        } catch (_) {}
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function childFingerprint(el) {
    const tag = el.tagName.toLowerCase();
    const classes = stableClasses(el).slice(0, 2).sort();
    return tag + "|" + classes.join(".");
  }

  function findRepeatedRegion() {
    const candidates = [];
    const all = queryAllDeep("body *").slice(0, 12000);

    for (const parent of all) {
      const children = Array.from(parent.children || []).filter(visible);
      if (children.length < 3 || children.length > 300) continue;

      const groups = new Map();
      for (const child of children) {
        const fp = childFingerprint(child);
        if (!groups.has(fp)) groups.set(fp, []);
        groups.get(fp).push(child);
      }

      for (const group of groups.values()) {
        if (group.length < 3) continue;
        const ratio = group.length / children.length;
        if (ratio < 0.45) continue;
        const textAmount = group.slice(0, 8).reduce((n, el) => n + cleanText(el.innerText).length, 0);
        const avgText = textAmount / Math.min(group.length, 8);
        if (avgText < 6) continue;
        const area = group.slice(0, 8).reduce((n, el) => {
          const r = el.getBoundingClientRect();
          return n + r.width * r.height;
        }, 0);
        const score = group.length * ratio * Math.log2(avgText + 2) * Math.log2(area / Math.max(1, Math.min(group.length, 8)) + 2);
        candidates.push({ parent, group, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;

    const sample = best.group[0];
    let rowSelector = selectorFor(sample);
    const classes = stableClasses(sample);
    if (classes.length) {
      const simple = sample.tagName.toLowerCase() + classes.map((c) => "." + esc(c)).join("");
      try {
        if (document.querySelectorAll(simple).length >= best.group.length) rowSelector = simple;
      } catch (_) {}
    }

    return {
      rowSelector,
      parentSelector: selectorFor(best.parent),
      count: best.group.length,
      sample,
      parent: best.parent
    };
  }

  function uniqueFieldName(base, fields) {
    let name = base;
    let i = 2;
    const used = new Set(fields.map((f) => f.name));
    while (used.has(name)) name = base + "_" + i++;
    return name;
  }

  function suggestFields(card) {
    if (!card) return [];
    const fields = [];
    const add = (name, el, attribute) => {
      if (!el || !card.contains(el)) return;
      const selector = relativeSelector(card, el);
      if (!selector || fields.some((f) => f.selector === selector && f.attribute === attribute)) return;
      fields.push({ name: uniqueFieldName(name, fields), selector, attribute });
    };

    const title = card.querySelector("h1,h2,h3,h4,[role='heading'],strong,b");
    if (title && cleanText(title.innerText).length >= 2) add("title", title, "text");

    const link = card.querySelector("a[href]");
    if (link) {
      if (!title && cleanText(link.innerText).length >= 2) add("title", link, "text");
      add("url", link, "href");
    }

    const image = card.querySelector("img[src],img[data-src],picture img");
    if (image) add("image", image, "src");

    const descendants = Array.from(card.querySelectorAll("*")).filter((el) => {
      const t = cleanText(el.innerText);
      return t && t.length <= 160 && el.children.length <= 3;
    });

    const priceRx = /(?:€|\$|£|¥|₹|₽|USD|EUR|GBP)\s*\d|\d[\d\s.,]*\s*(?:€|\$|£|¥|₹|₽|USD|EUR|GBP)/i;
    const emailRx = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const phoneRx = /(?:\+?\d[\d\s().-]{7,}\d)/;

    const price = descendants.find((el) => priceRx.test(cleanText(el.innerText)));
    const email = descendants.find((el) => emailRx.test(cleanText(el.innerText)));
    const phone = descendants.find((el) => phoneRx.test(cleanText(el.innerText)));

    if (price) add("price", price, "text");
    if (email) add("email", email, "text");
    if (phone) add("phone", phone, "text");

    for (const el of descendants) {
      if (fields.length >= 10) break;
      const text = cleanText(el.innerText);
      if (text.length < 2 || text.length > 120) continue;
      if (el.querySelector("a,img,input,button,select,textarea")) continue;
      if (fields.some((f) => {
        try {
          const current = card.querySelector(f.selector);
          return current && cleanText(current.innerText) === text;
        } catch (_) {
          return false;
        }
      })) continue;
      add("text", el, "text");
    }

    return fields;
  }

  function elementValue(el, attribute) {
    if (!el) return "";
    if (attribute === "text") return cleanText(el.innerText || el.textContent);
    if (attribute === "html") return el.innerHTML || "";
    if (attribute === "href") return el.href || el.getAttribute("href") || "";
    if (attribute === "src") return el.currentSrc || el.src || el.getAttribute("src") || el.getAttribute("data-src") || "";
    if (attribute === "value") return "value" in el ? el.value : el.getAttribute("value") || "";
    return el.getAttribute(attribute) || "";
  }

  function scrape(config) {
    let rows = [];
    if (config && config.rowSelector) {
      try {
        rows = queryAllDeep(config.rowSelector);
      } catch (error) {
        throw new Error("Invalid row selector: " + error.message);
      }
    }
    if (!rows.length) rows = [document.body];

    let fields = Array.isArray(config?.fields) ? config.fields : [];
    if (!fields.length && rows[0] instanceof Element) fields = suggestFields(rows[0]);

    const result = rows.map((row, rowIndex) => {
      const record = {};
      for (const field of fields) {
        let el = null;
        try {
          if (field.selector === ":scope" || !field.selector) el = row;
          else el = row.querySelector(field.selector);
        } catch (_) {
          el = null;
        }
        record[field.name || "field"] = elementValue(el, field.attribute || "text");
      }
      record._sourceUrl = location.href;
      record._row = rowIndex;
      return record;
    });

    return { rows: result, fields };
  }

  function formControls() {
    const controls = queryAllDeep("input,textarea,select,[contenteditable='true']");
    return controls.map((el) => {
      let label = "";
      if (el.id) {
        const l = document.querySelector("label[for='" + esc(el.id) + "']");
        if (l) label = cleanText(l.innerText);
      }
      if (!label && el.closest("label")) label = cleanText(el.closest("label").innerText);
      return {
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        name: el.name || "",
        label,
        placeholder: el.placeholder || "",
        valuePresent: Boolean(el.value),
        options: el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => cleanText(o.text)).slice(0, 100) : []
      };
    });
  }

  function pageSnapshot() {
    const repeated = findRepeatedRegion();
    const text = cleanText(document.body?.innerText || "");
    const links = queryAllDeep("a[href]").slice(0, 500).map((a) => ({
      text: cleanText(a.innerText).slice(0, 300),
      href: a.href
    }));
    const images = queryAllDeep("img").slice(0, 300).map((img) => ({
      alt: img.alt || "",
      src: img.currentSrc || img.src || img.getAttribute("data-src") || ""
    }));

    const auto = repeated
      ? {
          rowSelector: repeated.rowSelector,
          count: repeated.count,
          fields: suggestFields(repeated.sample)
        }
      : { rowSelector: "", count: 0, fields: [] };

    return {
      title: document.title,
      url: location.href,
      frameUrl: location.href,
      isTop: window === top,
      text,
      links,
      images,
      forms: formControls(),
      auto,
      htmlSample: repeated?.parent?.outerHTML || document.body?.outerHTML || ""
    };
  }

  function findNext() {
    const direct = document.querySelector("a[rel='next'],link[rel='next']");
    if (direct && direct instanceof HTMLElement) {
      return { selector: selectorFor(direct), text: cleanText(direct.innerText || direct.getAttribute("aria-label")) };
    }

    const candidates = queryAllDeep("a,button,[role='button']").filter(visible);
    const rx = /^(next|next page|more|load more|continue|›|»|→|след|далее|nākam)/i;
    for (const el of candidates) {
      const label = cleanText(el.getAttribute("aria-label") || el.innerText || el.textContent);
      if (rx.test(label)) return { selector: selectorFor(el), text: label };
    }
    return null;
  }

  function setNativeValue(el, value) {
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") {
        el.checked = Boolean(value);
      } else {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(el, String(value ?? ""));
        else el.value = String(value ?? "");
      }
    } else if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(el, String(value ?? ""));
      else el.value = String(value ?? "");
    } else if (el instanceof HTMLSelectElement) {
      const desired = String(value ?? "");
      const option = Array.from(el.options).find((o) => o.value === desired || cleanText(o.text) === cleanText(desired));
      if (option) el.value = option.value;
      else el.value = desired;
    } else if (el.isContentEditable) {
      el.textContent = String(value ?? "");
    }

    for (const name of ["input", "change", "blur"]) {
      el.dispatchEvent(new Event(name, { bubbles: true, composed: true }));
    }
  }

  function targetForField(field) {
    if (field.selector) {
      try {
        const el = queryOneDeep(field.selector);
        if (el) return el;
      } catch (_) {}
    }

    const controls = queryAllDeep("input,textarea,select,[contenteditable='true']");
    const wantedName = cleanText(field.name).toLowerCase();
    const wantedLabel = cleanText(field.label).toLowerCase();

    for (const el of controls) {
      if (wantedName && cleanText(el.name || "").toLowerCase() === wantedName) return el;
      if (wantedName && cleanText(el.placeholder || "").toLowerCase() === wantedName) return el;
      if (wantedLabel) {
        let label = "";
        if (el.id) {
          const l = document.querySelector("label[for='" + esc(el.id) + "']");
          if (l) label = cleanText(l.innerText).toLowerCase();
        }
        if (!label && el.closest("label")) label = cleanText(el.closest("label").innerText).toLowerCase();
        if (label === wantedLabel || label.includes(wantedLabel)) return el;
      }
    }
    return null;
  }

  function fillForm(fields) {
    const results = [];
    for (const field of fields || []) {
      const el = targetForField(field);
      if (!el) {
        results.push({ ok: false, field, error: "target not found" });
        continue;
      }
      try {
        setNativeValue(el, field.value);
        results.push({ ok: true, selector: selectorFor(el), name: field.name || "" });
      } catch (error) {
        results.push({ ok: false, field, error: error.message });
      }
    }
    return results;
  }

  async function clickSelector(selector) {
    const el = queryOneDeep(selector);
    if (!el) throw new Error("Element not found: " + selector);
    el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    el.click();
    return true;
  }

  async function scrollMore() {
    const before = document.documentElement.scrollHeight;
    window.scrollTo({ top: before, behavior: "instant" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const after = document.documentElement.scrollHeight;
    return { before, after, changed: after > before };
  }

  function meta() {
    const body = cleanText(document.body?.innerText || "");
    return {
      url: location.href,
      title: document.title,
      height: document.documentElement.scrollHeight,
      signature: hashString(location.href + "|" + body.slice(0, 200000))
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      switch (message?.type) {
        case "WS_PING":
          return { ok: true, url: location.href, isTop: window === top };
        case "WS_ANALYZE":
          return pageSnapshot();
        case "WS_SCRAPE":
          return scrape(message.config || {});
        case "WS_FIND_NEXT":
          return findNext();
        case "WS_CLICK":
          return clickSelector(message.selector);
        case "WS_SCROLL_MORE":
          return scrollMore();
        case "WS_GET_META":
          return meta();
        case "WS_FILL_FORM":
          return fillForm(message.fields || []);
        default:
          throw new Error("Unknown content command: " + String(message?.type));
      }
    };

    run()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
