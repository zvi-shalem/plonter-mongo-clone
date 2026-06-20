// ModelValidation — sentence models (דגם א/ב/ג) validation

const ModelValidation = {
    _state: null,

    init(stateManager) {
        this._state = stateManager;
    },

    // Validate a sentence model for an arch
    validate(arch) {
        const s = this._state;
        if (!arch.model) return null;

        // Find נושא and נשוא arches within this arch's span
        const idx1 = s.words.findIndex(w => w.id === arch.wordId1);
        const idx2 = s.words.findIndex(w => w.id === arch.wordId2);
        const start = Math.min(idx1, idx2), end = Math.max(idx1, idx2);

        const subjectArch = s.arches.find(a => {
            if (a.syntacticRole !== 'נושא') return false;
            const ai1 = s.words.findIndex(w => w.id === a.wordId1);
            const ai2 = s.words.findIndex(w => w.id === a.wordId2);
            return Math.min(ai1, ai2) >= start && Math.max(ai1, ai2) <= end;
        });

        const predicateArch = s.arches.find(a => {
            if (a.syntacticRole !== 'נשוא') return false;
            const ai1 = s.words.findIndex(w => w.id === a.wordId1);
            const ai2 = s.words.findIndex(w => w.id === a.wordId2);
            return Math.min(ai1, ai2) >= start && Math.max(ai1, ai2) <= end;
        });

        if (!subjectArch || !predicateArch) {
            return { valid: false, color: '#0891b2', message: 'חסר נושא או נשוא' };
        }

        // Get positions (RTL: lower index = appears first/right)
        const subjIdx = s.words.findIndex(w => w.id === subjectArch.wordId1);
        const predIdx = s.words.findIndex(w => w.id === predicateArch.wordId1);

        // Model A: verbal — predicate (verb) BEFORE subject
        if (arch.model === 'A') {
            if (predIdx >= subjIdx) {
                return { valid: false, color: '#ef4444', message: 'דגם א: הנשוא (פועל) חייב לבוא לפני הנושא' };
            }
            return { valid: true, color: '#10b981', message: 'דגם א תקין — נשוא פועלי לפני נושא' };
        }

        // Model B: nominal — subject BEFORE predicate
        if (arch.model === 'B') {
            if (subjIdx >= predIdx) {
                return { valid: false, color: '#ef4444', message: 'דגם ב: הנושא חייב לבוא לפני הנשוא' };
            }
            return { valid: true, color: '#10b981', message: 'דגם ב תקין — נושא לפני נשוא' };
        }

        // Model C: prepositional — predicate (prep phrase) BEFORE subject
        if (arch.model === 'C') {
            if (predIdx >= subjIdx) {
                return { valid: false, color: '#ef4444', message: 'דגם ג: הנשוא (צירוף יחס) חייב לבוא לפני הנושא' };
            }
            return { valid: true, color: '#10b981', message: 'דגם ג תקין — נשוא צירוף יחס לפני נושא' };
        }

        return null;
    },

    // Open model selection modal (triggered after first נושא/נשוא)
    openModelModal(callback) {
        let modal = document.getElementById('model-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'model-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <h3>בחר דגם משפט</h3>
                    <div class="model-options-grid">
                        <button class="model-choice-btn" data-model="A">
                            <strong>דגם א — משפט פועלי</strong><br>
                            <small>הנשוא (פועל) לפני הנושא</small>
                        </button>
                        <button class="model-choice-btn" data-model="B">
                            <strong>דגם ב — משפט שמני</strong><br>
                            <small>הנושא לפני הנשוא</small>
                        </button>
                        <button class="model-choice-btn" data-model="C">
                            <strong>דגם ג — משפט שמני הפוך</strong><br>
                            <small>הנשוא (צירוף יחס) לפני הנושא</small>
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.querySelector('.close').onclick = () => modal.classList.remove('show');
            modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
        }

        modal.querySelectorAll('.model-choice-btn').forEach(btn => {
            btn.onclick = () => {
                modal.classList.remove('show');
                if (callback) callback(btn.dataset.model);
            };
        });

        modal.classList.add('show');
    }
};
