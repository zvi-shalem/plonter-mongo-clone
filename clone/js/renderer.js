// Renderer — all DOM rendering from state

const Renderer = {
    _state: null,

    init(stateManager) {
        this._state = stateManager;
    },

    // Render the full sentence with words and POS tags
    renderSentence() {
        const s = this._state;
        const container = document.getElementById('sentence-container');
        if (!container) return;
        container.innerHTML = '';

        const totalAnalyses = s.getAnalysisCount();

        // Analysis tabs are now in the annotations toolbar (not here)

        // Wrap active words in their own row container
        const activeWordsRow = document.createElement('div');
        activeWordsRow.className = 'active-words-row';

        s.words.forEach((word) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'word-wrapper';
            wrapper.dataset.wordId = word.id;

            // Word block
            const wordBlock = document.createElement('div');
            wordBlock.className = 'word-block';
            if (s.firstArchClick && s.firstArchClick.wordId === word.id) {
                wordBlock.classList.add('arch-selected');
            }

            const wordText = document.createElement('div');
            wordText.className = 'word-text';
            wordText.textContent = word.text;
            wordBlock.appendChild(wordText);

            // Click handler for arch creation (word level)
            if (!s.deleteMode && !s.logicalConnectionMode) {
                wordBlock.style.cursor = 'pointer';
                wordBlock.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (Annotations.handleWordClickForDiacritics(word.id)) return;
                    if (Annotations.handleWordClickForTranslate(word.id)) return;
                    if (Annotations.handleWordClickForHighlight(word.id)) return;
                    ArchSystem.handleWordClick(word.id);
                });
                wordBlock.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (Annotations.handleWordClickForDiacritics(word.id)) return;
                    if (Annotations.handleWordClickForTranslate(word.id)) return;
                    if (Annotations.handleWordClickForHighlight(word.id)) return;
                    ArchSystem.handleWordClick(word.id);
                }, { passive: false });
            }

            wrapper.appendChild(wordBlock);

            // Add POS button
            const addBtn = document.createElement('button');
            addBtn.className = 'add-pos-btn';
            addBtn.innerHTML = '+';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                Modals.openPosMenu(word.id);
            });
            wrapper.appendChild(addBtn);

            // POS tags container
            const partsContainer = document.createElement('div');
            partsContainer.className = 'word-parts-container';

            if (word.hasPartOfSpeech()) {
                word.partsOfSpeech.forEach(pos => {
                    const tag = document.createElement('div');
                    tag.className = 'part-tag';
                    tag.classList.add(`pos-column-${getPartOfSpeechColumnIndex(pos.type)}`);
                    tag.dataset.wordId = word.id;
                    tag.dataset.posId = pos.id;

                    if (s.deleteMode) {
                        tag.classList.add('delete-mode');
                        tag.addEventListener('click', (e) => {
                            e.stopPropagation();
                            s.removePartOfSpeech(word.id, pos.id);
                            this.renderAll();
                        });
                    } else {
                        tag.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._handlePartClick(word.id, pos.id);
                        });
                    }

                    // Mini-icons for gender/number (ties=male, bows=female)
                    const details = pos.details || {};
                    if (details.gender && details.number) {
                        const iconsDiv = document.createElement('div');
                        iconsDiv.className = 'pos-mini-icons';
                        const isMale = details.gender === 'זכר';
                        const iconClass = isMale ? 'tie' : 'bow';
                        let count = 1;
                        if (details.number === 'זוגי') count = 2;
                        else if (details.number === 'רבים' || details.number === 'רבות') count = 3;
                        for (let ic = 0; ic < count; ic++) {
                            const icon = document.createElement('span');
                            icon.className = `pos-mini-icon ${iconClass}`;
                            iconsDiv.appendChild(icon);
                        }
                        tag.appendChild(iconsDiv);
                    }
                    // Also check verb personGender for icons
                    if (pos.type === 'verb' && details.personGender) {
                        const pgList = Array.isArray(details.personGender) ? details.personGender : [details.personGender];
                        if (pgList.length > 0) {
                            const pg = pgList[0]; // use first for display
                            const isMale = pg.includes('זכר');
                            const isFemale = pg.includes('נקבה');
                            if (isMale || isFemale) {
                                const iconsDiv = document.createElement('div');
                                iconsDiv.className = 'pos-mini-icons';
                                const iconClass = isMale ? 'tie' : 'bow';
                                // Verb person determines count: singular=1, dual=2, plural=3
                                let count = 1;
                                if (pg.includes('רבים') || pg.includes('רבות')) count = 3;
                                else if (pg.includes('זוגי')) count = 2;
                                for (let ic = 0; ic < count; ic++) {
                                    const icon = document.createElement('span');
                                    icon.className = `pos-mini-icon ${iconClass}`;
                                    iconsDiv.appendChild(icon);
                                }
                                tag.appendChild(iconsDiv);
                            }
                        }
                    }

                    // Definite tag gets bold border effect
                    if (details.definiteness === 'מיודע' || details.definiteness === 'מיודע בال הידיעה' || details.definiteness === 'מיודע בכינוי שייכות') {
                        tag.classList.add('definite');
                    }

                    const typeSpan = document.createElement('span');
                    typeSpan.className = 'part-type';
                    typeSpan.textContent = getPartOfSpeechName(pos.type);
                    tag.appendChild(typeSpan);

                    if (!s.deleteMode) {
                        // #1243: "שכפל" duplicate button next to the pencil.
                        const dupBtn = document.createElement('span');
                        dupBtn.className = 'duplicate-icon';
                        dupBtn.innerHTML = '⧉';
                        dupBtn.title = 'שכפל חלק דיבר';
                        dupBtn.style.cssText = 'font-size:0.8em;cursor:pointer;opacity:0.7;transition:all 0.2s;margin-right:5px';
                        dupBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._handleDuplicateClick(word.id, pos.id);
                        });
                        tag.appendChild(dupBtn);

                        const editBtn = document.createElement('span');
                        editBtn.className = 'edit-icon';
                        editBtn.innerHTML = '✏️';
                        editBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            DetailsPanel.open(word.id, pos.id);
                        });
                        tag.appendChild(editBtn);
                    } else {
                        const delIcon = document.createElement('span');
                        delIcon.className = 'delete-icon';
                        delIcon.innerHTML = '✕';
                        tag.appendChild(delIcon);
                    }

                    partsContainer.appendChild(tag);
                });
            }

            wrapper.appendChild(partsContainer);
            activeWordsRow.appendChild(wrapper);
        });
        container.appendChild(activeWordsRow);

        // (Analysis switching is now done via tabs above)

        // Render SVG overlays after DOM layout settles.
        // #1247: when switching/returning to an analysis (in-app navigation, NOT a
        // page refresh) the word boxes re-layout and the Arabic webfont can reflow
        // them AFTER the first double-rAF draw, leaving the combination lines + POS
        // frames on STALE coordinates — the bug that previously needed two manual
        // clicks to re-align. We draw once on the next frames, then resettle once
        // more after fonts are ready + two further frames, so the overlay lands on
        // the final word positions automatically. The extra pass only runs when
        // there is actually something to align (combinations or arches present).
        const drawOverlays = () => {
            this.renderCombinationLines();
            ArchSystem.renderArches();
        };
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                drawOverlays();
                const st = this._state;
                const hasOverlay = st && ((st.combinations && st.combinations.length) ||
                    (st.arches && st.arches.length));
                if (hasOverlay) {
                    const resettle = () => requestAnimationFrame(() => requestAnimationFrame(drawOverlays));
                    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
                        document.fonts.ready.then(resettle);
                    } else {
                        resettle();
                    }
                }
            });
        });
    },

    // Render a read-only (inactive) analysis section
    _renderInactiveAnalysis(container, data, index, total) {
        const s = this._state;
        const section = document.createElement('div');
        section.className = 'analysis-section inactive';
        section.dataset.analysisIndex = index;

        const header = document.createElement('div');
        header.className = 'analysis-header';
        header.textContent = `ניתוח ${index + 1}`;
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => {
            s.switchAnalysis(index);
            this.renderAll();
        });
        section.appendChild(header);

        // Render words (read-only, clicking activates this analysis)
        const wordsRow = document.createElement('div');
        wordsRow.className = 'analysis-words-row';

        data.words.forEach(wd => {
            const wrapper = document.createElement('div');
            wrapper.className = 'word-wrapper';

            const wordBlock = document.createElement('div');
            wordBlock.className = 'word-block';
            wordBlock.style.cursor = 'pointer';
            wordBlock.style.opacity = '0.7';

            const wordText = document.createElement('div');
            wordText.className = 'word-text';
            wordText.textContent = wd.text;
            wordBlock.appendChild(wordText);

            wordBlock.addEventListener('click', () => {
                s.switchAnalysis(index);
                this.renderAll();
            });

            wrapper.appendChild(wordBlock);

            // Show POS tags (read-only)
            if (wd.partsOfSpeech && wd.partsOfSpeech.length > 0) {
                const partsContainer = document.createElement('div');
                partsContainer.className = 'word-parts-container';
                wd.partsOfSpeech.forEach(pos => {
                    const tag = document.createElement('div');
                    tag.className = 'part-tag';
                    tag.classList.add(`pos-column-${getPartOfSpeechColumnIndex(pos.type)}`);
                    tag.style.opacity = '0.7';
                    const typeSpan = document.createElement('span');
                    typeSpan.className = 'part-type';
                    typeSpan.textContent = getPartOfSpeechName(pos.type);
                    tag.appendChild(typeSpan);
                    partsContainer.appendChild(tag);
                });
                wrapper.appendChild(partsContainer);
            }

            wordsRow.appendChild(wrapper);
        });

        section.appendChild(wordsRow);

        // Show arch count as indicator
        if (data.arches && data.arches.length > 0) {
            const archInfo = document.createElement('div');
            archInfo.className = 'analysis-arch-info';
            archInfo.textContent = `${data.arches.length} גגות`;
            section.appendChild(archInfo);
        }

        container.appendChild(section);

        // Separator
        const sep = document.createElement('hr');
        sep.className = 'analysis-separator';
        container.appendChild(sep);
    },

    // Dialog for adding new analysis
    _showAddAnalysisDialog() {
        const s = this._state;
        let modal = document.getElementById('add-analysis-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'add-analysis-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="text-align:center;max-width:400px">
                <h3>ניתוח חדש</h3>
                <p style="margin:12px 0;color:#64748b">מה להשאיר מהניתוח הנוכחי?</p>
                <div style="text-align:right;margin:16px 0">
                    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:1.1em;cursor:pointer">
                        <input type="checkbox" id="keep-pos-check" checked style="width:20px;height:20px">
                        <span>חלקי דיבר</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:1.1em;cursor:pointer">
                        <input type="checkbox" id="keep-roofs-check" style="width:20px;height:20px">
                        <span>תפקידים תחביריים (גגות)</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:1.1em;cursor:pointer">
                        <input type="checkbox" id="keep-translation-check" checked style="width:20px;height:20px">
                        <span>תרגום</span>
                    </label>
                </div>
                <div style="display:flex;gap:8px;justify-content:center">
                    <button id="confirm-add-analysis" class="btn btn-primary" style="flex:1">צור ניתוח</button>
                    <button id="cancel-add-analysis" class="btn btn-secondary" style="flex:1">ביטול</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#confirm-add-analysis').onclick = () => {
            const keepPOS = modal.querySelector('#keep-pos-check').checked;
            const keepRoofs = modal.querySelector('#keep-roofs-check').checked;
            const keepTranslation = modal.querySelector('#keep-translation-check').checked;
            s.addAnalysis(keepPOS, keepRoofs, keepTranslation);
            modal.classList.remove('show');
            modal.remove();
            // Switch to the new analysis
            s.switchAnalysis(s.getAnalysisCount() - 1);
            this.renderAll();
            SoundManager.playClick();
        };

        modal.querySelector('#cancel-add-analysis').onclick = () => {
            modal.classList.remove('show');
            modal.remove();
        };

        modal.onclick = (e) => {
            if (e.target === modal) { modal.classList.remove('show'); modal.remove(); }
        };

        modal.classList.add('show');
    },

    // Render combination lines between connected POS tags
    renderCombinationLines() {
        const s = this._state;
        const existing = document.getElementById('combination-lines-svg');
        if (existing) existing.remove();

        const container = document.getElementById('sentence-container');
        if (!container || s.combinations.length === 0) return;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'combination-lines-svg';
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:visible';
        if (s.deleteMode) svg.style.pointerEvents = 'auto';

        const containerRect = container.getBoundingClientRect();
        const scrollL = container.scrollLeft;
        const scrollT = container.scrollTop;

        // Build chains
        const chains = this._findChains();

        chains.forEach(chain => {
            const points = [];
            const types = [];

            chain.forEach((comb, i) => {
                const el1 = document.querySelector(`[data-word-id="${comb.wordId1}"][data-pos-id="${comb.posId1}"]`);
                const el2 = document.querySelector(`[data-word-id="${comb.wordId2}"][data-pos-id="${comb.posId2}"]`);
                if (!el1 || !el2) return;

                const r1 = el1.getBoundingClientRect();
                const r2 = el2.getBoundingClientRect();
                const x1 = r1.left + r1.width / 2 - containerRect.left + scrollL;
                const y1 = r1.top + r1.height / 2 - containerRect.top + scrollT;
                const x2 = r2.left + r2.width / 2 - containerRect.left + scrollL;
                const y2 = r2.top + r2.height / 2 - containerRect.top + scrollT;

                if (i === 0) points.push({ x: x1, y: y1 });
                points.push({ x: x2, y: y2 });
                types.push(comb);

                // Color borders of connected tags (Fix #5: use chain-wide color)
                const chainIncomplete = this._isChainIncomplete(chain);
                const allValid = !chainIncomplete && chain.every(c => c.complete && c.type === 'valid');
                const borderColor = allValid ? '#0d9488' : '#f59e0b';
                [el1, el2].forEach(el => {
                    el.classList.add('connected');
                    el.style.borderColor = borderColor;
                    el.style.borderWidth = '3px';
                });
            });

            if (points.length < 2) return;

            // Draw path
            let pathData = `M ${points[0].x} ${points[0].y}`;
            for (let i = 1; i < points.length; i++) pathData += ` L ${points[i].x} ${points[i].y}`;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('fill', 'none');

            const chainInc = this._isChainIncomplete(chain);
            const allValid = !chainInc && types.every(c => c.complete && c.type === 'valid');
            const hasDemonstrative = types.some(c => c.isDemonstrative);
            let strokeColor = allValid ? '#0d9488' : '#f59e0b'; // teal or amber
            if (hasDemonstrative && allValid) strokeColor = '#7c3aed';

            path.setAttribute('stroke', strokeColor);
            path.setAttribute('stroke-width', '5');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.classList.add('combination-line');

            // #1240(b): Smichut construct-chain definiteness PROPAGATION.
            // In a construct chain (שרשרת סמיכויות) the definiteness of the final
            // definite member must propagate back through every נסמך — e.g. in
            // "كلام رئيس الوزراء", الوزراء (definite via ال) makes رئيس definite,
            // and رئيس in turn makes كلام definite. The previous code only checked
            // each pair's DIRECT סומך, so propagation stopped after one hop.
            // Build the נסמך->סומך edges for the noun+noun pairs in this chain, seed
            // the definite set with directly-definite nouns, then propagate to a
            // fixpoint (a נסמך is definite iff its סומך is definite).
            var isDefiniteSmichut = false;
            const _isDef = (pos) => pos && (typeof isDefinite === 'function'
                ? isDefinite(pos.details.definiteness)
                : pos.details.definiteness === 'מיודע');
            const _nk = (w, p) => `${w}::${p}`;
            const smichutEdges = [];
            chain.forEach(comb => {
                const cw1 = s.words.find(w => w.id === comb.wordId1);
                const cw2 = s.words.find(w => w.id === comb.wordId2);
                const cp1 = cw1 ? cw1.getPartOfSpeech(comb.posId1) : null;
                const cp2 = cw2 ? cw2.getPartOfSpeech(comb.posId2) : null;
                if (cp1 && cp2 && cp1.type === 'noun' && cp2.type === 'noun') {
                    // wordId1 = נסמך (read first / right), wordId2 = סומך (read after / left)
                    smichutEdges.push({
                        nesId: comb.wordId1, nesPos: comb.posId1, nesPart: cp1,
                        somId: comb.wordId2, somPos: comb.posId2, somPart: cp2
                    });
                }
            });
            if (smichutEdges.length) {
                const defNodes = new Set();
                smichutEdges.forEach(e => {
                    if (_isDef(e.nesPart)) defNodes.add(_nk(e.nesId, e.nesPos));
                    if (_isDef(e.somPart)) defNodes.add(_nk(e.somId, e.somPos));
                });
                let changed = true;
                while (changed) {
                    changed = false;
                    smichutEdges.forEach(e => {
                        const nk = _nk(e.nesId, e.nesPos), sk = _nk(e.somId, e.somPos);
                        if (defNodes.has(sk) && !defNodes.has(nk)) { defNodes.add(nk); changed = true; }
                    });
                }
                smichutEdges.forEach(e => {
                    // A נסמך acquires definiteness when its (transitive) סומך is definite.
                    if (defNodes.has(_nk(e.somId, e.somPos)) && defNodes.has(_nk(e.nesId, e.nesPos))) {
                        isDefiniteSmichut = true;
                        const nesEl = document.querySelector(`[data-word-id="${e.nesId}"][data-pos-id="${e.nesPos}"]`);
                        // #1240(a): use the shared definiteness-frame class so the
                        // double-frame SPACING matches the ال/possessive .definite
                        // frame exactly (uniform outline-offset across all sources).
                        if (nesEl) nesEl.classList.add('definite-acquired');
                    }
                });
            }

            // Tooltip on click (Amitai #2, #4)
            const clickHandler = (e) => {
                e.stopPropagation();
                if (s.deleteMode) {
                    const closest = this._findClosestSegment(chain, e.clientX, e.clientY, containerRect, scrollL, scrollT);
                    if (closest) {
                        s.removeCombination(closest.wordId1, closest.posId1, closest.wordId2, closest.posId2);
                        this.renderAll();
                    }
                } else {
                    const desc = this._chainDescription(chain);
                    MessageManager.showTooltip(desc, e.clientX, e.clientY);
                }
            };
            path.style.pointerEvents = 'auto';
            path.style.cursor = 'pointer';
            path.addEventListener('click', clickHandler);

            // Double line effect for definite smichut
            if (isDefiniteSmichut) {
                // Outer thick line
                const outerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                outerPath.setAttribute('d', pathData);
                outerPath.setAttribute('fill', 'none');
                outerPath.setAttribute('stroke', strokeColor);
                outerPath.setAttribute('stroke-width', '8');
                outerPath.setAttribute('stroke-linecap', 'round');
                outerPath.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(outerPath);
                // White gap in middle
                path.setAttribute('stroke', 'white');
                path.setAttribute('stroke-width', '4');
                svg.appendChild(path);
                // Inner colored line on top
                const innerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                innerPath.setAttribute('d', pathData);
                innerPath.setAttribute('fill', 'none');
                innerPath.setAttribute('stroke', strokeColor);
                innerPath.setAttribute('stroke-width', '2');
                innerPath.setAttribute('stroke-linecap', 'round');
                innerPath.setAttribute('stroke-linejoin', 'round');
                innerPath.style.pointerEvents = 'auto';
                innerPath.style.cursor = 'pointer';
                innerPath.addEventListener('click', clickHandler);
                svg.appendChild(innerPath);
            } else {
                svg.appendChild(path);
            }
        });

        // Add smichut glow filter
        if (svg.children.length > 0) {
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = `<filter id="smichut-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>`;
            svg.insertBefore(defs, svg.firstChild);
            container.style.position = 'relative';
            container.appendChild(svg);
        }
    },

    _findClosestSegment(chain, cx, cy, containerRect, scrollL, scrollT) {
        let minDist = Infinity, closest = null;
        chain.forEach(comb => {
            const el1 = document.querySelector(`[data-word-id="${comb.wordId1}"][data-pos-id="${comb.posId1}"]`);
            const el2 = document.querySelector(`[data-word-id="${comb.wordId2}"][data-pos-id="${comb.posId2}"]`);
            if (!el1 || !el2) return;
            const r1 = el1.getBoundingClientRect();
            const r2 = el2.getBoundingClientRect();
            const mx = (r1.left + r1.width/2 + r2.left + r2.width/2) / 2;
            const my = (r1.top + r1.height/2 + r2.top + r2.height/2) / 2;
            const d = Math.hypot(cx - mx, cy - my);
            if (d < minDist) { minDist = d; closest = comb; }
        });
        return closest;
    },

    // #41: Chain-level validation — adj needs noun before, prep needs noun after
    _isChainIncomplete(chain) {
        if (chain.length === 0) return null;
        const s = this._state;

        // Build ordered list of elements in chain
        const elements = [];
        const isNominal = (type) => ['noun', 'demonstrative', 'personalPronoun'].includes(type);

        chain.forEach((c, i) => {
            if (i === 0) {
                const w = s.words.find(w2 => w2.id === c.wordId1);
                const p = w ? w.getPartOfSpeech(c.posId1) : null;
                elements.push({ type: p ? p.type : null });
            }
            const w = s.words.find(w2 => w2.id === c.wordId2);
            const p = w ? w.getPartOfSpeech(c.posId2) : null;
            elements.push({ type: p ? p.type : null });
        });

        // Rule: Adjective needs a nominal element BEFORE it (lower index = to its right in RTL)
        for (let i = 0; i < elements.length; i++) {
            if (elements[i].type === 'adjective') {
                const hasNounBefore = elements.slice(0, i).some(e => isNominal(e.type));
                if (!hasNounBefore) return '\u05E9\u05DD \u05EA\u05D5\u05D0\u05E8 \u05DE\u05E6\u05E8\u05D9\u05DA \u05E8\u05DB\u05D9\u05D1 \u05E9\u05DE\u05E0\u05D9 \u05DC\u05E4\u05E0\u05D9\u05D5';
            }
        }

        // Rule: Preposition needs a nominal element AFTER it (higher index = to its left in RTL)
        for (let i = 0; i < elements.length; i++) {
            if (elements[i].type === 'preposition') {
                const hasNounAfter = elements.slice(i + 1).some(e => isNominal(e.type));
                if (!hasNounAfter) return '\u05DE\u05D9\u05DC\u05D9\u05EA \u05D9\u05D7\u05E1 \u05DE\u05E6\u05E8\u05D9\u05DB\u05D4 \u05E8\u05DB\u05D9\u05D1 \u05E9\u05DE\u05E0\u05D9 \u05D0\u05D7\u05E8\u05D9\u05D4';
            }
        }

        return null;
    },

    // Check if a chain is a smichut (noun+noun construct)
    _isSmichutChain(chain) {
        const s = this._state;
        return chain.every(c => {
            const w1 = s.words.find(w => w.id === c.wordId1);
            const w2 = s.words.find(w => w.id === c.wordId2);
            const p1 = w1 ? w1.getPartOfSpeech(c.posId1) : null;
            const p2 = w2 ? w2.getPartOfSpeech(c.posId2) : null;
            return p1 && p2 && p1.type === 'noun' && p2.type === 'noun';
        });
    },

    // Check if a smichut chain is definite (last noun in chain is definite)
    _isSmichutDefinite(chain) {
        if (chain.length === 0) return false;
        const s = this._state;
        const lastComb = chain[chain.length - 1];
        const w2 = s.words.find(w => w.id === lastComb.wordId2);
        const p2 = w2 ? w2.getPartOfSpeech(lastComb.posId2) : null;
        if (!p2 || !p2.details) return false;
        return typeof isDefinite === 'function' ? isDefinite(p2.details.definiteness) : p2.details.definiteness === 'מיודע';
    },

    _chainDescription(chain) {
        if (chain.length === 0) return '';
        const s = this._state;
        const descs = chain.map(c => {
            const w1 = s.words.find(w => w.id === c.wordId1);
            const w2 = s.words.find(w => w.id === c.wordId2);
            const p1 = w1 ? w1.getPartOfSpeech(c.posId1) : null;
            const p2 = w2 ? w2.getPartOfSpeech(c.posId2) : null;
            if (p1 && p2) return getCombinationTypeDescription(p1, p2);
            return '';
        }).filter(Boolean);
        const chainIncomplete = this._isChainIncomplete(chain);
        let status;
        if (chainIncomplete) {
            status = '⏳ ' + chainIncomplete;
        } else {
            status = chain.every(c => c.complete && c.type === 'valid') ? '✓ שלם' : '⏳ לא שלם';
        }
        return descs.join(' → ') + ' — ' + status;
    },

    _findChains() {
        const s = this._state;
        const chains = [];
        const processed = new Set();

        function combKey(c) {
            const a = `${c.wordId1}_${c.posId1}`, b = `${c.wordId2}_${c.posId2}`;
            return a < b ? `${a}-${b}` : `${b}-${a}`;
        }

        s.combinations.forEach(comb => {
            const key = combKey(comb);
            if (processed.has(key)) return;
            const chain = [comb];
            processed.add(key);

            // Extend FORWARD (from last element)
            let extended = true;
            while (extended) {
                extended = false;
                const last = chain[chain.length - 1];
                s.combinations.forEach(next => {
                    const nk = combKey(next);
                    if (processed.has(nk)) return;
                    if (next.wordId1 === last.wordId2 && next.posId1 === last.posId2) {
                        chain.push(next);
                        processed.add(nk);
                        extended = true;
                    }
                });
            }

            // Extend BACKWARD (from first element) — #41 fix: chains must be bidirectional
            extended = true;
            while (extended) {
                extended = false;
                const first = chain[0];
                s.combinations.forEach(prev => {
                    const pk = combKey(prev);
                    if (processed.has(pk)) return;
                    if (prev.wordId2 === first.wordId1 && prev.posId2 === first.posId1) {
                        chain.unshift(prev);
                        processed.add(pk);
                        extended = true;
                    }
                });
            }

            chains.push(chain);
        });
        return chains;
    },

    // #1243/#1244: duplicate a POS. If the POS is at the start of a combination,
    // first ask whether to duplicate the whole combination (#1244). A simple
    // duplicate never copies the source's connections (#1245).
    _handleDuplicateClick(wordId, posId) {
        const s = this._state;
        if (s.isCombinationStart(wordId, posId)) {
            const yes = confirm('חלק הדיבר נמצא בתחילת צירוף. לשכפל את כל הצירוף?');
            if (yes) {
                s.duplicateCombination(wordId, posId);
                this.renderAll();
                this._showDuplicateUndoToast('הצירוף שוכפל');
                if (typeof SoundManager !== 'undefined') SoundManager.playSuccess();
                return;
            }
            // "no" -> fall through to a simple single-POS duplicate
        }
        const copy = s.duplicatePartOfSpeech(wordId, posId);
        this.renderAll();
        if (copy) {
            const name = (typeof getPartOfSpeechName === 'function') ? getPartOfSpeechName(copy.type) : 'חלק הדיבר';
            this._showDuplicateUndoToast(`חלק הדיבר ${name} שוכפל`);
            if (typeof SoundManager !== 'undefined') SoundManager.playSuccess();
        }
    },

    // Soft toast with an [undo] action that auto-dismisses after 6s (#1243).
    // The auto-dismiss timer is cancelled if the user clicks undo.
    _showDuplicateUndoToast(text) {
        const existing = document.getElementById('duplicate-undo-toast');
        if (existing) existing.remove();
        if (this._dupToastTimer) { clearTimeout(this._dupToastTimer); this._dupToastTimer = null; }

        const toast = document.createElement('div');
        toast.id = 'duplicate-undo-toast';
        toast.className = 'duplicate-undo-toast';
        toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
            'background:#0f766e;color:#fff;padding:10px 16px;border-radius:10px;' +
            'box-shadow:0 6px 20px rgba(0,0,0,0.25);display:flex;align-items:center;gap:12px;' +
            'font-family:inherit;font-size:0.95rem;direction:rtl;z-index:10000';

        const span = document.createElement('span');
        span.textContent = text + ', לבטל?';
        toast.appendChild(span);

        const undoBtn = document.createElement('button');
        undoBtn.className = 'duplicate-undo-btn';
        undoBtn.textContent = 'בטל';
        undoBtn.style.cssText = 'background:#fff;color:#0f766e;border:none;border-radius:8px;' +
            'padding:5px 14px;font-weight:bold;cursor:pointer;font-family:inherit';
        undoBtn.addEventListener('click', () => {
            if (this._dupToastTimer) { clearTimeout(this._dupToastTimer); this._dupToastTimer = null; }
            this._state.undo();
            this.renderAll();
            if (toast.parentNode) toast.remove();
            if (typeof SoundManager !== 'undefined') SoundManager.playUndo();
        });
        toast.appendChild(undoBtn);

        document.body.appendChild(toast);
        this._dupToastTimer = setTimeout(() => {
            if (toast.parentNode) toast.remove();
            this._dupToastTimer = null;
        }, 6000);
    },

    _handlePartClick(wordId, posId) {
        const s = this._state;

        // Logical connection mode
        if (s.logicalConnectionMode) {
            // Not implementing full logical connections in v4 Phase 1-3
            return;
        }

        // Normal combination mode
        const existing = document.querySelector('.part-tag.selected');
        if (existing) {
            const selWordId = existing.dataset.wordId;
            const selPosId = existing.dataset.posId;
            if (selWordId === wordId && selPosId === posId) {
                existing.classList.remove('selected');
                return;
            }

            // Normalize word order (lower index = word1)
            const idx1 = s.words.findIndex(w => w.id === selWordId);
            const idx2 = s.words.findIndex(w => w.id === wordId);
            let fWordId1, fPosId1, fWordId2, fPosId2;
            if (idx1 <= idx2) {
                fWordId1 = selWordId; fPosId1 = selPosId; fWordId2 = wordId; fPosId2 = posId;
            } else {
                fWordId1 = wordId; fPosId1 = posId; fWordId2 = selWordId; fPosId2 = selPosId;
            }

            const w1 = s.words.find(w => w.id === fWordId1);
            const w2 = s.words.find(w => w.id === fWordId2);
            const p1 = w1.getPartOfSpeech(fPosId1);
            const p2 = w2.getPartOfSpeech(fPosId2);
            const result = validateCombination(p1, p2, fWordId1, fWordId2, s.words);

            if (result.valid && result.complete) {
                s.addCombination(fWordId1, fPosId1, fWordId2, fPosId2, true, result.type, result.isDemonstrative);
                MessageManager.show(result.message, 'info');
                SoundManager.playSuccess();
            } else if (result.valid && !result.complete) {
                s.addCombination(fWordId1, fPosId1, fWordId2, fPosId2, false, 'incomplete', result.isDemonstrative);
                MessageManager.show(result.message, 'warning');
                SoundManager.playWarning();
            } else {
                MessageManager.show(result.message, 'error');
                SoundManager.playError();
            }

            existing.classList.remove('selected');
            this.renderAll();
        } else {
            const tag = document.querySelector(`[data-word-id="${wordId}"][data-pos-id="${posId}"]`);
            if (tag) {
                tag.classList.add('selected');
                SoundManager.playClick();
            }
        }
    },

    // Render everything
    renderAll() {
        // If HindusMode is active, delegate rendering to it (it handles toolbar too)
        if (typeof HindusMode !== 'undefined' && HindusMode.isActive()) {
            HindusMode.render();
            return;
        }
        this.renderSentence();
        Annotations.renderToolbar();
        Annotations.afterRender();
    }
};
