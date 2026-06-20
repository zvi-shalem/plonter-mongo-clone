/*
 * foldersUI.test.js — Node DOM-stub harness for clone/js/foldersUI.js.
 *
 * The real backend (api/content_org_api.php) is live-only / auth-gated, so this
 * harness stubs fetch + localStorage + a minimal document and drives the REAL
 * PlonterFolders module through every flow, asserting:
 *   - correct action + param mapping + Bearer auth on the wire
 *   - folder CRUD incl. simulated cycle-reject surfaced
 *   - delete unfile/reparent reporting
 *   - open folder + items (shortcut marker + archived toggle)
 *   - archive/restore (3-state)
 *   - share create/list/revoke + shared-with-me
 *   - search (tag-only + in-folder) with results/items key normalization
 *   - store threading (content/media)
 *   - graceful not-logged-in path (no fetch call, neutral state)
 *   - render does not throw against the DOM stub
 *
 * Run: node clone/js/foldersUI.test.js
 */

// ---------- counters ----------
var pass = 0, fail = 0, log = [];
function check(name, cond) {
    if (cond) { pass++; log.push('  PASS  ' + name); }
    else { fail++; log.push('  FAIL  ' + name); }
}
function section(t) { log.push('\n' + t); }

// ---------- localStorage stub ----------
var _store = {};
global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
    setItem: function (k, v) { _store[k] = String(v); },
    removeItem: function (k) { delete _store[k]; },
    clear: function () { _store = {}; }
};
localStorage.setItem('plonter_auth_token', 'TESTTOKEN123');

