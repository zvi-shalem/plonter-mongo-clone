/**
 * ContentManager — Plonter content management tab
 * Renders inside #content-manager-container when 'content' tab is active.
 * Uses content_api.php for server storage, localStorage for guests.
 */

var ContentManager = (function() {
    'use strict';

    var API = '/plonter/api/content_api.php';
    var LOCAL_KEY = 'plonter_my_content_local';
    var TYPE_LABELS = { analysis: 'תחביר', text: 'טקסט', vocabulary: 'אוצר מילים', lesson: 'שיעור', engineering: 'הינדוס' };

    var _container = null;
    var _allItems = [];
    var _editingId = null;
    var _typeFilter = '';
    var _initialized = false;

    function _getToken() {
        return localStorage.getItem('plonter_auth_token') || '';
    }

    function _isLoggedIn() {
        return !!_getToken() && typeof PlonterAuth !== 'undefined' && PlonterAuth.getCurrentUser();
    }

    function _getUserName() {
        if (typeof PlonterAuth !== 'undefined') {
            var u = PlonterAuth.getCurrentUser();
            if (u && u.name) return u.name;
        }
        return '';
    }

    function _typeLabel(t) { return TYPE_LABELS[t] || t; }
    function _escapeHtml(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
    function _formatDate(d) { return d ? d.replace('T', ' ').substring(0, 16) : ''; }

    // Local storage
    function _getLocalItems() {
        try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch(e) { return []; }
    }
    function _setLocalItems(items) { localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); }
    function _addLocalItem(item) { var items = _getLocalItems(); items.unshift(item); _setLocalItems(items); }
    function _removeLocalItem(id) { _setLocalItems(_getLocalItems().filter(function(x) { return x.id !== id; })); }

    // API
    async function _api(action, body) {
        var opts = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        var token = _getToken();
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        if (body) opts.body = JSON.stringify(body);
        try {
            var res = await fetch(API + '?action=' + action, opts);
            return await res.json();
        } catch(e) {
            return { success: false, error: 'שגיאת תקשורת' };
        }
    }

    // Toast
    function _showToast(msg) {
        if (typeof Messages !== 'undefined' && Messages.show) {
            Messages.show(msg, 'info');
        } else {
            // Fallback toast
            var existing = document.getElementById('cm-toast');
            if (existing) existing.remove();
            var t = document.createElement('div');
            t.id = 'cm-toast';
            t.textContent = msg;
            t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a202c;color:white;padding:12px 24px;border-radius:10px;font-size:14px;z-index:2000;white-space:nowrap;transition:opacity 0.3s';
            document.body.appendChild(t);
            setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, 3000);
        }
    }

    // --- Render ---

    function _render() {
        if (!_container) return;

        var loggedIn = _isLoggedIn();
        var name = _getUserName();

        var html = '';

        // Guest banner
        if (!loggedIn) {
            html += '<div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:10px 16px;border-radius:10px;margin-bottom:12px;font-size:14px;text-align:center">';
            html += 'מצב אורח 👤 · הפריטים שתיצור יישמרו רק בדפדפן הזה.';
            html += '</div>';
        } else {
            html += '<div style="color:#0d9488;font-weight:600;margin-bottom:8px;font-size:14px">שלום ' + _escapeHtml(name) + ', התוכן שלך:</div>';
        }

        // Toolbar
        html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
        html += '<button class="btn btn-primary" style="padding:8px 16px;font-size:0.95em" onclick="ContentManager.openCreate()">+ חדש</button>';
        html += '</div>';

        // Type filters
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">';
        var types = [['', 'הכל'], ['analysis', 'תחביר'], ['text', 'טקסט'], ['vocabulary', 'אוצר מילים'], ['lesson', 'שיעור'], ['engineering', 'הינדוס']];
        types.forEach(function(t) {
            var active = _typeFilter === t[0];
            html += '<span style="padding:4px 12px;border-radius:16px;border:2px solid ' + (active ? '#0d9488' : '#e2e8f0') + ';background:' + (active ? '#0d9488' : 'white') + ';color:' + (active ? 'white' : '#475569') + ';cursor:pointer;font-size:12px;font-weight:500" onclick="ContentManager.filter(\'' + t[0] + '\')">' + t[1] + '</span>';
        });
        html += '</div>';

        // Items grid
        if (!_allItems.length) {
            html += '<div style="text-align:center;padding:40px;color:#94a3b8"><div style="font-size:36px;margin-bottom:8px">+</div><p>אין תוכן עדיין.</p></div>';
        } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">';
            _allItems.forEach(function(item) {
                var data = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
                var preview = data.text || JSON.stringify(data).substring(0, 60);
                var local = !!item.is_local;
                var idArg = local ? "'" + item.id + "'" : item.id;
                var badge = local ? '<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;border:1px dashed #f59e0b">מקומי 💾</span>' : '<span style="padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7">שרת ☁️</span>';

                html += '<div style="background:' + (local ? '#fffbeb' : 'white') + ';border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);cursor:pointer;border:' + (local ? '1px dashed #f59e0b' : '1px solid #e2e8f0') + '" onclick="ContentManager.openEdit(' + idArg + ')">';
                html += '<div style="height:4px;background:' + (item.color || '#0d9488') + '"></div>';
                html += '<div style="padding:10px 12px">';
                html += '<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px"><span class="card-type ' + item.content_type + '" style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">' + _typeLabel(item.content_type) + '</span>' + badge + '</div>';
                html += '<div style="font-weight:600;font-size:14px;margin-bottom:2px">' + _escapeHtml(item.title) + '</div>';
                html += '<div style="font-size:12px;color:#94a3b8;max-height:28px;overflow:hidden">' + _escapeHtml(preview) + '</div>';
                if (local && loggedIn) {
                    html += '<button class="btn btn-primary" style="margin-top:6px;padding:3px 8px;font-size:11px" onclick="event.stopPropagation();ContentManager.uploadLocal(\'' + item.id + '\')">העלה לשרת ⬆️</button>';
                }
                html += '</div>';
                html += '<div style="padding:4px 12px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8">' + _formatDate(item.updated || item.created) + '</div>';
                html += '</div>';
            });
            html += '</div>';
        }

        _container.innerHTML = html;
    }

    // --- Data loading ---

    async function _loadContent() {
        var localItems = _getLocalItems();
        if (_typeFilter) localItems = localItems.filter(function(x) { return x.content_type === _typeFilter; });

        if (_isLoggedIn()) {
            var body = {};
            if (_typeFilter) body.content_type = _typeFilter;
            var data = await _api('list', body);
            if (data.success) {
                _allItems = localItems.concat(data.items);
            } else {
                _allItems = localItems;
            }
        } else {
            _allItems = localItems;
        }
        _render();
    }

    // --- Create/Edit modal ---

    function _openModal(item) {
        _editingId = item ? item.id : null;
        var data = item ? (typeof item.data === 'string' ? JSON.parse(item.data) : item.data) : {};

        var overlay = document.getElementById('cm-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'cm-modal-overlay';
            overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);z-index:10000;align-items:center;justify-content:center';
            document.body.appendChild(overlay);
        }

        overlay.innerHTML =
            '<div style="background:white;border-radius:16px;width:90%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">' +
                '<div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">' +
                    '<h2 style="font-size:18px;margin:0">' + (item ? 'עריכת פריט' : 'פריט חדש') + '</h2>' +
                    '<button style="background:none;border:none;font-size:24px;cursor:pointer;color:#94a3b8" onclick="ContentManager.closeModal()">×</button>' +
                '</div>' +
                '<div style="padding:20px">' +
                    '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px">סוג</label><select id="cm-type" style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:15px"' + (item ? ' disabled' : '') + '>' +
                        '<option value="analysis">תחביר</option><option value="text">טקסט</option><option value="vocabulary">אוצר מילים</option><option value="lesson">שיעור</option><option value="engineering">הינדוס</option>' +
                    '</select></div>' +
                    '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px">כותרת</label><input id="cm-title" style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:15px" placeholder="כותרת..." value="' + _escapeHtml(item ? item.title : '') + '"></div>' +
                    '<div style="margin-bottom:16px"><label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px">תוכן</label><textarea id="cm-text" style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:15px;min-height:100px;resize:vertical" placeholder="תוכן...">' + _escapeHtml(data.text || '') + '</textarea></div>' +
                '</div>' +
                '<div style="padding:16px 20px;border-top:1px solid #e2e8f0;display:flex;gap:10px">' +
                    '<button class="btn btn-primary" style="padding:10px 18px;font-size:14px;font-weight:600" onclick="ContentManager.save()">שמירה</button>' +
                    '<button class="btn btn-secondary" style="padding:10px 18px;font-size:14px" onclick="ContentManager.closeModal()">ביטול</button>' +
                    (item ? '<button style="margin-right:auto;padding:6px 12px;font-size:12px;background:#fee2e2;color:#dc2626;border:none;border-radius:10px;cursor:pointer" onclick="ContentManager.deleteItem()">מחיקה</button>' : '') +
                '</div>' +
            '</div>';

        overlay.style.display = 'flex';
        if (item) document.getElementById('cm-type').value = item.content_type;
        else if (_typeFilter) document.getElementById('cm-type').value = _typeFilter;
    }

    // --- Public API ---

    // Patch switchWelcomeTab to handle 'content' tab
    function _patchSwitchTab() {
        if (typeof switchWelcomeTab === 'undefined') return;
        var _origSwitch = switchWelcomeTab;
        window.switchWelcomeTab = function(mode) {
            // Let original handle known tabs
            _origSwitch(mode);
            // Handle content tab
            var tabEl = document.getElementById('tab-content');
            var sectionEl = document.querySelector('.content-section-welcome');
            if (tabEl) {
                if (mode === 'content') {
                    tabEl.style.background = '#0d9488';
                    tabEl.style.borderColor = '#0d9488';
                    tabEl.style.color = 'white';
                    if (sectionEl) sectionEl.style.display = '';
                    ContentManager.init();
                } else {
                    tabEl.style.background = 'white';
                    tabEl.style.borderColor = '#0d9488';
                    tabEl.style.color = '#0d9488';
                    if (sectionEl) sectionEl.style.display = 'none';
                }
            }
        };
    }

    // Auto-patch when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(_patchSwitchTab, 100); });
    } else {
        setTimeout(_patchSwitchTab, 100);
    }

    return {
        init: function() {
            _container = document.getElementById('content-manager-container');
            if (!_container) return;
            if (_initialized) { _loadContent(); return; }
            _initialized = true;
            _loadContent();
        },

        filter: function(type) {
            _typeFilter = type;
            _loadContent();
        },

        openCreate: function() { _openModal(null); },

        openEdit: function(id) {
            var item;
            if (typeof id === 'string' && id.indexOf('local_') === 0) {
                item = _getLocalItems().find(function(x) { return x.id === id; });
            } else {
                item = _allItems.find(function(x) { return x.id == id; });
            }
            if (item) _openModal(item);
        },

        closeModal: function() {
            var overlay = document.getElementById('cm-modal-overlay');
            if (overlay) overlay.style.display = 'none';
        },

        save: async function() {
            var title = document.getElementById('cm-title').value.trim();
            var text = document.getElementById('cm-text').value.trim();
            var type = document.getElementById('cm-type').value;
            if (!title) { _showToast('נדרשת כותרת'); return; }

            // Local item edit
            if (_editingId && typeof _editingId === 'string' && _editingId.indexOf('local_') === 0) {
                var items = _getLocalItems();
                for (var i = 0; i < items.length; i++) {
                    if (items[i].id === _editingId) {
                        items[i].title = title; items[i].data = { text: text };
                        items[i].updated = new Date().toISOString().replace('T', ' ').substring(0, 16);
                        break;
                    }
                }
                _setLocalItems(items);
                _showToast('עודכן מקומית 💾');
                ContentManager.closeModal(); _loadContent(); return;
            }

            if (!_isLoggedIn()) {
                var now = new Date().toISOString().replace('T', ' ').substring(0, 16);
                _addLocalItem({ id: 'local_' + Date.now(), content_type: type, title: title, data: { text: text }, color: '#0d9488', created: now, updated: now, is_local: true });
                _showToast('נשמר מקומית 💾');
                ContentManager.closeModal(); _loadContent(); return;
            }

            if (_editingId) {
                var data = await _api('update', { id: _editingId, title: title, data: { text: text } });
                _showToast(data.success ? 'עודכן בשרת ✓' : 'שגיאה: ' + (data.error || ''));
            } else {
                var data = await _api('create', { content_type: type, title: title, data: { text: text } });
                _showToast(data.success ? 'נשמר בשרת ✓' : 'שגיאה: ' + (data.error || ''));
            }
            ContentManager.closeModal(); _loadContent();
        },

        deleteItem: async function() {
            if (!_editingId) return;
            if (!confirm('למחוק את הפריט?')) return;
            if (typeof _editingId === 'string' && _editingId.indexOf('local_') === 0) {
                _removeLocalItem(_editingId);
                _showToast('נמחק');
            } else {
                var data = await _api('delete', { id: _editingId });
                _showToast(data.success ? 'נמחק' : 'שגיאה');
            }
            ContentManager.closeModal(); _loadContent();
        },

        uploadLocal: async function(localId) {
            var item = _getLocalItems().find(function(x) { return x.id === localId; });
            if (!item) return;
            var data = await _api('create', { content_type: item.content_type, title: item.title, data: item.data || {}, color: item.color || '#0d9488' });
            if (data.success) {
                _removeLocalItem(localId);
                _showToast('הועלה לשרת ✓');
                _loadContent();
            }
        }
    };
})();
