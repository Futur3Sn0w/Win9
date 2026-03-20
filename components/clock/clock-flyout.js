/**
 * Clock Flyout Component
 * Handles the legacy analog clock flyout and the Threshold-style calendar popup.
 */

(function () {
    'use strict';

    const DISPLAY_LOCALE = 'en-US';
    const CALENDAR_CELL_COUNT = 42;
    const WEEKDAY_LABEL_BASE_UTC = Date.UTC(2023, 0, 1);

    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();
    let clockUpdateInterval = null;
    let canvasContext = null;
    let initialized = false;

    function init() {
        if (initialized) {
            return;
        }

        const monthYear = document.getElementById('calendar-month-year');
        const daysContainer = document.getElementById('calendar-days');

        if (!monthYear || !daysContainer) {
            return;
        }

        initialized = true;

        const canvas = document.getElementById('analog-clock-canvas');
        if (canvas) {
            canvasContext = canvas.getContext('2d');
        }

        const previousButton = document.getElementById('calendar-prev');
        if (previousButton) {
            previousButton.setAttribute('aria-label', 'Previous month');
            previousButton.addEventListener('click', previousMonth);
        }

        const nextButton = document.getElementById('calendar-next');
        if (nextButton) {
            nextButton.setAttribute('aria-label', 'Next month');
            nextButton.addEventListener('click', nextMonth);
        }

        bindNoopLink('clock-flyout-modern-link');
        bindNoopLink('clock-settings-link');

        renderWeekdays();
        updateClock();
        renderCalendar();

        clockUpdateInterval = setInterval(updateClock, 1000);
    }

    function bindNoopLink(id) {
        const link = document.getElementById(id);
        if (!link) {
            return;
        }

        link.addEventListener('click', function (event) {
            event.preventDefault();
        });
    }

    function renderWeekdays() {
        const weekdayContainers = document.querySelectorAll('.calendar-weekdays');
        if (!weekdayContainers.length) {
            return;
        }

        const formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
            weekday: 'short',
            timeZone: 'UTC'
        });

        const labels = Array.from({ length: 7 }, function (_, index) {
            return formatter.format(new Date(WEEKDAY_LABEL_BASE_UTC + (index * 24 * 60 * 60 * 1000)));
        });

        weekdayContainers.forEach(function (container) {
            container.innerHTML = '';

            labels.forEach(function (label) {
                const labelEl = document.createElement('div');
                labelEl.className = 'calendar-weekday';
                labelEl.textContent = label;
                container.appendChild(labelEl);
            });
        });
    }

    function updateDateHeader(now = new Date()) {
        const header = document.getElementById('clock-flyout-date-header');
        if (!header) {
            return;
        }

        header.textContent = now.toLocaleDateString(DISPLAY_LOCALE, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function renderCalendar() {
        const monthYear = document.getElementById('calendar-month-year');
        const daysContainer = document.getElementById('calendar-days');

        if (!monthYear || !daysContainer) {
            return;
        }

        const viewDate = new Date(currentYear, currentMonth, 1);
        monthYear.textContent = viewDate.toLocaleDateString(DISPLAY_LOCALE, {
            year: 'numeric',
            month: 'long'
        });

        daysContainer.innerHTML = '';

        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

        const today = new Date();
        const isCurrentMonth = today.getMonth() === currentMonth && today.getFullYear() === currentYear;
        const todayDate = today.getDate();

        for (let i = firstDay - 1; i >= 0; i--) {
            daysContainer.appendChild(createDayElement(daysInPrevMonth - i, {
                otherMonth: true
            }));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            daysContainer.appendChild(createDayElement(day, {
                today: isCurrentMonth && day === todayDate
            }));
        }

        const remainingCells = CALENDAR_CELL_COUNT - (firstDay + daysInMonth);
        for (let day = 1; day <= remainingCells; day++) {
            daysContainer.appendChild(createDayElement(day, {
                otherMonth: true
            }));
        }

        refreshLayout();
    }

    function createDayElement(day, options = {}) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = String(day);

        if (options.otherMonth) {
            dayEl.classList.add('other-month');
        }

        if (options.today) {
            dayEl.classList.add('today');
        }

        return dayEl;
    }

    function previousMonth() {
        currentMonth -= 1;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear -= 1;
        }

        renderCalendar();
    }

    function nextMonth() {
        currentMonth += 1;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear += 1;
        }

        renderCalendar();
    }

    function updateClock() {
        const now = new Date();
        updateDateHeader(now);
        updateDigitalTime(now);
        updateModernTime(now);
        drawAnalogClock(now);
    }

    function updateDigitalTime(date) {
        const digitalTime = document.getElementById('digital-time');
        if (!digitalTime) {
            return;
        }

        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;

        digitalTime.textContent = `${displayHours}:${pad(minutes)}:${pad(seconds)} ${ampm}`;
    }

    function updateModernTime(date) {
        const timeValue = document.getElementById('clock-flyout-modern-time-value');
        const timePeriod = document.getElementById('clock-flyout-modern-time-period');

        if (!timeValue || !timePeriod) {
            return;
        }

        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;

        timeValue.textContent = `${displayHours}:${pad(minutes)}:${pad(seconds)}`;
        timePeriod.textContent = ampm;
    }

    function drawAnalogClock(date) {
        if (!canvasContext) {
            return;
        }

        const canvas = canvasContext.canvas;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(centerX, centerY) - 10;

        canvasContext.clearRect(0, 0, canvas.width, canvas.height);
        drawClockFace(centerX, centerY, radius);
        drawHourMarkers(centerX, centerY, radius);

        const hours = date.getHours() % 12;
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();

        drawHourHand(centerX, centerY, radius, hours, minutes);
        drawMinuteHand(centerX, centerY, radius, minutes);
        drawSecondHand(centerX, centerY, radius, seconds);

        canvasContext.beginPath();
        canvasContext.arc(centerX, centerY, 4, 0, 2 * Math.PI);
        canvasContext.fillStyle = '#000';
        canvasContext.fill();
    }

    function drawClockFace(centerX, centerY, radius) {
        canvasContext.beginPath();
        canvasContext.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 2;
        canvasContext.stroke();
    }

    function drawHourMarkers(centerX, centerY, radius) {
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 2;

        for (let i = 0; i < 12; i++) {
            const angle = ((i * 30) - 90) * Math.PI / 180;
            const startRadius = radius - 8;
            const endRadius = radius - 2;

            const startX = centerX + (startRadius * Math.cos(angle));
            const startY = centerY + (startRadius * Math.sin(angle));
            const endX = centerX + (endRadius * Math.cos(angle));
            const endY = centerY + (endRadius * Math.sin(angle));

            canvasContext.beginPath();
            canvasContext.moveTo(startX, startY);
            canvasContext.lineTo(endX, endY);
            canvasContext.stroke();
        }
    }

    function drawHourHand(centerX, centerY, radius, hours, minutes) {
        const angle = (((hours + (minutes / 60)) * 30) - 90) * Math.PI / 180;
        const length = radius * 0.5;

        canvasContext.beginPath();
        canvasContext.moveTo(centerX, centerY);
        canvasContext.lineTo(
            centerX + (length * Math.cos(angle)),
            centerY + (length * Math.sin(angle))
        );
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 4;
        canvasContext.lineCap = 'round';
        canvasContext.stroke();
    }

    function drawMinuteHand(centerX, centerY, radius, minutes) {
        const angle = ((minutes * 6) - 90) * Math.PI / 180;
        const length = radius * 0.7;

        canvasContext.beginPath();
        canvasContext.moveTo(centerX, centerY);
        canvasContext.lineTo(
            centerX + (length * Math.cos(angle)),
            centerY + (length * Math.sin(angle))
        );
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 3;
        canvasContext.lineCap = 'round';
        canvasContext.stroke();
    }

    function drawSecondHand(centerX, centerY, radius, seconds) {
        const angle = ((seconds * 6) - 90) * Math.PI / 180;
        const length = radius * 0.8;

        canvasContext.beginPath();
        canvasContext.moveTo(centerX, centerY);
        canvasContext.lineTo(
            centerX + (length * Math.cos(angle)),
            centerY + (length * Math.sin(angle))
        );
        canvasContext.strokeStyle = '#0072C6';
        canvasContext.lineWidth = 1;
        canvasContext.lineCap = 'round';
        canvasContext.stroke();
    }

    function refreshLayout() {
        if (!window.ClassicFlyoutManager || typeof window.ClassicFlyoutManager.position !== 'function') {
            return;
        }

        const flyout = document.getElementById('clock-flyout');
        if (!flyout || !flyout.classList.contains('visible')) {
            return;
        }

        window.ClassicFlyoutManager.position('#clock-flyout', { forceMeasure: true });
    }

    function pad(num) {
        return num < 10 ? `0${num}` : String(num);
    }

    function destroy() {
        if (clockUpdateInterval) {
            clearInterval(clockUpdateInterval);
            clockUpdateInterval = null;
        }
    }

    $(document).ready(function () {
        setTimeout(init, 100);
    });

    $(window).on('beforeunload', destroy);

    window.ClockFlyout = {
        refreshLayout,
        renderCalendar
    };
})();
