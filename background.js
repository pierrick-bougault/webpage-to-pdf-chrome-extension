// Service Worker — Exporte l'onglet actif en PDF via CDP (chrome.debugger).
//
// Stratégie hybride :
//  1. Page.printToPDF -> PDF vectoriel (texte sélectionnable). Si le résultat
//     est anormalement petit, le site masque probablement son contenu à
//     l'impression (ex. texte rendu transparent dans un @media print) :
//     on bascule alors en capture d'image pleine page.
//  2. Page.captureScreenshot pleine page (captureBeyondViewport, tranches de
//     16000 px max a cause de la limite de texture Chrome) assemblées en PDF A4
//     avec jsPDF. Le rendu est alors identique a l'écran (couleurs conservees).
//  3. Dernier recours : impression native (window.print) via content.js.

importScripts('libs/jspdf.umd.min.js');

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'devtools://', 'about:', 'view-source:'];
const MIN_PDF_B64_LEN = 40000;  // en dessous, le PDF vectoriel est probablement vide
const MAX_SLICE_HEIGHT = 16000; // limite de texture GPU de Chrome pour captureScreenshot

// Chauffe les conteneurs a scroll interne (declenche le lazy-load, ex. liste
// Gmail chargee au scroll), remonte en haut, puis les compte avec leur hauteur.
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
  // on ne chauffe que les 3 plus gros scrollers (evite les timeouts)
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

