// App — slim orchestrator for Plonter v4

// Global singletons
var state;
var persistence;

// Shared unsaved-changes confirmation dialog
function showUnsavedDialog(message, onConfirm) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    var box = document.createElement('div');
    box.style.cssText = 'background:white;border-radius:16px;padding:24px 28px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;direction:rtl';
    box.innerHTML =
        '<div style="font-size:2em;margin-bottom:8px">⚠️</div>' +
        '<div style="font-size:1.1em;font-weight:bold;margin-bottom:6px;color:#1a1a1a">בטוח שאתה רוצה לצאת?</div>' +
        '<div style="font-size:0.9em;color:#6b7280;margin-bottom:20px">' + message + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:center">' +
            '<button id="usd-cancel" style="flex:1;padding:10px 16px;background:#0d9488;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">✏️ המשך לעבוד</button>' +
            '<button id="usd-confirm" style="flex:1;padding:10px 16px;background:#ef4444;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">🚪 צא בכל זאת</button>' +
        '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('usd-cancel').onclick = function() { overlay.remove(); };
    document.getElementById('usd-confirm').onclick = function() { overlay.remove(); onConfirm(); };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}

// dialogManager.js is not script-tagged in index.html on the clone build, so
// DialogManager is undefined and DialogManager.show(...) throws — which silently
// broke deleting a roof that has an alternative, and the long-press info dialog
// (Amitai 2026-06-06: "clicked, nothing responded"). Load it dynamically so the
// global is defined without needing an index.html edit.
function ensureDialogManager() {
    if (typeof DialogManager !== 'undefined') return;
    if (document.getElementById('dialogmanager-script')) return;
    const sc = document.createElement('script');
    sc.id = 'dialogmanager-script';
    sc.src = 'js/dialogManager.js?v=dyn1';
    document.head.appendChild(sc);
}

// Inject the 3 translation/notes fields below the sentence (Amitai 2026-06-06).
// State + per-analysis persistence already exist (state.literalTranslation /
// polishedTranslation / analysisNotes, saved per stage+analysis); this adds the
// missing UI so each sentence/attempt keeps its own text and auto-saves.
function ensureTranslationSection() {
    if (document.getElementById('translation-section')) return;
    const sc = document.getElementById('sentence-container');
    if (!sc) return;
    const anchor = sc.closest('.sentence-section') || sc.parentElement;
    if (!anchor || !anchor.parentElement) return;

    if (!document.getElementById('translation-section-style')) {
        const st = document.createElement('style');
        st.id = 'translation-section-style';
        st.textContent = `
            .translation-section { display:flex; flex-direction:column; gap:10px;
                margin:14px auto 0; max-width:820px; padding:0 12px; }
            .translation-field { display:flex; flex-direction:column; gap:4px; }
            .translation-field label { font-size:0.85rem; font-weight:700; color:#0d9488;
                text-align:right; }
            .translation-field textarea { width:100%; box-sizing:border-box; resize:vertical;
                min-height:42px; padding:8px 10px; border:1.5px solid #99f6e4; border-radius:10px;
                font-family:inherit; font-size:0.95rem; line-height:1.5; direction:rtl;
                text-align:right; background:#f0fdfa; color:#134e4a; }
            .translation-field textarea:focus { outline:none; border-color:#0d9488;
                background:#fff; box-shadow:0 0 0 3px rgba(13,148,136,0.12); }
            .translation-field textarea::placeholder { color:#5eead4; }
        `;
        document.head.appendChild(st);
    }

    const sec = document.createElement('section');
    sec.id = 'translation-section';
    sec.className = 'translation-section';
    sec.style.display = 'none';
    sec.innerHTML = `
        <div class="translation-field">
            <label for="literal-translation">תרגום מילולי</label>
            <textarea id="literal-translation" rows="2" placeholder="תרגום מילה-במילה של המשפט"></textarea>
        </div>
        <div class="translation-field">
            <label for="polished-translation">תרגום משופצר</label>
            <textarea id="polished-translation" rows="2" placeholder="תרגום חופשי ומלוטש"></textarea>
        </div>
        <div class="translation-field">
            <label for="analysis-notes">מה שהבנת מהמשפט</label>
            <textarea id="analysis-notes" rows="2" placeholder="ההבנה שלך מהמשפט"></textarea>
        </div>`;
    anchor.parentElement.insertBefore(sec, anchor.nextSibling);
}

