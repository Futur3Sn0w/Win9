(function () {
    const STORAGE_KEY = 'modern-alarms-state-v3';
    const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const SOUNDS = ['Chimes', 'Ascending', 'Xylophone', 'Chords', 'Jingle', 'Transition', 'Descending', 'Bounce', 'Echo', 'Chime'];
    const TAB_META = {
        alarm: { title: 'Alarm', subtitle: 'Alarm Collection', command: 'Add new alarm', accent: '#ac193d', accentDark: '#6f1028' },
        timer: { title: 'Timer', subtitle: 'Timer Collection', command: 'Add new timer', accent: '#008299', accentDark: '#095764' },
        stopwatch: { title: 'Stopwatch', subtitle: 'Laps / Splits', command: 'Start stopwatch', accent: '#da532c', accentDark: '#8d3016' }
    };
    const COLORS = [
        { accent: '#ac193d', accentDark: '#6f1028' },
        { accent: '#008299', accentDark: '#095764' },
        { accent: '#da532c', accentDark: '#8d3016' }
    ];
    const root = document.getElementById('alarms-app');
    if (!root) return;

    const state = loadState();
    const elements = {
        tabs: Array.from(document.querySelectorAll('.alarms-tab')),
        views: Array.from(document.querySelectorAll('.alarms-view')),
        pageTitle: document.getElementById('alarms-page-title'),
        addButton: document.getElementById('alarms-add-button'),
        addButtonLabel: document.getElementById('alarms-command-label'),
        addButtonIcon: document.querySelector('.alarms-command__icon svg'),
        alarmCount: document.getElementById('alarm-count'),
        timerCount: document.getElementById('timer-count'),
        stopwatchStatus: document.getElementById('stopwatch-status'),
        alarmGrid: document.getElementById('alarm-grid'),
        timerGrid: document.getElementById('timer-grid'),
        stopwatchRing: document.getElementById('stopwatch-ring'),
        stopwatchToggle: document.getElementById('stopwatch-toggle'),
        stopwatchLap: document.getElementById('stopwatch-lap'),
        stopwatchDisplay: document.getElementById('stopwatch-display'),
        stopwatchLaps: document.getElementById('stopwatch-laps'),
        editor: document.getElementById('alarm-editor'),
        editorHeading: document.getElementById('editor-heading'),
        editorSubheading: document.getElementById('editor-subheading'),
        editorWarning: document.getElementById('editor-warning'),
        editorWarningDismiss: document.getElementById('editor-warning-dismiss'),
        editorTitle: document.getElementById('editor-title'),
        editorHour: document.getElementById('editor-hour'),
        editorMinute: document.getElementById('editor-minute'),
        editorTime: document.getElementById('editor-time'),
        editorRing: document.getElementById('editor-ring'),
        editorHourHandle: document.getElementById('editor-hour-handle'),
        editorMinuteHandle: document.getElementById('editor-minute-handle'),
        editorAm: document.getElementById('editor-am'),
        editorPm: document.getElementById('editor-pm'),
        editorOccurrenceOnce: document.getElementById('editor-occurrence-once'),
        editorOccurrenceRepeat: document.getElementById('editor-occurrence-repeat'),
        editorDays: document.getElementById('editor-days'),
        editorSound: document.getElementById('editor-sound'),
        editorSave: document.getElementById('editor-save'),
        editorDelete: document.getElementById('editor-delete'),
        editorCancel: document.getElementById('editor-cancel')
    };

    let tickTimer = null;
    let editorDraft = null;
    let editorWarningDismissed = false;

    initialize();

    function initialize() {
        renderSoundOptions();
        attachEvents();
        render();
        startTicker();
    }

    function attachEvents() {
        elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                state.activeTab = tab.dataset.tab;
                render();
                persistState();
            });
        });
        elements.addButton.addEventListener('click', () => {
            if (state.activeTab === 'alarm') return openAlarmEditor();
            if (state.activeTab === 'timer') return addTimer();
            toggleStopwatch();
        });
        elements.stopwatchToggle.addEventListener('click', toggleStopwatch);
        elements.stopwatchLap.addEventListener('click', recordLap);
        elements.editorWarningDismiss.addEventListener('click', () => {
            editorWarningDismissed = true;
            renderEditor();
        });
        elements.editorTitle.addEventListener('input', () => {
            if (!editorDraft) return;
            editorDraft.title = elements.editorTitle.value.trim() || createDefaultAlarmName();
            elements.editorHeading.textContent = editorDraft.title;
        });
        elements.editorHour.addEventListener('input', () => {
            if (!editorDraft) return;
            editorDraft.hour = clamp(parseInt(elements.editorHour.value, 10) || 0, 1, 12);
            syncEditorFields();
        });
        elements.editorMinute.addEventListener('input', () => {
            if (!editorDraft) return;
            editorDraft.minute = clamp(parseInt(elements.editorMinute.value, 10) || 0, 0, 59);
            syncEditorFields();
        });
        elements.editorAm.addEventListener('click', () => setEditorMeridiem('A.M.'));
        elements.editorPm.addEventListener('click', () => setEditorMeridiem('P.M.'));
        elements.editorOccurrenceOnce.addEventListener('click', () => setEditorRepeats(false));
        elements.editorOccurrenceRepeat.addEventListener('click', () => setEditorRepeats(true));
        elements.editorSound.addEventListener('change', () => {
            if (editorDraft) editorDraft.sound = elements.editorSound.value;
        });
        elements.editorSave.addEventListener('click', saveAlarmDraft);
        elements.editorDelete.addEventListener('click', deleteAlarmFromEditor);
        elements.editorCancel.addEventListener('click', closeAlarmEditor);
        attachRingDrag(elements.editorHourHandle, 'hour');
        attachRingDrag(elements.editorMinuteHandle, 'minute');
    }

    function attachRingDrag(handle, mode) {
        let dragging = false;
        function getAngle(event) {
            const ring = elements.editorRing;
            const rect = ring.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const clientY = event.touches ? event.touches[0].clientY : event.clientY;
            const dx = clientX - cx;
            const dy = clientY - cy;
            let angle = Math.atan2(dy, dx) + Math.PI / 2;
            if (angle < 0) angle += Math.PI * 2;
            return angle / (Math.PI * 2);
        }
        function onMove(event) {
            if (!dragging || !editorDraft) return;
            event.preventDefault();
            const turn = getAngle(event);
            if (mode === 'hour') {
                editorDraft.hour = Math.round(turn * 12) || 12;
            } else {
                editorDraft.minute = Math.round(turn * 60) % 60;
            }
            syncEditorFields();
        }
        function onEnd() {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        }
        function onStart(event) {
            if (!editorDraft) return;
            event.preventDefault();
            dragging = true;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        }
        handle.addEventListener('mousedown', onStart);
        handle.addEventListener('touchstart', onStart, { passive: false });
    }

    function loadState() {
        const defaults = createDefaultState();
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaults;
            const parsed = JSON.parse(raw);
            return {
                ...defaults,
                ...parsed,
                alarms: normalizeAlarms(parsed.alarms, defaults.alarms),
                timers: normalizeTimers(parsed.timers, defaults.timers),
                stopwatch: normalizeStopwatch(parsed.stopwatch, defaults.stopwatch)
            };
        } catch (error) {
            console.warn('[Alarms] Failed to restore state:', error);
            return defaults;
        }
    }

    function persistState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('[Alarms] Failed to persist state:', error);
        }
    }

    function createDefaultState() {
        return { activeTab: 'alarm', alarms: [], timers: [], stopwatch: { running: false, elapsedMs: 0, startedAt: 0, laps: [] } };
    }

    function normalizeAlarms(value, fallback) {
        if (!Array.isArray(value) || !value.length) return fallback;
        return value.map(item => createAlarm(item));
    }

    function normalizeTimers(value, fallback) {
        if (!Array.isArray(value) || !value.length) return fallback;
        return value.map(item => createTimer(item));
    }

    function normalizeStopwatch(value, fallback) {
        if (!value || typeof value !== 'object') return fallback;
        return {
            running: Boolean(value.running),
            elapsedMs: Number.isFinite(value.elapsedMs) ? Math.max(0, value.elapsedMs) : fallback.elapsedMs,
            startedAt: Number.isFinite(value.startedAt) ? value.startedAt : 0,
            laps: Array.isArray(value.laps) ? value.laps.map(lap => ({
                id: lap.id || uid(),
                lapMs: Number.isFinite(lap.lapMs) ? Math.max(0, lap.lapMs) : 0,
                splitMs: Number.isFinite(lap.splitMs) ? Math.max(0, lap.splitMs) : 0
            })) : fallback.laps
        };
    }

    function createAlarm(overrides = {}) {
        return {
            id: overrides.id || uid(),
            title: overrides.title || createDefaultAlarmName(),
            hour: clamp(parseInt(overrides.hour, 10) || 7, 1, 12),
            minute: clamp(parseInt(overrides.minute, 10) || 0, 0, 59),
            meridiem: overrides.meridiem === 'P.M.' ? 'P.M.' : 'A.M.',
            days: Array.isArray(overrides.days) ? [...new Set(overrides.days.filter(index => index >= 0 && index <= 6))] : [],
            enabled: typeof overrides.enabled === 'boolean' ? overrides.enabled : true,
            sound: SOUNDS.includes(overrides.sound) ? overrides.sound : SOUNDS[0],
            colorIndex: normalizeColorIndex(overrides.colorIndex)
        };
    }

    function createTimer(overrides = {}) {
        const durationMs = Math.max(0, parseInt(overrides.durationMs, 10) || 0);
        const remainingMs = Math.max(0, parseInt(overrides.remainingMs, 10) || durationMs);
        return {
            id: overrides.id || uid(),
            title: overrides.title || createDefaultTimerName(),
            durationMs,
            remainingMs,
            running: Boolean(overrides.running),
            startedAt: Number.isFinite(overrides.startedAt) ? overrides.startedAt : 0,
            targetAt: Number.isFinite(overrides.targetAt) ? overrides.targetAt : 0,
            colorIndex: normalizeColorIndex(overrides.colorIndex),
            completed: Boolean(overrides.completed)
        };
    }

    function normalizeColorIndex(value) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 0;
        return ((parsed % COLORS.length) + COLORS.length) % COLORS.length;
    }

    function render() {
        renderShell();
        renderAlarms();
        renderTimers();
        renderStopwatch();
        renderEditor();
    }

    function renderShell() {
        const meta = TAB_META[state.activeTab] || TAB_META.alarm;
        const stopwatchCommand = state.stopwatch.running ? 'Pause stopwatch' : 'Start stopwatch';
        const commandLabel = state.activeTab === 'stopwatch' ? stopwatchCommand : meta.command;
        root.style.setProperty('--alarms-accent', meta.accent);
        root.style.setProperty('--alarms-accent-dark', meta.accentDark);
        elements.pageTitle.textContent = meta.title;
        elements.addButtonLabel.textContent = commandLabel;
        elements.addButton.setAttribute('aria-label', commandLabel);
        elements.addButtonIcon.innerHTML = state.activeTab === 'stopwatch'
            ? (state.stopwatch.running ? '<path d="M11 9h4v14h-4zM17 9h4v14h-4z"></path>' : '<path d="M12 9.5 24 16 12 22.5z"></path>')
            : '<path d="M16 6v20M6 16h20"></path>';
        elements.tabs.forEach(tab => {
            const isActive = tab.dataset.tab === state.activeTab;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
        elements.views.forEach(view => view.classList.toggle('is-active', view.dataset.view === state.activeTab));
        elements.alarmCount.textContent = formatCount(state.alarms.length, 'alarm');
        elements.timerCount.textContent = formatCount(state.timers.length, 'timer');
        elements.stopwatchStatus.textContent = getStopwatchStatusLabel();
    }

    function renderAlarms() {
        elements.alarmGrid.innerHTML = '';
        if (!state.alarms.length) {
            elements.alarmGrid.innerHTML = createEmptyStateMarkup(
                'Alarm Collection',
                'No alarms yet.',
                'Use the add button to create your first alarm.'
            );
            return;
        }
        state.alarms.forEach(alarm => {
            const color = COLORS[alarm.colorIndex];
            const progress = getAlarmTurn(alarm);
            const card = document.createElement('article');
            card.className = `alarm-card${alarm.enabled ? '' : ' is-disabled'}`;
            card.style.setProperty('--accent', color.accent);
            card.style.setProperty('--accent-dark', color.accentDark);
            card.style.setProperty('--progress', progress.toFixed(4));
            card.innerHTML = `
                <div class="alarm-card__surface">
                    <div class="alarm-card__click-target" data-role="edit"></div>
                    <header class="alarm-card__header">
                        <div class="alarm-card__title-group">
                            <div class="alarm-card__title">${escapeHtml(alarm.title)}</div>
                            <div class="alarm-card__subtitle">${escapeHtml(formatAlarmDays(alarm.days))}</div>
                        </div>
                        <div class="alarm-card__state">${alarm.enabled ? 'On' : 'Off'}</div>
                    </header>
                    <div class="alarm-ring">
                        <div class="alarm-ring__label">
                            <div>
                                <div class="alarm-ring__time">${formatTime(alarm.hour, alarm.minute)}</div>
                                <div class="alarm-ring__meridiem">${alarm.meridiem}</div>
                            </div>
                        </div>
                    </div>
                    <footer class="alarm-card__footer">
                        <div class="alarm-card__toggle">
                            <button class="alarm-card__bell" type="button" aria-label="${alarm.enabled ? 'Disable' : 'Enable'} ${escapeHtml(alarm.title)}">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M12 4a4 4 0 0 1 4 4v2.7c0 1 .3 1.9.9 2.7l1.1 1.4H6l1.1-1.4c.6-.8.9-1.7.9-2.7V8a4 4 0 0 1 4-4zM10 18a2 2 0 0 0 4 0"></path>
                                </svg>
                            </button>
                            <div class="alarm-card__toggle-label">${alarm.enabled ? 'On' : 'Off'}</div>
                        </div>
                        <div class="alarm-card__subtitle">${escapeHtml(alarm.sound)}</div>
                    </footer>
                </div>
            `;
            card.querySelector('[data-role="edit"]').addEventListener('click', () => openAlarmEditor(alarm.id));
            card.querySelector('.alarm-card__bell').addEventListener('click', event => {
                event.stopPropagation();
                alarm.enabled = !alarm.enabled;
                persistState();
                renderAlarms();
            });
            elements.alarmGrid.appendChild(card);
        });
    }

    function renderTimers() {
        elements.timerGrid.innerHTML = '';
        if (!state.timers.length) {
            elements.timerGrid.innerHTML = createEmptyStateMarkup(
                'Timer Collection',
                'No timers yet.',
                'Use the add button to create a new timer.'
            );
            return;
        }
        state.timers.forEach(timer => {
            const color = COLORS[timer.colorIndex];
            const total = Math.max(timer.durationMs, 1);
            const elapsedFraction = timer.durationMs <= 0 ? 0 : clamp((timer.durationMs - timer.remainingMs) / total, 0, 1);
            const card = document.createElement('article');
            card.className = 'timer-card';
            card.style.setProperty('--accent', color.accent);
            card.style.setProperty('--accent-dark', color.accentDark);
            card.style.setProperty('--progress', elapsedFraction.toFixed(4));
            card.innerHTML = `
                <div class="timer-card__surface">
                    <header class="timer-card__header">
                        <div class="timer-card__title-group">
                            <input class="timer-card__title-input" type="text" maxlength="32" value="${escapeAttribute(timer.title)}" aria-label="Timer name">
                            <div class="timer-card__subtitle">${escapeHtml(getTimerStateLabel(timer))}</div>
                        </div>
                        <div class="timer-card__commands">
                            <button class="timer-card__icon-button" type="button" data-action="${timer.durationMs > 0 ? 'reset' : 'delete'}" aria-label="${timer.durationMs > 0 ? 'Restart timer' : 'Delete timer'}">
                                ${timer.durationMs > 0 ? `
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v6h-6"></path>
                                    </svg>
                                ` : `
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M7 7h10M9 7V5h6v2M9 9v9M12 9v9M15 9v9M8 7l1 12h6l1-12"></path>
                                    </svg>
                                `}
                            </button>
                            <button class="alarms-circle-button ${timer.running ? 'is-running' : ''}" type="button" data-action="toggle" aria-label="${timer.running ? 'Pause timer' : 'Start timer'}">
                                <svg viewBox="0 0 32 32" aria-hidden="true">
                                    <path class="icon-play" d="M12 9.5 24 16 12 22.5z"></path>
                                    <path class="icon-pause" d="M11 9h4v14h-4zM17 9h4v14h-4z"></path>
                                </svg>
                            </button>
                        </div>
                    </header>
                    <div class="timer-card__display">${formatTimerClock(timer.remainingMs)}</div>
                    <div class="timer-card__units">
                        <span>Hours</span>
                        <span>Minutes</span>
                        <span>Seconds</span>
                    </div>
                    <div class="timer-card__visual">
                        <div class="timer-ring">
                            <span class="timer-ring__handle" style="--handle-turn:${(1 - elapsedFraction).toFixed(4)};"></span>
                            <span class="timer-ring__handle timer-ring__handle--secondary" style="--handle-turn:0;"></span>
                        </div>
                    </div>
                    <div class="timer-card__inputs">
                        <label>
                            <span>Hour</span>
                            <input type="number" min="0" max="23" step="1" value="${Math.floor(timer.durationMs / 3600000)}" data-part="hours">
                        </label>
                        <label>
                            <span>Minute</span>
                            <input type="number" min="0" max="59" step="1" value="${Math.floor(timer.durationMs / 60000) % 60}" data-part="minutes">
                        </label>
                        <label>
                            <span>Second</span>
                            <input type="number" min="0" max="59" step="1" value="${Math.floor(timer.durationMs / 1000) % 60}" data-part="seconds">
                        </label>
                    </div>
                    <footer class="timer-card__footer">
                        <div class="timer-card__state">${escapeHtml(getTimerSummary(timer))}</div>
                    </footer>
                </div>
            `;
            const titleInput = card.querySelector('.timer-card__title-input');
            const toggleButton = card.querySelector('[data-action="toggle"]');
            const commandButton = card.querySelector('.timer-card__icon-button');
            const inputs = Array.from(card.querySelectorAll('.timer-card__inputs input'));
            titleInput.addEventListener('change', () => {
                timer.title = titleInput.value.trim() || createDefaultTimerName();
                persistState();
                renderTimers();
            });
            toggleButton.addEventListener('click', () => toggleTimer(timer.id));
            commandButton.addEventListener('click', () => {
                if (timer.durationMs > 0) resetTimer(timer.id);
                else deleteTimer(timer.id);
            });
            inputs.forEach(input => {
                input.disabled = timer.running;
                input.addEventListener('change', () => updateTimerDuration(timer.id, inputs));
            });
            elements.timerGrid.appendChild(card);
        });
    }

    function renderStopwatch() {
        const elapsedMs = getStopwatchElapsed();
        const progress = ((elapsedMs % 60000) / 60000) || 0;
        elements.stopwatchRing.style.setProperty('--progress', progress.toFixed(4));
        elements.stopwatchRing.style.setProperty('--accent-dark', '#8d3016');
        elements.stopwatchToggle.classList.toggle('is-running', state.stopwatch.running);
        elements.stopwatchToggle.setAttribute('aria-label', state.stopwatch.running ? 'Pause stopwatch' : 'Start stopwatch');
        elements.stopwatchDisplay.textContent = formatStopwatch(elapsedMs);
        elements.stopwatchLap.disabled = !state.stopwatch.running && elapsedMs === 0;
        elements.stopwatchLap.style.opacity = elements.stopwatchLap.disabled ? '0.4' : '1';
        if (!state.stopwatch.laps.length && elapsedMs === 0) {
            elements.stopwatchLaps.innerHTML = '<div class="stopwatch-empty">No stopwatch activity yet. Start the stopwatch to capture laps and splits.</div>';
            return;
        }
        if (!state.stopwatch.laps.length) {
            elements.stopwatchLaps.innerHTML = '<div class="stopwatch-empty">The stopwatch is running. Record a lap to populate the split table.</div>';
            return;
        }
        elements.stopwatchLaps.innerHTML = state.stopwatch.laps.map((lap, index) => `
            <div class="stopwatch-lap-row">
                <span class="stopwatch-lap-index">${index + 1}</span>
                <span>${formatStopwatch(lap.lapMs)}</span>
                <span>${formatStopwatch(lap.splitMs)}</span>
            </div>
        `).join('');
    }

    function renderEditor() {
        const isOpen = Boolean(editorDraft);
        elements.editor.hidden = !isOpen;
        elements.editor.setAttribute('aria-hidden', String(!isOpen));
        if (!isOpen) return;
        const color = COLORS[editorDraft.colorIndex];
        elements.editor.style.setProperty('--alarms-accent', color.accent);
        elements.editor.style.setProperty('--alarms-accent-dark', color.accentDark);
        elements.editorHeading.textContent = editorDraft.title;
        elements.editorSubheading.textContent = 'Set time';
        elements.editorWarning.hidden = editorWarningDismissed;
        elements.editorTitle.value = editorDraft.title;
        elements.editorTitle.placeholder = createDefaultAlarmName();
        elements.editorSound.value = editorDraft.sound;
        elements.editorDelete.style.visibility = editorDraft.isNew ? 'hidden' : 'visible';
        syncEditorFields();
        renderEditorDays();
    }

    function renderSoundOptions() {
        elements.editorSound.innerHTML = SOUNDS.map(sound => `<option value="${escapeAttribute(sound)}">${escapeHtml(sound)}</option>`).join('');
    }

    function renderEditorDays() {
        if (!editorDraft) return;
        elements.editorDays.innerHTML = '';
        DAY_LABELS.forEach((label, index) => {
            const wrapper = document.createElement('label');
            const checked = editorDraft.days.includes(index);
            wrapper.className = `editor-day${checked ? ' is-active' : ''}`;
            wrapper.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}><span>${label}</span>`;
            wrapper.querySelector('input').addEventListener('change', event => {
                if (event.target.checked) editorDraft.days = [...editorDraft.days, index].sort((a, b) => a - b);
                else editorDraft.days = editorDraft.days.filter(day => day !== index);
                setEditorRepeats(editorDraft.days.length > 0, false);
                renderEditorDays();
            });
            elements.editorDays.appendChild(wrapper);
        });
    }

    function syncEditorFields() {
        if (!editorDraft) return;
        editorDraft.hour = clamp(parseInt(editorDraft.hour, 10) || 0, 1, 12);
        editorDraft.minute = clamp(parseInt(editorDraft.minute, 10) || 0, 0, 59);
        elements.editorHour.value = String(editorDraft.hour);
        elements.editorMinute.value = String(editorDraft.minute).padStart(2, '0');
        elements.editorTime.textContent = formatTime(editorDraft.hour, editorDraft.minute);
        elements.editorRing.style.setProperty('--progress', getHourHandleTurn(editorDraft).toFixed(4));
        elements.editorRing.style.setProperty('--minute-progress', getMinuteHandleTurn(editorDraft).toFixed(4));
        elements.editorRing.style.setProperty('--accent-dark', COLORS[editorDraft.colorIndex].accentDark);
        elements.editorHourHandle.style.setProperty('--handle-turn', getHourHandleTurn(editorDraft).toFixed(4));
        elements.editorMinuteHandle.style.setProperty('--handle-turn', getMinuteHandleTurn(editorDraft).toFixed(4));
        elements.editorAm.classList.toggle('is-active', editorDraft.meridiem === 'A.M.');
        elements.editorPm.classList.toggle('is-active', editorDraft.meridiem === 'P.M.');
        elements.editorOccurrenceOnce.classList.toggle('is-active', editorDraft.days.length === 0);
        elements.editorOccurrenceRepeat.classList.toggle('is-active', editorDraft.days.length > 0);
    }

    function setEditorMeridiem(meridiem) {
        if (!editorDraft) return;
        editorDraft.meridiem = meridiem;
        syncEditorFields();
    }

    function setEditorRepeats(repeats, rerender = true) {
        if (!editorDraft) return;
        if (!repeats) editorDraft.days = [];
        else if (!editorDraft.days.length) editorDraft.days = [1, 2, 3, 4, 5];
        syncEditorFields();
        if (rerender) renderEditorDays();
    }

    function openAlarmEditor(alarmId) {
        editorWarningDismissed = false;
        if (!alarmId) {
            editorDraft = {
                ...createAlarm({
                    title: createDefaultAlarmName(),
                    hour: 7,
                    minute: 0,
                    meridiem: 'A.M.',
                    days: [1, 2, 3, 4, 5],
                    enabled: true,
                    sound: SOUNDS[0],
                    colorIndex: state.alarms.length % COLORS.length
                }),
                isNew: true
            };
            render();
            return;
        }
        const alarm = state.alarms.find(item => item.id === alarmId);
        if (!alarm) return;
        editorDraft = { ...alarm, days: [...alarm.days], isNew: false };
        render();
    }

    function closeAlarmEditor() {
        editorDraft = null;
        render();
    }

    function saveAlarmDraft() {
        if (!editorDraft) return;
        const normalized = createAlarm({
            ...editorDraft,
            title: elements.editorTitle.value.trim() || createDefaultAlarmName(),
            hour: elements.editorHour.value,
            minute: elements.editorMinute.value,
            sound: elements.editorSound.value
        });
        const existingIndex = state.alarms.findIndex(alarm => alarm.id === normalized.id);
        if (existingIndex === -1) state.alarms.push(normalized);
        else state.alarms.splice(existingIndex, 1, normalized);
        editorDraft = null;
        persistState();
        render();
    }

    function deleteAlarmFromEditor() {
        if (!editorDraft || editorDraft.isNew) return closeAlarmEditor();
        state.alarms = state.alarms.filter(alarm => alarm.id !== editorDraft.id);
        editorDraft = null;
        persistState();
        render();
    }

    function addTimer() {
        const defaultDuration = toDurationMs(0, 5, 0);
        state.timers.unshift(createTimer({
            title: createDefaultTimerName(),
            durationMs: defaultDuration,
            remainingMs: defaultDuration,
            running: false,
            colorIndex: state.timers.length % COLORS.length
        }));
        persistState();
        renderTimers();
        renderShell();
    }

    function deleteTimer(timerId) {
        state.timers = state.timers.filter(timer => timer.id !== timerId);
        persistState();
        renderTimers();
        renderShell();
    }

    function resetTimer(timerId) {
        const timer = state.timers.find(item => item.id === timerId);
        if (!timer) return;
        timer.running = false;
        timer.completed = false;
        timer.startedAt = 0;
        timer.targetAt = 0;
        timer.remainingMs = timer.durationMs;
        persistState();
        renderTimers();
    }

    function toggleTimer(timerId) {
        const timer = state.timers.find(item => item.id === timerId);
        if (!timer || timer.durationMs <= 0) return;
        if (timer.running) {
            timer.running = false;
            timer.remainingMs = Math.max(0, timer.targetAt - Date.now());
            timer.startedAt = 0;
            timer.targetAt = 0;
        } else {
            timer.running = true;
            timer.completed = false;
            timer.startedAt = Date.now();
            timer.targetAt = timer.startedAt + timer.remainingMs;
        }
        persistState();
        renderTimers();
    }

    function updateTimerDuration(timerId, inputs) {
        const timer = state.timers.find(item => item.id === timerId);
        if (!timer) return;
        const hours = clamp(parseInt(inputs.find(input => input.dataset.part === 'hours')?.value, 10) || 0, 0, 23);
        const minutes = clamp(parseInt(inputs.find(input => input.dataset.part === 'minutes')?.value, 10) || 0, 0, 59);
        const seconds = clamp(parseInt(inputs.find(input => input.dataset.part === 'seconds')?.value, 10) || 0, 0, 59);
        const durationMs = toDurationMs(hours, minutes, seconds);
        timer.durationMs = durationMs;
        timer.remainingMs = durationMs;
        timer.running = false;
        timer.completed = false;
        timer.startedAt = 0;
        timer.targetAt = 0;
        persistState();
        renderTimers();
    }

    function toggleStopwatch() {
        const stopwatch = state.stopwatch;
        if (stopwatch.running) {
            stopwatch.elapsedMs = getStopwatchElapsed();
            stopwatch.running = false;
            stopwatch.startedAt = 0;
        } else {
            stopwatch.running = true;
            stopwatch.startedAt = Date.now() - stopwatch.elapsedMs;
        }
        persistState();
        renderShell();
        renderStopwatch();
    }

    function recordLap() {
        const stopwatch = state.stopwatch;
        const splitMs = getStopwatchElapsed();
        const previousSplit = stopwatch.laps.length ? stopwatch.laps[stopwatch.laps.length - 1].splitMs : 0;
        const lapMs = splitMs - previousSplit;
        if (!stopwatch.running && splitMs === 0) return;
        stopwatch.laps.push({ id: uid(), lapMs, splitMs });
        persistState();
        renderStopwatch();
    }

    function getStopwatchElapsed() {
        const stopwatch = state.stopwatch;
        if (!stopwatch.running) return stopwatch.elapsedMs;
        return Math.max(0, Date.now() - stopwatch.startedAt);
    }

    function startTicker() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = setInterval(() => {
            let shouldPersist = false;
            const now = Date.now();
            state.timers.forEach(timer => {
                if (!timer.running) return;
                timer.remainingMs = Math.max(0, timer.targetAt - now);
                if (timer.remainingMs === 0) {
                    timer.running = false;
                    timer.completed = true;
                    timer.startedAt = 0;
                    timer.targetAt = 0;
                    shouldPersist = true;
                }
            });
            if (state.activeTab === 'timer') renderTimers();
            if (state.activeTab === 'stopwatch' || state.stopwatch.running) {
                renderShell();
                renderStopwatch();
            }
            if (shouldPersist) persistState();
        }, 100);
    }

    function getAlarmTurn(alarm) {
        return (((alarm.hour % 12) * 60) + alarm.minute) / (12 * 60);
    }

    function getHourHandleTurn(alarm) {
        return (((alarm.hour % 12) + (alarm.minute / 60)) / 12);
    }

    function getMinuteHandleTurn(alarm) {
        return (alarm.minute % 60) / 60;
    }

    function getTimerStateLabel(timer) {
        if (timer.completed) return 'Timer done';
        if (timer.running) return 'Running';
        if (timer.durationMs > 0 && timer.remainingMs < timer.durationMs) return 'Paused';
        return timer.durationMs > 0 ? 'Not started' : 'Set duration';
    }

    function getTimerSummary(timer) {
        if (timer.durationMs <= 0) return 'Set a duration to start the timer.';
        if (timer.completed) return 'Countdown reached zero.';
        return `Initial time ${formatTimerClock(timer.durationMs)}`;
    }

    function getStopwatchStatusLabel() {
        if (state.stopwatch.running) return 'Running';
        return getStopwatchElapsed() > 0 ? 'Paused' : 'Not started';
    }

    function formatAlarmDays(days) {
        if (!days.length) return 'Once';
        if (days.length === 7) return 'Everyday';
        return days.map(day => DAY_SHORT[day]).join(', ');
    }

    function formatTime(hour, minute) {
        return `${hour}:${String(minute).padStart(2, '0')}`;
    }

    function formatTimerClock(durationMs) {
        const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor(totalSeconds / 60) % 60;
        const seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function formatStopwatch(durationMs) {
        const centiseconds = Math.floor((durationMs % 1000) / 10);
        const totalSeconds = Math.floor(durationMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor(totalSeconds / 60) % 60;
        const seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
    }

    function createEmptyStateMarkup(label, title, subtitle) {
        return `
            <div class="alarms-empty-state">
                <div>
                    <div class="alarms-empty-state__eyebrow">${escapeHtml(label)}</div>
                    <div class="alarms-empty-state__title">${escapeHtml(title)}</div>
                    <div class="alarms-empty-state__subtitle">${escapeHtml(subtitle)}</div>
                </div>
            </div>
        `;
    }

    function formatCount(count, singular) {
        return `${count} ${singular}${count === 1 ? '' : 's'}`;
    }

    function createDefaultAlarmName() {
        return state.alarms.length === 0 ? 'Good morning' : 'Alarm';
    }

    function createDefaultTimerName() {
        return 'Countdown';
    }

    function toDurationMs(hours, minutes, seconds) {
        return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1000;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function uid() {
        return `id-${Math.random().toString(36).slice(2, 10)}`;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value);
    }
})();
