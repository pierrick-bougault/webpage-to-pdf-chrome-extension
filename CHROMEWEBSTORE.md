# Chrome Web Store — Informations de publication

## Permissions demandées et justifications

| Permission | Justification |
|---|---|
| `activeTab` | Nécessaire pour cibler l'onglet actif au clic sur l'icône et y lire la page à exporter. Aucun accès en dehors du clic utilisateur. |
| `debugger` | Utilisée via `chrome.debugger` pour appeler `Page.printToPDF` / `Page.captureScreenshot` (protocole DevTools) sur l'onglet actif, afin de produire un PDF fidèle de la page (texte vectoriel sélectionnable, pleine page). Aucun envoi de données hors du navigateur ; le debugger est détaché immédiatement après l'export. |
| `scripting` | Pour injecter `content.js` dans l'onglet actif uniquement en fallback (téléchargement du PDF via Blob, ou impression native `window.print()`). |
| `downloads` | Pour enregistrer le PDF généré dans le dossier de téléchargements de l'utilisateur. |
| `host_permissions: <all_urls>` | Requis pour que `chrome.debugger` puisse s'attacher à n'importe quel onglet web au clic de l'utilisateur. Aucun accès réseau, aucune collecte de données. |

## Confidentialité

- Aucune donnée utilisateur n'est collectée, transmise ou vendue.
- Le contenu des pages n'est jamais envoyé ailleurs qu'au moteur de rendu local de Chrome.
- Aucun compte, aucune authentification, aucun suivi.

## Description courte (listing)

Exporte n'importe quelle page web en PDF pleine page d'un clic : rendu fidèle par le moteur Chrome (couleurs, mise en page), PDF vectoriel quand c'est possible, sinon capture pleine page de haute qualité. Fonctionne aussi sur les sites à scroll interne (Gmail…) et ceux qui masquent leur contenu à l'impression.
