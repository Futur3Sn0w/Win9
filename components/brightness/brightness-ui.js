/**
 * Brightness UI bridge
 * Handles renderer-side IPC calls for the six-pack brightness slider.
 */

(function () {
    'use strict';

    const isElectron = typeof require !== 'undefined' && typeof process !== 'undefined';
    let ipcRenderer = null;

    if (isElectron) {
        try {
            ipcRenderer = require('electron').ipcRenderer;
        } catch (error) {
            console.warn('Brightness UI: Could not load Electron IPC');
        }
    }

    const DEFAULT_BRIGHTNESS = 100;
    let currentBrightness = DEFAULT_BRIGHTNESS;
    let brightnessSupported = false;
    let capabilityKnown = false;
    let previewInFlight = null;
    let queuedPreviewValue = null;
    let initializationPromise = null;

    function clampBrightness(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return DEFAULT_BRIGHTNESS;
        }

        return Math.max(0, Math.min(100, Math.round(numericValue)));
    }

    function createFallbackState(overrides = {}) {
        return {
            success: false,
            supported: false,
            brightness: currentBrightness,
            error: null,
            ...overrides
        };
    }

    async function invokeBrightness(channel, value) {
        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
            capabilityKnown = true;
            brightnessSupported = false;
            return createFallbackState({
                error: 'Brightness IPC unavailable.'
            });
        }

        try {
            const result = await ipcRenderer.invoke(channel, value);
            const resolvedBrightness =
                result && typeof result.brightness === 'number'
                    ? result.brightness
                    : currentBrightness;

            currentBrightness = clampBrightness(resolvedBrightness);
            brightnessSupported = !!result?.supported;
            capabilityKnown = true;

            return {
                success: !!result?.success,
                supported: brightnessSupported,
                brightness: currentBrightness,
                error: result?.error || null
            };
        } catch (error) {
            capabilityKnown = true;
            brightnessSupported = false;
            console.error('Brightness UI: IPC request failed:', error);
            return createFallbackState({
                error: error.message || 'Brightness request failed.'
            });
        }
    }

    async function getBrightnessState() {
        return invokeBrightness('get-brightness-state');
    }

    function prewarm() {
        if (!initializationPromise) {
            initializationPromise = getBrightnessState();
        }

        return initializationPromise;
    }

    async function flushPreviewBrightness() {
        if (previewInFlight) {
            return previewInFlight;
        }

        if (queuedPreviewValue == null) {
            return createFallbackState();
        }

        const nextValue = queuedPreviewValue;
        queuedPreviewValue = null;

        previewInFlight = invokeBrightness('set-brightness', nextValue).finally(() => {
            previewInFlight = null;
            if (queuedPreviewValue != null && brightnessSupported) {
                void flushPreviewBrightness();
            }
        });

        return previewInFlight;
    }

    function previewBrightness(value) {
        currentBrightness = clampBrightness(value);
        queuedPreviewValue = currentBrightness;

        if (brightnessSupported) {
            void flushPreviewBrightness();
            return;
        }

        if (!capabilityKnown) {
            void getBrightnessState().then((state) => {
                if (state.supported && queuedPreviewValue != null) {
                    void flushPreviewBrightness();
                }
            });
        }
    }

    async function setBrightness(value) {
        const nextValue = clampBrightness(value);
        currentBrightness = nextValue;
        queuedPreviewValue = null;

        if (previewInFlight) {
            try {
                await previewInFlight;
            } catch (error) {
                console.error('Brightness UI: Preview brightness request failed:', error);
            }
        }

        return invokeBrightness('set-brightness', nextValue);
    }

    window.BrightnessUI = {
        prewarm,
        getBrightnessState,
        previewBrightness,
        setBrightness,
        isSupported() {
            return brightnessSupported;
        },
        getCurrentBrightness() {
            return currentBrightness;
        }
    };

    void prewarm();
})();
