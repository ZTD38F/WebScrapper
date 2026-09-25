# Architecture

WebScrapper is a clean-room Manifest V3 browser automation and scraping extension. It does not use Thunderbit source code, assets, APIs, accounts, quotas, or telemetry.

## Runtime

```text
Side panel
   │
   ├── declarative scraper configuration
   ├── optional OpenAI-compatible AI field inference
   ├── scheduler
   ├── form filler
   └── exports
   │
Background service worker
   │
   ├── tab lifecycle
   ├── pagination / infinite-scroll orchestration
   ├── scheduled jobs via chrome.alarms
   ├── visible-tab screenshots
   ├── IndexedDB persistence
   └── optional AI HTTP request
   │
Content script (all_frames)
   │
   ├── DOM + open Shadow DOM queries
   ├── repeated-card detection
   ├── field heuristics
   ├── CSS extraction
   ├── next-button discovery
   ├── scrolling
   └── form filling
```

## Local-first state

Datasets are persisted in IndexedDB inside the extension profile. Job definitions and AI settings are stored in `chrome.storage.local`.

There is no WebScrapper cloud account and no WebScrapper billing or credit system.

## Scraping model

A schema is declarative:

```json
{
  "rowSelector": ".product-card",
  "fields": [
    {"name":"title","selector":"h2","attribute":"text"},
    {"name":"price","selector":".price","attribute":"text"},
    {"name":"url","selector":"a","attribute":"href"},
    {"name":"image","selector":"img","attribute":"src"}
  ]
}
```

The content runtime executes selectors. It does not execute JavaScript supplied by an AI provider.

## Pagination

Three modes are supported:

- `none`: scrape one rendered page.
- `next`: find/click a configured or automatically detected Next/Load More control.
- `infinite`: scroll until content stops increasing.

`maxPages=0` means there is no user-configured page cap. Safety termination still occurs when the page stops changing or repeats.

## Frames

The manifest injects the content runtime into accessible frames. When `includeFrames` is enabled, the service worker enumerates frame IDs with `chrome.webNavigation.getAllFrames` and asks each extension content runtime directly through `chrome.tabs.sendMessage`.

No unauthenticated `window.postMessage` bridge is used.

## AI

AI is optional. The built-in page analyzer works without any network service.

If configured, the service worker sends a page sample to a user-selected OpenAI-compatible endpoint. The response is parsed only as a declarative extraction schema. Remote code execution is intentionally not a feature.

This supports local endpoints such as an OpenAI-compatible model server as well as hosted providers selected by the user.

## Scheduling

Scheduled jobs are implemented with `chrome.alarms`. They run only while the browser/extension runtime is available; this is a browser-platform constraint, not an application quota.

## Current implemented scope

- repeated-list auto detection
- declarative CSS extraction
- text/href/src/value extraction
- open Shadow DOM querying
- optional iframe aggregation
- Next-button pagination
- infinite scrolling
- local datasets
- JSON/CSV export
- form discovery and filling
- visible-tab screenshot
- optional AI schema generation
- recurring local schedules
- no telemetry

## Deliberately excluded

- arbitrary remote `eval`
- unauthenticated page-to-extension bridges
- CAPTCHA bypass
- anti-bot evasion
- credential/cookie harvesting
- hidden telemetry
