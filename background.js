// Service Worker — Exports the active tab to PDF via CDP (chrome.debugger).
//
// Hybrid strategy:
//  1. Page.printToPDF -> vector PDF (selectable text). If the result is
//     abnormally small, the site probably hides its content at print time
//     (e.g. text rendered transparent in a @media print rule): switch to
//     full-page image capture.
//  2. Page.captureScreenshot full page (captureBeyondViewport, 16000 px slices
//     max due to Chrome's texture limit) assembled into an A4 PDF with jsPDF.
//     The rendering is then identical to the screen (colors preserved).
//  3. Last resort: native print (window.print) via content.js.

importScripts('libs/jspdf.umd.min.js');

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'devtools://', 'about:', 'view-source:'];
const MIN_PDF_B64_LEN = 40000;  // below this, the vector PDF is probably empty
const MAX_SLICE_HEIGHT = 16000; // Chrome GPU texture limit for captureScreenshot

// Warms up internal scroll containers (triggers lazy-loading, e.g. the Gmail
// list loaded on scroll), scrolls back to top, then counts them and their height.
const SCROLLER_WARMUP = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const findScrollers = () => {
    const els = [];
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) els.push(el);
    });
    return els;
  };
  // only warm the 3 biggest scrollers (avoids timeouts)
  const top = findScrollers().sort((a, b) => b.scrollHeight - a.scrollHeight).slice(0, 3);
  for (const el of top) {
    const step = Math.max(el.clientHeight, 200);
    for (let y = 0; y <= el.scrollHeight; y += step) { el.scrollTop = y; await sleep(120); }
    el.scrollTop = 0;
  }
  await sleep(1000);
  const els = findScrollers();
  let maxScroll = 0;
  els.forEach(el => { maxScroll = Math.max(maxScroll, el.scrollHeight); });
  return JSON.stringify({ n: els.length, maxScroll, docH: document.documentElement.scrollHeight });
})()`;

// Unfolds REAL internal scroll containers (overflow auto/scroll only — hidden
// blocks like "show more" truncated text must NOT be unfolded) AND their
// ancestor chain, with !important. Height is set to a FIXED px value
// (scrollHeight), not auto, so absolutely-positioned columns keep their
// reference height and don't overlap. Inline styles saved in window.__pdfSaved.
const UNFOLD_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // idempotent: restore any previous unfold first
  (window.__pdfSaved || []).forEach(s => { s.el.style.cssText = s.cssText; });
  window.__pdfSaved = [];
  const save = (el) => {
    if (!window.__pdfSaved.some(s => s.el === el)) window.__pdfSaved.push({ el, cssText: el.style.cssText });
  };
  const unfoldEl = (el) => {
    save(el);
    const h = Math.max(Math.ceil(el.getBoundingClientRect().height), el.scrollHeight);
    el.style.setProperty('height', h + 'px', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
  };
  const findScrollers = () => {
    const els = [];
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) els.push(el);
    });
    return els;
  };
  const sc = findScrollers();
  sc.forEach(el => unfoldEl(el)); // pass 1: the scrollers themselves
  sc.forEach(el => {              // pass 2: their ancestors
    let n = el.parentElement;
    while (n && n !== document.documentElement) { unfoldEl(n); n = n.parentElement; }
  });
  unfoldEl(document.body);
  unfoldEl(document.documentElement);
  await sleep(500);
  return JSON.stringify({ n: window.__pdfSaved.length, docH: document.documentElement.scrollHeight });
})()`;

// Restores inline styles after the capture
const REFOLD_SCRIPT = `(() => {
  (window.__pdfSaved || []).forEach(s => { s.el.style.cssText = s.cssText; });
  window.__pdfSaved = null;
  return 'ok';
})()`;

let busy = false; // prevents concurrent double clicks (one debugger per tab)

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null || busy) return;
  busy = true;
  try {
    await handleClick(tab);
  } finally {
    busy = false;
  }
});

