/**
 * Windows System Dialog Component
 * Creates Windows-style system dialogs with customizable buttons and status icons
 * Replaces alert(), confirm(), and prompt() with Windows-authentic dialogs
 */

class SystemDialog {
    constructor() {
        this.activeDialogs = new Map();
        this.dialogIdCounter = 0;
        this.zIndexBase = 100000;
    }

    /**
     * Status presets with default titles and icons
     */
    static STATUS_PRESETS = {
        error: {
            title: 'Error',
            icon: 'error',
            soundId: 'default_beep'
        },
        warning: {
            title: 'Warning',
            icon: 'warning',
            soundId: 'asterisk'
        },
        info: {
            title: 'Information',
            icon: 'info',
            soundId: 'default_beep'
        },
        question: {
            title: 'Question',
            icon: 'question'
        },
        success: {
            title: 'Success',
            icon: 'info',
        },
        notice: {
            title: 'Notice',
            icon: 'info',
            soundId: 'default_beep'
        },
        save: {
            title: 'Save',
            icon: null,
            soundId: 'default_beep'
        }
    };

    /**
     * Button configuration presets
     */
    static BUTTON_PRESETS = {
        ok: [
            { label: 'OK', value: 'ok', default: true }
        ],
        okcancel: [
            { label: 'OK', value: 'ok', default: true },
            { label: 'Cancel', value: 'cancel' }
        ],
        yesno: [
            { label: 'Yes', value: 'yes', default: true },
            { label: 'No', value: 'no' }
        ],
        yesnocancel: [
            { label: 'Yes', value: 'yes', default: true },
            { label: 'No', value: 'no' },
            { label: 'Cancel', value: 'cancel' }
        ],
        retrycancel: [
            { label: 'Retry', value: 'retry', default: true },
            { label: 'Cancel', value: 'cancel' }
        ],
        abortretryignore: [
            { label: 'Abort', value: 'abort' },
            { label: 'Retry', value: 'retry', default: true },
            { label: 'Ignore', value: 'ignore' }
        ],
        savedontsavecancel: [
            { label: 'Save', value: 'save', default: true },
            { label: "Don't Save", value: 'dontsave' },
            { label: 'Cancel', value: 'cancel' }
        ]
    };

