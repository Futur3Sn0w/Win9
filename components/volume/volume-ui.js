/**
 * Volume UI Controller
 * Handles the volume flyout UI and system volume integration
 */

(function () {
    'use strict';

    // Check if running in Electron
    const isElectron = typeof require !== 'undefined' && typeof process !== 'undefined';
    let ipcRenderer = null;

    if (isElectron) {
        try {
            const electron = require('electron');
            ipcRenderer = electron.ipcRenderer;
            console.log('Volume UI: Running in Electron mode');
        } catch (e) {
            console.warn('Volume UI: Could not load Electron IPC');
        }
    }

    // State
    let currentVolume = 50;
    let currentMuted = false;
    let isUpdatingFromSystem = false;
    let pollInterval = null;

    // DOM Elements
    const $volumeFlyout = $('#volume-flyout');
    const $volumeIcon = $('#volume-icon');
    const $volumeIconImg = $('#volume-icon-img');
    const $volumeSlider = $('#volume-slider');
    const $volumeLevelDisplay = $('#volume-level-display');
    const $volumeFlyoutIcon = $('#volume-flyout-icon');

    const FLYOUT_VERTICAL_SPACING = 12;
    const FLYOUT_SCREEN_MARGIN = 8;
    const FLYOUT_RIGHT_SCREEN_MARGIN = 10;
    const DEFAULT_FLYOUT_WIDTH = 84;
    const DEFAULT_FLYOUT_HEIGHT = 305;

    /**
     * Get volume icon path based on volume and mute state
     */
    function getVolumeIconPath(volume, muted) {
        if (muted) {
            return 'resources/images/tray/volume/vol_muted.png';
        } else if (volume === 0) {
            return 'resources/images/tray/volume/vol_0.png';
        } else if (volume <= 33) {
            return 'resources/images/tray/volume/vol_1.png';
        } else if (volume <= 66) {
            return 'resources/images/tray/volume/vol_2.png';
        } else {
            return 'resources/images/tray/volume/vol_3.png';
        }
    }

    /**
     * Get volume icon class based on volume and mute state (for flyout)
     */
    function getVolumeIconClass(volume, muted) {
        if (muted) {
            return 'mif-volume-mute2'; // Muted state
        } else if (volume === 0) {
            return 'mif-volume-mute'; // Volume at 0
        } else if (volume <= 33) {
            return 'mif-volume-low';
        } else if (volume <= 66) {
            return 'mif-volume-medium';
        } else {
            return 'mif-volume-high';
        }
    }

    /**
     * Update the UI with current volume state
     */
    function updateVolumeUI(volume, muted) {
        currentVolume = Math.max(0, Math.min(100, parseInt(volume, 10) || 0));
        currentMuted = muted;

        const iconPath = getVolumeIconPath(currentVolume, muted);
        const iconClass = getVolumeIconClass(currentVolume, muted);

        // Update taskbar icon image
        if ($volumeIconImg.length) {
            $volumeIconImg.attr('src', iconPath);
        }

        // Update taskbar icon tooltip
        updateVolumeTooltip(volume, muted);

        // Update flyout icon (still uses icon font)
        $volumeFlyoutIcon.attr('class', iconClass);

        // Update slider and display
        isUpdatingFromSystem = true;
        $volumeSlider.val(currentVolume);
        $volumeLevelDisplay.text(currentVolume);
        isUpdatingFromSystem = false;

        const settingsSlider = document.getElementById('settings-volume-slider');
        if (settingsSlider && Number(settingsSlider.value) !== currentVolume) {
            settingsSlider.value = currentVolume;
        }
    }

    /**
     * Preview volume changes without requesting system update
     */
    function previewVolume(volume) {
        updateVolumeUI(volume, currentMuted);
    }

    /**
     * Update the volume icon tooltip
     */
    function updateVolumeTooltip(volume, muted) {
        if (!$volumeIcon.length) {
            return;
        }

        let tooltipText = '';

        if (muted) {
            tooltipText = `Volume (muted) ${volume}%`;
        } else {
            tooltipText = `Volume ${volume}%`;
        }

        $volumeIcon.attr('title', tooltipText);
    }

    /**
     * Reset the flyout position back to CSS defaults
     */
    function resetFlyoutPosition() {
        $volumeFlyout.css({
            top: '',
            left: '',
            bottom: '',
            right: ''
        });
    }

    /**
     * Position the flyout centered above the volume icon
     */
    function positionVolumeFlyout({ forceMeasure = false } = {}) {
        if (!$volumeFlyout.length || !$volumeIcon.length) {
            resetFlyoutPosition();
            return;
        }

        const iconElement = $volumeIcon[0];
        const flyoutElement = $volumeFlyout[0];

        if (!iconElement || !flyoutElement) {
            resetFlyoutPosition();
            return;
        }

        const iconRect = iconElement.getBoundingClientRect();

        if ((iconRect.width === 0 && iconRect.height === 0) || Number.isNaN(iconRect.left)) {
            resetFlyoutPosition();
            return;
        }

        let cleanup = false;
        let previousDisplay = '';
        let previousVisibility = '';

        if (forceMeasure && !$volumeFlyout.hasClass('visible')) {
            previousDisplay = flyoutElement.style.display;
            previousVisibility = flyoutElement.style.visibility;

            flyoutElement.style.display = 'flex';
            flyoutElement.style.visibility = 'hidden';

            cleanup = true;
        }

        const flyoutRect = flyoutElement.getBoundingClientRect();
        const flyoutWidth = flyoutRect.width || $volumeFlyout.outerWidth() || DEFAULT_FLYOUT_WIDTH;
        const flyoutHeight = flyoutRect.height || $volumeFlyout.outerHeight() || DEFAULT_FLYOUT_HEIGHT;

        const centeredLeft = iconRect.left + (iconRect.width / 2) - (flyoutWidth / 2);

        let left = centeredLeft;

        if (centeredLeft < FLYOUT_SCREEN_MARGIN) {
            left = FLYOUT_SCREEN_MARGIN;
        }

        const maxRight = window.innerWidth - FLYOUT_RIGHT_SCREEN_MARGIN;
        const flyoutRightEdge = left + flyoutWidth;

        if (flyoutRightEdge > maxRight) {
            left = window.innerWidth - flyoutWidth - FLYOUT_RIGHT_SCREEN_MARGIN;
        }

        left = Math.max(left, FLYOUT_SCREEN_MARGIN);

        let bottom = (window.innerHeight - iconRect.top) + FLYOUT_VERTICAL_SPACING;
        bottom = Math.max(bottom, FLYOUT_SCREEN_MARGIN);

        const maxBottom = Math.max(window.innerHeight - flyoutHeight - FLYOUT_SCREEN_MARGIN, FLYOUT_SCREEN_MARGIN);
        bottom = Math.min(bottom, maxBottom);

        $volumeFlyout.css({
            left: `${left}px`,
            top: 'auto',
            bottom: `${bottom}px`,
            right: 'auto'
        });

        if (cleanup) {
            flyoutElement.style.display = previousDisplay;
            flyoutElement.style.visibility = previousVisibility;
        }
    }

    /**
     * Get volume state from system
     */
    async function getVolumeState() {
        if (!ipcRenderer) {
            console.warn('Volume UI: IPC not available, using mock data');
            return { volume: 50, muted: false };
        }

        try {
            const result = await ipcRenderer.invoke('get-volume-state');
            if (result.success) {
                return { volume: result.volume, muted: result.muted };
            }
        } catch (error) {
            console.error('Volume UI: Error getting volume state:', error);
        }

        return { volume: currentVolume, muted: currentMuted };
    }

    /**
     * Set system volume
     */
    async function setVolume(volume) {
        if (!ipcRenderer) {
            console.warn('Volume UI: IPC not available, cannot set volume');
            updateVolumeUI(volume, currentMuted);
            return;
        }

        try {
            const result = await ipcRenderer.invoke('set-volume', volume);
            if (result.success) {
                // Update UI immediately for responsiveness
                updateVolumeUI(volume, currentMuted);
            }
        } catch (error) {
            console.error('Volume UI: Error setting volume:', error);
        }
    }

    /**
     * Toggle mute state
     */
    async function toggleMute() {
        if (!ipcRenderer) {
            console.warn('Volume UI: IPC not available, cannot toggle mute');
            updateVolumeUI(currentVolume, !currentMuted);
            return;
        }

        try {
            const newMuted = !currentMuted;
            const result = await ipcRenderer.invoke('set-muted', newMuted);
            if (result.success) {
                updateVolumeUI(currentVolume, newMuted);
            }
        } catch (error) {
            console.error('Volume UI: Error toggling mute:', error);
        }
    }

    /**
     * Poll for external volume changes
     */
    async function pollVolumeState() {
        const state = await getVolumeState();

        // Only update if values have changed
        if (state.volume !== currentVolume || state.muted !== currentMuted) {
            console.log('Volume UI: External change detected', state);
            updateVolumeUI(state.volume, state.muted);
        }
    }

    /**
     * Start polling for external changes
     */
    function startPolling() {
        if (pollInterval) return;

        // Poll every 2 seconds for external changes
        pollInterval = setInterval(pollVolumeState, 2000);
        console.log('Volume UI: Started polling for external changes');
    }

    /**
     * Stop polling
     */
    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
            console.log('Volume UI: Stopped polling');
        }
    }

    /**
     * Show volume flyout
     */
    function showVolumeFlyout() {
        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus();
        }

        positionVolumeFlyout({ forceMeasure: true });
        $volumeFlyout.addClass('visible');
        $volumeIcon.addClass('active');
        positionVolumeFlyout();
    }

    /**
     * Hide volume flyout
     */
    function hideVolumeFlyout() {
        $volumeFlyout.removeClass('visible');
        $volumeIcon.removeClass('active');
    }

    /**
     * Initialize volume control
     */
    async function init() {
        console.log('Volume UI: Initializing...');

        // Get initial volume state
        const state = await getVolumeState();
        updateVolumeUI(state.volume, state.muted);

        // Start polling for external changes
        startPolling();

        // Event: Click volume icon to toggle flyout
        $volumeIcon.on('click', function (e) {
            e.stopPropagation();
            if ($volumeFlyout.hasClass('visible')) {
                hideVolumeFlyout();
            } else {
                showVolumeFlyout();
            }
        });

        // Event: Volume slider input (while dragging) - only update UI
        $volumeSlider.on('input', function () {
            if (isUpdatingFromSystem) return;

            const volume = parseInt($(this).val());
            $volumeLevelDisplay.text(volume);

            // Update icons immediately for visual feedback
            const iconPath = getVolumeIconPath(volume, currentMuted);
            const iconClass = getVolumeIconClass(volume, currentMuted);

            if ($volumeIconImg.length) {
                $volumeIconImg.attr('src', iconPath);
            }
            $volumeFlyoutIcon.attr('class', iconClass);

            // Update tooltip
            updateVolumeTooltip(volume, currentMuted);
        });

        // Event: Volume slider change (on mouse release) - actually set volume
        $volumeSlider.on('change', function () {
            if (isUpdatingFromSystem) return;

            const volume = parseInt($(this).val());
            setVolume(volume);

            // Play default beep sound when volume is changed
            if (window.systemSounds) {
                systemSounds.play('default_beep');
            }
        });

        // Event: Click volume icon in flyout to toggle mute
        $volumeFlyoutIcon.on('click', function (e) {
            e.stopPropagation();
            toggleMute();
        });

        // Event: Click outside to close flyout
        $(document).on('click', function (e) {
            if (!$(e.target).closest('.volume-flyout, .volume-icon').length) {
                hideVolumeFlyout();
            }
        });

        // Reposition flyout when the window resizes while visible
        $(window).on('resize', function () {
            if ($volumeFlyout.hasClass('visible')) {
                positionVolumeFlyout();
            }
        });

        console.log('Volume UI: Initialized');
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

    // Export for debugging
    window.VolumeUI = {
        getVolumeState,
        setVolume,
        previewVolume,
        toggleMute,
        startPolling,
        stopPolling,
        hideFlyout: hideVolumeFlyout
    };
})();
