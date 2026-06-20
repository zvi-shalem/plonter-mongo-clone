// Word data structure and methods

class Word {
    constructor(id, text) {
        this.id = id;
        this.text = text;
        this.partsOfSpeech = [];
    }

    addPartOfSpeech(type, details = {}) {
        const normalizedDetails = this.normalizeDetails(type, details);
        const partOfSpeech = {
            id: `${this.id}_pos_${Date.now()}_${Math.random()}`,
            type: type,
            details: normalizedDetails
        };
        this.partsOfSpeech.push(partOfSpeech);
        return partOfSpeech;
    }

    normalizeDetails(type, details) {
        const normalized = { ...details };
        if (type === 'verb') {
            if (normalized.root && !Array.isArray(normalized.root)) normalized.root = [normalized.root];
            if (normalized.time && !Array.isArray(normalized.time)) normalized.time = [normalized.time];
            if (normalized.personGender && !Array.isArray(normalized.personGender)) normalized.personGender = [normalized.personGender];
            if (normalized.binyan && !Array.isArray(normalized.binyan)) normalized.binyan = [normalized.binyan];
        }
        if ((type === 'noun' || type === 'adjective') && normalized.cases) {
            if (!Array.isArray(normalized.cases)) normalized.cases = [normalized.cases];
        } else if ((type === 'noun' || type === 'adjective') && !normalized.cases) {
            normalized.cases = ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'];
        }
        return normalized;
    }

    removePartOfSpeech(posId) {
        this.partsOfSpeech = this.partsOfSpeech.filter(pos => pos.id !== posId);
    }

    updatePartOfSpeechDetails(posId, details) {
        const pos = this.partsOfSpeech.find(p => p.id === posId);
        if (pos) pos.details = { ...pos.details, ...details };
    }

    getPartOfSpeech(posId) {
        return this.partsOfSpeech.find(p => p.id === posId);
    }

    hasPartOfSpeech() {
        return this.partsOfSpeech.length > 0;
    }
}

function createWord(id, text) {
    return new Word(id, text);
}
