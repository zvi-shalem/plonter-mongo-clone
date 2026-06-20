// Auth — PlonterAuth adapter over AuthEmail widget
// Preserves the PlonterAuth interface used by app.js, lessons.js, etc.
// The actual login UI is rendered by auth_widget.js (AuthEmail)

var PlonterAuth = (function() {
    'use strict';

    var APP_ID = 'plonter';
    var _currentUser = null;
    var _onLoginCallbacks = [];
    var _pendingLoginCallback = null;
    var _authStorageEventsBound = false;
    var _lastAuthToken = null;
    // BUG bd1 #1470 (Amitai @7l) — storage-event reload must be IDENTITY-gated,
    // not raw-token-gated. The vars below back the four protections in
    // _bindExternalAuthStorageListener's handler.
    var _lastAuthIdentity = null;      // last KNOWN user identity (owner/token-user)
    var _initTs = 0;                   // ms timestamp init() ran — drives the settle window
    var _pendingIdentityReload = false; // a genuine user-switch reload deferred mid-edit
    var _deferredReloadTimer = null;   // interval that fires the deferred reload once editing settles
    var _INIT_SETTLE_MS = 2500;        // ignore token churn for this long after init()

    function _now() {
        try { return Date.now(); } catch (_) { return 0; }
    }

    // Identity of the currently-authenticated user, as visible in shared
    // localStorage. Prefer the explicit token-user marker; fall back to the
    // data-owner marker maintained by onLogin/syncOwnerAndClear. Returns '' when
    // unknown (guest / not yet hydrated).
    function _identityFromStorage() {
        var u = '';
        try { u = localStorage.getItem('plonter_auth_token_user') || ''; } catch (_) {}
        if (u) return u;
        try { u = localStorage.getItem('plonter_data_owner') || ''; } catch (_) {}
        return u;
    }

    // True while the teacher is actively editing a lesson or has the media
    // warehouse / upload dialog open — a reload here would eject them and can
    // lose unsaved work. Detected generically by DOM presence, with NO coupling
    // to lessons.js internals (selectors verified in clone/js/lessons.js).
    function _isEditInProgress() {
        try {
            if (window.__plonterUploadInProgress || window.__plonterEditingActive) return true;
        } catch (_) {}
        try {
            // Media-warehouse / upload dialog: this node exists in the DOM ONLY
            // while the dialog is open (created on open, .remove() on close).
            if (document.getElementById('editor-media-warehouse-overlay')) return true;
        } catch (_) {}
        try {
            // Lesson editor: a persistent node toggled via display. Treat as
            // active only when actually visible on screen.
            var ed = document.getElementById('lesson-editor');
            if (ed && ed.style && ed.style.display !== 'none' && ed.offsetParent !== null) return true;
        } catch (_) {}
        return false;
    }

    // A genuine identity switch fired while the teacher was mid-edit. Poll until
    // editing settles, then reload — but only if the identity still differs.
    function _scheduleDeferredReload() {
        if (_deferredReloadTimer) return;
        try {
            _deferredReloadTimer = setInterval(function() {
                if (_isEditInProgress()) return; // still editing — keep waiting
                try { clearInterval(_deferredReloadTimer); } catch (_) {}
                _deferredReloadTimer = null;
                if (!_pendingIdentityReload) return;
                _pendingIdentityReload = false;
                var nowId = _identityFromStorage();
                if (nowId && nowId !== _lastAuthIdentity) {
                    _lastAuthIdentity = nowId;
                    try { window.location.reload(); } catch (_) {}
                }
            }, 1000);
        } catch (_) { _deferredReloadTimer = null; }
    }

    function init() {
        var authContainer = document.getElementById('auth-container');
        var welcomeScreen = document.getElementById('welcome-screen');
        var gameScreen = document.getElementById('game-screen');

        if (!authContainer || typeof AuthEmail === 'undefined') return;
        _lastAuthToken = localStorage.getItem('plonter_auth_token') || '';
        // BUG bd1 #1470: baseline the identity + start the settle window so the
        // first-load token canonicalization can't be mistaken for a user switch.
        _lastAuthIdentity = _identityFromStorage();
        _initTs = _now();
        _bindExternalAuthStorageListener();

        AuthEmail.init({
            container: '#auth-container',
            apiUrl: '/plonter/api/auth_email.php',
            appName: 'פלונטר',
            appId: APP_ID,
            title: 'כניסה לפלונטר',
            onLogin: function(token, user) {
                _lastAuthToken = token || localStorage.getItem('plonter_auth_token') || '';
                _snapshotGuestVocabToShadow();
                // Privacy: localStorage holds the previous user's lessons,
                // sync metadata, and pending uploads. Without scoping, user B
                // logging in on user A's browser would see A's files. Compare
                // the data owner marker and purge content keys on user change.
                var newOwnerKey = user && (user.id || user.user_id || user.email);
                _stashGuestSentenceBackups();
                if (newOwnerKey) {
                    var prevOwner = localStorage.getItem('plonter_data_owner');
                    if (prevOwner && prevOwner !== String(newOwnerKey)) {
                        _clearUserScopedContent();
                    }
                    localStorage.setItem('plonter_data_owner', String(newOwnerKey));
                }
                // Keep the identity baseline current so the storage handler
                // compares against the user we just logged in (BUG bd1 #1470).
                _lastAuthIdentity = _identityFromStorage();

                _currentUser = { token: token };
                if (user && typeof user === 'object') {
                    _currentUser.name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim();
                    _currentUser.email = user.email || '';
                    _currentUser.phone = user.phone || '';
                }

                // Hide login screen, show app (unless game-screen is already visible)
                authContainer.style.display = 'none';
                // Remove cancel button if it exists
                var cancelBtn = document.getElementById('auth-cancel-btn');
                if (cancelBtn) cancelBtn.remove();
                var gameVisible = gameScreen && gameScreen.style.display !== 'none';
                if (!gameVisible && welcomeScreen) {
                    // vocab.html has no #welcome-screen — guard the access so
                    // logging in from vocab.html doesn't TypeError.
                    welcomeScreen.style.display = '';
                }

                _renderLogoutButton();
                _notifyLogin();
                _notifyAuthChange();

                // Seed built-in STAGES into plonter_custom_stages as user-
                // owned custom sentences on this user's first login on this
                // browser. Per-user marker so each new user gets their own
                // fresh copy they can edit/delete. Amitai 2026-04-19 04:34.
                if (newOwnerKey) {
                    _seedBuiltinStagesForUser(String(newOwnerKey));
                }

                // On login, hydrate local storage from the server. Without
                // this, a user who logged in on a device that was previously
                // used by a different user (whose localStorage was wiped by
                // _clearUserScopedContent) would see an empty lesson list
                // even though their data is safe on the server. pullAll
                // writes directly into plonter_lessons and marks each item
                // as synced — the contentsync:change events it emits drive
                // the lessons list to re-render.
                // BUG #1353 fix (1): expose a promise that settles when the
                // login-time pullAll hydration finishes, so the guest-migration
                // prompts can be chained AFTER hydration instead of firing on a
                // blind fixed timer that races the network round-trip (the cause
                // of the repeated nags + false "duplicate document" dialog for an
                // item already in the account).
                var _loginPullsSettled, _resolveLoginPulls;
                _loginPullsSettled = new Promise(function(_res) { _resolveLoginPulls = _res; });
                var _haveContentSyncPull = (typeof ContentSync !== 'undefined' &&
                    typeof ContentSync.pullAll === 'function');
                if (!_haveContentSyncPull) { try { _resolveLoginPulls(); } catch (_) {} }
                if (_haveContentSyncPull) {
                    setTimeout(function() {
                        // Bug #289: push any sync queue that survived
                        // logout (see _clearUserScopedContent fix) BEFORE
                        // pullAll, otherwise pullAll overwrites LS with
                        // older server state. processQueue no-ops when
                        // queue is empty or session is not authed.
                        var pushFirst = (typeof ContentSync.processQueue === 'function')
                            ? ContentSync.processQueue()
                            : null;
                        Promise.resolve(pushFirst).catch(function(err) {
                            console.warn('[auth] processQueue on login failed', err);
                        }).then(function() {
                        var _loginPulls = [];
                        _loginPulls.push(ContentSync.pullAll('lesson').then(function(res) {
                            if (res && res.loaded) {
                                console.log('[auth] pulled', res.loaded, 'lessons from server');
                                try {
                                    if (typeof LessonManager !== 'undefined' &&
                                        typeof LessonManager.renderLessonsList === 'function') {
                                        LessonManager.renderLessonsList();
                                    }
                                } catch (_) {}
                            }
                        }).catch(function(err) { console.warn('[auth] pullAll failed', err); }));

                        // Same hydration for texts so a post-B-wipe login
                        // re-fetches the user's texts from the server.
                        _loginPulls.push(ContentSync.pullAll('text').then(function(res) {
                            if (res && res.loaded) {
                                console.log('[auth] pulled', res.loaded, 'texts from server');
                            }
                            // Amitai 2026-04-19 09:32: auto-backup the demo
                            // text ("מליאת הנבחרים בארה"ב") on login so it
                            // stops showing as unsynced. Runs AFTER pullAll
                            // so cross-device title+desc adoption wins over
                            // a fresh duplicate push.
                            try {
                                if (typeof PlonterTexts !== 'undefined' &&
                                    typeof PlonterTexts._autoBackupBuiltinSeedsOnLogin === 'function') {
                                    PlonterTexts._autoBackupBuiltinSeedsOnLogin();
                                }
                            } catch (e) { console.warn('[auth] auto-backup builtin texts failed', e); }
                            try {
                                if (typeof PlonterTexts !== 'undefined' &&
                                    typeof PlonterTexts.renderList === 'function') {
                                    PlonterTexts.renderList();
                                }
                            } catch (_) {}
                        }).catch(function(err) { console.warn('[auth] pullAll(text) failed', err); }));

                        // Sentences (custom syntax-analysis items) — hindus
                        // items share the store but are filtered out by
                        // the module's lister until @3 coord.
                        _loginPulls.push(ContentSync.pullAll('sentence').then(function(res) {
                            if (res && res.loaded) {
                                console.log('[auth] pulled', res.loaded, 'sentences from server');
                                try {
                                    if (typeof Modals !== 'undefined' && typeof Modals.renderStages === 'function') Modals.renderStages();
                                } catch (_) {}
                            }
                        }).catch(function(err) { console.warn('[auth] pullAll(sentence) failed', err); }));

                        // Per-sentence syntax analyses (POS tags,
                        // combinations, arches). These live in separate
                        // plonter_v4_stage_<id>_analysis_<slot> keys, so
                        // sentence hydration alone is not enough after a
                        // user switch wipes local per-stage analysis keys.
                        _loginPulls.push(ContentSync.pullAll('analysis').then(function(res) {
                            if (res && res.loaded) {
                                console.log('[auth] pulled', res.loaded, 'analyses from server');
                            }
                        }).catch(function(err) { console.warn('[auth] pullAll(analysis) failed', err); }));

                        // Hindus attempts live in per-stage
                        // plonter_v4_stage_<id>_hindus_v2 keys, so they
                        // also need explicit hydration after A→B→A user
                        // switches wipe local per-stage state.
                        _loginPulls.push(ContentSync.pullAll('hindus').then(function(res) {
                            if (res && res.loaded) {
                                console.log('[auth] pulled', res.loaded, 'hindus attempts from server');
                            }
                        }).catch(function(err) { console.warn('[auth] pullAll(hindus) failed', err); }));

                        // BUG #1353 fix (1): settle the deferred when all login
                        // pulls finish so the guest-migration prompts run against
                        // a hydrated account (each pull already swallows its own
                        // error, so Promise.all never rejects — resolve on both
                        // paths defensively).
                        Promise.all(_loginPulls).then(
                            function() { try { _resolveLoginPulls(); } catch (_) {} },
                            function() { try { _resolveLoginPulls(); } catch (_) {} });
                        });
                    }, 150);
                }

                // Fire pending one-shot callback (from showLoginDialog)
                if (_pendingLoginCallback) {
                    var cb = _pendingLoginCallback;
                    _pendingLoginCallback = null;
                    cb(_currentUser);
                }

                if (typeof MessageManager !== 'undefined') {
                    MessageManager.show('מחובר!', 'success');
                }

                // Guest-shadow backup migration prompt — Plonter TODO #634
                // (Amitai 2026-05-02). Shadow keys (guest_backup_*) survive
                // the cross-user wipe in _clearUserScopedContent so guest
                // categories created before this login are still readable
                // here. Wait 1500ms so pullAll lessons/texts/sentences and
                // VocabSync registration have a beat to settle before we
                // diff guest-shadow vs user vocab.
                try {
                    sessionStorage.removeItem('_guestBackupPromptDeferred');
                    sessionStorage.removeItem('_guestTextShadowPromptDeferred');
                    sessionStorage.removeItem('_guestSentenceBackupPromptDeferred');
                } catch (_) {}
                var _guestPromptsRun = false;
                function _runGuestLoginPrompts() {
                    if (_guestPromptsRun) return;   // idempotent — pull-chain OR fallback, whichever first
                    _guestPromptsRun = true;
                    _stashCurrentGuestWorkForPrompts();
                    try {
                        if (typeof ContentSync !== 'undefined' &&
                            typeof ContentSync.checkMigration === 'function' &&
                            typeof LessonManager !== 'undefined' &&
                            typeof LessonManager.loadLessons === 'function') {
                            ContentSync.checkMigration('lesson', LessonManager.loadLessons());
                        }
                    } catch (e) { console.warn('[auth] guest lesson backup prompt failed', e); }
                    try { _promptGuestBackupOnLogin(_currentUser); }
                    catch (e) { console.warn('[auth] guest backup prompt failed', e); }
                    try {
                        if (typeof PlonterTexts !== 'undefined' &&
                            typeof PlonterTexts.promptGuestShadowOnLogin === 'function') {
                            PlonterTexts.promptGuestShadowOnLogin();
                        }
                    } catch (e) { console.warn('[auth] guest text prompt failed', e); }
                    try { _promptGuestSentenceBackupOnLogin(); }
                    catch (e) { console.warn('[auth] guest sentence backup prompt failed', e); }
                }
                // BUG #1353 fix (1): run the guest-migration prompts AFTER the
                // login pull hydration settles — so an item already in the
                // account is present and gets suppressed by contentSync's
                // equivalence guard — instead of on a blind 1500ms timer that
                // raced the network. A bounded fallback still prompts if the
                // pulls hang or are slow, so a stuck network never silently
                // drops the prompt. A small beat after settle lets the setters'
                // contentsync:change writes flush into localStorage first.
                _loginPullsSettled.then(function() { setTimeout(_runGuestLoginPrompts, 150); });
                setTimeout(_runGuestLoginPrompts, 4000);
            },
            onGuest: function() {
                _lastAuthToken = localStorage.getItem('plonter_auth_token') || '';
                // Guest mode — hide login, show app. Clear the form HTML
                // otherwise leftover #auth-login-btn inside #auth-container
                // shadows the header's button via getElementById.
                authContainer.style.display = 'none';
                authContainer.innerHTML = '';
                if (welcomeScreen) welcomeScreen.style.display = '';
                var cancelBtn = document.getElementById('auth-cancel-btn');
                if (cancelBtn) cancelBtn.remove();
                _restoreGuestSentenceBackupsToGuestStages();
                _renderLogoutButton();
                _notifyAuthChange();
            },
            onLogout: function() {
                _handleLogout();
            }
        });
    }

    async function _handleLogout() {
        if (typeof ContentSync !== 'undefined' &&
            typeof ContentSync.hasPendingDeletes === 'function' &&
            ContentSync.hasPendingDeletes()) {
            alert('יש מחיקות שעדיין נשמרות בשרת. חכה כמה שניות עד שהמחיקה תסתיים ואז צא מהמשתמש.');
            return;
        }
        try {
            if (typeof HindusMode !== 'undefined' && typeof HindusMode.flushPersist === 'function') {
                HindusMode.flushPersist();
            }
            if (typeof ContentSync !== 'undefined' && typeof ContentSync.processQueue === 'function') {
                await Promise.resolve(ContentSync.processQueue());
            }
        } catch (e) { console.warn('[auth] pre-logout persist failed', e); }
        _currentUser = null;
        // Clean up old storage
        localStorage.removeItem('plonter_auth_token');
        localStorage.removeItem('plonter_auth_user');
        _lastAuthToken = '';

        var authContainer = document.getElementById('auth-container');
        var welcomeScreen = document.getElementById('welcome-screen');
        var gameScreen = document.getElementById('game-screen');

        // Show login screen, hide app
        if (authContainer) authContainer.style.display = 'flex';
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        if (gameScreen) gameScreen.style.display = 'none';

        // Re-arm the backup popup so the NEXT login (same or new user) sees
        // it again. Prevents a stale once-per-page-load state from
        // suppressing the migration prompt after a deliberate logout cycle.
        if (typeof ContentSync !== 'undefined' &&
            typeof ContentSync.resetMigrationShown === 'function') {
            try { ContentSync.resetMigrationShown(); } catch (_) {}
        }

        // Clear the logged-out user's content so guest mode shows only
        // built-in examples — not the previous user's custom categories /
        // drafts that would otherwise leak into the add-sentence dropdown
        // (Amitai 2026-04-19 05:15). Guest seed will re-populate on next
        // renderStages tick.
        //
        // preserveLocalOnly:true keeps plonter_qmark_* / plonter_vocab_* /
        // plonter_v4_stage_* so same-user relogin doesn't erase work that
        // never had a server copy to fall back on (Amitai 2026-04-19 08:08).
        try {
            _clearUserScopedContent({ preserveLocalOnly: true });
            _restoreGuestVocabShadowToLive();
            _restoreGuestSentenceBackupsToGuestStages();
            // DO NOT clear plonter_data_owner on logout. Keeping it makes the
            // onLogin check (prevOwner !== newOwnerKey) correctly fire the
            // different-user wipe when user B logs in on a browser where
            // user A just logged out. Amitai 2026-04-19 20:42: created
            // category as A, logged in as B, saw A's category leak. Root
            // cause: logout was clearing the data-owner marker so the next
            // login saw no previous owner and skipped the wipe.
            localStorage.removeItem('plonter_stages_seeded_guest');
            _seedBuiltinStagesForGuest();
            _restoreGuestSentenceBackupsToGuestStages();
        } catch (e) { console.warn('[auth] logout clear failed', e); }

        _renderLogoutButton();
        _notifyAuthChange();
    }

    function isLoggedIn() {
        return !!_currentUser;
    }

    function getUser() {
        return _currentUser;
    }

    function getToken() {
        if (typeof AuthEmail !== 'undefined') return AuthEmail.getToken();
        return null;
    }

    function onLogin(fn) {
        _onLoginCallbacks.push(fn);
        if (_currentUser) fn(_currentUser);
    }

    function _notifyLogin() {
        _onLoginCallbacks.forEach(function(fn) { fn(_currentUser); });
    }

    // For lesson sync — shows login if not logged in, then calls callback
    function showLoginDialog(onSuccess) {
        if (_currentUser) {
            if (onSuccess) onSuccess(_currentUser);
            return;
        }
        // Store callback for after login
        if (onSuccess) {
            _pendingLoginCallback = onSuccess;
        }
        // Show the auth container with login form
        var authContainer = document.getElementById('auth-container');
        var welcomeScreen = document.getElementById('welcome-screen');
        if (authContainer) authContainer.style.display = 'flex';
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        // Render the login form inside auth-container
        if (typeof AuthEmail !== 'undefined') AuthEmail.showLogin();
        // Hide dictionary panel on mobile so login screen is visible
        var dictPanel = document.getElementById('dict-panel');
        if (dictPanel) dictPanel.style.display = 'none';

        // Add cancel button
        var existingCancel = document.getElementById('auth-cancel-btn');
        if (!existingCancel && authContainer) {
            var cancelBtn = document.createElement('button');
            cancelBtn.id = 'auth-cancel-btn';
            cancelBtn.textContent = 'ביטול';
            cancelBtn.style.cssText = 'position:fixed;top:16px;left:16px;padding:8px 16px;border:1px solid #d1d5db;border-radius:8px;background:white;color:#64748b;cursor:pointer;font-size:0.9em;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,0.1)';
            cancelBtn.onclick = function() {
                if (authContainer) authContainer.style.display = 'none';
                if (welcomeScreen) welcomeScreen.style.display = 'block';
                cancelBtn.remove();
            };
            document.body.appendChild(cancelBtn);
        }
    }

    function logout() {
        if (typeof ContentSync !== 'undefined' &&
            typeof ContentSync.hasPendingDeletes === 'function' &&
            ContentSync.hasPendingDeletes()) {
            alert('יש מחיקות שעדיין נשמרות בשרת. חכה כמה שניות עד שהמחיקה תסתיים ואז צא מהמשתמש.');
            return;
        }
        if (typeof AuthEmail !== 'undefined') {
            AuthEmail.logout();
        } else {
            _handleLogout();
        }
    }

    function _renderLogoutButton() {
        var container = document.getElementById('auth-status');
        if (!container) return;

        if (_currentUser) {
            var displayName = _currentUser.name || _currentUser.phone || '';
            var greeting = displayName ? 'שלום ' + _escapeHtml(displayName) : '';
            container.innerHTML =
                '<span style="color:white;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,0.2)">' + greeting + '</span>' +
                ' <button id="auth-logout-btn" style="padding:4px 12px;border:1px solid #e0e0e0;border-radius:6px;background:#f1f5f9;color:#64748b;cursor:pointer;font-size:0.85em;font-weight:bold">יציאה</button>';
            // Scope the lookup: AuthEmail.showLogin may have left an element
            // with the same id inside #auth-container, and getElementById
            // returns the first match in document order.
            var logoutBtn = container.querySelector('#auth-logout-btn');
            if (logoutBtn) logoutBtn.addEventListener('click', function() {
                if (confirm('לצאת מהמערכת?')) logout();
            });
        } else {
            container.innerHTML = '<button id="auth-login-btn" style="padding:6px 14px;border:1px solid rgba(255,255,255,0.4);border-radius:8px;background:rgba(255,255,255,0.15);color:white;cursor:pointer;font-size:0.85em;font-weight:bold">התחבר</button>';
            var loginBtn = container.querySelector('#auth-login-btn');
            if (loginBtn) loginBtn.addEventListener('click', function() {
                showLoginDialog();
            });
        }
    }

    // ====================================================================
    // Guest-shadow backup migration (Plonter TODO #634, Amitai 2026-05-02)
    // ====================================================================
    // _clearUserScopedContent already preserves shadow keys (guest_backup_*),
    // so categories created in guest mode survive the cross-user wipe.
    // After login, surface those orphan guest categories and offer to
    // migrate them into the now-logged-in user's local vocab map. Cloud
    // sync follows automatically via VocabSync.onCategorySaved → ContentSync.
    // Decision tree:
    //   - 'כן, גבה הכל'        → copy each shadow cat into plonter_vocab_v2
    //                            (rename with ' (אורח)' suffix on collision),
    //                            stamp sync queue, drop migrated entries
    //                            from the shadow store, also rename per-cat
    //                            fc/stars keys.
    //   - 'מחק את הכל'         → wipe ALL guest_backup_* localStorage keys.
    //   - 'סגור'                → set sessionStorage flag so the prompt
    //                            doesn't re-appear in this tab session.
    function _promptGuestBackupOnLogin(currentUser) {
        try {
            if (sessionStorage.getItem('_guestBackupPromptDeferred') === '1') return;

            var shadowRaw = localStorage.getItem('plonter_vocab_guest_backup_v2');
            var shadow = {};
            if (shadowRaw) {
                try { shadow = JSON.parse(shadowRaw) || {}; } catch (_) { shadow = {}; }
            }
            var shadowNames = Object.keys(shadow);

            var userMap;
            try { userMap = JSON.parse(localStorage.getItem('plonter_vocab_v2') || '{}'); }
            catch (_) { userMap = {}; }

            // Candidate = shadow cat that is non-empty AND differs from a
            // same-named user cat (or has no same-named cat at all). Skip
            // identical duplicates — there's nothing to migrate.
            var candidates = [];
            shadowNames.forEach(function(name) {
                var sCat = shadow[name];
                if (!sCat || typeof sCat !== 'object') return;
                var wordCount = (sCat.words && sCat.words.length) || 0;
                var conjCount = (sCat.conjugations && sCat.conjugations.length) || 0;
                if (wordCount === 0 && conjCount === 0) return;
                var uCat = userMap[name];
                if (uCat && JSON.stringify(uCat) === JSON.stringify(sCat)) return;
                candidates.push({ name: name, shadow: sCat, wordCount: wordCount, conjCount: conjCount });
            });

            if (candidates.length === 0) return;
            _renderGuestBackupModal(candidates);
        } catch (e) { console.warn('[auth] _promptGuestBackupOnLogin failed', e); }
    }

    function _renderGuestBackupModal(candidates) {
        if (document.getElementById('guest-backup-modal')) return;

        var overlay = document.createElement('div');
        overlay.id = 'guest-backup-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:10001;direction:rtl;font-family:inherit;padding:16px';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:#fff;border-radius:12px;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;padding:22px 24px;box-shadow:0 12px 48px rgba(0,0,0,0.25)';

        var title = document.createElement('h2');
        title.style.cssText = 'margin:0 0 12px 0;font-size:1.18em;color:#0d9488;text-align:center;line-height:1.4';
        title.textContent = '🎁 ברוך הבא! מצאנו ' + candidates.length + ' קטגוריות שיצרת במצב אורח — לגבות אותן בחשבון שלך?';
        dialog.appendChild(title);

        var list = document.createElement('div');
        list.style.cssText = 'margin:14px 0;max-height:280px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px';
        candidates.forEach(function(c) {
            var row = document.createElement('div');
            row.style.cssText = 'padding:8px 4px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:12px';
            var nameSp = document.createElement('span');
            nameSp.style.cssText = 'font-weight:bold;color:#0f172a';
            nameSp.textContent = c.name;
            var countSp = document.createElement('span');
            countSp.style.cssText = 'color:#64748b;font-size:0.88em;white-space:nowrap';
            countSp.textContent = c.wordCount + ' מילים' + (c.conjCount ? ' / ' + c.conjCount + ' הטיות' : '');
            row.appendChild(nameSp);
            row.appendChild(countSp);
            list.appendChild(row);
        });
        dialog.appendChild(list);

        var hint = document.createElement('p');
        hint.style.cssText = 'font-size:0.85em;color:#64748b;margin:6px 0 16px 0;text-align:center';
        hint.textContent = 'במקרה של שם זהה — הגרסה מהאורח תישמר עם הסיומת "(אורח)" בלי לדרוס את הקיים.';
        dialog.appendChild(hint);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px';

        var primary = document.createElement('button');
        primary.textContent = 'העבר לחשבון';
        primary.style.cssText = 'padding:11px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#0d9488,#0891b2);color:#fff;font-weight:bold;cursor:pointer;font-size:1em';
        primary.onclick = function() { _migrateGuestBackup(candidates); _closeGuestBackupModal(); };

        var destructive = document.createElement('button');
        destructive.textContent = 'מחק את גיבוי האורח';
        destructive.style.cssText = 'padding:9px 14px;border-radius:8px;border:1px solid #fecaca;background:#fff5f5;color:#b91c1c;cursor:pointer;font-size:0.9em';
        destructive.onclick = function() {
            if (confirm('להסיר את כל גיבויי האורח? פעולה זו לא ניתנת לביטול.')) {
                _wipeGuestBackup();
                _closeGuestBackupModal();
            }
        };

        var cancel = document.createElement('button');
        cancel.textContent = 'השאר כאורח';
        cancel.style.cssText = 'padding:9px 14px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#64748b;cursor:pointer;font-size:0.9em';
        cancel.onclick = function() {
            try { sessionStorage.setItem('_guestBackupPromptDeferred', '1'); } catch (_) {}
            _closeGuestBackupModal();
        };

        btnRow.appendChild(primary);
        btnRow.appendChild(destructive);
        btnRow.appendChild(cancel);
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    function _closeGuestBackupModal() {
        var n = document.getElementById('guest-backup-modal');
        if (n && n.parentNode) n.parentNode.removeChild(n);
    }

    function _migrateGuestBackup(candidates) {
        try {
            var userMap;
            try { userMap = JSON.parse(localStorage.getItem('plonter_vocab_v2') || '{}'); }
            catch (_) { userMap = {}; }

            var renames = [];
            candidates.forEach(function(c) {
                var finalName = c.name;
                if (Object.prototype.hasOwnProperty.call(userMap, finalName)) {
                    // Suffix ladder: " (אורח)", " (אורח 2)", " (אורח 3)", ...
                    var attempt = finalName + ' (אורח)';
                    var n = 2;
                    while (Object.prototype.hasOwnProperty.call(userMap, attempt)) {
                        attempt = finalName + ' (אורח ' + n + ')';
                        n++;
                    }
                    finalName = attempt;
                }
                userMap[finalName] = c.shadow;
                renames.push({ oldName: c.name, newName: finalName });
            });

            localStorage.setItem('plonter_vocab_v2', JSON.stringify(userMap));

            // Migrate parallel per-cat shadow keys (flashcard state, stars).
            // Trivia stats live in flat maps (plonter_trivia_stats, etc.)
            // and aren't keyed by cat name in a clean-extractable way, so we
            // leave them in the shadow — vocab + flashcard state + stars
            // already cover the meaningful guest progress.
            renames.forEach(function(r) { _migrateParallelGuestKeys(r.oldName, r.newName); });

            // Stamp sync queue — ContentSync auto-flushes when authed.
            if (typeof VocabSync !== 'undefined' && VocabSync.onCategorySaved) {
                renames.forEach(function(r) {
                    try { VocabSync.onCategorySaved(r.newName); }
                    catch (e) { console.warn('[auth] VocabSync.onCategorySaved threw', e); }
                });
            }

            // Drop migrated cats from the shadow vocab map. Other shadow
            // entries (e.g. trivia flat maps) stay untouched — they belong
            // to guest progress that the user didn't explicitly migrate.
            try {
                var shadowRaw = localStorage.getItem('plonter_vocab_guest_backup_v2');
                if (shadowRaw) {
                    var shadow = JSON.parse(shadowRaw) || {};
                    candidates.forEach(function(c) { delete shadow[c.name]; });
                    if (Object.keys(shadow).length === 0) {
                        localStorage.removeItem('plonter_vocab_guest_backup_v2');
                    } else {
                        localStorage.setItem('plonter_vocab_guest_backup_v2', JSON.stringify(shadow));
                    }
                }
            } catch (_) {}

            // Re-render the active vocab list if vocab.html is the host page.
            try { if (typeof renderLanding === 'function') renderLanding(); } catch (_) {}

            console.log('[auth] migrated', renames.length, 'guest-shadow categories', renames);
            try {
                if (typeof MessageManager !== 'undefined') {
                    MessageManager.show('גובו ' + renames.length + ' קטגוריות', 'success');
                } else {
                    alert('גובו ' + renames.length + ' קטגוריות בהצלחה.');
                }
            } catch (_) {}
        } catch (e) {
            console.warn('[auth] _migrateGuestBackup failed', e);
            try { alert('שגיאה בגיבוי: ' + (e && e.message || e)); } catch (_) {}
        }
    }

    function _migrateParallelGuestKeys(oldCat, newCat) {
        // Don't clobber an existing user-side key — leaves any pre-existing
        // user state intact. Shadow side is removed regardless to avoid
        // re-prompting on the next login.
        var pairs = [
            { shadow: 'plonter_fc_guest_backup_state_' + oldCat, user: 'plonter_fc_state_' + newCat },
            { shadow: 'plonter_fc_guest_backup_last_'  + oldCat, user: 'plonter_fc_last_'  + newCat },
            { shadow: 'plonter_stars_guest_backup_'    + oldCat, user: 'plonter_stars_'    + newCat }
        ];
        pairs.forEach(function(p) {
            try {
                var v = localStorage.getItem(p.shadow);
                if (v == null) return;
                if (localStorage.getItem(p.user) == null) {
                    localStorage.setItem(p.user, v);
                }
                localStorage.removeItem(p.shadow);
            } catch (_) {}
        });
    }

    function _wipeGuestBackup() {
        try {
            var toRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('guest_backup_') >= 0) toRemove.push(k);
            }
            toRemove.forEach(function(k) { try { localStorage.removeItem(k); } catch (_) {} });
            console.log('[auth] wiped', toRemove.length, 'guest-shadow keys');
            try {
                if (typeof MessageManager !== 'undefined') {
                    MessageManager.show('גיבויי האורח נמחקו', 'info');
                }
            } catch (_) {}
        } catch (e) { console.warn('[auth] _wipeGuestBackup failed', e); }
    }

    var _GUEST_VOCAB_PREFIXES = ['plonter_vocab_', 'plonter_trivia_', 'plonter_fc_', 'plonter_stars_'];
    var _GUEST_VOCAB_PRESERVE = {
        plonter_vocab_active_owner: true,
        plonter_vocab_progress_migrated_v1: true,
        plonter_vocab_stars_per_cat_migrated_v1: true,
        plonter_vocab_builtins_server_cleanup_v1: true,
        plonter_vocab_stars_migrated_v2: true
    };

    function _isGuestVocabShadowKey(k) {
        return !!(k && k.indexOf('guest_backup_') >= 0);
    }

    function _guestVocabShadowKeyFor(k) {
        for (var i = 0; i < _GUEST_VOCAB_PREFIXES.length; i++) {
            var pref = _GUEST_VOCAB_PREFIXES[i];
            if (k.indexOf(pref) === 0) return pref + 'guest_backup_' + k.slice(pref.length);
        }
        return null;
    }

    function _guestVocabOriginalKeyFor(shadowKey) {
        for (var i = 0; i < _GUEST_VOCAB_PREFIXES.length; i++) {
            var pref = _GUEST_VOCAB_PREFIXES[i];
            var shadowPref = pref + 'guest_backup_';
            if (shadowKey.indexOf(shadowPref) === 0) return pref + shadowKey.slice(shadowPref.length);
        }
        return null;
    }

    function _isGuestVocabScopedKey(k) {
        if (!k || _GUEST_VOCAB_PRESERVE[k] || _isGuestVocabShadowKey(k)) return false;
        for (var i = 0; i < _GUEST_VOCAB_PREFIXES.length; i++) {
            if (k.indexOf(_GUEST_VOCAB_PREFIXES[i]) === 0) return true;
        }
        return false;
    }

    function _snapshotGuestVocabToShadow() {
        try {
            // Only snapshot the live vocab keys when the vocab owner tracker
            // says they belong to guest (or before the tracker ever existed).
            var owner = localStorage.getItem('plonter_vocab_active_owner');
            if (owner && owner !== 'guest') return;
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (_isGuestVocabScopedKey(k)) keys.push(k);
            }
            keys.forEach(function(k) {
                var shadow = _guestVocabShadowKeyFor(k);
                if (shadow) localStorage.setItem(shadow, localStorage.getItem(k));
            });
        } catch (e) { console.warn('[auth] _snapshotGuestVocabToShadow failed', e); }
    }

    function _restoreGuestVocabShadowToLive() {
        try {
            var remove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (_isGuestVocabScopedKey(k)) remove.push(k);
            }
            remove.forEach(function(k) { try { localStorage.removeItem(k); } catch (_) {} });

            var shadows = [];
            for (var j = 0; j < localStorage.length; j++) {
                var sk = localStorage.key(j);
                if (_isGuestVocabShadowKey(sk)) shadows.push(sk);
            }
            shadows.forEach(function(sk) {
                var orig = _guestVocabOriginalKeyFor(sk);
                if (orig) localStorage.setItem(orig, localStorage.getItem(sk));
            });
            localStorage.setItem('plonter_vocab_active_owner', 'guest');
        } catch (e) { console.warn('[auth] _restoreGuestVocabShadowToLive failed', e); }
    }

    function _collectGuestSentenceBackups() {
        var out = [];
        try {
            _removeMigratedGuestSentenceCopies();
            var handled = _getHandledGuestSentenceBackupIds();
            if (typeof getCustomStages !== 'function') return out;
            var stages = getCustomStages();
            stages.forEach(function(stage) {
                if (!stage || stage._createdAsGuest !== true || stage._isBuiltinSeed === true) return;
                var entry = {
                    id: 'stage:' + String(stage.id || ''),
                    source_domain: 'unknown',
                    stage: Object.assign({}, stage),
                    analyses: {},
                    hindus: null
                };
                if (handled[entry.id]) return;
                var state = _collectGuestStageState(stage.id);
                entry.analyses = state.analyses;
                entry.hindus = state.hindus;
                entry.source_domain = _inferGuestSentenceDomain(entry);
                if (handled[_guestSentenceMeaningfulSignature(entry)]) return;
                out.push(entry);
            });
        } catch (e) { console.warn('[auth] _collectGuestSentenceBackups failed', e); }
        return out;
    }

    function _stashGuestSentenceBackups() {
        try {
            var fresh = _collectGuestSentenceBackups();
            if (!fresh.length) return;
            var prev = [];
            try { prev = JSON.parse(localStorage.getItem('plonter_sentence_guest_backup_v1') || '[]'); } catch (_) {}
            var bySig = {};
            prev.concat(fresh).forEach(function(entry) {
                if (!entry || !entry.stage) return;
                if (!entry.id) entry.id = _guestSentenceStableId(entry);
                if (!entry.source_domain) entry.source_domain = _inferGuestSentenceDomain(entry);
                if (_isGuestSentenceBackupHandled(entry)) return;
                bySig[_guestSentenceStableId(entry)] = entry;
            });
            localStorage.setItem('plonter_sentence_guest_backup_v1', JSON.stringify(Object.values(bySig)));
        } catch (e) { console.warn('[auth] _stashGuestSentenceBackups failed', e); }
    }

    function _restoreGuestSentenceBackupsToGuestStages(opts) {
        try {
            opts = opts || {};
            if (typeof getCustomStages !== 'function' || typeof saveCustomStages !== 'function') return;
            if (typeof ContentSync !== 'undefined' &&
                typeof ContentSync.isLoggedIn === 'function' &&
                ContentSync.isLoggedIn() &&
                !opts.allowLoggedIn) return;
            var raw = localStorage.getItem('plonter_sentence_guest_backup_v1');
            if (!raw) return;
            var backups = [];
            try { backups = JSON.parse(raw) || []; } catch (_) { backups = []; }
            if (!backups.length) return;

            var customs = getCustomStages();
            var seen = {};
            customs.forEach(function(stage) {
                if (!stage || !stage.id) return;
                seen['stage:' + String(stage.id)] = true;
                try { seen[_guestSentenceStableId(_entryForStage(stage))] = true; } catch (_) {}
            });

            var changed = false;
            backups.forEach(function(entry) {
                if (!entry || !entry.stage || !entry.stage.sentence) return;
                if (_isGuestSentenceBackupHandled(entry)) return;
                var backupState = entry.backup_state || entry.backupState || entry.stage._guestBackupStatus || 'pending';
                if (backupState === 'backing_up' ||
                    backupState === 'backed_up' ||
                    backupState === 'handled' ||
                    backupState === 'deleted') return;
                var stableId = _guestSentenceStableId(entry);
                var oldStage = entry.stage;
                var oldId = oldStage && oldStage.id;
                if ((oldId && seen['stage:' + String(oldId)]) || seen[stableId]) return;
                var stage = Object.assign({}, oldStage, {
                    isCustom: true,
                    _createdAsGuest: true,
                    _isBuiltinSeed: false,
                    _guestBackupStatus: backupState,
                    source_domain: entry.source_domain || _inferGuestSentenceDomain(entry),
                    updated: oldStage.updated || new Date().toISOString()
                });
                if (!stage.id) stage.id = stableId.replace(/[^A-Za-z0-9_-]+/g, '_');
                customs.push(stage);
                seen['stage:' + String(stage.id)] = true;
                seen[stableId] = true;
                changed = true;

                if (entry.analyses) {
                    Object.keys(entry.analyses).forEach(function(aid) {
                        try {
                            localStorage.setItem(
                                'plonter_v4_stage_' + stage.id + '_analysis_' + aid,
                                JSON.stringify(entry.analyses[aid])
                            );
                        } catch (_) {}
                    });
                }
                if (entry.hindus) {
                    try { localStorage.setItem('plonter_v4_stage_' + stage.id + '_hindus_v2', JSON.stringify(entry.hindus)); } catch (_) {}
                }
            });

            if (!changed) return;
            saveCustomStages(customs);
            try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (_) {}
        } catch (e) { console.warn('[auth] _restoreGuestSentenceBackupsToGuestStages failed', e); }
    }

    function _stashCurrentGuestWorkForPrompts() {
        try {
            if (typeof PlonterTexts !== 'undefined' &&
                typeof PlonterTexts.stashGuestShadow === 'function') {
                PlonterTexts.stashGuestShadow();
            }
        } catch (e) { console.warn('[auth] stash current guest texts failed', e); }
        try { _stashGuestSentenceBackups(); }
        catch (e) { console.warn('[auth] stash current guest sentences failed', e); }
    }

    function _getHandledGuestSentenceBackupIds() {
        try {
            var arr = JSON.parse(localStorage.getItem('plonter_sentence_guest_backup_handled_v1') || '[]') || [];
            var out = {};
            arr.forEach(function(id) { if (id) out[String(id)] = true; });
            return out;
        } catch (_) {
            return {};
        }
    }

    function _markGuestSentenceBackupsHandled(items) {
        try {
            var handled = _getHandledGuestSentenceBackupIds();
            (items || []).forEach(function(entry) {
                var stableId = _guestSentenceStableId(entry);
                if (stableId) handled[stableId] = true;
                if (entry && entry.stage && entry.stage.id) handled['stage:' + String(entry.stage.id)] = true;
                var sig = _guestSentenceMeaningfulSignature(entry);
                if (sig) handled[sig] = true;
                var comparableSig = _guestSentenceComparableSignature(entry);
                if (comparableSig) handled[comparableSig] = true;
            });
            localStorage.setItem('plonter_sentence_guest_backup_handled_v1', JSON.stringify(Object.keys(handled)));
        } catch (e) { console.warn('[auth] _markGuestSentenceBackupsHandled failed', e); }
    }

    function _isGuestSentenceBackupHandled(entry) {
        var handled = _getHandledGuestSentenceBackupIds();
        return !!(
            handled[_guestSentenceStableId(entry)] ||
            handled[_guestSentenceMeaningfulSignature(entry)] ||
            handled[_guestSentenceComparableSignature(entry)]
        );
    }

    function _getSkippedGuestSentenceBackupIds() {
        try {
            var arr = JSON.parse(localStorage.getItem('plonter_sentence_guest_backup_skipped_v1') || '[]') || [];
            var out = {};
            arr.forEach(function(id) { if (id) out[String(id)] = true; });
            return out;
        } catch (_) {
            return {};
        }
    }

    function _markGuestSentenceBackupsSkipped(items) {
        try {
            var skipped = _getSkippedGuestSentenceBackupIds();
            (items || []).forEach(function(entry) {
                var stableId = _guestSentenceStableId(entry);
                if (stableId) skipped[stableId] = true;
                if (entry && entry.stage && entry.stage.id) skipped['stage:' + String(entry.stage.id)] = true;
                var sig = _guestSentenceMeaningfulSignature(entry);
                if (sig) skipped[sig] = true;
                var comparableSig = _guestSentenceComparableSignature(entry);
                if (comparableSig) skipped[comparableSig] = true;
            });
            localStorage.setItem('plonter_sentence_guest_backup_skipped_v1', JSON.stringify(Object.keys(skipped)));
        } catch (e) { console.warn('[auth] _markGuestSentenceBackupsSkipped failed', e); }
    }

    function _isGuestSentenceBackupSkipped(entry) {
        var skipped = _getSkippedGuestSentenceBackupIds();
        return !!(
            skipped[_guestSentenceStableId(entry)] ||
            skipped[_guestSentenceMeaningfulSignature(entry)] ||
            skipped[_guestSentenceComparableSignature(entry)]
        );
    }

    function _collectGuestStageState(stageId) {
        var out = { analyses: {}, hindus: null };
        try {
            var analysisPrefix = 'plonter_v4_stage_' + stageId + '_analysis_';
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(analysisPrefix) !== 0) continue;
                var aid = k.slice(analysisPrefix.length);
                try { out.analyses[aid] = JSON.parse(localStorage.getItem(k)); } catch (_) {}
            }
            var hRaw = localStorage.getItem('plonter_v4_stage_' + stageId + '_hindus_v2');
            if (hRaw) out.hindus = JSON.parse(hRaw);
        } catch (e) { console.warn('[auth] _collectGuestStageState failed', e); }
        return out;
    }

    function _entryForStage(stage) {
        var state = _collectGuestStageState(stage.id);
        var entry = {
            id: 'stage:' + String(stage.id || ''),
            source_domain: stage.source_domain || 'unknown',
            stage: Object.assign({}, stage),
            analyses: state.analyses,
            hindus: state.hindus
        };
        entry.source_domain = _inferGuestSentenceDomain(entry);
        return entry;
    }

    function _removeMigratedGuestSentenceCopies() {
        try {
            if (typeof getCustomStages !== 'function' || typeof saveCustomStages !== 'function') return;
            var stages = getCustomStages();
            var accountComparable = {};
            stages.forEach(function(stage) {
                if (!stage || !stage.sentence || stage._createdAsGuest === true) return;
                accountComparable[_guestSentenceComparableSignature(_entryForStage(stage))] = true;
                if (stage.migratedFromGuestId) accountComparable[String(stage.migratedFromGuestId)] = true;
            });

            var changed = false;
            var removedGuestIds = [];
            var cleaned = stages.filter(function(stage) {
                if (!stage || stage._createdAsGuest !== true) return true;
                var entry = _entryForStage(stage);
                var stableId = _guestSentenceStableId(entry);
                var comparable = _guestSentenceComparableSignature(entry);
                var isSyncedGuest = false;
                try {
                    isSyncedGuest = typeof ContentSync !== 'undefined' &&
                        typeof ContentSync.isSynced === 'function' &&
                        ContentSync.isSynced('sentence', stage.id);
                } catch (_) {}
                if (accountComparable[stableId] || accountComparable[comparable]) {
                    removedGuestIds.push(stage.id);
                    changed = true;
                    return false;
                }
                if (isSyncedGuest) {
                    delete stage._createdAsGuest;
                    delete stage._guestWorkingCopy;
                    delete stage._guestBackupStatus;
                    stage.source_domain = stage.source_domain || _inferGuestSentenceDomain(entry);
                    changed = true;
                }
                return true;
            });

            if (!changed) return;
            localStorage.setItem('plonter_custom_stages', JSON.stringify(cleaned));
            _removeGuestSentenceLocalDrafts(removedGuestIds.map(function(id) {
                return { stage: { id: id } };
            }));
            try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (_) {}
        } catch (e) { console.warn('[auth] _removeMigratedGuestSentenceCopies failed', e); }
    }

    function _promptGuestSentenceBackupOnLogin() {
        // Current producer for plonter_sentence_guest_backup_v1 is syntax
        // sentence work. Keep the resolver metadata-aware so future modules
        // cannot silently reuse this key while still displaying "תחביר".
        _removeMigratedGuestSentenceCopies();
        try {
            if (sessionStorage.getItem('_guestSentenceBackupPromptDeferred') === '1') return;
        } catch (_) {}
        var raw = localStorage.getItem('plonter_sentence_guest_backup_v1');
        if (!raw || document.getElementById('guest-sentence-backup-modal')) return;
        var items;
        try { items = JSON.parse(raw) || []; } catch (_) { return; }
        items = items.filter(function(entry) { return entry && entry.stage && entry.stage.sentence; });
        items = items.filter(function(entry) { return !_isGuestSentenceBackupHandled(entry); });
        items = items.filter(function(entry) {
            var state = entry.backup_state || entry.backupState || entry.stage._guestBackupStatus || 'pending';
            return state !== 'backing_up' &&
                state !== 'backed_up' &&
                state !== 'handled' &&
                state !== 'deleted';
        });
        items = _filterMeaningfulGuestSentenceBackups(items);
        if (!items.length) return;

        // Sentences now join the single ContentSync migration dialog. The
        // legacy sentence-only modal caused a second popup on login. Restore
        // the guest backups into the normal custom-stage list, then let
        // ContentSync collect them together with lessons/texts/hindus.
        if (typeof ContentSync !== 'undefined' && typeof ContentSync.checkMigration === 'function') {
            _restoreGuestSentenceBackupsToGuestStages({ allowLoggedIn: true });
            try {
                if (typeof getCustomStages === 'function') {
                    ContentSync.checkMigration('sentence', getCustomStages().filter(function(s) {
                        if (!s) return false;
                        if (s._isBuiltinSeed === true) return false;
                        if (typeof s.id === 'string' && (s.id.indexOf('seed_') === 0 || s.id.indexOf('guestseed_') === 0)) return false;
                        return true;
                    }));
                }
            } catch (e) { console.warn('[auth] unified guest sentence migration failed', e); }
            return;
        }

    }

    function _writeGuestSentenceBackupEntries(mutator) {
        var raw = localStorage.getItem('plonter_sentence_guest_backup_v1');
        var arr = [];
        try { arr = JSON.parse(raw || '[]') || []; } catch (_) { arr = []; }
        var next = mutator(arr) || arr;
        if (next.length) localStorage.setItem('plonter_sentence_guest_backup_v1', JSON.stringify(next));
        else localStorage.removeItem('plonter_sentence_guest_backup_v1');
        return next;
    }

    function _updateGuestSentenceBackupEntries(items, updates) {
        var ids = {};
        (items || []).forEach(function(entry) { ids[_guestSentenceStableId(entry)] = true; });
        return _writeGuestSentenceBackupEntries(function(arr) {
            return arr.map(function(entry) {
                if (!ids[_guestSentenceStableId(entry)]) return entry;
                return Object.assign({}, entry, updates || {});
            });
        });
    }

    function _markGuestSentenceBackupsNotBackedUp(items) {
        try {
            _updateGuestSentenceBackupEntries(items, {
                backup_state: 'not_backed_up',
                skippedAt: new Date().toISOString()
            });
            var clearIds = {};
            (items || []).forEach(function(entry) {
                var stableId = _guestSentenceStableId(entry);
                if (stableId) clearIds[stableId] = true;
                if (entry && entry.stage && entry.stage.id) clearIds['stage:' + String(entry.stage.id)] = true;
                var sig = _guestSentenceMeaningfulSignature(entry);
                if (sig) clearIds[sig] = true;
                var comparableSig = _guestSentenceComparableSignature(entry);
                if (comparableSig) clearIds[comparableSig] = true;
            });
            _removeIdsFromGuestSentenceSet('plonter_sentence_guest_backup_skipped_v1', clearIds);
        } catch (e) { console.warn('[auth] mark guest sentence not_backed_up failed', e); }
    }

    function _deleteGuestSentenceBackupsOptimistic(items, overlay) {
        var prevRaw = localStorage.getItem('plonter_sentence_guest_backup_v1');
        var prevHandledRaw = localStorage.getItem('plonter_sentence_guest_backup_handled_v1');
        var prevSkippedRaw = localStorage.getItem('plonter_sentence_guest_backup_skipped_v1');
        var deleteIds = {};
        (items || []).forEach(function(entry) { deleteIds[_guestSentenceStableId(entry)] = true; });
        var rows = overlay ? overlay.querySelectorAll('[data-gsb-id]') : [];
        rows.forEach(function(row) {
            if (deleteIds[row.dataset.gsbId]) {
                row.dataset.prevDisplay = row.style.display || '';
                row.style.display = 'none';
            }
        });
        try {
            _markGuestSentenceBackupsHandled(items);
            var existing = [];
            try { existing = JSON.parse(prevRaw || '[]') || []; } catch (_) { existing = []; }
            var remaining = existing.filter(function(entry) {
                return !deleteIds[_guestSentenceStableId(entry)];
            });
            if (remaining.length) {
                localStorage.setItem('plonter_sentence_guest_backup_v1', JSON.stringify(remaining));
            } else {
                localStorage.removeItem('plonter_sentence_guest_backup_v1');
            }
            var visibleRows = overlay ? Array.prototype.filter.call(overlay.querySelectorAll('[data-gsb-id]'), function(row) {
                return row.style.display !== 'none';
            }) : [];
            if (overlay && visibleRows.length === 0) overlay.remove();
            try { if (typeof MessageManager !== 'undefined') MessageManager.show('גיבוי האורח נמחק', 'info'); } catch (_) {}
        } catch (e) {
            if (prevRaw != null) {
                try { localStorage.setItem('plonter_sentence_guest_backup_v1', prevRaw); } catch (_) {}
            } else {
                try { localStorage.removeItem('plonter_sentence_guest_backup_v1'); } catch (_) {}
            }
            if (prevHandledRaw != null) {
                try { localStorage.setItem('plonter_sentence_guest_backup_handled_v1', prevHandledRaw); } catch (_) {}
            } else {
                try { localStorage.removeItem('plonter_sentence_guest_backup_handled_v1'); } catch (_) {}
            }
            if (prevSkippedRaw != null) {
                try { localStorage.setItem('plonter_sentence_guest_backup_skipped_v1', prevSkippedRaw); } catch (_) {}
            } else {
                try { localStorage.removeItem('plonter_sentence_guest_backup_skipped_v1'); } catch (_) {}
            }
            rows.forEach(function(row) {
                if (deleteIds[row.dataset.gsbId]) row.style.display = row.dataset.prevDisplay || '';
            });
            try {
                if (typeof MessageManager !== 'undefined') MessageManager.show('מחיקת גיבוי האורח נכשלה', 'error');
                else alert('מחיקת גיבוי האורח נכשלה');
            } catch (_) {}
            console.warn('[auth] _deleteGuestSentenceBackupsOptimistic failed', e);
        }
    }

    function _deleteGuestSentenceBackupForStage(stage) {
        if (!stage || !stage.id) return false;
        var entry = _entryForStage(stage);
        var stableId = _guestSentenceStableId(entry);
        return _deleteGuestSentenceBackupsByIds([stableId, 'stage:' + String(stage.id)], [entry]);
    }

    function _deleteGuestSentenceBackupsByIds(ids, handledItems) {
        var prevRaw = localStorage.getItem('plonter_sentence_guest_backup_v1');
        var prevHandledRaw = localStorage.getItem('plonter_sentence_guest_backup_handled_v1');
        var prevSkippedRaw = localStorage.getItem('plonter_sentence_guest_backup_skipped_v1');
        try {
            var deleteIds = {};
            (ids || []).forEach(function(id) { if (id) deleteIds[String(id)] = true; });
            (handledItems || []).forEach(function(entry) {
                var stableId = _guestSentenceStableId(entry);
                if (stableId) deleteIds[stableId] = true;
                if (entry && entry.stage && entry.stage.id) deleteIds['stage:' + String(entry.stage.id)] = true;
            });
            _markGuestSentenceBackupsHandled(handledItems || []);
            var existing = [];
            try { existing = JSON.parse(prevRaw || '[]') || []; } catch (_) { existing = []; }
            var remaining = existing.filter(function(entry) {
                return !(deleteIds[_guestSentenceStableId(entry)] ||
                    (entry && entry.stage && deleteIds['stage:' + String(entry.stage.id)]));
            });
            if (remaining.length) localStorage.setItem('plonter_sentence_guest_backup_v1', JSON.stringify(remaining));
            else localStorage.removeItem('plonter_sentence_guest_backup_v1');
            _removeIdsFromGuestSentenceSet('plonter_sentence_guest_backup_skipped_v1', deleteIds);
            return true;
        } catch (e) {
            if (prevRaw != null) localStorage.setItem('plonter_sentence_guest_backup_v1', prevRaw);
            else localStorage.removeItem('plonter_sentence_guest_backup_v1');
            if (prevHandledRaw != null) localStorage.setItem('plonter_sentence_guest_backup_handled_v1', prevHandledRaw);
            else localStorage.removeItem('plonter_sentence_guest_backup_handled_v1');
            if (prevSkippedRaw != null) localStorage.setItem('plonter_sentence_guest_backup_skipped_v1', prevSkippedRaw);
            else localStorage.removeItem('plonter_sentence_guest_backup_skipped_v1');
            console.warn('[auth] _deleteGuestSentenceBackupForStage failed', e);
            throw e;
        }
    }

    function _removeIdsFromGuestSentenceSet(key, deleteIds) {
        try {
            var arr = JSON.parse(localStorage.getItem(key) || '[]') || [];
            var next = arr.filter(function(id) { return !deleteIds[String(id)]; });
            if (next.length) localStorage.setItem(key, JSON.stringify(next));
            else localStorage.removeItem(key);
        } catch (_) {}
    }

    function _migrateGuestSentenceBackups(items, overlay) {
        try {
            items = items || [];
            _updateGuestSentenceBackupEntries(items, {
                backup_state: 'backing_up',
                backupStartedAt: new Date().toISOString()
            });
            if (overlay) {
                items.forEach(function(entry) {
                    var row = overlay.querySelector('[data-gsb-id="' + _cssEscape(_guestSentenceStableId(entry)) + '"]');
                    if (!row) return;
                    row.style.animation = 'cs-card-pulse 1.4s ease-in-out infinite';
                    row.querySelectorAll('button').forEach(function(btn) { btn.disabled = true; btn.style.opacity = '0.6'; });
                    var badge = row.querySelector('.guest-sentence-backup-state');
                    if (badge) {
                        badge.style.display = '';
                        badge.className = 'guest-sentence-backup-state backing-up';
                        badge.textContent = 'בתהליך גיבוי... ☁️';
                    }
                });
            }
            _markGuestSentenceBackupsHandled(items);
            var customs = typeof getCustomStages === 'function' ? getCustomStages() : [];
            var removeStageIds = {};
            items.forEach(function(entry) {
                if (entry && entry.stage && entry.stage.id) removeStageIds[String(entry.stage.id)] = true;
            });
            customs = customs.filter(function(stage) {
                return !(stage && stage._createdAsGuest === true && removeStageIds[String(stage.id)]);
            });
            var existingNames = {};
            customs.forEach(function(s) { if (s && s.number) existingNames[s.number] = true; });
            items.forEach(function(entry, i) {
                var stage = Object.assign({}, entry.stage);
                var baseName = stage._guestWorkingCopy
                    ? 'עותק אורח — ' + (stage.number || (stage.sentence || 'משפט').slice(0, 30))
                    : (stage.number || (stage.sentence || 'משפט').slice(0, 30));
                var finalName = baseName;
                var n = 2;
                while (existingNames[finalName]) {
                    finalName = baseName + ' (אורח ' + n + ')';
                    n++;
                }
                existingNames[finalName] = true;
                var oldId = stage.id;
                stage.id = 'guest_mig_' + Date.now() + '_' + i;
                stage.number = finalName;
                stage.isCustom = true;
                stage._createdAsGuest = false;
                stage._isBuiltinSeed = false;
                stage.migratedFromGuestId = _guestSentenceStableId(entry);
                stage.source_id = stage.source_id || stage._guestSourceId || (entry.stage && entry.stage.source_id) || null;
                stage.source_type = stage.source_type || (entry.stage && entry.stage.source_type) || 'guest_copy';
                stage.source_domain = entry.source_domain || _inferGuestSentenceDomain(entry);
                stage._guestBackupState = 'backing_up';
                stage._priorityFromGuestUntil = Date.now() + (10 * 60 * 1000);
                stage._createdFromGuestAt = new Date().toISOString();
                stage.updated = new Date().toISOString();
                customs.push(stage);
                if (entry.analyses) {
                    Object.keys(entry.analyses).forEach(function(aid) {
                        try {
                            localStorage.setItem(
                                'plonter_v4_stage_' + stage.id + '_analysis_' + aid,
                                JSON.stringify(entry.analyses[aid])
                            );
                        } catch (_) {}
                    });
                }
                if (entry.hindus) {
                    try {
                        localStorage.setItem('plonter_v4_stage_' + stage.id + '_hindus_v2', JSON.stringify(entry.hindus));
                    } catch (_) {}
                }
            });
            if (typeof saveCustomStages === 'function') saveCustomStages(customs);
            _removeGuestSentenceLocalDrafts(items);
            var migrateIds = {};
            items.forEach(function(entry) { migrateIds[_guestSentenceStableId(entry)] = true; });
            var existing = [];
            try { existing = JSON.parse(localStorage.getItem('plonter_sentence_guest_backup_v1') || '[]') || []; } catch (_) { existing = []; }
            var remaining = existing.filter(function(entry) {
                return !migrateIds[_guestSentenceStableId(entry)];
            });
            if (remaining.length) {
                localStorage.setItem('plonter_sentence_guest_backup_v1', JSON.stringify(remaining));
            } else {
                localStorage.removeItem('plonter_sentence_guest_backup_v1');
            }
            if (overlay) {
                var rows = overlay.querySelectorAll('[data-gsb-id]');
                rows.forEach(function(row) {
                    if (migrateIds[row.dataset.gsbId]) row.style.display = 'none';
                });
                var visibleRows = Array.prototype.filter.call(rows, function(row) {
                    return row.style.display !== 'none';
                });
                if (visibleRows.length === 0) overlay.remove();
            }
            try { if (typeof Modals !== 'undefined' && Modals.renderStages) Modals.renderStages(); } catch (_) {}
            try {
                if (typeof MessageManager !== 'undefined') {
                    MessageManager.show(items.length === 1 ? 'המשפט הועבר לחשבון' : 'משפטי האורח הועברו לחשבון', 'success');
                }
            } catch (_) {}
        } catch (e) {
            try {
                _updateGuestSentenceBackupEntries(items || [], {
                    backup_state: 'failed',
                    lastBackupError: (e && e.message) || String(e),
                    failedAt: new Date().toISOString()
                });
            } catch (_) {}
            if (overlay) {
                (items || []).forEach(function(entry) {
                    var row = overlay.querySelector('[data-gsb-id="' + _cssEscape(_guestSentenceStableId(entry)) + '"]');
                    if (!row) return;
                    row.style.animation = '';
                    row.querySelectorAll('button').forEach(function(btn) { btn.disabled = false; btn.style.opacity = ''; });
                    var badge = row.querySelector('.guest-sentence-backup-state');
                    if (badge) {
                        badge.style.display = '';
                        badge.className = 'guest-sentence-backup-state failed';
                        badge.textContent = 'הגיבוי נכשל';
                    }
                });
            }
            try { if (typeof MessageManager !== 'undefined') MessageManager.show('הגיבוי נכשל — אפשר לנסות שוב', 'error'); } catch (_) {}
            console.warn('[auth] _migrateGuestSentenceBackups failed', e);
        }
    }

    function _cssEscape(s) {
        if (window.CSS && CSS.escape) return CSS.escape(String(s));
        return String(s).replace(/["\\]/g, '\\$&');
    }

    function _stableGuestJson(value) {
        if (Array.isArray(value)) return value.map(_stableGuestJson);
        if (value && typeof value === 'object') {
            var out = {};
            Object.keys(value).sort().forEach(function(k) {
                if (k === 'id' || k === 'created' || k === 'updated' || k === '_createdAsGuest' || k === '_isBuiltinSeed' || k === '_sync') return;
                out[k] = _stableGuestJson(value[k]);
            });
            return out;
        }
        return value;
    }

    function _stableGuestComparableJson(value) {
        if (Array.isArray(value)) return value.map(_stableGuestComparableJson);
        if (value && typeof value === 'object') {
            var out = {};
            var skip = {
                id: 1,
                number: 1,
                created: 1,
                updated: 1,
                _createdAsGuest: 1,
                _isBuiltinSeed: 1,
                _sync: 1,
                migratedFromGuestId: 1,
                source_id: 1,
                source_type: 1,
                source_domain: 1,
                _guestBackupState: 1,
                _priorityFromGuestUntil: 1,
                _createdFromGuestAt: 1,
                _guestWorkingCopy: 1,
                _guestSourceId: 1
            };
            Object.keys(value).sort().forEach(function(k) {
                if (skip[k]) return;
                out[k] = _stableGuestComparableJson(value[k]);
            });
            return out;
        }
        return value;
    }

    function _guestSentenceMeaningfulSignature(entry) {
        if (!entry || !entry.stage) return '';
        return JSON.stringify({
            stage: _stableGuestJson(entry.stage),
            analyses: _stableGuestJson(entry.analyses || {}),
            hindus: _stableGuestJson(entry.hindus || null)
        });
    }

    function _guestSentenceComparableSignature(entry) {
        if (!entry || !entry.stage) return '';
        return JSON.stringify({
            stage: _stableGuestComparableJson(entry.stage),
            analyses: _stableGuestComparableJson(entry.analyses || {}),
            hindus: _stableGuestComparableJson(entry.hindus || null)
        });
    }

    function _removeGuestSentenceLocalDrafts(items) {
        try {
            var sourceIds = {};
            (items || []).forEach(function(entry) {
                if (entry && entry.stage && entry.stage.id) sourceIds[String(entry.stage.id)] = true;
            });
            Object.keys(sourceIds).forEach(function(stageId) {
                var analysisPrefix = 'plonter_v4_stage_' + stageId + '_analysis_';
                var removeKeys = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (!k) continue;
                    if (k.indexOf(analysisPrefix) === 0 || k === 'plonter_v4_stage_' + stageId + '_hindus_v2') {
                        removeKeys.push(k);
                    }
                }
                removeKeys.forEach(function(k) {
                    try { localStorage.removeItem(k); } catch (_) {}
                });
            });
        } catch (e) { console.warn('[auth] _removeGuestSentenceLocalDrafts failed', e); }
    }

    function _guestSentenceStableId(entry) {
        if (!entry) return '';
        if (entry.id) return String(entry.id);
        var stage = entry.stage || {};
        if (stage.id) return 'stage:' + String(stage.id);
        // Legacy fallback only. New entries carry entry.id/stage.id so two
        // separate drafts with identical text never collapse into one row.
        return 'legacy:' + _guestSentenceMeaningfulSignature(entry);
    }

    function _inferGuestSentenceDomain(entry) {
        var stage = (entry && entry.stage) || {};
        var raw = (entry && entry.source_domain) ||
            stage.source_domain ||
            stage.content_domain ||
            stage.domain ||
            stage.content_type ||
            stage.source_type ||
            '';
        raw = String(raw || '').toLowerCase();
        if (raw === 'analysis' || raw === 'syntax') return 'analysis';
        if (raw === 'hindus' || raw === 'engineering') return 'hindus';
        if (raw === 'text' || raw === 'texts') return 'text';
        if (raw === 'lesson' || raw === 'lessons') return 'lesson';
        if (stage.lessonId || stage.lesson_id || stage.sourceLessonId) return 'lesson';
        if (stage.textId || stage.text_id || stage.sourceTextId) return 'text';
        if (stage.isHindus === true || stage.category === 'hindus' || (entry && entry.hindus)) return 'hindus';
        if (entry && entry.analyses && Object.keys(entry.analyses).length) return 'analysis';
        return 'unknown';
    }

    function _entryHasGuestWork(entry) {
        if (!entry || !entry.stage || !entry.stage.sentence) return false;
        if (entry.analyses && Object.keys(entry.analyses).length) return true;
        if (entry.hindus && entry.hindus.version === 2 && Array.isArray(entry.hindus.tabs)) {
            for (var i = 0; i < entry.hindus.tabs.length; i++) {
                var st = entry.hindus.tabs[i] && entry.hindus.tabs[i].state;
                if (!st) continue;
                var slots = Array.isArray(st.slots) ? st.slots : [];
                var hebrewRects = Array.isArray(st.hebrewRects) ? st.hebrewRects : [];
                var arabicRects = Array.isArray(st.arabicRects) ? st.arabicRects : [];
                var hasSlots = slots.some(function(x) { return x !== null && x !== undefined; });
                var hasHebrewRects = hebrewRects.some(function(x) { return String(x || '').trim(); });
                var hasArabicRects = arabicRects.some(function(x) { return String(x || '').trim(); });
                var hasTags = st.wordTags && Object.keys(st.wordTags).some(function(k) {
                    return Array.isArray(st.wordTags[k]) ? st.wordTags[k].length > 0 : !!st.wordTags[k];
                });
                var hasGhosts = st.ghostedColumns && Object.keys(st.ghostedColumns).length > 0;
                var hasRedundant = st.redundantWords && Object.keys(st.redundantWords).length > 0;
                if (hasSlots || hasHebrewRects || hasArabicRects || hasTags || hasGhosts || hasRedundant) return true;
            }
        }
        // A guest-created sentence itself is still user work even before an
        // analysis/hindus draft exists.
        return true;
    }

    function _filterMeaningfulGuestSentenceBackups(items) {
        var customs = [];
        try { customs = typeof getCustomStages === 'function' ? getCustomStages() : []; } catch (_) {}
        var existingBySig = {};
        customs.forEach(function(stage) {
            if (!stage || !stage.sentence) return;
            if (stage._createdAsGuest === true) return;
            var sig = JSON.stringify({ stage: _stableGuestJson(stage), analyses: {}, hindus: null });
            existingBySig[sig] = true;
        });
        var seen = {};
        return (items || []).filter(function(entry) {
            if (!_entryHasGuestWork(entry)) return false;
            var stableId = _guestSentenceStableId(entry);
            if (!stableId || seen[stableId]) return false;
            seen[stableId] = true;
            var sig = _guestSentenceMeaningfulSignature(entry);
            if (!sig) return false;
            if (existingBySig[sig]) return false;
            var comparableSig = _guestSentenceComparableSignature(entry);
            return !existingBySig[comparableSig];
        });
    }

    // Wipe content-related localStorage so user B, logging in on user A's
    // browser, doesn't inherit A's lessons, sync state, or pending uploads.
    //
    // `opts.preserveLocalOnly` (default false): keep per-item keys whose
    // contents never round-trip to the server (qmark answers, vocab
    // progress, syntactic analyses). Callers in the LOGOUT flow pass
    // true so same-user relogin doesn't lose local-only work — Amitai
    // 2026-04-19 08:08: "זה לא שומר לי את הניתוח התחבירי כשאני יוצא ואז
    // חוזר למשתמש". The cross-user switch path (different user logging
    // in on the same browser) still passes false — different seed_
    // ids between users means the analyses would never address each
    // other anyway, but we stay conservative on that path.
    function _clearUserScopedContent(opts) {
        var preserveLocalOnly = !!(opts && opts.preserveLocalOnly);
        try {
            if (typeof PlonterTexts !== 'undefined' &&
                typeof PlonterTexts.stashGuestShadow === 'function') {
                PlonterTexts.stashGuestShadow();
            }
        } catch (e) { console.warn('[auth] stash guest texts failed', e); }
        _stashGuestSentenceBackups();
        var keys = [
            'plonter_lessons',
            'plonter_texts',
            'plonter_custom_slides',
            'plonter_custom_stages',
            'plonter_hidden_demos'
        ];
        keys.forEach(function(k) { localStorage.removeItem(k); });
        // Public/shared vocab categories opened from global search are a
        // per-viewer cache. Wipe them on logout/cross-user switch so user B
        // or a guest never sees user A's "קטגוריות משותפות איתי" list.
        localStorage.removeItem('plonter_public_vocab_cache_v1');
        localStorage.removeItem('plonter_public_vocab_published_v1');
        if (preserveLocalOnly) return;
        // Bug #289 (Amitai 2026-04-20 19:23): same-user logout within the
        // 2s ContentSync debounce window wiped the still-unflushed queue,
        // so the save never reached the server. On relogin, pullAll then
        // overwrote LS with older server state. Keep sync_queue +
        // sync_meta on preserveLocalOnly:true (logout), wipe only on
        // cross-user switch where A's pending saves must not push under
        // B's token. The paired fix in onLogin flushes the surviving
        // queue before the next pullAll.
        localStorage.removeItem('plonter_sync_queue');
        localStorage.removeItem('plonter_sync_meta');
        // Per-item keys (qmark answers, vocab progress) use prefixes.
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k) continue;
            // Guest-progress shadow keys (<prefix>guest_backup_<rest>) —
            // vocab.html stashes guest vocab/trivia/fc/stars state into
            // these slots so it survives a cross-user login cycle.
            // Amitai 2026-04-21 00:57 policy: "each keeps own", guest
            // progress persists across user switches. Shadow keys must
            // survive this sweep too, otherwise User A→User B login
            // would destroy the guest's saved data.
            if (k.indexOf('guest_backup_') >= 0) continue;
            if (k.indexOf('plonter_qmark_') === 0) toRemove.push(k);
            if (k.indexOf('plonter_vocab_') === 0) toRemove.push(k);
            // Vocab progress lives under non-vocab_ prefixes too:
            //   plonter_trivia_stats, plonter_trivia_not_sure     (flat maps)
            //   plonter_fc_state_<cat>, plonter_fc_last_<cat>     (per-cat)
            //   plonter_stars_<cat>                               (per-cat stars — 2026-04-20 flip)
            // Without wiping these, trivia scores + flashcard state + stars
            // leak between users on the same browser (VocabProgressSync 2026-04-20).
            if (k.indexOf('plonter_trivia_') === 0) toRemove.push(k);
            if (k.indexOf('plonter_fc_') === 0) toRemove.push(k);
            if (k.indexOf('plonter_stars_') === 0) toRemove.push(k);
            // plonter_vocab_audio_ids_<cat> is already caught by the
            // plonter_vocab_ prefix above; explicit entry left out to avoid
            // duplicates.
            // Per-sentence syntactic analyses (POS tags, combinations,
            // arches) from persistence.js — Amitai 2026-04-19 05:23 saw
            // user A's saved analysis on a sentence leak to user B/guest.
            if (k.indexOf('plonter_v4_stage_') === 0) toRemove.push(k);
            // ContentSync meta-tracking maps owned by analysesSync.js /
            // hindusSync.js — also per-user scoped, drop on switch so the
            // next user starts with a fresh "unsynced" badge state.
            if (k === 'plonter_analyses_cs_meta') toRemove.push(k);
            if (k === 'plonter_hindus_cs_meta') toRemove.push(k);
        }
        toRemove.forEach(function(k) { localStorage.removeItem(k); });
    }

    // Seed the built-in STAGES for a guest visitor. Separate from the
    // per-user flow: guests get editable *copies* (_isBuiltinSeed:true +
    // _createdAsGuest:true) that never hit the server — they're purely
    // local playground items. Runs once per browser via
    // plonter_stages_seeded_guest.
    function _seedBuiltinStagesForGuest() {
        try {
            var flag = 'plonter_stages_seeded_guest';
            if (localStorage.getItem(flag)) return;
            if (typeof STAGES === 'undefined') return;
            if (typeof getCustomStages !== 'function' || typeof saveCustomStages !== 'function') return;

            var customs = getCustomStages();
            var seen = {};
            customs.forEach(function(s) { if (s && s.id) seen[s.id] = true; });

            var added = 0;
            var now = new Date().toISOString();
            var buckets = ['workbook', 'midterm', 'hindus', 'persian'];
            buckets.forEach(function(bucket) {
                var arr = STAGES[bucket];
                if (!Array.isArray(arr)) return;
                arr.forEach(function(origStage, i) {
                    var newId = 'guestseed_' + bucket + '_' + (origStage.id || i);
                    if (seen[newId]) return;
                    var seedStage = Object.assign({}, origStage, {
                        id: newId,
                        isCustom: true,
                        _createdAsGuest: true,
                        _isBuiltinSeed: true,
                        created: now,
                        updated: now
                    });
                    customs.push(seedStage);
                    seen[newId] = true;
                    added++;
                });
            });

            if (added > 0) {
                saveCustomStages(customs);
                console.log('[auth] guest-seeded', added, 'built-in stages');
                try {
                    if (typeof Modals !== 'undefined' && typeof Modals.renderStages === 'function') Modals.renderStages();
                } catch (_) {}
            }
            localStorage.setItem(flag, '1');
        } catch (e) {
            console.warn('[auth] _seedBuiltinStagesForGuest failed', e);
        }
    }

    // On page load without a token, kick off the guest seed so the
    // examples show up right away and are editable.
    (function _guestSeedBootstrap() {
        var run = function() {
            if (typeof ContentSync === 'undefined') { setTimeout(run, 300); return; }
            if (ContentSync.isLoggedIn && ContentSync.isLoggedIn()) return;
            _seedBuiltinStagesForGuest();
            _restoreGuestSentenceBackupsToGuestStages();
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { setTimeout(run, 600); });
        } else {
            setTimeout(run, 600);
        }
    })();

    // Per-user seed of the built-in STAGES (workbook / hindus / persian /
    // etc.) into plonter_custom_stages so the user can edit/delete them as
    // if they created them. Runs once per user.id on this browser — tracked
    // via plonter_stages_seeded_<userId>.
    function _seedBuiltinStagesForUser(userId) {
        try {
            var flag = 'plonter_stages_seeded_' + userId;
            if (localStorage.getItem(flag)) return;
            if (typeof STAGES === 'undefined') return;
            if (typeof getCustomStages !== 'function' || typeof saveCustomStages !== 'function') return;

            var customs = getCustomStages();
            var seen = {};
            customs.forEach(function(s) { if (s && s.id) seen[s.id] = true; });

            var added = 0;
            var now = new Date().toISOString();
            var buckets = ['workbook', 'midterm', 'hindus', 'persian'];
            buckets.forEach(function(bucket) {
                var arr = STAGES[bucket];
                if (!Array.isArray(arr)) return;
                arr.forEach(function(origStage, i) {
                    var newId = 'seed_' + userId + '_' + bucket + '_' + (origStage.id || i);
                    if (seen[newId]) return;
                    var seedStage = Object.assign({}, origStage, {
                        id: newId,
                        isCustom: true,
                        // Flag so ContentSync's migration popup + sync
                        // queue skip these. Identical to built-in
                        // content that already ships in STAGES — no
                        // point asking the user to "back up" a copy
                        // the server already has baked into the app
                        // bundle. Once the user edits one, modals.js
                        // strips the flag and it becomes a regular
                        // user item that can push to server.
                        _isBuiltinSeed: true,
                        created: now,
                        updated: now
                    });
                    // Preserve category + isHindus + tags + answer from
                    // the original.
                    customs.push(seedStage);
                    seen[newId] = true;
                    added++;
                });
            });

            if (added > 0) {
                saveCustomStages(customs);
                console.log('[auth] seeded', added, 'built-in stages for user', userId);
                try {
                    if (typeof Modals !== 'undefined' && typeof Modals.renderStages === 'function') Modals.renderStages();
                } catch (_) {}
            }
            localStorage.setItem(flag, '1');
        } catch (e) {
            console.warn('[auth] _seedBuiltinStagesForUser failed', e);
        }
    }

    function _notifyAuthChange() {
        try {
            document.dispatchEvent(new CustomEvent('plonter:authchange', {
                detail: { loggedIn: !!_currentUser }
            }));
        } catch (_) {}
    }

    function _bindExternalAuthStorageListener() {
        if (_authStorageEventsBound || typeof window === 'undefined' || !window.addEventListener) return;
        // BUG #1353 fix (3): only the TOP window owns the cross-window auth-switch
        // reload. When this surface is the vocab.html IFRAME embedded inside
        // index.html, the parent AND the iframe both used to bind this listener
        // and BOTH reload + re-run onLogin's guest-prompt flow over the same
        // shared localStorage on every user switch — doubling popups and racing
        // pullAll writes. The parent's reload reloads the whole document (iframe
        // included), so the embedded iframe must not bind its own reload.
        try {
            if (window.top !== window.self) { _authStorageEventsBound = true; return; }
        } catch (_) { /* cross-origin top access blocked — treat as top, fall through */ }
        _authStorageEventsBound = true;
        // Record bind time as a fallback settle-window anchor (init() also sets
        // _initTs; whichever runs is fine — both mark "page just came up").
        if (!_initTs) _initTs = _now();
        window.addEventListener('storage', function(e) {
            if (!e || (e.key !== 'plonter_auth_token' && e.key !== 'plonter_auth_token_user')) return;
            var nextToken = '';
            try { nextToken = localStorage.getItem('plonter_auth_token') || ''; } catch (_) {}
            var currentToken = (_currentUser && _currentUser.token) || _lastAuthToken || '';
            if (nextToken === currentToken) return; // no real token change

            // --- BUG bd1 #1470 (Amitai @7l): the old handler reloaded whenever
            // the RAW token string changed. But on first load the shared token
            // gets canonicalized/refreshed for the SAME user (e.g. the vocab
            // iframe's auth init rewrites it), so the value differed even though
            // the identity was unchanged → it ejected a teacher who had just
            // opened the lesson editor / media warehouse. The combined fix below
            // reloads ONLY on a genuine user switch, never mid-edit, and never
            // during the first-load settle window. ---

            // (3) INIT-SETTLE WINDOW — swallow token churn right after init().
            // The first-load canonicalization fires here and must not reload.
            var nowMs = _now();
            if (_initTs && (nowMs - _initTs) < _INIT_SETTLE_MS) {
                _lastAuthToken = nextToken;
                if (_currentUser) _currentUser.token = nextToken;
                return;
            }

            // (1) IDENTITY-GATED RELOAD — compare the USER identity, not the raw
            // token. Identity = plonter_auth_token_user || plonter_data_owner.
            var nextIdentity = _identityFromStorage();
            var sameIdentity = (!nextIdentity && !_lastAuthIdentity) || (nextIdentity === _lastAuthIdentity);
            if (sameIdentity) {
                // Same user, token merely refreshed — keep the editor intact.
                _lastAuthToken = nextToken;
                if (_currentUser) _currentUser.token = nextToken;
                return;
            }

            // (2) EDIT-IN-PROGRESS GUARD — a genuine identity switch happened in
            // a sibling surface, but this user is mid-edit/upload. Defer rather
            // than destroy active work; reload once editing settles.
            if (_isEditInProgress()) {
                _pendingIdentityReload = true;
                _scheduleDeferredReload();
                return;
            }

            // Genuine user switch, nothing in progress: hydrate the new user.
            // AuthEmail validates/restores a session only during init, so the
            // in-memory PlonterAuth user is stale — reload this same-origin
            // surface so init() runs owner isolation and pulls the right data.
            // (4) SAFETY NET: no existing save/restore hook to call here cleanly
            // (the editor guard above already protects unsaved work), so we do
            // not invent a fragile context-restore system — noted in the report.
            _lastAuthToken = nextToken;
            _lastAuthIdentity = nextIdentity;
            try {
                window.location.reload();
            } catch (_) {}
        });
    }

    function _escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Public helper for inline login paths that bypass AuthEmail.doLogin —
    // e.g. lessons.js _showBackupLoginPrompt writes plonter_auth_token
    // directly and never goes through config.onLogin, so the data-owner
    // clear + guest-flag reset never fire. Callers pass the user object
    // the server returned and we replay the privacy-critical bits.
    function syncOwnerAndClear(user) {
        try {
            var newOwnerKey = user && (user.id || user.user_id || user.email);
            if (!newOwnerKey) return;
            var prevOwner = localStorage.getItem('plonter_data_owner');
            if (prevOwner && prevOwner !== String(newOwnerKey)) {
                _clearUserScopedContent();
            }
            localStorage.setItem('plonter_data_owner', String(newOwnerKey));
            _lastAuthToken = localStorage.getItem('plonter_auth_token') || '';
            _lastAuthIdentity = _identityFromStorage(); // BUG bd1 #1470 — keep baseline current
            _currentUser = { token: _lastAuthToken };
            if (user && typeof user === 'object') {
                _currentUser.name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim();
                _currentUser.email = user.email || '';
                _currentUser.phone = user.phone || '';
            }
            _renderLogoutButton();
            _notifyLogin();
            // Fire the same events host hooks listen for, so lists re-render.
            _notifyAuthChange();
        } catch (e) { console.warn('[auth] syncOwnerAndClear failed', e); }
    }

    return {
        init: init,
        isLoggedIn: isLoggedIn,
        getUser: getUser,
        getToken: getToken,
        onLogin: onLogin,
        showLoginDialog: showLoginDialog,
        logout: logout,
        syncOwnerAndClear: syncOwnerAndClear,
        // Test-only hook — lets a console snippet trigger the guest-backup
        // prompt without actually logging in. Plonter TODO #634.
        _promptGuestBackupOnLogin: _promptGuestBackupOnLogin,
        _promptGuestSentenceBackupOnLogin: _promptGuestSentenceBackupOnLogin,
        deleteGuestSentenceBackupForStage: _deleteGuestSentenceBackupForStage,
        // Test-only read-only introspection for the storage-handler QA
        // (BUG bd1 #1470). Returns a snapshot of the private reload-gate state;
        // never mutates anything. Safe to leave in production.
        _debugAuthState: function() {
            return {
                lastAuthToken: _lastAuthToken,
                lastAuthIdentity: _lastAuthIdentity,
                initTs: _initTs,
                settleMs: _INIT_SETTLE_MS,
                pendingIdentityReload: _pendingIdentityReload
            };
        }
    };

})();
