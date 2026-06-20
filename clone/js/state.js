// StateManager — centralized state with undo/redo and event bus

class StateManager {
    constructor() {
        // Core data
        this.words = [];
        this.combinations = [];
        this.arches = [];
        this.logicalConnections = [];

        // Multi-analysis (#21) — each entry: {words, combinations, arches, logicalConnections}
        this.analyses = []; // slot 0 = main (stored in this.words etc.), slots 1+ stored here
        this.activeAnalysisIndex = 0;
        this.maxAnalyses = 4;

        // UI state
        this.currentWordId = null;
        this.currentPosId = null;
        this.deleteMode = false;
        this.archCreationMode = false;
        this.firstArchClick = null;
        this.currentSentence = '';
        this.currentStageId = null;
        this.currentPosCategory = null;
        this.logicalConnectionMode = false;

        // Undo/redo — per-analysis-slot stacks live in HistoryManager (see historyManager.js).
        // `this.undoStack` / `this.redoStack` are back-compat getters/setters that read the
        // current slot's scope. Assigning `[]` clears only the current scope.

        // Event bus
        this._listeners = {};
    }

    get undoStack() {
        return HistoryManager.getScope('analysis', this.activeAnalysisIndex).undoStack;
    }
    set undoStack(v) {
        if (Array.isArray(v) && v.length === 0) {
            HistoryManager.clearScope('analysis', this.activeAnalysisIndex);
        }
    }
    get redoStack() {
        return HistoryManager.getScope('analysis', this.activeAnalysisIndex).redoStack;
    }
    set redoStack(v) {
        if (Array.isArray(v) && v.length === 0) {
            const scope = HistoryManager.getScope('analysis', this.activeAnalysisIndex);
            scope.redoStack = [];
        }
    }

