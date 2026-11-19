# Extension Chrome : Webpage to PDF

> Une extension simple pour exporter n'importe quelle page web en PDF (capture complète)

## Description

Cette extension Chrome permet de capturer **toute la page web** (y compris le contenu qui nécessite un défilement) et de l'exporter en format PDF avec une seule action.

## Caractéristiques

- Capture complète de la page (pagination automatique, hauteur illimitée)
- **PDF vectoriel** rendu par Chrome lui-même : texte sélectionnable, liens cliquables
- Conservation exacte des styles CSS (couleurs modernes `lab()`/`oklch()` incluses — plus d'erreur html2canvas)
- Téléchargement automatique du fichier
- Icône visible dans la barre d'outils
- Fallback sur l'impression native (`Ctrl+P` → Enregistrer en PDF) si le débogage CDP est indisponible

## Installation

### Méthode Rapide (Développement)

1. Ouvrez Chrome et allez sur : **`chrome://extensions/`**
2. Activez le **mode développeur** (bouton en haut à droite)
3. Cliquez sur **"Charger l'extension non empaquetée"**
4. Sélectionnez le dossier **`projet_webpage_to_pdf`**

✅ L'extension est prête à l'emploi !

## Utilisation

1. Naviguez vers n'importe quelle page web
2. Cliquez sur l'icône de l'extension dans la barre d'outils
3. Le PDF sera généré et téléchargé automatiquement

## Structure du Projet

```
projet_webpage_to_pdf/
├── manifest.json          # Configuration de l'extension (permission "debugger")
├── background.js          # Service Worker : Page.printToPDF via chrome.debugger (CDP)
├── content.js             # Fallback : impression native (window.print)
├── README.md              # Documentation
├── INSTALLATION.md        # Instructions détaillées
├── test_extension.html    # Page de test
├── icons/                 # Icônes de l'extension
│   ├── icon16.svg
│   ├── icon32.svg
│   ├── icon48.svg
│   └── icon128.svg
└── libs/                  # Anciennes libs (html2canvas/jsPDF) — plus utilisées
```

## Technologie

- **Manifest V3** : Compatible avec les dernières versions de Chrome
- **chrome.debugger + Page.printToPDF** : PDF vectoriel produit par le moteur Chrome
  (pas de capture DOM en JS, donc aucun problème avec les CSS modernes type `lab()`)
- **Fallback capture pleine page** : si le site masque son contenu à l'impression
  (ex. texte transparent en `@media print`, comme higgsfield.ai — détecté via un
  PDF anormalement petit) **ou** utilise un scroll interne (Gmail, X… — détecté
  en sondant les conteneurs `overflow: auto/scroll` après les avoir scrollés
  pour déclencher le lazy-load), l'extension bascule sur
  `Page.captureScreenshot` pleine page (`captureBeyondViewport`, tranches de
  16 000 px max) assemblées en PDF A4 avec jsPDF. Avant la capture, tous les
  conteneurs à scroll interne **et leurs ancêtres** sont dépliés
  (`height/max-height/min-height/overflow` en `!important`), puis restaurés
  après : la page entière est capturée, plus seulement le viewport.
- **Service Worker** : Gestion des événements en arrière-plan

## Personnalisation

Les paramètres du PDF se règlent dans `background.js`, dans l'appel à `Page.printToPDF` :

- **Format de papier** : `paperWidth` / `paperHeight` (en pouces, A4 = 8.27 × 11.69)
- **Orientation** : `landscape: true`
- **Marges** : `marginTop` / `marginBottom` / `marginLeft` / `marginRight`
- **Fonds colorés** : `printBackground: true`
- **Nom du fichier** : pattern `webpage_${title}.pdf` dans `exportTabToPDF()`

## Limitations

- Une bannière « débogage » Chrome apparaît brièvement sur l'onglet pendant la génération
- Si DevTools est déjà ouvert sur l'onglet, l'extension bascule sur l'impression native
- Les pages `chrome://` / Web Store ne sont pas exportables (restriction Chrome) : impression native utilisée

## Prochaines Améliorations

- [ ] Interface de configuration (qualité, format, etc.)
- [ ] Sélection de la zone à capturer
- [ ] Support des pages nécessitant une authentification
- [ ] Optimisation pour les pages très longues (> 10000px)

## Licence

Ce projet est libre d'utilisation. Les bibliothèques utilisées (html2canvas, jsPDF) sont sous licence MIT.

---

**Créé par** : Vibe CLI Agent
**Version** : 1.0.0
**Date** : 2024
