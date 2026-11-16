/*
 * PUBG Scoreboard — control panel.
 *
 * Every edit is sent to the server as a small action and comes back as a new
 * state (see core.js), so several panels — the PC and a phone, say — can work
 * on the same tournament at once. render() never overwrites a field the user
 * is typing in.
 */
(function () {
  'use strict';

  var SB = window.SB;
  var OBS_SOURCE = 'PUBG Scoreboard';
  var COMPACT_ROWS = 16;
  var PRESETS = {
    super: [10, 6, 5, 4, 3, 2, 1, 1],
    classic: [15, 12, 10, 8, 6, 4, 2, 1, 1, 1, 1, 1]
  };

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function h(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* private mode */
    }
    return null;
  }

  var state = null;
  var lang = store('sb.lang');
  var info = null;
  var focusTeam = null;

  function t(key, vars) {
    return SB.t(key, lang || 'en', vars);
  }

  // ------------------------------------------------------------- feedback

  function toast(message, options) {
    options = options || {};
    var el = h('div', 'toast ' + (options.type || 'info'));
    el.appendChild(h('span', 'toast-msg', message));
    var close = function () {
      if (el._closed) return;
      el._closed = true;
      el.classList.add('out');
      setTimeout(function () {
        el.remove();
      }, 300);
    };
    if (options.actions) {
      var box = h('span', 'toast-actions');
      options.actions.forEach(function (action) {
        var btn = h('button', 'btn sm', action.label);
        btn.type = 'button';
        btn.addEventListener('click', function () {
          close();
          action.run();
        });
        box.appendChild(btn);
      });
      el.appendChild(box);
    }
    var ms = options.timeout || (options.actions ? 9000 : 4500);
    var bar = h('i', 'toast-bar');
    bar.style.animationDuration = ms + 'ms';
    el.appendChild(bar);
    $('#toasts').appendChild(el);
    setTimeout(close, ms);
    return close;
  }

  /** Run an action; failures surface as a toast. Resolves with the response or null. */
  function act(name, payload) {
    return SB.action(name, payload).catch(function (err) {
      if (err.status === 401) {
        $('#auth-banner').hidden = false;
      }
      toast(err.offline ? t('error_offline') : err.message, { type: 'error' });
      return null;
    });
  }

  function undo() {
    return act('state.undo').then(function (res) {
      if (res) toast(t('undone'), { type: 'success' });
    });
  }

  function undoable(label) {
    toast(t('did_' + label.replace('.', '_')), {
      type: 'success',
      actions: [{ label: t('undo'), run: undo }]
    });
  }

  function confirmDialog(title, text, okLabel) {
    var dialog = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel || t('confirm');
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function done() {
        dialog.removeEventListener('close', done);
        resolve(dialog.returnValue === 'ok');
      });
    });
  }

  function copyText(text) {
    var done = function () {
      toast(t('copied'), { type: 'success', timeout: 1800 });
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () {});
      return;
    }
    // http:// on a LAN address is not a "secure context": fall back to a selection copy.
    var area = h('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } catch (err) {
      /* nothing else to try */
    }
    area.remove();
  }

  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-copy]');
    if (!btn) return;
    var source = btn.getAttribute('data-copy');
    copyText(source.charAt(0) === '#' ? $(source).value : source);
  });

  // ------------------------------------------------------- bound settings

  // <input data-bind="theme.accent"> edits state.theme.accent via "theme.update".
  var bound = $$('[data-bind]').map(function (el) {
    var path = el.getAttribute('data-bind').split('.');
    var field = { el: el, section: path[0], key: path[1], busy: 0 };

    function read() {
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'number') {
        var n = parseInt(el.value, 10);
        return isNaN(n) ? null : n;
      }
      return el.value;
    }
    function commit() {
      var value = read();
      if (value === null) return;
      var patch = {};
      patch[field.key] = value;
      field.busy++;
      act(field.section + '.update', patch).then(function () {
        field.busy--;
      });
    }
    var later = SB.debounce(commit, 300);
    field.flush = later.flush;
    field.pending = later.pending;

    var instant = el.type === 'checkbox' || el.tagName === 'SELECT';
    el.addEventListener(instant ? 'change' : 'input', instant ? commit : later);
    if (!instant) {
      el.addEventListener('change', later.flush);
      el.addEventListener('blur', function () {
        later.flush();
        setTimeout(renderBound, 0);
      });
    }
    return field;
  });

  function renderBound() {
    if (!state) return;
    bound.forEach(function (field) {
      var el = field.el;
      if (field.busy > 0 || field.pending()) return;
      var value = state[field.section][field.key];
      if (el.type === 'checkbox') {
        el.checked = !!value;
      } else if (document.activeElement !== el && el.value !== String(value)) {
        el.value = value;
      }
    });
  }

  // ----------------------------------------------------------------- teams

  var tbody = $('#teams');
  var rows = new Map();
  var NUMERIC = ['matches', 'wwcd', 'placePoints', 'kills', 'points'];
  var FIELDS = ['name', 'tag'].concat(NUMERIC);

  function buildRow(team) {
    var row = { id: team.id, tr: h('tr', 'enter'), inputs: {}, busy: {}, patch: null, timer: null, rank: 0 };
    row.tr.setAttribute('data-id', team.id);

    var rankCell = h('td', 't-rank');
    row.badge = h('span', 'rank-badge');
    rankCell.appendChild(row.badge);

    var logoCell = h('td', 't-logo');
    row.logo = h('button', 'logo-btn');
    row.logo.type = 'button';
    row.logo.setAttribute('data-act', 'logo');
    logoCell.appendChild(row.logo);

    function cell(field, className, attrs) {
      var td = h('td', NUMERIC.indexOf(field) >= 0 ? 't-num' : field === 'tag' ? 't-tag' : 't-name');
      var input = h('input', 'cell ' + className);
      input.setAttribute('data-field', field);
      input.setAttribute('aria-label', field);
      input.autocomplete = 'off';
      Object.keys(attrs).forEach(function (name) {
        input.setAttribute(name, attrs[name]);
      });
      row.inputs[field] = input;
      row.busy[field] = 0;
      td.appendChild(input);
      return td;
    }

    var actions = h('td', 't-act');
    row.winner = h('button', 'row-btn');
    row.winner.type = 'button';
    row.winner.setAttribute('data-act', 'winner');
    row.winner.appendChild(icon('trophy'));
    var del = h('button', 'row-btn del');
    del.type = 'button';
    del.setAttribute('data-act', 'remove');
    del.appendChild(icon('trash'));
    actions.appendChild(row.winner);
    actions.appendChild(del);
    row.del = del;

    [
      rankCell,
      logoCell,
      cell('name', 'name', { type: 'text', maxlength: 40 }),
      cell('tag', 'tag', { type: 'text', maxlength: 6 }),
      cell('matches', 'num', { type: 'number', min: 0, inputmode: 'numeric' }),
      cell('wwcd', 'num', { type: 'number', min: 0, inputmode: 'numeric' }),
      cell('placePoints', 'num', { type: 'number', inputmode: 'numeric' }),
      cell('kills', 'num', { type: 'number', min: 0, inputmode: 'numeric' }),
      cell('points', 'num total', { type: 'number', inputmode: 'numeric' }),
      actions
    ].forEach(function (td) {
      row.tr.appendChild(td);
    });
    return row;
  }

  function renderLogo(row, team) {
    var key = team.logo || 'mono:' + SB.monogram(team);
    if (row.logoKey === key) return;
    row.logoKey = key;
    row.logo.textContent = '';
    row.logo.classList.toggle('has-image', !!team.logo);
    if (team.logo) {
      var img = h('img');
      img.alt = '';
      img.src = SB.asset(team.logo);
      row.logo.appendChild(img);
    } else {
      row.logo.textContent = SB.monogram(team);
    }
  }

  function renderTeams() {
    var teams = state.teams;
    var ranks = {};
    SB.rank(teams).forEach(function (entry) {
      ranks[entry.team.id] = entry.rank;
    });
    var seen = {};
    var auto = state.scoring.autoTotal;
    var onAirWinner = state.overlay.visible && state.overlay.view === 'winner' ? winnerId() : null;

    teams.forEach(function (team, index) {
      seen[team.id] = true;
      var row = rows.get(team.id);
      if (!row) {
        row = buildRow(team);
        rows.set(team.id, row);
      }
      // keep DOM order identical to state order
      if (tbody.children[index] !== row.tr) tbody.insertBefore(row.tr, tbody.children[index] || null);

      var rank = ranks[team.id];
      row.tr.setAttribute('data-rank', rank);
      if (row.rank !== rank) {
        row.badge.textContent = rank;
        if (row.rank) {
          row.badge.classList.remove('changed');
          void row.badge.offsetWidth;
          row.badge.classList.add('changed');
        }
        row.rank = rank;
      }
      renderLogo(row, team);
      row.logo.title = team.logo ? t('logo_change_hint') : t('choose_image');
      row.winner.title = t('show_winner');
      row.winner.classList.toggle('on', onAirWinner === team.id);
      row.del.title = t('remove_team');
      row.inputs.name.placeholder = t('team_name_placeholder');
      row.inputs.tag.placeholder = t('tag');

      FIELDS.forEach(function (field) {
        var input = row.inputs[field];
        if (row.busy[field] > 0 || (row.patch && field in row.patch)) return;
        var value = String(team[field]);
        // a focused field belongs to the user — except the auto-calculated total
        if (document.activeElement === input && !(field === 'points' && auto)) return;
        if (input.value !== value) {
          var numeric = NUMERIC.indexOf(field) >= 0;
          if (numeric && input.value !== '' && document.activeElement !== input) {
            input.classList.remove('flash');
            void input.offsetWidth;
            input.classList.add('flash');
          }
          input.value = value;
        }
      });
      row.inputs.points.readOnly = auto;
      row.inputs.points.tabIndex = auto ? -1 : 0;

      if (focusTeam === team.id) {
        focusTeam = null;
        row.inputs.name.focus();
        row.tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    rows.forEach(function (row, id) {
      if (seen[id]) return;
      rows.delete(id);
      clearTimeout(row.timer);
      row.tr.classList.add('leave');
      setTimeout(function () {
        row.tr.remove();
      }, 280);
    });

    $('#team-count').textContent = teams.length;
    $('#teams-wrap').hidden = teams.length === 0;
    $('#teams-hint').hidden = teams.length === 0;
    $('#teams-empty').hidden = teams.length !== 0;
    $('#btn-match').disabled = teams.length === 0;
    $('#btn-reset-scores').disabled = teams.length === 0;
  }

  function flushTeam(row) {
    clearTimeout(row.timer);
    var patch = row.patch;
    if (!patch) return;
    row.patch = null;
    var fields = Object.keys(patch);
    fields.forEach(function (field) {
      row.busy[field]++;
    });
    act('team.update', { id: row.id, patch: patch }).then(function () {
      fields.forEach(function (field) {
        row.busy[field]--;
      });
      if (state) renderTeams();
    });
  }

  tbody.addEventListener('input', function (event) {
    var input = event.target;
    var field = input.getAttribute('data-field');
    var tr = input.closest('tr');
    var row = tr && rows.get(tr.getAttribute('data-id'));
    if (!row || !field) return;

    var value = input.value;
    if (NUMERIC.indexOf(field) >= 0) {
      value = parseInt(value, 10);
      if (isNaN(value)) return; // mid-edit ("" or "-"): wait for a number
    } else if (field === 'tag') {
      value = value.toUpperCase();
    }
    row.patch = row.patch || {};
    row.patch[field] = value;

    // Show the new total right away instead of waiting for the round trip.
    if (state.scoring.autoTotal && (field === 'kills' || field === 'placePoints')) {
      var kills = parseInt(row.inputs.kills.value, 10) || 0;
      var place = parseInt(row.inputs.placePoints.value, 10) || 0;
      row.inputs.points.value = place + kills * state.scoring.killPoints;
    }
    clearTimeout(row.timer);
    row.timer = setTimeout(function () {
      flushTeam(row);
    }, 350);
  });

  tbody.addEventListener('focusout', function (event) {
    var tr = event.target.closest('tr');
    var row = tr && rows.get(tr.getAttribute('data-id'));
    if (!row) return;
    flushTeam(row);
    var input = event.target;
    if (input.type === 'number' && input.value === '') input.value = 0;
    setTimeout(function () {
      if (state) renderTeams();
    }, 0);
  });

  tbody.addEventListener('focusin', function (event) {
    if (event.target.type === 'number') event.target.select();
  });

  /** Enter moves down the column like a spreadsheet (Shift+Enter moves up). */
  function columnNavigation(container) {
    container.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || !event.target.getAttribute('data-field')) return;
      event.preventDefault();
      var tr = event.target.closest('tr');
      var next = event.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
      var target = next && next.querySelector('[data-field="' + event.target.getAttribute('data-field') + '"]');
      if (target) target.focus();
      else event.target.blur();
    });
  }
  columnNavigation(tbody);

  tbody.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-act]');
    if (!btn) return;
    var id = btn.closest('tr').getAttribute('data-id');
    var kind = btn.getAttribute('data-act');
    if (kind === 'remove') {
      act('team.remove', { id: id }).then(function (res) {
        if (res) undoable('team.remove');
      });
    } else if (kind === 'winner') {
      act('overlay.winner', { id: id });
    } else if (kind === 'logo') {
      var team = teamById(id);
      if (team && team.logo && event.altKey) {
        act('team.update', { id: id, patch: { logo: '' } });
        return;
      }
      chooseImage(256, false, btn).then(function (url) {
        if (url) act('team.update', { id: id, patch: { logo: url } });
      });
    }
  });

  function teamById(id) {
    for (var i = 0; i < state.teams.length; i++) {
      if (state.teams[i].id === id) return state.teams[i];
    }
    return null;
  }

  function addTeam() {
    act('team.add', {}).then(function (res) {
      if (!res) return;
      focusTeam = res.result.id;
      renderTeams();
    });
  }
  $('#btn-add').addEventListener('click', addTeam);
  $('#btn-add-empty').addEventListener('click', addTeam);

  // ---------------------------------------------------------------- images

  /** Ask for an image, shrink it in the browser, upload it. Resolves with the stored reference or null. */
  function chooseImage(maxSize, asJpeg, busyEl) {
    var input = $('#file-image');
    input.value = '';
    return new Promise(function (resolve) {
      input.onchange = function () {
        var file = input.files && input.files[0];
        if (!file) return resolve(null);
        if (busyEl) busyEl.classList.add('busy');
        prepareImage(file, maxSize, asJpeg)
          .then(function (blob) {
            return SB.upload(blob);
          })
          .then(resolve, function (err) {
            toast(err.offline ? t('error_offline') : err.message || t('error_image'), { type: 'error' });
            resolve(null);
          })
          .then(function () {
            if (busyEl) busyEl.classList.remove('busy');
          });
      };
      input.click();
    });
  }

  function prepareImage(file, maxSize, asJpeg) {
    if (file.type === 'image/gif' || !window.createImageBitmap) return Promise.resolve(file); // keep animations
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 300000) return file;
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error(t('error_image')));
        }, asJpeg ? 'image/jpeg' : 'image/png', 0.88);
      });
    }, function () {
      throw new Error(t('error_image'));
    });
  }

  // Tournament logo + wallpaper pickers in the Design tab.
  var pickers = $$('.image-pick').map(function (box) {
    var path = box.getAttribute('data-image').split('.');
    var thumb = $('.thumb', box);
    var clear = $('.clear', box);
    function save(value) {
      var patch = {};
      patch[path[1]] = value;
      if (path[1] === 'wallpaper') patch.background = value ? 'wallpaper' : 'transparent';
      act(path[0] + '.update', patch);
    }
    thumb.addEventListener('click', function () {
      chooseImage(parseInt(box.getAttribute('data-max'), 10), box.hasAttribute('data-jpeg'), thumb).then(function (url) {
        if (url) save(url);
      });
    });
    clear.addEventListener('click', function () {
      save('');
    });
    return function () {
      var value = state[path[0]][path[1]];
      thumb.classList.toggle('has-image', !!value);
      thumb.style.backgroundImage = value ? 'url("' + SB.asset(value) + '")' : '';
      clear.hidden = !value;
    };
  });

  // --------------------------------------------------------------- on air

  function winnerId() {
    var o = state.overlay;
    if (o.winnerId && teamById(o.winnerId)) return o.winnerId;
    var ranked = SB.rank(state.teams);
    return ranked.length ? ranked[0].team.id : null;
  }

  function renderLive() {
    var o = state.overlay;
    var onair = $('#btn-onair');
    onair.setAttribute('aria-pressed', o.visible ? 'true' : 'false');
    $('#onair-text').textContent = t(o.visible ? 'on_air' : 'off_air');
    $('#onair-hint').textContent = t(o.visible ? 'click_to_hide' : 'click_to_show');
    $('#preview').classList.toggle('off', !o.visible);
    $('#preview-tag').textContent = t('preview');

    $$('#views button').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-view') === o.view);
    });

    var paged = o.view === 'leaderboard' || o.view === 'compact';
    var perPage = o.view === 'compact' ? COMPACT_ROWS : state.theme.teamsPerPage;
    var pages = SB.pageCount(state.teams.length, perPage);
    $('#page-num').textContent = !paged ? '–' : o.autoRotate && pages > 1 ? 'AUTO' : Math.min(o.page, pages - 1) + 1 + ' / ' + pages;
    $('#btn-prev').disabled = $('#btn-next').disabled = !paged || pages < 2;
    $('#f-rotate').checked = o.autoRotate;
    var seconds = $('#f-rotate-sec');
    if (document.activeElement !== seconds) seconds.value = o.rotateSeconds;

    var winnerRow = $('#winner-row');
    winnerRow.hidden = o.view !== 'winner';
    var select = $('#f-winner');
    var signature = (lang || 'en') + '|' + state.teams.map(function (team) {
      return team.id + team.name;
    }).join('|');
    if (select._signature !== signature) {
      select._signature = signature;
      select.textContent = '';
      var first = h('option', null, t('winner_auto'));
      first.value = '';
      select.appendChild(first);
      SB.rank(state.teams).forEach(function (entry) {
        var option = h('option', null, '#' + entry.rank + '  ' + (entry.team.name || entry.team.tag || '—'));
        option.value = entry.team.id;
        select.appendChild(option);
      });
    }
    select.value = o.winnerId;
  }

  $('#btn-onair').addEventListener('click', function () {
    act('overlay.toggle');
  });
  $('#views').addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-view]');
    if (btn) act('overlay.update', { view: btn.getAttribute('data-view'), page: 0 });
  });
  $('#btn-prev').addEventListener('click', function () {
    act('overlay.prev');
  });
  $('#btn-next').addEventListener('click', function () {
    act('overlay.next');
  });
  $('#btn-replay').addEventListener('click', function () {
    act('overlay.replay');
  });
  $('#f-rotate').addEventListener('change', function () {
    act('overlay.update', { autoRotate: this.checked });
  });
  $('#f-rotate-sec').addEventListener('change', function () {
    var n = parseInt(this.value, 10);
    if (!isNaN(n)) act('overlay.update', { rotateSeconds: n });
  });
  $('#f-winner').addEventListener('change', function () {
    act('overlay.update', { winnerId: this.value });
  });

  // --------------------------------------------------------------- scoring

  function sameList(a, b) {
    return a.length === b.length && a.every(function (value, i) {
      return value === b[i];
    });
  }

  function renderScoring() {
    var placement = state.scoring.placement;
    var input = $('#f-placement');
    if (document.activeElement !== input) input.value = placement.join(', ');
    var preset = 'custom';
    Object.keys(PRESETS).forEach(function (name) {
      if (sameList(PRESETS[name], placement)) preset = name;
    });
    $('#f-preset').value = preset;
  }

  $('#f-preset').addEventListener('change', function () {
    if (PRESETS[this.value]) act('scoring.update', { placement: PRESETS[this.value] });
    else $('#f-placement').focus();
  });
  $('#f-placement').addEventListener('change', function () {
    var list = (this.value.match(/\d+/g) || []).map(Number);
    if (list.length) act('scoring.update', { placement: list });
    else renderScoring();
  });

  // ---------------------------------------------------------- record match

  var matchDialog = $('#match');
  var matchRows = [];

  function openMatch() {
    var body = $('#match-rows');
    body.textContent = '';
    matchRows = SB.rank(state.teams).map(function (entry) {
      var tr = h('tr');
      tr.appendChild(h('td', null, entry.team.name || entry.team.tag || '—'));
      function numberCell(field) {
        var td = h('td', 't-num');
        var input = h('input', 'cell num');
        input.type = 'number';
        input.min = field === 'place' ? 1 : 0;
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('data-field', field);
        input.placeholder = field === 'place' ? '–' : '0';
        td.appendChild(input);
        tr.appendChild(td);
        return input;
      }
      var row = { id: entry.team.id, place: numberCell('place'), kills: numberCell('kills') };
      var earnedCell = h('td', 't-num');
      row.earned = h('span', 'earned zero', '0');
      earnedCell.appendChild(row.earned);
      tr.appendChild(earnedCell);
      body.appendChild(tr);
      return row;
    });
    $('#match-error').hidden = true;
    matchDialog.showModal();
    if (matchRows[0]) matchRows[0].place.focus();
  }

  /** @returns {results, error} */
  function readMatch() {
    var used = {};
    var duplicate = false;
    var results = [];
    var killsOnly = false;
    matchRows.forEach(function (row) {
      var place = parseInt(row.place.value, 10) || 0;
      var kills = Math.max(0, parseInt(row.kills.value, 10) || 0);
      var placePoints = place > 0 ? state.scoring.placement[place - 1] || 0 : 0;
      var earned = place > 0 ? placePoints + kills * state.scoring.killPoints : 0;
      row.earned.textContent = '+' + earned;
      row.earned.classList.toggle('zero', earned === 0);
      var clash = place > 0 && used[place];
      if (place > 0) {
        if (clash) {
          duplicate = true;
          used[place].place.classList.add('dup');
        }
        used[place] = used[place] || row;
        results.push({ id: row.id, place: place, kills: kills });
      } else if (kills > 0) {
        killsOnly = true;
      }
      row.place.classList.toggle('dup', !!clash);
    });
    var error = null;
    if (duplicate) error = t('match_error_duplicate');
    else if (killsOnly) error = t('match_error_no_place');
    else if (!results.length) error = t('match_error_empty');
    return { results: results, error: error };
  }

  $('#match-rows').addEventListener('input', function () {
    matchRows.forEach(function (row) {
      row.place.classList.remove('dup');
    });
    var read = readMatch();
    var box = $('#match-error');
    // don't nag about an empty form while it is being filled in
    box.hidden = !read.error || read.error === t('match_error_empty');
    box.textContent = read.error || '';
  });
  columnNavigation($('#match-rows'));
  $('#match-rows').addEventListener('focusin', function (event) {
    if (event.target.select) event.target.select();
  });

  $('#match-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (event.submitter && event.submitter.value === 'cancel') {
      matchDialog.close();
      return;
    }
    var read = readMatch();
    if (read.error) {
      var box = $('#match-error');
      box.hidden = false;
      box.textContent = read.error;
      return;
    }
    $('#match-save').disabled = true;
    act('match.record', { results: read.results, advance: $('#match-advance').checked }).then(function (res) {
      $('#match-save').disabled = false;
      if (!res) return;
      matchDialog.close();
      var actions = [{ label: t('undo'), run: undo }];
      var winner = res.result.winnerId;
      if (winner) {
        actions.unshift({
          label: t('show_winner'),
          run: function () {
            act('overlay.winner', { id: winner });
          }
        });
      }
      toast(t('did_match_record'), { type: 'success', actions: actions, timeout: 12000 });
    });
  });
  $('#btn-match').addEventListener('click', openMatch);

  // ------------------------------------------- undo / reset / import / demo

  $('#btn-undo').addEventListener('click', undo);

  $('#btn-reset-scores').addEventListener('click', function () {
    confirmDialog(t('reset_scores'), t('confirm_reset_scores'), t('reset_scores')).then(function (yes) {
      if (!yes) return;
      act('scores.reset').then(function (res) {
        if (res) undoable('scores.reset');
      });
    });
  });

  $('#btn-reset-all').addEventListener('click', function () {
    confirmDialog(t('reset_tournament'), t('confirm_reset_tournament'), t('reset_tournament')).then(function (yes) {
      if (!yes) return;
      act('tournament.reset').then(function (res) {
        if (res) undoable('tournament.reset');
      });
    });
  });

  function importData(data) {
    return act('state.import', { data: data }).then(function (res) {
      if (res) undoable('state.import');
    });
  }

  $('#btn-import').addEventListener('click', function () {
    var input = $('#file-import');
    input.value = '';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try {
          data = JSON.parse(String(reader.result));
        } catch (err) {
          toast(t('error_import'), { type: 'error' });
          return;
        }
        var name = (data && ((data.tournament && data.tournament.name) || data.competition_name)) || '—';
        var count = data && Array.isArray(data.teams) ? data.teams.length : 0;
        confirmDialog(t('import'), t('confirm_import', { name: name, count: count }), t('import')).then(function (yes) {
          if (yes) importData(data);
        });
      };
      reader.readAsText(file);
    };
    input.click();
  });

  $('#btn-demo').addEventListener('click', function () {
    var names = [
      ['Night Owls', 'OWL'], ['Red Zone Rangers', 'RZR'], ['Pochinki Kings', 'PK'], ['Blue Circle', 'BLUE'],
      ['Frying Pan Gang', 'PAN'], ['Loot Goblins', 'LOOT'], ['Third Party', '3RD'], ['Chicken Chasers', 'CC'],
      ['Flare Gun Mafia', 'FGM'], ['Bridge Campers', 'CAMP'], ['Ghillie Squad', 'GS'], ['Level 3 Helmets', 'LV3'],
      ['Hot Drop Heroes', 'HDH'], ['Final Zone', 'FZ'], ['Care Package', 'CP'], ['Sosnovka Wolves', 'SW']
    ];
    var place = [31, 26, 22, 21, 17, 15, 14, 11, 10, 8, 7, 5, 4, 3, 2, 0];
    var kills = [27, 31, 19, 14, 22, 12, 9, 16, 8, 11, 6, 9, 5, 7, 3, 4];
    var wwcd = [2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    importData({
      version: 2,
      tournament: { name: 'Winter Clash Invitational', map: 'Erangel', day: '1', match: '5' },
      teams: names.map(function (pair, i) {
        return { name: pair[0], tag: pair[1], matches: 4, wwcd: wwcd[i], placePoints: place[i], kills: kills[i] };
      })
    });
  });

  // ------------------------------------------------------------------- OBS

  var obs = SB.createOBS();
  var obsState = { scenes: [], current: '', itemId: null };
  var localPage = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  var obsConfig = store('sb.obs') || { host: localPage ? 'localhost' : location.hostname, port: 4455, password: '', auto: false };

  function sourceUrl() {
    return location.origin + SB.url('scoreboard');
  }

  function renderObsStatus(status) {
    var pill = $('#pill-obs');
    var on = status.state === 'on';
    var connecting = status.state === 'connecting';
    pill.setAttribute('data-state', on ? 'ok' : connecting ? 'wait' : 'off');
    $('.pill-text', pill).textContent = on ? t('obs_connected') : connecting ? t('obs_connecting') : t('obs_off');
    $('#obs-form').hidden = on;
    $('#obs-live').hidden = !on;
    var btn = $('#obs-connect');
    $('span', btn).textContent = connecting ? t('cancel') : t('obs_connect');
    btn.classList.toggle('primary', !connecting);
  }

  obs.on('status', function (status) {
    renderObsStatus(status);
    if (status.state === 'on') {
      loadObs();
    } else if (status.error === 'auth') {
      toast(t('obs_error_auth'), { type: 'error', timeout: 7000 });
      $('#obs-password').focus();
    } else if (status.error === 'https') {
      toast(t('obs_error_https'), { type: 'error', timeout: 9000 });
    } else if (status.error === 'version') {
      toast(t('obs_error_version'), { type: 'error', timeout: 9000 });
    } else if (status.error === 'lost') {
      toast(t('obs_error_lost'), { type: 'error' });
    }
  });

  function renderScenes() {
    var box = $('#obs-scenes');
    box.textContent = '';
    obsState.scenes.forEach(function (name) {
      var btn = h('button', name === obsState.current ? 'on' : '', name);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        obs.request('SetCurrentProgramScene', { sceneName: name }).catch(obsFailed);
      });
      box.appendChild(btn);
    });
  }

  function obsFailed(err) {
    toast('OBS: ' + err.message, { type: 'error' });
  }

  function setFlag(id, on) {
    $(id).setAttribute('data-on', on ? '1' : '0');
  }

  /** Is our browser source in the scene that is live right now? */
  function refreshSourceItem() {
    var scene = obsState.current;
    if (!scene) return Promise.resolve();
    return obs
      .request('GetSceneItemId', { sceneName: scene, sourceName: OBS_SOURCE })
      .then(function (res) {
        obsState.itemId = res.sceneItemId;
        return obs.request('GetSceneItemEnabled', { sceneName: scene, sceneItemId: res.sceneItemId });
      })
      .then(
        function (res) {
          if (scene !== obsState.current) return;
          $('#obs-visible-row').hidden = false;
          $('#obs-visible').checked = !!res.sceneItemEnabled;
        },
        function () {
          if (scene !== obsState.current) return;
          obsState.itemId = null;
          $('#obs-visible-row').hidden = true;
        }
      );
  }

  function loadScenes() {
    return obs.request('GetSceneList').then(function (res) {
      // OBS lists scenes bottom-up; show them like the Scenes dock does.
      obsState.scenes = (res.scenes || []).map(function (scene) {
        return scene.sceneName;
      }).reverse();
      obsState.current = res.currentProgramSceneName || '';
      renderScenes();
      return refreshSourceItem();
    });
  }

  function loadObs() {
    obs.request('GetVersion').then(function (res) {
      $('#obs-version').textContent = 'OBS ' + res.obsVersion;
    }).catch(function () {});
    obs.request('GetStreamStatus').then(function (res) {
      setFlag('#obs-streaming', res.outputActive);
    }).catch(function () {});
    obs.request('GetRecordStatus').then(function (res) {
      setFlag('#obs-recording', res.outputActive);
    }).catch(function () {});
    loadScenes().catch(obsFailed);
  }

  obs.on('event', function (type, data) {
    if (type === 'CurrentProgramSceneChanged') {
      obsState.current = data.sceneName;
      renderScenes();
      refreshSourceItem();
    } else if (type === 'SceneListChanged' || type === 'SceneNameChanged') {
      loadScenes().catch(function () {});
    } else if (type === 'StreamStateChanged') {
      setFlag('#obs-streaming', data.outputActive);
    } else if (type === 'RecordStateChanged') {
      setFlag('#obs-recording', data.outputActive);
    } else if (type === 'SceneItemEnableStateChanged') {
      if (data.sceneName === obsState.current && data.sceneItemId === obsState.itemId) {
        $('#obs-visible').checked = !!data.sceneItemEnabled;
      }
    } else if (type === 'SceneItemCreated' || type === 'SceneItemRemoved' || type === 'InputRemoved' || type === 'InputNameChanged') {
      refreshSourceItem();
    }
  });

  /** Create (or re-point) the browser source and fit it to the canvas. */
  async function addObsSource() {
    var scene = obsState.current;
    var url = sourceUrl();
    var itemId;
    try {
      var created = await obs.request('CreateInput', {
        sceneName: scene,
        inputName: OBS_SOURCE,
        inputKind: 'browser_source',
        inputSettings: { url: url, width: 1920, height: 1080, shutdown: false, restart_when_active: false, reroute_audio: false },
        sceneItemEnabled: true
      });
      itemId = created.sceneItemId;
    } catch (err) {
      if (err.code !== 601) throw err; // 601: a source with this name already exists
      await obs.request('SetInputSettings', { inputName: OBS_SOURCE, inputSettings: { url: url, width: 1920, height: 1080 }, overlay: true });
      try {
        itemId = (await obs.request('GetSceneItemId', { sceneName: scene, sourceName: OBS_SOURCE })).sceneItemId;
      } catch (missing) {
        itemId = (await obs.request('CreateSceneItem', { sceneName: scene, sourceName: OBS_SOURCE, sceneItemEnabled: true })).sceneItemId;
      }
    }
    try {
      var video = await obs.request('GetVideoSettings');
      await obs.request('SetSceneItemTransform', {
        sceneName: scene,
        sceneItemId: itemId,
        sceneItemTransform: {
          positionX: 0,
          positionY: 0,
          alignment: 5,
          boundsType: 'OBS_BOUNDS_SCALE_INNER',
          boundsAlignment: 0,
          boundsWidth: video.baseWidth,
          boundsHeight: video.baseHeight
        }
      });
    } catch (err) {
      /* the source is in place; sizing is cosmetic */
    }
    await refreshSourceItem();
  }

  $('#obs-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (obs.status().state === 'connecting') {
      obs.disconnect();
      return;
    }
    obsConfig = {
      host: $('#obs-host').value.trim() || 'localhost',
      port: parseInt($('#obs-port').value, 10) || 4455,
      password: $('#obs-password').value,
      auto: true
    };
    store('sb.obs', obsConfig);
    obs.connect(obsConfig);
  });
  $('#obs-disconnect').addEventListener('click', function () {
    obsConfig.auto = false;
    store('sb.obs', obsConfig);
    obs.disconnect();
  });
  $('#obs-add').addEventListener('click', function () {
    addObsSource().then(function () {
      toast(t('obs_source_added', { scene: obsState.current }), { type: 'success' });
    }, obsFailed);
  });
  $('#obs-refresh').addEventListener('click', function () {
    obs.request('PressInputPropertiesButton', { inputName: OBS_SOURCE, propertyName: 'refreshnocache' }).then(function () {
      toast(t('obs_source_refreshed'), { type: 'success' });
    }, function (err) {
      toast(err.code === 600 ? t('obs_source_missing') : 'OBS: ' + err.message, { type: 'error' });
    });
  });
  $('#obs-visible').addEventListener('change', function () {
    if (obsState.itemId === null) return;
    obs.request('SetSceneItemEnabled', {
      sceneName: obsState.current,
      sceneItemId: obsState.itemId,
      sceneItemEnabled: this.checked
    }).catch(obsFailed);
  });
  $('#pill-obs').addEventListener('click', function () {
    showTab('obs');
  });

  // ---------------------------------------------------------------- remote

  function urlItem(label, url) {
    var item = h('div', 'url-item');
    item.appendChild(h('b', null, label));
    item.appendChild(h('code', null, url));
    var btn = h('button', 'btn icon-only sm');
    btn.type = 'button';
    btn.title = t('copy');
    btn.setAttribute('data-copy', url);
    btn.appendChild(icon('copy'));
    item.appendChild(btn);
    return item;
  }

  function renderRemote() {
    var base = location.origin + SB.url('');
    var suffix = !localPage && SB.key ? '?key=' + encodeURIComponent(SB.key) : '';
    var list = $('#cmd-urls');
    list.textContent = '';
    ['show', 'hide', 'toggle', 'next', 'prev'].forEach(function (name) {
      list.appendChild(urlItem(t('cmd_' + name), base + 'api/cmd/' + name + suffix));
    });
    list.appendChild(urlItem(t('view_winner'), base + 'api/cmd/view/winner' + suffix));

    var links = $('#remote-links');
    var hint = $('#remote-hint');
    links.textContent = '';
    if (!info) {
      hint.textContent = '';
      return;
    }
    if (!info.local) {
      hint.textContent = t(info.authorized ? 'remote_hint_remote' : 'auth_needed');
      return;
    }
    if (!info.lan || !info.addresses || !info.addresses.length) {
      hint.textContent = t(info.lan ? 'remote_hint_no_network' : 'remote_hint_off');
      return;
    }
    info.addresses.forEach(function (ip) {
      var url = location.protocol + '//' + ip + (location.port ? ':' + location.port : '') + SB.url('') + '?key=' + info.key;
      var field = h('div', 'copy-field');
      var input = h('input', 'input mono');
      input.readOnly = true;
      input.value = url;
      var btn = h('button', 'btn icon-only');
      btn.type = 'button';
      btn.title = t('copy');
      btn.setAttribute('data-copy', url);
      btn.appendChild(icon('copy'));
      field.appendChild(input);
      field.appendChild(btn);
      links.appendChild(field);
    });
    hint.textContent = t('remote_hint_on');
  }

  // ------------------------------------------------------------------ tabs

  function showTab(name) {
    $$('.tabs button').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-tab') === name);
    });
    $$('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('on', panel.getAttribute('data-panel') === name);
    });
    store('sb.tab', name);
  }
  $('.tabs').addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-tab]');
    if (btn) showTab(btn.getAttribute('data-tab'));
  });

  // ---------------------------------------------------------- status pills

  function renderServerPill() {
    var status = SB.live.status();
    var pill = $('#pill-server');
    var text;
    var mode;
    if (!status.connected) {
      mode = state ? 'bad' : 'wait';
      text = t(state ? 'server_offline' : 'server_connecting');
    } else if (status.transport === 'ws') {
      mode = 'ok';
      text = t('server_live');
    } else if (SB.config.realtime) {
      mode = 'warn';
      text = t('server_reconnecting');
    } else {
      mode = 'ok';
      text = t('server_polling');
    }
    pill.setAttribute('data-state', mode);
    $('.pill-text', pill).textContent = text;
    pill.title = t('server_hint_' + (SB.config.realtime ? 'ws' : 'poll'));
  }
  SB.live.on('status', renderServerPill);

  var presence = null;
  function renderPresence() {
    var pill = $('#pill-overlay');
    if (!presence) return;
    pill.hidden = false;
    var inObs = presence.obs > 0;
    pill.setAttribute('data-state', presence.overlays > 0 ? 'ok' : 'off');
    $('.pill-text', pill).textContent = inObs ? t('overlay_in_obs') : presence.overlays > 0 ? t('overlay_open') : t('overlay_none');
  }
  SB.live.on('presence', function (p) {
    presence = p;
    renderPresence();
  });

  var saving = { pending: 0, error: null };
  function renderSaving() {
    var pill = $('#pill-save');
    var mode = saving.error ? 'bad' : saving.pending ? 'warn' : 'ok';
    pill.setAttribute('data-state', mode);
    $('.pill-text', pill).textContent = saving.error === 'offline' ? t('save_offline') : saving.error ? t('save_failed') : saving.pending ? t('saving') : t('saved');
  }
  SB.saving.on('change', function (s) {
    saving = s;
    renderSaving();
  });

  // -------------------------------------------------------------- language

  function renderLanguage() {
    var current = lang || 'en';
    document.documentElement.lang = current;
    SB.translate(document, current);
    $$('.lang button').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-lang') === current);
    });
    // option labels changed under the selects: restore their values
    $('#f-winner')._signature = null;
    renderObsStatus(obs.status());
    renderServerPill();
    renderPresence();
    renderSaving();
    renderRemote();
    if (state) render();
  }
  $('.lang').addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-lang]');
    if (!btn) return;
    lang = btn.getAttribute('data-lang');
    store('sb.lang', lang);
    renderLanguage();
    act('language.set', { language: lang }); // the overlay follows
  });

  // ---------------------------------------------------------------- render

  function render() {
    renderBound();
    renderTeams();
    renderLive();
    renderScoring();
    pickers.forEach(function (paint) {
      paint();
    });
    var history = state.history;
    var undoBtn = $('#btn-undo');
    undoBtn.disabled = history.length === 0;
    undoBtn.title = history.length ? t('undo') + ': ' + t('did_' + history[history.length - 1].label.replace('.', '_')) : '';
    document.title = (state.tournament.name ? state.tournament.name + ' — ' : '') + 'PUBG Scoreboard';
  }

  SB.live.on('state', function (next) {
    var first = state === null;
    state = next;
    if (first && !lang) {
      lang = state.language;
      renderLanguage();
      return;
    }
    render();
  });

  // Leaving with unsent edits: push them out first.
  window.addEventListener('pagehide', function () {
    rows.forEach(flushTeam);
    bound.forEach(function (field) {
      if (field.flush) field.flush();
    });
  });

  // ------------------------------------------------------------------ boot

  $('#f-source-url').value = sourceUrl();
  $('#obs-host').value = obsConfig.host;
  $('#obs-port').value = obsConfig.port;
  $('#obs-password').value = obsConfig.password;
  showTab(store('sb.tab') || 'obs');

  SB.loadTranslations().then(function () {
    renderLanguage();
    SB.live.start('control');
    if (obsConfig.auto) obs.connect(obsConfig);
    SB.info().then(function (data) {
      info = data;
      if (!info.authorized) $('#auth-banner').hidden = false;
      renderRemote();
    }, function () {});
  });
})();
