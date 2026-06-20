/**
 * HindusSync — bridges hindusMode.js tab-based hindus state to ContentSync.
 * Mirrors vocabSync.js / analysesSync.js.
 *
 * Stage 1a (this file): client scaffold only. No script include in
 * index.html yet, no hooks inside hindusMode.js yet. Waiting on @3a's
 * DB schema + content_api.php 'hindus' endpoints.
 *
 * Storage layout (existing, owned by hindusMode.js):
 *   key: plonter_v4_stage_<stageId>_hindus_v2
 *   val: { version: 2, activeTabId, tabs: [{ id, name, savedAt, state }] }
 *
 * ⚠️ Per @4t 2026-04-19: the v2 payload has NO top-level savedAt, only
 * per-tab. So we synthesize a derived `updated` = max(tab.savedAt)
 * for ContentSync. On server pull, the payload is rewritten whole and
 * the synthesized updated is stamped into plonter_hindus_cs_meta so
 * last-write-wins comparisons are stable.
 *
 * Per-item id in ContentSync terms: the stageId (string). One hindus
 * row per stage — tabs are embedded.
 *
 * Flags NOT to sync (per @4t's map 2026-04-19):
 *   - plonter_v4_stage_<id>_hindus_v2_backup_<epoch>  (local undo blobs)
 *   - plonter_v4_stage_<id>_hindus  (legacy v1, read-only migration)
 *   - auth.js _clearUserScopedContent prefix wipe  (local cleanup only)
 */
