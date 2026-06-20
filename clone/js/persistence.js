// Persistence — localStorage save/load with debouncing

class PersistenceManager {
    constructor(stateManager) {
        this.state = stateManager;
        this._saveTimer = null;
        this._debounceMs = 500;

        // Auto-save on state changes
        this.state.on('stateChanged', () => this._debounceSave());
    }

    _storageKey(stageId, analysisId) {
        return `plonter_v4_stage_${stageId || this.state.currentStageId}_analysis_${analysisId || 'default'}`;
    }

    _debounceSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.save(), this._debounceMs);
    }

    save(analysisId) {
        if (!this.state.currentStageId) return;
        const key = this._storageKey(null, analysisId);
        const data = this.state.toJSON();
        data.savedAt = Date.now();
        data.analysisId = analysisId || 'default';
        try {
            localStorage.setItem(key, JSON.stringify(data));
            this._showSaveIndicator(data.analysisId);
            if (typeof AnalysesSync !== 'undefined' && AnalysesSync.onAnalysisSaved) {
                AnalysesSync.onAnalysisSaved(this.state.currentStageId, data.analysisId);
            }
        } catch (e) {
            console.warn('Failed to save to localStorage:', e);
        }
    }

    _showSaveIndicator(analysisId) {
        var headerRow = document.querySelector('#game-screen .header-row');
        if (!headerRow) return;
        var toast = document.getElementById('plonter-save-toast');
        if (!toast) {
            toast = document.createElement('span');
            toast.id = 'plonter-save-toast';
            toast.style.cssText = 'font-size:0.78em;color:#0d9488;font-weight:bold;opacity:0;transition:opacity 0.35s;padding:0 8px;white-space:nowrap';
            headerRow.appendChild(toast);
        }
        toast.textContent = '✓ נשמר';
        toast.style.opacity = '1';
        clearTimeout(this._saveToastTimer);
        const self = this;
        this._saveToastTimer = setTimeout(function() { toast.style.opacity = '0'; }, 1500);
        // Render AnalysesSync badge
        if (typeof AnalysesSync !== 'undefined' && typeof AnalysesSync.getBadge === 'function') {
            var badgeEl = document.getElementById('plonter-analysis-sync-badge');
            if (!badgeEl) {
                badgeEl = document.createElement('span');
                badgeEl.id = 'plonter-analysis-sync-badge';
                badgeEl.style.cssText = 'margin-right:4px;vertical-align:middle';
                headerRow.appendChild(badgeEl);
            }
            badgeEl.innerHTML = AnalysesSync.getBadge(this.state.currentStageId, analysisId || 'default');
        }
    }

    load(stageId, analysisId) {
        const key = this._storageKey(stageId, analysisId);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            const data = JSON.parse(raw);
            this.state.fromJSON(data);
            return true;
        } catch (e) {
            console.warn('Failed to load from localStorage:', e);
            return false;
        }
    }

    hasSavedData(stageId, analysisId) {
        const key = this._storageKey(stageId, analysisId);
        return localStorage.getItem(key) !== null;
    }

    listAnalyses(stageId) {
        const prefix = `plonter_v4_stage_${stageId}_analysis_`;
        const analyses = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(prefix)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    analyses.push({
                        id: data.analysisId || key.replace(prefix, ''),
                        savedAt: data.savedAt,
                        key: key
                    });
                } catch (e) { /* skip corrupted */ }
            }
        }
        return analyses.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    }

    duplicateAnalysis(stageId, sourceId, newId) {
        const sourceKey = this._storageKey(stageId, sourceId);
        const raw = localStorage.getItem(sourceKey);
        if (!raw) return false;
        const data = JSON.parse(raw);
        data.analysisId = newId;
        data.savedAt = Date.now();
        const newKey = this._storageKey(stageId, newId);
        localStorage.setItem(newKey, JSON.stringify(data));
        if (typeof AnalysesSync !== 'undefined' && AnalysesSync.onAnalysisSaved) {
            AnalysesSync.onAnalysisSaved(stageId, newId);
        }
        return true;
    }

    deleteAnalysis(stageId, analysisId) {
        const key = this._storageKey(stageId, analysisId);
        localStorage.removeItem(key);
        if (typeof AnalysesSync !== 'undefined' && AnalysesSync.onAnalysisDeleted) {
            AnalysesSync.onAnalysisDeleted(stageId, analysisId);
        }
    }

    // Patch word.text in every saved analysis for a stage (same word count assumed).
    // Used when the user edits the stage sentence but keeps the same number of
    // words — we want the saved analysis + arches + roofs to stay, but each
    // word's text must reflect the edit. Word ids are positional (word_0, word_1, ...)
    // so index-based replacement is safe.
    patchStoredWordTexts(stageId, newWordTexts) {
        const prefix = `plonter_v4_stage_${stageId}_analysis_`;
        const strip = (typeof stripArabicDiacritics === 'function') ? stripArabicDiacritics : (t => t);
        const cleanTexts = newWordTexts.map(t => strip(t));
        const patchArr = (arr) => {
            if (!Array.isArray(arr)) return;
            for (let i = 0; i < arr.length && i < cleanTexts.length; i++) {
                if (arr[i] && typeof arr[i] === 'object') arr[i].text = cleanTexts[i];
            }
        };
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(prefix)) continue;
            try {
                const data = JSON.parse(localStorage.getItem(key));
                patchArr(data.words);
                if (data._mainAnalysis && data._mainAnalysis.words) patchArr(data._mainAnalysis.words);
                if (Array.isArray(data.analyses)) {
                    data.analyses.forEach(a => { if (a && a.words) patchArr(a.words); });
                }
                data.currentSentence = cleanTexts.join(' ');
                localStorage.setItem(key, JSON.stringify(data));
            } catch (e) { /* skip corrupted */ }
        }
        if (typeof AnalysesSync !== 'undefined' && AnalysesSync.onStageWordTextsPatched) {
            AnalysesSync.onStageWordTextsPatched(stageId);
        }
    }

    clearAllAnalyses(stageId) {
        const prefix = `plonter_v4_stage_${stageId}_analysis_`;
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(prefix)) toRemove.push(key);
        }
        toRemove.forEach(key => localStorage.removeItem(key));
        return toRemove.length;
    }

    resetAnalysis(stageId, analysisId) {
        this.deleteAnalysis(stageId, analysisId);
        // Re-load the sentence fresh
        const stage = getStageById(stageId);
        if (stage) this.state.loadSentence(stage);
    }
}
