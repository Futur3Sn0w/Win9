(function () {
    const treeItems = Array.from(document.querySelectorAll('.msinfo-tree-item'));
    const titleEl = document.getElementById('msinfo-title');
    const descriptionEl = document.getElementById('msinfo-description');

    const panelDescriptions = {
        summary: {
            title: 'System Summary',
            description: 'Blank scaffold for the future msinfo32 implementation.'
        },
        hardware: {
            title: 'Hardware Resources',
            description: 'Reserved for IRQs, DMA, memory, and other low-level hardware data.'
        },
        components: {
            title: 'Components',
            description: 'Reserved for device-level inventory such as display, storage, and input.'
        },
        software: {
            title: 'Software Environment',
            description: 'Reserved for drivers, services, startup tasks, and environment details.'
        }
    };

    treeItems.forEach(item => {
        item.addEventListener('click', () => {
            treeItems.forEach(button => button.classList.remove('is-active'));
            item.classList.add('is-active');

            const panel = panelDescriptions[item.dataset.panel];
            if (!panel) {
                return;
            }

            titleEl.textContent = panel.title;
            descriptionEl.textContent = panel.description;
        });
    });
})();
