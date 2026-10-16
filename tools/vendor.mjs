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
console.log(`vendored manifold-3d ${version('manifold-3d')}, three ${version('three')} add-ons, opentype.js ${version('opentype.js')} and Inter`);