// #1242 (Amitai): shrink the "בחר חלק דיבר" (POS) modal on desktop so it matches
// the compact syntactic-roles modal (default .modal-content ~500px) instead of the
// 1100px single-row wide layout. Injected here (head <style>) rather than editing
// modals.js; the selector adds a `body` prefix so it out-specifies the modal's own
// scoped #pos-modal style block regardless of DOM order. Scoped to desktop
// (≥521px) — modals.js already provides a 2-col phone layout below 520px.
function ensurePosModalCompact() {
    if (document.getElementById('pos-modal-compact-style')) return;
    const st = document.createElement('style');
    st.id = 'pos-modal-compact-style';
    st.textContent = `
        @media (min-width: 521px) {
            body #pos-modal .modal-content.pos-modal-wide {
                max-width: 500px;
                width: 90%;
            }
            /* narrow modal -> wrap buttons into a 2-col grid, no horizontal scroll */
            body #pos-modal .pos-type-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                overflow-x: visible;
                gap: 8px;
            }
            body #pos-modal .pos-type-btn {
                min-width: 0;
                flex: none;
            }
        }
    `;
    document.head.appendChild(st);
}

function init() {
    // Ensure DialogManager is available (delete-with-alternative + info dialogs)
    ensureDialogManager();

    // Initialize state manager
    state = new StateManager();

    // Initialize modules
    Renderer.init(state);
    ArchSystem.init(state);
    DetailsPanel.init(state);
    Modals.init(state);
    ModelValidation.init(state);
    Annotations.init(state);
    MessageManager.init();

    // Initialize persistence (localStorage)
    persistence = new PersistenceManager(state);

    // Initialize auth
    if (typeof PlonterAuth !== 'undefined') PlonterAuth.init();

    // Build the 3 translation/notes fields below the sentence (Amitai 2026-06-06).
    // Injected from JS so it lives on every sentence without editing index.html.
    ensureTranslationSection();

    // Shrink the POS modal on desktop to match the roles modal (#1242)
    ensurePosModalCompact();

    // Wire state changes to re-render
    state.on('stateChanged', (detail) => {
        // Sync translation fields from state when a sentence loads (saved OR fresh)
        if (detail && (detail.action === 'loaded' || detail.action === 'loadSentence')) {
            const litEl = document.getElementById('literal-translation');
            const polEl = document.getElementById('polished-translation');
            const notesEl = document.getElementById('analysis-notes');
            if (litEl) litEl.value = state.literalTranslation || '';
            if (polEl) polEl.value = state.polishedTranslation || '';
            if (notesEl) notesEl.value = state.analysisNotes || '';
            // Show translation section when a sentence is loaded
            const transSec = document.getElementById('translation-section');
            if (transSec) transSec.style.display = state.words && state.words.length > 0 ? '' : 'none';
        }
    });

    // Translation fields — save to state on input
    const litInput = document.getElementById('literal-translation');
    const polInput = document.getElementById('polished-translation');
    if (litInput) litInput.addEventListener('input', () => { state.literalTranslation = litInput.value; state.emit('stateChanged', { action: 'translation' }); });
    if (polInput) polInput.addEventListener('input', () => { state.polishedTranslation = polInput.value; state.emit('stateChanged', { action: 'translation' }); });
    const notesInput = document.getElementById('analysis-notes');
    if (notesInput) notesInput.addEventListener('input', () => { state.analysisNotes = notesInput.value; state.emit('stateChanged', { action: 'translation' }); });

    // Setup event listeners
    setupEventListeners();

    // Re-draw the SVG overlays (combination lines + roofs) once web fonts finish
    // loading and on window load. The Arabic font loads AFTER the initial render
    // and resizes the word boxes, so lines + POS-tag borders computed earlier land
    // misaligned until a manual re-render (Amitai 2026-06-06: "ruined the design",
    // recovered only after reconnecting words). This re-settles them automatically.
    const _resettleOverlays = () => {
        if (state && state.words && state.words.length && typeof Renderer !== 'undefined') {
            Renderer.renderAll();
        }
    };
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(_resettleOverlays);
    }
    window.addEventListener('load', _resettleOverlays);

    // Check for ?analyze= URL parameter (from presentation)
    const urlParams = new URLSearchParams(window.location.search);
    const analyzeText = urlParams.get('analyze');
    if (analyzeText) {
        const returnTo = urlParams.get('returnTo');
        const slide = urlParams.get('slide');
        // Create a temporary stage and load it directly
        const stage = {
            id: 'analyze_' + Date.now(),
            sentence: analyzeText,
            category: 'ניתוח מהמצגת'
        };
        state.loadSentence(stage);
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
        Annotations.loadForStage();
        Renderer.renderAll();
        // Add return button if returnTo is set
        if (returnTo) {
            const returnUrl = returnTo + (slide ? '?slide=' + slide : '');
            const backBtn = document.getElementById('back-to-menu-btn');
            if (backBtn) {
                backBtn.textContent = '← חזרה למצגת';
                backBtn.onclick = function(e) {
                    e.preventDefault();
                    window.location.href = returnUrl;
                };
            }
        }
    } else {
        // Check for shared lesson URL or auto-import
        var _urlParams = new URLSearchParams(window.location.search);
        var lessonParam = _urlParams.get('lesson');
        var importParam = _urlParams.get('import_json');
        var shareTextParam = _urlParams.get('shareText');
        if (shareTextParam && typeof PlonterTexts !== 'undefined' &&
            typeof PlonterTexts.checkSharedTextOnLoad === 'function' &&
            PlonterTexts.checkSharedTextOnLoad()) {
            // Shared text imported into "משותפים" and opened in the editor.
        } else if ((lessonParam || importParam) && typeof LessonManager !== 'undefined') {
            LessonManager.checkSharedLessonURL();
        } else if (!tryRestoreLastPosition()) {
            // Render welcome screen — default to lessons tab
            Modals.renderStages();
            switchWelcomeTab('lessons');
        }
    }
}

