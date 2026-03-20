(function () {
    const root = document.getElementById('music-app');
    if (!root) {
        return;
    }

    const mainContent = root.querySelector('#music-main-content');
    const libraryList = root.querySelector('#music-sidebar-library');
    const playlistList = root.querySelector('#music-sidebar-playlists');
    const folderLabel = root.querySelector('#music-folder-label');
    const searchInput = root.querySelector('#music-search');
    const searchButton = root.querySelector('.music-search-button');
    const audio = root.querySelector('#music-audio');
    const progressInput = root.querySelector('#music-progress');
    const volumeInput = root.querySelector('#music-volume');
    const currentTimeLabel = root.querySelector('#music-current-time');
    const totalTimeLabel = root.querySelector('#music-total-time');
    const nowPlaying = root.querySelector('#music-now-playing');
    const playPauseButton = root.querySelector('#music-play-pause');

    const STORAGE_KEY = 'win8.music.libraryPath';
    const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"></path></svg>';
    const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"></path></svg>';
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

    const electron = (() => {
        try {
            return require('electron');
        } catch (error) {
            console.warn('[Music] Electron bridge unavailable:', error);
            return null;
        }
    })();

    const ipcRenderer = electron?.ipcRenderer || null;

    const state = {
        view: 'explore',
        collectionTab: 'albums',
        query: '',
        loading: true,
        error: '',
        library: createEmptyLibrary(),
        libraryPath: localStorage.getItem(STORAGE_KEY) || '',
        currentTrack: null,
        queue: [],
        queueIndex: -1,
        rejectedTrackIds: new Set(),
        ignoreAudioError: false,
        preparingTrackId: ''
    };

    function createEmptyLibrary(folderPath = '') {
        return {
            folderPath,
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
        if (!folderPath) {
            return 'Music Library';
        }

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
        if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
            return '0:00';
        }

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    function getArtHue(seed) {
        let hash = 0;
        const text = String(seed || 'Music');
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) - hash) + text.charCodeAt(index);
            hash |= 0;
        }
        return Math.abs(hash) % 360;
    }

    function getInitials(label) {
        const parts = String(label || 'Music')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2);

        if (parts.length === 0) {
            return 'MU';
        }

        return parts.map(part => part.charAt(0).toUpperCase()).join('');
    }

    function showDialog(type, message) {
        const dialog = window.systemDialog || window.parent?.systemDialog;
        const dialogMethod = dialog && typeof dialog[type] === 'function'
            ? dialog[type]
            : dialog?.error;

        if (dialogMethod) {
            dialogMethod.call(dialog, message, 'Music');
            return;
        }

        console[type === 'warning' ? 'warn' : 'error']('[Music]', message);
    }

    function showError(message) {
        showDialog('error', message);
    }

    function showWarning(message) {
        showDialog('warning', message);
    }

    function getTrackExtension(track) {
        if (track?.extension) {
            return track.extension.toLowerCase();
        }

        const source = track?.path || track?.relativePath || '';
        const lastDot = source.lastIndexOf('.');
        if (lastDot < 0) {
            return '';
        }

        return source.slice(lastDot).toLowerCase();
    }

    function formatTrackType(track) {
        const extension = getTrackExtension(track);
        return extension ? extension.slice(1).toUpperCase() : 'Unknown';
    }

    function canPlayTrackNatively(track) {
        if (!track || state.rejectedTrackIds.has(track.id)) {
            return false;
        }

        const extension = getTrackExtension(track);
        const hints = AUDIO_TYPE_HINTS[extension];
        if (!hints || typeof audio.canPlayType !== 'function') {
            return true;
        }

        return hints.some(hint => audio.canPlayType(hint) !== '');
    }

    function canQueueTrack(track) {
        return !!track && !state.rejectedTrackIds.has(track.id);
    }

    function getQueueableTracks(tracks) {
        return tracks.filter(track => canQueueTrack(track));
    }

    function showTranscodeFailureMessage(track, errorMessage) {
        const format = formatTrackType(track);
        showError(`Playback preparation failed for this ${format} file.\n\n${track.title}\n\n${errorMessage}`);
    }

    function matchesTrack(track, query) {
        const haystack = [
            track.title,
            track.artist,
            track.album,
            track.relativePath
        ].join(' ').toLowerCase();

        return haystack.includes(query);
    }

    function getFilteredTracks() {
        const query = state.query.trim().toLowerCase();
        if (!query) {
            return state.library.tracks;
        }

        return state.library.tracks.filter(track => matchesTrack(track, query));
    }

    function getFilteredAlbums() {
        const query = state.query.trim().toLowerCase();
        if (!query) {
            return state.library.albums;
        }

        return state.library.albums.filter(album => {
            if (`${album.title} ${album.artist}`.toLowerCase().includes(query)) {
                return true;
            }

            return album.tracks.some(track => matchesTrack(track, query));
        });
    }

    function getFilteredArtists() {
        const query = state.query.trim().toLowerCase();
        if (!query) {
            return state.library.artists;
        }

        const matchingArtistIds = new Set(getFilteredTracks().map(track => track.artist.toLowerCase()));
        return state.library.artists.filter(artist =>
            artist.name.toLowerCase().includes(query) || matchingArtistIds.has(artist.id)
        );
    }

    function getAlbumById(albumId) {
        return state.library.albums.find(album => album.id === albumId) || null;
    }

    function getArtistById(artistId) {
        return state.library.artists.find(artist => artist.id === artistId) || null;
    }

    function getTrackById(trackId) {
        return state.library.tracks.find(track => track.id === trackId) || null;
    }

    function getArtistTracks(artistName) {
        return state.library.tracks.filter(track => track.artist.toLowerCase() === artistName.toLowerCase());
    }

    function renderArtwork(item, modifierClass = '') {
        const label = `${item.title || item.name || 'Music'} ${item.artist || ''}`.trim();
        if (item.albumArtUrl) {
            return `
                <div class="music-card-art ${modifierClass}">
                    <img src="${escapeHtml(item.albumArtUrl)}" alt="${escapeHtml(label)}">
                </div>
            `;
        }

        const hue = getArtHue(label);
        return `
            <div class="music-card-art ${modifierClass}">
                <div class="music-art-fallback" style="--music-art-hue:${hue}">
                    <span>${escapeHtml(getInitials(item.title || item.name || item.artist || 'Music'))}</span>
                </div>
            </div>
        `;
    }

    function renderSidebarLists() {
        folderLabel.textContent = state.library.folderPath
            ? `${state.library.folderName} - ${state.library.trackCount} songs`
            : 'Music Library';

        libraryList.innerHTML = `
            <div class="music-sidebar-item music-sidebar-item--ghost">
                <span>${escapeHtml(state.library.albumCount)} albums</span>
                <span>${escapeHtml(state.library.artistCount)} artists</span>
            </div>
            <div class="music-sidebar-item music-sidebar-item--ghost">
                <span>${escapeHtml(state.library.trackCount)} songs</span>
                <span>${escapeHtml(state.library.scannedAt ? 'ready' : 'idle')}</span>
            </div>
        `;

        const featuredArtists = state.library.artists.slice(0, 5);
        if (featuredArtists.length === 0) {
            playlistList.innerHTML = `
                <div class="music-sidebar-item music-sidebar-item--ghost">
                    <span>Recently added</span>
                    <span>0</span>
                </div>
                <div class="music-sidebar-item music-sidebar-item--ghost">
                    <span>Running mix</span>
                    <span>0</span>
                </div>
            `;
            return;
        }

        playlistList.innerHTML = `
            <div class="music-sidebar-item music-sidebar-item--ghost">
                <span>Recently added</span>
                <span>${escapeHtml(Math.min(state.library.tracks.length, 12))}</span>
            </div>
            ${featuredArtists.map(artist => `
                <button type="button" class="music-sidebar-item" data-play-artist="${escapeHtml(artist.id)}">
                    <span>${escapeHtml(artist.name)}</span>
                    <span>${escapeHtml(artist.trackCount)}</span>
                </button>
            `).join('')}
        `;
    }

    function renderLoadingView() {
        mainContent.innerHTML = `
            <div class="music-loading-state">
                <div class="music-loading-panel">
                    <div class="music-loading-title">Building your collection</div>
                    <div class="music-loading-copy">Scanning the host Music folder and grouping albums, artists, and songs for the new Metro-style app shell.</div>
                </div>
            </div>
        `;
    }

    function renderEmptyView() {
        const copy = state.error
            ? escapeHtml(state.error)
            : 'No supported tracks were found in this library yet. Point the app at your Music folder, or choose another folder with MP3, M4A, FLAC, WAV, OGG, or OPUS files.';

        mainContent.innerHTML = `
            <div class="music-empty-state">
                <div class="music-empty-panel">
                    <div class="music-empty-title">Your collection is empty</div>
                    <div class="music-empty-copy">${copy}</div>
                    <div class="music-empty-actions">
                        <button type="button" class="music-primary-button" data-action="refresh-library">Scan music folder</button>
                        <button type="button" class="music-secondary-button" data-action="choose-folder">Choose another folder</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderCollectionView() {
        const albums = getFilteredAlbums();
        const artists = getFilteredArtists();
        const tracks = getFilteredTracks();

        let content = '';
        if (state.collectionTab === 'albums') {
            content = `
                <div class="music-grid">
                    ${albums.map(album => `
                        <button type="button" class="music-card" data-play-album="${escapeHtml(album.id)}">
                            ${renderArtwork(album)}
                            <div class="music-card-title">${escapeHtml(album.title)}</div>
                            <div class="music-card-subtitle">${escapeHtml(album.artist)}</div>
                        </button>
                    `).join('')}
                </div>
            `;
        } else if (state.collectionTab === 'artists') {
            content = `
                <div class="music-artist-grid">
                    ${artists.map(artist => `
                        <button type="button" class="music-artist-card" data-play-artist="${escapeHtml(artist.id)}">
                            ${renderArtwork({ title: artist.name, artist: artist.name, albumArtUrl: artist.albumArtUrl }, 'music-card-art--artist')}
                            <div class="music-card-title">${escapeHtml(artist.name)}</div>
                            <div class="music-card-subtitle">${escapeHtml(`${artist.albumCount} albums - ${artist.trackCount} songs`)}</div>
                        </button>
                    `).join('')}
                </div>
            `;
        } else {
            content = `
                <div class="music-song-list">
                    ${tracks.map(track => `
                        <div class="music-song-row">
                            <div class="music-song-primary">
                                <div class="music-song-title">${escapeHtml(track.title)}</div>
                                <div class="music-song-detail">${escapeHtml(track.relativePath)}</div>
                            </div>
                            <div class="music-song-detail">${escapeHtml(track.artist)}</div>
                            <div class="music-song-detail">${escapeHtml(track.album)}</div>
                            <button type="button" class="music-inline-button ${canQueueTrack(track) ? '' : 'is-disabled'}" data-play-track="${escapeHtml(track.id)}" ${canQueueTrack(track) ? '' : 'disabled'}>Play</button>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        mainContent.innerHTML = `
            <section>
                <div class="music-page-header">
                    <div>
                        <div class="music-page-title">Collection</div>
                        <div class="music-page-subtitle">${escapeHtml(`${tracks.length} songs - ${albums.length} albums - ${artists.length} artists`)}</div>
                    </div>
                    <div class="music-section-meta">${escapeHtml(state.library.folderName)}</div>
                </div>

                <div class="music-toolbar">
                    <button type="button" class="music-pill ${state.collectionTab === 'albums' ? 'is-active' : ''}" data-collection-tab="albums">Albums</button>
                    <button type="button" class="music-pill ${state.collectionTab === 'artists' ? 'is-active' : ''}" data-collection-tab="artists">Artists</button>
                    <button type="button" class="music-pill ${state.collectionTab === 'songs' ? 'is-active' : ''}" data-collection-tab="songs">Songs</button>
                    <div class="music-toolbar-copy">93 in the cloud - By date added</div>
                </div>

                ${content}
            </section>
        `;
    }

    function renderExploreView() {
        const albums = getFilteredAlbums();
        const tracks = getFilteredTracks();
        const artists = getFilteredArtists();
        const featuredAlbum = albums.find(album => Boolean(album.albumArtUrl)) || albums[0] || null;
        const heroArtists = artists.slice(0, 3).map(artist => artist.name).join(', ') || 'Linkin Park, Deadmau5, and more';
        const heroStyle = featuredAlbum?.albumArtUrl
            ? ` style="background-image: linear-gradient(90deg, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0.42) 36%, rgba(0, 0, 0, 0.16) 100%), url('${encodeURI(featuredAlbum.albumArtUrl)}');"`
            : '';

        const albumRail = albums.slice(0, 8);
        const songRail = tracks.slice(0, 8);

        mainContent.innerHTML = `
            <section class="music-hero"${heroStyle}>
                <div class="music-hero-copy">
                    <div class="music-hero-kicker">Most Popular</div>
                    <div class="music-hero-title">This <span>Week</span></div>
                    <div class="music-hero-text">${escapeHtml(featuredAlbum ? featuredAlbum.title : 'Collection Preview')}</div>
                    <div class="music-hero-subtext">Check out this week's top artists: ${escapeHtml(heroArtists)}.</div>
                </div>
            </section>

            <section class="music-scroll-section">
                <div class="music-section-header">
                    <div>
                        <div class="music-section-title">New Music</div>
                        <div class="music-section-meta">Pulled directly from the host Music folder.</div>
                    </div>
                    <div class="music-section-meta">View all</div>
                </div>
                <div class="music-scroll-row">
                    ${albumRail.map(album => `
                        <button type="button" class="music-card" data-play-album="${escapeHtml(album.id)}">
                            ${renderArtwork(album)}
                            <div class="music-card-title">${escapeHtml(album.title)}</div>
                            <div class="music-card-subtitle">${escapeHtml(album.artist)}</div>
                        </button>
                    `).join('')}
                </div>
            </section>

            <section class="music-scroll-section">
                <div class="music-section-header">
                    <div>
                        <div class="music-section-title">Top Songs</div>
                        <div class="music-section-meta">Quick access to the newest tracks we found.</div>
                    </div>
                </div>
                <div class="music-song-list">
                    ${songRail.map(track => `
                        <div class="music-song-row">
                            <div class="music-song-primary">
                                <div class="music-song-title">${escapeHtml(track.title)}</div>
                                <div class="music-song-detail">${escapeHtml(track.artist)}</div>
                            </div>
                            <div class="music-song-detail">${escapeHtml(track.album)}</div>
                            <div class="music-song-detail">${escapeHtml(track.modifiedAt ? new Date(track.modifiedAt).toLocaleDateString() : 'Recently added')}</div>
                            <button type="button" class="music-inline-button ${canQueueTrack(track) ? '' : 'is-disabled'}" data-play-track="${escapeHtml(track.id)}" ${canQueueTrack(track) ? '' : 'disabled'}>Play</button>
                        </div>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderRadioView() {
        const artists = getFilteredArtists().slice(0, 8);
        mainContent.innerHTML = `
            <section>
                <div class="music-page-header">
                    <div>
                        <div class="music-page-title">Radio</div>
                        <div class="music-page-subtitle">Artist-led mixes based on the music we found in your library.</div>
                    </div>
                    <div class="music-section-meta">${escapeHtml(state.library.artistCount)} stations ready</div>
                </div>

                <div class="music-station-grid">
                    ${artists.map(artist => `
                        <button type="button" class="music-station-card" data-play-artist="${escapeHtml(artist.id)}">
                            ${renderArtwork({ title: artist.name, artist: artist.name, albumArtUrl: artist.albumArtUrl }, 'music-card-art--artist')}
                            <div class="music-card-title">${escapeHtml(artist.name)} Radio</div>
                            <div class="music-card-subtitle">${escapeHtml(`${artist.trackCount} songs from your collection`)}</div>
                        </button>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderMainContent() {
        root.querySelectorAll('.music-nav-item').forEach(button => {
            button.classList.toggle('is-active', button.getAttribute('data-view') === state.view);
        });

        renderSidebarLists();

        if (state.loading) {
            renderLoadingView();
            return;
        }

        if (state.library.trackCount === 0) {
            renderEmptyView();
            return;
        }

        if (state.view === 'collection') {
            renderCollectionView();
            return;
        }

        if (state.view === 'radio') {
            renderRadioView();
            return;
        }

        renderExploreView();
    }

    function updatePlayer() {
        const track = state.currentTrack;
        playPauseButton.innerHTML = !audio.paused && track ? PAUSE_ICON : PLAY_ICON;
        playPauseButton.setAttribute('aria-label', !audio.paused && track ? 'Pause' : 'Play');

        if (!track) {
            nowPlaying.innerHTML = `
                <div class="music-now-playing-art"></div>
                <div>
                    <div class="music-now-playing-title">Nothing playing</div>
                    <div class="music-now-playing-subtitle">Select an album, artist, or track from your library.</div>
                </div>
            `;
            currentTimeLabel.textContent = '0:00';
            totalTimeLabel.textContent = '0:00';
            progressInput.value = '0';
            return;
        }

        nowPlaying.innerHTML = `
            <div class="music-now-playing-art">
                ${track.albumArtUrl
                    ? `<img src="${escapeHtml(track.albumArtUrl)}" alt="${escapeHtml(track.title)}">`
                    : `<div class="music-art-fallback" style="--music-art-hue:${getArtHue(track.title + track.artist)}"><span>${escapeHtml(getInitials(track.title))}</span></div>`}
            </div>
            <div>
                <div class="music-now-playing-title">${escapeHtml(track.title)}</div>
                <div class="music-now-playing-subtitle">${escapeHtml(state.preparingTrackId === track.id ? `Preparing playback - ${track.artist} - ${track.album}` : `${track.artist} - ${track.album}`)}</div>
            </div>
        `;

        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        currentTimeLabel.textContent = formatTime(currentTime);
        totalTimeLabel.textContent = formatTime(duration);

        if (duration > 0) {
            progressInput.value = String(Math.round((currentTime / duration) * 1000));
        } else {
            progressInput.value = '0';
        }
    }

    async function resolveTrackPlaybackSource(track) {
        if (canPlayTrackNatively(track)) {
            return {
                success: true,
                playbackSource: {
                    fileUrl: track.fileUrl,
                    transcoded: false
                }
            };
        }

        if (!ipcRenderer?.invoke) {
            return {
                success: false,
                error: 'Native playback is unavailable for this file format, and the FFmpeg bridge is not available.'
            };
        }

        return ipcRenderer.invoke('music-library-resolve-playback-source', {
            id: track.id,
            path: track.path,
            extension: track.extension || getTrackExtension(track)
        });
    }

    async function playQueueTrack(index) {
        const nextTrack = state.queue[index];
        if (!nextTrack) {
            return;
        }

        state.queueIndex = index;
        state.currentTrack = nextTrack;
        state.preparingTrackId = nextTrack.id;
        state.ignoreAudioError = false;
        updatePlayer();

        const resolvedSource = await resolveTrackPlaybackSource(nextTrack);
        if (!resolvedSource?.success || !resolvedSource.playbackSource?.fileUrl) {
            state.rejectedTrackIds.add(nextTrack.id);
            state.currentTrack = null;
            state.preparingTrackId = '';
            showTranscodeFailureMessage(nextTrack, resolvedSource?.error || 'No playable source was returned.');
            updatePlayer();
            return;
        }

        audio.src = resolvedSource.playbackSource.fileUrl;

        try {
            await audio.play();
        } catch (error) {
            state.rejectedTrackIds.add(nextTrack.id);
            state.ignoreAudioError = true;
            state.preparingTrackId = '';
            showTranscodeFailureMessage(nextTrack, error.message);
            console.error('[Music] Playback failed:', error);
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            state.currentTrack = null;

            const nextPlayableIndex = state.queue.findIndex((track, queueIndex) =>
                queueIndex > index && canQueueTrack(track)
            );

            if (nextPlayableIndex >= 0) {
                playQueueTrack(nextPlayableIndex);
                return;
            }
        }

        state.preparingTrackId = '';
        updatePlayer();
    }

    function setQueue(tracks, startIndex) {
        if (!Array.isArray(tracks) || tracks.length === 0) {
            return;
        }

        const queueableTracks = getQueueableTracks(tracks);
        if (queueableTracks.length === 0) {
            showWarning('Playback is unavailable because all candidate tracks have already failed preparation in this session. Refresh the library to retry.');
            return;
        }

        const startingTrack = tracks[startIndex] || queueableTracks[0];
        const queueableIndex = Math.max(0, queueableTracks.findIndex(track => track.id === startingTrack.id));

        state.queue = queueableTracks;
        playQueueTrack(queueableIndex);
    }

    function playAlbum(albumId) {
        const album = getAlbumById(albumId);
        if (!album) {
            return;
        }

        setQueue(album.tracks, 0);
    }

    function playArtist(artistId) {
        const artist = getArtistById(artistId);
        if (!artist) {
            return;
        }

        const tracks = getArtistTracks(artist.name);
        setQueue(tracks, 0);
    }

    function playTrack(trackId) {
        const track = getTrackById(trackId);
        if (!track) {
            return;
        }

        const tracks = getQueueableTracks(getFilteredTracks());
        const trackIndex = tracks.findIndex(entry => entry.id === trackId);
        setQueue(trackIndex >= 0 ? tracks : [track], trackIndex >= 0 ? trackIndex : 0);
    }

    function togglePlayback() {
        if (!state.currentTrack) {
            const tracks = getQueueableTracks(getFilteredTracks());
            if (tracks.length > 0) {
                setQueue(tracks, 0);
            } else if (state.library.tracks.length > 0) {
                showWarning('Playback is unavailable because all discovered tracks have already failed preparation in this session. Refresh the library to retry.');
            }
            return;
        }

        if (audio.paused) {
            audio.play().catch(error => {
                showError(`Playback could not resume.\n\n${error.message}`);
            });
        } else {
            audio.pause();
        }
    }

    function stepQueue(direction) {
        if (state.queue.length === 0) {
            return;
        }

        const nextIndex = state.queueIndex + direction;
        if (nextIndex < 0 || nextIndex >= state.queue.length) {
            return;
        }

        playQueueTrack(nextIndex);
    }

    async function loadLibrary(preferredPath = '') {
        state.loading = true;
        state.error = '';
        renderMainContent();

        if (!ipcRenderer) {
            state.loading = false;
            state.error = 'The Electron IPC bridge is unavailable in this app host.';
            state.library = createEmptyLibrary();
            renderMainContent();
            return;
        }

        let folderPath = preferredPath || state.libraryPath;
        if (!folderPath) {
            const defaultFolder = await ipcRenderer.invoke('music-library-get-default-folder');
            if (defaultFolder?.success) {
                folderPath = defaultFolder.folderPath;
            }
        }

        const result = await ipcRenderer.invoke('music-library-scan-folder', folderPath);
        state.loading = false;

        if (!result?.success) {
            state.error = result?.error || 'The music library could not be scanned.';
            state.library = createEmptyLibrary(folderPath);
            renderMainContent();
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

        renderMainContent();
        updatePlayer();
    }

    async function chooseFolder() {
        if (!ipcRenderer) {
            return;
        }

        const result = await ipcRenderer.invoke('music-library-select-folder');
        if (result?.canceled || !result?.folderPath) {
            return;
        }

        await loadLibrary(result.folderPath);
    }

    function handleClick(event) {
        const target = event.target.closest('button');
        if (!target) {
            return;
        }

        const nextView = target.getAttribute('data-view');
        if (nextView) {
            state.view = nextView;
            renderMainContent();
            return;
        }

        const collectionTab = target.getAttribute('data-collection-tab');
        if (collectionTab) {
            state.collectionTab = collectionTab;
            renderMainContent();
            return;
        }

        const albumId = target.getAttribute('data-play-album');
        if (albumId) {
            playAlbum(albumId);
            return;
        }

        const artistId = target.getAttribute('data-play-artist');
        if (artistId) {
            playArtist(artistId);
            return;
        }

        const trackId = target.getAttribute('data-play-track');
        if (trackId) {
            playTrack(trackId);
            return;
        }

        switch (target.getAttribute('data-action')) {
            case 'refresh-library':
                loadLibrary();
                break;
            case 'choose-folder':
                chooseFolder();
                break;
            case 'toggle-playback':
                togglePlayback();
                break;
            case 'previous-track':
                stepQueue(-1);
                break;
            case 'next-track':
                stepQueue(1);
                break;
            default:
                break;
        }
    }

    function bindEvents() {
        root.addEventListener('click', handleClick);
        searchInput.addEventListener('input', () => {
            state.query = searchInput.value || '';
            renderMainContent();
        });
        searchButton.addEventListener('click', () => {
            searchInput.focus();
        });
        progressInput.addEventListener('input', () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
                return;
            }

            audio.currentTime = (Number(progressInput.value) / 1000) * audio.duration;
            updatePlayer();
        });
        volumeInput.addEventListener('input', () => {
            audio.volume = Number(volumeInput.value) / 100;
        });
        audio.addEventListener('play', updatePlayer);
        audio.addEventListener('pause', updatePlayer);
        audio.addEventListener('timeupdate', updatePlayer);
        audio.addEventListener('loadedmetadata', updatePlayer);
        audio.addEventListener('ended', () => {
            if (state.queueIndex + 1 < state.queue.length) {
                playQueueTrack(state.queueIndex + 1);
                return;
            }

            updatePlayer();
        });
        audio.addEventListener('error', () => {
            if (state.ignoreAudioError) {
                state.ignoreAudioError = false;
                state.preparingTrackId = '';
                updatePlayer();
                return;
            }

            if (state.currentTrack) {
                state.rejectedTrackIds.add(state.currentTrack.id);
                const failedTrack = state.currentTrack;
                state.currentTrack = null;
                state.preparingTrackId = '';
                showTranscodeFailureMessage(failedTrack, 'The media element could not load the prepared source.');
            }
            updatePlayer();
        });
    }

    function init() {
        audio.volume = Number(volumeInput.value) / 100;
        bindEvents();
        renderMainContent();
        updatePlayer();
        loadLibrary();
    }

    init();
})();