    /**
     * Show a system dialog
     * @param {Object} options - Dialog options
     * @param {string} options.title - Dialog title (optional if status is provided)
     * @param {string} options.body - Dialog body text
     * @param {string} options.status - Status type: 'error', 'warning', 'info', 'question', 'success', 'notice'
     * @param {string|Array} options.buttons - Button preset name or array of button configs
     * @param {Function} options.onClose - Callback when dialog is closed with button value
     * @param {boolean} options.modal - Whether dialog is modal (blocks interaction with background)
     * @returns {Promise} - Promise that resolves with button value when dialog is closed
     */
    show(options) {
        // If we're in an iframe, delegate to parent window
        if (window !== window.top && window.parent && window.parent.systemDialog) {
            return window.parent.systemDialog.show(options);
        }

        return new Promise((resolve) => {
            const {
                title = '',
                body = '',
                status = null,
                buttons = 'ok',
                onClose = null,
                modal = true
            } = options;

            const dialogId = `system-dialog-${this.dialogIdCounter++}`;

            // Get status preset if provided
            let dialogTitle = title;
            let iconType = null;
            let soundId = null;

            if (status && SystemDialog.STATUS_PRESETS[status]) {
                const preset = SystemDialog.STATUS_PRESETS[status];
                if (!dialogTitle) {
                    dialogTitle = preset.title;
                }
                iconType = preset.icon;
                soundId = preset.soundId;
            }

            // Get button configuration
            let buttonConfig;
            if (typeof buttons === 'string') {
                buttonConfig = SystemDialog.BUTTON_PRESETS[buttons.toLowerCase()] || SystemDialog.BUTTON_PRESETS.ok;
            } else if (Array.isArray(buttons)) {
                buttonConfig = buttons;
            } else {
                buttonConfig = SystemDialog.BUTTON_PRESETS.ok;
            }

            // Create dialog elements
            const overlay = this.createOverlay(dialogId, modal);
            const dialog = this.createDialog(dialogId, dialogTitle, body, iconType, buttonConfig);

            // Handle button clicks
            const handleButtonClick = (buttonValue) => {

                // Remove dialog
                this.hide(dialogId);

                // Call onClose callback if provided
                if (onClose && typeof onClose === 'function') {
                    onClose(buttonValue);
                }

                // Resolve promise
                resolve(buttonValue);
            };

            // Add button event listeners
            const buttons_elements = dialog.querySelectorAll('.system-dialog-button');
            buttons_elements.forEach((button, index) => {
                button.addEventListener('click', () => {
                    handleButtonClick(buttonConfig[index].value);
                });
            });

            // Add close button event listener
            const closeButton = dialog.querySelector('.classic-window-control-btn.close');
            if (closeButton) {
                closeButton.addEventListener('click', () => {
                    // Close button acts like Escape key
                    const cancelButton = buttonConfig.find(btn => btn.value === 'cancel');
                    const closeValue = cancelButton ? 'cancel' : buttonConfig[buttonConfig.length - 1].value;
                    handleButtonClick(closeValue);
                });
            }

            // Handle Enter key for default button
            const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                    const defaultButton = buttonConfig.find(btn => btn.default);
                    if (defaultButton) {
                        e.preventDefault();
                        handleButtonClick(defaultButton.value);
                    }
                } else if (e.key === 'Escape') {
                    // Escape key closes dialog with 'cancel' or last button value
                    const cancelButton = buttonConfig.find(btn => btn.value === 'cancel');
                    const escapeValue = cancelButton ? 'cancel' : buttonConfig[buttonConfig.length - 1].value;
                    e.preventDefault();
                    handleButtonClick(escapeValue);
                }
            };

            dialog.addEventListener('keydown', handleKeyDown);

            // Add to DOM at desktop level (document.body), not inside any app window
            // This ensures dialogs always appear at the desktop level
            if (overlay) {
                document.body.appendChild(overlay);
            }
            document.body.appendChild(dialog);

            // Add opening animation
            dialog.classList.add('opening');

            // Initialize drag functionality
            this.initDialogDrag(dialog);

            // Initialize focus/blur handling
            this.initDialogFocus(dialog);

            // Block interaction with other windows (modal behavior)
            this.blockOtherWindows(dialogId, dialog);

            // Store dialog info
            this.activeDialogs.set(dialogId, {
                overlay,
                dialog,
                handleKeyDown
            });

            // Play system sound
            if (soundId && window.systemSounds) {
                systemSounds.play(soundId);
            }

            // Remove opening class after animation completes
            setTimeout(() => {
                dialog.classList.remove('opening');
            }, 500);

            // Focus dialog for keyboard support
            setTimeout(() => {
                this.focusDialog(dialog);

                // Focus the default button
                const defaultButtonIndex = buttonConfig.findIndex(btn => btn.default);
                if (defaultButtonIndex !== -1) {
                    buttons_elements[defaultButtonIndex].focus();
                }
            }, 10);
        });
    }

    /**
     * Create overlay element (not used with classic windows styling, but kept for compatibility)
     */
    createOverlay() {
        // No overlay needed for classic windows
        return null;
    }

    /**
     * Create dialog element
     */
    createDialog(dialogId, title, body, iconType, buttonConfig) {
        const dialog = document.createElement('div');
        dialog.className = 'classic-app-container system-dialog';
        dialog.id = dialogId;
        dialog.tabIndex = -1;

        // Find highest z-index among all classic windows and dialogs
        let maxZ = 1000;
        const allWindows = document.querySelectorAll('.classic-app-container');
        allWindows.forEach(win => {
            const z = parseInt(window.getComputedStyle(win).zIndex) || 1000;
            if (z > maxZ) maxZ = z;
        });

        // Set dialog z-index above all windows
        dialog.style.zIndex = maxZ + 10;

        // Center dialog on screen
        dialog.style.left = '50%';
        dialog.style.top = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
        this.updateDialogAnimationTransforms(dialog, dialog.style.transform);
        dialog.style.width = 'auto';
        dialog.style.minWidth = '320px';
        dialog.style.maxWidth = '500px';

        // Create icon HTML
        let iconHTML = '';
        if (iconType) {
            iconHTML = `
                <div class="system-dialog-icon system-dialog-icon-${iconType}">
                    ${this.getIconSVG(iconType)}
                </div>
            `;
        }

        // Create buttons HTML
        const buttonsHTML = buttonConfig.map((btn) => {
            const defaultClass = btn.default ? ' default-button' : '';
            return `<button class="classic-button system-dialog-button${defaultClass}" data-value="${btn.value}">${this.escapeHtml(btn.label)}</button>`;
        }).join('');

        dialog.innerHTML = `
            <div class="classic-window-titlebar">
                <div class="classic-window-title no-icon">
                    <span class="classic-window-name">${this.escapeHtml(title)}</span>
                </div>
                <div class="classic-window-controls">
                    <button class="classic-window-control-btn close" data-action="close" aria-label="Close" title="Close">
                        <span class="classic-window-control-glyph" aria-hidden="true"></span>
                    </button>
                </div>
            </div>
            <div class="classic-window-content system-dialog-window-content">
                <div class="system-dialog-content">
                    ${iconHTML}
                    <div class="system-dialog-body">${this.escapeHtml(body)}</div>
                </div>
                <div class="button-bar">
                    ${buttonsHTML}
                </div>
            </div>
        `;

        return dialog;
    }

    /**
     * Get SVG icon for status type
     */
    getIconSVG(type) {
        const icons = {
            error: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="14" fill="#C42B1C" stroke="#8B0000" stroke-width="2"/>
                <path d="M10 10L22 22M22 10L10 22" stroke="white" stroke-width="3" stroke-linecap="round"/>
            </svg>`,
            warning: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 2L30 28H2L16 2Z" fill="#FFB900" stroke="#996F00" stroke-width="2" stroke-linejoin="round"/>
                <path d="M16 12V18M16 22V23" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>
            </svg>`,
            info: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="14" fill="#0078D4" stroke="#004E8C" stroke-width="2"/>
                <path d="M16 8V9M16 14V24" stroke="white" stroke-width="3" stroke-linecap="round"/>
            </svg>`,
            question: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="14" fill="#0078D4" stroke="#004E8C" stroke-width="2"/>
                <path d="M12 12C12 9.79086 13.7909 8 16 8C18.2091 8 20 9.79086 20 12C20 13.5 19 14.5 17.5 15.5C16.5 16.5 16 17 16 18M16 22V23" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
            </svg>`
        };

        return icons[type] || icons.info;
    }

    /**
     * Hide a dialog
     */
    hide(dialogId) {
        const dialogInfo = this.activeDialogs.get(dialogId);
        if (!dialogInfo) return;

        const { overlay, dialog } = dialogInfo;

        // Add closing animation
        if (dialog) {
            dialog.classList.add('closing');
        }

        // Wait for animation to complete before removing
        setTimeout(() => {
            // Unblock other windows
            this.unblockOtherWindows();

            // Clean up drag event listeners
            if (dialog && dialog._dragCleanup) {
                dialog._dragCleanup();
            }

            // Clean up window block listeners
            if (dialog && dialog._windowBlockCleanup) {
                dialog._windowBlockCleanup();
            }

            // Remove from DOM
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            if (dialog && dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }

            // Remove from active dialogs
            this.activeDialogs.delete(dialogId);
        }, 250); // Match animation duration
    }

    updateDialogAnimationTransforms(dialog, baseTransform) {
        const normalizedBaseTransform = baseTransform && baseTransform !== 'none'
            ? baseTransform
            : null;
        const openFromTransform = normalizedBaseTransform
            ? `${normalizedBaseTransform} scale(1.2)`
            : 'scale(1.2)';
        const steadyTransform = normalizedBaseTransform
            ? `${normalizedBaseTransform} scale(1)`
            : 'scale(1)';

        dialog.style.setProperty('--classic-window-open-from-transform', openFromTransform);
        dialog.style.setProperty('--classic-window-open-to-transform', steadyTransform);
        dialog.style.setProperty('--classic-window-close-from-transform', steadyTransform);
        dialog.style.setProperty('--classic-window-close-to-transform', steadyTransform);
    }

    /**
     * Initialize drag functionality for dialog
     */
    initDialogDrag(dialog) {
        const titlebar = dialog.querySelector('.classic-window-titlebar');
        if (!titlebar) return;

        let isDragging = false;
        let activePointerId = null;
        let startX, startY, startLeft, startTop;

        const handlePointerDown = (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) {
                return;
            }

            if (e.isPrimary === false) {
                return;
            }

            // Don't drag if clicking on buttons
            if (e.target.closest('.classic-window-control-btn')) {
                return;
            }

            isDragging = true;
            activePointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;

            const rect = dialog.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            if (typeof titlebar.setPointerCapture === 'function') {
                try {
                    titlebar.setPointerCapture(e.pointerId);
                } catch (error) {
                    console.debug('[SystemDialog] Unable to capture drag pointer:', error);
                }
            }

            // Bring dialog to front
            this.focusDialog(dialog);

            e.preventDefault();
        };

        const handlePointerMove = (e) => {
            if (!isDragging || e.pointerId !== activePointerId) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            const newLeft = startLeft + deltaX;
            const newTop = startTop + deltaY;

            dialog.style.left = `${newLeft}px`;
            dialog.style.top = `${newTop}px`;
            dialog.style.transform = 'none';
            this.updateDialogAnimationTransforms(dialog, 'none');
        };

        const handlePointerUp = (e) => {
            if (!isDragging || e.pointerId !== activePointerId) {
                return;
            }

            if (typeof titlebar.releasePointerCapture === 'function') {
                try {
                    titlebar.releasePointerCapture(activePointerId);
                } catch (error) {
                    console.debug('[SystemDialog] Unable to release drag pointer:', error);
                }
            }

            isDragging = false;
            activePointerId = null;
        };

        titlebar.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerUp);

        // Store cleanup function
        dialog._dragCleanup = () => {
            titlebar.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        };
    }

    /**
     * Initialize focus/blur handling for dialog
     */
    initDialogFocus(dialog) {
        // Click on dialog to focus
        dialog.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) {
                return;
            }

            // Don't refocus if clicking inside (let buttons handle their own clicks)
            if (e.target.closest('.system-dialog-button')) {
                return;
            }
            this.focusDialog(dialog);
        });
    }

    /**
     * Focus a dialog (bring to front, add active class)
     */
    focusDialog(dialog) {
        // Remove active class from all windows and dialogs
        document.querySelectorAll('.classic-app-container').forEach(win => {
            win.classList.remove('active');
            win.classList.add('inactive');
        });

        // Add active class to this dialog
        dialog.classList.remove('inactive');
        dialog.classList.add('active');

        // Update z-index to bring to front
        let maxZ = 1000;
        document.querySelectorAll('.classic-app-container').forEach(win => {
            const z = parseInt(window.getComputedStyle(win).zIndex) || 1000;
            if (z > maxZ) maxZ = z;
        });

        dialog.style.zIndex = maxZ + 1;
    }

    /**
     * Block interaction with other windows while dialog is open
     */
    blockOtherWindows(dialogId, dialog) {
        // Get all classic windows (not dialogs)
        const allWindows = document.querySelectorAll('.classic-app-container:not(.system-dialog)');

        const handleWindowClick = (e) => {
            // Check if click is on a blocked window
            const clickedWindow = e.target.closest('.classic-app-container:not(.system-dialog)');
            if (clickedWindow) {
                e.stopPropagation();
                e.preventDefault();

                // Flash the dialog and play beep
                this.flashDialog(dialog);
                if (window.systemSounds) {
                    systemSounds.play('error');
                }
            }
        };

        // Add click blocker to each window
        allWindows.forEach(win => {
            win.addEventListener('mousedown', handleWindowClick, true);
            win.style.pointerEvents = 'auto'; // Ensure we can capture events
            win.setAttribute('data-dialog-blocked', dialogId);
        });

        // Store cleanup function
        dialog._windowBlockCleanup = () => {
            allWindows.forEach(win => {
                win.removeEventListener('mousedown', handleWindowClick, true);
                win.removeAttribute('data-dialog-blocked');
            });
        };
    }

    /**
     * Unblock other windows
     */
    unblockOtherWindows() {
        // Find any dialogs with cleanup functions and call them
        document.querySelectorAll('.system-dialog').forEach(dialog => {
            if (dialog._windowBlockCleanup) {
                dialog._windowBlockCleanup();
            }
        });
    }

    /**
     * Flash dialog between active/inactive states
     */
    flashDialog(dialog) {
        let flashCount = 0;
        const maxFlashes = 14; // 5 times = 10 state changes
        const flashInterval = 100; // 100ms = 1 second for 10 flashes

        const flash = setInterval(() => {
            if (flashCount >= maxFlashes) {
                clearInterval(flash);
                // Ensure dialog ends in active state
                dialog.classList.remove('inactive');
                dialog.classList.add('active');
                return;
            }

            // Toggle between active and inactive
            if (flashCount % 2 === 0) {
                dialog.classList.remove('active');
                dialog.classList.add('inactive');
            } else {
                dialog.classList.remove('inactive');
                dialog.classList.add('active');
            }

            flashCount++;
        }, flashInterval);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Convenience methods for common dialog types
     */

    /**
     * Show an error dialog
     */
    error(body, title = null) {
        return this.show({
            title: title,
            body: body,
            status: 'error',
            buttons: 'ok'
        });
    }

    /**
     * Show a warning dialog
     */
    warning(body, title = null) {
        return this.show({
            title: title,
            body: body,
            status: 'warning',
            buttons: 'ok'
        });
    }

    /**
     * Show an info dialog
     */
    info(body, title = null) {
        return this.show({
            title: title,
            body: body,
            status: 'info',
            buttons: 'ok'
        });
    }

    /**
     * Show a question dialog with Yes/No buttons
     */
    question(body, title = null) {
        return this.show({
            title: title,
            body: body,
            status: 'question',
            buttons: 'yesno'
        });
    }

    /**
     * Show a confirmation dialog with OK/Cancel buttons
     */
    confirm(body, title = null) {
        return this.show({
            title: title || 'Confirm',
            body: body,
            status: 'question',
            buttons: 'okcancel'
        });
    }

    /**
     * Show a simple alert dialog
     */
    alert(body, title = null) {
        return this.show({
            title: title || 'Alert',
            body: body,
            buttons: 'ok'
        });
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.systemDialog = new SystemDialog();
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemDialog;
}
