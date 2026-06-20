// AnalysisAdapter — SAVE_CONTRACT Phase 3 adapter for syntax analyses.
//
// Built on @3's window.AdapterBase factory (js/adapters/AdapterBase.js).
// Owns the surface for content_type='analysis' against the unified content
// table layout described in SAVE_CONTRACT.md §1–§4.
//
// Composite id scheme: '<stageId>:<analysisId>' (single colon — SAVE_CONTRACT
// §1 Layer 1 note 5). The colon split is the adapter's contract id; the
// legacy AnalysesSync bridge uses '::' internally for its own meta and is
// untouched here (Phase 4 will retire AnalysesSync once all callers move to
// adapter.save / adapter.delete).
//
// Storage layout (legacy, owned by persistence.js + analysesSync.js):
//   key: plonter_v4_stage_<stageId>_analysis_<analysisId>
//   val: { savedAt, analysisId, words, combinations, arches, ... }
// The adapter reads/writes the same keys so existing data stays visible.
//
// What this file does (per ADAPTER_CONTRACT.md):
//   - registers a lister + getter with ContentSync (via AdapterBase.onMount)
//   - subscribes to ContentSync.onSyncStateChange and fans the four-state
//     machine ('unsynced' | 'backing_up' | 'backed_up' | 'failed') back to
//     the stage card via the default AdapterBase.renderCardState
//   - exposes split / join helpers so other adapters / tests can address
//     analyses by composite id without re-implementing the parser
//
// What this file does NOT do:
//   - render stage cards itself (Modals.renderStages still owns the DOM;
//     Phase 3 lets the existing flow handle it and only adds the pulse
//     state via findCardForId).
//   - edit persistence.js / contentSync.js / modals.js / AdapterBase.js
//     (owned by @3 + already-shipped Phase 3 surface).
//   - touch index.html (the <script> tag for this file is registered by @3
//     in the Phase 3 bundle window — adapter writers DO NOT edit index.html
//     per @6m חוק 3).
//
// Authoring: @4t worker 1 (2026-05-13). Pure render/UI/state — no new
// save-flow / auth / contentSync / user-switch logic introduced; the adapter
// merely wraps the existing AnalysesSync + ContentSync paths under the
// SAVE_CONTRACT surface.

