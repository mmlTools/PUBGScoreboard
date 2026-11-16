/*
 * PUBG Scoreboard — shared client core (control panel + overlay).
 *
 *   SB.live      state sync: WebSocket when the standalone server runs,
 *                automatic fallback to HTTP polling (Apache / php -S / WS down)
 *   SB.action    send a state-changing action (ordered, retried on network loss)
 *   SB.rank      PUBG tie-break ordering
 *   SB.t         translations
 */
(function (root) {
  'use strict';

  var cfg = root.SCOREBOARD_CONFIG || { base: '/', version: 'dev', realtime: false };
  var SB = { config: cfg };

  // ------------------------------------------------------------------ utils

  SB.url = function (path) {
    return cfg.base + String(path).replace(/^\//, '');
  };

  /** Turn a stored image reference into something an <img> can load. */
  SB.asset = function (ref) {
    if (!ref) return '';
    return /^(https?:|data:|blob:)/i.test(ref) ? ref : SB.url(ref);
  };

  SB.esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  SB.clamp = function (n, min, max) {
    return Math.max(min, Math.min(max, n));
  };

  SB.debounce = function (fn, ms) {
    var timer = null;
    var pending = null;
    function run() {
      timer = null;
      var args = pending;
      pending = null;
      if (args) fn.apply(null, args);
    }
    function debounced() {
      pending = arguments;
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    }
    debounced.flush = function () {
      if (timer) {
        clearTimeout(timer);
        run();
      }
    };
    debounced.pending = function () {
      return timer !== null;
    };
    return debounced;
  };

  SB.emitter = function () {
    var handlers = {};
    return {
      on: function (name, fn) {
        (handlers[name] = handlers[name] || []).push(fn);
        return this;
      },
      emit: function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        (handlers[name] || []).slice().forEach(function (fn) {
          try {
            fn.apply(null, args);
          } catch (err) {
            if (root.console) console.error(err);
          }
        });
      }
    };
  };

  /** Short label for a team when there is no logo: tag, or initials of the name. */
  SB.monogram = function (team) {
    if (team.tag) return team.tag.toUpperCase();
    var words = String(team.name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  };

  // ---------------------------------------------------------------- ranking

  /**
   * Standings order used by PUBG esports: total points, then chicken dinners,
   * then placement points, then kills. Ties keep the order teams were added in.
   * Returns a new array of {team, rank}.
   */
  SB.rank = function (teams) {
    return (teams || [])
      .map(function (team, index) {
        return { team: team, index: index };
      })
      .sort(function (a, b) {
        return (
          b.team.points - a.team.points ||
          b.team.wwcd - a.team.wwcd ||
          b.team.placePoints - a.team.placePoints ||
          b.team.kills - a.team.kills ||
          a.index - b.index
        );
      })
      .map(function (entry, i) {
        return { team: entry.team, rank: i + 1 };
      });
  };

  SB.pageCount = function (teamCount, perPage) {
    return Math.max(1, Math.ceil(teamCount / Math.max(1, perPage)));
  };

  // ------------------------------------------------------------- access key

  // A remote device opens "http://<pc>:8080/?key=..." once; remember the key
  // and take it out of the address bar.
  SB.key = '';
  try {
    var params = new URLSearchParams(root.location.search);
    var urlKey = params.get('key');
    if (urlKey) {
      root.localStorage.setItem('sb.key', urlKey);
      params.delete('key');
      var clean = root.location.pathname + (params.toString() ? '?' + params : '') + root.location.hash;
      root.history.replaceState(null, '', clean);
    }
    SB.key = root.localStorage.getItem('sb.key') || '';
  } catch (err) {
    /* storage blocked: local use still works */
  }

  // ------------------------------------------------------------------- i18n

  var dictionary = null;
  var dictionaryPromise = null;

  SB.loadTranslations = function () {
    if (!dictionaryPromise) {
      dictionaryPromise = fetch(SB.url('Autoload/translations.json'), { cache: 'no-cache' })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          dictionary = data;
        })
        .catch(function () {
          dictionary = {};
        });
    }
    return dictionaryPromise;
  };

  SB.t = function (key, lang, vars) {
    var entry = dictionary && dictionary[key];
    var text = entry ? entry[lang] || entry.en || key : key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split('{' + name + '}').join(vars[name]);
      });
    }
    return text;
  };

  /** Fill every [data-i18n], [data-i18n-title] and [data-i18n-placeholder] below `node`. */
  SB.translate = function (node, lang) {
    node.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = SB.t(el.getAttribute('data-i18n'), lang);
    });
    node.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var text = SB.t(el.getAttribute('data-i18n-title'), lang);
      el.setAttribute('title', text);
      el.setAttribute('aria-label', text);
    });
    node.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', SB.t(el.getAttribute('data-i18n-placeholder'), lang));
    });
  };

  // ------------------------------------------------------------- live state

  /**
   * Events:  state(state, previous)   every time the tournament changes
   *          status({connected, transport})
   *          presence({overlays, obs, controls})   WebSocket only
   */
  SB.live = (function () {
    var live = SB.emitter();
    var state = null;
    var role = 'client';
    var socket = null;
    var socketAlive = false;
    var lastMessage = 0;
    var retry = 0;
    var pollTimer = null;
    var pollFailures = 0;
    var status = { connected: false, transport: cfg.realtime ? 'ws' : 'poll' };
    var started = false;

    function setStatus(connected, transport) {
      if (status.connected === connected && status.transport === transport) return;
      status = { connected: connected, transport: transport };
      live.emit('status', status);
    }

    /** @param force accept an older revision too (full resync) */
    function apply(next, force) {
      if (!next || typeof next.rev !== 'number') return;
      if (state && !force && next.rev <= state.rev) return;
      if (state && force && next.rev === state.rev) return;
      var previous = state;
      state = next;
      live.emit('state', state, previous);
    }

    function poll() {
      clearTimeout(pollTimer);
      if (socketAlive) return;
      var revAtStart = state ? state.rev : null;
      var rev = state ? '?rev=' + state.rev : '';
      fetch(SB.url('api/state') + rev, { cache: 'no-store' })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          pollFailures = 0;
          if (socketAlive) return;
          // An action may have landed while this request was in flight; its state is newer.
          var stale = state && state.rev !== revAtStart;
          if (data.state && !stale) apply(data.state, true);
          setStatus(true, 'poll');
        })
        .catch(function () {
          pollFailures++;
          if (!socketAlive && pollFailures > 1) setStatus(false, status.transport);
        })
        .then(function () {
          if (!socketAlive) pollTimer = setTimeout(poll, pollFailures > 1 ? 3000 : 1000);
        });
    }

    function connect() {
      if (!cfg.realtime || !root.WebSocket) return;
      var scheme = root.location.protocol === 'https:' ? 'wss://' : 'ws://';
      var url = scheme + root.location.host + SB.url('ws') + (SB.key ? '?key=' + encodeURIComponent(SB.key) : '');
      var ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        scheduleReconnect();
        return;
      }
      socket = ws;
      ws.onopen = function () {
        retry = 0;
        lastMessage = Date.now();
        ws.send(JSON.stringify({ type: 'identify', role: role, obs: !!root.obsstudio }));
      };
      ws.onmessage = function (event) {
        lastMessage = Date.now();
        var msg;
        try {
          msg = JSON.parse(event.data);
        } catch (err) {
          return;
        }
        if (msg.type === 'hello' || msg.type === 'state') {
          socketAlive = true;
          clearTimeout(pollTimer);
          apply(msg.state, true);
          setStatus(true, 'ws');
        } else if (msg.type === 'presence') {
          live.emit('presence', msg);
        }
      };
      ws.onclose = function () {
        if (socket !== ws) return;
        socket = null;
        if (socketAlive) {
          socketAlive = false;
          poll(); // keep the overlay fed while the socket is away
        }
        scheduleReconnect();
      };
      ws.onerror = function () {
        try {
          ws.close();
        } catch (err) {
          /* already closed */
        }
      };
    }

    function scheduleReconnect() {
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, Math.min(5000, 300 * Math.pow(1.7, retry)));
    }

    // Heartbeat: detects a frozen connection (sleeping laptop, pulled cable).
    if (root.document) setInterval(function () {
      if (!socket || socket.readyState !== 1) return;
      if (Date.now() - lastMessage > 45000) {
        socket.close();
        return;
      }
      socket.send('{"type":"ping"}');
    }, 15000);

    live.start = function (asRole) {
      if (started) return live;
      started = true;
      role = asRole || role;
      poll(); // first paint does not wait for the socket handshake
      connect();
      return live;
    };
    live.state = function () {
      return state;
    };
    live.status = function () {
      return status;
    };
    live.apply = apply;
    return live;
  })();

  // ---------------------------------------------------------------- actions

  /**
   * Events on SB.saving: change({pending, error})
   * Actions run strictly one after another so edits can never overtake each other.
   */
  SB.saving = SB.emitter();
  var queue = Promise.resolve();
  var pendingCount = 0;
  var lastError = null;

  function headers(extra) {
    var h = extra || {};
    if (SB.key) h['X-Scoreboard-Key'] = SB.key;
    return h;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** fetch + JSON with retries on network failure (never on a server "no"). */
  function request(path, options, attempt) {
    attempt = attempt || 0;
    return fetch(SB.url(path), options).then(
      function (res) {
        return res
          .json()
          .catch(function () {
            return { ok: false, error: 'Unexpected response (' + res.status + ').' };
          })
          .then(function (data) {
            if (!res.ok || !data.ok) {
              var err = new Error(data.error || 'Request failed (' + res.status + ').');
              err.status = res.status;
              throw err;
            }
            return data;
          });
      },
      function () {
        if (attempt >= 5) {
          var err = new Error('offline');
          err.offline = true;
          throw err;
        }
        lastError = 'offline';
        SB.saving.emit('change', { pending: pendingCount, error: lastError });
        return wait(400 * (attempt + 1)).then(function () {
          return request(path, options, attempt + 1);
        });
      }
    );
  }

  function enqueue(job) {
    pendingCount++;
    SB.saving.emit('change', { pending: pendingCount, error: lastError });
    var run = queue.then(job);
    queue = run.then(
      function () {
        pendingCount--;
        lastError = null;
        SB.saving.emit('change', { pending: pendingCount, error: null });
      },
      function (err) {
        pendingCount--;
        lastError = err.offline ? 'offline' : err.message;
        SB.saving.emit('change', { pending: pendingCount, error: lastError });
      }
    );
    return run;
  }

  /** Resolves with {state, result}; rejects with an Error carrying the server message. */
  SB.action = function (name, payload) {
    return enqueue(function () {
      return request('api/action', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: name, payload: payload || {} })
      }).then(function (data) {
        SB.live.apply(data.state, false);
        return data;
      });
    });
  };

  /** Upload an image Blob; resolves with the stored reference. */
  SB.upload = function (blob) {
    return enqueue(function () {
      return request('api/upload', {
        method: 'POST',
        headers: headers({ 'Content-Type': blob.type || 'application/octet-stream' }),
        body: blob
      }).then(function (data) {
        return data.url;
      });
    });
  };

  SB.info = function () {
    return fetch(SB.url('api/info'), { cache: 'no-store', headers: headers() }).then(function (res) {
      return res.json();
    });
  };

  root.SB = SB;
  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
