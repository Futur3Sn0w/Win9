(function () {
    const DISPLAY_REGISTRY_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Display';
    const DISPLAY_ZOOM_VALUE_NAME = 'ZoomPercent';
    const DISPLAY_DEFAULT_ZOOM_PERCENT = 100;
    const DISPLAY_MIN_ZOOM_PERCENT = 25;
    const DISPLAY_MAX_ZOOM_PERCENT = 500;
    const DISPLAY_ZOOM_PRESETS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200];

    let displayApi = null;
    let currentState = null;
    let selectedZoomPercent = DISPLAY_DEFAULT_ZOOM_PERCENT;
    let statusTimeoutId = null;
    let identifyTimeoutId = null;
    let topDisplayWindow = null;
    let topDisplayListener = null;

    const elements = {};

    function normalizeZoomPercent(value, fallback) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallback != null ? fallback : DISPLAY_DEFAULT_ZOOM_PERCENT;
        }

        const rounded = Math.round(numeric);
        return Math.max(DISPLAY_MIN_ZOOM_PERCENT, Math.min(DISPLAY_MAX_ZOOM_PERCENT, rounded));
    }

    function roundResolutionDimension(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return 1;
        }

        return Math.max(1, Math.round(numeric));
    }

    function buildResolutionOption(display, zoomPercent) {
        const normalizedZoomPercent = normalizeZoomPercent(zoomPercent);
        const zoomFactor = normalizedZoomPercent / 100;
        const width = roundResolutionDimension(display.width / zoomFactor);
        const height = roundResolutionDimension(display.height / zoomFactor);
        const isDefault = normalizedZoomPercent === DISPLAY_DEFAULT_ZOOM_PERCENT;
        const suffix = isDefault ? ' (Default)' : ` (${normalizedZoomPercent}% zoom)`;

        return {
            zoomPercent: normalizedZoomPercent,
            zoomFactor,
            width,
            height,
            label: `${width} x ${height}${suffix}`,
            isDefault
        };
    }

    function buildFallbackDisplayApi() {
        if (typeof window.require !== 'function') {
            return null;
        }

        try {
            const electron = window.require('electron');
            const registryModule = window.require('../../../registry/registry.js');
            const registry = registryModule.getRegistry();
            const registryType = registryModule.RegistryType ? registryModule.RegistryType.REG_DWORD : 4;

            function getDisplayMetrics() {
                const primaryDisplay = electron.screen && typeof electron.screen.getPrimaryDisplay === 'function'
                    ? electron.screen.getPrimaryDisplay()
                    : null;
                const scaleFactor = Number(primaryDisplay && primaryDisplay.scaleFactor) || 1;
                const width = roundResolutionDimension(((primaryDisplay && primaryDisplay.size && primaryDisplay.size.width) || window.screen.width || 1366) * scaleFactor);
                const height = roundResolutionDimension(((primaryDisplay && primaryDisplay.size && primaryDisplay.size.height) || window.screen.height || 768) * scaleFactor);

                return {
                    label: (primaryDisplay && primaryDisplay.label) || 'Generic PnP Monitor',
                    width,
                    height,
                    aspectRatio: height > 0 ? width / height : 1
                };
            }

            function getZoomPercent() {
                if (electron.webFrame && typeof electron.webFrame.getZoomFactor === 'function') {
                    return normalizeZoomPercent(electron.webFrame.getZoomFactor() * 100);
                }

                return normalizeZoomPercent(
                    registry.getValue(DISPLAY_REGISTRY_PATH, DISPLAY_ZOOM_VALUE_NAME, DISPLAY_DEFAULT_ZOOM_PERCENT)
                );
            }

            return {
                getState: function () {
                    const display = getDisplayMetrics();
                    const zoomPercent = getZoomPercent();
                    const zoomPercents = new Set(DISPLAY_ZOOM_PRESETS);
                    zoomPercents.add(zoomPercent);

                    const resolutionOptions = Array.from(zoomPercents)
                        .map(function (preset) {
                            return buildResolutionOption(display, preset);
                        })
                        .sort(function (left, right) {
                            const areaDelta = (right.width * right.height) - (left.width * left.height);
                            if (areaDelta !== 0) {
                                return areaDelta;
                            }

                            return left.zoomPercent - right.zoomPercent;
                        });

                    return {
                        display,
                        zoomPercent,
                        zoomFactor: zoomPercent / 100,
                        currentResolution: resolutionOptions.find(function (option) {
                            return option.zoomPercent === zoomPercent;
                        }) || buildResolutionOption(display, zoomPercent),
                        resolutionOptions
                    };
                },
                setZoomPercent: function (zoomPercent) {
                    const normalized = normalizeZoomPercent(zoomPercent);

                    if (electron.webFrame && typeof electron.webFrame.setZoomFactor === 'function') {
                        electron.webFrame.setZoomFactor(normalized / 100);
                    }

                    registry.setValue(
                        DISPLAY_REGISTRY_PATH,
                        DISPLAY_ZOOM_VALUE_NAME,
                        normalized,
                        registryType
                    );

                    return normalized;
                }
            };
        } catch (error) {
            console.error('Screen Resolution fallback API unavailable:', error);
            return null;
        }
    }

    function resolveDisplayApi() {
        try {
            if (window.top && window.top.DisplaySettingsAPI) {
                return window.top.DisplaySettingsAPI;
            }
        } catch (error) {
            console.warn('Unable to access top-level DisplaySettingsAPI:', error);
        }

        if (window.DisplaySettingsAPI) {
            return window.DisplaySettingsAPI;
        }

        return buildFallbackDisplayApi();
    }

    function cacheElements() {
        elements.displaySelect = document.getElementById('displaySelect');
        elements.resolutionSelect = document.getElementById('resolutionSelect');
        elements.monitorScreen = document.getElementById('monitorScreen');
        elements.monitorCaption = document.getElementById('monitorCaption');
        elements.currentSummary = document.getElementById('currentSummary');
        elements.statusMessage = document.getElementById('statusMessage');
        elements.identifyOverlay = document.getElementById('identifyOverlay');
        elements.detectButton = document.getElementById('detectButton');
        elements.identifyButton = document.getElementById('identifyButton');
        elements.advancedSettingsButton = document.getElementById('advancedSettingsButton');
        elements.sizeHelpButton = document.getElementById('sizeHelpButton');
        elements.mappingHelpButton = document.getElementById('mappingHelpButton');
        elements.okButton = document.getElementById('okButton');
        elements.cancelButton = document.getElementById('cancelButton');
        elements.applyButton = document.getElementById('applyButton');
    }

    function hasPendingChanges() {
        return !!currentState && normalizeZoomPercent(selectedZoomPercent) !== normalizeZoomPercent(currentState.zoomPercent);
    }

    function getRenderedResolutionOptions() {
        const options = currentState && Array.isArray(currentState.resolutionOptions)
            ? currentState.resolutionOptions.slice()
            : [];

        if (!currentState) {
            return options;
        }

        const normalizedSelected = normalizeZoomPercent(selectedZoomPercent, currentState.zoomPercent);
        if (!options.some(function (option) { return option.zoomPercent === normalizedSelected; })) {
            options.push(buildResolutionOption(currentState.display, normalizedSelected));
        }

        return options.sort(function (left, right) {
            const areaDelta = (right.width * right.height) - (left.width * left.height);
            if (areaDelta !== 0) {
                return areaDelta;
            }

            return left.zoomPercent - right.zoomPercent;
        });
    }

    function showStatus(message, isEmphasis) {
        elements.statusMessage.textContent = message || '';
        elements.statusMessage.classList.toggle('is-emphasis', !!isEmphasis);

        if (statusTimeoutId) {
            clearTimeout(statusTimeoutId);
            statusTimeoutId = null;
        }

        if (message) {
            statusTimeoutId = setTimeout(function () {
                elements.statusMessage.textContent = '';
                elements.statusMessage.classList.remove('is-emphasis');
                statusTimeoutId = null;
            }, 5000);
        }
    }

    function renderMonitorPreview(display) {
        const maxWidth = 150;
        const maxHeight = 92;
        const aspectRatio = display && display.aspectRatio ? display.aspectRatio : 1.7778;

        let previewWidth = maxWidth;
        let previewHeight = roundResolutionDimension(previewWidth / aspectRatio);

        if (previewHeight > maxHeight) {
            previewHeight = maxHeight;
            previewWidth = roundResolutionDimension(previewHeight * aspectRatio);
        }

        elements.monitorScreen.style.width = `${previewWidth}px`;
        elements.monitorScreen.style.height = `${previewHeight}px`;
        elements.monitorCaption.textContent = `${display.width} x ${display.height} native`;
    }

    function renderDisplaySelect(display) {
        elements.displaySelect.innerHTML = '';

        const option = document.createElement('option');
        option.value = 'primary-display';
        option.textContent = `1. ${display.label || 'Generic PnP Monitor'}`;
        elements.displaySelect.appendChild(option);
    }

    function renderResolutionSelect() {
        const options = getRenderedResolutionOptions();
        const normalizedSelected = normalizeZoomPercent(selectedZoomPercent, currentState.zoomPercent);

        elements.resolutionSelect.innerHTML = '';

        options.forEach(function (optionData) {
            const option = document.createElement('option');
            option.value = String(optionData.zoomPercent);
            option.textContent = optionData.label;
            option.selected = optionData.zoomPercent === normalizedSelected;
            elements.resolutionSelect.appendChild(option);
        });
    }

    function renderSummary() {
        if (!currentState) {
            elements.currentSummary.textContent = '';
            return;
        }

        const selectedOption = buildResolutionOption(currentState.display, selectedZoomPercent);
        const selectedText = `${selectedOption.width} x ${selectedOption.height}`;
        const currentText = `${currentState.currentResolution.width} x ${currentState.currentResolution.height}`;

        if (hasPendingChanges()) {
            elements.currentSummary.textContent = `Selected: ${selectedText} at ${selectedOption.zoomPercent}% browser zoom. Current: ${currentText}.`;
        } else {
            elements.currentSummary.textContent = `Current: ${currentText} at ${currentState.zoomPercent}% browser zoom.`;
        }

        elements.applyButton.disabled = !hasPendingChanges();
    }

    function render() {
        if (!currentState) {
            return;
        }

        renderMonitorPreview(currentState.display);
        renderDisplaySelect(currentState.display);
        renderResolutionSelect();
        renderSummary();
    }

    function refreshState(options) {
        const settings = options || {};
        const preserveSelection = settings.preserveSelection !== false;
        const previousSelection = selectedZoomPercent;
        const previousZoomPercent = currentState ? currentState.zoomPercent : DISPLAY_DEFAULT_ZOOM_PERCENT;
        const keepSelection = preserveSelection && normalizeZoomPercent(previousSelection, previousZoomPercent) !== normalizeZoomPercent(previousZoomPercent);

        currentState = displayApi.getState();
        selectedZoomPercent = keepSelection
            ? normalizeZoomPercent(previousSelection, currentState.zoomPercent)
            : normalizeZoomPercent(currentState.zoomPercent);

        render();
    }

    function applySelectedResolution(closeAfterApply) {
        if (!currentState) {
            return;
        }

        const normalizedSelected = normalizeZoomPercent(selectedZoomPercent, currentState.zoomPercent);

        if (!hasPendingChanges()) {
            if (closeAfterApply) {
                closeControlPanel();
            }
            return;
        }

        displayApi.setZoomPercent(normalizedSelected);
        refreshState({ preserveSelection: false });

        showStatus(
            `Applied ${currentState.currentResolution.width} x ${currentState.currentResolution.height} using ${currentState.zoomPercent}% browser zoom.`,
            true
        );

        if (closeAfterApply) {
            closeControlPanel();
        }
    }

    function closeControlPanel() {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'closeControlPanel' }, '*');
            return;
        }

        window.close();
    }

    function flashIdentifyOverlay() {
        elements.identifyOverlay.classList.add('visible');

        if (identifyTimeoutId) {
            clearTimeout(identifyTimeoutId);
        }

        identifyTimeoutId = setTimeout(function () {
            elements.identifyOverlay.classList.remove('visible');
            identifyTimeoutId = null;
        }, 1500);
    }

    function attachEvents() {
        elements.resolutionSelect.addEventListener('change', function (event) {
            selectedZoomPercent = normalizeZoomPercent(event.target.value, currentState.zoomPercent);
            renderSummary();
        });

        elements.detectButton.addEventListener('click', function () {
            showStatus('No additional display was detected.', false);
        });

        elements.identifyButton.addEventListener('click', function () {
            flashIdentifyOverlay();
            showStatus('Display 1 is the only active display in this build.', false);
        });

        elements.advancedSettingsButton.addEventListener('click', function () {
            showStatus('Advanced adapter settings are not available yet.', false);
        });

        elements.sizeHelpButton.addEventListener('click', function () {
            showStatus('Text scaling is currently represented by the resolution list above and browser zoom shortcuts.', false);
        });

        elements.mappingHelpButton.addEventListener('click', function () {
            showStatus('Lower listed resolutions correspond to higher browser zoom. Higher listed resolutions correspond to lower browser zoom.', false);
        });

        elements.applyButton.addEventListener('click', function () {
            applySelectedResolution(false);
        });

        elements.okButton.addEventListener('click', function () {
            applySelectedResolution(true);
        });

        elements.cancelButton.addEventListener('click', function () {
            closeControlPanel();
        });

        window.addEventListener('resize', function () {
            refreshState({ preserveSelection: true });
        });
    }

    function attachHostListeners() {
        try {
            topDisplayWindow = window.top && window.top !== window ? window.top : null;
        } catch (error) {
            topDisplayWindow = null;
        }

        if (!topDisplayWindow || typeof topDisplayWindow.addEventListener !== 'function') {
            return;
        }

        topDisplayListener = function () {
            refreshState({ preserveSelection: true });
        };

        topDisplayWindow.addEventListener('win9-display-settings-changed', topDisplayListener);

        window.addEventListener('unload', function () {
            if (topDisplayWindow && topDisplayListener) {
                topDisplayWindow.removeEventListener('win9-display-settings-changed', topDisplayListener);
            }
        }, { once: true });
    }

    function init() {
        cacheElements();
        displayApi = resolveDisplayApi();

        if (!displayApi || typeof displayApi.getState !== 'function' || typeof displayApi.setZoomPercent !== 'function') {
            showStatus('Display settings are unavailable in this environment.', false);
            return;
        }

        attachEvents();
        attachHostListeners();
        refreshState({ preserveSelection: false });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
