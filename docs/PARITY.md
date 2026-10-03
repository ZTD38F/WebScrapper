# Product parity matrix

This is a clean-room capability map. It tracks user outcomes, not proprietary implementation details.

Status values: **IMPLEMENTED**, **PARTIAL**, **MISSING**, **INTENTIONALLY_EXCLUDED**.

| Capability | Status | Evidence / next gap |
| --- | --- | --- |
| Open panel → automatic page understanding | IMPLEMENTED | `sidepanel/app.js` runs page analysis on startup |
| Suggested fields without JSON | IMPLEMENTED | Visual field editor in `sidepanel/index.html` and `sidepanel/app.js` |
| Rename/remove/add fields | IMPLEMENTED | Visual field cards; raw schema remains under Advanced |
| Repeated-list detection | IMPLEMENTED | `src/content.js` repeated-region analysis |
| One obvious scrape action | IMPLEMENTED | Dominant **Scrape** button in the primary flow |
| Pagination / Load More | IMPLEMENTED | Next discovery plus bounded/stagnation-aware execution |
| Infinite scroll | IMPLEMENTED | Scroll mode with termination checks |
| Detail-page enrichment | IMPLEMENTED | Optional detail schema in extension and server |
| Bulk URLs | IMPLEMENTED | Local bulk runner |
| Local persistent results and history | IMPLEMENTED | IndexedDB run storage and results table |
| JSON / CSV export | IMPLEMENTED | Side-panel export actions |
| XLSX export | MISSING | Add a dependency-free or vendored, audited exporter |
| Visual point-and-click selector | IMPLEMENTED | Isolated-world picker returns a verified declarative selector; no page bridge |
| Progress and cancellation | IMPLEMENTED | Live stage/page/row progress, explicit cancel, and saved partial results |
| Screenshots | PARTIAL | Visible-tab capture exists; full-page capture is missing |
| AI suggestions | IMPLEMENTED | Optional validated declarative schemas via OpenAI-compatible endpoints |
| Vision-assisted understanding | MISSING | Must be explicit and provider-declared |
| Forms | PARTIAL | Safe declarative fill exists; file preparation workflow is missing |
| Templates | MISSING | Saved schedules exist, reusable scraper templates do not |
| Browser-local schedules | IMPLEMENTED | `chrome.alarms` jobs |
| Self-hosted schedules/workers | IMPLEMENTED | Optional server queue, worker and persisted jobs |
| Retry/resume/recovery | PARTIAL | Server retry and durable state exist; UX and resume coverage need expansion |
| Persistent browser profiles | PARTIAL | Server profile support exists; isolation/mutex UX needs hardening |
| Multi-worker execution | PARTIAL | Worker architecture exists; concurrency controls need deeper tests |
| Integrations | MISSING | Exports are currently the integration boundary |
| Accounts, credits, quotas, telemetry | INTENTIONALLY_EXCLUDED | Local-first product contract |
| CAPTCHA bypass / anti-bot evasion | INTENTIONALLY_EXCLUDED | Security policy |

## Next priorities

1. XLSX export.
2. Reusable templates and clearer local/server mode switching.
3. Full-page capture and opt-in vision support.
4. Stronger recovery and concurrency tests for long-running server jobs.
5. Preview picked fields across multiple detected records before a run.
