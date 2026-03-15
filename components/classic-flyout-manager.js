/**
 * Classic Flyout Manager
 * Centralized manager for positioning and showing/hiding classic flyouts
 */

(function () {
    'use strict';

    const FLYOUT_VERTICAL_SPACING = 12;
    const FLYOUT_SCREEN_MARGIN = 8;
    const FLYOUT_RIGHT_SCREEN_MARGIN = 10;

    // Track all registered flyouts
    const flyouts = new Map();

    /**
     * Register a flyout with its trigger element
     * @param {string} flyoutSelector - CSS selector for the flyout element
     * @param {string} triggerSelector - CSS selector for the trigger element
     */
    function registerFlyout(flyoutSelector, triggerSelector) {
        const $flyout = $(flyoutSelector);
        const $trigger = $(triggerSelector);

        if (!$flyout.length || !$trigger.length) {
            console.warn(`Classic Flyout Manager: Could not find flyout (${flyoutSelector}) or trigger (${triggerSelector})`);
            return;
        }

        flyouts.set(flyoutSelector, {
            $flyout,
            $trigger,
            isVisible: false
        });

        // Setup click handler for trigger
        $trigger.on('click', function (e) {
            e.stopPropagation();
            toggleFlyout(flyoutSelector);
        });

        console.log(`Classic Flyout Manager: Registered flyout ${flyoutSelector} with trigger ${triggerSelector}`);
    }

    /**
     * Reset flyout position back to CSS defaults
     */
    function resetFlyoutPosition($flyout) {
        $flyout.css({
            top: '',
            left: '',
            bottom: '',
            right: ''
        });
    }

    /**
     * Position a flyout centered above its trigger element
     */
    function positionFlyout(flyoutSelector, { forceMeasure = false } = {}) {
        const flyoutData = flyouts.get(flyoutSelector);
        if (!flyoutData) {
            console.warn(`Classic Flyout Manager: Flyout ${flyoutSelector} not registered`);
            return;
        }

        const { $flyout, $trigger } = flyoutData;

        if (!$flyout.length || !$trigger.length) {
            resetFlyoutPosition($flyout);
            return;
        }

        const triggerElement = $trigger[0];
        const flyoutElement = $flyout[0];

        if (!triggerElement || !flyoutElement) {
            resetFlyoutPosition($flyout);
            return;
        }

        const triggerRect = triggerElement.getBoundingClientRect();

        if ((triggerRect.width === 0 && triggerRect.height === 0) || Number.isNaN(triggerRect.left)) {
            resetFlyoutPosition($flyout);
            return;
        }

        let cleanup = false;
        let previousDisplay = '';
        let previousVisibility = '';

        // If we need to measure before showing, temporarily make visible
        if (forceMeasure && !$flyout.hasClass('visible')) {
            previousDisplay = flyoutElement.style.display;
            previousVisibility = flyoutElement.style.visibility;

            flyoutElement.style.display = 'flex';
            flyoutElement.style.visibility = 'hidden';

            cleanup = true;
        }

        const flyoutRect = flyoutElement.getBoundingClientRect();
        const flyoutWidth = flyoutRect.width || $flyout.outerWidth();
        const flyoutHeight = flyoutRect.height || $flyout.outerHeight();

        // Center horizontally above trigger
        const centeredLeft = triggerRect.left + (triggerRect.width / 2) - (flyoutWidth / 2);

        // Keep flyout on-screen, preferring centered alignment
        let left = centeredLeft;

        if (centeredLeft < FLYOUT_SCREEN_MARGIN) {
            left = FLYOUT_SCREEN_MARGIN;
        }

        const maxRight = window.innerWidth - FLYOUT_RIGHT_SCREEN_MARGIN;
        const flyoutRightEdge = left + flyoutWidth;

        // If centering would send the flyout off-screen to the right, pin it 10px from the edge
        if (flyoutRightEdge > maxRight) {
            left = window.innerWidth - flyoutWidth - FLYOUT_RIGHT_SCREEN_MARGIN;
        }

        left = Math.max(left, FLYOUT_SCREEN_MARGIN);

        // Position above trigger with spacing using bottom offset to keep alignment with taskbar
        let bottom = (window.innerHeight - triggerRect.top) + FLYOUT_VERTICAL_SPACING;
        bottom = Math.max(bottom, FLYOUT_SCREEN_MARGIN);

        const maxBottom = Math.max(window.innerHeight - flyoutHeight - FLYOUT_SCREEN_MARGIN, FLYOUT_SCREEN_MARGIN);
        bottom = Math.min(bottom, maxBottom);

        $flyout.css({
            left: `${left}px`,
            top: 'auto',
            bottom: `${bottom}px`,
            right: 'auto'
        });

        // Restore original state if we temporarily made it visible
        if (cleanup) {
            flyoutElement.style.display = previousDisplay;
            flyoutElement.style.visibility = previousVisibility;
        }
    }

    /**
     * Show a flyout
     */
    function showFlyout(flyoutSelector) {
        const flyoutData = flyouts.get(flyoutSelector);
        if (!flyoutData) {
            console.warn(`Classic Flyout Manager: Flyout ${flyoutSelector} not registered`);
            return;
        }

        const { $flyout, $trigger } = flyoutData;

        // Close all taskbar popups and menus first (mutual exclusion)
        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus();
        }

        // Hide all other flyouts first
        hideAllFlyouts();

        // Disable pointer events on all iframes and webviews
        disableIframePointerEvents();

        // Position and show this flyout
        positionFlyout(flyoutSelector, { forceMeasure: true });
        $flyout.addClass('visible');
        $trigger.addClass('active');
        positionFlyout(flyoutSelector);

        flyoutData.isVisible = true;
    }

    /**
     * Hide a flyout
     */
    function hideFlyout(flyoutSelector) {
        const flyoutData = flyouts.get(flyoutSelector);
        if (!flyoutData) {
            console.warn(`Classic Flyout Manager: Flyout ${flyoutSelector} not registered`);
            return;
        }

        const { $flyout, $trigger } = flyoutData;

        $flyout.removeClass('visible');
        $trigger.removeClass('active');

        flyoutData.isVisible = false;

        // Re-enable pointer events on iframes and webviews if no flyouts are visible
        const anyVisible = Array.from(flyouts.values()).some(f => f.isVisible);
        if (!anyVisible) {
            enableIframePointerEvents();
        }
    }

    /**
     * Toggle a flyout's visibility
     */
    function toggleFlyout(flyoutSelector) {
        const flyoutData = flyouts.get(flyoutSelector);
        if (!flyoutData) {
            console.warn(`Classic Flyout Manager: Flyout ${flyoutSelector} not registered`);
            return;
        }

        if (flyoutData.isVisible) {
            hideFlyout(flyoutSelector);
        } else {
            showFlyout(flyoutSelector);
        }
    }

    /**
     * Hide all flyouts
     */
    function hideAllFlyouts() {
        flyouts.forEach((flyoutData, flyoutSelector) => {
            if (flyoutData.isVisible) {
                hideFlyout(flyoutSelector);
            }
        });
    }

    /**
     * Disable pointer events on all iframes and webviews
     */
    function disableIframePointerEvents() {
        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'none');
    }

    /**
     * Enable pointer events on all iframes and webviews
     */
    function enableIframePointerEvents() {
        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');
    }

    /**
     * Initialize the flyout manager
     */
    function init() {
        console.log('Classic Flyout Manager: Initializing...');

        // Click outside any flyout to close all
        $(document).on('click', function (e) {
            // Check if click is inside any flyout or trigger
            let clickedInsideFlyout = false;

            flyouts.forEach((flyoutData) => {
                const { $flyout, $trigger } = flyoutData;
                if ($(e.target).closest($flyout).length || $(e.target).closest($trigger).length) {
                    clickedInsideFlyout = true;
                }
            });

            if (!clickedInsideFlyout) {
                hideAllFlyouts();
            }
        });

        // Reposition visible flyouts on window resize
        $(window).on('resize', function () {
            flyouts.forEach((flyoutData, flyoutSelector) => {
                if (flyoutData.isVisible) {
                    positionFlyout(flyoutSelector);
                }
            });
        });

        console.log('Classic Flyout Manager: Initialized');
    }

    // Initialize when DOM is ready
    $(document).ready(function () {
        init();
    });

    // Export public API
    window.ClassicFlyoutManager = {
        register: registerFlyout,
        show: showFlyout,
        hide: hideFlyout,
        toggle: toggleFlyout,
        hideAll: hideAllFlyouts
    };
})();
