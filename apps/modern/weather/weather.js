(function () {
    'use strict';

    /* ================================================================
       Bing Weather – Windows 8.1 Recreation
       Uses Open-Meteo (free, no API key) for weather data.
       ================================================================ */

    const STORAGE_KEY = 'modern-weather-state-v1';
    const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
    const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
    const APP_BASE = 'apps/modern/weather/';

    // WMO weather code → description & icon mapping
    // Icons reference the original BingWeather skycode PNGs
    const WMO_CODES = {
        0:  { caption: 'Clear sky',            day: '1',       night: '1b'     },
        1:  { caption: 'Mainly clear',         day: '1',       night: '1b'     },
        2:  { caption: 'Partly cloudy',        day: '34_33',   night: '34_33'  },
        3:  { caption: 'Overcast',             day: '26',      night: '26'     },
        45: { caption: 'Fog',                  day: '20',      night: '20b'    },
        48: { caption: 'Depositing rime fog',  day: '20c',     night: '20c'    },
        51: { caption: 'Light drizzle',        day: '9',       night: '9b'     },
        53: { caption: 'Moderate drizzle',     day: '9',       night: '9b'     },
        55: { caption: 'Dense drizzle',        day: '9c',      night: '9c'     },
        56: { caption: 'Freezing drizzle',     day: '9c',      night: '9c'     },
        57: { caption: 'Heavy freezing drizzle', day: '9c',    night: '9c'     },
        61: { caption: 'Slight rain',          day: '9',       night: '9b'     },
        63: { caption: 'Moderate rain',        day: '11',      night: '11'     },
        65: { caption: 'Heavy rain',           day: '12',      night: '12'     },
        66: { caption: 'Light freezing rain',  day: '25',      night: '25b'    },
        67: { caption: 'Heavy freezing rain',  day: '25',      night: '25b'    },
        71: { caption: 'Slight snow fall',     day: '19',      night: '19b'    },
        73: { caption: 'Moderate snow fall',   day: '19c',     night: '19c'    },
        75: { caption: 'Heavy snow fall',      day: '43',      night: '43'     },
        77: { caption: 'Snow grains',          day: '19',      night: '19b'    },
        80: { caption: 'Slight rain showers',  day: '9',       night: '9b'     },
        81: { caption: 'Moderate rain showers',day: '11',      night: '11'     },
        82: { caption: 'Violent rain showers', day: '12',      night: '12'     },
        85: { caption: 'Slight snow showers',  day: '19',      night: '19b'    },
        86: { caption: 'Heavy snow showers',   day: '43',      night: '43'     },
        95: { caption: 'Thunderstorm',         day: '17',      night: '17'     },
        96: { caption: 'Thunderstorm with slight hail', day: '17', night: '17' },
        99: { caption: 'Thunderstorm with heavy hail',  day: '17', night: '17' }
    };

    // Wind direction labels
    const WIND_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

    // UV index descriptions
    function uvDescription(uv) {
        if (uv <= 2) return 'Low';
        if (uv <= 5) return 'Moderate';
        if (uv <= 7) return 'High';
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

    /* ================================================================
       State
       ================================================================ */
    // Find our root - with loadDirect, elements live in the main DOM
    const root = document.getElementById('weather-app');
    if (!root) { console.error('[Weather] #weather-app not found'); return; }

    // Helper: query within our app root to avoid conflicts
    const $ = (sel) => root.querySelector(sel);
    const $$ = (sel) => Array.from(root.querySelectorAll(sel));

    let state = loadState();
    let weatherData = null;
    let currentSection = 'home';

    let appBarTimeout = null;

    const els = {
        navTabs: $$('.weather-navbar__tab'),
        searchInput: $('#weather-search-input'),
        searchBtn: $('#weather-search-btn'),
        suggestions: $('#weather-suggestions'),
        home: $('#weather-home'),
        loading: $('#weather-loading'),
        error: $('#weather-error'),
        errorMessage: $('#weather-error-message'),
        retryBtn: $('#weather-retry-btn'),
        panoramaContent: $('#weather-panorama-content'),
        locationName: $('#weather-location-name'),
        lastUpdated: $('#weather-last-updated'),
        tempToggle: $('#weather-temp-toggle'),
        tempValue: $('#weather-temp-value'),
        tempUnit: $('#weather-temp-unit'),
        caption: $('#weather-caption'),
        feelslike: $('#weather-feelslike'),
        heroIcon: $('#weather-hero-icon'),
        wind: $('#weather-wind'),
        humidity: $('#weather-humidity'),
        pressure: $('#weather-pressure'),
        uv: $('#weather-uv'),
        alert: $('#weather-alert'),
        alertText: $('#weather-alert-text'),
        dailyStrip: $('#weather-daily-strip'),
        dailyPrecip: $('#weather-daily-precip'),
        hourly: $('#weather-hourly'),
        dailyDetail: $('#weather-daily-detail'),
        sunrise: $('#weather-sunrise'),
        sunset: $('#weather-sunset'),
        visibility: $('#weather-visibility'),
        dewpoint: $('#weather-dewpoint'),
        precipChart: $('#weather-precip-chart'),
        daynight: $('#weather-daynight'),
        historicalChart: $('#weather-historical-chart'),
        historicalMonths: $('#weather-historical-months'),
        historicalDetail: $('#weather-historical-detail'),
        historicalTabs: $$('.weather-historical__tab'),
        world: $('#weather-world'),
        worldMap: $('#weather-world-map'),
        worldCities: $('#weather-world-cities'),
        dailyForecast: $('#weather-dailyforecast'),
        dfTitle: $('#weather-df-title'),
        dfCards: $('#weather-df-cards'),
        places: $('#weather-places'),
        placesGrid: $('#weather-places-grid'),
        appbar: $('#weather-appbar'),
        appbarUnitIcon: $('#weather-appbar-unit-icon'),
        appbarUnitLabel: $('#weather-appbar-unit-label')
    };

    // Debug: log any missing elements
    for (const [key, el] of Object.entries(els)) {
        if (!el && key !== 'navTabs') console.warn('[Weather] Missing element:', key);
    }

    /* ================================================================
       Initialization
       ================================================================ */
    initialize();

    function initialize() {
        attachEvents();
        attachAppBarEvents();
        attachHistoricalEvents();
        attachWorldEvents();
        registerSettingsWithCharms();
        if (state.currentLocation) {
            fetchWeather(state.currentLocation);
        } else {
            // Default: try geolocation, fallback to Seattle
            tryGeolocation();
        }
    }

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
            if (q.length < 2) {
                els.suggestions.hidden = true;
                return;
            }
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

        // Close suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.weather-navbar__search')) {
                els.suggestions.hidden = true;
            }
        });

        // Temp unit toggle
        els.tempToggle.addEventListener('click', () => {
            state.useFahrenheit = !state.useFahrenheit;
            persistState();
            if (weatherData) renderWeather();
        });

        // Retry
        els.retryBtn.addEventListener('click', () => {
            if (state.currentLocation) fetchWeather(state.currentLocation);
            else tryGeolocation();
        });
    }

    /* ================================================================
       Bottom App Bar
       ================================================================ */
    function attachAppBarEvents() {
        // Right-click toggles app bar
        root.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.weather-appbar')) return;
            e.preventDefault();
            toggleAppBar();
        });

        // Click outside hides app bar
        root.addEventListener('click', (e) => {
            if (!e.target.closest('.weather-appbar') && els.appbar && !els.appbar.hidden) {
                hideAppBar();
            }
        });

        // App bar button actions
        if (els.appbar) {
            els.appbar.addEventListener('click', (e) => {
                const btn = e.target.closest('.weather-appbar__btn');
                if (!btn) return;
                const action = btn.dataset.action;
                switch (action) {
                    case 'refresh':
                        if (state.currentLocation) fetchWeather(state.currentLocation);
                        break;
                    case 'current-location':
                        tryGeolocation();
                        break;
                    case 'toggle-unit':
                        state.useFahrenheit = !state.useFahrenheit;
                        persistState();
                        updateAppBarUnit();
                        if (weatherData) fetchWeather(state.currentLocation);
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
                        break;
                    case 'pin':
                        // Pin functionality - visual feedback only
                        break;
                    case 'set-home':
                        // Already the current location
                        break;
                }
                hideAppBar();
            });
        }
    }

    function toggleAppBar() {
        if (!els.appbar) return;
        if (els.appbar.hidden) {
            showAppBar();
        } else {
            hideAppBar();
        }
    }

    function showAppBar() {
        if (!els.appbar) return;
        els.appbar.hidden = false;
        updateAppBarUnit();
        clearTimeout(appBarTimeout);
        appBarTimeout = setTimeout(hideAppBar, 5000);
    }

    function hideAppBar() {
        if (!els.appbar) return;
        els.appbar.hidden = true;
        clearTimeout(appBarTimeout);
    }

    function updateAppBarUnit() {
        if (els.appbarUnitIcon) {
            els.appbarUnitIcon.innerHTML = state.useFahrenheit ? '&#xE150;' : '&#xE151;';
        }
        if (els.appbarUnitLabel) {
            els.appbarUnitLabel.textContent = state.useFahrenheit ? 'Celsius' : 'Fahrenheit';
        }
    }

    /* ================================================================
       Geolocation
       ================================================================ */
    async function tryGeolocation() {
        // Primary: IP-based geolocation (works reliably in Electron)
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

        // Fallback: browser geolocation (often fails in Electron with 403)
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const loc = {
                        name: 'Current Location',
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        country: ''
                    };
                    reverseGeocode(loc.latitude, loc.longitude).then(name => {
                        loc.name = name || 'Current Location';
                        state.currentLocation = loc;
                        persistState();
                        fetchWeather(loc);
                    });
                },
                () => {
                    useFallbackLocation();
                },
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
       Location Search (Open-Meteo Geocoding)
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
        if (!results.length) {
            els.suggestions.hidden = true;
            return;
        }
        els.suggestions.innerHTML = results.map((r, i) => {
            const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
            return `<div class="weather-suggestions__item" data-index="${i}">${escapeHtml(label)}</div>`;
        }).join('');
        els.suggestions.hidden = false;

        // Click handlers
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
       Weather Data Fetch (Open-Meteo)
       ================================================================ */
    async function fetchWeather(location) {
        console.log('[Weather] fetchWeather called for:', location.name, location.latitude, location.longitude);
        showLoading();
        try {
            const params = new URLSearchParams({
                latitude: location.latitude,
                longitude: location.longitude,
                current: [
                    'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
                    'is_day', 'precipitation', 'rain', 'showers', 'snowfall',
                    'weather_code', 'cloud_cover', 'pressure_msl',
                    'surface_pressure', 'wind_speed_10m', 'wind_direction_10m',
                    'wind_gusts_10m'
                ].join(','),
                hourly: [
                    'temperature_2m', 'relative_humidity_2m', 'dew_point_2m',
                    'apparent_temperature', 'precipitation_probability', 'precipitation',
                    'weather_code', 'visibility', 'wind_speed_10m', 'wind_direction_10m',
                    'uv_index', 'is_day'
                ].join(','),
                daily: [
                    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
                    'apparent_temperature_max', 'apparent_temperature_min',
                    'sunrise', 'sunset', 'uv_index_max',
                    'precipitation_sum', 'precipitation_probability_max',
                    'wind_speed_10m_max', 'wind_direction_10m_dominant'
                ].join(','),
                temperature_unit: state.useFahrenheit ? 'fahrenheit' : 'celsius',
                wind_speed_unit: state.useFahrenheit ? 'mph' : 'kmh',
                precipitation_unit: state.useFahrenheit ? 'inch' : 'mm',
                timezone: 'auto',
                forecast_days: 10
            });

            const url = `${WEATHER_URL}?${params}`;
            console.log('[Weather] Fetching:', url);
            const res = await fetch(url);
            console.log('[Weather] Response status:', res.status);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            weatherData = await res.json();
            console.log('[Weather] Data received, current temp:', weatherData.current?.temperature_2m);
            weatherData._location = location;
            weatherData._fetchedAt = new Date().toISOString();

            showContent();
            renderWeather();
            console.log('[Weather] Render complete');
        } catch (err) {
            console.error('[Weather] fetchWeather error:', err);
            showError(err.message || 'Failed to load weather data');
        }
    }

    /* ================================================================
       Render
       ================================================================ */
    function renderWeather() {
        if (!weatherData) return;
        try {

        const current = weatherData.current;
        const hourly = weatherData.hourly;
        const daily = weatherData.daily;
        const loc = weatherData._location;
        const isDay = !!current.is_day;
        const code = current.weather_code;

        // Theme
        root.className = 'weather-app ' + getThemeClass(code, isDay);

        // Location
        if (els.locationName) els.locationName.textContent = loc.name;
        if (els.lastUpdated) els.lastUpdated.textContent = 'Updated ' + formatTime12(weatherData._fetchedAt);

        // Current temp
        const temp = Math.round(current.temperature_2m);
        const feelsLike = Math.round(current.apparent_temperature);
        const unit = state.useFahrenheit ? 'F' : 'C';
        if (els.tempValue) els.tempValue.textContent = temp;
        if (els.tempUnit) els.tempUnit.textContent = unit;

        const wmoInfo = WMO_CODES[code] || WMO_CODES[0];
        if (els.caption) els.caption.textContent = wmoInfo.caption;
        if (els.feelslike) els.feelslike.textContent = `Feels like ${feelsLike}\u00B0`;

        // Hero icon
        if (els.heroIcon) {
            els.heroIcon.src = skycodePath(code, isDay, '89x89');
            els.heroIcon.alt = wmoInfo.caption;
        }

        // Details
        const windSpeed = Math.round(current.wind_speed_10m);
        const windUnit = state.useFahrenheit ? 'mph' : 'km/h';
        const windDir = windDirection(current.wind_direction_10m);
        if (els.wind) els.wind.textContent = `${windDir} ${windSpeed} ${windUnit}`;
        if (els.humidity) els.humidity.textContent = `${current.relative_humidity_2m}%`;
        if (els.pressure) els.pressure.textContent = `${Math.round(current.pressure_msl)} mb`;

        // UV index: use daily max since current may not have it
        const uvRaw = (daily.uv_index_max && daily.uv_index_max[0] != null) ? daily.uv_index_max[0] : null;
        const uvVal = uvRaw != null ? Math.round(uvRaw) : '--';
        if (els.uv) els.uv.textContent = `${uvVal} ${uvVal !== '--' ? uvDescription(uvVal) : ''}`;

        // Sun & atmosphere
        if (els.sunrise && daily.sunrise && daily.sunrise[0]) {
            els.sunrise.textContent = formatTime12(daily.sunrise[0]);
        }
        if (els.sunset && daily.sunset && daily.sunset[0]) {
            els.sunset.textContent = formatTime12(daily.sunset[0]);
        }

        // Find current hour index for visibility & dew point
        const nowIso = current.time || new Date().toISOString();
        const nowHour = new Date(nowIso).getHours();
        const todayStr = nowIso.slice(0, 10);
        let currentHourIdx = 0;
        if (hourly && hourly.time) {
            for (let i = 0; i < hourly.time.length; i++) {
                if (hourly.time[i].startsWith(todayStr) && new Date(hourly.time[i]).getHours() === nowHour) {
                    currentHourIdx = i;
                    break;
                }
            }
        }

        if (els.visibility && hourly.visibility && hourly.visibility[currentHourIdx] != null) {
            const visKm = hourly.visibility[currentHourIdx] / 1000;
            if (state.useFahrenheit) {
                els.visibility.textContent = `${(visKm * 0.621371).toFixed(1)} mi`;
            } else {
                els.visibility.textContent = `${visKm.toFixed(1)} km`;
            }
        }

        if (els.dewpoint && hourly.dew_point_2m && hourly.dew_point_2m[currentHourIdx] != null) {
            els.dewpoint.textContent = `${Math.round(hourly.dew_point_2m[currentHourIdx])}\u00B0${unit}`;
        }

        // Daily strip (next 5 days)
        if (els.dailyStrip) renderDailyStrip(daily);

        // Hourly forecast (next 24 hours)
        if (els.hourly) renderHourly(hourly, currentHourIdx);

        // Daily detail (10 days)
        if (els.dailyDetail) renderDailyDetail(daily);

        // Precipitation chart
        if (els.precipChart) renderPrecipChart(daily);

        // Day & Night detail
        if (els.daynight) renderDayNight(daily, hourly);

        // Historical weather (async, fires independently)
        if (els.historicalChart && loc) {
            fetchHistoricalWeather(loc).catch(err => console.warn('[Weather] Historical fetch failed:', err));
        }

        // Alert placeholder (Open-Meteo doesn't provide alerts, show extreme UV warning)
        if (els.alert) {
            if (uvVal !== '--' && uvVal >= 8) {
                els.alert.hidden = false;
                if (els.alertText) els.alertText.textContent = `\u26A0 UV Index is ${uvVal} (${uvDescription(uvVal)}) - Protect yourself from sun exposure`;
            } else {
                els.alert.hidden = true;
            }
        }

        } catch (renderErr) {
            console.error('[Weather] renderWeather error:', renderErr);
        }
    }

    function renderDailyStrip(daily) {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let html = '';
        let precipHtml = '';
        const count = Math.min(5, daily.time.length);
        for (let i = 0; i < count; i++) {
            const d = new Date(daily.time[i] + 'T12:00:00');
            const dayLabel = i === 0 ? 'Today' : days[d.getDay()];
            const code = daily.weather_code[i];
            const hi = Math.round(daily.temperature_2m_max[i]);
            const lo = Math.round(daily.temperature_2m_min[i]);
            const icon = skycodePath(code, true, '30x30');
            const precipProb = daily.precipitation_probability_max[i];
            html += `
                <div class="weather-daily-strip__day">
                    <span class="weather-daily-strip__label">${dayLabel}</span>
                    <img class="weather-daily-strip__icon" src="${icon}" alt="${(WMO_CODES[code] || WMO_CODES[0]).caption}" draggable="false">
                    <span class="weather-daily-strip__temps">
                        <span class="weather-daily-strip__high">${hi}\u00B0</span>
                        <span class="weather-daily-strip__sep">/</span>
                        <span class="weather-daily-strip__low">${lo}\u00B0</span>
                    </span>
                </div>`;
            // Precipitation row
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
        els.dailyStrip.innerHTML = html;
        if (els.dailyPrecip) els.dailyPrecip.innerHTML = precipHtml;
    }

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
            const idx = startIdx + i;
            const time = i === 0 ? 'Now' : formatTimeShort(hourly.time[idx]);
            const code = hourly.weather_code[idx];
            const isDay = !!hourly.is_day[idx];
            const temp = Math.round(hourly.temperature_2m[idx]);
            const caption = (WMO_CODES[code] || WMO_CODES[0]).caption;
            const icon = skycodePath(code, isDay, '30x30');
            const precipProb = hourly.precipitation_probability[idx] != null
                ? hourly.precipitation_probability[idx] + '%'
                : '--';

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
        els.hourly.innerHTML = html;
    }

    function renderDailyDetail(daily) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        let html = '';

        for (let i = 0; i < daily.time.length; i++) {
            const d = new Date(daily.time[i] + 'T12:00:00');
            const dayName = i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : dayNames[d.getDay()]);
            const dateStr = `${months[d.getMonth()]} ${d.getDate()}`;
            const code = daily.weather_code[i];
            const caption = (WMO_CODES[code] || WMO_CODES[0]).caption;
            const icon = skycodePath(code, true, '48x48');
            const hi = Math.round(daily.temperature_2m_max[i]);
            const lo = Math.round(daily.temperature_2m_min[i]);
            const windMax = Math.round(daily.wind_speed_10m_max[i]);
            const windUnit = state.useFahrenheit ? 'mph' : 'km/h';
            const windDir = windDirection(daily.wind_direction_10m_dominant[i]);
            const precipProb = daily.precipitation_probability_max[i] != null
                ? daily.precipitation_probability_max[i] + '% precip'
                : '';
            const precipSum = daily.precipitation_sum[i] != null && daily.precipitation_sum[i] > 0
                ? `${daily.precipitation_sum[i]} ${state.useFahrenheit ? 'in' : 'mm'}`
                : '';

            html += `
                <div class="weather-daily-detail__row">
                    <div class="weather-daily-detail__day">
                        <span class="weather-daily-detail__dayname">${dayName}</span>
                        <span class="weather-daily-detail__daynum">${dateStr}</span>
                    </div>
                    <img class="weather-daily-detail__icon" src="${icon}" alt="${caption}" draggable="false">
                    <div class="weather-daily-detail__info">
                        <span class="weather-daily-detail__caption">${caption}</span>
                        <div class="weather-daily-detail__extras">
                            <span>${windDir} ${windMax} ${windUnit}</span>
                            ${precipProb ? `<span>${precipProb}</span>` : ''}
                            ${precipSum ? `<span>${precipSum}</span>` : ''}
                        </div>
                    </div>
                    <div class="weather-daily-detail__temps">
                        <span class="weather-daily-detail__high">${hi}\u00B0</span>
                        <span class="weather-daily-detail__low">${lo}\u00B0</span>
                    </div>
                </div>`;
        }
        els.dailyDetail.innerHTML = html;
    }

    function renderPrecipChart(daily) {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const maxPrecip = Math.max(1, ...daily.precipitation_sum.map(v => v || 0));
        let html = '';

        const count = Math.min(7, daily.time.length);
        for (let i = 0; i < count; i++) {
            const d = new Date(daily.time[i] + 'T12:00:00');
            const label = i === 0 ? 'Today' : days[d.getDay()];
            const val = daily.precipitation_sum[i] || 0;
            const pct = Math.max(2, (val / maxPrecip) * 100);
            const unit = state.useFahrenheit ? 'in' : 'mm';

            html += `
                <div class="weather-precip-bar">
                    <div class="weather-precip-bar__value">${val > 0 ? val.toFixed(1) + ' ' + unit : ''}</div>
                    <div class="weather-precip-bar__fill" style="height: ${pct}%"></div>
                    <div class="weather-precip-bar__label">${label}</div>
                </div>`;
        }
        els.precipChart.innerHTML = html;
    }

    /* ================================================================
       Daily Forecast Page
       ================================================================ */
    function renderDailyForecastPage() {
        if (!weatherData || !els.dfCards) return;
        const daily = weatherData.daily;
        const hourly = weatherData.hourly;
        if (!daily || !daily.time) return;

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const unit = state.useFahrenheit ? 'F' : 'C';
        const windUnit = state.useFahrenheit ? 'mph' : 'km/h';

        let html = '';
        for (let i = 0; i < daily.time.length; i++) {
            const d = new Date(daily.time[i] + 'T12:00:00');
            const dayName = i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : dayNames[d.getDay()]);
            const dateStr = `${dayName} \u2013 ${months[d.getMonth()]} ${d.getDate()}`;
            const code = daily.weather_code[i];
            const dayCaption = (WMO_CODES[code] || WMO_CODES[0]).caption;
            const dayIcon = skycodePath(code, true, '48x48');
            const nightIcon = skycodePath(code, false, '48x48');
            const hi = Math.round(daily.temperature_2m_max[i]);
            const lo = Math.round(daily.temperature_2m_min[i]);
            const windMax = Math.round(daily.wind_speed_10m_max[i]);
            const windDir = windDirection(daily.wind_direction_10m_dominant[i]);
            const precipProb = daily.precipitation_probability_max[i] != null ? daily.precipitation_probability_max[i] + '%' : '--';
            const sunrise = daily.sunrise && daily.sunrise[i] ? formatTime12(daily.sunrise[i]) : '--';
            const sunset = daily.sunset && daily.sunset[i] ? formatTime12(daily.sunset[i]) : '--';
            const uvMax = daily.uv_index_max && daily.uv_index_max[i] != null ? Math.round(daily.uv_index_max[i]) : '--';

            // Find day/night humidity from hourly data
            let dayHumidity = '--', nightHumidity = '--';
            const dayStr = daily.time[i];
            if (hourly && hourly.time) {
                for (let j = 0; j < hourly.time.length; j++) {
                    if (hourly.time[j].startsWith(dayStr)) {
                        const h = new Date(hourly.time[j]).getHours();
                        if (h === 14 && hourly.relative_humidity_2m) dayHumidity = hourly.relative_humidity_2m[j] + '%';
                        if (h === 2 && hourly.relative_humidity_2m) nightHumidity = hourly.relative_humidity_2m[j] + '%';
                    }
                }
            }

            html += `
                <div class="weather-df-card">
                    <div class="weather-df-card__date">${dateStr}</div>
                    <div class="weather-df-card__periods">
                        <div class="weather-df-card__period">
                            <div class="weather-df-card__period-label">Day</div>
                            <div class="weather-df-card__period-main">
                                <img class="weather-df-card__period-icon" src="${dayIcon}" alt="${dayCaption}" draggable="false">
                                <div class="weather-df-card__period-info">
                                    <span class="weather-df-card__period-temp">${hi}\u00B0</span>
                                    <span class="weather-df-card__period-caption">${dayCaption}</span>
                                </div>
                            </div>
                            <div class="weather-df-card__props">
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Wind</span>
                                    <span class="weather-df-card__prop-value">${windDir} ${windMax} ${windUnit}</span>
                                </div>
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Humidity</span>
                                    <span class="weather-df-card__prop-value">${dayHumidity}</span>
                                </div>
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Sunrise</span>
                                    <span class="weather-df-card__prop-value">${sunrise}</span>
                                </div>
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Precip chance</span>
                                    <span class="weather-df-card__prop-value">${precipProb}</span>
                                </div>
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">UV Index</span>
                                    <span class="weather-df-card__prop-value">${uvMax !== '--' ? uvMax + ' ' + uvDescription(uvMax) : '--'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="weather-df-card__divider"></div>
                        <div class="weather-df-card__period">
                            <div class="weather-df-card__period-label">Night</div>
                            <div class="weather-df-card__period-main">
                                <img class="weather-df-card__period-icon" src="${nightIcon}" alt="${dayCaption}" draggable="false">
                                <div class="weather-df-card__period-info">
                                    <span class="weather-df-card__period-temp">${lo}\u00B0</span>
                                    <span class="weather-df-card__period-caption">${dayCaption}</span>
                                </div>
                            </div>
                            <div class="weather-df-card__props">
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Wind</span>
                                    <span class="weather-df-card__prop-value">${windDir} ${windMax} ${windUnit}</span>
                                </div>
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Humidity</span>
                                    <span class="weather-df-card__prop-value">${nightHumidity}</span>
                                </div>
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Sunset</span>
                                    <span class="weather-df-card__prop-value">${sunset}</span>
                                </div>
                                <div class="weather-df-card__prop">
                                    <span class="weather-df-card__prop-key">Precip chance</span>
                                    <span class="weather-df-card__prop-value">${precipProb}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;
        }
        els.dfCards.innerHTML = html;
    }

    /* ================================================================
       Places
       ================================================================ */
    function renderPlaces() {
        const places = state.places || [];
        let html = '';

        places.forEach((loc, i) => {
            const isHome = state.currentLocation &&
                Math.abs(loc.latitude - state.currentLocation.latitude) < 0.01 &&
                Math.abs(loc.longitude - state.currentLocation.longitude) < 0.01;
            html += `
                <div class="weather-place-tile" data-place-index="${i}" id="place-tile-${i}">
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

        els.placesGrid.innerHTML = html;

        // Fetch temps for each place
        places.forEach((loc, i) => fetchPlaceWeather(loc, i));

        // Click handlers
        els.placesGrid.querySelectorAll('.weather-place-tile[data-place-index]').forEach(tile => {
            tile.addEventListener('click', (e) => {
                if (e.target.closest('.weather-place-tile__remove')) return;
                const idx = parseInt(tile.dataset.placeIndex);
                const loc = state.places[idx];
                state.currentLocation = loc;
                persistState();
                currentSection = 'home';
                renderNavigation();
                fetchWeather(loc);
            });
        });

        // Remove buttons
        els.placesGrid.querySelectorAll('.weather-place-tile__remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.remove);
                state.places.splice(idx, 1);
                persistState();
                renderPlaces();
            });
        });

        // Add place tile
        const addTile = document.getElementById('add-place-tile');
        if (addTile) {
            addTile.addEventListener('click', () => {
                els.searchInput.focus();
            });
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
            const res = await fetch(`${WEATHER_URL}?${params}`);
            const data = await res.json();
            const tempEl = document.getElementById(`place-temp-${index}`);
            const iconEl = document.getElementById(`place-icon-${index}`);
            const captionEl = document.getElementById(`place-caption-${index}`);
            const hiloEl = document.getElementById(`place-hilo-${index}`);
            const tileEl = document.getElementById(`place-tile-${index}`);
            if (data.current) {
                const code = data.current.weather_code;
                const isDay = !!data.current.is_day;
                if (tempEl) tempEl.textContent = Math.round(data.current.temperature_2m) + '\u00B0';
                if (iconEl) iconEl.src = skycodePath(code, isDay, '48x48');
                if (captionEl) captionEl.textContent = (WMO_CODES[code] || WMO_CODES[0]).caption;
                // Apply weather-condition tile background
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
       Navigation
       ================================================================ */
    function renderNavigation() {
        els.navTabs.forEach(tab => {
            const isActive = tab.dataset.section === currentSection;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', isActive);
        });

        const sections = { home: els.home, dailyforecast: els.dailyForecast, places: els.places, worldweather: els.world };
        for (const [key, el] of Object.entries(sections)) {
            if (el) el.hidden = key !== currentSection;
        }

        if (currentSection === 'dailyforecast') renderDailyForecastPage();
        if (currentSection === 'places') renderPlaces();
        if (currentSection === 'worldweather') renderWorldWeather();
    }

    /* ================================================================
       Day/Night Detail
       ================================================================ */
    function renderDayNight(daily, hourly) {
        if (!daily || !daily.time || daily.time.length < 1) return;

        const unit = state.useFahrenheit ? 'F' : 'C';
        const windUnit = state.useFahrenheit ? 'mph' : 'km/h';
        // Show today's day/night breakdown
        const hi = Math.round(daily.temperature_2m_max[0]);
        const lo = Math.round(daily.temperature_2m_min[0]);
        const dayCode = daily.weather_code[0];
        const dayCaption = (WMO_CODES[dayCode] || WMO_CODES[0]).caption;
        const dayIcon = skycodePath(dayCode, true, '48x48');
        const nightIcon = skycodePath(dayCode, false, '48x48');
        const windMax = Math.round(daily.wind_speed_10m_max[0]);
        const windDir = windDirection(daily.wind_direction_10m_dominant[0]);
        const precipProb = daily.precipitation_probability_max[0] != null ? daily.precipitation_probability_max[0] + '%' : '--';
        const sunrise = daily.sunrise && daily.sunrise[0] ? formatTime12(daily.sunrise[0]) : '--';
        const sunset = daily.sunset && daily.sunset[0] ? formatTime12(daily.sunset[0]) : '--';

        // Find midday/midnight humidity from hourly data
        let dayHumidity = '--', nightHumidity = '--';
        const todayStr = daily.time[0];
        if (hourly && hourly.time) {
            for (let i = 0; i < hourly.time.length; i++) {
                if (hourly.time[i].startsWith(todayStr)) {
                    const h = new Date(hourly.time[i]).getHours();
                    if (h === 14 && hourly.relative_humidity_2m) dayHumidity = hourly.relative_humidity_2m[i] + '%';
                    if (h === 2 && hourly.relative_humidity_2m) nightHumidity = hourly.relative_humidity_2m[i] + '%';
                }
            }
        }

        const html = `
            <div class="weather-daynight__period">
                <div class="weather-daynight__period-header">
                    <span class="weather-daynight__period-label">Day</span>
                    <img class="weather-daynight__period-icon" src="${dayIcon}" alt="${dayCaption}" draggable="false">
                    <div class="weather-daynight__period-main">
                        <span class="weather-daynight__period-temp">${hi}\u00B0${unit}</span>
                        <span class="weather-daynight__period-caption">${dayCaption}</span>
                    </div>
                </div>
                <div class="weather-daynight__period-props">
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Wind</span>
                        <span class="weather-daynight__prop-value">${windDir} ${windMax} ${windUnit}</span>
                    </div>
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Humidity</span>
                        <span class="weather-daynight__prop-value">${dayHumidity}</span>
                    </div>
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Sunrise</span>
                        <span class="weather-daynight__prop-value">${sunrise}</span>
                    </div>
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Precip chance</span>
                        <span class="weather-daynight__prop-value">${precipProb}</span>
                    </div>
                </div>
            </div>
            <div class="weather-daynight__period">
                <div class="weather-daynight__period-header">
                    <span class="weather-daynight__period-label">Night</span>
                    <img class="weather-daynight__period-icon" src="${nightIcon}" alt="${dayCaption}" draggable="false">
                    <div class="weather-daynight__period-main">
                        <span class="weather-daynight__period-temp">${lo}\u00B0${unit}</span>
                        <span class="weather-daynight__period-caption">${dayCaption}</span>
                    </div>
                </div>
                <div class="weather-daynight__period-props">
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Wind</span>
                        <span class="weather-daynight__prop-value">${windDir} ${windMax} ${windUnit}</span>
                    </div>
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Humidity</span>
                        <span class="weather-daynight__prop-value">${nightHumidity}</span>
                    </div>
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Sunset</span>
                        <span class="weather-daynight__prop-value">${sunset}</span>
                    </div>
                    <div class="weather-daynight__prop">
                        <span class="weather-daynight__prop-key">Precip chance</span>
                        <span class="weather-daynight__prop-value">${precipProb}</span>
                    </div>
                </div>
            </div>`;
        els.daynight.innerHTML = html;
    }

    /* ================================================================
       Historical Weather (Open-Meteo Historical API)
       ================================================================ */
    const HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';
    let historicalData = null;
    let historicalChart = 'temperature';
    let historicalSelectedMonth = new Date().getMonth();

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
            const now = new Date();
            const endDate = `${now.getFullYear() - 1}-12-31`;
            const startDate = `${now.getFullYear() - 1}-01-01`;

            const params = new URLSearchParams({
                latitude: location.latitude,
                longitude: location.longitude,
                start_date: startDate,
                end_date: endDate,
                daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
                temperature_unit: state.useFahrenheit ? 'fahrenheit' : 'celsius',
                precipitation_unit: state.useFahrenheit ? 'inch' : 'mm',
                timezone: 'auto'
            });

            const res = await fetch(`${HISTORICAL_URL}?${params}`);
            if (!res.ok) return;
            const data = await res.json();

            // Aggregate into monthly averages
            const months = [];
            for (let m = 0; m < 12; m++) {
                months.push({ maxTemps: [], minTemps: [], precip: [] });
            }

            if (data.daily && data.daily.time) {
                for (let i = 0; i < data.daily.time.length; i++) {
                    const month = new Date(data.daily.time[i] + 'T12:00:00').getMonth();
                    if (data.daily.temperature_2m_max[i] != null) months[month].maxTemps.push(data.daily.temperature_2m_max[i]);
                    if (data.daily.temperature_2m_min[i] != null) months[month].minTemps.push(data.daily.temperature_2m_min[i]);
                    if (data.daily.precipitation_sum[i] != null) months[month].precip.push(data.daily.precipitation_sum[i]);
                }
            }

            historicalData = months.map((m, i) => ({
                month: i,
                avgHigh: m.maxTemps.length ? m.maxTemps.reduce((a, b) => a + b, 0) / m.maxTemps.length : 0,
                avgLow: m.minTemps.length ? m.minTemps.reduce((a, b) => a + b, 0) / m.minTemps.length : 0,
                totalPrecip: m.precip.reduce((a, b) => a + b, 0),
                avgPrecip: m.precip.length ? m.precip.reduce((a, b) => a + b, 0) / m.precip.length : 0,
                recordHigh: m.maxTemps.length ? Math.max(...m.maxTemps) : 0,
                recordLow: m.minTemps.length ? Math.min(...m.minTemps) : 0,
                rainyDays: m.precip.filter(v => v > 0.01).length
            }));

            renderHistoricalChart();
        } catch (e) {
            console.error('[Weather] Historical fetch error:', e);
        }
    }

    function renderHistoricalChart() {
        if (!historicalData || !els.historicalChart) return;

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const isTemp = historicalChart === 'temperature';

        let maxVal;
        if (isTemp) {
            maxVal = Math.max(1, ...historicalData.map(m => m.avgHigh));
        } else {
            maxVal = Math.max(1, ...historicalData.map(m => m.totalPrecip));
        }

        let barsHtml = '';
        let labelsHtml = '';

        for (let i = 0; i < 12; i++) {
            const d = historicalData[i];
            const val = isTemp ? d.avgHigh : d.totalPrecip;
            const pct = Math.max(3, (val / maxVal) * 100);
            const fillClass = isTemp ? 'weather-hist-bar__fill--temp' : 'weather-hist-bar__fill--precip';
            const sel = i === historicalSelectedMonth ? ' is-selected' : '';
            const label = isTemp ? `${Math.round(val)}\u00B0` : (val > 0 ? val.toFixed(1) : '');

            barsHtml += `
                <div class="weather-hist-bar${sel}" data-month="${i}">
                    <div class="weather-hist-bar__value">${label}</div>
                    <div class="weather-hist-bar__fill ${fillClass}" style="height: ${pct}%"></div>
                </div>`;

            labelsHtml += `<div class="weather-hist-month-label${sel}" data-month="${i}">${monthNames[i]}</div>`;
        }

        els.historicalChart.innerHTML = barsHtml;
        els.historicalMonths.innerHTML = labelsHtml;

        // Click handlers
        root.querySelectorAll('.weather-hist-bar, .weather-hist-month-label').forEach(el => {
            el.addEventListener('click', () => {
                historicalSelectedMonth = parseInt(el.dataset.month);
                renderHistoricalChart();
            });
        });

        // Detail panel
        renderHistoricalDetail();
    }

    function renderHistoricalDetail() {
        if (!historicalData || !els.historicalDetail) return;
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const d = historicalData[historicalSelectedMonth];
        const unit = state.useFahrenheit ? 'F' : 'C';
        const precipUnit = state.useFahrenheit ? 'in' : 'mm';

        els.historicalDetail.innerHTML = `
            <div class="weather-hist-detail__title">${monthNames[historicalSelectedMonth]} (last year)</div>
            <div class="weather-hist-detail__grid">
                <div class="weather-hist-detail__item">
                    <span class="weather-hist-detail__key">Avg High</span>
                    <span class="weather-hist-detail__value">${Math.round(d.avgHigh)}\u00B0${unit}</span>
                </div>
                <div class="weather-hist-detail__item">
                    <span class="weather-hist-detail__key">Avg Low</span>
                    <span class="weather-hist-detail__value">${Math.round(d.avgLow)}\u00B0${unit}</span>
                </div>
                <div class="weather-hist-detail__item">
                    <span class="weather-hist-detail__key">Record High</span>
                    <span class="weather-hist-detail__value">${Math.round(d.recordHigh)}\u00B0${unit}</span>
                </div>
                <div class="weather-hist-detail__item">
                    <span class="weather-hist-detail__key">Record Low</span>
                    <span class="weather-hist-detail__value">${Math.round(d.recordLow)}\u00B0${unit}</span>
                </div>
                <div class="weather-hist-detail__item">
                    <span class="weather-hist-detail__key">Total Precip</span>
                    <span class="weather-hist-detail__value">${d.totalPrecip.toFixed(1)} ${precipUnit}</span>
                </div>
                <div class="weather-hist-detail__item">
                    <span class="weather-hist-detail__key">Rainy Days</span>
                    <span class="weather-hist-detail__value">${d.rainyDays}</span>
                </div>
            </div>`;
    }

    /* ================================================================
       World Weather
       ================================================================ */
    // City data from real Bing Weather app (locationGroups.json) with pixel coords on 1366x768 world map
    const WORLD_CITIES = [
        { first: 'Los Angeles', second: 'UNITED STATES', lat: 34.05, lon: -118.25, x: 211, y: 342 },
        { first: 'New Delhi', second: 'INDIA', lat: 28.61, lon: 77.21, x: 938, y: 377 },
        { first: 'Rio de Janeiro', second: 'BRAZIL', lat: -22.98, lon: -43.19, x: 490, y: 562 },
        { first: 'Paris', second: 'FRANCE', lat: 48.86, lon: 2.35, x: 658, y: 280 },
        { first: 'Beijing', second: 'CHINA', lat: 39.91, lon: 116.39, x: 1085, y: 290 },
        { first: 'Cape Town', second: 'SOUTH AFRICA', lat: -33.97, lon: 18.60, x: 693, y: 620 },
        { first: 'Sydney', second: 'AUSTRALIA', lat: -33.87, lon: 151.21, x: 1230, y: 605 },
        { first: 'New York', second: 'UNITED STATES', lat: 40.71, lon: -74.01, x: 370, y: 300 },
        { first: 'Buenos Aires', second: 'ARGENTINA', lat: -34.61, lon: -58.38, x: 427, y: 655 },
        { first: 'Tokyo', second: 'JAPAN', lat: 35.68, lon: 139.69, x: 1195, y: 315 },
        { first: 'Cairo', second: 'EGYPT', lat: 30.04, lon: 31.24, x: 730, y: 355 },
        { first: 'Moscow', second: 'RUSSIA', lat: 55.76, lon: 37.62, x: 745, y: 210 },
        { first: 'London', second: 'UNITED KINGDOM', lat: 51.51, lon: -0.13, x: 640, y: 255 },
        { first: 'Melbourne', second: 'AUSTRALIA', lat: -37.81, lon: 144.96, x: 1200, y: 640 },
        { first: 'Mumbai', second: 'INDIA', lat: 19.08, lon: 72.88, x: 905, y: 405 },
        { first: 'Dubai', second: 'UAE', lat: 25.20, lon: 55.27, x: 840, y: 380 },
        { first: 'Seoul', second: 'SOUTH KOREA', lat: 37.57, lon: 126.98, x: 1150, y: 290 },
        { first: 'Singapore', second: 'SINGAPORE', lat: 1.35, lon: 103.82, x: 1055, y: 480 }
    ];

    // Continent zoom properties from real Bing Weather app (WorldWeather.js)
    const CONTINENT_PROPS = {
        NorthAmerica: { zoomOrigin: '156.01px 230.70px', scale: 2.51 },
        SouthAmerica: { zoomOrigin: '372.54px 687.77px', scale: 2.69 },
        Europe: { zoomOrigin: '787.20px 203.10px', scale: 4 },
        Africa: { zoomOrigin: '820.55px 526.24px', scale: 2.66 },
        Asia: { zoomOrigin: '1437.27px 318.73px', scale: 2.02 },
        Oceania: { zoomOrigin: '1466.44px 657.27px', scale: 3.40 }
    };

    // Map city to continent for filtering
    const CITY_CONTINENTS = {
        'Los Angeles': 'NorthAmerica', 'New York': 'NorthAmerica',
        'Rio de Janeiro': 'SouthAmerica', 'Buenos Aires': 'SouthAmerica',
        'Paris': 'Europe', 'London': 'Europe', 'Moscow': 'Europe',
        'Cairo': 'Africa', 'Cape Town': 'Africa',
        'New Delhi': 'Asia', 'Beijing': 'Asia', 'Tokyo': 'Asia',
        'Mumbai': 'Asia', 'Dubai': 'Asia', 'Seoul': 'Asia', 'Singapore': 'Asia',
        'Sydney': 'Oceania', 'Melbourne': 'Oceania'
    };

    let worldZoomedContinent = null;

    function attachWorldEvents() {
        // SVG polygon clicks
        const svg = root.querySelector('.weather-world__svg');
        if (svg) {
            svg.addEventListener('click', (e) => {
                const poly = e.target.closest('polygon[data-continent]');
                if (poly) zoomToContinent(poly.dataset.continent);
            });
        }

        // Label clicks
        const labels = root.querySelector('.weather-world__labels');
        if (labels) {
            labels.addEventListener('click', (e) => {
                const label = e.target.closest('.weather-world__label');
                if (label) zoomToContinent(label.dataset.continent);
            });
        }

        // Back button
        const backBtn = $('#weather-world-back');
        if (backBtn) {
            backBtn.addEventListener('click', () => zoomOut());
        }
    }

    function renderWorldWeather() {
        worldZoomedContinent = null;
        const viewport = $('#weather-world-viewport');
        const backBtn = $('#weather-world-back');
        const labelsEl = $('#weather-world-labels');
        if (viewport) {
            viewport.style.transform = '';
            viewport.style.transformOrigin = '';
        }
        if (backBtn) backBtn.hidden = true;
        if (labelsEl) labelsEl.style.display = '';
        if (els.worldCities) els.worldCities.innerHTML = '';

        // Fetch weather for all world cities (group 0 — shown on world view)
        WORLD_CITIES.forEach(city => fetchWorldCityWeather(city));
    }

    function zoomToContinent(continent) {
        const props = CONTINENT_PROPS[continent];
        if (!props) return;

        worldZoomedContinent = continent;
        const viewport = $('#weather-world-viewport');
        const backBtn = $('#weather-world-back');
        const labelsEl = $('#weather-world-labels');

        if (viewport) {
            viewport.style.transformOrigin = props.zoomOrigin;
            viewport.style.transform = `scale(${props.scale})`;
        }
        if (backBtn) backBtn.hidden = false;
        if (labelsEl) labelsEl.style.display = 'none';
    }

    function zoomOut() {
        worldZoomedContinent = null;
        const viewport = $('#weather-world-viewport');
        const backBtn = $('#weather-world-back');
        const labelsEl = $('#weather-world-labels');

        if (viewport) {
            viewport.style.transform = '';
            viewport.style.transformOrigin = '';
        }
        if (backBtn) backBtn.hidden = true;
        if (labelsEl) labelsEl.style.display = '';
    }

    async function fetchWorldCityWeather(city) {
        try {
            const params = new URLSearchParams({
                latitude: city.lat,
                longitude: city.lon,
                current: 'temperature_2m,weather_code,is_day',
                temperature_unit: state.useFahrenheit ? 'fahrenheit' : 'celsius',
                timezone: 'auto'
            });
            const res = await fetch(`${WEATHER_URL}?${params}`);
            const data = await res.json();
            if (!data.current || !els.worldCities) return;

            const temp = Math.round(data.current.temperature_2m);
            const icon = skycodePath(data.current.weather_code, !!data.current.is_day, '30x30');

            const div = document.createElement('div');
            div.className = 'weather-world-city';
            // Position as percentage of 1366x768 map
            div.style.left = ((city.x / 1366) * 100) + '%';
            div.style.top = ((city.y / 768) * 100) + '%';
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
        } catch (e) { /* ignore */ }
    }

    /* ================================================================
       Charms Settings Integration
       ================================================================ */
    function registerSettingsWithCharms() {
        // Expose a settings provider that the main app's updateSettingsFlyout can discover
        window.WeatherAppSettings = {
            appId: 'weather',
            getMenuItems: function () {
                return [
                    { label: 'Options', action: 'weather-options' },
                    { label: 'About', action: 'weather-about' }
                ];
            }
        };

        // Listen for settings menu item clicks (delegated in main app.js)
        document.addEventListener('click', function (e) {
            const item = e.target.closest('.settings-menu-item[data-action^="weather-"]');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'weather-options') showWeatherSettingsPanel();
            if (action === 'weather-about') showWeatherAboutPanel();
        });
    }

    function showWeatherSettingsPanel() {
        // Create a settings panel that slides into the charms settings flyout
        const $menuItems = document.getElementById('settings-menu-items');
        if (!$menuItems) return;

        const container = $menuItems.closest('.settings-panel');
        if (!container) return;

        // Build the options panel
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
                        <div class="weather-settings-heading">Search History</div>
                        <label class="weather-settings-toggle">
                            <span>Show search history</span>
                            <input type="checkbox" class="weather-search-history-toggle" ${searchHistoryEnabled ? 'checked' : ''}>
                        </label>
                        <button type="button" class="weather-settings-btn weather-clear-history">Clear search history</button>
                    </div>
                    <div class="weather-settings-section">
                        <div class="weather-settings-heading">Default Location</div>
                        <div class="weather-settings-info">${state.currentLocation ? escapeHtml(state.currentLocation.name) : 'Not set'}</div>
                    </div>
                    <div class="weather-settings-section">
                        <div class="weather-settings-heading">Saved Places</div>
                        <div class="weather-settings-info">${(state.places || []).length} location(s)</div>
                        <button type="button" class="weather-settings-btn weather-clear-places">Clear all places</button>
                    </div>
                </div>`;
            container.parentElement.appendChild(panel);

            // Back button
            panel.querySelector('.weather-settings-back').addEventListener('click', () => {
                panel.style.display = 'none';
                container.style.display = '';
            });

            // Unit change
            panel.querySelectorAll('input[name="weather-unit"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    state.useFahrenheit = radio.value === 'F';
                    persistState();
                    if (weatherData) {
                        fetchWeather(state.currentLocation);
                    }
                });
            });

            // Clear places
            panel.querySelector('.weather-clear-places').addEventListener('click', () => {
                state.places = [];
                if (state.currentLocation) state.places.push({ ...state.currentLocation });
                persistState();
                panel.querySelector('.weather-clear-places').previousElementSibling.textContent = state.places.length + ' location(s)';
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
                    <div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-bottom: 20px;">Version 3.0</div>
                    <div style="font-size: 13px; margin-bottom: 16px;">
                        A recreation of the Windows 8.1 Bing Weather app.
                    </div>
                    <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Data provided by</div>
                    <div style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.8;">
                        Open-Meteo Weather API<br>
                        Open-Meteo Geocoding API<br>
                        Open-Meteo Historical Archive API
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
       Show/Hide States
       ================================================================ */
    function showLoading() {
        if (els.loading) els.loading.hidden = false;
        if (els.error) els.error.hidden = true;
        if (els.panoramaContent) els.panoramaContent.hidden = true;
    }

    function showError(msg) {
        console.error('[Weather] showError:', msg);
        if (els.loading) els.loading.hidden = true;
        if (els.error) els.error.hidden = false;
        if (els.panoramaContent) els.panoramaContent.hidden = true;
        if (els.errorMessage) els.errorMessage.textContent = msg;
    }

    function showContent() {
        if (els.loading) els.loading.hidden = true;
        if (els.error) els.error.hidden = true;
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
                if (!s.places) s.places = [];
                if (s.useFahrenheit === undefined) s.useFahrenheit = true;
                return s;
            }
        } catch (e) { /* ignore */ }
        return { currentLocation: null, places: [], useFahrenheit: true };
    }

    function persistState() {
        try {
            // Add current location to places if not already there
            if (state.currentLocation) {
                const exists = state.places.some(p =>
                    Math.abs(p.latitude - state.currentLocation.latitude) < 0.01 &&
                    Math.abs(p.longitude - state.currentLocation.longitude) < 0.01
                );
                if (!exists) {
                    state.places.push({ ...state.currentLocation });
                }
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { /* ignore */ }
    }

    /* ================================================================
       Helpers
       ================================================================ */
    function escapeHtml(str) {
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }
})();
