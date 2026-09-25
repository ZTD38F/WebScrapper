import { config } from "./config.js";

function endpointFor(settings) {
  const raw = String(settings?.endpoint || config.ai.endpoint || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("AI endpoint is not configured");
  return /\/chat\/completions$/i.test(raw) ? raw : raw + "/chat/completions";
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
  throw new Error("AI response did not contain valid JSON");
}

async function chat(messages, settings = {}, modelOverride) {
  const model = modelOverride || settings.model || config.ai.model;
  if (!model) throw new Error("AI model is not configured");

  const headers = { "content-type": "application/json" };
  const apiKey = settings.apiKey || config.ai.apiKey;
  if (apiKey) headers.authorization = "Bearer " + apiKey;

  const response = await fetch(endpointFor(settings), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      messages
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error("AI HTTP " + response.status + ": " + body.slice(0, 1000));
  }

  const body = await response.json();
  return body?.choices?.[0]?.message?.content;
}

function validateSchema(value) {
  if (!value || typeof value !== "object") throw new Error("Schema must be an object");
  if (!Array.isArray(value.fields)) throw new Error("Schema fields must be an array");

  const fields = value.fields.slice(0, 100).map((field) => {
    const attribute = String(field.attribute || "text");
    if (!["text", "href", "src", "value", "html"].includes(attribute)) {
      throw new Error("Unsupported extraction attribute: " + attribute);
    }
    return {
      name: String(field.name || "field").slice(0, 120),
      selector: String(field.selector || "").slice(0, 1000),
      attribute
    };
  });

  return {
    rowSelector: String(value.rowSelector || "").slice(0, 1000),
    fields
  };
}

export async function inferSchemaFromText({ url, title, text, htmlSample }, settings = {}) {
  const prompt = [
    "Infer a reusable web-scraping schema.",
    "Return JSON only:",
    '{"rowSelector":"CSS selector","fields":[{"name":"column","selector":"relative CSS selector","attribute":"text|href|src|value|html"}]}',
    "Selectors must be declarative CSS only. Never output JavaScript.",
    "Page URL: " + String(url || ""),
    "Title: " + String(title || ""),
    "Page sample:",
    String(htmlSample || text || "").slice(0, 160000)
  ].join("\n\n");

  const content = await chat([
    { role: "system", content: "Generate only safe declarative extraction schemas as JSON." },
    { role: "user", content: prompt }
  ], settings);

  return validateSchema(parseJsonObject(content));
}

export async function inferSchemaFromVision({ url, title, text, imageBuffer }, settings = {}) {
  const model = settings.visionModel || config.ai.visionModel || settings.model || config.ai.model;
  if (!imageBuffer?.length) throw new Error("Vision inference requires a screenshot");

  const dataUrl = "data:image/jpeg;base64," + imageBuffer.toString("base64");
  const content = await chat([
    {
      role: "system",
      content: "Generate only safe declarative CSS extraction schemas as JSON. Never output JavaScript."
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Infer a reusable scraping schema from the full-page screenshot and text.",
            'Return JSON only: {"rowSelector":"CSS selector","fields":[{"name":"column","selector":"relative CSS selector","attribute":"text|href|src|value|html"}]}',
            "URL: " + String(url || ""),
            "Title: " + String(title || ""),
            "Text sample: " + String(text || "").slice(0, 50000)
          ].join("\n")
        },
        {
          type: "image_url",
          image_url: { url: dataUrl }
        }
      ]
    }
  ], settings, model);

  return validateSchema(parseJsonObject(content));
}