async function handleClick(tab) {
  const isRestrictedPage = !tab.url || RESTRICTED_PREFIXES.some((p) => tab.url.startsWith(p));

  if (!isRestrictedPage) {
    try {
      await exportTabToPDF(tab);
      console.log('Webpage to PDF: export done');
      return;
    } catch (err) {
      // e.g. DevTools already open on the tab ("Another debugger is already attached")
      console.warn('Webpage to PDF: CDP export failed, falling back to native print.', err);
      try { await chrome.debugger.detach({ tabId: tab.id }); } catch (_) { /* already detached */ }
    }
  } else {
    // Internal Chrome pages (chrome://, Web Store...): no extension can access them
    console.info('Webpage to PDF: internal Chrome pages (chrome://, etc.) cannot be exported. Use a normal web tab.');
    return;
  }

  // Fallback: native print dialog (Ctrl+P -> "Save as PDF")
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { action: 'fallbackPrint' });
  } catch (err) {
    console.error('Webpage to PDF: fallback not possible on this page.', err);
  }
}

async function exportTabToPDF(tab) {
  const target = { tabId: tab.id };

  await chrome.debugger.attach(target, '1.3');
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    await waitForPageReady(target);

    // Internal scroll containers (Gmail, X...) are neither paginated by
    // printToPDF nor capturable beyond the viewport: capture mode is required.
    const scrollerRes = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: SCROLLER_WARMUP,
      returnByValue: true,
      awaitPromise: true
    });
    const scrollerInfo = JSON.parse(scrollerRes.result.value || '{"n":0}');
    const internalScrollers = scrollerInfo.n || 0;

    // Some sites ship a @media print stylesheet that distorts the layout
    // (e.g. LinkedIn squeezes the profile into narrow columns, other sites
    // hide their content): the vector PDF would then be unreadable even when
    // big enough. Emulate print media and compare the document height with
    // the screen one — a big divergence means printToPDF output is unreliable.
    const printCheck = await checkPrintLayout(target);
    const printDistorted = !!printCheck && (printCheck.ratio > 1.5 || printCheck.ratio < 0.67);

    // 1) vector attempt
    const pdf = await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
      landscape: false,
      printBackground: true,      // keep colored backgrounds
      preferCSSPageSize: true,    // honor the page's @page { size: ... }
      displayHeaderFooter: false,
      scale: 1,
      paperWidth: 8.27,           // A4 in inches
      paperHeight: 11.69,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4
    });

    if (pdf.data.length >= MIN_PDF_B64_LEN && internalScrollers === 0 && !printDistorted) {
      await savePdf(tab, 'data:application/pdf;base64,' + pdf.data);
      return;
    }

    // 2) content hidden/distorted at print time or internal scrolling -> full-page image capture
    console.log(`Webpage to PDF: capture mode (PDF=${pdf.data.length} chars, scrollers=${internalScrollers}, maxScroll=${scrollerInfo.maxScroll}, printRatio=${printCheck ? printCheck.ratio.toFixed(2) : 'n/a'})`);
    await captureFullPageToPDF(target, tab);
  } finally {
    try { await chrome.debugger.detach(target); } catch (_) { /* ignore */ }
  }
}

// Emulates print media on the page and compares the resulting document height
// with the screen one. Returns { ratio: printH / screenH }, or null on error.
// The emulated media is always reset to screen afterwards.
async function checkPrintLayout(target) {
  const measure = 'JSON.stringify({ h: document.documentElement.scrollHeight })';
  const evalJs = async (expr, awaitPromise) => {
    const r = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: !!awaitPromise
    });
    return JSON.parse(r.result.value);
  };
  try {
    const screen = await evalJs(measure);
    try {
      await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', { media: 'print' });
      // two animation frames + a tick so the print stylesheet is applied and layout settles
      await evalJs('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))', true);
      const pr = await evalJs(measure);
      const ratio = pr.h / Math.max(screen.h, 1);
      console.log(`Webpage to PDF: print/screen document height ratio = ${ratio.toFixed(2)}`);
      return { ratio };
    } finally {
      await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', { media: '' });
      await evalJs('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true);
    }
  } catch (e) {
    console.warn('Webpage to PDF: print layout check failed, assuming OK', e);
    return null;
  }
}

