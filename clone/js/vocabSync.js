/**
 * VocabSync — bridges the existing plonter_vocab_v2 localStorage shape to
 * ContentSync. Stage 1a: client scaffold only. No server API yet, so the
 * badge stays "unsynced" until the content_api.php vocab endpoints + DB
 * migrations from @plonter_3_amitai's spec land in a follow-up session.
 *
 * What this file does today:
 *   1. Maintains plonter_vocab_cs_meta { "<catName>": "<iso-updated>" }
 *      so ContentSync has the per-item `updated` it needs — the legacy
 *      plonter_vocab_v2 format (keyed by category name, no timestamps)
 *      doesn't carry one.
 *   2. Registers 'vocab_category' with ContentSync — getter, setter
 *      (no-op until the server accepts vocab), lister (returns virtual
 *      items with id=name, updated=meta timestamp).
 *   3. Wraps vocab.html's saveCustomData so every mutation stamps the
 *      updated timestamp for the affected category and enqueues
 *      ContentSync.save('vocab_category', name, ...).
 *   4. Exposes VocabSync.getBadge(catName) — thin wrapper around
 *      ContentSync.getSyncBadge so the UI can render the same 3-state
 *      cloud icon that lessons/texts show.
 *   5. Exposes VocabSync.syncAllCategories() — call target for the
 *      "☁️ גבה הכל" button vocab.html renders.
 *
 * Namespacing by user via plonter_data_owner happens in ContentSync's
 * queue/meta store; _clearUserScopedContent in auth.js will clear
 * plonter_vocab_cs_meta too (added there in the same stage).
 */
