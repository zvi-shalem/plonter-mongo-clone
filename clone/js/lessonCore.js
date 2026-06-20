// lessonCore.js — Shared state, data layer, utilities
// Split from lessons.js — see REFACTOR_PLAN.md

var LessonManager = (function() {
    'use strict';

    const STORAGE_KEY = 'plonter_lessons';

    // --- Data Layer ---

    function loadLessons() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function saveLessons(lessons) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lessons));
    }

    function getLesson(id) {
        return loadLessons().find(l => l.id === id) || null;
    }

    function createLesson(title, description) {
        const lessons = loadLessons();
        const lesson = {
            id: 'lesson_' + Date.now(),
            title: title,
            description: description || '',
            pages: [],
            created: new Date().toISOString(),
            updated: new Date().toISOString()
        };
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
        saveLessons(lessons);
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
            lesson.id = 'lesson_' + Date.now();
            lesson.created = new Date().toISOString();
            lesson.updated = new Date().toISOString();
            const lessons = loadLessons();
            lessons.push(lesson);
            saveLessons(lessons);
            return lesson;
        } catch (e) {
            return null;
        }
    }

    // --- UI: Welcome Screen Lessons List ---


    // --- Shared State ---
    var _diacriticsMap = {};
    var _viewerState = null;
    var _presenterCtx = null;
    var _currentEditorLessonId = null;
    var _inlineOpen = {};
    var _currentQmarkData = [];
    var _qmarkGuessCache = {};

    // --- Utility Functions ---

    function _stripDiacritics(text) {
        // Strip diacritics (tashkeel: U+064B-U+0652 and superscript alef U+0670) only.
        // Do NOT strip U+0653-U+065F (hamza/maddah combining marks) — those are part of letter composition
        // and stripping them breaks decomposed alef variants (e.g. decomposed إ = ا + U+0655).
        return text.replace(/[\u064B-\u0652\u0670]/g, '').replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627');
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

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/&amp;nbsp;/g, '&nbsp;');
    }

    function escapeAttr(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

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
            '<div style="font-size:1.1em;font-weight:bold;margin-bottom:6px;color:#1a1a1a">יש שינויים שלא נשמרו</div>' +
            '<div style="font-size:0.9em;color:#6b7280;margin-bottom:20px">מה תרצה לעשות?</div>' +
            '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
                '<button id="sp-cancel" style="flex:1;padding:10px 16px;background:#0d9488;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">✏️ המשך לעבוד</button>' +
                '<button id="sp-save" style="flex:1;padding:10px 16px;background:#3b82f6;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">💾 שמור</button>' +
                '<button id="sp-discard" style="flex:1;padding:10px 16px;background:#ef4444;color:white;border:none;border-radius:10px;font-size:1em;font-weight:600;cursor:pointer">🗑️ בטל</button>' +
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

    // --- Media stubs ---
    function _setupMediaButton() {}
    function _removeMediaButton() {}
    function _onDictToggle() {}

    // --- Server API ---
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

    function syncToServer() {
        var lessons = loadLessons();
        if (lessons.length === 0) {
            MessageManager.show('אין שיעורים לסנכרון', 'info');
            return Promise.resolve();
        }

        // Upload each local lesson to server
        var promises = lessons.map(function(lesson) {
            return _serverCall('create', {
                title: lesson.title,
                description: lesson.description,
                pages: lesson.pages
            }).catch(function(err) {
                console.warn('Failed to sync lesson:', lesson.title, err);
                return null;
            });
        });

        return Promise.all(promises).then(function(results) {
            var synced = results.filter(function(r) { return r && r.ok; }).length;
            MessageManager.show(synced + ' שיעורים סונכרנו לשרת', 'success');
        });
    }

    function loadFromServer() {
        return _serverCall('list').then(function(data) {
            return data.lessons || [];
        });
    }

    function saveToServer(lesson) {
        return _serverCall('create', {
            title: lesson.title,
            description: lesson.description,
            pages: lesson.pages
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

    // Load demo lessons from server
    function renderDemoLessons() {
        var container = document.getElementById('demo-lessons-list');
        if (!container) return;

        // Hardcoded demo share codes
        var demoCodes = ['demo_verb', 'demo_noun', 'demo_prep'];
        container.innerHTML = '<p style="color:#d1d5db;text-align:center;padding:8px">טוען...</p>';

        var promises = demoCodes.map(function(code) {
            return fetch(API_LESSONS + '?action=get_shared&code=' + code)
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

                item.addEventListener('click', function() {
                    var tempLesson = {
                        id: 'demo_' + demoCodes[idx],
                        title: lesson.title,
                        description: lesson.description,
                        pages: lesson.pages
                    };
                    // Store temporarily and start viewer
                    var existing = loadLessons();
                    // Remove any previous temp demo with same id
                    existing = existing.filter(function(l) { return l.id !== tempLesson.id; });
                    existing.push(tempLesson);
                    saveLessons(existing);
                    setTimeout(function() { _publicAPI.startLessonViewer(tempLesson.id); }, 0);
                });

                // Edit button for demo lesson — clones as editable lesson
                var editDemoBtn = document.createElement('button');
                editDemoBtn.className = 'btn btn-secondary';
                editDemoBtn.innerHTML = '✏️';
                editDemoBtn.title = 'ערוך שיעור לדוגמה';
                editDemoBtn.style.cssText = 'padding:4px 8px;font-size:0.9em;margin-right:8px';
                editDemoBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var cloned = {
                        id: 'lesson_' + Date.now(),
                        title: lesson.title,
                        description: lesson.description || '',
                        pages: JSON.parse(JSON.stringify(lesson.pages || []))
                    };
                    var existing = loadLessons();
                    existing.push(cloned);
                    saveLessons(existing);
                    openLessonEditor(cloned.id);
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
                item.appendChild(editDemoBtn);

                container.appendChild(item);
            });
            if (!found) {
                container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:8px">אין שיעורים לדוגמה עדיין</p>';
            }
        });
    }

    // Check for ?lesson= URL param on page load
    function checkSharedLessonURL() {
        var params = new URLSearchParams(window.location.search);
        var code = params.get('lesson');
        if (!code) return;

        loadSharedLesson(code).then(function(lesson) {
            // Start viewer with the shared lesson data
            var viewerLesson = {
                id: 'shared_' + code,
                title: lesson.title,
                description: lesson.description,
                pages: lesson.pages,
                author: lesson.author_name,
                isShared: true,
                shareCode: code
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
        existingLessons.push(lesson);
        saveLessons(existingLessons);

        // Deferred: startLessonViewer is defined in lessonPresenter.js
        setTimeout(function() { _publicAPI.startLessonViewer(tempId); }, 0);

        // Remove temp after viewing
        setTimeout(function() {
            var lessons = loadLessons();
            saveLessons(lessons.filter(function(l) { return l.id !== tempId; }));
        }, 1000);
    }

    // --- Internal API (for lessonEditor.js and lessonPresenter.js) ---
    var _internal = {};
    function _updateInternal() {
        _internal.loadLessons = loadLessons;
        _internal.saveLessons = saveLessons;
        _internal.getLesson = getLesson;
        _internal.createLesson = createLesson;
        _internal.updateLesson = updateLesson;
        _internal.deleteLesson = deleteLesson;
        _internal.addPage = addPage;
        _internal.removePage = removePage;
        _internal.movePage = movePage;
        _internal.updatePage = updatePage;
        _internal.exportLesson = exportLesson;
        _internal.importLesson = importLesson;
        _internal.escapeHtml = escapeHtml;
        _internal.escapeAttr = escapeAttr;
        _internal._fallbackCopy = _fallbackCopy;
        _internal._youtubeToEmbed = _youtubeToEmbed;
        _internal._stripDiacritics = _stripDiacritics;
        _internal._buildDiacriticsMap = _buildDiacriticsMap;
        _internal._showSavePrompt = _showSavePrompt;
        _internal._showDuplicatePrompt = _showDuplicatePrompt;
        _internal._showTwoChoiceDialog = _showTwoChoiceDialog;
        _internal._showStyledConfirm = _showStyledConfirm;
        _internal._showEditorToast = _showEditorToast;
        _internal._pushEditorUndo = _pushEditorUndo;
        _internal._popEditorUndo = _popEditorUndo;
        _internal._saveAllOpenEditors = _saveAllOpenEditors;
        _internal._setupMediaButton = _setupMediaButton;
        _internal._removeMediaButton = _removeMediaButton;
        _internal._onDictToggle = _onDictToggle;
    }
    _updateInternal();

    // State accessors
    Object.defineProperty(_internal, "diacriticsMap", {
        get: function() { return _diacriticsMap; },
        set: function(v) { _diacriticsMap = v; }
    });
    Object.defineProperty(_internal, "viewerState", {
        get: function() { return _viewerState; },
        set: function(v) { _viewerState = v; }
    });
    Object.defineProperty(_internal, "presenterCtx", {
        get: function() { return _presenterCtx; },
        set: function(v) { _presenterCtx = v; }
    });
    Object.defineProperty(_internal, "currentEditorLessonId", {
        get: function() { return _currentEditorLessonId; },
        set: function(v) { _currentEditorLessonId = v; }
    });
    Object.defineProperty(_internal, "inlineOpen", {
        get: function() { return _inlineOpen; },
        set: function(v) { _inlineOpen = v; }
    });
    Object.defineProperty(_internal, "currentQmarkData", {
        get: function() { return _currentQmarkData; },
        set: function(v) { _currentQmarkData = v; }
    });
    Object.defineProperty(_internal, "qmarkGuessCache", {
        get: function() { return _qmarkGuessCache; },
        set: function(v) { _qmarkGuessCache = v; }
    });

    // Extension point for other modules
    var _publicAPI = {
        _: _internal,
        loadLessons: loadLessons,
        exportLesson: exportLesson,
        importLesson: importLesson,
        syncToServer: syncToServer,
        loadFromServer: loadFromServer,
        saveToServer: saveToServer,
        shareLesson: shareLesson,
        loadSharedLesson: loadSharedLesson,
        cloneSharedLesson: cloneSharedLesson,
        checkSharedLessonURL: checkSharedLessonURL,
        renderDemoLessons: renderDemoLessons,
        // Stubs — overridden by lessonPresenter.js and lessonEditor.js
        startLessonViewer: function() { console.warn('startLessonViewer not yet loaded'); },
    };

    return _publicAPI;
})();

var VocabBar = {
    _items: [], // {word, meaning}
    _activeWordEl: null,

    pin(word, meaning) {
        // BUG 3 fix: Don't add duplicate word+meaning combinations
        var isDuplicate = this._items.some(function(item) {
            return item.word === word && item.meaning === (meaning || '');
        });
        if (isDuplicate) return;
        // Add word to vocab bar
        this._items.push({ word: word, meaning: meaning || '' });
        this._render();
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
            if (!isNaN(idx) && this._items[idx]) this._items[idx].meaning = this._activeWordEl.value;
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
            meaningInput.addEventListener('input', function() { self._items[idx].meaning = meaningInput.value; });
            pill.appendChild(meaningInput);

            container.appendChild(pill);
        });
    }
};
