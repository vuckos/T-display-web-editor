// T-Display Web Editor - Main Script
// Modern, refactored code for LCD display configuration

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert RGB565 color format to RGB888 (hex)
 */
function rgb565ToRgb888(rgb565) {
    let r = ((rgb565 >> 11) & 0x1F) << 3;
    let g = ((rgb565 >> 5) & 0x3F) << 2;
    let b = (rgb565 & 0x1F) << 3;

    // Rounding for better color accuracy
    r = r + (r >> 5);
    g = g + (g >> 6);
    b = b + (b >> 5);

    return (r << 16) | (g << 8) | b;
}

/**
 * Convert RGB888 (hex string like "#ff0000") to RGB565 format
 */
function rgb888ToRgb565(hexColor) {
    // Remove # if present
    const hex = hexColor.replace('#', '');

    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Convert to RGB565 (5 bits red, 6 bits green, 5 bits blue)
    const r5 = (r >> 3) & 0x1F;
    const g6 = (g >> 2) & 0x3F;
    const b5 = (b >> 3) & 0x1F;

    const rgb565 = (r5 << 11) | (g6 << 5) | b5;

    // Return as hex string with 0x prefix
    return '0x' + rgb565.toString(16).padStart(4, '0');
}

/**
 * Wait for config data to load
 */
function waitForConfig(timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (window.__configData) return resolve(window.__configData);

        const interval = 100;
        let waited = 0;
        const id = setInterval(() => {
            if (window.__configData) {
                clearInterval(id);
                return resolve(window.__configData);
            }
            waited += interval;
            if (waited >= timeout) {
                clearInterval(id);
                return reject(new Error('Timed out waiting for configuration data'));
            }
        }, interval);
    });
}

// ============================================================================
// Canvas Manager
// ============================================================================

class CanvasManager {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.selectedCellIndex = -1;
        this.zoomLevel = 1.0;
        this.minZoom = 0.5;
        this.maxZoom = 4.0;
        this.zoomStep = 0.25;
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setZoom(level) {
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
        this.canvas.style.transform = `scale(${this.zoomLevel})`;
        return this.zoomLevel;
    }

    zoomIn() {
        return this.setZoom(this.zoomLevel + this.zoomStep);
    }

    zoomOut() {
        return this.setZoom(this.zoomLevel - this.zoomStep);
    }

    resetZoom() {
        return this.setZoom(1.0);
    }

    getZoomPercent() {
        return Math.round(this.zoomLevel * 100);
    }

    drawCell(cell) {
        const px = parseInt(cell.posx, 10) || 0;
        const py = parseInt(cell.posy, 10) || 0;
        const w = parseInt(cell.sizex, 10) || 0;
        const h = parseInt(cell.sizey, 10) || 0;
        const bg = parseInt(cell.bg_color, 16) || 0;
        const fg = parseInt(cell.font1_color, 16) || 0;

        // Draw background
        const rgbBg = rgb565ToRgb888(bg).toString(16).padStart(6, '0');
        this.ctx.fillStyle = '#' + rgbBg;
        this.ctx.fillRect(px, py, w, h);

        // Draw text label
        const rgbFg = rgb565ToRgb888(fg).toString(16).padStart(6, '0');
        this.ctx.fillStyle = '#' + rgbFg;
        this.ctx.font = '12px monospace';
        this.ctx.fillText(cell.name || '', px + 5, py + 15);
    }

    drawScreen(cells) {
        this.clear();
        cells.forEach(cell => this.drawCell(cell));
    }

    highlightCell(cells, selectedIndex) {
        cells.forEach((cell, idx) => {
            const x = parseInt(cell.posx, 10) || 0;
            const y = parseInt(cell.posy, 10) || 0;
            const w = parseInt(cell.sizex, 10) || 0;
            const h = parseInt(cell.sizey, 10) || 0;

            if (idx !== selectedIndex) {
                // Dim non-selected cells
                this.ctx.save();
                this.ctx.globalAlpha = 0.7;
                this.ctx.fillStyle = 'black';
                this.ctx.fillRect(x, y, w, h);
                this.ctx.restore();
            } else {
                // Highlight selected cell
                this.ctx.strokeStyle = '#00ff88';
                this.ctx.lineWidth = 3;
                this.ctx.shadowColor = '#00ff88';
                this.ctx.shadowBlur = 10;
                this.ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
                this.ctx.shadowBlur = 0;
            }
        });
    }

    findCellAtPosition(x, y, cells) {
        return cells.findIndex(cell => {
            const px = parseInt(cell.posx, 10) || 0;
            const py = parseInt(cell.posy, 10) || 0;
            const w = parseInt(cell.sizex, 10) || 0;
            const h = parseInt(cell.sizey, 10) || 0;
            return x >= px && x <= px + w && y >= py && y <= py + h;
        });
    }
}

