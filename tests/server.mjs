// Integration test for the standalone server (HTTP + WebSocket on one port).
//
//   node tests/server.mjs                     uses `php` from PATH
//   PHP_BIN=runtime/php/php.exe node tests/server.mjs
//
// Needs Node 22+ (global fetch and WebSocket). No dependencies.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const php = process.env.PHP_BIN || 'php';
const data = mkdtempSync(join(tmpdir(), 'sbserver-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail));
  if (!ok) failures++;
}

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const port = await freePort();
const BASE = `http://127.0.0.1:${port}/`;
let serverOutput = '';
const server = spawn(php, ['server.php', `--port=${port}`], { cwd: root, env: { ...process.env, SCOREBOARD_DATA: data } });
server.stdout.on('data', (chunk) => (serverOutput += chunk));
server.stderr.on('data', (chunk) => (serverOutput += chunk));

const action = async (name, payload = {}, headers = {}) => {
  const res = await fetch(BASE + 'api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action: name, payload }),
  });
  return { status: res.status, body: await res.json() };
};

/** A WebSocket client that records every JSON message it receives. */
function client(role) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  const waiters = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    messages.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].test(msg)) waiters.splice(i, 1)[0].resolve(msg);
    }
  };
  return {
    ws,
    messages,
    opened: new Promise((resolve, reject) => {
      ws.onopen = () => {
        if (role) ws.send(JSON.stringify({ type: 'identify', role }));
        resolve();
      };
      ws.onerror = () => reject(new Error('WebSocket failed to connect'));
    }),
    /** Resolve with the first message (already received or future) that matches. */
    next(test, ms = 4000) {
      const seen = messages.find(test);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve) => {
        const waiter = { test, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          resolve(null);
        }, ms);
      });
    },
  };
}

/** Raw TCP exchange: send bytes, collect whatever comes back for `ms`. */
function raw(payload, ms = 900) {
  return new Promise((resolve) => {
    const chunks = [];
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', () => {});
    setTimeout(() => {
      socket.destroy();
      resolve(Buffer.concat(chunks));
    }, ms);
  });
}

function maskedFrame(opcode, text, fin = true) {
  const body = Buffer.from(text);
  const mask = randomBytes(4);
  const head = [(fin ? 0x80 : 0) | opcode];
  if (body.length < 126) head.push(0x80 | body.length);
  else head.push(0x80 | 126, body.length >> 8, body.length & 255);
  const masked = Buffer.from(body.map((byte, i) => byte ^ mask[i % 4]));
  return Buffer.concat([Buffer.from(head), mask, masked]);
}

