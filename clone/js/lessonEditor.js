// lessonEditor.js — Lesson CRUD, editor, inline editing, page dialogs
// Split from lessons.js — see REFACTOR_PLAN.md

(function(LM) {
    'use strict';
    var _ = LM._;

    // Import shared functions
    var loadLessons = _.loadLessons;
    var saveLessons = _.saveLessons;
    var getLesson = _.getLesson;
    var createLesson = _.createLesson;
    var updateLesson = _.updateLesson;
    var deleteLesson = _.deleteLesson;
    var addPage = _.addPage;
    var removePage = _.removePage;
    var movePage = _.movePage;
    var updatePage = _.updatePage;
    var exportLesson = _.exportLesson;
    var importLesson = _.importLesson;
    var escapeHtml = _.escapeHtml;
    var escapeAttr = _.escapeAttr;
    var _fallbackCopy = _._fallbackCopy;
    var _youtubeToEmbed = _._youtubeToEmbed;
    var _stripDiacritics = _._stripDiacritics;
    var _buildDiacriticsMap = _._buildDiacriticsMap;
    var _showSavePrompt = _._showSavePrompt;
    var _showDuplicatePrompt = _._showDuplicatePrompt;
    var _showTwoChoiceDialog = _._showTwoChoiceDialog;
    var _showStyledConfirm = _._showStyledConfirm;
    var _showEditorToast = _._showEditorToast;
    var _pushEditorUndo = _._pushEditorUndo;
    var _popEditorUndo = _._popEditorUndo;
    // _saveAllOpenEditors is defined in lessonPresenter.js — use lazy reference
    function _saveAllOpenEditors() { return _._saveAllOpenEditors && _._saveAllOpenEditors(); }

    // Editor-local state
    var _dragSrcIdx = null;
    var _autoScrollInterval = null;
    var _autoScrollSpeed = 0;
    var _inlineFsOverlay = null;
    var _inlineFsOrigParent = null;
    var _inlineFsOrigNext = null;
    var _inlineFsOrigStyle = null;
    var _inlineFsCard = null;
    var _currentFmtColor = null;

    // Forward references (will be set by presenter module)
    function startLessonViewer(id) { return LM.startLessonViewer(id); }

    function renderLessonsList() {
        const container = document.getElementById('lessons-list');
        if (!container) return;
        const lessons = loadLessons();
        container.innerHTML = '';

        if (lessons.length === 0) {
            container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px">אין שיעורים עדיין. לחץ "שיעור חדש" כדי ליצור.</p>';
            return;
        }

        lessons.forEach(function(lesson) {
            const item = document.createElement('div');
            item.className = 'stage-item lesson-item';
            item.style.cursor = 'pointer';

            const pagesCount = lesson.pages.length;
            const dateStr = new Date(lesson.updated).toLocaleDateString('he-IL');

            item.innerHTML =
                '<div style="flex:1;min-width:0">' +
                    '<div class="stage-number" style="font-size:1.1em;font-weight:bold;color:#0d9488">' + escapeHtml(lesson.title) + '</div>' +
                    '<div style="font-size:0.85em;color:#6b7280;margin-top:2px">' +
                        pagesCount + ' דפים · ' + dateStr +
                        (lesson.description ? ' · ' + escapeHtml(lesson.description) : '') +
                    '</div>' +
                '</div>';

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
                        navigator.clipboard.writeText(json).then(function() {
                            _showEditorToast('JSON שיעור הועתק');
                        }).catch(function() {
                            _fallbackCopy(json);
                            _showEditorToast('JSON שיעור הועתק');
                        });
                    } else {
                        _fallbackCopy(json);
                        _showEditorToast('JSON שיעור הועתק');
                    }
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
                    deleteLesson(lesson.id);
                    renderLessonsList();
                });
            });

            actions.appendChild(viewBtn);
            actions.appendChild(expBtn);
            item.style.position = 'relative';
            item.appendChild(delBtn);
            item.appendChild(actions);

            // Click on card → open editor
            item.addEventListener('click', function() {
                openLessonEditor(lesson.id);
            });

            container.appendChild(item);
        });
    }

    // --- UI: Create Lesson Dialog ---

    function showCreateDialog() {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'lesson-create-modal';
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
                '<div style="display:flex;gap:8px;justify-content:flex-start">' +
                    '<button id="lesson-create-confirm" class="btn btn-primary" style="font-size:1.1em;padding:10px 24px">צור שיעור</button>' +
                    '<button id="lesson-create-cancel" class="btn btn-secondary" style="font-size:1.1em;padding:10px 24px">ביטול</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(modal);

        const titleInput = document.getElementById('lesson-title-input');
        titleInput.focus();

        document.getElementById('lesson-create-confirm').addEventListener('click', function() {
            const title = titleInput.value.trim();
            if (!title) {
                titleInput.style.borderColor = '#ef4444';
                return;
            }
            const desc = document.getElementById('lesson-desc-input').value.trim();
            const lesson = createLesson(title, desc);
            modal.remove();
            openLessonEditor(lesson.id);
        });

        titleInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                document.getElementById('lesson-create-confirm').click();
            }
        });

        function _hasUnsavedInput() {
            return titleInput.value.trim() !== '' || document.getElementById('lesson-desc-input').value.trim() !== '';
        }

        function _onCancelCreate() {
            if (!_hasUnsavedInput()) { modal.remove(); return; }
            _showTwoChoiceDialog('📝', 'יש שינויים', '',
                '✏️ המשך לעבוד', '#0d9488', function() {},
                '🗑️ בטל', '#ef4444', function() { modal.remove(); }
            );
        }
        function _onBackdropCreate() {
            if (!_hasUnsavedInput()) { modal.remove(); return; }
            _showTwoChoiceDialog('📝', 'יש שינויים', '',
                '💾 שמור', '#3b82f6', function() { document.getElementById('lesson-create-confirm').click(); },
                '🗑️ בטל', '#ef4444', function() { modal.remove(); }
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

    _.currentEditorLessonId = null;

    function openLessonEditor(lessonId) {
        _.currentEditorLessonId = lessonId;
        var lesson = getLesson(lessonId);
        if (!lesson) return;

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
    _.inlineOpen = {};

    function renderEditor(lesson) {
        var editor = document.getElementById('lesson-editor');
        if (!editor) return;

        editor.innerHTML =
            '<div class="container" style="max-width:800px">' +
                '<header>' +
                    '<div style="text-align:center;color:#64748b;font-size:13px;margin-bottom:4px">מסך עריכת שיעור</div>' +
                    '<div class="header-row">' +
                        '<h1>✏️ ' + escapeHtml(lesson.title) + '</h1>' +
                        '<div class="header-buttons">' +
                            '<button id="editor-media-warehouse-btn" class="btn btn-secondary" style="background:#6366f1;color:white;border-color:#6366f1">📦 מחסן מדיה</button>' +
                            '<button id="editor-preview-btn" class="btn btn-primary">▶ הצג שיעור</button>' +
                            '<button id="editor-back-btn" class="btn btn-secondary">חזרה</button>' +
                        '</div>' +
                    '</div>' +
                '</header>' +
                '<div id="editor-pages-list" style="margin-top:16px"></div>' +
                '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
                    '<button class="btn btn-primary add-page-btn" data-type="text" style="padding:10px 20px">+ טקסט</button>' +
                    '<button class="btn btn-primary add-page-btn" data-type="image" style="padding:10px 20px;background:linear-gradient(135deg,#8b5cf6,#6d28d9)">+ תמונה/סרטון 🖼️🎬</button>' +
                    '<button class="btn btn-primary add-page-btn" data-type="analyze" style="padding:10px 20px;background:linear-gradient(135deg,#0d9488,#0891b2)">+ ניתוח</button>' +
                    '<button class="btn btn-primary add-page-btn" data-type="engineering" style="padding:10px 20px;background:linear-gradient(135deg,#ea580c,#dc2626)">+ הינדוס</button>' +
                '</div>' +
            '</div>';

        // Wire buttons (with unsaved changes check)
        function _hasUnsavedInlineEdits() {
            for (var pid in _.inlineOpen) {
                if (_.inlineOpen[pid].dirty) return true;
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

        editor.querySelectorAll('.add-page-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                // Check if any inline editor is open with unsaved changes
                var hasDirty = false;
                for (var pid in _.inlineOpen) {
                    if (_.inlineOpen[pid].dirty) { hasDirty = true; break; }
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
                        for (var k in _.inlineOpen) delete _.inlineOpen[k];
                        showAddPageDialog(lesson.id, btn.dataset.type);
                    });
                } else {
                    showAddPageDialog(lesson.id, btn.dataset.type);
                }
            });
        });

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
            '.lpc-drag-handle{display:flex;align-items:center;justify-content:center;padding:4px 0;cursor:grab;color:#9ca3af;font-size:1.1em;letter-spacing:2px;user-select:none;border-bottom:1px solid #e5e7eb;margin:-12px -16px 8px -40px;padding:6px;border-radius:8px 8px 0 0;transition:background 0.15s,color 0.15s}',
            '.lpc-drag-handle:hover{background:#f0fdf4;color:#0d9488}',
            '.lpc-drag-handle:active{cursor:grabbing}',
            '.lpc-drag-handle-bottom{border-bottom:none;border-top:1px solid #e5e7eb;margin:-12px -16px -12px -40px;margin-top:8px;border-radius:0 0 8px 8px}',
            '@keyframes lpc-dup-pulse{0%{box-shadow:0 0 0 0 rgba(37,99,235,0.7)}70%{box-shadow:0 0 0 10px rgba(37,99,235,0)}100%{box-shadow:0 0 0 0 rgba(37,99,235,0)}}',
            '.lpc-dup-anim{animation:lpc-dup-pulse 0.6s ease-out}',
            '@keyframes lpc-save-flash{0%{background:#dcfce7}100%{background:white}}',
            '.lpc-save-flash{animation:lpc-save-flash 0.7s ease-out}',
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


    function renderEditorPages(lesson) {
        _injectEditorStyles();

        var list = document.getElementById('editor-pages-list');
        if (!list) return;
        list.innerHTML = '';

        if (lesson.pages.length === 0) {
            list.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px">אין דפים עדיין. הוסף דפים באמצעות הכפתורים למטה.</p>';
            return;
        }

        var typeLabels = { text: '📝 טקסט', image: '🖼️🎬 מדיה', video: '🖼️🎬 מדיה', analyze: '🔍 ניתוח', diacritics: '◌َ ניקוד', dictionary: '📖 מילון', engineering: '🧩 הינדוס' };
        var typeColors = { text: '#6b7280', image: '#8b5cf6', video: '#8b5cf6', analyze: '#0d9488', diacritics: '#8b5cf6', dictionary: '#0891b2', engineering: '#ea580c' };

        // Reset inline editors tracking on re-render
        _.inlineOpen = {};

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
            for (var pid in _.inlineOpen) {
                if (pid === exceptPageId) continue;
                if (_.inlineOpen[pid].dirty) {
                    otherDirty = pid;
                    break;
                }
            }
            if (otherDirty) {
                _showSavePrompt(function(choice) {
                    if (choice === 'cancel') { if (callback) callback(false); return; }
                    // Save or discard — close all others
                    for (var pid in _.inlineOpen) {
                        if (pid === exceptPageId) continue;
                        if (choice === 'save' && _.inlineOpen[pid].dirty) {
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
                    for (var pid2 in _.inlineOpen) {
                        if (pid2 !== exceptPageId) delete _.inlineOpen[pid2];
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
            for (var pid3 in _.inlineOpen) {
                if (pid3 !== exceptPageId) delete _.inlineOpen[pid3];
            }
            if (callback) callback(true);
        }

        function _buildInlineEditor(card, page, pageIdx) {
            var existing = card.querySelector('.lpc-inline-editor');
            if (existing) {
                if (_.inlineOpen[page.id] && _.inlineOpen[page.id].dirty) {
                    _showSavePrompt(function(choice) {
                        if (choice === 'save') {
                            // Click the save button then close
                            var saveBtn = existing.querySelector('.btn.btn-primary');
                            if (saveBtn) saveBtn.click();
                        }
                        if (choice === 'save' || choice === 'discard') {
                            existing.remove();
                            delete _.inlineOpen[page.id];
                            card.draggable = true;
                            card.style.cursor = 'grab';
                        }
                        // choice === 'cancel' → do nothing
                    });
                    return;
                }
                existing.remove();
                delete _.inlineOpen[page.id];
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

            _.inlineOpen[page.id] = { dirty: false };

            var editor = document.createElement('div');
            editor.className = 'lpc-inline-editor';

            // Formatting bar
            var fmtBar = document.createElement('div');
            fmtBar.className = 'lpc-fmt-bar';

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

            // Black separator between colors and fullscreen
            var blackSep = document.createElement('span');
            blackSep.style.cssText = 'width:2px;background:#000000;height:22px;display:inline-block;margin:0 4px';
            fmtBar.appendChild(blackSep);

            // Fullscreen button (leftmost in RTL)
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
                // Remove exit button from toolbar before restoring
                var exitBtn = fmtBar.querySelector('[data-fs-exit]');
                if (exitBtn) exitBtn.remove();
                _inlineFsOverlay.parentNode.removeChild(_inlineFsOverlay);
                _inlineFsOverlay = null;
                document.body.style.overflow = '';
                inlineFsBtn.textContent = '⛶';
                inlineFsBtn.title = 'מסך מלא';
                inlineFsBtn.style.display = '';
            }
            inlineFsBtn.addEventListener('click', function() {
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


                    // Blue ✕ exit button — add to toolbar row (leftmost in RTL = last child)
                    var _inlineFsExitBtn = document.createElement('button');
                    _inlineFsExitBtn.textContent = '✕';
                    _inlineFsExitBtn.setAttribute('data-fs-exit', 'true');
                    _inlineFsExitBtn.style.cssText = 'background:#0891b2;color:white;border:none;width:28px;height:28px;border-radius:6px;font-weight:bold;font-size:1em;cursor:pointer;flex-shrink:0;line-height:1;display:flex;align-items:center;justify-content:center';
                    _inlineFsExitBtn.addEventListener('click', function(e) { e.stopPropagation(); _exitInlineFullscreen(); });
                    fmtBar.appendChild(_inlineFsExitBtn);

                    _inlineFsOverlay.appendChild(fmtBar);
                    _inlineFsOverlay.appendChild(contentEl);
                    contentEl.style.cssText = 'width:100%;flex:1;padding:16px;border:2px solid #d1d5db;border-radius:8px;font-size:28px;font-family:PlonterFlippedDiacritics,Arial,serif;outline:none;overflow-y:auto;line-height:2;direction:rtl;resize:none';

                    document.body.appendChild(_inlineFsOverlay);
                    document.body.style.overflow = 'hidden';
                    contentEl.focus();
                    inlineFsBtn.style.display = 'none';
                }
            });
            fmtBar.appendChild(inlineFsBtn);

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
                sentenceEl.value = page.sentence || page.content.replace(/<[^>]*>/g, '') || '';
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
                mediaUrlEl.addEventListener('input', function() { _.inlineOpen[page.id].dirty = true; });
                editor.appendChild(mediaUrlEl);
            }

            // Content
            var contentLabel = document.createElement('label');
            contentLabel.textContent = hasSentence ? 'גוף טקסט (אופציונלי)' : (page.type === 'image' || page.type === 'video') ? 'טקסט (אופציונלי)' : 'תוכן';
            editor.appendChild(contentLabel);
            var contentEl = document.createElement('div');
            contentEl.contentEditable = 'true';
            contentEl.dir = 'rtl';
            contentEl.innerHTML = hasSentence ? (page.bodyText || '') : (page.content || '');
            editor.appendChild(contentEl);

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
                _.inlineOpen[page.id].dirty = true;
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
                    _.inlineOpen[page.id].dirty = true;
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
            var origSentence = hasSentence ? (page.sentence || page.content.replace(/<[^>]*>/g, '') || '') : '';
            function _isDirty() {
                return titleEl.value !== origTitle ||
                    contentEl.innerHTML !== origContent ||
                    notesEl.value !== origNotes ||
                    (sentenceEl && sentenceEl.value !== origSentence);
            }
            titleEl.addEventListener('input', function() { _.inlineOpen[page.id].dirty = true; });
            contentEl.addEventListener('input', function() { _.inlineOpen[page.id].dirty = true; });
            notesEl.addEventListener('input', function() { _.inlineOpen[page.id].dirty = true; });
            if (sentenceEl) sentenceEl.addEventListener('input', function() { _.inlineOpen[page.id].dirty = true; });

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
                                _.inlineOpen[page.id].dirty = true;
                            }
                        } else if (document.activeElement === titleEl) {
                            var start = titleEl.selectionStart, end = titleEl.selectionEnd;
                            if (start !== end) {
                                var val = titleEl.value;
                                var selected = val.substring(start, end);
                                titleEl.value = val.substring(0, start) + DetailsPanel._convertHebrewToArabic(selected) + val.substring(end);
                                _.inlineOpen[page.id].dirty = true;
                            }
                        } else if (sentenceEl && document.activeElement === sentenceEl) {
                            var start = sentenceEl.selectionStart, end = sentenceEl.selectionEnd;
                            if (start !== end) {
                                var val = sentenceEl.value;
                                var selected = val.substring(start, end);
                                sentenceEl.value = val.substring(0, start) + DetailsPanel._convertHebrewToArabic(selected) + val.substring(end);
                                _.inlineOpen[page.id].dirty = true;
                            }
                        } else if (document.activeElement === notesEl) {
                            var start = notesEl.selectionStart, end = notesEl.selectionEnd;
                            if (start !== end) {
                                var val = notesEl.value;
                                var selected = val.substring(start, end);
                                notesEl.value = val.substring(0, start) + DetailsPanel._convertHebrewToArabic(selected) + val.substring(end);
                                _.inlineOpen[page.id].dirty = true;
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
                updatePage(lesson.id, page.id, updateData);
                // Update page object so reopening the editor shows saved content
                page.content = content;
                page.title = title;
                page.notes = notes;
                if (hasSentence && sentenceEl) {
                    page.sentence = content;
                    page.bodyText = contentEl.innerHTML.trim();
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
                // Green flash on card
                card.classList.add('lpc-save-flash');
                setTimeout(function() { card.classList.remove('lpc-save-flash'); }, 750);
                // Update originals so dirty check resets
                origTitle = title;
                origContent = content;
                origNotes = notes;
                _.inlineOpen[page.id].dirty = false;
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
                delete _.inlineOpen[page.id];
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
                if (_isDirty() || (_.inlineOpen[page.id] && _.inlineOpen[page.id].dirty)) {
                    _showSavePrompt(function(choice) {
                        if (choice === 'save') saveBtn.click();
                        if (choice === 'save' || choice === 'discard') {
                            editor.remove();
                            delete _.inlineOpen[page.id];
                            card.draggable = true;
                            card.style.cursor = 'grab';
                        }
                    });
                    return;
                }
                editor.remove();
                delete _.inlineOpen[page.id];
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
            card.style.cssText = 'position:relative;border:2px solid ' + (typeColors[page.type] || '#d1d5db') + ';border-radius:10px;padding:12px 16px 12px 40px;margin-bottom:8px;background:white';
            card.draggable = true;
            card.style.cursor = 'grab';
            card.dataset.idx = idx;

            // When inline editor is open, disable dragging on the card
            // (will be toggled by _buildInlineEditor)

            card.addEventListener('dragend', function() {
                if (!card.querySelector('.lpc-inline-editor')) {
                    card.draggable = true;
                }
            });

            // Single click on card opens/closes inline editor
            (function(capturedIdx) {
                card.addEventListener('click', function(e) {
                    // Don't trigger if clicking a button or inside the editor
                    if (e.target.closest('button')) return;
                    if (e.target.closest('.lpc-inline-editor')) return;
                    _buildInlineEditor(card, page, capturedIdx);
                });
            })(idx);

            // --- Delete button: ✕ top-right (RTL: right side visually = start side) ---
            var delPageBtn = document.createElement('button');
            delPageBtn.className = 'lpc-delete-btn';
            delPageBtn.innerHTML = '✕';
            delPageBtn.title = 'מחק דף';
            delPageBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                _showStyledConfirm('למחוק את הדף?', function() {
                    removePage(lesson.id, page.id);
                    renderEditor(getLesson(lesson.id));
                });
            });
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
                    escapeHtml(page.content.replace(/<[^>]*>/g, '').substring(0, 80)) +
                  '</div>';
            var _notesColor = _diffSummary ? '#a855f7' : '#9ca3af';
            info.innerHTML =
                '<div style="font-weight:bold;font-size:0.85em;color:' + (typeColors[page.type] || '#6b7280') + '">' + (typeLabels[page.type] || page.type) + '</div>' +
                _bodyPreview +
                (page.notes ? '<div style="font-size:0.8em;color:' + _notesColor + ';margin-top:2px">' + escapeHtml(page.notes) + '</div>' : '');

            var actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:4px;flex-shrink:0';

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
                    clone.id = 'page_' + Date.now();
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
                            newCard.click();
                        }
                        var title = capturedPage.title || ('\u05e9\u05e7\u05e3 ' + (capturedIdx + 1));
                        _showEditorToast('\u05e9\u05db\u05e4\u05dc\u05ea \u05d0\u05ea \u2014 ' + title);
                    }, 50);
                }
                dupPageBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    // Check if this page has unsaved inline edits
                    if (_.inlineOpen[capturedPage.id] && _.inlineOpen[capturedPage.id].dirty) {
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

            bodyRow.appendChild(num);
            bodyRow.appendChild(info);
            bodyRow.appendChild(actions);
            card.appendChild(bodyRow);

            // --- Drag & Drop (card events) ---
            card.addEventListener('dragstart', function(e) {
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
        var editor = document.getElementById('lesson-editor');
        if (editor) editor.style.display = 'none';
        document.getElementById('welcome-screen').style.display = '';
        _.currentEditorLessonId = null;
        renderLessonsList();
        window.scrollTo(0, 0);
    }

    // --- UI: Add/Edit Page Dialog ---

    function showAddPageDialog(lessonId, type) {
        _showPageDialog(lessonId, type, null);
    }

    function showEditPageDialog(lessonId, page) {
        _showPageDialog(lessonId, page.type, page);
    }

    function _showPageDialog(lessonId, type, existingPage) {
        var typeLabels = { text: 'טקסט', image: 'תמונה/סרטון', video: 'תמונה/סרטון', analyze: 'ניתוח תחבירי', diacritics: 'חשיפת ניקוד', dictionary: 'חיפוש מילון', engineering: 'הינדוס משפט' };
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
        modal.innerHTML =
            '<div class="modal-content" style="max-width:500px">' +
                '<span class="close">&times;</span>' +
                '<h2 style="margin-bottom:16px;color:#0d9488">' + (isEdit ? 'עריכת' : 'הוספת') + ' שקף — ' + (typeLabels[type] || type) + '</h2>' +
                '<div style="margin-bottom:12px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">כותרת (אופציונלי)</label>' +
                    '<input type="text" id="page-title-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:1em" dir="rtl" placeholder="כותרת הדף..." value="' + escapeAttr(isEdit ? existingPage.title : '') + '">' +
                '</div>' +
                ((type === 'analyze' || type === 'engineering') ?
                    '<div style="margin-bottom:12px">' +
                        '<label style="display:block;margin-bottom:4px;font-weight:bold">משפט ל' + (type === 'analyze' ? 'ניתוח' : 'הינדוס') + '</label>' +
                        '<input type="text" id="page-sentence-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:1.1em;font-family:PlonterFlippedDiacritics,Arial,serif" dir="rtl" placeholder="הקלד את המשפט כאן..." value="' + escapeAttr(isEdit && existingPage.sentence ? existingPage.sentence : (isEdit ? existingPage.content.replace(/<[^>]*>/g, '') : '')) + '">' +
                    '</div>' : '') +
                (type === 'image' || type === 'video' ?
                    '<div style="margin-bottom:12px">' +
                        '<label style="display:block;margin-bottom:4px;font-weight:bold">כתובת מדיה (תמונה / YouTube / סרטון)</label>' +
                        '<input type="text" id="page-media-url-input" style="width:100%;padding:10px;border:2px solid #d1d5db;border-radius:8px;font-size:0.95em" dir="ltr" placeholder="https://..." value="' + escapeAttr(isEdit ? (existingPage.imageUrl || existingPage.videoUrl || '') : '') + '">' +
                        '<div id="page-media-preview" style="margin-top:8px;text-align:center;display:none"><img id="page-media-preview-img" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #d1d5db;display:none"><iframe id="page-media-preview-iframe" style="width:100%;max-width:400px;height:225px;border:none;border-radius:8px;display:none"></iframe></div>' +
                    '</div>' : '') +
                '<div style="margin-bottom:12px">' +
                    '<label style="display:block;margin-bottom:4px;font-weight:bold">' + (type === 'analyze' || type === 'engineering' ? 'גוף טקסט (אופציונלי)' : (type === 'image' || type === 'video') ? 'טקסט (אופציונלי)' : 'תוכן') + '</label>' +
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
                        '<button type="button" id="fmt-btn-fullscreen" title="מסך מלא" style="padding:4px 8px;border:1px solid #0d9488;border-radius:4px;background:#f0fdfa;cursor:pointer;font-size:1.1em;line-height:1;color:#0d9488">⛶</button>' +
                    '</div>' +
                    '<div id="page-content-input" contenteditable="true" dir="rtl" style="width:100%;min-height:' + (isEdit ? '300px' : '100px') + ';padding:12px;border:2px solid #d1d5db;border-radius:8px;font-size:' + (isEdit ? '24px' : '1.1em') + ';font-family:PlonterFlippedDiacritics,Arial,serif;outline:none;overflow-y:auto;max-height:' + (isEdit ? '70vh' : '200px') + ';line-height:' + (isEdit ? '2' : '1.6') + ';resize:vertical" data-placeholder="הדבק או הקלד טקסט בערבית..."></div>' +
                '</div>' +
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

        // Media URL preview (unified image/video)
        var mediaUrlInput = document.getElementById('page-media-url-input');
        if (mediaUrlInput) {
            var previewDiv = document.getElementById('page-media-preview');
            var previewImg = document.getElementById('page-media-preview-img');
            var previewIframe = document.getElementById('page-media-preview-iframe');
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
                    // YouTube video
                    if (previewImg) previewImg.style.display = 'none';
                    if (previewIframe) { previewIframe.src = embedUrl; previewIframe.style.display = 'block'; }
                    if (previewDiv) previewDiv.style.display = 'block';
                } else {
                    // Image or direct video — show as image preview
                    if (previewIframe) { previewIframe.style.display = 'none'; previewIframe.src = ''; }
                    if (previewImg) {
                        previewImg.src = url;
                        previewImg.style.display = 'block';
                        previewImg.onerror = function() { previewImg.style.display = 'none'; };
                    }
                    if (previewDiv) previewDiv.style.display = 'block';
                }
            }
            mediaUrlInput.addEventListener('input', _updateMediaPreview);
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
                document.execCommand(cmd, false, null);
                if (cmd === 'removeFormat') {
                    document.execCommand('foreColor', false, '#000000');
                    window.getSelection() && window.getSelection().removeAllRanges();
                }
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
                var exitBtnInToolbar = toolbar.querySelector('[data-fs-exit]');
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

                    // Blue ✕ exit button — add to toolbar row (leftmost in RTL = last child)
                    var fsExitBtn = document.createElement('button');
                    fsExitBtn.textContent = '✕';
                    fsExitBtn.setAttribute('data-fs-exit', 'true');
                    fsExitBtn.style.cssText = 'background:#0891b2;color:white;border:none;width:28px;height:28px;border-radius:6px;font-weight:bold;font-size:1em;cursor:pointer;flex-shrink:0;line-height:1;display:flex;align-items:center;justify-content:center';
                    fsExitBtn.addEventListener('click', function(e) { e.stopPropagation(); _exitDialogFullscreen(); });
                    toolbar.appendChild(fsExitBtn);

                    _fsOverlay.appendChild(toolbar);
                    _fsOverlay.appendChild(contentInput);
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
            if (!hasSentenceField && type !== 'image' && type !== 'video' && !contentInput.textContent.trim()) {
                contentInput.style.borderColor = '#ef4444';
                return false;
            }
            // Media type: require URL
            var mediaUrlEl = document.getElementById('page-media-url-input');
            if ((type === 'image' || type === 'video') && mediaUrlEl && !mediaUrlEl.value.trim()) {
                mediaUrlEl.style.borderColor = '#ef4444';
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
            _showTwoChoiceDialog('📝', 'יש שינויים שלא נשמרו', 'מה תרצה לעשות?',
                '✏️ המשך לעבוד', '#0d9488', function() { /* do nothing, stay */ },
                '🗑️ בטל', '#ef4444', function() { modal.remove(); }
            );
        }
        // Click outside: ask "cancel or save?"
        function _onBackdropClick() {
            if (typeof _exitDialogFullscreen === 'function' && _fsOverlay) _exitDialogFullscreen();
            if (!_dialogIsDirty()) { modal.remove(); return; }
            _showTwoChoiceDialog('📝', 'יש שינויים שלא נשמרו', 'מה תרצה לעשות?',
                '💾 שמור', '#3b82f6', function() { _doSaveAndClose(); },
                '🗑️ בטל', '#ef4444', function() { modal.remove(); }
            );
        }

        document.getElementById('page-dialog-confirm').addEventListener('click', _doSaveAndClose);
        document.getElementById('page-dialog-cancel').addEventListener('click', _onCancelOrX);
        modal.querySelector('.close').addEventListener('click', _onCancelOrX);
        // Outside click does NOT close — only cancel/save/X buttons close
    }

    // --- UI: Lesson Viewer (Fatwa-style Presentation) ---


    // --- Qmark Editor Mode ---
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
                    if (contentEl._qmarkPageId && _.inlineOpen[contentEl._qmarkPageId]) {
                        _.inlineOpen[contentEl._qmarkPageId].dirty = true;
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

    // --- Media Warehouse ---
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
        // Collect locked items from media slides
        var lockedItems = [];
        for (var i = 0; i < lesson.pages.length; i++) {
            var p = lesson.pages[i];
            if ((p.type === 'image' || p.type === 'video') && (p.videoUrl || p.imageUrl)) {
                lockedItems.push({ url: p.videoUrl || p.imageUrl, title: p.title || 'שקף ' + (i + 1), slideIdx: i });
            }
        }
        // Get custom items
        if (!lesson.mediaWarehouse) lesson.mediaWarehouse = [];
        var customItems = lesson.mediaWarehouse.slice(); // copy

        // Build popup
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center';
        var popup = document.createElement('div');
        popup.style.cssText = 'background:white;border-radius:16px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,0.3)';
        popup.innerHTML = '<h2 style="margin:0 0 4px;font-size:1.2em">📦 מחסן מדיה</h2>' +
            '<div style="font-size:0.78em;color:#64748b;margin-bottom:12px">סמן ⭐ ליד פריט אחד כדי שייפתח אוטומטית בכניסה לשיעור</div>';

        // Locked items section
        if (lockedItems.length > 0) {
            var lockedSection = document.createElement('div');
            lockedSection.innerHTML = '<div style="font-weight:bold;margin-bottom:8px;color:#6b7280;font-size:0.9em">🔒 מדיה משקפים (לא ניתן לערוך)</div>';
            for (var li = 0; li < lockedItems.length; li++) {
                var litem = lockedItems[li];
                var lrow = document.createElement('div');
                lrow.style.cssText = 'padding:8px;margin:4px 0;border-radius:8px;background:#f1f5f9;border:1px solid #e2e8f0;opacity:0.7';
                lrow.innerHTML = '<div style="font-weight:bold;font-size:0.9em">' + escapeHtml(litem.title) + '</div>' +
                    '<div style="font-size:0.75em;color:#9ca3af;direction:ltr;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + escapeHtml(litem.url) + '</div>';
                lrow.addEventListener('click', (function(slideIdx) {
                    return function() {
                        MessageManager.show('מדיה זו נמצאת בשקף ' + (slideIdx + 1) + '. על מנת לערוך, ערוך את השקף.', 'info');
                    };
                })(litem.slideIdx));
                lockedSection.appendChild(lrow);
            }
            popup.appendChild(lockedSection);
        }

        // Custom items section
        var customSection = document.createElement('div');
        customSection.innerHTML = '<div style="font-weight:bold;margin:12px 0 8px;color:#333;font-size:0.9em">✏️ מדיה מותאמת אישית</div>';
        var itemsContainer = document.createElement('div');
        itemsContainer.id = 'mw-items';

        function _addItemRow(url, title) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:6px;margin:6px 0;align-items:center';
            var openerBtn = document.createElement('button');
            openerBtn.type = 'button';
            openerBtn.dataset.role = 'opener-toggle';
            var isOpener = !!(url && lesson.audioUrl && url === lesson.audioUrl);
            row.dataset.opener = isOpener ? '1' : '0';
            openerBtn.title = 'סמן כקטע פתיחה — ייפתח אוטומטית כשנכנסים לשיעור';
            openerBtn.textContent = isOpener ? '⭐' : '☆';
            openerBtn.style.cssText = 'background:none;border:1px solid ' + (isOpener ? '#f59e0b' : '#d1d5db') + ';border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:1.1em;flex-shrink:0;color:' + (isOpener ? '#f59e0b' : '#9ca3af');
            openerBtn.addEventListener('click', function() {
                var wasOn = row.dataset.opener === '1';
                // Clear all other rows
                itemsContainer.querySelectorAll('div[data-type="custom"]').forEach(function(r) {
                    r.dataset.opener = '0';
                    var b = r.querySelector('button[data-role="opener-toggle"]');
                    if (b) { b.textContent = '☆'; b.style.borderColor = '#d1d5db'; b.style.color = '#9ca3af'; }
                });
                if (!wasOn) {
                    row.dataset.opener = '1';
                    openerBtn.textContent = '⭐';
                    openerBtn.style.borderColor = '#f59e0b';
                    openerBtn.style.color = '#f59e0b';
                }
            });
            var titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = title || '';
            titleInput.placeholder = 'כותרת';
            titleInput.dir = 'rtl';
            titleInput.style.cssText = 'flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em';
            var urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.value = url || '';
            urlInput.placeholder = 'קישור (URL)';
            urlInput.dir = 'ltr';
            urlInput.style.cssText = 'flex:2;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em';
            var delBtn = document.createElement('button');
            delBtn.textContent = '✕';
            delBtn.style.cssText = 'background:#ef4444;color:white;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:0.9em;flex-shrink:0';
            delBtn.addEventListener('click', function() { row.remove(); });
            row.appendChild(openerBtn);
            row.appendChild(titleInput);
            row.appendChild(urlInput);
            row.appendChild(delBtn);
            row.dataset.type = 'custom';
            itemsContainer.appendChild(row);
        }

        // Render existing custom items
        for (var ci = 0; ci < customItems.length; ci++) {
            _addItemRow(customItems[ci].url, customItems[ci].title);
        }

        customSection.appendChild(itemsContainer);

        // Add button
        var addBtn = document.createElement('button');
        addBtn.textContent = '➕ הוסף מדיה';
        addBtn.style.cssText = 'margin-top:8px;padding:8px 16px;border:2px dashed #6366f1;border-radius:8px;background:white;color:#6366f1;font-weight:bold;cursor:pointer;width:100%;font-size:0.95em';
        addBtn.addEventListener('click', function() { _addItemRow('', ''); });
        customSection.appendChild(addBtn);
        popup.appendChild(customSection);

        // Save/Close buttons
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-start';
        var saveBtn = document.createElement('button');
        saveBtn.textContent = 'שמור';
        saveBtn.className = 'btn btn-primary';
        saveBtn.style.cssText = 'padding:10px 24px;font-size:1em';
        saveBtn.addEventListener('click', function() {
            // Collect custom items + opener selection
            var rows = itemsContainer.querySelectorAll('div[data-type="custom"]');
            var newItems = [];
            var newOpenerUrl = '';
            var newOpenerTitle = '';
            rows.forEach(function(r) {
                var inputs = r.querySelectorAll('input');
                var t = inputs[0].value.trim();
                var u = inputs[1].value.trim();
                if (u) {
                    newItems.push({ url: u, title: t });
                    if (r.dataset.opener === '1' && !newOpenerUrl) {
                        newOpenerUrl = u;
                        newOpenerTitle = t;
                    }
                }
            });
            lesson.mediaWarehouse = newItems;
            lesson.audioUrl = newOpenerUrl || '';
            lesson.audioTitle = newOpenerTitle || '';
            var lessons = loadLessons();
            var idx = lessons.findIndex(function(l) { return l.id === lesson.id; });
            if (idx >= 0) {
                lessons[idx].mediaWarehouse = newItems;
                lessons[idx].audioUrl = lesson.audioUrl;
                lessons[idx].audioTitle = lesson.audioTitle;
                saveLessons(lessons);
            }
            overlay.remove();
            _restoreCursor();
            var openerNote = newOpenerUrl ? ' · קטע פתיחה: ' + (newOpenerTitle || newOpenerUrl) : '';
            MessageManager.show('מחסן מדיה נשמר (' + newItems.length + ' פריטים)' + openerNote, 'success');
        });
        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'סגור';
        closeBtn.className = 'btn btn-secondary';
        closeBtn.style.cssText = 'padding:10px 24px;font-size:1em';
        closeBtn.addEventListener('click', function() { overlay.remove(); _restoreCursor(); });
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(closeBtn);
        popup.appendChild(btnRow);

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


    // --- Register editor methods ---
    LM.renderLessonsList = renderLessonsList;
    LM.showCreateDialog = showCreateDialog;
    LM.showImportDialog = showImportDialog;
    LM.openLessonEditor = openLessonEditor;
    LM.renderEditor = renderEditor;
    LM.closeEditor = closeEditor;
    LM.showAddPageDialog = showAddPageDialog;
    LM.showEditPageDialog = showEditPageDialog;
    LM.filterLessonsList = function(query) {
        var container = document.getElementById("lessons-list");
        if (!container) return;
        if (!query || !query.trim()) { renderLessonsList(); return; }
        var lower = query.toLowerCase();
        var lessons = loadLessons().filter(function(l) {
            return l.title.toLowerCase().includes(lower) ||
                (l.description && l.description.toLowerCase().includes(lower));
        });
        container.innerHTML = "";
        if (lessons.length === 0) {
            container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px">לא נמצאו שיעורים.</p>';
            return;
        }
        lessons.forEach(function(lesson) {
            var item = document.createElement("div");
            item.className = "stage-item lesson-item";
            item.style.cursor = "pointer";
            var dateStr = new Date(lesson.updated).toLocaleDateString("he-IL");
            item.innerHTML = '<div style="flex:1;min-width:0"><div class="stage-number" style="font-size:1.1em;font-weight:bold;color:#0d9488">' +
                escapeHtml(lesson.title) + '</div><div style="font-size:0.85em;color:#6b7280;margin-top:2px">' +
                lesson.pages.length + ' דפים · ' + dateStr + '</div></div>';
            item.addEventListener("click", function() { LM.openLessonEditor(lesson.id); });
            container.appendChild(item);
        });
    };
    if (typeof _toggleAudioOnly === "function") LM._toggleAudioOnly = _toggleAudioOnly;
    if (typeof _openMediaWarehouse === "function") LM._openMediaWarehouse = _openMediaWarehouse;

    // Store editor functions on internal for presenter access
    _.renderLessonsList = function() { return LM.renderLessonsList(); };
    if (typeof _injectEditorStyles === "function") _injectEditorStyles();

})(LessonManager);
