// Combination rules and validation

// Access state via global `state` (StateManager instance)

function checkAdjacency(wordId1, wordId2, words) {
    const index1 = words.findIndex(w => w.id === wordId1);
    const index2 = words.findIndex(w => w.id === wordId2);
    if (index1 === -1 || index2 === -1) return false;
    if (Math.abs(index1 - index2) === 1) return true;

    // Phrase-aware adjacency via BFS through completed combinations
    const span1 = getPhraseSpan(wordId1, words);
    const span2 = getPhraseSpan(wordId2, words);
    return span1.max + 1 === span2.min || span2.max + 1 === span1.min;
}

function getPhraseSpan(wordId, wordsArr) {
    const index = wordsArr.findIndex(w => w.id === wordId);
    let min = index, max = index;
    const combos = (typeof state !== 'undefined') ? state.combinations : [];
    if (!combos.length) return { min, max };

    const visited = new Set([wordId]);
    const queue = [wordId];
    while (queue.length > 0) {
        const currentId = queue.shift();
        const currentIndex = wordsArr.findIndex(w => w.id === currentId);
        combos.forEach(c => {
            if (!c.complete || c.type !== 'valid') return;
            let neighborId = null;
            if (c.wordId1 === currentId) neighborId = c.wordId2;
            else if (c.wordId2 === currentId) neighborId = c.wordId1;
            if (neighborId && !visited.has(neighborId)) {
                const ni = wordsArr.findIndex(w => w.id === neighborId);
                if (Math.abs(currentIndex - ni) === 1) {
                    visited.add(neighborId);
                    queue.push(neighborId);
                    min = Math.min(min, ni);
                    max = Math.max(max, ni);
                }
            }
        });
    }
    return { min, max };
}

function valuesMatch(v1, v2) {
    const a1 = Array.isArray(v1) ? v1 : [v1];
    const a2 = Array.isArray(v2) ? v2 : [v2];
    return a1.some(x => a2.some(y => x === y));
}

function arraysIntersect(a1, a2) {
    if (!Array.isArray(a1) || !Array.isArray(a2)) return false;
    return a1.some(v => a2.includes(v));
}

function calculateDefiniteness(word, pos, words) {
    if (pos.details.suffixPronoun) return 'מיודע';
    return pos.details.definiteness || 'לא מיודע';
}

// Check if a definiteness value counts as "definite"
function isDefinite(defValue) {
    return defValue === 'מיודע' || defValue === 'מיודע בال הידיעה' || defValue === 'מיודע בכינוי שייכות';
}

// Match definiteness: both definite or both indefinite
function definitenessMatch(def1, def2) {
    return isDefinite(def1) === isDefinite(def2);
}