// ============================================================================
// WebSocket Manager
// ============================================================================

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000; // 2 seconds
        this.messageCallback = null;
        this.statusCallback = null;
        this.messageCount = 0;
        this.lastMessageTime = null;
        this.shouldReconnect = false;
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket already connected');
            return;
        }

        // Auto-detect protocol (ws:// or wss://)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        this.updateStatus('connecting', 'Connecting to ' + wsUrl + '...');

        try {
            this.ws = new WebSocket(wsUrl);
            this.shouldReconnect = true;

            this.ws.onopen = (event) => {
                console.log('WebSocket connected:', event);
                this.updateStatus('connected', 'Connected - Waiting for data...');
                this.reconnectAttempts = 0;
            };

            this.ws.onmessage = (event) => {
                console.log('WebSocket message received:', event.data);
                this.messageCount++;
                this.lastMessageTime = Date.now();

                try {
                    const data = JSON.parse(event.data);
                    if (this.messageCallback) {
                        this.messageCallback(data);
                    }
                    this.updateStatus('connected', 'Connected - Receiving updates');
                } catch (e) {
                    console.error('Error parsing JSON:', e);
                    this.updateStatus('error', 'Error parsing data: ' + e.message);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateStatus('error', 'Connection error');
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket closed:', event);
                this.updateStatus('disconnected', 'Disconnected (Code: ' + event.code + ')');

                // Auto-reconnect if enabled and not exceeded max attempts
                if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    setTimeout(() => {
                        console.log(`Reconnecting... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                        this.connect();
                    }, this.reconnectDelay);
                }
            };
        } catch (e) {
            console.error('Error creating WebSocket:', e);
            this.updateStatus('error', 'Connection failed: ' + e.message);
        }
    }

    disconnect() {
        this.shouldReconnect = false;
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.updateStatus('disconnected', 'Manually disconnected');
        }
    }

    onMessage(callback) {
        this.messageCallback = callback;
    }

    onStatusChange(callback) {
        this.statusCallback = callback;
    }

    updateStatus(status, message) {
        if (this.statusCallback) {
            this.statusCallback(status, message);
        }
    }

    getMessageCount() {
        return this.messageCount;
    }

    getLastMessageTime() {
        return this.lastMessageTime;
    }
}

// ============================================================================
// Live Data Manager
// ============================================================================

class LiveDataManager {
    constructor(canvasManager, wsManager) {
        this.canvasManager = canvasManager;
        this.wsManager = wsManager;
        this.currentCells = [];
        this.updateRateWindow = [];
        this.updateRateWindowSize = 10; // Track last 10 messages for rate calculation
    }

    initialize() {
        // Setup WebSocket callbacks
        this.wsManager.onMessage((data) => this.handleLiveData(data));
        this.wsManager.onStatusChange((status, message) => this.updateConnectionUI(status, message));

        // Setup event listeners
        this.setupEventListeners();

        // Initialize UI
        this.updateStatistics();
    }

    setupEventListeners() {
        // Connect button
        const connectBtn = document.getElementById('connectButton');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => {
                this.wsManager.connect();
            });
        }

        // Disconnect button
        const disconnectBtn = document.getElementById('disconnectButton');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => {
                this.wsManager.disconnect();
            });
        }

        // Zoom controls
        const liveZoomIn = document.getElementById('liveZoomIn');
        if (liveZoomIn) {
            liveZoomIn.addEventListener('click', () => {
                const newZoom = this.canvasManager.zoomIn();
                this.updateZoomDisplay(newZoom);
            });
        }

        const liveZoomOut = document.getElementById('liveZoomOut');
        if (liveZoomOut) {
            liveZoomOut.addEventListener('click', () => {
                const newZoom = this.canvasManager.zoomOut();
                this.updateZoomDisplay(newZoom);
            });
        }

        const liveZoomReset = document.getElementById('liveZoomReset');
        if (liveZoomReset) {
            liveZoomReset.addEventListener('click', () => {
                const newZoom = this.canvasManager.resetZoom();
                this.updateZoomDisplay(newZoom);
            });
        }
    }

    handleLiveData(data) {
        // Validate data structure
        if (!data.cells || !Array.isArray(data.cells)) {
            console.warn('Invalid data format: missing cells array');
            return;
        }

        // Filter enabled cells only
        this.currentCells = data.cells.filter(cell => cell.enabled);

        // Update canvas
        this.drawLiveCells();

        // Update statistics
        this.updateStatistics();

        // Update last update time
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        const lastUpdateEl = document.getElementById('lastUpdateTime');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = 'Last update: ' + timeStr;
        }

        // Track update rate
        this.updateRateWindow.push(Date.now());
        if (this.updateRateWindow.length > this.updateRateWindowSize) {
            this.updateRateWindow.shift();
        }
    }

    drawLiveCells() {
        // Clear canvas
        this.canvasManager.clear();

        // Draw each enabled cell
        this.currentCells.forEach(cell => {
            this.drawLiveCell(cell);
        });
    }

    drawLiveCell(cell) {
        const ctx = this.canvasManager.ctx;

        // Parse position and size
        const px = parseInt(cell.posx, 10) || 0;
        const py = parseInt(cell.posy, 10) || 0;
        const w = parseInt(cell.sizex, 10) || 0;
        const h = parseInt(cell.sizey, 10) || 0;

        // Convert RGB565 colors to RGB888
        const bgColor = rgb565ToRgb888(parseInt(cell.bg_color, 16) || 0);
        const fgColor = rgb565ToRgb888(parseInt(cell.font1_color, 16) || 0xFFFF);

        // Draw background rectangle
        ctx.fillStyle = '#' + bgColor.toString(16).padStart(6, '0');
        ctx.fillRect(px, py, w, h);

        // Determine display value
        let displayValue = '';
        if (cell.str_value !== undefined && cell.str_value !== null) {
            displayValue = cell.str_value;
        } else if (cell.value !== undefined && cell.value !== null) {
            const decimals = parseInt(cell.decimalPlaces, 10) || 0;
            displayValue = cell.value.toFixed(decimals);
        }

        // Draw value text with adaptive font sizing
        if (displayValue && w > 0 && h > 0) {
            const fontSize = Math.min(w / 4, h / 2, 24);
            ctx.font = `bold ${fontSize}px monospace`;
            ctx.fillStyle = '#' + fgColor.toString(16).padStart(6, '0');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayValue, px + w / 2, py + h / 2);
        }

        // Draw red border if data is invalid
        if (!cell.data1_valid) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, w, h);
        }
    }

    updateConnectionUI(status, message) {
        const statusIndicator = document.getElementById('statusIndicator');
        const wsStatusText = document.getElementById('wsStatusText');

        if (statusIndicator) {
            // Remove all status classes
            statusIndicator.classList.remove('connected', 'connecting', 'disconnected');

            // Add appropriate class based on status
            if (status === 'connected') {
                statusIndicator.classList.add('connected');
            } else if (status === 'connecting') {
                statusIndicator.classList.add('connecting');
            }
            // Default is disconnected (red)
        }

        if (wsStatusText) {
            wsStatusText.textContent = message;
        }
    }

    updateStatistics() {
        // Update messages received
        const msgCountEl = document.getElementById('statMessagesReceived');
        if (msgCountEl) {
            msgCountEl.textContent = this.wsManager.getMessageCount();
        }

        // Update active cells count
        const activeCellsEl = document.getElementById('statActiveCells');
        if (activeCellsEl) {
            activeCellsEl.textContent = this.currentCells.length;
        }

        // Update update rate (Hz)
        const updateRateEl = document.getElementById('statUpdateRate');
        if (updateRateEl) {
            const rate = this.calculateUpdateRate();
            updateRateEl.textContent = rate.toFixed(2) + ' Hz';
        }
    }

    calculateUpdateRate() {
        if (this.updateRateWindow.length < 2) {
            return 0;
        }

        const timeSpan = this.updateRateWindow[this.updateRateWindow.length - 1] - this.updateRateWindow[0];
        const messageCount = this.updateRateWindow.length - 1;

        if (timeSpan === 0) {
            return 0;
        }

        // Convert to Hz (messages per second)
        return (messageCount / timeSpan) * 1000;
    }

    updateZoomDisplay(zoomLevel) {
        const zoomLevelEl = document.getElementById('liveZoomLevel');
        if (zoomLevelEl) {
            zoomLevelEl.textContent = Math.round(zoomLevel * 100) + '%';
        }
    }
}

// ============================================================================
// Config Manager
// ============================================================================

class ConfigManager {
    constructor() {
        this.data = null;
        this.currentScreen = null;
    }

    async load() {
        try {
            const response = await fetch('config.json');
            this.data = await response.json();
            window.__configData = this.data;
            return this.data;
        } catch (error) {
            console.error('Error loading config:', error);
            throw error;
        }
    }

    getScreenKeys() {
        if (!this.data) return [];
        return Object.keys(this.data).filter(k => k.startsWith('SCREEN_'));
    }

    getScreen(screenKey) {
        return this.data ? this.data[screenKey] || [] : [];
    }

    updateCell(screenKey, cellIndex, updates) {
        if (!this.data || !this.data[screenKey]) return;
        const cell = this.data[screenKey][cellIndex];
        if (cell) {
            Object.assign(cell, updates);
        }
    }

    addScreen() {
        if (!this.data) return null;

        // Find next available screen number
        const screenKeys = this.getScreenKeys();
        const screenNumbers = screenKeys.map(k => parseInt(k.replace('SCREEN_', ''))).filter(n => !isNaN(n));
        const nextNumber = screenNumbers.length > 0 ? Math.max(...screenNumbers) + 1 : 1;
        const newScreenKey = `SCREEN_${nextNumber}`;

        // Create new empty screen with default cell
        this.data[newScreenKey] = [{
            enabled: "true",
            name: "New Cell",
            posx: 0,
            posy: 0,
            sizex: 100,
            sizey: 50,
            bg_color: "#000000",
            font1_color: "#00ff88",
            font2_color: "#ffffff",
            font1: "Font24",
            font2: "Font16",
            decimals: 1,
            data1: ""
        }];

        return newScreenKey;
    }

    deleteScreen(screenKey) {
        if (!this.data || !this.data[screenKey]) return false;
        delete this.data[screenKey];
        return true;
    }

    addCell(screenKey) {
        if (!this.data || !this.data[screenKey]) return -1;

        const cells = this.data[screenKey];
        const newCell = {
            enabled: "true",
            name: `Cell ${cells.length + 1}`,
            posx: 0,
            posy: 0,
            sizex: 100,
            sizey: 50,
            bg_color: "#000000",
            font1_color: "#00ff88",
            font2_color: "#ffffff",
            font1: "Font24",
            font2: "Font16",
            decimals: 1,
            data1: ""
        };

        cells.push(newCell);
        return cells.length - 1; // Return index of new cell
    }

    deleteCell(screenKey, cellIndex) {
        if (!this.data || !this.data[screenKey]) return false;
        const cells = this.data[screenKey];
        if (cellIndex < 0 || cellIndex >= cells.length) return false;
        cells.splice(cellIndex, 1);
        return true;
    }

    updateSetting(section, key, value) {
        if (!this.data || !this.data[section]) return;
        this.data[section][key] = value;
    }

    getEngineTypes() {
        if (!this.data) return [];
        // Get engine types from ENGINE_CODES.engine_codes_list
        const engineCodes = this.data.ENGINE_CODES?.engine_codes_list || '';
        // Parse comma-separated list and trim whitespace
        return engineCodes.split(',').map(code => code.trim()).filter(code => code.length > 0);
    }

    getCanSpeedList() {
        if (!this.data) return [];
        // Get CAN speeds from CAN_SPEED_LIST.kbps
        const canSpeeds = this.data.CAN_SPEED_LIST?.kbps || '';
        // Parse comma-separated list and trim whitespace
        return canSpeeds.split(',').map(speed => speed.trim()).filter(speed => speed.length > 0);
    }

    exportConfig() {
        const json = JSON.stringify(this.data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'edited_config.json';
        a.click();
        URL.revokeObjectURL(url);
    }
}

// ============================================================================
// UI Manager
// ============================================================================

class UIManager {
    constructor(configManager, canvasManager) {
        this.config = configManager;
        this.canvas = canvasManager;
        this.elements = {
            screenSelect: document.getElementById('screenSelect'),
            cellSelect: document.getElementById('cellSelect'),
            cellDetails: document.getElementById('cellDetails'),
            saveButton: document.getElementById('saveButton'),
            statusText: document.getElementById('statusText'),
            zoomIn: document.getElementById('zoomIn'),
            zoomOut: document.getElementById('zoomOut'),
            zoomReset: document.getElementById('zoomReset'),
            zoomLevel: document.getElementById('zoomLevel'),
            clearSelection: document.getElementById('clearSelection'),
            addScreen: document.getElementById('addScreen'),
            deleteScreen: document.getElementById('deleteScreen'),
            addCell: document.getElementById('addCell'),
            deleteCell: document.getElementById('deleteCell')
        };
    }

    initialize() {
        this.populateScreenDropdown();
        this.setupEventListeners();
        this.updateZoomDisplay();
        this.updateZoomButtons();
        this.selectDefaultScreen();
    }

    populateScreenDropdown() {
        const screenKeys = this.config.getScreenKeys();
        this.elements.screenSelect.innerHTML = '';

        screenKeys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key.replace('SCREEN_', 'Screen ');
            this.elements.screenSelect.appendChild(option);
        });
    }

    populateCellDropdown(screenKey) {
        const cells = this.config.getScreen(screenKey);
        this.elements.cellSelect.innerHTML = '';

        cells.forEach((cell, idx) => {
            const option = document.createElement('option');
            option.value = idx;
            option.textContent = cell.name || `Cell ${idx + 1}`;
            this.elements.cellSelect.appendChild(option);
        });
    }

    renderCellProperties(screenKey, cellIndex) {
        const cells = this.config.getScreen(screenKey);
        const cell = cells[cellIndex];

        if (!cell) {
            this.elements.cellDetails.innerHTML = '<p class="no-cell">No cell selected</p>';
            return;
        }

        // Create form grid
        let html = '<div class="properties-grid">';

        // Property order for better UX
        const propertyOrder = [
            'enabled', 'name', 'posx', 'posy', 'sizex', 'sizey',
            'bg_color', 'font1_color', 'font2_color',
            'font1', 'font2', 'decimals', 'data1'
        ];

        const displayNames = {
            'enabled': 'Enabled',
            'name': 'Name',
            'posx': 'X Position',
            'posy': 'Y Position',
            'sizex': 'Width',
            'sizey': 'Height',
            'bg_color': 'Background Color',
            'font1_color': 'Font 1 Color',
            'font2_color': 'Font 2 Color',
            'font1': 'Font 1',
            'font2': 'Font 2',
            'decimals': 'Decimals',
            'data1': 'Data Source'
        };

        // Get available data sources from current engine
        const currentEngine = this.config.data?.CURRENT_ENGINE?.engine_type || 'CNHC';
        const engineData = this.config.data?.[currentEngine] || {};
        const dataSourceKeys = Object.keys(engineData).filter(k => !k.endsWith('_RES'));

        // Get data types for fields
        const dataTypes = this.config.data?.DATA_TYPES_SCREEN || {};

        // Render properties in order
        propertyOrder.forEach(key => {
            if (cell.hasOwnProperty(key)) {
                const label = displayNames[key] || key;
                const dataType = dataTypes[key] || 'String';
                const isColorPicker = key.includes('_color');
                const isDataSource = key === 'data1';
                const colorAttr = isColorPicker ? 'data-coloris' : '';

                // Convert RGB565 to hex for color pickers
                let displayValue = cell[key];
                if (isColorPicker && cell[key]) {
                    const rgb565 = parseInt(cell[key], 16);
                    const rgb888 = rgb565ToRgb888(rgb565);
                    displayValue = '#' + rgb888.toString(16).padStart(6, '0');
                }

                // Render dropdown for data1 field (command_type)
                if (isDataSource || dataType === 'command_type') {
                    html += `
                        <div class="property-item">
                            <label for="prop-${key}">${label}</label>
                            <select
                                id="prop-${key}"
                                class="property-select"
                                data-property="${key}"
                            >
                                ${dataSourceKeys.map(source => `
                                    <option value="${source}" ${source === cell[key] ? 'selected' : ''}>
                                        ${source}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                    `;
                }
                // Render dropdown for boolean fields
                else if (dataType === 'boolean') {
                    const boolValue = String(cell[key]); // Convert to string for comparison
                    html += `
                        <div class="property-item">
                            <label for="prop-${key}">${label}</label>
                            <select
                                id="prop-${key}"
                                class="property-select"
                                data-property="${key}"
                            >
                                <option value="true" ${boolValue === 'true' ? 'selected' : ''}>true</option>
                                <option value="false" ${boolValue === 'false' ? 'selected' : ''}>false</option>
                            </select>
                        </div>
                    `;
                }
                // Render input with +/- buttons for integer fields
                else if (dataType === 'integer') {
                    html += `
                        <div class="property-item">
                            <label for="prop-${key}">${label}</label>
                            <div class="input-with-stepper">
                                <button class="stepper-btn" data-action="decrement" data-target="prop-${key}">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <line x1="5" y1="12" x2="19" y2="12" stroke-width="2" stroke-linecap="round"/>
                                    </svg>
                                </button>
                                <input
                                    type="number"
                                    id="prop-${key}"
                                    value="${displayValue}"
                                    data-property="${key}"
                                    class="stepper-input"
                                />
                                <button class="stepper-btn" data-action="increment" data-target="prop-${key}">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <line x1="12" y1="5" x2="12" y2="19" stroke-width="2" stroke-linecap="round"/>
                                        <line x1="5" y1="12" x2="19" y2="12" stroke-width="2" stroke-linecap="round"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    `;
                }
                // Render regular input for other fields
                else {
                    html += `
                        <div class="property-item">
                            <label for="prop-${key}">${label}</label>
                            <input
                                type="text"
                                id="prop-${key}"
                                value="${displayValue}"
                                ${colorAttr}
                                data-property="${key}"
                                data-original="${cell[key]}"
                            />
                        </div>
                    `;
                }
            }
        });

        html += '</div>';
        this.elements.cellDetails.innerHTML = html;

        // Re-initialize color pickers for dynamically added inputs
        if (window.Coloris) {
            Coloris.init();
        }
    }

    setupEventListeners() {
        // Screen selection change
        this.elements.screenSelect.addEventListener('change', () => {
            const screenKey = this.elements.screenSelect.value;
            this.onScreenChange(screenKey);
        });

        // Cell selection change
        this.elements.cellSelect.addEventListener('change', () => {
            const screenKey = this.elements.screenSelect.value;
            const cellIndex = parseInt(this.elements.cellSelect.value, 10);
            this.onCellChange(screenKey, cellIndex);
        });

        // Canvas click handler
        this.canvas.canvas.addEventListener('click', (e) => {
            this.onCanvasClick(e);
        });

        // Save button
        this.elements.saveButton.addEventListener('click', () => {
            this.onSave();
        });

        // Live update on input change
        this.elements.cellDetails.addEventListener('input', (e) => {
            if (e.target.matches('input[data-property]')) {
                this.onPropertyChange(e.target);
            }
        });

        // Live update on select change
        this.elements.cellDetails.addEventListener('change', (e) => {
            if (e.target.matches('select[data-property]')) {
                this.onPropertyChange(e.target);
            }
        });

        // Handle stepper button clicks
        this.elements.cellDetails.addEventListener('click', (e) => {
            const btn = e.target.closest('.stepper-btn');
            if (btn) {
                e.preventDefault();
                const action = btn.dataset.action;
                const targetId = btn.dataset.target;
                const input = document.getElementById(targetId);

                if (input) {
                    const currentValue = parseInt(input.value) || 0;
                    const newValue = action === 'increment' ? currentValue + 1 : currentValue - 1;
                    input.value = newValue;

                    // Trigger property change
                    this.onPropertyChange(input);
                }
            }
        });

        // Zoom controls
        this.elements.zoomIn.addEventListener('click', () => {
            this.onZoomIn();
        });

        this.elements.zoomOut.addEventListener('click', () => {
            this.onZoomOut();
        });

        this.elements.zoomReset.addEventListener('click', () => {
            this.onZoomReset();
        });

        // Clear selection button
        this.elements.clearSelection.addEventListener('click', () => {
            this.onClearSelection();
        });

        // Add screen button
        this.elements.addScreen.addEventListener('click', () => {
            this.onAddScreen();
        });

        // Delete screen button
        this.elements.deleteScreen.addEventListener('click', () => {
            this.onDeleteScreen();
        });

        // Add cell button
        this.elements.addCell.addEventListener('click', () => {
            this.onAddCell();
        });

        // Delete cell button
        this.elements.deleteCell.addEventListener('click', () => {
            this.onDeleteCell();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Plus: Zoom In
            if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
                e.preventDefault();
                this.onZoomIn();
            }
            // Ctrl/Cmd + Minus: Zoom Out
            if ((e.ctrlKey || e.metaKey) && e.key === '-') {
                e.preventDefault();
                this.onZoomOut();
            }
            // Ctrl/Cmd + 0: Reset Zoom
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                this.onZoomReset();
            }
            // Escape: Clear Selection
            if (e.key === 'Escape') {
                this.onClearSelection();
            }
        });
    }

    onScreenChange(screenKey) {
        this.populateCellDropdown(screenKey);
        this.canvas.drawScreen(this.config.getScreen(screenKey));
        this.elements.cellDetails.innerHTML = '<p class="no-cell">Select a cell to edit</p>';
        this.updateStatus(`Switched to ${screenKey.replace('SCREEN_', 'Screen ')}`);
    }

    onCellChange(screenKey, cellIndex) {
        const cells = this.config.getScreen(screenKey);
        this.canvas.drawScreen(cells);
        this.canvas.highlightCell(cells, cellIndex);
        this.renderCellProperties(screenKey, cellIndex);
        this.updateStatus(`Editing: ${cells[cellIndex]?.name || 'Cell ' + (cellIndex + 1)}`);
    }

    onCanvasClick(e) {
        const rect = this.canvas.canvas.getBoundingClientRect();

        // Calculate click position relative to canvas
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Adjust for zoom level - convert from scaled coordinates back to actual canvas coordinates
        const x = Math.round(clickX / this.canvas.zoomLevel);
        const y = Math.round(clickY / this.canvas.zoomLevel);

        const screenKey = this.elements.screenSelect.value;
        const cells = this.config.getScreen(screenKey);
        const hitIndex = this.canvas.findCellAtPosition(x, y, cells);

        if (hitIndex >= 0) {
            this.elements.cellSelect.value = hitIndex;
            this.elements.cellSelect.dispatchEvent(new Event('change'));
            this.updateStatus(`Selected: ${cells[hitIndex]?.name || 'Cell ' + (hitIndex + 1)}`);
        }
    }

    onPropertyChange(input) {
        const property = input.dataset.property;
        let value = input.value;
        const screenKey = this.elements.screenSelect.value;
        const cellIndex = parseInt(this.elements.cellSelect.value, 10);

        // Convert hex color back to RGB565 if it's a color property
        if (property.includes('_color') && value.startsWith('#')) {
            value = rgb888ToRgb565(value);
        }

        // Update config
        this.config.updateCell(screenKey, cellIndex, { [property]: value });

        // Redraw canvas with updates
        const cells = this.config.getScreen(screenKey);
        this.canvas.drawScreen(cells);
        this.canvas.highlightCell(cells, cellIndex);
    }

    onSave() {
        const screenKey = this.elements.screenSelect.value;
        const cellIndex = parseInt(this.elements.cellSelect.value, 10);

        // Collect all input and select values
        const inputs = this.elements.cellDetails.querySelectorAll('input[data-property], select[data-property]');
        const updates = {};

        inputs.forEach(input => {
            const property = input.dataset.property;
            let value = input.value;

            // Convert hex color back to RGB565 if it's a color property
            if (property.includes('_color') && value.startsWith('#')) {
                value = rgb888ToRgb565(value);
            }

            updates[property] = value;
        });

        // Update config
        this.config.updateCell(screenKey, cellIndex, updates);

        // Export
        this.config.exportConfig();
        this.updateStatus('Configuration downloaded!', 'success');

        // Reset status after 3 seconds
        setTimeout(() => {
            const cells = this.config.getScreen(screenKey);
            this.updateStatus(`Editing: ${cells[cellIndex]?.name || 'Cell ' + (cellIndex + 1)}`);
        }, 3000);
    }

    onZoomIn() {
        this.canvas.zoomIn();
        this.updateZoomDisplay();
        this.updateZoomButtons();
        this.updateStatus(`Zoomed to ${this.canvas.getZoomPercent()}%`);
    }

    onZoomOut() {
        this.canvas.zoomOut();
        this.updateZoomDisplay();
        this.updateZoomButtons();
        this.updateStatus(`Zoomed to ${this.canvas.getZoomPercent()}%`);
    }

    onZoomReset() {
        this.canvas.resetZoom();
        this.updateZoomDisplay();
        this.updateZoomButtons();
        this.updateStatus('Zoom reset to 100%');
    }

    updateZoomDisplay() {
        if (this.elements.zoomLevel) {
            this.elements.zoomLevel.textContent = `${this.canvas.getZoomPercent()}%`;
        }
    }

    updateZoomButtons() {
        // Disable zoom in button if at max zoom
        if (this.elements.zoomIn) {
            this.elements.zoomIn.disabled = this.canvas.zoomLevel >= this.canvas.maxZoom;
        }
        // Disable zoom out button if at min zoom
        if (this.elements.zoomOut) {
            this.elements.zoomOut.disabled = this.canvas.zoomLevel <= this.canvas.minZoom;
        }
    }

    onClearSelection() {
        // Clear the cell selection dropdown
        this.elements.cellSelect.value = '';

        // Redraw screen without any cell highlighted
        const screenKey = this.elements.screenSelect.value;
        const cells = this.config.getScreen(screenKey);
        this.canvas.drawScreen(cells);

        // Clear the properties panel
        this.elements.cellDetails.innerHTML = '<p class="no-cell">Select a cell to edit its properties</p>';

        // Update status
        this.updateStatus('Selection cleared');
    }

    onAddScreen() {
        const newScreenKey = this.config.addScreen();
        if (newScreenKey) {
            // Refresh screen dropdown
            this.populateScreenDropdown();

            // Select the new screen
            this.elements.screenSelect.value = newScreenKey;
            this.onScreenChange(newScreenKey);

            // Select the first (default) cell
            if (this.elements.cellSelect.options.length > 0) {
                this.elements.cellSelect.value = 0;
                this.elements.cellSelect.dispatchEvent(new Event('change'));
            }

            // Update status
            this.updateStatus(`Screen ${newScreenKey.replace('SCREEN_', '')} added`, 'success');
        } else {
            this.updateStatus('Failed to add screen', 'error');
        }
    }

    onDeleteScreen() {
        const screenKey = this.elements.screenSelect.value;

        if (!screenKey) {
            this.updateStatus('No screen selected', 'error');
            return;
        }

        // Check if this is the last screen
        const screenKeys = this.config.getScreenKeys();
        if (screenKeys.length <= 1) {
            this.updateStatus('Cannot delete the last screen', 'error');
            return;
        }

        // Confirm deletion
        const screenName = screenKey.replace('SCREEN_', 'Screen ');
        if (!confirm(`Are you sure you want to delete ${screenName}?`)) {
            return;
        }

        // Delete the screen
        if (this.config.deleteScreen(screenKey)) {
            // Refresh screen dropdown
            this.populateScreenDropdown();

            // Select another screen (first available)
            const remainingScreens = this.config.getScreenKeys();
            if (remainingScreens.length > 0) {
                this.elements.screenSelect.value = remainingScreens[0];
                this.onScreenChange(remainingScreens[0]);

                // Select first cell if available
                if (this.elements.cellSelect.options.length > 0) {
                    this.elements.cellSelect.value = 0;
                    this.elements.cellSelect.dispatchEvent(new Event('change'));
                }
            }

            // Update status
            this.updateStatus(`${screenName} deleted`, 'success');
        } else {
            this.updateStatus('Failed to delete screen', 'error');
        }
    }

    onAddCell() {
        const screenKey = this.elements.screenSelect.value;

        if (!screenKey) {
            this.updateStatus('No screen selected', 'error');
            return;
        }

        // Add new cell
        const newCellIndex = this.config.addCell(screenKey);
        if (newCellIndex >= 0) {
            // Refresh cell dropdown
            this.populateCellDropdown(screenKey);

            // Select the new cell
            this.elements.cellSelect.value = newCellIndex;
            this.elements.cellSelect.dispatchEvent(new Event('change'));

            // Update status
            this.updateStatus(`New cell added`, 'success');
        } else {
            this.updateStatus('Failed to add cell', 'error');
        }
    }

    onDeleteCell() {
        const screenKey = this.elements.screenSelect.value;
        const cellIndex = parseInt(this.elements.cellSelect.value, 10);

        if (!screenKey || isNaN(cellIndex)) {
            this.updateStatus('No cell selected', 'error');
            return;
        }

        // Check if this is the last cell
        const cells = this.config.getScreen(screenKey);
        if (cells.length <= 1) {
            this.updateStatus('Cannot delete the last cell in a screen', 'error');
            return;
        }

        // Get cell name for confirmation
        const cell = cells[cellIndex];
        const cellName = cell?.name || `Cell ${cellIndex + 1}`;

        // Confirm deletion
        if (!confirm(`Are you sure you want to delete "${cellName}"?`)) {
            return;
        }

        // Delete the cell
        if (this.config.deleteCell(screenKey, cellIndex)) {
            // Refresh cell dropdown
            this.populateCellDropdown(screenKey);

            // Select another cell (first available)
            if (this.elements.cellSelect.options.length > 0) {
                this.elements.cellSelect.value = 0;
                this.elements.cellSelect.dispatchEvent(new Event('change'));
            } else {
                // No cells left, clear the display
                this.canvas.drawScreen([]);
                this.elements.cellDetails.innerHTML = '<p class="no-cell">No cells available</p>';
            }

            // Update status
            this.updateStatus(`Cell "${cellName}" deleted`, 'success');
        } else {
            this.updateStatus('Failed to delete cell', 'error');
        }
    }

    updateStatus(message, type = 'info') {
        if (this.elements.statusText) {
            this.elements.statusText.textContent = message;
            this.elements.statusText.className = `status-${type}`;
        }
    }

    selectDefaultScreen() {
        const screenKeys = this.config.getScreenKeys();
        if (screenKeys.length > 0) {
            this.elements.screenSelect.value = screenKeys[0];
            this.onScreenChange(screenKeys[0]);

            // Select first cell if available
            if (this.elements.cellSelect.options.length > 0) {
                this.elements.cellSelect.value = 0;
                this.elements.cellSelect.dispatchEvent(new Event('change'));
            }
        }
    }
}

