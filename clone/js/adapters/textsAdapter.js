// textsAdapter — SAVE_CONTRACT Phase 3 adapter for text content.
// Add to index.html AFTER AdapterBase.js, BEFORE app.js — owned by @3.
(function() {
    'use strict';

    if (typeof window === 'undefined') return;
    if (typeof window.AdapterBase !== 'function') {
        console.warn('[TextsAdapter] AdapterBase not available');
        return;
    }
    if (typeof window.PlonterTexts === 'undefined') {
        console.warn('[TextsAdapter] PlonterTexts not available');
        return;
    }

    function _isBuiltin(t) {
        if (!t) return false;
        if (t._isBuiltinSeed === true) return true;
        return typeof t.id === 'string' && t.id.indexOf('txt_demo_') === 0;
    }

    var TextsAdapter = window.AdapterBase({
        type: 'text',
        // Exclude built-in demo seeds from sync surface — they're sourced from
        // server seed files, not user content. Matches the existing _isBuiltinText
        // filter PlonterTexts uses internally.
        list: function() {
            var all = (typeof PlonterTexts._getAll === 'function') ? PlonterTexts._getAll() : [];
            return all.filter(function(t) { return !_isBuiltin(t); });
        },
        get: function(id) {
            var all = (typeof PlonterTexts._getAll === 'function') ? PlonterTexts._getAll() : [];
            for (var i = 0; i < all.length; i++) {
                if (all[i] && all[i].id === id) return all[i];
            }
            return null;
        },
        load: function(id) {
            var all = (typeof PlonterTexts._getAll === 'function') ? PlonterTexts._getAll() : [];
            for (var i = 0; i < all.length; i++) {
                if (all[i] && all[i].id === id) return all[i];
            }
            return null;
        },
        // save: default ContentSync.save route. PlonterTexts._saveAll already
        // calls ContentSync.save per item in its internal flush, so the adapter
        // route is intentionally additive — avoids double-saves while still
        // providing the public API surface adapters expose.
        // delete: default ContentSync.delete route. PlonterTexts owns its own
        // local deletion path (_saveAll after filter); the adapter only owns
        // the server-side teardown via the default route.
        findCardForId: function(id) {
            if (!id) return null;
            // Cards are .stage-item nodes with item.dataset.textId = text.id
            // (texts.js renderList L1289). CSS escape isn't needed for the
            // generated 'txt_…' / 'txt_demo_…' / 'txt_guest_shadow_…' ids
            // (alphanumerics + underscore only).
            return document.querySelector('.stage-item[data-text-id="' + id + '"]') || null;
        }
    });

    TextsAdapter.onMount();
    window.TextsAdapter = TextsAdapter;
})();
