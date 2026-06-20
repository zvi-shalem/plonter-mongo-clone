/*
 * contentShare.js — ONE generic sharing module for EVERY content type
 * (lessons, analysis/syntax, engineering/hindus, texts, vocab categories).
 *
 * Core principle (Amitai, non-negotiable): all content is an opaque black box —
 * this module only ever uses { contentId, contentType, title }. There is NO
 * per-type branching here. The same call shares a vocab category, a lesson, a
 * text, anything:
 *
 *     ContentShare.openShareDialog({ contentId: 159, contentType: 'vocab_category', title: '...' });
 *     el.appendChild(ContentShare.button({ contentId, contentType, title }));
 *
 * Backend: /plonter/api/content_share_api.php
 *   create_share / list_shares / revoke_share / resolve_link / shared_with_me.
 * Recipient opens share.html?t=<token> (open resolve_link) -> routed into the app.
 *
 * Self-contained: own toast + dialog DOM, so behaviour is identical on every host
 * page (index.html and vocab.html) regardless of their local helpers.
 */
window.ContentShare = (function () {
    var API = '/plonter/api/content_share_api.php';
    var CONTENT_API = '/plonter/api/content_api.php';

    function _token() { return localStorage.getItem('plonter_auth_token') || ''; }
    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

    function _toast(msg) {
        var t = document.getElementById('_cs-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = '_cs-toast';
            t.setAttribute('dir', 'rtl');
            t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100070;background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-family:inherit;font-size:0.95em;box-shadow:0 6px 20px rgba(0,0,0,0.3);opacity:0;transition:opacity .2s;max-width:90vw;text-align:center';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(t._h);
        t._h = setTimeout(function () { t.style.opacity = '0'; }, 2400);
    }

    function shareUrl(token) {
        return location.origin + location.pathname.replace(/[^/]+$/, '') + 'share.html?t=' + encodeURIComponent(token);
    }

    // Generic create — role: 'view' | 'edit'. target is an open link by default.
    function createShare(contentId, contentType, role) {
        var token = _token();
        if (!contentId) { _toast('הפריט לא נשמר עדיין — אי אפשר לשתף'); return Promise.resolve(null); }
        if (!token) { _toast('צריך להתחבר כדי לשתף'); return Promise.resolve(null); }
        return fetch(API + '?action=create_share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ content_id: contentId, content_type: contentType, target_type: 'link', role: (role === 'edit' ? 'edit' : 'view') })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d || !d.success) { _toast('שיתוף נכשל: ' + ((d && d.error) || 'שגיאה')); return null; }
            return d.token;
        }).catch(function () { _toast('שגיאת תקשורת בשיתוף'); return null; });
    }

    // Email-bound invite — role: 'view' | 'edit'. The recipient must log in with
    // THIS email to access the item (backend resolve_link enforces the match).
    function createEmailShare(contentId, contentType, role, email) {
        var token = _token();
        if (!contentId) { _toast('הפריט לא נשמר עדיין — אי אפשר לשתף'); return Promise.resolve(null); }
        if (!token) { _toast('צריך להתחבר כדי לשתף'); return Promise.resolve(null); }
        return fetch(API + '?action=create_share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ content_id: contentId, content_type: contentType, target_type: 'email', target_id: email, role: (role === 'edit' ? 'edit' : 'view') })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d || !d.success) { _toast('שליחת ההזמנה נכשלה: ' + ((d && d.error) || 'שגיאה')); return null; }
            return d.token;
        }).catch(function () { _toast('שגיאת תקשורת בשיתוף'); return null; });
    }

    function _validEmail(s) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
    }

    // Read-only check: does a Plonter account exist for this email? Returns a
    // Promise<boolean|null> — null on error/not-logged-in (caller treats null as
    // "unknown", i.e. no warning, never blocks the send). No PII is returned.
    function emailHasAccount(email) {
        var token = _token();
        if (!token || !_validEmail(email)) return Promise.resolve(null);
        return fetch(API + '?action=email_has_account&email=' + encodeURIComponent(email), {
            method: 'GET', headers: { 'Authorization': 'Bearer ' + token }
        }).then(function (r) { return r.json(); }).then(function (d) {
            return (d && d.success) ? !!d.has_account : null;
        }).catch(function () { return null; });
    }

    // Items shared WITH the caller (target_type='user' OR 'email', per the
    // backend shared_with_me). Pass a contentType to filter to one kind;
    // no argument = all (backward compatible).
    function sharedWithMe(contentType) {
        var token = _token();
        if (!token) return Promise.resolve([]);
        return fetch(API + '?action=shared_with_me', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: '{}'
        }).then(function (r) { return r.json(); }).then(function (d) {
            var items = (d && d.success && d.items) ? d.items : [];
            if (contentType) items = items.filter(function (it) { return it.content_type === contentType; });
            return items;
        }).catch(function () { return []; });
    }

    // Fetch a single content item by id via content_api (auth-gated). For a
    // shared_with_me item the backend authorises the read by the caller's
    // user-id / email identity — so no share token is needed. Returns the item
    // ({id, content_type, title, data, ...}) or null.
    function fetchContentById(contentId) {
        var token = _token();
        if (!token || !contentId) return Promise.resolve(null);
        return fetch(CONTENT_API + '?action=get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ id: contentId })
        }).then(function (r) { return r.json(); }).then(function (d) {
            return (d && d.success && d.item) ? d.item : null;
        }).catch(function () { return null; });
    }

    // Per-type "open this shared item" handlers. A host registers how its
    // content type opens (e.g. lessons imports a read-copy and opens the viewer).
    var _openers = {};
    function registerOpener(contentType, fn) { if (contentType && typeof fn === 'function') _openers[contentType] = fn; }

    function _removeDialog() {
        var ov = document.getElementById('_cs-share-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    // The IDENTICAL dialog for any content. Pick role (צפייה/עריכה) -> create link.
    function openShareDialog(opts) {
        opts = opts || {};
        var contentId = opts.contentId, contentType = opts.contentType || '', title = opts.title || '';
        _removeDialog();
        var ov = document.createElement('div');
        ov.id = '_cs-share-overlay';
        ov.setAttribute('dir', 'rtl');
        ov.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px';
        var card = document.createElement('div');
        card.style.cssText = 'background:#fff;border-radius:16px;max-width:440px;width:100%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,0.3);font-family:inherit;text-align:right';
        card.innerHTML =
            '<h3 style="margin:0 0 4px;color:#0d9488;font-size:1.2em">🔗 שיתוף</h3>' +
            '<p style="margin:0 0 14px;color:#475569;font-size:0.95em">' + _esc(title) + '</p>' +
            '<div style="display:flex;gap:8px;margin-bottom:14px">' +
              '<button id="_cs-role-view" class="_cs-role" data-role="view" style="flex:1;padding:11px;border:2px solid #0d9488;border-radius:10px;background:#0d9488;color:#fff;font-weight:bold;cursor:pointer">👁 צפייה</button>' +
              '<button id="_cs-role-edit" class="_cs-role" data-role="edit" style="flex:1;padding:11px;border:2px solid #0d9488;border-radius:10px;background:#fff;color:#0d9488;font-weight:bold;cursor:pointer">✏️ עריכה משותפת</button>' +
            '</div>' +
            '<p id="_cs-role-hint" style="margin:0 0 12px;color:#64748b;font-size:0.85em">מי שיקבל את הקישור יוכל <b>לצפות</b> בתוכן (בלי חשבון).</p>' +
            '<button id="_cs-create" style="width:100%;padding:12px;border:0;border-radius:10px;background:#0d9488;color:#fff;font-weight:bold;font-size:1em;cursor:pointer">צור קישור שיתוף</button>' +
            '<div id="_cs-result" style="display:none;margin-top:14px">' +
              '<input id="_cs-url" type="text" readonly style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #0d9488;border-radius:9px;direction:ltr;font-size:0.9em;color:#0f172a;background:#f8fafc">' +
              '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
                '<button id="_cs-wa" style="flex:1;min-width:120px;padding:11px;border:0;border-radius:10px;background:#25D366;color:#fff;font-weight:bold;cursor:pointer">📱 שלח בוואטסאפ</button>' +
                '<button id="_cs-share" style="flex:1;min-width:90px;padding:11px;border:0;border-radius:10px;background:#0891b2;color:#fff;font-weight:bold;cursor:pointer">↗️ שתף</button>' +
                '<button id="_cs-copy" style="flex:1;min-width:90px;padding:11px;border:0;border-radius:10px;background:#0d9488;color:#fff;font-weight:bold;cursor:pointer">📋 העתק</button>' +
              '</div>' +
            '</div>' +
            // --- Email invite section (additive 2026-06-06) — shares the same dialog. ---
            '<div style="border-top:1px solid #e2e8f0;margin:16px 0 4px;padding-top:14px">' +
              '<div style="font-weight:bold;color:#0d9488;font-size:0.98em;margin-bottom:8px">📧 הזמנה במייל</div>' +
              '<p style="margin:0 0 8px;color:#64748b;font-size:0.84em">המוזמן ייכנס עם כתובת המייל הזו כדי לגשת לתוכן.</p>' +
              '<input id="_cs-email" type="email" placeholder="כתובת אימייל" dir="ltr" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #cbd5e1;border-radius:9px;font-size:0.92em;margin-bottom:8px">' +
              '<div id="_cs-noacct" style="display:none;margin:0 0 10px;padding:8px 10px;background:#fffbeb;border:1px solid #fcd34d;border-radius:9px;color:#92400e;font-size:0.83em">ℹ️ לנמען אין עדיין חשבון פלונטר — המייל שיישלח כולל גם הוראות הרשמה.</div>' +
              '<div style="display:flex;gap:8px;margin-bottom:10px">' +
                '<button id="_cs-erole-view" data-erole="view" style="flex:1;padding:9px;border:2px solid #0d9488;border-radius:10px;background:#0d9488;color:#fff;font-weight:bold;cursor:pointer">👁 צפייה</button>' +
                '<button id="_cs-erole-edit" data-erole="edit" style="flex:1;padding:9px;border:2px solid #0d9488;border-radius:10px;background:#fff;color:#0d9488;font-weight:bold;cursor:pointer">✏️ עריכה</button>' +
              '</div>' +
              '<button id="_cs-invite" style="width:100%;padding:11px;border:0;border-radius:10px;background:#0891b2;color:#fff;font-weight:bold;font-size:0.98em;cursor:pointer">שלח הזמנה</button>' +
              '<div id="_cs-invite-result" style="display:none;margin-top:10px">' +
                '<input id="_cs-invite-url" type="text" readonly style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #0891b2;border-radius:9px;direction:ltr;font-size:0.88em;color:#0f172a;background:#f0f9ff">' +
                '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
                  '<button id="_cs-invite-wa" style="flex:1;min-width:110px;padding:10px;border:0;border-radius:10px;background:#25D366;color:#fff;font-weight:bold;cursor:pointer">📱 וואטסאפ</button>' +
                  '<button id="_cs-invite-share" style="flex:1;min-width:80px;padding:10px;border:0;border-radius:10px;background:#0e7490;color:#fff;font-weight:bold;cursor:pointer">↗️ שתף</button>' +
                  '<button id="_cs-invite-copy" style="flex:1;min-width:80px;padding:10px;border:0;border-radius:10px;background:#0891b2;color:#fff;font-weight:bold;cursor:pointer">📋 העתק</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<button id="_cs-close" style="margin-top:12px;width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569;cursor:pointer">סגור</button>';
        ov.appendChild(card);
        document.body.appendChild(ov);

        // --- WhatsApp + generic (Web Share API) send for any generated link ---
        function _shareMsg(url) {
            var t = (title || '').trim();
            return (t ? ('פלונטר — «' + t + '»\n') : 'שיתוף מפלונטר\n') + url;
        }
        function _waOpen(url) {
            try { window.open('https://wa.me/?text=' + encodeURIComponent(_shareMsg(url)), '_blank'); }
            catch (e) { _toast('📋 ' + url); }
        }
        function _nativeShare(url) {
            if (navigator.share) {
                navigator.share({ title: 'פלונטר' + (title ? (' — ' + title) : ''), text: _shareMsg(url), url: url })
                    .catch(function () {});
            } else {
                // No Web Share API (most desktop browsers) — fall back to copying the link.
                var ok = function () { _toast('🔗 הקישור הועתק'); };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok).catch(function () { _toast('📋 ' + url); });
                else _toast('📋 ' + url);
            }
        }
        function _wireSend(waId, shareId, url) {
            var w = card.querySelector('#' + waId); if (w) w.onclick = function () { _waOpen(url); };
            var s = card.querySelector('#' + shareId); if (s) s.onclick = function () { _nativeShare(url); };
        }

        var role = 'view';
        function setRole(r) {
            role = r;
            var v = card.querySelector('#_cs-role-view'), e = card.querySelector('#_cs-role-edit');
            var on = 'background:#0d9488;color:#fff', off = 'background:#fff;color:#0d9488';
            v.style.cssText = v.style.cssText.replace(/background:[^;]+;color:[^;]+/, r === 'view' ? on : off);
            e.style.cssText = e.style.cssText.replace(/background:[^;]+;color:[^;]+/, r === 'edit' ? on : off);
            card.querySelector('#_cs-role-hint').innerHTML = (r === 'edit')
                ? 'מי שיקבל את הקישור יוכל <b>להוסיף, לערוך ולמחוק</b> בתוך התוכן — עריכה משותפת. שניכם רואים את אותם נתונים.'
                : 'מי שיקבל את הקישור יוכל <b>לצפות</b> בתוכן (בלי חשבון).';
            // creating a new role resets any prior generated link
            card.querySelector('#_cs-result').style.display = 'none';
        }
        card.querySelector('#_cs-role-view').onclick = function () { setRole('view'); };
        card.querySelector('#_cs-role-edit').onclick = function () { setRole('edit'); };

        card.querySelector('#_cs-create').onclick = function () {
            var btn = this; btn.disabled = true; btn.textContent = 'יוצר…';
            createShare(contentId, contentType, role).then(function (token) {
                btn.disabled = false; btn.textContent = 'צור קישור שיתוף';
                if (!token) return;
                var url = shareUrl(token);
                var res = card.querySelector('#_cs-result');
                res.style.display = 'block';
                var inp = card.querySelector('#_cs-url'); inp.value = url;
                _wireSend('_cs-wa', '_cs-share', url);
                _toast(role === 'edit' ? '✏️ קישור עריכה משותפת נוצר' : '👁 קישור צפייה נוצר');
                card.querySelector('#_cs-copy').onclick = function () {
                    var ok = function () { _toast('🔗 הקישור הועתק'); };
                    var fb = function () { try { inp.select(); document.execCommand('copy'); ok(); } catch (_) { _toast('📋 ' + url); } };
                    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok).catch(fb);
                    else fb();
                };
            });
        };

        // --- Email invite wiring (own role toggle, independent of the link role) ---
        var emailRole = 'view';
        function setEmailRole(r) {
            emailRole = r;
            var v = card.querySelector('#_cs-erole-view'), e = card.querySelector('#_cs-erole-edit');
            var on = 'background:#0d9488;color:#fff', off = 'background:#fff;color:#0d9488';
            v.style.cssText = v.style.cssText.replace(/background:[^;]+;color:[^;]+/, r === 'view' ? on : off);
            e.style.cssText = e.style.cssText.replace(/background:[^;]+;color:[^;]+/, r === 'edit' ? on : off);
        }
        card.querySelector('#_cs-erole-view').onclick = function () { setEmailRole('view'); };
        card.querySelector('#_cs-erole-edit').onclick = function () { setEmailRole('edit'); };
        setEmailRole('view');

        // Live no-account warning. Track which email the visible warning refers to,
        // so editing the field hides a stale warning and send re-checks if needed.
        var _warnedEmail = null;
        function _showNoAcct(show) { card.querySelector('#_cs-noacct').style.display = show ? 'block' : 'none'; }
        function _checkAccount(email) {
            return emailHasAccount(email).then(function (has) {
                // has === false → no account → warn; true/null → no warning.
                _warnedEmail = email;
                _showNoAcct(has === false);
                return has;
            });
        }
        var _emInp = card.querySelector('#_cs-email');
        _emInp.addEventListener('blur', function () {
            var email = (_emInp.value || '').trim().toLowerCase();
            if (_validEmail(email)) _checkAccount(email); else _showNoAcct(false);
        });
        _emInp.addEventListener('input', function () {
            // Any edit invalidates the previous check — hide until re-checked.
            if (((_emInp.value || '').trim().toLowerCase()) !== _warnedEmail) _showNoAcct(false);
        });

        card.querySelector('#_cs-invite').onclick = function () {
            var emInp = card.querySelector('#_cs-email');
            var email = (emInp.value || '').trim().toLowerCase();
            if (!_validEmail(email)) { _toast('כתובת אימייל לא תקינה'); emInp.focus(); return; }
            // Ensure the sender has SEEN the no-account warning before this send.
            if (email !== _warnedEmail) {
                var btn0 = this; btn0.disabled = true; btn0.textContent = 'בודק…';
                _checkAccount(email).then(function () { btn0.disabled = false; btn0.textContent = 'שלח הזמנה'; });
                return; // first click only checks+warns; the sender clicks again to send
            }
            var btn = this; btn.disabled = true; btn.textContent = 'שולח…';
            createEmailShare(contentId, contentType, emailRole, email).then(function (token) {
                btn.disabled = false; btn.textContent = 'שלח הזמנה';
                if (!token) return;
                var url = shareUrl(token);
                var res = card.querySelector('#_cs-invite-result');
                res.style.display = 'block';
                var inp = card.querySelector('#_cs-invite-url'); inp.value = url;
                _wireSend('_cs-invite-wa', '_cs-invite-share', url);
                _toast('📧 הזמנה נשלחה ל-' + email);
                card.querySelector('#_cs-invite-copy').onclick = function () {
                    var ok = function () { _toast('🔗 הקישור הועתק'); };
                    var fb = function () { try { inp.select(); document.execCommand('copy'); ok(); } catch (_) { _toast('📋 ' + url); } };
                    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok).catch(fb);
                    else fb();
                };
            });
        };

        card.querySelector('#_cs-close').onclick = _removeDialog;
        ov.addEventListener('click', function (e) { if (e.target === ov) _removeDialog(); });
        setRole('view');
    }

    // Route a shared item to where it opens in the app. A registered opener
    // (registerOpener) wins; otherwise fall back to the generic routes.
    // vocab_category carries the share token (when present) + role + content id
    // so vocab.html can import and (for edit) co-edit against the owner's row.
    function openTarget(item) {
        var ct = item.content_type, title = item.title || '', role = item.role || 'view';
        if (_openers[ct]) { _openers[ct](item); return; }
        if (ct === 'vocab_category') {
            // shared_with_me rows carry no token (identity-authorised), so pass
            // the content id; vocab.html imports it by id. A token, if present,
            // is also carried (covers open-link items routed through here).
            var q = 'vocab.html?cat=' + encodeURIComponent(title) + '&role=' + encodeURIComponent(role);
            if (item.content_id) q += '&sharedId=' + encodeURIComponent(item.content_id);
            if (item.token) q += '&share=' + encodeURIComponent(item.token);
            location.href = q;
        } else {
            location.href = 'index.html';
        }
    }

    // Render a generic "🤝 שותפו איתי" section listing items shared with the
    // caller of one content type, into `container` (prepended by default). The
    // section auto-hides when there are no shared items. Each card's פתח button
    // routes through openTarget (or a registered opener). Reused by lessons/texts.
    function renderSharedInto(container, contentType, opts) {
        if (!container) return Promise.resolve(0);
        opts = opts || {};
        var sectId = '_cs-shared-sect-' + contentType;
        return sharedWithMe(contentType).then(function (items) {
            var old = document.getElementById(sectId);
            if (old && old.parentNode) old.parentNode.removeChild(old);
            if (!items.length) return 0;
            var sect = document.createElement('div');
            sect.id = sectId;
            sect.setAttribute('dir', 'rtl');
            sect.style.cssText = 'margin:0 0 14px 0';
            var h = document.createElement('h3');
            h.textContent = '🤝 ' + (opts.label || 'שותפו איתי');
            h.style.cssText = 'margin:0 0 8px 0;color:#0891b2;font-size:1.05em;border-bottom:1px solid #cffafe;padding-bottom:4px';
            sect.appendChild(h);
            var grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px';
            items.forEach(function (it) {
                var card = document.createElement('button');
                card.type = 'button';
                card.style.cssText = 'text-align:right;border:1px solid #a5f3fc;border-right:4px solid #0891b2;background:#f0fdff;border-radius:8px;padding:10px 11px;cursor:pointer;min-height:62px;font-family:inherit;color:#0f172a';
                var roleBadge = it.role === 'edit' ? '✏️ עריכה' : '👁 צפייה';
                card.innerHTML =
                    '<div style="display:flex;gap:6px;align-items:center;justify-content:space-between;margin-bottom:5px">' +
                        '<b style="font-size:.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(it.title || '') + '</b>' +
                        '<span style="font-size:.72em;font-weight:800;background:#fff;color:#0e7490;border:1px solid #a5f3fc;border-radius:999px;padding:1px 7px;white-space:nowrap">' + roleBadge + '</span>' +
                    '</div>' +
                    '<div style="font-size:.78em;color:#0e7490">פתח ←</div>';
                card.onclick = function () { (opts.openFn || openTarget)(it); };
                grid.appendChild(card);
            });
            sect.appendChild(grid);
            if (opts.prepend === false) container.appendChild(sect);
            else container.insertBefore(sect, container.firstChild);
            return items.length;
        });
    }

    // 'ששותף איתי' — list content shared TO this user, open each per its role.
    function openSharedWithMe() {
        _removeDialog();
        var ov = document.createElement('div');
        ov.id = '_cs-share-overlay';
        ov.setAttribute('dir', 'rtl');
        ov.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px';
        var card = document.createElement('div');
        card.style.cssText = 'background:#fff;border-radius:16px;max-width:480px;width:100%;max-height:80vh;overflow:auto;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,0.3);font-family:inherit;text-align:right';
        card.innerHTML = '<h3 style="margin:0 0 12px;color:#0d9488;font-size:1.2em">🤝 ששותף איתי</h3>' +
                         '<div id="_cs-swm-list" style="color:#64748b">טוען…</div>' +
                         '<button id="_cs-close" style="margin-top:14px;width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569;cursor:pointer">סגור</button>';
        ov.appendChild(card);
        document.body.appendChild(ov);
        card.querySelector('#_cs-close').onclick = _removeDialog;
        ov.addEventListener('click', function (e) { if (e.target === ov) _removeDialog(); });

        var TYPE_HE = { vocab_category: 'אוצר מילים', lesson: 'שיעור', analysis: 'ניתוח', sentence: 'משפט', hindus: 'הינדוס', text: 'טקסט' };
        sharedWithMe().then(function (items) {
            var list = card.querySelector('#_cs-swm-list');
            if (!items.length) { list.innerHTML = 'אין כרגע תוכן ששותף איתך.'; return; }
            list.innerHTML = '';
            items.forEach(function (it) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px';
                var roleBadge = it.role === 'edit' ? '✏️ עריכה' : '👁 צפייה';
                row.innerHTML = '<div style="text-align:right"><b style="color:#0f172a">' + _esc(it.title || '') + '</b>' +
                                '<div style="color:#94a3b8;font-size:0.82em">' + _esc(TYPE_HE[it.content_type] || it.content_type) + ' · ' + roleBadge + '</div></div>';
                var open = document.createElement('button');
                open.textContent = 'פתח';
                open.style.cssText = 'padding:8px 14px;border:0;border-radius:9px;background:#0d9488;color:#fff;font-weight:bold;cursor:pointer;flex:0 0 auto';
                open.onclick = function () { openTarget({ content_type: it.content_type, title: it.title, role: it.role, token: it.token }); };
                row.appendChild(open);
                list.appendChild(row);
            });
        });
    }

    // A ready-made share button element that opens the dialog for given content.
    function button(opts, opt2) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = '_cs-share-btn';
        b.title = 'שתף';
        b.textContent = (opt2 && opt2.label) ? opt2.label : '🔗';
        b.style.cssText = (opt2 && opt2.style) || 'background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.35);border-radius:9px;color:white;font-size:1.08em;cursor:pointer;padding:4px 8px;line-height:1;min-width:38px;min-height:34px';
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openShareDialog(opts); };
        return b;
    }

    return {
        openShareDialog: openShareDialog,
        button: button,
        createShare: createShare,
        createEmailShare: createEmailShare,
        emailHasAccount: emailHasAccount,
        shareUrl: shareUrl,
        sharedWithMe: sharedWithMe,
        openSharedWithMe: openSharedWithMe,
        openTarget: openTarget,
        fetchContentById: fetchContentById,
        registerOpener: registerOpener,
        renderSharedInto: renderSharedInto,
        _token: _token
    };
})();
