// Lessons — lesson builder and viewer for Plonter v4.18.30
// Allows creating sequences of pages (text, analysis, diacritics, dictionary) and saving as lessons

var LessonManager = (function() {
    'use strict';

    const STORAGE_KEY = 'plonter_lessons';

    // --- Data Layer ---

    function loadLessons() {
        try {
            var lessons = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (!Array.isArray(lessons)) return [];
            var normalized = _normalizeLessonList(lessons);
            if (normalized.changed) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized.lessons));
            }
            return normalized.lessons;
        } catch (e) {
            return [];
        }
    }

    function saveLessons(lessons) {
        try {
            var normalized = _normalizeLessonList(Array.isArray(lessons) ? lessons : []);
            lessons = normalized.lessons;
            // Detect which lessons actually changed vs. what's already on
            // disk, so we only push those to ContentSync. This makes
            // saveLessons the one and only sync entry point — every mutation
            // in this module already funnels through it.
            var changedIds = _detectChangedLessonIds(lessons);

            localStorage.setItem(STORAGE_KEY, JSON.stringify(lessons));

            // Auto-sync to server when logged in. Skip lessons that were
            // created while in guest mode and haven't yet been manually
            // backed up — the user gets to decide via the migration popup
            // / ☁️ button whether to push them. Once a lesson has a meta
            // entry (first manual backup creates it), regular auto-sync
            // resumes on every edit.
            if (changedIds.length &&
                typeof ContentSync !== 'undefined' &&
                typeof ContentSync.save === 'function' &&
                typeof ContentSync.isLoggedIn === 'function' &&
                ContentSync.isLoggedIn()) {
                for (var ci = 0; ci < changedIds.length; ci++) {
                    var l = lessons.find(function(x) { return x.id === changedIds[ci]; });
                    if (!l) continue;
                    if (!_isSyncableLesson(l)) continue;
                    var guestDraft = l._createdAsGuest === true;
                    var hasMeta = false;
                    try {
                        hasMeta = !!(ContentSync.isSynced && ContentSync.isSynced('lesson', l.id));
                        // Also count "has meta but not synced" — a backup in
                        // progress — as "opted in". Only skip when meta is
                        // entirely absent (never touched by backup).
                        if (!hasMeta && typeof ContentSync.getSyncState === 'function') {
                            hasMeta = ContentSync.getSyncState('lesson', l.id) !== 'unsynced';
                        }
                    } catch (_) {}
                    if (guestDraft && !hasMeta) continue;
                    try { ContentSync.save('lesson', l.id, l); }
                    catch (syncErr) { console.warn('[lessons] ContentSync.save threw', syncErr); }
                }
            }
            return true;
        } catch (e) {
            // QuotaExceededError — localStorage is full
            if (typeof MessageManager !== 'undefined') {
                MessageManager.show('השמירה נכשלה — האחסון מלא! נסה לסנכרן שיעורים לשרת ולמחוק ישנים.', 'error');
            } else {
                alert('השמירה נכשלה — האחסון מלא!');
            }
            console.error('saveLessons failed — localStorage quota exceeded', e);
            return false;
        }
    }

    function _normalizeLessonList(lessons) {
        var now = Date.now();
        var changed = false;
        var byId = {};
        var ordered = [];
        var tempTtlMs = 2 * 60 * 60 * 1000; // shared/demo viewer entries should not become permanent trash.

        for (var i = 0; i < lessons.length; i++) {
            var lesson = lessons[i];
            if (!lesson || typeof lesson !== 'object') { changed = true; continue; }
            if (!lesson.id && lesson.local_id) {
                lesson.id = lesson.local_id;
                changed = true;
            }
            if (!lesson.id) { changed = true; continue; }
            if (!lesson.local_id) {
                lesson.local_id = lesson.id;
                changed = true;
            }
            var normalizedCategory = _normalizeLessonCategory(lesson.category);
            if (lesson.category !== normalizedCategory) {
                lesson.category = normalizedCategory;
                changed = true;
            }

            var isTemp = lesson._temporaryLesson === true ||
                String(lesson.id).indexOf('shared_') === 0 ||
                String(lesson.id).indexOf('demo_') === 0;
            if (isTemp) {
                lesson._temporaryLesson = true;
                // Bug #9 — never purge the lesson the user currently has open
                // in the editor or viewer, even if its TTL elapsed while they
                // were reading it.
                var _isOpenNow = (lesson.id === _currentEditorLessonId) ||
                    (_viewerState && _viewerState.lessonId === lesson.id);
                if (!lesson._tempCreatedAt) {
                    // No timestamp → don't delete blindly. A teacher may have
                    // just opened a shared lesson and not cloned it yet. Stamp
                    // it now so it gets a fresh TTL instead of vanishing on the
                    // very next page load (the old code purged it immediately).
                    lesson._tempCreatedAt = new Date(now).toISOString();
                    changed = true;
                }
                if (!_isOpenNow) {
                    var tempTime = Date.parse(lesson._tempCreatedAt);
                    // Only purge when we have a REAL, parseable timestamp that
                    // is genuinely past the TTL. An unparseable stamp is kept
                    // (we just re-stamped on the no-stamp path above).
                    if (tempTime && now - tempTime > tempTtlMs) {
                        changed = true;
                        continue;
                    }
                }
            }

            if (byId[lesson.id] !== undefined) {
                ordered[byId[lesson.id]] = lesson;
                changed = true;
            } else {
                byId[lesson.id] = ordered.length;
                ordered.push(lesson);
            }
        }

        return { lessons: ordered, changed: changed };
    }

    function _isSyncableLesson(lesson) {
        if (!lesson || !lesson.id) return false;
        if (lesson._temporaryLesson === true) return false;
        if (String(lesson.id).indexOf('shared_') === 0) return false;
        if (String(lesson.id).indexOf('demo_') === 0) return false;
        return true;
    }

    function _isReadOnlyLessonSource(lesson) {
        if (!lesson || !lesson.id) return false;
        if (lesson._temporaryLesson === true) return true;
        var id = String(lesson.id);
        return id.indexOf('demo_') === 0 || id.indexOf('shared_') === 0;
    }

    function _isLoggedInForLessonDrafts() {
        return typeof ContentSync !== 'undefined' &&
            typeof ContentSync.isLoggedIn === 'function' &&
            ContentSync.isLoggedIn();
    }

    function _normalizeLessonCategory(category) {
        var value = (category === null || category === undefined) ? '' : String(category).trim();
        if (value.toLowerCase() === 'default') value = '';
        return value || 'כללי';
    }

    function _getLessonCategory(lesson) {
        return _normalizeLessonCategory(lesson && lesson.category);
    }

    function _getLessonCategories(lessons) {
        var seen = {};
        var cats = [];
        (lessons || []).forEach(function(lesson) {
            var cat = _getLessonCategory(lesson);
            if (seen[cat]) return;
            seen[cat] = true;
            cats.push(cat);
        });
        cats.sort(function(a, b) { return a.localeCompare(b, 'he'); });
        return cats;
    }

    function _lessonContinueStatusLabel(lesson) {
        if (!lesson) return 'מגובה';
        var isBuiltin = lesson._isBuiltinSeed === true ||
            (typeof lesson.id === 'string' && (lesson.id.indexOf('seed_') === 0 || lesson.id.indexOf('guestseed_') === 0));
        if (isBuiltin || lesson.source_type === 'builtin_seed' || lesson.source_id) return 'נוצר מדוגמה';
        var hasCS = typeof ContentSync !== 'undefined' && typeof ContentSync.getSyncState === 'function';
        if (hasCS) {
            var state = ContentSync.getSyncState('lesson', lesson.id);
            if (state === 'pending') return 'בתהליך גיבוי...';
            if (state === 'unsynced' || state === 'failed' || state === 'not_backed_up') return 'לא מגובה';
        }
        if (lesson._createdAsGuest === true || lesson.owner === 'guest' || lesson.backup_state === 'not_backed_up') return 'לא מגובה';
        var stamp = Date.parse(lesson.lastAccessed || lesson.updated || lesson.created || 0);
        if (stamp && (Date.now() - stamp) < 14 * 24 * 60 * 60 * 1000) return 'אחרון';
        return 'מגובה';
    }

    var _pendingLessonListFocus = null;

    function _focusLessonInCategory(lesson, opts) {
        if (!lesson || !lesson.id) return;
        _pendingLessonListFocus = {
            id: lesson.id,
            local_id: lesson.local_id || lesson.id,
            category: _getLessonCategory(lesson),
            isNewCategory: !!(opts && opts.isNewCategory)
        };
        var container = document.getElementById('lessons-list');
        if (container) container.dataset.lessonCategoryFilter = _pendingLessonListFocus.category;
    }

    function _persistLessonServerId(localId, serverId) {
        if (!localId || !serverId) return;
        var all = loadLessons();
        var idx = all.findIndex(function(l) { return l.id === localId; });
        if (idx >= 0 && all[idx].serverId !== serverId) {
            all[idx].serverId = serverId;
            if (!all[idx].local_id) all[idx].local_id = all[idx].id;
            saveLessons(all);
        }
    }

    // BUG 7 — clear the legacy lessons_api id from a lesson once it has been
    // adopted/created in content_api. Writes storage DIRECTLY (not via
    // saveLessons) to avoid re-triggering auto-sync. Called by the ContentSync
    // legacy adopter after it creates a content_api row for the lesson.
    function clearLegacyServerId(localId) {
        if (!localId) return;
        try {
            var all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (!Array.isArray(all)) return;
            var changed = false;
            for (var i = 0; i < all.length; i++) {
                if (all[i] && all[i].id === localId && all[i].serverId) {
                    delete all[i].serverId;
                    changed = true;
                }
            }
            if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch (e) { console.warn('[lessons] clearLegacyServerId failed', e); }
    }

    function _detectChangedLessonIds(newLessons) {
        function strip(l) {
            // lastAccessed flips on every open (not a real content change);
            // leaving it in the diff would re-trigger auto-sync every view
            // and flip meta.synced=false during the debounce window.
            var copy = {};
            for (var k in l) if (Object.prototype.hasOwnProperty.call(l, k) && k !== 'lastAccessed') copy[k] = l[k];
            return copy;
        }
        try {
            var prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            var prevMap = {};
            for (var i = 0; i < prev.length; i++) prevMap[prev[i].id] = prev[i];
            var changed = [];
            for (var j = 0; j < newLessons.length; j++) {
                var n = newLessons[j];
                if (!n || !n.id) continue;
                var p = prevMap[n.id];
                if (!p) { changed.push(n.id); continue; }
                if (JSON.stringify(strip(p)) !== JSON.stringify(strip(n))) changed.push(n.id);
            }
            return changed;
        } catch (_) {
            return (newLessons || []).map(function(l) { return l && l.id; }).filter(Boolean);
        }
    }

    // --- Timeline date parsing ---
    // Accepts: YYYY, YYYY.xxx, M/YYYY, D/M/YYYY, 'מרץ 1948', 'ינואר 1949'
    // Returns decimal year (e.g. '22/3/1949' → 1949.222). NaN if unparseable.
    var _HEB_MONTHS = {
        'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4,
        'מאי': 5, 'יוני': 6, 'יולי': 7, 'אוגוסט': 8,
        'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12
    };
    function _daysInMonth(m, y) {
        return new Date(y, m, 0).getDate();
    }
    function _dmyToDecimalYear(d, m, y) {
        if (!y || m < 1 || m > 12 || d < 1 || d > _daysInMonth(m, y)) return NaN;
        var dayOfYear = 0;
        for (var i = 1; i < m; i++) dayOfYear += _daysInMonth(i, y);
        dayOfYear += (d - 1);
        var total = _daysInMonth(2, y) === 29 ? 366 : 365;
        return y + dayOfYear / total;
    }
    function _parseTimelineDate(str) {
        if (str === null || str === undefined) return NaN;
        if (typeof str === 'number') return str;
        var s = String(str).trim();
        if (!s) return NaN;
        // Hebrew month name + year (e.g. 'מרץ 1948', '3 במרץ 1948', '15 באוקטובר 1947')
        var hebMatch = s.match(/^(?:(\d{1,2})\s*(?:ב[־\-]?)?)?\s*([\u0590-\u05FF]+)\s+(\d{3,4})$/);
        if (hebMatch) {
            var hDay = hebMatch[1] ? parseInt(hebMatch[1], 10) : 1;
            var monthName = hebMatch[2].replace(/^ב/, '');
            var mnum = _HEB_MONTHS[monthName];
            if (mnum) {
                var hY = parseInt(hebMatch[3], 10);
                var decH = _dmyToDecimalYear(hDay, mnum, hY);
                if (!isNaN(decH)) return decH;
            }
        }
        // D/M/YYYY or D.M.YYYY or D-M-YYYY
        var dmy = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{3,4})$/);
        if (dmy) {
            var dec = _dmyToDecimalYear(parseInt(dmy[1], 10), parseInt(dmy[2], 10), parseInt(dmy[3], 10));
            if (!isNaN(dec)) return dec;
        }
        // M/YYYY (no day)
        var my = s.match(/^(\d{1,2})[\/.\-](\d{3,4})$/);
        if (my) {
            var mm = parseInt(my[1], 10), yy = parseInt(my[2], 10);
            if (mm >= 1 && mm <= 12) {
                var dec2 = _dmyToDecimalYear(1, mm, yy);
                if (!isNaN(dec2)) return dec2;
            }
        }
        // YYYY-MM-DD (ISO)
        var iso = s.match(/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/);
        if (iso) {
            var decI = _dmyToDecimalYear(parseInt(iso[3], 10), parseInt(iso[2], 10), parseInt(iso[1], 10));
            if (!isNaN(decI)) return decI;
        }
        // Plain year or decimal year (1948, 1949.5)
        var num = parseFloat(s);
        if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(s)) return num;
        return NaN;
    }

    // Human-readable rendering of what the parser read (for live feedback).
    function _formatParsedTimelineDate(dec) {
        if (isNaN(dec)) return '';
        var y = Math.floor(dec);
        var frac = dec - y;
        if (frac < 1e-6) return String(y);
        var total = (_daysInMonth(2, y) === 29) ? 366 : 365;
        var dayOfYear = Math.round(frac * total);
        if (dayOfYear < 0) dayOfYear = 0;
        if (dayOfYear >= total) dayOfYear = total - 1;
        var m = 1, rem = dayOfYear;
        while (m <= 12) {
            var dim = _daysInMonth(m, y);
            if (rem < dim) break;
            rem -= dim;
            m++;
        }
        if (m > 12) { m = 12; rem = _daysInMonth(12, y) - 1; }
        var hebName = Object.keys(_HEB_MONTHS).find(function(k) { return _HEB_MONTHS[k] === m && k !== 'מרס'; });
        return (rem + 1) + ' ב' + (hebName || m) + ' ' + y;
    }

    // Attach the rich placeholder + live "נקרא כ-" feedback + 📅 picker to a date-text input.
    // opts.withPicker: show a 📅 button (default true).
    // opts.defaultDay: day used when picker fills D/M/YYYY (default 1 for tlStart, last day for tlEnd).
    function _attachTimelineDateInputUX(input, opts) {
        if (!input || input.dataset.tlDateWired === '1') return;
        input.dataset.tlDateWired = '1';
        opts = opts || {};
        if (!input.placeholder || input.placeholder === 'זמן' || /^\s*(?:לדוג[׳']|לדוגמא)?\s*:?\s*\d*\s*$/.test(input.placeholder)) {
            input.placeholder = '1948 / 3/1948 / 22/3/1949';
        }
        input.title = 'אפשר: שנה (1948) | חודש/שנה (3/1948) | יום/חודש/שנה (22/3/1949) | שם חודש (מרץ 1948)';

        // Wrap input in a container so the feedback + picker sit next to it
        var wrap = document.createElement('span');
        wrap.style.cssText = 'display:inline-flex;flex-direction:column;gap:2px;position:relative;' + (opts.stretch ? 'flex:' + opts.stretch + ';' : '');
        var parent = input.parentNode;
        if (!parent) return;
        parent.insertBefore(wrap, input);
        var row = document.createElement('span');
        row.style.cssText = 'display:inline-flex;gap:4px;align-items:center';
        wrap.appendChild(row);
        row.appendChild(input);

        if (opts.withPicker !== false) {
            var pickBtn = document.createElement('button');
            pickBtn.type = 'button';
            pickBtn.textContent = '📅';
            pickBtn.tabIndex = -1;
            pickBtn.title = 'בחר תאריך';
            pickBtn.style.cssText = 'background:#f0f9ff;border:1px solid #0284c7;border-radius:6px;cursor:pointer;padding:2px 6px;font-size:1em;line-height:1;flex-shrink:0';
            var hiddenPicker = document.createElement('input');
            hiddenPicker.type = 'date';
            hiddenPicker.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0;left:0;top:0';
            wrap.appendChild(hiddenPicker);
            pickBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                // Pre-fill picker from current text if parseable; otherwise
                // fall back to opts.defaultGetter (used by event-time inputs
                // to default to the timeline's tlStart when the event has
                // no date yet).
                var dec = _parseTimelineDate(input.value);
                if (isNaN(dec) && typeof opts.defaultGetter === 'function') {
                    try { dec = _parseTimelineDate(opts.defaultGetter()); } catch (_) { dec = NaN; }
                }
                if (!isNaN(dec)) {
                    var y = Math.floor(dec);
                    var total = (_daysInMonth(2, y) === 29) ? 366 : 365;
                    var dayOfYear = Math.round((dec - y) * total);
                    var mm = 1, rem = dayOfYear;
                    while (mm <= 12) { var dim = _daysInMonth(mm, y); if (rem < dim) break; rem -= dim; mm++; }
                    if (mm > 12) { mm = 12; rem = _daysInMonth(12, y) - 1; }
                    var pad = function(n) { return (n < 10 ? '0' : '') + n; };
                    hiddenPicker.value = y + '-' + pad(mm) + '-' + pad(rem + 1);
                }
                if (typeof hiddenPicker.showPicker === 'function') {
                    try { hiddenPicker.showPicker(); return; } catch (_) {}
                }
                hiddenPicker.focus();
                hiddenPicker.click();
            });
            hiddenPicker.addEventListener('change', function() {
                var v = hiddenPicker.value;
                if (!v) return;
                var parts = v.split('-');
                if (parts.length !== 3) return;
                var y = parseInt(parts[0], 10);
                var m = parseInt(parts[1], 10);
                var d = parseInt(parts[2], 10);
                input.value = d + '/' + m + '/' + y;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
            });
            row.appendChild(pickBtn);
        }

        if (opts.withFeedback !== false) {
            var feedback = document.createElement('div');
            feedback.className = 'tl-date-feedback';
            feedback.style.cssText = 'font-size:0.75em;color:#0369a1;min-height:14px;line-height:1.1;text-align:right;direction:rtl';
            wrap.appendChild(feedback);
            var _updateFeedback = function() {
                var v = input.value.trim();
                if (!v) { feedback.textContent = ''; feedback.style.color = '#0369a1'; return; }
                var dec = _parseTimelineDate(v);
                if (isNaN(dec)) {
                    feedback.textContent = '⚠ לא הצלחתי לקרוא';
                    feedback.style.color = '#b45309';
                } else {
                    feedback.textContent = 'נקרא כ־' + _formatParsedTimelineDate(dec) + ' ✓';
                    feedback.style.color = '#0369a1';
                }
            };
            input.addEventListener('input', _updateFeedback);
            _updateFeedback();
        } else {
            // Compact mode: show a small ⚠ / ✓ indicator via title only
            var _updateTitle = function() {
                var v = input.value.trim();
                if (!v) { input.style.borderColor = ''; return; }
                var dec = _parseTimelineDate(v);
                if (isNaN(dec)) input.style.borderColor = '#b45309';
                else input.style.borderColor = '#0284c7';
            };
            input.addEventListener('input', _updateTitle);
            _updateTitle();
        }
    }

    function getLesson(id) {
        return loadLessons().find(l => l.id === id) || null;
    }

    function saveSingleLesson(id, data) {
        const lessons = loadLessons();
        const lesson = Object.assign({}, data || {});
        lesson.id = lesson.id || id;
        if (!lesson.id) return Promise.resolve(false);
        const idx = lessons.findIndex(function(l) { return l.id === lesson.id; });
        if (idx >= 0) lessons.splice(idx, 1, lesson);
        else lessons.push(lesson);
        saveLessons(lessons);
        if (typeof ContentSync !== 'undefined' && typeof ContentSync.save === 'function') {
            try {
                ContentSync.save('lesson', lesson.id, lesson);
                if (typeof ContentSync.processQueue === 'function') ContentSync.processQueue();
            } catch (e) {
                console.warn('[lessons] saveSingleLesson ContentSync.save threw', e);
                return Promise.reject(e);
            }
        }
        return Promise.resolve(true);
    }

    function createLesson(title, description, category) {
        const lessons = loadLessons();
        const lesson = {
            id: 'lesson_' + Date.now(),
            local_id: null,
            title: title,
            description: description || '',
            category: _normalizeLessonCategory(category),
            pages: [],
            created: new Date().toISOString(),
            updated: new Date().toISOString()
        };
        lesson.local_id = lesson.id;
        // Mark guest-created lessons so auto-sync leaves them alone — the
        // user has to opt in via the backup popup / ☁️ button. Lessons
        // created while already logged in push to the server automatically.
        const _loggedIn = typeof ContentSync !== 'undefined' &&
            typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
        if (!_loggedIn) lesson._createdAsGuest = true;
        lessons.push(lesson);
        saveLessons(lessons);
        return lesson;
    }

    function updateLesson(id, updates) {
        const lessons = loadLessons();
        const idx = lessons.findIndex(l => l.id === id);
        if (idx === -1) return null;
        Object.assign(lessons[idx], updates, { updated: new Date().toISOString() });
        saveLessons(lessons);
        return lessons[idx];
    }

    function deleteLesson(id) {
        // Also tear down the server copy (if any) so a later pullAll on
        // login doesn't resurrect the lesson the user thought they deleted.
        // Fire-and-forget: local deletion proceeds immediately for snappy
        // UX even if the server round-trip is slow or fails.
        if (typeof ContentSync !== 'undefined' && typeof ContentSync.deleteItem === 'function') {
            try {
                ContentSync.deleteItem('lesson', id).catch(function(err) {
                    console.warn('[deleteLesson] server delete failed', err);
                });
            } catch (e) { console.warn('[deleteLesson] deleteItem threw', e); }
        }
        const lessons = loadLessons().filter(l => l.id !== id);
        saveLessons(lessons);
    }

    function addPage(lessonId, page) {
        const lessons = loadLessons();
        const lesson = lessons.find(l => l.id === lessonId);
        if (!lesson) return null;
        const newPage = {
            id: 'page_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            type: page.type || 'text',
            content: page.content || '',
            title: page.title || '',
            notes: page.notes || ''
        };
        // Copy optional fields
        if (page.imageUrl) newPage.imageUrl = page.imageUrl;
        if (page.videoUrl) newPage.videoUrl = page.videoUrl;
        if (page.sentence) newPage.sentence = page.sentence;
        if (page.bodyText) newPage.bodyText = page.bodyText;
        if (page.notesHidden) newPage.notesHidden = page.notesHidden;
        if (page.audioOnly) newPage.audioOnly = page.audioOnly;
        if (page.dotColor) newPage.dotColor = page.dotColor;
        if (page.verbs) newPage.verbs = page.verbs;
        if (page.events) newPage.events = page.events;
        if (page.tlStart) newPage.tlStart = page.tlStart;
        if (page.tlEnd) newPage.tlEnd = page.tlEnd;
        if (page.interactive) newPage.interactive = page.interactive;
        lesson.pages.push(newPage);
        lesson.updated = new Date().toISOString();
        saveLessons(lessons);
        return newPage;
    }

    function removePage(lessonId, pageId) {
        const lessons = loadLessons();
        const lesson = lessons.find(l => l.id === lessonId);
        if (!lesson) return;
        lesson.pages = lesson.pages.filter(p => p.id !== pageId);
        lesson.updated = new Date().toISOString();
        saveLessons(lessons);
    }

    function movePage(lessonId, pageId, direction) {
        const lessons = loadLessons();
        const lesson = lessons.find(l => l.id === lessonId);
        if (!lesson) return;
        const idx = lesson.pages.findIndex(p => p.id === pageId);
        if (idx === -1) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= lesson.pages.length) return;
        const temp = lesson.pages[idx];
        lesson.pages[idx] = lesson.pages[newIdx];
        lesson.pages[newIdx] = temp;
        lesson.updated = new Date().toISOString();
        saveLessons(lessons);
    }

    function updatePage(lessonId, pageId, updates) {
        const lessons = loadLessons();
        const lesson = lessons.find(l => l.id === lessonId);
        if (!lesson) return null;
        const page = lesson.pages.find(p => p.id === pageId);
        if (!page) return null;
        Object.assign(page, updates);
        lesson.updated = new Date().toISOString();
        // saveLessons returns false when localStorage is full — propagate that
        // as null so callers don't flash a false "saved" indicator (bug #3).
        if (!saveLessons(lessons)) return null;
        return page;
    }

    // --- Export/Import ---

    function exportLesson(id) {
        const lesson = getLesson(id);
        if (!lesson) return null;
        return JSON.stringify(lesson, null, 2);
    }

    function importLesson(jsonStr) {
        try {
            const lesson = JSON.parse(jsonStr);
            if (!lesson.title || !Array.isArray(lesson.pages)) {
                throw new Error('Invalid lesson format');
            }
            var importedSourceId = lesson.source_id || lesson.local_id || lesson.id || lesson.serverId || null;
            lesson.id = 'lesson_' + Date.now();
            lesson.local_id = lesson.id;
            lesson.category = _normalizeLessonCategory(lesson.category);
            if (importedSourceId) lesson.source_id = importedSourceId;
            if (!lesson.source_type) lesson.source_type = 'import';
            delete lesson.serverId;
            if (!_isLoggedInForLessonDrafts()) lesson._createdAsGuest = true;
            lesson.created = new Date().toISOString();
            lesson.updated = new Date().toISOString();
            // Ensure every page has a unique ID
            lesson.pages.forEach(function(page, i) {
                if (!page.id) {
                    page.id = 'page_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4);
                }
            });
            // Silent auto-rename if (title+description) already exists —
            // Amitai 2026-04-19: JSON import must not land on top of an
            // existing lesson with the same title+desc.
            lesson.title = _uniquifyOnTitleDesc(lesson.title, lesson.description || '');
            const lessons = loadLessons();
            lessons.push(lesson);
            saveLessons(lessons);
            return lesson;
        } catch (e) {
            return null;
        }
    }

    // Return a title that's unique within the local lessons list under the
    // (title, description) key. If the exact pair already exists, append
    // " 2", " 3", ... until free. Leaves title alone when there's no
    // collision — titles alone may legitimately repeat if descriptions
    // differ.
    function _uniquifyOnTitleDesc(title, desc) {
        const existing = loadLessons();
        const collides = function(t) {
            return existing.some(function(l) { return l.title === t && (l.description || '') === (desc || ''); });
        };
        if (!collides(title)) return title;
        let n = 2;
        while (collides(title + ' ' + n)) n++;
        return title + ' ' + n;
    }

    // --- UI: Welcome Screen Lessons List ---

    // "חדש!" starburst sticker — red+yellow spiky seal that pops on lessons
    // not yet opened by the viewer (Amitai 2026-05-20: "קוצני, קופץ, בולט").
    function _lpBurstPoints(cx, cy, spikes, outerR, innerR, rotDeg) {
        var pts = [];
        var rot = rotDeg * Math.PI / 180;
        var step = Math.PI / spikes;
        for (var i = 0; i < spikes * 2; i++) {
            var r = (i % 2 === 0) ? outerR : innerR;
            var a = -Math.PI / 2 + i * step + rot;
            pts.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2));
        }
        return pts.join(' ');
    }
    function _newBadgeMarkup() {
        var cx = 70, cy = 70, spikes = 20;
        var yellow = _lpBurstPoints(cx, cy, spikes, 66, 45, 0);
        var red = _lpBurstPoints(cx, cy, spikes, 55, 38, 9); // slight twist for depth
        return '<svg class="lp-newbadge" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-label="חדש">' +
            '<polygon points="' + yellow + '" fill="#FFD400"/>' +
            '<polygon points="' + red + '" fill="#E2231A"/>' +
            '<text x="70" y="71" text-anchor="middle" dominant-baseline="central" ' +
            'font-family="Arial Hebrew, Arial, sans-serif" font-weight="900" font-size="34" ' +
            'fill="#fff" stroke="#9b0b06" stroke-width="0.9" paint-order="stroke" style="direction:rtl">חדש!</text>' +
            '</svg>';
    }
    function _ensureNewBadgeCSS() {
        if (document.getElementById('lp-newbadge-css')) return;
        var st = document.createElement('style');
        st.id = 'lp-newbadge-css';
        st.textContent =
            '.lp-newbadge-wrap{position:absolute;top:-10px;left:-10px;width:48px;height:48px;pointer-events:none;z-index:5;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))}' +
            '.lp-newbadge{width:100%;height:100%;transform-origin:center;animation:lpNewPop 1.1s ease-in-out infinite}' +
            '@keyframes lpNewPop{0%,100%{transform:rotate(-12deg) scale(1)}45%{transform:rotate(-8deg) scale(1.16)}}';
        document.head.appendChild(st);
    }

    function renderLessonsList() {
        const container = document.getElementById('lessons-list');
        if (!container) return;
        const rawLessons = loadLessons();
        container.innerHTML = '';

        // UX #3 — friendlier cloud wording. Rename the app-chrome sync button
        // from the ambiguous "☁️ סנכרון" to "☁️ גיבוי לענן" (done at runtime so
        // the change stays inside lessons.js; index.html chrome is @6m-owned),
        // and show a one-line guest banner explaining that guest work lives
        // only in this browser until they back it up.
        (function _lessonsCloudWording() {
            var _syncBtn = document.getElementById('sync-lessons-btn');
            if (_syncBtn && _syncBtn.textContent.indexOf('גיבוי לענן') === -1) {
                _syncBtn.textContent = '☁️ גיבוי לענן';
            }
            var _csReady = typeof ContentSync !== 'undefined' && typeof ContentSync.isLoggedIn === 'function';
            var _isGuest = _csReady && !ContentSync.isLoggedIn();
            var _bannerId = 'lessons-guest-banner';
            var _banner = document.getElementById(_bannerId);
            if (_isGuest) {
                if (!_banner) {
                    _banner = document.createElement('div');
                    _banner.id = _bannerId;
                    _banner.style.cssText = 'direction:rtl;text-align:center;background:#fef9c3;border:1px solid #fde047;' +
                        'color:#854d0e;border-radius:12px;padding:9px 12px;margin:0 auto 10px;max-width:460px;font-size:.9em;line-height:1.4';
                    // Amitai via @6m 2026-06-06: "התחבר כאן" is a real text-link that
                    // opens the existing login flow (clicks the main #auth-login-btn, or
                    // falls back to PlonterAuth.showLoginDialog).
                    _banner.innerHTML = '💡 השיעורים נשמרים רק בדפדפן הזה. ' +
                        '<a href="#" id="lessons-guest-login-link" ' +
                        'style="color:#0d9488;font-weight:bold;text-decoration:underline;cursor:pointer">התחבר כאן</a>' +
                        ' כדי לגבות אותם בענן.';
                    container.parentNode.insertBefore(_banner, container);
                    var _guestLoginLink = document.getElementById('lessons-guest-login-link');
                    if (_guestLoginLink) {
                        _guestLoginLink.addEventListener('click', function(e) {
                            e.preventDefault();
                            var _mainLogin = document.getElementById('auth-login-btn');
                            if (_mainLogin) {
                                _mainLogin.click();
                            } else if (typeof PlonterAuth !== 'undefined' && typeof PlonterAuth.showLoginDialog === 'function') {
                                PlonterAuth.showLoginDialog(function() {});
                            }
                        });
                    }
                }
            } else if (_banner) {
                _banner.remove();
            }
        })();

        // Hide temporary demo copies (id prefix 'demo_') — those are pushed
        // into loadLessons only so startLessonViewer can read them, not to
        // appear in the user's own list.
        const lessons = rawLessons.filter(function(l) { return !(l.id && String(l.id).indexOf('demo_') === 0); });

        if (lessons.length === 0) {
            // Amitai 2026-04-19 08:47: removed the 'רוצה מערכי שיעור?
            // לחץ כאן' CTA — the demo lessons section below is already
            // visible to everyone, so the scroll-down teaser was
            // redundant. Keep the plain empty state.
            // UX #1 — inviting empty-state card + arrow pointing the first-time
            // teacher straight to creating a lesson, instead of plain grey text.
            // Amitai 2026-06-06: make the empty-state CTA "קצת קופץ ומגניב" — the 📚 icon
            // bounces and the "+ שיעור חדש" pill gently pulses to draw the first-time
            // teacher's eye. Animations live on inner elements (not the card) so they don't
            // fight the card's JS hover-transform. Disabled under prefers-reduced-motion.
            if (!document.getElementById('lessons-empty-cta-anim-style')) {
                var _ctaStyle = document.createElement('style');
                _ctaStyle.id = 'lessons-empty-cta-anim-style';
                _ctaStyle.textContent =
                    '@keyframes lpCtaBounce{0%,100%{transform:translateY(0)}20%{transform:translateY(-10px)}40%{transform:translateY(0)}55%{transform:translateY(-5px)}70%{transform:translateY(0)}}' +
                    '@keyframes lpCtaPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}' +
                    '@media (prefers-reduced-motion: no-preference){' +
                    '.lp-cta-bounce{display:inline-block;animation:lpCtaBounce 1.9s ease-in-out infinite}' +
                    '.lp-cta-pulse{animation:lpCtaPulse 1.9s ease-in-out infinite}}';
                document.head.appendChild(_ctaStyle);
            }
            container.innerHTML =
                '<div id="lessons-empty-cta" role="button" tabindex="0" ' +
                    'style="cursor:pointer;direction:rtl;text-align:center;margin:8px auto 4px;max-width:420px;' +
                    'background:linear-gradient(135deg,#0d9488,#0891b2);color:white;border-radius:18px;padding:26px 20px;' +
                    'box-shadow:0 6px 18px rgba(13,148,136,.25);transition:transform .15s,box-shadow .15s">' +
                    '<div class="lp-cta-bounce" style="font-size:2.4em;line-height:1;margin-bottom:10px">📚</div>' +
                    '<div style="font-size:1.25em;font-weight:900;margin-bottom:6px">התחל כאן</div>' +
                    '<div style="font-size:.95em;opacity:.92;margin-bottom:14px">בנה את השיעור הראשון שלך — זה קל</div>' +
                    '<div class="lp-cta-pulse" style="display:inline-block;background:white;color:#0d9488;font-weight:900;font-size:1.05em;' +
                        'border-radius:999px;padding:10px 22px">⬅ + שיעור חדש</div>' +
                '</div>';
            var _emptyCta = document.getElementById('lessons-empty-cta');
            if (_emptyCta) {
                var _fireCreate = function() {
                    var _btn = document.getElementById('create-lesson-btn');
                    if (_btn) { _btn.click(); } else { showCreateDialog(); }
                };
                _emptyCta.addEventListener('click', _fireCreate);
                _emptyCta.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _fireCreate(); }
                });
                _emptyCta.addEventListener('mouseenter', function() {
                    _emptyCta.style.transform = 'translateY(-2px)';
                    _emptyCta.style.boxShadow = '0 10px 24px rgba(13,148,136,.32)';
                });
                _emptyCta.addEventListener('mouseleave', function() {
                    _emptyCta.style.transform = '';
                    _emptyCta.style.boxShadow = '0 6px 18px rgba(13,148,136,.25)';
                });
            }
            return;
        }

        // Sort by last used (most recent first)
        lessons.sort(function(a, b) {
            return new Date(b.lastAccessed || b.updated || b.created || 0) - new Date(a.lastAccessed || a.updated || a.created || 0);
        });

        // Two-direction visibility (Amitai 2026-04-19):
        // - Guest: hide already-synced lessons — safe on the server, will
        //   reappear after login. Fresh visitors only see unsynced drafts.
        // - Logged-in: hide lessons flagged _createdAsGuest that remain
        //   unsynced. Amitai explicitly asked "when logged in I want only
        //   the backed-up ones". In-session creates (no _createdAsGuest
        //   flag) stay visible during their sync debounce so the list
        //   doesn't flicker empty right after "שיעור חדש".
        const _hasCS = typeof ContentSync !== 'undefined';
        const _loggedInNow = _hasCS && typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
        const _guestMode = _hasCS && typeof ContentSync.isLoggedIn === 'function' && !ContentSync.isLoggedIn();
        let visibleLessons;
        if (_guestMode) {
            visibleLessons = lessons.filter(function(l) { return !(ContentSync.isSynced && ContentSync.isSynced('lesson', l.id)); });
        } else if (_loggedInNow) {
            visibleLessons = lessons.filter(function(l) {
                if (!l._createdAsGuest) return true;
                return ContentSync.isSynced && ContentSync.isSynced('lesson', l.id);
            });
        } else {
            visibleLessons = lessons;
        }

        if (_guestMode && visibleLessons.length === 0) {
            container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px">כל השיעורים שלך גובו לשרת ✓<br>התחבר כדי לראות אותם.</p>';
            return;
        }
        if (_loggedInNow && visibleLessons.length === 0 && lessons.length > 0) {
            container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px">יש שיעורים לא-מגובים שממתינים להחלטה 🕐<br>פתח את חלון הגיבוי כדי לבחור מה לדחוף לשרת.</p>';
            return;
        }

        var categories = _getLessonCategories(visibleLessons);
        var selectedCategory = container.dataset.lessonCategoryFilter || 'all';
        if (selectedCategory !== 'all' && categories.indexOf(selectedCategory) === -1) {
            selectedCategory = 'all';
            container.dataset.lessonCategoryFilter = 'all';
        }
        if (_pendingLessonListFocus && categories.indexOf(_pendingLessonListFocus.category) !== -1) {
            selectedCategory = _pendingLessonListFocus.category;
            container.dataset.lessonCategoryFilter = selectedCategory;
        }
        var filteredLessons = selectedCategory === 'all'
            ? visibleLessons
            : visibleLessons.filter(function(lesson) { return _getLessonCategory(lesson) === selectedCategory; });

        var continueLessons = filteredLessons.filter(function(lesson) {
            if (lesson.lastAccessed) return true;
            if (lesson._createdAsGuest || lesson.source_id || lesson.source_type) return true;
            if (!_hasCS || !ContentSync.getSyncState) return false;
            var state = ContentSync.getSyncState('lesson', lesson.id);
            return state === 'unsynced' || state === 'pending' || state === 'failed' || state === 'not_backed_up';
        }).slice(0, 4);

        if (continueLessons.length) {
            var contSection = document.createElement('div');
            contSection.className = 'lesson-continue-section';
            contSection.style.cssText = 'margin:4px 0 12px;direction:rtl';
            var contTitle = document.createElement('div');
            contTitle.textContent = 'המשך עבודה';
            contTitle.style.cssText = 'font-size:.95em;font-weight:900;color:#0f766e;margin:0 0 8px';
            contSection.appendChild(contTitle);
            var contGrid = document.createElement('div');
            contGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px';
            continueLessons.forEach(function(lesson) {
                var card = document.createElement('button');
                card.type = 'button';
                card.style.cssText = 'text-align:right;border:1px solid #99f6e4;border-right:4px solid #0d9488;background:#f0fdfa;border-radius:8px;padding:9px 10px;cursor:pointer;min-height:66px;font-family:inherit;color:#0f172a';
                var cat = _getLessonCategory(lesson);
                var pages = (lesson.pages ? lesson.pages.length : 0);
                var statusLabel = _lessonContinueStatusLabel(lesson);
                var previewText = (lesson.description && String(lesson.description).trim())
                    ? String(lesson.description).trim()
                    : (pages + ' דפים');
                card.innerHTML =
                    '<div style="display:flex;gap:6px;align-items:center;justify-content:space-between;margin-bottom:5px">' +
                        '<b style="font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(lesson.title) + '</b>' +
                        '<span style="font-size:.72em;font-weight:800;background:#fff;color:#0f766e;border:1px solid #99f6e4;border-radius:999px;padding:1px 7px;white-space:nowrap">' + escapeHtml(statusLabel) + '</span>' +
                    '</div>' +
                    '<div style="font-size:.76em;color:#0f766e;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(cat) + '</div>' +
                    '<div style="font-size:.78em;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(previewText) + '</div>';
                card.addEventListener('click', function() { openLessonEditor(lesson.id); });
                contGrid.appendChild(card);
            });
            contSection.appendChild(contGrid);
            container.appendChild(contSection);
        }

        var filterWrap = document.createElement('div');
        filterWrap.className = 'lesson-category-filter';
        filterWrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 12px 0;direction:rtl';
        var label = document.createElement('span');
        label.textContent = 'קטגוריות:';
        label.style.cssText = 'font-size:0.85em;color:#475569;font-weight:bold';
        filterWrap.appendChild(label);
        ['all'].concat(categories).forEach(function(cat) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = cat === 'all' ? 'הכל' : cat;
            var active = selectedCategory === cat;
            btn.style.cssText = 'border:1px solid ' + (active ? '#0d9488' : '#cbd5e1') + ';background:' + (active ? '#ccfbf1' : 'white') + ';color:' + (active ? '#0f766e' : '#334155') + ';border-radius:999px;padding:5px 10px;cursor:pointer;font-size:0.85em;font-weight:' + (active ? 'bold' : '500');
            btn.addEventListener('click', function() {
                container.dataset.lessonCategoryFilter = cat;
                renderLessonsList();
            });
            filterWrap.appendChild(btn);
        });
        container.appendChild(filterWrap);

        if (filteredLessons.length === 0) {
            var emptyMsg = document.createElement('p');
            emptyMsg.style.cssText = 'color:#9ca3af;text-align:center;padding:16px';
            emptyMsg.textContent = 'אין שיעורים בקטגוריה הזו.';
            container.appendChild(emptyMsg);
            return;
        }

        var categoryLists = {};
        var renderCategories = _getLessonCategories(filteredLessons);
        renderCategories.forEach(function(cat) {
            var section = document.createElement('div');
            section.className = 'lesson-category-section';
            section.style.cssText = 'margin:0 0 14px 0';
            if (_pendingLessonListFocus && _pendingLessonListFocus.category === cat) {
                section.style.cssText += ';border:2px solid #22c55e;background:#f0fdf4;border-radius:10px;padding:10px';
                setTimeout(function() { section.style.borderColor = '#ccfbf1'; section.style.background = 'transparent'; }, 2200);
            }
            var title = document.createElement('h3');
            title.textContent = cat + ((_pendingLessonListFocus && _pendingLessonListFocus.category === cat && _pendingLessonListFocus.isNewCategory) ? ' · קטגוריה חדשה' : '');
            title.style.cssText = 'margin:0 0 8px 0;color:#0d9488;font-size:1.05em;border-bottom:1px solid #ccfbf1;padding-bottom:4px';
            var list = document.createElement('div');
            list.className = 'stages-list';
            section.appendChild(title);
            section.appendChild(list);
            categoryLists[cat] = list;
            container.appendChild(section);
        });

        filteredLessons.forEach(function(lesson) {
            const item = document.createElement('div');
            item.className = 'stage-item lesson-item';
            item.style.cursor = 'pointer';
            item.dataset.lessonId = lesson.id;

            const pagesCount = (lesson.pages && lesson.pages.length) ? lesson.pages.length : 0;
            const dateStr = new Date(lesson.updated).toLocaleDateString('he-IL');
            const hasContentSync = typeof ContentSync !== 'undefined';
            // Built-in seeds (guest playground copies) shouldn't carry sync
            // state — they're static examples, not user content. Amitai
            // 2026-04-19 20:41: "don't show 'לא מגובה' on built-ins."
            const isBuiltin = lesson._isBuiltinSeed === true ||
                (typeof lesson.id === 'string' && (lesson.id.indexOf('seed_') === 0 || lesson.id.indexOf('guestseed_') === 0));
            const isSynced = !isBuiltin && hasContentSync && ContentSync.isSynced && ContentSync.isSynced('lesson', lesson.id);
            const syncState = isBuiltin ? 'builtin'
                : ((hasContentSync && typeof ContentSync.getSyncState === 'function')
                    ? ContentSync.getSyncState('lesson', lesson.id)
                    : (isSynced ? 'synced' : 'unsynced'));
            const syncBadge = isBuiltin ? ''
                : ((hasContentSync && ContentSync.getSyncBadge)
                    ? ContentSync.getSyncBadge('lesson', lesson.id)
                    : '');

            // Three-state visual: pulsing green border while the item is
            // queued for sync, yellow dashed when truly unsynced (guest /
            // failed), nothing when server-acked. The old "unsynced = yellow"
            // path flashed yellow during every save's 2s debounce, which
            // Amitai found alarming (ghost-of-unsynced).
            if (hasContentSync && syncState === 'pending') {
                item.classList.add('lesson-syncing');
                item.style.border = '2px solid #6ee7b7';
                item.style.background = '#ecfdf5';
                item.style.animation = 'cs-card-pulse 1.4s ease-in-out infinite';
            } else if (hasContentSync && syncState === 'unsynced') {
                item.classList.add('lesson-unsynced');
                item.style.border = '2px dashed #f59e0b';
                item.style.background = '#fffbeb';
            }

            // Description gets its own line with slightly bolder styling
            // so the eye catches it — Amitai 2026-04-19 03:19. The thin
            // metadata line (pages count + date) stays small and gray.
            const descLine = lesson.description
                ? '<div style="font-size:0.92em;color:#334155;font-weight:500;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(lesson.description) + '</div>'
                : '';
            const categoryBadge = '<span style="display:inline-flex;align-items:center;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;border-radius:999px;padding:1px 7px;font-size:0.72em;font-weight:700;white-space:nowrap">קטגוריה: ' + escapeHtml(_getLessonCategory(lesson)) + '</span>';
            item.innerHTML =
                '<div style="flex:1;min-width:0;overflow:hidden">' +
                    '<div class="stage-number" style="font-size:1.05em;font-weight:bold;color:#0d9488;display:flex;align-items:center;gap:8px;min-width:0">' +
                        '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">' + escapeHtml(lesson.title) + '</span>' +
                        categoryBadge +
                        syncBadge +
                    '</div>' +
                    descLine +
                    '<div style="font-size:0.8em;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                        pagesCount + ' דפים · ' + dateStr +
                    '</div>' +
                '</div>';

            // NOTE: the "חדש!" sticker is intentionally NOT shown here. Amitai
            // 2026-05-20: never show "חדש" on lessons the user created himself —
            // the badge belongs only on demo/example lessons (see renderDemoLessons).

            // Action buttons
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:6px;align-items:center';

            // View button (eye icon — opens presentation)
            const viewBtn = document.createElement('button');
            viewBtn.className = 'btn btn-secondary';
            viewBtn.innerHTML = '👁️';
            viewBtn.title = 'צפה בשיעור';
            viewBtn.style.cssText = 'padding:4px 8px;font-size:0.9em';
            viewBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                startLessonViewer(lesson.id);
            });

            // Export button
            const expBtn = document.createElement('button');
            expBtn.className = 'btn btn-secondary';
            expBtn.innerHTML = '📤';
            expBtn.title = 'ייצוא שיעור';
            expBtn.style.cssText = 'padding:4px 8px;font-size:0.9em';
            expBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const json = exportLesson(lesson.id);
                if (json) {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(json).catch(function() {
                            _fallbackCopy(json);
                        });
                    } else {
                        _fallbackCopy(json);
                    }
                    _showEditorToast('JSON שיעור הועתק ✓');
                }
            });

            // Delete button (small X at top-right)
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '✕';
            delBtn.title = 'מחק שיעור';
            delBtn.style.cssText = 'position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:1px solid #e5e7eb;background:white;cursor:pointer;font-size:0.75em;color:#94a3b8;display:flex;align-items:center;justify-content:center;transition:all 0.2s;padding:0;line-height:1';
            delBtn.addEventListener('mouseenter', function() { delBtn.style.background = '#fee2e2'; delBtn.style.color = '#dc2626'; delBtn.style.borderColor = '#dc2626'; });
            delBtn.addEventListener('mouseleave', function() { delBtn.style.background = 'white'; delBtn.style.color = '#94a3b8'; delBtn.style.borderColor = '#e5e7eb'; });
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _showStyledConfirm('למחוק את השיעור "' + lesson.title + '"?', function() {
                    // Delete the media folder for this lesson
                    if (typeof MediaStorage !== 'undefined' && MediaStorage.loadFolders) {
                        MediaStorage.loadFolders().then(function() {
                            MediaStorage.apiCall('list_folders').then(function(data) {
                                var allFolders = data.folders || [];
                                var lessonsFolder = allFolders.find(function(f) { return f.name === 'שיעורים' && (!f.parent_id || f.parent_id === '0'); });
                                if (lessonsFolder) {
                                    var lessonFolder = allFolders.find(function(f) {
                                        return f.name === lesson.title && parseInt(f.parent_id) === parseInt(lessonsFolder.id);
                                    });
                                    if (lessonFolder) {
                                        MediaStorage.apiCall('delete_folder', { id: parseInt(lessonFolder.id) });
                                    }
                                }
                            });
                        });
                    }
                    // Snapshot the lesson record so the delete is undoable
                    // (UX #9). Undo re-saves the local record; it does not
                    // re-create the deleted media folder, and it does not add
                    // any new server-delete logic (bug #6 server semantics
                    // left untouched — saveLessons' existing auto-sync applies).
                    var _restoreLesson = JSON.parse(JSON.stringify(lesson));
                    deleteLesson(lesson.id);
                    renderLessonsList();
                    _showUndoToast('השיעור נמחק', function() {
                        var lessons = loadLessons();
                        if (lessons.some(function(l) { return l.id === _restoreLesson.id; })) { renderLessonsList(); return; }
                        lessons.push(_restoreLesson);
                        saveLessons(lessons);
                        renderLessonsList();
                    });
                });
            });

            // Edit button (pencil — edit title & description)
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-secondary';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'ערוך שם ותיאור';
            editBtn.style.cssText = 'padding:4px 8px;font-size:0.9em';
            editBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
                overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
                var dlg = document.createElement('div');
                dlg.style.cssText = 'background:white;border-radius:16px;padding:24px;max-width:420px;width:90%;direction:rtl;text-align:right;box-shadow:0 8px 32px rgba(0,0,0,0.2)';
                var editCategoryOptions = _getLessonCategories(loadLessons()).map(function(cat) {
                    return '<option value="' + escapeHtml(cat).replace(/"/g, '&quot;') + '"></option>';
                }).join('');
                dlg.innerHTML =
                    '<h3 style="color:#0d9488;margin:0 0 16px 0;text-align:center">\u05E2\u05E8\u05D9\u05DB\u05EA \u05E9\u05D9\u05E2\u05D5\u05E8</h3>' +
                    '<label style="font-weight:bold;font-size:0.9em">\u05E9\u05DD:</label>' +
                    '<input type="text" id="edit-lesson-title" dir="rtl" value="' + escapeHtml(lesson.title).replace(/"/g, '&quot;') + '" style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 12px 0;box-sizing:border-box">' +
                    '<label style="font-weight:bold;font-size:0.9em">\u05EA\u05D9\u05D0\u05D5\u05E8:</label>' +
                    '<input type="text" id="edit-lesson-desc" dir="rtl" value="' + escapeHtml(lesson.description || '').replace(/"/g, '&quot;') + '" style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 12px 0;box-sizing:border-box">' +
                    '<label style="font-weight:bold;font-size:0.9em">קטגוריה:</label>' +
                    '<input type="text" id="edit-lesson-category" list="edit-lesson-category-suggestions" dir="rtl" value="' + escapeHtml(_getLessonCategory(lesson)).replace(/"/g, '&quot;') + '" style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 16px 0;box-sizing:border-box">' +
                    '<datalist id="edit-lesson-category-suggestions">' + editCategoryOptions + '</datalist>' +
                    '<div style="display:flex;gap:10px;justify-content:center">' +
                    '<button id="edit-lesson-save" style="padding:10px 24px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05E9\u05DE\u05D5\u05E8</button>' +
                    '<button id="edit-lesson-cancel" style="padding:10px 24px;background:#e5e7eb;color:#333;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05D1\u05D9\u05D8\u05D5\u05DC</button></div>';
                overlay.appendChild(dlg);
                document.body.appendChild(overlay);
                document.getElementById('edit-lesson-title').focus();
                document.getElementById('edit-lesson-cancel').onclick = function() { overlay.remove(); };
                document.getElementById('edit-lesson-save').onclick = function() {
                    var newTitle = document.getElementById('edit-lesson-title').value.trim();
                    if (!newTitle) { document.getElementById('edit-lesson-title').style.borderColor = '#ef4444'; return; }
                    var newDesc = document.getElementById('edit-lesson-desc').value.trim();
                    var newCategory = _normalizeLessonCategory(document.getElementById('edit-lesson-category').value);
                    var oldTitle = lesson.title;
                    var lessons = loadLessons();
                    var idx = lessons.findIndex(function(l) { return l.id === lesson.id; });
                    if (idx >= 0) { lessons[idx].title = newTitle; lessons[idx].description = newDesc; lessons[idx].category = newCategory; lessons[idx].updated = new Date().toISOString(); saveLessons(lessons); }
                    // Rename media folder to match new title
                    if (newTitle !== oldTitle && typeof MediaStorage !== 'undefined' && MediaStorage.renameLessonFolder) {
                        MediaStorage.renameLessonFolder(oldTitle, newTitle);
                    }
                    overlay.remove();
                    var updatedLesson = getLesson(lesson.id);
                    if (updatedLesson) _focusLessonInCategory(updatedLesson);
                    renderLessonsList();
                };
                document.getElementById('edit-lesson-title').addEventListener('keydown', function(ev) { if (ev.key === 'Enter') document.getElementById('edit-lesson-save').click(); });
            });

            actions.appendChild(editBtn);
            actions.appendChild(viewBtn);
            actions.appendChild(expBtn);

            // COLLAB_SHARE_20260604 — GENERIC share button (identical call as every
            // content type). Shown when the lesson is synced (has a server id).
            try {
                var _lsMeta = JSON.parse(localStorage.getItem('plonter_sync_meta') || '{}')['lesson:' + lesson.id];
                var _lsSid = _lsMeta && _lsMeta.serverId;
                if (_lsSid && window.ContentShare) {
                    var shareBtn = document.createElement('button');
                    shareBtn.className = 'btn btn-secondary';
                    shareBtn.innerHTML = '🔗';
                    shareBtn.title = 'שתף';
                    shareBtn.style.cssText = 'padding:4px 8px;font-size:0.9em';
                    shareBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        ContentShare.openShareDialog({ contentId: _lsSid, contentType: 'lesson', title: lesson.title });
                    });
                    actions.appendChild(shareBtn);
                }
            } catch (_) {}

            // Per-lesson backup button — unsynced items always get this button.
            // If the user is logged in, click backs up to the server. If a
            // guest clicks it, trigger the login dialog; sync fires after a
            // successful login via the pending-callback in PlonterAuth.
            if (hasContentSync && ContentSync.save && !isSynced) {
                const _loggedIn = typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
                const backupBtn = document.createElement('button');
                backupBtn.className = 'btn btn-secondary';
                backupBtn.innerHTML = '☁️';
                backupBtn.title = _loggedIn
                    ? 'גבה שיעור לשרת'
                    : 'התחבר כדי לגבות לשרת';
                backupBtn.style.cssText = 'padding:4px 8px;font-size:0.95em;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;font-weight:bold';
                backupBtn.addEventListener('click', async function(e) {
                    e.stopPropagation();
                    async function _performBackup() {
                        backupBtn.disabled = true;
                        var origHtml = backupBtn.innerHTML;
                        backupBtn.innerHTML = '⏳';
                        try {
                            // syncNow surfaces the real API error instead of
                            // silently leaving meta.synced=false like save()
                            // does. We still want save() side effects for
                            // the queue+badge flow, so call both.
                            ContentSync.save('lesson', lesson.id, lesson);
                            var res = ContentSync.syncNow
                                ? await ContentSync.syncNow('lesson', lesson.id)
                                : (ContentSync.processQueue ? (await ContentSync.processQueue(), { success: !!(ContentSync.isSynced && ContentSync.isSynced('lesson', lesson.id)) }) : { success: false, error: 'ContentSync לא זמין' });
                            if (res && res.success) {
                                if (typeof MessageManager !== 'undefined') MessageManager.show('השיעור גובה לשרת ✓', 'success');
                                // contentsync:change event re-renders; button is replaced
                            } else {
                                var errMsg = (res && res.error) ? res.error : 'שגיאה לא ידועה';
                                // Stale token — client state says logged-in but server rejects.
                                // Clear the stale token so the UI is consistent, then prompt re-login.
                                if (errMsg.indexOf('נדרשת התחברות') !== -1 || errMsg.indexOf('לא מחובר') !== -1) {
                                    // Client state says logged-in but server rejects the token.
                                    // Clear the stale token, reset auth-status UI, then open the
                                    // inline email+password popup — PlonterAuth.showLoginDialog
                                    // would early-return because its _currentUser is still set.
                                    try {
                                        localStorage.removeItem('plonter_auth_token');
                                        localStorage.removeItem('plonter_auth_token_user');
                                        var authStatus = document.getElementById('auth-status');
                                        if (authStatus) {
                                            authStatus.innerHTML = '<button id="auth-login-btn" style="padding:6px 14px;border:1px solid rgba(255,255,255,0.4);border-radius:8px;background:rgba(255,255,255,0.15);color:white;cursor:pointer;font-size:0.85em;font-weight:bold">התחבר</button>';
                                            var lb = document.getElementById('auth-login-btn');
                                            if (lb) lb.addEventListener('click', function() {
                                                _showBackupLoginPrompt(lesson, _performBackup);
                                            });
                                        }
                                    } catch (_) {}
                                    if (typeof MessageManager !== 'undefined') MessageManager.show('פג תוקף ההתחברות בשרת — התחבר שוב', 'warning');
                                    backupBtn.disabled = false;
                                    backupBtn.innerHTML = origHtml;
                                    _showLoginConfirmForBackup(lesson, function() {
                                        _showBackupLoginPrompt(lesson, _performBackup);
                                    });
                                } else {
                                    if (typeof MessageManager !== 'undefined') MessageManager.show('הגיבוי נכשל: ' + errMsg, 'error');
                                    backupBtn.disabled = false;
                                    backupBtn.innerHTML = origHtml;
                                }
                            }
                        } catch (err) {
                            console.error('[backup-btn] failed:', err);
                            if (typeof MessageManager !== 'undefined') MessageManager.show('שגיאה בגיבוי: ' + (err && err.message ? err.message : err), 'error');
                            backupBtn.disabled = false;
                            backupBtn.innerHTML = origHtml;
                        }
                    }
                    var nowLoggedIn = typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
                    if (!nowLoggedIn) {
                        _showLoginConfirmForBackup(lesson, function() {
                            // Prefer the host auth screen (PlonterAuth →
                            // AuthEmail.showLogin). Fall back to our inline
                            // popup if that entry point isn't available.
                            if (typeof PlonterAuth !== 'undefined' && typeof PlonterAuth.showLoginDialog === 'function') {
                                PlonterAuth.showLoginDialog(function() { _performBackup(); });
                            } else {
                                _showBackupLoginPrompt(lesson, _performBackup);
                            }
                        });
                        return;
                    }
                    _performBackup();
                });
                actions.appendChild(backupBtn);
            }

            item.style.position = 'relative';
            item.appendChild(delBtn);
            item.appendChild(actions);

            // Click on card → open editor
            item.addEventListener('click', function() {
                openLessonEditor(lesson.id);
            });

            var targetList = categoryLists[_getLessonCategory(lesson)] || container;
            targetList.appendChild(item);
            if (_pendingLessonListFocus && _pendingLessonListFocus.id === lesson.id) {
                // #1161 (Amitai via @6m 2026-06-06): on returning to the list, mark the item you
                // exited with a clear green BORDER + glow + 2 gentle bounces, then smooth-scroll it
                // to center (not a jump to top). Outline (not border) avoids reflow.
                if (!document.getElementById('lessons-return-focus-style')) {
                    var _rfStyle = document.createElement('style');
                    _rfStyle.id = 'lessons-return-focus-style';
                    _rfStyle.textContent = '@keyframes lpReturnBounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-8px)}60%{transform:translateY(0)}}';
                    document.head.appendChild(_rfStyle);
                }
                item.style.outline = '3px solid #16a34a';
                item.style.outlineOffset = '2px';
                item.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.35), 0 8px 24px rgba(13,148,136,0.18)';
                item.style.animation = 'lpReturnBounce .55s ease-in-out 2';
                setTimeout(function() {
                    try { item.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { item.scrollIntoView(); }
                }, 80);
                setTimeout(function() {
                    item.style.outline = '';
                    item.style.outlineOffset = '';
                    item.style.boxShadow = '';
                    item.style.animation = '';
                }, 2800);
                _pendingLessonListFocus = null;
            }
        });
    }

    // --- UI: Create Lesson Dialog ---

    function showCreateDialog() {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'lesson-create-modal';
        var categoryOptions = _getLessonCategories(loadLessons()).map(function(cat) {
            return '<option value="' + escapeHtml(cat).replace(/"/g, '&quot;') + '"></option>';
        }).join('');
        modal.innerHTML =
            '<div class="modal-content" style="max-width:420px">' +
                '<span class="close">&times;</span>' +
                '<h2 style="margin-bottom:16px;color:#0d9488">שיעור חדש</h2>' +
                '<div style="margin-bottom:12px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">שם השיעור</label>' +
                    '<input type="text" id="lesson-title-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:1em" dir="rtl" placeholder="לדוגמה: שיעור 3 — הפתוא">' +
                '</div>' +
                '<div style="margin-bottom:16px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">תיאור (אופציונלי)</label>' +
                    '<input type="text" id="lesson-desc-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:1em" dir="rtl" placeholder="תיאור קצר...">' +
                '</div>' +
                '<div style="margin-bottom:16px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">קטגוריה / נושא</label>' +
                    '<input type="text" id="lesson-category-input" list="lesson-category-suggestions" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:1em" dir="rtl" placeholder="ריק = כללי, או בחר/כתוב נושא">' +
                    '<datalist id="lesson-category-suggestions">' + categoryOptions + '</datalist>' +
                '</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-start">' +
                    '<button id="lesson-create-confirm" class="btn btn-primary" style="font-size:1.1em;padding:10px 24px">צור שיעור</button>' +
                    '<button id="lesson-create-cancel" class="btn btn-secondary" style="font-size:1.1em;padding:10px 24px">ביטול</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(modal);

        const titleInput = document.getElementById('lesson-title-input');
        titleInput.focus();

        document.getElementById('lesson-create-confirm').addEventListener('click', function() {
            var title = titleInput.value.trim();
            if (!title) {
                titleInput.style.borderColor = '#ef4444';
                return;
            }
            const desc = document.getElementById('lesson-desc-input').value.trim();
            const category = _normalizeLessonCategory(document.getElementById('lesson-category-input').value);
            const wasNewCategory = _getLessonCategories(loadLessons()).indexOf(category) === -1;
            // Collision on title+description match (not title alone): silently
            // append "_2", "_3", etc. Amitai 2026-04-19 03:18: creating a
            // second lesson with same title+desc shouldn't be allowed and
            // shouldn't ask — just rename. Titles alone may legitimately
            // repeat (e.g. "שיעור ראשון") so long as descriptions differ.
            const resolvedTitle = _uniquifyOnTitleDesc(title, desc);
            const lesson = createLesson(resolvedTitle, desc, category);
            _focusLessonInCategory(lesson, { isNewCategory: wasNewCategory });
            modal.remove();
            openLessonEditor(lesson.id);
        });

        titleInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                document.getElementById('lesson-create-confirm').click();
            }
        });

        function _hasUnsavedInput() {
            return titleInput.value.trim() !== '' ||
                document.getElementById('lesson-desc-input').value.trim() !== '' ||
                document.getElementById('lesson-category-input').value.trim() !== '';
        }

        function _onCancelCreate() {
            if (!_hasUnsavedInput()) { modal.remove(); return; }
            _showTwoChoiceDialog('📝', 'יש שינויים', '',
                '✏️ המשך לעבוד', '#0d9488', function() {},
                '🗑️ מחק את השינויים', '#ef4444', function() { modal.remove(); }
            );
        }
        function _onBackdropCreate() {
            if (!_hasUnsavedInput()) { modal.remove(); return; }
            _showTwoChoiceDialog('📝', 'יש שינויים', '',
                '💾 שמור', '#3b82f6', function() { document.getElementById('lesson-create-confirm').click(); },
                '🗑️ מחק את השינויים', '#ef4444', function() { modal.remove(); }
            );
        }

        document.getElementById('lesson-create-cancel').addEventListener('click', _onCancelCreate);
        modal.querySelector('.close').addEventListener('click', _onCancelCreate);
        // Backdrop click disabled — popup closes only via buttons (per Amitai request)
        // modal.addEventListener('click', function(e) { if (e.target === modal) _onBackdropCreate(); });
    }

    // --- UI: Import Dialog ---

    function showImportDialog() {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'lesson-import-modal';
        modal.innerHTML =
            '<div class="modal-content" style="max-width:500px">' +
                '<span class="close">&times;</span>' +
                '<h2 style="margin-bottom:16px;color:#0d9488">ייבוא שיעור</h2>' +
                '<div style="margin-bottom:16px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">הדבק JSON של שיעור</label>' +
                    '<textarea id="lesson-import-input" style="width:100%;height:150px;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:0.9em;font-family:monospace" dir="ltr" placeholder=\'{"title":"...","pages":[...]}\'></textarea>' +
                '</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-start">' +
                    '<button id="lesson-import-confirm" class="btn btn-primary" style="font-size:1.1em;padding:10px 24px">ייבא</button>' +
                    '<button id="lesson-import-cancel" class="btn btn-secondary" style="font-size:1.1em;padding:10px 24px">ביטול</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(modal);

        document.getElementById('lesson-import-confirm').addEventListener('click', function() {
            const json = document.getElementById('lesson-import-input').value.trim();
            const lesson = importLesson(json);
            if (lesson) {
                modal.remove();
                renderLessonsList();
                MessageManager.show('השיעור "' + lesson.title + '" יובא בהצלחה', 'success');
            } else {
                MessageManager.show('פורמט JSON לא תקין', 'error');
            }
        });

        document.getElementById('lesson-import-cancel').addEventListener('click', function() { modal.remove(); });
        modal.querySelector('.close').addEventListener('click', function() { modal.remove(); });
        // No backdrop click handler — modal closes only via X, Import, or Cancel buttons
    }

    // --- UI: Lesson Editor ---

    var _currentEditorLessonId = null;

    function openLessonEditor(lessonId) {
        _currentEditorLessonId = lessonId;
        var lesson = getLesson(lessonId);
        if (!lesson) return;

        // Record last-accessed time on its own field so sort-by-recency
        // keeps working, but DON'T touch `updated` — that drives the auto-
        // sync diff and would flip meta.synced to false just from opening
        // the lesson (Amitai 04:05 repro).
        var lessons = loadLessons();
        var idx = lessons.findIndex(function(l) { return l.id === lessonId; });
        if (idx >= 0) { lessons[idx].lastAccessed = new Date().toISOString(); saveLessons(lessons); }

        // Hide welcome, show editor
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'none';

        // Create or reuse editor container
        var editor = document.getElementById('lesson-editor');
        if (!editor) {
            editor = document.createElement('div');
            editor.id = 'lesson-editor';
            editor.className = 'lesson-editor';
            document.body.insertBefore(editor, document.getElementById('details-panel'));
        }
        editor.style.display = 'block';
        renderEditor(lesson);
    }

    // Track which cards have inline editors open (shared between renderEditor and renderEditorPages)
    var _inlineOpen = {};

    // UX #7 — the page card currently armed for drag (mousedown began on its ⠿
    // handle). One module-level mouseup listener disarms it, so re-rendering
    // the page list doesn't leak a per-card document listener every render.
    var _armedDragCard = null;
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('mouseup', function() {
            if (_armedDragCard) { _armedDragCard._handleGrab = false; _armedDragCard = null; }
        });
        document.addEventListener('touchend', function() {
            if (_armedDragCard) { _armedDragCard._handleGrab = false; _armedDragCard = null; }
        });
    }

    function renderEditor(lesson) {
        var editor = document.getElementById('lesson-editor');
        if (!editor) return;

        editor.innerHTML =
            '<div class="container" style="max-width:800px">' +
                '<header>' +
                    '<div style="text-align:center;color:white;font-size:13px;margin-bottom:4px">מסך עריכת שיעור</div>' +
                    '<div class="header-row">' +
                        '<h1 id="editor-lesson-title" style="cursor:pointer" title="לחץ לעריכת שם השיעור">✏️ ' + escapeHtml(lesson.title) + '</h1>' +
                        '<div class="header-buttons">' +
                            '<button id="editor-media-warehouse-btn" class="btn btn-secondary" style="background:#6366f1;color:white;border-color:#6366f1">📦 מחסן מדיה</button>' +
                            '<button id="editor-preview-btn" class="btn btn-primary">▶ הצג שיעור</button>' +
                            '<button id="editor-back-btn" class="btn btn-secondary">חזרה</button>' +
                        '</div>' +
                    '</div>' +
                '</header>' +
                '<div id="editor-pages-list" style="margin-top:16px"></div>' +
                // UX #5 — lead with the two friendliest page types; fold the
                // advanced activity types (+ JSON) under a "+ פעילות" toggle so
                // a first-time teacher isn't faced with 6 types + a scary JSON
                // button. All buttons keep .add-page-btn / the JSON id so the
                // existing wiring below still binds them.
                '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                    '<button class="btn btn-primary add-page-btn" data-type="text" style="padding:10px 20px">+ טקסט</button>' +
                    '<button class="btn btn-primary add-page-btn" data-type="image" style="padding:10px 20px;background:linear-gradient(135deg,#8b5cf6,#6d28d9)">+ תמונה/סרטון 🖼️🎬</button>' +
                    '<button type="button" id="editor-more-types-btn" class="btn btn-secondary" style="padding:10px 20px;font-weight:bold" aria-expanded="false">+ פעילות ▾</button>' +
                '</div>' +
                '<div id="editor-advanced-types" style="display:none;margin-top:10px;gap:8px;flex-wrap:wrap;justify-content:center">' +
                    '<button class="btn btn-primary add-page-btn" data-type="analyze" style="padding:10px 20px;background:linear-gradient(135deg,#0d9488,#0891b2)">+ ניתוח</button>' +
                    '<button class="btn btn-primary add-page-btn" data-type="engineering" style="padding:10px 20px;background:linear-gradient(135deg,#ea580c,#dc2626)">+ הינדוס</button>' +
                    '<button class="btn btn-primary add-page-btn" data-type="verb_analysis" style="padding:10px 20px;background:linear-gradient(135deg,#7c3aed,#4f46e5)">+ ניתוח פעלים</button>' +
                    '<button class="btn btn-primary add-page-btn" data-type="timeline" style="padding:10px 20px;background:linear-gradient(135deg,#0369a1,#0284c7)">+ ציר זמן</button>' +
                    '<button class="btn btn-secondary" id="editor-import-json-btn" style="padding:10px 20px;font-family:monospace;font-weight:bold">{ } הוסף מ-JSON</button>' +
                '</div>' +
            '</div>';

        // Wire buttons (with unsaved changes check)
        function _hasUnsavedInlineEdits() {
            for (var pid in _inlineOpen) {
                if (_inlineOpen[pid].dirty) return true;
            }
            return false;
        }
        document.getElementById('editor-back-btn').addEventListener('click', function() {
            if (_hasUnsavedInlineEdits()) {
                _showSavePrompt(function(choice) {
                    if (choice === 'save') _saveAllOpenEditors();
                    if (choice === 'save' || choice === 'discard') closeEditor();
                });
                return;
            }
            closeEditor();
        });
        document.getElementById('editor-media-warehouse-btn').addEventListener('click', function() {
            _openMediaWarehouse(lesson);
        });
        document.getElementById('editor-preview-btn').addEventListener('click', function() {
            if (_hasUnsavedInlineEdits()) {
                _showSavePrompt(function(choice) {
                    if (choice === 'save') _saveAllOpenEditors();
                    if (choice === 'save' || choice === 'discard') startLessonViewer(lesson.id);
                });
                return;
            }
            startLessonViewer(lesson.id);
        });

        // Click on title to rename lesson
        document.getElementById('editor-lesson-title').addEventListener('click', function() {
            var titleEl = this;
            var currentTitle = lesson.title;
            var input = document.createElement('input');
            input.type = 'text';
            input.value = currentTitle;
            input.dir = 'rtl';
            input.style.cssText = 'font-size:inherit;font-weight:bold;color:#0d9488;border:2px solid #0d9488;border-radius:8px;padding:4px 8px;width:100%;box-sizing:border-box;text-align:center';
            titleEl.innerHTML = '';
            titleEl.appendChild(input);
            input.focus();
            input.select();
            function _saveTitle() {
                var newTitle = input.value.trim();
                if (!newTitle) newTitle = currentTitle;
                lesson.title = newTitle;
                var lessons = loadLessons();
                var idx = lessons.findIndex(function(l) { return l.id === lesson.id; });
                if (idx >= 0) { lessons[idx].title = newTitle; lessons[idx].updated = new Date().toISOString(); saveLessons(lessons); }
                titleEl.textContent = '✏️ ' + newTitle;
                // Rename media folder to match new title
                if (newTitle !== currentTitle && typeof MediaStorage !== 'undefined' && MediaStorage.renameLessonFolder) {
                    MediaStorage.renameLessonFolder(currentTitle, newTitle);
                }
            }
            input.addEventListener('blur', _saveTitle);
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
            });
        });

        editor.querySelectorAll('.add-page-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                // Check if any inline editor is open with unsaved changes
                var hasDirty = false;
                for (var pid in _inlineOpen) {
                    if (_inlineOpen[pid].dirty) { hasDirty = true; break; }
                }
                if (hasDirty) {
                    _showSavePrompt(function(choice) {
                        if (choice === 'cancel') return;
                        if (choice === 'save') {
                            // Save all open dirty editors
                            document.querySelectorAll('.lpc-inline-editor .btn.btn-primary').forEach(function(sb) { sb.click(); });
                        }
                        // Close all inline editors
                        document.querySelectorAll('.lpc-inline-editor').forEach(function(ed) {
                            var parentCard = ed.parentNode;
                            if (parentCard) { parentCard.draggable = true; parentCard.style.cursor = 'grab'; }
                            ed.remove();
                        });
                        for (var k in _inlineOpen) delete _inlineOpen[k];
                        showAddPageDialog(lesson.id, btn.dataset.type);
                    });
                } else {
                    showAddPageDialog(lesson.id, btn.dataset.type);
                }
            });
        });

        // UX #5 — "+ פעילות" toggle reveals the advanced page-type group.
        var moreTypesBtn = document.getElementById('editor-more-types-btn');
        var advancedTypes = document.getElementById('editor-advanced-types');
        if (moreTypesBtn && advancedTypes) {
            moreTypesBtn.addEventListener('click', function() {
                var _open = advancedTypes.style.display !== 'flex';
                advancedTypes.style.display = _open ? 'flex' : 'none';
                moreTypesBtn.setAttribute('aria-expanded', _open ? 'true' : 'false');
                moreTypesBtn.textContent = _open ? '+ פעילות ▴' : '+ פעילות ▾';
            });
        }

        // Import from JSON button
        var importJsonBtn = document.getElementById('editor-import-json-btn');
        if (importJsonBtn) {
            importJsonBtn.addEventListener('click', function() {
                var overlay = document.createElement('div');
                overlay.className = 'modal show';
                overlay.innerHTML =
                    '<div class="modal-content" style="max-width:500px">' +
                        '<span class="close">&times;</span>' +
                        '<h2 style="margin-bottom:12px;color:#0d9488">הוסף שקופיות מ-JSON</h2>' +
                        '<p style="font-size:0.9em;color:#6b7280;margin-bottom:8px;direction:rtl">הדבק JSON של שקף אחד (אובייקט) או מערך של שקפים</p>' +
                        '<textarea id="json-import-input" style="width:100%;min-height:200px;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-family:monospace;font-size:0.9em;direction:ltr" placeholder=\'{"type":"text","title":"...","content":"..."}\' dir="ltr"></textarea>' +
                        '<div style="display:flex;gap:8px;margin-top:12px">' +
                            '<button id="json-import-confirm" class="btn btn-primary" style="padding:8px 20px">הוסף</button>' +
                            '<button id="json-import-cancel" class="btn btn-secondary" style="padding:8px 20px">ביטול</button>' +
                        '</div>' +
                    '</div>';
                document.body.appendChild(overlay);
                overlay.querySelector('.close').addEventListener('click', function() { overlay.remove(); });
                document.getElementById('json-import-cancel').addEventListener('click', function() { overlay.remove(); });
                document.getElementById('json-import-confirm').addEventListener('click', function() {
                    var raw = document.getElementById('json-import-input').value.trim();
                    if (!raw) return;
                    try {
                        var parsed = JSON.parse(raw);
                        var pages = Array.isArray(parsed) ? parsed : [parsed];
                        var lessons = loadLessons();
                        var li = lessons.findIndex(function(l) { return l.id === lesson.id; });
                        if (li === -1) return;
                        pages.forEach(function(p) {
                            p.id = 'page_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                            if (!p.type) p.type = 'text';
                            lessons[li].pages.push(p);
                        });
                        lessons[li].updated = new Date().toISOString();
                        saveLessons(lessons);
                        overlay.remove();
                        renderEditor(getLesson(lesson.id));
                        _showEditorToast(pages.length + ' שקפים נוספו ✓');
                    } catch (e) {
                        document.getElementById('json-import-input').style.borderColor = '#ef4444';
                        alert('JSON לא תקין: ' + e.message);
                    }
                });
            });
        }

        renderEditorPages(lesson);
    }

    // Inject editor CSS once (drag-drop, inline-edit, animations)
    function _injectEditorStyles() {
        if (document.getElementById('lesson-editor-extra-style')) return;
        var s = document.createElement('style');
        s.id = 'lesson-editor-extra-style';
        s.textContent = [
            '.lpc-drag-over-top{border-top:3px solid #0d9488 !important}',
            '.lpc-drag-over-bottom{border-bottom:3px solid #0d9488 !important}',
            '.lpc-dragging{opacity:0.4}',
            '.lpc-drop-zone{height:0;transition:height 0.15s,background 0.15s,border-color 0.15s,padding 0.15s;border:2px dashed transparent;border-radius:8px;margin:0 0;box-sizing:border-box}',
            '.lpc-drop-zone.visible{height:24px;border-color:#d1d5db;background:rgba(13,148,136,0.03)}',
            '.lpc-drop-zone.active{height:48px;background:rgba(13,148,136,0.15);border-color:#0d9488}',
            '.lpc-drag-handle{position:absolute;top:0;bottom:0;right:0;width:26px;display:flex;align-items:center;justify-content:center;cursor:grab;color:#9ca3af;font-size:1.05em;letter-spacing:2px;writing-mode:vertical-rl;user-select:none;border-left:1px solid #e5e7eb;border-radius:0 8px 8px 0;transition:background 0.15s,color 0.15s}',
            '.lpc-drag-handle:hover{background:#f0fdf4;color:#0d9488}',
            '.lpc-drag-handle:active{cursor:grabbing}',
            '.lpc-drag-handle-bottom{border-bottom:none;border-top:1px solid #e5e7eb;margin:-12px -16px -12px -40px;margin-top:8px;border-radius:0 0 8px 8px}',
            '@keyframes lpc-dup-pulse{0%{box-shadow:0 0 0 0 rgba(37,99,235,0.7)}70%{box-shadow:0 0 0 10px rgba(37,99,235,0)}100%{box-shadow:0 0 0 0 rgba(37,99,235,0)}}',
            '.lpc-dup-anim{animation:lpc-dup-pulse 0.6s ease-out}',
            '@keyframes lpc-save-flash{0%{background:#dcfce7}100%{background:white}}',
            '.lpc-save-flash{animation:lpc-save-flash 0.7s ease-out}',
            // Task #13 — gentle "go fullscreen" attention pulse on the ⛶ button
            // when a teacher starts typing in an existing card's inline editor.
            // Amitai 2026-06-06 "תחזיר את ההקפצה": a clearly bouncing/jumping ⛶ hint (was a
            // subtle scale-pulse) so typing in the body visibly nudges the teacher to enlarge.
            '@keyframes lpc-fs-pop{0%,100%{transform:translateY(0) scale(1);box-shadow:0 0 0 0 rgba(13,148,136,.55)}30%{transform:translateY(-7px) scale(1.2);box-shadow:0 0 0 8px rgba(13,148,136,0)}55%{transform:translateY(0) scale(1.04)}78%{transform:translateY(-3px) scale(1.1)}}',
            '.lpc-fs-pop{animation:lpc-fs-pop .9s ease-in-out 4;background:#ccfbf1 !important;border-color:#0d9488 !important;position:relative;z-index:1}',
            '.lpc-inline-editor{background:#f0fdf4;border-top:1px solid #bbf7d0;padding:12px;margin-top:10px;border-radius:0 0 8px 8px}',
            '.lpc-inline-editor label{display:block;margin-bottom:3px;font-size:0.85em;font-weight:bold;color:#374151}',
            '.lpc-inline-editor input,.lpc-inline-editor textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.95em;font-family:PlonterFlippedDiacritics,Arial,serif;margin-bottom:8px;direction:rtl}',
            '.lpc-inline-editor [contenteditable]{width:100%;box-sizing:border-box;min-height:80px;padding:8px;border:2px solid #d1d5db;border-radius:6px;font-size:1.05em;font-family:PlonterFlippedDiacritics,Arial,serif;direction:rtl;outline:none;background:white;overflow-y:auto;max-height:160px;margin-bottom:8px}',
            '.lpc-inline-editor [contenteditable]:focus{border-color:#0d9488}',
            '.lpc-inline-btns{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
            '.lpc-fmt-bar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;align-items:center}',
            '.lpc-fmt-bar button{padding:3px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;font-size:0.9em;line-height:1.4}',
            '.lpc-delete-btn{position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;font-size:1.1em;color:#9ca3af;line-height:1;padding:2px 5px;border-radius:4px;transition:color 0.15s,background 0.15s}',
            '.lpc-delete-btn:hover{color:#dc2626;background:#fee2e2}',
            '.lpc-toast{position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:10px 22px;border-radius:10px;font-size:0.97em;z-index:9999;pointer-events:none;opacity:1;transition:opacity 0.4s}',
            '.lpc-toast.hide{opacity:0}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function _showEditorToast(msg) {
        var old = document.querySelector('.lpc-toast');
        if (old) old.remove();
        var t = document.createElement('div');
        t.className = 'lpc-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() {
            t.classList.add('hide');
            setTimeout(function() { t.remove(); }, 450);
        }, 2700);
    }

    // UX #9 — undo toast shown for ~7s after a delete. Clicking "לבטל מחיקה"
    // runs the supplied restore function. Reuses .lpc-toast styling but makes
    // it interactive (pointer-events:auto) and adds the undo affordance.
    var _undoToastTimer = null;
    function _showUndoToast(msg, undoFn) {
        var old = document.querySelector('.lpc-undo-toast');
        if (old) old.remove();
        if (_undoToastTimer) { clearTimeout(_undoToastTimer); _undoToastTimer = null; }
        var t = document.createElement('div');
        t.className = 'lpc-toast lpc-undo-toast';
        t.style.cssText = 'pointer-events:auto;display:flex;align-items:center;gap:14px;direction:rtl';
        var label = document.createElement('span');
        label.textContent = msg;
        var btn = document.createElement('button');
        btn.textContent = '↩ לבטל מחיקה';
        btn.style.cssText = 'background:none;border:none;color:#5eead4;font-weight:700;font-size:0.97em;cursor:pointer;padding:0';
        var _done = false;
        function _dismiss() {
            if (_undoToastTimer) { clearTimeout(_undoToastTimer); _undoToastTimer = null; }
            t.classList.add('hide');
            setTimeout(function() { t.remove(); }, 450);
        }
        btn.addEventListener('click', function() {
            if (_done) return;
            _done = true;
            _dismiss();
            try { undoFn(); } catch (e) { console.warn('[lessons] undo failed', e); }
        });
        t.appendChild(label);
        t.appendChild(btn);
        document.body.appendChild(t);
        _undoToastTimer = setTimeout(function() { if (!_done) _dismiss(); }, 7000);
    }

    function renderEditorPages(lesson) {
        _injectEditorStyles();

        var list = document.getElementById('editor-pages-list');
        if (!list) return;
        list.innerHTML = '';

        if (lesson.pages.length === 0) {
            list.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px">אין דפים עדיין. הוסף דפים באמצעות הכפתורים למטה.</p>';
            return;
        }

        var typeLabels = { text: '📝 טקסט', image: '🖼️🎬 מדיה', video: '🖼️🎬 מדיה', analyze: '🔍 ניתוח', diacritics: '◌َ ניקוד', dictionary: '📖 מילון', engineering: '🧩 הינדוס', verb_analysis: '📊 ניתוח פעלים', timeline: '📐 ציר זמן' };
        var typeColors = { text: '#6b7280', image: '#8b5cf6', video: '#8b5cf6', analyze: '#0d9488', diacritics: '#8b5cf6', dictionary: '#0891b2', engineering: '#ea580c', verb_analysis: '#7c3aed', timeline: '#0369a1' };

        // Reset inline editors tracking on re-render
        _inlineOpen = {};

        // Drag state
        var _dragSrcIdx = null;
        var _autoScrollInterval = null;
        var _autoScrollSpeed = 0;

        function _startAutoScroll() {
            if (_autoScrollInterval) return;
            _autoScrollInterval = setInterval(function() {
                if (_autoScrollSpeed !== 0) {
                    window.scrollBy(0, _autoScrollSpeed);
                }
            }, 16);
        }

        function _stopAutoScroll() {
            if (_autoScrollInterval) {
                clearInterval(_autoScrollInterval);
                _autoScrollInterval = null;
            }
            _autoScrollSpeed = 0;
        }

        function _reorderAndRender(fromIdx, toIdx) {
            var lessons = loadLessons();
            var li = lessons.findIndex(function(l) { return l.id === lesson.id; });
            if (li === -1) return;
            var pages = lessons[li].pages;
            var moved = pages.splice(fromIdx, 1)[0];
            pages.splice(toIdx, 0, moved);
            lessons[li].updated = new Date().toISOString();
            saveLessons(lessons);
            renderEditor(getLesson(lesson.id));
        }

        function _closeOtherEditors(exceptPageId, callback) {
            // Close all other open inline editors, prompting to save if dirty
            var otherDirty = null;
            for (var pid in _inlineOpen) {
                if (pid === exceptPageId) continue;
                if (_inlineOpen[pid].dirty) {
                    otherDirty = pid;
                    break;
                }
            }
            if (otherDirty) {
                _showSavePrompt(function(choice) {
                    if (choice === 'cancel') { if (callback) callback(false); return; }
                    // Save or discard — close all others
                    for (var pid in _inlineOpen) {
                        if (pid === exceptPageId) continue;
                        if (choice === 'save' && _inlineOpen[pid].dirty) {
                            var editorEl = document.querySelector('.lpc-inline-editor');
                            // Find the save button in this editor's parent card
                            var allEditors = document.querySelectorAll('.lpc-inline-editor');
                            for (var i = 0; i < allEditors.length; i++) {
                                var parentCard = allEditors[i].parentNode;
                                if (parentCard && parentCard.querySelector('.lpc-inline-editor') === allEditors[i]) {
                                    var saveBtn = allEditors[i].querySelector('.btn.btn-primary');
                                    if (saveBtn && pid !== exceptPageId) saveBtn.click();
                                }
                            }
                        }
                        // Remove editor DOM
                        var allEditors2 = document.querySelectorAll('.lpc-inline-editor');
                        for (var j = 0; j < allEditors2.length; j++) {
                            var pc = allEditors2[j].parentNode;
                            if (pc) { pc.draggable = true; pc.style.cursor = 'grab'; }
                            allEditors2[j].remove();
                        }
                        break; // We removed all, so break
                    }
                    // Clear all except current
                    for (var pid2 in _inlineOpen) {
                        if (pid2 !== exceptPageId) delete _inlineOpen[pid2];
                    }
                    if (callback) callback(true);
                });
                return;
            }
            // No dirty others — just close them silently
            var allEditors3 = document.querySelectorAll('.lpc-inline-editor');
            for (var k = 0; k < allEditors3.length; k++) {
                var pc2 = allEditors3[k].parentNode;
                if (pc2) { pc2.draggable = true; pc2.style.cursor = 'grab'; }
                allEditors3[k].remove();
            }
            for (var pid3 in _inlineOpen) {
                if (pid3 !== exceptPageId) delete _inlineOpen[pid3];
            }
            if (callback) callback(true);
        }

        function _buildInlineEditor(card, page, pageIdx) {
            var existing = card.querySelector('.lpc-inline-editor');
            if (existing) {
                if (_inlineOpen[page.id] && _inlineOpen[page.id].dirty) {
                    _showSavePrompt(function(choice) {
                        if (choice === 'save') {
                            // Click the save button then close
                            var saveBtn = existing.querySelector('.btn.btn-primary');
                            if (saveBtn) saveBtn.click();
                        }
                        if (choice === 'save' || choice === 'discard') {
                            existing.remove();
                            delete _inlineOpen[page.id];
                            card.draggable = true;
                            card.style.cursor = 'grab';
                        }
                        // choice === 'cancel' → do nothing
                    });
                    return;
                }
                existing.remove();
                delete _inlineOpen[page.id];
                card.draggable = true;
                card.style.cursor = 'grab';
                return;
            }

            // Close other open editors first (with save prompt if dirty)
            _closeOtherEditors(page.id, function(proceed) {
                if (!proceed) return;
                _openInlineEditor(card, page, pageIdx);
            });
        }

        function _openInlineEditor(card, page, pageIdx) {
            // Disable dragging while editing
            card.draggable = false;
            card.style.cursor = 'default';

            // Task #13 — once-per-session flag for the "go fullscreen" hint.
            var _fsHintShown = false;

            _inlineOpen[page.id] = { dirty: false };

            var editor = document.createElement('div');
            editor.className = 'lpc-inline-editor';

            // Formatting bar
            var fmtBar = document.createElement('div');
            fmtBar.className = 'lpc-fmt-bar';

            // UX #10 — small visible group labels so the icon clusters have
            // meaning without relying on hover tooltips (invisible on touch).
            function _fmtLabel(text) {
                var s = document.createElement('span');
                s.className = 'lpc-fmt-label';
                s.textContent = text;
                s.style.cssText = 'font-size:0.7em;color:#9ca3af;font-weight:700;align-self:center;margin:0 4px 0 2px;user-select:none;white-space:nowrap';
                return s;
            }
            fmtBar.appendChild(_fmtLabel('טקסט'));

            var boldBtn = document.createElement('button');
            boldBtn.type = 'button';
            boldBtn.innerHTML = '<b>B</b>';
            boldBtn.title = 'מודגש (Ctrl+B)';
            boldBtn.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('bold', false, null); contentEl.focus(); });
            fmtBar.appendChild(boldBtn);

            var ulBtn = document.createElement('button');
            ulBtn.type = 'button';
            ulBtn.innerHTML = '<u>U</u>';
            ulBtn.title = 'קו תחתון (Ctrl+U)';
            ulBtn.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('underline', false, null); contentEl.focus(); });
            fmtBar.appendChild(ulBtn);

            var rmBtn = document.createElement('button');
            rmBtn.type = 'button';
            rmBtn.textContent = '✕';
            rmBtn.title = 'הסר עיצוב';
            rmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            rmBtn.addEventListener('click', function() {
                document.execCommand('removeFormat', false, null);
                document.execCommand('foreColor', false, '#000000');
                window.getSelection() && window.getSelection().removeAllRanges();
                contentEl.focus();
            });
            fmtBar.appendChild(rmBtn);

            // Visual separator between basic formatting and special tools
            var fmtSep = document.createElement('span');
            fmtSep.style.cssText = 'width:1px;background:#e5e7eb;height:22px;display:inline-block;margin:0 2px';
            fmtBar.appendChild(fmtSep);

            fmtBar.appendChild(_fmtLabel('ערבית/הסתרה'));

            // Question-mark hidden text button
            var qmBtn = document.createElement('button');
            qmBtn.type = 'button';
            qmBtn.textContent = '❓';
            qmBtn.title = 'סמן טקסט כמוסתר (יוצג כסימן שאלה במצגת)';
            qmBtn.style.cssText = 'padding:2px 14px;border:1px solid #3b82f6;border-radius:4px;background:#dbeafe;cursor:pointer;font-size:0.85em;line-height:1.2';
            qmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            qmBtn.addEventListener('click', function() {
                _toggleQmarkMode(contentEl, qmBtn, page.id);
            });
            fmtBar.appendChild(qmBtn);

            // Hebrew↔Arabic word toggle button
            var h2aBtn = document.createElement('button');
            h2aBtn.type = 'button';
            h2aBtn.textContent = 'א↔ع';
            h2aBtn.title = 'המר מילים עברית↔ערבית (לחיצה ארוכה = המר הכל)';
            h2aBtn.style.cssText = 'padding:2px 10px;border:1px solid #ea580c;border-radius:4px;background:#fff7ed;cursor:pointer;font-size:0.85em;line-height:1.2;font-weight:bold';
            h2aBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            var _h2aLongPress = null;
            h2aBtn.addEventListener('pointerdown', function() {
                _h2aLongPress = setTimeout(function() {
                    _h2aLongPress = 'fired';
                    if (!contentEl._heb2arMode) _enterHeb2ArMode(contentEl, h2aBtn);
                    _heb2arConvertAll(contentEl);
                }, 500);
            });
            h2aBtn.addEventListener('pointerup', function() {
                if (_h2aLongPress === 'fired') { _h2aLongPress = null; return; }
                clearTimeout(_h2aLongPress);
                _h2aLongPress = null;
                _toggleHeb2ArMode(contentEl, h2aBtn);
            });
            h2aBtn.addEventListener('pointerleave', function() {
                if (_h2aLongPress && _h2aLongPress !== 'fired') {
                    clearTimeout(_h2aLongPress);
                    _h2aLongPress = null;
                }
            });
            fmtBar.appendChild(h2aBtn);

            // Color dots — 5 classic colors + custom color circle
            var colorCircleWrap = document.createElement('div');
            colorCircleWrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:4px;margin-right:auto';
            colorCircleWrap.appendChild(_fmtLabel('צבע'));
            var _currentFmtColor = '#dc2626';
            // Black reset-color dot (rightmost in RTL = first in DOM)
            var resetDot = document.createElement('div');
            resetDot.style.cssText = 'width:24px;height:24px;border-radius:50%;background:#000000;cursor:pointer;border:2px solid #333;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:bold;line-height:1';
            resetDot.title = 'איפוס צבע';
            resetDot.textContent = '✕';
            resetDot.addEventListener('mousedown', function(e) { e.preventDefault(); });
            resetDot.addEventListener('click', function() {
                document.execCommand('foreColor', false, '#000000');
                window.getSelection() && window.getSelection().removeAllRanges();
                contentEl.focus();
            });
            colorCircleWrap.appendChild(resetDot);
            // Classic color dots
            var classicColors = [
                { color: '#dc2626', title: 'אדום' },
                { color: '#2563eb', title: 'כחול' },
                { color: '#16a34a', title: 'ירוק' },
                { color: '#f59e0b', title: 'כתום' }
            ];
            classicColors.forEach(function(c) {
                var dot = document.createElement('div');
                dot.style.cssText = 'width:24px;height:24px;border-radius:50%;background:' + c.color + ';cursor:pointer;border:2px solid #333;flex-shrink:0';
                dot.title = c.title;
                dot.addEventListener('mousedown', function(e) { e.preventDefault(); });
                dot.addEventListener('click', function() {
                    document.execCommand('foreColor', false, c.color);
                    window.getSelection() && window.getSelection().removeAllRanges();
                    contentEl.focus();
                });
                colorCircleWrap.appendChild(dot);
            });
            // Custom color circle with dashed border
            var colorCircle = document.createElement('div');
            colorCircle.style.cssText = 'width:28px;height:28px;border-radius:50%;background:' + _currentFmtColor + ';cursor:pointer;border:2px dashed #333;flex-shrink:0';
            colorCircle.title = 'לחיצה שמאלית = צבע טקסט | לחיצה ימנית = בחר צבע';
            var hiddenColorInput = document.createElement('input');
            hiddenColorInput.type = 'color';
            hiddenColorInput.value = _currentFmtColor;
            hiddenColorInput.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
            hiddenColorInput.addEventListener('input', function() {
                _currentFmtColor = hiddenColorInput.value;
                colorCircle.style.background = _currentFmtColor;
            });
            colorCircleWrap.appendChild(hiddenColorInput);
            colorCircle.addEventListener('mousedown', function(e) { e.preventDefault(); });
            colorCircle.addEventListener('click', function() {
                document.execCommand('foreColor', false, _currentFmtColor);
                window.getSelection() && window.getSelection().removeAllRanges();
                contentEl.focus();
            });
            colorCircle.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                hiddenColorInput.click();
            });
            colorCircleWrap.appendChild(colorCircle);
            fmtBar.appendChild(colorCircleWrap);

            // Black separator
            var blackSep = document.createElement('span');
            blackSep.style.cssText = 'width:2px;background:#000000;height:22px;display:inline-block;margin:0 4px';
            fmtBar.appendChild(blackSep);

            // Font size buttons. DOM order intentionally: A (normal) → A- (minus) → A+ (plus).
            // Amitai 2026-05-18 19:43: "A+ יהיה למטה בשורה" — wants A+ on the bottom row of
            // the wrapped toolbar. With the colors block taking most of the top row, putting
            // A+ AFTER A- pushes it past the natural wrap point so it lands on row 2 next to
            // its sibling -A. (v4.18.20)
            var fsBtnStyle = 'padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;';
            var fsNormal = document.createElement('button');
            fsNormal.type = 'button'; fsNormal.textContent = 'A'; fsNormal.title = 'גופן רגיל';
            fsNormal.style.cssText = fsBtnStyle; fsNormal.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('fontSize', false, '3'); contentEl.focus(); });
            fmtBar.appendChild(fsNormal);
            var fsMinus = document.createElement('button');
            fsMinus.type = 'button'; fsMinus.textContent = 'A-'; fsMinus.title = 'הקטן גופן';
            fsMinus.style.cssText = fsBtnStyle + 'font-size:0.8em'; fsMinus.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('fontSize', false, '2'); contentEl.focus(); });
            fmtBar.appendChild(fsMinus);
            var fsPlus = document.createElement('button');
            fsPlus.type = 'button'; fsPlus.innerHTML = '<b>A+</b>'; fsPlus.title = 'הגדל גופן';
            fsPlus.style.cssText = fsBtnStyle; fsPlus.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('fontSize', false, '6'); contentEl.focus(); });
            fmtBar.appendChild(fsPlus);

            // Separator
            var alignSep = document.createElement('span');
            alignSep.style.cssText = 'width:1px;background:#e5e7eb;height:22px;display:inline-block;margin:0 2px';
            fmtBar.appendChild(alignSep);

            // UX #10 — alignment is rarely used by teachers; fold it under an
            // "עוד" toggle so the toolbar isn't a wall of icons. The buttons
            // stay inside fmtBar (so fullscreen move/restore is unaffected).
            var moreFmtBtn = document.createElement('button');
            moreFmtBtn.type = 'button'; moreFmtBtn.textContent = 'עוד ▾'; moreFmtBtn.title = 'כלי יישור';
            moreFmtBtn.setAttribute('aria-expanded', 'false');
            moreFmtBtn.style.cssText = fsBtnStyle + 'font-size:0.8em;font-weight:700';
            fmtBar.appendChild(moreFmtBtn);

            var alignGroup = document.createElement('span');
            alignGroup.style.cssText = 'display:none;align-items:center;gap:4px';
            moreFmtBtn.addEventListener('click', function() {
                var _open = alignGroup.style.display === 'none';
                alignGroup.style.display = _open ? 'inline-flex' : 'none';
                moreFmtBtn.setAttribute('aria-expanded', _open ? 'true' : 'false');
                moreFmtBtn.textContent = _open ? 'עוד ▴' : 'עוד ▾';
            });

            // Alignment buttons
            var alignR = document.createElement('button');
            alignR.type = 'button'; alignR.textContent = '⇷'; alignR.title = 'יישר ימינה';
            alignR.style.cssText = fsBtnStyle; alignR.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('justifyRight', false, null); contentEl.focus(); });
            alignGroup.appendChild(alignR);
            var alignC = document.createElement('button');
            alignC.type = 'button'; alignC.textContent = '☰'; alignC.title = 'מרכז';
            alignC.style.cssText = fsBtnStyle; alignC.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('justifyCenter', false, null); contentEl.focus(); });
            alignGroup.appendChild(alignC);
            var alignL = document.createElement('button');
            alignL.type = 'button'; alignL.textContent = '⇸'; alignL.title = 'יישר שמאלה';
            alignL.style.cssText = fsBtnStyle; alignL.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('justifyLeft', false, null); contentEl.focus(); });
            alignGroup.appendChild(alignL);
            fmtBar.appendChild(alignGroup);

            // Separator
            var dkSep = document.createElement('span');
            dkSep.style.cssText = 'width:2px;background:#000000;height:22px;display:inline-block;margin:0 4px';
            fmtBar.appendChild(dkSep);

            // Fullscreen button
            var inlineFsBtn = document.createElement('button');
            inlineFsBtn.type = 'button';
            inlineFsBtn.textContent = '⛶';
            inlineFsBtn.title = 'מסך מלא';
            inlineFsBtn.style.cssText = 'padding:4px 8px;border:1px solid #0d9488;border-radius:4px;background:#f0fdfa;cursor:pointer;font-size:1.1em;line-height:1;color:#0d9488';
            var _inlineFsOverlay = null;
            var _inlineFsOrigParent = null;
            var _inlineFsOrigNext = null;
            var _inlineFsOrigStyle = '';
            var _inlineFsOrigFmtParent = null;
            var _inlineFsOrigFmtNext = null;
            function _exitInlineFullscreen() {
                if (!_inlineFsOverlay) return;
                if (_inlineFsOrigFmtParent) {
                    if (_inlineFsOrigFmtNext) _inlineFsOrigFmtParent.insertBefore(fmtBar, _inlineFsOrigFmtNext);
                    else _inlineFsOrigFmtParent.appendChild(fmtBar);
                }
                if (_inlineFsOrigParent) {
                    if (_inlineFsOrigNext) _inlineFsOrigParent.insertBefore(contentEl, _inlineFsOrigNext);
                    else _inlineFsOrigParent.appendChild(contentEl);
                }
                contentEl.style.cssText = _inlineFsOrigStyle;
                // Exit button now lives pinned on the overlay (removed with it below) —
                // just undo the toolbar padding we added to clear it.
                fmtBar.style.paddingLeft = '';
                var exitBtn = (_inlineFsOverlay && _inlineFsOverlay.querySelector('[data-fs-exit]')) || fmtBar.querySelector('[data-fs-exit]');
                if (exitBtn) exitBtn.remove();
                _inlineFsOverlay.parentNode.removeChild(_inlineFsOverlay);
                _inlineFsOverlay = null;
                document.body.style.overflow = '';
                inlineFsBtn.textContent = '⛶';
                inlineFsBtn.title = 'מסך מלא';
                inlineFsBtn.style.display = '';
            }
            inlineFsBtn.addEventListener('click', function() {
                // Task #13 — clicking the button satisfies the hint; stop the
                // attention pulse and don't re-trigger it this session.
                _fsHintShown = true;
                inlineFsBtn.classList.remove('lpc-fs-pop');
                if (_inlineFsOverlay) {
                    _exitInlineFullscreen();
                } else {
                    // Enter fullscreen
                    _inlineFsOrigFmtParent = fmtBar.parentNode;
                    _inlineFsOrigFmtNext = fmtBar.nextSibling;
                    _inlineFsOrigParent = contentEl.parentNode;
                    _inlineFsOrigNext = contentEl.nextSibling;
                    _inlineFsOrigStyle = contentEl.style.cssText;
                    _inlineFsOverlay = document.createElement('div');
                    _inlineFsOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white;display:flex;flex-direction:column;padding:8px';


                    // Blue ✕ exit button — PINNED to the EXTREME TOP-LEFT corner of the
                    // fullscreen overlay (Amitai bd1 #1468), NOT in the toolbar row. Fixed to
                    // the viewport corner with a small safe inset + high z-index; the toolbar
                    // gets left padding so its leftmost control never hides behind it, and no
                    // other UI shifts toward the center.
                    var _inlineFsExitBtn = document.createElement('button');
                    _inlineFsExitBtn.textContent = '✕';
                    _inlineFsExitBtn.setAttribute('data-fs-exit', 'true');
                    _inlineFsExitBtn.style.cssText = 'position:fixed;top:6px;left:6px;z-index:10001;background:#0891b2;color:white;border:none;width:32px;height:32px;border-radius:8px;font-weight:bold;font-size:1.05em;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.25)';
                    _inlineFsExitBtn.addEventListener('click', function(e) { e.stopPropagation(); _exitInlineFullscreen(); });

                    _inlineFsOverlay.appendChild(fmtBar);
                    _inlineFsOverlay.appendChild(contentEl);
                    _inlineFsOverlay.appendChild(_inlineFsExitBtn);
                    fmtBar.style.paddingLeft = '46px'; // reserve room so toolbar items clear the pinned ✕
                    contentEl.style.cssText = 'width:100%;flex:1;padding:16px;border:2px solid #d1d5db;border-radius:8px;font-size:28px;font-family:PlonterFlippedDiacritics,Arial,serif;outline:none;overflow-y:auto;line-height:2;direction:rtl;resize:none';

                    document.body.appendChild(_inlineFsOverlay);
                    document.body.style.overflow = 'hidden';
                    contentEl.focus();
                    inlineFsBtn.style.display = 'none';
                }
            });
            fmtBar.appendChild(inlineFsBtn);

            // DK keyboard toggle button
            if (typeof DiacriticsKeyboard !== 'undefined') {
                var inlineDkBtn = document.createElement('button');
                inlineDkBtn.type = 'button';
                inlineDkBtn.textContent = '⌨️';
                inlineDkBtn.title = 'מקלדת ניקוד (QWES)';
                inlineDkBtn.style.cssText = 'padding:4px 8px;border:1px solid #6366f1;border-radius:4px;background:#f5f3ff;cursor:pointer;font-size:1.1em;line-height:1;color:#6366f1';
                inlineDkBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
                inlineDkBtn.addEventListener('click', function() {
                    DiacriticsKeyboard.toggle();
                    var active = DiacriticsKeyboard._active;
                    inlineDkBtn.style.background = active ? '#6366f1' : '#f5f3ff';
                    inlineDkBtn.style.color = active ? 'white' : '#6366f1';
                    contentEl.focus();
                });
                document.addEventListener('dk-toggle', function(e) {
                    inlineDkBtn.style.background = e.detail.active ? '#6366f1' : '#f5f3ff';
                    inlineDkBtn.style.color = e.detail.active ? 'white' : '#6366f1';
                });
                fmtBar.appendChild(inlineDkBtn);
            }

            editor.appendChild(fmtBar);

            // Title
            var titleLabel = document.createElement('label');
            titleLabel.textContent = 'כותרת';
            editor.appendChild(titleLabel);
            var titleEl = document.createElement('input');
            titleEl.type = 'text';
            titleEl.value = page.title || '';
            titleEl.dir = 'rtl';
            titleEl.placeholder = 'כותרת הדף...';
            titleEl.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (sentenceEl) sentenceEl.focus();
                    else contentEl.focus();
                }
            });
            editor.appendChild(titleEl);

            // Sentence field for analyze/engineering pages
            var sentenceEl = null;
            var hasSentence = (page.type === 'analyze' || page.type === 'engineering');
            if (hasSentence) {
                var sentenceLabel = document.createElement('label');
                sentenceLabel.textContent = 'משפט ל' + (page.type === 'analyze' ? 'ניתוח' : 'הינדוס');
                sentenceLabel.style.fontWeight = 'bold';
                editor.appendChild(sentenceLabel);
                sentenceEl = document.createElement('input');
                sentenceEl.type = 'text';
                sentenceEl.value = page.sentence || (page.content || '').replace(/<[^>]*>/g, '') || '';
                sentenceEl.dir = 'rtl';
                sentenceEl.placeholder = 'הקלד את המשפט כאן...';
                sentenceEl.style.cssText = 'font-size:1.1em;font-family:PlonterFlippedDiacritics,Arial,serif';
                sentenceEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); contentEl.focus(); } });
                editor.appendChild(sentenceEl);
            }

            // Media URL field for image/video types (unified)
            var mediaUrlEl = null;
            if (page.type === 'image' || page.type === 'video') {
                var mediaLabel = document.createElement('label');
                mediaLabel.textContent = 'כתובת מדיה (תמונה / YouTube / סרטון)';
                mediaLabel.style.fontWeight = 'bold';
                editor.appendChild(mediaLabel);
                mediaUrlEl = document.createElement('input');
                mediaUrlEl.type = 'text';
                mediaUrlEl.value = page.imageUrl || page.videoUrl || '';
                mediaUrlEl.dir = 'ltr';
                mediaUrlEl.placeholder = 'https://...';
                mediaUrlEl.style.cssText = 'font-size:0.95em;margin-bottom:8px';
                mediaUrlEl.addEventListener('input', function() { _inlineOpen[page.id].dirty = true; });
                editor.appendChild(mediaUrlEl);
            }

            // Content (for timeline: appended after events section below)
            var contentLabel = document.createElement('label');
            contentLabel.textContent = hasSentence ? 'גוף טקסט (אופציונלי)' : (page.type === 'image' || page.type === 'video') ? 'טקסט (אופציונלי)' : page.type === 'verb_analysis' ? 'הוראות לתלמיד (אופציונלי)' : page.type === 'timeline' ? 'תוכן (אופציונלי)' : 'תוכן';
            var contentEl = document.createElement('div');
            contentEl.contentEditable = 'true';
            contentEl.dir = 'rtl';
            contentEl.innerHTML = hasSentence ? (page.bodyText || '') : (page.content || '');
            if (page.type !== 'timeline') {
                editor.appendChild(contentLabel);
                editor.appendChild(contentEl);
            }

            // Verbs bubble editor for verb_analysis pages (after content/instructions)
            var verbsEl = null;
            if (page.type === 'verb_analysis') {
                var verbsLabel = document.createElement('label');
                verbsLabel.textContent = 'רשימת פעלים (לחץ + להוספה, Enter לאישור, Ctrl+G להמרה)';
                verbsLabel.style.fontWeight = 'bold';
                editor.appendChild(verbsLabel);
                verbsEl = _createVerbBubbleEditor(page.verbs || '', function() { _inlineOpen[page.id].dirty = true; });
                editor.appendChild(verbsEl);
            }

            // Timeline fields
            var _tlInlineEvents = null;
            if (page.type === 'timeline') {
                // Start/end inputs
                var tlRow = document.createElement('div');
                tlRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
                var tlStartWrap = document.createElement('div');
                tlStartWrap.style.cssText = 'flex:1';
                var tlStartLabel = document.createElement('label');
                tlStartLabel.textContent = 'נקודת התחלה (שמאל — מוקדם)';
                tlStartLabel.style.fontWeight = 'bold';
                tlStartWrap.appendChild(tlStartLabel);
                var tlStartInput = document.createElement('input');
                tlStartInput.type = 'text';
                tlStartInput.value = page.tlStart || '';
                tlStartInput.placeholder = '1900';
                tlStartInput.style.cssText = 'text-align:center';
                tlStartInput.addEventListener('input', function() { _inlineOpen[page.id].dirty = true; });
                tlStartWrap.appendChild(tlStartInput);
                _attachTimelineDateInputUX(tlStartInput, { withPicker: true, withFeedback: true });
                tlRow.appendChild(tlStartWrap);
                var tlEndWrap = document.createElement('div');
                tlEndWrap.style.cssText = 'flex:1';
                var tlEndLabel = document.createElement('label');
                tlEndLabel.textContent = 'נקודת סיום (ימין — מאוחר)';
                tlEndLabel.style.fontWeight = 'bold';
                tlEndWrap.appendChild(tlEndLabel);
                var tlEndInput = document.createElement('input');
                tlEndInput.type = 'text';
                tlEndInput.value = page.tlEnd || '';
                tlEndInput.placeholder = '2000';
                tlEndInput.style.cssText = 'text-align:center';
                tlEndInput.addEventListener('input', function() { _inlineOpen[page.id].dirty = true; });
                tlEndWrap.appendChild(tlEndInput);
                _attachTimelineDateInputUX(tlEndInput, { withPicker: true, withFeedback: true });
                tlRow.appendChild(tlEndWrap);
                editor.appendChild(tlRow);

                // Events list
                _tlInlineEvents = (page.events || []).slice();
                var tlEvLabel = document.createElement('label');
                tlEvLabel.textContent = 'אירועים (עד 8)';
                tlEvLabel.style.fontWeight = 'bold';
                editor.appendChild(tlEvLabel);
                var tlEvList = document.createElement('div');
                tlEvList.id = 'tl-inline-events';
                editor.appendChild(tlEvList);
                function _renderTlInlineEvents() {
                    tlEvList.innerHTML = '';
                    _tlInlineEvents.forEach(function(ev, i) {
                        var row = document.createElement('div');
                        row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px;padding:6px;border:1px solid #e5e7eb;border-radius:6px;background:white';
                        row.innerHTML =
                            '<span style="font-weight:bold;color:#0369a1;min-width:16px;font-size:0.85em">' + (i + 1) + '</span>' +
                            '<input type="text" class="tli-time" data-idx="' + i + '" value="' + escapeAttr(ev.time || '') + '" placeholder="זמן" style="width:50px;padding:4px;border:1px solid #d1d5db;border-radius:4px;text-align:center;font-size:0.85em">' +
                            '<input type="text" class="tli-title" data-idx="' + i + '" value="' + escapeAttr(ev.title || '') + '" placeholder="כותרת" style="flex:1;padding:4px;border:1px solid #d1d5db;border-radius:4px;font-size:0.85em;direction:rtl">' +
                            '<input type="text" class="tli-content" data-idx="' + i + '" value="' + escapeAttr(ev.content || '') + '" placeholder="תוכן" style="flex:2;padding:4px;border:1px solid #d1d5db;border-radius:4px;font-size:0.85em;direction:rtl">' +
                            '<button type="button" class="tli-del" data-idx="' + i + '" style="background:#ef4444;color:white;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:0.6em;flex-shrink:0">✕</button>';
                        tlEvList.appendChild(row);
                    });
                    tlEvList.querySelectorAll('.tli-time,.tli-title,.tli-content').forEach(function(inp) {
                        inp.addEventListener('input', function() {
                            var idx = parseInt(inp.dataset.idx);
                            if (inp.classList.contains('tli-time')) _tlInlineEvents[idx].time = inp.value;
                            else if (inp.classList.contains('tli-title')) _tlInlineEvents[idx].title = inp.value;
                            else _tlInlineEvents[idx].content = inp.value;
                            _inlineOpen[page.id].dirty = true;
                        });
                        inp.addEventListener('keydown', function(e) {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            var idx = parseInt(inp.dataset.idx);
                            if (inp.classList.contains('tli-time')) { var n = tlEvList.querySelector('.tli-title[data-idx="' + idx + '"]'); if (n) n.focus(); }
                            else if (inp.classList.contains('tli-title')) { var n = tlEvList.querySelector('.tli-content[data-idx="' + idx + '"]'); if (n) n.focus(); }
                            else if (_tlInlineEvents.length < 8) { _tlInlineEvents.push({ time: '', title: '', content: '' }); _renderTlInlineEvents(); var n = tlEvList.querySelector('.tli-time[data-idx="' + (_tlInlineEvents.length - 1) + '"]'); if (n) n.focus(); _inlineOpen[page.id].dirty = true; }
                        });
                    });
                    tlEvList.querySelectorAll('.tli-del').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            var _delIdx = parseInt(btn.dataset.idx);
                            var _ev = _tlInlineEvents[_delIdx];
                            // Bug #6 — confirm before deleting a timeline event
                            // that has content; empty rows delete silently.
                            var _hasContent = _ev && ((_ev.time && _ev.time.trim()) ||
                                (_ev.title && _ev.title.trim()) || (_ev.content && _ev.content.trim()));
                            if (_hasContent && !confirm('למחוק את האירוע הזה מציר הזמן?')) return;
                            _tlInlineEvents.splice(_delIdx, 1);
                            _renderTlInlineEvents();
                            _inlineOpen[page.id].dirty = true;
                        });
                    });
                    tlEvList.querySelectorAll('.tli-time').forEach(function(inp) {
                        _attachTimelineDateInputUX(inp, {
                            withPicker: true,
                            withFeedback: false,
                            defaultGetter: function() { return tlStartInput ? tlStartInput.value : ''; }
                        });
                    });
                }
                _renderTlInlineEvents();
                var tlAddBtn = document.createElement('button');
                tlAddBtn.type = 'button';
                tlAddBtn.className = 'btn btn-secondary';
                tlAddBtn.textContent = '+ הוסף אירוע';
                tlAddBtn.style.cssText = 'padding:4px 12px;font-size:0.85em;margin-bottom:8px';
                tlAddBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (_tlInlineEvents.length >= 8) return;
                    _tlInlineEvents.push({ time: '', title: '', content: '' });
                    _renderTlInlineEvents();
                    var n = tlEvList.querySelector('.tli-time[data-idx="' + (_tlInlineEvents.length - 1) + '"]');
                    if (n) n.focus();
                    _inlineOpen[page.id].dirty = true;
                });
                editor.appendChild(tlAddBtn);
                // Interactive mode checkbox
                var _tlInteractive = !!page.interactive;
                var tlInterLabel = document.createElement('label');
                tlInterLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer;padding:8px;border:1px solid #d1d5db;border-radius:8px;background:#f0f9ff';
                var tlInterCb = document.createElement('input');
                tlInterCb.type = 'checkbox';
                tlInterCb.checked = _tlInteractive;
                tlInterCb.style.cssText = 'width:18px;height:18px;accent-color:#0369a1';
                tlInterCb.addEventListener('change', function() { _tlInteractive = tlInterCb.checked; _inlineOpen[page.id].dirty = true; });
                tlInterLabel.appendChild(tlInterCb);
                var tlInterText = document.createElement('span');
                tlInterText.style.fontSize = '0.9em';
                tlInterText.innerHTML = '<strong>מצב אינטראקטיבי</strong> — התלמיד ישבץ את האירועים';
                tlInterLabel.appendChild(tlInterText);
                editor.appendChild(tlInterLabel);
                // Content field below events for timeline pages
                editor.appendChild(contentLabel);
                editor.appendChild(contentEl);
            }

            // Notes with visibility toggle
            var notesRow = document.createElement('div');
            notesRow.style.cssText = 'display:flex;align-items:center;gap:6px';
            var notesLabel = document.createElement('label');
            notesLabel.textContent = 'הערות מורה';
            notesLabel.style.cssText = 'flex-shrink:0';
            notesRow.appendChild(notesLabel);
            var _notesHidden = !!page.notesHidden;
            var eyeBtn = document.createElement('button');
            eyeBtn.type = 'button';
            eyeBtn.textContent = _notesHidden ? '🙈' : '👁️';
            eyeBtn.title = _notesHidden ? 'ההערה מוסתרת במצגת (לחץ לשנות)' : 'ההערה גלויה במצגת (לחץ להסתיר)';
            eyeBtn.style.cssText = 'background:none;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;padding:2px 6px;font-size:0.9em';
            eyeBtn.addEventListener('click', function() {
                _notesHidden = !_notesHidden;
                eyeBtn.textContent = _notesHidden ? '🙈' : '👁️';
                eyeBtn.title = _notesHidden ? 'ההערה מוסתרת במצגת (לחץ לשנות)' : 'ההערה גלויה במצגת (לחץ להסתיר)';
                _inlineOpen[page.id].dirty = true;
            });
            notesRow.appendChild(eyeBtn);
            editor.appendChild(notesRow);
            var _audioOnly = false;
            // Slide color tag
            var _dotColor = page.dotColor || '';
            var colorRow = document.createElement('div');
            colorRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px';
            var colorLabel = document.createElement('label');
            colorLabel.textContent = 'צבע שקף:';
            colorLabel.style.cssText = 'flex-shrink:0;font-size:0.85em;color:#6b7280';
            colorRow.appendChild(colorLabel);
            var dotColors = ['', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899'];
            var dotLabels = ['ברירת מחדל', 'אדום', 'כחול', 'ירוק', 'כתום', 'סגול', 'ורוד'];
            dotColors.forEach(function(c, ci) {
                var dot = document.createElement('div');
                dot.style.cssText = 'width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid ' + (_dotColor === c ? '#333' : '#d1d5db') + ';background:' + (c || '#e5e7eb');
                dot.title = dotLabels[ci];
                dot.addEventListener('click', function() {
                    _dotColor = c;
                    colorRow.querySelectorAll('div').forEach(function(d) { if (d.style.borderRadius === '50%') d.style.borderColor = '#d1d5db'; });
                    dot.style.borderColor = '#333';
                    _inlineOpen[page.id].dirty = true;
                });
                colorRow.appendChild(dot);
            });
            editor.appendChild(colorRow);
            var notesEl = document.createElement('input');
            notesEl.type = 'text';
            notesEl.value = page.notes || '';
            notesEl.dir = 'rtl';
            notesEl.placeholder = 'הערות לעצמך...';
            editor.appendChild(notesEl);

            // Track dirty state
            var origTitle = page.title || '';
            var origContent = hasSentence ? (page.bodyText || '') : (page.content || '');
            var origNotes = page.notes || '';
            var origSentence = hasSentence ? (page.sentence || (page.content || '').replace(/<[^>]*>/g, '') || '') : '';
            function _isDirty() {
                return titleEl.value !== origTitle ||
                    contentEl.innerHTML !== origContent ||
                    notesEl.value !== origNotes ||
                    (sentenceEl && sentenceEl.value !== origSentence);
            }
            titleEl.addEventListener('input', function() { _inlineOpen[page.id].dirty = true; });
            contentEl.addEventListener('input', function() { _inlineOpen[page.id].dirty = true; });
            notesEl.addEventListener('input', function() { _inlineOpen[page.id].dirty = true; });
            if (sentenceEl) sentenceEl.addEventListener('input', function() { _inlineOpen[page.id].dirty = true; });

            // Task #13 — the first time the teacher types into the body text of
            // an existing card's inline editor, gently pop the ⛶ fullscreen
            // button once to invite them into fullscreen. Debounced to once per
            // editing session (not per keystroke), skipped if already in
            // fullscreen, auto-cleared after the short animation. Touch-safe
            // (pure CSS keyframes, no hover).
            function _maybeFsHint() {
                if (_fsHintShown || _inlineFsOverlay) return;
                _fsHintShown = true;
                inlineFsBtn.classList.add('lpc-fs-pop');
                setTimeout(function() { inlineFsBtn.classList.remove('lpc-fs-pop'); }, 3800);
            }
            contentEl.addEventListener('input', _maybeFsHint);
            if (sentenceEl) sentenceEl.addEventListener('input', _maybeFsHint);

            // Ctrl+S to save, Ctrl+G to convert Hebrew→Arabic (selection only), Ctrl+Z custom undo
            editor.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.code === 'KeyS')) {
                    e.preventDefault();
                    saveBtn.click();
                }
                if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
                    if (contentEl._customUndoStack && contentEl._customUndoStack.length > 0) {
                        e.preventDefault();
                        _popEditorUndo(contentEl);
                    }
                }
                if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                    e.preventDefault();
                    if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                        if (document.activeElement === contentEl) {
                            var sel = window.getSelection();
                            if (sel && !sel.isCollapsed && contentEl.contains(sel.anchorNode)) {
                                var selectedText = sel.toString();
                                var converted = DetailsPanel._convertHebrewToArabic(selectedText);
                                document.execCommand('insertText', false, converted);
                                _inlineOpen[page.id].dirty = true;
                            }
                        } else if (document.activeElement === titleEl) {
                            var start = titleEl.selectionStart, end = titleEl.selectionEnd;
                            if (start !== end) {
                                var val = titleEl.value;
                                var selected = val.substring(start, end);
                                titleEl.value = val.substring(0, start) + DetailsPanel._convertHebrewToArabic(selected) + val.substring(end);
                                _inlineOpen[page.id].dirty = true;
                            }
                        } else if (sentenceEl && document.activeElement === sentenceEl) {
                            var start = sentenceEl.selectionStart, end = sentenceEl.selectionEnd;
                            if (start !== end) {
                                var val = sentenceEl.value;
                                var selected = val.substring(start, end);
                                sentenceEl.value = val.substring(0, start) + DetailsPanel._convertHebrewToArabic(selected) + val.substring(end);
                                _inlineOpen[page.id].dirty = true;
                            }
                        } else if (document.activeElement === notesEl) {
                            var start = notesEl.selectionStart, end = notesEl.selectionEnd;
                            if (start !== end) {
                                var val = notesEl.value;
                                var selected = val.substring(start, end);
                                notesEl.value = val.substring(0, start) + DetailsPanel._convertHebrewToArabic(selected) + val.substring(end);
                                _inlineOpen[page.id].dirty = true;
                            }
                        }
                    }
                }
            });

            // Buttons row
            var btnsRow = document.createElement('div');
            btnsRow.className = 'lpc-inline-btns';

            var saveBtn = document.createElement('button');
            saveBtn.className = 'btn btn-primary';
            saveBtn.style.cssText = 'padding:6px 18px;font-size:0.9em';
            saveBtn.textContent = 'שמור';
            saveBtn.addEventListener('click', function() {
                // Exit qmark mode before saving so spans are properly formed
                if (contentEl._qmarkMode) _exitQmarkMode(contentEl, editor.querySelector('[title*="מוסתר"]'));
                var content = hasSentence && sentenceEl ? sentenceEl.value.trim() : contentEl.innerHTML.trim();
                var title = titleEl.value.trim();
                var notes = notesEl.value.trim();
                var updateData = { content: content, title: title, notes: notes, notesHidden: _notesHidden, audioOnly: _audioOnly, dotColor: _dotColor };
                if (hasSentence && sentenceEl) {
                    updateData.sentence = content;
                    updateData.bodyText = contentEl.innerHTML.trim();
                }
                if (verbsEl && verbsEl.getValue) {
                    updateData.verbs = verbsEl.getValue();
                    updateData.content = contentEl.innerHTML.trim();
                }
                if (_tlInlineEvents && page.type === 'timeline') {
                    updateData.tlStart = tlStartInput ? tlStartInput.value.trim() : '';
                    updateData.tlEnd = tlEndInput ? tlEndInput.value.trim() : '';
                    updateData.events = _tlInlineEvents;
                    updateData.content = contentEl.innerHTML.trim();
                    updateData.interactive = _tlInteractive;
                }
                if (mediaUrlEl) {
                    var mediaUrl = mediaUrlEl.value.trim();
                    // Auto-detect: YouTube or video extension → videoUrl, otherwise → imageUrl
                    if (_youtubeToEmbed(mediaUrl) || /\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl)) {
                        updateData.videoUrl = mediaUrl;
                        updateData.imageUrl = '';
                    } else {
                        updateData.imageUrl = mediaUrl;
                        updateData.videoUrl = '';
                    }
                }
                var _saveOk = updatePage(lesson.id, page.id, updateData) !== null;
                // Update page object so reopening the editor shows saved content
                page.content = content;
                page.title = title;
                page.notes = notes;
                if (hasSentence && sentenceEl) {
                    page.sentence = content;
                    page.bodyText = contentEl.innerHTML.trim();
                }
                if (verbsEl && verbsEl.getValue) {
                    page.verbs = verbsEl.getValue();
                }
                if (_tlInlineEvents && page.type === 'timeline') {
                    page.tlStart = tlStartInput ? tlStartInput.value.trim() : '';
                    page.tlEnd = tlEndInput ? tlEndInput.value.trim() : '';
                    page.events = _tlInlineEvents.slice();
                    page.interactive = _tlInteractive;
                }
                if (mediaUrlEl) {
                    var mediaUrl = mediaUrlEl.value.trim();
                    if (_youtubeToEmbed(mediaUrl) || /\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl)) {
                        page.videoUrl = mediaUrl;
                        page.imageUrl = '';
                    } else {
                        page.imageUrl = mediaUrl;
                        page.videoUrl = '';
                    }
                }
                page.notesHidden = _notesHidden;
                page.audioOnly = _audioOnly;
                page.dotColor = _dotColor;
                if (!_saveOk) {
                    // Save failed (storage full) — saveLessons already showed the
                    // error toast. Do NOT flash "saved" or clear the dirty flag.
                    return;
                }
                // Green flash on card
                card.classList.add('lpc-save-flash');
                setTimeout(function() { card.classList.remove('lpc-save-flash'); }, 750);
                // UX #6 — quiet, reassuring "saved" confirmation.
                _showEditorToast('נשמר ✓');
                // Update originals so dirty check resets
                origTitle = title;
                origContent = content;
                origNotes = notes;
                if (_inlineOpen[page.id]) _inlineOpen[page.id].dirty = false;
                // Refresh the summary line without full re-render
                var infoDiv = card.querySelector('.lpc-card-info');
                if (infoDiv) {
                    infoDiv.innerHTML =
                        '<div style="font-weight:bold;font-size:0.85em;color:' + (typeColors[page.type] || '#6b7280') + '">' + (typeLabels[page.type] || page.type) + '</div>' +
                        '<div style="font-family:PlonterFlippedDiacritics,Arial,serif;font-size:1.05em;direction:rtl;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                            (title ? '<strong>' + escapeHtml(title) + '</strong> — ' : '') +
                            escapeHtml(content.replace(/<[^>]*>/g, '').substring(0, 80)) +
                        '</div>' +
                        (notes ? '<div style="font-size:0.8em;color:#9ca3af;margin-top:2px">' + escapeHtml(notes) + '</div>' : '');
                    var _saveDiff = _getSlideDiffSummary(lesson.pages, page, pageIdx);
                    if (_saveDiff) {
                        infoDiv.innerHTML += '<div class="lpc-diff-line" style="font-size:0.75em;color:#0891b2;font-style:italic;margin-top:2px;direction:rtl">' + escapeHtml(_saveDiff) + '</div>';
                    }
                }
                // Update diff summaries on ALL cards (other slides may reference this one)
                var allCards = document.querySelectorAll('.lpc-card');
                allCards.forEach(function(otherCard, ci) {
                    if (ci === pageIdx) return;
                    var otherInfo = otherCard.querySelector('.lpc-card-info');
                    if (!otherInfo) return;
                    var otherPage = lesson.pages[ci];
                    if (!otherPage || otherPage.title !== page.title) return;
                    // Remove old diff line and add updated one
                    var oldDiff = otherInfo.querySelector('.lpc-diff-line');
                    if (oldDiff) oldDiff.remove();
                    var newDiff = _getSlideDiffSummary(lesson.pages, otherPage, ci);
                    if (newDiff) {
                        otherInfo.innerHTML += '<div class="lpc-diff-line" style="font-size:0.75em;color:#0891b2;font-style:italic;margin-top:2px;direction:rtl">' + escapeHtml(newDiff) + '</div>';
                    }
                });
            });
            // Save and Close button (rightmost in RTL = first child)
            var saveCloseBtn = document.createElement('button');
            saveCloseBtn.className = 'btn btn-primary';
            saveCloseBtn.style.cssText = 'padding:6px 14px;font-size:0.9em;background:#0d9488;border-color:#0d9488';
            saveCloseBtn.textContent = 'שמור וסגור';
            saveCloseBtn.addEventListener('click', function() {
                saveBtn.click();
                editor.remove();
                delete _inlineOpen[page.id];
                card.draggable = true;
                card.style.cursor = 'grab';
            });
            btnsRow.appendChild(saveCloseBtn);

            btnsRow.appendChild(saveBtn);

            var closeBtn = document.createElement('button');
            closeBtn.className = 'btn btn-secondary';
            closeBtn.style.cssText = 'padding:6px 14px;font-size:0.9em';
            closeBtn.textContent = 'סגור';
            closeBtn.addEventListener('click', function() {
                if (_isDirty() || (_inlineOpen[page.id] && _inlineOpen[page.id].dirty)) {
                    _showSavePrompt(function(choice) {
                        if (choice === 'save') saveBtn.click();
                        if (choice === 'save' || choice === 'discard') {
                            editor.remove();
                            delete _inlineOpen[page.id];
                            card.draggable = true;
                            card.style.cursor = 'grab';
                        }
                    });
                    return;
                }
                editor.remove();
                delete _inlineOpen[page.id];
                card.draggable = true;
                card.style.cursor = 'grab';
            });
            btnsRow.appendChild(closeBtn);

            editor.appendChild(btnsRow);
            card.appendChild(editor);

            // Focus content
            contentEl.focus();
            // Place cursor at end
            var range = document.createRange();
            var sel = window.getSelection();
            range.selectNodeContents(contentEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // Slide diff: compare current slide to closest slide above with same title
        function _getSlideDiffSummary(pages, page, idx) {
            if (!page.title) return '';
            var refIdx = -1;
            for (var i = idx - 1; i >= 0; i--) {
                if (pages[i].title === page.title) { refIdx = i; break; }
            }
            if (refIdx === -1) return '';
            var ref = pages[refIdx];
            var refNum = refIdx + 1;
            var contentA = ref.content || '';
            var contentB = page.content || '';
            var notesA = ref.notes || '';
            var notesB = page.notes || '';
            // Identical check
            if (contentA === contentB && notesA === notesB) {
                return '\u05D6\u05D4\u05D4 \u05DC\u05E9\u05E7\u05E3 ' + refNum; // זהה לשקף X
            }
            if (contentA === contentB && notesA !== notesB) {
                return '\u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum + ' \u05D1\u05D4\u05E2\u05E8\u05D4'; // שונה משקף X בהערה
            }
            // Word-level comparison: parse HTML words
            function _parseWords(html) {
                // Split by whitespace but preserve HTML tags on each word
                var tmp = document.createElement('div');
                tmp.innerHTML = html;
                var result = [];
                function walk(node) {
                    if (node.nodeType === 3) {
                        var words = node.textContent.split(/\s+/);
                        for (var w = 0; w < words.length; w++) {
                            if (words[w]) result.push({ text: words[w], bold: false, underline: false, color: '' });
                        }
                    } else if (node.nodeType === 1) {
                        var isBold = node.tagName === 'B' || node.tagName === 'STRONG' || (node.style && node.style.fontWeight === 'bold');
                        var isUnderline = node.tagName === 'U' || (node.style && node.style.textDecoration && node.style.textDecoration.indexOf('underline') !== -1);
                        var color = (node.style && node.style.color) ? node.style.color : '';
                        var prevLen = result.length;
                        for (var c = 0; c < node.childNodes.length; c++) {
                            walk(node.childNodes[c]);
                        }
                        // Apply formatting to newly added words
                        for (var j = prevLen; j < result.length; j++) {
                            if (isBold) result[j].bold = true;
                            if (isUnderline) result[j].underline = true;
                            if (color) result[j].color = color;
                        }
                    }
                }
                walk(tmp);
                return result;
            }
            var wordsA = _parseWords(contentA);
            var wordsB = _parseWords(contentB);
            var minLen = Math.min(wordsA.length, wordsB.length);
            for (var wi = 0; wi < minLen; wi++) {
                var wa = wordsA[wi], wb = wordsB[wi];
                if (wa.text !== wb.text) {
                    // Different word text — show content preview from this word
                    var plain = contentB.replace(/<[^>]*>/g, '');
                    var previewWords = plain.split(/\s+/);
                    var preview = previewWords.slice(wi, wi + 6).join(' ');
                    return '\u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum + ': ...' + preview; // שונה משקף X: ...preview
                }
                if (wa.bold !== wb.bold) {
                    var word = wb.text;
                    if (wb.bold) return word + ' \u05DE\u05D5\u05D3\u05D2\u05E9\u05EA \u05D1\u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum; // מודגשת בשונה משקף X
                    return word + ' \u05DC\u05D0 \u05DE\u05D5\u05D3\u05D2\u05E9\u05EA \u05D1\u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum; // לא מודגשת בשונה משקף X
                }
                if (wa.color !== wb.color) {
                    return wb.text + ' \u05D1\u05E6\u05D1\u05E2 \u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum; // בצבע שונה משקף X
                }
                if (wa.underline !== wb.underline) {
                    return wb.text + ' \u05E7\u05D5 \u05EA\u05D7\u05EA\u05D5\u05DF \u05D1\u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum; // קו תחתון בשונה משקף X
                }
            }
            if (wordsB.length !== wordsA.length) {
                if (wordsB.length < wordsA.length) {
                    var trimmed = wordsA.length - wordsB.length;
                    return '\u05E7\u05D5\u05E6\u05E6\u05D5 ' + trimmed + ' \u05DE\u05D9\u05DC\u05D9\u05DD \u05DE\u05D4\u05E1\u05D5\u05E3 (' + wordsB.length + '/' + wordsA.length + ' \u05DE\u05D9\u05DC\u05D9\u05DD)';
                }
                return '\u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum + ' (' + wordsB.length + '/' + wordsA.length + ' \u05DE\u05D9\u05DC\u05D9\u05DD)';
            }
            // Notes differ (content identical at word level but HTML differs)
            return '\u05E9\u05D5\u05E0\u05D4 \u05D1\u05E9\u05E7\u05E3 ' + refNum;
        }

        lesson.pages.forEach(function(page, idx) {
            var card = document.createElement('div');
            card.className = 'lesson-page-card';
            card.style.cssText = 'position:relative;border:2px solid ' + (typeColors[page.type] || '#d1d5db') + ';border-radius:10px;padding:7px 34px 7px 14px;margin-bottom:6px;background:white';
            card.draggable = true;
            // UX #7 — the card body no longer drags or edits. Dragging starts
            // only from the ⠿ handle (gated via card._handleGrab below), and
            // editing only from the explicit "✏️ ערוך" button. This stops
            // accidental edit-entry and accidental reordering on a stray click.
            card.style.cursor = 'default';
            card.dataset.idx = idx;

            card.addEventListener('dragend', function() {
                if (!card.querySelector('.lpc-inline-editor')) {
                    card.draggable = true;
                }
                card._handleGrab = false;
            });

            // --- Delete button: ✕ top-right (RTL: right side visually = start side) ---
            var delPageBtn = document.createElement('button');
            delPageBtn.className = 'lpc-delete-btn';
            delPageBtn.innerHTML = '✕';
            delPageBtn.title = 'מחק דף';
            (function(capturedPage, capturedIdx) {
                delPageBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    _showStyledConfirm('למחוק את הדף?', function() {
                        // Snapshot the page so the delete is undoable (UX #9).
                        var _restorePage = JSON.parse(JSON.stringify(capturedPage));
                        removePage(lesson.id, capturedPage.id);
                        renderEditor(getLesson(lesson.id));
                        _showUndoToast('הדף נמחק', function() {
                            var lessons = loadLessons();
                            var li = lessons.findIndex(function(l) { return l.id === lesson.id; });
                            if (li === -1) return;
                            var pages = lessons[li].pages || (lessons[li].pages = []);
                            // Avoid a double-restore if somehow still present.
                            if (pages.some(function(p) { return p.id === _restorePage.id; })) return;
                            var at = Math.min(capturedIdx, pages.length);
                            pages.splice(at, 0, _restorePage);
                            lessons[li].updated = new Date().toISOString();
                            saveLessons(lessons);
                            renderEditor(getLesson(lesson.id));
                        });
                    });
                });
            })(page, idx);
            card.appendChild(delPageBtn);

            // Card body row
            var bodyRow = document.createElement('div');
            bodyRow.style.cssText = 'display:flex;align-items:center;gap:12px';

            var num = document.createElement('div');
            num.style.cssText = 'width:32px;height:32px;border-radius:50%;background:' + (typeColors[page.type] || '#d1d5db') + ';color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0';
            num.textContent = idx + 1;

            var info = document.createElement('div');
            info.className = 'lpc-card-info';
            info.style.cssText = 'flex:1;min-width:0';
            var _diffSummary = _getSlideDiffSummary(lesson.pages, page, idx);
            var _bodyPreview = _diffSummary
                ? '<div style="font-family:PlonterFlippedDiacritics,Arial,serif;font-size:1.05em;direction:rtl;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#0891b2;font-style:italic">' +
                    (page.title ? '<strong style="color:inherit">' + escapeHtml(page.title) + '</strong> — ' : '') +
                    escapeHtml(_diffSummary) +
                  '</div>'
                : '<div style="font-family:PlonterFlippedDiacritics,Arial,serif;font-size:1.05em;direction:rtl;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    (page.title ? '<strong>' + escapeHtml(page.title) + '</strong> — ' : '') +
                    escapeHtml((page.content || '').replace(/<[^>]*>/g, '').substring(0, 80)) +
                  '</div>';
            var _notesColor = _diffSummary ? '#a855f7' : '#9ca3af';
            var _interactiveBadge = (page.type === 'timeline' && page.interactive) ? ' <span style="font-size:0.75em;background:#dbeafe;color:#1d4ed8;padding:1px 5px;border-radius:8px">אינטראקטיבי</span>' : '';
            info.innerHTML =
                '<div style="font-weight:bold;font-size:0.85em;color:' + (typeColors[page.type] || '#6b7280') + '">' + (typeLabels[page.type] || page.type) + _interactiveBadge + '</div>' +
                _bodyPreview +
                (page.notes ? '<div style="font-size:0.8em;color:' + _notesColor + ';margin-top:2px">' + escapeHtml(page.notes) + '</div>' : '');

            var actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:4px;flex-shrink:0';

            // UX #7 — explicit edit button (replaces whole-card click-to-edit).
            var editPageBtn = document.createElement('button');
            editPageBtn.className = 'btn btn-primary lpc-edit-btn';
            editPageBtn.innerHTML = '✏️ ערוך';
            editPageBtn.title = 'ערוך את הדף';
            editPageBtn.style.cssText = 'padding:4px 10px;font-size:0.85em';
            (function(capturedIdx) {
                editPageBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    _buildInlineEditor(card, page, capturedIdx);
                });
            })(idx);
            actions.appendChild(editPageBtn);

            // Duplicate
            var dupPageBtn = document.createElement('button');
            dupPageBtn.className = 'btn btn-secondary';
            dupPageBtn.innerHTML = '📋';
            dupPageBtn.title = 'שכפל דף';
            dupPageBtn.style.cssText = 'padding:4px 8px;font-size:0.85em';
            (function(capturedPage, capturedIdx) {
                function _doDuplicate() {
                    var lessons = loadLessons();
                    var lessonIdx = lessons.findIndex(function(l) { return l.id === lesson.id; });
                    if (lessonIdx === -1) return;
                    // Re-read page from saved data (may have been updated by save)
                    var srcPage = lessons[lessonIdx].pages[capturedIdx];
                    var clone = JSON.parse(JSON.stringify(srcPage || capturedPage));
                    clone.id = 'page_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                    lessons[lessonIdx].pages.splice(capturedIdx + 1, 0, clone);
                    lessons[lessonIdx].updated = new Date().toISOString();
                    saveLessons(lessons);
                    renderEditor(getLesson(lesson.id));
                    setTimeout(function() {
                        var cards = document.querySelectorAll('.lesson-page-card');
                        var newCard = cards[capturedIdx + 1];
                        if (newCard) {
                            newCard.classList.add('lpc-dup-anim');
                            setTimeout(function() { newCard.classList.remove('lpc-dup-anim'); }, 700);
                            // UX #7 — card click no longer edits; open via the
                            // explicit edit button on the new card.
                            var _newEditBtn = newCard.querySelector('.lpc-edit-btn');
                            if (_newEditBtn) _newEditBtn.click();
                        }
                        var title = capturedPage.title || ('\u05e9\u05e7\u05e3 ' + (capturedIdx + 1));
                        _showEditorToast('\u05e9\u05db\u05e4\u05dc\u05ea \u05d0\u05ea \u2014 ' + title);
                    }, 50);
                }
                dupPageBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    // Check if this page has unsaved inline edits
                    if (_inlineOpen[capturedPage.id] && _inlineOpen[capturedPage.id].dirty) {
                        _showDuplicatePrompt(function(choice) {
                            if (choice === 'save') {
                                // Save, then duplicate
                                var editor = document.querySelector('.lpc-inline-editor');
                                if (editor) {
                                    var saveBtn = editor.querySelector('.btn.btn-primary');
                                    if (saveBtn) saveBtn.click();
                                }
                                setTimeout(_doDuplicate, 50);
                            } else if (choice === 'dup') {
                                _doDuplicate();
                            }
                            // 'cancel' — do nothing
                        });
                        return;
                    }
                    _doDuplicate();
                });
            })(page, idx);
            actions.appendChild(dupPageBtn);

            // Copy JSON
            var copyJsonBtn = document.createElement('button');
            copyJsonBtn.className = 'btn btn-secondary';
            copyJsonBtn.innerHTML = '{ }';
            copyJsonBtn.title = 'העתק JSON של השקף';
            copyJsonBtn.style.cssText = 'padding:4px 8px;font-size:0.7em;font-weight:bold;font-family:monospace';
            (function(capturedPage, capturedIdx) {
                copyJsonBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    // Re-read from saved data
                    var lessons = loadLessons();
                    var li = lessons.findIndex(function(l) { return l.id === lesson.id; });
                    var srcPage = (li !== -1 && lessons[li].pages[capturedIdx]) ? lessons[li].pages[capturedIdx] : capturedPage;
                    var clean = JSON.parse(JSON.stringify(srcPage));
                    delete clean.id;
                    var json = JSON.stringify(clean, null, 2);
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(json);
                    } else {
                        _copyToClipboard(json);
                    }
                    _showEditorToast('JSON הועתק ✓');
                });
            })(page, idx);
            actions.appendChild(copyJsonBtn);

            bodyRow.appendChild(num);
            bodyRow.appendChild(info);
            bodyRow.appendChild(actions);
            // UX (Amitai 2026-06-05) — clicking the card header (number/title/preview)
            // toggles the inline editor too, alongside the kept ✏️ ערוך button.
            // Inner action buttons already stopPropagation and the drag grip is a
            // separate element, so they do NOT trigger this toggle.
            bodyRow.style.cursor = 'pointer';
            bodyRow.title = 'לחץ לפתיחה/סגירה של עריכת השיעור';
            (function(capturedIdx) {
                bodyRow.addEventListener('click', function(e) {
                    if (e.target.closest('button') || e.target.closest('.lpc-drag-handle')) return;
                    _buildInlineEditor(card, page, capturedIdx);
                });
            })(idx);
            card.appendChild(bodyRow);

            // UX #7 — drag handle (⠿). Only a grab that begins on the handle
            // arms the card for dragging; any other dragstart is cancelled.
            var dragHandle = document.createElement('div');
            dragHandle.className = 'lpc-drag-handle';
            dragHandle.innerHTML = '⠿';
            dragHandle.title = 'גרור כדי לשנות סדר';
            dragHandle.addEventListener('mousedown', function() { _armedDragCard = card; card._handleGrab = true; });
            dragHandle.addEventListener('touchstart', function() { _armedDragCard = card; card._handleGrab = true; }, { passive: true });
            card.insertBefore(dragHandle, card.firstChild);

            // --- Drag & Drop (card events) ---
            card.addEventListener('dragstart', function(e) {
                if (!card._handleGrab) { e.preventDefault(); return; }
                _dragSrcIdx = idx;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
                setTimeout(function() {
                    card.classList.add('lpc-dragging');
                    // Show drop zones except the two adjacent to the dragged card (which are no-ops)
                    var zones = list.querySelectorAll('.lpc-drop-zone');
                    zones.forEach(function(z, zi) {
                        if (zi === _dragSrcIdx || zi === _dragSrcIdx + 1) {
                            z.style.display = 'none';
                        } else {
                            z.style.display = 'block';
                            z.classList.add('visible');
                        }
                    });
                }, 0);
            });
            card.addEventListener('dragend', function() {
                card.classList.remove('lpc-dragging');
                _stopAutoScroll();
                // Hide all drop zones
                list.querySelectorAll('.lpc-drop-zone').forEach(function(z) {
                    z.classList.remove('active', 'visible');
                    z.style.display = 'none';
                });
            });
            card.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                // Activate drop zone above or below based on cursor position
                var rect = card.getBoundingClientRect();
                var midY = rect.top + rect.height / 2;
                var zones = list.querySelectorAll('.lpc-drop-zone');
                zones.forEach(function(z) { z.classList.remove('active'); });
                if (e.clientY < midY) {
                    // Activate zone before this card
                    if (card.previousElementSibling && card.previousElementSibling.classList.contains('lpc-drop-zone')) {
                        card.previousElementSibling.classList.add('active');
                    }
                } else {
                    // Activate zone after this card
                    if (card.nextElementSibling && card.nextElementSibling.classList.contains('lpc-drop-zone')) {
                        card.nextElementSibling.classList.add('active');
                    }
                }
                // Auto-scroll when dragging near viewport edges
                var scrollZone = 80;
                var maxSpeed = 18;
                if (e.clientY < scrollZone) {
                    var ratio = 1 - (e.clientY / scrollZone);
                    _autoScrollSpeed = -Math.round(maxSpeed * ratio);
                    _startAutoScroll();
                } else if (e.clientY > window.innerHeight - scrollZone) {
                    var ratio = 1 - ((window.innerHeight - e.clientY) / scrollZone);
                    _autoScrollSpeed = Math.round(maxSpeed * ratio);
                    _startAutoScroll();
                } else {
                    _autoScrollSpeed = 0;
                }
            });
            card.addEventListener('dragleave', function() {
                // Clear active zones when leaving card
                list.querySelectorAll('.lpc-drop-zone.active').forEach(function(z) { z.classList.remove('active'); });
            });
            // Drop on card — delegate to nearest zone
            (function(cardIdx) {
                card.addEventListener('drop', function(e) {
                    e.preventDefault();
                    if (_dragSrcIdx === null) return;
                    var rect = card.getBoundingClientRect();
                    var midY = rect.top + rect.height / 2;
                    var targetIdx = e.clientY < midY ? cardIdx : cardIdx + 1;
                    var toIdx = _dragSrcIdx < targetIdx ? targetIdx - 1 : targetIdx;
                    if (toIdx !== _dragSrcIdx) _reorderAndRender(_dragSrcIdx, toIdx);
                    _dragSrcIdx = null;
                });
            })(idx);

            // Insert drop zone BEFORE each card
            var dropZone = document.createElement('div');
            dropZone.className = 'lpc-drop-zone';
            dropZone.style.display = 'none';
            (function(zoneIdx) {
                dropZone.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    this.classList.add('active');
                });
                dropZone.addEventListener('dragleave', function() {
                    this.classList.remove('active');
                });
                dropZone.addEventListener('drop', function(e) {
                    e.preventDefault();
                    this.classList.remove('active');
                    if (_dragSrcIdx === null || _dragSrcIdx === zoneIdx) return;
                    var toIdx = _dragSrcIdx < zoneIdx ? zoneIdx - 1 : zoneIdx;
                    if (toIdx !== _dragSrcIdx) _reorderAndRender(_dragSrcIdx, toIdx);
                    _dragSrcIdx = null;
                });
            })(idx);
            list.appendChild(dropZone);

            list.appendChild(card);
        });

        // Final drop zone after last card
        var lastDropZone = document.createElement('div');
        lastDropZone.className = 'lpc-drop-zone';
        lastDropZone.style.display = 'none';
        (function(lastIdx) {
            lastDropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                this.classList.add('active');
            });
            lastDropZone.addEventListener('dragleave', function() {
                this.classList.remove('active');
            });
            lastDropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('active');
                if (_dragSrcIdx === null) return;
                var toIdx = lesson.pages.length - 1;
                if (toIdx !== _dragSrcIdx) _reorderAndRender(_dragSrcIdx, toIdx);
                _dragSrcIdx = null;
            });
        })(lesson.pages.length);
        list.appendChild(lastDropZone);
    }

    function closeEditor() {
        var lessonToFocus = getLesson(_currentEditorLessonId);
        var editor = document.getElementById('lesson-editor');
        if (editor) editor.style.display = 'none';
        document.getElementById('welcome-screen').style.display = '';
        _currentEditorLessonId = null;
        if (lessonToFocus) _focusLessonInCategory(lessonToFocus);
        renderLessonsList();
        // #1161: only jump to top when there is no item to return to — otherwise the
        // highlight block smooth-scrolls the exited item into view (no top flash).
        if (!lessonToFocus) window.scrollTo(0, 0);
    }

    // --- UI: Add/Edit Page Dialog ---

    function showAddPageDialog(lessonId, type) {
        _showPageDialog(lessonId, type, null);
    }

    function showEditPageDialog(lessonId, page) {
        _showPageDialog(lessonId, page.type, page);
    }

    function _showPageDialog(lessonId, type, existingPage) {
        var typeLabels = { text: 'טקסט', image: 'תמונה/סרטון', video: 'תמונה/סרטון', analyze: 'ניתוח תחבירי', diacritics: 'חשיפת ניקוד', dictionary: 'חיפוש מילון', engineering: 'הינדוס משפט', verb_analysis: 'ניתוח פעלים', timeline: 'ציר זמן' };
        var isEdit = !!existingPage;

        // Add contentEditable placeholder CSS if not already added
        if (!document.getElementById('rich-edit-style')) {
            var styleEl = document.createElement('style');
            styleEl.id = 'rich-edit-style';
            styleEl.textContent = '#page-content-input.empty:before{content:attr(data-placeholder);color:#9ca3af;pointer-events:none;position:absolute}#page-content-input{position:relative}';
            document.head.appendChild(styleEl);
        }

        var modal = document.createElement('div');
        modal.className = 'modal show';
        // Timeline editor needs more horizontal room — event rows + inline date/title/content
        // fields easily exceed 700px. Use viewport-relative cap so it grows on desktop but
        // still fits phones. (Amitai 2026-05-18 20:37: "הממסך קטן מדי וקשה להכניס את הציר זמן".)
        var dialogMaxWidth = type === 'timeline' ? 'min(95vw, 1100px)' : '500px';
        modal.innerHTML =
            '<div class="modal-content" style="max-width:' + dialogMaxWidth + '">' +
                '<span class="close">&times;</span>' +
                '<h2 style="margin-bottom:16px;color:#0d9488">' + (isEdit ? 'עריכת' : 'הוספת') + ' שקף — ' + (typeLabels[type] || type) + '</h2>' +
                '<div style="margin-bottom:12px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">כותרת (אופציונלי)</label>' +
                    '<input type="text" id="page-title-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:1em" dir="rtl" placeholder="כותרת הדף..." value="' + escapeAttr(isEdit ? existingPage.title : '') + '">' +
                '</div>' +
                ((type === 'analyze' || type === 'engineering') ?
                    '<div style="margin-bottom:12px">' +
                        '<label style="display:block;margin-bottom:4px;font-weight:bold">משפט ל' + (type === 'analyze' ? 'ניתוח' : 'הינדוס') + '</label>' +
                        '<input type="text" id="page-sentence-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:1.1em;font-family:PlonterFlippedDiacritics,Arial,serif" dir="rtl" placeholder="הקלד את המשפט כאן..." value="' + escapeAttr(isEdit && existingPage.sentence ? existingPage.sentence : (isEdit ? (existingPage.content || '').replace(/<[^>]*>/g, '') : '')) + '">' +
                    '</div>' : '') +
                (type === 'timeline' ?
                    '<div style="margin-bottom:12px">' +
                        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
                            '<div style="flex:1"><label style="display:block;margin-bottom:4px;font-weight:bold">נקודת התחלה <span style="font-weight:normal;font-size:0.85em;color:#6b7280">(שמאל — מוקדם)</span></label><input type="text" id="tl-start" style="width:100%;padding:8px;border:2px solid #d1d5db;border-radius:8px;font-size:1em;text-align:center" value="' + escapeAttr(isEdit && existingPage.tlStart ? existingPage.tlStart : '') + '" placeholder="לדוג׳: 1900"></div>' +
                            '<div style="flex:1"><label style="display:block;margin-bottom:4px;font-weight:bold">נקודת סיום <span style="font-weight:normal;font-size:0.85em;color:#6b7280">(ימין — מאוחר)</span></label><input type="text" id="tl-end" style="width:100%;padding:8px;border:2px solid #d1d5db;border-radius:8px;font-size:1em;text-align:center" value="' + escapeAttr(isEdit && existingPage.tlEnd ? existingPage.tlEnd : '') + '" placeholder="לדוג׳: 2000"></div>' +
                        '</div>' +
                        '<label style="display:block;margin-bottom:4px;font-weight:bold">אירועים (עד 8)</label>' +
                        '<div id="tl-events-list"></div>' +
                        '<button type="button" id="tl-add-event" class="btn btn-secondary" style="padding:6px 16px;font-size:0.9em;margin-top:4px">+ הוסף אירוע</button>' +
                        '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;padding:8px;border:1px solid #d1d5db;border-radius:8px;background:#f0f9ff"><input type="checkbox" id="tl-interactive-cb"' + (isEdit && existingPage.interactive ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:#0369a1"><span style="font-size:0.95em"><strong>מצב אינטראקטיבי</strong> — התלמיד ישבץ את האירועים על ציר הזמן</span></label>' +
                    '</div>' : '') +
                (type === 'image' || type === 'video' ?
                    '<div style="margin-bottom:12px">' +
                        '<label style="display:block;margin-bottom:4px;font-weight:bold">מדיה (תמונה / YouTube / סרטון)</label>' +
                        '<input type="hidden" id="page-media-url-input" value="' + escapeAttr(isEdit ? (existingPage.imageUrl || existingPage.videoUrl || '') : '') + '">' +
                        '<div id="page-media-selected" style="display:' + (isEdit && (existingPage.imageUrl || existingPage.videoUrl) ? 'flex' : 'none') + ';align-items:center;gap:8px;padding:8px;border:2px solid #0d9488;border-radius:8px;background:#f0fdfa;margin-bottom:8px">' +
                            '<span style="font-size:1.2em">🎬</span>' +
                            '<span id="page-media-selected-title" style="flex:1;font-size:0.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeAttr(isEdit ? (existingPage.imageUrl || existingPage.videoUrl || '') : '') + '</span>' +
                            '<button type="button" id="page-media-clear" style="background:#ef4444;color:white;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:0.7em;flex-shrink:0">✕</button>' +
                        '</div>' +
                        '<div id="page-media-picker" style="border:2px solid #d1d5db;border-radius:8px;padding:8px">' +
                            '<div style="display:flex;gap:4px;margin-bottom:6px">' +
                                '<input type="text" id="page-media-search" style="flex:1;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85em;direction:rtl" placeholder="חפש במחסן מדיה...">' +
                                '<input type="text" id="page-media-url-manual" style="flex:1;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85em;direction:ltr" placeholder="או הדבק URL...">' +
                            '</div>' +
                            '<div id="page-media-lesson-folder" style="margin-bottom:6px"></div>' +
                            '<div id="page-media-browse-folders" style="margin-bottom:6px"></div>' +
                            '<div id="page-media-results" style="max-height:180px;overflow-y:auto"></div>' +
                        '</div>' +
                        '<div id="page-media-preview" style="margin-top:8px;text-align:center;display:none"><img id="page-media-preview-img" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #d1d5db;display:none"><iframe id="page-media-preview-iframe" style="width:100%;max-width:400px;height:225px;border:none;border-radius:8px;display:none"></iframe></div>' +
                    '</div>' : '') +
                '<div style="margin-bottom:12px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">' + (type === 'analyze' || type === 'engineering' ? 'גוף טקסט (אופציונלי)' : (type === 'image' || type === 'video') ? 'טקסט (אופציונלי)' : type === 'verb_analysis' ? 'הוראות לתלמיד (אופציונלי)' : 'תוכן') + '</label>' +
                    '<div id="page-content-toolbar" style="display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap;align-items:center">' +
                        '<button type="button" class="fmt-btn" data-cmd="bold" title="בולד (Ctrl+B)" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;font-weight:bold">B</button>' +
                        '<button type="button" class="fmt-btn" data-cmd="underline" title="קו תחתון (Ctrl+U)" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;text-decoration:underline">U</button>' +
                        '<button type="button" class="fmt-btn" data-cmd="removeFormat" title="הסר עיצוב" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;font-size:0.8em">✕</button>' +
                        '<span style="width:1px;background:#e5e7eb;height:22px;display:inline-block;margin:0 2px"></span>' +
                        '<button type="button" class="fmt-btn-qmark" title="סמן טקסט כמוסתר — יוצג כ-❓ במצגת" style="padding:2px 14px;border:1px solid #3b82f6;border-radius:4px;background:#dbeafe;cursor:pointer;font-size:0.85em;line-height:1.2">❓</button>' +
                        '<button type="button" id="fmt-btn-heb2ar" title="המר מילים עברית↔ערבית (לחיצה ארוכה = המר הכל)" style="padding:2px 10px;border:1px solid #ea580c;border-radius:4px;background:#fff7ed;cursor:pointer;font-size:0.85em;line-height:1.2;font-weight:bold">א↔ع</button>' +
                        '<div id="fmt-color-circle-wrap" style="position:relative;display:inline-flex;align-items:center;gap:4px;margin-right:auto">' +
                            '<input type="color" id="fmt-color-picker" value="#dc2626" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none">' +
                            '<div id="fmt-color-reset" style="width:24px;height:24px;border-radius:50%;background:#000000;cursor:pointer;border:2px solid #333;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:bold;line-height:1" title="איפוס צבע">✕</div>' +
                            '<div class="fmt-color-dot" data-fmt-color="#dc2626" style="width:24px;height:24px;border-radius:50%;background:#dc2626;cursor:pointer;border:2px solid #333;flex-shrink:0" title="אדום"></div>' +
                            '<div class="fmt-color-dot" data-fmt-color="#2563eb" style="width:24px;height:24px;border-radius:50%;background:#2563eb;cursor:pointer;border:2px solid #333;flex-shrink:0" title="כחול"></div>' +
                            '<div class="fmt-color-dot" data-fmt-color="#16a34a" style="width:24px;height:24px;border-radius:50%;background:#16a34a;cursor:pointer;border:2px solid #333;flex-shrink:0" title="ירוק"></div>' +
                            '<div class="fmt-color-dot" data-fmt-color="#f59e0b" style="width:24px;height:24px;border-radius:50%;background:#f59e0b;cursor:pointer;border:2px solid #333;flex-shrink:0" title="כתום"></div>' +
                            '<div id="fmt-color-circle" style="width:28px;height:28px;border-radius:50%;background:#dc2626;cursor:pointer;border:2px dashed #333;flex-shrink:0" title="לחיצה שמאלית = צבע טקסט | לחיצה ימנית = בחר צבע"></div>' +
                        '</div>' +
                        '<span style="width:2px;background:#000000;height:22px;display:inline-block;margin:0 4px"></span>' +
                        '<button type="button" class="fmt-btn" data-cmd="fontSize" data-val="6" title="הגדל גופן" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;font-weight:bold">A+</button>' +
                        '<button type="button" id="fmt-btn-font-normal" title="גופן רגיל" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer">A</button>' +
                        '<button type="button" class="fmt-btn" data-cmd="fontSize" data-val="2" title="הקטן גופן" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer;font-size:0.8em">A-</button>' +
                        '<span style="width:1px;background:#e5e7eb;height:22px;display:inline-block;margin:0 2px"></span>' +
                        '<button type="button" class="fmt-btn" data-cmd="justifyRight" title="יישר ימינה" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer">⇷</button>' +
                        '<button type="button" class="fmt-btn" data-cmd="justifyCenter" title="מרכז" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer">☰</button>' +
                        '<button type="button" class="fmt-btn" data-cmd="justifyLeft" title="יישר שמאלה" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;cursor:pointer">⇸</button>' +
                        '<span style="width:2px;background:#000000;height:22px;display:inline-block;margin:0 4px"></span>' +
                        '<button type="button" id="fmt-btn-fullscreen" title="מסך מלא" style="padding:4px 8px;border:1px solid #0d9488;border-radius:4px;background:#f0fdfa;cursor:pointer;font-size:1.1em;line-height:1;color:#0d9488">⛶</button>' +
                        '<button type="button" id="fmt-btn-diacritics" title="מקלדת ניקוד (QWES)" style="padding:4px 8px;border:1px solid #6366f1;border-radius:4px;background:#f5f3ff;cursor:pointer;font-size:1.1em;line-height:1;color:#6366f1">⌨️</button>' +
                    '</div>' +
                    '<div id="page-content-input" contenteditable="true" dir="rtl" style="width:100%;min-height:' + (isEdit ? '300px' : '100px') + ';padding:12px;border:2px solid #d1d5db;border-radius:8px;font-size:' + (isEdit ? '24px' : '1.1em') + ';font-family:PlonterFlippedDiacritics,Arial,serif;outline:none;overflow-y:auto;max-height:' + (isEdit ? '70vh' : '200px') + ';line-height:' + (isEdit ? '2' : '1.6') + ';resize:vertical" data-placeholder="הדבק או הקלד טקסט בערבית..."></div>' +
                '</div>' +
                (type === 'verb_analysis' ?
                    '<div style="margin-bottom:12px">' +
                        '<label style="display:block;margin-bottom:4px;font-weight:bold">רשימת פעלים (לחץ + להוספה, Enter לאישור, Ctrl+G להמרה)</label>' +
                        '<div id="page-verbs-bubble-mount"></div>' +
                    '</div>' : '') +
                '<div style="margin-bottom:16px">' +
                    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><label style="font-weight:bold">הערות מורה (אופציונלי)</label><button type="button" id="page-notes-eye" style="background:none;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;padding:2px 6px;font-size:0.9em" title="הצג/הסתר הערות במצגת">' + (isEdit && existingPage.notesHidden ? '🙈' : '👁️') + '</button></div>' +
                    '<input type="text" id="page-notes-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:0.95em" dir="rtl" placeholder="הערות לעצמך..." value="' + escapeAttr(isEdit ? existingPage.notes : '') + '">' +
                '</div>' +
                '<div id="page-dot-color-row" style="display:flex;align-items:center;gap:6px;margin-bottom:16px">' +
                    '<label style="flex-shrink:0;font-size:0.85em;color:#6b7280;font-weight:bold">צבע שקף:</label>' +
                '</div>' +
                '<div style="display:flex;gap:8px;justify-content:flex-start">' +
                    '<button id="page-dialog-confirm" class="btn btn-primary" style="font-size:1.1em;padding:10px 24px">' + (isEdit ? 'שמור' : 'הוסף') + '</button>' +
                    '<button id="page-dialog-cancel" class="btn btn-secondary" style="font-size:1.1em;padding:10px 24px">ביטול</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(modal);

        var contentInput = document.getElementById('page-content-input');
        var sentenceInput = document.getElementById('page-sentence-input');

        // Mount verb bubble editor if verb_analysis
        var _verbBubbleEditor = null;
        var verbsBubbleMount = document.getElementById('page-verbs-bubble-mount');
        if (verbsBubbleMount && type === 'verb_analysis') {
            _verbBubbleEditor = _createVerbBubbleEditor(isEdit && existingPage ? existingPage.verbs : '', null);
            verbsBubbleMount.appendChild(_verbBubbleEditor);
        }

        // Timeline events editor
        if (type === 'timeline') {
            var tlEventsList = document.getElementById('tl-events-list');
            var tlAddBtn = document.getElementById('tl-add-event');
            var _tlStartModalEl = document.getElementById('tl-start');
            var _tlEndModalEl = document.getElementById('tl-end');
            if (_tlStartModalEl) _attachTimelineDateInputUX(_tlStartModalEl, { withPicker: true, withFeedback: true });
            if (_tlEndModalEl) _attachTimelineDateInputUX(_tlEndModalEl, { withPicker: true, withFeedback: true });
            var _tlEvents = (isEdit && existingPage.events) ? JSON.parse(JSON.stringify(existingPage.events)) : [];
            function _renderTlEvents() {
                tlEventsList.innerHTML = '';
                _tlEvents.forEach(function(ev, i) {
                    var row = document.createElement('div');
                    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc';
                    row.innerHTML =
                        '<span style="font-weight:bold;color:#0369a1;min-width:20px">' + (i + 1) + '</span>' +
                        '<input type="text" class="tl-ev-time" data-idx="' + i + '" value="' + escapeAttr(ev.time || '') + '" placeholder="זמן" style="width:60px;padding:6px;border:1px solid #d1d5db;border-radius:6px;text-align:center;font-size:0.9em">' +
                        '<input type="text" class="tl-ev-title" data-idx="' + i + '" value="' + escapeAttr(ev.title || '') + '" placeholder="כותרת" style="flex:1;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em;direction:rtl">' +
                        '<input type="text" class="tl-ev-content" data-idx="' + i + '" value="' + escapeAttr(ev.content || '') + '" placeholder="תוכן" style="flex:2;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em;direction:rtl">' +
                        '<button type="button" class="tl-ev-del" data-idx="' + i + '" style="background:#ef4444;color:white;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:0.7em;flex-shrink:0">✕</button>';
                    tlEventsList.appendChild(row);
                });
                // Wire inputs + Enter navigation
                tlEventsList.querySelectorAll('.tl-ev-time,.tl-ev-title,.tl-ev-content').forEach(function(inp) {
                    inp.addEventListener('input', function() {
                        var idx = parseInt(inp.dataset.idx);
                        if (inp.classList.contains('tl-ev-time')) _tlEvents[idx].time = inp.value;
                        else if (inp.classList.contains('tl-ev-title')) _tlEvents[idx].title = inp.value;
                        else _tlEvents[idx].content = inp.value;
                    });
                    inp.addEventListener('keydown', function(e) {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        var idx = parseInt(inp.dataset.idx);
                        if (inp.classList.contains('tl-ev-time')) {
                            var next = tlEventsList.querySelector('.tl-ev-title[data-idx="' + idx + '"]');
                            if (next) next.focus();
                        } else if (inp.classList.contains('tl-ev-title')) {
                            var next = tlEventsList.querySelector('.tl-ev-content[data-idx="' + idx + '"]');
                            if (next) next.focus();
                        } else {
                            // Content → add new event + focus time
                            if (_tlEvents.length < 8) {
                                _tlEvents.push({ time: '', title: '', content: '' });
                                _renderTlEvents();
                                var newTime = tlEventsList.querySelector('.tl-ev-time[data-idx="' + (_tlEvents.length - 1) + '"]');
                                if (newTime) newTime.focus();
                            }
                        }
                    });
                });
                tlEventsList.querySelectorAll('.tl-ev-del').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var _delIdx = parseInt(btn.dataset.idx);
                        var _ev = _tlEvents[_delIdx];
                        // Bug #6 — confirm before deleting a timeline event that
                        // has content; an empty just-added row deletes silently.
                        var _hasContent = _ev && ((_ev.time && _ev.time.trim()) ||
                            (_ev.title && _ev.title.trim()) || (_ev.content && _ev.content.trim()));
                        if (_hasContent && !confirm('למחוק את האירוע הזה מציר הזמן?')) return;
                        _tlEvents.splice(_delIdx, 1);
                        _renderTlEvents();
                    });
                });
                tlEventsList.querySelectorAll('.tl-ev-time').forEach(function(inp) {
                    _attachTimelineDateInputUX(inp, {
                        withPicker: true,
                        withFeedback: false,
                        defaultGetter: function() { return _tlStartModalEl ? _tlStartModalEl.value : ''; }
                    });
                });
            }
            _renderTlEvents();
            tlAddBtn.addEventListener('click', function() {
                if (_tlEvents.length >= 8) return;
                _tlEvents.push({ time: '', title: '', content: '' });
                _renderTlEvents();
                // Focus new event's time field
                var newTime = tlEventsList.querySelector('.tl-ev-time[data-idx="' + (_tlEvents.length - 1) + '"]');
                if (newTime) newTime.focus();
            });
        }

        var _origDialogTitle = isEdit ? (existingPage.title || '') : '';
        var _origDialogNotes = isEdit ? (existingPage.notes || '') : '';
        var _dialogNotesHidden = isEdit ? !!existingPage.notesHidden : false;
        var eyeBtn = document.getElementById('page-notes-eye');
        if (eyeBtn) {
            eyeBtn.addEventListener('click', function() {
                _dialogNotesHidden = !_dialogNotesHidden;
                eyeBtn.textContent = _dialogNotesHidden ? '🙈' : '👁️';
                eyeBtn.title = _dialogNotesHidden ? 'ההערה מוסתרת במצגת' : 'ההערה גלויה במצגת';
            });
        }
        // Dot color selector
        var _dialogDotColor = isEdit ? (existingPage.dotColor || '') : '';
        var dotColorRow = document.getElementById('page-dot-color-row');
        if (dotColorRow) {
            var dotColors = ['', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899'];
            var dotLabels = ['ברירת מחדל', 'אדום', 'כחול', 'ירוק', 'כתום', 'סגול', 'ורוד'];
            dotColors.forEach(function(c, ci) {
                var dot = document.createElement('div');
                dot.style.cssText = 'width:24px;height:24px;border-radius:50%;cursor:pointer;border:2px solid ' + (_dialogDotColor === c ? '#333' : '#d1d5db') + ';background:' + (c || '#e5e7eb');
                dot.title = dotLabels[ci];
                dot.addEventListener('click', function() {
                    _dialogDotColor = c;
                    dotColorRow.querySelectorAll('div').forEach(function(d) { if (d.style.borderRadius === '50%') d.style.borderColor = '#d1d5db'; });
                    dot.style.borderColor = '#333';
                });
                dotColorRow.appendChild(dot);
            });
        }

        // Media mode toggle (video vs audio-only)
        var _dialogAudioOnly = false;
        var _origDialogSentence = sentenceInput ? sentenceInput.value : '';

        // Enter in sentence field → focus body text
        if (sentenceInput) {
            sentenceInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); contentInput.focus(); } });
        }

        // Media picker (warehouse search + browse + manual URL)
        var mediaUrlInput = document.getElementById('page-media-url-input');
        if (mediaUrlInput) {
            var previewDiv = document.getElementById('page-media-preview');
            var previewImg = document.getElementById('page-media-preview-img');
            var previewIframe = document.getElementById('page-media-preview-iframe');
            var selectedDiv = document.getElementById('page-media-selected');
            var selectedTitle = document.getElementById('page-media-selected-title');
            var clearBtn = document.getElementById('page-media-clear');
            var manualUrlInput = document.getElementById('page-media-url-manual');

            function _selectMediaItem(url, title) {
                mediaUrlInput.value = url;
                if (selectedTitle) selectedTitle.textContent = title || url;
                if (selectedDiv) selectedDiv.style.display = 'flex';
                _updateMediaPreview();
            }

            function _updateMediaPreview() {
                var url = mediaUrlInput.value.trim();
                if (!url) {
                    if (previewDiv) previewDiv.style.display = 'none';
                    if (previewImg) previewImg.style.display = 'none';
                    if (previewIframe) { previewIframe.style.display = 'none'; previewIframe.src = ''; }
                    return;
                }
                var embedUrl = _youtubeToEmbed(url);
                if (embedUrl) {
                    if (previewImg) previewImg.style.display = 'none';
                    if (previewIframe) { previewIframe.src = embedUrl; previewIframe.style.display = 'block'; }
                    if (previewDiv) previewDiv.style.display = 'block';
                } else {
                    if (previewIframe) { previewIframe.style.display = 'none'; previewIframe.src = ''; }
                    if (previewImg) {
                        previewImg.src = _absUrl(url);
                        previewImg.style.display = 'block';
                        previewImg.onerror = function() { previewImg.style.display = 'none'; };
                    }
                    if (previewDiv) previewDiv.style.display = 'block';
                }
            }

            // Clear selection
            if (clearBtn) {
                clearBtn.addEventListener('click', function() {
                    mediaUrlInput.value = '';
                    if (selectedDiv) selectedDiv.style.display = 'none';
                    _updateMediaPreview();
                });
            }

            // Manual URL input
            if (manualUrlInput) {
                manualUrlInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        var url = manualUrlInput.value.trim();
                        if (url) _selectMediaItem(url, url);
                    }
                });
                manualUrlInput.addEventListener('blur', function() {
                    var url = manualUrlInput.value.trim();
                    if (url) _selectMediaItem(url, url);
                });
            }

            // Media warehouse search
            var mediaSearchInput = document.getElementById('page-media-search');
            var mediaResults = document.getElementById('page-media-results');
            var mediaLessonFolder = document.getElementById('page-media-lesson-folder');
            var mediaBrowseFolders = document.getElementById('page-media-browse-folders');

            if (mediaSearchInput && mediaResults && typeof MediaStorage !== 'undefined') {
                var _mediaSearchTimer = null;
                mediaSearchInput.addEventListener('input', function() {
                    clearTimeout(_mediaSearchTimer);
                    var q = mediaSearchInput.value.trim();
                    if (q.length < 2) { mediaResults.innerHTML = ''; return; }
                    _mediaSearchTimer = setTimeout(function() {
                        MediaStorage.searchMainStorage(q).then(function(data) {
                            var items = data.items || [];
                            if (!items.length) {
                                mediaResults.innerHTML = '<div style="padding:8px;color:#9ca3af;font-size:0.85em">לא נמצא</div>';
                                return;
                            }
                            _renderPickerItems(mediaResults, items);
                        });
                    }, 300);
                });

                // Load lesson folder items
                if (mediaLessonFolder && lessonId) {
                    var editingLesson = loadLessons().find(function(l) { return l.id === lessonId; });
                    if (editingLesson) {
                        MediaStorage.getLessonFolderMedia(editingLesson.title).then(function(result) {
                            if (result.items.length > 0) {
                                mediaLessonFolder.innerHTML = '<div style="font-weight:bold;font-size:0.8em;color:#0d9488;margin-bottom:4px">📁 תיקיית שיעור</div>';
                                _renderPickerItems(mediaLessonFolder, result.items);
                            }
                        }).catch(function() {});
                    }
                }

                // Load root folders for browsing
                if (mediaBrowseFolders) {
                    MediaStorage.ensureSystemFolders().then(function() {
                        var rootFolders = MediaStorage.getChildFolders(null);
                        if (!rootFolders.length) return;
                        var html = '<div style="font-weight:bold;font-size:0.8em;color:#6b7280;margin-bottom:4px">📂 עלעל בתיקיות</div>';
                        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">';
                        rootFolders.forEach(function(f) {
                            var icon = f.name === 'יוטיוב' ? '▶️' : f.name === 'קטעי שמע' ? '🎵' : f.name === 'תמונות' ? '🖼️' : f.name === 'שיעורים' ? '📚' : '📁';
                            html += '<button class="page-media-folder-btn" data-folder-id="' + f.id + '" style="padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;background:white;cursor:pointer;font-size:0.8em">' + icon + ' ' + escapeHtml(f.name) + '</button>';
                        });
                        html += '</div>';
                        html += '<div id="page-media-folder-items"></div>';
                        mediaBrowseFolders.innerHTML = html;
                        mediaBrowseFolders.querySelectorAll('.page-media-folder-btn').forEach(function(btn) {
                            btn.addEventListener('click', function() {
                                var folderId = parseInt(btn.dataset.folderId);
                                mediaBrowseFolders.querySelectorAll('.page-media-folder-btn').forEach(function(b) { b.style.borderColor = '#e5e7eb'; b.style.background = 'white'; });
                                btn.style.borderColor = '#0d9488';
                                btn.style.background = '#f0fdfa';
                                var folderItems = document.getElementById('page-media-folder-items');
                                if (folderItems) {
                                    folderItems.innerHTML = '<div style="padding:6px;color:#6b7280;font-size:0.8em">טוען...</div>';
                                    MediaStorage.apiCall('list_media', { folder_id: folderId }).then(function(data) {
                                        var items = data.items || [];
                                        var subfolders = MediaStorage.getChildFolders(folderId);
                                        folderItems.innerHTML = '';
                                        // Show subfolders
                                        subfolders.forEach(function(sf) {
                                            var sfBtn = document.createElement('div');
                                            sfBtn.style.cssText = 'padding:4px 8px;border-radius:6px;cursor:pointer;background:#f9fafb;margin-bottom:2px;font-size:0.8em';
                                            sfBtn.textContent = '📁 ' + sf.name;
                                            sfBtn.addEventListener('click', function() {
                                                // Browse subfolder
                                                MediaStorage.apiCall('list_media', { folder_id: sf.id }).then(function(subData) {
                                                    _renderPickerItems(folderItems, subData.items || []);
                                                });
                                            });
                                            folderItems.appendChild(sfBtn);
                                        });
                                        if (items.length > 0) _renderPickerItems(folderItems, items, true);
                                        else if (subfolders.length === 0) folderItems.innerHTML = '<div style="padding:6px;color:#9ca3af;font-size:0.8em">ריק</div>';
                                    });
                                }
                            });
                        });
                    }).catch(function() {});
                }
            }

            function _renderPickerItems(container, items, append) {
                var wrapper = append ? container : container;
                if (!append) wrapper.innerHTML = '';
                items.forEach(function(item) {
                    var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                    var row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #f3f4f6;cursor:pointer;border-radius:4px';
                    row.innerHTML = '<span style="font-size:0.9em">' + icon + '</span>' +
                        '<span style="flex:1;font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(item.title) + '</span>' +
                        '<span style="font-size:0.7em;color:#6b7280">' + escapeHtml(item.folder_name || '') + '</span>';
                    row.addEventListener('click', function() {
                        _selectMediaItem(item.url, item.title);
                    });
                    row.addEventListener('mouseenter', function() { row.style.background = '#f0fdfa'; });
                    row.addEventListener('mouseleave', function() { row.style.background = ''; });
                    wrapper.appendChild(row);
                });
            }

            _updateMediaPreview(); // Show preview if editing existing media
        }

        // Set initial content for edit mode (body text for analyze/engineering, or full content for text)
        if (isEdit && existingPage.content) {
            if ((type === 'analyze' || type === 'engineering') && existingPage.sentence) {
                // Content is the optional body text
                contentInput.innerHTML = existingPage.bodyText || '';
            } else {
                contentInput.innerHTML = existingPage.content;
            }
        }
        // Capture normalized innerHTML AFTER setting it, so dirty check is accurate
        var _origDialogContent = contentInput.innerHTML;
        if (sentenceInput) sentenceInput.focus();
        else contentInput.focus();

        // Enter on title → sentence (if exists) or content
        var titleInput = document.getElementById('page-title-input');
        if (titleInput) {
            titleInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (sentenceInput) sentenceInput.focus();
                    else contentInput.focus();
                }
            });
        }

        function _dialogIsDirty() {
            var titleEl = document.getElementById('page-title-input');
            var notesEl = document.getElementById('page-notes-input');
            return contentInput.innerHTML !== _origDialogContent ||
                (titleEl && titleEl.value !== _origDialogTitle) ||
                (notesEl && notesEl.value !== _origDialogNotes);
        }

        // Placeholder behavior for contentEditable
        function _updatePlaceholder() {
            if (!contentInput.textContent.trim()) {
                contentInput.classList.add('empty');
            } else {
                contentInput.classList.remove('empty');
            }
        }
        contentInput.addEventListener('input', _updatePlaceholder);
        _updatePlaceholder();

        // Formatting toolbar buttons (bold/underline/removeFormat)
        var fmtBtns = modal.querySelectorAll('.fmt-btn');
        for (var fi = 0; fi < fmtBtns.length; fi++) {
            fmtBtns[fi].addEventListener('mousedown', function(e) { e.preventDefault(); });
            fmtBtns[fi].addEventListener('click', function(e) {
                var cmd = this.getAttribute('data-cmd');
                var val = this.getAttribute('data-val') || null;
                document.execCommand(cmd, false, val);
                if (cmd === 'removeFormat') {
                    document.execCommand('foreColor', false, '#000000');
                    window.getSelection() && window.getSelection().removeAllRanges();
                }
                contentInput.focus();
            });
        }

        // "A" normal font — removes font-size formatting
        var fontNormalBtn = document.getElementById('fmt-btn-font-normal');
        if (fontNormalBtn) {
            fontNormalBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            fontNormalBtn.addEventListener('click', function() {
                document.execCommand('fontSize', false, '7');
                var fonts = contentInput.querySelectorAll('font[size="7"]');
                fonts.forEach(function(f) {
                    while (f.firstChild) f.parentNode.insertBefore(f.firstChild, f);
                    f.parentNode.removeChild(f);
                });
                contentInput.focus();
            });
        }

        // Color circle — left click applies, right click opens picker
        var _dialogCurrentColor = '#dc2626';
        var dialogColorCircle = document.getElementById('fmt-color-circle');
        var dialogColorPicker = document.getElementById('fmt-color-picker');
        if (dialogColorCircle) {
            dialogColorCircle.addEventListener('mousedown', function(e) { e.preventDefault(); });
            dialogColorCircle.addEventListener('click', function() {
                document.execCommand('foreColor', false, _dialogCurrentColor);
                window.getSelection() && window.getSelection().removeAllRanges();
                contentInput.focus();
            });
            dialogColorCircle.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                if (dialogColorPicker) dialogColorPicker.click();
            });
        }
        if (dialogColorPicker) {
            dialogColorPicker.addEventListener('input', function() {
                _dialogCurrentColor = dialogColorPicker.value;
                if (dialogColorCircle) {
                    dialogColorCircle.style.background = _dialogCurrentColor;
                }
            });
        }

        // Classic color dots — click to apply color to text (custom circle keeps its own color)
        var fmtColorDots = modal.querySelectorAll('.fmt-color-dot');
        for (var ci = 0; ci < fmtColorDots.length; ci++) {
            fmtColorDots[ci].addEventListener('mousedown', function(e) { e.preventDefault(); });
            fmtColorDots[ci].addEventListener('click', function() {
                var color = this.getAttribute('data-fmt-color');
                document.execCommand('foreColor', false, color);
                window.getSelection() && window.getSelection().removeAllRanges();
                contentInput.focus();
            });
        }
        // Reset color dot — removes foreColor only
        var resetColorDot = document.getElementById('fmt-color-reset');
        if (resetColorDot) {
            resetColorDot.addEventListener('mousedown', function(e) { e.preventDefault(); });
            resetColorDot.addEventListener('click', function() {
                document.execCommand('foreColor', false, '#000000');
                window.getSelection() && window.getSelection().removeAllRanges();
                contentInput.focus();
            });
        }

        // Question-mark button in dialog toolbar
        var qmDialogBtn = modal.querySelector('.fmt-btn-qmark');
        if (qmDialogBtn) {
            qmDialogBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            qmDialogBtn.addEventListener('click', function() {
                _toggleQmarkMode(contentInput, qmDialogBtn);
            });
        }

        // Hebrew↔Arabic word toggle button in dialog
        var h2aDialogBtn = document.getElementById('fmt-btn-heb2ar');
        if (h2aDialogBtn) {
            h2aDialogBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            var _h2aDialogLongPress = null;
            h2aDialogBtn.addEventListener('pointerdown', function() {
                _h2aDialogLongPress = setTimeout(function() {
                    _h2aDialogLongPress = 'fired';
                    if (!contentInput._heb2arMode) _enterHeb2ArMode(contentInput, h2aDialogBtn);
                    _heb2arConvertAll(contentInput);
                }, 500);
            });
            h2aDialogBtn.addEventListener('pointerup', function() {
                if (_h2aDialogLongPress === 'fired') { _h2aDialogLongPress = null; return; }
                clearTimeout(_h2aDialogLongPress);
                _h2aDialogLongPress = null;
                _toggleHeb2ArMode(contentInput, h2aDialogBtn);
            });
            h2aDialogBtn.addEventListener('pointerleave', function() {
                if (_h2aDialogLongPress && _h2aDialogLongPress !== 'fired') {
                    clearTimeout(_h2aDialogLongPress);
                    _h2aDialogLongPress = null;
                }
            });
        }

        // Diacritics keyboard toggle in lesson editor toolbar
        var dkDialogBtn = document.getElementById('fmt-btn-diacritics');
        if (dkDialogBtn && typeof DiacriticsKeyboard !== 'undefined') {
            dkDialogBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            dkDialogBtn.addEventListener('click', function() {
                var active = DiacriticsKeyboard.toggle();
                dkDialogBtn.style.background = active ? '#6366f1' : '#f5f3ff';
                dkDialogBtn.style.color = active ? 'white' : '#6366f1';
                contentInput.focus();
            });
            // Sync button state when DK toggled via Ctrl+M
            document.addEventListener('dk-toggle', function(e) {
                dkDialogBtn.style.background = e.detail.active ? '#6366f1' : '#f5f3ff';
                dkDialogBtn.style.color = e.detail.active ? 'white' : '#6366f1';
            });
        }

        // Fullscreen toggle for content editor
        var fsBtn = document.getElementById('fmt-btn-fullscreen');
        if (fsBtn) {
            var _fsOverlay = null;
            var _fsOrigParentToolbar = null;
            var _fsOrigParentContent = null;
            var _fsOrigNextToolbar = null;
            var _fsOrigNextContent = null;
            var _fsOrigContentStyle = '';
            function _exitDialogFullscreen() {
                if (!_fsOverlay) return;
                var toolbar = document.getElementById('page-content-toolbar');
                toolbar.style.paddingLeft = ''; // undo the room reserved for the pinned ✕
                var exitBtnInToolbar = (_fsOverlay && _fsOverlay.querySelector('[data-fs-exit]')) || toolbar.querySelector('[data-fs-exit]');
                if (exitBtnInToolbar) exitBtnInToolbar.remove();
                // Restore toolbar and contentInput to their original parent.
                // Use appendChild in order (toolbar then content) instead of
                // insertBefore — the original nextSibling reference (contentInput)
                // is still in the overlay when toolbar is restored, which causes
                // insertBefore to throw NotFoundError and break subsequent exits.
                if (_fsOrigParentToolbar) {
                    _fsOrigParentToolbar.appendChild(toolbar);
                }
                if (_fsOrigParentContent) {
                    _fsOrigParentContent.appendChild(contentInput);
                }
                contentInput.style.cssText = _fsOrigContentStyle;
                contentInput.classList.remove('fs-no-scrollbar');
                if (_fsOverlay._escHandler) document.removeEventListener('keydown', _fsOverlay._escHandler);
                _fsOverlay.parentNode.removeChild(_fsOverlay);
                _fsOverlay = null;
                document.body.style.overflow = '';
                fsBtn.textContent = '⛶';
                fsBtn.title = 'מסך מלא';
                fsBtn.style.display = '';
            }
            fsBtn.addEventListener('click', function() {
                if (_fsOverlay) {
                    _exitDialogFullscreen();
                } else {
                    // Enter fullscreen
                    var toolbar = document.getElementById('page-content-toolbar');
                    _fsOrigParentToolbar = toolbar.parentNode;
                    _fsOrigNextToolbar = toolbar.nextSibling;
                    _fsOrigParentContent = contentInput.parentNode;
                    _fsOrigNextContent = contentInput.nextSibling;
                    _fsOrigContentStyle = contentInput.style.cssText;

                    _fsOverlay = document.createElement('div');
                    _fsOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white;display:flex;flex-direction:column;padding:8px';

                    // Blue ✕ exit button — PINNED to the EXTREME TOP-LEFT corner of the
                    // fullscreen overlay (Amitai bd1 #1468), NOT in the toolbar row. Fixed to
                    // the viewport corner with a small safe inset + high z-index; the toolbar
                    // gets left padding so its leftmost control never hides behind it.
                    var fsExitBtn = document.createElement('button');
                    fsExitBtn.textContent = '✕';
                    fsExitBtn.setAttribute('data-fs-exit', 'true');
                    fsExitBtn.style.cssText = 'position:fixed;top:6px;left:6px;z-index:10001;background:#0891b2;color:white;border:none;width:32px;height:32px;border-radius:8px;font-weight:bold;font-size:1.05em;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.25)';
                    fsExitBtn.addEventListener('click', function(e) { e.stopPropagation(); _exitDialogFullscreen(); });

                    _fsOverlay.appendChild(toolbar);
                    _fsOverlay.appendChild(contentInput);
                    _fsOverlay.appendChild(fsExitBtn);
                    toolbar.style.paddingLeft = '46px'; // reserve room so toolbar items clear the pinned ✕
                    contentInput.style.cssText = 'width:100%;flex:1;padding:16px;border:2px solid #d1d5db;border-radius:8px;font-size:28px;font-family:PlonterFlippedDiacritics,Arial,serif;outline:none;overflow-y:auto;line-height:2;direction:rtl;resize:none;scrollbar-width:none;-ms-overflow-style:none';
                    // Hide WebKit scrollbar in fullscreen
                    if (!document.getElementById('fs-scrollbar-hide')) {
                        var fsStyleEl = document.createElement('style');
                        fsStyleEl.id = 'fs-scrollbar-hide';
                        fsStyleEl.textContent = '.fs-no-scrollbar::-webkit-scrollbar{display:none}';
                        document.head.appendChild(fsStyleEl);
                    }
                    contentInput.classList.add('fs-no-scrollbar');

                    document.body.appendChild(_fsOverlay);
                    document.body.style.overflow = 'hidden';
                    contentInput.focus();
                    fsBtn.style.display = 'none';

                    // Escape key exits fullscreen
                    _fsOverlay._escHandler = function(e) {
                        if (e.key === 'Escape' && _fsOverlay) {
                            e.preventDefault();
                            _exitDialogFullscreen();
                        }
                    };
                    document.addEventListener('keydown', _fsOverlay._escHandler);
                }
            });
        }

        // Ctrl+Z custom undo for qmark/heb2ar, Ctrl+G for Hebrew→Arabic (all dialog fields)
        contentInput.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
                if (contentInput._customUndoStack && contentInput._customUndoStack.length > 0) {
                    e.preventDefault();
                    _popEditorUndo(contentInput);
                }
                // Otherwise let browser handle native Ctrl+Z
            }
        });
        // Ctrl+G on entire dialog — covers title, sentence, notes, content
        modal.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                if (typeof DetailsPanel === 'undefined' || !DetailsPanel._convertHebrewToArabic) return;
                var active = document.activeElement;
                // Contenteditable (body text)
                if (active === contentInput) {
                    var sel = window.getSelection();
                    if (sel && !sel.isCollapsed && contentInput.contains(sel.anchorNode)) {
                        var selectedText = sel.toString();
                        var converted = DetailsPanel._convertHebrewToArabic(selectedText);
                        document.execCommand('insertText', false, converted);
                    }
                    return;
                }
                // Regular input/textarea fields (title, sentence, notes)
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && modal.contains(active)) {
                    var start = active.selectionStart, end = active.selectionEnd;
                    if (start !== end) {
                        var val = active.value;
                        var selected = val.substring(start, end);
                        active.value = val.substring(0, start) + DetailsPanel._convertHebrewToArabic(selected) + val.substring(end);
                        active.selectionStart = start;
                        active.selectionEnd = start + DetailsPanel._convertHebrewToArabic(selected).length;
                    } else {
                        // No selection — convert entire value
                        active.value = DetailsPanel._convertHebrewToArabic(active.value);
                    }
                }
            }
        });

        function _doSaveAndClose() {
            // Exit fullscreen first so elements are back in the modal for reading
            if (typeof _exitDialogFullscreen === 'function' && _fsOverlay) _exitDialogFullscreen();
            var sentenceEl = document.getElementById('page-sentence-input');
            var hasSentenceField = !!(sentenceEl && (type === 'analyze' || type === 'engineering'));
            var content = hasSentenceField ? sentenceEl.value.trim() : contentInput.innerHTML.trim();
            if (hasSentenceField && !content) {
                sentenceEl.style.borderColor = '#ef4444';
                return false;
            }
            // Verb analysis: require verbs list
            var _verbsValue = _verbBubbleEditor ? _verbBubbleEditor.getValue() : '';
            if (type === 'verb_analysis' && !_verbsValue.trim()) {
                if (_verbBubbleEditor) _verbBubbleEditor.style.borderColor = '#ef4444';
                return false;
            }
            if (!hasSentenceField && type !== 'image' && type !== 'video' && type !== 'verb_analysis' && type !== 'timeline' && !contentInput.textContent.trim()) {
                contentInput.style.borderColor = '#ef4444';
                return false;
            }
            // Media type: require URL
            var mediaUrlEl = document.getElementById('page-media-url-input');
            if ((type === 'image' || type === 'video') && mediaUrlEl && !mediaUrlEl.value.trim()) {
                var picker = document.getElementById('page-media-picker');
                if (picker) picker.style.borderColor = '#ef4444';
                return false;
            }
            var title = document.getElementById('page-title-input').value.trim();
            var notes = document.getElementById('page-notes-input').value.trim();
            var pageData = { type: type, content: content || (type === 'image' || type === 'video' ? '' : content), title: title, notes: notes, notesHidden: _dialogNotesHidden, audioOnly: _dialogAudioOnly, dotColor: _dialogDotColor };
            if ((type === 'image' || type === 'video') && mediaUrlEl) {
                var mediaUrl = mediaUrlEl.value.trim();
                // Auto-detect: YouTube or video extension → videoUrl, otherwise → imageUrl
                if (_youtubeToEmbed(mediaUrl) || /\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl)) {
                    pageData.videoUrl = mediaUrl;
                    pageData.imageUrl = '';
                } else {
                    pageData.imageUrl = mediaUrl;
                    pageData.videoUrl = '';
                }
                // Use contentEditable as body text
                pageData.content = contentInput.innerHTML.trim();
            }
            if (hasSentenceField) {
                pageData.sentence = content;
                pageData.bodyText = contentInput.innerHTML.trim();
            }
            if (type === 'verb_analysis' && _verbBubbleEditor) {
                pageData.verbs = _verbBubbleEditor.getValue();
                pageData.content = contentInput.innerHTML.trim();
            }
            if (type === 'timeline') {
                var tlStartEl = document.getElementById('tl-start');
                var tlEndEl = document.getElementById('tl-end');
                pageData.tlStart = tlStartEl ? tlStartEl.value.trim() : '';
                pageData.tlEnd = tlEndEl ? tlEndEl.value.trim() : '';
                pageData.events = _tlEvents || [];
                pageData.content = contentInput.innerHTML.trim();
                var tlInteractiveCb = document.getElementById('tl-interactive-cb');
                pageData.interactive = tlInteractiveCb ? tlInteractiveCb.checked : false;
            }
            if (isEdit) {
                updatePage(lessonId, existingPage.id, pageData);
            } else {
                addPage(lessonId, pageData);
            }
            modal.remove();
            renderEditor(getLesson(lessonId));
            return true;
        }

        // Cancel/X: ask "cancel or continue working?"
        function _onCancelOrX() {
            if (typeof _exitDialogFullscreen === 'function' && _fsOverlay) _exitDialogFullscreen();
            if (!_dialogIsDirty()) { modal.remove(); return; }
            _showTwoChoiceDialog('📝', 'רוצה לשמור את השינויים?', 'השינויים שלך עדיין לא נשמרו',
                '✏️ המשך לעבוד', '#0d9488', function() { /* do nothing, stay */ },
                '🗑️ מחק את השינויים', '#ef4444', function() { modal.remove(); }
            );
        }
        // Click outside: ask "cancel or save?"
        function _onBackdropClick() {
            if (typeof _exitDialogFullscreen === 'function' && _fsOverlay) _exitDialogFullscreen();
            if (!_dialogIsDirty()) { modal.remove(); return; }
            _showTwoChoiceDialog('📝', 'רוצה לשמור את השינויים?', 'השינויים שלך עדיין לא נשמרו',
                '💾 שמור', '#3b82f6', function() { _doSaveAndClose(); },
                '🗑️ מחק את השינויים', '#ef4444', function() { modal.remove(); }
            );
        }

        document.getElementById('page-dialog-confirm').addEventListener('click', _doSaveAndClose);
        document.getElementById('page-dialog-cancel').addEventListener('click', _onCancelOrX);
        modal.querySelector('.close').addEventListener('click', _onCancelOrX);
        // Outside click does NOT close — only cancel/save/X buttons close
    }

    // --- UI: Lesson Viewer (Fatwa-style Presentation) ---

    var _viewerState = null;
    var _presenterCtx = null; // drawing/highlight/diacritics state
    // UX (Amitai 2026-06-05) — true once the user does something resumable this
    // presentation session (advances, marks, draws, guesses, edits, resets).
    // Gates _saveLessonRuntimeState so a no-activity visit writes no resume state.
    var _lessonActivity = false;

    function _hasSavedLessonState(lessonId) {
        if (!lessonId) return false;
        try {
            var raw = localStorage.getItem('plonter_lesson_state_' + lessonId);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && Object.keys(parsed).filter(function(k) { return k !== '_version'; }).length > 0) return true;
            }
            var legacy = localStorage.getItem('plonter_qmark_' + lessonId);
            if (legacy) {
                var lp = JSON.parse(legacy);
                if (lp && typeof lp === 'object' && Object.keys(lp).length > 0) return true;
            }
        } catch (e) {}
        return false;
    }

    function _clearLessonRuntimeState(lessonId) {
        if (!lessonId) return;
        try { localStorage.removeItem('plonter_lesson_state_' + lessonId); } catch (e) {}
        try { localStorage.removeItem('plonter_qmark_' + lessonId); } catch (e) {}
    }

    function _promptResumeOrFresh(callback) {
        var overlay = document.createElement('div');
        overlay.className = 'lesson-resume-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;direction:rtl;font-family:inherit';
        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:12px;padding:20px 22px;max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,0.25);text-align:center';
        box.innerHTML =
            '<h3 style="margin:0 0 10px;color:#0f766e;font-size:1.1em">המשך מהמקום שעצרת?</h3>' +
            '<p style="margin:0 0 16px;color:#475569;font-size:.9em;line-height:1.4"><strong style="display:block;color:#0f766e;margin-bottom:4px">בדיוק היינו באמצע המצגת..</strong>השיעור נשמר עם התשובות, הסימונים והציורים מהפעם הקודמת.</p>' +
            '<div style="display:flex;gap:8px;justify-content:center">' +
                '<button type="button" data-resume="1" style="background:#0d9488;color:white;border:none;border-radius:8px;padding:8px 16px;font-size:.95em;cursor:pointer;font-weight:600;font-family:inherit">המשך</button>' +
                '<button type="button" data-resume="0" style="background:white;color:#0f766e;border:1px solid #0d9488;border-radius:8px;padding:8px 16px;font-size:.95em;cursor:pointer;font-weight:600;font-family:inherit">התחל מחדש</button>' +
            '</div>';
        overlay.appendChild(box);
        function cleanup(resume) {
            try { overlay.remove(); } catch (e) {}
            try { callback(!!resume); } catch (e) { console.warn('[lessons] resume prompt', e); }
        }
        box.querySelectorAll('button[data-resume]').forEach(function(btn) {
            btn.addEventListener('click', function() { cleanup(btn.getAttribute('data-resume') === '1'); });
        });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) cleanup(true); });
        document.body.appendChild(overlay);
    }

    function startLessonViewer(lessonId) {
        var lesson = getLesson(lessonId);
        if (!lesson || lesson.pages.length === 0) {
            MessageManager.show('אין דפים בשיעור', 'error');
            return;
        }

        if (_hasSavedLessonState(lessonId)) {
            _promptResumeOrFresh(function(resume) {
                if (!resume) _clearLessonRuntimeState(lessonId);
                _startLessonViewerImpl(lessonId, lesson);
            });
            return;
        }
        _startLessonViewerImpl(lessonId, lesson);
    }

    function _startLessonViewerImpl(lessonId, lesson) {
        // Update last-used timestamp
        var lessons = loadLessons();
        var idx = lessons.findIndex(function(l) { return l.id === lessonId; });
        if (idx >= 0) { lessons[idx].updated = new Date().toISOString(); saveLessons(lessons); }

        _viewerState = { lessonId: lessonId, currentPage: 0 };
        _lessonActivity = false;
        // Set VocabBar lesson context and clear previous items
        if (typeof VocabBar !== 'undefined') {
            VocabBar._currentLessonTitle = lesson.title;
            VocabBar._items = [];
        }
        // Restore per-lesson runtime state after presenter context exists
        // and before the first slide render.
        _qmarkGuessCache = {};
        _verbAnalysisCache = {};
        _interactiveTimelineCache = {};
        _translateDebounce = 0;
        _presenterCtx = {
            currentTool: null,
            highlightColor: 'yellow',
            drawColor: '#dc2626',
            isEraser: false,
            drawing: false,
            slideStrokes: {},   // pageIdx → [stroke, ...]
            slideHighlights: {}, // pageIdx → [{range, color}]
            currentStroke: null,
            undoStack: [],
            redoStack: [],
            diacriticsActive: false,
            dictOpen: false
        };
        _restoreLessonRuntimeState(lessonId);

        // Hide everything
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'none';
        var editor = document.getElementById('lesson-editor');
        if (editor) editor.style.display = 'none';

        // Remove old viewer if exists
        var oldViewer = document.getElementById('lesson-viewer');
        if (oldViewer) oldViewer.remove();

        // Create full-screen presenter
        var presenter = document.createElement('div');
        presenter.id = 'lesson-viewer';
        presenter.className = 'lesson-presenter';
        document.body.appendChild(presenter);

        _buildPresenter(presenter, lesson);

        // Auto-open floating audio player if lesson has audioUrl
        if (lesson.audioUrl && typeof MediaStorage !== 'undefined' && MediaStorage.playMedia) {
            setTimeout(function() {
                MediaStorage.playMedia({ url: lesson.audioUrl, title: lesson.audioTitle || lesson.title, media_type: 'audio' });
            }, 500);
        }

        // Keyboard navigation
        document.addEventListener('keydown', _viewerKeyHandler);

        // מקלדת פונטיקה — number keys control the floating lesson audio player in presenter mode.
        // Routing: (1) niqqud keyboard open -> bail (DK owns the digits); (2) audio player open + DK
        // closed -> digits control the audio EVEN inside INPUT/TEXTAREA and the digit is suppressed;
        // (3) no audio player -> let the digit type normally.
        if (window._lpAudioKbd) document.removeEventListener('keydown', window._lpAudioKbd);
        window._lpAudioKbd = function(e) {
            if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard.isActive()) return;
            var fp = document.getElementById('media-floating-player');
            var audio = (fp && fp.style.display !== 'none' ? fp.querySelector('audio') : null) ||
                        document.getElementById('media-audio-el');
            if (!audio) return; // no live audio player — digit types normally
            var seekMap = {'9': 10, '7': -10, '6': 3, '4': -3, '5': -0.8};
            var speedMap = {'3': 0.1, '1': -0.1};
            var volMap = {'8': 0.1, '2': -0.1};
            if (seekMap[e.key] !== undefined) {
                e.preventDefault();
                var dur = isFinite(audio.duration) ? audio.duration : 1e9;
                audio.currentTime = Math.max(0, Math.min(dur, audio.currentTime + seekMap[e.key]));
            } else if (speedMap[e.key] !== undefined) {
                e.preventDefault();
                audio.playbackRate = Math.max(0.25, Math.min(4, (audio.playbackRate || 1) + speedMap[e.key]));
            } else if (volMap[e.key] !== undefined) {
                e.preventDefault();
                audio.volume = Math.max(0, Math.min(1, (audio.volume === undefined ? 1 : audio.volume) + volMap[e.key]));
            } else if (e.key === '0') {
                e.preventDefault();
                if (audio.paused) audio.play(); else audio.pause();
            }
        };
        document.addEventListener('keydown', window._lpAudioKbd);
    }

    function _buildPresenter(presenter, lesson) {
        var page = lesson.pages[_viewerState.currentPage];
        var pageNum = _viewerState.currentPage + 1;
        var totalPages = lesson.pages.length;
        var progress = (pageNum / totalPages * 100).toFixed(1);
        var isReadOnlySource = _isReadOnlyLessonSource(lesson);
        var editButtonText = isReadOnlySource ? '📋 שכפל לעריכה' : '✏️ ערוך';

        presenter.innerHTML =
            // Header: buttons LEFT, title CENTER, slide counter RIGHT
            '<div class="lp-header" style="position:relative">' +
                '<div class="lp-slide-counter" style="z-index:1">שקף <span id="lp-current">' + pageNum + '</span> / <span id="lp-total">' + totalPages + '</span></div>' +
                '<h1 style="position:absolute;left:0;right:0;text-align:center;pointer-events:none;margin:0">' + escapeHtml(lesson.title) + '</h1>' +
                '<div style="display:flex;gap:8px;align-items:center;z-index:1">' +
                    '<button class="lp-exit-btn" id="lp-edit-lesson">' + editButtonText + '</button>' +
                    '<button class="lp-exit-btn" id="lp-exit">← דף הבית</button>' +
                '</div>' +
            '</div>' +
            '<div class="lp-progress"><div class="lp-progress-fill" id="lp-progress" style="width:' + progress + '%"></div></div>' +

            // Body: toolbar + slide area
            '<div class="lp-body">' +
                // Right toolbar
                '<div class="lp-toolbar">' +
                    '<button class="lp-tool-btn active" data-lp-tool="pointer" title="סמן">🖱️<span class="lp-tool-label">סמן</span></button>' +
                    '<div class="lp-tool-divider"></div>' +
                    '<button class="lp-tool-btn" data-lp-tool="draw" title="צייר">✏️<span class="lp-tool-label">צייר</span></button>' +
                    '<div class="lp-palette" id="lp-draw-palette">' +
                        '<div class="lp-color-dot selected" data-lp-draw="#dc2626" style="background:#dc2626"></div>' +
                        '<div class="lp-color-dot" data-lp-draw="#2563eb" style="background:#2563eb"></div>' +
                        '<div class="lp-color-dot" data-lp-draw="#16a34a" style="background:#16a34a"></div>' +
                        '<div class="lp-color-dot" data-lp-draw="#000000" style="background:#000000"></div>' +
                        '<div class="lp-color-dot" data-lp-draw="eraser" style="background:#fff;border:2px solid #cbd5e1;font-size:12px;display:flex;align-items:center;justify-content:center" title="מחק">🧹</div>' +
                    '</div>' +
                    '<button class="lp-tool-btn" data-lp-tool="highlight" title="סמן טקסט">🖍️<span class="lp-tool-label">סמן טקסט</span></button>' +
                    '<div class="lp-palette" id="lp-hl-palette">' +
                        '<div class="lp-color-dot selected" data-lp-hl="yellow" style="background:#ffeb3b"></div>' +
                        '<div class="lp-color-dot" data-lp-hl="green" style="background:#4caf50"></div>' +
                        '<div class="lp-color-dot" data-lp-hl="blue" style="background:#42a5f5"></div>' +
                        '<div class="lp-color-dot" data-lp-hl="pink" style="background:#ec407a"></div>' +
                        '<div class="lp-color-dot" data-lp-hl="orange" style="background:#ff9800"></div>' +
                        '<div class="lp-color-dot" data-lp-hl="clear" style="background:#fff;border:2px dashed #cbd5e1;font-size:12px;display:flex;align-items:center;justify-content:center;color:#94a3b8" title="מחק">✕</div>' +
                    '</div>' +
                    '<button class="lp-tool-btn" data-lp-tool="diacritics" title="חושף ניקוד (לחיצה ארוכה = חשוף/הסתר הכל)">🕯️<span class="lp-tool-label">חושף ניקוד</span></button>' +
                    '<button class="lp-tool-btn" id="lp-dk-toggle" title="מקלדת ניקוד (QWES)">⌨️<span class="lp-tool-label">מקלדת</span></button>' +
                    '<button class="lp-tool-btn" data-lp-tool="translate" title="תרגום — לחץ על מילה לחיפוש במילון">🔍<span class="lp-tool-label">תרגום</span></button>' +
                    '<div class="lp-tool-divider"></div>' +
                    '<button class="lp-tool-btn" data-lp-tool="analyze" title="לכוד משפט לניתוח">🧩<span class="lp-tool-label">נתח</span></button>' +
                    '<button class="lp-tool-btn" data-lp-tool="hindus" title="לכוד משפט להינדוס">🏗️<span class="lp-tool-label">הנדס</span></button>' +
                    '<div class="lp-tool-divider"></div>' +
                    '<button class="lp-tool-btn" data-lp-tool="undo" title="Ctrl+Z" style="font-size:1em">↩<span class="lp-tool-label">בטל</span></button>' +
                    '<button class="lp-tool-btn" data-lp-tool="redo" title="Ctrl+Y" style="font-size:1em">↪<span class="lp-tool-label">שחזר</span></button>' +
                    '<div class="lp-tool-divider"></div>' +
                    '<button class="lp-tool-btn" id="lp-reset-btn" title="אפס שינויים בשקף" style="font-size:0.85em;color:#ef4444">🗑️<span class="lp-tool-label">אפס</span></button>' +
                '</div>' +

                // Slide area
                '<div class="lp-slide-area">' +
                    '<div class="lp-viewport" id="lp-viewport">' +
                        '<canvas class="lp-draw-canvas" id="lp-canvas"></canvas>' +
                        '<div class="lp-slide" id="lp-slide-content"></div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            // Vocab bar (hidden by default)
            '<div id="lp-vocab-bar" style="display:none;padding:6px 12px;background:#f0fdf4;border-top:2px solid #0d9488;max-height:120px;overflow-y:auto;direction:rtl">' +
                '<div id="lp-vocab-items" style="display:flex;flex-wrap:wrap;gap:6px"></div>' +
            '</div>' +

            // Navigation
            '<div class="lp-nav" style="direction:rtl;position:relative">' +
                '<div style="position:absolute;right:10px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:8px">' +
                    '<span id="lp-clock" style="color:#6b7280;font-size:0.85em;font-family:monospace;direction:ltr"></span>' +
                    '<button id="lp-vocab-toggle" style="background:none;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.9em" title="אוצר מילים">📌</button>' +
                '</div>' +
                '<button class="lp-nav-btn" id="lp-prev" ' + (pageNum <= 1 ? 'disabled' : '') + '>→ הקודם</button>' +
                '<div class="lp-dots" id="lp-dots"></div>' +
                '<button class="lp-nav-btn" id="lp-next" ' + (pageNum >= totalPages ? 'disabled' : '') + '>הבא ←</button>' +
            '</div>' +

            // Dictionary panel (hidden)
            '<div class="lp-dict-panel" id="lp-dict-panel">' +
                '<div id="lp-dict-tabs" style="display:flex;gap:0;margin:6px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">' +
                    '<button class="lp-dict-tab" data-engine="milson" style="flex:1;padding:5px 8px;border:none;cursor:pointer;font-size:0.8em;font-weight:bold;background:#0d9488;color:white">מילסון</button>' +
                    '<button class="lp-dict-tab" data-engine="spoken" style="flex:1;padding:5px 8px;border:none;cursor:pointer;font-size:0.8em;font-weight:bold;background:#f8fafc;color:#64748b">מדוברת</button>' +
                    '<button class="lp-dict-tab" data-engine="ai" style="flex:1;padding:5px 8px;border:none;cursor:pointer;font-size:0.8em;font-weight:bold;background:#f8fafc;color:#64748b">AI</button>' +
                    '<button class="lp-dict-tab lp-dict-tab-media" data-engine="media" style="flex:1;padding:5px 8px;border:none;cursor:pointer;font-size:0.8em;font-weight:bold;background:#f8fafc;color:#64748b;display:none">מדיה</button>' +
                '</div>' +
                '<div class="lp-dict-header">' +
                    '<input type="text" class="lp-dict-input" id="lp-dict-input" placeholder="🔍 חפש מילה...">' +
                    '<button class="lp-dict-search-btn" id="lp-dict-heb2ar" title="המר עברית לערבית (Ctrl+G)">א→ע</button>' +
                    '<button class="lp-dict-search-btn" id="lp-dict-search">🔍</button>' +
                '</div>' +
                '<div class="lp-dict-results" id="lp-dict-results"><div style="text-align:center;color:#9ca3af;padding:24px">הקלד מילה בערבית וחפש</div></div>' +
            '</div>' +
            '<button class="lp-dict-toggle" id="lp-dict-toggle" style="display:none">📖</button>';

        // Render page content
        _renderSlideContent(page);

        // Pre-wrap words for highlight/click support on first render
        var slideContent = document.getElementById('lp-slide-content');
        if (slideContent) {
            slideContent.querySelectorAll('.lp-arabic').forEach(function(el) {
                _wrapWordsForDiacritics(el);
            });
        }

        // Build dots
        _renderDots(lesson);

        // Wire events
        _wirePresenterEvents(presenter, lesson);

        // Set global media library for dictionary panel
        if (typeof Dictionary !== 'undefined') {
            Dictionary.setMediaLibrary(lesson);
        }

        // Show media tab when MediaStorage is available
        if (typeof MediaStorage !== 'undefined') {
            var mediaTabBtn = presenter.querySelector('.lp-dict-tab-media');
            if (mediaTabBtn) mediaTabBtn.style.display = '';
        }

        // Init canvas
        _initCanvas();
    }

    // Soft loading indicator for presenter media (Amitai bd1 #1472): warehouse
    // image/video has first-load latency. Show a spinner over the media area until it
    // is actually ready (img 'load' / video 'loadeddata'|'canplay'), then reveal it.
    // On error show a soft fallback (never a hung spinner, never false success). A
    // timeout fallback guarantees the spinner is removed. _absUrl handling is applied
    // at string-build time and left intact.
    function _lpWireMediaLoading(scope) {
        if (!scope) return;
        if (!document.getElementById('lp-mload-style')) {
            var st = document.createElement('style');
            st.id = 'lp-mload-style';
            st.textContent = '@keyframes lp-mload-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(st);
        }
        var wraps = scope.querySelectorAll('[data-lp-media-wrap]');
        Array.prototype.forEach.call(wraps, function(wrap) {
            var spinner = wrap.querySelector('[data-lp-media-spinner]');
            var el = wrap.querySelector('img[data-lp-media], video[data-lp-media]');
            if (!el) return;
            var done = false, _t = null;
            function reveal() {
                if (done) return; done = true;
                if (_t) { clearTimeout(_t); _t = null; }
                if (spinner) spinner.style.display = 'none';
                el.style.opacity = '1';
            }
            function fail() {
                if (done) return; done = true;
                if (_t) { clearTimeout(_t); _t = null; }
                el.style.display = 'none';
                if (spinner) {
                    spinner.style.background = '#fef2f2';
                    spinner.style.color = '#dc2626';
                    spinner.innerHTML = '<div style="font-size:1.6em">⚠️</div><div style="font-size:0.8em">לא ניתן לטעון את המדיה</div>';
                    spinner.style.display = 'flex';
                }
            }
            _t = setTimeout(reveal, 10000); // never hang the spinner
            if (el.tagName === 'VIDEO') {
                el.addEventListener('loadeddata', reveal);
                el.addEventListener('canplay', reveal);
                el.addEventListener('error', fail);
                if (el.readyState >= 2) reveal();
            } else {
                el.addEventListener('load', reveal);
                el.addEventListener('error', fail);
                if (el.complete) { if (el.naturalWidth > 0) reveal(); else fail(); }
            }
        });
    }

    function _renderSlideContent(page) {
        var container = document.getElementById('lp-slide-content');
        if (!container) return;

        var content = page.content || '';
        var title = page.title ? '<div class="lp-arabic lp-title-text">' + escapeHtml(_stripDiacritics(page.title)) + '</div>' : '';
        var notes = '';
        if (page.notes) {
            if (page.notesHidden) {
                notes = '<div id="lp-hidden-note" style="margin-top:16px;padding:12px;background:#e0e7ff;border-radius:8px;border:1px dashed #6366f1;color:#4338ca;font-size:0.9em;text-align:center;cursor:pointer" data-note-text="' + escapeAttr(page.notes) + '">❓ <span style="font-size:0.85em;color:#6366f1">לחץ לחשוף הערה</span></div>';
            } else {
                notes = '<div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;border:1px solid #fbbf24;color:#92400e;font-size:0.9em"><strong>הערות:</strong> ' + escapeHtml(page.notes) + '</div>';
            }
        }

        // Reset and build diacritics map from original content + title + bodyText, display stripped version
        for (var k in _diacriticsMap) delete _diacriticsMap[k];
        _buildDiacriticsMap(content);
        if (page.title) _buildDiacriticsMap(page.title);
        if (page.bodyText) _buildDiacriticsMap(page.bodyText);
        var displayContent = _stripDiacritics(content);

        if (page.type === 'text') {
            // Support rich text (HTML) content — if content has HTML tags, render as-is; otherwise escape
            var isRichText = /<[a-z][\s\S]*>/i.test(content);
            // Process qmark BEFORE stripping diacritics — so qmark words preserve their diacritics for toggle
            var rawHtml = isRichText ? content : escapeHtml(content);
            var qmarkResult = _processQmarkForViewer(rawHtml);
            // Now strip diacritics from the remaining (non-qmark) HTML
            var textHtml = _stripDiacritics(qmarkResult.html);
            _currentQmarkData = qmarkResult.data;
            textHtml = qmarkResult.html;

            container.innerHTML = title +
                '<div class="lp-arabic" style="text-align:right">' + textHtml + '</div>' + notes;

            // Wire qmark placeholder click handlers
            if (_currentQmarkData.length > 0) {
                _wireQmarkPlaceholders(_currentQmarkData);
                _restoreQmarkGuesses();
            }

        } else if (page.type === 'analyze') {
            var bodyTextHtml = page.bodyText ? '<div class="lp-arabic" style="margin-bottom:16px;font-size:0.95em">' + _stripDiacritics(page.bodyText) + '</div>' : '';
            container.innerHTML = title +
                '<div class="lp-arabic" style="text-align:center;margin-bottom:16px">' + escapeHtml(displayContent) + '</div>' +
                bodyTextHtml +
                '<div style="text-align:center"><button id="lp-analyze-btn" style="background:linear-gradient(135deg,#0d9488,#0891b2);color:white;border:none;padding:10px 24px;border-radius:10px;font-size:1.1em;font-weight:bold;cursor:pointer;font-family:inherit">🧩 נתח את המשפט</button></div>' + notes;
            var analyzeBtn = document.getElementById('lp-analyze-btn');
            if (analyzeBtn) {
                analyzeBtn.addEventListener('click', function() {
                    _showAnalyzeConfirm(displayContent);
                });
            }

        } else if (page.type === 'diacritics') {
            var stripped = typeof stripArabicDiacritics === 'function' ? stripArabicDiacritics(content) : content;
            container.innerHTML = title +
                '<div class="lp-arabic" style="text-align:right">' + escapeHtml(stripped) + '</div>' +
                '<div style="text-align:center;margin-top:12px"><button id="lp-diac-btn" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:white;border:none;padding:10px 24px;border-radius:10px;font-size:1.1em;font-weight:bold;cursor:pointer;font-family:inherit">🖌️ חשוף ניקוד</button></div>' + notes;
            var diacBtn = document.getElementById('lp-diac-btn');
            if (diacBtn) {
                diacBtn.addEventListener('click', function() { _loadPageIntoApp(page, 'diacritics'); });
            }

        } else if (page.type === 'engineering') {
            // Engineering = load sentence directly into Plonter analysis
            var engBodyHtml = page.bodyText ? '<div class="lp-arabic" style="margin-bottom:16px;font-size:0.95em">' + _stripDiacritics(page.bodyText) + '</div>' : '';
            container.innerHTML = title +
                '<div class="lp-arabic" style="text-align:center;margin-bottom:16px">' + escapeHtml(displayContent) + '</div>' +
                engBodyHtml +
                '<div style="text-align:center"><button id="lp-eng-btn" style="background:linear-gradient(135deg,#ea580c,#dc2626);color:white;border:none;padding:10px 24px;border-radius:10px;font-size:1.1em;font-weight:bold;cursor:pointer;font-family:inherit">🧩 עבור להינדוס</button></div>' + notes;
            var engBtn = document.getElementById('lp-eng-btn');
            if (engBtn) {
                engBtn.addEventListener('click', function() { _loadPageIntoApp(page, 'hindus'); });
            }

        } else if (page.type === 'dictionary') {
            container.innerHTML = title +
                '<div class="lp-arabic" style="text-align:right;margin-bottom:16px">' + escapeHtml(displayContent) + '</div>' +
                '<div style="text-align:center"><button id="lp-dict-page-btn" style="background:linear-gradient(135deg,#0891b2,#06b6d4);color:white;border:none;padding:10px 24px;border-radius:10px;font-size:1.1em;font-weight:bold;cursor:pointer;font-family:inherit">📖 חפש במילון</button></div>' + notes;
            var dictBtn = document.getElementById('lp-dict-page-btn');
            if (dictBtn) {
                dictBtn.addEventListener('click', function() {
                    _toggleDict(true);
                    var dictInput = document.getElementById('lp-dict-input');
                    if (dictInput) {
                        dictInput.value = content;
                        _searchDict(content);
                    }
                });
            }

        } else if (page.type === 'image' || page.type === 'video') {
            // Unified media rendering — auto-detect URL type
            var mediaUrl = page.videoUrl || page.imageUrl || '';
            var embedUrl = _youtubeToEmbed(mediaUrl);
            var mediaBodyText = content ? (/<[a-z][\s\S]*>/i.test(content) ? content : escapeHtml(content)) : '';
            var mediaHtml = '';
            var isVideo = !!(embedUrl || /\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl));
            var eyeBtn = '';
            var numCtlBtn = isVideo ? '<button class="lp-numctl-btn" onclick="this.style.display=\'none\'" style="display:none;width:100%;margin:8px auto;padding:14px 24px;border:3px solid #6366f1;border-radius:12px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);color:#4338ca;font-size:1.15em;font-weight:bold;cursor:pointer;direction:rtl;box-shadow:0 2px 8px rgba(99,102,241,0.2);animation:lp-media-pulse 2s ease-in-out infinite">🔢 לחץ כאן כדי לרוץ על השמע בעזרת המספרים!</button>' : '';
            if (embedUrl) {
                // YouTube embed
                mediaHtml = '<div id="lp-video-wrap" style="text-align:center;margin:12px 0;position:relative">' + eyeBtn + '<iframe src="' + escapeAttr(embedUrl) + '?enablejsapi=1" style="width:100%;max-width:800px;aspect-ratio:16/9;border:none;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:height 0.3s,opacity 0.3s" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>' + numCtlBtn + '</div>';
            } else if (/\.(mp4|webm|ogg)(\?|$)/i.test(mediaUrl)) {
                // Direct video file
                mediaHtml = '<div id="lp-video-wrap" style="text-align:center;margin:12px 0;position:relative">' + eyeBtn +
                    '<div data-lp-media-wrap style="position:relative;display:inline-block;min-width:160px;min-height:120px;max-width:100%">' +
                    '<div data-lp-media-spinner style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#0d9488;background:#f0fdfa;border-radius:10px;z-index:1"><div style="width:34px;height:34px;border:4px solid #d1fae5;border-top-color:#0d9488;border-radius:50%;animation:lp-mload-spin 0.8s linear infinite"></div><div style="font-size:0.8em">טוען מדיה…</div></div>' +
                    '<video data-lp-media="video" src="' + escapeAttr(_absUrl(mediaUrl)) + '" controls style="max-width:100%;max-height:60vh;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:height 0.3s,opacity 0.3s;opacity:0;display:block"></video>' +
                    '</div>' + numCtlBtn + '</div>';
            } else if (mediaUrl) {
                // Image (default)
                mediaHtml = '<div style="text-align:center;margin:12px 0"><div data-lp-media-wrap style="position:relative;display:inline-block;min-width:120px;min-height:90px;max-width:100%">' +
                    '<div data-lp-media-spinner style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#0d9488;background:#f0fdfa;border-radius:10px;z-index:1"><div style="width:34px;height:34px;border:4px solid #d1fae5;border-top-color:#0d9488;border-radius:50%;animation:lp-mload-spin 0.8s linear infinite"></div><div style="font-size:0.8em">טוען מדיה…</div></div>' +
                    '<img data-lp-media="img" src="' + escapeAttr(_absUrl(mediaUrl)) + '" style="max-width:100%;max-height:60vh;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);opacity:0;transition:opacity 0.3s;display:block">' +
                    '</div></div>';
            }
            container.innerHTML = title + mediaHtml +
                (mediaBodyText ? '<div class="lp-arabic" style="text-align:right">' + mediaBodyText + '</div>' : '') +
                notes;
            _lpWireMediaLoading(container); // #1472: soft loading indicator until media is ready

        } else if (page.type === 'verb_analysis') {
            // Verb analysis table — interactive table for verb conjugation analysis
            var verbsList = (page.verbs || '').split('\n').map(function(v) { return v.trim(); }).filter(function(v) { return v; });
            var instructionHtml = page.content ? '<div class="lp-arabic" style="text-align:right;margin-bottom:16px">' + page.content + '</div>' : '';

            // Tense options
            var tenseOptions = ['עבר', 'עתיד', 'ציווי', 'מג\'זום', 'מנצוב', 'ב.פועל', 'ב.פעול', 'מצדר'];

            // Person options per tense group
            var personByTense = {
                'מצדר': ['יחיד', 'רבות'],
                'ב.פועל': ['יחיד', 'יחידה', 'רבים', 'רבות', 'זוגי זכר', 'זוגי נקבה'],
                'ב.פעול': ['יחיד', 'יחידה', 'רבים', 'רבות', 'זוגי זכר', 'זוגי נקבה'],
                'ציווי': ['נוכח', 'נוכחת', 'נוכחים', 'נוכחות', 'זוגי'],
                '_default': ['מדבר', 'נוכח', 'נוכחת', 'נסתר', 'נסתרת', 'מדברים', 'נוכחים', 'נוכחות', 'נסתרים', 'נסתרות', 'זוגי שניהם', 'זוגי שתיהן', 'זוגי שניכם', 'זוגי שתיכן']
            };

            // Tenses that allow passive (סביל)
            var passiveTenses = ['עבר', 'עתיד', 'מנצוב', 'מג\'זום'];

            // Pronoun suffix options (כינוי מושא/קניין)
            var pronounOptions = ['מדבר', 'נוכח', 'נוכחת', 'נסתר', 'נסתרת', 'מדברים', 'נוכחים', 'נוכחות', 'נסתרים', 'נסתרות', 'זוגי'];

            // Build table rows
            var rowsHtml = '';
            for (var vi = 0; vi < verbsList.length; vi++) {
                var verb = verbsList[vi];
                var rowId = 'va-row-' + vi;
                rowsHtml +=
                    '<tr data-row="' + vi + '" style="border-bottom:1px solid #e5e7eb">' +
                        '<td style="padding:10px 12px;font-family:\'Times New Roman\',Arial,serif;font-size:1.5em;font-weight:bold;white-space:nowrap;background:#f8fafc;text-align:center">' + escapeHtml(verb) + '</td>' +
                        '<td style="padding:6px 4px;text-align:center"><input type="text" class="va-root-input" data-row="' + vi + '" maxlength="4" style="width:80px;padding:6px 8px;border:2px solid #d1d5db;border-radius:6px;font-size:1.1em;font-family:PlonterFlippedDiacritics,Arial,serif;text-align:center;direction:rtl" placeholder="שורש"></td>' +
                        '<td style="padding:6px 4px;text-align:center"><input type="text" class="va-binyan-input" data-row="' + vi + '" inputmode="numeric" maxlength="2" placeholder="1-10" style="width:56px;padding:6px 4px;border:2px solid #d1d5db;border-radius:6px;font-size:1em;text-align:center;font-family:inherit"></td>' +
                        '<td style="padding:6px 4px;text-align:center"><div style="display:flex;flex-direction:column;align-items:center;gap:4px"><select class="va-tense-select" data-row="' + vi + '" style="padding:6px 4px;border:2px solid #d1d5db;border-radius:6px;font-size:0.95em;direction:rtl;min-width:100px"><option value="">—</option>' + tenseOptions.map(function(t) { return '<option value="' + escapeAttr(t) + '">' + t + '</option>'; }).join('') + '</select><label class="va-passive-label" data-row="' + vi + '" style="display:none;font-size:0.85em;cursor:pointer;user-select:none"><input type="checkbox" class="va-passive-cb" data-row="' + vi + '" style="margin-left:4px"> סביל</label></div></td>' +
                        '<td style="padding:6px 4px;text-align:center"><select class="va-person-select" data-row="' + vi + '" style="padding:6px 4px;border:2px solid #d1d5db;border-radius:6px;font-size:0.95em;direction:rtl;min-width:90px" disabled><option value="">—</option></select></td>' +
                        '<td style="padding:6px 4px;text-align:center;background:#faf5ff"><select class="va-pronoun-select" data-row="' + vi + '" style="padding:6px 4px;border:2px solid #e9d5ff;border-radius:6px;font-size:0.9em;direction:rtl;min-width:75px;color:#7c3aed;background:#faf5ff"><option value="">—</option>' + pronounOptions.map(function(p) { return '<option value="' + escapeAttr(p) + '">' + p + '</option>'; }).join('') + '</select></td>' +
                        '<td style="padding:6px 4px;text-align:center"><input type="text" class="va-translate-input" data-row="' + vi + '" style="width:100%;min-width:80px;padding:6px 8px;border:2px solid #d1d5db;border-radius:6px;font-size:1em;text-align:right;direction:rtl" placeholder="תרגום..."></td>' +
                    '</tr>';
            }

            var tableHtml =
                '<div style="overflow-x:auto;margin:12px 0">' +
                '<table id="va-table" style="width:100%;border-collapse:collapse;border:2px solid #7c3aed;border-radius:10px;overflow:hidden;direction:rtl">' +
                    '<thead><tr style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:white">' +
                        '<th style="padding:10px 12px;font-size:1em;white-space:nowrap">מילה</th>' +
                        '<th style="padding:10px 12px;font-size:1em;white-space:nowrap">שורש</th>' +
                        '<th style="padding:10px 12px;font-size:1em;white-space:nowrap">בניין</th>' +
                        '<th style="padding:10px 12px;font-size:1em;white-space:nowrap">זמן</th>' +
                        '<th style="padding:10px 12px;font-size:1em;white-space:nowrap">גוף</th>' +
                        '<th style="padding:10px 12px;font-size:0.85em;white-space:nowrap;background:rgba(255,255,255,0.15);color:#c4b5fd;font-weight:normal;font-style:italic">+כינוי<br>מושא/קניין</th>' +
                        '<th style="padding:10px 12px;font-size:1em;white-space:nowrap">תרגום</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rowsHtml + '</tbody>' +
                '</table>' +
                '</div>';

            container.innerHTML = title + instructionHtml + tableHtml + notes;

            // Wire verb analysis interactions
            (function() {
                var heb2ar = (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) ? DetailsPanel._convertHebrewToArabic.bind(DetailsPanel) : function(t) { return t; };

                // Root inputs: Enter → convert heb→ar, move to binyan
                container.querySelectorAll('.va-root-input').forEach(function(input) {
                    input.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            input.value = heb2ar(input.value);
                            // Move to binyan select in same row
                            var row = input.getAttribute('data-row');
                            var binyan = container.querySelector('.va-binyan-input[data-row="' + row + '"]');
                            if (binyan) binyan.focus();
                        }
                    });
                });

                // Tense select: update person options and passive visibility
                container.querySelectorAll('.va-tense-select').forEach(function(sel) {
                    sel.addEventListener('change', function() {
                        var row = sel.getAttribute('data-row');
                        var tense = sel.value;
                        var personSel = container.querySelector('.va-person-select[data-row="' + row + '"]');
                        var passiveLabel = container.querySelector('.va-passive-label[data-row="' + row + '"]');

                        // Update passive visibility
                        var showPassive = passiveTenses.indexOf(tense) !== -1;
                        if (passiveLabel) passiveLabel.style.display = showPassive ? 'flex' : 'none';

                        // Update person options
                        if (personSel) {
                            var persons = personByTense[tense] || personByTense['_default'];
                            if (!tense) {
                                personSel.innerHTML = '<option value="">—</option>';
                                personSel.disabled = true;
                            } else {
                                personSel.innerHTML = '<option value="">—</option>' + persons.map(function(p) {
                                    return '<option value="' + escapeAttr(p) + '">' + p + '</option>';
                                }).join('');
                                personSel.disabled = false;
                            }
                        }
                    });
                });

                // Binyan input: accept 1-10 by typing, auto-advance on complete value
                container.querySelectorAll('.va-binyan-input').forEach(function(inp) {
                    inp.addEventListener('input', function() {
                        var v = inp.value.replace(/[^0-9]/g, '').slice(0, 2);
                        if (v.length === 2 && v !== '10') v = v[0];
                        inp.value = v;
                        if (v === '10' || (v.length === 1 && v !== '0' && v !== '1')) {
                            var row = inp.getAttribute('data-row');
                            var tenseSel = container.querySelector('.va-tense-select[data-row="' + row + '"]');
                            if (tenseSel) tenseSel.focus();
                        }
                    });
                    inp.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            var row = inp.getAttribute('data-row');
                            var tenseSel = container.querySelector('.va-tense-select[data-row="' + row + '"]');
                            if (tenseSel) tenseSel.focus();
                        }
                    });
                });
            })();

            // Restore any state the user entered on this verb_analysis slide
            // earlier in the same viewing session. Lives next to where the
            // inputs were just wired so the change-events the restorer fires
            // hit the live handlers.
            _restoreVerbAnalysisGuesses();

        } else if (page.type === 'timeline') {
            // Timeline slide — horizontal axis with events above and below
            var events = page.events || [];
            var _tlStartParsed = _parseTimelineDate(page.tlStart);
            var _tlEndParsed = _parseTimelineDate(page.tlEnd);
            // Defensive: if author entered start later than end, render-time
            // auto-swap so the axis is always earlier-left → later-right.
            // The label STRINGS are swapped together with the numeric ends so
            // the two end-labels stay consistent with the computed direction.
            // (Worker3 analysis 2026-05-18 — Amitai's RTL complaint root cause.)
            var _tlStartLabel = page.tlStart || '';
            var _tlEndLabel = page.tlEnd || '';
            if (!isNaN(_tlStartParsed) && !isNaN(_tlEndParsed) && _tlStartParsed > _tlEndParsed) {
                var _swapN = _tlStartParsed; _tlStartParsed = _tlEndParsed; _tlEndParsed = _swapN;
                var _swapS = _tlStartLabel; _tlStartLabel = _tlEndLabel; _tlEndLabel = _swapS;
            }
            var tlStart = isNaN(_tlStartParsed) ? 0 : _tlStartParsed;
            var tlEnd = isNaN(_tlEndParsed) ? 100 : _tlEndParsed;
            var range = tlEnd - tlStart || 1;
            var instructionHtml = page.content ? '<div class="lp-arabic" style="text-align:right;margin-top:12px">' + page.content + '</div>' : '';

            // Sort events by time
            var sorted = events.slice().sort(function(a, b) {
                var ta = _parseTimelineDate(a && a.time); if (isNaN(ta)) ta = 0;
                var tb = _parseTimelineDate(b && b.time); if (isNaN(tb)) tb = 0;
                return ta - tb;
            });

            if (page.interactive) {
                // --- INTERACTIVE MODE: warehouse + empty slots ---
                (function() {
                    // State: which slots are filled (index → event index from sorted)
                    var placed = _interactiveTimelineCache[_viewerState.currentPage] || {}; // slotIdx → sortedEventIdx
                    var selectedWarehouse = null; // index in sorted array currently selected from warehouse

                    function _persistInteractiveTimeline() {
                        _interactiveTimelineCache[_viewerState.currentPage] = placed;
                        _lessonActivity = true;
                        _saveLessonRuntimeState(_viewerState.lessonId);
                    }

                    function _getPlacedSet() {
                        var s = {};
                        for (var k in placed) s[placed[k]] = true;
                        return s;
                    }

                    function _renderInteractiveTimeline() {
                        var placedSet = _getPlacedSet();
                        var allPlaced = Object.keys(placed).length === sorted.length;

                        var tlHtml = '<div id="tl-container" style="position:relative;width:100%;height:420px;direction:ltr;overflow:visible">';

                        // Start/end year labels (use auto-swapped labels paired with numeric ends)
                        tlHtml += '<div style="position:absolute;top:50%;left:1%;transform:translateY(-50%);font-weight:bold;color:#0369a1;font-size:1.2em">' + escapeHtml(_tlStartLabel) + '</div>';
                        tlHtml += '<div style="position:absolute;top:50%;right:1%;transform:translateY(-50%);font-weight:bold;color:#0369a1;font-size:1.2em">' + escapeHtml(_tlEndLabel) + '</div>';

                        // Axis
                        tlHtml += '<div style="position:absolute;top:50%;left:8%;right:8%;height:4px;background:linear-gradient(90deg,#0369a1,#0284c7);border-radius:2px;transform:translateY(-50%)">';
                        for (var q = 0; q <= 4; q++) {
                            tlHtml += '<div style="position:absolute;left:' + (q * 25) + '%;top:-6px;width:2px;height:16px;background:#0369a1;border-radius:1px"></div>';
                        }
                        tlHtml += '</div>';

                        // Hemisphere-alternating layout: adjacent events (sorted by time) sit
                        // on OPPOSITE sides of the axis. Strict i % 2 — no sublane growth by
                        // default. Only when a prior same-side card is within COLLISION_PCT
                        // do we stagger vertically. (Amitai 2026-05-19 v4.18.20: previous
                        // 3-sublanes-each scheme stacked close-in-time same-parity events
                        // vertically — 'הריבועים אחד על השני'.)
                        var _placements = [];
                        var _COLLISION_PCT = 18;

                        // Slots (one per event, at correct positions)
                        sorted.forEach(function(ev, i) {
                            var evTime = _parseTimelineDate(ev.time);
                            if (isNaN(evTime)) evTime = tlStart + (i + 1) * range / (sorted.length + 1);
                            var timePct = ((evTime - tlStart) / range * 84 + 8);
                            if (isNaN(timePct)) timePct = 8 + i * (84 / Math.max(sorted.length - 1, 1));
                            timePct = Math.max(8, Math.min(92, timePct));
                            var isAbove = (i % 2 === 0);
                            var sublane = 0;
                            for (var _pk = 0; _pk < _placements.length; _pk++) {
                                if (_placements[_pk].isAbove === isAbove &&
                                    Math.abs(timePct - _placements[_pk].timePct) < _COLLISION_PCT) {
                                    sublane = Math.max(sublane, _placements[_pk].sublane + 1);
                                }
                            }
                            _placements.push({ timePct: timePct, isAbove: isAbove, sublane: sublane });
                            var cardTopNum = isAbove ? (2 + sublane * 18) : (56 + sublane * 18);
                            var cardTop = cardTopNum + '%';

                            // Dot on axis (always visible)
                            tlHtml += '<div style="position:absolute;top:50%;left:' + timePct.toFixed(1) + '%;width:14px;height:14px;background:' + (placed[i] !== undefined ? '#0284c7' : '#cbd5e1') + ';border:3px solid white;border-radius:50%;transform:translate(-50%,-50%);z-index:3;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>';

                            // Time label — adjacent to its own card-slot rather than glued to the axis.
                            var cardTopNum = parseFloat(cardTop);
                            var labelTopVal = isAbove ? (cardTopNum + 12) : (cardTopNum - 4);
                            tlHtml += '<div style="position:absolute;top:' + labelTopVal.toFixed(1) + '%;left:' + timePct.toFixed(1) + '%;transform:translateX(-50%);font-size:0.78em;font-weight:bold;color:#0369a1;z-index:2;white-space:nowrap;background:rgba(255,255,255,0.85);padding:1px 4px;border-radius:4px">' + escapeHtml(ev.time || '') + '</div>';

                            if (placed[i] !== undefined) {
                                // Filled slot — show the placed event card
                                var placedEv = sorted[placed[i]];
                                var isCorrect = placed[i] === i;
                                var borderColor = allPlaced ? (isCorrect ? '#16a34a' : '#ef4444') : '#0284c7';
                                var bgColor = allPlaced ? (isCorrect ? '#f0fdf4' : '#fef2f2') : 'white';
                                tlHtml += '<div class="tl-slot tl-slot-filled" draggable="true" data-slot="' + i + '" data-evidx="' + placed[i] + '" style="position:absolute;top:' + cardTop + ';left:' + timePct.toFixed(1) + '%;transform:translateX(-50%);background:' + bgColor + ';border:2px solid ' + borderColor + ';border-radius:10px;padding:8px 12px;max-width:150px;text-align:center;box-shadow:0 2px 8px rgba(3,105,161,0.15);z-index:2;cursor:grab;transition:all 0.2s">';
                                tlHtml += '<div style="font-weight:bold;color:#0369a1;font-size:0.9em;margin-bottom:2px">' + escapeHtml(placedEv.title || '') + '</div>';
                                if (placedEv.content) tlHtml += '<div style="font-size:0.8em;color:#374151;direction:rtl">' + escapeHtml(placedEv.content) + '</div>';
                                tlHtml += '</div>';
                                // Connecting line
                                var lineTop, lineHeight;
                                if (isAbove) { var cb = parseFloat(cardTop) + 14; lineTop = cb + '%'; lineHeight = (50 - cb) + '%'; }
                                else { lineTop = '52%'; lineHeight = (parseFloat(cardTop) - 52) + '%'; }
                                tlHtml += '<div style="position:absolute;top:' + lineTop + ';left:' + timePct.toFixed(1) + '%;width:2px;height:' + lineHeight + ';background:' + borderColor + ';opacity:0.4;z-index:1"></div>';
                            } else {
                                // Empty slot — dashed outline placeholder
                                var slotHighlight = selectedWarehouse !== null ? ';border-color:#0284c7;background:#f0f9ff' : '';
                                tlHtml += '<div class="tl-slot tl-slot-empty" data-slot="' + i + '" style="position:absolute;top:' + cardTop + ';left:' + timePct.toFixed(1) + '%;transform:translateX(-50%);background:#f8fafc;border:2px dashed #94a3b8;border-radius:10px;padding:8px 12px;min-width:80px;min-height:40px;text-align:center;z-index:2;cursor:pointer;transition:all 0.2s' + slotHighlight + '">';
                                // (drop-target wired below — accepts drag from warehouse or other slots)
                                tlHtml += '<div style="color:#94a3b8;font-size:0.85em">?</div>';
                                tlHtml += '</div>';
                                // Connecting line (faded)
                                var lineTop, lineHeight;
                                if (isAbove) { var cb = parseFloat(cardTop) + 14; lineTop = cb + '%'; lineHeight = (50 - cb) + '%'; }
                                else { lineTop = '52%'; lineHeight = (parseFloat(cardTop) - 52) + '%'; }
                                tlHtml += '<div style="position:absolute;top:' + lineTop + ';left:' + timePct.toFixed(1) + '%;width:2px;height:' + lineHeight + ';background:#94a3b8;opacity:0.2;z-index:1"></div>';
                            }
                        });

                        tlHtml += '</div>';

                        // Warehouse area
                        var warehouseHtml = '<div id="tl-warehouse" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:16px;margin-top:8px;border:2px dashed #d1d5db;border-radius:12px;background:#fafafa;min-height:50px;direction:rtl">';
                        var hasUnplaced = false;
                        // Shuffle for display (use a seeded simple shuffle based on page id)
                        var warehouseItems = [];
                        sorted.forEach(function(ev, i) {
                            if (!placedSet[i]) warehouseItems.push(i);
                        });
                        warehouseItems.forEach(function(evIdx) {
                            hasUnplaced = true;
                            var ev = sorted[evIdx];
                            var isSelected = selectedWarehouse === evIdx;
                            warehouseHtml += '<div class="tl-warehouse-item" draggable="true" data-evidx="' + evIdx + '" style="background:' + (isSelected ? '#dbeafe' : 'white') + ';border:2px solid ' + (isSelected ? '#2563eb' : '#0284c7') + ';border-radius:10px;padding:8px 14px;cursor:grab;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.1);transition:all 0.15s;user-select:none' + (isSelected ? ';transform:scale(1.05)' : '') + '">';
                            warehouseHtml += '<div style="font-weight:bold;color:#0369a1;font-size:0.9em">' + escapeHtml(ev.title || '') + '</div>';
                            if (ev.content) warehouseHtml += '<div style="font-size:0.8em;color:#374151;direction:rtl">' + escapeHtml(ev.content) + '</div>';
                            warehouseHtml += '</div>';
                        });
                        if (!hasUnplaced && !allPlaced) {
                            warehouseHtml += '<div style="color:#9ca3af;font-style:italic">כל האירועים שובצו</div>';
                        }
                        warehouseHtml += '</div>';

                        // Status / completion message
                        var statusHtml = '';
                        if (allPlaced) {
                            var correctCount = 0;
                            for (var si = 0; si < sorted.length; si++) {
                                if (placed[si] === si) correctCount++;
                            }
                            if (correctCount === sorted.length) {
                                statusHtml = '<div style="text-align:center;margin-top:12px;padding:12px;background:#d1fae5;border-radius:10px;font-size:1.1em;font-weight:bold;color:#065f46">🎉 כל הכבוד! כל האירועים במקום הנכון!</div>';
                            } else {
                                statusHtml = '<div style="text-align:center;margin-top:12px;padding:12px;background:#fef3c7;border-radius:10px;font-size:1em;color:#92400e">' + correctCount + '/' + sorted.length + ' נכונים — לחץ על אירוע אדום להחזיר למחסן ולנסות שוב</div>';
                            }
                        }

                        container.innerHTML = title + tlHtml + (allPlaced ? '' : warehouseHtml) + instructionHtml + statusHtml + notes;

                        // Wire slot clicks
                        container.querySelectorAll('.tl-slot-empty').forEach(function(slot) {
                            slot.addEventListener('click', function() {
                                if (selectedWarehouse === null) return;
                                var slotIdx = parseInt(slot.dataset.slot);
                                placed[slotIdx] = selectedWarehouse;
                                selectedWarehouse = null;
                                _persistInteractiveTimeline();
                                _renderInteractiveTimeline();
                                // Check if all placed correctly → celebration sound
                                if (Object.keys(placed).length === sorted.length) {
                                    var allCorrect = true;
                                    for (var ci = 0; ci < sorted.length; ci++) { if (placed[ci] !== ci) { allCorrect = false; break; } }
                                    if (allCorrect && typeof SoundManager !== 'undefined') SoundManager.playSuccess();
                                    else if (typeof SoundManager !== 'undefined') SoundManager.playClick();
                                } else {
                                    if (typeof SoundManager !== 'undefined') SoundManager.playClick();
                                }
                            });
                        });

                        // Wire filled slot clicks (return to warehouse)
                        container.querySelectorAll('.tl-slot-filled').forEach(function(slot) {
                            slot.addEventListener('click', function() {
                                var slotIdx = parseInt(slot.dataset.slot);
                                delete placed[slotIdx];
                                selectedWarehouse = null;
                                _persistInteractiveTimeline();
                                _renderInteractiveTimeline();
                                if (typeof SoundManager !== 'undefined') SoundManager.playUndo();
                            });
                        });

                        // Wire warehouse item clicks
                        container.querySelectorAll('.tl-warehouse-item').forEach(function(item) {
                            item.addEventListener('click', function() {
                                var evIdx = parseInt(item.dataset.evidx);
                                selectedWarehouse = (selectedWarehouse === evIdx) ? null : evIdx;
                                _renderInteractiveTimeline();
                                if (typeof SoundManager !== 'undefined') SoundManager.playClick();
                            });
                        });

                        // --- Drag-and-drop wiring (Amitai 2026-05-18). Click-click flow above
                        // remains active as fallback for touch devices. ---
                        // Drag source format in dataTransfer: "warehouse:<evIdx>" or "slot:<slotIdx>"
                        function _clearDropHighlights() {
                            container.querySelectorAll('.tl-drop-target-active').forEach(function(el) {
                                el.classList.remove('tl-drop-target-active');
                                el.style.boxShadow = '';
                                el.style.borderColor = '';
                                el.style.background = '';
                            });
                        }
                        function _highlightAsDropTarget(el) {
                            el.classList.add('tl-drop-target-active');
                            el.style.boxShadow = '0 0 0 3px #2563eb, 0 0 12px rgba(37,99,235,0.4)';
                        }

                        // Warehouse items: drag source
                        container.querySelectorAll('.tl-warehouse-item').forEach(function(item) {
                            item.addEventListener('dragstart', function(e) {
                                var evIdx = item.dataset.evidx;
                                try { e.dataTransfer.setData('text/plain', 'warehouse:' + evIdx); } catch (err) {}
                                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                                item.style.opacity = '0.4';
                            });
                            item.addEventListener('dragend', function() {
                                item.style.opacity = '';
                                _clearDropHighlights();
                            });
                        });

                        // Filled slots: drag source (drag placed event off or to another slot)
                        container.querySelectorAll('.tl-slot-filled').forEach(function(slot) {
                            slot.addEventListener('dragstart', function(e) {
                                var slotIdx = slot.dataset.slot;
                                try { e.dataTransfer.setData('text/plain', 'slot:' + slotIdx); } catch (err) {}
                                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                                slot.style.opacity = '0.4';
                            });
                            slot.addEventListener('dragend', function() {
                                slot.style.opacity = '';
                                _clearDropHighlights();
                            });
                        });

                        // Drop targets: empty slots + filled slots (swap/move)
                        function _wireSlotDropTarget(slot) {
                            slot.addEventListener('dragover', function(e) {
                                e.preventDefault();
                                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                                _highlightAsDropTarget(slot);
                            });
                            slot.addEventListener('dragleave', function() {
                                slot.classList.remove('tl-drop-target-active');
                                slot.style.boxShadow = '';
                            });
                            slot.addEventListener('drop', function(e) {
                                e.preventDefault();
                                _clearDropHighlights();
                                var payload = '';
                                try { payload = e.dataTransfer.getData('text/plain') || ''; } catch (err) {}
                                if (!payload) return;
                                var targetSlotIdx = parseInt(slot.dataset.slot);
                                if (payload.indexOf('warehouse:') === 0) {
                                    var srcEvIdx = parseInt(payload.slice('warehouse:'.length));
                                    // If target slot is filled, the previous placement is implicitly displaced
                                    // back to the warehouse (by overwriting placed[targetSlotIdx]).
                                    placed[targetSlotIdx] = srcEvIdx;
                                } else if (payload.indexOf('slot:') === 0) {
                                    var srcSlotIdx = parseInt(payload.slice('slot:'.length));
                                    if (srcSlotIdx === targetSlotIdx) return; // no-op
                                    var movingEvIdx = placed[srcSlotIdx];
                                    if (movingEvIdx === undefined) return;
                                    var targetEvIdx = placed[targetSlotIdx]; // may be undefined
                                    if (targetEvIdx === undefined) {
                                        // Move: empty target
                                        placed[targetSlotIdx] = movingEvIdx;
                                        delete placed[srcSlotIdx];
                                    } else {
                                        // Swap: both slots filled
                                        placed[targetSlotIdx] = movingEvIdx;
                                        placed[srcSlotIdx] = targetEvIdx;
                                    }
                                } else {
                                    return;
                                }
                                selectedWarehouse = null;
                                _persistInteractiveTimeline();
                                _renderInteractiveTimeline();
                                if (Object.keys(placed).length === sorted.length) {
                                    var allCorrect2 = true;
                                    for (var ci2 = 0; ci2 < sorted.length; ci2++) { if (placed[ci2] !== ci2) { allCorrect2 = false; break; } }
                                    if (allCorrect2 && typeof SoundManager !== 'undefined') SoundManager.playSuccess();
                                    else if (typeof SoundManager !== 'undefined') SoundManager.playClick();
                                } else {
                                    if (typeof SoundManager !== 'undefined') SoundManager.playClick();
                                }
                            });
                        }
                        container.querySelectorAll('.tl-slot-empty').forEach(_wireSlotDropTarget);
                        container.querySelectorAll('.tl-slot-filled').forEach(_wireSlotDropTarget);

                        // Warehouse area: drop target for "return to warehouse"
                        var warehouseEl = container.querySelector('#tl-warehouse');
                        if (warehouseEl) {
                            warehouseEl.addEventListener('dragover', function(e) {
                                // Only accept if dragging from a filled slot
                                e.preventDefault();
                                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                                warehouseEl.style.background = '#eff6ff';
                                warehouseEl.style.borderColor = '#2563eb';
                            });
                            warehouseEl.addEventListener('dragleave', function() {
                                warehouseEl.style.background = '';
                                warehouseEl.style.borderColor = '';
                            });
                            warehouseEl.addEventListener('drop', function(e) {
                                e.preventDefault();
                                warehouseEl.style.background = '';
                                warehouseEl.style.borderColor = '';
                                var payload = '';
                                try { payload = e.dataTransfer.getData('text/plain') || ''; } catch (err) {}
                                if (payload.indexOf('slot:') !== 0) return; // ignore warehouse→warehouse
                                var srcSlotIdx = parseInt(payload.slice('slot:'.length));
                                if (placed[srcSlotIdx] === undefined) return;
                                delete placed[srcSlotIdx];
                                selectedWarehouse = null;
                                _persistInteractiveTimeline();
                                _renderInteractiveTimeline();
                                if (typeof SoundManager !== 'undefined') SoundManager.playUndo();
                            });
                        }

                        // --- Touch fallback for drag-and-drop (Amitai 2026-05-18 follow-up).
                        //     HTML5 DnD doesn't fire on touch devices; emulate with
                        //     touchstart/move/end + document.elementFromPoint. Each
                        //     drag attaches its own document listeners and removes
                        //     them on touchend — no leaks across re-renders. ---
                        function _executeTouchDrop(srcKind, srcIdent, underEl) {
                            if (!underEl) return false;
                            var slot = underEl.closest ? underEl.closest('.tl-slot-empty, .tl-slot-filled') : null;
                            var wh = underEl.closest ? underEl.closest('#tl-warehouse') : null;
                            if (slot) {
                                var targetSlotIdx = parseInt(slot.dataset.slot);
                                if (srcKind === 'warehouse') {
                                    placed[targetSlotIdx] = parseInt(srcIdent);
                                } else if (srcKind === 'slot') {
                                    var srcSlotIdx = parseInt(srcIdent);
                                    if (srcSlotIdx === targetSlotIdx) return false;
                                    var movingEvIdx = placed[srcSlotIdx];
                                    if (movingEvIdx === undefined) return false;
                                    var targetEvIdx = placed[targetSlotIdx];
                                    if (targetEvIdx === undefined) {
                                        placed[targetSlotIdx] = movingEvIdx;
                                        delete placed[srcSlotIdx];
                                    } else {
                                        placed[targetSlotIdx] = movingEvIdx;
                                        placed[srcSlotIdx] = targetEvIdx;
                                    }
                                } else {
                                    return false;
                                }
                                selectedWarehouse = null;
                                _persistInteractiveTimeline();
                                _renderInteractiveTimeline();
                                if (Object.keys(placed).length === sorted.length) {
                                    var allCorrect3 = true;
                                    for (var ci3 = 0; ci3 < sorted.length; ci3++) { if (placed[ci3] !== ci3) { allCorrect3 = false; break; } }
                                    if (allCorrect3 && typeof SoundManager !== 'undefined') SoundManager.playSuccess();
                                    else if (typeof SoundManager !== 'undefined') SoundManager.playClick();
                                } else {
                                    if (typeof SoundManager !== 'undefined') SoundManager.playClick();
                                }
                                return true;
                            } else if (wh && srcKind === 'slot') {
                                var srcSlotIdx2 = parseInt(srcIdent);
                                if (placed[srcSlotIdx2] === undefined) return false;
                                delete placed[srcSlotIdx2];
                                selectedWarehouse = null;
                                _persistInteractiveTimeline();
                                _renderInteractiveTimeline();
                                if (typeof SoundManager !== 'undefined') SoundManager.playUndo();
                                return true;
                            }
                            return false;
                        }

                        function _attachTouchDrag(sourceEl, kind, getIdent) {
                            sourceEl.addEventListener('touchstart', function(e) {
                                if (e.touches.length !== 1) return;
                                var t = e.touches[0];
                                e.preventDefault(); // prevent scroll/long-press
                                var ident = getIdent();
                                var rect = sourceEl.getBoundingClientRect();
                                var clone = sourceEl.cloneNode(true);
                                clone.style.position = 'fixed';
                                clone.style.left = (t.clientX - rect.width / 2) + 'px';
                                clone.style.top = (t.clientY - rect.height / 2) + 'px';
                                clone.style.width = rect.width + 'px';
                                clone.style.height = rect.height + 'px';
                                clone.style.margin = '0';
                                clone.style.opacity = '0.85';
                                clone.style.pointerEvents = 'none';
                                clone.style.zIndex = '9999';
                                clone.style.transform = 'rotate(2deg) scale(1.05)';
                                clone.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
                                document.body.appendChild(clone);
                                sourceEl.style.opacity = '0.35';

                                function moveHandler(ev) {
                                    if (ev.touches.length !== 1) return;
                                    ev.preventDefault();
                                    var tt = ev.touches[0];
                                    var r = clone.getBoundingClientRect();
                                    clone.style.left = (tt.clientX - r.width / 2) + 'px';
                                    clone.style.top = (tt.clientY - r.height / 2) + 'px';
                                    clone.style.display = 'none';
                                    var under = document.elementFromPoint(tt.clientX, tt.clientY);
                                    clone.style.display = '';
                                    _clearDropHighlights();
                                    var wh0 = container.querySelector('#tl-warehouse');
                                    if (wh0) { wh0.style.background = ''; wh0.style.borderColor = ''; }
                                    if (under) {
                                        var s2 = under.closest && under.closest('.tl-slot-empty, .tl-slot-filled');
                                        var w2 = under.closest && under.closest('#tl-warehouse');
                                        if (s2) _highlightAsDropTarget(s2);
                                        else if (w2 && kind === 'slot') {
                                            w2.style.background = '#eff6ff';
                                            w2.style.borderColor = '#2563eb';
                                        }
                                    }
                                }
                                function endHandler(ev) {
                                    document.removeEventListener('touchmove', moveHandler, { passive: false });
                                    document.removeEventListener('touchend', endHandler);
                                    document.removeEventListener('touchcancel', endHandler);
                                    var tt = (ev.changedTouches && ev.changedTouches[0]) || null;
                                    clone.style.display = 'none';
                                    var under = tt ? document.elementFromPoint(tt.clientX, tt.clientY) : null;
                                    clone.remove();
                                    sourceEl.style.opacity = '';
                                    _clearDropHighlights();
                                    var wh1 = container.querySelector('#tl-warehouse');
                                    if (wh1) { wh1.style.background = ''; wh1.style.borderColor = ''; }
                                    _executeTouchDrop(kind, ident, under);
                                }
                                document.addEventListener('touchmove', moveHandler, { passive: false });
                                document.addEventListener('touchend', endHandler);
                                document.addEventListener('touchcancel', endHandler);
                            }, { passive: false });
                        }
                        container.querySelectorAll('.tl-warehouse-item').forEach(function(item) {
                            _attachTouchDrag(item, 'warehouse', function() { return item.dataset.evidx; });
                        });
                        container.querySelectorAll('.tl-slot-filled').forEach(function(slot) {
                            _attachTouchDrag(slot, 'slot', function() { return slot.dataset.slot; });
                        });
                    }

                    _renderInteractiveTimeline();
                })();

            } else {
                // --- STANDARD MODE: static display ---
                var tlHtml = '<div id="tl-container" style="position:relative;width:100%;height:420px;direction:ltr;overflow:visible">';

                // Start/end year labels (auto-swapped paired with numeric ends)
                tlHtml += '<div style="position:absolute;top:50%;left:1%;transform:translateY(-50%);font-weight:bold;color:#0369a1;font-size:1.2em">' + escapeHtml(_tlStartLabel) + '</div>';
                tlHtml += '<div style="position:absolute;top:50%;right:1%;transform:translateY(-50%);font-weight:bold;color:#0369a1;font-size:1.2em">' + escapeHtml(_tlEndLabel) + '</div>';

                // Axis
                tlHtml += '<div style="position:absolute;top:50%;left:8%;right:8%;height:4px;background:linear-gradient(90deg,#0369a1,#0284c7);border-radius:2px;transform:translateY(-50%)">';
                for (var q = 0; q <= 4; q++) {
                    tlHtml += '<div style="position:absolute;left:' + (q * 25) + '%;top:-6px;width:2px;height:16px;background:#0369a1;border-radius:1px"></div>';
                }
                tlHtml += '</div>';

                // Place events — hemisphere-alternating with collision-aware sublane
                // (mirrors interactive branch; see comment there for rationale).
                var _placementsStatic = [];
                var _COLLISION_PCT_STATIC = 18;
                sorted.forEach(function(ev, i) {
                    var evTime = _parseTimelineDate(ev.time);
                    if (isNaN(evTime)) evTime = tlStart + (i + 1) * range / (sorted.length + 1);
                    var timePct = ((evTime - tlStart) / range * 84 + 8);
                    if (isNaN(timePct)) timePct = 8 + i * (84 / Math.max(sorted.length - 1, 1));
                    timePct = Math.max(8, Math.min(92, timePct));
                    var isAbove = (i % 2 === 0);
                    var sublane = 0;
                    for (var _spk = 0; _spk < _placementsStatic.length; _spk++) {
                        if (_placementsStatic[_spk].isAbove === isAbove &&
                            Math.abs(timePct - _placementsStatic[_spk].timePct) < _COLLISION_PCT_STATIC) {
                            sublane = Math.max(sublane, _placementsStatic[_spk].sublane + 1);
                        }
                    }
                    _placementsStatic.push({ timePct: timePct, isAbove: isAbove, sublane: sublane });
                    var cardTopNum = isAbove ? (2 + sublane * 18) : (56 + sublane * 18);
                    var cardTop = cardTopNum + '%';

                    tlHtml += '<div class="tl-event-card" style="position:absolute;top:' + cardTop + ';left:' + timePct.toFixed(1) + '%;transform:translateX(-50%);background:white;border:2px solid #0284c7;border-radius:10px;padding:8px 12px;max-width:150px;text-align:center;box-shadow:0 2px 8px rgba(3,105,161,0.15);z-index:2">';
                    tlHtml += '<div style="font-weight:bold;color:#0369a1;font-size:0.9em;margin-bottom:2px">' + escapeHtml(ev.title || '') + '</div>';
                    if (ev.content) tlHtml += '<div style="font-size:0.8em;color:#374151;direction:rtl">' + escapeHtml(ev.content) + '</div>';
                    tlHtml += '</div>';

                    tlHtml += '<div style="position:absolute;top:50%;left:' + timePct.toFixed(1) + '%;width:14px;height:14px;background:#0284c7;border:3px solid white;border-radius:50%;transform:translate(-50%,-50%);z-index:3;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>';

                    // Time label adjacent to its card-slot, not glued to the axis.
                    var cardTopNum = parseFloat(cardTop);
                    var labelTopVal = isAbove ? (cardTopNum + 12) : (cardTopNum - 4);
                    tlHtml += '<div style="position:absolute;top:' + labelTopVal.toFixed(1) + '%;left:' + timePct.toFixed(1) + '%;transform:translateX(-50%);font-size:0.78em;font-weight:bold;color:#0369a1;z-index:2;white-space:nowrap;background:rgba(255,255,255,0.85);padding:1px 4px;border-radius:4px">' + escapeHtml(ev.time || '') + '</div>';

                    var lineTop, lineHeight;
                    if (isAbove) {
                        var cardBottomPct = parseFloat(cardTop) + 14;
                        lineTop = cardBottomPct + '%';
                        lineHeight = (50 - cardBottomPct) + '%';
                    } else {
                        lineTop = '52%';
                        lineHeight = (parseFloat(cardTop) - 52) + '%';
                    }
                    tlHtml += '<div style="position:absolute;top:' + lineTop + ';left:' + timePct.toFixed(1) + '%;width:2px;height:' + lineHeight + ';background:#0284c7;opacity:0.4;z-index:1"></div>';
                });

                tlHtml += '</div>';
                container.innerHTML = title + tlHtml + instructionHtml + notes;
            }
        }

        // Media tab in dictionary panel — always available (never blocked)
        if (typeof Dictionary !== 'undefined') {
            var isMediaSlide = (page.type === 'image' || page.type === 'video') && (page.videoUrl || page.imageUrl);
            Dictionary.setMediaTabBlocked(false);
            var mediaPage = null;
            if (isMediaSlide) {
                mediaPage = page;
            } else if (_viewerState && _viewerState.lessonId) {
                // Find first media page in lesson (check ALL pages for videoUrl OR imageUrl)
                var _lessonForMedia = getLesson(_viewerState.lessonId);
                var _pagesForMedia = _lessonForMedia ? _lessonForMedia.pages : [];
                for (var pi = 0; pi < _pagesForMedia.length; pi++) {
                    var p = _pagesForMedia[pi];
                    if ((p.type === 'image' || p.type === 'video') && (p.videoUrl || p.imageUrl)) {
                        mediaPage = p;
                        break;
                    }
                }
            }
            if (mediaPage) {
                Dictionary.setMediaPage(mediaPage);
                _removeMediaButton();
            } else {
                Dictionary.clearMediaPage();
                _removeMediaButton();
            }
        }

        // Wire hidden note toggle
        var hiddenNote = document.getElementById('lp-hidden-note');
        if (hiddenNote) {
            hiddenNote.addEventListener('click', function() {
                var isRevealed = hiddenNote.classList.contains('note-revealed');
                if (isRevealed) {
                    hiddenNote.classList.remove('note-revealed');
                    hiddenNote.innerHTML = '❓ <span style="font-size:0.85em;color:#6366f1">לחץ לחשוף הערה</span>';
                    hiddenNote.style.background = '#e0e7ff';
                    hiddenNote.style.borderStyle = 'dashed';
                } else {
                    hiddenNote.classList.add('note-revealed');
                    hiddenNote.innerHTML = '<strong>הערות:</strong> ' + escapeHtml(hiddenNote.dataset.noteText);
                    hiddenNote.style.background = '#fef3c7';
                    hiddenNote.style.borderColor = '#fbbf24';
                    hiddenNote.style.borderStyle = 'solid';
                    hiddenNote.style.color = '#92400e';
                }
            });
        }

        // Wire "navigate with numbers" button — show on YouTube click, hide on page click
        if (document.getElementById('lp-video-wrap')) {
            // Remove old listeners to prevent accumulation
            if (window._lpNumBlur) window.removeEventListener('blur', window._lpNumBlur);
            if (window._lpNumClick) document.removeEventListener('click', window._lpNumClick);
            window._lpNumBlur = function() {
                // iframe got focus (user clicked YouTube)
                var btn = document.querySelector('#lp-video-wrap .lp-numctl-btn');
                if (btn) btn.style.display = 'block';
            };
            window._lpNumClick = function() {
                // User clicked on page (not iframe)
                var btn = document.querySelector('#lp-video-wrap .lp-numctl-btn');
                if (btn) btn.style.display = 'none';
            };
            window.addEventListener('blur', window._lpNumBlur);
            document.addEventListener('click', window._lpNumClick);

            // Numpad-style seek handler for presentation video (when dict media tab is NOT active)
            if (window._lpVideoSeek) document.removeEventListener('keydown', window._lpVideoSeek);
            window._lpVideoSeek = function(e) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'IFRAME') return;
                if (e.target.isContentEditable) return;
                // Don't handle if DiacriticsKeyboard is active — DK uses number keys for navigation
                if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard.isActive()) return;
                // Don't handle if dict media tab has its own handler active
                if (typeof Dictionary !== 'undefined' && Dictionary._mediaKeyHandler) return;
                var videoWrap = document.getElementById('lp-video-wrap');
                if (!videoWrap) return;
                // Unified מקלדת פונטיקה mapping (Amitai 2026-05-20 14:28) — same for audio + video:
                // 9/7 = seek ±10s, 6/4 = seek ±3s, 5 = -0.8s, 3/1 = speed ±0.1, 8/2 = volume up/down, 0 = play/pause.
                var seekMap = {'9': 10, '7': -10, '6': 3, '4': -3, '5': -0.8};
                var speedMap = {'3': 0.1, '1': -0.1};
                var volMap = {'8': 0.1, '2': -0.1};
                var isPlayPause = (e.key === '0' || e.key === ' ');
                var isArrow = (e.key === 'ArrowRight' || e.key === 'ArrowLeft');
                var seekDelta = seekMap[e.key];
                if (seekDelta === undefined && isArrow) seekDelta = (e.key === 'ArrowRight' ? 5 : -5);
                var speedDelta = speedMap[e.key];
                var volDelta = volMap[e.key];
                if (seekDelta === undefined && speedDelta === undefined && volDelta === undefined && !isPlayPause) return;
                e.preventDefault();
                var mainVid = videoWrap.querySelector('video');
                var mainIf = videoWrap.querySelector('iframe');
                var isYt = mainIf && mainIf.src && mainIf.src.indexOf('youtube') !== -1;
                if (isPlayPause) {
                    if (mainVid) { if (mainVid.paused) mainVid.play(); else mainVid.pause(); }
                    if (isYt) {
                        window._lpYtPlaying = !window._lpYtPlaying;
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func: window._lpYtPlaying ? 'playVideo' : 'pauseVideo',args:''}), '*');
                    }
                } else if (seekDelta !== undefined) {
                    if (mainVid) mainVid.currentTime = Math.max(0, mainVid.currentTime + seekDelta);
                    if (isYt) {
                        window._lpYtTime = (window._lpYtTime || 0) + seekDelta;
                        if (window._lpYtTime < 0) window._lpYtTime = 0;
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[window._lpYtTime, true]}), '*');
                    }
                } else if (speedDelta !== undefined) {
                    if (mainVid) mainVid.playbackRate = Math.max(0.25, Math.min(4, (mainVid.playbackRate || 1) + speedDelta));
                    if (isYt) {
                        window._lpYtRate = Math.max(0.25, Math.min(2, (window._lpYtRate || 1) + speedDelta));
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func:'setPlaybackRate',args:[window._lpYtRate]}), '*');
                    }
                } else if (volDelta !== undefined) {
                    if (mainVid) mainVid.volume = Math.max(0, Math.min(1, (mainVid.volume === undefined ? 1 : mainVid.volume) + volDelta));
                    if (isYt) {
                        window._lpYtVol = Math.max(0, Math.min(100, (window._lpYtVol === undefined ? 100 : window._lpYtVol) + volDelta * 100));
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func:'setVolume',args:[window._lpYtVol]}), '*');
                    }
                }
            };
            document.addEventListener('keydown', window._lpVideoSeek);
            // Track YouTube time via postMessage
            if (window._lpYtMsg) window.removeEventListener('message', window._lpYtMsg);
            window._lpYtTime = 0;
            window._lpYtPlaying = false;
            window._lpYtMsg = function(e) {
                if (!e.data || typeof e.data !== 'string') return;
                try {
                    var d = JSON.parse(e.data);
                    if (d.event === 'infoDelivery' && d.info) {
                        if (d.info.currentTime !== undefined) window._lpYtTime = d.info.currentTime;
                        if (d.info.playerState !== undefined) window._lpYtPlaying = d.info.playerState === 1;
                    }
                } catch(ex) {}
            };
            window.addEventListener('message', window._lpYtMsg);
            // Request YT API listening
            var mainIf = document.querySelector('#lp-video-wrap iframe');
            if (mainIf) {
                mainIf.addEventListener('load', function() {
                    mainIf.contentWindow.postMessage('{"event":"listening"}', '*');
                });
                // Also try immediately in case already loaded
                try { mainIf.contentWindow.postMessage('{"event":"listening"}', '*'); } catch(ex) {}
            }
        }

        // Restore strokes if any
        _redrawStrokes();
    }

    function _renderDots(lesson) {
        var dotsContainer = document.getElementById('lp-dots');
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        for (var i = 0; i < lesson.pages.length; i++) {
            var dot = document.createElement('div');
            dot.className = 'lp-dot' + (i === _viewerState.currentPage ? ' active' : '');
            dot.dataset.idx = i;
            // Apply page color tag
            var pageColor = lesson.pages[i].dotColor;
            if (pageColor) {
                dot.style.background = pageColor;
                dot.style.borderColor = pageColor;
            }
            dot.addEventListener('click', (function(idx) {
                return function() { _goToPage(idx); };
            })(i));
            dotsContainer.appendChild(dot);
        }
    }

    function _wirePresenterEvents(presenter, lesson) {
        // Exit (home)
        document.getElementById('lp-exit').addEventListener('click', closeViewer);
        // DiacriticsKeyboard toggle button — saves and restores cursor position
        var dkToggle = document.getElementById('lp-dk-toggle');
        if (dkToggle && typeof DiacriticsKeyboard !== 'undefined') {
            // Save cursor on mousedown (before focus moves to button)
            var _savedEl = null, _savedSel = null;
            dkToggle.addEventListener('mousedown', function(e) {
                e.preventDefault(); // prevent focus steal
                _savedEl = document.activeElement;
                try { var s = window.getSelection(); if (s && s.rangeCount > 0) _savedSel = s.getRangeAt(0).cloneRange(); } catch(ex) {}
            });
            dkToggle.addEventListener('click', function() {
                // Amitai 2026-06-06: the ניקוד keyboard is locked unless the caret is inside a
                // text field (e.g. a question-mark missing-syllable input). A locked click is a no-op.
                if (dkToggle._dkLocked) return;
                DiacriticsKeyboard.toggle();
                var active = DiacriticsKeyboard._active;
                dkToggle.classList.toggle('active', active);
                dkToggle.style.background = active ? '#6366f1' : '';
                dkToggle.style.color = active ? 'white' : '';
                // Restore cursor position
                if (_savedEl && _savedEl.focus) {
                    _savedEl.focus();
                    if (_savedSel) { try { var s = window.getSelection(); s.removeAllRanges(); s.addRange(_savedSel); } catch(ex) {} }
                }
                _savedEl = null; _savedSel = null;
            });
            // Sync state when DK toggled externally
            document.addEventListener('dk-toggle', function(e) {
                dkToggle.classList.toggle('active', e.detail.active);
                dkToggle.style.background = e.detail.active ? '#6366f1' : '';
                dkToggle.style.color = e.detail.active ? 'white' : '';
            });

            // ── ניקוד-keyboard LOCK (Amitai 2026-06-06) ───────────────────────────────
            // The keyboard can only be activated from inside a text field. When no text
            // field holds the caret the toggle is locked + greyed; the moment a qmark
            // missing-syllable input (or any presenter text field) is focused it lights up
            // and bounces a bit to invite the teacher to use it.
            if (!document.getElementById('lp-dk-lock-style')) {
                var _dkLockStyle = document.createElement('style');
                _dkLockStyle.id = 'lp-dk-lock-style';
                _dkLockStyle.textContent =
                    '@keyframes lpDkBounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-5px) scale(1.12)}55%{transform:translateY(0)}75%{transform:translateY(-2px)}}' +
                    '#lp-dk-toggle.lp-dk-locked{opacity:.42;filter:grayscale(1);cursor:not-allowed}' +
                    '@media (prefers-reduced-motion: no-preference){#lp-dk-toggle.lp-dk-unlocked{animation:lpDkBounce .8s ease-in-out 2}}';
                document.head.appendChild(_dkLockStyle);
            }
            function _isDkTextField(el) {
                if (!el) return false;
                if (el.id === 'qmark-active-input') return true;
                if (el.closest && el.closest('.qmark-editing')) return true;
                // any text input / contenteditable living inside the presenter overlay
                var inPresenter = el.closest && el.closest('#lesson-presenter, .lesson-presenter, [data-lp-presenter]');
                if (!inPresenter) return false;
                if (el.isContentEditable) return true;
                if (el.tagName === 'INPUT' && /^(text|search|)$/i.test(el.type || '')) return true;
                return false;
            }
            function _setDkLocked(locked) {
                dkToggle._dkLocked = locked;
                if (locked) {
                    dkToggle.classList.add('lp-dk-locked');
                    dkToggle.classList.remove('lp-dk-unlocked');
                    dkToggle.title = 'מקלדת ניקוד — היכנס לשדה טקסט כדי להפעיל';
                } else {
                    dkToggle.classList.remove('lp-dk-locked');
                    // re-trigger the bounce each time a field is focused
                    dkToggle.classList.remove('lp-dk-unlocked');
                    void dkToggle.offsetWidth; // reflow so the animation restarts
                    dkToggle.classList.add('lp-dk-unlocked');
                    dkToggle.title = 'מקלדת ניקוד (QWES)';
                }
            }
            // Start locked.
            _setDkLocked(true);
            // Track focus at document level (qmark inputs are created lazily); guard so the
            // listeners no-op once this presenter's toggle has been removed from the DOM.
            function _dkFocusIn(e) {
                if (!document.body.contains(dkToggle)) return;
                if (_isDkTextField(e.target)) _setDkLocked(false);
            }
            function _dkFocusOut() {
                if (!document.body.contains(dkToggle)) return;
                setTimeout(function() {
                    if (!document.body.contains(dkToggle)) return;
                    if (!_isDkTextField(document.activeElement)) {
                        _setDkLocked(true);
                        // close the keyboard if it was left open with no field to type into
                        if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard._active) {
                            DiacriticsKeyboard.toggle();
                            dkToggle.classList.remove('active');
                            dkToggle.style.background = '';
                            dkToggle.style.color = '';
                        }
                    }
                }, 60);
            }
            document.addEventListener('focusin', _dkFocusIn);
            document.addEventListener('focusout', _dkFocusOut);
        }
        // Edit lesson
        document.getElementById('lp-edit-lesson').addEventListener('click', function() {
            var lessonId = _viewerState ? _viewerState.lessonId : null;
            if (lessonId) {
                if (_isReadOnlyLessonSource(lesson)) {
                    _showCloneDemoDialog(lesson);
                    return;
                }
                function _doEdit() {
                    _saveSlideHighlights();
                    _saveLessonRuntimeState(lessonId);
                    _viewerState = null;
                    var viewer = document.getElementById('lesson-viewer');
                    if (viewer) viewer.remove();
                    openLessonEditor(lessonId);
                }
                _doEdit(); // annotations are saved anyway; no exit-confirm (Amitai 2026-06-17)
            }
        });

        // Navigation
        document.getElementById('lp-prev').addEventListener('click', viewerPrev);
        document.getElementById('lp-next').addEventListener('click', viewerNext);

        // Clock
        (function initClock() {
            var clockEl = document.getElementById('lp-clock');
            if (!clockEl) return;
            function updateClock() {
                var now = new Date();
                clockEl.textContent = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
            }
            updateClock();
            if (window._lpClockInterval) clearInterval(window._lpClockInterval);
            window._lpClockInterval = setInterval(updateClock, 60000);
        })();

        // Vocab bar toggle
        var vocabToggle = document.getElementById('lp-vocab-toggle');
        if (vocabToggle) {
            vocabToggle.addEventListener('click', function() {
                var bar = document.getElementById('lp-vocab-bar');
                if (!bar) return;
                if (typeof VocabBar !== 'undefined' && VocabBar._items.length === 0) return; // nothing to show
                var visible = bar.style.display !== 'none';
                bar.style.display = visible ? 'none' : 'block';
                vocabToggle.style.background = visible ? 'none' : '#0d9488';
                vocabToggle.style.color = visible ? '' : 'white';
                // Auto-focus last meaning input when opening
                if (!visible) {
                    var inputs = document.querySelectorAll('.lp-vocab-meaning');
                    if (inputs.length) inputs[inputs.length - 1].focus();
                }
            });
        }

        // Toolbar buttons
        var _diacLongPress = null;
        presenter.querySelectorAll('.lp-tool-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tool = btn.dataset.lpTool;
                if (tool === 'undo') {
                    _presenterUndo();
                    return;
                }
                if (tool === 'redo') {
                    _presenterRedo();
                    return;
                }

                // Toggle tool (analyze is now a capture mode like translate)
                if (_presenterCtx.currentTool === tool) {
                    _deactivateTool();
                } else {
                    _activateTool(tool);
                }
            });

            // Long-press on diacritics button → reveal/hide all
            if (btn.dataset.lpTool === 'diacritics') {
                btn.addEventListener('mousedown', function() {
                    _diacLongPress = setTimeout(function() {
                        _diacLongPress = null;
                        // Activate diacritics mode if not already
                        if (_presenterCtx.currentTool !== 'diacritics') {
                            _activateTool('diacritics');
                        }
                        var anyRevealed = document.querySelector('.lesson-presenter .diacritics-word.revealed') || document.querySelector('.lesson-presenter .qmark-placeholder.revealed');
                        if (anyRevealed) {
                            _hideAllDiacritics();
                            _hideAllQmarks();
                        } else {
                            _revealAllDiacritics();
                            _revealAllQmarks();
                        }
                    }, 500);
                });
                btn.addEventListener('mouseup', function() {
                    if (_diacLongPress) { clearTimeout(_diacLongPress); _diacLongPress = null; }
                });
                btn.addEventListener('mouseleave', function() {
                    if (_diacLongPress) { clearTimeout(_diacLongPress); _diacLongPress = null; }
                });
                // Touch
                btn.addEventListener('touchstart', function(e) {
                    _diacLongPress = setTimeout(function() {
                        _diacLongPress = null;
                        if (_presenterCtx.currentTool !== 'diacritics') {
                            _activateTool('diacritics');
                        }
                        var anyRevealed = document.querySelector('.lesson-presenter .diacritics-word.revealed') || document.querySelector('.lesson-presenter .qmark-placeholder.revealed');
                        if (anyRevealed) {
                            _hideAllDiacritics();
                            _hideAllQmarks();
                        } else {
                            _revealAllDiacritics();
                            _revealAllQmarks();
                        }
                    }, 500);
                }, { passive: true });
                btn.addEventListener('touchend', function() {
                    if (_diacLongPress) { clearTimeout(_diacLongPress); _diacLongPress = null; }
                });
            }
        });

        // Reset button — clears drawings, highlights, qmark guesses for current slide
        var resetBtn = document.getElementById('lp-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                if (!confirm('לאפס את כל השינויים בשקף הנוכחי? (ציורים, סימוני טקסט, ניחושים)')) return;
                // Clear canvas (drawings)
                var canvas = document.getElementById('lp-canvas');
                if (canvas) {
                    var ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
                if (_presenterCtx) {
                    _presenterCtx.slideStrokes[_viewerState.currentPage] = [];
                    _presenterCtx.slideHighlights[_viewerState.currentPage] = [];
                    _presenterCtx.undoStack = [];
                    _presenterCtx.redoStack = [];
                }
                // Clear highlights from DOM
                document.querySelectorAll('.lp-highlighted').forEach(function(el) {
                    var parent = el.parentNode;
                    while (el.firstChild) parent.insertBefore(el.firstChild, el);
                    parent.removeChild(el);
                });
                // Reset qmarks — hide all reveals, clear guesses
                _currentQmarkData.forEach(function(item) {
                    item.guess = '';
                    var el = document.getElementById(item.id);
                    if (el) {
                        el.classList.remove('revealed');
                        el._qmarkRevealState = 0;
                        el.style.cssText = el._qmarkOrigStyle || 'display:inline-block;min-width:80px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:4px;padding:0 6px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.3;box-sizing:border-box';
                        el.textContent = '?';
                    }
                });
                // Clear qmark cache for this page
                delete _qmarkGuessCache[_viewerState.currentPage];
                _lessonActivity = true; // reset is an activity — persist the cleared state
                _persistQmarkCache();
                _saveLessonRuntimeState(_viewerState.lessonId);
                // Hide diacritics reveals
                _hideAllDiacritics();
                MessageManager.show('השקף אופס', 'info');
            });
        }

        // Draw palette
        presenter.querySelectorAll('[data-lp-draw]').forEach(function(dot) {
            dot.addEventListener('click', function(e) {
                e.stopPropagation();
                var color = dot.dataset.lpDraw;
                presenter.querySelectorAll('[data-lp-draw]').forEach(function(d) { d.classList.remove('selected'); });
                dot.classList.add('selected');
                if (color === 'eraser') {
                    _presenterCtx.isEraser = true;
                } else {
                    _presenterCtx.isEraser = false;
                    _presenterCtx.drawColor = color;
                }
            });
        });

        // Long-press on eraser → clear ALL drawings on current slide
        var eraserDot = presenter.querySelector('[data-lp-draw="eraser"]');
        if (eraserDot) {
            var eraserTimer = null;
            eraserDot.addEventListener('mousedown', function() {
                eraserTimer = setTimeout(function() {
                    eraserTimer = null;
                    _showStyledConfirm('למחוק את כל הקשקושים בשקף הזה?', function() {
                        var pageIdx = _viewerState.currentPage;
                        _presenterCtx.slideStrokes[pageIdx] = [];
                        _presenterCtx.undoStack = [];
                        _presenterCtx.redoStack = [];
                        _redrawStrokes();
                    });
                }, 600);
            });
            eraserDot.addEventListener('mouseup', function() { if (eraserTimer) clearTimeout(eraserTimer); });
            eraserDot.addEventListener('mouseleave', function() { if (eraserTimer) clearTimeout(eraserTimer); });
        }

        // Highlight palette
        presenter.querySelectorAll('[data-lp-hl]').forEach(function(dot) {
            var color = dot.dataset.lpHl;
            if (color === 'clear') {
                // Short click = enter individual deletion mode; long press = clear all
                var clearTimer = null;
                var didLongPress = false;
                dot.addEventListener('mousedown', function(e) {
                    didLongPress = false;
                    clearTimer = setTimeout(function() {
                        didLongPress = true;
                        clearTimer = null;
                        _showStyledConfirm('למחוק את כל הסימונים בשקף זה?', function() { _clearAllHighlights(); });
                    }, 500);
                });
                dot.addEventListener('mouseup', function() { if (clearTimer) clearTimeout(clearTimer); });
                dot.addEventListener('mouseleave', function() { if (clearTimer) clearTimeout(clearTimer); });
                dot.addEventListener('touchstart', function(e) {
                    didLongPress = false;
                    clearTimer = setTimeout(function() {
                        didLongPress = true;
                        clearTimer = null;
                        _showStyledConfirm('למחוק את כל הסימונים בשקף זה?', function() { _clearAllHighlights(); });
                    }, 500);
                });
                dot.addEventListener('touchend', function() { if (clearTimer) clearTimeout(clearTimer); });
                dot.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (didLongPress) return;
                    presenter.querySelectorAll('[data-lp-hl]').forEach(function(d) { d.classList.remove('selected'); });
                    dot.classList.add('selected');
                    _presenterCtx.highlightColor = 'clear';
                });
            } else {
                dot.addEventListener('click', function(e) {
                    e.stopPropagation();
                    presenter.querySelectorAll('[data-lp-hl]').forEach(function(d) { d.classList.remove('selected'); });
                    dot.classList.add('selected');
                    _presenterCtx.highlightColor = color;
                });
            }
        });

        // Dictionary panel
        document.getElementById('lp-dict-toggle').addEventListener('click', function() { _toggleDict(); });
        document.getElementById('lp-dict-search').addEventListener('click', function() {
            var q = document.getElementById('lp-dict-input').value.trim();
            if (q) _searchDict(q);
        });
        document.getElementById('lp-dict-input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                var q = e.target.value.trim();
                if (q) _searchDict(q);
            }
        });

        // Dictionary tab switching
        if (!_presenterCtx.lpDictEngine) _presenterCtx.lpDictEngine = 'milson';
        document.querySelectorAll('.lp-dict-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                _presenterCtx.lpDictEngine = tab.dataset.engine;
                document.querySelectorAll('.lp-dict-tab').forEach(function(t) {
                    var isActive = t.dataset.engine === _presenterCtx.lpDictEngine;
                    t.style.background = isActive ? '#0d9488' : '#f8fafc';
                    t.style.color = isActive ? 'white' : '#64748b';
                });
                if (tab.dataset.engine === 'media') {
                    // Show MediaStorage warehouse in results area — pass lesson title so lesson folder shows at top
                    var results = document.getElementById('lp-dict-results');
                    if (results && typeof MediaStorage !== 'undefined' && MediaStorage.renderDictMediaTab) {
                        MediaStorage.renderDictMediaTab(results, lesson.title);
                    }
                } else {
                    var q = document.getElementById('lp-dict-input').value.trim();
                    if (q) _searchDict(q);
                }
            });
        });

        // Long-press for range selection in highlight mode (mouse + touch)
        var _hlLongPressTimer = null;
        var _hlRangeStart = null;
        var _hlRangeEnd = null;
        var viewport = presenter.querySelector('.lp-viewport');

        function _hlClearVisualIndicators() {
            viewport.querySelectorAll('.diacritics-word').forEach(function(w) {
                w.style.outline = '';
                w.style.borderRadius = '';
                w.style.cursor = '';
                w.style.background = '';
            });
        }

        function _hlShowRangePreview(endWord) {
            if (!_hlRangeStart) return;
            _hlRangeEnd = endWord;
            var allWords = Array.from(viewport.querySelectorAll('.diacritics-word'));
            var startIdx = allWords.indexOf(_hlRangeStart);
            var endIdx = allWords.indexOf(endWord);
            if (startIdx < 0 || endIdx < 0) return;
            var from = Math.min(startIdx, endIdx);
            var to = Math.max(startIdx, endIdx);
            allWords.forEach(function(w, i) {
                if (i >= from && i <= to) {
                    w.style.outline = '2px solid #3b82f6';
                    w.style.background = 'rgba(59,130,246,0.15)';
                } else {
                    w.style.outline = '2px solid rgba(59,130,246,0.4)';
                    w.style.background = '';
                }
            });
        }

        function _hlApplyRange() {
            var endWord = _hlRangeEnd || _hlRangeStart;
            if (endWord && endWord !== _hlRangeStart) {
                var allWords = Array.from(viewport.querySelectorAll('.diacritics-word'));
                var startIdx = allWords.indexOf(_hlRangeStart);
                var endIdx = allWords.indexOf(endWord);
                if (startIdx > -1 && endIdx > -1) {
                    var from = Math.min(startIdx, endIdx);
                    var to = Math.max(startIdx, endIdx);
                    var range = document.createRange();
                    range.setStartBefore(allWords[from]);
                    range.setEndAfter(allWords[to]);
                    var sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    _applyHighlight();
                    _hlRangeJustApplied = true;
                }
            }
            _hlClearVisualIndicators();
            _hlRangeStart = null;
            _hlRangeEnd = null;
            _hlLongPressTimer = null;
        }

        function _hlStartLongPress(wordEl) {
            _hlLongPressTimer = setTimeout(function() {
                _hlLongPressTimer = 'fired';
                _hlRangeStart = wordEl;
                _hlRangeEnd = null;
                viewport.querySelectorAll('.diacritics-word').forEach(function(w) {
                    w.style.outline = '2px solid rgba(59,130,246,0.4)';
                    w.style.borderRadius = '3px';
                    w.style.cursor = 'pointer';
                });
                wordEl.style.outline = '2px solid #3b82f6';
                wordEl.style.background = 'rgba(59,130,246,0.15)';
            }, 500);
        }

        function _hlCancelLongPress() {
            if (_hlLongPressTimer && _hlLongPressTimer !== 'fired') {
                clearTimeout(_hlLongPressTimer);
                _hlLongPressTimer = null;
            }
        }

        // Mouse events
        viewport.addEventListener('mousedown', function(e) {
            if (_presenterCtx.currentTool !== 'highlight') return;
            var wordEl = e.target.closest('.diacritics-word');
            if (!wordEl) return;
            _hlStartLongPress(wordEl);
        });
        viewport.addEventListener('mousemove', function(e) {
            if (_hlLongPressTimer !== 'fired' || !_hlRangeStart) return;
            var wordEl = e.target.closest('.diacritics-word');
            if (wordEl) _hlShowRangePreview(wordEl);
        });
        viewport.addEventListener('mouseup', function(e) {
            if (_hlLongPressTimer === 'fired' && _hlRangeStart) {
                var wordEl = e.target.closest('.diacritics-word');
                if (wordEl) _hlRangeEnd = wordEl;
                _hlApplyRange();
                return;
            }
            _hlCancelLongPress();
        });
        viewport.addEventListener('mouseleave', function() {
            _hlCancelLongPress();
        });

        // Touch events (mirror mouse behavior)
        viewport.addEventListener('touchstart', function(e) {
            if (_presenterCtx.currentTool !== 'highlight') return;
            var touch = e.touches[0];
            var wordEl = document.elementFromPoint(touch.clientX, touch.clientY);
            if (wordEl) wordEl = wordEl.closest('.diacritics-word');
            if (!wordEl) return;
            _hlStartLongPress(wordEl);
        }, { passive: true });
        viewport.addEventListener('touchmove', function(e) {
            if (_hlLongPressTimer !== 'fired' || !_hlRangeStart) {
                // If still waiting for long-press and finger moved, cancel
                _hlCancelLongPress();
                return;
            }
            e.preventDefault(); // prevent scroll during range selection
            var touch = e.touches[0];
            var wordEl = document.elementFromPoint(touch.clientX, touch.clientY);
            if (wordEl) wordEl = wordEl.closest('.diacritics-word');
            if (wordEl) _hlShowRangePreview(wordEl);
        }, { passive: false });
        viewport.addEventListener('touchend', function(e) {
            if (_hlLongPressTimer === 'fired' && _hlRangeStart) {
                _hlApplyRange();
                return;
            }
            _hlCancelLongPress();
        });

        // Highlight on mouseup when highlight tool active, translate on mouseup
        var _hlRangeJustApplied = false;
        viewport.addEventListener('mouseup', function(e) {
            if (_hlRangeJustApplied) { _hlRangeJustApplied = false; return; }
            if (_presenterCtx.currentTool === 'highlight') {
                var sel = window.getSelection();
                // If no text selected (just clicked), select the word under cursor
                if (sel && sel.isCollapsed && !_hlRangeStart) {
                    // Try caretRangeFromPoint for reliable text node detection
                    var node = null, offset = 0;
                    if (document.caretRangeFromPoint) {
                        var cr = document.caretRangeFromPoint(e.clientX, e.clientY);
                        if (cr) { node = cr.startContainer; offset = cr.startOffset; }
                    }
                    if (!node) { node = sel.anchorNode; offset = sel.anchorOffset; }
                    // If we hit an element, try its first text child
                    if (node && node.nodeType !== 3 && node.childNodes.length > 0) {
                        for (var ci = 0; ci < node.childNodes.length; ci++) {
                            if (node.childNodes[ci].nodeType === 3 && node.childNodes[ci].textContent.trim()) {
                                node = node.childNodes[ci]; offset = 0; break;
                            }
                        }
                    }
                    if (node && node.nodeType === 3 && node.textContent.trim()) {
                        var text = node.textContent;
                        var start = offset, end = offset;
                        while (start > 0 && text[start - 1] !== ' ') start--;
                        while (end < text.length && text[end] !== ' ') end++;
                        if (start < end) {
                            var range = document.createRange();
                            range.setStart(node, start);
                            range.setEnd(node, end);
                            sel.removeAllRanges();
                            sel.addRange(range);
                        }
                    }
                }
                _applyHighlight();
            } else if (_presenterCtx.currentTool === 'analyze' || _presenterCtx.currentTool === 'hindus') {
                var captureMode = _presenterCtx.currentTool;
                var sel = window.getSelection();
                if (sel && !sel.isCollapsed) {
                    var text = sel.toString().trim();
                    if (text) {
                        sel.removeAllRanges();
                        _showAnalyzeConfirm(text, captureMode);
                    }
                }
            } else if (_presenterCtx.currentTool === 'translate') {
                // Selection-only mode: user selects/highlights text → search in dictionary
                var sel = window.getSelection();
                if (sel && !sel.isCollapsed) {
                    var text = sel.toString().trim().replace(/[\u064B-\u065F\u0670]/g, '').replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '');
                    if (text) {
                        if (typeof Dictionary !== 'undefined') { Dictionary.lookup(text); _onDictToggle(true); }
                        else { _toggleDict(true); var dictInput = document.getElementById('lp-dict-input'); if (dictInput) { dictInput.value = text; _searchDict(text); } }
                    }
                    sel.removeAllRanges();
                }
            }
        });

        // א→ע button (Hebrew to Arabic conversion)
        document.getElementById('lp-dict-heb2ar').addEventListener('click', function() {
            var input = document.getElementById('lp-dict-input');
            if (input && typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                input.value = DetailsPanel._convertHebrewToArabic(input.value);
            }
        });

        // Ctrl+G in dictionary input
        document.getElementById('lp-dict-input').addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                    e.target.value = DetailsPanel._convertHebrewToArabic(e.target.value);
                }
            }
        });
    }

    function _activateTool(tool) {
        _deactivateTool();
        _presenterCtx.currentTool = tool;

        // Update button states
        var presenter = document.getElementById('lesson-viewer');
        presenter.querySelectorAll('.lp-tool-btn').forEach(function(b) { b.classList.remove('active'); });
        var activeBtn = presenter.querySelector('[data-lp-tool="' + tool + '"]');
        if (activeBtn) activeBtn.classList.add('active');

        // Add mode class for CSS hover rules
        presenter.className = presenter.className.replace(/\blp-mode-\S+/g, '').trim();
        presenter.classList.add('lp-mode-' + tool);

        var canvas = document.getElementById('lp-canvas');

        if (tool === 'draw') {
            canvas.classList.remove('visible');
            canvas.classList.add('active');
            document.getElementById('lp-draw-palette').classList.add('show');
        } else if (tool === 'highlight') {
            document.getElementById('lp-hl-palette').classList.add('show');
            var viewport = document.querySelector('.lp-viewport');
            if (viewport) viewport.style.setProperty('--highlight-color', _getHighlightRgba(_presenterCtx.highlightColor));
        } else if (tool === 'diacritics') {
            _activateDiacritics();
        }
    }

    function _deactivateTool() {
        _presenterCtx.currentTool = null;
        var presenter = document.getElementById('lesson-viewer');
        if (!presenter) return;

        // Remove all mode classes
        presenter.className = presenter.className.replace(/\blp-mode-\S+/g, '').trim();

        presenter.querySelectorAll('.lp-tool-btn').forEach(function(b) { b.classList.remove('active'); });
        var ptrBtn = presenter.querySelector('[data-lp-tool="pointer"]');
        if (ptrBtn) ptrBtn.classList.add('active');

        var canvas = document.getElementById('lp-canvas');
        if (canvas) { canvas.classList.remove('active'); canvas.classList.add('visible'); }

        document.getElementById('lp-draw-palette') && document.getElementById('lp-draw-palette').classList.remove('show');
        document.getElementById('lp-hl-palette') && document.getElementById('lp-hl-palette').classList.remove('show');

        if (_presenterCtx.diacriticsActive) _deactivateDiacritics();
    }

    // --- Drawing ---
    var _windowResizeBound = false;

    function _initCanvas() {
        var canvas = document.getElementById('lp-canvas');
        var viewport = document.getElementById('lp-viewport');
        if (!canvas || !viewport) return;

        // Size canvas to full scrollable area
        canvas.width = viewport.offsetWidth;
        canvas.height = Math.max(viewport.scrollHeight, viewport.offsetHeight);
        canvas.classList.add('visible');

        var ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Attach pointer listeners to this canvas instance (the canvas DOM
        // element is rebuilt every time _buildPresenter runs, so a module-
        // level flag would skip wiring on every re-entry — drawing tool
        // appears dead from the second lesson view onwards).
        if (!canvas._lpListenersAttached) {
            canvas._lpListenersAttached = true;
            canvas.addEventListener('mousedown', function(e) { _drawStart(e); });
            canvas.addEventListener('mousemove', function(e) { _drawMove(e); });
            canvas.addEventListener('mouseup', function() { _drawEnd(); });
            canvas.addEventListener('mouseleave', function() { _drawEnd(); });
            canvas.addEventListener('touchstart', function(e) { e.preventDefault(); _drawStart(e.touches[0]); }, { passive: false });
            canvas.addEventListener('touchmove', function(e) { e.preventDefault(); _drawMove(e.touches[0]); }, { passive: false });
            canvas.addEventListener('touchend', function() { _drawEnd(); });
        }

        // Window resize listener is bound at most once (window survives
        // viewer rebuilds; binding again would multiply the handler).
        if (!_windowResizeBound) {
            _windowResizeBound = true;
            window.addEventListener('resize', function() {
                var c = document.getElementById('lp-canvas');
                var v = document.getElementById('lp-viewport');
                if (c && v) {
                    c.width = v.offsetWidth;
                    c.height = Math.max(v.scrollHeight, v.offsetHeight);
                    _redrawStrokes();
                }
            });
        }

        // Redraw existing strokes
        _redrawStrokes();
    }

    function _getDrawCoords(e) {
        var canvas = document.getElementById('lp-canvas');
        var viewport = document.getElementById('lp-viewport');
        if (!canvas || !viewport) return { x: 0, y: 0 };
        var rect = canvas.getBoundingClientRect();
        // Scale from CSS pixels to canvas buffer pixels (handles dictionary panel resize)
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY + (viewport.scrollTop * scaleY)
        };
    }

    function _eraseStrokeAt(x, y) {
        var pageIdx = _viewerState.currentPage;
        var strokes = _presenterCtx.slideStrokes[pageIdx];
        if (!strokes) return false;
        var threshold = 15;
        for (var i = strokes.length - 1; i >= 0; i--) {
            if (strokes[i].color === 'eraser') continue;
            for (var j = 0; j < strokes[i].points.length; j++) {
                var p = strokes[i].points[j];
                if (Math.abs(p.x - x) < threshold && Math.abs(p.y - y) < threshold) {
                    strokes.splice(i, 1);
                    _redrawStrokes();
                    return true;
                }
            }
        }
        return false;
    }

    function _drawStart(e) {
        if (_presenterCtx.currentTool !== 'draw') return;
        var canvas = document.getElementById('lp-canvas');
        if (!canvas) return;
        _presenterCtx.drawing = true;
        var pos = _getDrawCoords(e);
        var ctx = canvas.getContext('2d');

        if (_presenterCtx.isEraser) {
            _eraseStrokeAt(pos.x, pos.y);
            _presenterCtx.currentStroke = null;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = _presenterCtx.drawColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            _presenterCtx.currentStroke = {
                color: _presenterCtx.drawColor,
                width: 3,
                points: [{ x: pos.x, y: pos.y }]
            };
        }
    }

    function _drawMove(e) {
        if (!_presenterCtx.drawing) return;
        var canvas = document.getElementById('lp-canvas');
        if (!canvas) return;
        var pos = _getDrawCoords(e);

        if (_presenterCtx.isEraser) {
            _eraseStrokeAt(pos.x, pos.y);
            return;
        }
        if (!_presenterCtx.currentStroke) return;
        var ctx = canvas.getContext('2d');
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        _presenterCtx.currentStroke.points.push({ x: pos.x, y: pos.y });
    }

    function _drawEnd() {
        if (!_presenterCtx.drawing) return;
        _presenterCtx.drawing = false;
        var pageIdx = _viewerState.currentPage;
        if (_presenterCtx.currentStroke && _presenterCtx.currentStroke.points.length > 1) {
            if (!_presenterCtx.slideStrokes[pageIdx]) _presenterCtx.slideStrokes[pageIdx] = [];
            _presenterCtx.slideStrokes[pageIdx].push(_presenterCtx.currentStroke);
            _lessonActivity = true;
            _presenterCtx.redoStack = [];
            _presenterCtx.undoStack.push({ type: 'stroke', pageIdx: pageIdx });
            _saveLessonRuntimeState(_viewerState.lessonId);
        }
        _presenterCtx.currentStroke = null;
    }

    function _redrawStrokes() {
        var canvas = document.getElementById('lp-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        var strokes = _presenterCtx.slideStrokes[_viewerState.currentPage] || [];
        strokes.forEach(function(s) {
            if (s.color === 'eraser') return; // skip legacy eraser strokes
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (s.points.length > 0) {
                ctx.moveTo(s.points[0].x, s.points[0].y);
                for (var i = 1; i < s.points.length; i++) {
                    ctx.lineTo(s.points[i].x, s.points[i].y);
                }
                ctx.stroke();
            }
        });
    }

    // --- Highlight ---
    function _getHighlightRgba(color) {
        var map = { yellow: 'rgba(255,235,59,0.5)', green: 'rgba(76,175,80,0.45)', blue: 'rgba(66,165,245,0.45)', pink: 'rgba(236,64,122,0.4)', orange: 'rgba(255,152,0,0.5)' };
        return map[color] || map.yellow;
    }

    function _applyHighlight() {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        var range = sel.getRangeAt(0);
        var viewport = document.querySelector('.lp-viewport');
        if (!viewport || !viewport.contains(range.commonAncestorContainer)) return;

        // First remove any existing highlights in this range
        var container = range.commonAncestorContainer;
        if (container.nodeType === 3) container = container.parentNode;
        var existingHighlights = [];
        if (container.querySelectorAll) {
            container.querySelectorAll('.user-highlight').forEach(function(h) {
                if (sel.containsNode(h, true)) existingHighlights.push(h);
            });
        }
        if (container.classList && container.classList.contains('user-highlight')) {
            existingHighlights.push(container);
        }
        existingHighlights.forEach(function(h) {
            var parent = h.parentNode;
            while (h.firstChild) parent.insertBefore(h.firstChild, h);
            parent.removeChild(h);
            parent.normalize(); // merge adjacent text nodes
        });

        // Re-get selection after DOM changes
        sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        range = sel.getRangeAt(0);

        var color = _presenterCtx.highlightColor;
        // BUG 4 fix: if 'clear' is selected, just remove existing highlights (already done above) and stop
        if (color === 'clear') {
            _lessonActivity = true;
            sel.removeAllRanges();
            _saveSlideHighlights();
            _saveLessonRuntimeState(_viewerState.lessonId);
            return;
        }
        var span = document.createElement('span');
        span.className = 'user-highlight user-highlight-' + color;
        try {
            range.surroundContents(span);
            _presenterCtx.redoStack = [];
            _presenterCtx.undoStack.push({ type: 'highlight', element: span });
        } catch (e) {
            // Range spans multiple elements — fallback
        }
        sel.removeAllRanges();
        _saveSlideHighlights();
        _saveLessonRuntimeState(_viewerState.lessonId);
    }

    function _clearHighlightSelection() {
        _lessonActivity = true;
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        var range = sel.getRangeAt(0);
        var container = range.commonAncestorContainer;
        if (container.nodeType === 3) container = container.parentNode;
        var highlights = [];
        if (container.classList && container.classList.contains('user-highlight')) {
            highlights.push(container);
        } else {
            container.querySelectorAll && container.querySelectorAll('.user-highlight').forEach(function(h) {
                if (sel.containsNode(h, true)) highlights.push(h);
            });
        }
        highlights.forEach(function(h) {
            var parent = h.parentNode;
            while (h.firstChild) parent.insertBefore(h.firstChild, h);
            parent.removeChild(h);
        });
        sel.removeAllRanges();
        _saveSlideHighlights();
        _saveLessonRuntimeState(_viewerState.lessonId);
    }

    function _clearAllHighlights() {
        _lessonActivity = true;
        var pageIdx = _viewerState ? _viewerState.currentPage : null;
        if (pageIdx !== null && _presenterCtx) {
            _presenterCtx.slideHighlights[pageIdx] = [];
        }
        var viewport = document.getElementById('lp-viewport');
        if (viewport) {
            viewport.querySelectorAll('.user-highlight').forEach(function(hl) {
                var parent = hl.parentNode;
                while (hl.firstChild) parent.insertBefore(hl.firstChild, hl);
                hl.remove();
            });
        }
        _saveLessonRuntimeState(_viewerState.lessonId);
    }

    // --- Diacritics ---
    var _diacriticsMap = {}; // word stripped → original with diacritics

    function _stripDiacritics(text) {
        // Strip diacritics (tashkeel: U+064B-U+0652, superscript alef U+0670,
        // and the inverted marks U+065C-U+065D — the 'candle' reveal must hide
        // these too) only.
        // Do NOT strip U+0653-U+065B or U+065E-U+065F (hamza/maddah combining marks) — those are part of
        // letter composition and stripping them breaks decomposed alef variants (e.g. decomposed إ = ا + U+0655).
        // Hebrew niqqud (U+05B0-U+05BD, U+05BF, U+05C1-U+05C2, U+05C4-U+05C5, U+05C7) also stripped
        // so candle works on Hebrew-vocalized text \u2014 without this the map gets no stripped key,
        // dataset.original===dataset.stripped, and the click only paints CSS without changing text.
        return text
            .replace(/[\u064B-\u0652\u065C\u065D\u0670]/g, '')
            .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
            .replace(/[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g, '');
    }

    function _buildDiacriticsMap(originalText) {
        // Build map from stripped words to original words
        if (!originalText) return;
        // Strip HTML tags to get clean text for word matching
        var cleanText = originalText.replace(/<[^>]*>/g, ' ');
        var words = cleanText.split(/\s+/);
        words.forEach(function(w) {
            if (!w) return;
            var stripped = _stripDiacritics(w);
            if (stripped !== w) {
                _diacriticsMap[stripped] = w;
            }
        });
    }

    function _activateDiacritics() {
        _presenterCtx.diacriticsActive = true;
        var slide = document.getElementById('lp-slide-content');
        if (!slide) return;
        slide.querySelectorAll('.lp-arabic').forEach(function(el) {
            _wrapWordsForDiacritics(el);
        });
    }

    function _deactivateDiacritics() {
        _presenterCtx.diacriticsActive = false;
    }

    function _wrapWordsForDiacritics(el) {
        if (el.dataset.diacWrapped) return; // don't wrap twice
        el.dataset.diacWrapped = '1';

        // Safety: count words before wrapping
        var preWrapWords = el.textContent.split(/\s+/).filter(function(w) { return w.length > 0; });

        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        var textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        textNodes.forEach(function(node) {
            var text = node.textContent;
            if (!text.trim()) return;
            var frag = document.createDocumentFragment();
            var parts = text.split(/(\s+)/);
            parts.forEach(function(part) {
                if (/^\s+$/.test(part)) {
                    frag.appendChild(document.createTextNode(part));
                } else {
                    var span = document.createElement('span');
                    span.className = 'diacritics-word';
                    var stripped = _stripDiacritics(part);
                    span.textContent = stripped;
                    // Try exact match, then try without trailing punctuation
                    var _origWord = _diacriticsMap[stripped];
                    if (!_origWord) {
                        var noPunct = stripped.replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '');
                        if (noPunct !== stripped && _diacriticsMap[noPunct]) {
                            _origWord = _diacriticsMap[noPunct] + stripped.slice(noPunct.length);
                        }
                    }
                    span.dataset.original = _origWord || part;
                    span.dataset.stripped = stripped;
                    span.addEventListener('click', function() {
                        if (_presenterCtx.currentTool === 'highlight') {
                            if (_presenterCtx.highlightColor === 'clear') {
                                // BUG 4 fix: ✕ reset mode — remove highlight from clicked word
                                var hlParent = span.closest('.user-highlight');
                                if (hlParent) {
                                    var parent = hlParent.parentNode;
                                    while (hlParent.firstChild) parent.insertBefore(hlParent.firstChild, hlParent);
                                    parent.removeChild(hlParent);
                                    parent.normalize();
                                }
                            } else {
                                var range = document.createRange();
                                range.selectNodeContents(span);
                                var sel = window.getSelection();
                                sel.removeAllRanges();
                                sel.addRange(range);
                                _applyHighlight();
                            }
                            return;
                        }
                        if (!_presenterCtx.diacriticsActive) return;
                        // 2-state candle toggle: no-diacritics ↔ diacritics
                        var groupId = span.dataset.wordGroup;
                        var groupSpans = groupId ? document.querySelectorAll('.diacritics-word[data-word-group="' + groupId + '"]') : [span];
                        var isRevealed = span.classList.contains('revealed');
                        Array.prototype.forEach.call(groupSpans, function(gs) {
                            if (!isRevealed) {
                                // Show diacritics
                                gs.textContent = gs.dataset.original;
                                gs.classList.add('revealed');
                                gs.classList.add('diac-shown');
                                gs.dataset.revealState = '1';
                            } else {
                                // Hide diacritics
                                gs.textContent = gs.dataset.stripped;
                                gs.classList.remove('revealed');
                                gs.classList.remove('diac-shown');
                                gs.dataset.revealState = '0';
                            }
                        });
                    });
                    frag.appendChild(span);
                }
            });
            node.parentNode.replaceChild(frag, node);
        });

        // Post-process: merge adjacent .diacritics-word spans not separated by whitespace.
        // Uses Range to check if there's visible whitespace between consecutive spans,
        // which handles formatting tags (<b>, <span>, etc.) splitting a single word.
        var allWordSpans = Array.from(el.querySelectorAll('.diacritics-word'));
        var _wordGroupCounter = (_wordGroupCounter || 0);
        for (var i = allWordSpans.length - 1; i > 0; i--) {
            var cur = allWordSpans[i];
            var prev = allWordSpans[i - 1];
            // Check for whitespace between prev and cur using a Range
            var shouldMerge = false;
            try {
                var range = document.createRange();
                range.setStartAfter(prev);
                range.setEndBefore(cur);
                var between = range.cloneContents();
                var betweenText = between.textContent;
                // Merge if NO text and no block/break elements between them
                // (formatting tags like <b>, <span> are OK — they don't separate words)
                shouldMerge = betweenText === '' && !between.querySelector('br, div, p, hr, table, ul, ol, li');
            } catch(e) { /* different parents — don't merge */ }
            if (shouldMerge) {
                var mergedStripped = (prev.dataset.stripped || '') + (cur.dataset.stripped || '');
                var mergedOriginal = (prev.dataset.original || '') + (cur.dataset.original || '');
                var mapEntry = _diacriticsMap[mergedStripped];
                if (!mapEntry) {
                    var noPunct = mergedStripped.replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '');
                    if (noPunct !== mergedStripped && _diacriticsMap[noPunct]) {
                        mapEntry = _diacriticsMap[noPunct] + mergedStripped.slice(noPunct.length);
                    }
                }
                if (prev.parentNode === cur.parentNode) {
                    // Same parent — safe to merge text into one span
                    prev.textContent = mergedStripped;
                    prev.dataset.stripped = mergedStripped;
                    prev.dataset.original = mapEntry || mergedOriginal;
                    cur.parentNode.removeChild(cur);
                } else {
                    // Different parents (different formatting contexts) — link as word group
                    // to preserve inline formatting (bold, color, etc.)
                    var groupId = cur.dataset.wordGroup || prev.dataset.wordGroup || ('wg-' + (++_wordGroupCounter));
                    prev.dataset.wordGroup = groupId;
                    cur.dataset.wordGroup = groupId;
                    // Store merged data for diacritics/translate on each span in the group
                    prev.dataset.groupStripped = mergedStripped;
                    cur.dataset.groupStripped = mergedStripped;
                    if (mapEntry) {
                        prev.dataset.groupOriginal = mapEntry;
                        cur.dataset.groupOriginal = mapEntry;
                    }
                }
            }
        }

        // Safety check: if wrapping lost words, unwrap and fall back to raw text
        var postWrapWords = el.textContent.split(/\s+/).filter(function(w) { return w.length > 0; });
        if (postWrapWords.length < preWrapWords.length) {
            console.warn('[Plonter] _wrapWordsForDiacritics lost words: before=' + preWrapWords.length + ' after=' + postWrapWords.length + '. Unwrapping.');
            // Unwrap: replace each diacritics-word span with its text content
            el.querySelectorAll('.diacritics-word').forEach(function(span) {
                span.replaceWith(span.textContent);
            });
            el.normalize();
            delete el.dataset.diacWrapped;
        }
    }

    function _revealAllDiacritics() {
        document.querySelectorAll('.lesson-presenter .diacritics-word').forEach(function(span) {
            span.textContent = span.dataset.original || span.textContent;
            span.classList.add('revealed');
            span.classList.add('diac-shown');
            span.dataset.revealState = '1';
        });
    }

    function _hideAllDiacritics() {
        document.querySelectorAll('.lesson-presenter .diacritics-word').forEach(function(span) {
            span.textContent = span.dataset.stripped || span.textContent;
            span.classList.remove('revealed');
            span.classList.remove('diac-shown');
            span.dataset.revealState = '0';
        });
    }

    function _revealAllQmarks() {
        _currentQmarkData.forEach(function(item) {
            var el = document.getElementById(item.id);
            if (!el || el.classList.contains('revealed')) return;
            el.classList.add('revealed');
            el.style.cssText = '';
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalStripped) + '</span>';
            el._qmarkRevealState = 1;
        });
    }

    function _hideAllQmarks() {
        _currentQmarkData.forEach(function(item) {
            var el = document.getElementById(item.id);
            if (!el || !el.classList.contains('revealed')) return;
            el.classList.remove('revealed');
            if (item.guess) {
                el.style.cssText = 'display:inline-block;min-width:80px;text-align:center;padding:0 6px;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;cursor:pointer;color:#1e40af;vertical-align:baseline;font-size:1em;line-height:1.3;box-sizing:border-box';
                el.textContent = item.guess;
            } else {
                el.style.cssText = 'display:inline-block;min-width:80px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:4px;padding:0 6px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.3;box-sizing:border-box';
                el.textContent = '?';
            }
            el._qmarkRevealState = 0;
        });
    }

    // --- Dictionary ---
    function _toggleDict(forceOpen) {
        // Use unified Dictionary panel
        if (typeof Dictionary !== 'undefined') {
            if (forceOpen || !(Dictionary._panel && Dictionary._panel.classList.contains('show'))) {
                Dictionary.openStandalone();
                _onDictToggle(true);
                // Transfer inline audio player to dict panel if playing
                _transferAudioToDict();
            } else {
                Dictionary._hidePanel();
                _onDictToggle(false);
            }
            return;
        }
        // Fallback to old panel
        var panel = document.getElementById('lp-dict-panel');
        var toggle = document.getElementById('lp-dict-toggle');
        var body = document.querySelector('.lesson-presenter .lp-body');
        if (!panel) return;

        if (forceOpen === true || !panel.classList.contains('show')) {
            panel.classList.add('show');
            if (toggle) toggle.classList.add('open');
            if (body) body.classList.add('dict-open');
            _presenterCtx.dictOpen = true;
            _onDictToggle(true);
            // If audio playing, move player to dict media tab
            _transferAudioToDict();
            var di = document.getElementById('lp-dict-input');
            if (di) di.focus();
        } else {
            panel.classList.remove('show');
            if (toggle) toggle.classList.remove('open');
            if (body) body.classList.remove('dict-open');
            _presenterCtx.dictOpen = false;
            _onDictToggle(false);
        }
        // Resize drawing canvas to match new viewport dimensions after dict panel toggle
        _resizeCanvasToViewport();
    }

    function _transferAudioToDict() {
        var player = document.getElementById('media-audio-inline');
        var audio = document.getElementById('media-audio-el');
        if (!player || !audio) return;

        // Save current playback state
        var currentTime = audio.currentTime;
        var wasPaused = audio.paused;

        // Switch to Milson tab (default dictionary), keep audio player persistent
        setTimeout(function() {
            var milsonTab = document.querySelector('.lp-dict-tab[data-engine="milson"]') ||
                            document.querySelector('.dict-tab[data-engine="milson"]');
            if (milsonTab) milsonTab.click();

            // Move player to dict results area (persistent above results)
            setTimeout(function() {
                var target = document.getElementById('lp-dict-results') ||
                             document.querySelector('.dict-media-tab-content');
                if (target && player.parentNode !== target) {
                    target.insertBefore(player, target.firstChild);
                    // Restore playback position
                    audio.currentTime = currentTime;
                    if (!wasPaused) audio.play();
                }
            }, 150);
        }, 100);
    }

    function _resizeCanvasToViewport() {
        var canvas = document.getElementById('lp-canvas');
        var viewport = document.getElementById('lp-viewport');
        if (!canvas || !viewport) return;
        // Use requestAnimationFrame to let CSS layout settle after panel toggle
        requestAnimationFrame(function() {
            canvas.width = viewport.offsetWidth;
            canvas.height = Math.max(viewport.scrollHeight, viewport.offsetHeight);
            _redrawStrokes();
        });
    }

    function _searchDict(word) {
        var results = document.getElementById('lp-dict-results');
        if (!results) return;
        word = word.replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '').trim();
        if (!word) return;
        var engine = (_presenterCtx && _presenterCtx.lpDictEngine) || 'milson';

        if (engine === 'spoken') {
            var cleanWord = word.replace(/[\u064B-\u065F\u0670]/g, '');
            var hebrewWord = (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertArabicToHebrew) ? DetailsPanel._convertArabicToHebrew(cleanWord) : cleanWord;
            var url = 'https://milon.madrasafree.com/?searchString=' + encodeURIComponent(hebrewWord);
            results.innerHTML = '<div style="display:flex;flex-direction:column;height:100%"><iframe src="' + url + '" style="width:100%;flex:1;min-height:350px;border:none;border-radius:8px"></iframe><a href="' + url + '" target="_blank" style="text-align:center;padding:8px;font-size:0.9em;color:#0d9488;text-decoration:none;font-weight:bold">פתח במדרסה פרי ←</a></div>';
            return;
        }

        if (engine === 'ai') {
            results.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280">AI מחפש...</div>';
            if (typeof Dictionary !== 'undefined' && Dictionary._searchAI) {
                Dictionary._searchAI(word);
            }
            return;
        }

        results.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280">טוען...</div>';
        if (typeof Dictionary !== 'undefined' && Dictionary._proxyUrl) {
            fetch(Dictionary._milsonSearchUrl ? Dictionary._milsonSearchUrl(word, 1) : Dictionary._proxyUrl + '?q=' + encodeURIComponent(word) + '&mode=1')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    results.innerHTML = '';
                    if (data.error) {
                        results.innerHTML = '<div style="color:#dc2626;padding:12px">שגיאה: ' + data.error + '</div>';
                        return;
                    }
                    if (!data.entries || data.entries.length === 0) {
                        if (word.indexOf('\u0627\u0644') === 0 && word.length > 2) {
                            _searchDict(word.substring(2));
                            return;
                        }
                        results.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af">אין תוצאות עבור "' + word + '"</div>';
                        return;
                    }
                    data.entries.forEach(function(entry, i) {
                        Dictionary._renderEntry(results, entry, i === 0);
                    });
                })
                .catch(function(err) {
                    results.innerHTML = '<div style="color:#dc2626;padding:12px">שגיאת רשת: ' + err.message + '</div>';
                });
        }
    }

    // --- Analyze confirmation ---
    function _showAnalyzeConfirm(text, mode) {
        mode = mode || 'analyze';
        var isHindus = mode === 'hindus';
        var color = isHindus ? '#ea580c' : '#0d9488';
        var title = isHindus ? 'להנדס את הטקסט?' : 'לנתח את הטקסט?';
        var btnText = isHindus ? 'כן, הנדס' : 'כן, נתח';
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:700;display:flex;justify-content:center;align-items:center';
        overlay.innerHTML =
            '<div style="background:white;border-radius:14px;padding:24px;max-width:500px;width:90%;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.2)">' +
                '<h3 style="color:' + color + ';margin-bottom:12px">' + title + '</h3>' +
                '<div style="font-family:Times New Roman,serif;font-size:1.3em;direction:rtl;background:#f0fdfa;padding:12px;border-radius:8px;margin:12px 0;line-height:1.8">' + escapeHtml(text) + '</div>' +
                '<div style="display:flex;gap:8px;justify-content:center;margin-top:16px">' +
                    '<button id="lp-analyze-yes" style="padding:10px 24px;border-radius:8px;font-size:1em;font-weight:bold;cursor:pointer;border:2px solid ' + color + ';background:' + color + ';color:white;font-family:inherit">' + btnText + '</button>' +
                    '<button id="lp-analyze-no" style="padding:10px 24px;border-radius:8px;font-size:1em;font-weight:bold;cursor:pointer;border:2px solid ' + color + ';background:white;color:' + color + ';font-family:inherit">ביטול</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        document.getElementById('lp-analyze-no').addEventListener('click', function() { overlay.remove(); });
        // No backdrop click handler — closes only via Yes or Cancel buttons
        document.getElementById('lp-analyze-yes').addEventListener('click', function() {
            overlay.remove();
            _loadPageIntoApp({ content: text, title: '', notes: '' }, mode);
        });
    }

    // --- Undo / Redo ---
    function _presenterUndo() {
        if (_presenterCtx.undoStack.length === 0) return;
        var action = _presenterCtx.undoStack.pop();
        if (action.type === 'stroke') {
            var strokes = _presenterCtx.slideStrokes[action.pageIdx];
            var removed = strokes ? strokes.pop() : null;
            _presenterCtx.redoStack.push({ type: 'stroke', pageIdx: action.pageIdx, strokeData: removed });
            _redrawStrokes();
        } else if (action.type === 'highlight' && action.element) {
            var el = action.element;
            var parent = el.parentNode;
            var nextSib = el.nextSibling;
            if (parent) {
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
            }
            _presenterCtx.redoStack.push({ type: 'highlight', element: el, parent: parent, nextSibling: nextSib });
        } else if (action.type === 'qmark' && action.el) {
            var curState = { type: 'qmark', el: action.el, prevState: action.el._qmarkRevealState, prevLastVisible: action.el._qmarkLastVisibleState || 0, prevHtml: action.el.innerHTML, prevStyle: action.el.style.cssText, prevClass: action.el.classList.contains('revealed') };
            action.el.innerHTML = action.prevHtml;
            action.el.style.cssText = action.prevStyle;
            action.el._qmarkRevealState = action.prevState;
            action.el._qmarkLastVisibleState = action.prevLastVisible;
            if (action.prevClass) {
                action.el.classList.add('revealed');
            } else {
                action.el.classList.remove('revealed');
            }
            _presenterCtx.redoStack.push(curState);
        }
    }

    function _presenterRedo() {
        if (_presenterCtx.redoStack.length === 0) return;
        var action = _presenterCtx.redoStack.pop();
        if (action.type === 'stroke' && action.strokeData) {
            var strokes = _presenterCtx.slideStrokes[action.pageIdx];
            if (!strokes) { strokes = []; _presenterCtx.slideStrokes[action.pageIdx] = strokes; }
            strokes.push(action.strokeData);
            _presenterCtx.undoStack.push({ type: 'stroke', pageIdx: action.pageIdx });
            _redrawStrokes();
        } else if (action.type === 'highlight' && action.element && action.parent) {
            // Re-wrap the text nodes back into the highlight span
            var el = action.element;
            if (action.nextSibling && action.parent.contains(action.nextSibling)) {
                action.parent.insertBefore(el, action.nextSibling);
            } else {
                action.parent.appendChild(el);
            }
            _presenterCtx.undoStack.push({ type: 'highlight', element: el });
        } else if (action.type === 'qmark' && action.el) {
            var curState = { type: 'qmark', el: action.el, prevState: action.el._qmarkRevealState, prevLastVisible: action.el._qmarkLastVisibleState || 0, prevHtml: action.el.innerHTML, prevStyle: action.el.style.cssText, prevClass: action.el.classList.contains('revealed') };
            action.el.innerHTML = action.prevHtml;
            action.el.style.cssText = action.prevStyle;
            action.el._qmarkRevealState = action.prevState;
            action.el._qmarkLastVisibleState = action.prevLastVisible;
            if (action.prevClass) {
                action.el.classList.add('revealed');
            } else {
                action.el.classList.remove('revealed');
            }
            _presenterCtx.undoStack.push(curState);
        }
    }

    // --- Navigation ---
    function _saveQmarkGuesses() {
        if (!_viewerState || !_currentQmarkData.length) return;
        var cache = {};
        _currentQmarkData.forEach(function(item, idx) {
            if (item.guess || (document.getElementById(item.id) && document.getElementById(item.id)._qmarkRevealState)) {
                var el = document.getElementById(item.id);
                cache[idx] = { guess: item.guess || '', revealState: (el && el._qmarkRevealState) || 0 };
            }
        });
        if (Object.keys(cache).length > 0) {
            _qmarkGuessCache[_viewerState.currentPage] = cache;
            _lessonActivity = true;
        }
    }

    function _persistQmarkCache() {
        if (!_viewerState) return;
        try {
            var key = 'plonter_qmark_' + _viewerState.lessonId;
            if (Object.keys(_qmarkGuessCache).length > 0) {
                localStorage.setItem(key, JSON.stringify(_qmarkGuessCache));
            } else {
                localStorage.removeItem(key);
            }
            _saveLessonRuntimeState(_viewerState.lessonId);
        } catch (e) {}
    }

    function _loadQmarkCache() {
        if (!_viewerState) return;
        try {
            var key = 'plonter_qmark_' + _viewerState.lessonId;
            var data = localStorage.getItem(key);
            if (data) _qmarkGuessCache = JSON.parse(data);
        } catch (e) {}
    }

    function _restoreQmarkGuesses() {
        if (!_viewerState || !_currentQmarkData.length) return;
        var cache = _qmarkGuessCache[_viewerState.currentPage];
        if (!cache) return;
        _currentQmarkData.forEach(function(item, idx) {
            var saved = cache[idx];
            if (!saved) return;
            item.guess = saved.guess;
            var el = document.getElementById(item.id);
            if (!el) return;
            if (saved.revealState > 0) {
                // Restore revealed state
                el.classList.add('revealed');
                el.style.cssText = '';
                if (saved.revealState === 1) {
                    el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalStripped) + '</span>';
                } else {
                    el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalWithDiacritics) + '</span>';
                }
                el._qmarkRevealState = saved.revealState;
            } else if (saved.guess) {
                // Restore guess text on placeholder
                el.style.cssText = 'display:inline-block;min-width:80px;text-align:center;padding:0 6px;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;cursor:pointer;color:#1e40af;vertical-align:baseline;font-size:1em;line-height:1.3;box-sizing:border-box';
                el.textContent = saved.guess;
            }
        });
    }

    function _saveVerbAnalysisGuesses() {
        if (!_viewerState) return;
        var table = document.getElementById('va-table');
        if (!table) return;
        var cache = {};
        table.querySelectorAll('tbody tr[data-row]').forEach(function(tr) {
            var ri = tr.getAttribute('data-row');
            var entry = {
                root:     (tr.querySelector('.va-root-input')     || {}).value || '',
                binyan:   (tr.querySelector('.va-binyan-input')   || {}).value || '',
                tense:    (tr.querySelector('.va-tense-select')   || {}).value || '',
                passive:  !!(tr.querySelector('.va-passive-cb')   || {}).checked,
                person:   (tr.querySelector('.va-person-select')  || {}).value || '',
                pronoun:  (tr.querySelector('.va-pronoun-select') || {}).value || '',
                translate:(tr.querySelector('.va-translate-input')|| {}).value || ''
            };
            // Only persist rows with at least one non-empty field — avoids dumping all-empty
            if (entry.root || entry.binyan || entry.tense || entry.passive ||
                entry.person || entry.pronoun || entry.translate) {
                cache[ri] = entry;
            }
        });
        if (Object.keys(cache).length > 0) {
            _verbAnalysisCache[_viewerState.currentPage] = cache;
            _lessonActivity = true;
        } else {
            delete _verbAnalysisCache[_viewerState.currentPage];
        }
    }

    function _restoreVerbAnalysisGuesses() {
        if (!_viewerState) return;
        var cache = _verbAnalysisCache[_viewerState.currentPage];
        if (!cache) return;
        var table = document.getElementById('va-table');
        if (!table) return;
        Object.keys(cache).forEach(function(ri) {
            var tr = table.querySelector('tbody tr[data-row="' + ri + '"]');
            if (!tr) return;
            var saved = cache[ri];
            var root      = tr.querySelector('.va-root-input');
            var binyan    = tr.querySelector('.va-binyan-input');
            var tense     = tr.querySelector('.va-tense-select');
            var passive   = tr.querySelector('.va-passive-cb');
            var person    = tr.querySelector('.va-person-select');
            var pronoun   = tr.querySelector('.va-pronoun-select');
            var translate = tr.querySelector('.va-translate-input');
            if (root)      root.value = saved.root || '';
            if (binyan)    binyan.value = saved.binyan || '';
            if (tense) {
                tense.value = saved.tense || '';
                // Fire change so dependent UI (passive label, person options) updates
                tense.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (passive && saved.passive) {
                passive.checked = true;
                passive.dispatchEvent(new Event('change', { bubbles: true }));
            }
            // person options are populated by the tense-change handler; restore after
            setTimeout(function() {
                if (person && saved.person) {
                    person.value = saved.person;
                    person.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, 0);
            if (pronoun)   pronoun.value = saved.pronoun || '';
            if (translate) translate.value = saved.translate || '';
        });
    }

    function _saveSlideHighlights() {
        if (!_presenterCtx) return;
        var container = document.getElementById('lp-slide-content');
        if (!container) return;
        var highlights = container.querySelectorAll('.user-highlight');
        if (highlights.length === 0) {
            delete _presenterCtx.slideHighlights[_viewerState.currentPage];
            return;
        }
        // Build index of .lp-arabic elements for tracking which block each highlight belongs to
        var arabicBlocks = Array.prototype.slice.call(container.querySelectorAll('.lp-arabic'));
        var data = [];
        highlights.forEach(function(hl) {
            var arabic = hl.closest('.lp-arabic');
            if (!arabic) return;
            var arabicIdx = arabicBlocks.indexOf(arabic);
            if (arabicIdx === -1) return;
            // Find text offset of this highlight within its arabic container
            var walker = document.createTreeWalker(arabic, NodeFilter.SHOW_TEXT, null, false);
            var offset = 0;
            var startOffset = -1;
            var endOffset = -1;
            var node;
            while (node = walker.nextNode()) {
                if (hl.contains(node)) {
                    if (startOffset === -1) startOffset = offset;
                    endOffset = offset + node.textContent.length;
                }
                offset += node.textContent.length;
            }
            if (startOffset !== -1) {
                data.push({ className: hl.className, start: startOffset, end: endOffset, text: hl.textContent, arabicIdx: arabicIdx });
            }
        });
        if (data.length > 0) {
            _presenterCtx.slideHighlights[_viewerState.currentPage] = data;
            _lessonActivity = true;
        }
    }

    function _restoreSlideHighlights() {
        if (!_presenterCtx) return;
        var pageIdx = _viewerState.currentPage;
        var data = _presenterCtx.slideHighlights[pageIdx];
        if (!data || data.length === 0) return;
        var container = document.getElementById('lp-slide-content');
        if (!container) return;
        var arabicBlocks = container.querySelectorAll('.lp-arabic');
        if (arabicBlocks.length === 0) return;

        // Apply highlights in reverse order (rightmost first) to avoid offset shifts
        // Sort by arabicIdx desc, then by start desc within same block
        var sorted = data.slice().sort(function(a, b) {
            if (a.arabicIdx !== b.arabicIdx) return b.arabicIdx - a.arabicIdx;
            return b.start - a.start;
        });
        sorted.forEach(function(hl) {
            var arabic = arabicBlocks[hl.arabicIdx != null ? hl.arabicIdx : 0];
            if (!arabic) return;
            // Walk text nodes to find the range [hl.start, hl.end)
            var walker = document.createTreeWalker(arabic, NodeFilter.SHOW_TEXT, null, false);
            var offset = 0;
            var startNode = null, startOff = 0, endNode = null, endOff = 0;
            var node;
            while (node = walker.nextNode()) {
                var len = node.textContent.length;
                if (!startNode && offset + len > hl.start) {
                    startNode = node;
                    startOff = hl.start - offset;
                }
                if (offset + len >= hl.end) {
                    endNode = node;
                    endOff = hl.end - offset;
                    break;
                }
                offset += len;
            }
            if (!startNode || !endNode) return;
            try {
                var range = document.createRange();
                range.setStart(startNode, startOff);
                range.setEnd(endNode, endOff);
                var span = document.createElement('span');
                span.className = hl.className;
                range.surroundContents(span);
            } catch (e) {
                // Range spans multiple elements — skip
            }
        });
    }

    function _goToPage(idx) {
        var lesson = getLesson(_viewerState.lessonId);
        if (!lesson || idx < 0 || idx >= lesson.pages.length) return;
        _saveQmarkGuesses();
        _saveVerbAnalysisGuesses();
        _saveSlideHighlights();
        _saveLessonRuntimeState(_viewerState.lessonId);
        _viewerState.currentPage = idx;
        _updatePresenterPage();
    }

    function _updatePresenterPage() {
        var lesson = getLesson(_viewerState.lessonId);
        if (!lesson) return;
        var page = lesson.pages[_viewerState.currentPage];
        var pageNum = _viewerState.currentPage + 1;
        var totalPages = lesson.pages.length;

        // Update counter and progress
        var currentEl = document.getElementById('lp-current');
        if (currentEl) currentEl.textContent = pageNum;
        var progressEl = document.getElementById('lp-progress');
        if (progressEl) progressEl.style.width = (pageNum / totalPages * 100).toFixed(1) + '%';

        // Update nav buttons
        var prevBtn = document.getElementById('lp-prev');
        var nextBtn = document.getElementById('lp-next');
        if (prevBtn) prevBtn.disabled = pageNum <= 1;
        if (nextBtn) nextBtn.disabled = pageNum >= totalPages;

        // Update dots
        document.querySelectorAll('.lp-dot').forEach(function(d, i) {
            d.classList.toggle('active', i === _viewerState.currentPage);
        });

        // Close any open qmark popup
        _closeQmarkPopup();

        // Render slide content
        _renderSlideContent(page);

        // Pre-wrap words in diacritics-word spans for highlight/click support
        // This ensures word-level click handling works on first slide render,
        // not just after toggling diacritics mode
        var slideContent = document.getElementById('lp-slide-content');
        if (slideContent) {
            slideContent.querySelectorAll('.lp-arabic').forEach(function(el) {
                _wrapWordsForDiacritics(el);
            });
        }

        // Restore highlights from previous visit
        _restoreSlideHighlights();

        // Re-init canvas
        _initCanvas();

        // Reset tool
        _deactivateTool();

        // Scroll to top
        var viewport = document.getElementById('lp-viewport');
        if (viewport) viewport.scrollTop = 0;
    }


    function _viewerKeyHandler(e) {
        if (!_viewerState) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.target.isContentEditable) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            viewerPrev();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            viewerNext();
        } else if (e.key === 'Escape') {
            closeViewer();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.code === 'KeyZ') && !e.shiftKey) {
            e.preventDefault();
            _presenterUndo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.code === 'KeyY' || ((e.key === 'z' || e.code === 'KeyZ') && e.shiftKey))) {
            e.preventDefault();
            _presenterRedo();
        }
    }

    function _loadPageIntoApp(page, mode) {
        var text = page.content;
        var stripped = typeof stripArabicDiacritics === 'function' ? stripArabicDiacritics(text) : text;
        var hasDiacritics = stripped !== text;

        var stage = {
            id: 'lesson_page_' + Date.now(),
            number: (page.title || stripped.substring(0, 30)),
            sentence: stripped,
            category: 'שיעור',
            isCustom: false
        };
        if (hasDiacritics) stage.diacritizedSentence = text;

        // Save qmark guesses and highlights before leaving slide
        _saveQmarkGuesses();
        _saveVerbAnalysisGuesses();
        _saveSlideHighlights();
        _saveLessonRuntimeState(_viewerState.lessonId);

        // Close presenter, open game screen — keep welcome hidden
        var viewer = document.getElementById('lesson-viewer');
        if (viewer) viewer.style.display = 'none';
        document.removeEventListener('keydown', _viewerKeyHandler);

        // Ensure welcome screen stays hidden
        document.getElementById('welcome-screen').style.display = 'none';

        state.loadSentence(stage);
        document.getElementById('game-screen').style.display = 'block';
        Annotations.loadForStage();
        Renderer.renderAll();
        window.scrollTo(0, 0);

        if (mode === 'diacritics' && hasDiacritics) {
            if (typeof Annotations !== 'undefined' && Annotations.revealAllDiacritics) {
                setTimeout(function() { Annotations.revealAllDiacritics(); }, 200);
            }
        } else if (mode === 'hindus') {
            setTimeout(function() {
                if (typeof HindusMode !== 'undefined') HindusMode.activate(stage);
            }, 200);
        }

        // Override back button to return to presenter
        var backBtn = document.getElementById('back-to-menu-btn');
        if (backBtn && _viewerState) {
            var savedState = Object.assign({}, _viewerState);
            backBtn.textContent = '← חזרה לשיעור';
            backBtn.onclick = function(e) {
                e.preventDefault();
                document.getElementById('game-screen').style.display = 'none';
                _viewerState = savedState;
                _restoreLessonRuntimeState(_viewerState.lessonId);
                var v = document.getElementById('lesson-viewer');
                if (v) v.style.display = 'flex';
                document.addEventListener('keydown', _viewerKeyHandler);
                _updatePresenterPage();
                setTimeout(function() { _initCanvas(); }, 350);
                backBtn.textContent = 'חזרה לתפריט';
                backBtn.onclick = null;
            };
        }
    }

    function viewerNext() {
        if (!_viewerState) return;
        var lesson = getLesson(_viewerState.lessonId);
        if (!lesson) return;
        if (_viewerState.currentPage < lesson.pages.length - 1) {
            _saveQmarkGuesses();
            _saveVerbAnalysisGuesses();
            _saveSlideHighlights();
            _saveLessonRuntimeState(_viewerState.lessonId);
            _viewerState.currentPage++;
            _updatePresenterPage();
        }
    }

    function viewerPrev() {
        if (!_viewerState) return;
        if (_viewerState.currentPage > 0) {
            _saveQmarkGuesses();
            _saveVerbAnalysisGuesses();
            _saveSlideHighlights();
            _saveLessonRuntimeState(_viewerState.lessonId);
            _viewerState.currentPage--;
            _updatePresenterPage();
        }
    }

    function _presenterHasAnnotations() {
        if (!_presenterCtx) return false;
        var slideContent = document.getElementById('lp-slide-content');
        if (slideContent && slideContent.querySelector('.user-highlight')) return true;
        if (_hasRuntimeData(_presenterCtx.slideStrokes)) return true;
        if (_hasRuntimeData(_presenterCtx.slideHighlights)) return true;
        return false;
    }

    function _promptExitPresenter(onConfirm) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:10001;display:flex;align-items:center;justify-content:center;direction:rtl;font-family:inherit';
        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:12px;padding:20px 22px;max-width:340px;box-shadow:0 12px 40px rgba(0,0,0,0.25);text-align:center';
        box.innerHTML =
            '<p style="margin:0 0 16px;color:#0f172a;font-size:1em;line-height:1.5">יש לך סימונים על השקופית — לצאת בלי לשמור אותם?</p>' +
            '<div style="display:flex;gap:8px;justify-content:center">' +
                '<button type="button" data-choice="exit" style="background:#dc2626;color:white;border:none;border-radius:8px;padding:8px 16px;font-size:.95em;cursor:pointer;font-weight:600;font-family:inherit">כן, צא</button>' +
                '<button type="button" data-choice="stay" style="background:white;color:#0f766e;border:1px solid #0d9488;border-radius:8px;padding:8px 16px;font-size:.95em;cursor:pointer;font-weight:600;font-family:inherit">בטל</button>' +
            '</div>';
        overlay.appendChild(box);
        function cleanup(doExit) {
            try { overlay.remove(); } catch(e) {}
            if (doExit) onConfirm();
        }
        box.querySelectorAll('button[data-choice]').forEach(function(btn) {
            btn.addEventListener('click', function() { cleanup(btn.getAttribute('data-choice') === 'exit'); });
        });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) cleanup(false); });
        document.body.appendChild(overlay);
    }

    function _doCloseViewer() {
        if (_viewerState) {
            _saveQmarkGuesses();
            _saveVerbAnalysisGuesses();
            _saveSlideHighlights();
            _saveLessonRuntimeState(_viewerState.lessonId);
        }
        // Remove floating player on exit
        var floatingPlayer = document.getElementById('media-floating-player');
        if (floatingPlayer) {
            // Pause media before removing
            var fpAudio = floatingPlayer.querySelector('audio');
            var fpVideo = floatingPlayer.querySelector('video');
            if (fpAudio) fpAudio.pause();
            if (fpVideo) fpVideo.pause();
            floatingPlayer.remove();
        }
        // Clean up temp demo lessons
        var closingId = _viewerState ? _viewerState.lessonId : null;
        var lessonToFocus = closingId ? getLesson(closingId) : null;
        if (closingId && closingId.indexOf('demo_') === 0) {
            var ls = loadLessons();
            saveLessons(ls.filter(function(l) { return l.id !== closingId; }));
            lessonToFocus = null;
        }
        _viewerState = null;
        _presenterCtx = null;
        _currentQmarkData = [];
        _qmarkGuessCache = {};
        _verbAnalysisCache = {};
        _interactiveTimelineCache = {};
        _closeQmarkPopup();
        document.removeEventListener('keydown', _viewerKeyHandler);
        if (window._lpAudioKbd) { document.removeEventListener('keydown', window._lpAudioKbd); window._lpAudioKbd = null; }
        // Clean up media tab + button
        _removeMediaButton();
        if (typeof Dictionary !== 'undefined') Dictionary.clearMediaPage();
        var viewer = document.getElementById('lesson-viewer');
        if (viewer) viewer.remove();

        // Always return to welcome/home screen
        _currentEditorLessonId = null;
        document.getElementById('welcome-screen').style.display = '';
        if (lessonToFocus) _focusLessonInCategory(lessonToFocus);
        renderLessonsList();
        // #1161: skip the jump-to-top when returning to a specific lesson; the highlight
        // block smooth-scrolls it to center instead.
        if (!lessonToFocus) window.scrollTo(0, 0);
    }

    function closeViewer() {
        _doCloseViewer(); // annotations are saved anyway; no exit-confirm (Amitai 2026-06-17)
    }

    // --- Question-mark (❓) hidden text ---

    /**
     * Qmark word-toggle mode: click ❓ to enter mode where every word is a toggle button.
     * Click a word to mark/unmark it as hidden. Click ❓ again to exit.
     */
    function _toggleQmarkMode(contentEl, qmBtn, pageId) {
        if (contentEl._qmarkMode) {
            _exitQmarkMode(contentEl, qmBtn);
        } else {
            _enterQmarkMode(contentEl, qmBtn, pageId);
        }
    }

    function _enterQmarkMode(contentEl, qmBtn, pageId) {
        // Mutual exclusivity: deactivate heb2ar mode if active
        if (contentEl._heb2arMode && contentEl._heb2arBtn) {
            _exitHeb2ArMode(contentEl, contentEl._heb2arBtn);
        }
        contentEl._qmarkMode = true;
        contentEl._qmarkBtn = qmBtn;
        contentEl._qmarkPageId = pageId;
        qmBtn.style.background = '#3b82f6';
        qmBtn.style.color = '#fff';
        contentEl.contentEditable = 'false';
        contentEl.style.cursor = 'default';

        // Collect existing qmark-hidden text nodes
        var hiddenSet = new Set();
        contentEl.querySelectorAll('.qmark-hidden').forEach(function(span) {
            span.textContent.split(/\s+/).forEach(function(w) {
                if (w.trim()) hiddenSet.add(w.trim());
            });
        });

        // First unwrap existing .qmark-hidden spans (flatten)
        contentEl.querySelectorAll('.qmark-hidden').forEach(function(span) {
            var parent = span.parentNode;
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
        });
        contentEl.normalize();

        // Walk all text nodes and wrap each word in a toggle span
        var textNodes = [];
        var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        textNodes.forEach(function(tn) {
            var words = tn.textContent.split(/(\s+)/);
            if (words.length <= 1 && !words[0].trim()) return;

            var frag = document.createDocumentFragment();
            words.forEach(function(w) {
                if (!w.trim()) {
                    frag.appendChild(document.createTextNode(w));
                    return;
                }
                var span = document.createElement('span');
                span.textContent = w;
                span.className = 'qmark-word-toggle';
                if (hiddenSet.has(w)) span.classList.add('qmark-hidden');
                span.addEventListener('click', function() {
                    span.classList.toggle('qmark-hidden');
                    // Mark inline editor as dirty so unsaved changes are detected
                    if (contentEl._qmarkPageId && _inlineOpen[contentEl._qmarkPageId]) {
                        _inlineOpen[contentEl._qmarkPageId].dirty = true;
                    }
                });
                frag.appendChild(span);
            });
            tn.parentNode.replaceChild(frag, tn);
        });
    }

    function _exitQmarkMode(contentEl, qmBtn) {
        contentEl._qmarkMode = false;
        qmBtn.style.background = '#dbeafe';
        qmBtn.style.color = '';
        contentEl.style.cursor = '';

        // Process word toggles: hidden → .qmark-hidden span, non-hidden → unwrap
        var toggles = contentEl.querySelectorAll('.qmark-word-toggle');
        toggles.forEach(function(span) {
            if (span.classList.contains('qmark-hidden')) {
                var qs = document.createElement('span');
                qs.className = 'qmark-hidden';
                qs.setAttribute('data-hidden-text', span.textContent);
                qs.textContent = span.textContent;
                span.parentNode.replaceChild(qs, span);
            } else {
                span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
            }
        });

        // Merge adjacent .qmark-hidden spans
        var hiddens = Array.from(contentEl.querySelectorAll('.qmark-hidden'));
        for (var i = hiddens.length - 1; i > 0; i--) {
            var prev = hiddens[i - 1];
            var cur = hiddens[i];
            var between = prev.nextSibling;
            if (between === cur || (between && between.nodeType === 3 && between.textContent.trim() === '' && between.nextSibling === cur)) {
                if (between !== cur) {
                    prev.textContent += between.textContent;
                    between.remove();
                }
                prev.textContent += ' ' + cur.textContent;
                prev.setAttribute('data-hidden-text', prev.textContent);
                cur.remove();
                hiddens.splice(i, 1);
            }
        }

        contentEl.normalize();
        contentEl.contentEditable = 'true';
    }

    // --- Custom undo stack for qmark & heb2ar ---
    function _pushEditorUndo(contentEl) {
        if (!contentEl._customUndoStack) contentEl._customUndoStack = [];
        contentEl._customUndoStack.push(contentEl.innerHTML);
        if (contentEl._customUndoStack.length > 30) contentEl._customUndoStack.shift();
    }
    function _popEditorUndo(contentEl) {
        if (!contentEl._customUndoStack || contentEl._customUndoStack.length === 0) return false;
        contentEl.innerHTML = contentEl._customUndoStack.pop();
        return true;
    }

    // Patch _exitQmarkMode to save undo before changes
    var _origExitQmark = _exitQmarkMode;
    _exitQmarkMode = function(contentEl, qmBtn) {
        _pushEditorUndo(contentEl);
        _origExitQmark(contentEl, qmBtn);
    };

    // --- Hebrew↔Arabic word toggle mode ---
    function _isHebrewText(text) {
        return /[\u0590-\u05FF]/.test(text);
    }
    function _isArabicText(text) {
        return /[\u0600-\u06FF]/.test(text);
    }
    function _convertWord(word) {
        if (typeof DetailsPanel === 'undefined' || !DetailsPanel._convertHebrewToArabic) return word;
        if (_isHebrewText(word)) {
            return DetailsPanel._convertHebrewToArabic(word);
        } else if (_isArabicText(word)) {
            return DetailsPanel._convertArabicToHebrew ? DetailsPanel._convertArabicToHebrew(word) : word;
        }
        return word;
    }

    function _toggleHeb2ArMode(contentEl, h2aBtn) {
        if (contentEl._heb2arMode) {
            _exitHeb2ArMode(contentEl, h2aBtn);
        } else {
            _enterHeb2ArMode(contentEl, h2aBtn);
        }
    }

    function _enterHeb2ArMode(contentEl, h2aBtn) {
        // Mutual exclusivity: deactivate qmark mode if active
        if (contentEl._qmarkMode && contentEl._qmarkBtn) {
            _exitQmarkMode(contentEl, contentEl._qmarkBtn);
        }
        contentEl._heb2arMode = true;
        contentEl._heb2arBtn = h2aBtn;
        h2aBtn.style.background = '#ea580c';
        h2aBtn.style.color = '#fff';
        contentEl.contentEditable = 'false';
        contentEl.style.cursor = 'default';

        // Walk text nodes and wrap each word in a clickable span
        var textNodes = [];
        var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        textNodes.forEach(function(tn) {
            var words = tn.textContent.split(/(\s+)/);
            if (words.length <= 1 && !words[0].trim()) return;

            var frag = document.createDocumentFragment();
            words.forEach(function(w) {
                if (!w.trim()) {
                    frag.appendChild(document.createTextNode(w));
                    return;
                }
                var span = document.createElement('span');
                span.textContent = w;
                span.className = 'heb2ar-word-toggle';
                span.style.cssText = 'cursor:pointer;padding:1px 4px;border-radius:4px;transition:background 0.15s';
                span.addEventListener('mouseenter', function() { span.style.background = '#fed7aa'; });
                span.addEventListener('mouseleave', function() { span.style.background = ''; });
                span.addEventListener('click', function() {
                    var converted = _convertWord(span.textContent);
                    if (converted !== span.textContent) {
                        span.textContent = converted;
                        span.style.background = '#bbf7d0';
                        setTimeout(function() { span.style.background = ''; }, 400);
                    }
                });
                frag.appendChild(span);
            });
            tn.parentNode.replaceChild(frag, tn);
        });
    }

    function _exitHeb2ArMode(contentEl, h2aBtn) {
        _pushEditorUndo(contentEl);
        contentEl._heb2arMode = false;
        h2aBtn.style.background = '#fff7ed';
        h2aBtn.style.color = '';
        contentEl.style.cursor = '';

        // Unwrap toggle spans back to text
        var toggles = contentEl.querySelectorAll('.heb2ar-word-toggle');
        toggles.forEach(function(span) {
            span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
        });
        contentEl.normalize();

        // Refresh data-hidden-text on every qmark-hidden span so a Hebrew→Arabic
        // conversion performed INSIDE a hidden span propagates to the viewer.
        // (Amitai 2026-05-18 19:38: "כשאני פותח את התשובה כותב לי תשובה שהייתה
        //  פעם ושכבר שיניתי" — viewer was reading stale Hebrew from
        //  data-hidden-text even though the visible text was the new Arabic.
        //  v4.18.20)
        contentEl.querySelectorAll('.qmark-hidden').forEach(function(qs) {
            qs.setAttribute('data-hidden-text', qs.textContent);
        });

        contentEl.contentEditable = 'true';
    }

    function _heb2arConvertAll(contentEl) {
        var toggles = contentEl.querySelectorAll('.heb2ar-word-toggle');
        toggles.forEach(function(span) {
            var converted = _convertWord(span.textContent);
            if (converted !== span.textContent) {
                span.textContent = converted;
            }
        });
    }

    /**
     * In viewer: process slide HTML to replace .qmark-hidden spans with ❓ placeholders.
     * Returns the modified HTML and a map of placeholder IDs to original text data.
     */
    function _processQmarkForViewer(html) {
        var container = document.createElement('div');
        container.innerHTML = html;
        var hiddenSpans = container.querySelectorAll('.qmark-hidden');
        var qmarkData = [];
        hiddenSpans.forEach(function(span, idx) {
            var id = 'qmark_' + Date.now() + '_' + idx;
            // Prefer the live textContent over data-hidden-text so a Heb→Ar
            // conversion done after the qmark was set still serves the new
            // text to the viewer. data-hidden-text used only as fallback for
            // legacy spans that lost their textContent. (Amitai 2026-05-18.)
            var liveText = (span.textContent || '').trim();
            var originalText = liveText || span.getAttribute('data-hidden-text') || '';
            var strippedText = _stripDiacritics(originalText);
            qmarkData.push({
                id: id,
                originalWithDiacritics: originalText,
                originalStripped: strippedText,
                guess: ''
            });
            var placeholder = document.createElement('span');
            placeholder.className = 'qmark-placeholder';
            placeholder.id = id;
            placeholder.setAttribute('data-qmark-idx', String(idx));
            placeholder.textContent = '?';
            placeholder.style.cssText = 'display:inline-block;min-width:80px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:4px;padding:0 6px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.3;box-sizing:border-box';
            span.parentNode.replaceChild(placeholder, span);
        });
        return { html: container.innerHTML, data: qmarkData };
    }

    /**
     * Wire click handlers on qmark placeholders in the viewer.
     * Each ❓ opens a guess popup.
     */
    function _wireQmarkPlaceholders(qmarkData) {
        qmarkData.forEach(function(item) {
            var el = document.getElementById(item.id);
            if (!el) return;
            el._qmarkItem = item;
            el._qmarkLastVisibleState = 0; // remembers last visible state (1=plain, 2=diacritics)
            el.addEventListener('click', function(e) {
                // If editing, don't interfere
                if (el.classList.contains('qmark-editing')) return;
                // In diacritics/candle mode — left click logic
                if (_presenterCtx && _presenterCtx.diacriticsActive) {
                    _qmarkLeftClick(item, el);
                    return;
                }
                // If revealed, click to go back to guess mode (preserving previous guess)
                if (el.classList.contains('revealed')) {
                    if (_presenterCtx) {
                        _presenterCtx.undoStack.push({ type: 'qmark', item: item, el: el, prevState: el._qmarkRevealState || 1, prevLastVisible: el._qmarkLastVisibleState || 0, prevHtml: el.innerHTML, prevStyle: el.style.cssText, prevClass: true });
                    }
                    el.classList.remove('revealed');
                    el._qmarkRevealState = 0;
                    if (item.guess) {
                        el.style.cssText = 'display:inline-block;min-width:80px;text-align:center;padding:0 6px;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;cursor:pointer;color:#1e40af;vertical-align:baseline;font-size:1em;line-height:1.3;box-sizing:border-box';
                        el.textContent = item.guess;
                    } else {
                        el.style.cssText = 'display:inline-block;min-width:80px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:4px;padding:0 6px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.3;box-sizing:border-box';
                        el.textContent = '?';
                    }
                    return;
                }
                _showQmarkGuessPopup(item, el);
            });
            // Right click: toggle ? mark on/off
            el.addEventListener('contextmenu', function(e) {
                if (!_presenterCtx || !_presenterCtx.diacriticsActive) return;
                e.preventDefault();
                _qmarkRightClick(item, el);
            });
        });
    }

    // Track qmark data per slide for reveal/hide
    var _currentQmarkData = [];
    // Cache guesses per slide index so navigating away and back preserves them
    var _qmarkGuessCache = {}; // { slideIndex: { qmarkIdx: { guess: string, revealState: number } } }
    // Cache verb_analysis table state per slide index. Slide-only persistence —
    // cleared when the viewer reopens, same lifetime as _qmarkGuessCache.
    var _verbAnalysisCache = {}; // { slideIndex: { rowIdx: { root, binyan, tense, passive, person, pronoun, translate } } }
    var _interactiveTimelineCache = {}; // { pageIdx: { placed: { slotIdx: sortedEventIdx } } }
    var _pendingPresenterState = null;
    // Debounce for translate tool to prevent double Dictionary.lookup
    var _translateDebounce = 0;

    function _hasRuntimeData(obj) {
        if (!obj || typeof obj !== 'object') return false;
        // Empty nested collections (e.g. {0: []}) are NOT data — a slide that only
        // initialised empty stroke/highlight arrays must not count as resumable.
        return Object.keys(obj).some(function(k) {
            var v = obj[k];
            if (v == null) return false;
            if (Array.isArray(v)) return v.length > 0;
            if (typeof v === 'object') return Object.keys(v).length > 0;
            return true;
        });
    }

    // Unified runtime-state key prefix: plonter_lesson_state_<lessonId>
    function _saveLessonRuntimeState(lessonId) {
        if (!lessonId) return;
        // UX (Amitai 2026-06-05) — only persist resumable progress when the user
        // actually did something this session; a no-activity visit must not write
        // resume state, so the "המשך מהמקום שעצרת?" prompt is skipped next entry.
        if (!_lessonActivity) return;
        try {
            var state = { _version: 1 };
            if (_hasRuntimeData(_qmarkGuessCache)) state.qmark = _qmarkGuessCache;
            if (_hasRuntimeData(_verbAnalysisCache)) state.verb = _verbAnalysisCache;
            if (_presenterCtx && _hasRuntimeData(_presenterCtx.slideHighlights)) state.highlights = _presenterCtx.slideHighlights;
            if (_presenterCtx && _hasRuntimeData(_presenterCtx.slideStrokes)) state.strokes = _presenterCtx.slideStrokes;
            if (_hasRuntimeData(_interactiveTimelineCache)) state.timeline = _interactiveTimelineCache;

            var key = 'plonter_lesson_state_' + lessonId;
            if (Object.keys(state).length > 1) {
                localStorage.setItem(key, JSON.stringify(state));
            } else {
                localStorage.removeItem(key);
            }
        } catch (e) {
            console.warn('[lessons] save runtime state failed', e);
        }
    }

    function _applyPendingPresenterState() {
        if (!_presenterCtx || !_pendingPresenterState) return;
        _presenterCtx.slideHighlights = _pendingPresenterState.highlights || {};
        _presenterCtx.slideStrokes = _pendingPresenterState.strokes || {};
        _pendingPresenterState = null;
    }

    function _restoreLessonRuntimeState(lessonId) {
        if (!lessonId) return;
        try {
            var key = 'plonter_lesson_state_' + lessonId;
            var raw = localStorage.getItem(key);
            var state = raw ? JSON.parse(raw) : null;
            var migratedLegacyQmark = false;

            if (!state) {
                var legacy = localStorage.getItem('plonter_qmark_' + lessonId);
                if (legacy) {
                    state = { _version: 1, qmark: JSON.parse(legacy) };
                    migratedLegacyQmark = true;
                }
            }

            if (!state || state._version !== 1) return;

            _qmarkGuessCache = state.qmark || {};
            _verbAnalysisCache = state.verb || {};
            _interactiveTimelineCache = state.timeline || {};
            _pendingPresenterState = {
                highlights: state.highlights || {},
                strokes: state.strokes || {}
            };
            _applyPendingPresenterState();

            if (migratedLegacyQmark) { _lessonActivity = true; _saveLessonRuntimeState(lessonId); }
        } catch (e) {
            console.warn('[lessons] restore runtime state failed', e);
        }
    }

    function _showQmarkGuessPopup(item, placeholderEl) {
        // Close any existing qmark input
        _closeQmarkPopup();

        // Save original placeholder info for restoration
        placeholderEl._qmarkItem = item;
        placeholderEl._qmarkOrigStyle = placeholderEl.style.cssText;
        placeholderEl._qmarkOrigText = placeholderEl.textContent;

        // Measure placeholder dimensions before transforming
        var origRect = placeholderEl.getBoundingClientRect();
        var origWidth = Math.max(origRect.width, 60);

        // Transform the placeholder itself into an input field
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'qmark-active-input';
        input.dir = 'rtl';
        input.placeholder = '?';
        input.value = item.guess || '';
        var editWidth = Math.max(origWidth, 80);
        input.style.cssText = 'display:inline-block;width:' + (editWidth - 12) + 'px;text-align:center;font-size:1em;background:transparent;border:none;padding:2px 0;outline:none;vertical-align:baseline;font-family:inherit;color:#1e40af;box-sizing:border-box;line-height:1.8';
        // Auto-size: only grow beyond original width, never shrink below it
        function _autoSize() {
            var len = Math.max(input.value.length, 1);
            var needed = len * 14 + 16; // ~14px/char to fit the enlarged 1em font
            input.style.width = Math.max(Math.min(needed, 320), editWidth - 12) + 'px';
        }

        placeholderEl.textContent = '';
        // Keep outer dimensions stable across modes — only swap dashed→solid border to mark editing
        placeholderEl.style.cssText = 'display:inline-block;min-width:' + editWidth + 'px;text-align:center;font-size:1em;background:#eff6ff;border:1px solid #3b82f6;border-radius:4px;padding:2px 6px;cursor:text;color:#3b82f6;vertical-align:baseline;line-height:1.8;box-sizing:border-box';
        placeholderEl.appendChild(input);
        placeholderEl.classList.add('qmark-editing');

        // DK (niqqud keyboard) button next to qmark input — sits to the LEFT of the
        // field (DOM-after the input → left side in RTL) and stays visible the whole
        // time the field is being edited, not only when Arabic text already exists
        // (Amitai 2026-06-06).
        var qmarkDkBtn = document.createElement('button');
        qmarkDkBtn.id = 'qmark-dk-btn';
        qmarkDkBtn.innerHTML = '⌨️';
        qmarkDkBtn.title = 'מקלדת ניקוד';
        qmarkDkBtn.style.cssText = 'display:inline-block;margin-right:4px;padding:2px 6px;border:1px solid #6366f1;border-radius:4px;background:#f5f3ff;color:#6366f1;cursor:pointer;font-size:0.9em;vertical-align:middle';
        placeholderEl.insertBefore(qmarkDkBtn, null); // after input → left side in RTL
        var _hasArabic = /[\u0600-\u06FF]/;
        function _updateQmarkDkBtn() {
            // Always visible while editing the field.
            qmarkDkBtn.style.display = 'inline-block';
            // Update active state
            if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard._active) {
                qmarkDkBtn.style.background = '#6366f1';
                qmarkDkBtn.style.color = 'white';
            } else {
                qmarkDkBtn.style.background = '#f5f3ff';
                qmarkDkBtn.style.color = '#6366f1';
            }
        }
        qmarkDkBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        qmarkDkBtn.addEventListener('click', function() {
            if (typeof DiacriticsKeyboard !== 'undefined') {
                DiacriticsKeyboard.toggle();
                _updateQmarkDkBtn();
                input.focus();
            }
        });

        input.focus();

        // Auto-expand as user types
        input.addEventListener('input', function() { _autoSize(); _updateQmarkDkBtn(); });

        // Ctrl+G Hebrew→Arabic
        input.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                    input.value = DetailsPanel._convertHebrewToArabic(input.value);
                }
                _autoSize();
                _updateQmarkDkBtn();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                // Auto-transliterate Hebrew→Arabic on Enter
                if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                    input.value = DetailsPanel._convertHebrewToArabic(input.value);
                }
                _updateQmarkDkBtn();
                var guess = input.value.trim();
                item.guess = guess;
                if (guess) {
                    var guessStripped = _stripDiacritics(guess);
                    if (guessStripped === item.originalStripped) {
                        placeholderEl.classList.remove('qmark-editing');
                        placeholderEl.classList.add('revealed');
                        placeholderEl.style.cssText = '';
                        placeholderEl.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalWithDiacritics) + '</span>';
                        placeholderEl._qmarkRevealState = 2;
                    } else {
                        input.style.borderColor = '#dc2626';
                        setTimeout(function() { input.style.borderColor = '#3b82f6'; }, 800);
                    }
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                item.guess = input.value.trim();
                _closeQmarkPopup();
            }
        });

        // On blur: keep the guess text visible (don't revert to ?)
        input.addEventListener('blur', function() {
            // Deactivate DiacriticsKeyboard on blur to prevent ghost palette
            if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard.isActive()) {
                DiacriticsKeyboard.deactivate();
            }
            // Auto-transliterate Hebrew→Arabic on blur too (not just Enter), so
            // a typed-then-clicked-away guess gets the same conversion as a
            // typed-then-pressed-Enter guess. Otherwise the cached item.guess
            // ends up as raw Hebrew while the displayed answer was Arabic —
            // making the next popup show a "stale" answer the user thought
            // they had already replaced. (Amitai 2026-05-18 19:38.)
            if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                input.value = DetailsPanel._convertHebrewToArabic(input.value);
            }
            item.guess = input.value.trim();
            placeholderEl.classList.remove('qmark-editing');
            if (item.guess) {
                // Show the guess as text in the placeholder
                placeholderEl.style.cssText = 'display:inline-block;min-width:80px;text-align:center;padding:0 6px;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;cursor:pointer;color:#1e40af;vertical-align:baseline;font-size:1em;line-height:1.3;box-sizing:border-box';
                placeholderEl.textContent = item.guess;
            } else {
                // No guess — revert to ? placeholder
                placeholderEl.style.cssText = placeholderEl._qmarkOrigStyle || 'display:inline-block;min-width:80px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:4px;padding:0 6px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.3;box-sizing:border-box';
                placeholderEl.textContent = '?';
            }
        });
    }

    /**
     * Left click in candle mode:
     * state 0 (?) → reveal to lastVisibleState (default 1)
     * state 1 (plain) → 2 (show diacritics)
     * state 2 (diacritics) → 1 (hide diacritics)
     */
    function _qmarkLeftClick(item, el) {
        var state = el._qmarkRevealState || 0;
        // Push undo before changing state
        if (_presenterCtx) {
            _presenterCtx.undoStack.push({ type: 'qmark', item: item, el: el, prevState: state, prevLastVisible: el._qmarkLastVisibleState || 0, prevHtml: el.innerHTML, prevStyle: el.style.cssText, prevClass: el.classList.contains('revealed') });
        }
        if (state === 0) {
            // First reveal — show plain (no niqqud). Next click toggles to vocalized.
            el.classList.add('revealed');
            el.style.cssText = '';
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalStripped) + '</span>';
            el._qmarkRevealState = 1;
            el._qmarkLastVisibleState = 1;
        } else if (state === 2) {
            // Toggle diacritics off (show plain)
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalStripped) + '</span>';
            el._qmarkRevealState = 1;
            el._qmarkLastVisibleState = 1;
        } else {
            // Toggle diacritics on
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalWithDiacritics) + '</span>';
            el._qmarkRevealState = 2;
            el._qmarkLastVisibleState = 2;
        }
    }

    /**
     * Right click in candle mode:
     * state 0 (?) → reveal to lastVisibleState (same as left click from ?)
     * state 1 or 2 (visible) → hide to ? (save current state as lastVisible)
     */
    function _qmarkRightClick(item, el) {
        var state = el._qmarkRevealState || 0;
        if (state === 0) {
            // Reveal — same as left click from ?
            _qmarkLeftClick(item, el);
        } else {
            // Push undo before hiding
            if (_presenterCtx) {
                _presenterCtx.undoStack.push({ type: 'qmark', item: item, el: el, prevState: state, prevLastVisible: el._qmarkLastVisibleState || 0, prevHtml: el.innerHTML, prevStyle: el.style.cssText, prevClass: el.classList.contains('revealed') });
            }
            // Hide to ? — remember current visible state
            el._qmarkLastVisibleState = state;
            el.classList.remove('revealed');
            el._qmarkRevealState = 0;
            if (item.guess) {
                el.style.cssText = 'display:inline-block;min-width:80px;text-align:center;padding:0 6px;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;cursor:pointer;color:#1e40af;vertical-align:baseline;font-size:1em;line-height:1.3;box-sizing:border-box';
                el.textContent = item.guess;
            } else {
                el.style.cssText = 'display:inline-block;min-width:80px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:4px;padding:0 6px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.3;box-sizing:border-box';
                el.textContent = '?';
            }
            // Deactivate candle after hiding word — user wants to edit guess
            if (_presenterCtx && _presenterCtx.currentTool === 'diacritics') {
                _deactivateTool();
            }
        }
    }

    /** Legacy 3-state reveal (kept for backward compat) */
    function _qmarkCandleReveal(item, placeholderEl, guessInput) {
        _qmarkLeftClick(item, placeholderEl);
        if (guessInput) item.guess = guessInput.value.trim();
    }

    function _closeQmarkPopup() {
        // Restore any placeholder that's in editing mode
        var editing = document.querySelector('.qmark-placeholder.qmark-editing');
        if (editing) {
            var item = editing._qmarkItem;
            // Save guess from input if still present
            var input = editing.querySelector('#qmark-active-input');
            if (input && item) item.guess = input.value.trim();
            editing.classList.remove('qmark-editing');
            if (item && item.guess) {
                editing.style.cssText = 'display:inline-block;min-width:80px;text-align:center;padding:0 6px;background:#dbeafe;border:1px solid #93c5fd;border-radius:4px;cursor:pointer;color:#1e40af;vertical-align:baseline;font-size:1em;line-height:1.3;box-sizing:border-box';
                editing.textContent = item.guess;
            } else {
                editing.style.cssText = editing._qmarkOrigStyle || 'display:inline-block;min-width:80px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:4px;padding:0 6px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.3;box-sizing:border-box';
                editing.textContent = '?';
            }
        }
        // Also remove old-style popup if any
        var popup = document.getElementById('qmark-popup');
        if (popup) popup.remove();
    }

    // Save all open inline editors
    function _saveAllOpenEditors() {
        document.querySelectorAll('.lpc-inline-editor').forEach(function(editor) {
            var saveBtn = editor.querySelector('.btn.btn-primary');
            if (saveBtn) saveBtn.click();
        });
    }

    // --- Save prompt (styled replacement for confirm()) ---

    function _showSavePrompt(callback) {
        // Save focus/selection before dialog
        var savedEl = document.activeElement;
        var savedSel = null;
        try { var s = window.getSelection(); if (s && s.rangeCount > 0) savedSel = s.getRangeAt(0).cloneRange(); } catch(ex) {}

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center';
        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:16px;padding:24px 28px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;direction:rtl';
        box.innerHTML =
            '<div style="font-size:2em;margin-bottom:8px">📝</div>' +
            '<div style="font-size:1.1em;font-weight:bold;margin-bottom:6px;color:#1a1a1a">רוצה לשמור את השינויים?</div>' +
            '<div style="font-size:0.9em;color:#6b7280;margin-bottom:20px">השינויים שלך עדיין לא נשמרו</div>' +
            '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
                '<button id="sp-cancel" style="flex:1;padding:10px 16px;background:#0d9488;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">✏️ המשך לעבוד</button>' +
                '<button id="sp-save" style="flex:1;padding:10px 16px;background:#3b82f6;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">💾 שמור</button>' +
                '<button id="sp-discard" style="flex:1;padding:10px 16px;background:#ef4444;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">🗑️ מחק את השינויים</button>' +
            '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function _restoreFocus() {
            if (savedEl && savedEl.focus) {
                savedEl.focus();
                if (savedSel) { try { var s = window.getSelection(); s.removeAllRanges(); s.addRange(savedSel); } catch(ex) {} }
            }
        }
        function close(choice) {
            overlay.remove();
            if (choice === 'cancel') _restoreFocus();
            callback(choice);
        }
        box.querySelector('#sp-save').addEventListener('click', function(e) { e.stopPropagation(); close('save'); });
        box.querySelector('#sp-discard').addEventListener('click', function(e) { e.stopPropagation(); close('discard'); });
        box.querySelector('#sp-cancel').addEventListener('click', function(e) { e.stopPropagation(); close('cancel'); });
        overlay.addEventListener('click', function(e) { e.stopPropagation(); if (e.target === overlay) close('cancel'); });
    }

    // --- Duplicate with unsaved changes prompt ---
    function _showDuplicatePrompt(callback) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center';
        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:16px;padding:24px 28px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;direction:rtl';
        box.innerHTML =
            '<div style="font-size:2em;margin-bottom:8px">📋</div>' +
            '<div style="font-size:1.1em;font-weight:bold;margin-bottom:6px;color:#1a1a1a">\u05d9\u05e9 \u05e9\u05d9\u05e0\u05d5\u05d9\u05d9\u05dd \u05e9\u05dc\u05d0 \u05e0\u05e9\u05de\u05e8\u05d5</div>' +
            '<div style="font-size:0.9em;color:#6b7280;margin-bottom:20px">\u05dc\u05e9\u05de\u05d5\u05e8 \u05dc\u05e4\u05e0\u05d9 \u05e9\u05db\u05e4\u05d5\u05dc?</div>' +
            '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
                '<button id="dp-save" style="flex:1;padding:10px 16px;background:#3b82f6;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">\ud83d\udcbe \u05e9\u05de\u05d5\u05e8 \u05d5\u05e9\u05db\u05e4\u05dc</button>' +
                '<button id="dp-dup" style="flex:1;padding:10px 16px;background:#f59e0b;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">\ud83d\udccb \u05e9\u05db\u05e4\u05dc \u05d1\u05dc\u05d9 \u05dc\u05e9\u05de\u05d5\u05e8</button>' +
                '<button id="dp-cancel" style="flex:1;padding:10px 16px;background:#6b7280;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">\u2715 \u05d1\u05d9\u05d8\u05d5\u05dc</button>' +
            '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        function close(choice) {
            overlay.remove();
            callback(choice);
        }
        box.querySelector('#dp-save').addEventListener('click', function(e) { e.stopPropagation(); close('save'); });
        box.querySelector('#dp-dup').addEventListener('click', function(e) { e.stopPropagation(); close('dup'); });
        box.querySelector('#dp-cancel').addEventListener('click', function(e) { e.stopPropagation(); close('cancel'); });
        overlay.addEventListener('click', function(e) { e.stopPropagation(); if (e.target === overlay) close('cancel'); });
    }

    // --- Two-choice dialog (for cancel/close prompts) ---
    function _showTwoChoiceDialog(emoji, title, subtitle, btn1Text, btn1Color, btn1Action, btn2Text, btn2Color, btn2Action) {
        var savedEl = document.activeElement;
        var savedSel = null;
        try { var s = window.getSelection(); if (s && s.rangeCount > 0) savedSel = s.getRangeAt(0).cloneRange(); } catch(ex) {}

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center';
        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:16px;padding:24px 28px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;direction:rtl';
        box.innerHTML =
            '<div style="font-size:2em;margin-bottom:8px">' + emoji + '</div>' +
            '<div style="font-size:1.1em;font-weight:bold;margin-bottom:6px;color:#1a1a1a">' + title + '</div>' +
            '<div style="font-size:0.9em;color:#6b7280;margin-bottom:20px">' + subtitle + '</div>' +
            '<div style="display:flex;gap:8px;justify-content:center">' +
                '<button id="tcd-btn1" style="flex:1;padding:10px 16px;background:' + btn1Color + ';color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">' + btn1Text + '</button>' +
                '<button id="tcd-btn2" style="flex:1;padding:10px 16px;background:' + btn2Color + ';color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">' + btn2Text + '</button>' +
            '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function _restoreFocus() {
            if (savedEl && savedEl.focus) {
                savedEl.focus();
                if (savedSel) { try { var s = window.getSelection(); s.removeAllRanges(); s.addRange(savedSel); } catch(ex) {} }
            }
        }
        box.querySelector('#tcd-btn1').addEventListener('click', function(e) { e.stopPropagation(); overlay.remove(); btn1Action(); _restoreFocus(); });
        box.querySelector('#tcd-btn2').addEventListener('click', function(e) { e.stopPropagation(); overlay.remove(); btn2Action(); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) { e.stopPropagation(); overlay.remove(); _restoreFocus(); } });
    }

    // --- Styled confirm dialog (replacement for native confirm()) ---

    function _showStyledConfirm(message, onConfirm) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center';
        var box = document.createElement('div');
        box.style.cssText = 'background:white;border-radius:16px;padding:24px 28px;max-width:340px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;direction:rtl';
        box.innerHTML =
            '<div style="font-size:2em;margin-bottom:8px">🗑️</div>' +
            '<div style="font-size:1.1em;font-weight:bold;margin-bottom:6px;color:#1a1a1a">' + message + '</div>' +
            '<div style="display:flex;gap:8px;justify-content:center;margin-top:18px">' +
                '<button id="sc-yes" style="flex:1;padding:10px 16px;background:#ef4444;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">מחק</button>' +
                '<button id="sc-no" style="flex:1;padding:10px 16px;background:none;border:1px solid #d1d5db;border-radius:10px;font-size:1em;color:#6b7280;cursor:pointer">ביטול</button>' +
            '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }
        box.querySelector('#sc-yes').addEventListener('click', function() { close(); onConfirm(); });
        box.querySelector('#sc-no').addEventListener('click', close);
        // No backdrop click handler — closes only via Delete or Cancel buttons
    }

    // --- Helpers ---

    function _fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            MessageManager.show('📋 השיעור הועתק ללוח בהצלחה!', 'success');
        } catch (e) {
            MessageManager.show('לא הצליח להעתיק ללוח', 'error');
        }
        document.body.removeChild(ta);
    }

    // --- Verb Bubble Editor ---
    function _createVerbBubbleEditor(initialVerbs, onChangeCallback) {
        var heb2ar = (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) ? DetailsPanel._convertHebrewToArabic.bind(DetailsPanel) : function(t) { return t; };
        var verbs = (initialVerbs || '').split('\n').map(function(v) { return v.trim(); }).filter(function(v) { return v; });

        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px;border:2px solid #d1d5db;border-radius:8px;min-height:50px;direction:rtl;background:#fafafa';

        function _getVerbs() {
            var result = [];
            wrap.querySelectorAll('.vb-chip').forEach(function(chip) {
                var t = chip.dataset.verb;
                if (t) result.push(t);
            });
            return result.join('\n');
        }

        function _notify() { if (onChangeCallback) onChangeCallback(_getVerbs()); }

        function _createChip(text) {
            var chip = document.createElement('div');
            chip.className = 'vb-chip';
            chip.dataset.verb = text;
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:10px 16px;background:linear-gradient(135deg,#ede9fe,#ddd6fe);border:2px solid #8b5cf6;border-radius:12px;font-family:PlonterFlippedDiacritics,Arial,serif;font-size:1.4em;cursor:pointer;user-select:none;min-height:44px;transition:transform 0.15s,box-shadow 0.15s;line-height:1.4';
            chip.innerHTML = '<span class="vb-text" style="direction:rtl">' + escapeHtml(text) + '</span><span class="vb-delete" style="color:#a78bfa;font-size:0.8em;cursor:pointer;margin-right:4px" title="מחק">✕</span>';
            chip.addEventListener('mouseenter', function() { chip.style.transform = 'scale(1.05)'; chip.style.boxShadow = '0 2px 8px rgba(139,92,246,0.3)'; });
            chip.addEventListener('mouseleave', function() { chip.style.transform = ''; chip.style.boxShadow = ''; });
            // Delete
            chip.querySelector('.vb-delete').addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                chip.remove();
                _notify();
            });
            // Click to edit
            chip.addEventListener('click', function(e) {
                e.stopPropagation();
                if (e.target.classList.contains('vb-delete')) return;
                var inputWrap = _createInput(chip.dataset.verb);
                wrap.insertBefore(inputWrap, chip);
                chip.remove();
                var inp = inputWrap.querySelector('.vb-input');
                if (inp) { inp.focus(); inp.select(); }
            });
            return chip;
        }

        function _createInput(prefill) {
            // Wrapper for input + DK button
            var inputWrap = document.createElement('div');
            inputWrap.className = 'vb-input-wrap';
            inputWrap.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:4px';

            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'vb-input';
            input.value = prefill || '';
            input.dir = 'rtl';
            input.placeholder = 'הקלד פועל...';
            input.style.cssText = 'padding:10px 12px;border:2px solid #8b5cf6;border-radius:12px;font-family:PlonterFlippedDiacritics,Arial,serif;font-size:1.4em;width:70px;max-width:120px;outline:none;background:white;min-height:44px;direction:rtl;line-height:1.4';

            // DK toggle button — use id qmark-dk-btn so DiacriticsKeyboard positions left arrow to its left
            var dkBtn = document.createElement('button');
            dkBtn.type = 'button';
            dkBtn.id = 'qmark-dk-btn';
            dkBtn.textContent = '⌨️';
            dkBtn.title = 'מקלדת ניקוד';
            dkBtn.style.cssText = 'padding:10px 10px;border:1px solid #6366f1;border-radius:10px;background:#f5f3ff;cursor:pointer;font-size:1.2em;color:#6366f1;line-height:1;min-height:44px;display:flex;align-items:center';
            dkBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
            dkBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof DiacriticsKeyboard !== 'undefined') {
                    DiacriticsKeyboard.toggle();
                    var active = DiacriticsKeyboard._active;
                    dkBtn.style.background = active ? '#6366f1' : '#f5f3ff';
                    dkBtn.style.color = active ? 'white' : '#6366f1';
                    // Widen input when DK active so arrows don't hide text
                    input.style.width = active ? '140px' : '70px';
                    input.style.maxWidth = active ? '180px' : '120px';
                    input.focus();
                    // Jump cursor to first undiacritized character
                    if (active && input.value) {
                        var diacritics = /[\u064B-\u065F\u0670]/;
                        var val = input.value;
                        for (var ci = 0; ci < val.length; ci++) {
                            // Skip diacritical marks themselves
                            if (diacritics.test(val[ci])) continue;
                            // Check if next char is a diacritical — if not, this char is undiacritized
                            if (ci + 1 >= val.length || !diacritics.test(val[ci + 1])) {
                                input.setSelectionRange(ci, ci);
                                break;
                            }
                        }
                    }
                }
            });
            if (typeof DiacriticsKeyboard !== 'undefined') {
                document.addEventListener('dk-toggle', function(e) {
                    dkBtn.style.background = e.detail.active ? '#6366f1' : '#f5f3ff';
                    dkBtn.style.color = e.detail.active ? 'white' : '#6366f1';
                });
            }

            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var val = input.value.trim();
                    if (val) {
                        var chip = _createChip(val);
                        wrap.insertBefore(chip, inputWrap);
                        input.value = '';
                        _notify();
                    }
                    // Keep input focused for next verb
                    input.focus();
                } else if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                    e.preventDefault();
                    input.value = heb2ar(input.value);
                }
            });
            // Blur: commit if has text, close DK, then ensure add button exists
            input.addEventListener('blur', function(e) {
                // Don't blur if clicking on DK button
                if (e.relatedTarget === dkBtn) return;
                // Close DK when leaving bubble input
                if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard._active) {
                    DiacriticsKeyboard.toggle();
                }
                var val = input.value.trim();
                if (val) {
                    var chip = _createChip(val);
                    wrap.insertBefore(chip, inputWrap);
                    _notify();
                }
                inputWrap.remove();
                _ensureAddBtn();
            });

            inputWrap.appendChild(input);
            inputWrap.appendChild(dkBtn);
            return inputWrap;
        }

        function _ensureAddBtn() {
            if (wrap.querySelector('.vb-add-btn')) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vb-add-btn';
            btn.textContent = '+';
            btn.style.cssText = 'width:40px;height:40px;border-radius:50%;border:2px dashed #8b5cf6;background:white;color:#8b5cf6;font-size:1.4em;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s,transform 0.15s;flex-shrink:0';
            btn.addEventListener('mouseenter', function() { btn.style.background = '#ede9fe'; btn.style.transform = 'scale(1.1)'; });
            btn.addEventListener('mouseleave', function() { btn.style.background = 'white'; btn.style.transform = ''; });
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                btn.remove();
                var inputWrap = _createInput('');
                wrap.appendChild(inputWrap);
                var inp = inputWrap.querySelector('.vb-input');
                if (inp) inp.focus();
            });
            wrap.appendChild(btn);
        }

        // Stop propagation on the whole container to prevent card collapse
        wrap.addEventListener('click', function(e) { e.stopPropagation(); });

        // Build initial chips
        verbs.forEach(function(v) { wrap.appendChild(_createChip(v)); });
        _ensureAddBtn();

        // Expose getValue
        wrap.getValue = _getVerbs;

        return wrap;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/&amp;nbsp;/g, '&nbsp;');
    }

    function escapeAttr(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Resolve a stored media url to absolute. Relative 'uploads/..' paths live at the
    // site root (/plonter/), NOT under /clone/ — without this they hit the SPA HTML
    // fallback and render broken (B1). Full http(s):// and already-absolute '/..' pass through.
    function _absUrl(u) {
        if (!u) return '';
        if (/^(https?:)?\/\//i.test(u) || u.charAt(0) === '/') return u;
        return '/plonter/' + u;
    }

    function _setupMediaButton(mediaPage) {
        _removeMediaButton();
        // Inject pulse animation if not present
        if (!document.getElementById('lp-media-pulse-style')) {
            var style = document.createElement('style');
            style.id = 'lp-media-pulse-style';
            style.textContent = '@keyframes lp-media-pulse{0%,100%{transform:scale(1);box-shadow:0 2px 8px rgba(99,102,241,0.3)}50%{transform:scale(1.08);box-shadow:0 4px 16px rgba(99,102,241,0.5)}}';
            document.head.appendChild(style);
        }
        var btn = document.createElement('button');
        btn.id = 'lp-media-float-btn';
        btn.textContent = '🎵';
        btn.style.cssText = 'position:fixed;bottom:80px;left:16px;z-index:9999;width:48px;height:48px;border-radius:50%;border:2px solid #6366f1;background:#6366f1;color:white;font-size:1.4em;cursor:pointer;box-shadow:0 2px 8px rgba(99,102,241,0.3);animation:lp-media-pulse 2s ease-in-out infinite;display:flex;align-items:center;justify-content:center';
        btn.title = 'מדיה';
        btn.addEventListener('click', function() {
            // If floating audio player exists, toggle its visibility
            var floatingPlayer = document.getElementById('media-floating-player');
            if (floatingPlayer) {
                if (floatingPlayer.style.display === 'none') {
                    floatingPlayer.style.display = '';
                    btn.textContent = '→';
                } else {
                    floatingPlayer.style.display = 'none';
                    btn.textContent = '🎵';
                }
                return;
            }
            // No audio playing — open shortcut dialog to browse media
            if (typeof MediaStorage !== 'undefined' && MediaStorage.showShortcutDialog) {
                MediaStorage.showShortcutDialog();
            }
        });
        // Watch for floating player creation/removal to update icon
        var _iconObserver = new MutationObserver(function() {
            // Don't override if dict is open (dict toggle controls the icon)
            if (_presenterCtx && _presenterCtx.dictOpen) return;
            var fp = document.getElementById('media-floating-player');
            if (fp) { btn.textContent = '→'; btn.style.background = '#0891b2'; btn.style.borderColor = '#0891b2'; }
            else { btn.textContent = '🎵'; btn.style.background = '#6366f1'; btn.style.borderColor = '#6366f1'; }
        });
        _iconObserver.observe(document.body, { childList: true });
        document.body.appendChild(btn);
    }
    function _removeMediaButton() {
        var btn = document.getElementById('lp-media-float-btn');
        if (btn) btn.remove();
    }
    function _onDictToggle(isOpen) {
        var btn = document.getElementById('lp-media-float-btn');
        if (!btn) return;
        if (isOpen) {
            btn.textContent = '←';
            btn.style.background = '#0891b2';
            btn.style.borderColor = '#0891b2';
            btn.style.animation = 'none';
        } else {
            // Restore based on floating player state
            var fp = document.getElementById('media-floating-player');
            if (fp && fp.style.display !== 'none') {
                btn.textContent = '→';
                btn.style.background = '#0891b2';
                btn.style.borderColor = '#0891b2';
            } else {
                btn.textContent = '🎵';
                btn.style.background = '#6366f1';
                btn.style.borderColor = '#6366f1';
                btn.style.animation = 'lp-media-pulse 2s ease-in-out infinite';
            }
        }
    }

    // Convert YouTube URL to embeddable URL
    function _youtubeToEmbed(url) {
        if (!url) return '';
        var m;
        // https://www.youtube.com/watch?v=VIDEO_ID or https://youtube.com/watch?v=VIDEO_ID
        m = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/);
        if (m) return 'https://www.youtube.com/embed/' + m[1];
        // https://youtu.be/VIDEO_ID
        m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (m) return 'https://www.youtube.com/embed/' + m[1];
        // https://www.youtube.com/embed/VIDEO_ID (already embed)
        m = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
        if (m) return 'https://www.youtube.com/embed/' + m[1];
        // Not a recognized YouTube URL — return as-is (could be a direct video URL)
        return '';
    }

    // --- Server Sync ---

    const API_LESSONS = '/plonter/api/lessons_api.php';

    function _serverCall(action, data) {
        if (typeof PlonterAuth === 'undefined' || !PlonterAuth.isLoggedIn()) {
            return Promise.reject(new Error('Not logged in'));
        }
        var opts = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + PlonterAuth.getToken()
            },
            body: JSON.stringify(Object.assign({ action: action }, data || {}))
        };
        return fetch(API_LESSONS, opts).then(function(res) {
            return res.json().then(function(json) {
                if (!res.ok) throw new Error(json.error || 'Server error');
                return json;
            });
        });
    }

    // BUG 7 — the '☁️ גיבוי לענן' header button. Backups now go EXCLUSIVELY
    // through ContentSync (content_api — the single source of truth), never
    // through the legacy lessons_api. lessons_api functions below are kept
    // (additive rule) but no longer written to from the UI. This guarantees a
    // backup creates a content_api row that pulls cross-device.
    function syncToServer() {
        var lessons = loadLessons();
        if (lessons.length === 0) {
            MessageManager.show('אין שיעורים לסנכרון', 'info');
            return Promise.resolve();
        }
        if (typeof ContentSync === 'undefined' ||
            typeof ContentSync.save !== 'function' ||
            typeof ContentSync.isLoggedIn !== 'function' || !ContentSync.isLoggedIn()) {
            MessageManager.show('כדי לגבות לענן יש להתחבר', 'warning');
            return Promise.resolve();
        }
        var syncable = lessons.filter(_isSyncableLesson);
        if (!syncable.length) {
            MessageManager.show('אין שיעורים לגיבוי', 'info');
            return Promise.resolve();
        }
        syncable.forEach(function(lesson) {
            try { ContentSync.save('lesson', lesson.id, lesson); }
            catch (e) { console.warn('[lessons] syncToServer ContentSync.save threw', e); }
        });
        var p = (typeof ContentSync.processQueue === 'function') ? ContentSync.processQueue() : Promise.resolve();
        return Promise.resolve(p).then(function() {
            var synced = syncable.filter(function(l) {
                return typeof ContentSync.isSynced === 'function' && ContentSync.isSynced('lesson', l.id);
            }).length;
            var failed = syncable.length - synced;
            if (failed > 0) {
                MessageManager.show(synced + ' שיעורים גובו לענן; ' + failed + ' עדיין בתהליך/נכשלו. השיעורים נשמרו מקומית.', synced ? 'warning' : 'error');
            } else {
                MessageManager.show(synced + ' שיעורים גובו לענן', 'success');
            }
        });
    }

    function loadFromServer() {
        return _serverCall('list').then(function(data) {
            return data.lessons || [];
        });
    }

    function saveToServer(lesson) {
        if (!_isSyncableLesson(lesson)) {
            return Promise.reject(new Error('Temporary lesson cannot be backed up'));
        }
        if (lesson.serverId) {
            return _serverCall('update', {
                id: lesson.serverId,
                title: lesson.title,
                description: lesson.description,
                pages: lesson.pages
            });
        }
        return _serverCall('create', {
            title: lesson.title,
            description: lesson.description,
            pages: lesson.pages
        }).then(function(result) {
            if (result && result.id) {
                lesson.serverId = result.id;
                _persistLessonServerId(lesson.id, result.id);
            }
            return result;
        });
    }

    function shareLesson(serverId) {
        return _serverCall('share', { id: serverId });
    }

    function loadSharedLesson(code) {
        return fetch(API_LESSONS + '?action=get_shared&code=' + encodeURIComponent(code))
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.error) throw new Error(data.error);
                return data.lesson;
            });
    }

    function cloneSharedLesson(code) {
        return _serverCall('clone', { code: code });
    }

    // Small confirm dialog that appears before the login form so the user
    // understands why login is required. Yes → onYes() (typically opens
    // the login popup). No → just dismiss.
    function _showLoginConfirmForBackup(lesson, onYes) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
        var dlg = document.createElement('div');
        dlg.style.cssText = 'background:white;border-radius:16px;padding:24px;max-width:380px;width:90%;direction:rtl;text-align:right;box-shadow:0 8px 32px rgba(0,0,0,0.2)';
        dlg.innerHTML =
            '<h3 style="color:#0d9488;margin:0 0 10px 0;text-align:center">\u05D2\u05D9\u05D1\u05D5\u05D9 \u05DC\u05E9\u05E8\u05EA</h3>' +
            '<p style="margin:0 0 18px 0;font-size:0.95em;color:#334155;text-align:center;line-height:1.5">\u05DB\u05D3\u05D9 \u05DC\u05D4\u05E2\u05DC\u05D5\u05EA \u05D0\u05EA \u05D4\u05E9\u05D9\u05E2\u05D5\u05E8 "<b>' + escapeHtml(lesson.title) + '</b>" \u05DC\u05E9\u05E8\u05EA \u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05EA\u05D7\u05D1\u05E8 \u05DC\u05DE\u05E9\u05EA\u05DE\u05E9. \u05DC\u05D4\u05EA\u05D7\u05D1\u05E8 \u05E2\u05DB\u05E9\u05D9\u05D5?</p>' +
            '<div style="display:flex;gap:10px;justify-content:center">' +
            '<button id="login-confirm-yes" style="padding:10px 24px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05DB\u05DF, \u05D4\u05EA\u05D7\u05D1\u05E8</button>' +
            '<button id="login-confirm-no" style="padding:10px 24px;background:#e5e7eb;color:#333;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05DC\u05D0, \u05D1\u05D9\u05D8\u05D5\u05DC</button></div>';
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);
        document.getElementById('login-confirm-no').onclick = function() { overlay.remove(); };
        document.getElementById('login-confirm-yes').onclick = function() {
            overlay.remove();
            if (typeof onYes === 'function') onYes();
        };
    }

    // Self-contained login popup that logs the user in and then fires a
    // backup callback. Bypasses AuthEmail.showLogin because its widget
    // rendered empty for at least one mobile user (see 2026-04-18 report).
    // Talks directly to api/auth_email.php with action=login, writes the
    // same localStorage keys AuthEmail uses, and updates #auth-status so
    // the header shows the logged-in state without a full reload.
    function _showBackupLoginPrompt(lesson, onSuccessBackup) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
        var dlg = document.createElement('div');
        dlg.style.cssText = 'background:white;border-radius:16px;padding:24px;max-width:400px;width:90%;direction:rtl;text-align:right;box-shadow:0 8px 32px rgba(0,0,0,0.2)';
        dlg.innerHTML =
            '<h3 style="color:#0d9488;margin:0 0 10px 0;text-align:center">\u05D4\u05EA\u05D7\u05D1\u05E8 \u05DB\u05D3\u05D9 \u05DC\u05D2\u05D1\u05D5\u05EA</h3>' +
            '<p style="margin:0 0 16px 0;font-size:0.88em;color:#64748b;text-align:center">\u05DB\u05D3\u05D9 \u05DC\u05D4\u05E2\u05DC\u05D5\u05EA \u05D0\u05EA "<b>' + escapeHtml(lesson.title) + '</b>" \u05DC\u05E9\u05E8\u05EA, \u05D4\u05EA\u05D7\u05D1\u05E8 \u05E7\u05D5\u05D3\u05DD.</p>' +
            '<label style="font-weight:bold;font-size:0.9em">\u05DE\u05D9\u05D9\u05DC \u05D0\u05D5 \u05E9\u05DD \u05DE\u05E9\u05EA\u05DE\u05E9:</label>' +
            '<input type="text" id="backup-login-email" dir="ltr" autocomplete="username" style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 10px 0;box-sizing:border-box">' +
            '<label style="font-weight:bold;font-size:0.9em">\u05E1\u05D9\u05E1\u05DE\u05D4:</label>' +
            '<input type="password" id="backup-login-pass" dir="ltr" autocomplete="current-password" style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 14px 0;box-sizing:border-box">' +
            '<div id="backup-login-error" style="color:#dc2626;font-size:0.85em;margin-bottom:8px;display:none;text-align:center"></div>' +
            '<div style="display:flex;gap:10px;justify-content:center">' +
            '<button id="backup-login-btn" style="padding:10px 24px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05D4\u05EA\u05D7\u05D1\u05E8 \u05D5\u05D2\u05D1\u05D4</button>' +
            '<button id="backup-login-cancel" style="padding:10px 24px;background:#e5e7eb;color:#333;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05D1\u05D9\u05D8\u05D5\u05DC</button></div>';
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);
        setTimeout(function() {
            var em = document.getElementById('backup-login-email');
            if (em) em.focus();
        }, 0);

        var errEl = document.getElementById('backup-login-error');
        document.getElementById('backup-login-cancel').onclick = function() { overlay.remove(); };

        function _loginIdToEmail(loginId) {
            loginId = String(loginId || '').trim();
            if (!loginId || loginId.indexOf('@') >= 0) return loginId;
            return loginId.toLowerCase().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '').replace(/^[._-]+|[._-]+$/g, '') + '@plonter.local';
        }

        function _submit() {
            var email = document.getElementById('backup-login-email').value.trim();
            var pass = document.getElementById('backup-login-pass').value;
            if (!email || !pass) { errEl.textContent = 'מלא מייל וסיסמה'; errEl.style.display = 'block'; return; }
            var btn = document.getElementById('backup-login-btn');
            btn.disabled = true; btn.textContent = '...';
            fetch('/plonter/api/auth_email.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', email: _loginIdToEmail(email), password: pass })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data && data.ok) {
                    localStorage.setItem('plonter_auth_token', data.token);
                    localStorage.setItem('plonter_auth_token_user', JSON.stringify(data.user || {}));
                    // Replay the data-owner flow: this inline login bypasses
                    // PlonterAuth.onLogin, so without this the privacy clear
                    // (wipe previous user's lessons/texts/sentences from
                    // localStorage) + plonter:authchange event never fire
                    // and user B would see user A's leftover content.
                    if (typeof PlonterAuth !== 'undefined' &&
                        typeof PlonterAuth.syncOwnerAndClear === 'function') {
                        try { PlonterAuth.syncOwnerAndClear(data.user || {}); }
                        catch (_) {}
                    }
                    overlay.remove();
                    try {
                        var authStatus = document.getElementById('auth-status');
                        if (authStatus) {
                            var u = data.user || {};
                            var displayName = ((u.first_name || '') + ' ' + (u.last_name || '')).trim();
                            var greeting = displayName ? 'שלום ' + escapeHtml(displayName) : 'מחובר';
                            authStatus.innerHTML =
                                '<span style="color:white;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,0.2)">' + greeting + '</span>' +
                                ' <button id="auth-logout-btn" style="padding:4px 12px;border:1px solid #e0e0e0;border-radius:6px;background:#f1f5f9;color:#64748b;cursor:pointer;font-size:0.85em;font-weight:bold">יציאה</button>';
                            var lo = document.getElementById('auth-logout-btn');
                            if (lo) lo.addEventListener('click', function() {
                                if (confirm('לצאת מהמערכת?')) {
                                    if (typeof PlonterAuth !== 'undefined' && typeof PlonterAuth.logout === 'function') PlonterAuth.logout();
                                    else { localStorage.removeItem('plonter_auth_token'); localStorage.removeItem('plonter_auth_token_user'); location.reload(); }
                                }
                            });
                        }
                    } catch (_) {}
                    if (typeof onSuccessBackup === 'function') {
                        try { onSuccessBackup(); } catch (e) { console.error('[backup-login] callback failed:', e); }
                    }
                    try { renderLessonsList(); } catch (_) {}
                    if (typeof MessageManager !== 'undefined') {
                        MessageManager.show('מחובר — השיעור מגובה', 'success');
                    }
                } else {
                    btn.disabled = false; btn.textContent = 'התחבר וגבה';
                    errEl.textContent = (data && data.error) || 'שגיאה בהתחברות';
                    errEl.style.display = 'block';
                }
            }).catch(function() {
                btn.disabled = false; btn.textContent = 'התחבר וגבה';
                errEl.textContent = 'שגיאת תקשורת';
                errEl.style.display = 'block';
            });
        }

        document.getElementById('backup-login-btn').onclick = _submit;
        document.getElementById('backup-login-email').addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); document.getElementById('backup-login-pass').focus(); }
        });
        document.getElementById('backup-login-pass').addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); _submit(); }
            if (ev.key === 'Escape') { ev.preventDefault(); overlay.remove(); }
        });
    }

    // Popup that offers to clone a demo lesson with an editable title.
    // Input is pre-filled with the original title and cursor placed at the
    // end of the field so the user can edit with minimal friction.
    function _showCloneDemoDialog(lesson) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
        var dlg = document.createElement('div');
        dlg.style.cssText = 'background:white;border-radius:16px;padding:24px;max-width:440px;width:90%;direction:rtl;text-align:right;box-shadow:0 8px 32px rgba(0,0,0,0.2)';
        dlg.innerHTML =
            '<h3 style="color:#0d9488;margin:0 0 10px 0;text-align:center">\u05E9\u05DB\u05E4\u05DC \u05E9\u05D9\u05E2\u05D5\u05E8 \u05DC\u05E2\u05E8\u05D9\u05DB\u05D4</h3>' +
            '<p style="margin:0 0 14px 0;font-size:0.88em;color:#64748b;text-align:center">\u05D4-JSON \u05E9\u05DC \u05D4\u05E9\u05D9\u05E2\u05D5\u05E8 \u05D4\u05D5\u05E2\u05EA\u05E7 \u05DC\u05DC\u05D5\u05D7 \ud83d\udccb<br>\u05E8\u05D5\u05E6\u05D4 \u05DC\u05D9\u05E6\u05D5\u05E8 \u05E9\u05DB\u05E4\u05D5\u05DC \u05D4\u05E9\u05D9\u05E2\u05D5\u05E8 \u05E2\u05D1\u05D5\u05E8 \u05E2\u05E8\u05D9\u05DB\u05D4?</p>' +
            '<label style="font-weight:bold;font-size:0.9em">\u05E9\u05DD:</label>' +
            '<input type="text" id="clone-demo-title" dir="rtl" value="' + escapeHtml(lesson.title).replace(/"/g, '&quot;') + '" style="width:100%;padding:10px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:1em;margin:4px 0 16px 0;box-sizing:border-box">' +
            '<div style="display:flex;gap:10px;justify-content:center">' +
            '<button id="clone-demo-save" style="padding:10px 24px;background:#0d9488;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05E6\u05D5\u05E8 \u05E9\u05DB\u05E4\u05D5\u05DC</button>' +
            '<button id="clone-demo-cancel" style="padding:10px 24px;background:#e5e7eb;color:#333;border:none;border-radius:10px;cursor:pointer;font-weight:bold;font-size:1em">\u05D1\u05D9\u05D8\u05D5\u05DC</button></div>';
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);
        var input = document.getElementById('clone-demo-title');
        setTimeout(function() {
            input.focus();
            var len = input.value.length;
            input.setSelectionRange(len, len);
        }, 0);
        document.getElementById('clone-demo-cancel').onclick = function() { overlay.remove(); };
        document.getElementById('clone-demo-save').onclick = function() {
            var newTitle = input.value.trim() || lesson.title;
            var cloned = {
                id: 'lesson_' + Date.now(),
                local_id: null,
                title: newTitle,
                description: lesson.description || '',
                category: _getLessonCategory(lesson),
                pages: JSON.parse(JSON.stringify(lesson.pages || [])),
                source_id: lesson.source_id || lesson.id || null,
                source_type: lesson.source_type || 'demo'
            };
            cloned.local_id = cloned.id;
            if (lesson.audioUrl) cloned.audioUrl = lesson.audioUrl;
            if (lesson.audioTitle) cloned.audioTitle = lesson.audioTitle;
            if (!_isLoggedInForLessonDrafts()) cloned._createdAsGuest = true;
            var existing = loadLessons();
            existing.push(cloned);
            saveLessons(existing);
            _focusLessonInCategory(cloned);
            overlay.remove();
            _viewerState = null;
            var viewer = document.getElementById('lesson-viewer');
            if (viewer) viewer.remove();
            openLessonEditor(cloned.id);
        };
        input.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter') document.getElementById('clone-demo-save').click();
            if (ev.key === 'Escape') { ev.preventDefault(); overlay.remove(); }
        });
    }

    // Load demo lessons from server
    function renderDemoLessons() {
        var container = document.getElementById('demo-lessons-list');
        if (!container) return;

        // Hardcoded demo share codes
        var demoCodes = ['demo_bbc', 'demo_jolani'];
        container.innerHTML = '<p style="color:#d1d5db;text-align:center;padding:8px">טוען...</p>';

        var promises = demoCodes.map(function(code) {
            return fetch(API_LESSONS + '?action=get_shared&code=' + code + '&_t=' + Date.now())
                .then(function(r) { return r.json(); })
                .then(function(data) { return data.lesson || null; })
                .catch(function() { return null; });
        });

        Promise.all(promises).then(function(lessons) {
            container.innerHTML = '';
            var found = false;
            var hiddenDemos = JSON.parse(localStorage.getItem('plonter_hidden_demos') || '[]');
            lessons.forEach(function(lesson, idx) {
                if (!lesson) return;
                if (hiddenDemos.indexOf(demoCodes[idx]) !== -1) return;
                found = true;
                var item = document.createElement('div');
                item.className = 'stage-item';
                item.style.cssText = 'cursor:pointer;border-right:4px solid #2563eb';
                var pagesCount = lesson.pages ? lesson.pages.length : 0;
                item.innerHTML =
                    '<div style="flex:1">' +
                        '<div style="font-weight:bold;color:#2563eb;font-size:1.05em">' + escapeHtml(lesson.title) + '</div>' +
                        '<div style="font-size:0.85em;color:#6b7280">' + pagesCount + ' דפים' +
                            (lesson.description ? ' · ' + escapeHtml(lesson.description) : '') +
                            (lesson.author_name ? ' · מאת ' + escapeHtml(lesson.author_name) : '') +
                        '</div>' +
                    '</div>';

                // "חדש!" starburst sticker — Amitai 2026-05-20: ONLY on specific
                // demo lessons (נאום אלג'ולאני = demo_jolani), NOT on demo_bbc
                // ("בדיקת יישום חזביביסי") and NEVER on user-created lessons.
                if (['demo_jolani'].indexOf(demoCodes[idx]) !== -1) {
                    _ensureNewBadgeCSS();
                    item.style.position = 'relative';
                    item.style.overflow = 'visible';
                    var demoBadgeWrap = document.createElement('div');
                    demoBadgeWrap.className = 'lp-newbadge-wrap';
                    demoBadgeWrap.innerHTML = _newBadgeMarkup();
                    item.appendChild(demoBadgeWrap);
                }

                item.addEventListener('click', function() {
                    var tempLesson = {
                        id: 'demo_' + demoCodes[idx],
                        local_id: 'demo_' + demoCodes[idx],
                        title: lesson.title,
                        description: lesson.description,
                        pages: lesson.pages,
                        source_id: lesson.source_id || demoCodes[idx],
                        source_type: 'demo',
                        _temporaryLesson: true,
                        _tempCreatedAt: new Date().toISOString()
                    };
                    // Copy audioUrl if present
                    if (lesson.audioUrl) tempLesson.audioUrl = lesson.audioUrl;
                    if (lesson.audioTitle) tempLesson.audioTitle = lesson.audioTitle;
                    // Store temporarily and start viewer
                    var existing = loadLessons();
                    // Remove any previous temp demo with same id
                    existing = existing.filter(function(l) { return l.id !== tempLesson.id; });
                    existing.push(tempLesson);
                    saveLessons(existing);
                    startLessonViewer(tempLesson.id);
                });

                // Copy-JSON + clone-for-edit button for demo lesson. Copies
                // the lesson JSON to the clipboard, then opens a popup that
                // asks whether to create an editable duplicate (with name
                // prefilled, cursor at end) and opens the editor on save.
                var copyCloneBtn = document.createElement('button');
                copyCloneBtn.className = 'btn btn-secondary';
                copyCloneBtn.innerHTML = '📋';
                copyCloneBtn.title = 'העתק JSON ושכפל לעריכה';
                copyCloneBtn.style.cssText = 'padding:4px 8px;font-size:0.9em;margin-right:8px';
                copyCloneBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var lessonJson = {
                        title: lesson.title,
                        description: lesson.description || '',
                        pages: lesson.pages || []
                    };
                    if (lesson.audioUrl) lessonJson.audioUrl = lesson.audioUrl;
                    if (lesson.audioTitle) lessonJson.audioTitle = lesson.audioTitle;
                    var jsonStr = JSON.stringify(lessonJson, null, 2);
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(jsonStr).catch(function() { _fallbackCopy(jsonStr); });
                    } else {
                        _fallbackCopy(jsonStr);
                    }
                    _showEditorToast('📋 JSON של השיעור הועתק');
                    _showCloneDemoDialog(lesson);
                });
                // Delete button — except for fatwa lesson
                var isFatwa = lesson.title && (lesson.title.indexOf('فتوى') !== -1 || lesson.title.indexOf('פתוא') !== -1);
                if (!isFatwa) {
                    var delDemoBtn = document.createElement('button');
                    delDemoBtn.innerHTML = '✕';
                    delDemoBtn.title = 'מחק שיעור לדוגמה';
                    delDemoBtn.style.cssText = 'position:absolute;top:4px;right:4px;background:none;border:none;font-size:1.1em;color:#9ca3af;cursor:pointer;padding:2px 6px;line-height:1';
                    delDemoBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (!confirm('למחוק את השיעור "' + lesson.title + '"?')) return;
                        // Mark as hidden in localStorage
                        var hidden = JSON.parse(localStorage.getItem('plonter_hidden_demos') || '[]');
                        if (hidden.indexOf(demoCodes[idx]) === -1) hidden.push(demoCodes[idx]);
                        localStorage.setItem('plonter_hidden_demos', JSON.stringify(hidden));
                        item.remove();
                    });
                    item.appendChild(delDemoBtn);
                }
                item.style.cssText += ';display:flex;align-items:center;position:relative';
                item.appendChild(copyCloneBtn);

                container.appendChild(item);
            });
            if (!found) {
                container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:8px">אין שיעורים לדוגמה עדיין</p>';
            }
        });
    }

    // Check for ?import_json= URL param — auto-fetch and import a lesson JSON file
    function checkAutoImportURL() {
        var params = new URLSearchParams(window.location.search);
        var jsonFile = params.get('import_json');
        if (!jsonFile) return false;

        // Remove the param from URL
        params.delete('import_json');
        var cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, '', cleanUrl);

        // Fetch and import
        fetch(jsonFile).then(function(r) { return r.text(); }).then(function(jsonStr) {
            var lesson = importLesson(jsonStr);
            if (lesson) {
                MessageManager.show('השיעור "' + lesson.title + '" יובא בהצלחה!', 'success');
                renderLessonsList();
                // Auto-open in presenter
                _startPresenter(lesson.id, 0);
            } else {
                MessageManager.show('ייבוא נכשל — JSON לא תקין', 'error');
            }
        }).catch(function(err) {
            MessageManager.show('שגיאה בטעינת קובץ: ' + err.message, 'error');
        });
        return true;
    }

    // Check for ?lesson= URL param on page load
    function checkSharedLessonURL() {
        // First check for auto-import
        if (checkAutoImportURL()) return;

        var params = new URLSearchParams(window.location.search);
        var code = params.get('lesson');
        if (!code) return;

        loadSharedLesson(code).then(function(lesson) {
            // Start viewer with the shared lesson data
            var viewerLesson = {
                id: 'shared_' + code,
                local_id: 'shared_' + code,
                title: lesson.title,
                description: lesson.description,
                pages: lesson.pages,
                author: lesson.author_name,
                isShared: true,
                shareCode: code,
                source_id: code,
                source_type: 'shared',
                _temporaryLesson: true,
                _tempCreatedAt: new Date().toISOString()
            };
            _startSharedViewer(viewerLesson);
        }).catch(function(err) {
            MessageManager.show('שיעור לא נמצא: ' + err.message, 'error');
        });
    }

    function _startSharedViewer(lesson) {
        if (!lesson || !lesson.pages || lesson.pages.length === 0) {
            MessageManager.show('שיעור ריק', 'error');
            return;
        }

        // Temporarily store for viewer
        var tempId = lesson.id;
        var existingLessons = loadLessons();
        existingLessons = existingLessons.filter(function(l) { return l.id !== tempId; });
        lesson._temporaryLesson = true;
        lesson._tempCreatedAt = lesson._tempCreatedAt || new Date().toISOString();
        lesson.local_id = lesson.local_id || lesson.id;
        existingLessons.push(lesson);
        saveLessons(existingLessons);

        startLessonViewer(tempId);

        // Remove temp after viewing
        setTimeout(function() {
            var lessons = loadLessons();
            saveLessons(lessons.filter(function(l) { return l.id !== tempId; }));
        }, 1000);
        window.addEventListener('pagehide', function _cleanupSharedLesson() {
            try {
                var lessons = loadLessons();
                saveLessons(lessons.filter(function(l) { return l.id !== tempId; }));
            } catch (_) {}
        }, { once: true });
    }

    // --- Media Warehouse ---
    // Module-scope tracking for in-flight uploads (survives popup close/reopen)
    var _mwActiveUploads = [];
    var _mwUploadIdSeq = 0;

    function _renderMwActiveUploads() {
        // PAGE-LEVEL floating indicator (on body) so an in-progress upload stays visible
        // even after the teacher leaves the media warehouse OR the lesson editor entirely.
        // The upload (fetch) keeps running regardless — this is its only on-screen progress,
        // so it must not live inside the editor/warehouse DOM (which gets torn down on exit).
        var container = document.getElementById('mw-global-uploads');
        if (!_mwActiveUploads.length) {
            if (container) { container.innerHTML = ''; container.style.display = 'none'; }
            return;
        }
        if (!container) {
            container = document.createElement('div');
            container.id = 'mw-global-uploads';
            container.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:100040;display:flex;flex-direction:column;gap:6px;direction:rtl;max-width:80vw';
            // Attach to <html> (not <body>) so switching to the vocab/אוצם tab — which
            // hides all body children via hideHostBehind() — does NOT hide this indicator
            // (Amitai 2026-06-17: entering אוצם hid the floating upload message).
            document.documentElement.appendChild(container);
        }
        if (!document.getElementById('mw-anim-style')) {
            var st = document.createElement('style'); st.id = 'mw-anim-style';
            st.textContent = '@keyframes mw-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(st);
        }
        container.style.display = 'flex';
        var html = '';
        _mwActiveUploads.forEach(function(u) {
            if (u.done) {
                html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:10px;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;font-weight:bold;font-size:0.9em;box-shadow:0 4px 14px rgba(0,0,0,0.12)">' +
                    '<span>✓</span><span>' + escapeHtml(u.title) + ' עלה</span></div>';
            } else {
                html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:10px;background:#f0fdfa;border:1px solid #99f6e4;color:#0d9488;font-weight:bold;font-size:0.9em;box-shadow:0 4px 14px rgba(0,0,0,0.12)">' +
                    '<span style="display:inline-block;animation:mw-spin 0.7s linear infinite">⏳</span>' +
                    '<span>מעלה את ' + escapeHtml(u.title) + '</span></div>';
            }
        });
        container.innerHTML = html;
    }

    function _openMediaWarehouse(lesson) {
        // Save cursor position to restore after closing
        var _savedFocus = document.activeElement;
        var _savedSelection = null;
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            try { _savedSelection = sel.getRangeAt(0).cloneRange(); } catch(e) {}
        }
        function _restoreCursor() {
            if (_savedFocus && _savedFocus.focus) {
                _savedFocus.focus();
                if (_savedSelection) {
                    var s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(_savedSelection);
                }
            }
        }

        // Collect slide media URLs for cross-reference badges
        var slideMediaUrls = {};
        for (var i = 0; i < lesson.pages.length; i++) {
            var p = lesson.pages[i];
            if ((p.type === 'image' || p.type === 'video') && (p.videoUrl || p.imageUrl)) {
                var url = p.videoUrl || p.imageUrl;
                if (!slideMediaUrls[url]) slideMediaUrls[url] = [];
                slideMediaUrls[url].push(i + 1);
            }
        }

        // Build popup. Guard against duplicates: if a warehouse dialog is already open
        // (e.g. the button got triggered twice), remove it first so they never stack
        // (Amitai 2026-06-17: had to press 'סגור' twice on two overlapping dialogs).
        var _existingWh = document.getElementById('editor-media-warehouse-overlay');
        if (_existingWh) _existingWh.remove();
        var overlay = document.createElement('div');
        overlay.id = 'editor-media-warehouse-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center';
        var popup = document.createElement('div');
        popup.style.cssText = 'background:white;border-radius:16px;padding:24px;max-width:600px;width:95%;max-height:85vh;overflow-y:auto;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,0.3)';
        popup.innerHTML = '<h2 style="margin:0 0 16px;font-size:1.2em">📦 מחסן מדיה — ' + escapeHtml(lesson.title) + '</h2>';

        // Section 1: Files in lesson folder
        var folderSection = document.createElement('div');
        var _folderHeaderEl = document.createElement('div');
        _folderHeaderEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
        var _folderHeaderSpan = document.createElement('span');
        _folderHeaderSpan.style.cssText = 'font-weight:bold;color:#0d9488;font-size:0.95em';
        _folderHeaderSpan.textContent = '📁 קבצים בתיקיית השיעור';
        var _newFolderBtn = document.createElement('button');
        _newFolderBtn.textContent = '➕ תיקייה חדשה';
        _newFolderBtn.style.cssText = 'padding:3px 10px;border:1px solid #0d9488;border-radius:6px;background:white;color:#0d9488;cursor:pointer;font-size:0.8em';
        _newFolderBtn.addEventListener('click', function() {
            if (!_currentFolderId) { MessageManager.show('תיקיית שיעור לא נמצאה', 'error'); return; }
            var name = window.prompt('שם התיקייה החדשה:');
            if (!name || !name.trim()) return;
            _newFolderBtn.disabled = true;
            MediaStorage.apiCall('create_folder', { name: name.trim(), parent_id: _currentFolderId }).then(function() {
                return MediaStorage.loadFolders();
            }).then(function() {
                _newFolderBtn.disabled = false;
                MessageManager.show('תיקייה נוצרה: ' + name.trim(), 'success');
                _reloadCurrentFolder();
            }).catch(function(err) {
                _newFolderBtn.disabled = false;
                MessageManager.show('שגיאה: ' + (err.message || err), 'error');
            });
        });
        _folderHeaderEl.appendChild(_folderHeaderSpan);
        _folderHeaderEl.appendChild(_newFolderBtn);
        folderSection.appendChild(_folderHeaderEl);
        var folderItemsEl = document.createElement('div');
        folderItemsEl.id = 'mw-folder-items';
        folderItemsEl.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af">טוען...</div>';
        folderSection.appendChild(folderItemsEl);
        popup.appendChild(folderSection);

        var _lessonFolderId = null;
        var _currentFolderId = null;
        var _currentFolderName = null;
        var _mwCurrentItems = [];

        function _renderFolderItems(items, hasSubfolders) {
            _mwCurrentItems = items;
            if (!items.length) {
                if (!hasSubfolders) {
                    var _emptyEl = document.createElement('div');
                    _emptyEl.style.cssText = 'text-align:center;padding:16px;color:#9ca3af;font-size:0.9em';
                    _emptyEl.textContent = 'אין קבצים בתיקייה. הוסף מדיה מלמטה.';
                    folderItemsEl.appendChild(_emptyEl);
                }
                return;
            }
            items.forEach(function(item) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;margin:4px 0;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0';
                var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                // Real thumbnail (not just an icon). Relative 'uploads/..' urls live at
                // the site root (/plonter/), NOT under /clone/ — resolve to absolute or
                // the browser hits the SPA HTML fallback and the image looks broken.
                var _absSrc = _absUrl(item.url);
                var _thumbFallback = '<div style=&quot;width:56px;height:42px;background:#eef2ff;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.3em;flex-shrink:0&quot;>' + icon + '</div>';
                var thumb;
                if (item.media_type === 'image' && _absSrc) {
                    thumb = '<img src="' + escapeAttr(_absSrc) + '" style="width:56px;height:42px;border-radius:6px;object-fit:cover;flex-shrink:0;background:#f1f5f9;cursor:pointer" title="הגדל" onerror="this.outerHTML=\'' + _thumbFallback + '\'">';
                } else if (item.media_type === 'video' && _absSrc) {
                    thumb = '<video src="' + escapeAttr(_absSrc) + '#t=0.1" muted preload="metadata" style="width:56px;height:42px;border-radius:6px;object-fit:cover;flex-shrink:0;background:#000;cursor:pointer"></video>';
                } else {
                    thumb = '<div style="width:56px;height:42px;background:#eef2ff;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.3em;flex-shrink:0">' + icon + '</div>';
                }
                var shortcutBadge = item.source_type === 'shortcut' ? ' <span style="font-size:0.7em;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:4px">🔗 קיצור</span>' : '';
                // Slide usage badge
                var slideBadge = '';
                if (item.url && slideMediaUrls[item.url]) {
                    var slides = slideMediaUrls[item.url];
                    slideBadge = ' <span style="font-size:0.7em;background:#d1fae5;color:#065f46;padding:1px 6px;border-radius:10px">📍 שקף ' + slides.join(', ') + '</span>';
                }
                row.innerHTML = thumb +
                    '<div style="flex:1;min-width:0">' +
                        '<div style="font-weight:bold;font-size:0.9em;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + escapeHtml(item.title) + shortcutBadge + slideBadge + '</div>' +
                        '<div style="font-size:0.75em;color:#9ca3af;direction:ltr;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + escapeHtml(item.url || '') + '</div>' +
                    '</div>' +
                    '<button data-action="rename" onclick="event.stopPropagation()" style="background:white;color:#374151;border:1px solid #d1d5db;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:0.8em;flex-shrink:0" title="שנה שם">✏️</button>' +
                    '<button data-action="move" onclick="event.stopPropagation()" style="background:white;color:#374151;border:1px solid #d1d5db;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:0.8em;flex-shrink:0" title="העבר לתיקייה אחרת">↗</button>' +
                    '<button data-action="delete" onclick="event.stopPropagation()" style="background:#ef4444;color:white;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:0.8em;flex-shrink:0" title="מחק">✕</button>';
                // Rename handler
                var renameBtn = row.querySelector('[data-action="rename"]');
                renameBtn.addEventListener('click', (function(mediaItem) {
                    return function() {
                        var newTitle = window.prompt('שם חדש:', mediaItem.title);
                        if (!newTitle || newTitle === mediaItem.title) return;
                        MediaStorage.apiCall('rename_media', { id: mediaItem.id, title: newTitle }).then(function() {
                            MessageManager.show('השם עודכן', 'success');
                            _reloadCurrentFolder();
                        }).catch(function(err) {
                            MessageManager.show('שגיאה: ' + (err.message || err), 'error');
                        });
                    };
                })(item));
                // Move handler
                var moveBtn = row.querySelector('[data-action="move"]');
                moveBtn.addEventListener('click', (function(mediaItem) {
                    return function() {
                        MediaStorage.showMoveDialog(mediaItem.id, (mediaItem.folder_id || _currentFolderId));
                        // Reload after move
                        setTimeout(function() { _reloadCurrentFolder(); }, 1500);
                    };
                })(item));
                // Delete handler with slide warning
                var delBtn = row.querySelector('[data-action="delete"]');
                delBtn.addEventListener('click', (function(mediaItem) {
                    return function() {
                        var usedInSlides = mediaItem.url && slideMediaUrls[mediaItem.url];
                        var msg = 'למחוק את "' + mediaItem.title + '"?';
                        if (usedInSlides) {
                            msg = '⚠️ הקובץ משמש בשקפים: ' + slideMediaUrls[mediaItem.url].join(', ') + '!\nלמחוק בכל זאת?';
                        }
                        if (!confirm(msg)) return;
                        // Blink the row red immediately until the server confirms the delete (Amitai 2026-06-17)
                        if (!document.getElementById('mw-blink-style')) {
                            var bs = document.createElement('style'); bs.id = 'mw-blink-style';
                            bs.textContent = '@keyframes mw-blink{0%,100%{opacity:1}50%{opacity:0.35}}';
                            document.head.appendChild(bs);
                        }
                        row.style.background = '#fee2e2';
                        row.style.border = '1px solid #ef4444';
                        row.style.animation = 'mw-blink 0.7s ease-in-out infinite';
                        MediaStorage.apiCall('delete_media', { id: mediaItem.id }).then(function() {
                            row.remove();
                            if (usedInSlides) {
                                MessageManager.show('⚠️ נמחק! שקפים ' + slideMediaUrls[mediaItem.url].join(', ') + ' כעת ללא מדיה.', 'warning');
                            } else {
                                MessageManager.show('נמחק', 'success');
                            }
                        }).catch(function(err) {
                            row.style.animation = ''; row.style.background = '#f8fafc'; row.style.border = '1px solid #e2e8f0';
                            MessageManager.show('שגיאה במחיקה: ' + (err.message || err), 'error');
                        });
                    };
                })(item));
                // Click thumbnail to enlarge (image) / play (video) in an overlay
                var thumbEl = row.querySelector('img, video');
                if (thumbEl && _absSrc && item.media_type !== 'audio') {
                    thumbEl.addEventListener('click', (function(src, mt) {
                        return function() {
                            var ov = document.createElement('div');
                            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out';
                            ov.innerHTML = (mt === 'video')
                                ? '<video src="' + escapeAttr(src) + '" controls autoplay style="max-width:95%;max-height:95%;border-radius:8px"></video>'
                                : '<img src="' + escapeAttr(src) + '" style="max-width:95%;max-height:95%;border-radius:8px">';
                            ov.addEventListener('click', function() { ov.remove(); });
                            document.body.appendChild(ov);
                        };
                    })(_absSrc, item.media_type));
                }
                folderItemsEl.appendChild(row);
            });
        }

        // Reload the currently open folder (or lesson root): fetch media + subfolders, re-render section 1.
        function _reloadCurrentFolder() {
            var fid = _currentFolderId;
            if (!fid) return;
            var isRoot = fid === _lessonFolderId;
            // Update header label
            _folderHeaderSpan.textContent = isRoot ? '📁 קבצים בתיקיית השיעור' : '📁 ' + (_currentFolderName || '');
            folderItemsEl.innerHTML = '<div style="text-align:center;padding:8px;color:#9ca3af;font-size:0.85em">טוען...</div>';
            MediaStorage.apiCall('list_media', { folder_id: fid }).then(function(data) {
                var items = data.items || [];
                var subfolders = (typeof MediaStorage !== 'undefined') ? MediaStorage.getChildFolders(parseInt(fid)) : [];
                folderItemsEl.innerHTML = '';
                // Back row when inside a subfolder
                if (!isRoot) {
                    var backRow = document.createElement('div');
                    backRow.style.cssText = 'padding:6px 8px;border-radius:6px;cursor:pointer;background:#eef2ff;color:#4f46e5;margin-bottom:4px;font-size:0.85em;font-weight:bold;display:flex;align-items:center;gap:4px';
                    backRow.textContent = '⬅ חזרה לתיקיית השיעור';
                    backRow.addEventListener('click', function() {
                        _currentFolderId = _lessonFolderId;
                        _currentFolderName = null;
                        _reloadCurrentFolder();
                    });
                    folderItemsEl.appendChild(backRow);
                }
                // Subfolder rows
                subfolders.forEach(function(sf) {
                    var sfEl = document.createElement('div');
                    sfEl.style.cssText = 'padding:6px 10px;border-radius:6px;cursor:pointer;background:#f9fafb;margin-bottom:2px;font-size:0.85em;border:1px solid #e5e7eb;display:flex;align-items:center;gap:6px';
                    sfEl.innerHTML = '<span>📁</span><span>' + escapeHtml(sf.name) + '</span>';
                    sfEl.addEventListener('click', (function(sf) { return function() {
                        _currentFolderId = parseInt(sf.id);
                        _currentFolderName = sf.name;
                        _reloadCurrentFolder();
                    }; })(sf));
                    folderItemsEl.appendChild(sfEl);
                });
                // Media rows
                _renderFolderItems(items, subfolders.length > 0);
            }).catch(function(err) {
                folderItemsEl.innerHTML = '<div style="color:#ef4444;padding:8px;font-size:0.9em">שגיאה בטעינה: ' + escapeHtml(err && err.message ? err.message : '') + '</div>';
            });
        }

        // Load lesson folder media — must ensure system folders are loaded first
        // (getLessonFolderId reads from the local `folders` array; if empty it rejects)
        if (typeof MediaStorage !== 'undefined') {
            MediaStorage.ensureSystemFolders().then(function() {
                return MediaStorage.getLessonFolderMedia(lesson.title);
            }).then(function(result) {
                _lessonFolderId = result.folderId;
                _currentFolderId = result.folderId;
                _reloadCurrentFolder();
            }).catch(function(err) {
                folderItemsEl.innerHTML = '<div style="color:#ef4444;padding:8px">שגיאה בטעינת תיקייה: ' + (err && err.message ? err.message : '') + '</div>';
            });
        } else {
            folderItemsEl.innerHTML = '<div style="color:#9ca3af;padding:8px">מחסן מדיה לא זמין</div>';
        }

        // Divider
        var divider = document.createElement('div');
        divider.style.cssText = 'height:1px;background:#e2e8f0;margin:16px 0';
        popup.appendChild(divider);

        // Section 2: Add media options
        var addSection = document.createElement('div');
        addSection.innerHTML = '<div style="font-weight:bold;margin-bottom:8px;color:#6366f1;font-size:0.95em">➕ הוסף מדיה לשיעור</div>';

        // Add options: link, upload, search main storage
        var optionsRow = document.createElement('div');
        optionsRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap';
        var addLinkBtn = document.createElement('button');
        addLinkBtn.textContent = '🔗 קישור';
        addLinkBtn.style.cssText = 'padding:8px 16px;border:2px solid #6366f1;border-radius:8px;background:white;color:#6366f1;font-weight:bold;cursor:pointer;font-size:0.9em';
        addLinkBtn.addEventListener('click', function() {
            if (!_currentFolderId) { MessageManager.show('תיקיית שיעור לא נמצאה', 'error'); return; }
            _mwOrderAddSection('link'); // #1469: link form up, search + folder-browser below
            _showAddLinkInWarehouse();
        });
        var uploadBtn = document.createElement('button');
        uploadBtn.textContent = '📤 העלאה';
        uploadBtn.style.cssText = 'padding:8px 16px;border:2px solid #6366f1;border-radius:8px;background:white;color:#6366f1;font-weight:bold;cursor:pointer;font-size:0.9em';
        uploadBtn.addEventListener('click', function() {
            if (!_currentFolderId) { MessageManager.show('תיקיית שיעור לא נמצאה', 'error'); return; }
            _mwOrderAddSection('upload'); // #1469: upload form up, search + folder-browser below
            _showUploadInWarehouse();
        });
        var shortcutBtn = document.createElement('button'); // #9: shortcut button
        shortcutBtn.textContent = '🔗 קיצור דרך';
        shortcutBtn.style.cssText = 'padding:8px 16px;border:2px solid #0891b2;border-radius:8px;background:white;color:#0891b2;font-weight:bold;cursor:pointer;font-size:0.9em';
        shortcutBtn.addEventListener('click', function() {
            _mwOrderAddSection('shortcut'); // #1469: search + folder-browser up, forms below
            searchDiv.style.display = '';
            if (searchDiv.scrollIntoView) searchDiv.scrollIntoView({behavior:'smooth',block:'center'});
            var si = document.getElementById('mw-shortcut-search');
            if (si) setTimeout(function(){ si.focus(); }, 150);
        });
        optionsRow.appendChild(addLinkBtn);
        optionsRow.appendChild(uploadBtn);
        optionsRow.appendChild(shortcutBtn);
        addSection.appendChild(optionsRow);

        // Search main storage for shortcuts
        var searchDiv = document.createElement('div');
        searchDiv.innerHTML = '<div style="font-size:0.85em;color:#6b7280;margin-bottom:6px">🔍 חפש במחסן הראשי — צור קיצור דרך:</div>';
        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'mw-shortcut-search';
        searchInput.placeholder = 'חפש קובץ במחסן הראשי...';
        searchInput.dir = 'rtl';
        searchInput.style.cssText = 'width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:8px;font-size:0.9em;box-sizing:border-box';
        var searchResults = document.createElement('div');
        searchResults.id = 'mw-search-results';
        searchResults.style.cssText = 'max-height:200px;overflow-y:auto;margin-top:4px';

        var _searchTimer = null;
        searchInput.addEventListener('input', function() {
            clearTimeout(_searchTimer);
            var q = searchInput.value.trim();
            if (q.length < 2) { searchResults.innerHTML = ''; return; }
            _searchTimer = setTimeout(function() {
                MediaStorage.searchMainStorage(q).then(function(data) {
                    var items = data.items || [];
                    if (!items.length) {
                        searchResults.innerHTML = '<div style="padding:8px;color:#9ca3af;font-size:0.85em">לא נמצא</div>';
                        return;
                    }
                    searchResults.innerHTML = '';
                    items.forEach(function(item) {
                        var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                        var row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid #f3f4f6;cursor:pointer;border-radius:6px';
                        row.innerHTML = '<span>' + icon + '</span>' +
                            '<span style="flex:1;font-size:0.85em">' + escapeHtml(item.title) + '</span>' +
                            '<span style="font-size:0.7em;color:#6b7280">' + escapeHtml(item.folder_name || '') + '</span>' +
                            '<button style="background:#0d9488;color:white;border:none;border-radius:6px;padding:4px 10px;font-size:0.8em;cursor:pointer;white-space:nowrap">🔗 קיצור</button>';
                        row.querySelector('button').addEventListener('click', (function(mediaItem) {
                            return function(e) {
                                e.stopPropagation();
                                if (!_currentFolderId) { MessageManager.show('תיקיית שיעור לא נמצאה', 'error'); return; }
                                MediaStorage.createShortcut(mediaItem.id, _currentFolderId).then(function() {
                                    MessageManager.show('קיצור דרך נוצר: ' + mediaItem.title, 'success');
                                    // Reload folder items
                                    _reloadCurrentFolder();
                                }).catch(function(err) {
                                    MessageManager.show('שגיאה: ' + (err.message || err), 'error');
                                });
                            };
                        })(item));
                        searchResults.appendChild(row);
                    });
                });
            }, 300);
        });
        searchDiv.appendChild(searchInput);
        searchDiv.appendChild(searchResults);
        addSection.appendChild(searchDiv);

        // Folder browser section
        var browseDiv = document.createElement('div');
        browseDiv.style.cssText = 'margin-top:12px';
        browseDiv.innerHTML = '<div style="font-size:0.85em;color:#6b7280;margin-bottom:6px">📂 עלעל בתיקיות המחסן:</div>';
        var browseFoldersRow = document.createElement('div');
        browseFoldersRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px';
        var browseItemsEl = document.createElement('div');
        browseItemsEl.style.cssText = 'max-height:200px;overflow-y:auto';
        browseDiv.appendChild(browseFoldersRow);
        browseDiv.appendChild(browseItemsEl);
        addSection.appendChild(browseDiv);

        // Populate folder buttons
        if (typeof MediaStorage !== 'undefined') {
            MediaStorage.ensureSystemFolders().then(function() {
                var rootFolders = MediaStorage.getChildFolders(null);
                rootFolders.forEach(function(f) {
                    var icon = f.name === 'יוטיוב' ? '▶️' : f.name === 'קטעי שמע' ? '🎵' : f.name === 'תמונות' ? '🖼️' : f.name === 'שיעורים' ? '📚' : '📁';
                    var btn = document.createElement('button');
                    btn.textContent = icon + ' ' + f.name;
                    btn.style.cssText = 'padding:4px 10px;border:1px solid #e5e7eb;border-radius:6px;background:white;cursor:pointer;font-size:0.8em';
                    btn.addEventListener('click', function() {
                        // Highlight selected
                        browseFoldersRow.querySelectorAll('button').forEach(function(b) { b.style.borderColor = '#e5e7eb'; b.style.background = 'white'; });
                        btn.style.borderColor = '#0d9488';
                        btn.style.background = '#f0fdfa';
                        _loadBrowseFolder(f.id, browseItemsEl);
                    });
                    browseFoldersRow.appendChild(btn);
                });
            }).catch(function() {});
        }

        function _loadBrowseFolder(folderId, container) {
            container.innerHTML = '<div style="padding:6px;color:#6b7280;font-size:0.8em">טוען...</div>';
            MediaStorage.apiCall('list_media', { folder_id: folderId }).then(function(data) {
                var items = data.items || [];
                var subfolders = MediaStorage.getChildFolders(folderId);
                container.innerHTML = '';
                // Back button if not root
                // Show subfolders
                subfolders.forEach(function(sf) {
                    var sfEl = document.createElement('div');
                    sfEl.style.cssText = 'padding:6px 8px;border-radius:6px;cursor:pointer;background:#f9fafb;margin-bottom:2px;font-size:0.85em';
                    sfEl.textContent = '📁 ' + sf.name;
                    sfEl.addEventListener('click', function() { _loadBrowseFolder(sf.id, container); });
                    container.appendChild(sfEl);
                });
                // Show items with shortcut button
                items.forEach(function(item) {
                    var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                    var row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #f3f4f6';
                    row.innerHTML = '<span>' + icon + '</span>' +
                        '<span style="flex:1;font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(item.title) + '</span>' +
                        '<button style="background:#0d9488;color:white;border:none;border-radius:6px;padding:3px 8px;font-size:0.75em;cursor:pointer;white-space:nowrap">🔗 קיצור</button>';
                    row.querySelector('button').addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (!_currentFolderId) { MessageManager.show('תיקיית שיעור לא נמצאה', 'error'); return; }
                        MediaStorage.createShortcut(item.id, _currentFolderId).then(function() {
                            MessageManager.show('קיצור דרך נוצר: ' + item.title, 'success');
                            _reloadCurrentFolder();
                        }).catch(function(err) { MessageManager.show('שגיאה: ' + (err.message || err), 'error'); });
                    });
                    container.appendChild(row);
                });
                if (items.length === 0 && subfolders.length === 0) {
                    container.innerHTML = '<div style="padding:8px;color:#9ca3af;font-size:0.85em">ריק</div>';
                }
            }).catch(function(err) {
                container.innerHTML = '<div style="color:#ef4444;font-size:0.85em;padding:8px">' + err.message + '</div>';
            });
        }

        // Inline add-link form (hidden by default)
        var addLinkForm = document.createElement('div');
        addLinkForm.id = 'mw-add-link-form';
        addLinkForm.style.cssText = 'display:none;margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0';
        addLinkForm.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:8px">' +
            '<input type="text" id="mw-link-title" placeholder="כותרת" dir="rtl" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px">' +
            '<input type="hidden" id="mw-link-type" value="video">' +
            '</div>' +
            '<div id="mw-link-type-buttons" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">' +
            '<button type="button" data-mw-link-type="video" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🎬</span><span>סרטון</span></button>' +
            '<button type="button" data-mw-link-type="audio" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🎵</span><span>קטע שמע</span></button>' +
            '<button type="button" data-mw-link-type="image" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style=\"font-size:1.45em\">🖼️</span><span>תמונה</span></button>' +
            '</div>' +
            '<div style="display:flex;gap:6px">' +
            '<input type="text" id="mw-link-url" placeholder="קישור (URL)" dir="ltr" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px">' +
            '<button id="mw-link-submit" style="padding:8px 16px;background:#0d9488;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold">הוסף</button>' +
            '</div>';
        addSection.appendChild(addLinkForm);

        // Inline upload form (hidden by default)
        var uploadForm = document.createElement('div');
        uploadForm.id = 'mw-upload-form';
        uploadForm.style.cssText = 'display:none;margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0';
        uploadForm.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:8px">' +
            '<input type="text" id="mw-upload-title" placeholder="כותרת" dir="rtl" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px">' +
            '<input type="hidden" id="mw-upload-type" value="audio">' +
            '</div>' +
            '<div id="mw-upload-type-buttons" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">' +
            '<button type="button" data-mw-upload-type="audio" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🎵</span><span>קטע שמע</span></button>' +
            '<button type="button" data-mw-upload-type="video" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🎬</span><span>סרטון</span></button>' +
            '<button type="button" data-mw-upload-type="image" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🖼️</span><span>תמונה</span></button>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:stretch">' +
            '<label for="mw-upload-file" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 12px;border:2px dashed #cbd5e1;border-radius:8px;background:white;color:#475569;cursor:pointer;font-weight:600;font-size:0.9em;box-sizing:border-box;min-height:44px">📎 בחר קובץ מהמחשב</label>' +
            '<input type="file" id="mw-upload-file" accept="audio/*,video/*,image/*" style="display:none">' +
            '<button id="mw-upload-submit" style="padding:10px 18px;background:#0d9488;color:white;border:2px solid #0d9488;border-radius:8px;cursor:pointer;font-weight:bold;font-size:0.9em;white-space:nowrap;box-sizing:border-box;min-height:44px">העלה</button>' +
            '</div>' +
            '<div id="mw-upload-filename" style="display:none;font-size:0.82em;color:#0f766e;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>' +
            '<div id="mw-upload-preview" style="display:none;margin-top:10px;padding:8px;border-radius:8px;background:#f0fdfa;border:1px solid #bae6fd;text-align:center"></div>' +
            '<div id="mw-upload-warning" style="display:none;color:#dc2626;font-weight:bold;font-size:1.05em;margin-top:8px;padding:8px 10px;border:1px solid #fca5a5;border-radius:8px;background:#fef2f2">⚠️ חכה! הקובץ עדיין לא עלה — לחץ על &quot;העלה&quot; כדי להעלות לשרת</div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin:12px 0 8px;color:#9ca3af;font-size:0.8em"><div style="flex:1;height:1px;background:#e5e7eb"></div>או<div style="flex:1;height:1px;background:#e5e7eb"></div></div>' +
            '<button type="button" id="mw-upload-folder-btn" style="width:100%;padding:10px;border-radius:10px;border:2px dashed #6366f1;background:#eef2ff;color:#4338ca;cursor:pointer;font-weight:bold">📂 העלה תיקייה שלמה (מיון אוטומטי לפי סוג)</button>' +
            '<input type="file" id="mw-upload-folder-input" webkitdirectory multiple style="display:none">';
        addSection.appendChild(uploadForm);

        popup.appendChild(addSection);

        // Add-section ORDERING per mode (Amitai bd1 #1469): keep the search box AND the
        // warehouse folder-browser (browseDiv, 'עלעל בתיקיות המחסן') together —
        //  • 'קיצור דרך' (shortcut) → search + folder-browser UP (right under the mode
        //    buttons), the two forms below;
        //  • 'קישור'/'העלאה' (link/upload) → the active form UP, search + folder-browser DOWN.
        // Re-appends the four movable children in the desired order (the header + the mode-
        // buttons row stay pinned at the top). Supersedes the older #10 logic, which moved
        // only the search box and left the folder-browser stranded below the form.
        function _mwOrderAddSection(mode) {
            var order = (mode === 'shortcut')
                ? [searchDiv, browseDiv, addLinkForm, uploadForm]
                : (mode === 'link')
                    ? [addLinkForm, searchDiv, browseDiv, uploadForm]
                    : [uploadForm, searchDiv, browseDiv, addLinkForm];
            order.forEach(function(el) { if (el) addSection.appendChild(el); });
        }

        // Media-type picker state
        var linkTypeInput = addLinkForm.querySelector('#mw-link-type');
        var linkTypeButtons = addLinkForm.querySelectorAll('[data-mw-link-type]');
        var uploadTypeInput = uploadForm.querySelector('#mw-upload-type');
        var uploadTypeButtons = uploadForm.querySelectorAll('[data-mw-upload-type]');
        var uploadFileInput = uploadForm.querySelector('#mw-upload-file');
        var uploadTitleInput = uploadForm.querySelector('#mw-upload-title');
        var uploadFileLabel = uploadForm.querySelector('label[for="mw-upload-file"]');

        // #6: compute next free default title for the given type
        function _getMwDefaultTitle(type) {
            var prefix = type === 'image' ? 'תמונה' : type === 'video' ? 'סרטון' : 'שמע';
            var max = 0;
            _mwCurrentItems.forEach(function(item) {
                var m = (item.title || '').match(new RegExp('^' + prefix + '_(\\d+)$'));
                if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
            });
            return prefix + '_' + (max + 1);
        }

        // #6: select all on focus if value is still a default pattern
        if (uploadTitleInput) {
            uploadTitleInput.addEventListener('focus', function() {
                if (/^(תמונה|סרטון|שמע)_\d+$/.test(this.value)) this.select();
            });
        }

        function _setMwLinkType(type) {
            if (!linkTypeInput) return;
            linkTypeInput.value = type;
            linkTypeButtons.forEach(function(btn) {
                var active = btn.getAttribute('data-mw-link-type') === type;
                btn.style.borderColor = active ? '#0891b2' : '#e5e7eb';
                btn.style.background = active ? '#ecfeff' : 'white';
                btn.style.color = active ? '#0f766e' : '#374151';
            });
        }

        function _setMwUploadType(type) {
            if (!uploadTypeInput) return;
            uploadTypeInput.value = type;
            uploadTypeButtons.forEach(function(btn) {
                var active = btn.getAttribute('data-mw-upload-type') === type;
                btn.style.borderColor = active ? '#0891b2' : '#e5e7eb';
                btn.style.background = active ? '#ecfeff' : 'white';
                btn.style.color = active ? '#0f766e' : '#374151';
            });
        }

        var _warehouseUploadBtn = document.getElementById('editor-media-warehouse-btn');
        var _warehouseUploadBtnOriginalLabel = null;
        function _setWarehouseUploadingBadge(on) {
            var btn = _warehouseUploadBtn || document.getElementById('editor-media-warehouse-btn');
            if (!btn) return;
            if (on) {
                if (_warehouseUploadBtnOriginalLabel === null) _warehouseUploadBtnOriginalLabel = btn.innerHTML;
                if (!document.getElementById('mw-anim-style')) {
                    var st = document.createElement('style'); st.id = 'mw-anim-style';
                    st.textContent = '@keyframes mw-spin{to{transform:rotate(360deg)}}@keyframes mw-pop{0%{transform:scale(.6);opacity:0}50%{transform:scale(1.18)}100%{transform:scale(1);opacity:1}}@keyframes mw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06);box-shadow:0 4px 14px rgba(13,148,136,.4)}}';
                    document.head.appendChild(st);
                }
                btn.innerHTML = '📦 מחסן מדיה <span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;animation:mw-spin 0.8s linear infinite;margin:0 6px;vertical-align:middle"></span> מעלה לשרת';
            } else if (_warehouseUploadBtnOriginalLabel !== null) {
                btn.innerHTML = _warehouseUploadBtnOriginalLabel;
            }
        }

        linkTypeButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                _setMwLinkType(btn.getAttribute('data-mw-link-type'));
            });
        });

        function _removePostUploadActions() {
            var existing = document.getElementById('mw-postupload-actions');
            if (existing) existing.remove();
        }

        function _removeDuringActions() {
            var existing = document.getElementById('mw-during-actions');
            if (existing) existing.remove();
        }
        var _mwInFlight = 0;

        uploadTypeButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var newType = btn.getAttribute('data-mw-upload-type');
                _setMwUploadType(newType);
                // #6: update default title if currently a default
                if (uploadTitleInput) {
                    var cur = uploadTitleInput.value;
                    if (/^(תמונה|סרטון|שמע)_\d+$/.test(cur)) {
                        uploadTitleInput.value = _getMwDefaultTitle(newType);
                    }
                }
                // #11: pulse file-chooser label if no file chosen yet
                if (uploadFileLabel && !(uploadFileInput && uploadFileInput.files.length)) {
                    if (!document.getElementById('mw-anim-style')) {
                        var st = document.createElement('style'); st.id = 'mw-anim-style';
                        st.textContent = '@keyframes mw-spin{to{transform:rotate(360deg)}}@keyframes mw-pop{0%{transform:scale(.6);opacity:0}50%{transform:scale(1.18)}100%{transform:scale(1);opacity:1}}@keyframes mw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06);box-shadow:0 4px 14px rgba(13,148,136,.4)}}';
                        document.head.appendChild(st);
                    }
                    uploadFileLabel.style.animation = 'mw-pulse 1.1s ease-in-out infinite';
                }
            });
        });

        if (uploadFileInput) {
            uploadFileInput.addEventListener('change', function() {
                var file = this.files[0];
                var submitBtn = document.getElementById('mw-upload-submit');
                if (!file) {
                    if (submitBtn) submitBtn.style.animation = '';
                    if (uploadFileLabel) uploadFileLabel.style.animation = ''; // #11: clear label pulse
                    var warnEl = document.getElementById('mw-upload-warning');
                    if (warnEl) warnEl.style.display = 'none'; // #12: clear warning
                    return;
                }
                // Determine type from file
                var detectedType;
                if (file.type.indexOf('image/') === 0) {
                    detectedType = 'image'; _setMwUploadType('image');
                } else if (file.type.indexOf('audio/') === 0) {
                    detectedType = 'audio'; _setMwUploadType('audio');
                } else if (file.type.indexOf('video/') === 0) {
                    detectedType = 'video'; _setMwUploadType('video');
                } else {
                    detectedType = uploadTypeInput ? uploadTypeInput.value : 'audio';
                }
                // #6: set default incrementing name (only if empty or currently a default)
                if (uploadTitleInput) {
                    var curVal = uploadTitleInput.value;
                    if (!curVal || /^(תמונה|סרטון|שמע)_\d+$/.test(curVal)) {
                        uploadTitleInput.value = _getMwDefaultTitle(detectedType);
                    }
                }
                // #11: clear label pulse (file was chosen — label job done)
                if (uploadFileLabel) uploadFileLabel.style.animation = '';
                var fnEl = document.getElementById('mw-upload-filename');
                if (fnEl) { fnEl.textContent = '✓ ' + file.name; fnEl.style.display = 'block'; }
                // Live preview of the chosen file BEFORE pressing "העלה"
                var pv = document.getElementById('mw-upload-preview');
                if (pv) {
                    var u = URL.createObjectURL(file);
                    var t = file.type || '';
                    var inner;
                    if (t.indexOf('image/') === 0) inner = '<img src="' + u + '" style="max-width:100%;max-height:200px;border-radius:6px">';
                    else if (t.indexOf('video/') === 0) inner = '<video src="' + u + '" controls style="max-width:100%;max-height:220px;border-radius:6px;background:#000"></video>';
                    else if (t.indexOf('audio/') === 0) inner = '<audio src="' + u + '" controls style="width:100%"></audio>';
                    else inner = '<div style="font-size:2em">📄</div>';
                    pv.innerHTML = '<div style="font-size:0.8em;color:#0f766e;font-weight:bold;margin-bottom:6px">תצוגה מקדימה</div>' + inner;
                    pv.style.display = 'block';
                }
                // #12: show not-uploaded-yet warning
                var warnEl = document.getElementById('mw-upload-warning');
                if (warnEl) warnEl.style.display = 'block';
                // Pulse the submit button to draw attention
                if (submitBtn && !submitBtn.disabled) {
                    if (!document.getElementById('mw-anim-style')) {
                        var st = document.createElement('style'); st.id = 'mw-anim-style';
                        st.textContent = '@keyframes mw-spin{to{transform:rotate(360deg)}}@keyframes mw-pop{0%{transform:scale(.6);opacity:0}50%{transform:scale(1.18)}100%{transform:scale(1);opacity:1}}@keyframes mw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06);box-shadow:0 4px 14px rgba(13,148,136,.4)}}';
                        document.head.appendChild(st);
                    }
                    submitBtn.style.animation = 'mw-pulse 1.1s ease-in-out infinite';
                }
            });
        }

        // Whole-folder upload wiring (ported from mediaStorage.js _submitBulkUpload):
        // pick a directory → upload every media file in it sequentially into the
        // CURRENT folder (_currentFolderId), auto-sorting by detected type.
        var folderUploadBtn = uploadForm.querySelector('#mw-upload-folder-btn');
        var folderUploadInput = uploadForm.querySelector('#mw-upload-folder-input');
        if (folderUploadBtn && folderUploadInput) {
            folderUploadBtn.addEventListener('click', function() {
                if (_mwFolderUploadInFlight) return; // anti double-submit
                folderUploadInput.click();
            });
            folderUploadInput.addEventListener('change', function() {
                // Copy to a real array BEFORE clearing the input — `this.files` is a
                // LIVE FileList, so resetting `this.value` would empty it out from under us.
                var picked = Array.prototype.slice.call(this.files || []);
                this.value = ''; // allow re-picking the same folder afterwards
                _doMwFolderUpload(picked);
            });
        }

        if (linkTypeInput) _setMwLinkType(linkTypeInput.value || 'video');
        if (uploadTypeInput) _setMwUploadType(uploadTypeInput.value || 'audio');

        function _showAddLinkInWarehouse() {
            document.getElementById('mw-add-link-form').style.display = 'block';
            document.getElementById('mw-upload-form').style.display = 'none';
            document.getElementById('mw-link-submit').onclick = function() {
                var title = document.getElementById('mw-link-title').value.trim();
                var url = document.getElementById('mw-link-url').value.trim();
                var type = document.getElementById('mw-link-type').value;
                if (!title || !url) { MessageManager.show('נדרש כותרת וקישור', 'error'); return; }
                MediaStorage.apiCall('add_link', { title: title, url: url, media_type: type, folder_id: _currentFolderId }).then(function() {
                    MessageManager.show('קישור נוסף', 'success');
                    document.getElementById('mw-add-link-form').style.display = 'none';
                    document.getElementById('mw-link-title').value = '';
                    document.getElementById('mw-link-url').value = '';
                    _reloadCurrentFolder();
                });
            };
        }

        // Small celebratory confetti burst anchored to an element
        function _mwConfettiBurst(anchor) {
            try {
                if (!document.getElementById('mw-anim-style')) {
                    var st = document.createElement('style'); st.id = 'mw-anim-style';
                    st.textContent = '@keyframes mw-spin{to{transform:rotate(360deg)}}@keyframes mw-pop{0%{transform:scale(.6);opacity:0}50%{transform:scale(1.18)}100%{transform:scale(1);opacity:1}}@keyframes mw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06);box-shadow:0 4px 14px rgba(13,148,136,.4)}}';
                    document.head.appendChild(st);
                }
                var emojis = ['🎉', '✨', '🎊', '⭐', '🎈'];
                var rect = anchor.getBoundingClientRect();
                var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
                for (var i = 0; i < 14; i++) {
                    (function(i) {
                        var s = document.createElement('div');
                        s.textContent = emojis[i % emojis.length];
                        s.style.cssText = 'position:fixed;z-index:100001;pointer-events:none;font-size:' + (14 + (i % 3) * 6) + 'px;left:' + cx + 'px;top:' + cy + 'px;transition:transform 0.9s ease-out,opacity 0.9s ease-out';
                        document.body.appendChild(s);
                        requestAnimationFrame(function() {
                            var dx = (i % 2 ? 1 : -1) * (18 + i * 7);
                            var dy = -50 - (i * 6);
                            s.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (i * 45) + 'deg)';
                            s.style.opacity = '0';
                        });
                        setTimeout(function() { s.remove(); }, 1000);
                    })(i);
                }
            } catch (e) {}
        }

        // Client-side downscale+compress for images before upload — the big speed win
        // (a raw phone photo is 5-10MB; this sends ~0.3-1MB). Non-images / gif / svg /
        // already-small files pass through unchanged. Resolves a Blob (or the original File).
        function _mwCompressImage(file, type) {
            if (type !== 'image' || !file || !file.type || file.type.indexOf('image/') !== 0) return Promise.resolve(file);
            if (/image\/(gif|svg)/i.test(file.type)) return Promise.resolve(file);
            if (file.size < 400 * 1024) return Promise.resolve(file);
            return new Promise(function(resolve) {
                try {
                    var url = URL.createObjectURL(file);
                    var img = new Image();
                    img.onload = function() {
                        try {
                            var MAX = 1600, w = img.naturalWidth, h = img.naturalHeight;
                            if (w <= MAX && h <= MAX && file.size < 1.5 * 1024 * 1024) { URL.revokeObjectURL(url); resolve(file); return; }
                            var scale = Math.min(1, MAX / Math.max(w, h));
                            var cw = Math.round(w * scale), ch = Math.round(h * scale);
                            var canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
                            canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
                            canvas.toBlob(function(blob) {
                                URL.revokeObjectURL(url);
                                resolve(blob && blob.size < file.size ? blob : file);
                            }, 'image/jpeg', 0.82);
                        } catch (e) { URL.revokeObjectURL(url); resolve(file); }
                    };
                    img.onerror = function() { URL.revokeObjectURL(url); resolve(file); };
                    img.src = url;
                } catch (e) { resolve(file); }
            });
        }

        // Optimistic blinking placeholder row in the warehouse list (Amitai 2026-06-17):
        // the file appears immediately, blinking, until the server confirms — then the
        // list refresh replaces it with the real (non-blinking) item.
        function _mwAddPendingRow(id, title, type) {
            if (!folderItemsEl || !document.body.contains(folderItemsEl)) return;
            if (/אין קבצים/.test(folderItemsEl.textContent)) folderItemsEl.innerHTML = '';
            if (!document.getElementById('mw-blink-style')) {
                var s = document.createElement('style'); s.id = 'mw-blink-style';
                s.textContent = '@keyframes mw-blink{0%,100%{opacity:1}50%{opacity:0.35}}';
                document.head.appendChild(s);
            }
            var icon = type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼️';
            var row = document.createElement('div');
            row.id = 'mw-pending-' + id;
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;margin:4px 0;border-radius:8px;background:#f0fdfa;border:1px dashed #99f6e4;animation:mw-blink 1s ease-in-out infinite';
            row.innerHTML = '<div style="width:56px;height:42px;background:#eef2ff;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.3em">' + icon + '</div>' +
                '<div style="flex:1;min-width:0"><div style="font-weight:bold;font-size:0.9em">' + escapeHtml(title) + '</div><div style="font-size:0.75em;color:#0d9488">מעלה…</div></div>';
            folderItemsEl.insertBefore(row, folderItemsEl.firstChild);
        }
        function _mwRemovePendingRow(id) { var r = document.getElementById('mw-pending-' + id); if (r) r.remove(); }

        function _doMwUpload(file, title, type, anchor) {
            _mwInFlight++;
            _setWarehouseUploadingBadge(true);
            var _uploadId = ++_mwUploadIdSeq;
            _mwActiveUploads.push({ id: _uploadId, title: title });
            _renderMwActiveUploads();
            _mwAddPendingRow(_uploadId, title, type); // optimistic blinking row
            var token = localStorage.getItem('plonter_auth_token') || localStorage.getItem('auth_otp_token_plonter');
            function _settle() { _mwInFlight--; if (_mwInFlight === 0) _setWarehouseUploadingBadge(false); }
            return _mwCompressImage(file, type).then(function(uploadBlob) {
                var sendName = (uploadBlob !== file) ? (file.name.replace(/\.[^.]+$/, '') + '.jpg') : file.name;
                var formData = new FormData();
                formData.append('file', uploadBlob, sendName);
                formData.append('title', title);
                formData.append('folder_id', _currentFolderId);
                formData.append('media_type', type);
                return fetch('/plonter/api/media_api.php', {
                    method: 'POST',
                    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                    body: formData
                });
            }).then(function(r) { return r.json(); }).then(function(data) {
                _settle();
                if (data.ok) {
                    // #16: mark this upload done — show '✓ X עלה' briefly, then fade
                    _mwActiveUploads.forEach(function(u) { if (u.id === _uploadId) u.done = true; });
                    _renderMwActiveUploads();
                    setTimeout(function() {
                        _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
                        _renderMwActiveUploads();
                    }, 1800);
                    if (typeof SoundManager !== 'undefined' && SoundManager.playSuccess) { try { SoundManager.playSuccess(); } catch (e) {} }
                    MessageManager.show('🎉 עלה! הקובץ נוסף למחסן', 'success');
                    // list refresh replaces the blinking pending row with the real item
                    _reloadCurrentFolder();
                } else {
                    _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
                    _renderMwActiveUploads();
                    _mwRemovePendingRow(_uploadId);
                    MessageManager.show('שגיאה: ' + (data.error || ''), 'error');
                }
            }).catch(function() {
                _settle();
                _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
                _renderMwActiveUploads();
                _mwRemovePendingRow(_uploadId);
                MessageManager.show('שגיאה בהעלאה — נסה שוב', 'error');
            });
        }

        // Detect media_type for a File: prefer MIME, fall back to extension.
        // Reuses mediaStorage.js's exported detector when present, else replicates
        // the same rules so the two warehouses stay in lock-step.
        function _mwDetectMediaType(file) {
            if (typeof MediaStorage !== 'undefined' && MediaStorage._detectMediaType) {
                return MediaStorage._detectMediaType(file);
            }
            var t = (file.type || '').toLowerCase();
            if (t.indexOf('image/') === 0) return 'image';
            if (t.indexOf('audio/') === 0) return 'audio';
            if (t.indexOf('video/') === 0) return 'video';
            var name = (file.name || '').toLowerCase();
            if (/\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|avif|tiff?)$/.test(name)) return 'image';
            if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|wma|opus)$/.test(name)) return 'audio';
            if (/\.(mp4|webm|ogv|mov|mkv|avi|m4v|3gp)$/.test(name)) return 'video';
            return null;
        }

        // Whole-folder upload — upload every media file from a picked directory
        // SEQUENTIALLY into the CURRENT folder, auto-sorting each by detected type.
        // Non-media + oversize (>64MB) files are skipped and counted. The triggering
        // button shows an in-flight state + is disabled during the run (UX principle
        // #1 soft-feedback), and a single soft summary toast + one list refresh fire
        // at the end. (ported from mediaStorage.js _submitBulkUpload.)
        var _mwFolderUploadInFlight = false;
        function _doMwFolderUpload(fileList) {
            if (_mwFolderUploadInFlight) { MessageManager.show('העלאת תיקייה כבר מתבצעת', 'warning'); return; }
            if (!_currentFolderId) { MessageManager.show('תיקיית שיעור לא נמצאה', 'error'); return; }
            var files = Array.prototype.slice.call(fileList || []);
            var media = [];
            var skipped = 0;
            files.forEach(function(f) {
                var mt = _mwDetectMediaType(f);
                if (!mt) { skipped++; return; }
                if (f.size > 64 * 1024 * 1024) { skipped++; return; }
                media.push({ file: f, type: mt });
            });
            if (!media.length) {
                MessageManager.show(skipped ? ('לא נמצאו קבצי מדיה נתמכים (' + skipped + ' דולגו)') : 'לא נמצאו קבצים', 'warning');
                return;
            }
            _mwFolderUploadInFlight = true;
            var targetFolder = _currentFolderId; // capture — sequential run must not drift if nav changes
            var token = localStorage.getItem('plonter_auth_token') || localStorage.getItem('auth_otp_token_plonter');
            var folderBtn = document.getElementById('mw-upload-folder-btn');
            var _origBtnLabel = folderBtn ? folderBtn.innerHTML : null;
            function _setFolderBtn(label, disabled) {
                if (!folderBtn) return;
                folderBtn.disabled = disabled;
                folderBtn.style.opacity = disabled ? '0.7' : '';
                folderBtn.style.cursor = disabled ? 'default' : 'pointer';
                folderBtn.innerHTML = label;
            }
            _setWarehouseUploadingBadge(true);
            _mwInFlight++;
            var counts = { image: 0, audio: 0, video: 0 };
            var failed = 0, done = 0, total = media.length;

            function finish() {
                _mwFolderUploadInFlight = false;
                _mwInFlight--; if (_mwInFlight <= 0) { _mwInFlight = 0; _setWarehouseUploadingBadge(false); }
                _setFolderBtn(_origBtnLabel || '📂 העלה תיקייה שלמה (מיון אוטומטי לפי סוג)', false);
                var parts = [];
                if (counts.image) parts.push(counts.image + ' תמונות');
                if (counts.audio) parts.push(counts.audio + ' שמע');
                if (counts.video) parts.push(counts.video + ' וידאו');
                var msg = 'הועלו ' + done + ' קבצים' + (parts.length ? ' (' + parts.join(', ') + ')' : '');
                if (failed) msg += ' · ' + failed + ' נכשלו';
                if (skipped) msg += ' · ' + skipped + ' דולגו';
                MessageManager.show(msg, done > 0 ? 'success' : 'error');
                if (done > 0) {
                    if (typeof SoundManager !== 'undefined' && SoundManager.playSuccess) { try { SoundManager.playSuccess(); } catch (e) {} }
                    _mwConfettiBurst(folderBtn || document.getElementById('mw-folder-items') || document.body);
                }
                _reloadCurrentFolder();
            }

            function step(i) {
                if (i >= media.length) { finish(); return; }
                var m = media[i];
                var title = m.file.name.replace(/\.[^.]+$/, '');
                _setFolderBtn('⏳ מעלה ' + (i + 1) + '/' + total + '…', true);
                var _uploadId = ++_mwUploadIdSeq;
                _mwActiveUploads.push({ id: _uploadId, title: title });
                _renderMwActiveUploads();
                _mwCompressImage(m.file, m.type).then(function(uploadBlob) {
                    var sendName = (uploadBlob !== m.file) ? (m.file.name.replace(/\.[^.]+$/, '') + '.jpg') : m.file.name;
                    var formData = new FormData();
                    formData.append('file', uploadBlob, sendName);
                    formData.append('title', title);
                    formData.append('folder_id', targetFolder);
                    formData.append('media_type', m.type);
                    return fetch('/plonter/api/media_api.php', {
                        method: 'POST',
                        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                        body: formData
                    });
                }).then(function(r) { return r.json(); }).then(function(data) {
                    if (data && data.ok) {
                        done++; counts[m.type] = (counts[m.type] || 0) + 1;
                        _mwActiveUploads.forEach(function(u) { if (u.id === _uploadId) u.done = true; });
                        _renderMwActiveUploads();
                        setTimeout(function() {
                            _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
                            _renderMwActiveUploads();
                        }, 1400);
                    } else {
                        failed++;
                        _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
                        _renderMwActiveUploads();
                    }
                }).catch(function() {
                    failed++;
                    _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
                    _renderMwActiveUploads();
                }).then(function() { step(i + 1); });
            }
            MessageManager.show('מעלה ' + total + ' קבצים…', 'success');
            step(0);
        }

        function _showUploadInWarehouse() {
            var _f = document.getElementById('mw-upload-form');
            if (_f) _f.style.display = 'block';
            if (_f && _f.scrollIntoView) _f.scrollIntoView({behavior:'smooth',block:'center'});
            var _t = document.getElementById('mw-upload-title');
            if (_t) setTimeout(function(){_t.focus();},150);
            document.getElementById('mw-add-link-form').style.display = 'none';
            _removePostUploadActions();
            _removeDuringActions();
            document.getElementById('mw-upload-submit').onclick = function() {
                var titleEl = document.getElementById('mw-upload-title');
                var fileInput = document.getElementById('mw-upload-file');
                var title = titleEl.value.trim();
                var file = fileInput.files[0];
                var type = document.getElementById('mw-upload-type').value;
                // Validate before closing (tip #1: dialog DOM gone after close)
                if (!title || !file) { MessageManager.show('נדרש כותרת וקובץ', 'error'); return; }
                if (file.size > 64 * 1024 * 1024) { MessageManager.show('הקובץ גדול מדי (מקסימום 64MB)', 'error'); return; }
                var submitBtn = document.getElementById('mw-upload-submit');
                submitBtn.style.animation = '';
                var warnEl = document.getElementById('mw-upload-warning');
                if (warnEl) warnEl.style.display = 'none';
                _doMwUpload(file, title, type, submitBtn); // background; floating indicator shows it
                _mwConfettiBurst(submitBtn); // burst while button is still in DOM
                // #1466: close dialog immediately — upload continues in background via
                // the floating #mw-global-uploads indicator + badge on the warehouse btn.
                overlay.remove();
                _restoreCursor();
            };
        }

        // Close button
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-start';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'סגור';
        closeBtn.className = 'btn btn-secondary';
        closeBtn.style.cssText = 'padding:10px 24px;font-size:1em';
        closeBtn.addEventListener('click', function() { overlay.remove(); _restoreCursor(); });
        btnRow.appendChild(closeBtn);
        popup.appendChild(btnRow);

        // In-flight upload indicator is now a PAGE-LEVEL floating element (on body) that
        // survives leaving the warehouse OR the editor — just refresh it on open.
        _renderMwActiveUploads();
        // Drag-and-drop auto-upload on warehouse popup
        popup.addEventListener('dragover', function(e) {
            e.preventDefault();
            popup.style.outline = '3px dashed #0891b2';
        });
        popup.addEventListener('dragleave', function(e) {
            if (!popup.contains(e.relatedTarget)) popup.style.outline = '';
        });
        popup.addEventListener('drop', function(e) {
            e.preventDefault();
            popup.style.outline = '';
            var files = Array.prototype.slice.call(e.dataTransfer.files);
            files.forEach(function(file) {
                var type;
                if (file.type.indexOf('image/') === 0) type = 'image';
                else if (file.type.indexOf('video/') === 0) type = 'video';
                else if (file.type.indexOf('audio/') === 0) type = 'audio';
                else return;
                _doMwUpload(file, _getMwDefaultTitle(type), type, popup);
            });
        });
        overlay.appendChild(popup);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); _restoreCursor(); } });
        document.body.appendChild(overlay);
    }

    // --- Audio-only toggle for video slides ---
    function _toggleAudioOnly() {
        var wrap = document.getElementById('lp-video-wrap');
        var btn = document.getElementById('lp-audio-toggle');
        if (!wrap || !btn) return;
        var isAudioOnly = wrap.classList.toggle('lp-audio-only');
        if (isAudioOnly) {
            btn.textContent = '👁‍🗨';
            btn.title = 'הצג וידאו';
            btn.style.background = '#6366f1';
        } else {
            btn.textContent = '👁';
            btn.title = 'שמע בלבד';
            btn.style.background = 'rgba(0,0,0,0.6)';
        }
    }

    // --- Sync badge live refresh ---
    // Re-render lessons list when ContentSync emits a status change for a lesson,
    // so the yellow/green badge updates without the user having to reload.
    (function _hookContentSyncUpdates() {
        var _pending = null;
        document.addEventListener('contentsync:change', function(e) {
            if (!e || !e.detail || e.detail.contentType !== 'lesson') return;
            var listEl = document.getElementById('lessons-list');
            if (!listEl || listEl.offsetParent === null) return; // not visible
            clearTimeout(_pending);
            _pending = setTimeout(function() { try { renderLessonsList(); } catch(_) {} }, 120);
        });
    })();

    // --- Login/logout live refresh ---
    // Guest mode filters out synced lessons; when the user signs in, those
    // lessons need to reappear even if the list was already rendered.
    (function _hookAuthUpdates() {
        function _maybeRerender() {
            // BUG 7 — a guest who logs in mid-session should have legacy-backed
            // lessons adopted into content_api. The adopter is one-shot
            // (cs_adopt_v1_done) so this is a no-op after the first run.
            try {
                if (typeof ContentSync !== 'undefined' &&
                    typeof ContentSync.runLegacyLessonAdopter === 'function' &&
                    typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn()) {
                    ContentSync.runLegacyLessonAdopter();
                }
            } catch (_) {}
            var listEl = document.getElementById('lessons-list');
            if (!listEl || listEl.offsetParent === null) return;
            try { renderLessonsList(); } catch(_) {}
        }
        // Same-tab auth transitions (login/guest/logout) — dispatched by
        // PlonterAuth. Covers the case where checkSession rejects a stale
        // token after renderLessonsList has already rendered the logged-in
        // view; without this, synced lessons stay visible in guest mode.
        document.addEventListener('plonter:authchange', _maybeRerender);
        // Fallback for older PlonterAuth builds + cross-tab storage events.
        if (typeof PlonterAuth !== 'undefined' && typeof PlonterAuth.onLogin === 'function') {
            PlonterAuth.onLogin(_maybeRerender);
        }
        window.addEventListener('storage', function(e) {
            if (e.key === 'plonter_auth_token') _maybeRerender();
        });
    })();

    // --- Public API ---

    // Bug #2 — warn before closing/refreshing the tab while an inline page
    // editor has unsaved changes. _inlineOpen[pid].dirty is the same dirty flag
    // the in-app save prompts use; cleared on save/close, so the warning only
    // fires when work would actually be lost.
    function _hasAnyUnsavedEditor() {
        for (var pid in _inlineOpen) {
            if (_inlineOpen[pid] && _inlineOpen[pid].dirty) return true;
        }
        return false;
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('beforeunload', function(e) {
            // Warn before closing/refreshing if there are unsaved edits OR an upload still
            // in flight (closing the tab cancels the fetch and loses the file — Amitai 2026-06-17).
            if (_hasAnyUnsavedEditor() || (_mwActiveUploads && _mwActiveUploads.length > 0)) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        });
    }

    return {
        renderLessonsList: renderLessonsList,
        showCreateDialog: showCreateDialog,
        showImportDialog: showImportDialog,
        openLessonEditor: openLessonEditor,
        startLessonViewer: startLessonViewer,
        loadLessons: loadLessons,
        getLesson: getLesson,
        saveSingleLesson: saveSingleLesson,
        deleteLesson: deleteLesson,
        exportLesson: exportLesson,
        importLesson: importLesson,
        syncToServer: syncToServer,
        loadFromServer: loadFromServer,
        saveToServer: saveToServer,
        clearLegacyServerId: clearLegacyServerId,
        shareLesson: shareLesson,
        loadSharedLesson: loadSharedLesson,
        cloneSharedLesson: cloneSharedLesson,
        checkSharedLessonURL: checkSharedLessonURL,
        renderDemoLessons: renderDemoLessons,
        _toggleAudioOnly: _toggleAudioOnly,
        filterLessonsList: function(query) {
            var container = document.getElementById('lessons-list');
            if (!container) return;
            if (!query || !query.trim()) { renderLessonsList(); return; }
            var lower = query.toLowerCase();
            var lessons = loadLessons().filter(function(l) {
                if (l.id && String(l.id).indexOf('demo_') === 0) return false;
                return l.title.toLowerCase().includes(lower) ||
                    (l.description && l.description.toLowerCase().includes(lower)) ||
                    _getLessonCategory(l).toLowerCase().includes(lower);
            });
            // Sort by last used (most recent first)
            lessons.sort(function(a, b) {
                return new Date(b.lastAccessed || b.updated || b.created || 0) - new Date(a.lastAccessed || a.updated || a.created || 0);
            });
            // Mirror renderLessonsList's two-direction visibility so
            // search results follow the same synced/guest rules.
            var _hasCS = typeof ContentSync !== 'undefined';
            var _loggedInNow = _hasCS && typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
            var _guestMode = _hasCS && typeof ContentSync.isLoggedIn === 'function' && !ContentSync.isLoggedIn();
            if (_guestMode) {
                lessons = lessons.filter(function(l) {
                    return !(ContentSync.isSynced && ContentSync.isSynced('lesson', l.id));
                });
            } else if (_loggedInNow) {
                lessons = lessons.filter(function(l) {
                    if (!l._createdAsGuest) return true;
                    return ContentSync.isSynced && ContentSync.isSynced('lesson', l.id);
                });
            }
            container.innerHTML = '';
            if (lessons.length === 0) {
                container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px">לא נמצאו שיעורים.</p>';
                return;
            }
            lessons.forEach(function(lesson) {
                var item = document.createElement('div');
                item.className = 'stage-item lesson-item';
                item.style.cursor = 'pointer';
                var dateStr = new Date(lesson.updated).toLocaleDateString('he-IL');
                var _isBuiltin2 = lesson._isBuiltinSeed === true ||
                    (typeof lesson.id === 'string' && (lesson.id.indexOf('seed_') === 0 || lesson.id.indexOf('guestseed_') === 0));
                var syncBadge = (!_isBuiltin2 && typeof ContentSync !== 'undefined' && ContentSync.getSyncBadge)
                    ? ContentSync.getSyncBadge('lesson', lesson.id) : '';
                var categoryBadge = '<span style="display:inline-flex;align-items:center;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;border-radius:999px;padding:1px 7px;font-size:0.72em;font-weight:700;white-space:nowrap">קטגוריה: ' + escapeHtml(_getLessonCategory(lesson)) + '</span>';
                item.innerHTML = '<div style="flex:1;min-width:0;overflow:hidden"><div class="stage-number" style="font-size:1.05em;font-weight:bold;color:#0d9488;display:flex;align-items:center;gap:8px;min-width:0"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">' +
                    escapeHtml(lesson.title) + '</span>' + categoryBadge + syncBadge + '</div><div style="font-size:0.85em;color:#6b7280;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                    ((lesson.pages && lesson.pages.length) ? lesson.pages.length : 0) + ' דפים · ' + dateStr + '</div></div>';
                item.addEventListener('click', function() { openLessonEditor(lesson.id); });
                container.appendChild(item);
            });
        }
    };

})();

// Global VocabBar — used by dictionary.js to pin words
var VocabBar = {
    _items: [], // {word, meaning}
    _activeWordEl: null,
    _currentLessonTitle: null,

    // Save a word to the vocabulary localStorage under the lesson's category
    _saveWordToVocab(word, meaning) {
        if (!this._currentLessonTitle) return;
        var catName = 'שיעורים - ' + this._currentLessonTitle;
        try {
            var raw = localStorage.getItem('plonter_vocab_v2');
            var data = raw ? JSON.parse(raw) : {};
            if (!data[catName]) data[catName] = { words: [] };
            // Check for duplicate
            var exists = data[catName].words.some(function(w) { return w.arabic === word; });
            if (exists) {
                // Update meaning if provided
                if (meaning) {
                    data[catName].words.forEach(function(w) {
                        if (w.arabic === word) w.hebrew = meaning;
                    });
                    localStorage.setItem('plonter_vocab_v2', JSON.stringify(data));
                }
                return;
            }
            data[catName].words.push({ arabic: word, hebrew: meaning || '' });
            localStorage.setItem('plonter_vocab_v2', JSON.stringify(data));
        } catch (e) { console.error('[VocabBar] save error:', e); }
    },

    pin(word, meaning) {
        // BUG 3 fix: Don't add duplicate word+meaning combinations
        var isDuplicate = this._items.some(function(item) {
            return item.word === word && item.meaning === (meaning || '');
        });
        if (isDuplicate) return;
        // Add word to vocab bar
        this._items.push({ word: word, meaning: meaning || '' });
        this._render();
        // Save to vocabulary localStorage
        this._saveWordToVocab(word, meaning || '');
        // Show the bar
        var bar = document.getElementById('lp-vocab-bar');
        if (bar) bar.style.display = 'block';
        var toggle = document.getElementById('lp-vocab-toggle');
        if (toggle) { toggle.style.background = '#0d9488'; toggle.style.color = 'white'; }
        // Focus the last meaning input so dictionary meaning buttons work immediately
        var allMeaningInputs = document.querySelectorAll('.lp-vocab-meaning');
        if (allMeaningInputs.length) {
            var lastInput = allMeaningInputs[allMeaningInputs.length - 1];
            lastInput.focus();
            this._activeWordEl = lastInput;
        }
    },

    appendMeaning(text) {
        // Append meaning to the currently active (last pinned) word's input
        if (!this._activeWordEl) {
            // Default to last item
            var inputs = document.querySelectorAll('.lp-vocab-meaning');
            if (inputs.length) this._activeWordEl = inputs[inputs.length - 1];
        }
        if (this._activeWordEl) {
            var cur = this._activeWordEl.value.trim();
            this._activeWordEl.value = cur ? cur + ', ' + text : text;
            this._activeWordEl.focus();
            // Update data
            var idx = parseInt(this._activeWordEl.dataset.vocabIdx);
            if (!isNaN(idx) && this._items[idx]) {
                this._items[idx].meaning = this._activeWordEl.value;
                // Also update vocabulary
                this._saveWordToVocab(this._items[idx].word, this._activeWordEl.value);
            }
        }
    },

    _render() {
        var container = document.getElementById('lp-vocab-items');
        if (!container) return;
        container.innerHTML = '';
        // Hide bar if empty
        var bar = document.getElementById('lp-vocab-bar');
        if (this._items.length === 0) {
            if (bar) bar.style.display = 'none';
            var toggle = document.getElementById('lp-vocab-toggle');
            if (toggle) { toggle.style.background = 'none'; toggle.style.color = ''; }
            return;
        }
        var self = this;
        this._items.forEach(function(item, idx) {
            var pill = document.createElement('div');
            pill.style.cssText = 'display:flex;align-items:center;gap:4px;background:white;border:1px solid #d1d5db;border-radius:20px;padding:4px 8px;font-size:0.85em;direction:rtl';

            var removeBtn = document.createElement('span');
            removeBtn.textContent = '✕';
            removeBtn.style.cssText = 'cursor:pointer;color:#9ca3af;font-size:0.8em;flex-shrink:0';
            removeBtn.addEventListener('click', function() {
                self._items.splice(idx, 1);
                self._render();
            });
            pill.appendChild(removeBtn);

            var wordSpan = document.createElement('span');
            wordSpan.style.cssText = 'font-weight:bold;font-family:Times New Roman,serif;font-size:1.1em;flex-shrink:0';
            wordSpan.textContent = item.word;
            pill.appendChild(wordSpan);

            var meaningInput = document.createElement('input');
            meaningInput.type = 'text';
            meaningInput.className = 'lp-vocab-meaning';
            meaningInput.dataset.vocabIdx = idx;
            meaningInput.value = item.meaning;
            meaningInput.placeholder = 'משמעות...';
            meaningInput.style.cssText = 'border:none;outline:none;font-size:0.9em;min-width:60px;direction:rtl;background:transparent;flex:1';
            meaningInput.addEventListener('focus', function() { self._activeWordEl = meaningInput; });
            meaningInput.addEventListener('input', function() {
                self._items[idx].meaning = meaningInput.value;
                // Also update vocabulary
                self._saveWordToVocab(item.word, meaningInput.value);
            });
            pill.appendChild(meaningInput);

            container.appendChild(pill);
        });
    }
};