// ============================================================================
// Settings Manager
// ============================================================================

class SettingsManager {
    constructor(configManager) {
        this.config = configManager;
        this.elements = {
            can_id_1: document.getElementById('can_id_1'),
            can_speed_kbps: document.getElementById('can_speed_kbps'),
            update_interval_seconds: document.getElementById('update_interval_seconds'),
            current_engine_type: document.getElementById('current_engine_type'),
            power_minimal_voltage: document.getElementById('power_minimal_voltage'),
            power_forced_on_duration: document.getElementById('power_forced_on_duration'),
            lcd_brightness_type: document.getElementById('lcd_brightness_type'),
            lcd_brightness_intensity: document.getElementById('lcd_brightness_intensity'),
            wifi_mode: document.getElementById('wifi_mode'),
            wifi_ssid: document.getElementById('wifi_ssid'),
            wifi_password: document.getElementById('wifi_password'),
            wifi_mdns: document.getElementById('wifi_mdns'),
            wifi_ap_ssid: document.getElementById('wifi_ap_ssid'),
            wifi_ap_password: document.getElementById('wifi_ap_password'),
            saveSettingsButton: document.getElementById('saveSettingsButton')
        };
    }

    initialize() {
        this.populateEngineTypes();
        this.populateCanSpeeds();
        this.loadSettings();
        this.updateWifiFieldsState();
        this.setupEventListeners();
    }

