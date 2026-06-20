// Part of Speech Definitions and Properties

const POS_HIERARCHY = {
    noun: {
        name: 'שם',
        nameEn: 'noun',
        icon: '📦',
        subTypes: {
            regularNoun: { name: 'שם עצם/תואר', nameEn: 'regularNoun', key: 'noun' },
            adjective: { name: 'שם תואר', nameEn: 'adjective', key: 'adjective' },
            pronoun: { name: 'כינוי גוף', nameEn: 'pronoun', key: 'personalPronoun' },
            demonstrative: { name: 'כינוי רמז', nameEn: 'demonstrative', key: 'demonstrative' },
            relativePronoun: { name: 'שם זיקה', nameEn: 'relativePronoun', key: 'relativePronoun' },
            interrogative: { name: 'שם שאלה/תנאי', nameEn: 'interrogative', key: 'questionWord' }
        }
    },
    verb: {
        name: 'פועל',
        nameEn: 'verb',
        icon: '⚙️',
        subTypes: {
            verb: { name: 'פועל', nameEn: 'verb', key: 'verb' }
        }
    },
    particle: {
        name: 'מילית',
        nameEn: 'particle',
        icon: '🔗',
        subTypes: {
            preposition: { name: 'מילית יחס', nameEn: 'preposition', key: 'preposition' },
            conjunction: { name: 'מילית חיבור', nameEn: 'conjunction', key: 'conjunction' },
            subordinating: { name: 'מילית שיעבוד', nameEn: 'subordinating', key: 'subordinating' },
            negation: { name: 'מילית שלילה', nameEn: 'negation', key: 'negation' },
            jazm: { name: 'מילית מג\'זום', nameEn: 'jazm', key: 'jazm' },
            conditional: { name: 'מילית תנאי', nameEn: 'conditional', key: 'conditional' },
            mudrika: { name: 'מילית מוצרכת', nameEn: 'mudrika', key: 'mudrika' }
        }
    }
};

const VERB_FORMS = [
    { value: '1', label: '1. فَعَلَ', arabic: 'فَعَلَ' },
    { value: '2', label: '2. فَعَّلَ', arabic: 'فَعَّلَ' },
    { value: '3', label: '3. فَاعَلَ', arabic: 'فَاعَلَ' },
    { value: '4', label: '4. أَفْعَلَ', arabic: 'أَفْعَلَ' },
    { value: '5', label: '5. تَفَعَّلَ', arabic: 'تَفَعَّلَ' },
    { value: '6', label: '6. تَفَاعَلَ', arabic: 'تَفَاعَلَ' },
    { value: '7', label: '7. إِنْفَعَلَ', arabic: 'إِنْفَعَلَ' },
    { value: '8', label: '8. إِفْتَعَلَ', arabic: 'إِفْتَعَلَ' },
    { value: '9', label: '9. إِفْعَلَّ', arabic: 'إِفْعَلَّ' },
    { value: '10', label: '10. إِسْتَفْعَلَ', arabic: 'إِسْتَفْعَلَ' }
];

const VERB_PERSON_GENDER = [
    { value: 'נסתר', label: 'נסתר' },
    { value: 'נסתרת', label: 'נסתרת' },
    { value: 'מדבר', label: 'מדבר' },
    { value: 'נוכח', label: 'נוכח' },
    { value: 'נוכחת', label: 'נוכחת' },
    { value: 'מדברים', label: 'מדברים' },
    { value: 'נוכחים', label: 'נוכחים' },
    { value: 'נוכחות', label: 'נוכחות' },
    { value: 'נסתרים', label: 'נסתרים' },
    { value: 'נסתרות', label: 'נסתרות' }
];

