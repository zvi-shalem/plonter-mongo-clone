// SoundManager — Web Audio API synthesized sounds for Plonter v4.1
// All sounds are low volume (gain 0.08-0.15) per Amitai's "not over the top" instruction.
// Fails silently if AudioContext is unavailable.

const SoundManager = {
    _ctx: null,

    _getCtx() {
        if (this._ctx) return this._ctx;
        try {
            this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            // AudioContext unavailable — fail silently
        }
        return this._ctx;
    },

    _playTone(freq, duration, gain, type, startDelay) {
        const ctx = this._getCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        vol.gain.value = gain;
        // Fade out
        vol.gain.setValueAtTime(gain, ctx.currentTime + (startDelay || 0));
        vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (startDelay || 0) + duration);
        osc.connect(vol);
        vol.connect(ctx.destination);
        osc.start(ctx.currentTime + (startDelay || 0));
        osc.stop(ctx.currentTime + (startDelay || 0) + duration);
    },

    // Rising two-note ding (D5→A5) for valid combination
    playSuccess() {
        this._playTone(587, 0.15, 0.12, 'sine', 0);    // D5
        this._playTone(880, 0.2, 0.12, 'sine', 0.12);   // A5
    },

    // Soft pop (A4) for selections
    playClick() {
        this._playTone(440, 0.08, 0.08, 'sine', 0);
    },

    // Descending tone for incomplete combination
    playWarning() {
        this._playTone(523, 0.15, 0.1, 'triangle', 0);  // C5
        this._playTone(392, 0.2, 0.1, 'triangle', 0.12); // G4
    },

    // Low thud for rejected combination
    playError() {
        this._playTone(150, 0.2, 0.15, 'sine', 0);
    },

    // Rising C-E-G chime for roof creation
    playRoofCreated() {
        this._playTone(523, 0.12, 0.1, 'sine', 0);      // C5
        this._playTone(659, 0.12, 0.1, 'sine', 0.1);     // E5
        this._playTone(784, 0.18, 0.1, 'sine', 0.2);     // G5
    },

    // Descending whoosh for undo
    playUndo() {
        this._playTone(600, 0.08, 0.1, 'sawtooth', 0);
        this._playTone(400, 0.1, 0.08, 'sawtooth', 0.06);
        this._playTone(250, 0.12, 0.06, 'sawtooth', 0.12);
    },

    // Quick rising pop for hindus tagging
    playTag() {
        this._playTone(660, 0.06, 0.1, 'sine', 0);      // E5 quick
        this._playTone(880, 0.1, 0.12, 'triangle', 0.05); // A5 bright
    },

    // #40: Festive fanfare for sentence completion
    playCelebration() {
        this._playTone(523, 0.15, 0.15, 'sine', 0);       // C5
        this._playTone(659, 0.15, 0.15, 'sine', 0.15);     // E5
        this._playTone(784, 0.15, 0.15, 'sine', 0.3);      // G5
        this._playTone(1047, 0.4, 0.15, 'sine', 0.45);     // C6 (longer)
        this._playTone(1047, 0.12, 0.1, 'triangle', 0.7);  // sparkle
        this._playTone(1319, 0.15, 0.1, 'triangle', 0.8);  // E6
    }
};
