# Chrome Extension: Webpage to PDF

> A simple extension to export any webpage to a full-page PDF with one click.

## Description

This Chrome extension captures **the entire webpage** (including content that
requires scrolling, and content hidden inside internal scroll containers such as
Gmail) and exports it as a PDF with a single action.

## Features

- Full-page capture (unlimited height, internal scrollers unfolded automatically)
- **Vector PDF** rendered by Chrome itself: selectable text, clickable links
- Exact CSS rendering, including modern color functions (`lab()`/`oklch()`)
- Automatic file download
- Fallback to a **full-page screenshot PDF** when a site hides its content at
  print time (e.g. transparent text in `@media print`) or uses internal scrolling
- Toolbar icon
- Native-print fallback (`Ctrl+P` → Save as PDF) if CDP debugging is unavailable

## Installation

### Quick method (development)

1. Open Chrome and go to **`chrome://extensions/`**
2. Enable **Developer mode** (toggle at the top right)
3. Click **"Load unpacked"**
4. Select the **`projet_webpage_to_pdf`** folder

✅ The extension is ready to use!

## Usage

1. Browse to any webpage
2. Click the extension icon in the toolbar
3. The PDF is generated and downloaded automatically

## Project structure

```
projet_webpage_to_pdf/
├── manifest.json          # Extension config (debugger permission)
├── background.js          # Service worker: Page.printToPDF / captureScreenshot via chrome.debugger (CDP)
├── content.js             # Fallbacks: Blob download + native print
├── README.md              # Documentation
├── INSTALLATION.md        # Detailed instructions
├── CHROMEWEBSTORE.md      # Store listing info + permission justifications
├── icons/                 # Extension icons
│   ├── icon16.svg
│   ├── icon32.svg
│   ├── icon48.svg
│   └── icon128.svg
├── libs/
│   └── jspdf.umd.min.js   # PDF assembly for the screenshot fallback
```

## Technology

- **Manifest V3**
- **chrome.debugger + Page.printToPDF**: the PDF is produced by Chrome's own
  rendering engine (no DOM scraping in JS), so modern CSS never breaks it
- **Fallback full-page capture**: if the site hides its content at print time
  (detected via an abnormally small PDF) **or** uses an internal scroll container
  (detected by probing `overflow: auto/scroll` elements after scrolling them to
  trigger lazy-loading), the extension switches to `Page.captureScreenshot`
  full-page (`captureBeyondViewport`, 16,000 px slices max) assembled into an
  A4 PDF with jsPDF. Before capturing, every internal scroller **and its
  ancestors** are unfolded (`height/max-height/min-height/overflow` with
  `!important`), then restored afterwards.
- **Service worker**: background event handling

## Customization

PDF settings live in `background.js`, in the `Page.printToPDF` call inside
`exportTabToPDF()`:

- **Paper size**: `paperWidth` / `paperHeight` (in inches; A4 = 8.27 × 11.69)
- **Orientation**: `landscape: true`
- **Margins**: `marginTop` / `marginBottom` / `marginLeft` / `marginRight`
- **Background colors**: `printBackground: true`
- **Capture quality**: `quality` in the `Page.captureScreenshot` calls
- **File name**: the `webpage_${title}.pdf` pattern in `savePdf()`

## Known limitations

- A short "debugging" banner appears on the tab during generation (unavoidable
  with the `debugger` API)
- If DevTools is already open on the tab, the extension falls back to native print
- `chrome://` pages and the Web Store cannot be exported (Chrome restriction)
- Very long pages are sliced at 16,384 px per capture (Chrome texture limit)
- In screenshot mode the PDF is an image (text not selectable) — the vector
  mode is preferred whenever possible

## License

Free to use. jsPDF is MIT-licensed.

---

**Version**: 1.3.0
