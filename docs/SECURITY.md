# Security model

WebScrapper is intentionally more restrictive than the extension used as a functional reference.

## Trust boundaries

### Web pages are untrusted

A web page cannot send privileged WebScrapper commands through `window.postMessage`. Content/background communication uses the browser extension messaging API.

### AI providers are untrusted for code

AI output is accepted only as data:

- row CSS selector
- field names
- relative CSS selectors
- extraction attributes

No AI response is evaluated as JavaScript.

### Secrets

An optional provider API key is stored in `chrome.storage.local` because the extension must access it to call the configured endpoint. Users who do not want a hosted key in extension storage should use a local OpenAI-compatible endpoint without a key.

WebScrapper has no `cookies` permission and no `history` permission.

## Permissions

- `<all_urls>`: required to be a generic scraper.
- `tabs`, `activeTab`: target-page lifecycle and metadata.
- `scripting`: recover content injection in already-open pages.
- `storage`, `unlimitedStorage`: local settings/job storage.
- `sidePanel`: UI.
- `alarms`: recurring jobs.
- `webNavigation`: enumerate frames.
- `downloads`: reserved for extension-managed exports; current side-panel exports use browser downloads through a local Blob.

No `debugger` permission is used in the initial implementation.

## Limitations

"Unlimited" means there are no product-plan, credit, row-count, or page-count paywalls. Physical and browser constraints still apply: disk capacity, RAM, browser message limits, target-site behavior, network throughput, provider context limits, and browser scheduling behavior.

## Responsible use

Use scraping and automation where you are authorized to access the data and where the target service permits the intended use. The project does not include CAPTCHA bypass or anti-bot circumvention.
