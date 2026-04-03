(() => {
    const TIME_BANK_TICK_EVENT = 'shell-timebank-tick';

    let initialized = false;
    let tickTimeoutId = null;
    let currentTimestamp = Date.now();
    const listeners = new Set();

    function createSnapshot(timestamp, reason = 'tick') {
        return {
            timestamp,
            now: new Date(timestamp),
            reason
        };
    }

    function getSnapshot() {
        return createSnapshot(currentTimestamp, 'snapshot');
    }

    function notifyListeners(reason = 'tick') {
        const snapshot = createSnapshot(currentTimestamp, reason);

        listeners.forEach((listener) => {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('[TimeBank] Listener failed:', error);
            }
        });

        if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent(TIME_BANK_TICK_EVENT, { detail: snapshot }));
        }
    }

    function getNextTickDelay() {
        const remainder = Date.now() % 1000;
        return remainder === 0 ? 1000 : 1000 - remainder;
    }

    function scheduleNextTick() {
        if (tickTimeoutId) {
            clearTimeout(tickTimeoutId);
        }

        tickTimeoutId = setTimeout(() => {
            currentTimestamp = Date.now();
            notifyListeners('tick');
            scheduleNextTick();
        }, getNextTickDelay());
    }

    function start() {
        initialized = true;
        currentTimestamp = Date.now();
        notifyListeners('start');
        scheduleNextTick();
        return getSnapshot();
    }

    function stop() {
        if (tickTimeoutId) {
            clearTimeout(tickTimeoutId);
            tickTimeoutId = null;
        }
    }

    function initialize() {
        if (initialized) {
            if (!tickTimeoutId) {
                return start();
            }
            return getSnapshot();
        }

        return start();
    }

    function refresh(reason = 'refresh') {
        initialized = true;
        currentTimestamp = Date.now();
        notifyListeners(reason);
        scheduleNextTick();
        return getSnapshot();
    }

    function subscribe(listener, options = {}) {
        if (typeof listener !== 'function') {
            return () => {};
        }

        initialize();
        listeners.add(listener);

        if (options.immediate !== false) {
            try {
                listener(getSnapshot());
            } catch (error) {
                console.error('[TimeBank] Immediate listener call failed:', error);
            }
        }

        return () => {
            listeners.delete(listener);
        };
    }

    window.TimeBank = {
        initialize,
        subscribe,
        getSnapshot,
        refresh,
        start,
        stop,
        TIME_BANK_TICK_EVENT
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initialize();
        }, { once: true });
    } else {
        initialize();
    }
})();
