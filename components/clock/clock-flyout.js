/**
 * Clock Flyout Component
 * Handles the calendar and analog clock display in the taskbar clock flyout
 */

(function () {
    'use strict';

    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();
    let clockUpdateInterval = null;
    let canvasContext = null;

    /**
     * Initialize the clock flyout
     */
    function init() {
        console.log('Clock Flyout: Initializing...');

        // Get canvas context for analog clock
        const canvas = document.getElementById('analog-clock-canvas');
        if (canvas) {
            canvasContext = canvas.getContext('2d');
        }

        // Set up event listeners
        $('#calendar-prev').on('click', previousMonth);
        $('#calendar-next').on('click', nextMonth);

        // Initialize the display
        updateDateHeader();
        renderCalendar();
        updateClock();

        // Start clock update interval (update every second)
        clockUpdateInterval = setInterval(updateClock, 1000);

        console.log('Clock Flyout: Initialized');
    }

    /**
     * Update the date header with current date
     */
    function updateDateHeader() {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const dateString = now.toLocaleDateString('en-US', options);
        $('#clock-flyout-date-header').text(dateString);
    }

    /**
     * Render the calendar for the current month/year
     */
    function renderCalendar() {
        const monthYear = document.getElementById('calendar-month-year');
        const daysContainer = document.getElementById('calendar-days');

        if (!monthYear || !daysContainer) return;

        // Update month/year header
        const date = new Date(currentYear, currentMonth);
        const options = { year: 'numeric', month: 'long' };
        monthYear.textContent = date.toLocaleDateString('en-US', options);

        // Clear existing days
        daysContainer.innerHTML = '';

        // Get first day of month and number of days
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

        // Get today's date for highlighting
        const today = new Date();
        const isCurrentMonth = today.getMonth() === currentMonth && today.getFullYear() === currentYear;
        const todayDate = today.getDate();

        // Add days from previous month
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i;
            const dayEl = createDayElement(day, true);
            daysContainer.appendChild(dayEl);
        }

        // Add days of current month
        for (let day = 1; day <= daysInMonth; day++) {
            const dayEl = createDayElement(day, false);

            // Highlight today
            if (isCurrentMonth && day === todayDate) {
                dayEl.classList.add('today');
            }

            daysContainer.appendChild(dayEl);
        }

        // Add days from next month to fill the grid (6 rows x 7 columns = 42 cells)
        const totalCells = 42;
        const cellsUsed = firstDay + daysInMonth;
        const remainingCells = totalCells - cellsUsed;

        for (let day = 1; day <= remainingCells; day++) {
            const dayEl = createDayElement(day, true);
            daysContainer.appendChild(dayEl);
        }
    }

    /**
     * Create a day element for the calendar
     */
    function createDayElement(day, isOtherMonth) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;

        if (isOtherMonth) {
            dayEl.classList.add('other-month');
        }

        return dayEl;
    }

    /**
     * Navigate to previous month
     */
    function previousMonth() {
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        renderCalendar();
    }

    /**
     * Navigate to next month
     */
    function nextMonth() {
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        renderCalendar();
    }

    /**
     * Update the analog clock and digital time display
     */
    function updateClock() {
        const now = new Date();

        // Update digital time
        updateDigitalTime(now);

        // Draw analog clock
        drawAnalogClock(now);
    }

    /**
     * Update the digital time display
     */
    function updateDigitalTime(date) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;

        const timeString = `${displayHours}:${pad(minutes)}:${pad(seconds)} ${ampm}`;
        $('#digital-time').text(timeString);
    }

    /**
     * Draw the analog clock on canvas
     */
    function drawAnalogClock(date) {
        if (!canvasContext) return;

        const canvas = canvasContext.canvas;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(centerX, centerY) - 10;

        // Clear canvas
        canvasContext.clearRect(0, 0, canvas.width, canvas.height);

        // Draw clock face
        drawClockFace(centerX, centerY, radius);

        // Draw hour markers
        drawHourMarkers(centerX, centerY, radius);

        // Get time components
        const hours = date.getHours() % 12;
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();

        // Draw clock hands
        drawHourHand(centerX, centerY, radius, hours, minutes);
        drawMinuteHand(centerX, centerY, radius, minutes);
        drawSecondHand(centerX, centerY, radius, seconds);

        // Draw center dot
        canvasContext.beginPath();
        canvasContext.arc(centerX, centerY, 4, 0, 2 * Math.PI);
        canvasContext.fillStyle = '#000';
        canvasContext.fill();
    }

    /**
     * Draw the clock face (circle outline)
     */
    function drawClockFace(centerX, centerY, radius) {
        canvasContext.beginPath();
        canvasContext.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 2;
        canvasContext.stroke();
    }

    /**
     * Draw hour markers on the clock face
     */
    function drawHourMarkers(centerX, centerY, radius) {
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 2;

        for (let i = 0; i < 12; i++) {
            const angle = (i * 30 - 90) * Math.PI / 180;
            const startRadius = radius - 8;
            const endRadius = radius - 2;

            const startX = centerX + startRadius * Math.cos(angle);
            const startY = centerY + startRadius * Math.sin(angle);
            const endX = centerX + endRadius * Math.cos(angle);
            const endY = centerY + endRadius * Math.sin(angle);

            canvasContext.beginPath();
            canvasContext.moveTo(startX, startY);
            canvasContext.lineTo(endX, endY);
            canvasContext.stroke();
        }
    }

    /**
     * Draw the hour hand
     */
    function drawHourHand(centerX, centerY, radius, hours, minutes) {
        const angle = ((hours + minutes / 60) * 30 - 90) * Math.PI / 180;
        const length = radius * 0.5;

        canvasContext.beginPath();
        canvasContext.moveTo(centerX, centerY);
        canvasContext.lineTo(
            centerX + length * Math.cos(angle),
            centerY + length * Math.sin(angle)
        );
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 4;
        canvasContext.lineCap = 'round';
        canvasContext.stroke();
    }

    /**
     * Draw the minute hand
     */
    function drawMinuteHand(centerX, centerY, radius, minutes) {
        const angle = (minutes * 6 - 90) * Math.PI / 180;
        const length = radius * 0.7;

        canvasContext.beginPath();
        canvasContext.moveTo(centerX, centerY);
        canvasContext.lineTo(
            centerX + length * Math.cos(angle),
            centerY + length * Math.sin(angle)
        );
        canvasContext.strokeStyle = '#000';
        canvasContext.lineWidth = 3;
        canvasContext.lineCap = 'round';
        canvasContext.stroke();
    }

    /**
     * Draw the second hand
     */
    function drawSecondHand(centerX, centerY, radius, seconds) {
        const angle = (seconds * 6 - 90) * Math.PI / 180;
        const length = radius * 0.8;

        canvasContext.beginPath();
        canvasContext.moveTo(centerX, centerY);
        canvasContext.lineTo(
            centerX + length * Math.cos(angle),
            centerY + length * Math.sin(angle)
        );
        canvasContext.strokeStyle = '#0072C6';
        canvasContext.lineWidth = 1;
        canvasContext.lineCap = 'round';
        canvasContext.stroke();
    }

    /**
     * Pad single digit numbers with leading zero
     */
    function pad(num) {
        return num < 10 ? '0' + num : num;
    }

    /**
     * Clean up when component is destroyed
     */
    function destroy() {
        if (clockUpdateInterval) {
            clearInterval(clockUpdateInterval);
            clockUpdateInterval = null;
        }
    }

    // Initialize when DOM is ready
    $(document).ready(function () {
        // Wait a bit to ensure the flyout HTML is loaded
        setTimeout(init, 100);
    });

    // Clean up on page unload
    $(window).on('beforeunload', destroy);

})();
