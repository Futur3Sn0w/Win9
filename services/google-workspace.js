const { ipcMain, shell } = require('electron');
const Store = require('electron-store');
const { google } = require('googleapis');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');

const GOOGLE_STORE = new Store({ name: 'google-workspace' });
const CLIENT_CONFIG_PATH = path.resolve(__dirname, '..', 'secrets', 'google-oauth-client.json');
const CALENDAR_BOOTSTRAP_CACHE_KEY = 'calendar.bootstrap-cache';
const CALENDAR_BOOTSTRAP_CACHE_TTL_MS = 5 * 60 * 1000;
const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const GOOGLE_SCOPES = [
  GMAIL_MODIFY_SCOPE,
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
  'profile'
];
const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const GMAIL_CATEGORY_DEFINITIONS = [
  { id: 'inbox', label: 'Inbox', icon: 'view-inbox.png', labelIds: ['INBOX', 'CATEGORY_PERSONAL'], unreadLabelId: 'CATEGORY_PERSONAL' },
  { id: 'social', label: 'Social', icon: 'view-socialupdate.png', labelIds: ['INBOX', 'CATEGORY_SOCIAL'], unreadLabelId: 'CATEGORY_SOCIAL', parentId: 'inbox', level: 1 },
  { id: 'promotions', label: 'Promotions', icon: 'view-newsletter.png', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], unreadLabelId: 'CATEGORY_PROMOTIONS', parentId: 'inbox', level: 1 },
  { id: 'updates', label: 'Updates', icon: 'view-folder.png', labelIds: ['INBOX', 'CATEGORY_UPDATES'], unreadLabelId: 'CATEGORY_UPDATES', parentId: 'inbox', level: 1 },
  { id: 'forums', label: 'Forums', icon: 'view-folder.png', labelIds: ['INBOX', 'CATEGORY_FORUMS'], unreadLabelId: 'CATEGORY_FORUMS', parentId: 'inbox', level: 1 }
];

let inFlightAuthPromise = null;

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearCalendarBootstrapCache() {
  GOOGLE_STORE.delete(CALENDAR_BOOTSTRAP_CACHE_KEY);
}

function getCalendarBootstrapCache() {
  const cacheEntry = GOOGLE_STORE.get(CALENDAR_BOOTSTRAP_CACHE_KEY);
  if (!cacheEntry || typeof cacheEntry !== 'object' || !cacheEntry.payload) {
    return null;
  }

  return cacheEntry;
}

function setCalendarBootstrapCache(payload, options = {}) {
  const cachedAt = Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : CALENDAR_BOOTSTRAP_CACHE_TTL_MS;
  const cacheEntry = {
    payload: cloneSerializable(payload),
    cachedAt,
    expiresAt: cachedAt + ttlMs
  };

  GOOGLE_STORE.set(CALENDAR_BOOTSTRAP_CACHE_KEY, cacheEntry);
  return cacheEntry;
}

function buildCalendarBootstrapCacheMeta(cacheEntry, overrides = {}) {
  return {
    hit: Boolean(overrides.hit),
    stale: Boolean(overrides.stale),
    cachedAt: cacheEntry?.cachedAt || null,
    expiresAt: cacheEntry?.expiresAt || null
  };
}

function mergeCalendarBootstrapCachePayload(cacheEntry, overrides = {}) {
  return {
    ...cloneSerializable(cacheEntry.payload),
    cache: buildCalendarBootstrapCacheMeta(cacheEntry, overrides)
  };
}

function sortNormalizedCalendarEvents(events) {
  return events
    .slice()
    .sort((left, right) => `${left.date}${left.start}`.localeCompare(`${right.date}${right.start}`));
}

