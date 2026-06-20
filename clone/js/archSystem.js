// ArchSystem — roof/arch creation, height calculation, nesting validation, rendering

const ArchSystem = {
    _state: null,

    init(stateManager) {
        this._state = stateManager;
        this.loadRolesData(); // pre-load roles data
    },

    // Syntactic role abbreviations (Amitai #15)
    ROLE_ABBR: {
        'לוואי שם תואר': 'לש"ת',
        'לוואי סומך': 'ל"ס',
        'לוואי צירוף יחס': 'לצ"י',
        'לוואי כינוי רמז': 'לכ"ר'
    },

    // Two-click arch creation
    handleWordClick(wordId) {
        const s = this._state;
        if (s.deleteMode || s.logicalConnectionMode) return;

        if (s.firstArchClick) {
            if (s.firstArchClick.wordId === wordId) {
                // Same word — single-word arch
                this.createSingleWordArch(wordId);
            } else {
                // Different words — span arch
                this.createArch(s.firstArchClick.wordId, wordId);
            }
            s.firstArchClick = null;
            s.archCreationMode = false;
            Renderer.renderAll();
            return;
        }

        // First click
        s.firstArchClick = { wordId };
        s.archCreationMode = true;
        Renderer.renderAll();
    },

    createSingleWordArch(wordId) {
        const s = this._state;
        const existing = s.arches.find(a => a.wordId1 === wordId && a.wordId2 === wordId && !a.isAlternative);
        if (existing) {
            const hasAlt = s.arches.some(a => a.parentArchId === existing.id);
            if (hasAlt) {
                const alt = s.arches.find(a => a.parentArchId === existing.id);
                this._showAlternativePopup('ערוך גג חלופי?', 'ערוך גג חלופי', () => {
                    this.openRoleModal(alt);
                });
            } else {
                this._showAlternativePopup('צור גג חלופי?', 'צור גג חלופי', () => {
                    const height = this.calculateHeight(wordId, wordId);
                    const altArch = this._newArch(wordId, wordId, height);
                    altArch.isAlternative = true;
                    altArch.parentArchId = existing.id;
                    this.openRoleModal(altArch);
                });
            }
            return;
        }
        const height = this.calculateHeight(wordId, wordId);
        const arch = this._newArch(wordId, wordId, height);
        this.openRoleModal(arch);
    },

    createArch(wordId1, wordId2) {
        const s = this._state;
        // Normalize: lower index = wordId1
        const idx1 = s.words.findIndex(w => w.id === wordId1);
        const idx2 = s.words.findIndex(w => w.id === wordId2);
        if (idx1 > idx2) [wordId1, wordId2] = [wordId2, wordId1];

        const existing = s.arches.find(a =>
            (a.wordId1 === wordId1 && a.wordId2 === wordId2) ||
            (a.wordId1 === wordId2 && a.wordId2 === wordId1)
        );

        if (existing) {
            // Check if alternative already exists for this arch
            const hasAlt = s.arches.some(a => a.parentArchId === existing.id);
            if (existing.isAlternative) {
                // Clicking on same span where alternative exists — edit the alternative
                this.openRoleModal(existing);
                return;
            }
            if (hasAlt) {
                // Already has an alternative — edit it
                const alt = s.arches.find(a => a.parentArchId === existing.id);
                this._showAlternativePopup('ערוך גג חלופי?', 'ערוך גג חלופי', () => {
                    this.openRoleModal(alt);
                });
                return;
            }
            // Offer to create alternative
            this._showAlternativePopup('צור גג חלופי?', 'צור גג חלופי', () => {
                const height = this.calculateHeight(wordId1, wordId2);
                const altArch = this._newArch(wordId1, wordId2, height);
                altArch.isAlternative = true;
                altArch.parentArchId = existing.id;
                this.openRoleModal(altArch);
            });
            return;
        }

        const err = this.validateHierarchy(wordId1, wordId2);
        if (err) { MessageManager.show(err, 'error'); return; }

        const height = this.calculateHeight(wordId1, wordId2);
        const arch = this._newArch(wordId1, wordId2, height);
        this.openRoleModal(arch);
    },

    _showAlternativePopup(title, confirmText, onConfirm) {
        let popup = document.getElementById('alt-roof-popup');
        if (popup) popup.remove();

        popup = document.createElement('div');
        popup.id = 'alt-roof-popup';
        popup.className = 'modal';
        popup.innerHTML = `
            <div class="modal-content" style="text-align:center;max-width:320px">
                <h3>${title}</h3>
                <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
                    <button class="btn btn-primary" id="alt-roof-confirm">${confirmText}</button>
                    <button class="btn btn-secondary" id="alt-roof-cancel">ביטול</button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);
        popup.classList.add('show');

        popup.querySelector('#alt-roof-confirm').onclick = () => {
            popup.classList.remove('show');
            popup.remove();
            onConfirm();
        };
        popup.querySelector('#alt-roof-cancel').onclick = () => {
            popup.classList.remove('show');
            popup.remove();
        };
        popup.onclick = (e) => {
            if (e.target === popup) { popup.classList.remove('show'); popup.remove(); }
        };
    },

    _newArch(wId1, wId2, height) {
        return {
            id: `arch_${Date.now()}_${Math.random()}`,
            wordId1: wId1, wordId2: wId2, height,
            syntacticRole: null, isMainRoof: false, model: null,
            isClause: false, externalRole: null, isPending: true,
            isAlternative: false, parentArchId: null
        };
    },

    // Matryoshka validation: no partial overlaps
    validateHierarchy(wordId1, wordId2) {
        const s = this._state;
        const idx1 = s.words.findIndex(w => w.id === wordId1);
        const idx2 = s.words.findIndex(w => w.id === wordId2);
        const nStart = Math.min(idx1, idx2), nEnd = Math.max(idx1, idx2);

        for (const arch of s.arches) {
            const ai1 = s.words.findIndex(w => w.id === arch.wordId1);
            const ai2 = s.words.findIndex(w => w.id === arch.wordId2);
            const aStart = Math.min(ai1, ai2), aEnd = Math.max(ai1, ai2);
            if (aStart === aEnd) continue; // skip single-word

            const isNested = (nStart >= aStart && nEnd <= aEnd) || (aStart >= nStart && aEnd <= nEnd);
            const isDisjoint = nEnd < aStart || nStart > aEnd;
            const isIdentical = nStart === aStart && nEnd === aEnd;
            if (!isNested && !isDisjoint && !isIdentical) {
                return 'גגות חייבים להיות מקוננים (בבושקה) — חפיפה חלקית אינה מותרת';
            }
        }
        return null;
    },

    // Height calculation with nesting — dynamic distribution across levels
    calculateHeight(wordId1, wordId2) {
        const s = this._state;
        const idx1 = s.words.findIndex(w => w.id === wordId1);
        const idx2 = s.words.findIndex(w => w.id === wordId2);
        const start = Math.min(idx1, idx2), end = Math.max(idx1, idx2);
        const isSingle = start === end;

        // Count NON-ALTERNATIVE arches that strictly contain this one
        // Alternatives share their parent's level — they don't add nesting depth
        const containing = s.arches.filter(a => {
            if (a.isAlternative) return false; // alternatives don't count as containers
            const ai1 = s.words.findIndex(w => w.id === a.wordId1);
            const ai2 = s.words.findIndex(w => w.id === a.wordId2);
            const aStart = Math.min(ai1, ai2), aEnd = Math.max(ai1, ai2);
            if (aStart === aEnd) return false;
            if (aStart === start && aEnd === end) return false;
            if (isSingle) {
                return aStart <= start && aEnd >= end;
            }
            return aStart <= start && aEnd >= end;
        });

        // Find max nesting depth — only count non-alternative arches
        let maxDepth = 0;
        for (const a of s.arches) {
            if (a.isAlternative) continue; // skip alternatives entirely
            const ai1 = s.words.findIndex(w => w.id === a.wordId1);
            const ai2 = s.words.findIndex(w => w.id === a.wordId2);
            const aStart = Math.min(ai1, ai2), aEnd = Math.max(ai1, ai2);
            let depth = 0;
            for (const b of s.arches) {
                if (b.id === a.id || b.isAlternative) continue;
                const bi1 = s.words.findIndex(w => w.id === b.wordId1);
                const bi2 = s.words.findIndex(w => w.id === b.wordId2);
                const bStart = Math.min(bi1, bi2), bEnd = Math.max(bi1, bi2);
                if (bStart === bEnd) continue;
                if (bStart === aStart && bEnd === aEnd) continue;
                if (bStart <= aStart && bEnd >= aEnd) depth++;
            }
            if (depth > maxDepth) maxDepth = depth;
        }

        // Dynamic: distribute evenly within available space, capped to prevent toolbar collision
        const totalLevels = maxDepth + 1;
        // Scale max height with nesting depth — more levels get more space
        const maxAvailableHeight = Math.max(200, totalLevels * 50);
        const baseHeight = Math.min(maxAvailableHeight, Math.max(120, totalLevels * 40));
        const levelHeight = baseHeight / totalLevels;
        const myDepth = containing.length;
        // Innermost arches are tallest (closest to words), outermost are highest up
        return Math.max(25, baseHeight - myDepth * levelHeight);
    },

    recalculateAllHeights() {
        const s = this._state;
        // First calculate all non-alternative heights
        s.arches.forEach(a => {
            if (!a.isAlternative) {
                a.height = this.calculateHeight(a.wordId1, a.wordId2);
            }
        });
        // Then set alternative heights to match their parent
        s.arches.forEach(a => {
            if (a.isAlternative && a.parentArchId) {
                const parent = s.arches.find(p => p.id === a.parentArchId);
                a.height = parent ? parent.height : this.calculateHeight(a.wordId1, a.wordId2);
            }
        });
    },

    // Check if arch's words have matching combinations underneath
    _checkArchMatchesCombinations(arch) {
        const s = this._state;
        const idx1 = s.words.findIndex(w => w.id === arch.wordId1);
        const idx2 = s.words.findIndex(w => w.id === arch.wordId2);
        const start = Math.min(idx1, idx2), end = Math.max(idx1, idx2);

        const archCombos = s.combinations.filter(c => {
            const ci1 = s.words.findIndex(w => w.id === c.wordId1);
            const ci2 = s.words.findIndex(w => w.id === c.wordId2);
            return ci1 >= start && ci1 <= end && ci2 >= start && ci2 <= end;
        });
        if (archCombos.length === 0) return true;
        return archCombos.every(c => c.complete && c.type === 'valid');
    },

    // Render all arches as SVG roofs
    renderArches() {
        const s = this._state;
        const existing = document.getElementById('arch-svg');
        if (existing) existing.remove();

        const container = document.getElementById('sentence-container');
        if (!container || s.arches.length === 0) return;

        this._archGeometry = [];
        this.recalculateAllHeights();

        // Dynamic padding-top based on highest roof
        const maxHeight = s.arches.reduce((max, a) => Math.max(max, a.height), 0);
        container.style.paddingTop = Math.max(120, maxHeight + 40) + 'px';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'arch-svg';
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;overflow:visible';

        const cRect = container.getBoundingClientRect();
        const scrollL = container.scrollLeft, scrollT = container.scrollTop;

        // Render widest roofs first so the innermost (smallest-span) roofs paint
        // on top and capture delete-mode hover — matching the click's innermost-first
        // target. Without this, a big roof created/extended after nested roofs renders
        // last and its wide hit-area steals the hover highlight (Amitai 2026-05-20).
        const spanOf = a => {
            const i1 = s.words.findIndex(w => w.id === a.wordId1);
            const i2 = s.words.findIndex(w => w.id === a.wordId2);
            return Math.abs(i1 - i2);
        };
        const renderOrder = [...s.arches].sort((a, b) => spanOf(b) - spanOf(a));

        renderOrder.forEach(arch => {
            const wrap1 = container.querySelector(`[data-word-id="${arch.wordId1}"]`);
            const wrap2 = container.querySelector(`[data-word-id="${arch.wordId2}"]`);
            if (!wrap1 || !wrap2) return;
            const wb1 = wrap1.querySelector('.word-block');
            const wb2 = wrap2.querySelector('.word-block');
            if (!wb1 || !wb2) return;

            const r1 = wb1.getBoundingClientRect();
            const r2 = wb2.getBoundingClientRect();
            const isSingle = arch.wordId1 === arch.wordId2;

            let leftEdge, rightEdge, leftY, rightY;
            if (isSingle) {
                leftEdge = r1.left - cRect.left + scrollL;
                rightEdge = r1.left + r1.width - cRect.left + scrollL;
                leftY = rightY = r1.top - cRect.top + scrollT;
            } else {
                const i1 = s.words.findIndex(w => w.id === arch.wordId1);
                const i2 = s.words.findIndex(w => w.id === arch.wordId2);
                const firstRect = i1 < i2 ? r1 : r2;
                const secondRect = i1 < i2 ? r2 : r1;
                rightEdge = firstRect.left + firstRect.width - cRect.left + scrollL;
                leftEdge = secondRect.left - cRect.left + scrollL;
                rightY = firstRect.top - cRect.top + scrollT;
                leftY = secondRect.top - cRect.top + scrollT;
            }

            let roofY = Math.min(rightY, leftY) - arch.height;
            // Alternative roofs: placed at midpoint between parent and containing roof above
            if (arch.isAlternative && arch.parentArchId) {
                const parent = s.arches.find(a => a.id === arch.parentArchId);
                if (parent) {
                    const wordBaseY = Math.min(rightY, leftY);
                    const parentRoofY = wordBaseY - parent.height;

                    // Find the closest containing roof above the parent
                    const pi1 = s.words.findIndex(w => w.id === parent.wordId1);
                    const pi2 = s.words.findIndex(w => w.id === parent.wordId2);
                    const pStart = Math.min(pi1, pi2), pEnd = Math.max(pi1, pi2);
                    let aboveRoofY = parentRoofY - 60; // default gap if no roof above
                    for (const other of s.arches) {
                        if (other.id === parent.id || other.isAlternative) continue;
                        const oi1 = s.words.findIndex(w => w.id === other.wordId1);
                        const oi2 = s.words.findIndex(w => w.id === other.wordId2);
                        const oStart = Math.min(oi1, oi2), oEnd = Math.max(oi1, oi2);
                        if (oStart <= pStart && oEnd >= pEnd && !(oStart === pStart && oEnd === pEnd)) {
                            const otherRoofY = wordBaseY - other.height;
                            if (otherRoofY < parentRoofY && otherRoofY > aboveRoofY) {
                                aboveRoofY = otherRoofY;
                            }
                        }
                    }

                    // Midpoint between parent and the roof above
                    roofY = parentRoofY - Math.abs(parentRoofY - aboveRoofY) / 2;
                    // Walls start from parent's top edge
                    leftY = parentRoofY;
                    rightY = parentRoofY;
                }
            }
            const matches = this._checkArchMatchesCombinations(arch);
            let strokeColor = this._getColorForArch(arch);
            let strokeWidth = 3;
            let strokeDasharray = null;
            let isAltRoof = false;
            const isGeneralRole = this._isGeneralRole(arch.externalRole || arch.syntacticRole);
            if (arch.isAlternative) {
                strokeColor = '#1e293b'; // black base for construction pattern
                strokeDasharray = '12 6';
                strokeWidth = 3;
                isAltRoof = true;
            } else if (!matches && (arch.syntacticRole || arch.isClause || arch.isMainRoof)) {
                strokeColor = '#f59e0b'; strokeWidth = 3;
            } else if (arch.isMainRoof) {
                strokeWidth = 4;
            }

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.dataset.archId = arch.id;
            g.style.pointerEvents = (!s.archCreationMode && (s.deleteMode || Annotations._openEndedMode)) ? 'auto' : 'none';

            // Draw roof lines
            this._drawRoofLines(g, leftEdge, rightEdge, leftY, rightY, roofY, strokeColor, strokeWidth, arch.isOpenEnded, strokeDasharray);

            // Yellow overlay for alternative roofs (construction pattern: alternating black-yellow dashes)
            if (isAltRoof) {
                this._drawRoofLines(g, leftEdge, rightEdge, leftY, rightY, roofY, '#fbbf24', strokeWidth, arch.isOpenEnded, '6 12');
                // Yellow dashes are shorter (6) with longer gaps (12) = more black visible
            }

            // Label
            let labelText = arch.externalRole || arch.syntacticRole || '';
            // Abbreviations (Amitai #15)
            if (this.ROLE_ABBR[labelText]) labelText = this.ROLE_ABBR[labelText];
            if (arch.isMainRoof && arch.model) {
                const mn = { A: 'א', B: 'ב', C: 'ג' };
                if (arch.syntacticRole === 'נשוא') labelText = `נשוא ${mn[arch.model]}`;
                else if (arch.syntacticRole === 'נושא') labelText = `נושא ${mn[arch.model]}`;
                else if (!labelText) labelText = `דגם ${mn[arch.model]}`;
            }
            // Info status (נתון/חידוש)
            if (arch.infoStatus && labelText) {
                labelText += ` / ${arch.infoStatus}`;
            }
            if (labelText) {
                const labelColor = isAltRoof ? '#b45309' : strokeColor; // dark amber for alt roof labels
                this._drawLabel(g, labelText, leftEdge, rightEdge, roofY, labelColor, arch);
            }

            // Separator line under 'פסוקית עיקרית' arches
            if (arch.syntacticRole === 'פסוקית עיקרית') {
                const sepY = Math.max(leftY, rightY) + 5;
                const sepLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                sepLine.setAttribute('x1', leftEdge);
                sepLine.setAttribute('y1', sepY);
                sepLine.setAttribute('x2', rightEdge);
                sepLine.setAttribute('y2', sepY);
                sepLine.setAttribute('stroke', '#94a3b8');
                sepLine.setAttribute('stroke-width', '1.5');
                sepLine.setAttribute('stroke-dasharray', '4 4');
                g.appendChild(sepLine);
            }

            // Delete mode handler
            if (s.deleteMode) {
                g.style.cursor = 'pointer';
                // Hover = red highlight
                const origColor = strokeColor;
                g.addEventListener('mouseenter', () => {
                    g.querySelectorAll('line:not(.roof-ghost-wall), path').forEach(l => l.setAttribute('stroke', '#dc2626'));
                    const labelBg = g.querySelector('rect[stroke]');
                    const labelTxt = g.querySelector('text');
                    if (labelBg) labelBg.setAttribute('stroke', '#dc2626');
                    if (labelTxt) labelTxt.setAttribute('fill', '#dc2626');
                });
                g.addEventListener('mouseleave', () => {
                    g.querySelectorAll('line:not(.roof-ghost-wall), path').forEach(l => l.setAttribute('stroke', origColor));
                    const labelBg = g.querySelector('rect[stroke]');
                    const labelTxt = g.querySelector('text');
                    if (labelBg) labelBg.setAttribute('stroke', origColor);
                    if (labelTxt) labelTxt.setAttribute('fill', origColor);
                });
                const self = this;
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Find innermost (smallest span) arch at click position
                    const clickX = e.clientX - container.getBoundingClientRect().left + container.scrollLeft;
                    const clickY = e.clientY - container.getBoundingClientRect().top + container.scrollTop;
                    const YTOL = 6;
                    const withY = (self._archGeometry || []).filter(geo =>
                        clickX >= geo.left && clickX <= geo.right &&
                        clickY >= geo.top - YTOL && clickY <= geo.bottom + YTOL
                    );
                    const candidates = withY.length > 0 ? withY : (self._archGeometry || []).filter(geo =>
                        clickX >= geo.left && clickX <= geo.right
                    );
                    var targetId = arch.id;
                    if (candidates.length > 0) {
                        candidates.sort((a, b) => {
                            if (a.span !== b.span) return a.span - b.span;
                            return Math.abs(a.top - clickY) - Math.abs(b.top - clickY);
                        });
                        targetId = candidates[0].id;
                    }
                    self._deleteArchWithCheck(targetId);
                    Renderer.renderAll();
                });

                // Interior hit rect for clicking inside the roof area
                const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hitRect.setAttribute('x', Math.min(leftEdge, rightEdge));
                hitRect.setAttribute('y', roofY);
                hitRect.setAttribute('width', Math.abs(rightEdge - leftEdge) || 1);
                hitRect.setAttribute('height', Math.max(leftY, rightY) - roofY);
                hitRect.setAttribute('fill', 'transparent');
                hitRect.style.pointerEvents = 'auto';
                hitRect.style.cursor = 'pointer';
                g.appendChild(hitRect);

                // Store geometry for innermost-first deletion
                if (!this._archGeometry) this._archGeometry = [];
                this._archGeometry.push({
                    id: arch.id,
                    left: Math.min(leftEdge, rightEdge),
                    right: Math.max(leftEdge, rightEdge),
                    top: roofY,
                    bottom: Math.max(leftY, rightY),
                    span: Math.abs(rightEdge - leftEdge)
                });
            } else if (Annotations._openEndedMode) {
                // "עד מתי" mode (#22): hover highlight + click to toggle/extend
                g.style.cursor = 'pointer';
                const origColor = strokeColor;
                const hlColor = '#2563eb'; // blue highlight
                g.addEventListener('mouseenter', () => {
                    g.querySelectorAll('line:not(.roof-ghost-wall), path').forEach(l => l.setAttribute('stroke', hlColor));
                    const labelBg = g.querySelector('rect[stroke]');
                    const labelTxt = g.querySelector('text');
                    if (labelBg) labelBg.setAttribute('stroke', hlColor);
                    if (labelTxt) labelTxt.setAttribute('fill', hlColor);
                });
                g.addEventListener('mouseleave', () => {
                    g.querySelectorAll('line:not(.roof-ghost-wall), path').forEach(l => l.setAttribute('stroke', origColor));
                    const labelBg = g.querySelector('rect[stroke]');
                    const labelTxt = g.querySelector('text');
                    if (labelBg) labelBg.setAttribute('stroke', origColor);
                    if (labelTxt) labelTxt.setAttribute('fill', origColor);
                });
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (arch.isOpenEnded) {
                        // Already open-ended → enter hologram mode to close/extend
                        Annotations._openEndedMode = false;
                        Annotations.renderToolbar();
                        this._startHologramMode(arch, strokeColor, leftEdge, rightEdge, roofY, Math.max(leftY, rightY));
                    } else {
                        // Not open-ended → make it open-ended
                        this.setOpenEnded(arch.id, true);
                        Annotations._openEndedMode = false;
                        Annotations.renderToolbar();
                        Renderer.renderAll();
                    }
                });
                // Interior hit rect for easier clicking
                const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hitArea.setAttribute('x', Math.min(leftEdge, rightEdge));
                hitArea.setAttribute('y', roofY);
                hitArea.setAttribute('width', Math.abs(rightEdge - leftEdge) || 1);
                hitArea.setAttribute('height', Math.max(leftY, rightY) - roofY);
                hitArea.setAttribute('fill', 'transparent');
                hitArea.style.cursor = 'pointer';
                hitArea.style.pointerEvents = 'auto';
                g.appendChild(hitArea);
            } else {
                if (arch.isOpenEnded) {
                    // Open-ended roof: highlight on hover + interior click → hologram/extension mode
                    const origColor = strokeColor;
                    const hlColor = '#2563eb';
                    g.style.pointerEvents = 'auto';
                    g.addEventListener('mouseenter', () => {
                        g.querySelectorAll('line:not(.roof-ghost-wall), path').forEach(l => l.setAttribute('stroke', hlColor));
                        const labelBg = g.querySelector('rect[stroke]');
                        const labelTxt = g.querySelector('text');
                        if (labelBg) labelBg.setAttribute('stroke', hlColor);
                        if (labelTxt) labelTxt.setAttribute('fill', hlColor);
                    });
                    g.addEventListener('mouseleave', () => {
                        g.querySelectorAll('line:not(.roof-ghost-wall), path').forEach(l => l.setAttribute('stroke', origColor));
                        const labelBg = g.querySelector('rect[stroke]');
                        const labelTxt = g.querySelector('text');
                        if (labelBg) labelBg.setAttribute('stroke', origColor);
                        if (labelTxt) labelTxt.setAttribute('fill', origColor);
                    });
                    const interiorHit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    interiorHit.setAttribute('x', Math.min(leftEdge, rightEdge));
                    interiorHit.setAttribute('y', roofY);
                    interiorHit.setAttribute('width', Math.abs(rightEdge - leftEdge) || 1);
                    interiorHit.setAttribute('height', Math.max(leftY, rightY) - roofY);
                    interiorHit.setAttribute('fill', 'transparent');
                    interiorHit.style.cursor = 'pointer';
                    interiorHit.style.pointerEvents = 'auto';
                    interiorHit.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._startHologramMode(arch, strokeColor, leftEdge, rightEdge, roofY, Math.max(leftY, rightY));
                    });
                    g.appendChild(interiorHit);
                } else {
                    // Normal roof: hit area for editing role (short click) + info status (long press)
                    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    hitArea.setAttribute('x', Math.min(leftEdge, rightEdge));
                    hitArea.setAttribute('y', roofY - 12);
                    hitArea.setAttribute('width', Math.abs(rightEdge - leftEdge) || 1);
                    hitArea.setAttribute('height', 24);
                    hitArea.setAttribute('fill', 'transparent');
                    hitArea.style.cursor = 'pointer';
                    hitArea.style.pointerEvents = 'auto';
                    this._addLongPressHandlers(hitArea, arch, () => {
                        this.openRoleModal(arch);
                    });
                    g.appendChild(hitArea);
                }
            }

            svg.appendChild(g);
        });

        // Halo indicator for first click
        if (s.firstArchClick && s.archCreationMode) {
            this._drawHalo(svg, s.firstArchClick.wordId, container, cRect, scrollL, scrollT);
        }

        if (svg.children.length > 0) {
            container.style.position = 'relative';
            container.appendChild(svg);
            const fullWidth = Math.max(container.scrollWidth, container.clientWidth);
            svg.style.width = fullWidth + 'px';
        }
    },

    _drawRoofLines(g, leftEdge, rightEdge, leftY, rightY, roofY, color, width, isOpenEnded, dasharray) {
        // #39: Rounded corners on roofs
        const maxR = 8;
        const horizDist = Math.abs(rightEdge - leftEdge);
        const leftVertDist = Math.abs(leftY - roofY);
        const rightVertDist = Math.abs(rightY - roofY);
        const r = Math.min(maxR, horizDist / 2, leftVertDist / 2, rightVertDist / 2);

        if (isOpenEnded) {
            // Open-ended roof: no left wall, left end has arrow pointing left
            const arrowSize = 10;
            // Arrow head
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const arrowD = [
                `M ${leftEdge + arrowSize} ${roofY - arrowSize * 0.6}`,
                `L ${leftEdge} ${roofY}`,
                `L ${leftEdge + arrowSize} ${roofY + arrowSize * 0.6}`
            ].join(' ');
            arrow.setAttribute('d', arrowD);
            arrow.setAttribute('fill', 'none');
            arrow.setAttribute('stroke', color);
            arrow.setAttribute('stroke-width', width);
            arrow.setAttribute('stroke-linecap', 'round');
            arrow.setAttribute('stroke-linejoin', 'round');
            if (dasharray) arrow.setAttribute('stroke-dasharray', dasharray);
            g.appendChild(arrow);

            // Horizontal line + right wall
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const rr = Math.min(maxR, rightVertDist / 2, horizDist / 4);
            let d;
            if (rr < 1) {
                d = `M ${leftEdge} ${roofY} L ${rightEdge} ${roofY} L ${rightEdge} ${rightY}`;
            } else {
                d = [
                    `M ${leftEdge} ${roofY}`,
                    `L ${rightEdge - rr} ${roofY}`,
                    `Q ${rightEdge} ${roofY} ${rightEdge} ${roofY + rr}`,
                    `L ${rightEdge} ${rightY}`
                ].join(' ');
            }
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', width);
            path.setAttribute('stroke-linecap', 'round');
            if (dasharray) path.setAttribute('stroke-dasharray', dasharray);
            g.appendChild(path);

            // Would-be wall (Amitai 2026-06-06): a faint dashed gray-white vertical
            // line where the left wall WOULD be if this roof weren't open-ended —
            // marks the boundary the "עד מתי" arch is reaching toward.
            const ghostWall = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            ghostWall.setAttribute('x1', leftEdge);
            ghostWall.setAttribute('y1', roofY);
            ghostWall.setAttribute('x2', leftEdge);
            ghostWall.setAttribute('y2', leftY);
            ghostWall.setAttribute('stroke', '#cbd5e1'); // gray-white (slate-300)
            ghostWall.setAttribute('stroke-width', Math.max(1.5, width - 0.5));
            ghostWall.setAttribute('stroke-dasharray', '5 4');
            ghostWall.setAttribute('stroke-linecap', 'round');
            ghostWall.setAttribute('opacity', '0.5');
            ghostWall.setAttribute('class', 'roof-ghost-wall');
            g.appendChild(ghostWall);

            // Dashed extension hint line below arrow
            const hint = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hint.setAttribute('x1', leftEdge);
            hint.setAttribute('y1', roofY);
            hint.setAttribute('x2', leftEdge - 30);
            hint.setAttribute('y2', roofY);
            hint.setAttribute('stroke', color);
            hint.setAttribute('stroke-width', 1);
            hint.setAttribute('stroke-dasharray', '4 3');
            hint.setAttribute('opacity', '0.4');
            g.appendChild(hint);
            return;
        }

        if (r < 1 || horizDist < 2) {
            // Too small for rounded corners, fall back to straight lines
            const lines = [
                [leftEdge, leftY, leftEdge, roofY],
                [leftEdge, roofY, rightEdge, roofY],
                [rightEdge, roofY, rightEdge, rightY]
            ];
            lines.forEach(([x1, y1, x2, y2]) => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x1); line.setAttribute('y1', y1);
                line.setAttribute('x2', x2); line.setAttribute('y2', y2);
                line.setAttribute('stroke', color);
                line.setAttribute('stroke-width', width);
                if (dasharray) line.setAttribute('stroke-dasharray', dasharray);
                g.appendChild(line);
            });
            return;
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = [
            `M ${leftEdge} ${leftY}`,
            `L ${leftEdge} ${roofY + r}`,
            `Q ${leftEdge} ${roofY} ${leftEdge + r} ${roofY}`,
            `L ${rightEdge - r} ${roofY}`,
            `Q ${rightEdge} ${roofY} ${rightEdge} ${roofY + r}`,
            `L ${rightEdge} ${rightY}`
        ].join(' ');

        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', width);
        path.setAttribute('stroke-linecap', 'round');
        if (dasharray) path.setAttribute('stroke-dasharray', dasharray);
        g.appendChild(path);
    },

    _drawLabel(g, text, leftEdge, rightEdge, roofY, color, arch) {
        const labelX = (rightEdge + leftEdge) / 2;
        const labelY = roofY; // Label sits ON the roof line
        const estWidth = text.length * 7;
        const roofSpan = Math.abs(rightEdge - leftEdge);
        const labelWidth = Math.min(roofSpan, Math.max(28, estWidth + 4));
        const gapHalf = labelWidth / 2 + 1; // tight gap in the horizontal line

        // White background behind label (to "break" the roof line)
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', labelX - gapHalf);
        bg.setAttribute('y', labelY - 9);
        bg.setAttribute('width', gapHalf * 2);
        bg.setAttribute('height', 18);
        bg.setAttribute('rx', 9);
        bg.setAttribute('fill', 'white');
        bg.setAttribute('stroke', color);
        bg.setAttribute('stroke-width', '1.5');

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', labelX);
        label.setAttribute('y', labelY + 4);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '10px');
        label.setAttribute('font-weight', 'bold');
        const roleName = arch.externalRole || arch.syntacticRole;
        label.setAttribute('fill', color);
        label.textContent = text;

        const labelG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        labelG.style.cursor = 'pointer';
        labelG.style.pointerEvents = 'auto';
        this._addLongPressHandlers(labelG, arch, () => {
            if (this._state.deleteMode) {
                this._deleteArchWithCheck(arch.id);
            } else {
                this.openRoleModal(arch);
            }
        });
        labelG.appendChild(bg);
        labelG.appendChild(label);
        g.appendChild(labelG);
    },

    _drawHalo(svg, wordId, container, cRect, scrollL, scrollT) {
        const wrap = container.querySelector(`[data-word-id="${wordId}"]`);
        if (!wrap) return;
        const wb = wrap.querySelector('.word-block');
        if (!wb) return;
        const r = wb.getBoundingClientRect();
        const x = r.left - cRect.left + scrollL;
        const y = r.top - cRect.top + scrollT;
        const haloH = 100;

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        halo.setAttribute('x', x); halo.setAttribute('y', y - haloH);
        halo.setAttribute('width', r.width); halo.setAttribute('height', haloH);
        halo.setAttribute('rx', 4); halo.setAttribute('fill', '#0d9488');
        halo.style.opacity = '0.15';
        halo.style.animation = 'pulse 1.5s ease-in-out infinite';

        const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        border.setAttribute('x', x); border.setAttribute('y', y - haloH);
        border.setAttribute('width', r.width); border.setAttribute('height', haloH);
        border.setAttribute('rx', 4); border.setAttribute('fill', 'none');
        border.setAttribute('stroke', '#0d9488'); border.setAttribute('stroke-width', '2');
        border.style.opacity = '0.4';

        svg.appendChild(halo);
        svg.appendChild(border);
    },

    // Public helper: are all words covered by at least one roof?
    allWordsCovered() {
        const s = this._state;
        if (s.words.length === 0) return false;
        return s.words.every(word => {
            const idx = s.words.findIndex(w => w.id === word.id);
            return s.arches.some(arch => {
                const ai1 = s.words.findIndex(w => w.id === arch.wordId1);
                const ai2 = s.words.findIndex(w => w.id === arch.wordId2);
                const start = Math.min(ai1, ai2), end = Math.max(ai1, ai2);
                return idx >= start && idx <= end;
            });
        });
    },

    // Toggle open-ended state for a roof ("עד מתי" mode)
    setOpenEnded(archId, isOpen) {
        const s = this._state;
        const arch = s.arches.find(a => a.id === archId);
        if (!arch) return;
        s.snapshot();
        arch.isOpenEnded = isOpen;
        // Sync with paired arch (alternative ↔ parent)
        if (arch.isAlternative && arch.parentArchId) {
            const parent = s.arches.find(a => a.id === arch.parentArchId);
            if (parent) parent.isOpenEnded = isOpen;
        } else {
            const alt = s.arches.find(a => a.parentArchId === archId);
            if (alt) alt.isOpenEnded = isOpen;
        }
        s.emit('stateChanged', { action: 'updateArch', archId });
    },

    // Close/extend an open-ended roof to a target word
    closeOpenEndedRoof(archId, targetWordId) {
        const s = this._state;
        const arch = s.arches.find(a => a.id === archId);
        if (!arch || !arch.isOpenEnded) return;

        const idx1 = s.words.findIndex(w => w.id === arch.wordId1);
        const idx2 = s.words.findIndex(w => w.id === arch.wordId2);
        const targetIdx = s.words.findIndex(w => w.id === targetWordId);
        const start = Math.min(idx1, idx2);

        // Work out the prospective endpoints WITHOUT mutating yet, so we can
        // validate (block duplicates) before committing.
        let newW1 = arch.wordId1;
        let newW2 = arch.wordId2;
        if (targetIdx === start) {
            // Clicking the anchored word — collapse to a single-word roof on it
            newW1 = newW2 = (idx1 < idx2 ? arch.wordId1 : arch.wordId2);
        } else {
            // Close/extend: move the open end (higher index) to the clicked word.
            // Clicking the original open end therefore keeps the full span.
            if (idx1 < idx2) { newW2 = targetWordId; }
            else { newW1 = targetWordId; }
        }

        // Paired arch (alternative ↔ parent) shares the span — excluded from checks
        let pair = null;
        if (arch.isAlternative && arch.parentArchId) {
            pair = s.arches.find(a => a.id === arch.parentArchId);
        } else {
            pair = s.arches.find(a => a.parentArchId === archId);
        }

        // Block closing into a span that already exists as another roof
        // (Amitai 2026-05-20): show a message, keep the roof open-ended.
        const duplicate = s.arches.find(a =>
            a.id !== arch.id && (!pair || a.id !== pair.id) &&
            ((a.wordId1 === newW1 && a.wordId2 === newW2) ||
             (a.wordId1 === newW2 && a.wordId2 === newW1))
        );
        if (duplicate) {
            MessageManager.show('לא ניתן לסגור כאן — כבר קיים גג בטווח הזה', 'error');
            return;
        }

        const nIdx1 = s.words.findIndex(w => w.id === newW1);
        const nIdx2 = s.words.findIndex(w => w.id === newW2);
        const nStart = Math.min(nIdx1, nIdx2), nEnd = Math.max(nIdx1, nIdx2);

        // Confine the open-ended extension to the walls of the surrounding roof
        // (Amitai 2026-06-06): the "עד מתי" arch may not cross the 2 walls of the
        // roof that encloses it — solid or dashed (an open-ended encloser's stored
        // span endpoint IS its dashed wall). Top-level roofs stay free.
        const enc = this._getEnclosingArch(arch);
        if (enc && (nStart < enc.start || nEnd > enc.end)) {
            MessageManager.show('לא ניתן לחרוג מקירות הגג שמסביב', 'error');
            return;
        }

        // Block extensions that would PARTIALLY overlap another roof (breaks the
        // matryoshka rule). The "עד מתי" close path used to skip this, letting two
        // same-level roofs interleave (Amitai bug report 2026-06-06). Reuses the
        // same nesting/disjoint/identical logic as validateHierarchy.
        const overlap = s.arches.find(a => {
            if (a.id === arch.id || (pair && a.id === pair.id)) return false;
            const ai1 = s.words.findIndex(w => w.id === a.wordId1);
            const ai2 = s.words.findIndex(w => w.id === a.wordId2);
            const aStart = Math.min(ai1, ai2), aEnd = Math.max(ai1, ai2);
            if (aStart === aEnd) return false; // single-word never conflicts
            const isNested = (nStart >= aStart && nEnd <= aEnd) || (aStart >= nStart && aEnd <= nEnd);
            const isDisjoint = nEnd < aStart || nStart > aEnd;
            const isIdentical = nStart === aStart && nEnd === aEnd;
            return !isNested && !isDisjoint && !isIdentical;
        });
        if (overlap) {
            MessageManager.show('לא ניתן לסגור כאן — חפיפה חלקית עם גג אחר (בבושקה)', 'error');
            return;
        }

        s.snapshot();
        arch.wordId1 = newW1;
        arch.wordId2 = newW2;
        arch.isOpenEnded = false;

        if (pair) {
            pair.wordId1 = arch.wordId1;
            pair.wordId2 = arch.wordId2;
            pair.isOpenEnded = false;
        }

        arch.height = this.calculateHeight(arch.wordId1, arch.wordId2);
        this.recalculateAllHeights();
        s.emit('stateChanged', { action: 'updateArch', archId });
        Renderer.renderAll();
    },

    // Find the innermost roof that surrounds `arch` (its enclosing "walls").
    // Used to confine the "עד מתי" open-ended extension so it can't cross the
    // 2 walls of the roof around it (Amitai 2026-06-06). Returns
    // { arch, start, end } (word indices) or null when nothing surrounds it.
    _getEnclosingArch(arch) {
        const s = this._state;
        const idx1 = s.words.findIndex(w => w.id === arch.wordId1);
        const idx2 = s.words.findIndex(w => w.id === arch.wordId2);
        const aStart = Math.min(idx1, idx2), aEnd = Math.max(idx1, idx2);

        // The paired arch (alternative ↔ parent) shares the span — never a "wall"
        let pairId = null;
        if (arch.isAlternative && arch.parentArchId) {
            pairId = arch.parentArchId;
        } else {
            const alt = s.arches.find(a => a.parentArchId === arch.id);
            if (alt) pairId = alt.id;
        }

        let best = null, bestSpan = Infinity;
        for (const a of s.arches) {
            if (a.id === arch.id || a.id === pairId) continue;
            const ai1 = s.words.findIndex(w => w.id === a.wordId1);
            const ai2 = s.words.findIndex(w => w.id === a.wordId2);
            const cStart = Math.min(ai1, ai2), cEnd = Math.max(ai1, ai2);
            if (cStart === cEnd) continue; // single-word roof can't enclose
            // Strictly contains arch's span (shared edge ok, identical span is not enclosing)
            const contains = cStart <= aStart && cEnd >= aEnd &&
                             !(cStart === aStart && cEnd === aEnd);
            if (!contains) continue;
            const span = cEnd - cStart;
            if (span < bestSpan) { bestSpan = span; best = { arch: a, start: cStart, end: cEnd }; }
        }
        return best;
    },

    // #24/#40: Check if all words are covered by roofs → celebration
    // force=true: triggered by button click, ignores celebrationShown flag
    _checkCompletion(force) {
        const s = this._state;
        if (s.words.length === 0) return;
        if (!force && s._celebrationShown) return;

        const allCovered = this.allWordsCovered();
        if (!allCovered) return;

        if (!s._userName) {
            this._showNamePrompt(() => this._showCelebration());
        } else {
            this._showCelebration();
        }
    },

    _showNamePrompt(callback) {
        const s = this._state;
        let modal = document.getElementById('name-prompt-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'name-prompt-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="text-align:center">
                    <h3>כל הכבוד! מה השם שלך?</h3>
                    <input type="text" id="user-name-input" class="form-control" placeholder="הכנס את שמך" dir="rtl" style="margin:16px 0;text-align:center;font-size:1.2em">
                    <button id="submit-name-btn" class="btn btn-primary" style="width:100%">אישור</button>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const input = modal.querySelector('#user-name-input');
        input.value = '';
        modal.classList.add('show');
        setTimeout(() => input.focus(), 100);

        const submitHandler = () => {
            const name = input.value.trim();
            if (!name) return;
            s._userName = name;
            modal.classList.remove('show');
            callback();
        };

        modal.querySelector('#submit-name-btn').onclick = submitHandler;
        input.onkeydown = (e) => { if (e.key === 'Enter') submitHandler(); };
    },

    _showCelebration() {
        const s = this._state;
        s._celebrationShown = true;

        SoundManager.playCelebration();

        const banner = document.createElement('div');
        banner.className = 'celebration-banner';
        banner.style.cursor = 'pointer';
        banner.innerHTML = '<span class="celebration-emoji">\uD83C\uDF89\uD83E\uDD73\uD83C\uDF8A</span><br>' +
            'המשפט מנותח נודה ל' + s._userName +
            '<br><span style="font-size:0.7em;opacity:0.8;margin-top:4px;display:inline-block">אני מזמינה שאלות (:</span>';
        banner.onclick = function() { if (banner.parentElement) banner.remove(); };

        const container = document.getElementById('sentence-container');
        if (container && container.parentElement) {
            container.parentElement.insertBefore(banner, container);

            // Emoji burst animation
            setTimeout(() => {
                const rect = banner.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const emojis = ['🎉', '🎊', '🥳', '🎈', '🎉', '🎊', '🥳', '🎈', '🎉', '🎊'];
                emojis.forEach((emoji, i) => {
                    const el = document.createElement('div');
                    el.textContent = emoji;
                    const angle = (i / emojis.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
                    const dist = 80 + Math.random() * 60;
                    const tx = Math.cos(angle) * dist;
                    const ty = Math.sin(angle) * dist - 30; // slight upward bias
                    el.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;font-size:1.2em;pointer-events:none;z-index:9999;transition:all 1.2s ease-out;opacity:1;transform:translate(-50%,-50%)`;
                    document.body.appendChild(el);
                    requestAnimationFrame(() => {
                        el.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`;
                        el.style.opacity = '0';
                    });
                    setTimeout(() => el.remove(), 1300);
                });
            }, 200);

            setTimeout(() => banner.classList.add('fading-out'), 8000);
            setTimeout(() => { if (banner.parentElement) banner.remove(); }, 10000);
        }
    },

    // Roof color by nesting level. Level 0 = outermost (no containing arch);
    // deeper roofs nested inside get warmer colors.
    LEVEL_COLORS: [
        '#0d9488', // level 0 (outermost, no container) — teal
        '#3b82f6', // level 1 — blue
        '#8b5cf6', // level 2 — purple
        '#ec4899', // level 3 — pink
        '#f97316', // level 4 — orange
    ],

    _getNestingLevel(arch) {
        const s = this._state;
        const idx1 = s.words.findIndex(w => w.id === arch.wordId1);
        const idx2 = s.words.findIndex(w => w.id === arch.wordId2);
        const start = Math.min(idx1, idx2), end = Math.max(idx1, idx2);

        let level = 0;
        for (const other of s.arches) {
            if (other.id === arch.id) continue;
            const oi1 = s.words.findIndex(w => w.id === other.wordId1);
            const oi2 = s.words.findIndex(w => w.id === other.wordId2);
            const oStart = Math.min(oi1, oi2), oEnd = Math.max(oi1, oi2);
            // Count how many arches strictly contain this one
            if (oStart <= start && oEnd >= end && !(oStart === start && oEnd === end)) {
                level++;
            }
        }
        return level;
    },

    // General (כללי) role color — muted slate to indicate non-specific role
    GENERAL_ROLE_COLOR: '#93c5fd',

    _isGeneralRole(roleName) {
        if (!roleName || !this._generalRoles) return false;
        return this._generalRoles.has(roleName);
    },

    _getColorForArch(arch) {
        // Color follows nesting hierarchy only. Siblings at the same depth get the
        // same color regardless of whether their role is general (כללי) or specific —
        // the hierarchy itself is what the user reads visually.
        const level = this._getNestingLevel(arch);
        return this.LEVEL_COLORS[level % this.LEVEL_COLORS.length];
    },

    // #22/#23: Hologram mode — show ghost outline, let user click a word to close the roof
    _startHologramMode(arch, color, leftEdge, rightEdge, roofY, bottomY) {
        const s = this._state;
        const container = document.getElementById('sentence-container');
        if (!container) return;

        // Find the open end (left side in RTL = higher word index)
        const idx1 = s.words.findIndex(w => w.id === arch.wordId1);
        const idx2 = s.words.findIndex(w => w.id === arch.wordId2);
        const anchoredIdx = Math.min(idx1, idx2);

        // Confine extension to the surrounding roof's walls (Amitai 2026-06-06)
        const enc = this._getEnclosingArch(arch);

        // Create hologram overlay
        let hologram = document.getElementById('hologram-overlay');
        if (hologram) hologram.remove();

        hologram = document.createElement('div');
        hologram.id = 'hologram-overlay';
        hologram.className = 'hologram-overlay';
        hologram.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            z-index: 10; pointer-events: auto;
        `;

        // Show instruction
        MessageManager.show('לחץ על מילה כדי לסגור את הגג', 'info');

        // Make all words clickable with hologram preview
        s.words.forEach((word, wordIdx) => {
            const wrap = container.querySelector(`[data-word-id="${word.id}"]`);
            if (!wrap) return;
            const wb = wrap.querySelector('.word-block');
            if (!wb) return;

            const cRect = container.getBoundingClientRect();
            const wbRect = wb.getBoundingClientRect();
            const scrollL = container.scrollLeft, scrollT = container.scrollTop;

            // Create click target over each word
            const target = document.createElement('div');
            target.style.cssText = `
                position: absolute;
                top: ${wbRect.top - cRect.top + scrollT}px;
                left: ${wbRect.left - cRect.left + scrollL}px;
                width: ${wbRect.width}px;
                height: ${wbRect.height}px;
                cursor: pointer;
                z-index: 11;
                border-radius: 8px;
                transition: background 0.15s;
            `;

            // Hover preview: show ghost roof outline (#23)
            target.addEventListener('mouseenter', () => {
                target.style.background = `${color}20`;
                target.style.boxShadow = `0 0 8px ${color}40`;
            });
            target.addEventListener('mouseleave', () => {
                target.style.background = 'transparent';
                target.style.boxShadow = 'none';
            });

            target.addEventListener('click', (e) => {
                e.stopPropagation();
                // Block words beyond the surrounding roof's walls — keep picking
                if (enc && (wordIdx < enc.start || wordIdx > enc.end)) {
                    MessageManager.show('לא ניתן לחרוג מקירות הגג שמסביב', 'error');
                    return;
                }
                hologram.remove();
                this.closeOpenEndedRoof(arch.id, word.id);
            });

            // Dim words that are outside the surrounding roof (out of reach)
            if (enc && (wordIdx < enc.start || wordIdx > enc.end)) {
                target.style.cursor = 'not-allowed';
                target.addEventListener('mouseenter', () => {
                    target.style.background = 'rgba(239,68,68,0.10)';
                });
            }

            hologram.appendChild(target);
        });

        // Cancel on click outside words
        hologram.addEventListener('click', (e) => {
            if (e.target === hologram) {
                hologram.remove();
                MessageManager.show('ביטול', 'info', 1000);
            }
        });

        // Escape cancels
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                hologram.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        container.appendChild(hologram);
    },

    // Load syntactic roles data from JSON
    _rolesData: null,
    _rolesAbbrMap: {},
    _generalRoles: null, // Set of parent role names that have subItems (כללי roles)
    _showAbbreviations: true,
    _rolesLang: localStorage.getItem('plonter_roles_lang') || 'arabic', // 'arabic' or 'persian'
    _rolesCache: {}, // { arabic: data, persian: data }

    loadRolesData(forceLang) {
        var lang = forceLang || this._rolesLang;
        if (this._rolesCache[lang]) {
            this._rolesData = this._rolesCache[lang].categories;
            this._rolesAbbrMap = this._rolesCache[lang].abbrMap;
            this._generalRoles = this._rolesCache[lang].generalRoles;
            Object.assign(this.ROLE_ABBR, this._rolesAbbrMap);
            return Promise.resolve();
        }
        var jsonFile = lang === 'persian' ? 'syntactic_roles_persian.json?v=1.0'
            : lang === 'hebrew' ? 'syntactic_roles_hebrew.json?v=1.0'
            : 'syntactic_roles_data.json?v=4.17.7';
        var self = this;
        return fetch(jsonFile)
            .then(r => r.json())
            .then(data => {
                this._rolesData = data.categories;
                // Build abbreviation map: full → abbr
                this._rolesAbbrMap = {};
                for (const cat of Object.values(this._rolesData)) {
                    for (const item of cat) {
                        if (item.full !== item.abbr) this._rolesAbbrMap[item.full] = item.abbr;
                        if (item.subItems) {
                            for (const sub of item.subItems) {
                                if (sub.full !== sub.abbr) this._rolesAbbrMap[sub.full] = sub.abbr;
                                if (sub.isGroup && sub.subItems) {
                                    for (const nested of sub.subItems) {
                                        if (nested.full !== nested.abbr) this._rolesAbbrMap[nested.full] = nested.abbr;
                                    }
                                }
                            }
                        }
                    }
                }
                // Build set of "general" parent roles (items with subItems OR menuLabel containing כללי)
                this._generalRoles = new Set();
                for (const cat of Object.values(this._rolesData)) {
                    for (const item of cat) {
                        if (item.subItems && item.subItems.length > 0) {
                            this._generalRoles.add(item.full);
                        }
                        if (item.menuLabel && item.menuLabel.indexOf('כללי') !== -1) {
                            this._generalRoles.add(item.full);
                        }
                    }
                }
                // Merge into ROLE_ABBR for backwards compatibility
                Object.assign(this.ROLE_ABBR, this._rolesAbbrMap);
                // Cache for fast switching
                self._rolesCache[lang] = {
                    categories: self._rolesData,
                    abbrMap: Object.assign({}, self._rolesAbbrMap),
                    generalRoles: new Set(self._generalRoles)
                };
            })
            .catch(() => { /* fallback to hardcoded ROLE_ABBR */ });
    },

    switchRolesLang(lang) {
        this._rolesLang = lang;
        localStorage.setItem('plonter_roles_lang', lang);
        // Clear cached data to force reload
        this._rolesData = null;
        return this.loadRolesData(lang);
    },

    // Delete arch with check for alternatives
    _deleteArchWithCheck(archId) {
        const s = this._state;
        const hasAlt = s.arches.some(a => a.parentArchId === archId);
        if (!hasAlt) {
            s.removeArch(archId, true);
            Renderer.renderAll();
            return;
        }

        DialogManager.show({
            id: 'delete-arch-dialog',
            title: 'לגג הזה יש גג חלופי.<br>מה לעשות?',
            titleStyle: 'teal',
            cardWidth: '320px',
            buttonFontSize: '0.95em',
            buttons: [
                { label: 'למחוק את שניהם', variant: 'danger', onClick: () => {
                    s.removeArch(archId, true);
                    Renderer.renderAll();
                }},
                { label: 'למחוק רק את המקורי — החלופי יתפוס את מקומו', variant: 'info', onClick: () => {
                    s.promoteAlternative(archId);
                    Renderer.renderAll();
                }},
                { label: 'ביטול', variant: 'cancel', onClick: null },
            ],
        });
    },

    // Long-press detection: short click → onClick, long press → info status dialog
    _addLongPressHandlers(el, arch, onClick) {
        let timer = null;
        let longPressed = false;
        const LONG_PRESS_MS = 500;

        const startPress = (e) => {
            longPressed = false;
            timer = setTimeout(() => {
                longPressed = true;
                // Always open the info-status dialog — נתון/חידוש/ביטול apply even
                // before a syntactic role is picked (בלאגן #22, regression fix).
                this._openInfoStatusDialog(arch);
            }, LONG_PRESS_MS);
        };
        const endPress = (e) => {
            clearTimeout(timer);
            if (!longPressed) {
                e.stopPropagation();
                onClick();
            }
        };
        const cancelPress = () => { clearTimeout(timer); };

        el.addEventListener('mousedown', startPress);
        el.addEventListener('mouseup', endPress);
        el.addEventListener('mouseleave', cancelPress);
        el.addEventListener('touchstart', (e) => { startPress(e); }, { passive: true });
        el.addEventListener('touchend', (e) => {
            clearTimeout(timer);
            if (longPressed) {
                e.preventDefault();
            } else {
                e.stopPropagation();
                e.preventDefault();
                onClick();
            }
        });
        el.addEventListener('touchmove', cancelPress, { passive: true });
        el.addEventListener('touchcancel', cancelPress);
    },

    // Info status dialog (נתון/חידוש) — opened on long press
    _openInfoStatusDialog(arch) {
        const s = this._state;
        const roleName = this.ROLE_ABBR[arch.syntacticRole] || arch.externalRole || arch.syntacticRole || '';
        const headerText = roleName || 'הגדרות גג';

        const buttons = [];
        if (arch.infoStatus) {
            buttons.push({ label: roleName + ' (בלי תוספות)', variant: 'muted', onClick: () => {
                s.updateArch(arch.id, { infoStatus: null });
                Renderer.renderAll();
            }});
        }
        if (arch.infoStatus !== 'נתון') {
            buttons.push({ label: 'נתון', variant: 'info', onClick: () => {
                s.updateArch(arch.id, { infoStatus: 'נתון' });
                Renderer.renderAll();
            }});
        }
        if (arch.infoStatus !== 'חידוש') {
            buttons.push({ label: 'חידוש', variant: 'warn', onClick: () => {
                s.updateArch(arch.id, { infoStatus: 'חידוש' });
                Renderer.renderAll();
            }});
        }
        buttons.push({ label: 'ביטול', variant: 'cancel', onClick: null });

        DialogManager.show({
            id: 'info-status-dialog',
            title: headerText,
            titleStyle: 'plain',
            buttons,
        });
    },

    // Syntactic role modal — data-driven from JSON
    openRoleModal(arch) {
        const s = this._state;
        const self = this;

        // Entering the roofs/role menu cancels "עד מתי" + delete modes
        // (Amitai 2026-06-06): clicking two words while in one of those modes
        // creates an arch and opens this menu — at that point the mode should end.
        if (typeof Annotations !== 'undefined') {
            if (Annotations._openEndedMode) {
                Annotations._openEndedMode = false;
                if (Annotations.renderToolbar) Annotations.renderToolbar();
            }
            if (Annotations._exitDeleteMode) Annotations._exitDeleteMode();
        }

        // Ensure data is loaded
        const proceed = () => {
            // Check if existing role belongs to a sub-menu — open context-aware
            const existingRole = arch.syntacticRole || arch.externalRole;
            let contextParent = null;
            if (existingRole && self._rolesData) {
                for (const cat of Object.values(self._rolesData)) {
                    for (const item of cat) {
                        if (item.subItems) {
                            const match = item.subItems.find(sub => sub.full === existingRole);
                            if (match || item.full === existingRole) {
                                contextParent = item;
                                break;
                            }
                            // Check nested groups
                            for (const sub of item.subItems) {
                                if (sub.isGroup && sub.subItems && sub.subItems.find(n => n.full === existingRole)) {
                                    contextParent = item;
                                    break;
                                }
                            }
                        }
                    }
                    if (contextParent) break;
                }
            }

            let modal = document.getElementById('syntactic-role-modal');
            if (modal) modal.remove();

            modal = document.createElement('div');
            modal.id = 'syntactic-role-modal';
            modal.className = 'modal';
            modal.style.alignItems = 'flex-end';
            modal._currentArch = arch;

            const content = document.createElement('div');
            content.className = 'modal-content';
            // P1 fix: dynamic max-height so the role modal never covers the sentence.
            // Modal is flex-end (bottom-anchored); cap it so modal top > sentence bottom.
            const _sentEl = document.getElementById('sentence-container');
            const _sentBottom = _sentEl ? _sentEl.getBoundingClientRect().bottom : 0;
            const _availH = _sentBottom > 0
                ? Math.max(window.innerHeight - _sentBottom - 12, 200)
                : Math.floor(window.innerHeight * 0.48);
            const _maxH = Math.floor(Math.min(_availH, Math.floor(window.innerHeight * 0.55))) + 'px';
            content.style.cssText = `max-height:${_maxH};overflow-y:auto;direction:rtl;border-radius:14px 14px 0 0;margin-bottom:0;width:100%;max-width:600px`;

            // Header with close + toggle
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
            header.innerHTML = '<h3 style="margin:0;color:#0d9488">בחר תפקיד תחבירי</h3>';
            const closeBtn = document.createElement('span');
            closeBtn.className = 'close';
            closeBtn.innerHTML = '&times;';
            header.insertBefore(closeBtn, header.firstChild);

            // Language tabs (Arabic/Persian/Hebrew)
            var langTabs = { arabic: 'ערבית', persian: 'פרסית', hebrew: 'עברית' };
            var langTabsContainer = document.createElement('div');
            langTabsContainer.style.cssText = 'display:flex;gap:0;border:1px solid #6366f1;border-radius:6px;overflow:hidden;margin-left:4px';
            ['arabic', 'persian', 'hebrew'].forEach(function(lang) {
                var tab = document.createElement('button');
                var isActive = self._rolesLang === lang;
                tab.style.cssText = 'padding:3px 8px;border:none;cursor:pointer;font-size:0.75em;background:' + (isActive ? '#6366f1' : 'white') + ';color:' + (isActive ? 'white' : '#6366f1');
                tab.textContent = langTabs[lang];
                tab.onclick = function() {
                    if (self._rolesLang === lang) return;
                    self.switchRolesLang(lang).then(function() {
                        modal.classList.remove('show');
                        modal.remove();
                        self.openRoleModal(arch);
                    });
                };
                langTabsContainer.appendChild(tab);
            });
            header.appendChild(langTabsContainer);

            const toggleBtn = document.createElement('button');
            toggleBtn.style.cssText = 'padding:4px 10px;border:1px solid #0d9488;border-radius:6px;background:white;color:#0d9488;cursor:pointer;font-size:0.8em';
            toggleBtn.textContent = self._showAbbreviations ? 'שם מלא' : 'קיצורים';
            toggleBtn.onclick = () => {
                self._showAbbreviations = !self._showAbbreviations;
                toggleBtn.textContent = self._showAbbreviations ? 'שם מלא' : 'קיצורים';
                // Re-render buttons
                modal.querySelectorAll('.role-item-btn').forEach(btn => {
                    btn.textContent = self._showAbbreviations ? btn.dataset.abbr : btn.dataset.full;
                });
            };
            header.appendChild(toggleBtn);
            content.appendChild(header);

            // Search bar
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'חיפוש...';
            searchInput.style.cssText = 'width:100%;padding:8px 12px;border:2px solid #0d9488;border-radius:8px;font-size:1em;direction:rtl;outline:none;margin-bottom:10px;box-sizing:border-box';
            searchInput.id = 'role-search-input';

            // Search results container
            const searchResults = document.createElement('div');
            searchResults.id = 'role-search-results';
            searchResults.style.cssText = 'display:none;gap:4px;flex-wrap:wrap;margin-bottom:8px';

            content.appendChild(searchInput);
            content.appendChild(searchResults);

            const selectRole = (role) => {
                const currentArch = modal._currentArch;
                if (!currentArch) return;
                currentArch.syntacticRole = role;
                currentArch.externalRole = null;
                currentArch.isClause = role.startsWith('פסוקית') || role.startsWith('פז"ע') || role === 'صفة' || role === 'صلة';

                if (currentArch.isPending) {
                    delete currentArch.isPending;
                    s.addArch(currentArch);
                    SoundManager.playRoofCreated();
                } else {
                    s.updateArch(currentArch.id, { syntacticRole: role, isClause: currentArch.isClause });
                }

                s.firstArchClick = null;
                s.archCreationMode = false;
                modal._currentArch = null;
                modal.classList.remove('show');
                MessageManager.show('חלק תחבירי נבחר: ' + (self.ROLE_ABBR[role] || role), 'info');
                Renderer.renderAll();
            };

            // Main view
            const mainView = document.createElement('div');
            mainView.id = 'role-main-view';

            // Sub-view (hidden initially)
            const subView = document.createElement('div');
            subView.id = 'role-sub-view';
            subView.style.display = 'none';

            const catColors = ['#0d9488', '#3b82f6', '#16a34a', '#8b5cf6', '#ef4444', '#f59e0b', '#ec4899', '#d97706', '#6366f1', '#14b8a6', '#64748b', '#0ea5e9', '#f97316'];
            const catNames = self._rolesData ? Object.keys(self._rolesData) : [];

            catNames.forEach((catKey, ci) => {
                const items = self._rolesData[catKey];
                const catDiv = document.createElement('div');
                catDiv.style.cssText = 'margin-bottom:8px';

                const catHeader = document.createElement('div');
                const color = catColors[ci % catColors.length];
                catHeader.style.cssText = 'padding:6px 12px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;color:white;font-weight:bold;font-size:0.9em;background:' + color;
                const displayName = catKey.replace(/_/g, '/');
                catHeader.innerHTML = '<span>' + displayName + '</span><span class="role-cat-arrow">▼</span>';
                const catBody = document.createElement('div');
                catBody.style.cssText = 'display:none;padding:6px 0;gap:4px;flex-wrap:wrap';
                catBody.className = 'role-category-body';

                catHeader.onclick = () => {
                    const isOpen = catBody.style.display !== 'none';
                    catBody.style.display = isOpen ? 'none' : 'flex';
                    catHeader.querySelector('.role-cat-arrow').textContent = isOpen ? '▼' : '▲';
                };

                items.forEach((item, itemIdx) => {
                    const btn = document.createElement('button');
                    btn.className = 'role-btn role-item-btn';
                    if (item.fullRow) btn.style.cssText = 'width:100%;text-align:center;padding:8px;font-size:1.05em;font-weight:bold';
                    if (item.halfRow) btn.style.cssText = 'flex:1 1 45%;text-align:center;padding:8px';
                    if (item.thirdRow) btn.style.cssText = 'flex:1 1 30%;text-align:center;padding:8px;font-size:0.9em';
                    if (item.quarterRow) btn.style.cssText = 'flex:1 1 22%;text-align:center;padding:8px;font-size:0.85em';
                    if (item.fifthRow) btn.style.cssText = 'flex:1 1 18%;text-align:center;padding:6px;font-size:0.85em';
                    btn.dataset.full = item.full;
                    btn.dataset.abbr = item.abbr;
                    btn.textContent = self._showAbbreviations ? (item.menuLabelAbbr || item.abbr) : (item.menuLabel || item.full);
                    if (item.full === arch.syntacticRole) btn.classList.add('selected');
                    // Subtle blue for כללי / generalStyle items in main menu
                    if ((item.menuLabel && item.menuLabel.indexOf('כללי') !== -1) || item.generalStyle) {
                        btn.style.backgroundColor = 'rgba(147,197,253,0.15)';
                        btn.style.color = '#60a5fa';
                    }

                    if (item.subItems && item.subItems.length > 0 && !item.directSelect) {
                        btn.style.borderLeft = '3px solid ' + color;
                        btn.onclick = () => {
                            mainView.style.display = 'none';
                            subView.style.display = 'block';
                            subView.innerHTML = '';
                            const subTitle = document.createElement('p');
                            subTitle.style.cssText = 'font-weight:bold;margin-bottom:12px;color:' + color;
                            subTitle.textContent = 'בחר סוג ' + item.abbr + ':';
                            subView.appendChild(subTitle);
                            const subContainer = document.createElement('div');
                            subContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                            var parentAbbr = item.abbr;
                            var afterGeneralItems = [];
                            item.subItems.forEach(sub => {
                                if (sub.afterGeneral) { afterGeneralItems.push(sub); return; }
                                if (sub.isGroup && sub.subItems) {
                                    // Nested group button — opens another level
                                    const groupBtn = document.createElement('button');
                                    groupBtn.className = 'role-btn role-item-btn';
                                    groupBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em;border-left:3px solid #f59e0b';
                                    groupBtn.textContent = sub.full;
                                    groupBtn.onclick = () => {
                                        subView.innerHTML = '';
                                        const nestedTitle = document.createElement('p');
                                        nestedTitle.style.cssText = 'font-weight:bold;margin-bottom:12px;color:#f59e0b';
                                        nestedTitle.textContent = sub.full;
                                        subView.appendChild(nestedTitle);
                                        const nestedContainer = document.createElement('div');
                                        nestedContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                                        sub.subItems.forEach(nested => {
                                            const nBtn = document.createElement('button');
                                            nBtn.className = 'role-btn role-item-btn';
                                            nBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.05em';
                                            nBtn.textContent = self._showAbbreviations ? nested.abbr : nested.full;
                                            nBtn.onclick = () => selectRole(nested.full);
                                            nestedContainer.appendChild(nBtn);
                                        });
                                        subView.appendChild(nestedContainer);
                                        const nestedBack = document.createElement('button');
                                        nestedBack.className = 'btn btn-secondary';
                                        nestedBack.style.marginTop = '12px';
                                        nestedBack.textContent = 'חזרה';
                                        nestedBack.onclick = () => { btn.onclick(); }; // Re-render parent sub-menu
                                        subView.appendChild(nestedBack);
                                    };
                                    subContainer.appendChild(groupBtn);
                                } else {
                                    const subBtn = document.createElement('button');
                                    subBtn.className = 'role-btn role-item-btn';
                                    subBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em';
                                    subBtn.dataset.full = sub.full;
                                    subBtn.dataset.abbr = sub.abbr;
                                    // Use menuLabel if available, otherwise strip parent prefix
                                    if (sub.menuLabel) {
                                        subBtn.textContent = self._showAbbreviations ? (sub.menuLabelAbbr || sub.menuLabel) : sub.menuLabel;
                                    } else {
                                        var shortLabel = sub.abbr;
                                        if (shortLabel.indexOf(parentAbbr) === 0 && shortLabel.length > parentAbbr.length) {
                                            shortLabel = shortLabel.substring(parentAbbr.length).replace(/^[\-\s]+/, '');
                                        }
                                        subBtn.textContent = shortLabel || sub.abbr;
                                    }
                                    // Subtle blue for כללי, (רגיל), and generalStyle items
                                    if ((sub.menuLabel && (sub.menuLabel.indexOf('כללי') !== -1 || sub.menuLabel.indexOf('(רגיל)') !== -1)) || sub.generalStyle) {
                                        subBtn.style.backgroundColor = 'rgba(147,197,253,0.15)';
                                        subBtn.style.color = '#60a5fa';
                                    }
                                    subBtn.onclick = () => selectRole(sub.full);
                                    subContainer.appendChild(subBtn);
                                }
                            });
                            // Generic option (no sub-type) at bottom — only if subItems don't already include the parent
                            const hasParentInSubs = item.subItems.some(si => si.full === item.full);
                            if (!hasParentInSubs) {
                                const genBtn = document.createElement('button');
                                genBtn.className = 'role-btn role-item-btn';
                                genBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em;background-color:rgba(147,197,253,0.15);color:#60a5fa';
                                genBtn.textContent = (self._showAbbreviations ? item.abbr : item.abbr) + ' כללי';
                                genBtn.onclick = () => selectRole(item.full);
                                subContainer.appendChild(genBtn);
                            }
                            // Items marked afterGeneral go below כללי
                            afterGeneralItems.forEach(sub => {
                                const agBtn = document.createElement('button');
                                agBtn.className = 'role-btn role-item-btn';
                                agBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em';
                                agBtn.dataset.full = sub.full;
                                agBtn.dataset.abbr = sub.abbr;
                                if (sub.menuLabel) {
                                    agBtn.textContent = self._showAbbreviations ? (sub.menuLabelAbbr || sub.menuLabel) : sub.menuLabel;
                                } else {
                                    agBtn.textContent = self._showAbbreviations ? sub.abbr : sub.full;
                                }
                                agBtn.onclick = () => selectRole(sub.full);
                                subContainer.appendChild(agBtn);
                            });
                            subView.appendChild(subContainer);
                            const backBtn = document.createElement('button');
                            backBtn.className = 'btn btn-secondary';
                            backBtn.style.marginTop = '12px';
                            backBtn.textContent = 'חזרה';
                            backBtn.onclick = () => {
                                subView.style.display = 'none';
                                mainView.style.display = '';
                            };
                            subView.appendChild(backBtn);
                        };
                    } else {
                        btn.onclick = () => selectRole(item.full);
                    }
                    catBody.appendChild(btn);
                    if (item.belowLine) {
                        var sepBelow = document.createElement('hr');
                        sepBelow.style.cssText = 'width:100%;border:none;border-top:1px solid #d1d5db;margin:4px 0';
                        catBody.appendChild(sepBelow);
                    }
                    if (item.separatorAfter) {
                        var sepAfter = document.createElement('hr');
                        sepAfter.style.cssText = 'width:100%;border:none;border-top:1px solid #d1d5db;margin:4px 0';
                        catBody.appendChild(sepAfter);
                    }
                });

                // Auto-expand category if it contains the existing role
                if (existingRole && !contextParent) {
                    const hasRole = items.some(item => {
                        if (item.full === existingRole) return true;
                        if (item.subItems) return item.subItems.some(sub => {
                            if (sub.full === existingRole) return true;
                            if (sub.isGroup && sub.subItems) return sub.subItems.some(n => n.full === existingRole);
                            return false;
                        });
                        return false;
                    });
                    if (hasRole) {
                        catBody.style.display = 'flex';
                        catHeader.querySelector('.role-cat-arrow').textContent = '▲';
                        setTimeout(() => catHeader.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                    }
                }

                catDiv.appendChild(catHeader);
                catDiv.appendChild(catBody);
                mainView.appendChild(catDiv);
            });

            content.appendChild(mainView);
            content.appendChild(subView);

            // Search handler — collect all roles for filtering
            const allRoles = [];
            if (self._rolesData) {
                for (const cat of Object.values(self._rolesData)) {
                    for (const item of cat) {
                        allRoles.push(item);
                        if (item.subItems) {
                            for (const sub of item.subItems) {
                                if (!sub.isGroup) allRoles.push(sub);
                                if (sub.isGroup && sub.subItems) {
                                    for (const nested of sub.subItems) {
                                        allRoles.push(nested);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // Strip quotes/geresh for fuzzy matching
            const stripQuotes = (s) => s.replace(/[""״'׳'\-–—\s]/g, '');

            // Check if item (or any sub-item) matches query
            const itemMatches = (item, qNorm) => {
                if (stripQuotes(item.full).includes(qNorm) || stripQuotes(item.abbr).includes(qNorm)) return true;
                if (item.subItems) {
                    return item.subItems.some(sub => {
                        if (stripQuotes(sub.full).includes(qNorm) || stripQuotes(sub.abbr).includes(qNorm)) return true;
                        if (sub.isGroup && sub.subItems) return sub.subItems.some(n => stripQuotes(n.full).includes(qNorm) || stripQuotes(n.abbr).includes(qNorm));
                        return false;
                    });
                }
                return false;
            };

            searchInput.oninput = () => {
                const q = searchInput.value.trim();
                if (!q) {
                    searchResults.style.display = 'none';
                    mainView.style.display = '';
                    subView.style.display = 'none';
                    return;
                }
                mainView.style.display = 'none';
                subView.style.display = 'none';
                searchResults.style.display = 'block';
                searchResults.innerHTML = '';
                const qNorm = stripQuotes(q);

                // Part 1: Category-based filtered results
                var anyCategory = false;
                var shownInCategories = new Set();
                catNames.forEach((catKey, ci) => {
                    const items = self._rolesData[catKey];
                    const matchingItems = items.filter(item => itemMatches(item, qNorm));
                    if (matchingItems.length === 0) return;
                    anyCategory = true;

                    const color = catColors[ci % catColors.length];
                    const catDiv = document.createElement('div');
                    catDiv.style.cssText = 'margin-bottom:8px';
                    const catHeader = document.createElement('div');
                    catHeader.style.cssText = 'padding:6px 12px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;color:white;font-weight:bold;font-size:0.9em;background:' + color;
                    catHeader.innerHTML = '<span>' + catKey.replace(/_/g, '/') + '</span><span class="role-cat-arrow">▼</span>';
                    const catBody = document.createElement('div');
                    catBody.style.cssText = 'display:none;padding:6px 0;gap:4px;flex-wrap:wrap';

                    catHeader.onclick = () => {
                        var isOpen = catBody.style.display !== 'none';
                        catBody.style.display = isOpen ? 'none' : 'flex';
                        catHeader.querySelector('.role-cat-arrow').textContent = isOpen ? '▼' : '▲';
                    };

                    matchingItems.forEach(item => {
                        var btn = document.createElement('button');
                        btn.className = 'role-btn role-item-btn';
                        if (item.fullRow) btn.style.cssText = 'width:100%;text-align:center;padding:8px;font-size:1.05em;font-weight:bold';
                        if (item.halfRow) btn.style.cssText = 'flex:1 1 45%;text-align:center;padding:8px';
                        if (item.thirdRow) btn.style.cssText = 'flex:1 1 30%;text-align:center;padding:8px;font-size:0.9em';
                        btn.dataset.full = item.full;
                        btn.dataset.abbr = item.abbr;
                        btn.textContent = self._showAbbreviations ? (item.menuLabelAbbr || item.abbr) : (item.menuLabel || item.full);
                        if (item.full === arch.syntacticRole) btn.classList.add('selected');
                        if (stripQuotes(item.full) === qNorm || stripQuotes(item.abbr) === qNorm) {
                            btn.style.outline = '2.5px solid #0d9488';
                            btn.style.outlineOffset = '-1px';
                            btn.style.fontWeight = 'bold';
                        }

                        if (item.subItems && item.subItems.length > 0 && !item.directSelect) {
                            btn.style.borderLeft = '3px solid ' + color;
                            // keep default border-radius, just add left border indicator
                            btn.onclick = () => {
                                var currentQ = stripQuotes(searchInput.value.trim());
                                searchResults.style.display = 'none';
                                subView.style.display = 'block';
                                subView.innerHTML = '';
                                var subTitle = document.createElement('p');
                                subTitle.style.cssText = 'font-weight:bold;margin-bottom:12px;color:' + color;
                                subTitle.textContent = 'בחר סוג ' + item.abbr + ':';
                                subView.appendChild(subTitle);
                                var subCont = document.createElement('div');
                                subCont.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                                // Filter sub-items by search query
                                var filteredSubs = item.subItems.filter(sub => {
                                    if (!currentQ) return true;
                                    if (stripQuotes(sub.full).includes(currentQ) || stripQuotes(sub.abbr).includes(currentQ)) return true;
                                    if (sub.isGroup && sub.subItems) return sub.subItems.some(n => stripQuotes(n.full).includes(currentQ) || stripQuotes(n.abbr).includes(currentQ));
                                    return false;
                                });
                                // If no filtered results, show all (parent itself matched)
                                if (filteredSubs.length === 0) filteredSubs = item.subItems;
                                filteredSubs.forEach(sub => {
                                    if (sub.isGroup && sub.subItems) {
                                        // Filter nested items too
                                        var filteredNested = currentQ ? sub.subItems.filter(n => stripQuotes(n.full).includes(currentQ) || stripQuotes(n.abbr).includes(currentQ)) : sub.subItems;
                                        if (filteredNested.length === 0) filteredNested = sub.subItems;
                                        var gBtn = document.createElement('button');
                                        gBtn.className = 'role-btn role-item-btn';
                                        gBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em;border-left:3px solid #f59e0b';
                                        gBtn.textContent = sub.full;
                                        gBtn.onclick = function() {
                                            subView.innerHTML = '';
                                            var nTitle = document.createElement('p');
                                            nTitle.style.cssText = 'font-weight:bold;margin-bottom:12px;color:#f59e0b';
                                            nTitle.textContent = sub.full;
                                            subView.appendChild(nTitle);
                                            var nCont = document.createElement('div');
                                            nCont.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                                            filteredNested.forEach(function(nested) {
                                                var nBtn = document.createElement('button');
                                                nBtn.className = 'role-btn role-item-btn';
                                                nBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.05em';
                                                nBtn.textContent = self._showAbbreviations ? nested.abbr : nested.full;
                                                nBtn.onclick = function() { selectRole(nested.full); };
                                                nCont.appendChild(nBtn);
                                            });
                                            subView.appendChild(nCont);
                                            var nBack = document.createElement('button');
                                            nBack.className = 'btn btn-secondary';
                                            nBack.style.marginTop = '12px';
                                            nBack.textContent = 'חזרה';
                                            nBack.onclick = function() { subView.style.display = 'none'; searchResults.style.display = 'block'; };
                                            subView.appendChild(nBack);
                                        };
                                        subCont.appendChild(gBtn);
                                    } else {
                                        var sBtn = document.createElement('button');
                                        sBtn.className = 'role-btn role-item-btn';
                                        sBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em';
                                        sBtn.textContent = sub.menuLabel ? (self._showAbbreviations ? (sub.menuLabelAbbr || sub.menuLabel) : sub.menuLabel) : (self._showAbbreviations ? sub.abbr : sub.full);
                                        sBtn.onclick = function() { selectRole(sub.full); };
                                        subCont.appendChild(sBtn);
                                    }
                                });
                                subView.appendChild(subCont);
                                var backBtn = document.createElement('button');
                                backBtn.className = 'btn btn-secondary';
                                backBtn.style.marginTop = '12px';
                                backBtn.textContent = 'חזרה';
                                backBtn.onclick = function() { subView.style.display = 'none'; searchResults.style.display = 'block'; };
                                subView.appendChild(backBtn);
                            };
                        } else {
                            btn.onclick = function() { selectRole(item.full); };
                        }
                        catBody.appendChild(btn);
                        shownInCategories.add(item.full);

                        // Show matching sub-items as direct shortcuts below the parent
                        if (item.subItems && item.subItems.length > 0 && qNorm) {
                            var allSubs = [];
                            item.subItems.forEach(function(sub) {
                                if (sub.isGroup && sub.subItems) {
                                    sub.subItems.forEach(function(n) { allSubs.push(n); });
                                } else if (!sub.isGroup) {
                                    allSubs.push(sub);
                                }
                            });
                            var matchingSubs = allSubs.filter(function(s) {
                                return stripQuotes(s.full).includes(qNorm) || stripQuotes(s.abbr).includes(qNorm);
                            });
                            if (matchingSubs.length > 0) {
                                var shortcuts = document.createElement('div');
                                shortcuts.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;width:100%;padding:2px 8px 4px';
                                matchingSubs.forEach(function(sub) {
                                    var sBtn = document.createElement('button');
                                    sBtn.className = 'role-btn role-item-btn';
                                    sBtn.style.cssText = 'padding:5px 10px;font-size:0.85em;background:#f0fdfa;border:1px solid ' + color;
                                    sBtn.textContent = '• ' + (self._showAbbreviations ? sub.abbr : sub.full);
                                    if (stripQuotes(sub.full) === qNorm || stripQuotes(sub.abbr) === qNorm) {
                                        sBtn.style.outline = '2.5px solid #0d9488';
                                        sBtn.style.outlineOffset = '-1px';
                                        sBtn.style.fontWeight = 'bold';
                                    }
                                    sBtn.onclick = function() { selectRole(sub.full); };
                                    shortcuts.appendChild(sBtn);
                                });
                                catBody.appendChild(shortcuts);
                            }
                        }
                    });

                    catDiv.appendChild(catHeader);
                    catDiv.appendChild(catBody);
                    searchResults.appendChild(catDiv);
                });

                // Part 2: Flat results below separator (all matching items)
                var flatMatches = allRoles.filter(r => stripQuotes(r.full).includes(qNorm) || stripQuotes(r.abbr).includes(qNorm));
                if (flatMatches.length > 0) {
                    if (anyCategory) {
                        var sep = document.createElement('hr');
                        sep.style.cssText = 'border:none;border-top:2px solid #d1d5db;margin:12px 0';
                        searchResults.appendChild(sep);
                    }
                    var flatContainer = document.createElement('div');
                    flatContainer.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
                    flatMatches.forEach(r => {
                        var btn = document.createElement('button');
                        btn.className = 'role-btn role-item-btn';
                        btn.dataset.full = r.full;
                        btn.dataset.abbr = r.abbr;
                        btn.textContent = self._showAbbreviations ? r.abbr : r.full;
                        if (r.full === arch.syntacticRole) btn.classList.add('selected');
                        if (stripQuotes(r.full) === qNorm || stripQuotes(r.abbr) === qNorm) {
                            btn.style.outline = '2.5px solid #0d9488';
                            btn.style.outlineOffset = '-1px';
                            btn.style.fontWeight = 'bold';
                        }
                        btn.onclick = function() { selectRole(r.full); };
                        flatContainer.appendChild(btn);
                    });
                    searchResults.appendChild(flatContainer);
                }

                if (!anyCategory && flatMatches.length === 0) {
                    searchResults.innerHTML = '<span style="color:#94a3b8;font-size:0.9em">לא נמצאו תוצאות</span>';
                }
            };

            // Cancel button
            const actions = document.createElement('div');
            actions.style.cssText = 'margin-top:15px;text-align:center';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.textContent = 'ביטול';
            actions.appendChild(cancelBtn);
            content.appendChild(actions);
            modal.appendChild(content);
            document.body.appendChild(modal);

            // Cancel handler
            const cancelHandler = () => {
                if (modal._currentArch && modal._currentArch.isPending) {
                    MessageManager.show('יצירת גג בוטלה', 'warning');
                }
                s.firstArchClick = null;
                s.archCreationMode = false;
                modal._currentArch = null;
                modal.classList.remove('show');
                Renderer.renderAll();
            };
            closeBtn.onclick = cancelHandler;
            cancelBtn.onclick = cancelHandler;
            modal.onclick = (e) => { if (e.target === modal) cancelHandler(); };

            modal.classList.add('show');
            // P1 fix: scroll sentence into the visible band above the modal (best-effort)
            if (_sentEl) {
                const _modalTopAfter = window.innerHeight - parseInt(_maxH);
                const _curBottom = _sentEl.getBoundingClientRect().bottom;
                if (_curBottom > _modalTopAfter - 8) {
                    // Try window scroll first; falls back to scrollIntoView
                    window.scrollBy({top: _curBottom - _modalTopAfter + 8, behavior: 'smooth'});
                    setTimeout(() => {
                        if (_sentEl.getBoundingClientRect().bottom > _modalTopAfter - 8) {
                            _sentEl.scrollIntoView({block: 'start', behavior: 'smooth'});
                        }
                    }, 120);
                }
            }
            setTimeout(() => { searchInput.focus(); }, 100);

            // Context-aware: if existing role has a parent sub-menu, show it directly
            if (contextParent && contextParent.subItems) {
                var mainViewEl = document.getElementById('role-main-view');
                var subViewEl = document.getElementById('role-sub-view');
                if (mainViewEl && subViewEl) {
                    mainViewEl.style.display = 'none';
                    subViewEl.style.display = 'block';
                    subViewEl.innerHTML = '';
                    var subTitle = document.createElement('p');
                    subTitle.style.cssText = 'font-weight:bold;margin-bottom:12px;color:#0d9488';
                    subTitle.textContent = 'בחר סוג ' + contextParent.abbr + ':';
                    subViewEl.appendChild(subTitle);
                    var subCont = document.createElement('div');
                    subCont.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                    var ctxParentAbbr = contextParent.abbr;
                    contextParent.subItems.forEach(function(sub) {
                        if (sub.isGroup && sub.subItems) {
                            var groupBtn = document.createElement('button');
                            groupBtn.className = 'role-btn role-item-btn';
                            groupBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em;border-left:3px solid #f59e0b';
                            groupBtn.textContent = sub.full;
                            groupBtn.onclick = function() {
                                subViewEl.innerHTML = '';
                                var nestedTitle = document.createElement('p');
                                nestedTitle.style.cssText = 'font-weight:bold;margin-bottom:12px;color:#f59e0b';
                                nestedTitle.textContent = sub.full;
                                subViewEl.appendChild(nestedTitle);
                                var nestedCont = document.createElement('div');
                                nestedCont.style.cssText = 'display:flex;flex-direction:column;gap:6px';
                                sub.subItems.forEach(function(nested) {
                                    var nBtn = document.createElement('button');
                                    nBtn.className = 'role-btn role-item-btn';
                                    nBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.05em';
                                    nBtn.textContent = self._showAbbreviations ? nested.abbr : nested.full;
                                    if (nested.full === existingRole) nBtn.classList.add('selected');
                                    nBtn.onclick = function() { selectRole(nested.full); };
                                    nestedCont.appendChild(nBtn);
                                });
                                subViewEl.appendChild(nestedCont);
                                var nestedBack = document.createElement('button');
                                nestedBack.className = 'btn btn-secondary';
                                nestedBack.style.marginTop = '12px';
                                nestedBack.textContent = 'חזרה';
                                nestedBack.onclick = function() {
                                    // Re-render context parent menu
                                    mainViewEl.style.display = 'none';
                                    subViewEl.style.display = 'block';
                                    subViewEl.innerHTML = '';
                                    var reTitle = document.createElement('p');
                                    reTitle.style.cssText = 'font-weight:bold;margin-bottom:12px;color:#0d9488';
                                    reTitle.textContent = 'בחר סוג ' + contextParent.abbr + ':';
                                    subViewEl.appendChild(reTitle);
                                    // Trigger same logic by simulating re-entry — use main view show
                                    subViewEl.style.display = 'none';
                                    mainViewEl.style.display = '';
                                    // Find and click the contextParent button in main view
                                    var parentBtns = mainViewEl.querySelectorAll('.role-item-btn');
                                    for (var i = 0; i < parentBtns.length; i++) {
                                        if (parentBtns[i].dataset.full === contextParent.full) { parentBtns[i].click(); break; }
                                    }
                                };
                                subViewEl.appendChild(nestedBack);
                            };
                            subCont.appendChild(groupBtn);
                        } else {
                            var subBtn = document.createElement('button');
                            subBtn.className = 'role-btn role-item-btn';
                            subBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em';
                            subBtn.dataset.full = sub.full;
                            subBtn.dataset.abbr = sub.abbr;
                            if (sub.menuLabel) {
                                subBtn.textContent = self._showAbbreviations ? (sub.menuLabelAbbr || sub.menuLabel) : sub.menuLabel;
                            } else {
                                var shortLabel = sub.abbr;
                                if (shortLabel.indexOf(ctxParentAbbr) === 0 && shortLabel.length > ctxParentAbbr.length) {
                                    shortLabel = shortLabel.substring(ctxParentAbbr.length).replace(/^[\-\s]+/, '');
                                }
                                subBtn.textContent = shortLabel || sub.abbr;
                            }
                            if (sub.full === existingRole) subBtn.classList.add('selected');
                            subBtn.onclick = function() { selectRole(sub.full); };
                            subCont.appendChild(subBtn);
                        }
                    });
                    var hasParentInCtxSubs = contextParent.subItems.some(function(si) { return si.full === contextParent.full; });
                    if (!hasParentInCtxSubs) {
                        var genBtn = document.createElement('button');
                        genBtn.className = 'role-btn role-item-btn';
                        genBtn.style.cssText = 'width:100%;text-align:center;padding:10px;font-size:1.1em';
                        genBtn.textContent = contextParent.abbr + ' כללי';
                        genBtn.onclick = function() { selectRole(contextParent.full); };
                        subCont.appendChild(genBtn);
                    }
                    subViewEl.appendChild(subCont);
                    var backToMenu = document.createElement('button');
                    backToMenu.className = 'btn btn-secondary';
                    backToMenu.style.marginTop = '12px';
                    backToMenu.textContent = 'חזרה לתפריט';
                    backToMenu.onclick = function() {
                        subViewEl.style.display = 'none';
                        mainViewEl.style.display = '';
                    };
                    subViewEl.appendChild(backToMenu);
                }
            }
        };

        if (!this._rolesData) {
            this.loadRolesData().then(proceed);
        } else {
            proceed();
        }
    }
};
