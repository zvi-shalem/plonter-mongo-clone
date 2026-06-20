// lessonPresenter.js — Viewer, presentation tools, drawing, highlight, diacritics
// Split from lessons.js — see REFACTOR_PLAN.md

(function(LM) {
    'use strict';
    var _ = LM._;

    // Import shared functions
    var loadLessons = _.loadLessons;
    var getLesson = _.getLesson;
    var escapeHtml = _.escapeHtml;
    var _stripDiacritics = _._stripDiacritics;
    var _buildDiacriticsMap = _._buildDiacriticsMap;
    var _showEditorToast = _._showEditorToast;
    var _showStyledConfirm = _._showStyledConfirm;
    var _onDictToggle = _._onDictToggle;
    var saveLessons = _.saveLessons;
    var _removeMediaButton = _._removeMediaButton;
    var _setupMediaButton = _._setupMediaButton;

    // Forward references to editor
    function renderLessonsList() { return LM.renderLessonsList(); }
    function openLessonEditor(id) { return LM.openLessonEditor(id); }

    // Presenter-local state
    var _canvasInited = false;
    var _ctrlCandleActive = false;
    var _ctrlCandlePrevTool = null;
    var _diacLongPress = null;


    function startLessonViewer(lessonId) {
        var lesson = getLesson(lessonId);
        if (!lesson || lesson.pages.length === 0) {
            MessageManager.show('אין דפים בשיעור', 'error');
            return;
        }

        _.viewerState = { lessonId: lessonId, currentPage: 0 };
        _.presenterCtx = {
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

        // Keyboard navigation
        document.addEventListener('keydown', _viewerKeyHandler);
        document.addEventListener('keydown', _ctrlCandleDown);
        document.addEventListener('keyup', _ctrlCandleUp);
    }

    function _buildPresenter(presenter, lesson) {
        var page = lesson.pages[_.viewerState.currentPage];
        var pageNum = _.viewerState.currentPage + 1;
        var totalPages = lesson.pages.length;
        var progress = (pageNum / totalPages * 100).toFixed(1);

        presenter.innerHTML =
            // Header: buttons LEFT, title CENTER, slide counter RIGHT
            '<div class="lp-header" style="position:relative">' +
                '<div class="lp-slide-counter" style="z-index:1">שקף <span id="lp-current">' + pageNum + '</span> / <span id="lp-total">' + totalPages + '</span></div>' +
                '<h1 style="position:absolute;left:0;right:0;text-align:center;pointer-events:none;margin:0">' + escapeHtml(lesson.title) + '</h1>' +
                '<div style="display:flex;gap:8px;align-items:center;z-index:1">' +
                    '<button class="lp-exit-btn" id="lp-edit-lesson">✏️ ערוך</button>' +
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
                    '<button class="lp-tool-btn" data-lp-tool="translate" title="תרגום — לכוד טקסט לחיפוש במילון">🔍<span class="lp-tool-label">תרגום</span></button>' +
                    '<button class="lp-tool-btn" data-lp-tool="diacritics" title="חושף ניקוד (לחיצה ארוכה = חשוף/הסתר הכל)">🕯️<span class="lp-tool-label">חושף ניקוד</span></button>' +
                    '<div class="lp-tool-divider"></div>' +
                    '<button class="lp-tool-btn" data-lp-tool="analyze" title="לכוד משפט לניתוח">🧩<span class="lp-tool-label">נתח</span></button>' +
                    '<button class="lp-tool-btn" data-lp-tool="hindus" title="לכוד משפט להינדוס">🏗️<span class="lp-tool-label">הנדס</span></button>' +
                    '<div class="lp-tool-divider"></div>' +
                    '<button class="lp-tool-btn" data-lp-tool="undo" title="Ctrl+Z" style="font-size:1em">↩<span class="lp-tool-label">בטל</span></button>' +
                    '<button class="lp-tool-btn" data-lp-tool="redo" title="Ctrl+Y" style="font-size:1em">↪<span class="lp-tool-label">שחזר</span></button>' +
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

        // Init canvas
        _initCanvas();
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
        for (var k in _.diacriticsMap) delete _.diacriticsMap[k];
        _buildDiacriticsMap(content);
        if (page.title) _buildDiacriticsMap(page.title);
        if (page.bodyText) _buildDiacriticsMap(page.bodyText);
        var displayContent = _stripDiacritics(content);

        if (page.type === 'text') {
            // Support rich text (HTML) content — if content has HTML tags, render as-is; otherwise escape
            var isRichText = /<[a-z][\s\S]*>/i.test(content);
            var textHtml = isRichText ? _stripDiacritics(content) : escapeHtml(displayContent);

            // Process qmark-hidden spans for viewer
            var qmarkResult = _processQmarkForViewer(textHtml);
            _.currentQmarkData = qmarkResult.data;
            textHtml = qmarkResult.html;

            container.innerHTML = title +
                '<div class="lp-arabic" style="text-align:right">' + textHtml + '</div>' + notes;

            // Wire qmark placeholder click handlers
            if (_.currentQmarkData.length > 0) {
                _wireQmarkPlaceholders(_.currentQmarkData);
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
                mediaHtml = '<div id="lp-video-wrap" style="text-align:center;margin:12px 0;position:relative">' + eyeBtn + '<video src="' + escapeAttr(mediaUrl) + '" controls style="max-width:100%;max-height:60vh;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:height 0.3s,opacity 0.3s"></video>' + numCtlBtn + '</div>';
            } else if (mediaUrl) {
                // Image (default)
                mediaHtml = '<div style="text-align:center;margin:12px 0"><img src="' + escapeAttr(mediaUrl) + '" style="max-width:100%;max-height:60vh;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.15)" onerror="this.style.display=\'none\'"></div>';
            }
            container.innerHTML = title + mediaHtml +
                (mediaBodyText ? '<div class="lp-arabic" style="text-align:right">' + mediaBodyText + '</div>' : '') +
                notes;
        }

        // Media tab in dictionary panel — available on ALL slides, blocked on media slides
        if (typeof Dictionary !== 'undefined') {
            var isMediaSlide = (page.type === 'image' || page.type === 'video') && (page.videoUrl || page.imageUrl);
            // Block media tab on media slides (video already showing in slide itself)
            Dictionary.setMediaTabBlocked(!!isMediaSlide);
            var mediaPage = null;
            if (isMediaSlide) {
                mediaPage = page;
            } else if (_.viewerState && _.viewerState.lessonId) {
                // Find first media page in lesson (check ALL pages for videoUrl OR imageUrl)
                var _lessonForMedia = getLesson(_.viewerState.lessonId);
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
                // Show floating media button on non-media slides
                if (!isMediaSlide) {
                    _setupMediaButton(mediaPage);
                } else {
                    _removeMediaButton();
                }
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
                // Don't handle if dict media tab has its own handler active
                if (typeof Dictionary !== 'undefined' && Dictionary._mediaKeyHandler) return;
                var videoWrap = document.getElementById('lp-video-wrap');
                if (!videoWrap) return;
                var keyMap = {'5': -1, '4': -4, '9': -7, '8': -10, '6': 1, '1': 4, '2': 7, '3': 10};
                var delta = keyMap[e.key];
                var isPlayPause = (e.key === '0' || e.key === ' ');
                var isArrow = (e.key === 'ArrowRight' || e.key === 'ArrowLeft');
                if (!delta && !isPlayPause && !isArrow) return;
                e.preventDefault();
                var seekDelta = delta || (e.key === 'ArrowRight' ? 5 : -5);
                var mainVid = videoWrap.querySelector('video');
                var mainIf = videoWrap.querySelector('iframe');
                if (isPlayPause) {
                    if (mainVid) { if (mainVid.paused) mainVid.play(); else mainVid.pause(); }
                    if (mainIf && mainIf.src && mainIf.src.indexOf('youtube') !== -1) {
                        // Toggle — use a stored state
                        window._lpYtPlaying = !window._lpYtPlaying;
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func: window._lpYtPlaying ? 'playVideo' : 'pauseVideo',args:''}), '*');
                    }
                } else {
                    if (mainVid) mainVid.currentTime = Math.max(0, mainVid.currentTime + seekDelta);
                    if (mainIf && mainIf.src && mainIf.src.indexOf('youtube') !== -1) {
                        window._lpYtTime = (window._lpYtTime || 0) + seekDelta;
                        if (window._lpYtTime < 0) window._lpYtTime = 0;
                        mainIf.contentWindow.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[window._lpYtTime, true]}), '*');
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
            dot.className = 'lp-dot' + (i === _.viewerState.currentPage ? ' active' : '');
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
        // Edit lesson — uses LessonSystem from lessons.js if available
        var editBtn = document.getElementById('lp-edit-lesson');
        if (editBtn) {
            editBtn.addEventListener('click', function() {
                var lessonId = _.viewerState ? _.viewerState.lessonId : null;
                if (lessonId && typeof LessonManager !== 'undefined') {
                    closeViewer();
                    LessonManager.openLessonEditor(lessonId);
                }
            });
        }

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
                if (_.presenterCtx.currentTool === tool) {
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
                        if (_.presenterCtx.currentTool !== 'diacritics') {
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
                        if (_.presenterCtx.currentTool !== 'diacritics') {
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

        // Draw palette
        presenter.querySelectorAll('[data-lp-draw]').forEach(function(dot) {
            dot.addEventListener('click', function(e) {
                e.stopPropagation();
                var color = dot.dataset.lpDraw;
                presenter.querySelectorAll('[data-lp-draw]').forEach(function(d) { d.classList.remove('selected'); });
                dot.classList.add('selected');
                if (color === 'eraser') {
                    _.presenterCtx.isEraser = true;
                } else {
                    _.presenterCtx.isEraser = false;
                    _.presenterCtx.drawColor = color;
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
                        var pageIdx = _.viewerState.currentPage;
                        _.presenterCtx.slideStrokes[pageIdx] = [];
                        _.presenterCtx.undoStack = [];
                        _.presenterCtx.redoStack = [];
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
                    _.presenterCtx.highlightColor = 'clear';
                });
            } else {
                dot.addEventListener('click', function(e) {
                    e.stopPropagation();
                    presenter.querySelectorAll('[data-lp-hl]').forEach(function(d) { d.classList.remove('selected'); });
                    dot.classList.add('selected');
                    _.presenterCtx.highlightColor = color;
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
        if (!_.presenterCtx.lpDictEngine) _.presenterCtx.lpDictEngine = 'milson';
        document.querySelectorAll('.lp-dict-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                _.presenterCtx.lpDictEngine = tab.dataset.engine;
                document.querySelectorAll('.lp-dict-tab').forEach(function(t) {
                    var isActive = t.dataset.engine === _.presenterCtx.lpDictEngine;
                    t.style.background = isActive ? '#0d9488' : '#f8fafc';
                    t.style.color = isActive ? 'white' : '#64748b';
                });
                var q = document.getElementById('lp-dict-input').value.trim();
                if (q) _searchDict(q);
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
            if (_.presenterCtx.currentTool !== 'highlight') return;
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
            if (_.presenterCtx.currentTool !== 'highlight') return;
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
            if (_.presenterCtx.currentTool === 'highlight') {
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
            } else if (_.presenterCtx.currentTool === 'analyze' || _.presenterCtx.currentTool === 'hindus') {
                var captureMode = _.presenterCtx.currentTool;
                var sel = window.getSelection();
                if (sel && !sel.isCollapsed) {
                    var text = sel.toString().trim();
                    if (text) {
                        sel.removeAllRanges();
                        _showAnalyzeConfirm(text, captureMode);
                    }
                }
            } else if (_.presenterCtx.currentTool === 'translate') {
                var sel = window.getSelection();
                if (sel && !sel.isCollapsed) {
                    var text = sel.toString().trim().replace(/[\u064B-\u065F\u0670]/g, '').replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '');
                    if (text) {
                        if (typeof Dictionary !== 'undefined') {
                            Dictionary.lookup(text);
                            _onDictToggle(true);
                        } else {
                            _toggleDict(true);
                            var dictInput = document.getElementById('lp-dict-input');
                            if (dictInput) { dictInput.value = text; _searchDict(text); }
                        }
                        _.presenterCtx._translateMouseupTime = Date.now();
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
        _.presenterCtx.currentTool = tool;

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
            if (viewport) viewport.style.setProperty('--highlight-color', _getHighlightRgba(_.presenterCtx.highlightColor));
        } else if (tool === 'diacritics') {
            _activateDiacritics();
        }
    }

    function _deactivateTool() {
        _.presenterCtx.currentTool = null;
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

        if (_.presenterCtx.diacriticsActive) _deactivateDiacritics();
    }

    // --- Drawing ---
    var _canvasInited = false;

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

        // Only add event listeners once
        if (!_canvasInited) {
            _canvasInited = true;

            canvas.addEventListener('mousedown', function(e) { _drawStart(e); });
            canvas.addEventListener('mousemove', function(e) { _drawMove(e); });
            canvas.addEventListener('mouseup', function() { _drawEnd(); });
            canvas.addEventListener('mouseleave', function() { _drawEnd(); });
            canvas.addEventListener('touchstart', function(e) { e.preventDefault(); _drawStart(e.touches[0]); }, { passive: false });
            canvas.addEventListener('touchmove', function(e) { e.preventDefault(); _drawMove(e.touches[0]); }, { passive: false });
            canvas.addEventListener('touchend', function() { _drawEnd(); });

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
        var pageIdx = _.viewerState.currentPage;
        var strokes = _.presenterCtx.slideStrokes[pageIdx];
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
        if (_.presenterCtx.currentTool !== 'draw') return;
        var canvas = document.getElementById('lp-canvas');
        if (!canvas) return;
        _.presenterCtx.drawing = true;
        var pos = _getDrawCoords(e);
        var ctx = canvas.getContext('2d');

        if (_.presenterCtx.isEraser) {
            _eraseStrokeAt(pos.x, pos.y);
            _.presenterCtx.currentStroke = null;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = _.presenterCtx.drawColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            _.presenterCtx.currentStroke = {
                color: _.presenterCtx.drawColor,
                width: 3,
                points: [{ x: pos.x, y: pos.y }]
            };
        }
    }

    function _drawMove(e) {
        if (!_.presenterCtx.drawing) return;
        var canvas = document.getElementById('lp-canvas');
        if (!canvas) return;
        var pos = _getDrawCoords(e);

        if (_.presenterCtx.isEraser) {
            _eraseStrokeAt(pos.x, pos.y);
            return;
        }
        if (!_.presenterCtx.currentStroke) return;
        var ctx = canvas.getContext('2d');
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        _.presenterCtx.currentStroke.points.push({ x: pos.x, y: pos.y });
    }

    function _drawEnd() {
        if (!_.presenterCtx.drawing) return;
        _.presenterCtx.drawing = false;
        var pageIdx = _.viewerState.currentPage;
        if (_.presenterCtx.currentStroke && _.presenterCtx.currentStroke.points.length > 1) {
            if (!_.presenterCtx.slideStrokes[pageIdx]) _.presenterCtx.slideStrokes[pageIdx] = [];
            _.presenterCtx.slideStrokes[pageIdx].push(_.presenterCtx.currentStroke);
            _.presenterCtx.redoStack = [];
            _.presenterCtx.undoStack.push({ type: 'stroke', pageIdx: pageIdx });
        }
        _.presenterCtx.currentStroke = null;
    }

    function _redrawStrokes() {
        var canvas = document.getElementById('lp-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        var strokes = _.presenterCtx.slideStrokes[_.viewerState.currentPage] || [];
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

        var color = _.presenterCtx.highlightColor;
        // BUG 4 fix: if 'clear' is selected, just remove existing highlights (already done above) and stop
        if (color === 'clear') {
            sel.removeAllRanges();
            return;
        }
        var span = document.createElement('span');
        span.className = 'user-highlight user-highlight-' + color;
        try {
            range.surroundContents(span);
            _.presenterCtx.redoStack = [];
            _.presenterCtx.undoStack.push({ type: 'highlight', element: span });
        } catch (e) {
            // Range spans multiple elements — fallback
        }
        sel.removeAllRanges();
    }

    function _clearHighlightSelection() {
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
    }

    function _clearAllHighlights() {
        var pageIdx = _.viewerState ? _.viewerState.currentPage : null;
        if (pageIdx !== null && _.presenterCtx) {
            _.presenterCtx.slideHighlights[pageIdx] = [];
        }
        var viewport = document.getElementById('lp-viewport');
        if (viewport) {
            viewport.querySelectorAll('.user-highlight').forEach(function(hl) {
                var parent = hl.parentNode;
                while (hl.firstChild) parent.insertBefore(hl.firstChild, hl);
                hl.remove();
            });
        }
    }

    // --- Diacritics ---



    function _activateDiacritics() {
        _.presenterCtx.diacriticsActive = true;
        var slide = document.getElementById('lp-slide-content');
        if (!slide) return;
        slide.querySelectorAll('.lp-arabic').forEach(function(el) {
            _wrapWordsForDiacritics(el);
        });
    }

    function _deactivateDiacritics() {
        _.presenterCtx.diacriticsActive = false;
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
                    var _origWord = _.diacriticsMap[stripped];
                    if (!_origWord) {
                        var noPunct = stripped.replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '');
                        if (noPunct !== stripped && _.diacriticsMap[noPunct]) {
                            _origWord = _.diacriticsMap[noPunct] + stripped.slice(noPunct.length);
                        }
                    }
                    span.dataset.original = _origWord || part;
                    span.dataset.stripped = stripped;
                    span.addEventListener('click', function() {
                        if (_.presenterCtx.currentTool === 'translate') {
                            // Skip if mouseup handler already did the lookup (prevents double-fire on mobile tap)
                            if (_.presenterCtx._translateMouseupTime && Date.now() - _.presenterCtx._translateMouseupTime < 500) return;
                            // For word groups (partial formatting), use the merged stripped text
                            var w = (span.dataset.groupStripped || span.dataset.stripped || span.textContent).replace(/[\u064B-\u0652\u0670]/g, '').replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '');
                            if (w) { if (typeof Dictionary !== 'undefined') { Dictionary.lookup(w); _onDictToggle(true); } else { _toggleDict(true); var di = document.getElementById('lp-dict-input'); if (di) { di.value = w; _searchDict(w); } } }
                            return;
                        }
                        if (_.presenterCtx.currentTool === 'highlight') {
                            if (_.presenterCtx.highlightColor === 'clear') {
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
                        if (!_.presenterCtx.diacriticsActive) return;
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
                var mapEntry = _.diacriticsMap[mergedStripped];
                if (!mapEntry) {
                    var noPunct = mergedStripped.replace(/[\.\,\;\:\!\?\u060C\u061B\u061F\u06D4]+$/, '');
                    if (noPunct !== mergedStripped && _.diacriticsMap[noPunct]) {
                        mapEntry = _.diacriticsMap[noPunct] + mergedStripped.slice(noPunct.length);
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
        _.currentQmarkData.forEach(function(item) {
            var el = document.getElementById(item.id);
            if (!el || el.classList.contains('revealed')) return;
            el.classList.add('revealed');
            el.style.cssText = '';
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalStripped) + '</span>';
            el._qmarkRevealState = 1;
        });
    }

    function _hideAllQmarks() {
        _.currentQmarkData.forEach(function(item) {
            var el = document.getElementById(item.id);
            if (!el || !el.classList.contains('revealed')) return;
            el.classList.remove('revealed');
            if (item.guess) {
                el.style.cssText = 'display:inline-block;padding:2px 8px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af;vertical-align:middle;font-size:0.95em';
                el.textContent = item.guess;
            } else {
                el.style.cssText = 'display:inline-block;min-width:60px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:2px 8px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.4';
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
            _.presenterCtx.dictOpen = true;
            _onDictToggle(true);
            var di = document.getElementById('lp-dict-input');
            if (di) di.focus();
        } else {
            panel.classList.remove('show');
            if (toggle) toggle.classList.remove('open');
            if (body) body.classList.remove('dict-open');
            _.presenterCtx.dictOpen = false;
            _onDictToggle(false);
        }
        // Resize drawing canvas to match new viewport dimensions after dict panel toggle
        _resizeCanvasToViewport();
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
        var engine = (_.presenterCtx && _.presenterCtx.lpDictEngine) || 'milson';

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
        if (_.presenterCtx.undoStack.length === 0) return;
        var action = _.presenterCtx.undoStack.pop();
        if (action.type === 'stroke') {
            var strokes = _.presenterCtx.slideStrokes[action.pageIdx];
            var removed = strokes ? strokes.pop() : null;
            _.presenterCtx.redoStack.push({ type: 'stroke', pageIdx: action.pageIdx, strokeData: removed });
            _redrawStrokes();
        } else if (action.type === 'highlight' && action.element) {
            var el = action.element;
            var parent = el.parentNode;
            var nextSib = el.nextSibling;
            if (parent) {
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
            }
            _.presenterCtx.redoStack.push({ type: 'highlight', element: el, parent: parent, nextSibling: nextSib });
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
            _.presenterCtx.redoStack.push(curState);
        }
    }

    function _presenterRedo() {
        if (_.presenterCtx.redoStack.length === 0) return;
        var action = _.presenterCtx.redoStack.pop();
        if (action.type === 'stroke' && action.strokeData) {
            var strokes = _.presenterCtx.slideStrokes[action.pageIdx];
            if (!strokes) { strokes = []; _.presenterCtx.slideStrokes[action.pageIdx] = strokes; }
            strokes.push(action.strokeData);
            _.presenterCtx.undoStack.push({ type: 'stroke', pageIdx: action.pageIdx });
            _redrawStrokes();
        } else if (action.type === 'highlight' && action.element && action.parent) {
            // Re-wrap the text nodes back into the highlight span
            var el = action.element;
            if (action.nextSibling && action.parent.contains(action.nextSibling)) {
                action.parent.insertBefore(el, action.nextSibling);
            } else {
                action.parent.appendChild(el);
            }
            _.presenterCtx.undoStack.push({ type: 'highlight', element: el });
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
            _.presenterCtx.undoStack.push(curState);
        }
    }

    // --- Navigation ---
    function _saveQmarkGuesses() {
        if (!_.viewerState || !_.currentQmarkData.length) return;
        var cache = {};
        _.currentQmarkData.forEach(function(item, idx) {
            if (item.guess || (document.getElementById(item.id) && document.getElementById(item.id)._qmarkRevealState)) {
                var el = document.getElementById(item.id);
                cache[idx] = { guess: item.guess || '', revealState: (el && el._qmarkRevealState) || 0 };
            }
        });
        if (Object.keys(cache).length > 0) {
            _.qmarkGuessCache[_.viewerState.currentPage] = cache;
        }
    }

    function _restoreQmarkGuesses() {
        if (!_.viewerState || !_.currentQmarkData.length) return;
        var cache = _.qmarkGuessCache[_.viewerState.currentPage];
        if (!cache) return;
        _.currentQmarkData.forEach(function(item, idx) {
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
                el.style.cssText = 'display:inline-block;padding:2px 8px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af;vertical-align:middle;font-size:0.95em';
                el.textContent = saved.guess;
            }
        });
    }

    function _saveSlideHighlights() {
        if (!_.presenterCtx) return;
        var container = document.getElementById('lp-slide-content');
        if (!container) return;
        var highlights = container.querySelectorAll('.user-highlight');
        if (highlights.length === 0) {
            delete _.presenterCtx.slideHighlights[_.viewerState.currentPage];
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
            _.presenterCtx.slideHighlights[_.viewerState.currentPage] = data;
        }
    }

    function _restoreSlideHighlights() {
        if (!_.presenterCtx) return;
        var pageIdx = _.viewerState.currentPage;
        var data = _.presenterCtx.slideHighlights[pageIdx];
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
        var lesson = getLesson(_.viewerState.lessonId);
        if (!lesson || idx < 0 || idx >= lesson.pages.length) return;
        _saveQmarkGuesses();
        _saveSlideHighlights();
        _.viewerState.currentPage = idx;
        _updatePresenterPage();
    }

    function _updatePresenterPage() {
        var lesson = getLesson(_.viewerState.lessonId);
        if (!lesson) return;
        var page = lesson.pages[_.viewerState.currentPage];
        var pageNum = _.viewerState.currentPage + 1;
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
            d.classList.toggle('active', i === _.viewerState.currentPage);
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

    // Ctrl key → temporary candle/diacritics mode
    var _ctrlCandleActive = false;
    var _ctrlCandlePrevTool = null;

    function _ctrlCandleDown(e) {
        if (e.key !== 'Control' && e.key !== 'Meta') return;
        if (_ctrlCandleActive) return;
        if (!_.presenterCtx) return;
        _ctrlCandleActive = true;
        _ctrlCandlePrevTool = _.presenterCtx.currentTool;
        if (_.presenterCtx.currentTool !== 'diacritics') {
            _activateTool('diacritics');
        }
    }

    function _ctrlCandleUp(e) {
        if (e.key !== 'Control' && e.key !== 'Meta') return;
        if (!_ctrlCandleActive) return;
        _ctrlCandleActive = false;
        if (_ctrlCandlePrevTool !== 'diacritics') {
            if (_ctrlCandlePrevTool) {
                _activateTool(_ctrlCandlePrevTool);
            } else {
                _deactivateTool();
            }
        }
        _ctrlCandlePrevTool = null;
    }

    function _viewerKeyHandler(e) {
        if (!_.viewerState) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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

        // Save highlights before leaving slide
        _saveSlideHighlights();

        // Close presenter, open game screen — keep welcome hidden
        var viewer = document.getElementById('lesson-viewer');
        if (viewer) viewer.style.display = 'none';
        document.removeEventListener('keydown', _viewerKeyHandler);
        document.removeEventListener('keydown', _ctrlCandleDown);
        document.removeEventListener('keyup', _ctrlCandleUp);

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
        if (backBtn && _.viewerState) {
            var savedState = Object.assign({}, _.viewerState);
            backBtn.textContent = '← חזרה לשיעור';
            backBtn.onclick = function(e) {
                e.preventDefault();
                document.getElementById('game-screen').style.display = 'none';
                _.viewerState = savedState;
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
        if (!_.viewerState) return;
        var lesson = getLesson(_.viewerState.lessonId);
        if (!lesson) return;
        if (_.viewerState.currentPage < lesson.pages.length - 1) {
            _saveSlideHighlights();
            _.viewerState.currentPage++;
            _updatePresenterPage();
        }
    }

    function viewerPrev() {
        if (!_.viewerState) return;
        if (_.viewerState.currentPage > 0) {
            _saveSlideHighlights();
            _.viewerState.currentPage--;
            _updatePresenterPage();
        }
    }

    function closeViewer() {
        // Clean up temp demo lessons
        var closingId = _.viewerState ? _.viewerState.lessonId : null;
        if (closingId && closingId.indexOf('demo_') === 0) {
            var ls = loadLessons();
            saveLessons(ls.filter(function(l) { return l.id !== closingId; }));
        }
        _.viewerState = null;
        _.presenterCtx = null;
        _canvasInited = false;
        _.currentQmarkData = [];
        _.qmarkGuessCache = {};
        _closeQmarkPopup();
        document.removeEventListener('keydown', _viewerKeyHandler);
        document.removeEventListener('keydown', _ctrlCandleDown);
        document.removeEventListener('keyup', _ctrlCandleUp);
        // Clean up media tab + button
        _removeMediaButton();
        if (typeof Dictionary !== 'undefined') Dictionary.clearMediaPage();
        var viewer = document.getElementById('lesson-viewer');
        if (viewer) viewer.remove();

        // Return to editor if we came from there, else welcome
        if (_.currentEditorLessonId) {
            openLessonEditor(_.currentEditorLessonId);
        } else {
            document.getElementById('welcome-screen').style.display = '';
            renderLessonsList();
        }
        window.scrollTo(0, 0);
    }

    // --- Question-mark (❓) hidden text ---

    /**
     * Qmark word-toggle mode: click ❓ to enter mode where every word is a toggle button.
     * Click a word to mark/unmark it as hidden. Click ❓ again to exit.
     */

    // --- Qmark Viewer ---
    function _processQmarkForViewer(html) {
        var container = document.createElement('div');
        container.innerHTML = html;
        var hiddenSpans = container.querySelectorAll('.qmark-hidden');
        var qmarkData = [];
        hiddenSpans.forEach(function(span, idx) {
            var id = 'qmark_' + Date.now() + '_' + idx;
            var originalText = span.getAttribute('data-hidden-text') || span.textContent;
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
            placeholder.style.cssText = 'display:inline-block;min-width:60px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:2px 8px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.4';
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
                // In diacritics/candle mode (or Ctrl held) — left click logic
                if (_.presenterCtx && (_.presenterCtx.diacriticsActive || e.ctrlKey || e.metaKey)) {
                    _qmarkLeftClick(item, el);
                    return;
                }
                // If revealed, click to go back to guess mode (preserving previous guess)
                if (el.classList.contains('revealed')) {
                    if (_.presenterCtx) {
                        _.presenterCtx.undoStack.push({ type: 'qmark', item: item, el: el, prevState: el._qmarkRevealState || 1, prevLastVisible: el._qmarkLastVisibleState || 0, prevHtml: el.innerHTML, prevStyle: el.style.cssText, prevClass: true });
                    }
                    el.classList.remove('revealed');
                    el._qmarkRevealState = 0;
                    if (item.guess) {
                        el.style.cssText = 'display:inline-block;padding:2px 8px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af;vertical-align:middle;font-size:0.95em';
                        el.textContent = item.guess;
                    } else {
                        el.style.cssText = 'display:inline-block;min-width:60px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:2px 8px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.4';
                        el.textContent = '?';
                    }
                    return;
                }
                _showQmarkGuessPopup(item, el);
            });
            // Right click: toggle ? mark on/off
            el.addEventListener('contextmenu', function(e) {
                if (!_.presenterCtx || !(_.presenterCtx.diacriticsActive || e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                _qmarkRightClick(item, el);
            });
        });
    }

    // Track qmark data per slide for reveal/hide
    _.currentQmarkData = [];
    // Cache guesses per slide index so navigating away and back preserves them
    _.qmarkGuessCache = {}; // { slideIndex: { qmarkIdx: { guess: string, revealState: number } } }

    function _showQmarkGuessPopup(item, placeholderEl) {
        // Close any existing qmark input
        _closeQmarkPopup();

        // Save original placeholder info for restoration
        placeholderEl._qmarkItem = item;
        placeholderEl._qmarkOrigStyle = placeholderEl.style.cssText;
        placeholderEl._qmarkOrigText = placeholderEl.textContent;

        // Transform the placeholder itself into an input field
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'qmark-active-input';
        input.dir = 'rtl';
        input.placeholder = '?';
        input.value = item.guess || '';
        input.style.cssText = 'display:inline-block;min-width:80px;width:auto;text-align:center;font-size:0.95em;background:#eff6ff;border:2px solid #3b82f6;border-radius:6px;padding:4px 8px;outline:none;vertical-align:middle;font-family:inherit';
        // Auto-size based on content
        function _autoSize() {
            var len = Math.max(input.value.length, 4);
            input.style.width = Math.min(len * 14 + 20, 300) + 'px';
        }
        _autoSize();

        placeholderEl.textContent = '';
        placeholderEl.style.cssText = 'display:inline;padding:0;border:none;background:none;min-width:auto';
        placeholderEl.appendChild(input);
        placeholderEl.classList.add('qmark-editing');
        input.focus();

        // Auto-expand as user types
        input.addEventListener('input', function() { _autoSize(); });

        // Ctrl+G Hebrew→Arabic
        input.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G' || e.keyCode === 71)) {
                e.preventDefault();
                if (typeof DetailsPanel !== 'undefined' && DetailsPanel._convertHebrewToArabic) {
                    input.value = DetailsPanel._convertHebrewToArabic(input.value);
                }
            }
            if (e.key === 'Enter') {
                e.preventDefault();
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
            item.guess = input.value.trim();
            placeholderEl.classList.remove('qmark-editing');
            if (item.guess) {
                // Show the guess as text in the placeholder
                placeholderEl.style.cssText = 'display:inline-block;padding:2px 8px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af;vertical-align:middle;font-size:0.95em';
                placeholderEl.textContent = item.guess;
            } else {
                // No guess — revert to ? placeholder
                placeholderEl.style.cssText = placeholderEl._qmarkOrigStyle || 'display:inline-block;min-width:60px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:2px 8px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.4';
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
        if (_.presenterCtx) {
            _.presenterCtx.undoStack.push({ type: 'qmark', item: item, el: el, prevState: state, prevLastVisible: el._qmarkLastVisibleState || 0, prevHtml: el.innerHTML, prevStyle: el.style.cssText, prevClass: el.classList.contains('revealed') });
        }
        if (state === 0) {
            // First reveal — always show plain (no diacritics). Subsequent toggles cycle diacritics.
            el.classList.add('revealed');
            el.style.cssText = '';
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalStripped) + '</span>';
            el._qmarkRevealState = 1;
        } else if (state === 1) {
            // Toggle diacritics on
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalWithDiacritics) + '</span>';
            el._qmarkRevealState = 2;
            el._qmarkLastVisibleState = 2;
        } else {
            // Toggle diacritics off
            el.innerHTML = '<span class="qmark-text">' + escapeHtml(item.originalStripped) + '</span>';
            el._qmarkRevealState = 1;
            el._qmarkLastVisibleState = 1;
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
            if (_.presenterCtx) {
                _.presenterCtx.undoStack.push({ type: 'qmark', item: item, el: el, prevState: state, prevLastVisible: el._qmarkLastVisibleState || 0, prevHtml: el.innerHTML, prevStyle: el.style.cssText, prevClass: el.classList.contains('revealed') });
            }
            // Hide to ? — remember current visible state
            el._qmarkLastVisibleState = state;
            el.classList.remove('revealed');
            el._qmarkRevealState = 0;
            if (item.guess) {
                el.style.cssText = 'display:inline-block;padding:2px 8px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af;vertical-align:middle;font-size:0.95em';
                el.textContent = item.guess;
            } else {
                el.style.cssText = 'display:inline-block;min-width:60px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:2px 8px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.4';
                el.textContent = '?';
            }
            // Deactivate candle after hiding word — user wants to edit guess
            if (_.presenterCtx && _.presenterCtx.currentTool === 'diacritics') {
                _activateTool('pointer');
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
                editing.style.cssText = 'display:inline-block;padding:2px 8px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;cursor:pointer;color:#1e40af;vertical-align:middle;font-size:0.95em';
                editing.textContent = item.guess;
            } else {
                editing.style.cssText = editing._qmarkOrigStyle || 'display:inline-block;min-width:60px;text-align:center;font-size:1em;background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:2px 8px;cursor:pointer;color:#3b82f6;vertical-align:baseline;line-height:1.4';
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


    // --- Register presenter methods ---
    LM.startLessonViewer = startLessonViewer;
    LM.closeViewer = closeViewer;
    _._saveAllOpenEditors = _saveAllOpenEditors;
    if (typeof _wrapWordsForDiacritics === "function") _._wrapWordsForDiacritics = _wrapWordsForDiacritics;
    if (typeof _activateDiacritics === "function") _._activateDiacritics = _activateDiacritics;
    if (typeof _deactivateDiacritics === "function") _._deactivateDiacritics = _deactivateDiacritics;

})(LessonManager);