function tryRestoreLastPosition() {
    try {
        var lastStageId = localStorage.getItem('plonter_lastStageId');
        if (!lastStageId) return false;
        if (typeof getStageById !== 'function') return false;
        var stage = getStageById(lastStageId) || getStageById(parseInt(lastStageId, 10));
        if (!stage) return false;
        if (typeof Modals === 'undefined' || !Modals._startStage) return false;
        Modals.renderStages();
        Modals._startStage(stage);
        var lastMode = localStorage.getItem('plonter_lastMode');
        var idxRaw = localStorage.getItem('plonter_lastAnalysisIndex');
        if (lastMode === 'syntax' && idxRaw !== null && typeof state !== 'undefined' && state.switchAnalysis) {
            var idx = parseInt(idxRaw, 10);
            if (idx >= 0 && idx <= 3) {
                setTimeout(function() { try { state.switchAnalysis(idx); } catch (e) {} }, 0);
            }
        }
        return true;
    } catch (e) {
        console.warn('position restore failed:', e);
        return false;
    }
}

function setupEventListeners() {
    // Delete mode button
    const deleteBtn = document.getElementById('delete-mode-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            state.setDeleteMode(!state.deleteMode);
            updateModeButtons();
            Renderer.renderAll();
        });
    }

    // Undo/Redo buttons — route to hindus when active, else to analysis state
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            if (typeof HindusMode !== 'undefined' && HindusMode.isActive && HindusMode.isActive()) {
                if (HindusMode._undo()) {
                    MessageManager.show('בוטל', 'info', 1500);
                    SoundManager.playUndo();
                }
                return;
            }
            if (state.undo()) {
                MessageManager.show('בוטל', 'info', 1500);
                SoundManager.playUndo();
                Renderer.renderAll();
            }
        });
    }
    const redoBtn = document.getElementById('redo-btn');
    if (redoBtn) {
        redoBtn.addEventListener('click', () => {
            if (typeof HindusMode !== 'undefined' && HindusMode.isActive && HindusMode.isActive()) {
                if (HindusMode._redo()) {
                    MessageManager.show('שוחזר', 'info', 1500);
                }
                return;
            }
            if (state.redo()) {
                MessageManager.show('שוחזר', 'info', 1500);
                Renderer.renderAll();
            }
        });
    }

    // Back to menu — no confirmation needed anymore, hindus auto-saves to
    // localStorage on every snapshot (Amitai 2026-04-19). Clears any stored
    // "last position" so a subsequent refresh lands on welcome, not back into
    // the stage the user just left.
    // Exception: when HindusMode is paused in analysis mode (_savedHindusState
    // true), the button shows "⬅ חזור להינדוס" and HindusMode owns the
    // click handler — we must NOT fall through to the welcome screen here.
    const backBtn = document.getElementById('back-to-menu-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (typeof HindusMode !== 'undefined' && HindusMode._savedHindusState) return;
            // #1161 (Amitai via @6m 2026-06-06): when leaving a hindus stage back to
            // the list, record the exited stage (must run BEFORE deactivate, which
            // clears _active) so the list highlights it + smooth-scrolls to center
            // instead of jumping to the top. prepareReturnHighlight() is owned by
            // hindusMode.js; the render-side recipe lives in modals.js (@3).
            var rf = false;
            if (typeof HindusMode !== 'undefined' && HindusMode.isActive && HindusMode.isActive()
                && typeof HindusMode.prepareReturnHighlight === 'function') {
                rf = HindusMode.prepareReturnHighlight();
            }
            try {
                localStorage.removeItem('plonter_lastStageId');
                localStorage.removeItem('plonter_lastMode');
                localStorage.removeItem('plonter_lastAnalysisIndex');
                localStorage.removeItem('plonter_lastPositionSavedAt');
            } catch (e) {}
            document.getElementById('welcome-screen').style.display = '';
            document.getElementById('game-screen').style.display = 'none';
            if (typeof HindusMode !== 'undefined') HindusMode.deactivate();
            // #1161: skip the jump-to-top when returning to a specific hindus stage;
            // the highlight applier smooth-scrolls the exited card to center.
            if (rf && typeof Modals !== 'undefined' && Modals._applyPendingStageHighlight) {
                Modals._applyPendingStageHighlight();
            } else {
                window.scrollTo(0, 0);
            }
        });
    }

    // Stage search
    const searchInput = document.getElementById('stage-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            Modals.filterStages(e.target.value);
        });
        // Ctrl+G — convert Hebrew to Arabic transliteration
        searchInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                searchInput.value = DetailsPanel._convertHebrewToArabic(searchInput.value);
                Modals.filterStages(searchInput.value);
            }
        });
    }
    // א→ع button for stage search
    const stageHeb2arBtn = document.getElementById('stage-heb2ar-btn');
    if (stageHeb2arBtn && searchInput) {
        stageHeb2arBtn.addEventListener('click', () => {
            searchInput.value = DetailsPanel._convertHebrewToArabic(searchInput.value);
            Modals.filterStages(searchInput.value);
            searchInput.focus();
        });
    }

    // Text action: paste text → choose action
    const textActionInput = document.getElementById('text-action-input');
    const textActionButtons = document.getElementById('text-action-buttons');
    if (textActionInput && textActionButtons) {
        textActionInput.addEventListener('input', () => {
            textActionButtons.style.display = textActionInput.value.trim() ? 'flex' : 'none';
        });
        // Ctrl+G on text action input
        textActionInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                textActionInput.value = DetailsPanel._convertHebrewToArabic(textActionInput.value);
                textActionButtons.style.display = textActionInput.value.trim() ? 'flex' : 'none';
            }
        });
        textActionButtons.querySelectorAll('.text-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = textActionInput.value.trim();
                if (!text) return;
                const action = btn.dataset.action;
                if (action === 'analyze') {
                    // Create temp stage and start analysis
                    const sentenceClean = stripArabicDiacritics(text);
                    const hasDiacritics = sentenceClean !== text;
                    const stage = {
                        id: 'quick_' + Date.now(),
                        number: sentenceClean.substring(0, 30),
                        sentence: sentenceClean,
                        category: 'ניתוח מהיר',
                        isCustom: false
                    };
                    if (hasDiacritics) stage.diacritizedSentence = text;
                    state.loadSentence(stage);
                    document.getElementById('welcome-screen').style.display = 'none';
                    document.getElementById('game-screen').style.display = 'block';
                    Annotations.loadForStage();
                    Renderer.renderAll();
                } else if (action === 'diacritics') {
                    // Create temp stage, start it, then reveal all diacritics
                    const stage = {
                        id: 'diac_' + Date.now(),
                        number: stripArabicDiacritics(text).substring(0, 30),
                        sentence: stripArabicDiacritics(text),
                        category: 'חשיפת ניקוד',
                        diacritizedSentence: text
                    };
                    state.loadSentence(stage);
                    document.getElementById('welcome-screen').style.display = 'none';
                    document.getElementById('game-screen').style.display = 'block';
                    Annotations.loadForStage();
                    Renderer.renderAll();
                    // Reveal diacritics on all words
                    if (typeof Annotations !== 'undefined' && Annotations.revealAllDiacritics) {
                        setTimeout(() => Annotations.revealAllDiacritics(), 200);
                    }
                } else if (action === 'dictionary') {
                    Dictionary.openStandalone();
                    setTimeout(() => {
                        const dictInput = document.querySelector('#dict-search-input');
                        if (dictInput) {
                            dictInput.value = text;
                            Dictionary._search(text);
                        }
                    }, 200);
                } else if (action === 'slide') {
                    // Save as custom presentation slide
                    const slides = JSON.parse(localStorage.getItem('plonter_custom_slides') || '[]');
                    const slide = {
                        id: 'slide_' + Date.now(),
                        text: text,
                        title: stripArabicDiacritics(text).substring(0, 40),
                        created: new Date().toISOString()
                    };
                    slides.push(slide);
                    localStorage.setItem('plonter_custom_slides', JSON.stringify(slides));
                    textActionInput.value = '';
                    textActionButtons.style.display = 'none';
                    MessageManager.show('השקופית נשמרה בשיעורים', 'success');
                    // Switch to lessons tab
                    switchWelcomeTab('lessons');
                }
            });
        });
    }

    // Lesson buttons
    const createLessonBtn = document.getElementById('create-lesson-btn');
    if (createLessonBtn) createLessonBtn.addEventListener('click', () => LessonManager.showCreateDialog());
    const importLessonBtn = document.getElementById('import-lesson-btn');
    if (importLessonBtn) importLessonBtn.addEventListener('click', () => LessonManager.showImportDialog());
    const syncLessonsBtn = document.getElementById('sync-lessons-btn');
    if (syncLessonsBtn) syncLessonsBtn.addEventListener('click', () => {
        if (typeof PlonterAuth !== 'undefined' && PlonterAuth.isLoggedIn()) {
            LessonManager.syncToServer();
        } else {
            PlonterAuth.showLoginDialog(function() { LessonManager.syncToServer(); });
        }
    });

    // #26: Create new sentence button
    const addSentenceBtn = document.getElementById('add-sentence-btn');
    if (addSentenceBtn) {
        addSentenceBtn.addEventListener('click', () => Modals.showCreateSentenceDialog());
    }

    // Hindus: Create new hindus sentence button
    const addHindusBtn = document.getElementById('add-hindus-btn');
    if (addHindusBtn) {
        addHindusBtn.addEventListener('click', () => Modals.showCreateHindusSentenceDialog());
    }

    // Details panel buttons
    const saveBtn = document.getElementById('save-details-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => DetailsPanel.save());
    const closeBtn = document.querySelector('.close-panel-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => DetailsPanel.close());

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Close modals on outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('show');
        }
    });

    // Close modal close buttons
    document.querySelectorAll('.modal .close').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').classList.remove('show');
        });
    });
}