(function() {
    'use strict';

    var TYPE = 'analysis';
    var KEY_PREFIX = 'plonter_v4_stage_';
    var KEY_MIDDLE = '_analysis_';

    // ---- composite-id helpers ------------------------------------------------

    function _splitId(id) {
        if (!id && id !== 0) return null;
        var s = String(id);
        var idx = s.indexOf(':');
        if (idx < 0) return null;
        var stageId = s.slice(0, idx);
        var analysisId = s.slice(idx + 1);
        if (!stageId || !analysisId) return null;
        return { stageId: stageId, analysisId: analysisId };
    }

    function _joinId(stageId, analysisId) {
        return String(stageId) + ':' + String(analysisId);
    }

    function _storageKey(stageId, analysisId) {
        return KEY_PREFIX + stageId + KEY_MIDDLE + analysisId;
    }

    // ---- localStorage read/write ---------------------------------------------

    function _readEntry(stageId, analysisId) {
        try {
            var raw = localStorage.getItem(_storageKey(stageId, analysisId));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[AnalysisAdapter] _readEntry parse fail', stageId, analysisId, e);
            return null;
        }
    }

    function _writeEntry(stageId, analysisId, data) {
        try {
            localStorage.setItem(_storageKey(stageId, analysisId), JSON.stringify(data));
            return true;
        } catch (e) {
            console.warn('[AnalysisAdapter] _writeEntry failed', stageId, analysisId, e);
            return false;
        }
    }

    // ---- adapter methods -----------------------------------------------------

    // list() — cross-stage scan of all plonter_v4_stage_<X>_analysis_<Y> keys.
    // Returns SAVE_CONTRACT items shape: { id (composite), stageId, analysisId,
    // savedAt, title }. Used by ContentSync.registerLister, the migration
    // popup, and ContentSync.pullAll merging.
    function _list() {
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
                out.push({
                    id:         _joinId(stageId, analysisId),
                    stageId:    stageId,
                    analysisId: analysisId,
                    savedAt:    entry && typeof entry.savedAt === 'number' ? entry.savedAt : null,
                    title:      analysisId
                });
            }
        } catch (e) {
            console.warn('[AnalysisAdapter] list scan failed', e);
        }
        // Newest first — matches Persistence.listAnalyses ordering so the
        // migration popup + welcome screen agree on which analysis is "last
        // touched" for a given stage.
        out.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        return out;
    }

    // get(id) / load(id) — pure data fetch, no state-machine side effects.
    // Persistence.load(stageId, analysisId) loads the analysis INTO the active
    // StateManager (side-effectful); the adapter contract demands a plain
    // data return, so we read the localStorage entry directly.
    function _get(id) {
        var p = _splitId(id);
        if (!p) return null;
        return _readEntry(p.stageId, p.analysisId);
    }

    // save(id, data) → Promise
    // Flow:
    //   1. Parse composite, stamp savedAt + analysisId.
    //   2. Write the localStorage entry (legacy schema — adapter is the
    //      writer until Phase 4 migrates to the unified content_v3 key).
    //   3. Fire AnalysesSync.onAnalysisSaved so the existing per-item bridge
    //      (badges, modals duplicate/import, AnalysesSync.syncAllAnalyses)
    //      keeps working unchanged. AnalysesSync uses its own '::' composite
    //      internally — coexists with our ':' adapter composite without
    //      conflict on the wire (source_id + title carry the truth).
    //   4. Fire ContentSync.save under the adapter's ':' composite so the
    //      SAVE_CONTRACT four-state pulse subscribes through
    //      onSyncStateChange (AdapterBase's default onMount fan-out picks
    //      it up and calls renderCardState(findCardForId(id), state)).
    function _save(id, data) {
        var p = _splitId(id);
        if (!p) return Promise.resolve(false);
        var payload = {};
        if (data && typeof data === 'object') {
            for (var k in data) {
                if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
            }
        }
        payload.savedAt = Date.now();
        payload.analysisId = p.analysisId;
        if (!_writeEntry(p.stageId, p.analysisId, payload)) {
            return Promise.reject(new Error('[AnalysisAdapter] save: localStorage write failed'));
        }
        try {
            if (typeof AnalysesSync !== 'undefined' && AnalysesSync && typeof AnalysesSync.onAnalysisSaved === 'function') {
                AnalysesSync.onAnalysisSaved(p.stageId, p.analysisId);
            }
        } catch (e) {
            console.warn('[AnalysisAdapter] AnalysesSync.onAnalysisSaved threw', e);
        }
        var cs = (typeof window !== 'undefined') ? window.ContentSync : null;
        if (cs && typeof cs.save === 'function') {
            try {
                cs.save(TYPE, id, payload);
                if (typeof cs.processQueue === 'function') cs.processQueue();
            } catch (e) {
                console.warn('[AnalysisAdapter] ContentSync.save threw', e);
            }
        }
        return Promise.resolve(true);
    }

    // delete(id) → Promise
    // Prefer Persistence.deleteAnalysis when the global PersistenceManager
    // instance is up — it owns the legacy delete path and already fires
    // AnalysesSync.onAnalysisDeleted internally. Falls back to a direct LS
    // removal + manual AnalysesSync notification if persistence isn't
    // available yet (very-early page lifecycle, tests).
    function _delete(id) {
        var p = _splitId(id);
        if (!p) return Promise.resolve(false);
        var didLocal = false;
        try {
            if (typeof persistence !== 'undefined' && persistence &&
                typeof persistence.deleteAnalysis === 'function') {
                persistence.deleteAnalysis(p.stageId, p.analysisId);
                didLocal = true;
            }
        } catch (e) {
            console.warn('[AnalysisAdapter] persistence.deleteAnalysis threw', e);
        }
        if (!didLocal) {
            try { localStorage.removeItem(_storageKey(p.stageId, p.analysisId)); } catch (_) {}
            try {
                if (typeof AnalysesSync !== 'undefined' && AnalysesSync &&
                    typeof AnalysesSync.onAnalysisDeleted === 'function') {
                    AnalysesSync.onAnalysisDeleted(p.stageId, p.analysisId);
                }
            } catch (_) {}
        }
        var cs = (typeof window !== 'undefined') ? window.ContentSync : null;
        var fn = cs && (typeof cs['delete'] === 'function' ? cs['delete']
                        : (typeof cs.deleteItem === 'function' ? cs.deleteItem : null));
        if (fn) {
            try { return Promise.resolve(fn(TYPE, id)); }
            catch (e) {
                console.warn('[AnalysisAdapter] ContentSync.delete threw', e);
                return Promise.reject(e);
            }
        }
        return Promise.resolve(true);
    }

    // findCardForId(id) — locate the stage card for the pulse fan-out.
    // Stage-selector cards are per-stage (set via dataset.stageId in
    // Modals._createStageItem), not per-analysis. Multiple analyses for the
    // same stage share one card; AdapterBase.renderCardState is idempotent so
    // repeated calls on the same node are safe.
    function _findCard(id) {
        var p = _splitId(id);
        if (!p || !p.stageId) return null;
        try {
            var safe = String(p.stageId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return document.querySelector('[data-stage-id="' + safe + '"]');
        } catch (e) {
            return null;
        }
    }

    // ---- factory wiring + mount ---------------------------------------------

    if (typeof window === 'undefined' || typeof window.AdapterBase !== 'function') {
        console.warn('[AnalysisAdapter] AdapterBase not available — adapter will not register. Check js/adapters/AdapterBase.js loads before analysisAdapter.js.');
        return;
    }

    var AnalysisAdapter = window.AdapterBase({
        type:          TYPE,
        list:          _list,
        get:           _get,
        load:          _get,
        save:          _save,
        'delete':      _delete,
        findCardForId: _findCard
    });

    // Helpers for tests + future adapters / migration scripts that need to
    // address analyses by composite id without re-parsing the format.
    AnalysisAdapter.split      = _splitId;
    AnalysisAdapter.join       = _joinId;
    AnalysisAdapter.storageKey = _storageKey;

    // Mount: registers lister + module with ContentSync and subscribes to
    // onSyncStateChange. Per ADAPTER_CONTRACT.md sketch, called inline at
    // the end of the IIFE. Script order (per ADAPTER_CONTRACT line 21):
    //   contentSync.js → AdapterBase.js → analysisAdapter.js → app.js
    // — so window.ContentSync is initialized before this point.
    try {
        AnalysisAdapter.onMount();
    } catch (e) {
        console.warn('[AnalysisAdapter] onMount threw', e);
    }

    window.AnalysisAdapter = AnalysisAdapter;
})();
