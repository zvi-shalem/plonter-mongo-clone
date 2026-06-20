// Dictionary — multi-engine Arabic dictionary with tabs (Milson, Spoken, AI)

const Dictionary = {
    _panel: null,
    _searchMode: 1, // 1=by word, 0=by root
    _proxyUrl: (location.protocol === 'file:')
        ? 'https://iseemath.co/plonter/api/dict_proxy.php'
        : '/plonter/api/dict_proxy.php',
    _aiCacheUrl: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'https://iseemath.co/plonter/api/ai_dict_cache.php'
        : '/plonter/api/ai_dict_cache.php',
    _hujiFreeProxyUrl: '/plonter/api/huji_free_dictionary_proxy.php',
    _activeEngine: localStorage.getItem('dict_engine') || 'milson',
    _currentMediaPage: null, // set when current slide is a media slide
    _lastSearchedQuery: '', // track last searched term to hide redundant "חפש" button
    _lastSearchedEngine: '',
    _mobileSearchDismissed: false,

    init() {
        // Create toggle button on page load (before panel is created)
        this._createToggleButton();
        document.addEventListener('plonter:authchange', () => {
            this._updateToggleButton();
            setTimeout(() => this._updateToggleButton(), 300);
            setTimeout(() => this._updateToggleButton(), 1200);
        });
        setTimeout(() => this._updateToggleButton(), 0);
        setTimeout(() => this._updateToggleButton(), 1500);
    },

    lookup(word) {
        const clean = word.replace(/[\u064B-\u065F\u0670]/g, '');
        // Debounce: skip if same word looked up within 500ms
        var now = Date.now();
        if (this._lastLookupWord === clean && now - (this._lastLookupTime || 0) < 500) return;
        this._lastLookupWord = clean;
        this._lastLookupTime = now;
        this._showPanel(clean);
        this._searchCurrentEngine(clean);
    },

    _getOrCreatePanel() {
        if (this._panel) return this._panel;
        const panel = document.createElement('div');
        panel.id = 'dict-panel';
        panel.className = 'dict-panel';
        panel.style.zIndex = '10001';
        panel.innerHTML = `
            <div class="dict-panel-header">
                <button id="dict-mobile-close" onclick="Dictionary._hidePanel()" style="display:none;position:absolute;top:8px;left:20px;width:40px;height:40px;border:none;border-radius:50%;background:#ef4444;color:white;font-size:1.4em;cursor:pointer;z-index:1;line-height:1">✕</button>
                <div id="dict-tabs" style="display:flex;gap:0;margin-bottom:6px;direction:rtl;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;width:100%">
                    <button class="dict-tab" data-engine="milson" style="flex:1;padding:6px 10px;border:none;cursor:pointer;font-size:0.85em;font-weight:bold;transition:all 0.2s">מילסון</button>
                    <button class="dict-tab" data-engine="ai" style="flex:1;padding:6px 10px;border:none;cursor:pointer;font-size:0.85em;font-weight:bold;transition:all 0.2s">AI</button>
                    <button class="dict-tab" data-engine="spoken" style="flex:1;padding:6px 10px;border:none;cursor:pointer;font-size:0.85em;font-weight:bold;transition:all 0.2s">מדוברת</button>
                    <button class="dict-tab dict-tab-media" data-engine="media" style="flex:1;padding:6px 10px;border:none;cursor:pointer;font-size:0.85em;font-weight:bold;transition:all 0.2s;display:none;background:#ede9fe;color:#7c3aed">מדיה</button>
                </div>
                <div class="dict-search-row">
                    <span style="position:relative;flex:1;min-width:0;display:flex">
                        <input type="text" id="dict-search-input" class="dict-search-input" dir="rtl" placeholder="🔍" autocomplete="off" autocorrect="off" spellcheck="false" style="padding-left:28px;width:100%;box-sizing:border-box">
                        <button id="dict-clear-btn" type="button" title="נקה" style="position:absolute;left:6px;top:50%;transform:translateY(-50%);display:none;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;border-radius:50%;background:#cbd5e1;color:#475569;font-size:0.72em;line-height:1;cursor:pointer">✕</button>
                    </span>
                    <button id="dict-mode-btn" class="dict-search-btn" title="חיפוש לפי ערך / שורש" style="font-size:0.75em;white-space:nowrap;display:none">ערך</button>
                    <button id="dict-geresh-btn" class="dict-search-btn" title="הכנס גרש" style="font-size:1.1em;min-width:28px;padding:4px 6px">'</button>
                    <button id="dict-search-btn" class="dict-search-btn">🔍</button>
                </div>
                <button id="dict-mobile-search-btn" style="display:none;width:100%;padding:10px;border:none;border-radius:8px;background:#0d9488;color:white;font-size:1em;font-weight:bold;cursor:pointer;margin-top:6px">חיפוש + Ctrl+G</button>
            </div>
            <div id="dict-results" class="dict-results"></div>
            <div class="dict-footer" id="dict-footer">
                <a id="dict-milson-link" href="#" target="_blank" class="dict-milson-link">פתח במילסון ←</a>
                <a id="dict-milson-settings" href="#" style="font-size:0.75em;color:#9ca3af;margin-right:8px;text-decoration:none">שנה פרטים</a>
            </div>
        `;
        document.body.appendChild(panel);

        // Tab click handlers
        panel.querySelectorAll('.dict-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                var prevEngine = this._activeEngine;
                this._activeEngine = tab.dataset.engine;
                // Don't persist 'media' as default engine — it's context-dependent
                if (this._activeEngine !== 'media') {
                    localStorage.setItem('dict_engine', this._activeEngine);
                }
                // Close right media panel when switching to media on left (mutual exclusion)
                if (this._activeEngine === 'media' && this._mediaRightPanel && this._mediaRightPanel.classList.contains('show')) {
                    this._hideMediaRightPanel();
                }
                // Save focus when entering media tab
                if (this._activeEngine === 'media' && prevEngine !== 'media') {
                    this._savedFocusEl = document.activeElement;
                    this._savedFocusSel = null;
                    try { var s = window.getSelection(); if (s && s.rangeCount > 0) this._savedFocusSel = s.getRangeAt(0).cloneRange(); } catch(ex) {}
                }
                // Restore focus when leaving media tab
                if (this._activeEngine !== 'media' && prevEngine === 'media') {
                    if (this._savedFocusEl && this._savedFocusEl.focus) {
                        this._savedFocusEl.focus();
                        if (this._savedFocusSel) { try { var s = window.getSelection(); s.removeAllRanges(); s.addRange(this._savedFocusSel); } catch(ex) {} }
                    }
                }
                this._updateTabStyles();
                this._updateFooterVisibility();
                this._mobileSearchDismissed = false;
                // Recompute the green search button visibility (hidden in media; conditional otherwise)
                this._updateSearchButtonMode();
                // Media tab: hide+pause presentation video. Other tabs: show it
                this._togglePresentationVideo(this._activeEngine !== 'media');
                // Auto-search if there's text in the input
                const q = panel.querySelector('#dict-search-input').value.trim();
                if (q) this._searchCurrentEngine(q);
                else this._showEngineHint();
            });
        });
        this._updateTabStyles();

        // Clear (✕) button — clears the search input and refocuses it. Visibility is
        // driven by _updateSearchButtonMode (shown only when there is text). (Amitai 2026-06-17)
        panel.querySelector('#dict-clear-btn').onclick = () => {
            const input = panel.querySelector('#dict-search-input');
            input.value = '';
            input.dispatchEvent(new Event('input'));
            input.focus();
            this._updateSearchButtonMode();
        };

        // Geresh button — inserts ' at cursor position in dict input
        panel.querySelector('#dict-geresh-btn').onclick = () => {
            const input = panel.querySelector('#dict-search-input');
            const pos = input.selectionStart || input.value.length;
            input.value = input.value.slice(0, pos) + "'" + input.value.slice(pos);
            input.focus();
            input.setSelectionRange(pos + 1, pos + 1);
            input.dispatchEvent(new Event('input'));
        };

        // Search mode toggle (by word / by root)
        const modeBtn = panel.querySelector('#dict-mode-btn');
        this._updateModeButton(modeBtn);
        modeBtn.onclick = () => {
            this._searchMode = this._searchMode === 1 ? 0 : 1;
            this._updateModeButton(modeBtn);
            const q = panel.querySelector('#dict-search-input').value.trim();
            if (q && this._activeEngine === 'milson') this._search(q);
        };

        const milsonLink = panel.querySelector('#dict-milson-link');
        milsonLink.title = 'פתח במילסון (התחברות אוטומטית)';
        this._updateMilsonLockState(milsonLink);
        milsonLink.addEventListener('click', (e) => {
            e.preventDefault();
            var creds = this._getMilsonCredentials();
            if (!creds) {
                this._showMilsonCredentialsPopup();
                return;
            }
            const q = panel.querySelector('#dict-search-input').value.trim();
            const redirectUrl = 'https://www.yisumatica.org.il/plonter6/api/milson_redirect.php?email=' + encodeURIComponent(creds.email) + '&pass=' + encodeURIComponent(creds.password) + (q ? '&q=' + encodeURIComponent(q) : '');
            window.open(redirectUrl, '_blank');
        });
        panel.querySelector('#dict-milson-settings').addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('milson_credentials');
            this._updateMilsonLockState(milsonLink);
            this._showMilsonCredentialsPopup();
        });
        const convertHebrewSearch = (input) => {
            if (!input) return;
            if (typeof window.heb2ar === 'function') {
                input.value = window.heb2ar(input.value);
            } else if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                input.value = DetailsPanel._convertHebrewToArabic(input.value);
            }
            input.dispatchEvent(new Event('input'));
        };
        const isCtrlG = (e) => {
            return !!(e && (e.ctrlKey || e.metaKey) && (e.code === 'KeyG' || e.key === 'g' || e.key === 'G' || e.key === 'ע' || e.keyCode === 71));
        };
        const runSearchFromInput = () => {
            const input = panel.querySelector('#dict-search-input');
            const q = input.value.trim();
            this._mobileSearchDismissed = true;
            this._updateSearchButtonMode();
            if (q) this._searchCurrentEngine(q);
        };
        panel.querySelector('#dict-search-btn').onclick = (e) => {
            const input = panel.querySelector('#dict-search-input');
            const convertMode = e.currentTarget.dataset.dictConvertMode === '1';
            if (convertMode || (e && (e.ctrlKey || e.metaKey))) {
                convertHebrewSearch(input);
            }
            runSearchFromInput();
        };

        const mobileSearchBtn = panel.querySelector('#dict-mobile-search-btn');
        const dictInput = panel.querySelector('#dict-search-input');
        dictInput.addEventListener('focus', () => {
            this._mobileSearchDismissed = false;
            this._updateSearchButtonMode();
        });
        dictInput.addEventListener('input', () => this._updateSearchButtonMode());

        // AI autocomplete — debounced suggest from shared cache
        var _aiSuggestTimer = null;
        dictInput.addEventListener('input', () => {
            if (this._activeEngine !== 'ai') return;
            var _val = dictInput.value.replace(/[ً-ٰٟ]/g, '').trim();
            var _sugg = document.getElementById('dict-ai-suggest');
            if (_val.length < 2) { if (_sugg) _sugg.style.display = 'none'; return; }
            clearTimeout(_aiSuggestTimer);
            _aiSuggestTimer = setTimeout(() => {
                if (this._activeEngine !== 'ai') return;
                fetch(this._aiCacheUrl + '?action=suggest&prefix=' + encodeURIComponent(_val) + '&limit=10')
                    .then(function(r) { return r.json(); })
                    .then((data) => {
                        if (!data || !Array.isArray(data.terms) || !data.terms.length) {
                            var s = document.getElementById('dict-ai-suggest');
                            if (s) s.style.display = 'none';
                            return;
                        }
                        var sugg = document.getElementById('dict-ai-suggest');
                        if (!sugg) {
                            sugg = document.createElement('div');
                            sugg.id = 'dict-ai-suggest';
                            sugg.style.cssText = 'width:100%;background:#fff;border:2px solid #8b5cf6;border-radius:10px;box-shadow:0 6px 18px rgba(139,92,246,0.28);overflow:hidden;direction:rtl;max-height:200px;overflow-y:auto;margin-bottom:6px';
                            var resultsEl = this._panel.querySelector('#dict-results');
                            if (resultsEl && resultsEl.parentNode) resultsEl.parentNode.insertBefore(sugg, resultsEl);
                        }
                        sugg.innerHTML = '<div style="padding:5px 12px;background:#f5f3ff;color:#7c3aed;font-size:0.78em;font-weight:600;border-bottom:1px solid #ede9fe;direction:rtl">📚 כבר במילון — לחצו לחיפוש מיידי</div>';
                        data.terms.forEach((term) => {
                            var item = document.createElement('div');
                            item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.95em;display:flex;align-items:center;gap:6px;border-bottom:1px solid #f3f4f6';
                            item.innerHTML = '<span style="color:#8b5cf6">📚</span><span dir="rtl">' + term + '</span><span style="font-size:0.8em;color:#9ca3af;margin-right:auto">כבר במאגר</span>';
                            item.addEventListener('mousedown', (e) => {
                                e.preventDefault();
                                dictInput.value = term;
                                sugg.style.display = 'none';
                                this._searchAI(term);
                            });
                            item.addEventListener('mouseover', function() { this.style.background = '#f5f3ff'; });
                            item.addEventListener('mouseout', function() { this.style.background = ''; });
                            sugg.appendChild(item);
                        });
                        sugg.style.display = 'block';
                    })
                    .catch(() => {});
            }, 200);
        });
        dictInput.addEventListener('blur', () => {
            setTimeout(() => {
                var sugg = document.getElementById('dict-ai-suggest');
                if (sugg) sugg.style.display = 'none';
            }, 150);
        });

        mobileSearchBtn.onclick = (e) => {
            convertHebrewSearch(dictInput);
            runSearchFromInput();
        };

        panel.querySelector('#dict-search-input').onkeydown = (e) => {
            if (e.key === 'Enter') {
                runSearchFromInput();
            }
            if (isCtrlG(e)) {
                e.preventDefault();
                convertHebrewSearch(e.target);
                runSearchFromInput();
            }
        };

        // Ensure toggle button exists (created in init, but guard if panel opened before init)
        if (!document.getElementById('dict-toggle-btn')) this._createToggleButton();

        this._panel = panel;
        this._installOutsideInteractionGuard();
        this._updateSearchButtonMode();
        this._updateFooterVisibility();
        // Media tab visibility + styling from a single source of truth.
        this._updateTabStyles();
        return panel;
    },

    _updateModeButton(btn) {
        if (!btn) return;
        if (this._searchMode === 0) {
            btn.textContent = 'שורש';
            btn.style.background = '#0d9488';
            btn.style.color = 'white';
        } else {
            btn.textContent = 'ערך';
            btn.style.background = 'rgba(255,255,255,0.2)';
            btn.style.color = 'white';
        }
    },

    _updateTabStyles() {
        if (!this._panel) return;
        var rightOpen = this._mediaRightPanel && this._mediaRightPanel.classList.contains('show');
        this._panel.querySelectorAll('.dict-tab').forEach(tab => {
            const isActive = tab.dataset.engine === this._activeEngine;
            // Media tab: single source of truth for visibility + distinct purple styling so it stands out.
            if (tab.dataset.engine === 'media') {
                tab.style.display = this._shouldShowMediaTab() ? '' : 'none';
                // Red indicator with X when right panel is open
                if (rightOpen) {
                    tab.style.background = '#ef4444';
                    tab.style.color = 'white';
                    tab.innerHTML = '✕ מדיה';
                    return;
                }
                tab.innerHTML = 'מדיה';
                tab.style.background = isActive ? '#7c3aed' : '#ede9fe';
                tab.style.color = isActive ? 'white' : '#7c3aed';
                return;
            }
            tab.style.background = isActive ? '#0d9488' : '#f8fafc';
            tab.style.color = isActive ? 'white' : '#64748b';
        });
    },

    // Single source of truth: should the media tab be visible right now?
    // Visible whenever media is available for this context and not explicitly
    // blocked (media slides block it because the video already shows in the slide).
    _shouldShowMediaTab() {
        if (this._mediaTabBlocked) return false;
        return !!(this._currentMediaPage
            || (this._mediaLibrary && this._mediaLibrary.length > 0)
            || typeof MediaStorage !== 'undefined');
    },

    // Apply just the media-tab show/hide using the single source of truth.
    // Cheap enough to call on every panel open so the tab is correct from the start.
    _applyMediaTabVisibility() {
        if (!this._panel) return;
        var mediaTab = this._panel.querySelector('.dict-tab-media');
        if (mediaTab) mediaTab.style.display = this._shouldShowMediaTab() ? '' : 'none';
    },

    _updateFooterVisibility() {
        if (!this._panel) return;
        const footer = this._panel.querySelector('#dict-footer');
        if (footer) {
            // Milson footer only visible for milson engine
            footer.style.display = this._activeEngine === 'milson' ? 'flex' : 'none';
        }
        // Hide search row when media tab is active
        const searchRow = this._panel.querySelector('.dict-search-row');
        if (searchRow) {
            searchRow.style.display = this._activeEngine === 'media' ? 'none' : 'flex';
        }
        // The green "חיפוש + Ctrl+G" button is meaningless in media mode — hide it there
        // (Amitai 2026-06-17). Non-media states are handled by _updateSearchButtonMode.
        const mobileBtn = document.getElementById('dict-mobile-search-btn');
        if (mobileBtn && this._activeEngine === 'media') mobileBtn.style.display = 'none';
    },

    _showEngineHint() {
        if (!this._panel) return;
        const results = this._panel.querySelector('#dict-results');
        if (this._activeEngine === 'milson') {
            var creds = this._getMilsonCredentials();
            if (!creds) {
                // Try to auto-fill from server if logged in (non-blocking)
                var user = (typeof PlonterAuth !== 'undefined') ? PlonterAuth.getUser() : null;
                if (user && user.token) {
                    this._fetchMilsonCredsFromServer();
                    return;
                }
                var self2 = this;
                var isDragon = (typeof PlonterAdmin !== 'undefined' && PlonterAdmin.isDragon && PlonterAdmin.isDragon());
                if (isDragon) {
                    results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">הקלד מילה בערבית וחפש במילון החינמי</div>';
                    return;
                }
                results.innerHTML = '<div style="text-align:center;color:#6b7280;padding:24px"><p style="margin-bottom:12px">נדרשים פרטי התחברות למילסון</p><button id="dict-enter-milson-btn2" style="padding:8px 20px;border:none;border-radius:8px;background:#0d9488;color:white;cursor:pointer;font-weight:bold">הזן פרטים</button></div>';
                var btn = results.querySelector('#dict-enter-milson-btn2');
                if (btn) btn.onclick = function() { self2._showMilsonCredentialsPopup(); };
                return;
            }
            results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">הקלד מילה בערבית וחפש</div>';
        } else if (this._activeEngine === 'spoken') {
            results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">חיפוש במילון ערבית מדוברת (Madrasa Free)</div>';
        } else if (this._activeEngine === 'ai') {
            // Big-button landing — never auto-search (Amitai 2026-05-17).
            var dictInput = this._panel.querySelector('#dict-search-input');
            this._showAILanding(dictInput ? dictInput.value : '');
        } else if (this._activeEngine === 'media') {
            this._showMediaContent();
        }
    },

    _updateSearchButtonMode() {
        if (!this._panel) return;
        var dictInput = this._panel.querySelector('#dict-search-input');
        var searchBtn = this._panel.querySelector('#dict-search-btn');
        var mobileBtn = document.getElementById('dict-mobile-search-btn');
        if (!dictInput || !searchBtn || !mobileBtn) return;
        var v = dictInput.value;
        var trimmed = v.trim();
        // Clear (✕) button: show only when the field has any text.
        var clearBtn = this._panel.querySelector('#dict-clear-btn');
        if (clearBtn) clearBtn.style.display = v.length > 0 ? 'flex' : 'none';
        var hasHebrew = this._isHebrew(v);
        var matchesLast = trimmed !== '' && trimmed === this._lastSearchedQuery && this._activeEngine === this._lastSearchedEngine;
        var focused = document.activeElement === dictInput;
        if (hasHebrew && matchesLast) {
            searchBtn.innerHTML = 'א←ع';
            searchBtn.title = 'המר עברית לערבית וחפש (Ctrl+G)';
            searchBtn.dataset.dictConvertMode = '1';
            mobileBtn.style.display = this._activeEngine === 'media' ? 'none' : 'block';
        } else {
            searchBtn.innerHTML = '🔍';
            searchBtn.title = 'חיפוש';
            searchBtn.dataset.dictConvertMode = '0';
            // Keep the green mobile search/convert button available for any
            // Hebrew input. Pressing Enter searches the Hebrew text but does not
            // remove the user's need to convert/search it as Arabic.
            var hasUnsearchedText = trimmed !== '' && !matchesLast;
            if (hasHebrew && trimmed !== '') hasUnsearchedText = true;
            var showMobile = hasUnsearchedText || (focused && !this._mobileSearchDismissed);
            mobileBtn.style.display = (showMobile && this._activeEngine !== 'media') ? 'block' : 'none';
        }
    },

    _searchCurrentEngine(word) {
        if (this._activeEngine === 'media') {
            this._showMediaContent();
            return;
        }
        this._lastSearchedQuery = word;
        this._lastSearchedEngine = this._activeEngine;
        this._updateSearchButtonMode();
        if (this._activeEngine === 'milson') {
            this._search(word);
        } else if (this._activeEngine === 'spoken') {
            this._searchSpoken(word);
        } else if (this._activeEngine === 'ai') {
            // Never auto-fire on Enter / top search button — show the landing
            // with a big "🔍 חפש AI: <word>" button instead (Amitai 2026-05-17).
            this._showAILanding(word);
        }
    },

    // === SPOKEN ARABIC (Madrasa Free) ===
    _searchSpoken(word) {
        const results = this._panel.querySelector('#dict-results');
        const cleanWord = word.replace(/[\u064B-\u065F\u0670]/g, '');
        // Madrasafree expects Hebrew input — convert Arabic to Hebrew
        var hebrewWord = cleanWord;
        if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertArabicToHebrew) {
            hebrewWord = DetailsPanel._convertArabicToHebrew(cleanWord);
        }
        const extUrl = 'https://milon.madrasafree.com/?searchString=' + encodeURIComponent(hebrewWord);
        const proxyUrl = (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
            ? 'https://iseemath.co/plonter/api/madrasafree_proxy.php'
            : '/plonter/api/madrasafree_proxy.php') + '?q=' + encodeURIComponent(hebrewWord);

        results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">...מחפש במדרסה</div>';

        fetch(proxyUrl)
            .then(r => r.json())
            .then(data => {
                if (!data.entries || data.entries.length === 0) {
                    results.innerHTML = `
                        <div style="text-align:center;padding:24px;color:#6b7280">
                            <div>לא נמצאו תוצאות</div>
                            <a href="${extUrl}" target="_blank" style="display:inline-block;margin-top:12px;padding:8px 16px;background:#0d9488;color:white;border-radius:8px;text-decoration:none;font-size:0.85em">חפש במדרסה פרי</a>
                        </div>`;
                    return;
                }
                // Strip Arabic diacritics from Hebrew transliterations (madrasafree mixes them)
                var stripArabicDiacritics = function(s) { return s.replace(/[\u064B-\u065F\u0670]/g, ''); };
                var html = '';
                data.entries.forEach(function(e) {
                    html += '<div style="padding:10px 0;border-bottom:1px solid #f0f0f0;direction:rtl">';
                    // Hebrew heading
                    if (e.heb) html += '<div style="font-weight:bold;color:#0d9488;font-size:1.05em;margin-bottom:4px">' + e.heb + '</div>';
                    // Arabic + transliteration row
                    html += '<div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap">';
                    if (e.arabic) html += '<span style="font-family:Times New Roman,serif;font-size:1.3em;font-weight:bold">' + e.arabic + '</span>';
                    if (e.translit) html += '<span style="color:#6b7280;font-size:0.9em">' + stripArabicDiacritics(e.translit) + '</span>';
                    html += '</div>';
                    // Grammar tags
                    if (e.grammar && e.grammar.length) {
                        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">';
                        e.grammar.forEach(function(g) {
                            html += '<span style="background:#f0fdfa;color:#0d9488;padding:1px 6px;border-radius:4px;font-size:0.75em">' + g + '</span>';
                        });
                        html += '</div>';
                    }
                    // Definition
                    if (e.definition) html += '<div style="margin-top:4px;color:#374151">' + e.definition + '</div>';
                    // Note
                    if (e.note) html += '<div style="margin-top:4px;color:#9ca3af;font-size:0.85em">' + e.note + '</div>';
                    // Number forms (singular/plural)
                    if (e.forms && e.forms.length) {
                        e.forms.forEach(function(f) {
                            html += '<div style="margin-top:4px;font-size:0.85em;color:#6b7280">';
                            if (f.label) html += '<span>' + f.label + ': </span>';
                            if (f.arabic) html += '<span style="font-family:Times New Roman,serif;font-weight:bold">' + f.arabic + '</span> ';
                            if (f.translit) html += '<span>(' + stripArabicDiacritics(f.translit) + ')</span>';
                            html += '</div>';
                        });
                    }
                    html += '</div>';
                });
                html += '<div style="text-align:center;padding:8px"><a href="' + extUrl + '" target="_blank" style="color:#0d9488;font-size:0.8em;text-decoration:none">פתח במדרסה פרי</a></div>';
                results.innerHTML = html;
            })
            .catch(function() {
                results.innerHTML = `
                    <div style="text-align:center;padding:24px;color:#6b7280">
                        <div>שגיאה בחיפוש</div>
                        <a href="${extUrl}" target="_blank" style="display:inline-block;margin-top:12px;padding:8px 16px;background:#0d9488;color:white;border-radius:8px;text-decoration:none;font-size:0.85em">חפש במדרסה פרי</a>
                    </div>`;
            });
    },

    _DICT_AI_API_KEY: 'AIzaSyBrG-PhSSPatBAWcFBE5OA_t4_A9DKg_Vg',

    // === AI QUOTA TRACKING (Amitai 2026-05-17) ===
    // Gemini free-tier limit is 20 requests/minute on gemini-2.5-flash. We
    // track a rolling 60s window of request timestamps in localStorage so the
    // UI can warn before the user hits a hard 429. Keep the normalized window
    // persisted too, so a close/reopen reads the same counter state instead of
    // reconstructing it from stale or malformed legacy data.
    _AI_QUOTA_LIMIT: 20,
    _AI_QUOTA_WINDOW_MS: 60000,
    _AI_QUOTA_USAGE_KEY: 'dict_ai_usage',
    _aiQuotaReadWindow(now) {
        var raw = localStorage.getItem(this._AI_QUOTA_USAGE_KEY) || '[]';
        var parsed;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = []; }
        var arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.timestamps) ? parsed.timestamps : []);
        arr = arr.map(function(ts) { return parseInt(ts, 10) || 0; })
            .filter(function(ts) { return ts > now - this._AI_QUOTA_WINDOW_MS && ts <= now + 5000; }, this);
        try { localStorage.setItem(this._AI_QUOTA_USAGE_KEY, JSON.stringify(arr)); } catch (e) {}
        return arr;
    },
    _aiQuotaState() {
        var now = Date.now();
        var arr = this._aiQuotaReadWindow(now);
        var blockedUntil = parseInt(localStorage.getItem('dict_ai_quota_until') || '0', 10) || 0;
        if (blockedUntil && blockedUntil < now) blockedUntil = 0;
        return {
            used: arr.length,
            limit: this._AI_QUOTA_LIMIT,
            remaining: Math.max(0, this._AI_QUOTA_LIMIT - arr.length),
            blockedUntil: blockedUntil,
            oldestExpiresAt: arr.length ? arr[0] + this._AI_QUOTA_WINDOW_MS : 0
        };
    },
    _aiQuotaMark() {
        var now = Date.now();
        var arr = this._aiQuotaReadWindow(now);
        arr.push(now);
        try { localStorage.setItem(this._AI_QUOTA_USAGE_KEY, JSON.stringify(arr)); } catch (e) {}
    },
    _aiQuotaSetBlocked(retryAfterSec) {
        var secs = Number(retryAfterSec);
        if (!isFinite(secs) || secs <= 0) secs = 60;
        var until = Date.now() + Math.ceil(secs * 1000);
        localStorage.setItem('dict_ai_quota_until', String(until));
    },
    _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); },
    _isAIBusyError(status, message) {
        var txt = String((status || '') + ' ' + (message || '')).toLowerCase();
        return /resource_exhausted|unavailable|overload|quota|rate|too many|exhaust|capacity|busy|429|503/.test(txt);
    },
    _showAIBusyMessage(results) {
        if (!results) return;
        results.innerHTML =
            '<div style="margin:18px 10px;padding:18px 16px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;text-align:center;direction:rtl;color:#9a3412;box-shadow:0 2px 8px rgba(154,52,18,0.08)">' +
            '<div style="font-size:1.7em;margin-bottom:8px">⏳</div>' +
            '<div style="font-weight:800;font-size:1.05em;margin-bottom:6px">כרגע אי אפשר להשתמש במילון AI בשל עומס יתר</div>' +
            '<div style="font-size:0.95em;color:#a16207">עמכם הסליחה</div>' +
            '</div>';
    },
    _aiResponseText(data) {
        if (!data || !Array.isArray(data.candidates) || !data.candidates.length) return '';
        var candidate = data.candidates[0] || {};
        var content = candidate.content || {};
        if (!Array.isArray(content.parts)) return '';
        return content.parts.map(function(p) { return p && p.text ? p.text : ''; }).join('').trim();
    },
    _aiEmptyReason(data) {
        if (!data) return 'empty';
        if (data.promptFeedback && data.promptFeedback.blockReason) {
            return 'prompt_blocked:' + data.promptFeedback.blockReason;
        }
        if (Array.isArray(data.candidates) && data.candidates.length) {
            var c = data.candidates[0] || {};
            if (c.finishReason && c.finishReason !== 'STOP') return 'finish:' + c.finishReason;
            if (c.safetyRatings) return 'safety';
        }
        return 'empty';
    },
    _showAITransientMessage(results, word, reason) {
        if (!results) return;
        var safeWord = this._esc(word || '');
        var safeReason = this._esc(reason || 'empty');
        results.innerHTML =
            '<div class="dict-empty" style="line-height:1.7">' +
                '<div style="font-weight:bold;color:#7c3aed;margin-bottom:6px">ה-AI לא החזיר תוכן הפעם</div>' +
                '<div style="font-size:0.9em;color:#6b7280;margin-bottom:12px">זו בדרך כלל תקלה רגעית או חסימת בטיחות זמנית, לא בהכרח שאין ערך במילון.</div>' +
                '<button id="dict-ai-retry-btn" style="padding:9px 18px;background:#8b5cf6;color:white;border:none;border-radius:9px;cursor:pointer;font-weight:bold">נסה שוב' + (safeWord ? ': ' + safeWord : '') + '</button>' +
                '<div style="font-size:0.75em;color:#9ca3af;margin-top:8px;direction:ltr">reason=' + safeReason + '</div>' +
            '</div>';
        var btn = results.querySelector('#dict-ai-retry-btn');
        if (btn) btn.onclick = () => this._searchAI(word);
    },
    _showAILanding(word) {
        if (!this._panel) return;
        var results = this._panel.querySelector('#dict-results');
        if (!results) return;
        var st = this._aiQuotaState();
        var w = (word || '').trim();
        if (st.blockedUntil) {
            var secsLeft = Math.max(1, Math.ceil((st.blockedUntil - Date.now()) / 1000));
            results.innerHTML = '<div style="text-align:center;padding:32px 24px"><p style="font-size:1.05em;margin-bottom:10px;color:#dc2626;font-weight:bold">😞 השימושים נגמרו</p><p style="font-size:0.9em;color:#6b7280">יתחדש בעוד ' + secsLeft + ' שניות</p></div>';
            return;
        }
        var disabled = !w;
        var label = '🔍 חפש AI' + (w ? ': ' + this._esc(w) : '');
        var btnBg = disabled ? '#9ca3af' : '#8b5cf6';
        var btnCursor = disabled ? 'not-allowed' : 'pointer';
        results.innerHTML =
            '<div style="text-align:center;padding:32px 24px">' +
            '<p style="font-size:0.9em;margin-bottom:16px;color:#8b5cf6">נשארו ~' + st.remaining + '/' + st.limit + ' חיפושי AI לדקה הקרובה</p>' +
            '<button id="dict-ai-go-btn" ' + (disabled ? 'disabled ' : '') +
              'style="display:block;margin:0 auto;padding:14px 32px;border:none;border-radius:12px;background:' + btnBg + ';color:white;cursor:' + btnCursor + ';font-size:1.1em;font-weight:bold;box-shadow:0 3px 10px rgba(139,92,246,0.3)">' + label + '</button>' +
            (disabled ? '<p style="margin-top:14px;font-size:0.85em;color:#9ca3af">הקלד מילה למעלה כדי לחפש</p>' : '') +
            '</div>';
        var self = this;
        var btn = results.querySelector('#dict-ai-go-btn');
        if (btn && !disabled) btn.onclick = function() { self._searchAI(w); };
    },

    // === AI DICTIONARY (two-stage: fast primary entry, then expand on demand) ===
    // Stage 1 (_searchAI): single primary POS entry, no related[]. Fast TTFB.
    // Stage 2 (_searchAIExpand): all OTHER POS entries + same-root list, fired
    // when the user clicks the "חפש עוד ערכים" button under the primary card.
    async _searchAI(word) {
        const results = this._panel.querySelector('#dict-results');
        const cleanWord = word.replace(/[ً-ٰٟ]/g, '');
        // Bail to landing if quota window currently blocked — don't waste a
        // request just to get back a 429 (Amitai 2026-05-17 quota UI).
        const qstate = this._aiQuotaState();
        if (qstate.blockedUntil) { this._showAILanding(word); return; }
        // Shared AI cache — serve from DB without spending a quota slot
        try {
            const _cr = await fetch(this._aiCacheUrl + '?action=lookup&term=' + encodeURIComponent(cleanWord) + '&stage=primary');
            const _cd = await _cr.json();
            if (_cd && _cd.found) {
                const _ce = _cd.result;
                let _cp = _ce.primary;
                if (!_cp && Array.isArray(_ce.pos_entries) && _ce.pos_entries.length) _cp = _ce.pos_entries[0];
                if (!_cp && _ce.meanings) _cp = { pos: '', form: _ce.value || cleanWord, meanings: _ce.meanings.map(function(m) { return typeof m === 'string' ? m : (m && m.text) || ''; }), example: _ce.example };
                if (_cp) {
                    const _likes = _cd.likes || { entry: 0, meanings: {} };
                    const _cpMe = this._dictAIEntryToMilson(_cp, _ce.value || cleanWord, _ce.root || '');
                    this._aiSortMeaningsByLikes(_cpMe, _likes.meanings);
                    results.innerHTML = '';
                    const _aiLbl = document.createElement('div');
                    _aiLbl.className = 'dict-empty';
                    _aiLbl.style.fontSize = '0.85em';
                    _aiLbl.innerHTML = 'תוצאות AI עבור "' + (_ce.value || cleanWord) + '" <span style="font-size:0.8em;color:#9ca3af;margin-right:6px">📚 מהמאגר</span>';
                    results.appendChild(_aiLbl);
                    this.renderMilsonEntries(results, [_cpMe]);
                    const _newEnt = results.querySelector('.dict-entry:last-of-type') || results.querySelector('.dict-entry');
                    if (_newEnt) this._aiDecorateEntryWithLikes(_newEnt, cleanWord, 'primary', _likes);
                    const _expBtn = document.createElement('button');
                    _expBtn.id = 'dict-ai-expand-btn';
                    _expBtn.textContent = '🔎 חפש עוד ערכים מאותו שורש';
                    _expBtn.style.cssText = 'display:block;margin:14px auto;padding:10px 22px;background:#8b5cf6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:0.95em;font-family:inherit;font-weight:600;box-shadow:0 2px 6px rgba(139,92,246,0.25)';
                    const _fM = Array.isArray(_cp.meanings) ? (_cp.meanings[0] || '') : '';
                    _expBtn.onclick = () => { this._searchAIExpand(cleanWord, _ce.root || '', _cp.pos || '', _fM, results, _expBtn); };
                    results.appendChild(_expBtn);
                    return;
                }
            }
        } catch (_) {} // fall through to live AI on cache error
        this._aiQuotaMark();
        results.innerHTML = '<div class="dict-loading">AI מחפש...</div>';
        const apiKey = this._DICT_AI_API_KEY;
        const prompt = [
            'You are an Arabic dictionary assistant. Define the Arabic word: "' + cleanWord + '".',
            'Return ONLY valid JSON (no markdown, no ``` fences, no commentary).',
            '',
            'CRITICAL DIACRITICS RULE: EVERY Arabic token (headword, form, example, proper nouns) MUST carry full tashkeel (fatha/damma/kasra/sukun/shadda/tanween). Proper nouns too: مِصْر, لُبْنَان, دِمَشْق, مُحَمَّد. If unknown, infer standard Classical/MSA vocalization. Never output a bare Arabic letter without its diacritic.',
            '',
            'STAGE 1 — return ONLY ONE POS entry (the most common surface meaning). Do NOT include other POS entries. Do NOT include same-root related words. The user will explicitly request expansion later.',
            '',
            'CRITICAL VERB RULE: when "pos" is פועל, return a "valences" ARRAY — ONE ENTRY PER ARABIC PREPOSITION. Each valence has EXACTLY ONE Arabic preposition in .ar (with full diacritics). Do NOT combine multiple prepositions into one valence even if their Hebrew meanings are similar — return them as separate entries. Each valence has its OWN Hebrew rendering (.he, e.g. "התחייב ל-") + its OWN specific meaning + its OWN Arabic example sentence that actually uses THAT preposition. Example for التزم: valences = [{ar:"بِـ", he:"התחייב ב-/ל-", meaning:"התחייב, נצמד, דבק (בכללים, בחוק)", example:{ar:"الْتَزَمَ بِالْقَوَانِيْنِ", he:"התחייב לכללים"}}, {ar:"ـه", he:"התחייב למשהו (מושא ישיר)", meaning:"לקח על עצמו, התחייב לבצע", example:{ar:"الْتَزَمَتِ الشَّرِكَةُ الْمَشْرُوعَ", he:"החברה לקחה על עצמה את הפרויקט"}}]. Verbs with direct object (no preposition) use ar:"-".',
            '',
            'For NON-verb POS (noun, adjective, adverb, particle, …) omit "valences" entirely and use the flat "meanings" + "example" fields.',
            '',
            'Schema:',
            '{',
            '  "value": "<headword with full diacritics>",',
            '  "root": "<root letters with no diacritics, e.g. ك ت ب> or null",',
            '  "primary": {',
            '    "pos": "<Hebrew POS label: פועל / שם עצם / שם תואר / תואר הפועל / מילית / ...>",',
            '    "form": "<headword in this POS, fully diacritized; for verbs include past+present (e.g. كَتَبَ/يَكْتُبُ) WITHOUT the preposition — prepositions go inside valences[]; for nouns include plural>",',
            '    "valences": [    // VERBS ONLY — omit for non-verbs',
            '      {',
            '        "ar": "<Arabic preposition with diacritics, e.g. إِلَى / فِي / لِ / عَلَى; or \\"-\\" for transitive direct-object>",',
            '        "he": "<Hebrew verb + preposition rendering, e.g. כתב אל / רצה ב- / לקח את>",',
            '        "meaning": "<Hebrew meaning SPECIFIC to this government (1 short phrase)>",',
            '        "example": {"ar": "<diacritized Arabic sentence using THIS valence>", "he": "<Hebrew translation>"}',
            '      }',
            '    ],',
            '    "meanings": ["<Hebrew sense>"],   // non-verbs: 1-3 senses, ONE array element PER DISTINCT semantic sense. Synonyms of the SAME sense go in one element comma-separated (e.g. "רמה, דרגה"); clearly different senses (concrete vs metaphorical/figurative) go in SEPARATE elements, e.g. ["מישור","רמה, דרגה"]. verbs: leave empty or omit',
            '    "example": {"ar":"...", "he":"..."}  // non-verbs only',
            '  }',
            '}'
        ].join('\n');

        try {
            // One transparent retry on empty response (Gemini occasionally
            // returns no candidates due to rate-limit / safety / transient
            // glitch — user hits "אין תוצאות AI" then succeeds on manual retry).
            let data, text = '';
            for (let attempt = 0; attempt < 2; attempt++) {
                const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
                    })
                });
                data = await resp.json();
                if (data && data.error) {
                    const m = data.error.message || data.error.status || 'AI error';
                    // RESOURCE_EXHAUSTED → parse "Please retry in Xs" and
                    // surface the landing with the renewal countdown.
                    if (this._isAIBusyError(data.error.status, m)) {
                        const mm = /retry in ([0-9.]+)\s*s/i.exec(m);
                        const secs = mm ? parseFloat(mm[1]) : 60;
                        this._aiQuotaSetBlocked(secs);
                        this._showAIBusyMessage(results);
                        return;
                    }
                    results.innerHTML = '<div class="dict-empty">שגיאת AI: ' + m + '</div>';
                    return;
                }
                text = this._aiResponseText(data);
                if (text) break;
                if (attempt === 0) await new Promise(r => setTimeout(r, 800));
            }
            if (!text) { this._showAITransientMessage(results, cleanWord, this._aiEmptyReason(data)); return; }
            let entry;
            try {
                const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                entry = JSON.parse(clean);
            } catch (e) {
                results.innerHTML = '<div style="padding:12px;direction:rtl;font-size:0.95em;line-height:1.7"><div class="dict-ai-card">' + text.replace(/\n/g, '<br>') + '</div></div>';
                return;
            }

            // Backward-compat: legacy responses returned pos_entries[]; treat
            // the first entry as primary so old caches still render cleanly.
            let primary = entry.primary;
            if (!primary && Array.isArray(entry.pos_entries) && entry.pos_entries.length) {
                primary = entry.pos_entries[0];
            }
            if (!primary && entry.meanings) {
                primary = {
                    pos: '',
                    form: entry.value || cleanWord,
                    meanings: entry.meanings.map(m => typeof m === 'string' ? m : (m && m.text) || ''),
                    example: entry.example
                };
            }
            if (!primary) { this._showAITransientMessage(results, cleanWord, 'json_without_primary'); return; }

            const primaryMe = this._dictAIEntryToMilson(primary, entry.value || cleanWord, entry.root || '');
            // Fresh result — no likes yet; empty map, no sort needed
            const _freshLikes = { entry: 0, meanings: {} };

            results.innerHTML = '';
            const aiLabel = document.createElement('div');
            aiLabel.className = 'dict-empty';
            aiLabel.style.fontSize = '0.85em';
            aiLabel.textContent = 'תוצאות AI עבור "' + (entry.value || cleanWord) + '"';
            results.appendChild(aiLabel);
            this.renderMilsonEntries(results, [primaryMe]);
            const _freshEnt = results.querySelector('.dict-entry:last-of-type') || results.querySelector('.dict-entry');
            if (_freshEnt) this._aiDecorateEntryWithLikes(_freshEnt, cleanWord, 'primary', _freshLikes);

            // Stage 2 trigger button — appended once. Click → _searchAIExpand.
            const expandBtn = document.createElement('button');
            expandBtn.id = 'dict-ai-expand-btn';
            expandBtn.textContent = '🔎 חפש עוד ערכים מאותו שורש';
            expandBtn.style.cssText = 'display:block;margin:14px auto;padding:10px 22px;background:#8b5cf6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:0.95em;font-family:inherit;font-weight:600;box-shadow:0 2px 6px rgba(139,92,246,0.25)';
            const firstMeaning = Array.isArray(primary.meanings) ? (primary.meanings[0] || '') : '';
            expandBtn.onclick = () => {
                this._searchAIExpand(cleanWord, entry.root || '', primary.pos || '', firstMeaning, results, expandBtn);
            };
            results.appendChild(expandBtn);
            // Save primary result to shared cache (fire-and-forget)
            fetch(this._aiCacheUrl + '?action=save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', term: cleanWord, stage: 'primary', result_json: JSON.stringify(entry) }) }).catch(() => {});
        } catch (err) {
            results.innerHTML = '<div class="dict-error">שגיאת רשת: ' + err.message + '</div>';
        }
    },

    _dictAIEntryToMilson(pe, fallbackValue, rootStr) {
        const me = {
            value: pe.form || fallbackValue,
            root: rootStr || '',
            meanings: []
        };
        if (pe.pos) me.gender = pe.pos;
        // Verb valences: each valence gets its own labeled meaning row + its
        // own example in dict-extra-forms (concatenated). Falls back to flat
        // meanings[] + valence string for non-verb entries or legacy responses.
        const valences = Array.isArray(pe.valences) ? pe.valences.filter(v => v && (v.he || v.meaning || v.ar)) : [];
        if (valences.length) {
            const exAr = [], exHe = [];
            valences.forEach(v => {
                const he = v.he || '';
                const ar = (v.ar && v.ar !== '-') ? v.ar : '';
                const meaning = v.meaning || (Array.isArray(v.meanings) ? v.meanings.join(', ') : '');
                // Format: "<he> (<ar>) — <meaning>" so both the Hebrew rendering
                // AND the Arabic preposition are visible.
                let row = '';
                if (he) row += he;
                if (ar) row += (row ? ' ' : '') + '(' + ar + ')';
                if (meaning) row += (row ? ' — ' : '') + meaning;
                if (row) me.meanings.push({ text: row });
                if (v.example && v.example.ar) {
                    exAr.push(v.example.ar);
                    if (v.example.he) exHe.push(v.example.he);
                }
            });
            if (exAr.length) {
                me.additional = { 'דוגמאות': exAr };
                if (exHe.length) me.additional['תרגום'] = exHe;
            }
        } else {
            (Array.isArray(pe.meanings) ? pe.meanings : [])
                .filter(Boolean)
                .forEach(t => me.meanings.push({ text: String(t) }));
            if (pe.example && pe.example.ar) {
                me.additional = { 'דוגמה': [pe.example.ar] };
                if (pe.example.he) me.additional['תרגום'] = [pe.example.he];
            }
            if (pe.valence) me.meanings.unshift({ text: 'הצרכה: ' + pe.valence });
        }
        return me;
    },

    async _searchAIExpand(cleanWord, knownRoot, excludePos, excludeMeaning, container, btn) {
        btn.disabled = true;
        btn.textContent = '⏳ מחפש עוד...';
        // Try shared AI cache first for expand results
        try {
            const _cr = await fetch(this._aiCacheUrl + '?action=lookup&term=' + encodeURIComponent(cleanWord) + '&stage=expand');
            const _cd = await _cr.json();
            if (_cd && _cd.found) {
                btn.remove();
                const _ce = _cd.result;
                const _expLikes = _cd.likes || { entry: 0, meanings: {} };
                const _rootStr = _ce.root || knownRoot || '';
                const _otherPos = Array.isArray(_ce.other_pos_entries) ? _ce.other_pos_entries : [];
                const _milson = _otherPos.map(pe => {
                    const me = this._dictAIEntryToMilson(pe, cleanWord, _rootStr);
                    this._aiSortMeaningsByLikes(me, _expLikes.meanings);
                    return me;
                });
                if (_milson.length) {
                    const _beforeExp = container.querySelectorAll('.dict-entry').length;
                    this.renderMilsonEntries(container, _milson);
                    const _allExp = container.querySelectorAll('.dict-entry');
                    for (let _ei = _beforeExp; _ei < _allExp.length; _ei++) {
                        this._aiDecorateEntryWithLikes(_allExp[_ei], cleanWord, 'expand', _expLikes);
                    }
                }
                const _related = Array.isArray(_ce.related) ? _ce.related.filter(r => r && r.ar) : [];
                if (_related.length) {
                    const _div = document.createElement('div');
                    _div.className = 'dict-root-divider';
                    _div.style.cursor = 'pointer';
                    _div.innerHTML = '<span>מאותו שורש' + (_rootStr ? ': ' + _rootStr : '') + (_ce.rootMeaning ? ' — ' + _ce.rootMeaning : '') + '</span>';
                    const _sec = document.createElement('div');
                    _sec.className = 'dict-root-section';
                    let _rv = true;
                    _div.addEventListener('click', () => { _rv = !_rv; _sec.style.display = _rv ? 'block' : 'none'; _div.classList.toggle('collapsed', !_rv); });
                    container.appendChild(_div);
                    container.appendChild(_sec);
                    this.renderMilsonEntries(_sec, _related.map(r => ({ value: r.ar, meanings: r.he ? [{ text: r.he }] : [] })), { autoExpand: false });
                // Add like buttons to related entries (no auto-expand) + seed cache for future searches
                const _relEls = _sec.querySelectorAll('.dict-entry');
                _related.forEach((r, _ri) => {
                    const _relClean = (r.ar || '').replace(/[ً-ٰٟ]/g, '');
                    if (_relEls[_ri]) this._aiDecorateEntryWithLikes(_relEls[_ri], _relClean, 'primary', { entry: 0, meanings: {} }, { noExpand: true });
                    if (_relClean) {
                        const _mini = { value: r.ar, root: _rootStr || null, primary: { pos: '', form: r.ar, meanings: r.he ? [r.he] : [], example: null } };
                        fetch(this._aiCacheUrl + '?action=save_related', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term: _relClean, result_json: JSON.stringify(_mini) }) }).catch(() => {});
                    }
                });
                }
                if (!_milson.length && !_related.length) {
                    const _note = document.createElement('div');
                    _note.className = 'dict-empty';
                    _note.textContent = 'אין עוד ערכים';
                    container.appendChild(_note);
                }
                return;
            }
        } catch (_) {} // fall through to live AI on cache error
        const apiKey = this._DICT_AI_API_KEY;
        const prompt = [
            'You are an Arabic dictionary assistant. The Arabic word "' + cleanWord + '" was already shown to the user with POS "' + (excludePos || 'unknown') + '" and primary Hebrew meaning "' + (excludeMeaning || 'unknown') + '".',
            '',
            'Return EVERYTHING ELSE: (a) all OTHER parts of speech the same surface form takes (do NOT repeat the POS already shown); (b) a SHORT list (5-8) of related words from the same root, each with diacritics + short Hebrew gloss.',
            '',
            'CRITICAL DIACRITICS RULE: every Arabic token MUST carry full tashkeel. Never output a bare Arabic letter without its diacritic. Proper nouns too.',
            '',
            'CRITICAL VERB RULE: when an entry has "pos":"פועל", populate "valences": one entry per government pattern, each with its own ar (preposition with diacritics, or "-" for direct object), he (Hebrew verb+preposition rendering), meaning (Hebrew sense specific to THIS government), and example. Omit "valences" for non-verbs.',
            '',
            'Return ONLY valid JSON (no markdown). If the word has no productive root (proper noun, borrowing) or no other POS, return empty arrays.',
            '',
            'Schema:',
            '{',
            '  "root": "<root letters with no diacritics, or null>",',
            '  "rootMeaning": "<short Hebrew gloss of root, or null>",',
            '  "other_pos_entries": [',
            '    {',
            '      "pos": "<Hebrew POS>",',
            '      "form": "<diacritized headword in this POS; verbs include past+present WITHOUT preposition>",',
            '      "valences": [   // VERBS ONLY',
            '        {"ar":"<prep diacritized or \\"-\\">", "he":"<verb+prep in Hebrew>", "meaning":"<Hebrew meaning for THIS valence>", "example":{"ar":"...", "he":"..."}}',
            '      ],',
            '      "meanings": ["<Hebrew sense>"],   // non-verbs only — ONE element per distinct sense; synonyms of the same sense comma-separated inside an element; split concrete vs metaphorical senses into separate elements (e.g. ["מישור","רמה, דרגה"])',
            '      "example": {"ar": "<...>", "he": "<...>"}  // non-verbs only',
            '    }',
            '  ],',
            '  "related": [ {"ar": "<diacritized word>", "he": "<short Hebrew gloss>"} ]',
            '}'
        ].join('\n');

        try {
            const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
                })
            });
            const data = await resp.json();
            if (data && data.error) {
                const m = data.error.message || data.error.status || 'AI error';
                if (this._isAIBusyError(data.error.status, m)) {
                    this._aiQuotaSetBlocked(60);
                    this._showAIBusyMessage(container);
                    btn.remove();
                    return;
                }
                btn.textContent = 'שגיאת AI';
                btn.title = m;
                return;
            }
            let text = this._aiResponseText(data);
            if (!text) {
                btn.textContent = 'נסה שוב';
                btn.disabled = false;
                btn.title = 'AI returned no content: ' + this._aiEmptyReason(data);
                return;
            }
            let entry;
            try {
                const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                entry = JSON.parse(clean);
            } catch (e) { btn.textContent = 'שגיאה בפענוח'; return; }

            // Save expand result to shared cache (fire-and-forget)
            fetch(this._aiCacheUrl + '?action=save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', term: cleanWord, stage: 'expand', result_json: JSON.stringify(entry) }) }).catch(() => {});

            btn.remove();

            const rootStr = entry.root || knownRoot || '';
            const otherPos = Array.isArray(entry.other_pos_entries) ? entry.other_pos_entries : [];
            const _freshExpLikes = { entry: 0, meanings: {} };
            const milsonEntries = otherPos.map(pe => this._dictAIEntryToMilson(pe, cleanWord, rootStr));
            if (milsonEntries.length) {
                const _beforeLive = container.querySelectorAll('.dict-entry').length;
                this.renderMilsonEntries(container, milsonEntries);
                const _allLive = container.querySelectorAll('.dict-entry');
                for (let _li2 = _beforeLive; _li2 < _allLive.length; _li2++) {
                    this._aiDecorateEntryWithLikes(_allLive[_li2], cleanWord, 'expand', _freshExpLikes);
                }
            }

            const related = Array.isArray(entry.related) ? entry.related.filter(r => r && r.ar) : [];
            if (related.length) {
                const divider = document.createElement('div');
                divider.className = 'dict-root-divider';
                divider.style.cursor = 'pointer';
                divider.innerHTML = '<span>מאותו שורש' + (rootStr ? ': ' + rootStr : '') +
                    (entry.rootMeaning ? ' — ' + entry.rootMeaning : '') + '</span>';
                const rootSection = document.createElement('div');
                rootSection.className = 'dict-root-section';
                let rootVisible = true;
                divider.addEventListener('click', () => {
                    rootVisible = !rootVisible;
                    rootSection.style.display = rootVisible ? 'block' : 'none';
                    divider.classList.toggle('collapsed', !rootVisible);
                });
                container.appendChild(divider);
                container.appendChild(rootSection);
                this.renderMilsonEntries(rootSection, related.map(r => ({
                    value: r.ar,
                    meanings: r.he ? [{ text: r.he }] : []
                })), { autoExpand: false });
                // Add like buttons to related entries (no auto-expand) + seed cache for future searches
                const _relElsLive = rootSection.querySelectorAll('.dict-entry');
                related.forEach((r, _ri) => {
                    const _relClean = (r.ar || '').replace(/[ً-ٰٟ]/g, '');
                    if (_relElsLive[_ri]) this._aiDecorateEntryWithLikes(_relElsLive[_ri], _relClean, 'primary', { entry: 0, meanings: {} }, { noExpand: true });
                    if (_relClean) {
                        const _mini = { value: r.ar, root: rootStr || null, primary: { pos: '', form: r.ar, meanings: r.he ? [r.he] : [], example: null } };
                        fetch(this._aiCacheUrl + '?action=save_related', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term: _relClean, result_json: JSON.stringify(_mini) }) }).catch(() => {});
                    }
                });
            }

            if (!milsonEntries.length && !related.length) {
                const note = document.createElement('div');
                note.className = 'dict-empty';
                note.textContent = 'אין עוד ערכים';
                container.appendChild(note);
            }
        } catch (err) {
            btn.textContent = 'שגיאה: ' + err.message;
        }
    },

    openStandalone() {
        this._captureCallerFocus();
        const panel = this._getOrCreatePanel();
        // Recompute media-tab visibility on every open (toggle-button path).
        this._applyMediaTabVisibility();
        const input = panel.querySelector('#dict-search-input');
        const hadValue = input.value && input.value.length > 0;
        if (!hadValue || this._activeEngine === 'ai') this._showEngineHint();
        setTimeout(() => {
            panel.classList.add('show');
            this._updateToggleButton();
            var body = document.querySelector('.lesson-presenter .lp-body');
            if (body) body.classList.add('dict-open');
            document.body.classList.add('dict-panel-open');
            this._shiftMediaButton(true);
            input.focus();
            if (hadValue) { try { input.select(); } catch (e) {} }
            this._updateSearchButtonMode();
        }, 50);
    },

    // Like openStandalone, but if user has selected text, look it up directly.
    // Call this from buttons where selection-driven lookup is desired.
    openStandaloneOrLookup() {
        try {
            var sel = window.getSelection();
            var text = sel ? sel.toString().trim() : '';
            if (text) { this.lookup(text); return; }
        } catch (e) {}
        this.openStandalone();
    },

    _showPanel(word) {
        // Snapshot caller cursor/selection BEFORE we wipe it on line below.
        this._captureCallerFocus();
        const panel = this._getOrCreatePanel();
        // If media tab is active and user is looking up a word, switch to milson
        if (this._activeEngine === 'media') {
            this._activeEngine = localStorage.getItem('dict_engine') || 'milson';
            this._updateTabStyles();
            this._updateFooterVisibility();
        }
        // Clear text selection first to prevent mobile auto-paste into input
        try { window.getSelection().removeAllRanges(); } catch(e) {}
        var input = panel.querySelector('#dict-search-input');
        input.value = word;
        // Defensive: verify no duplication after mobile events settle
        var _expected = word;
        setTimeout(function() { if (input.value !== _expected) input.value = _expected; }, 50);
        if (this._activeEngine === 'milson') {
            panel.querySelector('#dict-milson-link').href =
                'https://arabdictionary.huji.ac.il/ArabDictionaryV2#/Search/' + encodeURIComponent(word);
        }
        panel.querySelector('#dict-results').innerHTML = '<div class="dict-loading">טוען...</div>';
        // Recompute media-tab visibility on every open (state may have changed since build).
        this._applyMediaTabVisibility();
        panel.classList.add('show');
        this._updateToggleButton();
        // Shift lesson content right
        var body = document.querySelector('.lesson-presenter .lp-body');
        if (body) body.classList.add('dict-open');
        document.body.classList.add('dict-panel-open');
        this._shiftMediaButton(true);
    },

    // Snapshot the caller's text selection / cursor BEFORE the dict opens, so
    // we can restore it on close. Skips when the dict is already showing
    // (preserve original capture across in-panel typing).
    _captureCallerFocus() {
        try {
            if (this._panel && this._panel.classList.contains('show')) return;
            this._outsideInteractionWhileOpen = false;
            var ae = document.activeElement;
            if (this._panel && ae && this._panel.contains(ae)) return;
            // Form input / textarea cursor (their own selection API)
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
                this._savedCallerFocus = { kind: 'input', el: ae, start: ae.selectionStart, end: ae.selectionEnd };
                return;
            }
            // Document Range — captured even when COLLAPSED, so a bare caret
            // position in contenteditable is preserved (without this, focus()
            // snaps to start-of-content).
            var sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && sel.anchorNode) {
                var r = sel.getRangeAt(0);
                if (!(this._panel && this._panel.contains(r.commonAncestorContainer))) {
                    this._savedCallerFocus = { kind: 'range', range: r.cloneRange(), activeEl: ae, collapsed: sel.isCollapsed };
                    return;
                }
            }
            // Otherwise just remember the focused element
            if (ae && ae !== document.body) {
                this._savedCallerFocus = { kind: 'focus', el: ae };
            }
        } catch (e) {}
    },

    _restoreCallerFocus() {
        var s = this._savedCallerFocus;
        this._savedCallerFocus = null;
        if (!s) return;
        if (this._outsideInteractionWhileOpen) {
            this._outsideInteractionWhileOpen = false;
            return;
        }
        // Skip restore if user has already focused a text field OUTSIDE the
        // dict while dict was open (Amitai 2026-05-17: don't yank cursor back
        // to pre-open position when user has interacted with text elsewhere).
        try {
            var ae = document.activeElement;
            var outsidePanel = ae && ae !== document.body && (!this._panel || !this._panel.contains(ae));
            var isTextish = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
            if (outsidePanel && isTextish) return;
        } catch (e) {}
        // Whatever was focused while dict was open (typically #dict-search-input)
        // must be explicitly blurred first — otherwise some browsers leave it as
        // activeElement even after CSS-hide, and our subsequent focus() on the
        // original caller is silently dropped.
        try {
            if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
        } catch (e) {}
        var run = function() {
            try {
                if (s.kind === 'input') {
                    if (s.el && document.contains(s.el)) {
                        s.el.focus();
                        try { s.el.setSelectionRange(s.start, s.end); } catch (e) {}
                    }
                } else if (s.kind === 'range') {
                    // Focus the original element FIRST. For contenteditable, the
                    // browser only renders selection on the focused element.
                    if (s.activeEl && document.contains(s.activeEl) && s.activeEl !== document.body) {
                        try { s.activeEl.focus({ preventScroll: true }); } catch (e) { try { s.activeEl.focus(); } catch (e2) {} }
                    }
                    // Then set the selection. Verify it isn't disconnected.
                    var sel = window.getSelection();
                    if (sel && s.range) {
                        var startNode = s.range.startContainer;
                        var endNode = s.range.endContainer;
                        if (startNode && endNode && document.contains(startNode) && document.contains(endNode)) {
                            try { sel.removeAllRanges(); sel.addRange(s.range); } catch (e) {}
                        }
                    }
                } else if (s.kind === 'focus') {
                    if (s.el && document.contains(s.el)) {
                        try { s.el.focus({ preventScroll: true }); } catch (e) { try { s.el.focus(); } catch (e2) {} }
                    }
                }
            } catch (e) {}
        };
        // Defer to next frame so the panel CSS-hide completes before we re-claim
        // focus + selection. Without this, the still-painted dict input can win
        // the focus race on mobile.
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else setTimeout(run, 0);
    },

    _installOutsideInteractionGuard() {
        if (this._outsideInteractionGuardInstalled) return;
        this._outsideInteractionGuardInstalled = true;
        var self = this;
        var mark = function(e) {
            if (!self._panel || !self._panel.classList.contains('show')) return;
            if (e && e.target && self._panel.contains(e.target)) return;
            self._outsideInteractionWhileOpen = true;
        };
        document.addEventListener('mousedown', mark, true);
        document.addEventListener('touchstart', mark, true);
        document.addEventListener('focusin', mark, true);
    },

    _hidePanel() {
        if (this._panel) this._panel.classList.remove('show');
        // Also close right media panel if open
        this._hideMediaRightPanel();
        this._updateToggleButton();
        // Shift lesson content back
        var body = document.querySelector('.lesson-presenter .lp-body');
        if (body) body.classList.remove('dict-open');
        document.body.classList.remove('dict-panel-open');
        this._shiftMediaButton(false);
        // Restore presentation video (paused) when dict closes
        this._togglePresentationVideo(true);
        // Clean up media key handler and video sync
        if (this._mediaKeyHandler) {
            document.removeEventListener('keydown', this._mediaKeyHandler);
            this._mediaKeyHandler = null;
        }
        if (this._ytTimeTracker) { clearInterval(this._ytTimeTracker); this._ytTimeTracker = null; }
        this._ytPlayers = null;
        if (this._ytListener) { window.removeEventListener('message', this._ytListener); this._ytListener = null; }
        if (this._focusHandler) { window.removeEventListener('blur', this._focusHandler); this._focusHandler = null; }
        this._stopVideoSync();
        // Return cursor/selection to where the user was before opening dict.
        this._restoreCallerFocus();
    },

    _shiftMediaButton(open) {
        var btn = document.getElementById('lp-media-dict-btn');
        if (btn) {
            btn.style.display = open ? 'none' : 'block';
        }
    },

    _mediaRightPanel: null,
    _rightMediaPage: null, // separate state for right panel

    _getOrCreateMediaRightPanel() {
        if (this._mediaRightPanel) return this._mediaRightPanel;
        var panel = document.createElement('div');
        panel.id = 'dict-media-right-panel';
        panel.style.cssText = 'position:fixed;top:0;right:0;width:320px;height:100vh;background:white;box-shadow:-4px 0 20px rgba(0,0,0,0.15);z-index:2000;display:flex;flex-direction:column;transform:translateX(100%);transition:transform 0.3s ease;font-family:Arial,sans-serif';
        // Header
        var header = document.createElement('div');
        header.style.cssText = 'padding:10px 14px;background:linear-gradient(135deg,#7c3aed,#8b5cf6);color:white;display:flex;align-items:center;gap:8px;font-weight:bold;font-size:1em;direction:rtl';
        header.innerHTML = '<span style="flex:1">🎵 מדיה</span><button id="dict-media-right-close" style="background:none;border:none;color:white;font-size:1.3em;cursor:pointer">✕</button>';
        panel.appendChild(header);
        // Content area
        var content = document.createElement('div');
        content.id = 'dict-media-right-content';
        content.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden';
        panel.appendChild(content);
        document.body.appendChild(panel);
        // Close button handler
        panel.querySelector('#dict-media-right-close').onclick = () => this._hideMediaRightPanel(true);
        this._mediaRightPanel = panel;
        return panel;
    },

    _showMediaRightPanel() {
        var panel = this._getOrCreateMediaRightPanel();
        var content = panel.querySelector('#dict-media-right-content');
        // Use current media page as starting point for right panel
        this._rightMediaPage = this._currentMediaPage;
        // Clear media from left dict panel — switch to milson
        if (this._activeEngine === 'media') {
            this._activeEngine = localStorage.getItem('dict_engine') || 'milson';
            this._updateTabStyles();
            this._updateFooterVisibility();
            this._showEngineHint();
        }
        // Render media content into right panel
        this._showMediaContentInto(content);
        setTimeout(() => {
            panel.classList.add('show');
            panel.style.transform = 'translateX(0)';
            this._updateToggleButton();
            this._updateTabStyles(); // update media tab to red/X
            var body = document.querySelector('.lesson-presenter .lp-body');
            if (body) body.classList.add('media-right-open');
        }, 10);
    },

    _hideMediaRightPanel(switchToMediaTab) {
        if (this._mediaRightPanel) {
            this._mediaRightPanel.classList.remove('show');
            this._mediaRightPanel.style.transform = 'translateX(100%)';
        }
        var body = document.querySelector('.lesson-presenter .lp-body');
        if (body) body.classList.remove('media-right-open');
        // Switch left dict to media tab when closing right panel via button
        if (switchToMediaTab && this._panel && this._panel.classList.contains('show')) {
            this._activeEngine = 'media';
            this._updateFooterVisibility();
            this._showMediaContent();
            this._togglePresentationVideo(false);
        }
        this._updateTabStyles(); // restore media tab from red/X to normal
        this._updateToggleButton();
    },

    _showMediaContentInto(container) {
        // Render media content into right panel (uses _rightMediaPage, not shared state)
        if (!container) return;
        var page = this._rightMediaPage || this._currentMediaPage;
        // Build media library selector
        var libHtml = '';
        if (this._mediaLibrary && this._mediaLibrary.length > 0) {
            libHtml = '<div style="padding:6px 8px;border-bottom:1px solid #e5e7eb;max-height:120px;overflow-y:auto;direction:rtl">';
            for (var li = 0; li < this._mediaLibrary.length; li++) {
                var item = this._mediaLibrary[li];
                var isActive = page && (page.videoUrl === item.url || page.imageUrl === item.url);
                var lockIcon = item.locked ? '🔒 ' : '';
                libHtml += '<div class="dict-media-right-item" data-media-idx="' + li + '" style="padding:4px 8px;margin:2px 0;border-radius:6px;cursor:pointer;font-size:0.85em;background:' + (isActive ? '#ede9fe' : '#f8fafc') + ';border:1px solid ' + (isActive ? '#7c3aed' : '#e5e7eb') + ';display:flex;align-items:center;gap:4px">' +
                    '<span style="font-size:0.9em">' + lockIcon + '</span>' +
                    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (item.title || item.url.substring(0, 40)) + '</span>' +
                    '</div>';
            }
            libHtml += '</div>';
        }
        if (!page && (!this._mediaLibrary || this._mediaLibrary.length === 0)) {
            if (typeof MediaStorage !== 'undefined' && MediaStorage.renderDictMediaTab) {
                MediaStorage.renderDictMediaTab(container);
                return;
            }
            container.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">אין מדיה בשיעור</div>';
            return;
        }
        if (!page && this._mediaLibrary && this._mediaLibrary.length > 0) {
            page = { videoUrl: this._mediaLibrary[0].url, title: this._mediaLibrary[0].title };
        }
        var mediaUrl = page ? (page.videoUrl || page.imageUrl || '') : '';
        if (page && !mediaUrl && page.content) {
            var m = page.content.match(/(?:src=["'])([^"']+)/);
            if (m) mediaUrl = m[1];
        }
        if (!mediaUrl) {
            container.innerHTML = libHtml + '<div style="text-align:center;color:#9ca3af;padding:24px">אין מדיה בשקף הנוכחי</div>';
            return;
        }
        // Simple media display
        var isYT = /youtube\.com|youtu\.be/.test(mediaUrl);
        var isVideo = /\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl);
        var isAudio = /\.(mp3|wav|m4a|ogg)(\?|$)/i.test(mediaUrl);
        var html = libHtml + '<div style="padding:8px">';
        if (isYT) {
            var ytId = '';
            var ytm = mediaUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
            if (ytm) ytId = ytm[1];
            html += '<iframe src="https://www.youtube.com/embed/' + ytId + '?enablejsapi=1" style="width:100%;aspect-ratio:16/9;border:none;border-radius:8px" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"></iframe>';
        } else if (isVideo) {
            html += '<video controls style="width:100%;border-radius:8px" src="' + mediaUrl + '"></video>';
        } else if (isAudio) {
            html += '<audio controls style="width:100%" src="' + mediaUrl + '"></audio>';
        } else {
            html += '<img src="' + mediaUrl + '" style="width:100%;border-radius:8px;object-fit:contain" />';
        }
        if (page && page.title) html += '<div style="text-align:center;font-weight:bold;margin-top:8px;color:#374151;direction:rtl">' + page.title + '</div>';
        html += '</div>';
        container.innerHTML = html;
        // Wire library item clicks
        container.querySelectorAll('.dict-media-right-item').forEach(item => {
            item.onclick = () => {
                var idx = parseInt(item.dataset.mediaIdx);
                if (this._mediaLibrary && this._mediaLibrary[idx]) {
                    var mi = this._mediaLibrary[idx];
                    this._rightMediaPage = { videoUrl: mi.url, title: mi.title };
                    this._showMediaContentInto(container);
                }
            };
        });
    },

    _pausePresentationMedia() {
        // Pause/stop any playing video or YouTube iframe in the presentation viewport
        var viewport = document.getElementById('lp-viewport');
        if (!viewport) return;
        viewport.querySelectorAll('video').forEach(function(v) { v.pause(); });
        viewport.querySelectorAll('iframe').forEach(function(f) {
            if (f.src && f.src.indexOf('youtube') !== -1) {
                f.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
            }
        });
    },

    _togglePresentationVideo(show) {
        // Show/hide presentation video when switching between media tab and other tabs
        var videoWrap = document.getElementById('lp-video-wrap');
        if (!videoWrap) return;
        if (show) {
            // Restore video — visible but paused
            videoWrap.style.height = '';
            videoWrap.style.overflow = '';
            videoWrap.style.visibility = '';
            videoWrap.style.position = '';
        } else {
            // Hide video + pause + mute
            videoWrap.style.height = '0';
            videoWrap.style.overflow = 'hidden';
            videoWrap.style.visibility = 'hidden';
            videoWrap.style.position = 'absolute';
            this._pausePresentationMedia();
        }
    },

    _wireAudioPlayer(results, isYouTube) {
        var playBtn = results.querySelector('#dict-play-btn');
        var progressWrap = results.querySelector('#dict-progress-wrap');
        var progressBar = results.querySelector('#dict-progress-bar');
        var timeCurrent = results.querySelector('#dict-time-current');
        var timeTotal = results.querySelector('#dict-time-total');
        if (!playBtn) return;

        // Focus-reclaim button — appears when YouTube iframe steals focus
        var instrBtn = document.createElement('button');
        instrBtn.id = 'dict-focus-btn';
        instrBtn.textContent = '🔢 לחץ כאן כדי לרוץ על השמע בעזרת המספרים!';
        instrBtn.style.cssText = 'display:none;margin:10px auto;padding:12px 20px;border:2px solid #6366f1;border-radius:10px;background:#6366f1;color:white;font-size:1.05em;font-weight:bold;cursor:pointer;direction:rtl;width:100%;animation:lp-media-pulse 2s ease-in-out infinite';
        instrBtn.onclick = function() {
            instrBtn.style.display = 'none';
            // Return focus to page so number keys work
            document.body.focus();
        };
        results.appendChild(instrBtn);
        // Show button when page loses focus (YouTube iframe clicked)
        if (this._focusHandler) window.removeEventListener('blur', this._focusHandler);
        this._focusHandler = function() {
            // Check if focus went to an iframe
            setTimeout(function() {
                if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
                    instrBtn.style.display = 'block';
                }
            }, 100);
        };
        window.addEventListener('blur', this._focusHandler);

        // Audio/Video mode toggle button
        var modeBtn = document.createElement('button');
        modeBtn.id = 'dict-mode-toggle';
        modeBtn.textContent = '🎬 עבור למצב וידאו';
        modeBtn.style.cssText = 'display:block;margin:6px auto;padding:8px 16px;border:2px solid #0d9488;border-radius:10px;background:white;color:#0d9488;font-size:0.95em;font-weight:bold;cursor:pointer;direction:rtl;width:90%';
        var audioMode = true;
        modeBtn.onclick = function() {
            audioMode = !audioMode;
            modeBtn.textContent = audioMode ? '🎬 עבור למצב וידאו' : '🎵 עבור למצב שמע';
            var audioPlayer = results.querySelector('#dict-audio-player');
            var dictIframe = results.querySelector('#dict-yt-iframe');
            var dictVideo = results.querySelector('#dict-hidden-video');
            if (audioMode) {
                if (audioPlayer) audioPlayer.style.display = 'block';
                if (dictIframe) { dictIframe.style.width = '1px'; dictIframe.style.height = '1px'; dictIframe.style.opacity = '0'; dictIframe.style.pointerEvents = 'none'; }
                if (dictVideo) dictVideo.style.display = 'none';
            } else {
                if (audioPlayer) audioPlayer.style.display = 'none';
                if (dictIframe) { dictIframe.style.cssText = 'width:100%;aspect-ratio:16/9;border:none;border-radius:8px'; }
                if (dictVideo) { dictVideo.style.display = 'block'; dictVideo.controls = true; dictVideo.style.cssText = 'width:100%;border-radius:8px'; }
            }
        };
        results.appendChild(modeBtn);

        var self = this;
        var playing = false;
        var duration = 0;
        var currentTime = 0;

        function fmt(s) { var m = Math.floor(s/60); var sec = Math.floor(s%60); return m + ':' + (sec < 10 ? '0' : '') + sec; }
        var loadingText = results.querySelector('#dict-loading-text');
        function updateUI() {
            progressBar.style.width = duration > 0 ? (currentTime / duration * 100) + '%' : '0%';
            timeCurrent.textContent = fmt(currentTime);
            timeTotal.textContent = fmt(duration);
            playBtn.textContent = playing ? '⏸' : '▶';
            if (loadingText && duration > 0) { loadingText.style.display = 'none'; }
        }

        if (isYouTube) {
            // YouTube: use postMessage API
            var iframe = results.querySelector('#dict-yt-iframe');
            if (!iframe) return;
            // Listen for YT state messages
            var ytListener = function(e) {
                if (!e.data || typeof e.data !== 'string') return;
                try {
                    var d = JSON.parse(e.data);
                    if (d.event === 'infoDelivery' && d.info) {
                        if (d.info.currentTime !== undefined) { currentTime = d.info.currentTime; updateUI(); }
                        if (d.info.duration !== undefined) duration = d.info.duration;
                        if (d.info.playerState !== undefined) { playing = d.info.playerState === 1; updateUI(); }
                    }
                    if (d.event === 'initialDelivery' && d.info) {
                        if (d.info.duration) duration = d.info.duration;
                    }
                } catch(ex) {}
            };
            window.addEventListener('message', ytListener);
            self._ytListener = ytListener;
            // Request info updates after iframe loads
            iframe.addEventListener('load', function() {
                iframe.contentWindow.postMessage('{"event":"listening"}', '*');
            });

            playBtn.onclick = function() {
                var cmd = playing ? 'pauseVideo' : 'playVideo';
                iframe.contentWindow.postMessage(JSON.stringify({event:'command',func:cmd,args:''}), '*');
            };
            progressWrap.onclick = function(e) {
                if (duration <= 0) return;
                var pct = e.offsetX / progressWrap.offsetWidth;
                var t = pct * duration;
                iframe.contentWindow.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[t, true]}), '*');
            };
        } else {
            // HTML5 video
            var video = results.querySelector('#dict-hidden-video');
            if (!video) return;
            video.addEventListener('loadedmetadata', function() { duration = video.duration; updateUI(); });
            video.addEventListener('timeupdate', function() { currentTime = video.currentTime; updateUI(); });
            video.addEventListener('play', function() { playing = true; updateUI(); });
            video.addEventListener('pause', function() { playing = false; updateUI(); });
            video.addEventListener('ended', function() { playing = false; updateUI(); });

            playBtn.onclick = function() { if (video.paused) video.play(); else video.pause(); };
            progressWrap.onclick = function(e) {
                if (duration <= 0) return;
                var pct = e.offsetX / progressWrap.offsetWidth;
                video.currentTime = pct * duration;
            };
        }

        // Arrow key handler for seeking
        if (this._mediaKeyHandler) document.removeEventListener('keydown', this._mediaKeyHandler);
        this._mediaKeyHandler = function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            // Numpad-style relative seek: 5=center, left side back, right side forward
            // 8=-10s, 9=-7s, 4=-4s, 5=-1s | 6=+1s, 1=+4s, 2=+7s, 3=+10s
            // 0 or space = play/pause
            var keyMap = {'5': -1, '4': -4, '9': -7, '8': -10, '6': 1, '1': 4, '2': 7, '3': 10};
            var delta = keyMap[e.key];
            var isPlayPause = (e.key === '0' || e.key === ' ');
            var isArrow = (e.key === 'ArrowRight' || e.key === 'ArrowLeft');

            if (!delta && !isPlayPause && !isArrow) return;
            e.preventDefault();

            if (isPlayPause) {
                playBtn.click();
                // Also toggle presentation video
                var mainWrap = document.getElementById('lp-video-wrap');
                if (mainWrap) {
                    var mainVid = mainWrap.querySelector('video');
                    if (mainVid) { if (mainVid.paused) mainVid.play(); else mainVid.pause(); }
                    var mainIf = mainWrap.querySelector('iframe');
                    if (mainIf && mainIf.src && mainIf.src.indexOf('youtube') !== -1) {
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func: playing ? 'pauseVideo' : 'playVideo',args:''}), '*');
                    }
                }
            } else {
                var seekDelta = delta || (e.key === 'ArrowRight' ? 5 : -5);
                var newTime = Math.max(0, currentTime + seekDelta);
                // Seek dict panel media
                if (isYouTube) {
                    var iframe = results.querySelector('#dict-yt-iframe');
                    if (iframe) iframe.contentWindow.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[newTime, true]}), '*');
                } else {
                    var video = results.querySelector('#dict-hidden-video');
                    if (video) video.currentTime = Math.min(video.duration, newTime);
                }
                // Also seek presentation video
                var mainWrap = document.getElementById('lp-video-wrap');
                if (mainWrap) {
                    var mainVid = mainWrap.querySelector('video');
                    if (mainVid) mainVid.currentTime = Math.max(0, mainVid.currentTime + seekDelta);
                    var mainIf = mainWrap.querySelector('iframe');
                    if (mainIf && mainIf.src && mainIf.src.indexOf('youtube') !== -1) {
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[newTime, true]}), '*');
                    }
                }
            }
        };
        document.addEventListener('keydown', this._mediaKeyHandler);
    },

    // === MEDIA TAB ===
    setMediaPage(page) {
        this._currentMediaPage = page;
        this._applyMediaTabVisibility();
    },

    setMediaTabBlocked(blocked) {
        this._mediaTabBlocked = blocked;
        if (blocked && this._activeEngine === 'media') {
            this._activeEngine = localStorage.getItem('dict_engine') || 'milson';
            this._updateTabStyles();
            this._updateFooterVisibility();
        }
        this._applyMediaTabVisibility();
    },

    // Set global media library from all lesson pages + custom items
    setMediaLibrary(lesson) {
        this._mediaLibrary = [];
        this._currentLessonTitle = lesson ? lesson.title : null;
        if (!lesson || !lesson.pages) return;
        // Extract media from media slides (these are frozen/locked)
        for (var i = 0; i < lesson.pages.length; i++) {
            var p = lesson.pages[i];
            if ((p.type === 'image' || p.type === 'video') && (p.videoUrl || p.imageUrl)) {
                this._mediaLibrary.push({
                    url: p.videoUrl || p.imageUrl,
                    title: p.title || 'שקף ' + (i + 1),
                    fromSlide: i,
                    locked: true
                });
            }
        }
        // Add custom media items from lesson.mediaWarehouse
        if (lesson.mediaWarehouse) {
            for (var j = 0; j < lesson.mediaWarehouse.length; j++) {
                this._mediaLibrary.push({
                    url: lesson.mediaWarehouse[j].url,
                    title: lesson.mediaWarehouse[j].title || '',
                    fromSlide: -1,
                    locked: false
                });
            }
        }
        // Always show media tab if there's any media
        this._applyMediaTabVisibility();
        // Set first media item as current
        if (this._mediaLibrary.length > 0) {
            this._currentMediaPage = { videoUrl: this._mediaLibrary[0].url, title: this._mediaLibrary[0].title };
        }
    },

    clearMediaPage() {
        this._currentMediaPage = null;
        this._mediaLibrary = null;
        if (this._panel) {
            // Hide the media tab button
            var mediaTab = this._panel.querySelector('.dict-tab-media');
            if (mediaTab) mediaTab.style.display = 'none';
            // If media was the active tab, switch back to milson
            if (this._activeEngine === 'media') {
                this._activeEngine = localStorage.getItem('dict_engine') || 'milson';
                this._updateTabStyles();
                this._updateFooterVisibility();
                this._showEngineHint();
            }
        }
    },

    openMedia() {
        // Open dictionary panel with media tab selected
        if (!this._currentMediaPage) return;
        const panel = this._getOrCreatePanel();
        this._activeEngine = 'media';
        this._updateTabStyles();
        this._updateFooterVisibility();
        this._showMediaContent();
        setTimeout(() => {
            panel.classList.add('show');
            this._updateToggleButton();
            var body = document.querySelector('.lesson-presenter .lp-body');
            if (body) body.classList.add('dict-open');
            // Hide + pause presentation video when media tab opens
            this._togglePresentationVideo(false);
        }, 50);
    },

    _showMediaContent() {
        if (!this._panel) return;
        var results = this._panel.querySelector('#dict-results');
        if (!results) return;
        var page = this._currentMediaPage;
        // Build media library selector if we have multiple items
        var libHtml = '';
        if (this._mediaLibrary && this._mediaLibrary.length > 0) {
            var self = this;
            libHtml = '<div id="dict-media-library" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;max-height:120px;overflow-y:auto;direction:rtl">';
            for (var li = 0; li < this._mediaLibrary.length; li++) {
                var item = this._mediaLibrary[li];
                var isActive = page && (page.videoUrl === item.url || page.imageUrl === item.url);
                var lockIcon = item.locked ? '🔒 ' : '';
                libHtml += '<div class="dict-media-item" data-media-idx="' + li + '" style="padding:4px 8px;margin:2px 0;border-radius:6px;cursor:pointer;font-size:0.85em;background:' + (isActive ? '#dbeafe' : '#f8fafc') + ';border:1px solid ' + (isActive ? '#3b82f6' : '#e5e7eb') + ';display:flex;align-items:center;gap:4px">' +
                    '<span style="font-size:0.9em">' + lockIcon + '</span>' +
                    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (item.title || item.url.substring(0, 40)) + '</span>' +
                    '</div>';
            }
            libHtml += '</div>';
        }
        // Always show MediaStorage warehouse when available
        if (typeof MediaStorage !== 'undefined' && MediaStorage.renderDictMediaTab) {
            MediaStorage.renderDictMediaTab(results, this._currentLessonTitle);
            return;
        }
        if (!page && (!this._mediaLibrary || this._mediaLibrary.length === 0)) {
            results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">אין מדיה בשיעור</div>';
            return;
        }
        if (!page && this._mediaLibrary && this._mediaLibrary.length > 0) {
            // Default to first item
            page = { videoUrl: this._mediaLibrary[0].url, title: this._mediaLibrary[0].title };
            this._currentMediaPage = page;
        }
        var mediaUrl = page.videoUrl || page.imageUrl || '';
        if (!mediaUrl && page.content) {
            var m = page.content.match(/(?:src=["'])([^"']+)/);
            if (m) mediaUrl = m[1];
        }
        if (!mediaUrl) {
            results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">אין מדיה בשקף הנוכחי</div>';
            return;
        }
        // Detect type
        var embedUrl = '';
        var ytMatch;
        ytMatch = mediaUrl.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) embedUrl = 'https://www.youtube.com/embed/' + ytMatch[1];
        if (!embedUrl) { ytMatch = mediaUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/); if (ytMatch) embedUrl = 'https://www.youtube.com/embed/' + ytMatch[1]; }
        if (!embedUrl) { ytMatch = mediaUrl.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/); if (ytMatch) embedUrl = 'https://www.youtube.com/embed/' + ytMatch[1]; }

        var html = '';
        var isVideo = !!(embedUrl || /\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl));
        if (embedUrl) {
            // YouTube: hidden iframe + custom audio player UI
            html = '<div style="padding:8px">' +
                '<iframe id="dict-yt-iframe" src="' + embedUrl + '?enablejsapi=1&origin=' + encodeURIComponent(location.origin) + '" style="width:1px;height:1px;position:absolute;opacity:0;pointer-events:none" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"></iframe>' +
                '<div id="dict-audio-player" style="background:linear-gradient(135deg,#0d9488,#0891b2);border-radius:12px;padding:16px;color:white;direction:ltr">' +
                    '<div id="dict-loading-text" style="text-align:center;font-size:0.8em;opacity:0.8;margin-bottom:6px;direction:rtl">טוען...</div>' +
                    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' +
                        '<button id="dict-play-btn" style="background:white;color:#0d9488;border:none;border-radius:50%;width:40px;height:40px;font-size:1.2em;cursor:pointer;display:flex;align-items:center;justify-content:center">▶</button>' +
                        '<div style="flex:1">' +
                            '<div id="dict-progress-wrap" style="background:rgba(255,255,255,0.3);border-radius:4px;height:8px;cursor:pointer;position:relative">' +
                                '<div id="dict-progress-bar" style="background:white;height:100%;border-radius:4px;width:0%;transition:width 0.3s"></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;justify-content:space-between;font-size:0.8em;opacity:0.9">' +
                        '<span id="dict-time-current">0:00</span>' +
                        '<span style="font-size:0.75em;opacity:0.7">◀ ▶ חצים | 1-9 קפיצה</span>' +
                        '<span id="dict-time-total">0:00</span>' +
                    '</div>' +
                '</div></div>';
        } else if (/\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl)) {
            // HTML5 video: hidden video + custom audio player UI
            html = '<div style="padding:8px">' +
                '<video id="dict-hidden-video" src="' + mediaUrl.replace(/"/g, '&quot;') + '" style="display:none" preload="metadata"></video>' +
                '<div id="dict-audio-player" style="background:linear-gradient(135deg,#0d9488,#0891b2);border-radius:12px;padding:16px;color:white;direction:ltr">' +
                    '<div id="dict-loading-text" style="text-align:center;font-size:0.8em;opacity:0.8;margin-bottom:6px;direction:rtl">טוען...</div>' +
                    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' +
                        '<button id="dict-play-btn" style="background:white;color:#0d9488;border:none;border-radius:50%;width:40px;height:40px;font-size:1.2em;cursor:pointer;display:flex;align-items:center;justify-content:center">▶</button>' +
                        '<div style="flex:1">' +
                            '<div id="dict-progress-wrap" style="background:rgba(255,255,255,0.3);border-radius:4px;height:8px;cursor:pointer;position:relative">' +
                                '<div id="dict-progress-bar" style="background:white;height:100%;border-radius:4px;width:0%;transition:width 0.3s"></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;justify-content:space-between;font-size:0.8em;opacity:0.9">' +
                        '<span id="dict-time-current">0:00</span>' +
                        '<span style="font-size:0.75em;opacity:0.7">◀ ▶ חצים | 1-9 קפיצה</span>' +
                        '<span id="dict-time-total">0:00</span>' +
                    '</div>' +
                '</div></div>';
        } else {
            html = '<div style="padding:8px"><img src="' + mediaUrl.replace(/"/g, '&quot;') + '" style="width:100%;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1)" onerror="this.style.display=\'none\'"></div>';
        }
        results.innerHTML = libHtml + html;

        // Wire media library item clicks
        var self = this;
        var mediaItems = results.querySelectorAll('.dict-media-item');
        mediaItems.forEach(function(el) {
            el.addEventListener('click', function() {
                var idx = parseInt(el.dataset.mediaIdx);
                if (self._mediaLibrary && self._mediaLibrary[idx]) {
                    var item = self._mediaLibrary[idx];
                    self._currentMediaPage = { videoUrl: item.url, title: item.title };
                    self._showMediaContent();
                }
            });
        });

        // Wire up custom audio player for video types
        if (isVideo) this._wireAudioPlayer(results, !!embedUrl);
    },

    _startVideoSync() {
        this._stopVideoSync();
        var self = this;
        // For HTML5 video elements, sync via timeupdate events
        this._syncInterval = setInterval(function() {
            var mainWrap = document.getElementById('lp-video-wrap');
            if (!mainWrap || !self._panel) return;
            var dictResults = self._panel.querySelector('#dict-results');
            if (!dictResults) return;
            // Sync HTML5 videos
            var mainVideo = mainWrap.querySelector('video');
            var dictVideo = dictResults.querySelector('video');
            if (mainVideo && dictVideo) {
                if (Math.abs(mainVideo.currentTime - dictVideo.currentTime) > 1.5) {
                    dictVideo.currentTime = mainVideo.currentTime;
                }
                if (!mainVideo.paused && dictVideo.paused) dictVideo.play();
                if (mainVideo.paused && !dictVideo.paused) dictVideo.pause();
            }
        }, 1000);
    },

    _stopVideoSync() {
        if (this._syncInterval) {
            clearInterval(this._syncInterval);
            this._syncInterval = null;
        }
    },

    _applyToAllVideos(fn) {
        // Apply function to all video elements (dict panel + main slide)
        var targets = [];
        var dictResults = this._panel ? this._panel.querySelector('#dict-results') : null;
        if (dictResults) {
            var di = dictResults.querySelector('iframe');
            var dv = dictResults.querySelector('video');
            if (di) targets.push({iframe: di, video: null});
            if (dv) targets.push({iframe: null, video: dv});
        }
        var mainWrap = document.getElementById('lp-video-wrap');
        if (mainWrap) {
            var mi = mainWrap.querySelector('iframe');
            var mv = mainWrap.querySelector('video');
            if (mi) targets.push({iframe: mi, video: null});
            if (mv) targets.push({iframe: null, video: mv});
        }
        for (var i = 0; i < targets.length; i++) {
            fn(targets[i].iframe, targets[i].video);
        }
    },

    _initYTPlayers() {
        this._ytPlayers = [];
        var iframes = [];
        var dictResults = this._panel ? this._panel.querySelector('#dict-results') : null;
        if (dictResults) { var di = dictResults.querySelector('iframe'); if (di) iframes.push(di); }
        var mainWrap = document.getElementById('lp-video-wrap');
        if (mainWrap) { var mi = mainWrap.querySelector('iframe'); if (mi) iframes.push(mi); }
        for (var i = 0; i < iframes.length; i++) {
            try {
                var player = new YT.Player(iframes[i]);
                this._ytPlayers.push(player);
            } catch(ex) {}
        }
    },

    _ensureYouTubeAPI(callback) {
        if (window.YT && window.YT.Player) { callback(); return; }
        if (document.getElementById('yt-api-script')) {
            // Already loading, wait
            var check = setInterval(function() {
                if (window.YT && window.YT.Player) { clearInterval(check); callback(); }
            }, 100);
            return;
        }
        var tag = document.createElement('script');
        tag.id = 'yt-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
        window.onYouTubeIframeAPIReady = callback;
    },

    _createToggleButton() {
        // Add pulse animation if not exists
        if (!document.getElementById('dict-pulse-style')) {
            var style = document.createElement('style');
            style.id = 'dict-pulse-style';
            style.textContent = '@keyframes dict-pulse{0%,100%{transform:translateY(-50%) scale(1)}50%{transform:translateY(-50%) scale(1.15)}}';
            document.head.appendChild(style);
        }
        // Shared pulse driver (canonical copy in tasksPanel.js) — anchors every floating
        // button to startTime=0 so the dict/media/maba/tasks buttons all pulse in sync.
        if (!window.PlonterPulse) {
            window.PlonterPulse = (function () {
                var FRAMES = [
                    { transform: 'translateY(-50%) scale(1)' },
                    { transform: 'translateY(-50%) scale(1.15)' },
                    { transform: 'translateY(-50%) scale(1)' }
                ];
                var OPTS = { duration: 2000, iterations: Infinity, easing: 'ease-in-out' };
                return {
                    start: function (el) {
                        if (!el) return;
                        try {
                            var a = el.__pulseAnim;
                            if (a && a.playState === 'running') return;
                            if (el.animate) {
                                if (a) { try { a.cancel(); } catch (e) {} }
                                a = el.animate(FRAMES, OPTS);
                                try { a.startTime = 0; } catch (e) {}
                                el.__pulseAnim = a;
                            } else {
                                el.style.animation = 'dict-pulse 2s ease-in-out infinite';
                            }
                        } catch (e) {
                            el.style.animation = 'dict-pulse 2s ease-in-out infinite';
                        }
                    },
                    stop: function (el) {
                        if (!el) return;
                        try { if (el.__pulseAnim) { el.__pulseAnim.cancel(); el.__pulseAnim = null; } } catch (e) {}
                        el.style.animation = 'none';
                    }
                };
            })();
        }
        var btn = document.getElementById('dict-toggle-btn');
        if (btn) return;
        btn = document.createElement('button');
        btn.id = 'dict-toggle-btn';
        btn.innerHTML = '📖';
        btn.title = 'מילון';
        btn.style.cssText = 'position:fixed;left:calc(2px + env(safe-area-inset-left, 0px));top:50%;transform:translateY(-50%);width:36px;height:48px;border:none;border-radius:0 8px 8px 0;background:#0d9488;color:white;font-size:1.2em;cursor:pointer;z-index:10002;box-shadow:2px 0 8px rgba(0,0,0,0.15);transition:left 0.3s ease;display:none';
        btn.onclick = () => {
            if (this._panel && this._panel.classList.contains('show')) {
                this._hidePanel();
            } else {
                this.openStandaloneOrLookup();
            }
        };
        document.body.appendChild(btn);
        window.PlonterPulse.start(btn);

        // Media button above the original — purple with music note
        // States: 🎵 (no media playing) → → (media playing) → ✕ (right panel open)
        var btn2 = document.createElement('button');
        btn2.id = 'dict-toggle-btn-2';
        btn2.innerHTML = '🎵';
        btn2.title = 'מדיה';
        btn2.style.cssText = 'position:fixed;left:calc(2px + env(safe-area-inset-left, 0px));top:calc(50% - 56px);transform:translateY(-50%);width:36px;height:48px;border:none;border-radius:0 8px 8px 0;background:#7c3aed;color:white;font-size:1.2em;cursor:pointer;z-index:10002;box-shadow:2px 0 8px rgba(124,58,237,0.3);transition:left 0.3s ease;display:none';
        btn2.onclick = () => {
            var dictOpen = this._panel && this._panel.classList.contains('show');
            var rightOpen = this._mediaRightPanel && this._mediaRightPanel.classList.contains('show');
            if (rightOpen) {
                // Close right media panel, switch left to media tab
                this._hideMediaRightPanel(true);
            } else if (dictOpen && this._activeEngine === 'media') {
                // Already on media tab — close dict
                this._hidePanel();
            } else if (dictOpen) {
                // Dict open but not on media — switch to media tab
                this._activeEngine = 'media';
                this._updateTabStyles();
                this._updateFooterVisibility();
                this._showMediaContent();
                this._togglePresentationVideo(false);
            } else {
                // Dict closed — open dict + switch to media tab
                this.openStandalone();
                setTimeout(() => {
                    this._activeEngine = 'media';
                    this._updateTabStyles();
                    this._updateFooterVisibility();
                    this._showMediaContent();
                    this._togglePresentationVideo(false);
                }, 100);
            }
        };
        document.body.appendChild(btn2);
        window.PlonterPulse.start(btn2);

        // Watch for media player creation/removal to update btn2 icon
        var _mediaObserver = new MutationObserver(function() {
            Dictionary._updateToggleButton();
        });
        _mediaObserver.observe(document.body, { childList: true });
        this._updateToggleButton();
    },

    _isLoginScreenVisible() {
        var authContainer = document.getElementById('auth-container');
        if (!authContainer) return false;
        var display = authContainer.style.display || (window.getComputedStyle ? window.getComputedStyle(authContainer).display : '');
        if (display === 'none') return false;
        var hasLoginBox = !!authContainer.querySelector('.auth-box');
        if (!hasLoginBox) return false;
        var welcome = document.getElementById('welcome-screen');
        var game = document.getElementById('game-screen');
        var welcomeDisplay = welcome ? (welcome.style.display || (window.getComputedStyle ? window.getComputedStyle(welcome).display : '')) : 'none';
        var gameDisplay = game ? (game.style.display || (window.getComputedStyle ? window.getComputedStyle(game).display : '')) : 'none';
        return welcomeDisplay === 'none' && gameDisplay === 'none';
    },

    _updateToggleButton() {
        var btn = document.getElementById('dict-toggle-btn');
        var btn2 = document.getElementById('dict-toggle-btn-2');
        if (!btn) return;
        if (this._isLoginScreenVisible()) {
            btn.style.display = 'none';
            if (btn2) btn2.style.display = 'none';
            return;
        }
        var isOpen = this._panel && this._panel.classList.contains('show');
        var rightOpen = this._mediaRightPanel && this._mediaRightPanel.classList.contains('show');
        btn.innerHTML = isOpen ? '←' : '📖';
        if (isOpen) window.PlonterPulse.stop(btn); else window.PlonterPulse.start(btn);
        // Move button to panel edge when open (panel is 320px wide)
        // On mobile (<= 600px), panel is 100% width — stick buttons to left edge
        // When dict panel covers most/all of the screen (≤768px), show a red X close
        // button inside the panel and hide the pulsing floating buttons so they don't overlap.
        var isNarrow = window.innerWidth <= 768;
        var mobileClose = document.getElementById('dict-mobile-close');
        if (mobileClose) mobileClose.style.display = (isNarrow && isOpen) ? 'block' : 'none';
        // Hide the pulsing 📖 button when dict is open on a narrow viewport — the red X is enough
        var closedLeft = 'calc(2px + env(safe-area-inset-left, 0px))';
        var openLeft = 'calc(320px + env(safe-area-inset-left, 0px))';
        btn.style.display = (isNarrow && isOpen) ? 'none' : '';
        btn.style.left = (isNarrow && isOpen) ? closedLeft : (isOpen ? openLeft : closedLeft);
        if (btn2) {
            var _isVocabPage = /vocab/.test(location.pathname);
            if (_isVocabPage || (isNarrow && isOpen)) {
                btn2.style.display = 'none';
            } else {
                btn2.style.display = '';
                btn2.style.left = isOpen ? openLeft : closedLeft;
                if (isOpen) window.PlonterPulse.stop(btn2); else window.PlonterPulse.start(btn2);
            }
            var mediaPlaying = !!document.getElementById('media-floating-player') ||
                               !!document.getElementById('media-audio-inline') ||
                               !!document.getElementById('media-player-overlay');
            if (rightOpen) {
                btn2.innerHTML = '✕';
                btn2.style.background = '#ef4444';
                btn2.style.boxShadow = '2px 0 8px rgba(239,68,68,0.3)';
            } else if (mediaPlaying) {
                btn2.innerHTML = '→';
                btn2.style.background = '#7c3aed';
                btn2.style.boxShadow = '2px 0 8px rgba(124,58,237,0.3)';
            } else {
                btn2.innerHTML = '🎵';
                btn2.style.background = '#7c3aed';
                btn2.style.boxShadow = '2px 0 8px rgba(124,58,237,0.3)';
            }
        }
    },

    _isHebrew(text) {
        return /[\u0590-\u05FF]/.test(text);
    },

    _isArabic(text) {
        return /[\u0600-\u06FF]/.test(text);
    },

    // Detect short-vowel of binyan-1 future-tense badge.
    // Returns 'U' for damma, 'A' for fatha, 'I' for kasra \u2014 only when the
    // input has exactly ONE of the three vowel marks (single placeholder like
    // "\u0640\u064F\u0640"). Multi-vowel strings (full verb forms) return null to avoid
    // mislabeling \u2014 the prefix \u064A\u064E would always score as 'A' and dwarf the
    // middle radical.
    _verbVowelLatin(verbStr) {
        if (!verbStr) return null;
        var hasDamma = verbStr.indexOf('\u064F') !== -1;
        var hasFatha = verbStr.indexOf('\u064E') !== -1;
        var hasKasra = verbStr.indexOf('\u0650') !== -1;
        var n = (hasDamma ? 1 : 0) + (hasFatha ? 1 : 0) + (hasKasra ? 1 : 0);
        if (n !== 1) return null;
        return hasDamma ? 'U' : hasFatha ? 'A' : 'I';
    },

    // Public API — render an array of Milson entries into a container.
    // Shared by the main-site Dictionary panel AND vocab.html's embedded panel
    // so both surfaces render identically. opts (all optional):
    //   autoExpand:   boolean | 'first' (default 'first') — which entries open
    //   includePin:   boolean (default true) — show the 📌 header button
    //   onPin:        function(entry, pinBtn) — override default VocabBar.pin
    //   onMeaningClick: function(text, li) — override default VocabBar.appendMeaning
    renderMilsonEntries(container, entries, opts) {
        const o = opts || {};
        (entries || []).forEach((entry, i) => {
            const entryOpts = Object.assign({}, o, {
                autoExpand: o.autoExpand === true ? true :
                            o.autoExpand === false ? false :
                            (i === 0)  // 'first' / undefined → first-only
            });
            this._renderEntry(container, entry, entryOpts);
        });
    },

    _renderEntry(container, entry, opts) {
        const o = opts || {};
        const autoExpand = !!o.autoExpand;
        const includePin = o.includePin !== false;
        const defaultPin = (e, pinBtn) => {
            const showOk = (title) => {
                pinBtn.style.opacity = '1';
                pinBtn.textContent = '✓';
                if (title) pinBtn.title = title;
                setTimeout(() => {
                    pinBtn.textContent = '📌';
                    pinBtn.style.opacity = '0.6';
                    pinBtn.title = 'הוסף לאוצר מילים';
                }, 1500);
            };
            // Inside a lesson presentation the vocab bar exists → keep the old behavior
            // (add the word to the presenter's vocab bar so the teacher fills meanings live).
            const vocabBar = document.getElementById('lp-vocab-bar');
            if (vocabBar && typeof VocabBar !== 'undefined') {
                VocabBar.pin(e.value, '');
                showOk();
                return;
            }
            // Outside the presentation there is no vocab bar — do "the simple thing":
            // copy a compact dictionary line to the clipboard, e.g.
            //   صَعِيدٌ (ج) صُعُدٌ - מישור; רמה, דרגה
            // singular, then plural after (ج), then the meanings: DISTINCT semantic
            // senses separated by "; " and synonyms within a sense by ", " (each
            // entry.meanings element = one sense). Falls back to a flat list for
            // old/flat data with a single sense.
            let line = e.value || '';
            const plural = e.additional && e.additional['רבים'];
            if (plural && plural.length) line += ' (ج) ' + plural.join(', ');
            const meanings = (e.meanings || []).map(m => m.text).filter(Boolean);
            if (meanings.length) line += ' - ' + meanings.join('; ');
            const finish = () => showOk('הועתק: ' + line);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(line).then(finish, finish);
            } else {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = line;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                } catch (err) { /* clipboard unavailable — still flash ✓ */ }
                finish();
            }
        };
        const defaultMeaningClick = (text, li) => {
            // Copy the meaning text to clipboard with soft visual feedback
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(function() {});
            } else {
                try {
                    const _ta = document.createElement('textarea');
                    _ta.value = text;
                    _ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
                    document.body.appendChild(_ta);
                    _ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(_ta);
                } catch (e) {}
            }
            // Brief green flash on the meaning item
            if (li) {
                li.style.background = '#d1fae5';
                setTimeout(function() { li.style.background = ''; }, 600);
            }
            // VocabBar integration (preserved)
            if (typeof VocabBar !== 'undefined') VocabBar.appendMeaning(text);
        };
        const onPin = o.onPin || defaultPin;
        const onMeaningClick = o.onMeaningClick || defaultMeaningClick;

        const item = document.createElement('div');
        item.className = 'dict-entry';

        const header = document.createElement('div');
        header.className = 'dict-entry-header';
        let headerHtml = `<span class="dict-entry-word">${entry.value}</span>`;
        if (entry.root) headerHtml += ` <span class="dict-entry-root">[${entry.root}]</span>`;
        if (entry.gender) headerHtml += ` <span class="dict-gender-badge">${entry.gender}</span>`;
        if (entry.verb) {
            const _uia = Dictionary._verbVowelLatin(entry.verb);
            const _uiaSpan = _uia ? ` <span class="dict-verb-uia">(${_uia})</span>` : '';
            headerHtml += ` <span class="dict-verb-badge">${entry.verb}</span>${_uiaSpan}`;
        }
        // Valency / government pattern (הצרכה) shown in the always-visible header so
        // distinct patterns are readable at a glance without expanding each card
        // (Amitai 2026-06-17). Each prep IS one complete pattern — its slots stay
        // together (space-joined, e.g. "ه ه"); multiple DISTINCT patterns on the same
        // card are separated by a comma "، ". (Each valency is usually its own entry.)
        const _valPreps = [];
        (entry.meanings || []).forEach(m => {
            const p = (m && m.prep != null) ? String(m.prep).trim() : '';
            if (p && _valPreps.indexOf(p) === -1) _valPreps.push(p);
        });
        if (_valPreps.length) {
            headerHtml += ` <span class="dict-valency" style="color:#0d9488;font-weight:bold;font-size:0.92em;margin-right:4px;direction:rtl;unicode-bidi:isolate">${_valPreps.join('، ')}</span>`;
        }
        if (entry.additional) {
            const plural = entry.additional['רבים'];
            const fem = entry.additional['נקבה'];
            if (plural) headerHtml += ` <span class="dict-form-badge">ר: ${plural.join(', ')}</span>`;
            if (fem) headerHtml += ` <span class="dict-form-badge">נ: ${fem.join(', ')}</span>`;
        }
        if (includePin) {
            headerHtml += ' <span class="dict-pin-btn" style="cursor:pointer;font-size:0.8em;margin-right:4px;opacity:0.6" title="הוסף לאוצר מילים">📌</span>';
        }
        header.innerHTML = headerHtml;

        const pinBtn = header.querySelector('.dict-pin-btn');
        if (pinBtn) {
            pinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                onPin(entry, pinBtn);
            });
        }

        const body = document.createElement('div');
        body.className = 'dict-entry-body';
        body.style.display = 'none';

        const wireMeaningLi = (li, text) => {
            li.style.cursor = 'pointer';
            li.addEventListener('click', () => onMeaningClick(text, li));
            li.addEventListener('mouseenter', () => { li.style.background = '#f0fdfa'; });
            li.addEventListener('mouseleave', () => { li.style.background = ''; });
        };

        if (entry.meanings && entry.meanings.length > 0) {
            const groups = new Map();
            entry.meanings.forEach(m => {
                const key = m.prep || '';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(m.text);
            });

            if (groups.size === 1 && groups.has('')) {
                const list = document.createElement('ol');
                list.className = 'dict-meanings';
                groups.get('').forEach(text => {
                    const li = document.createElement('li');
                    li.textContent = text;
                    wireMeaningLi(li, text);
                    list.appendChild(li);
                });
                body.appendChild(list);
            } else {
                let firstGroup = true;
                groups.forEach((texts, prep) => {
                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'dict-prep-group';
                    const prepHeader = document.createElement('div');
                    prepHeader.className = 'dict-prep-header';
                    prepHeader.textContent = prep ? `${entry.value} ${prep}` : entry.value;
                    prepHeader.style.cursor = 'pointer';
                    groupDiv.appendChild(prepHeader);
                    const list = document.createElement('ol');
                    list.className = 'dict-meanings';
                    if (!firstGroup) list.style.display = 'none';
                    texts.forEach(text => {
                        const li = document.createElement('li');
                        li.textContent = text;
                        wireMeaningLi(li, text);
                        list.appendChild(li);
                    });
                    prepHeader.addEventListener('click', () => {
                        const visible = list.style.display !== 'none';
                        list.style.display = visible ? 'none' : 'block';
                        prepHeader.classList.toggle('collapsed', visible);
                    });
                    if (!firstGroup) prepHeader.classList.add('collapsed');
                    groupDiv.appendChild(list);
                    body.appendChild(groupDiv);
                    firstGroup = false;
                });
            }
        } else {
            body.innerHTML = '<div class="dict-no-meanings">אין פירושים</div>';
        }

        if (entry.additional) {
            const shownKeys = ['רבים', 'נקבה'];
            const extraForms = Object.entries(entry.additional).filter(([k]) => !shownKeys.includes(k));
            if (extraForms.length > 0) {
                const formsDiv = document.createElement('div');
                formsDiv.className = 'dict-extra-forms';
                extraForms.forEach(([category, values]) => {
                    formsDiv.innerHTML += `<span class="dict-form-label">${category}:</span> ${values.join(', ')} `;
                });
                body.appendChild(formsDiv);
            }
        }

        header.onclick = () => {
            const visible = body.style.display !== 'none';
            body.style.display = visible ? 'none' : 'block';
            header.classList.toggle('open', !visible);
        };

        if (autoExpand) {
            body.style.display = 'block';
            header.classList.add('open');
        }

        item.appendChild(header);
        item.appendChild(body);
        container.appendChild(item);
    },

    _milsonSearchUrl(word, mode) {
        var creds = this._getMilsonCredentials();
        if (!creds) return null;
        return this._proxyUrl + '?q=' + encodeURIComponent(word) + '&mode=' + mode + '&email=' + encodeURIComponent(creds.email) + '&pass=' + encodeURIComponent(creds.password);
    },

    _hujiFreeSearchUrl(word, mode) {
        const base = (location.protocol === 'file:')
            ? 'https://iseemath.co/plonter/api/huji_free_dictionary_proxy.php'
            : this._hujiFreeProxyUrl;
        return base + '?q=' + encodeURIComponent(word) + '&mode=' + encodeURIComponent(mode);
    },

    // ── AI Likes helpers ──────────────────────────────────────────────────────

    _aiLikedSet() {
        try { return new Set(JSON.parse(localStorage.getItem('dict_ai_liked') || '[]')); } catch (_) { return new Set(); }
    },

    _aiLikedSetSave(s) {
        try { localStorage.setItem('dict_ai_liked', JSON.stringify(Array.from(s))); } catch (_) {}
    },

    // Creates a 👍 like button for an AI-cache entry or meaning.
    // term/stage/meaningKey identify the row; count is the current aggregate.
    _aiLikeBtn(term, stage, meaningKey, count) {
        var likedSet = this._aiLikedSet();
        var id = term + '|' + stage + '|' + meaningKey;
        var liked = likedSet.has(id);
        var btn = document.createElement('button');
        btn.className = 'dict-ai-like-btn';
        var baseStyle = 'background:none;border:1px solid;border-radius:12px;padding:1px 7px;font-size:0.75em;cursor:pointer;margin-right:4px;vertical-align:middle;transition:color 0.15s,border-color 0.15s;font-family:inherit;line-height:1.5';
        btn.style.cssText = baseStyle + ';border-color:' + (liked ? '#8b5cf6' : '#d1d5db') + ';color:' + (liked ? '#8b5cf6' : '#9ca3af');
        btn.textContent = '👍 ' + (count || 0);
        var _self = this;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var ls = _self._aiLikedSet();
            var nowLiked = ls.has(id);
            var delta = nowLiked ? -1 : 1;
            if (nowLiked) ls.delete(id); else ls.add(id);
            _self._aiLikedSetSave(ls);
            // Optimistic update
            var cur = parseInt((btn.textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
            var next = Math.max(0, cur + delta);
            btn.textContent = '👍 ' + next;
            var col = delta > 0 ? '#8b5cf6' : '#9ca3af';
            btn.style.borderColor = delta > 0 ? '#8b5cf6' : '#d1d5db';
            btn.style.color = col;
            // Persist to server (action in URL so PHP $_GET['action'] routing works)
            fetch(_self._aiCacheUrl + '?action=like', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'like', term: term, stage: stage, meaning_key: meaningKey, delta: delta })
            }).then(function(r) { return r.json(); }).then(function(d) {
                if (d && d.likes != null) btn.textContent = '👍 ' + d.likes;
            }).catch(function() {});
        });
        return btn;
    },

    // Decorate a single .dict-entry element produced by renderMilsonEntries with AI like buttons.
    // Sorts are already applied before render; this only adds buttons + auto-expands the body.
    // opts.noExpand=true — skip auto-expand (used for related/same-root entries shown collapsed).
    _aiDecorateEntryWithLikes(entryEl, term, stage, likes, opts) {
        var lo = likes || { entry: 0, meanings: {} };
        var meaningsMap = lo.meanings || {};
        var _opts = opts || {};

        // Auto-expand the entry body so likes are immediately visible (skip for related entries)
        if (!_opts.noExpand) {
            var body = entryEl.querySelector('.dict-entry-body');
            if (body && body.style.display === 'none') {
                body.style.display = 'block';
                var hdr = entryEl.querySelector('.dict-entry-header');
                if (hdr) hdr.classList.add('open');
            }
        }

        // Entry-level like button (appended to header)
        var header = entryEl.querySelector('.dict-entry-header');
        if (header && !header.querySelector('.dict-ai-like-btn')) {
            var eBtn = this._aiLikeBtn(term, stage, '', lo.entry || 0);
            eBtn.style.cssText += ';margin-right:0;margin-left:4px;float:left';
            header.appendChild(eBtn);
        }

        // Per-meaning like buttons — one per <li> in .dict-meanings
        var lis = entryEl.querySelectorAll('.dict-meanings li');
        var _self = this;
        lis.forEach(function(li) {
            if (li.querySelector('.dict-ai-like-btn')) return; // already decorated
            var text = (li.textContent || '').trim();
            var mBtn = _self._aiLikeBtn(term, stage, text, meaningsMap[text] || 0);
            // Wrap existing text in a span to keep it separate from the button
            var span = document.createElement('span');
            span.textContent = li.textContent;
            li.textContent = '';
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.style.justifyContent = 'space-between';
            li.appendChild(span);
            li.appendChild(mBtn);
        });
    },

    // Sort meanings in a milson-format entry object by likes DESC.
    // mutates me.meanings in place (pass a copy if original order is needed).
    _aiSortMeaningsByLikes(me, meaningsMap) {
        if (!meaningsMap || !me || !Array.isArray(me.meanings) || me.meanings.length < 2) return;
        me.meanings.sort(function(a, b) {
            var ak = ((a && a.text) || '').trim();
            var bk = ((b && b.text) || '').trim();
            return (meaningsMap[bk] || 0) - (meaningsMap[ak] || 0);
        });
    },

    // ── End AI Likes helpers ──────────────────────────────────────────────────

    // Appends an AI-cache block below Milson results.
    // Fetches primary + expand caches in parallel and renders both immediately if available.
    // Cache miss shows a one-click "חפש ב-AI" button.
    async _appendAIBlockForRegularSearch(container, cleanWord) {
        if (this._activeEngine !== 'milson') return;
        var existing = container.querySelector('#dict-milson-ai-block');
        if (existing) existing.remove();
        var block = document.createElement('div');
        block.id = 'dict-milson-ai-block';
        block.style.cssText = 'margin-top:16px;padding-top:12px;border-top:2px dashed #e5e7eb';
        container.appendChild(block);
        var _self = this;
        try {
            // Fetch primary and expand caches in parallel — render both immediately if found
            var _fetched = await Promise.all([
                fetch(this._aiCacheUrl + '?action=lookup&term=' + encodeURIComponent(cleanWord) + '&stage=primary').then(function(r) { return r.json(); }).catch(function() { return null; }),
                fetch(this._aiCacheUrl + '?action=lookup&term=' + encodeURIComponent(cleanWord) + '&stage=expand').then(function(r) { return r.json(); }).catch(function() { return null; })
            ]);
            var cd = _fetched[0], exd = _fetched[1];
            if (cd && cd.found) {
                var ce = cd.result;
                var cp = ce.primary;
                if (!cp && Array.isArray(ce.pos_entries) && ce.pos_entries.length) cp = ce.pos_entries[0];
                if (!cp && ce.meanings) cp = { pos: '', form: ce.value || cleanWord, meanings: ce.meanings.map(function(m) { return typeof m === 'string' ? m : (m && m.text) || ''; }), example: ce.example };
                if (cp) {
                    var _likes = cd.likes || { entry: 0, meanings: {} };
                    var lbl = document.createElement('div');
                    lbl.className = 'dict-empty';
                    lbl.style.fontSize = '0.85em';
                    lbl.innerHTML = '📚 מהמאגר (AI) עבור "' + (ce.value || cleanWord) + '"';
                    block.appendChild(lbl);
                    var cpMe = this._dictAIEntryToMilson(cp, ce.value || cleanWord, ce.root || '');
                    this._aiSortMeaningsByLikes(cpMe, _likes.meanings);
                    this.renderMilsonEntries(block, [cpMe]);
                    var _newEntry = block.querySelector('.dict-entry:last-of-type') || block.querySelector('.dict-entry');
                    if (_newEntry) this._aiDecorateEntryWithLikes(_newEntry, cleanWord, 'primary', _likes);
                    if (exd && exd.found) {
                        // Expand cache exists — render same-root results immediately, no button needed
                        var _expLikes = exd.likes || { entry: 0, meanings: {} };
                        var _exc = exd.result;
                        var _rootStr = _exc.root || ce.root || '';
                        var _otherPos = Array.isArray(_exc.other_pos_entries) ? _exc.other_pos_entries : [];
                        var _milson = _otherPos.map(function(pe) {
                            var me = _self._dictAIEntryToMilson(pe, cleanWord, _rootStr);
                            _self._aiSortMeaningsByLikes(me, _expLikes.meanings);
                            return me;
                        });
                        if (_milson.length) {
                            var _beforeExp = block.querySelectorAll('.dict-entry').length;
                            this.renderMilsonEntries(block, _milson);
                            var _allExp = block.querySelectorAll('.dict-entry');
                            for (var _ei = _beforeExp; _ei < _allExp.length; _ei++) {
                                this._aiDecorateEntryWithLikes(_allExp[_ei], cleanWord, 'expand', _expLikes);
                            }
                        }
                        var _related = Array.isArray(_exc.related) ? _exc.related.filter(function(r) { return r && r.ar; }) : [];
                        if (_related.length) {
                            var _relDiv = document.createElement('div');
                            _relDiv.className = 'dict-root-divider';
                            _relDiv.style.cursor = 'pointer';
                            _relDiv.innerHTML = '<span>מאותו שורש' + (_rootStr ? ': ' + _rootStr : '') + (_exc.rootMeaning ? ' — ' + _exc.rootMeaning : '') + '</span>';
                            var _relSec = document.createElement('div');
                            _relSec.className = 'dict-root-section';
                            var _relVisible = true;
                            _relDiv.addEventListener('click', function() {
                                _relVisible = !_relVisible;
                                _relSec.style.display = _relVisible ? 'block' : 'none';
                                _relDiv.classList.toggle('collapsed', !_relVisible);
                            });
                            block.appendChild(_relDiv);
                            block.appendChild(_relSec);
                            this.renderMilsonEntries(_relSec, _related.map(function(r) { return { value: r.ar, meanings: r.he ? [{ text: r.he }] : [] }; }), { autoExpand: false });
                            // Add like buttons to related entries (no auto-expand) + seed cache for future searches
                            var _relElsReg = _relSec.querySelectorAll('.dict-entry');
                            _related.forEach(function(r, _ri) {
                                var _relClean = (r.ar || '').replace(/[ً-ٰٟ]/g, '');
                                if (_relElsReg[_ri]) _self._aiDecorateEntryWithLikes(_relElsReg[_ri], _relClean, 'primary', { entry: 0, meanings: {} }, { noExpand: true });
                                if (_relClean) {
                                    var _mini = { value: r.ar, root: _rootStr || null, primary: { pos: '', form: r.ar, meanings: r.he ? [r.he] : [], example: null } };
                                    fetch(_self._aiCacheUrl + '?action=save_related', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term: _relClean, result_json: JSON.stringify(_mini) }) }).catch(function() {});
                                }
                            });
                        }
                        if (!_milson.length && !_related.length) {
                            var _noMore = document.createElement('div');
                            _noMore.className = 'dict-empty';
                            _noMore.textContent = 'אין עוד ערכים';
                            block.appendChild(_noMore);
                        }
                    } else {
                        // Expand cache not yet populated — show on-demand button
                        var expBtn = document.createElement('button');
                        expBtn.id = 'dict-ai-expand-btn';
                        expBtn.textContent = '🔎 חפש עוד ערכים מאותו שורש';
                        expBtn.style.cssText = 'display:block;margin:14px auto;padding:10px 22px;background:#8b5cf6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:0.95em;font-family:inherit;font-weight:600;box-shadow:0 2px 6px rgba(139,92,246,0.25)';
                        var fM = Array.isArray(cp.meanings) ? (cp.meanings[0] || '') : '';
                        expBtn.onclick = function() { _self._searchAIExpand(cleanWord, ce.root || '', cp.pos || '', fM, block, expBtn); };
                        block.appendChild(expBtn);
                    }
                    return;
                }
            }
        } catch (_) {} // cache miss or error — show miss notice + add-to-AI button
        var missLbl = document.createElement('div');
        missLbl.className = 'dict-empty';
        missLbl.style.cssText = 'font-size:0.9em;text-align:center;color:#6b7280;margin-bottom:4px';
        missLbl.textContent = 'לצערנו אין לנו את זה במאגר';
        block.appendChild(missLbl);
        var addBtn = document.createElement('button');
        addBtn.textContent = '🔍 חפש ב-AI והוסף למאגר';
        addBtn.style.cssText = 'display:block;margin:14px auto;padding:10px 22px;background:#8b5cf6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:0.95em;font-family:inherit;font-weight:600;box-shadow:0 2px 6px rgba(139,92,246,0.25)';
        addBtn.onclick = function() {
            var aiTab = _self._panel.querySelector('.dict-tab[data-engine="ai"]');
            if (aiTab) {
                _self._activeEngine = 'ai';
                _self._updateTabStyles();
                _self._updateFooterVisibility();
                localStorage.setItem('dict_engine', 'ai');
            }
            var inp = _self._panel.querySelector('#dict-search-input');
            if (inp) inp.value = cleanWord;
            _self._searchAI(cleanWord);
        };
        block.appendChild(addBtn);
    },

    async _search(word) {
        const results = this._panel.querySelector('#dict-results');
        const primaryMode = this._searchMode; // 1=by word, 0=by root
        const cleanWord = word.replace(/[ً-ٰٟ]/g, ''); // cache key must match _searchAI
        this._panel.querySelector('#dict-milson-link').href =
            'https://arabdictionary.huji.ac.il/ArabDictionaryV2#/Search/' + encodeURIComponent(word) + (primaryMode === 0 ? '/0' : '');

        var searchUrl = this._milsonSearchUrl(word, primaryMode);
        if (!searchUrl) {
            var isDragon = (typeof PlonterAdmin !== 'undefined' && PlonterAdmin.isDragon && PlonterAdmin.isDragon());
            if (isDragon) {
                await this._searchHujiFree(word, primaryMode, results);
                return;
            }
            results.innerHTML = '<div style="text-align:center;padding:24px;color:#6b7280"><p style="font-size:1.1em;margin-bottom:12px">נדרשים פרטי התחברות למילסון</p><button id="dict-enter-creds-btn" style="padding:8px 20px;border:none;border-radius:8px;background:#0d9488;color:white;cursor:pointer;font-weight:bold;font-size:1em">הזן פרטים</button></div>';
            results.querySelector('#dict-enter-creds-btn').onclick = () => this._showMilsonCredentialsPopup();
            this._appendAIBlockForRegularSearch(results, cleanWord);
            return;
        }

        try {
            const resp = await fetch(searchUrl);
            const data = await resp.json();

            if (data.error) {
                results.innerHTML = `<div class="dict-error">שגיאה: ${data.error}</div>`;
                return;
            }

            results.innerHTML = '';

            if (!data.entries || data.entries.length === 0) {
                // ه→ة fallback
                if (word.endsWith('\u0647')) {
                    const altWord = word.slice(0, -1) + '\u0629';
                    const altResp = await fetch(this._milsonSearchUrl(altWord, primaryMode));
                    const altData = await altResp.json();
                    if (altData.entries && altData.entries.length > 0) {
                        results.innerHTML = '';
                        const note = document.createElement('div');
                        note.className = 'dict-empty';
                        note.style.fontSize = '0.85em';
                        note.textContent = `חיפוש "${word}" → "${altWord}" (ة)`;
                        results.appendChild(note);
                        this.renderMilsonEntries(results, altData.entries);
                        this._panel.querySelector('#dict-milson-link').href =
                            'https://arabdictionary.huji.ac.il/ArabDictionaryV2#/Search/' + encodeURIComponent(altWord);
                        this._appendAIBlockForRegularSearch(results, cleanWord);
                        return;
                    }
                }
                // ال fallback — strip all alef variants (ا أ إ آ ٱ) + lam
                if (/^[\u0627\u0671\u0623\u0625\u0622]\u0644/.test(word)) {
                    const noAl = word.replace(/^[\u0627\u0671\u0623\u0625\u0622]\u0644/, '');
                    if (noAl.length > 0) {
                        const alResp = await fetch(this._milsonSearchUrl(noAl, primaryMode));
                        const alData = await alResp.json();
                        if (alData.entries && alData.entries.length > 0) {
                            results.innerHTML = '';
                            const note = document.createElement('div');
                            note.className = 'dict-empty';
                            note.style.fontSize = '0.85em';
                            note.textContent = `חיפוש "${word}" → "${noAl}" (בלי ال)`;
                            results.appendChild(note);
                            this.renderMilsonEntries(results, alData.entries);
                            this._panel.querySelector('#dict-milson-link').href =
                                'https://arabdictionary.huji.ac.il/ArabDictionaryV2#/Search/' + encodeURIComponent(noAl);
                            this._appendAIBlockForRegularSearch(results, cleanWord);
                            return;
                        }
                    }
                }
                results.innerHTML = `<div class="dict-empty">אין תוצאות עבור "${word}"</div>`;
                // Auto-try the other search mode (root↔word) as fallback
                if (primaryMode === 1) {
                    // Was searching by word — try root
                    const rootRetry = document.createElement('div');
                    rootRetry.className = 'dict-root-section';
                    rootRetry.innerHTML = '<div class="dict-loading">מחפש לפי שורש...</div>';
                    results.appendChild(rootRetry);
                    try {
                        const rootResp = await fetch(this._milsonSearchUrl(word, 0));
                        const rootData = await rootResp.json();
                        rootRetry.innerHTML = '';
                        if (rootData.entries && rootData.entries.length > 0) {
                            const divider = document.createElement('div');
                            divider.className = 'dict-root-divider';
                            divider.innerHTML = `<span>תוצאות לפי שורש: ${word}</span>`;
                            rootRetry.appendChild(divider);
                            this.renderMilsonEntries(rootRetry, rootData.entries);
                            this._panel.querySelector('#dict-milson-link').href =
                                'https://arabdictionary.huji.ac.il/ArabDictionaryV2#/Search/' + encodeURIComponent(word) + '/0';
                        } else {
                            rootRetry.innerHTML = '<div class="dict-empty" style="font-size:0.85em">אין תוצאות גם לפי שורש</div>';
                        }
                    } catch (e) {
                        rootRetry.innerHTML = '';
                    }
                } else {
                    // Was searching by root — try word
                    const wordRetry = document.createElement('div');
                    wordRetry.className = 'dict-root-section';
                    wordRetry.innerHTML = '<div class="dict-loading">מחפש לפי ערך...</div>';
                    results.appendChild(wordRetry);
                    try {
                        const wordResp = await fetch(this._milsonSearchUrl(word, 1));
                        const wordData = await wordResp.json();
                        wordRetry.innerHTML = '';
                        if (wordData.entries && wordData.entries.length > 0) {
                            const divider = document.createElement('div');
                            divider.className = 'dict-root-divider';
                            divider.innerHTML = `<span>תוצאות לפי ערך: ${word}</span>`;
                            wordRetry.appendChild(divider);
                            this.renderMilsonEntries(wordRetry, wordData.entries);
                            this._panel.querySelector('#dict-milson-link').href =
                                'https://arabdictionary.huji.ac.il/ArabDictionaryV2#/Search/' + encodeURIComponent(word);
                        } else {
                            wordRetry.innerHTML = '<div class="dict-empty" style="font-size:0.85em">אין תוצאות גם לפי ערך</div>';
                        }
                    } catch (e) {
                        wordRetry.innerHTML = '';
                    }
                }
                this._appendAIBlockForRegularSearch(results, cleanWord);
                return;
            }

            // Render word entries
            this.renderMilsonEntries(results, data.entries);

            // Auto-search by root from first entry
            const root = data.entries[0].root;
            if (root) {
                const divider = document.createElement('div');
                divider.className = 'dict-root-divider';
                divider.innerHTML = `<span>לפי שורש: ${root}</span>`;
                const rootSection = document.createElement('div');
                rootSection.className = 'dict-root-section';
                rootSection.innerHTML = '<div class="dict-loading">טוען תוצאות שורש...</div>';
                divider.style.cursor = 'pointer';
                let rootVisible = true;
                divider.addEventListener('click', () => {
                    rootVisible = !rootVisible;
                    rootSection.style.display = rootVisible ? 'block' : 'none';
                    divider.classList.toggle('collapsed', !rootVisible);
                });
                results.appendChild(divider);
                results.appendChild(rootSection);

                try {
                    const rootResp = await fetch(this._milsonSearchUrl(root, 0));
                    const rootData = await rootResp.json();
                    rootSection.innerHTML = '';
                    if (rootData.entries && rootData.entries.length > 0) {
                        const shownValues = new Set(data.entries.map(e => e.value));
                        const newEntries = rootData.entries.filter(e => !shownValues.has(e.value));
                        if (newEntries.length > 0) {
                            this.renderMilsonEntries(rootSection, newEntries, { autoExpand: false });
                        } else {
                            rootSection.innerHTML = '<div class="dict-empty" style="font-size:0.85em">אין ערכים נוספים בשורש זה</div>';
                        }
                    } else {
                        rootSection.innerHTML = '<div class="dict-empty" style="font-size:0.85em">אין תוצאות לפי שורש</div>';
                    }
                } catch (e) {
                    rootSection.innerHTML = '<div class="dict-error">שגיאה בחיפוש שורש</div>';
                }
            }
            this._appendAIBlockForRegularSearch(results, cleanWord);
        } catch (err) {
            results.innerHTML = `<div class="dict-error">שגיאת רשת: ${err.message}</div>`;
        }
    },

    async _searchHujiFree(word, mode, results) {
        results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:16px">מחפש במילון החינמי של HUJI...</div>';
        try {
            const resp = await fetch(this._hujiFreeSearchUrl(word, mode));
            const data = await resp.json();
            results.innerHTML = '';
            if (!data.ok || data.error) {
                results.innerHTML = '<div class="dict-error">שגיאה בחיפוש במילון החינמי</div>';
                return;
            }
            if (!data.entries || data.entries.length === 0) {
                results.innerHTML = '<div class="dict-empty">לא נמצאו ערכים במילון החינמי</div>';
                return;
            }
            this.renderMilsonEntries(results, data.entries);
        } catch (err) {
            results.innerHTML = '<div class="dict-error">שגיאת רשת במילון החינמי</div>';
        }
    },

    _getMilsonCredentials() {
        try {
            var raw = localStorage.getItem('milson_credentials');
            if (!raw) return null;
            var creds = JSON.parse(raw);
            if (creds && creds.email && creds.password) return creds;
        } catch (e) {}
        return null;
    },

    _updateMilsonLockState(link) {
        var creds = this._getMilsonCredentials();
        if (creds) {
            link.textContent = 'פתח במילסון ←';
            link.style.opacity = '1';
        } else {
            link.textContent = '🔒 פתח במילסון ←';
            link.style.opacity = '0.6';
        }
    },

    _showMilsonCredentialsPopup() {
        var existing = document.getElementById('milson-creds-popup');
        if (existing) existing.remove();
        var existingBg = document.getElementById('milson-creds-backdrop');
        if (existingBg) existingBg.remove();

        var backdrop = document.createElement('div');
        backdrop.id = 'milson-creds-backdrop';
        backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:10010';

        var popup = document.createElement('div');
        popup.id = 'milson-creds-popup';
        popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;border-radius:16px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:10011;direction:rtl;text-align:center;min-width:300px;max-width:90vw';

        popup.innerHTML = '<h3 style="margin:0 0 16px;color:#1e293b">התחברות למילסון</h3>' +
            '<p style="font-size:0.85em;color:#6b7280;margin-bottom:12px">הזן את פרטי החשבון שלך באתר מילסון (מילון ערבי של האוניברסיטה העברית)</p>' +
            '<input id="milson-email" type="email" placeholder="אימייל" style="width:100%;padding:10px;font-size:1em;border:2px solid #e2e8f0;border-radius:8px;margin-bottom:8px;direction:ltr;text-align:left;box-sizing:border-box">' +
            '<div style="position:relative;margin-bottom:16px">' +
            '<input id="milson-pass" type="password" placeholder="סיסמה" style="width:100%;padding:10px 36px 10px 10px;font-size:1em;border:2px solid #e2e8f0;border-radius:8px;direction:ltr;text-align:left;box-sizing:border-box">' +
            '<button id="milson-pass-toggle" type="button" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.1em;color:#9ca3af;padding:2px">👁</button>' +
            '</div>' +
            '<div style="display:flex;gap:8px;justify-content:center">' +
            '<button id="milson-save-btn" style="padding:8px 24px;border:none;border-radius:8px;background:#0d9488;color:white;cursor:pointer;font-weight:bold;font-size:1em">התחבר</button>' +
            '<button id="milson-cancel-btn" style="padding:8px 24px;border:none;border-radius:8px;background:#e2e8f0;color:#64748b;cursor:pointer;font-size:1em">ביטול</button>' +
            '</div>' +
            '<div id="milson-error" style="display:none;color:#dc2626;margin-top:8px;font-size:0.85em"></div>';

        var self = this;
        backdrop.onclick = function() { backdrop.remove(); popup.remove(); };
        document.body.appendChild(backdrop);
        document.body.appendChild(popup);

        popup.querySelector('#milson-cancel-btn').onclick = function() { backdrop.remove(); popup.remove(); };
        popup.querySelector('#milson-pass-toggle').onclick = function() {
            var passInput = popup.querySelector('#milson-pass');
            var isHidden = passInput.type === 'password';
            passInput.type = isHidden ? 'text' : 'password';
            this.textContent = isHidden ? '🙈' : '👁';
        };
        popup.querySelector('#milson-save-btn').onclick = function() {
            var email = popup.querySelector('#milson-email').value.trim();
            var pass = popup.querySelector('#milson-pass').value.trim();
            var errorDiv = popup.querySelector('#milson-error');
            if (!email || !pass) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = 'יש למלא אימייל וסיסמה';
                return;
            }
            // Validate credentials via server-side proxy
            var saveBtn = popup.querySelector('#milson-save-btn');
            saveBtn.textContent = 'בודק...';
            saveBtn.disabled = true;
            var testUrl = self._proxyUrl + '?action=validate&email=' + encodeURIComponent(email) + '&pass=' + encodeURIComponent(pass);
            fetch(testUrl)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error || data.valid === false) {
                        errorDiv.style.display = 'block';
                        errorDiv.textContent = 'פרטי התחברות שגויים — בדוק אימייל וסיסמה';
                        saveBtn.textContent = 'התחבר';
                        saveBtn.disabled = false;
                        return;
                    }
                    // Credentials work — save them
                    localStorage.setItem('milson_credentials', JSON.stringify({ email: email, password: pass }));
                    var user = (typeof PlonterAuth !== 'undefined') ? PlonterAuth.getUser() : null;
                    if (user && user.token) {
                        fetch('https://www.yisumatica.org.il/plonter6/api/auth.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + user.token },
                            body: JSON.stringify({ action: 'save_milson', milson_email: email, milson_password: pass })
                        }).catch(function() {});
                    }
                    var link = self._panel ? self._panel.querySelector('#dict-milson-link') : null;
                    if (link) self._updateMilsonLockState(link);
                    backdrop.remove();
                    popup.remove();
                    if (self._activeEngine === 'milson') self._showEngineHint();
                })
                .catch(function() {
                    errorDiv.style.display = 'block';
                    errorDiv.textContent = 'שגיאת רשת — נסה שוב';
                    saveBtn.textContent = 'התחבר';
                    saveBtn.disabled = false;
                });
        };

        setTimeout(function() { popup.querySelector('#milson-email').focus(); }, 50);
    },

    _fetchMilsonCredsFromServer() {
        var self = this;
        var results = this._panel ? this._panel.querySelector('#dict-results') : null;
        if (results) results.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280">בודק פרטי מילסון...</div>';

        var user = (typeof PlonterAuth !== 'undefined') ? PlonterAuth.getUser() : null;
        if (!user || !user.token) {
            if (results) results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">הקלד מילה בערבית וחפש</div>';
            return;
        }

        fetch('https://www.yisumatica.org.il/plonter6/api/auth.php?action=get_milson', {
            headers: { 'Authorization': 'Bearer ' + user.token }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.milson_email && data.milson_password) {
                localStorage.setItem('milson_credentials', JSON.stringify({ email: data.milson_email, password: data.milson_password }));
                var link = self._panel ? self._panel.querySelector('#dict-milson-link') : null;
                if (link) self._updateMilsonLockState(link);
                if (results) results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">הקלד מילה בערבית וחפש</div>';
            } else {
                // No creds on server — show enter credentials form
                if (results) {
                    results.innerHTML = '<div style="text-align:center;color:#6b7280;padding:24px"><p style="margin-bottom:12px">נדרשים פרטי התחברות למילסון</p><button id="dict-enter-milson-btn" style="padding:8px 20px;border:none;border-radius:8px;background:#0d9488;color:white;cursor:pointer;font-weight:bold">הזן פרטים</button></div>';
                    var btn = results.querySelector('#dict-enter-milson-btn');
                    if (btn) btn.onclick = function() { self._showMilsonCredentialsPopup(); };
                }
            }
        })
        .catch(function() {
            if (results) results.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:24px">הקלד מילה בערבית וחפש</div>';
        });
    }
};

// Auto-init on load — show toggle button immediately
document.addEventListener('DOMContentLoaded', function() { Dictionary.init(); });