function handleKeyDown(e) {
    // Skip Ctrl+Z/Y in editable elements — let browser handle native undo/redo
    var _ae = document.activeElement;
    var _inEditable = _ae && (_ae.isContentEditable || _ae.tagName === 'INPUT' || _ae.tagName === 'TEXTAREA');

    // Ctrl+Z — undo (hindus takes priority when active; then annotations; then analysis)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.code === 'KeyZ') && !e.shiftKey) {
        if (typeof HindusMode !== 'undefined' && HindusMode.isActive && HindusMode.isActive()) {
            e.preventDefault();
            if (_ae && _ae.blur) _ae.blur();
            HindusMode._undo();
            return;
        }
        if (_inEditable && !Annotations.isAnnotationModeActive()) return; // let browser undo
        e.preventDefault();
        if (Annotations.isAnnotationModeActive()) {
            if (Annotations.undoAnnotation()) {
                MessageManager.show('בוטל (ציור/סימון)', 'info', 1500);
                SoundManager.playUndo();
            }
        } else if (state.undo()) {
            MessageManager.show('בוטל', 'info', 1500);
            SoundManager.playUndo();
            Renderer.renderAll();
        }
        return;
    }

    // Ctrl+Y or Ctrl+Shift+Z — redo (hindus first; then annotations; then analysis)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.code === 'KeyY' || ((e.key === 'z' || e.code === 'KeyZ') && e.shiftKey))) {
        if (typeof HindusMode !== 'undefined' && HindusMode.isActive && HindusMode.isActive()) {
            e.preventDefault();
            if (_ae && _ae.blur) _ae.blur();
            HindusMode._redo();
            return;
        }
        if (_inEditable && !Annotations.isAnnotationModeActive()) return; // let browser redo
        e.preventDefault();
        if (Annotations.isAnnotationModeActive()) {
            if (Annotations.redoAnnotation()) {
                MessageManager.show('שוחזר (ציור/סימון)', 'info', 1500);
            }
        } else if (state.redo()) {
            MessageManager.show('שוחזר', 'info', 1500);
            Renderer.renderAll();
        }
        return;
    }

    // D key — temporary delete mode (Amitai #8, #37: works in ALL keyboard languages)
    if (e.code === 'KeyD') {
        // Don't activate if typing in an input or a modal is open
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (document.querySelector('.modal.show')) return;
        if (document.querySelector('.details-panel.show')) return;
        if (!state.deleteMode) {
            state.setDeleteMode(true);
            updateModeButtons();
            Renderer.renderAll();
        }
        return;
    }

    // Escape — cancel current action
    if (e.key === 'Escape') {
        if (state.firstArchClick) {
            state.firstArchClick = null;
            state.archCreationMode = false;
            Renderer.renderAll();
        }
        if (state.deleteMode) {
            state.setDeleteMode(false);
            updateModeButtons();
            Renderer.renderAll();
        }
        // Deselect POS tags
        document.querySelectorAll('.part-tag.selected').forEach(t => t.classList.remove('selected'));
    }
}

