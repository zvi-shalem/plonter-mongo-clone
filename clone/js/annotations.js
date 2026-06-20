// Annotations — drawing canvas + text highlighting for Plonter v4.4

const Annotations = {
    _state: null,
    _canvas: null,
    _ctx: null,
    _drawing: false,
    _drawMode: false,
    _highlightMode: false,
    _translateMode: false,
    _openEndedMode: false,
    _diacriticsMode: false,
    _revealedWords: {},  // wordId -> true (diacritics shown)
    _currentColor: '#ef4444',  // red default
    _lineWidth: 2,
    _paths: [],       // stored drawing paths
    _currentPath: null,
    _highlightColors: {},  // wordId -> color
    _undoStack: [],   // undo stack for annotations (#26)
    _redoStack: [],

    COLORS: [
        { name: 'שחור', value: '#1e293b' },
        { name: 'אדום', value: '#ef4444' },
        { name: 'כחול', value: '#3b82f6' },
        { name: 'ירוק', value: '#22c55e' },
        { name: 'כתום', value: '#f97316' },
        { name: 'סגול', value: '#8b5cf6' },
        { name: 'ורוד', value: '#ec4899' },
    ],

    init(stateManager) {
        this._state = stateManager;
        this._loadFromStorage();
    },

    // --- Undo/redo for annotations (#26) ---
    _snapshotAnnotations() {
        this._undoStack.push({
            paths: JSON.parse(JSON.stringify(this._paths)),
            highlights: JSON.parse(JSON.stringify(this._highlightColors)),
            revealed: JSON.parse(JSON.stringify(this._revealedWords))
        });
        if (this._undoStack.length > 50) this._undoStack.shift();
        this._redoStack = [];
    },

    undoAnnotation() {
        if (this._undoStack.length === 0) return false;
        this._redoStack.push({
            paths: JSON.parse(JSON.stringify(this._paths)),
            highlights: JSON.parse(JSON.stringify(this._highlightColors)),
            revealed: JSON.parse(JSON.stringify(this._revealedWords))
        });
        const snap = this._undoStack.pop();
        this._paths = snap.paths;
        this._highlightColors = snap.highlights;
        this._revealedWords = snap.revealed || {};
        this._saveToStorage();
        if (this._drawMode) this._redrawPaths();
        this.applyHighlights();
        this._applyDiacriticsReveal();
        return true;
    },

    redoAnnotation() {
        if (this._redoStack.length === 0) return false;
        this._undoStack.push({
            paths: JSON.parse(JSON.stringify(this._paths)),
            highlights: JSON.parse(JSON.stringify(this._highlightColors)),
            revealed: JSON.parse(JSON.stringify(this._revealedWords))
        });
        const snap = this._redoStack.pop();
        this._paths = snap.paths;
        this._highlightColors = snap.highlights;
        this._revealedWords = snap.revealed || {};
        this._saveToStorage();
        if (this._drawMode) this._redrawPaths();
        this.applyHighlights();
        this._applyDiacriticsReveal();
        return true;
    },

    // Re-apply diacritics reveal state after undo/redo
    _applyDiacriticsReveal() {
        const s = this._state;
        const stage = s.currentStageId ? getStageById(s.currentStageId) : null;
        if (!stage || !stage.diacritizedSentence) return;
        const diacWords = stage.diacritizedSentence.split(/\s+/).filter(w => w.trim());
        s.words.forEach((word, idx) => {
            const textEl = document.querySelector(`[data-word-id="${word.id}"] .word-text`);
            if (!textEl) return;
            if (this._revealedWords[word.id] && diacWords[idx]) {
                textEl.textContent = diacWords[idx];
                textEl.classList.add('diacritics-revealed');
            } else {
                textEl.textContent = word.text;
                textEl.classList.remove('diacritics-revealed');
            }
        });
    },

    // Are we in any annotation mode that should use annotation undo?
    isAnnotationModeActive() {
        return this._drawMode || this._highlightMode || this._diacriticsMode;
    },

    // === TOOLBAR ===

    renderToolbar() {
        let toolbar = document.getElementById('annotations-toolbar');
        if (toolbar) toolbar.remove();

        toolbar = document.createElement('div');
        toolbar.id = 'annotations-toolbar';
        toolbar.className = 'annotations-toolbar';

        // Draw toggle
        const drawBtn = document.createElement('button');
        drawBtn.className = 'btn btn-secondary annotation-tool-btn' + (this._drawMode ? ' active' : '');
        drawBtn.textContent = 'צייר';
        drawBtn.title = 'מצב ציור';
        drawBtn.addEventListener('click', () => this.toggleDrawMode());
        toolbar.appendChild(drawBtn);

        // Highlight toggle
        const hlBtn = document.createElement('button');
        hlBtn.className = 'btn btn-secondary annotation-tool-btn' + (this._highlightMode ? ' active' : '');
        hlBtn.textContent = 'סמן טקסט';
        hlBtn.title = 'סימון טקסט בצבעים';
        hlBtn.addEventListener('click', () => this.toggleHighlightMode());
        toolbar.appendChild(hlBtn);

        // Translate toggle
        const transBtn = document.createElement('button');
        transBtn.className = 'btn btn-secondary annotation-tool-btn' + (this._translateMode ? ' active' : '');
        transBtn.textContent = 'מצב תרגום';
        transBtn.title = 'לחיצה על מילה פותחת מילון';
        transBtn.addEventListener('click', () => this.toggleTranslateMode());
        toolbar.appendChild(transBtn);

        // "חושף ניקוד" toggle (#26) — only if stage has diacritics
        const currentStage = this._state.currentStageId ? getStageById(this._state.currentStageId) : null;
        if (currentStage && currentStage.diacritizedSentence) {
            const diacWrapper = document.createElement('div');
            diacWrapper.style.cssText = 'position:relative;display:inline-block';
            const diacBtn = document.createElement('button');
            diacBtn.className = 'btn btn-secondary annotation-tool-btn' + (this._diacriticsMode ? ' active' : '');
            diacBtn.textContent = 'חושף ניקוד';
            diacBtn.title = 'לחץ על מילה כדי לחשוף/הסתיר ניקוד';
            diacBtn.addEventListener('click', () => this.toggleDiacriticsMode());
            diacWrapper.appendChild(diacBtn);

            // Sub-options: reveal all / hide all (shown on hover)
            const subMenu = document.createElement('div');
            subMenu.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:white;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:100;min-width:120px;padding:4px 0';
            const revealAll = document.createElement('button');
            revealAll.style.cssText = 'display:block;width:100%;padding:8px 12px;border:none;background:none;cursor:pointer;text-align:right;font-size:0.9em;font-family:inherit';
            revealAll.textContent = 'חשוף הכל';
            revealAll.addEventListener('mouseenter', () => revealAll.style.background = '#f0fdfa');
            revealAll.addEventListener('mouseleave', () => revealAll.style.background = 'none');
            revealAll.addEventListener('click', (e) => { e.stopPropagation(); this.revealAllDiacritics(); subMenu.style.display = 'none'; });
            const hideAll = document.createElement('button');
            hideAll.style.cssText = 'display:block;width:100%;padding:8px 12px;border:none;background:none;cursor:pointer;text-align:right;font-size:0.9em;font-family:inherit';
            hideAll.textContent = 'הסתר הכל';
            hideAll.addEventListener('mouseenter', () => hideAll.style.background = '#f0fdfa');
            hideAll.addEventListener('mouseleave', () => hideAll.style.background = 'none');
            hideAll.addEventListener('click', (e) => { e.stopPropagation(); this.hideAllDiacritics(); subMenu.style.display = 'none'; });
            subMenu.appendChild(revealAll);
            subMenu.appendChild(hideAll);
            diacWrapper.appendChild(subMenu);
            diacWrapper.addEventListener('mouseenter', () => subMenu.style.display = 'block');
            diacWrapper.addEventListener('mouseleave', () => subMenu.style.display = 'none');
            toolbar.appendChild(diacWrapper);
        }

        // "עד מתי" toggle (#22)
        const openEndedBtn = document.createElement('button');
        openEndedBtn.className = 'btn btn-secondary annotation-tool-btn' + (this._openEndedMode ? ' active' : '');
        openEndedBtn.textContent = 'עד מתי?';
        openEndedBtn.title = 'לחץ על גג כדי להפוך אותו לפתוח';
        openEndedBtn.addEventListener('click', () => this.toggleOpenEndedMode());
        toolbar.appendChild(openEndedBtn);

        // Color palette (shown when draw or highlight mode is on)
        if (this._drawMode || this._highlightMode) {
            const palette = document.createElement('div');
            palette.className = 'annotation-palette';

            this.COLORS.forEach(c => {
                const swatch = document.createElement('button');
                swatch.className = 'color-swatch' + (this._currentColor === c.value ? ' selected' : '');
                swatch.style.background = c.value;
                swatch.title = c.name;
                swatch.addEventListener('click', () => {
                    this._currentColor = c.value;
                    this.renderToolbar();
                });
                palette.appendChild(swatch);
            });

            // "Reset to default" swatch for highlight mode (removes highlight)
            if (this._highlightMode) {
                const resetSwatch = document.createElement('button');
                resetSwatch.className = 'color-swatch reset-swatch' + (this._currentColor === '__reset__' ? ' selected' : '');
                resetSwatch.title = 'הסר סימון';
                resetSwatch.textContent = '✕';
                resetSwatch.addEventListener('click', () => {
                    this._currentColor = '__reset__';
                    this.renderToolbar();
                });
                palette.appendChild(resetSwatch);
            }

            toolbar.appendChild(palette);

            // Line width selector (draw mode)
            if (this._drawMode) {
                const widthGroup = document.createElement('div');
                widthGroup.className = 'annotation-width-group';
                [1, 2, 4].forEach(w => {
                    const wb = document.createElement('button');
                    wb.className = 'width-btn' + (this._lineWidth === w ? ' selected' : '');
                    wb.title = w === 1 ? 'דק (ניקוד)' : w === 2 ? 'רגיל' : 'עבה';
                    // Visual indicator: a dot of proportional size
                    const dot = document.createElement('span');
                    dot.className = 'width-dot';
                    dot.style.width = (w * 3 + 2) + 'px';
                    dot.style.height = (w * 3 + 2) + 'px';
                    wb.appendChild(dot);
                    wb.addEventListener('click', () => {
                        this._lineWidth = w;
                        this.renderToolbar();
                    });
                    widthGroup.appendChild(wb);
                });
                toolbar.appendChild(widthGroup);
            }
        }

        // Eraser (draw mode only)
        if (this._drawMode) {
            const eraserBtn = document.createElement('button');
            eraserBtn.className = 'btn btn-secondary annotation-tool-btn';
            eraserBtn.textContent = 'מחק ציור';
            eraserBtn.title = 'מחק את כל הציורים';
            eraserBtn.addEventListener('click', () => this.clearDrawings());
            toolbar.appendChild(eraserBtn);
        }

        // Clear highlights
        if (this._highlightMode) {
            const clearHlBtn = document.createElement('button');
            clearHlBtn.className = 'btn btn-secondary annotation-tool-btn';
            clearHlBtn.textContent = 'נקה סימונים';
            clearHlBtn.title = 'נקה את כל סימוני הטקסט';
            clearHlBtn.addEventListener('click', () => this.clearHighlights());
            toolbar.appendChild(clearHlBtn);
        }

        // "המשפט מנותח?" button — shown when all words covered by roofs (#24)
        if (ArchSystem.allWordsCovered()) {
            const analyzeBtn = document.createElement('button');
            analyzeBtn.className = 'btn annotation-tool-btn analyzed-btn';
            analyzeBtn.textContent = 'המשפט מנותח?';
            analyzeBtn.title = 'בדוק אם הניתוח הושלם';
            analyzeBtn.addEventListener('click', () => {
                ArchSystem._checkCompletion(true); // force = true, bypass celebrationShown
            });
            toolbar.appendChild(analyzeBtn);
        }

        // "מחק" delete-mode toggle in the annotations toolbar (#1239, Amitai).
        // Mirrors the header #delete-mode-btn so delete mode is reachable from the
        // toolbar (especially on touch — no physical D key). Appended after the
        // tools and before the analyses tab group, so in the RTL row it sits to the
        // LEFT of the toolbar tools and to the RIGHT of the attempts (ניסיונות) panel.
        // NOTE: shared toolbar — coordinate layout changes with @6m.
        const delModeBtn = document.createElement('button');
        delModeBtn.className = 'btn btn-secondary annotation-tool-btn' + (this._state.deleteMode ? ' active' : '');
        delModeBtn.textContent = '🗑️ מחק';
        delModeBtn.title = 'מצב מחיקה — לחץ על אלמנט כדי למחוק (D)';
        delModeBtn.addEventListener('click', () => {
            this._state.setDeleteMode(!this._state.deleteMode);
            if (typeof updateModeButtons === 'function') updateModeButtons();
            Renderer.renderAll();
        });
        toolbar.appendChild(delModeBtn);

        // Analysis tabs — in the toolbar for switching between analyses
        const s = this._state;
        const totalAnalyses = s.getAnalysisCount();
        if (totalAnalyses > 1 || totalAnalyses < s.maxAnalyses) {
            const tabGroup = document.createElement('div');
            tabGroup.className = 'analysis-tab-group';
            for (let i = 0; i < totalAnalyses; i++) {
                const tab = document.createElement('button');
                tab.className = 'btn btn-secondary annotation-tool-btn analysis-toolbar-tab' + (i === s.activeAnalysisIndex ? ' active' : '');
                tab.textContent = `${i + 1}`;
                tab.title = `ניתוח ${i + 1} (לחיצה ארוכה לתפריט)`;
                tab.addEventListener('click', () => {
                    if (i !== s.activeAnalysisIndex) {
                        s.switchAnalysis(i);
                        Renderer.renderAll();
                    }
                });
                // Long-press context menu
                let longPressTimer = null;
                let longPressFired = false;
                const startLongPress = (e) => {
                    longPressFired = false;
                    longPressTimer = setTimeout(() => {
                        longPressFired = true;
                        this._showTabContextMenu(i, totalAnalyses, tab);
                    }, 500);
                };
                const cancelLongPress = (e) => {
                    clearTimeout(longPressTimer);
                    if (longPressFired) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                };
                tab.addEventListener('mousedown', startLongPress);
                tab.addEventListener('mouseup', cancelLongPress);
                tab.addEventListener('mouseleave', () => { if (!longPressFired) clearTimeout(longPressTimer); });
                tab.addEventListener('touchstart', (e) => { e.preventDefault(); startLongPress(e); }, { passive: false });
                tab.addEventListener('touchend', (e) => {
                    clearTimeout(longPressTimer);
                    if (longPressFired) {
                        e.preventDefault();
                        e.stopPropagation();
                    } else {
                        // touchstart prevented default click — do tab switch here
                        if (i !== s.activeAnalysisIndex) {
                            s.switchAnalysis(i);
                            Renderer.renderAll();
                        }
                    }
                });
                tab.addEventListener('touchmove', () => { if (!longPressFired) clearTimeout(longPressTimer); });
                // Right-click also opens menu
                tab.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this._showTabContextMenu(i, totalAnalyses, tab);
                });
                tabGroup.appendChild(tab);
            }
            if (totalAnalyses < s.maxAnalyses) {
                const addTab = document.createElement('button');
                addTab.className = 'btn btn-secondary annotation-tool-btn analysis-toolbar-tab add-tab';
                addTab.innerHTML = '+';
                addTab.title = 'הוסף ניתוח נוסף';
                addTab.addEventListener('click', () => {
                    Renderer._showAddAnalysisDialog();
                });
                tabGroup.appendChild(addTab);
            }
            toolbar.appendChild(tabGroup);
        }

        // Insert before sentence section
        const gameScreen = document.getElementById('game-screen');
        const main = gameScreen ? gameScreen.querySelector('main') : null;
        if (main) {
            main.insertBefore(toolbar, main.firstChild);
        }
    },

    // Tab context menu (long-press / right-click)
    _showTabContextMenu(tabIndex, totalAnalyses, anchorEl) {
        // Remove any existing menu
        const existing = document.getElementById('tab-context-menu');
        if (existing) existing.remove();

        const s = this._state;
        const menu = document.createElement('div');
        menu.id = 'tab-context-menu';
        menu.className = 'tab-context-menu';

        // Delete option (not for tab 0)
        if (tabIndex > 0) {
            const delBtn = document.createElement('button');
            delBtn.className = 'tab-menu-item delete';
            delBtn.textContent = 'מחק ניתוח';
            delBtn.onclick = () => {
                menu.remove();
                if (confirm(`למחוק את ניתוח ${tabIndex + 1}?`)) {
                    s.deleteAnalysis(tabIndex);
                    Renderer.renderAll();
                }
            };
            menu.appendChild(delBtn);
        }

        // Import options (only if other tabs exist)
        if (totalAnalyses > 1) {
            // Build list of other tab indices
            const otherTabs = [];
            for (let j = 0; j < totalAnalyses; j++) {
                if (j !== tabIndex) otherTabs.push(j);
            }

            const importPosBtn = document.createElement('button');
            importPosBtn.className = 'tab-menu-item';
            importPosBtn.textContent = 'ייבא חלקי דיבר מ...';
            importPosBtn.onclick = () => {
                menu.remove();
                this._showImportPicker(tabIndex, otherTabs, 'pos');
            };
            menu.appendChild(importPosBtn);

            const importArchBtn = document.createElement('button');
            importArchBtn.className = 'tab-menu-item';
            importArchBtn.textContent = 'ייבא תפקידים תחביריים מ...';
            importArchBtn.onclick = () => {
                menu.remove();
                this._showImportPicker(tabIndex, otherTabs, 'arches');
            };
            menu.appendChild(importArchBtn);

            const importTransBtn = document.createElement('button');
            importTransBtn.className = 'tab-menu-item';
            importTransBtn.textContent = 'ייבא תרגום מ...';
            importTransBtn.onclick = () => {
                menu.remove();
                this._showImportPicker(tabIndex, otherTabs, 'translation');
            };
            menu.appendChild(importTransBtn);
        }

        // Position near the tab
        const rect = anchorEl.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = rect.left + 'px';
        menu.style.zIndex = '9999';

        document.body.appendChild(menu);

        // Close on click outside (delay to avoid catching the long-press release)
        setTimeout(() => {
            const closer = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('mousedown', closer);
                    document.removeEventListener('touchstart', closer);
                }
            };
            document.addEventListener('mousedown', closer);
            document.addEventListener('touchstart', closer);
        }, 300);
    },

    _showImportPicker(targetIndex, sourceOptions, importType) {
        const s = this._state;
        // If only one source, just do it
        if (sourceOptions.length === 1) {
            // Switch to target first if needed
            if (s.activeAnalysisIndex !== targetIndex) {
                s.switchAnalysis(targetIndex);
            }
            s.importToCurrentAnalysis(sourceOptions[0], importType === 'pos', importType === 'arches', importType === 'translation');
            Renderer.renderAll();
            MessageManager.show(`יובא מניתוח ${sourceOptions[0] + 1}`, 'success');
            return;
        }

        // Multiple sources — show picker
        const importLabel = importType === 'pos' ? 'חלקי דיבר' : importType === 'arches' ? 'תפקידים תחביריים' : 'תרגום';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:300px;text-align:center">
                <h3>ייבא ${importLabel}</h3>
                <p style="color:#64748b;margin:8px 0">לניתוח ${targetIndex + 1} מ:</p>
                <div style="display:flex;flex-direction:column;gap:8px;margin:16px 0">
                    ${sourceOptions.map(j => `<button class="btn btn-secondary import-src-btn" data-src="${j}">ניתוח ${j + 1}</button>`).join('')}
                </div>
                <button class="btn btn-secondary" id="import-cancel">ביטול</button>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('show');

        modal.querySelectorAll('.import-src-btn').forEach(btn => {
            btn.onclick = () => {
                const srcIdx = parseInt(btn.dataset.src);
                if (s.activeAnalysisIndex !== targetIndex) {
                    s.switchAnalysis(targetIndex);
                }
                s.importToCurrentAnalysis(srcIdx, importType === 'pos', importType === 'arches', importType === 'translation');
                modal.remove();
                Renderer.renderAll();
                MessageManager.show(`יובא מניתוח ${srcIdx + 1}`, 'success');
            };
        });

        modal.querySelector('#import-cancel').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    },

    // === DRAW MODE ===

    // Picking any annotation tool while in delete mode should leave delete mode
    // (Amitai 2026-05-20) — the user is switching to a non-deleting tool.
    _exitDeleteMode() {
        const s = this._state;
        if (s && s.deleteMode) {
            s.setDeleteMode(false);
            if (typeof updateModeButtons === 'function') updateModeButtons();
            if (typeof Renderer !== 'undefined') Renderer.renderAll();
        }
    },

    toggleDrawMode() {
        this._drawMode = !this._drawMode;
        if (this._drawMode) { this._highlightMode = false; this._translateMode = false; this._exitDeleteMode(); }
        this.renderToolbar();
        this._updateCanvas();
    },

    _updateCanvas() {
        if (this._drawMode) {
            this._createCanvas();
        } else {
            this._hideCanvas();
        }
    },

    _createCanvas() {
        const container = document.getElementById('sentence-container');
        if (!container) return;

        let canvas = document.getElementById('drawing-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'drawing-canvas';
            canvas.className = 'drawing-canvas';
            container.appendChild(canvas);

            // Mouse events
            canvas.addEventListener('mousedown', (e) => this._startDraw(e));
            canvas.addEventListener('mousemove', (e) => this._doDraw(e));
            canvas.addEventListener('mouseup', () => this._endDraw());
            canvas.addEventListener('mouseleave', () => this._endDraw());

            // Touch events
            canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._startDraw(e.touches[0]); }, { passive: false });
            canvas.addEventListener('touchmove', (e) => { e.preventDefault(); this._doDraw(e.touches[0]); }, { passive: false });
            canvas.addEventListener('touchend', () => this._endDraw());
        }

        // Size canvas to container
        canvas.width = container.scrollWidth;
        canvas.height = container.scrollHeight;
        canvas.style.display = 'block';
        canvas.style.pointerEvents = 'auto';

        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._redrawPaths();
    },

    _hideCanvas() {
        const canvas = document.getElementById('drawing-canvas');
        if (canvas) {
            if (this._paths.length > 0) {
                // Keep canvas visible but non-interactive so drawings persist
                canvas.style.display = 'block';
                canvas.style.pointerEvents = 'none';
            } else {
                canvas.style.display = 'none';
            }
        }
    },

    _startDraw(e) {
        if (!this._drawMode || !this._canvas) return;
        this._drawing = true;
        const rect = this._canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this._currentPath = { color: this._currentColor, width: this._lineWidth, points: [{ x, y }] };
    },

    _doDraw(e) {
        if (!this._drawing || !this._ctx || !this._currentPath) return;
        const rect = this._canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this._currentPath.points.push({ x, y });

        // Draw current stroke
        const pts = this._currentPath.points;
        this._ctx.strokeStyle = this._currentPath.color;
        this._ctx.lineWidth = this._currentPath.width;
        this._ctx.lineCap = 'round';
        this._ctx.lineJoin = 'round';

        if (pts.length >= 2) {
            this._ctx.beginPath();
            this._ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
            this._ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            this._ctx.stroke();
        }
    },

    _endDraw() {
        if (!this._drawing) return;
        this._drawing = false;
        if (this._currentPath && this._currentPath.points.length > 1) {
            this._snapshotAnnotations();
            this._paths.push(this._currentPath);
            this._saveToStorage();
        }
        this._currentPath = null;
    },

    _redrawPaths() {
        if (!this._ctx || !this._canvas) return;
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        this._paths.forEach(path => {
            if (path.points.length < 2) return;
            this._ctx.strokeStyle = path.color;
            this._ctx.lineWidth = path.width;
            this._ctx.lineCap = 'round';
            this._ctx.lineJoin = 'round';
            this._ctx.beginPath();
            this._ctx.moveTo(path.points[0].x, path.points[0].y);
            for (let i = 1; i < path.points.length; i++) {
                this._ctx.lineTo(path.points[i].x, path.points[i].y);
            }
            this._ctx.stroke();
        });
    },

    clearDrawings() {
        this._paths = [];
        if (this._ctx && this._canvas) {
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            if (!this._drawMode) {
                this._canvas.style.display = 'none';
            }
        }
        this._saveToStorage();
    },

    // === HIGHLIGHT MODE ===

    toggleHighlightMode() {
        this._highlightMode = !this._highlightMode;
        if (this._highlightMode) { this._drawMode = false; this._translateMode = false; this._exitDeleteMode(); }
        this.renderToolbar();
        this._updateCanvas();
    },

    toggleTranslateMode() {
        this._translateMode = !this._translateMode;
        if (this._translateMode) {
            this._drawMode = false;
            this._highlightMode = false;
            this._openEndedMode = false;
            this._diacriticsMode = false;
            this._exitDeleteMode();
        }
        this.renderToolbar();
        this._updateCanvas();
    },

    toggleOpenEndedMode() {
        this._openEndedMode = !this._openEndedMode;
        if (this._openEndedMode) {
            this._drawMode = false;
            this._highlightMode = false;
            this._translateMode = false;
            this._diacriticsMode = false;
            this._exitDeleteMode();
        }
        this.renderToolbar();
        this._updateCanvas();
        Renderer.renderAll();
    },

    revealAllDiacritics() {
        const s = this._state;
        const stage = s.currentStageId ? getStageById(s.currentStageId) : null;
        if (!stage || !stage.diacritizedSentence) return;
        this._snapshotAnnotations();
        s.words.forEach(w => { this._revealedWords[w.id] = true; });
        this._applyDiacriticsReveal();
        this._saveToStorage();
    },

    hideAllDiacritics() {
        this._snapshotAnnotations();
        this._revealedWords = {};
        this._applyDiacriticsReveal();
        this._saveToStorage();
    },

    toggleDiacriticsMode() {
        this._diacriticsMode = !this._diacriticsMode;
        if (this._diacriticsMode) {
            this._drawMode = false;
            this._highlightMode = false;
            this._translateMode = false;
            this._openEndedMode = false;
            this._exitDeleteMode();
        }
        this.renderToolbar();
        this._updateCanvas();
    },

    handleWordClickForDiacritics(wordId) {
        if (!this._diacriticsMode) return false;
        const s = this._state;
        const stage = s.currentStageId ? getStageById(s.currentStageId) : null;
        if (!stage || !stage.diacritizedSentence) return false;

        // Toggle diacritics for this word
        this._snapshotAnnotations();
        if (this._revealedWords[wordId]) {
            delete this._revealedWords[wordId];
        } else {
            this._revealedWords[wordId] = true;
        }

        // Update the word text display
        const diacWords = stage.diacritizedSentence.split(/\s+/).filter(w => w.trim());
        const word = s.words.find(w => w.id === wordId);
        if (word) {
            const idx = s.words.indexOf(word);
            if (this._revealedWords[wordId] && diacWords[idx]) {
                // Show diacritized version
                const textEl = document.querySelector(`[data-word-id="${wordId}"] .word-text`);
                if (textEl) {
                    textEl.textContent = diacWords[idx];
                    textEl.classList.add('diacritics-revealed');
                }
            } else {
                // Show stripped version
                const textEl = document.querySelector(`[data-word-id="${wordId}"] .word-text`);
                if (textEl) {
                    textEl.textContent = word.text;
                    textEl.classList.remove('diacritics-revealed');
                }
            }
        }
        return true;
    },

    handleWordClickForTranslate(wordId) {
        if (!this._translateMode) return false;
        const s = this._state;
        const word = s.words.find(w => w.id === wordId);
        if (word) Dictionary.lookup(word.text);
        return true;
    },

    handleWordClickForHighlight(wordId) {
        if (!this._highlightMode) return false;
        this._snapshotAnnotations();
        if (this._currentColor === '__reset__') {
            delete this._highlightColors[wordId];
        } else {
            this._highlightColors[wordId] = this._currentColor;
        }
        this._saveToStorage();
        this.applyHighlights();
        return true; // consumed the click
    },

    applyHighlights() {
        document.querySelectorAll('.word-wrapper').forEach(wrapper => {
            const wordId = wrapper.dataset.wordId;
            const color = this._highlightColors[wordId];
            const textEl = wrapper.querySelector('.word-text');
            const blockEl = wrapper.querySelector('.word-block');
            if (color) {
                if (textEl) {
                    textEl.style.color = color;
                    textEl.style.textShadow = `0 0 1px ${color}40`;
                }
                if (blockEl) {
                    blockEl.style.borderColor = color;
                    blockEl.style.boxShadow = `0 0 6px ${color}30`;
                }
            } else {
                if (textEl) {
                    textEl.style.color = '';
                    textEl.style.textShadow = '';
                }
                if (blockEl) {
                    blockEl.style.borderColor = '';
                    blockEl.style.boxShadow = '';
                }
            }
        });
    },

    clearHighlights() {
        this._highlightColors = {};
        this._saveToStorage();
        this.applyHighlights();
    },

    // === PERSISTENCE ===

    _getStorageKey() {
        const stageId = this._state && this._state.currentStageId;
        return stageId ? `plonter_annotations_${stageId}` : null;
    },

    _saveToStorage() {
        const key = this._getStorageKey();
        if (!key) return;
        const data = {
            paths: this._paths,
            highlights: this._highlightColors,
            revealed: this._revealedWords
        };
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) { /* quota exceeded */ }
    },

    _loadFromStorage() {
        // Defer loading until a stage is active
    },

    loadForStage() {
        this._revealedWords = {};
        this._undoStack = [];
        this._redoStack = [];
        const key = this._getStorageKey();
        if (!key) return;
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const data = JSON.parse(raw);
                this._paths = data.paths || [];
                this._highlightColors = data.highlights || {};
                // Default: diacritics hidden. Don't restore revealed state.
                this._revealedWords = {};
            } else {
                this._paths = [];
                this._highlightColors = {};
            }
        } catch (e) {
            this._paths = [];
            this._highlightColors = {};
        }
    },

    // Called after renderAll to re-apply highlights and redraw canvas
    afterRender() {
        this.applyHighlights();
        this._applyDiacriticsReveal();
        if (this._drawMode) {
            // Draw mode active — recreate interactive canvas
            this._createCanvas();
        } else if (this._paths.length > 0) {
            // Draw mode off but paths exist — show non-interactive canvas
            this._createCanvas();
            if (this._canvas) this._canvas.style.pointerEvents = 'none';
        }
    }
};
