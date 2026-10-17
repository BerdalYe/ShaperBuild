// Language for the native menus and dialogs (main process). The renderer
// tells us the chosen language; it is kept for the next start.
const fs = require('node:fs');
const path = require('node:path');

const NB = {
  // Menus
  'About ShaperBuild': 'Om ShaperBuild',
  'Settings…': 'Innstillinger…',
  File: 'Fil',
  'New Design': 'Ny modell',
  'Open…': 'Åpne…',
  'Open Recent': 'Åpne nylige',
  'Clear Recent': 'Tøm listen',
  'No recent designs': 'Ingen nylige modeller',
  Save: 'Lagre',
  'Save As…': 'Lagre som…',
  'Versions…': 'Versjoner…',
  'Open-Source Licences': 'Lisenser for åpen kildekode',
  Privacy: 'Personvern',
  'Import…': 'Importer…',
  '3D Print…': '3D-utskrift…',
  '2D Drawing (PDF)…': '2D-tegning (PDF)…',
  Export: 'Eksporter',
  'STL (3D printing)…': 'STL (3D-utskrift)…',
  '3MF (3D printing)…': '3MF (3D-utskrift)…',
  'OBJ…': 'OBJ…',
  'STEP (CAD)…': 'STEP (CAD)…',
  'GLB (3D viewers, web)…': 'GLB (3D-visning, nett)…',
  'USDZ (AR on iPhone and iPad)…': 'USDZ (AR på iPhone og iPad)…',
  'DXF (sketches, laser cutting)…': 'DXF (skisser, laserkutting)…',
  'Image (PNG)…': 'Bilde (PNG)…',
  'Close Design': 'Lukk modell',
  Exit: 'Avslutt',
  Edit: 'Rediger',
  Undo: 'Angre',
  Redo: 'Gjør om',
  Cut: 'Klipp ut',
  Copy: 'Kopier',
  Paste: 'Lim inn',
  Duplicate: 'Dupliser',
  Delete: 'Slett',
  'Select All Bodies': 'Velg alle objekter',
  Deselect: 'Fjern merking',
  View: 'Vis',
  'Zoom to Fit': 'Zoom til alt',
  Isometric: 'Isometrisk',
  Top: 'Ovenfra',
  Front: 'Forfra',
  Right: 'Fra høyre',
  Back: 'Bakfra',
  Left: 'Fra venstre',
  Bottom: 'Nedenfra',
  'Look at Sketch / Face': 'Se rett på skisse / flate',
  'Perspective / Orthographic': 'Perspektiv / ortografisk',
  'Visualization Mode': 'Visualiseringsmodus',
  'Section View': 'Snittvisning',
  'X-ray': 'Røntgen',
  'Show Grid': 'Vis rutenett',
  'Show Edges': 'Vis kanter',
  'Light / Dark Theme': 'Lyst / mørkt tema',
  'Items Panel': 'Elementpanel',
  'Design History': 'Modellhistorikk',
  'Tool Names in Tools Menu': 'Verktøynavn i verktøymenyen',
  'Toggle Full Screen': 'Fullskjerm av/på',
  Help: 'Hjelp',
  'Tutorials…': 'Innføringer…',
  'How to Move Around': 'Slik beveger du deg rundt',
  'Find a Tool…': 'Finn et verktøy…',
  'Keyboard Shortcuts': 'Hurtigtaster',
  'Getting Started': 'Kom i gang',
  'Check for Updates…': 'Se etter oppdateringer…',
  'Developer Tools': 'Utviklerverktøy',
  'Licenses and Privacy': 'Lisenser og personvern',
  Language: 'Språk',
  // Close dialog
  "Don't Save": 'Ikke lagre',
  Cancel: 'Avbryt',
  'Do you want to save the changes to your design?': 'Vil du lagre endringene i modellen?',
  "Your changes will be lost if you don't save them.": 'Endringene går tapt hvis du ikke lagrer dem.',
  // File dialog filters
  'ShaperBuild design': 'ShaperBuild-modell',
  'All supported': 'Alle støttede',
  'Mesh (STL, OBJ, 3MF)': 'Mesh (STL, OBJ, 3MF)',
  'DXF drawing': 'DXF-tegning',
  'Image to trace': 'Bilde å tegne over',
  'DXF drawing (becomes a sketch)': 'DXF-tegning (blir en skisse)',
  'Image to trace (PNG, JPG)': 'Bilde å tegne over (PNG, JPG)',
  'PDF document': 'PDF-dokument',
  'SVG image': 'SVG-bilde',
  Fonts: 'Skrifttyper',
  'PNG image': 'PNG-bilde',
  copy: 'kopi',
  'glTF binary (GLB)': 'glTF binær (GLB)',
  'USDZ (AR on iPhone and iPad)': 'USDZ (AR på iPhone og iPad)',
  Images: 'Bilder',
  Untitled: 'Uten navn',
};

const DICTS = { nb: NB };
let lang = 'en';
let file = null;

function init(userData) {
  file = path.join(userData, 'language.json');
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).language;
    if (DICTS[v] || v === 'en') lang = v;
  } catch {}
  return lang;
}

// Returns true when the language changed.
function setLanguage(v) {
  const next = DICTS[v] ? v : 'en';
  if (next === lang) return false;
  lang = next;
  try {
    if (file) fs.writeFileSync(file, JSON.stringify({ language: lang }));
  } catch {}
  return true;
}

function t(text) {
  if (lang === 'en') return text;
  return DICTS[lang][text] ?? text;
}

module.exports = { init, setLanguage, t, language: () => lang, NB };