function handleKeyUp(e) {
    // D key release — exit delete mode (Amitai #8, #37: works in ALL keyboard languages)
    if (e.code === 'KeyD') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (state.deleteMode) {
            state.setDeleteMode(false);
            updateModeButtons();
            Renderer.renderAll();
        }
    }
}

function updateModeButtons() {
    const deleteBtn = document.getElementById('delete-mode-btn');
    if (deleteBtn) deleteBtn.classList.toggle('active', state.deleteMode);
}

function switchWelcomeTab(mode) {
    if (mode !== 'tasks') window.__plonterLastWelcomeTab = mode;
    if (mode === 'tasks' && !(typeof PlonterAdmin !== 'undefined' && PlonterAdmin.isDragon && PlonterAdmin.isDragon())) {
        mode = window.__plonterLastWelcomeTab || 'lessons';
    }

    var tabs = ['lessons', 'analysis', 'hindus', 'texts', 'media', 'tasks', 'admin'];
    var colors = { lessons: '#2563eb', analysis: '#0d9488', hindus: '#f59e0b', texts: '#0d9488', media: '#7c3aed', tasks: '#334155', admin: '#dc2626' };
    var activeColor = colors[mode] || '#0d9488';

    // Update tab styling
    tabs.forEach(function(tab) {
        var el = document.getElementById('tab-' + tab);
        if (!el) return;
        if (tab === mode) {
            el.style.background = activeColor;
            el.style.borderColor = activeColor;
            el.style.color = 'white';
        } else {
            el.style.background = 'white';
            el.style.borderColor = '#0d9488';
            el.style.color = '#0d9488';
        }
    });

    // Show/hide buttons
    var lessonsButtons = document.getElementById('lessons-buttons');
    var analysisButtons = document.getElementById('analysis-buttons');
    var hindusButtons = document.getElementById('hindus-buttons');
    var textsButtons = document.getElementById('texts-buttons');
    if (lessonsButtons) lessonsButtons.style.display = (mode === 'lessons') ? 'flex' : 'none';
    if (analysisButtons) analysisButtons.style.display = (mode === 'analysis') ? 'flex' : 'none';
    if (hindusButtons) hindusButtons.style.display = (mode === 'hindus') ? 'flex' : 'none';
    if (textsButtons) textsButtons.style.display = (mode === 'texts') ? 'flex' : 'none';

    // Show/hide sections
    var sectionTypes = ['analysis-section-welcome', 'hindus-section-welcome', 'lessons-section-welcome', 'dictionary-section-welcome', 'texts-section-welcome', 'media-section-welcome', 'tasks-section-welcome'];
    var sectionMap = { analysis: 'analysis-section-welcome', hindus: 'hindus-section-welcome', lessons: 'lessons-section-welcome', texts: 'texts-section-welcome', media: 'media-section-welcome', tasks: 'tasks-section-welcome' };
    var activeSection = sectionMap[mode];

    sectionTypes.forEach(function(sectionClass) {
        document.querySelectorAll('.' + sectionClass).forEach(function(el) {
            if (sectionClass === activeSection) {
                if (el.id === 'custom-section') return; // custom section managed by renderStages
                el.style.display = '';
            } else {
                el.style.display = 'none';
            }
        });
    });

    // Render lessons list when lessons tab is shown
    if (mode === 'lessons') {
        LessonManager.renderLessonsList();
        LessonManager.renderDemoLessons();
    }
    // Render texts list when texts tab is shown
    if (mode === 'texts' && typeof PlonterTexts !== 'undefined') {
        PlonterTexts.renderList();
    }
    if ((mode === 'analysis' || mode === 'hindus') &&
        typeof Modals !== 'undefined' &&
        typeof Modals.renderStages === 'function' &&
        !window.__plonterRenderingStages) {
        try {
            window.__plonterRenderingStages = true;
            Modals.renderStages();
        } finally {
            window.__plonterRenderingStages = false;
        }
    }
    // Render media storage when media tab is shown
    if (mode === 'media' && typeof MediaStorage !== 'undefined') {
        MediaStorage.renderMediaTab();
    }
    if (mode === 'tasks' && typeof PlonterTasksPanel !== 'undefined') {
        PlonterTasksPanel.open(window.__plonterLastWelcomeTab || 'lessons');
    }

    // Admin panel
    var adminPanel = document.getElementById('admin-panel');
    if (adminPanel) {
        if (mode === 'admin') {
            adminPanel.style.display = 'block';
            if (typeof AdminPanel !== 'undefined') AdminPanel.loadUsers();
        } else {
            adminPanel.style.display = 'none';
        }
    }
}

