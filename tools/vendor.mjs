// Copies the few third-party browser files the app loads into src/vendor,
// so installers ship only what is used. Run after upgrading three or
// manifold-3d: npm run vendor
import fs from 'node:fs';
import path from 'node:path';

function copy(from, to, files) {
  for (const f of files) {
    fs.mkdirSync(path.dirname(`${to}/${f}`), { recursive: true });
    fs.copyFileSync(`${from}/${f}`, `${to}/${f}`);
  }
}
const version = (pkg) => JSON.parse(fs.readFileSync(`node_modules/${pkg}/package.json`, 'utf8')).version;

// Manifold (mesh booleans): just the WASM build, not its CLI tooling.
copy('node_modules/manifold-3d', 'src/vendor/manifold', ['manifold.js', 'manifold.wasm', 'LICENSE']);
fs.writeFileSync('src/vendor/manifold/VERSION', `${version('manifold-3d')}\n`);

// three.js add-ons (the import map points "three/addons/" here).
copy('node_modules/three/examples/jsm', 'src/vendor/three-addons', [
  'controls/TransformControls.js',
  'environments/RoomEnvironment.js',
  'exporters/GLTFExporter.js',
  'exporters/USDZExporter.js',
  'geometries/DecalGeometry.js',
  'libs/fflate.module.js',
  'lines/LineMaterial.js',
  'lines/LineSegments2.js',
  'lines/LineSegmentsGeometry.js',
  'utils/BufferGeometryUtils.js',
]);
fs.copyFileSync('node_modules/three/LICENSE', 'src/vendor/three-addons/LICENSE');
fs.writeFileSync('src/vendor/three-addons/VERSION', `${version('three')}\n`);
// opentype.js (reads fonts for the Text tool) and the Inter font.
fs.mkdirSync('src/vendor/opentype', { recursive: true });
fs.writeFileSync('src/vendor/opentype/opentype.min.mjs', fs.readFileSync('node_modules/opentype.js/dist/opentype.min.mjs', 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n'));
fs.copyFileSync('node_modules/opentype.js/LICENSE', 'src/vendor/opentype/LICENSE');
fs.writeFileSync('src/vendor/opentype/VERSION', `${version('opentype.js')}\n`);
fs.mkdirSync('src/fonts', { recursive: true });
fs.copyFileSync('node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf', 'src/fonts/Inter-Bold.ttf');
fs.copyFileSync('node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf', 'src/fonts/Inter-Regular.ttf');
fs.copyFileSync('node_modules/@expo-google-fonts/inter/LICENSE_FONT', 'src/fonts/OFL.txt');
// Licence texts shown under Help > Open-source licences (and shipped as
// files). OCCT_LGPL_EXCEPTION.txt is kept in the repository (from the OCCT
// sources).
fs.mkdirSync('src/licenses', { recursive: true });
fs.copyFileSync('LICENSE', 'src/licenses/ShaperBuild.txt');
fs.copyFileSync('node_modules/replicad-opencascadejs/LICENSE', 'src/licenses/LGPL-2.1.txt');
fs.copyFileSync('node_modules/electron/LICENSE', 'src/licenses/electron.txt');
// The update checker and the packages it needs, in one file.
const runtime = ['electron-updater', 'builder-util-runtime', 'debug', 'fs-extra', 'graceful-fs', 'js-yaml', 'argparse', 'jsonfile', 'lazy-val', 'lodash.escaperegexp', 'lodash.isequal', 'ms', 'sax', 'semver', 'tiny-typed-emitter', 'tslib', 'universalify'];
const parts = runtime.map((name) => {
  const dir = `node_modules/${name}`;
  const pkg = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  const text = file ? fs.readFileSync(`${dir}/${file}`, 'utf8').trim() : `${pkg.license} licence. Copyright (c) ${typeof pkg.author === 'object' ? pkg.author.name : pkg.author || 'its authors'}.`;
  return `==== ${name} ${pkg.version} (${pkg.license}) ====\n\n${text}\n`;
});
fs.writeFileSync('src/licenses/update-checker.txt', parts.join('\n'));
console.log(`vendored manifold-3d ${version('manifold-3d')}, three ${version('three')} add-ons, opentype.js ${version('opentype.js')} and Inter`);