var VocabSync = (function() {
    'use strict';

    var META_KEY = 'plonter_vocab_cs_meta';

    function _now() { return new Date().toISOString(); }

    function _getMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
        catch (_) { return {}; }
    }

    function _setMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }

    function _ensureCategoryStamp(catName) {
        var m = _getMeta();
        if (!m[catName]) {
            m[catName] = _now();
            _setMeta(m);
        }
    }

    function stampCategory(catName) {
        var m = _getMeta();
        m[catName] = _now();
        _setMeta(m);
    }

    // BUILTIN categories are defined at runtime in vocab.html (window.BUILTIN_CATEGORIES).
    // They must NOT sync to the server under content_type='vocab_category' —
    // they're app-provided, identical across users, and uploading them as
    // user content was the root cause of Amitai's 2026-04-20 13:44 conflict
    // dialog on "99 שמות אללה". Any guard here must be a CENTRAL helper —
    // the getter, lister, and onCategorySaved all need the same check.
    function _isBuiltin(catName) {
        try {
            return typeof BUILTIN_CATEGORIES !== 'undefined'
                && BUILTIN_CATEGORIES
                && Object.prototype.hasOwnProperty.call(BUILTIN_CATEGORIES, catName);
        } catch (_) { return false; }
    }

    // Virtual item getter — ContentSync expects { id, title, updated, data, ... }.
    // We synthesise it from the legacy plonter_vocab_v2 entry plus our meta.
    // Unified-table wire shape (per @3a 2026-04-19):
    //   content_type='vocab_category', source_id=<group or null>, title=<catName>, data=<JSON>.
    // Vocab doesn't currently group categories into sets, so source_id stays
    // null until Amitai defines groupings; the API accepts TEXT with no constraints.
    function _getCategory(catName) {
        if (_isBuiltin(catName)) return null;
        var raw;
        try { raw = JSON.parse(localStorage.getItem('plonter_vocab_v2') || '{}'); }
        catch (_) { raw = {}; }
        var entry = raw[catName];
        if (!entry) return null;
        var meta = _getMeta();
        return {
            id: catName,
            title: catName,
            source_id: null,
            updated: meta[catName] || _now(),
            data: {
                id: catName,
                name: catName,
                words: entry.words || [],
                conjugations: entry.conjugations || null,
                overrideBuiltin: !!entry.overrideBuiltin
            }
        };
    }

    function _listCategories() {
        var raw;
        try { raw = JSON.parse(localStorage.getItem('plonter_vocab_v2') || '{}'); }
        catch (_) { raw = {}; }
        var meta = _getMeta();
        var out = [];
        for (var name in raw) {
            if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
            if (_isBuiltin(name)) continue;   // never enumerate BUILTINs for sync
            out.push({
                id: name,
                title: name,
                updated: meta[name] || null
            });
        }
        return out;
    }

    // Setter for pull-from-server (stage 2). Today the server can't send
    // vocab rows, so this is a forward-compatible stub.
    function _setCategory(catName, serverData) {
        if (_isBuiltin(catName)) return;   // never re-hydrate BUILTINs from server
        try {
            var raw = JSON.parse(localStorage.getItem('plonter_vocab_v2') || '{}');
            var data = serverData.data;
            if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
            if (!data) return;
            raw[catName] = {
                words: data.words || [],
                conjugations: data.conjugations || null,
                overrideBuiltin: !!data.overrideBuiltin
            };
            localStorage.setItem('plonter_vocab_v2', JSON.stringify(raw));
            var m = _getMeta();
            m[catName] = serverData.updated || _now();
            _setMeta(m);
        } catch (e) {
            console.warn('[VocabSync] _setCategory failed', e);
        }
    }

    // Custom puller — plonter_vocab_v2 is a dict keyed by category name, not
    // the flat-array shape ContentSync.pullAll generic path writes to. We
    // own the per-type pull and write via _setCategory + mark meta synced.
    async function _pull(ctx) {
        var api = ctx && ctx.api;
        var setItemMeta = ctx && ctx.setItemMeta;
        if (typeof api !== 'function') return { loaded: 0, error: 'no api' };
        var res = await api('list', { content_type: 'vocab_category' });
        if (!res || !res.success) return { loaded: 0, error: (res && res.error) || 'list failed' };
        var items = res.items || [];
        var loaded = 0;
        for (var i = 0; i < items.length; i++) {
            var srv = items[i];
            if (!srv || !srv.title) continue;
            if (_isBuiltin(srv.title)) continue;   // skip legacy BUILTIN rows on pull
            _setCategory(srv.title, srv);
            if (typeof setItemMeta === 'function') {
                setItemMeta('vocab_category', srv.title, {
                    synced: true,
                    serverId: srv.id,
                    lastServerUpdated: srv.updated
                });
            }
            loaded++;
        }
        return { loaded: loaded, serverCount: items.length };
    }

    // One-shot cleanup of legacy BUILTIN rows that earlier versions of this
    // module pushed as vocab_category. Amitai 2026-04-20 13:44: hard DELETE
    // (no archive) — a BUILTIN override isn't something he wants preserved.
    // Runs after boot + auth, never re-runs once the flag is set.
    var CLEANUP_FLAG = 'plonter_vocab_builtins_server_cleanup_v1';

    async function _cleanupLegacyBuiltinsIfNeeded() {
        if (localStorage.getItem(CLEANUP_FLAG) === '1') return;
        var token = localStorage.getItem('plonter_auth_token') || '';
        if (!token) return;                                          // logged-in only
        if (typeof BUILTIN_CATEGORIES === 'undefined' || !BUILTIN_CATEGORIES) return;

        // ContentSync.deleteItem requires a serverId in its item meta (which
        // gets set by the puller). Since we're running before/without a pull,
        // hit content_api.php directly to list + delete by row.id. Mirrors
        // how the pull path fetches.
        try {
            var hdrs = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
            var r = await fetch('/plonter/api/content_api.php?action=list', {
                method: 'POST',
                headers: hdrs,
                body: JSON.stringify({ content_type: 'vocab_category' })
            });
            var j = await r.json();
            if (!j || !j.success) return;
            var items = j.items || [];
            var deleted = 0;
            for (var i = 0; i < items.length; i++) {
                var row = items[i];
                if (!row || !row.title || !row.id) continue;
                if (!Object.prototype.hasOwnProperty.call(BUILTIN_CATEGORIES, row.title)) continue;
                var dr = await fetch('/plonter/api/content_api.php?action=delete', {
                    method: 'POST',
                    headers: hdrs,
                    body: JSON.stringify({ id: row.id })
                });
                try { await dr.json(); } catch (_) {}
                // Drop the local plonter_vocab_v2 entry if a prior pull cached it.
                try {
                    var raw = JSON.parse(localStorage.getItem('plonter_vocab_v2') || '{}');
                    if (Object.prototype.hasOwnProperty.call(raw, row.title)) {
                        delete raw[row.title];
                        localStorage.setItem('plonter_vocab_v2', JSON.stringify(raw));
                    }
                } catch (_) {}
                // Drop any stale sync meta entry so ContentSync stops tracking it.
                try {
                    var all = JSON.parse(localStorage.getItem('plonter_sync_meta') || '{}');
                    delete all['vocab_category:' + row.title];
                    localStorage.setItem('plonter_sync_meta', JSON.stringify(all));
                } catch (_) {}
                deleted++;
            }
            localStorage.setItem(CLEANUP_FLAG, '1');
            if (deleted > 0) console.log('[VocabSync] cleaned ' + deleted + ' legacy BUILTIN rows from server');
        } catch (e) {
            console.warn('[VocabSync] BUILTIN cleanup failed', e);
        }
    }

    function _register() {
        if (typeof ContentSync === 'undefined') return false;
        if (typeof ContentSync.registerModule === 'function') {
            ContentSync.registerModule('vocab_category', _getCategory, _setCategory);
        }
        if (typeof ContentSync.registerLister === 'function') {
            ContentSync.registerLister('vocab_category', _listCategories);
        }
        if (typeof ContentSync.registerPuller === 'function') {
            ContentSync.registerPuller('vocab_category', _pull);
        }
        return true;
    }

    function getBadge(catName) {
        if (typeof ContentSync === 'undefined') return '';
        if (typeof ContentSync.getSyncBadge !== 'function') return '';
        return ContentSync.getSyncBadge('vocab_category', catName);
    }

    function getSyncState(catName) {
        if (typeof ContentSync === 'undefined') return 'unsynced';
        if (typeof ContentSync.getSyncState !== 'function') return 'unsynced';
        return ContentSync.getSyncState('vocab_category', catName);
    }

    function onCategorySaved(catName) {
        if (_isBuiltin(catName)) return;   // BUILTINs never push — Amitai 2026-04-20 13:44
        stampCategory(catName);
        if (typeof ContentSync === 'undefined') return;
        if (typeof ContentSync.save !== 'function') return;
        var item = _getCategory(catName);
        if (!item) return;
        try { ContentSync.save('vocab_category', catName, item); }
        catch (e) { console.warn('[VocabSync] ContentSync.save threw', e); }
    }

    // Called when a category disappears from plonter_vocab_v2 (delete or
    // rename). Drops meta + tells ContentSync to delete the server row.
    // Without this, a deleted category would survive on the server and get
    // pulled back on any other device's next login.
    function onCategoryDeleted(catName) {
        var m = _getMeta();
        delete m[catName];
        _setMeta(m);
        if (typeof ContentSync === 'undefined') return;
        if (typeof ContentSync.deleteItem !== 'function') return;
        try { ContentSync.deleteItem('vocab_category', catName); }
        catch (e) { console.warn('[VocabSync] ContentSync.deleteItem threw', e); }
    }

    function syncAllCategories() {
        if (typeof ContentSync === 'undefined' || typeof ContentSync.syncAll !== 'function') {
            return Promise.resolve({ attempted: 0, succeeded: 0, errors: ['ContentSync not loaded'] });
        }
        return ContentSync.syncAll('vocab_category');
    }

    // Wait for ContentSync + PlonterAuth to come online before registering.
    function _boot() {
        if (!_register()) {
            setTimeout(_boot, 300);
            return;
        }
        // Post-register: run the legacy BUILTIN cleanup once per device.
        // Delay 2s — give auth token + any in-flight pull a beat to settle,
        // and bail silently for guests.
        setTimeout(function() { _cleanupLegacyBuiltinsIfNeeded(); }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }

    return {
        getBadge: getBadge,
        getSyncState: getSyncState,
        onCategorySaved: onCategorySaved,
        onCategoryDeleted: onCategoryDeleted,
        syncAllCategories: syncAllCategories,
        stampCategory: stampCategory
    };
})();
