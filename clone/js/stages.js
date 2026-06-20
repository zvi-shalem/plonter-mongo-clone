// Stages/Sentences data structure

const STAGES = {
    workbook: [
        { id: '1.1', number: '1.1', sentence: 'لم تنشر الحكومة كلام رئيس البلدية في الجريدة الجديدة', category: 'workbook' },
        { id: '1.6', number: '1.6', sentence: 'متى بحث الوزراء الجدد في وضع سيارتي الرئيس؟', category: 'workbook' },
        { id: '1.8', number: '1.8', sentence: 'في هذا القصر التقى امس الوزيران في محاولة لايجاد حل للازمة', category: 'workbook' },
        { id: '2.1', number: '2.1', sentence: 'حضر معلمونا الجلسة وهذه مطالبهم', category: 'workbook' },
        { id: '2.3', number: '2.3', sentence: 'هذا الحصار قرصنة دولية واضحة', category: 'workbook' },
        { id: '2.4', number: '2.4', sentence: 'في هذه اللجنة قاض مشهور', category: 'workbook' },
        { id: '2.9', number: '2.9', sentence: 'على شفتيه ابتسام مطبوع وفي عينيه بريق ساذج', category: 'workbook' },
        { id: '2.12', number: '2.12', sentence: 'من ابرز ظاهرات الشخصية اللبنانية ظاهرة الانتفاد', category: 'workbook' },
        { id: '2.13', number: '2.13', sentence: 'التقدم العلمي جوهره تحرر المجتمع من الوهم والجهل', category: 'workbook' },
        { id: '3.2', number: '3.2', sentence: 'يعرف الجميع ان هذه الدولة هي اغنى دول العالم.', category: 'workbook' },
        { id: '3.17', number: '3.17', sentence: 'في راي المراقبين ان ازمة الشرق الاوسط ينبغي ان يبحث فيها الرئيسان في اجتماعهما القريب.', category: 'workbook' },
        { id: 'extra', number: 'extra', sentence: 'بلغني انه ابتداء من اليوم تزداد اجور السفر في جميع طائرات هذه الشريكة', category: 'workbook' }
    ],
    midterm: [
        { id: '1', number: '1', sentence: 'ثقوا بانفسكم، غالبا هذا هو الفرق بين الفشل والنخاح', category: 'midterm' }
    ],
    hindus: [
        { id: 'h1', number: 'ריבוי שלם זכר', sentence: 'המורים החדשים הגיעו לבית הספר', category: 'hindus', tags: ['רש"ז', 'פל"נ'], answer: 'وَصَلَ المُعَلِّمُونَ الجُدُدُ إلَى المَدْرَسَةِ' },
        { id: 'h2', number: 'ריבוי שלם נקבה', sentence: 'המורות החדשות עובדות בבית הספר הגדול', category: 'hindus', tags: ['רש"נ'], answer: 'تَشْتَغِلُ المُعَلِّمَاتُ الجَدِيدَاتُ فِي المَدْرَسَةِ الكَبِيرَةِ' },
        { id: 'h3', number: 'זוגי', sentence: 'שני השרים נפגשו בשתי הבירות', category: 'hindus', tags: ['זוגי', 'פל"נ'], answer: 'اِلْتَقَى الوَزِيرَانِ فِي العَاصِمَتَيْنِ' },
        { id: 'h4', number: 'סמיכות', sentence: 'מנהל בית ספר הכפר הגיע למשרד שר החינוך', category: 'hindus', tags: ['סמיכות', 'פל"נ'], answer: 'وَصَلَ مُدِيرُ مَدْرَسَةِ القَرْيَةِ إلَى مَكْتَبِ وَزِيرِ التَّرْبِيَةِ' },
        { id: 'h5', number: 'אן ואחיותיה', sentence: 'אכן התלמידים חרוצים אבל המבחנים קשים', category: 'hindus', tags: ['אן ואחיותיה'], answer: 'إِنَّ الطُّلَّابَ مُجْتَهِدُونَ لَكِنَّ الاِمْتِحَانَاتِ صَعْبَةٌ' },
        { id: 'h6', number: 'كان ואחיותיה', sentence: 'מזג האוויר היה יפה והתלמידים הפכו לשמחים', category: 'hindus', tags: ['كان ואחיותיה'], answer: 'كَانَ الجَوُّ جَمِيلًا وَأَصْبَحَ الطُّلَّابُ سُعَدَاءَ' },
        { id: 'h7', number: 'פועל לפני נושא', sentence: 'התלמידים הגיעו לבית הספר והמורה התחיל את השיעור', category: 'hindus', tags: ['פל"נ'], answer: 'وَصَلَ الطُّلَّابُ إلَى المَدْرَسَةِ وَبَدَأَ المُعَلِّمُ الدَّرْسَ' },
        { id: 'h8', number: 'רשמב"א', sentence: 'הספרים החדשים האלה מועילים ובתי הספר הגדולים ההם קרובים', category: 'hindus', tags: ['רשמב"א'], answer: 'هَذِهِ الكُتُبُ الجَدِيدَةُ مُفِيدَةٌ وَتِلْكَ المَدَارِسُ الكَبِيرَةُ قَرِيبَةٌ' },
        { id: 'h9', number: 'סמיכות + רש"ז + זוגי', sentence: 'מנהלי בתי הספר הגיעו לישיבת שני השרים', category: 'hindus', tags: ['סומך', 'רש"ז', 'זוגי', 'פל"נ'], answer: 'وَصَلَ مُدِيرُو المَدَارِسِ إلَى جَلْسَةِ الوَزِيرَيْنِ' },
        { id: 'h10', number: 'יחסה שנייה + רש"נ', sentence: 'ראיתי את המורות החדשות בבתי הספר הגדולים', category: 'hindus', tags: ['רש"נ', 'שנייה بُ', 'סומך'], answer: 'رَأَيْتُ المُعَلِّمَاتِ الجَدِيدَاتِ فِي المَدَارِسِ الكَبِيرَةِ' },
        { id: 'h11', number: 'יחסה שנייה + רשמב"א', sentence: 'קראתי את הספרים החדשים האלה ושמעתי על ההרצאות הטובות ההן', category: 'hindus', tags: ['רשמב"א', 'שנייה بُ'], answer: 'قَرَأْتُ هَذِهِ الكُتُبَ الجَدِيدَةَ وَسَمِعْتُ عَنْ تِلْكَ المُحَاضَرَاتِ الجَيِّدَةِ' }
    ],
    persian: [
        { id: 'p1', number: 'משפט פשוט', sentence: 'دانش‌آموزان کتاب‌های جدید را خواندند', category: 'פרסית' },
        { id: 'p2', number: 'נושא+נשוא+מושא', sentence: 'معلم درس تاریخ را به دانش‌آموزان توضیح داد', category: 'פרסית' },
        { id: 'p3', number: 'פסוקית מושא', sentence: 'همه می‌دانند که این شهر زیباترین شهر کشور است', category: 'פרסית' },
        { id: 'p4', number: 'פסוקית זיקה', sentence: 'کتابی که دیروز خریدم بسیار جالب بود', category: 'פרסית' },
        { id: 'p5', number: 'פסוקית תנאי', sentence: 'اگر فردا هوا خوب باشد به پارک می‌رویم', category: 'פרסית' },
        { id: 'p6', number: 'נשוא שמני', sentence: 'این دانشگاه یکی از بهترین دانشگاه‌های کشور است', category: 'פרסית' },
        { id: 'p7', number: 'תיאורים', sentence: 'دیروز در کتابخانه با دوستم درباره امتحان صحبت کردم', category: 'פרסית' },
        { id: 'p8', number: 'פסוקית לוואי', sentence: 'پسری که کنار پنجره نشسته بود دوست من است', category: 'פרסית' }
    ]
};

