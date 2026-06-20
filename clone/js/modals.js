// Modals — POS menu (categorized), stage selector
// modals.js v4.17.26 (2026-05-13) — single-line POS menu layout on
// desktop ≥1392px (Amitai @6m). openPosMenu injects a scoped <style>
// override: widens .pos-modal-wide to min(1100px,96vw), switches each
// .pos-type-grid from 2-col grid to a single flex row with
// overflow-x:auto safety, and trims button padding/font so 6 POS
// buttons fit horizontally. No CSS file edit — keeps css/style.css
// (and index.html) untouched per @6m contract.
// modals.js v4.17.25 (2026-05-09) — domain-scoped continue-work,
// full domain-accent palette (analysis/hindus/text/lesson), hide-zero
// categories, last-touched section highlight (~1.5s) with stable-id +
// manual-close respect, default→domain:כללי normalization, and
// `plonter_ui_*` localStorage keys with 7-day self-prune. Pure
// render/UI/state — no save-flow / auth / contentSync / user-switch
// changes. Other forbidden files (index.html, lessons.js, texts.js,
// auth.js, contentSync.js, hindusMode.js, hindusSync.js, stages.js)
// were not edited; cross-cutting items that live there are noted in
// REPORT_TASK_<id>.md instead.

const Modals = {
    _state: null,
    // SAVE_CONTRACT Phase 3 — delegation hook for adapter-owned stage cards.
    // Adapter authors (analysisAdapter, hindusAdapter, …) call
    // Modals.registerStageRenderer(type, fn) where fn(stage, ctx) returns a
    // DOM Element to take over rendering for matching stages, or null to
    // fall through to the default _createStageItem path. ctx is
    // { isCustom: <bool>, modals: <Modals>, ContentSync: window.ContentSync }.
    //
    // Renderers are stored by type so re-registering replaces. Iteration
    // order follows insertion (modern JS Object.keys semantics) — first
    // non-null Element wins. The default path runs whenever NO registered
    // renderer claims the stage, so existing behaviour is preserved 1:1
    // for all built-in / un-adapted stage types.
    //
    // Example:
    //   Modals.registerStageRenderer('sentence', function(stage, ctx) {
    //       if (!stage.isCustom) return null;     // built-ins → default
    //       return MyAnalysisAdapter.renderStageCard(stage, ctx);
    //   });
    _stageRenderers: {},
    registerStageRenderer(type, fn) {
        if (typeof type !== 'string' || !type) {
            console.warn('[Modals] registerStageRenderer: invalid type', type);
            return;
        }
        if (typeof fn !== 'function') {
            console.warn('[Modals] registerStageRenderer: fn must be a function');
            return;
        }
        this._stageRenderers[type] = fn;
    },

    _wireCreateDialogEnterFlow(modal, fieldSelectors, submitSelector) {
        if (!modal) return;
        const fields = (fieldSelectors || []).map(sel => modal.querySelector(sel)).filter(Boolean);
        const submitBtn = modal.querySelector(submitSelector);
        fields.forEach((field, index) => {
            field.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
                e.preventDefault();
                const nextField = fields[index + 1];
                if (nextField) {
                    nextField.focus();
                    if (nextField.tagName === 'INPUT' && typeof nextField.select === 'function') nextField.select();
                    return;
                }
                if (submitBtn) submitBtn.click();
            });
        });
    },

    init(stateManager) {
        this._state = stateManager;
    },

    // Categorized POS menu (Amitai #16, #17, #24)
    openPosMenu(wordId) {
        const s = this._state;

        let modal = document.getElementById('pos-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pos-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <style id="pos-modal-layout-v4-17-26">
                    /* Single-line POS layout override (Amitai @6m 2026-05-13).
                       Scoped to #pos-modal so no other CSS leaks. Switches
                       the per-category button grid from 2-col to a single
                       flex row, widens the modal, and tightens the buttons.
                       css/style.css remains the canonical source for shape
                       — these rules only flatten the wrap on desktop. */
                    #pos-modal .modal-content.pos-modal-wide {
                        max-width: min(1100px, 96vw);
                        width: min(1100px, 96vw);
                    }
                    #pos-modal .pos-categories {
                        gap: 8px;
                    }
                    #pos-modal .pos-category-header {
                        padding: 8px 12px;
                        font-size: 1em;
                    }
                    #pos-modal .pos-category-body {
                        padding: 6px 0;
                    }
                    #pos-modal .pos-type-grid {
                        display: flex;
                        flex-wrap: nowrap;
                        gap: 6px;
                        overflow-x: auto;
                        padding-bottom: 2px;
                    }
                    #pos-modal .pos-type-btn {
                        flex: 1 1 0;
                        min-width: 108px;
                        padding: 8px 8px;
                        font-size: 0.95em;
                        white-space: nowrap;
                        border-radius: 8px;
                    }
                    /* Narrow phones — fall back to a 2-col grid so the row
                       doesn't become an awkward horizontal scroller on a
                       cramped viewport. Desktop spec is ≥1392px, so the
                       break at 520px is purely a mobile-safety net. */
                    @media (max-width: 520px) {
                        #pos-modal .pos-type-grid {
                            display: grid;
                            grid-template-columns: repeat(2, 1fr);
                            overflow-x: visible;
                        }
                        #pos-modal .pos-type-btn {
                            min-width: 0;
                        }
                    }
                </style>
                <div class="modal-content pos-modal-wide">
                    <span class="close">&times;</span>
                    <h3>בחר חלק דיבר</h3>
                    <div class="pos-categories">
                        ${this._buildPosCategories()}
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Close handlers
            modal.querySelector('.close').onclick = () => modal.classList.remove('show');
            modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };

            // Category toggles
            modal.querySelectorAll('.pos-category-header').forEach(h => {
                h.addEventListener('click', () => {
                    const body = modal.querySelector(`[data-pos-cat-body="${h.dataset.posCat}"]`);
                    const arrow = h.querySelector('.pos-cat-arrow');
                    body.classList.toggle('open');
                    arrow.textContent = body.classList.contains('open') ? '▲' : '▼';
                });
            });
        }

        modal._wordId = wordId;

        // Scroll to top (Amitai #11)
        const content = modal.querySelector('.modal-content');
        if (content) content.scrollTop = 0;

        // Wire POS buttons — click = immediate select (Amitai #10)
        modal.querySelectorAll('.pos-type-btn').forEach(btn => {
            btn.onclick = () => {
                const type = btn.dataset.posType;
                const pos = s.addPartOfSpeech(modal._wordId, type);
                modal.classList.remove('show');
                Renderer.renderAll();

                // Auto-open details panel (Amitai #19) — skip for particles
                if (pos && !isParticleType(type)) {
                    setTimeout(() => DetailsPanel.open(modal._wordId, pos.id), 100);
                }
            };
        });

        modal.classList.add('show');
    },

    _buildPosCategories() {
        const categories = [
            {
                key: 'nouns', name: 'שמות', icon: '📦',
                types: [
                    { key: 'noun', name: 'שם עצם' },
                    { key: 'adjective', name: 'שם תואר' },
                    { key: 'personalPronoun', name: 'כינוי גוף' },
                    { key: 'demonstrative', name: 'כינוי רמז' },
                    { key: 'relativePronoun', name: 'שם זיקה' },
                    { key: 'questionWord', name: 'מילת שאלה' }
                ]
            },
            {
                key: 'verbs', name: 'פעלים', icon: '⚙️',
                types: [
                    { key: 'verb', name: 'פועל' },
                    { key: 'adverb', name: 'תואר הפועל' }
                ]
            },
            {
                key: 'particles', name: 'מיליות', icon: '🔗',
                types: [
                    { key: 'preposition', name: 'מילית יחס' },
                    { key: 'conjunction', name: 'מילית חיבור' },
                    { key: 'subordinating', name: 'מילית שיעבוד' },
                    { key: 'negation', name: 'מילית שלילה' },
                    { key: 'jazm', name: 'מילית מג\'זום' },
                    { key: 'conditional', name: 'מילית תנאי' }
                ]
            }
        ];

        return categories.map(cat => `
            <div class="pos-category">
                <div class="pos-category-header" data-pos-cat="${cat.key}">
                    <span>${cat.icon} ${cat.name}</span>
                    <span class="pos-cat-arrow">▲</span>
                </div>
                <div class="pos-category-body open" data-pos-cat-body="${cat.key}">
                    <div class="pos-type-grid">
                        ${cat.types.map(t => `
                            <button class="pos-type-btn" data-pos-type="${t.key}">
                                ${t.name}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `).join('');
    },

    // Welcome screen stage rendering
    renderStages() {
        try { this._pruneUiKeys(); } catch (_) {}
        const customSection = document.getElementById('custom-section');
        const customContainer = document.getElementById('stages-custom');
        const wbContainer = document.getElementById('stages-workbook');
        const mtContainer = document.getElementById('stages-midterm');
        const persianContainer = document.getElementById('stages-persian');
        const hdContainer = document.getElementById('stages-hindus');
        const stagesContainer = document.querySelector('.stages-container');
        if (!wbContainer || !mtContainer) return;

        // Remove any previously created dynamic category/list sections
        stagesContainer.querySelectorAll('.dynamic-category-section').forEach(el => el.remove());
        stagesContainer.querySelectorAll('.sentence-list-ui').forEach(el => el.remove());

        // Custom stages (#26) — group by category, separate hindus from syntax.
        // Guest-mode filter: hide sentences that are server-backed when the
        // user isn't logged in (privacy — mirrors lessons/texts behavior).
        const _csAvail = typeof ContentSync !== 'undefined';
        const _guestMode = _csAvail && typeof ContentSync.isLoggedIn === 'function' && !ContentSync.isLoggedIn();
        function _isTechnicalGeneralCategory(cat) {
            var raw = String(cat || '').trim().toLowerCase();
            return !raw || raw === 'default' || raw === 'undefined' || raw === 'null' || raw === 'custom';
        }
        function _isHindusStageRaw(stage) {
            var rawCat = String(stage && stage.category || '').trim().toLowerCase();
            return !!(stage && (stage.source_domain === 'hindus' || stage.isHindus || ((rawCat === 'hindus' || rawCat === 'default') && stage.answer)));
        }
        function _normalizeStageCategory(stage) {
            var raw = String(stage && stage.category || '').trim();
            if (_isHindusStageRaw(stage)) {
                return _isTechnicalGeneralCategory(raw) || raw.toLowerCase() === 'hindus' ? 'hindus' : raw;
            }
            return _isTechnicalGeneralCategory(raw) ? 'custom' : raw;
        }
        function _categoryStorageKey(cat) {
            return 'plonter_collapsed_cat_' + _normalizeStoragePart(cat);
        }
        function _normalizeStoragePart(value) {
            return String(value || 'custom').trim() || 'custom';
        }
        function _categoryDisplayName(cat, domain) {
            var raw = String(cat || '').trim();
            if (!raw || raw.toLowerCase() === 'default' || raw.toLowerCase() === 'undefined' || raw.toLowerCase() === 'null') return 'כללי';
            if (domain === 'hindus' && (raw === 'hindus' || raw === 'custom')) return 'כללי';
            if (raw === 'custom') return 'כללי';
            return raw;
        }
        const _rawCustoms = getCustomStages().filter(s => {
            if (!_guestMode) return true;
            if (!s || !s.id) return true;
            // Guest should see NO examples (Amitai 2026-04-19 07:57). Both
            // the seed-flag and the "seed_<userId>_..." id pattern mean the
            // row is a user-logged-in seed of a built-in stage, which a
            // guest shouldn't see. Same goes for anything already synced to
            // server — those belong to a logged-in account, not the guest.
            if (s._isBuiltinSeed === true) return false;
            if (typeof s.id === 'string' && s.id.indexOf('seed_') === 0) return false;
            if (ContentSync.isSynced && ContentSync.isSynced('sentence', s.id)) return false;
            return true;
        });
        // Dedupe by visible identity (name, sentence, category): sometimes a
        // custom stage ends up duplicated when the seed copy syncs to server
        // and a later pullAll re-inserts it under a different id. Do not
        // collapse same-sentence items with different names — the duplicate
        // title flow intentionally renames the new item to "X 2".
        const _isSyncedCheck = function(s) {
            try {
                return !!(typeof ContentSync !== 'undefined' &&
                          typeof ContentSync.isSynced === 'function' &&
                          ContentSync.isSynced('sentence', s.id));
            } catch (e) { return false; }
        };
        const _customsByKey = {};
        _rawCustoms.forEach(function(s) {
            if (!s || !s.sentence) return;
            var key = (s.number || s.title || '') + '|' + (s.sentence || '').trim() + '|' + _normalizeStageCategory(s);
            var existing = _customsByKey[key];
            if (!existing) { _customsByKey[key] = s; return; }
            var curSynced = _isSyncedCheck(s);
            var exSynced = _isSyncedCheck(existing);
            if (curSynced && !exSynced) { _customsByKey[key] = s; return; }
            if (!curSynced && exSynced) return;
            var curTs = new Date(s.updated || 0).getTime() || 0;
            var exTs = new Date(existing.updated || 0).getTime() || 0;
            if (curTs > exTs) _customsByKey[key] = s;
        });
        const customs = Object.values(_customsByKey).sort(function(a, b) {
            var ap = Number(a && a._priorityFromGuestUntil || 0);
            var bp = Number(b && b._priorityFromGuestUntil || 0);
            var now = Date.now();
            var aActive = ap && ap > now ? 1 : 0;
            var bActive = bp && bp > now ? 1 : 0;
            if (aActive !== bActive) return bActive - aActive;
            var ac = new Date(a && (a._guestPinnedAt || a._createdFromGuestAt || a.updated) || 0).getTime() || 0;
            var bc = new Date(b && (b._guestPinnedAt || b._createdFromGuestAt || b.updated) || 0).getTime() || 0;
            return bc - ac;
        });
        const customsByCategory = {};
        const hindusByCategory = {};
        customs.forEach(stage => {
            const cat = _normalizeStageCategory(stage);
            if (_isHindusStageRaw(stage)) {
                // Hindus items go to hindus section
                var hCat = (cat === 'hindus' || cat === 'custom') ? 'hindus' : cat;
                if (!hindusByCategory[hCat]) hindusByCategory[hCat] = [];
                hindusByCategory[hCat].push(stage);
            } else {
                if (!customsByCategory[cat]) customsByCategory[cat] = [];
                customsByCategory[cat].push(stage);
            }
        });

        // Built-in category mapping (for syntax only)
        const builtinCatMap = {
            'workbook': wbContainer, 'חוברת': wbContainer,
            'midterm': mtContainer, 'תרגיל אמצע': mtContainer,
            'persian': persianContainer, 'פרסית': persianContainer
        };

        // Clear built-in containers
        if (customContainer) customContainer.innerHTML = '';
        wbContainer.innerHTML = '';
        mtContainer.innerHTML = '';
        if (persianContainer) persianContainer.innerHTML = '';
        if (hdContainer) hdContainer.innerHTML = '';

        const activeSentenceFilter = localStorage.getItem('plonter_sentence_list_filter_v1') || 'all';
        const _getActiveStageDomain = function() {
            var hindusTab = document.getElementById('tab-hindus');
            if (hindusTab && hindusTab.style.color === 'white') return 'hindus';
            var analysisTab = document.getElementById('tab-analysis');
            if (analysisTab && analysisTab.style.color === 'white') return 'analysis';
            return null;
        };
        const activeStageDomain = _getActiveStageDomain();
        const activeStageSectionClass = activeStageDomain === 'hindus'
            ? 'hindus-section-welcome'
            : (activeStageDomain === 'analysis' ? 'analysis-section-welcome' : '');
        const _domainAccent = function(domain) {
            if (domain === 'hindus') return { main: '#d97706', pale: '#fffbeb', line: '#fbbf24', label: 'הינדוס' };
            if (domain === 'text' || domain === 'texts') return { main: '#2563eb', pale: '#eff6ff', line: '#bfdbfe', label: 'טקסט' };
            if (domain === 'lesson' || domain === 'lessons') return { main: '#7c3aed', pale: '#f5f3ff', line: '#c4b5fd', label: 'שיעור' };
            return { main: '#0d9488', pale: '#f0fdfa', line: '#99f6e4', label: 'תחביר' };
        };
        const _isHindusStage = function(stage) {
            return _isHindusStageRaw(stage);
        };
        const _stageDomain = function(stage) {
            return _isHindusStage(stage) ? 'hindus' : 'analysis';
        };
        const _matchesActiveStageDomain = function(stage) {
            if (!activeStageDomain) return false;
            return _stageDomain(stage) === activeStageDomain;
        };
        const _getSyncState = function(stage) {
            if (!stage || !stage.isCustom || stage._isBuiltinSeed === true) return 'example';
            if (stage._createdAsGuest === true || stage._guestBackupStatus === 'not_backed_up') return 'unsynced';
            try {
                if (typeof ContentSync !== 'undefined' && typeof ContentSync.getSyncState === 'function') {
                    return ContentSync.getSyncState('sentence', stage.id) || 'unsynced';
                }
            } catch (_) {}
            return 'unsynced';
        };
        const _isRecentStage = function(stage) {
            var t = new Date(stage && (stage._guestPinnedAt || stage._createdFromGuestAt || stage.updated || stage.created) || 0).getTime() || 0;
            return t && (Date.now() - t) < (14 * 24 * 60 * 60 * 1000);
        };
        const _isExampleStage = function(stage, hardcoded) {
            return !!(hardcoded || (stage && (stage._isBuiltinSeed === true || stage.source_type === 'example_stage' || stage._guestWorkingCopy === true)));
        };
        const _passesSentenceFilter = function(stage, hardcoded) {
            if (!stage) return false;
            var state = _getSyncState(stage);
            var isExample = _isExampleStage(stage, hardcoded);
            if (activeSentenceFilter === 'mine') return !!stage.isCustom && !isExample;
            if (activeSentenceFilter === 'examples') return isExample;
            if (activeSentenceFilter === 'unsynced') return state === 'unsynced' || state === 'pending';
            if (activeSentenceFilter === 'recent') return _isRecentStage(stage);
            return true;
        };
        const _filteredStages = function(stages, hardcoded) {
            return (stages || []).filter(function(stage) { return _passesSentenceFilter(stage, hardcoded); });
        };
        const _forceOpenStageCategory = function(stage) {
            if (!stage) return;
            try {
                var cat = _normalizeStageCategory(stage);
                var keys = [];
                if (_isHindusStage(stage)) {
                    keys.push('plonter_collapsed_stages-hindus');
                    if (cat && cat !== 'hindus' && cat !== 'custom') keys.push('plonter_collapsed_cat_' + cat);
                } else {
                    if (cat === 'workbook' || cat === 'חוברת') keys.push('plonter_collapsed_stages-workbook');
                    else if (cat === 'midterm' || cat === 'תרגיל אמצע') keys.push('plonter_collapsed_stages-midterm');
                    else if (cat === 'persian' || cat === 'פרסית') keys.push('plonter_collapsed_stages-persian');
                    else if (cat === 'custom') keys.push('plonter_collapsed_stages-custom');
                    else keys.push('plonter_collapsed_cat_' + cat);
                }
                keys.forEach(function(k) { localStorage.setItem(k, '0'); });
                sessionStorage.setItem('plonter_highlight_stage_id', String(stage.id || ''));
            } catch (_) {}
        };
        const _statusLabel = function(stage, hardcoded) {
            if (hardcoded || stage._isBuiltinSeed === true) return 'דוגמה';
            if (stage._guestWorkingCopy || stage.source_type === 'example_stage') return 'נוצר מדוגמה';
            var state = _getSyncState(stage);
            if (state === 'pending') return 'בתהליך גיבוי...';
            if (state === 'unsynced') return 'לא מגובה';
            if (_isRecentStage(stage)) return 'אחרון';
            return 'מגובה';
        };
        const _continueStatusAccent = function(stage) {
            var label = _statusLabel(stage, false);
            if (label === 'בתהליך גיבוי...') return { label: label, main: '#16a34a', line: '#86efac', pale: '#f0fdf4' };
            if (label === 'לא מגובה') return { label: label, main: '#d97706', line: '#fcd34d', pale: '#fffbeb' };
            if (label === 'נוצר מדוגמה') return { label: label, main: '#7c3aed', line: '#c4b5fd', pale: '#f5f3ff' };
            if (label === 'דוגמה') return { label: label, main: '#2563eb', line: '#bfdbfe', pale: '#eff6ff' };
            if (label === 'אחרון') return { label: label, main: '#0d9488', line: '#99f6e4', pale: '#f0fdfa' };
            return { label: label, main: '#059669', line: '#a7f3d0', pale: '#ecfdf5' };
        };
        const _sentenceListUiHost = function() {
            var host = stagesContainer.querySelector('.sentence-list-ui-host');
            if (host) return host;
            host = document.createElement('div');
            host.className = 'sentence-list-ui sentence-list-ui-host ' + activeStageSectionClass;
            host.style.cssText = 'display:block;direction:rtl';
            var firstSection = stagesContainer.querySelector('.category-section');
            stagesContainer.insertBefore(host, firstSection || stagesContainer.firstChild);
            return host;
        };
        const _renderSentenceListTabs = () => {
            if (!stagesContainer || !activeStageDomain) return;
            var tabs = [
                ['all', 'הכל'],
                ['mine', 'שלי'],
                ['examples', 'דוגמאות'],
                ['unsynced', 'לא מגובה'],
                ['recent', 'אחרונים']
            ];
            var wrap = document.createElement('div');
            wrap.className = 'sentence-list-ui sentence-filter-tabs ' + activeStageSectionClass;
            wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 12px 12px;direction:rtl';
            tabs.forEach(function(pair) {
                var btn = document.createElement('button');
                var active = activeSentenceFilter === pair[0];
                btn.textContent = pair[1];
                btn.style.cssText = 'padding:7px 12px;border-radius:999px;border:1px solid ' + (active ? '#0d9488' : '#cbd5e1') + ';background:' + (active ? '#ccfbf1' : '#fff') + ';color:' + (active ? '#0f766e' : '#475569') + ';font-weight:800;cursor:pointer;font-size:.86em';
                btn.onclick = function() {
                    localStorage.setItem('plonter_sentence_list_filter_v1', pair[0]);
                    Modals.renderStages();
                };
                wrap.appendChild(btn);
            });
            _sentenceListUiHost().appendChild(wrap);
        };
        const _renderContinueWork = () => {
            if (!stagesContainer || !activeStageDomain) return;
            var candidates = customs.filter(function(stage) {
                if (!stage || !stage.isCustom) return false;
                if (!_matchesActiveStageDomain(stage)) return false;
                return _getSyncState(stage) !== 'synced' ||
                    stage._guestWorkingCopy === true ||
                    stage.source_type === 'example_stage' ||
                    _isRecentStage(stage);
            }).slice(0, 4);
            if (!candidates.length) return;
            var section = document.createElement('div');
            section.className = 'sentence-list-ui ' + activeStageSectionClass;
            section.style.cssText = 'margin:4px 12px 12px;direction:rtl';
            var title = document.createElement('div');
            title.textContent = 'המשך עבודה';
            var activeAccent = _domainAccent(activeStageDomain);
            title.style.cssText = 'font-size:.95em;font-weight:900;color:' + activeAccent.main + ';margin:0 0 8px';
            section.appendChild(title);
            var grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px';
            candidates.forEach((stage) => {
                var accent = _domainAccent(_stageDomain(stage));
                var statusAccent = _continueStatusAccent(stage);
                var card = document.createElement('button');
                card.type = 'button';
                card.style.cssText = 'text-align:right;border:1px solid ' + statusAccent.line + ';border-right:6px solid ' + statusAccent.main + ';background:' + statusAccent.pale + ';border-radius:8px;padding:14px 15px;cursor:pointer;min-height:112px;font-family:inherit;color:#0f172a;box-shadow:0 8px 18px rgba(15,23,42,.07);display:flex;flex-direction:column;justify-content:space-between';
                card.innerHTML =
                    '<div style="display:flex;gap:6px;align-items:center;justify-content:space-between;margin-bottom:5px">' +
                    '  <b style="font-size:1.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (stage.number || 'משפט') + '</b>' +
                    '  <span style="font-size:.74em;font-weight:900;background:#fff;color:' + statusAccent.main + ';border:1px solid ' + statusAccent.line + ';border-radius:999px;padding:2px 8px;white-space:nowrap">' + statusAccent.label + '</span>' +
                    '</div>' +
                    '<div style="font-size:.9em;color:#334155;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + (stage.sentence || '') + '</div>' +
                    '<div style="height:3px;border-radius:999px;background:linear-gradient(90deg,' + statusAccent.main + ',' + accent.line + ');opacity:.85;margin-top:10px"></div>';
                card.onclick = function() { Modals._startStage(stage); };
                grid.appendChild(card);
            });
            section.appendChild(grid);
            _sentenceListUiHost().appendChild(section);
        };
        _renderSentenceListTabs();
        _renderContinueWork();
        // Auto-open last-touched category on every render — but only
        // if the user has not manually CLOSED that same category since
        // the last_open marker. The user-toggle is recorded under
        // plonter_ui_user_toggle_<id>_v1 by the collapsible click
        // handlers below; if its timestamp is newer than last.at and
        // it says collapsed=true, we respect the user and skip the
        // force-open. Stable id only — keys derive from container.id
        // (built-in sections) or category name (dynamic).
        try {
            var lastRaw = sessionStorage.getItem('plonter_last_open_category_v1');
            var last = lastRaw ? JSON.parse(lastRaw) : null;
            if (last && last.domain === activeStageDomain && (Date.now() - Number(last.at || 0)) < 10 * 60 * 1000) {
                var _lastAt = Number(last.at || 0);
                var _userClosedAfter = function(toggleKey) {
                    try {
                        var raw = localStorage.getItem(toggleKey);
                        if (!raw) return false;
                        var t = JSON.parse(raw);
                        return !!(t && typeof t.at === 'number' && t.at > _lastAt && t.collapsed === true);
                    } catch (_) { return false; }
                };
                if (last.categoryId && last.categoryId.indexOf('cat:') === 0) {
                    var lastCat = _isTechnicalGeneralCategory(last.category)
                        ? (last.domain === 'hindus' ? 'hindus' : 'custom')
                        : last.category;
                    if (!_userClosedAfter('plonter_ui_user_toggle_cat_' + lastCat + '_v1')) {
                        localStorage.setItem(_categoryStorageKey(lastCat), '0');
                    }
                } else if (last.categoryId) {
                    if (!_userClosedAfter('plonter_ui_user_toggle_' + last.categoryId + '_v1')) {
                        localStorage.setItem('plonter_collapsed_' + last.categoryId, '0');
                    }
                }
            }
        } catch (_) {}
        try { this._applyPendingStageHighlight(); } catch (_) {}

        // Make a section collapsible with localStorage persistence
        const _makeCollapsible = (container, color) => {
            if (!container) return;
            var section = container.closest('.category-section');
            if (!section) return;
            var title = section.querySelector('.category-title');
            if (!title) return;
            var arrow = title.querySelector('.sentence-collapse-arrow');
            if (!title.dataset.collapsible) {
                title.dataset.collapsible = '1';
                title.style.cursor = 'pointer';
                title.style.userSelect = 'none';
                arrow = document.createElement('span');
                arrow.className = 'sentence-collapse-arrow';
                arrow.style.cssText = 'font-size:0.7em;color:' + (color || '#6b7280') + ';transition:transform 0.2s;margin-left:6px';
                title.insertBefore(arrow, title.firstChild);
                title.addEventListener('click', function() {
                    var key = 'plonter_collapsed_' + container.id;
                    var collapsed = container.style.display === 'none';
                    container.style.display = collapsed ? '' : 'none';
                    if (arrow) arrow.textContent = collapsed ? '▼' : '▶';
                    localStorage.setItem(key, collapsed ? '0' : '1');
                    // Track manual user toggle so a recent auto-open
                    // marker doesn't immediately re-open what the user
                    // just closed. Stable id = container.id.
                    try {
                        localStorage.setItem('plonter_ui_user_toggle_' + container.id + '_v1',
                            JSON.stringify({ collapsed: !collapsed, at: Date.now() }));
                    } catch (_) {}
                });
            }
            // Restore collapsed state from localStorage
            var storageKey = 'plonter_collapsed_' + container.id;
            var savedCollapsed = localStorage.getItem(storageKey);
            var isCollapsed = activeSentenceFilter === 'all'
                ? (savedCollapsed == null ? true : savedCollapsed === '1')
                : false;
            container.style.display = isCollapsed ? 'none' : '';
            if (arrow) arrow.textContent = isCollapsed ? '▶' : '▼';
        };

        // Built-in STAGES rendering policy (Amitai 2026-04-19 07:48):
        //   guest             → NEVER render — a "Want examples? Log in!"
        //                        CTA card is appended instead, see below.
        //   logged-in + seed  → don't render — the customs loop shows the
        //                        user's editable seeded copies.
        //   logged-in + !seed → render as read-only fallback until the
        //                        per-user seed runs.
        var _loggedInCS = typeof ContentSync !== 'undefined' &&
            typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
        var _seedOwner = _loggedInCS ? localStorage.getItem('plonter_data_owner') : null;
        var _seedDoneUser = _seedOwner ? !!localStorage.getItem('plonter_stages_seeded_' + _seedOwner) : false;
        var _hasVisibleSeedCopy = customs.some(function(s) {
            return s && s._isBuiltinSeed === true &&
                typeof s.id === 'string' &&
                s.id.indexOf('seed_') === 0 &&
                !(s.isHindus || s.category === 'hindus');
        });
        // If editable seed copies already exist, do not render the hardcoded
        // examples too. The seed flag can be stale/missing after migrations,
        // but visible seed copies are the real source of truth.
        var _renderBuiltins = _loggedInCS && !_hasVisibleSeedCopy;
        if (_renderBuiltins) {
            _filteredStages(STAGES.workbook, true).forEach(stage => wbContainer.appendChild(this._createStageItem(stage)));
            _filteredStages(STAGES.midterm, true).forEach(stage => mtContainer.appendChild(this._createStageItem(stage)));
            if (persianContainer && STAGES.persian) {
                _filteredStages(STAGES.persian, true).forEach(stage => persianContainer.appendChild(this._createStageItem(stage)));
            }
            if (hdContainer && STAGES.hindus) {
                _filteredStages(STAGES.hindus, true).forEach(stage => hdContainer.appendChild(this._createStageItem(stage)));
            }
        }
        // Section visibility + guest ghost placeholders.
        // Amitai 2026-04-19 08:02 — in guest mode we show the category
        // headers with "ghost" shimmer cards instead of real examples; a
        // click on any ghost opens the login dialog. Feels more inviting
        // than an empty screen.
        [wbContainer, mtContainer, persianContainer, hdContainer].forEach(function(c) {
            if (!c) return;
            var sec = c.closest('.category-section');
            if (sec) sec.style.display = '';
        });

        // 📤 העתק הקטגוריה — add an export button to the built-in category
        // headers so the hardcoded workbook/midterm/hindus/persian decks can
        // be copied as JSON just like the dynamic custom categories already
        // can (Amitai 2026-04-19 08:07). Hidden in guest mode — the built-in
        // content is gated behind the ghost-cards UX there.
        if (!_guestMode) {
            var _selfM = this;
            var _addBuiltinExportBtn = function(container, categoryKey) {
                if (!container) return;
                var sec = container.closest('.category-section');
                if (!sec) return;
                var title = sec.querySelector('.category-title');
                if (!title) return;
                if (title.dataset.exportBtnAttached) return;
                title.dataset.exportBtnAttached = '1';
                var btn = document.createElement('button');
                btn.textContent = '📤 העתק הקטגוריה';
                btn.style.cssText = 'margin-right:8px;padding:4px 10px;font-size:0.78em;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;vertical-align:middle';
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    _selfM._copyCategoryJson(categoryKey);
                });
                title.appendChild(btn);
            };
            _addBuiltinExportBtn(wbContainer, 'workbook');
            _addBuiltinExportBtn(mtContainer, 'midterm');
            _addBuiltinExportBtn(persianContainer, 'פרסית');
            _addBuiltinExportBtn(hdContainer, 'hindus');
        }

        if (_guestMode) {
            // Pre-login confirmation dialog (Amitai 2026-04-19 08:05) — when
            // a guest taps any ghost card, explain *why* they're being asked
            // to log in before opening the actual auth form.
            var _promptLoginForExamples = function() {
                var overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px';
                var box = document.createElement('div');
                box.style.cssText = 'background:white;border-radius:14px;max-width:420px;width:100%;padding:22px;direction:rtl;box-shadow:0 12px 40px rgba(0,0,0,0.28);font-family:inherit;text-align:center';
                box.innerHTML =
                    '<h3 style="margin:0 0 10px;color:#92400e;font-size:1.15em">🔒 משפטים לדוגמה — חסומים לאורחים</h3>' +
                    '<p style="margin:0 0 16px;line-height:1.55;color:#1f2937">על מנת לגשת למשפטים האלה עליך להתחבר. אחרי התחברות הם יופיעו כאן, ותוכל גם לערוך אותם ולשמור אותם אצלך.</p>' +
                    '<div style="display:flex;gap:8px;justify-content:center">' +
                    '  <button id="ge-login" style="padding:10px 22px;border:none;border-radius:10px;background:#d97706;color:white;font-size:1em;font-weight:bold;cursor:pointer">התחבר</button>' +
                    '  <button id="ge-cancel" style="padding:10px 18px;border:1px solid #cbd5e1;border-radius:10px;background:white;color:#475569;font-size:1em;cursor:pointer">ביטול</button>' +
                    '</div>';
                overlay.appendChild(box);
                document.body.appendChild(overlay);
                var close = function() { overlay.remove(); };
                box.querySelector('#ge-cancel').onclick = close;
                overlay.onclick = function(e) { if (e.target === overlay) close(); };
                box.querySelector('#ge-login').onclick = function() {
                    close();
                    if (typeof PlonterAuth !== 'undefined' && PlonterAuth.showLoginDialog) {
                        PlonterAuth.showLoginDialog(function() {
                            try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (e) {}
                        });
                    }
                };
            };
            // Guest examples are read-only origins. First click creates a
            // local guest working copy and opens that copy, never mutating
            // the built-in example. The copy is offered for account backup
            // after login by auth.js's guest sentence backup flow.
            var _makeGuestTeaserItem = function(stage) {
                var item = document.createElement('div');
                item.className = 'stage-item guest-teaser-item';
                item.style.cursor = 'pointer';
                item.innerHTML =
                    '<div class="stage-number" style="display:flex;gap:8px;align-items:center"><span style="flex:1">' + (stage.number || '') + '</span><span style="font-size:0.72em;background:#ecfeff;color:#0e7490;border:1px solid #67e8f9;border-radius:999px;padding:2px 7px">דוגמה</span></div>' +
                    '<div class="stage-sentence">' + (stage.sentence || '') + '</div>';
                item.title = 'לחץ כדי לעבוד על עותק אורח של משפט הדוגמה';
                item.addEventListener('click', function() {
                    var copy = Modals._getOrCreateGuestExampleCopy(stage);
                    if (copy) {
                        try { if (typeof MessageManager !== 'undefined') MessageManager.show('נשמר זמנית כאורח', 'info', 1800); } catch (_) {}
                        Modals.renderStages();
                        Modals._startStage(copy);
                    } else {
                        _promptLoginForExamples();
                    }
                });
                return item;
            };
            var _fillGuestTeasers = function(container, stages) {
                if (!container || !stages) return;
                stages.forEach(function(stage) { container.appendChild(_makeGuestTeaserItem(stage)); });
            };
            if (wbContainer && STAGES.workbook) _fillGuestTeasers(wbContainer, _filteredStages(STAGES.workbook, true));
            if (mtContainer && STAGES.midterm) _fillGuestTeasers(mtContainer, _filteredStages(STAGES.midterm, true));
            if (persianContainer && STAGES.persian) _fillGuestTeasers(persianContainer, _filteredStages(STAGES.persian, true));
            if (hdContainer && STAGES.hindus) _fillGuestTeasers(hdContainer, _filteredStages(STAGES.hindus, true));
        }
        // Guest CTA — one card at the bottom of the stages list on each
        // tab (syntax + hindus). Removes itself automatically when the user
        // logs in.
        var existingCta = document.getElementById('guest-examples-cta');
        if (existingCta) existingCta.remove();
        if (_guestMode) {
            var cta = document.createElement('div');
            cta.id = 'guest-examples-cta';
            cta.style.cssText = 'margin:16px 12px;padding:18px 16px;border-radius:14px;background:linear-gradient(135deg,#ecfdf5,#ccfbf1);border:2px dashed #10b981;text-align:center;direction:rtl;display:flex;flex-direction:column;gap:10px;align-items:center';
            var msg = document.createElement('div');
            msg.textContent = '☁️ רוצה לשמור קבצים בענן? הצטרף!';
            msg.style.cssText = 'font-size:1.1em;font-weight:bold;color:#047857';
            cta.appendChild(msg);
            var btn = document.createElement('button');
            btn.textContent = 'כניסה למשתמש';
            btn.style.cssText = 'padding:10px 24px;border:none;border-radius:10px;background:#0d9488;color:white;font-size:1em;font-weight:bold;cursor:pointer;box-shadow:0 2px 6px rgba(13,148,136,0.28)';
            btn.onclick = function() {
                if (typeof PlonterAuth !== 'undefined' && PlonterAuth.showLoginDialog) {
                    PlonterAuth.showLoginDialog(function() {
                        try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (e) {}
                    });
                }
            };
            cta.appendChild(btn);
            if (stagesContainer) stagesContainer.appendChild(cta);
        }

        // Make all built-in sections collapsible
        _makeCollapsible(wbContainer, '#0d9488');
        _makeCollapsible(mtContainer, '#0d9488');
        _makeCollapsible(persianContainer, '#6366f1');
        _makeCollapsible(hdContainer, '#d97706');

        const _decorateStaticCategory = function(container) {
            if (!container) return;
            var section = container.closest('.category-section');
            var title = section && section.querySelector('.category-title');
            if (!title) return;
            title.querySelectorAll('.sentence-cat-meta').forEach(function(el) { el.remove(); });
            var items = Array.prototype.slice.call(container.querySelectorAll('.stage-item'));
            var previews = items.slice(0, 2).map(function(item) {
                var n = item.querySelector('.stage-number span') || item.querySelector('.stage-number');
                return n ? String(n.textContent || '').trim() : '';
            }).filter(Boolean).join(' · ');
            var meta = document.createElement('span');
            meta.className = 'sentence-cat-meta';
            meta.textContent = items.length + ' משפטים' + (previews ? ' · ' + previews : '');
            meta.style.cssText = 'font-size:.76em;color:#64748b;font-weight:600;margin-right:8px;vertical-align:middle';
            title.appendChild(meta);
            var sec = container.closest('.category-section');
            if (sec) {
                sec.style.display = items.length ? '' : 'none';
                if (!items.length) container.style.display = 'none';
            }
        };
        // Sort categories by newest stage first (most recently created category at top)
        const _sortByNewest = (entries) => {
            return entries.sort((a, b) => {
                const aMax = Math.max(...a[1].map(s => parseInt(s.id?.replace(/\D/g,'') || '0')));
                const bMax = Math.max(...b[1].map(s => parseInt(s.id?.replace(/\D/g,'') || '0')));
                return bMax - aMax;
            });
        };

        // Create a collapsible category section with localStorage persistence
        const _createCategorySection = (cat, stages, color, cssClass) => {
            const section = document.createElement('div');
            section.className = `category-section dynamic-category-section ${cssClass}`;
            // Stable id for section-level highlight + future state lookup
            section.dataset.cat = String(cat || '');
            section.dataset.domain = cssClass && cssClass.indexOf('hindus') !== -1 ? 'hindus' : 'analysis';
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none';
            const arrow = document.createElement('span');
            arrow.style.cssText = `font-size:0.7em;color:${color || '#6b7280'};transition:transform 0.2s`;
            const title = document.createElement('h2');
            title.className = 'category-title';
            if (color) title.style.color = color;
            var displayDomain = cssClass && cssClass.indexOf('hindus') !== -1 ? 'hindus' : 'analysis';
            title.textContent = _categoryDisplayName(cat, displayDomain);
            header.appendChild(arrow);
            header.appendChild(title);
            var meta = document.createElement('span');
            var previews = stages.slice(0, 2).map(function(s) { return s.number || (s.sentence || '').slice(0, 18); }).join(' · ');
            meta.textContent = stages.length + ' משפטים' + (previews ? ' · ' + previews : '');
            meta.style.cssText = 'font-size:.78em;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0';
            header.appendChild(meta);
            // 📤 export-category button in the header. Copies every stage
            // in this category as a JSON array to the clipboard.
            const exportBtn = document.createElement('button');
            exportBtn.textContent = '📤 העתק הקטגוריה';
            exportBtn.style.cssText = 'margin-right:8px;padding:4px 10px;font-size:0.78em;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer';
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._copyCategoryJson(cat, stages);
            });
            header.appendChild(exportBtn);
            const list = document.createElement('div');
            list.className = 'stages-list';
            stages.forEach(stage => list.appendChild(this._createStageItem(stage)));
            var storageKey = _categoryStorageKey(cat);
            var savedCollapsed = localStorage.getItem(storageKey);
            var isCollapsed = activeSentenceFilter === 'all'
                ? (savedCollapsed == null ? true : savedCollapsed === '1')
                : false;
            list.style.display = isCollapsed ? 'none' : '';
            arrow.textContent = isCollapsed ? '▶' : '▼';
            header.addEventListener('click', () => {
                const collapsed = list.style.display === 'none';
                list.style.display = collapsed ? '' : 'none';
                arrow.textContent = collapsed ? '▼' : '▶';
                localStorage.setItem(storageKey, collapsed ? '0' : '1');
                // Manual user toggle marker — same purpose as the
                // built-in section handler above. Stable id = cat name.
                try {
                    localStorage.setItem('plonter_ui_user_toggle_cat_' + cat + '_v1',
                        JSON.stringify({ collapsed: !collapsed, at: Date.now() }));
                } catch (_) {}
            });
            section.appendChild(header);
            section.appendChild(list);
            return section;
        };

        // Place hindus custom stages — custom categories at top (newest first), built-in at bottom
        if (hdContainer) {
            const sortedHindus = _sortByNewest(Object.entries(hindusByCategory));
            var hdSection = hdContainer.closest('.category-section');
            for (const [cat, rawStages] of sortedHindus) {
                const stages = _filteredStages(rawStages, false);
                if (!stages.length) continue;
                if (cat === 'hindus') {
                    // Guest/user-created copies belong before bundled hindus
                    // examples, matching the syntax sections.
                    stages.slice().reverse().forEach(stage => {
                        hdContainer.insertBefore(this._createStageItem(stage), hdContainer.firstChild);
                    });
                } else {
                    const section = _createCategorySection(cat, stages, '#d97706', 'hindus-section-welcome');
                    // Insert before the built-in hindus section (newest first = at top)
                    if (hdSection && hdSection.parentElement) {
                        hdSection.parentElement.insertBefore(section, hdSection);
                    }
                }
            }
        }

        // Place custom stages into matching or new categories
        let hasUncategorized = false;
        const sortedCustoms = _sortByNewest(Object.entries(customsByCategory));
        for (const [cat, rawStages] of sortedCustoms) {
            const stages = _filteredStages(rawStages, false);
            if (!stages.length) continue;
            const builtinContainer = builtinCatMap[cat];
            if (builtinContainer) {
                // Guest/user-created copies belong before bundled examples
                // inside the same visible category, so fresh work is not
                // buried at the bottom of "חוברת" / "תרגיל אמצע".
                stages.slice().reverse().forEach(stage => {
                    builtinContainer.insertBefore(this._createStageItem(stage), builtinContainer.firstChild);
                });
            } else if (cat === 'custom') {
                // Uncategorized — goes to "משפטים שלי"
                hasUncategorized = true;
                stages.forEach(stage => customContainer.appendChild(this._createStageItem(stage)));
            } else {
                const section = _createCategorySection(cat, stages, null, 'analysis-section-welcome');
                // Insert before the first built-in category (newest first = at top)
                stagesContainer.insertBefore(section, customSection ? customSection.nextSibling : stagesContainer.firstChild);
            }
        }

        // Show/hide "משפטים שלי" section
        if (customSection) {
            customSection.style.display = hasUncategorized ? '' : 'none';
        }
        _decorateStaticCategory(wbContainer);
        _decorateStaticCategory(mtContainer);
        _decorateStaticCategory(persianContainer);
        _decorateStaticCategory(hdContainer);

        // Re-sync section visibility with active tab (new dynamic sections need this)
        if (typeof switchWelcomeTab === 'function') {
            var activeTab = document.getElementById('tab-hindus')?.style.color === 'white' ? 'hindus'
                : document.getElementById('tab-lessons')?.style.color === 'white' ? 'lessons'
                : document.getElementById('tab-texts')?.style.color === 'white' ? 'texts'
                : document.getElementById('tab-media')?.style.color === 'white' ? 'media'
                : 'analysis';
            switchWelcomeTab(activeTab);
        }
    },

    filterStages(query) {
        if (!query.trim()) {
            this.renderStages();
            // Also reset lessons list if on lessons tab
            if (typeof LessonManager !== 'undefined' && document.getElementById('tab-lessons')?.style.color === 'white') {
                LessonManager.renderLessonsList();
            }
            return;
        }
        // Determine active tab — only filter stages relevant to it
        const activeTab = document.getElementById('tab-analysis')?.style.color === 'white' ? 'analysis'
            : document.getElementById('tab-hindus')?.style.color === 'white' ? 'hindus'
            : document.getElementById('tab-lessons')?.style.color === 'white' ? 'lessons' : 'analysis';
        // Lessons tab — filter lessons, not stages
        if (activeTab === 'lessons') {
            if (typeof LessonManager !== 'undefined') LessonManager.filterLessonsList(query);
            return;
        }
        const filtered = searchStages(query);
        const wbContainer = document.getElementById('stages-workbook');
        const mtContainer = document.getElementById('stages-midterm');
        const hdContainer = document.getElementById('stages-hindus');
        if (activeTab === 'analysis') {
            wbContainer.innerHTML = '';
            mtContainer.innerHTML = '';
            filtered.forEach(stage => {
                if (stage.isHindus || stage.category === 'hindus') return;
                let container;
                if (stage.category === 'midterm') container = mtContainer;
                else container = wbContainer;
                if (container) container.appendChild(this._createStageItem(stage));
            });
        } else if (activeTab === 'hindus') {
            if (hdContainer) hdContainer.innerHTML = '';
            filtered.forEach(stage => {
                if (!(stage.isHindus || stage.category === 'hindus')) return;
                if (hdContainer) hdContainer.appendChild(this._createStageItem(stage));
            });
        }
    },

    _createStageItem(stage) {
        // SAVE_CONTRACT Phase 3 — delegation hook. Iterate registered
        // stage renderers (Modals._stageRenderers); the first one that
        // returns a non-null Element wins and short-circuits the default
        // path below. If no renderer claims the stage, the original
        // hand-rolled DOM build runs unchanged. ctx exposes wiring info
        // adapters need to subscribe / look up state.
        const _renderers = this._stageRenderers;
        if (_renderers && typeof _renderers === 'object') {
            const _ctx = {
                isCustom: !!(stage && stage.isCustom),
                modals: this,
                ContentSync: (typeof window !== 'undefined') ? window.ContentSync : null
            };
            const _keys = Object.keys(_renderers);
            for (let _i = 0; _i < _keys.length; _i++) {
                const _fn = _renderers[_keys[_i]];
                if (typeof _fn !== 'function') continue;
                try {
                    const _el = _fn(stage, _ctx);
                    if (_el instanceof Element) return _el;
                } catch (_e) {
                    console.warn('[Modals] stage renderer threw for type=' + _keys[_i], _e);
                }
            }
        }

        const item = document.createElement('div');
        item.className = 'stage-item';
        if (stage && stage.id) item.dataset.stageId = String(stage.id);

        // Sync badge + card border for custom non-hindus sentences. Hindus
        // items are skipped until @3 coordination is fully green.
        const hasCS = typeof ContentSync !== 'undefined';
        // Built-in seeds (guest copies of STAGES examples) stay local
        // forever — they never get a ☁️ backup button and never auto-sync.
        // Per Amitai 2026-04-19 05:06: "you can NEVER backup built-ins."
        // Hindus items used to be held out too (pending @3 coord); opened
        // up per Amitai 2026-04-19 05:20.
        const isBuiltinSeed = stage._isBuiltinSeed === true;
        const syncable = hasCS && stage.isCustom && !isBuiltinSeed;
        const syncState = syncable && typeof ContentSync.getSyncState === 'function'
            ? ContentSync.getSyncState('sentence', stage.id) : null;
        const syncBadge = syncable && typeof ContentSync.getSyncBadge === 'function'
            ? ContentSync.getSyncBadge('sentence', stage.id) : '';
        const loggedIn = hasCS && typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
        const builtinBackedBadge = ((!stage.isCustom || stage._isBuiltinSeed === true) && loggedIn)
            ? '<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7">מגובה ☁️</span>'
            : '';
        const domainAccent = (stage && (stage.source_domain === 'hindus' || stage.isHindus || (stage.category === 'hindus' && stage.answer)))
            ? { main: '#d97706', pale: '#fffbeb', line: '#fbbf24', label: 'הינדוס' }
            : { main: '#0d9488', pale: '#f0fdfa', line: '#99f6e4', label: 'תחביר' };
        item.style.borderRight = '4px solid ' + domainAccent.main;
        if (syncState === 'pending') {
            item.style.border = '2px solid #6ee7b7';
            item.style.borderRight = '4px solid ' + domainAccent.main;
            item.style.background = '#ecfdf5';
            item.style.animation = 'cs-card-pulse 1.4s ease-in-out infinite';
        } else if (syncState === 'unsynced') {
            item.style.border = '2px dashed #f59e0b';
            item.style.borderRight = '4px solid ' + domainAccent.main;
            item.style.background = '#fffbeb';
        }

        item.innerHTML = `
            <div class="stage-number" style="display:flex;align-items:center;gap:8px">
                <span style="flex:1;min-width:0">${stage.number}</span>
                ${syncBadge || builtinBackedBadge || ''}
            </div>
            <div class="stage-sentence">${stage.sentence}</div>
        `;
        {
            item.style.position = 'relative';

            // All action buttons sit in one flex cluster pinned to the
            // visual-left (margin-right:auto in RTL). Previously the
            // .stage-delete-btn class applied margin-right:auto per button,
            // so each button absorbed its own auto-margin and they drifted
            // apart (Amitai 2026-04-19 05:18). Grouping them in a single
            // wrapper lines them up consistently.
            const actionsWrap = document.createElement('div');
            actionsWrap.style.cssText = 'display:flex;gap:4px;margin-right:auto;align-items:center';
            var _mkActionBtn = function(emoji, title, onClick) {
                var b = document.createElement('button');
                b.className = 'stage-delete-btn';
                b.innerHTML = emoji;
                b.title = title;
                b.style.margin = '0'; // override class margin-right:auto
                b.addEventListener('click', onClick);
                return b;
            };

            // 📋 copy-JSON on every card (custom or built-in).
            actionsWrap.appendChild(_mkActionBtn('📋', 'העתק JSON של המשפט', (e) => {
                e.stopPropagation();
                this._copySentenceJson(stage);
            }));

            if (stage.isCustom) {
                actionsWrap.appendChild(_mkActionBtn('✏️', 'ערוך משפט', (e) => {
                    e.stopPropagation();
                    this.showEditSentenceDialog(stage);
                }));

                // ☁️ manual-backup button for unsynced customs (not
                // _isBuiltinSeed — those never backup). Hindus gets it too
                // now that Amitai 2026-04-19 05:20 opened the gate.
                if (syncable && syncState !== 'synced') {
                    var backupBtn = _mkActionBtn('☁️', 'גבה משפט לשרת', async (e) => {
                        e.stopPropagation();
                        if (!ContentSync.isLoggedIn || !ContentSync.isLoggedIn()) {
                            // Per Amitai 2026-04-19 05:21: explain that
                            // backup needs login BEFORE dropping the user
                            // into the login screen.
                            var proceed = confirm('כדי לגבות את המשפט לשרת צריך להתחבר למשתמש. להתחבר עכשיו?');
                            if (!proceed) return;
                            if (typeof PlonterAuth !== 'undefined' && PlonterAuth.showLoginDialog) {
                                PlonterAuth.showLoginDialog(() => this._manualBackupSentence(stage));
                                return;
                            }
                        }
                        this._manualBackupSentence(stage);
                    });
                    if (syncState === 'unsynced') backupBtn.classList.add('backup-cloud-attention');
                    actionsWrap.appendChild(backupBtn);
                }
            } else if (loggedIn) {
                actionsWrap.appendChild(_mkActionBtn('✏️', 'שכפל לעריכה', (e) => {
                    e.stopPropagation();
                    var copy = this._getOrCreateLoggedInExampleCopy(stage);
                    if (copy) this.showEditSentenceDialog(copy);
                }));
            }

            item.appendChild(actionsWrap);

            const deleteBtn = document.createElement('button');
            deleteBtn.title = 'מחק משפט';
            deleteBtn.innerHTML = '×';
            deleteBtn.style.cssText = 'position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:1px solid #d1d5db;background:white;color:#9ca3af;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 1px 3px rgba(0,0,0,0.1);transition:all 0.2s';
            deleteBtn.onmouseenter = function() { deleteBtn.style.background = '#dc2626'; deleteBtn.style.color = 'white'; deleteBtn.style.borderColor = '#dc2626'; };
            deleteBtn.onmouseleave = function() { deleteBtn.style.background = 'white'; deleteBtn.style.color = '#9ca3af'; deleteBtn.style.borderColor = '#d1d5db'; };
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('למחוק את המשפט "' + stage.sentence.substring(0, 30) + '"?')) {
                    const prevCustomStages = localStorage.getItem('plonter_custom_stages');
                    const prevDisplay = item.style.display || '';
                    item.style.display = 'none';
                    try {
                        if (stage._createdAsGuest === true) {
                            if (typeof PlonterAuth === 'undefined' ||
                                typeof PlonterAuth.deleteGuestSentenceBackupForStage !== 'function') {
                                throw new Error('guest backup delete handler missing');
                            }
                            PlonterAuth.deleteGuestSentenceBackupForStage(stage);
                        }
                        deleteCustomStage(stage.id);
                        this.renderStages();
                    } catch (err) {
                        if (prevCustomStages != null) localStorage.setItem('plonter_custom_stages', prevCustomStages);
                        item.style.display = prevDisplay;
                        if (typeof MessageManager !== 'undefined') MessageManager.show('מחיקת גיבוי האורח נכשלה', 'error');
                        else alert('מחיקת גיבוי האורח נכשלה');
                        console.warn('[modals] guest sentence delete failed', err);
                    }
                }
            });
            item.appendChild(deleteBtn);
        }
        item.addEventListener('click', () => this._startStage(stage));
        return item;
    },

    _getOrCreateGuestExampleCopy(exampleStage) {
        try {
            if (typeof getCustomStages !== 'function' || typeof saveCustomStages !== 'function') return null;
            var sourceId = String(exampleStage.id || exampleStage.number || Date.now());
            var sourceDomain = (exampleStage.isHindus || exampleStage.category === 'hindus') ? 'hindus' : 'analysis';
            var customs = getCustomStages();
            var existing = customs.find(function(s) {
                return s && s._createdAsGuest === true &&
                    s._guestWorkingCopy === true &&
                    String(s.source_id || s._guestSourceId || '') === sourceId;
            });
            if (existing) {
                var pinnedNow = new Date().toISOString();
                existing._guestPinnedAt = pinnedNow;
                existing._priorityFromGuestUntil = Date.now() + (10 * 60 * 1000);
                existing.updated = pinnedNow;
                saveCustomStages(customs);
                return existing;
            }
            var now = new Date().toISOString();
            var id = 'guest_work_' + sourceId.replace(/[^A-Za-z0-9_-]+/g, '_') + '_' + Date.now();
            var copy = Object.assign({}, exampleStage, {
                id: id,
                isCustom: true,
                isHindus: sourceDomain === 'hindus' ? true : exampleStage.isHindus,
                _createdAsGuest: true,
                _isBuiltinSeed: false,
                _guestWorkingCopy: true,
                _guestBackupStatus: 'pending',
                source_id: sourceId,
                source_type: 'example_stage',
                source_domain: sourceDomain,
                _guestSourceId: sourceId,
                _guestPinnedAt: now,
                _priorityFromGuestUntil: Date.now() + (10 * 60 * 1000),
                created: now,
                updated: now
            });
            delete copy._sync;
            customs.push(copy);
            saveCustomStages(customs);
            this._forceOpenStageCategoryGlobal(copy);
            return copy;
        } catch (e) {
            console.warn('[modals] guest example copy failed', e);
            return null;
        }
    },

    _getOrCreateLoggedInExampleCopy(exampleStage) {
        try {
            if (typeof getCustomStages !== 'function' || typeof saveCustomStages !== 'function') return null;
            var sourceId = String(exampleStage.source_id || exampleStage.id || exampleStage.number || Date.now());
            var sourceDomain = (exampleStage.isHindus || exampleStage.category === 'hindus') ? 'hindus' : 'analysis';
            var customs = getCustomStages();
            var existing = customs.find(function(s) {
                return s && s.isCustom === true &&
                    s._isBuiltinSeed !== true &&
                    String(s.source_id || s._guestSourceId || '') === sourceId;
            });
            if (existing) return existing;
            var now = new Date().toISOString();
            var copy = Object.assign({}, exampleStage, {
                id: 'user_example_' + sourceId.replace(/[^A-Za-z0-9_-]+/g, '_') + '_' + Date.now(),
                isCustom: true,
                isHindus: sourceDomain === 'hindus' ? true : exampleStage.isHindus,
                _createdAsGuest: false,
                _isBuiltinSeed: false,
                source_id: sourceId,
                source_type: 'example_stage',
                source_domain: exampleStage.source_domain || sourceDomain,
                created: now,
                updated: now
            });
            delete copy._guestWorkingCopy;
            delete copy._guestBackupStatus;
            delete copy._guestPinnedAt;
            delete copy._priorityFromGuestUntil;
            delete copy._guestSourceId;
            delete copy._sync;
            customs.push(copy);
            saveCustomStages(customs);
            this._forceOpenStageCategoryGlobal(copy);
            return copy;
        } catch (e) {
            console.warn('[modals] logged-in example copy failed', e);
            return null;
        }
    },

    _forceOpenStageCategoryGlobal(stage) {
        if (!stage) return;
        try {
            var rawCat = String(stage.category || '').trim();
            var rawCatLower = rawCat.toLowerCase();
            var isGeneral = !rawCatLower || rawCatLower === 'default' || rawCatLower === 'undefined' || rawCatLower === 'null' || rawCatLower === 'custom';
            var isHindus = !!(stage.source_domain === 'hindus' || stage.isHindus || ((rawCatLower === 'hindus' || rawCatLower === 'default') && stage.answer));
            var cat = isHindus
                ? ((isGeneral || rawCatLower === 'hindus') ? 'hindus' : rawCat)
                : (isGeneral ? 'custom' : rawCat);
            var keys = [];
            var domain = isHindus ? 'hindus' : 'analysis';
            var categoryId = '';
            if (isHindus) {
                keys.push('plonter_collapsed_stages-hindus');
                categoryId = 'stages-hindus';
                if (cat && cat !== 'hindus' && cat !== 'custom') keys.push('plonter_collapsed_cat_' + cat);
            } else {
                if (cat === 'workbook' || cat === 'חוברת') { keys.push('plonter_collapsed_stages-workbook'); categoryId = 'stages-workbook'; }
                else if (cat === 'midterm' || cat === 'תרגיל אמצע') { keys.push('plonter_collapsed_stages-midterm'); categoryId = 'stages-midterm'; }
                else if (cat === 'persian' || cat === 'פרסית') { keys.push('plonter_collapsed_stages-persian'); categoryId = 'stages-persian'; }
                else if (cat === 'custom') { keys.push('plonter_collapsed_stages-custom'); categoryId = 'stages-custom'; }
                else { keys.push('plonter_collapsed_cat_' + cat); categoryId = 'cat:' + cat; }
            }
            keys.forEach(function(k) { localStorage.setItem(k, '0'); });
            if (stage.id) sessionStorage.setItem('plonter_highlight_stage_id', String(stage.id));
            sessionStorage.setItem('plonter_last_open_category_v1', JSON.stringify({
                domain: domain,
                categoryId: categoryId,
                category: cat,
                stageId: stage.id || '',
                at: Date.now()
            }));
        } catch (_) {}
    },

    _applyPendingStageHighlight() {
        var id = '';
        try { id = sessionStorage.getItem('plonter_highlight_stage_id') || ''; } catch (_) {}
        if (!id) return;
        var cards = document.querySelectorAll('.stage-item');
        var target = null;
        cards.forEach(function(card) {
            if (!target && card.dataset && String(card.dataset.stageId || '') === String(id)) target = card;
        });
        if (!target) return;
        // #1161 (Amitai via @6m 2026-06-06): when the user returns to the stage
        // list FROM a hindus sentence, give the returned-to card the FULL green
        // emphasis (green outline + glow + 2 gentle bounces + smooth-center
        // scroll), mirroring the lessons.js recipe (lessons.js ~1326-1346). This
        // green recipe REPLACES the teal-glow path for this case only; the
        // normal new-sentence highlight below stays unchanged. The exit trigger
        // (sessionStorage flags) is set by hindusMode.js — decoupled contract.
        var returnFromHindus = '';
        try { returnFromHindus = sessionStorage.getItem('plonter_return_from_hindus') || ''; } catch (_) {}
        if (returnFromHindus) {
            // Distinct style-tag id from lessons.js's own tag (no cross-file
            // assumption); keyframe NAME is shared (lpReturnBounce) per contract.
            if (!document.getElementById('lp-return-bounce-style')) {
                var _rbStyle = document.createElement('style');
                _rbStyle.id = 'lp-return-bounce-style';
                _rbStyle.textContent = '@keyframes lpReturnBounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-8px)}60%{transform:translateY(0)}}';
                document.head.appendChild(_rbStyle);
            }
            target.style.outline = '3px solid #16a34a';
            target.style.outlineOffset = '2px';
            target.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.35), 0 8px 24px rgba(13,148,136,0.18)';
            target.style.animation = 'lpReturnBounce .55s ease-in-out 2';
            try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { target.scrollIntoView(); }
            setTimeout(function() {
                try {
                    target.style.outline = '';
                    target.style.outlineOffset = '';
                    target.style.boxShadow = '';
                    target.style.animation = '';
                    sessionStorage.removeItem('plonter_highlight_stage_id');
                    sessionStorage.removeItem('plonter_return_from_hindus');
                } catch (_) {}
            }, 2800);
            return;
        }
        target.style.transition = 'box-shadow 1s ease, transform 1s ease';
        target.style.boxShadow = '0 0 0 3px rgba(13,148,136,.32), 0 0 22px rgba(13,148,136,.28)';
        target.style.transform = 'translateY(-1px)';
        // Section-level pulse — finds the .category-section ancestor
        // (built-in or dynamic) and highlights it for the same 1.5s
        // window. Helps the eye land on the relevant group, not just
        // the card.
        var section = target.closest('.category-section');
        if (section) {
            section.style.transition = 'box-shadow 1s ease, background 1s ease';
            section.style.boxShadow = '0 0 0 3px rgba(13,148,136,.18), 0 10px 26px rgba(13,148,136,.16)';
        }
        try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        setTimeout(function() {
            try {
                target.style.boxShadow = '';
                target.style.transform = '';
                if (section) section.style.boxShadow = '';
                sessionStorage.removeItem('plonter_highlight_stage_id');
            } catch (_) {}
        }, 1500);
    },

    // Self-prune for plonter_ui_* localStorage keys older than 7 days.
    // Run once at the top of renderStages() — cheap (LS scan over a
    // few keys), keeps the per-category user-toggle markers from
    // accumulating after a category gets renamed/deleted.
    _pruneUiKeys() {
        try {
            var nowMs = Date.now();
            var weekMs = 7 * 24 * 60 * 60 * 1000;
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf('plonter_ui_') !== 0) continue;
                keys.push(k);
            }
            keys.forEach(function(k) {
                try {
                    var raw = localStorage.getItem(k);
                    if (!raw) return;
                    var v = JSON.parse(raw);
                    if (v && typeof v.at === 'number' && (nowMs - v.at) > weekMs) {
                        localStorage.removeItem(k);
                    }
                } catch (_) {
                    // Non-JSON or unparseable plonter_ui_* entry —
                    // leave it alone; it was set by older code that
                    // doesn't follow the {at} convention.
                }
            });
        } catch (_) {}
    },

    // Manual cloud-backup for a custom sentence. Mirrors the per-lesson
    // ☁️ flow. Calls ContentSync.syncNow which internally handles the
    // title+desc collision dialog when relevant.
    async _manualBackupSentence(stage) {
        if (typeof ContentSync === 'undefined' || typeof ContentSync.syncNow !== 'function') return;
        try {
            // First mark it as an opt-in for auto-sync (creates meta so
            // guest-draft guard stops skipping it on future saves).
            if (typeof ContentSync.save === 'function') {
                try { ContentSync.save('sentence', stage.id, stage); } catch (_) {}
            }
            const res = await ContentSync.syncNow('sentence', stage.id);
            if (res && res.success) {
                if (typeof MessageManager !== 'undefined') MessageManager.show('המשפט גובה לשרת ✓', 'success');
            } else {
                if (typeof MessageManager !== 'undefined') MessageManager.show('הגיבוי נכשל: ' + ((res && res.error) || 'שגיאה'), 'error');
            }
        } catch (e) {
            console.error('[modals] manualBackupSentence failed', e);
        }
        this.renderStages();
    },

    // Clipboard helper — tries navigator.clipboard, falls back to exec.
    // successMsg defaults to a generic confirmation; callers override for
    // more specific language ("הועתק JSON של '{title}'" etc).
    _clipboardWrite(text, successMsg) {
        var msg = successMsg || 'הועתק ל-clipboard ✓';
        var toast = function(m, kind) {
            if (typeof MessageManager !== 'undefined') MessageManager.show(m, kind || 'info');
            else alert(m);
        };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function() {
                    toast(msg, 'success');
                }).catch(function() { _fallback(); });
                return;
            }
        } catch (_) {}
        _fallback();
        function _fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); toast(msg, 'success'); }
            catch (e) { toast('שגיאה בהעתקה', 'error'); }
            ta.remove();
        }
    },

    // Collect per-stage localStorage state (analyses + hindus tabs) so an
    // exported sentence can be pasted into another browser/user and land
    // with the same attempts, syntactic analysis and hindus boards. Amitai
    // 2026-04-19 08:56: "json מעתיק משפטים עם הניסיונות והניתוח/הינדוס
    // כבר בתוכם, כדי שתוכל ממש להעביר במדויק".
    _collectStageState(stageId) {
        var analyses = {};
        var analysisPrefix = 'plonter_v4_stage_' + stageId + '_analysis_';
        var hindusKey = 'plonter_v4_stage_' + stageId + '_hindus_v2';
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k) continue;
            if (k.indexOf(analysisPrefix) === 0) {
                var analysisId = k.slice(analysisPrefix.length);
                try { analyses[analysisId] = JSON.parse(localStorage.getItem(k)); }
                catch (_) {}
            }
        }
        var hindus = null;
        try {
            var raw = localStorage.getItem(hindusKey);
            if (raw) hindus = JSON.parse(raw);
        } catch (_) {}
        var out = {};
        if (Object.keys(analyses).length) out.analyses = analyses;
        if (hindus) out.hindus = hindus;
        return out;
    },

    // Copy one sentence's full JSON (the same shape addCustomStage writes
    // into plonter_custom_stages), minus internal sync/guest markers.
    // Embeds analyses + hindus state under _plonterExport so paste-back
    // via showImportSentencesDialog can restore the full work.
    _copySentenceJson(stage) {
        var copy = {};
        var skip = { _createdAsGuest: 1, _isBuiltinSeed: 1, _sync: 1, _plonterExport: 1 };
        for (var k in stage) {
            if (!Object.prototype.hasOwnProperty.call(stage, k)) continue;
            if (skip[k]) continue;
            copy[k] = stage[k];
        }
        var extra = this._collectStageState(stage.id);
        if (extra.analyses || extra.hindus) copy._plonterExport = extra;
        var label = stage.number || stage.name || (stage.sentence || '').slice(0, 20);
        var bits = [];
        if (extra.analyses) bits.push(Object.keys(extra.analyses).length + ' ניתוחים');
        if (extra.hindus) {
            var tabCount = (extra.hindus.tabs && extra.hindus.tabs.length) || 1;
            bits.push(tabCount + ' הינדוסים');
        }
        var suffix = bits.length ? ' (+ ' + bits.join(', ') + ')' : '';
        this._clipboardWrite(JSON.stringify(copy, null, 2), '📋 הועתק JSON של "' + label + '"' + suffix);
    },

    // Copy an entire category as a JSON array. Accepts either a category
    // name (looked up in the merged custom+built-in pool) or a direct
    // array of stages. Strips the internal markers so the output is
    // "paste-back safe" via the ייבוא dialog.
    _copyCategoryJson(categoryName, stages) {
        var list = stages;
        if (!list) {
            var all = [].concat(getCustomStages(), STAGES.workbook || [], STAGES.midterm || [], STAGES.hindus || [], STAGES.persian || []);
            list = all.filter(function(s) {
                var cat = s.category || 'custom';
                return cat === categoryName;
            });
        }
        var skip = { _createdAsGuest: 1, _isBuiltinSeed: 1, _sync: 1, _plonterExport: 1 };
        var self = this;
        var withStateCount = 0;
        var out = list.map(function(s) {
            var c = {};
            for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && !skip[k]) c[k] = s[k];
            var extra = self._collectStageState(s.id);
            if (extra.analyses || extra.hindus) {
                c._plonterExport = extra;
                withStateCount++;
            }
            return c;
        });
        var suffix = withStateCount ? ' (' + withStateCount + ' עם ניסיונות/ניתוח)' : '';
        this._clipboardWrite(
            JSON.stringify(out, null, 2),
            '📋 הועתקו ' + out.length + ' משפטים מקטגוריה "' + (categoryName || 'קטגוריה') + '"' + suffix
        );
    },

    // Import from pasted JSON. Accepts a single object or an array.
    // Assigns a fresh id, marks isCustom + _createdAsGuest|logged-in.
    // If the caller hinted isHindus=true, forces category → 'hindus'
    // and stamps isHindus=true on each item.
    showImportSentencesDialog(opts) {
        opts = opts || {};
        var self = this;
        var existing = document.getElementById('import-sentences-modal');
        if (existing) existing.remove();
        var modal = document.createElement('div');
        modal.id = 'import-sentences-modal';
        modal.className = 'modal show';
        modal.style.display = 'flex';
        modal.innerHTML =
            '<div class="modal-content" style="max-width:640px">' +
                '<span class="close">&times;</span>' +
                '<h3>ייבוא מ-JSON</h3>' +
                '<p style="color:#64748b;font-size:0.9em">הדבק פה JSON של משפט יחיד (אובייקט) או של מספר משפטים (מערך). יקבלו id חדש, isCustom:true. ' +
                    (opts.isHindus ? 'הפריטים ייכנסו כפריטי הינדוס.' : 'הפריטים ייכנסו לתחביר.') + '</p>' +
                '<textarea id="import-json-ta" dir="ltr" rows="10" style="width:100%;padding:10px;font-family:monospace;font-size:0.9em;border:2px solid #e5e7eb;border-radius:8px" placeholder="[ { ... } ] או { ... }"></textarea>' +
                '<div style="display:flex;gap:8px;justify-content:center;margin-top:16px">' +
                    '<button id="import-json-confirm" class="btn btn-primary" style="flex:1">ייבא</button>' +
                    '<button id="import-json-cancel" class="btn btn-secondary" style="flex:1">ביטול</button>' +
                '</div>';
        modal.querySelector('.close').onclick = function() { modal.remove(); };
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
        document.getElementById('import-json-cancel').onclick = function() { modal.remove(); };
        document.getElementById('import-json-ta').focus();
        document.getElementById('import-json-confirm').onclick = function() {
            var raw = document.getElementById('import-json-ta').value.trim();
            if (!raw) { MessageManager.show('הדבק JSON', 'error'); return; }
            var parsed;
            try { parsed = JSON.parse(raw); }
            catch (e) { MessageManager.show('JSON לא תקין: ' + e.message, 'error'); return; }
            var items = Array.isArray(parsed) ? parsed : [parsed];
            var loggedIn = typeof ContentSync !== 'undefined' &&
                typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
            var customs = getCustomStages();
            var added = 0;
            var restoredCount = 0;
            items.forEach(function(item, i) {
                if (!item || typeof item !== 'object') return;
                var id = 'imp_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
                // Pull embedded state (attempts/analyses/hindus) off the
                // incoming object before spreading — we want it restored
                // under the NEW id, not the exported one.
                var embedded = item._plonterExport;
                var stage = Object.assign({}, item, { id: id, isCustom: true, created: new Date().toISOString(), updated: new Date().toISOString() });
                delete stage._plonterExport;
                if (opts.isHindus) { stage.isHindus = true; stage.category = 'hindus'; }
                delete stage._isBuiltinSeed; // imported items are user-owned
                if (!loggedIn) stage._createdAsGuest = true;
                else delete stage._createdAsGuest;
                customs.push(stage);
                added++;
                if (embedded && typeof embedded === 'object') {
                    if (embedded.analyses && typeof embedded.analyses === 'object') {
                        for (var aid in embedded.analyses) {
                            if (!Object.prototype.hasOwnProperty.call(embedded.analyses, aid)) continue;
                            try {
                                localStorage.setItem(
                                    'plonter_v4_stage_' + id + '_analysis_' + aid,
                                    JSON.stringify(embedded.analyses[aid])
                                );
                                if (typeof AnalysesSync !== 'undefined' && AnalysesSync.onAnalysisSaved) {
                                    AnalysesSync.onAnalysisSaved(id, aid);
                                }
                            } catch (_) {}
                        }
                    }
                    if (embedded.hindus) {
                        try {
                            localStorage.setItem(
                                'plonter_v4_stage_' + id + '_hindus_v2',
                                JSON.stringify(embedded.hindus)
                            );
                            if (typeof HindusSync !== 'undefined' && HindusSync.onStageRestored) {
                                HindusSync.onStageRestored(id);
                            }
                        } catch (_) {}
                    }
                    if (embedded.analyses || embedded.hindus) restoredCount++;
                }
            });
            if (added > 0) saveCustomStages(customs);
            modal.remove();
            var msg = 'יובאו ' + added + ' משפטים';
            if (restoredCount) msg += ' (' + restoredCount + ' עם ניסיונות/ניתוח)';
            MessageManager.show(msg, 'success');
            self.renderStages();
        };
    },

    // #26: Show dialog for creating a new sentence
    showCreateSentenceDialog() {
        let modal = document.getElementById('create-sentence-modal');
        if (modal) modal.remove();

        // Get existing categories (syntax only — exclude hindus). Merge
        // the built-in Hebrew labels with custom categories but de-dupe
        // the English STAGES aliases that would otherwise appear twice
        // (Amitai 2026-04-19 05:16 flagged "workbook" + "midterm" showing
        // alongside "חוברת" + "תרגיל אמצע").
        const customs = getCustomStages();
        const builtinCats = ['חוברת', 'תרגיל אמצע', 'פרסית'];
        const HIDE_ENGLISH = new Set(['workbook', 'midterm', 'persian', 'hindus', 'custom']);
        const customCats = customs
            .filter(s => !s.isHindus && s.category !== 'hindus')
            .map(s => s.category)
            .filter(c => c && !HIDE_ENGLISH.has(c));
        const existingCats = [...new Set([...builtinCats, ...customCats])];

        modal = document.createElement('div');
        modal.id = 'create-sentence-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px">
                <span class="close">&times;</span>
                <h3>צור משפט חדש</h3>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">שם המשפט:</label>
                    <input type="text" id="new-sentence-name" class="form-control" placeholder="למשל: תרגיל 1" dir="rtl" style="width:100%;padding:10px;font-size:1em;border:2px solid #e5e7eb;border-radius:8px">
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">המשפט בערבית (אם תכתוב מנוקד, הניקוד יישמר ברקע):</label>
                    <textarea id="new-sentence-text" class="form-control" placeholder="הכנס משפט בערבית..." dir="rtl" rows="3" style="width:100%;padding:10px;font-size:1.1em;border:2px solid #e5e7eb;border-radius:8px;font-family:Arial,serif;resize:vertical"></textarea>
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">קטגוריה:</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                        ${existingCats.map(c => `<button class="btn btn-secondary cat-pick-btn" data-cat="${c}" style="font-size:0.9em">${c}</button>`).join('')}
                    </div>
                    <input type="text" id="new-sentence-category" class="form-control" list="category-suggestions" placeholder="ריק = משפטים שלי, או בחר/כתוב קטגוריה" dir="rtl" style="width:100%;padding:10px;font-size:1em;border:2px solid #e5e7eb;border-radius:8px">
                    <datalist id="category-suggestions">
                        ${existingCats.map(c => `<option value="${c}">`).join('')}
                    </datalist>
                </div>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:20px">
                    <button id="confirm-create-sentence" class="btn btn-primary" style="flex:1;font-size:1.1em;padding:12px">צור</button>
                    <button id="cancel-create-sentence" class="btn btn-secondary" style="flex:1">ביטול</button>
                    <button id="dialog-dict-btn" class="btn btn-secondary" style="padding:10px 14px;font-size:1em" title="מילון" onclick="Dictionary.openStandalone()">📖</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Category pick buttons
        modal.querySelectorAll('.cat-pick-btn').forEach(btn => {
            btn.onclick = () => {
                modal.querySelector('#new-sentence-category').value = btn.dataset.cat;
            };
        });

        // Ctrl+G Hebrew→Arabic on textareas
        modal.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                    if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                        e.target.value = DetailsPanel._convertHebrewToArabic(e.target.value);
                    }
                }
            }
        });

        this._wireCreateDialogEnterFlow(modal, [
            '#new-sentence-name',
            '#new-sentence-text',
            '#new-sentence-category'
        ], '#confirm-create-sentence');

        modal.querySelector('#confirm-create-sentence').onclick = () => {
            var name = modal.querySelector('#new-sentence-name').value.trim();
            const sentenceRaw = modal.querySelector('#new-sentence-text').value.trim();
            const category = modal.querySelector('#new-sentence-category').value.trim() || 'custom';

            if (!sentenceRaw) {
                MessageManager.show('יש להכניס משפט', 'error');
                return;
            }

            const sentenceClean = stripArabicDiacritics(sentenceRaw);
            const hasDiacritics = sentenceClean !== sentenceRaw;

            var finalName = name || sentenceClean.substring(0, 30);

            // Amitai 2026-04-19 09:36: catch title collisions at create
            // time, not after the fact via the sync dialog. Check the
            // user's own local sentences — reverses the 05:02 policy
            // (ghost lessons from previous users) which applied to
            // lessons, not sentences. Server-side collisions still
            // surface via the backup flow for cross-device cases.
            var existingStages = getCustomStages();
            var collides = existingStages.some(function(s) { return s.number === finalName && !s.isHindus && s.category !== 'hindus'; });
            if (collides) {
                var base = finalName;
                var suffix = 2;
                while (existingStages.some(function(s) { return s.number === base + ' ' + suffix; })) suffix++;
                var proposed = base + ' ' + suffix;
                if (!confirm('משפט בשם "' + finalName + '" כבר קיים אצלך. להשתמש בשם "' + proposed + '" במקום? ביטול = לחזור לערוך את השם.')) {
                    var nameInput = modal.querySelector('#new-sentence-name');
                    if (nameInput) nameInput.focus();
                    return;
                }
                finalName = proposed;
            }

            const stage = addCustomStage(
                finalName,
                sentenceClean,
                category,
                hasDiacritics ? sentenceRaw : null
            );

            modal.classList.remove('show');
            modal.remove();
            _forceOpenStageCategory(stage);
            this.renderStages();
            // Auto-start the new stage
            this._startStage(stage);
        };

        modal.querySelector('#cancel-create-sentence').onclick = () => {
            modal.classList.remove('show');
            modal.remove();
        };
        modal.querySelector('.close').onclick = () => {
            modal.classList.remove('show');
            modal.remove();
        };
        modal.onclick = (e) => {
            if (e.target === modal) { modal.classList.remove('show'); modal.remove(); }
        };

        modal.classList.add('show');
        setTimeout(() => modal.querySelector('#new-sentence-name').focus(), 100);
    },

    // Hindus: create sentence with Hebrew text + Arabic answer
    showCreateHindusSentenceDialog() {
        let modal = document.getElementById('create-hindus-modal');
        if (modal) modal.remove();

        // Get existing hindus categories
        const customs = getCustomStages();
        const hindusCustomCats = customs.filter(s => s.isHindus || (s.category === 'hindus' && s.answer)).map(s => s.category).filter(c => c && c !== 'hindus' && c !== 'custom');
        const existingHindusCats = [...new Set(hindusCustomCats)];

        modal = document.createElement('div');
        modal.id = 'create-hindus-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px">
                <span class="close">&times;</span>
                <h3>משפט חדש להינדוס</h3>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">שם:</label>
                    <input type="text" id="hindus-name" class="form-control" placeholder="למשל: ריבוי שלם זכר" dir="rtl" style="width:100%;padding:10px;font-size:1em;border:2px solid #e5e7eb;border-radius:8px">
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">קטגוריה:</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                        ${existingHindusCats.map(c => `<button class="btn btn-secondary hindus-cat-pick-btn" data-cat="${c}" style="font-size:0.9em;border-color:#d97706;color:#92400e">${c}</button>`).join('')}
                    </div>
                    <input type="text" id="hindus-category" class="form-control" list="hindus-category-suggestions" placeholder="בחר קטגוריה קיימת או כתוב חדשה (אופציונלי)" dir="rtl" style="width:100%;padding:10px;font-size:1em;border:2px solid #e5e7eb;border-radius:8px">
                    <datalist id="hindus-category-suggestions">
                        ${existingHindusCats.map(c => `<option value="${c}">`).join('')}
                    </datalist>
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">המשפט בעברית (מה התלמיד רואה):</label>
                    <textarea id="hindus-hebrew" class="form-control" placeholder="הכנס משפט בעברית..." dir="rtl" rows="2" style="width:100%;padding:10px;font-size:1.1em;border:2px solid #e5e7eb;border-radius:8px;resize:vertical"></textarea>
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">התשובה בערבית (מנוקד):</label>
                    <textarea id="hindus-answer" class="form-control" placeholder="כתוב בעברית ולחץ Ctrl+G להמרה לערבית" dir="rtl" rows="2" style="width:100%;padding:10px;font-size:1.1em;border:2px solid #e5e7eb;border-radius:8px;font-family:Arial,serif;resize:vertical"></textarea>
                    <div style="font-size:0.8em;color:#9ca3af;margin-top:4px">💡 Ctrl+G = המרה מעברית לערבית</div>
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px;color:#991b1b">פיתרון שהוא טעות (אופציונלי):</label>
                    <textarea id="hindus-wrong" class="form-control" placeholder="פיתרון שגוי להשוואה — יוצג למעלה עם תווית 'פיתרון לא נכון'" dir="rtl" rows="2" style="width:100%;padding:10px;font-size:1.1em;border:2px solid #fecaca;border-radius:8px;font-family:Arial,serif;resize:vertical;background:#fef2f2"></textarea>
                    <div style="font-size:0.8em;color:#9ca3af;margin-top:4px">💡 Ctrl+G = המרה מעברית לערבית</div>
                </div>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:20px">
                    <button id="confirm-create-hindus" class="btn btn-primary" style="flex:1;font-size:1.1em;padding:12px;background:linear-gradient(135deg,#f59e0b,#d97706)">צור</button>
                    <button id="cancel-create-hindus" class="btn btn-secondary" style="flex:1">ביטול</button>
                    <button class="btn btn-secondary" style="padding:10px 14px;font-size:1em" title="מילון" onclick="Dictionary.openStandalone()">📖</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Category pick buttons
        modal.querySelectorAll('.hindus-cat-pick-btn').forEach(btn => {
            btn.onclick = () => {
                modal.querySelector('#hindus-category').value = btn.dataset.cat;
            };
        });

        // Ctrl+G Hebrew→Arabic on textareas
        modal.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                    if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                        e.target.value = DetailsPanel._convertHebrewToArabic(e.target.value);
                    }
                }
            }
        });

        this._wireCreateDialogEnterFlow(modal, [
            '#hindus-name',
            '#hindus-category',
            '#hindus-hebrew',
            '#hindus-answer',
            '#hindus-wrong'
        ], '#confirm-create-hindus');

        modal.querySelector('#confirm-create-hindus').onclick = () => {
            var name = modal.querySelector('#hindus-name').value.trim();
            const hebrew = modal.querySelector('#hindus-hebrew').value.trim();
            const answer = modal.querySelector('#hindus-answer').value.trim();
            const wrongAnswer = modal.querySelector('#hindus-wrong').value.trim();
            const hindusCategory = modal.querySelector('#hindus-category').value.trim();

            if (!hebrew) { MessageManager.show('יש להכניס משפט בעברית', 'error'); return; }
            if (!answer) { MessageManager.show('יש להכניס תשובה בערבית', 'error'); return; }

            // No title-alone uniqueness check — same reasoning as
            // the syntax-analysis dialog. Collision is a title+desc
            // concept enforced at backup, not at creation.
            var finalName = name || hebrew.substring(0, 30);

            const stage = addCustomStage(
                finalName,
                hebrew,
                hindusCategory || 'hindus',
                null,
                answer,
                null,
                true  // isHindus flag
            );
            if (wrongAnswer) {
                updateCustomStage(stage.id, { wrongAnswer });
                stage.wrongAnswer = wrongAnswer;
            }

            modal.classList.remove('show');
            modal.remove();
            Modals._forceOpenStageCategoryGlobal(stage);
            this.renderStages();
            if (typeof switchWelcomeTab === 'function') switchWelcomeTab('hindus');
            this._startStage(stage);
        };

        modal.querySelector('#cancel-create-hindus').onclick = () => { modal.classList.remove('show'); modal.remove(); };
        modal.querySelector('.close').onclick = () => { modal.classList.remove('show'); modal.remove(); };
        modal.onclick = (e) => { if (e.target === modal) { modal.classList.remove('show'); modal.remove(); } };
        modal.classList.add('show');
        setTimeout(() => modal.querySelector('#hindus-name').focus(), 100);
    },

    showEditSentenceDialog(stage) {
        let modal = document.getElementById('create-sentence-modal');
        if (modal) modal.remove();

        const customs = getCustomStages();
        const builtinCats = ['חוברת', 'תרגיל אמצע', 'פרסית'];
        const customCats = customs.map(s => s.category).filter(c => c && c !== 'custom');
        const existingCats = [...new Set([...builtinCats, ...customCats])];
        const displaySentence = stage.diacritizedSentence || stage.sentence;

        modal = document.createElement('div');
        modal.id = 'create-sentence-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px">
                <span class="close">&times;</span>
                <h3>ערוך משפט</h3>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">שם המשפט:</label>
                    <input type="text" id="new-sentence-name" class="form-control" value="${stage.number.replace(/"/g, '&quot;')}" dir="rtl" style="width:100%;padding:10px;font-size:1em;border:2px solid #e5e7eb;border-radius:8px">
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">המשפט:</label>
                    <textarea id="new-sentence-text" class="form-control" dir="rtl" rows="3" style="width:100%;padding:10px;font-size:1.1em;border:2px solid #e5e7eb;border-radius:8px;font-family:Arial,serif;resize:vertical">${displaySentence}</textarea>
                </div>
                ${(stage.isHindus || stage.answer) ? `
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">תשובה בערבית:</label>
                    <textarea id="edit-hindus-answer" class="form-control" dir="rtl" rows="3" style="width:100%;padding:10px;font-size:1.1em;border:2px solid #e5e7eb;border-radius:8px;font-family:Arial,serif;resize:vertical">${stage.answer || ''}</textarea>
                    <div style="font-size:0.8em;color:#9ca3af;margin-top:4px">💡 Ctrl+G = המרה מעברית לערבית</div>
                </div>
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px;color:#991b1b">פיתרון שהוא טעות (אופציונלי):</label>
                    <textarea id="edit-hindus-wrong" class="form-control" dir="rtl" rows="2" style="width:100%;padding:10px;font-size:1.1em;border:2px solid #fecaca;border-radius:8px;font-family:Arial,serif;resize:vertical;background:#fef2f2" placeholder="פיתרון שגוי להשוואה — יוצג למעלה עם תווית 'פיתרון לא נכון'">${stage.wrongAnswer || ''}</textarea>
                </div>` : ''}
                <div style="margin:16px 0">
                    <label style="font-weight:bold;display:block;margin-bottom:4px">קטגוריה:</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                        ${existingCats.map(c => `<button class="btn btn-secondary cat-pick-btn" data-cat="${c}" style="font-size:0.9em">${c}</button>`).join('')}
                    </div>
                    <input type="text" id="new-sentence-category" class="form-control" list="category-suggestions-edit" value="${(stage.category || '').replace(/"/g, '&quot;')}" dir="rtl" style="width:100%;padding:10px;font-size:1em;border:2px solid #e5e7eb;border-radius:8px" required>
                    <datalist id="category-suggestions-edit">
                        ${existingCats.map(c => `<option value="${c}">`).join('')}
                    </datalist>
                </div>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:20px">
                    <button id="confirm-create-sentence" class="btn btn-primary" style="flex:1;font-size:1.1em;padding:12px">שמור</button>
                    <button id="cancel-create-sentence" class="btn btn-secondary" style="flex:1">ביטול</button>
                    <button id="dialog-dict-btn" class="btn btn-secondary" style="padding:10px 14px;font-size:1em" title="מילון" onclick="Dictionary.openStandalone()">📖</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelectorAll('.cat-pick-btn').forEach(btn => {
            btn.onclick = () => {
                modal.querySelector('#new-sentence-category').value = btn.dataset.cat;
            };
        });

        // Ctrl+G Hebrew→Arabic on textareas
        modal.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                    if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                        e.target.value = DetailsPanel._convertHebrewToArabic(e.target.value);
                    }
                }
            }
        });

        const self = this;
        const countWords = (s) => s.split(/\s+/).filter(w => w.trim()).length;

        const finalizeUpdate = (updates, clearAnalyses) => {
            if (clearAnalyses && typeof persistence !== 'undefined') {
                persistence.clearAllAnalyses(stage.id);
            }
            updates.updated = new Date().toISOString();
            if (stage._isBuiltinSeed === true) updates._isBuiltinSeed = false;
            if (stage._createdAsGuest === true || updates._isBuiltinSeed === false) {
                var loggedIn = typeof ContentSync !== 'undefined' &&
                    typeof ContentSync.isLoggedIn === 'function' &&
                    ContentSync.isLoggedIn();
                updates._createdAsGuest = !loggedIn;
            }
            var guestMode = typeof ContentSync !== 'undefined' &&
                typeof ContentSync.isLoggedIn === 'function' &&
                !ContentSync.isLoggedIn();
            if (guestMode || updates._createdAsGuest === true) {
                updates._guestPinnedAt = updates.updated;
            }
            var result = updateCustomStage(stage.id, updates);
            if (!result) {
                MessageManager.show('שגיאה: המשפט לא נמצא (id=' + stage.id + ')', 'error');
                return;
            }
            modal.classList.remove('show');
            modal.remove();
            Modals._forceOpenStageCategoryGlobal(result);
            self.renderStages();
            MessageManager.show('המשפט עודכן', 'success');
        };

        const createAsNewStage = (updates, newName, sentenceClean, hasDiacritics, sentenceRaw) => {
            const newStage = addCustomStage(
                newName,
                sentenceClean,
                updates.category,
                hasDiacritics ? sentenceRaw : null,
                updates.answer || null,
                stage.tags ? stage.tags.slice() : null,
                !!stage.isHindus
            );
            var loggedIn = typeof ContentSync !== 'undefined' &&
                typeof ContentSync.isLoggedIn === 'function' &&
                ContentSync.isLoggedIn();
            if (!loggedIn) {
                updateCustomStage(newStage.id, {
                    _createdAsGuest: true,
                    _guestPinnedAt: new Date().toISOString()
                });
            }
            if (updates.wrongAnswer) updateCustomStage(newStage.id, { wrongAnswer: updates.wrongAnswer });
            modal.classList.remove('show');
            modal.remove();
            Modals._forceOpenStageCategoryGlobal(newStage);
            self.renderStages();
            MessageManager.show('נוצר משפט חדש: ' + newName, 'success');
        };

        const showWordCountConfirm = (updates, sentenceClean, hasDiacritics, sentenceRaw, origCount, newCount) => {
            const isHindus = !!stage.isHindus || stage.category === 'hindus';
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px';
            const box = document.createElement('div');
            box.style.cssText = 'background:white;border-radius:14px;max-width:480px;width:100%;padding:22px;direction:rtl;box-shadow:0 12px 40px rgba(0,0,0,0.28);font-family:inherit';
            const resetCopy = isHindus
                ? 'שינוי כזה יאפס את הסידור, התיוגים והמלבנים של ההינדוס. מה ברצונך לעשות?'
                : 'שינוי כזה יאפס את כל הניתוח והעבודה שנשמרה על המשפט. מה ברצונך לעשות?';
            const replaceLabel = isHindus ? '🗑️ מחק את ההינדוס ועדכן' : 'מחק את הניתוח ועדכן';
            const backupBtnHtml = isHindus
                ? '  <button id="wc-backup" style="padding:11px;border:none;border-radius:10px;background:#7c3aed;color:white;font-size:1em;font-weight:bold;cursor:pointer">✨ שמור כגיבוי אוטומטי ועדכן</button>'
                : '';
            box.innerHTML =
                '<h3 style="margin:0 0 10px;color:#991b1b;font-size:1.15em">שינוי במספר המילים' + (isHindus ? ' — עריכת משפט בהינדוס' : '') + '</h3>' +
                '<p style="margin:0 0 14px;line-height:1.5">המשפט המקורי: <b>' + origCount + '</b> מילים. המשפט החדש: <b>' + newCount + '</b> מילים.</p>' +
                '<p style="margin:0 0 14px;line-height:1.5">' + resetCopy + '</p>' +
                '<div style="margin:14px 0">' +
                '  <label style="display:block;font-weight:bold;margin-bottom:6px;font-size:0.95em;color:#475569">שם משפט חדש (אם תבחר לשמור את המקורי):</label>' +
                '  <input type="text" id="wc-new-name" dir="rtl" value="' + ('עותק של - ' + stage.number).replace(/"/g, '&quot;') + '" style="width:100%;padding:9px;font-size:1em;border:2px solid #e5e7eb;border-radius:8px">' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">' +
                '  <button id="wc-replace" style="padding:11px;border:none;border-radius:10px;background:#dc2626;color:white;font-size:1em;font-weight:bold;cursor:pointer">' + replaceLabel + '</button>' +
                '  <button id="wc-newstage" style="padding:11px;border:none;border-radius:10px;background:#0d9488;color:white;font-size:1em;font-weight:bold;cursor:pointer">📄 שמור את המקורי + צור משפט חדש</button>' +
                backupBtnHtml +
                '  <button id="wc-cancel" style="padding:10px;border:1px solid #cbd5e1;border-radius:10px;background:white;color:#475569;font-size:1em;cursor:pointer">ביטול</button>' +
                '</div>';
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            if (isHindus) {
                var backupBtn = box.querySelector('#wc-backup');
                if (backupBtn) backupBtn.onclick = () => {
                    overlay.remove();
                    try {
                        if (typeof HindusMode !== 'undefined' && HindusMode.backupBeforeClear) {
                            HindusMode.backupBeforeClear(stage.id);
                            HindusMode.clearHindus(stage.id);
                        }
                    } catch (e) {}
                    MessageManager.show('גיבוי נשמר. לשחזור — הודעה עתידית תוסיף כפתור שחזור לתפריט השלב.', 'success', 3500);
                    finalizeUpdate(updates, true);
                };
            }

            box.querySelector('#wc-replace').onclick = () => {
                overlay.remove();
                if (isHindus) {
                    try {
                        if (typeof HindusMode !== 'undefined' && HindusMode.clearHindus) HindusMode.clearHindus(stage.id);
                    } catch (e) {}
                }
                finalizeUpdate(updates, true);
            };
            box.querySelector('#wc-newstage').onclick = () => {
                const nameVal = box.querySelector('#wc-new-name').value.trim();
                if (!nameVal) { MessageManager.show('נדרש שם למשפט החדש', 'error'); return; }
                overlay.remove();
                createAsNewStage(updates, nameVal, sentenceClean, hasDiacritics, sentenceRaw);
            };
            box.querySelector('#wc-cancel').onclick = () => { overlay.remove(); };
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

            setTimeout(() => {
                const nameInput = box.querySelector('#wc-new-name');
                if (nameInput) {
                    nameInput.focus();
                    const len = nameInput.value.length;
                    try { nameInput.setSelectionRange(len, len); } catch (e) { /* noop */ }
                }
            }, 50);
        };

        modal.querySelector('#confirm-create-sentence').onclick = () => {
            const name = modal.querySelector('#new-sentence-name').value.trim();
            const sentenceRaw = modal.querySelector('#new-sentence-text').value.trim();
            const category = modal.querySelector('#new-sentence-category').value.trim();

            if (!sentenceRaw) { MessageManager.show('יש להכניס משפט', 'error'); return; }

            const sentenceClean = stripArabicDiacritics(sentenceRaw);
            const hasDiacritics = sentenceClean !== sentenceRaw;

            const updates = {
                number: name || sentenceClean.substring(0, 30),
                sentence: sentenceClean,
                category: category || 'custom'
            };
            if (hasDiacritics) {
                updates.diacritizedSentence = sentenceRaw;
            } else {
                updates.diacritizedSentence = undefined;
            }
            var answerField = modal.querySelector('#edit-hindus-answer');
            if (answerField) {
                updates.answer = answerField.value.trim();
            }
            var wrongField = modal.querySelector('#edit-hindus-wrong');
            if (wrongField) {
                var wrongVal = wrongField.value.trim();
                updates.wrongAnswer = wrongVal || null;
            }

            const originalClean = stripArabicDiacritics(stage.sentence);
            const originalCount = countWords(originalClean);
            const newCount = countWords(sentenceClean);

            if (sentenceClean !== originalClean && newCount !== originalCount) {
                showWordCountConfirm(updates, sentenceClean, hasDiacritics, sentenceRaw, originalCount, newCount);
                return;
            }

            // Same word count but text changed → sync saved analyses so word
            // text reflects the edit (analyses + arches preserved by position).
            if (sentenceClean !== originalClean) {
                const newWordsArr = sentenceClean.split(/\s+/).filter(w => w.trim());
                if (typeof persistence !== 'undefined' && persistence.patchStoredWordTexts) {
                    persistence.patchStoredWordTexts(stage.id, newWordsArr);
                }
                if (typeof HindusMode !== 'undefined' && HindusMode.patchWordTexts) {
                    HindusMode.patchWordTexts(stage.id, newWordsArr);
                }
            }

            finalizeUpdate(updates, false);
        };

        modal.querySelector('#cancel-create-sentence').onclick = () => { modal.classList.remove('show'); modal.remove(); };
        modal.querySelector('.close').onclick = () => { modal.classList.remove('show'); modal.remove(); };
        modal.onclick = (e) => { if (e.target === modal) { modal.classList.remove('show'); modal.remove(); } };

        modal.classList.add('show');
        setTimeout(() => modal.querySelector('#new-sentence-name').focus(), 100);
    },

    _startStage(stage) {
        const s = this._state;

        // Remember the last visited stage so a refresh can restore position.
        try {
            localStorage.setItem('plonter_lastStageId', String(stage.id));
            localStorage.setItem('plonter_lastMode', (stage.isHindus || stage.category === 'hindus') ? 'hindus' : 'syntax');
            localStorage.setItem('plonter_lastPositionSavedAt', String(Date.now()));
        } catch (e) {}

        // Check for saved data
        if (typeof persistence !== 'undefined' && persistence.hasSavedData(stage.id)) {
            persistence.load(stage.id);
        } else {
            s.loadSentence(stage);
        }

        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';

        // Hindus mode: word reordering + tagging instead of normal analysis
        if ((stage.isHindus || stage.category === 'hindus') && typeof HindusMode !== 'undefined') {
            HindusMode.deactivate();
            HindusMode.activate(stage);
            return;
        }

        // Normal mode
        if (typeof HindusMode !== 'undefined') HindusMode.deactivate();
        Annotations.loadForStage();
        Renderer.renderAll();

        // Show/hide hindus phenomena toolbar
        this._renderHindusBar(stage);
    },

    _renderHindusBar(stage) {
        // Remove existing bar
        const existing = document.getElementById('hindus-bar');
        if (existing) existing.remove();

        if (!stage.isHindus && stage.category !== 'hindus') return;

        const bar = document.createElement('div');
        bar.id = 'hindus-bar';
        bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:8px 16px;display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;z-index:100;direction:rtl;box-shadow:0 -2px 8px rgba(0,0,0,0.15)';

        // Tags
        if (stage.tags && stage.tags.length > 0) {
            const label = document.createElement('span');
            label.textContent = 'תופעות:';
            label.style.cssText = 'font-weight:bold;font-size:0.95em';
            bar.appendChild(label);

            stage.tags.forEach(tag => {
                const badge = document.createElement('span');
                badge.textContent = tag;
                badge.style.cssText = 'background:rgba(255,255,255,0.25);padding:4px 12px;border-radius:12px;font-size:0.9em;font-weight:bold';
                bar.appendChild(badge);
            });
        }

        // Show answer button
        if (stage.answer) {
            const sep = document.createElement('span');
            sep.textContent = '|';
            sep.style.cssText = 'margin:0 8px;opacity:0.5';
            bar.appendChild(sep);

            const answerBtn = document.createElement('button');
            answerBtn.textContent = 'הצג תשובה';
            answerBtn.style.cssText = 'background:rgba(255,255,255,0.3);border:none;color:white;padding:4px 14px;border-radius:12px;font-size:0.9em;font-weight:bold;cursor:pointer';
            let shown = false;
            const answerDiv = document.createElement('div');
            answerDiv.style.cssText = 'display:none;width:100%;text-align:center;padding:6px 0;font-size:1.2em;font-family:Arial,serif;direction:rtl';
            answerBtn.onclick = () => {
                shown = !shown;
                answerDiv.style.display = shown ? 'block' : 'none';
                answerDiv.textContent = stage.answer;
                answerBtn.textContent = shown ? 'הסתר תשובה' : 'הצג תשובה';
            };
            bar.appendChild(answerBtn);
            bar.appendChild(answerDiv);
        }

        document.body.appendChild(bar);
    }
};

// Re-render stages when ContentSync flips sync status (pending → synced,
// stale-token → unsynced) or when auth state changes. Without this, the
// pulsing-green border would stay on forever after the server ACKs a push.
(function _hookStagesContentSyncUpdates() {
    var _pending = null;
    document.addEventListener('contentsync:change', function(e) {
        if (!e || !e.detail || e.detail.contentType !== 'sentence') return;
        var welcome = document.getElementById('welcome-screen');
        if (!welcome || welcome.offsetParent === null) return;
        clearTimeout(_pending);
        _pending = setTimeout(function() { try { Modals.renderStages(); } catch (_) {} }, 120);
    });
    document.addEventListener('plonter:authchange', function() {
        var welcome = document.getElementById('welcome-screen');
        if (!welcome || welcome.offsetParent === null) return;
        try { Modals.renderStages(); } catch (_) {}
    });
})();

// The welcome tab switcher owns visibility, while Modals owns sentence list
// grouping. Re-render after analysis/hindus tab clicks so scoped "המשך עבודה"
// and category filters are rebuilt for the active domain.
(function _hookSentenceTabRerender() {
    function hook(id) {
        var el = document.getElementById(id);
        if (!el || el.dataset.plonterRenderHook) return;
        el.dataset.plonterRenderHook = '1';
        el.addEventListener('click', function() {
            setTimeout(function() {
                try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (_) {}
            }, 0);
        });
    }
    function install() {
        hook('tab-analysis');
        hook('tab-hindus');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();

// Inject "📥 ייבוא מ-JSON" buttons next to the existing "+ new sentence"
// buttons in the ניתוח and הינדוס tabs. Idempotent — re-adding on each
// render is cheap but we guard via ids anyway.
(function _injectJsonImportButtons() {
    function mk(id, isHindus) {
        if (document.getElementById(id)) return;
        var btn = document.createElement('button');
        btn.id = id;
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'font-size:1em;padding:8px 16px';
        btn.textContent = '📥 ייבוא מ-JSON';
        btn.addEventListener('click', function() {
            try { Modals.showImportSentencesDialog({ isHindus: !!isHindus }); } catch (_) {}
        });
        return btn;
    }
    function inject() {
        var aBtns = document.getElementById('analysis-buttons');
        if (aBtns && !document.getElementById('import-json-analysis-btn')) {
            var ab = mk('import-json-analysis-btn', false);
            if (ab) aBtns.appendChild(ab);
        }
        var hBtns = document.getElementById('hindus-buttons');
        if (hBtns && !document.getElementById('import-json-hindus-btn')) {
            var hb = mk('import-json-hindus-btn', true);
            if (hb) hBtns.appendChild(hb);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(inject, 200); });
    } else {
        setTimeout(inject, 200);
    }
})();
