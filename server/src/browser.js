import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "./config.js";

const profileLocks = new Map();

function safeProfileId(value) {
  const id = String(value || "default").trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id)) {
    throw new Error("profileId may contain only letters, numbers, dot, underscore and hyphen");
  }
  return id;
}

async function acquireProfileLock(id) {
  const previous = profileLocks.get(id) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  profileLocks.set(id, previous.then(() => current));
  await previous;
  return () => {
    release();
    if (profileLocks.get(id) === current) profileLocks.delete(id);
  };
}

export async function withPersistentProfile(profileId, fn) {
  const id = safeProfileId(profileId);
  const release = await acquireProfileLock(id);
  const dir = path.join(config.profilesDir, id);
  fs.mkdirSync(dir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(dir, {
      headless: config.headless,
      viewport: { width: 1440, height: 1000 }
    });
    context.setDefaultTimeout(config.actionTimeoutMs);
    context.setDefaultNavigationTimeout(config.navigationTimeoutMs);

    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    return await fn({ context, page, profileId: id, profileDir: dir });
  } finally {
    if (context) await context.close().catch(() => {});
    release();
  }
}

export function listProfiles() {
  if (!fs.existsSync(config.profilesDir)) return [];
  return fs.readdirSync(config.profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function resetProfile(profileId) {
  const id = safeProfileId(profileId);
  if (profileLocks.has(id)) throw new Error("Profile is currently in use");
  const dir = path.join(config.profilesDir, id);
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
