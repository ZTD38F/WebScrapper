import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const content = read("src/content.js");
const background = read("src/background.js");
const panel = read("sidepanel/app.js");
const manifest = JSON.parse(read("manifest.json"));

function expect(source, fragment, label) {
  if (!source.includes(fragment)) throw new Error("Missing picker contract: " + label);
}

expect(content, 'case "WS_PICK_ELEMENT"', "isolated content command");
expect(content, "event.preventDefault()", "picked click cannot activate the page");
expect(content, "event.stopImmediatePropagation()", "page click handlers are blocked");
expect(content, "root.querySelector(selector) === target", "selector verification");
expect(content, "overlay.remove()", "highlight cleanup");
expect(content, "banner.remove()", "instruction cleanup");
expect(background, 'case "WS_PICK_ELEMENT"', "privileged routing");
expect(panel, 'rpc("WS_PICK_ELEMENT"', "visual editor action");

if (content.includes("window.postMessage")) throw new Error("Picker must not use window.postMessage");
if (/\beval\s*\(/.test(content)) throw new Error("Picker must not execute eval");
for (const permission of ["cookies", "debugger", "history"]) {
  if ((manifest.permissions || []).includes(permission)) {
    throw new Error("Unexpected sensitive permission: " + permission);
  }
}

console.log("WebScrapper picker security contract passed.");
