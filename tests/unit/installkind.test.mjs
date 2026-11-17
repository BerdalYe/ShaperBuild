// Which installer a copy came from (decides how it updates).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { installKind } = createRequire(import.meta.url)('../../electron/installkind.cjs');

function resources(marker) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-res-'));
  if (marker !== undefined) fs.writeFileSync(path.join(dir, 'package-type'), marker);
  return dir;
}

test('the MSI marker is found, whatever its case or line ending', () => {
  assert.equal(installKind(resources('msi\n')), 'msi');
  assert.equal(installKind(resources('MSI\r\n')), 'msi');
});

test('the deb marker electron-builder writes is found', () => {
  assert.equal(installKind(resources('deb')), 'deb');
});

test('no marker, or no folder, means the normal installer', () => {
  assert.equal(installKind(resources()), '');
  assert.equal(installKind('/nonexistent/shaperbuild/resources'), '');
});
