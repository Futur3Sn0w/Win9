(function () {
    'use strict';

    /* ================================================================
       Bing Weather – Windows 9 Recreation
       Uses Open-Meteo (free, no API key) for weather data.
       Leaflet + CartoDB dark tiles for the Maps cluster.
       ================================================================ */

    const STORAGE_KEY = 'modern-weather-state-v1';
    const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
    const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
    const HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';
    const APP_BASE = 'apps/modern/weather/';

    // WMO weather code → description & icon mapping
    const WMO_CODES = {
        0:  { caption: 'Clear sky',                     day: '1',       night: '1b'     },
        1:  { caption: 'Mainly clear',                  day: '1',       night: '1b'     },
        2:  { caption: 'Partly cloudy',                 day: '34_33',   night: '34_33'  },
        3:  { caption: 'Overcast',                      day: '26',      night: '26'     },
        45: { caption: 'Fog',                           day: '20',      night: '20b'    },
        48: { caption: 'Depositing rime fog',           day: '20c',     night: '20c'    },
        51: { caption: 'Light drizzle',                 day: '9',       night: '9b'     },
        53: { caption: 'Moderate drizzle',              day: '9',       night: '9b'     },
        55: { caption: 'Dense drizzle',                 day: '9c',      night: '9c'     },
        56: { caption: 'Freezing drizzle',              day: '9c',      night: '9c'     },
        57: { caption: 'Heavy freezing drizzle',        day: '9c',      night: '9c'     },
        61: { caption: 'Slight rain',                   day: '9',       night: '9b'     },
        63: { caption: 'Moderate rain',                 day: '11',      night: '11'     },
        65: { caption: 'Heavy rain',                    day: '12',      night: '12'     },
        66: { caption: 'Light freezing rain',           day: '25',      night: '25b'    },
        67: { caption: 'Heavy freezing rain',           day: '25',      night: '25b'    },
        71: { caption: 'Slight snow fall',              day: '19',      night: '19b'    },
        73: { caption: 'Moderate snow fall',            day: '19c',     night: '19c'    },
        75: { caption: 'Heavy snow fall',               day: '43',      night: '43'     },
        77: { caption: 'Snow grains',                   day: '19',      night: '19b'    },
        80: { caption: 'Slight rain showers',           day: '9',       night: '9b'     },
        81: { caption: 'Moderate rain showers',         day: '11',      night: '11'     },
        82: { caption: 'Violent rain showers',          day: '12',      night: '12'     },
        85: { caption: 'Slight snow showers',           day: '19',      night: '19b'    },
        86: { caption: 'Heavy snow showers',            day: '43',      night: '43'     },
        95: { caption: 'Thunderstorm',                  day: '17',      night: '17'     },
        96: { caption: 'Thunderstorm with slight hail', day: '17',      night: '17'     },
        99: { caption: 'Thunderstorm with heavy hail',  day: '17',      night: '17'     }
    };

    const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

    function uvDescription(uv) {
        if (uv <= 2)  return 'Low';
        if (uv <= 5)  return 'Moderate';
        if (uv <= 7)  return 'High';
        if (uv <= 10) return 'Very High';
        return 'Extreme';
    }

    function windDirection(deg) {
        if (deg == null) return '';
        return WIND_DIRS[Math.round(deg / 22.5) % 16];
    }

    function skycodePath(code, isDay, size) {
        size = size || '89x89';
        const info = WMO_CODES[code] || WMO_CODES[0];
        const iconFile = isDay ? info.day : info.night;
        return `${APP_BASE}resources/skycodes/${size}/${iconFile}.png`;
    }

    function formatTime12(isoStr) {
        const d = new Date(isoStr);
        let h = d.getHours();
        const m = d.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m} ${ampm}`;
    }

    function formatTimeShort(isoStr) {
        const d = new Date(isoStr);
        let h = d.getHours();
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h} ${ampm}`;
    }

    function getThemeClass(code, isDay) {
        if (!isDay) return 'weather-theme--night';
        if ([95, 96, 99].includes(code)) return 'weather-theme--storm';
        if ([61, 63, 65, 66, 67, 80, 81, 82, 51, 53, 55, 56, 57].includes(code)) return 'weather-theme--rain';
        if ([71, 73, 75, 77, 85, 86].includes(code)) return 'weather-theme--snow';
        if ([3, 45, 48].includes(code)) return 'weather-theme--cloudy';
        return 'weather-theme--day';
    }

    function escapeHtml(str) {
        const el = document.createElement('span');
        el.textContent = str || '';
        return el.innerHTML;
    }

    /* ================================================================
       State
       ================================================================ */
    const root = document.getElementById('weather-app');
    if (!root) { console.error('[Weather] #weather-app not found'); return; }

    const $ = (sel) => root.querySelector(sel);
    const $$ = (sel) => Array.from(root.querySelectorAll(sel));

    let state = loadState();
    let weatherData = null;
    let currentSection = 'home';
    let appBarTimeout = null;

    // Hero slider state
    let heroSlide = 1; // 1 or 2

    // Places selection
    let selectedPlaces = new Set();

    // Leaflet map
    let leafletMap = null;
    let leafletMarker = null;

    // World weather
    let worldZoomedContinent = null;
    const worldCityWeatherCache = {};

    // Historical
    let historicalData = null;
    let historicalChart = 'temperature';
    let historicalSelectedMonth = new Date().getMonth();

    const els = {
        navTabs:           $$('.weather-navbar__tab'),
        searchInput:       $('#weather-search-input'),
        searchBtn:         $('#weather-search-btn'),
        suggestions:       $('#weather-suggestions'),
        home:              $('#weather-home'),
        loading:           $('#weather-loading'),
        error:             $('#weather-error'),
        errorMessage:      $('#weather-error-message'),
        retryBtn:          $('#weather-retry-btn'),
        panoramaContent:   $('#weather-panorama-content'),
        locationName:      $('#weather-location-name'),
        lastUpdated:       $('#weather-last-updated'),
        tempToggle:        $('#weather-temp-toggle'),
        tempValue:         $('#weather-temp-value'),
        tempUnit:          $('#weather-temp-unit'),
        caption:           $('#weather-caption'),
        feelslike:         $('#weather-feelslike'),
        heroIcon:          $('#weather-hero-icon'),
        wind:              $('#weather-wind'),
        humidity:          $('#weather-humidity'),
        pressure:          $('#weather-pressure'),
        uv:                $('#weather-uv'),
        alert:             $('#weather-alert'),
        alertText:         $('#weather-alert-text'),
        heroSlide1:        $('#weather-hero-slide1'),
        heroSlide2:        $('#weather-hero-slide2'),
        heroSlideBtn:      $('#weather-hero-slide-btn'),
        heroSlideArrow:    $('#weather-hero-slide-arrow'),
        dailyStrip:        $('#weather-daily-strip'),
        dailyPrecip:       $('#weather-daily-precip'),
        hourly:            $('#weather-hourly'),
        sunrise:           $('#weather-sunrise'),
        sunset:            $('#weather-sunset'),
        visibility:        $('#weather-visibility'),
        dewpoint:          $('#weather-dewpoint'),
        precipChart:       $('#weather-precip-chart'),
        historicalChart:   $('#weather-historical-chart'),
        historicalMonths:  $('#weather-historical-months'),
        historicalDetail:  $('#weather-historical-detail'),
        historicalTabs:    $$('.weather-historical__tab'),
        world:             $('#weather-world'),
        worldMap:          $('#weather-world-map'),
        worldContinentImg: $('#weather-world-continent-img'),
        worldCities:       $('#weather-world-cities'),
        worldPanelHeader:  $('#weather-world-panel-header'),
        worldPanelList:    $('#weather-world-panel-list'),
        dailyForecast:     $('#weather-dailyforecast'),
        dfTitle:           $('#weather-df-title'),
        dfClusters:        $('#weather-df-clusters'),
        places:            $('#weather-places'),
        placesSubtitle:    $('#weather-places-subtitle'),
        placesGrid:        $('#weather-places-grid'),
        appbar:            $('#weather-appbar'),
        appbarUnitIcon:    $('#weather-appbar-unit-icon'),
        appbarUnitLabel:   $('#weather-appbar-unit-label')
    };

    /* ================================================================
       Initialization
       ================================================================ */
    initialize();

    function initialize() {
        attachEvents();
        attachHeroSliderEvent();
        attachAppBarEvents();
        attachHistoricalEvents();
        attachWorldEvents();
        registerSettingsWithCharms();
        if (state.currentLocation) {
            fetchWeather(state.currentLocation);
        } else {
            tryGeolocation();
        }
    }

    /* ================================================================
       Navigation
       ================================================================ */
    function renderNavigation(dailyForecastTargetDay) {
        els.navTabs.forEach(tab => {
            const isActive = tab.dataset.section === currentSection;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', isActive);
        });

        const sections = {
            home:         els.home,
            dailyforecast: els.dailyForecast,
            places:       els.places,
            worldweather: els.world
        };
        for (const [key, el] of Object.entries(sections)) {
            if (el) el.hidden = key !== currentSection;
        }

        if (currentSection === 'dailyforecast') {
            renderDailyForecastPage(dailyForecastTargetDay);
        }
        if (currentSection === 'places') {
            selectedPlaces.clear();
            updatePlacesSelectionUI();
            renderPlaces();
        }
        if (currentSection === 'worldweather') {
            renderWorldWeather();
        }
        // Invalidate Leaflet map when returning to home
        if (currentSection === 'home' && leafletMap) {
            setTimeout(() => leafletMap.invalidateSize(), 150);
        }
    }

    /* ================================================================
       Events
       ================================================================ */
    function attachEvents() {
        // Nav tabs
        els.navTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                currentSection = tab.dataset.section;
                renderNavigation();
            });
        });

        // Search
        let searchTimeout = null;
        els.searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const q = els.searchInput.value.trim();
            if (q.length < 2) { els.suggestions.hidden = true; return; }
            searchTimeout = setTimeout(() => searchLocations(q), 300);
        });
        els.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = els.searchInput.value.trim();
                if (q.length >= 2) searchLocations(q);
            } else if (e.key === 'Escape') {
                els.suggestions.hidden = true;
            }
        });
        els.searchBtn.addEventListener('click', () => {
            const q = els.searchInput.value.trim();
            if (q.length >= 2) searchLocations(q);
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.weather-navbar__search')) {
                els.suggestions.hidden = true;
            }
        });

        // Temp unit toggle
        if (els.tempToggle) {
            els.tempToggle.addEventListener('click', () => {
                state.useFahrenheit = !state.useFahrenheit;
                persistState();
                if (weatherData) fetchWeather(state.currentLocation);
            });
        }

        // Retry
        if (els.retryBtn) {
            els.retryBtn.addEventListener('click', () => {
                if (state.currentLocation) fetchWeather(state.currentLocation);
                else tryGeolocation();
            });
        }
    }

    /* ================================================================
       Hero Slider (ccSlider1 / ccSlider2 equivalent)
       ================================================================ */
    function attachHeroSliderEvent() {
        if (els.heroSlideBtn) {
            els.heroSlideBtn.addEventListener('click', toggleHeroSlide);
        }
    }

    function toggleHeroSlide() {
        heroSlide = heroSlide === 1 ? 2 : 1;
        applyHeroSlide();
    }

    function applyHeroSlide() {
        if (els.heroSlide1) els.heroSlide1.classList.toggle('is-active', heroSlide === 1);
        if (els.heroSlide2) els.heroSlide2.classList.toggle('is-active', heroSlide === 2);
        if (els.heroSlideArrow) {
            // Forward arrow when on slide 1, back arrow when on slide 2
            els.heroSlideArrow.innerHTML = heroSlide === 1 ? '&#x276F;' : '&#x276E;';
        }
    }

    /* ================================================================
       Bottom App Bar
       ================================================================ */
    function attachAppBarEvents() {
        root.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.weather-appbar')) return;
            e.preventDefault();
            toggleAppBar();
        });
        root.addEventListener('click', (e) => {
            if (!e.target.closest('.weather-appbar') && els.appbar && !els.appbar.hidden) {
                // Only auto-hide if not in places selection mode
                if (selectedPlaces.size === 0) hideAppBar();
            }
        });
        if (els.appbar) {
            els.appbar.addEventListener('click', (e) => {
                const btn = e.target.closest('.weather-appbar__btn');
                if (!btn) return;
                const action = btn.dataset.action;
                switch (action) {
                    case 'refresh':
                        if (state.currentLocation) fetchWeather(state.currentLocation);
                        hideAppBar();
                        break;
                    case 'current-location':
                        tryGeolocation();
                        hideAppBar();
                        break;
                    case 'toggle-unit':
                        state.useFahrenheit = !state.useFahrenheit;
                        persistState();
                        updateAppBarUnit();
                        if (weatherData) fetchWeather(state.currentLocation);
                        hideAppBar();
                        break;
                    case 'add-favorite':
                        if (state.currentLocation) {
                            const exists = state.places.some(p =>
                                Math.abs(p.latitude - state.currentLocation.latitude) < 0.01 &&
                                Math.abs(p.longitude - state.currentLocation.longitude) < 0.01
                            );
                            if (!exists) {
                                state.places.push({ ...state.currentLocation });
                                persistState();
                            }
                        }
                        hideAppBar();
                        break;
                    case 'set-home':
                        // Current location already is home — no-op in this context
                        hideAppBar();
                        break;
                    case 'pin':
                        hideAppBar();
                        break;
                    case 'remove-places':
                        removSelectedPlaces();
                        break;
                    case 'set-default-place':
                        setDefaultFromSelection();
                        break;
                    case 'clear-selection':
                        selectedPlaces.clear();
                        updatePlacesSelectionUI();
                        hideAppBar();
                        break;
                }
            });
        }
    }

    function toggleAppBar() {
        if (!els.appbar) return;
        if (els.appbar.hidden) showAppBar(); else hideAppBar();
    }

    function showAppBar() {
        if (!els.appbar) return;
        els.appbar.hidden = false;
        updateAppBarUnit();
        // Update contextual button visibility based on current section + selection
        updatePlacesSelectionUI();
        clearTimeout(appBarTimeout);
        // Don't auto-hide if in selection mode
        if (selectedPlaces.size === 0) {
            appBarTimeout = setTimeout(hideAppBar, 5000);
        }
    }

    function hideAppBar() {
        if (!els.appbar) return;
        // Don't hide if places are selected
        if (selectedPlaces.size > 0) return;
        els.appbar.hidden = true;
        clearTimeout(appBarTimeout);
    }

    function updateAppBarUnit() {
        if (els.appbarUnitIcon) els.appbarUnitIcon.innerHTML = state.useFahrenheit ? '&#xE150;' : '&#xE151;';
        if (els.appbarUnitLabel) els.appbarUnitLabel.textContent = state.useFahrenheit ? 'Celsius' : 'Fahrenheit';
    }

    /* ================================================================
       Places Selection Mode
       ================================================================ */
    function updatePlacesSelectionUI() {
        const hasSelection = selectedPlaces.size > 0;
        const isPlaces = currentSection === 'places';

        // Standard left buttons: visible when not in selection mode or not on places
        $$('.weather-appbar__btn--standard').forEach(btn => {
            btn.hidden = isPlaces && hasSelection;
        });
        // Places selection buttons: visible only when in selection mode on places
        $$('.weather-appbar__btn--places').forEach(btn => {
            btn.hidden = !(isPlaces && hasSelection);
        });

        // Update all place tile selection rings
        root.querySelectorAll('.weather-place-tile[data-place-index]').forEach(tile => {
            const idx = parseInt(tile.dataset.placeIndex);
            tile.classList.toggle('is-selected', selectedPlaces.has(idx));
        });

        // Update subtitle
        if (els.placesSubtitle) {
            if (isPlaces && hasSelection) {
                els.placesSubtitle.textContent = `${selectedPlaces.size} selected`;
            } else {
                els.placesSubtitle.textContent = 'Saved locations';
            }
        }

        // Show/keep app bar while selection active
        if (isPlaces && hasSelection && els.appbar) {
            els.appbar.hidden = false;
            clearTimeout(appBarTimeout);
        }
    }

    function removSelectedPlaces() {
        const indices = Array.from(selectedPlaces).sort((a, b) => b - a);
        indices.forEach(i => state.places.splice(i, 1));
        selectedPlaces.clear();
        persistState();
        updatePlacesSelectionUI();
        renderPlaces();
        if (state.places.length === 0) {
            els.appbar.hidden = true;
        }
    }

    function setDefaultFromSelection() {
        const firstIdx = Array.from(selectedPlaces).sort()[0];
        if (firstIdx !== undefined && state.places[firstIdx]) {
            state.currentLocation = { ...state.places[firstIdx] };
            persistState();
            selectedPlaces.clear();
            updatePlacesSelectionUI();
            currentSection = 'home';
            renderNavigation();
            fetchWeather(state.currentLocation);
        }
    }

    /* ================================================================
       Geolocation
       ================================================================ */
    async function tryGeolocation() {
        try {
            const ipRes = await fetch('https://ipapi.co/json/');
            if (ipRes.ok) {
                const ipData = await ipRes.json();
                if (ipData.latitude && ipData.longitude) {
                    const loc = {
                        name: [ipData.city, ipData.region].filter(Boolean).join(', ') || 'Current Location',
                        latitude: ipData.latitude,
                        longitude: ipData.longitude,
                        country: ipData.country_name || ''
                    };
                    state.currentLocation = loc;
                    persistState();
                    fetchWeather(loc);
                    return;
                }
            }
        } catch (e) { /* fall through */ }

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const loc = { name: 'Current Location', latitude: pos.coords.latitude, longitude: pos.coords.longitude, country: '' };
                    reverseGeocode(loc.latitude, loc.longitude).then(name => {
                        loc.name = name || 'Current Location';
                        state.currentLocation = loc;
                        persistState();
                        fetchWeather(loc);
                    });
                },
                () => useFallbackLocation(),
                { timeout: 3000 }
            );
        } else {
            useFallbackLocation();
        }
    }

    function useFallbackLocation() {
        const seattle = { name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321, country: 'United States' };
        state.currentLocation = seattle;
        persistState();
        fetchWeather(seattle);
    }

    async function reverseGeocode(lat, lon) {
        try {
            const res = await fetch(`${GEOCODE_URL}?latitude=${lat}&longitude=${lon}&count=1`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const r = data.results[0];
                return r.admin1 ? `${r.name}, ${r.admin1}` : r.name;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /* ================================================================
       Location Search
       ================================================================ */
    async function searchLocations(query) {
        try {
            const res = await fetch(`${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=8&language=en`);
            const data = await res.json();
            renderSuggestions(data.results || []);
        } catch (e) {
            renderSuggestions([]);
        }
    }

    function renderSuggestions(results) {
        if (!results.length) { els.suggestions.hidden = true; return; }
        els.suggestions.innerHTML = results.map((r, i) => {
            const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
            return `<div class="weather-suggestions__item" data-index="${i}">${escapeHtml(label)}</div>`;
        }).join('');
        els.suggestions.hidden = false;

        els.suggestions.querySelectorAll('.weather-suggestions__item').forEach((item, i) => {
            item.addEventListener('click', () => {
                const r = results[i];
                const loc = {
                    name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    country: r.country || ''
                };
                state.currentLocation = loc;
                persistState();
                els.searchInput.value = '';
                els.suggestions.hidden = true;
                currentSection = 'home';
                renderNavigation();
                fetchWeather(loc);
            });
        });
    }

    /* ================================================================
       Weather Data Fetch
       ================================================================ */
    async function fetchWeather(location) {
        showLoading();
        try {
            const params = new URLSearchParams({
                latitude: location.latitude,
                longitude: location.longitude,
                current: [
                    'temperature_2m','relative_humidity_2m','apparent_temperature',
                    'is_day','precipitation','rain','showers','snowfall',
                    'weather_code','cloud_cover','pressure_msl',
                    'surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m'
                ].join(','),
                hourly: [
                    'temperature_2m','relative_humidity_2m','dew_point_2m',
                    'apparent_temperature','precipitation_probability','precipitation',
                    'weather_code','visibility','wind_speed_10m','wind_direction_10m',
                    'uv_index','is_day'
                ].join(','),
                daily: [
                    'weather_code','temperature_2m_max','temperature_2m_min',
                    'apparent_temperature_max','apparent_temperature_min',
                    'sunrise','sunset','uv_index_max',
                    'precipitation_sum','precipitation_probability_max',
                    'wind_speed_10m_max','wind_direction_10m_dominant'
                ].join(','),
                temperature_unit: state.useFahrenheit ? 'fahrenheit' : 'celsius',
                wind_speed_unit:  state.useFahrenheit ? 'mph' : 'kmh',
                precipitation_unit: state.useFahrenheit ? 'inch' : 'mm',
                timezone: 'auto',
                forecast_days: 10
            });

            const res = await fetch(`${WEATHER_URL}?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            weatherData = await res.json();
            weatherData._location = location;
            weatherData._fetchedAt = new Date().toISOString();

            showContent();
            renderWeather();
        } catch (err) {
            showError(err.message || 'Failed to load weather data');
        }
    }

    /* ================================================================
       Render – Main
       ================================================================ */
    function renderWeather() {
        if (!weatherData) return;
        try {
            const current = weatherData.current;
            const hourly  = weatherData.hourly;
            const daily   = weatherData.daily;
            const loc     = weatherData._location;
            const isDay   = !!current.is_day;
            const code    = current.weather_code;

            // Theme
            root.className = 'weather-app ' + getThemeClass(code, isDay);

            // Location name
            if (els.locationName) els.locationName.textContent = loc.name;
            if (els.lastUpdated)  els.lastUpdated.textContent  = 'Updated ' + formatTime12(weatherData._fetchedAt);
            if (els.dfTitle)      els.dfTitle.textContent      = loc.name;

            // Current temp
            const temp     = Math.round(current.temperature_2m);
            const feelsLike = Math.round(current.apparent_temperature);
            const unit     = state.useFahrenheit ? 'F' : 'C';
            if (els.tempValue) els.tempValue.textContent = temp;
            if (els.tempUnit)  els.tempUnit.textContent  = unit;

            const wmoInfo = WMO_CODES[code] || WMO_CODES[0];
            if (els.caption)   els.caption.textContent   = wmoInfo.caption;
            if (els.feelslike) els.feelslike.textContent = `Feels like ${feelsLike}\u00B0`;

            // Hero icon
            if (els.heroIcon) {
                els.heroIcon.src = skycodePath(code, isDay, '89x89');
                els.heroIcon.alt = wmoInfo.caption;
            }

            // Slide 2 properties: Wind, Humidity, Pressure, UV
            const windSpeed = Math.round(current.wind_speed_10m);
            const windUnit  = state.useFahrenheit ? 'mph' : 'km/h';
            const windDir   = windDirection(current.wind_direction_10m);
            if (els.wind)     els.wind.textContent     = `${windDir} ${windSpeed} ${windUnit}`;
            if (els.humidity) els.humidity.textContent = `${current.relative_humidity_2m}%`;
            if (els.pressure) els.pressure.textContent = `${Math.round(current.pressure_msl)} mb`;

            const uvRaw = (daily.uv_index_max && daily.uv_index_max[0] != null) ? daily.uv_index_max[0] : null;
            const uvVal = uvRaw != null ? Math.round(uvRaw) : '--';
            if (els.uv) els.uv.textContent = `${uvVal}${uvVal !== '--' ? ' ' + uvDescription(uvVal) : ''}`;

            // Sun & atmosphere cluster
            if (els.sunrise && daily.sunrise && daily.sunrise[0]) {
                els.sunrise.textContent = formatTime12(daily.sunrise[0]);
            }
            if (els.sunset && daily.sunset && daily.sunset[0]) {
                els.sunset.textContent = formatTime12(daily.sunset[0]);
            }

            // Current hour index for visibility / dew point
            const nowIso    = current.time || new Date().toISOString();
            const nowHour   = new Date(nowIso).getHours();
            const todayStr  = nowIso.slice(0, 10);
            let currentHourIdx = 0;
            if (hourly && hourly.time) {
                for (let i = 0; i < hourly.time.length; i++) {
                    if (hourly.time[i].startsWith(todayStr) && new Date(hourly.time[i]).getHours() === nowHour) {
                        currentHourIdx = i; break;
                    }
                }
            }
            if (els.visibility && hourly.visibility && hourly.visibility[currentHourIdx] != null) {
                const visKm = hourly.visibility[currentHourIdx] / 1000;
                els.visibility.textContent = state.useFahrenheit
                    ? `${(visKm * 0.621371).toFixed(1)} mi`
                    : `${visKm.toFixed(1)} km`;
            }
            if (els.dewpoint && hourly.dew_point_2m && hourly.dew_point_2m[currentHourIdx] != null) {
                els.dewpoint.textContent = `${Math.round(hourly.dew_point_2m[currentHourIdx])}\u00B0${unit}`;
            }

            // Alert (extreme UV)
            if (els.alert) {
                if (uvVal !== '--' && uvVal >= 8) {
                    els.alert.hidden = false;
                    if (els.alertText) els.alertText.textContent = `\u26A0 UV Index is ${uvVal} (${uvDescription(uvVal)}) \u2013 Protect yourself from sun exposure`;
                } else {
                    els.alert.hidden = true;
                }
            }

            // Clusters
            if (els.dailyStrip)  renderDailyStrip(daily);
            if (els.hourly)      renderHourly(hourly, currentHourIdx);
            if (els.precipChart) renderPrecipChart(daily);

            // Leaflet map
            initWeatherMap(loc, temp, code, isDay);

            // Historical (async)
            if (els.historicalChart && loc) {
                fetchHistoricalWeather(loc).catch(err => console.warn('[Weather] Historical fetch failed:', err));
            }

        } catch (renderErr) {
            console.error('[Weather] renderWeather error:', renderErr);
        }
    }

    /* ================================================================
       Daily Strip (Cluster 001 – forecast strip, clickable)
       ================================================================ */
    function renderDailyStrip(daily) {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let html = '';
        let precipHtml = '';
        const count = Math.min(7, daily.time.length);
        for (let i = 0; i < count; i++) {
            const d = new Date(daily.time[i] + 'T12:00:00');
            const dayLabel = i === 0 ? 'Today' : days[d.getDay()];
            const code = daily.weather_code[i];
            const hi   = Math.round(daily.temperature_2m_max[i]);
            const lo   = Math.round(daily.temperature_2m_min[i]);
            const icon = skycodePath(code, true, '30x30');
            const precipProb = daily.precipitation_probability_max[i];
            html += `
                <div class="weather-daily-strip__day" data-day-index="${i}" role="button" tabindex="0" title="See ${dayLabel}'s full forecast">
                    <span class="weather-daily-strip__label">${dayLabel}</span>
                    <img class="weather-daily-strip__icon" src="${icon}" alt="${(WMO_CODES[code] || WMO_CODES[0]).caption}" draggable="false">
                    <span class="weather-daily-strip__temps">
                        <span class="weather-daily-strip__high">${hi}\u00B0</span>
                        <span class="weather-daily-strip__sep">/</span>
                        <span class="weather-daily-strip__low">${lo}\u00B0</span>
                    </span>
                </div>`;
            if (precipProb != null && precipProb > 0) {
                precipHtml += `
                    <div class="weather-daily-precip__day">
                        <img class="weather-daily-precip__glyph" src="${APP_BASE}resources/raindrop.png" alt="" draggable="false">
                        <span>${precipProb}%</span>
                    </div>`;
            } else {
                precipHtml += `<div class="weather-daily-precip__day"></div>`;
            }
        }
        if (els.dailyStrip)  els.dailyStrip.innerHTML = html;
        if (els.dailyPrecip) els.dailyPrecip.innerHTML = precipHtml;

        // Click → navigate to that day's cluster in daily forecast
        if (els.dailyStrip) {
            els.dailyStrip.querySelectorAll('.weather-daily-strip__day').forEach(tile => {
                tile.addEventListener('click', () => {
                    navigateToDailyForecast(parseInt(tile.dataset.dayIndex));
                });
                tile.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigateToDailyForecast(parseInt(tile.dataset.dayIndex));
                    }
                });
            });
        }
    }

    function navigateToDailyForecast(dayIndex) {
        currentSection = 'dailyforecast';
        renderNavigation(dayIndex);
    }

    /* ================================================================
       Hourly Forecast (Cluster 002)
       ================================================================ */
    function renderHourly(hourly, startIdx) {
        let html = `
            <div class="weather-hourly__header">
                <span>Time</span>
                <span></span>
                <span>Forecast</span>
                <span>Precip</span>
            </div>`;
        const count = Math.min(24, hourly.time.length - startIdx);
        for (let i = 0; i < count; i++) {
            const idx     = startIdx + i;
            const time    = i === 0 ? 'Now' : formatTimeShort(hourly.time[idx]);
            const code    = hourly.weather_code[idx];
            const isDay   = !!hourly.is_day[idx];
            const temp    = Math.round(hourly.temperature_2m[idx]);
            const caption = (WMO_CODES[code] || WMO_CODES[0]).caption;
            const icon    = skycodePath(code, isDay, '30x30');
            const precipProb = hourly.precipitation_probability[idx] != null
                ? hourly.precipitation_probability[idx] + '%' : '--';
            html += `
                <div class="weather-hourly__row">
                    <span class="weather-hourly__time">${time}</span>
                    <img class="weather-hourly__icon" src="${icon}" alt="${caption}" draggable="false">
                    <div class="weather-hourly__temp-cap">
                        <span class="weather-hourly__temp">${temp}\u00B0</span>
                        <span class="weather-hourly__caption">${caption}</span>
                    </div>
                    <span class="weather-hourly__precip">
                        <img class="weather-hourly__precip-drop" src="${APP_BASE}resources/raindrop.png" alt="" draggable="false">
                        ${precipProb}
                    </span>
                </div>`;
        }
        if (els.hourly) els.hourly.innerHTML = html;
    }

    /* ================================================================
       Precipitation Chart
       ================================================================ */
    function renderPrecipChart(daily) {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const maxPrecip = Math.max(1, ...daily.precipitation_sum.map(v => v || 0));
        let html = '';
        const count = Math.min(7, daily.time.length);
        for (let i = 0; i < count; i++) {
            const d     = new Date(daily.time[i] + 'T12:00:00');
            const label = i === 0 ? 'Today' : days[d.getDay()];
            const val   = daily.precipitation_sum[i] || 0;
            const pct   = Math.max(2, (val / maxPrecip) * 100);
            const precipUnit = state.useFahrenheit ? 'in' : 'mm';
            html += `
                <div class="weather-precip-bar">
                    <div class="weather-precip-bar__value">${val > 0 ? val.toFixed(1) + ' ' + precipUnit : ''}</div>
                    <div class="weather-precip-bar__fill" style="height: ${pct}%"></div>
                    <div class="weather-precip-bar__label">${label}</div>
                </div>`;
        }
        if (els.precipChart) els.precipChart.innerHTML = html;
    }

    /* ================================================================
       Leaflet Weather Map (Cluster 007 equivalent)
       ================================================================ */
    function initWeatherMap(location, temp, code, isDay) {
        const mapEl = document.getElementById('weather-map');
        if (!mapEl || typeof L === 'undefined') return;

        if (!leafletMap) {
            leafletMap = L.map('weather-map', {
                zoomControl:        true,
                attributionControl: true,
                scrollWheelZoom:    false
            });

            // CartoDB Dark Matter tiles – free, dark-themed, no API key needed
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 14
            }).addTo(leafletMap);
        }

        const iconPath = skycodePath(code, isDay, '30x30');
        const tempDisplay = `${temp}\u00B0${state.useFahrenheit ? 'F' : 'C'}`;
        const markerIcon = L.divIcon({
            className: 'weather-map-marker',
            html: `<div class="weather-map-marker__inner">
                       <img src="${iconPath}" alt="" width="24" height="24" draggable="false">
                       <span class="weather-map-marker__temp">${temp}\u00B0</span>
                   </div>`,
            iconSize:   [72, 44],
            iconAnchor: [36, 22]
        });

        if (leafletMarker) {
            leafletMarker.setLatLng([location.latitude, location.longitude]);
            leafletMarker.setIcon(markerIcon);
            leafletMarker.getPopup().setContent(`<b>${escapeHtml(location.name)}</b><br>${tempDisplay}`);
        } else {
            leafletMarker = L.marker([location.latitude, location.longitude], { icon: markerIcon })
                .bindPopup(`<b>${escapeHtml(location.name)}</b><br>${tempDisplay}`)
                .addTo(leafletMap);
        }

        leafletMap.setView([location.latitude, location.longitude], 8);
        setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 150);
    }

    /* ================================================================
       Daily Forecast Page – Per-day clusters with hourly breakdown
       ================================================================ */
    function renderDailyForecastPage(targetDayIndex) {
        if (!weatherData || !els.dfClusters) return;
        const daily  = weatherData.daily;
        const hourly = weatherData.hourly;
        if (!daily || !daily.time) return;

        const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const unit     = state.useFahrenheit ? 'F' : 'C';
        const windUnit = state.useFahrenheit ? 'mph' : 'km/h';

        let html = '';
        for (let i = 0; i < daily.time.length; i++) {
            const d       = new Date(daily.time[i] + 'T12:00:00');
            const dayName = i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : DAY_NAMES[d.getDay()]);
            const dateStr = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
            const code    = daily.weather_code[i];
            const caption = (WMO_CODES[code] || WMO_CODES[0]).caption;
            const dayIcon  = skycodePath(code, true,  '89x89');
            const nightIcon = skycodePath(code, false, '89x89');
            const hi      = Math.round(daily.temperature_2m_max[i]);
            const lo      = Math.round(daily.temperature_2m_min[i]);
            const windMax = Math.round(daily.wind_speed_10m_max[i]);
            const windDir = windDirection(daily.wind_direction_10m_dominant[i]);
            const precipProb = daily.precipitation_probability_max[i] != null
                ? daily.precipitation_probability_max[i] + '%' : '--';
            const sunrise = daily.sunrise && daily.sunrise[i] ? formatTime12(daily.sunrise[i]) : '--';
            const sunset  = daily.sunset  && daily.sunset[i]  ? formatTime12(daily.sunset[i])  : '--';
            const uvMax   = daily.uv_index_max && daily.uv_index_max[i] != null
                ? Math.round(daily.uv_index_max[i]) : null;

            // Hourly rows for this specific day
            const dayStr = daily.time[i];
            let hourlyHtml = '';
            if (hourly && hourly.time) {
                let hasRows = false;
                let rowsHtml = '';
                for (let j = 0; j < hourly.time.length; j++) {
                    if (!hourly.time[j].startsWith(dayStr)) continue;
                    const hCode    = hourly.weather_code[j];
                    const hIsDay   = !!hourly.is_day[j];
                    const hTemp    = Math.round(hourly.temperature_2m[j]);
                    const hCaption = (WMO_CODES[hCode] || WMO_CODES[0]).caption;
                    const hIcon    = skycodePath(hCode, hIsDay, '30x30');
                    const hTime    = formatTimeShort(hourly.time[j]);
                    const hPrecip  = hourly.precipitation_probability[j] != null
                        ? hourly.precipitation_probability[j] + '%' : '--';
                    rowsHtml += `
                        <div class="weather-hourly__row">
                            <span class="weather-hourly__time">${hTime}</span>
                            <img class="weather-hourly__icon" src="${hIcon}" alt="${hCaption}" draggable="false">
                            <div class="weather-hourly__temp-cap">
                                <span class="weather-hourly__temp">${hTemp}\u00B0</span>
                                <span class="weather-hourly__caption">${hCaption}</span>
                            </div>
                            <span class="weather-hourly__precip">
                                <img class="weather-hourly__precip-drop" src="${APP_BASE}resources/raindrop.png" alt="" draggable="false">
                                ${hPrecip}
                            </span>
                        </div>`;
                    hasRows = true;
                }
                if (hasRows) {
                    hourlyHtml = `
                        <div class="weather-df-cluster__hourly">
                            <div class="weather-df-cluster__hourly-title">Hourly</div>
                            <div class="weather-hourly__header">
                                <span>Time</span><span></span><span>Forecast</span><span>Precip</span>
                            </div>
                            ${rowsHtml}
                        </div>`;
                }
            }

            html += `
                <div class="weather-df-cluster" id="weather-df-cluster-${i}">
                    <div class="weather-df-cluster__header">
                        <div class="weather-df-cluster__day">${dayName.toUpperCase()}</div>
                        <div class="weather-df-cluster__date">${dateStr}</div>
                    </div>
                    <div class="weather-df-cluster__body">
                        <!-- Day / Night overview -->
                        <div class="weather-df-overview">
                            <div class="weather-df-period">
                                <div class="weather-df-period__label">Day</div>
                                <img class="weather-df-period__icon" src="${dayIcon}" alt="${caption}" draggable="false">
                                <div class="weather-df-period__temp">${hi}\u00B0${unit}</div>
                                <div class="weather-df-period__caption">${caption}</div>
                            </div>
                            <div class="weather-df-divider"></div>
                            <div class="weather-df-period">
                                <div class="weather-df-period__label">Night</div>
                                <img class="weather-df-period__icon" src="${nightIcon}" alt="${caption}" draggable="false">
                                <div class="weather-df-period__temp">${lo}\u00B0${unit}</div>
                                <div class="weather-df-period__caption">${caption}</div>
                            </div>
                        </div>
                        <!-- Conditions properties -->
                        <div class="weather-df-props">
                            <div class="weather-df-prop">
                                <span class="weather-df-prop__key">Wind</span>
                                <span class="weather-df-prop__value">${windDir} ${windMax} ${windUnit}</span>
                            </div>
                            <div class="weather-df-prop">
                                <span class="weather-df-prop__key">Precip chance</span>
                                <span class="weather-df-prop__value">${precipProb}</span>
                            </div>
                            <div class="weather-df-prop">
                                <span class="weather-df-prop__key">Sunrise</span>
                                <span class="weather-df-prop__value">${sunrise}</span>
                            </div>
                            <div class="weather-df-prop">
                                <span class="weather-df-prop__key">Sunset</span>
                                <span class="weather-df-prop__value">${sunset}</span>
                            </div>
                            ${uvMax != null ? `
                            <div class="weather-df-prop">
                                <span class="weather-df-prop__key">UV Index</span>
                                <span class="weather-df-prop__value">${uvMax} ${uvDescription(uvMax)}</span>
                            </div>` : ''}
                        </div>
                        <!-- Per-day hourly breakdown -->
                        ${hourlyHtml}
                    </div>
                </div>`;
        }

        els.dfClusters.innerHTML = html;

        // Scroll to the target day cluster
        if (targetDayIndex !== undefined) {
            const target = document.getElementById(`weather-df-cluster-${targetDayIndex}`);
            if (target) {
                setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }), 80);
            }
        }
    }

    /* ================================================================
       Places View
       ================================================================ */
    function renderPlaces() {
        const places = state.places || [];
        let html = '';

        places.forEach((loc, i) => {
            const isHome = state.currentLocation &&
                Math.abs(loc.latitude - state.currentLocation.latitude) < 0.01 &&
                Math.abs(loc.longitude - state.currentLocation.longitude) < 0.01;
            const isSelected = selectedPlaces.has(i);
            html += `
                <div class="weather-place-tile${isSelected ? ' is-selected' : ''}" data-place-index="${i}" id="place-tile-${i}">
                    <button class="weather-place-tile__remove" data-remove="${i}" aria-label="Remove ${escapeHtml(loc.name)}">&times;</button>
                    <div>
                        <div class="weather-place-tile__name-row">
                            ${isHome ? '<span class="weather-place-tile__home-icon">&#xE10F;</span>' : ''}
                            <div class="weather-place-tile__name">${escapeHtml(loc.name)}</div>
                        </div>
                        <div class="weather-place-tile__caption" id="place-caption-${i}"></div>
                    </div>
                    <div class="weather-place-tile__bottom">
                        <div>
                            <div class="weather-place-tile__temp" id="place-temp-${i}">--\u00B0</div>
                            <div class="weather-place-tile__hilo" id="place-hilo-${i}"></div>
                        </div>
                        <img class="weather-place-tile__icon" id="place-icon-${i}" src="${APP_BASE}resources/skycodes/48x48/34_33.png" alt="" draggable="false">
                    </div>
                </div>`;
        });

        html += `
            <div class="weather-place-tile weather-place-tile--add" id="add-place-tile">
                <div class="weather-place-tile__add-icon">+</div>
                <div class="weather-place-tile__add-label">Add a place</div>
            </div>`;

        if (els.placesGrid) els.placesGrid.innerHTML = html;

        places.forEach((loc, i) => fetchPlaceWeather(loc, i));

        // Click: navigate to location (unless in selection mode)
        if (els.placesGrid) {
            els.placesGrid.querySelectorAll('.weather-place-tile[data-place-index]').forEach(tile => {
                tile.addEventListener('click', (e) => {
                    if (e.target.closest('.weather-place-tile__remove')) return;
                    // If any places selected, toggle this one
                    if (selectedPlaces.size > 0) {
                        const idx = parseInt(tile.dataset.placeIndex);
                        if (selectedPlaces.has(idx)) selectedPlaces.delete(idx);
                        else selectedPlaces.add(idx);
                        tile.classList.toggle('is-selected', selectedPlaces.has(idx));
                        updatePlacesSelectionUI();
                        return;
                    }
                    const idx = parseInt(tile.dataset.placeIndex);
                    const loc = state.places[idx];
                    state.currentLocation = loc;
                    persistState();
                    currentSection = 'home';
                    renderNavigation();
                    fetchWeather(loc);
                });

                // Right-click / contextmenu → toggle selection
                tile.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const idx = parseInt(tile.dataset.placeIndex);
                    if (selectedPlaces.has(idx)) selectedPlaces.delete(idx);
                    else selectedPlaces.add(idx);
                    tile.classList.toggle('is-selected', selectedPlaces.has(idx));
                    updatePlacesSelectionUI();
                    if (selectedPlaces.size > 0) showAppBar();
                });
            });

            // Remove buttons
            els.placesGrid.querySelectorAll('.weather-place-tile__remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.remove);
                    state.places.splice(idx, 1);
                    selectedPlaces.delete(idx);
                    // Remap selected indices above the removed one
                    const newSelected = new Set();
                    selectedPlaces.forEach(i => { if (i > idx) newSelected.add(i - 1); else newSelected.add(i); });
                    selectedPlaces = newSelected;
                    persistState();
                    renderPlaces();
                });
            });

            // Add place tile
            const addTile = document.getElementById('add-place-tile');
            if (addTile) addTile.addEventListener('click', () => { els.searchInput.focus(); });
        }
    }

    async function fetchPlaceWeather(loc, index) {
        try {
            const params = new URLSearchParams({
                latitude: loc.latitude,
                longitude: loc.longitude,
                current: 'temperature_2m,weather_code,is_day',
                daily: 'temperature_2m_max,temperature_2m_min',
                temperature_unit: state.useFahrenheit ? 'fahrenheit' : 'celsius',
                timezone: 'auto',
                forecast_days: 1
            });
            const res  = await fetch(`${WEATHER_URL}?${params}`);
            const data = await res.json();
            const tempEl    = document.getElementById(`place-temp-${index}`);
            const iconEl    = document.getElementById(`place-icon-${index}`);
            const captionEl = document.getElementById(`place-caption-${index}`);
            const hiloEl    = document.getElementById(`place-hilo-${index}`);
            const tileEl    = document.getElementById(`place-tile-${index}`);
            if (data.current) {
                const code  = data.current.weather_code;
                const isDay = !!data.current.is_day;
                if (tempEl)    tempEl.textContent    = Math.round(data.current.temperature_2m) + '\u00B0';
                if (iconEl)    iconEl.src            = skycodePath(code, isDay, '48x48');
                if (captionEl) captionEl.textContent = (WMO_CODES[code] || WMO_CODES[0]).caption;
                if (tileEl) {
                    const themeClass = getThemeClass(code, isDay).replace('weather-theme', 'weather-place-tile');
                    tileEl.classList.add(themeClass);
                }
            }
            if (data.daily && data.daily.temperature_2m_max && hiloEl) {
                const hi = Math.round(data.daily.temperature_2m_max[0]);
                const lo = Math.round(data.daily.temperature_2m_min[0]);
                hiloEl.textContent = `${hi}\u00B0 / ${lo}\u00B0`;
            }
        } catch (e) { /* ignore */ }
    }

    /* ================================================================
       World Weather
       ================================================================ */
    const WORLD_CITIES = [
        { first: 'Los Angeles',   second: 'UNITED STATES',  lat:  34.05, lon: -118.25, x:  211, y: 342 },
        { first: 'New York',      second: 'UNITED STATES',  lat:  40.71, lon:  -74.01, x:  370, y: 300 },
        { first: 'Rio de Janeiro',second: 'BRAZIL',          lat: -22.98, lon:  -43.19, x:  490, y: 562 },
        { first: 'Buenos Aires',  second: 'ARGENTINA',       lat: -34.61, lon:  -58.38, x:  427, y: 655 },
        { first: 'London',        second: 'UNITED KINGDOM',  lat:  51.51, lon:   -0.13, x:  640, y: 255 },
        { first: 'Paris',         second: 'FRANCE',          lat:  48.86, lon:    2.35, x:  658, y: 280 },
        { first: 'Moscow',        second: 'RUSSIA',          lat:  55.76, lon:   37.62, x:  745, y: 210 },
        { first: 'Cairo',         second: 'EGYPT',           lat:  30.04, lon:   31.24, x:  730, y: 355 },
        { first: 'Cape Town',     second: 'SOUTH AFRICA',    lat: -33.97, lon:   18.60, x:  693, y: 620 },
        { first: 'New Delhi',     second: 'INDIA',           lat:  28.61, lon:   77.21, x:  938, y: 377 },
        { first: 'Mumbai',        second: 'INDIA',           lat:  19.08, lon:   72.88, x:  905, y: 405 },
        { first: 'Beijing',       second: 'CHINA',           lat:  39.91, lon:  116.39, x: 1085, y: 290 },
        { first: 'Tokyo',         second: 'JAPAN',           lat:  35.68, lon:  139.69, x: 1195, y: 315 },
        { first: 'Seoul',         second: 'SOUTH KOREA',     lat:  37.57, lon:  126.98, x: 1150, y: 290 },
        { first: 'Dubai',         second: 'UAE',             lat:  25.20, lon:   55.27, x:  840, y: 380 },
        { first: 'Singapore',     second: 'SINGAPORE',       lat:   1.35, lon:  103.82, x: 1055, y: 480 },
        { first: 'Sydney',        second: 'AUSTRALIA',       lat: -33.87, lon:  151.21, x: 1230, y: 605 },
        { first: 'Melbourne',     second: 'AUSTRALIA',       lat: -37.81, lon:  144.96, x: 1200, y: 640 }
    ];

    const CITY_CONTINENTS = {
        'Los Angeles': 'NorthAmerica', 'New York': 'NorthAmerica',
        'Rio de Janeiro': 'SouthAmerica', 'Buenos Aires': 'SouthAmerica',
        'London': 'Europe', 'Paris': 'Europe', 'Moscow': 'Europe',
        'Cairo': 'Africa', 'Cape Town': 'Africa',
        'New Delhi': 'Asia', 'Mumbai': 'Asia', 'Beijing': 'Asia',
        'Tokyo': 'Asia', 'Seoul': 'Asia', 'Dubai': 'Asia', 'Singapore': 'Asia',
        'Sydney': 'Oceania', 'Melbourne': 'Oceania'
    };

    const CONTINENT_PROPS = {
        NorthAmerica: { zoomOrigin: '156px 231px', scale: 2.51 },
        SouthAmerica: { zoomOrigin: '373px 688px', scale: 2.69 },
        Europe:       { zoomOrigin: '787px 203px', scale: 4.0  },
        Africa:       { zoomOrigin: '821px 526px', scale: 2.66 },
        Asia:         { zoomOrigin: '1437px 319px', scale: 2.02 },
        Oceania:      { zoomOrigin: '1466px 657px', scale: 3.40 }
    };

    // Continent image filenames (ltr variants)
    const CONTINENT_IMGS = {
        NorthAmerica: 'northamerica-ltr',
        SouthAmerica: 'southamerica-ltr',
        Europe:       'europe-ltr',
        Africa:       'africa-ltr',
        Asia:         'asia-ltr',
        Oceania:      'oceania-ltr'
    };

    function attachWorldEvents() {
        const svg = root.querySelector('.weather-world__svg');
        if (svg) {
            svg.addEventListener('click', (e) => {
                const poly = e.target.closest('polygon[data-continent]');
                if (poly) zoomToContinent(poly.dataset.continent);
            });
        }
        const labels = root.querySelector('.weather-world__labels');
        if (labels) {
            labels.addEventListener('click', (e) => {
                const label = e.target.closest('.weather-world__label');
                if (label) zoomToContinent(label.dataset.continent);
            });
        }
        const backBtn = $('#weather-world-back');
        if (backBtn) backBtn.addEventListener('click', () => zoomOut());
    }

    function renderWorldWeather() {
        worldZoomedContinent = null;

        const viewport      = $('#weather-world-viewport');
        const backBtn       = $('#weather-world-back');
        const labelsEl      = $('#weather-world-labels');
        const continentImg  = els.worldContinentImg;
        const worldMap      = els.worldMap;

        if (viewport)     { viewport.style.transform = ''; viewport.style.transformOrigin = ''; }
        if (backBtn)      backBtn.hidden = true;
        if (labelsEl)     labelsEl.style.display = '';
        if (continentImg) continentImg.hidden = true;
        if (worldMap)     worldMap.style.opacity = '';
        if (els.worldCities) els.worldCities.innerHTML = '';

        // Fetch weather for all world cities
        WORLD_CITIES.forEach(city => fetchWorldCityWeather(city));

        // Render city panel
        renderWorldCityPanel(null);
    }

    function zoomToContinent(continent) {
        const props = CONTINENT_PROPS[continent];
        if (!props) return;
        worldZoomedContinent = continent;

        const viewport     = $('#weather-world-viewport');
        const backBtn      = $('#weather-world-back');
        const labelsEl     = $('#weather-world-labels');
        const continentImg = els.worldContinentImg;
        const worldMap     = els.worldMap;

        // Swap to continent-specific image
        if (continentImg && CONTINENT_IMGS[continent]) {
            continentImg.src    = `${APP_BASE}resources/worldweather/landscape/${CONTINENT_IMGS[continent]}.png`;
            continentImg.hidden = false;
        }
        if (worldMap) worldMap.style.opacity = '0';

        if (viewport) {
            viewport.style.transformOrigin = props.zoomOrigin;
            viewport.style.transform       = `scale(${props.scale})`;
        }
        if (backBtn) backBtn.hidden = false;
        if (labelsEl) labelsEl.style.display = 'none';

        // Update city panel to this continent
        renderWorldCityPanel(continent);

        // Update panel header with continent name
        if (els.worldPanelHeader) {
            els.worldPanelHeader.textContent = continent.replace(/([A-Z])/g, ' $1').trim();
        }
    }

    function zoomOut() {
        worldZoomedContinent = null;

        const viewport     = $('#weather-world-viewport');
        const backBtn      = $('#weather-world-back');
        const labelsEl     = $('#weather-world-labels');
        const continentImg = els.worldContinentImg;
        const worldMap     = els.worldMap;

        if (continentImg) continentImg.hidden = true;
        if (worldMap)     worldMap.style.opacity = '';
        if (viewport)     { viewport.style.transform = ''; viewport.style.transformOrigin = ''; }
        if (backBtn)      backBtn.hidden = true;
        if (labelsEl)     labelsEl.style.display = '';

        renderWorldCityPanel(null);
        if (els.worldPanelHeader) els.worldPanelHeader.textContent = 'World';
    }

    function renderWorldCityPanel(filterContinent) {
        if (!els.worldPanelList) return;

        const cities = filterContinent
            ? WORLD_CITIES.filter(c => CITY_CONTINENTS[c.first] === filterContinent)
            : WORLD_CITIES;

        let html = '';
        cities.forEach(city => {
            const cached = worldCityWeatherCache[city.first];
            const temp    = cached ? `${cached.temp}\u00B0` : '\u2013\u2013\u00B0';
            const icon    = cached ? `<img class="weather-world__panel-city-icon" src="${cached.icon}" alt="" draggable="false">` : '<div class="weather-world__panel-city-icon"></div>';
            html += `
                <div class="weather-world__panel-city" data-lat="${city.lat}" data-lon="${city.lon}" data-name="${escapeHtml(city.first)}">
                    <div class="weather-world__panel-city-left">
                        ${icon}
                        <div>
                            <div class="weather-world__panel-city-name">${escapeHtml(city.first)}</div>
                            <div class="weather-world__panel-city-country">${escapeHtml(city.second)}</div>
                        </div>
                    </div>
                    <div class="weather-world__panel-city-temp">${temp}</div>
                </div>`;
        });
        els.worldPanelList.innerHTML = html;

        els.worldPanelList.querySelectorAll('.weather-world__panel-city').forEach(cityEl => {
            cityEl.addEventListener('click', () => {
                const loc = {
                    name: cityEl.dataset.name,
                    latitude:  parseFloat(cityEl.dataset.lat),
                    longitude: parseFloat(cityEl.dataset.lon),
                    country: ''
                };
                state.currentLocation = loc;
                persistState();
                currentSection = 'home';
                renderNavigation();
                fetchWeather(loc);
            });
        });
    }

    async function fetchWorldCityWeather(city) {
        try {
            const params = new URLSearchParams({
                latitude:  city.lat,
                longitude: city.lon,
                current: 'temperature_2m,weather_code,is_day',
                temperature_unit: state.useFahrenheit ? 'fahrenheit' : 'celsius',
                timezone: 'auto'
            });
            const res  = await fetch(`${WEATHER_URL}?${params}`);
            const data = await res.json();
            if (!data.current) return;

            const temp   = Math.round(data.current.temperature_2m);
            const code   = data.current.weather_code;
            const isDay  = !!data.current.is_day;
            const icon   = skycodePath(code, isDay, '30x30');
            const caption = (WMO_CODES[code] || WMO_CODES[0]).caption;

            worldCityWeatherCache[city.first] = { temp, icon, caption };

            // Add/update map overlay bubble
            if (els.worldCities) {
                const existing = els.worldCities.querySelector(`[data-city="${escapeHtml(city.first)}"]`);
                if (existing) {
                    existing.querySelector('.weather-world-city__temp').textContent = temp + '\u00B0';
                    const img = existing.querySelector('.weather-world-city__icon');
                    if (img) img.src = icon;
                } else {
                    const div = document.createElement('div');
                    div.className = 'weather-world-city';
                    div.dataset.city = city.first;
                    div.style.left = ((city.x / 1366) * 100) + '%';
                    div.style.top  = ((city.y / 768)  * 100) + '%';
                    div.innerHTML = `
                        <span class="weather-world-city__temp">${temp}\u00B0</span>
                        <img class="weather-world-city__icon" src="${icon}" alt="" draggable="false">
                        <span class="weather-world-city__name">${escapeHtml(city.first)}</span>
                        <span class="weather-world-city__country">${escapeHtml(city.second)}</span>`;
                    div.addEventListener('click', () => {
                        const loc = { name: city.first, latitude: city.lat, longitude: city.lon, country: city.second };
                        state.currentLocation = loc;
                        persistState();
                        currentSection = 'home';
                        renderNavigation();
                        fetchWeather(loc);
                    });
                    els.worldCities.appendChild(div);
                }
            }

            // Re-render the city panel with updated data
            renderWorldCityPanel(worldZoomedContinent);

        } catch (e) { /* ignore */ }
    }

    /* ================================================================
       Historical Weather
       ================================================================ */
    function attachHistoricalEvents() {
        els.historicalTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                historicalChart = tab.dataset.chart;
                els.historicalTabs.forEach(t => t.classList.toggle('is-active', t === tab));
                renderHistoricalChart();
            });
        });
    }

    async function fetchHistoricalWeather(location) {
        try {
            const now       = new Date();
            const endDate   = `${now.getFullYear() - 1}-12-31`;
            const startDate = `${now.getFullYear() - 1}-01-01`;
            const params = new URLSearchParams({
                latitude:  location.latitude,
                longitude: location.longitude,
                start_date: startDate,
                end_date:   endDate,
                daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
                temperature_unit:  state.useFahrenheit ? 'fahrenheit' : 'celsius',
                precipitation_unit: state.useFahrenheit ? 'inch' : 'mm',
                timezone: 'auto'
            });
            const res = await fetch(`${HISTORICAL_URL}?${params}`);
            if (!res.ok) return;
            const data = await res.json();

            const months = [];
            for (let m = 0; m < 12; m++) months.push({ maxTemps: [], minTemps: [], precip: [] });

            if (data.daily && data.daily.time) {
                for (let i = 0; i < data.daily.time.length; i++) {
                    const month = new Date(data.daily.time[i] + 'T12:00:00').getMonth();
                    if (data.daily.temperature_2m_max[i] != null) months[month].maxTemps.push(data.daily.temperature_2m_max[i]);
                    if (data.daily.temperature_2m_min[i] != null) months[month].minTemps.push(data.daily.temperature_2m_min[i]);
                    if (data.daily.precipitation_sum[i]  != null) months[month].precip.push(data.daily.precipitation_sum[i]);
                }
            }

            historicalData = months.map((m, i) => ({
                month:       i,
                avgHigh:     m.maxTemps.length ? m.maxTemps.reduce((a, b) => a + b, 0) / m.maxTemps.length : 0,
                avgLow:      m.minTemps.length ? m.minTemps.reduce((a, b) => a + b, 0) / m.minTemps.length : 0,
                totalPrecip: m.precip.reduce((a, b) => a + b, 0),
                recordHigh:  m.maxTemps.length ? Math.max(...m.maxTemps) : 0,
                recordLow:   m.minTemps.length ? Math.min(...m.minTemps) : 0,
                rainyDays:   m.precip.filter(v => v > 0.01).length
            }));

            renderHistoricalChart();
        } catch (e) {
            console.warn('[Weather] Historical fetch error:', e);
        }
    }

    function renderHistoricalChart() {
        if (!historicalData || !els.historicalChart) return;
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const isTemp = historicalChart === 'temperature';
        const maxVal = isTemp
            ? Math.max(1, ...historicalData.map(m => m.avgHigh))
            : Math.max(1, ...historicalData.map(m => m.totalPrecip));

        let barsHtml = '', labelsHtml = '';
        for (let i = 0; i < 12; i++) {
            const d   = historicalData[i];
            const val = isTemp ? d.avgHigh : d.totalPrecip;
            const pct = Math.max(3, (val / maxVal) * 100);
            const fillClass = isTemp ? 'weather-hist-bar__fill--temp' : 'weather-hist-bar__fill--precip';
            const sel   = i === historicalSelectedMonth ? ' is-selected' : '';
            const label = isTemp ? `${Math.round(val)}\u00B0` : (val > 0 ? val.toFixed(1) : '');
            barsHtml   += `<div class="weather-hist-bar${sel}" data-month="${i}"><div class="weather-hist-bar__value">${label}</div><div class="weather-hist-bar__fill ${fillClass}" style="height:${pct}%"></div></div>`;
            labelsHtml += `<div class="weather-hist-month-label${sel}" data-month="${i}">${monthNames[i]}</div>`;
        }
        els.historicalChart.innerHTML  = barsHtml;
        els.historicalMonths.innerHTML = labelsHtml;

        root.querySelectorAll('.weather-hist-bar, .weather-hist-month-label').forEach(el => {
            el.addEventListener('click', () => {
                historicalSelectedMonth = parseInt(el.dataset.month);
                renderHistoricalChart();
            });
        });
        renderHistoricalDetail();
    }

    function renderHistoricalDetail() {
        if (!historicalData || !els.historicalDetail) return;
        const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const d = historicalData[historicalSelectedMonth];
        const unit       = state.useFahrenheit ? 'F' : 'C';
        const precipUnit = state.useFahrenheit ? 'in' : 'mm';
        els.historicalDetail.innerHTML = `
            <div class="weather-hist-detail__title">${MONTH_FULL[historicalSelectedMonth]} (last year)</div>
            <div class="weather-hist-detail__grid">
                <div class="weather-hist-detail__item"><span class="weather-hist-detail__key">Avg High</span><span class="weather-hist-detail__value">${Math.round(d.avgHigh)}\u00B0${unit}</span></div>
                <div class="weather-hist-detail__item"><span class="weather-hist-detail__key">Avg Low</span><span class="weather-hist-detail__value">${Math.round(d.avgLow)}\u00B0${unit}</span></div>
                <div class="weather-hist-detail__item"><span class="weather-hist-detail__key">Record High</span><span class="weather-hist-detail__value">${Math.round(d.recordHigh)}\u00B0${unit}</span></div>
                <div class="weather-hist-detail__item"><span class="weather-hist-detail__key">Record Low</span><span class="weather-hist-detail__value">${Math.round(d.recordLow)}\u00B0${unit}</span></div>
                <div class="weather-hist-detail__item"><span class="weather-hist-detail__key">Total Precip</span><span class="weather-hist-detail__value">${d.totalPrecip.toFixed(1)} ${precipUnit}</span></div>
                <div class="weather-hist-detail__item"><span class="weather-hist-detail__key">Rainy Days</span><span class="weather-hist-detail__value">${d.rainyDays}</span></div>
            </div>`;
    }

    /* ================================================================
       Charms Settings Integration
       ================================================================ */
    function registerSettingsWithCharms() {
        window.WeatherAppSettings = {
            appId: 'weather',
            getMenuItems: function () {
                return [
                    { label: 'Options', action: 'weather-options' },
                    { label: 'About',   action: 'weather-about'   }
                ];
            }
        };
        document.addEventListener('click', function (e) {
            const item = e.target.closest('.settings-menu-item[data-action^="weather-"]');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'weather-options') showWeatherSettingsPanel();
            if (action === 'weather-about')   showWeatherAboutPanel();
        });
    }

    function showWeatherSettingsPanel() {
        const $menuItems = document.getElementById('settings-menu-items');
        if (!$menuItems) return;
        const container = $menuItems.closest('.settings-panel');
        if (!container) return;

        let panel = document.getElementById('weather-settings-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'weather-settings-panel';
            panel.className = 'settings-panel';
            const searchHistoryEnabled = localStorage.getItem('weather-search-history') !== 'off';
            panel.innerHTML = `
                <div class="modern-flyout-header">
                    <button class="metro-back-btn personalize-back-button weather-settings-back" title="Back to Settings">
                        <span class="sui-back"></span>
                    </button>
                    <span class="modern-flyout-header-text">Options</span>
                </div>
                <div class="modern-flyout-content weather-settings-content">
                    <div class="weather-settings-section">
                        <div class="weather-settings-heading">Display Units</div>
                        <label class="weather-settings-radio">
                            <input type="radio" name="weather-unit" value="F" ${state.useFahrenheit ? 'checked' : ''}>
                            <span>Fahrenheit</span>
                        </label>
                        <label class="weather-settings-radio">
                            <input type="radio" name="weather-unit" value="C" ${!state.useFahrenheit ? 'checked' : ''}>
                            <span>Celsius</span>
                        </label>
                    </div>
                    <div class="weather-settings-section">
                        <div class="weather-settings-heading">Default Location</div>
                        <div class="weather-settings-info">${state.currentLocation ? escapeHtml(state.currentLocation.name) : 'Not set'}</div>
                    </div>
                    <div class="weather-settings-section">
                        <div class="weather-settings-heading">Saved Places</div>
                        <div class="weather-settings-info weather-settings-places-count">${(state.places || []).length} location(s)</div>
                        <button type="button" class="weather-settings-btn weather-clear-places">Clear all places</button>
                    </div>
                </div>`;
            container.parentElement.appendChild(panel);

            panel.querySelector('.weather-settings-back').addEventListener('click', () => {
                panel.style.display = 'none';
                container.style.display = '';
            });
            panel.querySelectorAll('input[name="weather-unit"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    state.useFahrenheit = radio.value === 'F';
                    persistState();
                    if (weatherData) fetchWeather(state.currentLocation);
                });
            });
            panel.querySelector('.weather-clear-places').addEventListener('click', () => {
                state.places = state.currentLocation ? [{ ...state.currentLocation }] : [];
                persistState();
                panel.querySelector('.weather-settings-places-count').textContent = state.places.length + ' location(s)';
            });
        }
        container.style.display = 'none';
        panel.style.display = '';
    }

    function showWeatherAboutPanel() {
        const $menuItems = document.getElementById('settings-menu-items');
        if (!$menuItems) return;
        const container = $menuItems.closest('.settings-panel');
        if (!container) return;

        let panel = document.getElementById('weather-about-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'weather-about-panel';
            panel.className = 'settings-panel';
            panel.innerHTML = `
                <div class="modern-flyout-header">
                    <button class="metro-back-btn personalize-back-button weather-about-back" title="Back to Settings">
                        <span class="sui-back"></span>
                    </button>
                    <span class="modern-flyout-header-text">About</span>
                </div>
                <div class="modern-flyout-content" style="padding: 20px;">
                    <div style="font-size: 18px; font-weight: 300; margin-bottom: 6px;">Weather</div>
                    <div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-bottom: 20px;">Version 4.0</div>
                    <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Data provided by</div>
                    <div style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.8;">
                        Open-Meteo Weather API<br>
                        Open-Meteo Geocoding API<br>
                        Open-Meteo Historical Archive API
                    </div>
                    <div style="font-size: 14px; font-weight: 600; margin: 16px 0 8px;">Map tiles by</div>
                    <div style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.8;">
                        CARTO Dark Matter<br>
                        © OpenStreetMap contributors
                    </div>
                </div>`;
            container.parentElement.appendChild(panel);
            panel.querySelector('.weather-about-back').addEventListener('click', () => {
                panel.style.display = 'none';
                container.style.display = '';
            });
        }
        container.style.display = 'none';
        panel.style.display = '';
    }

    /* ================================================================
       Show / Hide States
       ================================================================ */
    function showLoading() {
        if (els.loading)         els.loading.hidden         = false;
        if (els.error)           els.error.hidden           = true;
        if (els.panoramaContent) els.panoramaContent.hidden = true;
    }

    function showError(msg) {
        if (els.loading)         els.loading.hidden         = true;
        if (els.error)           els.error.hidden           = false;
        if (els.panoramaContent) els.panoramaContent.hidden = true;
        if (els.errorMessage)    els.errorMessage.textContent = msg;
    }

    function showContent() {
        if (els.loading)         els.loading.hidden         = true;
        if (els.error)           els.error.hidden           = true;
        if (els.panoramaContent) els.panoramaContent.hidden = false;
    }

    /* ================================================================
       Persistence
       ================================================================ */
    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                if (!s.places)                s.places = [];
                if (s.useFahrenheit === undefined) s.useFahrenheit = true;
                return s;
            }
        } catch (e) { /* ignore */ }
        return { currentLocation: null, places: [], useFahrenheit: true };
    }

    function persistState() {
        try {
            if (state.currentLocation) {
                const exists = state.places.some(p =>
                    Math.abs(p.latitude  - state.currentLocation.latitude)  < 0.01 &&
                    Math.abs(p.longitude - state.currentLocation.longitude) < 0.01
                );
                if (!exists) state.places.push({ ...state.currentLocation });
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { /* ignore */ }
    }

})();
