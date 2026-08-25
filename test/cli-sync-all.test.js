const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectResources } = require('../scripts/cli-sync-all.js');

function writeJson(dir, file, value) {
  fs.writeFileSync(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
}

test('detectResources returns supported resources in dependency order', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-store-sync-test-'));

  writeJson(tempDir, 'blogs.json', [{ handle: 'news' }]);
  writeJson(tempDir, 'collections.json', [{ handle: 'cups' }]);
  writeJson(tempDir, 'pages.json', [{ handle: 'contact-us' }]);
  writeJson(tempDir, 'articles.json', []);
  writeJson(tempDir, 'products.json', [{ handle: 'sample-product' }]);
  writeJson(tempDir, 'menus.json', [{ handle: 'main-menu' }]);
  writeJson(tempDir, 'redirects.json', [{ path: '/pages/contact', target: '/pages/contact-us' }]);

  const detected = detectResources(tempDir);

  assert.deepEqual(
    detected.map((resource) => resource.name),
    ['blogs', 'collections', 'pages', 'articles', 'products', 'metafields', 'menus', 'redirects']
  );

  assert.deepEqual(
    detected.map((resource) => resource.count),
    [1, 1, 1, 0, 1, 1, 1, 1]
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('detectResources skips missing source files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-store-sync-test-'));
  writeJson(tempDir, 'products.json', [{ handle: 'sample-product' }]);

  const detected = detectResources(tempDir);

  assert.deepEqual(
    detected.map((resource) => resource.name),
    ['products', 'metafields']
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});
