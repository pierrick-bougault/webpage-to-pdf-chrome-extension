// Content script — deux rôles, chacun avec un guard anti double injection :
//  1. savePDF : recoit le PDF (base64) du service worker et le telecharge
//     depuis la page via un Blob + <a download> (fallback quand la data: URL
//     est trop grosse pour chrome.downloads).
//  2. fallbackPrint : impression native (Ctrl+P -> "Enregistrer au format PDF").

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