    // --- Event bus ---
    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }

    off(event, fn) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }

    emit(event, data) {
        if (this._listeners[event]) {
            this._listeners[event].forEach(fn => fn(data));
        }
    }

    // --- Snapshot for undo ---
    _captureCurrentForHistory() {
        return {
            words: JSON.parse(JSON.stringify(this.words.map(w => ({
                id: w.id, text: w.text, partsOfSpeech: w.partsOfSpeech
            })))),
            combinations: JSON.parse(JSON.stringify(this.combinations)),
            arches: JSON.parse(JSON.stringify(this.arches)),
            logicalConnections: JSON.parse(JSON.stringify(this.logicalConnections))
        };
    }

    snapshot() {
        const snap = {
            words: JSON.parse(JSON.stringify(this.words.map(w => ({
                id: w.id, text: w.text,
                partsOfSpeech: w.partsOfSpeech.map(p => ({ ...p, details: { ...p.details } }))
            })))),
            combinations: JSON.parse(JSON.stringify(this.combinations)),
            arches: JSON.parse(JSON.stringify(this.arches)),
            logicalConnections: JSON.parse(JSON.stringify(this.logicalConnections))
        };
        HistoryManager.snapshot('analysis', this.activeAnalysisIndex, snap);
    }

    _restoreSnapshot(snap) {
        // Rebuild Word objects from plain data
        this.words = snap.words.map(wd => {
            const w = createWord(wd.id, wd.text);
            w.partsOfSpeech = wd.partsOfSpeech;
            return w;
        });
        this.combinations = snap.combinations;
        this.arches = snap.arches;
        this.logicalConnections = snap.logicalConnections;
    }

    undo() {
        const self = this;
        const snap = HistoryManager.undo(
            'analysis', this.activeAnalysisIndex,
            () => self._captureCurrentForHistory()
        );
        if (!snap) return false;
        this._restoreSnapshot(snap);
        this.emit('stateChanged', { action: 'undo' });
        return true;
    }

    redo() {
        const self = this;
        const snap = HistoryManager.redo(
            'analysis', this.activeAnalysisIndex,
            () => self._captureCurrentForHistory()
        );
        if (!snap) return false;
        this._restoreSnapshot(snap);
        this.emit('stateChanged', { action: 'redo' });
        return true;
    }

    // --- Data mutators (all take snapshot first) ---

    loadSentence(stage) {
        this.currentStageId = stage.id;
        // Always show undiacritized sentence by default; diacritics revealed on demand
        const displaySentence = (typeof stripArabicDiacritics === 'function')
            ? stripArabicDiacritics(stage.sentence)
            : stage.sentence;
        this.currentSentence = displaySentence;
        const sentenceWords = displaySentence.split(/\s+/).filter(w => w.trim());
        this.words = sentenceWords.map((w, i) => createWord(`word_${i}`, w));
        this.combinations = [];
        this.arches = [];
        this.logicalConnections = [];
        this.analyses = [];
        this.activeAnalysisIndex = 0;
        this._mainAnalysis = null;
        this.deleteMode = false;
        this.firstArchClick = null;
        this.archCreationMode = false;
        // New sentence = fresh translation/notes fields (Amitai 2026-06-06)
        this.literalTranslation = '';
        this.polishedTranslation = '';
        this.analysisNotes = '';
        // New sentence = fresh history for every slot
        HistoryManager.clearDomain('analysis');
        this.emit('stateChanged', { action: 'loadSentence' });
    }

    addPartOfSpeech(wordId, type) {
        this.snapshot();
        const word = this.words.find(w => w.id === wordId);
        if (!word) return null;
        const defaults = getDefaultDetails(type);
        const pos = word.addPartOfSpeech(type, defaults);
        this.emit('stateChanged', { action: 'addPartOfSpeech', wordId, posId: pos.id });
        return pos;
    }

    removePartOfSpeech(wordId, posId) {
        this.snapshot();
        const word = this.words.find(w => w.id === wordId);
        if (!word) return;
        // Remove related combinations
        this.combinations = this.combinations.filter(c =>
            !(c.wordId1 === wordId && c.posId1 === posId) &&
            !(c.wordId2 === wordId && c.posId2 === posId)
        );
        word.removePartOfSpeech(posId);
        this.emit('stateChanged', { action: 'removePartOfSpeech', wordId, posId });
    }

    updatePartOfSpeechDetails(wordId, posId, details) {
        this.snapshot();
        const word = this.words.find(w => w.id === wordId);
        if (!word) return;
        word.updatePartOfSpeechDetails(posId, details);
        // Re-validate combinations involving this POS
        this._revalidateCombinations(wordId, posId);
        this.emit('stateChanged', { action: 'updateDetails', wordId, posId });
    }

    // #1243: duplicate a single POS onto the SAME word with the same data.
    // #1245: the source's combinations are intentionally NOT copied — the
    // duplicate starts with no connections (it must not auto-connect to the
    // source's combinations). Returns the new POS (or null).
    duplicatePartOfSpeech(wordId, posId) {
        this.snapshot();
        const word = this.words.find(w => w.id === wordId);
        if (!word) return null;
        const src = word.getPartOfSpeech(posId);
        if (!src) return null;
        const copy = word.addPartOfSpeech(src.type, JSON.parse(JSON.stringify(src.details || {})));
        this.emit('stateChanged', { action: 'duplicatePartOfSpeech', wordId, posId: copy.id, sourcePosId: posId });
        return copy;
    }

    // Does this POS sit at the START (wordId1/posId1) of any combination? (#1244)
    isCombinationStart(wordId, posId) {
        return this.combinations.some(c => c.wordId1 === wordId && c.posId1 === posId);
    }

    // #1244: duplicate the WHOLE combination the given POS belongs to. Collects
    // the connected component of combinations (BFS), duplicates every POS in it
    // onto its own word, and recreates the combinations between the duplicates
    // (preserving complete/type/isDemonstrative). Returns the number of POS
    // duplicated.
    duplicateCombination(wordId, posId) {
        const key = (w, p) => `${w}::${p}`;
        // Collect the connected component of POS nodes joined by combinations.
        const nodes = new Set([key(wordId, posId)]);
        const queue = [[wordId, posId]];
        while (queue.length) {
            const [w, p] = queue.shift();
            const cur = key(w, p);
            this.combinations.forEach(c => {
                const a = key(c.wordId1, c.posId1), b = key(c.wordId2, c.posId2);
                if (cur === a && !nodes.has(b)) { nodes.add(b); queue.push([c.wordId2, c.posId2]); }
                else if (cur === b && !nodes.has(a)) { nodes.add(a); queue.push([c.wordId1, c.posId1]); }
            });
        }
        this.snapshot();
        // Duplicate each POS node -> map old key to the new {wordId, posId}.
        const map = {};
        nodes.forEach(nk => {
            const sep = nk.indexOf('::');
            const w = nk.slice(0, sep);
            const pid = nk.slice(sep + 2);
            const wd = this.words.find(x => x.id === w);
            if (!wd) return;
            const src = wd.getPartOfSpeech(pid);
            if (!src) return;
            const copy = wd.addPartOfSpeech(src.type, JSON.parse(JSON.stringify(src.details || {})));
            map[nk] = { wordId: w, posId: copy.id };
        });
        // Recreate combinations whose BOTH endpoints are inside the component.
        const compCombos = this.combinations.filter(c =>
            nodes.has(key(c.wordId1, c.posId1)) && nodes.has(key(c.wordId2, c.posId2))
        );
        compCombos.forEach(c => {
            const m1 = map[key(c.wordId1, c.posId1)];
            const m2 = map[key(c.wordId2, c.posId2)];
            if (m1 && m2) {
                this.combinations.push({
                    wordId1: m1.wordId, posId1: m1.posId,
                    wordId2: m2.wordId, posId2: m2.posId,
                    complete: c.complete, type: c.type, isDemonstrative: c.isDemonstrative || false
                });
            }
        });
        this.emit('stateChanged', { action: 'duplicateCombination', count: Object.keys(map).length });
        return Object.keys(map).length;
    }

    addCombination(wordId1, posId1, wordId2, posId2, complete, type, isDemonstrative) {
        // Check duplicate
        const exists = this.combinations.some(c =>
            (c.wordId1 === wordId1 && c.posId1 === posId1 && c.wordId2 === wordId2 && c.posId2 === posId2) ||
            (c.wordId1 === wordId2 && c.posId1 === posId2 && c.wordId2 === wordId1 && c.posId2 === posId1)
        );
        if (exists) return;
        this.snapshot();
        this.combinations.push({ wordId1, posId1, wordId2, posId2, complete, type: type || (complete ? 'valid' : 'incomplete'), isDemonstrative: isDemonstrative || false });
        this.emit('stateChanged', { action: 'addCombination' });
    }

    removeCombination(wordId1, posId1, wordId2, posId2) {
        this.snapshot();
        this.combinations = this.combinations.filter(c =>
            !(c.wordId1 === wordId1 && c.posId1 === posId1 && c.wordId2 === wordId2 && c.posId2 === posId2) &&
            !(c.wordId1 === wordId2 && c.posId1 === posId2 && c.wordId2 === wordId1 && c.posId2 === posId1)
        );
        this.emit('stateChanged', { action: 'removeCombination' });
    }

    addArch(arch) {
        this.snapshot();
        this.arches.push(arch);
        this.emit('stateChanged', { action: 'addArch', archId: arch.id });
    }

    removeArch(archId, alsoRemoveAlternatives) {
        this.snapshot();
        if (alsoRemoveAlternatives) {
            this.arches = this.arches.filter(a => a.id !== archId && a.parentArchId !== archId);
        } else {
            this.arches = this.arches.filter(a => a.id !== archId);
        }
        this.emit('stateChanged', { action: 'removeArch', archId });
    }

    // Promote alternative arch to regular: remove parent, make alternative a normal arch
    promoteAlternative(parentArchId) {
        this.snapshot();
        const alt = this.arches.find(a => a.parentArchId === parentArchId);
        if (alt) {
            alt.isAlternative = false;
            alt.parentArchId = null;
        }
        this.arches = this.arches.filter(a => a.id !== parentArchId);
        this.emit('stateChanged', { action: 'promoteAlternative', parentArchId });
    }

    updateArch(archId, props) {
        const arch = this.arches.find(a => a.id === archId);
        if (!arch) return;
        this.snapshot();
        Object.assign(arch, props);
        this.emit('stateChanged', { action: 'updateArch', archId });
    }

    setDeleteMode(val) {
        this.deleteMode = val;
        this.logicalConnectionMode = false;
        this.firstArchClick = null;
        this.archCreationMode = false;
        this.emit('modeChanged', { deleteMode: val });
    }

    setLogicalConnectionMode(val) {
        this.logicalConnectionMode = val;
        this.deleteMode = false;
        this.firstArchClick = null;
        this.emit('modeChanged', { logicalConnectionMode: val });
    }

    // Re-validate combinations after POS details change
    _revalidateCombinations(wordId, posId) {
        this.combinations.forEach(c => {
            if ((c.wordId1 === wordId && c.posId1 === posId) || (c.wordId2 === wordId && c.posId2 === posId)) {
                const w1 = this.words.find(w => w.id === c.wordId1);
                const w2 = this.words.find(w => w.id === c.wordId2);
                if (!w1 || !w2) return;
                const p1 = w1.getPartOfSpeech(c.posId1);
                const p2 = w2.getPartOfSpeech(c.posId2);
                if (!p1 || !p2) return;
                const result = validateCombination(p1, p2, c.wordId1, c.wordId2, this.words);
                c.complete = result.complete;
                c.type = result.type;
                c.isDemonstrative = result.isDemonstrative || false;
            }
        });
    }

    // --- Multi-analysis (#21) ---

    // Get total number of analyses (main + extras)
    getAnalysisCount() {
        return 1 + this.analyses.length;
    }

    // Serialize current active analysis data
    _serializeAnalysis() {
        return {
            words: JSON.parse(JSON.stringify(this.words.map(w => ({
                id: w.id, text: w.text, partsOfSpeech: w.partsOfSpeech
            })))),
            combinations: JSON.parse(JSON.stringify(this.combinations)),
            arches: JSON.parse(JSON.stringify(this.arches)),
            logicalConnections: JSON.parse(JSON.stringify(this.logicalConnections)),
            literalTranslation: this.literalTranslation || '',
            polishedTranslation: this.polishedTranslation || '',
            analysisNotes: this.analysisNotes || ''
        };
    }

    // Load analysis data into active state
    // NOTE: undo/redo stacks are NOT cleared here — HistoryManager keeps a separate stack
    // per analysis slot, so switching tabs preserves each tab's history.
    _loadAnalysis(data) {
        this.words = data.words.map(wd => {
            const w = createWord(wd.id, wd.text);
            w.partsOfSpeech = wd.partsOfSpeech || [];
            return w;
        });
        this.combinations = data.combinations || [];
        this.arches = data.arches || [];
        this.logicalConnections = data.logicalConnections || [];
        this.literalTranslation = data.literalTranslation || '';
        this.polishedTranslation = data.polishedTranslation || '';
        this.analysisNotes = data.analysisNotes || '';
        this.deleteMode = false;
        this.firstArchClick = null;
        this.archCreationMode = false;
        // Sync translation UI
        var litEl = document.getElementById('literal-translation');
        var polEl = document.getElementById('polished-translation');
        var notesEl = document.getElementById('analysis-notes');
        if (litEl) litEl.value = this.literalTranslation;
        if (polEl) polEl.value = this.polishedTranslation;
        if (notesEl) notesEl.value = this.analysisNotes;
    }

    // Switch to a different analysis slot
    switchAnalysis(index) {
        if (index === this.activeAnalysisIndex) return;
        const total = this.getAnalysisCount();
        if (index < 0 || index >= total) return;
        try {
            localStorage.setItem('plonter_lastAnalysisIndex', String(index));
            localStorage.setItem('plonter_lastPositionSavedAt', String(Date.now()));
        } catch (e) {}

        // Save current to its slot
        const currentData = this._serializeAnalysis();
        if (this.activeAnalysisIndex === 0) {
            this._mainAnalysis = currentData;
        } else {
            this.analyses[this.activeAnalysisIndex - 1] = currentData;
        }

        // Load target
        let targetData;
        if (index === 0) {
            targetData = this._mainAnalysis;
        } else {
            targetData = this.analyses[index - 1];
        }

        this.activeAnalysisIndex = index;
        this._loadAnalysis(targetData);
        this.emit('stateChanged', { action: 'switchAnalysis' });
    }

    // Add new analysis copy. keepPOS: copy POS tags, keepRoofs: copy arches
    addAnalysis(keepPOS, keepRoofs, keepTranslation) {
        if (this.getAnalysisCount() >= this.maxAnalyses) return false;

        // Create a copy from the sentence words
        const newData = {
            words: this.words.map(w => ({
                id: w.id, text: w.text,
                partsOfSpeech: keepPOS ? JSON.parse(JSON.stringify(w.partsOfSpeech)) : []
            })),
            combinations: keepPOS ? JSON.parse(JSON.stringify(this.combinations)) : [],
            arches: keepRoofs ? JSON.parse(JSON.stringify(this.arches)) : [],
            logicalConnections: [],
            literalTranslation: keepTranslation ? (this.literalTranslation || '') : '',
            polishedTranslation: keepTranslation ? (this.polishedTranslation || '') : '',
            analysisNotes: keepTranslation ? (this.analysisNotes || '') : ''
        };

        this.analyses.push(newData);
        this.emit('stateChanged', { action: 'addAnalysis' });
        return true;
    }

    // Delete an analysis slot (cannot delete index 0)
    deleteAnalysis(index) {
        if (index === 0) return false;
        const total = this.getAnalysisCount();
        if (index >= total) return false;

        // Save current state first
        const currentData = this._serializeAnalysis();
        if (this.activeAnalysisIndex === 0) {
            this._mainAnalysis = currentData;
        } else {
            this.analyses[this.activeAnalysisIndex - 1] = currentData;
        }

        // Remove the slot
        this.analyses.splice(index - 1, 1);
        // Renumber history scopes so each remaining slot keeps its own stack
        HistoryManager.renumberAfterDelete('analysis', index);

        // Adjust active index
        if (this.activeAnalysisIndex === index) {
            this.activeAnalysisIndex = 0;
            this._loadAnalysis(this._mainAnalysis);
        } else if (this.activeAnalysisIndex > index) {
            this.activeAnalysisIndex--;
        }

        this.emit('stateChanged', { action: 'deleteAnalysis' });
        return true;
    }

    // Import POS, arches, or translation from one analysis to another
    importToCurrentAnalysis(sourceIndex, importPOS, importArches, importTranslation) {
        const sourceData = this.getAnalysisData(sourceIndex);
        if (!sourceData) return;

        this.snapshot();
        if (importPOS) {
            // Copy POS tags from source to current words
            sourceData.words.forEach(srcWord => {
                const tgtWord = this.words.find(w => w.id === srcWord.id);
                if (tgtWord && srcWord.partsOfSpeech && srcWord.partsOfSpeech.length > 0) {
                    tgtWord.partsOfSpeech = JSON.parse(JSON.stringify(srcWord.partsOfSpeech));
                }
            });
            if (sourceData.combinations) {
                this.combinations = JSON.parse(JSON.stringify(sourceData.combinations));
            }
        }
        if (importArches) {
            if (sourceData.arches) {
                this.arches = JSON.parse(JSON.stringify(sourceData.arches));
            }
        }
        if (importTranslation) {
            this.literalTranslation = sourceData.literalTranslation || '';
            this.polishedTranslation = sourceData.polishedTranslation || '';
            this.analysisNotes = sourceData.analysisNotes || '';
            // Sync UI
            const litEl = document.getElementById('literal-translation');
            const polEl = document.getElementById('polished-translation');
            const notesEl = document.getElementById('analysis-notes');
            if (litEl) litEl.value = this.literalTranslation;
            if (polEl) polEl.value = this.polishedTranslation;
            if (notesEl) notesEl.value = this.analysisNotes;
        }
        this.emit('stateChanged', { action: 'importAnalysis' });
    }

    // Get serialized data for a specific analysis slot (for rendering)
    getAnalysisData(index) {
        if (index === this.activeAnalysisIndex) {
            return this._serializeAnalysis();
        }
        if (index === 0) {
            return this._mainAnalysis || this._serializeAnalysis();
        }
        return this.analyses[index - 1] || null;
    }

    // Serializable state for persistence
    toJSON() {
        // Save all analyses
        const result = {
            words: this.words.map(w => ({ id: w.id, text: w.text, partsOfSpeech: w.partsOfSpeech })),
            combinations: this.combinations,
            arches: this.arches,
            logicalConnections: this.logicalConnections,
            currentStageId: this.currentStageId,
            currentSentence: this.currentSentence,
            analyses: this.analyses,
            activeAnalysisIndex: this.activeAnalysisIndex,
            _mainAnalysis: this._mainAnalysis || null,
            literalTranslation: this.literalTranslation || '',
            polishedTranslation: this.polishedTranslation || '',
            analysisNotes: this.analysisNotes || ''
        };
        return result;
    }

    fromJSON(data) {
        const strip = (typeof stripArabicDiacritics === 'function') ? stripArabicDiacritics : (t => t);
        this.words = data.words.map(wd => {
            const w = createWord(wd.id, strip(wd.text));
            w.partsOfSpeech = wd.partsOfSpeech || [];
            return w;
        });
        this.combinations = data.combinations || [];
        this.arches = data.arches || [];
        this.logicalConnections = data.logicalConnections || [];
        this.currentStageId = data.currentStageId || null;
        this.currentSentence = data.currentSentence || '';
        this.analyses = data.analyses || [];
        this.activeAnalysisIndex = data.activeAnalysisIndex || 0;
        this._mainAnalysis = data._mainAnalysis || null;
        this.literalTranslation = data.literalTranslation || '';
        this.polishedTranslation = data.polishedTranslation || '';
        this.analysisNotes = data.analysisNotes || '';
        // Session reload = fresh history for every slot
        HistoryManager.clearDomain('analysis');
        this.emit('stateChanged', { action: 'loaded' });
    }
}
