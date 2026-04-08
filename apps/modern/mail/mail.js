(function () {
    'use strict';

    const APP_BASE = 'apps/modern/mail/';
    const electronIpc = getElectronIpc();

    const DEFAULT_MAIL_DATA = {
        folders: [
            { id: 'inbox', label: 'Inbox', icon: 'view-inbox.png' },
            { id: 'flagged', label: 'Flagged', icon: 'view-flagged.png' },
            { id: 'newsletters', label: 'Newsletters', icon: 'view-newsletter.png' },
            { id: 'social', label: 'Social updates', icon: 'view-socialupdate.png' },
            { id: 'folders', label: 'Folders', icon: 'view-folder.png' }
        ],
        messages: {
            inbox: [
                {
                    id: 'inbox-flight',
                    from: 'Ava Martinez',
                    to: 'You',
                    subject: 'Your flight to Seattle now has a gate assignment',
                    preview: 'Boarding starts at 6:35 PM from Gate C17. Updated pass and itinerary are attached below.',
                    time: '7:12 AM',
                    dateLabel: 'Today, 7:12 AM',
                    unread: true,
                    flagged: false,
                    body: [
                        'Hi,',
                        'Your flight to Seattle is still on time, and the gate has been updated to C17. Boarding begins at 6:35 PM. I included the latest boarding pass and seat information so you can get through the airport quickly.',
                        'If the connection window gets tighter, I will send a second note with the rebooking desk details.',
                        'Safe travels.'
                    ],
                    attachments: ['BoardingPass.pdf', 'TripItinerary.ics']
                },
                {
                    id: 'inbox-launch',
                    from: 'Contoso Design Review',
                    to: 'You, Maya, Jordan',
                    subject: 'Launch review notes and next steps',
                    preview: 'The navigation pass is approved. The remaining work is mostly polish and shell fidelity.',
                    time: 'Yesterday',
                    dateLabel: 'Yesterday, 9:48 PM',
                    unread: false,
                    flagged: true,
                    body: [
                        'Team,',
                        'Thanks for getting through the launch review. We are approved to move forward with the updated navigation pass. The remaining work is mostly polish: align the app chrome, verify the blue accent tokens, and finish the pinned tile artwork set.',
                        'Please treat the current asset package as the source of truth while we continue reconstruction.'
                    ],
                    statusIcons: ['flag.png', 'replied.png']
                },
                {
                    id: 'inbox-invite',
                    from: 'Fabrikam Product Sync',
                    to: 'You',
                    subject: 'Calendar invite: Thursday reconstruction checkpoint',
                    preview: 'Let us walk through the original Mail and Calendar package together and agree on the next extraction pass.',
                    time: 'Thu',
                    dateLabel: 'Thursday, 2:00 PM',
                    unread: false,
                    flagged: false,
                    body: [
                        'Hello,',
                        'This checkpoint is focused on the communications apps package. We will review the manifest, the original HTML entry points, and the asset copies that made it into the repo.',
                        'Bring any notes about resources.pri, Resource Hacker output, or the folder structure you want to preserve.'
                    ],
                    invite: {
                        time: 'Thursday, 2:00 PM to 2:45 PM',
                        copy: 'Project checkpoint in the Studio room with the reconstruction workstream.'
                    }
                }
            ],
            flagged: [
                {
                    id: 'flagged-brief',
                    from: 'Northwind Ops',
                    to: 'You',
                    subject: 'Reminder: asset verification checklist',
                    preview: 'Please confirm that the copied tile pack still matches the original package names before we add more apps.',
                    time: 'Mon',
                    dateLabel: 'Monday, 8:10 AM',
                    unread: false,
                    flagged: true,
                    body: [
                        'Quick reminder:',
                        'Before we move on to broader UI reconstruction, please make sure the copied tile assets still line up with the original Communications package names and scales.',
                        'That will keep the start screen and splash experiences from drifting.'
                    ],
                    statusIcons: ['flag.png', 'forwarded.png']
                }
            ],
            newsletters: [
                {
                    id: 'newsletters-dev',
                    from: 'Windows Weekly',
                    to: 'You',
                    subject: 'Windows app design archives worth studying',
                    preview: 'A short collection of Metro-era app navigation patterns and typography treatments that still hold up.',
                    time: 'Sun',
                    dateLabel: 'Sunday, 4:34 PM',
                    unread: false,
                    flagged: false,
                    body: [
                        'This week we collected several Windows 9-era app references that are useful when reconstructing immersive layouts.',
                        'Pay close attention to the large left-aligned headings, the restraint around motion, and how often original apps used photographic or textured backgrounds only in very specific surfaces.'
                    ]
                }
            ],
            social: [
                {
                    id: 'social-team',
                    from: 'Studio Team',
                    to: 'You',
                    subject: 'Photos from yesterday\'s app archaeology session',
                    preview: 'Shared a few screenshots of the original app package layout and the folder diffs from the first extraction pass.',
                    time: 'Sat',
                    dateLabel: 'Saturday, 6:18 PM',
                    unread: false,
                    flagged: false,
                    body: [
                        'Uploading the screenshots from yesterday\'s session now.',
                        'The biggest surprise was how much of Mail and Calendar is still readable as original app source without having to crack open binaries first.'
                    ],
                    attachments: ['screenshots.zip']
                }
            ],
            folders: [
                {
                    id: 'folders-archive',
                    from: 'Archive',
                    to: 'You',
                    subject: 'No message selected',
                    preview: 'Choose a real folder once more of the original structure is recreated.',
                    time: '',
                    dateLabel: '',
                    unread: false,
                    flagged: false,
                    body: [
                        'This placeholder is here to show how a generic folder surface can look while the deeper reconstruction work is still underway.'
                    ]
                }
            ]
        }
    };

    const DEFAULT_MAIL_ACCOUNTS = [
        { id: 'outlook', name: 'Outlook.com', meta: 'Connected', address: 'you@outlook.com' },
        { id: 'work', name: 'Contoso Mail', meta: 'Work account', address: 'you@contoso.com' },
        { id: 'archive', name: 'Archive', meta: 'Read-only', address: 'archive@example.com' }
    ];

    let MAIL_DATA = deepClone(DEFAULT_MAIL_DATA);
    let MAIL_ACCOUNTS = deepClone(DEFAULT_MAIL_ACCOUNTS);

    const state = {
        activeAccount: 'outlook',
        activeFolder: 'inbox',
        activeMessageId: 'inbox-flight',
        checkedMessageIds: new Set(),
        contextMenuMessageId: null,
        accountFlyoutOpen: false,
        googleConnected: false,
        readOnly: false
    };

    const els = {
        app: document.getElementById('mail-app'),
        splash: document.getElementById('mail-splash'),
        frame: document.getElementById('mailFrame'),
        folderList: document.getElementById('mail-folder-list'),
        folderEyebrow: document.getElementById('mail-folder-eyebrow'),
        folderTitle: document.getElementById('mail-folder-title'),
        folderMeta: document.getElementById('mail-folder-meta'),
        messageList: document.getElementById('mail-message-list'),
        backButton: document.getElementById('mail-reading-back'),
        readingDate: document.getElementById('mail-reading-date'),
        readingTime: document.getElementById('mail-reading-time'),
        readingSubject: document.getElementById('mail-reading-subject'),
        readingAvatar: document.getElementById('mail-reading-avatar'),
        readingFrom: document.getElementById('mail-reading-from'),
        readingTo: document.getElementById('mail-reading-to'),
        readingStatus: document.getElementById('mail-reading-status'),
        readingBody: document.getElementById('mail-reading-body'),
        readingHtml: document.getElementById('mail-reading-html'),
        readingAttachments: document.getElementById('mail-reading-attachments'),
        attachmentList: document.getElementById('mail-attachment-list'),
        readingInvite: document.getElementById('mail-reading-invite'),
        inviteTime: document.getElementById('mail-invite-time'),
        inviteCopy: document.getElementById('mail-invite-copy'),
        banner: document.getElementById('mail-reading-banner'),
        toast: document.getElementById('mail-toast'),
        accountButton: document.getElementById('mail-account-button'),
        accountName: document.getElementById('mail-account-name'),
        accountMeta: document.getElementById('mail-account-meta'),
        accountFlyout: document.getElementById('mail-account-flyout'),
        accountFlyoutList: document.getElementById('mail-account-flyout-list'),
        accountManage: document.getElementById('mail-account-manage'),
        selectionBar: document.getElementById('mail-selection-bar'),
        selectionSummary: document.getElementById('mail-selection-summary'),
        selectionToggleAll: document.getElementById('mail-selection-toggle-all'),
        selectionRead: document.getElementById('mail-selection-read'),
        selectionFlag: document.getElementById('mail-selection-flag'),
        selectionDelete: document.getElementById('mail-selection-delete'),
        selectionClear: document.getElementById('mail-selection-clear'),
        contextMenu: document.getElementById('mail-context-menu')
    };

    let toastTimer = null;

    function getElectronIpc() {
        try {
            if (typeof window.require === 'function') {
                return window.require('electron').ipcRenderer;
            }
            return require('electron').ipcRenderer;
        } catch (_error) {
            return null;
        }
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll('\'', '&#39;');
    }

    function sanitizeEmailHtml(html) {
        return String(html || '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
            .replace(/<(object|embed|applet|form|input|button|textarea|select|meta|base|link)([\s\S]*?)>/gi, '')
            .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
            .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
            .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"')
            .replace(/\s(href|src)\s*=\s*javascript:[^\s>]+/gi, ' $1="#"');
    }

    function buildMailHtmlDocument(html) {
        const safeHtml = sanitizeEmailHtml(html);
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        html, body {
            margin: 0;
            padding: 0;
            background: #fff;
        }

        body {
            color: #2d2d2d;
            font-family: "Segoe UI", Tahoma, Verdana, Arial, sans-serif;
            font-size: 15px;
            line-height: 1.55;
            overflow-wrap: anywhere;
        }

        img, table {
            max-width: 100%;
        }

        pre {
            white-space: pre-wrap;
        }

        blockquote {
            margin-left: 0;
            padding-left: 12px;
            border-left: 3px solid #d9e3ec;
            color: #5f5f5f;
        }

        a {
            color: #0069b5;
        }
    </style>
</head>
<body>${safeHtml}</body>
</html>`;
    }

    function resizeReadingHtmlFrame() {
        const frame = els.readingHtml;
        if (frame.hidden) {
            return;
        }

        try {
            const doc = frame.contentDocument;
            if (!doc) {
                return;
            }

            const nextHeight = Math.max(
                doc.documentElement?.scrollHeight || 0,
                doc.body?.scrollHeight || 0,
                420
            );
            frame.style.height = `${nextHeight}px`;
        } catch (_error) {
            frame.style.height = '420px';
        }
    }

    function getFolderMessages(folderId) {
        return MAIL_DATA.messages[folderId] || [];
    }

    function getActiveAccount() {
        return MAIL_ACCOUNTS.find((account) => account.id === state.activeAccount) || MAIL_ACCOUNTS[0];
    }

    function getActiveMessage() {
        return getFolderMessages(state.activeFolder).find((message) => message.id === state.activeMessageId) || null;
    }

    function getMessageById(messageId) {
        return getFolderMessages(state.activeFolder).find((message) => message.id === messageId) || null;
    }

    function getCheckedMessages() {
        return getFolderMessages(state.activeFolder).filter((message) => state.checkedMessageIds.has(message.id));
    }

    function getFirstAvailableMessage() {
        for (const folder of MAIL_DATA.folders) {
            const firstMessage = getFolderMessages(folder.id)[0];
            if (firstMessage) {
                return {
                    folderId: folder.id,
                    messageId: firstMessage.id
                };
            }
        }
        return {
            folderId: MAIL_DATA.folders[0]?.id || 'inbox',
            messageId: null
        };
    }

    function isNarrowLayout() {
        return window.innerWidth <= 843;
    }

    function setReadingPaneActive(isActive) {
        els.frame.classList.toggle('readingPaneActive', Boolean(isActive && isNarrowLayout()));
    }

    function closeContextMenu() {
        state.contextMenuMessageId = null;
        els.contextMenu.hidden = true;
    }

    function closeAccountFlyout() {
        state.accountFlyoutOpen = false;
        els.accountFlyout.hidden = true;
        els.accountButton.classList.remove('is-open');
    }

    function openContextMenu(messageId, x, y) {
        const message = getMessageById(messageId);
        if (message) {
            const markLabel = message.unread ? 'Mark as read' : 'Mark as unread';
            const flagLabel = message.flagged ? 'Unflag' : 'Flag';
            const markButton = els.contextMenu.querySelector('[data-context-action="markUnread"]');
            const flagButton = els.contextMenu.querySelector('[data-context-action="flag"]');
            if (markButton) {
                markButton.textContent = markLabel;
            }
            if (flagButton) {
                flagButton.textContent = flagLabel;
            }
        }

        state.contextMenuMessageId = messageId;
        els.contextMenu.hidden = false;
        els.contextMenu.style.left = `${x}px`;
        els.contextMenu.style.top = `${y}px`;
    }

    function openAccountFlyout() {
        renderAccountFlyout();
        state.accountFlyoutOpen = true;
        els.accountFlyout.hidden = false;
        els.accountButton.classList.add('is-open');
    }

    function toggleAccountFlyout() {
        if (state.accountFlyoutOpen) {
            closeAccountFlyout();
        } else {
            openAccountFlyout();
        }
    }

    function syncResponsiveState() {
        if (!isNarrowLayout()) {
            setReadingPaneActive(false);
            return;
        }

        if (state.activeMessageId) {
            setReadingPaneActive(els.frame.classList.contains('readingPaneActive'));
        }
    }

    function initialsFromName(name) {
        return name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toUpperCase();
    }

    function splitDateLabel(dateLabel, fallbackTime) {
        if (!dateLabel) {
            return ['', fallbackTime || ''];
        }

        const parts = dateLabel.split(',');
        if (parts.length === 1) {
            return [parts[0], fallbackTime || ''];
        }

        const time = parts.pop().trim();
        return [parts.join(',').trim(), time];
    }

    function iconMarkup(fileName, label) {
        return `<img src="${APP_BASE}resources/icons/${fileName}" alt="${escapeHtml(label || '')}" draggable="false">`;
    }

    function showToast(message) {
        els.toast.textContent = message;
        els.toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            els.toast.hidden = true;
        }, 2200);
    }

    function getGoogleStatusBanner() {
        if (!state.googleConnected) {
            return '';
        }

        return state.readOnly
            ? 'Showing live Gmail data in read-only mode. Reconnect Google to enable message actions.'
            : 'Showing live Gmail data with message actions enabled.';
    }

    function updateAccountActionLabel() {
        if (!state.googleConnected) {
            els.accountManage.textContent = 'Connect Google account';
            return;
        }

        els.accountManage.textContent = state.readOnly ? 'Reconnect Google account' : 'Disconnect Google account';
    }

    function resetToMockData() {
        MAIL_DATA = deepClone(DEFAULT_MAIL_DATA);
        MAIL_ACCOUNTS = deepClone(DEFAULT_MAIL_ACCOUNTS);
        const firstAvailable = getFirstAvailableMessage();
        state.activeAccount = MAIL_ACCOUNTS[0]?.id || 'outlook';
        state.activeFolder = firstAvailable.folderId;
        state.activeMessageId = firstAvailable.messageId;
        state.checkedMessageIds.clear();
        state.googleConnected = false;
        state.readOnly = false;
        updateAccountActionLabel();
    }

    function applyMailBootstrapData(result, options = {}) {
        MAIL_DATA = {
            folders: Array.isArray(result.folders) ? result.folders : [],
            messages: result.messages || {}
        };
        MAIL_ACCOUNTS = Array.isArray(result.accounts) && result.accounts.length
            ? result.accounts
            : [{ id: 'google', name: 'Google', meta: 'Connected', address: '' }];

        const preferredAccountId = options.preferredAccountId;
        state.activeAccount = MAIL_ACCOUNTS.some((account) => account.id === preferredAccountId)
            ? preferredAccountId
            : MAIL_ACCOUNTS[0]?.id || 'google';

        const fallbackLocation = getFirstAvailableMessage();
        const preferredFolderId = options.preferredFolderId;
        state.activeFolder = MAIL_DATA.folders.some((folder) => folder.id === preferredFolderId)
            ? preferredFolderId
            : fallbackLocation.folderId;

        const activeFolderMessages = getFolderMessages(state.activeFolder);
        const preferredMessageId = options.preferredMessageId;
        state.activeMessageId = activeFolderMessages.some((message) => message.id === preferredMessageId)
            ? preferredMessageId
            : activeFolderMessages[0]?.id || null;

        state.checkedMessageIds.clear();
        const checkedMessageIds = Array.isArray(options.checkedMessageIds) ? options.checkedMessageIds : [];
        checkedMessageIds.forEach((messageId) => {
            if (activeFolderMessages.some((message) => message.id === messageId)) {
                state.checkedMessageIds.add(messageId);
            }
        });

        state.googleConnected = true;
        state.readOnly = Boolean(result.readOnly);
        updateAccountActionLabel();
    }

    async function loadGoogleBootstrapData(options = {}) {
        if (!electronIpc?.invoke) {
            updateAccountActionLabel();
            return false;
        }

        try {
            const result = await electronIpc.invoke('google-mail:get-bootstrap-data');
            if (!result?.success) {
                updateAccountActionLabel();
                return false;
            }

            applyMailBootstrapData(result, options.preserveLocation ? {
                preferredAccountId: options.preferredAccountId || state.activeAccount,
                preferredFolderId: options.preferredFolderId || state.activeFolder,
                preferredMessageId: Object.prototype.hasOwnProperty.call(options, 'preferredMessageId')
                    ? options.preferredMessageId
                    : state.activeMessageId,
                checkedMessageIds: options.checkedMessageIds || [...state.checkedMessageIds]
            } : {});

            renderAccountSummary();
            renderAccountFlyout();
            renderFolders();
            renderMessageList();
            renderSelectionBar();
            renderReadingPane();

            if (!options.quiet) {
                showToast('Google Mail connected.');
                updateBanner(getGoogleStatusBanner());
            }

            return true;
        } catch (error) {
            console.warn('[Mail] Failed to load Google data:', error);
            updateAccountActionLabel();
            return false;
        }
    }

    async function connectGoogleAccount() {
        if (!electronIpc?.invoke) {
            showToast('Google sign-in is only available in the Electron app.');
            return;
        }

        try {
            const signInResult = await electronIpc.invoke('google-auth:sign-in');
            if (!signInResult?.success) {
                showToast('Google sign-in did not complete.');
                return;
            }

            const loaded = await loadGoogleBootstrapData({
                quiet: true,
                preserveLocation: state.googleConnected,
                preferredAccountId: state.activeAccount,
                preferredFolderId: state.activeFolder,
                preferredMessageId: state.activeMessageId,
                checkedMessageIds: [...state.checkedMessageIds]
            });
            if (loaded) {
                showToast('Google account connected.');
                updateBanner(getGoogleStatusBanner());
            }
        } catch (error) {
            console.warn('[Mail] Google sign-in failed:', error);
            showToast('Google sign-in failed.');
        }
    }

    async function disconnectGoogleAccount() {
        if (!electronIpc?.invoke) {
            return;
        }

        try {
            await electronIpc.invoke('google-auth:sign-out');
        } catch (error) {
            console.warn('[Mail] Google sign-out failed:', error);
        }

        resetToMockData();
        updateBanner('');
        closeAccountFlyout();
        renderAccountSummary();
        renderAccountFlyout();
        renderFolders();
        renderMessageList();
        renderSelectionBar();
        renderReadingPane();
        showToast('Google account disconnected.');
    }

    function renderFolders() {
        els.folderList.innerHTML = MAIL_DATA.folders
            .map((folder) => {
                const unreadCount = folder.unreadCount ?? getFolderMessages(folder.id).filter((message) => message.unread).length;
                return `
                <button class="mail-folder${folder.id === state.activeFolder ? ' is-active' : ''}${folder.level ? ' is-subfolder' : ''}" type="button" data-folder-id="${folder.id}">
                    <img src="${APP_BASE}resources/icons/${folder.icon}" alt="" draggable="false">
                    <span class="mail-folder__label">${escapeHtml(folder.label)}</span>
                    <span class="mail-folder__count">${unreadCount || ''}</span>
                </button>
            `;
            })
            .join('');
    }

    function renderAccountSummary() {
        const account = getActiveAccount();
        els.accountName.textContent = account.name;
        els.accountMeta.textContent = account.meta;
        updateAccountActionLabel();
    }

    function renderAccountFlyout() {
        els.accountFlyoutList.innerHTML = MAIL_ACCOUNTS
            .map((account) => `
                <button
                    class="mail-account-flyout__item${account.id === state.activeAccount ? ' is-active' : ''}"
                    type="button"
                    data-account-id="${account.id}"
                >
                    <span class="mail-account-flyout__avatar">${escapeHtml(initialsFromName(account.name))}</span>
                    <span class="mail-account-flyout__content">
                        <span class="mail-account-flyout__name">${escapeHtml(account.name)}</span>
                        <span class="mail-account-flyout__meta">${escapeHtml(account.address)}</span>
                    </span>
                    <span class="mail-account-flyout__check" aria-hidden="true">${account.id === state.activeAccount ? '&#xE10B;' : ''}</span>
                </button>
            `)
            .join('');
    }

    function renderMessageList() {
        const folder = MAIL_DATA.folders.find((item) => item.id === state.activeFolder);
        const messages = getFolderMessages(state.activeFolder);
        const unreadCount = messages.filter((message) => message.unread).length;

        els.folderEyebrow.textContent = folder ? folder.label : 'Mail';
        els.folderTitle.textContent = folder ? folder.label : 'Mail';
        els.folderMeta.textContent = unreadCount
            ? `${unreadCount} unread`
            : `${messages.length} conversation${messages.length === 1 ? '' : 's'}`;

        els.messageList.innerHTML = messages
            .map((message) => {
                const statusIcons = [];
                if (message.statusIcons) {
                    statusIcons.push(...message.statusIcons);
                }
                if (message.attachments?.length) {
                    statusIcons.push('attached.png');
                }
                if (message.invite) {
                    statusIcons.push('invite.png');
                }

                return `
                    <div
                        class="mailMessageListEntryContainer${message.id === state.activeMessageId ? ' is-active' : ''}${message.unread ? ' unread' : ''}${state.checkedMessageIds.has(message.id) ? ' is-checked' : ''}"
                        role="button"
                        tabindex="0"
                        aria-pressed="${message.id === state.activeMessageId ? 'true' : 'false'}"
                        data-message-id="${message.id}"
                    >
                        <div class="mailMessageListCheckBox" role="checkbox" aria-checked="${state.checkedMessageIds.has(message.id) ? 'true' : 'false'}" tabindex="-1">
                            <div class="mailMessageListCheckBoxButton">
                                <span class="mailMessageListCheckBoxGlyph">&#10003;</span>
                            </div>
                        </div>
                        <div class="mailMessageListFrom typeSize16pt">${escapeHtml(message.from)}</div>
                        <div class="mailMessageListGlyphContainer typeSizeSmall">
                            ${message.flagged ? iconMarkup('flag.png', 'Flagged') : ''}
                            ${statusIcons.map((icon) => iconMarkup(icon, '')).join('')}
                        </div>
                        <div class="mailMessageListItemCommandContainer" aria-hidden="true">
                            <button class="mailMessageListCommand" type="button" data-item-action="markUnread" title="${message.unread ? 'Mark read' : 'Mark unread'}">
                                <span aria-hidden="true">&#xE119;</span>
                            </button>
                            <button class="mailMessageListCommand" type="button" data-item-action="flag" title="${message.flagged ? 'Unflag' : 'Flag'}">
                                <span aria-hidden="true">&#xE129;</span>
                            </button>
                            <button class="mailMessageListCommand" type="button" data-item-action="delete" title="Delete">
                                <span aria-hidden="true">&#xE107;</span>
                            </button>
                        </div>
                        <div class="mailMessageListHeaderSecondRow">
                            <div class="mailMessageListSubject typeSizeNormal">${escapeHtml(message.subject)}</div>
                            <div class="mailMessageListPreview typeSizeNormal">${escapeHtml(message.preview)}</div>
                            <div class="mailMessageListDate typeSizeSmall">${escapeHtml(message.time)}</div>
                        </div>
                    </div>
                `;
            })
            .join('');
    }

    function renderSelectionBar() {
        const messages = getFolderMessages(state.activeFolder);
        const checkedMessages = getCheckedMessages();
        const selectedCount = checkedMessages.length;
        const allSelected = Boolean(messages.length) && selectedCount === messages.length;
        const anyUnread = checkedMessages.some((message) => message.unread);
        const anyUnflagged = checkedMessages.some((message) => !message.flagged);

        els.selectionBar.hidden = selectedCount === 0;
        els.app.classList.toggle('selectionModeActive', selectedCount > 0);
        els.selectionSummary.textContent = `${selectedCount} selected`;
        els.selectionToggleAll.textContent = allSelected ? 'Clear all' : 'Select all';
        els.selectionRead.textContent = anyUnread ? 'Mark read' : 'Mark unread';
        els.selectionFlag.textContent = anyUnflagged ? 'Flag' : 'Unflag';
        els.selectionToggleAll.disabled = messages.length === 0;
        els.selectionRead.disabled = selectedCount === 0;
        els.selectionFlag.disabled = selectedCount === 0;
        els.selectionDelete.disabled = selectedCount === 0;
        els.selectionClear.disabled = selectedCount === 0;
    }

    function renderReadingPane() {
        const message = getActiveMessage();
        if (!message) {
            updateBanner('');
            els.readingDate.textContent = '';
            els.readingTime.textContent = '';
            els.readingSubject.textContent = 'No message selected';
            els.readingAvatar.textContent = '';
            els.readingFrom.textContent = '';
            els.readingTo.textContent = '';
            els.readingStatus.innerHTML = '';
            els.readingBody.hidden = false;
            els.readingHtml.hidden = true;
            els.readingHtml.srcdoc = '';
            els.readingBody.innerHTML = '<p>Select a conversation to preview it in the reading pane.</p>';
            els.readingAttachments.hidden = true;
            els.readingInvite.hidden = true;
            return;
        }

        const [datePart, timePart] = splitDateLabel(message.dateLabel, message.time);

        els.readingDate.textContent = datePart;
        els.readingTime.textContent = timePart;
        els.readingSubject.textContent = message.subject;
        els.readingAvatar.textContent = initialsFromName(message.from);
        els.readingFrom.textContent = message.from;
        els.readingTo.textContent = message.to;
        els.readingStatus.innerHTML = '';

        const statusIcons = [];
        if (message.flagged) {
            statusIcons.push('flag.png');
        }
        if (message.statusIcons) {
            statusIcons.push(...message.statusIcons);
        }

        statusIcons.forEach((icon) => {
            const img = document.createElement('img');
            img.src = `${APP_BASE}resources/icons/${icon}`;
            img.alt = '';
            img.draggable = false;
            els.readingStatus.appendChild(img);
        });

        if (message.htmlBody) {
            els.readingBody.hidden = true;
            els.readingHtml.hidden = false;
            els.readingHtml.srcdoc = buildMailHtmlDocument(message.htmlBody);
            window.setTimeout(resizeReadingHtmlFrame, 0);
        } else {
            els.readingHtml.hidden = true;
            els.readingHtml.srcdoc = '';
            els.readingBody.hidden = false;
            els.readingBody.innerHTML = '';
            message.body.forEach((paragraph) => {
                const p = document.createElement('p');
                p.textContent = paragraph;
                els.readingBody.appendChild(p);
            });
        }

        if (message.attachments?.length) {
            els.readingAttachments.hidden = false;
            els.attachmentList.innerHTML = message.attachments
                .map((fileName) => `
                    <div class="mail-attachment">
                        <img class="mail-attachment__icon" src="${APP_BASE}resources/icons/attached.png" alt="" draggable="false">
                        <span>${escapeHtml(fileName)}</span>
                    </div>
                `)
                .join('');
        } else {
            els.readingAttachments.hidden = true;
            els.attachmentList.innerHTML = '';
        }

        if (message.invite) {
            els.readingInvite.hidden = false;
            els.inviteTime.textContent = message.invite.time;
            els.inviteCopy.textContent = message.invite.copy;
        } else {
            els.readingInvite.hidden = true;
        }
    }

    function setActiveFolder(folderId) {
        state.activeFolder = folderId;
        const firstMessage = getFolderMessages(folderId)[0];
        state.activeMessageId = firstMessage ? firstMessage.id : null;
        state.checkedMessageIds.clear();
        updateBanner('');
        closeContextMenu();
        closeAccountFlyout();
        setReadingPaneActive(false);
        renderFolders();
        renderMessageList();
        renderSelectionBar();
        renderReadingPane();
    }

    function setActiveMessage(messageId) {
        state.activeMessageId = messageId;
        const message = getActiveMessage();
        if (message) {
            message.unread = false;
        }
        updateBanner('');
        closeContextMenu();
        setReadingPaneActive(true);
        renderFolders();
        renderMessageList();
        renderSelectionBar();
        renderReadingPane();
    }

    function toggleCheckedMessage(messageId) {
        if (state.checkedMessageIds.has(messageId)) {
            state.checkedMessageIds.delete(messageId);
        } else {
            state.checkedMessageIds.add(messageId);
        }
        renderMessageList();
        renderSelectionBar();
    }

    function clearCheckedMessages() {
        state.checkedMessageIds.clear();
        renderMessageList();
        renderSelectionBar();
    }

    function toggleSelectAllMessages() {
        const messages = getFolderMessages(state.activeFolder);
        const allSelected = Boolean(messages.length) && messages.every((message) => state.checkedMessageIds.has(message.id));

        state.checkedMessageIds.clear();
        if (!allSelected) {
            messages.forEach((message) => {
                state.checkedMessageIds.add(message.id);
            });
        }

        renderMessageList();
        renderSelectionBar();
    }

    function updateBanner(text) {
        els.banner.hidden = !text;
        els.banner.textContent = text || '';
    }

    function setActiveAccount(accountId) {
        state.activeAccount = accountId;
        renderAccountSummary();
        renderAccountFlyout();
        closeAccountFlyout();
        showToast(`Switched to ${getActiveAccount().name}.`);
        updateBanner(state.googleConnected
            ? getGoogleStatusBanner()
            : 'Account switching is now wired into the shell layout; deeper per-account data behavior can come with the backend bridge.');
    }

    async function applyGoogleMailAction(action, targets) {
        if (!electronIpc?.invoke) {
            showToast('Google Mail actions are only available in the Electron app.');
            return true;
        }

        if (state.readOnly) {
            closeContextMenu();
            showToast('Reconnect Google account to enable message changes.');
            updateBanner('Reconnect Google to grant Gmail modify access for Mail actions.');
            renderAccountSummary();
            renderAccountFlyout();
            return true;
        }

        let backendAction = action;
        let successToast = 'Message updated.';

        if (action === 'markUnread') {
            const shouldMarkRead = targets.some((message) => message.unread);
            backendAction = shouldMarkRead ? 'markRead' : 'markUnread';
            successToast = shouldMarkRead ? 'Marked as read.' : 'Marked as unread.';
        } else if (action === 'flag') {
            const shouldFlag = targets.some((message) => !message.flagged);
            backendAction = shouldFlag ? 'flag' : 'unflag';
            successToast = shouldFlag ? 'Conversation flagged.' : 'Flag removed.';
        } else if (action === 'delete') {
            successToast = targets.length > 1 ? 'Conversations deleted.' : 'Conversation deleted.';
        } else {
            return false;
        }

        const targetIds = targets.map((message) => message.id);
        const preservedCheckedIds = [...state.checkedMessageIds].filter((messageId) => !(backendAction === 'delete' && targetIds.includes(messageId)));
        const preferredMessageId = backendAction === 'delete' && targetIds.includes(state.activeMessageId)
            ? null
            : state.activeMessageId;

        closeContextMenu();

        try {
            const result = await electronIpc.invoke('google-mail:apply-action', {
                action: backendAction,
                threadIds: targetIds
            });

            if (!result?.success && !result?.partialSuccess) {
                if (result?.requiresReconnect) {
                    state.readOnly = true;
                    updateAccountActionLabel();
                    renderAccountSummary();
                    renderAccountFlyout();
                    showToast('Reconnect Google account to enable message changes.');
                    updateBanner('Reconnect Google to grant Gmail modify access for Mail actions.');
                    return true;
                }

                showToast(result?.error || 'Google Mail action failed.');
                return true;
            }

            const refreshed = await loadGoogleBootstrapData({
                quiet: true,
                preserveLocation: true,
                preferredAccountId: state.activeAccount,
                preferredFolderId: state.activeFolder,
                preferredMessageId,
                checkedMessageIds: preservedCheckedIds
            });

            if (result.partialSuccess) {
                showToast(result.error || `Applied changes to ${result.completedCount} conversation${result.completedCount === 1 ? '' : 's'}.`);
            } else {
                showToast(successToast);
            }

            updateBanner(refreshed ? '' : 'Message action applied, but the live Gmail view could not be refreshed automatically.');
            return true;
        } catch (error) {
            console.warn('[Mail] Google Mail action failed:', error);
            showToast('Google Mail action failed.');
            return true;
        }
    }

    async function handleCommand(action, targetMessageId) {
        const checkedMessages = getCheckedMessages();
        const targets = targetMessageId
            ? [getMessageById(targetMessageId)].filter(Boolean)
            : checkedMessages.length
                ? checkedMessages
                : [getActiveMessage()].filter(Boolean);

        if (!targets.length) {
            return;
        }

        if (state.googleConnected && ['flag', 'markUnread', 'delete'].includes(action)) {
            const handled = await applyGoogleMailAction(action, targets);
            if (handled) {
                return;
            }
        }

        if (action === 'flag') {
            const shouldFlag = targets.some((message) => !message.flagged);
            targets.forEach((message) => {
                message.flagged = shouldFlag;
            });
            showToast(shouldFlag ? 'Conversation flagged.' : 'Flag removed.');
            updateBanner(shouldFlag ? 'Flagged for follow-up.' : '');
        } else if (action === 'markUnread') {
            const shouldMarkRead = targets.some((message) => message.unread);
            targets.forEach((message) => {
                message.unread = !shouldMarkRead;
            });
            showToast(shouldMarkRead ? 'Marked as read.' : 'Marked as unread.');
            updateBanner(shouldMarkRead ? '' : 'Unread marker restored.');
        } else if (action === 'reply') {
            showToast('Reply draft opened.');
            updateBanner('Reply is staged in the compose surface reconstruction queue.');
        } else if (action === 'delete') {
            const messages = getFolderMessages(state.activeFolder);
            const targetIds = new Set(targets.map((message) => message.id));
            const remainingMessages = messages.filter((message) => !targetIds.has(message.id));

            messages.splice(0, messages.length, ...remainingMessages);
            targetIds.forEach((messageId) => {
                state.checkedMessageIds.delete(messageId);
            });
            showToast(targetIds.size > 1 ? 'Conversations deleted.' : 'Conversation deleted.');
            updateBanner('');

            if (!messages.some((message) => message.id === state.activeMessageId)) {
                state.activeMessageId = messages[0] ? messages[0].id : null;
            }
        }

        closeContextMenu();
        renderAccountSummary();
        renderFolders();
        renderMessageList();
        renderSelectionBar();
        renderReadingPane();
    }

    function bindEvents() {
        els.folderList.addEventListener('click', (event) => {
            const button = event.target.closest('[data-folder-id]');
            if (button) {
                setActiveFolder(button.dataset.folderId);
            }
        });

        els.messageList.addEventListener('click', (event) => {
            const rowCommand = event.target.closest('[data-item-action]');
            if (rowCommand) {
                const button = rowCommand.closest('[data-message-id]');
                if (button) {
                    handleCommand(rowCommand.dataset.itemAction, button.dataset.messageId);
                }
                return;
            }

            const checkbox = event.target.closest('.mailMessageListCheckBox');
            if (checkbox) {
                const button = checkbox.closest('[data-message-id]');
                if (button) {
                    toggleCheckedMessage(button.dataset.messageId);
                }
                return;
            }

            const button = event.target.closest('[data-message-id]');
            if (button) {
                setActiveMessage(button.dataset.messageId);
            }
        });

        els.messageList.addEventListener('contextmenu', (event) => {
            const button = event.target.closest('[data-message-id]');
            if (!button) {
                return;
            }

            event.preventDefault();
            openContextMenu(button.dataset.messageId, event.clientX, event.clientY);
        });

        els.messageList.addEventListener('keydown', (event) => {
            const row = event.target.closest('[data-message-id]');
            if (!row) {
                return;
            }

            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActiveMessage(row.dataset.messageId);
            }
        });

        document.querySelector('.mailReadingPaneCanvasButtonArea').addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (button) {
                handleCommand(button.dataset.action);
            }
        });

        els.backButton.addEventListener('click', () => {
            setReadingPaneActive(false);
        });

        els.selectionToggleAll.addEventListener('click', () => {
            toggleSelectAllMessages();
        });

        els.selectionRead.addEventListener('click', () => {
            handleCommand('markUnread');
        });

        els.selectionFlag.addEventListener('click', () => {
            handleCommand('flag');
        });

        els.selectionDelete.addEventListener('click', () => {
            handleCommand('delete');
        });

        els.selectionClear.addEventListener('click', () => {
            clearCheckedMessages();
        });

        els.contextMenu.addEventListener('click', (event) => {
            const button = event.target.closest('[data-context-action]');
            if (!button || !state.contextMenuMessageId) {
                return;
            }

            handleCommand(button.dataset.contextAction, state.contextMenuMessageId);
        });

        els.accountButton.addEventListener('click', (event) => {
            event.stopPropagation();
            closeContextMenu();
            toggleAccountFlyout();
        });

        els.accountFlyout.addEventListener('click', async (event) => {
            const accountButton = event.target.closest('[data-account-id]');
            if (accountButton) {
                setActiveAccount(accountButton.dataset.accountId);
                return;
            }

            if (event.target.closest('#mail-account-manage')) {
                if (state.googleConnected && !state.readOnly) {
                    await disconnectGoogleAccount();
                } else {
                    closeAccountFlyout();
                    await connectGoogleAccount();
                }
            }
        });

        els.readingHtml.addEventListener('load', () => {
            resizeReadingHtmlFrame();
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('#mail-context-menu')) {
                closeContextMenu();
            }
            if (!event.target.closest('#mail-account-flyout') && !event.target.closest('#mail-account-button')) {
                closeAccountFlyout();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key.toLowerCase() === 'a') {
                event.preventDefault();
                toggleSelectAllMessages();
                return;
            }

            if (event.ctrlKey && event.key.toLowerCase() === 'n') {
                event.preventDefault();
                showToast('Compose surface opened.');
                updateBanner('Compose is available as a command surface; full draft behavior will come with the live backend pass.');
                return;
            }

            if (event.key === 'Escape') {
                if (!els.contextMenu.hidden) {
                    closeContextMenu();
                    return;
                }

                if (state.accountFlyoutOpen) {
                    closeAccountFlyout();
                    return;
                }

                if (state.checkedMessageIds.size) {
                    clearCheckedMessages();
                    return;
                }

                if (els.frame.classList.contains('readingPaneActive')) {
                    setReadingPaneActive(false);
                }
            }
        });

        window.addEventListener('resize', syncResponsiveState);
        window.addEventListener('resize', resizeReadingHtmlFrame);
    }

    async function initMail() {
        resetToMockData();
        renderAccountSummary();
        renderAccountFlyout();
        renderFolders();
        renderMessageList();
        renderSelectionBar();
        renderReadingPane();
        bindEvents();

        await loadGoogleBootstrapData({ quiet: true });

        window.setTimeout(() => {
            els.splash.classList.add('is-hidden');
        }, 320);
    }

    initMail();
})();
