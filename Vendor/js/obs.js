/*
 * PUBG Scoreboard — OBS Studio remote (obs-websocket 5.x, built into OBS 28+).
 *
 * The control panel talks to OBS directly from the browser:
 *   OBS → Tools → WebSocket Server Settings → Enable WebSocket server
 *
 *   var obs = SB.createOBS();
 *   obs.on('status', fn)   {state: 'off'|'connecting'|'on', error}
 *   obs.on('event', fn)    (eventType, eventData)
 *   obs.connect({host, port, password})
 *   obs.request('GetSceneList').then(...)
 */
(function (root) {
  'use strict';

  var SB = root.SB || (root.SB = {});

  // ------------------------------------------------------------ SHA-256
  // crypto.subtle is unavailable on plain-http LAN addresses (a phone opening
  // http://192.168.x.x), which is exactly where the remote is used — so the
  // hash is implemented here.

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var escaped = unescape(encodeURIComponent(text));
    var out = new Uint8Array(escaped.length);
    for (var i = 0; i < escaped.length; i++) out[i] = escaped.charCodeAt(i);
    return out;
  }

  /** @returns Uint8Array(32) */
  function sha256(text) {
    var msg = utf8(text);
    var bits = msg.length * 8;
    var padded = new Uint8Array((((msg.length + 9 + 63) >> 6) << 6));
    padded.set(msg);
    padded[msg.length] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
    view.setUint32(padded.length - 4, bits >>> 0);

    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    for (var offset = 0; offset < padded.length; offset += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15];
        var y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (k + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        k = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + k) >>> 0;
    }
    var out = new Uint8Array(32);
    var outView = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) outView.setUint32(j * 4, h[j]);
    return out;
  }

  function base64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  }

  /** obs-websocket auth: base64(sha256(base64(sha256(password + salt)) + challenge)) */
  function authString(password, salt, challenge) {
    return base64(sha256(base64(sha256(password + salt)) + challenge));
  }

  // -------------------------------------------------------------- client

  // General | Scenes | Inputs | Outputs | SceneItems
  var SUBSCRIPTIONS = 1 | 4 | 8 | 64 | 128;

  var CLOSE_REASONS = {
    4009: 'auth', // wrong or missing password
    4010: 'version',
    4011: 'kicked'
  };

  SB.createOBS = function () {
    var obs = SB.emitter();
    var socket = null;
    var settings = null;
    var status = { state: 'off', error: null };
    var pending = {};
    var seq = 0;
    var wantConnection = false;
    var retryTimer = null;
    var identified = false;

    function setStatus(state, error) {
      status = { state: state, error: error || null };
      obs.emit('status', status);
    }

    function failPending(message) {
      Object.keys(pending).forEach(function (id) {
        pending[id].reject(new Error(message));
      });
      pending = {};
    }

    function open() {
      clearTimeout(retryTimer);
      var host = settings.host || 'localhost';
      if (host.indexOf(':') >= 0 && host.charAt(0) !== '[') host = '[' + host + ']'; // bare IPv6
      var ws;
      try {
        ws = new WebSocket('ws://' + host + ':' + (settings.port || 4455));
      } catch (err) {
        wantConnection = false;
        setStatus('off', root.location && root.location.protocol === 'https:' ? 'https' : 'unreachable');
        return;
      }
      socket = ws;
      identified = false;
      if (status.state !== 'on') setStatus('connecting');

      ws.onmessage = function (event) {
        var msg;
        try {
          msg = JSON.parse(event.data);
        } catch (err) {
          return;
        }
        var d = msg.d || {};
        if (msg.op === 0) {
          // Hello
          var identify = { rpcVersion: 1, eventSubscriptions: SUBSCRIPTIONS };
          if (d.authentication) {
            identify.authentication = authString(settings.password || '', d.authentication.salt, d.authentication.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: identify }));
        } else if (msg.op === 2) {
          // Identified
          identified = true;
          setStatus('on');
        } else if (msg.op === 5) {
          obs.emit('event', d.eventType, d.eventData || {});
        } else if (msg.op === 7) {
          var waiter = pending[d.requestId];
          if (!waiter) return;
          delete pending[d.requestId];
          var result = d.requestStatus || {};
          if (result.result) {
            waiter.resolve(d.responseData || {});
          } else {
            var error = new Error(result.comment || d.requestType + ' failed (' + result.code + ')');
            error.code = result.code;
            waiter.reject(error);
          }
        }
      };

      ws.onclose = function (event) {
        if (socket !== ws) return;
        socket = null;
        failPending('OBS connection closed');
        var reason = CLOSE_REASONS[event.code];
        if (reason === 'auth' || reason === 'version') {
          wantConnection = false; // retrying cannot fix these
          setStatus('off', reason);
          return;
        }
        if (!wantConnection) {
          setStatus('off');
          return;
        }
        // Dropped (OBS closed, network blip) or never reachable: keep trying quietly.
        setStatus('connecting', identified ? 'lost' : 'unreachable');
        retryTimer = setTimeout(open, 3000);
      };
      ws.onerror = function () {
        /* onclose follows */
      };
    }

    obs.connect = function (options) {
      settings = { host: options.host, port: options.port, password: options.password };
      wantConnection = true;
      if (socket) {
        var old = socket;
        socket = null;
        old.close();
        failPending('reconnecting');
      }
      open();
    };

    obs.disconnect = function () {
      wantConnection = false;
      clearTimeout(retryTimer);
      if (socket) socket.close();
      else setStatus('off');
    };

    obs.status = function () {
      return status;
    };

    obs.request = function (type, data) {
      if (!socket || socket.readyState !== 1 || !identified) {
        return Promise.reject(new Error('OBS is not connected'));
      }
      var id = 'sb' + ++seq;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        socket.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
        setTimeout(function () {
          if (pending[id]) {
            delete pending[id];
            reject(new Error(type + ' timed out'));
          }
        }, 8000);
      });
    };

    return obs;
  };

  SB.obsAuth = authString;
  SB.sha256 = sha256;
})(typeof window !== 'undefined' ? window : globalThis);
