/*
 * Injected at the top of every saved design version (scripts/build-versions.mjs),
 * so an old version can be tried with your real data without touching it:
 *
 * - It reads your data, but everything it writes goes to a separate copy
 *   (keys starting with "gym-tracker:preview:"). The copy is thrown away
 *   the next time you open a preview, so each one starts from your data.
 * - Sync is off: it can't see your sync key and can't open a connection,
 *   so nothing reaches your other devices.
 * - It doesn't install a service worker: an old one would clear the
 *   current version's offline files.
 * - A bar at the top says it's a preview and leads back.
 *
 * Plain ES5 on purpose: it runs before anything else on the page.
 */
(function (root) {
  var PREFIX = 'gym-tracker:preview:';
  var GONE = PREFIX + '~gone';
  var HIDDEN = ['gym-tracker:sync'];

  /** A Storage that reads through to `real` and writes beside it. */
  function previewStorage(real) {
    function gone() {
      try {
        return JSON.parse(real.getItem(GONE) || '[]');
      } catch (e) {
        return [];
      }
    }
    function setGone(list) {
      real.setItem(GONE, JSON.stringify(list));
    }
    function keys() {
      var out = [];
      var removed = gone();
      for (var i = 0; i < real.length; i++) {
        var k = real.key(i);
        if (k === null || k === GONE) continue;
        var own = k.indexOf(PREFIX) === 0 ? k.slice(PREFIX.length) : null;
        var name = own !== null ? own : k;
        if (own === null && (removed.indexOf(k) >= 0 || HIDDEN.indexOf(k) >= 0)) continue;
        if (own === null && real.getItem(PREFIX + k) !== null) continue;
        if (out.indexOf(name) < 0) out.push(name);
      }
      return out;
    }
    var store = {
      getItem: function (key) {
        key = String(key);
        if (HIDDEN.indexOf(key) >= 0) return null;
        var own = real.getItem(PREFIX + key);
        if (own !== null) return own;
        if (gone().indexOf(key) >= 0) return null;
        return real.getItem(key);
      },
      setItem: function (key, value) {
        key = String(key);
        if (HIDDEN.indexOf(key) >= 0) return;
        real.setItem(PREFIX + key, String(value));
        var list = gone();
        var at = list.indexOf(key);
        if (at >= 0) {
          list.splice(at, 1);
          setGone(list);
        }
      },
      removeItem: function (key) {
        key = String(key);
        real.removeItem(PREFIX + key);
        var list = gone();
        if (list.indexOf(key) < 0) {
          list.push(key);
          setGone(list);
        }
      },
      clear: function () {
        var all = keys();
        reset(real);
        setGone(all);
      },
      key: function (i) {
        var all = keys();
        return i >= 0 && i < all.length ? all[i] : null;
      },
    };
    Object.defineProperty(store, 'length', {
      get: function () {
        return keys().length;
      },
    });
    return store;
  }

  /** Throws away a preview's copy. */
  function reset(real) {
    for (var i = real.length - 1; i >= 0; i--) {
      var k = real.key(i);
      if (k && k.indexOf(PREFIX) === 0) real.removeItem(k);
    }
  }

  /** The same tab's sessionStorage, with the preview's keys kept apart. */
  function prefixedStorage(real) {
    var store = {
      getItem: function (k) {
        return real.getItem(PREFIX + k);
      },
      setItem: function (k, v) {
        real.setItem(PREFIX + k, String(v));
      },
      removeItem: function (k) {
        real.removeItem(PREFIX + k);
      },
      clear: function () {
        reset(real);
      },
      key: function () {
        return null;
      },
    };
    Object.defineProperty(store, 'length', {
      get: function () {
        return 0;
      },
    });
    return store;
  }

  function install(win, config) {
    var real = win.localStorage;
    var session = win.sessionStorage;
    // A new preview starts from your data: drop what an earlier one changed.
    try {
      if (session.getItem('gym-tracker:preview-of') !== config.tag) {
        reset(real);
        session.setItem('gym-tracker:preview-of', config.tag);
      }
    } catch (e) {
      // Storage blocked: the app falls back to its own handling.
    }
    var local = previewStorage(real);
    var tab = prefixedStorage(session);
    Object.defineProperty(win, 'localStorage', { configurable: true, get: function () { return local; } });
    Object.defineProperty(win, 'sessionStorage', { configurable: true, get: function () { return tab; } });

    // No syncing from a preview.
    win.WebSocket = function () {
      throw new Error('Sync is off in a preview of an earlier version.');
    };
    if (win.navigator && win.navigator.serviceWorker) {
      try {
        Object.defineProperty(win.navigator.serviceWorker, 'register', {
          configurable: true,
          value: function () {
            return new Promise(function () {});
          },
        });
      } catch (e) {
        // Not replaceable here: the version has no sw.js to register anyway.
      }
    }

    win.document.addEventListener('DOMContentLoaded', function () {
      // In a shadow root, so no version's styles can reach it (or the other way round).
      var host = win.document.createElement('div');
      host.className = 'gym-preview-bar';
      host.setAttribute('role', 'note');
      host.setAttribute('aria-label', config.label + ': a preview of an earlier design. Changes here aren\u2019t kept.');
      var shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<style>' +
        ':host{all:initial;position:fixed;z-index:2147483647;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 6px);display:flex;justify-content:center;pointer-events:none}' +
        '.bar{pointer-events:auto;display:flex;align-items:center;gap:10px;width:max-content;max-width:calc(100% - 16px);box-sizing:border-box;' +
        'padding:4px 4px 4px 14px;border-radius:999px;background:#16262b;color:#fff;font:600 13px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.28);white-space:nowrap}' +
        '.text{display:flex;flex-direction:column;min-width:0}' +
        '.text b,.text span{overflow:hidden;text-overflow:ellipsis}' +
        '.text span{font-weight:500;font-size:11px;opacity:.75}' +
        'a{flex-shrink:0;display:flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;background:#fb8b24;color:#2a1405;text-decoration:none;font-weight:700}' +
        // After a moment it folds into a tab on the left edge, out of the way of the screen's own buttons.
        '.tab{pointer-events:auto;position:fixed;left:0;top:50%;transform:translateY(-50%);width:44px;height:52px;border:0;border-radius:0 14px 14px 0;' +
        'background:#16262b;color:#fb8b24;font:700 18px/1 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer;padding:0}' +
        ':host(.folded) .bar{display:none}:host(:not(.folded)) .tab{display:none}' +
        '</style>' +
        '<div class="bar"><span class="text"><b></b><span>Preview \u00b7 changes aren\u2019t kept</span></span><a>Back to current</a></div>' +
        '<button class="tab" type="button" aria-label="Preview of an earlier design: show options">\u21a9</button>';
      shadow.querySelector('b').textContent = config.label;
      shadow.querySelector('a').setAttribute('href', config.home + '#/settings/versions');
      var timer;
      function fold() {
        host.classList.add('folded');
      }
      function unfold() {
        host.classList.remove('folded');
        clearTimeout(timer);
        timer = setTimeout(fold, 5000);
      }
      shadow.querySelector('.tab').addEventListener('click', unfold);
      win.document.body.appendChild(host);
      unfold();
    });
  }

  root.gymPreview = { previewStorage: previewStorage, reset: reset, install: install, PREFIX: PREFIX };
  if (typeof window !== 'undefined' && window.__GYM_PREVIEW__) install(window, window.__GYM_PREVIEW__);
})(typeof globalThis !== 'undefined' ? globalThis : this);
