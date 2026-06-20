// uiFeedback.js — shared "every mutating action gives soft visible confirmation" helper.
// Owner: @7l. Single source for Amitai's #1 principle (B6). All Plonter areas call this;
// nobody re-implements. @6m wires the <script> into clone/index.html once.
//
// API:
//   UIFeedback.run(triggerEl, asyncFn, {savingText:'שומר…', doneText:'✓ נשמר', sound:true, errorText})
//     → disables triggerEl + shows an in-flight spinner/label, awaits asyncFn(),
//       on success restores it + shows a soft fading success toast (+optional sound),
//       on throw surfaces the real error in a toast and re-enables. Returns the asyncFn promise.
//   UIFeedback.toast(msg, kind)  // kind: 'success' | 'error' | 'info'  (non-button confirmations)
var UIFeedback = (function() {
    'use strict';

    function _ensureStyle() {
        if (document.getElementById('uifb-style')) return;
        var st = document.createElement('style');
        st.id = 'uifb-style';
        st.textContent =
            '@keyframes uifb-spin{to{transform:rotate(360deg)}}' +
            '@keyframes uifb-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
            '@keyframes uifb-out{to{opacity:0;transform:translateY(8px)}}' +
            '#uifb-toasts{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100050;' +
            'display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;direction:rtl}' +
            '.uifb-toast{pointer-events:auto;min-width:160px;max-width:90vw;padding:10px 16px;border-radius:10px;' +
            'font-weight:bold;font-size:0.95em;box-shadow:0 6px 20px rgba(0,0,0,0.18);animation:uifb-in 0.25s ease}' +
            '.uifb-spin{display:inline-block;width:13px;height:13px;border:2px solid currentColor;' +
            'border-top-color:transparent;border-radius:50%;animation:uifb-spin 0.7s linear infinite;' +
            'vertical-align:middle;margin-inline-start:6px}';
        document.head.appendChild(st);
    }

    function _container() {
        var c = document.getElementById('uifb-toasts');
        if (!c) {
            c = document.createElement('div');
            c.id = 'uifb-toasts';
            document.body.appendChild(c);
        }
        return c;
    }

    function toast(msg, kind) {
        try {
            _ensureStyle();
            var colors = {
                success: { bg: '#ecfdf5', fg: '#065f46', bd: '#6ee7b7' },
                error:   { bg: '#fef2f2', fg: '#991b1b', bd: '#fca5a5' },
                info:    { bg: '#eff6ff', fg: '#1e40af', bd: '#93c5fd' }
            };
            var c = colors[kind] || colors.info;
            var el = document.createElement('div');
            el.className = 'uifb-toast';
            el.style.background = c.bg;
            el.style.color = c.fg;
            el.style.border = '1px solid ' + c.bd;
            el.textContent = msg;
            _container().appendChild(el);
            var ttl = kind === 'error' ? 4200 : 2400;
            setTimeout(function() {
                el.style.animation = 'uifb-out 0.4s ease forwards';
                setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 420);
            }, ttl);
            return el;
        } catch (e) { return null; }
    }

    function _playSound() {
        try {
            if (typeof SoundManager !== 'undefined' && SoundManager && SoundManager.playSuccess) {
                SoundManager.playSuccess();
            }
        } catch (e) {}
    }

    // Disable a control + show an in-flight label, await asyncFn, confirm/restore.
    function run(triggerEl, asyncFn, opts) {
        opts = opts || {};
        var savingText = opts.savingText || 'שומר…';
        var doneText = opts.doneText || '✓ נשמר';
        var wantSound = opts.sound !== false; // default true
        _ensureStyle();

        var el = triggerEl || null;
        var origHtml = null, origDisabled = false, isButtonLike = false;
        if (el) {
            isButtonLike = ('disabled' in el);
            origDisabled = !!el.disabled;
            origHtml = el.innerHTML;
            if (isButtonLike) el.disabled = true;
            el.setAttribute('data-uifb-busy', '1');
            // Show in-flight on the control itself (keeps width-ish via label swap).
            el.innerHTML = '<span class="uifb-spin"></span>' + savingText;
        }

        function restore() {
            if (!el) return;
            if (isButtonLike) el.disabled = origDisabled;
            if (origHtml !== null) el.innerHTML = origHtml;
            el.removeAttribute('data-uifb-busy');
        }

        var result;
        try {
            result = (typeof asyncFn === 'function') ? asyncFn() : asyncFn;
        } catch (syncErr) {
            restore();
            toast((opts.errorText || 'שגיאה') + ': ' + (syncErr && syncErr.message ? syncErr.message : syncErr), 'error');
            return Promise.reject(syncErr);
        }

        return Promise.resolve(result).then(function(val) {
            restore();
            toast(doneText, 'success');
            if (wantSound) _playSound();
            return val;
        }, function(err) {
            restore();
            var m = (err && err.message) ? err.message : (err || 'שגיאה');
            toast((opts.errorText || 'שגיאה') + ': ' + m, 'error');
            throw err;
        });
    }

    return { run: run, toast: toast };
})();

if (typeof window !== 'undefined') window.UIFeedback = UIFeedback;
