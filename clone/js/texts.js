// PlonterTexts — fullscreen text editor for Arabic texts
var PlonterTexts = {
    STORAGE_KEY: 'plonter_texts',
    SEED_KEY: 'plonter_texts_demo_seeded',
    GUEST_SHADOW_KEY: 'plonter_text_guest_backup_v1',
    GUEST_HANDLED_KEY: 'plonter_text_guest_backup_handled_v1',
    CATEGORY_FILTER_KEY: 'plonter_text_category_filter_v1',
    FOCUS_KEY: 'plonter_text_focus_v1',
    DEMO_CONTENT:
        '<div style="font-size:1.15em;font-weight:bold;text-align:center">&quot;النواب الأمريكي&quot; يصوت لصالح فرض عقوبات على الجنائية الدولية</div>' +
        '<div><br></div>' +
        '<div>5.6.24 – سكاي نيوز - صوّت مجلس النواب الأميركي الثلاثاء لصالح فرض عقوبات على المحكمة الجنائية الدولية بعد أن طلب مدعيها (مدعي = תובע) العام, كريم خان, إصدار مذكرات اعتقال بحق رئيس الوزراء الإسرائيلي بنيامين نتنياهو ومسؤولين آخرين بتهمة ارتكاب جرائم حرب في غزة.</div>' +
        '<div><br></div>' +
        '<div><b>הערה 1:</b> בית הדין הפלילי הבינלאומי (ICC) הוא בית משפט בינלאומי היושב בעיר האג שבהולנד ועוסק באחריותם הפלילית של יחידים לארבעה סוגי פשעים: פשעי השמדת עם, פשעים נגד האנושות, פשעי מלחמה ופשע תוקפנות. כחלק מבית הדין פועל התובע הכללי של בית הדין, שתפקידו לחקור חשדות לביצוע הפשעים שתוארו לעיל, ובהתאם להגיש תביעות לבית הדין.</div>' +
        '<div><br></div>' +
        '<div><b>הערה 2:</b> הקונגרס של ארצות הברית הוא הפרלמנט שלה (קרי הרשות המחוקקת), ומורכב משני גופים: הבית העליון שהוא הסנאט, והבית התחתון שהוא בית הנבחרים.</div>',
    _getAll: function() {
        var all = [];
        try { all = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); } catch (_) { all = []; }
        return this._normalizeTexts(all);
    },
    _normalizeTexts: function(texts) {
        var self = this;
        var seen = {};
        var out = [];
        (texts || []).forEach(function(t) {
            if (!t || typeof t !== 'object') return;
            t = self._ensureTextContract(t);
            if (!self._hasMeaningfulContent(t) && !t.title && !t.desc && !t._isBuiltinSeed && self._isStaleEmptyDraft(t)) return;
            var sig = self._textSignature(t);
            if (seen[sig]) return;
            seen[sig] = true;
            out.push(t);
        });
        // Second pass: collapse all demo copies (including server round-trip copies that
        // lost their builtin flag) to exactly one instance. Prefer the genuine builtin.
        var keptDemo = null;
        out.forEach(function(t) {
            if (!self._isDemoText(t)) return;
            if (keptDemo === null) { keptDemo = t; return; }
            if (self._isBuiltinText(t) && !self._isBuiltinText(keptDemo)) keptDemo = t;
        });
        if (keptDemo !== null) {
            out = out.filter(function(t) {
                if (!self._isDemoText(t)) return true;
                return t === keptDemo;
            });
        }
        return out;
    },
    _isBuiltinText: function(t) {
        if (!t) return false;
        return t._isBuiltinSeed === true || (typeof t.id === 'string' && t.id.indexOf('txt_demo_') === 0);
    },
    _isDemoText: function(t) {
        if (!t) return false;
        if (this._isBuiltinText(t)) return true;
        // content-identical copy that lost its builtin flag/id via a server round-trip
        var title = (t.title || '').trim();
        var desc = (t.desc || '').trim();
        return title === 'דוגמה — סנקציות על ICC'
            && desc === 'מליאת הנבחרים האמריקאית מצביעה'
            && this._plainText(t.content) === this._plainText(this.DEMO_CONTENT);
    },
    _ensureTextContract: function(t) {
        if (!t.id) t.id = 'txt_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        var now = new Date().toISOString();
        if (!t.created) t.created = t.updated || now;
        if (!t.updated) t.updated = t.created || now;
        if (!t.type) t.type = 'text';
        if (!t.module) t.module = 'texts';
        if (!t.local_id) t.local_id = t.id;
        if (t.source_id == null) t.source_id = this._isBuiltinText(t) ? t.id : t.local_id;
        if (!t.source_type) t.source_type = this._isBuiltinText(t) ? 'builtin_text' : 'user_text';
        if (!t.source_domain) t.source_domain = 'text';
        if (!t.owner) t.owner = t._createdAsGuest ? 'guest' : 'account';
        t.category = this._textCategory(t);
        t.meta = Object.assign({}, t.meta || {}, {
            owner: t.owner,
            module: t.module,
            type: t.type,
            local_id: t.local_id,
            source_id: t.source_id,
            source_type: t.source_type,
            source_domain: t.source_domain,
            category: t.category
        });
        return t;
    },
    _escapeHtml: function(value) {
        return String(value || '').replace(/[&<>"']/g, function(ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    },
    _textCategory: function(t) {
        var cat = (t && (t.category || t.topic || t.group || t.collection) || '').trim();
        if (cat) return cat;
        return this._isBuiltinText(t) ? 'דוגמאות' : 'טקסטים שלי';
    },
    _categoryOptions: function(texts) {
        var seen = {};
        var out = [];
        var self = this;
        (texts || []).forEach(function(t) {
            var cat = self._textCategory(t);
            if (seen[cat]) return;
            seen[cat] = true;
            out.push(cat);
        });
        return out.sort(function(a, b) { return a.localeCompare(b, 'he'); });
    },
    _renderCategoryFilter: function(container, categories, activeCategory) {
        if (!container || !categories || !categories.length) return;
        var self = this;
        var wrap = document.createElement('div');
        wrap.className = 'text-category-filter';
        wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:4px 0 12px;direction:rtl';
        [['', 'הכל']].concat(categories.map(function(cat) { return [cat, cat]; })).forEach(function(pair) {
            var key = pair[0];
            var active = (activeCategory || '') === key;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = pair[1];
            btn.style.cssText = 'padding:7px 12px;border-radius:999px;border:1px solid ' + (active ? '#0d9488' : '#cbd5e1') + ';background:' + (active ? '#ccfbf1' : '#fff') + ';color:' + (active ? '#0f766e' : '#475569') + ';font-weight:800;cursor:pointer;font-size:.86em';
            btn.onclick = function() {
                if (key) localStorage.setItem(self.CATEGORY_FILTER_KEY, key);
                else localStorage.removeItem(self.CATEGORY_FILTER_KEY);
                self.renderList();
            };
            wrap.appendChild(btn);
        });
        container.appendChild(wrap);
    },
    _textStatusLabel: function(text) {
        if (this._isBuiltinText(text)) return 'דוגמה';
        if (text && text.source_type === 'builtin_text') return 'נוצר מדוגמה';
        if (text && (text._createdAsGuest === true || text.owner === 'guest' || text.backup_state === 'not_backed_up')) return 'לא מגובה';
        try {
            if (typeof ContentSync !== 'undefined' && typeof ContentSync.getSyncState === 'function') {
                var state = ContentSync.getSyncState('text', text.id);
                if (state === 'pending') return 'בתהליך גיבוי...';
                if (state === 'unsynced') return 'לא מגובה';
            }
        } catch (_) {}
        return 'מגובה';
    },
    _isRecentText: function(text) {
        var stamp = Date.parse(text && (text.lastAccessed || text.updated || text.created) || 0);
        return !!stamp && (Date.now() - stamp) < 14 * 24 * 60 * 60 * 1000;
    },
    _renderContinueWork: function(container, texts) {
        if (!container || !texts || !texts.length) return;
        var self = this;
        var candidates = texts.filter(function(t) {
            if (!t || self._isBuiltinText(t) || !self._hasMeaningfulContent(t)) return false;
            var status = self._textStatusLabel(t);
            return status !== 'מגובה' || t.source_type === 'builtin_text' || self._isRecentText(t);
        }).slice(0, 4);
        if (!candidates.length) return;
        var section = document.createElement('div');
        section.className = 'text-continue-work';
        section.style.cssText = 'margin:4px 0 12px;direction:rtl';
        var title = document.createElement('div');
        title.textContent = 'המשך עבודה';
        title.style.cssText = 'font-size:.95em;font-weight:900;color:#0f766e;margin:0 0 8px';
        section.appendChild(title);
        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px';
        candidates.forEach(function(text) {
            var card = document.createElement('button');
            card.type = 'button';
            card.style.cssText = 'text-align:right;border:1px solid #99f6e4;border-right:4px solid #0d9488;background:#f0fdfa;border-radius:8px;padding:9px 10px;cursor:pointer;min-height:66px;font-family:inherit;color:#0f172a';
            card.innerHTML =
                '<div style="display:flex;gap:6px;align-items:center;justify-content:space-between;margin-bottom:5px">' +
                '  <b style="font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + self._escapeHtml(text.title || 'טקסט ללא כותרת') + '</b>' +
                '  <span style="font-size:.72em;font-weight:800;background:#fff;color:#0f766e;border:1px solid #99f6e4;border-radius:999px;padding:1px 7px;white-space:nowrap">' + self._escapeHtml(self._textStatusLabel(text)) + '</span>' +
                '</div>' +
                '<div style="font-size:.76em;color:#0f766e;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + self._escapeHtml(self._textCategory(text)) + '</div>' +
                '<div style="font-size:.78em;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + self._escapeHtml(self._plainText(text.content).slice(0, 70)) + '</div>';
            card.onclick = function() { self.openEditor(text.id); };
            grid.appendChild(card);
        });
        section.appendChild(grid);
        container.appendChild(section);
    },
    _requestFocus: function(text) {
        if (!text || !text.id) return;
        try {
            sessionStorage.setItem(this.FOCUS_KEY, JSON.stringify({
                id: text.id,
                category: this._textCategory(text),
                at: Date.now()
            }));
        } catch (_) {}
    },
    _consumeFocus: function() {
        try {
            var raw = sessionStorage.getItem(this.FOCUS_KEY);
            if (!raw) return null;
            var focus = JSON.parse(raw);
            sessionStorage.removeItem(this.FOCUS_KEY);
            if (!focus || !focus.id || !focus.category) return null;
            if (Date.now() - (focus.at || 0) > 30000) return null;
            return focus;
        } catch (_) {
            try { sessionStorage.removeItem(this.FOCUS_KEY); } catch (_) {}
            return null;
        }
    },
    _applyFocusHighlight: function(el) {
        if (!el) return;
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        el.style.boxShadow = '0 0 0 3px rgba(13,148,136,0.22), 0 0 18px rgba(13,148,136,0.28)';
        el.style.transform = 'translateY(-1px)';
        setTimeout(function() {
            el.style.boxShadow = '';
            el.style.transform = '';
        }, 2800);
    },
    _plainText: function(htmlOrText) {
        if (!htmlOrText) return '';
        var tmp = document.createElement('div');
        var html = String(htmlOrText)
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<(div|p|h[1-6]|li|section|article|blockquote|pre)(\s[^>]*)?>/gi, ' ')
            .replace(/<\/(div|p|h[1-6]|li|section|article|blockquote|pre)>/gi, ' ');
        tmp.innerHTML = html;
        return (tmp.innerText || tmp.textContent || '').replace(/\s+/g, ' ').trim();
    },
    _hasMeaningfulContent: function(t) {
        if (!t) return false;
        if (this._plainText(t.content).length > 0) return true;
        return !!(t.drawings && t.drawings.length);
    },
    _isStaleEmptyDraft: function(t) {
        var stamp = Date.parse(t.updated || t.created || 0);
        if (!stamp) return false;
        return Date.now() - stamp > 24 * 60 * 60 * 1000;
    },
    _textSignature: function(t) {
        return [
            (t.title || '').trim(),
            (t.desc || '').trim(),
            this._textCategory(t),
            this._plainText(t.content),
            JSON.stringify(t.drawings || [])
        ].join('|');
    },
    _sameTextContent: function(a, b) {
        return this._textSignature(a) === this._textSignature(b);
    },
    _copyBuiltinForEditing: function(text) {
        if (!this._isBuiltinText(text)) return text;
        var oldId = text.id;
        var loggedIn = typeof ContentSync !== 'undefined' &&
            typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
        text.id = 'txt_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        text.local_id = text.id;
        text.source_id = oldId;
        text.source_type = 'builtin_text';
        text.source_domain = 'text';
        text.source_title = text.title || '';
        text.category = this._textCategory(text);
        text.owner = loggedIn ? 'account' : 'guest';
        text.type = 'text';
        text.module = 'texts';
        text._guestWorkingCopy = !loggedIn;
        if (!loggedIn) text.backup_state = text.backup_state || 'pending';
        delete text._isBuiltinSeed;
        if (loggedIn) delete text._createdAsGuest;
        else text._createdAsGuest = true;
        text.created = new Date().toISOString();
        text.updated = text.created;
        text.meta = {
            owner: text.owner,
            module: text.module,
            type: text.type,
            local_id: text.local_id,
            source_id: text.source_id,
            source_type: text.source_type,
            source_domain: text.source_domain,
            category: text.category
        };
        return text;
    },
    _upsertReplacingId: function(all, oldId, text) {
        var cleaned = (all || []).filter(function(t) { return t && t.id !== oldId && t.id !== text.id; });
        cleaned.unshift(text);
        return cleaned;
    },
    _saveAll: function(texts) {
        texts = this._normalizeTexts(texts);
        // Detect which texts actually changed so we only auto-queue those
        // for server sync. Skip guest-created items with no prior meta —
        // they stay yellow until the user opts in via the backup popup or
        // per-item ☁️.
        var changedIds = this._detectChangedIds(texts);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(texts));
        if (!changedIds.length) return;
        if (typeof ContentSync === 'undefined' ||
            typeof ContentSync.save !== 'function' ||
            typeof ContentSync.isLoggedIn !== 'function' ||
            !ContentSync.isLoggedIn()) return;
        for (var i = 0; i < changedIds.length; i++) {
            var t = texts.find(function(x) { return x.id === changedIds[i]; });
            if (!t) continue;
            if (this._isBuiltinText(t)) continue;   // built-in demo/seed is local-only — never sync (intent: L384-386)
            var guestDraft = t._createdAsGuest === true;
            var hasMeta = false;
            try {
                hasMeta = !!(ContentSync.isSynced && ContentSync.isSynced('text', t.id));
                if (!hasMeta && typeof ContentSync.getSyncState === 'function') {
                    hasMeta = ContentSync.getSyncState('text', t.id) !== 'unsynced';
                }
            } catch (_) {}
            if (guestDraft && !hasMeta) continue;
            try { ContentSync.save('text', t.id, t); }
            catch (syncErr) { console.warn('[texts] ContentSync.save threw', syncErr); }
        }
    },
    _detectChangedIds: function(newTexts) {
        function strip(t) {
            // lastAccessed flips on every open; don't treat it as a content
            // change or we'd re-queue sync on every view.
            var copy = {};
            for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k) && k !== 'lastAccessed') copy[k] = t[k];
            return copy;
        }
        try {
            var prev = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
            var prevMap = {};
            for (var i = 0; i < prev.length; i++) if (prev[i] && prev[i].id) prevMap[prev[i].id] = prev[i];
            var changed = [];
            for (var j = 0; j < newTexts.length; j++) {
                var n = newTexts[j];
                if (!n || !n.id) continue;
                var p = prevMap[n.id];
                if (!p) { changed.push(n.id); continue; }
                if (JSON.stringify(strip(p)) !== JSON.stringify(strip(n))) changed.push(n.id);
            }
            return changed;
        } catch (_) {
            return (newTexts || []).map(function(t) { return t && t.id; }).filter(Boolean);
        }
    },
    // Built-in/demo texts are bundled content, not user content. Keep them
    // local until the user actually edits one; _copyBuiltinForEditing then
    // turns it into a normal user-owned copy that may be backed up.
    _autoBackupBuiltinSeedsOnLogin: function() {
        this.renderList();
    },

    _manualBackupText: async function(text) {
        if (typeof ContentSync === 'undefined') return;
        try {
            if (typeof ContentSync.save === 'function') {
                try { ContentSync.save('text', text.id, text); } catch (_) {}
            }
            var res = typeof ContentSync.syncNow === 'function'
                ? await ContentSync.syncNow('text', text.id)
                : { success: false, error: 'syncNow לא זמין' };
            if (res && res.success) {
                if (typeof MessageManager !== 'undefined') MessageManager.show('\u05D4\u05D8\u05E7\u05E1\u05D8 \u05D2\u05D5\u05D1\u05D4 \u05DC\u05E9\u05E8\u05EA \u2713', 'success');
            } else {
                if (typeof MessageManager !== 'undefined') MessageManager.show('\u05D4\u05D2\u05D9\u05D1\u05D5\u05D9 \u05E0\u05DB\u05E9\u05DC: ' + ((res && res.error) || '\u05E9\u05D2\u05D9\u05D0\u05D4'), 'error');
            }
        } catch (e) { console.error('[texts] manualBackupText failed', e); }
        this.renderList();
    },

    _uniquifyOnTitleDesc: function(title, desc, excludeId) {
        var all = this._getAll();
        var collides = function(t) {
            return all.some(function(x) { return x.id !== excludeId && x.title === t && (x.desc || '') === (desc || ''); });
        };
        if (!collides(title)) return title;
        var n = 2;
        while (collides(title + ' ' + n)) n++;
        return title + ' ' + n;
    },
    _seedDemoIfEmpty: function() {
        var all = this._getAll();
        var loggedIn = typeof ContentSync !== 'undefined' &&
            typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
        // Amitai 2026-04-19 09:38: guests should always see the demo
        // teaser directly — no "רוצים טקסטים? לחצו כאן" CTA step. Drop
        // the SEED_KEY gate in guest mode so a previously-deleted demo
        // auto-reappears when the list is empty.
        if (!loggedIn) {
            if (all.length === 0) this._insertDemo(all);
            return;
        }
        if (localStorage.getItem(this.SEED_KEY)) return;
        if (all.length === 0) {
            this._insertDemo(all);
        }
        localStorage.setItem(this.SEED_KEY, '1');
    },
    _insertDemo: function(all) {
        var now = new Date().toISOString();
        all.push({
            id: 'txt_demo_' + Date.now(),
            title: 'דוגמה — סנקציות על ICC',
            desc: 'מליאת הנבחרים האמריקאית מצביעה',
            category: 'דוגמאות',
            content: this.DEMO_CONTENT,
            // Flag so ContentSync's migration popup + sync queue
            // skip this seed on login — Amitai 2026-04-19 07:40 got
            // "יש לך 1 טקסטים לא מגובים" pointing at this demo.
            // Once he edits it via _showSaveDialog the flag is
            // stripped and it becomes a normal synced item.
            _isBuiltinSeed: true,
            source_domain: 'text',
            source_type: 'builtin_text',
            created: now,
            updated: now
        });
        this._saveAll(all);
    },
    // Called from the empty-state CTA teaser — Amitai 2026-04-19 08:24
    // variant (ג). Skips the SEED_KEY gate so a user who deleted all
    // their texts (emptying the list + bypassing the auto-seed) can
    // re-summon the demo on demand.
    loadDemoTexts: function() {
        localStorage.removeItem(this.SEED_KEY);
        this._seedDemoIfEmpty();
        this.renderList();
    },
    stashGuestShadow: function() {
        var all = this._getAll();
        var keep = [];
        try { keep = JSON.parse(localStorage.getItem(this.GUEST_SHADOW_KEY) || '[]'); } catch (_) { keep = []; }
        var bySig = {};
        var self = this;
        keep.concat(all).forEach(function(t) {
            if (!t || self._isBuiltinText(t)) return;
            var guestOwned = t._createdAsGuest === true || t.owner === 'guest';
            if (!guestOwned || !self._hasMeaningfulContent(t)) return;
            var copy = self._ensureTextContract(Object.assign({}, t, {
                owner: 'guest',
                _createdAsGuest: true,
                backup_state: t.backup_state || 'pending',
                stashedAt: new Date().toISOString()
            }));
            var sig = self._textSignature(copy);
            if (bySig[sig] && bySig[sig].backup_state === 'not_backed_up') {
                copy.backup_state = 'not_backed_up';
                copy.skippedAt = bySig[sig].skippedAt;
            }
            bySig[sig] = copy;
        });
        var shadows = Object.keys(bySig).map(function(k) { return bySig[k]; });
        if (shadows.length) localStorage.setItem(this.GUEST_SHADOW_KEY, JSON.stringify(shadows));
    },
    _getHandledGuestShadowIds: function() {
        var out = {};
        try {
            (JSON.parse(localStorage.getItem(this.GUEST_HANDLED_KEY) || '[]') || [])
                .forEach(function(k) { if (k) out[String(k)] = true; });
        } catch (_) {}
        return out;
    },
    _markGuestShadowHandled: function(text) {
        // Mirror stages.js deleteCustomStage(): record a handled-marker so a
        // removed text is never re-offered for guest-backup restore, keyed by
        // both id and content signature.
        if (!text) return;
        try {
            var handled = this._getHandledGuestShadowIds();
            if (text.id) handled['text:' + String(text.id)] = true;
            var sig = this._textSignature(text);
            if (sig) handled[sig] = true;
            localStorage.setItem(this.GUEST_HANDLED_KEY, JSON.stringify(Object.keys(handled)));
        } catch (_) {}
    },
    _dropFromGuestShadow: function(text) {
        // On removal, also take the matching entry out of the guest backup key
        // (by id or signature) and write a handled-marker, so the restore
        // prompt won't keep offering a text the user removed. Model: stages.js
        // deleteCustomStage() L109-135.
        if (!text) return;
        this._markGuestShadowHandled(text);
        try {
            var shadow = JSON.parse(localStorage.getItem(this.GUEST_SHADOW_KEY) || '[]') || [];
            var self = this;
            var sig = this._textSignature(text);
            var kept = shadow.filter(function(t) {
                if (!t) return false;
                if (text.id && t.id === text.id) return false;
                if (self._textSignature(t) === sig) return false;
                return true;
            });
            if (kept.length) localStorage.setItem(this.GUEST_SHADOW_KEY, JSON.stringify(kept));
            else localStorage.removeItem(this.GUEST_SHADOW_KEY);
        } catch (_) {}
    },
    _guestShadowCandidates: function() {
        var shadow = [];
        try { shadow = JSON.parse(localStorage.getItem(this.GUEST_SHADOW_KEY) || '[]'); } catch (_) { return []; }
        var userTexts = this._getAll().filter(function(u) {
            return u && u._createdAsGuest !== true && u.owner !== 'guest';
        });
        var self = this;
        var handled = this._getHandledGuestShadowIds();
        return shadow.filter(function(t) {
            if (!t || self._isBuiltinText(t) || !self._hasMeaningfulContent(t)) return false;
            if ((t.id && handled['text:' + String(t.id)]) || handled[self._textSignature(t)]) return false;
            var identical = userTexts.some(function(u) { return self._sameTextContent(u, t); });
            return !identical;
        });
    },
    _restoreGuestShadowCandidatesToLocal: function(candidates) {
        var all = this._getAll();
        var self = this;
        var seen = {};
        all.forEach(function(t) {
            if (t) seen[self._textSignature(t)] = true;
        });
        var changed = false;
        (candidates || []).forEach(function(t, i) {
            if (!t || !self._hasMeaningfulContent(t)) return;
            var sig = self._textSignature(t);
            if (seen[sig]) return;
            var copy = self._ensureTextContract(Object.assign({}, t));
            copy.id = copy.id || ('txt_guest_shadow_' + Date.now() + '_' + i);
            copy.local_id = copy.local_id || copy.id;
            copy.owner = 'guest';
            copy.type = 'text';
            copy.module = 'texts';
            copy._createdAsGuest = true;
            copy.backup_state = copy.backup_state || 'pending';
            copy.updated = copy.updated || new Date().toISOString();
            all.unshift(copy);
            seen[sig] = true;
            changed = true;
        });
        if (changed) this._saveAll(all);
        return changed;
    },
    promptGuestShadowOnLogin: function() {
        if (typeof ContentSync === 'undefined' || !ContentSync.isLoggedIn || !ContentSync.isLoggedIn()) return;
        // Same-browser guest->login does not necessarily pass through the
        // user-switch clear path, so fresh guest texts may still live in
        // plonter_texts. Stash them before reading the shadow candidates.
        this.stashGuestShadow();
        var candidates = this._guestShadowCandidates();
        if (!candidates.length) return;
        // Texts now join the single ContentSync migration dialog. Restore
        // shadow-only guest texts into the normal local list, then ask
        // ContentSync to show/refresh the unified checkbox popup instead of
        // opening the old text-only modal.
        this._restoreGuestShadowCandidatesToLocal(candidates);
        try {
            // Do not reset ContentSync's one-shot migration guard here.
            // The unified backup dialog is shared across modules; resetting
            // it from the text-specific shadow bridge can reopen the same
            // "לא עכשיו" prompt after the user already answered it.
            if (ContentSync.checkMigration) {
                var self = this;
                ContentSync.checkMigration('text', this._getAll().filter(function(t) { return !self._isBuiltinText(t); }));
            }
        } catch (e) { console.warn('[texts] unified guest shadow migration failed', e); }
    },
    // SAVE_CONTRACT.md phase-2 cleanup (2026-05-13): removed dead
    // _renderGuestTextShadowModal + 4 helpers. promptGuestShadowOnLogin
    // routes through ContentSync.checkMigration; ContentSync only touches
    // PlonterTexts._getAll/_saveAll/_textSignature/renderList/STORAGE_KEY/
    // GUEST_SHADOW_KEY, so the removed helpers are unreachable.

    showCreate: function() {
        // Create empty text and jump straight into editor.
        // Title + description are collected at first save via _showSaveDialog.
        var now = new Date().toISOString();
        var loggedIn = typeof ContentSync !== 'undefined' &&
            typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
        var text = { id: 'txt_' + Date.now(), title: '', desc: '', content: '', created: now, updated: now, owner: loggedIn ? 'account' : 'guest', module: 'texts', type: 'text' };
        text.local_id = text.id;
        text.source_id = text.id;
        if (!loggedIn) text._createdAsGuest = true;
        var all = this._getAll();
        all.unshift(text);
        this._saveAll(all);
        this.openEditor(text.id);
    },

    // Extract a title suggestion from the editor's first visual line.
    _suggestTitleFromContent: function(htmlOrText) {
        if (!htmlOrText) return '';
        var tmp = document.createElement('div');
        var html = String(htmlOrText)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<(div|p|h[1-6]|li|section|article|blockquote|pre)(\s[^>]*)?>/gi, '\n')
            .replace(/<\/(div|p|h[1-6]|li|section|article|blockquote|pre)>/gi, '\n');
        tmp.innerHTML = html;
        var plain = (tmp.innerText || tmp.textContent || '').trim();
        if (!plain) return '';
        var firstLine = plain.split(/[\n\r]+/).map(function(line) {
            return line.replace(/\s+/g, ' ').trim();
        }).filter(Boolean)[0] || '';
        var suggestion = firstLine.trim();
        // Trim trailing punctuation that isn't useful in a title
        suggestion = suggestion.replace(/[\.،؟!?]+$/, '').trim();
        return suggestion.slice(0, 80);
    },

    // Show a high-z-index save dialog that collects title (required) + description.
    // Stacks ABOVE the editor overlay (z-index 9999) so it's never hidden.
    // onSaved(text) is called after a successful save.
    _showSaveDialog: function(text, contentHtml, onSaved) {
        var self = this;
        var suggestion = this._suggestTitleFromContent(contentHtml);
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10050;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:16px;padding:24px;max-width:460px;width:92%;direction:rtl;text-align:right;box-shadow:0 12px 40px rgba(0,0,0,0.25)';
        dialog.innerHTML =
            '<h3 style="color:#0d9488;margin:0 0 16px 0;text-align:center">\u05E9\u05DE\u05D9\u05E8\u05EA \u05D8\u05E7\u05E1\u05D8</h3>' +
            '<label style="font-weight:bold;font-size:0.9em">\u05DB\u05D5\u05EA\u05E8\u05EA \u05D4\u05D8\u05E7\u05E1\u05D8:</label>' +
            '<input type="text" id="text-save-title" dir="rtl" placeholder="\u05DB\u05D5\u05EA\u05E8\u05EA..." style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 12px 0;box-sizing:border-box">' +
            '<label style="font-weight:bold;font-size:0.9em">\u05EA\u05D9\u05D0\u05D5\u05E8 \u05E7\u05E6\u05E8 (\u05D0\u05D5\u05E4\u05E6\u05D9\u05D5\u05E0\u05DC\u05D9):</label>' +
            '<input type="text" id="text-save-desc" dir="rtl" placeholder="\u05EA\u05D9\u05D0\u05D5\u05E8 \u05E7\u05E6\u05E8..." style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 12px 0;box-sizing:border-box">' +
            '<label style="font-weight:bold;font-size:0.9em">\u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4 / \u05E0\u05D5\u05E9\u05D0:</label>' +
            '<input type="text" id="text-save-category" list="text-category-suggestions" dir="rtl" placeholder="\u05DC\u05DE\u05E9\u05DC: \u05E2\u05D9\u05EA\u05D5\u05E0\u05D5\u05EA, \u05E1\u05E4\u05E8\u05D5\u05EA, \u05E9\u05D9\u05E2\u05D5\u05E8 1" style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 16px 0;box-sizing:border-box">' +
            '<datalist id="text-category-suggestions"></datalist>' +
            '<div style="display:flex;gap:10px;justify-content:center">' +
            '<button id="text-save-confirm" style="padding:10px 24px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05E9\u05DE\u05D5\u05E8</button>' +
            '<button id="text-save-cancel" style="padding:10px 24px;background:#e5e7eb;color:#333;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05D1\u05D9\u05D8\u05D5\u05DC</button>' +
            '</div>';
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        var titleInput = document.getElementById('text-save-title');
        var descInput = document.getElementById('text-save-desc');
        var categoryInput = document.getElementById('text-save-category');
        var categoryList = document.getElementById('text-category-suggestions');
        if (categoryList) {
            this._categoryOptions(this._getAll()).forEach(function(cat) {
                var opt = document.createElement('option');
                opt.value = cat;
                categoryList.appendChild(opt);
            });
        }
        // Pre-fill with existing values (if any) or suggestion
        titleInput.value = text.title || suggestion || '';
        descInput.value = text.desc || '';
        categoryInput.value = this._textCategory(text);
        titleInput.focus();
        titleInput.select();
        document.getElementById('text-save-cancel').onclick = function() { overlay.remove(); };
        document.getElementById('text-save-confirm').onclick = function() {
            var title = titleInput.value.trim();
            if (!title) { titleInput.style.borderColor = '#ef4444'; titleInput.focus(); return; }
            var desc = descInput.value.trim();
            var category = categoryInput.value.trim() || 'טקסטים שלי';
            var oldId = text.id;
            var wasBuiltin = self._isBuiltinText(text);
            text = self._copyBuiltinForEditing(text);
            // Silent auto-rename only on title+desc collision (not title
            // alone). Amitai 2026-04-19: same-title + different-desc is OK,
            // same-title + same-desc gets " 2" suffix.
            title = self._uniquifyOnTitleDesc(title, desc, text.id);
            titleInput.value = title;
            text.title = title;
            text.desc = desc;
            text.category = category;
            text.content = contentHtml;
            text.updated = new Date().toISOString();
            var all2 = self._getAll();
            all2 = wasBuiltin ? self._upsertReplacingId(all2, text.id, text) : self._upsertReplacingId(all2, oldId, text);
            self._saveAll(all2);
            self._requestFocus(text);
            overlay.remove();
            if (typeof onSaved === 'function') onSaved(text);
        };
        titleInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); descInput.focus(); }
        });
        descInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); categoryInput.focus(); categoryInput.select(); }
        });
        categoryInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); document.getElementById('text-save-confirm').click(); }
        });
    },

    // משתף קישור: מנסה Web Share (נייד), מעתיק ללוח, ומאשר עם הודעה.
    _shareTextLink: function(link, title) {
        var msg = 'הקישור הועתק 🔗';
        function fallbackCopy() {
            try {
                var ta = document.createElement('textarea');
                ta.value = link;
                ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (_) {}
        }
        function confirmCopied() {
            if (typeof MessageManager !== 'undefined') MessageManager.show(msg, 'success', 2000);
        }
        // Web Share API אם קיים (פותח גיליון שיתוף במכשירי נייד).
        if (navigator.share) {
            try { navigator.share({ title: title || 'טקסט פלונטר', url: link }).catch(function() {}); } catch (_) {}
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(confirmCopied).catch(function() {
                fallbackCopy(); confirmCopied();
            });
        } else {
            fallbackCopy(); confirmCopied();
        }
    },
    // נקרא מ-app.js בטעינה: אם יש ?shareText=<base64> — מפענח, מייבא לקטגוריית
    // "משותפים", פותח את העורך, ומנקה את ה-URL כדי שרענון לא ייבא שוב. (Amitai 2026-05-24)
    checkSharedTextOnLoad: function() {
        var params;
        try { params = new URLSearchParams(window.location.search); } catch (_) { return false; }
        var payload = params.get('shareText');
        if (!payload) return false;
        var obj = null;
        try {
            obj = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(payload)))));
        } catch (e) {
            try { history.replaceState(null, '', location.pathname); } catch (_) {}
            if (typeof MessageManager !== 'undefined') MessageManager.show('קישור השיתוף אינו תקין', 'error', 3000);
            return false;
        }
        if (!obj || typeof obj !== 'object') {
            try { history.replaceState(null, '', location.pathname); } catch (_) {}
            return false;
        }
        // בונה טקסט מקומי חדש מתוך המטען המשותף — id חדש ייחודי, קטגוריה
        // "משותפים", בעלות אורח. מסנן שדות source_*/meta/server (לא מועתקים כלל).
        var newId = 'txt_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        var nowIso = new Date().toISOString();
        var imported = {
            id: newId,
            local_id: newId,
            title: (obj.title || 'טקסט משותף'),
            desc: obj.desc || '',
            category: 'משותפים',
            content: obj.content || '',
            drawings: Array.isArray(obj.drawings) ? obj.drawings : [],
            type: obj.type || 'text',
            module: 'texts',
            owner: 'guest',
            _createdAsGuest: true,
            created: nowIso,
            updated: nowIso
        };
        try {
            if (typeof this._uniquifyOnTitleDesc === 'function') {
                imported.title = this._uniquifyOnTitleDesc(imported.title, imported.desc, imported.id);
            }
        } catch (_) {}
        var all = this._getAll();
        all = this._upsertReplacingId(all, imported.id, imported);
        this._saveAll(all);
        // מנקה את הפרמטר כדי שרענון לא ייבא שוב.
        try { history.replaceState(null, '', location.pathname); } catch (_) {}
        // עובר ללשונית הטקסטים ופותח את הטקסט המיובא בעורך.
        try { if (typeof switchWelcomeTab === 'function') switchWelcomeTab('texts'); } catch (_) {}
        var self = this;
        setTimeout(function() { try { self.openEditor(imported.id); } catch (_) {} }, 0);
        if (typeof MessageManager !== 'undefined') MessageManager.show('טקסט משותף יובא לקטגוריית "משותפים" 📥', 'success', 2500);
        return true;
    },
    openEditor: function(id) {
        var all = this._getAll();
        var text = all.find(function(t) { return t.id === id; });
        if (!text) return;
        // Record last-accessed time on its own field. Do NOT touch
        // `updated` — that drives the auto-sync diff and would flip
        // meta.synced=false just from opening the text.
        text.lastAccessed = new Date().toISOString();
        var idx = all.findIndex(function(t) { return t.id === id; });
        if (idx >= 0) all[idx] = text;
        this._saveAll(all);
        var self = this;
        // Inject CSS rule once — shift text editor right when dict panel is open.
        // Desktop: shift editor right so the left-anchored dict panel (320px)
        // doesn't overlap its content. Mobile: editor is hidden entirely while
        // dict is open (the original behavior). When dict-panel-open, the
        // 3 quick-action buttons (niqqud-keyboard ⌨️, dict-search 🔍,
        // heb→ar א→ع) get a small translateX nudge to the visual right so
        // they clear the dict panel edge — the rest of the toolbar stays put
        // (Amitai 2026-05-13: "כל השאר יישארו במקומן").
        if (!document.getElementById('plonter-texts-editor-style')) {
            var style = document.createElement('style');
            style.id = 'plonter-texts-editor-style';
            style.textContent =
                'body.dict-panel-open #plonter-texts-editor { left: 330px; } ' +
                '@media (max-width: 600px) { body.dict-panel-open #plonter-texts-editor { left: 100%; display: none; } } ' +
                'body.dict-panel-open #plonter-texts-editor .pt-quick-action { transform: translateX(64px); transition: transform 0.25s ease; } ' +
                'body:has(#plonter-texts-editor) { overflow: hidden; } ' +
                '#plonter-texts-editor .pt-editor-scroll { width:100%; flex:1; direction:ltr; overflow-y:auto; border:2px solid #d1d5db; border-radius:8px; min-height:0; } ' +
                '#plonter-texts-editor .pt-editor-scroll > [contenteditable] { width:100%; min-height:100%; box-sizing:border-box; padding:16px; outline:none; font-size:24px; font-family:"PlonterFlippedDiacritics",Arial,serif; line-height:2; direction:rtl; }';
            document.head.appendChild(style);
        }
        var overlay = document.createElement('div');
        overlay.id = 'plonter-texts-editor';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white;display:flex;flex-direction:column;padding:8px;direction:ltr';
        var titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:4px;direction:rtl;flex-shrink:0';
        var headerTitle = text.title || '\u05D8\u05E7\u05E1\u05D8 \u05D7\u05D3\u05E9 (\u05DC\u05D7\u05E5 \u05E9\u05DE\u05D5\u05E8 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05D2\u05D3\u05D9\u05E8 \u05DB\u05D5\u05EA\u05E8\u05EA)';
        titleRow.innerHTML = '<span class="pt-editor-title" title="לחץ לשינוי שם" style="font-weight:bold;color:#0d9488;font-size:1.1em;flex:1;cursor:pointer">' + headerTitle + '</span>';
        var tbtn = 'border:none;padding:8px 14px;border-radius:8px;font-weight:bold;font-size:0.9em;cursor:pointer';
        function _saveText() {
            var nextContent = editor.innerHTML;
            var nextDrawings = (typeof drawState !== 'undefined' && drawState) ? drawState.paths : (text.drawings || []);
            if (self._isBuiltinText(text) &&
                nextContent === (text.content || '') &&
                JSON.stringify(nextDrawings || []) === JSON.stringify(text.drawings || [])) {
                return;
            }
            var oldId = id;
            var wasBuiltin = self._isBuiltinText(text);
            text = self._copyBuiltinForEditing(text);
            id = text.id;
            text.content = nextContent;
            text.updated = new Date().toISOString();
            if (typeof drawState !== 'undefined' && drawState) text.drawings = nextDrawings;
            var all2 = self._getAll();
            all2 = wasBuiltin ? self._upsertReplacingId(all2, text.id, text) : self._upsertReplacingId(all2, oldId, text);
            self._saveAll(all2);
            self._requestFocus(text);
        }
        var saveBtn = document.createElement('button');
        saveBtn.textContent = '\uD83D\uDCBE \u05E9\u05DE\u05D5\u05E8';
        saveBtn.style.cssText = tbtn + ';background:#22c55e;color:white';
        saveBtn.onclick = function() {
            if (!text.title) {
                // First save: collect title + description via high-z-index dialog
                self._showSaveDialog(text, editor.innerHTML, function(updated) {
                    // text ref is the same object as `updated`; refresh header title
                    var header = titleRow.querySelector('span');
                    if (header) header.textContent = updated.title;
                    if (typeof MessageManager !== 'undefined') MessageManager.show('\u05E0\u05E9\u05DE\u05E8 \u2713', 'success', 1500);
                });
            } else {
                _saveText();
                if (typeof MessageManager !== 'undefined') MessageManager.show('\u05E0\u05E9\u05DE\u05E8 \u2713', 'success', 1500);
            }
        };
        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = '\u05D1\u05D9\u05D8\u05D5\u05DC';
        cancelBtn.style.cssText = tbtn + ';background:#e5e7eb;color:#333';
        cancelBtn.onclick = function() {
            if (typeof showUnsavedDialog === 'function') {
                showUnsavedDialog('השינויים בטקסט לא יישמרו', function() {
                    self._requestFocus(text);
                    overlay.remove(); if (_autoSaveTimer) clearInterval(_autoSaveTimer); window.removeEventListener('resize', _pencilResize); self.renderList();
                });
            } else if (confirm('לצאת בלי לשמור שינויים?')) {
                self._requestFocus(text);
                overlay.remove(); if (_autoSaveTimer) clearInterval(_autoSaveTimer); window.removeEventListener('resize', _pencilResize); self.renderList();
            }
        };
        var editTitleBtn = document.createElement('button');
        editTitleBtn.type = 'button';
        editTitleBtn.textContent = '✏️';
        editTitleBtn.title = 'ערוך שם, תיאור וקטגוריה';
        editTitleBtn.style.cssText = tbtn + ';background:#f3f4f6;color:#374151;padding:6px 10px;font-size:1em';
        // Persist a new title. Returns the saved (uniquified) title, or false if
        // nothing changed. Shared by inline-edit save button / Enter / blur. (Amitai 2026-05-24)
        function _commitTitle(nu) {
            nu = (nu || '').trim();
            var current = text.title || '';
            if (!nu || nu === current) return false;
            var unique = self._uniquifyOnTitleDesc(nu, text.desc || '', text.id);
            var oldId = id;
            var wasBuiltin = self._isBuiltinText(text);
            text = self._copyBuiltinForEditing(text);
            id = text.id;
            text.title = unique;
            text.content = editor.innerHTML;
            text.updated = new Date().toISOString();
            if (typeof drawState !== 'undefined' && drawState) text.drawings = drawState.paths;
            var all2 = self._getAll();
            all2 = wasBuiltin ? self._upsertReplacingId(all2, text.id, text) : self._upsertReplacingId(all2, oldId, text);
            self._saveAll(all2);
            self._requestFocus(text);
            if (typeof MessageManager !== 'undefined') MessageManager.show('שם עודכן ✓', 'success', 1500);
            return unique;
        }
        // Amitai 2026-05-24: clicking the title turns it into an inline text field
        // with a small 💾 save button that appears while editing and disappears
        // when you leave the field (commit on click / Enter / blur, Esc cancels).
        function _inlineEditTitle() {
            var span = titleRow.querySelector('span.pt-editor-title');
            if (!span || titleRow.querySelector('.pt-title-input')) return;
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'pt-title-input';
            input.value = text.title || '';
            input.placeholder = 'שם הטקסט...';
            input.style.cssText = 'flex:1;min-width:0;font-weight:bold;color:#0d9488;font-size:1.1em;border:2px solid #0d9488;border-radius:6px;padding:2px 8px;direction:rtl;outline:none';
            var titleSaveBtn = document.createElement('button');
            titleSaveBtn.type = 'button';
            titleSaveBtn.className = 'pt-title-save';
            titleSaveBtn.textContent = '💾';
            titleSaveBtn.title = 'שמור שם';
            titleSaveBtn.style.cssText = 'border:none;background:#22c55e;color:white;border-radius:6px;padding:4px 9px;cursor:pointer;font-size:0.95em;flex-shrink:0';
            var done = false;
            function teardown(newTitle) {
                if (done) return;
                done = true;
                if (input.parentNode) input.parentNode.removeChild(input);
                if (titleSaveBtn.parentNode) titleSaveBtn.parentNode.removeChild(titleSaveBtn);
                var s = titleRow.querySelector('span.pt-editor-title');
                if (s) {
                    s.textContent = (typeof newTitle === 'string' && newTitle) ? newTitle : (text.title || headerTitle);
                    s.style.display = '';
                }
            }
            // mousedown (not click) so the save fires before the input's blur
            titleSaveBtn.addEventListener('mousedown', function(e) {
                e.preventDefault();
                var nu = _commitTitle(input.value);
                teardown(nu || text.title || '');
            });
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); var nu = _commitTitle(input.value); teardown(nu || text.title || ''); }
                else if (e.key === 'Escape') { e.preventDefault(); teardown(text.title || ''); }
            });
            input.addEventListener('blur', function() {
                setTimeout(function() {
                    if (done) return;
                    var nu = _commitTitle(input.value);
                    teardown(nu || text.title || '');
                }, 0);
            });
            span.style.display = 'none';
            titleRow.insertBefore(titleSaveBtn, span.nextSibling);
            titleRow.insertBefore(input, span.nextSibling);
            input.focus();
            input.select();
        }
        // Pencil -> full metadata dialog: name + description + category (+ create new). (Amitai 2026-05-24)
        editTitleBtn.onclick = function() {
            self._showSaveDialog(text, editor.innerHTML, function(updated) {
                text = updated;
                id = updated.id;
                var hdrSpan = titleRow.querySelector('span.pt-editor-title');
                if (hdrSpan) hdrSpan.textContent = updated.title;
                if (typeof MessageManager !== 'undefined') MessageManager.show('עודכן ✓', 'success', 1500);
            });
        };
        var _titleSpan = titleRow.querySelector('span.pt-editor-title');
        if (_titleSpan) _titleSpan.onclick = _inlineEditTitle;
        titleRow.appendChild(editTitleBtn);
        titleRow.appendChild(cancelBtn);
        titleRow.appendChild(saveBtn);
        // שתף — בונה קישור עצמאי שמקודד את הטקסט עצמו (base64) לתוך ה-URL.
        // המקבל לא צריך חשבון; הטקסט מיובא אוטומטית לקטגוריית "משותפים". (Amitai 2026-05-24)
        var shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.textContent = 'שתף 🔗';
        shareBtn.title = 'צור קישור שיתוף שמייבא את הטקסט אצל מי שפותח אותו';
        shareBtn.style.cssText = tbtn + ';background:#8b5cf6;color:white';
        shareBtn.onclick = function() {
            try {
                var curContent = (typeof editor !== 'undefined' && editor) ? editor.innerHTML : (text.content || '');
                var curDrawings = (typeof drawState !== 'undefined' && drawState) ? drawState.paths : (text.drawings || []);
                // אובייקט נקי לשיתוף — רק שדות התוכן, בלי id/owner/source_*/meta/דגלי-סנכרון.
                var shareObj = {
                    title: text.title || '',
                    desc: text.desc || '',
                    category: text.category || '',
                    content: curContent || '',
                    drawings: curDrawings || [],
                    type: text.type || 'text',
                    module: text.module || 'texts'
                };
                var payload = btoa(unescape(encodeURIComponent(JSON.stringify(shareObj))));
                var link = location.origin + location.pathname + '?shareText=' + encodeURIComponent(payload);
                self._shareTextLink(link, shareObj.title);
            } catch (e) {
                if (typeof MessageManager !== 'undefined') MessageManager.show('יצירת קישור השיתוף נכשלה', 'error', 2500);
            }
        };
        titleRow.appendChild(shareBtn);
        var exitBtn = document.createElement('button');
        exitBtn.textContent = '\u2715 \u05E9\u05DE\u05D5\u05E8 \u05D5\u05E6\u05D0';
        exitBtn.style.cssText = tbtn + ';background:#0891b2;color:white';
        function _closeEditor() {
            self._requestFocus(text);
            overlay.remove();
            if (_autoSaveTimer) clearInterval(_autoSaveTimer);
            window.removeEventListener('resize', _pencilResize);
            self.renderList();
            if (typeof MessageManager !== 'undefined') MessageManager.show('\u05D4\u05D8\u05E7\u05E1\u05D8 \u05E0\u05E9\u05DE\u05E8', 'success', 2000);
        }
        exitBtn.onclick = function() {
            if (!text.title) {
                self._showSaveDialog(text, editor.innerHTML, function() { _closeEditor(); });
            } else {
                _saveText();
                _closeEditor();
            }
        };
        titleRow.appendChild(exitBtn);
        overlay.appendChild(titleRow);
        var _autoSaveTimer = setInterval(function() { _saveText(); }, 5000);
        // Formatting toolbar
        var toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:8px;direction:rtl;flex-shrink:0;flex-wrap:wrap;padding:4px 0';
        var btnStyle = 'padding:4px 10px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;font-size:0.95em;line-height:1.4';
        function addFmtBtn(label, title, cmd, val) {
            var b = document.createElement('button');
            b.type = 'button'; b.innerHTML = label; b.title = title; b.style.cssText = btnStyle;
            b.addEventListener('mousedown', function(e) { e.preventDefault(); });
            b.addEventListener('click', function() { document.execCommand(cmd, false, val || null); editor.focus(); });
            toolbar.appendChild(b);
            return b;
        }
        addFmtBtn('<b>B</b>', '\u05DE\u05D5\u05D3\u05D2\u05E9 (Ctrl+B)', 'bold');
        addFmtBtn('<u>U</u>', '\u05E7\u05D5 \u05EA\u05D7\u05EA\u05D5\u05DF (Ctrl+U)', 'underline');
        addFmtBtn('\u2715', '\u05D4\u05E1\u05E8 \u05E2\u05D9\u05E6\u05D5\u05D1', 'removeFormat');
        var sep = document.createElement('span');
        sep.style.cssText = 'width:1px;background:#e5e7eb;height:22px;display:inline-block;margin:0 4px';
        toolbar.appendChild(sep);
        addFmtBtn('A+', '\u05D4\u05D2\u05D3\u05DC \u05D2\u05D5\u05E4\u05DF', 'fontSize', '6');
        // "A" normal font — removes font-size formatting to match editor default
        var normalFontBtn = document.createElement('button');
        normalFontBtn.type = 'button'; normalFontBtn.textContent = 'A'; normalFontBtn.title = '\u05D2\u05D5\u05E4\u05DF \u05E8\u05D2\u05D9\u05DC'; normalFontBtn.style.cssText = btnStyle;
        normalFontBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        normalFontBtn.addEventListener('click', function() {
            // Set to size 7 (largest), then find the <font> tags and remove them
            document.execCommand('fontSize', false, '7');
            var fonts = editor.querySelectorAll('font[size="7"]');
            fonts.forEach(function(f) {
                while (f.firstChild) f.parentNode.insertBefore(f.firstChild, f);
                f.parentNode.removeChild(f);
            });
            editor.focus();
        });
        toolbar.appendChild(normalFontBtn);
        addFmtBtn('A-', '\u05D4\u05E7\u05D8\u05DF \u05D2\u05D5\u05E4\u05DF', 'fontSize', '2');
        var sep2 = sep.cloneNode();
        toolbar.appendChild(sep2);
        addFmtBtn('\u2B77', '\u05D9\u05D9\u05E9\u05E8 \u05D9\u05DE\u05D9\u05E0\u05D4', 'justifyRight');
        addFmtBtn('\u2630', '\u05DE\u05E8\u05DB\u05D6', 'justifyCenter');
        addFmtBtn('\u2B78', '\u05D9\u05D9\u05E9\u05E8 \u05E9\u05DE\u05D0\u05DC\u05D4', 'justifyLeft');
        var sep2b = sep.cloneNode();
        toolbar.appendChild(sep2b);
        var colorGroup = document.createElement('span');
        colorGroup.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;gap:2px';
        var colorLabel = document.createElement('span');
        colorLabel.textContent = '\u05E6\u05D1\u05D9\u05E2\u05EA \u05D8\u05E7\u05E1\u05D8';
        colorLabel.style.cssText = 'font-size:0.65em;color:#6b7280;font-weight:bold;line-height:1';
        colorGroup.appendChild(colorLabel);
        var colorRow = document.createElement('span');
        colorRow.style.cssText = 'display:inline-flex;gap:4px';
        colorGroup.appendChild(colorRow);
        toolbar.appendChild(colorGroup);
        var colors = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#000000'];
        colors.forEach(function(c) {
            var cb = document.createElement('button');
            cb.type = 'button'; cb.title = '\u05E6\u05D1\u05E2 \u05D0\u05D5\u05EA'; cb.style.cssText = 'width:22px;height:22px;border:2px solid #d1d5db;border-radius:50%;cursor:pointer;background:' + c;
            cb.addEventListener('mousedown', function(e) { e.preventDefault(); });
            cb.addEventListener('click', function() {
                document.execCommand('foreColor', false, c);
                // Collapse selection so the blue highlight doesn't hide the new color
                var sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && !sel.isCollapsed) sel.collapseToEnd();
                editor.focus();
            });
            colorRow.appendChild(cb);
        });
        // Highlight (background) colors — marker-style
        var markerSep = sep.cloneNode();
        toolbar.appendChild(markerSep);
        var markerGroup = document.createElement('span');
        markerGroup.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;gap:2px';
        var markerTitle = document.createElement('span');
        markerTitle.textContent = '\u05E1\u05D9\u05DE\u05D5\u05DF \u05D8\u05E7\u05E1\u05D8';
        markerTitle.style.cssText = 'font-size:0.65em;color:#6b7280;font-weight:bold;line-height:1';
        markerGroup.appendChild(markerTitle);
        var markerRow = document.createElement('span');
        markerRow.style.cssText = 'display:inline-flex;gap:4px;align-items:center';
        markerGroup.appendChild(markerRow);
        toolbar.appendChild(markerGroup);
        var hiliteColors = ['#fef08a','#fecaca','#bbf7d0','#bfdbfe','#e9d5ff'];
        hiliteColors.forEach(function(c) {
            var hb = document.createElement('button');
            hb.type = 'button'; hb.title = '\u05E8\u05E7\u05E2 \u05D7\u05D9\u05E7\u05D5\u05D9'; hb.style.cssText = 'width:22px;height:22px;border:2px solid #d1d5db;border-radius:4px;cursor:pointer;background:' + c;
            hb.addEventListener('mousedown', function(e) { e.preventDefault(); });
            hb.addEventListener('click', function() {
                // hiliteColor is the modern command; fall back to backColor
                var ok = document.execCommand('hiliteColor', false, c);
                if (!ok) document.execCommand('backColor', false, c);
                var sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && !sel.isCollapsed) sel.collapseToEnd();
                editor.focus();
            });
            markerRow.appendChild(hb);
        });
        // Remove highlight (transparent marker)
        var hiliteOffBtn = document.createElement('button');
        hiliteOffBtn.type = 'button';
        hiliteOffBtn.textContent = '\u2715';
        hiliteOffBtn.title = '\u05D4\u05E1\u05E8 \u05E8\u05E7\u05E2 \u05D7\u05D9\u05E7\u05D5\u05D9';
        hiliteOffBtn.style.cssText = 'width:22px;height:22px;border:2px solid #d1d5db;border-radius:4px;cursor:pointer;background:#fff;color:#6b7280;font-size:0.9em;padding:0;line-height:1';
        hiliteOffBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        hiliteOffBtn.addEventListener('click', function() {
            var ok = document.execCommand('hiliteColor', false, 'transparent');
            if (!ok) document.execCommand('backColor', false, 'transparent');
            var sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed) sel.collapseToEnd();
            editor.focus();
        });
        markerRow.appendChild(hiliteOffBtn);
        // Zero-width spacer — margin-inline-start:auto on first function button grabs remaining
        // space when available; on narrow screens the buttons wrap to a new line (flex-wrap:wrap
        // is set on the toolbar), so no horizontal scrolling is needed.
        var leftSpacer = document.createElement('span');
        leftSpacer.style.cssText = 'flex-basis:0;min-width:0';
        toolbar.appendChild(leftSpacer);
        var sep3 = sep.cloneNode();
        toolbar.appendChild(sep3);
        var h2aBtn = document.createElement('button');
        h2aBtn.type = 'button'; h2aBtn.textContent = '\u05D0\u2192\u0639'; h2aBtn.title = '\u05D4\u05DE\u05E8 \u05E2\u05D1\u05E8\u05D9\u05EA \u05DC\u05E2\u05E8\u05D1\u05D9\u05EA (\u05D1\u05D7\u05D9\u05E8\u05D4)';
        h2aBtn.className = 'pt-quick-action';
        h2aBtn.style.cssText = 'padding:4px 10px;border:1px solid #0d9488;border-radius:4px;background:#f0fdfa;cursor:pointer;font-size:1.1em;color:#0d9488;font-weight:bold;line-height:1.4;margin-inline-start:auto';
        h2aBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        h2aBtn.addEventListener('click', function() {
            var sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                var range = sel.getRangeAt(0);
                var txt = range.toString();
                var converted = typeof DetailsPanel !== 'undefined' ? DetailsPanel._convertHebrewToArabic(txt) : txt;
                range.deleteContents();
                range.insertNode(document.createTextNode(converted));
            }
            editor.focus();
        });
        toolbar.appendChild(h2aBtn);
        // Separator between conversion button and dictionary button
        var dictSep = sep.cloneNode();
        toolbar.appendChild(dictSep);
        // Dictionary: open (and lookup selection if any)
        var dictBtn = document.createElement('button');
        dictBtn.type = 'button';
        dictBtn.textContent = '\uD83D\uDD0D';
        dictBtn.title = '\u05DE\u05D9\u05DC\u05D5\u05DF \u2014 \u05E2\u05DD \u05E1\u05D9\u05DE\u05D5\u05DF \u05D9\u05D7\u05E4\u05E9 \u05D0\u05D5\u05EA\u05D5';
        dictBtn.className = 'pt-quick-action';
        dictBtn.style.cssText = 'padding:4px 10px;border:1px solid #0891b2;border-radius:4px;background:#ecfeff;cursor:pointer;font-size:1.1em;color:#0891b2';
        dictBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        dictBtn.addEventListener('click', function() {
            var sel = window.getSelection();
            var q = sel ? sel.toString().trim() : '';
            if (typeof Dictionary === 'undefined') return;
            if (q && Dictionary.lookup) {
                Dictionary.lookup(q);
            } else if (Dictionary.openStandalone) {
                Dictionary.openStandalone();
            }
        });
        toolbar.appendChild(dictBtn);
        // Pencil (draw) mode toggle — placed with visual/formatting buttons on the right side
        var pencilSep = sep.cloneNode();
        toolbar.insertBefore(pencilSep, leftSpacer);
        var drawState = { active: false, eraser: false, color: '#ef4444', width: 3, paths: (text.drawings ? JSON.parse(JSON.stringify(text.drawings)) : []), drawing: false, current: null, canvas: null, ctx: null };
        var pencilBtn = document.createElement('button');
        pencilBtn.type = 'button';
        pencilBtn.textContent = '\u270F\uFE0F';
        pencilBtn.title = '\u05E2\u05D9\u05E4\u05E8\u05D5\u05DF \u2014 \u05E7\u05E9\u05E7\u05D5\u05E9 \u05E2\u05DC \u05D4\u05DE\u05E1\u05DA';
        pencilBtn.style.cssText = 'padding:4px 10px;border:1px solid #ef4444;border-radius:4px;background:#fef2f2;cursor:pointer;font-size:1.1em;color:#ef4444';
        pencilBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        toolbar.insertBefore(pencilBtn, leftSpacer);
        // Pencil color picker (small swatches, only shown when draw mode active)
        var pencilColorRow = document.createElement('span');
        pencilColorRow.style.cssText = 'display:none;gap:3px;align-items:center;margin-right:4px';
        var pencilColors = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#000000'];
        pencilColors.forEach(function(c) {
            var sw = document.createElement('button');
            sw.type = 'button';
            sw.style.cssText = 'width:18px;height:18px;border:2px solid ' + (c === drawState.color ? '#333' : '#d1d5db') + ';border-radius:50%;cursor:pointer;background:' + c + ';padding:0';
            sw.addEventListener('mousedown', function(e) { e.preventDefault(); });
            sw.addEventListener('click', function() {
                drawState.color = c;
                [].forEach.call(pencilColorRow.children, function(el) {
                    el.style.borderColor = '#d1d5db';
                });
                sw.style.borderColor = '#333';
            });
            pencilColorRow.appendChild(sw);
        });
        toolbar.insertBefore(pencilColorRow, leftSpacer);
        var eraserBtn = document.createElement('button');
        eraserBtn.type = 'button';
        eraserBtn.textContent = '\u{1FA7B}';
        eraserBtn.title = '\u05DE\u05D7\u05E7 \u2014 \u05DC\u05D7\u05E5 \u05E2\u05DC \u05E7\u05D5 \u05DB\u05D3\u05D9 \u05DC\u05DE\u05D7\u05D5\u05E7 \u05D0\u05D5\u05EA\u05D5';
        eraserBtn.style.cssText = 'display:none;padding:4px 10px;border:1px solid #6b7280;border-radius:4px;background:#f9fafb;cursor:pointer;font-size:1.05em;color:#374151;margin-right:4px';
        eraserBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        eraserBtn.addEventListener('click', function() {
            drawState.eraser = !drawState.eraser;
            eraserBtn.style.background = drawState.eraser ? '#374151' : '#f9fafb';
            eraserBtn.style.color = drawState.eraser ? 'white' : '#374151';
        });
        toolbar.insertBefore(eraserBtn, leftSpacer);
        var pencilClearBtn = document.createElement('button');
        pencilClearBtn.type = 'button';
        pencilClearBtn.textContent = '\u05DE\u05D7\u05E7 \u05E7\u05E9\u05E7\u05D5\u05E9';
        pencilClearBtn.style.cssText = 'display:none;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;font-size:0.85em;margin-right:4px';
        pencilClearBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        pencilClearBtn.addEventListener('click', function() {
            drawState.paths = [];
            _pencilRedraw();
            _saveText();
        });
        toolbar.insertBefore(pencilClearBtn, leftSpacer);
        function _distPointToSeg(px, py, ax, ay, bx, by) {
            var dx = bx - ax, dy = by - ay;
            if (dx === 0 && dy === 0) {
                var ddx = px - ax, ddy = py - ay;
                return Math.sqrt(ddx * ddx + ddy * ddy);
            }
            var t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
            if (t < 0) t = 0; else if (t > 1) t = 1;
            var cx = ax + t * dx, cy = ay + t * dy;
            var ex = px - cx, ey = py - cy;
            return Math.sqrt(ex * ex + ey * ey);
        }
        function _pencilEraseAt(x, y) {
            for (var pi = drawState.paths.length - 1; pi >= 0; pi--) {
                var path = drawState.paths[pi];
                var tol = (path.width || 3) + 6;
                var hit = false;
                if (path.points.length === 1) {
                    var p = path.points[0];
                    if (Math.hypot(p.x - x, p.y - y) < tol) hit = true;
                } else {
                    for (var si = 0; si < path.points.length - 1; si++) {
                        if (_distPointToSeg(x, y, path.points[si].x, path.points[si].y, path.points[si + 1].x, path.points[si + 1].y) < tol) {
                            hit = true;
                            break;
                        }
                    }
                }
                if (hit) {
                    drawState.paths.splice(pi, 1);
                    _pencilRedraw();
                    _saveText();
                    return true;
                }
            }
            return false;
        }
        function _pencilEnsureCanvas() {
            if (drawState.canvas) return drawState.canvas;
            var cnv = document.createElement('canvas');
            var w = Math.max(editor.scrollWidth, editor.clientWidth);
            var h = Math.max(editor.scrollHeight, editor.clientHeight);
            cnv.style.cssText = 'position:absolute;top:0;left:0;width:' + w + 'px;height:' + h + 'px;z-index:5;pointer-events:none';
            cnv.width = w;
            cnv.height = h;
            editor.style.position = 'relative';
            editor.appendChild(cnv);
            drawState.canvas = cnv;
            drawState.ctx = cnv.getContext('2d');
            cnv.addEventListener('mousedown', function(e) { if (!drawState.active) return; _pencilStart(e.clientX, e.clientY); });
            cnv.addEventListener('mousemove', function(e) { if (!drawState.active) return; _pencilMove(e.clientX, e.clientY); });
            cnv.addEventListener('mouseup', function() { _pencilEnd(); });
            cnv.addEventListener('mouseleave', function() { _pencilEnd(); });
            cnv.addEventListener('touchstart', function(e) { if (!drawState.active) return; e.preventDefault(); var t = e.touches[0]; _pencilStart(t.clientX, t.clientY); }, { passive: false });
            cnv.addEventListener('touchmove', function(e) { if (!drawState.active) return; e.preventDefault(); var t = e.touches[0]; _pencilMove(t.clientX, t.clientY); }, { passive: false });
            cnv.addEventListener('touchend', function() { _pencilEnd(); });
            return cnv;
        }
        function _pencilResize() {
            if (!drawState.canvas) return;
            var w = Math.max(editor.scrollWidth, editor.clientWidth);
            var h = Math.max(editor.scrollHeight, editor.clientHeight);
            drawState.canvas.width = w;
            drawState.canvas.height = h;
            drawState.canvas.style.width = w + 'px';
            drawState.canvas.style.height = h + 'px';
            _pencilRedraw();
        }
        function _pencilStart(cx, cy) {
            var rect = drawState.canvas.getBoundingClientRect();
            var x = cx - rect.left, y = cy - rect.top;
            if (drawState.eraser) {
                _pencilEraseAt(x, y);
                return;
            }
            drawState.drawing = true;
            drawState.current = { color: drawState.color, width: drawState.width, points: [{ x: x, y: y }] };
        }
        function _pencilMove(cx, cy) {
            if (!drawState.drawing || !drawState.current) return;
            var rect = drawState.canvas.getBoundingClientRect();
            var p = { x: cx - rect.left, y: cy - rect.top };
            var pts = drawState.current.points;
            pts.push(p);
            var ctx = drawState.ctx;
            ctx.strokeStyle = drawState.current.color;
            ctx.lineWidth = drawState.current.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (pts.length >= 2) {
                ctx.beginPath();
                ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
        }
        function _pencilEnd() {
            if (!drawState.drawing) return;
            drawState.drawing = false;
            if (drawState.current && drawState.current.points.length > 1) {
                drawState.paths.push(drawState.current);
                _saveText();
            }
            drawState.current = null;
        }
        function _pencilRedraw() {
            if (!drawState.ctx || !drawState.canvas) return;
            drawState.ctx.clearRect(0, 0, drawState.canvas.width, drawState.canvas.height);
            drawState.paths.forEach(function(path) {
                if (path.points.length < 2) return;
                drawState.ctx.strokeStyle = path.color;
                drawState.ctx.lineWidth = path.width;
                drawState.ctx.lineCap = 'round';
                drawState.ctx.lineJoin = 'round';
                drawState.ctx.beginPath();
                drawState.ctx.moveTo(path.points[0].x, path.points[0].y);
                for (var i = 1; i < path.points.length; i++) {
                    drawState.ctx.lineTo(path.points[i].x, path.points[i].y);
                }
                drawState.ctx.stroke();
            });
        }
        pencilBtn.addEventListener('click', function() {
            drawState.active = !drawState.active;
            if (!drawState.active) drawState.eraser = false;
            _pencilEnsureCanvas();
            drawState.canvas.style.pointerEvents = drawState.active ? 'auto' : 'none';
            pencilBtn.style.background = drawState.active ? '#ef4444' : '#fef2f2';
            pencilBtn.style.color = drawState.active ? 'white' : '#ef4444';
            editor.contentEditable = drawState.active ? 'false' : 'true';
            pencilColorRow.style.display = drawState.active ? 'inline-flex' : 'none';
            pencilClearBtn.style.display = drawState.active ? 'inline-block' : 'none';
            eraserBtn.style.display = drawState.active ? 'inline-block' : 'none';
            if (!drawState.active) {
                eraserBtn.style.background = '#f9fafb';
                eraserBtn.style.color = '#374151';
            }
            _pencilRedraw();
        });
        window.addEventListener('resize', _pencilResize);
        // Diacritics keyboard toggle button
        if (typeof DiacriticsKeyboard !== 'undefined') {
            var dkSep = sep.cloneNode();
            toolbar.appendChild(dkSep);
            var dkBtn = document.createElement('button');
            dkBtn.type = 'button'; dkBtn.textContent = '\u2328\uFE0F'; dkBtn.title = '\u05DE\u05E7\u05DC\u05D3\u05EA \u05E0\u05D9\u05E7\u05D5\u05D3 (QWES)';
            dkBtn.className = 'dk-toggle pt-quick-action';
            dkBtn.style.cssText = 'padding:4px 10px;border:1px solid #6366f1;border-radius:4px;background:#f5f3ff;cursor:pointer;font-size:1.1em;color:#6366f1;font-weight:bold';
            dkBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            dkBtn.addEventListener('click', function() {
                editor.focus();
                setTimeout(function() {
                    var active = DiacriticsKeyboard.toggle();
                    dkBtn.style.background = active ? '#6366f1' : '#f5f3ff';
                    dkBtn.style.color = active ? 'white' : '#6366f1';
                }, 10);
            });
            document.addEventListener('dk-toggle', function(e) {
                dkBtn.style.background = e.detail.active ? '#6366f1' : '#f5f3ff';
                dkBtn.style.color = e.detail.active ? 'white' : '#6366f1';
            });
            toolbar.appendChild(dkBtn);
        }
        overlay.appendChild(toolbar);
        var editorScroll = document.createElement('div');
        editorScroll.className = 'pt-editor-scroll';
        var editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.innerHTML = text.content || '';
        // Ctrl+G — Hebrew to Arabic transliteration (explicit handler for text editor).
        // Uses document.execCommand('insertText', ...) so the conversion lands on
        // the contentEditable's native undo stack — Ctrl+Z reverses Ctrl+G as a
        // single step (Amitai 2026-05-13).
        editor.addEventListener('keydown', function(e) {
            if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyG') return;
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
                var txt2 = node.textContent;
                var pos = range.startOffset;
                var end = pos;
                while (end > 0 && txt2[end - 1] === ' ') end--;
                if (end === 0) return;
                var start = end;
                while (start > 0 && txt2[start - 1] !== ' ' && txt2[start - 1] !== '\n' && txt2[start - 1] !== '\r') start--;
                if (start === end) return;
                var word = txt2.slice(start, end);
                var converted = DetailsPanel._convertHebrewToArabic(word);
                if (converted === word) return;
                // Select the word, then replace via execCommand so the change is
                // a single undoable step in the browser's native history.
                var wordRange = document.createRange();
                wordRange.setStart(node, start);
                wordRange.setEnd(node, end);
                sel.removeAllRanges();
                sel.addRange(wordRange);
                document.execCommand('insertText', false, converted);
            }
        });
        editorScroll.appendChild(editor);
        overlay.appendChild(editorScroll);
        document.body.appendChild(overlay);
        editor.focus();
        // If text has saved drawings, create canvas and render them (read-only until pencil activated)
        if (drawState.paths && drawState.paths.length > 0) {
            _pencilEnsureCanvas();
            setTimeout(_pencilRedraw, 0);
        }
        // Always deactivate diacritics keyboard when entering text editor
        if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard.isActive()) {
            DiacriticsKeyboard.deactivate();
        }
    },

    // WAVE1_SHARED_WITH_ME — open a text shared WITH this user. Identity-authorised
    // read by id, staged as a local `txt_shared_` read copy (not synced back).
    // Full co-edit write-back for texts is Wave 2 (needs contentSync, out of scope).
    _openSharedText: function(item) {
        var self = this;
        if (!item || typeof ContentShare === 'undefined' || !ContentShare.fetchContentById) return;
        ContentShare.fetchContentById(item.content_id).then(function(c) {
            if (!c) return;
            var data = (c.data && typeof c.data === 'object') ? c.data : {};
            var text = Object.assign({}, data, {
                id: 'txt_shared_' + c.id,
                title: c.title || data.title || 'טקסט משותף',
                _isBuiltinSeed: true,          // non-syncable read copy
                _sharedRole: item.role || 'view'
            });
            var all = [];
            try { all = JSON.parse(localStorage.getItem(self.STORAGE_KEY) || '[]'); } catch (_) { all = []; }
            all = all.filter(function(x) { return x && x.id !== text.id; });
            all.push(text);
            try { localStorage.setItem(self.STORAGE_KEY, JSON.stringify(all)); } catch (_) {}
            if (typeof self.openEditor === 'function') self.openEditor(text.id);
        });
    },

    renderList: function() {
        var container = document.getElementById('texts-list');
        if (!container) return;
        this._seedDemoIfEmpty();
        var raw = this._getAll();
        container.innerHTML = '';

        // WAVE1_SHARED_WITH_ME — "שותפו איתי" section of texts shared WITH this
        // user (hidden when none). Async; prepends to the list.
        var _self = this;
        if (typeof ContentShare !== 'undefined' && ContentShare.renderSharedInto) {
            ContentShare.registerOpener('text', function(it) { _self._openSharedText(it); });
            ContentShare.renderSharedInto(container, 'text', { label: 'טקסטים ששותפו איתי', openFn: function(it) { _self._openSharedText(it); } });
        }

        // Two-direction filter (Amitai 2026-04-19):
        // - Guest: hide items that are server-synced (privacy — user B
        //   on the same browser must not see user A's synced texts).
        //   Also hide built-in seeds (_isBuiltinSeed / txt_demo_*) — they
        //   render as ghost cards at the bottom instead (Amitai 08:35:
        //   "שהטקסט לדוגמה יתפקד כמו שהמשפט לתחביר לדוגמה מתפקד").
        // - Logged-in: hide items flagged _createdAsGuest that are still
        //   unsynced. Amitai explicitly asked that when logged in he only
        //   see backed-up items. Items he creates in-session (no
        //   _createdAsGuest flag) stay visible while they sit in the
        //   sync queue — otherwise he'd see nothing right after hitting
        //   "+ הוסף טקסט חדש".
        var hasCS = typeof ContentSync !== 'undefined' && typeof ContentSync.isLoggedIn === 'function';
        var isGuest = hasCS && !ContentSync.isLoggedIn();
        function _isBuiltinText(t) {
            if (!t) return false;
            if (t._isBuiltinSeed === true) return true;
            return typeof t.id === 'string' && t.id.indexOf('txt_demo_') === 0;
        }
        var all;
        var hiddenBuiltins = 0;
        var builtinTeasers = [];
        if (isGuest) {
            all = raw.filter(function(t) {
                if (ContentSync.isSynced && ContentSync.isSynced('text', t.id)) return false;
                if (_isBuiltinText(t)) { hiddenBuiltins++; builtinTeasers.push(t); return false; }
                return true;
            });
        } else if (hasCS) {
            all = raw.filter(function(t) {
                if (!t || !t._createdAsGuest) return true;
                return ContentSync.isSynced && ContentSync.isSynced('text', t.id);
            });
        } else {
            all = raw;
        }
        var hiddenGuestDrafts = (!isGuest && hasCS && raw.length > all.length);
        var self = this;
        var focus = this._consumeFocus();
        var activeCategory = localStorage.getItem(this.CATEGORY_FILTER_KEY) || '';
        if (focus && focus.category) {
            activeCategory = focus.category;
            localStorage.setItem(this.CATEGORY_FILTER_KEY, activeCategory);
        }
        var allBeforeCategory = all.slice();
        var categories = this._categoryOptions(allBeforeCategory);
        if (activeCategory && categories.indexOf(activeCategory) < 0) {
            localStorage.removeItem(this.CATEGORY_FILTER_KEY);
            activeCategory = '';
        }
        if (activeCategory) {
            all = all.filter(function(t) { return self._textCategory(t) === activeCategory; });
        }
        this._renderCategoryFilter(container, categories, activeCategory);
        this._renderContinueWork(container, allBeforeCategory);

        // If the only items we filtered out in guest mode are built-in
        // seeds, we still want to render ghost cards below — don't take
        // the early "empty" return.
        if (all.length === 0 && !(isGuest && hiddenBuiltins > 0)) {
            if (isGuest && raw.length > 0) {
                container.insertAdjacentHTML('beforeend', '<p style="color:#9ca3af;text-align:center;padding:12px">\u05DB\u05DC \u05D4\u05D8\u05E7\u05E1\u05D8\u05D9\u05DD \u05E9\u05DC\u05DA \u05D2\u05D5\u05D1\u05D5 \u05DC\u05E9\u05E8\u05EA \u2713<br>\u05D4\u05EA\u05D7\u05D1\u05E8 \u05DB\u05D3\u05D9 \u05DC\u05E8\u05D0\u05D5\u05EA \u05D0\u05D5\u05EA\u05DD.</p>');
            } else if (hiddenGuestDrafts) {
                container.insertAdjacentHTML('beforeend', '<p style="color:#9ca3af;text-align:center;padding:12px">\u05D9\u05E9 \u05D8\u05E7\u05E1\u05D8\u05D9\u05DD \u05DC\u05D0-\u05DE\u05D2\u05D5\u05D1\u05D9\u05DD \u05E9\u05DE\u05DE\u05EA\u05D9\u05E0\u05D9\u05DD \u05DC\u05D4\u05D7\u05DC\u05D8\u05D4 \u{1F552}<br>\u05E4\u05EA\u05D7 \u05D0\u05EA \u05D7\u05DC\u05D5\u05DF \u05D4\u05D2\u05D9\u05D1\u05D5\u05D9 \u05DB\u05D3\u05D9 \u05DC\u05D1\u05D7\u05D5\u05E8 \u05DE\u05D4 \u05DC\u05D3\u05D7\u05D5\u05E3 \u05DC\u05E9\u05E8\u05EA.</p>');
            } else {
                // Teaser CTA — Amitai 2026-04-19 08:24 variant (ג):
                // empty state becomes a placeholder with a clickable
                // link that seeds the demo on click. "marketing" reason.
                container.insertAdjacentHTML('beforeend', '<div style="text-align:center;padding:16px 12px;color:#475569">' +
                    '<p style="margin-bottom:8px">\u05D0\u05D9\u05DF \u05D8\u05E7\u05E1\u05D8\u05D9\u05DD \u05E2\u05D3\u05D9\u05D9\u05DF.</p>' +
                    '<button id="texts-cta-demo" style="background:linear-gradient(135deg,#0d9488,#0891b2);color:white;border:none;padding:10px 18px;border-radius:10px;font-size:0.95em;font-weight:bold;cursor:pointer;box-shadow:0 3px 8px rgba(13,148,136,0.25)">\u05E8\u05D5\u05E6\u05D4 \u05D8\u05E7\u05E1\u05D8\u05D9\u05DD \u05DC\u05D3\u05D5\u05D2\u05DE\u05D4? \u05DC\u05D7\u05E5 \u05DB\u05D0\u05DF \u2192</button>' +
                    '<p style="margin-top:8px;font-size:0.8em;color:#94a3b8">\u05D0\u05D5 \u05D4\u05D5\u05E1\u05E3 \u05D8\u05E7\u05E1\u05D8 \u05D7\u05D3\u05E9 \u05DE\u05DC\u05DE\u05E2\u05DC\u05D4</p>' +
                    '</div>');
                var cta = document.getElementById('texts-cta-demo');
                if (cta) cta.addEventListener('click', function() {
                    try { self.loadDemoTexts(); }
                    catch (e) { console.warn('[texts] CTA seed threw', e); }
                });
            }
            return;
        }
        // Sort by last used (most recent first)
        all.sort(function(a, b) {
            return new Date(b.lastAccessed || b.updated || b.created || 0) - new Date(a.lastAccessed || a.updated || a.created || 0);
        });
        var byCategory = {};
        all.forEach(function(text) {
            var cat = self._textCategory(text);
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(text);
        });
        Object.keys(byCategory).forEach(function(cat) {
            var texts = byCategory[cat];
            if (!texts.length) return;
            var section = document.createElement('div');
            section.className = 'text-category-section';
            section.style.cssText = 'margin:0 0 18px;direction:rtl';
            if (focus && focus.category === cat) {
                section.style.background = '#f0fdfa';
                section.style.border = '2px solid #99f6e4';
                section.style.borderRadius = '10px';
                section.style.padding = '10px';
                setTimeout(function() {
                    section.style.background = '';
                    section.style.border = '';
                    section.style.borderRadius = '';
                    section.style.padding = '';
                }, 3000);
            }
            var title = document.createElement('h2');
            title.className = 'category-title';
            title.style.cssText = 'font-size:1.05em;color:#0d9488;border-bottom:2px solid #0d9488;padding-bottom:6px;margin:0 0 10px';
            title.textContent = cat + ' (' + texts.length + ')';
            section.appendChild(title);
            var list = document.createElement('div');
            list.className = 'stages-list';
            list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
            section.appendChild(list);
            container.appendChild(section);
            texts.forEach(function(text) {
            var item = document.createElement('div');
            item.className = 'stage-item';
            item.dataset.textId = text.id;
            item.style.cursor = 'pointer';

            // Sync state for the card's border + badge — same 3-state UX
            // as lessons: pulsing green while pending, yellow dashed when
            // truly unsynced (guest / failed), no border on synced.
            var hasCS = typeof ContentSync !== 'undefined';
            // Built-in seeds (txt_demo_* / _isBuiltinSeed) skip sync state —
            // Amitai 2026-04-19 20:41: "don't show 'לא מגובה' on built-ins."
            var _isBuiltin = text._isBuiltinSeed === true ||
                (typeof text.id === 'string' && text.id.indexOf('txt_demo_') === 0);
            var syncState = _isBuiltin ? 'builtin'
                : ((hasCS && typeof ContentSync.getSyncState === 'function')
                    ? ContentSync.getSyncState('text', text.id) : 'unsynced');
            var syncBadge = _isBuiltin ? ''
                : ((hasCS && typeof ContentSync.getSyncBadge === 'function')
                    ? ContentSync.getSyncBadge('text', text.id) : '');
            if (hasCS && syncState === 'pending') {
                item.style.border = '2px solid #6ee7b7';
                item.style.background = '#ecfdf5';
                item.style.animation = 'cs-card-pulse 1.4s ease-in-out infinite';
            } else if (hasCS && syncState === 'unsynced') {
                item.style.border = '2px dashed #f59e0b';
                item.style.background = '#fffbeb';
            }

            var preview = text.content ? self._plainText(text.content).substring(0, 60) : '\u05E8\u05D9\u05E7';
            var displayTitle = text.title || '(\u05D8\u05E7\u05E1\u05D8 \u05D7\u05D3\u05E9 \u2014 \u05DC\u05D0 \u05E0\u05E9\u05DE\u05E8)';
            var titleColor = text.title ? '#0d9488' : '#9ca3af';
            item.innerHTML = '<div class="stage-number" style="font-weight:bold;color:' + titleColor + ';display:flex;align-items:center;gap:8px">' +
                    '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + displayTitle + '</span>' + syncBadge +
                '</div>' +
                '<div style="font-size:0.76em;color:#0f766e;font-weight:700;margin-top:2px">' + self._escapeHtml(self._textCategory(text)) + '</div>' +
                (text.desc ? '<div style="font-size:0.92em;color:#334155;font-weight:500;margin-top:3px">' + text.desc + '</div>' : '') +
                '<div class="stage-sentence" style="font-size:0.9em;color:#9ca3af">' + preview + '</div>';
            var actionBox = document.createElement('div');
            actionBox.style.cssText = 'margin-right:auto;display:flex;align-items:center;gap:8px;direction:ltr;flex-shrink:0';

            var delBtn = document.createElement('button');
            delBtn.className = 'stage-delete-btn';
            delBtn.innerHTML = '\uD83D\uDDD1\uFE0F';
            delBtn.title = '\u05DE\u05D7\u05E7 \u05D8\u05E7\u05E1\u05D8';
            delBtn.style.marginRight = '0';
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var confirmLabel = text.title || '(\u05D8\u05E7\u05E1\u05D8 \u05DC\u05DC\u05D0 \u05DB\u05D5\u05EA\u05E8\u05EA)';
                if (confirm('\u05DC\u05DE\u05D7\u05D5\u05E7 \u05D0\u05EA "' + confirmLabel + '"?')) {
                    // Tear down server copy so a later pullAll doesn't
                    // resurrect the text the user just deleted. Fire-and-
                    // forget — local delete proceeds immediately.
                    if (typeof ContentSync !== 'undefined' && typeof ContentSync.deleteItem === 'function') {
                        try { ContentSync.deleteItem('text', text.id).catch(function(err) { console.warn('[texts] server delete failed', err); }); }
                        catch (_) {}
                    }
                    var a = self._getAll().filter(function(t) { return t.id !== text.id; });
                    self._saveAll(a);
                    // Removal must be final: also take the text out of the
                    // guest backup key so the restore prompt won't re-offer it.
                    self._dropFromGuestShadow(text);
                    self.renderList();
                }
            });
            actionBox.appendChild(delBtn);
            item.appendChild(actionBox);
            item.addEventListener('click', function() { self.openEditor(text.id); });
            list.appendChild(item);
            if (focus && focus.id === text.id) {
                setTimeout(function() { self._applyFocusHighlight(item); }, 80);
            }
            });
        });

        // Guest teasers for built-in demo texts — Amitai 2026-04-19 09:23:
        // show the real title + description + preview so guests can see
        // what's on offer and try clicking. Click opens the login prompt.
        if (isGuest && builtinTeasers.length > 0) {
            builtinTeasers.forEach(function(text) {
                var item = document.createElement('div');
                item.className = 'stage-item guest-teaser-item';
                item.style.cursor = 'pointer';
                var preview = text.content ? self._plainText(text.content).substring(0, 60) : '\u05E8\u05D9\u05E7';
                var displayTitle = text.title || '(\u05D8\u05E7\u05E1\u05D8 \u05DC\u05D3\u05D5\u05D2\u05DE\u05D4)';
                item.innerHTML = '<div class="stage-number" style="font-weight:bold;color:#0d9488;display:flex;align-items:center;gap:8px">' +
                        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + displayTitle + '</span>' +
                    '</div>' +
                    '<div style="font-size:0.76em;color:#0f766e;font-weight:700;margin-top:2px">' + self._escapeHtml(self._textCategory(text)) + '</div>' +
                    (text.desc ? '<div style="font-size:0.92em;color:#334155;font-weight:500;margin-top:3px">' + text.desc + '</div>' : '') +
                    '<div class="stage-sentence" style="font-size:0.9em;color:#9ca3af">' + preview + '</div>';
                item.title = '\u05E4\u05EA\u05D7 \u05D8\u05E7\u05E1\u05D8 \u05D3\u05D5\u05D2\u05DE\u05D4';
                item.addEventListener('click', function() { self.openEditor(text.id); });
                container.appendChild(item);
            });
        }
    },

    _showGuestTextLoginPrompt: function() {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px';
        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:14px;max-width:420px;width:100%;padding:22px;direction:rtl;box-shadow:0 12px 40px rgba(0,0,0,0.28);font-family:inherit;text-align:center';
        box.innerHTML =
            '<h3 style="margin:0 0 10px;color:#92400e;font-size:1.15em">\u{1F512} \u05D8\u05E7\u05E1\u05D8\u05D9\u05DD \u05DC\u05D3\u05D5\u05D2\u05DE\u05D4 \u2014 \u05D7\u05E1\u05D5\u05DE\u05D9\u05DD \u05DC\u05D0\u05D5\u05E8\u05D7\u05D9\u05DD</h3>' +
            '<p style="margin:0 0 16px;line-height:1.55;color:#1f2937">\u05E2\u05DC \u05DE\u05E0\u05EA \u05DC\u05D2\u05E9\u05EA \u05DC\u05D8\u05E7\u05E1\u05D8\u05D9\u05DD \u05D4\u05D0\u05DC\u05D4 \u05E2\u05DC\u05D9\u05DA \u05DC\u05D4\u05EA\u05D7\u05D1\u05E8. \u05D0\u05D7\u05E8\u05D9 \u05D4\u05EA\u05D7\u05D1\u05E8\u05D5\u05EA \u05D4\u05DD \u05D9\u05D5\u05E4\u05D9\u05E2\u05D5 \u05DB\u05D0\u05DF, \u05D5\u05EA\u05D5\u05DB\u05DC \u05D2\u05DD \u05DC\u05E2\u05E8\u05D5\u05DA \u05D0\u05D5\u05EA\u05DD \u05D5\u05DC\u05E9\u05DE\u05D5\u05E8 \u05D0\u05D5\u05EA\u05DD \u05D0\u05E6\u05DC\u05DA.</p>' +
            '<div style="display:flex;gap:8px;justify-content:center">' +
            '  <button id="gtxt-login" style="padding:10px 22px;border:none;border-radius:10px;background:#d97706;color:white;font-size:1em;font-weight:bold;cursor:pointer">\u05D4\u05EA\u05D7\u05D1\u05E8</button>' +
            '  <button id="gtxt-cancel" style="padding:10px 18px;border:1px solid #cbd5e1;border-radius:10px;background:white;color:#475569;font-size:1em;cursor:pointer">\u05D1\u05D9\u05D8\u05D5\u05DC</button>' +
            '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        var close = function() { overlay.remove(); };
        box.querySelector('#gtxt-cancel').onclick = close;
        overlay.onclick = function(e) { if (e.target === overlay) close(); };
        box.querySelector('#gtxt-login').onclick = function() {
            close();
            if (typeof PlonterAuth !== 'undefined' && PlonterAuth.showLoginDialog) {
                PlonterAuth.showLoginDialog(function() {
                    try { PlonterTexts.renderList(); } catch (_) {}
                });
            }
        };
    }
};

// Re-render texts list when ContentSync flips sync status (pending → synced,
// stale-token → unsynced). Without this, the green pulsing border would
// stay on forever after the server ACKs a push.
(function _hookTextsContentSyncUpdates() {
    var _pending = null;
    document.addEventListener('contentsync:change', function(e) {
        if (!e || !e.detail || e.detail.contentType !== 'text') return;
        var listEl = document.getElementById('texts-list');
        if (!listEl || listEl.offsetParent === null) return;
        clearTimeout(_pending);
        _pending = setTimeout(function() { try { PlonterTexts.renderList(); } catch (_) {} }, 120);
    });
    document.addEventListener('plonter:authchange', function() {
        var listEl = document.getElementById('texts-list');
        if (!listEl || listEl.offsetParent === null) return;
        try { PlonterTexts.renderList(); } catch (_) {}
    });
})();
