/**
 * Windows 8 Style Notification Component
 * Creates toast notifications that appear on the desktop
 */

class NotificationManager {
    constructor() {
        this.container = null;
        this.notifications = new Map();
        this.notificationIdCounter = 0;
        this.init();
        this.updateContainerPosition();

        // Update position when window resizes or taskbar changes
        window.addEventListener('resize', () => this.updateContainerPosition());
    }

    init() {
        // Create notification container if it doesn't exist
        if (!document.getElementById('notification-container')) {
            this.container = document.createElement('div');
            this.container.id = 'notification-container';
            this.container.className = 'notification-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('notification-container');
        }
    }

    updateContainerPosition() {
        // Get taskbar height dynamically
        const taskbar = document.querySelector('.taskbar');
        if (taskbar) {
            const taskbarHeight = taskbar.offsetHeight;
            const bottomOffset = taskbarHeight + 10; // 10px padding above taskbar
            this.container.style.bottom = `${bottomOffset}px`;
        }
    }

    /**
     * Show a notification
     * @param {Object} options - Notification options
     * @param {string} options.icon - Icon path or class (e.g., 'mif-usb' or path to image)
     * @param {string} options.title - Notification title
     * @param {string} options.description - Notification description
     * @param {string} options.appId - App ID to automatically get icon/color (optional)
     * @param {Function} options.onClick - Function to execute when clicked
     * @param {number} options.duration - Duration in ms (0 for persistent, default: 0)
     * @param {number} options.delay - Delay in ms before showing notification (default: 0)
     * @param {string} options.type - Notification type: 'info', 'success', 'warning', 'error' (default: 'info')
     * @returns {string} - Notification ID
     */
    show(options) {
        const {
            icon = 'mif-notifications',
            title = 'Notification',
            description = '',
            appId = null,
            sourceLabel = null,
            onClick = null,
            duration = 0,
            delay = 0,
            type = 'info'
        } = options;

        // If delay is specified, wait before showing the notification
        if (delay > 0) {
            setTimeout(() => {
                this.showImmediate({
                    icon,
                    title,
                    description,
                    appId,
                    sourceLabel,
                    onClick,
                    duration,
                    type
                });
            }, delay);
            // Return a placeholder ID
            return `notification-delayed-${this.notificationIdCounter}`;
        }

        return this.showImmediate(options);
    }

