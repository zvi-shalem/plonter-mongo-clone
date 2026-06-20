/*
 * foldersUI.js — Plonter content-organization UI module ("פלונטר כתיקיות", Amitai #1256).
 *
 * Self-contained, parallel-safe module. It is the CLIENT for the LIVE backend
 * api/content_org_api.php (folders / shortcuts / 3-state archive / tags / search /
 * Drive-style folder-sharing). NOTHING here edits index.html — @6m wires it with a
 * single <script src="js/foldersUI.js?v=2"></script> tag + one mount call (see
 * FOLDERS_UI_WIRING_SPEC_20260612.md).
 *
 * PRODUCT DIRECTION (Amitai 2026-06-12): lessons / תחביר / הינדוס are FILE TYPES
 * (like Google Docs / Sheets / Slides), NOT the top-level folder structure. So the
 * UI is **folder-first + search-first**: a big search, a folder tree with full
 * folder capabilities, and file-type represented as chips / filters / badges.
 * Concepts surfaced: folder tree, file/list results, big search, type filters
 * (שיעורים/תחביר/הינדוס + any other content_type), difficulty + free-tag filters,
 * shared-with-me strip, include-archived toggle, neutral login/error/empty states,
 * non-destructive archive/restore, and in-page lightweight dialogs (no browser
 * prompt/confirm).
 *
 * Design notes:
 *   - Backend envelope is { ok:true, ... } / { ok:false, error }. (NOTE: the rest of
 *     the app's share API uses `success`; content_org_api.php uses `ok` — confirmed by
 *     reading the PHP. We key on `ok`.)
 *   - search_content's HTTP router wraps rows as { results:[...], count } even though
 *     CONTENT_ORG_API_CONTRACT.md §3 implies an `items` key; we normalize both.
 *   - `subject` search param == content.content_type (the existing tabs ARE this filter).
 *   - store-aware: every item action threads an optional `store` ∈ {content,media};
 *     default 'content' for back-compat (matches the PHP defaults).
 *   - Every network/DOM access is typeof/try guarded. Not-logged-in is a neutral
 *     state, never a throw. Visuals are intentionally restrained + themeable (real
 *     design pends @WBT mockups) — all chrome carries `pf-` classes so a stylesheet
 *     can restyle without touching this file.
 *
 * Public surface (window.PlonterFolders):
 *   init(opts)                       — one-time config { apiBase?, mount? }
 *   mount(target, opts)              — render the UI into an element / selector
 *   refresh()                        — reload folders (+ tags) + re-render
 *   isLoggedIn()                     — token present?
 *   buildTree(folders)               — pure helper: flat list -> nested tree (testable)
 *   typeLabel(contentType)           — pure helper: content_type -> Hebrew label (testable)
 *   buildSearchParams(filters, inc)  — pure helper: filter-state -> search() opts (testable)
 *   hasActiveFilters(filters)        — pure helper: any filter active? (testable)
 *   data methods (all return Promise<envelope>):
 *     listFolders, createFolder, renameFolder, moveFolder, deleteFolder,
 *     listFolderItems, addToFolder, addShortcut, removeFromFolder,
 *     archiveItem, restoreItem,
 *     createFolderShare, listFolderShares, revokeFolderShare, foldersSharedWithMe,
 *     search, listTags, createTag, tagItem, untagItem
 */
