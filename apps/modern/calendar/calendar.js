(function () {
    'use strict';

    const SETTINGS_STORAGE_KEY = 'win9-calendar-preferences';
    const DEFAULT_EVENT_COLOR = '#5133ab';
    const COLOR_PRESETS = ['#00a4a4', '#1d71c9', '#8d6dd8', '#e25a90', '#0e9f1b', '#d14d41', '#5133ab'];
    const electronIpc = getElectronIpc();

    const initialNow = new Date();
    let currentNow = new Date(initialNow);
    let today = new Date(initialNow);
    today.setHours(0, 0, 0, 0);

    const DEFAULT_CALENDARS = [
        { id: 'work', title: 'Work', color: '#00a4a4', primary: true, hidden: false },
        { id: 'family', title: 'Family', color: '#8d6dd8', primary: false, hidden: false },
        { id: 'personal', title: 'Personal', color: '#0e9f1b', primary: false, hidden: false },
        { id: 'travel', title: 'Travel', color: '#e25a90', primary: false, hidden: false }
    ];

    const DEFAULT_CALENDAR_EVENTS = [
        {
            id: 'evt-inspection',
            calendarId: 'work',
            date: '2026-04-02',
            start: '10:00',
            end: '11:00',
            title: 'Commapps inspection pass',
            location: 'Studio B',
            description: 'Walk the original package structure, validate manifest asset mappings, and decide what gets copied verbatim into the repo first.'
        },
        {
            id: 'evt-design',
            calendarId: 'work',
            date: '2026-04-02',
            start: '14:00',
            end: '14:45',
            title: 'Mail shell review',
            location: 'Blue room',
            description: 'Review the three-pane shell, folder affordances, and how much of the original visual hierarchy needs to be preserved in the first faithful pass.'
        },
        {
            id: 'evt-breakfast',
            calendarId: 'personal',
            date: '2026-04-03',
            start: '08:00',
            end: '08:45',
            title: 'Breakfast with Toni',
            location: 'Cafe Pamplona',
            description: 'Quick catch-up before the afternoon parity pass.'
        },
        {
            id: 'evt-travel',
            calendarId: 'travel',
            date: '2026-04-03',
            start: '18:30',
            end: '19:15',
            title: 'Airport shuttle',
            location: 'Terminal C',
            description: 'Pickup before the overnight flight.'
        },
        {
            id: 'evt-family',
            calendarId: 'family',
            date: '2026-04-04',
            start: '09:00',
            end: '10:00',
            title: 'Lunch with Roberts',
            location: 'Pogues',
            description: 'Bring the reconstruction notes and package screenshots.'
        },
        {
            id: 'evt-review',
            calendarId: 'work',
            date: '2026-04-04',
            start: '15:00',
            end: '16:00',
            title: 'Calendar fidelity review',
            location: 'Design lab',
            description: 'Compare the recreated month and agenda surfaces against the extracted CSS and screenshots.'
        },
        {
            id: 'evt-all-day',
            calendarId: 'family',
            date: '2026-04-05',
            start: '00:00',
            end: '23:59',
            title: 'Saint Patrick\'s Day',
            location: '',
            description: 'All-day marker to mirror the original app\'s hero and badge treatment.',
            allDay: true
        },
        {
            id: 'evt-week',
            calendarId: 'work',
            date: '2026-04-06',
            start: '13:00',
            end: '14:00',
            title: 'Quick event prototype',
            location: 'Prototype room',
            description: 'Pull over the quick-event surface treatment and hover states.'
        },
        {
            id: 'evt-card',
            calendarId: 'travel',
            date: '2026-04-07',
            start: '11:00',
            end: '12:30',
            title: 'Hardware pickup',
            location: 'North lobby',
            description: 'Collect the test device for the Outlook bridge mockups.'
        }
    ];

    let CALENDAR_EVENTS = deepClone(DEFAULT_CALENDAR_EVENTS);

    const state = {
        activeView: 'month',
        selectedDate: new Date(today),
        googleConnected: false,
        readOnly: false,
        dateFlyoutOpen: false,
        eventFlyoutOpen: false,
        contextMenuOpen: false,
        contextMenuContext: null,
        deleteConfirmOpen: false,
        deleteConfirmContext: null,
        quickEventOpen: false,
        quickEventContext: null,
        lastQuickEventCalendarId: '',
        showArrows: false,
        calendars: [],
        profile: null,
        selectedEventId: null
    };

    const renderCache = {
        monthHeaders: {
            key: '',
            html: ''
        },
        month: new Map(),
        week: new Map(),
        workweek: new Map(),
        day: new Map(),
        agenda: new Map()
    };

    const els = {
        app: document.getElementById('calendar-app'),
        shell: document.querySelector('.calendar-shell'),
        splash: document.getElementById('calendar-splash'),
        dateAnchor: document.getElementById('calendar-date-anchor'),
        dateLabel: document.getElementById('calendar-date-label'),
        dateFlyout: document.getElementById('calendar-date-flyout'),
        dateInput: document.getElementById('calendar-date-input'),
        dateToday: document.getElementById('calendar-date-today'),
        dateClose: document.getElementById('calendar-date-close'),
        selectionSummary: document.getElementById('calendar-selection-summary'),
        monthHeaders: document.getElementById('calendar-month-headers'),
        monthView: document.getElementById('calendar-month-view'),
        monthTimeline: document.getElementById('calendar-month-timeline'),
        monthGrid: document.getElementById('calendar-month-strip'),
        weekGrid: document.getElementById('calendar-week-grid'),
        weekStrip: document.getElementById('calendar-week-strip'),
        workweekGrid: document.getElementById('calendar-workweek-grid'),
        workweekStrip: document.getElementById('calendar-workweek-strip'),
        dayTimeline: document.getElementById('calendar-day-timeline'),
        dayStrip: document.getElementById('calendar-day-strip'),
        agendaTimeline: document.getElementById('calendar-agenda-timeline'),
        agendaDate: document.getElementById('calendar-agenda-date'),
        agendaAllDay: document.getElementById('calendar-agenda-all-day'),
        toast: document.getElementById('calendar-toast'),
        iteratorPrev: document.getElementById('calendar-iterator-prev'),
        iteratorNext: document.getElementById('calendar-iterator-next'),
        eventFlyout: document.getElementById('calendar-event-flyout'),
        eventFlyoutCalendar: document.getElementById('calendar-event-flyout-calendar'),
        eventFlyoutTitle: document.getElementById('calendar-event-flyout-title'),
        eventFlyoutTime: document.getElementById('calendar-event-flyout-time'),
        eventFlyoutLocation: document.getElementById('calendar-event-flyout-location'),
        eventFlyoutOpen: document.getElementById('calendar-event-flyout-open'),
        eventFlyoutDay: document.getElementById('calendar-event-flyout-day'),
        eventFlyoutDelete: document.getElementById('calendar-event-flyout-delete'),
        eventFlyoutClose: document.getElementById('calendar-event-flyout-close'),
        contextMenu: document.getElementById('calendar-context-menu'),
        contextMenuTitle: document.getElementById('calendar-context-menu-title'),
        contextMenuActions: document.getElementById('calendar-context-menu-actions'),
        deleteConfirm: document.getElementById('calendar-delete-confirm'),
        deleteConfirmCopy: document.getElementById('calendar-delete-confirm-copy'),
        deleteConfirmCancel: document.getElementById('calendar-delete-confirm-cancel'),
        deleteConfirmDelete: document.getElementById('calendar-delete-confirm-delete'),
        quickEvent: document.getElementById('calendar-quick-event'),
        quickEventGlyph: document.getElementById('calendar-quick-event-glyph'),
        quickEventCalendarTrigger: document.getElementById('calendar-quick-event-calendar-trigger'),
        quickEventCalendarButton: document.getElementById('calendar-quick-event-calendar-button'),
        quickEventCalendarMenu: document.getElementById('calendar-quick-event-calendar-menu'),
        quickEventSubject: document.getElementById('calendar-quick-event-subject'),
        quickEventSubjectHint: document.getElementById('calendar-quick-event-subject-hint'),
        quickEventLocation: document.getElementById('calendar-quick-event-location'),
        quickEventLocationHint: document.getElementById('calendar-quick-event-location-hint'),
        quickEventMeta: document.getElementById('calendar-quick-event-meta'),
        quickEventClose: document.getElementById('calendar-quick-event-close'),
        quickEventCancel: document.getElementById('calendar-quick-event-cancel'),
        quickEventCreate: document.getElementById('calendar-quick-event-create')
    };

    const MONTH_TIMELINE_PAGE_COUNT = 5;
    const MONTH_TIMELINE_CENTER_INDEX = Math.floor(MONTH_TIMELINE_PAGE_COUNT / 2);
    const TIMELINE_PAGE_COUNT = 5;
    const TIMELINE_CENTER_INDEX = Math.floor(TIMELINE_PAGE_COUNT / 2);
    const CALENDAR_AUTO_REFRESH_MS = 5 * 60 * 1000;
    const CALENDAR_RETRY_REFRESH_MS = 60 * 1000;

    let toastTimer = null;
    let calendarDataRevision = 0;
    let monthWheelAccumulation = 0;
    let monthWheelResetTimer = null;
    let monthScrollCommitTimer = null;
    let monthTimelineRecentering = false;
    let viewWheelAccumulation = 0;
    let viewWheelResetTimer = null;
    let viewScrollCommitTimer = null;
    let viewTimelineRecentering = false;
    let timeBankUnsubscribe = null;
    let lastClockMinuteKey = '';
    let nextGoogleRefreshAt = 0;
    let lastGoogleRefreshAttemptAt = 0;

    function getElectronIpc() {
        try {
            if (typeof window.require === 'function') {
                return window.require('electron').ipcRenderer;
            }
            return require('electron').ipcRenderer;
        } catch (_error) {
            return null;
        }
    }

    function getHostWindow() {
        try {
            return window.top && window.top.document ? window.top : window;
        } catch (_error) {
            return window;
        }
    }

    function getHostDocument() {
        return getHostWindow().document || document;
    }

    function getTimeBankApi() {
        const contexts = [window, window.parent, window.top];
        for (const ctx of contexts) {
            try {
                if (ctx && ctx.TimeBank) {
                    return ctx.TimeBank;
                }
            } catch (_error) {
                continue;
            }
        }
        return null;
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function getClockMinuteKey(date = currentNow) {
        const source = new Date(date);
        return `${source.toISOString().slice(0, 10)}T${String(source.getHours()).padStart(2, '0')}:${String(source.getMinutes()).padStart(2, '0')}`;
    }

    function syncClockSnapshot(snapshot) {
        const nextNow = snapshot?.now ? new Date(snapshot.now) : new Date();
        currentNow = new Date(nextNow);
        today = new Date(nextNow);
        today.setHours(0, 0, 0, 0);
    }

    function pruneRenderCache(cacheMap, maxEntries = 8) {
        while (cacheMap.size > maxEntries) {
            const oldestKey = cacheMap.keys().next().value;
            cacheMap.delete(oldestKey);
        }
    }

    function invalidateRenderCaches() {
        calendarDataRevision += 1;
        renderCache.monthHeaders.key = '';
        renderCache.monthHeaders.html = '';
        renderCache.month.clear();
        renderCache.week.clear();
        renderCache.workweek.clear();
        renderCache.day.clear();
        renderCache.agenda.clear();
    }

    function getCachedMarkup(cacheMap, key, buildMarkup) {
        if (cacheMap.has(key)) {
            return cacheMap.get(key);
        }

        const markup = buildMarkup();
        cacheMap.set(key, markup);
        pruneRenderCache(cacheMap);
        return markup;
    }

    function setElementMarkup(element, key, markup) {
        if (!element) {
            return false;
        }

        if (element.dataset.renderKey === key) {
            return false;
        }

        element.innerHTML = markup;
        element.dataset.renderKey = key;
        return true;
    }

    function loadPreferences() {
        try {
            const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
            return rawValue ? JSON.parse(rawValue) : {};
        } catch (_error) {
            return {};
        }
    }

    function savePreferences() {
        const hiddenCalendarIds = state.calendars.filter((calendar) => calendar.hidden).map((calendar) => calendar.id);
        const colorOverrides = state.calendars.reduce((result, calendar) => {
            result[calendar.id] = calendar.color;
            return result;
        }, {});
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
            hiddenCalendarIds,
            colorOverrides,
            showArrows: state.showArrows,
            lastQuickEventCalendarId: state.lastQuickEventCalendarId || ''
        }));
    }

    function applyPreferencesToCalendars(calendars) {
        const preferences = loadPreferences();
        const hiddenCalendarIds = new Set(preferences.hiddenCalendarIds || []);
        const colorOverrides = preferences.colorOverrides || {};
        state.showArrows = Boolean(preferences.showArrows);
        state.lastQuickEventCalendarId = String(preferences.lastQuickEventCalendarId || '');
        return calendars.map((calendar) => ({
            ...calendar,
            color: colorOverrides[calendar.id] || calendar.color || DEFAULT_EVENT_COLOR,
            hidden: hiddenCalendarIds.has(calendar.id)
        }));
    }

    function scheduleNextGoogleRefresh(cacheMeta, options = {}) {
        const nowTimestamp = currentNow.getTime();
        if (!state.googleConnected) {
            nextGoogleRefreshAt = 0;
            lastGoogleRefreshAttemptAt = 0;
            return;
        }

        if (options.retrySoon) {
            nextGoogleRefreshAt = nowTimestamp + CALENDAR_RETRY_REFRESH_MS;
            return;
        }

        const expiresAt = Number(cacheMeta?.expiresAt);
        if (Number.isFinite(expiresAt) && expiresAt > nowTimestamp) {
            nextGoogleRefreshAt = expiresAt;
            return;
        }

        if (cacheMeta?.stale) {
            nextGoogleRefreshAt = nowTimestamp + CALENDAR_RETRY_REFRESH_MS;
            return;
        }

        nextGoogleRefreshAt = nowTimestamp + CALENDAR_AUTO_REFRESH_MS;
    }

    function parseEventDate(dateString) {
        return new Date(`${dateString}T00:00:00`);
    }

    function sameDay(left, right) {
        return left.toDateString() === right.toDateString();
    }

    function getEventCalendar(event) {
        return state.calendars.find((calendar) => calendar.id === event.calendarId) || null;
    }

    function getEventColor(event) {
        return event.color || getEventCalendar(event)?.color || DEFAULT_EVENT_COLOR;
    }

    function getVisibleEvents() {
        return CALENDAR_EVENTS
            .filter((event) => {
                const calendar = getEventCalendar(event);
                return !calendar || !calendar.hidden;
            })
            .slice()
            .sort((left, right) => `${left.date}${left.start}`.localeCompare(`${right.date}${right.start}`));
    }

    function eventsForDate(date) {
        return getVisibleEvents().filter((event) => sameDay(parseEventDate(event.date), date));
    }

    function formatMonthAnchor(date) {
        return date.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });
    }

    function formatLongDate(date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }

    function formatShortDate(date) {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    }

    function formatAgendaHeader(date) {
        if (sameDay(date, today)) {
            return 'Today';
        }

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (sameDay(date, tomorrow)) {
            return 'Tomorrow';
        }

        return formatLongDate(date);
    }

    function formatAgendaHeroDate(date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll('\'', '&#39;');
    }

    function startOfWeek(date) {
        const start = new Date(date);
        start.setDate(date.getDate() - date.getDay());
        start.setHours(0, 0, 0, 0);
        return start;
    }

    function startOfWorkWeek(date) {
        const start = startOfWeek(date);
        start.setDate(start.getDate() + 1);
        return start;
    }

    function showToast(message) {
        els.toast.textContent = message;
        els.toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            els.toast.hidden = true;
        }, 2200);
    }

    function closeDateFlyout() {
        state.dateFlyoutOpen = false;
        els.dateFlyout.hidden = true;
    }

    function playEnterAnimation(element) {
        if (!element) {
            return;
        }

        element.classList.remove('is-entering');
        void element.offsetWidth;
        element.classList.add('is-entering');
    }

    function animateActiveView() {
        const activeView = document.querySelector(`.calendar-view[data-view="${state.activeView}"]`);
        playEnterAnimation(activeView);
    }

    function openDateFlyout() {
        const anchorElement = state.activeView === 'agenda' ? els.agendaDate : els.dateAnchor;
        const appRect = els.app.getBoundingClientRect();
        const anchorRect = anchorElement.getBoundingClientRect();

        state.dateFlyoutOpen = true;
        els.dateFlyout.hidden = false;
        els.dateInput.value = state.selectedDate.toISOString().slice(0, 10);
        const flyoutWidth = els.dateFlyout.offsetWidth || 280;
        const left = Math.max(18, Math.min(appRect.width - flyoutWidth - 18, anchorRect.left - appRect.left));
        const top = Math.max(18, Math.min(appRect.height - 140, anchorRect.bottom - appRect.top + 8));
        els.dateFlyout.style.left = `${left}px`;
        els.dateFlyout.style.top = `${top}px`;
        playEnterAnimation(els.dateFlyout);
        els.dateInput.focus();
    }

    function toggleDateFlyout() {
        if (state.dateFlyoutOpen) {
            closeDateFlyout();
        } else {
            closeEventFlyout();
            openDateFlyout();
        }
    }

    function closeEventFlyout() {
        state.eventFlyoutOpen = false;
        state.selectedEventId = null;
        els.eventFlyout.hidden = true;
    }

    function closeContextMenu() {
        state.contextMenuOpen = false;
        state.contextMenuContext = null;
        els.contextMenu.hidden = true;
        els.contextMenuActions.innerHTML = '';
    }

    function closeDeleteConfirm() {
        state.deleteConfirmOpen = false;
        state.deleteConfirmContext = null;
        els.deleteConfirm.hidden = true;
        els.deleteConfirmCopy.textContent = '';
    }

    function getPreferredCalendar() {
        return state.calendars.find((calendar) => !calendar.hidden && calendar.primary)
            || state.calendars.find((calendar) => !calendar.hidden)
            || state.calendars[0]
            || DEFAULT_CALENDARS[0];
    }

    function formatQuickEventMeta(context) {
        if (!context) {
            return '';
        }

        if (context.allDay) {
            return `${formatLongDate(context.date)} \u2022 All day`;
        }

        const endLabel = context.hour >= 23 ? '11:59 PM' : formatHourLabel(context.hour + 1);
        return `${formatLongDate(context.date)} \u2022 ${formatHourLabel(context.hour)} - ${endLabel}`;
    }

    function updateQuickEventHints() {
        els.quickEventSubjectHint.hidden = Boolean(els.quickEventSubject.value);
        els.quickEventLocationHint.hidden = Boolean(els.quickEventLocation.value);
    }

    function getQuickEventAvailableCalendars() {
        return state.calendars.filter((calendar) => !calendar.hidden);
    }

    function getQuickEventSelectedCalendar() {
        const selectedCalendarId = state.quickEventContext?.calendarId || state.lastQuickEventCalendarId;
        return state.calendars.find((calendar) => calendar.id === selectedCalendarId)
            || getPreferredCalendar();
    }

    function getQuickEventCalendarMeta(calendar) {
        const title = calendar?.title || calendar?.id || 'Calendar';
        let subtitle = '';
        if (calendar?.id && calendar.id !== title && String(calendar.id).includes('@')) {
            subtitle = calendar.id;
        } else if (calendar?.primary && state.profile?.email && state.profile.email !== title) {
            subtitle = state.profile.email;
        }
        return { title, subtitle };
    }

    function closeQuickEventCalendarMenu() {
        els.quickEventCalendarMenu.hidden = true;
        els.quickEventCalendarMenu.innerHTML = '';
        els.quickEventCalendarButton.setAttribute('aria-expanded', 'false');
    }

    function updateQuickEventCalendarAccent() {
        const selectedCalendar = getQuickEventSelectedCalendar();
        const color = selectedCalendar?.color || DEFAULT_EVENT_COLOR;
        els.quickEventGlyph.style.backgroundColor = color;
        els.quickEventSubject.style.color = color;
        els.quickEventCalendarButton.style.color = '#262626';
        els.quickEventCalendarButton.setAttribute('aria-label', `Choose calendar. Current calendar: ${getQuickEventCalendarMeta(selectedCalendar).title}`);
    }

    function selectQuickEventCalendar(calendarId) {
        if (!state.quickEventContext) {
            return;
        }

        state.quickEventContext.calendarId = calendarId;
        state.lastQuickEventCalendarId = calendarId;
        savePreferences();
        updateQuickEventCalendarAccent();
        closeQuickEventCalendarMenu();
    }

    function openQuickEventCalendarMenu() {
        const availableCalendars = getQuickEventAvailableCalendars();
        if (!state.quickEventOpen || availableCalendars.length <= 1) {
            return;
        }

        const selectedCalendar = getQuickEventSelectedCalendar();
        els.quickEventCalendarMenu.innerHTML = availableCalendars.map((calendar) => {
            const meta = getQuickEventCalendarMeta(calendar);
            return `
                <button class="calendar-quick-event-calendar-menu__entry${selectedCalendar?.id === calendar.id ? ' is-selected' : ''}" type="button" data-quick-event-calendar="${escapeHtml(calendar.id)}" aria-label="${escapeHtml(`${meta.title}${meta.subtitle ? ` ${meta.subtitle}` : ''}`)}">
                    <span class="calendar-quick-event-calendar-menu__color" style="background:${getEventColor({ calendarId: calendar.id })}"></span>
                    <span class="calendar-quick-event-calendar-menu__content">
                        <span class="calendar-quick-event-calendar-menu__title">${escapeHtml(meta.title)}</span>
                        <span class="calendar-quick-event-calendar-menu__subtitle">${escapeHtml(meta.subtitle || '')}</span>
                    </span>
                </button>
            `;
        }).join('');
        els.quickEventCalendarMenu.hidden = false;
        els.quickEventCalendarButton.setAttribute('aria-expanded', 'true');

        const appRect = els.app.getBoundingClientRect();
        const buttonRect = els.quickEventCalendarTrigger.getBoundingClientRect();
        const quickEventRect = els.quickEvent.getBoundingClientRect();
        const menuWidth = els.quickEventCalendarMenu.offsetWidth || 240;
        const menuHeight = els.quickEventCalendarMenu.offsetHeight || 164;
        const left = Math.max(18, Math.min(appRect.width - menuWidth - 18, quickEventRect.right - appRect.left - menuWidth + 2));
        const belowTop = buttonRect.bottom - appRect.top + 4;
        const aboveTop = buttonRect.top - appRect.top - menuHeight - 4;
        const top = belowTop + menuHeight <= appRect.height - 18
            ? belowTop
            : Math.max(18, aboveTop);
        els.quickEventCalendarMenu.style.left = `${left}px`;
        els.quickEventCalendarMenu.style.top = `${top}px`;
        playEnterAnimation(els.quickEventCalendarMenu);
    }

    function closeQuickEvent() {
        state.quickEventOpen = false;
        state.quickEventContext = null;
        els.quickEvent.hidden = true;
        els.quickEventSubject.value = '';
        els.quickEventLocation.value = '';
        closeQuickEventCalendarMenu();
        updateQuickEventHints();
    }

    function openDeleteConfirm(eventData, anchorX, anchorY) {
        closeContextMenu();
        closeEventFlyout();
        closeQuickEvent();

        state.deleteConfirmOpen = true;
        state.deleteConfirmContext = {
            eventId: eventData.id
        };
        els.deleteConfirmCopy.textContent = `"${eventData.title}" will be removed${eventData.source === 'google' ? ' from Google Calendar.' : '.'}`;
        els.deleteConfirm.hidden = false;

        const appRect = els.app.getBoundingClientRect();
        const panelWidth = els.deleteConfirm.offsetWidth || 280;
        const panelHeight = els.deleteConfirm.offsetHeight || 140;
        const left = Math.max(18, Math.min(appRect.width - panelWidth - 18, anchorX - appRect.left - (panelWidth / 2)));
        const belowTop = anchorY - appRect.top + 14;
        const aboveTop = anchorY - appRect.top - panelHeight - 14;
        const top = belowTop + panelHeight <= appRect.height - 18
            ? belowTop
            : Math.max(18, aboveTop);

        els.deleteConfirm.style.left = `${left}px`;
        els.deleteConfirm.style.top = `${top}px`;
        playEnterAnimation(els.deleteConfirm);
        els.deleteConfirmDelete.focus();
    }

    function openQuickEvent(context) {
        closeDateFlyout();
        closeEventFlyout();
        closeContextMenu();
        closeQuickEventCalendarMenu();

        const availableCalendars = getQuickEventAvailableCalendars();
        const fallbackCalendar = getPreferredCalendar();
        const defaultCalendar = availableCalendars.find((calendar) => calendar.id === context.calendarId)
            || availableCalendars.find((calendar) => calendar.id === state.lastQuickEventCalendarId)
            || fallbackCalendar;
        state.quickEventOpen = true;
        state.quickEventContext = {
            ...context,
            calendarId: defaultCalendar?.id || fallbackCalendar?.id || ''
        };
        els.quickEventCalendarButton.hidden = availableCalendars.length <= 1;

        els.quickEvent.classList.toggle('is-all-day', Boolean(context.allDay));
        els.quickEventMeta.textContent = formatQuickEventMeta(context);
        updateQuickEventHints();
        updateQuickEventCalendarAccent();
        els.quickEvent.hidden = false;

        const appRect = els.app.getBoundingClientRect();
        const panelWidth = els.quickEvent.offsetWidth || 320;
        const panelHeight = els.quickEvent.offsetHeight || 170;
        const left = Math.max(18, Math.min(appRect.width - panelWidth - 18, context.anchorX - appRect.left));
        const belowTop = context.anchorY - appRect.top + 14;
        const aboveTop = context.anchorY - appRect.top - panelHeight - 14;
        const top = belowTop + panelHeight <= appRect.height - 18
            ? belowTop
            : Math.max(18, aboveTop);

        els.quickEvent.style.left = `${left}px`;
        els.quickEvent.style.top = `${top}px`;
        playEnterAnimation(els.quickEvent);
        els.quickEventSubject.focus();
    }

    function openEventFlyout(eventData, pointerX, pointerY) {
        state.eventFlyoutOpen = true;
        state.selectedEventId = eventData.id;
        els.eventFlyoutCalendar.textContent = getEventCalendar(eventData)?.title || 'Calendar';
        els.eventFlyoutCalendar.style.color = getEventColor(eventData);
        els.eventFlyoutTitle.textContent = eventData.title;
        els.eventFlyoutTime.textContent = eventTimeLabel(eventData);
        els.eventFlyoutLocation.textContent = eventData.location || eventData.description || 'No additional details';
        els.eventFlyoutDelete.disabled = Boolean(state.readOnly && eventData.source === 'google');
        els.eventFlyout.hidden = false;

        const appRect = els.app.getBoundingClientRect();
        const relativeX = pointerX - appRect.left;
        const relativeY = pointerY - appRect.top;
        const flyoutWidth = els.eventFlyout.offsetWidth || 290;
        const flyoutHeight = els.eventFlyout.offsetHeight || 180;
        const left = Math.max(18, Math.min(appRect.width - flyoutWidth - 18, relativeX - (flyoutWidth / 2)));
        const preferBelowTop = relativeY + 12;
        const preferAboveTop = relativeY - flyoutHeight - 12;
        const top = preferBelowTop + flyoutHeight <= appRect.height - 18
            ? preferBelowTop
            : Math.max(76, preferAboveTop);
        els.eventFlyout.style.left = `${left}px`;
        els.eventFlyout.style.top = `${top}px`;
        playEnterAnimation(els.eventFlyout);
    }

    function openContextMenu(menuContext) {
        const items = menuContext.type === 'event'
            ? [
                { action: 'open-event', label: 'Open' },
                { action: 'go-to-day', label: 'Go to day' },
                { action: 'view-in-month', label: 'View in month' },
                { action: 'new-event', label: 'New event here' },
                { action: 'delete-event', label: 'Delete', disabled: Boolean(state.readOnly && getEventById(menuContext.eventId)?.source === 'google') }
            ]
            : [
                { action: 'new-event', label: menuContext.hour === null ? 'New all-day event' : 'New event here' },
                { action: 'go-to-day', label: 'Go to day' },
                { action: 'view-in-month', label: 'View in month' }
            ];

        closeDateFlyout();
        closeEventFlyout();
        state.contextMenuOpen = true;
        state.contextMenuContext = menuContext;
        els.contextMenuTitle.textContent = menuContext.title;
        els.contextMenuActions.innerHTML = items
            .map((item) => `<button class="calendar-context-menu__action${item.disabled ? ' is-disabled' : ''}" type="button" data-context-action="${escapeHtml(item.action)}"${item.disabled ? ' disabled' : ''}>${escapeHtml(item.label)}</button>`)
            .join('');
        els.contextMenu.hidden = false;

        const appRect = els.app.getBoundingClientRect();
        const flyoutWidth = els.contextMenu.offsetWidth || 220;
        const flyoutHeight = els.contextMenu.offsetHeight || (items.length * 44) + 40;
        const left = Math.max(18, Math.min(appRect.width - flyoutWidth - 18, menuContext.anchorX - appRect.left));
        const top = Math.max(18, Math.min(appRect.height - flyoutHeight - 18, menuContext.anchorY - appRect.top));
        els.contextMenu.style.left = `${left}px`;
        els.contextMenu.style.top = `${top}px`;
        playEnterAnimation(els.contextMenu);
    }

    function hideTransientUi() {
        closeDateFlyout();
        closeEventFlyout();
        closeContextMenu();
        closeDeleteConfirm();
        closeQuickEvent();
    }

    function normalizeMockData() {
        state.calendars = applyPreferencesToCalendars(DEFAULT_CALENDARS);
        CALENDAR_EVENTS = deepClone(DEFAULT_CALENDAR_EVENTS);
        state.googleConnected = false;
        state.readOnly = false;
        state.profile = null;
        invalidateRenderCaches();
    }

    function applyCalendarBootstrapData(result, options = {}) {
        const preserveSelection = options.preserveSelection !== false;
        const previousSelectedDate = new Date(state.selectedDate);
        state.calendars = applyPreferencesToCalendars(Array.isArray(result.calendars) && result.calendars.length
            ? result.calendars
            : DEFAULT_CALENDARS);
        CALENDAR_EVENTS = Array.isArray(result.events) ? result.events : [];
        state.googleConnected = true;
        state.readOnly = Boolean(result.readOnly);
        state.profile = result.profile || null;

        if (preserveSelection) {
            state.selectedDate = previousSelectedDate;
        } else if (CALENDAR_EVENTS.length) {
            const nextDate = parseEventDate(CALENDAR_EVENTS[0].date);
            if (!Number.isNaN(nextDate.valueOf())) {
                state.selectedDate = nextDate;
            }
        }

        invalidateRenderCaches();
        scheduleNextGoogleRefresh(result.cache, { retrySoon: Boolean(result.cache?.stale) });
    }

    async function loadGoogleCalendarData(options = {}) {
        if (!electronIpc?.invoke) {
            return false;
        }

        try {
            const result = await electronIpc.invoke('google-calendar:get-bootstrap-data', {
                forceRefresh: Boolean(options.forceRefresh),
                allowStale: options.allowStale !== false
            });
            if (!result?.success) {
                scheduleNextGoogleRefresh(null, { retrySoon: state.googleConnected });
                return false;
            }

            applyCalendarBootstrapData(result, {
                preserveSelection: options.preserveSelection !== false
            });
            renderAll();
            updateCalendarSettingsPanels();

            if (!options.quiet && result.cache?.stale) {
                showToast('Showing cached calendar data.');
            } else if (!options.quiet) {
                showToast('Google Calendar connected.');
            }

            return true;
        } catch (error) {
            console.warn('[Calendar] Failed to load Google Calendar data:', error);
            scheduleNextGoogleRefresh(null, { retrySoon: state.googleConnected });
            return false;
        }
    }

    async function connectGoogleCalendar() {
        if (!electronIpc?.invoke) {
            showToast('Google sign-in is only available in the Electron app.');
            return;
        }

        try {
            const signInResult = await electronIpc.invoke('google-auth:sign-in');
            if (!signInResult?.success) {
                showToast('Google sign-in did not complete.');
                return;
            }

            const loaded = await loadGoogleCalendarData({ quiet: true, forceRefresh: true, preserveSelection: false });
            if (loaded) {
                showToast('Google Calendar connected.');
            }
        } catch (error) {
            console.warn('[Calendar] Google sign-in failed:', error);
            showToast('Google sign-in failed.');
        }
    }

    async function disconnectGoogleCalendar() {
        if (!electronIpc?.invoke) {
            return;
        }

        try {
            await electronIpc.invoke('google-auth:sign-out');
            normalizeMockData();
            scheduleNextGoogleRefresh(null);
            renderAll();
            updateCalendarSettingsPanels();
            showToast('Google Calendar disconnected.');
        } catch (error) {
            console.warn('[Calendar] Google sign-out failed:', error);
            showToast('Google sign-out failed.');
        }
    }

    function eventTimeLabel(event) {
        return event.allDay ? 'All day' : `${formatClockTime(event.start)} - ${formatClockTime(event.end)}`;
    }

    function eventHeroText(event) {
        if (event.allDay) {
            return '';
        }

        return formatCompactClockTime(event.start);
    }

    function isEventActiveOnDate(event, date) {
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const eventStart = getEventStartDateTime(event);
        const eventEnd = getEventEndDateTime(event);
        return eventStart < dayEnd && eventEnd >= dayStart;
    }

    function isAgendaAllDayEvent(event, date) {
        if (event.allDay) {
            return isEventActiveOnDate(event, date);
        }

        const eventStart = getEventStartDateTime(event);
        const eventEnd = getEventEndDateTime(event);
        return isEventActiveOnDate(event, date) && (eventEnd - eventStart) >= (24 * 60 * 60 * 1000);
    }

    function getAgendaHeroHeaderText(event, nowDate) {
        if (!event || event.allDay) {
            return '';
        }

        const startDate = getEventStartDateTime(event);
        const endDate = getEventEndDateTime(event);
        const tomorrow = new Date(nowDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const minuteDelta = Math.round((startDate.getTime() - nowDate.getTime()) / (60 * 1000));

        if (sameDay(startDate, tomorrow)) {
            return 'Tomorrow';
        }
        if (startDate <= nowDate && endDate > nowDate) {
            return 'Now';
        }
        if (minuteDelta === 1) {
            return 'In 1 minute';
        }
        if (minuteDelta > 1 && minuteDelta <= 15) {
            return `In ${minuteDelta} minutes`;
        }
        if (sameDay(startDate, nowDate)) {
            return 'Up next';
        }
        return '';
    }

    function buildAgendaAllDayHeroHtml(date) {
        const heroItems = getVisibleEvents()
            .filter((event) => isAgendaAllDayEvent(event, date))
            .sort((left, right) => getEventStartDateTime(left) - getEventStartDateTime(right));

        if (!heroItems.length) {
            return '';
        }

        const visibleItems = heroItems.slice(0, 3);
        const remainingCount = Math.max(0, heroItems.length - visibleItems.length);
        return `
            <div class="calendar-agenda-all-day__container" role="list">
                ${visibleItems.map((event) => {
                    const eventStart = getEventStartDateTime(event);
                    const eventEnd = getEventEndDateTime(event);
                    const startLabel = !event.allDay && !sameDay(eventStart, date) ? formatShortDate(eventStart) : '';
                    const endLabel = !event.allDay && !sameDay(eventEnd, date) ? formatShortDate(eventEnd) : '';
                    return `
                        <button class="calendar-agenda-all-day__event" type="button" data-event-id="${escapeHtml(event.id)}" role="listitem">
                            ${startLabel ? `<span class="calendar-agenda-all-day__edge">${escapeHtml(startLabel)}</span>` : ''}
                            <span class="calendar-agenda-all-day__subject">${escapeHtml(event.title)}</span>
                            ${endLabel ? `<span class="calendar-agenda-all-day__edge">${escapeHtml(endLabel)}</span>` : ''}
                        </button>
                    `;
                }).join('')}
                ${remainingCount > 0 ? `<div class="calendar-agenda-all-day__more">${remainingCount} more</div>` : ''}
            </div>
        `;
    }

    function parseTimeToMinutes(value) {
        const [hours, minutes] = String(value || '00:00').split(':').map((item) => Number.parseInt(item, 10) || 0);
        return hours * 60 + minutes;
    }

    function eventStartOffset(event) {
        if (event.allDay) {
            return 6;
        }

        return parseTimeToMinutes(event.start) * 0.4;
    }

    function eventDuration(event, minimumHeight) {
        if (event.allDay) {
            return minimumHeight;
        }

        return Math.max(minimumHeight, (parseTimeToMinutes(event.end) - parseTimeToMinutes(event.start)) * 0.4);
    }

    function getTimelineDates(mode, anchorDate = state.selectedDate) {
        if (mode === 'day') {
            return [new Date(anchorDate)];
        }

        const start = mode === 'workweek' ? startOfWorkWeek(anchorDate) : startOfWeek(anchorDate);
        const count = mode === 'workweek' ? 5 : 7;
        return Array.from({ length: count }, (_unused, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            return date;
        });
    }

    function goToAdjacentRange(direction) {
        const nextDate = new Date(state.selectedDate);
        if (state.activeView === 'month') {
            nextDate.setMonth(nextDate.getMonth() + direction);
        } else if (state.activeView === 'week' || state.activeView === 'workweek') {
            nextDate.setDate(nextDate.getDate() + direction * 7);
        } else {
            nextDate.setDate(nextDate.getDate() + direction);
        }
        setSelectedDate(nextDate);
    }

    function getMonthAnchor(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function getMonthOffset(date, offset) {
        return new Date(date.getFullYear(), date.getMonth() + offset, 1);
    }

    function clampMonthDate(anchorDate, targetDay) {
        const lastDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
        return new Date(anchorDate.getFullYear(), anchorDate.getMonth(), Math.min(targetDay, lastDay));
    }

    function getEventStartDateTime(event) {
        const date = String(event.date || '').slice(0, 10);
        const time = event.allDay ? '00:00' : (event.start || '00:00');
        return new Date(`${date}T${time}:00`);
    }

    function getEventEndDateTime(event) {
        if (event.endDateTime) {
            return new Date(event.endDateTime);
        }

        if (event.endDate) {
            const date = String(event.endDate).slice(0, 10);
            const time = event.allDay ? '23:59' : (event.end || '23:59');
            return new Date(`${date}T${time}:00`);
        }

        const date = String(event.date || '').slice(0, 10);
        const time = event.allDay ? '23:59' : (event.end || event.start || '23:59');
        const endDateTime = new Date(`${date}T${time}:00`);
        const startDateTime = getEventStartDateTime(event);
        if (endDateTime < startDateTime) {
            endDateTime.setDate(endDateTime.getDate() + 1);
        }
        return endDateTime;
    }

    function resetMonthWheelAccumulation() {
        monthWheelAccumulation = 0;
        if (monthWheelResetTimer) {
            window.clearTimeout(monthWheelResetTimer);
            monthWheelResetTimer = null;
        }
    }

    function centerMonthTimeline() {
        if (!els.monthTimeline) {
            return;
        }

        const pageWidth = els.monthTimeline.clientWidth;
        if (!pageWidth) {
            return;
        }

        monthTimelineRecentering = true;
        els.monthTimeline.scrollLeft = pageWidth * MONTH_TIMELINE_CENTER_INDEX;
        window.requestAnimationFrame(() => {
            monthTimelineRecentering = false;
        });
    }

    function commitMonthTimelineScroll() {
        if (!els.monthTimeline || state.activeView !== 'month' || monthTimelineRecentering) {
            return;
        }

        const pageWidth = els.monthTimeline.clientWidth;
        if (!pageWidth) {
            return;
        }

        const pageIndex = Math.round(els.monthTimeline.scrollLeft / pageWidth);
        const monthOffset = pageIndex - MONTH_TIMELINE_CENTER_INDEX;
        if (monthOffset === 0) {
            return;
        }

        const anchorDate = getMonthOffset(getMonthAnchor(state.selectedDate), monthOffset);
        setSelectedDate(clampMonthDate(anchorDate, state.selectedDate.getDate()));
    }

    function handleMonthTimelineScroll() {
        if (state.activeView !== 'month' || monthTimelineRecentering) {
            return;
        }

        if (monthScrollCommitTimer) {
            window.clearTimeout(monthScrollCommitTimer);
        }

        monthScrollCommitTimer = window.setTimeout(() => {
            commitMonthTimelineScroll();
        }, 96);
    }

    function handleMonthTimelineWheel(event) {
        if (state.activeView !== 'month') {
            return;
        }

        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) {
            return;
        }

        event.preventDefault();
        monthWheelAccumulation += delta;
        const threshold = Math.max(56, (els.monthTimeline?.clientWidth || 560) * 0.1);
        if (Math.abs(monthWheelAccumulation) >= threshold) {
            goToAdjacentRange(monthWheelAccumulation > 0 ? 1 : -1);
            resetMonthWheelAccumulation();
            return;
        }

        if (monthWheelResetTimer) {
            window.clearTimeout(monthWheelResetTimer);
        }
        monthWheelResetTimer = window.setTimeout(() => {
            resetMonthWheelAccumulation();
        }, 220);
    }

    function getTimelineElements(mode) {
        if (mode === 'week') {
            return {
                scroller: els.weekGrid,
                strip: els.weekStrip
            };
        }
        if (mode === 'workweek') {
            return {
                scroller: els.workweekGrid,
                strip: els.workweekStrip
            };
        }
        if (mode === 'day') {
            return {
                scroller: els.dayTimeline,
                strip: els.dayStrip
            };
        }
        return {
            scroller: null,
            strip: null
        };
    }

    function getTimelineStepDays(mode) {
        return mode === 'day' ? 1 : 7;
    }

    function getTimelineBaseDate(mode, offset = 0) {
        const baseDate = new Date(state.selectedDate);
        baseDate.setDate(baseDate.getDate() + (offset * getTimelineStepDays(mode)));
        return baseDate;
    }

    function resetViewWheelAccumulation() {
        viewWheelAccumulation = 0;
        if (viewWheelResetTimer) {
            window.clearTimeout(viewWheelResetTimer);
            viewWheelResetTimer = null;
        }
    }

    function centerViewTimeline(mode) {
        const { scroller } = getTimelineElements(mode);
        if (!scroller) {
            return;
        }

        const pageWidth = scroller.clientWidth;
        if (!pageWidth) {
            return;
        }

        viewTimelineRecentering = true;
        scroller.scrollLeft = pageWidth * TIMELINE_CENTER_INDEX;
        window.requestAnimationFrame(() => {
            viewTimelineRecentering = false;
        });
    }

    function commitViewTimelineScroll(mode) {
        const { scroller } = getTimelineElements(mode);
        if (!scroller || state.activeView !== mode || viewTimelineRecentering) {
            return;
        }

        const pageWidth = scroller.clientWidth;
        if (!pageWidth) {
            return;
        }

        const pageIndex = Math.round(scroller.scrollLeft / pageWidth);
        const offset = pageIndex - TIMELINE_CENTER_INDEX;
        if (offset === 0) {
            return;
        }

        setSelectedDate(getTimelineBaseDate(mode, offset));
    }

    function handleViewTimelineScroll(mode) {
        if (state.activeView !== mode || viewTimelineRecentering) {
            return;
        }

        if (viewScrollCommitTimer) {
            window.clearTimeout(viewScrollCommitTimer);
        }

        viewScrollCommitTimer = window.setTimeout(() => {
            commitViewTimelineScroll(mode);
        }, 96);
    }

    function handleViewTimelineWheel(mode, event) {
        if (state.activeView !== mode) {
            return;
        }

        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) {
            return;
        }

        event.preventDefault();
        viewWheelAccumulation += delta;
        const { scroller } = getTimelineElements(mode);
        const threshold = Math.max(56, (scroller?.clientWidth || 560) * 0.1);
        if (Math.abs(viewWheelAccumulation) >= threshold) {
            goToAdjacentRange(viewWheelAccumulation > 0 ? 1 : -1);
            resetViewWheelAccumulation();
            return;
        }

        if (viewWheelResetTimer) {
            window.clearTimeout(viewWheelResetTimer);
        }
        viewWheelResetTimer = window.setTimeout(() => {
            resetViewWheelAccumulation();
        }, 220);
    }

    function updateHeader() {
        els.dateLabel.textContent = state.activeView === 'month'
            ? formatMonthAnchor(state.selectedDate)
            : formatLongDate(state.selectedDate);

        const selectedEvents = eventsForDate(state.selectedDate);
        els.selectionSummary.textContent = selectedEvents.length
            ? `${selectedEvents.length} event${selectedEvents.length === 1 ? '' : 's'} on ${formatShortDate(state.selectedDate)}`
            : '';

        const agendaAnchorDate = new Date(today);
        els.agendaDate.textContent = formatAgendaHeroDate(agendaAnchorDate);
        els.agendaDate.dataset.agendaDate = agendaAnchorDate.toISOString();
        els.agendaAllDay.innerHTML = buildAgendaAllDayHeroHtml(agendaAnchorDate);
        els.agendaAllDay.hidden = !els.agendaAllDay.innerHTML;
    }

    function renderMonthHeaders() {
        const key = 'month-headers';
        if (renderCache.monthHeaders.key !== key) {
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            renderCache.monthHeaders.key = key;
            renderCache.monthHeaders.html = dayNames
                .map((day) => `<div class="calendar-month-header">${day}</div>`)
                .join('');
        }
        setElementMarkup(els.monthHeaders, key, renderCache.monthHeaders.html);
        els.monthHeaders.classList.toggle('is-hidden', state.activeView !== 'month');
    }

    function getMonthPageModel(monthDate) {
        const monthAnchor = getMonthAnchor(monthDate);
        const firstDayOffset = monthAnchor.getDay();
        const numDays = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
        const numWeeks = Math.ceil((numDays + firstDayOffset) / 7);
        const gridStart = new Date(monthAnchor);
        gridStart.setDate(1 - firstDayOffset);
        return {
            monthAnchor,
            firstDayOffset,
            numDays,
            numWeeks,
            gridStart
        };
    }

    function buildMonthPageHtml(monthDate, relativeOffset) {
        const model = getMonthPageModel(monthDate);
        const cells = [];
        const cellCount = model.numWeeks * 7;

        for (let index = 0; index < cellCount; index += 1) {
            const day = new Date(model.gridStart);
            day.setDate(model.gridStart.getDate() + index);
            const dayEvents = eventsForDate(day).slice().sort((left, right) => {
                if (Boolean(left.allDay) !== Boolean(right.allDay)) {
                    return left.allDay ? -1 : 1;
                }
                return getEventStartDateTime(left) - getEventStartDateTime(right);
            });
            const visibleEvents = dayEvents.slice(0, 2);
            const overflowCount = Math.max(0, dayEvents.length - visibleEvents.length);
            const isOtherMonth = day.getMonth() !== model.monthAnchor.getMonth();
            const classes = [
                'calendar-month-cell',
                isOtherMonth ? 'is-other-month' : '',
                sameDay(day, today) ? 'is-today' : '',
                sameDay(day, state.selectedDate) ? 'is-selected' : ''
            ].filter(Boolean).join(' ');

            cells.push(`
                <div class="${classes}" tabIndex="0" role="button" data-date="${day.toISOString()}">
                    <div class="calendar-month-cell__date">${day.getDate()}</div>
                    ${dayEvents.length ? `<div class="calendar-month-cell__count">${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}</div>` : ''}
                    <div class="calendar-month-cell__events">
                        ${visibleEvents.map((event) => `
                            <div class="calendar-month-event" data-event-id="${escapeHtml(event.id)}">
                                <span class="calendar-month-event__glyph" style="background:${getEventColor(event)}"></span>
                                <span class="calendar-month-event__title" style="color:${getEventColor(event)}">${escapeHtml(event.title)}</span>
                                <span class="calendar-month-event__time">${escapeHtml(event.allDay ? '' : eventHeroText(event))}</span>
                            </div>
                        `).join('')}
                    </div>
                    ${overflowCount > 0 ? `<button class="calendar-month-cell__overflow" type="button" data-overflow-date="${day.toISOString()}">${overflowCount} more</button>` : ''}
                </div>
            `);
        }

        return `
            <div class="calendar-month-page${relativeOffset === 0 ? ' is-focused' : ''}" data-month-offset="${relativeOffset}" data-month-anchor="${model.monthAnchor.toISOString()}">
                <div class="calendar-month-grid" style="grid-template-rows: repeat(${model.numWeeks}, minmax(0, 1fr));">
                    ${cells.join('')}
                </div>
            </div>
        `;
    }

    function renderMonth() {
        const monthAnchor = getMonthAnchor(state.selectedDate);
        const key = `month:${calendarDataRevision}:${monthAnchor.toISOString().slice(0, 10)}:${state.selectedDate.getDate()}`;
        const markup = getCachedMarkup(renderCache.month, key, () => {
            const pages = [];
            for (let index = 0; index < MONTH_TIMELINE_PAGE_COUNT; index += 1) {
                const relativeOffset = index - MONTH_TIMELINE_CENTER_INDEX;
                pages.push(buildMonthPageHtml(getMonthOffset(monthAnchor, relativeOffset), relativeOffset));
            }
            return pages.join('');
        });

        setElementMarkup(els.monthGrid, key, markup);
        if (state.activeView === 'month') {
            centerMonthTimeline();
        }
    }

    function buildTimelineHtml(mode, anchorDate = state.selectedDate) {
        const dates = getTimelineDates(mode, anchorDate);
        const template = `repeat(${dates.length}, minmax(0, 1fr))`;
        const dateDetails = dates.map((date) => {
            const dayEvents = eventsForDate(date);
            return {
                date,
                isWeekend: date.getDay() === 0 || date.getDay() === 6,
                allDayEvents: dayEvents.filter((event) => event.allDay),
                timedEvents: dayEvents.filter((event) => !event.allDay)
            };
        });
        const allDayRowCount = Math.max(1, ...dateDetails.map((item) => item.allDayEvents.length || 1));
        const allDayRowHeight = allDayRowCount * 31;
        const hourLabels = Array.from({ length: 24 }, (_, hour) => `
            <div class="calendar-timeline__hour">${formatTimelineHourLabel(hour)}</div>
        `).join('');

        return `
            <div class="calendar-timeline" style="grid-template-rows:32px ${allDayRowHeight}px 1fr;">
                <div class="calendar-timeline__corner"></div>
                <div class="calendar-timeline__headers" style="grid-template-columns:${template}">
                    ${dates.map((date) => `
                        <div class="calendar-timeline__header${sameDay(date, today) ? ' is-today' : ''}">
                            ${date.toLocaleDateString('en-US', { weekday: mode === 'day' ? 'long' : 'short' })} <strong>${date.getDate()}</strong>
                        </div>
                    `).join('')}
                </div>
                <div class="calendar-timeline__allDayCorner"></div>
                <div class="calendar-timeline__allDay" style="grid-template-columns:${template}">
                    ${dateDetails.map(({ date, isWeekend, allDayEvents }) => `
                        <div class="calendar-timeline__allDayCell${mode === 'day' ? ' is-day' : ''}${isWeekend ? ' is-weekend' : ''}" data-all-day-date="${date.toISOString()}">
                            <div class="calendar-timeline__allDayEvents">
                                ${allDayEvents.map((event, index) => `
                                    <button class="calendar-timeline__event calendar-timeline__event--all-day" type="button" data-event-id="${escapeHtml(event.id)}" style="top:${index * 31}px;left:0;right:0;height:31px;">
                                        <span class="calendar-timeline__eventGlyph" style="background:${getEventColor(event)}"></span>
                                        <span class="calendar-timeline__eventBody">
                                            <span class="calendar-timeline__eventTitle" style="color:${getEventColor(event)}">${escapeHtml(event.title)}</span>
                                            <span class="calendar-timeline__eventTime">All day</span>
                                        </span>
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="calendar-timeline__hours">${hourLabels}</div>
                <div class="calendar-timeline__body" style="grid-template-columns:${template}">
                    ${dateDetails.map(({ date, isWeekend, timedEvents }) => {
                        return `
                            <div class="calendar-timeline__column${mode === 'day' ? ' is-day' : ''}${isWeekend ? ' is-weekend' : ''}" data-timeline-date="${date.toISOString()}">
                                <div class="calendar-timeline__grid"></div>
                                <div class="calendar-timeline__eventLayer">
                                    ${timedEvents.map((event, eventIndex) => {
                                        const startOffset = eventStartOffset(event);
                                        const duration = eventDuration(event, mode === 'day' ? 40 : 34);
                                        const overlapOffset = timedEvents.length > 1 ? (eventIndex % 2) * 10 : 0;
                                        const rightInset = timedEvents.length > 1 ? (eventIndex % 2 === 0 ? 12 : 2) : 2;
                                        const shortClass = duration <= 34 ? ' is-short' : '';
                                        return `
                                            <button class="calendar-timeline__event${shortClass}" type="button" data-event-id="${escapeHtml(event.id)}" style="top:${startOffset}px;left:${overlapOffset}px;right:${rightInset}px;height:${duration}px;">
                                                <span class="calendar-timeline__eventGlyph" style="background:${getEventColor(event)}"></span>
                                                <span class="calendar-timeline__eventBody">
                                                    <span class="calendar-timeline__eventTitle" style="color:${getEventColor(event)}">${escapeHtml(event.title)}</span>
                                                    <span class="calendar-timeline__eventTime">${escapeHtml(eventTimeLabel(event))}</span>
                                                    ${event.location ? `<span class="calendar-timeline__eventLocation">${escapeHtml(event.location)}</span>` : ''}
                                                </span>
                                            </button>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function buildTimelinePagesHtml(mode) {
        const pages = [];
        for (let index = 0; index < TIMELINE_PAGE_COUNT; index += 1) {
            const relativeOffset = index - TIMELINE_CENTER_INDEX;
            pages.push(`
                <div class="calendar-timeline-page${relativeOffset === 0 ? ' is-focused' : ''}" data-timeline-page="${relativeOffset}">
                    ${buildTimelineHtml(mode, getTimelineBaseDate(mode, relativeOffset))}
                </div>
            `);
        }
        return pages.join('');
    }

    function renderTimelineView(mode) {
        const anchorDate = getTimelineBaseDate(mode, 0);
        const key = `${mode}:${calendarDataRevision}:${anchorDate.toISOString().slice(0, 10)}`;
        const markup = getCachedMarkup(renderCache[mode], key, () => buildTimelinePagesHtml(mode));
        const { strip } = getTimelineElements(mode);
        setElementMarkup(strip, key, markup);
        centerViewTimeline(mode);
    }

    function renderAgenda() {
        const nowDate = new Date(currentNow);
        const minuteKey = getClockMinuteKey(currentNow);
        const key = `agenda:${calendarDataRevision}:${today.toISOString().slice(0, 10)}:${minuteKey}`;
        const markup = getCachedMarkup(renderCache.agenda, key, () => {
        const agendaEvents = getVisibleEvents()
            .map((event) => ({
                ...event,
                parsedDate: parseEventDate(event.date),
                startDateTime: getEventStartDateTime(event),
                endDateTime: getEventEndDateTime(event)
            }))
            .filter((event) => event.endDateTime >= today)
            .sort((a, b) => a.startDateTime - b.startDateTime);

        if (!agendaEvents.length) {
            return '<div class="calendar-agenda-textCard">No upcoming events.</div>';
        }

        const groups = [];
        let heroAssigned = false;
        agendaEvents.slice(0, 24).forEach((event) => {
            let group = groups.find((item) => item.key === event.date);
            if (!group) {
                group = { key: event.date, date: event.parsedDate, events: [] };
                groups.push(group);
            }
            const heroLabel = !heroAssigned ? getAgendaHeroHeaderText(event, nowDate) : '';
            if (heroLabel) {
                heroAssigned = true;
            }
            event.heroLabel = heroLabel;
            group.events.push(event);
        });

        return groups.map((group) => `
            <div class="calendar-agenda-group">
                <button class="calendar-agenda-group__header" type="button" data-agenda-date="${group.date.toISOString()}">${escapeHtml(formatAgendaHeader(group.date))}</button>
                <div class="calendar-agenda-group__cards">
                    ${group.events.map((event) => `
                        <button class="calendar-agenda-card" type="button" data-event-id="${escapeHtml(event.id)}" data-status="busy">
                            <div class="calendar-agenda-card__glyph" style="background:${getEventColor(event)}"><div class="calendar-agenda-card__glyphInner"></div></div>
                            <div class="calendar-agenda-card__body">
                                <div class="calendar-agenda-card__title" style="color:${getEventColor(event)}"><div class="calendar-agenda-card__titleInner">${escapeHtml(event.title)}</div></div>
                                <div class="calendar-agenda-card__location">${escapeHtml(event.location || '')}</div>
                                <div class="calendar-agenda-card__meta">${escapeHtml(eventTimeLabel(event))}</div>
                                <div class="calendar-agenda-card__hero" style="color:${getEventColor(event)}">${escapeHtml(event.heroLabel || '')}</div>
                            </div>
                        </button>
                    `).join('')}
                </div>
            </div>
        `).join('');
        });

        els.agendaTimeline.classList.toggle('is-empty', markup.includes('calendar-agenda-textCard'));
        setElementMarkup(els.agendaTimeline, key, markup);
    }

    function renderArrowState() {
        els.app.classList.toggle('is-showing-arrows', state.showArrows);
    }

    function renderAll() {
        els.app.classList.toggle('is-agenda-view', state.activeView === 'agenda');
        els.shell.classList.toggle('is-month-view', state.activeView === 'month');
        els.shell.classList.toggle('is-agenda-view', state.activeView === 'agenda');
        updateHeader();
        renderArrowState();
        renderMonthHeaders();
        if (state.activeView === 'month') {
            renderMonth();
        } else if (state.activeView === 'week') {
            renderTimelineView('week');
        } else if (state.activeView === 'workweek') {
            renderTimelineView('workweek');
        } else if (state.activeView === 'day') {
            renderTimelineView('day');
        } else if (state.activeView === 'agenda') {
            renderAgenda();
        }
    }

    async function maybeRefreshGoogleCalendar(_reason, options = {}) {
        if (!state.googleConnected || !electronIpc?.invoke || document.visibilityState === 'hidden') {
            return false;
        }

        const nowTimestamp = currentNow.getTime();
        const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : 15 * 1000;
        const refreshDue = options.force || (nextGoogleRefreshAt > 0 && nowTimestamp >= nextGoogleRefreshAt);
        if (!refreshDue) {
            return false;
        }

        if (!options.force && lastGoogleRefreshAttemptAt && (nowTimestamp - lastGoogleRefreshAttemptAt) < minIntervalMs) {
            return false;
        }

        lastGoogleRefreshAttemptAt = nowTimestamp;
        const loaded = await loadGoogleCalendarData({
            quiet: true,
            forceRefresh: true,
            allowStale: true,
            preserveSelection: true
        });

        if (!loaded) {
            scheduleNextGoogleRefresh(null, { retrySoon: true });
        }

        return loaded;
    }

    function handleTimeBankSnapshot(snapshot) {
        const previousDayKey = today.toISOString().slice(0, 10);
        const previousMinuteKey = lastClockMinuteKey || getClockMinuteKey(currentNow);
        syncClockSnapshot(snapshot);
        const nextDayKey = today.toISOString().slice(0, 10);
        const nextMinuteKey = getClockMinuteKey(currentNow);
        const dayChanged = previousDayKey !== nextDayKey;
        const minuteChanged = previousMinuteKey !== nextMinuteKey;
        lastClockMinuteKey = nextMinuteKey;

        if (dayChanged) {
            invalidateRenderCaches();
            renderAll();
            void maybeRefreshGoogleCalendar('day-change', { force: true, minIntervalMs: 0 });
            return;
        }

        if (minuteChanged && state.activeView === 'agenda') {
            updateHeader();
            renderAgenda();
        }

        if (minuteChanged) {
            void maybeRefreshGoogleCalendar('minute-tick');
        }
    }

    function bindTimeBank() {
        const timeBank = getTimeBankApi();
        if (!timeBank || typeof timeBank.subscribe !== 'function') {
            syncClockSnapshot();
            lastClockMinuteKey = getClockMinuteKey(currentNow);
            return;
        }

        timeBankUnsubscribe = timeBank.subscribe((snapshot) => {
            handleTimeBankSnapshot(snapshot);
        }, { immediate: true });
    }

    function setView(view) {
        const previousView = state.activeView;
        state.activeView = view;
        hideTransientUi();
        document.querySelectorAll('.calendar-navButton').forEach((button) => {
            const isActive = button.dataset.view === view;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        document.querySelectorAll('.calendar-view').forEach((viewElement) => {
            viewElement.classList.toggle('is-active', viewElement.dataset.view === view);
        });
        renderAll();
        if (previousView !== view) {
            animateActiveView();
        }
    }

    function setSelectedDate(date) {
        state.selectedDate = new Date(date);
        state.selectedDate.setHours(0, 0, 0, 0);
        renderAll();
    }

    function getEventById(eventId) {
        return CALENDAR_EVENTS.find((event) => event.id === eventId) || null;
    }

    function createMockCalendarEvent(payload) {
        const startDate = new Date(payload.startDateTime || `${payload.date}T00:00:00`);
        const endDate = payload.allDay
            ? new Date(`${payload.date}T23:59:00`)
            : new Date(payload.endDateTime);
        const event = {
            id: `evt-${Date.now()}`,
            calendarId: payload.calendarId,
            date: payload.date || startDate.toISOString().slice(0, 10),
            start: payload.allDay ? '00:00' : startDate.toTimeString().slice(0, 5),
            end: payload.allDay ? '23:59' : endDate.toTimeString().slice(0, 5),
            title: payload.title || '(No title)',
            location: payload.location || '',
            description: payload.description || payload.location || 'No details provided.',
            allDay: Boolean(payload.allDay)
        };
        CALENDAR_EVENTS = CALENDAR_EVENTS.concat(event);
        invalidateRenderCaches();
        return event;
    }

    function sortCalendarEvents(events) {
        return events
            .slice()
            .sort((left, right) => `${left.date}${left.start}`.localeCompare(`${right.date}${right.start}`));
    }

    function upsertCalendarEvent(event) {
        if (!event?.id) {
            return;
        }

        const existingIndex = CALENDAR_EVENTS.findIndex((item) => item.id === event.id);
        if (existingIndex >= 0) {
            CALENDAR_EVENTS = CALENDAR_EVENTS.slice();
            CALENDAR_EVENTS[existingIndex] = event;
        } else {
            CALENDAR_EVENTS = CALENDAR_EVENTS.concat(event);
        }
        CALENDAR_EVENTS = sortCalendarEvents(CALENDAR_EVENTS);
        invalidateRenderCaches();
    }

    async function createCalendarEvent(payload) {
        if (!state.googleConnected || !electronIpc?.invoke) {
            const createdEvent = createMockCalendarEvent(payload);
            renderAll();
            return {
                success: true,
                event: createdEvent,
                local: true
            };
        }

        try {
            const calendar = state.calendars.find((item) => item.id === payload.calendarId) || getPreferredCalendar();
            const response = await electronIpc.invoke('google-calendar:create-event', {
                ...payload,
                calendarTitle: calendar?.title || '',
                calendarColor: calendar?.color || ''
            });

            if (!response?.success) {
                return response || {
                    success: false,
                    error: 'Calendar event creation failed.'
                };
            }

            if (response.event) {
                upsertCalendarEvent(response.event);
                state.selectedDate = parseEventDate(response.event.date);
                scheduleNextGoogleRefresh({ expiresAt: currentNow.getTime() + CALENDAR_AUTO_REFRESH_MS });
                renderAll();
            }
            return response;
        } catch (error) {
            return {
                success: false,
                error: error?.message || 'Calendar event creation failed.'
            };
        }
    }

    function removeMockCalendarEvent(eventId) {
        const beforeCount = CALENDAR_EVENTS.length;
        CALENDAR_EVENTS = CALENDAR_EVENTS.filter((event) => event.id !== eventId);
        if (CALENDAR_EVENTS.length !== beforeCount) {
            invalidateRenderCaches();
        }
        return CALENDAR_EVENTS.length !== beforeCount;
    }

    async function deleteCalendarEvent(eventData) {
        if (!eventData) {
            return {
                success: false,
                error: 'The selected event could not be found.'
            };
        }

        if (eventData.source !== 'google' || !state.googleConnected || !electronIpc?.invoke) {
            const removed = removeMockCalendarEvent(eventData.id);
            if (removed) {
                scheduleNextGoogleRefresh({ expiresAt: currentNow.getTime() + CALENDAR_AUTO_REFRESH_MS });
                renderAll();
                return {
                    success: true,
                    local: true
                };
            }

            return {
                success: false,
                error: 'The selected event could not be removed.'
            };
            }

            try {
                const response = await electronIpc.invoke('google-calendar:delete-event', {
                    calendarId: eventData.calendarId,
                eventId: eventData.id
            });

            if (!response?.success) {
                return response || {
                    success: false,
                        error: 'Calendar event removal failed.'
                    };
                }

            removeMockCalendarEvent(eventData.id);
            renderAll();
            return response;
        } catch (error) {
            return {
                success: false,
                error: error?.message || 'Calendar event removal failed.'
            };
        }
    }

    function formatContextDate(date) {
        return date.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric'
        });
    }

    function getTimelineHourForPoint(columnElement, clientY) {
        const rect = columnElement.getBoundingClientRect();
        if (!rect.height) {
            return null;
        }

        const rawHour = Math.floor(((clientY - rect.top) / rect.height) * 24);
        return Math.max(0, Math.min(23, rawHour));
    }

    function buildEventMenuContext(eventTarget, pointerX, pointerY) {
        const eventData = getEventById(eventTarget.dataset.eventId);
        if (!eventData) {
            return null;
        }

        const eventDate = parseEventDate(eventData.date);
        return {
            type: 'event',
            title: eventData.title,
            date: eventDate,
            eventId: eventData.id,
            anchorX: pointerX,
            anchorY: pointerY
        };
    }

    function buildDateMenuContext(target, pointerX, pointerY) {
        const monthCell = target.closest('[data-date]');
        if (monthCell) {
            const date = new Date(monthCell.dataset.date);
            return {
                type: 'date',
                title: formatContextDate(date),
                date,
                hour: null,
                anchorX: pointerX,
                anchorY: pointerY
            };
        }

        const agendaHeader = target.closest('[data-agenda-date]');
        if (agendaHeader) {
            const date = new Date(agendaHeader.dataset.agendaDate);
            return {
                type: 'date',
                title: formatContextDate(date),
                date,
                hour: null,
                anchorX: pointerX,
                anchorY: pointerY
            };
        }

        const allDayCell = target.closest('[data-all-day-date]');
        if (allDayCell) {
            const date = new Date(allDayCell.dataset.allDayDate);
            return {
                type: 'date',
                title: formatContextDate(date),
                date,
                hour: null,
                anchorX: pointerX,
                anchorY: pointerY
            };
        }

        const timelineColumn = target.closest('[data-timeline-date]');
        if (timelineColumn) {
            const date = new Date(timelineColumn.dataset.timelineDate);
            const hour = getTimelineHourForPoint(timelineColumn, pointerY);
            return {
                type: 'date',
                title: hour === null ? formatContextDate(date) : `${formatContextDate(date)} ${formatHourLabel(hour)}`,
                date,
                hour,
                anchorX: pointerX,
                anchorY: pointerY
            };
        }

        return null;
    }

    function formatHourLabel(hour) {
        return formatClockTime(`${String(hour).padStart(2, '0')}:00`);
    }

    function formatTimelineHourLabel(hour) {
        return formatClockTime(`${String(hour).padStart(2, '0')}:00`, { omitMinutesWhenZero: true });
    }

    function formatClockTime(value, options = {}) {
        const {
            omitMinutesWhenZero = false
        } = options;
        const [rawHours, rawMinutes] = String(value || '00:00').split(':');
        const hours = Number.parseInt(rawHours, 10) || 0;
        const minutes = Number.parseInt(rawMinutes, 10) || 0;
        const suffix = hours >= 12 ? 'PM' : 'AM';
        const normalizedHours = hours % 12 || 12;
        if (omitMinutesWhenZero && minutes === 0) {
            return `${normalizedHours} ${suffix}`;
        }
        return `${normalizedHours}:${String(minutes).padStart(2, '0')} ${suffix}`;
    }

    function formatCompactClockTime(value) {
        return formatClockTime(value, { omitMinutesWhenZero: true });
    }

    function buildQuickEventPayload() {
        const context = state.quickEventContext;
        if (!context) {
            return null;
        }

        const calendar = getQuickEventSelectedCalendar() || getPreferredCalendar();
        const title = els.quickEventSubject.value.trim() || '(No title)';
        const location = els.quickEventLocation.value.trim();
        const description = location;
        const date = context.date.toISOString().slice(0, 10);

        if (context.allDay) {
            return {
                calendarId: calendar.id,
                title,
                location,
                description,
                date,
                allDay: true
            };
        }

        const startDate = new Date(context.date);
        startDate.setHours(context.hour, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setHours(Math.min(23, context.hour + 1), 0, 0, 0);
        if (endDate <= startDate) {
            endDate.setHours(startDate.getHours(), 59, 0, 0);
        }

        return {
            calendarId: calendar.id,
            title,
            location,
            description,
            date,
            allDay: false,
            startDateTime: startDate.toISOString(),
            endDateTime: endDate.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        };
    }

    async function submitQuickEvent() {
        const payload = buildQuickEventPayload();
        if (!payload) {
            return;
        }

        const context = state.quickEventContext;
        closeQuickEvent();
        setSelectedDate(context.date);

        const result = await createCalendarEvent(payload);
        if (result?.success) {
            showToast(result.local ? 'Event created locally.' : 'Google Calendar event created.');
            return;
        }

        if (result?.requiresReconnect) {
            showToast('Reconnect Google Calendar, then try event creation again.');
            return;
        }

        if (result?.requiresAuth) {
            showToast('Connect Google Calendar before creating events.');
            return;
        }

        showToast(result?.error || 'Calendar event creation failed.');
    }

    async function removeSelectedEvent(eventData) {
        closeContextMenu();
        closeEventFlyout();
        closeDeleteConfirm();

        const result = await deleteCalendarEvent(eventData);
        if (result?.success) {
            if (sameDay(state.selectedDate, parseEventDate(eventData.date)) && !eventsForDate(state.selectedDate).length) {
                renderAll();
            }
            showToast(result.local ? 'Event removed locally.' : 'Google Calendar event deleted.');
            return;
        }

        if (result?.requiresReconnect) {
            showToast('Reconnect Google Calendar, then try deleting the event again.');
            return;
        }

        if (result?.requiresAuth) {
            showToast('Connect Google Calendar before deleting events.');
            return;
        }

        showToast(result?.error || 'Calendar event removal failed.');
    }

    function requestDeleteEvent(eventData, anchorX, anchorY) {
        if (!eventData) {
            return;
        }

        if (state.readOnly && eventData.source === 'google') {
            showToast('Reconnect Google Calendar, then try deleting the event again.');
            return;
        }

        openDeleteConfirm(eventData, anchorX, anchorY);
    }

    function handleContextMenuAction(action, menuContext) {
        if (!menuContext) {
            return;
        }

        if (action === 'open-event' && menuContext.eventId) {
            const eventData = getEventById(menuContext.eventId);
            if (eventData) {
                setSelectedDate(menuContext.date);
                openEventFlyout(eventData, menuContext.anchorX, menuContext.anchorY);
            }
            return;
        }

        if (action === 'go-to-day') {
            setSelectedDate(menuContext.date);
            setView('day');
            return;
        }

        if (action === 'view-in-month') {
            setSelectedDate(menuContext.date);
            setView('month');
            return;
        }

        if (action === 'new-event') {
            setSelectedDate(menuContext.date);
            openQuickEvent({
                date: new Date(menuContext.date),
                hour: typeof menuContext.hour === 'number' ? menuContext.hour : 9,
                allDay: menuContext.hour === null,
                anchorX: menuContext.anchorX,
                anchorY: menuContext.anchorY,
                calendarId: getPreferredCalendar()?.id || ''
            });
            return;
        }

        if (action === 'delete-event' && menuContext.eventId) {
            const eventData = getEventById(menuContext.eventId);
            if (eventData) {
                requestDeleteEvent(eventData, menuContext.anchorX, menuContext.anchorY);
            }
        }
    }

    function buildSettingsPanelHtml(panelId, title, contentHtml) {
        return `
            <div id="${panelId}" class="settings-panel" style="display:none;">
                <div class="modern-flyout-header">
                    <button class="metro-back-btn personalize-back-button calendar-settings-back" title="Back to Settings">
                        <span class="sui-back"></span>
                    </button>
                    <span class="modern-flyout-header-text">${escapeHtml(title)}</span>
                </div>
                <div class="modern-flyout-content calendar-settings-content">
                    ${contentHtml}
                </div>
            </div>
        `;
    }

    function ensureCalendarSettingsStyles() {
        const hostDocument = getHostDocument();
        if (hostDocument.getElementById('calendar-settings-style')) {
            return;
        }

        const style = hostDocument.createElement('style');
        style.id = 'calendar-settings-style';
        style.textContent = `
            .calendar-settings-content{padding:18px 24px 28px;color:#fff;}
            .calendar-settings-section{margin-bottom:24px;}
            .calendar-settings-heading{margin-bottom:10px;font-size:18px;font-weight:300;}
            .calendar-settings-copy{color:rgba(255,255,255,.76);font-size:13px;line-height:1.6;}
            .calendar-settings-account{margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.18);}
            .calendar-settings-account-name{font-size:16px;font-weight:600;}
            .calendar-settings-account-meta{margin-top:4px;color:rgba(255,255,255,.72);font-size:13px;}
            .calendar-settings-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;}
            .calendar-settings-action{padding:8px 14px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;}
            .calendar-settings-action:hover{background:rgba(255,255,255,.14);}
            .calendar-settings-option{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin-bottom:12px;}
            .calendar-settings-option input[type="checkbox"]{width:16px;height:16px;}
            .calendar-settings-option select{width:110px;height:28px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:#fff;}
            .calendar-settings-option select option{color:#000;}
            .calendar-settings-swatch{width:14px;height:14px;border:1px solid rgba(255,255,255,.45);}
        `;
        hostDocument.head.appendChild(style);
    }

    function switchToSettingsPanel(panelId) {
        const hostDocument = getHostDocument();
        const container = hostDocument.querySelector('.settings-flyout-panel-container');
        const mainPanel = hostDocument.querySelector('.settings-panel.main-settings');
        const panel = hostDocument.getElementById(panelId);
        if (!container || !mainPanel || !panel) {
            return;
        }

        mainPanel.style.display = 'none';
        container.querySelectorAll('.settings-panel').forEach((item) => {
            if (!item.classList.contains('main-settings')) {
                item.style.display = item.id === panelId ? '' : 'none';
            }
        });
    }

    function returnToMainSettingsPanel() {
        const hostDocument = getHostDocument();
        const mainPanel = hostDocument.querySelector('.settings-panel.main-settings');
        if (mainPanel) {
            mainPanel.style.display = '';
        }
        hostDocument.querySelectorAll('.settings-flyout-panel-container .settings-panel').forEach((panel) => {
            if (!panel.classList.contains('main-settings')) {
                panel.style.display = 'none';
            }
        });
    }

    function ensureSettingsPanel(panelId, title, contentHtml) {
        const hostDocument = getHostDocument();
        const container = hostDocument.querySelector('.settings-flyout-panel-container');
        if (!container) {
            return null;
        }

        let panel = hostDocument.getElementById(panelId);
        if (!panel) {
            const wrapper = hostDocument.createElement('div');
            wrapper.innerHTML = buildSettingsPanelHtml(panelId, title, contentHtml).trim();
            panel = wrapper.firstElementChild;
            container.appendChild(panel);
            panel.querySelector('.calendar-settings-back')?.addEventListener('click', () => {
                returnToMainSettingsPanel();
            });
        } else {
            const content = panel.querySelector('.calendar-settings-content');
            if (content) {
                content.innerHTML = contentHtml;
            }
        }

        return panel;
    }

    function buildAccountsPanelContent() {
        const connectedEmail = state.profile?.email || state.profile?.displayName || 'No account connected';
        const connectedLabel = state.googleConnected ? `Connected to ${connectedEmail}` : 'Google Calendar is not connected yet.';
        const visibleCount = state.calendars.filter((calendar) => !calendar.hidden).length;
        return `
            <div class="calendar-settings-section">
                <div class="calendar-settings-account">
                    <div class="calendar-settings-account-name">Google</div>
                    <div class="calendar-settings-account-meta">${escapeHtml(connectedLabel)}</div>
                    <div class="calendar-settings-account-meta">${visibleCount} calendar${visibleCount === 1 ? '' : 's'} visible</div>
                    <div class="calendar-settings-actions">
                        <button type="button" class="calendar-settings-action" data-calendar-settings-action="${state.googleConnected ? 'refresh' : 'connect'}">${state.googleConnected ? 'Refresh calendars' : 'Connect account'}</button>
                        ${state.googleConnected ? '<button type="button" class="calendar-settings-action" data-calendar-settings-action="disconnect">Disconnect</button>' : ''}
                    </div>
                </div>
                <div class="calendar-settings-copy">${escapeHtml(state.readOnly ? 'Reconnect Google Calendar once to grant event creation access.' : 'Google Calendar quick event creation is available from the calendar surfaces.')}</div>
            </div>
        `;
    }

    function buildOptionsPanelContent() {
        return `
            <div class="calendar-settings-section">
                <div class="calendar-settings-heading">Calendars</div>
                ${state.calendars.map((calendar) => `
                    <label class="calendar-settings-option">
                        <input type="checkbox" data-calendar-toggle="${escapeHtml(calendar.id)}" ${calendar.hidden ? '' : 'checked'}>
                        <span>${escapeHtml(calendar.title)}</span>
                        <span style="display:flex;align-items:center;gap:8px;">
                            <span class="calendar-settings-swatch" style="background:${calendar.color};"></span>
                            <select data-calendar-color="${escapeHtml(calendar.id)}">
                                ${COLOR_PRESETS.map((color) => `<option value="${color}" ${color.toLowerCase() === String(calendar.color).toLowerCase() ? 'selected' : ''}>${color.toUpperCase()}</option>`).join('')}
                            </select>
                        </span>
                    </label>
                `).join('')}
            </div>
            <div class="calendar-settings-section">
                <div class="calendar-settings-heading">Navigation</div>
                <label class="calendar-settings-option">
                    <input type="checkbox" id="calendar-settings-show-arrows" ${state.showArrows ? 'checked' : ''}>
                    <span>Always show iterators</span>
                    <span></span>
                </label>
                <div class="calendar-settings-copy">The original app exposes this same iterator behavior through the Options flyout.</div>
            </div>
        `;
    }

    function buildHelpPanelContent() {
        return `
            <div class="calendar-settings-section">
                <div class="calendar-settings-heading">Calendar help</div>
                <div class="calendar-settings-copy">Use the date header to jump to a specific date. Right-click an event to open its popup details. In Month view, select a date or use the overflow links to move deeper into a busy day.</div>
            </div>
        `;
    }

    function buildAboutPanelContent() {
        return `
            <div class="calendar-settings-section">
                <div class="calendar-settings-heading">Calendar</div>
                <div class="calendar-settings-copy">By Microsoft Corporation</div>
                <div class="calendar-settings-copy" style="margin-top:16px;">Package reference: 17.5.9879.20671</div>
                <div class="calendar-settings-copy" style="margin-top:16px;">This recreation uses the original Communications app package as its visual source of truth.</div>
            </div>
        `;
    }

    function updateCalendarSettingsPanels() {
        ensureCalendarSettingsStyles();
        ensureSettingsPanel('calendar-settings-accounts', 'Accounts', buildAccountsPanelContent());
        ensureSettingsPanel('calendar-settings-options', 'Options', buildOptionsPanelContent());
        ensureSettingsPanel('calendar-settings-help', 'Help', buildHelpPanelContent());
        ensureSettingsPanel('calendar-settings-about', 'About', buildAboutPanelContent());
    }

    function handleSettingsAction(action) {
        updateCalendarSettingsPanels();
        if (action === 'calendar-accounts') {
            switchToSettingsPanel('calendar-settings-accounts');
        } else if (action === 'calendar-options') {
            switchToSettingsPanel('calendar-settings-options');
        } else if (action === 'calendar-help') {
            switchToSettingsPanel('calendar-settings-help');
        } else if (action === 'calendar-about') {
            switchToSettingsPanel('calendar-settings-about');
        }
    }

    function registerSettingsWithCharms() {
        const hostWindow = getHostWindow();
        const hostDocument = getHostDocument();

        hostWindow.CalendarAppSettings = {
            appId: 'calendar',
            getMenuItems() {
                return [
                    { label: 'Accounts', action: 'calendar-accounts' },
                    { label: 'Options', action: 'calendar-options' },
                    { label: 'Help', action: 'calendar-help' },
                    { label: 'About', action: 'calendar-about' }
                ];
            }
        };

        updateCalendarSettingsPanels();

        if (hostWindow.__calendarSettingsClickHandler) {
            hostDocument.removeEventListener('click', hostWindow.__calendarSettingsClickHandler);
        }
        if (hostWindow.__calendarSettingsChangeHandler) {
            hostDocument.removeEventListener('change', hostWindow.__calendarSettingsChangeHandler);
        }

        const clickHandler = async (event) => {
            const menuItem = event.target.closest('.settings-menu-item[data-action^="calendar-"]');
            if (menuItem) {
                handleSettingsAction(menuItem.dataset.action);
                return;
            }

            const actionButton = event.target.closest('[data-calendar-settings-action]');
            if (actionButton) {
                const action = actionButton.dataset.calendarSettingsAction;
                if (action === 'connect') {
                    await connectGoogleCalendar();
                } else if (action === 'refresh') {
                    const loaded = await loadGoogleCalendarData({ quiet: true, forceRefresh: true });
                    if (loaded) {
                        showToast('Calendar refreshed.');
                    }
                } else if (action === 'disconnect') {
                    await disconnectGoogleCalendar();
                }
                updateCalendarSettingsPanels();
            }
        };

        const changeHandler = (event) => {
            const toggle = event.target.closest('[data-calendar-toggle]');
            if (toggle) {
                const calendar = state.calendars.find((item) => item.id === toggle.dataset.calendarToggle);
                if (calendar) {
                    calendar.hidden = !toggle.checked;
                    savePreferences();
                    invalidateRenderCaches();
                    renderAll();
                    updateCalendarSettingsPanels();
                }
                return;
            }

            const colorSelect = event.target.closest('[data-calendar-color]');
            if (colorSelect) {
                const calendar = state.calendars.find((item) => item.id === colorSelect.dataset.calendarColor);
                if (calendar) {
                    calendar.color = colorSelect.value;
                    savePreferences();
                    invalidateRenderCaches();
                    renderAll();
                    updateCalendarSettingsPanels();
                }
                return;
            }

            if (event.target.id === 'calendar-settings-show-arrows') {
                state.showArrows = Boolean(event.target.checked);
                savePreferences();
                renderArrowState();
            }
        };

        hostWindow.__calendarSettingsClickHandler = clickHandler;
        hostWindow.__calendarSettingsChangeHandler = changeHandler;
        hostDocument.addEventListener('click', clickHandler);
        hostDocument.addEventListener('change', changeHandler);
    }

    function bindEvents() {
        document.querySelector('.calendar-navBar').addEventListener('click', (event) => {
            const button = event.target.closest('[data-view]');
            if (button) {
                setView(button.dataset.view);
            }
        });

        els.iteratorPrev.addEventListener('click', () => {
            goToAdjacentRange(-1);
        });

        els.iteratorNext.addEventListener('click', () => {
            goToAdjacentRange(1);
        });

        els.monthGrid.addEventListener('click', (event) => {
            if (event.target.closest('[data-event-id]')) {
                return;
            }

            const overflowButton = event.target.closest('[data-overflow-date]');
            if (overflowButton) {
                setSelectedDate(new Date(overflowButton.dataset.overflowDate));
                setView('day');
                return;
            }

            const cell = event.target.closest('[data-date]');
            if (cell) {
                const date = new Date(cell.dataset.date);
                const rect = cell.getBoundingClientRect();
                setSelectedDate(date);
                openQuickEvent({
                    date,
                    hour: 9,
                    allDay: true,
                    anchorX: rect.left + 18,
                    anchorY: rect.top + 28,
                    calendarId: getPreferredCalendar()?.id || ''
                });
                event.stopPropagation();
            }
        });

        [els.weekGrid, els.workweekGrid, els.dayTimeline].forEach((surface) => {
            surface.addEventListener('click', (event) => {
                if (event.target.closest('[data-event-id]')) {
                    return;
                }

                const allDayCell = event.target.closest('[data-all-day-date]');
                if (allDayCell) {
                    const date = new Date(allDayCell.dataset.allDayDate);
                    const rect = allDayCell.getBoundingClientRect();
                    setSelectedDate(date);
                    openQuickEvent({
                        date,
                        hour: 9,
                        allDay: true,
                        anchorX: rect.left + 18,
                        anchorY: rect.top + 24,
                        calendarId: getPreferredCalendar()?.id || ''
                    });
                    event.stopPropagation();
                    return;
                }

                const timelineColumn = event.target.closest('[data-timeline-date]');
                if (!timelineColumn) {
                    return;
                }

                const date = new Date(timelineColumn.dataset.timelineDate);
                const hour = getTimelineHourForPoint(timelineColumn, event.clientY);
                setSelectedDate(date);
                openQuickEvent({
                    date,
                    hour: hour === null ? 9 : hour,
                    allDay: false,
                    anchorX: event.clientX,
                    anchorY: event.clientY,
                    calendarId: getPreferredCalendar()?.id || ''
                });
                event.stopPropagation();
            });
        });

        els.monthTimeline.addEventListener('scroll', handleMonthTimelineScroll, { passive: true });
        els.monthTimeline.addEventListener('wheel', handleMonthTimelineWheel, { passive: false });
        els.weekGrid.addEventListener('scroll', () => handleViewTimelineScroll('week'), { passive: true });
        els.weekGrid.addEventListener('wheel', (event) => handleViewTimelineWheel('week', event), { passive: false });
        els.workweekGrid.addEventListener('scroll', () => handleViewTimelineScroll('workweek'), { passive: true });
        els.workweekGrid.addEventListener('wheel', (event) => handleViewTimelineWheel('workweek', event), { passive: false });
        els.dayTimeline.addEventListener('scroll', () => handleViewTimelineScroll('day'), { passive: true });
        els.dayTimeline.addEventListener('wheel', (event) => handleViewTimelineWheel('day', event), { passive: false });

        els.monthGrid.addEventListener('keydown', (event) => {
            const cell = event.target.closest('[data-date]');
            if (cell && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                setSelectedDate(new Date(cell.dataset.date));
            }
        });

        els.dateAnchor.addEventListener('click', () => {
            toggleDateFlyout();
        });

        els.agendaDate.addEventListener('click', () => {
            toggleDateFlyout();
        });

        els.dateInput.addEventListener('change', () => {
            if (!els.dateInput.value) {
                return;
            }

            setSelectedDate(new Date(`${els.dateInput.value}T00:00:00`));
            closeDateFlyout();
            showToast('Date updated.');
        });

        els.dateToday.addEventListener('click', () => {
            setSelectedDate(new Date(today));
            closeDateFlyout();
            showToast('Returned to today.');
        });

        els.dateClose.addEventListener('click', () => {
            closeDateFlyout();
        });

        document.body.addEventListener('click', (event) => {
            const eventTarget = event.target.closest('[data-event-id]');
            if (!eventTarget) {
                return;
            }

            const eventData = getEventById(eventTarget.dataset.eventId);
            if (!eventData) {
                return;
            }

            const rect = eventTarget.getBoundingClientRect();
            const anchorX = rect.left + (rect.width / 2);
            const anchorY = rect.top + (rect.height / 2);
            setSelectedDate(parseEventDate(eventData.date));
            openEventFlyout(eventData, anchorX, anchorY);
        });

        document.body.addEventListener('contextmenu', (event) => {
            const eventTarget = event.target.closest('[data-event-id]');
            if (eventTarget) {
                event.preventDefault();
                const menuContext = buildEventMenuContext(eventTarget, event.clientX, event.clientY);
                if (menuContext) {
                    setSelectedDate(menuContext.date);
                    openContextMenu(menuContext);
                }
                return;
            }

            const dateContext = buildDateMenuContext(event.target, event.clientX, event.clientY);
            if (dateContext) {
                event.preventDefault();
                setSelectedDate(dateContext.date);
                openContextMenu(dateContext);
            }
        });

        els.agendaTimeline.addEventListener('click', (event) => {
            const agendaHeader = event.target.closest('[data-agenda-date]');
            if (agendaHeader) {
                setSelectedDate(new Date(agendaHeader.dataset.agendaDate));
            }
        });

        els.contextMenu.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-context-action]');
            if (!actionButton) {
                return;
            }

            const menuContext = state.contextMenuContext;
            closeContextMenu();
            handleContextMenuAction(actionButton.dataset.contextAction, menuContext);
            event.stopPropagation();
        });

        const toggleQuickEventCalendarMenu = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (els.quickEventCalendarMenu.hidden) {
                openQuickEventCalendarMenu();
            } else {
                closeQuickEventCalendarMenu();
            }
        };

        els.quickEventCalendarTrigger.addEventListener('pointerup', toggleQuickEventCalendarMenu);
        els.quickEventCalendarButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                toggleQuickEventCalendarMenu(event);
            }
        });

        els.quickEventCalendarMenu.addEventListener('click', (event) => {
            const button = event.target.closest('[data-quick-event-calendar]');
            if (!button) {
                return;
            }

            selectQuickEventCalendar(button.dataset.quickEventCalendar);
            event.stopPropagation();
        });

        els.quickEventSubject.addEventListener('input', updateQuickEventHints);
        els.quickEventLocation.addEventListener('input', updateQuickEventHints);

        els.quickEventClose.addEventListener('click', () => {
            closeQuickEvent();
        });

        els.quickEventCancel.addEventListener('click', () => {
            closeQuickEvent();
        });

        els.quickEventCreate.addEventListener('click', () => {
            submitQuickEvent();
        });

        els.quickEvent.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeQuickEvent();
                return;
            }

            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitQuickEvent();
            }
        });

        els.eventFlyoutOpen.addEventListener('click', () => {
            const eventData = getEventById(state.selectedEventId);
            if (eventData) {
                showToast(`${eventData.title} selected.`);
            }
            closeEventFlyout();
        });

        els.eventFlyoutDay.addEventListener('click', () => {
            const eventData = getEventById(state.selectedEventId);
            if (eventData) {
                setSelectedDate(parseEventDate(eventData.date));
                setView('day');
            }
            closeEventFlyout();
        });

        els.eventFlyoutDelete.addEventListener('click', () => {
            const eventData = getEventById(state.selectedEventId);
            if (eventData) {
                const flyoutRect = els.eventFlyout.getBoundingClientRect();
                requestDeleteEvent(
                    eventData,
                    flyoutRect.left + (flyoutRect.width / 2),
                    flyoutRect.top + flyoutRect.height
                );
            }
        });

        els.eventFlyoutClose.addEventListener('click', () => {
            closeEventFlyout();
        });

        els.deleteConfirmCancel.addEventListener('click', () => {
            closeDeleteConfirm();
        });

        els.deleteConfirmDelete.addEventListener('click', () => {
            const eventData = getEventById(state.deleteConfirmContext?.eventId);
            if (eventData) {
                removeSelectedEvent(eventData);
            } else {
                closeDeleteConfirm();
            }
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('#calendar-date-anchor') && !event.target.closest('#calendar-date-flyout') && !event.target.closest('#calendar-agenda-date')) {
                closeDateFlyout();
            }

            if (!event.target.closest('#calendar-event-flyout') && !event.target.closest('[data-event-id]')) {
                closeEventFlyout();
            }

            if (!event.target.closest('#calendar-context-menu')) {
                closeContextMenu();
            }

            if (!event.target.closest('#calendar-delete-confirm')) {
                closeDeleteConfirm();
            }

            if (!event.target.closest('#calendar-quick-event') && !event.target.closest('#calendar-quick-event-calendar-menu')) {
                closeQuickEvent();
            } else if (!event.target.closest('#calendar-quick-event-calendar-menu') && !event.target.closest('#calendar-quick-event-calendar-button')) {
                closeQuickEventCalendarMenu();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                if (state.deleteConfirmOpen) {
                    closeDeleteConfirm();
                    return;
                }
                if (state.quickEventOpen) {
                    closeQuickEvent();
                    return;
                }
                if (state.contextMenuOpen) {
                    closeContextMenu();
                    return;
                }
                if (state.eventFlyoutOpen) {
                    closeEventFlyout();
                    return;
                }
                if (state.dateFlyoutOpen) {
                    closeDateFlyout();
                }
            }

            if (event.altKey && event.key === 'ArrowLeft') {
                goToAdjacentRange(-1);
            }

            if (event.altKey && event.key === 'ArrowRight') {
                goToAdjacentRange(1);
            }

            if (event.key === 'Delete') {
                const eventTarget = document.activeElement?.closest?.('[data-event-id]');
                if (eventTarget) {
                    const eventData = getEventById(eventTarget.dataset.eventId);
                    if (eventData && !(state.readOnly && eventData.source === 'google')) {
                        event.preventDefault();
                        const rect = eventTarget.getBoundingClientRect();
                        requestDeleteEvent(eventData, rect.left + (rect.width / 2), rect.top + (rect.height / 2));
                        return;
                    }
                }
            }

            if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                const eventTarget = document.activeElement?.closest?.('[data-event-id]');
                if (eventTarget) {
                    event.preventDefault();
                    const rect = eventTarget.getBoundingClientRect();
                    const menuContext = buildEventMenuContext(eventTarget, rect.left + 24, rect.top + 24);
                    if (menuContext) {
                        openContextMenu(menuContext);
                    }
                    return;
                }

                const dateTarget = document.activeElement?.closest?.('[data-date], [data-agenda-date], [data-all-day-date], [data-timeline-date]');
                if (dateTarget) {
                    event.preventDefault();
                    const rect = dateTarget.getBoundingClientRect();
                    const menuContext = buildDateMenuContext(dateTarget, rect.left + 24, rect.top + 24);
                    if (menuContext) {
                        openContextMenu(menuContext);
                    }
                }
            }
        });

        window.addEventListener('resize', () => {
            if (state.activeView === 'month') {
                centerMonthTimeline();
            } else if (state.activeView === 'week') {
                centerViewTimeline('week');
            } else if (state.activeView === 'workweek') {
                centerViewTimeline('workweek');
            } else if (state.activeView === 'day') {
                centerViewTimeline('day');
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                return;
            }

            if (state.activeView === 'agenda') {
                updateHeader();
                renderAgenda();
            }
            void maybeRefreshGoogleCalendar('visibility');
        });

        window.addEventListener('unload', () => {
            if (typeof timeBankUnsubscribe === 'function') {
                timeBankUnsubscribe();
                timeBankUnsubscribe = null;
            }
        }, { once: true });
    }

    async function initCalendar() {
        normalizeMockData();
        bindTimeBank();
        renderAll();
        bindEvents();
        registerSettingsWithCharms();
        await loadGoogleCalendarData({ quiet: true, preserveSelection: false });

        window.setTimeout(() => {
            els.splash.classList.add('is-hidden');
        }, 320);
    }

    initCalendar();
})();