    /**
     * Show a notification immediately (internal method)
     * @param {Object} options - Notification options
     * @returns {string} - Notification ID
     */
    showImmediate(options) {
        const {
            icon = 'mif-notifications',
            title = 'Notification',
            description = '',
            appId = null,
            sourceLabel = null,
            onClick = null,
            duration = 0,
            type = 'info'
        } = options;

        // Get app data if appId is provided
        let app = null;
        let appIcon = null;
        let tileColor = null;

        if (appId && typeof AppsManager !== 'undefined') {
            app = AppsManager.getAppById(appId);
            if (app) {
                // For modern apps: use tile color and show app icon in bottom-left
                if (app.type === 'modern') {
                    appIcon = AppsManager.getIconImage(app, 32);
                    // Use the global getAppTileColor function if available
                    if (typeof getAppTileColor === 'function') {
                        tileColor = getAppTileColor(app.color);
                    }
                }
                // For classic apps: use ui-accent color (default in CSS), no app icon
            }
        }

        const notificationId = `notification-${this.notificationIdCounter++}`;
        const timestamp = Date.now();

        // Create notification element
        const notification = document.createElement('div');
        notification.id = notificationId;
        notification.className = `notification notification-${type}`;
        notification.setAttribute('data-type', type);

        // Apply tile color if provided, otherwise use CSS default (ui-accent)
        if (tileColor) {
            notification.style.background = tileColor;
        }

        // Determine if icon is a class or image path
        const isIconClass = icon.startsWith('mif-') || icon.startsWith('icon-');
        const iconHTML = isIconClass
            ? `<span class="notification-icon ${icon}"></span>`
            : `<img src="${icon}" class="notification-icon-image" alt="Notification icon">`;

        // Add app icon if provided
        const appIconHTML = appIcon
            ? `<img src="${appIcon}" class="notification-app-icon" alt="App icon">`
            : '';

        notification.innerHTML = `
            <button class="notification-close" aria-label="Close notification">✕</button>
            ${appIconHTML}
            <div class="notification-content">
                <div class="notification-icon-container">
                    ${iconHTML}
                </div>
                <div class="notification-text">
                    <div class="notification-title">${this.escapeHtml(title)}</div>
                    <div class="notification-description">${this.escapeHtml(description)}</div>
                </div>
            </div>
        `;

        const interactionState = {
            suppressClick: false
        };

        notification.addEventListener('click', (e) => {
            if (!interactionState.suppressClick) {
                return;
            }

            interactionState.suppressClick = false;
            e.preventDefault();
            e.stopPropagation();
        }, true);

        // Add click handler if provided
        if (onClick && typeof onClick === 'function') {
            const content = notification.querySelector('.notification-content');
            content.style.cursor = 'pointer';
            content.addEventListener('click', () => {
                onClick();
                this.hide(notificationId);
            });
        }

        // Add close button handler
        const closeButton = notification.querySelector('.notification-close');
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide(notificationId);
        });

        // Add drag-to-dismiss functionality
        this.addDragToDismiss(notification, notificationId, interactionState);

        // Add to container at the beginning (bottom of stack due to column-reverse)
        this.container.insertBefore(notification, this.container.firstChild);
        this.notifications.set(notificationId, {
            element: notification,
            timeout: null
        });

        // Play notification sound
        if (window.systemSounds) {
            systemSounds.play('notification');
        }

        // Trigger animation
        setTimeout(() => {
            notification.classList.add('notification-visible');
        }, 10);

        // Auto-hide after duration (if not persistent)
        if (duration > 0) {
            const timeout = setTimeout(() => {
                this.hide(notificationId);
            }, duration);

            this.notifications.get(notificationId).timeout = timeout;
        }

        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('win8:notification-shown', {
                detail: {
                    id: notificationId,
                    icon,
                    title,
                    description,
                    type,
                    appId,
                    appIcon,
                    sourceLabel,
                    timestamp,
                    onClick
                }
            }));
        }

        return notificationId;
    }

    /**
     * Add drag-to-dismiss functionality to a notification
     * @param {HTMLElement} notification - The notification element
     * @param {string} notificationId - ID of the notification
     */
    addDragToDismiss(notification, notificationId, interactionState) {
        const DRAG_THRESHOLD = 8;
        const DISMISS_THRESHOLD = 150;

        let isPointerDown = false;
        let activePointerId = null;
        let startX = 0;
        let currentX = 0;
        let isPressedOnLeft = false;
        let hasDragged = false;

        const handlePointerDown = (e) => {
            // Don't start drag if clicking close button
            if (e.target.closest('.notification-close')) {
                return;
            }

            if (e.button !== undefined && e.button !== 0) {
                return;
            }

            isPointerDown = true;
            activePointerId = e.pointerId ?? 'mouse';
            startX = e.clientX;
            currentX = 0;
            hasDragged = false;

            // Determine if pressed on left half or right half
            const rect = notification.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const halfWidth = rect.width / 2;
            isPressedOnLeft = clickX < halfWidth;

            // Add perspective effect if pressed on left half
            if (isPressedOnLeft) {
                notification.classList.add('pressing-left');
            }

            e.preventDefault();
        };

        const handlePointerMove = (e) => {
            if (!isPointerDown || ((e.pointerId ?? 'mouse') !== activePointerId)) return;

            const deltaX = e.clientX - startX;
            const absDeltaX = Math.abs(deltaX);

            if (!hasDragged && absDeltaX > DRAG_THRESHOLD) {
                hasDragged = true;
                interactionState.suppressClick = true;
                notification.classList.add('dragging');
            }

            if (!hasDragged) {
                return;
            }

            // Only allow dragging to the right (positive) and limit leftward movement
            currentX = Math.max(0, deltaX);

            notification.style.transform = `translateX(${currentX}px)`;
        };

        const handlePointerEnd = (e) => {
            if (!isPointerDown || ((e.pointerId ?? 'mouse') !== activePointerId)) return;

            isPointerDown = false;
            activePointerId = null;
            notification.classList.remove('dragging');
            notification.classList.remove('pressing-left');

            if (hasDragged) {
                interactionState.suppressClick = true;
            }

            // If dragged more than 150px to the right, dismiss
            if (currentX > DISMISS_THRESHOLD) {
                this.hide(notificationId);
            } else {
                // Snap back to original position
                notification.style.transform = '';
            }

            currentX = 0;
            hasDragged = false;
        };

        notification.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerEnd);
        document.addEventListener('pointercancel', handlePointerEnd);

        // Store cleanup function
        notification._dragCleanup = () => {
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerEnd);
            document.removeEventListener('pointercancel', handlePointerEnd);
        };
    }

    /**
     * Hide a notification
     * @param {string} notificationId - ID of notification to hide
     */
    hide(notificationId) {
        const notification = this.notifications.get(notificationId);
        if (!notification) return;

        // Clear timeout if exists
        if (notification.timeout) {
            clearTimeout(notification.timeout);
        }

        // Clean up drag event listeners
        if (notification.element._dragCleanup) {
            notification.element._dragCleanup();
        }

        // Animate out
        notification.element.classList.remove('notification-visible');
        notification.element.classList.add('notification-hiding');

        // Remove from DOM after animation
        setTimeout(() => {
            if (notification.element.parentNode) {
                notification.element.parentNode.removeChild(notification.element);
            }
            this.notifications.delete(notificationId);

            if (typeof document !== 'undefined') {
                document.dispatchEvent(new CustomEvent('win8:notification-hidden', {
                    detail: {
                        id: notificationId
                    }
                }));
            }
        }, 500);
    }

    /**
     * Hide all notifications
     */
    hideAll() {
        this.notifications.forEach((_, id) => {
            this.hide(id);
        });
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.notificationManager = new NotificationManager();
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotificationManager;
}
