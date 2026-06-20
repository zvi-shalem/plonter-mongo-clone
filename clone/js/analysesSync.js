/**
 * AnalysesSync — syntax analyses ↔ ContentSync bridge.
 *
 * 2026-04-24: refactored to sit on top of SyncBridge (shared scaffolding
 * for all per-item sync modules). The composite id '<stageId>::<analysisId>'
 * and the per-storage-key layout remain local — they are analysis-specific
 * details the bridge does not know about.
 *
 * Storage layout (existing, owned by persistence.js):
 *   key: plonter_v4_stage_<stageId>_analysis_<analysisId>
 *   val: { savedAt: <ms epoch>, analysisId, words, combinations, arches, ...}
 *
 * Unified-table wire shape (per @6m 2026-04-19 16:50):
 *   { content_type: 'analysis',
 *     source_id:    stageId,          // e.g. 'custom_1776...' or 'srv_123'
 *     title:        analysisId,       // 'default', 'ניסיון 2'
 *     data:         <full entry JSON> }
 *
 * Composite id '<stageId>::<analysisId>' is INTERNAL for meta tracking
 * (plonter_analyses_cs_meta). It does NOT go over the wire.
 *
 * Public callers (persistence.js, modals.js):
 *   AnalysesSync.onAnalysisSaved(stageId, analysisId)
 *   AnalysesSync.onAnalysisDeleted(stageId, analysisId)
 *   AnalysesSync.onStageWordTextsPatched(stageId)
 *   AnalysesSync.getBadge(stageId, analysisId)
 *   AnalysesSync.getSyncState(stageId, analysisId)
 *   AnalysesSync.stampAnalysis(stageId, analysisId)
 *   AnalysesSync.syncAllAnalyses()
 */