    populateEngineTypes() {
        const engineTypes = this.config.getEngineTypes();
        this.elements.current_engine_type.innerHTML = '';

        engineTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            this.elements.current_engine_type.appendChild(option);
        });
    }

    populateCanSpeeds() {
        const canSpeeds = this.config.getCanSpeedList();
        this.elements.can_speed_kbps.innerHTML = '';

        canSpeeds.forEach(speed => {
            const option = document.createElement('option');
            option.value = speed;
            option.textContent = speed;
            this.elements.can_speed_kbps.appendChild(option);
        });
    }

    loadSettings() {
        if (!this.config.data) return;

        // CAN ID
        if (this.config.data.CAN_ID) {
            this.elements.can_id_1.value = this.config.data.CAN_ID.ID1 || '';
        }

        // CAN Speed
        if (this.config.data.CAN_SPEED) {
            this.elements.can_speed_kbps.value = this.config.data.CAN_SPEED.kbps || '';
        }

        // Update Interval
        if (this.config.data.UPDATE_INTERVAL) {
            this.elements.update_interval_seconds.value = this.config.data.UPDATE_INTERVAL.seconds || '';
        }

        // Current Engine
        if (this.config.data.CURRENT_ENGINE) {
            this.elements.current_engine_type.value = this.config.data.CURRENT_ENGINE.engine_type || '';
        }

        // Power
        if (this.config.data.POWER) {
            this.elements.power_minimal_voltage.value = this.config.data.POWER.minimal_voltage || '';
            this.elements.power_forced_on_duration.value = this.config.data.POWER.forced_on_duration || '';
        }

        // LCD Brightness
        if (this.config.data.LCD_BRIGHTNESS) {
            this.elements.lcd_brightness_type.value = this.config.data.LCD_BRIGHTNESS.type || 'MANUAL';
            this.elements.lcd_brightness_intensity.value = this.config.data.LCD_BRIGHTNESS.intensity || '';
        }

        // WiFi
        if (this.config.data.WIFI) {
            this.elements.wifi_mode.value = this.config.data.WIFI.mode || 'STA';
            this.elements.wifi_ssid.value = this.config.data.WIFI.ssid || '';
            this.elements.wifi_password.value = this.config.data.WIFI.password || '';
            this.elements.wifi_mdns.value = this.config.data.WIFI.mdns || '';
            this.elements.wifi_ap_ssid.value = this.config.data.WIFI.ap_ssid || '';
            this.elements.wifi_ap_password.value = this.config.data.WIFI.ap_password || '';
        }
    }

    updateWifiFieldsState() {
        const mode = this.elements.wifi_mode.value;

        // Enable/disable fields based on mode
        // When mode is AP: disable SSID and Password (STA fields)
        // When mode is STA: disable AP SSID and AP Password (AP fields)
        // When mode is AP+STA: enable all fields
        // When mode is OFF: disable all fields

        if (mode === 'AP') {
            // AP mode: disable STA fields
            this.elements.wifi_ssid.disabled = true;
            this.elements.wifi_password.disabled = true;
            this.elements.wifi_ap_ssid.disabled = false;
            this.elements.wifi_ap_password.disabled = false;
            this.elements.wifi_mdns.disabled = false;
        } else if (mode === 'STA') {
            // STA mode: disable AP fields
            this.elements.wifi_ssid.disabled = false;
            this.elements.wifi_password.disabled = false;
            this.elements.wifi_ap_ssid.disabled = true;
            this.elements.wifi_ap_password.disabled = true;
            this.elements.wifi_mdns.disabled = false;
        } else if (mode === 'AP+STA') {
            // AP+STA mode: enable all fields
            this.elements.wifi_ssid.disabled = false;
            this.elements.wifi_password.disabled = false;
            this.elements.wifi_ap_ssid.disabled = false;
            this.elements.wifi_ap_password.disabled = false;
            this.elements.wifi_mdns.disabled = false;
        } else if (mode === 'OFF') {
            // OFF mode: disable all fields
            this.elements.wifi_ssid.disabled = true;
            this.elements.wifi_password.disabled = true;
            this.elements.wifi_ap_ssid.disabled = true;
            this.elements.wifi_ap_password.disabled = true;
            this.elements.wifi_mdns.disabled = true;
        }
    }

    setupEventListeners() {
        this.elements.saveSettingsButton.addEventListener('click', () => {
            this.saveSettings();
        });

        // Handle WIFI mode changes
        this.elements.wifi_mode.addEventListener('change', () => {
            this.updateWifiFieldsState();
        });

        // Handle stepper button clicks for number inputs
        const settingsForm = document.getElementById('settingsForm');
        if (settingsForm) {
            settingsForm.addEventListener('click', (e) => {
                const btn = e.target.closest('.stepper-btn');
                if (btn) {
                    e.preventDefault();
                    const action = btn.dataset.action;
                    const targetId = btn.dataset.target;
                    const input = document.getElementById(targetId);

                    if (input) {
                        const currentValue = parseInt(input.value) || 0;
                        const min = input.hasAttribute('min') ? parseInt(input.min) : -Infinity;
                        const max = input.hasAttribute('max') ? parseInt(input.max) : Infinity;

                        let newValue = action === 'increment' ? currentValue + 1 : currentValue - 1;

                        // Respect min/max constraints
                        newValue = Math.max(min, Math.min(max, newValue));

                        input.value = newValue;
                    }
                }
            });
        }
    }

    saveSettings() {
        // Update all settings in config
        this.config.updateSetting('CAN_ID', 'ID1', this.elements.can_id_1.value);
        this.config.updateSetting('CAN_SPEED', 'kbps', this.elements.can_speed_kbps.value);
        this.config.updateSetting('UPDATE_INTERVAL', 'seconds', this.elements.update_interval_seconds.value);
        this.config.updateSetting('CURRENT_ENGINE', 'engine_type', this.elements.current_engine_type.value);
        this.config.updateSetting('POWER', 'minimal_voltage', this.elements.power_minimal_voltage.value);
        this.config.updateSetting('POWER', 'forced_on_duration', this.elements.power_forced_on_duration.value);
        this.config.updateSetting('LCD_BRIGHTNESS', 'type', this.elements.lcd_brightness_type.value);
        this.config.updateSetting('LCD_BRIGHTNESS', 'intensity', this.elements.lcd_brightness_intensity.value);
        this.config.updateSetting('WIFI', 'mode', this.elements.wifi_mode.value);
        this.config.updateSetting('WIFI', 'ssid', this.elements.wifi_ssid.value);
        this.config.updateSetting('WIFI', 'password', this.elements.wifi_password.value);
        this.config.updateSetting('WIFI', 'mdns', this.elements.wifi_mdns.value);
        this.config.updateSetting('WIFI', 'ap_ssid', this.elements.wifi_ap_ssid.value);
        this.config.updateSetting('WIFI', 'ap_password', this.elements.wifi_ap_password.value);

        // Export config
        this.config.exportConfig();

        // Update status
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = 'Settings saved and downloaded!';
            statusText.className = 'status-success';

            setTimeout(() => {
                statusText.textContent = 'Ready';
                statusText.className = 'status-info';
            }, 3000);
        }
    }
}