window.PlonterFolders = (function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Config + tiny env helpers (all guarded so the module loads in any env).
    // -----------------------------------------------------------------------
    var API = '/plonter/api/content_org_api.php';
    var AUTH_KEYS = ['plonter_auth_token', 'auth_otp_token_plonter'];

    function _doc() { return (typeof document !== 'undefined' && document) ? document : null; }

    function _token() {
        // Prefer the shared auth module if present, else read localStorage keys.
        try {
            if (typeof PlonterAuth !== 'undefined' && PlonterAuth && typeof PlonterAuth.getToken === 'function') {
                var t = PlonterAuth.getToken();
                if (t) return t;
            }
        } catch (e) { /* ignore */ }
        try {
            if (typeof localStorage !== 'undefined' && localStorage) {
                for (var i = 0; i < AUTH_KEYS.length; i++) {
                    var v = localStorage.getItem(AUTH_KEYS[i]);
                    if (v) return v;
                }
            }
        } catch (e) { /* ignore */ }
        return '';
    }

    function isLoggedIn() { return !!_token(); }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // -----------------------------------------------------------------------
    // Core API call. Never throws. Returns a Promise resolving to the parsed
    // envelope, or a synthesized error envelope:
    //   { ok:false, error:'needs_login', _needsLogin:true }  — no token
    //   { ok:false, error:'no_fetch' }                       — fetch unavailable
    //   { ok:false, error:'network', _network:true }         — transport failure
    // -----------------------------------------------------------------------
    function _call(action, params, method) {
        var token = _token();
        if (!token) return Promise.resolve({ ok: false, error: 'needs_login', _needsLogin: true });
        if (typeof fetch === 'undefined') return Promise.resolve({ ok: false, error: 'no_fetch' });
        method = method || 'POST';
        var url = API + '?action=' + encodeURIComponent(action);
        var opts = { method: method, headers: { 'Authorization': 'Bearer ' + token } };
        if (method === 'POST') {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(params || {});
        }
        return fetch(url, opts)
            .then(function (r) { return r.json(); })
            .then(function (d) { return d || { ok: false, error: 'empty' }; })
            .catch(function () { return { ok: false, error: 'network', _network: true }; });
    }

    // -----------------------------------------------------------------------
    // Data methods — thin, faithful wrappers over the PHP actions. Param names
    // mirror the backend exactly (read from content_org_api.php router).
    // -----------------------------------------------------------------------
    function listFolders() { return _call('list_folders', {}); }

    function createFolder(name, parentId) {
        return _call('create_folder', { name: name, parent_id: (parentId == null ? null : parentId) });
    }
    function renameFolder(id, name) { return _call('rename_folder', { id: id, name: name }); }
    function moveFolder(id, parentId) {
        // Backend rejects cycles (own-descendant) with a Hebrew error — surfaced as d.error.
        return _call('move_folder', { id: id, parent_id: (parentId == null ? null : parentId) });
    }
    function deleteFolder(id) {
        // Backend: items become UNFILED (content rows untouched), child folders re-parented.
        return _call('delete_folder', { id: id });
    }

    function listFolderItems(folderId, includeArchived) {
        return _call('list_folder_items', { folder_id: folderId, include_archived: !!includeArchived });
    }
    function addToFolder(contentId, folderId, store) {
        return _call('add_to_folder', { content_id: contentId, folder_id: folderId, store: store || 'content' });
    }
    function addShortcut(contentId, folderId, store) {
        return _call('add_shortcut', { content_id: contentId, folder_id: folderId, store: store || 'content' });
    }
    function removeFromFolder(contentId, folderId, store) {
        return _call('remove_from_folder', { content_id: contentId, folder_id: folderId, store: store || 'content' });
    }

    function archiveItem(contentId, store) {
        return _call('archive_item', { content_id: contentId, store: store || 'content' });
    }
    function restoreItem(contentId, store) {
        return _call('restore_item', { content_id: contentId, store: store || 'content' });
    }

    // Folder sharing (Drive-style). opts: { targetType, targetId, role, ttlHours }.
    function createFolderShare(folderId, opts) {
        opts = opts || {};
        var p = { folder_id: folderId, target_type: opts.targetType || 'link', role: opts.role || 'view' };
        if (opts.targetId != null) p.target_id = opts.targetId;
        if (opts.ttlHours != null && opts.ttlHours !== '') p.ttl_hours = opts.ttlHours;
        return _call('create_folder_share', p);
    }
    function listFolderShares(folderId) { return _call('list_folder_shares', { folder_id: folderId }); }
    function revokeFolderShare(shareId) { return _call('revoke_folder_share', { id: shareId }); }
    function foldersSharedWithMe() { return _call('folders_shared_with_me', {}); }

    // Tag-only search + in-folder search. opts: { scope, folderId, subject,
    // difficulty, tags[], q, includeArchived }. Normalizes results/items key.
    function search(opts) {
        opts = opts || {};
        var p = { scope: opts.scope || 'all' };
        if (opts.folderId != null) p.folder_id = opts.folderId;
        if (opts.subject) p.subject = opts.subject;
        if (opts.difficulty) p.difficulty = opts.difficulty;
        if (opts.tags && opts.tags.length) p.tags = opts.tags;
        if (opts.q) p.q = opts.q;
        if (opts.includeArchived) p.include_archived = true;
        return _call('search_content', p).then(function (d) {
            if (d && d.ok) d.results = d.results || d.items || [];
            return d;
        });
    }

    function listTags(namespace) {
        var p = {};
        if (namespace) p.namespace = namespace;
        return _call('list_tags', p);
    }
    function createTag(name, namespace) { return _call('create_tag', { name: name, namespace: namespace }); }
    function tagItem(contentId, tagId, store) {
        return _call('tag_item', { content_id: contentId, tag_id: tagId, store: store || 'content' });
    }
    function untagItem(contentId, tagId, store) {
        return _call('untag_item', { content_id: contentId, tag_id: tagId, store: store || 'content' });
    }

    // -----------------------------------------------------------------------
    // Pure helper — flat folder list -> nested tree by parent_id. No DOM.
    // Each node: { id, parent_id, name, children:[] }. Orphan parents (parent
    // not in the set) are treated as roots so nothing is ever dropped.
    // -----------------------------------------------------------------------
    function buildTree(folders) {
        var byId = {}, roots = [];
        (folders || []).forEach(function (f) {
            byId[f.id] = {
                id: f.id,
                parent_id: (f.parent_id == null ? null : f.parent_id),
                name: f.name,
                children: []
            };
        });
        Object.keys(byId).forEach(function (k) {
            var n = byId[k];
            if (n.parent_id != null && byId[n.parent_id]) byId[n.parent_id].children.push(n);
            else roots.push(n);
        });
        return roots;
    }

    // -----------------------------------------------------------------------
    // Pure helper — content_type -> Hebrew display label. Falls back to the raw
    // content_type so "other content_type values" still render a chip/badge.
    // The three FILE TYPES Amitai called out (lesson/analysis/hindus) come first
    // in the type-filter row (see PRIMARY_TYPES).
    // -----------------------------------------------------------------------
    var TYPE_LABELS = {
        lesson: 'שיעורים',
        analysis: 'תחביר',
        hindus: 'הינדוס',
        selfwork: 'עבודה עצמית',
        vocab: 'אוצר מילים',
        audio: 'שמע',
        video: 'וידאו',
        image: 'תמונות'
    };
    var PRIMARY_TYPES = ['lesson', 'analysis', 'hindus'];
    var DIFFICULTIES = ['קל', 'בינוני', 'קשה'];

    // Material/file types offered by the "צור מסמך" (create-document) picker.
    // lesson/analysis/hindus/selfwork are the defaults; override via mount opt
    // { createTypes: [...] } to add others.
    var CREATE_TYPES = ['lesson', 'analysis', 'hindus', 'selfwork'];

    // Documented CustomEvent dispatched (in addition to the onCreateItem callback)
    // when the user picks a type to create. detail = { type, folderId, folderName, context }.
    var CREATE_EVENT = 'plonterfolders:createitem';

    // Favorites (stars). The backend (content_org_api.php) has NO favorite field or
    // endpoint as of 2026-06-12 (confirmed by reading the PHP) — so we do NOT invent a
    // server write. Toggling a star fires this CustomEvent + the onToggleFavorite
    // callback; persistence is the consumer's job (see the wiring spec). We also keep a
    // LOCAL starred set so the UI is responsive even with no consumer, and we honor a
    // backend `is_starred`/`starred`/`favorite` field if one ever appears on an item.
    // detail = { store, id, folderId, folderName, context, wasStarred, starred }.
    var FAV_EVENT = 'plonterfolders:togglefavorite';

    function typeLabel(ct) {
        if (ct == null || ct === '') return '';
        return Object.prototype.hasOwnProperty.call(TYPE_LABELS, ct) ? TYPE_LABELS[ct] : String(ct);
    }

    // Pure helper — turn a filter-state object into the opts object `search()`
    // expects. `filters.tags` may be an array of ids OR an {id:bool} map.
    function buildSearchParams(filters, includeArchived) {
        filters = filters || {};
        var p = { scope: 'all' };
        if (filters.subject) p.subject = filters.subject;
        if (filters.difficulty) p.difficulty = filters.difficulty;
        var tagIds = [];
        if (filters.tags) {
            if (Array.isArray(filters.tags)) {
                tagIds = filters.tags.slice();
            } else {
                Object.keys(filters.tags).forEach(function (k) {
                    if (filters.tags[k]) tagIds.push(parseInt(k, 10));
                });
            }
        }
        if (tagIds.length) p.tags = tagIds;
        var q = filters.q == null ? '' : String(filters.q).trim();
        if (q) p.q = q;
        if (includeArchived) p.includeArchived = true;
        return p;
    }

    // Pure helper — is any filter active (so we run the search feed vs. browse)?
    function hasActiveFilters(filters) {
        if (!filters) return false;
        if (filters.subject || filters.difficulty) return true;
        if (filters.q != null && String(filters.q).trim()) return true;
        if (filters.tags) {
            if (Array.isArray(filters.tags)) return filters.tags.length > 0;
            return Object.keys(filters.tags).some(function (k) { return filters.tags[k]; });
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // UI state.
    // -----------------------------------------------------------------------
    var state = {
        root: null,             // mounted container element
        folders: [],            // last-loaded flat folder list
        freeTags: [],           // last-loaded free-namespace tags (for tag chips)
        expanded: {},           // folderId -> bool
        currentFolderId: null,  // folder being browsed (null when in search-feed / idle)
        currentFolderName: '',
        items: [],              // items currently shown (folder browse OR search feed)
        includeArchived: false,
        needsLogin: false,
        mode: 'idle',           // 'idle' | 'browse' | 'search'
        filters: { subject: null, difficulty: null, tags: {}, q: '', starred: false },
        seenTypes: {},          // content_type -> true (accumulates for dynamic chips)
        onCreateItem: null,     // optional consumer callback for "create document"
        onToggleFavorite: null, // optional consumer callback for star/favorite persistence
        createContext: null,    // opaque mount context (e.g. {classId}) passed to consumers
        createTypes: null,      // optional override of CREATE_TYPES
        starred: {},            // local favorite set: "store:id" -> true (UI responsiveness)
        // cached element refs (set during render)
        _treeWrap: null, _itemsWrap: null, _filtersWrap: null, _searchInput: null,
        _createBtn: null, _qTimer: null
    };

    function _resetFilters() { state.filters = { subject: null, difficulty: null, tags: {}, q: '', starred: false }; }

    // -----------------------------------------------------------------------
    // Minimal DOM helpers (neutral, themeable). All guarded for headless env.
    // -----------------------------------------------------------------------
    function _el(tag, cls, text) {
        var d = _doc();
        if (!d) return null;
        var e = d.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function _toast(msg) {
        var d = _doc();
        if (!d || !d.body) return;
        var t = d.getElementById('_pf-toast');
        if (!t) {
            t = d.createElement('div');
            t.id = '_pf-toast';
            t.setAttribute('dir', 'rtl');
            t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100070;background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-family:inherit;font-size:0.95em;box-shadow:0 6px 20px rgba(0,0,0,0.3);opacity:0;transition:opacity .2s;max-width:90vw;text-align:center';
            d.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(t._h);
        t._h = setTimeout(function () { t.style.opacity = '0'; }, 2400);
    }

    // Surface an envelope error to the user; returns true if it was an error.
    function _surface(d, okMsg) {
        if (!d || !d.ok) {
            if (d && d._needsLogin) { _toast('צריך להתחבר'); return true; }
            _toast('שגיאה: ' + ((d && d.error) || 'לא ידוע'));
            return true;
        }
        if (okMsg) _toast(okMsg);
        return false;
    }

    // -----------------------------------------------------------------------
    // In-page lightweight dialogs (replace browser prompt/confirm). They render
    // a pf-overlay + pf-dialog into <body>. Fully guarded: if there is no body
    // we fall back to prompt/confirm so headless callers still work.
    // -----------------------------------------------------------------------
    function _overlay() {
        var d = _doc();
        if (!d || !d.body) return null;
        var ov = _el('div', 'pf-overlay');
        if (!ov) return null;
        ov.setAttribute('dir', 'rtl');
        ov.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit';
        d.body.appendChild(ov);
        return ov;
    }
    function _closeOverlay(ov) {
        if (!ov) return;
        try { if (ov.parentNode && ov.parentNode.removeChild) ov.parentNode.removeChild(ov); else if (_doc() && _doc().body && _doc().body.removeChild) _doc().body.removeChild(ov); } catch (e) {}
    }

    // Text-input dialog. opts: { title, label, value, placeholder, confirmText, onSubmit(value) }.
    function _inputDialog(opts) {
        opts = opts || {};
        var ov = _overlay();
        if (!ov) {
            // headless fallback
            var v = null;
            try { if (typeof prompt === 'function') v = prompt(opts.title || '', opts.value || ''); } catch (e) {}
            if (v != null && String(v).trim() && typeof opts.onSubmit === 'function') opts.onSubmit(String(v).trim());
            return;
        }
        var box = _el('div', 'pf-dialog');
        box.style.cssText = 'background:#fff;border-radius:14px;padding:18px;min-width:260px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,0.25)';
        if (opts.title) { var h = _el('div', 'pf-dialog-title', opts.title); h.style.cssText = 'font-weight:700;margin-bottom:10px;color:#0f172a'; box.appendChild(h); }
        if (opts.label) { var lb = _el('div', 'pf-dialog-label', opts.label); lb.style.cssText = 'font-size:0.85em;color:#64748b;margin-bottom:4px'; box.appendChild(lb); }
        var input = _el('input', 'pf-dialog-input');
        input.type = 'text';
        if (opts.value != null) input.value = opts.value;
        if (opts.placeholder) input.setAttribute('placeholder', opts.placeholder);
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #cbd5e1;border-radius:9px;font-family:inherit;font-size:1em;margin-bottom:14px';
        box.appendChild(input);
        var btnRow = _el('div', 'pf-dialog-actions');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-start';
        function done() { _closeOverlay(ov); }
        function submit() {
            var val = (input.value == null ? '' : String(input.value)).trim();
            done();
            if (val && typeof opts.onSubmit === 'function') opts.onSubmit(val);
        }
        var ok = _el('button', 'pf-btn pf-btn-primary pf-dialog-ok', opts.confirmText || 'אישור');
        ok.style.cssText = 'cursor:pointer;padding:8px 16px;border:none;border-radius:9px;background:linear-gradient(135deg,#0d9488,#0891b2);color:#fff;font-family:inherit;font-weight:600';
        ok.onclick = submit;
        var cancel = _el('button', 'pf-btn pf-dialog-cancel', 'ביטול');
        cancel.style.cssText = 'cursor:pointer;padding:8px 16px;border:1px solid #cbd5e1;border-radius:9px;background:#f8fafc;font-family:inherit';
        cancel.onclick = done;
        btnRow.appendChild(ok); btnRow.appendChild(cancel);
        box.appendChild(btnRow);
        input.onkeydown = function (ev) {
            if (ev && ev.key === 'Enter') submit();
            else if (ev && ev.key === 'Escape') done();
        };
        ov.onclick = function (ev) { if (ev && ev.target === ov) done(); };
        ov.appendChild(box);
        try { if (input.focus) input.focus(); } catch (e) {}
    }

    // Confirm dialog. opts: { title, message, confirmText, danger, onConfirm() }.
    function _confirmDialog(opts) {
        opts = opts || {};
        var ov = _overlay();
        if (!ov) {
            var ok = false;
            try { if (typeof confirm === 'function') ok = confirm(opts.message || opts.title || ''); } catch (e) {}
            if (ok && typeof opts.onConfirm === 'function') opts.onConfirm();
            return;
        }
        var box = _el('div', 'pf-dialog');
        box.style.cssText = 'background:#fff;border-radius:14px;padding:18px;min-width:260px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,0.25)';
        if (opts.title) { var h = _el('div', 'pf-dialog-title', opts.title); h.style.cssText = 'font-weight:700;margin-bottom:8px;color:#0f172a'; box.appendChild(h); }
        if (opts.message) { var m = _el('div', 'pf-dialog-msg', opts.message); m.style.cssText = 'color:#475569;font-size:0.92em;margin-bottom:14px;white-space:pre-line'; box.appendChild(m); }
        var btnRow = _el('div', 'pf-dialog-actions');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-start';
        function done() { _closeOverlay(ov); }
        var ok2 = _el('button', 'pf-btn pf-dialog-ok', opts.confirmText || 'אישור');
        ok2.style.cssText = 'cursor:pointer;padding:8px 16px;border:none;border-radius:9px;color:#fff;font-family:inherit;font-weight:600;background:' + (opts.danger ? '#dc2626' : 'linear-gradient(135deg,#0d9488,#0891b2)');
        ok2.onclick = function () { done(); if (typeof opts.onConfirm === 'function') opts.onConfirm(); };
        var cancel2 = _el('button', 'pf-btn pf-dialog-cancel', 'ביטול');
        cancel2.style.cssText = 'cursor:pointer;padding:8px 16px;border:1px solid #cbd5e1;border-radius:9px;background:#f8fafc;font-family:inherit';
        cancel2.onclick = done;
        btnRow.appendChild(ok2); btnRow.appendChild(cancel2);
        box.appendChild(btnRow);
        ov.onclick = function (ev) { if (ev && ev.target === ov) done(); };
        ov.appendChild(box);
    }

    // -----------------------------------------------------------------------
    // Render.
    // Layout (top → bottom):
    //   [big search]  [filter chips: types · difficulty · tags · archived · clear]
    //   [shared-with-me strip]
    //   [toolbar: ＋ new folder]
    //   [body: folder tree | results/items]
    // -----------------------------------------------------------------------
    function _resolveTarget(target) {
        var d = _doc();
        if (!d) return null;
        if (!target) return null;
        if (typeof target === 'string') return d.querySelector(target);
        return target; // assume element
    }

    function _renderShell() {
        var root = state.root;
        if (!root) return;
        root.innerHTML = '';
        root.setAttribute('dir', 'rtl');
        root.className = (root.className || '') + ' pf-root';

        if (state.needsLogin) {
            var note = _el('div', 'pf-needs-login', 'התחבר כדי לראות את התיקיות והתוכן שלך');
            if (note) { note.style.cssText = 'padding:16px;color:#64748b;text-align:center;font-family:inherit'; root.appendChild(note); }
            return;
        }

        // Big search.
        var searchbar = _el('div', 'pf-searchbar');
        if (searchbar) {
            searchbar.style.cssText = 'margin-bottom:10px';
            var sIn = _el('input', 'pf-search-big');
            if (sIn) {
                sIn.type = 'search';
                sIn.setAttribute('placeholder', '🔍 חיפוש בכל התוכן — שם, סוג, תגית…');
                sIn.value = state.filters.q || '';
                sIn.style.cssText = 'width:100%;box-sizing:border-box;padding:11px 14px;border:1px solid #cbd5e1;border-radius:12px;font-family:inherit;font-size:1.05em;background:#f8fafc';
                sIn.oninput = function () {
                    var v = sIn.value;
                    clearTimeout(state._qTimer);
                    state._qTimer = setTimeout(function () { state.filters.q = v; _runFeed(); }, 250);
                };
                sIn.onkeydown = function (ev) {
                    if (ev && ev.key === 'Enter') { clearTimeout(state._qTimer); state.filters.q = sIn.value; _runFeed(); }
                };
                state._searchInput = sIn;
                searchbar.appendChild(sIn);
            }
            root.appendChild(searchbar);
        }

        // Filters row (container; populated by _renderFilters).
        var filtersWrap = _el('div', 'pf-filters');
        if (filtersWrap) {
            filtersWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px';
            state._filtersWrap = filtersWrap;
            root.appendChild(filtersWrap);
            _renderFilters();
        }

        // Shared-with-me strip.
        var shared = _el('div', 'pf-shared');
        if (shared) {
            shared.style.cssText = 'margin-bottom:12px';
            var sh = _el('div', 'pf-shared-head', 'משותף איתי');
            if (sh) sh.style.cssText = 'font-weight:600;margin-bottom:4px';
            shared.appendChild(sh);
            var sl = _el('div', 'pf-shared-list'); if (sl) sl.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
            shared.appendChild(sl);
            root.appendChild(shared);
            foldersSharedWithMe().then(function (d) {
                if (!sl) return;
                sl.innerHTML = '';
                var arr = (d && d.ok && d.folders) ? d.folders : [];
                if (!arr.length) { var none = _el('div', 'pf-muted', '— אין —'); if (none) { none.style.cssText = 'color:#94a3b8'; sl.appendChild(none); } return; }
                arr.forEach(function (f) {
                    var row = _el('button', 'pf-shared-item', '📁 ' + f.folder_name + ' (' + (f.role || 'view') + ')');
                    if (row) {
                        row.style.cssText = 'cursor:pointer;padding:3px 10px;border:1px solid #bae6fd;border-radius:999px;background:#f0f9ff;font-family:inherit;font-size:0.85em';
                        row.onclick = function () { _resetFilters(); if (state._searchInput) state._searchInput.value = ''; _openFolder(f.folder_id, f.folder_name); _renderFilters(); };
                        sl.appendChild(row);
                    }
                });
            });
        }

        // Toolbar.
        var bar = _el('div', 'pf-toolbar');
        if (bar) {
            bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px';
            var newBtn = _el('button', 'pf-btn pf-new-folder', '＋ תיקייה חדשה');
            if (newBtn) {
                newBtn.style.cssText = 'cursor:pointer;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-family:inherit';
                newBtn.onclick = function () { _promptNewFolder(null); };
                bar.appendChild(newBtn);
            }
            root.appendChild(bar);
        }

        // Two-pane body: tree + results.
        var body = _el('div', 'pf-body');
        if (body) {
            body.style.cssText = 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap';
            var treeWrap = _el('div', 'pf-tree'); if (treeWrap) treeWrap.style.cssText = 'flex:1;min-width:200px';
            var itemsWrap = _el('div', 'pf-items'); if (itemsWrap) itemsWrap.style.cssText = 'flex:2;min-width:240px';
            body.appendChild(treeWrap);
            body.appendChild(itemsWrap);
            root.appendChild(body);
            state._treeWrap = treeWrap;
            state._itemsWrap = itemsWrap;
            _renderTree();
            _renderResults();
        }

        // Create-document bar — bottom-left of the Drive area (RTL: flex-end = physical left).
        var createBar = _el('div', 'pf-create-bar');
        if (createBar) {
            createBar.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px';
            var cBtn = _el('button', 'pf-btn pf-create-doc', '＋ צור מסמך');
            if (cBtn) {
                cBtn.style.cssText = 'cursor:pointer;padding:9px 18px;border:none;border-radius:10px;font-family:inherit;font-weight:600;color:#fff;background:linear-gradient(135deg,#0d9488,#0891b2)';
                cBtn.onclick = function () { _openCreatePicker(); };
                state._createBtn = cBtn;
                createBar.appendChild(cBtn);
            }
            root.appendChild(createBar);
            _updateCreateBtn();
        }
    }

    // ----- filter chips -----
    function _chip(label, active, onClick, extraCls) {
        var b = _el('button', 'pf-chip ' + (extraCls || '') + (active ? ' pf-chip-active' : ''), label);
        if (!b) return b;
        b.style.cssText = 'cursor:pointer;padding:4px 12px;border-radius:999px;font-family:inherit;font-size:0.85em;border:1px solid ' +
            (active ? '#0d9488' : '#cbd5e1') + ';background:' + (active ? '#0d9488' : '#fff') + ';color:' + (active ? '#fff' : '#334155');
        b.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); onClick(); };
        return b;
    }

    function _renderFilters() {
        var wrap = state._filtersWrap;
        if (!wrap) return;
        wrap.innerHTML = '';

        // Type chips: primary three first, then any other discovered content_type.
        var types = PRIMARY_TYPES.slice();
        Object.keys(state.seenTypes).forEach(function (t) { if (types.indexOf(t) < 0) types.push(t); });
        var tLabel = _el('span', 'pf-filter-label', 'סוג:'); if (tLabel) { tLabel.style.cssText = 'font-size:0.8em;color:#64748b'; wrap.appendChild(tLabel); }
        types.forEach(function (t) {
            wrap.appendChild(_chip(typeLabel(t), state.filters.subject === t, function () {
                state.filters.subject = (state.filters.subject === t ? null : t);
                _runFeed(); _renderFilters();
            }, 'pf-type-chip'));
        });

        // Difficulty chips.
        var dLabel = _el('span', 'pf-filter-label', '· רמה:'); if (dLabel) { dLabel.style.cssText = 'font-size:0.8em;color:#64748b'; wrap.appendChild(dLabel); }
        DIFFICULTIES.forEach(function (dv) {
            wrap.appendChild(_chip(dv, state.filters.difficulty === dv, function () {
                state.filters.difficulty = (state.filters.difficulty === dv ? null : dv);
                _runFeed(); _renderFilters();
            }, 'pf-diff-chip'));
        });

        // Free-tag chips (loaded lazily; only render the row if any exist).
        if (state.freeTags && state.freeTags.length) {
            var gLabel = _el('span', 'pf-filter-label', '· תגיות:'); if (gLabel) { gLabel.style.cssText = 'font-size:0.8em;color:#64748b'; wrap.appendChild(gLabel); }
            state.freeTags.forEach(function (tg) {
                wrap.appendChild(_chip('#' + tg.name, !!state.filters.tags[tg.id], function () {
                    if (state.filters.tags[tg.id]) delete state.filters.tags[tg.id];
                    else state.filters.tags[tg.id] = true;
                    _runFeed(); _renderFilters();
                }, 'pf-tag-chip'));
            });
        }

        // Starred / favorites filter (LOCAL post-filter; does not hit the wire).
        wrap.appendChild(_chip('★ מועדפים', !!state.filters.starred, function () {
            state.filters.starred = !state.filters.starred;
            _renderResults(); _renderFilters();
        }, 'pf-star-filter'));

        // Include-archived toggle.
        var tog = _el('label', 'pf-arch-toggle');
        if (tog) {
            tog.style.cssText = 'font-size:0.82em;color:#475569;cursor:pointer;display:inline-flex;align-items:center;gap:3px;margin-inline-start:6px';
            var cb = _el('input', 'pf-arch-cb');
            if (cb) {
                cb.type = 'checkbox'; cb.checked = state.includeArchived;
                cb.onchange = function () { state.includeArchived = cb.checked; _runFeed(); };
                tog.appendChild(cb);
            }
            var d = _doc(); if (d) tog.appendChild(d.createTextNode(' כולל בארכיון'));
            wrap.appendChild(tog);
        }

        // Clear-filters chip (only when something is active — incl. the local star filter).
        if (hasActiveFilters(state.filters) || state.filters.starred) {
            wrap.appendChild(_chip('✕ נקה סינון', false, function () {
                _resetFilters();
                if (state._searchInput) state._searchInput.value = '';
                _runFeed(); _renderFilters();
            }, 'pf-clear-chip'));
        }
    }

    // ----- folder tree -----
    function _renderTree() {
        var wrap = state._treeWrap;
        if (!wrap) return;
        wrap.innerHTML = '';
        var head = _el('div', 'pf-tree-head', 'תיקיות');
        if (head) { head.style.cssText = 'font-weight:600;margin-bottom:6px;color:#0f172a'; wrap.appendChild(head); }
        var tree = buildTree(state.folders);
        if (!tree.length) {
            var empty = _el('div', 'pf-muted', 'אין תיקיות עדיין — צור תיקייה ראשונה');
            if (empty) { empty.style.cssText = 'color:#94a3b8'; wrap.appendChild(empty); }
            return;
        }
        tree.forEach(function (node) { wrap.appendChild(_renderNode(node, 0)); });
    }

    function _renderNode(node, depth) {
        var box = _el('div', 'pf-node');
        if (!box) return box;
        var isCurrent = (state.mode === 'browse' && state.currentFolderId === node.id);
        var row = _el('div', 'pf-node-row' + (isCurrent ? ' pf-node-current' : ''));
        if (row) {
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:7px;padding-right:' + (depth * 14 + 4) + 'px;' + (isCurrent ? 'background:#ccfbf1' : '');
            var hasKids = node.children && node.children.length;
            var caret = _el('span', 'pf-caret', hasKids ? (state.expanded[node.id] ? '▾' : '▸') : '·');
            if (caret) {
                caret.style.cssText = 'cursor:' + (hasKids ? 'pointer' : 'default') + ';width:14px;display:inline-block;text-align:center';
                caret.onclick = function () { state.expanded[node.id] = !state.expanded[node.id]; _renderTree(); };
                row.appendChild(caret);
            }
            var label = _el('span', 'pf-node-name', '📁 ' + node.name);
            if (label) { label.style.cssText = 'cursor:pointer;flex:1'; label.onclick = function () { _openFolderFromTree(node.id, node.name); }; row.appendChild(label); }
            // inline actions
            row.appendChild(_iconBtn('＋', 'תת-תיקייה', function () { _promptNewFolder(node.id); }));
            row.appendChild(_iconBtn('✎', 'שינוי שם', function () { _promptRename(node); }));
            row.appendChild(_iconBtn('⇄', 'העברה', function () { _promptMove(node); }));
            row.appendChild(_iconBtn('🗑', 'מחיקה', function () { _confirmDelete(node); }));
            box.appendChild(row);
        }
        if (node.children && node.children.length && state.expanded[node.id]) {
            node.children.forEach(function (c) { box.appendChild(_renderNode(c, depth + 1)); });
        }
        return box;
    }

    function _iconBtn(glyph, title, fn) {
        var b = _el('button', 'pf-icon', glyph);
        if (!b) return b;
        b.title = title;
        b.style.cssText = 'cursor:pointer;border:none;background:transparent;font-size:0.95em;padding:1px 4px';
        b.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); fn(); };
        return b;
    }

    // ----- results / items pane -----
    function _feedHeader() {
        var starPrefix = state.filters.starred ? '★ ' : '';
        if (state.mode === 'browse') return starPrefix + '📂 ' + (state.currentFolderName || '');
        if (state.mode === 'search') { var _sp = starPrefix;
            var bits = [];
            if (state.filters.q) bits.push('"' + state.filters.q + '"');
            if (state.filters.subject) bits.push(typeLabel(state.filters.subject));
            if (state.filters.difficulty) bits.push(state.filters.difficulty);
            var nTags = Object.keys(state.filters.tags).filter(function (k) { return state.filters.tags[k]; }).length;
            if (nTags) bits.push(nTags + ' תגיות');
            return _sp + 'תוצאות' + (bits.length ? ': ' + bits.join(' · ') : '');
        }
        if (state.filters.starred) return '★ מועדפים';
        return '';
    }

    function _renderResults() {
        var wrap = state._itemsWrap;
        if (!wrap) return;
        wrap.innerHTML = '';

        if (state.mode === 'idle') {
            var hint = _el('div', 'pf-muted', 'בחר תיקייה, חפש, או סנן לפי סוג/רמה/תגית כדי לראות תוכן');
            if (hint) { hint.style.cssText = 'color:#94a3b8;padding:8px 0'; wrap.appendChild(hint); }
            _updateCreateBtn();
            return;
        }

        var head = _el('div', 'pf-items-head', _feedHeader());
        if (head) { head.style.cssText = 'font-weight:600;margin-bottom:6px;color:#0f172a'; wrap.appendChild(head); }

        // Starred is a LOCAL post-filter (stays off the wire — read contract unchanged).
        var items = state.items;
        if (state.filters.starred) items = items.filter(_isStarred);

        if (!items.length) {
            var emptyTxt = state.filters.starred ? '— אין מועדפים כאן —' : (state.mode === 'search' ? '— אין תוצאות —' : '— ריק —');
            var none = _el('div', 'pf-muted', emptyTxt);
            if (none) { none.style.cssText = 'color:#94a3b8'; wrap.appendChild(none); }
            _updateCreateBtn();
            return;
        }
        items.forEach(function (it) { wrap.appendChild(_renderItemRow(it)); });
        _updateCreateBtn();
    }

    // Reflect "can create here?" on the create-document button: enabled only while
    // browsing a concrete folder (the new item lands in the current folder).
    function _updateCreateBtn() {
        var b = state._createBtn;
        if (!b || !b.style) return;
        var enabled = (state.currentFolderId != null && state.mode === 'browse');
        b.style.opacity = enabled ? '1' : '0.5';
        if (b.className) b.className = b.className.replace(/\s*pf-create-disabled/g, '') + (enabled ? '' : ' pf-create-disabled');
        b.title = enabled ? ('צור מסמך חדש בתיקייה: ' + (state.currentFolderName || '')) : 'בחרו תיקייה כדי ליצור בה מסמך';
    }

    function _renderItemRow(it) {
        var row = _el('div', 'pf-item');
        if (!row) return row;
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #eef2f7;border-radius:9px;margin-bottom:4px';
        // favorite (star) toggle — leads the row
        var starred = _isStarred(it);
        var star = _el('button', 'pf-star' + (starred ? ' pf-star-on' : ''), starred ? '★' : '☆');
        if (star) {
            star.title = starred ? 'הסר ממועדפים' : 'הוסף למועדפים';
            star.setAttribute('aria-pressed', starred ? 'true' : 'false');
            star.style.cssText = 'cursor:pointer;border:none;background:transparent;font-size:1.05em;padding:0 2px;color:' + (starred ? '#f59e0b' : '#cbd5e1');
            star.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); _toggleFavorite(it); };
            row.appendChild(star);
        }
        var name = _el('span', 'pf-item-title', it.title || ('#' + it.id));
        if (name) name.style.cssText = 'flex:1';
        row.appendChild(name);
        // file-type badge (the Google-Docs/Sheets/Slides idea — type as a badge)
        if (it.content_type) {
            var ty = _el('span', 'pf-type-badge', typeLabel(it.content_type));
            if (ty) { ty.style.cssText = 'font-size:0.72em;color:#0f766e;background:#ccfbf1;border-radius:6px;padding:1px 7px'; row.appendChild(ty); }
        }
        if (it.is_shortcut) {
            var sc = _el('span', 'pf-badge-shortcut', '↪ קיצור');
            if (sc) { sc.style.cssText = 'font-size:0.72em;color:#0891b2;border:1px solid #bae6fd;border-radius:6px;padding:0 5px'; row.appendChild(sc); }
        }
        // archive / restore (non-destructive 3-state)
        var isArchived = (it.state === 'archived');
        row.appendChild(_iconBtn(isArchived ? '♻' : '🗄', isArchived ? 'שחזור' : 'העברה לארכיון', function () {
            var p = isArchived ? restoreItem(it.id, it.store) : archiveItem(it.id, it.store);
            p.then(function (d) { if (!_surface(d, isArchived ? 'שוחזר' : 'הועבר לארכיון')) _runFeed(); });
        }));
        return row;
    }

    // -----------------------------------------------------------------------
    // Interaction flows (in-page dialogs; headless fallback to prompt/confirm).
    // -----------------------------------------------------------------------
    function _promptNewFolder(parentId) {
        _inputDialog({
            title: 'תיקייה חדשה', label: 'שם התיקייה', placeholder: 'לדוגמה: כיתה ז', confirmText: 'צור',
            onSubmit: function (name) {
                createFolder(name, parentId).then(function (d) {
                    if (!_surface(d, 'נוצרה תיקייה')) { if (parentId != null) state.expanded[parentId] = true; refresh(); }
                });
            }
        });
    }
    function _promptRename(node) {
        _inputDialog({
            title: 'שינוי שם', label: 'שם חדש', value: node.name, confirmText: 'שמור',
            onSubmit: function (name) {
                if (name === node.name) return;
                renameFolder(node.id, name).then(function (d) { if (!_surface(d, 'השם עודכן')) refresh(); });
            }
        });
    }
    function _promptMove(node) {
        _inputDialog({
            title: 'העברת תיקייה', label: 'מזהה תיקיית-אב חדשה (ריק = שורש)', value: (node.parent_id == null ? '' : String(node.parent_id)), confirmText: 'העבר',
            onSubmit: function (pid) {
                var newParent = (pid === '' ? null : parseInt(pid, 10));
                moveFolder(node.id, newParent).then(function (d) {
                    // Cycle-reject + other errors surface here (backend Hebrew error).
                    if (!_surface(d, 'הועברה')) refresh();
                });
            }
        });
    }
    function _confirmDelete(node) {
        _confirmDialog({
            title: 'מחיקת תיקייה', danger: true, confirmText: 'מחק',
            message: 'למחוק את "' + node.name + '"?\nהפריטים בתוכה יהפכו ללא-מסודרים (התוכן עצמו לא נמחק) ותת-התיקיות יחוברו לתיקיית-האב.',
            onConfirm: function () {
                deleteFolder(node.id).then(function (d) {
                    if (!_surface(d)) {
                        if (state.currentFolderId === node.id) { state.currentFolderId = null; state.currentFolderName = ''; state.mode = 'idle'; state.items = []; }
                        _toast('נמחקה (' + (d.unfiled || 0) + ' פריטים שוחררו)');
                        refresh();
                    }
                });
            }
        });
    }

    // -----------------------------------------------------------------------
    // Create-document flow.
    //   - The button sits bottom-left of the Drive area.
    //   - Click -> in-page material-type picker (lesson/analysis/hindus/selfwork
    //     + any configured extras).
    //   - Pick -> we DO NOT invent backend item creation (content_org_api has no
    //     create-item endpoint; items are authored by the editor owners). Instead
    //     we hand off via two documented surfaces, in this order:
    //       1) a `plonterfolders:createitem` CustomEvent (detail = payload), and
    //       2) the optional `onCreateItem(payload)` mount callback.
    //     payload = { type, folderId, folderName, context }. The new item is meant
    //     to land in the CURRENT folder, so creation requires a browsed folder.
    // -----------------------------------------------------------------------
    function _openCreatePicker() {
        if (state.currentFolderId == null || state.mode !== 'browse') {
            _toast('בחרו תיקייה כדי ליצור בה מסמך');
            return;
        }
        var types = (state.createTypes && state.createTypes.length) ? state.createTypes : CREATE_TYPES;
        _typePickerDialog(types, function (type) { _emitCreate(type); });
    }

    // Material-type picker dialog: one button per type. Headless-safe (falls back
    // to no-op selection if there is no body — there is nothing sensible to prompt).
    function _typePickerDialog(types, onPick) {
        var ov = _overlay();
        if (!ov) { return; }
        var box = _el('div', 'pf-dialog pf-type-picker');
        box.style.cssText = 'background:#fff;border-radius:14px;padding:18px;min-width:280px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,0.25)';
        var h = _el('div', 'pf-dialog-title', 'איזה סוג מסמך ליצור?'); if (h) { h.style.cssText = 'font-weight:700;margin-bottom:12px;color:#0f172a'; box.appendChild(h); }
        var grid = _el('div', 'pf-type-grid'); if (grid) grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px';
        function done() { _closeOverlay(ov); }
        (types || []).forEach(function (t) {
            var btn = _el('button', 'pf-type-pick-btn', typeLabel(t));
            if (!btn) return;
            btn.setAttribute('data-type', t);
            btn.style.cssText = 'cursor:pointer;padding:10px 16px;border:1px solid #99f6e4;border-radius:10px;background:#f0fdfa;color:#0f766e;font-family:inherit;font-weight:600';
            btn.onclick = function () { done(); if (typeof onPick === 'function') onPick(t); };
            if (grid) grid.appendChild(btn);
        });
        if (grid) box.appendChild(grid);
        var cancel = _el('button', 'pf-btn pf-dialog-cancel', 'ביטול');
        if (cancel) { cancel.style.cssText = 'cursor:pointer;padding:8px 16px;border:1px solid #cbd5e1;border-radius:9px;background:#f8fafc;font-family:inherit'; cancel.onclick = done; box.appendChild(cancel); }
        ov.onclick = function (ev) { if (ev && ev.target === ov) done(); };
        ov.appendChild(box);
    }

    function _dispatchCreate(payload) {
        try {
            var d = _doc();
            if (d && typeof CustomEvent === 'function') {
                var ev = new CustomEvent(CREATE_EVENT, { detail: payload });
                if (state.root && typeof state.root.dispatchEvent === 'function') state.root.dispatchEvent(ev);
                else if (typeof d.dispatchEvent === 'function') d.dispatchEvent(ev);
            }
        } catch (e) { /* ignore — event surface is best-effort */ }
    }

    // Hand off a create request. Returns Promise<envelope-ish>. Never invents a
    // backend write; if a callback returns a thenable we refresh the folder when
    // it settles (so a freshly-created item shows up via list_folder_items).
    function _emitCreate(type) {
        if (state.currentFolderId == null) {
            _toast('בחרו תיקייה כדי ליצור בה מסמך');
            return Promise.resolve({ ok: false, error: 'no_folder' });
        }
        var payload = {
            type: type,
            folderId: state.currentFolderId,
            folderName: state.currentFolderName || '',
            context: (state.createContext == null ? null : state.createContext)
        };
        _dispatchCreate(payload);
        if (typeof state.onCreateItem === 'function') {
            var r = null;
            try { r = state.onCreateItem(payload); } catch (e) { r = null; }
            if (r && typeof r.then === 'function') {
                return r.then(function (res) {
                    if (state.currentFolderId != null) _openFolder(state.currentFolderId);
                    return (res == null ? { ok: true, dispatched: true } : res);
                });
            }
            if (state.currentFolderId != null) _openFolder(state.currentFolderId);
            return Promise.resolve(r == null ? { ok: true, dispatched: true } : r);
        }
        // No consumer wired yet — acknowledge, don't fake a create.
        _toast('בקשת יצירה נשלחה (' + typeLabel(type) + ') — בהמתנה לחיבור עורך');
        return Promise.resolve({ ok: true, dispatched: true, _noConsumer: true });
    }

    // -----------------------------------------------------------------------
    // Favorites (stars). No backend favorite endpoint exists (verified) — so a
    // toggle: (1) flips a LOCAL star (optimistic), (2) dispatches the
    // `plonterfolders:togglefavorite` CustomEvent, and (3) calls onToggleFavorite
    // if wired. If the consumer returns a thenable that resolves ok:false we
    // revert the optimistic flip. An item is "starred" if it's in the local set
    // OR the backend ever returns a truthy is_starred/starred/favorite field.
    // -----------------------------------------------------------------------
    function _starKey(it) { return (it && (it.store || 'content')) + ':' + (it ? it.id : ''); }
    function _isStarred(it) {
        if (!it) return false;
        if (state.starred[_starKey(it)]) return true;
        return !!(it.is_starred || it.starred || it.favorite);
    }
    function _dispatchFav(payload) {
        try {
            var d = _doc();
            if (d && typeof CustomEvent === 'function') {
                var ev = new CustomEvent(FAV_EVENT, { detail: payload });
                if (state.root && typeof state.root.dispatchEvent === 'function') state.root.dispatchEvent(ev);
                else if (typeof d.dispatchEvent === 'function') d.dispatchEvent(ev);
            }
        } catch (e) { /* best-effort */ }
    }
    function _setStar(key, on) { if (on) state.starred[key] = true; else delete state.starred[key]; }

    function _toggleFavorite(it) {
        var key = _starKey(it);
        var was = _isStarred(it);
        var desired = !was;
        var payload = {
            store: (it && it.store) || 'content',
            id: it ? it.id : null,
            folderId: state.currentFolderId,
            folderName: state.currentFolderName || '',
            context: (state.createContext == null ? null : state.createContext),
            wasStarred: was,
            starred: desired
        };
        _dispatchFav(payload);
        // optimistic local flip
        _setStar(key, desired);
        _renderResults();
        if (typeof state.onToggleFavorite === 'function') {
            var r = null;
            try { r = state.onToggleFavorite(payload); } catch (e) { r = null; }
            if (r && typeof r.then === 'function') {
                return r.then(function (res) {
                    var ok = (res === true) || (res && res.ok);
                    if (res != null && !ok) { _setStar(key, was); _renderResults(); } // revert on explicit failure
                    return (res == null ? { ok: true, starred: desired } : res);
                }, function () { _setStar(key, was); _renderResults(); return { ok: false, error: 'toggle_failed' }; });
            }
            if (r != null && r.ok === false) { _setStar(key, was); _renderResults(); } // sync explicit failure -> revert
            return Promise.resolve(r == null ? { ok: true, starred: desired } : r);
        }
        // No consumer: local-only (persistence is external / not wired yet).
        _toast(desired ? 'נוסף למועדפים' : 'הוסר מהמועדפים');
        return Promise.resolve({ ok: true, starred: desired, _noConsumer: true });
    }

    // Open a folder from the tree: clears any active filters/search first.
    function _openFolderFromTree(folderId, name) {
        _resetFilters();
        if (state._searchInput) state._searchInput.value = '';
        _renderFilters();
        _openFolder(folderId, name);
    }

    function _openFolder(folderId, name) {
        state.mode = 'browse';
        state.currentFolderId = folderId;
        if (name != null) state.currentFolderName = name;
        else { for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === folderId) { state.currentFolderName = state.folders[i].name; break; } }
        return listFolderItems(folderId, state.includeArchived).then(function (d) {
            state.items = (d && d.ok && d.items) ? d.items : [];
            if (d && !d.ok) _surface(d);
            _absorbTypes(state.items);
            _renderTree();
            _renderResults();
            return d;
        });
    }

    function _absorbTypes(items) {
        var changed = false;
        (items || []).forEach(function (it) {
            if (it && it.content_type && !state.seenTypes[it.content_type]) { state.seenTypes[it.content_type] = true; changed = true; }
        });
        if (changed && state._filtersWrap) _renderFilters();
    }

    // Run the active feed: filters → search feed; else current folder; else idle.
    function _runFeed() {
        if (hasActiveFilters(state.filters)) {
            state.mode = 'search';
            state.currentFolderId = null;
            var params = buildSearchParams(state.filters, state.includeArchived);
            return search(params).then(function (d) {
                state.items = (d && d.ok && d.results) ? d.results : [];
                if (d && !d.ok) _surface(d);
                _absorbTypes(state.items);
                _renderTree();
                _renderResults();
                return d;
            });
        }
        if (state.currentFolderId != null) return _openFolder(state.currentFolderId);
        state.mode = 'idle';
        state.items = [];
        _renderTree();
        _renderResults();
        return Promise.resolve({ ok: true });
    }

    // -----------------------------------------------------------------------
    // Lifecycle.
    // -----------------------------------------------------------------------
    function _loadFreeTags() {
        return listTags('free').then(function (d) {
            state.freeTags = (d && d.ok && d.tags) ? d.tags : [];
            if (state._filtersWrap) _renderFilters();
            return d;
        });
    }

    function refresh() {
        return listFolders().then(function (d) {
            if (d && d._needsLogin) { state.needsLogin = true; state.folders = []; _renderShell(); return d; }
            state.needsLogin = false;
            state.folders = (d && d.ok && d.folders) ? d.folders : [];
            if (d && !d.ok) _surface(d);
            _renderShell();
            _loadFreeTags(); // best-effort, populates tag chips when it returns
            return d;
        });
    }

    function _applyOpts(opts) {
        opts = opts || {};
        if (opts.apiBase) API = opts.apiBase;
        if (typeof opts.onCreateItem === 'function') state.onCreateItem = opts.onCreateItem;
        if (typeof opts.onToggleFavorite === 'function') state.onToggleFavorite = opts.onToggleFavorite;
        if (opts.context !== undefined) state.createContext = opts.context;
        if (opts.createTypes && opts.createTypes.length) state.createTypes = opts.createTypes.slice();
        if (opts.starred && typeof opts.starred === 'object') {
            // optional seed of the local starred set (e.g. from a prior session)
            (opts.starred.length ? opts.starred : Object.keys(opts.starred)).forEach(function (k) {
                if (typeof k === 'string' && k.indexOf(':') > 0) state.starred[k] = true;
            });
        }
    }

    function mount(target, opts) {
        // Fresh mount: clear the previous instance's create-config + local star
        // cache so a re-mount without opts doesn't inherit a stale consumer/context/
        // favorites, then apply opts (which may re-seed starred via opts.starred).
        state.onCreateItem = null; state.onToggleFavorite = null; state.createContext = null; state.createTypes = null;
        state.starred = {};
        _applyOpts(opts);
        var el = _resolveTarget(target);
        if (!el) { return Promise.resolve({ ok: false, error: 'mount target not found' }); }
        state.root = el;
        // Fresh mount starts at the neutral view (don't resume a stale folder/filter).
        state.currentFolderId = null; state.currentFolderName = ''; state.mode = 'idle'; state.items = [];
        _resetFilters();
        return refresh();
    }

    function init(opts) {
        opts = opts || {};
        _applyOpts(opts);
        if (opts.mount) return mount(opts.mount, opts);
        return Promise.resolve({ ok: true });
    }

    // -----------------------------------------------------------------------
    // Public API.
    // -----------------------------------------------------------------------
    return {
        // config / lifecycle
        init: init,
        mount: mount,
        refresh: refresh,
        isLoggedIn: isLoggedIn,
        // pure helpers
        buildTree: buildTree,
        typeLabel: typeLabel,
        buildSearchParams: buildSearchParams,
        hasActiveFilters: hasActiveFilters,
        // data — folders
        listFolders: listFolders,
        createFolder: createFolder,
        renameFolder: renameFolder,
        moveFolder: moveFolder,
        deleteFolder: deleteFolder,
        // data — membership / items
        listFolderItems: listFolderItems,
        addToFolder: addToFolder,
        addShortcut: addShortcut,
        removeFromFolder: removeFromFolder,
        archiveItem: archiveItem,
        restoreItem: restoreItem,
        // data — sharing
        createFolderShare: createFolderShare,
        listFolderShares: listFolderShares,
        revokeFolderShare: revokeFolderShare,
        foldersSharedWithMe: foldersSharedWithMe,
        // data — tags / search
        search: search,
        listTags: listTags,
        createTag: createTag,
        tagItem: tagItem,
        untagItem: untagItem,
        // create-document handoff (no backend write invented — see _emitCreate)
        createItem: function (type) { return _emitCreate(type); },
        setOnCreateItem: function (fn) { state.onCreateItem = (typeof fn === 'function' ? fn : null); },
        CREATE_EVENT: CREATE_EVENT,
        // favorites/stars (no backend write invented — see _toggleFavorite)
        toggleFavorite: function (it) { return _toggleFavorite(it); },
        setOnToggleFavorite: function (fn) { state.onToggleFavorite = (typeof fn === 'function' ? fn : null); },
        isStarred: function (it) { return _isStarred(it); },
        setStarred: function (store, id, on) { _setStar((store || 'content') + ':' + id, on !== false); if (state._itemsWrap) _renderResults(); },
        FAV_EVENT: FAV_EVENT,
        // diagnostics
        _apiBase: function () { return API; },
        _typeLabels: function () { var o = {}; Object.keys(TYPE_LABELS).forEach(function (k) { o[k] = TYPE_LABELS[k]; }); return o; },
        _createTypes: function () { return (state.createTypes && state.createTypes.length) ? state.createTypes.slice() : CREATE_TYPES.slice(); }
    };
})();

// CommonJS export so a Node test harness can require() it after stubbing globals
// (no effect in the browser where module is undefined).
if (typeof module !== 'undefined' && module.exports) { module.exports = window.PlonterFolders; }
