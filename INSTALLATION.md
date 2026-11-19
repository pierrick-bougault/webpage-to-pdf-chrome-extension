# Extension Chrome : Webpage to PDF

Une extension pour exporter n'importe quelle page web en PDF (capture complète de la page).

## Structure du Projet

projet_webpage_to_pdf/
├── manifest.json          # Configuration de l'extension
├── background.js          # Service Worker (gestion des événements)
├── content.js             # Script de capture et génération PDF
├── icons/                 # Icônes de l'extension
│   ├── icon16.svg
│   ├── icon32.svg
│   ├── icon48.svg
│   └── icon128.svg
├── libs/                  # Bibliothèques externes
│   ├── html2canvas.min.js # Pour capturer le DOM en image
│   └── jspdf.umd.min.js   # Pour générer le PDF
└── test_extension.html    # Page de test

## Installation

### Methode 1 : Chargement en mode développement

1. Ouvrir Chrome et aller à l'adresse :
   chrome://extensions/

2. Activer le mode développeur (bouton en haut à droite)

3. Charger l'extension :
   - Cliquez sur "Charger l'extension non empaquetée"
   - Sélectionnez le dossier projet_webpage_to_pdf

4. L'extension est installée !
   - Une nouvelle icône apparaîtra dans la barre d'outils de Chrome

### Methode 2 : Empaquetage pour distribution

1. Dans chrome://extensions/, activez le mode développeur
2. Cliquez sur "Empaquer l'extension"
3. Sélectionnez le dossier du projet
4. Chrome générera un fichier .crx et .pem

## Utilisation

### Exporter une page en PDF :

1. Naviguez vers la page web que vous voulez exporter
2. Cliquez sur l'icône de l'extension dans la barre d'outils
3. Le PDF sera généré et téléchargé automatiquement

### Le PDF inclut :
- Tout le contenu visible de la page
- Les images et styles CSS
- Les tableaux et mise en page
- Le contenu qui nécessite un défilement

## Fonctionnement Technique

### Processus d'export :

1. background.js écoute le clic sur l'icône
2. Il attache le débogueur CDP à l'onglet actif (permission `debugger`)
3. Il appelle `Page.printToPDF` : **Chrome rend lui-même la page en PDF**
   (pleine page, PDF vectoriel, aucune lib de capture côté page)
4. Le PDF (base64) est téléchargé automatiquement via `chrome.downloads`

Pourquoi ce changement : html2canvas plante sur les sites modernes (ex: Gmail)
avec `Attempting to parse an unsupported color function "lab"`, car il ne
connaît pas les couleurs CSS `lab()`/`oklch()`. `Page.printToPDF` ne parse
aucun CSS en JS : le rendu est identique à l'aperçu avant impression.

### Fallback :
Si le débogage CDP est indisponible (DevTools déjà ouvert, page `chrome://`),
l'extension injecte content.js qui ouvre l'impression native (window.print()).

## Personnalisation

### Modifier le nom du fichier PDF, le format, les marges :
Dans background.js, voir l'appel à `Page.printToPDF` dans `exportTabToPDF()`
(paperWidth/paperHeight, landscape, margins, printBackground).

## Notes

- Limitations : Certaines pages avec du contenu dynamique peuvent ne pas être capturées parfaitement.
- Permissions : L'extension nécessite l'accès à la page active pour fonctionner.
- Compatibilité : Fonctionne avec Chrome 90+ (Manifest V3)

## Licence

Ce projet est libre d'utilisation. Les bibliothèques utilisées ont leurs propres licences (MIT).
