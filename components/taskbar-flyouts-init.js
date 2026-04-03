/**
 * Taskbar Flyouts Initialization
 * Registers clock and battery flyouts with the Classic Flyout Manager
 */

(function () {
    'use strict';

    /**
     * Initialize battery popup
     */
    function initBatteryPopup() {
        const flyout = document.getElementById('battery-flyout');
        if (!flyout || !window.batteryPopupInstance || !window.batteryMonitor) {
            return;
        }

        // When flyout becomes visible, update popup with current battery status
        const observer = new MutationObserver(() => {
            if (flyout.classList.contains('visible')) {
                // Update popup display with current battery status
                window.batteryPopupInstance.updateDisplay(window.batteryMonitor.currentStatus);
            }
        });

        observer.observe(flyout, { attributes: true, attributeFilter: ['class'] });
    }

    /**
     * Initialize taskbar flyouts
     */
    function init() {
        console.log('Taskbar Flyouts: Initializing...');

        // Wait for Classic Flyout Manager to be ready
        if (!window.ClassicFlyoutManager) {
            console.warn('Taskbar Flyouts: ClassicFlyoutManager not available, retrying...');
            setTimeout(init, 100);
            return;
        }

        // Register clock flyout
        window.ClassicFlyoutManager.register('#clock-flyout', '.clock');

        // Register battery flyout
        window.ClassicFlyoutManager.register('#battery-flyout', '#battery-icon');

        // Register user tile flyout
        window.ClassicFlyoutManager.register('#usertile-panel', '#taskbar-usertile-button');

        // Initialize battery popup updates
        initBatteryPopup();

        console.log('Taskbar Flyouts: Initialized');
    }

    // Initialize when DOM is ready
    $(document).ready(function () {
        // Only initialize on desktop (when taskbar is visible)
        const checkAndInit = () => {
            if ($('body').hasClass('taskbar-visible')) {
                init();
            } else {
                // Check again after a short delay
                setTimeout(checkAndInit, 500);
            }
        };

        checkAndInit();
    });
})();
