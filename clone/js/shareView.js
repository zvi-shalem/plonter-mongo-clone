/* shareView.js — Plonter share-LINK receive = IMPORT-AS-OWNED.
 * SHARE_IMPORT_20260607 (replaces the SHARE_FIX2 read-only-banner behavior,
 * rejected by Amitai 2026-06-07). Self-contained, dependency-free IIFE. The ONLY
 * index.html change is the single <script> that loads this file.
 *
 * Amitai's spec: opening a share LINK must IMPORT the shared item as a fully
 * regular OWNED item at the recipient — open/edit exactly like one he created
 * himself — placed in category "משותפים" instead of the source category. No
 * read-only banner, no ephemeral viewer.
 *
 * Flow: Fix-1 routes share.html?t=TOKEN -> index.html?...&share=TOKEN[&type&role&cid&title].
 *   A. parse the URL; no `share` param => no-op (but show a post-import toast if pending).
 *   B. POST open_share {token} (content_org_api.php, Bearer) -> registers the recipient +
 *      resolves {content_type,id,title,role}.
 *   C. IMPORT: fetch the source item (content_api get), build a clean OWNED copy with a fresh
 *      id + category "משותפים", create it on the server (content_api create, owned by the
 *      recipient), hydrate via ContentSync.pullAll, detach the share recipient row, then
 *      reload to a clean URL where it renders like any normal item.
 *   D. Dedup by token (localStorage) so re-opening the same link never duplicates.
 *   E. every app-internal access is typeof-guarded; never throws if internals are absent.
 */
