(function () {
    const tabs = Array.from(document.querySelectorAll('.taskmgr-tab'));
    const titleEl = document.getElementById('taskmgr-title');
    const descriptionEl = document.getElementById('taskmgr-description');
    const statusEl = document.getElementById('taskmgr-status-text');

    const panels = {
        applications: {
            title: 'Applications',
            description: 'Blank scaffold for the future Task Manager implementation.',
            status: 'Processes: 0'
        },
        processes: {
            title: 'Processes',
            description: 'Reserved for process enumeration, sorting, and management controls.',
            status: 'Processes: 0'
        },
        services: {
            title: 'Services',
            description: 'Reserved for service state and control integration.',
            status: 'Services: 0'
        },
        performance: {
            title: 'Performance',
            description: 'Reserved for CPU, memory, disk, and network charts.',
            status: 'Performance counters: unavailable'
        },
        networking: {
            title: 'Networking',
            description: 'Reserved for adapter usage and throughput summaries.',
            status: 'Network adapters: 0'
        },
        users: {
            title: 'Users',
            description: 'Reserved for signed-in session information.',
            status: 'Users: 0'
        }
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(button => button.classList.remove('is-active'));
            tab.classList.add('is-active');

            const panel = panels[tab.dataset.panel];
            if (!panel) {
                return;
            }

            titleEl.textContent = panel.title;
            descriptionEl.textContent = panel.description;
            statusEl.textContent = panel.status;
        });
    });
})();
