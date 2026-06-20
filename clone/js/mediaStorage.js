// Media Storage module — folder-based media management for Plonter
// Depends on: PlonterAuth (auth.js) for API calls

var MediaStorage = (function() {
    'use strict';

    var API_URL = '/plonter/api/media_api.php';
    var BASE_URL = ''; // relative
    var folders = [];
    var currentFolder = null; // null = root
    var folderPath = []; // breadcrumb stack
    var selectedMedia = []; // media items selected for use in dictionary/lessons
    var isOpen = false;
    var uploadInProgress = false;
    var UPLOAD_BUSY_MESSAGE = 'היי, אנחנו בדיוק מעלים מדיה לאתר, מחיקה/ריענון של התיקייה עלול לפגוע בתהליך..';
    var _MEDIA_PAGE_SIZE = 50; // items per page for list_media pagination

    // Feature: in-flight upload indicator
    var _mwActiveUploads = [];
    var _mwUploadIdSeq = 0;

    // Feature: default title by type (cache of current folder's items)
    var _currentFolderItems = [];

    // System folder names (created on first use)
    var SYSTEM_FOLDERS = ['יוטיוב', 'קטעי שמע', 'תמונות', 'שיעורים', 'טוטוריאל'];
    var TUTORIAL_FOLDER = 'טוטוריאל';

    // Tutorial videos (read-only)
    var TUTORIALS = [
        { title: 'שיעורים — מצגות', url: 'https://youtu.be/x7aKUyfGXoA', media_type: 'video' },
        { title: 'ניתוח תחבירי', url: 'https://youtu.be/PkevhytZFXk', media_type: 'video' },
        { title: 'הינדוס', url: 'https://www.youtube.com/watch?v=sdP-QG4UzU4', media_type: 'video' },
        { title: 'טקסטים', url: 'https://youtu.be/v2GUoedqWvE', media_type: 'video' }
    ];

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', function(e) {
            if (!uploadInProgress) return;
            e.preventDefault();
            e.returnValue = UPLOAD_BUSY_MESSAGE;
            return UPLOAD_BUSY_MESSAGE;
        });
    }

    function guardUploadInProgress() {
        if (!uploadInProgress) return false;
        return !confirm(UPLOAD_BUSY_MESSAGE);
    }

    // ---- API helpers ----

    function apiCall(action, data) {
        var token = (typeof PlonterAuth !== 'undefined' && PlonterAuth) ? PlonterAuth.getToken() : null;
        if (!token) token = localStorage.getItem('plonter_auth_token') || localStorage.getItem('auth_otp_token_plonter');
        if (!token) {
            return Promise.reject(new Error('Not authenticated'));
        }
        var body = Object.assign({ action: action }, data || {});
        return fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(body)
        }).then(function(r) {
            var status = r.status;
            return r.text().then(function(t) {
                var d; try { d = JSON.parse(t); } catch (e) { d = {}; }
                // Server rejected our token (e.g. guest fallback removed) — prompt re-login
                // instead of surfacing a raw error. Coordinated with @100 (media_api.php).
                if (status === 401 || d.auth_required) {
                    _handleAuthRequired(d.error);
                    throw _authError(d.error);
                }
                if (d.error) throw new Error(d.error);
                return d;
            });
        });
    }

    // Build a tagged auth error so downstream .catch handlers can skip painting a
    // 'שגיאה: נדרשת התחברות' message — _handleAuthRequired already shows the login flow.
    function _authError(msg) {
        var e = new Error(msg || 'נדרשת התחברות למחסן המדיה');
        e.authRequired = true;
        return e;
    }

    function uploadFile(file, title, folderId, mediaType) {
        var token = (typeof PlonterAuth !== 'undefined' && PlonterAuth) ? PlonterAuth.getToken() : null;
        if (!token) token = localStorage.getItem('plonter_auth_token') || localStorage.getItem('auth_otp_token_plonter');
        if (!token) return Promise.reject(new Error('Not authenticated'));
        var fd = new FormData();
        fd.append('file', file);
        fd.append('title', title);
        fd.append('folder_id', folderId);
        fd.append('media_type', mediaType);
        return fetch(API_URL, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: fd
        }).then(function(r) {
            return r.text().then(function(t) {
                var d;
                try { d = JSON.parse(t); }
                catch (e) {
                    // Server returned non-JSON / empty body — usually an oversize
                    // file dropped by PHP (post_max_size) or a server error page.
                    if (r.status === 401) { _handleAuthRequired(); throw _authError(); }
                    if (r.status === 413 || /large|גדול/i.test(t || '')) {
                        throw new Error('הקובץ גדול מדי — נא להעלות קובץ עד 64MB');
                    }
                    throw new Error('שגיאת שרת בהעלאה (' + r.status + ') — ייתכן שהקובץ גדול מדי');
                }
                if (r.status === 401 || d.auth_required) {
                    _handleAuthRequired(d.error);
                    throw _authError(d.error);
                }
                if (d.error) throw new Error(d.error);
                return d;
            });
        });
    }

    // ---- Data operations ----

    function loadFolders() {
        return apiCall('list_folders').then(function(data) {
            folders = normalizeFolders(data.folders || []);
            return folders;
        });
    }

    function normalizeFolders(rawFolders) {
        var seenRootSystemNames = {};
        return rawFolders.slice().sort(function(a, b) {
            var aSystem = parseInt(a.is_system || 0) || (SYSTEM_FOLDERS.indexOf(a.name) !== -1 ? 1 : 0);
            var bSystem = parseInt(b.is_system || 0) || (SYSTEM_FOLDERS.indexOf(b.name) !== -1 ? 1 : 0);
            if (aSystem !== bSystem) return bSystem - aSystem;
            return (parseInt(a.id) || 0) - (parseInt(b.id) || 0);
        }).filter(function(folder) {
            var isRoot = !folder.parent_id || folder.parent_id === '0' || folder.parent_id === 0;
            var isSystemName = SYSTEM_FOLDERS.indexOf(folder.name) !== -1;
            if (!isRoot || !isSystemName) return true;
            if (seenRootSystemNames[folder.name]) return false;
            seenRootSystemNames[folder.name] = true;
            return true;
        });
    }

    function ensureSystemFolders() {
        return loadFolders().then(function(existingFolders) {
            var existingNames = existingFolders.map(function(f) { return f.name; });
            var missing = SYSTEM_FOLDERS.filter(function(n) { return existingNames.indexOf(n) === -1; });
            if (missing.length === 0) return Promise.resolve();
            // Create missing system folders sequentially
            var chain = Promise.resolve();
            missing.forEach(function(name) {
                chain = chain.then(function() {
                    return apiCall('create_folder', { name: name }).then(function(result) {
                        // Mark as system folder manually via SQL — for now just create
                        return result;
                    });
                });
            });
            return chain.then(function() { return loadFolders(); });
        });
    }

    function getChildFolders(parentId) {
        return folders.filter(function(f) {
            if (parentId === null) return !f.parent_id || f.parent_id === '0' || f.parent_id === 0;
            return parseInt(f.parent_id) === parentId;
        });
    }

    function getFolderById(id) {
        return folders.find(function(f) { return parseInt(f.id) === id; });
    }

    // Total items in a folder INCLUDING all descendant subfolders. Parent folders
    // like "שיעורים" hold their items inside per-lesson subfolders, so their own
    // media_count is 0 — the grid must show the recursive total, not just direct
    // items (Amitai 2026-06-17: "שיעורים writes 0"). Degrades to the direct count
    // when the folder has no children.
    function _folderRecursiveCount(folderId) {
        var folder = getFolderById(parseInt(folderId));
        var count = folder ? (parseInt(folder.media_count) || 0) : 0;
        getChildFolders(parseInt(folderId)).forEach(function(c) {
            count += _folderRecursiveCount(c.id);
        });
        return count;
    }

    // ---- YouTube helpers ----

    function extractYouTubeId(url) {
        var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    function isYouTubeUrl(url) {
        return /youtu\.?be/.test(url);
    }

    // ---- UX helpers (sound, confetti, default names, upload indicator) ----

    function _ensureMwAnimStyle() {
        if (!document.getElementById('mw-anim-style')) {
            var st = document.createElement('style');
            st.id = 'mw-anim-style';
            st.textContent = '@keyframes mw-spin{to{transform:rotate(360deg)}}' +
                '@keyframes mw-pop{0%{transform:scale(.6);opacity:0}50%{transform:scale(1.18)}100%{transform:scale(1);opacity:1}}' +
                '@keyframes mw-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06);box-shadow:0 4px 14px rgba(13,148,136,.4)}}';
            document.head.appendChild(st);
        }
    }

    function _mwPlaySuccessSound() {
        if (typeof SoundManager !== 'undefined' && SoundManager && SoundManager.playSuccess) {
            try { SoundManager.playSuccess(); } catch (e) {}
        } else {
            try {
                var ctx = new (window.AudioContext || window.webkitAudioContext)();
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = 'sine'; osc.frequency.value = 880;
                gain.gain.setValueAtTime(0.18, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
                osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
            } catch (e) {}
        }
    }

    function _mwConfettiBurst(anchor) {
        try {
            _ensureMwAnimStyle();
            var emojis = ['🎉', '✨', '🎊', '⭐', '🎈'];
            var rect = anchor ? anchor.getBoundingClientRect() : {left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0};
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

    function _getMwDefaultTitle(type) {
        var prefix = type === 'image' ? 'תמונה' : type === 'video' ? 'סרטון' : 'שמע';
        var max = 0;
        _currentFolderItems.forEach(function(item) {
            var m = (item.title || '').match(new RegExp('^' + prefix + '_(\\d+)$'));
            if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
        });
        return prefix + '_' + (max + 1);
    }

    function _renderMwActiveUploads() {
        var container = document.getElementById('mw-active-uploads');
        if (!container) return;
        if (!_mwActiveUploads.length) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';
        var html = '';
        _mwActiveUploads.forEach(function(u) {
            if (u.done) {
                html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.88em;color:#16a34a;font-weight:bold">' +
                    '<span>✓</span><span>' + escapeHtml(u.title) + ' עלה</span></div>';
            } else {
                html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.88em;color:#0d9488">' +
                    '<span style="display:inline-block;animation:mw-spin 0.7s linear infinite">⏳</span>' +
                    '<span>מעלה את ' + escapeHtml(u.title) + '</span></div>';
            }
        });
        container.innerHTML = html;
    }

    // ---- Rendering ----

    function renderMediaTab() {
        var container = document.getElementById('media-section-welcome');
        if (!container) { console.error('[MediaStorage] media-section-welcome not found'); return; }

        container.innerHTML = '<div id="media-storage-root" style="padding:8px"></div>';
        var root = document.getElementById('media-storage-root');

        var mediaToken = (typeof PlonterAuth !== 'undefined' && PlonterAuth && PlonterAuth.getToken()) || localStorage.getItem('plonter_auth_token') || localStorage.getItem('auth_otp_token_plonter');
        console.log('[MediaStorage] renderMediaTab called, token:', mediaToken ? 'yes' : 'no');
        if (!mediaToken) {
            root.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280">' +
                '<p style="margin-bottom:16px">יש להתחבר כדי לגשת למחסן המדיה</p>' +
                '<button onclick="if(typeof PlonterAuth!==\'undefined\')PlonterAuth.showLoginDialog()" style="padding:10px 24px;border-radius:8px;background:#0891b2;color:white;border:none;cursor:pointer;font-weight:bold;font-size:1em">התחברות</button>' +
                '</div>';
            return;
        }

        root.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280">טוען מחסן מדיה...</div>';

        ensureSystemFolders().then(function() {
            console.log('[MediaStorage] ensureSystemFolders OK, folders:', folders.length);
            renderFolderView(root);
        }).catch(function(err) {
            console.error('[MediaStorage] ensureSystemFolders error:', err);
            // Auth errors are already handled by _handleAuthRequired (login flow) —
            // don't paint a confusing 'שגיאה: נדרשת התחברות' behind the login modal.
            if (err && err.authRequired) return;
            root.innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444">שגיאה: ' + err.message + '</div>';
        });
    }

    function renderFolderView(root) {
        var parentId = currentFolder;
        var childFolders = getChildFolders(parentId);

        var html = '';

        // Breadcrumb
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap">';
        html += '<span class="media-breadcrumb" onclick="MediaStorage.navigateTo(null)" style="cursor:pointer;color:#0891b2;font-weight:bold">🏠 מחסן מדיה</span>';
        folderPath.forEach(function(fp) {
            html += '<span style="color:#9ca3af">›</span>';
            html += '<span class="media-breadcrumb" onclick="MediaStorage.navigateTo(' + fp.id + ')" style="cursor:pointer;color:#0891b2">' + fp.name + '</span>';
        });
        html += '</div>';

        // Action buttons
        var currentFolderObj = currentFolder ? getFolderById(currentFolder) : null;
        var isTutorialFolder = currentFolderObj && currentFolderObj.name === TUTORIAL_FOLDER;
        html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
        if (!isTutorialFolder) {
            html += '<button onclick="MediaStorage.showAddLinkDialog()" style="padding:6px 12px;border-radius:8px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.9em">🔗 הוסף קישור</button>';
            html += '<button onclick="MediaStorage.showUploadDialog()" style="padding:6px 12px;border-radius:8px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.9em">📁 העלה מהמחשב</button>';
            html += '<button onclick="MediaStorage.showShortcutDialog()" style="padding:6px 12px;border-radius:8px;border:1px solid #6366f1;background:white;color:#6366f1;cursor:pointer;font-size:0.9em">📌 הוסף קיצור דרך</button>';
        }

        // Don't show "new folder" inside tutorial folder
        if (!isTutorialFolder) {
            html += '<button onclick="MediaStorage.showNewFolderDialog()" style="padding:6px 12px;border-radius:8px;border:1px solid #d1d5db;background:white;color:#374151;cursor:pointer;font-size:0.9em">📂 תיקייה חדשה</button>';
        }
        // Refresh button
        html += '<button id="mw-refresh-btn" onclick="MediaStorage.refreshFolder()" style="padding:6px 12px;border-radius:8px;border:1px solid #d1d5db;background:white;color:#374151;cursor:pointer;font-size:0.9em" title="רענן תיקייה">🔄 רענן</button>';
        // Back button — go up one folder level (far left in RTL)
        if (currentFolder) {
            var parentFolder = currentFolderObj ? currentFolderObj.parent_id : null;
            html += '<button onclick="MediaStorage.navigateTo(' + (parentFolder ? parentFolder : 'null') + ')" style="margin-right:auto;padding:6px 12px;border-radius:8px;border:1px solid #374151;background:#374151;color:white;cursor:pointer;font-size:0.9em">→ חזור</button>';
        }
        html += '</div>';

        // Search
        html += '<div style="margin-bottom:12px">';
        html += '<input type="text" id="media-search-input" placeholder="חפש מדיה..." oninput="MediaStorage.handleSearch(this.value)" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;font-size:0.95em;direction:rtl;box-sizing:border-box">';
        html += '</div>';

        // Folders
        if (childFolders.length > 0) {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:16px">';
            childFolders.forEach(function(folder) {
                var icon = '📁';
                if (folder.name === 'יוטיוב') icon = '▶️';
                else if (folder.name === 'קטעי שמע') icon = '🎵';
                else if (folder.name === 'תמונות') icon = '🖼️';
                else if (folder.name === 'שיעורים') icon = '📚';
                else if (folder.name === TUTORIAL_FOLDER) icon = '🎓';

                var count = folder.name === TUTORIAL_FOLDER ? TUTORIALS.length : _folderRecursiveCount(folder.id);
                var parentFolder = folder.parent_id ? getFolderById(parseInt(folder.parent_id)) : null;
                var isInLessons = parentFolder && parentFolder.name === 'שיעורים';
                var isSystem = SYSTEM_FOLDERS.indexOf(folder.name) !== -1 || isInLessons;
                html += '<div class="media-folder-card" onclick="MediaStorage.openFolder(' + folder.id + ')" style="padding:12px;border-radius:10px;border:1px solid #e5e7eb;background:white;cursor:pointer;text-align:center;transition:all 0.2s;position:relative" onmouseenter="var b=this.querySelector(\'.folder-hover-btns\');if(b)b.style.opacity=1" onmouseleave="var b=this.querySelector(\'.folder-hover-btns\');if(b)b.style.opacity=0">';
                if (!isSystem) {
                    html += '<div class="folder-hover-btns" style="position:absolute;top:4px;left:4px;display:flex;gap:3px;opacity:0;transition:opacity 0.2s">';
                    html += '<button onclick="event.stopPropagation();MediaStorage._deleteFolderConfirm(' + folder.id + ',\'' + folder.name.replace(/'/g, "\\'") + '\')" style="width:20px;height:20px;border-radius:50%;border:1px solid #e5e7eb;background:white;cursor:pointer;font-size:0.65em;color:#94a3b8;display:flex;align-items:center;justify-content:center;padding:0;line-height:1" onmouseenter="this.style.background=\'#fee2e2\';this.style.color=\'#dc2626\';this.style.borderColor=\'#dc2626\'" onmouseleave="this.style.background=\'white\';this.style.color=\'#94a3b8\';this.style.borderColor=\'#e5e7eb\'" title="מחק תיקייה">✕</button>';
                    html += '<button onclick="event.stopPropagation();MediaStorage._renameFolderPrompt(' + folder.id + ',\'' + folder.name.replace(/'/g, "\\'") + '\')" style="width:20px;height:20px;border-radius:50%;border:1px solid #e5e7eb;background:white;cursor:pointer;font-size:0.65em;color:#94a3b8;display:flex;align-items:center;justify-content:center;padding:0;line-height:1" onmouseenter="this.style.background=\'#dbeafe\';this.style.color=\'#2563eb\';this.style.borderColor=\'#2563eb\'" onmouseleave="this.style.background=\'white\';this.style.color=\'#94a3b8\';this.style.borderColor=\'#e5e7eb\'" title="שנה שם">✏️</button>';
                    html += '</div>';
                }
                html += '<div style="font-size:1.8em;margin-bottom:4px">' + icon + '</div>';
                html += '<div style="font-weight:bold;font-size:0.95em;color:#1f2937">' + folder.name + '</div>';
                if (count > 0) html += '<div style="font-size:0.8em;color:#6b7280">' + count + ' פריטים</div>';
                html += '</div>';
            });
            html += '</div>';
        }

        // In-flight upload indicator (feature: shows ⏳ while uploading, ✓ on done)
        html += '<div id="mw-active-uploads" style="display:none;padding:0 4px 8px"></div>';

        // Media items in current folder
        html += '<div id="media-items-list"></div>';

        root.innerHTML = html;

        // Drag-and-drop auto-upload (guard prevents duplicate listeners on re-render)
        if (!root._msDragAttached) {
            root._msDragAttached = true;
            root.addEventListener('dragover', function(e) {
                e.preventDefault();
                root.style.outline = '3px dashed #0891b2';
            });
            root.addEventListener('dragleave', function(e) {
                if (!root.contains(e.relatedTarget)) root.style.outline = '';
            });
            root.addEventListener('drop', function(e) {
                e.preventDefault();
                root.style.outline = '';
                var targetFolder = currentFolder || _getFirstNonTutorialFolder();
                if (!targetFolder) { showToast('נא לבחור תיקייה תחילה'); return; }
                _submitBulkUpload(Array.prototype.slice.call(e.dataTransfer.files), targetFolder);
            });
        }

        // Load media items for current folder
        if (currentFolder) {
            loadFolderMedia(currentFolder);
        }
    }

    function loadFolderMedia(folderId, offset, append) {
        offset = offset || 0;
        append = !!append;
        var listEl = document.getElementById('media-items-list');
        if (!listEl) return;

        // Check if tutorial folder
        var folder = getFolderById(folderId);
        if (folder && folder.name === TUTORIAL_FOLDER) {
            renderTutorialItems(listEl);
            return;
        }

        if (!append) {
            listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#6b7280">טוען...</div>';
        } else {
            var oldBtn = document.getElementById('media-load-more-btn');
            if (oldBtn) oldBtn.remove();
            var moreInd = document.createElement('div');
            moreInd.id = 'media-loading-more';
            moreInd.style.cssText = 'text-align:center;padding:8px;color:#6b7280;font-size:0.85em';
            moreInd.textContent = 'טוען עוד...';
            listEl.appendChild(moreInd);
        }

        apiCall('list_media', { folder_id: folderId, limit: _MEDIA_PAGE_SIZE, offset: offset }).then(function(data) {
            var items = data.items || [];
            var hasMore = !!data.has_more;

            if (!append) {
                _currentFolderItems = items; // cache for _getMwDefaultTitle
                if (items.length === 0) {
                    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af">תיקייה ריקה</div>';
                    return;
                }
                renderMediaItems(listEl, items);
            } else {
                _currentFolderItems = _currentFolderItems.concat(items); // grow cache on append
                var lm = document.getElementById('media-loading-more');
                if (lm) lm.remove();
                items.forEach(function(item) {
                    var accent = (MEDIA_TYPE_STYLE[item.media_type] || MEDIA_TYPE_STYLE.other).color;
                    listEl.insertAdjacentHTML('beforeend', _renderMediaItemCard(item, accent));
                });
            }

            if (hasMore) {
                var nextOffset = offset + items.length;
                var remaining = data.total ? (data.total - nextOffset) : '';
                var loadMoreDiv = document.createElement('div');
                loadMoreDiv.id = 'media-load-more-btn';
                loadMoreDiv.style.cssText = 'text-align:center;margin:12px 0 4px';
                loadMoreDiv.innerHTML = '<button onclick="MediaStorage._loadMoreMedia(' + folderId + ',' + nextOffset + ')" style="padding:8px 24px;border-radius:8px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.9em">טען עוד' + (remaining ? ' (' + remaining + ' נוספים)' : '') + '...</button>';
                listEl.appendChild(loadMoreDiv);
            }
        }).catch(function(err) {
            if (err && err.authRequired) return;
            if (!append) {
                listEl.innerHTML = '<div style="color:#ef4444;padding:12px">שגיאה: ' + err.message + '</div>';
            } else {
                var lm = document.getElementById('media-loading-more');
                if (lm) lm.remove();
            }
        });
    }

    function renderTutorialItems(container) {
        var html = '';
        TUTORIALS.forEach(function(t, i) {
            var ytId = extractYouTubeId(t.url);
            html += '<div class="media-item-card" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:6px;background:white">';
            if (ytId) {
                html += '<img src="https://img.youtube.com/vi/' + ytId + '/default.jpg" width="60" height="45" loading="lazy" decoding="async" style="border-radius:4px;object-fit:cover;flex-shrink:0">';
            } else {
                html += '<div style="width:60px;height:45px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center">▶️</div>';
            }
            html += '<div style="flex:1">';
            html += '<div style="font-weight:bold;font-size:0.95em">' + t.title + '</div>';
            html += '<div style="font-size:0.8em;color:#6b7280">סרטון טוטוריאל</div>';
            html += '</div>';
            html += '<button onclick="MediaStorage.playMedia({url:\'' + t.url + '\',media_type:\'video\',title:\'' + t.title.replace(/'/g, "\\'") + '\'})" style="padding:4px 10px;border-radius:6px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.85em">▶ נגן</button>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    // Visual identity per media type — used for section headers + card accents.
    var MEDIA_TYPE_STYLE = {
        video: { icon: '🎬', label: 'סרטונים', color: '#6366f1', bg: '#eef2ff' },
        audio: { icon: '🎵', label: 'קטעי שמע', color: '#0891b2', bg: '#ecfeff' },
        image: { icon: '🖼️', label: 'תמונות', color: '#d97706', bg: '#fffbeb' },
        other: { icon: '📄', label: 'אחר', color: '#64748b', bg: '#f8fafc' }
    };

    function _renderMediaItemCard(item, accent) {
        var ytId = item.url ? extractYouTubeId(item.url) : null;
        var typeIcon = (MEDIA_TYPE_STYLE[item.media_type] || MEDIA_TYPE_STYLE.other).icon;
        var html = '';
        // RTL layout → accent strip sits on the right edge via border-right.
        html += '<div class="media-item-card" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;border:1px solid #e5e7eb;border-right:4px solid ' + accent + ';margin-bottom:6px;background:white;box-shadow:0 1px 2px rgba(0,0,0,0.04)" data-media-id="' + item.id + '">';

        // Thumbnail
        if (ytId) {
            html += '<img src="https://img.youtube.com/vi/' + ytId + '/default.jpg" width="60" height="45" loading="lazy" decoding="async" style="border-radius:6px;object-fit:cover;flex-shrink:0">';
        } else if (item.media_type === 'image' && item.url) {
            html += '<img src="' + _absUrl(item.url) + '" width="60" height="45" loading="lazy" decoding="async" style="border-radius:6px;object-fit:cover;flex-shrink:0" onerror="this.outerHTML=\'<div style=&quot;width:60px;height:45px;background:#f3f4f6;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.4em;flex-shrink:0&quot;>🖼️</div>\'">';
        } else {
            html += '<div style="width:60px;height:45px;background:' + (MEDIA_TYPE_STYLE[item.media_type] || MEDIA_TYPE_STYLE.other).bg + ';border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.4em;flex-shrink:0">' + typeIcon + '</div>';
        }

        html += '<div style="flex:1;min-width:0">';
        html += '<div style="font-weight:bold;font-size:0.95em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (item.title || 'ללא כותרת') + '</div>';
        var sourceLabel = item.source_type === 'shortcut' ? ' <span style="background:#dbeafe;color:#1d4ed8;padding:0 4px;border-radius:3px;font-size:0.85em">🔗 קיצור</span>' : (item.source_type === 'upload' ? ' (הועלה)' : ' (קישור)');
        html += '<div style="font-size:0.8em;color:#6b7280">' + getMediaTypeLabel(item.media_type) + sourceLabel + '</div>';
        html += '</div>';

        // Action buttons
        html += '<div style="display:flex;gap:4px;flex-shrink:0">';
        html += '<button onclick="MediaStorage.playMedia(' + JSON.stringify(item).replace(/"/g, '&quot;') + ')" style="padding:4px 8px;border-radius:6px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.8em" title="נגן">▶</button>';
        if (item.source_type !== 'shortcut') {
            html += '<button onclick="MediaStorage.showCreateShortcutDialog(' + item.id + ')" style="padding:4px 8px;border-radius:6px;border:1px solid #6366f1;background:white;color:#6366f1;cursor:pointer;font-size:0.8em" title="צור קיצור דרך">📌</button>';
        }
        html += '<button onclick="MediaStorage.showMoveDialog(' + item.id + ')" style="padding:4px 8px;border-radius:6px;border:1px solid #d1d5db;background:white;color:#374151;cursor:pointer;font-size:0.8em" title="העבר">↗</button>';
        html += '<button onclick="MediaStorage.confirmDeleteMedia(' + item.id + ',\'' + (item.title || '').replace(/'/g, "\\'") + '\')" style="padding:4px 8px;border-radius:6px;border:1px solid #ef4444;background:white;color:#ef4444;cursor:pointer;font-size:0.8em" title="מחק">🗑</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderMediaItems(container, items) {
        // Group by media type so each kind gets its own clearly-separated section.
        var groups = { video: [], audio: [], image: [], other: [] };
        items.forEach(function(item) {
            var key = groups[item.media_type] ? item.media_type : 'other';
            groups[key].push(item);
        });

        var order = ['video', 'audio', 'image', 'other'];
        var html = '';
        order.forEach(function(type) {
            var list = groups[type];
            if (!list.length) return;
            var st = MEDIA_TYPE_STYLE[type];
            // Section header — emoji + label + count, with a soft type-colored band.
            html += '<div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px;padding:6px 10px;border-radius:8px;background:' + st.bg + '">' +
                '<span style="font-size:1.15em">' + st.icon + '</span>' +
                '<span style="font-weight:bold;color:' + st.color + ';font-size:0.95em">' + st.label + '</span>' +
                '<span style="margin-right:auto;background:white;color:' + st.color + ';border:1px solid ' + st.color + '33;border-radius:999px;padding:1px 9px;font-size:0.78em;font-weight:bold">' + list.length + '</span>' +
                '</div>';
            list.forEach(function(item) {
                html += _renderMediaItemCard(item, st.color);
            });
        });
        container.innerHTML = html;
    }

    function getMediaTypeLabel(type) {
        switch (type) {
            case 'video': return 'סרטון';
            case 'audio': return 'שמע';
            case 'image': return 'תמונה';
            default: return type;
        }
    }

    function getUploadAcceptForType(type) {
        if (type === 'audio') return 'audio/*';
        if (type === 'video') return 'video/*';
        if (type === 'image') return 'image/*';
        return 'audio/*,video/*,image/*';
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function(ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    function _absUrl(u) {
        if (!u) return '';
        if (/^(https?:)?\/\//i.test(u) || u.charAt(0) === '/') return u;
        return '/plonter/' + u;
    }

    function formatFileSize(bytes) {
        if (!bytes && bytes !== 0) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ---- Navigation ----

    function openFolder(folderId) {
        if (guardUploadInProgress()) return;
        var folder = getFolderById(folderId);
        if (!folder) return;

        currentFolder = folderId;

        // Build path
        folderPath = [];
        var f = folder;
        var visited = {};
        while (f) {
            if (visited[f.id]) break;
            visited[f.id] = true;
            folderPath.unshift({ id: parseInt(f.id), name: f.name });
            f = f.parent_id ? getFolderById(parseInt(f.parent_id)) : null;
        }

        var root = document.getElementById('media-storage-root');
        if (root) renderFolderView(root);
    }

    function navigateTo(folderId) {
        if (guardUploadInProgress()) return;
        if (folderId === null) {
            currentFolder = null;
            folderPath = [];
        } else {
            // Trim path to this folder
            var idx = -1;
            for (var i = 0; i < folderPath.length; i++) {
                if (folderPath[i].id === folderId) { idx = i; break; }
            }
            if (idx >= 0) {
                folderPath = folderPath.slice(0, idx + 1);
                currentFolder = folderId;
            } else {
                openFolder(folderId);
                return;
            }
        }
        var root = document.getElementById('media-storage-root');
        if (root) renderFolderView(root);
    }

    // ---- Dialogs ----

    function _closeAllDialogs() {
        var ids = ['media-dialog-overlay', 'media-shortcut-overlay'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
    }

    function showAddLinkDialog() {
        _closeAllDialogs();
        if (!currentFolder && !_getFirstNonTutorialFolder()) {
            showToast('נא לבחור תיקייה תחילה');
            return;
        }
        var targetFolder = currentFolder || _getFirstNonTutorialFolder();

        var overlay = document.createElement('div');
        overlay.id = 'media-dialog-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;width:90%;max-width:400px;direction:rtl';

        dialog.innerHTML = '<h3 style="margin:0 0 16px;color:#1f2937">🔗 הוסף קישור</h3>' +
            '<input type="text" id="media-link-title" placeholder="כותרת" style="width:100%;padding:8px;border-radius:6px;border:1px solid #d1d5db;margin-bottom:8px;direction:rtl;box-sizing:border-box">' +
            '<input type="text" id="media-link-url" placeholder="קישור (YouTube, תמונה, וכו׳)" style="width:100%;padding:8px;border-radius:6px;border:1px solid #d1d5db;margin-bottom:8px;direction:ltr;box-sizing:border-box">' +
            '<select id="media-link-type" style="width:100%;padding:8px;border-radius:6px;border:1px solid #d1d5db;margin-bottom:12px;box-sizing:border-box">' +
            '<option value="video">סרטון</option>' +
            '<option value="audio">קטע שמע</option>' +
            '<option value="image">תמונה</option>' +
            '</select>' +
            '<div style="display:flex;gap:8px;justify-content:flex-start">' +
            '<button onclick="MediaStorage._submitLink()" style="padding:8px 20px;border-radius:8px;background:#0891b2;color:white;border:none;cursor:pointer;font-weight:bold">הוסף</button>' +
            '<button onclick="MediaStorage._closeDialog()" style="padding:8px 20px;border-radius:8px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;cursor:pointer">ביטול</button>' +
            '</div>';

        overlay.appendChild(dialog);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) _closeDialog(); });
        document.body.appendChild(overlay);

        // Auto-detect YouTube
        var urlInput = document.getElementById('media-link-url');
        if (urlInput) {
            urlInput.addEventListener('input', function() {
                if (isYouTubeUrl(this.value)) {
                    document.getElementById('media-link-type').value = 'video';
                }
            });
        }

        document.getElementById('media-link-title').focus();
    }

    function _submitLink() {
        var title = document.getElementById('media-link-title').value.trim();
        var url = document.getElementById('media-link-url').value.trim();
        var type = document.getElementById('media-link-type').value;

        if (!title || !url) { showToast('נא למלא כותרת וקישור'); return; }

        var targetFolder = currentFolder || _getFirstNonTutorialFolder();

        apiCall('add_link', {
            title: title,
            url: url,
            media_type: type,
            folder_id: targetFolder
        }).then(function() {
            _closeDialog();
            showToast('הקישור נוסף בהצלחה');
            if (currentFolder) loadFolderMedia(currentFolder);
        }).catch(function(err) {
            showToast('שגיאה: ' + err.message);
        });
    }

    function showShortcutDialog() {
        _closeAllDialogs();
        if (!currentFolder && !_getFirstNonTutorialFolder()) {
            showToast('נא לבחור תיקייה תחילה');
            return;
        }
        var targetFolderId = currentFolder || _getFirstNonTutorialFolder();
        var _scFolderId = null;
        var _scSort = 'recent';
        var _scCreatedAny = false; // refresh folder view on close if any shortcut was added (fix: shortcuts didn't appear until re-entering the folder)

        var overlay = document.createElement('div');
        overlay.id = 'media-shortcut-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:16px;padding:20px;width:95%;max-width:500px;direction:rtl;max-height:85vh;display:flex;flex-direction:column';

        // Header
        dialog.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
            '<h3 style="margin:0;color:#1f2937;font-size:1.1em">📌 הוסף קיצור דרך</h3>' +
            '<button id="sc-close" style="background:none;border:none;font-size:1.3em;cursor:pointer;color:#6b7280">✕</button>' +
            '</div>' +
            // Folder pills
            '<div id="sc-folder-pills" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>' +
            // Search
            '<input type="text" id="sc-search" placeholder="🔍 חפש מדיה..." style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;font-size:0.95em;direction:rtl;box-sizing:border-box;margin-bottom:10px">' +
            // Sort bar
            '<div id="sc-sort-bar" style="display:none;margin-bottom:8px;font-size:0.85em"></div>' +
            // Content area
            '<div id="sc-content" style="flex:1;overflow-y:auto"></div>';

        overlay.appendChild(dialog);
        function _closeScDialog() {
            overlay.remove();
            if (_scCreatedAny) {
                // Reveal newly-added shortcuts in the folder behind the dialog.
                // ROOT FIX: re-render the folder view (renderFolderView) — NOT just
                // loadFolderMedia — because loadFolderMedia early-returns when
                // #media-items-list is stale/absent, which is why the old close path
                // left the folder showing "תיקייה ריקה" until the user navigated
                // out/in. This mirrors the working 🔄 refreshFolder() path. Then pulse
                // the 🔄 רענן button as a visible "עודכן" cue (Amitai 2026-06-17).
                var _afterRefresh = function() {
                    var root = document.getElementById('media-storage-root');
                    if (root) renderFolderView(root);
                    if (currentFolder) loadFolderMedia(currentFolder);
                    _pulseRefreshButton();
                };
                loadFolders().then(_afterRefresh).catch(_afterRefresh);
            }
        }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) _closeScDialog(); });
        document.body.appendChild(overlay);

        document.getElementById('sc-close').addEventListener('click', _closeScDialog);

        // Recursive folder count (includes subfolders)
        function _recursiveCount(folderId) {
            var folder = getFolderById(folderId);
            var count = folder ? (folder.media_count || 0) : 0;
            var children = getChildFolders(folderId);
            children.forEach(function(c) { count += _recursiveCount(c.id); });
            return count;
        }

        // Render folder cards (real folder look)
        function _renderPills() {
            var pillsEl = document.getElementById('sc-folder-pills');
            var rootFolders = folders.filter(function(f) { return !f.parent_id; });
            var html = '';
            pillsEl.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;margin-bottom:10px';
            rootFolders.forEach(function(f) {
                var icon = f.name === 'יוטיוב' ? '▶️' : f.name === 'קטעי שמע' ? '🎵' : f.name === 'תמונות' ? '🖼️' : f.name === 'שיעורים' ? '📚' : f.name === 'טוטוריאל' ? '📖' : '📁';
                var active = parseInt(f.id) === parseInt(_scFolderId);
                var totalCount = _recursiveCount(f.id);
                html += '<button data-sc-pill="' + f.id + '" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:10px;border:2px solid ' + (active ? '#6366f1' : '#e2e8f0') + ';background:' + (active ? '#eef2ff' : 'white') + ';cursor:pointer;text-align:center;min-width:0;transition:all 0.15s">' +
                    '<span style="font-size:2em">' + icon + '</span>' +
                    '<span style="font-size:0.8em;font-weight:' + (active ? 'bold' : 'normal') + ';color:' + (active ? '#6366f1' : '#374151') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%">' + f.name + '</span>' +
                    '<span style="font-size:0.7em;color:#9ca3af">' + totalCount + ' קבצים</span>' +
                    '</button>';
            });
            pillsEl.innerHTML = html;

            pillsEl.querySelectorAll('[data-sc-pill]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    _scFolderId = parseInt(btn.dataset.scPill);
                    document.getElementById('sc-search').value = '';
                    _renderPills();
                    _renderContent();
                });
            });
        }

        function _renderContent() {
            var content = document.getElementById('sc-content');
            var sortBar = document.getElementById('sc-sort-bar');

            if (!_scFolderId) {
                content.innerHTML = '<div style="text-align:center;padding:24px;color:#9ca3af">בחר תיקייה מלמעלה או חפש</div>';
                sortBar.style.display = 'none';
                return;
            }

            content.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af">טוען...</div>';

            // Show sort bar
            sortBar.style.display = 'flex';
            sortBar.innerHTML = '<span style="color:#6b7280;margin-left:8px">מיון:</span>' +
                ['recent', 'alpha', 'oldest'].map(function(s) {
                    var label = s === 'recent' ? 'אחרון' : s === 'alpha' ? 'א-ב' : 'ישן';
                    return '<button data-sc-sort="' + s + '" style="padding:2px 8px;border-radius:4px;border:1px solid ' + (_scSort === s ? '#6366f1' : '#e2e8f0') + ';background:' + (_scSort === s ? '#eef2ff' : 'white') + ';color:' + (_scSort === s ? '#6366f1' : '#6b7280') + ';cursor:pointer;font-size:0.85em;margin:0 2px">' + label + '</button>';
                }).join('');
            sortBar.querySelectorAll('[data-sc-sort]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    _scSort = btn.dataset.scSort;
                    _renderContent();
                });
            });

            // Load folder contents (including subfolders)
            var childFolders = getChildFolders(_scFolderId);
            apiCall('list_media', { folder_id: _scFolderId }).then(function(data) {
                var items = data.items || [];

                // Sort
                if (_scSort === 'alpha') items.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
                else if (_scSort === 'oldest') items.reverse();

                var html = '';

                // Subfolders
                childFolders.forEach(function(cf) {
                    html += '<div data-sc-sub="' + cf.id + '" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid #e2e8f0;margin-bottom:4px;background:#fafafa">' +
                        '<span style="font-size:1.1em">📁</span>' +
                        '<span style="flex:1;font-weight:bold;font-size:0.9em">' + cf.name + '</span>' +
                        '<span style="color:#9ca3af;font-size:0.8em">' + (cf.media_count || 0) + '</span>' +
                        '<span style="color:#d1d5db">›</span></div>';
                });

                // Media items
                items.forEach(function(item) {
                    if (parseInt(item.folder_id) === parseInt(targetFolderId)) return;
                    var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                    var ytId = item.url ? extractYouTubeId(item.url) : null;
        var thumb = '';
        if (ytId) thumb = '<img src="https://img.youtube.com/vi/' + ytId + '/default.jpg" style="width:48px;height:36px;border-radius:4px;object-fit:cover">';
        else if (item.media_type === 'image' && item.url) thumb = '<img src="' + _absUrl(item.url) + '" style="width:48px;height:36px;border-radius:4px;object-fit:cover" onerror="this.outerHTML=\'<div style=width:48px;height:36px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1.2em>' + icon + '</div>\'">';
                    else thumb = '<div style="width:48px;height:36px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1.2em">' + icon + '</div>';

                    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;border:1px solid #f3f4f6;margin-bottom:4px">' +
                        thumb +
                        '<div style="flex:1;min-width:0"><div style="font-size:0.9em;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (item.title || '') + '</div>' +
                        '<div style="font-size:0.75em;color:#9ca3af">' + getMediaTypeLabel(item.media_type) + '</div></div>' +
                        '<button data-sc-create="' + item.id + '" data-sc-title="' + (item.title || '').replace(/"/g, '&quot;') + '" style="padding:5px 14px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.85em;white-space:nowrap;flex-shrink:0">🔗 קיצור</button>' +
                        '</div>';
                });

                if (!html) html = '<div style="text-align:center;padding:16px;color:#9ca3af">תיקייה ריקה</div>';
                content.innerHTML = html;

                // Subfolder click
                content.querySelectorAll('[data-sc-sub]').forEach(function(el) {
                    el.addEventListener('click', function() {
                        _scFolderId = parseInt(el.dataset.scSub);
                        _renderPills();
                        _renderContent();
                    });
                });

                // Shortcut create
                content.querySelectorAll('[data-sc-create]').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var mediaId = parseInt(btn.dataset.scCreate);
                        var title = btn.dataset.scTitle;
                        btn.disabled = true;
                        btn.textContent = '...';
                        createShortcut(mediaId, targetFolderId).then(function() {
                            showToast('קיצור דרך נוצר: ' + title);
                            btn.textContent = '✓';
                            btn.style.background = '#059669';
                            _scCreatedAny = true;
                            // Don't close — let user add more shortcuts
                        }).catch(function(err) {
                            btn.disabled = false;
                            btn.textContent = '🔗 קיצור';
                            showToast('שגיאה: ' + (err.message || err.error || 'כבר קיים'));
                        });
                    });
                });
            });
        }

        // Search
        var _timer = null;
        document.getElementById('sc-search').addEventListener('input', function() {
            clearTimeout(_timer);
            var q = this.value.trim();
            if (!q) { _renderContent(); return; }
            if (q.length < 2) return;
            _timer = setTimeout(function() {
                searchMainStorage(q).then(function(data) {
                    var items = data.items || [];
                    var content = document.getElementById('sc-content');
                    document.getElementById('sc-sort-bar').style.display = 'none';
                    if (!items.length) { content.innerHTML = '<div style="padding:16px;text-align:center;color:#9ca3af">לא נמצא</div>'; return; }
                    var html = '';
                    items.forEach(function(item) {
                        if (parseInt(item.folder_id) === parseInt(targetFolderId)) return;
                        var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                        html += '<div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;border:1px solid #f3f4f6;margin-bottom:4px">' +
                            '<span style="font-size:1.1em">' + icon + '</span>' +
                            '<div style="flex:1;min-width:0"><div style="font-size:0.9em;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (item.title || '') + '</div>' +
                            '<div style="font-size:0.75em;color:#9ca3af">' + (item.folder_name || '') + '</div></div>' +
                            '<button data-sc-create="' + item.id + '" data-sc-title="' + (item.title || '').replace(/"/g, '&quot;') + '" style="padding:5px 14px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.85em;white-space:nowrap">🔗 קיצור</button>' +
                            '</div>';
                    });
                    content.innerHTML = html;
                    content.querySelectorAll('[data-sc-create]').forEach(function(btn) {
                        btn.addEventListener('click', function() {
                            var mediaId = parseInt(btn.dataset.scCreate);
                            var title = btn.dataset.scTitle;
                            btn.disabled = true;
                            btn.textContent = '...';
                            createShortcut(mediaId, targetFolderId).then(function() {
                                showToast('קיצור דרך נוצר: ' + title);
                                btn.textContent = '✓';
                                btn.style.background = '#059669';
                                _scCreatedAny = true;
                            }).catch(function(err) {
                                btn.disabled = false;
                                btn.textContent = '🔗 קיצור';
                                showToast('שגיאה: ' + (err.message || err.error || 'כבר קיים'));
                            });
                        });
                    });
                });
            }, 300);
        });

        _renderPills();
        _renderContent();
    }

    function showUploadDialog() {
        _closeAllDialogs();
        if (!currentFolder && !_getFirstNonTutorialFolder()) {
            showToast('נא לבחור תיקייה תחילה');
            return;
        }

        var overlay = document.createElement('div');
        overlay.id = 'media-dialog-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;width:90%;max-width:400px;direction:rtl';

        // Build folder picker so the user always knows where the file lands
        var _defaultFolder = currentFolder || _getFirstNonTutorialFolder();
        var _folderTree = buildFolderTree(null, 0).filter(function(f) {
            var fo = getFolderById(f.id);
            return !(fo && fo.name === TUTORIAL_FOLDER);
        });
        var _folderOptions = _folderTree.map(function(f) {
            var indent = new Array(f.level + 1).join('— ');
            var sel = (parseInt(f.id) === parseInt(_defaultFolder)) ? ' selected' : '';
            return '<option value="' + f.id + '"' + sel + '>' + indent + escapeHtml(f.name) + '</option>';
        }).join('');

        dialog.innerHTML = '<h3 style="margin:0 0 16px;color:#1f2937">📁 העלה מהמחשב</h3>' +
            '<input type="text" id="media-upload-title" placeholder="כותרת" style="width:100%;padding:8px;border-radius:6px;border:1px solid #d1d5db;margin-bottom:8px;direction:rtl;box-sizing:border-box">' +
            '<div style="font-size:0.85em;color:#6b7280;margin:0 0 6px">📂 לאיזו תיקייה?</div>' +
            '<select id="media-upload-folder" style="width:100%;padding:8px;border-radius:6px;border:1px solid #d1d5db;margin-bottom:12px;direction:rtl;box-sizing:border-box;background:white">' + _folderOptions + '</select>' +
            '<input type="hidden" id="media-upload-type" value="audio">' +
            '<div style="font-size:0.85em;color:#6b7280;margin:0 0 6px">בחר סוג מדיה</div>' +
            '<div id="media-upload-type-buttons" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">' +
            '<button type="button" data-upload-type="audio" style="padding:10px 6px;border-radius:10px;border:2px solid #0891b2;background:#ecfeff;color:#0f766e;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🎵</span><span>קטע שמע</span></button>' +
            '<button type="button" data-upload-type="video" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🎬</span><span>סרטון</span></button>' +
            '<button type="button" data-upload-type="image" style="padding:10px 6px;border-radius:10px;border:2px solid #e5e7eb;background:white;color:#374151;cursor:pointer;font-weight:bold;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:1.45em">🖼️</span><span>תמונה</span></button>' +
            '</div>' +
            '<input type="file" id="media-upload-file" accept="audio/*,video/*,image/*" style="width:100%;padding:8px;margin-bottom:8px;box-sizing:border-box">' +
            '<div id="media-upload-preview" style="display:none;margin:0 0 12px;padding:10px;border-radius:10px;border:1px solid #bae6fd;background:#f0fdfa"></div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin:6px 0 10px;color:#9ca3af;font-size:0.8em"><div style="flex:1;height:1px;background:#e5e7eb"></div>או<div style="flex:1;height:1px;background:#e5e7eb"></div></div>' +
            '<button type="button" id="media-upload-folder-btn" style="width:100%;padding:10px;border-radius:10px;border:2px dashed #6366f1;background:#eef2ff;color:#4338ca;cursor:pointer;font-weight:bold;margin-bottom:10px">📂 העלה תיקייה שלמה (מיון אוטומטי לפי סוג)</button>' +
            '<input type="file" id="media-upload-folder-input" webkitdirectory multiple style="display:none">' +
            '<div id="media-upload-progress" style="display:none;margin-bottom:8px">' +
            '<div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden"><div id="media-upload-bar" style="background:#0891b2;height:100%;width:0%;transition:width 0.3s"></div></div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-start">' +
            '<button id="media-upload-btn" onclick="MediaStorage._submitUpload()" style="padding:8px 20px;border-radius:8px;background:#0891b2;color:white;border:none;cursor:pointer;font-weight:bold">העלה</button>' +
            '<button onclick="MediaStorage._closeDialog()" style="padding:8px 20px;border-radius:8px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;cursor:pointer">ביטול</button>' +
            '</div>';

        overlay.appendChild(dialog);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) _closeDialog(); });
        document.body.appendChild(overlay);

        // Auto-detect type from file
        var fileInput = document.getElementById('media-upload-file');
        var mediaTypeInput = document.getElementById('media-upload-type');
        var mediaTypeButtons = document.querySelectorAll('[data-upload-type]');
        var uploadPreviewUrl = null;
        function ensureUploadReadyStyle() {
            if (document.getElementById('upload-ready-style')) return;
            var style = document.createElement('style');
            style.id = 'upload-ready-style';
            style.textContent = '@keyframes upload-ready-pop { 0%,100% { transform:scale(1); box-shadow:0 0 0 rgba(8,145,178,0); } 50% { transform:scale(1.08); box-shadow:0 8px 18px rgba(8,145,178,0.28); } }';
            document.head.appendChild(style);
        }
        function setUploadButtonReady(isReady) {
            var btn = document.getElementById('media-upload-btn');
            if (!btn) return;
            if (isReady) {
                ensureUploadReadyStyle();
                btn.style.background = 'linear-gradient(135deg,#0d9488,#0891b2)';
                btn.style.animation = 'upload-ready-pop 1.15s ease-in-out infinite';
            } else {
                btn.style.background = '#0891b2';
                btn.style.animation = '';
            }
        }
        function renderUploadPreview(file) {
            var preview = document.getElementById('media-upload-preview');
            if (!preview) return;
            if (uploadPreviewUrl) {
                URL.revokeObjectURL(uploadPreviewUrl);
                uploadPreviewUrl = null;
            }
            if (!file) {
                preview.style.display = 'none';
                preview.innerHTML = '';
                setUploadButtonReady(false);
                return;
            }
            uploadPreviewUrl = URL.createObjectURL(file);
            var type = mediaTypeInput ? mediaTypeInput.value : '';
            var title = escapeHtml(file.name);
            var meta = escapeHtml(formatFileSize(file.size));
            var mediaHtml = '';
            if (type === 'audio' || file.type.startsWith('audio/')) {
                mediaHtml = '<audio controls src="' + uploadPreviewUrl + '" style="width:100%;height:36px"></audio>';
            } else if (type === 'video' || file.type.startsWith('video/')) {
                mediaHtml = '<video controls src="' + uploadPreviewUrl + '" style="width:100%;max-height:180px;border-radius:8px;background:#111"></video>';
            } else if (type === 'image' || file.type.startsWith('image/')) {
                mediaHtml = '<img src="' + uploadPreviewUrl + '" style="width:100%;max-height:180px;object-fit:contain;border-radius:8px;background:white">';
            } else {
                mediaHtml = '<div style="font-size:1.8em;text-align:center">📄</div>';
            }
            preview.innerHTML = '<div style="font-weight:bold;color:#0f766e;margin-bottom:6px">מוכן להעלאה</div>' +
                mediaHtml +
                '<div style="font-size:0.82em;color:#475569;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + title + (meta ? ' · ' + meta : '') + '</div>';
            preview.style.display = 'block';
            setUploadButtonReady(true);
        }
        function setUploadType(type, clearFile) {
            if (!mediaTypeInput) return;
            mediaTypeInput.value = type;
            if (fileInput) {
                fileInput.setAttribute('accept', getUploadAcceptForType(type));
                if (clearFile) {
                    fileInput.value = '';
                    renderUploadPreview(null);
                }
            }
            mediaTypeButtons.forEach(function(btn) {
                var active = btn.getAttribute('data-upload-type') === type;
                btn.style.borderColor = active ? '#0891b2' : '#e5e7eb';
                btn.style.background = active ? '#ecfeff' : 'white';
                btn.style.color = active ? '#0f766e' : '#374151';
            });
        }
        mediaTypeButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var newType = btn.getAttribute('data-upload-type');
                setUploadType(newType, true);
                // Feature: update default title when type changes (if still a default pattern)
                var titleInput = document.getElementById('media-upload-title');
                if (titleInput && /^(תמונה|סרטון|שמע)_\d+$/.test(titleInput.value)) {
                    titleInput.value = _getMwDefaultTitle(newType);
                }
            });
        });
        if (fileInput && mediaTypeInput) {
            mediaTypeInput.addEventListener('change', function() {
                fileInput.setAttribute('accept', getUploadAcceptForType(mediaTypeInput.value));
                fileInput.value = '';
                renderUploadPreview(null);
            });
        }
        if (fileInput) {
            fileInput.addEventListener('change', function() {
                var f = this.files[0];
                if (!f) { renderUploadPreview(null); return; }
                if (f.type.startsWith('audio/')) setUploadType('audio', false);
                else if (f.type.startsWith('video/')) setUploadType('video', false);
                else if (f.type.startsWith('image/')) setUploadType('image', false);
                renderUploadPreview(f);
                // Auto-fill title from filename
                var titleInput = document.getElementById('media-upload-title');
                if (!titleInput.value) {
                    titleInput.value = f.name.replace(/\.[^.]+$/, '');
                }
            });
        }

        // Whole-folder / multi-file upload with automatic type sorting
        var folderBtn = document.getElementById('media-upload-folder-btn');
        var folderInput = document.getElementById('media-upload-folder-input');
        if (folderBtn && folderInput) {
            folderBtn.addEventListener('click', function() { folderInput.click(); });
            folderInput.addEventListener('change', function() {
                var picked = Array.prototype.slice.call(this.files || []);
                if (!picked.length) return;
                var fsel = document.getElementById('media-upload-folder');
                var target = fsel && fsel.value
                    ? parseInt(fsel.value)
                    : (currentFolder || _getFirstNonTutorialFolder());
                if (!target) { showToast('נא לבחור תיקיית יעד'); return; }
                _submitBulkUpload(picked, target);
            });
        }

        // Feature: set default title by type and auto-select on focus
        var titleInput = document.getElementById('media-upload-title');
        if (titleInput) {
            if (!titleInput.value) {
                titleInput.value = _getMwDefaultTitle(mediaTypeInput ? mediaTypeInput.value : 'audio');
            }
            titleInput.addEventListener('focus', function() {
                if (/^(תמונה|סרטון|שמע)_\d+$/.test(this.value)) this.select();
            });
        }

        if (titleInput) titleInput.focus();
    }

    // Detect media_type for a File: prefer MIME, fall back to extension.
    function _detectMediaType(file) {
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

    // Upload many files at once (e.g. a whole picked folder), auto-sorting each
    // by its detected type into the chosen target folder. Non-media / oversize
    // files are skipped and counted. Uploads run sequentially to stay gentle on
    // the server and to give clear per-file progress.
    function _submitBulkUpload(files, targetFolder) {
        if (uploadInProgress) { showToast('העלאה כבר מתבצעת'); return; }
        var media = [];
        var skipped = 0;
        files.forEach(function(f) {
            var mt = _detectMediaType(f);
            if (!mt) { skipped++; return; }
            if (f.size > 64 * 1024 * 1024) { skipped++; return; }
            media.push({ file: f, type: mt });
        });
        if (!media.length) {
            showToast(skipped ? ('לא נמצאו קבצי מדיה נתמכים (' + skipped + ' דולגו)') : 'לא נמצאו קבצים');
            return;
        }
        uploadInProgress = true;
        _closeDialog();
        _ensureMwAnimStyle();
        var _bulkAnchor = document.getElementById('media-items-list') || document.body;
        var counts = { image: 0, audio: 0, video: 0 };
        var failed = 0, done = 0, total = media.length;
        showToast('מעלה ' + total + ' קבצים...');
        function finish() {
            uploadInProgress = false;
            var parts = [];
            if (counts.image) parts.push(counts.image + ' תמונות');
            if (counts.audio) parts.push(counts.audio + ' שמע');
            if (counts.video) parts.push(counts.video + ' וידאו');
            var msg = 'הועלו ' + done + ' קבצים' + (parts.length ? ' (' + parts.join(', ') + ')' : '');
            if (failed) msg += ' · ' + failed + ' נכשלו';
            if (skipped) msg += ' · ' + skipped + ' דולגו';
            showToast(msg);
            // Feature: sound + confetti only when at least one file succeeded
            if (done > 0) {
                _mwPlaySuccessSound();
                _mwConfettiBurst(_bulkAnchor);
            }
            loadFolders().then(function() { openFolder(parseInt(targetFolder)); }).catch(function() {
                if (currentFolder) loadFolderMedia(currentFolder);
            });
        }
        function step(i) {
            if (i >= media.length) { finish(); return; }
            var m = media[i];
            var title = m.file.name.replace(/\.[^.]+$/, '');
            showToast('מעלה ' + (i + 1) + '/' + total + ': ' + title);
            // Feature: per-file in-flight indicator
            var _bid = ++_mwUploadIdSeq;
            _mwActiveUploads.push({ id: _bid, title: title });
            _renderMwActiveUploads();
            uploadFile(m.file, title, targetFolder, m.type).then(function() {
                done++; counts[m.type] = (counts[m.type] || 0) + 1;
                _mwActiveUploads.forEach(function(u) { if (u.id === _bid) u.done = true; });
                _renderMwActiveUploads();
                setTimeout(function() {
                    _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _bid; });
                    _renderMwActiveUploads();
                }, 1800);
            }).catch(function() {
                failed++;
                _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _bid; });
                _renderMwActiveUploads();
            }).then(function() { step(i + 1); });
        }
        step(0);
    }

    function _submitUpload() {
        if (uploadInProgress) {
            showToast('העלאה כבר מתבצעת');
            return;
        }
        var title = document.getElementById('media-upload-title').value.trim();
        var fileInput = document.getElementById('media-upload-file');
        var type = document.getElementById('media-upload-type').value;
        var btn = document.getElementById('media-upload-btn');

        if (!title) { showToast('נא למלא כותרת'); return; }
        if (!fileInput.files[0]) { showToast('נא לבחור קובץ'); return; }

        var folderSelect = document.getElementById('media-upload-folder');
        var targetFolder = folderSelect && folderSelect.value
            ? parseInt(folderSelect.value)
            : (currentFolder || _getFirstNonTutorialFolder());
        if (!targetFolder) { showToast('נא לבחור תיקייה'); return; }
        var file = fileInput.files[0];

        // Pre-upload size guard — fail fast with a clear message instead of a
        // silent crash when the file exceeds the server limit.
        if (file.size > 64 * 1024 * 1024) {
            showToast('הקובץ גדול מדי (' + formatFileSize(file.size) + ') — מקסימום 64MB');
            return;
        }

        if (btn) btn.disabled = true;
        // Close dialog immediately
        uploadInProgress = true;
        // Capture confetti anchor before closing (dialog button gone after close)
        var _confettiAnchor = document.getElementById('media-items-list') || document.body;
        _closeDialog();
        showToast('הקובץ עולה...');

        // Feature: in-flight upload indicator
        _ensureMwAnimStyle();
        var _uploadId = ++_mwUploadIdSeq;
        _mwActiveUploads.push({ id: _uploadId, title: title });
        _renderMwActiveUploads();

        // Add blinking placeholder to media list
        var listEl = document.getElementById('media-items-list');
        if (listEl) {
            var icon = type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼️';
            var placeholder = document.createElement('div');
            placeholder.id = 'upload-placeholder';
            placeholder.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;border:2px dashed #0891b2;margin-bottom:6px;background:white;animation:upload-blink 1s ease-in-out infinite';
            placeholder.innerHTML = '<div style="width:60px;height:45px;background:#e0f2fe;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1.4em">' + icon + '</div>' +
                '<div style="flex:1"><div style="font-weight:bold;font-size:0.95em">' + title + '</div><div style="font-size:0.8em;color:#0891b2">מעלה...</div></div>';
            listEl.insertBefore(placeholder, listEl.firstChild);

            // Add blink animation if not exists
            if (!document.getElementById('upload-blink-style')) {
                var style = document.createElement('style');
                style.id = 'upload-blink-style';
                style.textContent = '@keyframes upload-blink { 0%,100% { opacity:1; } 50% { opacity:0.4; } }';
                document.head.appendChild(style);
            }
        }

        uploadFile(file, title, targetFolder, type).then(function() {
            uploadInProgress = false;
            var ph = document.getElementById('upload-placeholder');
            if (ph) ph.remove();
            showToast('הקובץ הועלה בהצלחה');
            // Feature: mark upload done in indicator (✓ fades after 1.8s)
            _mwActiveUploads.forEach(function(u) { if (u.id === _uploadId) u.done = true; });
            _renderMwActiveUploads();
            setTimeout(function() {
                _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
                _renderMwActiveUploads();
            }, 1800);
            // Feature: success sound + confetti
            _mwPlaySuccessSound();
            _mwConfettiBurst(_confettiAnchor);
            // Always reveal the file: refresh folders (counts) then open the
            // destination folder so the uploaded item is visible immediately —
            // fixes the "uploaded but nothing shows" bug when uploading from root
            // or into a folder other than the one being viewed.
            loadFolders().then(function() {
                if (parseInt(currentFolder) === parseInt(targetFolder)) {
                    loadFolderMedia(currentFolder);
                } else {
                    openFolder(parseInt(targetFolder));
                }
            }).catch(function() {
                if (currentFolder) loadFolderMedia(currentFolder);
            });
        }).catch(function(err) {
            uploadInProgress = false;
            if (btn) btn.disabled = false;
            // Feature: remove from in-flight indicator on error (no false success)
            _mwActiveUploads = _mwActiveUploads.filter(function(u) { return u.id !== _uploadId; });
            _renderMwActiveUploads();
            var ph = document.getElementById('upload-placeholder');
            if (ph) {
                ph.style.borderColor = '#ef4444';
                var msgEl = ph.querySelector('div:last-child div:last-child');
                if (msgEl) msgEl.textContent = 'שגיאה: ' + err.message;
            }
            showToast('שגיאה: ' + err.message);
        });
    }

    function showNewFolderDialog() {
        _closeAllDialogs();
        var overlay = document.createElement('div');
        overlay.id = 'media-dialog-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:16px;padding:24px;width:90%;max-width:360px;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,0.3)';

        dialog.innerHTML =
            '<h3 style="margin:0 0 16px;color:#1f2937;font-size:1.1em">📂 תיקייה חדשה</h3>' +
            '<input type="text" id="new-folder-name-input" placeholder="שם התיקייה..." style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid #e5e7eb;font-size:1em;direction:rtl;box-sizing:border-box;outline:none;transition:border-color 0.2s" onfocus="this.style.borderColor=\'#0891b2\'" onblur="this.style.borderColor=\'#e5e7eb\'" />' +
            '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-start">' +
                '<button id="new-folder-create-btn" style="padding:8px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#0d9488,#0891b2);color:white;font-weight:bold;cursor:pointer;font-size:0.95em">צור תיקייה</button>' +
                '<button id="new-folder-cancel-btn" style="padding:8px 16px;border-radius:10px;border:1px solid #d1d5db;background:white;color:#6b7280;cursor:pointer;font-size:0.95em">ביטול</button>' +
            '</div>';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        var input = document.getElementById('new-folder-name-input');
        input.focus();

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') document.getElementById('new-folder-create-btn').click();
            if (e.key === 'Escape') overlay.remove();
        });

        document.getElementById('new-folder-cancel-btn').addEventListener('click', function() { overlay.remove(); });

        document.getElementById('new-folder-create-btn').addEventListener('click', function() {
            var name = input.value.trim();
            if (!name) { input.style.borderColor = '#dc2626'; return; }
            overlay.remove();
            apiCall('create_folder', {
                name: name,
                parent_id: currentFolder
            }).then(function() {
                showToast('התיקייה נוצרה');
                return loadFolders();
            }).then(function() {
                var root = document.getElementById('media-storage-root');
                if (root) renderFolderView(root);
            }).catch(function(err) {
                showToast('שגיאה: ' + err.message);
            });
        });
    }

    function showMoveDialog(mediaId, currentFolderId) {
        // Show folder picker to move media
        var overlay = document.createElement('div');
        overlay.id = 'media-dialog-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;width:90%;max-width:400px;direction:rtl;max-height:70vh;overflow-y:auto';

        var html = '<h3 style="margin:0 0 16px;color:#1f2937">↗ העבר לתיקייה</h3>';
        var effectiveCurrent = (typeof currentFolderId !== 'undefined' && currentFolderId !== null) ? currentFolderId : currentFolder;

        // Build flat folder list with indentation
        var tree = buildFolderTree(null, 0);
        tree.forEach(function(item) {
            var indent = item.level * 20;
            var isCurrent = item.id === effectiveCurrent;
            html += '<div onclick="MediaStorage._moveToFolder(' + mediaId + ',' + item.id + ')" style="padding:8px 12px;margin:2px 0;border-radius:6px;cursor:pointer;margin-right:' + indent + 'px;' + (isCurrent ? 'background:#e0f2fe;font-weight:bold' : 'background:#f9fafb') + ';transition:background 0.2s" onmouseover="this.style.background=\'#e0f2fe\'" onmouseout="this.style.background=\'' + (isCurrent ? '#e0f2fe' : '#f9fafb') + '\'">';
            html += '📁 ' + item.name;
            if (isCurrent) html += ' (נוכחית)';
            html += '</div>';
        });

        html += '<div style="margin-top:12px;text-align:center"><button onclick="MediaStorage._closeDialog()" style="padding:8px 20px;border-radius:8px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;cursor:pointer">ביטול</button></div>';

        dialog.innerHTML = html;
        overlay.appendChild(dialog);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) _closeDialog(); });
        document.body.appendChild(overlay);
    }

    function buildFolderTree(parentId, level) {
        var result = [];
        var children = getChildFolders(parentId);
        children.forEach(function(f) {
            result.push({ id: parseInt(f.id), name: f.name, level: level });
            var sub = buildFolderTree(parseInt(f.id), level + 1);
            result = result.concat(sub);
        });
        return result;
    }

    function _moveToFolder(mediaId, folderId) {
        if (guardUploadInProgress()) return;
        apiCall('move_media', { id: mediaId, folder_id: folderId }).then(function() {
            _closeDialog();
            showToast('הפריט הועבר');
            if (currentFolder) loadFolderMedia(currentFolder);
        }).catch(function(err) {
            showToast('שגיאה: ' + err.message);
        });
    }

    function confirmDeleteMedia(mediaId, title) {
        if (guardUploadInProgress()) return;
        if (!confirm('למחוק את "' + title + '"?')) return;
        apiCall('delete_media', { id: mediaId }).then(function() {
            showToast('נמחק');
            if (currentFolder) loadFolderMedia(currentFolder);
        }).catch(function(err) {
            showToast('שגיאה: ' + err.message);
        });
    }

    function _closeDialog() {
        var overlay = document.getElementById('media-dialog-overlay');
        if (overlay) overlay.remove();
    }

    function _getFirstNonTutorialFolder() {
        var f = folders.find(function(f) { return f.name !== TUTORIAL_FOLDER && (!f.parent_id || f.parent_id === '0'); });
        return f ? parseInt(f.id) : null;
    }

    // ---- Search ----

    var searchTimeout = null;
    function handleSearch(query) {
        clearTimeout(searchTimeout);
        if (!query || query.length < 2) {
            if (currentFolder) loadFolderMedia(currentFolder);
            return;
        }
        searchTimeout = setTimeout(function() {
            var listEl = document.getElementById('media-items-list');
            if (!listEl) return;
            listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#6b7280">מחפש...</div>';
            apiCall('search', { query: query }).then(function(data) {
                var items = data.items || [];
                if (items.length === 0) {
                    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af">לא נמצאו תוצאות</div>';
                    return;
                }
                renderMediaItems(listEl, items);
            }).catch(function(err) {
                if (err && err.authRequired) return;
                listEl.innerHTML = '<div style="color:#ef4444;padding:12px">שגיאה: ' + err.message + '</div>';
            });
        }, 300);
    }

    // ---- Media playback ----

    function playMedia(item) {
        var isAudio = item.media_type === 'audio' || (item.url && /\.(mp3|wav|ogg|m4a|aac|flac|wma)(\?|$)/i.test(item.url));
        var isVideo = item.media_type === 'video' || (item.url && /\.(mp4|webm|ogv)(\?|$)/i.test(item.url));
        var ytId = item.url ? extractYouTubeId(item.url) : null;
        var isImageUrl = item.url && /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(item.url);

        if (isAudio) {
            _showFloatingPlayer(item, 'audio');
        } else if (ytId) {
            // YouTube — floating player in audio-first mode
            _showFloatingPlayer(item, 'youtube');
        } else if (isVideo) {
            // Direct video — floating player, default audio-only mode
            _showFloatingPlayer(item, 'video');
        } else if (item.media_type === 'image' || (!item.media_type && isImageUrl)) {
            _showFloatingImage(item);
        } else {
            _showFloatingPlayer(item, 'audio');
        }
    }

    function _showFloatingImage(item) {
        // Remove existing floating image/player
        var oldImg = document.getElementById('media-floating-image');
        if (oldImg) oldImg.remove();
        var oldPlayer = document.getElementById('media-floating-player');
        if (oldPlayer) {
            var oldMedia = oldPlayer.querySelector('audio, video');
            if (oldMedia) oldMedia.pause();
            oldPlayer.remove();
        }
        _closePlayer(false);

        var floater = document.createElement('div');
        floater.id = 'media-floating-image';
        floater.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:10001;width:160px;background:white;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.25);padding:8px;cursor:grab;user-select:none;border:2px solid #0891b2';

        floater.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
                '<span style="font-size:0.75em;font-weight:bold;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;direction:rtl">🖼️ ' + (item.title || '') + '</span>' +
                '<button id="fi-close" style="background:none;border:none;font-size:1em;cursor:pointer;color:#6b7280;padding:0 2px;flex-shrink:0">✕</button>' +
            '</div>' +
            '<img id="fi-thumb" src="' + _absUrl(item.url) + '" style="width:100%;border-radius:8px;cursor:pointer;display:block" />';

        document.body.appendChild(floater);

        // Click image → full-screen dialog
        document.getElementById('fi-thumb').addEventListener('click', function(e) {
            e.stopPropagation();
            _showImageFullscreen(item, floater);
        });

        // Close button
        document.getElementById('fi-close').addEventListener('click', function(e) {
            e.stopPropagation();
            floater.remove();
        });

        // Drag support (mouse)
        var isDragging = false, startX, startY, origLeft, origTop;
        floater.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'IMG') return;
            isDragging = true;
            floater.style.cursor = 'grabbing';
            startX = e.clientX; startY = e.clientY;
            var rect = floater.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            floater.style.left = (origLeft + e.clientX - startX) + 'px';
            floater.style.top = (origTop + e.clientY - startY) + 'px';
            floater.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function() {
            if (isDragging) { isDragging = false; floater.style.cursor = 'grab'; }
        });
        // Touch drag
        floater.addEventListener('touchstart', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            // If touching the image, don't start drag — let click handle it
            if (e.target.tagName === 'IMG') return;
            isDragging = true;
            var t = e.touches[0];
            startX = t.clientX; startY = t.clientY;
            var rect = floater.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
        }, {passive: true});
        document.addEventListener('touchmove', function(e) {
            if (!isDragging) return;
            var t = e.touches[0];
            floater.style.left = (origLeft + t.clientX - startX) + 'px';
            floater.style.top = (origTop + t.clientY - startY) + 'px';
            floater.style.bottom = 'auto';
        }, {passive: true});
        document.addEventListener('touchend', function() { isDragging = false; });
    }

    function _showImageFullscreen(item, floater) {
        // Hide floater while fullscreen is shown
        floater.style.display = 'none';

        var overlay = document.createElement('div');
        overlay.id = 'media-image-fullscreen';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer';

        var container = document.createElement('div');
        container.style.cssText = 'max-width:90vw;max-height:90vh;position:relative';
        container.addEventListener('click', function(e) { e.stopPropagation(); });

        var img = document.createElement('img');
        img.src = _absUrl(item.url);
        img.style.cssText = 'max-width:90vw;max-height:85vh;object-fit:contain;border-radius:12px;display:block';

        var title = document.createElement('div');
        title.style.cssText = 'text-align:center;color:white;font-size:0.9em;margin-top:8px;direction:rtl';
        title.textContent = item.title || '';

        container.appendChild(img);
        container.appendChild(title);
        overlay.appendChild(container);

        // Click outside → return to floating
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                overlay.remove();
                floater.style.display = '';
            }
        });

        // Escape key → return to floating
        var escHandler = function(e) {
            if (e.key === 'Escape') {
                overlay.remove();
                floater.style.display = '';
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(overlay);
    }

    var _fpKeyHandler = null;

    function _showFloatingPlayer(item, mode) {
        // Remove existing floating player and floating image
        var old = document.getElementById('media-floating-player');
        if (old) {
            var oldMedia = old.querySelector('audio, video');
            if (oldMedia) oldMedia.pause();
            old.remove();
        }
        var oldImg = document.getElementById('media-floating-image');
        if (oldImg) oldImg.remove();
        _closePlayer(false);
        if (_fpKeyHandler) { document.removeEventListener('keydown', _fpKeyHandler); _fpKeyHandler = null; }

        var isVideo = (mode === 'video');
        var isYoutube = (mode === 'youtube');
        var hasVideo = isVideo || isYoutube;
        var ytId = isYoutube ? extractYouTubeId(item.url) : null;

        var player = document.createElement('div');
        player.id = 'media-floating-player';
        player.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:10001;width:320px;background:white;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.25);padding:12px 14px;direction:rtl;cursor:grab;user-select:none;border:2px solid #0891b2';

        // Video area (hidden by default for video items — audio-first mode)
        var videoHtml = '';
        if (isVideo) {
            videoHtml = '<div id="fp-video-area" style="display:none;margin-bottom:8px;border-radius:8px;overflow:hidden">' +
                '<video id="fp-video" style="width:100%;max-height:200px;border-radius:8px" playsinline></video>' +
                '</div>';
        } else if (isYoutube) {
            // Load iframe immediately but tiny/hidden — audio plays from YouTube, toggling to video makes it full-size
            videoHtml = '<div id="fp-video-area" style="height:1px;overflow:hidden;opacity:0;margin:0">' +
                '<iframe id="fp-yt-iframe" width="1" height="1" src="https://www.youtube.com/embed/' + ytId + '?autoplay=1&enablejsapi=1&origin=' + encodeURIComponent(location.origin) + '" frameborder="0" allow="autoplay;encrypted-media" allowfullscreen style="border-radius:8px"></iframe>' +
                '</div>';
        }

        // For YouTube: create a proxy object so controls can talk to iframe via postMessage
        var ytProxy = null;
        if (isYoutube && ytId) {
            ytProxy = {
                _iframe: null,
                _playing: false,
                _msgHandler: null,
                paused: true,
                currentTime: 0,
                duration: 0,
                volume: 1,
                _cmd: function(func, args) {
                    if (!this._iframe) this._iframe = document.getElementById('fp-yt-iframe');
                    if (!this._iframe || !this._iframe.contentWindow) return;
                    this._iframe.contentWindow.postMessage(JSON.stringify({event:'command', func:func, args:args||[]}), '*');
                },
                _listen: function() {
                    var self = this;
                    self._msgHandler = function(e) {
                        if (!document.getElementById('media-floating-player')) {
                            window.removeEventListener('message', self._msgHandler);
                            return;
                        }
                        var data;
                        try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch(x) { return; }
                        if (!data || !data.event) return;
                        var info = data.info || {};
                        // Get duration from any delivery
                        if (info.duration && info.duration > 0 && self.duration !== info.duration) {
                            self.duration = info.duration;
                            var durEl = document.getElementById('fp-duration');
                            if (durEl) durEl.textContent = _formatTime(self.duration);
                        }
                        // Get current time from infoDelivery
                        if (typeof info.currentTime === 'number') {
                            self.currentTime = info.currentTime;
                            var progEl = document.getElementById('fp-progress');
                            var curEl = document.getElementById('fp-current');
                            if (progEl && self.duration) progEl.style.width = (self.currentTime / self.duration * 100) + '%';
                            if (curEl) curEl.textContent = _formatTime(self.currentTime);
                        }
                        // State changes: 1=playing, 2=paused, 0=ended
                        if (data.event === 'onStateChange') {
                            if (info === 1) { self.paused = false; self._playing = true; }
                            else if (info === 2 || info === 0) { self.paused = true; self._playing = false; }
                        }
                    };
                    window.addEventListener('message', self._msgHandler);
                },
                _initListening: function() {
                    // Tell YouTube iframe to start sending events
                    var self = this;
                    setTimeout(function() {
                        self._cmd('addEventListener', ['onStateChange']);
                        // Request info delivery for currentTime updates
                        if (self._iframe && self._iframe.contentWindow) {
                            self._iframe.contentWindow.postMessage(JSON.stringify({event:'listening'}), '*');
                        }
                    }, 1000);
                },
                _stopListening: function() {
                    if (this._msgHandler) {
                        window.removeEventListener('message', this._msgHandler);
                        this._msgHandler = null;
                    }
                },
                play: function() {
                    this._cmd('playVideo');
                    this.paused = false;
                    this._playing = true;
                },
                pause: function() {
                    this._cmd('pauseVideo');
                    this.paused = true;
                    this._playing = false;
                },
                seekTo: function(t) {
                    this._cmd('seekTo', [t, true]);
                    this.currentTime = t;
                    var progEl = document.getElementById('fp-progress');
                    if (progEl && this.duration) progEl.style.width = (t / this.duration * 100) + '%';
                    var curEl = document.getElementById('fp-current');
                    if (curEl) curEl.textContent = _formatTime(t);
                },
                setPlaybackRate: function(r) {
                    this._cmd('setPlaybackRate', [r]);
                    this.playbackRate = r;
                }
            };
            // Start listening for YouTube messages immediately
            ytProxy._listen();
        }

        // Toggle button for video items
        var toggleHtml = '';
        if (hasVideo) {
            toggleHtml = '<button id="fp-mode-toggle" style="width:100%;margin-top:6px;padding:6px 10px;border:2px solid #6366f1;border-radius:8px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);color:#4338ca;font-size:0.85em;font-weight:bold;cursor:pointer;direction:rtl">🎬 עבור לוידאו</button>';
        }

        player.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
                '<span style="font-size:0.85em;font-weight:bold;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">🎵 ' + (item.title || '') + '</span>' +
                '<button id="fp-close" style="background:none;border:none;font-size:1.1em;cursor:pointer;color:#6b7280;padding:0 4px">✕</button>' +
            '</div>' +
            videoHtml +
            '<div style="direction:ltr">' +
                '<div style="background:#e5e7eb;border-radius:6px;height:18px;cursor:pointer;position:relative" id="fp-track">' +
                    '<div id="fp-progress" style="background:#0891b2;height:100%;border-radius:6px;width:0%;transition:width 0.1s"></div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;margin-top:6px">' +
                    '<button id="fp-play" style="width:32px;height:32px;border-radius:50%;border:2px solid #0891b2;background:white;color:#0891b2;font-size:1em;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>' +
                    '<button id="fp-vol-down" style="width:24px;height:24px;border-radius:50%;border:1px solid #d1d5db;background:white;color:#6b7280;font-size:0.7em;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center" title="החלש">🔉</button>' +
                    '<button id="fp-vol-up" style="width:24px;height:24px;border-radius:50%;border:1px solid #d1d5db;background:white;color:#6b7280;font-size:0.7em;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center" title="הגבר">🔊</button>' +
                    '<button id="fp-speed-down" title="האט 0.1×" style="width:22px;height:22px;border-radius:50%;border:1px solid #d1d5db;background:white;color:#374151;font-size:0.8em;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">−</button>' +
                    '<button id="fp-speed-display" title="לחץ לאיפוס מהירות ל-1.0×" aria-label="לחץ לאיפוס מהירות ל-1.0×" style="width:4ch;min-width:4ch;height:22px;border-radius:6px;border:1px solid #d1d5db;background:white;color:#374151;font-size:0.72em;cursor:pointer;flex-shrink:0;padding:0;font-variant-numeric:tabular-nums;font-family:inherit;text-align:center">1.0×</button>' +
                    '<button id="fp-speed-up" title="האץ 0.1×" style="width:22px;height:22px;border-radius:50%;border:1px solid #d1d5db;background:white;color:#374151;font-size:0.8em;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">+</button>' +
                    '<span style="flex:1"></span>' +
                    '<span id="fp-current" style="font-size:0.75em;color:#6b7280">0:00</span>' +
                    '<span style="font-size:0.75em;color:#d1d5db">/</span>' +
                    '<span id="fp-duration" style="font-size:0.75em;color:#6b7280">0:00</span>' +
                '</div>' +
            '</div>' +
            '<div style="text-align:center;margin-top:4px;font-size:0.75em;color:#9ca3af">מספרים לדילוג | 0 להפסקה/הפעלה</div>' +
            toggleHtml;

        document.body.appendChild(player);

        // Create audio element programmatically (innerHTML can break with special chars in URLs)
        var audioEl = null;
        if (!isYoutube && item.url) {
            audioEl = document.createElement('audio');
            audioEl.id = 'fp-audio';
            audioEl.src = _absUrl(item.url);
            audioEl.preload = 'auto';
            player.appendChild(audioEl);
        }
        var videoEl = isVideo ? document.getElementById('fp-video') : null;
        var fp = { media: audioEl || (isYoutube ? ytProxy : null) };
        if (isVideo && videoEl) {
            videoEl.src = _absUrl(item.url);
            videoEl.preload = 'auto';
        }

        var playBtn = document.getElementById('fp-play');

        // Shared handlers — read from fp.media (always current)
        function _fpUpdate() {
            var m = fp.media;
            var progEl = document.getElementById('fp-progress');
            var curEl = document.getElementById('fp-current');
            if (progEl && m && m.duration) progEl.style.width = (m.currentTime / m.duration * 100) + '%';
            if (curEl && m) curEl.textContent = _formatTime(m.currentTime);
        }
        function _fpMeta() {
            var m = fp.media;
            var durEl = document.getElementById('fp-duration');
            if (durEl && m) durEl.textContent = _formatTime(m.duration);
        }
        function _fpEnded() { if (playBtn) playBtn.textContent = '▶'; }

        // Bind events to both elements — handler reads fp.media for active source
        if (audioEl) {
            audioEl.addEventListener('loadedmetadata', _fpMeta);
            audioEl.addEventListener('timeupdate', _fpUpdate);
            audioEl.addEventListener('ended', _fpEnded);
        }
        if (videoEl) {
            videoEl.addEventListener('loadedmetadata', _fpMeta);
            videoEl.addEventListener('timeupdate', _fpUpdate);
            videoEl.addEventListener('ended', _fpEnded);
        }

        if (audioEl || isYoutube) {
            playBtn.addEventListener('click', function() {
                var m = fp.media;
                if (!m) return;
                if (m.paused) { m.play(); playBtn.textContent = '⏸'; }
                else { m.pause(); playBtn.textContent = '▶'; }
            });

            document.getElementById('fp-track').addEventListener('click', function(e) {
                var m = fp.media;
                if (!m || !m.duration) return;
                var rect = this.getBoundingClientRect();
                var newTime = ((e.clientX - rect.left) / rect.width) * m.duration;
                if (m.seekTo) { m.seekTo(newTime); } else { m.currentTime = newTime; }
            });

            // Playback speed
            var _fpSpeed = 1;
            function _applySpeed(m, rate) {
                if (!m) return;
                if (m.setPlaybackRate) m.setPlaybackRate(rate);
                else m.playbackRate = rate;
            }
            var speedMin = 0.1, speedMax = 3.0, speedStep = 0.1;
            var speedDisplay = document.getElementById('fp-speed-display');
            var speedDown = document.getElementById('fp-speed-down');
            var speedUp = document.getElementById('fp-speed-up');
            function _fmtSpeed(r) {
                var rounded = Math.round(r * 10) / 10;
                return rounded.toFixed(1) + '×';
            }
            function _setSpeed(newRate) {
                newRate = Math.round(newRate * 10) / 10;
                if (newRate < speedMin) newRate = speedMin;
                if (newRate > speedMax) newRate = speedMax;
                _fpSpeed = newRate;
                _applySpeed(fp.media, _fpSpeed);
                if (speedDisplay) speedDisplay.textContent = _fmtSpeed(_fpSpeed);
                if (speedDown) speedDown.disabled = (_fpSpeed <= speedMin + 0.0001);
                if (speedUp) speedUp.disabled = (_fpSpeed >= speedMax - 0.0001);
            }
            if (speedDown) speedDown.addEventListener('click', function() { _setSpeed(_fpSpeed - speedStep); });
            if (speedUp) speedUp.addEventListener('click', function() { _setSpeed(_fpSpeed + speedStep); });
            if (speedDisplay) speedDisplay.addEventListener('click', function() { _setSpeed(1); });
            _setSpeed(_fpSpeed);
            fp._applySpeed = function() { _applySpeed(fp.media, _fpSpeed); };

            // Volume controls
            document.getElementById('fp-vol-up').addEventListener('click', function() {
                if (!fp.media) return;
                var newVol = Math.min(1, (fp.media.volume || 0) + 0.1);
                fp.media.volume = newVol;
                if (fp.media._cmd) fp.media._cmd('setVolume', [Math.round(newVol * 100)]);
            });
            document.getElementById('fp-vol-down').addEventListener('click', function() {
                if (!fp.media) return;
                var curVol = fp.media.volume != null ? fp.media.volume : 1;
                var newVol = Math.max(0, curVol - 0.1);
                fp.media.volume = newVol;
                if (fp.media._cmd) fp.media._cmd('setVolume', [Math.round(newVol * 100)]);
            });

            // Keyboard controls — number keys for seeking
            _fpKeyHandler = function(e) {
                var m = fp.media;
                if (!document.getElementById('media-floating-player') || !m) { document.removeEventListener('keydown', _fpKeyHandler); return; }
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
                if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard.isActive()) return;
                var numMap = {'5': -1, '4': -4, '9': -7, '8': -10, '6': 1, '1': 4, '2': 7, '3': 10};
                var delta = numMap[e.key];
                if (delta !== undefined) {
                    e.preventDefault();
                    var newTime = Math.max(0, Math.min(m.duration || 9999, m.currentTime + delta));
                    if (m.seekTo) { m.seekTo(newTime); } else { m.currentTime = newTime; }
                    return;
                }
                if (e.key === '0') {
                    e.preventDefault();
                    if (m.paused) { m.play(); playBtn.textContent = '⏸'; }
                    else { m.pause(); playBtn.textContent = '▶'; }
                }
            };
            document.addEventListener('keydown', _fpKeyHandler);

            // Close button
            document.getElementById('fp-close').addEventListener('click', function() {
                if (fp.media) fp.media.pause();
                if (fp.media && fp.media._stopListening) fp.media._stopListening();
                if (videoEl) videoEl.pause();
                if (audioEl) audioEl.pause();
                if (_fpKeyHandler) { document.removeEventListener('keydown', _fpKeyHandler); _fpKeyHandler = null; }
                player.remove();
            });

            if (audioEl) {
                audioEl.play();
                playBtn.textContent = '⏸';
            }
            // For YouTube: iframe is already loaded — init listening for duration/time
            if (isYoutube && ytProxy) {
                ytProxy._initListening();
                playBtn.textContent = '⏸'; // YouTube autoplay is on
            }
        }

        // YouTube focus-capture hint — show button when iframe has focus
        if (isYoutube) {
            var focusHint = document.createElement('button');
            focusHint.id = 'fp-focus-hint';
            focusHint.textContent = '⌨️ שקלט באמצעות המספרים!';
            focusHint.style.cssText = 'display:none;width:100%;margin-top:6px;padding:8px 10px;border:2px solid #f59e0b;border-radius:8px;background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#92400e;font-size:0.85em;font-weight:bold;cursor:pointer;direction:rtl;animation:lp-media-pulse 1.5s ease-in-out infinite';
            focusHint.addEventListener('click', function(e) {
                e.stopPropagation();
                // Steal focus back from iframe
                focusHint.style.display = 'none';
                document.body.focus();
            });
            player.appendChild(focusHint);

            // Detect when iframe steals focus (document.hasFocus() stays true for same-page iframes,
            // so check if activeElement is the iframe instead)
            var _focusCheckInterval = setInterval(function() {
                if (!document.getElementById('media-floating-player')) {
                    clearInterval(_focusCheckInterval);
                    return;
                }
                var videoArea = document.getElementById('fp-video-area');
                var iframeVisible = videoArea && videoArea.style.display !== 'none';
                var iframe = document.getElementById('fp-yt-iframe');
                var iframeFocused = iframe && document.activeElement === iframe;
                if (iframeVisible && iframeFocused) {
                    focusHint.style.display = '';
                } else {
                    focusHint.style.display = 'none';
                }
            }, 500);
        }

        // Video/audio mode toggle — sync between audio and video elements
        if (hasVideo) {
            var toggleBtn = document.getElementById('fp-mode-toggle');
            var videoArea = document.getElementById('fp-video-area');
            var showingVideo = false;

            toggleBtn.addEventListener('click', function() {
                showingVideo = !showingVideo;
                if (showingVideo) {
                    videoArea.style.display = 'block';
                    toggleBtn.textContent = '🎵 עבור לשמע';
                    toggleBtn.style.borderColor = '#0891b2';
                    toggleBtn.style.color = '#0891b2';
                    toggleBtn.style.background = 'linear-gradient(135deg,#ecfeff,#cffafe)';
                    if (isVideo && videoEl && audioEl) {
                        var curTime = audioEl.currentTime;
                        var wasPlaying = !audioEl.paused;
                        audioEl.pause();
                        videoEl.currentTime = curTime;
                        fp.media = videoEl;
                        if (wasPlaying) { videoEl.play(); playBtn.textContent = '⏸'; }
                    } else if (isYoutube && ytId) {
                        // Expand iframe to full size
                        var iframe = document.getElementById('fp-yt-iframe');
                        if (iframe) { iframe.width = '100%'; iframe.height = '180'; }
                        videoArea.style.cssText = 'margin-bottom:8px;border-radius:8px;overflow:hidden';
                        fp.media = ytProxy;
                    }
                    if (fp._applySpeed) fp._applySpeed();
                } else {
                    if (isYoutube) {
                        // Shrink iframe back to tiny (keep playing audio)
                        var iframe = document.getElementById('fp-yt-iframe');
                        if (iframe) { iframe.width = '1'; iframe.height = '1'; }
                        videoArea.style.cssText = 'height:1px;overflow:hidden;opacity:0;margin:0';
                    } else {
                        videoArea.style.display = 'none';
                    }
                    toggleBtn.textContent = '🎬 עבור לוידאו';
                    toggleBtn.style.borderColor = '#6366f1';
                    toggleBtn.style.color = '#4338ca';
                    toggleBtn.style.background = 'linear-gradient(135deg,#eef2ff,#e0e7ff)';
                    if (isVideo && videoEl && audioEl) {
                        var curTime = videoEl.currentTime;
                        var wasPlaying = !videoEl.paused;
                        videoEl.pause();
                        audioEl.currentTime = curTime;
                        fp.media = audioEl;
                        if (wasPlaying) { audioEl.play(); playBtn.textContent = '⏸'; }
                    }
                    if (fp._applySpeed) fp._applySpeed();
                }
            });
        }

        // Drag support
        var isDragging = false, startX, startY, origLeft, origTop;
        player.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION' || e.target.tagName === 'IFRAME' || e.target.id === 'fp-track') return;
            isDragging = true;
            player.style.cursor = 'grabbing';
            startX = e.clientX; startY = e.clientY;
            var rect = player.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            player.style.left = (origLeft + e.clientX - startX) + 'px';
            player.style.top = (origTop + e.clientY - startY) + 'px';
            player.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function() {
            isDragging = false;
            player.style.cursor = 'grab';
        });
        // Touch drag
        player.addEventListener('touchstart', function(e) {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION' || e.target.tagName === 'IFRAME') return;
            isDragging = true;
            var t = e.touches[0];
            startX = t.clientX; startY = t.clientY;
            var rect = player.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
        }, {passive: true});
        document.addEventListener('touchmove', function(e) {
            if (!isDragging) return;
            var t = e.touches[0];
            player.style.left = (origLeft + t.clientX - startX) + 'px';
            player.style.top = (origTop + t.clientY - startY) + 'px';
            player.style.bottom = 'auto';
        }, {passive: true});
        document.addEventListener('touchend', function() { isDragging = false; });
    }

    function _showMediaPlayer(contentHtml, title) {
        var overlay = document.createElement('div');
        overlay.id = 'media-player-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';

        var container = document.createElement('div');
        container.style.cssText = 'background:white;border-radius:12px;padding:16px;width:90%;max-width:640px;direction:rtl';

        container.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
            '<h3 style="margin:0;font-size:1.1em;color:#1f2937">' + (title || '') + '</h3>' +
            '<button onclick="MediaStorage._closePlayer()" style="background:none;border:none;font-size:1.3em;cursor:pointer;color:#6b7280">✕</button>' +
            '</div>' +
            '<div>' + contentHtml + '</div>';

        overlay.appendChild(container);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) _closePlayer(); });
        document.body.appendChild(overlay);
    }

    // Saved player state for persistence across tab switches
    var _playerState = null;

    function _savePlayerState() {
        var audio = document.getElementById('media-audio-el');
        if (!audio) return;
        _playerState = {
            url: audio.src,
            title: (document.querySelector('#media-audio-inline span') || {}).textContent || '',
            currentTime: audio.currentTime,
            paused: audio.paused
        };
    }

    function _restorePlayer() {
        if (!_playerState) return false;
        _showAudioPlayer({ url: _playerState.url, title: _playerState.title }, _playerState.currentTime);
        _playerState = null;
        return true;
    }

    function _showAudioPlayer(item, restoreTime) {
        // Close any existing inline player
        _closePlayer();

        // Inline audio player — compact, at top of media section
        var player = document.createElement('div');
        player.id = 'media-audio-inline';
        player.style.cssText = 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;margin:8px 0;direction:rtl;position:relative';

        player.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
                '<span style="font-size:0.9em;font-weight:bold;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + (item.title || '') + '</span>' +
                '<button onclick="MediaStorage._closePlayer()" style="background:none;border:none;font-size:1.1em;cursor:pointer;color:#6b7280;padding:0 4px">✕</button>' +
            '</div>' +
            '<audio id="media-audio-el" src="' + _absUrl(item.url) + '" preload="auto"></audio>' +
            '<div style="direction:ltr">' +
                '<div style="background:#e5e7eb;border-radius:4px;height:10px;cursor:pointer;position:relative" id="media-audio-track" onclick="MediaStorage._seekAudio(event)">' +
                    '<div id="media-audio-progress" style="background:#0891b2;height:100%;border-radius:4px;width:0%;transition:width 0.1s"></div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:8px;margin-top:6px">' +
                    '<button id="media-audio-play" onclick="MediaStorage._toggleAudio()" style="width:32px;height:32px;border-radius:50%;border:2px solid #0891b2;background:white;color:#0891b2;font-size:1em;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>' +
                    '<button onclick="MediaStorage._volDown()" style="width:24px;height:24px;border-radius:50%;border:1px solid #d1d5db;background:white;color:#6b7280;font-size:0.7em;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center" title="החלש">🔉</button>' +
                    '<button onclick="MediaStorage._volUp()" style="width:24px;height:24px;border-radius:50%;border:1px solid #d1d5db;background:white;color:#6b7280;font-size:0.7em;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center" title="הגבר">🔊</button>' +
                    '<span style="flex:1"></span>' +
                    '<span id="media-audio-current" style="font-size:0.75em;color:#6b7280">0:00</span>' +
                    '<span style="font-size:0.75em;color:#d1d5db">/</span>' +
                    '<span id="media-audio-duration" style="font-size:0.75em;color:#6b7280">0:00</span>' +
                '</div>' +
            '</div>' +
            '<div style="text-align:center;margin-top:4px;font-size:0.75em;color:#9ca3af">מספרים לדילוג | 0 להפסקה/הפעלה</div>' +
            '<button id="media-numctl-btn" style="display:none;width:100%;margin:6px auto 0;padding:8px 12px;border:2px solid #6366f1;border-radius:8px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);color:#4338ca;font-size:0.9em;font-weight:bold;cursor:pointer;direction:rtl">🔢 חזור לשקלט בעזרת המספרים</button>';

        // Insert at top of the media tab content, or dict results
        var target = document.querySelector('.dict-media-tab-content') ||
                     document.getElementById('media-section') ||
                     document.getElementById('lp-dict-results') ||
                     document.getElementById('dict-results');
        if (target) {
            target.insertBefore(player, target.firstChild);
        } else {
            // Fallback: fixed position at top-left
            player.style.cssText += ';position:fixed;top:10px;left:10px;z-index:10000;width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
            document.body.appendChild(player);
        }

        // Setup audio controls
        var audio = document.getElementById('media-audio-el');
        if (audio) {
            audio.addEventListener('loadedmetadata', function() {
                document.getElementById('media-audio-duration').textContent = _formatTime(audio.duration);
                // Restore position if resuming
                if (restoreTime && restoreTime > 0) {
                    audio.currentTime = restoreTime;
                }
            });
            audio.addEventListener('timeupdate', function() {
                var pct = (audio.currentTime / audio.duration) * 100;
                document.getElementById('media-audio-progress').style.width = pct + '%';
                document.getElementById('media-audio-current').textContent = _formatTime(audio.currentTime);
            });
            audio.addEventListener('ended', function() {
                document.getElementById('media-audio-play').textContent = '▶';
            });

            // Keyboard controls
            document.addEventListener('keydown', _audioKeyHandler);

            // "Switch to seek mode" button — one-way: hides DK, enables number seeking
            var numBtn = document.getElementById('media-numctl-btn');
            if (numBtn) {
                // Show only when DK is active
                var _syncNumBtn = function(e) {
                    numBtn.style.display = e.detail.active ? 'block' : 'none';
                };
                document.addEventListener('dk-toggle', _syncNumBtn);
                if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard.isActive()) {
                    numBtn.style.display = 'block';
                }
                numBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
                numBtn.addEventListener('click', function() {
                    if (typeof DiacriticsKeyboard === 'undefined') return;
                    // Deactivate DK — switch fully to seek mode
                    DiacriticsKeyboard.deactivate();
                    numBtn.style.display = 'none';
                });
                numBtn._cleanup = function() {
                    document.removeEventListener('dk-toggle', _syncNumBtn);
                };
            }
        }
    }

    var _audioKeyHandler = function(e) {
        var audio = document.getElementById('media-audio-el');
        if (!audio) return;
        // DK has priority over audio seeking — when DK is active, don't intercept number keys
        if (typeof DiacriticsKeyboard !== 'undefined' && DiacriticsKeyboard.isActive()) return;
        // Number keys for seeking: 5/4/9/8 backward, 6/1/2/3 forward, 0/space play/pause
        var numMap = {'5': -1, '4': -4, '9': -7, '8': -10, '6': 1, '1': 4, '2': 7, '3': 10};
        var delta = numMap[e.key];
        if (delta !== undefined) {
            e.preventDefault();
            audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
            return;
        }
        if (e.key === '0') { e.preventDefault(); _toggleAudio(); }
    };

    function _toggleAudio() {
        var audio = document.getElementById('media-audio-el');
        var btn = document.getElementById('media-audio-play');
        if (!audio) return;
        if (audio.paused) { audio.play(); btn.textContent = '⏸'; }
        else { audio.pause(); btn.textContent = '▶'; }
    }

    function _volUp() {
        var audio = document.getElementById('media-audio-el');
        if (audio) audio.volume = Math.min(1, audio.volume + 0.1);
    }
    function _volDown() {
        var audio = document.getElementById('media-audio-el');
        if (audio) audio.volume = Math.max(0, audio.volume - 0.1);
    }

    function _seekAudio(e) {
        var audio = document.getElementById('media-audio-el');
        var track = document.getElementById('media-audio-track');
        if (!audio || !track) return;
        var rect = track.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        audio.currentTime = pct * audio.duration;
    }

    function _formatTime(sec) {
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _closePlayer(saveState) {
        if (saveState !== false) _savePlayerState();
        document.removeEventListener('keydown', _audioKeyHandler);
        var numBtn = document.getElementById('media-numctl-btn');
        if (numBtn && numBtn._cleanup) numBtn._cleanup();
        var overlay = document.getElementById('media-player-overlay');
        if (overlay) overlay.remove();
        var inline = document.getElementById('media-audio-inline');
        if (inline) inline.remove();
    }

    // ---- Dictionary tab integration ----

    var _dictLessonTitle = null;

    function renderDictMediaTab(container, lessonTitle) {
        _dictLessonTitle = lessonTitle || null;
        // Render compact media browser for dictionary panel
        var dictToken = (typeof PlonterAuth !== 'undefined' && PlonterAuth && PlonterAuth.getToken()) || localStorage.getItem('plonter_auth_token') || localStorage.getItem('auth_otp_token_plonter');
        if (!dictToken) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280">' +
                '<p style="margin-bottom:8px">יש להתחבר</p>' +
                '<button onclick="if(typeof PlonterAuth!==\'undefined\')PlonterAuth.showLoginDialog()" style="padding:6px 16px;border-radius:6px;background:#0891b2;color:white;border:none;cursor:pointer;font-size:0.9em">התחברות</button>' +
                '</div>';
            return;
        }

        container.innerHTML = '<div style="text-align:center;padding:12px;color:#6b7280">טוען...</div>';
        container.classList.add('dict-media-tab-content');

        ensureSystemFolders().then(function() {
            _renderDictMediaContent(container);
            // Auto-load lesson folder if in presenter
            if (_dictLessonTitle) {
                getLessonFolderMedia(_dictLessonTitle).then(function(result) {
                    _renderLessonFolderSection(result.items, result.folderId);
                }).catch(function() {});
            }
            // Restore player if there was one active before tab switch
            setTimeout(function() { _restorePlayer(); }, 500);
        }).catch(function(err) {
            if (err && err.authRequired) return;
            container.innerHTML = '<div style="color:#ef4444;padding:12px">שגיאה: ' + err.message + '</div>';
        });
    }

    function _renderLessonFolderSection(items, folderId) {
        var existing = document.getElementById('dict-lesson-folder-section');
        if (existing) existing.remove();
        var subfolders = folderId ? getChildFolders(parseInt(folderId)) : [];
        if ((!items || items.length === 0) && (!subfolders || subfolders.length === 0)) return;

        var section = document.createElement('div');
        section.id = 'dict-lesson-folder-section';
        section.style.cssText = 'margin-bottom:8px;border:2px solid #0d9488;border-radius:8px;padding:6px;background:#f0fdfa';
        var mediaCount = items ? items.length : 0;
        var folderCount = subfolders ? subfolders.length : 0;
        var countLabel = mediaCount + (folderCount > 0 ? '+' + folderCount + '📁' : '');
        var headerHtml = '<div style="font-weight:bold;font-size:0.85em;color:#0d9488;margin-bottom:4px;cursor:pointer" onclick="var el=document.getElementById(\'dict-lesson-folder-items\');el.style.display=el.style.display===\'none\'?\'block\':\'none\'">📁 תיקיית שיעור — ' + (_dictLessonTitle || '') + ' <span style="font-size:0.8em;color:#6b7280">(' + countLabel + ')</span></div>';
        section.innerHTML = headerHtml;

        // Subfolder pills — shown above media items
        if (subfolders && subfolders.length > 0) {
            var subfoldersDiv = document.createElement('div');
            subfoldersDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px';
            subfolders.forEach(function(sf) {
                var pill = document.createElement('button');
                pill.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:12px;border:1px solid #e5e7eb;background:white;cursor:pointer;font-size:0.78em;white-space:nowrap';
                pill.innerHTML = '📁 ' + (sf.name || '');
                pill.onclick = function() { MediaStorage.browseDictFolder(sf.id); };
                subfoldersDiv.appendChild(pill);
            });
            section.appendChild(subfoldersDiv);
        }

        var itemsDiv = document.createElement('div');
        itemsDiv.id = 'dict-lesson-folder-items';
        itemsDiv.style.cssText = 'max-height:150px;overflow-y:auto';
        (items || []).forEach(function(item) {
            var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
            var itemJson = JSON.stringify(item).replace(/"/g, '&quot;');
            var iconHtml = '<span style="font-size:0.9em">' + icon + '</span>';
            if (item.media_type === 'image' && item.url) {
                iconHtml = '<img src="' + _absUrl(item.url) + '" style="width:40px;height:30px;border-radius:4px;object-fit:cover;flex-shrink:0;cursor:pointer" onerror="this.outerHTML=\'<span style=font-size:0.9em>🖼️</span>\'" onclick="event.stopPropagation();MediaStorage.playMedia(' + itemJson + ')" />';
            }
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px;border-bottom:1px solid #e5e7eb;cursor:pointer;font-size:0.85em';
            row.innerHTML = iconHtml +
                '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (item.title || '') + '</span>' +
                '<button onclick="event.stopPropagation();MediaStorage.playMedia(' + itemJson + ')" style="padding:2px 6px;border-radius:4px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.75em">▶</button>';
            // Click a lesson file → play it in the floating player BELOW and keep the
            // list visible (Amitai 2026-06-17). selectForDict() re-rendered the whole
            // panel and destroyed the list — that "single view" is gone now.
            row.addEventListener('click', function() { playMedia(item); });
            itemsDiv.appendChild(row);
        });
        section.appendChild(itemsDiv);

        // Insert at the top of the container, after selected media
        var container = document.querySelector('.dict-media-tab-content');
        if (!container) return;
        var selectedEl = document.getElementById('dict-selected-media');
        if (selectedEl) {
            selectedEl.after(section);
        } else {
            container.insertBefore(section, container.firstChild);
        }
    }

    function _renderDictMediaContent(container) {
        var html = '';

        // Selected media at top
        if (selectedMedia.length > 0) {
            html += '<div id="dict-selected-media" style="margin-bottom:8px;border:1px solid #0891b2;border-radius:8px;padding:8px;background:#f0fdfa">';
            selectedMedia.forEach(function(item, i) {
                html += '<div style="display:flex;align-items:center;gap:6px;padding:4px;' + (i > 0 ? 'border-top:1px solid #e5e7eb;' : '') + '">';
                html += '<span style="flex:1;font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + item.title + '</span>';
                html += '<button onclick="MediaStorage.playMedia(' + JSON.stringify(item).replace(/"/g, '&quot;') + ')" style="padding:2px 6px;border-radius:4px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.75em">▶</button>';
                html += '<button onclick="MediaStorage.removeSelected(' + i + ')" style="padding:2px 6px;border-radius:4px;border:1px solid #ef4444;background:white;color:#ef4444;cursor:pointer;font-size:0.75em">✕</button>';
                html += '</div>';
            });
            html += '</div>';
        }

        // Search + add buttons
        html += '<div style="display:flex;gap:4px;margin-bottom:8px">';
        html += '<input type="text" id="dict-media-search" placeholder="חפש..." oninput="MediaStorage.handleDictSearch(this.value)" style="flex:1;padding:6px;border-radius:6px;border:1px solid #d1d5db;font-size:0.85em;direction:rtl">';
        html += '<button onclick="MediaStorage.showAddLinkDialog()" style="padding:4px 8px;border-radius:6px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.8em" title="הוסף קישור">🔗</button>';
        html += '<button onclick="MediaStorage.showUploadDialog()" style="padding:4px 8px;border-radius:6px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.8em" title="העלה">📁</button>';
        html += '<button onclick="MediaStorage.showShortcutDialog()" style="padding:4px 8px;border-radius:6px;border:1px solid #6366f1;background:white;color:#6366f1;cursor:pointer;font-size:0.8em" title="קיצור דרך">📌</button>';
        html += '</div>';

        // Sort selector
        html += '<div style="margin-bottom:6px">';
        html += '<select id="dict-media-sort" onchange="MediaStorage._currentSort=this.value;MediaStorage.browseDictFolder(MediaStorage._currentFolderId)" style="padding:4px 8px;border-radius:6px;border:1px solid #d1d5db;font-size:0.8em;direction:rtl;background:white">';
        html += '<option value="recent">אחרון שהשתמשו</option>';
        html += '<option value="alpha">א-ת</option>';
        html += '<option value="alpha_rev">ת-א</option>';
        html += '<option value="newest">חדש → ישן</option>';
        html += '<option value="oldest">ישן → חדש</option>';
        html += '</select></div>';

        // Folder cards
        var rootFolders = getChildFolders(null);
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;margin-bottom:8px">';
        rootFolders.forEach(function(f) {
            var icon = f.name === 'יוטיוב' ? '▶️' : f.name === 'קטעי שמע' ? '🎵' : f.name === 'תמונות' ? '🖼️' : f.name === 'שיעורים' ? '📚' : f.name === 'טוטוריאל' ? '📖' : '📁';
            html += '<button class="dict-media-folder-pill" onclick="MediaStorage.browseDictFolder(' + f.id + ')" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:8px;border:1px solid #e5e7eb;background:white;cursor:pointer;font-size:0.75em;text-align:center;min-width:0">' +
                '<span style="font-size:1.6em">' + icon + '</span>' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%">' + f.name + '</span>' +
                '</button>';
        });
        html += '</div>';

        // Media items area
        html += '<div id="dict-media-items" style="max-height:300px;overflow-y:auto"></div>';

        container.innerHTML = html;
    }

    var _currentSort = 'recent';
    var _currentFolderId = null;

    function browseDictFolder(folderId) {
        _currentFolderId = folderId;
        var listEl = document.getElementById('dict-media-items');
        if (!listEl) return;
        listEl.innerHTML = '<div style="text-align:center;padding:8px;color:#6b7280">טוען...</div>';

        apiCall('list_media', { folder_id: folderId }).then(function(data) {
            var items = data.items || [];
            // Sort items
            var sortMode = _currentSort;
            items.sort(function(a, b) {
                if (sortMode === 'alpha') return (a.title || '').localeCompare(b.title || '', 'ar');
                if (sortMode === 'alpha_rev') return (b.title || '').localeCompare(a.title || '', 'ar');
                if (sortMode === 'newest') return (b.created_at || '').localeCompare(a.created_at || '');
                if (sortMode === 'oldest') return (a.created_at || '').localeCompare(b.created_at || '');
                return 0; // 'recent' — keep server order
            });

            // Also show subfolders
            var subfolders = getChildFolders(folderId);
            var html = '';

            // Back/up control so the user can always exit a folder back to the list
            // (Amitai 2026-06-17). Goes up one level, or back to root if at top level.
            if (folderId) {
                var _cur = getFolderById(parseInt(folderId));
                var _pid = (_cur && _cur.parent_id && _cur.parent_id !== '0' && _cur.parent_id !== 0) ? parseInt(_cur.parent_id) : null;
                var _backOnclick = _pid !== null
                    ? 'MediaStorage.browseDictFolder(' + _pid + ')'
                    : "var l=document.getElementById('dict-media-items');if(l)l.innerHTML='';";
                html += '<div onclick="' + _backOnclick + '" style="padding:6px 8px;border-radius:6px;cursor:pointer;background:#eef2ff;color:#4f46e5;margin-bottom:4px;font-size:0.85em;font-weight:bold">↩ חזרה</div>';
            }

            if (subfolders.length > 0) {
                subfolders.forEach(function(sf) {
                    html += '<div onclick="MediaStorage.browseDictFolder(' + sf.id + ')" style="padding:6px 8px;border-radius:6px;cursor:pointer;background:#f9fafb;margin-bottom:4px;font-size:0.85em">📁 ' + sf.name + '</div>';
                });
            }

            if (items.length === 0 && subfolders.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:0.85em">ריק</div>';
                return;
            }

            items.forEach(function(item) {
                var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                var itemJson = JSON.stringify(item).replace(/"/g, '&quot;');
                var iconHtml = '<span style="font-size:0.9em">' + icon + '</span>';
                if (item.media_type === 'image' && item.url) {
                    iconHtml = '<img src="' + _absUrl(item.url) + '" style="width:40px;height:30px;border-radius:4px;object-fit:cover;flex-shrink:0;cursor:pointer" onerror="this.outerHTML=\'<span style=font-size:0.9em>🖼️</span>\'" onclick="event.stopPropagation();MediaStorage.playMedia(' + itemJson + ')" />';
                }
                html += '<div style="display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #f3f4f6;cursor:pointer" onclick="MediaStorage.selectForDict(' + JSON.stringify(item).replace(/"/g, '&quot;') + ')">';
                html += iconHtml;
                html += '<span style="flex:1;font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + item.title + '</span>';
                html += '<button onclick="event.stopPropagation();MediaStorage.playMedia(' + JSON.stringify(item).replace(/"/g, '&quot;') + ')" style="padding:2px 6px;border-radius:4px;border:1px solid #0891b2;background:white;color:#0891b2;cursor:pointer;font-size:0.75em">▶</button>';
                html += '</div>';
            });

            listEl.innerHTML = html;
        }).catch(function(err) {
            listEl.innerHTML = '<div style="color:#ef4444;font-size:0.85em;padding:8px">' + err.message + '</div>';
        });
    }

    function selectForDict(item) {
        // Add to selected media list (shown above search)
        var exists = selectedMedia.some(function(s) { return s.id === item.id; });
        if (!exists) {
            selectedMedia.push(item);
            var dictContainer = document.querySelector('.dict-media-tab-content');
            if (dictContainer) _renderDictMediaContent(dictContainer);
        }
    }

    function removeSelected(index) {
        selectedMedia.splice(index, 1);
        var dictContainer = document.querySelector('.dict-media-tab-content');
        if (dictContainer) _renderDictMediaContent(dictContainer);
    }

    function handleDictSearch(query) {
        clearTimeout(searchTimeout);
        var listEl = document.getElementById('dict-media-items');
        if (!listEl) return;
        if (!query || query.length < 2) { listEl.innerHTML = ''; return; }
        searchTimeout = setTimeout(function() {
            apiCall('search', { query: query }).then(function(data) {
                var items = data.items || [];
                var html = '';
                items.forEach(function(item) {
                    var icon = item.media_type === 'video' ? '🎬' : item.media_type === 'audio' ? '🎵' : '🖼️';
                    var itemJson = JSON.stringify(item).replace(/"/g, '&quot;');
                    var iconHtml = '<span style="font-size:0.9em">' + icon + '</span>';
                    if (item.media_type === 'image' && item.url) {
                        iconHtml = '<img src="' + _absUrl(item.url) + '" style="width:40px;height:30px;border-radius:4px;object-fit:cover;flex-shrink:0;cursor:pointer" onerror="this.outerHTML=\'<span style=font-size:0.9em>🖼️</span>\'" onclick="event.stopPropagation();MediaStorage.playMedia(' + itemJson + ')" />';
                    }
                    html += '<div style="display:flex;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #f3f4f6;cursor:pointer" onclick="MediaStorage.selectForDict(' + JSON.stringify(item).replace(/"/g, '&quot;') + ')">';
                    html += iconHtml;
                    html += '<span style="flex:1;font-size:0.85em">' + item.title + '</span>';
                    html += '<span style="font-size:0.7em;color:#6b7280">' + (item.folder_name || '') + '</span>';
                    html += '</div>';
                });
                listEl.innerHTML = html || '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:0.85em">לא נמצא</div>';
            });
        }, 300);
    }

    // ---- Lesson integration ----

    function getLessonFolderId(lessonTitle) {
        // Find or create folder: שיעורים > lessonTitle
        var lessonsFolder = folders.find(function(f) { return f.name === 'שיעורים' && (!f.parent_id || f.parent_id === '0'); });
        if (!lessonsFolder) return Promise.reject(new Error('Lessons folder not found'));

        var lessonFolder = folders.find(function(f) {
            return f.name === lessonTitle && parseInt(f.parent_id) === parseInt(lessonsFolder.id);
        });

        if (lessonFolder) return Promise.resolve(parseInt(lessonFolder.id));

        return apiCall('create_folder', {
            name: lessonTitle,
            parent_id: parseInt(lessonsFolder.id)
        }).then(function(result) {
            return loadFolders().then(function() { return result.id; });
        });
    }

    // ---- Toast ----

    function showToast(msg) {
        var existing = document.querySelector('.media-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'media-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1f2937;color:white;padding:8px 20px;border-radius:20px;font-size:0.9em;z-index:10001;direction:rtl;white-space:nowrap';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 3000);
    }

    // ---- Shortcut functions ----

    function createShortcut(sourceMediaId, targetFolderId) {
        return apiCall('create_shortcut', {
            source_media_id: sourceMediaId,
            target_folder_id: targetFolderId
        });
    }

    function getLessonFolderMedia(lessonTitle) {
        // Get all media in a lesson's folder (including shortcuts)
        return getLessonFolderId(lessonTitle).then(function(folderId) {
            return apiCall('list_media', { folder_id: folderId }).then(function(data) {
                return { folderId: folderId, items: data.items || [] };
            });
        });
    }

    function searchMainStorage(query) {
        return apiCall('search', { query: query });
    }

    function renameLessonFolder(oldTitle, newTitle) {
        if (oldTitle === newTitle) return Promise.resolve();
        // Always load fresh folders — local array may be stale or empty
        return loadFolders().then(function() {
            var lessonsFolder = folders.find(function(f) { return f.name === 'שיעורים' && (!f.parent_id || f.parent_id === '0'); });
            if (!lessonsFolder) return Promise.resolve();

            var lessonFolder = folders.find(function(f) {
                return f.name === oldTitle && parseInt(f.parent_id) === parseInt(lessonsFolder.id);
            });
            if (!lessonFolder) return Promise.resolve();

            return apiCall('rename_folder', { id: parseInt(lessonFolder.id), name: newTitle }).then(function() {
                return loadFolders();
            });
        });
    }

    function showCreateShortcutDialog(mediaId) {
        // Create shortcut of a media item in another folder
        _closeAllDialogs();
        var overlay = document.createElement('div');
        overlay.id = 'media-dialog-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;width:90%;max-width:400px;direction:rtl;max-height:70vh;overflow-y:auto';

        var html = '<h3 style="margin:0 0 16px;color:#6366f1">📌 צור קיצור דרך בתיקייה</h3>';

        var tree = buildFolderTree(null, 0);
        tree.forEach(function(item) {
            var indent = item.level * 20;
            var isCurrent = item.id === currentFolder;
            html += '<div data-sc-folder="' + item.id + '" style="padding:8px 12px;margin:2px 0;border-radius:6px;cursor:pointer;margin-right:' + indent + 'px;' + (isCurrent ? 'background:#eef2ff;font-weight:bold;color:#6366f1' : 'background:#f9fafb') + ';transition:background 0.2s" onmouseover="this.style.background=\'#eef2ff\'" onmouseout="this.style.background=\'' + (isCurrent ? '#eef2ff' : '#f9fafb') + '\'">';
            html += '📁 ' + item.name;
            if (isCurrent) html += ' (נוכחית)';
            html += '</div>';
        });

        html += '<div style="margin-top:12px;text-align:center"><button onclick="MediaStorage._closeDialog()" style="padding:8px 20px;border-radius:8px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;cursor:pointer">ביטול</button></div>';

        dialog.innerHTML = html;
        overlay.appendChild(dialog);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) _closeDialog(); });
        document.body.appendChild(overlay);

        dialog.querySelectorAll('[data-sc-folder]').forEach(function(el) {
            el.addEventListener('click', function() {
                var targetFolderId = parseInt(el.dataset.scFolder);
                el.style.opacity = '0.5';
                el.style.pointerEvents = 'none';
                createShortcut(mediaId, targetFolderId).then(function() {
                    _closeDialog();
                    showToast('קיצור דרך נוצר בהצלחה');
                }).catch(function(err) {
                    el.style.opacity = '1';
                    el.style.pointerEvents = '';
                    showToast('שגיאה: ' + (err.message || 'כבר קיים'));
                });
            });
        });
    }

    // ---- Folder management ----

    // ---- Auth-required handling (coordinated with @100, 2026-06-17) ----
    // When media_api.php removes the guest fallback, an invalid/expired token that
    // passes the client-side check is rejected by the server (HTTP 401 / auth_required).
    // Clear the stale token and prompt re-login instead of leaving the warehouse in a
    // raw-error state. Do NOT call PlonterAuth.logout() — it wipes user-scoped content
    // (teacher-trust rule #3); we only drop the token and re-auth.
    var _authRedirecting = false;
    function _handleAuthRequired(msg) {
        if (_authRedirecting) return;
        _authRedirecting = true;
        try {
            localStorage.removeItem('plonter_auth_token');
            localStorage.removeItem('auth_otp_token_plonter');
        } catch (e) {}
        if (typeof showToast === 'function') showToast(msg || 'נדרשת התחברות למחסן המדיה');
        // Re-render the warehouse to its welcome/login state (token now cleared).
        var root = document.getElementById('media-storage-root');
        if (root) renderFolderView(root);
        // Proactively open the login dialog; on success, refresh the warehouse.
        if (typeof PlonterAuth !== 'undefined' && PlonterAuth && PlonterAuth.showLoginDialog) {
            PlonterAuth.showLoginDialog(function() {
                _authRedirecting = false;
                var r2 = document.getElementById('media-storage-root');
                if (r2) renderFolderView(r2);
            });
        }
        setTimeout(function() { _authRedirecting = false; }, 5000);
    }

    // ---- Attention pulse on the refresh button (Amitai 2026-06-17) ----
    // After a mutating action that may leave the visible folder stale (e.g. a
    // shortcut added from the still-open shortcut dialog), make the 🔄 רענן
    // button jump/grow/pulse and cycle colors so the teacher notices it.
    function _injectRefreshPulseStyle() {
        if (document.getElementById('mw-refresh-pulse-style')) return;
        var st = document.createElement('style');
        st.id = 'mw-refresh-pulse-style';
        st.textContent =
            '@keyframes mwRefreshPulse{' +
            '0%{transform:scale(1) translateY(0);background:#fef3c7;border-color:#f59e0b;color:#92400e;box-shadow:0 0 0 0 rgba(245,158,11,0.6)}' +
            '25%{transform:scale(1.22) translateY(-4px);background:#0d9488;border-color:#0d9488;color:#fff;box-shadow:0 6px 18px 0 rgba(13,148,136,0.55)}' +
            '50%{transform:scale(1.12) translateY(0);background:#6366f1;border-color:#6366f1;color:#fff;box-shadow:0 0 0 6px rgba(99,102,241,0.25)}' +
            '75%{transform:scale(1.22) translateY(-4px);background:#0891b2;border-color:#0891b2;color:#fff;box-shadow:0 6px 18px 0 rgba(8,145,178,0.55)}' +
            '100%{transform:scale(1) translateY(0);background:#fef3c7;border-color:#f59e0b;color:#92400e;box-shadow:0 0 0 0 rgba(245,158,11,0.6)}}' +
            '.mw-refresh-attn{animation:mwRefreshPulse 0.9s ease-in-out infinite;font-weight:bold !important;position:relative;z-index:5}';
        document.head.appendChild(st);
    }
    var _refreshPulseTimer = null;
    function _pulseRefreshButton() {
        _injectRefreshPulseStyle();
        var btn = document.getElementById('mw-refresh-btn');
        if (!btn) return;
        btn.classList.add('mw-refresh-attn');
        // Auto-stop after a few seconds so it draws the eye without nagging forever.
        if (_refreshPulseTimer) clearTimeout(_refreshPulseTimer);
        _refreshPulseTimer = setTimeout(_stopRefreshPulse, 6000);
    }
    function _stopRefreshPulse() {
        if (_refreshPulseTimer) { clearTimeout(_refreshPulseTimer); _refreshPulseTimer = null; }
        var btn = document.getElementById('mw-refresh-btn');
        if (btn) btn.classList.remove('mw-refresh-attn');
    }

    function refreshFolder() {
        if (guardUploadInProgress()) return;
        _stopRefreshPulse();
        loadFolders().then(function() {
            var root = document.getElementById('media-storage-root');
            if (root) renderFolderView(root);
            if (currentFolder) loadFolderMedia(currentFolder);
            showToast('רוענן בהצלחה');
        });
    }

    function _deleteFolderConfirm(folderId, folderName) {
        if (guardUploadInProgress()) return;
        _closeAllDialogs();
        var overlay = document.createElement('div');
        overlay.id = 'media-dialog-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:16px;padding:24px;width:90%;max-width:360px;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,0.3)';

        dialog.innerHTML =
            '<h3 style="margin:0 0 12px;color:#dc2626;font-size:1.1em">🗑️ מחיקת תיקייה</h3>' +
            '<p style="color:#374151;margin:0 0 8px">למחוק את התיקייה "<strong>' + folderName + '</strong>"?</p>' +
            '<p style="color:#6b7280;font-size:0.85em;margin:0 0 16px">כל הקבצים בתוכה יימחקו.</p>' +
            '<div style="display:flex;gap:8px;justify-content:flex-start">' +
                '<button id="del-folder-confirm-btn" style="padding:8px 20px;border-radius:10px;border:none;background:#dc2626;color:white;font-weight:bold;cursor:pointer;font-size:0.95em">מחק</button>' +
                '<button id="del-folder-cancel-btn" style="padding:8px 16px;border-radius:10px;border:1px solid #d1d5db;background:white;color:#6b7280;cursor:pointer;font-size:0.95em">ביטול</button>' +
            '</div>';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        document.getElementById('del-folder-cancel-btn').addEventListener('click', function() { overlay.remove(); });

        document.getElementById('del-folder-confirm-btn').addEventListener('click', function() {
            overlay.remove();
            apiCall('delete_folder', { id: folderId }).then(function() {
                showToast('התיקייה נמחקה');
                loadFolders().then(function() {
                    var root = document.getElementById('media-storage-root');
                    if (root) renderFolderView(root);
                });
            });
        });
    }

    function _renameFolderPrompt(folderId, currentName) {
        _closeAllDialogs();
        var overlay = document.createElement('div');
        overlay.id = 'media-dialog-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:white;border-radius:16px;padding:24px;width:90%;max-width:360px;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,0.3)';

        dialog.innerHTML =
            '<h3 style="margin:0 0 16px;color:#1f2937;font-size:1.1em">✏️ שינוי שם תיקייה</h3>' +
            '<input type="text" id="rename-folder-input" value="' + currentName.replace(/"/g, '&quot;') + '" style="width:100%;padding:10px 14px;border-radius:10px;border:2px solid #e5e7eb;font-size:1em;direction:rtl;box-sizing:border-box;outline:none;transition:border-color 0.2s" onfocus="this.style.borderColor=\'#0891b2\'" onblur="this.style.borderColor=\'#e5e7eb\'" />' +
            '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-start">' +
                '<button id="rename-folder-save-btn" style="padding:8px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#0d9488,#0891b2);color:white;font-weight:bold;cursor:pointer;font-size:0.95em">שמור</button>' +
                '<button id="rename-folder-cancel-btn" style="padding:8px 16px;border-radius:10px;border:1px solid #d1d5db;background:white;color:#6b7280;cursor:pointer;font-size:0.95em">ביטול</button>' +
            '</div>';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        var input = document.getElementById('rename-folder-input');
        input.focus();
        input.select();

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') document.getElementById('rename-folder-save-btn').click();
            if (e.key === 'Escape') overlay.remove();
        });

        document.getElementById('rename-folder-cancel-btn').addEventListener('click', function() { overlay.remove(); });

        document.getElementById('rename-folder-save-btn').addEventListener('click', function() {
            var newName = input.value.trim();
            if (!newName || newName === currentName) { overlay.remove(); return; }
            overlay.remove();
            apiCall('rename_folder', { id: folderId, name: newName }).then(function() {
                showToast('שם התיקייה שונה');
                loadFolders().then(function() {
                    var root = document.getElementById('media-storage-root');
                    if (root) renderFolderView(root);
                });
            });
        });
    }

    // ---- Public API ----

    return {
        renderMediaTab: renderMediaTab,
        openFolder: openFolder,
        navigateTo: navigateTo,
        showAddLinkDialog: showAddLinkDialog,
        showUploadDialog: showUploadDialog,
        showShortcutDialog: showShortcutDialog,
        showNewFolderDialog: showNewFolderDialog,
        showMoveDialog: showMoveDialog,
        confirmDeleteMedia: confirmDeleteMedia,
        playMedia: playMedia,
        handleSearch: handleSearch,
        _submitLink: _submitLink,
        _submitUpload: _submitUpload,
        _submitBulkUpload: _submitBulkUpload,
        _detectMediaType: _detectMediaType,
        _closeDialog: _closeDialog,
        _moveToFolder: _moveToFolder,
        _toggleAudio: _toggleAudio,
        _seekAudio: _seekAudio,
        _volUp: _volUp,
        _volDown: _volDown,
        _closePlayer: _closePlayer,

        // Dictionary integration
        renderDictMediaTab: renderDictMediaTab,
        browseDictFolder: browseDictFolder,
        get _currentSort() { return _currentSort; },
        set _currentSort(v) { _currentSort = v; },
        get _currentFolderId() { return _currentFolderId; },
        selectForDict: selectForDict,
        removeSelected: removeSelected,
        handleDictSearch: handleDictSearch,
        getSelectedMedia: function() { return selectedMedia; },

        // Pagination
        _loadMoreMedia: function(folderId, offset) { loadFolderMedia(folderId, offset, true); },

        // Folder management
        refreshFolder: refreshFolder,
        _deleteFolderConfirm: _deleteFolderConfirm,
        _renameFolderPrompt: _renameFolderPrompt,

        // Lesson integration
        getLessonFolderId: getLessonFolderId,
        getLessonFolderMedia: getLessonFolderMedia,
        renameLessonFolder: renameLessonFolder,
        createShortcut: createShortcut,
        showCreateShortcutDialog: showCreateShortcutDialog,
        searchMainStorage: searchMainStorage,
        loadFolders: loadFolders,
        ensureSystemFolders: ensureSystemFolders,
        getChildFolders: getChildFolders,
        apiCall: apiCall
    };
})();