(function () {
  'use strict';

  var ORG_API = '/plonter/api/content_org_api.php';   // open_share / detach_share
  var CONTENT_API = '/plonter/api/content_api.php';    // get / create
  var IMPORTED_KEY = 'plonter_share_imported_v1';      // dedup set of consumed tokens
  var TOAST_KEY = 'plonter_share_import_toast';        // one-shot post-reload toast text
  var SHARED_CATEGORY = 'משותפים';

  function qp() {
    try { return new URLSearchParams(window.location.search); } catch (e) { return null; }
  }
  function authToken() {
    try { return localStorage.getItem('plonter_auth_token') || ''; } catch (e) { return ''; }
  }
  function _api(base, action, body) {
    var hdrs = { 'Content-Type': 'application/json' };
    var tok = authToken();
    if (tok) hdrs['Authorization'] = 'Bearer ' + tok;
    return fetch(base + '?action=' + action, {
      method: 'POST', headers: hdrs, body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  function org(action, body) { return _api(ORG_API, action, body); }
  function content(action, body) { return _api(CONTENT_API, action, body); }

  function _parseData(item) {
    var d = item && item.data;
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return (d && typeof d === 'object') ? d : {};
  }

  // ---- dedup ---------------------------------------------------------------
  function _importedSet() {
    try { return JSON.parse(localStorage.getItem(IMPORTED_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function _alreadyImported(token) { return _importedSet().indexOf(token) !== -1; }
  function _markImported(token) {
    try {
      var s = _importedSet();
      if (s.indexOf(token) === -1) { s.push(token); localStorage.setItem(IMPORTED_KEY, JSON.stringify(s)); }
    } catch (e) {}
  }

  // ---- toast ---------------------------------------------------------------
  function _toast(msg) {
    try {
      var t = document.createElement('div');
      t.setAttribute('dir', 'rtl');
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483600;' +
        'background:linear-gradient(135deg,#0d9488,#0891b2);color:#fff;padding:11px 18px;border-radius:11px;' +
        'font-family:inherit;font-weight:bold;font-size:0.98em;box-shadow:0 6px 22px rgba(0,0,0,0.25);' +
        'max-width:90vw;text-align:center;opacity:0;transition:opacity .25s';
      t.textContent = msg;
      (document.body || document.documentElement).appendChild(t);
      setTimeout(function () { t.style.opacity = '1'; }, 30);
      setTimeout(function () { t.style.opacity = '0'; }, 4200);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4600);
    } catch (e) {}
  }

  // ---- build a clean OWNED copy of the shared item -------------------------
  // Strip every share/temp/server-binding field so the result is indistinguishable
  // from an item the recipient created, then stamp a fresh id + the משותפים category.
  function _buildOwnedCopy(item) {
    var src = _parseData(item);
    var copy = {};
    for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) copy[k] = src[k]; }
    ['serverId', 'local_id', 'source_id', 'source_type', 'shareCode', 'isShared',
     '_temporaryLesson', '_tempCreatedAt', '_sharedRole', '_createdAsGuest'].forEach(function (f) {
      try { delete copy[f]; } catch (e) {}
    });
    var ct = item.content_type || 'lesson';
    var now = new Date().toISOString();
    // Local-id format mirrors the modules' own minting (lessons.js uses 'lesson_'+Date.now()).
    copy.id = ct + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    copy.title = copy.title || item.title || 'פריט משותף';
    copy.category = SHARED_CATEGORY;        // <-- the whole point: lands under "משותפים"
    copy._importedFromShare = true;
    copy.created = now; copy.updated = now; copy.lastAccessed = now;
    return copy;
  }

  // ---- the import itself ----------------------------------------------------
  function importShared(sv) {
    var ct = sv.contentType;
    var token = sv.token;
    // vocab categories import via their own vocab.html route — not handled here.
    if (ct === 'vocab_category') { _reloadClean(); return; }

    // BUG #1352 fix: a 'link' share authorizes a non-owner read only when the
    // request carries the share token (userCanViewContent path (a) in
    // content_api.php). Pass the share token shareView already holds (sv.token),
    // otherwise get falls through to the owner-scoped query and returns
    // 'פריט לא נמצא' for the recipient.
    content('get', { id: sv.cid, share_token: sv.token }).then(function (gres) {
      var item = (gres && gres.success && gres.item) ? gres.item : null;
      if (!item) {
        // Could not read the source (revoked / not authorised). Degrade: clean app, gentle note.
        _stash('לא הצלחתי לטעון את הפריט המשותף.');
        _reloadClean();
        return;
      }
      item.content_type = item.content_type || ct;
      var copy = _buildOwnedCopy(item);
      var color = (item.color || (_parseData(item).color) || '#0d9488');

      content('create', {
        content_type: item.content_type,
        title: copy.title,
        data: copy,
        color: color
      }).then(function (cres) {
        if (!cres || !cres.success) {
          _stash('הוספת הפריט המשותף נכשלה — נסה שוב.');
          _reloadClean();
          return;
        }
        _markImported(token);
        // Hydrate the new owned item into the per-type local store the canonical way,
        // then drop the recipient share-row so it doesn't also show in "שותפו איתי".
        var hydrate = (typeof window.ContentSync !== 'undefined' && window.ContentSync &&
                       typeof window.ContentSync.pullAll === 'function')
          ? window.ContentSync.pullAll(item.content_type).catch(function () {})
          : Promise.resolve();
        hydrate.then(function () {
          org('detach_share', { token: token }).catch(function () {}).then(function () {
            _stash('✅ «' + copy.title + '» נוסף לקטגוריה "' + SHARED_CATEGORY + '"');
            _reloadClean();
          });
        });
      });
    });
  }

  // Stash a one-shot toast to show after the clean reload.
  function _stash(msg) { try { sessionStorage.setItem(TOAST_KEY, msg); } catch (e) { try { localStorage.setItem(TOAST_KEY, msg); } catch (_) {} } }
  function _popStash() {
    var m = null;
    try { m = sessionStorage.getItem(TOAST_KEY); if (m != null) sessionStorage.removeItem(TOAST_KEY); } catch (e) {}
    if (m == null) { try { m = localStorage.getItem(TOAST_KEY); if (m != null) localStorage.removeItem(TOAST_KEY); } catch (e) {} }
    return m;
  }
  // Reload to the same path WITHOUT the share query/hash → normal app render.
  function _reloadClean() {
    try { location.replace(location.pathname); } catch (e) { try { location.href = location.pathname; } catch (_) {} }
  }

  // ---- bootstrap -----------------------------------------------------------
  function boot() {
    var p = qp();
    var share = p ? p.get('share') : null;

    if (!share) {
      // Normal app load. If we just came back from an import, surface the toast.
      var pending = _popStash();
      if (pending) _toast(pending);
      return;
    }
    if (typeof fetch !== 'function') return; // ancient browser — degrade silently.

    // Already consumed this link on this device → don't duplicate, just go to the clean app.
    if (_alreadyImported(share)) { _reloadClean(); return; }

    org('open_share', { token: share }).then(function (resp) {
      if (!resp || !resp.ok) {
        // Most common: not logged in ('נדרשת התחברות'), or revoked/expired token.
        // No banner, no crash. If it's an auth gate, nudge the user to log in and retry.
        var err = resp && resp.error;
        if (err) { try { console.info('[shareView] open_share: ' + err); } catch (e) {} }
        if (err && /התחבר/.test(err)) _toast('התחבר/י כדי להוסיף את הפריט המשותף, ואז פתח/י שוב את הקישור.');
        return;
      }
      var sv = {
        token: share,
        role: p.get('role') || resp.role || 'view',
        contentType: resp.content_type || p.get('type') || 'lesson',
        cid: resp.id,
        title: resp.title || p.get('title') || ''
      };
      if (!sv.cid) { _reloadClean(); return; }
      importShared(sv);
    });
  }

  // Defer past app init/auth so ContentSync + the modules exist, and body is present.
  function start() { try { boot(); } catch (e) { try { console.warn('[shareView] ' + e); } catch (_) {} } }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 500); });
  } else {
    setTimeout(start, 500);
  }
})();