const handshake = (extra = '') =>
  `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
  `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`;

try {
  // ------------------------------------------------------------- startup
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await sleep(100);
    up = await fetch(BASE + 'api/info').then((res) => res.ok, () => false);
  }
  check('server starts and answers', up, serverOutput);
  if (!up) throw new Error('server did not start');

  const info = await (await fetch(BASE + 'api/info')).json();
  check('reports standalone mode with realtime', info.mode === 'standalone' && info.realtime === true && info.local === true);
  check('local-only by default: no LAN addresses advertised', info.lan === false && info.addresses.length === 0);

  // --------------------------------------------------------------- pages
  const control = await fetch(BASE);
  const controlHtml = await control.text();
  check('control panel is served at /', control.status === 200 && controlHtml.includes('"realtime":true') && !controlHtml.includes('{{'));
  for (const path of ['scoreboard', 'overlay', 'control', 'setup']) {
    const res = await fetch(BASE + path);
    check(`/${path} is served`, res.status === 200 && (await res.text()).includes('SCOREBOARD_CONFIG'));
  }

  const css = await fetch(BASE + 'Vendor/css/overlay.css');
  const etag = css.headers.get('etag');
  check('static files have the right type and an ETag', css.status === 200 && css.headers.get('content-type').startsWith('text/css') && !!etag);
  const cached = await fetch(BASE + 'Vendor/css/overlay.css', { headers: { 'If-None-Match': etag } });
  check('If-None-Match yields 304', cached.status === 304);
  const head = await fetch(BASE + 'Vendor/js/core.js', { method: 'HEAD' });
  check('HEAD sends headers without a body', head.status === 200 && Number(head.headers.get('content-length')) > 1000 && (await head.text()) === '');
  const font = await fetch(BASE + 'Vendor/fonts/Teko/Teko-latin.woff2');
  check('fonts are served as font/woff2', font.status === 200 && font.headers.get('content-type') === 'font/woff2');
  check('translations are served', (await fetch(BASE + 'Autoload/translations.json')).status === 200);

  for (const path of ['Engine/Store.php', 'server.php', 'index.php', 'Autoload/tournament_data.json', 'Autoload/server.php', 'Views/control.html', '.git/config', 'about.json', 'tests/api.php']) {
    const res = await fetch(BASE + path);
    check(`/${path} is not exposed`, res.status === 404);
  }
  const traversal = await raw(`GET /Vendor/../server.php HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  check('path traversal is refused', /^HTTP\/1\.1 400/.test(traversal.toString()));
  const encoded = await raw(`GET /Vendor/%2e%2e/server.php HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  check('encoded path traversal is refused', /^HTTP\/1\.1 400/.test(encoded.toString()));
  const garbage = await raw('NOT HTTP AT ALL\r\n\r\n');
  check('garbage gets a 400, not a crash', /^HTTP\/1\.1 400/.test(garbage.toString()));
  const huge = await raw(`POST /api/action HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 99999999\r\n\r\n`);
  check('oversized bodies get a 413 before they are read', /^HTTP\/1\.1 413/.test(huge.toString()));
  const pipelined = await raw(`GET /api/info HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\nGET /api/state HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  check('keep-alive: two pipelined requests get two responses', (pipelined.toString().match(/HTTP\/1\.1 200 OK/g) || []).length === 2);
  check('PUT on a page is refused', (await fetch(BASE, { method: 'PUT' })).status === 405);
  const rebound = await raw(`GET /api/state HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n`);
  check('requests for a foreign host name are refused (DNS rebinding)', /^HTTP\/1\.1 403/.test(rebound.toString()));
  const byName = await raw(`GET /api/info HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
  check('localhost is accepted as a host name', /^HTTP\/1\.1 200/.test(byName.toString()));

  // ----------------------------------------------------------- websocket
  const panel = client('control');
  await panel.opened;
  const hello = await panel.next((m) => m.type === 'hello');
  check('WebSocket handshake + hello with the full state', !!hello && hello.state.version === 2 && hello.rev === hello.state.rev);

  const overlay = client('overlay');
  await overlay.opened;
  const presence = await panel.next((m) => m.type === 'presence' && m.overlays === 1 && m.controls === 1);
  check('presence counts panels and overlays', !!presence);

  const added = await action('team.add', { name: 'Alpha' });
  const rev = added.body.rev;
  const pushedPanel = await panel.next((m) => m.type === 'state' && m.rev === rev);
  const pushedOverlay = await overlay.next((m) => m.type === 'state' && m.rev === rev);
  check('an HTTP change is pushed to every WebSocket client', !!pushedPanel && !!pushedOverlay && pushedOverlay.state.teams[0].name === 'Alpha');

  panel.ws.send(JSON.stringify({ type: 'action', id: 7, action: 'overlay.hide', payload: {} }));
  const result = await panel.next((m) => m.type === 'result' && m.id === 7);
  const hidden = await overlay.next((m) => m.type === 'state' && m.state.overlay.visible === false);
  check('actions can be sent over the WebSocket too', !!result && result.ok === true && !!hidden);

  panel.ws.send(JSON.stringify({ type: 'action', id: 8, action: 'does.not.exist' }));
  const failed = await panel.next((m) => m.type === 'result' && m.id === 8);
  check('a bad WebSocket action reports an error and keeps the socket', !!failed && failed.ok === false && panel.ws.readyState === 1);

  panel.ws.send('{"type":"ping"}');
  check('application ping gets a pong', !!(await panel.next((m) => m.type === 'pong')));

  // Long logo URLs push the state past 64 KB, so pushes need frames with a 64-bit length.
  const longUrl = 'https://example.com/' + 'a'.repeat(1900);
  await action('tournament.update', { name: 'Big frame test' });
  const many = [];
  for (let i = 0; i < 40; i++) many.push(action('team.add', { name: `Team ${i}`, logo: longUrl + i }));
  const last = (await Promise.all(many)).reduce((max, r) => Math.max(max, r.body.rev), 0);
  const bulk = await overlay.next((m) => m.type === 'state' && m.rev === last, 8000);
  const bulkSize = bulk ? JSON.stringify(bulk).length : 0;
  check('40 concurrent changes all arrive, as frames larger than 64 KB', !!bulk && bulk.state.teams.length === 41 && bulkSize > 70000, 'size ' + bulkSize);
  const revs = overlay.messages.filter((m) => m.type === 'state').map((m) => m.rev);
  check('revisions only ever increase', revs.every((value, i) => i === 0 || value > revs[i - 1]));

  // Someone edits the data file directly (text editor, restored backup, Apache writing).
  const file = join(data, 'tournament_data.json');
  const edited = JSON.parse(readFileSync(file, 'utf8'));
  edited.tournament.name = 'Edited on disk';
  edited.rev += 1;
  await sleep(1100); // let the mtime tick over on coarse filesystems
  writeFileSync(file, JSON.stringify(edited));
  const external = await overlay.next((m) => m.type === 'state' && m.state.tournament.name === 'Edited on disk', 5000);
  check('a change made directly to the data file is pushed too', !!external);

  // protocol edge cases over a raw socket
  const cross = await raw(handshake('Origin: http://evil.example\r\n'));
  check('cross-origin WebSocket is refused', /^HTTP\/1\.1 403/.test(cross.toString()));
  const same = await raw(handshake(`Origin: http://127.0.0.1:${port}\r\n`));
  const expectedAccept = createHash('sha1').update('dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  check('same-origin handshake returns the correct accept key', same.toString().includes('101 Switching Protocols') && same.toString().includes(expectedAccept));
  const noUpgrade = await fetch(BASE + 'ws');
  check('plain GET /ws explains itself (426)', noUpgrade.status === 426);

  const fragmented = await raw(Buffer.concat([Buffer.from(handshake()), maskedFrame(0x1, '{"type":', false), maskedFrame(0x0, '"ping"}', true)]));
  check('fragmented messages are reassembled', fragmented.toString('latin1').includes('{"type":"pong"}'));
  const pinged = await raw(Buffer.concat([Buffer.from(handshake()), maskedFrame(0x9, 'hi')]));
  check('protocol ping gets a pong frame', pinged.includes(Buffer.from([0x8a, 0x02, 0x68, 0x69])));
  const unmasked = await raw(Buffer.concat([Buffer.from(handshake()), Buffer.from([0x81, 0x02, 0x68, 0x69])]));
  check('unmasked client frames close with 1002', unmasked.includes(Buffer.from([0x88, 0x02, 0x03, 0xea])));
  const closing = await raw(Buffer.concat([Buffer.from(handshake()), maskedFrame(0x8, '')]));
  check('close frame is answered with a close frame', closing.includes(Buffer.from([0x88, 0x02, 0x03, 0xe8])));

  overlay.ws.close();
  const gone = await panel.next((m) => m.type === 'presence' && m.overlays === 0);
  check('presence updates when an overlay disconnects', !!gone);

  // -------------------------------------------------------------- uploads
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const upload = await (await fetch(BASE + 'api/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).json();
  const image = await fetch(BASE + upload.url);
  const bytes = Buffer.from(await image.arrayBuffer());
  check('uploaded image is served back byte-for-byte, cached forever', image.status === 200 && bytes.equals(png) && image.headers.get('cache-control').includes('immutable'));

  const exported = await fetch(BASE + 'api/export');
  check('export downloads as a JSON attachment', exported.headers.get('content-disposition').includes('attachment') && (await exported.json()).teams.length === 41);

  const command = await fetch(BASE + 'api/cmd/toggle');
  check('GET /api/cmd/toggle works for Stream Deck style callers', command.status === 200 && (await command.json()).overlay.visible === true);
  const csrf = await fetch(BASE + 'api/cmd/toggle', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  check('...but not when a browser says another website sent it', csrf.status === 403);

  // Double-clicking the launcher twice must not leave two servers on one port
  // (Windows would happily let the second one bind).
  const second = spawn(php, ['server.php', `--port=${port}`], { cwd: root, env: { ...process.env, SCOREBOARD_DATA: data } });
  let secondOutput = '';
  second.stdout.on('data', (chunk) => (secondOutput += chunk));
  const secondExit = await Promise.race([new Promise((resolve) => second.on('exit', resolve)), sleep(8000).then(() => 'still running')]);
  if (secondExit === 'still running') second.kill();
  check('a second instance on the same port steps aside', secondExit === 0 && secondOutput.includes('already running'), `exit ${secondExit}: ${secondOutput.trim()}`);

  check('server is still healthy after all of that', (await fetch(BASE + 'api/info')).status === 200 && server.exitCode === null);
  panel.ws.close();
} catch (err) {
  check('test run completed', false, String(err && err.stack ? err.stack : err) + '\n' + serverOutput);
} finally {
  server.kill();
  await sleep(300);
  try {
    rmSync(data, { recursive: true, force: true });
  } catch {
    /* Windows may still hold the folder for a moment */
  }
}

console.log('\n' + (failures ? `${failures} check(s) failed` : 'all checks passed'));
process.exit(failures ? 1 : 0);
