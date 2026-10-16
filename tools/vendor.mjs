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
console.log(`vendored manifold-3d ${version('manifold-3d')} and three ${version('three')} add-ons`);
