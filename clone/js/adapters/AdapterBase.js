// AdapterBase — SAVE_CONTRACT Phase 3 adapter contract.
//
// Every type-adapter (analysisAdapter, hindusAdapter, textsAdapter,
// lessonsAdapter, mediaAdapter, vocabAdapter, flashcardAdapter) extends or
// composes this base. It documents the seven methods the adapter MUST
// provide, supplies default implementations that route through ContentSync,
// and wires onSyncStateChange so that subclasses don't have to remember to
// subscribe.
//
// Style: vanilla — no ES modules, no class. Exposed as window.AdapterBase
// (a factory function) per the plonter pattern (var globals, IIFE in
// other files). Subclasses can either:
//   a) call window.AdapterBase({ type: 'foo', list: …, get: …, load: …,
//      renderCardState: … }) and receive a wired instance, OR
//   b) build their own object and use this file as a reference contract.
//
// Contract:
//
//   type            : string ∈ {'lesson','text','sentence','hindus','vocab',
//                     'flashcard','media','analysis'} — matches the
//                     ContentSync content-type strings.
//   save(id, data)  : Promise — persist locally (subclass overrides for
//                     debounce / disk layout), then ContentSync.save(type,
//                     id, data). Default impl just calls ContentSync.save.
//   load(id)        : data | null — read from local storage. SUBCLASS MUST
//                     OVERRIDE (the default returns null because
//                     AdapterBase has no opinion on where the bytes live).
//   delete(id)      : Promise — remove local + ContentSync.delete(type, id).
//                     Default impl calls ContentSync.delete. Subclass
//                     overrides to ALSO remove the local copy if
//                     applicable.
//   list()          : items[] — for ContentSync.registerLister and the
//                     migration popup. SUBCLASS MUST OVERRIDE.
//   get(id)         : data | null — for ContentSync.registerModule. Default
//                     forwards to load(id).
//   renderCardState(card, state)
//                   : void — toggles UI classes on a card DOM element.
//                     Default impl uses the shared `.backing-up-pulse` +
//                     `.cs-just-backed-up` classes defined in css/style.css
//                     so all six adapters paint pulses uniformly.
//   onMount()       : void — called once the DOM is ready. Default impl
//                     wires registerLister, registerModule, and the
//                     ContentSync.onSyncStateChange fan-out (calls
//                     renderCardState across every card the subclass'
//                     `findCardForId(id)` resolves). Subclass overrides
//                     findCardForId(id) → Element|null when adapter cards
//                     have a known selector (e.g. `[data-stage-id="…"]`).
//
// Cooperation with Modals.registerStageRenderer (Phase 3 part 2): adapters
// whose cards live in the stage-selector overlay should ALSO register a
// stage renderer so they own their card markup, not just the state pulse.
// See modals.js → Modals.registerStageRenderer(type, fn) for the hook.
//
// Example (sketch — actual adapter lives in js/adapters/<type>Adapter.js):
//
//   var MyAdapter = window.AdapterBase({
//       type: 'sentence',
//       list: function() { return Persistence.list('sentence'); },
//       get:  function(id) { return Persistence.get('sentence', id); },
//       load: function(id) { return Persistence.get('sentence', id); },
//       findCardForId: function(id) {
//           return document.querySelector('[data-stage-id="' + id + '"]');
//       }
//   });
//   MyAdapter.onMount();
//   Modals.registerStageRenderer('sentence', function(stage, ctx) {
//       if (!stage.isCustom) return null;             // fall through
//       return MyAdapter.renderStageCard(stage, ctx); // adapter owns DOM
//   });

