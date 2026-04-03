/* Xbox Music - Recreated from Microsoft.ZuneMusic
   Uses the same IPC-based music library from electron-main.js */
(function () {
    'use strict';

    // ===== CONSTANTS =====
    const STORAGE_KEY = 'win8.music.libraryPath';
    const AUDIO_TYPE_HINTS = {
        '.aac': ['audio/aac'],
        '.flac': ['audio/flac', 'audio/x-flac'],
        '.m4a': ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4', 'audio/x-m4a'],
        '.mp3': ['audio/mpeg'],
        '.oga': ['audio/ogg'],
        '.ogg': ['audio/ogg'],
        '.opus': ['audio/ogg; codecs="opus"', 'audio/opus'],
        '.wav': ['audio/wav', 'audio/x-wav'],
        '.webm': ['audio/webm']
    };

    // ===== ELECTRON BRIDGE =====
    const electron = (() => {
        try {
            return require('electron');
        } catch (e) {
            console.warn('[Xbox Music] Electron bridge unavailable:', e);
            return null;
        }
    })();
    const ipcRenderer = electron?.ipcRenderer || null;

    // ===== ROOT & AUDIO =====
    const root = document.getElementById('xbox-music-app');
    if (!root) return;
    const audio = root.querySelector('#xbm-audio');

    // ===== STATE =====
    const state = {
        currentPage: 'collection',
        collectionTab: 'albums',
        loading: true,
        error: '',
        library: createEmptyLibrary(),
        libraryPath: localStorage.getItem(STORAGE_KEY) || '',
        currentTrack: null,
        queue: [],
        queueIndex: -1,
        rejectedTrackIds: new Set(),
        ignoreAudioError: false,
        preparingTrackId: '',
        shuffleOn: false,
        repeatOn: false
    };

    // ===== HELPERS =====
    function createEmptyLibrary(folderPath) {
        return {
            folderPath: folderPath || '',
            folderName: folderPath ? getFolderName(folderPath) : 'Music Library',
            trackCount: 0,
            albumCount: 0,
            artistCount: 0,
            tracks: [],
            albums: [],
            artists: [],
            scannedAt: null
        };
    }

    function getFolderName(folderPath) {
        if (!folderPath) return 'Music Library';
        const normalized = folderPath.replace(/[\\/]+$/, '');
        const segments = normalized.split(/[\\/]/).filter(Boolean);
        return segments[segments.length - 1] || normalized;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatTime(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
        const m = Math.floor(totalSeconds / 60);
        const s = Math.floor(totalSeconds % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function getArtHue(seed) {
        let hash = 0;
        const text = String(seed || 'Music');
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash) % 360;
    }

    function getInitials(label) {
        const parts = String(label || 'Music').split(/\s+/).filter(Boolean).slice(0, 2);
        return parts.length === 0 ? 'MU' : parts.map(p => p.charAt(0).toUpperCase()).join('');
    }

    function getTrackExtension(track) {
        if (track?.extension) return track.extension.toLowerCase();
        const src = track?.path || track?.relativePath || '';
        const dot = src.lastIndexOf('.');
        return dot < 0 ? '' : src.slice(dot).toLowerCase();
    }

    function formatTrackType(track) {
        const ext = getTrackExtension(track);
        return ext ? ext.slice(1).toUpperCase() : 'Unknown';
    }

    function canPlayTrackNatively(track) {
        if (!track || state.rejectedTrackIds.has(track.id)) return false;
        const ext = getTrackExtension(track);
        const hints = AUDIO_TYPE_HINTS[ext];
        if (!hints || typeof audio.canPlayType !== 'function') return true;
        return hints.some(h => audio.canPlayType(h) !== '');
    }

    function canQueueTrack(track) {
        return !!track && !state.rejectedTrackIds.has(track.id);
    }

    function getQueueableTracks(tracks) {
        return tracks.filter(canQueueTrack);
    }

    // ===== DIALOG =====
    function showDialog(type, message) {
        const dialog = window.systemDialog || window.parent?.systemDialog;
        const fn = dialog && typeof dialog[type] === 'function' ? dialog[type] : dialog?.error;
        if (fn) { fn.call(dialog, message, 'Xbox Music'); return; }
        console[type === 'warning' ? 'warn' : 'error']('[Xbox Music]', message);
    }

    function showError(msg) { showDialog('error', msg); }
    function showWarning(msg) { showDialog('warning', msg); }

    // ===== ARTWORK RENDERING =====
    function renderArtHtml(item, size, isCircle) {
        if (item.albumArtUrl) {
            return `<img src="${escapeHtml(item.albumArtUrl)}" alt="${escapeHtml(item.title || item.name || '')}" style="width:100%;height:100%;object-fit:cover;${isCircle ? 'border-radius:50%' : ''}">`;
        }
        const hue = getArtHue((item.title || item.name || '') + ' ' + (item.artist || ''));
        return `<div class="generic-art" style="background:hsl(${hue},35%,25%);${isCircle ? 'border-radius:50%' : ''}"><span class="music-icon">\u266B</span></div>`;
    }

    // ===== QUERY / FILTER =====
    function matchesQuery(text, query) {
        return text.toLowerCase().includes(query);
    }

    function getFilteredAlbums() {
        const q = (state.query || '').trim().toLowerCase();
        if (!q) return state.library.albums;
        return state.library.albums.filter(a =>
            matchesQuery(a.title + ' ' + a.artist, q) ||
            a.tracks.some(t => matchesQuery(t.title + ' ' + t.artist + ' ' + t.album, q))
        );
    }

    function getFilteredArtists() {
        const q = (state.query || '').trim().toLowerCase();
        if (!q) return state.library.artists;
        return state.library.artists.filter(a => matchesQuery(a.name, q));
    }

    function getFilteredTracks() {
        const q = (state.query || '').trim().toLowerCase();
        if (!q) return state.library.tracks;
        return state.library.tracks.filter(t => matchesQuery(t.title + ' ' + t.artist + ' ' + t.album, q));
    }

    function getAlbumById(id) {
        return state.library.albums.find(a => a.id === id) || null;
    }

    function getArtistById(id) {
        return state.library.artists.find(a => a.id === id) || null;
    }

    function getTrackById(id) {
        return state.library.tracks.find(t => t.id === id) || null;
    }

    function getArtistTracks(artistName) {
        return state.library.tracks.filter(t => t.artist.toLowerCase() === artistName.toLowerCase());
    }

    // ===== LIBRARY LOADING =====
    async function loadLibrary(preferredPath) {
        state.loading = true;
        state.error = '';
        renderAll();

        if (!ipcRenderer) {
            state.loading = false;
            state.error = 'The Electron IPC bridge is unavailable.';
            state.library = createEmptyLibrary();
            renderAll();
            return;
        }

        let folderPath = preferredPath || state.libraryPath;
        if (!folderPath) {
            const def = await ipcRenderer.invoke('music-library-get-default-folder');
            if (def?.success) folderPath = def.folderPath;
        }

        const result = await ipcRenderer.invoke('music-library-scan-folder', folderPath);
        state.loading = false;

        if (!result?.success) {
            state.error = result?.error || 'The music library could not be scanned.';
            state.library = createEmptyLibrary(folderPath);
            renderAll();
            return;
        }

        state.libraryPath = result.folderPath || '';
        localStorage.setItem(STORAGE_KEY, state.libraryPath);
        state.library = result.library || createEmptyLibrary(state.libraryPath);
        state.rejectedTrackIds.clear();
        state.preparingTrackId = '';

        if (state.currentTrack && !getTrackById(state.currentTrack.id)) {
            audio.pause();
            audio.removeAttribute('src');
            state.currentTrack = null;
            state.queue = [];
            state.queueIndex = -1;
        }

        renderAll();
    }

    async function chooseFolder() {
        if (!ipcRenderer) return;
        const result = await ipcRenderer.invoke('music-library-select-folder');
        if (result?.canceled || !result?.folderPath) return;
        await loadLibrary(result.folderPath);
    }

    // ===== PLAYBACK =====
    async function resolveTrackPlaybackSource(track) {
        if (canPlayTrackNatively(track)) {
            return { success: true, playbackSource: { fileUrl: track.fileUrl, transcoded: false } };
        }
        if (!ipcRenderer?.invoke) {
            return { success: false, error: 'Native playback is unavailable for this format and the FFmpeg bridge is not available.' };
        }
        return ipcRenderer.invoke('music-library-resolve-playback-source', {
            id: track.id, path: track.path, extension: track.extension || getTrackExtension(track)
        });
    }

    async function playQueueTrack(index) {
        const track = state.queue[index];
        if (!track) return;

        state.queueIndex = index;
        state.currentTrack = track;
        state.preparingTrackId = track.id;
        state.ignoreAudioError = false;
        updateTransportBar();
        renderNowPlayingPage();

        const source = await resolveTrackPlaybackSource(track);
        if (!source?.success || !source.playbackSource?.fileUrl) {
            state.rejectedTrackIds.add(track.id);
            state.currentTrack = null;
            state.preparingTrackId = '';
            showError(`Playback preparation failed for this ${formatTrackType(track)} file.\n\n${track.title}\n\n${source?.error || 'No playable source.'}`);
            updateTransportBar();
            return;
        }

        audio.src = source.playbackSource.fileUrl;
        try {
            await audio.play();
        } catch (err) {
            state.rejectedTrackIds.add(track.id);
            state.ignoreAudioError = true;
            state.preparingTrackId = '';
            showError(`Playback failed for ${track.title}\n\n${err.message}`);
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            state.currentTrack = null;

            const next = state.queue.findIndex((t, qi) => qi > index && canQueueTrack(t));
            if (next >= 0) { playQueueTrack(next); return; }
        }

        state.preparingTrackId = '';
        updateTransportBar();
        renderNowPlayingPage();
    }

    function setQueue(tracks, startIndex) {
        if (!Array.isArray(tracks) || tracks.length === 0) return;
        const queueable = getQueueableTracks(tracks);
        if (queueable.length === 0) {
            showWarning('All candidate tracks have failed playback preparation. Refresh the library to retry.');
            return;
        }
        const startTrack = tracks[startIndex] || queueable[0];
        const qi = Math.max(0, queueable.findIndex(t => t.id === startTrack.id));
        state.queue = queueable;
        playQueueTrack(qi);
    }

    function playAlbum(albumId) {
        const album = getAlbumById(albumId);
        if (!album) return;
        setQueue(album.tracks, 0);
    }

    function playArtist(artistId) {
        const artist = getArtistById(artistId);
        if (!artist) return;
        setQueue(getArtistTracks(artist.name), 0);
    }

    function playTrackById(trackId) {
        const track = getTrackById(trackId);
        if (!track) return;
        const tracks = getQueueableTracks(getFilteredTracks());
        const idx = tracks.findIndex(t => t.id === trackId);
        setQueue(idx >= 0 ? tracks : [track], idx >= 0 ? idx : 0);
    }

    function playFromQueue(index) {
        if (index >= 0 && index < state.queue.length) playQueueTrack(index);
    }

    function togglePlayPause() {
        if (!state.currentTrack) {
            const tracks = getQueueableTracks(getFilteredTracks());
            if (tracks.length > 0) setQueue(tracks, 0);
            return;
        }
        if (audio.paused) {
            audio.play().catch(err => showError('Playback could not resume.\n\n' + err.message));
        } else {
            audio.pause();
        }
    }

    function skipNext() {
        if (state.queue.length === 0) return;
        const next = state.queueIndex + 1;
        if (next < state.queue.length) playQueueTrack(next);
    }

    function skipPrev() {
        if (state.queue.length === 0) return;
        // If more than 3 seconds in, restart current track
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }
        const prev = state.queueIndex - 1;
        if (prev >= 0) playQueueTrack(prev);
    }

    function toggleShuffle() {
        state.shuffleOn = !state.shuffleOn;
        if (state.shuffleOn && state.queue.length > 1) {
            const current = state.queue[state.queueIndex];
            const rest = state.queue.filter((_, i) => i !== state.queueIndex);
            for (let i = rest.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [rest[i], rest[j]] = [rest[j], rest[i]];
            }
            state.queue = [current, ...rest];
            state.queueIndex = 0;
        }
        updateTransportBar();
    }

    function toggleRepeat() {
        state.repeatOn = !state.repeatOn;
        updateTransportBar();
    }

    // ===== NAVIGATION =====
    function navigateTo(page) {
        state.currentPage = page;
        root.querySelectorAll('.hub-nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
        });
        root.querySelectorAll('.hub-page').forEach(p => p.classList.remove('active'));
        const target = root.querySelector('#page-' + page);
        if (target) target.classList.add('active');

        const overlay = root.querySelector('#album-detail-overlay');
        if (overlay) overlay.classList.remove('visible');

        if (page === 'collection') renderCollectionPage();
        if (page === 'explore') renderExplorePage();
        if (page === 'radio') renderRadioPage();
        if (page === 'nowplaying') renderNowPlayingPage();
    }

    function setCollectionTab(tab) {
        state.collectionTab = tab;
        root.querySelectorAll('.collection-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        renderCollectionContent();
    }

    // ===== RENDERING =====
    function renderAll() {
        renderCollectionPage();
        renderExplorePage();
        renderRadioPage();
        renderNowPlayingPage();
        updateTransportBar();
    }

    function renderCollectionPage() {
        const container = root.querySelector('#collection-content');
        if (!container) return;

        if (state.loading) {
            container.innerHTML = `
                <div class="empty-collection">
                    <div class="empty-icon">\u266B</div>
                    <div class="empty-title">Scanning your music...</div>
                    <div class="empty-subtitle">Building your collection from the Music folder</div>
                </div>`;
            return;
        }

        if (state.library.trackCount === 0) {
            container.innerHTML = `
                <div class="empty-collection">
                    <div class="empty-icon">\u266B</div>
                    <div class="empty-title">${state.error ? escapeHtml(state.error) : 'Your collection is empty'}</div>
                    <div class="empty-subtitle">Add music files to your Music folder, or choose a different folder.</div>
                    <div style="margin-top: 20px; display: flex; gap: 10px;">
                        <button class="detail-action-btn primary" onclick="XboxMusic.refreshLibrary()">Scan music folder</button>
                        <button class="detail-action-btn" onclick="XboxMusic.chooseFolder()">Choose folder</button>
                    </div>
                </div>`;
            return;
        }

        renderCollectionContent();
    }

    function renderCollectionContent() {
        const container = root.querySelector('#collection-content');
        if (!container || state.library.trackCount === 0) return;

        if (state.collectionTab === 'albums') {
            renderAlbumGrid(container);
        } else if (state.collectionTab === 'artists') {
            renderArtistGrid(container);
        } else {
            renderSongsList(container);
        }
    }

    function renderAlbumGrid(container) {
        const albums = getFilteredAlbums();
        let html = '<div class="album-grid">';
        albums.forEach((album, i) => {
            html += `
                <div class="album-card" onclick="XboxMusic.openAlbum('${escapeHtml(album.id)}')" style="animation-delay:${Math.min(i * 0.02, 0.3)}s">
                    <div class="album-art">${renderArtHtml(album, 150, false)}</div>
                    <div class="album-title">${escapeHtml(album.title)}</div>
                    <div class="album-artist">${escapeHtml(album.artist)}</div>
                </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function renderArtistGrid(container) {
        const artists = getFilteredArtists();
        let html = '<div class="artist-grid">';
        artists.forEach((artist, i) => {
            html += `
                <div class="artist-card" onclick="XboxMusic.playArtist('${escapeHtml(artist.id)}')" style="animation-delay:${Math.min(i * 0.02, 0.3)}s">
                    <div class="artist-art">${renderArtHtml({ title: artist.name, artist: artist.name, albumArtUrl: artist.albumArtUrl }, 150, true)}</div>
                    <div class="artist-name">${escapeHtml(artist.name)}</div>
                </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function renderSongsList(container) {
        const tracks = getFilteredTracks();
        let html = `
            <div class="songs-list">
                <div class="songs-list-header">
                    <div>#</div>
                    <div>Title</div>
                    <div>Artist</div>
                    <div style="text-align:right">Album</div>
                </div>`;

        tracks.forEach((track, i) => {
            const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
            html += `
                <div class="song-row${isCurrent ? ' playing' : ''}" onclick="XboxMusic.playTrackById('${escapeHtml(track.id)}')">
                    <div class="song-track">${i + 1}</div>
                    <div class="song-title">${escapeHtml(track.title)}</div>
                    <div class="song-artist-name">${escapeHtml(track.artist)}</div>
                    <div class="song-duration">${escapeHtml(track.album)}</div>
                </div>`;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // ===== ALBUM DETAIL =====
    function openAlbum(albumId) {
        const album = getAlbumById(albumId);
        if (!album) return;

        const overlay = root.querySelector('#album-detail-overlay');
        let html = `
            <button class="back-button" onclick="XboxMusic.closeAlbumDetail()">\u2190</button>
            <div class="album-detail-header">
                <div class="album-detail-art">${renderArtHtml(album, 200, false)}</div>
                <div class="album-detail-info">
                    <div class="album-detail-title">${escapeHtml(album.title)}</div>
                    <div class="album-detail-artist">${escapeHtml(album.artist)}</div>
                    <div class="album-detail-meta">${album.trackCount} songs</div>
                    <div class="album-detail-actions">
                        <button class="detail-action-btn primary" onclick="XboxMusic.playAlbum('${escapeHtml(album.id)}')">Play album</button>
                    </div>
                </div>
            </div>
            <div class="songs-list">
                <div class="songs-list-header">
                    <div>#</div>
                    <div>Title</div>
                    <div>Artist</div>
                    <div style="text-align:right">Duration</div>
                </div>`;

        album.tracks.forEach((track, i) => {
            const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
            html += `
                <div class="song-row${isCurrent ? ' playing' : ''}" onclick="XboxMusic.playTrackById('${escapeHtml(track.id)}')">
                    <div class="song-track">${track.trackNumber || (i + 1)}</div>
                    <div class="song-title">${escapeHtml(track.title)}</div>
                    <div class="song-artist-name">${escapeHtml(track.artist)}</div>
                    <div class="song-duration"></div>
                </div>`;
        });

        html += '</div>';
        overlay.innerHTML = html;
        overlay.classList.add('visible');
    }

    function closeAlbumDetail() {
        root.querySelector('#album-detail-overlay').classList.remove('visible');
    }

    // ===== EXPLORE PAGE =====
    function renderExplorePage() {
        const container = root.querySelector('#explore-content');
        if (!container) return;

        if (state.loading || state.library.trackCount === 0) {
            container.innerHTML = '';
            return;
        }

        const albums = state.library.albums;
        const artists = state.library.artists;
        const featuredAlbum = albums.find(a => Boolean(a.albumArtUrl)) || albums[0];
        const topArtists = artists.slice(0, 3).map(a => a.name).join(', ') || 'Various Artists';

        let html = `
            <div class="explore-featured">
                <div class="featured-card" ${featuredAlbum ? `onclick="XboxMusic.playAlbum('${escapeHtml(featuredAlbum.id)}')"` : ''}>
                    <div class="featured-card-title">${featuredAlbum ? escapeHtml(featuredAlbum.title) : 'Your Library'}</div>
                    <div class="featured-card-subtitle">${featuredAlbum ? escapeHtml(featuredAlbum.artist) : 'Start listening'}</div>
                </div>
                <div class="featured-card">
                    <div class="featured-card-title">Your Collection</div>
                    <div class="featured-card-subtitle">${state.library.trackCount} songs \u2022 ${state.library.albumCount} albums</div>
                </div>
                <div class="featured-card">
                    <div class="featured-card-title">Top Artists</div>
                    <div class="featured-card-subtitle">${escapeHtml(topArtists)}</div>
                </div>
            </div>

            <div class="explore-section">
                <div class="section-header">Recently Added</div>
                <div class="album-grid">`;

        albums.slice(0, 10).forEach((album, i) => {
            html += `
                <div class="album-card" onclick="XboxMusic.openAlbum('${escapeHtml(album.id)}')">
                    <div class="album-art">${renderArtHtml(album, 150, false)}</div>
                    <div class="album-title">${escapeHtml(album.title)}</div>
                    <div class="album-artist">${escapeHtml(album.artist)}</div>
                </div>`;
        });

        html += '</div></div>';

        if (albums.length > 10) {
            html += `<div class="explore-section"><div class="section-header">More Albums</div><div class="album-grid">`;
            albums.slice(10, 20).forEach(album => {
                html += `
                    <div class="album-card" onclick="XboxMusic.openAlbum('${escapeHtml(album.id)}')">
                        <div class="album-art">${renderArtHtml(album, 150, false)}</div>
                        <div class="album-title">${escapeHtml(album.title)}</div>
                        <div class="album-artist">${escapeHtml(album.artist)}</div>
                    </div>`;
            });
            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    // ===== RADIO PAGE =====
    function renderRadioPage() {
        const container = root.querySelector('#radio-content');
        if (!container) return;

        if (state.loading || state.library.artistCount === 0) {
            container.innerHTML = `
                <div class="section-subheader">Radio stations are built from artists in your collection</div>
                <div class="empty-collection" style="height:40%">
                    <div class="empty-icon">\u266B</div>
                    <div class="empty-subtitle">Add music to your library to create radio stations</div>
                </div>`;
            return;
        }

        const artists = state.library.artists;
        let html = `<div class="section-subheader">Artist stations based on your collection \u2022 ${artists.length} available</div><div class="radio-grid">`;

        artists.forEach(artist => {
            const hue = getArtHue(artist.name);
            html += `
                <div class="radio-card" style="background:hsl(${hue},40%,28%)" onclick="XboxMusic.playArtist('${escapeHtml(artist.id)}')">
                    <div class="radio-card-name">${escapeHtml(artist.name)} Radio</div>
                    <div class="radio-card-desc">${artist.trackCount} songs</div>
                </div>`;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // ===== NOW PLAYING =====
    function renderNowPlayingPage() {
        const page = root.querySelector('#page-nowplaying');
        if (!page) return;

        if (!state.currentTrack) {
            page.innerHTML = `
                <div class="empty-collection">
                    <div class="empty-icon">\u266B</div>
                    <div class="empty-title">Nothing playing</div>
                    <div class="empty-subtitle">Select a song from your collection to start listening</div>
                </div>`;
            return;
        }

        const track = state.currentTrack;
        let html = `
            <div class="now-playing-page">
                <div class="now-playing-art-area">
                    <div class="now-playing-album-art">${renderArtHtml(track, 300, false)}</div>
                </div>
                <div class="now-playing-info-area">
                    <div class="now-playing-song-title">${escapeHtml(track.title)}</div>
                    <div class="now-playing-artist-name">${escapeHtml(track.artist)}</div>
                    <div class="now-playing-album-name">${escapeHtml(track.album)}</div>
                    <div class="now-playing-playlist">`;

        state.queue.forEach((t, i) => {
            html += `
                <div class="np-playlist-item${i === state.queueIndex ? ' active' : ''}" onclick="XboxMusic.playFromQueue(${i})">
                    <div class="np-item-title">${escapeHtml(t.title)}</div>
                    <div class="np-item-artist">${escapeHtml(t.artist)}</div>
                </div>`;
        });

        html += '</div></div></div>';
        page.innerHTML = html;
    }

    // ===== TRANSPORT BAR =====
    function updateTransportBar() {
        const bar = root.querySelector('#transport-bar');
        if (!bar) return;

        if (state.currentTrack) {
            bar.classList.add('visible');
            const track = state.currentTrack;

            bar.querySelector('.transport-song').textContent = track.title;
            bar.querySelector('.transport-artist').textContent = track.artist;

            // Update art
            const artDiv = bar.querySelector('.transport-art');
            if (track.albumArtUrl) {
                artDiv.innerHTML = `<img src="${escapeHtml(track.albumArtUrl)}" style="width:100%;height:100%;object-fit:cover">`;
            } else {
                const hue = getArtHue(track.title + ' ' + track.artist);
                artDiv.innerHTML = `<div class="generic-art" style="background:hsl(${hue},35%,25%)"><span class="music-icon">\u266B</span></div>`;
            }
        }

        // Play/pause icon
        const playBtn = root.querySelector('#btn-play-pause');
        if (playBtn) {
            playBtn.textContent = (!audio.paused && state.currentTrack) ? '\u23F8' : '\u25B6';
        }

        // Shuffle/repeat state
        const shuffleBtn = root.querySelector('#btn-shuffle');
        if (shuffleBtn) shuffleBtn.classList.toggle('active', state.shuffleOn);
        const repeatBtn = root.querySelector('#btn-repeat');
        if (repeatBtn) repeatBtn.classList.toggle('active', state.repeatOn);

        // Update seek display
        updateSeekDisplay();
    }

    function updateSeekDisplay() {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

        const fill = root.querySelector('#seek-bar-fill');
        const posEl = root.querySelector('#seek-position');
        const durEl = root.querySelector('#seek-duration');

        if (fill) fill.style.width = (duration > 0 ? (currentTime / duration) * 100 : 0) + '%';
        if (posEl) posEl.textContent = formatTime(currentTime);
        if (durEl) durEl.textContent = formatTime(duration);
    }

    // ===== EVENT BINDING =====
    function init() {
        // Navigation
        root.querySelectorAll('.hub-nav-item').forEach(el => {
            el.addEventListener('click', () => navigateTo(el.dataset.page));
        });

        // Collection tabs
        root.querySelectorAll('.collection-tab').forEach(el => {
            el.addEventListener('click', () => setCollectionTab(el.dataset.tab));
        });

        // Seek bar click
        const seekBar = root.querySelector('#seek-bar');
        if (seekBar) {
            seekBar.addEventListener('click', (e) => {
                if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
                const rect = seekBar.getBoundingClientRect();
                audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
                updateSeekDisplay();
            });
        }

        // Volume bar click
        const volBar = root.querySelector('.volume-bar');
        if (volBar) {
            volBar.addEventListener('click', (e) => {
                const rect = volBar.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                audio.volume = pct;
                volBar.querySelector('.volume-bar-fill').style.width = (pct * 100) + '%';
            });
        }

        // Audio events
        audio.addEventListener('play', updateTransportBar);
        audio.addEventListener('pause', updateTransportBar);
        audio.addEventListener('timeupdate', updateSeekDisplay);
        audio.addEventListener('loadedmetadata', updateTransportBar);
        audio.addEventListener('ended', () => {
            if (state.repeatOn) {
                audio.currentTime = 0;
                audio.play();
                return;
            }
            if (state.queueIndex + 1 < state.queue.length) {
                playQueueTrack(state.queueIndex + 1);
                return;
            }
            updateTransportBar();
        });
        audio.addEventListener('error', () => {
            if (state.ignoreAudioError) {
                state.ignoreAudioError = false;
                state.preparingTrackId = '';
                updateTransportBar();
                return;
            }
            if (state.currentTrack) {
                state.rejectedTrackIds.add(state.currentTrack.id);
                const failed = state.currentTrack;
                state.currentTrack = null;
                state.preparingTrackId = '';
                showError(`Playback failed for ${failed.title}\n\nThe audio element could not load the source.`);
            }
            updateTransportBar();
        });

        // Initial render + load library
        renderAll();
        loadLibrary();
    }

    // ===== PUBLIC API =====
    window.XboxMusic = {
        openAlbum,
        closeAlbumDetail,
        playAlbum,
        playArtist,
        playTrackById,
        playFromQueue,
        togglePlayPause,
        skipNext,
        skipPrev,
        toggleShuffle,
        toggleRepeat,
        refreshLibrary: () => loadLibrary(),
        chooseFolder
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
