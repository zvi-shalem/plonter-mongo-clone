// DiacriticsKeyboard — Arabic diacritics input (QWES layout)
// Toggle mode: Ctrl+M or toolbar button. Stays on until toggled off.
// Layout: Q W E row above, S below (diamond around cursor)
// Short press = primary diacritic, Long press = secondary (tanween / shadda)
// A = cursor left, D = cursor right
// Shadda is persistent ON/OFF: survives sukun, returns when diacritic changes

const DiacriticsKeyboard = {
    _active: false,
    _shaddaMemory: {},  // baseIdx -> true: per-letter shadda memory
    _lpTimer: null,
    _lpKey: null,
    _lpFired: false,
    _LP_MS: 400,
    _palette: null,
    _currentEl: null,
    _navHeld: false,  // true while A/D key is held down (defer palette redraw)
    _magActive: false, // magnifier toggle state (default off)

    // Unicode
    FATHA:    '\u064E', KASRA:    '\u0650', DAMMA:    '\u064F',
    SUKUN:    '\u0652', SHADDA:   '\u0651',
    FATHATAN: '\u064B', KASRATAN: '\u064D', DAMMATAN: '\u064C',

    DIAC_RE: /[\u064B-\u065F\u0670]/,
    ARABIC_BASE_RE: /[\u0600-\u064A\u066E-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
    ALEF_RE: /[اأإآٱ]/,

    // Short press / long press mappings
    KEY_SHORT: null,  // initialized in init
    KEY_LONG: null,

    // Physical key codes — numbers only (QWEASDX are visual buttons only, not keyboard shortcuts)
    CODE_MAP: {
        'Digit7': 'q', 'Digit8': 'w', 'Digit9': 'e',
        'Digit4': 'a', 'Digit5': 's', 'Digit6': 'd',
        'Digit2': 'x',
        'Numpad7': 'q', 'Numpad8': 'w', 'Numpad9': 'e',
        'Numpad4': 'a', 'Numpad5': 's', 'Numpad6': 'd',
        'Numpad2': 'x',
        'Enter': 'enter',
    },

    // Alef special forms
    ALEF_PRI: null,
    ALEF_SEC: null,

    init: function() {
        var self = this;
        // Hydrate dialect mode from localStorage — survives reload/keyboard close/refresh/etc.
        // Only the explicit 'מד' button toggles it off.
        try { this._dialectActive = (localStorage.getItem('dk_dialect') === '1'); } catch (e) { this._dialectActive = false; }
        this.KEY_SHORT = { 'w': this.FATHA, 's': this.KASRA, 'q': this.DAMMA, 'e': this.SUKUN };
        this.KEY_LONG  = { 'w': this.FATHATAN, 's': this.KASRATAN, 'q': this.DAMMATAN, 'e': '_shadda' };
        this.ALEF_PRI = {
            'w': '\u0623\u064E', 'q': '\u0623\u064F',
            'e': '\u0623\u0652', 's': '\u0625\u0650',
        };
        this.ALEF_SEC = {
            'w': '\u0622', 'q': '\u0671', 'e': null, 's': '\u0627',
        };
        this._boundKD = function(e) { self._onKeyDown(e); };
        this._boundKU = function(e) { self._onKeyUp(e); };

        // Listen for focus changes to show/hide palette
        // Track last focused editable even when inactive (for Ctrl+M activation)
        document.addEventListener('focusin', function(e) {
            if (self._isEditable(e.target)) {
                var prevEl = self._currentEl;
                self._currentEl = e.target;
                if (!self._active) return;
                // Bug fix (Amitai 2026-06-17): the diacritic-key handlers call
                // el.focus() after every keypress because tapping the floating
                // button blurs the field on touch devices. That refocus fires
                // focusin → _showPalette, which RE-POPS the magnifier and
                // re-runs scrollIntoView, so the magnifier jumps/scrolls on
                // EVERY keystroke. The magnifier must pop only on OPEN. When the
                // keyboard is already open on this SAME element, just refresh the
                // content/labels instead of rebuilding the palette.
                if (prevEl === e.target && self._palette && self._palette.querySelector('[data-dk-key]')) {
                    self._updatePaletteLabels();
                    return;
                }
                self._showPalette(e.target);
            }
        });
        document.addEventListener('focusout', function(e) {
            if (!self._active) return;
            var fromEl = e.target;
            setTimeout(function() {
                var act = document.activeElement;
                if (self._palette && self._palette.contains(act)) return;
                if (self._isEditable(act)) {
                    // Same-element refocus while the keyboard is already open
                    // (the post-keypress el.focus()): refresh, do NOT rebuild —
                    // see the focusin note. Rebuilding here re-pops/re-scrolls.
                    if (act === fromEl && self._currentEl === act && self._palette && self._palette.querySelector('[data-dk-key]')) {
                        self._updatePaletteLabels();
                        return;
                    }
                    self._currentEl = act;
                    self._showPalette(act);
                    return;
                }
                self._hidePalette();
            }, 150);
        });

        // Global Ctrl+M toggle (disabled in presenter mode)
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyM') {
                e.preventDefault();
                var viewer = document.getElementById('lesson-viewer');
                if (viewer) {
                    // Show toast directly in presenter (z-index safe)
                    var toast = document.createElement('div');
                    toast.textContent = 'CTRL M לא עובד כעת באופן זמני, השתמש בכפתור הידני (:';
                    toast.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#0d9488;color:white;padding:10px 20px;border-radius:10px;font-weight:500;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);text-align:center;pointer-events:none;transition:opacity 0.3s';
                    document.body.appendChild(toast);
                    setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 300); }, 3000);
                    return;
                }
                self.toggle();
            }
        });

        // Monitor cursor position to update palette for Alef mode
        document.addEventListener('keyup', function() { self._updatePaletteLabels(); });
        document.addEventListener('click', function() { self._updatePaletteLabels(); });

        // Monitor selection changes to switch between keyboard/selection mode
        // Debounced to avoid interfering with button clicks
        var selTimeout = null;
        document.addEventListener('selectionchange', function() {
            if (!self._active) return;
            // Don't fire if active element is a palette button
            if (self._palette && self._palette.contains(document.activeElement)) return;
            if (selTimeout) clearTimeout(selTimeout);
            selTimeout = setTimeout(function() {
                var el = self._currentEl || document.activeElement;
                if (!el || !self._isEditable(el)) return;
                if (self._palette && self._palette.contains(document.activeElement)) return;
                if (self._hasSelection(el)) {
                    self._showSelectionPalette(el);
                } else if (self._palette && !self._palette.querySelector('[data-dk-key]')) {
                    self._showPalette(el);
                }
            }, 150);
        });
    },

    isActive: function() { return this._active; },

    _beforeUnloadHandler: function(e) { e.preventDefault(); e.returnValue = ''; },

    _showToast: function(msg, color) {
        var old = document.getElementById('dk-toast');
        if (old) old.remove();
        var toast = document.createElement('div');
        toast.id = 'dk-toast';
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:' + (color || '#0891b2') + ';color:white;padding:12px 24px;border-radius:12px;font-size:1.1em;font-weight:bold;font-family:Arial,serif;z-index:99999;pointer-events:none;opacity:0.9;direction:rtl;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:opacity 0.3s;';
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; }, 1500);
        setTimeout(function() { toast.remove(); }, 2000);
    },

    _updateToggleButtons: function(active) {
        // Style any elements with class dk-toggle
        var toggleBtns = document.querySelectorAll('.dk-toggle');
        for (var i = 0; i < toggleBtns.length; i++) {
            if (active) {
                toggleBtns[i].style.background = '#0891b2';
                toggleBtns[i].style.color = 'white';
                toggleBtns[i].style.borderColor = '#0891b2';
            } else {
                toggleBtns[i].style.background = '';
                toggleBtns[i].style.color = '';
                toggleBtns[i].style.borderColor = '';
            }
        }
        // Dispatch custom event
        document.dispatchEvent(new CustomEvent('dk-toggle', { detail: { active: active } }));
    },

    activate: function() {
        if (this._active) return;
        this._active = true;
        document.body.classList.add('dk-active');
        this._updateToggleButtons(true);
        // Toast removed per Amitai's request
        document.addEventListener('keydown', this._boundKD, true);
        document.addEventListener('keyup', this._boundKU, true);
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
        // Show palette — try immediately and retry after a short delay (for focus timing)
        var self = this;
        var tryShow = function() {
            var el = self._currentEl || document.activeElement;
            if (!el || !self._isEditable(el)) {
                // In presenter mode, try to find the active qmark input
                var qmarkInput = document.getElementById('qmark-active-input');
                if (qmarkInput) { el = qmarkInput; qmarkInput.focus(); }
            }
            // Block DK on qmark inputs with no Arabic text
            if (el && el.id === 'qmark-active-input' && !/[\u0600-\u06FF]/.test(el.value || '')) {
                self._showToast('אין ניקוד כשאין ערבית, לחץ על ENTER אם כתבת בעברית');
                self._active = false;
                document.body.classList.remove('dk-active');
                self._updateToggleButtons(false);
                document.removeEventListener('keydown', self._boundKD, true);
                document.removeEventListener('keyup', self._boundKU, true);
                return false;
            }
            if (el && self._isEditable(el)) {
                self._currentEl = el;
                self._jumpToFirstUndiacritized(el);
                self._showPalette(el);
                return true;
            }
            return false;
        };

        if (!tryShow()) {
            // Retry multiple times to catch external focus() calls
            var retries = [50, 150, 300];
            retries.forEach(function(delay) {
                setTimeout(function() {
                    if (!self._active || self._palette) return;
                    if (!tryShow()) {
                        var editables = document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"], input:not([type])');
                        for (var i = 0; i < editables.length; i++) {
                            if (editables[i].offsetParent !== null) {
                                editables[i].focus();
                                self._currentEl = editables[i];
                                self._jumpToFirstUndiacritized(editables[i]);
                                self._showPalette(editables[i]);
                                break;
                            }
                        }
                    }
                }, delay);
            });
        }
    },

    deactivate: function() {
        if (!this._active) return;
        this._active = false;
        this._shaddaMemory = {};
        this._magActive = false;
        document.body.classList.remove('dk-active');
        this._updateToggleButtons(false);
        this._showToast('מצב ניקוד כבוי', '#64748b');
        this._cancelLP();
        if (this._xLpTimer) { clearTimeout(this._xLpTimer); this._xLpTimer = null; }
        this._xLpFired = false;
        // Block X/2 key until released to prevent character spam after long-press close
        var _isCloseKey = function(code) { return code === 'KeyX' || code === 'Digit2' || code === 'Numpad2'; };
        var blockX = function(e) { if (_isCloseKey(e.code)) { e.preventDefault(); e.stopPropagation(); } };
        var releaseX = function(e) {
            if (_isCloseKey(e.code)) {
                e.preventDefault(); e.stopPropagation();
                document.removeEventListener('keydown', blockX, true);
                document.removeEventListener('keyup', releaseX, true);
            }
        };
        document.addEventListener('keydown', blockX, true);
        document.addEventListener('keyup', releaseX, true);
        document.removeEventListener('keydown', this._boundKD, true);
        document.removeEventListener('keyup', this._boundKU, true);
        window.removeEventListener('beforeunload', this._beforeUnloadHandler);
        this._hidePalette();
    },

    toggle: function() {
        if (this._active) this.deactivate(); else this.activate();
        return this._active;
    },

    // ── Key Handlers ──

    _onKeyDown: function(e) {
        if (!this._active) return;
        var el = document.activeElement;
        // Fallback to remembered element if active element isn't editable (e.g., focus on body/palette)
        if (!el || !this._isEditable(el)) {
            el = this._currentEl;
            if (!el || !this._isEditable(el)) return;
            el.focus();
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Digit-key shortcuts (Amitai 2026-05-20). Scoped to keyboard-active only, so the
        // digits type normally when the niqqud keyboard is off.
        //   0 = toggle dialect <-> literary mode
        //   1 = insert flipped damma (U+065D) — bonus key, available in ANY mode
        //   3 = insert flipped kasra (U+065C) — bonus key, available in ANY mode
        if (e.code === 'Digit0' || e.code === 'Numpad0') {
            e.preventDefault(); e.stopPropagation();
            this._setDialectMode(el, !this._dialectActive);
            return;
        }
        if (e.code === 'Digit1' || e.code === 'Numpad1' || e.code === 'Digit3' || e.code === 'Numpad3') {
            e.preventDefault(); e.stopPropagation();
            var _flipDiac = (e.code === 'Digit1' || e.code === 'Numpad1') ? 'ٝ' : 'ٜ';
            this._applyWithShadda(el, _flipDiac);
            if (el.isContentEditable) this._showPalette(el);
            return;
        }
        var key = this.CODE_MAP[e.code];
        if (!key) return;

        // A/D navigation — move cursor but defer palette redraw while held
        if (key === 'a' || key === 'd') {
            e.preventDefault(); e.stopPropagation();
            this._navHeld = true;
            this._moveCursor(el, key === 'd' ? -1 : 1);
            // Only update labels (lightweight), don't redraw palette position
            this._updatePaletteLabels();
            return;
        }

        // X = short press clears diacritics, long press closes keyboard
        if (key === 'x') {
            e.preventDefault(); e.stopPropagation();
            if (!this._xLpTimer) {
                var self = this;
                this._xLpFired = false;
                this._xLpTimer = setTimeout(function() {
                    self._xLpFired = true;
                    self.deactivate();
                }, this._LP_MS);
            }
            return;
        }

        // QWES: long-press detection
        if (this.KEY_SHORT[key] !== undefined) {
            e.preventDefault(); e.stopPropagation();
            if (this._lpKey) return;
            var self = this;
            this._lpKey = key;
            this._lpFired = false;
            this._lpTimer = setTimeout(function() {
                self._lpFired = true;
                self._handleLong(el, key);
                if (el.isContentEditable) self._showPalette(el);
            }, this._LP_MS);
            return;
        }
    },

    _onKeyUp: function(e) {
        if (!this._active) return;
        var key = this.CODE_MAP[e.code];

        // X release — short press = clear diacritics
        if (key === 'x') {
            if (this._xLpTimer) { clearTimeout(this._xLpTimer); this._xLpTimer = null; }
            if (!this._xLpFired) {
                var el = document.activeElement;
                if (el) {
                    this._clearDiacritics(el);
                    if (el.isContentEditable) this._showPalette(el);
                }
            }
            this._xLpFired = false;
            return;
        }

        // A/D release — now reposition palette to follow cursor
        if ((key === 'a' || key === 'd') && this._navHeld) {
            this._navHeld = false;
            var el = document.activeElement;
            if (el && this._isEditable(el) && el.isContentEditable) {
                this._showPalette(el); // reposition to new caret location
            }
            this._updatePaletteLabels();
            return;
        }

        if (key === this._lpKey) {
            if (!this._lpFired) {
                this._cancelLP();
                var el = document.activeElement;
                if (el) {
                    this._handleShort(el, key);
                    // Reposition palette to follow cursor after diacritic applied
                    if (el.isContentEditable) this._showPalette(el);
                }
            }
            this._lpKey = null;
            this._lpFired = false;
        }
    },

    _cancelLP: function() {
        if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; }
    },

    // ── Navigation ──

    // Helper: find the end position (after base + diacritics) for a base letter at given index
    _endAfter: function(text, baseIdx) {
        var end = baseIdx + 1;
        while (end < text.length && this.DIAC_RE.test(text[end])) end++;
        return end;
    },

    // Move cursor to next/prev letter
    // Cursor is always placed AFTER a base letter + its diacritics (for _findLetter compat)
    // Skips non-Arabic chars (spaces, punctuation, Hebrew) — treats them as invisible
    _moveCursor: function(el, dir) {
        var text, pos;
        if (el.isContentEditable) {
            var info = this._getCEInfo();
            if (!info) return;
            text = info.text; pos = info.pos;
        } else {
            text = el.value; pos = el.selectionStart;
        }

        // Find which letter the cursor is currently after
        var curLetter = this._findLetter(text, pos);
        var origPos = pos;

        if (dir > 0) {
            // Forward: move to the next Arabic letter after the current one
            var searchStart = curLetter ? curLetter.endIdx : pos;
            // Find next Arabic base letter
            while (searchStart < text.length && !this.ARABIC_BASE_RE.test(text[searchStart])) searchStart++;
            if (searchStart < text.length) {
                pos = this._endAfter(text, searchStart);
            }
        } else {
            // Backward: move to the previous Arabic letter before the current one
            if (!curLetter) {
                var scan = pos - 1;
                while (scan >= 0 && !this.ARABIC_BASE_RE.test(text[scan])) {
                    if (this.DIAC_RE.test(text[scan])) { scan--; continue; }
                    scan--;
                }
                if (scan >= 0) pos = this._endAfter(text, scan);
            } else {
                var scan = curLetter.baseIdx - 1;
                while (scan >= 0 && this.DIAC_RE.test(text[scan])) scan--;
                while (scan >= 0 && !this.ARABIC_BASE_RE.test(text[scan])) scan--;
                if (scan >= 0) {
                    pos = this._endAfter(text, scan);
                }
            }
        }

        // Fallback: if position didn't change, brute-force search from pos±1
        if (pos === origPos && text.length > 0) {
            if (dir > 0) {
                for (var fb = origPos; fb < text.length; fb++) {
                    if (this.ARABIC_BASE_RE.test(text[fb])) {
                        var newPos = this._endAfter(text, fb);
                        if (newPos !== origPos) { pos = newPos; break; }
                    }
                }
            } else {
                for (var fb = origPos - 1; fb >= 0; fb--) {
                    if (this.ARABIC_BASE_RE.test(text[fb])) {
                        var newPos = this._endAfter(text, fb);
                        if (newPos !== origPos) { pos = newPos; break; }
                    }
                }
                if (pos === origPos) pos = 0;
            }
        }

        if (pos < 0) pos = 0;
        if (pos > text.length) pos = text.length;

        if (el.isContentEditable) {
            var info = this._getCEInfo();
            if (info) {
                // If we reached boundary of text node and didn't find Arabic, try next/prev text node
                if (pos === origPos && el.isContentEditable) {
                    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                    var current = info.node;
                    var targetNode = null;
                    // Find current node in walker
                    while (walker.nextNode()) {
                        if (walker.currentNode === current) break;
                    }
                    if (dir > 0) {
                        targetNode = walker.nextNode();
                    } else {
                        // Reset and find previous
                        walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                        var prev = null;
                        while (walker.nextNode()) {
                            if (walker.currentNode === current) break;
                            prev = walker.currentNode;
                        }
                        targetNode = prev;
                    }
                    if (targetNode && targetNode.textContent.length > 0) {
                        var newText = targetNode.textContent;
                        var newPos = dir > 0 ? 0 : newText.length;
                        // Find first/last Arabic letter in new node
                        if (dir > 0) {
                            var s = 0;
                            while (s < newText.length && !this.ARABIC_BASE_RE.test(newText[s])) s++;
                            if (s < newText.length) newPos = this._endAfter(newText, s);
                        } else {
                            var s = newText.length - 1;
                            while (s >= 0 && !this.ARABIC_BASE_RE.test(newText[s])) s--;
                            if (s >= 0) newPos = this._endAfter(newText, s);
                        }
                        this._setCECursor(targetNode, Math.min(newPos, newText.length));
                        return;
                    }
                }
                this._setCECursor(info.node, pos);
            }
        } else {
            el.selectionStart = el.selectionEnd = pos;
            // Dispatch edge event if cursor didn't move (at boundary of input)
            if (pos === origPos) {
                el.dispatchEvent(new CustomEvent('dk-edge', { detail: { direction: dir }, bubbles: true }));
            }
        }
    },

    // Smart cursor placement: find first undiacritized Arabic letter on the current LINE
    // Stays within the line (doesn't cross newlines). Starts from the beginning of the line.
    // In qmark mode: scans ALL qmark inputs in the sentence (RTL) to find first undiacritized.
    _jumpToFirstUndiacritized: function(el) {
        // Qmark mode: scan all qmark inputs in the sentence from right (RTL)
        if (el.id === 'qmark-active-input' || el.closest && el.closest('.qmark-editing')) {
            var sentence = el.closest('.lp-arabic') || el.closest('.lp-slide') || el.parentElement;
            if (sentence) {
                var allPlaceholders = sentence.querySelectorAll('.qmark-placeholder');
                // In RTL, DOM order = right to left already (first placeholder = rightmost word)
                for (var pi = 0; pi < allPlaceholders.length; pi++) {
                    var inp = allPlaceholders[pi].querySelector('input');
                    if (!inp) continue;
                    var found = this._findFirstUndiacInInput(inp);
                    if (found >= 0) {
                        // Focus this input and place cursor
                        if (inp !== el) {
                            inp.focus();
                            this._currentEl = inp;
                        }
                        inp.selectionStart = inp.selectionEnd = found;
                        this._showPalette(inp);
                        return;
                    }
                }
            }
            // All diacritized — stay at current input start
            el.selectionStart = el.selectionEnd = 0;
            return;
        }

        var text, pos;
        if (el.isContentEditable) {
            var info = this._getCEInfo();
            if (!info) return;
            text = info.text; pos = info.pos;
        } else {
            text = el.value; pos = el.selectionStart;
        }

        // Find current line boundaries (between \n characters)
        var lineStart = text.lastIndexOf('\n', pos - 1) + 1;
        var lineEnd = text.indexOf('\n', pos);
        if (lineEnd === -1) lineEnd = text.length;

        // Find current word start (scan backward from cursor to find word boundary)
        // In RTL: "word to the right" = earlier in string
        var wordStart = pos;
        // Skip diacritics/spaces backward to find the word we're in or just passed
        while (wordStart > lineStart && !this.ARABIC_BASE_RE.test(text[wordStart - 1]) && text[wordStart - 1] !== ' ' && text[wordStart - 1] !== '\n') wordStart--;
        while (wordStart > lineStart && text[wordStart - 1] !== ' ' && text[wordStart - 1] !== '\n') wordStart--;

        // Scan from current word position (not line start) for first undiacritized letter
        var scanPos = wordStart;
        var _foundInScan = false;
        while (scanPos < lineEnd) {
            if (this.ARABIC_BASE_RE.test(text[scanPos])) {
                var baseIdx = scanPos;
                var endIdx = baseIdx + 1;
                while (endIdx < lineEnd && this.DIAC_RE.test(text[endIdx])) endIdx++;
                var diacritics = text.slice(baseIdx + 1, endIdx);
                var hasDiac = false;
                for (var d = 0; d < diacritics.length; d++) {
                    if (diacritics[d] !== this.SHADDA) { hasDiac = true; break; }
                }
                if (!hasDiac) {
                    if (el.isContentEditable) {
                        var info2 = this._getCEInfo();
                        if (info2) this._setCECursor(info2.node, endIdx);
                    } else {
                        el.selectionStart = el.selectionEnd = endIdx;
                    }
                    _foundInScan = true;
                    return;
                }
                scanPos = endIdx;
            } else {
                scanPos++;
            }
        }

        // Nothing found from current word to end of line — wrap to line start
        if (!_foundInScan && wordStart > lineStart) {
            scanPos = lineStart;
            while (scanPos < wordStart) {
                if (this.ARABIC_BASE_RE.test(text[scanPos])) {
                    var baseIdx2 = scanPos;
                    var endIdx2 = baseIdx2 + 1;
                    while (endIdx2 < lineEnd && this.DIAC_RE.test(text[endIdx2])) endIdx2++;
                    var diacritics2 = text.slice(baseIdx2 + 1, endIdx2);
                    var hasDiac2 = false;
                    for (var d2 = 0; d2 < diacritics2.length; d2++) {
                        if (diacritics2[d2] !== this.SHADDA) { hasDiac2 = true; break; }
                    }
                    if (!hasDiac2) {
                        if (el.isContentEditable) {
                            var info4 = this._getCEInfo();
                            if (info4) this._setCECursor(info4.node, endIdx2);
                        } else {
                            el.selectionStart = el.selectionEnd = endIdx2;
                        }
                        return;
                    }
                    scanPos = endIdx2;
                } else {
                    scanPos++;
                }
            }
        }

        // All letters on this line are diacritized — stay at current position
    },

    // Helper: find position of first undiacritized Arabic letter in an input element
    // Returns cursor position (after the letter) or -1 if all diacritized
    _findFirstUndiacInInput: function(inp) {
        var text = inp.value || '';
        var scanPos = 0;
        while (scanPos < text.length) {
            if (this.ARABIC_BASE_RE.test(text[scanPos])) {
                var baseIdx = scanPos;
                var endIdx = baseIdx + 1;
                while (endIdx < text.length && this.DIAC_RE.test(text[endIdx])) endIdx++;
                var diacritics = text.slice(baseIdx + 1, endIdx);
                var hasDiac = false;
                for (var d = 0; d < diacritics.length; d++) {
                    if (diacritics[d] !== this.SHADDA) { hasDiac = true; break; }
                }
                if (!hasDiac) return endIdx; // position after the undiacritized letter
                scanPos = endIdx;
            } else {
                scanPos++;
            }
        }
        return -1; // all diacritized
    },

    // ── Short Press ──

    _handleShort: function(el, key) {
        var li = this._getLetterInfo(el);
        // Alef mode — preserve shadda when switching between alef forms
        if (li && this.ALEF_RE.test(li.baseLetter) && this.ALEF_PRI[key]) {
            var hadShadda = li.diacritics.indexOf(this.SHADDA) >= 0 || this._shaddaMemory[li.baseIdx];
            var form = this.ALEF_PRI[key];
            // Dialect mode (d151): swap kasra/damma in alef-mode forms for flipped variants
            // — q: أُ → أ + U+065D (flipped damma); s: إِ → إ + U+065C (flipped kasra).
            if (this._dialectActive) {
                if (key === 'q') form = 'أٝ';
                // 's' (kasra) stays regular إِ on the MAIN alef button
                // (Amitai 2026-06-04); flipped kasra moved to the secondary button.
            }
            // Add shadda to the replacement form if it was active and new diacritic supports it (not sukun)
            if (hadShadda && key !== 'e') {
                form = form + this.SHADDA;
            }
            this._replaceAlef(el, li, form);
            return;
        }
        // Apply diacritic with persistent shadda
        var diac = this.KEY_SHORT[key];
        this._applyWithShadda(el, diac);
    },

    // ── Long Press ──

    _handleLong: function(el, key) {
        var li = this._getLetterInfo(el);
        // Dialect mode (d151): kasratayn (s) → U+065C (flipped kasra glyph in custom font
        // with kasra GPOS anchor); dammatayn (q) → U+065D (flipped damma with damma anchor).
        // Applies even on alef per Amitai 23:30.
        if (this._dialectActive && (key === 's' || key === 'q')) {
            // On an alef, dialect kasra-flip (secondary S) REPLACES the alef with the
            // إ-form + flipped kasra, mirroring the primary's إِ — handled in the alef
            // branch below (Amitai 2026-06-04). Other letters: apply the mark directly.
            if (!(key === 's' && li && this.ALEF_RE.test(li.baseLetter))) {
                this._applyWithShadda(el, key === 's' ? 'ٜ' : 'ٝ');
                return;
            }
        }
        // Long-W: dagger alef (khanjariyyah) when the next base letter in string order
        // (= visually to the LEFT in RTL) is a non-alef Arabic letter. Otherwise fathatan.
        if (li && key === 'w' && !this.ALEF_RE.test(li.baseLetter)) {
            if (this._nextLetterIsNonAlefArabic(el, li)) {
                this._applyWithShadda(el, '\u0670');
                return;
            }
        }
        // Alef mode
        if (li && this.ALEF_RE.test(li.baseLetter)) {
            if (key === 'e') { this._toggleShaddaOnLetter(el); return; }
            // Dialect mode: secondary S on alef = إ + flipped kasra (U+065C),
            // mirroring the primary's regular إِ (Amitai 2026-06-04).
            if (this._dialectActive && key === 's') {
                var hadShaddaF = li.diacritics.indexOf(this.SHADDA) >= 0 || this._shaddaMemory[li.baseIdx];
                var fform = 'إٜ';
                if (hadShaddaF) fform = fform + this.SHADDA;
                this._replaceAlef(el, li, fform);
                return;
            }
            var sec = this.ALEF_SEC[key];
            if (sec !== null && sec !== undefined) {
                // Preserve shadda on alef secondary forms too (where applicable)
                var hadShadda = li.diacritics.indexOf(this.SHADDA) >= 0 || this._shaddaMemory[li.baseIdx];
                var form = sec;
                if (hadShadda && sec.length === 1) {
                    // Single-char replacement (like آ or ٱ) — can't add shadda to these special forms
                } else if (hadShadda && sec.length > 1) {
                    form = sec + this.SHADDA;
                }
                this._replaceAlef(el, li, form);
                return;
            }
            // W/Q/S long on alef: apply tanween variant
            var longVal = this.KEY_LONG[key];
            if (longVal && longVal !== '_shadda') { this._applyWithShadda(el, longVal); return; }
        }
        // Regular letter
        var longVal = this.KEY_LONG[key];
        if (longVal === '_shadda') {
            this._toggleShaddaOnLetter(el);
        } else if (longVal) {
            this._applyWithShadda(el, longVal);
        }
    },

    // ── Shadda (per-letter memory) ──

    _toggleShaddaOnLetter: function(el) {
        var li = this._getLetterInfo(el);
        if (!li) return;
        var hasShadda = li.diacritics.indexOf(this.SHADDA) >= 0;
        if (hasShadda) {
            // Turn OFF: remove shadda and clear memory
            this._applyDiac(el, this.SHADDA, true);
            delete this._shaddaMemory[li.baseIdx];
        } else {
            // Turn ON: add shadda and remember
            if (li.diacritics.indexOf(this.SUKUN) >= 0) return; // can't add to sukun
            this._applyDiac(el, this.SHADDA, true);
            this._shaddaMemory[li.baseIdx] = true;
        }
        this._updatePaletteShaddaIndicator();
    },

    // Apply diacritic with per-letter shadda memory
    _applyWithShadda: function(el, diac) {
        var li = this._getLetterInfo(el);
        var remembered = li && this._shaddaMemory[li.baseIdx];
        this._applyDiac(el, diac, false);
        // Re-add shadda if this letter has it in memory and new diacritic is not sukun
        if (remembered && diac !== this.SUKUN) {
            var li2 = this._getLetterInfo(el);
            if (li2 && li2.diacritics.indexOf(this.SHADDA) < 0) {
                this._applyDiac(el, this.SHADDA, true);
            }
        }
        this._updatePaletteShaddaIndicator();
    },

    // Clear all diacritics from current letter
    _clearDiacritics: function(el) {
        var li = this._getLetterInfo(el);
        if (!li) return;
        delete this._shaddaMemory[li.baseIdx];
        // Alef mode: X = bare alef (ا)
        if (this.ALEF_RE.test(li.baseLetter)) {
            var bareAlef = '\u0627'; // ا
            this._replaceAlef(el, li, bareAlef);
            return;
        }
        if (!li.diacritics) return;
        if (el.isContentEditable) {
            var info = this._getCEInfo();
            if (!info) return;
            var newText = info.text.slice(0, li.baseIdx + 1) + info.text.slice(li.endIdx);
            info.node.textContent = newText;
            this._setCECursor(info.node, li.baseIdx + 1);
        } else {
            var text = el.value;
            var newText = text.slice(0, li.baseIdx + 1) + text.slice(li.endIdx);
            el.value = newText;
            el.selectionStart = el.selectionEnd = li.baseIdx + 1;
            this._triggerInput(el);
        }
        this._updatePaletteShaddaIndicator();
    },

    // Dialect-mode (d151, 2026-05-19): codepoint swap kasratayn/dammatayn ↔ U+065C/U+065D.
    // The custom font plonter-flipped-diacritics.woff2 supplies a flipped-kasra glyph at
    // U+065C with GPOS anchors COPIED FROM U+0650 (regular kasra) — so HarfBuzz positions
    // it like a real kasra, attached to the base letter. Same for U+065D ← U+064F (damma).
    // No CSS wrapper, no DOM mutation: storage swap is all the JS does; the font carries
    // the visual.
    _DIALECT_PAIRS_TO: [['ٍ', 'ٜ'], ['ٌ', 'ٝ']],
    _DIALECT_PAIRS_FROM: [['ٜ', 'ٍ'], ['ٝ', 'ٌ']],

    _applyDialectPairs: function(s, pairs) {
        for (var i = 0; i < pairs.length; i++) {
            s = s.split(pairs[i][0]).join(pairs[i][1]);
        }
        return s;
    },

    _bulkTransformDialect: function(el, pairs) {
        if (el.isContentEditable) {
            var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            var node;
            while ((node = walker.nextNode())) {
                var t = node.textContent;
                var nt = this._applyDialectPairs(t, pairs);
                if (nt !== t) node.textContent = nt;
            }
            this._triggerInput(el);
        } else {
            var v = el.value;
            var nv = this._applyDialectPairs(v, pairs);
            if (nv !== v) {
                el.value = nv;
                this._triggerInput(el);
            }
        }
    },

    _toggleDialectMode: function(el, toDialect) {
        var self = this;
        var pairs = toDialect ? this._DIALECT_PAIRS_TO : this._DIALECT_PAIRS_FROM;
        this._bulkTransformDialect(el, pairs);
        this._dialectActive = toDialect;
        try { localStorage.setItem('dk_dialect', toDialect ? '1' : '0'); } catch (e) {}

        // Detach any prior live listener
        if (this._dialectInputListener && this._dialectListenerEl) {
            this._dialectListenerEl.removeEventListener('input', this._dialectInputListener);
            this._dialectInputListener = null;
            this._dialectListenerEl = null;
        }
        // Attach new listener if turning ON — converts newly typed kasratayn/dammatayn on the fly
        if (toDialect) {
            this._dialectListenerEl = el;
            this._dialectInputListener = function() {
                if (self._dialectInListener) return;
                self._dialectInListener = true;
                try { self._bulkTransformDialect(el, self._DIALECT_PAIRS_TO); }
                finally { self._dialectInListener = false; }
            };
            el.addEventListener('input', this._dialectInputListener);
        }

        // Update palette tanwin secondary labels to show the flipped chars (rendered via
        // the custom font's U+065C/U+065D glyphs with kasra/damma anchors).
        if (this._palette) {
            var kasratayBtn = this._palette.querySelector('[data-dk-key="s"][data-dk-sec]');
            var dammatayBtn = this._palette.querySelector('[data-dk-key="q"][data-dk-sec]');
            var kasraCh = toDialect ? 'ٜ' : 'ٍ';
            var dammaCh = toDialect ? 'ٝ' : 'ٌ';
            if (kasratayBtn) kasratayBtn.innerHTML = '<span style="font-size:1.8em;line-height:1">ـ' + kasraCh + '</span>';
            if (dammatayBtn) dammatayBtn.innerHTML = '<span style="font-size:1.8em;line-height:1">ـ' + dammaCh + '</span>';
        }
    },

    // Toggle dialect mode AND keep the on-screen toggle button (label + color) in sync.
    // Shared by the on-screen button click and the '1' key shortcut (Amitai 2026-05-20).
    // Label shows the CURRENT mode: literary -> "ספ'", dialect -> "מד'".
    _setDialectMode: function(el, toDialect) {
        this._toggleDialectMode(el, toDialect);
        var btn = document.getElementById('dk-dialect-toggle');
        if (btn) {
            btn.dataset.dialect = toDialect ? '1' : '0';
            btn.innerHTML = toDialect ? "מד'" : "ספ'";
            btn.style.background = toDialect ? '#0d9488' : '#ccfbf1';
            btn.style.color = toDialect ? '#fff' : '#0f766e';
        }
    },

    // ── Core Diacritic Operations ──

    _applyDiac: function(el, diac, isShadda) {
        if (el.isContentEditable) this._applyDiacCE(el, diac, isShadda);
        else this._applyDiacInput(el, diac, isShadda);
    },

    _replaceAlef: function(el, li, form) {
        if (el.isContentEditable) this._replaceAlefCE(el, li, form);
        else this._replaceAlefInput(el, li, form);
    },

    // ── Input/Textarea Operations ──

    _applyDiacInput: function(input, diac, isShadda) {
        var text = input.value, pos = input.selectionStart;
        var li = this._findLetter(text, pos);
        if (!li) return;
        var newText = this._buildReplaced(text, li, diac, isShadda);
        if (newText === text) return;
        input.value = newText;
        input.selectionStart = input.selectionEnd = this._findEndAfter(newText, li.baseIdx);
        this._triggerInput(input);
    },

    _replaceAlefInput: function(input, li, form) {
        var text = input.value;
        var newText = text.slice(0, li.baseIdx) + form + text.slice(li.endIdx);
        input.value = newText;
        input.selectionStart = input.selectionEnd = li.baseIdx + form.length;
        this._triggerInput(input);
    },

    _triggerInput: function(input) {
        if (input.oninput) input.oninput();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    },

    // ── ContentEditable Operations ──

    _applyDiacCE: function(el, diac, isShadda) {
        var info = this._getCEInfo();
        if (!info) return;
        var li = this._findLetter(info.text, info.pos);
        if (!li) return;
        var newText = this._buildReplaced(info.text, li, diac, isShadda);
        if (newText === info.text) return;
        info.node.textContent = newText;
        this._setCECursor(info.node, this._findEndAfter(newText, li.baseIdx));
    },

    _replaceAlefCE: function(el, li, form) {
        var info = this._getCEInfo();
        if (!info) return;
        var newText = info.text.slice(0, li.baseIdx) + form + info.text.slice(li.endIdx);
        info.node.textContent = newText;
        this._setCECursor(info.node, Math.min(li.baseIdx + form.length, newText.length));
    },

    _getCEInfo: function() {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        // If cursor is on an element (not a text node), try to find the nearest text node
        if (node.nodeType !== 3) {
            // Try to get the text node at the cursor position
            if (node.childNodes.length > 0 && range.startOffset < node.childNodes.length) {
                var child = node.childNodes[range.startOffset];
                if (child && child.nodeType === 3) {
                    return { node: child, text: child.textContent, pos: 0 };
                }
            }
            // Try to find the first text node
            var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            var firstText = walker.nextNode();
            if (firstText) return { node: firstText, text: firstText.textContent, pos: 0 };
            return null;
        }
        return { node: node, text: node.textContent, pos: range.startOffset };
    },

    _setCECursor: function(node, pos) {
        var range = document.createRange();
        range.setStart(node, Math.min(pos, node.textContent.length));
        range.collapse(true);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    },

    // ── Text Analysis ──

    _findLetter: function(text, cursorPos) {
        var idx = cursorPos - 1;
        while (idx >= 0 && this.DIAC_RE.test(text[idx])) idx--;
        if (idx < 0) return null;
        var endIdx = idx + 1;
        while (endIdx < text.length && this.DIAC_RE.test(text[endIdx])) endIdx++;
        return { baseIdx: idx, baseLetter: text[idx], diacritics: text.slice(idx + 1, endIdx), endIdx: endIdx };
    },

    _buildReplaced: function(text, li, diac, isShadda) {
        var existing = li.diacritics;
        var newDiacs;
        if (isShadda) {
            if (existing.indexOf(this.SHADDA) >= 0) {
                newDiacs = existing.replace(this.SHADDA, '');
            } else {
                if (existing.indexOf(this.SUKUN) >= 0) return text;
                newDiacs = this.SHADDA + existing;
            }
        } else {
            var hasShadda = existing.indexOf(this.SHADDA) >= 0;
            if (diac === this.SUKUN) {
                newDiacs = diac; // sukun alone
            } else {
                newDiacs = (hasShadda ? this.SHADDA : '') + diac;
            }
        }
        return text.slice(0, li.baseIdx + 1) + newDiacs + text.slice(li.endIdx);
    },

    _findEndAfter: function(text, baseIdx) {
        var pos = baseIdx + 1;
        while (pos < text.length && this.DIAC_RE.test(text[pos])) pos++;
        return pos;
    },

    // ── Helpers ──

    _isEditable: function(el) {
        if (!el) return false;
        return el.isContentEditable ||
            el.tagName === 'TEXTAREA' ||
            (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search' || !el.type));
    },

    _getLetterInfo: function(el) {
        if (el.isContentEditable) {
            var info = this._getCEInfo();
            return info ? this._findLetter(info.text, info.pos) : null;
        }
        return this._findLetter(el.value || '', el.selectionStart || 0);
    },

    // ── Palette UI (QWE row + S below, with tanween/shadda secondary buttons) ──

    _getCaretRect: function(el) {
        // For contenteditable: get actual caret position
        if (el.isContentEditable) {
            var sel = window.getSelection();
            if (sel && sel.rangeCount) {
                var range = sel.getRangeAt(0).cloneRange();
                range.collapse(true);
                var caretRect = range.getBoundingClientRect();
                if (caretRect.width === 0 && caretRect.height === 0) {
                    // Fallback: insert temp span to measure
                    var span = document.createElement('span');
                    span.textContent = '\u200B'; // zero-width space
                    range.insertNode(span);
                    caretRect = span.getBoundingClientRect();
                    span.remove();
                    sel.removeAllRanges(); sel.addRange(range);
                }
                // Guard against 0,0 (element not visible or in scrolled container)
                if (caretRect.height > 0 && (caretRect.top > 0 || caretRect.left > 0)) return caretRect;
            }
        }
        // Fallback: use element rect, centered horizontally
        var elRect = el.getBoundingClientRect();
        return { top: elRect.top, bottom: elRect.bottom, left: elRect.left + elRect.width / 2, width: 0, height: elRect.height };
    },

    // Check if there's a text selection and show selection-mode buttons instead
    _hasSelection: function(el) {
        if (el.isContentEditable) {
            var sel = window.getSelection();
            return sel && !sel.isCollapsed;
        }
        return el.selectionStart !== undefined && el.selectionStart !== el.selectionEnd;
    },

    // Get selected text range
    _getSelectionRange: function(el) {
        if (el.isContentEditable) {
            var sel = window.getSelection();
            if (!sel || sel.isCollapsed) return null;
            var range = sel.getRangeAt(0);
            var node = range.startContainer;
            if (node.nodeType !== 3) return null;
            // If selection spans multiple nodes, only operate within the start node
            var endOffset = (range.endContainer === node) ? range.endOffset : node.textContent.length;
            return { start: range.startOffset, end: endOffset, text: node.textContent, node: node };
        }
        return { start: el.selectionStart, end: el.selectionEnd, text: el.value };
    },

    // Strip all diacritics from text and convert alef forms to bare alef
    _stripDiacritics: function(text) {
        // Remove all diacritics
        var stripped = text.replace(/[\u064B-\u065F\u0670]/g, '');
        // Convert alef forms to bare alef
        stripped = stripped.replace(/[أإآٱ]/g, '\u0627');
        return stripped;
    },

    // Show selection-mode palette (2 buttons)
    _showSelectionPalette: function(el) {
        this._hidePalette();
        var self = this;

        // Get selection bounds for centering
        var selRect = null;
        if (el.isContentEditable) {
            var sel = window.getSelection();
            if (sel && sel.rangeCount) selRect = sel.getRangeAt(0).getBoundingClientRect();
        }
        if (!selRect || selRect.width === 0) selRect = this._getCaretRect(el);

        var palette = document.createElement('div');
        palette.id = 'dk-palette';
        palette.style.cssText = 'position:fixed;z-index:10000;pointer-events:none;';

        var btnBase = 'position:fixed;pointer-events:auto;border:none;border-radius:12px;cursor:pointer;font-family:Arial,serif;box-shadow:0 2px 8px rgba(0,0,0,0.18);transition:transform 0.1s;padding:10px 16px;font-size:0.9em;font-weight:bold;white-space:nowrap;direction:rtl;';
        var btnW = 120;
        var totalW = btnW * 2 + 8;
        var centerX = Math.min(Math.max(selRect.left + selRect.width / 2, totalW / 2 + 8), window.innerWidth - totalW / 2 - 8);
        var topY = selRect.top - 52;
        if (topY < 4) topY = selRect.bottom + 8;

        // Button 1: "Start diacritizing" — right side (RTL)
        var startBtn = document.createElement('button');
        startBtn.textContent = 'נקד מההתחלה';
        startBtn.style.cssText = btnBase + 'background:#0891b2;color:white;left:' + (centerX - totalW / 2) + 'px;top:' + topY + 'px;width:' + btnW + 'px;';
        startBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        startBtn.addEventListener('click', function() {
            var range = self._getSelectionRange(el);
            if (range) {
                // Collapse selection to start position
                if (el.isContentEditable) {
                    var sel = window.getSelection();
                    sel.collapse(range.node, range.start);
                } else {
                    el.selectionStart = el.selectionEnd = range.start;
                }
                // Jump to first undiacritized letter from that position
                self._jumpToFirstUndiacritized(el);
            }
            self._showPalette(el);
        });
        palette.appendChild(startBtn);

        // Button 2: "Reset diacritics" — left side
        var resetBtn = document.createElement('button');
        resetBtn.textContent = 'אפס ניקוד';
        resetBtn.style.cssText = btnBase + 'background:#ef4444;color:white;left:' + (centerX - totalW / 2 + btnW + 8) + 'px;top:' + topY + 'px;width:' + btnW + 'px;';
        resetBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        resetBtn.addEventListener('click', function() {
            var range = self._getSelectionRange(el);
            if (!range) return;
            var selected = range.text.slice(range.start, range.end);
            var stripped = self._stripDiacritics(selected);
            if (el.isContentEditable) {
                var newText = range.text.slice(0, range.start) + stripped + range.text.slice(range.end);
                range.node.textContent = newText;
                self._setCECursor(range.node, range.start + stripped.length);
            } else {
                var newText = range.text.slice(0, range.start) + stripped + range.text.slice(range.end);
                el.value = newText;
                el.selectionStart = el.selectionEnd = range.start + stripped.length;
                self._triggerInput(el);
            }
            self._showPalette(el);
        });
        palette.appendChild(resetBtn);

        // Magnifier for selection mode
        var mag = document.createElement('div');
        mag.id = 'dk-magnifier';
        var magTop = selRect.top > window.innerHeight * 0.35;
        var topOffset = 4;
        mag.style.cssText = 'position:fixed;' + (magTop ? 'top:' + topOffset + 'px' : 'bottom:8px') + ';left:50%;transform:translateX(-50%);background:white;border:3px solid #ef4444;border-radius:14px;padding:8px 20px;z-index:10001;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.18);font-family:"PlonterFlippedDiacritics",Arial,serif;font-size:2.5em;line-height:1.2;direction:rtl;color:#1e293b;max-width:94vw;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        var range = this._getSelectionRange(el);
        if (range) {
            mag.innerHTML = '<span style="color:#ef4444;text-decoration:underline">' + range.text.slice(range.start, range.end) + '</span>';
        }
        palette.appendChild(mag);

        this._palette = palette;
        document.body.appendChild(palette);
    },

    _showPalette: function(el) {
        // Check for text selection — show selection mode instead
        if (this._hasSelection(el)) {
            this._showSelectionPalette(el);
            return;
        }

        this._hidePalette();
        var self = this;
        // Scroll-to-fit: the palette spans ~140px above the caret (close +
        // tanween row + main row + gaps) and ~110px below (S + kasratan).
        // If the input is positioned such that either edge would overflow the
        // viewport (typical on mobile when the soft-keyboard takes the bottom
        // half), scroll its nearest scrollable ancestor so the input is mid-
        // viewport before we compute button positions.
        var __preCaret = this._getCaretRect(el);
        var __overTop = 140 - __preCaret.top;
        var __overBot = (__preCaret.bottom + 110) - window.innerHeight;
        if (__overTop > 0 || __overBot > 0) {
            try {
                el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            } catch (e) {
                try { el.scrollIntoView({ block: 'center' }); } catch (e2) {}
            }
        }
        var rect = this._getCaretRect(el);

        var palette = document.createElement('div');
        palette.id = 'dk-palette';
        palette.style.cssText = 'position:fixed;z-index:10000;pointer-events:none;';

        // Common button styles — diacritic-only display (no letter), larger font
        var btnCSS = 'position:fixed;pointer-events:auto;border:none;border-radius:10px;cursor:pointer;font-family:"PlonterFlippedDiacritics",Arial,serif;-webkit-tap-highlight-color:transparent;box-shadow:0 2px 8px rgba(0,0,0,0.18);transition:transform 0.1s;background:#fef9c3;color:#1e293b;display:flex;align-items:center;justify-content:center;';
        var mainSz = 'width:56px;height:56px;';
        var secSz = 'width:44px;height:36px;';  // smaller secondary buttons for tanween
        var bsz = 56, secH = 36, gap = 8, secGap = 4;
        var closeBtnH = 28;

        // QWE row: above the input, centered
        var rowW = bsz * 3 + gap * 2;
        var rowLeft = rect.left + rect.width / 2 - rowW / 2;
        // Secondary row is above the main row, close button above that
        var mainRowTop = rect.top - bsz - 8;
        var secRowTop = mainRowTop - secH - secGap;
        var closeRowTop = secRowTop - closeBtnH - secGap;
        if (closeRowTop < 4) { closeRowTop = 4; secRowTop = closeRowTop + closeBtnH + secGap; mainRowTop = secRowTop + secH + secGap; }
        if (rowLeft < 4) rowLeft = 4;
        if (rowLeft + rowW > window.innerWidth - 4) rowLeft = window.innerWidth - rowW - 4;

        // S button: below the input, centered
        var sLeft = rect.left + rect.width / 2 - bsz / 2;
        var sTop = rect.bottom + 8;
        var secSTop = sTop + bsz + secGap; // kasratan below kasra
        if (secSTop + secH > window.innerHeight - 4) secSTop = window.innerHeight - secH - 4;
        if (sTop + bsz > window.innerHeight - 4) sTop = window.innerHeight - bsz - 4;
        if (sLeft + bsz > window.innerWidth - 4) sLeft = window.innerWidth - bsz - 4;
        if (sLeft < 4) sLeft = 4;

        // ── Dock to bottom-center when caret-anchored layout would overflow an edge ──
        // Amitai 2026-06-04: when the keyboard gets pushed/clipped at a screen edge so he
        // can't see it, pop the whole palette to a fixed bottom-center stack instead of
        // following the caret. Re-evaluated on every _showPalette (i.e. every action).
        this._docked = false;
        var EDGE = 4;
        var natTop = rect.top - bsz - 8 - secH - secGap - closeBtnH - secGap; // unclamped top row
        var natBot = rect.bottom + 8 + bsz + secGap + secH;                   // unclamped bottom row
        // Dock only on VERTICAL overflow: the row's horizontal position is already
        // clamped on-screen, and in RTL the caret sits at the right edge at every
        // line start — docking on that would fire on almost every keystroke.
        if (natTop < EDGE || natBot > window.innerHeight - EDGE) {
            this._docked = true;
            var cx = window.innerWidth / 2;
            // Stack upward from the bottom edge: kasratan, kasra, main QWE, tanween, tools.
            secSTop = window.innerHeight - EDGE - secH;
            sTop = secSTop - secGap - bsz;
            mainRowTop = sTop - gap - bsz;
            secRowTop = mainRowTop - secGap - secH;
            closeRowTop = secRowTop - secGap - closeBtnH;
            rowLeft = cx - rowW / 2;
            if (rowLeft < EDGE) rowLeft = EDGE;
            sLeft = cx - bsz / 2;
        }

        // Main QWES buttons — show only diacritics (no letter), enlarged
        var topBtns = [
            { key: 'q', xOff: 0,                diac: '\u064F', letter: 'Q' },  // damma
            { key: 'w', xOff: bsz + gap,        diac: '\u064E', letter: 'W' },  // fatha
            { key: 'e', xOff: (bsz + gap) * 2,  diac: '\u0652', letter: 'E' },  // sukun
        ];

        // Secondary buttons (tanween) — positioned ABOVE main buttons
        var secBtns = [
            { key: 'q', xOff: 0,                diac: '\u064C', action: 'long' },  // dammatan above damma
            { key: 'w', xOff: bsz + gap,        diac: '\u064B', action: 'long' },  // fathatan above fatha
            { key: 'e', xOff: (bsz + gap) * 2,  diac: '\u0651', action: 'long' },  // shadda above sukun
        ];

        // Top toolbar row — close, magnifier toggle, reset letter
        var toolBtnCSS = 'position:fixed;pointer-events:auto;border:none;border-radius:50%;cursor:pointer;font-family:Arial,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;width:' + closeBtnH + 'px;height:' + closeBtnH + 'px;font-size:0.8em;font-weight:bold;top:' + closeRowTop + 'px;transition:transform 0.1s;';
        var toolGap = 6;
        var toolCount = 3; // close + reset letter + dialect toggle
        var toolTotalW = closeBtnH * toolCount + toolGap * (toolCount - 1);
        var toolStartX = rowLeft + rowW / 2 - toolTotalW / 2;

        // Close button
        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.title = 'close';
        closeBtn.style.cssText = toolBtnCSS + 'background:#fecaca;color:#991b1b;left:' + toolStartX + 'px;';
        closeBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        closeBtn.addEventListener('click', function() { self.deactivate(); });
        closeBtn.addEventListener('touchend', function(e) { e.preventDefault(); self.deactivate(); });
        palette.appendChild(closeBtn);

        // Reset current letter button (like X key)
        var resetLetterBtn = document.createElement('button');
        resetLetterBtn.innerHTML = '⌫';
        resetLetterBtn.title = 'reset letter';
        resetLetterBtn.style.cssText = toolBtnCSS + 'background:#fef3c7;color:#92400e;left:' + (toolStartX + closeBtnH + toolGap) + 'px;';
        resetLetterBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        resetLetterBtn.addEventListener('click', function() {
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) { self._clearDiacritics(el); el.focus(); }
        });
        resetLetterBtn.addEventListener('touchend', function(e) {
            e.preventDefault();
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) { self._clearDiacritics(el); el.focus(); }
        });
        palette.appendChild(resetLetterBtn);

        // Dialect-mode toggle (kasratayn/dammatayn ↔ flipped kasra/damma via PUA codepoints)
        var dialectBtn = document.createElement('button');
        dialectBtn.title = 'החלפה בין מצב מדוברת לספרותית (גם מקש 0)';
        dialectBtn.id = 'dk-dialect-toggle';
        var _dialectOffCSS = 'background:#ccfbf1;color:#0f766e;';
        var _dialectOnCSS = 'background:#0d9488;color:#fff;';
        // Initialize from persisted state so toggle survives keyboard close/reopen.
        // Label shows the CURRENT mode: literary -> "ספ'", dialect -> "מד'" (Amitai 2026-05-20).
        var _initialDialect = !!self._dialectActive;
        dialectBtn.dataset.dialect = _initialDialect ? '1' : '0';
        dialectBtn.innerHTML = _initialDialect ? "מד'" : "ספ'";
        dialectBtn.style.cssText = toolBtnCSS + (_initialDialect ? _dialectOnCSS : _dialectOffCSS) + 'font-size:0.7em;left:' + (toolStartX + (closeBtnH + toolGap) * 2) + 'px;';
        var _runDialectToggle = function() {
            var el = self._currentEl || document.activeElement;
            if (!el || !self._isEditable(el)) return;
            self._setDialectMode(el, dialectBtn.dataset.dialect !== '1');
            el.focus();
        };
        dialectBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        dialectBtn.addEventListener('click', _runDialectToggle);
        dialectBtn.addEventListener('touchend', function(e) { e.preventDefault(); _runDialectToggle(); });
        palette.appendChild(dialectBtn);

        // Render secondary (tanween) buttons above main row
        secBtns.forEach(function(b) {
            var btn = document.createElement('button');
            // Center the smaller button above the main button
            var secLeft = rowLeft + b.xOff + (bsz - 44) / 2;
            // In dialect mode (d151), show U+065D (flipped damma glyph from custom font)
            var shownDiac = b.diac;
            if (self._dialectActive && b.key === 'q' && b.diac === '\u064c') shownDiac = '\u065d';
            btn.innerHTML = '<span style="font-size:1.8em;line-height:1">\u0640' + shownDiac + '</span>';
            btn.style.cssText = btnCSS + secSz + 'left:' + secLeft + 'px;top:' + secRowTop + 'px;background:#fde68a;opacity:0.85;font-size:0.85em;';
            btn.setAttribute('data-dk-key', b.key);
            btn.setAttribute('data-dk-sec', '1');
            // Secondary buttons always trigger the long-press action (tanween/shadda)
            self._attachSecBtn(btn, b.key);
            palette.appendChild(btn);
        });

        // Render main QWES buttons
        topBtns.forEach(function(b) {
            var btn = document.createElement('button');
            // Show only the diacritic on a tatweel, large
            btn.innerHTML = '<span class="dk-main-label" style="font-size:2.5em;line-height:1">\u0640' + b.diac + '</span>';
            btn.title = b.letter;
            btn.style.cssText = btnCSS + mainSz + 'left:' + (rowLeft + b.xOff) + 'px;top:' + mainRowTop + 'px;';
            btn.setAttribute('data-dk-key', b.key);
            if (b.key === 'e') btn.setAttribute('data-dk-e', '1');
            self._attachBtn(btn, b.key);
            palette.appendChild(btn);
        });

        // S button (kasra) below input
        var sBtn = document.createElement('button');
        sBtn.innerHTML = '<span class="dk-main-label" style="font-size:2.5em;line-height:1">\u0640' + '\u0650' + '</span>';
        sBtn.title = 'S';
        sBtn.setAttribute('data-dk-key', 's');
        sBtn.style.cssText = btnCSS + mainSz + 'left:' + sLeft + 'px;top:' + sTop + 'px;';
        self._attachBtn(sBtn, 's');
        palette.appendChild(sBtn);

        // Kasratan button BELOW kasra
        var secSBtn = document.createElement('button');
        var secSLeft = sLeft + (bsz - 44) / 2;
        var _kasratayShown = self._dialectActive ? '\u065C' : '\u064D';
        secSBtn.innerHTML = '<span style="font-size:1.8em;line-height:1">\u0640' + _kasratayShown + '</span>';
        secSBtn.style.cssText = btnCSS + secSz + 'left:' + secSLeft + 'px;top:' + secSTop + 'px;background:#fde68a;opacity:0.85;font-size:0.85em;';
        secSBtn.setAttribute('data-dk-key', 's');
        secSBtn.setAttribute('data-dk-sec', '1');
        self._attachSecBtn(secSBtn, 's');
        palette.appendChild(secSBtn);

        // A/D navigation buttons — positioned to left and right of cursor, spaced away
        var navBtnCSS = 'position:fixed;pointer-events:auto;border:none;border-radius:50%;cursor:pointer;font-family:Arial,serif;-webkit-tap-highlight-color:transparent;box-shadow:0 2px 6px rgba(0,0,0,0.15);transition:transform 0.1s;background:#e0f2fe;color:#0369a1;display:flex;align-items:center;justify-content:center;width:36px;height:36px;font-size:1.2em;font-weight:bold;';
        var isPresenter = !!document.getElementById('lesson-viewer');
        var elRect = isPresenter ? el.getBoundingClientRect() : null;
        var navY = rect.top + rect.height / 2 - 18; // vertically centered with cursor
        var dBtnLeft, aBtnLeft;
        if (isPresenter && elRect && elRect.width > 0) {
            // Presenter mode: nav buttons outside the input field edges (RTL: → on right, ← on left)
            dBtnLeft = elRect.right + 12;
            // Extra space for qmark DK button if present — position left arrow to the left of it
            var qmarkDkBtn = document.getElementById('qmark-dk-btn');
            if (qmarkDkBtn && qmarkDkBtn.offsetWidth > 0) {
                var dkBtnRect = qmarkDkBtn.getBoundingClientRect();
                aBtnLeft = dkBtnRect.left - 44; // 36px button + 8px gap
            } else {
                aBtnLeft = elRect.left - 48;
            }
        } else {
            // Normal mode: nav buttons close to cursor
            var navSpacing = 60;
            dBtnLeft = rect.left + rect.width / 2 + navSpacing;
            aBtnLeft = rect.left + rect.width / 2 - navSpacing - 36;
        }
        if (this._docked) {
            // Docked: nav arrows flank the QWE row instead of the (off-screen) caret.
            navY = mainRowTop + bsz / 2 - 18;
            dBtnLeft = rowLeft + rowW + 12;
            aBtnLeft = rowLeft - 48;
            if (aBtnLeft < 4) aBtnLeft = 4;
            if (dBtnLeft + 36 > window.innerWidth - 4) dBtnLeft = window.innerWidth - 4 - 36;
        }

        // Right arrow (D = move left in RTL = previous letter)
        var dBtn = document.createElement('button');
        dBtn.innerHTML = '→';
        dBtn.title = 'D';
        dBtn.id = 'dk-nav-right';
        dBtn.style.cssText = navBtnCSS + 'left:' + dBtnLeft + 'px;top:' + navY + 'px;';
        dBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        dBtn.addEventListener('click', function() {
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) {
                self._moveCursor(el, -1);
                self._updatePaletteLabels();
                if (el.isContentEditable) self._showPalette(el);
                el.focus();
            }
        });
        palette.appendChild(dBtn);

        // Left arrow (A = move right in RTL = next letter)
        var aBtn = document.createElement('button');
        aBtn.innerHTML = '←';
        aBtn.title = 'A';
        aBtn.id = 'dk-nav-left';
        aBtn.style.cssText = navBtnCSS + 'left:' + aBtnLeft + 'px;top:' + navY + 'px;';
        aBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        aBtn.addEventListener('click', function() {
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) {
                self._moveCursor(el, 1);
                self._updatePaletteLabels();
                if (el.isContentEditable) self._showPalette(el);
                el.focus();
            }
        });
        palette.appendChild(aBtn);

        // In presenter mode, reposition ALL palette buttons when input field resizes/moves
        if (isPresenter && el) {
            var _paletteResizeHandler = function() {
                if (self._docked) return; // keep docked layout stable; don't re-anchor to caret
                var r = self._getCaretRect(el);
                var elR = el.getBoundingClientRect();
                if (elR.width <= 0) return;

                // Recalculate positions (same logic as initial placement)
                var _rowW = bsz * 3 + gap * 2;
                var _rowLeft = r.left + r.width / 2 - _rowW / 2;
                var _mainRowTop = r.top - bsz - 8;
                var _secRowTop = _mainRowTop - secH - secGap;
                var _closeRowTop = _secRowTop - closeBtnH - secGap;
                if (_closeRowTop < 4) { _closeRowTop = 4; _secRowTop = _closeRowTop + closeBtnH + secGap; _mainRowTop = _secRowTop + secH + secGap; }
                if (_rowLeft < 4) _rowLeft = 4;
                if (_rowLeft + _rowW > window.innerWidth - 4) _rowLeft = window.innerWidth - _rowW - 4;

                var _sLeft = r.left + r.width / 2 - bsz / 2;
                var _sTop = r.bottom + 8;
                var _secSTop = _sTop + bsz + secGap;
                if (_secSTop + secH > window.innerHeight - 4) _secSTop = window.innerHeight - secH - 4;
                if (_sTop + bsz > window.innerHeight - 4) _sTop = window.innerHeight - bsz - 4;
                if (_sLeft < 4) _sLeft = 4;

                // Update main QWE buttons
                var mainBtns = palette.querySelectorAll('[data-dk-key]:not([data-dk-sec])');
                mainBtns.forEach(function(b) {
                    var k = b.getAttribute('data-dk-key');
                    if (k === 's') {
                        b.style.left = _sLeft + 'px';
                        b.style.top = _sTop + 'px';
                    } else {
                        var xOff = k === 'q' ? 0 : k === 'w' ? (bsz + gap) : (bsz + gap) * 2;
                        b.style.left = (_rowLeft + xOff) + 'px';
                        b.style.top = _mainRowTop + 'px';
                    }
                });

                // Update secondary (tanween) buttons
                var secBtnsEl = palette.querySelectorAll('[data-dk-sec]');
                secBtnsEl.forEach(function(b) {
                    var k = b.getAttribute('data-dk-key');
                    if (k === 's') {
                        b.style.left = (_sLeft + (bsz - 44) / 2) + 'px';
                        b.style.top = _secSTop + 'px';
                    } else {
                        var xOff = k === 'q' ? 0 : k === 'w' ? (bsz + gap) : (bsz + gap) * 2;
                        b.style.left = (_rowLeft + xOff + (bsz - 44) / 2) + 'px';
                        b.style.top = _secRowTop + 'px';
                    }
                });

                // Update tool buttons (close, reset, dialect)
                var _toolTotalW = closeBtnH * 3 + 6 * 2;
                var _toolStartX = _rowLeft + _rowW / 2 - _toolTotalW / 2;
                var toolBtns = palette.querySelectorAll('button:not([data-dk-key]):not(#dk-nav-right):not(#dk-nav-left)');
                var toolIdx = 0;
                toolBtns.forEach(function(b) {
                    if (b.title === 'close' || b.title === 'reset letter' || b.id === 'dk-dialect-toggle') {
                        b.style.left = (_toolStartX + toolIdx * (closeBtnH + 6)) + 'px';
                        b.style.top = _closeRowTop + 'px';
                        toolIdx++;
                    }
                });

                // Update nav buttons
                var navR = document.getElementById('dk-nav-right');
                var navL = document.getElementById('dk-nav-left');
                var _navY = r.top + r.height / 2 - 18;
                if (navR) { navR.style.left = (elR.right + 12) + 'px'; navR.style.top = _navY + 'px'; }
                var _qDkBtn = document.getElementById('qmark-dk-btn');
                if (navL) {
                    var _aBtnL = elR.left - 48;
                    if (_qDkBtn && _qDkBtn.offsetWidth > 0) {
                        var _dkR = _qDkBtn.getBoundingClientRect();
                        _aBtnL = _dkR.left - 44;
                    }
                    navL.style.left = _aBtnL + 'px'; navL.style.top = _navY + 'px';
                }
            };
            el.addEventListener('input', _paletteResizeHandler);
            palette._navResizeCleanup = function() { el.removeEventListener('input', _paletteResizeHandler); };
        }

        // Shadda indicator — bold border on the secondary shadda button (above sukun)
        // Find the E secondary button and mark it for shadda indicator
        var secEBtns = palette.querySelectorAll('[data-dk-key="e"][data-dk-sec]');
        if (secEBtns.length) secEBtns[0].id = 'dk-shadda-btn';

        // Magnifier — always shown
        this._createMagnifier();

        this._palette = palette;
        document.body.appendChild(palette);

        // Persistence rule (Amitai 2026-05-19): dialect mode stays ON until user clicks 'מד'.
        // After palette is appended, if dialect is active but our input listener isn't bound
        // to this element (e.g. fresh page load, or palette opened on a new editable),
        // re-apply transform + re-attach the listener so the new element honors the persisted state.
        if (this._dialectActive && this._dialectListenerEl !== el) {
            this._toggleDialectMode(el, true);
        }
    },

    _createMagnifier: function() {
        // Inject the entrance-animation keyframes once. The magnifier "pops"
        // with a bounce and a short cyan glow when niqqud mode opens, so
        // students' eyes are drawn to it (Amitai 2026-06-06).
        if (!document.getElementById('dk-mag-anim-style')) {
            var st = document.createElement('style');
            st.id = 'dk-mag-anim-style';
            st.textContent =
                '@keyframes dkMagPop{' +
                '0%{transform:translateX(-50%) scale(0.25);opacity:0;}' +
                '55%{transform:translateX(-50%) scale(1.18);opacity:1;}' +
                '72%{transform:translateX(-50%) scale(0.92);}' +
                '86%{transform:translateX(-50%) scale(1.06);}' +
                '100%{transform:translateX(-50%) scale(1);opacity:1;}}' +
                '@keyframes dkMagGlow{' +
                '0%,100%{box-shadow:0 6px 20px rgba(0,0,0,0.18);}' +
                '50%{box-shadow:0 0 30px 4px rgba(8,145,178,0.70);}}';
            document.head.appendChild(st);
        }
        var existing = document.getElementById('dk-magnifier');
        if (existing) existing.remove();
        var el = this._currentEl || document.activeElement;
        var rect = el ? this._getCaretRect(el) : { top: 100 };
        var magTop = this._docked || rect.top > window.innerHeight * 0.35;
        var topOffset = 4;
        var mag = document.createElement('div');
        mag.id = 'dk-magnifier';
        // Slightly larger than before (Amitai 2026-06-06: "קצת יותר גדולה").
        var magFontSize = (typeof HindusMode !== 'undefined' && HindusMode.isActive()) ? '3.3em' : '2.4em';
        mag.style.cssText = 'position:fixed;' + (magTop ? 'top:' + topOffset + 'px' : 'bottom:8px') + ';left:50%;transform:translateX(-50%);background:white;border:3px solid #0891b2;border-radius:16px;padding:10px 24px;z-index:10001;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.18);font-family:"PlonterFlippedDiacritics",Arial,serif;font-size:' + magFontSize + ';line-height:1.2;direction:rtl;color:#1e293b;max-width:94vw;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform-origin:center top;animation:dkMagPop 0.55s cubic-bezier(0.18,0.89,0.32,1.28) both, dkMagGlow 0.9s ease-in-out 0.55s 2;';
        document.body.appendChild(mag);
        this._updateMagnifier();
    },

    _hidePalette: function() {
        if (this._palette) {
            if (this._palette._navResizeCleanup) this._palette._navResizeCleanup();
            this._palette.remove(); this._palette = null;
        }
        var mag = document.getElementById('dk-magnifier');
        if (mag) mag.remove();
    },

    // Take trailing slice of `s` containing up to `n` whitespace-separated whole words
    // (plus the active word's leading partial fragment, if `s` ends mid-word).
    _takeWordsBefore: function(s, n) {
        if (!s) return '';
        var parts = s.split(/(\s+)/);
        var wordCount = 0;
        var startIdx = parts.length;
        for (var i = parts.length - 1; i >= 0; i--) {
            var p = parts[i];
            var isWs = /^\s+$/.test(p);
            if (!isWs && p.length > 0) wordCount++;
            if (wordCount > n + 1) break;
            startIdx = i;
        }
        return parts.slice(startIdx).join('');
    },

    // Take leading slice of `s` containing up to `n` whitespace-separated whole words
    // (plus the active word's trailing partial fragment, if `s` starts mid-word).
    _takeWordsAfter: function(s, n) {
        if (!s) return '';
        var parts = s.split(/(\s+)/);
        var wordCount = 0;
        var endIdx = 0;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            var isWs = /^\s+$/.test(p);
            if (!isWs && p.length > 0) wordCount++;
            if (wordCount > n + 1) break;
            endIdx = i + 1;
        }
        return parts.slice(0, endIdx).join('');
    },

    // Thicken niqqud in the magnifier so the marks visibly stand out from
    // the base letters. Amitai 2026-05-17 iteration: NO red — keep niqqud in
    // the same color as the surrounding letter, just much heavier. Stack
    // -webkit-text-stroke + font-weight:900 + cardinal text-shadows so the
    // glyph renders bold regardless of font support for combining-mark weight.
    _emphasizeDiac: function(s) {
        if (!s) return '';
        // Do NOT wrap the combining marks in their own <span>: a combining
        // diacritic in a separate inline element detaches from its base-letter
        // glyph cluster, so the shaper loses the GPOS mark anchor and the niqqud
        // drifts (Amitai 2026-06-04 — "הניקוד זז שמאלה"). Keep base+mark as one
        // cluster so the niqqud sits directly over its letter; magnification
        // comes from the magnifier's large font-size, not from bolding marks.
        return s;
    },

    // Update magnifier with the current word, highlighting the active letter
    _updateMagnifier: function() {
        var mag = document.getElementById('dk-magnifier');
        if (!mag) return;
        var el = this._currentEl || document.activeElement;
        if (!el || !this._isEditable(el)) { mag.textContent = ''; return; }

        var text, pos;
        if (el.isContentEditable) {
            var info = this._getCEInfo();
            if (!info) { mag.textContent = ''; return; }
            text = info.text; pos = info.pos;
        } else {
            text = el.value || ''; pos = el.selectionStart || 0;
        }

        if (!text) { mag.textContent = ''; return; }

        // Find current letter
        var li = this._findLetter(text, pos);
        if (!li) {
            // No active letter — fall back to a wider word-based window so user
            // still sees sentence-level context. Use a faded gray COLOR instead
            // of opacity so niqqud spans (with their own explicit dark color)
            // keep full visibility.
            var fbBefore = this._takeWordsBefore(text.slice(0, pos), 3);
            var fbAfter = this._takeWordsAfter(text.slice(pos), 3);
            mag.innerHTML = '<span style="color:#94a3b8">' + this._emphasizeDiac(fbBefore + fbAfter) + '</span>';
            return;
        }

        var highlightStart = li.baseIdx;

        // Find FULL active-word boundaries (whitespace-delimited) so the entire
        // current word renders un-faded — not just the active letter (Amitai
        // 2026-05-17: "אני רוצה שכל המילה שאני עליה תהיה לא שקופה").
        var wsRe = /[\s\n\r\t]/;
        var wordStart = highlightStart;
        while (wordStart > 0 && !wsRe.test(text[wordStart - 1])) wordStart--;
        var wordEnd = li.endIdx;
        while (wordEnd < text.length && !wsRe.test(text[wordEnd])) wordEnd++;

        var contextBefore = this._takeWordsBefore(text.slice(0, wordStart), 3);
        var contextAfter = this._takeWordsAfter(text.slice(wordEnd), 3);
        var wordLeft = text.slice(wordStart, highlightStart);   // active word, BEFORE active letter
        var wordRight = text.slice(li.endIdx, wordEnd);          // active word, AFTER active letter
        var letter = text.slice(highlightStart, li.endIdx);
        var sepBefore = contextBefore ? ' ' : '';
        var sepAfter = contextAfter ? ' ' : '';

        mag.innerHTML =
            '<span style="color:#94a3b8">' + this._emphasizeDiac(contextBefore) + sepBefore + '</span>' +
            '<span style="color:#1e293b">' + this._emphasizeDiac(wordLeft) + '</span>' +
            '<span style="color:#0891b2;text-decoration:underline;text-decoration-color:#0891b2;text-underline-offset:4px">' + this._emphasizeDiac(letter) + '</span>' +
            '<span style="color:#1e293b">' + this._emphasizeDiac(wordRight) + '</span>' +
            '<span style="color:#94a3b8">' + sepAfter + this._emphasizeDiac(contextAfter) + '</span>';
    },

    // Map diacritic unicode to button key + whether it's secondary
    _DIAC_TO_KEY: null,
    _initDiacToKey: function() {
        if (this._DIAC_TO_KEY) return;
        this._DIAC_TO_KEY = {};
        this._DIAC_TO_KEY[this.FATHA] = { key: 'w', sec: false };
        this._DIAC_TO_KEY[this.KASRA] = { key: 's', sec: false };
        this._DIAC_TO_KEY[this.DAMMA] = { key: 'q', sec: false };
        this._DIAC_TO_KEY[this.SUKUN] = { key: 'e', sec: false };
        this._DIAC_TO_KEY[this.FATHATAN] = { key: 'w', sec: true };
        this._DIAC_TO_KEY[this.KASRATAN] = { key: 's', sec: true };
        this._DIAC_TO_KEY[this.DAMMATAN] = { key: 'q', sec: true };
        this._DIAC_TO_KEY[this.SHADDA] = { key: 'e', sec: true };
    },

    _updatePaletteHighlight: function() {
        if (!this._palette || !this._active) return;
        this._initDiacToKey();
        var el = this._currentEl || document.activeElement;
        var li = el ? this._getLetterInfo(el) : null;

        // Reset all button borders
        var allBtns = this._palette.querySelectorAll('[data-dk-key]');
        for (var i = 0; i < allBtns.length; i++) {
            allBtns[i].style.border = 'none';
            allBtns[i].style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
        }

        if (!li) return;

        // Alef form highlighting on secondary buttons
        if (this.ALEF_RE.test(li.baseLetter)) {
            var alefMap = { '\u0627': 's', '\u0622': 'w', '\u0671': 'q' }; // bare=s, madda=w, wasla=q
            var alefKey = alefMap[li.baseLetter];
            if (alefKey) {
                var secBtn = this._palette.querySelector('[data-dk-key="' + alefKey + '"][data-dk-sec]');
                if (secBtn) {
                    secBtn.style.border = '3px solid #3b82f6';
                    secBtn.style.boxShadow = '0 0 8px rgba(59,130,246,0.5)';
                }
            }
            // أ (hamza above) → highlight based on diacritics below
            // إ (hamza below) → highlight 's' primary
            if (li.baseLetter === '\u0625') { // إ
                var sBtn = this._palette.querySelector('[data-dk-key="s"]:not([data-dk-sec])');
                if (sBtn) { sBtn.style.border = '3px solid #0891b2'; sBtn.style.boxShadow = '0 0 8px rgba(8,145,178,0.4)'; }
            }
        }

        if (!li.diacritics) return;

        // Highlight buttons matching current diacritics
        var hasShadda = li.diacritics.indexOf(this.SHADDA) >= 0;
        for (var j = 0; j < li.diacritics.length; j++) {
            var d = li.diacritics[j];
            var mapping = this._DIAC_TO_KEY[d];
            if (!mapping) continue;
            var selector = '[data-dk-key="' + mapping.key + '"]' + (mapping.sec ? '[data-dk-sec]' : ':not([data-dk-sec])');
            var btn = this._palette.querySelector(selector);
            if (btn) {
                btn.style.border = '3px solid #0891b2';
                btn.style.boxShadow = '0 0 8px rgba(8,145,178,0.4)';
            }
        }

        // Shadda memory indicator on secondary E button
        var remembered = li && this._shaddaMemory[li.baseIdx];
        var shaddaBtn = document.getElementById('dk-shadda-btn');
        if (shaddaBtn && (hasShadda || remembered) && !li.diacritics.indexOf(this.SHADDA) >= 0) {
            // Already highlighted by the loop above if shadda is in diacritics
            if (remembered && !hasShadda) {
                shaddaBtn.style.border = '3px solid #f59e0b';
                shaddaBtn.style.boxShadow = '0 0 8px rgba(245,158,11,0.4)';
            }
        }
    },

    _updatePaletteShaddaIndicator: function() {
        this._updatePaletteHighlight();
    },

    // Labels for palette buttons — diacritic-only (no letter prefix)
    // Regular: ـَ | ـُ | ـْ | ـِ
    // Alef:   أَ | أُ | أْ | إِ
    _LABELS_REGULAR: {
        'q': { main: '\u0640\u064F' },  // damma
        'w': { main: '\u0640\u064E' },  // fatha
        'e': { main: '\u0640\u0652' },  // sukun
        's': { main: '\u0640\u0650' },  // kasra
    },
    _LABELS_REGULAR_SEC: {
        'q': { main: '\u0640\u064C' },  // dammatan
        'w': { main: '\u0640\u064B' },  // fathatan
        'e': { main: '\u0640\u0651' },  // shadda
        's': { main: '\u0640\u064D' },  // kasratan
    },
    _LABELS_ALEF: {
        'q': { main: '\u0623\u064F' },  // hamza+damma
        'w': { main: '\u0623\u064E' },  // hamza+fatha
        'e': { main: '\u0623\u0652' },  // hamza+sukun
        's': { main: '\u0625\u0650' },  // hamza below+kasra
    },
    _LABELS_ALEF_SEC: {
        'q': { main: '\u0671' },        // alef wasla
        'w': { main: '\u0622' },        // alef madda
        'e': { main: '\u0651' },        // shadda
        's': { main: '\u0627' },        // bare alef
    },

    // Returns true when the current letter is followed (in string order = visually to the left
    // in RTL) by a base Arabic letter that isn't an alef variant.
    _nextLetterIsNonAlefArabic: function(el, li) {
        var text;
        if (el.isContentEditable) {
            var info = this._getCEInfo();
            text = info ? info.text : '';
        } else {
            text = el.value || '';
        }
        if (!li) return false;
        var ARABIC_LETTER_RE = /[\u0621-\u064A\u0671]/;
        for (var i = li.endIdx; i < text.length; i++) {
            var ch = text[i];
            if (this.DIAC_RE.test(ch)) continue;
            if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') return false;
            if (!ARABIC_LETTER_RE.test(ch)) return false;
            return !this.ALEF_RE.test(ch);
        }
        return false;
    },

    _updatePaletteLabels: function() {
        if (!this._palette || !this._active) return;
        var el = this._currentEl || document.activeElement;
        if (!el || !this._isEditable(el)) return;
        this._updatePaletteShaddaIndicator();
        this._updateMagnifier();
        var li = this._getLetterInfo(el);
        var isAlef = li && this.ALEF_RE.test(li.baseLetter);
        var labels = isAlef ? this._LABELS_ALEF : this._LABELS_REGULAR;
        var secLabels = isAlef ? this._LABELS_ALEF_SEC : this._LABELS_REGULAR_SEC;
        var bgColor = isAlef ? '#dbeafe' : '#fef9c3'; // blue tint for alef, yellow for regular
        var secBgColor = isAlef ? '#bfdbfe' : '#fde68a';
        // Dynamic W secondary label: dagger alef when next-letter is non-alef Arabic, else fathatan
        var useDagger = !isAlef && li && this._nextLetterIsNonAlefArabic(el, li);
        var btns = this._palette.querySelectorAll('[data-dk-key]');
        for (var i = 0; i < btns.length; i++) {
            var key = btns[i].getAttribute('data-dk-key');
            var isSec = btns[i].hasAttribute('data-dk-sec');
            var labelSet = isSec ? secLabels : labels;
            if (labelSet[key]) {
                var labelSpan = btns[i].querySelector('.dk-main-label') || btns[i].querySelector('span');
                var labelText = labelSet[key].main;
                // Override W secondary when dagger-alef mode is active
                if (isSec && key === 'w' && useDagger) {
                    labelText = '\u0640\u0670'; // tatweel + dagger alef
                }
                // Dialect mode (d151): show U+065C/U+065D on kasratayn/dammatayn secondary buttons.
                if (this._dialectActive && isSec && !isAlef) {
                    if (key === 's') labelText = '\u0640\u065c';
                    else if (key === 'q') labelText = '\u0640\u065d';
                }
                // Dialect mode + alef SECONDARY S: flipped kasra on the إ-form
                // (Amitai 2026-06-04 \u2014 moved here from the main button).
                if (this._dialectActive && isSec && isAlef && key === 's') {
                    labelText = '\u0625\u065c'; // alef-hamza-below + flipped kasra
                }
                // Dialect mode + alef-mode primary: q swaps damma for flipped variant.
                // 's' (kasra) now stays REGULAR \u0625\u0650 on the main button
                // (Amitai 2026-06-04) \u2014 flipped kasra lives on the secondary button.
                if (this._dialectActive && !isSec && isAlef) {
                    if (key === 'q') labelText = '\u0623\u065d';      // alef-hamza + flipped damma
                }
                if (labelSpan) labelSpan.textContent = labelText;
                btns[i].style.background = isSec ? secBgColor : bgColor;
            }
        }
    },

    // Attach mouse + touch long-press to main QWES buttons
    _attachBtn: function(btn, key) {
        var self = this;
        btn.addEventListener('touchstart', function(e) { e.preventDefault(); }, { passive: false });

        var longTimer = null, longFired = false;

        // Touch: long-press detection
        btn.addEventListener('touchstart', function() {
            longFired = false;
            longTimer = setTimeout(function() {
                longFired = true;
                var el = self._currentEl || document.activeElement;
                if (el && self._isEditable(el)) { self._handleLong(el, key); el.focus(); self._updatePaletteLabels(); }
                btn.style.transform = 'scale(1.1)';
                setTimeout(function() { btn.style.transform = ''; }, 200);
            }, self._LP_MS);
        }, { passive: false });

        btn.addEventListener('touchend', function(ev) {
            ev.preventDefault();
            if (longTimer) { clearTimeout(longTimer); longTimer = null; }
            if (longFired) return;
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) { self._handleShort(el, key); el.focus(); self._updatePaletteLabels(); }
            btn.style.transform = 'scale(0.95)';
            setTimeout(function() { btn.style.transform = ''; }, 100);
        }, { passive: false });

        // Mouse: long-press detection (mousedown/mouseup)
        var mouseLongTimer = null, mouseLongFired = false;

        btn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            mouseLongFired = false;
            mouseLongTimer = setTimeout(function() {
                mouseLongFired = true;
                var el = self._currentEl || document.activeElement;
                if (el && self._isEditable(el)) { self._handleLong(el, key); el.focus(); self._updatePaletteLabels(); }
                btn.style.transform = 'scale(1.1)';
                setTimeout(function() { btn.style.transform = ''; }, 200);
            }, self._LP_MS);
        });

        btn.addEventListener('mouseup', function() {
            if (mouseLongTimer) { clearTimeout(mouseLongTimer); mouseLongTimer = null; }
            if (mouseLongFired) { mouseLongFired = false; return; }
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) { self._handleShort(el, key); el.focus(); self._updatePaletteLabels(); }
            btn.style.transform = 'scale(0.95)';
            setTimeout(function() { btn.style.transform = ''; }, 100);
        });

        btn.addEventListener('mouseleave', function() {
            if (mouseLongTimer) { clearTimeout(mouseLongTimer); mouseLongTimer = null; }
            mouseLongFired = false;
        });
    },

    // Attach click to secondary (tanween) buttons — always triggers long-press action
    _attachSecBtn: function(btn, key) {
        var self = this;
        btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        btn.addEventListener('touchstart', function(e) { e.preventDefault(); }, { passive: false });

        btn.addEventListener('click', function() {
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) { self._handleLong(el, key); el.focus(); self._updatePaletteLabels(); }
            btn.style.transform = 'scale(0.95)';
            setTimeout(function() { btn.style.transform = ''; }, 100);
        });

        btn.addEventListener('touchend', function(ev) {
            ev.preventDefault();
            var el = self._currentEl || document.activeElement;
            if (el && self._isEditable(el)) { self._handleLong(el, key); el.focus(); self._updatePaletteLabels(); }
            btn.style.transform = 'scale(0.95)';
            setTimeout(function() { btn.style.transform = ''; }, 100);
        });
    },
};

DiacriticsKeyboard.init();