// Custom sentences stored in localStorage (#26)
function getCustomStages() {
    try {
        const raw = localStorage.getItem('plonter_custom_stages');
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveCustomStages(stages) {
    // Diff against what's already on disk so we only auto-queue truly
    // changed sentences for sync — same pattern as lessons/texts.
    let changedIds = [];
    try {
        const prev = JSON.parse(localStorage.getItem('plonter_custom_stages') || '[]');
        const prevMap = {};
        for (const p of prev) if (p && p.id) prevMap[p.id] = p;
        const strip = (s) => {
            const c = {};
            for (const k in s) if (Object.prototype.hasOwnProperty.call(s, k) && k !== 'lastAccessed') c[k] = s[k];
            return c;
        };
        for (const n of stages || []) {
            if (!n || !n.id) continue;
            const p = prevMap[n.id];
            if (!p) { changedIds.push(n.id); continue; }
            if (JSON.stringify(strip(p)) !== JSON.stringify(strip(n))) changedIds.push(n.id);
        }
    } catch (_) { changedIds = (stages || []).map(s => s && s.id).filter(Boolean); }

    localStorage.setItem('plonter_custom_stages', JSON.stringify(stages));

    // Skip hindus items until @3 coordination — my 2026-04-19 04:25 ping.
    // Syntax-only sync for now; hindus rides the same store and will
    // flip on once @3 ACKs.
    if (!changedIds.length) return;
    if (typeof ContentSync === 'undefined' ||
        typeof ContentSync.save !== 'function' ||
        typeof ContentSync.isLoggedIn !== 'function' ||
        !ContentSync.isLoggedIn()) return;
    let queuedSync = false;
    for (const id of changedIds) {
        const s = stages.find(x => x.id === id);
        if (!s) continue;
        if (s._isBuiltinSeed === true) continue; // never push built-in seeds
        if (s._createdAsGuest === true) {
            // Guest-created: needs opt-in via backup popup / ☁️ before
            // auto-sync kicks in. Same rule as lessons/texts.
            let hasMeta = false;
            try { hasMeta = !!(ContentSync.isSynced && ContentSync.isSynced('sentence', s.id)); } catch (_) {}
            if (!hasMeta) continue;
        }
        try {
            ContentSync.save('sentence', s.id, s);
            queuedSync = true;
        }
        catch (e) { console.warn('[stages] ContentSync.save threw', e); }
    }
    if (queuedSync && typeof ContentSync.processQueue === 'function') {
        try { ContentSync.processQueue(); }
        catch (e) { console.warn('[stages] ContentSync.processQueue threw', e); }
    }
}

function deleteCustomStage(id) {
    const beforeDelete = getCustomStages().find(s => s && s.id === id);
    if (beforeDelete && beforeDelete._createdAsGuest === true) {
        try {
            const raw = localStorage.getItem('plonter_sentence_guest_backup_handled_v1') || '[]';
            const handled = JSON.parse(raw) || [];
            const seen = {};
            handled.forEach(x => { if (x) seen[String(x)] = true; });
            seen['stage:' + String(id)] = true;
            localStorage.setItem('plonter_sentence_guest_backup_handled_v1', JSON.stringify(Object.keys(seen)));

            const backups = JSON.parse(localStorage.getItem('plonter_sentence_guest_backup_v1') || '[]') || [];
            const kept = backups.filter(entry => !(entry && entry.stage && String(entry.stage.id) === String(id)));
            if (kept.length) localStorage.setItem('plonter_sentence_guest_backup_v1', JSON.stringify(kept));
            else localStorage.removeItem('plonter_sentence_guest_backup_v1');
        } catch (_) {}
    }
    // Tear down server copy so a later pullAll doesn't resurrect the
    // deleted sentence. Fire-and-forget; local delete proceeds regardless.
    // Hindus items sync just like syntax now (Amitai 2026-04-19 05:20).
    if (typeof ContentSync !== 'undefined' && typeof ContentSync.deleteItem === 'function') {
        try { ContentSync.deleteItem('sentence', id).catch(e => console.warn('[stages] server delete failed', e)); }
        catch (_) {}
    }
    const customs = getCustomStages().filter(s => s.id !== id);
    saveCustomStages(customs);
}

function updateCustomStage(id, updates) {
    const customs = getCustomStages();
    const idx = customs.findIndex(s => s.id === id);
    if (idx === -1) return null;
    Object.assign(customs[idx], updates, { updated: new Date().toISOString() });
    saveCustomStages(customs);
    return customs[idx];
}

function addCustomStage(name, sentence, category, diacritizedSentence, answer, tags, isHindus) {
    const customs = getCustomStages();
    const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    const stage = {
        id, number: name, sentence, category: category || 'custom',
        isCustom: true,
        source_domain: isHindus ? 'hindus' : 'analysis',
        created: now,
        updated: now
    };
    if (diacritizedSentence && diacritizedSentence !== sentence) {
        stage.diacritizedSentence = diacritizedSentence;
    }
    if (answer) stage.answer = answer;
    if (tags && tags.length > 0) stage.tags = tags;
    if (isHindus) stage.isHindus = true;
    // Stamp guest-mode origin so auto-sync leaves it alone until the user
    // opts in via a manual backup. Same pattern as lessons/texts.
    const _loggedIn = typeof ContentSync !== 'undefined' &&
        typeof ContentSync.isLoggedIn === 'function' && ContentSync.isLoggedIn();
    if (!_loggedIn) stage._createdAsGuest = true;
    customs.push(stage);
    saveCustomStages(customs);
    return stage;
}

// Strip Arabic diacritics for display
function stripArabicDiacritics(text) {
    // Arabic diacritics: Fathatan ً Dammatan ٌ Kasratan ٍ Fatha َ Damma ُ Kasra ِ Shadda ّ Sukun ْ
    // Also normalize alef variants (أ إ آ ٱ) to bare alef (ا) (#34)
    return text.replace(/[\u064B-\u0652\u0670]/g, '').replace(/[أإآٱ]/g, 'ا');
}

function getAllStages() {
    return [...getCustomStages(), ...STAGES.workbook, ...STAGES.midterm, ...STAGES.hindus];
}

function getStageById(stageId) {
    return getAllStages().find(s => s.id === stageId);
}

function searchStages(query) {
    const lower = query.toLowerCase();
    return getAllStages().filter(s => s.number.includes(query) || s.sentence.toLowerCase().includes(lower));
}
