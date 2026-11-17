// How this copy was installed, from the marker file in the app's resources
// folder: Linux .deb builds carry "deb" (written by electron-builder), the
// Windows MSI build carries "msi" (see tools/msi-config.mjs). No marker means
// the normal installer (Windows .exe, AppImage…).
const fs = require('node:fs');
const path = require('node:path');

function installKind(resourcesPath, readFile = fs.readFileSync) {
  try {
    return String(readFile(path.join(resourcesPath, 'package-type'), 'utf8')).trim().toLowerCase();
  } catch {
    return '';
  }
}

module.exports = { installKind };
