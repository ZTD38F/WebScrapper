function endpointFor(settings) {
  const raw = String(settings.endpoint || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("AI endpoint is not configured");
  if (/\/chat\/completions$/i.test(raw)) return raw;
  return raw + "/chat/completions";
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
    throw new Error("AI response did not contain valid JSON");
  }
}

export async function inferFieldsWithProvider(snapshot, settings) {
  if (!settings || !settings.endpoint || !settings.model) {
    throw new Error("Configure an OpenAI-compatible endpoint and model first");
  }

  const sample = String(snapshot.htmlSample || snapshot.text || "").slice(0, 160000);
  const prompt = [
    "Infer a robust web-scraping schema from the supplied page sample.",
    "Return JSON only with this exact shape:",
    '{"rowSelector":"CSS selector","fields":[{"name":"column","selector":"relative CSS selector","attribute":"text|href|src|value"}]}',
    "Use selectors that are stable and reusable across repeated cards.",
    "Do not include scripts or executable code.",
    "Page URL: " + String(snapshot.url || ""),
    "HTML/text sample:",
    sample
  ].join("\n\n");

  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;

  const response = await fetch(endpointFor(settings), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You generate safe declarative CSS extraction schemas. Never return JavaScript."
        },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error("AI request failed: HTTP " + response.status + " " + body.slice(0, 500));
  }

  const json = await response.json();
  const text = json?.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.fields)) throw new Error("AI schema is malformed");
  return parsed;
}


export async function planAgentStep(input, settings) {
  if (!settings || !settings.endpoint || !settings.model) {
    throw new Error("Configure an OpenAI-compatible endpoint and model first");
  }

  const snapshot = input?.snapshot || {};
  const compact = {
    url: snapshot.url || "",
    title: snapshot.title || "",
    text: String(snapshot.text || "").slice(0, 90000),
    links: Array.isArray(snapshot.links) ? snapshot.links.slice(0, 120) : [],
    forms: Array.isArray(snapshot.forms) ? snapshot.forms.slice(0, 80) : [],
    auto: snapshot.auto || null
  };

  const allowed = [
    "navigate: {type:'navigate', url:'https://...'}",
    "click: {type:'click', selector:'CSS selector'}",
    "scroll: {type:'scroll'}",
    "scrape: {type:'scrape', rowSelector:'...', fields:[...]}",
    "fill: {type:'fill', fields:[{selector|name|label,value}]}",
    "done: {type:'done', message:'result for the user'}"
  ].join("\n");

  const prompt = [
    "Goal: " + String(input?.goal || ""),
    "You are controlling a browser through a SAFE DECLARATIVE tool layer.",
    "Return exactly one JSON object: {\"action\":{...},\"reason\":\"brief\"}.",
    "Allowed actions:\n" + allowed,
    "Never return JavaScript. Never request eval, DevTools, cookies, credentials, CAPTCHA bypass, purchases, payments, sending messages, publishing, deleting, or account/security changes.",
    "Prefer read-only navigation and scraping. Form filling may prepare fields but must not submit them.",
    "Recent history: " + JSON.stringify((input?.history || []).slice(-8)),
    "Current page: " + JSON.stringify(compact)
  ].join("\n\n");

  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;

  const response = await fetch(endpointFor(settings), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "Plan one safe browser action at a time. Output JSON only. Use only the declared action schema."
        },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error("AI request failed: HTTP " + response.status + " " + body.slice(0, 500));
  }

  const json = await response.json();
  const parsed = parseJsonObject(json?.choices?.[0]?.message?.content);
  const action = parsed?.action;
  const allowedTypes = new Set(["navigate", "click", "scroll", "scrape", "fill", "done"]);
  if (!action || !allowedTypes.has(action.type)) throw new Error("AI returned an unsupported action");

  if (action.type === "navigate" && !/^https?:\/\//i.test(String(action.url || ""))) {
    throw new Error("AI navigation URL must be HTTP(S)");
  }
  if (action.type === "click" && !String(action.selector || "").trim()) {
    throw new Error("AI click requires a CSS selector");
  }
  if (action.type === "fill" && !Array.isArray(action.fields)) {
    throw new Error("AI fill action requires fields");
  }
  if (action.type === "scrape" && action.fields && !Array.isArray(action.fields)) {
    throw new Error("AI scrape fields must be an array");
  }

  return {
    action,
    reason: String(parsed?.reason || "")
  };
}
