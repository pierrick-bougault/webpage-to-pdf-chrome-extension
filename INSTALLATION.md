# Chrome Extension: Webpage to PDF

An extension to export any webpage to a full-page PDF.

## Project structure

```
projet_webpage_to_pdf/
├── manifest.json          # Extension config (debugger permission)
├── background.js          # Service worker: Page.printToPDF via chrome.debugger (CDP)
├── content.js             # Fallbacks: Blob download + native print
├── icons/                 # Extension icons
├── libs/
│   └── jspdf.umd.min.js   # PDF assembly for the screenshot fallback
```

## Installation

### Method 1: Load in development mode

1. Open Chrome and go to:
   `chrome://extensions/`

2. Enable **Developer mode** (toggle at the top right)

3. Load the extension:
   - Click **"Load unpacked"**
   - Select the `projet_webpage_to_pdf` folder

4. The extension is installed!
   - A new icon appears in the Chrome toolbar

### Method 2: Package for distribution

1. In `chrome://extensions/`, enable Developer mode
2. Click **"Pack extension"**
3. Select the project folder
4. Chrome generates a `.crx` and a `.pem` file

## Usage

### Export a page to PDF:

1. Browse to the page you want to export
2. Click the extension icon in the toolbar
3. The PDF is generated and downloaded automatically

### The PDF includes:
- All visible page content
- Images and CSS styles
- Tables and layout
- Content that requires scrolling (internal scrollers are unfolded first)

## Technical overview

### Export pipeline:

1. `background.js` listens for the toolbar click
2. It attaches the CDP debugger to the active tab (permission `debugger`)
3. It calls `Page.printToPDF`: **Chrome itself renders the page to PDF**
   (full page, vector text, no page-side capture library)
4. If the result is abnormally small (site hides content at print time) or the
   page has internal scroll containers, it falls back to full-page
   `Page.captureScreenshot` slices assembled with jsPDF
5. The PDF (base64) is downloaded via `chrome.downloads`

Why this design: html2canvas crashes on modern sites (e.g. Gmail) with
`Attempting to parse an unsupported color function "lab"`, because it does not
know CSS `lab()`/`oklch()` colors. `Page.printToPDF` parses no CSS in JS: the
rendering is identical to the print preview.

### Fallbacks:

If CDP debugging is unavailable (DevTools already open, `chrome://` page),
the extension injects `content.js`, which opens native print (`window.print()`)
or downloads the PDF through a page-side Blob.

## Customization

### Change the PDF file name, paper size, margins:

In `background.js`, see the `Page.printToPDF` call in `exportTabToPDF()`
(`paperWidth`/`paperHeight`, `landscape`, margins, `printBackground`).

## Notes

- Limitations: some highly dynamic pages may render differently in the screenshot fallback.
- Permissions: the extension only accesses the active tab when clicked.
- Compatibility: Chrome 90+ (Manifest V3); CDP auto-connect features need Chrome 144+.

## License

Free to use. Bundled libraries have their own licenses (MIT).
