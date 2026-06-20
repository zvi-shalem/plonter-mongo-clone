// Dragon-only Plonter tasks panel.
var PlonterTasksPanel = (function() {
    'use strict';

    var TASKS_BASE = 'https://iseemath.co/tasks_amitai/next.php?bot=';
    var ADD_TASK_URL = 'https://iseemath.co/tasks_amitai/add.php';
    var UPLOAD_URL = 'https://iseemath.co/plonter/upload.php'; // Plonter-owned image store → returns public URL for image_url
    var TRELLO_URL = 'https://trello.com/b/r6V0dczo.json';
    // Central daily_tasks feed — single source of truth for Amitai's tasks.
    // Amitai's default task channel moved luz → @divooah (2026-06-02 manager promotion),
    // so ALL his tasks (incl every פלונטר task) now live under the Divooah_Taooyot_bot alias.
    // Read it and filter tag=פלונטר. (Was luz_metoraf_bot, which only carried ~9 of them.)
    var CENTRAL_FEED = 'https://iseemath.co/tasks/next.php?bot=Divooah_Taooyot_bot';
    var CENTRAL_BOT = 'divooah_taooyot_bot';
    var CENTRAL_TAG = 'פלונטר';
    var DONE_KEY = 'plonter_tasks_done_v1';
    var STAR_KEY = 'plonter_tasks_star_v1';
    var HIDDEN_KEY = 'plonter_tasks_hidden_v1';
    var SNOOZE_KEY = 'plonter_tasks_snooze_v1';
    var _loaded = false;
    var _loading = false;
    var _context = 'lessons';
    var _subcategory = 'all';
    var _taskFeeds = [];
    var _trelloCards = [];
    var _status = '';
    var _showArchive = false;
    var _focusView = true;
    var _bdikaView = false;
    var _sidePanel = null;
    var _activeRootId = 'tasks-panel-welcome';
    // אישורים (password-reset management) view state
    var _ishurimUsers = null;   // [{id, first_name, last_name, email, role, ...}]
    var _ishurimLoading = false;
    var _ishurimError = '';
    var _ishurimFilter = '';
    var _ishurimLinks = {};     // {user_id -> {loading, link, error}}

    var AREAS = {
        lessons: {
            label: 'שיעורים',
            bots: ['Plonter_7_lessons_bot', 'Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_7_lessons_bot',
            taskBot: 'plonter_7_lessons_bot',
            terms: ['שיעור', 'שיעורים', 'מצגת', 'lesson', 'slide', 'presentation']
        },
        analysis: {
            label: 'תחביר',
            bots: ['Plonter_4_tahbir_bot', 'Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_4_tahbir_bot',
            taskBot: 'plonter_4_tahbir_bot',
            terms: ['תחביר', 'ניתוח', 'משפט', 'syntax', 'analysis', 'sentence']
        },
        hindus: {
            label: 'הינדוס',
            bots: ['Plonter_4_tahbir_bot', 'Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_4_tahbir_bot',
            taskBot: 'plonter_4_tahbir_bot',
            terms: ['הינדוס', 'הנדוס', 'hindus', 'geometry']
        },
        texts: {
            label: 'טקסטים',
            bots: ['Plonter_5_texts_bot', 'Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_5_texts_bot',
            taskBot: 'plonter_5_texts_bot',
            terms: ['טקסט', 'טקסטים', 'texts', 'text']
        },
        media: {
            label: 'מדיה',
            bots: ['Plonter_6_manager_bot', 'Plonter_7_lessons_bot'],
            telegram: 'https://t.me/Plonter_6_manager_bot',
            taskBot: 'plonter_6_manager_bot',
            terms: ['מדיה', 'תמונה', 'וידאו', 'סרטון', 'media', 'image', 'video', 'audio']
        },
        app: {
            label: 'אפליקציות',
            bots: ['Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_6_manager_bot',
            taskBot: 'plonter_6_manager_bot',
            terms: ['אפליציית', 'אפליקציית', 'אפליקציה', 'אפליקציות', 'app', 'application']
        },
        vocab: {
            label: 'אוצר מילים',
            bots: ['Plonter_8_milon_bot', 'Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_8_milon_bot',
            taskBot: 'plonter_8_milon_bot',
            terms: ['אוצ', 'אוצר מילים', 'מילון', 'מילה', 'מילים', 'vocab', 'dictionary', 'word']
        },
        dictionary: {
            label: 'מילון',
            bots: ['Plonter_8_milon_bot', 'Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_8_milon_bot',
            taskBot: 'plonter_8_milon_bot',
            terms: ['מילון', 'מילה', 'מילים', 'dictionary', 'word']
        },
        manager: {
            label: 'כללי',
            bots: ['Plonter_6_manager_bot'],
            telegram: 'https://t.me/Plonter_6_manager_bot',
            taskBot: 'plonter_6_manager_bot',
            terms: ['פלונטר', 'plonter']
        }
    };

    function init() {
        installFloatingButton();
        updateVisibility();
        document.addEventListener('plonter:rolechange', updateVisibility);
        document.addEventListener('plonter:authchange', function() {
            setTimeout(updateVisibility, 700);
            setTimeout(updateVisibility, 1500);
        });
    }

    function updateVisibility() {
        var tab = document.getElementById('tab-tasks');
        var dragon = isDragon() && !isLoginScreenVisible();
        if (tab) tab.style.display = dragon ? '' : 'none';
        var floatBtn = document.getElementById('plonter-tasks-float-btn');
        if (floatBtn) floatBtn.style.display = dragon ? '' : 'none';
        if (!dragon) {
            hideSidePanel();
            var section = document.querySelector('.tasks-section-welcome');
            var activeTasks = section && section.style.display !== 'none';
            if (section) section.style.display = 'none';
            var root = document.getElementById('tasks-panel-welcome');
            if (root) root.innerHTML = '';
            if (window.__plonterLastWelcomeTab && typeof switchWelcomeTab === 'function') {
                if (activeTasks) switchWelcomeTab(window.__plonterLastWelcomeTab || 'lessons');
            }
        }
    }

    function ensurePulseStyle() {
        ensurePulseHelper();
        if (document.getElementById('dict-pulse-style')) return;
        var style = document.createElement('style');
        style.id = 'dict-pulse-style';
        style.textContent = '@keyframes dict-pulse{0%,100%{transform:translateY(-50%) scale(1)}50%{transform:translateY(-50%) scale(1.15)}}';
        document.head.appendChild(style);
    }

    // Shared pulse driver for ALL floating side-rail buttons (tasks + the 3 dictionaries).
    // Uses the Web Animations API anchored to startTime=0 (the document timeline origin) so
    // every button pulses in the SAME phase no matter when it first became visible — fixes
    // the "buttons pulse at different times" desync. Idempotent: a no-op while already pulsing.
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

    function installFloatingButton() {
        if (document.getElementById('plonter-tasks-float-btn')) return;
        ensurePulseStyle();
        var btn = document.createElement('button');
        btn.id = 'plonter-tasks-float-btn';
        btn.innerHTML = '✓';
        btn.title = 'משימות';
        btn.style.cssText = 'position:fixed;left:calc(2px + env(safe-area-inset-left, 0px));top:calc(50% - 112px);transform:translateY(-50%);width:36px;height:48px;border:none;border-radius:0 8px 8px 0;background:#334155;color:white;font-size:1.25em;font-weight:bold;cursor:pointer;z-index:10002;box-shadow:2px 0 8px rgba(51,65,85,0.3);transition:left 0.3s ease;display:none';
        btn.onclick = openFromFloatingButton;
        document.body.appendChild(btn);
        window.PlonterPulse.start(btn);
    }

    function openFromFloatingButton() {
        if (!isDragon()) return;
        var panel = getOrCreateSidePanel();
        var openPanel = panel.classList.contains('show');
        if (openPanel) {
            hideSidePanel();
            return;
        }
        _activeRootId = 'tasks-panel-side-content';
        _context = normalizeContext(window.__plonterLastWelcomeTab || _context || 'lessons');
        panel.classList.add('show');
        updateFloatingButtonState(true);
        render();
    }

    function getOrCreateSidePanel() {
        if (_sidePanel) return _sidePanel;
        var panel = document.createElement('div');
        panel.id = 'plonter-tasks-side-panel';
        panel.className = 'plonter-tasks-side-panel';
        panel.innerHTML =
            '<div class="plonter-tasks-side-header">' +
                '<button type="button" id="plonter-tasks-side-close" class="plonter-tasks-side-close" title="סגור">✕</button>' +
                '<div>' +
                    '<div class="plonter-tasks-side-title">משימות</div>' +
                    '<div class="plonter-tasks-side-subtitle">פאנל דרקון</div>' +
                '</div>' +
            '</div>' +
            '<div id="tasks-panel-side-content" class="plonter-tasks-side-content"></div>';
        document.body.appendChild(panel);
        _sidePanel = panel;
        document.getElementById('plonter-tasks-side-close').onclick = hideSidePanel;
        return panel;
    }

    function hideSidePanel() {
        if (_sidePanel) _sidePanel.classList.remove('show');
        updateFloatingButtonState(false);
        if (_activeRootId === 'tasks-panel-side-content') _activeRootId = 'tasks-panel-welcome';
    }

    function updateFloatingButtonState(open) {
        var btn = document.getElementById('plonter-tasks-float-btn');
        if (!btn) return;
        btn.innerHTML = open ? '✕' : '✓';
        btn.style.background = open ? '#ef4444' : '#334155';
        btn.style.boxShadow = open ? '2px 0 8px rgba(239,68,68,0.3)' : '2px 0 8px rgba(51,65,85,0.3)';
        btn.style.left = open ? 'calc(380px + env(safe-area-inset-left, 0px))' : 'calc(2px + env(safe-area-inset-left, 0px))';
        if (open) window.PlonterPulse.stop(btn); else window.PlonterPulse.start(btn);
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

    function open(context) {
        updateVisibility();
        if (!isDragon()) return;
        _activeRootId = 'tasks-panel-welcome';
        hideSidePanel();
        _context = normalizeContext(context || _context || 'lessons');
        render();
    }

    function normalizeContext(context) {
        if (context === 'media') return 'media';
        if (context === 'texts') return 'texts';
        if (context === 'hindus') return 'hindus';
        if (context === 'analysis') return 'analysis';
        if (context === 'app') return 'app';
        if (context === 'vocab' || context === 'dictionary') return 'vocab';
        if (context === 'manager') return 'manager';
        return 'lessons';
    }

    function areaKeys() {
        return ['lessons', 'analysis', 'hindus', 'texts', 'media', 'app', 'vocab', 'manager'];
    }

    function botList() {
        var out = [];
        var seen = {};
        var primary = AREAS[_context] || AREAS.lessons;
        primary.bots.concat(['Plonter_6_manager_bot', 'Plonter_8_milon_bot']).forEach(function(bot) {
            if (!seen[bot]) {
                seen[bot] = true;
                out.push(bot);
            }
        });
        return out;
    }

    function load() {
        _loading = true;
        _status = 'טוען משימות...';
        render();
        var feedRequests = botList().map(function(bot) {
            return fetchJson(TASKS_BASE + encodeURIComponent(bot) + '&t=' + Date.now()).then(function(data) {
                return { bot: bot, data: data };
            }).catch(function(error) {
                return { bot: bot, error: error };
            });
        });
        // Central daily_tasks feed (SSOT). Filter tag=פלונטר — the feed holds every Amitai task.
        var centralRequest = fetchJson(CENTRAL_FEED + '&t=' + Date.now()).then(function(data) {
            var all = (data && Array.isArray(data.tasks)) ? data.tasks : [];
            var plonter = all.filter(function(t) {
                return (t && Array.isArray(t.tags)) ? t.tags.indexOf(CENTRAL_TAG) >= 0 : false;
            });
            return { bot: CENTRAL_BOT, data: { tasks: plonter } };
        }).catch(function(error) {
            return { bot: CENTRAL_BOT, error: error };
        });
        var trelloRequest = fetchJson(TRELLO_URL + '?t=' + Date.now()).catch(function(error) {
            return { _error: error };
        });
        // Central feed FIRST so its tag-categorized copy wins de-dup over per-bot copies of
        // the same underlying task (the central feed is the SSOT and carries every פלונטר task).
        Promise.all([centralRequest].concat(feedRequests).concat([trelloRequest])).then(function(results) {
            var trello = results.pop();
            _taskFeeds = results;
            _trelloCards = normalizeTrello(trello);
            _loaded = true;
            _loading = false;
            _status = '';
            render();
        }).catch(function() {
            _loading = false;
            _status = 'לא הצלחתי לטעון את המשימות';
            render();
        });
    }

    function fetchJson(url) {
        return fetch(url, { cache: 'no-store' }).then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        });
    }

    function normalizeTaskAppItems() {
        var items = [];
        _taskFeeds.forEach(function(feed) {
            var tasks = feed && feed.data && Array.isArray(feed.data.tasks) ? feed.data.tasks : [];
            tasks.forEach(function(task) {
                items.push({
                    source: 'taskapp',
                    sourceLabel: 'אפליקציית משימות',
                    id: 'taskapp:' + feed.bot + ':' + (task.id || task.title),
                    bot: feed.bot,
                    title: task.title || task.text || 'משימה',
                    desc: task.description || task.notes || '',
                    meta: task.deadline || task.due || task.generated_at || '',
                    actionUrls: task.action_urls || {},
                    raw: task
                });
            });
        });
        return dedupe(items);
    }

    function normalizeTrello(board) {
        if (!board || board._error || !Array.isArray(board.cards)) return [];
        var lists = {};
        (board.lists || []).forEach(function(list) {
            lists[list.id] = list.name || '';
        });
        return board.cards.filter(function(card) {
            return card && !card.closed;
        }).map(function(card) {
            return {
                source: 'trello',
                sourceLabel: 'Trello',
                id: 'trello:' + card.id,
                title: card.name || 'כרטיס',
                desc: card.desc || '',
                list: lists[card.idList] || '',
                meta: lists[card.idList] || '',
                url: card.shortUrl || card.url || '',
                labels: (card.labels || []).map(function(label) { return label.name || ''; }),
                raw: card
            };
        });
    }

    function dedupe(items) {
        // De-dup by the UNDERLYING central daily_tasks id (globally unique), so the same task
        // arriving from both the central feed and a per-bot feed collapses to ONE row. Central
        // feed is processed first (see load()), so its tag-categorized copy is the one kept.
        var seen = {};
        return items.filter(function(item) {
            var rawId = item.raw && (item.raw.id != null) ? item.raw.id : null;
            var key = rawId != null ? ('tid:' + rawId) : (item.id || item.source + ':' + item.title);
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    function allItems() {
        return normalizeTaskAppItems().concat(_trelloCards).filter(function(item) {
            return !isHidden(item.id);
        });
    }

    function itemsForArea(areaKey) {
        var area = AREAS[areaKey] || AREAS.lessons;
        return allItems().filter(function(item) {
            return itemMatchesArea(item, area);
        }).sort(function(a, b) {
            var pa = priorityInfo(a);
            var pb = priorityInfo(b);
            if (pa.score !== pb.score) return pa.score - pb.score;
            if (a.source !== b.source) return a.source === 'taskapp' ? -1 : 1;
            return String(a.title).localeCompare(String(b.title), 'he');
        });
    }

    function activeCountForArea(areaKey) {
        return itemsForArea(areaKey).filter(function(item) {
            return !isDone(item.id);
        }).length;
    }

    function currentItems() {
        var items = itemsForArea(_context);
        if (_subcategory && _subcategory !== 'all') {
            items = items.filter(function(item) {
                return itemSubcategory(item) === _subcategory;
            });
        }
        return items;
    }

    // Plonter category tag → area key. Bots tag central tasks פלונטר+בדיקה+<קטגוריה>.
    var CATEGORY_TAG_TO_AREA = {
        'שיעורים': 'lessons', 'שיעור': 'lessons',
        'תחביר': 'analysis', 'ניתוח': 'analysis',
        'הינדוס': 'hindus', 'הנדוס': 'hindus',
        'טקסטים': 'texts', 'טקסט': 'texts',
        'מדיה': 'media',
        'אפליקציות': 'app', 'אפליקציה': 'app', 'אפליקציית': 'app', 'אפליציית': 'app',
        'אוצר מילים': 'vocab', 'אוצר-מילים': 'vocab', 'אוצמ': 'vocab', 'מילון': 'vocab'
    };

    function itemTags(item) {
        return (item && item.raw && Array.isArray(item.raw.tags)) ? item.raw.tags : [];
    }

    // Area key for a central-feed (luz_metoraf_bot) item, from its category tag. Default כללי.
    function centralArea(item) {
        var tags = itemTags(item);
        for (var i = 0; i < tags.length; i++) {
            if (CATEGORY_TAG_TO_AREA[tags[i]]) return CATEGORY_TAG_TO_AREA[tags[i]];
        }
        return 'manager';
    }

    // A "בדיקה" item = central-feed task (already פלונטר-filtered) carrying the בדיקה tag.
    function isBdika(item) {
        return item.source === 'taskapp' && item.bot === CENTRAL_BOT && itemTags(item).indexOf('בדיקה') >= 0;
    }

    function itemMatchesArea(item, area) {
        if (item.source === 'taskapp') {
            if (item.bot === CENTRAL_BOT) {
                return area === (AREAS[centralArea(item)] || AREAS.manager);
            }
            if ((area.bots || []).indexOf(item.bot) >= 0) return true;
            if (item.bot === 'Plonter_6_manager_bot' || item.bot === 'Plonter_8_milon_bot') {
                return textMatchesTerms(itemText(item), area.terms);
            }
            return false;
        }
        if (area === AREAS.manager && !textMatchesTerms(itemText(item), area.terms.concat(AREAS.manager.terms))) {
            return !trelloMatchesNonManagerArea(item);
        }
        return textMatchesTerms(itemText(item), area.terms.concat(AREAS.manager.terms));
    }

    function trelloMatchesNonManagerArea(item) {
        return areaKeys().some(function(key) {
            if (key === 'manager') return false;
            return textMatchesTerms(itemText(item), (AREAS[key] || {}).terms || []);
        });
    }

    function itemSubcategory(item) {
        if (item.source === 'trello') return item.list || 'ללא רשימה';
        return item.sourceLabel || item.bot || 'אפליקציית משימות';
    }

    function subcategoryCounts() {
        var counts = {};
        itemsForArea(_context).forEach(function(item) {
            if (isDone(item.id)) return;
            var key = itemSubcategory(item);
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }

    function itemText(item) {
        return [
            item.title,
            item.desc,
            item.meta,
            item.list,
            (item.labels || []).join(' ')
        ].join(' ').toLowerCase();
    }

    function textMatchesTerms(text, terms) {
        text = String(text || '').toLowerCase();
        return (terms || []).some(function(term) {
            return text.indexOf(String(term).toLowerCase()) >= 0;
        });
    }

    function render() {
        var root = document.getElementById(_activeRootId) || document.getElementById('tasks-panel-welcome');
        if (!root) return;
        var compact = _activeRootId === 'tasks-panel-side-content';
        renderIshurim(root, compact);
    }

    function summaryHtml(items) {
        if (!_loaded || !items.length) return '';
        var groups = {};
        items.forEach(function(item) {
            var info = priorityInfo(item);
            groups[info.type] = (groups[info.type] || 0) + 1;
        });
        var chips = Object.keys(groups).sort(function(a, b) {
            return groups[b] - groups[a];
        }).slice(0, 7).map(function(type) {
            return '<span style="padding:5px 9px;border:1px solid #cbd5e1;border-radius:999px;background:white;color:#334155;font-size:0.86em">' + esc(type + ' ' + groups[type]) + '</span>';
        }).join('');
        var top = items.slice(0, 3).map(function(item, idx) {
            return '<span style="display:block;color:#475569;font-size:0.86em;margin-top:4px">' + (idx + 1) + '. ' + esc(trimDesc(item.title).slice(0, 74)) + '</span>';
        }).join('');
        return '' +
            '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,0.7fr);gap:10px;margin-bottom:12px">' +
                '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px">' +
                    '<div style="font-weight:bold;color:#334155;margin-bottom:7px">תיוג אוטומטי לפי כל הקלפים</div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap">' + chips + '</div>' +
                '</div>' +
                '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px">' +
                    '<div style="font-weight:bold;color:#9a3412;margin-bottom:4px">ראש התור</div>' +
                    top +
                '</div>' +
            '</div>';
    }

    function viewToggleHtml() {
        var bdikaCount = _loaded ? bdikaItems().filter(function(i) { return !isDone(i.id); }).length : 0;
        var focusOn = !_bdikaView && !_showArchive && _focusView;
        var allOn = !_bdikaView && !_showArchive && !_focusView;
        var archOn = !_bdikaView && _showArchive;
        return '' +
            '<div style="display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;margin-bottom:12px">' +
                '<button type="button" id="tasks-focus-view-btn" style="padding:8px 12px;border:none;cursor:pointer;font-weight:bold;background:' + (focusOn ? '#334155' : 'white') + ';color:' + (focusOn ? 'white' : '#334155') + '">מה עכשיו</button>' +
                '<button type="button" id="tasks-active-view-btn" style="padding:8px 12px;border:none;border-right:1px solid #cbd5e1;cursor:pointer;font-weight:bold;background:' + (allOn ? '#334155' : 'white') + ';color:' + (allOn ? 'white' : '#334155') + '">כל הפעילות</button>' +
                '<button type="button" id="tasks-archive-view-btn" style="padding:8px 12px;border:none;border-right:1px solid #cbd5e1;cursor:pointer;font-weight:bold;background:' + (archOn ? '#334155' : 'white') + ';color:' + (archOn ? 'white' : '#334155') + '">ארכיון</button>' +
                '<button type="button" id="tasks-bdika-view-btn" style="padding:8px 12px;border:none;border-right:1px solid #cbd5e1;cursor:pointer;font-weight:bold;background:' + (_bdikaView ? '#7c3aed' : 'white') + ';color:' + (_bdikaView ? 'white' : '#7c3aed') + '">🔎 בדיקה' + (bdikaCount ? ' (' + bdikaCount + ')' : '') + '</button>' +
            '</div>';
    }

    function bdikaItems() {
        return allItems().filter(isBdika);
    }

    function bdikaCountForArea(key) {
        return bdikaItems().filter(function(item) {
            return !isDone(item.id) && centralArea(item) === key;
        }).length;
    }

    // "בדיקה" view: all pending verification tasks, grouped by category. Cross-category (ignores _context).
    function bdikaViewHtml() {
        if (!_loaded) return '<div style="color:#64748b">טוען...</div>';
        var pending = bdikaItems().filter(function(item) { return !isDone(item.id); });
        if (!pending.length) {
            return '<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:18px;text-align:center;color:#64748b">אין כרגע משימות שממתינות לבדיקה שלך 🎉</div>';
        }
        var groups = {};
        pending.forEach(function(item) {
            var key = centralArea(item);
            (groups[key] = groups[key] || []).push(item);
        });
        var html = '<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:10px 12px;margin-bottom:12px;color:#6b21a8;font-size:0.9em">משימות שבוטי פלונטר ביצעו וממתינות לאימות שלך. כשתאשר שעובד — סמן "בוצע".</div>';
        areaKeys().forEach(function(key) {
            var list = groups[key];
            if (!list || !list.length) return;
            html += '<div style="margin:14px 0 6px;font-weight:bold;color:#334155;font-size:1.05em;border-bottom:2px solid #e9d5ff;padding-bottom:4px">' + esc((AREAS[key] || AREAS.manager).label) + ' (' + list.length + ')</div>';
            html += list.map(cardHtml).join('');
        });
        return html;
    }

    function addTaskHtml(area) {
        return '' +
            '<form id="tasks-add-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">' +
                '<input id="tasks-add-title" type="text" placeholder="הוסף משימה ל' + esc(area.label) + '" style="flex:1;min-width:220px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:0.95em">' +
                '<label for="tasks-add-image" title="צרף תמונה" style="padding:9px 11px;background:white;color:#0d9488;border:1px solid #0d9488;border-radius:8px;font-weight:bold;cursor:pointer">תמונה</label>' +
                '<input id="tasks-add-image" type="file" accept="image/*" style="display:none">' +
                '<span id="tasks-add-image-name" style="color:#64748b;font-size:0.85em"></span>' +
                '<button type="submit" style="padding:9px 12px;background:#0d9488;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer">הוסף למשימות</button>' +
            '</form>';
    }

    function areaSelectHtml() {
        var html = '<select id="tasks-area-select" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:white;font-weight:bold">';
        areaKeys().forEach(function(key) {
            var count = _loaded ? activeCountForArea(key) : 0;
            var bd = _loaded ? bdikaCountForArea(key) : 0;
            var label = AREAS[key].label + ' (' + count + (bd ? ' | ' + bd + ' לבדיקה' : '') + ')';
            html += '<option value="' + esc(key) + '"' + (key === _context ? ' selected' : '') + '>' + esc(label) + '</option>';
        });
        return html + '</select>';
    }

    function subcategorySelectHtml() {
        var counts = subcategoryCounts();
        var keys = Object.keys(counts).sort(function(a, b) {
            if (counts[b] !== counts[a]) return counts[b] - counts[a];
            return a.localeCompare(b, 'he');
        });
        if (!_loaded || keys.length < 2) return '';
        var total = keys.reduce(function(sum, key) { return sum + counts[key]; }, 0);
        var html = '<select id="tasks-subcategory-select" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:white;font-weight:bold;max-width:220px">';
        html += '<option value="all"' + (_subcategory === 'all' ? ' selected' : '') + '>הכל (' + total + ')</option>';
        keys.forEach(function(key) {
            html += '<option value="' + esc(key) + '"' + (key === _subcategory ? ' selected' : '') + '>' + esc(key + ' (' + counts[key] + ')') + '</option>';
        });
        return html + '</select>';
    }

    function emptyHtml() {
        if (_loading) return '<div style="padding:22px;text-align:center;color:#64748b">טוען...</div>';
        return '<div style="padding:22px;text-align:center;color:#64748b;background:#f8fafc;border-radius:8px">אין כרגע משימות להצגה בהקשר הזה.</div>';
    }

    function archiveEmptyHtml() {
        if (_loading) return '<div style="padding:22px;text-align:center;color:#64748b">טוען...</div>';
        return '<div style="padding:22px;text-align:center;color:#64748b;background:#f8fafc;border-radius:8px">אין כרגע משימות בארכיון של ההקשר הזה.</div>';
    }

    function cardHtml(item) {
        var doneLabel = item.source === 'trello' ? 'העבר למשימות' : (item.source === 'taskapp' && item.actionUrls && item.actionUrls.done ? 'בוצע' : 'סימנתי שהצלחתי');
        var openLink = item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" style="color:#0d9488;font-weight:bold;text-decoration:none">פתח מקור</a>' : '';
        var starred = isStarred(item.id);
        var starRemote = item.actionUrls && item.actionUrls.star;
        var starLabel = starred ? (starRemote ? '★ מסומן' : '★ מסומן מקומית') : '☆ כוכב';
        var info = priorityInfo(item);
        var snooze = snoozeMap()[item.id];
        var snoozeLabel = snooze && snooze.count ? 'עוד ' + snooze.count : 'עוד 10';
        return '' +
            '<article style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;background:#f8fafc" data-task-id="' + esc(item.id) + '">' +
                '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
                    '<div style="min-width:220px;flex:1">' +
                        '<div style="font-weight:bold;color:#111827;font-size:1.02em;line-height:1.35">' + esc(item.title) + '</div>' +
                        '<div style="color:#64748b;font-size:0.86em;margin-top:4px">' + esc(item.sourceLabel) + (item.bot ? ' · ' + esc(item.bot) : '') + (item.meta ? ' · ' + esc(item.meta) : '') + '</div>' +
                        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">' +
                            '<span style="padding:3px 7px;border-radius:999px;background:' + esc(info.color) + ';color:white;font-size:0.78em;font-weight:bold">' + esc(info.priority) + '</span>' +
                            '<span style="padding:3px 7px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:0.78em;font-weight:bold">' + esc(info.type) + '</span>' +
                            (info.area ? '<span style="padding:3px 7px;border-radius:999px;background:#ecfeff;color:#155e75;font-size:0.78em;font-weight:bold">' + esc(info.area) + '</span>' : '') +
                        '</div>' +
                        (item.desc ? '<div style="color:#374151;font-size:0.9em;margin-top:8px;white-space:pre-wrap">' + esc(trimDesc(item.desc)) + '</div>' : '') +
                        (item.actionUrls && item.actionUrls.image ? '<div style="margin-top:8px"><img src="' + esc(item.actionUrls.image) + '" alt="תמונת משימה" loading="lazy" style="max-width:180px;max-height:130px;border-radius:8px;border:1px solid #e5e7eb;cursor:zoom-in" onclick="window.open(this.src,\'_blank\')"></div>' : '') +
                    '</div>' +
                    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                        openLink +
                        '<button type="button" class="tasks-star-btn" data-task-id="' + esc(item.id) + '" data-star-url="' + esc(starRemote || '') + '" style="padding:7px 12px;background:' + (starred ? '#f59e0b' : '#fff7ed') + ';color:#92400e;border:1px solid #fbbf24;border-radius:8px;font-weight:bold;cursor:pointer">' + esc(starLabel) + '</button>' +
                        '<button type="button" class="tasks-snooze-btn" data-task-id="' + esc(item.id) + '" style="padding:7px 12px;background:#e0f2fe;color:#075985;border:1px solid #7dd3fc;border-radius:8px;font-weight:bold;cursor:pointer">' + esc(snoozeLabel) + '</button>' +
                        '<button type="button" class="' + (item.source === 'trello' ? 'tasks-mirror-btn' : 'tasks-done-btn') + '" data-task-id="' + esc(item.id) + '" data-done-url="' + esc((item.actionUrls && item.actionUrls.done) || '') + '" style="padding:7px 12px;background:#16a34a;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer">' + esc(doneLabel) + '</button>' +
                    '</div>' +
                '</div>' +
            '</article>';
    }

    function archiveCardHtml(item) {
        var done = doneMap()[item.id] || {};
        return '' +
            '<article style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;background:#f8fafc;opacity:0.9" data-task-id="' + esc(item.id) + '">' +
                '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
                    '<div style="min-width:220px;flex:1">' +
                        '<div style="font-weight:bold;color:#111827;font-size:1.02em;line-height:1.35">' + esc(item.title) + '</div>' +
                        '<div style="color:#64748b;font-size:0.86em;margin-top:4px">' + esc(item.sourceLabel || 'משימה') + (item.bot ? ' · ' + esc(item.bot) : '') + (done.at ? ' · סומן: ' + esc(formatDate(done.at)) : '') + '</div>' +
                        (item.desc ? '<div style="color:#374151;font-size:0.9em;margin-top:8px;white-space:pre-wrap">' + esc(trimDesc(item.desc)) + '</div>' : '') +
                    '</div>' +
                    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                        (item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" style="color:#0d9488;font-weight:bold;text-decoration:none">פתח מקור</a>' : '') +
                        '<button type="button" class="tasks-restore-btn" data-task-id="' + esc(item.id) + '" style="padding:7px 12px;background:#0d9488;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer">החזר לפעילות</button>' +
                        '<button type="button" class="tasks-archive-delete-btn" data-task-id="' + esc(item.id) + '" style="padding:7px 12px;background:#ef4444;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer">מחק מהארכיון</button>' +
                    '</div>' +
                '</div>' +
            '</article>';
    }

    function trimDesc(desc) {
        desc = String(desc || '').trim();
        return desc.length > 420 ? desc.slice(0, 420) + '...' : desc;
    }

    function bind() {
        var refresh = document.getElementById('tasks-refresh-btn');
        if (refresh) refresh.onclick = function() {
            _loaded = false;
            load();
        };
        var focusView = document.getElementById('tasks-focus-view-btn');
        if (focusView) focusView.onclick = function() {
            _bdikaView = false;
            _showArchive = false;
            _focusView = true;
            render();
        };
        var activeView = document.getElementById('tasks-active-view-btn');
        if (activeView) activeView.onclick = function() {
            _bdikaView = false;
            _showArchive = false;
            _focusView = false;
            render();
        };
        var archiveView = document.getElementById('tasks-archive-view-btn');
        if (archiveView) archiveView.onclick = function() {
            _bdikaView = false;
            _showArchive = true;
            render();
        };
        var bdikaView = document.getElementById('tasks-bdika-view-btn');
        if (bdikaView) bdikaView.onclick = function() {
            _bdikaView = true;
            _showArchive = false;
            render();
        };
        var select = document.getElementById('tasks-area-select');
        if (select) select.onchange = function() {
            _context = normalizeContext(select.value);
            _subcategory = 'all';
            render();
        };
        var subSelect = document.getElementById('tasks-subcategory-select');
        if (subSelect) subSelect.onchange = function() {
            _subcategory = subSelect.value || 'all';
            render();
        };
        var addForm = document.getElementById('tasks-add-form');
        if (addForm) addForm.onsubmit = function(e) {
            e.preventDefault();
            addTaskFromForm();
        };
        var addImage = document.getElementById('tasks-add-image');
        if (addImage) addImage.onchange = function() {
            var nameEl = document.getElementById('tasks-add-image-name');
            if (nameEl) nameEl.textContent = (addImage.files && addImage.files[0]) ? '✓ ' + addImage.files[0].name : '';
        };
        document.querySelectorAll('.tasks-done-btn').forEach(function(btn) {
            btn.onclick = function() {
                markDone(btn.dataset.taskId, btn.dataset.doneUrl || '');
            };
        });
        document.querySelectorAll('.tasks-mirror-btn').forEach(function(btn) {
            btn.onclick = function() {
                mirrorTrello(btn.dataset.taskId, btn);
            };
        });
        document.querySelectorAll('.tasks-star-btn').forEach(function(btn) {
            btn.onclick = function() {
                toggleStar(btn.dataset.taskId, btn.dataset.starUrl || '');
            };
        });
        document.querySelectorAll('.tasks-snooze-btn').forEach(function(btn) {
            btn.onclick = function() {
                snoozeMore(btn.dataset.taskId);
            };
        });
        document.querySelectorAll('.tasks-restore-btn').forEach(function(btn) {
            btn.onclick = function() {
                restoreDone(btn.dataset.taskId);
            };
        });
        document.querySelectorAll('.tasks-archive-delete-btn').forEach(function(btn) {
            btn.onclick = function() {
                deleteArchived(btn.dataset.taskId);
            };
        });
    }

    function doneMap() {
        try {
            return JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function isDone(id) {
        return !!doneMap()[id];
    }

    function hiddenMap() {
        try {
            return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function isHidden(id) {
        return !!hiddenMap()[id];
    }

    function snapshotItem(item) {
        if (!item) return null;
        return {
            source: item.source,
            sourceLabel: item.sourceLabel,
            id: item.id,
            bot: item.bot,
            title: item.title,
            desc: item.desc,
            meta: item.meta,
            list: item.list,
            url: item.url,
            labels: item.labels || []
        };
    }

    function archivedItems() {
        var map = doneMap();
        var byId = {};
        currentItems().forEach(function(item) {
            if (map[item.id]) byId[item.id] = item;
        });
        Object.keys(map).forEach(function(id) {
            if (isHidden(id)) return;
            if (!byId[id] && map[id] && map[id].item) byId[id] = map[id].item;
        });
        return Object.keys(byId).map(function(id) {
            var item = byId[id];
            item.id = item.id || id;
            return item;
        }).sort(function(a, b) {
            var atA = (map[a.id] && map[a.id].at) || '';
            var atB = (map[b.id] && map[b.id].at) || '';
            return String(atB).localeCompare(String(atA));
        });
    }

    function markDone(id, url) {
        var item = currentItems().find(function(candidate) { return candidate.id === id; });
        var map = doneMap();
        map[id] = { at: new Date().toISOString(), item: snapshotItem(item) };
        localStorage.setItem(DONE_KEY, JSON.stringify(map));
        render();
        if (!url) return;
        fetch(url, { cache: 'no-store', mode: 'no-cors' }).catch(function() {});
    }

    function restoreDone(id) {
        var map = doneMap();
        var hidden = hiddenMap();
        delete map[id];
        delete hidden[id];
        localStorage.setItem(DONE_KEY, JSON.stringify(map));
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
        _status = 'המשימה הוחזרה לרשימת הפעילות המקומית.';
        render();
    }

    function deleteArchived(id) {
        if (!confirm('להסתיר את המשימה מהארכיון המקומי? היא לא תחזור לפעילות.')) return;
        var map = doneMap();
        var hidden = hiddenMap();
        hidden[id] = { at: new Date().toISOString(), fromArchive: true, item: map[id] && map[id].item };
        localStorage.setItem(DONE_KEY, JSON.stringify(map));
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
        _showArchive = true;
        _status = 'המשימה הוסתרה מהארכיון המקומי ולא תחזור לפעילות.';
        render();
    }

    function mirrorTrello(id, btn) {
        var item = _trelloCards.find(function(card) { return card.id === id; });
        if (!item || !btn) return;
        var area = AREAS[_context] || AREAS.manager;
        var body = new URLSearchParams();
        body.set('bot', area.taskBot || 'plonter_6_manager_bot');
        body.set('title', item.title);
        body.set('deadline', defaultDeadline());
        btn.disabled = true;
        btn.textContent = 'מעביר...';
        fetch(ADD_TASK_URL, {
            method: 'POST',
            body: body,
            cache: 'no-store',
            mode: 'no-cors'
        }).then(function() {
            var map = doneMap();
            map[id] = { at: new Date().toISOString(), mirrored: true, bot: area.taskBot || 'plonter_6_manager_bot', item: snapshotItem(item) };
            localStorage.setItem(DONE_KEY, JSON.stringify(map));
            _status = 'הכרטיס הועבר למשימות. הוא יופיע בפיד אחרי הרענון הבא.';
            setTimeout(load, 5000);
            render();
        }).catch(function() {
            btn.disabled = false;
            btn.textContent = 'העבר למשימות';
            _status = 'לא הצלחתי להעביר למשימות כרגע';
            render();
        });
    }

    function addTaskFromForm() {
        var input = document.getElementById('tasks-add-title');
        var title = input ? input.value.trim() : '';
        if (!title) {
            _status = 'כתוב משימה לפני ההוספה';
            render();
            return;
        }
        var area = AREAS[_context] || AREAS.manager;
        var bot = area.taskBot || 'plonter_6_manager_bot';
        var fileInput = document.getElementById('tasks-add-image');
        var file = (fileInput && fileInput.files && fileInput.files[0]) ? fileInput.files[0] : null;
        var prep;
        if (file) {
            _status = 'מעלה תמונה...';
            render();
            prep = uploadImage(file);
        } else {
            prep = Promise.resolve('');
        }
        prep.then(function(imageUrl) {
            return postTask(bot, title, imageUrl);
        }).then(function() {
            _status = 'המשימה נוספה. היא תופיע בפיד אחרי הרענון הבא.';
            setTimeout(load, 5000);
            render();
        }).catch(function(err) {
            _status = (err && err._upload) ? 'לא הצלחתי לקלוט את התמונה — נסה שוב או הוסף בלי תמונה.' : 'לא הצלחתי להוסיף את המשימה כרגע';
            render();
        });
    }

    // Upload an image to the Plonter store; resolves with a public URL string for image_url.
    function uploadImage(file) {
        var fd = new FormData();
        fd.append('image', file);
        return fetch(UPLOAD_URL, { method: 'POST', body: fd, cache: 'no-store' }).then(function(res) {
            return res.json().catch(function() { return null; });
        }).then(function(data) {
            if (data && data.ok && data.url) return data.url;
            var e = new Error((data && data.error) || 'upload failed');
            e._upload = true;
            throw e;
        }, function() {
            var e = new Error('upload network error');
            e._upload = true;
            throw e;
        });
    }

    function postTask(bot, title, imageUrl) {
        var body = new URLSearchParams();
        body.set('bot', bot);
        body.set('title', title);
        body.set('deadline', defaultDeadline());
        if (imageUrl) body.set('image_url', imageUrl);
        return fetch(ADD_TASK_URL, {
            method: 'POST',
            body: body,
            cache: 'no-store',
            mode: 'no-cors'
        }).then(function() {
            return true;
        });
    }

    function toggleStar(id, url) {
        var map = starMap();
        var next = !map[id];
        if (next) {
            map[id] = { at: new Date().toISOString(), remote: !!url };
        } else {
            delete map[id];
        }
        localStorage.setItem(STAR_KEY, JSON.stringify(map));
        render();
        if (!url) {
            _status = next ? 'הכוכב נשמר מקומית עד שתהיה תמיכה מלאה באפליקציית המשימות.' : '';
            render();
            return;
        }
        fetch(url, { cache: 'no-store', mode: 'no-cors' }).catch(function() {
            _status = 'הכוכב נשמר מקומית, אבל הסנכרון לאפליקציית המשימות נכשל כרגע.';
            render();
        });
    }

    function defaultDeadline() {
        var d = new Date();
        d.setHours(d.getHours() + 1, 0, 0, 0);
        function pad(n) { return String(n).padStart(2, '0'); }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
    }

    function starMap() {
        try {
            return JSON.parse(localStorage.getItem(STAR_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function isStarred(id) {
        return !!starMap()[id];
    }

    function snoozeMap() {
        try {
            return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function snoozeMore(id) {
        var map = snoozeMap();
        var current = map[id] && map[id].count ? parseInt(map[id].count, 10) : 0;
        map[id] = { count: current + 10, at: new Date().toISOString() };
        localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
        _status = 'דחפתי את המשימה אחורה בעוד 10 מקומות בתור המקומי.';
        render();
    }

    function priorityInfo(item) {
        var text = itemText(item);
        var list = String(item.list || item.meta || '').toLowerCase();
        var tags = (item.labels || []).join(' ').toLowerCase();
        var score = 500;
        var type = 'משמעותי';
        var priority = 'רגיל';
        var color = '#475569';
        if (item.source === 'taskapp') score -= 160;
        if (isStarred(item.id)) score -= 140;
        if (/(דחוף|קריטי|critical|urgent|שבור|לא עובד|תקלה|bug|באג)/i.test(text)) {
            score -= 120; type = 'באג דחוף'; priority = 'גבוה'; color = '#dc2626';
        } else if (/(בדיקה|verify|qa|test|בדוק|לבדוק)/i.test(text)) {
            score -= 70; type = 'בדיקה'; priority = 'גבוה'; color = '#d97706';
        } else if (/(קטן|שינוי שם|צבע|כפתור|מיקרו|minor|copy|label|rename)/i.test(text)) {
            score -= 50; type = 'עכשיו קטן'; priority = 'מהיר'; color = '#0d9488';
        } else if (/(סקיצה|תכנון|design|ux|אפיון|רעיון|brainstorm|אולי)/i.test(text + ' ' + list + ' ' + tags)) {
            score += 45; type = 'דורש חשיבה'; priority = 'אח"כ'; color = '#7c3aed';
        } else if (/(דאטא|database|db|sync|סנכרון|migration|api|שרת|server|localstorage)/i.test(text + ' ' + list)) {
            score -= 25; type = 'תוכן-דאטה'; priority = 'חשוב'; color = '#0369a1';
        }
        if (/(בוצע|done|סגור|archive)/i.test(list)) score += 140;
        if (/(בלאגן|לא מתקן|אחכ|אח\"כ|אולי)/i.test(list)) score += 90;
        if (/(כניסה|הרשמה|אבטחה|סיסמה|משתמש)/i.test(text + ' ' + list)) score -= 35;
        if (/(אוצם|אוצר|מילון)/i.test(list)) score -= 10;
        var snooze = snoozeMap()[item.id];
        if (snooze && snooze.count) score += parseInt(snooze.count, 10) * 18;
        return {
            score: score,
            type: type,
            priority: priority,
            color: color,
            area: item.source === 'trello' ? (item.list || '') : (item.bot || '')
        };
    }

    function formatDate(value) {
        var d = new Date(value);
        if (isNaN(d.getTime())) return value;
        return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function telegramForContext(context) {
        var area = AREAS[normalizeContext(context || _context)] || AREAS.manager;
        return area.telegram;
    }

    function esc(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    // --- אישורים view (admin password-reset management) ---

    function getAdminToken() {
        return (window.PlonterAuth && PlonterAuth.getToken && PlonterAuth.getToken()) ||
               localStorage.getItem('plonter_auth_token') || '';
    }

    function loadUsers(root, compact) {
        var token = getAdminToken();
        _ishurimLoading = true;
        _ishurimError = '';
        renderIshurim(root, compact);
        fetch('/plonter/api/auth_email.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'admin_list_users', token: token })
        }).then(function(res) { return res.json(); }).then(function(data) {
            _ishurimLoading = false;
            if (!data.ok) {
                _ishurimError = data.error || 'שגיאה בטעינת המשתמשים';
            } else {
                _ishurimUsers = data.users || [];
            }
            renderIshurim(root, compact);
        }).catch(function() {
            _ishurimLoading = false;
            _ishurimError = 'שגיאת רשת — לא הצלחתי להגיע לשרת';
            renderIshurim(root, compact);
        });
    }

    function renderIshurim(root, compact) {
        var token = getAdminToken();
        var html = '<div style="background:white;border:' + (compact ? 'none' : '1px solid #e5e7eb') + ';border-radius:' + (compact ? '0' : '10px') + ';padding:' + (compact ? '12px' : '16px') + ';text-align:right;direction:rtl">';
        html += '<h2 style="margin:0 0 14px;color:#0d9488;font-size:1.25em">אישורים — ניהול איפוסי סיסמה</h2>';

        if (!token) {
            html += '<div style="color:#dc2626;padding:12px;background:#fef2f2;border-radius:8px">לא נמצא טוקן מנהל. התחבר כמנהל ונסה שוב.</div>';
            html += '</div>';
            root.innerHTML = html;
            return;
        }

        if (_ishurimError) {
            html += '<div style="color:#dc2626;padding:12px;background:#fef2f2;border-radius:8px;margin-bottom:10px">' + esc(_ishurimError) + '</div>';
            html += '<button type="button" id="ishurim-retry-btn" style="padding:9px 14px;background:#0d9488;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer">נסה שוב</button>';
            html += '</div>';
            root.innerHTML = html;
            bindIshurim(root, compact, token);
            return;
        }

        if (_ishurimLoading || !_ishurimUsers) {
            html += '<div style="color:#64748b">טוען רשימת משתמשים...</div>';
            html += '</div>';
            root.innerHTML = html;
            if (!_ishurimLoading) loadUsers(root, compact);
            return;
        }

        html += '<input id="ishurim-search" type="text" placeholder="חפש לפי שם או מייל..." value="' + esc(_ishurimFilter) + '" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:0.95em;margin-bottom:14px">';

        var users = _ishurimUsers.filter(function(u) {
            if (!_ishurimFilter) return true;
            var q = _ishurimFilter.toLowerCase();
            return (String(u.first_name || '') + ' ' + String(u.last_name || '') + ' ' + String(u.email || '')).toLowerCase().indexOf(q) >= 0;
        });

        if (!users.length) {
            html += '<div style="color:#64748b;padding:14px;text-align:center;background:#f8fafc;border-radius:8px">לא נמצאו משתמשים</div>';
        } else {
            users.forEach(function(u) {
                var res = _ishurimLinks[u.id] || {};
                html += '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;background:#f8fafc" data-user-id="' + esc(String(u.id)) + '">';
                html += '<div style="font-weight:bold;color:#111827;margin-bottom:8px">' + esc(String(u.first_name || '') + ' ' + String(u.last_name || '')) + ' <span style="font-weight:normal;color:#64748b;font-size:0.9em">— ' + esc(u.email) + '</span>';
                if (u.role) html += ' <span style="margin-right:6px;padding:2px 7px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:0.78em">' + esc(u.role) + '</span>';
                html += '</div>';
                if (res.loading) {
                    html += '<span style="color:#64748b;font-size:0.9em">מייצר קישור...</span>';
                } else if (res.error) {
                    html += '<span style="color:#dc2626;font-size:0.9em;display:block;margin-bottom:6px">' + esc(res.error) + '</span>';
                    html += '<button type="button" class="ishurim-gen-btn" data-user-id="' + esc(String(u.id)) + '" style="padding:6px 12px;background:#0d9488;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:0.9em">נסה שוב</button>';
                } else if (res.link) {
                    html += '<div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:10px 12px">';
                    html += '<div style="color:#0d9488;font-size:0.85em;font-weight:bold;margin-bottom:6px">קישור חד-פעמי, תקף 24 שעות — שלח ידנית למשתמש</div>';
                    html += '<div style="word-break:break-all;color:#334155;font-size:0.88em;direction:ltr;text-align:left;margin-bottom:8px">' + esc(res.link) + '</div>';
                    html += '<button type="button" class="ishurim-copy-btn" data-link="' + esc(res.link) + '" style="padding:6px 12px;background:#0891b2;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:0.9em">העתק</button>';
                    html += '</div>';
                } else {
                    html += '<button type="button" class="ishurim-gen-btn" data-user-id="' + esc(String(u.id)) + '" style="padding:6px 12px;background:#0d9488;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:0.9em">ייצר קישור איפוס</button>';
                }
                html += '</div>';
            });
        }

        html += '</div>';
        root.innerHTML = html;
        bindIshurim(root, compact, token);
    }

    function bindIshurim(root, compact, token) {
        var search = document.getElementById('ishurim-search');
        if (search) {
            search.oninput = function() {
                _ishurimFilter = search.value;
                renderIshurim(root, compact);
            };
        }
        var retryBtn = document.getElementById('ishurim-retry-btn');
        if (retryBtn) {
            retryBtn.onclick = function() {
                _ishurimUsers = null;
                _ishurimError = '';
                renderIshurim(root, compact);
            };
        }
        document.querySelectorAll('.ishurim-gen-btn').forEach(function(btn) {
            btn.onclick = function() {
                var userId = parseInt(btn.dataset.userId, 10);
                _ishurimLinks[userId] = { loading: true };
                renderIshurim(root, compact);
                fetch('/plonter/api/auth_email.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'admin_reset_token', user_id: userId, token: token })
                }).then(function(res) { return res.json(); }).then(function(data) {
                    if (!data.ok) {
                        _ishurimLinks[userId] = { error: data.error || 'שגיאה בייצור קישור' };
                    } else {
                        _ishurimLinks[userId] = { link: data.link };
                    }
                    renderIshurim(root, compact);
                }).catch(function() {
                    _ishurimLinks[userId] = { error: 'שגיאת רשת — נסה שוב' };
                    renderIshurim(root, compact);
                });
            };
        });
        document.querySelectorAll('.ishurim-copy-btn').forEach(function(btn) {
            btn.onclick = function() {
                var link = btn.dataset.link;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(link).then(function() {
                        var orig = btn.textContent;
                        btn.textContent = '✓ הועתק';
                        setTimeout(function() { btn.textContent = orig; }, 2000);
                    }).catch(function() { prompt('העתק את הקישור:', link); });
                } else {
                    prompt('העתק את הקישור:', link);
                }
            };
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        open: open,
        init: init,
        refresh: load,
        updateVisibility: updateVisibility,
        telegramForContext: telegramForContext
    };
})();
