// Writes electron-builder.msi.json, the settings for the Windows MSI: the
// normal build settings with the MSI as the only target, its own output
// folder, and a marker file (resources/package-type = "msi") so the app knows
// it came from the MSI and does not try to update itself with the .exe
// installer. Run by the build workflow; `npx electron-builder --win
// --config electron-builder.msi.json --publish never` builds from it.
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const cfg = structuredClone(pkg.build);
cfg.directories = { ...cfg.directories, output: 'dist-msi' };
cfg.win = { ...cfg.win, target: [{ target: 'msi', arch: ['x64'] }] };
cfg.extraResources = [...(cfg.extraResources || []), { from: 'build/package-type-msi', to: 'package-type' }];
cfg.msi = {
  oneClick: true,
  perMachine: false,
  runAfterFinish: true,
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  // Harmless WiX notes must not stop a release.
  warningsAsErrors: false,
  artifactName: 'ShaperBuild-${version}-x64.${ext}',
};
fs.writeFileSync('electron-builder.msi.json', `${JSON.stringify(cfg, null, 2)}\n`);
console.log('Wrote electron-builder.msi.json');
