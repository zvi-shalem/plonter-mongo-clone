// MABA dictionary — Dragon-only local store for "מושגים באסלאם".
var MabaDictionary = (function() {
    'use strict';

    var STORAGE_KEY = 'plonter_maba_entries_v1';
    var SEED_OMAR_ID = 'seed_omar_haram_mount_view_v1';
    var SEED_OMAR_ENTRY = {
        id: SEED_OMAR_ID,
        title: 'מה עמר אלח׳טאב, כובש ירושליים, חשב על רחבת הר הבית כשכבש אותה?',
        tags: 'אלאקצא, עמר אל-ח׳טאב, ירושליים, המאה השביעית',
        content: '״לא, כי נקבע את כיוון התפילה (קבלה) שלו בתוך חוויית הכבוד שלו, כפי שעשה הנביא מוחמד [...] לך לך, לא ציוונו ביחס לאבן השתייה, אלא ציוונו לגבי הכעבה.״',
        createdAt: '2026-05-20T21:06:42+03:00',
        updatedAt: '2026-05-20T21:06:42+03:00',
        seed: true
    };
    var _panel = null;
    var _editingId = null;

    function init() {
        installButton();
        updateVisibility();
        document.addEventListener('plonter:rolechange', updateVisibility);
        document.addEventListener('plonter:authchange', function() {
            setTimeout(updateVisibility, 700);
            setTimeout(updateVisibility, 1500);
        });
    }

    function isDragon() {
        return !!(typeof PlonterAdmin !== 'undefined' && PlonterAdmin.isDragon && PlonterAdmin.isDragon());
    }

    function isLoginScreenVisible() {
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
    }

    function ensurePulseStyle() {
        ensurePulseHelper();
        if (document.getElementById('dict-pulse-style')) return;
        var style = document.createElement('style');
        style.id = 'dict-pulse-style';
        style.textContent = '@keyframes dict-pulse{0%,100%{transform:translateY(-50%) scale(1)}50%{transform:translateY(-50%) scale(1.15)}}';
        document.head.appendChild(style);
    }

    // Shared global pulse driver (see tasksPanel.js for the canonical copy) — anchors every
    // floating button to startTime=0 so they all pulse in sync. Defined by whichever module
    // loads first; this guarded copy makes the module self-sufficient if it loads alone.
    function ensurePulseHelper() {
        if (window.PlonterPulse) return;
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

    function installButton() {
        if (document.getElementById('maba-toggle-btn')) return;
        ensurePulseStyle();
        var btn = document.createElement('button');
        btn.id = 'maba-toggle-btn';
        btn.innerHTML = '☪';
        btn.title = 'מב"א — מושגים באסלאם';
        btn.style.cssText = 'position:fixed;left:calc(2px + env(safe-area-inset-left, 0px));top:calc(50% + 56px);transform:translateY(-50%);width:36px;height:48px;border:none;border-radius:0 8px 8px 0;background:#047857;color:white;font-size:1.35em;cursor:pointer;z-index:10002;box-shadow:2px 0 8px rgba(4,120,87,0.3);transition:left 0.3s ease;display:none';
        btn.onclick = togglePanel;
        document.body.appendChild(btn);
        window.PlonterPulse.start(btn);
    }

    function updateVisibility() {
        var dragon = isDragon() && !isLoginScreenVisible();
        var btn = document.getElementById('maba-toggle-btn');
        if (btn) btn.style.display = dragon ? '' : 'none';
        if (!dragon) hidePanel();
    }

    function togglePanel() {
        if (!isDragon()) return;
        var panel = getOrCreatePanel();
        if (panel.classList.contains('show')) {
            hidePanel();
            return;
        }
        if (typeof Dictionary !== 'undefined' && Dictionary._hidePanel) Dictionary._hidePanel();
        panel.classList.add('show');
        updateButtonState(true);
        render();
        var search = panel.querySelector('#maba-search');
        if (search) setTimeout(function() { search.focus(); }, 80);
    }

    function hidePanel() {
        if (_panel) _panel.classList.remove('show');
        updateButtonState(false);
    }

    function updateButtonState(open) {
        var btn = document.getElementById('maba-toggle-btn');
        if (!btn) return;
        btn.innerHTML = open ? '✕' : '☪';
        btn.style.background = open ? '#ef4444' : '#047857';
        btn.style.boxShadow = open ? '2px 0 8px rgba(239,68,68,0.3)' : '2px 0 8px rgba(4,120,87,0.3)';
        btn.style.left = open ? 'calc(380px + env(safe-area-inset-left, 0px))' : 'calc(2px + env(safe-area-inset-left, 0px))';
        if (open) window.PlonterPulse.stop(btn); else window.PlonterPulse.start(btn);
    }

    function getOrCreatePanel() {
        if (_panel) return _panel;
        var panel = document.createElement('div');
        panel.id = 'maba-panel';
        panel.className = 'maba-panel';
        panel.innerHTML =
            '<div class="maba-panel-header">' +
                '<button type="button" id="maba-close" class="maba-close" title="סגור">✕</button>' +
                '<div>' +
                    '<div class="maba-title">מב"א</div>' +
                    '<div class="maba-subtitle">מושגים באסלאם</div>' +
                '</div>' +
            '</div>' +
            '<div class="maba-body">' +
                '<input id="maba-search" class="maba-search" type="search" placeholder="חיפוש מושג / חומר" autocomplete="off">' +
                '<div class="maba-form">' +
                    '<input id="maba-title-input" class="maba-input" type="text" placeholder="כותרת / מושג">' +
                    '<input id="maba-tags-input" class="maba-input" type="text" placeholder="תגיות, מקור, עמוד">' +
                    '<textarea id="maba-content-input" class="maba-textarea" placeholder="הדבק כאן חומר, ציטוט, סיכום או הערה"></textarea>' +
                    '<div class="maba-actions">' +
                        '<button type="button" id="maba-save" class="maba-save">שמור</button>' +
                        '<button type="button" id="maba-clear" class="maba-clear">נקה</button>' +
                    '</div>' +
                '</div>' +
                '<div id="maba-status" class="maba-status"></div>' +
                '<div id="maba-list" class="maba-list"></div>' +
            '</div>';
        document.body.appendChild(panel);
        _panel = panel;

        panel.querySelector('#maba-close').onclick = hidePanel;
        panel.querySelector('#maba-search').addEventListener('input', renderList);
        panel.querySelector('#maba-save').onclick = saveCurrent;
        panel.querySelector('#maba-clear').onclick = clearForm;
        return panel;
    }

    function loadEntries() {
        try {
            var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (!Array.isArray(data)) data = [];
            return ensureSeedEntry(data);
        } catch (ex) {
            return ensureSeedEntry([]);
        }
    }

    function ensureSeedEntry(entries) {
        var hasSeed = entries.some(function(entry) { return entry && entry.id === SEED_OMAR_ID; });
        if (hasSeed) return entries;
        var seeded = [SEED_OMAR_ENTRY].concat(entries);
        saveEntries(seeded);
        return seeded;
    }

    function saveEntries(entries) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }

    function saveCurrent() {
        if (!isDragon()) return;
        var title = val('#maba-title-input').trim();
        var tags = val('#maba-tags-input').trim();
        var content = val('#maba-content-input').trim();
        if (!title && !content) {
            setStatus('צריך כותרת או תוכן כדי לשמור');
            return;
        }
        var entries = loadEntries();
        var now = new Date().toISOString();
        if (_editingId) {
            entries = entries.map(function(entry) {
                if (entry.id !== _editingId) return entry;
                return {
                    id: entry.id,
                    title: title || entry.title || 'ללא כותרת',
                    tags: tags,
                    content: content,
                    createdAt: entry.createdAt || now,
                    updatedAt: now
                };
            });
            setStatus('עודכן');
        } else {
            entries.unshift({
                id: 'maba_' + Date.now(),
                title: title || 'ללא כותרת',
                tags: tags,
                content: content,
                createdAt: now,
                updatedAt: now
            });
            setStatus('נשמר במב"א');
        }
        saveEntries(entries);
        clearForm(false);
        renderList();
    }

    function clearForm(clearStatus) {
        _editingId = null;
        setVal('#maba-title-input', '');
        setVal('#maba-tags-input', '');
        setVal('#maba-content-input', '');
        var saveBtn = _panel && _panel.querySelector('#maba-save');
        if (saveBtn) saveBtn.textContent = 'שמור';
        if (clearStatus !== false) setStatus('');
    }

    function render() {
        if (!_panel) return;
        renderList();
    }

    function renderList() {
        if (!_panel) return;
        var list = _panel.querySelector('#maba-list');
        var q = val('#maba-search').trim().toLowerCase();
        var entries = loadEntries();
        var filtered = entries.filter(function(entry) {
            if (!q) return true;
            return [entry.title, entry.tags, entry.content].join(' ').toLowerCase().indexOf(q) !== -1;
        });
        if (!entries.length) {
            list.innerHTML = '<div class="maba-empty">אין עדיין חומרים במב"א</div>';
            return;
        }
        if (!filtered.length) {
            list.innerHTML = '<div class="maba-empty">לא נמצאו חומרים מתאימים</div>';
            return;
        }
        list.innerHTML = filtered.map(renderEntry).join('');
        list.querySelectorAll('[data-maba-edit]').forEach(function(btn) {
            btn.onclick = function() { editEntry(btn.getAttribute('data-maba-edit')); };
        });
        list.querySelectorAll('[data-maba-delete]').forEach(function(btn) {
            btn.onclick = function() { deleteEntry(btn.getAttribute('data-maba-delete')); };
        });
    }

    function renderEntry(entry) {
        return '<article class="maba-entry">' +
            '<div class="maba-entry-title">' + esc(entry.title || 'ללא כותרת') + '</div>' +
            (entry.tags ? '<div class="maba-entry-tags">' + esc(entry.tags) + '</div>' : '') +
            (entry.content ? '<div class="maba-entry-content">' + esc(entry.content) + '</div>' : '') +
            '<div class="maba-entry-actions">' +
                '<button type="button" data-maba-edit="' + escAttr(entry.id) + '">ערוך</button>' +
                '<button type="button" data-maba-delete="' + escAttr(entry.id) + '">מחק</button>' +
            '</div>' +
        '</article>';
    }

    function editEntry(id) {
        var entry = loadEntries().find(function(item) { return item.id === id; });
        if (!entry) return;
        _editingId = id;
        setVal('#maba-title-input', entry.title || '');
        setVal('#maba-tags-input', entry.tags || '');
        setVal('#maba-content-input', entry.content || '');
        var saveBtn = _panel.querySelector('#maba-save');
        if (saveBtn) saveBtn.textContent = 'עדכן';
        setStatus('מצב עריכה');
    }

    function deleteEntry(id) {
        if (!confirm('למחוק את החומר ממב"א?')) return;
        saveEntries(loadEntries().filter(function(entry) { return entry.id !== id; }));
        if (_editingId === id) clearForm(false);
        setStatus('נמחק');
        renderList();
    }

    function val(selector) {
        var el = _panel && _panel.querySelector(selector);
        return el ? el.value || '' : '';
    }

    function setVal(selector, value) {
        var el = _panel && _panel.querySelector(selector);
        if (el) el.value = value;
    }

    function setStatus(text) {
        var el = _panel && _panel.querySelector('#maba-status');
        if (el) el.textContent = text || '';
    }

    function esc(text) {
        return String(text || '').replace(/[&<>"']/g, function(ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    function escAttr(text) {
        return esc(text).replace(/`/g, '&#96;');
    }

    return {
        init: init,
        _isDragon: isDragon,
        _updateVisibility: updateVisibility,
        _loadEntries: loadEntries,
        _hidePanel: hidePanel
    };
})();

document.addEventListener('DOMContentLoaded', function() { MabaDictionary.init(); });