// Deplie les conteneurs a scroll interne (Gmail, X, etc.) ET toute leur chaîne
// d'ancêtres (layouts en 100vh / overflow hidden), avec !important pour
// battre les classes du site. Styles inline sauvegardes dans window.__pdfSaved.
const UNFOLD_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // idempotent : restaure d'abord un eventuel depliage precedent
  (window.__pdfSaved || []).forEach(s => { s.el.style.cssText = s.cssText; });
  window.__pdfSaved = [];
  const save = (el) => {
    if (!window.__pdfSaved.some(s => s.el === el)) window.__pdfSaved.push({ el, cssText: el.style.cssText });
  };
  const unfoldEl = (el) => {
    save(el);
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
  };
  document.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'hidden' || cs.overflow === 'hidden') && el.scrollHeight > el.clientHeight + 50) {
      let node = el;
      while (node && node !== document.documentElement) { unfoldEl(node); node = node.parentElement; }
    }
  });
  unfoldEl(document.body);
  unfoldEl(document.documentElement);
  await sleep(500);
  return JSON.stringify({ n: window.__pdfSaved.length, docH: document.documentElement.scrollHeight });
})()`;

// Restaure les styles inline apres la capture
const REFOLD_SCRIPT = `(() => {
  (window.__pdfSaved || []).forEach(s => { s.el.style.cssText = s.cssText; });
  window.__pdfSaved = null;
  return 'ok';
})()`;

let busy = false; // evite les doubles clics concurrents (un seul debugger par onglet)

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
      console.log('Webpage to PDF: export termine');
      return;
    } catch (err) {
      // ex: DevTools deja ouvert sur l'onglet ("Another debugger is already attached")
      console.warn('Webpage to PDF: export CDP a echoue, fallback impression native.', err);
      try { await chrome.debugger.detach({ tabId: tab.id }); } catch (_) { /* deja detache */ }
    }
  } else {
    // Pages internes Chrome (chrome://, Web Store...) : aucune extension n'y a acces
    console.info('Webpage to PDF: les pages internes Chrome (chrome://, etc.) ne peuvent pas etre exportees. Utilisez un onglet web normal.');
    return;
  }

  // Fallback : boite de dialogue d'impression native (Ctrl+P -> "Enregistrer au format PDF")
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { action: 'fallbackPrint' });
  } catch (err) {
    console.error('Webpage to PDF: fallback impossible sur cette page.', err);
  }
}

async function exportTabToPDF(tab) {
  const target = { tabId: tab.id };

  await chrome.debugger.attach(target, '1.3');
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    await waitForPageReady(target);

    // Les conteneurs a scroll interne (Gmail, X...) ne sont ni pagines par
    // printToPDF ni capturable au-dela du viewport : il faut le mode capture.
    const scrollerRes = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: SCROLLER_WARMUP,
      returnByValue: true,
      awaitPromise: true
    });
    const scrollerInfo = JSON.parse(scrollerRes.result.value || '{"n":0}');
    const internalScrollers = scrollerInfo.n || 0;

    // 1) tentative vectorielle
    const pdf = await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
      landscape: false,
      printBackground: true,      // conserve les fonds colores
      preferCSSPageSize: true,    // respecte @page { size: ... } de la page
      displayHeaderFooter: false,
      scale: 1,
      paperWidth: 8.27,           // A4 en pouces
      paperHeight: 11.69,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4
    });

    if (pdf.data.length >= MIN_PDF_B64_LEN && internalScrollers === 0) {
      await savePdf(tab, 'data:application/pdf;base64,' + pdf.data);
      return;
    }

    // 2) contenu masque a l'impression ou scroll interne -> capture pleine page en image
    console.log(`Webpage to PDF: mode capture (PDF=${pdf.data.length} car., scrollers=${internalScrollers}, maxScroll=${scrollerInfo.maxScroll})`);
    await captureFullPageToPDF(target, tab);
  } finally {
    try { await chrome.debugger.detach(target); } catch (_) { /* ignore */ }
  }
}

// Capture la page entiere en JPEG et assemble un PDF A4 avec jsPDF.
// On ne fait confiance ni au scrollHeight (peut etre gonfle artificiellement)
// : on capture d'abord toute la page sans clip (captureBeyondViewport laisse
// Chrome calculer la hauteur reelle), on lit les vraies dimensions dans
// l'en-tete JPEG, puis on decoupe en tranches uniquement si > 16384 px.
async function captureFullPageToPDF(target, tab) {
  // Deplier d'abord les conteneurs a scroll interne (sinon la capture s'arrete
  // au viewport, ex. liste Gmail) ; on restaure les styles dans le finally.
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
    if (!size) throw new Error('Impossible de lire les dimensions du screenshot');
    console.log(`Webpage to PDF: capture pleine page ${size.w}x${size.h}`);

    let slices;
    if (size.h <= MAX_SLICE_HEIGHT) {
      slices = [{ data: full.data, w: size.w, h: size.h }];
    } else {
      slices = [];
      for (let y = 0; y < size.h; y += MAX_SLICE_HEIGHT) {
        const height = Math.min(MAX_SLICE_HEIGHT, size.h - y);
        const shot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
          format: 'jpeg',
          quality: 85,
          clip: { x: 0, y, width: size.w, height, scale: 1 },
          captureBeyondViewport: true
        });
        slices.push({ data: shot.data, w: size.w, h: height });
      }
    }

    const { jsPDF } = self.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();   // 210 mm
    const pageH = pdf.internal.pageSize.getHeight();  // 297 mm

    slices.forEach((s, i) => {
      if (i > 0) pdf.addPage();
      const scale = Math.min(pageW / s.w, pageH / s.h);
      const imgW = s.w * scale;
      const imgH = s.h * scale;
      pdf.addImage('data:image/jpeg;base64,' + s.data, 'JPEG', (pageW - imgW) / 2, 0, imgW, imgH);
    });

    await savePdf(tab, pdf.output('datauristring'));
  } finally {
    // restaure les conteneurs a scroll interne deplies
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
    // data: URL rejetee (trop grosse) -> telechargement via Blob cote page
    console.warn('Webpage to PDF: data URL refusee, fallback Blob via content script', e);
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'savePDF', b64, filename });
    if (!res || !res.success) throw e;
  }
}

// Lit la largeur/hauteur reelles d'un JPEG encode en base64 (marqueur SOF)
function jpegSize(b64) {
  try {
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15 (sauf DHT/DAC/JPG) contiennent les dimensions
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      i += 2 + len;
    }
  } catch (_) { /* ignore */ }
  return null;
}

// Attend que document.readyState === 'complete' (images, polices, etc.)
async function waitForPageReady(target, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { result } = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      });
      if (result && result.value === 'complete') return;
    } catch (_) { /* la page ne repond pas encore, on reessaie */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Log si l'utilisateur ferme la banniere de debogage pendant l'operation
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log('Webpage to PDF: debugger detache', JSON.stringify(source), reason);
});