// Render custom slides in presentations tab
function renderCustomSlides() {
    let container = document.getElementById('custom-slides-list');
    if (!container) {
        // Create container after existing presentations
        const presSection = document.querySelector('.presentations-section-welcome');
        if (!presSection) return;
        const section = document.createElement('div');
        section.className = 'category-section presentations-section-welcome';
        section.innerHTML = '<h2 class="category-title">שקופיות שלי</h2>';
        container = document.createElement('div');
        container.id = 'custom-slides-list';
        container.className = 'stages-list';
        section.appendChild(container);
        presSection.parentNode.insertBefore(section, presSection.nextSibling);
    }
    const slides = JSON.parse(localStorage.getItem('plonter_custom_slides') || '[]');
    container.innerHTML = '';
    if (slides.length === 0) {
        container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:12px">אין שקופיות עדיין. הדבק טקסט למעלה ולחץ 🎞️ שקופית.</p>';
        return;
    }
    slides.forEach(function(slide) {
        const item = document.createElement('div');
        item.className = 'stage-item';
        item.style.cursor = 'pointer';
        item.innerHTML = '<div class="stage-number" style="font-size:0.85em;color:#8b5cf6">' + new Date(slide.created).toLocaleDateString('he-IL') + '</div>' +
            '<div class="stage-sentence" style="font-family:Arial,serif;font-size:1.1em">' + slide.text + '</div>';
        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'stage-delete-btn';
        delBtn.innerHTML = '🗑️';
        delBtn.title = 'מחק שקופית';
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('למחוק את השקופית?')) {
                const all = JSON.parse(localStorage.getItem('plonter_custom_slides') || '[]');
                const filtered = all.filter(function(s) { return s.id !== slide.id; });
                localStorage.setItem('plonter_custom_slides', JSON.stringify(filtered));
                renderCustomSlides();
            }
        });
        item.appendChild(delBtn);
        // Click to analyze
        item.addEventListener('click', function() {
            const stage = {
                id: slide.id,
                number: slide.title,
                sentence: stripArabicDiacritics(slide.text),
                category: 'שקופית',
                diacritizedSentence: slide.text !== stripArabicDiacritics(slide.text) ? slide.text : undefined
            };
            state.loadSentence(stage);
            document.getElementById('welcome-screen').style.display = 'none';
            document.getElementById('game-screen').style.display = 'block';
            Annotations.loadForStage();
            Renderer.renderAll();
        });
        container.appendChild(item);
    });
}