// ============================================================================
// Page Navigation Manager
// ============================================================================

class PageNavigationManager {
    constructor() {
        this.currentPage = 'screen-editor';
        this.navTabs = document.querySelectorAll('.nav-tab');
        this.pages = {
            'screen-editor': document.getElementById('screenEditorPage'),
            'settings': document.getElementById('settingsPage'),
            'live-data': document.getElementById('liveDataPage')
        };
    }

    initialize() {
        this.navTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const targetPage = e.currentTarget.dataset.page;
                this.switchPage(targetPage);
            });
        });
    }

    switchPage(pageName) {
        if (this.currentPage === pageName) return;

        // Update nav tabs
        this.navTabs.forEach(tab => {
            if (tab.dataset.page === pageName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update page visibility
        Object.keys(this.pages).forEach(key => {
            if (key === pageName) {
                this.pages[key].classList.remove('hidden');
            } else {
                this.pages[key].classList.add('hidden');
            }
        });

        this.currentPage = pageName;

        // Update status bar
        const statusText = document.getElementById('statusText');
        if (statusText) {
            const pageTitle = pageName === 'screen-editor' ? 'Screen Editor' :
                             pageName === 'settings' ? 'Settings' : 'Live Data';
            statusText.textContent = `Switched to ${pageTitle}`;
            statusText.className = 'status-info';
        }
    }
}

// ============================================================================
// Application Initialization
// ============================================================================

async function initializeApp() {
    try {
        // Show loading state
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = 'Loading configuration...';
        }

        // Initialize color picker
        if (window.Coloris) {
            Coloris({
                themeMode: 'dark',
                alpha: false,
                format: 'hex'
            });
        }

        // Initialize managers
        const configManager = new ConfigManager();
        await configManager.load();

        const canvasManager = new CanvasManager('myCanvas');
        const uiManager = new UIManager(configManager, canvasManager);
        const settingsManager = new SettingsManager(configManager);
        const pageNavManager = new PageNavigationManager();

        // Initialize Live Data managers
        const liveCanvasManager = new CanvasManager('liveCanvas');
        const wsManager = new WebSocketManager();
        const liveDataManager = new LiveDataManager(liveCanvasManager, wsManager);

        // Initialize UI components
        uiManager.initialize();
        settingsManager.initialize();
        pageNavManager.initialize();
        liveDataManager.initialize();

        console.log('T-Display Web Editor initialized successfully');
    } catch (error) {
        console.error('Failed to initialize application:', error);
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = 'Error loading configuration. Please refresh.';
            statusText.className = 'status-error';
        }
    }
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
