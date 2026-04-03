(function () {
    const consoleEl = document.getElementById('cmd-console');
    const formEl = document.getElementById('cmd-form');
    const inputEl = document.getElementById('cmd-input');

    if (!consoleEl || !formEl || !inputEl) {
        return;
    }

    const focusInput = () => inputEl.focus();

    const appendLine = (text, className = '') => {
        const line = document.createElement('div');
        line.className = className ? `cmd-line ${className}` : 'cmd-line';
        line.textContent = text;
        consoleEl.appendChild(line);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    };

    formEl.addEventListener('submit', event => {
        event.preventDefault();

        const command = inputEl.value.trim();
        appendLine(`C:\\Users\\User> ${command}`);

        if (command) {
            appendLine(`'${command}' is not yet available in this blank template.`, 'cmd-muted');
        }

        inputEl.value = '';
    });

    document.addEventListener('mousedown', focusInput);
    window.addEventListener('load', focusInput);
})();
