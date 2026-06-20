// HistoryManager — shared per-scope undo/redo across Plonter subsystems.
// Scope key format: `${domain}:${slotKey}` (e.g. "analysis:0", "annotations:default", "hindus:tab_abc").

const HistoryManager = {
    _scopes: {},
    _defaultMaxLevels: 50,

    _key(domain, slotKey) {
        return domain + ':' + (slotKey == null ? 'default' : String(slotKey));
    },

    getScope(domain, slotKey) {
        const k = this._key(domain, slotKey);
        if (!this._scopes[k]) {
            this._scopes[k] = { undoStack: [], redoStack: [], maxLevels: this._defaultMaxLevels };
        }
        return this._scopes[k];
    },

    snapshot(domain, slotKey, data) {
        const scope = this.getScope(domain, slotKey);
        scope.undoStack.push(data);
        if (scope.undoStack.length > scope.maxLevels) scope.undoStack.shift();
        scope.redoStack = [];
    },

    undo(domain, slotKey, currentDataFactory) {
        const scope = this.getScope(domain, slotKey);
        if (scope.undoStack.length === 0) return null;
        if (typeof currentDataFactory === 'function') {
            scope.redoStack.push(currentDataFactory());
        }
        return scope.undoStack.pop();
    },

    redo(domain, slotKey, currentDataFactory) {
        const scope = this.getScope(domain, slotKey);
        if (scope.redoStack.length === 0) return null;
        if (typeof currentDataFactory === 'function') {
            scope.undoStack.push(currentDataFactory());
        }
        return scope.redoStack.pop();
    },

    canUndo(domain, slotKey) {
        return this.getScope(domain, slotKey).undoStack.length > 0;
    },

    canRedo(domain, slotKey) {
        return this.getScope(domain, slotKey).redoStack.length > 0;
    },

    clearScope(domain, slotKey) {
        const scope = this.getScope(domain, slotKey);
        scope.undoStack = [];
        scope.redoStack = [];
    },

    clearDomain(domain) {
        const prefix = domain + ':';
        Object.keys(this._scopes).forEach(k => {
            if (k.indexOf(prefix) === 0) delete this._scopes[k];
        });
    },

    setMaxLevels(domain, slotKey, n) {
        this.getScope(domain, slotKey).maxLevels = n;
    },

    // Shift numeric slot indices down by 1 for all keys > deletedKey.
    // Used when an analysis slot is deleted from an indexed list.
    renumberAfterDelete(domain, deletedKey) {
        const prefix = domain + ':';
        const deletedStr = String(deletedKey);
        delete this._scopes[prefix + deletedStr];
        const affected = Object.keys(this._scopes)
            .filter(k => {
                if (k.indexOf(prefix) !== 0) return false;
                const suffix = k.substring(prefix.length);
                const n = parseInt(suffix, 10);
                return !isNaN(n) && n > deletedKey;
            })
            .sort((a, b) => {
                const na = parseInt(a.substring(prefix.length), 10);
                const nb = parseInt(b.substring(prefix.length), 10);
                return na - nb;
            });
        for (const k of affected) {
            const idx = parseInt(k.substring(prefix.length), 10);
            this._scopes[prefix + String(idx - 1)] = this._scopes[k];
            delete this._scopes[k];
        }
    },
};

if (typeof window !== 'undefined') window.HistoryManager = HistoryManager;
