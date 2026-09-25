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