(function() {
    'use strict';

    var ALLOWED_TYPES = {
        lesson: 1, text: 1, sentence: 1, hindus: 1,
        vocab: 1, flashcard: 1, media: 1, analysis: 1
    };
    // The 4 SAVE_CONTRACT states; renderCardState may receive any of them.
    var SYNC_CLASS = {
        unsynced:    'cs-state-unsynced',
        backing_up:  'backing-up-pulse',
        backed_up:   'cs-state-backed-up',
        failed:      'cs-state-failed'
    };

    function _noop() {}
    function _cs() { return typeof window !== 'undefined' ? window.ContentSync : null; }

    /**
     * Create a fully-wired adapter instance.
     * @param {object} cfg
     *   - type:               REQUIRED, see ALLOWED_TYPES.
     *   - list:               REQUIRED, () => items[].
     *   - get:                optional, (id) => data|null (defaults to load).
     *   - load:               optional, (id) => data|null.
     *   - save:               optional, override default ContentSync.save route.
     *   - delete:             optional, override default ContentSync.delete route.
     *   - findCardForId:      optional, (id) => Element|null for state fan-out.
     *   - renderCardState:    optional, (card, state) => void; overrides default.
     *   - onMount:            optional, called once DOM is ready; default wires
     *                          registerLister + registerModule + onSyncStateChange.
     * @returns wired adapter object
     */
    function AdapterBase(cfg) {
        cfg = cfg || {};
        var type = cfg.type;
        if (!type || !ALLOWED_TYPES.hasOwnProperty(type)) {
            throw new Error('[AdapterBase] missing or invalid `type`: ' + JSON.stringify(type));
        }
        if (typeof cfg.list !== 'function') {
            console.warn('[AdapterBase] type=' + type + ' has no list() — migration popup + pull will not see its items.');
        }

        var adapter = {
            type: type,
            list: typeof cfg.list === 'function' ? cfg.list : function() { return []; },
            load: typeof cfg.load === 'function' ? cfg.load : function() { return null; },
            findCardForId: typeof cfg.findCardForId === 'function' ? cfg.findCardForId : function() { return null; },
            _unsubscribe: null,
            _mounted: false
        };

        // get(id) defaults to load(id) — same data path most adapters expose.
        adapter.get = typeof cfg.get === 'function' ? cfg.get : function(id) { return adapter.load(id); };

        // save(id, data): default route is ContentSync.save. Subclass override
        // can write a debounced local copy first, then call .save() through
        // the prototype.
        adapter.save = typeof cfg.save === 'function' ? cfg.save : function(id, data) {
            var cs = _cs();
            if (!cs || typeof cs.save !== 'function') return Promise.resolve(false);
            try {
                cs.save(type, id, data);
                if (typeof cs.processQueue === 'function') cs.processQueue();
            } catch (e) {
                console.warn('[AdapterBase ' + type + '] save threw', e);
                return Promise.reject(e);
            }
            return Promise.resolve(true);
        };

        // delete(id): default route is ContentSync.delete (which is now a
        // documented alias to deleteItem, added in the same Phase 3 commit).
        adapter['delete'] = typeof cfg['delete'] === 'function' ? cfg['delete'] : function(id) {
            var cs = _cs();
            if (!cs) return Promise.resolve(false);
            var fn = (typeof cs['delete'] === 'function' ? cs['delete'] :
                     (typeof cs.deleteItem === 'function' ? cs.deleteItem : null));
            if (!fn) return Promise.resolve(false);
            try {
                var res = fn(type, id);
                return Promise.resolve(res);
            } catch (e) {
                console.warn('[AdapterBase ' + type + '] delete threw', e);
                return Promise.reject(e);
            }
        };

        // renderCardState(card, state): default toggles the shared
        // .backing-up-pulse class. Failed state additionally gets a
        // .cs-state-failed marker for adapters that want red border / retry
        // button.
        adapter.renderCardState = typeof cfg.renderCardState === 'function' ? cfg.renderCardState : function(card, state) {
            if (!card || !card.classList) return;
            // Clear all known state classes first so transitions are clean.
            for (var k in SYNC_CLASS) {
                if (SYNC_CLASS.hasOwnProperty(k)) card.classList.remove(SYNC_CLASS[k]);
            }
            if (state && SYNC_CLASS[state]) {
                card.classList.add(SYNC_CLASS[state]);
            }
            // .cs-just-backed-up is a one-shot decay class set by ContentSync
            // itself elsewhere — adapters don't need to add it manually here.
        };

        // onMount: register listers + getters, subscribe to sync-state events.
        adapter.onMount = typeof cfg.onMount === 'function' ? cfg.onMount : function() {
            if (adapter._mounted) return;
            adapter._mounted = true;
            var cs = _cs();
            if (!cs) {
                console.warn('[AdapterBase ' + type + '] ContentSync not available at mount; deferring is the subclass responsibility.');
                return;
            }
            if (typeof cs.registerLister === 'function') {
                try { cs.registerLister(type, adapter.list); }
                catch (e) { console.warn('[AdapterBase ' + type + '] registerLister threw', e); }
            }
            if (typeof cs.registerModule === 'function') {
                // ContentSync.registerModule signature is (type, getter, setter):
                // two separate functions, not a single object. Setter is the
                // server-to-client write callback used by pullAll. Adapters
                // may override `adapter.set(id, serverData)` to merge server
                // state into local storage; default noop is safe for adapters
                // that don't need pullAll (analysis/hindus/texts already
                // handle their own per-domain pull paths in Phase 1/3).
                // Bug found by @plonter2 worker 2026-05-13 — earlier draft
                // passed { get, list } as a single object, which silently
                // registered nothing because contentSync read positional args.
                try {
                    cs.registerModule(
                        type,
                        adapter.get,
                        (typeof adapter.set === 'function') ? adapter.set : function() {}
                    );
                }
                catch (e) { console.warn('[AdapterBase ' + type + '] registerModule threw', e); }
            }
            if (typeof cs.onSyncStateChange === 'function') {
                adapter._unsubscribe = cs.onSyncStateChange(function(t, id, state) {
                    if (t !== type) return;
                    var card = adapter.findCardForId(id);
                    if (!card) return;
                    try { adapter.renderCardState(card, state); }
                    catch (e) { console.warn('[AdapterBase ' + type + '] renderCardState threw', e); }
                });
            }
        };

        // unmount — opt-in cleanup; mostly useful in tests.
        adapter.unmount = function() {
            if (typeof adapter._unsubscribe === 'function') {
                try { adapter._unsubscribe(); } catch (_) {}
                adapter._unsubscribe = null;
            }
            adapter._mounted = false;
        };

        return adapter;
    }

    // Expose the factory + the SYNC_CLASS map (handy for subclasses that
    // want to query "did this card just enter backing-up state?").
    AdapterBase.SYNC_CLASS = SYNC_CLASS;
    AdapterBase.ALLOWED_TYPES = Object.keys(ALLOWED_TYPES);

    if (typeof window !== 'undefined') {
        window.AdapterBase = AdapterBase;
    }
})();