// Captures the whole page as JPEG and assembles an A4 PDF with jsPDF.
// We don't trust scrollHeight (it can be artificially inflated): first capture
// the whole page without a clip (captureBeyondViewport lets Chrome compute the
// real height), read the true dimensions from the JPEG header, then slice only
// if > 16384 px.
async function captureFullPageToPDF(target, tab) {
  // Unfold internal scroll containers first (otherwise the capture stops at the
  // viewport, e.g. the Gmail list); styles are restored in the finally block.
  await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: UNFOLD_SCRIPT,
    returnByValue: true,
    awaitPromise: true
  });

  try {
    const full = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 85,
      captureBeyondViewport: true
    });
    const size = jpegSize(full.data);
    if (!size) throw new Error('Could not read screenshot dimensions');
    console.log(`Webpage to PDF: full-page capture ${size.w}x${size.h}`);

    const { jsPDF } = self.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();   // 210 mm
    const pageH = pdf.internal.pageSize.getHeight();  // 297 mm

    // Slice the capture into page-sized chunks: each chunk's height (in px) is
    // chosen so the chunk fills the A4 page WIDTH exactly — otherwise a tall
    // page would be shrunk onto a single page and the text would be unreadable.
    // chunkH is always < MAX_SLICE_HEIGHT for any realistic page width.
    const chunkH = Math.max(1, Math.min(MAX_SLICE_HEIGHT, Math.floor((size.w * pageH) / pageW)));

    let slices;
    if (size.h <= chunkH) {
      slices = [{ data: full.data, w: size.w, h: size.h }];
    } else {
      slices = [];
      for (let y = 0; y < size.h; y += chunkH) {
        const height = Math.min(chunkH, size.h - y);
        const shot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
          format: 'jpeg',
          quality: 85,
          clip: { x: 0, y, width: size.w, height, scale: 1 },
          captureBeyondViewport: true
        });
        slices.push({ data: shot.data, w: size.w, h: height });
      }
    }

    slices.forEach((s, i) => {
      if (i > 0) pdf.addPage();
      const scale = Math.min(pageW / s.w, pageH / s.h);
      const imgW = s.w * scale;
      const imgH = s.h * scale;
      pdf.addImage('data:image/jpeg;base64,' + s.data, 'JPEG', (pageW - imgW) / 2, 0, imgW, imgH);
    });

    await savePdf(tab, pdf.output('datauristring'));
  } finally {
    // restore the unfolded scroll containers
    try {
      await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: REFOLD_SCRIPT });
    } catch (_) { /* ignore */ }
  }
}

async function savePdf(tab, dataUrl) {
  const filename = `webpage_${(tab.title || 'page').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80)}.pdf`;
  try {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  } catch (e) {
    // data: URL rejected (too large) -> download via a page-side Blob
    console.warn('Webpage to PDF: data URL rejected, Blob fallback via content script', e);
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'savePDF', b64, filename });
    if (!res || !res.success) throw e;
  }
}

// Reads the real width/height of a base64-encoded JPEG (SOF marker)
function jpegSize(b64) {
  try {
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15 (except DHT/DAC/JPG) hold the dimensions
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      i += 2 + len;
    }
  } catch (_) { /* ignore */ }
  return null;
}

// Waits for document.readyState === 'complete' (images, fonts, etc.)
async function waitForPageReady(target, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { result } = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      });
      if (result && result.value === 'complete') return;
    } catch (_) { /* page not responding yet, retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Logged if the user closes the debugging banner during the operation
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log('Webpage to PDF: debugger detached', JSON.stringify(source), reason);
});
