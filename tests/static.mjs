// Static checks: JavaScript syntax, translation coverage, version metadata.
//   node tests/static.mjs

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

let failures = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures++;
}

// ------------------------------------------------------------- javascript
const scripts = readdirSync(join(root, 'Vendor/js')).filter((name) => name.endsWith('.js'));
for (const name of scripts) {
  let error = '';
  try {
    execFileSync(process.execPath, ['--check', join(root, 'Vendor/js', name)], { stdio: 'pipe' });
  } catch (err) {
    error = String(err.stderr || err.message);
  }
  check(`Vendor/js/${name} parses`, error === '', error);
}

// The overlay runs inside OBS, whose browser can be years old (Chromium 103 in OBS 29/30).
const overlayCss = read('Vendor/css/overlay.css').replace(/\/\*[\s\S]*?\*\//g, '');
for (const [feature, pattern] of [
  ['color-mix()', /color-mix\(/],
  [':has()', /:has\(/],
  ['@container', /@container/],
  ['individual transform properties', /(^|[;{\s])(translate|rotate|scale)\s*:/m],
]) {
  check(`overlay.css avoids ${feature} (OBS browser compatibility)`, !pattern.test(overlayCss));
}

// ----------------------------------------------------------- translations
const dictionary = JSON.parse(read('Autoload/translations.json'));
const keys = Object.keys(dictionary).filter((key) => !key.startsWith('_'));
const languages = ['en', 'ro'];

const incomplete = keys.filter((key) => languages.some((lang) => typeof dictionary[key][lang] !== 'string' || dictionary[key][lang] === ''));
check('every translation has all languages', incomplete.length === 0, incomplete.join(', '));

const used = new Set();
for (const view of ['Views/control.html', 'Views/overlay.html']) {
  for (const match of read(view).matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) used.add(match[1]);
}
const prefixes = new Set();
for (const script of scripts) {
  const source = read('Vendor/js/' + script);
  // every string literal inside a t(...) / SB.t(...) call, including both sides of a ternary
  for (const call of source.matchAll(/\bt\(((?:[^()]|\([^()]*\))*)\)/g)) {
    const literals = [...call[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    if (!literals.length) continue;
    // t('cmd_' + name): a key assembled at runtime — only its prefix is known here
    if (call[1].includes('+')) prefixes.add(literals[0]);
    else literals.forEach((key) => used.add(key));
  }
}
// keys built at runtime, e.g. t('cmd_' + name): at least one key with that prefix must exist
for (const prefix of prefixes) {
  check(`dynamic keys "${prefix}*" exist`, keys.some((key) => key.startsWith(prefix)));
  used.delete(prefix);
}
const ignored = new Set(['en', 'ro']);
const missing = [...used].filter((key) => !ignored.has(key) && !(key in dictionary));
check('every key used in the views and scripts is translated', missing.length === 0, missing.join(', '));

const dynamicFamilies = [...prefixes];
const unused = keys.filter((key) => !used.has(key) && !dynamicFamilies.some((prefix) => key.startsWith(prefix)));
check('no unused translations', unused.length === 0, unused.join(', '));

// --------------------------------------------------------------- metadata
const about = JSON.parse(read('about.json'));
check('about.json version looks like vX.Y.Z', /^v\d+\.\d+\.\d+$/.test(about._VERSION), about._VERSION);
for (const view of ['Views/control.html', 'Views/overlay.html']) {
  const html = read(view);
  check(`${view} uses only known placeholders`, [...html.matchAll(/\{\{([A-Z_]+)\}\}/g)].every((m) => ['BASE', 'VERSION', 'CONFIG'].includes(m[1])));
}

console.log('\n' + (failures ? `${failures} check(s) failed` : 'all checks passed'));
process.exit(failures ? 1 : 0);
