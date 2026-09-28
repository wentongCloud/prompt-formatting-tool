import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const directory of ['../', '../dist/']) {
  const root = new URL(directory, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  for (const file of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
    assert.ok(existsSync(new URL(file, root)), file);
  }
  for (const locale of ['en', 'zh_CN']) {
    const messages = JSON.parse(readFileSync(new URL(`_locales/${locale}/messages.json`, root), 'utf8'));
    for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
      assert.ok(messages[key]?.message, `${locale}: ${key}`);
    }
  }
  const worker = manifest.background.service_worker;
  let opened;
  runInNewContext(readFileSync(new URL(worker, root), 'utf8'), {
    URL,
    self: { location: { href: `chrome-extension://test/${worker}` } },
    chrome: {
      action: { onClicked: { addListener: (callback) => callback() } },
      tabs: { create: ({ url }) => { opened = new URL(url); } },
    },
  });
  assert.equal(opened.pathname, directory === '../' ? '/dist/index.html' : '/index.html');
  const page = new URL(opened.pathname.slice(1), root);
  const html = readFileSync(page, 'utf8');
  assert.match(html, /src="\.\/assets\/[^" ]+\.js"/);
  for (const [, file] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(existsSync(new URL(file, page)), file);
  }
}
console.log('Project root and dist extension entries verified.');