// Prevent accidental tab close when editing (Ctrl+W, etc.)
window.addEventListener('beforeunload', function(e) {
    var gameScreen = document.getElementById('game-screen');
    var hasAnalysisChanges = (gameScreen && gameScreen.style.display !== 'none') &&
        (typeof state !== 'undefined' && state.undoStack && state.undoStack.length > 0);
    // Media uploads and content backups have their own active-operation guards.
    // Do not warn just because an editor/viewer element exists in the DOM.
    if (hasAnalysisChanges) { e.preventDefault(); e.returnValue = ''; }
});

// Global Ctrl+G handler for contenteditable elements — Hebrew to Arabic transliteration.
// Works with selection (converts selected text) and without (converts word behind cursor).
// Uses e.code for keyboard-language independence.
// Uses document.execCommand('insertText', ...) so the conversion participates in the
// browser's native undo stack — Ctrl+Z reverses Ctrl+G in one step (Amitai 2026-05-13).
document.addEventListener('keydown', function(e) {
    if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyG') return;
    var el = document.activeElement;
    if (!el || !el.isContentEditable) return;
    if (typeof DetailsPanel === 'undefined' || !DetailsPanel._convertHebrewToArabic) return;
    e.preventDefault();

    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    if (!sel.isCollapsed) {
        var txt = sel.toString();
        var converted = DetailsPanel._convertHebrewToArabic(txt);
        if (converted === txt) return;
        document.execCommand('insertText', false, converted);
    } else {
        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        if (node.nodeType !== 3) return;
        var text = node.textContent;
        var pos = range.startOffset;
        // Scan backward: skip spaces (not newlines)
        var end = pos;
        while (end > 0 && text[end - 1] === ' ') end--;
        if (end === 0) return;
        var start = end;
        while (start > 0 && text[start - 1] !== ' ' && text[start - 1] !== '\n' && text[start - 1] !== '\r') start--;
        if (start === end) return;
        var word = text.slice(start, end);
        var converted = DetailsPanel._convertHebrewToArabic(word);
        if (converted === word) return;
        // Select the word, then replace via execCommand so the change becomes a
        // single undoable step.
        var wordRange = document.createRange();
        wordRange.setStart(node, start);
        wordRange.setEnd(node, end);
        sel.removeAllRanges();
        sel.addRange(wordRange);
        document.execCommand('insertText', false, converted);
    }
});

