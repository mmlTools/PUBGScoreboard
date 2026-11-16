/*
 * PUBG Scoreboard — overlay renderer.
 *
 * State-driven: whatever the server says is on air gets rendered, so a
 * reconnect, a page reload or an OBS scene switch always ends in the right
 * picture. Transitions are serialized by reconcile() so they never overlap.
 */
(function () {
  'use strict';

  var SB = window.SB;
  var VIEWS = ['leaderboard', 'compact', 'podium', 'winner'];
  var COMPACT_ROWS = 16;
  var EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

  var params = new URLSearchParams(location.search);
  var pinned = VIEWS.indexOf(params.get('view')) >= 0 ? params.get('view') : null;
  var always = params.get('always') === '1';
  if (params.get('preview') === '1') document.documentElement.classList.add('preview');

  var stage = document.getElementById('stage');
  var backdrop = document.getElementById('backdrop');
  var CHICKEN = SB.url('Vendor/img/chicken_dinner.png');

  // ------------------------------------------------------------------ stage

  function fit() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var s = Math.min(w / 1920, h / 1080);
    stage.style.transform = 'translate(' + (w - 1920 * s) / 2 + 'px,' + (h - 1080 * s) / 2 + 'px) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  var themeKey = '';
  function applyTheme(state) {
    var t = state.theme;
    var key = [t.accent, t.surface, t.text, t.wallpaper, t.background].join('|');
    if (key === themeKey) return;
    themeKey = key;
    var a = rgb(t.accent);
    var luminance = (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) / 255;
    stage.style.setProperty('--accent', t.accent);
    stage.style.setProperty('--accent-rgb', a.join(', '));
    stage.style.setProperty('--accent-ink', luminance > 0.56 ? '#0b0d10' : '#ffffff');
    stage.style.setProperty('--surface-rgb', rgb(t.surface).join(', '));
    stage.style.setProperty('--text', t.text);
    stage.style.setProperty('--text-rgb', rgb(t.text).join(', '));
    var wall = t.background === 'wallpaper' && t.wallpaper;
    backdrop.style.backgroundImage = wall ? 'url("' + SB.asset(t.wallpaper).replace(/"/g, '%22') + '")' : '';
    backdrop.classList.toggle('on', !!wall);
  }

  // ---------------------------------------------------------------- helpers

  function h(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  /** Web Animations wrapper that always resolves, even if the element goes away. */
  function anim(el, frames, options) {
    if (!el || !el.animate) return Promise.resolve();
    var a = el.animate(frames, Object.assign({ duration: 520, easing: EASE, fill: 'both' }, options));
    return a.finished.then(noop, noop);
  }
  function noop() {}

  function stopAnimations(el) {
    if (!el.getAnimations) return;
    el.getAnimations({ subtree: true }).forEach(function (a) {
      a.cancel();
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** Re-trigger a CSS animation class. */
  function pulse(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  /**
   * Show a number. With `animate`, counts from the previous value (or 0 for a
   * fresh element) to the new one.
   */
  function setNumber(el, to, animate, delay) {
    var from = el._value;
    var fresh = from === undefined;
    if (fresh) from = animate ? 0 : to;
    el._value = to;
    cancelAnimationFrame(el._raf);
    clearTimeout(el._start);
    clearTimeout(el._safety);
    if (!animate || from === to) {
      el.textContent = to;
      return;
    }
    el.textContent = from;
    var duration = SB.clamp(380 + Math.abs(to - from) * 22, 500, 1500);
    el._start = setTimeout(function () {
      if (!fresh) pulse(el, 'bump');
      var t0 = performance.now();
      (function frame(now) {
        var p = Math.min(1, (now - t0) / duration);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(from + (to - from) * eased);
        if (p < 1) el._raf = requestAnimationFrame(frame);
      })(t0);
    }, delay || 0);
    // rAF is paused while an OBS source is hidden; never leave a half-counted number.
    el._safety = setTimeout(function () {
      cancelAnimationFrame(el._raf);
      el.textContent = to;
    }, (delay || 0) + duration + 400);
  }

  function setLogo(box, team) {
    var src = SB.asset(team.logo);
    var key = src || 'mono:' + SB.monogram(team);
    if (box._key === key) return;
    box._key = key;
    box.textContent = '';
    if (src) {
      var img = h('img');
      img.alt = '';
      img.onerror = function () {
        box._key = null;
        box.textContent = '';
        box.appendChild(h('span', 'mono', SB.monogram(team)));
      };
      img.src = src;
      box.appendChild(img);
    } else {
      box.appendChild(h('span', 'mono', SB.monogram(team)));
    }
  }

  /** Shrink a single-line heading until it fits its box. */
  function fitText(el, maxPx, minPx) {
    el.style.fontSize = maxPx + 'px';
    var available = el.clientWidth;
    if (available > 0 && el.scrollWidth > available) {
      el.style.fontSize = Math.max(minPx, Math.floor((maxPx * available) / el.scrollWidth)) + 'px';
    }
  }

  // ---------------------------------------------------- row animation styles

  var STYLES = {
    tactical: {
      enter: [
        { opacity: 0, transform: 'translateX(-110px) skewX(-12deg)' },
        { opacity: 1, transform: 'translateX(0) skewX(0deg)' }
      ],
      exit: [
        { opacity: 1, transform: 'translateX(0) skewX(0deg)' },
        { opacity: 0, transform: 'translateX(110px) skewX(-12deg)' }
      ],
      duration: 640,
      stagger: 58,
      sheen: true
    },
    airdrop: {
      enter: [
        { opacity: 0, transform: 'translateY(-190px) scale(1.05)', offset: 0 },
        { opacity: 1, transform: 'translateY(12px) scale(1)', offset: 0.62 },
        { opacity: 1, transform: 'translateY(-5px) scale(1)', offset: 0.82 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 }
      ],
      exit: [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(70px)' }
      ],
      duration: 720,
      stagger: 70,
      easing: 'cubic-bezier(0.33, 0.9, 0.4, 1)'
    },
    flip: {
      enter: [
        { opacity: 0, transform: 'perspective(1400px) rotateX(-95deg)' },
        { opacity: 1, transform: 'perspective(1400px) rotateX(0deg)' }
      ],
      exit: [
        { opacity: 1, transform: 'perspective(1400px) rotateX(0deg)' },
        { opacity: 0, transform: 'perspective(1400px) rotateX(95deg)' }
      ],
      duration: 700,
      stagger: 64,
      origin: '50% 0'
    },
    punch: {
      enter: [
        { opacity: 0, transform: 'scale(1.4)' },
        { opacity: 1, transform: 'scale(1)' }
      ],
      exit: [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.82)' }
      ],
      duration: 520,
      stagger: 52,
      sheen: true
    },
    fade: {
      enter: [
        { opacity: 0, transform: 'translateY(22px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      exit: [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-14px)' }
      ],
      duration: 560,
      stagger: 46
    }
  };

  // ---------------------------------------------------------------- RowList

  /**
   * Keeps a keyed list of rows in sync with the standings: new teams animate
   * in, missing ones animate out, the rest glide to their new slot.
   */
  function RowList(box, build, patch) {
    this.box = box;
    this.build = build;
    this.patch = patch;
    this.rows = new Map();
  }

  RowList.prototype.clear = function () {
    this.rows.clear();
    this.box.textContent = '';
  };

  /**
   * @param entries [{team, rank}] in display order
   * @param o {rowHeight, style, state}
   * @returns ms until every started animation has finished
   */
  RowList.prototype.sync = function (entries, o) {
    var self = this;
    var style = STYLES[o.style] || STYLES.tactical;
    var keep = {};
    entries.forEach(function (e) {
      keep[e.team.id] = true;
    });

    var leaving = [];
    this.rows.forEach(function (row, id) {
      if (!keep[id]) leaving.push(row);
    });
    leaving.sort(function (a, b) {
      return a.index - b.index;
    });
    leaving.forEach(function (row, i) {
      self.rows.delete(row.id);
      row.el.style.zIndex = 0;
      anim(row.inner, style.exit, { duration: 300, delay: i * 26, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' }).then(function () {
        row.el.remove();
      });
    });
    var exitTime = leaving.length ? 300 + (leaving.length - 1) * 26 : 0;

    var entered = 0;
    entries.forEach(function (entry, index) {
      var id = entry.team.id;
      var row = self.rows.get(id);
      var y = index * o.rowHeight + 'px';
      if (row) {
        var moved = row.rank - entry.rank; // > 0 means the team climbed
        row.el.classList.remove('no-move');
        row.el.style.setProperty('--y', y);
        self.patch(row, entry, o.state, true, 0);
        if (moved !== 0) {
          var marker = row.el.querySelector('.rank-move');
          if (marker) {
            marker.classList.remove('up', 'down');
            void marker.offsetWidth;
            marker.classList.add(moved > 0 ? 'up' : 'down');
          }
          if (moved > 0) {
            pulse(row.inner, 'climb');
            row.el.classList.add('rising');
            setTimeout(function () {
              row.el.classList.remove('rising');
            }, 1000);
          }
        }
        row.rank = entry.rank;
        row.index = index;
        return;
      }

      row = self.build();
      row.id = id;
      row.rank = entry.rank;
      row.index = index;
      row.el.classList.add('no-move');
      row.el.style.setProperty('--y', y);
      var delay = exitTime + entered * style.stagger;
      entered++;
      self.patch(row, entry, o.state, true, delay + style.duration * 0.35);
      self.box.appendChild(row.el);
      self.rows.set(id, row);
      row.inner.style.transformOrigin = style.origin || '50% 50%';
      anim(row.inner, style.enter, { duration: style.duration, delay: delay, easing: style.easing || EASE });
      if (style.sheen) {
        setTimeout(function () {
          pulse(row.inner, 'sheen');
        }, delay + style.duration * 0.4);
      }
    });

    return exitTime + (entered ? (entered - 1) * style.stagger + style.duration : 0);
  };

  /** Animate every row out; resolves when the list is empty. */
  RowList.prototype.exit = function (styleName) {
    var style = STYLES[styleName] || STYLES.tactical;
    var rows = [];
    this.rows.forEach(function (row) {
      rows.push(row);
    });
    rows.sort(function (a, b) {
      return a.index - b.index;
    });
    this.rows.clear();
    return Promise.all(
      rows.map(function (row, i) {
        return anim(row.inner, style.exit, { duration: 280, delay: i * 24, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' }).then(function () {
          row.el.remove();
        });
      })
    );
  };

  // ------------------------------------------------------------ view: board

  function pageOf(state, perPage, total) {
    var pages = SB.pageCount(total, perPage);
    var o = state.overlay;
    var page = o.autoRotate ? rotation % pages : Math.min(o.page, pages - 1);
    return { page: page, pages: pages };
  }

  var leaderboard = (function () {
    var el = document.getElementById('view-leaderboard');
    var head = el.querySelector('.lb-head');
    var cols = el.querySelector('.lb-cols');
    var foot = el.querySelector('.lb-foot');
    var pager = el.querySelector('.pager');
    var title = el.querySelector('.lb-title');
    var logo = el.querySelector('.lb-logo');
    var metas = {};
    el.querySelectorAll('.meta').forEach(function (m) {
      metas[m.getAttribute('data-meta')] = m;
    });

    function build() {
      var row = { el: h('div', 'row'), inner: h('div', 'row-in grid'), n: {} };
      var rank = h('div', 'c-rank');
      row.rankNum = h('span', 'rank-num');
      rank.appendChild(row.rankNum);
      rank.appendChild(h('i', 'rank-move'));

      var team = h('div', 'c-team');
      row.logo = h('div', 'logo-box');
      row.name = h('div', 'name');
      row.tag = h('span', 'tag');
      team.appendChild(row.logo);
      team.appendChild(row.name);
      team.appendChild(row.tag);

      function stat(key, extra) {
        var cell = h('div', 'c-stat' + (extra ? ' ' + extra : ''));
        row.n[key] = h('span', 'num');
        cell.appendChild(row.n[key]);
        return cell;
      }
      var mp = stat('matches', 'c-mp');
      row.wwcdCell = h('div', 'c-stat c-wwcd');
      var chicken = h('img');
      chicken.src = CHICKEN;
      chicken.alt = '';
      row.n.wwcd = h('span', 'num');
      row.wwcdCell.appendChild(chicken);
      row.wwcdCell.appendChild(h('span', 'x', '×'));
      row.wwcdCell.appendChild(row.n.wwcd);
      var place = stat('placePoints');
      var kills = stat('kills');
      var total = h('div', 'c-total');
      row.n.points = h('span', 'num');
      total.appendChild(row.n.points);

      [rank, team, mp, row.wwcdCell, place, kills, total].forEach(function (cell) {
        row.inner.appendChild(cell);
      });
      row.el.appendChild(row.inner);
      return row;
    }

    function patch(row, entry, state, animate, delay) {
      var team = entry.team;
      row.el.setAttribute('data-rank', entry.rank);
      setText(row.rankNum, String(entry.rank));
      setText(row.name, team.name || '—');
      setText(row.tag, team.name && team.logo ? team.tag : ''); // without a logo the tag already fills the logo box
      setLogo(row.logo, team);
      row.wwcdCell.classList.toggle('zero', team.wwcd === 0);
      ['matches', 'wwcd', 'placePoints', 'kills', 'points'].forEach(function (key) {
        setNumber(row.n[key], team[key], animate, delay);
      });
    }

    var list = new RowList(el.querySelector('.lb-rows'), build, patch);
    var styleName = 'tactical';

    function layout(state) {
      var theme = state.theme;
      var total = state.teams.length;
      var perPage = theme.teamsPerPage;
      var p = pageOf(state, perPage, total);
      var rowCount = Math.max(1, Math.min(perPage, total));
      var rh = SB.clamp(Math.floor(748 / rowCount), 36, 92);
      el.style.setProperty('--rh', rh + 'px');
      el.style.setProperty('--gap', (rh >= 60 ? 8 : rh >= 44 ? 5 : 3) + 'px');
      el.style.setProperty('--row-count', rowCount);
      el.classList.toggle('no-mp', !theme.showMatches);
      el.classList.toggle('no-wwcd', !theme.showWwcd);
      styleName = theme.animation;

      var t = state.tournament;
      if (title.textContent !== t.name) {
        title.textContent = t.name;
        fitText(title, 88, 40);
      }
      var src = SB.asset(t.logo);
      logo.hidden = !src;
      var img = logo.querySelector('img');
      if (src && img.getAttribute('src') !== src) {
        img.setAttribute('src', src);
        fitText(title, 88, 40);
      }
      [['map', t.map], ['day', t.day], ['match', t.match]].forEach(function (pair) {
        var cell = metas[pair[0]];
        cell.hidden = !pair[1];
        setText(cell.querySelector('dd'), pair[1]);
      });

      if (pager.children.length !== p.pages) {
        pager.textContent = '';
        for (var i = 0; i < p.pages; i++) pager.appendChild(h('i'));
      }
      Array.prototype.forEach.call(pager.children, function (dot, i) {
        dot.classList.toggle('on', i === p.page);
      });
      foot.style.visibility = p.pages > 1 ? 'visible' : 'hidden';

      var ranked = SB.rank(state.teams);
      return {
        entries: ranked.slice(p.page * perPage, (p.page + 1) * perPage),
        rowHeight: rh
      };
    }

    return {
      el: el,
      enter: function (state) {
        list.clear();
        var l = layout(state);
        fitText(title, 88, 40);
        anim(head, [
          // same vertex count as the CSS clip-path, so the chamfered corner survives the wipe
          { opacity: 0, transform: 'translateY(-46px)', clipPath: 'polygon(0 0, 0% 0, 0% 34px, 0% 100%, 0 100%)' },
          { opacity: 1, transform: 'translateY(0)', clipPath: 'polygon(0 0, calc(100% - 34px) 0, 100% 34px, 100% 100%, 0 100%)' }
        ], { duration: 760 });
        anim(el.querySelector('.lb-titles'), [
          { opacity: 0, transform: 'translateX(-40px)' },
          { opacity: 1, transform: 'translateX(0)' }
        ], { duration: 700, delay: 260 });
        Array.prototype.forEach.call(el.querySelectorAll('.meta'), function (m, i) {
          anim(m, [
            { opacity: 0, transform: 'translateY(26px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ], { duration: 520, delay: 420 + i * 90 });
        });
        anim(cols, [
          { opacity: 0, transform: 'scaleX(0.4)' },
          { opacity: 1, transform: 'scaleX(1)' }
        ], { duration: 520, delay: 300 });
        anim(foot, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 700 });
        return wait(420).then(function () {
          return wait(list.sync(l.entries, { rowHeight: l.rowHeight, style: styleName, state: state }));
        });
      },
      update: function (state) {
        var l = layout(state);
        list.sync(l.entries, { rowHeight: l.rowHeight, style: styleName, state: state });
      },
      exit: function () {
        var out = { duration: 320, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' };
        anim(foot, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
        return list.exit(styleName).then(function () {
          anim(cols, [{ opacity: 1, transform: 'scaleX(1)' }, { opacity: 0, transform: 'scaleX(0.4)' }], out);
          return anim(head, [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(-30px)' }
          ], out);
        });
      }
    };
  })();

  // ---------------------------------------------------------- view: compact

  var compact = (function () {
    var el = document.getElementById('view-compact');
    var head = el.querySelector('.cp-head');
    var legend = el.querySelector('.cp-legend');
    var match = el.querySelector('.cp-match');

    function build() {
      var row = { el: h('div', 'row'), inner: h('div', 'row-in'), n: {} };
      var rank = h('div', 'c-rank');
      row.rankNum = h('span', 'rank-num');
      rank.appendChild(row.rankNum);
      row.logo = h('div', 'logo-box');
      row.name = h('div', 'name');
      var kills = h('div', 'c-stat');
      row.n.kills = h('span', 'num');
      kills.appendChild(row.n.kills);
      var total = h('div', 'c-total');
      row.n.points = h('span', 'num');
      total.appendChild(row.n.points);
      [rank, row.logo, row.name, kills, total].forEach(function (cell) {
        row.inner.appendChild(cell);
      });
      row.el.appendChild(row.inner);
      return row;
    }

    function patch(row, entry, state, animate, delay) {
      var team = entry.team;
      row.el.setAttribute('data-rank', entry.rank);
      setText(row.rankNum, String(entry.rank));
      setText(row.name, team.name || team.tag || '—');
      setLogo(row.logo, team);
      setNumber(row.n.kills, team.kills, animate, delay);
      setNumber(row.n.points, team.points, animate, delay);
    }

    var list = new RowList(el.querySelector('.cp-rows'), build, patch);
    var styleName = 'tactical';

    function layout(state) {
      var total = state.teams.length;
      var p = pageOf(state, COMPACT_ROWS, total);
      el.classList.toggle('right', state.theme.compactSide === 'right');
      el.style.setProperty('--row-count', Math.max(1, Math.min(COMPACT_ROWS, total)));
      styleName = state.theme.animation;
      var m = state.tournament.match;
      setText(match, m ? SB.t('overlay_match', state.language) + ' ' + m : '');
      return SB.rank(state.teams).slice(p.page * COMPACT_ROWS, (p.page + 1) * COMPACT_ROWS);
    }

    var options = function (state) {
      return { rowHeight: 46, style: styleName, state: state };
    };

    return {
      el: el,
      enter: function (state) {
        list.clear();
        var entries = layout(state);
        var from = state.theme.compactSide === 'right' ? 60 : -60;
        [head, legend].forEach(function (node, i) {
          anim(node, [
            { opacity: 0, transform: 'translateX(' + from + 'px)' },
            { opacity: 1, transform: 'translateX(0)' }
          ], { duration: 520, delay: i * 80 });
        });
        return wait(200).then(function () {
          return wait(list.sync(entries, options(state)));
        });
      },
      update: function (state) {
        list.sync(layout(state), options(state));
      },
      exit: function () {
        return list.exit(styleName).then(function () {
          anim(legend, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
          return anim(head, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-20px)' }], { duration: 260 });
        });
      }
    };
  })();

  // ----------------------------------------------------------- view: podium

  var podium = (function () {
    var el = document.getElementById('view-podium');
    var head = el.querySelector('.pd-head');
    var name = el.querySelector('.pd-name');
    var box = el.querySelector('.pd-cards');
    var cards = [];
    var signature = '';

    function build(entry, state) {
      var card = { el: h('div', 'pd-card'), n: {} };
      card.el.setAttribute('data-rank', entry.rank);
      card.el.appendChild(h('div', 'pd-rank', '#' + entry.rank));
      card.logo = h('div', 'logo-box');
      card.team = h('div', 'pd-team');
      card.n.points = h('div', 'pd-points num');
      card.el.appendChild(card.logo);
      card.el.appendChild(card.team);
      card.el.appendChild(card.n.points);
      card.el.appendChild(h('div', 'pd-label', SB.t('overlay_total', state.language)));
      var sub = h('div', 'pd-sub');
      [['kills', 'overlay_kills'], ['wwcd', 'overlay_wwcd']].forEach(function (pair) {
        var chip = h('span');
        card.n[pair[0]] = h('b', 'num');
        chip.appendChild(card.n[pair[0]]);
        chip.appendChild(document.createTextNode(SB.t(pair[1], state.language)));
        sub.appendChild(chip);
      });
      card.el.appendChild(sub);
      return card;
    }

    function patch(card, entry, animate, delay) {
      setText(card.team, entry.team.name || '—');
      setLogo(card.logo, entry.team);
      ['points', 'kills', 'wwcd'].forEach(function (key) {
        setNumber(card.n[key], entry.team[key], animate, delay);
      });
    }

    function top3(state) {
      return SB.rank(state.teams).slice(0, 3);
    }

    function sign(entries, state) {
      return state.language + ':' + entries.map(function (e) {
        return e.team.id;
      }).join(',');
    }

    function render(state) {
      var entries = top3(state);
      signature = sign(entries, state);
      setText(name, state.tournament.name);
      box.textContent = '';
      cards = entries.map(function (entry) {
        var card = build(entry, state);
        box.appendChild(card.el);
        // Third place lands first, the champion last.
        var delay = 250 + (3 - entry.rank) * 230;
        patch(card, entry, true, delay + 300);
        anim(card.el, [
          { opacity: 0, transform: 'translateY(140px) scale(0.92)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], { duration: 760, delay: delay });
        return card;
      });
    }

    return {
      el: el,
      enter: function (state) {
        anim(head, [
          { opacity: 0, transform: 'translateY(-60px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 640 });
        render(state);
        return wait(1500);
      },
      update: function (state) {
        var entries = top3(state);
        if (sign(entries, state) !== signature) {
          render(state);
          return;
        }
        setText(name, state.tournament.name);
        entries.forEach(function (entry, i) {
          patch(cards[i], entry, true, 0);
        });
      },
      exit: function () {
        var out = { duration: 320, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' };
        anim(head, [{ opacity: 1 }, { opacity: 0 }], out);
        return Promise.all(cards.map(function (card, i) {
          return anim(card.el, [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(90px)' }
          ], Object.assign({ delay: i * 50 }, out));
        }));
      }
    };
  })();

  // ----------------------------------------------------------- view: winner

  var winner = (function () {
    var el = document.getElementById('view-winner');
    var canvas = el.querySelector('.wn-sparks');
    var line1 = el.querySelector('.wn-line-1');
    var line2 = el.querySelector('.wn-line-2');
    var teamBar = el.querySelector('.wn-team');
    var logo = el.querySelector('.wn-logo');
    var name = el.querySelector('.wn-name');
    var statsBox = el.querySelector('.wn-stats');
    var stats = {};
    el.querySelectorAll('[data-stat]').forEach(function (node) {
      node.classList.add('num');
      stats[node.getAttribute('data-stat')] = node;
    });
    var currentId = null;
    var running = false;

    function pick(state) {
      var o = state.overlay;
      var found = null;
      state.teams.forEach(function (team) {
        if (team.id === o.winnerId) found = team;
      });
      if (found) return found;
      var ranked = SB.rank(state.teams);
      return ranked.length ? ranked[0].team : null;
    }

    function fill(team, animate, delay) {
      teamBar.style.display = team ? '' : 'none';
      statsBox.style.display = team ? '' : 'none';
      if (!team) return;
      setText(name, team.name || team.tag || '—');
      logo._key = null;
      setLogo(logo, team);
      ['kills', 'points', 'wwcd'].forEach(function (key) {
        setNumber(stats[key], team[key], animate, delay);
      });
    }

    // Embers drifting up through the frame.
    function sparks() {
      var ctx = canvas.getContext('2d');
      var color = getComputedStyle(stage).getPropertyValue('--accent-rgb') || '242, 169, 0';
      var parts = [];
      function spawn(burst) {
        return {
          x: burst ? 960 + (Math.random() - 0.5) * 700 : Math.random() * 1920,
          y: burst ? 560 + (Math.random() - 0.5) * 200 : 1100,
          vx: (Math.random() - 0.5) * (burst ? 9 : 1.2),
          vy: burst ? -Math.random() * 9 - 2 : -Math.random() * 2.2 - 0.8,
          size: Math.random() * 3.2 + 1.2,
          life: 0,
          max: burst ? 60 + Math.random() * 50 : 240 + Math.random() * 220
        };
      }
      for (var i = 0; i < 90; i++) parts.push(spawn(true));
      (function frame() {
        if (!running) {
          ctx.clearRect(0, 0, 1920, 1080);
          return;
        }
        ctx.clearRect(0, 0, 1920, 1080);
        if (parts.length < 110 && Math.random() < 0.5) parts.push(spawn(false));
        for (var j = parts.length - 1; j >= 0; j--) {
          var p = parts[j];
          p.life++;
          p.x += p.vx + Math.sin((p.life + j) / 22) * 0.5;
          p.y += p.vy;
          p.vy *= 0.992;
          p.vx *= 0.985;
          if (p.life > p.max || p.y < -20) {
            parts.splice(j, 1);
            continue;
          }
          var alpha = Math.min(1, p.life / 12) * (1 - p.life / p.max);
          ctx.fillStyle = 'rgba(' + color + ',' + alpha.toFixed(3) + ')';
          ctx.fillRect(p.x, p.y, p.size, p.size * 1.6);
        }
        requestAnimationFrame(frame);
      })();
    }

    function play(state) {
      var team = pick(state);
      currentId = team ? team.id : null;
      fill(team, true, 1100);
      anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
      anim(line1, [
        { opacity: 0, transform: 'scale(2.6)' },
        { opacity: 1, transform: 'scale(1)' }
      ], { duration: 520, delay: 180, easing: 'cubic-bezier(0.2, 1.3, 0.4, 1)' });
      anim(line2, [
        { opacity: 0, transform: 'scale(3)' },
        { opacity: 1, transform: 'scale(0.96)', offset: 0.7 },
        { opacity: 1, transform: 'scale(1)' }
      ], { duration: 620, delay: 420, easing: 'cubic-bezier(0.2, 1.2, 0.4, 1)' });
      anim(teamBar, [
        { opacity: 0, transform: 'translateY(70px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 640, delay: 860 });
      Array.prototype.forEach.call(statsBox.children, function (node, i) {
        anim(node, [
          { opacity: 0, transform: 'translateY(40px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 520, delay: 1080 + i * 110 });
      });
      if (!running) {
        running = true;
        sparks();
      }
    }

    return {
      el: el,
      enter: function (state) {
        play(state);
        return wait(1700);
      },
      update: function (state) {
        var team = pick(state);
        if ((team ? team.id : null) !== currentId) {
          play(state);
          return;
        }
        fill(team, true, 0);
      },
      exit: function () {
        return anim(el, [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(1.06)' }
        ], { duration: 420, easing: 'ease-in' }).then(function () {
          running = false;
        });
      }
    };
  })();

  // ------------------------------------------------------------ controller

  var views = { leaderboard: leaderboard, compact: compact, podium: podium, winner: winner };
  var shown = null;
  var busy = false;
  var dirty = false;
  var replay = false;
  var replaySeen = null;
  var language = null;
  var rotation = 0;
  var rotatedAt = Date.now();

  function desired(state) {
    if (!always && !state.overlay.visible) return null;
    return pinned || state.overlay.view;
  }

  function reconcile() {
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    (async function () {
      do {
        dirty = false;
        var state = SB.live.state();
        if (!state) break;

        if (language !== state.language) {
          language = state.language;
          document.documentElement.lang = language;
          SB.translate(stage, language);
        }
        applyTheme(state);

        if (replay && shown) {
          // Nobody is watching the old frame (scene switch / replay button): cut, don't fade.
          stopAnimations(views[shown].el);
          views[shown].el.hidden = true;
          shown = null;
        }
        replay = false;

        var want = desired(state);
        if (shown && shown !== want) {
          await views[shown].exit();
          views[shown].el.hidden = true;
          stopAnimations(views[shown].el);
          shown = null;
          dirty = true; // re-read the state: it may have moved on while we animated
          continue;
        }
        if (want && !shown) {
          shown = want;
          views[want].el.hidden = false;
          rotatedAt = Date.now();
          await views[want].enter(state);
        } else if (want) {
          views[want].update(state);
        }
      } while (dirty);
    })().then(
      function () {
        busy = false;
      },
      function (err) {
        busy = false;
        console.error(err);
      }
    );
  }

  SB.live.on('state', function (state) {
    if (replaySeen !== null && state.overlay.replay !== replaySeen) replay = true;
    replaySeen = state.overlay.replay;
    reconcile();
  });

  // Auto-rotate through the pages.
  setInterval(function () {
    var state = SB.live.state();
    if (!state || !state.overlay.autoRotate || busy) return;
    if (shown !== 'leaderboard' && shown !== 'compact') return;
    if (Date.now() - rotatedAt < state.overlay.rotateSeconds * 1000) return;
    rotatedAt = Date.now();
    rotation++;
    reconcile();
  }, 500);

  // OBS tells browser sources when their scene goes live: replay the entrance.
  window.addEventListener('obsSourceActiveChanged', function (event) {
    if (event.detail && event.detail.active) {
      replay = true;
      reconcile();
    }
  });

  // Handy when the overlay is open in a normal browser window.
  window.addEventListener('keydown', function (event) {
    var map = { ArrowLeft: 'overlay.prev', ArrowRight: 'overlay.next', ' ': 'overlay.toggle' };
    if (map[event.key]) {
      event.preventDefault();
      SB.action(map[event.key]).catch(noop);
    }
  });

  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all([SB.loadTranslations(), Promise.race([fontsReady, wait(1500)])]).then(function () {
    // the control panel's own preview must not count as "an overlay is connected"
    SB.live.start(params.get('panel') === '1' ? 'preview' : 'overlay');
  });
})();
