// Content script — two roles, each guarded against double injection:
//  1. savePDF: receives the PDF (base64) from the service worker and downloads
//     it from the page via a Blob + <a download> (fallback when the data: URL
//     is too large for chrome.downloads).
//  2. fallbackPrint: native print dialog (Ctrl+P -> "Save as PDF").

if (!window.__webpageToPdfListener) {
  window.__webpageToPdfListener = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'savePDF') {
      try {
        const bin = atob(msg.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = msg.filename || 'webpage.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      return true;
    }

    if (msg && msg.action === 'fallbackPrint') {
      const style = document.createElement('style');
      style.textContent = `
        @media print {
          @page { size: auto; margin: 0; }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `;
      document.head.appendChild(style);
      setTimeout(() => window.print(), 150);
      sendResponse({ success: true });
      return true;
    }
  });
}
