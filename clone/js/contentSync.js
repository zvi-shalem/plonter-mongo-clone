/**
 * ContentSync — Transparent sync layer for Plonter modules
 * Each module (lessons, texts, analysis, hindus) calls ContentSync to save/load.
 * Saves locally first (offline-first), syncs to server when logged in.
 * Handles conflict detection with comparison popup.
 *
 * Usage:
 *   ContentSync.save('lesson', lessonId, lessonData);
 *   ContentSync.load('lesson', lessonId) → data or null
 *   ContentSync.listAll('lesson') → [{id, title, synced, updated}]
 *   ContentSync.isSynced('lesson', lessonId) → true/false
 *   ContentSync.syncAll('lesson') → syncs all unsynced items of type
 */

var ContentSync = (function() {
    'use strict';

    var API = '/plonter/api/content_api.php';
    var SYNC_META_KEY = 'plonter_sync_meta'; // tracks sync state per item
    var SYNC_QUEUE_KEY = 'plonter_sync_queue'; // pending uploads

    // Maps a contentType to the localStorage key its module stores items
    // under. Needed so pullAll and the rename path in _syncItem can work
    // against texts/analyses/hindus without hard-coding 'plonter_lessons'.
    var _storageKeys = { lesson: 'plonter_lessons' };
    var _pendingDeletes = 0;

    function _setPendingDeleteDelta(delta) {
        _pendingDeletes = Math.max(0, _pendingDeletes + delta);
        _fireChange('pending-delete', null);
    }

    function hasPendingDeletes() {
        return _pendingDeletes > 0;
    }

    window.addEventListener('beforeunload', function(e) {
        if (!hasPendingDeletes()) return;
        e.preventDefault();
        e.returnValue = '';
    });

    function registerStorageKey(contentType, storageKey) {
        _storageKeys[contentType] = storageKey;
    }

    // --- Auth integration ---

    function _getToken() {
        return localStorage.getItem('plonter_auth_token') || '';
    }

    function _isLoggedIn() {
        return !!_getToken();
    }

    // --- API calls ---

    async function _api(action, body) {
        var token = _getToken();
        if (!token) return { success: false, error: 'לא מחובר' };

        try {
            var res = await fetch(API + '?action=' + action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify(body || {})
            });
            return await res.json();
        } catch (e) {
            return { success: false, error: 'שגיאת תקשורת', offline: true };
        }
    }

    // --- Sync metadata ---

    function _getMeta() {
        try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}'); } catch(e) { return {}; }
    }

    function _setMeta(meta) {
        localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
    }

    function _getItemMeta(contentType, localId) {
        var meta = _getMeta();
        var key = contentType + ':' + localId;
        return meta[key] || null;
    }

    // Merge fields into an item's sync metadata. Callers previously
    // clobbered the whole meta on success (losing localUpdated), which made
    // _pollLessonsForChanges flip the item back to unsynced every 5s.
    function _setItemMeta(contentType, localId, data) {
        var meta = _getMeta();
        var key = contentType + ':' + localId;
        var prev = meta[key] || {};
        meta[key] = Object.assign({}, prev, data || {});
        _setMeta(meta);
        _fireChange(contentType, localId);
    }

    function _parseDataMaybe(data) {
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (_) { return data; }
        }
        return data;
    }

    function _stableClone(value) {
        value = _parseDataMaybe(value);
        if (Array.isArray(value)) return value.map(_stableClone);
        if (value && typeof value === 'object') {
            var out = {};
            Object.keys(value).sort().forEach(function(k) {
                if (k === 'id' || k === 'local_id' || k === 'serverId' || k === 'meta' ||
                    k === 'updated' || k === 'lastAccessed' || k === 'stashedAt') return;
                out[k] = _stableClone(value[k]);
            });
            return out;
        }
        return value;
    }

    function _samePayload(a, b) {
        try { return JSON.stringify(_stableClone(a)) === JSON.stringify(_stableClone(b)); }
        catch (_) { return false; }
    }

    // BUG 8 — a stable content fingerprint used as the cross-device conflict
    // baseline. It hashes the SAME normalized shape _samePayload compares
    // (_stableClone strips id/updated/timestamps), so two devices that hold
    // identical content produce identical hashes regardless of the server's
    // datetime('now') format vs. our toISOString — which is exactly why a raw
    // `updated`-string compare false-positives and a hash does not. Stored in
    // meta.lastSyncedHash on every successful reconcile (pull/push/adopt).
    function _payloadHash(value) {
        try {
            value = _parseDataMaybe(value);
            var inner = (value && typeof value === 'object' && value.data !== undefined) ? value.data : value;
            var str = JSON.stringify(_stableClone(inner));
            var h = 5381;
            for (var i = 0; i < str.length; i++) { h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0; }
            return h.toString(36) + ':' + str.length;
        } catch (_) { return ''; }
    }

    function _textCorePayload(item) {
        item = _parseDataMaybe(item && (item.data || item));
        if (!item || typeof item !== 'object') return null;
        return {
            title: item.title || '',
            desc: item.desc || item.description || '',
            content: item.content || item.text || '',
            drawings: item.drawings || []
        };
    }

    function _sameTextCorePayload(a, b) {
        try {
            var aa = _textCorePayload(a);
            var bb = _textCorePayload(b);
            if (!aa || !bb) return false;
            return JSON.stringify(aa) === JSON.stringify(bb);
        }
        catch (_) { return false; }
    }

    function _hasMeaningfulPayload(item) {
        item = _parseDataMaybe(item && (item.data || item));
        if (!item || typeof item !== 'object') return false;
        var text = String(item.content || item.text || item.sentence || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text) return true;
        if (item.drawings && item.drawings.length) return true;
        if (item.pages && item.pages.length) return true;
        return !!(item.title || item.number || item.name);
    }

    function _fireChange(contentType, localId) {
        try {
            document.dispatchEvent(new CustomEvent('contentsync:change', {
                detail: { contentType: contentType, localId: localId }
            }));
        } catch(e) {}
        // SAVE_CONTRACT Phase 3 — emit normalized state to adapter subscribers
        // registered via ContentSync.onSyncStateChange. Signature:
        // cb(contentType, localId, state) where state ∈
        // 'unsynced'|'backing_up'|'backed_up'.
        try {
            if (!_syncStateSubscribers || _syncStateSubscribers.length === 0) return;
            var state = getNormalizedSyncState(contentType, localId);
            for (var i = 0; i < _syncStateSubscribers.length; i++) {
                try { _syncStateSubscribers[i](contentType, localId, state); }
                catch (e) { console.warn('[ContentSync] subscriber threw', e); }
            }
        } catch (_) {}
    }

    // SAVE_CONTRACT Phase 3 — subscriber list for normalized sync-state events.
    // Adapters call ContentSync.onSyncStateChange(cb) to receive
    // (type, id, state) on every meta change. Returns an unsubscribe function.
    var _syncStateSubscribers = [];
    function onSyncStateChange(cb) {
        if (typeof cb !== 'function') return function() {};
        _syncStateSubscribers.push(cb);
        return function unsubscribe() {
            var idx = _syncStateSubscribers.indexOf(cb);
            if (idx >= 0) _syncStateSubscribers.splice(idx, 1);
        };
    }
    // Map internal three-state ('synced'|'pending'|'unsynced') to the
    // SAVE_CONTRACT four-state machine ('unsynced'|'backing_up'|'backed_up'
    // |'failed'). 'failed' is not yet emitted by the current engine — when
    // the retry path lands it should call this helper instead of fabricating.
    function getNormalizedSyncState(contentType, localId) {
        var s = getSyncState(contentType, localId);
        if (s === 'synced') return 'backed_up';
        if (s === 'pending') return 'backing_up';
        return 'unsynced';
    }

    // --- Sync queue (for offline → online) ---

    function _getQueue() {
        try { return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]'); } catch(e) { return []; }
    }

    function _addToQueue(contentType, localId, action) {
        var queue = _getQueue();
        // Deduplicate: remove existing entry for same item
        queue = queue.filter(function(q) { return !(q.type === contentType && q.localId === localId); });
        queue.push({ type: contentType, localId: localId, action: action, queued: new Date().toISOString() });
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    }

    function _removeFromQueue(contentType, localId) {
        var queue = _getQueue().filter(function(q) { return !(q.type === contentType && q.localId === localId); });
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    }

    // --- Conflict resolution popup ---

    function _showConflictDialog(contentType, localItem, serverItem) {
        return new Promise(function(resolve) {
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:100001;display:flex;align-items:center;justify-content:center';

            var localDate = localItem.updated || localItem.created || '—';
            var serverDate = serverItem.updated || serverItem.created || '—';
            var localPreview = (typeof localItem.data === 'object' && localItem.data.text) ? localItem.data.text.substring(0, 100) : JSON.stringify(localItem.data || {}).substring(0, 100);
            var serverPreview = (typeof serverItem.data === 'object' && serverItem.data.text) ? serverItem.data.text.substring(0, 100) : JSON.stringify(serverItem.data || {}).substring(0, 100);

            overlay.innerHTML =
                '<div style="background:white;border-radius:16px;width:90%;max-width:600px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);direction:rtl">' +
                    '<div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#fef3c7;border-radius:16px 16px 0 0">' +
                        '<h2 style="font-size:16px;margin:0;color:#92400e">⚠️ נמצא קונפליקט — "' + (localItem.title || serverItem.title || '') + '"</h2>' +
                        '<p style="font-size:13px;color:#92400e;margin:4px 0 0">הגרסה המקומית שונה מהגרסה בשרת. בחר מה לעשות:</p>' +
                    '</div>' +
                    '<div style="padding:20px;display:flex;gap:16px;flex-wrap:wrap">' +
                        '<div style="flex:1;min-width:220px;border:2px solid #f59e0b;border-radius:10px;padding:12px">' +
                            '<div style="font-weight:700;margin-bottom:4px;color:#f59e0b">📱 גרסה מקומית</div>' +
                            '<div style="font-size:12px;color:#64748b">עודכן: ' + localDate + '</div>' +
                            '<div style="font-size:13px;margin-top:8px;color:#475569;max-height:80px;overflow:hidden">' + localPreview + '</div>' +
                        '</div>' +
                        '<div style="flex:1;min-width:220px;border:2px solid #0d9488;border-radius:10px;padding:12px">' +
                            '<div style="font-weight:700;margin-bottom:4px;color:#0d9488">☁️ גרסה בשרת</div>' +
                            '<div style="font-size:12px;color:#64748b">עודכן: ' + serverDate + '</div>' +
                            '<div style="font-size:13px;margin-top:8px;color:#475569;max-height:80px;overflow:hidden">' + serverPreview + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="padding:16px 20px;border-top:1px solid #e2e8f0;display:flex;gap:8px;flex-wrap:wrap">' +
                        '<button id="cs-keep-local" style="padding:10px 16px;background:#f59e0b;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px">שמור מקומית (דרוס שרת)</button>' +
                        '<button id="cs-keep-server" style="padding:10px 16px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px">טען מהשרת (דרוס מקומי)</button>' +
                        '<button id="cs-keep-both" style="padding:10px 16px;background:#e2e8f0;color:#475569;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px">שמור שניהם (שכפול)</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            document.getElementById('cs-keep-local').onclick = function() { overlay.remove(); resolve('local'); };
            document.getElementById('cs-keep-server').onclick = function() { overlay.remove(); resolve('server'); };
            document.getElementById('cs-keep-both').onclick = function() { overlay.remove(); resolve('both'); };
        });
    }

    // --- Core sync operations ---

    /**
     * Save an item locally and queue for server sync.
     * @param {string} contentType - 'lesson', 'analysis', 'text', 'engineering'
     * @param {string} localId - local identifier (e.g. lesson.id)
     * @param {object} itemData - full item data { title, data, color, ... }
     */
    function save(contentType, localId, itemData) {
        // Track the content's own last-updated timestamp (the module writes
        // it to its own storage; we mirror it here for poll-based change
        // detection). Don't fabricate a new timestamp — using `new Date()`
        // here would diverge from the stored lesson.updated and make the
        // poll re-queue saves in a loop.
        var stamp = (itemData && itemData.updated) || new Date().toISOString();

        // Enqueue before _setItemMeta so the contentsync:change event
        // (fired inside _setItemMeta) re-renders with the item already in
        // the queue — getSyncBadge then shows "מגבה…" pulsing green instead
        // of flashing yellow "לא מגובה" during the 2s debounce window.
        if (_isLoggedIn()) {
            _addToQueue(contentType, localId, 'auto-save');
        }

        _setItemMeta(contentType, localId, {
            synced: false,
            localUpdated: stamp
        });

        if (_isLoggedIn()) {
            _debouncedProcessQueue();
        }
    }

    /**
     * Check if an item is synced to server.
     */
    function isSynced(contentType, localId) {
        var meta = _getItemMeta(contentType, localId);
        return meta ? !!meta.synced : false;
    }

    /**
     * Return 'synced' (server-acked), 'pending' (queued/syncing), or
     * 'unsynced' (guest mode or no queue entry). Callers can use this to
     * render a three-state UI — e.g. pulsing green border while syncing,
     * yellow dashed while truly unsynced.
     */
    function getSyncState(contentType, localId) {
        var meta = _getItemMeta(contentType, localId);
        if (meta && meta.synced) return 'synced';
        if (!_isLoggedIn()) return 'unsynced';
        try {
            var queue = _getQueue();
            for (var i = 0; i < queue.length; i++) {
                if (queue[i].type === contentType && String(queue[i].localId) === String(localId)) return 'pending';
            }
        } catch (_) {}
        return 'unsynced';
    }

    /**
     * Get sync status badge HTML for UI integration.
     */
    function getSyncBadge(contentType, localId) {
        if (!_isLoggedIn()) {
            return '<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;border:1px dashed #f59e0b">לא מגובה</span>';
        }
        var meta = _getItemMeta(contentType, localId);
        if (meta && meta.synced) {
            return '<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7">מגובה ☁️</span>';
        }
        // Logged in, not yet synced — distinguish "pending push" (item
        // already queued, just waiting for debounce + network) from "truly
        // unsynced" (not in queue, e.g. first save before auto-sync hooked
        // up). The pending variant shows pulsing green so the user isn't
        // scared by the yellow "לא מגובה" flash right after creation.
        try {
            var queue = _getQueue();
            var inQueue = queue.some(function(e) { return e.type === contentType && String(e.localId) === String(localId); });
            if (inQueue) {
                return '<span class="cs-badge-pending" style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;animation:cs-pulse 1.1s ease-in-out infinite">בתהליך גיבוי... ☁️</span>';
            }
        } catch (_) {}
        return '<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;border:1px dashed #f59e0b">לא מגובה ⚠️</span>';
    }

    // Inject the pulsing keyframes once: cs-pulse for the small "מגבה…"
    // badge, cs-card-pulse for the whole lesson card's border + background
    // while a push is pending (broader visual than the tiny badge).
    (function _injectPulseKeyframes() {
        if (document.getElementById('cs-pulse-style')) return;
        var s = document.createElement('style');
        s.id = 'cs-pulse-style';
        s.textContent =
            '@keyframes cs-pulse { 0%,100%{background:#d1fae5;border-color:#6ee7b7}50%{background:#a7f3d0;border-color:#34d399} } ' +
            '@keyframes cs-card-pulse { 0%,100%{border-color:#6ee7b7;background:#ecfdf5;box-shadow:0 0 0 0 rgba(110,231,183,0)}50%{border-color:#34d399;background:#d1fae5;box-shadow:0 0 0 4px rgba(52,211,153,0.18)} }';
        (document.head || document.documentElement).appendChild(s);
    })();

    // --- Queue processing ---

    var _syncTimer = null;

    function _debouncedProcessQueue() {
        clearTimeout(_syncTimer);
        _syncTimer = setTimeout(_processQueue, 2000); // 2 second debounce
    }

    async function _processQueue() {
        if (!_isLoggedIn()) return;

        var queue = _getQueue();
        if (!queue.length) { _clearOfflineRetry(); return; }

        var sawOffline = false;
        for (var i = 0; i < queue.length; i++) {
            var entry = queue[i];
            var r = await _syncItem(entry.type, entry.localId, entry.action);
            if (r && r.offline) sawOffline = true;
        }

        // Bug #10 — if any item failed because we're offline/weak-connection,
        // surface a small "לא סונכרן — ננסה שוב" indicator and schedule an
        // automatic retry (also retries immediately when the browser fires an
        // 'online' event). On a fully drained queue, clear the indicator.
        if (sawOffline && _getQueue().length) {
            _scheduleOfflineRetry();
        } else if (!_getQueue().length) {
            _clearOfflineRetry();
        }
    }

    // --- Bug #10: offline retry + indicator ---
    var _offlineRetryTimer = null;
    var _offlineRetryAttempts = 0;
    var _onlineListenerAdded = false;
    var OFFLINE_MAX_DELAY = 60000; // cap backoff at 60s

    function _scheduleOfflineRetry() {
        _showOfflineIndicator();
        if (typeof window !== 'undefined' && !_onlineListenerAdded && window.addEventListener) {
            _onlineListenerAdded = true;
            window.addEventListener('online', function() {
                _offlineRetryAttempts = 0;
                _processQueue();
            });
        }
        if (_offlineRetryTimer) return; // a retry is already pending
        var delay = Math.min(OFFLINE_MAX_DELAY, 5000 * Math.pow(2, _offlineRetryAttempts));
        _offlineRetryAttempts++;
        _offlineRetryTimer = setTimeout(function() {
            _offlineRetryTimer = null;
            _processQueue();
        }, delay);
    }

    function _clearOfflineRetry() {
        if (_offlineRetryTimer) { clearTimeout(_offlineRetryTimer); _offlineRetryTimer = null; }
        _offlineRetryAttempts = 0;
        _hideOfflineIndicator();
    }

    function _showOfflineIndicator() {
        if (typeof document === 'undefined') return;
        var el = document.getElementById('cs-offline-indicator');
        if (el) return;
        el = document.createElement('div');
        el.id = 'cs-offline-indicator';
        el.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:10001;background:#fef3c7;color:#92400e;' +
            'border:1px solid #fcd34d;border-radius:10px;padding:8px 14px;font-size:0.85em;direction:rtl;' +
            'box-shadow:0 4px 14px rgba(0,0,0,.12);display:flex;align-items:center;gap:10px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
        var txt = document.createElement('span');
        txt.textContent = '📡 לא סונכרן — ננסה שוב';
        var retryBtn = document.createElement('button');
        retryBtn.textContent = 'נסה עכשיו';
        retryBtn.style.cssText = 'background:none;border:none;color:#b45309;font-weight:700;cursor:pointer;font-size:0.9em;padding:0';
        retryBtn.addEventListener('click', function() {
            if (_offlineRetryTimer) { clearTimeout(_offlineRetryTimer); _offlineRetryTimer = null; }
            _offlineRetryAttempts = 0;
            _processQueue();
        });
        el.appendChild(txt);
        el.appendChild(retryBtn);
        document.body.appendChild(el);
    }

    function _hideOfflineIndicator() {
        if (typeof document === 'undefined') return;
        var el = document.getElementById('cs-offline-indicator');
        if (el) el.remove();
    }

    async function _syncItem(contentType, localId, action) {
        // Module must provide the current data via a registered getter
        var getter = _moduleGetters[contentType];
        if (!getter) return;

        var localData = getter(localId);
        if (!localData) {
            _removeFromQueue(contentType, localId);
            return;
        }

        var meta = _getItemMeta(contentType, localId) || {};

        if (meta.serverId) {
            // Update existing server item — local is the source of truth,
            // just push it. The old flow fetched the server copy first and
            // fired _showConflictDialog on any updated-timestamp drift, but
            // that false-positives constantly (even opening a presentation
            // bumps local.updated by a few ms and the dialog popped up
            // during normal use). Per Amitai 2026-04-19: auto-sync should
            // just overwrite, never show a conflict dialog.
            // COLLAB_SHARE_20260604 — when this item was opened via an edit-share
            // (meta.shareToken set by the recipient-import path), include the share
            // token so the backend (content_api userCanEditContent) authorises the
            // write to the OWNER's row. Owner-owned items have no shareToken and
            // behave exactly as before.
            var localPayloadU = localData.data || localData;
            // BUG 8 — low-false-positive cross-device guard (lessons only).
            // Auto-sync still overwrites by DEFAULT (the old auto-popping
            // conflict dialog stays removed). But before clobbering the server
            // row we cheaply check whether ANOTHER device moved it since our
            // last reconcile: compare the live server content's fingerprint to
            // meta.lastSyncedHash. Unchanged → overwrite as before. Moved AND
            // genuinely different from local (more than a whitespace/updated-
            // only diff via _samePayload) → DON'T silently overwrite; keep the
            // local change and surface a quiet, one-shot, dismissible indicator
            // with explicit דרוס/השאר buttons. 'force-overwrite' (the user
            // pressing דרוס) skips the guard. No baseline yet → behave as today.
            if (contentType === 'lesson' && meta.lastSyncedHash && action !== 'force-overwrite') {
                var getRes = await _api('get', { id: meta.serverId });
                if (getRes && getRes.success && getRes.item) {
                    var serverRowU = getRes.item;
                    var serverHashU = _payloadHash(serverRowU.data);
                    if (serverHashU !== meta.lastSyncedHash) {
                        // Server moved since our baseline.
                        if (_samePayload(localPayloadU, serverRowU.data)) {
                            // Local already equals server (whitespace/updated-only
                            // drift) — not a real conflict. Refresh the baseline
                            // and finish without a pointless overwrite or prompt.
                            _setItemMeta(contentType, localId, {
                                synced: true, serverId: meta.serverId,
                                lastServerUpdated: serverRowU.updated,
                                lastSyncedHash: serverHashU, conflict: false
                            });
                            _removeFromQueue(contentType, localId);
                            return;
                        }
                        // Real cross-device conflict — leave local intact, drop
                        // the auto-retry (so it can't clobber on the next tick),
                        // and let the user decide via the quiet indicator.
                        _setItemMeta(contentType, localId, { synced: false, conflict: true });
                        _removeFromQueue(contentType, localId);
                        _showCrossDeviceConflict(contentType, localId, serverRowU);
                        _fireChange(contentType, localId);
                        return;
                    }
                }
                // get failed / offline → fall through and push as before.
            }
            var _upd = {
                id: meta.serverId,
                title: localData.title,
                data: localData.data || localData,
                color: localData.color,
                source_id: localData.source_id || null
            };
            if (meta.shareToken) _upd.share_token = meta.shareToken;
            var updateRes = await _api('update', _upd);
            if (updateRes && updateRes.success) {
                _setItemMeta(contentType, localId, { synced: true, serverId: meta.serverId, lastServerUpdated: new Date().toISOString(), lastSyncedHash: _payloadHash(localPayloadU), conflict: false });
                _removeFromQueue(contentType, localId);
            } else if (updateRes && updateRes.offline) {
                // Bug #10 — network/offline failure. Leave the item queued and
                // tell _processQueue to schedule a retry + show an indicator.
                return { offline: true };
            }
        } else {
            if (contentType === 'text' && !_hasMeaningfulPayload(localData)) {
                _removeFromQueue(contentType, localId);
                return;
            }
            // First-time push. Check the server for a same-title collision
            // under this user BEFORE creating, and show the title-conflict
            // dialog if there's a match. Without this, a backup of a local
            // lesson whose title already exists on the server would silently
            // create a duplicate.
            // Skip the collision check entirely when the local item has
            // no real title — a just-created draft (title="") shouldn't
            // collide with every other empty-title draft on the server.
            var hasTitle = !!(localData && typeof localData.title === 'string' && localData.title.trim());
            var listRes = hasTitle ? await _api('list', { content_type: contentType }) : null;
            var serverItems = (listRes && listRes.success && listRes.items) ? listRes.items : [];
            var localDesc = (localData && (localData.description || localData.desc)) || '';
            function _srvDesc(srv) {
                // description lives inside data blob (content_api stores
                // whole item JSON in the `data` column). Texts store their
                // description under `desc`, lessons under `description` —
                // accept either so title+desc collision works for both.
                var d = srv && srv.data;
                if (!d) return '';
                if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return ''; } }
                return _dataDesc(d);
            }
            // Collision check: title + description + source_id all must match.
            // source_id gating matters for per-stage types ('analysis', 'hindus')
            // where many stages share the same short title like 'default'; without
            // this, a push of stage B's 'default' analysis would be treated as
            // a collision with stage A's 'default' analysis on the server.
            // Legacy types (lesson/text/sentence) don't set source_id so both
            // sides are null and the check degenerates to title+desc, same as before.
            var localSource = localData.source_id || null;
            var collisionMatch = null;
            if (hasTitle) {
                for (var ci = 0; ci < serverItems.length; ci++) {
                    var srvSource = serverItems[ci].source_id || null;
                    var sameTextPayload = false;
                    if (contentType === 'text') {
                        try {
                            sameTextPayload =
                                _samePayload(localData.data || localData, serverItems[ci].data) ||
                                _sameTextCorePayload(localData.data || localData, serverItems[ci].data);
                        } catch (_) {}
                    }
                    if (serverItems[ci].title === localData.title
                        && _srvDesc(serverItems[ci]) === localDesc
                        && (contentType === 'text' || srvSource === localSource || sameTextPayload)) {
                        collisionMatch = serverItems[ci];
                        break;
                    }
                }
            }
            if (collisionMatch) {
                var localPayload = localData.data || localData;
                var serverPayload = collisionMatch.data;
                if (_samePayload(localPayload, serverPayload) ||
                    (contentType === 'text' && _sameTextCorePayload(localPayload, serverPayload))) {
                    // Same title/source and same data is not a conflict.
                    // Adopt the existing server row and drop the queue entry.
                    _setItemMeta(contentType, localId, {
                        synced: true,
                        serverId: collisionMatch.id,
                        lastServerUpdated: collisionMatch.updated || new Date().toISOString(),
                        lastSyncedHash: _payloadHash(serverPayload)
                    });
                    _removeFromQueue(contentType, localId);
                    return;
                }

                if (contentType === 'text' && action !== 'manual-save') {
                    // Background text sync should never interrupt the editor with
                    // an old-title collision popup, and it must not silently create
                    // another server row. Leave the item local/unsynced until the
                    // user explicitly presses the cloud backup button.
                    _setItemMeta(contentType, localId, {
                        synced: false,
                        localUpdated: localData.updated || new Date().toISOString(),
                        collisionSkipped: true,
                        collisionServerId: collisionMatch.id
                    });
                    _removeFromQueue(contentType, localId);
                    _fireChange(contentType, localId);
                    return;
                }
                var existingTitles = serverItems.map(function(s) { return s.title; });
                var base = localData.title || '';
                var suffix = 2;
                while (existingTitles.indexOf(base + ' ' + suffix) !== -1) suffix++;
                var proposedNewTitle = base + ' ' + suffix;

                var decision = await _showTitleConflictDialog(localData, collisionMatch, proposedNewTitle, contentType);

                if (decision.choice === 'overwriteLocal') {
                    // Server copy wins — replace local content via setter.
                    var setterL = _moduleSetters[contentType];
                    if (setterL) {
                        try { setterL(localId, collisionMatch); } catch (e) { console.warn('[_syncItem] setter failed', e); }
                    }
                    _setItemMeta(contentType, localId, { synced: true, serverId: collisionMatch.id, lastServerUpdated: collisionMatch.updated, lastSyncedHash: _payloadHash(collisionMatch.data) });
                    _removeFromQueue(contentType, localId);
                    return;
                }
                if (decision.choice === 'overwriteServer') {
                    // Local wins — update the matched server row.
                    var updOvRes = await _api('update', {
                        id: collisionMatch.id,
                        title: localData.title,
                        data: localData.data || localData,
                        color: localData.color,
                        source_id: localData.source_id || null
                    });
                    if (updOvRes && updOvRes.success) {
                        _setItemMeta(contentType, localId, { synced: true, serverId: collisionMatch.id, lastServerUpdated: new Date().toISOString(), lastSyncedHash: _payloadHash(localData.data || localData) });
                        _removeFromQueue(contentType, localId);
                    }
                    return;
                }
                if (decision.choice === 'rename') {
                    // Rename locally + push as a new server row.
                    var newTitle = decision.newTitle || proposedNewTitle;
                    localData.title = newTitle;
                    // Sentences render using .number (not .title). Amitai
                    // 2026-04-19 09:36 hit the visible bug: after rename
                    // the card kept its old number and "nothing happened".
                    // Propagate the new name to .number on the in-memory
                    // clone so the push carries it, and to the stored
                    // item so the list re-renders with the new label.
                    if (contentType === 'sentence') localData.number = newTitle;
                    var storageKey = _storageKeys[contentType];
                    if (storageKey) {
                        try {
                            var allItems = JSON.parse(localStorage.getItem(storageKey) || '[]');
                            var idxItem = allItems.findIndex(function(l) { return String(l.id) === String(localId); });
                            if (idxItem >= 0) {
                                allItems[idxItem].title = newTitle;
                                if (contentType === 'sentence') allItems[idxItem].number = newTitle;
                                allItems[idxItem].updated = new Date().toISOString();
                                localStorage.setItem(storageKey, JSON.stringify(allItems));
                            }
                        } catch (_) {}
                    }
                    // Re-render the sentence list immediately so the new
                    // name is visible without waiting for the debounced
                    // contentsync:change listener to fire post-push.
                    if (contentType === 'sentence') {
                        try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (_) {}
                    }
                    // fall through to normal create
                }
            }

            // Create new on server
            var renamedSentence = contentType === 'sentence' && localData && localData.number;
            var createRes = await _api('create', {
                content_type: contentType,
                title: localData.title || localId,
                data: localData.data || localData,
                color: localData.color || '#0d9488',
                source_id: localData.source_id || null
            });
            if (createRes.success) {
                _setItemMeta(contentType, localId, { synced: true, serverId: createRes.id, lastServerUpdated: new Date().toISOString(), lastSyncedHash: _payloadHash(localData.data || localData) });
                _removeFromQueue(contentType, localId);
                _fireChange(contentType, localId);
                if (renamedSentence) {
                    try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (_) {}
                }
            } else if (createRes && createRes.offline) {
                // Bug #10 — network/offline failure on first push. Keep queued.
                return { offline: true };
            }
        }
    }

    // Force-sync a single item and return the API result so callers can
    // show accurate feedback. Normal _syncItem swallows errors (stays
    // unsynced silently); this entry point surfaces them.
    async function syncNow(contentType, localId) {
        if (!_isLoggedIn()) return { success: false, error: 'לא מחובר' };
        var getter = _moduleGetters[contentType];
        if (!getter) return { success: false, error: 'מודול לא רשום: ' + contentType };
        var localData = getter(localId);
        if (!localData) return { success: false, error: 'פריט לא נמצא: ' + localId };

        // Delegate to _syncItem so we get the full flow — including the
        // title-collision dialog on first-time push. Read the resulting
        // meta to decide success.
        try {
            await _syncItem(contentType, localId, 'manual-save');
        } catch (e) {
            console.error('[ContentSync.syncNow] _syncItem threw:', e);
            return { success: false, error: (e && e.message) || 'שגיאה' };
        }
        var meta = _getItemMeta(contentType, localId) || {};
        if (meta.synced && meta.serverId) {
            _clearPromptSkipped(contentType, localId);
            _markGuestAdoptedOnSuccess(contentType, localId, meta.serverId);
            return { success: true, id: meta.serverId };
        }
        return { success: false, error: 'הסנכרון נכשל' };
    }

    // Title-collision dialog fired at first-time backup when the server
    // already has an item (of the same contentType + same title under this
    // user). Returns Promise<{choice:'overwriteLocal'|'overwriteServer'|'rename', newTitle?}>.
    // Dismissing (overlay click / Esc) defaults to 'rename' with a pre-
    // computed "<original> N" title — matches Amitai 2026-04-19 03:16 spec.
    // Hebrew noun per contentType for user-facing dialogs. Keeps the wording
    // accurate when a collision happens on non-lesson content (vocab
    // categories collide by title + null source_id, analyses collide within
    // a stage, etc.).
    var _CONTENT_TYPE_LABELS = {
        lesson:          'שיעור',
        text:            'טקסט',
        sentence:        'משפט',
        analysis:        'ניתוח',
        hindus:          'הינדוס',
        vocab_category:  'קטגוריית מילים'
    };

    function _showTitleConflictDialog(localData, serverItem, proposedNewTitle, contentType) {
        return new Promise(function(resolve) {
            var esc = function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
            var label = _CONTENT_TYPE_LABELS[contentType] || 'פריט';
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100001;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
            var dlg = document.createElement('div');
            dlg.style.cssText = 'background:white;border-radius:18px;padding:22px;max-width:460px;width:92%;direction:rtl;text-align:right;box-shadow:0 20px 50px rgba(0,0,0,0.3)';
            dlg.innerHTML =
                '<h3 style="margin:0 0 8px 0;color:#0d9488;text-align:center">' + esc(label) + ' עם שם זהה קיים בשרת</h3>' +
                '<p style="margin:0 0 14px 0;color:#475569;font-size:0.92em;text-align:center">כותרת: "<b>' + esc(localData.title) + '</b>"</p>' +
                '<label style="font-size:0.88em;font-weight:600;color:#334155">שם חדש (לאפשרות "שנה שם"):</label>' +
                '<input id="cs-tc-newname" type="text" value="' + esc(proposedNewTitle) + '" style="width:100%;padding:9px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 14px 0;box-sizing:border-box;direction:rtl">' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                    '<button type="button" id="cs-tc-server" style="flex:1;min-width:115px;padding:10px;background:#f59e0b;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.95em">דרוס שרת</button>' +
                    '<button type="button" id="cs-tc-local" style="flex:1;min-width:115px;padding:10px;background:#0891b2;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.95em">דרוס מקומי</button>' +
                    '<button type="button" id="cs-tc-rename" style="flex:1;min-width:115px;padding:10px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.95em">שנה שם</button>' +
                '</div>' +
                '<p style="margin:12px 0 0 0;font-size:0.78em;color:#94a3b8;text-align:center">סגירה ללא בחירה = שינוי שם עם השם למעלה</p>';
            overlay.appendChild(dlg);
            document.body.appendChild(overlay);

            var settled = false;
            function finish(value) {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', escHandler);
                overlay.remove();
                resolve(value);
            }
            function dismissDefault() {
                var inp = overlay.querySelector('#cs-tc-newname');
                var nt = (inp && inp.value || '').trim() || proposedNewTitle;
                finish({ choice: 'rename', newTitle: nt });
            }
            function escHandler(ev) { if (ev.key === 'Escape') dismissDefault(); }

            overlay.addEventListener('click', function(ev) { if (ev.target === overlay) dismissDefault(); });
            dlg.addEventListener('click', function(ev) { ev.stopPropagation(); });
            document.addEventListener('keydown', escHandler);
            var serverBtn = overlay.querySelector('#cs-tc-server');
            var localBtn = overlay.querySelector('#cs-tc-local');
            var renameBtn = overlay.querySelector('#cs-tc-rename');
            var nameInput = overlay.querySelector('#cs-tc-newname');
            if (!serverBtn || !localBtn || !renameBtn || !nameInput) {
                console.error('[ContentSync] title conflict dialog failed to bind buttons');
                dismissDefault();
                return;
            }
            serverBtn.onclick = function(ev) { ev.preventDefault(); finish({ choice: 'overwriteServer' }); };
            localBtn.onclick = function(ev) { ev.preventDefault(); finish({ choice: 'overwriteLocal' }); };
            renameBtn.onclick = function(ev) {
                ev.preventDefault();
                var nt = (nameInput.value || '').trim() || proposedNewTitle;
                finish({ choice: 'rename', newTitle: nt });
            };
            setTimeout(function() {
                if (nameInput) { nameInput.focus(); nameInput.select(); }
            }, 0);
        });
    }

    // Delete an item from the server (if it was ever synced) AND clear its
    // local sync metadata. Local storage removal is the caller's job — this
    // only handles the server + meta side. Without this, deleting a lesson
    // locally leaves the server copy behind, so the next pullAll on login
    // resurrects it.
    async function deleteItem(contentType, localId) {
        _setPendingDeleteDelta(1);
        try {
            var meta = _getItemMeta(contentType, localId);
            var serverId = meta && meta.serverId;
            var res = { success: true, localOnly: !serverId };
            if (serverId && _isLoggedIn()) {
                var apiRes = await _api('delete', { id: serverId });
                if (!apiRes || !apiRes.success) {
                    console.warn('[ContentSync.deleteItem] server delete failed:', apiRes);
                    return { success: false, error: (apiRes && apiRes.error) || 'שגיאת מחיקה בשרת', serverId: serverId };
                }
                res = apiRes;
            }
            // Clear meta + remove any pending queue entry
            var allMeta = _getMeta();
            delete allMeta[contentType + ':' + localId];
            _setMeta(allMeta);
            _removeFromQueue(contentType, localId);
            _fireChange(contentType, localId);
            return res;
        } finally {
            _setPendingDeleteDelta(-1);
        }
    }

    // Hydrate localStorage from the server. Needed after a user switch wipes
    // plonter_lessons — the server still has the user's lessons but nothing
    // auto-pulls them back in. Writes directly to localStorage to avoid
    // round-tripping through LessonManager.saveLessons (which would re-queue
    // the pulled items for push via the auto-sync diff).
    //
    // Dedupe-on-pull: when a server item's id doesn't match any local id,
    // we also try to match an existing UNSYNCED local item by title+desc.
    // Without this, a client that created "3.17" as a guest (local id
    // local-abc) then logs in and pulls the same item from the server
    // (data.id = local-xyz from a prior device) ends up with BOTH — which
    // is exactly the duplicate row Amitai saw in his screenshot 2026-04-19.
    // After-pass also collapses any duplicates already sitting in
    // localStorage from previous pullAll calls that lacked adoption logic.
    function _dataDesc(d) { return (d && (d.description || d.desc)) || ''; }

    // Custom pull-path registry. Content types whose storage shape isn't a
    // flat array (analysis/hindus keep one localStorage key per item, not
    // an array per type) register their own puller and own the full flow.
    // If a puller is present for contentType, pullAll delegates to it
    // instead of the generic flat-array path below.
    var _pullers = {};
    function registerPuller(contentType, fn) {
        _pullers[contentType] = fn;
    }

    async function pullAll(contentType) {
        if (!_isLoggedIn()) return { loaded: 0, error: 'not logged in' };
        // BUG 7 — run the one-time legacy adopter before pulling lessons so
        // legacy-backed lessons get a content_api row / meta and aren't
        // duplicated by the pull below. Guarded by its own one-shot flag.
        if (contentType === 'lesson') { try { await _adoptLegacyLessonsOnce(); } catch (_) {} }
        // Delegate to per-type puller if registered.
        if (typeof _pullers[contentType] === 'function') {
            try {
                var custom = await _pullers[contentType]({ api: _api, setItemMeta: _setItemMeta });
                return custom || { loaded: 0 };
            } catch (e) {
                console.error('[ContentSync.pullAll] custom puller threw:', e);
                return { loaded: 0, error: (e && e.message) || 'custom puller failed' };
            }
        }
        var storageKey = _storageKeys[contentType];
        if (!storageKey) return { loaded: 0, error: 'unsupported contentType: ' + contentType };

        var res = await _api('list', { content_type: contentType });
        if (!res || !res.success) return { loaded: 0, error: (res && res.error) || 'list failed' };
        var items = res.items || [];
        if (!items.length) return { loaded: 0 };

        var local = [];
        try { local = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (_) {}
        var byId = {};
        for (var i = 0; i < local.length; i++) if (local[i] && local[i].id) byId[local[i].id] = local[i];

        // Index local UNSYNCED items by title|desc so a pulled server copy
        // with a different id can adopt the local record instead of
        // duplicating it.
        var unsyncedByTD = {};
        for (var li = 0; li < local.length; li++) {
            var lItem = local[li];
            if (!lItem || !lItem.id) continue;
            var lMeta = _getItemMeta(contentType, lItem.id);
            if (lMeta && lMeta.synced) continue;
            var lTitle = lItem.title || '';
            if (!lTitle) continue;
            unsyncedByTD[lTitle + '|' + _dataDesc(lItem)] = lItem;
        }

        var merged = 0;
        var adopted = 0;
        for (var j = 0; j < items.length; j++) {
            var srv = items[j];
            var data = srv.data;
            if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
            if (!data || !data.id) continue;
            var existing = byId[data.id];
            if (!existing) {
                // Try adoption via title+desc match before treating as new.
                var sTitle = data.title || '';
                var adoptKey = sTitle ? (sTitle + '|' + _dataDesc(data)) : '';
                var adoptTarget = adoptKey ? unsyncedByTD[adoptKey] : null;
                if (adoptTarget) {
                    var oldLocalId = adoptTarget.id;
                    // Overlay server fields onto the existing local object
                    // so any references to it stay valid. The id changes
                    // from the guest-local id to the server's data.id.
                    for (var ak in data) if (Object.prototype.hasOwnProperty.call(data, ak)) adoptTarget[ak] = data[ak];
                    adoptTarget.id = data.id;
                    byId[data.id] = adoptTarget;
                    delete unsyncedByTD[adoptKey];
                    // Drop stale meta / queue entries keyed by the old id.
                    var allMetaA = _getMeta();
                    delete allMetaA[contentType + ':' + oldLocalId];
                    _setMeta(allMetaA);
                    _removeFromQueue(contentType, oldLocalId);
                    _setItemMeta(contentType, data.id, {
                        synced: true,
                        serverId: srv.id,
                        lastServerUpdated: srv.updated,
                        lastSyncedHash: _payloadHash(data)
                    });
                    adopted++;
                    continue;
                }
                local.push(data);
                byId[data.id] = data;
                merged++;
            } else {
                var srvUpdated = new Date(srv.updated || 0).getTime();
                var locUpdated = new Date(existing.updated || 0).getTime();
                if (srvUpdated > locUpdated) {
                    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) existing[k] = data[k];
                    merged++;
                }
            }
            _setItemMeta(contentType, data.id, {
                synced: true,
                serverId: srv.id,
                lastServerUpdated: srv.updated,
                lastSyncedHash: _payloadHash(data)
            });
        }

        // Post-pull cleanup: collapse residual (title+desc) duplicates from
        // pre-adoption pullAll runs. Prefer the synced copy; drop unsynced
        // twins + their stale meta/queue entries.
        var syncedByTD = {};
        for (var p = 0; p < local.length; p++) {
            var lp = local[p];
            if (!lp || !lp.id || !lp.title) continue;
            var pm = _getItemMeta(contentType, lp.id);
            if (!(pm && pm.synced)) continue;
            syncedByTD[lp.title + '|' + _dataDesc(lp)] = lp.id;
        }
        var dropped = 0;
        for (var q = local.length - 1; q >= 0; q--) {
            var lq = local[q];
            if (!lq || !lq.id || !lq.title) continue;
            var qm = _getItemMeta(contentType, lq.id);
            if (qm && qm.synced) continue;
            var kq = lq.title + '|' + _dataDesc(lq);
            var syncedId = syncedByTD[kq];
            if (syncedId && syncedId !== lq.id) {
                var allMetaD = _getMeta();
                delete allMetaD[contentType + ':' + lq.id];
                _setMeta(allMetaD);
                _removeFromQueue(contentType, lq.id);
                local.splice(q, 1);
                dropped++;
            }
        }

        if (merged || adopted || dropped) {
            try { localStorage.setItem(storageKey, JSON.stringify(local)); }
            catch (e) { console.error('[ContentSync.pullAll] localStorage write failed', e); }
        }
        return { loaded: merged, adopted: adopted, dropped: dropped, serverCount: items.length };
    }

    // --- BUG 8: quiet cross-device conflict indicator (lessons) ---
    // Non-blocking, dismissible, one-shot per (item, server-version). Mirrors
    // the offline-indicator look but offers explicit דרוס / השאר choices. No
    // auto-pop modal — the auto-removed dialog stays gone.
    var _conflictShown = {}; // key item:id:serverHash → true (one-shot per conflict)

    function _showCrossDeviceConflict(contentType, localId, serverRow) {
        if (typeof document === 'undefined') return;
        var serverHash = _payloadHash(serverRow && serverRow.data);
        var key = contentType + ':' + localId + ':' + serverHash;
        if (_conflictShown[key]) return; // already surfaced this exact conflict
        _conflictShown[key] = true;
        var elId = 'cs-conflict-' + contentType + '-' + localId;
        var existing = document.getElementById(elId);
        if (existing) existing.remove();

        var el = document.createElement('div');
        el.id = elId;
        el.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:10002;background:#fff7ed;color:#9a3412;' +
            'border:1px solid #fdba74;border-radius:12px;padding:10px 14px;font-size:0.88em;direction:rtl;max-width:320px;' +
            'box-shadow:0 6px 18px rgba(0,0,0,.14);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
        var txt = document.createElement('span');
        txt.textContent = '☁️ השיעור עודכן במכשיר אחר';
        txt.style.cssText = 'font-weight:700;flex:1';
        var dismiss = document.createElement('button');
        dismiss.textContent = '✕';
        dismiss.title = 'סגור';
        dismiss.style.cssText = 'background:none;border:none;color:#9a3412;cursor:pointer;font-size:1em;padding:0;line-height:1';
        dismiss.addEventListener('click', function() { el.remove(); });
        row.appendChild(txt);
        row.appendChild(dismiss);

        var btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:8px';
        var overwriteBtn = document.createElement('button');
        overwriteBtn.textContent = 'דרוס';
        overwriteBtn.title = 'דרוס את גרסת השרת עם השינוי המקומי';
        overwriteBtn.style.cssText = 'flex:1;padding:6px 10px;background:#ea580c;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95em';
        var keepBtn = document.createElement('button');
        keepBtn.textContent = 'השאר';
        keepBtn.title = 'משוך את גרסת השרת ובטל את השינוי המקומי';
        keepBtn.style.cssText = 'flex:1;padding:6px 10px;background:#e2e8f0;color:#475569;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95em';

        overwriteBtn.addEventListener('click', async function() {
            el.remove();
            // User chose local — force the overwrite past the guard.
            _setItemMeta(contentType, localId, { conflict: false });
            try { await _syncItem(contentType, localId, 'force-overwrite'); }
            catch (e) { console.warn('[ContentSync] force-overwrite failed', e); }
            _fireChange(contentType, localId);
            try { document.dispatchEvent(new CustomEvent('plonter:authchange')); } catch (_) {}
        });
        keepBtn.addEventListener('click', function() {
            el.remove();
            // User chose server — replace local content with the server row.
            if (contentType === 'lesson') _applyServerLesson(localId, serverRow);
            _setItemMeta(contentType, localId, {
                synced: true, serverId: (serverRow && serverRow.id),
                lastServerUpdated: serverRow && serverRow.updated,
                lastSyncedHash: serverHash, conflict: false
            });
            _removeFromQueue(contentType, localId);
            _fireChange(contentType, localId);
            try { document.dispatchEvent(new CustomEvent('plonter:authchange')); } catch (_) {}
        });

        btns.appendChild(overwriteBtn);
        btns.appendChild(keepBtn);
        el.appendChild(row);
        el.appendChild(btns);
        document.body.appendChild(el);
    }

    // Overlay a server lesson blob onto the matching local lesson, preserving
    // the local id/local_id. Used by the conflict 'השאר' choice. content_api
    // stores the whole lesson object in the `data` column, so the blob is a
    // full lesson.
    function _applyServerLesson(localId, serverRow) {
        try {
            var blob = serverRow && serverRow.data;
            if (typeof blob === 'string') { try { blob = JSON.parse(blob); } catch (_) { blob = null; } }
            if (!blob || typeof blob !== 'object') return;
            var all = JSON.parse(localStorage.getItem('plonter_lessons') || '[]');
            var idx = all.findIndex(function(l) { return l && String(l.id) === String(localId); });
            if (idx < 0) return;
            for (var k in blob) {
                if (!Object.prototype.hasOwnProperty.call(blob, k)) continue;
                if (k === 'id' || k === 'local_id') continue; // keep local identity
                all[idx][k] = blob[k];
            }
            if (serverRow.updated) all[idx].updated = serverRow.updated;
            localStorage.setItem('plonter_lessons', JSON.stringify(all));
        } catch (e) { console.warn('[ContentSync] _applyServerLesson failed', e); }
    }

    // --- BUG 7: one-time legacy → ContentSync adopter (lessons) ---
    // ContentSync (content_api) is the single source of truth. lessons_api is
    // legacy/read-only. A lesson backed up via the OLD '☁️ סנכרון' button got a
    // lessons_api row + lesson.serverId, but never a content_api row / sync
    // meta — so it shows "לא מגובה" forever and never pulls cross-device. This
    // adopter runs ONCE per device (flag 'cs_adopt_v1_done'): for every local
    // lesson that has a legacy lesson.serverId but NO ContentSync meta, it
    // either (a) adopts the matching content_api row by title+desc, or (b)
    // pushes the lesson once through content_api to create a row, then clears
    // the stale lesson.serverId. Idempotent + additive — lessons_api code is
    // left intact, just no longer written to.
    var ADOPT_FLAG = 'cs_adopt_v1_done';
    var _adoptRunning = false;

    async function _adoptLegacyLessonsOnce() {
        if (_adoptRunning) return;
        if (!_isLoggedIn()) return;
        try { if (localStorage.getItem(ADOPT_FLAG) === '1') return; } catch (_) { return; }
        if (typeof LessonManager === 'undefined' || typeof LessonManager.loadLessons !== 'function') return;
        _adoptRunning = true;
        try {
            var lessons = LessonManager.loadLessons();
            var candidates = lessons.filter(function(l) {
                if (!l || !l.id || !l.serverId) return false;
                var m = _getItemMeta('lesson', l.id);
                return !m || !m.serverId; // legacy serverId but no CS meta
            });
            if (!candidates.length) { try { localStorage.setItem(ADOPT_FLAG, '1'); } catch (_) {} return; }

            var listRes = await _api('list', { content_type: 'lesson' });
            if (!listRes || !listRes.success) return; // offline — retry next login, DON'T set flag
            var serverItems = listRes.items || [];

            for (var i = 0; i < candidates.length; i++) {
                var lesson = candidates[i];
                var title = lesson.title || '';
                var desc = _dataDesc(lesson);
                // (a) Adopt existing content_api row by title+desc.
                var match = null;
                for (var s = 0; s < serverItems.length; s++) {
                    if (serverItems[s].title === title &&
                        _dataDesc(_parseDataMaybe(serverItems[s].data)) === desc) {
                        match = serverItems[s]; break;
                    }
                }
                if (match) {
                    _setItemMeta('lesson', lesson.id, {
                        synced: true, serverId: match.id,
                        lastServerUpdated: match.updated,
                        lastSyncedHash: _payloadHash(match.data)
                    });
                    continue;
                }
                // (b) No content_api row — create one (strip the legacy serverId
                // from the pushed blob), then clear lesson.serverId locally.
                var pushData = {};
                for (var key in lesson) {
                    if (Object.prototype.hasOwnProperty.call(lesson, key) && key !== 'serverId') {
                        pushData[key] = lesson[key];
                    }
                }
                var createRes = await _api('create', {
                    content_type: 'lesson',
                    title: lesson.title || lesson.id,
                    data: pushData,
                    color: lesson.color || '#0d9488',
                    source_id: lesson.source_id || null
                });
                if (createRes && createRes.success) {
                    _setItemMeta('lesson', lesson.id, {
                        synced: true, serverId: createRes.id,
                        lastServerUpdated: new Date().toISOString(),
                        lastSyncedHash: _payloadHash(pushData)
                    });
                    if (typeof LessonManager.clearLegacyServerId === 'function') {
                        LessonManager.clearLegacyServerId(lesson.id);
                    }
                } else if (createRes && createRes.offline) {
                    return; // network hiccup — retry next login, DON'T set flag
                }
            }
            try { localStorage.setItem(ADOPT_FLAG, '1'); } catch (_) {}
            try { document.dispatchEvent(new CustomEvent('plonter:authchange')); } catch (_) {}
        } finally {
            _adoptRunning = false;
        }
    }

    // --- Module registration ---

    var _moduleGetters = {}; // type → function(localId) → data
    var _moduleSetters = {}; // type → function(localId, serverData) → void

    function registerModule(contentType, getter, setter) {
        _moduleGetters[contentType] = getter;
        _moduleSetters[contentType] = setter;
    }

    // --- Migration popup ---

    var _migrationShownThisLoad = {};
    var _pendingMigrationItems = {};
    var _migrationPopupTimer = null;
    var MIGRATION_DEFERRED_KEY = 'plonter_cs_migration_deferred_this_cycle';

    function _skipKey(contentType) {
        return 'plonter_sync_prompt_skipped_' + contentType + '_v1';
    }

    function _getSkippedPromptIds(contentType) {
        try {
            var arr = JSON.parse(localStorage.getItem(_skipKey(contentType)) || '[]') || [];
            var out = {};
            arr.forEach(function(id) { if (id) out[String(id)] = true; });
            return out;
        } catch (_) {
            return {};
        }
    }

    function _markPromptSkipped(contentType, items) {
        try {
            var skipped = _getSkippedPromptIds(contentType);
            (items || []).forEach(function(item) {
                if (item && item.id != null) skipped[String(item.id)] = true;
            });
            localStorage.setItem(_skipKey(contentType), JSON.stringify(Object.keys(skipped)));
        } catch (e) { console.warn('[ContentSync] mark prompt skipped failed', e); }
    }

    function _clearPromptSkipped(contentType, localId) {
        try {
            var skipped = _getSkippedPromptIds(contentType);
            delete skipped[String(localId)];
            localStorage.setItem(_skipKey(contentType), JSON.stringify(Object.keys(skipped)));
        } catch (_) {}
    }

    function _isGuestMigrationItem(item) {
        if (!item) return false;
        return item._createdAsGuest === true ||
            item.owner === 'guest' ||
            item._guestWorkingCopy === true ||
            item.backup_state === 'not_backed_up' ||
            item.backup_state === 'backing_up' ||
            item._guestBackupStatus === 'pending' ||
            item._guestBackupStatus === 'not_backed_up' ||
            item._guestBackupStatus === 'backing_up';
    }

    function _stableGuestItemIds(item) {
        var ids = {};
        if (!item) return ids;
        [item.id, item.local_id, item.source_id, item.migratedFromGuestId].forEach(function(id) {
            if (id != null && id !== '') ids[String(id)] = true;
        });
        return ids;
    }

    function _markGuestAdoptedOnSuccess(contentType, localId, serverId) {
        var getter = _moduleGetters[contentType];
        var item = getter ? getter(localId) : null;
        if (!_isGuestMigrationItem(item)) return;
        var now = new Date().toISOString();

        if (contentType === 'sentence') {
            try {
                if (typeof PlonterAuth !== 'undefined' &&
                    typeof PlonterAuth.deleteGuestSentenceBackupForStage === 'function') {
                    PlonterAuth.deleteGuestSentenceBackupForStage(item);
                }
            } catch (e) { console.warn('[ContentSync] sentence guest shadow cleanup failed', e); }
            try {
                if (typeof getCustomStages === 'function' && typeof saveCustomStages === 'function') {
                    var stages = getCustomStages();
                    var changedStage = false;
                    stages.forEach(function(stage) {
                        if (!stage || String(stage.id) !== String(localId)) return;
                        stage.owner = 'account';
                        stage.backup_state = 'backed_up';
                        stage._guestBackupStatus = 'backed_up';
                        stage.backedUpAt = now;
                        stage.serverId = serverId;
                        stage.migratedFromGuestId = stage.migratedFromGuestId || item.migratedFromGuestId || item.source_id || item.local_id || item.id;
                        delete stage._createdAsGuest;
                        delete stage._guestWorkingCopy;
                        changedStage = true;
                    });
                    if (changedStage) localStorage.setItem('plonter_custom_stages', JSON.stringify(stages));
                }
            } catch (e2) { console.warn('[ContentSync] sentence guest local mark failed', e2); }
            return;
        }

        if (contentType === 'text') {
            try {
                var shadowKey = (typeof PlonterTexts !== 'undefined' && PlonterTexts.GUEST_SHADOW_KEY) || 'plonter_text_guest_backup_v1';
                var ids = _stableGuestItemIds(item);
                var itemSig = '';
                try {
                    if (typeof PlonterTexts !== 'undefined' && typeof PlonterTexts._textSignature === 'function') {
                        itemSig = PlonterTexts._textSignature(item);
                    }
                } catch (_) {}
                var shadow = [];
                try { shadow = JSON.parse(localStorage.getItem(shadowKey) || '[]') || []; } catch (_) { shadow = []; }
                var nextShadow = shadow.filter(function(candidate) {
                    if (!candidate) return false;
                    var candIds = _stableGuestItemIds(candidate);
                    for (var id in ids) {
                        if (Object.prototype.hasOwnProperty.call(ids, id) && candIds[id]) return false;
                    }
                    if (!Object.keys(ids).length && itemSig && typeof PlonterTexts !== 'undefined' && typeof PlonterTexts._textSignature === 'function') {
                        try { if (PlonterTexts._textSignature(candidate) === itemSig) return false; } catch (_) {}
                    }
                    return true;
                });
                if (nextShadow.length) localStorage.setItem(shadowKey, JSON.stringify(nextShadow));
                else localStorage.removeItem(shadowKey);
            } catch (e3) { console.warn('[ContentSync] text guest shadow cleanup failed', e3); }
            try {
                if (typeof PlonterTexts !== 'undefined' && typeof PlonterTexts._getAll === 'function') {
                    var texts = PlonterTexts._getAll();
                    var changedText = false;
                    texts.forEach(function(text) {
                        if (!text || String(text.id) !== String(localId)) return;
                        text.owner = 'account';
                        text.backup_state = 'backed_up';
                        text.backedUpAt = now;
                        text.serverId = serverId;
                        delete text._createdAsGuest;
                        delete text.stashedAt;
                        delete text.skippedAt;
                        changedText = true;
                    });
                    if (changedText) localStorage.setItem((PlonterTexts.STORAGE_KEY || 'plonter_texts'), JSON.stringify(texts));
                }
            } catch (e4) { console.warn('[ContentSync] text guest local mark failed', e4); }
            return;
        }

        if (contentType === 'lesson') {
            try {
                if (typeof LessonManager !== 'undefined' && typeof LessonManager.loadLessons === 'function') {
                    var lessons = LessonManager.loadLessons();
                    var changedLesson = false;
                    lessons.forEach(function(lesson) {
                        if (!lesson || String(lesson.id) !== String(localId)) return;
                        lesson.owner = 'account';
                        lesson.backup_state = 'backed_up';
                        lesson.backedUpAt = now;
                        lesson.serverId = serverId;
                        delete lesson._createdAsGuest;
                        delete lesson.skippedAt;
                        changedLesson = true;
                    });
                    if (changedLesson) localStorage.setItem('plonter_lessons', JSON.stringify(lessons));
                }
            } catch (e5) { console.warn('[ContentSync] lesson guest local mark failed', e5); }
        }
    }

    // BUG #1353 fix (2): a stable, CONSERVATIVE content signature used to detect
    // that an equivalent item already exists (synced) in this account, so a
    // re-injected guest/local copy of it is not offered for backup again (and
    // does not later collide into the "duplicate document" dialog). Returns null
    // when a confident signature cannot be built — in that case NO suppression
    // happens (we never hide a real backup prompt on a weak guess).
    function _normSig(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
    function _comparableContentSig(contentType, item) {
        if (!item) return null;
        if (contentType === 'sentence') {
            // number (human label) + the Arabic sentence text are stable across
            // a guest copy and its synced account twin — the reported case.
            var num = _normSig(item.number || item.title);
            var ar = _normSig(item.sentence);
            if (!num && !ar) return null;
            return 'sentence|' + num + '|' + ar;
        }
        if (contentType === 'lesson') {
            var lt = _normSig(item.title);
            if (!lt) return null;
            // title + payload size: a cheap fingerprint that still distinguishes
            // a genuinely different lesson that happens to share a title.
            var ld = '';
            try { ld = item.data != null ? JSON.stringify(item.data) : ''; } catch (_) { ld = ''; }
            return 'lesson|' + lt + '|' + ld.length;
        }
        if (contentType === 'text') {
            var tt = _normSig(item.title);
            var tc = _normSig(item.content || item.body || item.desc);
            if (!tt && !tc) return null;
            return 'text|' + tt + '|' + tc.slice(0, 200);
        }
        var gt = _normSig(item.title);
        return gt ? (contentType + '|' + gt) : null;
    }
    // True when a DIFFERENT item of the same type already exists in the account
    // (meta.synced) with the same comparable signature as `item`. Independent of
    // the login pull-vs-prompt timing once hydration has landed the account twin.
    function _equivalentSyncedItemExists(contentType, item) {
        var sig = _comparableContentSig(contentType, item);
        if (!sig) return false;
        var lister = _moduleListers[contentType];
        if (typeof lister !== 'function') return false;
        var list;
        try { list = lister() || []; } catch (_) { return false; }
        for (var i = 0; i < list.length; i++) {
            var other = list[i];
            if (!other || other.id == null) continue;
            if (String(other.id) === String(item.id)) continue;            // not itself
            if (getSyncState(contentType, other.id) !== 'synced') continue; // only account-backed twins
            if (_comparableContentSig(contentType, other) === sig) return true;
        }
        return false;
    }

    function _shouldOfferMigration(contentType, item) {
        if (!item || item.id == null) return false;
        // Phase 1 guard: if no _moduleGetter is registered for this type, the
        // popup would render the item but clicking 'גבה נבחרים' would fail
        // syncNow with 'מודול לא רשום'. Suppress until an adapter registers.
        // Phase 3 adapters for vocab/flashcard/media will lift this automatically.
        if (!_moduleGetters[contentType]) return false;
        var state = item.backup_state || item.backupState || item._guestBackupStatus || '';
        if (state === 'backed_up' || state === 'handled' || state === 'deleted' || state === 'backing_up') return false;
        // The migration popup is only for real guest/local leftovers that
        // have never entered the sync flow. Items that are already queued
        // show the green "מגבה..." state and must not trigger a scary
        // "מה לגבות?" dialog while the debounce/network work is still pending.
        if (getSyncState(contentType, item.id) !== 'unsynced') return false;
        // BUG #1353 fix (2): suppress when an equivalent item is already backed
        // up (synced) in this account — kills the repeated guest-migration nag
        // and the false "duplicate document" dialog for content the user already
        // has on the server. Conservative: only suppresses on a confident match.
        if (_equivalentSyncedItemExists(contentType, item)) return false;
        return true;
    }

    function checkMigration(contentType, localItems) {
        if (!_isLoggedIn()) return;
        try {
            if (sessionStorage.getItem(MIGRATION_DEFERRED_KEY) === '1') return;
        } catch (_) {}
        if (_migrationShownThisLoad[contentType]) return;
        var unsynced = localItems.filter(function(item) {
            return _shouldOfferMigration(contentType, item);
        });
        if (!unsynced.length) return;

        _migrationShownThisLoad[contentType] = true;
        _pendingMigrationItems[contentType] = unsynced;
        if (_migrationPopupTimer) clearTimeout(_migrationPopupTimer);
        _migrationPopupTimer = setTimeout(_flushMigrationPopup, 900);
    }

    // Public probe so other modules (auth.js legacy modal, etc.) can decide
    // whether to defer their own dialog rather than racing the unified popup.
    // SAVE_CONTRACT Phase 1: replaces ad-hoc `document.querySelector('#cs-backup-all')`.
    function isPopupOpen() {
        return !!document.querySelector('#cs-backup-all');
    }

    function _flushMigrationPopup() {
        _migrationPopupTimer = null;
        try {
            if (sessionStorage.getItem(MIGRATION_DEFERRED_KEY) === '1') {
                _pendingMigrationItems = {};
                return;
            }
        } catch (_) {}
        var entries = [];
        var seen = {};
        Object.keys(_pendingMigrationItems).forEach(function(type) {
            (_pendingMigrationItems[type] || []).forEach(function(item) {
                if (_shouldOfferMigration(type, item)) {
                    var key = type + ':' + String(item.id);
                    if (!seen[key]) {
                        seen[key] = true;
                        entries.push({ type: type, item: item });
                    }
                }
            });
        });
        Object.keys(_moduleListers).forEach(function(type) {
            var listed = [];
            try { listed = _moduleListers[type]() || []; } catch (e) { console.warn('[ContentSync] lister failed during unified popup', type, e); }
            listed.forEach(function(item) {
                if (!_shouldOfferMigration(type, item)) return;
                var key = type + ':' + String(item.id);
                if (seen[key]) return;
                seen[key] = true;
                entries.push({ type: type, item: item });
                _migrationShownThisLoad[type] = true;
            });
        });
        _pendingMigrationItems = {};
        if (!entries.length) return;
        _showBackupPopup('mixed', entries);
    }

    // Re-arm the one-shot guard so a fresh login can trigger the popup even
    // though the page already fired checkMigration once on initial load.
    function resetMigrationShown(contentType) {
        try { sessionStorage.removeItem(MIGRATION_DEFERRED_KEY); } catch (_) {}
        if (contentType) delete _migrationShownThisLoad[contentType];
        else _migrationShownThisLoad = {};
    }

    function _deferMigrationForCurrentCycle() {
        try { sessionStorage.setItem(MIGRATION_DEFERRED_KEY, '1'); } catch (_) {}
        if (_migrationPopupTimer) {
            clearTimeout(_migrationPopupTimer);
            _migrationPopupTimer = null;
        }
        _pendingMigrationItems = {};
    }

    function _showBackupPopup(contentType, unsynced) {
        var isMixed = contentType === 'mixed';
        var entries = isMixed ? unsynced : (unsynced || []).map(function(item) { return { type: contentType, item: item }; });
        var domainSummary = _backupDomainSummary(entries);
        var titleText = 'מצאנו ' + entries.length + ' פריטים שלא גובו בענן';
        var overlay = document.createElement('div');
        // z-index must beat the cache-diagnostic banner in index.html
        // (99999), which Amitai reported 2026-04-19 07:29 was covering
        // the popup and swallowing clicks on its buttons so the popup
        // wouldn't close.
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);z-index:100001;display:flex;align-items:center;justify-content:center';

        // Every unsynced item gets a checkbox so the user can opt out of
        // individual items rather than an all-or-nothing "גיבוי הכל".
        var previewHtml = entries.map(function(entry, idx) {
            var item = entry.item;
            var type = entry.type;
            var safeId = String(item.id).replace(/"/g, '&quot;');
            var safeType = String(type).replace(/"/g, '&quot;');
            var titleHtml = _itemDisplayTitle(type, item).replace(/</g, '&lt;');
            var domain = _backupDomainLabel(type, item);
            return '<li style="padding:7px 0;border-bottom:1px solid #f1f5f9;color:#475569;font-size:13px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:6px 8px">' +
                '<input type="checkbox" class="cs-backup-pick" data-id="' + safeId + '" data-type="' + safeType + '" data-idx="' + idx + '" checked ' +
                'style="width:16px;height:16px;accent-color:#0d9488;cursor:pointer;flex-shrink:0">' +
                '<span style="min-width:0;word-break:break-word;color:#1e293b">' + titleHtml + '</span>' +
                '<span style="font-size:11px;font-weight:700;color:#0f766e;background:#ccfbf1;border:1px solid #99f6e4;border-radius:999px;padding:1px 7px;white-space:nowrap">' + domain + '</span>' +
                '</li>';
        }).join('');

        overlay.innerHTML =
            '<div style="background:white;border-radius:18px;width:92%;max-width:470px;max-height:86vh;box-shadow:0 24px 60px rgba(0,0,0,0.28);direction:rtl;overflow:hidden;display:flex;flex-direction:column">' +
                '<div style="padding:18px 22px 8px;text-align:center">' +
                    '<div style="width:42px;height:42px;margin:0 auto 8px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:#ecfeff;border:1px solid #99f6e4;box-shadow:0 6px 18px rgba(13,148,136,.14);font-size:1.35em">☁️</div>' +
                    '<h2 style="margin:0;color:#0f766e;font-size:1.08em;line-height:1.35;font-weight:800">' + titleText + '</h2>' +
                    '<p style="font-size:.84em;color:#64748b;margin:6px auto 0;max-width:360px;line-height:1.45">' + domainSummary + '</p>' +
                '</div>' +
                '<div style="padding:8px 16px 12px;overflow:hidden">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding:0 4px">' +
                        '<span style="font-size:12px;color:#64748b">סמן מה לגבות</span>' +
                        '<button id="cs-backup-toggle-all" style="background:none;border:none;color:#0891b2;font-size:12px;cursor:pointer;font-weight:600;padding:2px 6px">בטל סימון הכל</button>' +
                    '</div>' +
                    '<ul style="list-style:none;margin:0;max-height:245px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px;padding:5px 9px;background:#fff">' + previewHtml + '</ul>' +
                    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px 11px;font-size:12px;color:#64748b;line-height:1.45;margin-top:10px">' +
                        'גיבוי שומר את הפריטים המסומנים בחשבון שלך, ותוכל לגשת אליהם מכל מכשיר.' +
                    '</div>' +
                '</div>' +
                '<div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                    '<button id="cs-backup-all" style="padding:10px 16px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:800;font-size:.9em">גבה נבחרים (' + entries.length + ')</button>' +
                    '<button id="cs-backup-later" style="padding:10px 22px;background:#e2e8f0;color:#475569;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px">לא עכשיו</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        // Query inside the overlay (not document-wide) so if something
        // else re-uses these ids elsewhere we still bind to OUR buttons.
        // Also guards against getElementById returning null when the
        // overlay fails to mount — Amitai 2026-04-19 07:29 reported the
        // buttons not responding.
        var btnBackup = overlay.querySelector('#cs-backup-all');
        var btnLater = overlay.querySelector('#cs-backup-later');
        var btnToggle = overlay.querySelector('#cs-backup-toggle-all');
        if (!btnBackup || !btnLater || !btnToggle) {
            console.error('[ContentSync] _showBackupPopup: button lookup failed, removing overlay');
            overlay.remove();
            return;
        }

        btnLater.onclick = function() {
            // "לא עכשיו" dismisses only this login/user-switch cycle.
            // Real guest work should be offered again on a future login
            // until it is backed up, handled, or deleted.
            _deferMigrationForCurrentCycle();
            overlay.remove();
        };
        // Click on the dim backdrop (outside the white card) dismisses too.
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                _deferMigrationForCurrentCycle();
                overlay.remove();
            }
        });

        function _checkboxes() {
            return Array.prototype.slice.call(overlay.querySelectorAll('.cs-backup-pick'));
        }
        function _pickedIds() {
            return _checkboxes().filter(function(cb) { return cb.checked; }).map(function(cb) {
                return { type: cb.dataset.type || contentType, id: cb.dataset.id };
            });
        }
        function _refreshCount() {
            var n = _pickedIds().length;
            btnBackup.disabled = n === 0;
            btnBackup.style.opacity = n === 0 ? '0.5' : '1';
            btnBackup.textContent = 'גבה נבחרים (' + n + ')';
            var allChecked = n === _checkboxes().length;
            btnToggle.textContent = allChecked ? 'בטל סימון הכל' : 'סמן הכל';
        }
        _checkboxes().forEach(function(cb) { cb.addEventListener('change', _refreshCount); });
        btnToggle.onclick = function() {
            var allChecked = _checkboxes().every(function(cb) { return cb.checked; });
            _checkboxes().forEach(function(cb) { cb.checked = !allChecked; });
            _refreshCount();
        };
        _refreshCount();

        function _runBackup() {
            var ids = _pickedIds();
            if (!ids.length) return;
            btnBackup.disabled = true;
            btnBackup.textContent = 'בתהליך גיבוי...';
            btnBackup.style.background = '#94a3b8';
            (async function() {
                try {
                    var result = await _syncPicked(ids);
                    var succeeded = result.succeeded;
                    var attempted = result.attempted;
                    var errors = result.errors;
                    ids.forEach(function(pick) { _fireChange(pick.type, null); });
                    if (errors.length === 0 && succeeded === attempted) {
                        btnBackup.textContent = '✓ גובו ' + succeeded;
                        btnBackup.style.background = '#059669';
                        _focusSyncedPick(ids);
                        setTimeout(function() { overlay.remove(); }, 900);
                        return;
                    }
                    var firstErr = errors[0] || 'שגיאה לא ידועה';
                    var authErr = firstErr.indexOf('נדרשת התחברות') !== -1 || firstErr.indexOf('לא מחובר') !== -1;
                    if (authErr) {
                        // Server rejects the stored token even though the
                        // client thinks it's logged in. Clear the stale
                        // token and reload so auth_widget.js walks the
                        // normal onGuest → 'התחבר' path. User can log in
                        // again and re-try the backup.
                        btnBackup.textContent = 'פג תוקף — לחץ להתחברות מחדש';
                        btnBackup.style.background = '#dc2626';
                        btnBackup.disabled = false;
                        btnBackup.onclick = function() {
                            try {
                                localStorage.removeItem('plonter_auth_token');
                                localStorage.removeItem('plonter_auth_token_user');
                            } catch(_) {}
                            location.reload();
                        };
                    } else {
                        btnBackup.textContent = 'שגיאה — ' + firstErr + (succeeded ? ' (' + succeeded + '/' + attempted + ' גובו)' : '');
                        btnBackup.style.background = '#dc2626';
                        btnBackup.disabled = false;
                    }
                } catch(e) {
                    console.error('[ContentSync] syncAll failed:', e);
                    btnBackup.textContent = 'שגיאה — ' + (e && e.message ? e.message : 'נסה שוב');
                    btnBackup.style.background = '#dc2626';
                    btnBackup.disabled = false;
                }
            })();
        }

        btnBackup.onclick = _runBackup;
    }

    async function _syncPicked(picks) {
        var byType = {};
        (picks || []).forEach(function(pick) {
            if (!pick || !pick.type || pick.id == null) return;
            if (!byType[pick.type]) byType[pick.type] = [];
            byType[pick.type].push(pick.id);
        });
        var attempted = 0;
        var succeeded = 0;
        var errors = [];
        var types = Object.keys(byType);
        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            var res = await syncAll(type, byType[type]);
            attempted += (res && res.attempted) || 0;
            succeeded += (res && res.succeeded) || 0;
            if (res && res.errors && res.errors.length) errors = errors.concat(res.errors);
        }
        return { attempted: attempted, succeeded: succeeded, errors: errors };
    }

    function _focusSyncedPick(picks) {
        var first = (picks || [])[0];
        if (!first) return;
        var mode = _tabForContentType(first.type);
        if (mode && typeof window.switchWelcomeTab === 'function') {
            try { window.switchWelcomeTab(mode); } catch (_) {}
        }
        setTimeout(function() {
            try {
                _renderForContentType(first.type);
                _highlightSyncedCard(first.type, first.id);
            } catch (e) { console.warn('[ContentSync] focus synced item failed', e); }
        }, 180);
    }

    function _tabForContentType(contentType) {
        if (contentType === 'lesson') return 'lessons';
        if (contentType === 'text') return 'texts';
        if (contentType === 'sentence') return 'analysis';
        return null;
    }

    function _renderForContentType(contentType) {
        if (contentType === 'lesson' && typeof LessonManager !== 'undefined' && LessonManager.renderLessonsList) {
            LessonManager.renderLessonsList();
        } else if (contentType === 'text' && typeof PlonterTexts !== 'undefined' && PlonterTexts.renderList) {
            PlonterTexts.renderList();
        } else if (contentType === 'sentence' && typeof Modals !== 'undefined' && Modals.renderStages) {
            Modals.renderStages();
        }
    }

    function _highlightSyncedCard(contentType, localId) {
        var selectors = _cardSelectorsForContentType(contentType);
        for (var i = 0; i < selectors.length; i++) {
            var container = document.querySelector(selectors[i]);
            if (!container) continue;
            var cards = Array.prototype.slice.call(container.querySelectorAll('.stage-item'));
            for (var j = 0; j < cards.length; j++) {
                var card = cards[j];
                var sig = _cardSignature(card);
                if (sig && sig === _itemSignature(contentType, localId)) {
                    _animateSyncedCard(card);
                    return;
                }
            }
        }
        var fallback = document.querySelector(_tabContainerSelector(contentType) + ' .stage-item');
        if (fallback) _animateSyncedCard(fallback);
    }

    function _cardSelectorsForContentType(contentType) {
        if (contentType === 'lesson') return ['#lessons-list'];
        if (contentType === 'text') return ['#texts-list'];
        if (contentType === 'sentence') return ['#stages-custom', '#stages-hindus', '.analysis-section-welcome .stages-list', '.hindus-section-welcome .stages-list'];
        return [];
    }

    function _tabContainerSelector(contentType) {
        if (contentType === 'lesson') return '#lessons-list';
        if (contentType === 'text') return '#texts-list';
        return '#welcome-screen';
    }

    function _itemSignature(contentType, localId) {
        var getter = _moduleGetters[contentType];
        var item = getter ? getter(localId) : null;
        if (!item) return '';
        return _itemDisplayTitle(contentType, item).replace(/\s+/g, ' ').trim();
    }

    function _cardSignature(card) {
        var el = card && card.querySelector ? card.querySelector('.stage-number') : null;
        return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
    }

    function _animateSyncedCard(card) {
        if (!card) return;
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.classList.remove('cs-just-backed-up');
        void card.offsetWidth;
        card.classList.add('cs-just-backed-up');
        setTimeout(function() { try { card.classList.remove('cs-just-backed-up'); } catch (_) {} }, 1800);
    }

    var TYPE_LABELS = {
        lesson:     'שיעורים',
        analysis:   'ניתוחים',
        text:       'טקסטים',
        engineering:'הינדוסים',
        hindus:     'הינדוסים',
        vocabulary: 'אוצר מילים',
        vocab:      'אוצר מילים',
        flashcard:  'כרטיסיות',
        media:      'מדיה',
        sentence:   'משפטים'
    };

    function _backupDomainLabel(contentType, item) {
        if (contentType === 'lesson') return 'שיעור';
        if (contentType === 'text') return 'טקסט';
        if (contentType === 'engineering' || contentType === 'hindus') return 'הינדוס';
        if (contentType === 'vocab' || contentType === 'vocabulary') return 'אוצר מילים';
        if (contentType === 'flashcard') return 'כרטיסיות';
        if (contentType === 'media') return 'מדיה';
        if (contentType === 'sentence') {
            if (item && (item.isHindus === true || item.category === 'hindus' || item.source_domain === 'hindus')) return 'הינדוס';
            if (item && (item.lessonId || item.lesson_id || item.sourceLessonId || item.source_domain === 'lesson')) return 'שיעור';
            if (item && (item.textId || item.text_id || item.sourceTextId || item.source_domain === 'text')) return 'טקסט';
            return 'תחביר';
        }
        return TYPE_LABELS[contentType] || contentType;
    }

    function _backupDomainSummary(entries) {
        var counts = {};
        (entries || []).forEach(function(entry) {
            var label = _backupDomainLabel(entry.type, entry.item);
            counts[label] = (counts[label] || 0) + 1;
        });
        return Object.keys(counts).map(function(label) {
            return label + ': ' + counts[label];
        }).join(' · ');
    }

    // Human-readable label for the migration popup checkbox list. Each
    // content type has its own preferred "title" field — lesson/text use
    // .title, but custom stages use .number/.name/.sentence. Without this,
    // stages fell back to "#custom_<timestamp>" which left Amitai unable
    // to tell which item he was approving (screenshot 2026-04-19 08:58).
    function _itemDisplayTitle(contentType, item) {
        // Analysis items push title='default' from analysesSync._itemTitle when
        // the analysisId is the default slot — useless to the user. Resolve to
        // stage label via source_id (Amitai screenshot 2026-05-13 09:51 showed
        // 6 'default' rows). Lookup is best-effort: if getStageById is missing
        // or returns nothing, fall through to the generic title path.
        if (contentType === 'analysis') {
            var sid = item.source_id;
            var stage = (sid && typeof getStageById === 'function') ? getStageById(sid) : null;
            var stageLabel = stage ? (stage.number || stage.name || String(stage.sentence || '').slice(0, 40)) : null;
            var aid = String(item.title || item.analysisId || '');
            if (stageLabel && aid && aid !== 'default') return stageLabel + ' · ' + aid;
            if (stageLabel) return stageLabel;
            if (aid && aid !== 'default') return aid;
            return 'ניתוח ללא שם';
        }
        if (item.title) return String(item.title);
        if (contentType === 'sentence') {
            if (item.number) return String(item.number);
            if (item.name) return String(item.name);
            if (item.sentence) {
                var s = String(item.sentence).trim();
                return s.length > 50 ? s.slice(0, 50) + '…' : s;
            }
            return 'משפט ללא שם';
        }
        if (contentType === 'text') return item.name ? String(item.name) : 'טקסט ללא שם';
        if (contentType === 'lesson') return item.name ? String(item.name) : 'שיעור ללא שם';
        return '#' + item.id;
    }

    // --- Sync all unsynced items of a type ---

    async function syncAll(contentType, onlyIds) {
        var getter = _moduleGetters[contentType];
        var listFn = _moduleListers[contentType];
        if (!getter || !listFn) {
            console.warn('[ContentSync] syncAll: no getter/lister registered for', contentType);
            return { attempted: 0, succeeded: 0, errors: ['מודול לא רשום: ' + contentType] };
        }

        var items = listFn();
        var filter = (onlyIds && onlyIds.length) ? new Set(onlyIds.map(String)) : null;
        var attempted = 0;
        var succeeded = 0;
        var errors = [];

        for (var i = 0; i < items.length; i++) {
            if (filter && !filter.has(String(items[i].id))) continue;
            if (!isSynced(contentType, items[i].id)) {
                attempted++;
                // syncNow returns the API response; we can report real errors.
                var res = await syncNow(contentType, items[i].id);
                if (res && res.success) {
                    succeeded++;
                } else {
                    var msg = (res && res.error) ? res.error : 'שגיאה לא ידועה';
                    errors.push(msg);
                    // Bail on auth errors — user needs to re-login
                    if (msg.indexOf('נדרשת התחברות') !== -1 || msg.indexOf('לא מחובר') !== -1) break;
                }
            }
        }

        console.log('[ContentSync] syncAll(' + contentType + '): attempted=' + attempted + ', succeeded=' + succeeded + ', errors=' + errors.length);
        return { attempted: attempted, succeeded: succeeded, errors: errors };
    }

    var _moduleListers = {};

    function registerLister(contentType, lister) {
        _moduleListers[contentType] = lister;
    }

    // --- Auto-integrate with lessons.js ---
    // After DOM ready, hook into LessonManager if available

    function _integrateLessons() {
        if (typeof LessonManager === 'undefined') return;

        // Register lessons module
        registerModule('lesson',
            // getter: get lesson by id
            function(lessonId) {
                if (typeof LessonManager.loadLessons !== 'function') return null;
                var lessons = LessonManager.loadLessons();
                return lessons.find(function(l) { return l.id === lessonId; }) || null;
            },
            // setter: update local lesson from server data
            function(lessonId, serverData) {
                if (typeof LessonManager.loadLessons !== 'function') return;
                var lessons = LessonManager.loadLessons();
                var idx = lessons.findIndex(function(l) { return l.id === lessonId; });
                if (idx >= 0) {
                    lessons[idx] = Object.assign(lessons[idx], {
                        title: serverData.title,
                        data: serverData.data,
                        updated: serverData.updated
                    });
                    LessonManager.saveLessons(lessons);
                }
            }
        );

        registerLister('lesson', function() {
            return typeof LessonManager.loadLessons === 'function' ? LessonManager.loadLessons() : [];
        });

        // Poll-based sync: detect localStorage changes every 5 seconds
        var _lastLessonsHash = '';

        function _hashLessons(lessons) {
            return lessons.map(function(l) { return l.id + ':' + (l.updated || ''); }).join('|');
        }

        function _pollLessonsForChanges() {
            if (!_isLoggedIn()) return;
            if (typeof LessonManager.loadLessons !== 'function') return;

            var lessons = LessonManager.loadLessons();
            var hash = _hashLessons(lessons);

            if (_lastLessonsHash && hash !== _lastLessonsHash) {
                // Something changed — re-queue lessons that were previously
                // synced and have local edits since. Lessons without any
                // meta (e.g. created while guest) are NOT auto-queued: the
                // user must opt into backing them up via the migration
                // popup or the per-lesson ☁️ button. Without this guard,
                // simply logging in would silently push guest drafts to the
                // server, skipping the "מה לגבות" dialog.
                lessons.forEach(function(lesson) {
                    if (!lesson || !lesson.id) return;
                    var meta = _getItemMeta('lesson', lesson.id);
                    if (!meta) return; // never synced — leave it alone
                    if (!meta.synced || meta.localUpdated !== lesson.updated) {
                        save('lesson', lesson.id, lesson);
                    }
                });
            }

            _lastLessonsHash = hash;
        }

        // Start polling
        _lastLessonsHash = _hashLessons(
            typeof LessonManager.loadLessons === 'function' ? LessonManager.loadLessons() : []
        );
        setInterval(_pollLessonsForChanges, 5000);

        // Check for unsynced lessons on load — fire ASAP so the popup appears
        // without requiring user interaction. Small 250ms delay lets the
        // initial welcome-screen paint settle before we overlay a modal.
        setTimeout(function() {
            if (_isLoggedIn() && typeof LessonManager.loadLessons === 'function') {
                // BUG 7 — adopt legacy-backed lessons first (one-shot), THEN
                // offer the migration popup so already-adopted lessons aren't
                // shown as "unsynced".
                _adoptLegacyLessonsOnce().then(function() {
                    checkMigration('lesson', LessonManager.loadLessons());
                }).catch(function() {
                    checkMigration('lesson', LessonManager.loadLessons());
                });
            }
        }, 250);
    }

    function _integrateTexts() {
        if (typeof PlonterTexts === 'undefined') return;
        registerStorageKey('text', PlonterTexts.STORAGE_KEY || 'plonter_texts');
        registerModule('text',
            function(textId) {
                if (typeof PlonterTexts._getAll !== 'function') return null;
                var items = PlonterTexts._getAll();
                return items.find(function(t) { return t.id === textId; }) || null;
            },
            function(textId, serverData) {
                if (typeof PlonterTexts._getAll !== 'function' || typeof PlonterTexts._saveAll !== 'function') return;
                var items = PlonterTexts._getAll();
                var idx = items.findIndex(function(t) { return t.id === textId; });
                var data = serverData.data;
                if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
                if (!data) return;
                if (idx >= 0) {
                    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) items[idx][k] = data[k];
                    items[idx].updated = serverData.updated;
                } else {
                    items.push(data);
                }
                PlonterTexts._saveAll(items);
            }
        );
        function _isBuiltinText(t) {
            if (!t) return false;
            if (t._isBuiltinSeed === true) return true;
            // id-prefix fallback covers users whose demo was seeded
            // before the flag landed (2026-04-19 07:40).
            return typeof t.id === 'string' && t.id.indexOf('txt_demo_') === 0;
        }
        registerLister('text', function() {
            var all = typeof PlonterTexts._getAll === 'function' ? PlonterTexts._getAll() : [];
            return all.filter(function(t) { return !_isBuiltinText(t); });
        });

        // Post-login migration popup + background pull. Like lessons, but
        // we don't run our own poll here — PlonterTexts._saveAll calls
        // ContentSync.save directly on every mutation so no drift pollinator
        // is needed.
        setTimeout(function() {
            if (_isLoggedIn()) {
                var items = PlonterTexts._getAll ? PlonterTexts._getAll() : [];
                checkMigration('text', items.filter(function(t) { return !_isBuiltinText(t); }));
            }
        }, 260);
    }

    function _integrateSentences() {
        if (typeof getCustomStages !== 'function') return;
        registerStorageKey('sentence', 'plonter_custom_stages');
        registerModule('sentence',
            function(id) {
                var items = getCustomStages();
                var found = items.find(function(s) { return s.id === id; });
                if (!found) return null;
                // ContentSync expects a .title field for display; sentences
                // use .number. Clone + fill so the server row gets the
                // human-readable label instead of the raw seed id.
                if (!found.title) {
                    var clone = Object.assign({}, found);
                    clone.title = found.number || found.sentence || id;
                    return clone;
                }
                return found;
            },
            function(id, serverData) {
                var items = getCustomStages();
                var idx = items.findIndex(function(s) { return s.id === id; });
                var data = serverData.data;
                if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
                if (!data) return;
                if (idx >= 0) {
                    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) items[idx][k] = data[k];
                } else {
                    items.push(data);
                }
                saveCustomStages(items);
            }
        );
        registerLister('sentence', function() {
            // Built-in seeds (_isBuiltinSeed) are local-only per Amitai
            // 2026-04-19 05:06 — never surfaced to the sync queue or
            // backup popup. Hindus items now sync like syntax (Amitai
            // 2026-04-19 05:20 opened the gate).
            // id-prefix fallback covers users seeded before the
            // flag was added (2026-04-19 07:25).
            return getCustomStages().filter(function(s) {
                if (s._isBuiltinSeed === true) return false;
                if (typeof s.id === 'string' && (s.id.indexOf('seed_') === 0 || s.id.indexOf('guestseed_') === 0)) return false;
                return true;
            });
        });

        setTimeout(function() {
            if (_isLoggedIn()) {
                // Exclude built-in seeds — Amitai 2026-04-19 07:23
                // saw the "גיבוי לשרת" popup asking to backup 22
                // seed_<userId>_workbook_* items that ship in STAGES.
                // They're per-user copies but already live in the
                // app bundle / server, no point queuing for push.
                // Once the user edits one, modals.js strips
                // _isBuiltinSeed and the edited copy becomes a real
                // user item that flows through sync.
                checkMigration('sentence', getCustomStages().filter(function(s) {
                    if (s._isBuiltinSeed === true) return false;
                    // id-prefix fallback for users seeded before
                    // 2026-04-19: their auth.js ran without the
                    // _isBuiltinSeed flag so their seed_<userId>_
                    // items still slip through. Recognise the id
                    // pattern explicitly — matches both user
                    // (seed_<id>_<bucket>_...) and guest
                    // (guestseed_<bucket>_...).
                    if (typeof s.id === 'string' && (s.id.indexOf('seed_') === 0 || s.id.indexOf('guestseed_') === 0)) return false;
                    return true;
                }));
            }
        }, 280);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(_integrateLessons, 0);
            setTimeout(_integrateTexts, 0);
            setTimeout(_integrateSentences, 0);
        });
    } else {
        setTimeout(_integrateLessons, 0);
        setTimeout(_integrateTexts, 0);
        setTimeout(_integrateSentences, 0);
    }

    // --- Public API ---

    return {
        save: save,
        syncNow: syncNow,
        isSynced: isSynced,
        getSyncState: getSyncState,
        hasPendingDeletes: hasPendingDeletes,
        isLoggedIn: _isLoggedIn,
        getSyncBadge: getSyncBadge,
        syncAll: syncAll,
        pullAll: pullAll,
        deleteItem: deleteItem,
        // SAVE_CONTRACT Phase 3 — `delete` is the documented name in the
        // adapter contract. Alias keeps both call sites valid.
        'delete': deleteItem,
        registerStorageKey: registerStorageKey,
        resetMigrationShown: resetMigrationShown,
        // BUG 7 — one-shot legacy → content_api adopter; safe to call on every
        // login/auth-change (no-op after the first successful run).
        runLegacyLessonAdopter: _adoptLegacyLessonsOnce,
        registerModule: registerModule,
        registerLister: registerLister,
        registerPuller: registerPuller,
        checkMigration: checkMigration,
        isPopupOpen: isPopupOpen,
        // SAVE_CONTRACT Phase 3 — adapter subscription + normalized state.
        onSyncStateChange: onSyncStateChange,
        getNormalizedSyncState: getNormalizedSyncState,
        processQueue: _processQueue
    };
})();
