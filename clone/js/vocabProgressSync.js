/**
 * VocabProgressSync — cross-device sync for per-category progress
 * (trivia stats, flashcard state, flashcard last-card, per-cat stars)
 * and per-user global vocab state (trivia streaks, pending words).
 *
 * Registers two content_types with ContentSync:
 *   - 'vocab_progress'        (one row per user × category; title = catName)
 *   - 'vocab_progress_global' (one row per user; title = '__global__')
 *
 * Reuses the existing unified `content` table via ContentSync + content_api.php.
 * No server schema changes. Per the 2026-04-20 spec (SPEC_vocab_progress_sync.md)
 * and Amitai's approvals:
 *   1. Conflict v1 = last-write-wins (no per-word merge yet).
 *   2. Stars are per-CATEGORY (flipped 2026-04-20 12:42 from cross-cat).
 *      LS shape: plonter_stars_<catName> — a map { "<arabic>|<hebrew>": true }.
 *      Legacy plonter_vocab_stars fan-out migration preserves today's behaviour.
 *   3. pending = user-data, lives in the global row.
 *
 * vocab.html owns the LS save sites. This module exposes hooks that
 * vocab.html calls after every mutation. No UI state sync beyond the
 * per-category flashcard last-card position (Amitai 2026-04-20).
 */
