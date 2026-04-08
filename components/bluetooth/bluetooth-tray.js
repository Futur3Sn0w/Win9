(function () {
    'use strict';

    const BLUETOOTH_ICON_SIZES = [16, 20, 24, 32, 40, 48, 256];
    const BLUETOOTH_BASE_RENDER_SIZE = 16;
    let bluetoothBaseRenderSize = BLUETOOTH_BASE_RENDER_SIZE;
    let displaySettingsState = null;

    function getIconElement() {
        return $('#bluetooth-icon');
    }

    function getIconImageElement() {
        return $('#bluetooth-icon-img');
    }

    function getContextMenuElement() {
        return $('#bluetooth-icon-context-menu');
    }

    function measureIconRenderSize() {
        const $bluetoothIconImg = getIconImageElement();
        if (!$bluetoothIconImg.length) {
            return BLUETOOTH_BASE_RENDER_SIZE;
        }

        const computedStyle = window.getComputedStyle($bluetoothIconImg[0]);
        const width = parseFloat(computedStyle.width) || 0;
        const height = parseFloat(computedStyle.height) || 0;

        return Math.max(width, height, BLUETOOTH_BASE_RENDER_SIZE);
    }

    function getBaseRenderSize() {
        return Math.max(bluetoothBaseRenderSize || 0, BLUETOOTH_BASE_RENDER_SIZE);
    }

    function getIconAssetScaleFactor() {
        if (typeof window.getTaskbarShellButtonAssetScaleFactor === 'function') {
            const scaleFactor = Number(window.getTaskbarShellButtonAssetScaleFactor());
            if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
                return scaleFactor;
            }
        }

        const displayScale = Number(displaySettingsState?.display?.scaleFactor) || 0;
        const zoomScale = Number(displaySettingsState?.zoomFactor) || 0;
        if (displayScale > 0 && zoomScale > 0) {
            return Math.max(1, displayScale * zoomScale);
        }

        return Math.max(1, Number(window.devicePixelRatio) || 1);
    }

    function selectIconSize(targetSize) {
        let bestSize = BLUETOOTH_ICON_SIZES[0];
        let bestDistance = Math.abs(targetSize - bestSize);

        for (const size of BLUETOOTH_ICON_SIZES) {
            const distance = Math.abs(targetSize - size);
            if (distance < bestDistance) {
                bestSize = size;
                bestDistance = distance;
                continue;
            }

            if (distance === bestDistance && size < bestSize) {
                bestSize = size;
            }
        }

        return bestSize;
    }

    function getBluetoothIconSelection() {
        const targetAssetSize = Math.max(1, Math.ceil(getBaseRenderSize() * getIconAssetScaleFactor()));
        const iconSize = selectIconSize(targetAssetSize);

        return {
            path: `resources/images/tray/bluetooth/bt/${iconSize}.png`,
            renderSize: getBaseRenderSize()
        };
    }

    function updateTrayIcon() {
        const $bluetoothIconImg = getIconImageElement();
        if (!$bluetoothIconImg.length) {
            return;
        }

        const { path, renderSize } = getBluetoothIconSelection();
        $bluetoothIconImg.css({
            width: `${renderSize}px`,
            height: `${renderSize}px`
        });

        if ($bluetoothIconImg.attr('src') !== path) {
            $bluetoothIconImg.attr('src', path);
        }
    }

    function handleViewportChange() {
        updateTrayIcon();
    }

    function handleDisplaySettingsChange(event) {
        displaySettingsState = event?.detail?.state || null;
        updateTrayIcon();
    }

    function buildMenuItems() {
        return [
            `
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Add a Bluetooth Device</span>
                </div>
            `,
            `
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Allow a Device to Connect</span>
                </div>
            `,
            `
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Show Bluetooth Devices</span>
                </div>
            `,
            '<div class="classic-context-menu-separator"></div>',
            `
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Send a File</span>
                </div>
            `,
            `
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Receive a File</span>
                </div>
            `,
            '<div class="classic-context-menu-separator"></div>',
            `
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Join a Personal Area Network</span>
                </div>
            `,
            '<div class="classic-context-menu-separator"></div>',
            `
                <div class="classic-context-menu-item bluetooth-menu-action" data-action="open-settings">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Open Settings</span>
                </div>
            `,
            '<div class="classic-context-menu-separator"></div>',
            `
                <div class="classic-context-menu-item is-disabled">
                    <span class="classic-context-menu-item-icon"></span>
                    <span class="classic-context-menu-item-text">Remove Icon</span>
                </div>
            `
        ];
    }

    function positionMenu() {
        const $bluetoothIcon = getIconElement();
        const $bluetoothContextMenu = getContextMenuElement();
        const iconElement = $bluetoothIcon[0];
        const menuElement = $bluetoothContextMenu[0];

        if (!iconElement || !menuElement) {
            return;
        }

        const iconRect = iconElement.getBoundingClientRect();
        const menuWidth = $bluetoothContextMenu.outerWidth() || menuElement.getBoundingClientRect().width || 240;
        const menuHeight = $bluetoothContextMenu.outerHeight() || menuElement.getBoundingClientRect().height || 220;

        let leftPosition = iconRect.left + (iconRect.width / 2) - (menuWidth / 2);
        leftPosition = Math.max(8, Math.min(leftPosition, window.innerWidth - menuWidth - 8));

        let topPosition = iconRect.top - menuHeight - 8;
        if (topPosition < 8) {
            topPosition = 8;
        }

        $bluetoothContextMenu.css({
            left: `${leftPosition}px`,
            top: 'auto',
            bottom: '50px'
        });
    }

    function showContextMenu(event) {
        const $bluetoothIcon = getIconElement();
        const $bluetoothContextMenu = getContextMenuElement();

        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (typeof window.closeAllTaskbarPopupsAndMenus === 'function') {
            window.closeAllTaskbarPopupsAndMenus();
        }

        const menuHTML = buildMenuItems().join('');
        $bluetoothContextMenu.html(menuHTML);
        $bluetoothContextMenu.css({
            width: '270px',
            pointerEvents: 'auto',
            zIndex: '200010'
        });

        positionMenu();

        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'none');

        $bluetoothIcon.addClass('active');
        $bluetoothContextMenu.css('display', 'flex');
    }

    function hideContextMenu() {
        const $bluetoothIcon = getIconElement();
        const $bluetoothContextMenu = getContextMenuElement();

        if ($bluetoothContextMenu.css('display') === 'none') {
            return;
        }

        $bluetoothContextMenu.css('display', 'none');
        $bluetoothIcon.removeClass('active');
        $('.classic-window-iframe, .modern-app-iframe, webview').css('pointer-events', 'auto');
    }

    function handleMenuAction(action) {
        if (action === 'open-settings' && typeof window.openSettingsCategory === 'function') {
            window.openSettingsCategory('pc-and-devices', 'bluetooth');
        }

        hideContextMenu();
    }

    function init() {
        bluetoothBaseRenderSize = measureIconRenderSize();
        updateTrayIcon();

        $(document).on('click contextmenu', '#bluetooth-icon', function (event) {
            showContextMenu(event);
        });

        $(document).on('click', '.bluetooth-menu-action', function (event) {
            event.preventDefault();
            event.stopPropagation();
            handleMenuAction($(this).attr('data-action'));
        });

        $(document).on('click', function (event) {
            if (!$(event.target).closest('#bluetooth-icon-context-menu, #bluetooth-icon').length) {
                hideContextMenu();
            }
        });

        $(window).on('resize.bluetooth-tray', function () {
            const $bluetoothContextMenu = getContextMenuElement();
            if ($bluetoothContextMenu.css('display') !== 'none') {
                positionMenu();
            }
        });

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('load', handleViewportChange, { once: true });
        window.addEventListener('win9-display-settings-changed', handleDisplaySettingsChange);
    }

    $(document).ready(function () {
        init();
    });

    window.BluetoothTrayMenu = {
        showContextMenu,
        hideContextMenu
    };
})();