// ---------- minimal DOM stub ----------
function makeEl(tag) {
    return {
        tagName: tag, className: '', _children: [], style: {}, _text: '', _html: '',
        attrs: {}, title: '', type: '', checked: false, value: '',
        onclick: null, onchange: null, onkeydown: null,
        set textContent(v) { this._text = v; }, get textContent() { return this._text; },
        set innerHTML(v) { this._html = v; this._children = []; }, get innerHTML() { return this._html; },
        setAttribute: function (k, v) { this.attrs[k] = v; },
        getAttribute: function (k) { return this.attrs[k]; },
        appendChild: function (c) { if (c) this._children.push(c); return c; },
        removeChild: function (c) { var i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
        querySelector: function () { return null; }
    };
}
global.document = {
    createElement: function (t) { return makeEl(t); },
    createTextNode: function (t) { return { nodeType: 3, textContent: t }; },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    addEventListener: function () {},
    body: makeEl('body'),
    head: makeEl('head')
};
global.window = { location: { origin: 'https://iseemath.co', pathname: '/plonter/clone/', search: '' } };
global.confirm = function () { return true; };
global.prompt = function () { return null; };

// ---------- fetch stub: a tiny in-memory org backend ----------
var captured = [];           // every request captured for assertions
var backend = {
    folders: [
        { id: 1, parent_id: null, name: 'כיתה ז' },
        { id: 2, parent_id: 1, name: 'יחידה 3' },
        { id: 3, parent_id: 2, name: 'שיעור פתיחה' }
    ],
    // items per folder_id: {store,id,content_type,title,color,updated,is_shortcut,state}
    items: {
        2: [
            { store: 'content', id: 17, content_type: 'lesson', title: 'שיעור א', color: '#1', updated: '2026-06-06 10:00:00', is_shortcut: 0, state: 'live' },
            { store: 'media', id: 4, content_type: 'audio', title: 'הקלטה', color: '', updated: '2026-06-06 09:00:00', is_shortcut: 1, state: 'live' },
            { store: 'content', id: 99, content_type: 'lesson', title: 'בארכיון', color: '', updated: '2026-06-05 08:00:00', is_shortcut: 0, state: 'archived' }
        ]
    }
};

function jsonResp(obj) { return Promise.resolve({ json: function () { return Promise.resolve(obj); } }); }

global.fetch = function (url, opts) {
    opts = opts || {};
    var m = /action=([^&]+)/.exec(url);
    var action = m ? decodeURIComponent(m[1]) : '';
    var body = {};
    try { body = opts.body ? JSON.parse(opts.body) : {}; } catch (e) { body = {}; }
    var auth = (opts.headers && opts.headers['Authorization']) || '';
    captured.push({ action: action, body: body, auth: auth, method: opts.method });

    switch (action) {
        case 'list_folders':
            return jsonResp({ ok: true, folders: backend.folders.map(function (f) { return { id: f.id, parent_id: f.parent_id, name: f.name }; }) });
        case 'create_folder': {
            var nid = 100 + backend.folders.length;
            backend.folders.push({ id: nid, parent_id: (body.parent_id == null ? null : body.parent_id), name: body.name });
            return jsonResp({ ok: true, id: nid });
        }
        case 'rename_folder': {
            backend.folders.forEach(function (f) { if (f.id === body.id) f.name = body.name; });
            return jsonResp({ ok: true });
        }
        case 'move_folder': {
            // simulate backend cycle reject: moving a folder into its own descendant
            var fid = body.id, np = body.parent_id;
            function isDescendant(candidate, ancestor) {
                var cur = candidate, guard = 0;
                while (cur != null && guard++ < 100) {
                    if (cur === ancestor) return true;
                    var f = backend.folders.filter(function (x) { return x.id === cur; })[0];
                    cur = f ? f.parent_id : null;
                }
                return false;
            }
            if (np != null && (np === fid || isDescendant(np, fid))) {
                return jsonResp({ ok: false, error: 'אי אפשר להעביר תיקייה לתוך צאצא שלה' });
            }
            backend.folders.forEach(function (f) { if (f.id === fid) f.parent_id = (np == null ? null : np); });
            return jsonResp({ ok: true });
        }
        case 'delete_folder':
            return jsonResp({ ok: true, unfiled: 2, reparented_children: 1 });
        case 'list_folder_items': {
            var arr = (backend.items[body.folder_id] || []).slice();
            if (!body.include_archived) arr = arr.filter(function (it) { return it.state !== 'archived'; });
            return jsonResp({ ok: true, items: arr });
        }
        case 'add_to_folder':
            return jsonResp({ ok: true, home_folder_id: body.folder_id });
        case 'add_shortcut':
            return jsonResp({ ok: true });
        case 'remove_from_folder':
            return jsonResp({ ok: true, removed: 1 });
        case 'archive_item':
            return jsonResp({ ok: true, state: 'archived', archived_at: '2026-06-07 00:00:00' });
        case 'restore_item':
            return jsonResp({ ok: true, state: 'live' });
        case 'create_folder_share':
            return jsonResp({ ok: true, id: 55, token: 'a'.repeat(32), expires_at: '2026-07-07 00:00:00', role: body.role || 'view' });
        case 'list_folder_shares':
            return jsonResp({ ok: true, shares: [{ id: 55, folder_id: body.folder_id, target_type: 'link', role: 'view', token: 'a'.repeat(32) }] });
        case 'revoke_folder_share':
            return jsonResp({ ok: true, revoked: true });
        case 'folders_shared_with_me':
            return jsonResp({ ok: true, folders: [{ share_id: 9, folder_id: 7, folder_name: 'משותפת', owner_user_id: 2, role: 'view' }] });
        case 'search_content':
            // router returns results+count (NOT items) — exercises normalization
            return jsonResp({ ok: true, results: [{ store: 'content', id: 17, content_type: 'lesson', title: 'שיעור א', color: '#1', updated: '2026-06-06 10:00:00' }], count: 1 });
        case 'list_tags':
            return jsonResp({ ok: true, tags: [{ id: 12, name: 'פועל', namespace: 'free' }] });
        case 'create_tag':
            return jsonResp({ ok: true, id: 12, deduped: false });
        case 'tag_item':
            return jsonResp({ ok: true, deduped: false });
        case 'untag_item':
            return jsonResp({ ok: true, removed: 1 });
        default:
            return jsonResp({ ok: false, error: 'action לא מוכר: ' + action });
    }
};

// ---------- load the real module ----------
var PF = require('./foldersUI.js');

// ---------- run ----------
(async function () {
    section('(0) module surface');
    check('module loaded as object', PF && typeof PF === 'object');
    ['init', 'mount', 'refresh', 'buildTree', 'listFolders', 'createFolder', 'renameFolder',
        'moveFolder', 'deleteFolder', 'listFolderItems', 'addToFolder', 'addShortcut',
        'removeFromFolder', 'archiveItem', 'restoreItem', 'createFolderShare', 'listFolderShares',
        'revokeFolderShare', 'foldersSharedWithMe', 'search', 'listTags', 'createTag', 'tagItem',
        'untagItem'].forEach(function (fn) { check('exposes ' + fn + '()', typeof PF[fn] === 'function'); });

    section('(1) buildTree pure helper');
    var tree = PF.buildTree(backend.folders);
    check('one root folder', tree.length === 1 && tree[0].id === 1);
    check('root has child יחידה 3', tree[0].children.length === 1 && tree[0].children[0].id === 2);
    check('grandchild nested', tree[0].children[0].children[0].id === 3);
    check('orphan parent becomes root (nothing dropped)', (function () {
        var t = PF.buildTree([{ id: 50, parent_id: 999, name: 'יתום' }]);
        return t.length === 1 && t[0].id === 50;
    })());
    check('buildTree([]) -> []', PF.buildTree([]).length === 0);

    section('(2) auth on the wire');
    captured.length = 0;
    var lf = await PF.listFolders();
    check('list_folders ok', lf && lf.ok === true && lf.folders.length === 3);
    check('Bearer token sent', captured[0].auth === 'Bearer TESTTOKEN123');
    check('correct action on the wire', captured[0].action === 'list_folders');

    section('(3) folder CRUD');
    var cf = await PF.createFolder('חדשה', 1);
    check('create_folder returns id', cf.ok && typeof cf.id === 'number');
    check('create_folder sent name+parent_id', (function () { var r = captured[captured.length - 1]; return r.body.name === 'חדשה' && r.body.parent_id === 1; })());
    var rf = await PF.renameFolder(2, 'יחידה משופצת');
    check('rename_folder ok + sent id+name', rf.ok && (function () { var r = captured[captured.length - 1]; return r.body.id === 2 && r.body.name === 'יחידה משופצת'; })());
    var mv = await PF.moveFolder(3, 1);
    check('move_folder (valid) ok', mv.ok === true);

    section('(4) move cycle-reject surfaced');
    var bad = await PF.moveFolder(1, 3); // 3 is a descendant of 1 -> reject
    check('cycle move returns ok:false', bad.ok === false);
    check('cycle move surfaces backend error text', /צאצא/.test(bad.error || ''));

    section('(5) delete (unfile + reparent)');
    var del = await PF.deleteFolder(2);
    check('delete_folder reports unfiled', del.ok && del.unfiled === 2);
    check('delete_folder reports reparented_children', del.reparented_children === 1);

    section('(6) open folder: items, shortcut marker, archived toggle');
    var live = await PF.listFolderItems(2, false);
    check('archived excluded by default (2 items)', live.ok && live.items.length === 2);
    check('shortcut marker present on media item', live.items.some(function (i) { return i.store === 'media' && i.is_shortcut === 1; }));
    var withArch = await PF.listFolderItems(2, true);
    check('include_archived=true returns 3 items', withArch.ok && withArch.items.length === 3);
    check('include_archived flag sent on the wire', captured[captured.length - 1].body.include_archived === true);

    section('(7) membership + store threading');
    var a2f = await PF.addToFolder(17, 2);
    check('add_to_folder default store=content', a2f.ok && captured[captured.length - 1].body.store === 'content');
    var asc = await PF.addShortcut(4, 2, 'media');
    check('add_shortcut threads store=media', asc.ok && captured[captured.length - 1].body.store === 'media');
    var rm = await PF.removeFromFolder(17, 2);
    check('remove_from_folder ok', rm.ok && rm.removed === 1);

    section('(8) 3-state archive / restore');
    var ar = await PF.archiveItem(99);
    check('archive_item -> state archived', ar.ok && ar.state === 'archived');
    var re = await PF.restoreItem(99);
    check('restore_item -> state live', re.ok && re.state === 'live');

    section('(9) folder sharing');
    var sh = await PF.createFolderShare(2, { role: 'view', ttlHours: 24 });
    check('create_folder_share returns 32-hex token', sh.ok && /^[0-9a-f]{32}$/.test(sh.token));
    check('ttl_hours mapped on the wire', captured[captured.length - 1].body.ttl_hours === 24);
    var ls = await PF.listFolderShares(2);
    check('list_folder_shares returns shares', ls.ok && ls.shares.length === 1);
    var rv = await PF.revokeFolderShare(55);
    check('revoke_folder_share ok', rv.ok && rv.revoked === true);
    var swm = await PF.foldersSharedWithMe();
    check('folders_shared_with_me returns a folder', swm.ok && swm.folders[0].folder_name === 'משותפת');

    section('(10) search — results/items normalization + scope');
    var sAll = await PF.search({ scope: 'all', q: 'שיעור' });
    check('search scope=all returns normalized results[]', sAll.ok && Array.isArray(sAll.results) && sAll.results.length === 1);
    check('search sent q on the wire', captured[captured.length - 1].body.q === 'שיעור');
    var sFolder = await PF.search({ scope: 'folder', folderId: 2, tags: [12], difficulty: 'קל' });
    check('in-folder search maps folder_id+tags+difficulty', (function () { var b = captured[captured.length - 1].body; return b.scope === 'folder' && b.folder_id === 2 && b.tags[0] === 12 && b.difficulty === 'קל'; })());

    section('(11) tags');
    var ct = await PF.createTag('פועל', 'free');
    check('create_tag ok', ct.ok && ct.id === 12);
    var lt = await PF.listTags('free');
    check('list_tags ok + namespace sent', lt.ok && captured[captured.length - 1].body.namespace === 'free');
    var ti = await PF.tagItem(17, 12);
    check('tag_item ok', ti.ok);
    var ut = await PF.untagItem(17, 12);
    check('untag_item ok', ut.ok && ut.removed === 1);

    section('(12) render does not throw (DOM stub)');
    var rootEl = makeEl('div');
    var threw = false, mountRes = null;
    try { mountRes = await PF.mount(rootEl, {}); } catch (e) { threw = true; log.push('    render threw: ' + e.message); }
    check('mount + full render completed without throwing', threw === false);
    check('mount returned an envelope', mountRes && typeof mountRes === 'object');
    check('root got pf-root class + children rendered', /pf-root/.test(rootEl.className) && rootEl._children.length > 0);

    section('(13) graceful not-logged-in path');
    captured.length = 0;
    localStorage.removeItem('plonter_auth_token');
    var noAuth = await PF.listFolders();
    check('no token -> ok:false needs_login', noAuth.ok === false && noAuth._needsLogin === true);
    check('no token -> NO fetch call made', captured.length === 0);
    var rootEl2 = makeEl('div');
    var threw2 = false;
    try { await PF.mount(rootEl2, {}); } catch (e) { threw2 = true; }
    check('mount while logged-out does not throw', threw2 === false);
    check('logged-out renders neutral needs-login chrome', rootEl2._children.some(function (c) { return /pf-needs-login/.test(c.className || ''); }));
    localStorage.setItem('plonter_auth_token', 'TESTTOKEN123'); // restore

    // ---------- DOM-walk helpers for the upgraded render ----------
    function _walk(node, fn) {
        if (!node) return;
        fn(node);
        var kids = node._children || [];
        for (var i = 0; i < kids.length; i++) _walk(kids[i], fn);
    }
    function findByClass(root, cls) {
        var hit = null;
        _walk(root, function (n) { if (!hit && typeof n.className === 'string' && n.className.split(/\s+/).indexOf(cls) >= 0) hit = n; });
        return hit;
    }
    function findAllByClass(root, cls) {
        var out = [];
        _walk(root, function (n) { if (typeof n.className === 'string' && n.className.split(/\s+/).indexOf(cls) >= 0) out.push(n); });
        return out;
    }
    function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

    section('(14) typeLabel pure helper');
    check('lesson -> שיעורים', PF.typeLabel('lesson') === 'שיעורים');
    check('analysis -> תחביר', PF.typeLabel('analysis') === 'תחביר');
    check('hindus -> הינדוס', PF.typeLabel('hindus') === 'הינדוס');
    check('unknown content_type passes through verbatim', PF.typeLabel('quiz_thing') === 'quiz_thing');
    check('empty/null -> empty string', PF.typeLabel('') === '' && PF.typeLabel(null) === '');

    section('(15) buildSearchParams + hasActiveFilters pure helpers');
    check('empty filters -> {scope:all} only', (function () { var p = PF.buildSearchParams({}, false); return p.scope === 'all' && p.subject === undefined && p.tags === undefined && p.q === undefined && p.includeArchived === undefined; })());
    check('subject+difficulty mapped', (function () { var p = PF.buildSearchParams({ subject: 'lesson', difficulty: 'קל' }, false); return p.subject === 'lesson' && p.difficulty === 'קל'; })());
    check('tags as id-array mapped', (function () { var p = PF.buildSearchParams({ tags: [5, 12] }, false); return p.tags.length === 2 && p.tags[0] === 5; })());
    check('tags as {id:bool} map -> only truthy ids', (function () { var p = PF.buildSearchParams({ tags: { 5: true, 7: false, 12: true } }, false); return p.tags.indexOf(5) >= 0 && p.tags.indexOf(12) >= 0 && p.tags.indexOf(7) < 0; })());
    check('q trimmed; blank q dropped', (function () { var a = PF.buildSearchParams({ q: '  פועל ' }, false); var b = PF.buildSearchParams({ q: '   ' }, false); return a.q === 'פועל' && b.q === undefined; })());
    check('includeArchived flag', PF.buildSearchParams({}, true).includeArchived === true);
    check('hasActiveFilters: false when empty', PF.hasActiveFilters({}) === false && PF.hasActiveFilters({ tags: {}, q: '' }) === false);
    check('hasActiveFilters: true for subject / q / tag-map / tag-array', PF.hasActiveFilters({ subject: 'lesson' }) && PF.hasActiveFilters({ q: 'x' }) && PF.hasActiveFilters({ tags: { 5: true } }) && PF.hasActiveFilters({ tags: [5] }));

    section('(16) upgraded render: big search + filter chips');
    var root16 = makeEl('div');
    await PF.mount(root16, {});
    check('renders prominent search box (pf-search-big)', !!findByClass(root16, 'pf-search-big'));
    check('renders filters row (pf-filters)', !!findByClass(root16, 'pf-filters'));
    check('renders the 3 primary file-type chips', (function () { var c = findAllByClass(root16, 'pf-type-chip'); var labels = c.map(function (x) { return x._text; }); return labels.indexOf('שיעורים') >= 0 && labels.indexOf('תחביר') >= 0 && labels.indexOf('הינדוס') >= 0; })());
    check('renders difficulty chips (קל/בינוני/קשה)', (function () { var c = findAllByClass(root16, 'pf-diff-chip').map(function (x) { return x._text; }); return c.indexOf('קל') >= 0 && c.indexOf('קשה') >= 0; })());
    check('renders include-archived toggle', !!findByClass(root16, 'pf-arch-cb'));
    check('renders folder tree pane', !!findByClass(root16, 'pf-tree'));

    section('(17) free-tag chips load from list_tags + type chip drives subject search');
    await flush(); // let _loadFreeTags + foldersSharedWithMe resolve
    PF.refresh(); await flush(); // re-render so freeTags chips appear
    check('free-tag chip rendered from list_tags (#פועל)', (function () { var c = findAllByClass(state_root17(), 'pf-tag-chip').map(function (x) { return x._text; }); return c.indexOf('#פועל') >= 0; })());
    function state_root17() { return root16; }
    // click the "שיעורים" type chip -> should fire a search_content with subject=lesson
    captured.length = 0;
    (function () { var chip = findAllByClass(root16, 'pf-type-chip').filter(function (x) { return x._text === 'שיעורים'; })[0]; if (chip && chip.onclick) chip.onclick({}); })();
    await flush();
    check('type chip fires search_content with subject=lesson', (function () { var r = captured.filter(function (c) { return c.action === 'search_content'; }).pop(); return r && r.body.subject === 'lesson' && r.body.scope === 'all'; })());

    section('(18) in-page dialog replaces prompt() for new folder');
    // global prompt returns null in this harness; if the module still used prompt,
    // creating a folder would be impossible. The in-page dialog must drive it instead.
    var root18 = makeEl('div');
    await PF.mount(root18, {});
    await flush();
    captured.length = 0;
    var newBtn = findByClass(root18, 'pf-new-folder');
    check('new-folder button present', !!newBtn);
    if (newBtn && newBtn.onclick) newBtn.onclick({});
    var dlgInput = findByClass(document.body, 'pf-dialog-input');
    check('in-page input dialog opened (no prompt used)', !!dlgInput);
    if (dlgInput) dlgInput.value = 'תיקייה מהדיאלוג';
    var okBtn = findByClass(document.body, 'pf-dialog-ok');
    check('dialog has confirm button', !!okBtn);
    if (okBtn && okBtn.onclick) okBtn.onclick({});
    await flush();
    check('confirm sends create_folder with the typed name', (function () { var r = captured.filter(function (c) { return c.action === 'create_folder'; }).pop(); return r && r.body.name === 'תיקייה מהדיאלוג'; })());

    section('(19) create-document button + type picker + callback/event payload');
    var created = [];
    var root19 = makeEl('div');
    await PF.mount(root19, { onCreateItem: function (p) { created.push(p); }, context: { classId: 'ז-1' } });
    await flush();
    check('renders create-document button (pf-create-doc)', !!findByClass(root19, 'pf-create-doc'));
    check('createItem default types are lesson/analysis/hindus/selfwork', (function () { var t = PF._createTypes(); return t.length === 4 && t.indexOf('selfwork') >= 0 && t.indexOf('lesson') >= 0; })());
    check('selfwork has a Hebrew label', PF.typeLabel('selfwork') === 'עבודה עצמית');
    check('CREATE_EVENT name exposed', PF.CREATE_EVENT === 'plonterfolders:createitem');

    // guard: no folder selected -> picker NOT opened, callback NOT called
    var pickBtnsBefore = findAllByClass(document.body, 'pf-type-pick-btn').length;
    var createBtn = findByClass(root19, 'pf-create-doc');
    if (createBtn && createBtn.onclick) createBtn.onclick({});
    check('no-folder guard: type picker not opened', findAllByClass(document.body, 'pf-type-pick-btn').length === pickBtnsBefore);
    check('no-folder guard: onCreateItem not called', created.length === 0);

    // open a real folder, then create -> picker opens, pick lesson -> callback payload
    await PF.listFolders(); // ensure folders loaded into state via refresh already; open folder 2
    // open folder 2 through the tree label
    var folderLabels = findAllByClass(root19, 'pf-node-name');
    var lblRoot = folderLabels.filter(function (x) { return /כיתה ז/.test(x._text || ''); })[0];
    check('root folder label present to open', !!lblRoot);
    if (lblRoot && lblRoot.onclick) lblRoot.onclick({});
    await flush();
    if (createBtn && createBtn.onclick) createBtn.onclick({});
    var pickBtns = findAllByClass(document.body, 'pf-type-pick-btn');
    check('type picker opened with 4 type buttons', pickBtns.length >= 4);
    var lessonBtn = pickBtns.filter(function (b) { return b.getAttribute && b.getAttribute('data-type') === 'lesson'; })[0];
    check('picker has a lesson button', !!lessonBtn);
    if (lessonBtn && lessonBtn.onclick) lessonBtn.onclick({});
    await flush();
    check('onCreateItem called once with type=lesson', created.length === 1 && created[0].type === 'lesson');
    check('payload carries folderId of opened folder (1)', created[0].folderId === 1);
    check('payload carries context passed at mount', created[0].context && created[0].context.classId === 'ז-1');

    section('(20) programmatic createItem(): folder guard, no-consumer ack, CustomEvent');
    var root20 = makeEl('div');
    await PF.mount(root20, {}); // no onCreateItem consumer; fresh mount = idle
    await flush();
    // capture the CustomEvent on the root (env supports global CustomEvent in node)
    var ev20 = [];
    root20.dispatchEvent = function (e) { ev20.push(e); return true; };

    var resNoFolder = await PF.createItem('lesson'); // idle, no current folder
    check('createItem with no current folder -> ok:false no_folder', resNoFolder && resNoFolder.ok === false && resNoFolder.error === 'no_folder');
    check('no-folder create dispatched NO event', ev20.length === 0);

    // open folder 2, then create with no consumer wired
    var l2 = findAllByClass(root20, 'pf-node-name').filter(function (x) { return /כיתה ז/.test(x._text || ''); })[0];
    if (l2 && l2.onclick) l2.onclick({});
    await flush();
    var res = await PF.createItem('hindus');
    check('createItem with no consumer -> ok:true _noConsumer', res && res.ok === true && res._noConsumer === true);
    check('CustomEvent plonterfolders:createitem dispatched on root', ev20.length === 1 && ev20[0].type === 'plonterfolders:createitem');
    check('event detail carries type=hindus + folderId=1', ev20[0].detail && ev20[0].detail.type === 'hindus' && ev20[0].detail.folderId === 1);

    section('(21) createTypes override extends the picker');
    var root21 = makeEl('div');
    await PF.mount(root21, { createTypes: ['lesson', 'selfwork', 'quiz_custom'] });
    await flush();
    check('createTypes override reflected in _createTypes()', (function () { var t = PF._createTypes(); return t.length === 3 && t.indexOf('quiz_custom') >= 0; })());
    // open folder 2 and open picker to confirm the custom type renders (via typeLabel passthrough)
    var l21 = findAllByClass(root21, 'pf-node-name').filter(function (x) { return /כיתה ז/.test(x._text || ''); })[0];
    if (l21 && l21.onclick) l21.onclick({});
    await flush();
    var createBtn21 = findByClass(root21, 'pf-create-doc');
    if (createBtn21 && createBtn21.onclick) createBtn21.onclick({});
    var pick21 = findAllByClass(document.body, 'pf-type-pick-btn');
    check('picker shows the custom type button (label passthrough)', pick21.some(function (b) { return b.getAttribute && b.getAttribute('data-type') === 'quiz_custom' && b._text === 'quiz_custom'; }));

    // helper: open folder 2 (a collapsed child) in a freshly mounted root
    async function openFolder2(root) {
        var caret = findByClass(root, 'pf-caret'); // root "כיתה ז" caret
        if (caret && caret.onclick) caret.onclick({});           // expand root -> child appears
        await flush();
        var child = findAllByClass(root, 'pf-node-name').filter(function (x) { return /יחידה/.test(x._text || ''); })[0];
        if (child && child.onclick) child.onclick({});            // open folder 2
        await flush();
        return !!child;
    }

    section('(22) favorites: star button + toggle callback/event payload');
    var favCalls = [];
    var root22 = makeEl('div');
    await PF.mount(root22, { onToggleFavorite: function (p) { favCalls.push(p); return { ok: true }; }, context: { classId: 'fav-1' } });
    await flush();
    var favEv = [];
    root22.dispatchEvent = function (e) { favEv.push(e); return true; };
    check('FAV_EVENT name exposed', PF.FAV_EVENT === 'plonterfolders:togglefavorite');
    var opened22 = await openFolder2(root22);
    check('opened folder 2 with items', opened22);
    var stars = findAllByClass(root22, 'pf-star');
    check('star button renders on each item row (2 live items)', stars.length === 2);
    check('stars start empty (☆)', stars.every(function (s) { return s._text === '☆'; }));
    // toggle the first item's star
    if (stars[0] && stars[0].onclick) stars[0].onclick({});
    await flush();
    check('onToggleFavorite called once', favCalls.length === 1);
    check('payload has store/id/folderId/context + wasStarred=false + starred=true', (function () {
        var p = favCalls[0];
        return p && p.store === 'content' && p.id === 17 && p.folderId === 2 && p.context && p.context.classId === 'fav-1' && p.wasStarred === false && p.starred === true;
    })());
    check('CustomEvent plonterfolders:togglefavorite dispatched on root', favEv.length === 1 && favEv[0].type === 'plonterfolders:togglefavorite');
    check('item is now starred (PF.isStarred)', PF.isStarred({ store: 'content', id: 17 }) === true);
    // after re-render, that row's star should be filled
    var starsAfter = findAllByClass(root22, 'pf-star');
    check('toggled star now filled (pf-star-on present)', findAllByClass(root22, 'pf-star-on').length === 1);

    section('(23) starred filter chip + local filtering + backend field honored');
    var starChip = findByClass(root22, 'pf-star-filter');
    check('starred filter chip renders', !!starChip);
    if (starChip && starChip.onclick) starChip.onclick({});
    await flush();
    check('starred filter narrows to the 1 starred item (local filter)', findAllByClass(root22, 'pf-item').length === 1);
    // turn filter off again
    if (starChip && starChip.onclick) starChip.onclick({});
    await flush();
    check('clearing star filter shows all items again (2)', findAllByClass(root22, 'pf-item').length === 2);
    check('isStarred honors a backend is_starred field', PF.isStarred({ store: 'content', id: 999, is_starred: 1 }) === true && PF.isStarred({ store: 'content', id: 998 }) === false);

    section('(24) favorites: no-consumer local-only path + programmatic toggleFavorite');
    var root24 = makeEl('div');
    await PF.mount(root24, {}); // no onToggleFavorite consumer
    await flush();
    await openFolder2(root24);
    var stars24 = findAllByClass(root24, 'pf-star');
    var resFav = await PF.toggleFavorite({ store: 'content', id: 17 });
    check('toggleFavorite with no consumer -> ok:true _noConsumer', resFav && resFav.ok === true && resFav._noConsumer === true && resFav.starred === true);
    check('local star set even with no consumer', PF.isStarred({ store: 'content', id: 17 }) === true);
    var resUnfav = await PF.toggleFavorite({ store: 'content', id: 17 });
    check('toggling again unstars (starred=false)', resUnfav && resUnfav.starred === false && PF.isStarred({ store: 'content', id: 17 }) === false);

    // ---------- summary ----------
    log.push('\n' + pass + ' passed, ' + fail + ' failed.');
    console.log(log.join('\n'));
    if (fail > 0) process.exit(1);
})();
