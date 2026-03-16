;(function (root) {
    const globalRef = root || {};

    const COLOR_GRADIENTS = {
        blue: ['#094AB2', '#0A5BC4'],
        green: ['#008A00', '#00A600'],
        red: ['#AC193D', '#BF1E4B'],
        purple: ['#5133AB', '#643EBF'],
        orange: ['#D24726', '#DC572E'],
        teal: ['#008299', '#00A0B1'],
        lime: ['#8CBF26', '#9CD133'],
        pink: ['#8C0095', '#A700AE'],
        sky: ['#2672EC', '#2E8DEF'],
        grey: ['#595959', '#7D7D7D']
    };

    class OpenWithChooser {
        constructor() {
            this.activeResolver = null;
            this.overlay = null;
            this.dialog = null;
            this.keydownHandler = null;
            this.pendingChoiceTimeout = null;
        }

        show({ extension, candidates = [] } = {}) {
            this.close(null);

            return new Promise((resolve) => {
                this.activeResolver = resolve;
                this.render(extension, candidates);
            });
        }

        render(extension, candidates) {
            const normalizedExtension = extension || 'this file type';
            const overlay = document.createElement('div');
            overlay.className = 'open-with-overlay';

            const dialog = document.createElement('div');
            dialog.className = 'open-with-dialog';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');

            const title = document.createElement('h2');
            title.className = 'open-with-dialog__title';
            title.textContent = 'How do you want to open this file?';

            const rememberLabel = document.createElement('label');
            rememberLabel.className = 'open-with-dialog__remember';

            const rememberInput = document.createElement('input');
            rememberInput.type = 'checkbox';

            const checkbox = document.createElement('span');
            checkbox.className = 'open-with-dialog__checkbox';

            const rememberText = document.createElement('span');
            rememberText.className = 'open-with-dialog__remember-text';
            rememberText.textContent = `Use this app for all ${normalizedExtension} files`;

            rememberLabel.appendChild(rememberInput);
            rememberLabel.appendChild(checkbox);
            rememberLabel.appendChild(rememberText);

            const list = document.createElement('ul');
            list.className = 'open-with-dialog__list';

            candidates.forEach(candidate => {
                const option = this.createCandidateItem(candidate, rememberInput);
                list.appendChild(option);
            });

            const hostButton = document.createElement('button');
            hostButton.type = 'button';
            hostButton.className = 'open-with-dialog__host';
            hostButton.textContent = 'Open in Host OS';
            hostButton.addEventListener('click', () => {
                this.close({
                    kind: 'host',
                    remember: rememberInput.checked
                });
            });

            dialog.appendChild(title);
            dialog.appendChild(rememberLabel);
            dialog.appendChild(list);
            dialog.appendChild(hostButton);

            overlay.addEventListener('click', () => {
                this.close(null);
            });

            dialog.addEventListener('click', (event) => {
                event.stopPropagation();
            });

            this.keydownHandler = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.close(null);
                }
            };

            document.addEventListener('keydown', this.keydownHandler, true);
            document.body.appendChild(overlay);
            document.body.appendChild(dialog);

            this.overlay = overlay;
            this.dialog = dialog;
        }

        createCandidateItem(candidate, rememberInput) {
            const item = document.createElement('li');
            item.className = 'open-with-dialog__option';

            const plate = document.createElement('div');
            plate.className = 'open-with-dialog__icon-plate';
            const [plateStart, plateEnd] = this.getPlateGradient(candidate.app);
            plate.style.setProperty('--plate-start', plateStart);
            plate.style.setProperty('--plate-end', plateEnd);

            const iconImage = globalRef.AppsManager?.getIconImage(candidate.app, 48);
            if (iconImage) {
                const img = document.createElement('img');
                img.src = iconImage;
                img.alt = '';
                plate.appendChild(img);
            } else if (candidate.app?.icon) {
                const icon = document.createElement('span');
                icon.className = candidate.app.icon;
                plate.appendChild(icon);
            }

            const label = document.createElement('div');
            label.className = 'open-with-dialog__label';
            label.textContent = candidate.app?.name || candidate.appId;

            item.appendChild(plate);
            item.appendChild(label);

            item.addEventListener('click', () => {
                this.selectItem(item);
                this.pendingChoiceTimeout = setTimeout(() => {
                    this.close({
                        kind: 'app',
                        appId: candidate.appId,
                        remember: rememberInput.checked
                    });
                }, 70);
            });

            return item;
        }

        selectItem(item) {
            if (!this.dialog) {
                return;
            }

            this.dialog.querySelectorAll('.open-with-dialog__option').forEach(option => {
                option.classList.toggle('is-selected', option === item);
            });
        }

        getPlateGradient(app) {
            const colorKey = app?.color || 'teal';
            return COLOR_GRADIENTS[colorKey] || ['#006f7f', '#008fa5'];
        }

        close(result) {
            if (this.pendingChoiceTimeout) {
                clearTimeout(this.pendingChoiceTimeout);
                this.pendingChoiceTimeout = null;
            }

            if (this.overlay?.parentNode) {
                this.overlay.parentNode.removeChild(this.overlay);
            }

            if (this.dialog?.parentNode) {
                this.dialog.parentNode.removeChild(this.dialog);
            }

            if (this.keydownHandler) {
                document.removeEventListener('keydown', this.keydownHandler, true);
            }

            this.overlay = null;
            this.dialog = null;
            this.keydownHandler = null;

            if (this.activeResolver) {
                const resolve = this.activeResolver;
                this.activeResolver = null;
                resolve(result);
            }
        }
    }

    globalRef.OpenWithChooser = new OpenWithChooser();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
