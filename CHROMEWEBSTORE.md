# Chrome Web Store — Listing Information

## Requested permissions and justifications

| Permission | Justification |
|---|---|
| `activeTab` | Needed to target the active tab when the toolbar icon is clicked and read the page to export. No access outside the user's click. |
| `debugger` | Used via `chrome.debugger` to call `Page.printToPDF` / `Page.captureScreenshot` (DevTools protocol) on the active tab, producing a faithful PDF of the page (selectable vector text, full page). No data is sent outside the browser; the debugger is detached immediately after the export. |
| `scripting` | To inject `content.js` into the active tab only as a fallback (PDF download via Blob, or native `window.print()`). |
| `downloads` | To save the generated PDF to the user's download folder. |
| `host_permissions: <all_urls>` | Required so `chrome.debugger` can attach to any web tab when the user clicks. No network access, no data collection. |

## Privacy

- No user data is collected, transmitted, or sold.
- Page content never leaves the local Chrome rendering engine.
- No accounts, no authentication, no tracking.

## Short description (listing)

Export any webpage to a full-page PDF in one click: faithful rendering by the Chrome engine (colors, layout), vector PDF when possible, otherwise a high-quality full-page capture. Also works on internal-scroller sites (Gmail…) and sites that hide their content at print time.