function validateCombination(part1, part2, wordId1, wordId2, words) {
    const type1 = part1.type, type2 = part2.type;

    // Adjacency check
    if (wordId1 && wordId2 && words) {
        if (!checkAdjacency(wordId1, wordId2, words)) {
            return { valid: false, complete: false, message: 'צירוף אפשרי רק בין מילים סמוכות זו לזו', type: 'invalid' };
        }
    }

    // Demonstrative + Noun
    if ((type1 === 'demonstrative' && type2 === 'noun') || (type1 === 'noun' && type2 === 'demonstrative')) {
        return validateDemonstrativeNoun(part1, part2, wordId1, wordId2, words);
    }

    // Noun + Adjective
    if ((type1 === 'noun' && type2 === 'adjective') || (type1 === 'adjective' && type2 === 'noun')) {
        return validateNounAdjective(part1, part2);
    }

    // Noun + Noun (סמיכות)
    if (type1 === 'noun' && type2 === 'noun') {
        return validateNounNoun(part1, part2);
    }

    // Preposition + Noun/Demonstrative (#41: prep at end = incomplete)
    if ((type1 === 'preposition' && (type2 === 'noun' || type2 === 'demonstrative')) ||
        ((type1 === 'noun' || type1 === 'demonstrative') && type2 === 'preposition')) {
        // If preposition is at wordId2 (higher index = leftmost in RTL = end of phrase),
        // it needs a noun after it — mark as incomplete
        if (type2 === 'preposition') {
            // #1241: if the preposition already has its noun (a completed جار ומجرور
            // to its left — higher index), then noun + (prep-phrase) is a valid
            // attributive/predicate combination, NOT "waiting for a noun".
            const prepWordId = wordId2;
            const combos = (typeof state !== 'undefined') ? state.combinations : [];
            const prepIdx = words ? words.findIndex(w => w.id === prepWordId) : -1;
            const prepHasNoun = combos.some(c => {
                if (!c.complete || c.type !== 'valid') return false;
                const isInCombo = c.wordId1 === prepWordId || c.wordId2 === prepWordId;
                if (!isInCombo) return false;
                const otherWordId = c.wordId1 === prepWordId ? c.wordId2 : c.wordId1;
                const otherWord = words ? words.find(w => w.id === otherWordId) : null;
                if (!otherWord) return false;
                const otherIdx = words.findIndex(w => w.id === otherWordId);
                // the مجرور noun sits AFTER the preposition (to the left = higher index)
                if (otherIdx <= prepIdx) return false;
                const otherPosId = c.wordId1 === prepWordId ? c.posId2 : c.posId1;
                const otherPos = otherWord.getPartOfSpeech(otherPosId);
                return otherPos && otherPos.type === 'noun';
            });
            if (prepHasNoun) {
                return { valid: true, complete: true, message: 'צירוף תקין - שם עצם + צירוף מילת יחס', type: 'valid' };
            }
            return { valid: true, complete: false, message: 'מילית היחס מחכה לשם עצם אחריה', type: 'incomplete' };
        }
        const nounPart = (type1 === 'noun' || type1 === 'demonstrative') ? part1 : part2;
        if (nounPart.type === 'noun') {
            return { valid: true, complete: true, message: 'צירוף תקין - מילית יחס + שם עצם', type: 'valid' };
        }
        return { valid: true, complete: false, message: 'צירוף תקין אך לא שלם - חייב להוסיף שם עצם', type: 'incomplete' };
    }

    // Preposition + Adjective — valid if adj is in a completed noun phrase (Fix #18 partial)
    if ((type1 === 'preposition' && type2 === 'adjective') || (type1 === 'adjective' && type2 === 'preposition')) {
        const adjWordId = type1 === 'adjective' ? wordId1 : wordId2;
        const combos = (typeof state !== 'undefined') ? state.combinations : [];
        const adjHasNounPhrase = combos.some(c => {
            if (!c.complete || c.type !== 'valid') return false;
            const isInCombo = c.wordId1 === adjWordId || c.wordId2 === adjWordId;
            if (!isInCombo) return false;
            const otherWordId = c.wordId1 === adjWordId ? c.wordId2 : c.wordId1;
            const otherWord = words ? words.find(w => w.id === otherWordId) : null;
            const otherPosId = c.wordId1 === adjWordId ? c.posId2 : c.posId1;
            const otherPos = otherWord ? otherWord.getPartOfSpeech(otherPosId) : null;
            return otherPos && otherPos.type === 'noun';
        });
        if (adjHasNounPhrase) {
            return { valid: true, complete: true, message: 'צירוף תקין - מילית יחס + צירוף שמני', type: 'valid' };
        }
        // Fix #18: adj+prep without noun phrase = incomplete (yellow), not rejected
        return { valid: true, complete: false, message: 'שם תואר + מילית יחס — מחכה לשם עצם להשלמת צירוף', type: 'incomplete' };
    }

    // Adjective + Adjective — not defined
    // Other combinations — not defined
    return { valid: false, complete: false, message: 'צירוף זה לא מוגדר עדיין במערכת', type: 'unknown' };
}

function validateDemonstrativeNoun(part1, part2, wordId1, wordId2, words) {
    const demo = part1.type === 'demonstrative' ? part1 : part2;
    const noun = part1.type === 'noun' ? part1 : part2;

    if (!valuesMatch(demo.details.gender, noun.details.gender)) {
        return { valid: false, complete: false, message: 'חוסר התאמה במין בין כינוי הרמז לשם העצם', type: 'invalid' };
    }
    if (!valuesMatch(demo.details.number, noun.details.number)) {
        return { valid: false, complete: false, message: 'חוסר התאמה במספר בין כינוי הרמז לשם העצם', type: 'invalid' };
    }

    // Definiteness filter
    const nounDef = calculateDefiniteness(
        words ? words.find(w => w.id === (part1.type === 'noun' ? wordId1 : wordId2)) : null,
        noun, words || []
    );
    if (nounDef === 'לא מיודע') {
        return { valid: false, complete: false, message: 'מה אומר לנו סטטוס הלא-מיודע על מבנה המשפט? האם זה צירוף או משפט?', type: 'invalid', isDemonstrative: true };
    }
    return { valid: true, complete: true, message: 'צירוף תקין - כינוי רמז + שם עצם', type: 'valid', isDemonstrative: true };
}