const PARTS_OF_SPEECH = {
    verb: {
        name: 'פועל', nameEn: 'verb',
        details: {
            root: { label: 'שורש', type: 'text', multi: true },
            binyan: { label: 'בניין', type: 'multiselect', options: VERB_FORMS },
            time: { label: 'זמן', type: 'multiselect', options: ['עבר', 'עתיד', 'עתיד מנצוב', 'עתיד מג\'זום', 'ציווי'], multi: true },
            voice: { label: 'קול', type: 'select', options: ['פעיל', 'סביל'], default: 'פעיל' },
            personGender: { label: 'גוף/מין', type: 'multiselect', options: VERB_PERSON_GENDER, multi: true }
        }
    },
    noun: {
        name: 'שם עצם', nameEn: 'noun',
        details: {
            gender: { label: 'מין', type: 'select', options: ['זכר', 'נקבה'] },
            number: { label: 'מספר', type: 'select', options: ['יחיד', 'זוגי', 'רבים'] },
            definiteness: { label: 'יידוע', type: 'select', options: ['מיודע', 'לא מיודע'] }
        },
        bonus: {
            cases: { label: 'יחסה (אופציונלי)', type: 'multicheckbox', options: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'], default: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'] }
        }
    },
    adjective: {
        name: 'שם תואר', nameEn: 'adjective',
        details: {
            gender: { label: 'מין', type: 'select', options: ['זכר', 'נקבה'] },
            number: { label: 'מספר', type: 'select', options: ['יחיד', 'זוגי', 'רבים'] },
            definiteness: { label: 'יידוע', type: 'select', options: ['מיודע', 'לא מיודע'] }
        },
        bonus: {
            cases: { label: 'יחסה', type: 'multicheckbox', options: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'], default: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'] }
        }
    },
    demonstrative: {
        name: 'כינוי רמז', nameEn: 'demonstrative',
        details: {
            gender: { label: 'מין', type: 'select', options: ['זכר', 'נקבה'] },
            number: { label: 'מספר', type: 'select', options: ['יחיד', 'זוגי', 'רבים'] }
        }
    },
    personalPronoun: {
        name: 'כינוי גוף', nameEn: 'personalPronoun',
        details: {
            person: { label: 'גוף', type: 'select', options: ['גוף ראשון', 'גוף שני', 'גוף שלישי'] },
            gender: { label: 'מין', type: 'select', options: ['זכר', 'נקבה'] },
            number: { label: 'מספר', type: 'select', options: ['יחיד', 'רבים'] },
            definiteness: { label: 'יידוע', type: 'select', options: ['מיודע', 'לא מיודע'] }
        },
        bonus: {
            cases: { label: 'יחסה', type: 'multicheckbox', options: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'], default: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'] }
        }
    },
    relativePronoun: { name: 'שם זיקה', nameEn: 'relativePronoun', details: {} },
    preposition: { name: 'מילית יחס', nameEn: 'preposition', details: {} },
    conjunction: { name: 'מילית חיבור', nameEn: 'conjunction', details: {} },
    subordinating: { name: 'מילית שיעבוד', nameEn: 'subordinating', details: {} },
    negation: { name: 'מילית שלילה', nameEn: 'negation', details: {} },
    questionWord: { name: 'מילת שאלה', nameEn: 'questionWord', details: {} },
    adverb: { name: 'תואר הפועל', nameEn: 'adverb', details: {} },
    jazm: { name: 'מילית מג\'זום', nameEn: 'jazm', details: {} },
    conditional: { name: 'מילית תנאי', nameEn: 'conditional', details: {} },
    mudrika: { name: 'מילית מוצרכת', nameEn: 'mudrika', details: {} }
};

function getHierarchicalPosOptions() {
    return Object.keys(POS_HIERARCHY).map(key => ({
        key, name: POS_HIERARCHY[key].name, nameEn: POS_HIERARCHY[key].nameEn,
        icon: POS_HIERARCHY[key].icon, subTypes: POS_HIERARCHY[key].subTypes
    }));
}

function getPosSubTypes(category) {
    if (!POS_HIERARCHY[category]) return [];
    return Object.keys(POS_HIERARCHY[category].subTypes).map(key => ({
        key, name: POS_HIERARCHY[category].subTypes[key].name,
        nameEn: POS_HIERARCHY[category].subTypes[key].nameEn,
        posKey: POS_HIERARCHY[category].subTypes[key].key
    }));
}

function getPartOfSpeechOptions() {
    const order = ['demonstrative', 'noun', 'verb', 'preposition', 'personalPronoun', 'adjective', 'adverb', 'questionWord'];
    return order.map(key => ({ key, name: PARTS_OF_SPEECH[key].name, nameEn: PARTS_OF_SPEECH[key].nameEn }));
}

function getPartOfSpeechDetails(type) {
    return PARTS_OF_SPEECH[type] ? PARTS_OF_SPEECH[type].details : {};
}

function getPartOfSpeechBonus(type) {
    return PARTS_OF_SPEECH[type] && PARTS_OF_SPEECH[type].bonus ? PARTS_OF_SPEECH[type].bonus : {};
}

function isParticleType(type) {
    return ['preposition', 'conjunction', 'subordinating', 'negation', 'jazm', 'conditional', 'mudrika'].includes(type);
}

function getDefaultDetails(type) {
    if (type === 'noun') return { gender: 'זכר', number: 'יחיד', definiteness: 'מיודע', cases: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'] };
    if (type === 'adjective') return { gender: 'זכר', number: 'יחיד', definiteness: 'מיודע', cases: ['יחסה ראשונה', 'יחסה שנייה', 'יחסה שלישית'] };
    if (type === 'demonstrative') return { gender: 'זכר', number: 'יחיד' };
    return {};
}

function getPartOfSpeechName(type) {
    return PARTS_OF_SPEECH[type] ? PARTS_OF_SPEECH[type].name : type;
}

function getPartOfSpeechColumnIndex(type) {
    const map = { demonstrative: 0, personalPronoun: 0, relativePronoun: 0, noun: 1, adjective: 1, verb: 2, adverb: 2, preposition: 3, conjunction: 3, subordinating: 3, negation: 3, questionWord: 3, jazm: 3, conditional: 3, mudrika: 3 };
    return map[type] !== undefined ? map[type] : 0;
}
