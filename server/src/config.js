import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.WS_DATA_DIR || "./data");

function numberEnv(name, fallback, minimum = 0) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(name + " must be a number >= " + minimum);
  }
  return value;
}

export const config = Object.freeze({
  host: process.env.WS_HOST || "127.0.0.1",
  port: numberEnv("WS_PORT", 8787, 1),
  token: process.env.WS_SERVER_TOKEN || "",
  dataDir: root,
  dbPath: path.join(root, "webscrapper.sqlite3"),
  artifactsDir: path.join(root, "artifacts"),
  profilesDir: path.join(root, "profiles"),
  headless: process.env.WS_HEADLESS !== "false",
  workers: Math.max(1, Math.floor(numberEnv("WS_WORKERS", 1, 1))),
  pollMs: Math.max(100, Math.floor(numberEnv("WS_POLL_MS", 750, 100))),
  leaseSeconds: Math.max(30, Math.floor(numberEnv("WS_LEASE_SECONDS", 300, 30))),
  navigationTimeoutMs: Math.max(1000, Math.floor(numberEnv("WS_NAVIGATION_TIMEOUT_MS", 45000, 1000))),
  actionTimeoutMs: Math.max(500, Math.floor(numberEnv("WS_ACTION_TIMEOUT_MS", 15000, 500))),
  maxJobMs: Math.max(0, Math.floor(numberEnv("WS_MAX_JOB_MS", 0, 0))),
  screenshotQuality: Math.min(100, Math.max(20, Math.floor(numberEnv("WS_SCREENSHOT_QUALITY", 65, 20)))),
  ai: {
    endpoint: process.env.WS_AI_ENDPOINT || "",
    model: process.env.WS_AI_MODEL || "",
    apiKey: process.env.WS_AI_API_KEY || "",
    visionModel: process.env.WS_AI_VISION_MODEL || process.env.WS_AI_MODEL || ""
  }
});

for (const dir of [config.dataDir, config.artifactsDir, config.profilesDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