function validateNounAdjective(part1, part2) {
    const noun = part1.type === 'noun' ? part1 : part2;
    const adj = part1.type === 'adjective' ? part1 : part2;

    // רשמב"א: non-human plural noun requires feminine singular adjective
    const isPlural = noun.details.number === 'רבים' || noun.details.number === 'רבות';
    const isNonHumanPlural = isPlural && noun.details.isHuman === false;
    if (isNonHumanPlural) {
        // Adjective must be feminine singular (יחידה or נקבה+יחיד)
        const adjIsFemSingular = (adj.details.gender === 'נקבה') &&
            (adj.details.number === 'יחיד' || adj.details.number === 'יחידה');
        if (adj.details.gender && adj.details.number && !adjIsFemSingular) {
            return { valid: false, complete: false, message: 'רשמב"א — ריבוי שאינו מציין בני אדם דורש שם תואר נקבה יחידה', type: 'invalid' };
        }
        // Skip gender/number mismatch check for רשמב"א — only check definiteness + cases
        const defMismatch = (noun.details.definiteness && adj.details.definiteness) ?
            !definitenessMatch(noun.details.definiteness, adj.details.definiteness) : false;
        if (!noun.details.definiteness || !adj.details.definiteness) {
            return { valid: false, complete: false, message: 'חסרים פרטים נדרשים (יידוע)', type: 'incomplete' };
        }
        if (defMismatch) {
            return { valid: false, complete: false, message: 'חוסר התאמה ביידוע', type: 'invalid' };
        }
        return { valid: true, complete: true, message: 'צירוף תקין — רשמב"א (ריבוי לא בני אדם + נקבה יחידה)', type: 'valid' };
    }

    const fields = ['gender', 'number', 'definiteness'];
    const mismatches = [];

    for (const f of fields) {
        if (noun.details[f] && adj.details[f]) {
            if (f === 'definiteness') {
                if (!definitenessMatch(noun.details[f], adj.details[f])) mismatches.push(f);
            } else {
                if (!valuesMatch(noun.details[f], adj.details[f])) mismatches.push(f);
            }
        } else if (!noun.details[f] || !adj.details[f]) {
            return { valid: false, complete: false, message: `חסרים פרטים נדרשים (${f})`, type: 'incomplete' };
        }
    }

    // Check cases
    const nc = noun.details.cases || noun.details.case;
    const ac = adj.details.cases || adj.details.case;
    if (nc && ac) {
        if (!arraysIntersect(Array.isArray(nc) ? nc : [nc], Array.isArray(ac) ? ac : [ac])) mismatches.push('cases');
    }

    if (mismatches.length > 0) {
        const names = { gender: 'מין', number: 'מספר', definiteness: 'יידוע', cases: 'יחסה' };
        return { valid: false, complete: false, message: `חוסר התאמה ב${mismatches.map(f => names[f] || f).join(', ')}`, type: 'invalid' };
    }
    return { valid: true, complete: true, message: 'צירוף תקין - מימי תואמים', type: 'valid' };
}

function validateNounNoun(part1, part2) {
    // In smichut, the first noun (נסמך) must be morphologically indefinite
    if (isDefinite(part1.details.definiteness)) {
        return { valid: true, complete: false, message: 'תבנית סמיכות — אבל הנסמך מיודע (בסמיכות הנסמך לא מיודע)', type: 'incomplete' };
    }
    if (!part1.details.definiteness) {
        return { valid: true, complete: false, message: 'תבנית סמיכות — חסר יידוע בנסמך', type: 'incomplete' };
    }
    return { valid: true, complete: true, message: 'צירוף תקין - תבנית סמיכות', type: 'valid' };
}

function getCombinationTypeDescription(part1, part2) {
    const t1 = part1.type, t2 = part2.type;
    if ((t1 === 'noun' && t2 === 'adjective') || (t1 === 'adjective' && t2 === 'noun')) return 'שם עצם + שם תואר';
    if (t1 === 'noun' && t2 === 'noun') return 'שם עצם + שם עצם (סמיכות)';
    if ((t1 === 'preposition' && t2 === 'demonstrative') || (t1 === 'demonstrative' && t2 === 'preposition')) return 'מילית יחס + כינוי רמז';
    return 'צירוף אחר';
}
