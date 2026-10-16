// Version comparison used by the updater.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { isNewer } = createRequire(import.meta.url)('../../electron/version.cjs');

test('newer versions are detected number by number', () => {
  assert.equal(isNewer('1.1.0', '1.0.0'), true);
  assert.equal(isNewer('1.10.0', '1.9.2'), true);
  assert.equal(isNewer('v2.0.0', '1.99.99'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('1.0', '1.0.1'), false);
  assert.equal(isNewer('1.2.0-beta', '1.1.9'), true);
});