// Global Ctrl+Q / Ctrl+W handler — open dictionary with selected word.
// Long-press (key auto-repeats while held) closes the dictionary if it was
// already open at the moment the press cycle started.
var _ctrlDictWasOpen = false;
document.addEventListener('keydown', function(e) {
    if (!(e.ctrlKey || e.metaKey) || (e.code !== 'KeyQ' && e.code !== 'KeyW')) return;
    if (typeof Dictionary === 'undefined') return;
    e.preventDefault();
    var dictIsOpen = !!(Dictionary._panel && Dictionary._panel.classList.contains('show'));
    if (e.repeat) {
        if (_ctrlDictWasOpen && dictIsOpen) {
            Dictionary._hidePanel();
            _ctrlDictWasOpen = false;
        }
        return;
    }
    _ctrlDictWasOpen = dictIsOpen;
    var ARABIC_RE = /[\u0600-\u064A\u066E-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u064B-\u065F\u0670]/;
    var selectedText = '';
    // First check form input selection (e.g. hindus mode arabic rects)
    var activeEl = e.target || document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        var val = activeEl.value || '';
        var ss = activeEl.selectionStart || 0;
        var se = activeEl.selectionEnd || 0;
        if (se > ss) {
            selectedText = val.substring(ss, se).trim();
        } else if (val) {
            // No selection — grab word at cursor
            var start = ss, end = ss;
            while (start > 0 && ARABIC_RE.test(val[start - 1])) start--;
            while (end < val.length && ARABIC_RE.test(val[end])) end++;
            if (end > start) selectedText = val.slice(start, end).trim();
        }
    }
    // Fall back to document selection
    if (!selectedText) {
        var sel = window.getSelection();
        selectedText = (sel && !sel.isCollapsed) ? sel.toString().trim() : '';
        if (!selectedText && sel && sel.rangeCount) {
            var range = sel.getRangeAt(0);
            var node = range.startContainer;
            if (node.nodeType === 3) {
                var text = node.textContent;
                var pos = range.startOffset;
                var start2 = pos, end2 = pos;
                while (start2 > 0 && ARABIC_RE.test(text[start2 - 1])) start2--;
                while (end2 < text.length && ARABIC_RE.test(text[end2])) end2++;
                if (end2 > start2) selectedText = text.slice(start2, end2).trim();
            }
        }
    }
    // Strip diacritics for cleaner search
    if (selectedText) {
        selectedText = selectedText.replace(/[\u064B-\u065F\u0670]/g, '');
        Dictionary.lookup(selectedText);
    } else {
        Dictionary.openStandalone();
    }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
