(() => {
    'use strict';

    const MOUSE_DRAG_THRESHOLD_PX = 8;
    const TOUCH_DRAG_THRESHOLD_PX = 14;
    const TOUCH_DRAG_HOLD_MS = 180;
    const TOUCH_DRAG_CANCEL_DISTANCE_PX = 10;
    const POPUP_VERTICAL_SPACING = 8;
    const POPUP_SCREEN_MARGIN = 8;
    const POPUP_CLOSE_ANIMATION_MS = 220;
    const CLICK_SUPPRESS_MS = 160;
    const OVERFLOW_ICON_SIZES = [16, 20, 24, 32];

    const state = {
        order: [],
        overflowCount: 0,
        itemMap: new Map(),
        itemAvailability: new WeakMap(),
        popupVisible: false,
        closeTimer: null,
        pendingRender: false,
        suppressClickUntil: 0,
        suppressClickItemId: '',
        allowSyntheticClickItemId: '',
        drag: createEmptyDragState()
    };

    function createEmptyDragState() {
        return {
            sourceEl: null,
            draggedId: '',
            startX: 0,
            startY: 0,
            lastX: 0,
            lastY: 0,
            pointerId: null,
            pointerType: '',
            holdTimer: null,
            pointerOffsetX: 0,
            pointerOffsetY: 0,
            started: false,
            proxyEl: null,
            initialOrder: [],
            initialVisibleIds: [],
            initialOverflowIds: [],
            visibleIdsExcludingDragged: [],
            overflowIdsExcludingDragged: [],
            overflowCountWithoutDragged: 0,
            sourceIndex: -1,
            targetZone: null,
            targetLocalIndex: 0,
            targetGlobalIndex: -1,
            autoOpenedPopup: false,
            popupWasVisible: false
        };
    }

    function getVisibleContainer() {
        return document.getElementById('tray-visible-items');
    }

    function getOverflowContainer() {
        return document.getElementById('tray-overflow-items');
    }

    function getOverflowDropzone() {
        return document.getElementById('tray-overflow-dropzone');
    }

    function getPopupElement() {
        return document.getElementById('tray-overflow-popup');
    }

    function getToggleButton() {
        return document.getElementById('tray-overflow-toggle');
    }

    function getToggleButtonIcon() {
        return document.getElementById('tray-overflow-toggle-icon');
    }

    function getVisibleIndicator() {
        return document.getElementById('tray-visible-drop-indicator');
    }

    function getOverflowIndicator() {
        return document.getElementById('tray-overflow-drop-indicator');
    }

    function getCustomizeButton() {
        return document.getElementById('tray-overflow-customize');
    }

    function getItemId(element) {
        return element?.dataset?.trayItemId || '';
    }

    function getDragThreshold(pointerType) {
        return pointerType === 'touch' || pointerType === 'pen'
            ? TOUCH_DRAG_THRESHOLD_PX
            : MOUSE_DRAG_THRESHOLD_PX;
    }

    function dispatchTrayItemClick(element) {
        if (!element) {
            return;
        }

        const itemId = getItemId(element);
        if (!itemId) {
            return;
        }

        state.allowSyntheticClickItemId = itemId;
        element.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));
        state.suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
        state.suppressClickItemId = itemId;
    }

    function clearDragHoldTimer() {
        if (!state.drag.holdTimer) {
            return;
        }

        clearTimeout(state.drag.holdTimer);
        state.drag.holdTimer = null;
    }

    function isItemAvailable(element) {
        if (!element) {
            return false;
        }

        if (element.classList.contains('is-hidden')) {
            return false;
        }

        return element.style.display !== 'none';
    }

    function getAllItemElements() {
        return Array.from(document.querySelectorAll('.tray-reorderable[data-tray-item-id]'));
    }

    function hasItemAvailabilityChanged(item) {
        const isAvailable = isItemAvailable(item);
        const previousValue = state.itemAvailability.get(item);

        state.itemAvailability.set(item, isAvailable);
        return previousValue !== isAvailable;
    }

    function getStoredOrder() {
        const registry = window.TileLayoutRegistry;
        if (!registry || typeof registry.loadTrayOrder !== 'function') {
            return [];
        }

        try {
            const saved = registry.loadTrayOrder();
            return Array.isArray(saved) ? saved.filter(Boolean) : [];
        } catch (error) {
            console.warn('[TrayOverflow] Failed to load tray order:', error);
            return [];
        }
    }

    function saveOrder() {
        const registry = window.TileLayoutRegistry;
        if (!registry || typeof registry.saveTrayOrder !== 'function') {
            return;
        }

        try {
            registry.saveTrayOrder(state.order);
        } catch (error) {
            console.warn('[TrayOverflow] Failed to save tray order:', error);
        }
    }

    function getStoredOverflowCount() {
        const registry = window.TileLayoutRegistry;
        if (!registry || typeof registry.loadTrayOverflowCount !== 'function') {
            return 0;
        }

        try {
            const saved = Number(registry.loadTrayOverflowCount());
            if (!Number.isFinite(saved) || saved < 0) {
                return 0;
            }

            return Math.round(saved);
        } catch (error) {
            console.warn('[TrayOverflow] Failed to load tray overflow count:', error);
            return 0;
        }
    }

    function saveOverflowCount() {
        const registry = window.TileLayoutRegistry;
        if (!registry || typeof registry.saveTrayOverflowCount !== 'function') {
            return;
        }

        try {
            registry.saveTrayOverflowCount(state.overflowCount);
        } catch (error) {
            console.warn('[TrayOverflow] Failed to save tray overflow count:', error);
        }
    }

    function mergeOrder(savedOrder, fallbackOrder) {
        const merged = [];
        const fallbackSet = new Set(fallbackOrder);

        savedOrder.forEach((id) => {
            if (fallbackSet.has(id) && !merged.includes(id)) {
                merged.push(id);
            }
        });

        fallbackOrder.forEach((id) => {
            if (!merged.includes(id)) {
                merged.push(id);
            }
        });

        return merged;
    }

    function getActiveIds(order = state.order) {
        return order.filter((id) => isItemAvailable(state.itemMap.get(id)));
    }

    function getNormalizedOverflowCount(activeCount) {
        const normalized = Number(state.overflowCount);
        if (!Number.isFinite(normalized) || normalized < 0) {
            return 0;
        }

        return Math.max(0, Math.min(Math.round(normalized), activeCount));
    }

    function splitActiveIds(order = state.order) {
        const activeIds = getActiveIds(order);
        const overflowCount = getNormalizedOverflowCount(activeIds.length);
        return {
            visibleIds: activeIds.slice(overflowCount),
            overflowIds: activeIds.slice(0, overflowCount),
            overflowCount
        };
    }

    function getToggleButtonAssetScaleFactor() {
        if (typeof window.getTaskbarShellButtonAssetScaleFactor === 'function') {
            const scaleFactor = Number(window.getTaskbarShellButtonAssetScaleFactor());
            if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
                return scaleFactor;
            }
        }

        return Math.max(1, Number(window.devicePixelRatio) || 1);
    }

    function getToggleButtonRenderSize(button = getToggleButton()) {
        if (!button) {
            return document.body.classList.contains('taskbar-small-icons') ? 18 : 20;
        }

        const computedStyle = window.getComputedStyle(button);
        const width = parseFloat(computedStyle.width) || 0;
        const height = parseFloat(computedStyle.height) || 0;

        return Math.max(width, height, document.body.classList.contains('taskbar-small-icons') ? 18 : 20);
    }

    function selectOverflowIconSize(targetSize) {
        const exactMatch = OVERFLOW_ICON_SIZES.find((size) => size === targetSize);
        if (exactMatch) {
            return exactMatch;
        }

        const nextUpSize = OVERFLOW_ICON_SIZES.find((size) => size > targetSize);
        if (typeof nextUpSize === 'number') {
            return nextUpSize;
        }

        return OVERFLOW_ICON_SIZES[OVERFLOW_ICON_SIZES.length - 1];
    }

    function updateToggleButtonIcon() {
        const button = getToggleButton();
        const icon = getToggleButtonIcon();
        if (!button || !icon) {
            return;
        }

        const renderSize = getToggleButtonRenderSize(button);
        const targetAssetSize = Math.max(1, Math.ceil(renderSize * getToggleButtonAssetScaleFactor()));
        const selectedSize = selectOverflowIconSize(targetAssetSize);
        const iconState = state.popupVisible ? 'close' : 'open';
        const nextSrc = `resources/images/tray/overflow/${iconState}/${selectedSize}.png`;
        const nextLabel = state.popupVisible
            ? 'Hide hidden notification icons'
            : 'Show hidden notification icons';

        if (icon.getAttribute('src') !== nextSrc) {
            icon.setAttribute('src', nextSrc);
        }

        button.setAttribute('aria-label', nextLabel);
    }

    function syncButtonState() {
        const button = getToggleButton();
        if (!button) {
            return;
        }

        const { overflowIds } = splitActiveIds();
        const shouldShowButton = overflowIds.length > 0 || state.drag.started;

        button.classList.toggle('is-hidden', !shouldShowButton);
        button.classList.toggle('active', state.popupVisible);
        button.setAttribute('aria-expanded', state.popupVisible ? 'true' : 'false');
        updateToggleButtonIcon();
    }

    function clearCloseTimer() {
        if (state.closeTimer) {
            clearTimeout(state.closeTimer);
            state.closeTimer = null;
        }
    }

    function render() {
        if (state.drag.started) {
            state.pendingRender = true;
            return;
        }

        const visibleContainer = getVisibleContainer();
        const overflowContainer = getOverflowContainer();

        if (!visibleContainer || !overflowContainer) {
            return;
        }

        const { visibleIds, overflowIds, overflowCount } = splitActiveIds();
        const visibleSet = new Set(visibleIds);

        state.order.forEach((id) => {
            const item = state.itemMap.get(id);
            if (!item) {
                return;
            }

            if (visibleSet.has(id)) {
                visibleContainer.appendChild(item);
            } else {
                overflowContainer.appendChild(item);
            }
        });

        if (overflowCount !== state.overflowCount) {
            state.overflowCount = overflowCount;
            saveOverflowCount();
        }

        syncButtonState();

        if (!state.drag.started && overflowIds.length === 0 && state.popupVisible) {
            hidePopup({ immediate: true });
            return;
        }

        if (state.popupVisible) {
            positionPopup();
        }
    }

    function positionPopup() {
        const popup = getPopupElement();
        const button = getToggleButton();

        if (!popup || !button) {
            return;
        }

        const buttonRect = button.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();

        if ((buttonRect.width === 0 && buttonRect.height === 0) || Number.isNaN(buttonRect.left)) {
            return;
        }

        const popupWidth = Math.max(popupRect.width, popup.offsetWidth, popup.scrollWidth);
        let left = buttonRect.left + (buttonRect.width / 2) - (popupWidth / 2);
        left = Math.max(POPUP_SCREEN_MARGIN, left);
        left = Math.min(left, window.innerWidth - popupWidth - POPUP_SCREEN_MARGIN);

        let bottom = (window.innerHeight - buttonRect.top) + POPUP_VERTICAL_SPACING;
        bottom = Math.max(POPUP_SCREEN_MARGIN, bottom);

        popup.style.left = `${Math.round(left)}px`;
        popup.style.right = 'auto';
        popup.style.bottom = `${Math.round(bottom)}px`;
        popup.style.top = 'auto';
    }

    function showPopup(options = {}) {
        const { autoOpenedForDrag = false } = options;
        const popup = getPopupElement();
        const { overflowIds } = splitActiveIds();

        if (!popup) {
            return;
        }

        if (!autoOpenedForDrag && overflowIds.length === 0) {
            return;
        }

        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus({ excludeTrayOverflow: true });
        }

        clearCloseTimer();
        state.popupVisible = true;
        state.drag.autoOpenedPopup = state.drag.autoOpenedPopup || autoOpenedForDrag;

        popup.classList.remove('closing');
        popup.classList.add('visible');
        popup.setAttribute('aria-hidden', 'false');
        document.body.classList.add('tray-overflow-open');

        syncButtonState();
        positionPopup();
    }

    function hidePopup(options = {}) {
        const { immediate = false } = options;
        const popup = getPopupElement();

        if (!popup) {
            return;
        }

        clearCloseTimer();
        state.popupVisible = false;
        popup.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('tray-overflow-open');
        syncButtonState();

        if (immediate) {
            popup.classList.remove('visible', 'closing');
            return;
        }

        popup.classList.remove('visible');
        popup.classList.add('closing');
        state.closeTimer = setTimeout(() => {
            popup.classList.remove('closing');
            state.closeTimer = null;
        }, POPUP_CLOSE_ANIMATION_MS);
    }

    function togglePopup() {
        if (state.popupVisible) {
            hidePopup();
        } else {
            showPopup();
        }
    }

    function clearIndicators() {
        [getVisibleIndicator(), getOverflowIndicator()].forEach((indicator) => {
            if (!indicator) {
                return;
            }

            indicator.classList.remove('is-visible');
            indicator.style.left = '';
            indicator.style.top = '';
            indicator.style.height = '';
        });
    }

    function getDisplayElementsForZone(zone) {
        const ids = zone === 'visible'
            ? state.drag.visibleIdsExcludingDragged
            : state.drag.overflowIdsExcludingDragged;

        return ids
            .map((id) => state.itemMap.get(id))
            .filter((item) => item && isItemAvailable(item));
    }

    function computeInsertionIndex(elements, pointerX) {
        if (!elements.length) {
            return 0;
        }

        for (let index = 0; index < elements.length; index += 1) {
            const rect = elements[index].getBoundingClientRect();
            const centerX = rect.left + (rect.width / 2);
            if (pointerX < centerX) {
                return index;
            }
        }

        return elements.length;
    }

    function pointInsideRect(x, y, rect) {
        return rect &&
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom;
    }

    function positionIndicatorForZone(zone, localIndex) {
        const container = zone === 'visible' ? getVisibleContainer() : getOverflowContainer();
        const indicator = zone === 'visible' ? getVisibleIndicator() : getOverflowIndicator();

        if (!container || !indicator) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const displayElements = getDisplayElementsForZone(zone);

        let left = 10;
        let top = 7;
        let height = Math.max(16, Math.round(containerRect.height - 14));

        if (displayElements.length) {
            let referenceRect = null;

            if (localIndex <= 0) {
                referenceRect = displayElements[0].getBoundingClientRect();
                left = referenceRect.left - containerRect.left - 2;
            } else if (localIndex >= displayElements.length) {
                referenceRect = displayElements[displayElements.length - 1].getBoundingClientRect();
                left = referenceRect.right - containerRect.left + 1;
            } else {
                const previousRect = displayElements[localIndex - 1].getBoundingClientRect();
                const nextRect = displayElements[localIndex].getBoundingClientRect();
                referenceRect = previousRect;
                left = ((previousRect.right + nextRect.left) / 2) - containerRect.left - 2;
                top = Math.min(previousRect.top, nextRect.top) - containerRect.top + 5;
                height = Math.max(previousRect.bottom, nextRect.bottom) - Math.min(previousRect.top, nextRect.top) - 10;
            }

            if (referenceRect) {
                top = referenceRect.top - containerRect.top + 5;
                height = referenceRect.height - 10;
            }
        }

        indicator.style.left = `${Math.round(left)}px`;
        indicator.style.top = `${Math.round(top)}px`;
        indicator.style.height = `${Math.max(12, Math.round(height))}px`;
        indicator.classList.add('is-visible');

        const hiddenIndicator = zone === 'visible' ? getOverflowIndicator() : getVisibleIndicator();
        if (hiddenIndicator) {
            hiddenIndicator.classList.remove('is-visible');
        }
    }

    function updateDropTarget(clientX, clientY) {
        if (!state.drag.started) {
            return;
        }

        const visibleContainer = getVisibleContainer();
        const overflowDropzone = getOverflowDropzone();
        let targetZone = null;

        if (state.popupVisible && overflowDropzone) {
            const popupRect = overflowDropzone.getBoundingClientRect();
            if (pointInsideRect(clientX, clientY, popupRect)) {
                targetZone = 'overflow';
            }
        }

        if (!targetZone && visibleContainer) {
            const visibleRect = visibleContainer.getBoundingClientRect();
            if (pointInsideRect(clientX, clientY, visibleRect)) {
                targetZone = 'visible';
            }
        }

        if (!targetZone) {
            return;
        }

        const displayElements = getDisplayElementsForZone(targetZone);
        const localIndex = computeInsertionIndex(displayElements, clientX);
        const globalIndex = targetZone === 'visible'
            ? state.drag.overflowCountWithoutDragged + localIndex
            : localIndex;

        if (
            state.drag.targetZone === targetZone &&
            state.drag.targetLocalIndex === localIndex &&
            state.drag.targetGlobalIndex === globalIndex
        ) {
            return;
        }

        state.drag.targetZone = targetZone;
        state.drag.targetLocalIndex = localIndex;
        state.drag.targetGlobalIndex = globalIndex;
        positionIndicatorForZone(targetZone, localIndex);
    }

    function stripIds(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        node.removeAttribute('id');
        Array.from(node.children).forEach(stripIds);
    }

    function createDragProxy(sourceEl) {
        const rect = sourceEl.getBoundingClientRect();
        const proxy = sourceEl.cloneNode(true);
        stripIds(proxy);
        proxy.classList.add('tray-drag-proxy');
        proxy.style.width = `${Math.round(rect.width)}px`;
        proxy.style.height = `${Math.round(rect.height)}px`;
        proxy.style.left = `${Math.round(rect.left)}px`;
        proxy.style.top = `${Math.round(rect.top)}px`;
        document.body.appendChild(proxy);
        return proxy;
    }

    function updateDragProxyPosition(clientX, clientY) {
        if (!state.drag.proxyEl) {
            return;
        }

        const left = clientX - state.drag.pointerOffsetX;
        const top = clientY - state.drag.pointerOffsetY;

        state.drag.proxyEl.style.left = `${Math.round(left)}px`;
        state.drag.proxyEl.style.top = `${Math.round(top)}px`;
    }

    function beginDrag(event) {
        const draggedId = state.drag.draggedId;
        if (!draggedId || !isItemAvailable(state.drag.sourceEl)) {
            resetDragState();
            return;
        }

        clearDragHoldTimer();
        state.drag.started = true;
        state.drag.initialOrder = state.order.slice();
        state.drag.sourceIndex = state.drag.initialOrder.indexOf(draggedId);

        const { visibleIds, overflowIds } = splitActiveIds(state.drag.initialOrder);
        state.drag.initialVisibleIds = visibleIds;
        state.drag.initialOverflowIds = overflowIds;
        state.drag.visibleIdsExcludingDragged = visibleIds.filter((id) => id !== draggedId);
        state.drag.overflowIdsExcludingDragged = overflowIds.filter((id) => id !== draggedId);
        state.drag.overflowCountWithoutDragged = Math.max(
            0,
            overflowIds.length - (overflowIds.includes(draggedId) ? 1 : 0)
        );
        state.drag.targetGlobalIndex = state.drag.sourceIndex;
        state.drag.popupWasVisible = state.popupVisible;
        state.drag.autoOpenedPopup = !state.popupVisible;

        const sourceRect = state.drag.sourceEl.getBoundingClientRect();
        state.drag.pointerOffsetX = event.clientX - sourceRect.left;
        state.drag.pointerOffsetY = event.clientY - sourceRect.top;

        state.drag.sourceEl.classList.add('tray-item--drag-source');
        state.drag.proxyEl = createDragProxy(state.drag.sourceEl);

        document.body.classList.add('tray-reordering', 'taskbar-dragging');
        showPopup({ autoOpenedForDrag: !state.drag.popupWasVisible });
        updateDragProxyPosition(event.clientX, event.clientY);
        updateDropTarget(event.clientX, event.clientY);
    }

    function cleanupDragArtifacts() {
        clearDragHoldTimer();

        if (state.drag.proxyEl && state.drag.proxyEl.parentNode) {
            state.drag.proxyEl.parentNode.removeChild(state.drag.proxyEl);
        }

        if (state.drag.sourceEl) {
            state.drag.sourceEl.classList.remove('tray-item--drag-source');
        }

        clearIndicators();
        document.body.classList.remove('tray-reordering', 'taskbar-dragging');
    }

    function resetDragState() {
        cleanupDragArtifacts();
        state.drag = createEmptyDragState();

        if (state.pendingRender) {
            state.pendingRender = false;
            render();
        }
    }

    function completeDrag() {
        const draggedId = state.drag.draggedId;
        if (!draggedId) {
            resetDragState();
            return;
        }

        const droppedInOverflow = state.drag.targetZone === 'overflow';
        const droppedInVisible = state.drag.targetZone === 'visible';
        const nextOrder = state.drag.initialOrder.slice();
        let nextOverflowCount = state.overflowCount;

        if (droppedInOverflow || droppedInVisible) {
            const targetIndex = state.drag.targetGlobalIndex >= 0
                ? state.drag.targetGlobalIndex
                : state.drag.sourceIndex;
            const reordered = nextOrder.filter((id) => id !== draggedId);
            const normalizedIndex = Math.max(0, Math.min(reordered.length, targetIndex));
            reordered.splice(normalizedIndex, 0, draggedId);
            state.order = reordered;
            nextOverflowCount = droppedInOverflow
                ? state.drag.overflowCountWithoutDragged + 1
                : state.drag.overflowCountWithoutDragged;
        } else {
            state.order = nextOrder;
        }

        state.overflowCount = Math.max(0, Math.min(nextOverflowCount, getActiveIds(state.order).length));
        saveOrder();
        saveOverflowCount();
        state.suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
        state.suppressClickItemId = draggedId;

        const shouldKeepPopupOpen = state.overflowCount > 0 &&
            (state.drag.popupWasVisible || state.drag.targetZone === 'overflow');

        resetDragState();
        render();

        if (shouldKeepPopupOpen) {
            showPopup();
        } else {
            hidePopup({ immediate: true });
        }
    }

    function handleItemPointerDown(event) {
        if (event.button !== 0 || state.drag.sourceEl) {
            return;
        }

        const sourceEl = event.currentTarget;
        if (!sourceEl || !isItemAvailable(sourceEl)) {
            return;
        }

        state.drag.sourceEl = sourceEl;
        state.drag.draggedId = getItemId(sourceEl);
        state.drag.startX = event.clientX;
        state.drag.startY = event.clientY;
        state.drag.lastX = event.clientX;
        state.drag.lastY = event.clientY;
        state.drag.pointerId = event.pointerId ?? null;
        state.drag.pointerType = event.pointerType || 'mouse';

        if (state.drag.pointerType === 'touch' || state.drag.pointerType === 'pen') {
            state.drag.holdTimer = setTimeout(() => {
                if (!state.drag.sourceEl || state.drag.started) {
                    return;
                }

                beginDrag({
                    clientX: state.drag.lastX,
                    clientY: state.drag.lastY
                });
            }, TOUCH_DRAG_HOLD_MS);
        }
    }

    function handlePointerMove(event) {
        if (!state.drag.sourceEl) {
            return;
        }

        if (state.drag.pointerId !== null && (event.pointerId ?? null) !== state.drag.pointerId) {
            return;
        }

        state.drag.lastX = event.clientX;
        state.drag.lastY = event.clientY;

        const deltaX = event.clientX - state.drag.startX;
        const deltaY = event.clientY - state.drag.startY;
        const distance = Math.hypot(deltaX, deltaY);

        if (!state.drag.started) {
            if (state.drag.pointerType === 'touch' || state.drag.pointerType === 'pen') {
                if (state.drag.holdTimer && distance > TOUCH_DRAG_CANCEL_DISTANCE_PX) {
                    resetDragState();
                }
                return;
            }

            if (distance < getDragThreshold(state.drag.pointerType)) {
                return;
            }

            beginDrag(event);
        }

        updateDragProxyPosition(event.clientX, event.clientY);
        updateDropTarget(event.clientX, event.clientY);
        event.preventDefault();
    }

    function handlePointerUp(event) {
        if (!state.drag.sourceEl) {
            return;
        }

        if (state.drag.pointerId !== null && (event.pointerId ?? null) !== state.drag.pointerId) {
            return;
        }

        const sourceEl = state.drag.sourceEl;
        const pointerType = state.drag.pointerType;
        const deltaX = event.clientX - state.drag.startX;
        const deltaY = event.clientY - state.drag.startY;
        const distance = Math.hypot(deltaX, deltaY);

        if (state.drag.started) {
            event.preventDefault();
            completeDrag();
            return;
        }

        resetDragState();

        if (distance <= getDragThreshold(pointerType)) {
            dispatchTrayItemClick(sourceEl);
        }
    }

    function handleDocumentClick(event) {
        const popup = getPopupElement();
        const button = getToggleButton();

        if (!state.popupVisible || !popup || !button || state.drag.started) {
            return;
        }

        if (popup.contains(event.target) || button.contains(event.target)) {
            return;
        }

        hidePopup();
    }

    function handleCapturedClick(event) {
        const clickableTarget = event.target.closest('.tray-reorderable');
        if (!clickableTarget) {
            return;
        }

        const targetItemId = getItemId(clickableTarget);
        if (!event.isTrusted && targetItemId === state.allowSyntheticClickItemId) {
            state.allowSyntheticClickItemId = '';
            return;
        }

        if (Date.now() > state.suppressClickUntil) {
            return;
        }

        if (targetItemId !== state.suppressClickItemId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        state.suppressClickUntil = 0;
        state.suppressClickItemId = '';
        state.allowSyntheticClickItemId = '';
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape') {
            if (state.drag.started) {
                const popupWasVisible = state.drag.popupWasVisible;
                resetDragState();
                render();
                if (popupWasVisible) {
                    showPopup();
                } else {
                    hidePopup({ immediate: true });
                }
                return;
            }

            if (state.popupVisible) {
                hidePopup();
            }
        }
    }

    function observeItems() {
        getAllItemElements().forEach((item) => {
            state.itemAvailability.set(item, isItemAvailable(item));

            const observer = new MutationObserver(() => {
                if (hasItemAvailabilityChanged(item)) {
                    render();
                }
            });

            observer.observe(item, {
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        });
    }

    function refreshLayout() {
        render();
        if (state.popupVisible) {
            positionPopup();
        }
    }

    function init() {
        const visibleContainer = getVisibleContainer();
        const overflowContainer = getOverflowContainer();
        const popup = getPopupElement();
        const button = getToggleButton();

        if (!visibleContainer || !overflowContainer || !popup || !button) {
            return;
        }

        const itemElements = getAllItemElements();
        const defaultOrder = itemElements.map(getItemId).filter(Boolean);

        state.itemMap = new Map(
            itemElements.map((item) => [getItemId(item), item])
        );
        state.order = mergeOrder(getStoredOrder(), defaultOrder);
        state.overflowCount = getStoredOverflowCount();

        render();
        observeItems();

        $(document).on('pointerdown', '.tray-reorderable', handleItemPointerDown);
        $(document).on('pointermove.tray-overflow', handlePointerMove);
        $(document).on('pointerup.tray-overflow pointercancel.tray-overflow', handlePointerUp);

        $(button).on('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePopup();
        });

        $(getCustomizeButton()).on('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        $(window).on('resize.tray-overflow', refreshLayout);
        window.addEventListener('win9-display-settings-changed', refreshLayout);
        document.addEventListener('click', handleCapturedClick, true);
        document.addEventListener('click', handleDocumentClick);
        document.addEventListener('keydown', handleKeyDown);
    }

    $(document).ready(init);

    window.TrayOverflow = {
        show: showPopup,
        hide: hidePopup,
        toggle: togglePopup,
        refreshLayout,
        isOpen: () => state.popupVisible
    };
})();
