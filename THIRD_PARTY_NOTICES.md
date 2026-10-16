# Third-party software in ShaperBuild

ShaperBuild includes the open-source software listed below. Each part keeps
its own licence. The licence texts are in this repository (paths below),
in the installed app's `resources/licenses` folder, and in the app under
*Help → Open-source licences*.

| Software | Version | Licence | Where the licence text is |
|---|---|---|---|
| [Open CASCADE Technology](https://dev.opencascade.org/) through [replicad-opencascadejs](https://github.com/sgenoud/replicad) (geometry engine, WebAssembly) | 1.1.0 | LGPL-2.1 (OCCT adds the Open CASCADE Exception 1.0) | `src/licenses/LGPL-2.1.txt`, `src/licenses/OCCT_LGPL_EXCEPTION.txt` |
| [Manifold](https://github.com/elalish/manifold) (mesh booleans, WebAssembly) | 3.5.3 | Apache-2.0 | `src/vendor/manifold/LICENSE` |
| [three.js](https://threejs.org/) and its add-ons (3D view, GLB/USDZ export, decals) | 0.180.0 | MIT | `node_modules/three/LICENSE`, `src/vendor/three-addons/LICENSE` |
| [fflate](https://github.com/101arrowz/fflate) (inside the USDZ exporter) | 0.8.2 | MIT | header of `src/vendor/three-addons/libs/fflate.module.js` |
| [opentype.js](https://opentype.js.org/) (reads fonts for the Text tool) | 2.0.0 | MIT | `src/vendor/opentype/LICENSE` |
| [Inter](https://rsms.me/inter/) typeface (Text tool default font) | — | SIL Open Font License 1.1 | `src/fonts/OFL.txt` |
| [Electron](https://www.electronjs.org/) (app shell, includes Chromium and Node.js) | 44.5.0 | MIT; Chromium and Node.js under their own licences | `src/licenses/electron.txt`; `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the installed app |
| [electron-updater](https://www.electron.build/auto-update) and its dependencies (builder-util-runtime, debug, fs-extra, graceful-fs, js-yaml, jsonfile, lazy-val, lodash.escaperegexp, lodash.isequal, ms, sax, semver, tiny-typed-emitter, tslib, universalify, argparse) | 6.8.9 | MIT, ISC, BlueOak-1.0.0, 0BSD, Python-2.0 | `src/licenses/update-checker.txt` |

## The geometry engine (LGPL)

The geometry engine (Open CASCADE Technology, compiled to WebAssembly by
replicad-opencascadejs) is used as a separate library: its files
(`replicad_single.js` and `replicad_single.wasm`) are shipped unchanged and
loaded at run time, outside the app's archive, in
`resources/app.asar.unpacked/node_modules/replicad-opencascadejs/dist/`.
You may replace them with your own build of the same library (for example
a modified Open CASCADE build) and ShaperBuild will use it.

Source code:

- replicad-opencascadejs 1.1.0: <https://github.com/sgenoud/replicad>
  (folder `packages/replicad-opencascadejs`), built with
  [opencascade.js](https://github.com/donalffons/opencascade.js) from
  Open CASCADE Technology <https://github.com/Open-Cascade-SAS/OCCT>.
- ShaperBuild has not changed these files. If the links stop working,
  ask through the project's GitHub page and we will send the source code
  of the exact version we ship, for at least three years after we last
  ship it.

## Trademarks

Shapr3D is a trademark of Shapr3D Zrt. ShaperBuild is an independent
project; it is not made, endorsed or supported by Shapr3D Zrt. Other names
(STEP, glTF, USDZ, iPhone, iPad, PrusaSlicer, Bambu Studio, OrcaSlicer,
Cura, Creality Print and others) belong to their owners and are only used
to say which files and programs ShaperBuild works with.