function upsertCachedCalendarEvent(event, fallbackCalendar = null) {
  const cacheEntry = getCalendarBootstrapCache();
  if (!cacheEntry?.payload || !event?.id) {
    return;
  }

  const payload = cloneSerializable(cacheEntry.payload);
  const calendars = Array.isArray(payload.calendars) ? payload.calendars : [];
  const existingCalendarIndex = calendars.findIndex((calendar) => calendar.id === event.calendarId);
  if (existingCalendarIndex === -1 && fallbackCalendar?.id) {
    calendars.push({
      id: fallbackCalendar.id,
      title: fallbackCalendar.title || fallbackCalendar.id,
      primary: Boolean(fallbackCalendar.primary),
      color: fallbackCalendar.color || null
    });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const existingIndex = events.findIndex((item) => item.id === event.id);
  if (existingIndex >= 0) {
    events[existingIndex] = event;
  } else {
    events.push(event);
  }

  payload.calendars = calendars;
  payload.events = sortNormalizedCalendarEvents(events);
  setCalendarBootstrapCache(payload);
}

function removeCachedCalendarEvent(calendarId, eventId) {
  const cacheEntry = getCalendarBootstrapCache();
  if (!cacheEntry?.payload || !eventId) {
    return;
  }

  const payload = cloneSerializable(cacheEntry.payload);
  payload.events = (Array.isArray(payload.events) ? payload.events : [])
    .filter((event) => !(event.id === eventId && (!calendarId || event.calendarId === calendarId)));
  setCalendarBootstrapCache(payload);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, '\'')
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeBase64Url(value) {
  if (!value) {
    return '';
  }

  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function findHeader(headers = [], name) {
  const normalizedName = String(name).toLowerCase();
  return headers.find((header) => String(header.name || '').toLowerCase() === normalizedName)?.value || '';
}

function extractDisplayName(headerValue, fallback = 'Unknown sender') {
  const value = String(headerValue || '').trim();
  if (!value) {
    return fallback;
  }

  const angleMatch = value.match(/^(.*?)(?:<([^>]+)>)?$/);
  const label = (angleMatch?.[1] || '').trim().replace(/^"|"$/g, '');
  const address = (angleMatch?.[2] || '').trim();
  if (label) {
    return label;
  }
  if (address) {
    return address;
  }
  return value;
}

function formatShortTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatConversationTime(date) {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return formatShortTime(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  const sameWeek = Math.abs(now.getTime() - date.getTime()) < 6 * 24 * 60 * 60 * 1000;
  if (sameWeek) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function formatConversationDateLabel(date) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return `Today, ${formatShortTime(date)}`;
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${formatShortTime(date)}`;
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function splitIntoParagraphs(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, ' ').trim())
    .filter(Boolean);

  return paragraphs.length ? paragraphs.slice(0, 10) : ['No preview text was available for this message.'];
}

function collectAttachmentNames(payload, output = []) {
  if (!payload) {
    return output;
  }

  if (payload.filename) {
    output.push(payload.filename);
  }

  if (Array.isArray(payload.parts)) {
    payload.parts.forEach((part) => collectAttachmentNames(part, output));
  }

  return output;
}

function extractBodyTextFromPayload(payload) {
  if (!payload) {
    return '';
  }

  const queue = [payload];
  let htmlBody = '';

  while (queue.length) {
    const part = queue.shift();
    if (!part) {
      continue;
    }

    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }

    if (!htmlBody && part.mimeType === 'text/html' && part.body?.data) {
      htmlBody = stripHtml(decodeBase64Url(part.body.data));
    }

    if (Array.isArray(part.parts)) {
      queue.push(...part.parts);
    }
  }

  if (payload.body?.data) {
    return payload.mimeType === 'text/html'
      ? stripHtml(decodeBase64Url(payload.body.data))
      : decodeBase64Url(payload.body.data);
  }

  return htmlBody;
}

function extractHtmlBodyFromPayload(payload) {
  if (!payload) {
    return '';
  }

  const queue = [payload];
  while (queue.length) {
    const part = queue.shift();
    if (!part) {
      continue;
    }

    if (part.mimeType === 'text/html' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }

    if (Array.isArray(part.parts)) {
      queue.push(...part.parts);
    }
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return '';
}

function createLoopbackServer() {
  let resolveAuth;
  let rejectAuth;

  const authCodePromise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });

  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://localhost');
      const error = requestUrl.searchParams.get('error');
      const code = requestUrl.searchParams.get('code');

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        response.end('<html><body><h2>Google sign-in failed.</h2><p>You can close this window and try again.</p></body></html>');
        rejectAuth(new Error(`Google OAuth error: ${error}`));
        return;
      }

      if (!code) {
        response.end('<html><body><h2>Waiting for sign-in...</h2></body></html>');
        return;
      }

      response.end('<html><body><h2>Google account connected.</h2><p>You can close this window and return to the app.</p></body></html>');
      resolveAuth(code);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Authentication callback failed.');
      rejectAuth(error);
    }
  });

  const started = new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to start Google OAuth callback server.'));
        return;
      }

      resolve({
        port: address.port,
        server,
        authCodePromise
      });
    });
  });

  return started;
}

async function loadClientConfig() {
  const file = await fs.readFile(CLIENT_CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(file);
  const config = parsed.installed || parsed.web;
  if (!config?.client_id || !config?.client_secret) {
    throw new Error('Google OAuth client file is missing required fields.');
  }
  return config;
}

function createOAuthClient(config, redirectUri) {
  const client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    redirectUri
  );

  client.on('tokens', (tokens) => {
    if (!tokens) {
      return;
    }

    const current = GOOGLE_STORE.get('tokens') || {};
    GOOGLE_STORE.set('tokens', {
      ...current,
      ...tokens,
      refresh_token: tokens.refresh_token || current.refresh_token || null
    });
  });

  return client;
}

function buildSignedOutStatus({ configured, error = '' } = {}) {
  return {
    success: true,
    configured: Boolean(configured),
    signedIn: false,
    profile: null,
    error
  };
}

async function getGoogleProfile(authClient) {
  const oauth2 = google.oauth2({
    version: 'v2',
    auth: authClient
  });
  const response = await oauth2.userinfo.get();
  const data = response.data || {};
  const profile = {
    email: data.email || '',
    displayName: data.name || data.email || 'Google',
    picture: data.picture || ''
  };
  GOOGLE_STORE.set('profile', profile);
  return profile;
}

async function getSavedAuthClient() {
  const tokens = GOOGLE_STORE.get('tokens');
  if (!tokens) {
    return null;
  }

  const config = await loadClientConfig();
  const redirectUri = config.redirect_uris?.[0] || 'http://localhost';
  const authClient = createOAuthClient(config, redirectUri);
  authClient.setCredentials(tokens);
  return authClient;
}

function getGrantedScopes() {
  const tokens = GOOGLE_STORE.get('tokens') || {};
  const scopeValue = tokens.scope || '';
  return new Set(String(scopeValue).split(/\s+/).filter(Boolean));
}

function hasScope(scope) {
  return getGrantedScopes().has(scope);
}

async function getAuthorizedClient() {
  const authClient = await getSavedAuthClient();
  if (!authClient) {
    return null;
  }

  try {
    await authClient.getAccessToken();
    return authClient;
  } catch (error) {
    GOOGLE_STORE.delete('tokens');
    GOOGLE_STORE.delete('profile');
    clearCalendarBootstrapCache();
    return null;
  }
}

async function getAuthStatus() {
  try {
    await fs.access(CLIENT_CONFIG_PATH);
  } catch (_error) {
    return buildSignedOutStatus({
      configured: false,
      error: 'Google OAuth client file was not found.'
    });
  }

  const authClient = await getAuthorizedClient();
  if (!authClient) {
    return buildSignedOutStatus({ configured: true });
  }

  try {
    const profile = await getGoogleProfile(authClient);
    return {
      success: true,
      configured: true,
      signedIn: true,
      profile
    };
  } catch (error) {
    GOOGLE_STORE.delete('tokens');
    GOOGLE_STORE.delete('profile');
    return buildSignedOutStatus({
      configured: true,
      error: error.message || 'Unable to load Google profile.'
    });
  }
}

async function signIn() {
  if (inFlightAuthPromise) {
    return inFlightAuthPromise;
  }

  inFlightAuthPromise = (async () => {
    const config = await loadClientConfig();
    const { port, server, authCodePromise } = await createLoopbackServer();
    const redirectUri = `http://localhost:${port}`;
    const authClient = createOAuthClient(config, redirectUri);
    const authUrl = authClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES
    });

    await shell.openExternal(authUrl);

    try {
      const code = await authCodePromise;
      const tokenResponse = await authClient.getToken(code);
        authClient.setCredentials(tokenResponse.tokens);
        GOOGLE_STORE.set('tokens', {
          ...tokenResponse.tokens,
          refresh_token: tokenResponse.tokens.refresh_token || null
        });
        clearCalendarBootstrapCache();

        const profile = await getGoogleProfile(authClient);
        return {
        success: true,
        configured: true,
        signedIn: true,
        profile
      };
    } finally {
      server.close();
    }
  })().finally(() => {
    inFlightAuthPromise = null;
  });

  return inFlightAuthPromise;
}

