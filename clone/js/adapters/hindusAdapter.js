// hindusAdapter — SAVE_CONTRACT Phase 3 adapter for type='hindus'.
//
// Owns the localStorage write path + ContentSync dispatch for one hindus
// stage at a time. hindusMode.js routes its flushPersist() through
// HindusAdapter.save(stageId, payload); the adapter writes the v2 payload
// to plonter_v4_stage_<id>_hindus_v2 and immediately calls
// ContentSync.save('hindus', stageId, item) + processQueue() to preserve
// the A→B→A loss-prevention guarantee from Amitai insight 2026-05-08T23:02
// (without the immediate processQueue, switching stages while the previous
// stage's save is still queued can lose data).
//
// Stable id = String(stageId) everywhere (per @6m חוק 2). Title is fixed
// to 'hindus' to match hindusSync._itemTitle (one row per stage; stage
// context is carried in source_id, not title).
//
// AdapterBase gap (flagged for @3): AdapterBase's default onMount calls
// ContentSync.registerModule(type, { get: adapter.get, list: adapter.list })
// — i.e. passes an OBJECT as the second positional argument. The actual
// ContentSync.registerModule signature is (contentType, getter, setter)
// where both must be functions. Storing the object as `_moduleGetters[type]`
// breaks every later `getter(localId)` call. We work around it here by
// providing a custom onMount that calls registerModule with the correct
// (getter, setter) functions. The same gap likely affects lessonsAdapter;
// flagged in /tmp/plonter_hindus_phase3_report.md for @3 to fix in
// AdapterBase.js so future adapters don't need this workaround.
(function() {
    'use strict';

    if (typeof window === 'undefined') return;

    var KEY_PREFIX  = 'plonter_v4_stage_';
    var KEY_SUFFIX  = '_hindus_v2';
    var BACKUP_MARK = '_hindus_v2_backup_';
    var META_KEY    = 'plonter_hindus_cs_meta';

    function _key(stageId) {
        return KEY_PREFIX + String(stageId) + KEY_SUFFIX;
    }

    function _now() { return new Date().toISOString(); }

    function _derivedUpdated(payload) {
        if (!payload || !Array.isArray(payload.tabs)) return null;
        var maxTs = 0;
        for (var i = 0; i < payload.tabs.length; i++) {
            var t = payload.tabs[i];
            if (t && typeof t.savedAt === 'number' && t.savedAt > maxTs) maxTs = t.savedAt;
        }
        return maxTs ? new Date(maxTs).toISOString() : null;
    }

    function _readPayload(stageId) {
        try {
            var raw = localStorage.getItem(_key(stageId));
            if (!raw) return null;
            var p = JSON.parse(raw);
            if (!p || p.version !== 2 || !Array.isArray(p.tabs)) return null;
            return p;
        } catch (_) { return null; }
    }

    function _readMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
        catch (_) { return {}; }
    }
    function _writeMeta(m) {
        try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (_) {}
    }

    // The wrapped item shape that ContentSync receives. Mirrors
    // hindusSync._getItem so server-side rows don't change format between
    // the legacy hindusSync route and the Phase 3 adapter route.
    function _buildItem(stageId, payload) {
        var meta = _readMeta();
        var updated = _derivedUpdated(payload) || meta[stageId] || _now();
        return {
            id:        String(stageId),
            title:     'hindus',
            source_id: String(stageId),
            updated:   updated,
            data:      payload
        };
    }

    // Adapter contract methods.

    function _load(id) {
        return _readPayload(String(id));
    }

    function _list() {
        // Reuse hindusSync._collectMigrationItems when available so the
        // empty-content filter (no slots placed, no tags applied) stays in
        // exactly one place. Fall back to a local scan otherwise.
        if (typeof HindusSync !== 'undefined' &&
            typeof HindusSync._collectMigrationItems === 'function') {
            try { return HindusSync._collectMigrationItems(); }
            catch (e) { console.warn('[HindusAdapter] HindusSync._collectMigrationItems threw', e); }
        }
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
                if (k.indexOf(BACKUP_MARK) >= 0) continue;
                if (k.indexOf(KEY_SUFFIX, k.length - KEY_SUFFIX.length) < 0) continue;
                var stageId = k.slice(KEY_PREFIX.length, k.length - KEY_SUFFIX.length);
                if (!stageId) continue;
                var p = null;
                try { p = JSON.parse(localStorage.getItem(k)); } catch (_) {}
                if (!p || p.version !== 2 || !Array.isArray(p.tabs)) continue;
                out.push({
                    id:            String(stageId),
                    title:         'hindus',
                    source_id:     String(stageId),
                    source_domain: 'hindus',
                    updated:       _derivedUpdated(p),
                    data:          p
                });
            }
        } catch (e) {
            console.warn('[HindusAdapter] _list scan failed', e);
        }
        return out;
    }

    function _save(id, data) {
        if (!id) return Promise.resolve(false);
        if (!data || data.version !== 2 || !Array.isArray(data.tabs)) {
            console.warn('[HindusAdapter] save called with non-v2 payload; refusing');
            return Promise.resolve(false);
        }
        var stageId = String(id);
        // Synchronous localStorage write FIRST. The immediate write is the
        // crash-safe layer: even if the page closes before the network call
        // finishes, the next session's HindusMode.activate will read back
        // the same payload.
        try {
            localStorage.setItem(_key(stageId), JSON.stringify(data));
        } catch (e) {
            console.warn('[HindusAdapter] localStorage.setItem failed', e);
            return Promise.reject(e);
        }
        // Stamp the cs-meta so derived `updated` agrees with hindusSync's
        // legacy timestamps even when no tab.savedAt is set yet.
        try {
            var m = _readMeta();
            m[stageId] = _derivedUpdated(data) || _now();
            _writeMeta(m);
        } catch (_) {}
        // Then dispatch to ContentSync. The immediate processQueue() is the
        // A→B→A loss-prevention path: if the user navigates away from this
        // stage before the queued save lands, the next stage's flushPersist
        // would otherwise overwrite the queue head.
        var cs = window.ContentSync;
        if (!cs || typeof cs.save !== 'function') return Promise.resolve(true);
        var item = _buildItem(stageId, data);
        try {
            cs.save('hindus', stageId, item);
            if (typeof cs.processQueue === 'function') cs.processQueue();
        } catch (e) {
            console.warn('[HindusAdapter] ContentSync.save threw', e);
            return Promise.reject(e);
        }
        return Promise.resolve(true);
    }

    function _delete(id) {
        var stageId = String(id);
        try { localStorage.removeItem(_key(stageId)); } catch (_) {}
        try {
            var m = _readMeta();
            if (m[stageId]) { delete m[stageId]; _writeMeta(m); }
        } catch (_) {}
        var cs = window.ContentSync;
        if (!cs) return Promise.resolve(false);
        var fn = (typeof cs['delete'] === 'function' ? cs['delete'] :
                 (typeof cs.deleteItem === 'function' ? cs.deleteItem : null));
        if (!fn) return Promise.resolve(false);
        try { return Promise.resolve(fn('hindus', stageId)); }
        catch (e) {
            console.warn('[HindusAdapter] ContentSync.delete threw', e);
            return Promise.reject(e);
        }
    }

    function _findCardForId(id) {
        var safe = String(id).replace(/["\\]/g, '\\$&');
        try { return document.querySelector('[data-stage-id="' + safe + '"]'); }
        catch (_) { return null; }
    }

    // Custom onMount that calls registerModule with the proper
    // (contentType, getter, setter) signature instead of AdapterBase's
    // default `{get, list}` object form (see AdapterBase gap note at the
    // top of this file). registerLister + onSyncStateChange use the same
    // wiring AdapterBase's default does.
    function _customOnMount(adapter) {
        var cs = window.ContentSync;
        if (!cs) {
            console.warn('[HindusAdapter] ContentSync not available at mount; retrying');
            setTimeout(function() { _customOnMount(adapter); }, 300);
            return;
        }
        // Lister — list() returns an array of items for the migration popup
        // + pullAll().
        if (typeof cs.registerLister === 'function') {
            try { cs.registerLister('hindus', adapter.list); }
            catch (e) { console.warn('[HindusAdapter] registerLister threw', e); }
        }
        // Module getter/setter pair. Getter wraps adapter.load + the item
        // envelope (so server-bound payloads carry source_id + updated).
        // Setter writes server payloads back to local storage and refreshes
        // the meta timestamp.
        if (typeof cs.registerModule === 'function') {
            var getter = function(stageId) {
                var payload = adapter.load(stageId);
                if (!payload) return null;
                return _buildItem(stageId, payload);
            };
            var setter = function(stageId, serverItem) {
                var data = serverItem && serverItem.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (_) { data = null; }
                }
                if (!data || data.version !== 2 || !Array.isArray(data.tabs)) return;
                try {
                    localStorage.setItem(_key(stageId), JSON.stringify(data));
                    var m = _readMeta();
                    m[stageId] = serverItem.updated || _derivedUpdated(data) || _now();
                    _writeMeta(m);
                } catch (e) {
                    console.warn('[HindusAdapter] setter failed', e);
                }
            };
            try { cs.registerModule('hindus', getter, setter); }
            catch (e) { console.warn('[HindusAdapter] registerModule threw', e); }
        }
        // Sync-state fan-out → renderCardState on the matching card.
        if (typeof cs.onSyncStateChange === 'function') {
            adapter._unsubscribe = cs.onSyncStateChange(function(t, id, state) {
                if (t !== 'hindus') return;
                var card = adapter.findCardForId(id);
                if (!card) return;
                try { adapter.renderCardState(card, state); }
                catch (e) { console.warn('[HindusAdapter] renderCardState threw', e); }
            });
        }
        adapter._mounted = true;
    }

    function _boot() {
        if (typeof window.AdapterBase !== 'function') {
            setTimeout(_boot, 300);
            return;
        }
        var adapter = window.AdapterBase({
            type:           'hindus',
            list:           _list,
            load:           _load,
            get:            _load,
            save:           _save,
            'delete':       _delete,
            findCardForId:  _findCardForId,
            onMount: function() { _customOnMount(adapter); }
        });
        window.HindusAdapter = adapter;
        adapter.onMount();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }
})();
