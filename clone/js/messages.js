// Messages — single message at a time, auto-fade, tooltips

const MessageManager = {
    _container: null,
    _currentMsg: null,
    _fadeTimer: null,
    _tooltipEl: null,

    init() {
        this._container = document.getElementById('validation-messages');
        if (!this._container) {
            this._container = document.createElement('div');
            this._container.id = 'validation-messages';
            this._container.className = 'validation-messages';
            document.body.appendChild(this._container);
        }
    },

    // Show a single message, replacing previous (Amitai request #1)
    show(text, type, duration) {
        if (!this._container) this.init();
        // Remove previous message
        if (this._currentMsg && this._currentMsg.parentNode) {
            this._currentMsg.remove();
        }
        if (this._fadeTimer) clearTimeout(this._fadeTimer);

        const msg = document.createElement('div');
        msg.className = `validation-message ${type || 'info'}`;
        msg.textContent = text;
        this._container.appendChild(msg);
        this._currentMsg = msg;

        // Auto-fade (Amitai request #3)
        const dur = duration || (type === 'error' ? 5000 : 3000);
        this._fadeTimer = setTimeout(() => {
            msg.classList.add('fading');
            setTimeout(() => { if (msg.parentNode) msg.remove(); }, 300);
        }, dur);
    },

    // Tooltip near mouse position (Amitai requests #2, #4)
    showTooltip(text, x, y) {
        this.hideTooltip();
        const tip = document.createElement('div');
        tip.className = 'tooltip-bubble';
        tip.textContent = text;
        tip.style.left = x + 'px';
        tip.style.top = (y - 40) + 'px';
        document.body.appendChild(tip);
        this._tooltipEl = tip;

        // Auto-hide after 4 seconds
        setTimeout(() => this.hideTooltip(), 4000);
    },

    hideTooltip() {
        if (this._tooltipEl && this._tooltipEl.parentNode) {
            this._tooltipEl.remove();
        }
        this._tooltipEl = null;
    },

    hideAll() {
        if (this._currentMsg && this._currentMsg.parentNode) this._currentMsg.remove();
        this._currentMsg = null;
        if (this._fadeTimer) clearTimeout(this._fadeTimer);
        this.hideTooltip();
    }
};