async function signOut() {
  const authClient = await getSavedAuthClient();
  if (authClient) {
    try {
      await authClient.revokeCredentials();
    } catch (_error) {
      // Clearing local credentials is enough for the local sign-out path.
    }
  }

  GOOGLE_STORE.delete('tokens');
  GOOGLE_STORE.delete('profile');
  clearCalendarBootstrapCache();

  return {
    success: true,
    configured: true,
    signedIn: false,
    profile: null
  };
}

function formatGoogleMailConversation(thread) {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const latestMessage = messages[messages.length - 1] || messages[0] || null;
  const headers = latestMessage?.payload?.headers || [];
  const internalDate = latestMessage?.internalDate ? new Date(Number(latestMessage.internalDate)) : new Date();
  const bodyText = extractBodyTextFromPayload(latestMessage?.payload);
  const htmlBody = extractHtmlBodyFromPayload(latestMessage?.payload);
  const attachments = Array.from(new Set(messages.flatMap((message) => collectAttachmentNames(message.payload, []))));
  const unread = messages.some((message) => Array.isArray(message.labelIds) && message.labelIds.includes('UNREAD'));
  const flagged = messages.some((message) => Array.isArray(message.labelIds) && message.labelIds.includes('STARRED'));

  return {
    id: thread.id,
    from: extractDisplayName(findHeader(headers, 'From')),
    to: findHeader(headers, 'To') || 'You',
    subject: findHeader(headers, 'Subject') || '(No subject)',
    preview: thread.snippet || splitIntoParagraphs(bodyText)[0],
    time: formatConversationTime(internalDate),
    dateLabel: formatConversationDateLabel(internalDate),
    unread,
    flagged,
    body: splitIntoParagraphs(bodyText),
    htmlBody,
    attachments,
    source: 'google',
    readOnly: true,
    sortTimestamp: internalDate.getTime(),
    invite: attachments.some((fileName) => /\.ics$/i.test(fileName))
      ? {
          time: 'Invitation attached',
          copy: 'This thread includes an iCalendar attachment.'
        }
      : null
  };
}

