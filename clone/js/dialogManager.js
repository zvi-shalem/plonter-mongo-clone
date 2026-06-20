// DialogManager — unified modal dialog API.
// Replaces the hand-rolled overlay+card pattern repeated across the codebase
// (archSystem.js, modals.js, dictionary.js, mediaStorage.js, contentSync.js, hindusMode.js, etc).
//
// Usage:
//   DialogManager.show({
//       id: 'my-dialog',                      // optional — collision-replaces existing
//       title: 'Header HTML',                 // string (may contain <br>)
//       titleStyle: 'teal' | 'plain',         // default 'plain'
//       buttons: [
//           { label: '...', variant: 'danger|warn|info|muted|cancel|primary', onClick: fn },
//       ],
//       dismissOnOverlay: true,               // default true — click outside = dismiss
//       cardWidth: '320px',                   // optional — triggers max-width:Xpx;width:90%
//       buttonFontSize: '0.95em' | '1em',     // default '1em'
//   });
// Returns the overlay DOM element.
// Calls onClick() then removes the overlay. If onClick is null, button just dismisses.
const DialogManager = {
    VARIANT_STYLES: {
        danger:  'background:#fee2e2;color:#dc2626',
        warn:    'background:#fef3c7;color:#92400e',
        info:    'background:#dbeafe;color:#1e40af',
        muted:   'background:#e2e8f0;color:#334155',
        cancel:  'background:#f1f5f9;color:#64748b;margin-top:10px',
        primary: 'background:#0d9488;color:white',
    },

    TITLE_STYLES: {
        teal:  'font-weight:bold;font-size:1.05em;margin-bottom:16px;color:#0d9488',
        plain: 'font-weight:bold;font-size:1.1em;margin-bottom:16px',
    },

    show(opts) {
        const {
            id,
            title = '',
            titleStyle = 'plain',
            buttons = [],
            dismissOnOverlay = true,
            cardWidth,
            buttonFontSize = '1em',
        } = opts;

        if (id) {
            const existing = document.getElementById(id);
            if (existing) existing.remove();
        }

        const overlay = document.createElement('div');
        if (id) overlay.id = id;
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center';

        const dialog = document.createElement('div');
        const cardSize = cardWidth
            ? `max-width:${cardWidth};width:90%`
            : 'min-width:220px';
        dialog.style.cssText = `background:white;border-radius:12px;padding:20px 24px;${cardSize};text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.2);direction:rtl`;

        const titleCss = this.TITLE_STYLES[titleStyle] || this.TITLE_STYLES.plain;
        dialog.innerHTML = `<div style="${titleCss}">${title}</div>`;

        const btnBase = `display:block;width:100%;padding:10px;margin:6px 0;border:none;border-radius:8px;font-size:${buttonFontSize};cursor:pointer;font-weight:500;`;

        for (const b of buttons) {
            const btn = document.createElement('button');
            btn.textContent = b.label;
            const variantCss = this.VARIANT_STYLES[b.variant] || this.VARIANT_STYLES.muted;
            btn.style.cssText = btnBase + variantCss;
            btn.onclick = () => {
                overlay.remove();
                if (b.onClick) b.onClick();
            };
            dialog.appendChild(btn);
        }

        if (dismissOnOverlay) {
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        return overlay;
    },
};
