// DetailsPanel — POS details forms, auto-save, gender/number selector

// Hebrew-to-Arabic letter mapping (#35)
const HEBREW_TO_ARABIC = {
    'א': 'ا', 'ב': 'ب', 'ג': 'ج', 'ד': 'د', 'ה': 'ه', 'ו': 'و', 'ז': 'ز',
    'ח': 'ح', 'ט': 'ط', 'י': 'ي', 'כ': 'ك', 'ך': 'ك', 'ל': 'ل', 'מ': 'م',
    'ם': 'م', 'נ': 'ن', 'ן': 'ن', 'ס': 'س', 'ע': 'ع', 'פ': 'ف', 'ף': 'ف',
    'צ': 'ص', 'ץ': 'ص', 'ק': 'ق', 'ר': 'ر', 'ש': 'ش', 'ת': 'ت'
};

// Geresh special letters (#36): letter + ' → special Arabic letter
const GERESH_MAP = {
    'א': 'ء', 'ה': 'ة', 'ח': 'خ', 'ד': 'ذ', 'צ': 'ض', 'ץ': 'ض', 'ט': 'ظ', 'ע': 'غ', 'ת': 'ث', 'י': 'ئ', 'ו': 'ؤ'
};
const DOUBLE_GERESH_MAP = { 'ئ': 'ى' }; // י'' → ى (double geresh)

// Arabic-to-Arabic geresh: Arabic base letter + ' → upgraded Arabic letter
const ARABIC_GERESH_MAP = {
    'ه': 'ة', 'د': 'ذ', 'ح': 'خ', 'ص': 'ض', 'ط': 'ظ', 'ع': 'غ', 'ت': 'ث',
    'ي': 'ئ', 'و': 'ؤ', 'ا': 'ء', 'أ': 'ء', 'ئ': 'ى'
};

// Reverse mapping: Arabic → Hebrew (for toggling back)
const ARABIC_TO_HEBREW = {};
Object.keys(HEBREW_TO_ARABIC).forEach(function(h) {
    var a = HEBREW_TO_ARABIC[h];
    if (!ARABIC_TO_HEBREW[a]) ARABIC_TO_HEBREW[a] = h; // first mapping wins
});
// Geresh reverse: special Arabic letter → Hebrew + geresh
const GERESH_REVERSE = {};
Object.keys(GERESH_MAP).forEach(function(h) {
    var a = GERESH_MAP[h];
    if (!GERESH_REVERSE[a]) GERESH_REVERSE[a] = h + "'";
});
// Double geresh reverse: ى → י''
Object.keys(DOUBLE_GERESH_MAP).forEach(function(single) {
    var dbl = DOUBLE_GERESH_MAP[single];
    // Find which Hebrew letter maps to 'single' in GERESH_MAP
    Object.keys(GERESH_MAP).forEach(function(h) {
        if (GERESH_MAP[h] === single) GERESH_REVERSE[dbl] = h + "''";
    });
});