async function listMailThreads(authClient, labelIds) {
  const gmail = google.gmail({
    version: 'v1',
    auth: authClient
  });

  const listResponse = await gmail.users.threads.list({
    userId: 'me',
    labelIds,
    maxResults: 12
  });

  const threads = listResponse.data.threads || [];
  if (!threads.length) {
    return [];
  }

  const loadedThreads = await Promise.all(
    threads.map((thread) => gmail.users.threads.get({
      userId: 'me',
      id: thread.id,
      format: 'full'
    }))
  );

  return loadedThreads
    .map((response) => formatGoogleMailConversation(response.data || {}))
    .sort((left, right) => (right.sortTimestamp || 0) - (left.sortTimestamp || 0))
    .map(({ sortTimestamp, ...conversation }) => conversation);
}

async function getMailBootstrapData() {
  const status = await getAuthStatus();
  if (!status.signedIn) {
    return {
      success: false,
      configured: status.configured,
      requiresAuth: true,
      error: status.error || ''
    };
  }

  const authClient = await getAuthorizedClient();
  if (!authClient) {
    return {
      success: false,
      configured: true,
      requiresAuth: true,
      error: 'Google authentication is no longer available.'
    };
  }

  const gmail = google.gmail({
    version: 'v1',
    auth: authClient
  });

  const labelsResponse = await gmail.users.labels.list({
    userId: 'me'
  });
  const labels = labelsResponse.data.labels || [];
  const labelMap = new Map(labels.map((label) => [label.id, label]));

  const categoryResults = await Promise.all(
    GMAIL_CATEGORY_DEFINITIONS.map((definition) => listMailThreads(authClient, definition.labelIds))
  );
  const flagged = await listMailThreads(authClient, ['STARRED']);

  const folders = GMAIL_CATEGORY_DEFINITIONS.map((definition, index) => ({
    id: definition.id,
    label: definition.label,
    icon: definition.icon,
    parentId: definition.parentId || null,
    level: definition.level || 0,
    unreadCount: Number(labelMap.get(definition.unreadLabelId || definition.id)?.threadsUnread || 0)
  }));
  folders.push({
    id: 'flagged',
    label: 'Flagged',
    icon: 'view-flagged.png',
    parentId: null,
    level: 0,
    unreadCount: Number(labelMap.get('STARRED')?.threadsUnread || 0)
  });

  return {
    success: true,
    configured: true,
    readOnly: !hasScope(GMAIL_MODIFY_SCOPE),
    accounts: [
      {
        id: 'google',
        name: status.profile.displayName || 'Google',
        meta: 'Google account',
        address: status.profile.email || ''
      }
    ],
    folders,
    messages: Object.fromEntries([
      ...GMAIL_CATEGORY_DEFINITIONS.map((definition, index) => [definition.id, categoryResults[index] || []]),
      ['flagged', flagged]
    ])
  };
}

