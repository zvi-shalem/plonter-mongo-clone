// HindusMode — word reordering + phenomenon tagging for hindus sentences
// Version: 4.18.2 — #1204 (Amitai 2026-06-06): placement ghost + arrows. A placed
//                   word now leaves a faded "ghost stamp" of its text in its
//                   original word-bank spot (dashed/italic/transparent), and a
//                   subtle SVG arrow (new _renderPlacementArrows, pointer-events
//                   none, rebuilt per-render + on resize) connects each ghost to
//                   the slot it was placed into, so the student sees where every
//                   word travelled. Torn down in deactivate + analysis-pause.
// Version: 4.18.1 — #1161 (Amitai via @6m 2026-06-06): added prepareReturnHighlight()
//                   — on leaving a hindus stage back to the list, records the
//                   exited stage id (sessionStorage plonter_highlight_stage_id +
//                   plonter_return_from_hindus) so the stage list marks it
//                   (green border + 2 bounces) and smooth-scrolls to center
//                   instead of jumping to top. Inert until app.js back-to-menu
//                   consumes the marker + modals.js _applyPendingStageHighlight
//                   is upgraded to the #1161 recipe (cross-file, coordinated via
//                   @6m). hindusMode-owned piece only.
// Version: 4.18.0 — SAVE_CONTRACT Phase 3: hindusMode.flushPersist now routes
//                   through HindusAdapter.save(stageId, payload) instead of
//                   writing localStorage + calling HindusSync.onStageSaved
//                   directly. The adapter (js/adapters/hindusAdapter.js)
//                   owns the localStorage write + ContentSync.save +
//                   processQueue dispatch. flushPersist still does the
//                   tab-state capture, normalisation, and synchronous-flush
//                   guarantee on deactivate / logout / user-switch — the
//                   route just shifted by one indirection. Fallback to the
//                   legacy HindusSync.onStageSaved path is kept inline so
//                   the file works even if @3 hasn't added the adapter's
//                   <script> tag to index.html yet (Phase 3 ships as a
//                   bundle; the adapter script tag lands separately).
//                   listBackups / restoreBackup unchanged — they are the
//                   undo-history layer, orthogonal to save. (Minor bump
//                   4.17 → 4.18 for the architecture change.)
// Version: 4.17.8 — SAVE_CONTRACT Phase 1 family bump. hindusMode.js itself
//                   is unchanged this release; hindusSync.js gained the
//                   PlonterAuth.onLogin hook that feeds local hindus stages
//                   into ContentSync.checkMigration('hindus', …) so they
//                   appear in the unified mixed-type backup popup alongside
//                   lessons / texts / sentences. Phase 1 only ADDS the new
//                   route — _persistHindus / flushPersist / processQueue
//                   stay intact for Phase 3 (per SAVE_CONTRACT v1.1 §6,
//                   @Plonter100 2026-05-13). Bump tracks the family deploy
//                   so the ?v= cache-bust on index.html catches the sync
//                   change too.
// Version: 4.17.7 — UX: tag-bar "warehouse" recolors to the site's light teal
//                   palette after the first click on the expand arrow
//                   ("החץ הקופץ"). The existing `_arrowClicked` flag, reset
//                   only on stage activate, makes the recolor stick for the
//                   whole hindus session — student gets a visual "unlocked"
//                   cue once the tag bank is in use. (Amitai 2026-05-13)
// Version: 4.17.6 — fix: warehouse↔warehouse and placed↔warehouse merges left
//                   an orphan slot column (Heb+Ar rects) on top because
//                   _glueWords only spliced when both words were placed.