const DetailsPanel = {
    _state: null,
    _currentWordId: null,
    _currentPosId: null,

    init(stateManager) {
        this._state = stateManager;
    },

    open(wordId, posId) {
        const s = this._state;
        const word = s.words.find(w => w.id === wordId);
        if (!word) return;
        const pos = word.getPartOfSpeech(posId);
        if (!pos) return;

        this._currentWordId = wordId;
        this._currentPosId = posId;

        const panel = document.getElementById('details-panel');
        const title = document.getElementById('details-panel-title');
        const form = document.getElementById('details-panel-form');

        title.textContent = `${getPartOfSpeechName(pos.type)} — ${word.text}`;
        form.innerHTML = '';

        const details = getPartOfSpeechDetails(pos.type);
        const bonus = getPartOfSpeechBonus(pos.type);
        const saved = pos.details || {};

        // Build form based on POS type
        if (pos.type === 'noun' || pos.type === 'adjective' || pos.type === 'demonstrative') {
            this._buildGenderNumberSelector(form, saved);
            if (details.definiteness) {
                this._buildDefinitenessSelector(form, saved.definiteness || 'מיודע', pos.type);
            }
            if (pos.type === 'noun') {
                this._buildHumanToggle(form, saved.isHuman || false);
            }
        } else if (pos.type === 'personalPronoun') {
            this._buildSelectField(form, 'person', details.person, saved.person);
            this._buildGenderNumberSelector(form, saved);
            if (details.definiteness) {
                this._buildDefinitenessSelector(form, saved.definiteness || 'מיודע', pos.type);
            }
        } else if (pos.type === 'verb') {
            this._buildVerbForm(form, details, saved);
        }

        // Bonus fields (cases)
        Object.keys(bonus).forEach(key => {
            const def = bonus[key];
            if (def.type === 'multicheckbox') {
                this._buildMultiCheckbox(form, key, def, saved[key] || def.default || []);
            }
        });

        // #1246: red "מחק" button at the bottom of the details panel.
        this._ensureDeletePosButton();

        panel.scrollTop = 0;
        panel.classList.add('show');
        document.body.classList.add('panel-open');
    },

    // #1246 (Amitai): a red "מחק" button at the bottom of the POS details panel.
    // Clicking it asks for confirmation ("בטוח?") and, on approval, removes the
    // current POS (and its combinations, via state.removePartOfSpeech). Injected
    // here (idempotent) rather than in index.html. Reads the live current
    // word/POS ids at click time, so one button serves every open() call.
    _ensureDeletePosButton() {
        const content = document.querySelector('#details-panel .details-panel-content');
        if (!content) return;
        if (document.getElementById('delete-pos-btn')) return;
        const actions = content.querySelector('.details-panel-actions');
        const btn = document.createElement('button');
        btn.id = 'delete-pos-btn';
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = '🗑️ מחק';
        btn.title = 'מחק חלק דיבר זה';
        btn.style.cssText = 'display:block;width:100%;margin-top:10px;background:#dc2626;color:#fff;border:none;font-weight:bold';
        btn.addEventListener('click', () => {
            if (!this._currentWordId || !this._currentPosId) return;
            const wId = this._currentWordId, pId = this._currentPosId;
            const combCount = this._state.combinations.filter(c =>
                (c.wordId1 === wId && c.posId1 === pId) ||
                (c.wordId2 === wId && c.posId2 === pId)
            ).length;
            const msg = combCount > 0
                ? 'מחיקת חלק-הדיבר תמחק גם את כל הצירופים שלו (' + combCount + ' צירופים). להמשיך?'
                : 'בטוח שברצונך למחוק את חלק הדיבר?';
            if (!confirm(msg)) return;
            this.close(true);
            this._state.removePartOfSpeech(wId, pId);
            if (typeof Renderer !== 'undefined') Renderer.renderAll();
            this._showPosDeleteToast();
        });
        // Place it at the very bottom, after the save/cancel row.
        if (actions && actions.nextSibling) {
            content.insertBefore(btn, actions.nextSibling);
        } else {
            content.appendChild(btn);
        }
    },

    close(forceClose) {
        if (!forceClose && this._hasUnsavedChanges()) {
            this.save();
            return;
        }
        const panel = document.getElementById('details-panel');
        panel.classList.remove('show');
        document.body.classList.remove('panel-open');
        this._currentWordId = null;
        this._currentPosId = null;
    },

    save() {
        if (!this._currentWordId || !this._currentPosId) return;
        const s = this._state;
        const word = s.words.find(w => w.id === this._currentWordId);
        if (!word) return;
        const pos = word.getPartOfSpeech(this._currentPosId);
        if (!pos) return;

        const newDetails = {};

        // Gender/Number from grid selector
        const gnGroup = document.querySelector('[data-field-key="gender_number"]');
        if (gnGroup) {
            const selected = gnGroup.querySelector('.gender-number-cell-btn.selected');
            if (selected) {
                newDetails.gender = selected.dataset.gender;
                newDetails.number = selected.dataset.number;
            } else {
                newDetails.gender = 'זכר';
                newDetails.number = 'יחיד';
            }
        }

        // Definiteness — read from whichever .def-btn is selected
        const selectedDefBtn = document.querySelector('.def-btn.selected');
        if (selectedDefBtn) {
            newDetails.definiteness = selectedDefBtn.dataset.value || selectedDefBtn.textContent;
        }

        // Person (for pronouns)
        const personInput = document.getElementById('detail_person');
        if (personInput && personInput.value) newDetails.person = personInput.value;

        // Verb fields
        if (pos.type === 'verb') {
            this._saveVerbFields(newDetails);
        }

        // Human toggle (nouns)
        const humanToggle = document.getElementById('detail_isHuman');
        if (humanToggle) {
            newDetails.isHuman = humanToggle.checked;
        }

        // Bonus: cases
        const bonusStructure = getPartOfSpeechBonus(pos.type);
        Object.keys(bonusStructure).forEach(key => {
            if (bonusStructure[key].type === 'multicheckbox') {
                const vals = [];
                bonusStructure[key].options.forEach(opt => {
                    const cb = document.getElementById(`detail_${key}_${opt}`);
                    if (cb && cb.checked) vals.push(opt);
                });
                if (vals.length > 0) newDetails[key] = vals;
            }
        });

        s.updatePartOfSpeechDetails(this._currentWordId, this._currentPosId, newDetails);
        MessageManager.show('הפרטים נשמרו', 'info', 2000);
        this.close(true);
        Renderer.renderAll();
    },

    _hasUnsavedChanges() {
        if (!this._currentWordId || !this._currentPosId) return false;
        // Simple heuristic: always auto-save if panel is open
        return true;
    },

    // --- Form builders ---

    _buildGenderNumberSelector(container, saved) {
        const group = document.createElement('div');
        group.className = 'form-group';
        group.dataset.fieldKey = 'gender_number';

        const label = document.createElement('label');
        label.textContent = 'מין ומספר';
        group.appendChild(label);

        const table = document.createElement('table');
        table.className = 'gender-number-table-2x3';

        // Header
        const thead = document.createElement('tr');
        thead.innerHTML = '<th></th><th>זכר</th><th>נקבה</th>';
        table.appendChild(thead);

        const rows = [
            { num: 'יחיד', mLabel: 'יחיד', fLabel: 'יחידה', fNum: 'יחידה', mSym: '👔', fSym: '🎀' },
            { num: 'זוגי', mLabel: 'זוגי', fLabel: 'זוגי', fNum: 'זוגי', mSym: '👔👔', fSym: '🎀🎀' },
            { num: 'רבים', mLabel: 'רבים', fLabel: 'רבות', fNum: 'רבות', mSym: '👔👔👔👔👔', fSym: '🎀🎀🎀🎀🎀' }
        ];

        const currentGender = saved.gender || 'זכר';
        const currentNumber = saved.number || 'יחיד';

        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td class="number-header">${r.num === 'רבים' ? 'ריבוי' : r.num}</td>`;

            // Male cell
            const maleCell = document.createElement('td');
            const maleBtn = document.createElement('button');
            maleBtn.type = 'button';
            maleBtn.className = 'gender-number-cell-btn';
            maleBtn.dataset.gender = 'זכר';
            maleBtn.dataset.number = r.num;
            maleBtn.innerHTML = `<span class="symbol">${r.mSym}</span><span class="label-text">${r.mLabel}</span>`;
            if (currentGender === 'זכר' && currentNumber === r.num) maleBtn.classList.add('selected');
            maleBtn.addEventListener('click', () => {
                group.querySelectorAll('.gender-number-cell-btn').forEach(b => b.classList.remove('selected'));
                maleBtn.classList.add('selected');
                this._scrollToNextFormGroup(group);
            });
            maleCell.appendChild(maleBtn);
            tr.appendChild(maleCell);

            // Female cell
            const femaleCell = document.createElement('td');
            const femaleBtn = document.createElement('button');
            femaleBtn.type = 'button';
            femaleBtn.className = 'gender-number-cell-btn';
            femaleBtn.dataset.gender = 'נקבה';
            femaleBtn.dataset.number = r.fNum || r.num;
            femaleBtn.innerHTML = `<span class="symbol">${r.fSym}</span><span class="label-text">${r.fLabel}</span>`;
            if (currentGender === 'נקבה' && currentNumber === (r.fNum || r.num)) femaleBtn.classList.add('selected');
            femaleBtn.addEventListener('click', () => {
                group.querySelectorAll('.gender-number-cell-btn').forEach(b => b.classList.remove('selected'));
                femaleBtn.classList.add('selected');
                this._scrollToNextFormGroup(group);
            });
            femaleCell.appendChild(femaleBtn);
            tr.appendChild(femaleCell);

            table.appendChild(tr);
        });

        group.appendChild(table);
        container.appendChild(group);
    },

    _buildDefinitenessSelector(container, current, posType) {
        const group = document.createElement('div');
        group.className = 'form-group';

        const label = document.createElement('label');
        label.textContent = 'יידוע';
        group.appendChild(label);

        const btns = document.createElement('div');
        btns.className = 'definiteness-buttons';
        btns.style.flexWrap = 'wrap';

        // Nouns get 3 options; adjectives/others get 2
        const isNoun = posType === 'noun';
        const options = isNoun
            ? [
                { value: 'מיודע בال הידיעה', label: 'מיודע בال' },
                { value: 'מיודע בכינוי שייכות', label: 'מיודע בכינוי' },
                { value: 'נסמך', label: 'נסמך' },
                { value: 'לא מיודע', label: 'לא מיודע' }
              ]
            : [
                { value: 'מיודע', label: 'מיודע' },
                { value: 'נסמך', label: 'נסמך' },
                { value: 'לא מיודע', label: 'לא מיודע' }
              ];

        // Normalize old 'מיודע' to first definite option for nouns
        let currentNorm = current;
        if (isNoun && current === 'מיודע') currentNorm = 'מיודע בال הידיעה';

        const allBtns = [];
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'def-btn' + (currentNorm === opt.value ? ' selected' : '');
            btn.dataset.value = opt.value;
            btn.textContent = opt.label;
            btn.addEventListener('click', () => {
                allBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this._scrollToNextFormGroup(group);
            });
            allBtns.push(btn);
            btns.appendChild(btn);
        });

        group.appendChild(btns);
        container.appendChild(group);
    },

    _buildHumanToggle(container, current) {
        const group = document.createElement('div');
        group.className = 'form-group';
        group.style.cssText = 'display:flex;gap:0;margin:8px 0';
        // Hidden checkbox for save logic
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'detail_isHuman';
        cb.checked = !!current;
        cb.style.display = 'none';
        group.appendChild(cb);
        // Binary toggle buttons
        const humanBtn = document.createElement('button');
        humanBtn.type = 'button';
        humanBtn.textContent = 'מציין בני אדם';
        humanBtn.style.cssText = 'flex:1;padding:10px 8px;font-size:1em;font-weight:bold;border:2px solid #d1d5db;border-radius:0 10px 10px 0;cursor:pointer;font-family:inherit;transition:all 0.2s';
        const nonHumanBtn = document.createElement('button');
        nonHumanBtn.type = 'button';
        nonHumanBtn.textContent = 'לא מציין בני אדם';
        nonHumanBtn.style.cssText = 'flex:1;padding:10px 8px;font-size:1em;font-weight:bold;border:2px solid #d1d5db;border-left:none;border-radius:10px 0 0 10px;cursor:pointer;font-family:inherit;transition:all 0.2s';
        const updateStyle = () => {
            if (cb.checked) {
                humanBtn.style.background = '#0d9488'; humanBtn.style.color = 'white'; humanBtn.style.borderColor = '#0d9488';
                nonHumanBtn.style.background = 'white'; nonHumanBtn.style.color = '#6b7280'; nonHumanBtn.style.borderColor = '#d1d5db';
            } else {
                nonHumanBtn.style.background = '#f59e0b'; nonHumanBtn.style.color = 'white'; nonHumanBtn.style.borderColor = '#f59e0b';
                humanBtn.style.background = 'white'; humanBtn.style.color = '#6b7280'; humanBtn.style.borderColor = '#d1d5db';
            }
        };
        // תחביר #14: after picking human/non-human, reveal the "שמור" button.
        // The scrollable container is .details-panel (max-height:60vh; overflow-y:auto),
        // NOT .details-panel-content — the old code scrolled the wrong element.
        // scrollIntoView on the save button itself is the most reliable target.
        const scrollSaveIntoView = () => {
            setTimeout(() => {
                const saveBtn = document.getElementById('save-details-btn');
                if (saveBtn) saveBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 100);
        };
        humanBtn.addEventListener('click', (e) => { e.preventDefault(); cb.checked = true; updateStyle(); scrollSaveIntoView(); });
        nonHumanBtn.addEventListener('click', (e) => { e.preventDefault(); cb.checked = false; updateStyle(); scrollSaveIntoView(); });
        updateStyle();
        group.appendChild(humanBtn);
        group.appendChild(nonHumanBtn);
        container.appendChild(group);
    },

    _buildSelectField(container, key, def, current) {
        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.textContent = def.label;
        group.appendChild(label);
        const select = document.createElement('select');
        select.id = `detail_${key}`;
        select.className = 'form-control';
        def.options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (opt === current) o.selected = true;
            select.appendChild(o);
        });
        group.appendChild(select);
        container.appendChild(group);
    },

    _buildVerbForm(container, details, saved) {
        // Root (#34: multiple roots with + button, #35/#36: Hebrew-Arabic conversion)
        if (details.root) {
            const group = document.createElement('div');
            group.className = 'form-group';
            group.dataset.fieldKey = 'root';
            const label = document.createElement('label');
            label.textContent = 'שורש';
            group.appendChild(label);

            const rootsContainer = document.createElement('div');
            rootsContainer.className = 'roots-container';
            rootsContainer.id = 'roots-container';

            const existingRoots = Array.isArray(saved.root) ? saved.root : (saved.root ? [saved.root] : ['']);
            existingRoots.forEach((rootVal, idx) => {
                this._addRootInput(rootsContainer, rootVal, idx);
            });
            group.appendChild(rootsContainer);

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'add-root-btn';
            addBtn.textContent = '+';
            addBtn.title = 'הוסף שורש אפשרי נוסף';
            addBtn.addEventListener('click', () => {
                const idx = rootsContainer.children.length;
                this._addRootInput(rootsContainer, '', idx);
            });
            group.appendChild(addBtn);
            container.appendChild(group);
        }

        // Binyan (verb forms)
        if (details.binyan) {
            const group = document.createElement('div');
            group.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = 'בניין';
            group.appendChild(label);
            const btnsDiv = document.createElement('div');
            btnsDiv.className = 'verb-form-buttons';
            const savedBinyan = Array.isArray(saved.binyan) ? saved.binyan : (saved.binyan ? [saved.binyan] : []);
            VERB_FORMS.forEach(vf => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'verb-form-btn' + (savedBinyan.includes(vf.value) ? ' selected' : '');
                btn.dataset.value = vf.value;
                btn.textContent = vf.label;
                btn.addEventListener('click', () => btn.classList.toggle('selected'));
                btnsDiv.appendChild(btn);
            });
            group.appendChild(btnsDiv);
            container.appendChild(group);
        }

        // Time
        if (details.time) {
            const group = document.createElement('div');
            group.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = 'זמן';
            group.appendChild(label);
            const btnsDiv = document.createElement('div');
            btnsDiv.className = 'verb-time-buttons';
            const savedTime = Array.isArray(saved.time) ? saved.time : (saved.time ? [saved.time] : []);
            const timeOpts = ['עבר', 'עתיד', 'עתיד מנצוב', 'עתיד מג\'זום', 'ציווי'];
            timeOpts.forEach(t => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'verb-time-btn' + (savedTime.includes(t) ? ' selected' : '');
                btn.dataset.value = t;
                btn.textContent = t;
                btn.addEventListener('click', () => btn.classList.toggle('selected'));
                btnsDiv.appendChild(btn);
            });
            group.appendChild(btnsDiv);
            container.appendChild(group);
        }

        // Voice
        if (details.voice) {
            const group = document.createElement('div');
            group.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = 'קול';
            group.appendChild(label);
            const btnsDiv = document.createElement('div');
            btnsDiv.className = 'verb-voice-buttons';
            ['פעיל', 'סביל'].forEach(v => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'verb-voice-btn' + ((saved.voice || 'פעיל') === v ? ' selected' : '');
                btn.dataset.value = v;
                btn.textContent = v;
                btn.addEventListener('click', () => {
                    btnsDiv.querySelectorAll('.verb-voice-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                });
                btnsDiv.appendChild(btn);
            });
            group.appendChild(btnsDiv);
            container.appendChild(group);
        }

        // Person/Gender
        if (details.personGender) {
            const group = document.createElement('div');
            group.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = 'גוף/מין';
            group.appendChild(label);
            const btnsDiv = document.createElement('div');
            btnsDiv.className = 'verb-person-buttons';
            const savedPG = Array.isArray(saved.personGender) ? saved.personGender : (saved.personGender ? [saved.personGender] : []);
            VERB_PERSON_GENDER.forEach(pg => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'verb-person-btn' + (savedPG.includes(pg.value) ? ' selected' : '');
                btn.dataset.value = pg.value;
                btn.textContent = pg.label;
                btn.addEventListener('click', () => btn.classList.toggle('selected'));
                btnsDiv.appendChild(btn);
            });
            group.appendChild(btnsDiv);
            container.appendChild(group);
        }
    },

    _saveVerbFields(newDetails) {
        // Root (#34: multiple root inputs)
        const rootInputs = document.querySelectorAll('.root-input');
        if (rootInputs.length > 0) {
            const vals = Array.from(rootInputs).map(inp => inp.value.trim()).filter(Boolean);
            if (vals.length > 0) newDetails.root = vals.length === 1 ? vals[0] : vals;
        }

        // Binyan
        const binyanBtns = document.querySelectorAll('.verb-form-btn.selected');
        const binyanVals = Array.from(binyanBtns).map(b => b.dataset.value).filter(Boolean);
        if (binyanVals.length) newDetails.binyan = binyanVals.length === 1 ? binyanVals[0] : binyanVals;

        // Time
        const timeBtns = document.querySelectorAll('.verb-time-btn.selected');
        const timeVals = Array.from(timeBtns).map(b => b.dataset.value).filter(Boolean);
        if (timeVals.length) newDetails.time = timeVals.length === 1 ? timeVals[0] : timeVals;

        // Voice
        const voiceBtn = document.querySelector('.verb-voice-btn.selected');
        if (voiceBtn) newDetails.voice = voiceBtn.dataset.value;

        // Person/Gender
        const pgBtns = document.querySelectorAll('.verb-person-btn.selected');
        const pgVals = Array.from(pgBtns).map(b => b.dataset.value).filter(Boolean);
        if (pgVals.length) newDetails.personGender = pgVals.length === 1 ? pgVals[0] : pgVals;
    },

    _scrollToNextFormGroup(currentGroup) {
        if (!currentGroup) return;
        const next = currentGroup.nextElementSibling;
        if (next && next.classList.contains('form-group')) {
            next.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    // #34: Add a root input row with Hebrew-Arabic conversion
    _addRootInput(container, value, index) {
        const row = document.createElement('div');
        row.className = 'root-input-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control root-input';
        input.value = value;
        input.dir = 'rtl';
        input.placeholder = 'הקלד שורש בעברית ולחץ Enter';
        input.dataset.rootIndex = index;

        // Enter key: convert Hebrew to Arabic (#35, #36)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.value = this._convertHebrewToArabic(input.value);
                // #1237: advance to the next station after the root is entered,
                // matching how every other POS selector auto-advances on pick.
                const fg = input.closest('.form-group');
                if (fg) this._scrollToNextFormGroup(fg);
            }
        });

        row.appendChild(input);

        // Remove button (for additional roots)
        if (index > 0) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'remove-root-btn';
            removeBtn.textContent = '\u2715';
            removeBtn.title = 'הסר שורש';
            removeBtn.addEventListener('click', () => row.remove());
            row.appendChild(removeBtn);
        }

        container.appendChild(row);
    },

    // #35, #36: Convert Hebrew text to Arabic, handling geresh for special letters
    _convertHebrewToArabic(text) {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const next = text[i + 1];
            // Check % convention: א% → ى (alif maqsura)
            if (next === '%' && char === 'א') {
                result += 'ئ';
                i++; // skip the %
            // Check geresh pair first (#36) — Hebrew letter + geresh
            } else if ((next === "'" || next === '\u05F3' || next === '\u2018' || next === '\u2019') && GERESH_MAP[char]) {
                var mapped = GERESH_MAP[char];
                var next2 = text[i + 2];
                if ((next2 === "'" || next2 === '\u05F3' || next2 === '\u2018' || next2 === '\u2019') && DOUBLE_GERESH_MAP[mapped]) {
                    result += DOUBLE_GERESH_MAP[mapped];
                    i += 2; // skip both geresh chars
                } else {
                    result += mapped;
                    i++; // skip the geresh
                }
            // Arabic letter + geresh → upgraded Arabic letter (e.g., ح' → خ)
            } else if ((next === "'" || next === '\u05F3' || next === '\u2018' || next === '\u2019') && ARABIC_GERESH_MAP[char]) {
                result += ARABIC_GERESH_MAP[char];
                i++; // skip the geresh
            // " (gershayim / double quote) → ى (alif maqsura)
            } else if (char === '"' || char === '\u05F4' || char === '\u201C' || char === '\u201D') {
                result += 'ى';
            } else if (HEBREW_TO_ARABIC[char]) {
                result += HEBREW_TO_ARABIC[char];
            } else {
                result += char; // keep as-is (Arabic, spaces, etc.)
            }
        }
        return result;
    },

    _convertArabicToHebrew(text) {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (GERESH_REVERSE[char]) {
                result += GERESH_REVERSE[char];
            } else if (ARABIC_TO_HEBREW[char]) {
                result += ARABIC_TO_HEBREW[char];
            } else {
                result += char;
            }
        }
        return result;
    },

    _buildMultiCheckbox(container, key, def, current) {
        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.textContent = def.label;
        group.appendChild(label);
        const checkboxes = document.createElement('div');
        checkboxes.className = 'checkbox-group';
        def.options.forEach(opt => {
            const wrapper = document.createElement('label');
            wrapper.className = 'checkbox-label';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = `detail_${key}_${opt}`;
            cb.checked = Array.isArray(current) ? current.includes(opt) : false;
            wrapper.appendChild(cb);
            wrapper.appendChild(document.createTextNode(' ' + opt));
            checkboxes.appendChild(wrapper);
        });
        group.appendChild(checkboxes);
        container.appendChild(group);
    },

    _showPosDeleteToast() {
        const existing = document.getElementById('pos-delete-undo-toast');
        if (existing) { clearTimeout(existing._timer); existing.remove(); }
        const toast = document.createElement('div');
        toast.id = 'pos-delete-undo-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:10px 18px;border-radius:10px;font-size:0.9em;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);direction:rtl';
        const msg = document.createElement('span');
        msg.textContent = 'חלק הדיבר נמחק';
        const undoBtn = document.createElement('button');
        undoBtn.textContent = 'בוטל — שחזר';
        undoBtn.style.cssText = 'padding:4px 12px;border-radius:6px;border:none;background:#0d9488;color:white;cursor:pointer;font-weight:bold;font-size:0.9em';
        let undone = false;
        const state = this._state;
        undoBtn.onclick = () => {
            if (undone) return;
            undone = true;
            clearTimeout(toast._timer);
            toast.remove();
            state.undo();
            if (typeof Renderer !== 'undefined') Renderer.renderAll();
        };
        toast.appendChild(msg);
        toast.appendChild(undoBtn);
        document.body.appendChild(toast);
        toast._timer = setTimeout(() => { if (!undone) toast.remove(); }, 5000);
    }
};
