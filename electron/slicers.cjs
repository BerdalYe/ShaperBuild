// Finds installed 3D-printing slicers and opens files in them.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Where each slicer usually lives. Windows paths are relative to the
// Program Files folders; macOS entries are app bundles; Linux entries are
// commands looked up on PATH.
const SLICERS = [
  {
    id: 'prusa',
    name: 'PrusaSlicer',
    win: ['Prusa3D/PrusaSlicer/prusa-slicer.exe'],
    mac: ['PrusaSlicer.app', 'Original Prusa Drivers/PrusaSlicer.app'],
    linux: ['prusa-slicer', 'PrusaSlicer'],
  },
  { id: 'bambu', name: 'Bambu Studio', win: ['Bambu Studio/bambu-studio.exe'], mac: ['BambuStudio.app', 'Bambu Studio.app'], linux: ['bambu-studio'] },
  { id: 'orca', name: 'OrcaSlicer', win: ['OrcaSlicer/orca-slicer.exe'], mac: ['OrcaSlicer.app'], linux: ['orca-slicer', 'OrcaSlicer'] },
  { id: 'cura', name: 'UltiMaker Cura', win: ['UltiMaker Cura*/UltiMaker-Cura.exe', 'Ultimaker Cura*/Ultimaker-Cura.exe', 'Ultimaker Cura*/Cura.exe'], mac: ['UltiMaker Cura.app', 'Ultimaker Cura.app'], linux: ['cura', 'UltiMaker-Cura'] },
  { id: 'creality', name: 'Creality Print', win: ['Creality/Creality Print*/CrealityPrint.exe', 'Creality Print*/CrealityPrint.exe'], mac: ['Creality Print.app', 'CrealityPrint.app'], linux: ['CrealityPrint', 'creality-print'] },
];

// Expand a single "*" in one path segment.
function globOne(base, rel) {
  const parts = rel.split('/');
  let dirs = [base];
  for (const part of parts) {
    const next = [];
    for (const d of dirs) {
      if (part.includes('*')) {
        const re = new RegExp(`^${part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace('*', '.*')}$`, 'i');
        let names = [];
        try {
          names = fs.readdirSync(d);
        } catch {}
        for (const n of names.sort().reverse()) if (re.test(n)) next.push(path.join(d, n));
      } else next.push(path.join(d, part));
    }
    dirs = next;
  }
  return dirs.filter((p) => fs.existsSync(p));
}

function onPath(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

let cache = null;

function findSlicers() {
  if (cache) return cache;
  const found = [];
  for (const s of SLICERS) {
    let target = null;
    if (process.platform === 'win32') {
      const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
      for (const b of bases) for (const rel of s.win) target ||= globOne(b, rel)[0] || null;
    } else if (process.platform === 'darwin') {
      const bases = ['/Applications', path.join(process.env.HOME || '', 'Applications')];
      for (const b of bases) for (const rel of s.mac) if (!target && fs.existsSync(path.join(b, rel))) target = path.join(b, rel);
    } else {
      for (const cmd of s.linux) target ||= onPath(cmd);
    }
    if (target) found.push({ id: s.id, name: s.name, target });
  }
  cache = found;
  return found;
}

function listSlicers() {
  return findSlicers().map(({ id, name }) => ({ id, name }));
}

// Open `file` in the slicer with this id. Returns false if it is not installed.
function openInSlicer(id, file) {
  const s = findSlicers().find((x) => x.id === id);
  if (!s) return false;
  const child =
    process.platform === 'darwin'
      ? spawn('open', ['-a', s.target, file], { detached: true, stdio: 'ignore' })
      : spawn(s.target, [file], { detached: true, stdio: 'ignore', cwd: path.dirname(s.target) });
  child.on('error', () => {});
  child.unref();
  return true;
}

module.exports = { listSlicers, openInSlicer, SLICERS };