function normalizeThreadIds(payload) {
  return Array.from(new Set(
    (Array.isArray(payload?.threadIds) ? payload.threadIds : [])
      .map((threadId) => String(threadId || '').trim())
      .filter(Boolean)
  ));
}

async function applyMailAction(payload) {
  const status = await getAuthStatus();
  if (!status.signedIn) {
    return {
      success: false,
      configured: status.configured,
      requiresAuth: true,
      error: status.error || 'Google Mail must be connected before message actions are available.'
    };
  }

  if (!hasScope(GMAIL_MODIFY_SCOPE)) {
    return {
      success: false,
      configured: true,
      requiresReconnect: true,
      error: 'Google Mail needs to be reconnected to grant message editing access.'
    };
  }

  const action = String(payload?.action || '').trim();
  const threadIds = normalizeThreadIds(payload);
  if (!threadIds.length) {
    return {
      success: false,
      configured: true,
      error: 'At least one Gmail conversation is required.'
    };
  }

  const authClient = await getAuthorizedClient();
  if (!authClient) {
    return {
      success: false,
      configured: true,
      requiresAuth: true,
      error: 'Google authentication is no longer available.'
    };
  }

  const gmail = google.gmail({
    version: 'v1',
    auth: authClient
  });

  const applyThreadAction = async (threadId) => {
    switch (action) {
      case 'markRead':
        return gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: {
            removeLabelIds: ['UNREAD']
          }
        });
      case 'markUnread':
        return gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: {
            addLabelIds: ['UNREAD']
          }
        });
      case 'flag':
        return gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: {
            addLabelIds: ['STARRED']
          }
        });
      case 'unflag':
        return gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: {
            removeLabelIds: ['STARRED']
          }
        });
      case 'delete':
        return gmail.users.threads.trash({
          userId: 'me',
          id: threadId
        });
      default:
        throw new Error(`Unsupported Google Mail action: ${action}`);
    }
  };

  const results = await Promise.allSettled(threadIds.map((threadId) => applyThreadAction(threadId)));
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) {
    const firstError = failed[0]?.reason;
    const statusCode = firstError?.code || firstError?.response?.status || 0;
    if (statusCode === 401 || statusCode === 403) {
      return {
        success: false,
        configured: true,
        requiresReconnect: true,
        error: 'Google Mail needs to be reconnected before message changes can be applied.'
      };
    }

    return {
      success: false,
      configured: true,
      partialSuccess: failed.length < threadIds.length,
      completedCount: threadIds.length - failed.length,
      error: firstError?.message || 'A Gmail message action failed.'
    };
  }

  return {
    success: true,
    configured: true,
    action,
    threadIds,
    readOnly: false
  };
}

