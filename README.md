# WebScrapper

Free, local-first Manifest V3 web scraper and browser automation extension.

**Repository:** https://github.com/ZTD38F/WebScrapper

WebScrapper is a clean-room implementation inspired by the *capability class* of modern AI web scrapers. It does **not** copy Thunderbit source code, bundled assets, private APIs, branding, telemetry, authentication, quotas, or billing.

## What already works

- automatic repeated-card/list detection
- local field suggestions
- custom CSS row/field schemas
- text, URL, image and value extraction
- open Shadow DOM queries
- optional iframe aggregation
- automatic Next/Load More discovery
- multi-page pagination
- infinite-scroll scraping
- local IndexedDB datasets
- JSON and CSV export
- visible-tab screenshots
- declarative form filling
- recurring scraping jobs with `chrome.alarms`
- optional AI field inference through **any OpenAI-compatible endpoint**
- no WebScrapper account
- no subscription
- no credits
- no telemetry
- no artificial row/page quota

`maxPages = 0` means “continue until the target page stops changing / has no next page”, not a paid-plan limit.

## Install from source

1. Clone or download this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository root containing `manifest.json`.
6. Open a normal web page and click the WebScrapper toolbar button. The side panel opens.

No build step or npm install is required to run the extension.

## Quick use

1. Open a catalogue/search/results page.
2. Click **Analyze page**.
3. Inspect the detected row selector and fields.
4. Choose pagination:
   - **None** for one rendered page;
   - **Next button** for normal pagination / Load More;
   - **Infinite scroll** for feeds.
5. Click **Run scraper**.
6. Export the local result as JSON or CSV.

You can override every generated selector manually.

## Example schema

```json
{
  "rowSelector": ".product-card",
  "fields": [
    {"name": "title", "selector": "h2", "attribute": "text"},
    {"name": "price", "selector": ".price", "attribute": "text"},
    {"name": "url", "selector": "a", "attribute": "href"},
    {"name": "image", "selector": "img", "attribute": "src"}
  ]
}
```

## Optional AI

The scraper itself does not require AI.

For AI field inference, configure an OpenAI-compatible endpoint in the side panel. This can be a local model server or a hosted provider of your choice.

The model is only allowed to return a declarative CSS extraction schema. Its response is **never executed as JavaScript**.

## Scheduling

The Scheduler saves jobs locally and uses the browser's `chrome.alarms` API. Scheduled work therefore requires the browser/extension runtime to be available.

This is deliberately different from a paid cloud scheduler: there is no hosted WebScrapper backend and no WebScrapper quota.

## Security differences from Thunderbit

During the Thunderbit audit, two design patterns were intentionally *not* reproduced here:

- no unauthenticated `window.postMessage` bridge between arbitrary pages and privileged scraping logic;
- no AI/remote arbitrary `eval` in the page's MAIN JavaScript world.

WebScrapper communicates through browser extension messaging and uses declarative operations.

It also requests neither `cookies` nor `history` nor `debugger`.

See [Security model](docs/SECURITY.md).

## Architecture

See [Architecture](docs/ARCHITECTURE.md).

Core files:

```text
manifest.json
src/
  background.js     job orchestrator, tabs, schedules, screenshots
  content.js        page analysis, extraction, pagination, forms
  db.js             local IndexedDB datasets
  ai.js             optional OpenAI-compatible schema inference
sidepanel/
  index.html
  app.js
  styles.css
```

## Validation

The project contains a dependency-free static validator and GitHub Actions workflow.

```bash
npm run check
```

It validates the Manifest V3 references and syntax-checks all JavaScript modules.

## What “unlimited” means

There are **no application paywalls or product-plan caps** on rows, pages, jobs or runs.

Real technical limits still exist: RAM, disk capacity, browser/runtime constraints, target-site behavior, network speed, and AI context limits. The project does not pretend those physical limits do not exist.

## Responsible use

Use automation only on data and services you are authorized to access. WebScrapper does not include CAPTCHA bypass, bot-protection circumvention, cookie theft, credential harvesting, or hidden telemetry.

## License

MIT.