var HindusSync = (function() {
    'use strict';

    var KEY_PREFIX  = 'plonter_v4_stage_';
    var KEY_SUFFIX  = '_hindus_v2';
    var BACKUP_MARK = '_hindus_v2_backup_';  // skip these
    var META_KEY    = 'plonter_hindus_cs_meta';  // { "<stageId>": iso }
    var BACKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    var MAX_BACKUPS_PER_STAGE = 8;

    function _now() { return new Date().toISOString(); }

    function _getMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
        catch (_) { return {}; }
    }
    function _setMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }

    function _storageKey(stageId) {
        return KEY_PREFIX + stageId + KEY_SUFFIX;
    }

    function _readPayload(stageId) {
        try {
            var raw = localStorage.getItem(_storageKey(stageId));
            if (!raw) return null;
            var p = JSON.parse(raw);
            if (!p || p.version !== 2 || !Array.isArray(p.tabs)) return null;
            return p;
        } catch (_) { return null; }
    }

    function _derivedUpdated(payload) {
        if (!payload || !Array.isArray(payload.tabs)) return null;
        var maxTs = 0;
        for (var i = 0; i < payload.tabs.length; i++) {
            var t = payload.tabs[i];
            if (t && typeof t.savedAt === 'number' && t.savedAt > maxTs) maxTs = t.savedAt;
        }
        return maxTs ? new Date(maxTs).toISOString() : null;
    }

    // Server title is fixed to 'hindus' (per @3a 2026-04-19 16:52 — stage
    // context is carried in source_id, not title; fixed title simplifies
    // server-side grouping + collision checks are irrelevant for 1-per-stage).
    function _itemTitle(stageId) {
        return 'hindus';
    }

    function _getItem(stageId) {
        var payload = _readPayload(stageId);
        if (!payload) return null;
        var meta = _getMeta();
        var updated = _derivedUpdated(payload) || meta[stageId] || _now();
        return {
            id:        String(stageId),
            title:     _itemTitle(stageId),
            source_id: String(stageId),
            updated:   updated,
            data:      payload
        };
    }

    function _setItem(stageId, serverItem) {
        var data = serverItem && serverItem.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
        if (!data || data.version !== 2 || !Array.isArray(data.tabs)) return;
        try {
            localStorage.setItem(_storageKey(stageId), JSON.stringify(data));
            var m = _getMeta();
            m[stageId] = serverItem.updated || _derivedUpdated(data) || _now();
            _setMeta(m);
        } catch (e) {
            console.warn('[HindusSync] _setItem failed', e);
        }
    }

    function _listItems() {
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
                if (k.indexOf(BACKUP_MARK) >= 0) continue;           // skip backups
                if (k.indexOf(KEY_SUFFIX, k.length - KEY_SUFFIX.length) < 0) continue;
                var stageId = k.slice(KEY_PREFIX.length, k.length - KEY_SUFFIX.length);
                if (!stageId) continue;
                var payload = null;
                try { payload = JSON.parse(localStorage.getItem(k)); } catch (_) {}
                if (!payload || payload.version !== 2) continue;
                out.push({
                    id:      stageId,
                    title:   _itemTitle(stageId),
                    updated: _derivedUpdated(payload)
                });
            }
        } catch (_) {}
        return out;
    }

    function _validStageIds() {
        var ids = {};
        try {
            if (typeof getAllStages === 'function') {
                getAllStages().forEach(function(s) { if (s && s.id) ids[String(s.id)] = true; });
                return ids;
            }
        } catch (_) {}
        try {
            if (typeof getCustomStages === 'function') {
                getCustomStages().forEach(function(s) { if (s && s.id) ids[String(s.id)] = true; });
            }
            if (typeof STAGES !== 'undefined') {
                ['workbook', 'midterm', 'hindus', 'persian'].forEach(function(bucket) {
                    var arr = STAGES[bucket];
                    if (!Array.isArray(arr)) return;
                    arr.forEach(function(s) { if (s && s.id) ids[String(s.id)] = true; });
                });
            }
        } catch (_) {}
        return ids;
    }

    function cleanupLocalStorage() {
        var validIds = _validStageIds();
        var now = Date.now();
        var backupsByStage = {};
        var remove = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
                if (k.indexOf('guest_backup_') >= 0) continue;
                var isV2 = k.indexOf(KEY_SUFFIX, k.length - KEY_SUFFIX.length) >= 0;
                var isBackup = k.indexOf(BACKUP_MARK) >= 0;
                if (!isV2 && !isBackup) continue;
                var stageId = '';
                if (isBackup) {
                    var parts = k.split(BACKUP_MARK);
                    stageId = parts[0].slice(KEY_PREFIX.length);
                    var ts = parseInt(parts[1], 10);
                    if (!ts || now - ts > BACKUP_TTL_MS) {
                        remove.push(k);
                        continue;
                    }
                    if (!backupsByStage[stageId]) backupsByStage[stageId] = [];
                    backupsByStage[stageId].push({ key: k, ts: ts });
                } else {
                    stageId = k.slice(KEY_PREFIX.length, k.length - KEY_SUFFIX.length);
                }
                if (stageId && Object.keys(validIds).length && !validIds[stageId]) remove.push(k);
            }
            Object.keys(backupsByStage).forEach(function(stageId) {
                var arr = backupsByStage[stageId].sort(function(a, b) { return b.ts - a.ts; });
                for (var j = MAX_BACKUPS_PER_STAGE; j < arr.length; j++) remove.push(arr[j].key);
            });
            remove.forEach(function(k) { try { localStorage.removeItem(k); } catch (_) {} });
            return { removed: remove.length };
        } catch (e) {
            console.warn('[HindusSync] cleanupLocalStorage failed', e);
            return { removed: 0, error: e && e.message || String(e) };
        }
    }

    function stampStage(stageId) {
        var m = _getMeta();
        m[stageId] = _now();
        _setMeta(m);
    }

    // Call site for hindusMode.js:_persistHindus — after localStorage.setItem lands.
    function onStageSaved(stageId) {
        stampStage(stageId);
        if (typeof ContentSync === 'undefined' || typeof ContentSync.save !== 'function') return;
        var item = _getItem(stageId);
        if (!item) return;
        try {
            ContentSync.save('hindus', String(stageId), item);
            if (typeof ContentSync.processQueue === 'function') {
                ContentSync.processQueue();
            }
        }
        catch (e) { console.warn('[HindusSync] ContentSync.save threw', e); }
    }

    // Call site for hindusMode.js:clearHindus.
    function onStageDeleted(stageId) {
        var m = _getMeta();
        delete m[stageId];
        _setMeta(m);
        if (typeof ContentSync === 'undefined' || typeof ContentSync.deleteItem !== 'function') return;
        try { ContentSync.deleteItem('hindus', String(stageId)); }
        catch (e) { console.warn('[HindusSync] ContentSync.deleteItem threw', e); }
    }

    // Call site for hindusMode.js:restoreBackup — treat as a save.
    function onStageRestored(stageId) { onStageSaved(stageId); }

    function getBadge(stageId) {
        if (typeof ContentSync === 'undefined') return '';
        if (typeof ContentSync.getSyncBadge !== 'function') return '';
        return ContentSync.getSyncBadge('hindus', String(stageId));
    }

    function getSyncState(stageId) {
        if (typeof ContentSync === 'undefined') return 'unsynced';
        if (typeof ContentSync.getSyncState !== 'function') return 'unsynced';
        return ContentSync.getSyncState('hindus', String(stageId));
    }

    function syncAllStages() {
        if (typeof ContentSync === 'undefined' || typeof ContentSync.syncAll !== 'function') {
            return Promise.resolve({ attempted: 0, succeeded: 0, errors: ['ContentSync not loaded'] });
        }
        return ContentSync.syncAll('hindus');
    }

    // SAVE_CONTRACT Phase 1 — feed local guest-mode hindus stages into the
    // unified migration popup on login. ContentSync.checkMigration internally
    // filters by per-item backup_state ('backed_up'/'handled'/'deleted'
    // suppress) and by global getSyncState('hindus', id) !== 'unsynced', so
    // we pass the full local list each call and let ContentSync decide what
    // re-prompts. Stable id = stageId (string), matching `_listItems` and
    // `_getItem`. Empty / never-touched stages are skipped client-side so the
    // popup never offers "back up an empty drawer".
    function _collectMigrationItems() {
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
                if (k.indexOf(BACKUP_MARK) >= 0) continue;             // skip undo blobs
                if (k.indexOf(KEY_SUFFIX, k.length - KEY_SUFFIX.length) < 0) continue;
                var stageId = k.slice(KEY_PREFIX.length, k.length - KEY_SUFFIX.length);
                if (!stageId) continue;
                var payload = null;
                try { payload = JSON.parse(localStorage.getItem(k)); } catch (_) {}
                if (!payload || payload.version !== 2 || !Array.isArray(payload.tabs)) continue;
                // Skip stages that hold no real work yet — no slot ever
                // filled and no tag ever applied across any tab. Prevents
                // a "back up nothing" entry from showing up after a stray
                // _persistHindus call wrote a blank scaffold.
                var hasContent = payload.tabs.some(function(t) {
                    if (!t || !t.state) return false;
                    var slots = t.state.slots;
                    var tags = t.state.wordTags;
                    if (Array.isArray(slots) && slots.some(function(x) { return x !== null && x !== undefined; })) return true;
                    if (tags && Object.keys(tags).length > 0) return true;
                    return false;
                });
                if (!hasContent) continue;
                out.push({
                    type:          'hindus',
                    id:            String(stageId),
                    title:         _itemTitle(stageId),
                    data:          payload,
                    source_id:     String(stageId),
                    source_domain: 'hindus',
                    updated:       _derivedUpdated(payload)
                });
            }
        } catch (e) {
            console.warn('[HindusSync] _collectMigrationItems scan failed', e);
        }
        return out;
    }

    function _onLoginCheckMigration() {
        if (typeof ContentSync === 'undefined' ||
            typeof ContentSync.checkMigration !== 'function') return;
        var items = _collectMigrationItems();
        if (!items.length) return;
        try { ContentSync.checkMigration('hindus', items); }
        catch (e) { console.warn('[HindusSync] ContentSync.checkMigration threw', e); }
    }

    // Register on PlonterAuth.onLogin once PlonterAuth is available. Mirror
    // the 1500ms delay used in auth.js _stashCurrentGuestWorkForPrompts so
    // ContentSync's pullAll('hindus') and registerPuller have settled before
    // we diff local vs server. PlonterAuth.onLogin auto-replays for an
    // already-signed-in user, so cold-loading the script after login still
    // triggers the migration check on next pageload.
    function _registerLoginHook() {
        if (typeof PlonterAuth === 'undefined' || typeof PlonterAuth.onLogin !== 'function') return false;
        PlonterAuth.onLogin(function() {
            setTimeout(_onLoginCheckMigration, 1500);
        });
        return true;
    }

    // Custom puller — hindus is 1-per-stage so we pull via source_id and
    // write directly to the per-stage localStorage key.
    async function _pull(ctx) {
        var api = ctx && ctx.api;
        var setItemMeta = ctx && ctx.setItemMeta;
        if (typeof api !== 'function') return { loaded: 0, error: 'no api' };
        var res = await api('list', { content_type: 'hindus' });
        if (!res || !res.success) return { loaded: 0, error: (res && res.error) || 'list failed' };
        var items = res.items || [];
        var loaded = 0;
        for (var i = 0; i < items.length; i++) {
            var srv = items[i];
            if (!srv || !srv.source_id) continue;
            var stageId = String(srv.source_id);
            _setItem(stageId, srv);
            if (typeof setItemMeta === 'function') {
                setItemMeta('hindus', stageId, {
                    synced: true,
                    serverId: srv.id,
                    lastServerUpdated: srv.updated
                });
            }
            loaded++;
        }
        return { loaded: loaded, serverCount: items.length };
    }

    function _register() {
        if (typeof ContentSync === 'undefined') return false;
        if (typeof ContentSync.registerModule === 'function') {
            ContentSync.registerModule('hindus', _getItem, _setItem);
        }
        if (typeof ContentSync.registerLister === 'function') {
            ContentSync.registerLister('hindus', _listItems);
        }
        if (typeof ContentSync.registerPuller === 'function') {
            ContentSync.registerPuller('hindus', _pull);
        }
        return true;
    }

    function _boot() {
        if (!_register()) {
            setTimeout(_boot, 300);
        } else {
            cleanupLocalStorage();
        }
    }

    // Separate retry loop for the PlonterAuth.onLogin registration so the
    // ContentSync boot path stays untouched. Both can independently retry
    // until their dependency loads.
    function _bootLoginHook() {
        if (!_registerLoginHook()) setTimeout(_bootLoginHook, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
        document.addEventListener('DOMContentLoaded', _bootLoginHook);
    } else {
        _boot();
        _bootLoginHook();
    }

    return {
        getBadge:         getBadge,
        getSyncState:     getSyncState,
        stampStage:       stampStage,
        onStageSaved:     onStageSaved,
        onStageDeleted:   onStageDeleted,
        onStageRestored:  onStageRestored,
        cleanupLocalStorage: cleanupLocalStorage,
        syncAllStages:    syncAllStages,
        // SAVE_CONTRACT Phase 1 — test-only hooks. Console call:
        //   HindusSync._collectMigrationItems()     // see what would be sent
        //   HindusSync._promptGuestHindusOnLogin()  // fire the check now
        _collectMigrationItems:        _collectMigrationItems,
        _promptGuestHindusOnLogin:     _onLoginCheckMigration
    };
})();
