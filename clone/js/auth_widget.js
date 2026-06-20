/**
 * Email/Password Login Widget — Drop-in auth component for Plonter
 * Replaces WhatsApp OTP. Uses auth_email.php backend.
 */

var AuthEmail = (function() {
    var config = {};
    var container = null;
    var AUTH_API = '/plonter/api/auth_email.php';
    var STORAGE_KEY = 'plonter_auth_token';
    var _currentView = 'login'; // login, register, verify, forgot, reset
    var _offlineRevalidateBound = false; // one-shot 'online' re-validation guard

    function init(opts) {
        config = opts;
        container = document.querySelector(opts.container);
        if (!container) return;

        if (opts.apiUrl) AUTH_API = opts.apiUrl;

        // Check existing session
        var token = localStorage.getItem(STORAGE_KEY);
        if (token) {
            checkSession(token);
        } else {
            // No token — enter as guest (don't force login)
            if (config.onGuest) {
                config.onGuest();
            } else {
                showLogin();
            }
        }
    }

    function _api(action, data, cb) {
        data.action = action;
        fetch(AUTH_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
        .then(function(r) { return r.json(); })
        .then(cb)
        .catch(function() { cb({ ok: false, network_error: true, error: 'שגיאת תקשורת' }); });
    }

    function _html(html) {
        container.innerHTML = '<div class="auth-box">' + html + '</div>';
    }

    function _showError(msg) {
        var el = document.getElementById('auth-error');
        if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
    }

    function _showSuccess(msg) {
        var el = document.getElementById('auth-success');
        if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
    }

    function _showToast(msg) {
        var existing = document.querySelector('.auth-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'auth-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#0d9488;color:white;padding:8px 20px;border-radius:20px;font-size:0.9em;z-index:10001;direction:rtl;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 3000);
    }

    function _loginIdToEmail(loginId) {
        loginId = String(loginId || '').trim();
        if (!loginId || loginId.indexOf('@') >= 0) return loginId;
        return loginId.toLowerCase().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '').replace(/^[._-]+|[._-]+$/g, '') + '@plonter.local';
    }

    // --- Login Screen ---
    function showLogin() {
        _currentView = 'login';
        _html(
            '<h3 class="auth-title">' + (config.title || 'כניסה') + '</h3>' +
            '<div class="auth-field"><input type="text" id="auth-email" class="auth-input" placeholder="מייל או שם משתמש" dir="ltr" autocomplete="username"></div>' +
            '<div class="auth-field" style="position:relative"><input type="password" id="auth-pass" class="auth-input" placeholder="סיסמה" dir="ltr" autocomplete="current-password" style="padding-right:40px"><button type="button" id="auth-pass-toggle" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.2em;color:#999;padding:6px">👁</button></div>' +
            '<button id="auth-login-btn" class="auth-btn auth-btn-primary">היכנס</button>' +
            '<button id="auth-guest-btn" class="auth-btn" style="background:#f1f5f9;color:#64748b;border:1px solid #d1d5db">כניסה כאורח</button>' +
            '<div id="auth-error" class="auth-error"></div>' +
            '<div id="auth-success" class="auth-success"></div>' +
            '<div class="auth-links">' +
                '<a href="#" id="auth-forgot-link" class="auth-link">שכחת סיסמה?</a>' +
                '<span class="auth-link-sep">|</span>' +
                '<a href="#" id="auth-register-link" class="auth-link">אין לך חשבון? הירשם!</a>' +
            '</div>' +
            // ⚡ Quick-login — prominent styled BUTTON (Amitai 2026-06-17 via @6m:
            // "כפתור התחברות מהירה שיהיה יפה, לא קישור, עם אימוג׳י מהירות ⚡").
            // Replaces the old plain text link to the no-email fast path.
            '<button type="button" id="auth-quick-btn" class="auth-btn" style="margin-top:10px;background:linear-gradient(135deg,#0d9488,#0891b2);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:1.02em;box-shadow:0 4px 12px rgba(8,145,178,0.35);display:flex;align-items:center;justify-content:center;gap:8px;transition:transform .15s ease,box-shadow .15s ease" ' +
                'onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 16px rgba(8,145,178,0.45)\'" ' +
                'onmouseout="this.style.transform=\'\';this.style.boxShadow=\'0 4px 12px rgba(8,145,178,0.35)\'">' +
                '<span style="font-size:1.25em;line-height:1">⚡</span>' +
                '<span style="display:flex;flex-direction:column;align-items:center;line-height:1.2">' +
                    '<span>התחברות מהירה</span>' +
                    '<span style="font-size:0.72em;font-weight:500;opacity:0.92">שם וסיסמה — בלי מייל</span>' +
                '</span>' +
            '</button>'
        );

        document.getElementById('auth-login-btn').addEventListener('click', doLogin);
        document.getElementById('auth-guest-btn').addEventListener('click', doGuestLogin);
        document.getElementById('auth-quick-btn').addEventListener('click', function(e) { e.preventDefault(); showSimpleRegister(); });
        document.getElementById('auth-pass-toggle').addEventListener('click', function() {
            var inp = document.getElementById('auth-pass');
            if (inp.type === 'password') { inp.type = 'text'; this.textContent = '🙈'; }
            else { inp.type = 'password'; this.textContent = '👁'; }
        });
        document.getElementById('auth-forgot-link').addEventListener('click', function(e) { e.preventDefault(); showForgot(); });
        document.getElementById('auth-register-link').addEventListener('click', function(e) { e.preventDefault(); showRegister(); });

        // Attention-grabber for the register link — Amitai 2026-04-19 08:27
        // wanted a pulsing animation after 2 seconds of showing the login
        // view so a new user notices they can sign up, not only log in.
        (function _pulseRegisterLink() {
            var linkEl = document.getElementById('auth-register-link');
            if (!linkEl) return;
            // Inject keyframes once.
            if (!document.getElementById('auth-register-pulse-style')) {
                var s = document.createElement('style');
                s.id = 'auth-register-pulse-style';
                s.textContent =
                    '@keyframes auth-register-pulse { ' +
                        '0% { transform: scale(1); color: inherit; } ' +
                        '50% { transform: scale(1.15); color: #0d9488; } ' +
                        '100% { transform: scale(1); color: inherit; } ' +
                    '} ' +
                    '.auth-register-pulse { ' +
                        'animation: auth-register-pulse 0.7s ease-in-out 3; ' +
                        'display: inline-block; ' +
                        'transform-origin: center; ' +
                        'font-weight: 700; ' +
                    '}';
                document.head.appendChild(s);
            }
            setTimeout(function() {
                // Make sure the link is still mounted — user might have
                // clicked away to register/forgot before the 2s elapsed.
                var still = document.getElementById('auth-register-link');
                if (!still) return;
                still.classList.add('auth-register-pulse');
                // Clear the class after the 3 iterations (0.7s × 3 + buffer).
                setTimeout(function() { still.classList.remove('auth-register-pulse'); }, 2300);
            }, 2000);
        })();

        // Enter key: email → password, password → submit
        document.getElementById('auth-email').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); document.getElementById('auth-pass').focus(); }
        });
        document.getElementById('auth-pass').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
        });
    }

    function doGuestLogin() {
        // Guest login — skip auth, just show the app with local storage only
        if (config.onGuest) {
            config.onGuest();
        } else if (config.onLogin) {
            config.onLogin('guest', { first_name: 'אורח', last_name: '', email: '', phone: '' });
        }
    }

    // --- Simple (username-only) registration — no email, no verification ---
    // Amitai 2026-06-17: "give an option to log in without email, just username
    // and password." Forces a synthetic <username>@plonter.local id so the
    // backend creates a verified account and returns a token directly.
    function showSimpleRegister() {
        _currentView = 'simple_register';
        _html(
            '<h3 class="auth-title">הרשמה מהירה</h3>' +
            '<p class="auth-subtitle">בלי מייל — רק שם משתמש וסיסמה</p>' +
            '<div class="auth-field"><input type="text" id="auth-uname" class="auth-input" placeholder="שם משתמש" autocomplete="username"></div>' +
            '<div class="auth-field" style="position:relative"><input type="password" id="auth-pass" class="auth-input" placeholder="סיסמה" dir="ltr" autocomplete="new-password" style="padding-right:40px"><button type="button" id="auth-pass-toggle" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.2em;color:#999;padding:6px">👁</button></div>' +
            '<button id="auth-simple-btn" class="auth-btn auth-btn-primary">הירשם והיכנס</button>' +
            '<div id="auth-error" class="auth-error"></div>' +
            '<div class="auth-links">' +
                '<a href="#" id="auth-back-login" class="auth-link">חזור לכניסה</a>' +
            '</div>'
        );

        document.getElementById('auth-simple-btn').addEventListener('click', doSimpleRegister);
        document.getElementById('auth-back-login').addEventListener('click', function(e) { e.preventDefault(); showLogin(); });
        document.getElementById('auth-pass-toggle').addEventListener('click', function() {
            var inp = document.getElementById('auth-pass');
            if (inp.type === 'password') { inp.type = 'text'; this.textContent = '🙈'; }
            else { inp.type = 'password'; this.textContent = '👁'; }
        });
        document.getElementById('auth-uname').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); document.getElementById('auth-pass').focus(); }
        });
        document.getElementById('auth-pass').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doSimpleRegister(); }
        });
    }

    function doSimpleRegister() {
        var uname = document.getElementById('auth-uname').value.trim();
        var pass = document.getElementById('auth-pass').value;
        if (!uname) { _showError('מלא שם משתמש'); return; }
        if (pass.length < 4) { _showError('סיסמה חייבת להכיל לפחות 4 תווים'); return; }
        // Force a local (no-email) id: strip any '@' so it can never become a
        // real-email account that would then require verification.
        var localEmail = _loginIdToEmail(uname.replace(/@/g, '_'));

        var btn = document.getElementById('auth-simple-btn');
        btn.disabled = true; btn.textContent = '...';

        _api('register', { first_name: uname, last_name: '', email: localEmail, password: pass, phone: '' }, function(data) {
            if (data.ok && data.token) {
                localStorage.setItem(STORAGE_KEY, data.token);
                localStorage.setItem(STORAGE_KEY + '_user', JSON.stringify(data.user));
                if (config.onLogin) config.onLogin(data.token, data.user);
            } else {
                btn.disabled = false; btn.textContent = 'הירשם והיכנס';
                _showError(data.error || 'ההרשמה נכשלה');
            }
        });
    }

    function doLogin() {
        var typed = document.getElementById('auth-email').value.trim();
        var pass = document.getElementById('auth-pass').value;
        if (!typed || !pass) { _showError('מלא מייל/שם משתמש וסיסמה'); return; }
        var primary = _loginIdToEmail(typed);
        // Quick-login fallback: a username that contains '@' (e.g. someone using an
        // email address AS their quick username) is short-circuited by _loginIdToEmail
        // and looked up as a real email. But doSimpleRegister stored it as the
        // @plonter.local form (it strips '@'→'_' first). So if the real-email lookup
        // finds no account, retry once with that exact quick-login normalization.
        var fallback = (typed.indexOf('@') >= 0) ? _loginIdToEmail(typed.replace(/@/g, '_')) : null;
        if (fallback === primary) fallback = null;

        var btn = document.getElementById('auth-login-btn');
        btn.disabled = true; btn.textContent = '...';

        function onResult(data) {
            if (data.ok) {
                localStorage.setItem(STORAGE_KEY, data.token);
                localStorage.setItem(STORAGE_KEY + '_user', JSON.stringify(data.user));
                if (config.onLogin) config.onLogin(data.token, data.user);
                return;
            }
            // Account not found as a real email → retry once with the quick-login id.
            if (fallback && data.error === 'משתמש לא נמצא') {
                var fb = fallback; fallback = null;
                _api('login', { email: fb, password: pass }, onResult);
                return;
            }
            btn.disabled = false; btn.textContent = 'היכנס';
            if (data.need_verify) {
                showVerify(data.email);
            } else {
                _showError(data.error);
            }
        }

        _api('login', { email: primary, password: pass }, onResult);
    }

    // --- Register Screen ---
    function showRegister() {
        _currentView = 'register';
        _html(
            '<h3 class="auth-title">הרשמה לפלונטר</h3>' +
            '<div class="auth-field"><input type="text" id="auth-fname" class="auth-input" placeholder="שם פרטי" autocomplete="given-name"></div>' +
            '<div class="auth-field"><input type="text" id="auth-lname" class="auth-input" placeholder="שם משפחה" autocomplete="family-name"></div>' +
            '<div class="auth-field"><input type="email" id="auth-email" class="auth-input" placeholder="מייל" dir="ltr" autocomplete="email"></div>' +
            '<div class="auth-field" style="position:relative"><input type="password" id="auth-pass" class="auth-input" placeholder="סיסמה" dir="ltr" autocomplete="new-password" style="padding-right:40px"><button type="button" id="auth-pass-toggle" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.2em;color:#999;padding:6px">👁</button></div>' +
            '<button id="auth-register-btn" class="auth-btn auth-btn-primary">הירשם</button>' +
            '<div id="auth-error" class="auth-error"></div>' +
            '<div class="auth-links">' +
                '<a href="#" id="auth-back-login" class="auth-link">יש לך חשבון? היכנס</a>' +
            '</div>'
        );

        document.getElementById('auth-register-btn').addEventListener('click', doRegister);
        document.getElementById('auth-back-login').addEventListener('click', function(e) { e.preventDefault(); showLogin(); });
        document.getElementById('auth-pass-toggle').addEventListener('click', function() {
            var inp = document.getElementById('auth-pass');
            if (inp.type === 'password') { inp.type = 'text'; this.textContent = '🙈'; }
            else { inp.type = 'password'; this.textContent = '👁'; }
        });

        // Enter key moves to next field, last field submits
        var fields = ['auth-fname', 'auth-lname', 'auth-email', 'auth-pass'];
        fields.forEach(function(id, idx) {
            document.getElementById(id).addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (idx < fields.length - 1) {
                        document.getElementById(fields[idx + 1]).focus();
                    } else {
                        doRegister();
                    }
                }
            });
        });
    }

    function doRegister() {
        var fname = document.getElementById('auth-fname').value.trim();
        var lname = document.getElementById('auth-lname').value.trim();
        var email = document.getElementById('auth-email').value.trim();
        var pass = document.getElementById('auth-pass').value;

        if (!fname || !lname) { _showError('שם פרטי ושם משפחה חובה'); return; }
        if (!email) { _showError('מייל חובה'); return; }
        if (pass.length < 4) { _showError('סיסמה חייבת להכיל לפחות 4 תווים'); return; }

        var btn = document.getElementById('auth-register-btn');
        btn.disabled = true; btn.textContent = '...';

        _api('register', {
            first_name: fname, last_name: lname,
            email: email, password: pass, phone: ''
        }, function(data) {
            if (data.ok) {
                showVerify(email);
            } else {
                btn.disabled = false; btn.textContent = 'הירשם';
                _showError(data.error);
            }
        });
    }

    // --- Verify Email Screen ---
    function showVerify(email) {
        _currentView = 'verify';
        _html(
            '<h3 class="auth-title">אימות מייל</h3>' +
            '<p class="auth-subtitle">שלחנו קוד אימות ל-<strong dir="ltr">' + _escapeHtml(email) + '</strong></p>' +
            '<div class="auth-code-inputs" id="auth-code-group"></div>' +
            '<button id="auth-verify-btn" class="auth-btn auth-btn-primary">אמת</button>' +
            '<div id="auth-error" class="auth-error"></div>' +
            '<div class="auth-links">' +
                '<a href="#" id="auth-resend" class="auth-link">שלח קוד חדש</a>' +
                '<span class="auth-link-sep">|</span>' +
                '<a href="#" id="auth-back-login" class="auth-link">חזור לכניסה</a>' +
            '</div>' +
            '<div style="margin-top:16px;text-align:center">' +
                '<a href="#" id="auth-no-email" class="auth-link" style="color:#25D366;font-size:0.95em;font-weight:bold">💬 לא נשלח מייל? דברו איתנו!</a>' +
            '</div>'
        );

        _createCodeInputs('auth-code-group', function() { doVerify(email); });
        document.getElementById('auth-verify-btn').addEventListener('click', function() { doVerify(email); });
        document.getElementById('auth-resend').addEventListener('click', function(e) {
            e.preventDefault();
            _api('resend_code', { email: email, type: 'verify' }, function(d) {
                if (d.ok) {
                    _showError('');
                    _showToast('נשלח קוד חדש');
                }
            });
        });
        document.getElementById('auth-back-login').addEventListener('click', function(e) { e.preventDefault(); showLogin(); });
        document.getElementById('auth-no-email').addEventListener('click', function(e) {
            e.preventDefault();
            if (_openDragonSupport()) return;
            var userData = JSON.parse(localStorage.getItem(STORAGE_KEY + '_user') || '{}');
            var name = (userData.first_name || '') + ' ' + (userData.last_name || '');
            name = name.trim() || 'משתמש';
            var waMsg = encodeURIComponent('היי, קוראים לי ' + name + ' פלונטר לא שולח לי הודעה למייל (' + email + '), תוכלו לעזור לי להיכנס?');
            window.open('https://wa.me/972587244481?text=' + waMsg, '_blank');
        });
    }

    function _openDragonSupport() {
        var isDragon = !!(typeof PlonterAdmin !== 'undefined' && PlonterAdmin.isDragon && PlonterAdmin.isDragon());
        if (!isDragon) return false;
        var context = window.__plonterLastWelcomeTab || 'manager';
        var url = 'https://t.me/Plonter_6_manager_bot';
        if (typeof PlonterTasksPanel !== 'undefined' && PlonterTasksPanel.telegramForContext) {
            url = PlonterTasksPanel.telegramForContext(context);
        } else if (context === 'lessons') {
            url = 'https://t.me/Plonter_7_lessons_bot';
        } else if (context === 'analysis' || context === 'hindus') {
            url = 'https://t.me/Plonter_4_tahbir_bot';
        } else if (context === 'texts') {
            url = 'https://t.me/Plonter_5_texts_bot';
        } else if (context === 'vocab' || context === 'dictionary') {
            url = 'https://t.me/Plonter_8_milon_bot';
        }
        window.open(url, '_blank');
        return true;
    }

    function doVerify(email) {
        var code = _getCode();
        if (code.length !== 6) { _showError('הכנס 6 ספרות'); return; }

        var btn = document.getElementById('auth-verify-btn');
        btn.disabled = true; btn.textContent = '...';

        _api('verify_email', { email: email, code: code }, function(data) {
            if (data.ok) {
                localStorage.setItem(STORAGE_KEY, data.token);
                localStorage.setItem(STORAGE_KEY + '_user', JSON.stringify(data.user));
                if (config.onLogin) config.onLogin(data.token, data.user);
            } else {
                btn.disabled = false; btn.textContent = 'אמת';
                _showError(data.error);
            }
        });
    }

    // --- Forgot Password Screen ---
    function showForgot() {
        _currentView = 'forgot';
        _html(
            '<h3 class="auth-title">שכחת סיסמה?</h3>' +
            '<p class="auth-subtitle">הכנס את המייל שלך ונשלח לך קוד איפוס</p>' +
            '<div class="auth-field"><input type="email" id="auth-email" class="auth-input" placeholder="מייל" dir="ltr" autocomplete="email"></div>' +
            '<button id="auth-forgot-btn" class="auth-btn auth-btn-primary">שלח קוד איפוס</button>' +
            '<div id="auth-error" class="auth-error"></div>' +
            '<div id="auth-success" class="auth-success"></div>' +
            '<div class="auth-links">' +
                '<a href="#" id="auth-back-login" class="auth-link">חזור לכניסה</a>' +
            '</div>'
        );

        document.getElementById('auth-forgot-btn').addEventListener('click', function() {
            var email = document.getElementById('auth-email').value.trim();
            if (!email) { _showError('הכנס מייל'); return; }

            var btn = document.getElementById('auth-forgot-btn');
            btn.disabled = true; btn.textContent = '...';

            _api('forgot_password', { email: email }, function(data) {
                btn.disabled = false; btn.textContent = 'שלח קוד איפוס';
                if (data.ok) {
                    showReset(email);
                } else {
                    _showError(data.error);
                }
            });
        });
        document.getElementById('auth-back-login').addEventListener('click', function(e) { e.preventDefault(); showLogin(); });
    }

    // --- Reset Password Screen ---
    function showReset(email) {
        _currentView = 'reset';
        _html(
            '<h3 class="auth-title">איפוס סיסמה</h3>' +
            '<p class="auth-subtitle">הכנס את הקוד שקיבלת במייל והסיסמה החדשה</p>' +
            '<div class="auth-code-inputs" id="auth-code-group"></div>' +
            '<div class="auth-field"><input type="password" id="auth-newpass" class="auth-input" placeholder="סיסמה חדשה" dir="ltr" autocomplete="new-password"></div>' +
            '<button id="auth-reset-btn" class="auth-btn auth-btn-primary">שנה סיסמה</button>' +
            '<div id="auth-error" class="auth-error"></div>' +
            '<div class="auth-links">' +
                '<a href="#" id="auth-back-login" class="auth-link">חזור לכניסה</a>' +
            '</div>'
        );

        _createCodeInputs('auth-code-group');
        document.getElementById('auth-reset-btn').addEventListener('click', function() {
            var code = _getCode();
            var newpass = document.getElementById('auth-newpass').value;
            if (code.length !== 6) { _showError('הכנס 6 ספרות'); return; }
            if (newpass.length < 4) { _showError('סיסמה חייבת להכיל לפחות 4 תווים'); return; }

            var btn = document.getElementById('auth-reset-btn');
            btn.disabled = true; btn.textContent = '...';

            _api('reset_password', { email: email, code: code, new_password: newpass }, function(data) {
                if (data.ok) {
                    showLogin();
                    // Show success message after render
                    setTimeout(function() { _showSuccess('הסיסמה שונתה! כעת ניתן להיכנס.'); }, 100);
                } else {
                    btn.disabled = false; btn.textContent = 'שנה סיסמה';
                    _showError(data.error);
                }
            });
        });
        document.getElementById('auth-back-login').addEventListener('click', function(e) { e.preventDefault(); showLogin(); });
    }

    // --- Code Input Helpers ---
    function _createCodeInputs(containerId, onComplete) {
        var group = document.getElementById(containerId);
        for (var i = 0; i < 6; i++) {
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.inputMode = 'numeric';
            inp.maxLength = 1;
            inp.className = 'auth-code-digit';
            inp.dataset.index = i;
            group.appendChild(inp);
        }
        var digits = group.querySelectorAll('.auth-code-digit');
        digits.forEach(function(digit, idx) {
            digit.addEventListener('input', function() {
                if (this.value && idx < 5) digits[idx + 1].focus();
                if (onComplete && _getCode().length === 6) onComplete();
            });
            digit.addEventListener('keydown', function(e) {
                if (e.key === 'Backspace' && !this.value && idx > 0) digits[idx - 1].focus();
            });
            digit.addEventListener('paste', function(e) {
                e.preventDefault();
                var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
                for (var j = 0; j < Math.min(text.length, 6); j++) digits[j].value = text[j];
                if (onComplete && text.length >= 6) onComplete();
                else if (text.length > 0) digits[Math.min(text.length, 5)].focus();
            });
        });
    }

    function _getCode() {
        var digits = document.querySelectorAll('.auth-code-digit');
        var code = '';
        digits.forEach(function(d) { code += d.value; });
        return code;
    }

    // --- Session ---
    function checkSession(token) {
        _api('check_session', { token: token }, function(data) {
            if (data.ok) {
                localStorage.setItem(STORAGE_KEY + '_user', JSON.stringify(data.user));
                if (config.onLogin) config.onLogin(token, data.user);
            } else if (data.network_error || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
                // Comms/offline error — NOT a token rejection. Keep the
                // session alive from the cached user so a logged-in user who
                // opens the app offline stays logged in (owns their own data,
                // edits sync when back online). Dropping to guest here used to
                // delete the token, flip the vocab owner user→guest (wiping
                // the user's local categories), and make offline-created
                // categories resurface as a "guest backup" migration prompt.
                var cachedUser = null;
                try { cachedUser = JSON.parse(localStorage.getItem(STORAGE_KEY + '_user') || 'null'); } catch (_) {}
                if (cachedUser) {
                    if (config.onLogin) config.onLogin(token, cachedUser);
                    // Re-validate once connectivity returns.
                    if (!_offlineRevalidateBound && typeof window !== 'undefined' && window.addEventListener) {
                        _offlineRevalidateBound = true;
                        window.addEventListener('online', function onBackOnline() {
                            window.removeEventListener('online', onBackOnline);
                            _offlineRevalidateBound = false;
                            var t = localStorage.getItem(STORAGE_KEY);
                            if (t) checkSession(t);
                        });
                    }
                } else if (config.onGuest) {
                    // No cached user to restore — fall through to guest, but
                    // keep the token so a later online check can validate it.
                    config.onGuest();
                } else {
                    showLogin();
                }
            } else {
                // Genuine stale/invalid token (server reachable, rejected it)
                // — drop it and fall through to guest so the host app can
                // re-render the "התחבר" button via onGuest.
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(STORAGE_KEY + '_user');
                if (config.onGuest) config.onGuest();
                else showLogin();
            }
        });
    }

    function logout() {
        var token = localStorage.getItem(STORAGE_KEY);
        if (token) {
            _api('logout', { token: token }, function() {});
        }
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_user');
        if (config.onLogout) config.onLogout();
        showLogin();
    }

    function getToken() {
        return localStorage.getItem(STORAGE_KEY);
    }

    function getUser() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY + '_user')); }
        catch(e) { return null; }
    }

    function _escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Inline CSS ---
    var style = document.createElement('style');
    style.textContent =
        '.auth-box { max-width: 380px; margin: 40px auto; padding: 32px 24px; background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); text-align: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; direction: rtl; }' +
        '.auth-title { margin: 0 0 16px; font-size: 22px; color: #0d9488; }' +
        '.auth-subtitle { margin: 0 0 16px; font-size: 14px; color: #666; line-height: 1.5; }' +
        '.auth-field { margin-bottom: 12px; }' +
        '.auth-input { width: 100%; padding: 12px 16px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 16px; outline: none; transition: border-color 0.2s; box-sizing: border-box; }' +
        '.auth-input:focus { border-color: #0d9488; }' +
        '.auth-btn { width: 100%; padding: 12px; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; margin-bottom: 8px; }' +
        '.auth-btn-primary { background: #0d9488; color: #fff; }' +
        '.auth-btn-primary:hover { background: #0f766e; }' +
        '.auth-btn:disabled { background: #ccc; cursor: default; }' +
        '.auth-error { margin-top: 8px; color: #e53935; font-size: 14px; display: none; }' +
        '.auth-success { margin-top: 8px; color: #0d9488; font-size: 14px; display: none; }' +
        '.auth-links { margin-top: 16px; font-size: 14px; }' +
        '.auth-link { color: #0891b2; text-decoration: none; cursor: pointer; }' +
        '.auth-link:hover { text-decoration: underline; }' +
        '.auth-link-sep { margin: 0 8px; color: #d1d5db; }' +
        '.auth-code-inputs { display: flex; gap: 8px; justify-content: center; direction: ltr; margin-bottom: 12px; }' +
        '.auth-code-digit { width: 44px; height: 52px; text-align: center; font-size: 22px; font-weight: 700; border: 2px solid #e0e0e0; border-radius: 10px; outline: none; transition: border-color 0.2s; }' +
        '.auth-code-digit:focus { border-color: #0d9488; }';
    document.head.appendChild(style);

    return {
        init: init,
        logout: logout,
        getToken: getToken,
        getUser: getUser,
        showLogin: showLogin,
        showRegister: showRegister,
        showSimpleRegister: showSimpleRegister
    };
})();
