import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const background = read("src/background.js");
const panel = read("sidepanel/app.js");
const html = read("sidepanel/index.html");

function expect(source, fragment, label) {
  if (!source.includes(fragment)) throw new Error("Missing progress contract: " + label);
}

expect(background, 'case "WS_GET_RUN_PROGRESS"', "progress query");
expect(background, 'case "WS_CANCEL_RUN"', "cancel command");
expect(background, 'stopReason === "cancelled"', "cancelled result metadata");
expect(background, "await saveRun(meta, rows)", "partial rows are persisted");
expect(panel, 'rpc("WS_GET_RUN_PROGRESS"', "panel progress polling");
expect(panel, 'rpc("WS_CANCEL_RUN"', "panel cancel action");
expect(html, 'id="progressCount"', "truthful page/row counter");
expect(html, 'id="cancelRun"', "visible cancel control");

console.log("WebScrapper progress contract passed.");
