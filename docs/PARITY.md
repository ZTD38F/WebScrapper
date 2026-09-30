# Thunderbit Capability Parity

This matrix is a clean-room functional comparison. It tracks user-visible capability classes and does not copy Thunderbit proprietary code, assets, branding, private APIs, telemetry, or billing.

Legend: **IMPLEMENTED** / **PARTIAL** / **MISSING** / **INTENTIONALLY EXCLUDED**

| Area | Status | WebScrapper evidence / next gap |
|---|---|---|
| Quick Start / current tab | IMPLEMENTED | Side panel auto-detects current scriptable web tab and analyzes it on open. |
| One-click extraction | IMPLEMENTED | Automatic list/field detection + dominant `1-Click Extract` action. |
| Automatic repeated-list detection | IMPLEMENTED | `src/content.js`, mirrored in self-hosted server. |
| Field suggestions | IMPLEMENTED | Heuristic title/url/image/price/text/email/phone fields. |
| AI field suggestions | IMPLEMENTED | Optional OpenAI-compatible provider; declarative schema only. |
| Visual column editor | IMPLEMENTED | Rename/remove/type controls without editing JSON. |
| Point-and-click selector picker on page | MISSING | Add safe overlay picker/highlighter. |
| Live preview before extraction | IMPLEMENTED | Preview RPC without saving a run. |
| Raw CSS/JSON editor | IMPLEMENTED | Hidden in Advanced. |
| Normal next-page pagination | IMPLEMENTED | Configured/auto-detected next controls. |
| Load More detection | IMPLEMENTED | Localized detection including Load more / Rādīt vairāk / Показать ещё. |
| Infinite scroll | IMPLEMENTED | Local extension and server. |
| Detail/subpage enrichment | IMPLEMENTED | Per-row URL enrichment. |
| Bulk URLs | IMPLEMENTED | Local bulk execution. |
| Iframe aggregation | IMPLEMENTED | Direct extension messaging; no page `postMessage` bridge. |
| Open Shadow DOM extraction | IMPLEMENTED | Local extension deep queries. |
| Local run history | IMPLEMENTED | IndexedDB datasets/runs. |
| JSON export | IMPLEMENTED | Side panel. |
| CSV export | IMPLEMENTED | Side panel. |
| XLSX export | MISSING | Add dependency-free or audited workbook writer. |
| Image/file bundle export | MISSING | Add opt-in downloader/ZIP flow. |
| Visible-tab screenshot | IMPLEMENTED | Local extension. |
| Full-page screenshot | IMPLEMENTED | Self-hosted Playwright worker artifacts. |
| Vision-assisted schema | IMPLEMENTED | Self-hosted optional vision model. |
| Form field discovery/filling | PARTIAL | Safe declarative filling exists; simple non-JSON UI and file preparation remain. |
| File upload preparation | MISSING | Add explicit user-selected file flow; never auto-submit. |
| AI browser agent | IMPLEMENTED | Safe whitelist: navigate/click/scroll/scrape/fill/done; no remote eval. |
| Saved scraper templates | PARTIAL | Schedules retain configs; dedicated template library UI is missing. |
| Local schedules | IMPLEMENTED | `chrome.alarms`. |
| 24/7 server schedules | IMPLEMENTED | SQLite scheduler + workers. |
| Durable server queue/retries | IMPLEMENTED | Leases, retries, reclaim, cancel. |
| Persistent browser profiles | IMPLEMENTED | Per-profile Playwright state + mutex. |
| Multi-worker execution | IMPLEMENTED | `WS_WORKERS`. |
| Server REST API | IMPLEMENTED | Authenticated API. |
| Extension ↔ self-hosted server | IMPLEMENTED | Same side-panel workflow can enqueue server jobs. |
| Crash/restart recovery | IMPLEMENTED | Server durable queue/expired lease reclaim. |
| Large-result streaming / bounded-memory datasets | PARTIAL | Durable storage exists; row streaming/chunked result API remains. |
| Integrations (Sheets/Airtable/Notion/etc.) | MISSING | Add opt-in connectors/export targets after core UX stabilizes. |
| Specialized site adapters | MISSING | Prefer generic engine; add adapters only for demonstrated gaps. |
| CAPTCHA bypass / anti-bot evasion | INTENTIONALLY EXCLUDED | Security/product boundary. |
| Arbitrary AI/remote JavaScript eval | INTENTIONALLY EXCLUDED | Declarative validated actions only. |
| Unauthenticated page-to-extension postMessage control | INTENTIONALLY EXCLUDED | Browser extension messaging only. |
| Hidden telemetry/session replay | INTENTIONALLY EXCLUDED | No WebScrapper telemetry. |
| Subscription / credits / row quotas | INTENTIONALLY EXCLUDED | No product paywalls or artificial usage caps. |

## UX target

The default workflow must remain:

```text
open webpage
  ↓
open WebScrapper
  ↓
automatic analysis + preview
  ↓
optional column edits
  ↓
1-Click Extract
  ↓
results table
  ↓
export / save / schedule
```

CSS selectors, JSON schemas, AI endpoints, self-hosted infrastructure, timing values, iframe switches, and other implementation details belong in **Advanced** or scenario-specific tools.

## Highest-priority remaining gaps

1. Point-and-click page selector/highlighter.
2. XLSX export.
3. Simple form-filler UI derived from detected form controls.
4. Dedicated saved scraper/template library.
5. Progress/cancel telemetry for local long-running jobs.
6. Chunked/streamed large-result storage and server result retrieval.
7. Optional integrations after the core extraction UX is stable.