const HindusMode = {
    _active: false,
    _words: [],       // original Hebrew words
    _slots: [],        // placed words (null = empty)
    _selectedWord: null, // index of word being placed
    _wordTags: {},     // wordIndex -> Set of tags
    _activeTag: null,  // currently selected tag for tagging
    _scissorsMode: false, // scissors mode for cutting words
    _glueMode: false,     // glue mode for joining words
    _glueFirst: null,     // first word index for glue
    _pencilMode: false,   // pencil mode for editing words
    _deleteTagMode: false, // delete-tag mode with X on tags
    _redundantWords: {},   // wordIndex -> true if marked as redundant
    _ghostedColumns: {},   // columnIndex -> true if entire column is ghosted
    _diacriticsKeyboard: false, // diacritics keyboard active
    _dkTarget: null,       // { wordIndex, letterIndex } for diacritics keyboard cursor
    _hebrewRects: [],      // Hebrew text per slot column
    _arabicRects: [],      // Arabic text per slot column
    _tagBarExpanded: false, // tag bar expanded to full screen
    _stage: null,

    TAG_CATEGORIES: [
        { name: 'ריבוי', color: '#3b82f6', tags: ['רש"ז', 'רש"נ', 'זוגי', 'ריבוי שבור', 'רשמב"א', 'סומך', 'אלרגיה'] },
        { name: 'תחביר', color: '#ef4444', tags: ['ان ואחיותיה', 'كان ואחיותיה', '2 מושאים', 'תיאור'] },
        { name: 'פועל + גוף', color: '#8b5cf6', tags: ['פל"נ', 'זוגי', 'נסתר', 'נסתרת', 'נוכח', 'נוכחת', 'מדבר', 'מדברים', 'נסתרים', 'נסתרות', 'נוכחים', 'נוכחות'] },
        { name: 'בינוני', color: '#eab308', tags: ['יחיד', 'יחידה', 'רבים', 'רבות'] },
        { name: 'מין', color: '#f43f5e', tags: ['רשמב"א', 'זכר', 'נקבה'] },
        { name: 'יידוע', color: '#10b981', tags: ['ال', 'כינוי קניין', 'סומך', 'לא מיודע', 'שזל"ם', 'נסמך'] },
        { name: 'ניקוד', color: '#f59e0b', tags: ['מחוסר תנווין', 'תנועת עזר', 'ריבוי שבור', 'חוק הגרירה', 'וצלה', 'מנצוב', 'מג\'זום', 'שמש'] },
        { name: 'יחסה', color: '#ec4899', tags: ['ראשונה بَ', 'שנייה بُ', 'שלישית بِ'] },
        { name: 'זמן', color: '#6366f1', tags: ['עבר', 'הווה-עתיד', 'בינוני'] },
        { name: 'מיליות', color: '#14b8a6', tags: ['מ"י', 'מ.חיבור', 'כינוי זיקה', 'כינוי רמז', 'שזל"ם'] },
        { name: 'צירופים', color: '#a855f7', tags: ['ל"ס', 'לש"ת', 'לכ"ר', 'נסמך', 'סומך', 'גרעין', 'לוואי'] }
    ],

    // Diacritics keyboard layout
    DIACRITICS_MAP: {
        'w': '\u064E',  // فَتحة (פתחה)
        's': '\u0650',  // كَسرة (כסרה)
        'd': '\u064F',  // ضَمّة (צ'מה)
        'a': '\u0652',  // سُكون (סוכון)
        'A': '\u0651',  // شَدّة (שדה)
        'x': '\u064B',  // فتحتان (תנווין פתחה) - מרפוע
        'c': '\u064D',  // كسرتان (תנווין כסרה) - מג'זום
        'v': '\u064C',  // ضمتان (תנווין צ'מה) - מנצוב
    },

    activate(stage) {
        this._active = true;
        this._stage = stage;
        // Remember last position for refresh-restore (covers paths that skip
        // Modals._startStage, e.g. direct activate from _returnToHindus).
        try {
            if (stage && stage.id) {
                localStorage.setItem('plonter_lastStageId', String(stage.id));
                localStorage.setItem('plonter_lastMode', 'hindus');
                localStorage.setItem('plonter_lastPositionSavedAt', String(Date.now()));
            }
        } catch (e) {}
        // Clear any annotation modes that might interfere with word clicks
        if (typeof Annotations !== 'undefined') {
            Annotations._drawMode = false; Annotations._highlightMode = false;
            Annotations._translateMode = false; Annotations._diacriticsMode = false;
            Annotations._openEndedMode = false;
        }
        this._words = (stage.hindusWords && Array.isArray(stage.hindusWords) && stage.hindusWords.length)
            ? stage.hindusWords.slice()
            : stage.sentence.split(/\s+/);
        // Pristine initial word list — used to build fresh empty tabs and to
        // validate that stored tabs still match this stage's sentence length.
        this._stageInitialWords = this._words.slice();
        this._slots = new Array(this._words.length).fill(null);
        this._selectedWord = null;
        this._wordTags = {};
        this._activeTag = null;
        this._scissorsMode = false;
        this._glueMode = false;
        this._glueFirst = null;
        this._pencilMode = false;
        this._deleteTagMode = false;
        this._redundantWords = {};
        this._ghostedColumns = {};
        this._diacriticsKeyboard = false;
        this._dkTarget = null;
        this._hebrewRects = new Array(this._words.length).fill('');
        this._arabicRects = new Array(this._words.length).fill('');
        this._userAnswer = '';
        this._arabicText = '';
        this._arrowClicked = false;
        this._wordRevealState = {}; // per-word: { revealed: false, showDiacritics: false }
        this._answerWords = stage.answer ? stage.answer.trim().split(/\s+/) : [];
        this._keyHandler = (e) => this._handleKeyboard(e);
        document.addEventListener('keydown', this._keyHandler);
        this._dragPending = null;
        this._dragActive = false;
        this._dragGhost = null;
        this._onPointerMoveBound = (e) => this._onPointerMove(e);
        this._onPointerUpBound = (e) => this._onPointerUp(e);
        this._gluePointer = null;
        this._onGluePointerMoveBound = (e) => this._onGluePointerMove(e);
        this._onGluePointerUpBound = (e) => this._onGluePointerUp(e);
        this._chainOverlay = null;
        this._chainMoveHandler = (e) => this._updateChainLine(e.clientX, e.clientY);
        document.addEventListener('pointermove', this._chainMoveHandler);
        this._undoStack = [];
        this._redoStack = [];
        // Load tabs for this stage (migrate legacy single-save if needed),
        // then apply the active tab's state. _applyState calls render().
        this._initTabs();
        this._restoreHindus();
        // One-time scroll to bottom on first entry
        setTimeout(function() { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }, 200);
    },

    deactivate() {
        this.flushPersist();
        this._active = false;
        if (typeof DiacriticsKeyboard !== 'undefined') DiacriticsKeyboard.deactivate();
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        if (this._chainMoveHandler) {
            document.removeEventListener('pointermove', this._chainMoveHandler);
            this._chainMoveHandler = null;
        }
        if (this._onGluePointerMoveBound) {
            document.removeEventListener('pointermove', this._onGluePointerMoveBound);
            document.removeEventListener('pointerup', this._onGluePointerUpBound);
            document.removeEventListener('pointercancel', this._onGluePointerUpBound);
        }
        this._gluePointer = null;
        this._clearChainLine();
        const overlay = document.getElementById('hindus-overlay');
        if (overlay) overlay.remove();
        const bar = document.getElementById('hindus-bar');
        if (bar) bar.remove();
        const tabsBar = document.getElementById('hindus-tabs-bar');
        if (tabsBar) tabsBar.remove();
        const resetBtn = document.getElementById('hindus-reset-btn');
        if (resetBtn) resetBtn.remove();
        var hindusLegend = document.getElementById('hindus-legend');
        if (hindusLegend) hindusLegend.remove();
        var wrongBanner = document.getElementById('hindus-wrong-banner');
        if (wrongBanner) wrongBanner.remove();
        var deleteBtn = document.getElementById('delete-mode-btn');
        if (deleteBtn) deleteBtn.style.display = '';
        var annotToolbar = document.getElementById('annotations-toolbar');
        if (annotToolbar) annotToolbar.style.display = '';
        const sidebar = document.getElementById('hindus-sidebar');
        if (sidebar) sidebar.remove();
        // #1204: tear down placement-arrow overlay + its resize listener.
        var arrows = document.getElementById('hindus-placement-arrows');
        if (arrows) arrows.remove();
        if (this._arrowRaf) { cancelAnimationFrame(this._arrowRaf); this._arrowRaf = null; }
        if (this._arrowResizeRaf) { cancelAnimationFrame(this._arrowResizeRaf); this._arrowResizeRaf = null; }
        if (this._arrowResizeBound) {
            window.removeEventListener('resize', this._arrowResizeBound);
            this._arrowResizeBound = null;
        }
    },

    isActive() {
        return this._active;
    },

    // #1161 (Amitai via @6m 2026-06-06): when the user leaves the current hindus
    // stage back to the stage list, record which stage they exited so the list
    // can mark it (green border + 2 bounces) and smooth-scroll it to center
    // instead of jumping to the top. Reuses the existing shared highlight infra
    // (Modals._applyPendingStageHighlight reads plonter_highlight_stage_id).
    // Inert on its own — app.js's back-to-menu handler consumes the marker and
    // calls the applier; deactivate() is intentionally NOT used because it also
    // fires on stage-switch (modals.js _startStage), which would mis-highlight.
    prepareReturnHighlight() {
        try {
            if (this._active && this._stage && this._stage.id) {
                sessionStorage.setItem('plonter_highlight_stage_id', String(this._stage.id));
                sessionStorage.setItem('plonter_return_from_hindus', '1');
                return true;
            }
        } catch (e) {}
        return false;
    },

    hasChanges() {
        if (!this._active) return false;
        return this._slots.some(function(s) { return s !== null; }) ||
               Object.keys(this._wordTags).length > 0;
    },

    // Undo/redo stack for hindus mutations (scissors split, glue, word moves,
    // insertion, tag toggle, ghosting, pencil edit, rect text). Snapshot is
    // pushed *before* every mutation; undo pops it back, redo moves it forward.
    _captureState() {
        var tags = {};
        for (var k in this._wordTags) {
            tags[k] = Array.from(this._wordTags[k]);
        }
        return {
            words: this._words.slice(),
            slots: this._slots.slice(),
            hebrewRects: this._hebrewRects.slice(),
            arabicRects: this._arabicRects.slice(),
            wordTags: tags,
            ghostedColumns: Object.assign({}, this._ghostedColumns),
            redundantWords: Object.assign({}, this._redundantWords)
        };
    },

    _isEmptyState(s) {
        if (!s) return true;
        var slots = Array.isArray(s.slots) ? s.slots : [];
        var hebrewRects = Array.isArray(s.hebrewRects) ? s.hebrewRects : [];
        var arabicRects = Array.isArray(s.arabicRects) ? s.arabicRects : [];
        var hasSlots = slots.some(function(x) { return x !== null && x !== undefined; });
        var hasHebrewRects = hebrewRects.some(function(x) { return String(x || '').trim(); });
        var hasArabicRects = arabicRects.some(function(x) { return String(x || '').trim(); });
        var hasTags = s.wordTags && Object.keys(s.wordTags).some(function(k) {
            return Array.isArray(s.wordTags[k]) ? s.wordTags[k].length > 0 : !!s.wordTags[k];
        });
        var hasGhosts = s.ghostedColumns && Object.keys(s.ghostedColumns).length > 0;
        var hasRedundant = s.redundantWords && Object.keys(s.redundantWords).length > 0;
        return !hasSlots && !hasHebrewRects && !hasArabicRects && !hasTags && !hasGhosts && !hasRedundant;
    },

    _stateFingerprint(s) {
        if (!s) return '';
        return JSON.stringify({
            words: Array.isArray(s.words) ? s.words : [],
            slots: Array.isArray(s.slots) ? s.slots : [],
            hebrewRects: Array.isArray(s.hebrewRects) ? s.hebrewRects : [],
            arabicRects: Array.isArray(s.arabicRects) ? s.arabicRects : [],
            wordTags: s.wordTags || {},
            ghostedColumns: s.ghostedColumns || {},
            redundantWords: s.redundantWords || {}
        });
    },

    _normalizeTabsForStorage() {
        if (!Array.isArray(this._tabs) || !this._tabs.length) return;
        var activeId = this._activeTabId;
        var kept = [];
        var seenMeaningful = {};
        var keptOneEmpty = false;
        for (var i = 0; i < this._tabs.length; i++) {
            var tab = this._tabs[i];
            if (!tab || !tab.id || !tab.state) continue;
            var isActive = tab.id === activeId;
            var isEmpty = this._isEmptyState(tab.state);
            if (isEmpty) {
                // Keep the active empty draft and at most one inactive empty
                // draft. Extra empty tabs are localStorage junk, not user work.
                if (!isActive && keptOneEmpty) continue;
                keptOneEmpty = true;
                kept.push(tab);
                continue;
            }
            var fp = this._stateFingerprint(tab.state);
            if (!isActive && seenMeaningful[fp]) continue;
            seenMeaningful[fp] = true;
            kept.push(tab);
        }
        if (!kept.length) {
            var id = activeId || this._makeTabId();
            kept = [{ id: id, name: 'ניסיון 1', savedAt: Date.now(), state: this._newEmptyState() }];
            activeId = id;
        }
        if (!kept.some(function(t) { return t.id === activeId; })) activeId = kept[0].id;
        this._tabs = kept;
        this._activeTabId = activeId;
        this._renumberAutoTabs();
    },

    _applyState(s) {
        this._words = s.words.slice();
        this._slots = s.slots.slice();
        this._hebrewRects = s.hebrewRects.slice();
        this._arabicRects = s.arabicRects.slice();
        var tags = {};
        for (var k in s.wordTags) {
            tags[k] = new Set(s.wordTags[k]);
        }
        this._wordTags = tags;
        this._ghostedColumns = Object.assign({}, s.ghostedColumns);
        this._redundantWords = Object.assign({}, s.redundantWords);
        this.render();
    },

    _snapshot() {
        if (!this._undoStack) this._undoStack = [];
        if (!this._redoStack) this._redoStack = [];
        this._undoStack.push(this._captureState());
        if (this._undoStack.length > 60) this._undoStack.shift();
        this._redoStack.length = 0;
        this._persistHindus();
    },

    // Tabs / alternative attempts — v2 storage. Each tab holds one full hindus
    // state (same shape as _captureState). v1 legacy is auto-migrated into
    // tab[0] on first load. Mutations save to the active tab on every snapshot.
    _tabsStorageKey() {
        return 'plonter_v4_stage_' + this._stage.id + '_hindus_v2';
    },

    _legacyStorageKey() {
        return 'plonter_v4_stage_' + this._stage.id + '_hindus';
    },

    _persistHindus() {
        if (!this._stage || !this._stage.id) return;
        this.flushPersist();
    },

    // Synchronously commits any pending state to disk. Called on every
    // _snapshot, every mutation, deactivate, logout, user-switch — anywhere
    // a save can't be deferred without risking A→B→A loss. The actual
    // localStorage write + ContentSync.save + processQueue dispatch lives
    // in HindusAdapter.save (Phase 3, SAVE_CONTRACT §6); this method
    // captures + normalises tab state and hands a v2 payload to the
    // adapter. Falls back to the legacy HindusSync.onStageSaved path if
    // the adapter hasn't loaded yet so the file is safe to deploy ahead of
    // the adapter's <script> tag landing in index.html.
    flushPersist() {
        if (!this._active || !this._stage || !this._stage.id) return false;
        try {
            if (!Array.isArray(this._tabs) || !this._tabs.length) return false;
            var active = this._tabs.find(t => t.id === this._activeTabId);
            if (!active) return false;
            active.state = this._captureState();
            active.savedAt = Date.now();
            this._normalizeTabsForStorage();
            var stageId = String(this._stage.id);
            var payload = {
                version: 2,
                activeTabId: this._activeTabId,
                tabs: this._tabs
            };
            // Phase 3 route: hand off to the adapter. The adapter does the
            // localStorage write AND the immediate ContentSync.save +
            // processQueue, preserving the loss-prevention contract from
            // Amitai insight 2026-05-08T23:02.
            if (typeof window !== 'undefined' &&
                window.HindusAdapter &&
                typeof window.HindusAdapter.save === 'function') {
                window.HindusAdapter.save(stageId, payload);
                this._updateHindusSyncBadge();
                return true;
            }
            // Legacy fallback: in case the adapter <script> tag hasn't
            // landed in index.html yet, keep the pre-Phase-3 write path
            // alive so saves are never silently dropped. Remove once
            // @6m confirms the adapter ships in every entry HTML.
            localStorage.setItem(this._tabsStorageKey(), JSON.stringify(payload));
            if (typeof HindusSync !== 'undefined' && HindusSync.onStageSaved) {
                HindusSync.onStageSaved(this._stage.id);
            }
            this._updateHindusSyncBadge();
            return true;
        } catch (err) {
            console.warn('hindus persist failed:', err);
            return false;
        }
    },

    _updateHindusSyncBadge() {
        if (!this._stage || !this._stage.id) return;
        if (typeof HindusSync === 'undefined' || typeof HindusSync.getBadge !== 'function') return;
        var stageId = String(this._stage.id);
        var badgeHtml = HindusSync.getBadge(stageId);
        var el = document.getElementById('hindus-sync-badge');
        if (!el) {
            el = document.createElement('span');
            el.id = 'hindus-sync-badge';
            el.style.cssText = 'margin-right:8px;vertical-align:middle;line-height:1';
            var tabsBar = document.getElementById('hindus-tabs-bar');
            if (tabsBar && tabsBar.parentElement) {
                tabsBar.parentElement.insertBefore(el, tabsBar.nextSibling);
            } else {
                var hb = document.querySelector('.header-buttons');
                if (hb) hb.appendChild(el);
            }
        }
        el.innerHTML = badgeHtml;
    },

    _newEmptyState() {
        return {
            words: this._stageInitialWords.slice(),
            slots: new Array(this._stageInitialWords.length).fill(null),
            hebrewRects: new Array(this._stageInitialWords.length).fill(''),
            arabicRects: new Array(this._stageInitialWords.length).fill(''),
            wordTags: {},
            ghostedColumns: {},
            redundantWords: {}
        };
    },

    _makeTabId() {
        return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    },

    _loadTabs() {
        if (!this._stage || !this._stage.id) return null;
        try {
            var raw = localStorage.getItem(this._tabsStorageKey());
            if (!raw) return null;
            var p = JSON.parse(raw);
            if (p.version !== 2 || !Array.isArray(p.tabs) || !p.tabs.length) return null;
            // Reject tabs whose words-length no longer matches the stage (sentence edited).
            for (var i = 0; i < p.tabs.length; i++) {
                var st = p.tabs[i].state;
                if (!st || !Array.isArray(st.words) || st.words.length !== this._stageInitialWords.length) return null;
            }
            return p;
        } catch (err) {
            console.warn('hindus tabs load failed:', err);
            return null;
        }
    },

    _migrateLegacy() {
        if (!this._stage || !this._stage.id) return null;
        try {
            var raw = localStorage.getItem(this._legacyStorageKey());
            if (!raw) return null;
            var s = JSON.parse(raw);
            if (s.version !== 1 || !Array.isArray(s.words)) return null;
            if (s.words.length !== this._stageInitialWords.length) return null;
            // Keep the v1 key for now (no deletion — harmless).
            return {
                id: this._makeTabId(),
                name: 'ניסיון 1',
                savedAt: s.savedAt || Date.now(),
                state: {
                    words: s.words,
                    slots: s.slots,
                    hebrewRects: s.hebrewRects,
                    arabicRects: s.arabicRects,
                    wordTags: s.wordTags || {},
                    ghostedColumns: s.ghostedColumns || {},
                    redundantWords: s.redundantWords || {}
                }
            };
        } catch (err) { return null; }
    },

    _initTabs() {
        var loaded = this._loadTabs();
        if (loaded) {
            this._tabs = loaded.tabs;
            this._activeTabId = loaded.activeTabId && this._tabs.some(function(t) { return t.id === loaded.activeTabId; })
                ? loaded.activeTabId : this._tabs[0].id;
            return;
        }
        var migrated = this._migrateLegacy();
        if (migrated) {
            this._tabs = [migrated];
            this._activeTabId = migrated.id;
            return;
        }
        var firstId = this._makeTabId();
        this._tabs = [{
            id: firstId,
            name: 'ניסיון 1',
            savedAt: Date.now(),
            state: this._newEmptyState()
        }];
        this._activeTabId = firstId;
    },

    _applyActiveTabState() {
        var active = this._tabs.find(t => t.id === this._activeTabId);
        if (!active) return;
        this._applyState(active.state);
        this._undoStack = [];
        this._redoStack = [];
    },

    _switchTab(tabId) {
        if (tabId === this._activeTabId) return;
        // Persist current state into current tab before switching.
        var current = this._tabs.find(t => t.id === this._activeTabId);
        if (current) {
            current.state = this._captureState();
            current.savedAt = Date.now();
        }
        var target = this._tabs.find(t => t.id === tabId);
        if (!target) return;
        this._activeTabId = tabId;
        this._applyActiveTabState();
        this._persistHindus();
    },

    _addTab() {
        var id = this._makeTabId();
        // Use the next empty slot in the auto-sequence ("ניסיון N"): pick
        // one-past the count of existing auto-named tabs, so deletions that
        // renumber leave room for the new tab to slot in cleanly.
        var pattern = /^ניסיון\s+\d+$/;
        var autoCount = this._tabs.filter(function(t) { return pattern.test((t.name || '').trim()); }).length;
        var name = 'ניסיון ' + (autoCount + 1);
        var current = this._tabs.find(t => t.id === this._activeTabId);
        if (current) {
            current.state = this._captureState();
            current.savedAt = Date.now();
        }
        this._tabs.push({
            id: id,
            name: name,
            savedAt: Date.now(),
            state: this._newEmptyState()
        });
        this._activeTabId = id;
        this._applyActiveTabState();
        this._persistHindus();
    },

    // After a tab is deleted, walk the tabs and renumber any that still use
    // the auto-name pattern "ניסיון N" so they read 1..K sequentially.
    // Tabs with custom names (renamed via double-click) are left alone.
    _renumberAutoTabs() {
        if (!Array.isArray(this._tabs)) return;
        var pattern = /^ניסיון\s+\d+$/;
        var seq = 1;
        for (var i = 0; i < this._tabs.length; i++) {
            var t = this._tabs[i];
            if (pattern.test((t.name || '').trim())) {
                t.name = 'ניסיון ' + seq;
                seq++;
            }
        }
    },

    _renameTab(tabId, newName) {
        var t = this._tabs.find(x => x.id === tabId);
        if (!t) return;
        t.name = (newName || '').trim() || t.name;
        this._persistHindus();
        this.render();
    },

    _deleteTab(tabId) {
        if (this._tabs.length <= 1) return; // keep at least one
        var idx = this._tabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;
        var wasActive = this._activeTabId === tabId;
        this._tabs.splice(idx, 1);
        this._renumberAutoTabs();
        if (wasActive) {
            this._activeTabId = this._tabs[Math.min(idx, this._tabs.length - 1)].id;
            this._applyActiveTabState();
        }
        this._persistHindus();
        this.render();
    },

    _showTabUndoToast(savedTab, savedIdx, tabName) {
        var existing = document.getElementById('hindus-tab-undo-toast');
        if (existing) { clearTimeout(existing._timer); existing.remove(); }
        var toast = document.createElement('div');
        toast.id = 'hindus-tab-undo-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:10px 18px;border-radius:10px;font-size:0.9em;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);direction:rtl';
        var msg = document.createElement('span');
        msg.textContent = '"' + tabName + '" נמחק';
        var undoBtn = document.createElement('button');
        undoBtn.textContent = 'בוטל — שחזר';
        undoBtn.style.cssText = 'padding:4px 12px;border-radius:6px;border:none;background:#0d9488;color:white;cursor:pointer;font-weight:bold;font-size:0.9em';
        var cancelled = false;
        var self = this;
        undoBtn.onclick = function() {
            if (cancelled) return;
            cancelled = true;
            clearTimeout(toast._timer);
            toast.remove();
            if (savedIdx >= 0 && savedIdx <= self._tabs.length) {
                self._tabs.splice(savedIdx, 0, savedTab);
            } else {
                self._tabs.push(savedTab);
            }
            self._renumberAutoTabs();
            self._activeTabId = savedTab.id;
            self._applyActiveTabState();
            self._persistHindus();
            self.render();
        };
        toast.appendChild(msg);
        toast.appendChild(undoBtn);
        document.body.appendChild(toast);
        toast._timer = setTimeout(function() { if (!cancelled) toast.remove(); }, 5000);
    },

    // --- edit-sentence helpers (called from Modals.showEditSentenceDialog) ---
    patchWordTexts: function(stageId, newWordsArr) {
        // Same word count, text change: replace words[i] across ALL tabs.
        try {
            var key = 'plonter_v4_stage_' + stageId + '_hindus_v2';
            var raw = localStorage.getItem(key);
            if (!raw) return;
            var p = JSON.parse(raw);
            if (!p || !Array.isArray(p.tabs) || !p.tabs.length) return;
            if (!Array.isArray(newWordsArr)) return;
            var changed = false;
            for (var t = 0; t < p.tabs.length; t++) {
                var st = p.tabs[t].state;
                if (!st || !Array.isArray(st.words)) continue;
                if (st.words.length !== newWordsArr.length) continue;
                for (var i = 0; i < newWordsArr.length; i++) {
                    var nw = newWordsArr[i];
                    var text = (typeof nw === 'string') ? nw : (nw && nw.text) || '';
                    st.words[i] = text;
                }
                p.tabs[t].savedAt = Date.now();
                changed = true;
            }
            if (changed) localStorage.setItem(key, JSON.stringify(p));
            if (this._active && this._stage && String(this._stage.id) === String(stageId)) {
                for (var j = 0; j < newWordsArr.length && j < this._words.length; j++) {
                    var nw2 = newWordsArr[j];
                    var t2 = (typeof nw2 === 'string') ? nw2 : (nw2 && nw2.text) || '';
                    this._words[j] = t2;
                }
                this._stageInitialWords = this._words.slice();
                this.render();
            }
        } catch (e) { console.warn('hindus patchWordTexts failed:', e); }
    },

    backupBeforeClear: function(stageId) {
        try {
            var key = 'plonter_v4_stage_' + stageId + '_hindus_v2';
            var raw = localStorage.getItem(key);
            if (!raw) return null;
            var backupKey = 'plonter_v4_stage_' + stageId + '_hindus_v2_backup_' + Date.now();
            var backups = this.listBackups(stageId);
            if (backups.length && localStorage.getItem(backups[0].key) === raw) return backups[0].key;
            localStorage.setItem(backupKey, raw);
            this._pruneBackups(stageId);
            return backupKey;
        } catch (e) { return null; }
    },

    clearHindus: function(stageId) {
        try {
            localStorage.removeItem('plonter_v4_stage_' + stageId + '_hindus_v2');
            localStorage.removeItem('plonter_v4_stage_' + stageId + '_hindus'); // legacy v1
            // Sync the v2 delete — NOT the legacy v1 (@4t 2026-04-19).
            if (typeof HindusSync !== 'undefined' && HindusSync.onStageDeleted) {
                HindusSync.onStageDeleted(stageId);
            }
        } catch (e) {}
        if (this._active && this._stage && String(this._stage.id) === String(stageId)) {
            this._tabs = null;
            this._activeTabId = null;
        }
    },

    listBackups: function(stageId) {
        var prefix = 'plonter_v4_stage_' + stageId + '_hindus_v2_backup_';
        var out = [];
        var ttl = 30 * 24 * 60 * 60 * 1000;
        var now = Date.now();
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(prefix) !== 0) continue;
                var tsStr = k.slice(prefix.length);
                var ts = parseInt(tsStr, 10);
                if (isNaN(ts)) continue;
                if (now - ts > ttl) { localStorage.removeItem(k); i--; continue; }
                out.push({ key: k, savedAt: ts });
            }
        } catch (e) {}
        return out.sort(function(a, b) { return b.savedAt - a.savedAt; });
    },

    _pruneBackups: function(stageId) {
        var backups = this.listBackups(stageId);
        var maxBackups = 8;
        for (var i = maxBackups; i < backups.length; i++) {
            try { localStorage.removeItem(backups[i].key); } catch (_) {}
        }
    },

    restoreBackup: function(stageId, backupKey) {
        try {
            var raw = localStorage.getItem(backupKey);
            if (!raw) return false;
            localStorage.setItem('plonter_v4_stage_' + stageId + '_hindus_v2', raw);
            if (typeof HindusSync !== 'undefined' && HindusSync.onStageRestored) {
                HindusSync.onStageRestored(stageId);
            }
            if (this._active && this._stage && String(this._stage.id) === String(stageId)) {
                this._initTabs();
                this._restoreHindus();
            }
            return true;
        } catch (e) { return false; }
    },

    // Reset button parked in the main .header-buttons row (next to ↩ ↪).
    // One click → confirm → wipe the current tab back to "fresh": no tags,
    // no rect text, words in bank. Snapshotted first so Ctrl+Z still works.
    _ensureResetButton() {
        var host = document.querySelector('.header-buttons');
        var existing = document.getElementById('hindus-reset-btn');
        if (!host) return;
        if (!this._active) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        var self = this;
        var btn = document.createElement('button');
        btn.id = 'hindus-reset-btn';
        btn.className = 'btn btn-secondary';
        btn.title = 'איפוס הינדוס — מחזיר את המילים לבנק ומנקה תיוגים+מלבנים';
        btn.textContent = '🔄 איפוס';
        btn.style.cssText = 'font-size:1em;padding:6px 10px;background:#fecaca;color:#991b1b;font-weight:bold';
        btn.onclick = function() {
            if (!window.confirm('לאפס את הניסיון הנוכחי? כל התיוגים, המלבנים, והמילים המשובצות יימחקו, והמילים יחזרו לבנק. (ניתן לשחזר עם Ctrl+Z.)')) return;
            self._snapshot();
            self._applyState(self._newEmptyState());
            self._persistHindus();
        };
        // RTL host: first child sits rightmost, which is where Amitai asked
        // the reset button to live (right of ↩ ↪).
        if (host.firstChild) host.insertBefore(btn, host.firstChild);
        else host.appendChild(btn);
    },

    _renderTabsBar(container) {
        if (!this._tabs || !this._tabs.length) return;
        var self = this;
        // Remove any stale tabs bar elsewhere (e.g. from a previous render
        // that placed it in the sentence container).
        var stale = document.getElementById('hindus-tabs-bar');
        if (stale) stale.remove();
        var bar = document.createElement('div');
        bar.id = 'hindus-tabs-bar';
        bar.style.cssText = 'display:flex;gap:4px;padding:6px 8px;direction:rtl;flex-wrap:wrap;align-items:center;background:#f1f5f9;border-radius:8px;border:1px solid #e2e8f0;margin-right:8px';
        this._tabs.forEach(function(tab) {
            var active = tab.id === self._activeTabId;
            var pill = document.createElement('div');
            pill.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;cursor:pointer;font-size:0.9em;font-weight:bold;transition:all 0.15s;' +
                (active
                    ? 'background:#0d9488;color:white;box-shadow:0 2px 8px rgba(13,148,136,0.35)'
                    : 'background:white;color:#0f172a;border:1px solid #cbd5e1');
            var label = document.createElement('span');
            label.textContent = tab.name || 'ללא שם';
            label.onclick = function(e) { e.stopPropagation(); self._switchTab(tab.id); };
            label.ondblclick = function(e) {
                e.stopPropagation();
                var newName = window.prompt('שם הטאב:', tab.name || '');
                if (newName !== null) self._renameTab(tab.id, newName);
            };
            pill.appendChild(label);
            if (self._tabs.length > 1) {
                var closeBtn = document.createElement('span');
                closeBtn.textContent = '×';
                closeBtn.title = 'מחק טאב';
                closeBtn.style.cssText = 'margin-right:4px;padding:0 4px;border-radius:999px;cursor:pointer;font-size:1.1em;line-height:1;' +
                    (active ? 'color:rgba(255,255,255,0.8)' : 'color:#64748b');
                closeBtn.onclick = function(e) {
                    e.stopPropagation();
                    var tabName = tab.name || 'הטאב';
                    if (!window.confirm('מחיקת "' + tabName + '" תמחק את הניתוח החלופי כולו.\nלמחוק? (ניתן לשחזר תוך 5 שניות)')) return;
                    var savedTab = JSON.parse(JSON.stringify(tab));
                    var savedIdx = self._tabs.findIndex(function(t) { return t.id === tab.id; });
                    self._deleteTab(tab.id);
                    self._showTabUndoToast(savedTab, savedIdx, tabName);
                };
                pill.appendChild(closeBtn);
            }
            bar.appendChild(pill);
        });
        var addBtn = document.createElement('button');
        addBtn.textContent = '+ ניסיון חדש';
        addBtn.style.cssText = 'padding:4px 12px;border-radius:999px;border:1px dashed #0d9488;background:transparent;color:#0d9488;font-weight:bold;cursor:pointer;font-size:0.9em;margin-right:4px';
        addBtn.onclick = function() { self._addTab(); };
        bar.appendChild(addBtn);
        // Prefer to sit in the header next to ↩ ↪ 🗑️ חזרה לתפריט so it
        // blends with the main controls (Amitai 2026-04-19). Fall back to
        // inline-in-container if the header isn't mounted for some reason.
        var headerButtons = document.querySelector('.header-buttons');
        if (headerButtons && headerButtons.parentElement) {
            headerButtons.parentElement.insertBefore(bar, headerButtons);
        } else {
            container.appendChild(bar);
        }
    },

    // Kept for backward compat with any callers — now just applies the active
    // tab's state. Returns true when a tab with progress was loaded (so
    // activate() can skip its own initial render).
    _restoreHindus() {
        if (!this._tabs || !this._tabs.length) return false;
        var active = this._tabs.find(t => t.id === this._activeTabId);
        if (!active) return false;
        this._applyState(active.state);
        return true;
    },

    _undo() {
        if (!this._undoStack || !this._undoStack.length) {
            if (typeof MessageManager !== 'undefined') MessageManager.show('אין עוד מה לבטל', 'info', 1200);
            return false;
        }
        if (!this._redoStack) this._redoStack = [];
        this._redoStack.push(this._captureState());
        this._applyState(this._undoStack.pop());
        if (typeof MessageManager !== 'undefined') MessageManager.show('בוטל', 'info', 1200);
        if (typeof SoundManager !== 'undefined' && SoundManager.playUndo) SoundManager.playUndo();
        return true;
    },

    _redo() {
        if (!this._redoStack || !this._redoStack.length) {
            if (typeof MessageManager !== 'undefined') MessageManager.show('אין עוד מה לשחזר', 'info', 1200);
            return false;
        }
        if (!this._undoStack) this._undoStack = [];
        this._undoStack.push(this._captureState());
        this._applyState(this._redoStack.pop());
        if (typeof MessageManager !== 'undefined') MessageManager.show('שוחזר', 'info', 1200);
        return true;
    },

    _clearModes() {
        this._scissorsMode = false;
        this._glueMode = false;
        this._glueFirst = null;
        this._gluePointer = null;
        if (this._onGluePointerMoveBound) {
            document.removeEventListener('pointermove', this._onGluePointerMoveBound);
            document.removeEventListener('pointerup', this._onGluePointerUpBound);
            document.removeEventListener('pointercancel', this._onGluePointerUpBound);
        }
        this._clearChainLine();
        this._pencilMode = false;
        this._deleteTagMode = false;
        this._redundantClickMode = false;
        this._activeTag = null;
        this._diacriticsKeyboard = false;
        this._dkTarget = null;
        if (typeof DiacriticsKeyboard !== 'undefined') DiacriticsKeyboard.deactivate();
        if (typeof Annotations !== 'undefined') {
            Annotations._drawMode = false; Annotations._highlightMode = false;
            Annotations._translateMode = false; Annotations._diacriticsMode = false;
            Annotations._openEndedMode = false;
        }
    },

    _handleKeyboard(e) {
        if (!this._active) return;
        // Ctrl/Cmd+Z — undo. Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z — redo. Works
        // everywhere (also inside inputs) so a typo followed by Ctrl+Z
        // restores the pre-edit state rather than just the last keystroke.
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            var isZ = e.key === 'z' || e.key === 'Z' || e.keyCode === 90;
            var isY = e.key === 'y' || e.key === 'Y' || e.keyCode === 89;
            if (isZ && !e.shiftKey) {
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                e.preventDefault();
                e.stopPropagation();
                this._undo();
                return;
            }
            if (isY || (isZ && e.shiftKey)) {
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                e.preventDefault();
                e.stopPropagation();
                this._redo();
                return;
            }
        }
        // DiacriticsKeyboard handles its own events via capture phase
        // Don't capture if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
    },

    // Long-press arrow at edge → jump to next/prev rect
    _addEdgeNavigation(input, allInputsSelector, columnsContainer, isArabic) {
        var self = this;
        var _longPressTimer = null;
        var _jumped = false; // Block further movement until keyup
        var LONG_PRESS_MS = 400;

        function _isLeftEdge(el) {
            return el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
        }
        function _isRightEdge(el) {
            return el.selectionStart === 0 && el.selectionEnd === 0;
        }
        function _isArrowKey(e) {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return e.key;
            return null;
        }
        function _jumpToNext(fromInput, direction) {
            var allInputs = columnsContainer.querySelectorAll(allInputsSelector);
            var idx = Array.prototype.indexOf.call(allInputs, fromInput);
            var nextIdx;
            if (direction === 'ArrowLeft' || direction === 'left') {
                nextIdx = idx + 1;
            } else {
                nextIdx = idx - 1;
            }
            if (nextIdx < 0) nextIdx = allInputs.length - 1;
            else if (nextIdx >= allInputs.length) nextIdx = 0;
            if (isArabic && fromInput.value) {
                fromInput.value = self._convertHebrewToArabic(fromInput.value);
                self._arabicRects[idx] = fromInput.value;
            }
            _jumped = true;
            allInputs[nextIdx].focus();
            if (self._diacriticsKeyboard) {
                var text = allInputs[nextIdx].value;
                var DIAC_RE = /[\u064B-\u065F\u0670]/;
                if (direction === 'ArrowLeft' || direction === 'left') {
                    // Moving left: cursor after first Arabic letter
                    var pos = 1;
                    if (text.length > 0) {
                        while (pos < text.length && DIAC_RE.test(text[pos])) pos++;
                    }
                    allInputs[nextIdx].setSelectionRange(Math.min(pos, text.length), Math.min(pos, text.length));
                } else {
                    // Moving right: cursor after last Arabic letter
                    allInputs[nextIdx].setSelectionRange(text.length, text.length);
                }
            } else {
                allInputs[nextIdx].select();
            }
        }

        // Arrow keys (not intercepted by DiacriticsKeyboard)
        input.addEventListener('keydown', function(e) {
            if (_jumped) { e.preventDefault(); return; }
            var arrow = _isArrowKey(e);
            if (!arrow) { if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; } return; }
            var atEdge = (arrow === 'ArrowLeft' && _isLeftEdge(input)) ||
                         (arrow === 'ArrowRight' && _isRightEdge(input));
            if (atEdge && !_longPressTimer) {
                _longPressTimer = setTimeout(function() {
                    _jumpToNext(input, arrow);
                    _longPressTimer = null;
                }, LONG_PRESS_MS);
            }
        });
        input.addEventListener('keyup', function(e) {
            _jumped = false;
            var arrow = _isArrowKey(e);
            if (arrow && _longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
        });

        // DiacriticsKeyboard edge event (A/D at boundary)
        input.addEventListener('dk-edge', function(e) {
            if (!self._diacriticsKeyboard) return;
            var dir = e.detail && e.detail.direction;
            // dir > 0 = forward (A key), dir < 0 = backward (D key)
            // In RTL: forward = left, backward = right
            _jumpToNext(input, dir > 0 ? 'left' : 'right');
        });
    },

    render() {
        // Remove existing
        var overlay = document.getElementById('hindus-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'hindus-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:50;display:flex;flex-direction:column;padding:16px;padding-bottom:180px;direction:rtl;overflow-y:auto';

        var container = document.getElementById('sentence-container');
        if (!container) return;
        container.innerHTML = '';
        container.style.position = 'relative';

        // === Tabs bar: alternative hindus attempts for the same sentence ===
        this._renderTabsBar(container);
        this._ensureResetButton();

        // === Wrong-answer banner (top) — for comparison after solving ===
        var existingWrong = document.getElementById('hindus-wrong-banner');
        if (existingWrong) existingWrong.remove();
        if (this._stage && this._stage.wrongAnswer) {
            var wrongBanner = document.createElement('div');
            wrongBanner.id = 'hindus-wrong-banner';
            wrongBanner.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;background:#fef2f2;border:2px solid #fecaca;border-radius:8px;margin:8px 12px 0 12px;direction:rtl';
            var wrongLabel = document.createElement('span');
            wrongLabel.textContent = 'פיתרון לא נכון';
            wrongLabel.style.cssText = 'font-weight:bold;color:#991b1b;font-size:0.9em;white-space:nowrap;background:#fee2e2;padding:4px 10px;border-radius:6px';
            var wrongText = document.createElement('span');
            wrongText.textContent = this._stage.wrongAnswer;
            wrongText.style.cssText = 'font-family:Arial,serif;font-size:1.15em;color:#7f1d1d;flex:1';
            wrongBanner.appendChild(wrongLabel);
            wrongBanner.appendChild(wrongText);
            var gameScreenTop = document.getElementById('game-screen');
            var headerTop = gameScreenTop ? gameScreenTop.querySelector('header') : null;
            if (headerTop && headerTop.parentElement) {
                headerTop.parentElement.insertBefore(wrongBanner, headerTop.nextSibling);
            }
        }

        // === Legend bar — positioned at top, below header ===
        var existingLegend = document.getElementById('hindus-legend');
        if (existingLegend) existingLegend.remove();
        var legend = document.createElement('div');
        legend.id = 'hindus-legend';
        legend.style.cssText = 'display:flex;gap:12px;justify-content:center;padding:6px 12px;background:#f0fdfa;border-radius:0 0 8px 8px;font-size:0.75em;color:#0d9488;direction:rtl;flex-wrap:wrap';
        var legendItems = [
            "א' - משפט מקורי",
            "ב' - סידור מחדש",
            "ג' - שכתוב בעברית",
            "ד' - המשפט הסופי"
        ];
        legendItems.forEach(function(item) {
            var span = document.createElement('span');
            span.textContent = item;
            span.style.cssText = 'white-space:nowrap;font-weight:600';
            legend.appendChild(span);
        });
        // Insert just below the header in game-screen
        var gameScreen = document.getElementById('game-screen');
        var header = gameScreen ? gameScreen.querySelector('header') : null;
        if (header && header.parentElement) {
            header.parentElement.insertBefore(legend, header.nextSibling);
        } else {
            container.insertBefore(legend, container.firstChild);
        }

        // === Reveal Solution + Copy buttons row ===
        if (this._stage && this._stage.answer) {
            var selfCheck = this;
            var allFilled = this._arabicRects.length > 0 && this._arabicRects.every(function(r, idx) { return selfCheck._ghostedColumns[idx] || (r && r.trim()); });
            var btnRow = document.createElement('div');
            btnRow.id = 'hindus-reveal-row';
            btnRow.style.cssText = 'display:' + (allFilled ? 'flex' : 'none') + ';gap:10px;justify-content:center;align-items:center;margin:12px auto;flex-wrap:wrap';
            var revealBtn = document.createElement('button');
            revealBtn.id = 'hindus-reveal-btn';
            revealBtn.textContent = 'חשוף פיתרון';
            revealBtn.style.cssText = 'padding:10px 24px;border:none;border-radius:8px;background:#0d9488;color:white;font-weight:bold;cursor:pointer;font-size:1.1em';
            revealBtn.onclick = () => {
                var allRects = container.querySelectorAll('input[placeholder="عربي"]');
                for (var ri = 0; ri < allRects.length; ri++) {
                    allRects[ri].style.borderColor = '#f59e0b';
                    allRects[ri].style.background = '#fffbeb';
                }
                var existing = document.getElementById('hindus-solution-panel');
                var existingLevels = document.getElementById('hindus-levels-row');
                if (existing || existingLevels) {
                    if (existing) existing.remove();
                    if (existingLevels) existingLevels.remove();
                    btnRow.style.display = 'flex';
                    return;
                }
                btnRow.style.display = 'none';
                this._showSolutionPanel(container, btnRow);
            };
            btnRow.appendChild(revealBtn);
            var copyBtn = document.createElement('button');
            copyBtn.id = 'hindus-copy-btn';
            copyBtn.textContent = '📋 העתק מה שעשית';
            copyBtn.style.cssText = 'padding:10px 20px;border:2px solid #0d9488;border-radius:8px;background:white;color:#0d9488;font-weight:bold;cursor:pointer;font-size:1em';
            copyBtn.onclick = () => {
                var parts = [];
                for (var ci = 0; ci < this._arabicRects.length; ci++) {
                    if (this._ghostedColumns[ci]) continue;
                    var text = (this._arabicRects[ci] || '').trim();
                    if (text) parts.push(text);
                }
                var sentence = parts.join(' ');
                if (!sentence) return;
                var done = function() {
                    var orig = copyBtn.textContent;
                    copyBtn.textContent = '✓ הועתק!';
                    copyBtn.style.background = '#dcfce7';
                    setTimeout(function() { copyBtn.textContent = orig; copyBtn.style.background = 'white'; }, 1500);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(sentence).then(done).catch(function() {
                        var ta = document.createElement('textarea');
                        ta.value = sentence; ta.style.position = 'fixed'; ta.style.opacity = '0';
                        document.body.appendChild(ta); ta.select();
                        try { document.execCommand('copy'); done(); } catch(e) {}
                        document.body.removeChild(ta);
                    });
                } else {
                    var ta = document.createElement('textarea');
                    ta.value = sentence; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta); ta.select();
                    try { document.execCommand('copy'); done(); } catch(e) {}
                    document.body.removeChild(ta);
                }
            };
            btnRow.appendChild(copyBtn);
            container.appendChild(btnRow);
        }

        // === Column-based layout: Arabic rects + Hebrew rects + Slots ===
        // Ensure arrays match slot count
        while (this._hebrewRects.length < this._slots.length) this._hebrewRects.push('');
        while (this._arabicRects.length < this._slots.length) this._arabicRects.push('');

        var columnsContainer = document.createElement('div');
        columnsContainer.style.cssText = 'display:flex;gap:8px;justify-content:center;padding:12px 16px;align-items:stretch';

        // Row labels column (rightmost in RTL)
        var labelsCol = document.createElement('div');
        labelsCol.style.cssText = 'display:flex;flex-direction:column;gap:4px;justify-content:stretch;min-width:20px;padding-top:2px';
        var rowLabels = ["ד'", "ג'", "ב'"];  // Arabic rect, Hebrew rect, Slot (top to bottom)
        rowLabels.forEach(function(lbl) {
            var label = document.createElement('div');
            label.textContent = lbl;
            label.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;font-size:0.7em;font-weight:bold;color:#0d9488;writing-mode:horizontal-tb';
            labelsCol.appendChild(label);
        });
        columnsContainer.appendChild(labelsCol);

        this._slots.forEach((placed, i) => {
            var col = document.createElement('div');
            col.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:center;min-width:80px';

            // --- Arabic rectangle (DK button removed per Amitai request) ---
            var _hasArabicRe = /[\u0600-\u06FF]/;

            // --- Arabic rectangle (top) ---
            var arabicRect = document.createElement('input');
            arabicRect.type = 'text';
            arabicRect.value = this._arabicRects[i] || '';
            arabicRect.placeholder = 'عربي';
            var initLen = Math.max(4, Math.ceil((this._arabicRects[i] || '').length * 1.5) + 1);
            arabicRect.style.cssText = 'width:100%;padding:14px 4px;font-size:1.75em;line-height:1.7;border:2px solid #f59e0b;border-radius:6px;text-align:center;font-family:Arial,serif;direction:rtl;outline:none;background:#fffbeb;box-sizing:border-box';

            // DK button removed — keep _updateDkBtn as no-op for oninput references
            var _updateDkBtn = function() {};

            arabicRect.addEventListener('focus', () => {
                arabicRect.dataset.hindusRectBefore = this._arabicRects[i] || '';
                arabicRect.dataset.hindusSnapshotted = '';
            });
            arabicRect.addEventListener('blur', () => {
                if (arabicRect.dataset.hindusSnapshotted !== '1' &&
                    (arabicRect.dataset.hindusRectBefore || '') !== arabicRect.value) {
                    // Edit session produced a real change — push a snapshot
                    // retroactively by restoring the old value in _arabicRects,
                    // snapshotting, then re-applying the new value.
                    var newVal = arabicRect.value;
                    this._arabicRects[i] = arabicRect.dataset.hindusRectBefore || '';
                    this._snapshot();
                    this._arabicRects[i] = newVal;
                    arabicRect.dataset.hindusSnapshotted = '1';
                }
            });
            arabicRect.oninput = () => {
                this._arabicRects[i] = arabicRect.value;
                _updateDkBtn();
                var row = document.getElementById('hindus-reveal-row');
                if (row) {
                    var selfFill = this;
                    var filled = this._arabicRects.length > 0 && this._arabicRects.every(function(r, idx) { return selfFill._ghostedColumns[idx] || (r && r.trim()); });
                    row.style.display = filled ? 'flex' : 'none';
                }
                // Hide solution panel and levels row when user edits Arabic rects
                var panel = document.getElementById('hindus-solution-panel');
                if (panel) panel.remove();
                var lvls = document.getElementById('hindus-levels-row');
                if (lvls) lvls.remove();
                // Reset Arabic rect colors when editing
                var allRects = container.querySelectorAll('input[placeholder="عربي"]');
                for (var ri = 0; ri < allRects.length; ri++) {
                    allRects[ri].style.borderColor = '#f59e0b';
                    allRects[ri].style.background = '#fffbeb';
                }
            };
            arabicRect.onkeydown = (e) => {
                if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                    e.preventDefault();
                    e.stopPropagation();
                    arabicRect.value = this._convertHebrewToArabic(arabicRect.value);
                    this._arabicRects[i] = arabicRect.value;
                    _updateDkBtn();
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    // Auto-transliterate Hebrew to Arabic
                    if (arabicRect.value) {
                        arabicRect.value = this._convertHebrewToArabic(arabicRect.value);
                        this._arabicRects[i] = arabicRect.value;
                        _updateDkBtn();
                    }
                    var allArabic = columnsContainer.querySelectorAll('input[placeholder="عربي"]');
                    var nextIdx = (Array.prototype.indexOf.call(allArabic, arabicRect) + 1) % allArabic.length;
                    allArabic[nextIdx].focus();
                    if (this._diacriticsKeyboard) { allArabic[nextIdx].setSelectionRange(0, 0); } else { allArabic[nextIdx].select(); }
                }
            };
            this._addEdgeNavigation(arabicRect, 'input[placeholder="عربي"]', columnsContainer, true);
            col.appendChild(arabicRect);

            // --- Hebrew rectangle (middle) ---
            var hebrewRect = document.createElement('input');
            hebrewRect.type = 'text';
            hebrewRect.value = this._hebrewRects[i] || '';
            hebrewRect.placeholder = 'עברית';
            var initLenH = Math.max(4, Math.ceil((this._hebrewRects[i] || '').length * 1.5) + 1);
            hebrewRect.style.cssText = 'width:100%;padding:6px 4px;font-size:1.1em;border:2px solid #3b82f6;border-radius:6px;text-align:center;font-family:Arial,serif;direction:rtl;outline:none;background:#eff6ff;box-sizing:border-box';
            hebrewRect.addEventListener('focus', () => {
                hebrewRect.dataset.hindusRectBefore = this._hebrewRects[i] || '';
                hebrewRect.dataset.hindusSnapshotted = '';
            });
            hebrewRect.addEventListener('blur', () => {
                if (hebrewRect.dataset.hindusSnapshotted !== '1' &&
                    (hebrewRect.dataset.hindusRectBefore || '') !== hebrewRect.value) {
                    var newVal = hebrewRect.value;
                    this._hebrewRects[i] = hebrewRect.dataset.hindusRectBefore || '';
                    this._snapshot();
                    this._hebrewRects[i] = newVal;
                    hebrewRect.dataset.hindusSnapshotted = '1';
                }
            });
            hebrewRect.oninput = () => {
                this._hebrewRects[i] = hebrewRect.value;
            };
            hebrewRect.onclick = () => { hebrewRect.select(); };
            hebrewRect.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var allHebrew = columnsContainer.querySelectorAll('input[placeholder="עברית"]');
                    var nextIdx = (Array.prototype.indexOf.call(allHebrew, hebrewRect) + 1) % allHebrew.length;
                    allHebrew[nextIdx].focus();
                    if (this._diacriticsKeyboard) { allHebrew[nextIdx].setSelectionRange(0, 0); } else { allHebrew[nextIdx].select(); }
                }
            };
            this._addEdgeNavigation(hebrewRect, 'input[placeholder="עברית"]', columnsContainer, false);
            col.appendChild(hebrewRect);

            // --- Ghost column visual + interactions ---
            if (this._ghostedColumns[i]) {
                arabicRect.style.opacity = '0.3';
                arabicRect.style.textDecoration = 'line-through';
                arabicRect.style.border = '2px dashed #9ca3af';
                arabicRect.style.background = '#f1f5f9';
                hebrewRect.style.opacity = '0.3';
                hebrewRect.style.textDecoration = 'line-through';
                hebrewRect.style.border = '2px dashed #9ca3af';
                hebrewRect.style.background = '#f1f5f9';
            }
            if (this._redundantClickMode) {
                var colElements = [arabicRect, hebrewRect];
                var colIdx = i;
                var self2 = this;
                colElements.forEach(function(el) {
                    el.addEventListener('mouseenter', function() {
                        if (!self2._redundantClickMode) return;
                        col.style.opacity = self2._ghostedColumns[colIdx] ? '1' : '0.4';
                    });
                    el.addEventListener('mouseleave', function() {
                        col.style.opacity = '';
                    });
                    var origClick = el.onclick;
                    el.onclick = function(ev) {
                        if (self2._redundantClickMode) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            self2._snapshot();
                            if (self2._ghostedColumns[colIdx]) {
                                delete self2._ghostedColumns[colIdx];
                                if (placed !== null) delete self2._redundantWords[placed];
                            } else {
                                self2._ghostedColumns[colIdx] = true;
                                if (placed !== null) self2._redundantWords[placed] = true;
                            }
                            self2._redundantClickMode = false;
                            self2.render();
                            return;
                        }
                        if (origClick) origClick.call(el, ev);
                    };
                });
            }

            // --- Slot (bottom) ---
            var slot = document.createElement('div');
            slot.style.cssText = 'width:100%;min-height:50px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:8px;font-size:1.3em;cursor:pointer;transition:all 0.2s;background:white';

            if (placed !== null) {
                slot.textContent = this._words[placed];
                slot.style.border = '2px solid #0d9488';
                slot.style.background = '#f0fdfa';
                slot.style.fontWeight = 'bold';

                if (this._redundantWords[placed] || this._ghostedColumns[i]) {
                    slot.style.opacity = '0.3';
                    slot.style.textDecoration = 'line-through';
                    slot.style.border = '2px dashed #9ca3af';
                    slot.style.background = '#f1f5f9';
                }

                var tags = this._wordTags[placed];
                if (tags && tags.size > 0) {
                    var tagRow = document.createElement('div');
                    tagRow.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap;margin-top:4px;justify-content:center';
                    tags.forEach(t => {
                        var tb = document.createElement('span');
                        tb.style.cssText = 'font-size:0.55em;background:' + this._getTagColor(t) + ';color:white;padding:1px 4px;border-radius:4px;position:relative;cursor:pointer';
                        if (this._deleteTagMode) {
                            tb.textContent = t + ' ✕';
                            tb.style.cursor = 'pointer';
                            tb.onclick = (ev) => {
                                ev.stopPropagation();
                                this._wordTags[placed].delete(t);
                                this.render();
                            };
                        } else {
                            tb.textContent = t;
                        }
                        tagRow.appendChild(tb);
                    });
                    slot.style.flexDirection = 'column';
                    slot.appendChild(tagRow);
                }

                if (this._pencilMode) {
                    slot.style.cursor = 'text';
                    slot.style.borderColor = '#8b5cf6';
                } else if (this._scissorsMode) {
                    slot.style.cursor = 'crosshair';
                    slot.style.borderColor = '#ef4444';
                } else if (this._glueMode) {
                    slot.style.cursor = 'copy';
                    if (this._glueFirst === placed) {
                        slot.style.borderColor = '#3b82f6';
                        slot.style.background = '#3b82f6';
                        slot.style.color = 'white';
                    }
                }

                slot.onclick = () => {
                    if (this._deleteTagMode) return;
                    if (this._redundantClickMode) {
                        this._snapshot();
                        if (this._ghostedColumns[i]) {
                            delete this._ghostedColumns[i];
                            delete this._redundantWords[placed];
                        } else {
                            this._ghostedColumns[i] = true;
                            this._redundantWords[placed] = true;
                        }
                        this._redundantClickMode = false;
                        this.render();
                        return;
                    }
                    if (this._pencilMode) {
                        this._showEditPopup(placed);
                        return;
                    }
                    if (this._scissorsMode) {
                        this._showCutPopup(placed);
                        return;
                    }
                    if (this._glueMode) {
                        this._handleGluePick(placed);
                        return;
                    }
                    if (this._activeTag) {
                        this._toggleTag(placed, this._activeTag);
                        this.render();
                    }
                    // Short click on filled slot (no active tag/mode) reserved for future use
                };
                slot.dataset.hindusDrop = 'slot';
                slot.dataset.hindusIndex = i;
                slot.dataset.hindusWordRef = placed;
                if (this._isDefaultMode()) {
                    this._makeDraggable(slot, { kind: 'slot', index: i });
                } else if (this._glueMode) {
                    this._makeGlueDraggable(slot, placed);
                }
            } else {
                slot.innerHTML = '<span style="color:#cbd5e1;font-size:0.9em">' + (i + 1) + '</span>';
                if (this._ghostedColumns[i]) {
                    slot.style.opacity = '0.3';
                    slot.style.border = '2px dashed #9ca3af';
                    slot.style.background = '#f1f5f9';
                }
                slot.onclick = () => {
                    if (this._redundantClickMode) {
                        this._snapshot();
                        if (this._ghostedColumns[i]) {
                            delete this._ghostedColumns[i];
                        } else {
                            this._ghostedColumns[i] = true;
                        }
                        this._redundantClickMode = false;
                        this.render();
                        return;
                    }
                    // Short click on empty slot reserved for future use
                };
                slot.dataset.hindusDrop = 'slot';
                slot.dataset.hindusIndex = i;
            }
            col.appendChild(slot);

            // Ghost mode hover on slot
            if (this._redundantClickMode) {
                var colIdx2 = i;
                var self3 = this;
                slot.addEventListener('mouseenter', function() {
                    if (!self3._redundantClickMode) return;
                    col.style.opacity = self3._ghostedColumns[colIdx2] ? '1' : '0.4';
                });
                slot.addEventListener('mouseleave', function() {
                    col.style.opacity = '';
                });
            }

            if (placed !== null) col.dataset.hindusColWord = String(placed);
            columnsContainer.appendChild(col);

            // Insert-zone between this column and the next one — only meaningful
            // when both neighbours hold a placed word AND there is at least one
            // empty slot to absorb the push (so the total column count stays
            // fixed: the word slides into an empty position rather than
            // creating a new free-floating rect).
            if (i < this._slots.length - 1 &&
                this._slots[i] !== null && this._slots[i + 1] !== null) {
                var canRight = this._findEmptyRightOf(i) !== -1;
                var canLeft = this._findEmptyLeftOf(i + 1) !== -1;
                if (canRight || canLeft) {
                    // Insert-zone hidden in layout by default — drag-mode flips it on.
                    // Two halves: right arrow (push words rightward) / left arrow
                    // (push words leftward). Each half shows only if the
                    // corresponding side has a free column to absorb the shift.
                    var insertZone = document.createElement('div');
                    insertZone.style.cssText = 'align-self:stretch;flex-shrink:0;display:none;flex-direction:row;gap:2px';
                    insertZone.dataset.hindusInsertZone = 'true';
                    if (canRight) {
                        var rightHalf = document.createElement('div');
                        rightHalf.style.cssText = 'width:30px;align-self:stretch;display:flex;align-items:center;justify-content:center;background:transparent;border-radius:4px 0 0 4px;transition:background 0.15s,outline 0.15s;cursor:copy;font-size:1.1em;color:#0d9488;font-weight:bold';
                        rightHalf.textContent = '→';
                        rightHalf.dataset.hindusDrop = 'insert';
                        rightHalf.dataset.hindusInsertAt = i + 1;
                        rightHalf.dataset.hindusPushDir = 'right';
                        rightHalf.title = 'דחוף ימינה — המילים מימין זזות ימינה לתא ריק';
                        insertZone.appendChild(rightHalf);
                    }
                    if (canLeft) {
                        var leftHalf = document.createElement('div');
                        leftHalf.style.cssText = 'width:30px;align-self:stretch;display:flex;align-items:center;justify-content:center;background:transparent;border-radius:0 4px 4px 0;transition:background 0.15s,outline 0.15s;cursor:copy;font-size:1.1em;color:#0d9488;font-weight:bold';
                        leftHalf.textContent = '←';
                        leftHalf.dataset.hindusDrop = 'insert';
                        leftHalf.dataset.hindusInsertAt = i + 1;
                        leftHalf.dataset.hindusPushDir = 'left';
                        leftHalf.title = 'דחוף שמאלה — המילים משמאל זזות שמאלה לתא ריק';
                        insertZone.appendChild(leftHalf);
                    }
                    columnsContainer.appendChild(insertZone);
                }
            }
        });

        container.appendChild(columnsContainer);

        // === Word bank (original Hebrew words) — row א' ===
        var wordBankRow = document.createElement('div');
        wordBankRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:12px;direction:rtl;padding:0 16px';
        var wordBankLabel = document.createElement('div');
        wordBankLabel.textContent = "א'";
        wordBankLabel.style.cssText = 'font-size:0.7em;font-weight:bold;color:#0d9488;min-width:20px;text-align:center;flex-shrink:0';
        wordBankRow.appendChild(wordBankLabel);
        var wordBank = document.createElement('div');
        wordBank.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:16px;flex:1;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0';
        wordBank.dataset.hindusDrop = 'bank';

        this._words.forEach((word, i) => {
            var isPlaced = this._slots.includes(i);
            var btn = document.createElement('button');
            var revealState = this._wordRevealState[i];
            var answerWord = this._answerWords[i] || '';

            // Build button content: Hebrew word + optional revealed Arabic answer
            btn.innerHTML = '';
            var hebrewSpan = document.createElement('div');
            hebrewSpan.textContent = word;
            btn.appendChild(hebrewSpan);

            if (revealState && revealState.revealed && answerWord) {
                var arabicSpan = document.createElement('div');
                arabicSpan.style.cssText = 'font-size:0.85em;margin-top:4px;color:#ea580c;font-family:Arial,serif;border-top:1px solid #fed7aa;padding-top:3px';
                arabicSpan.textContent = revealState.showDiacritics ? answerWord : this._stripDiacritics(answerWord);
                btn.appendChild(arabicSpan);
            }

            btn.style.cssText = 'padding:8px 16px;font-size:1.2em;border-radius:8px;cursor:pointer;transition:all 0.2s;font-weight:bold;text-align:center;border:2px solid ' +
                (revealState && revealState.revealed ? '#ea580c' : (this._selectedWord === i ? '#0d9488' : '#e2e8f0')) + ';background:' +
                (isPlaced ? '#e2e8f0' : (revealState && revealState.revealed ? '#fff7ed' : (this._selectedWord === i ? '#0d9488' : 'white'))) + ';color:' +
                (isPlaced ? '#9ca3af' : (this._selectedWord === i ? 'white' : '#1e293b'));

            if (isPlaced) {
                // #1204 (Amitai 2026-06-06): leave a faded "ghost stamp" of the
                // word in its ORIGINAL bank position — the Hebrew text stays
                // visible but ghostly (dashed outline, transparent, italic), and
                // _renderPlacementArrows draws an arrow from here to the slot it
                // was placed into, so the eye follows where each word travelled.
                btn.style.opacity = '0.4';
                btn.style.cursor = 'default';
                btn.style.background = 'transparent';
                btn.style.border = '2px dashed #cbd5e1';
                btn.style.color = '#94a3b8';
                btn.style.fontStyle = 'italic';
            } else if (this._pencilMode) {
                btn.style.cursor = 'text';
                btn.style.border = '2px solid #8b5cf6';
                btn.onclick = () => this._showEditPopup(i);
            } else if (this._scissorsMode) {
                btn.style.cursor = 'crosshair';
                btn.onclick = () => this._showCutPopup(i);
                } else if (this._glueMode) {
                    if (this._glueFirst === i) {
                        btn.style.border = '2px solid #3b82f6';
                        btn.style.background = '#3b82f6';
                        btn.style.color = 'white';
                }
                btn.style.cursor = 'copy';
                btn.onclick = () => this._handleGluePick(i);
            } else if (!isPlaced) {
                // Short click reserved for future use — drag-and-drop handles placement
                this._makeDraggable(btn, { kind: 'word', index: i });
            }
            btn.dataset.hindusWordRef = i;
            if (this._glueMode && !isPlaced) this._makeGlueDraggable(btn, i);
            wordBank.appendChild(btn);
        });

        wordBankRow.appendChild(wordBank);
        container.appendChild(wordBankRow);

        // === Hide annotations toolbar and delete button in hindus mode ===
        var annotToolbar = document.getElementById('annotations-toolbar');
        if (annotToolbar) annotToolbar.style.display = 'none';
        var deleteBtn = document.getElementById('delete-mode-btn');
        if (deleteBtn) deleteBtn.style.display = 'none';

        // === Render right sidebar for tools ===
        this._renderSidebar();

        // === Render tag bar ===
        this._renderTagBar();

        // === Placement arrows (#1204) — ghost(original)→slot(placed) connectors.
        // Deferred to next frame so the columns + word bank have laid out and
        // getBoundingClientRect returns real positions.
        var self4 = this;
        if (this._arrowRaf) cancelAnimationFrame(this._arrowRaf);
        this._arrowRaf = requestAnimationFrame(function() {
            self4._arrowRaf = null;
            self4._renderPlacementArrows();
        });
    },

    // #1204 (Amitai 2026-06-06): draw a subtle arrow from each placed word's
    // ghost (its original spot in word-bank row א') to the slot it was placed
    // into, so the student sees where every word travelled. SVG overlay inside
    // sentence-container (position:relative); pointer-events:none so it never
    // blocks clicks/drags. Rebuilt on every render and on window resize (bank
    // wraps). Coordinates are container-content relative, so page/container
    // scroll never offsets them.
    _renderPlacementArrows() {
        var container = document.getElementById('sentence-container');
        var existing = document.getElementById('hindus-placement-arrows');
        if (existing) existing.remove();
        if (!container || !this._active) return;

        var placed = [];
        for (var i = 0; i < this._slots.length; i++) {
            var w = this._slots[i];
            if (w !== null && w !== undefined) placed.push(w);
        }
        if (!placed.length) return;

        var cRect = container.getBoundingClientRect();
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNS, 'svg');
        svg.id = 'hindus-placement-arrows';
        svg.setAttribute('width', String(Math.max(container.scrollWidth, container.clientWidth)));
        svg.setAttribute('height', String(Math.max(container.scrollHeight, container.clientHeight)));
        svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:6;overflow:visible';

        var defs = document.createElementNS(svgNS, 'defs');
        var marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', 'hindus-arrowhead');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '7');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('orient', 'auto-start-reverse');
        var mPath = document.createElementNS(svgNS, 'path');
        mPath.setAttribute('d', 'M0,0 L10,5 L0,10 L3,5 Z');
        mPath.setAttribute('fill', '#0d9488');
        mPath.setAttribute('fill-opacity', '0.55');
        marker.appendChild(mPath);
        defs.appendChild(marker);
        svg.appendChild(defs);

        var self = this;
        placed.forEach(function(w) {
            var bankBtn = container.querySelector('button[data-hindus-word-ref="' + w + '"]');
            var slot = container.querySelector('[data-hindus-drop="slot"][data-hindus-word-ref="' + w + '"]');
            if (!bankBtn || !slot) return;
            var bRect = bankBtn.getBoundingClientRect();
            var sRect = slot.getBoundingClientRect();
            // Start at the ghost (original, lower on screen), end at the slot
            // (placed, higher) — arrowhead points up at the slot.
            var x1 = bRect.left + bRect.width / 2 - cRect.left + container.scrollLeft;
            var y1 = bRect.top - cRect.top + container.scrollTop;
            var x2 = sRect.left + sRect.width / 2 - cRect.left + container.scrollLeft;
            var y2 = sRect.bottom - cRect.top + container.scrollTop;
            var dy = y2 - y1;
            var path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', 'M' + x1 + ',' + y1 +
                ' C' + x1 + ',' + (y1 + dy * 0.4) +
                ' ' + x2 + ',' + (y2 - dy * 0.4) +
                ' ' + x2 + ',' + y2);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#0d9488');
            path.setAttribute('stroke-opacity', '0.4');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('marker-end', 'url(#hindus-arrowhead)');
            svg.appendChild(path);
        });

        container.style.position = 'relative';
        container.appendChild(svg);

        // Redraw on resize once per hindus session (bank wraps → arrows shift).
        if (!this._arrowResizeBound) {
            this._arrowResizeBound = function() {
                if (self._arrowResizeRaf) cancelAnimationFrame(self._arrowResizeRaf);
                self._arrowResizeRaf = requestAnimationFrame(function() {
                    self._arrowResizeRaf = null;
                    if (self._active) self._renderPlacementArrows();
                });
            };
            window.addEventListener('resize', this._arrowResizeBound);
        }
    },

    // === Drag-and-drop (Pointer Events — unified desktop + touch) ===
    _isDefaultMode() {
        return !this._scissorsMode && !this._glueMode && !this._pencilMode &&
               !this._deleteTagMode && !this._redundantClickMode && !this._activeTag;
    },

    _makeDraggable(el, source) {
        var self = this;
        el.style.touchAction = 'none';
        el.style.userSelect = 'none';
        el.style.webkitUserSelect = 'none';
        el.style.webkitTouchCallout = 'none';
        el.addEventListener('pointerdown', function(e) {
            if (!self._isDefaultMode()) return;
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            self._dragPending = {
                source: source,
                startX: e.clientX,
                startY: e.clientY,
                pointerId: e.pointerId,
                el: el
            };
            document.addEventListener('pointermove', self._onPointerMoveBound);
            document.addEventListener('pointerup', self._onPointerUpBound);
            document.addEventListener('pointercancel', self._onPointerUpBound);
        });
    },

    _handleGluePick(wordIndex) {
        if (!this._glueMode) return;
        if (this._glueFirst === null || this._glueFirst === wordIndex) {
            this._glueFirst = wordIndex;
            this.render();
            return;
        }
        this._glueWords(this._glueFirst, wordIndex);
    },

    _makeGlueDraggable(el, wordIndex) {
        var self = this;
        el.style.touchAction = 'none';
        el.style.userSelect = 'none';
        el.style.webkitUserSelect = 'none';
        el.style.webkitTouchCallout = 'none';
        el.addEventListener('pointerdown', function(e) {
            if (!self._active || !self._glueMode) return;
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            var sourceWord = (self._glueFirst !== null && self._glueFirst !== wordIndex)
                ? self._glueFirst
                : wordIndex;
            self._glueFirst = sourceWord;
            self._gluePointer = {
                wordIndex: sourceWord,
                pointerId: e.pointerId,
                moved: false,
                startX: e.clientX,
                startY: e.clientY
            };
            self._updateChainLine(e.clientX, e.clientY);
            document.addEventListener('pointermove', self._onGluePointerMoveBound);
            document.addEventListener('pointerup', self._onGluePointerUpBound);
            document.addEventListener('pointercancel', self._onGluePointerUpBound);
        });
    },

    _onGluePointerMove(e) {
        if (!this._gluePointer || this._gluePointer.pointerId !== e.pointerId) return;
        var dx = e.clientX - this._gluePointer.startX;
        var dy = e.clientY - this._gluePointer.startY;
        if (Math.sqrt(dx * dx + dy * dy) >= 4) this._gluePointer.moved = true;
        this._updateChainLine(e.clientX, e.clientY);
        e.preventDefault();
    },

    _onGluePointerUp(e) {
        if (!this._gluePointer || this._gluePointer.pointerId !== e.pointerId) return;
        document.removeEventListener('pointermove', this._onGluePointerMoveBound);
        document.removeEventListener('pointerup', this._onGluePointerUpBound);
        document.removeEventListener('pointercancel', this._onGluePointerUpBound);
        var source = this._gluePointer.wordIndex;
        var target = this._getGlueWordAt(e.clientX, e.clientY);
        this._gluePointer = null;
        this._clearChainLine();
        if (target !== null && target !== source) {
            this._glueWords(source, target);
            return;
        }
        this._glueFirst = source;
        this.render();
    },

    _getGlueWordAt(x, y) {
        var el = document.elementFromPoint(x, y);
        while (el && el !== document.body) {
            if (el.dataset && el.dataset.hindusWordRef !== undefined) {
                var parsed = parseInt(el.dataset.hindusWordRef, 10);
                return isNaN(parsed) ? null : parsed;
            }
            el = el.parentElement;
        }
        return null;
    },

    _onPointerMove(e) {
        if (!this._dragPending) return;
        if (this._dragPending.pointerId !== e.pointerId) return;
        var dx = e.clientX - this._dragPending.startX;
        var dy = e.clientY - this._dragPending.startY;
        if (!this._dragActive) {
            if (Math.sqrt(dx * dx + dy * dy) < 6) return;
            this._dragActive = true;
            this._startDragGhost(e);
        }
        if (this._dragGhost) {
            this._dragGhost.style.left = e.clientX + 'px';
            this._dragGhost.style.top = e.clientY + 'px';
        }
        this._updateDropHighlight(e);
        e.preventDefault();
    },

    _onPointerUp(e) {
        if (!this._dragPending) return;
        document.removeEventListener('pointermove', this._onPointerMoveBound);
        document.removeEventListener('pointerup', this._onPointerUpBound);
        document.removeEventListener('pointercancel', this._onPointerUpBound);
        var wasActive = this._dragActive;
        var source = this._dragPending.source;
        this._dragPending = null;
        this._dragActive = false;
        if (this._dragGhost) { this._dragGhost.remove(); this._dragGhost = null; }
        // Resolve the drop target BEFORE hiding the highlights — insert-zones
        // collapse to display:none when hidden, so elementFromPoint would
        // otherwise fall through to whatever is underneath (usually the
        // word bank, which would empty the source slot and look like the
        // word "going back down").
        var target = wasActive ? this._getDropTargetAt(e.clientX, e.clientY) : null;
        this._clearDropHighlights();
        if (!wasActive) return;
        if (target) this._performTransfer(source, target);
    },

    _startDragGhost(e) {
        var text = '';
        if (this._dragPending.source.kind === 'word') {
            text = this._words[this._dragPending.source.index];
        } else if (this._dragPending.source.kind === 'slot') {
            var pw = this._slots[this._dragPending.source.index];
            text = pw !== null ? this._words[pw] : '';
        }
        var ghost = document.createElement('div');
        ghost.textContent = text;
        ghost.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;padding:8px 16px;background:#0d9488;color:white;border-radius:8px;font-size:1.2em;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.25);opacity:0.92;transform:translate(-50%,-50%);direction:rtl';
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
        document.body.appendChild(ghost);
        this._dragGhost = ghost;
    },

    // Visual chain-line from the first-clicked word to the cursor while in
    // glue mode; cleared once a second word is picked or the mode is exited.
    _updateChainLine(x, y) {
        if (!this._active || !this._glueMode || this._glueFirst === null) {
            this._clearChainLine();
            return;
        }
        var sourceEl = document.querySelector('[data-hindus-word-ref="' + this._glueFirst + '"]');
        if (!sourceEl) { this._clearChainLine(); return; }
        var rect = sourceEl.getBoundingClientRect();
        var sx = rect.left + rect.width / 2;
        var sy = rect.top + rect.height / 2;
        if (!this._chainOverlay) {
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:9998';
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('stroke', '#3b82f6');
            line.setAttribute('stroke-width', '3');
            line.setAttribute('stroke-dasharray', '8 6');
            line.setAttribute('stroke-linecap', 'round');
            svg.appendChild(line);
            document.body.appendChild(svg);
            this._chainOverlay = { svg: svg, line: line };
        }
        var line = this._chainOverlay.line;
        line.setAttribute('x1', sx);
        line.setAttribute('y1', sy);
        line.setAttribute('x2', x);
        line.setAttribute('y2', y);
    },

    _clearChainLine() {
        if (this._chainOverlay && this._chainOverlay.svg && this._chainOverlay.svg.parentNode) {
            this._chainOverlay.svg.parentNode.removeChild(this._chainOverlay.svg);
        }
        this._chainOverlay = null;
    },

    _clearDropHighlights() {
        document.querySelectorAll('[data-hindus-drop]').forEach(function(el) {
            el.style.outline = '';
            el.style.outlineOffset = '';
            if (el.dataset.hindusDrop === 'insert') {
                el.style.background = '';
                el.style.visibility = '';
                el.style.pointerEvents = '';
            }
        });
        document.querySelectorAll('[data-hindus-insert-zone="true"]').forEach(function(el) {
            el.style.display = 'none';
        });
    },

    // Insert-zones immediately adjacent to the dragged word's current slot
    // are dead-ends — inserting there would just drop the word next to
    // itself. Hide them for the duration of the drag.
    _blockedInsertAtsForSource(source) {
        var blocked = new Set();
        if (!source) return blocked;
        var slotP = -1;
        if (source.kind === 'word') slotP = this._slots.indexOf(source.index);
        else if (source.kind === 'slot') slotP = source.index;
        if (slotP !== -1) {
            blocked.add(slotP);
            blocked.add(slotP + 1);
        }
        return blocked;
    },

    _updateDropHighlight(e) {
        this._clearDropHighlights();
        var blocked = this._blockedInsertAtsForSource(this._dragPending && this._dragPending.source);
        // Reveal valid insert-zones during an active drag. Each zone holds two
        // arrow halves (→ push right / ← push left); the whole zone is hidden
        // when it's adjacent to the dragged word's own slot (drop would be a
        // no-op), and individual halves stay tinted to show they're available.
        document.querySelectorAll('[data-hindus-insert-zone="true"]').forEach(function(zone) {
            var firstChild = zone.querySelector('[data-hindus-drop="insert"]');
            if (!firstChild) return;
            var at = parseInt(firstChild.dataset.hindusInsertAt, 10);
            if (blocked.has(at)) {
                zone.style.display = 'none';
            } else {
                zone.style.display = 'flex';
            }
        });
        document.querySelectorAll('[data-hindus-drop="insert"]').forEach(function(el) {
            el.style.background = 'rgba(13,148,136,0.22)';
        });
        var t = this._getDropTargetEl(e.clientX, e.clientY);
        if (t) {
            t.style.outline = '3px solid #0d9488';
            t.style.outlineOffset = '2px';
            if (t.dataset.hindusDrop === 'insert') {
                t.style.background = 'rgba(13,148,136,0.55)';
            }
        }
    },

    _getDropTargetEl(x, y) {
        var el = document.elementFromPoint(x, y);
        while (el && el !== document.body) {
            if (el.dataset && el.dataset.hindusDrop) return el;
            el = el.parentElement;
        }
        return null;
    },

    _getDropTargetAt(x, y) {
        var el = this._getDropTargetEl(x, y);
        if (!el) return null;
        var kind = el.dataset.hindusDrop;
        if (kind === 'slot') return { kind: 'slot', index: parseInt(el.dataset.hindusIndex, 10) };
        if (kind === 'bank') return { kind: 'bank' };
        if (kind === 'insert') return { kind: 'insert', insertAt: parseInt(el.dataset.hindusInsertAt, 10), pushDir: el.dataset.hindusPushDir || null };
        return null;
    },

    // Before/after FLIP so the surrounding words slide into their new spots
    // instead of snapping — makes push-insertion visually obvious (Amitai).
    _captureColPositions() {
        var map = {};
        document.querySelectorAll('[data-hindus-col-word]').forEach(function(col) {
            map[col.dataset.hindusColWord] = col.getBoundingClientRect().left;
        });
        return map;
    },

    _animateColsFromBefore(before) {
        if (!before) return;
        requestAnimationFrame(function() {
            document.querySelectorAll('[data-hindus-col-word]').forEach(function(col) {
                var w = col.dataset.hindusColWord;
                if (!(w in before)) return;
                var newLeft = col.getBoundingClientRect().left;
                var delta = before[w] - newLeft;
                if (Math.abs(delta) < 1) return;
                col.style.transition = 'none';
                col.style.transform = 'translateX(' + delta + 'px)';
                requestAnimationFrame(function() {
                    col.style.transition = 'transform 0.28s ease-out';
                    col.style.transform = '';
                    var done = function() {
                        col.style.transition = '';
                        col.removeEventListener('transitionend', done);
                    };
                    col.addEventListener('transitionend', done);
                });
            });
        });
    },

    _performTransfer(source, target) {
        if (source.kind === target.kind && source.index === target.index) return;
        var beforePositions = this._captureColPositions();
        this._snapshot();
        if (source.kind === 'word' && target.kind === 'slot') {
            var wordIdx = source.index;
            var slotIdx = target.index;
            var existing = this._slots.indexOf(wordIdx);
            if (existing !== -1 && existing !== slotIdx) {
                this._slots[existing] = null;
                this._hebrewRects[existing] = '';
                this._arabicRects[existing] = '';
            }
            // If target slot is filled, the old word returns to bank (just overwrite)
            this._slots[slotIdx] = wordIdx;
            this._hebrewRects[slotIdx] = this._words[wordIdx];
        } else if (source.kind === 'slot' && target.kind === 'slot') {
            var s1 = source.index, s2 = target.index;
            var w1 = this._slots[s1], w2 = this._slots[s2];
            var h1 = this._hebrewRects[s1] || '', h2 = this._hebrewRects[s2] || '';
            var a1 = this._arabicRects[s1] || '', a2 = this._arabicRects[s2] || '';
            this._slots[s1] = w2; this._slots[s2] = w1;
            this._hebrewRects[s1] = h2; this._hebrewRects[s2] = h1;
            this._arabicRects[s1] = a2; this._arabicRects[s2] = a1;
        } else if (source.kind === 'slot' && target.kind === 'bank') {
            this._slots[source.index] = null;
            this._hebrewRects[source.index] = '';
            this._arabicRects[source.index] = '';
        } else if (source.kind === 'word' && target.kind === 'insert') {
            this._insertWordAt(source.index, target.insertAt, target.pushDir);
        } else if (source.kind === 'slot' && target.kind === 'insert') {
            var wordAtSlot = this._slots[source.index];
            if (wordAtSlot !== null) {
                this._insertWordAt(wordAtSlot, target.insertAt, target.pushDir);
            }
        } else if (source.kind === 'word' && target.kind === 'bank') {
            return;
        }
        this.render();
        this._animateColsFromBefore(beforePositions);
    },

    // Nearest empty slot at or before index K (visually to the right in RTL).
    _findEmptyRightOf(K) {
        for (var i = K; i >= 0; i--) {
            if (this._slots[i] === null) return i;
        }
        return -1;
    },

    // Nearest empty slot at or after index K (visually to the left in RTL).
    _findEmptyLeftOf(K) {
        for (var i = K; i < this._slots.length; i++) {
            if (this._slots[i] === null) return i;
        }
        return -1;
    },

    // Drag word from the bank into the gap between two placed words.
    // Pushes neighbouring words into an existing empty slot so the total
    // column count stays fixed — mirrors the student's mental model of
    // positions-on-an-answer-line rather than adding free-floating rects.
    // Chooses the closer empty side automatically (ties → push right).
    _insertWordAt(wordIdx, insertAt, explicitDir) {
        var slotP = this._slots.indexOf(wordIdx);
        if (slotP !== -1 && (insertAt === slotP || insertAt === slotP + 1)) return;
        // Empty the word's current slot first so it becomes a candidate empty
        // slot the push can consume (e.g. moving the rightmost word leftward
        // with no other free columns — its own slot fills the gap).
        var restoreSlot = -1;
        if (slotP !== -1) {
            restoreSlot = slotP;
            this._slots[slotP] = null;
            this._hebrewRects[slotP] = '';
            this._arabicRects[slotP] = '';
        }
        var eRight = this._findEmptyRightOf(insertAt - 1);
        var eLeft = this._findEmptyLeftOf(insertAt);
        var direction = explicitDir;
        if (!direction) {
            if (eRight !== -1 && eLeft !== -1) {
                var distRight = (insertAt - 1) - eRight;
                var distLeft = eLeft - insertAt;
                direction = distRight <= distLeft ? 'right' : 'left';
            } else if (eRight !== -1) {
                direction = 'right';
            } else if (eLeft !== -1) {
                direction = 'left';
            }
        }
        var chosenEmpty = direction === 'right' ? eRight : (direction === 'left' ? eLeft : -1);
        if (chosenEmpty === -1) {
            // Requested direction unreachable — revert to the word's old slot.
            if (restoreSlot !== -1) {
                this._slots[restoreSlot] = wordIdx;
                this._hebrewRects[restoreSlot] = this._words[wordIdx];
            }
            return;
        }
        this._spliceEmptyAndInsert(chosenEmpty, insertAt, wordIdx);
    },

    // Removes the empty at `emptyIdx` and inserts `wordIdx` so it lands at the
    // visual position originally pointed to by `insertAt`.
    _spliceEmptyAndInsert(emptyIdx, insertAt, wordIdx) {
        this._slots.splice(emptyIdx, 1);
        this._hebrewRects.splice(emptyIdx, 1);
        this._arabicRects.splice(emptyIdx, 1);
        var adjusted = emptyIdx < insertAt ? insertAt - 1 : insertAt;
        this._slots.splice(adjusted, 0, wordIdx);
        this._hebrewRects.splice(adjusted, 0, this._words[wordIdx]);
        this._arabicRects.splice(adjusted, 0, '');
        var newGhosted = {};
        for (var g in this._ghostedColumns) {
            var gi = parseInt(g);
            if (gi === emptyIdx) continue;
            var shifted = gi > emptyIdx ? gi - 1 : gi;
            if (shifted >= adjusted) shifted += 1;
            newGhosted[shifted] = this._ghostedColumns[g];
        }
        this._ghostedColumns = newGhosted;
    },

    // Drag an already-placed word (by its current column) into a gap — move
    // the word, collapse its old column so the total column count stays the same.
    _moveSlotToInsert(fromSlot, insertAt) {
        if (fromSlot === insertAt || fromSlot === insertAt - 1) return;
        var w = this._slots[fromSlot];
        var h = this._hebrewRects[fromSlot] || '';
        var a = this._arabicRects[fromSlot] || '';
        this._slots.splice(fromSlot, 1);
        this._hebrewRects.splice(fromSlot, 1);
        this._arabicRects.splice(fromSlot, 1);
        var adjusted = fromSlot < insertAt ? insertAt - 1 : insertAt;
        this._slots.splice(adjusted, 0, w);
        this._hebrewRects.splice(adjusted, 0, h);
        this._arabicRects.splice(adjusted, 0, a);
        var newGhosted = {};
        for (var g in this._ghostedColumns) {
            var gi = parseInt(g);
            var shifted = gi;
            if (gi === fromSlot) {
                shifted = adjusted;
            } else {
                if (gi > fromSlot) shifted -= 1;
                if (shifted >= adjusted) shifted += 1;
            }
            newGhosted[shifted] = this._ghostedColumns[g];
        }
        this._ghostedColumns = newGhosted;
    },

    _getTagColor(tag) {
        for (var i = 0; i < this.TAG_CATEGORIES.length; i++) {
            if (this.TAG_CATEGORIES[i].tags.includes(tag)) return this.TAG_CATEGORIES[i].color;
        }
        return '#f59e0b';
    },

    _toggleTag(wordIndex, tag) {
        this._snapshot();
        if (!this._wordTags[wordIndex]) this._wordTags[wordIndex] = new Set();
        var tags = this._wordTags[wordIndex];
        if (tags.has(tag)) {
            tags.delete(tag);
        } else {
            tags.add(tag);
            // Fun sound when adding a tag
            if (typeof SoundManager !== 'undefined') SoundManager.playTag();
        }
    },

    _showEditPopup(wordIndex) {
        var word = this._words[wordIndex];
        var existing = document.getElementById('hindus-edit-popup');
        if (existing) existing.remove();

        var popup = document.createElement('div');
        popup.id = 'hindus-edit-popup';
        popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;border-radius:16px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:200;direction:rtl;text-align:center;min-width:300px';

        var title = document.createElement('div');
        title.textContent = 'ערוך מילה:';
        title.style.cssText = 'font-weight:bold;margin-bottom:16px;font-size:1.1em;color:#1e293b';
        popup.appendChild(title);

        var input = document.createElement('input');
        input.type = 'text';
        input.value = word;
        input.style.cssText = 'width:100%;padding:10px;font-size:1.3em;border:2px solid #8b5cf6;border-radius:8px;text-align:center;direction:rtl;outline:none;font-family:Arial,serif';
        popup.appendChild(input);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:center';

        var saveBtn = document.createElement('button');
        saveBtn.textContent = 'שמור';
        saveBtn.style.cssText = 'padding:8px 24px;border:none;border-radius:8px;background:#8b5cf6;color:white;cursor:pointer;font-size:1em;font-weight:bold';
        saveBtn.onclick = () => {
            if (input.value.trim() && input.value.trim() !== this._words[wordIndex]) {
                this._snapshot();
                this._words[wordIndex] = input.value.trim();
                if (this._stage && this._stage.isCustom && typeof updateCustomStage === 'function') {
                    var persistedWords = this._words.slice();
                    updateCustomStage(this._stage.id, { hindusWords: persistedWords });
                    this._stage.hindusWords = persistedWords;
                }
            }
            popup.remove();
            backdrop.remove();
            this._pencilMode = false;
            this.render();
        };
        btnRow.appendChild(saveBtn);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'ביטול';
        cancelBtn.style.cssText = 'padding:8px 24px;border:none;border-radius:8px;background:#e2e8f0;color:#64748b;cursor:pointer;font-size:1em';
        cancelBtn.onclick = () => { popup.remove(); backdrop.remove(); };
        btnRow.appendChild(cancelBtn);

        popup.appendChild(btnRow);

        var backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:199';
        backdrop.onclick = () => { backdrop.remove(); popup.remove(); };
        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
        setTimeout(() => input.focus(), 50);
    },

    _showCutPopup(wordIndex) {
        var word = this._words[wordIndex];
        if (word.length < 2) return;

        var existing = document.getElementById('hindus-cut-popup');
        if (existing) existing.remove();

        var popup = document.createElement('div');
        popup.id = 'hindus-cut-popup';
        popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;border-radius:16px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:200;direction:rtl;text-align:center;min-width:300px';

        var title = document.createElement('div');
        title.textContent = 'בחר היכן לגזור:';
        title.style.cssText = 'font-weight:bold;margin-bottom:16px;font-size:1.1em;color:#1e293b';
        popup.appendChild(title);

        var lettersRow = document.createElement('div');
        lettersRow.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:0;font-size:2em;direction:rtl';

        var letters = [...word];
        var self = this;
        letters.forEach(function(letter, li) {
            var letterSpan = document.createElement('span');
            letterSpan.textContent = letter;
            letterSpan.style.cssText = 'padding:4px 2px;color:#1e293b;font-weight:bold';
            lettersRow.appendChild(letterSpan);

            if (li < letters.length - 1) {
                if (letter === '-') {
                    var removeBtn = document.createElement('button');
                    removeBtn.textContent = '✕';
                    removeBtn.title = 'הסר מקף ופצל';
                    removeBtn.style.cssText = 'padding:2px 6px;font-size:0.5em;cursor:pointer;border:2px solid #3b82f6;border-radius:4px;background:#eff6ff;color:#3b82f6;margin:0 2px;transition:all 0.2s';
                    removeBtn.onmouseenter = function() { removeBtn.style.background = '#3b82f6'; removeBtn.style.color = 'white'; };
                    removeBtn.onmouseleave = function() { removeBtn.style.background = '#eff6ff'; removeBtn.style.color = '#3b82f6'; };
                    removeBtn.onclick = function() {
                        self._splitAtHyphen(wordIndex, li);
                        popup.remove();
                        backdrop.remove();
                    };
                    lettersRow.removeChild(letterSpan);
                    lettersRow.appendChild(removeBtn);
                } else if (letters[li + 1] !== '-') {
                    var cutBtn = document.createElement('button');
                    cutBtn.textContent = '✂';
                    cutBtn.style.cssText = 'padding:2px 6px;font-size:0.5em;cursor:pointer;border:2px dashed #ef4444;border-radius:4px;background:#fef2f2;color:#ef4444;margin:0 2px;transition:all 0.2s';
                    cutBtn.onmouseenter = function() { cutBtn.style.background = '#ef4444'; cutBtn.style.color = 'white'; };
                    cutBtn.onmouseleave = function() { cutBtn.style.background = '#fef2f2'; cutBtn.style.color = '#ef4444'; };
                    cutBtn.onclick = function() {
                        self._cutWord(wordIndex, li + 1);
                        popup.remove();
                        backdrop.remove();
                    };
                    lettersRow.appendChild(cutBtn);
                }
            }
        });

        popup.appendChild(lettersRow);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'ביטול';
        cancelBtn.style.cssText = 'margin-top:16px;padding:8px 24px;border:none;border-radius:8px;background:#e2e8f0;color:#64748b;cursor:pointer;font-size:1em';
        cancelBtn.onclick = function() { popup.remove(); backdrop.remove(); };
        popup.appendChild(cancelBtn);

        var backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:199';
        backdrop.onclick = function() { backdrop.remove(); popup.remove(); };
        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
    },

    _glueWords(idx1, idx2) {
        this._snapshot();
        // Combined string always reads "clicked1-clicked2" (click order).
        // Anchor slot follows placement-priority rule:
        //   - If one word is placed (upper row) and the other is still in the
        //     bank, the PLACED word is always the anchor (the bank word flies
        //     to it) regardless of click order — Amitai 2026-04-19.
        //   - Otherwise (both placed, or both in bank), click order wins and
        //     idx1 is the anchor.
        var idx1Slot = this._slots.indexOf(idx1);
        var idx2Slot = this._slots.indexOf(idx2);
        var anchor, other;
        if (idx1Slot !== -1 && idx2Slot === -1) {
            anchor = idx1; other = idx2;
        } else if (idx1Slot === -1 && idx2Slot !== -1) {
            anchor = idx2; other = idx1;
        } else {
            anchor = idx1; other = idx2;
        }
        var combined = this._words[idx1] + '-' + this._words[idx2];
        var anchorSlot = this._slots.indexOf(anchor);
        var otherSlot = this._slots.indexOf(other);
        var firstClickedArabic = idx1Slot !== -1 ? (this._arabicRects[idx1Slot] || '') : '';

        this._words[anchor] = combined;
        this._words.splice(other, 1);

        // Splice out the follower's column entirely — the chain absorbs it
        // into the anchor, so the placement row shrinks by one. Leaving an
        // empty slot there would confuse the student (Amitai 2026-04-19).
        // If the follower was still in the warehouse (otherSlot === -1), no
        // dedicated column existed for it but the placement row was sized
        // to _words.length at activate time — drop the rightmost null
        // column so the orphan top-row Heb/Ar rects vanish (Amitai 2026-05-09).
        var removeIdx = otherSlot;
        if (removeIdx === -1) {
            for (var ri = this._slots.length - 1; ri >= 0; ri--) {
                if (this._slots[ri] === null) { removeIdx = ri; break; }
            }
        }
        if (removeIdx !== -1) {
            this._slots.splice(removeIdx, 1);
            this._hebrewRects.splice(removeIdx, 1);
            this._arabicRects.splice(removeIdx, 1);
            var newGhosted = {};
            for (var gk in this._ghostedColumns) {
                var gki = parseInt(gk);
                if (gki === removeIdx) continue;
                newGhosted[gki > removeIdx ? gki - 1 : gki] = this._ghostedColumns[gk];
            }
            this._ghostedColumns = newGhosted;
        }

        this._slots = this._slots.map(function(s) {
            if (s === null) return null;
            if (s === other) return null;
            if (s > other) return s - 1;
            return s;
        });

        var anchorNewIdx = other < anchor ? anchor - 1 : anchor;
        var newAnchorSlot = this._slots.indexOf(anchorNewIdx);
        if (newAnchorSlot !== -1) {
            this._hebrewRects[newAnchorSlot] = combined;
            // The Arabic rectangle follows the first word selected for the
            // chain. The second word's Arabic text is intentionally discarded.
            this._arabicRects[newAnchorSlot] = firstClickedArabic;
        }

        var newTags = {};
        var mergedTags = new Set([
            ...(this._wordTags[anchor] || []),
            ...(this._wordTags[other] || [])
        ]);
        if (mergedTags.size > 0) newTags[anchorNewIdx] = mergedTags;
        for (var idx in this._wordTags) {
            var i = parseInt(idx);
            if (i === anchor || i === other) continue;
            if (i > other) newTags[i - 1] = this._wordTags[idx];
            else newTags[i] = this._wordTags[idx];
        }
        this._wordTags = newTags;

        var newRedundant = {};
        for (var idx2key in this._redundantWords) {
            var j = parseInt(idx2key);
            if (j === other) continue;
            if (j === anchor) { newRedundant[anchorNewIdx] = true; continue; }
            if (j > other) newRedundant[j - 1] = true;
            else newRedundant[j] = true;
        }
        this._redundantWords = newRedundant;

        this._glueMode = false;
        this._glueFirst = null;
        this.render();
    },

    // Places the newly-split second half after a cut/hyphen split.
    // If the original word was placed in a slot, part2 goes into a new slot
    // adjacent to part1 (leftward in RTL) so the cut word stays in the
    // placement row instead of falling back to the word bank.
    // Hebrew rects auto-fill with each half (mirroring the placement word);
    // the Arabic answer stays on the right, the new left column is blank so
    // no part of the answer is revealed unintentionally.
    // Otherwise the legacy behaviour — append an empty slot at the end — kicks in.
    _placeSplitRemainder(currentSlotIdx, part2WordIndex) {
        if (currentSlotIdx !== -1) {
            var insertAt = currentSlotIdx + 1;
            var part1Text = this._words[part2WordIndex - 1];
            var part2Text = this._words[part2WordIndex];
            this._slots.splice(insertAt, 0, part2WordIndex);
            this._hebrewRects[currentSlotIdx] = part1Text;
            this._hebrewRects.splice(insertAt, 0, part2Text);
            this._arabicRects.splice(insertAt, 0, '');
            var newGhosted = {};
            for (var g in this._ghostedColumns) {
                var gi = parseInt(g);
                newGhosted[gi >= insertAt ? gi + 1 : gi] = this._ghostedColumns[g];
            }
            this._ghostedColumns = newGhosted;
        } else {
            this._slots.push(null);
            this._hebrewRects.push('');
            this._arabicRects.push('');
        }
    },

    _splitAtHyphen(wordIndex, hyphenPos) {
        this._snapshot();
        var word = this._words[wordIndex];
        var letters = [...word];
        var part1 = letters.slice(0, hyphenPos).join('');
        var part2 = letters.slice(hyphenPos + 1).join('');
        var currentSlotIdx = this._slots.indexOf(wordIndex);

        this._words.splice(wordIndex, 1, part1, part2);

        this._slots = this._slots.map(function(s) {
            if (s === null) return null;
            if (s === wordIndex) return s;
            if (s > wordIndex) return s + 1;
            return s;
        });

        var newTags = {};
        for (var idx in this._wordTags) {
            var i = parseInt(idx);
            if (i > wordIndex) newTags[i + 1] = this._wordTags[idx];
            else newTags[i] = this._wordTags[idx];
        }
        this._wordTags = newTags;

        this._placeSplitRemainder(currentSlotIdx, wordIndex + 1);

        this._scissorsMode = false;
        this.render();
    },

    _cutWord(wordIndex, cutPos) {
        this._snapshot();
        var word = this._words[wordIndex];
        var letters = [...word];
        var part1 = letters.slice(0, cutPos).join('');
        var part2 = letters.slice(cutPos).join('');
        var currentSlotIdx = this._slots.indexOf(wordIndex);

        this._words.splice(wordIndex, 1, part1, part2);

        this._slots = this._slots.map(function(s) {
            if (s === null) return null;
            if (s === wordIndex) return s;
            if (s > wordIndex) return s + 1;
            return s;
        });

        var newTags = {};
        for (var idx in this._wordTags) {
            var i = parseInt(idx);
            if (i > wordIndex) newTags[i + 1] = this._wordTags[idx];
            else newTags[i] = this._wordTags[idx];
        }
        this._wordTags = newTags;

        this._placeSplitRemainder(currentSlotIdx, wordIndex + 1);

        this._scissorsMode = false;
        this.render();
    },

    // Arabic letter + geresh → special Arabic letter (Arabic-to-Arabic conversion)
    _ARABIC_GERESH_MAP: {
        'ه': 'ة', 'د': 'ذ', 'ح': 'خ', 'ص': 'ض', 'ط': 'ظ', 'ع': 'غ', 'ت': 'ث',
        'ي': 'ئ', 'و': 'ؤ', 'ا': 'ء', 'أ': 'ء', 'ئ': 'ى'
    },

    _convertHebrewToArabic(text) {
        var result = '';
        var isGeresh = function(c) { return c === "'" || c === '\u05F3' || c === '\u2018' || c === '\u2019'; };
        for (var i = 0; i < text.length; i++) {
            var char = text[i];
            var next = text[i + 1];
            // Hebrew + geresh → special Arabic
            if (next && isGeresh(next) && GERESH_MAP[char]) {
                var mapped = GERESH_MAP[char];
                var next2 = text[i + 2];
                // Double geresh: י'' → ئ → ى
                if (next2 && isGeresh(next2) && DOUBLE_GERESH_MAP && DOUBLE_GERESH_MAP[mapped]) {
                    result += DOUBLE_GERESH_MAP[mapped];
                    i += 2;
                } else {
                    result += mapped;
                    i++;
                }
            // Arabic + geresh → upgraded Arabic (e.g. ئ' → ى)
            } else if (next && isGeresh(next) && this._ARABIC_GERESH_MAP[char]) {
                result += this._ARABIC_GERESH_MAP[char];
                i++;
            // " (gershayim) → ى
            } else if (char === '"' || char === '\u05F4' || char === '\u201C' || char === '\u201D') {
                result += '\u0649';
            } else if (HEBREW_TO_ARABIC[char]) {
                result += HEBREW_TO_ARABIC[char];
            } else {
                result += char;
            }
        }
        return result;
    },

    _renderSidebar() {
        var existing = document.getElementById('hindus-sidebar');
        if (existing) existing.remove();

        var sidebar = document.createElement('div');
        sidebar.id = 'hindus-sidebar';
        sidebar.style.cssText = 'position:fixed;right:8px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px;z-index:100;background:#1e293b;border-radius:12px;padding:8px;box-shadow:0 4px 16px rgba(0,0,0,0.2)';

        var self = this;
        var tools = [
            { icon: '🖱️', title: 'סמן — מצב רגיל', mode: '_pointerMode', color: '#0ea5e9' },
            { icon: '✂', title: 'מספריים — גזור מילה', mode: '_scissorsMode', color: '#ef4444' },
            { icon: '🔗', title: 'דבק — חבר מילים', mode: '_glueMode', color: '#3b82f6' },
            { icon: '✏️', title: 'עיפרון — ערוך מילה', mode: '_pencilMode', color: '#8b5cf6' },
            { icon: '👻', title: 'מילה מיותרת — הפוך לשקופה', mode: '_redundantMode', color: '#9ca3af' },
            { icon: '🗑️', title: 'מחק תיוגים', mode: '_deleteTagMode', color: '#f97316' },
            { icon: '⌨️', title: 'מקלדת ניקוד', mode: '_diacriticsKeyboard', color: '#6366f1' },
            { icon: '🧩', title: 'ניתוח תחבירי', mode: '_analysisMenu', color: '#0d9488' }
        ];

        tools.forEach(function(tool) {
            var btn = document.createElement('button');
            btn.textContent = tool.icon;
            btn.title = tool.title;
            var anyModeActive = self._scissorsMode || self._glueMode || self._pencilMode || self._redundantClickMode || self._deleteTagMode || self._diacriticsKeyboard;
            var isActive = tool.mode === '_pointerMode' ? !anyModeActive : (tool.mode === '_redundantMode' ? self._redundantClickMode : self[tool.mode]);
            btn.style.cssText = 'width:40px;height:40px;border-radius:8px;border:none;font-size:1.2em;cursor:pointer;transition:all 0.2s;' +
                (isActive ? 'background:' + tool.color + ';color:white' : 'background:rgba(255,255,255,0.15);color:white');
            btn.onclick = function() {
                if (tool.mode === '_pointerMode') {
                    self._clearModes();
                    self._redundantClickMode = false;
                    if (typeof DiacriticsKeyboard !== 'undefined') DiacriticsKeyboard.deactivate();
                    self.render();
                    return;
                }
                if (tool.mode === '_redundantMode') {
                    self._clearModes();
                    self._redundantClickMode = !self._redundantClickMode;
                    self.render();
                    return;
                }
                if (tool.mode === '_analysisMenu') {
                    self._showAnalysisMenu(btn);
                    return;
                }
                if (tool.mode === '_diacriticsKeyboard') {
                    // Special handling: don't call render() to preserve focus/cursor
                    var savedEl = document.activeElement;
                    var savedStart = (savedEl && savedEl.selectionStart !== undefined) ? savedEl.selectionStart : null;
                    var savedEnd = (savedEl && savedEl.selectionEnd !== undefined) ? savedEl.selectionEnd : null;
                    var wasActive = self._diacriticsKeyboard;
                    self._clearModes();
                    if (!wasActive) {
                        self._diacriticsKeyboard = true;
                        if (typeof DiacriticsKeyboard !== 'undefined') DiacriticsKeyboard.activate();
                    }
                    // Update all sidebar buttons visually
                    var allBtns = sidebar.querySelectorAll('button');
                    allBtns.forEach(function(b, idx) {
                        var t = tools[idx];
                        if (!t) return;
                        var active = t.mode === '_redundantMode' ? self._redundantClickMode : self[t.mode];
                        b.style.background = active ? t.color : 'rgba(255,255,255,0.15)';
                    });
                    // Restore focus/cursor
                    if (savedEl && savedEl.focus) {
                        savedEl.focus();
                        // In diacritics mode: cursor on first letter (ready to add diacritics)
                        if (self._diacriticsKeyboard) {
                            try { savedEl.setSelectionRange(0, 0); } catch(ex) {}
                        } else if (savedStart !== null) {
                            try { savedEl.setSelectionRange(savedStart, savedEnd); } catch(ex) {}
                        }
                    }
                    return;
                }
                var wasActive = self[tool.mode];
                self._clearModes();
                if (!wasActive) {
                    self[tool.mode] = true;
                }
                self.render();
            };
            sidebar.appendChild(btn);
        });

        // Sync sidebar button state when DiacriticsKeyboard is toggled externally (Ctrl+M)
        document.addEventListener('dk-toggle', function(ev) {
            if (!self._active) return;
            self._diacriticsKeyboard = ev.detail && ev.detail.active;
            var allBtns = sidebar.querySelectorAll('button');
            allBtns.forEach(function(b, idx) {
                var t = tools[idx];
                if (!t) return;
                var active = t.mode === '_redundantMode' ? self._redundantClickMode : self[t.mode];
                b.style.background = active ? t.color : 'rgba(255,255,255,0.15)';
            });
        });

        document.body.appendChild(sidebar);
    },

    _stripDiacritics(text) {
        return text.replace(/[\u064B-\u065F]/g, '');
    },

    _normalizeAlef(text) {
        return text.replace(/[أإآٱ]/g, 'ا');
    },

    _getFinalDiacritics(word) {
        // Find last base letter (non-diacritic), collect diacritics after it
        var chars = [...word];
        var lastBaseIdx = -1;
        for (var i = chars.length - 1; i >= 0; i--) {
            if (!/[\u064B-\u065F]/.test(chars[i])) {
                lastBaseIdx = i;
                break;
            }
        }
        if (lastBaseIdx === -1) return '';
        var final = chars[lastBaseIdx];
        for (var i = lastBaseIdx + 1; i < chars.length; i++) {
            if (/[\u064B-\u065F]/.test(chars[i])) final += chars[i];
            else break;
        }
        return final;
    },

    // Returns info about the LAST base letter in the word that carries any
    // diacritic — not necessarily the last letter of the word (Amitai's
    // "ניקוד סופי" rule: a word may end with an un-diacritized letter while
    // the case-ending mark sits on the second/third letter from the end).
    // Returns { letterIndex, letter, diacritics } or null if the word has
    // no diacritics at all. letterIndex is 0-based over base letters only
    // (stripped of diacritics).
    _getLastDiacritizedInfo(word) {
        var chars = [...word];
        var letterCount = 0;
        var baseIdx = -1;
        var lastLetterIdx = -1;
        var lastLetter = '';
        var lastDiacs = '';
        for (var i = 0; i < chars.length; i++) {
            if (/[\u064B-\u065F\u0670]/.test(chars[i])) {
                if (baseIdx !== -1) {
                    lastLetterIdx = letterCount - 1;
                    lastLetter = chars[baseIdx];
                    var d = '';
                    for (var j = baseIdx + 1; j < chars.length; j++) {
                        if (/[\u064B-\u065F\u0670]/.test(chars[j])) d += chars[j];
                        else break;
                    }
                    lastDiacs = d;
                }
            } else {
                baseIdx = i;
                letterCount++;
            }
        }
        if (lastLetterIdx === -1) return null;
        return { letterIndex: lastLetterIdx, letter: lastLetter, diacritics: lastDiacs };
    },

    _compareLastDiacritic(userWord, answerWord) {
        var self = this;
        var userNorm = self._normalizeAlef(userWord);
        var ansNorm = self._normalizeAlef(answerWord);
        // Step 1 — letters-only match.
        if (self._stripDiacritics(userNorm) !== self._stripDiacritics(ansNorm)) return false;
        // Step 2 — same position (= same base-letter index) for the last
        // diacritized letter. Step 3 — same diacritic(s) at that position.
        var uInfo = self._getLastDiacritizedInfo(userNorm);
        var aInfo = self._getLastDiacritizedInfo(ansNorm);
        if (!uInfo && !aInfo) return true;
        if (!uInfo || !aInfo) return false;
        if (uInfo.letterIndex !== aInfo.letterIndex) return false;
        if (uInfo.diacritics !== aInfo.diacritics) return false;
        return true;
    },

    _getWordWithFinalDiacriticsOnly(word) {
        // Return base letters + only the diacritics on the last letter
        var chars = [...word];
        var lastBaseIdx = -1;
        for (var i = chars.length - 1; i >= 0; i--) {
            if (!/[\u064B-\u065F]/.test(chars[i])) {
                lastBaseIdx = i;
                break;
            }
        }
        if (lastBaseIdx === -1) return this._stripDiacritics(word);
        // Base letters (stripped) + last letter with its diacritics
        var base = '';
        for (var i = 0; i < chars.length; i++) {
            if (i < lastBaseIdx && !/[\u064B-\u065F]/.test(chars[i])) base += chars[i];
            else if (i >= lastBaseIdx) base += chars[i];
        }
        return base;
    },

    _showSolutionPanel(container, afterBtn) {
        var panel = document.createElement('div');
        panel.id = 'hindus-solution-panel';
        panel.style.cssText = 'margin:12px 16px;padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;direction:rtl';

        // Hidden answer div (toggled by ראה תשובה button)
        var answerDiv = document.createElement('div');
        answerDiv.id = 'hindus-answer-reveal';
        answerDiv.style.cssText = 'display:none;font-size:1.4em;font-weight:bold;font-family:Arial,serif;text-align:center;color:#1e293b;margin-bottom:16px;padding:12px;background:white;border-radius:8px;border:1px solid #e2e8f0';
        answerDiv.textContent = this._stage.answer;
        panel.appendChild(answerDiv);

        // "ראה תשובה" toggle button
        var showAnswerBtn = document.createElement('button');
        showAnswerBtn.textContent = 'ראה תשובה';
        showAnswerBtn.style.cssText = 'display:block;margin:0 auto 12px;padding:6px 16px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;cursor:pointer;font-size:0.9em;font-weight:bold';
        showAnswerBtn.onclick = function() {
            if (answerDiv.style.display === 'none') {
                answerDiv.style.display = 'block';
                showAnswerBtn.textContent = 'הסתר תשובה';
            } else {
                answerDiv.style.display = 'none';
                showAnswerBtn.textContent = 'ראה תשובה';
            }
        };
        panel.appendChild(showAnswerBtn);

        var answerWords = this._stage.answer.trim().split(/\s+/);
        // Filter out ghosted columns from user words
        var nonGhostedRects = [];
        for (var gi = 0; gi < this._arabicRects.length; gi++) {
            if (!this._ghostedColumns[gi]) nonGhostedRects.push(this._arabicRects[gi]);
        }
        var userWords = nonGhostedRects.slice(0, answerWords.length);
        var self = this;

        var levels = [
            {
                label: 'המשפט נכון (לא כולל ניקוד)',
                compare: function(user, answer) {
                    return self._normalizeAlef(self._stripDiacritics(user)) === self._normalizeAlef(self._stripDiacritics(answer));
                }
            },
            {
                label: 'המשפט נכון (כולל ניקוד סופי בלבד)',
                compare: function(user, answer) {
                    return self._compareLastDiacritic(user, answer);
                }
            },
            {
                label: 'המשפט נכון (כולל ניקוד פנימי וסופי)',
                compare: function(user, answer) {
                    return self._normalizeAlef(user) === self._normalizeAlef(answer);
                }
            }
        ];

        // V/X rows — inserted ABOVE the reveal button
        var levelsRow = document.createElement('div');
        levelsRow.id = 'hindus-levels-row';
        levelsRow.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:8px 16px';

        levels.forEach(function(level, li) {
            var allCorrect = true;
            var incorrectIndices = [];
            for (var wi = 0; wi < answerWords.length; wi++) {
                var userW = (userWords[wi] || '').trim();
                var ansW = answerWords[wi].trim();
                if (!level.compare(userW, ansW)) {
                    allCorrect = false;
                    incorrectIndices.push(wi);
                }
            }
            // Check for excess user words (more non-ghosted rects than answer words)
            var filledUserCount = nonGhostedRects.filter(function(r) { return r && r.trim(); }).length;
            if (filledUserCount > answerWords.length) {
                allCorrect = false;
            }

            var cell = document.createElement('div');
            cell.style.cssText = 'display:flex;align-items:center;gap:4px;padding:6px 10px;background:white;border-radius:8px;border:1px solid #e2e8f0';

            var icon = document.createElement('span');
            icon.textContent = allCorrect ? '✓' : '✗';
            icon.style.cssText = 'font-size:1.1em;font-weight:bold;color:' + (allCorrect ? '#16a34a' : '#dc2626');
            cell.appendChild(icon);

            var labelSpan = document.createElement('span');
            labelSpan.textContent = level.label;
            labelSpan.style.cssText = 'font-size:0.8em;white-space:nowrap';
            if (!allCorrect) {
                labelSpan.style.cursor = 'pointer';
                labelSpan.style.textDecoration = 'none';
                labelSpan.onmouseenter = function() { labelSpan.style.textDecoration = 'underline'; };
                labelSpan.onmouseleave = function() { labelSpan.style.textDecoration = 'none'; };
                var highlighted = false;
                labelSpan.onclick = function() {
                    highlighted = !highlighted;
                    cell.style.borderColor = highlighted ? '#dc2626' : '#e2e8f0';
                    var cols = container.querySelectorAll('input[placeholder="عربي"]');
                    var ngIdx = 0;
                    for (var ci = 0; ci < cols.length; ci++) {
                        if (self._ghostedColumns[ci]) continue;
                        if (highlighted && (incorrectIndices.indexOf(ngIdx) !== -1 || ngIdx >= answerWords.length)) {
                            // Mark incorrect + excess rects as red
                            cols[ci].style.borderColor = '#dc2626';
                            cols[ci].style.background = '#fef2f2';
                        } else if (highlighted && ngIdx < answerWords.length) {
                            // Mark correct rects as green
                            cols[ci].style.borderColor = '#16a34a';
                            cols[ci].style.background = '#f0fdf4';
                        } else {
                            cols[ci].style.borderColor = '#f59e0b';
                            cols[ci].style.background = '#fffbeb';
                        }
                        ngIdx++;
                    }
                };
            }
            cell.appendChild(labelSpan);

            levelsRow.appendChild(cell);
        });

        // Insert answer panel (with ראה תשובה) ABOVE the levels row, BEFORE the reveal button
        container.insertBefore(panel, afterBtn);
        // Insert levelsRow after the panel
        if (panel.nextSibling) {
            container.insertBefore(levelsRow, panel.nextSibling);
        } else {
            container.appendChild(levelsRow);
        }

        // Auto-color rects: green for correct, red for wrong (base level — no diacritics)
        var baseLevel = levels[0];
        var cols = container.querySelectorAll('input[placeholder="عربي"]');
        var ngIdx2 = 0;
        for (var ci = 0; ci < cols.length; ci++) {
            if (this._ghostedColumns[ci]) continue;
            var userW = (userWords[ngIdx2] || '').trim();
            var ansW = (answerWords[ngIdx2] || '').trim();
            if (ngIdx2 >= answerWords.length || !baseLevel.compare(userW, ansW)) {
                cols[ci].style.borderColor = '#dc2626';
                cols[ci].style.background = '#fef2f2';
            } else {
                cols[ci].style.borderColor = '#16a34a';
                cols[ci].style.background = '#f0fdf4';
            }
            ngIdx2++;
        }
    },

    _showAnalysisMenu(anchorBtn) {
        var existing = document.getElementById('hindus-analysis-menu');
        if (existing) { existing.remove(); return; }

        var menu = document.createElement('div');
        menu.id = 'hindus-analysis-menu';
        menu.style.cssText = 'position:fixed;right:56px;top:50%;transform:translateY(-50%);background:white;border-radius:12px;padding:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:200;direction:rtl;min-width:160px';

        var self = this;
        var layers = [
            { label: 'מלבנים בערבית', key: 'arabic', getData: function() { return self._arabicRects.filter(function(r) { return r; }).join(' '); } },
            { label: 'מלבנים בעברית', key: 'hebrew', getData: function() { return self._hebrewRects.filter(function(r) { return r; }).join(' '); } },
            { label: 'שיבוצים', key: 'slots', getData: function() { return self._slots.map(function(s) { return s !== null ? self._words[s] : ''; }).filter(function(w) { return w; }).join(' '); } },
            { label: 'משפט מקורי', key: 'orig', getData: function() { return self._words.join(' '); } }
        ];

        layers.forEach(function(layer) {
            var item = document.createElement('button');
            item.textContent = '🧩 ' + layer.label;
            item.style.cssText = 'display:block;width:100%;padding:10px 14px;border:none;background:none;text-align:right;font-size:1em;cursor:pointer;border-radius:8px;transition:background 0.15s;font-family:inherit';
            item.onmouseenter = function() { item.style.background = '#f0fdfa'; };
            item.onmouseleave = function() { item.style.background = 'none'; };
            item.onclick = function() {
                menu.remove();
                var text = layer.getData();
                if (!text.trim()) {
                    if (typeof Messages !== 'undefined') Messages.show('אין טקסט בשכבה זו', 'warning');
                    return;
                }
                // For Arabic layer with a hindus-answer, pass the diacritized answer
                // so 'חשוף ניקוד' button appears in analysis mode
                var diac = (layer.key === 'arabic' && self._stage && self._stage.answer && self._stage.answer !== 'הכנס פיתרון') ? self._stage.answer : null;
                self._launchAnalysis(text, diac);
            };
            menu.appendChild(item);
        });

        // Close on click outside
        var backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:199';
        backdrop.onclick = function() { backdrop.remove(); menu.remove(); };
        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
    },

    _launchAnalysis(sentenceText, diacritizedSentence) {
        try { localStorage.setItem('plonter_lastMode', 'syntax'); localStorage.setItem('plonter_lastPositionSavedAt', String(Date.now())); } catch (e) {}
        // Save hindus state so we can return with full progress
        this._savedHindusState = true;
        this._savedState = {
            stage: this._stage,
            words: this._words.slice(),
            slots: this._slots.slice(),
            selectedWord: this._selectedWord,
            wordTags: JSON.parse(JSON.stringify(this._wordTags)),
            activeTag: this._activeTag,
            hebrewRects: this._hebrewRects.slice(),
            arabicRects: this._arabicRects.slice(),
            userAnswer: this._userAnswer,
            arabicText: this._arabicText,
            redundantWords: Object.assign({}, this._redundantWords),
            ghostedColumns: Object.assign({}, this._ghostedColumns),
            tagBarExpanded: this._tagBarExpanded
        };

        // Switch to game screen with this sentence
        var welcomeScreen = document.getElementById('welcome-screen');
        var gameScreen = document.getElementById('game-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        if (gameScreen) gameScreen.style.display = 'block';

        // Deactivate hindus overlay but keep state
        this._active = false;
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        var overlay = document.getElementById('hindus-overlay');
        if (overlay) overlay.remove();
        var bar = document.getElementById('hindus-bar');
        if (bar) bar.remove();
        var sidebar = document.getElementById('hindus-sidebar');
        if (sidebar) sidebar.remove();
        // #1204: drop the placement-arrow overlay before analysis reuses
        // sentence-container (it would otherwise paint over the analysis view).
        var arrowsPaused = document.getElementById('hindus-placement-arrows');
        if (arrowsPaused) arrowsPaused.remove();
        if (this._arrowRaf) { cancelAnimationFrame(this._arrowRaf); this._arrowRaf = null; }

        // Mark body so CSS can enable horizontal scroll for long sentences
        document.body.classList.add('hindus-analysis-active');
        // Create a temporary stage for analysis (like "new syntax sentence" flow)
        var tempStage = {
            id: 'hindus_analysis_' + Date.now(),
            number: sentenceText.substring(0, 30),
            sentence: sentenceText,
            category: 'ניתוח הינדוס',
            isCustom: false
        };
        if (diacritizedSentence) tempStage.diacritizedSentence = diacritizedSentence;

        // Load into state manager
        if (typeof state !== 'undefined') {
            state.loadSentence(tempStage);
        }

        // Initialize annotations and render (like normal analysis startup)
        if (typeof Annotations !== 'undefined' && Annotations.loadForStage) {
            Annotations.loadForStage();
        }
        if (typeof Renderer !== 'undefined' && Renderer.renderAll) {
            Renderer.renderAll();
        }

        // Override back-to-menu button to return to hindus instead of lesson viewer
        var backBtn = document.getElementById('back-to-menu-btn');
        if (backBtn) {
            this._savedBackBtnText = backBtn.textContent;
            this._savedBackBtnHandler = backBtn.onclick;
            backBtn.textContent = '⬅ חזור להינדוס';
            backBtn.style.background = '#f59e0b';
            backBtn.style.color = 'white';
            backBtn.style.fontWeight = 'bold';
            backBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                var hasChanges = (typeof state !== 'undefined' && state.undoStack && state.undoStack.length > 0);
                if (hasChanges && typeof showUnsavedDialog === 'function') {
                    showUnsavedDialog('ההתקדמות בניתוח לא תישמר', () => { this._returnToHindus(); });
                } else {
                    this._returnToHindus();
                }
                return false;
            };
        }
        // Also add a separate return button in header for visibility
        var header = gameScreen ? gameScreen.querySelector('header') : null;
        if (header) {
            var returnBtn = document.createElement('button');
            returnBtn.id = 'hindus-return-btn';
            returnBtn.textContent = '⬅ חזור להינדוס';
            returnBtn.style.cssText = 'margin-top:8px;padding:8px 18px;border:none;border-radius:8px;background:#f59e0b;color:white;font-weight:bold;cursor:pointer;font-size:1em';
            returnBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                returnBtn.remove();
                this._returnToHindus();
                return false;
            };
            header.appendChild(returnBtn);
        }
    },

    _returnToHindus() {
        try { localStorage.setItem('plonter_lastMode', 'hindus'); localStorage.setItem('plonter_lastPositionSavedAt', String(Date.now())); } catch (e) {}
        // Clean up analysis artifacts first
        document.body.classList.remove('hindus-analysis-active');
        var archSvg = document.getElementById('arch-svg');
        if (archSvg) archSvg.remove();
        var detailsPanel = document.getElementById('details-panel');
        if (detailsPanel) detailsPanel.classList.remove('open');
        var returnBtn = document.getElementById('hindus-return-btn');
        if (returnBtn) returnBtn.remove();

        // Restore the back button to its previous state (e.g., "חזרה לשיעור")
        var backBtn = document.getElementById('back-to-menu-btn');
        if (backBtn) {
            backBtn.textContent = this._savedBackBtnText || 'חזרה לתפריט';
            backBtn.onclick = this._savedBackBtnHandler || null; // null falls through to addEventListener handler from app.js
            backBtn.style.background = '';
            backBtn.style.color = '';
            backBtn.style.fontWeight = '';
            this._savedBackBtnText = null;
            this._savedBackBtnHandler = null;
        }

        // Ensure we're on the game screen (not welcome or lesson-viewer)
        var gameScreen = document.getElementById('game-screen');
        var welcomeScreen = document.getElementById('welcome-screen');
        if (gameScreen) gameScreen.style.display = 'block';
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        // Restore full hindus state from before analysis
        this._active = true;
        this._savedHindusState = false;

        if (this._savedState) {
            this._stage = this._savedState.stage;
            this._words = this._savedState.words;
            this._slots = this._savedState.slots;
            this._selectedWord = this._savedState.selectedWord;
            this._wordTags = this._savedState.wordTags;
            this._activeTag = this._savedState.activeTag;
            this._hebrewRects = this._savedState.hebrewRects;
            this._arabicRects = this._savedState.arabicRects;
            this._userAnswer = this._savedState.userAnswer;
            this._arabicText = this._savedState.arabicText;
            this._redundantWords = this._savedState.redundantWords;
            this._ghostedColumns = this._savedState.ghostedColumns || {};
            this._tagBarExpanded = this._savedState.tagBarExpanded;
            this._savedState = null;
        }

        // Reset mode flags
        this._scissorsMode = false;
        this._glueMode = false;
        this._glueFirst = null;
        this._pencilMode = false;
        this._deleteTagMode = false;
        this._diacriticsKeyboard = false;
        this._dkTarget = null;

        this._keyHandler = (e) => this._handleKeyboard(e);
        document.addEventListener('keydown', this._keyHandler);
        this._dragPending = null;
        this._dragActive = false;
        this._dragGhost = null;
        this._onPointerMoveBound = (e) => this._onPointerMove(e);
        this._onPointerUpBound = (e) => this._onPointerUp(e);
        this.render();
    },

    _renderTagBar() {
        var bar = document.getElementById('hindus-bar');
        if (bar) bar.remove();

        bar = document.createElement('div');
        bar.id = 'hindus-bar';
        var expanded = this._tagBarExpanded;
        // Always paint the bar in the site's light teal palette (matches
        // body bg #f0fdf4 + primary #0d9488) — in BOTH the collapsed/minimized
        // and the expanded state. (Amitai 2026-06-17: the dark-navy minimized
        // bar looked wrong; he wants the same light colors as the enlarged
        // state.) `_arrowClicked` still drives the expand-arrow pulse variants.
        var lightTheme = true;
        var barBg = lightTheme ? '#f0fdfa' : '#1e293b';
        var barText = lightTheme ? '#0f766e' : 'white';
        var barShadow = lightTheme ? '0 -2px 8px rgba(13,148,136,0.18)' : '0 -2px 8px rgba(0,0,0,0.2)';
        var barExtra = expanded ? 'max-height:40vh;align-items:flex-start;overflow-y:auto;flex-wrap:wrap' : '';
        bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:' + barBg + ';color:' + barText + ';padding:2px 4px;display:flex;gap:1px;justify-content:center;z-index:100;direction:rtl;box-shadow:' + barShadow + ';overflow-x:auto;padding-right:56px;' + barExtra;

        // Font sizes depend on expanded state
        var headerFontSize = expanded ? '1em' : '0.6em';
        var btnFontSize = expanded ? '0.9em' : '0.55em';
        var btnPadding = expanded ? '4px 10px' : '1px 4px';
        var headerPadding = expanded ? '3px 8px' : '1px 4px';

        var self = this;

        // Find which categories contain the active tag (for cross-highlighting)
        var activeCatIndices = [];
        if (this._activeTag) {
            this.TAG_CATEGORIES.forEach(function(cat, ci) {
                if (cat.tags.includes(self._activeTag)) activeCatIndices.push(ci);
            });
        }

        // Render as vertical columns per category (header on own row, max 4 tags per column)
        this.TAG_CATEGORIES.forEach(function(cat, ci) {
            var catContainer = document.createElement('div');
            var catInactiveBg = lightTheme ? 'rgba(13,148,136,0.06)' : 'rgba(255,255,255,0.05)';
            var catInactiveBorder = lightTheme ? '1px solid rgba(13,148,136,0.14)' : '1px solid transparent';
            catContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:1px;padding:2px 4px;border-radius:4px;' +
                (activeCatIndices.includes(ci) ? 'background:' + cat.color + '22;border:1px solid ' + cat.color + '66' : 'background:' + catInactiveBg + ';border:' + catInactiveBorder);

            // Category header — own row, centered
            var header = document.createElement('div');
            header.textContent = cat.name;
            header.style.cssText = 'font-weight:bold;font-size:' + headerFontSize + ';padding:' + headerPadding + ';border-radius:3px;white-space:nowrap;text-align:center;width:100%;' +
                (activeCatIndices.includes(ci) ? 'background:' + cat.color + ';color:white' : 'color:' + cat.color + ';opacity:0.9');
            catContainer.appendChild(header);

            // Tags wrapper — horizontal flex of chunk columns
            var tagsWrapper = document.createElement('div');
            tagsWrapper.style.cssText = 'display:flex;gap:2px';

            var chunks = [];
            for (var ti = 0; ti < cat.tags.length; ti += 4) {
                chunks.push(cat.tags.slice(ti, ti + 4));
            }

            chunks.forEach(function(chunk) {
                var col = document.createElement('div');
                col.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:2px;min-width:40px';

                chunk.forEach(function(tag) {
                    var btn = document.createElement('button');
                    btn.textContent = tag;
                    var isActive = self._activeTag === tag;
                    var btnInactiveBg = lightTheme ? 'white' : 'rgba(255,255,255,0.12)';
                    var btnInactiveBorder = lightTheme ? ';border:1px solid ' + cat.color + '55' : ';border:none';
                    btn.style.cssText = 'padding:' + btnPadding + ';border-radius:4px;font-size:' + btnFontSize + ';font-weight:bold;cursor:pointer;transition:all 0.2s;white-space:nowrap;line-height:1.3;text-align:center;box-sizing:border-box;' +
                        (isActive ? 'background:' + cat.color + ';color:white;border:none;box-shadow:0 0 6px ' + cat.color : 'background:' + btnInactiveBg + ';color:' + cat.color + btnInactiveBorder);
                    btn.onclick = function() {
                        self._activeTag = (self._activeTag === tag) ? null : tag;
                        self._scissorsMode = false;
                        self._glueMode = false;
                        self._pencilMode = false;
                        self._deleteTagMode = false;
                        if (self._activeTag && typeof Annotations !== 'undefined') {
                            Annotations._drawMode = false;
                            Annotations._highlightMode = false;
                            Annotations._translateMode = false;
                            Annotations._diacriticsMode = false;
                            Annotations._openEndedMode = false;
                        }
                        self.render();
                    };
                    col.appendChild(btn);
                });

                tagsWrapper.appendChild(col);
            });

            catContainer.appendChild(tagsWrapper);
            bar.appendChild(catContainer);
        });

        // Expand/collapse button — always visible. Two pulse variants:
        //   strong (first reveal, never clicked yet): gold bg + glowing border
        //     + big scale, grabs the eye.
        //   subtle (after the first click, while bank still empty): small
        //     teal tap-tap with no glow, still signals "expand me" without
        //     screaming at the student (Amitai 2026-04-19).
        if (!document.getElementById('hindus-pulse-style')) {
            var style = document.createElement('style');
            style.id = 'hindus-pulse-style';
            style.textContent =
                '@keyframes hindus-pulse-strong{' +
                  '0%,100%{transform:translateY(-50%) scale(1);box-shadow:0 0 0 0 rgba(245,158,11,0.7),0 0 0 2px #f59e0b inset}' +
                  '50%{transform:translateY(-50%) scale(1.55);box-shadow:0 0 18px 6px rgba(245,158,11,0.85),0 0 0 3px #fbbf24 inset}' +
                '}' +
                '@keyframes hindus-pulse-subtle{' +
                  '0%,100%{transform:translateY(-50%) scale(1)}' +
                  '50%{transform:translateY(-50%) scale(1.12)}' +
                '}';
            document.head.appendChild(style);
        }
        var expandBtn = document.createElement('button');
        expandBtn.textContent = expanded ? '↓' : '↑';
        expandBtn.title = expanded ? 'כווץ' : 'הרחב';
        var allWordsPlaced = this._slots.length > 0 && this._slots.every(function(s) { return s !== null; });
        var shouldPulse = !expanded && allWordsPlaced;
        var pulseStrong = shouldPulse && !this._arrowClicked;
        var pulseSubtle = shouldPulse && this._arrowClicked;
        // The pulse-strong (gold) variant only shows BEFORE the first arrow
        // click, so it never coexists with lightTheme. The subtle + default
        // states do — and rgba(255,255,255,...) backgrounds are invisible on
        // the light bar, so swap them for a teal-tinted pair.
        var btnText = (lightTheme && !pulseStrong) ? '#0f766e' : 'white';
        var pulseSubtleBg = lightTheme
            ? 'background:rgba(13,148,136,0.18);border:1px solid rgba(13,148,136,0.4)'
            : 'background:rgba(255,255,255,0.28);border:1px solid rgba(255,255,255,0.4)';
        var defaultBg = lightTheme
            ? 'background:rgba(13,148,136,0.15);border:none'
            : 'background:rgba(255,255,255,0.2);border:none';
        expandBtn.style.cssText = 'position:absolute;top:50%;right:8px;transform:translateY(-50%);width:' +
            (pulseStrong ? '42px;height:42px' : '32px;height:32px') +
            ';border-radius:6px;color:' + btnText + ';font-size:' +
            (pulseStrong ? '1.6em' : '1.2em') +
            ';cursor:pointer;' +
            (pulseStrong
                ? 'background:#f59e0b;border:3px solid #fbbf24;animation:hindus-pulse-strong 1.1s ease-in-out infinite'
                : (pulseSubtle
                    ? pulseSubtleBg + ';animation:hindus-pulse-subtle 1.8s ease-in-out infinite'
                    : defaultBg));
        expandBtn.onclick = function() {
            self._arrowClicked = true;
            self._tagBarExpanded = !self._tagBarExpanded;
            self._renderTagBar();
        };
        bar.appendChild(expandBtn);

        document.body.appendChild(bar);
    }
};
