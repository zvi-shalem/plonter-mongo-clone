// SyncBridge — shared ContentSync scaffolding for per-item sync modules
// (analysesSync.js, hindusSync.js, vocabSync.js, future textsSync/lessonSync).
//
// Collapses the boilerplate each sync module repeats:
//   - meta JSON read/write (plonter_<type>_cs_meta key)
//   - ContentSync registration (registerModule, registerLister, registerPuller)
//   - save / deleteItem / syncAll / getBadge / getSyncState delegation
//
// Module-specific logic (storage layout, composite IDs, pull flow) is passed
// in as callbacks. Each sync module keeps its own custom onItemSaved hooks.
//
// Pilot adopter: analysesSync.js (2026-04-24). Other modules migrate via
// separate specs once SyncBridge is stable.

function SyncBridge(config) {
    if (!(this instanceof SyncBridge)) return new SyncBridge(config);

    this.contentType = config.contentType;
    this.metaKey     = config.metaKey;
    this._getItem    = config.getItem;    // required: (id) => { id, title, updated, data, ... } | null
    this._setItem    = config.setItem;    // required: (id, serverItem) => void
    this._listItems  = config.listItems;  // required: () => [{ id, title, updated }, ...]
    this._customPull = config.pull;       // optional async (ctx) => { loaded, serverCount }
    this._autoBoot   = config.autoBoot !== false;  // default true

    if (!this.contentType) throw new Error('SyncBridge: contentType required');
    if (!this.metaKey)     throw new Error('SyncBridge: metaKey required');
    if (typeof this._getItem   !== 'function') throw new Error('SyncBridge: getItem fn required');
    if (typeof this._setItem   !== 'function') throw new Error('SyncBridge: setItem fn required');
    if (typeof this._listItems !== 'function') throw new Error('SyncBridge: listItems fn required');

    if (this._autoBoot) this._boot();
}

SyncBridge.prototype._nowIso = function () {
    return new Date().toISOString();
};

SyncBridge.prototype.getMeta = function () {
    try { return JSON.parse(localStorage.getItem(this.metaKey) || '{}'); }
    catch (_) { return {}; }
};

SyncBridge.prototype.setMeta = function (m) {
    localStorage.setItem(this.metaKey, JSON.stringify(m));
};

SyncBridge.prototype.stampItem = function (itemId) {
    var m = this.getMeta();
    m[String(itemId)] = this._nowIso();
    this.setMeta(m);
};

SyncBridge.prototype.forgetItem = function (itemId) {
    var m = this.getMeta();
    delete m[String(itemId)];
    this.setMeta(m);
};

// Save via ContentSync after the caller has already written to localStorage.
// Caller is responsible for stamping meta (or we'll do it automatically).
SyncBridge.prototype.save = function (itemId) {
    this.stampItem(itemId);
    if (typeof ContentSync === 'undefined' || typeof ContentSync.save !== 'function') return null;
    var item = this._getItem(itemId);
    if (!item) return null;
    try { return ContentSync.save(this.contentType, itemId, item); }
    catch (e) { console.warn('[SyncBridge ' + this.contentType + '] save threw', e); return null; }
};

SyncBridge.prototype.deleteItem = function (itemId) {
    this.forgetItem(itemId);
    if (typeof ContentSync === 'undefined' || typeof ContentSync.deleteItem !== 'function') return null;
    try { return ContentSync.deleteItem(this.contentType, itemId); }
    catch (e) { console.warn('[SyncBridge ' + this.contentType + '] deleteItem threw', e); return null; }
};

SyncBridge.prototype.syncAll = function () {
    if (typeof ContentSync === 'undefined' || typeof ContentSync.syncAll !== 'function') {
        return Promise.resolve({ attempted: 0, succeeded: 0, errors: ['ContentSync not loaded'] });
    }
    return ContentSync.syncAll(this.contentType);
};

SyncBridge.prototype.getBadge = function (itemId) {
    if (typeof ContentSync === 'undefined' || typeof ContentSync.getSyncBadge !== 'function') return '';
    return ContentSync.getSyncBadge(this.contentType, itemId);
};

SyncBridge.prototype.getSyncState = function (itemId) {
    if (typeof ContentSync === 'undefined' || typeof ContentSync.getSyncState !== 'function') return 'unsynced';
    return ContentSync.getSyncState(this.contentType, itemId);
};

// Default puller for modules that have no custom _pull. Each listItems entry
// becomes one _setItem call on the server response. Modules with flat-array
// storage (lessons, texts) should pass a custom _pull that fetches & bulk-
// writes — the default here is the per-item shape used by analyses/hindus.
SyncBridge.prototype._defaultPull = async function (ctx) {
    var api = ctx && ctx.api;
    if (typeof api !== 'function') return { loaded: 0, error: 'no api' };
    var res = await api('list', { content_type: this.contentType });
    if (!res || !res.success) return { loaded: 0, error: (res && res.error) || 'list failed' };
    var items = res.items || [];
    var loaded = 0;
    var setItemMeta = ctx && ctx.setItemMeta;
    for (var i = 0; i < items.length; i++) {
        var srv = items[i];
        if (!srv || !srv.id) continue;
        this._setItem(srv.id, srv);
        if (typeof setItemMeta === 'function') {
            setItemMeta(this.contentType, srv.id, {
                synced:            true,
                serverId:          srv.id,
                lastServerUpdated: srv.updated
            });
        }
        loaded++;
    }
    return { loaded: loaded, serverCount: items.length };
};

SyncBridge.prototype._register = function () {
    if (typeof ContentSync === 'undefined') return false;
    var self = this;
    if (typeof ContentSync.registerModule === 'function') {
        ContentSync.registerModule(this.contentType, function (id) { return self._getItem(id); }, function (id, srv) { return self._setItem(id, srv); });
    }
    if (typeof ContentSync.registerLister === 'function') {
        ContentSync.registerLister(this.contentType, function () { return self._listItems(); });
    }
    if (typeof ContentSync.registerPuller === 'function') {
        var puller = this._customPull
            ? function (ctx) { return self._customPull(ctx); }
            : function (ctx) { return self._defaultPull(ctx); };
        ContentSync.registerPuller(this.contentType, puller);
    }
    return true;
};

SyncBridge.prototype._boot = function () {
    var self = this;
    var attempt = function () {
        if (!self._register()) setTimeout(attempt, 300);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attempt);
    } else {
        attempt();
    }
};

if (typeof window !== 'undefined') window.SyncBridge = SyncBridge;
