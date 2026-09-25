import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const required = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...(manifest.content_scripts || []).flatMap((x) => x.js || [])
].filter(Boolean);

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error("Manifest references missing file: " + file);
}

const scripts = [
  "src/background.js",
  "src/content.js",
  "src/db.js",
  "src/ai.js",
  "sidepanel/app.js"
];

for (const script of scripts) {
  execFileSync(process.execPath, ["--check", path.join(root, script)], { stdio: "inherit" });
}

if (manifest.manifest_version !== 3) throw new Error("Manifest V3 is required");
if (!Array.isArray(manifest.host_permissions) || !manifest.host_permissions.includes("<all_urls>")) {
  throw new Error("Expected <all_urls> host permission for generic scraping");
}

console.log("WebScrapper static validation passed.");
