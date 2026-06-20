/*
 * selfworkWorksheets.js — Plonter self-work worksheet creation flow (דפי ע"ע).
 *
 * P0 scope (2026-06-12): dragon-gated builder inside the real clone, read-only
 * ContentOrg library, local draft persistence, no index edits, no DB writes.
 * Wiring: @6m adds a single script tag after app.js/contentShare.
 */
window.PlonterSelfworkWorksheets = (function () {
    'use strict';

    var API = '/plonter/api/content_org_api.php';
    var STORAGE_KEY = 'plonter_selfwork_draft_v1';
    var STYLE_ID = 'selfwork-worksheets-style';
    var ROOT_ID = 'selfwork-worksheets-root';
    var ENTRY_ID = 'selfwork-worksheets-entry';
    var DRAGON_ROLE = '🐉 דרקון';

    var MATERIAL_TYPES = [
        { id: 'all', label: 'הכל', subject: '' },
        { id: 'analysis', label: 'תחביר', subject: 'analysis', tool: 'syntax' },
        { id: 'hindus', label: 'הינדוס', subject: 'hindus', tool: 'hindus' },
        { id: 'hataama', label: 'הטעמה', subject: 'hataama', tool: 'hataama' },
        { id: 'text', label: 'טקסט', subject: 'text', tool: 'texts' },
        { id: 'audio', label: 'שמע', subject: 'audio', tool: 'audio' }
    ];

    var state = {
        initialized: false,
        open: false,
        dragon: false,
        activeType: 'all',
        activeMode: 'edit',
        selectedFolderId: null,
        folders: [],
        tags: [],
        libraryItems: [],
        selectedItemKeys: {},
        loadingLibrary: false,
        libraryError: '',
        search: '',
        difficulty: '',
        draft: null,
        draggingBlockId: null
    };

    function _doc() { return (typeof document !== 'undefined' && document) ? document : null; }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function _token() {
        try {
            if (typeof PlonterAuth !== 'undefined' && PlonterAuth && typeof PlonterAuth.getToken === 'function') {
                var t = PlonterAuth.getToken();
                if (t) return t;
            }
        } catch (e) {}
        try {
            return localStorage.getItem('plonter_auth_token') ||
                localStorage.getItem('auth_otp_token_plonter') || '';
        } catch (e2) { return ''; }
    }

    function _callOrg(action, params) {
        if (typeof fetch === 'undefined') return Promise.resolve({ ok: false, error: 'fetch לא זמין' });
        var token = _token();
        if (!token) return Promise.resolve({ ok: false, error: 'צריך להתחבר כדי לקרוא תיקיות', _needsLogin: true });
        return fetch(API + '?action=' + encodeURIComponent(action), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(params || {})
        }).then(function (r) {
            return r.json();
        }).catch(function () {
            return { ok: false, error: 'שגיאת רשת' };
        });
    }

    function _itemKey(item) {
        return (item.store || 'content') + ':' + item.id;
    }

    function _now() { return new Date().toISOString(); }

    function _freshDraft() {
        return {
            id: 'worksheet_' + Date.now(),
            class_ref: { class_id: null, class_name: '' },
            teacher_id: null,
            title: 'דף עבודה עצמית חדש',
            topic: 'משולב',
            status: 'draft',
            open: false,
            due: '',
            selfcheck_with_answers: false,
            locked_bell: true,
            blocks: [],
            items: [],
            created_at: _now(),
            updated_at: _now()
        };
    }

    function _loadDraft() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            state.draft = raw ? JSON.parse(raw) : _freshDraft();
        } catch (e) {
            state.draft = _freshDraft();
        }
        if (!state.draft || !Array.isArray(state.draft.blocks)) state.draft = _freshDraft();
        if (!Array.isArray(state.draft.items)) state.draft.items = [];
    }

    function _saveDraft() {
        if (!state.draft) return;
        state.draft.updated_at = _now();
        state.draft.items = state.draft.blocks
            .filter(function (b) { return b.kind === 'exercise'; })
            .map(function (b, idx) { return _blockToWorksheetItem(b, idx); });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.draft)); } catch (e) {}
    }

    function _blockToWorksheetItem(block, idx) {
        return {
            id: block.id,
            worksheet_id: state.draft.id,
            tool_type: block.tool_type || 'syntax',
            order_idx: idx,
            title: block.title || '',
            source_ref: block.source_ref || null,
            payload: {
                sentence: block.sentence || '',
                expect: block.expect || null,
                has_answer: !!block.has_answer,
                teacher_attempts: block.teacher_attempts || []
            },
            max_score: block.max_score || 15
        };
    }

    function toWorksheetPayload() {
        _saveDraft();
        var d = state.draft || _freshDraft();
        return {
            id: d.id,
            class_ref: d.class_ref || { class_id: null, class_name: '' },
            teacher_id: d.teacher_id || null,
            title: d.title || '',
            topic: d.topic || 'משולב',
            status: d.status || 'draft',
            open: !!d.open,
            due: d.due || '',
            selfcheck_with_answers: !!d.selfcheck_with_answers,
            locked_bell: true,
            items: d.items || [],
            blocks: d.blocks || [],
            created_at: d.created_at || _now(),
            updated_at: d.updated_at || _now()
        };
    }

    function _typeLabel(contentType) {
        var map = {
            lesson: 'שיעור',
            analysis: 'תחביר',
            syntax: 'תחביר',
            hindus: 'הינדוס',
            hataama: 'הטעמה',
            audio: 'שמע',
            media: 'מדיה',
            text: 'טקסט'
        };
        return map[contentType] || contentType || 'פריט';
    }

    function _toolType(contentType) {
        if (contentType === 'hindus') return 'hindus';
        if (contentType === 'audio' || contentType === 'media') return 'audio';
        if (contentType === 'hataama') return 'hataama';
        return 'syntax';
    }

    function _selectedType() {
        for (var i = 0; i < MATERIAL_TYPES.length; i++) {
            if (MATERIAL_TYPES[i].id === state.activeType) return MATERIAL_TYPES[i];
        }
        return MATERIAL_TYPES[0];
    }

    function _normalizeItems(d) {
        if (!d || !d.ok) return [];
        return d.items || d.results || [];
    }

    function _buildTree(folders) {
        var byId = {}, roots = [];
        (folders || []).forEach(function (f) {
            byId[f.id] = {
                id: f.id,
                parent_id: f.parent_id == null ? null : f.parent_id,
                name: f.name || 'תיקייה',
                children: []
            };
        });
        Object.keys(byId).forEach(function (id) {
            var n = byId[id];
            if (n.parent_id != null && byId[n.parent_id]) byId[n.parent_id].children.push(n);
            else roots.push(n);
        });
        return roots;
    }

    function _hasAnswer(block) {
        return !!(block && (block.has_answer || (block.expect && typeof block.expect === 'object')));
    }

    function _injectStyle() {
        var doc = _doc();
        if (!doc || doc.getElementById(STYLE_ID)) return;
        var st = doc.createElement('style');
        st.id = STYLE_ID;
        st.textContent = [
            '.sw-root{position:fixed;inset:0;z-index:49000;background:#f8fafc;color:#0f172a;direction:rtl;font-family:inherit;display:none}',
            '.sw-root.sw-open{display:flex;flex-direction:column}',
            '.sw-top{height:64px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 18px;box-sizing:border-box}',
            '.sw-title{display:flex;align-items:center;gap:10px;min-width:0}.sw-title h2{margin:0;font-size:1.25em;color:#0f766e}.sw-title small{color:#64748b;font-weight:700}',
            '.sw-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sw-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:8px 11px;font-weight:800;cursor:pointer}.sw-btn.primary{background:#0d9488;border-color:#0d9488;color:#fff}.sw-btn.danger{background:#fff1f2;border-color:#fecdd3;color:#be123c}.sw-btn:disabled{opacity:.48;cursor:not-allowed}',
            '.sw-body{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:14px;padding:14px 18px;min-height:0;flex:1;box-sizing:border-box}',
            '.sw-panel{background:#fff;border:1px solid #e2e8f0;border-radius:8px;min-height:0;box-shadow:0 1px 3px rgba(15,23,42,.06)}',
            '.sw-library{display:flex;flex-direction:column;overflow:hidden}.sw-panel-head{padding:12px 12px 8px;border-bottom:1px solid #e2e8f0}.sw-panel-head h3{margin:0 0 8px;color:#0f766e;font-size:1em}.sw-field{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}.sw-field label{font-size:.78em;color:#64748b;font-weight:800}.sw-field input,.sw-field textarea,.sw-field select{border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font:inherit;box-sizing:border-box;width:100%;background:#fff}.sw-field textarea{min-height:74px;resize:vertical}',
            '.sw-lib-scroll{overflow:auto;padding:10px 12px;min-height:0;flex:1}.sw-folder{border:none;background:transparent;text-align:right;width:100%;padding:6px 8px;border-radius:7px;cursor:pointer;color:#334155;font-weight:700}.sw-folder.active,.sw-folder:hover{background:#ecfeff;color:#0e7490}.sw-folder-children{margin-right:14px;border-right:1px solid #e2e8f0;padding-right:6px}',
            '.sw-item{border:1px solid #e2e8f0;border-radius:8px;padding:9px;margin-bottom:8px;background:#fff;display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:start}.sw-item:hover{border-color:#99f6e4}.sw-item-title{font-weight:800;color:#0f172a}.sw-item-meta{font-size:.78em;color:#64748b;margin-top:4px}.sw-badge{display:inline-block;border-radius:999px;background:#eef2ff;color:#4338ca;padding:2px 7px;margin-left:4px;font-size:.76em;font-weight:800}',
            '.sw-editor{display:flex;flex-direction:column;overflow:hidden}.sw-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:14px;padding:12px;min-height:0;flex:1;overflow:hidden}.sw-stack{overflow:auto;padding-left:3px}.sw-settings{overflow:auto;border-right:1px solid #e2e8f0;padding-right:12px}',
            '.sw-block{border:1px solid #dbeafe;border-radius:8px;background:#fff;padding:10px 10px 10px;margin-bottom:10px;display:grid;grid-template-columns:58px minmax(0,1fr) 150px;gap:10px;align-items:start}.sw-block.dragging{opacity:.55}.sw-block-type{height:34px;border-radius:8px;background:#eff6ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-weight:900;cursor:grab}.sw-block h4{margin:0 0 5px;font-size:.98em}.sw-block p{margin:0;color:#64748b;font-size:.86em;line-height:1.35}.sw-block-tools{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap}.sw-icon{min-width:32px;height:32px;border:1px solid #cbd5e1;background:#fff;border-radius:7px;cursor:pointer;font-weight:900;color:#334155;padding:0 7px}.sw-icon:disabled{opacity:.35;cursor:not-allowed}',
            '.sw-add-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}.sw-empty{border:1px dashed #cbd5e1;border-radius:8px;padding:22px;text-align:center;color:#64748b;background:#f8fafc}.sw-preview{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:.86em;color:#334155;white-space:pre-wrap;max-height:220px;overflow:auto;direction:ltr;text-align:left}',
            '.sw-bottom{height:66px;border-top:1px solid #e2e8f0;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 18px;box-sizing:border-box}.sw-stub-actions{display:flex;gap:8px;flex-wrap:wrap}.sw-status{font-size:.86em;color:#64748b;font-weight:700}',
            '.sw-entry-wrap{display:flex;justify-content:center;margin:0 0 14px}.sw-entry{background:linear-gradient(135deg,#0d9488,#0891b2);color:#fff;border:none;border-radius:10px;padding:10px 16px;font-weight:900;box-shadow:0 4px 14px rgba(13,148,136,.25);cursor:pointer}',
            '.sw-student-view{display:none}.sw-root[data-mode=\"student\"] .sw-edit-view{display:none}.sw-root[data-mode=\"student\"] .sw-student-view{display:block}',
            '@media(max-width:860px){.sw-top{height:auto;min-height:64px;align-items:flex-start;flex-direction:column;padding:10px 12px}.sw-body{grid-template-columns:1fr;padding:10px}.sw-editor-grid{grid-template-columns:1fr}.sw-settings{border-right:0;border-top:1px solid #e2e8f0;padding:12px 0 0}.sw-block{grid-template-columns:44px 1fr}.sw-block-tools{grid-column:1/-1;justify-content:flex-start}.sw-bottom{height:auto;align-items:flex-start;flex-direction:column;padding:10px 12px}.sw-add-row{grid-template-columns:1fr}}'
        ].join('\n');
        doc.head.appendChild(st);
    }

    function _ensureRoot() {
        var doc = _doc();
        if (!doc) return null;
        var root = doc.getElementById(ROOT_ID);
        if (root) return root;
        root = doc.createElement('div');
        root.id = ROOT_ID;
        root.className = 'sw-root';
        root.setAttribute('dir', 'rtl');
        doc.body.appendChild(root);
        return root;
    }

    function _renderEntry() {
        var doc = _doc();
        if (!doc) return;
        var existing = doc.getElementById(ENTRY_ID);
        if (!state.dragon) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        var anchor = doc.getElementById('lessons-buttons') || doc.getElementById('mode-tabs');
        if (!anchor || !anchor.parentNode) return;
        var wrap = doc.createElement('div');
        wrap.id = ENTRY_ID;
        wrap.className = 'sw-entry-wrap';
        wrap.innerHTML = '<button type="button" class="sw-entry">דפי עבודה עצמית</button>';
        wrap.querySelector('button').addEventListener('click', open);
        anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    }

    function _isDragon() {
        try {
            if (typeof PlonterAdmin !== 'undefined' && PlonterAdmin && typeof PlonterAdmin.isDragon === 'function') {
                return !!PlonterAdmin.isDragon();
            }
            if (typeof PlonterAdmin !== 'undefined' && PlonterAdmin && typeof PlonterAdmin.getRole === 'function') {
                return PlonterAdmin.getRole() === DRAGON_ROLE;
            }
        } catch (e) {}
        return false;
    }

    function _syncGate() {
        state.dragon = _isDragon();
        _renderEntry();
        if (!state.dragon && state.open) close();
    }

    function _renderTypeOptions() {
        return MATERIAL_TYPES.map(function (t) {
            return '<option value="' + _esc(t.id) + '"' + (state.activeType === t.id ? ' selected' : '') + '>' +
                _esc(t.label) + '</option>';
        }).join('');
    }

    function _renderFolders(nodes) {
        if (!nodes || !nodes.length) return '<div class="sw-empty">אין תיקיות זמינות כרגע</div>';
        function walk(list) {
            return list.map(function (n) {
                return '<div>' +
                    '<button type="button" class="sw-folder' + (String(state.selectedFolderId) === String(n.id) ? ' active' : '') +
                    '" data-sw-folder="' + _esc(n.id) + '">' + _esc(n.name) + '</button>' +
                    (n.children && n.children.length ? '<div class="sw-folder-children">' + walk(n.children) + '</div>' : '') +
                '</div>';
            }).join('');
        }
        return walk(nodes);
    }

    function _renderLibraryItems() {
        if (state.loadingLibrary) return '<div class="sw-empty">טוען ספרייה...</div>';
        if (state.libraryError) return '<div class="sw-empty">' + _esc(state.libraryError) + '</div>';
        if (!state.libraryItems.length) return '<div class="sw-empty">אין פריטים תואמים. אפשר להוסיף בלוק טקסט או תמונה ידנית.</div>';
        return state.libraryItems.map(function (item) {
            var key = _itemKey(item);
            var checked = state.selectedItemKeys[key] ? ' checked' : '';
            var type = _typeLabel(item.content_type);
            var shortcut = item.is_shortcut ? '<span class="sw-badge">קיצור דרך</span>' : '';
            return '<label class="sw-item">' +
                '<input type="checkbox" data-sw-pick="' + _esc(key) + '"' + checked + '>' +
                '<span><span class="sw-item-title">' + _esc(item.title || 'ללא כותרת') + '</span>' +
                '<span class="sw-item-meta"><span class="sw-badge">' + _esc(type) + '</span>' + shortcut +
                ' ' + _esc(item.updated || '') + '</span></span>' +
            '</label>';
        }).join('');
    }

    function _renderBlocks() {
        var blocks = state.draft.blocks || [];
        if (!blocks.length) {
            return '<div class="sw-empty">עדיין אין בלוקים בדף. בחר פריטים מהספרייה או הוסף טקסט/תמונה.</div>';
        }
        return blocks.map(function (b, idx) {
            var icon = b.kind === 'text' ? 'ט' : (b.kind === 'image' ? 'ת' : 'ע');
            var meta = b.kind === 'exercise'
                ? (_typeLabel(b.tool_type) + (b.source_ref ? ' · ' + (b.source_ref.store || 'content') + ':' + b.source_ref.id : ''))
                : (b.kind === 'image' ? (b.image_url || 'תמונה ללא קישור') : (b.text || 'טקסט ריק'));
            var answer = b.kind === 'exercise' ? (_hasAnswer(b) ? ' · יש תשובה' : ' · בלי תשובה') : '';
            return '<div class="sw-block" draggable="true" data-sw-block="' + _esc(b.id) + '">' +
                '<div class="sw-block-type">' + _esc(icon) + '</div>' +
                '<div>' +
                    '<h4 contenteditable="true" data-sw-title="' + _esc(b.id) + '">' + _esc(b.title || 'בלוק') + '</h4>' +
                    '<p>' + _esc(meta) + _esc(answer) + '</p>' +
                '</div>' +
                '<div class="sw-block-tools">' +
                    '<button type="button" class="sw-icon" title="למעלה" data-sw-up="' + _esc(b.id) + '"' + (idx === 0 ? ' disabled' : '') + '>↑</button>' +
                    '<button type="button" class="sw-icon" title="למטה" data-sw-down="' + _esc(b.id) + '"' + (idx === blocks.length - 1 ? ' disabled' : '') + '>↓</button>' +
                    (b.kind === 'exercise' ? '<button type="button" class="sw-icon" title="עריכה" data-sw-edit="' + _esc(b.id) + '">ערוך</button>' : '') +
                    (b.kind === 'exercise' ? '<button type="button" class="sw-icon" title="צפייה מנקודת מבט החניך" data-sw-view-student="' + _esc(b.id) + '">חניך</button>' : '') +
                    '<button type="button" class="sw-icon" title="הסרה מהדף" data-sw-remove="' + _esc(b.id) + '">×</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function _renderStudentPreview() {
        var blocks = state.draft.blocks || [];
        if (!blocks.length) return '<div class="sw-empty">אין עדיין מה להציג לתלמיד.</div>';
        return blocks.map(function (b, idx) {
            return '<div class="sw-block">' +
                '<div class="sw-block-type">' + (idx + 1) + '</div>' +
                '<div><h4>' + _esc(b.title || 'משימה') + '</h4><p>' +
                _esc(b.kind === 'exercise' ? 'פתיחת מנוע ' + _typeLabel(b.tool_type) + ' ושמירת ניסיון תלמיד.' :
                    (b.kind === 'image' ? 'צפייה בתמונה / הוראות מצורפות.' : (b.text || 'טקסט לתלמיד'))) +
                '</p></div>' +
                '<div class="sw-block-tools"><button type="button" class="sw-btn" disabled>שמור ניסיון</button></div>' +
            '</div>';
        }).join('');
    }

    function _render() {
        var root = _ensureRoot();
        if (!root || !state.draft) return;
        root.className = 'sw-root' + (state.open ? ' sw-open' : '');
        root.setAttribute('data-mode', state.activeMode);
        root.innerHTML =
            '<div class="sw-top">' +
                '<div class="sw-title"><h2>דפי עבודה עצמית</h2><small>בונה דף בתוך הכיתה · טיוטה מקומית</small></div>' +
                '<div class="sw-actions">' +
                    '<button type="button" class="sw-btn' + (state.activeMode === 'edit' ? ' primary' : '') + '" data-sw-mode="edit">מצב עריכה</button>' +
                    '<button type="button" class="sw-btn' + (state.activeMode === 'student' ? ' primary' : '') + '" data-sw-mode="student">מצב תלמיד</button>' +
                    '<button type="button" class="sw-btn" data-sw-export>הצג payload</button>' +
                    '<button type="button" class="sw-btn danger" data-sw-close>סגור</button>' +
                '</div>' +
            '</div>' +
            '<div class="sw-body">' +
                '<aside class="sw-panel sw-library">' +
                    '<div class="sw-panel-head">' +
                        '<h3>ספרייה / Drive</h3>' +
                        '<div class="sw-field"><label>סינון חומר בספרייה</label><select data-sw-type>' + _renderTypeOptions() + '</select></div>' +
                        '<div class="sw-field"><label>חיפוש</label><input data-sw-search value="' + _esc(state.search) + '" placeholder="חפש בתיקיות ובתגים"></div>' +
                        '<div class="sw-field"><label>רמת קושי</label><select data-sw-difficulty><option value="">הכל</option><option' + (state.difficulty === 'קל' ? ' selected' : '') + '>קל</option><option' + (state.difficulty === 'בינוני' ? ' selected' : '') + '>בינוני</option><option' + (state.difficulty === 'קשה' ? ' selected' : '') + '>קשה</option></select></div>' +
                        '<button type="button" class="sw-btn primary" data-sw-add-selected>הוסף נבחרים לדף</button>' +
                        '<button type="button" class="sw-btn" style="margin-top:6px;width:100%" data-sw-pour-folder' + (state.selectedFolderId ? '' : ' disabled') + '>שפוך את כל התיקייה לדף</button>' +
                    '</div>' +
                    '<div class="sw-lib-scroll">' +
                        '<h3 style="margin:0 0 8px;font-size:.9em;color:#64748b">תיקיות</h3>' +
                        _renderFolders(_buildTree(state.folders)) +
                        '<h3 style="margin:14px 0 8px;font-size:.9em;color:#64748b">פריטים</h3>' +
                        _renderLibraryItems() +
                    '</div>' +
                '</aside>' +
                '<main class="sw-panel sw-editor">' +
                    '<div class="sw-editor-grid sw-edit-view">' +
                        '<section class="sw-stack">' +
                            '<div class="sw-add-row">' +
                                '<button type="button" class="sw-btn" data-sw-add-text>+ בלוק טקסט</button>' +
                                '<button type="button" class="sw-btn" data-sw-add-image>+ בלוק תמונה</button>' +
                                '<button type="button" class="sw-btn" data-sw-create-doc>+ צור חומר חדש</button>' +
                                '<button type="button" class="sw-btn" data-sw-clear-picks>נקה בחירה</button>' +
                            '</div>' +
                            _renderBlocks() +
                        '</section>' +
                        '<aside class="sw-settings">' +
                            '<div class="sw-field"><label>שם הדף</label><input data-sw-draft-title value="' + _esc(state.draft.title || '') + '"></div>' +
                            '<div class="sw-field"><label>כיתה עתידית</label><input data-sw-class-name value="' + _esc((state.draft.class_ref && state.draft.class_ref.class_name) || '') + '" placeholder="למשל: ז׳ 2"></div>' +
                            '<div class="sw-field"><label>סוג דף</label><select data-sw-topic><option' + (state.draft.topic === 'משולב' ? ' selected' : '') + '>משולב</option><option' + (state.draft.topic === 'תחביר' ? ' selected' : '') + '>תחביר</option><option' + (state.draft.topic === 'הינדוס' ? ' selected' : '') + '>הינדוס</option><option' + (state.draft.topic === 'הטעמה' ? ' selected' : '') + '>הטעמה</option></select></div>' +
                            '<label style="display:flex;gap:7px;align-items:center;margin:10px 0;color:#334155;font-weight:800"><input type="checkbox" data-sw-selfcheck' + (state.draft.selfcheck_with_answers ? ' checked' : '') + '> מצב בדיקה עצמית</label>' +
                            '<div class="sw-empty" style="text-align:right">הנר חסום תמיד בדפי ע״ע. פעולות מעקב/הגשה/שליחה לכיתה יתחברו בשלבים הבאים.</div>' +
                        '</aside>' +
                    '</div>' +
                    '<div class="sw-editor-grid sw-student-view"><section class="sw-stack">' + _renderStudentPreview() + '</section><aside class="sw-settings"><h3>הגשת תלמיד</h3><div class="sw-empty" style="text-align:right">כאן יוצגו ניסיונות, בחירת ניסיון להגשה והתקדמות. P0 מכין את מבנה הנתונים לזה.</div></aside></div>' +
                '</main>' +
            '</div>' +
            '<div class="sw-bottom">' +
                '<div class="sw-stub-actions">' +
                    '<button type="button" class="sw-btn" disabled>מעקב</button>' +
                    '<button type="button" class="sw-btn" disabled>הגדרות הגשה</button>' +
                    '<button type="button" class="sw-btn" disabled>שלח לכיתה</button>' +
                    '<button type="button" class="sw-btn primary" data-sw-create-doc>צור חומר חדש</button>' +
                '</div>' +
                '<div class="sw-status">נשמר מקומית · ' + _esc((state.draft.blocks || []).length) + ' בלוקים · ' + _esc((state.draft.items || []).length) + ' משימות</div>' +
            '</div>';
        _bindRoot(root);
    }

    function _bindRoot(root) {
        root.querySelectorAll('[data-sw-type]').forEach(function (el) {
            el.addEventListener('change', function () {
                state.activeType = el.value || 'all';
                _reloadLibraryAndRender();
            });
        });
        root.querySelectorAll('[data-sw-mode]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.activeMode = btn.getAttribute('data-sw-mode') || 'edit';
                _render();
            });
        });
        var closeBtn = root.querySelector('[data-sw-close]');
        if (closeBtn) closeBtn.addEventListener('click', close);
        var exportBtn = root.querySelector('[data-sw-export]');
        if (exportBtn) exportBtn.addEventListener('click', function () {
            alert(JSON.stringify(toWorksheetPayload(), null, 2));
        });
        var search = root.querySelector('[data-sw-search]');
        if (search) search.addEventListener('input', function () {
            state.search = search.value;
            _debouncedLibrary();
        });
        var difficulty = root.querySelector('[data-sw-difficulty]');
        if (difficulty) difficulty.addEventListener('change', function () {
            state.difficulty = difficulty.value;
            _reloadLibraryAndRender();
        });
        root.querySelectorAll('[data-sw-folder]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.selectedFolderId = btn.getAttribute('data-sw-folder');
                _reloadLibraryAndRender();
            });
        });
        root.querySelectorAll('[data-sw-pick]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var key = cb.getAttribute('data-sw-pick');
                if (cb.checked) state.selectedItemKeys[key] = true;
                else delete state.selectedItemKeys[key];
            });
        });
        _on(root, '[data-sw-add-selected]', 'click', _addSelectedItems);
        _on(root, '[data-sw-pour-folder]', 'click', _pourFolder);
        _on(root, '[data-sw-add-text]', 'click', _addTextBlock);
        _on(root, '[data-sw-add-image]', 'click', _addImageBlock);
        root.querySelectorAll('[data-sw-create-doc]').forEach(function (btn) {
            btn.addEventListener('click', _createNewDocument);
        });
        _on(root, '[data-sw-clear-picks]', 'click', function () { state.selectedItemKeys = {}; _render(); });
        _on(root, '[data-sw-draft-title]', 'input', function (e) { state.draft.title = e.target.value; _saveDraft(); });
        _on(root, '[data-sw-class-name]', 'input', function (e) {
            state.draft.class_ref = state.draft.class_ref || { class_id: null, class_name: '' };
            state.draft.class_ref.class_name = e.target.value;
            _saveDraft();
        });
        _on(root, '[data-sw-topic]', 'change', function (e) { state.draft.topic = e.target.value; _saveDraft(); _render(); });
        _on(root, '[data-sw-selfcheck]', 'change', function (e) { state.draft.selfcheck_with_answers = !!e.target.checked; _saveDraft(); });
        root.querySelectorAll('[data-sw-title]').forEach(function (el) {
            el.addEventListener('blur', function () {
                var block = _findBlock(el.getAttribute('data-sw-title'));
                if (block) {
                    block.title = el.textContent.trim() || block.title;
                    _saveDraft();
                    _render();
                }
            });
        });
        root.querySelectorAll('[data-sw-up]').forEach(function (b) {
            b.addEventListener('click', function () { _moveBlock(b.getAttribute('data-sw-up'), -1); });
        });
        root.querySelectorAll('[data-sw-down]').forEach(function (b) {
            b.addEventListener('click', function () { _moveBlock(b.getAttribute('data-sw-down'), 1); });
        });
        root.querySelectorAll('[data-sw-remove]').forEach(function (b) {
            b.addEventListener('click', function () { _removeBlock(b.getAttribute('data-sw-remove')); });
        });
        root.querySelectorAll('[data-sw-edit]').forEach(function (b) {
            b.addEventListener('click', function () { _editExerciseBlock(b.getAttribute('data-sw-edit')); });
        });
        root.querySelectorAll('[data-sw-view-student]').forEach(function (b) {
            b.addEventListener('click', function () {
                state.activeMode = 'student';
                state.studentFocusBlockId = b.getAttribute('data-sw-view-student');
                _render();
            });
        });
        root.querySelectorAll('[data-sw-block]').forEach(function (el) {
            el.addEventListener('dragstart', function () {
                state.draggingBlockId = el.getAttribute('data-sw-block');
                el.classList.add('dragging');
            });
            el.addEventListener('dragend', function () {
                state.draggingBlockId = null;
                el.classList.remove('dragging');
            });
            el.addEventListener('dragover', function (ev) { ev.preventDefault(); });
            el.addEventListener('drop', function (ev) {
                ev.preventDefault();
                _dropBlockBefore(state.draggingBlockId, el.getAttribute('data-sw-block'));
            });
        });
    }

    function _on(root, sel, ev, fn) {
        var el = root.querySelector(sel);
        if (el) el.addEventListener(ev, fn);
    }

    var _libraryTimer = null;
    function _debouncedLibrary() {
        clearTimeout(_libraryTimer);
        _libraryTimer = setTimeout(function () {
            _reloadLibraryAndRender();
        }, 250);
    }

    function _reloadLibraryAndRender() {
        state.loadingLibrary = true;
        _render();
        return _loadLibrary().then(_render);
    }

    function _findBlock(id) {
        var blocks = state.draft.blocks || [];
        for (var i = 0; i < blocks.length; i++) if (blocks[i].id === id) return blocks[i];
        return null;
    }

    function _addBlock(block) {
        state.draft.blocks.push(block);
        _saveDraft();
        _render();
    }

    function _addTextBlock() {
        _addBlock({
            id: 'block_text_' + Date.now(),
            kind: 'text',
            title: 'הוראה / טקסט',
            text: 'כתוב כאן הוראה לתלמידים.'
        });
    }

    function _addImageBlock() {
        _addBlock({
            id: 'block_image_' + Date.now(),
            kind: 'image',
            title: 'תמונה',
            image_url: '',
            alt: ''
        });
    }

    function _addSelectedItems() {
        var byKey = {};
        state.libraryItems.forEach(function (it) { byKey[_itemKey(it)] = it; });
        Object.keys(state.selectedItemKeys).forEach(function (key) {
            var it = byKey[key];
            if (!it) return;
            _addExerciseBlock(it);
        });
        state.selectedItemKeys = {};
        _saveDraft();
        _render();
    }

    function _addExerciseBlock(item) {
        var type = item.content_type || _selectedType().subject || 'analysis';
        state.draft.blocks.push({
            id: 'block_ex_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            kind: 'exercise',
            tool_type: _toolType(type),
            title: item.title || 'משימה',
            sentence: item.sentence || item.title || '',
            source_ref: { store: item.store || 'content', id: item.id, content_type: type },
            expect: null,
            has_answer: false,
            teacher_attempts: [],
            max_score: 15
        });
    }

    function _pourFolder() {
        if (!state.selectedFolderId) return;
        if (!state.libraryItems.length) return;
        state.libraryItems.forEach(function (it) { _addExerciseBlock(it); });
        state.selectedItemKeys = {};
        _saveDraft();
        _render();
    }

    function _createNewDocument() {
        var choice = '';
        try {
            choice = prompt('איזה חומר ליצור? תחביר / הינדוס / טקסט / שמע', 'תחביר') || '';
        } catch (e) { choice = 'תחביר'; }
        choice = choice.trim();
        var type = /הינדוס|hindus/i.test(choice) ? 'hindus' :
            (/שמע|audio/i.test(choice) ? 'audio' :
                (/טקסט|text/i.test(choice) ? 'texts' : 'syntax'));
        state.draft.blocks.push({
            id: 'block_new_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            kind: 'exercise',
            tool_type: type,
            title: 'חומר חדש - ' + (choice || 'תחביר'),
            sentence: '',
            source_ref: { store: 'local_draft', id: null, content_type: type, new_document: true },
            expect: null,
            has_answer: false,
            teacher_attempts: [],
            student_created_allowed: true,
            max_score: 15
        });
        _saveDraft();
        _render();
    }

    function _editExerciseBlock(id) {
        var block = _findBlock(id);
        if (!block) return;
        var next = '';
        try { next = prompt('כותרת המשימה', block.title || 'משימה') || ''; } catch (e) {}
        if (next.trim()) block.title = next.trim();
        _saveDraft();
        _render();
    }

    function _moveBlock(id, delta) {
        var blocks = state.draft.blocks || [];
        var idx = blocks.findIndex(function (b) { return b.id === id; });
        var next = idx + delta;
        if (idx < 0 || next < 0 || next >= blocks.length) return;
        var tmp = blocks[idx];
        blocks[idx] = blocks[next];
        blocks[next] = tmp;
        _saveDraft();
        _render();
    }

    function _dropBlockBefore(dragId, targetId) {
        if (!dragId || !targetId || dragId === targetId) return;
        var blocks = state.draft.blocks || [];
        var from = blocks.findIndex(function (b) { return b.id === dragId; });
        var to = blocks.findIndex(function (b) { return b.id === targetId; });
        if (from < 0 || to < 0) return;
        var item = blocks.splice(from, 1)[0];
        if (from < to) to -= 1;
        blocks.splice(to, 0, item);
        _saveDraft();
        _render();
    }

    function _removeBlock(id) {
        state.draft.blocks = (state.draft.blocks || []).filter(function (b) { return b.id !== id; });
        _saveDraft();
        _render();
    }

    function _loadFoldersAndTags() {
        return Promise.all([
            _callOrg('list_folders', {}),
            _callOrg('list_tags', {})
        ]).then(function (res) {
            var folders = res[0], tags = res[1];
            state.folders = folders && folders.ok ? (folders.folders || []) : [];
            state.tags = tags && tags.ok ? (tags.tags || []) : [];
            if (!state.folders.length && folders && !folders.ok) state.libraryError = folders.error || 'אין גישה לתיקיות';
        });
    }

    function _loadLibrary() {
        state.loadingLibrary = true;
        state.libraryError = '';
        var tab = _selectedType();
        var p = {
            scope: state.selectedFolderId ? 'folder' : 'all',
            include_archived: false
        };
        if (state.selectedFolderId) p.folder_id = state.selectedFolderId;
        if (tab.subject) p.subject = tab.subject;
        if (state.difficulty) p.difficulty = state.difficulty;
        if (state.search) p.q = state.search;
        return _callOrg('search_content', p).then(function (d) {
            state.loadingLibrary = false;
            if (!d || !d.ok) {
                state.libraryItems = [];
                state.libraryError = (d && d.error) || 'לא הצלחתי לקרוא את הספרייה';
                return;
            }
            state.libraryItems = _normalizeItems(d);
        });
    }

    function refreshLibrary() {
        return _loadFoldersAndTags().then(_loadLibrary).then(_render);
    }

    function open() {
        if (!state.dragon) {
            _syncGate();
            if (!state.dragon) return;
        }
        state.open = true;
        _injectStyle();
        _ensureRoot();
        _render();
        refreshLibrary();
    }

    function close() {
        state.open = false;
        _saveDraft();
        _render();
    }

    function init() {
        if (state.initialized) return;
        state.initialized = true;
        _injectStyle();
        _loadDraft();
        _ensureRoot();
        _syncGate();
        document.addEventListener('plonter:rolechange', _syncGate);
        document.addEventListener('plonter:authchange', function () {
            _syncGate();
            if (state.open) refreshLibrary();
        });
        setTimeout(_syncGate, 700);
        setTimeout(_syncGate, 1600);
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else setTimeout(init, 0);
    }

    return {
        init: init,
        open: open,
        close: close,
        refreshLibrary: refreshLibrary,
        toWorksheetPayload: toWorksheetPayload,
        _state: state
    };
})();