function formatCalendarTime(date) {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function normalizeCalendarEvent(event, calendarItem) {
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  const startDate = event.start?.dateTime
    ? new Date(event.start.dateTime)
    : event.start?.date
      ? new Date(`${event.start.date}T00:00:00`)
      : null;
  const endDate = event.end?.dateTime
    ? new Date(event.end.dateTime)
    : event.end?.date
      ? new Date(new Date(`${event.end.date}T00:00:00`).getTime() - 60 * 1000)
      : null;

  if (!startDate || Number.isNaN(startDate.valueOf())) {
    return null;
  }

  return {
    id: event.id,
    calendarId: calendarItem.id,
    calendarTitle: calendarItem.summary || calendarItem.id,
    color: event.backgroundColor || calendarItem.backgroundColor || null,
    date: startDate.toISOString().slice(0, 10),
    start: isAllDay ? '00:00' : formatCalendarTime(startDate),
    end: isAllDay
      ? '23:59'
      : formatCalendarTime(endDate && !Number.isNaN(endDate.valueOf()) ? endDate : new Date(startDate.getTime() + 60 * 60 * 1000)),
    title: event.summary || '(No title)',
    location: event.location || '',
    description: event.description || event.location || 'No details provided.',
    allDay: isAllDay,
    source: 'google'
  };
}

async function fetchCalendarBootstrapData(authClient, status) {
  const calendar = google.calendar({
    version: 'v3',
    auth: authClient
  });

  const calendarListResponse = await calendar.calendarList.list({
    minAccessRole: 'reader',
    showHidden: false,
    colorRgbFormat: true
  });

  const calendarItems = (calendarListResponse.data.items || []).filter((item) => item.selected !== false);
  const eventResponses = await Promise.all(calendarItems.map(async (item) => {
    try {
      const response = await calendar.events.list({
        calendarId: item.id,
        singleEvents: true,
        orderBy: 'startTime',
        timeMin: new Date().toISOString(),
        maxResults: 80,
        colorRgbFormat: true
      });
      return {
        item,
        events: response.data.items || []
      };
    } catch (error) {
      return {
        item,
        events: [],
        error
      };
    }
  }));

  const calendars = calendarItems.map((item) => ({
    id: item.id,
    title: item.summary || item.id,
    primary: Boolean(item.primary),
    color: item.backgroundColor || null
  }));

  const events = sortNormalizedCalendarEvents(
    eventResponses.flatMap(({ item, events }) => events.map((event) => normalizeCalendarEvent(event, item)).filter(Boolean))
  );

  return {
    success: true,
    configured: true,
    readOnly: !hasScope(CALENDAR_WRITE_SCOPE),
    profile: status.profile,
    calendars,
    events
  };
}

async function getCalendarBootstrapData(options = {}) {
  const status = await getAuthStatus();
  if (!status.signedIn) {
    clearCalendarBootstrapCache();
    return {
      success: false,
      configured: status.configured,
      requiresAuth: true,
      error: status.error || ''
    };
  }

  const forceRefresh = Boolean(options?.forceRefresh);
  const allowStale = options?.allowStale !== false;
  const cachedEntry = forceRefresh ? null : getCalendarBootstrapCache();
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return mergeCalendarBootstrapCachePayload(cachedEntry, {
      hit: true,
      stale: false
    });
  }

  const authClient = await getAuthorizedClient();
  if (!authClient) {
    return {
      success: false,
      configured: true,
      requiresAuth: true,
      error: 'Google authentication is no longer available.'
    };
  }

  try {
    const freshPayload = await fetchCalendarBootstrapData(authClient, status);
    const cacheEntry = setCalendarBootstrapCache(freshPayload);
    return mergeCalendarBootstrapCachePayload(cacheEntry, {
      hit: false,
      stale: false
    });
  } catch (error) {
    if (cachedEntry && allowStale) {
      return mergeCalendarBootstrapCachePayload(cachedEntry, {
        hit: true,
        stale: true
      });
    }

    return {
      success: false,
      configured: true,
      error: error?.message || 'Google Calendar data could not be loaded.'
    };
  }
}

