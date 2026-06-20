// Dragon-only user admin panel. Shows a ניהול 🐉 button in the auth-status
// header when the logged-in user is a dragon, opens a modal with user table.
var PlonterAdmin = (function() {
    'use strict';
    var API = '/plonter/api/admin_api.php';
    var DRAGON = '🐉 דרקון';
    var LEGACY_DRAGON = '🐲 דרקון';
    var DJ = '🎧 DJ';
    var AUDIT_CONTROLLER = 'בקרת אוצם';
    var MAVIN_INYAN = '🧠 מבין עניין';
    var COMMONER = '👤 פשוט עם';
    var LEGACY_KING = '🏰 מלך';
    var LEGACY_PEASANT = '🌾 איכר';
    var SIMPLE_USER_DOMAIN = 'plonter.local';
    var _myRole = null;

    function _getToken() { return localStorage.getItem('plonter_auth_token') || ''; }

    function _setMyRole(role) {
        _myRole = role || '';
        _renderAdminButton();
        document.dispatchEvent(new CustomEvent('plonter:rolechange', { detail: { role: _normalizeRole(_myRole) } }));
    }

    function _api(action, body) {
        var t = _getToken();
        if (!t) return Promise.resolve({ ok: false, error: 'לא מחובר' });
        return fetch(API + '?action=' + action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
            body: JSON.stringify(body || {})
        }).then(function(r) { return r.json(); }).catch(function(e) {
            return { ok: false, error: 'שגיאת תקשורת' };
        });
    }

    function refreshMyRole() {
        if (!_getToken()) {
            _setMyRole('');
            return Promise.resolve(_myRole);
        }
        return _api('get_my_role', {}).then(function(data) {
            if (data && data.ok) {
                _setMyRole(data.role || '');
            } else {
                _setMyRole('');
            }
            return _myRole;
        });
    }

    function _renderAdminButton() {
        var status = document.getElementById('auth-status');
        if (!status) return;
        var existing = document.getElementById('admin-panel-btn');
        if (_normalizeRole(_myRole) !== DRAGON) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        var btn = document.createElement('button');
        btn.id = 'admin-panel-btn';
        // RTL: margin-left puts space between this button and its neighbor
        // to the left (the "שלום X" greeting). margin-right would push into
        // the container edge instead, which Amitai 2026-04-19 05:04 flagged
        // as the emoji being jammed against the username.
        btn.style.cssText = 'margin-inline-end:10px;margin-left:10px;padding:4px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.15);color:white;cursor:pointer;font-size:0.85em;font-weight:bold;white-space:nowrap';
        btn.textContent = 'ניהול 🐉';
        btn.addEventListener('click', openPanel);
        status.insertBefore(btn, status.firstChild);
    }

    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function _normalizeRole(role) {
        role = (role || '').trim();
        if (role === LEGACY_DRAGON) return DRAGON;
        if (role === LEGACY_KING) return DJ;
        if (role === LEGACY_PEASANT) return COMMONER;
        return role;
    }

    function _normalizeRoles(roles) {
        var seen = {};
        return (roles || []).map(_normalizeRole).filter(function(role) {
            if (!role || seen[role]) return false;
            seen[role] = true;
            return true;
        });
    }

    function _simpleUsernameFromEmail(email) {
        email = String(email || '').trim().toLowerCase();
        var suffix = '@' + SIMPLE_USER_DOMAIN;
        if (email.slice(-suffix.length) !== suffix) return '';
        return email.slice(0, -suffix.length);
    }

    function _simpleEmailFromUsername(username) {
        username = String(username || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '').replace(/^[._-]+|[._-]+$/g, '');
        return username + '@' + SIMPLE_USER_DOMAIN;
    }

    function openPanel() {
        Promise.all([_api('list_users', {}), _api('roles', {})]).then(function(results) {
            var listRes = results[0], rolesRes = results[1];
            if (!listRes || !listRes.ok) { alert('שגיאה: ' + (listRes && listRes.error)); return; }
            var users = listRes.users || [];
            var roles = _normalizeRoles((rolesRes && rolesRes.roles) || [DRAGON, DJ, AUDIT_CONTROLLER, MAVIN_INYAN, '🛡️ אביר', '🏹 חייל', COMMONER]);
            _renderModal(users, roles);
        });
    }

    // Inject the responsive stylesheet once. The admin modal is built with
    // inline styles, but inline styles can't carry @media queries — so the
    // mobile/phone layout lives here. Desktop (≥601px) is untouched and keeps
    // the original table look; ≤600px collapses the user table into stacked
    // cards (each <tr> a card, each <td> a labelled row) so Amitai can manage
    // users one-handed on a phone with no horizontal table overflow.
    // Plonter bdika #1339 (Amitai 2026-06-10): "Dragon admin hard on phone".
    function _injectResponsiveStyle() {
        var STYLE_ID = 'adm-responsive-style';
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent =
            '@media (max-width:600px){' +
                '.adm-modal{padding:14px 12px !important;width:100% !important;border-radius:14px !important;max-height:92vh !important}' +
                '.adm-header{flex-wrap:wrap;gap:10px}' +
                '.adm-header h3{font-size:1.1em}' +
                '.adm-header > div{flex-wrap:wrap}' +
                '.adm-header button{flex:1;min-width:120px}' +
                '.adm-new-grid{grid-template-columns:1fr !important}' +
                '.adm-new-grid input,.adm-new-grid select,.adm-new-grid button{font-size:16px !important;padding:10px !important}' +
                // visually hide the table header — labels move into each cell
                '.adm-user-table thead{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);border:0}' +
                '.adm-user-table,.adm-user-table tbody,.adm-user-table tr,.adm-user-table td{display:block;width:100%}' +
                '.adm-user-table tr{border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,0.07)}' +
                '.adm-user-table td{border-top:none !important;padding:6px 0 !important;display:flex;align-items:center;gap:10px;white-space:normal !important}' +
                '.adm-user-table td::before{content:attr(data-label);flex:0 0 84px;font-weight:bold;color:#64748b;font-size:0.82em}' +
                '.adm-user-table td input,.adm-user-table td select,.adm-user-table td > div{flex:1;min-width:0}' +
                '.adm-user-table td input,.adm-user-table td select{font-size:16px;padding:9px 10px}' +
                '.adm-user-table td[data-label="ID"]{color:#94a3b8;font-size:0.85em}' +
                '.adm-user-table td[data-label="פעולות"]{align-items:stretch;gap:8px;padding-top:10px !important}' +
                '.adm-user-table td[data-label="פעולות"]::before{align-self:center}' +
                '.adm-user-table td[data-label="פעולות"] button{flex:1;margin:0 !important;padding:11px 8px;font-size:0.95em}' +
            '}';
        document.head.appendChild(st);
    }

    function _renderModal(users, roles) {
        _injectResponsiveStyle();
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10050;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        var dlg = document.createElement('div');
        dlg.className = 'adm-modal';
        dlg.style.cssText = 'background:white;border-radius:18px;padding:22px;max-width:780px;width:96%;max-height:86vh;overflow-y:auto;direction:rtl;text-align:right;box-shadow:0 20px 60px rgba(0,0,0,0.3)';

        var rows = users.map(function(u) {
            var normalizedRole = _normalizeRole(u.role);
            var isDragon = normalizedRole === DRAGON;
            var simpleUsername = u.username || _simpleUsernameFromEmail(u.email);
            var isSimpleUser = !!(u.is_simple_user || simpleUsername);
            var rowBg = isSimpleUser ? 'background:#fff7ed' : '';
            var emailCell = isSimpleUser ?
                '<div style="display:flex;flex-direction:column;gap:3px">' +
                    '<input type="text" class="adm-email adm-username" value="' + _esc(simpleUsername) + '" dir="ltr" style="width:100%;padding:4px 6px;border:1px solid #fed7aa;border-radius:6px;background:#fff">' +
                    '<span style="font-size:0.78em;color:#c2410c;font-weight:bold">משתמש פשוט</span>' +
                '</div>' :
                '<input type="email" class="adm-email" value="' + _esc(u.email) + '" dir="ltr" style="width:100%;padding:4px 6px;border:1px solid #e5e7eb;border-radius:6px">';
            // Dragon assignment is server-locked to Amitai (api/admin_api.php's
            // set_role rejects non-Amitai → Dragon with 'דרקון נעול לאמתי בלבד').
            // Hide Dragon from the dropdown for non-Dragon rows so the user
            // doesn't see it pre-selected and click שמור only to get a 500.
            // For Dragon's OWN row, show a single disabled Dragon option (the
            // <select> is already disabled by isDragon below, so no role swap
            // can happen). Plonter task #9 (TODO #570, 2026-04-29).
            var opts;
            if (isDragon) {
                opts = '<option selected>' + _esc(DRAGON) + '</option>';
            } else {
                var assignableRoles = roles.filter(function(r) { return r !== DRAGON; });
                var roleInList = assignableRoles.indexOf(normalizedRole) >= 0;
                opts = '';
                if (!roleInList) {
                    // u.role isn't a valid assignable role (e.g., legacy
                    // '👤 פשוט עם') — show an explicit empty placeholder
                    // instead of letting the browser visually default to the
                    // first option.
                    opts += '<option value="" selected disabled>— ללא תפקיד —</option>';
                }
                opts += assignableRoles.map(function(r) {
                    var selected = (roleInList && normalizedRole === r) ? ' selected' : '';
                    return '<option value="' + _esc(r) + '"' + selected + '>' + _esc(r) + '</option>';
                }).join('');
            }
            return '' +
                '<tr data-uid="' + u.id + '" data-simple="' + (isSimpleUser ? '1' : '0') + '" style="border-top:1px solid #e5e7eb;' + rowBg + '">' +
                    '<td data-label="ID" style="padding:8px 6px">' + u.id + '</td>' +
                    '<td data-label="שם פרטי" style="padding:8px 6px"><input type="text" class="adm-fname" value="' + _esc(u.first_name) + '" style="width:100%;padding:4px 6px;border:1px solid #e5e7eb;border-radius:6px"></td>' +
                    '<td data-label="שם משפחה" style="padding:8px 6px"><input type="text" class="adm-lname" value="' + _esc(u.last_name) + '" style="width:100%;padding:4px 6px;border:1px solid #e5e7eb;border-radius:6px"></td>' +
                    '<td data-label="מייל" style="padding:8px 6px">' + emailCell + '</td>' +
                    '<td data-label="תפקיד" style="padding:8px 6px"><select class="adm-role"' + (isDragon ? ' disabled' : '') + ' style="padding:4px 6px;border:1px solid #e5e7eb;border-radius:6px;background:white">' + opts + '</select></td>' +
                    '<td data-label="פעולות" style="padding:8px 6px;white-space:nowrap">' +
                        '<button class="adm-save" style="padding:4px 10px;background:#0d9488;color:white;border:none;border-radius:6px;cursor:pointer;margin-left:4px">שמור</button>' +
                        (isDragon ? '' : '<button class="adm-del" style="padding:4px 10px;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer">מחק</button>') +
                    '</td>' +
                '</tr>';
        }).join('');

        var assignableRoles = roles.filter(function(r) { return r !== DRAGON; });
        var newRoleOpts = '<option value="" selected>— ללא תפקיד —</option>' + assignableRoles.map(function(r) {
            return '<option value="' + _esc(r) + '">' + _esc(r) + '</option>';
        }).join('');

        dlg.innerHTML =
            '<div class="adm-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
                '<h3 style="margin:0;color:#0d9488">🐉 ניהול משתמשים</h3>' +
                '<div style="display:flex;gap:8px">' +
                    '<button id="adm-new-toggle" style="padding:6px 14px;background:#0d9488;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold">➕ הוסף משתמש</button>' +
                    '<button id="adm-close" style="padding:6px 14px;background:#e5e7eb;border:none;border-radius:8px;cursor:pointer">סגור</button>' +
                '</div>' +
            '</div>' +
            '<div id="adm-new-form" style="display:none;background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;padding:14px;margin-bottom:14px">' +
                '<div style="font-weight:bold;color:#0d9488;margin-bottom:10px">משתמש חדש</div>' +
                '<label style="display:flex;align-items:center;gap:6px;margin-bottom:10px;color:#334155;font-size:0.9em"><input type="checkbox" id="adm-new-simple"> משתמש פשוט: שם משתמש + סיסמה, בלי שם משפחה ובלי מייל</label>' +
                '<div class="adm-new-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
                    '<input type="text" id="adm-new-fname" placeholder="שם פרטי *" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px">' +
                    '<input type="text" id="adm-new-lname" placeholder="שם משפחה" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px">' +
                    '<input type="email" id="adm-new-email" placeholder="מייל *" dir="ltr" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px">' +
                    '<input type="text" id="adm-new-pw" placeholder="סיסמה *" dir="ltr" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px">' +
                    '<select id="adm-new-role" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;background:white">' + newRoleOpts + '</select>' +
                    '<button id="adm-new-submit" style="padding:6px 14px;background:#0d9488;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold">צור משתמש</button>' +
                '</div>' +
                '<div id="adm-new-msg" style="margin-top:8px;font-size:0.85em"></div>' +
            '</div>' +
            '<table class="adm-user-table" style="width:100%;border-collapse:collapse;font-size:0.9em">' +
                '<thead><tr style="background:#f8fafc"><th style="padding:8px 6px;text-align:right">ID</th><th style="padding:8px 6px;text-align:right">שם פרטי</th><th style="padding:8px 6px;text-align:right">שם משפחה</th><th style="padding:8px 6px;text-align:right">מייל</th><th style="padding:8px 6px;text-align:right">תפקיד</th><th style="padding:8px 6px;text-align:right">פעולות</th></tr></thead>' +
                '<tbody id="adm-tbody">' + rows + '</tbody>' +
            '</table>';

        overlay.appendChild(dlg);
        document.body.appendChild(overlay);
        document.getElementById('adm-close').onclick = function() { overlay.remove(); };

        var newToggle = document.getElementById('adm-new-toggle');
        var newForm   = document.getElementById('adm-new-form');
        var newMsg    = document.getElementById('adm-new-msg');
        var newSubmit = document.getElementById('adm-new-submit');
        var newSimple = document.getElementById('adm-new-simple');
        var newFirstInput = document.getElementById('adm-new-fname');
        var newLastInput = document.getElementById('adm-new-lname');
        var newEmailInput = document.getElementById('adm-new-email');
        function syncSimpleForm() {
            var simple = !!(newSimple && newSimple.checked);
            newFirstInput.placeholder = simple ? 'שם משתמש *' : 'שם פרטי *';
            newLastInput.disabled = simple;
            newEmailInput.disabled = simple;
            newLastInput.style.opacity = simple ? '0.45' : '1';
            newEmailInput.style.opacity = simple ? '0.45' : '1';
            if (simple) {
                newLastInput.value = '';
                newEmailInput.value = '';
            }
        }
        if (newSimple) newSimple.onchange = syncSimpleForm;
        newToggle.onclick = function() {
            var open = newForm.style.display === 'none';
            newForm.style.display = open ? 'block' : 'none';
            if (open) {
                syncSimpleForm();
                document.getElementById('adm-new-fname').focus();
            }
        };
        newSubmit.onclick = function() {
            var first = document.getElementById('adm-new-fname').value.trim();
            var last  = document.getElementById('adm-new-lname').value.trim();
            var email = document.getElementById('adm-new-email').value.trim();
            var pw    = document.getElementById('adm-new-pw').value;
            var role  = document.getElementById('adm-new-role').value;
            var simple = !!(newSimple && newSimple.checked);
            if (!first || !pw || (!simple && !email)) { newMsg.style.color = '#dc2626'; newMsg.textContent = simple ? 'שם משתמש וסיסמה הם שדות חובה' : 'שם פרטי, מייל וסיסמה הם שדות חובה'; return; }
            newSubmit.disabled = true; newSubmit.textContent = '...';
            newMsg.style.color = '#6b7280'; newMsg.textContent = 'יוצר...';
            _api('create_user', { first_name: first, username: simple ? first : '', simple_user: simple ? 1 : 0, last_name: simple ? '' : last, email: simple ? '' : email, password: pw, role: role }).then(function(res) {
                newSubmit.disabled = false; newSubmit.textContent = 'צור משתמש';
                if (!res || !res.ok) {
                    newMsg.style.color = '#dc2626';
                    newMsg.textContent = 'שגיאה: ' + ((res && res.error) || 'לא ידוע');
                    return;
                }
                newMsg.style.color = '#059669';
                newMsg.textContent = '✓ נוצר משתמש #' + res.id + ' (' + (res.username || res.email) + ')';
                ['adm-new-fname','adm-new-lname','adm-new-email','adm-new-pw'].forEach(function(id) { document.getElementById(id).value = ''; });
                document.getElementById('adm-new-role').value = '';
                if (newSimple) newSimple.checked = false;
                syncSimpleForm();
                _api('list_users', {}).then(function(lr) {
                    if (lr && lr.ok) {
                        overlay.remove();
                        _renderModal(lr.users || [], roles);
                    }
                });
            });
        };

        dlg.querySelectorAll('tr[data-uid]').forEach(function(tr) {
            var uid = parseInt(tr.dataset.uid, 10);
            var saveBtn = tr.querySelector('.adm-save');
            var delBtn = tr.querySelector('.adm-del');
            var fname = tr.querySelector('.adm-fname');
            var lname = tr.querySelector('.adm-lname');
            var email = tr.querySelector('.adm-email');
            var roleSel = tr.querySelector('.adm-role');
            var isSimpleRow = tr.dataset.simple === '1';

            saveBtn.onclick = function() {
                // Guard: don't POST an empty role to the server. The dropdown
                // shows a disabled '— ללא תפקיד —' placeholder when the user
                // has no valid role yet; user must pick a real role first.
                if (!roleSel.disabled && roleSel.value === '') {
                    alert('בחר תפקיד לפני שמירה');
                    return;
                }
                var emailValue = email.value;
                var firstValue = fname.value;
                if (isSimpleRow) {
                    if (!email.value.trim()) {
                        alert('שם משתמש חובה');
                        return;
                    }
                    firstValue = email.value.trim();
                    emailValue = _simpleEmailFromUsername(email.value);
                }
                saveBtn.disabled = true;
                saveBtn.textContent = '...';
                Promise.all([
                    _api('update_user', { id: uid, first_name: firstValue, last_name: isSimpleRow ? '' : lname.value, email: emailValue }),
                    roleSel.disabled ? Promise.resolve({ ok: true }) : _api('set_role', { id: uid, role: roleSel.value })
                ]).then(function(res) {
                    var fail = res.find(function(r) { return !r || !r.ok; });
                    if (fail) {
                        alert('שגיאה: ' + (fail.error || 'unknown'));
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'שמור';
                    } else {
                        saveBtn.textContent = '✓ נשמר';
                        setTimeout(function() { saveBtn.disabled = false; saveBtn.textContent = 'שמור'; }, 1200);
                    }
                });
            };

            if (delBtn) {
                delBtn.onclick = function() {
                    if (!confirm('למחוק את המשתמש ' + email.value + '?\nפעולה לא הפיכה.')) return;
                    _api('delete_user', { id: uid }).then(function(res) {
                        if (res && res.ok) {
                            tr.remove();
                        } else {
                            alert('שגיאה: ' + ((res && res.error) || 'unknown'));
                        }
                    });
                };
            }
        });
    }

    // Bootstrap: refresh role on auth changes.
    document.addEventListener('plonter:authchange', function() { refreshMyRole(); });
    // Initial run once the page is ready.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(refreshMyRole, 500); });
    } else {
        setTimeout(refreshMyRole, 500);
    }

    return {
        refreshMyRole: refreshMyRole,
        openPanel: openPanel,
        isDragon: function() { return _normalizeRole(_myRole) === DRAGON; },
        isKing: function() { return _normalizeRole(_myRole) === DJ; },
        isAuditController: function() { return _normalizeRole(_myRole) === AUDIT_CONTROLLER; },
        isMavinInyan: function() { return _normalizeRole(_myRole) === MAVIN_INYAN; },
        getRole: function() { return _normalizeRole(_myRole); }
    };
})();