var VocabProgressSync = (function() {
    'use strict';

    var META_KEY              = 'plonter_vocab_progress_meta';
    var MIGRATION_FLAG        = 'plonter_vocab_progress_migrated_v1';
    var STARS_MIGRATION_FLAG  = 'plonter_vocab_stars_per_cat_migrated_v1';

    // Source LS keys
    var LS_TRIVIA_STATS       = 'plonter_trivia_stats';
    var LS_TRIVIA_NOT_SURE    = 'plonter_trivia_not_sure';
    var LS_FC_STATE_PREFIX    = 'plonter_fc_state_';
    var LS_FC_LAST_PREFIX     = 'plonter_fc_last_';
    var LS_STARS_LEGACY       = 'plonter_vocab_stars';   // pre-per-cat; kept for rollback window
    var LS_STARS_PREFIX       = 'plonter_stars_';         // per-cat: plonter_stars_<catName>
    var LS_AUDIO_IDS_PREFIX   = 'plonter_vocab_audio_ids_'; // per-cat: { "<word_key>": [uuid, ...] }
    var LS_TRIVIA_STREAKS     = 'plonter_vocab_trivia_streaks';
    var LS_PENDING            = 'plonter_vocab_pending';

    var GLOBAL_ID = '__global__';

    // ── meta (per-item updated timestamps used to feed ContentSync) ──

    function _now() { return new Date().toISOString(); }

    function _getMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
        catch (_) { return {}; }
    }
    function _setMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }
    function _stamp(id) { var m = _getMeta(); m[id] = _now(); _setMeta(m); }
    function _getStamp(id) { return _getMeta()[id] || null; }

    // ── LS readers ──

    function _readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
        catch (_) { return fallback; }
    }

    // plonter_trivia_stats and plonter_trivia_not_sure are flat maps keyed
    // `cat::dir::arabic`. Slice out the entries that belong to a given cat
    // by matching the `catName::` prefix.
    function _slicePerCat(flatMap, catName) {
        var out = {};
        var prefix = catName + '::';
        for (var k in flatMap) {
            if (!Object.prototype.hasOwnProperty.call(flatMap, k)) continue;
            if (k.indexOf(prefix) === 0) out[k] = flatMap[k];
        }
        return out;
    }

    // Write a sliced-back-by-cat map into a flat LS map: replace ONLY the
    // keys whose catName matches, leaving other cats' entries intact. This
    // preserves progress for cats we didn't touch during a partial pull.
    function _mergePerCat(existingFlat, catName, sliceForCat) {
        var out = {};
        var prefix = catName + '::';
        // Keep entries from OTHER cats
        for (var k in existingFlat) {
            if (!Object.prototype.hasOwnProperty.call(existingFlat, k)) continue;
            if (k.indexOf(prefix) !== 0) out[k] = existingFlat[k];
        }
        // Overlay the cat's slice
        for (var kk in sliceForCat) {
            if (!Object.prototype.hasOwnProperty.call(sliceForCat, kk)) continue;
            out[kk] = sliceForCat[kk];
        }
        return out;
    }

    // ── getters (build content-row shape) ──

    function _getCatProgress(catName) {
        if (!catName) return null;
        var stats       = _slicePerCat(_readJson(LS_TRIVIA_STATS, {}), catName);
        var notSure     = _slicePerCat(_readJson(LS_TRIVIA_NOT_SURE, {}), catName);
        var fcState     = _readJson(LS_FC_STATE_PREFIX + catName, null);
        var fcLast      = localStorage.getItem(LS_FC_LAST_PREFIX + catName);
        var starred     = _readJson(LS_STARS_PREFIX + catName, {});
        var audioIds    = _readJson(LS_AUDIO_IDS_PREFIX + catName, {});

        var isEmpty =
            Object.keys(stats).length === 0 &&
            Object.keys(notSure).length === 0 &&
            !fcState &&
            !fcLast &&
            Object.keys(starred).length === 0 &&
            Object.keys(audioIds).length === 0;
        if (isEmpty) return null;

        return {
            id: catName,
            title: catName,
            source_id: null,
            updated: _getStamp(catName) || _now(),
            data: {
                trivia_stats: stats,
                not_sure: notSure,
                fc_state: fcState,
                fc_last: fcLast || null,
                starred: starred,
                audio_ids: audioIds,   // { "<word_key>": [uuid, ...] }
                schema_v: 2            // bumped for audio_ids
            }
        };
    }

    function _getGlobal() {
        var streaks  = _readJson(LS_TRIVIA_STREAKS, { ar2he: {current:0,best:0}, he2ar: {current:0,best:0} });
        var pending  = _readJson(LS_PENDING, {});

        return {
            id: GLOBAL_ID,
            title: GLOBAL_ID,
            source_id: null,
            updated: _getStamp(GLOBAL_ID) || _now(),
            data: {
                trivia_streaks: streaks,
                pending: pending,
                schema_v: 1
            }
        };
    }

    // ── setters (write back from server) ──

    function _setCatProgress(catName, srvItem) {
        if (!catName || !srvItem) return;
        var data = srvItem.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
        if (!data) return;

        if (data.trivia_stats) {
            var flatStats = _readJson(LS_TRIVIA_STATS, {});
            flatStats = _mergePerCat(flatStats, catName, data.trivia_stats);
            localStorage.setItem(LS_TRIVIA_STATS, JSON.stringify(flatStats));
        }
        if (data.not_sure) {
            var flatNs = _readJson(LS_TRIVIA_NOT_SURE, {});
            flatNs = _mergePerCat(flatNs, catName, data.not_sure);
            localStorage.setItem(LS_TRIVIA_NOT_SURE, JSON.stringify(flatNs));
        }
        if (data.fc_state) {
            localStorage.setItem(LS_FC_STATE_PREFIX + catName, JSON.stringify(data.fc_state));
        }
        if (data.fc_last) {
            localStorage.setItem(LS_FC_LAST_PREFIX + catName, data.fc_last);
        }
        if (data.starred && typeof data.starred === 'object') {
            localStorage.setItem(LS_STARS_PREFIX + catName, JSON.stringify(data.starred));
        }
        if (data.audio_ids && typeof data.audio_ids === 'object') {
            localStorage.setItem(LS_AUDIO_IDS_PREFIX + catName, JSON.stringify(data.audio_ids));
        }
        var m = _getMeta();
        m[catName] = srvItem.updated || _now();
        _setMeta(m);
    }

    function _setGlobal(_id, srvItem) {
        if (!srvItem) return;
        var data = srvItem.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
        if (!data) return;

        if (data.trivia_streaks) localStorage.setItem(LS_TRIVIA_STREAKS, JSON.stringify(data.trivia_streaks));
        if (data.pending) localStorage.setItem(LS_PENDING, JSON.stringify(data.pending));

        var m = _getMeta();
        m[GLOBAL_ID] = srvItem.updated || _now();
        _setMeta(m);
    }

    // ── listers ──

    function _listCatProgress() {
        // Enumerate all cats that currently carry any progress in LS. Unions
        // the cat names from trivia_stats keys + fc_state_* LS keys.
        var cats = {};
        var stats = _readJson(LS_TRIVIA_STATS, {});
        for (var k in stats) {
            if (!Object.prototype.hasOwnProperty.call(stats, k)) continue;
            var i = k.indexOf('::');
            if (i > 0) cats[k.substring(0, i)] = true;
        }
        var notSure = _readJson(LS_TRIVIA_NOT_SURE, {});
        for (var kk in notSure) {
            if (!Object.prototype.hasOwnProperty.call(notSure, kk)) continue;
            var ii = kk.indexOf('::');
            if (ii > 0) cats[kk.substring(0, ii)] = true;
        }
        for (var i2 = 0; i2 < localStorage.length; i2++) {
            var lk = localStorage.key(i2);
            if (!lk) continue;
            if (lk.indexOf(LS_FC_STATE_PREFIX) === 0) cats[lk.substring(LS_FC_STATE_PREFIX.length)] = true;
            if (lk.indexOf(LS_FC_LAST_PREFIX) === 0) cats[lk.substring(LS_FC_LAST_PREFIX.length)] = true;
            if (lk.indexOf(LS_STARS_PREFIX) === 0) cats[lk.substring(LS_STARS_PREFIX.length)] = true;
            if (lk.indexOf(LS_AUDIO_IDS_PREFIX) === 0) cats[lk.substring(LS_AUDIO_IDS_PREFIX.length)] = true;
        }
        var meta = _getMeta();
        var out = [];
        for (var name in cats) {
            if (!Object.prototype.hasOwnProperty.call(cats, name)) continue;
            out.push({ id: name, title: name, updated: meta[name] || null });
        }
        return out;
    }

    function _listGlobal() {
        return [{ id: GLOBAL_ID, title: GLOBAL_ID, updated: _getStamp(GLOBAL_ID) }];
    }

    // ── pullers ──

    async function _pullCatProgress(ctx) {
        var api = ctx && ctx.api;
        var setItemMeta = ctx && ctx.setItemMeta;
        if (typeof api !== 'function') return { loaded: 0, error: 'no api' };
        var res = await api('list', { content_type: 'vocab_progress' });
        if (!res || !res.success) return { loaded: 0, error: (res && res.error) || 'list failed' };
        var items = res.items || [];
        var loaded = 0;
        for (var i = 0; i < items.length; i++) {
            var srv = items[i];
            if (!srv || !srv.title) continue;
            _setCatProgress(srv.title, srv);
            if (typeof setItemMeta === 'function') {
                setItemMeta('vocab_progress', srv.title, {
                    synced: true,
                    serverId: srv.id,
                    lastServerUpdated: srv.updated
                });
            }
            loaded++;
        }
        return { loaded: loaded, serverCount: items.length };
    }

    async function _pullGlobal(ctx) {
        var api = ctx && ctx.api;
        var setItemMeta = ctx && ctx.setItemMeta;
        if (typeof api !== 'function') return { loaded: 0, error: 'no api' };
        var res = await api('list', { content_type: 'vocab_progress_global' });
        if (!res || !res.success) return { loaded: 0, error: (res && res.error) || 'list failed' };
        var items = res.items || [];
        if (!items.length) return { loaded: 0 };
        // Expect 1 row per user. If multiple, pick the most-recently-updated.
        var pick = items[0];
        for (var i = 1; i < items.length; i++) {
            if ((items[i].updated || '') > (pick.updated || '')) pick = items[i];
        }
        _setGlobal(GLOBAL_ID, pick);
        if (typeof setItemMeta === 'function') {
            setItemMeta('vocab_progress_global', GLOBAL_ID, {
                synced: true,
                serverId: pick.id,
                lastServerUpdated: pick.updated
            });
        }
        return { loaded: 1, serverCount: items.length };
    }

    // ── registration ──

    function _register() {
        if (typeof ContentSync === 'undefined') return false;
        if (typeof ContentSync.registerModule === 'function') {
            ContentSync.registerModule('vocab_progress', _getCatProgress, _setCatProgress);
            ContentSync.registerModule('vocab_progress_global', function() { return _getGlobal(); }, _setGlobal);
        }
        if (typeof ContentSync.registerLister === 'function') {
            ContentSync.registerLister('vocab_progress', _listCatProgress);
            ContentSync.registerLister('vocab_progress_global', _listGlobal);
        }
        if (typeof ContentSync.registerPuller === 'function') {
            ContentSync.registerPuller('vocab_progress', _pullCatProgress);
            ContentSync.registerPuller('vocab_progress_global', _pullGlobal);
        }
        return true;
    }

    // ── migration (one-shot) ──

    // Phase 1 of first-run migration: fan-out the legacy flat
    // plonter_vocab_stars map into per-cat plonter_stars_<catName> maps.
    // Preserves today's visible behaviour — a word starred cross-cat shows
    // starred in every cat it appears in. Users can then unstar per-cat.
    // Does not delete the legacy key (rollback window).
    function _migrateStarsPerCatIfNeeded() {
        if (localStorage.getItem(STARS_MIGRATION_FLAG) === '1') return;
        var legacy = _readJson(LS_STARS_LEGACY, {});
        var legacyKeys = Object.keys(legacy);
        if (legacyKeys.length === 0) {
            localStorage.setItem(STARS_MIGRATION_FLAG, '1');
            return;
        }

        // Build a lookup of all cats → word-set (arabic|hebrew keys).
        var catWords = {};
        function _addCat(name, words) {
            if (!name || !Array.isArray(words)) return;
            if (!catWords[name]) catWords[name] = {};
            for (var i = 0; i < words.length; i++) {
                var w = words[i];
                if (!w || !w.arabic || !w.hebrew) continue;
                catWords[name][w.arabic + '|' + w.hebrew] = true;
            }
        }
        try {
            if (typeof BUILTIN_CATEGORIES !== 'undefined' && BUILTIN_CATEGORIES) {
                for (var bn in BUILTIN_CATEGORIES) {
                    if (!Object.prototype.hasOwnProperty.call(BUILTIN_CATEGORIES, bn)) continue;
                    var bc = BUILTIN_CATEGORIES[bn];
                    _addCat(bn, bc && bc.words);
                }
            }
        } catch (e) { console.warn('[VocabProgressSync] stars migrate: BUILTIN read failed', e); }
        var customRaw = _readJson('plonter_vocab_v2', {});
        for (var cn in customRaw) {
            if (!Object.prototype.hasOwnProperty.call(customRaw, cn)) continue;
            _addCat(cn, customRaw[cn] && customRaw[cn].words);
        }

        // For each legacy star, write it into every cat that contains the word.
        var touched = {};
        for (var i2 = 0; i2 < legacyKeys.length; i2++) {
            var sk = legacyKeys[i2];
            for (var cname in catWords) {
                if (!Object.prototype.hasOwnProperty.call(catWords, cname)) continue;
                if (catWords[cname][sk]) {
                    if (!touched[cname]) touched[cname] = _readJson(LS_STARS_PREFIX + cname, {});
                    touched[cname][sk] = true;
                }
            }
        }
        for (var tname in touched) {
            if (!Object.prototype.hasOwnProperty.call(touched, tname)) continue;
            localStorage.setItem(LS_STARS_PREFIX + tname, JSON.stringify(touched[tname]));
            _stamp(tname);
        }

        localStorage.setItem(STARS_MIGRATION_FLAG, '1');
    }

    // True if the global row has NO meaningful data (all streaks zero, pending empty).
    // Guards migration from overwriting a populated server row with an empty local one
    // when LS was just wiped by a user-switch (regression 2026-04-20 14:02).
    function _isGlobalDataEmpty(d) {
        if (!d || typeof d !== 'object') return true;
        var s = d.trivia_streaks || {};
        var a = s.ar2he || {}, h = s.he2ar || {};
        var streaksEmpty = !(a.current || a.best || h.current || h.best);
        var pendingEmpty = !d.pending || Object.keys(d.pending).length === 0;
        return streaksEmpty && pendingEmpty;
    }

    function _migrateIfNeeded() {
        // Stars fan-out is independent of auth state (it only touches LS) —
        // run it even for guests so vocab.html's read of plonter_stars_<cat>
        // from toggleStar sees the right state immediately after the new
        // module is loaded.
        _migrateStarsPerCatIfNeeded();

        if (localStorage.getItem(MIGRATION_FLAG) === '1') return;
        if (typeof ContentSync === 'undefined' || typeof ContentSync.save !== 'function') return;
        // Only migrate when logged in — guests have no user_id to attach to.
        if (!localStorage.getItem('plonter_auth_token')) return;

        var cats = _listCatProgress();
        for (var i = 0; i < cats.length; i++) {
            var name = cats[i].id;
            var item = _getCatProgress(name);
            // _getCatProgress already returns null for empty cats, so this
            // loop is naturally safe. Only stamp + push if item is truthy.
            if (item) {
                _stamp(name);
                try { ContentSync.save('vocab_progress', name, item); }
                catch (e) { console.warn('[VocabProgressSync] migrate save threw', e); }
            }
        }
        // Push the global row ONLY if it has non-empty data. A wipe-then-login
        // leaves LS empty; pushing in that window would overwrite the server's
        // good data with zeroes. _boot pulls before migrating to make sure
        // this path normally sees hydrated state — this check is the last
        // line of defense for the case where pull failed (offline, etc.).
        var globalItem = _getGlobal();
        if (!_isGlobalDataEmpty(globalItem.data)) {
            _stamp(GLOBAL_ID);
            try { ContentSync.save('vocab_progress_global', GLOBAL_ID, globalItem); }
            catch (e) { console.warn('[VocabProgressSync] migrate global threw', e); }
        }

        localStorage.setItem(MIGRATION_FLAG, '1');
    }

    // ── hooks called from vocab.html save sites ──

    // Belt-and-suspenders over ContentSync.save's internal _isLoggedIn()
    // check. Explicit token-gate keeps guest progress out of the DB even if
    // ContentSync.save semantics change in the future. Amitai 2026-04-20
    // 12:47 regression: guest progress leaked to the next logged-in user's
    // DB rows because migration fired on first authed boot without wiping
    // the guest's LS residue. @q owns the pre-login LS wipe; this module
    // treats a missing token as "never push, never migrate".
    function _hasToken() { return !!localStorage.getItem('plonter_auth_token'); }

    function _isPublicSharedCat(catName) {
        return !!(catName && String(catName).indexOf('🌐 ') === 0);
    }

    function _saveCat(catName) {
        if (!catName) return;
        _stamp(catName);
        if (typeof ContentSync === 'undefined' || typeof ContentSync.save !== 'function') return;
        if (!_hasToken()) return;
        // Run migration lazily on first mutation after login — covers the
        // case where the user logged in after boot (boot-time _migrateIfNeeded
        // bailed because no auth token was present yet).
        _migrateIfNeeded();
        var item = _getCatProgress(catName);
        if (!item) return;
        try { ContentSync.save('vocab_progress', catName, item); }
        catch (e) { console.warn('[VocabProgressSync] save cat threw', e); }
        // Public/shared category words are common, but each viewer's stars
        // and flashcard/trivia progress are private per logged-in user. Flush
        // these rows immediately so a quick user switch cannot wipe the
        // pending debounce queue before the previous user's progress reaches
        // the server.
        if (_isPublicSharedCat(catName) && typeof ContentSync.processQueue === 'function') {
            try { ContentSync.processQueue(); }
            catch (e2) { console.warn('[VocabProgressSync] shared progress flush threw', e2); }
        }
    }

    function _saveGlobal() {
        _stamp(GLOBAL_ID);
        if (typeof ContentSync === 'undefined' || typeof ContentSync.save !== 'function') return;
        if (!_hasToken()) return;
        _migrateIfNeeded();
        try { ContentSync.save('vocab_progress_global', GLOBAL_ID, _getGlobal()); }
        catch (e) { console.warn('[VocabProgressSync] save global threw', e); }
    }

    function onCategoryDeleted(catName) {
        var m = _getMeta();
        delete m[catName];
        _setMeta(m);
        // Drop the per-cat stars + audio_ids LS keys too — otherwise they
        // orphan after the category disappears. (The audio BLOBs themselves
        // remain on the server — call vocab_audio_api.php?action=delete for
        // each uuid separately if the user explicitly wants to purge them.
        // v1 leaves them; cleanup is manual.)
        try { localStorage.removeItem(LS_STARS_PREFIX + catName); } catch (_) {}
        try { localStorage.removeItem(LS_AUDIO_IDS_PREFIX + catName); } catch (_) {}
        if (typeof ContentSync === 'undefined' || typeof ContentSync.deleteItem !== 'function') return;
        try { ContentSync.deleteItem('vocab_progress', catName); }
        catch (e) { console.warn('[VocabProgressSync] delete threw', e); }
    }

    function onCategoryRenamed(oldName, newName) {
        if (!oldName || !newName || oldName === newName) return;
        // Carry the meta stamp + per-cat stars across. New save under the
        // new name; old server row gets deleted (ContentSync will no longer
        // have a local item matching it).
        var m = _getMeta();
        m[newName] = m[oldName] || _now();
        delete m[oldName];
        _setMeta(m);
        // Move per-cat stars LS entry — read old, write under new, delete old.
        try {
            var oldStars = localStorage.getItem(LS_STARS_PREFIX + oldName);
            if (oldStars !== null) {
                localStorage.setItem(LS_STARS_PREFIX + newName, oldStars);
                localStorage.removeItem(LS_STARS_PREFIX + oldName);
            }
        } catch (_) {}
        // Move per-cat audio_ids LS entry the same way.
        try {
            var oldAudio = localStorage.getItem(LS_AUDIO_IDS_PREFIX + oldName);
            if (oldAudio !== null) {
                localStorage.setItem(LS_AUDIO_IDS_PREFIX + newName, oldAudio);
                localStorage.removeItem(LS_AUDIO_IDS_PREFIX + oldName);
            }
        } catch (_) {}
        _saveCat(newName);
        onCategoryDeleted(oldName);
    }

    function syncAll() {
        if (typeof ContentSync === 'undefined' || typeof ContentSync.syncAll !== 'function') {
            return Promise.resolve({ attempted: 0, succeeded: 0, errors: ['ContentSync not loaded'] });
        }
        return Promise.all([
            ContentSync.syncAll('vocab_progress'),
            ContentSync.syncAll('vocab_progress_global')
        ]);
    }

    // ── boot ──

    // Pull before migrate is MANDATORY after user-switch regression
    // (2026-04-20 14:02): auth.js _clearUserScopedContent wipes the
    // plonter_vocab_ prefix — which matches our migration flag. Without
    // this pull, the next boot would see flag-missing + LS-empty and
    // push empty rows to the server, clobbering the user's real data.
    async function _hydrateFromServer() {
        if (typeof ContentSync === 'undefined' || typeof ContentSync.pullAll !== 'function') return;
        if (!localStorage.getItem('plonter_auth_token')) return;
        try { await ContentSync.pullAll('vocab_progress_global'); }
        catch (e) { console.warn('[VocabProgressSync] pull global failed', e); }
        try { await ContentSync.pullAll('vocab_progress'); }
        catch (e) { console.warn('[VocabProgressSync] pull cat progress failed', e); }
    }

    async function _boot() {
        if (!_register()) { setTimeout(_boot, 300); return; }
        // Hydrate FIRST so any subsequent migration sees populated LS
        // (prevents overwriting the server with an empty post-wipe snapshot).
        await _hydrateFromServer();
        // Give any pending saves a beat to settle before considering migration.
        setTimeout(_migrateIfNeeded, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _boot);
    } else {
        _boot();
    }

    // Stars are now per-category (Amitai 2026-04-20 12:42 pivot). The
    // starKey + isNowStarred args are for logging/debug only — the hook
    // always snapshots the full cat row to the server.
    function onStarToggled(catName /*, starKey, isNowStarred */) {
        _saveCat(catName);
    }

    // Audio LS mutations (@q calls these after writing plonter_vocab_audio_ids_<cat>).
    // LS shape: { "<word_key>": [uuid, ...] }. The hook just snapshots the
    // full cat row (which now includes audio_ids) so the reference list
    // ships with the next progress push. The blob itself travels through
    // vocab_audio_api.php — independent of ContentSync queue.
    function onAudioAttached(catName /*, wordKey, audioId */) {
        _saveCat(catName);
    }
    function onAudioRemoved(catName /*, wordKey, audioId */) {
        _saveCat(catName);
    }

    return {
        onTriviaResultRecorded: _saveCat,      // catName
        onNotSureChanged:       _saveCat,      // catName
        onFcStateSaved:         _saveCat,      // catName
        onFcLastCardChanged:    _saveCat,      // catName
        onStarToggled:          onStarToggled, // (catName, starKey, isNowStarred)
        onAudioAttached:        onAudioAttached, // (catName, wordKey, audioId)
        onAudioRemoved:         onAudioRemoved,  // (catName, wordKey, audioId)
        onTriviaStreakUpdated:  _saveGlobal,
        onPendingChanged:       _saveGlobal,
        onCategoryRenamed:      onCategoryRenamed,
        onCategoryDeleted:      onCategoryDeleted,
        syncAll:                syncAll,
        // Exposed for manual debug / forced refresh.
        _getCatProgress:        _getCatProgress,
        _getGlobal:             _getGlobal,
        _migrateIfNeeded:       _migrateIfNeeded
    };
})();