var AnalysesSync = (function() {
    'use strict';

    var KEY_PREFIX = 'plonter_v4_stage_';
    var KEY_MIDDLE = '_analysis_';

    function _compositeId(stageId, analysisId) {
        return String(stageId) + '::' + String(analysisId);
    }

    function _parseComposite(composite) {
        var idx = String(composite).indexOf('::');
        if (idx < 0) return null;
        return {
            stageId:    composite.slice(0, idx),
            analysisId: composite.slice(idx + 2)
        };
    }

    function _storageKey(stageId, analysisId) {
        return KEY_PREFIX + stageId + KEY_MIDDLE + analysisId;
    }

    function _readEntry(stageId, analysisId) {
        try {
            var raw = localStorage.getItem(_storageKey(stageId, analysisId));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (_) { return null; }
    }

    function _writeEntry(stageId, analysisId, data) {
        try {
            localStorage.setItem(_storageKey(stageId, analysisId), JSON.stringify(data));
            return true;
        } catch (e) {
            console.warn('[AnalysesSync] _writeEntry failed', e);
            return false;
        }
    }

    function _itemTitle(analysisId) {
        return String(analysisId || 'default');
    }

    // ContentSync protocol: getter(compositeId) → item
    function _getItem(compositeId) {
        var parsed = _parseComposite(compositeId);
        if (!parsed) return null;
        var entry = _readEntry(parsed.stageId, parsed.analysisId);
        if (!entry) return null;
        var meta = _bridge.getMeta();
        var updated = entry.savedAt
            ? new Date(entry.savedAt).toISOString()
            : (meta[compositeId] || new Date().toISOString());
        return {
            id:        compositeId,
            title:     _itemTitle(parsed.analysisId),
            source_id: String(parsed.stageId),
            updated:   updated,
            data:      entry
        };
    }

    function _setItem(compositeId, serverItem) {
        var parsed = _parseComposite(compositeId);
        if (!parsed) return;
        var data = serverItem && serverItem.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
        if (!data) return;
        if (serverItem.updated && !data.savedAt) {
            data.savedAt = Date.parse(serverItem.updated) || Date.now();
        }
        _writeEntry(parsed.stageId, parsed.analysisId, data);
        var m = _bridge.getMeta();
        m[compositeId] = serverItem.updated || new Date().toISOString();
        _bridge.setMeta(m);
    }

    function _listItems() {
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
                var mid = k.indexOf(KEY_MIDDLE);
                if (mid < 0) continue;
                var stageId = k.slice(KEY_PREFIX.length, mid);
                var analysisId = k.slice(mid + KEY_MIDDLE.length);
                if (!stageId || !analysisId) continue;
                var entry = null;
                try { entry = JSON.parse(localStorage.getItem(k)); } catch (_) {}
                var composite = _compositeId(stageId, analysisId);
                out.push({
                    id:      composite,
                    title:   _itemTitle(analysisId),
                    updated: (entry && entry.savedAt)
                        ? new Date(entry.savedAt).toISOString()
                        : null
                });
            }
        } catch (_) {}
        return out;
    }

    // Custom puller — contentSync's generic pullAll assumes a flat-array
    // storage key (plonter_lessons, plonter_texts). Analyses live one per
    // localStorage key, so we own the pull flow and reuse the composite id.
    async function _pull(ctx) {
        var api = ctx && ctx.api;
        var setItemMeta = ctx && ctx.setItemMeta;
        if (typeof api !== 'function') return { loaded: 0, error: 'no api' };
        var res = await api('list', { content_type: 'analysis' });
        if (!res || !res.success) return { loaded: 0, error: (res && res.error) || 'list failed' };
        var items = res.items || [];
        var loaded = 0;
        for (var i = 0; i < items.length; i++) {
            var srv = items[i];
            if (!srv || !srv.source_id) continue;
            var analysisId = srv.title || 'default';
            var composite = _compositeId(srv.source_id, analysisId);
            _setItem(composite, srv);
            if (typeof setItemMeta === 'function') {
                setItemMeta('analysis', composite, {
                    synced: true,
                    serverId: srv.id,
                    lastServerUpdated: srv.updated
                });
            }
            loaded++;
        }
        return { loaded: loaded, serverCount: items.length };
    }

    // Create the bridge — handles meta JSON, registration with ContentSync,
    // and the generic save/delete/syncAll delegation.
    var _bridge = new SyncBridge({
        contentType: 'analysis',
        metaKey:     'plonter_analyses_cs_meta',
        getItem:     _getItem,
        setItem:     _setItem,
        listItems:   _listItems,
        pull:        _pull,
    });

    // Public API — callers pass (stageId, analysisId) and we compose internally.

    function stampAnalysis(stageId, analysisId) {
        _bridge.stampItem(_compositeId(stageId, analysisId));
    }

    function onAnalysisSaved(stageId, analysisId) {
        _bridge.save(_compositeId(stageId, analysisId));
    }

    function onAnalysisDeleted(stageId, analysisId) {
        _bridge.deleteItem(_compositeId(stageId, analysisId));
    }

    // Bulk mutation across N analyses for one stage — fire one save per key.
    function onStageWordTextsPatched(stageId) {
        var prefix = KEY_PREFIX + stageId + KEY_MIDDLE;
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k.indexOf(prefix) !== 0) continue;
            var analysisId = k.slice(prefix.length);
            if (analysisId) onAnalysisSaved(stageId, analysisId);
        }
    }

    function getBadge(stageId, analysisId) {
        return _bridge.getBadge(_compositeId(stageId, analysisId));
    }

    function getSyncState(stageId, analysisId) {
        return _bridge.getSyncState(_compositeId(stageId, analysisId));
    }

    function syncAllAnalyses() {
        return _bridge.syncAll();
    }

    return {
        getBadge:                 getBadge,
        getSyncState:             getSyncState,
        stampAnalysis:            stampAnalysis,
        onAnalysisSaved:          onAnalysisSaved,
        onAnalysisDeleted:        onAnalysisDeleted,
        onStageWordTextsPatched:  onStageWordTextsPatched,
        syncAllAnalyses:          syncAllAnalyses
    };
})();