function buildCalendarEventResource(payload) {
  const title = String(payload?.title || '').trim() || '(No title)';
  const location = String(payload?.location || '').trim();
  const description = String(payload?.description || '').trim();
  const timeZone = String(payload?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const allDay = Boolean(payload?.allDay);

  if (allDay) {
    const startDate = String(payload?.date || '').slice(0, 10);
    if (!startDate) {
      throw new Error('A valid event date is required.');
    }

    const endDateObject = new Date(`${startDate}T00:00:00`);
    endDateObject.setDate(endDateObject.getDate() + 1);
    const endDate = endDateObject.toISOString().slice(0, 10);

    return {
      summary: title,
      location,
      description,
      start: {
        date: startDate
      },
      end: {
        date: endDate
      }
    };
  }

  const startDateTime = String(payload?.startDateTime || '').trim();
  const endDateTime = String(payload?.endDateTime || '').trim();
  if (!startDateTime || !endDateTime) {
    throw new Error('Timed events require start and end times.');
  }

  return {
    summary: title,
    location,
    description,
    start: {
      dateTime: startDateTime,
      timeZone
    },
    end: {
      dateTime: endDateTime,
      timeZone
    }
  };
}

async function createCalendarEvent(payload) {
  const status = await getAuthStatus();
  if (!status.signedIn) {
    return {
      success: false,
      configured: status.configured,
      requiresAuth: true,
      error: status.error || 'Google Calendar is not connected.'
    };
  }

  if (!hasScope(CALENDAR_WRITE_SCOPE)) {
    return {
      success: false,
      configured: true,
      requiresReconnect: true,
      error: 'Reconnect Google Calendar to grant event creation access.'
    };
  }

  const authClient = await getAuthorizedClient();
  if (!authClient) {
    return {
      success: false,
      configured: true,
      requiresAuth: true,
      error: 'Google authentication is no longer available.'
    };
  }

  const calendarId = String(payload?.calendarId || 'primary').trim() || 'primary';
  const calendar = google.calendar({
    version: 'v3',
    auth: authClient
  });

  try {
    const resource = buildCalendarEventResource(payload);
    const response = await calendar.events.insert({
      calendarId,
      requestBody: resource,
      sendUpdates: 'none',
      colorRgbFormat: true
    });

    const insertedEvent = response.data || {};
    const calendarEntry = {
      id: calendarId,
      summary: payload?.calendarTitle || calendarId,
      backgroundColor: payload?.calendarColor || null
    };
    const normalizedEvent = normalizeCalendarEvent(insertedEvent, calendarEntry);
    if (normalizedEvent) {
      upsertCachedCalendarEvent(normalizedEvent, {
        id: calendarEntry.id,
        title: calendarEntry.summary || calendarEntry.id,
        color: calendarEntry.backgroundColor || null,
        primary: calendarId === 'primary'
      });
    }

    return {
      success: true,
      readOnly: false,
      event: normalizedEvent
    };
  } catch (error) {
    const statusCode = error?.code || error?.response?.status || 0;
    if (statusCode === 401 || statusCode === 403) {
      clearCalendarBootstrapCache();
      return {
        success: false,
        configured: true,
        requiresReconnect: true,
        error: 'Google Calendar needs to be reconnected before events can be created.'
      };
    }

    return {
      success: false,
      configured: true,
      error: error?.message || 'Google Calendar event creation failed.'
    };
  }
}

async function deleteCalendarEvent(payload) {
  const status = await getAuthStatus();
  if (!status.signedIn) {
    return {
      success: false,
      configured: status.configured,
      requiresAuth: true,
      error: status.error || 'Google Calendar is not connected.'
    };
  }

  if (!hasScope(CALENDAR_WRITE_SCOPE)) {
    return {
      success: false,
      configured: true,
      requiresReconnect: true,
      error: 'Reconnect Google Calendar to grant event removal access.'
    };
  }

  const authClient = await getAuthorizedClient();
  if (!authClient) {
    return {
      success: false,
      configured: true,
      requiresAuth: true,
      error: 'Google authentication is no longer available.'
    };
  }

  const calendarId = String(payload?.calendarId || 'primary').trim() || 'primary';
  const eventId = String(payload?.eventId || '').trim();
  if (!eventId) {
    return {
      success: false,
      configured: true,
      error: 'An event id is required to delete a calendar event.'
    };
  }

  const calendar = google.calendar({
    version: 'v3',
    auth: authClient
  });

  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: 'none'
    });
    removeCachedCalendarEvent(calendarId, eventId);

    return {
      success: true,
      readOnly: false
    };
  } catch (error) {
    const statusCode = error?.code || error?.response?.status || 0;
    if (statusCode === 401 || statusCode === 403) {
      clearCalendarBootstrapCache();
      return {
        success: false,
        configured: true,
        requiresReconnect: true,
        error: 'Google Calendar needs to be reconnected before events can be removed.'
      };
    }

    return {
      success: false,
      configured: true,
      error: error?.message || 'Google Calendar event removal failed.'
    };
  }
}

function registerGoogleWorkspaceHandlers() {
  ipcMain.handle('google-auth:get-status', async () => getAuthStatus());
  ipcMain.handle('google-auth:sign-in', async () => signIn());
  ipcMain.handle('google-auth:sign-out', async () => signOut());
  ipcMain.handle('google-mail:get-bootstrap-data', async () => getMailBootstrapData());
  ipcMain.handle('google-mail:apply-action', async (_event, payload) => applyMailAction(payload));
  ipcMain.handle('google-calendar:get-bootstrap-data', async (_event, options = {}) => getCalendarBootstrapData(options));
  ipcMain.handle('google-calendar:invalidate-cache', async () => {
    clearCalendarBootstrapCache();
    return { success: true };
  });
  ipcMain.handle('google-calendar:create-event', async (_event, payload) => createCalendarEvent(payload));
  ipcMain.handle('google-calendar:delete-event', async (_event, payload) => deleteCalendarEvent(payload));
}

module.exports = {
  registerGoogleWorkspaceHandlers
};
