const XLSX = require('xlsx');
const log = require('electron-log');

log.info('Bu mesaj hem dosyaya yazılır hem de konsola basılır');

// State to store current imported data for each side
let importedDataState = {
    'source': null,
    'target': null,
    'cancels': null
};

// MULTI-TENANCY STATE
let currentStore = null;

// Object to track original column indices and their visibility per side.
let columnState = {
    'source': { indices: [], hiddenIndices: new Set() },
    'target': { indices: [], hiddenIndices: new Set() },
    'cancels': { indices: [], hiddenIndices: new Set() }
};

// State to store original raw data for reverting operations
let originalDataState = {
    'source': null,
    'target': null,
    'cancels': null
};

// Track active operation per side (null or string key)
let activeOperationState = {
    'source': null,
    'target': null,
    'cancels': null
};

let activeRightTab = 'target';
let isPreparationStarted = false;

// State to store previous raw source data for cancel detection
let previousRawSourceData = null;

// Auto-Fetch State
let autoFetchInterval = null;
let statusUpdateInterval = null;
let lastFetchTime = null;

// Helper to validate quantities between Source and Target
function getValidationStatus() {
    const sourceData = importedDataState['source'];
    const targetData = importedDataState['target'];
    const statusMap = new Map(); // Barcode -> { validPacket: bool, validPiece: bool, rowValid: bool }
    let allValid = true;

    if (!sourceData || !targetData) return { map: statusMap, allValid: false };

    const sourceHeaders = sourceData[0];
    const targetHeaders = targetData[0];

    // Find indices
    const sBarcodeIdx = sourceHeaders.findIndex(h => h && (h.toString().toLowerCase().trim() === 'barkod' || h.toString().toLowerCase().trim() === 'barcode'));
    const sPaketIdx = sourceHeaders.findIndex(h => h && h.toString().toLowerCase().trim() === 'paket sayısı');
    const sAdetIdx = sourceHeaders.findIndex(h => h && h.toString().toLowerCase().trim() === 'adet sayısı');

    const tBarcodeIdx = targetHeaders.findIndex(h => h && (h.toString().toLowerCase().trim() === 'barkod' || h.toString().toLowerCase().trim() === 'barcode'));
    const tPaketIdx = targetHeaders.findIndex(h => h && h.toString().toLowerCase().trim() === 'paket sayısı');
    const tAdetIdx = targetHeaders.findIndex(h => h && h.toString().toLowerCase().trim() === 'adet sayısı');

    // If critical columns missing, fail
    if (sBarcodeIdx === -1 || tBarcodeIdx === -1) {
        return { map: statusMap, allValid: false };
    }

    // Map Source Quantities
    const sourceMap = new Map();
    for (let i = 1; i < sourceData.length; i++) {
        const row = sourceData[i];
        const barcode = row[sBarcodeIdx] ? row[sBarcodeIdx].toString().trim() : '';
        if (barcode) {
            const prev = sourceMap.get(barcode) || { paket: 0, adet: 0 };
            prev.paket += parseInt(row[sPaketIdx] || 0);
            prev.adet += parseInt(row[sAdetIdx] || 0);
            sourceMap.set(barcode, prev);
        }
    }

    // Map Target Quantities
    const targetMap = new Map();
    for (let i = 1; i < targetData.length; i++) {
        const row = targetData[i];
        const barcode = row[tBarcodeIdx] ? row[tBarcodeIdx].toString().trim() : '';
        if (barcode) {
            const prev = targetMap.get(barcode) || { paket: 0, adet: 0 };
            prev.paket += parseInt(row[tPaketIdx] || 0);
            prev.adet += parseInt(row[tAdetIdx] || 0);
            targetMap.set(barcode, prev);
        }
    }

    // Compare Logic
    sourceMap.forEach((sVal, barcode) => {
        const tVal = targetMap.get(barcode) || { paket: 0, adet: 0 };

        const validPacket = sVal.paket === tVal.paket;
        const validPiece = sVal.adet === tVal.adet;
        // Strict comparison.

        const rowValid = validPacket && validPiece;

        if (!rowValid) allValid = false;
        statusMap.set(barcode, { validPacket, validPiece, rowValid });
    });

    // Check extra items in target
    targetMap.forEach((tVal, barcode) => {
        if (!sourceMap.has(barcode)) {
            allValid = false;
            statusMap.set(barcode, { validPacket: false, validPiece: false, rowValid: false });
        }
    });

    return { map: statusMap, allValid };
}

// ==========================================
// CUSTOM ALERT MODAL FUNCTION
// ==========================================
/**
 * Shows a custom alert modal
 * @param {string} message - The message to display
 * @param {string} type - Type of alert: 'success', 'error', 'warning', 'info' (default: 'info')
 * @param {string} title - Optional custom title
 */
function showAlert(message, type = 'info', title = null) {
    const modal = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-title');
    const messageEl = document.getElementById('alert-message');
    const iconContainer = document.getElementById('alert-icon-container');
    const okBtn = document.getElementById('btn-alert-ok');

    if (!modal || !titleEl || !messageEl || !iconContainer || !okBtn) {
        // Fallback to native alert if modal not found
        alert(message);
        return;
    }

    // Set message
    messageEl.textContent = message;

    // Define icon and color configs
    const configs = {
        success: {
            title: 'Başarılı',
            bgColor: 'bg-green-100',
            iconColor: 'text-green-600',
            btnColor: 'bg-green-600 hover:bg-green-700 focus:ring-green-300',
            icon: `<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>`
        },
        error: {
            title: 'Hata',
            bgColor: 'bg-red-100',
            iconColor: 'text-red-600',
            btnColor: 'bg-red-600 hover:bg-red-700 focus:ring-red-300',
            icon: `<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>`
        },
        warning: {
            title: 'Uyarı',
            bgColor: 'bg-yellow-100',
            iconColor: 'text-yellow-600',
            btnColor: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-300',
            icon: `<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>`
        },
        info: {
            title: 'Bildirim',
            bgColor: 'bg-blue-100',
            iconColor: 'text-blue-600',
            btnColor: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-300',
            icon: `<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>`
        }
    };

    const config = configs[type] || configs.info;

    // Set title
    titleEl.textContent = title || config.title;

    // Reset icon container classes
    iconContainer.className = `mx-auto flex items-center justify-center h-12 w-12 rounded-full ${config.bgColor}`;
    iconContainer.innerHTML = `<div class="${config.iconColor}">${config.icon}</div>`;

    // Reset button classes
    okBtn.className = `px-4 py-2 text-white text-sm font-medium rounded-md w-full shadow-sm focus:outline-none focus:ring-2 ${config.btnColor}`;

    // Show modal
    modal.classList.remove('hidden');

    // Close handler
    const closeModal = () => {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', closeModal);
        modal.removeEventListener('click', outsideClickHandler);
    };

    // Outside click handler
    const outsideClickHandler = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };

    // Attach listeners
    okBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', outsideClickHandler);
}

// ==========================================
// CUSTOM CONFIRM MODAL FUNCTION
// ==========================================
/**
 * Shows a custom confirmation modal
 * @param {string} title - The title of the confirmation
 * @param {string} message - The message to display
 * @param {function} onConfirm - Callback when user confirms
 * @param {function} onCancel - Optional callback when user cancels
 * @param {string} confirmText - Optional text for confirm button (default: 'Evet')
 * @param {string} cancelText - Optional text for cancel button (default: 'İptal')
 */
function showConfirm(title, message, onConfirm, onCancel = null, confirmText = 'Evet', cancelText = 'İptal') {
    const modal = document.getElementById('confirmation-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('btn-modal-confirm');
    const cancelBtn = document.getElementById('btn-modal-cancel');

    if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
        // Fallback to native confirm if modal not found
        if (confirm(message)) {
            if (onConfirm) onConfirm();
        } else {
            if (onCancel) onCancel();
        }
        return;
    }

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    // Show modal
    modal.classList.remove('hidden');

    // Close handler
    const closeModal = () => {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', confirmHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
        modal.removeEventListener('click', outsideClickHandler);
    };

    // Confirm handler
    const confirmHandler = () => {
        closeModal();
        if (onConfirm) onConfirm();
    };

    // Cancel handler
    const cancelHandler = () => {
        closeModal();
        if (onCancel) onCancel();
    };

    // Outside click handler
    const outsideClickHandler = (e) => {
        if (e.target === modal) {
            cancelHandler();
        }
    };

    // Attach listeners
    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
    modal.addEventListener('click', outsideClickHandler);
}

// DOM Elements
const sourceImportBtn = document.getElementById('btn-import-source');
const targetImportBtn = document.getElementById('btn-import-target');
const fileInputSource = document.getElementById('file-input-source');
const fileInputTarget = document.getElementById('file-input-target');

const btnShowTarget = document.getElementById('btn-show-target');

const sourceHistorySelect = document.getElementById('source-history-select'); // Might be null now
const targetHistorySelect = document.getElementById('target-history-select');

// Custom Dropdown Elements (Source)
const sourceHistoryBtn = document.getElementById('source-history-btn');
const sourceHistoryDropdown = document.getElementById('source-history-dropdown');
const sourceHistoryList = document.getElementById('source-history-list');

// Custom Dropdown Elements (Target)
const targetHistoryBtn = document.getElementById('target-history-btn');
const targetHistoryDropdown = document.getElementById('target-history-dropdown');
const targetHistoryList = document.getElementById('target-history-list');

// Column Dropdown Elements
const sourceColumnsBtn = document.getElementById('source-columns-btn');
const targetColumnsBtn = document.getElementById('target-columns-btn');
const cancelsColumnsBtn = document.getElementById('cancels-columns-btn');
const sourceColumnDropdown = document.getElementById('source-column-dropdown');
const targetColumnDropdown = document.getElementById('target-column-dropdown');
const cancelsColumnDropdown = document.getElementById('cancels-column-dropdown');

// Cancels Import/Manual Buttons
const cancelsImportBtn = document.getElementById('btn-import-cancels');
const cancelsManualAddBtn = document.getElementById('cancels-manual-add-btn');
const cancelsLoadArchiveBtn = document.getElementById('btn-load-cancels-archive');
const cancelsDateFilter = document.getElementById('cancels-date-filter');
const fileInputCancels = document.getElementById('file-input-cancels'); // Assuming simple file input might exist or need creation

// Operations Dropdown Elements
const sourceOperationsBtn = document.getElementById('source-operations-btn');
const targetOperationsBtn = document.getElementById('target-operations-btn');
const sourceOperationsDropdown = document.getElementById('source-operations-dropdown');
const targetOperationsDropdown = document.getElementById('target-operations-dropdown');
const sourceOptPackageCount = document.getElementById('source-opt-package-count');
const targetOptPackageCount = document.getElementById('target-opt-package-count');

// Manual Entry Elements
const targetManualAddBtn = document.getElementById('target-manual-add-btn');
const manualEntryModal = document.getElementById('manual-entry-modal');
const manualProductNameInput = document.getElementById('manual-product-name');
const manualProductSuggestions = document.getElementById('manual-product-suggestions');
const manualBarcodeDisplay = document.getElementById('manual-barcode-display');
const manualPackageCountInput = document.getElementById('manual-package-count');
const manualAddConfirmBtn = document.getElementById('manual-add-confirm-btn');
const manualCancelBtn = document.getElementById('manual-cancel-btn');

let selectedManualProduct = null; // Stores { name, barcode, originalRow }

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Multi-tenancy init
    initializeStoreLogic();

    // Event Delegation for Archive Tables
    setupArchiveEventDelegation();

    // Initialize Settings Logic
    setupSettingsView();
    initSettingsLogic();

    // Initialize Navigation
    initNavigation();

    // Start Header Clock
    startHeaderClock();

    // Tab Listeners
    if (btnShowTarget) btnShowTarget.addEventListener('click', () => switchRightTab('target'));

    // Sidebar Change Store Button
    const btnChangeStore = document.getElementById('btn-sidebar-change-store');
    if (btnChangeStore) {
        btnChangeStore.addEventListener('click', () => {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('focus-selector-window');
        });
    }

    // Sidebar Toggle Logic
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const mainSidebar = document.getElementById('main-sidebar');

    if (btnToggleSidebar && mainSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            if (mainSidebar.classList.contains('w-64')) {
                // Close Sidebar
                mainSidebar.classList.remove('w-64');
                mainSidebar.classList.add('w-0', 'border-none');
            } else {
                // Open Sidebar
                mainSidebar.classList.add('w-64');
                mainSidebar.classList.remove('w-0', 'border-none');
            }
        });
    }

    // Listen for updates from other windows
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('stores-updated', () => {
        // In single-store mode, we don't need to refresh sidebar
        // Just reload current store data if needed
        if (currentStore) {
            ipcRenderer.invoke('db-get-store', currentStore.id).then(store => {
                if (store) {
                    currentStore = store;
                }
            });
        }
    });

    // Date Picker for Target/Cancels Archive
    const btnLoadTargetArchive = document.getElementById('btn-load-target-archive');
    const targetDateFilter = document.getElementById('target-date-filter');

    // Setup Event Delegation for Archives
    setupArchiveEventDelegation();

    // Set today as default date
    if (targetDateFilter) {
        targetDateFilter.valueAsDate = new Date();
    }

    if (btnLoadTargetArchive && targetDateFilter) {
        btnLoadTargetArchive.addEventListener('click', () => {
            const selectedDate = targetDateFilter.value;
            if (selectedDate) {
                loadArchiveFromDate(selectedDate);
            } else {
                showAlert('Lütfen bir tarih seçiniz.', 'warning');
            }
        });
    }

    // ===== WORKFLOW BUTTON HANDLERS =====
    const btnStartPreparation = document.getElementById('btn-start-preparation');
    const btnMarkShipped = document.getElementById('btn-mark-shipped');
    // let isPreparationStarted = false; // Removed to use global state

    // Hazırlamaya Başla Button Handler
    if (btnStartPreparation) {
        btnStartPreparation.addEventListener('click', async () => {
            if (isPreparationStarted) return;

            if (!currentStore) {
                showAlert('Lütfen bir mağaza seçiniz.', 'warning');
                return;
            }

            isPreparationStarted = true;
            console.log('Preparation Started. isPreparationStarted =', isPreparationStarted);

            // Update UI State
            btnStartPreparation.disabled = true;
            btnStartPreparation.classList.remove('bg-blue-600', 'hover:bg-blue-700');
            btnStartPreparation.classList.add('bg-gray-400', 'cursor-not-allowed');

            // Initial Fetch
            lastFetchTime = new Date();
            await fetchAutoData();

            // Start Intervals
            // 1. Data Fetch Loop (Every 60s)
            if (autoFetchInterval) clearInterval(autoFetchInterval);
            autoFetchInterval = setInterval(async () => {
                await fetchAutoData();
            }, 60000);

            // 2. Status Text Update Loop (Every 1s)
            if (statusUpdateInterval) clearInterval(statusUpdateInterval);
            updatePreparationButtonStatus(); // Initial call
            statusUpdateInterval = setInterval(() => {
                updatePreparationButtonStatus();
            }, 1000);

            log.info('Preparation started with Auto-Fetch');
            processAndRenderData('target'); // Re-render to enable editing logic
        });
    }

    function updatePreparationButtonStatus() {
        const btn = document.getElementById('btn-start-preparation');
        if (!btn) return;

        let timeText = 'şimdi';
        if (lastFetchTime) {
            const diff = Math.floor((new Date() - lastFetchTime) / 1000);
            timeText = `${diff} sn önce`;
        }

        btn.innerHTML = `
        <div class="flex flex-col items-center leading-tight">
            <div class="flex items-center gap-1">
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span class="text-[10px] opacity-90 font-mono whitespace-nowrap">
                    <span class="hidden xl:inline">Son kontrol: </span>${timeText}
                </span>
            </div>
        </div>
    `;
    }

    async function fetchAutoData() {
        if (!currentStore) return;

        try {
            const { ipcRenderer } = require('electron');
            const res = await ipcRenderer.invoke('fetch-trendyol-orders', currentStore.id);

            // Always update fetch time regardless of data presence
            lastFetchTime = new Date();

            if (res.success && res.data && res.data.length > 0) {
                const rawData = res.data;
                // Headers
                let headers = Object.keys(rawData[0]);
                // Rows
                let rows = rawData.map(obj => headers.map(h => obj[h]));
                let tableData = [headers, ...rows];

                // FIX: Apply Filtering Logic (Shipped Orders)
                tableData = await filterShippedOrders(tableData);

                // Update State
                importedDataState['source'] = tableData;
                originalDataState['source'] = JSON.parse(JSON.stringify(tableData));
                activeOperationState['source'] = null;

                // Init Columns (if first time)
                if (columnState['source'].indices.length === 0) {
                    let allIndices = headers.map((_, index) => index);
                    columnState['source'].indices = allIndices;
                    applyDefaultVisibility('source', headers);
                }

                // Render
                processAndRenderData('source');
                updateColumnDropdown('source', headers);

                // Standard Ops (silent mode to avoid modals during auto-fetch)
                performPackageCount('source', true);

                // Realtime Update Logic
                handleSourceDataUpdate(tableData, true);

                // Sync to Target (if empty)
                const targetData = importedDataState['target'];
                if (!targetData || targetData.length <= 1) {
                    await syncSourceToSide('target');
                }

                // Detect Cancels
                await detectAndPopulateCancels();

                log.info('Auto-fetch successful');
            } else if (!res.success) {
                // Handle API errors (credentials missing, etc.)
                log.error('Auto-fetch failed:', res.message);
                showAlert(res.message || 'Veri çekme işlemi başarısız oldu.', 'error');
            }
        } catch (err) {
            log.error('Auto-fetch error:', err);
        }
    }

    // Kargolar Kargoya Verildi Button Handler
    if (btnMarkShipped) {
        btnMarkShipped.addEventListener('click', async () => {
            if (!currentStore) {
                showAlert('Lütfen önce bir mağaza seçiniz.', 'warning');
                return;
            }

            // 1. Validation Logic
            const validation = getValidationStatus();
            if (!validation.allValid) {
                showAlert('Tüm ürün adetleri kaynak liste ile eşleşmiyor. Lütfen kırmızı ile işaretli satırları kontrol ediniz.', 'error');
                return;
            }

            // 2. Data Check (Source should exist)
            const sourceData = importedDataState['source'];
            if (!sourceData || sourceData.length < 2) {
                showAlert('Hazırlanacak sipariş listesi boş.', 'warning');
                return;
            }

            showConfirm(
                'İşlemi Onayla',
                'İptaller arşivlenecek ve tablolar temizlenecek. Devam etmek istiyor musunuz?',
                async () => {

                    try {
                        // 1. Save Filtered Source Data (Original Orders - Cancels) to Cargo Archive
                        // We use original source data (ham veri) but exclude cancelled orders
                        let sourceData = originalDataState['source'] || importedDataState['source'];

                        if (sourceData && sourceData.length > 1) {
                            // Identify Cancelled Orders
                            const cancelsData = importedDataState['cancels'];
                            const cancelledOrderNos = new Set();

                            if (cancelsData && cancelsData.length > 1) {
                                // Flexible column search for Order No
                                const cHeader = cancelsData[0];
                                const cOrderNoIdx = cHeader.findIndex(h => h && (
                                    h.toString().toLowerCase().includes('sipariş no') ||
                                    h.toString().toLowerCase().includes('sipariş numara') ||
                                    h.toString().toLowerCase().includes('order no') ||
                                    h.toString().toLowerCase().includes('order num') ||
                                    h.toString().toLowerCase().includes('siparis no')
                                ));

                                if (cOrderNoIdx !== -1) {
                                    // Skip header row
                                    for (let i = 1; i < cancelsData.length; i++) {
                                        const val = cancelsData[i][cOrderNoIdx];
                                        if (val) cancelledOrderNos.add(val.toString().trim());
                                    }
                                }
                            }

                            // Filter Source Data
                            const sHeader = sourceData[0];
                            const sOrderNoIdx = sHeader.findIndex(h => h && (
                                h.toString().toLowerCase().includes('sipariş no') ||
                                h.toString().toLowerCase().includes('sipariş numara') ||
                                h.toString().toLowerCase().includes('order no') ||
                                h.toString().toLowerCase().includes('order num') ||
                                h.toString().toLowerCase().includes('siparis no')
                            ));

                            // Check for Status Column (to update instead of append)
                            const statusIdx = sHeader.findIndex(h => h && (
                                h.toString().toLowerCase().trim() === 'sipariş statüsü' ||
                                h.toString().toLowerCase().trim() === 'kargo durumu' ||
                                h.toString().toLowerCase().trim() === 'durum' ||
                                h.toString().toLowerCase().trim() === 'status'
                            ));

                            // Prepare Archive Data
                            const filteredArchive = [];

                            // Headers
                            if (statusIdx !== -1) {
                                filteredArchive.push([...sHeader]);
                            } else {
                                // Fallback: Add column if missing (User prefers Sipariş Statüsü)
                                filteredArchive.push([...sHeader, 'Sipariş Statüsü']);
                            }

                            for (let i = 1; i < sourceData.length; i++) {
                                const row = sourceData[i];
                                const orderNo = (sOrderNoIdx !== -1 && row[sOrderNoIdx]) ? row[sOrderNoIdx].toString().trim() : null;

                                // KEY FIX: Only add if orderNo exists AND is not cancelled
                                if (orderNo && !cancelledOrderNos.has(orderNo)) {
                                    const newRow = [...row];
                                    if (statusIdx !== -1) {
                                        newRow[statusIdx] = 'Kargoya Verildi';
                                    } else {
                                        newRow.push('Kargoya Verildi');
                                    }
                                    filteredArchive.push(newRow);
                                }
                            }

                            if (filteredArchive.length > 1) {
                                await saveToDailyArchive('cargo', filteredArchive);
                                log.info(`Cargo archive saved: ${filteredArchive.length - 1} orders (Filtered out ${cancelledOrderNos.size} cancels)`);
                            }
                        }

                        // 2. Prepare Cancels Archive Data (if exists)
                        const cancelsData = importedDataState['cancels'];
                        if (cancelsData && cancelsData.length > 1) {
                            const cancelsArchiveData = JSON.parse(JSON.stringify(cancelsData));
                            const cancelsHeaders = cancelsArchiveData[0];

                            // Add 'İptal Aşaması' Column
                            cancelsHeaders.push('İptal Aşaması');

                            for (let i = 1; i < cancelsArchiveData.length; i++) {
                                cancelsArchiveData[i].push('Hazırlanmayı Beklerken İptal');
                            }

                            // Save to Cancels Archive
                            await saveToDailyArchive('cancel', cancelsArchiveData);
                            log.info('Cancels archive saved successfully');
                        }

                        // Clear State
                        importedDataState['source'] = null;
                        originalDataState['source'] = null;
                        importedDataState['target'] = null;
                        originalDataState['target'] = null;
                        importedDataState['cancels'] = null;
                        originalDataState['cancels'] = null;
                        activeOperationState['source'] = null;
                        activeOperationState['target'] = null;
                        activeOperationState['cancels'] = null;
                        previousRawSourceData = null; // Clear previous source data

                        isPreparationStarted = false;

                        // STOP Auto Fetch Intervals
                        if (autoFetchInterval) clearInterval(autoFetchInterval);
                        if (statusUpdateInterval) clearInterval(statusUpdateInterval);
                        autoFetchInterval = null;
                        statusUpdateInterval = null;

                        // 7. Update UI - Clear all tables
                        processAndRenderData('source');
                        processAndRenderData('target');
                        processAndRenderData('cancels');

                        if (fileInputSource) fileInputSource.value = '';
                        if (fileInputTarget) fileInputTarget.value = '';

                        // Reset Preparation Button
                        if (btnStartPreparation) {
                            btnStartPreparation.disabled = false;
                            btnStartPreparation.classList.remove('bg-gray-400', 'cursor-not-allowed', 'opacity-50');
                            btnStartPreparation.classList.add('bg-blue-600', 'hover:bg-blue-700');
                            btnStartPreparation.innerHTML = `
                        <svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Hazırlamaya Başla
                    `;
                        }

                        // Reset Mark Shipped Button (disable it)
                        btnMarkShipped.disabled = true;
                        btnMarkShipped.classList.add('opacity-50', 'cursor-not-allowed');

                        log.info('Orders marked as shipped, cancels archived, and all tables cleared.');
                        showAlert('İşlem başarıyla tamamlandı.\n\n✓ Siparişler kargo arşivine kaydedildi\n✓ İptaller arşivlendi\n✓ Tablolar temizlendi', 'success');
                    } catch (err) {
                        log.error('Error in mark shipped flow:', err);
                        showAlert('Bir hata oluştu: ' + err.message, 'error');
                    }
                }
            );
        });
    }
});

// --- STORE LOGIC ---
function initializeStoreLogic() {
    const { ipcRenderer } = require('electron');

    // Listen for store ID from main process
    ipcRenderer.on('set-store-id', (event, storeId) => {
        if (!storeId) {
            console.error('No store ID received');
            switchView('no-store');
            return;
        }

        // Load store details and set as current
        ipcRenderer.invoke('db-get-store', storeId).then(store => {
            if (!store) {
                console.error('Store not found:', storeId);
                switchView('no-store');
                return;
            }

            currentStore = store;
            document.title = `PaketPilot - ${store.name}`;

            const isTrendyol = (store.store_type || 'website').toLowerCase() === 'trendyol';
            const btnDashboard = document.getElementById('btn-nav-dashboard');

            if (isTrendyol) {
                // TRENDYOL
                if (btnDashboard) {
                    btnDashboard.classList.remove('opacity-50', 'pointer-events-none');
                }
                const headerTitle = document.getElementById('header-title');
                if (headerTitle) headerTitle.textContent = `SİPARİŞ YÖNETİMİ - ${store.name.toUpperCase()}`;

                switchView('dashboard');
            } else {
                // OTHER
                if (btnDashboard) {
                    btnDashboard.classList.add('opacity-50', 'pointer-events-none');
                }
                const headerTitle = document.getElementById('header-title');
                if (headerTitle) headerTitle.textContent = `KARGO ARŞİVİ - ${store.name.toUpperCase()}`;

                switchView('archive');
            }

            // Load history
            loadImportHistory('source');
            loadImportHistory('target');
            loadImportHistory('cancels');

            // Load today's archived data
            loadTodayArchiveToTables();

            // Update settings if needed
            updateSettingsHeader(store);
            handleSettingsStoreChange(store.id);

            log.info(`Initialized with store: ${store.name} (ID: ${store.id})`);
        }).catch(err => {
            console.error('Error loading store:', err);
            switchView('no-store');
        });
    });

    // Listen for store updates from other windows
    ipcRenderer.on('stores-updated', () => {
        // Reload current store data if needed
        if (currentStore) {
            ipcRenderer.invoke('db-get-store', currentStore.id).then(store => {
                if (store) {
                    currentStore = store;
                    updateSettingsHeader(store);
                    // Also update header title on change
                    document.title = `PaketPilot - ${store.name}`;
                    const headerTitle = document.getElementById('header-title');
                    if (headerTitle) headerTitle.textContent = `SİPARİŞ YÖNETİMİ - ${store.name.toUpperCase()}`;
                }
            });
        }
    });
}

// DEPRECATED: These functions are no longer used in single-store-per-window mode
// Each window now operates on a single store passed from main process

/*
function renderSidebarStores(stores) {
    const container = document.getElementById('sidebar-store-list');
    if (!container) return;

    container.innerHTML = '';

    stores.forEach(store => {
        const a = document.createElement('a');
        a.href = "#";
        a.className = `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors group mb-1 ${currentStore && currentStore.id === store.id
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-600 hover:bg-gray-50'
            }`;

        a.innerHTML = `
            <svg class="w-5 h-5 ${currentStore && currentStore.id === store.id ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            ${store.name}
        `;

        a.addEventListener('click', (e) => {
            e.preventDefault();
            switchStore(store);
            switchView('dashboard');
        });

        container.appendChild(a);
    });
}

function switchStore(store) {
    if (!store) return;
    currentStore = store;

    // Update Sidebar UI
    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('db-get-stores').then(stores => {
        renderSidebarStores(stores);
    });
    // Update Document Title
    document.title = `PaketPilot - Sipariş Yönetimi - ${store.name}`;

    // Clear Current Data
    importedDataState = { 'source': null, 'target': null, 'cancels': null };
    originalDataState = { 'source': null, 'target': null, 'cancels': null };
    previousRawSourceData = null; // Clear previous source data for cancel detection

    // Stop intervals on store switch
    if (autoFetchInterval) clearInterval(autoFetchInterval);
    if (statusUpdateInterval) clearInterval(statusUpdateInterval);
    autoFetchInterval = null;
    statusUpdateInterval = null;
    isPreparationStarted = false; // Reset prep state too

    // Reset Prep Button text if it exists (needs DOM element access, but switchStore might be called when view not active?)
    // Best to let render handles or re-init reset user state. 
    const btnStartPreparation = document.getElementById('btn-start-preparation');
    if (btnStartPreparation) {
        btnStartPreparation.disabled = false;
        btnStartPreparation.classList.remove('bg-gray-400', 'cursor-not-allowed');
        btnStartPreparation.classList.add('bg-blue-600', 'hover:bg-blue-700');
        btnStartPreparation.innerHTML = `
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Hazırlamaya Başla
        `;
    }

    // Clear Views
    processAndRenderData('source');
    processAndRenderData('target');

    // Reload History
    loadImportHistory('source');
    loadImportHistory('target');
    loadImportHistory('cancels');

    // Load today's archived data for Target and Cancels
    loadTodayArchiveToTables();

    // If Archive View is active, refresh it
    const archiveView = document.getElementById('view-archive');
    if (archiveView && !archiveView.classList.contains('hidden')) {
        loadArchivePage();
    }

    // If Settings View is active, update selected store details
    updateSettingsHeader(store);

    // Always refresh settings data for the new store
    handleSettingsStoreChange(store.id);

    log.info(`Switched to store: ${store.name}`);
}
*/


function startHeaderClock() {
    const updateTime = () => {
        const now = new Date();
        const el = document.getElementById('header-datetime');
        if (el) {
            el.textContent = now.toLocaleString('tr-TR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        }
    };
    updateTime(); // Initial call
    setInterval(updateTime, 1000); // 1 second interval
    // Also re-check/re-start if elements are re-created (not likely here but safe practice)
}

function switchRightTab(tab) {
    activeRightTab = tab;

    // Update Button Visuals
    if (tab === 'target') {
        btnShowTarget.className = "w-1/2 px-4 py-3 flex justify-center items-center cursor-pointer bg-white border-b border-blue-500 transition-colors duration-200";
        btnShowTarget.querySelector('span').className = "text-xs font-bold text-blue-600 uppercase tracking-wider";

        btnShowCancels.className = "w-1/2 bg-gray-50 px-4 py-3 flex justify-center items-center hover:bg-gray-100 transition-colors duration-200 cursor-pointer ";
        btnShowCancels.querySelector('span').className = "text-xs font-bold text-gray-400 uppercase tracking-wider";
    } else {
        btnShowCancels.className = "w-1/2 px-4 py-3 flex justify-center items-center cursor-pointer bg-white border-b border-red-500 transition-colors duration-200";
        btnShowCancels.querySelector('span').className = "text-xs font-bold text-red-600 uppercase tracking-wider";

        btnShowTarget.className = "w-1/2 bg-gray-50 px-4 py-3 flex justify-center items-center hover:bg-gray-100 transition-colors duration-200 cursor-pointer ";
        btnShowTarget.querySelector('span').className = "text-xs font-bold text-gray-400 uppercase tracking-wider";
    }

    // Load/Render Data
    processAndRenderData(tab);

    // Update Dropdown Contexts (History, Columns)
    // History dropdown for right side is shared? "target-history-btn"
    // We should probably reload history dropdown content for the active tab.
    loadImportHistory(tab);

    // Update columns
    const data = importedDataState[tab];
    const headers = data ? data[0] : [];
    updateColumnDropdown(tab, headers);
}

function loadImportHistory(side) {
    if (!currentStore) return;

    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('get-import-history', { side, storeId: currentStore.id }).then(history => {
        // Map 'cancels' to 'target' UI elements since they share the right panel controls
        const uiSide = (side === 'cancels') ? 'target' : side;

        // 1. Try generic select (for Target or old structure)
        const select = document.getElementById(`${uiSide}-history-select`);
        if (select) {
            while (select.options.length > 1) {
                select.remove(1);
            }
            history.forEach(item => {
                const option = document.createElement('option');
                option.value = item.id;
                const date = new Date(item.created_at).toLocaleString();
                option.text = `${item.filename} (${date})`;
                select.add(option);
            });
            // If select exists, return (legacy)
            return;
        }

        // 2. Try custom list
        const listContainer = document.getElementById(`${uiSide}-history-list`);
        if (listContainer) {
            listContainer.innerHTML = '';

            // If we are loading history for the ACTIVE tab, show it. 
            // If side is 'cancels' but active tab is 'target', do we update the DOM? 
            // The DOM element ID is shared (#target-history-list). 
            // So we should ONLY update if side matches activeRightTab (for right side).
            if (uiSide === 'target' && side !== activeRightTab) return;

            if (history.length === 0) {
                listContainer.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">Kayıt bulunamadı.</div>';
                return;
            }

            history.forEach(item => {
                const div = document.createElement('div');
                div.className = 'px-3 py-2 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-600 cursor-pointer border-b border-gray-50 last:border-0 transition-colors duration-150 flex flex-col gap-0.5 group';

                const date = new Date(item.created_at).toLocaleString('tr-TR');

                div.innerHTML = `
                    <span class="font-medium truncate group-hover:text-blue-700">${item.filename}</span>
                    <span class="text-[10px] text-gray-400 group-hover:text-blue-400">${date}</span>
                `;

                div.addEventListener('click', () => {
                    // Update label
                    const label = document.getElementById(`${uiSide}-history-label`);
                    if (label) label.textContent = item.filename;

                    // Close dropdown
                    const dropdown = document.getElementById(`${uiSide}-history-dropdown`);
                    if (dropdown) dropdown.classList.add('hidden');

                    // Trigger Load
                    loadBatchData(item.id, side);
                });

                listContainer.appendChild(div);
            });
        }
    });
}

// ... existing code ...

// Helper to filter already shipped orders
async function filterShippedOrders(data) {
    log.info(`[Filter] Checking... Store: ${currentStore ? currentStore.id : 'null'}, Data: ${data ? data.length : 0}`);
    if (typeof log !== 'undefined') log.info(`[Filter] Checking... Store: ${currentStore ? currentStore.id : 'null'}, Data: ${data ? data.length : 0}`);

    if (!currentStore || !data || data.length < 2) return data;
    const { ipcRenderer } = require('electron');
    try {
        const shippedOrders = await ipcRenderer.invoke('get-shipped-order-numbers', currentStore.id);
        log.info(shippedOrders)

        if (typeof log !== 'undefined') log.info(`[Filter] Received ${shippedOrders ? shippedOrders.length : 0} shipped order numbers from archive.`);

        if (!shippedOrders || shippedOrders.length === 0) return data;

        const shippedSet = new Set(shippedOrders);
        const headers = data[0];
        const orderNoIdx = headers.findIndex(h => h && (
            h.toString().toLowerCase().includes('sipariş no') ||
            h.toString().toLowerCase().includes('sipariş numara') ||
            h.toString().toLowerCase().includes('siparis no') ||
            h.toString().toLowerCase().includes('siparis numara') ||
            h.toString().toLowerCase().includes('order no') ||
            h.toString().toLowerCase().includes('order num')
        ));

        if (orderNoIdx === -1) {
            log.warn('[Filter] Could not find "Sipariş Numarası" column in import data. Skipping filter.');
            log.info('[Filter] Available headers:', headers);
            return data;
        }

        log.info(`[Filter] Found Order Number column at index ${orderNoIdx}: "${headers[orderNoIdx]}"`);

        log.info(`[Filter DEBUG] Headers: ${JSON.stringify(headers)}`);
        if (data.length > 1) {
            log.info(`[Filter DEBUG] First Row: ${JSON.stringify(data[1])}`);
            log.info(`[Filter DEBUG] Selected Index for Order No: ${orderNoIdx} ("${headers[orderNoIdx]}")`);
            log.info(`[Filter DEBUG] Value at Index ${orderNoIdx}: "${data[1][orderNoIdx]}"`);
        }

        const filteredData = [headers];
        let filteredCount = 0;

        log.info(`[Filter] Starting comparison for ${data.length - 1} rows...`);

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const orderNo = row[orderNoIdx];
            const valStr = orderNo ? String(orderNo).trim() : ''; // Normalization

            const exists = shippedSet.has(valStr);

            if (exists) {
                filteredCount++;
            } else {
                filteredData.push(row);
            }
        }

        if (filteredCount > 0) {
            if (typeof log !== 'undefined') log.info(`Filtered out ${filteredCount} already shipped orders from source import.`);

            // Show Filter Info Banner
            const banner = document.getElementById('source-filter-info');
            const bannerText = document.getElementById('source-filter-text');
            if (banner && bannerText) {
                bannerText.textContent = `${filteredCount} adet sipariş kargolandığı için listeden gizlendi.`;
                banner.classList.remove('hidden');
            }
        } else {
            if (typeof log !== 'undefined') log.info('[Filter] No orders were filtered out (Count: 0).');
            // Hide Banner
            const banner = document.getElementById('source-filter-info');
            if (banner) banner.classList.add('hidden');
        }
        return filteredData;

    } catch (e) {
        console.error('Filtering error', e);
        return data; // Fail safe
    }
}

// Handle File Selection
function handleFileSelect(event, side) {
    if (!currentStore) {
        showAlert("Lütfen önce bir mağaza seçiniz.", 'warning');
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Parse JSON with header: 1
        let jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        log.info("deneme source üzeri");
        // Filter Shipped Orders if Source
        if (side === 'source') {
            log.info("deneme source true");
            jsonData = await filterShippedOrders(jsonData);
        }

        if (jsonData.length === 0) {
            showAlert('Excel dosyası boş!', 'error');
            return;
        }

        // If loading source data, save the previous raw data for cancel detection
        if (side === 'source' && originalDataState['source']) {
            previousRawSourceData = JSON.parse(JSON.stringify(originalDataState['source']));
            log.info('Saved previous source data for cancel detection');
        }

        // Store data specifically for this side
        importedDataState[side] = jsonData;
        // Backup for operations
        originalDataState[side] = JSON.parse(JSON.stringify(jsonData));
        activeOperationState[side] = null;

        // Reset file input
        event.target.value = '';

        // Process Headers
        const headers = jsonData[0];
        let allIndices = headers.map((_, index) => index);

        // Find "Ürün Adı" and move it to the start
        const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
        if (productColIndex !== -1) {
            allIndices = allIndices.filter(i => i !== productColIndex);
            allIndices.unshift(productColIndex);
        }

        // Reset visibility state
        columnState[side].indices = allIndices;
        applyDefaultVisibility(side, headers);

        // Render Raw First
        processAndRenderData(side);
        updateColumnDropdown(side, headers);

        // Auto-Run Package Count Calculation
        performPackageCount(side);

        // If Source loaded, sync Target and Cancels (using the calculated data)
        // If Source loaded, determine Target and Cancels
        if (side === 'source') {
            // Force sync Target (User Requirement: Target should strictly reflect filtered Source)
            await syncSourceToSide('target');

            // Always run detection logic to update cancels based on current source vs target
            await detectAndPopulateCancels();
        }

        // Save to Database
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('save-excel-data', { storeId: currentStore.id, side: side, data: jsonData, filename: file.name })
            .then(result => {
                if (result.success) {
                    console.log(`${side} data saved to database.`);
                    // Refresh history
                    loadImportHistory(side);

                    if (side === 'cancels') { // Logic retained for structure but save disabled
                        // const archiveType = 'cancel';
                        // saveToDailyArchive(archiveType, importedDataState[side]);
                    }
                } else {
                    console.error('Failed to save data:', result.message);
                }
            })
            .catch(err => {
                console.error('IPC Error:', err);
            });
    };
    reader.readAsArrayBuffer(file);
}

// Detects orders in previous source that are missing in new source, and populates 'cancels' table.
async function detectAndPopulateCancels() {
    const currentRawSource = originalDataState['source']; // Current raw source data
    const previousRawSource = previousRawSourceData; // Previous raw source data

    // If no previous data exists, nothing to compare
    if (!previousRawSource || previousRawSource.length <= 1) {
        log.info('No previous source data to compare for cancel detection');

        // Initialize empty cancels table with ALL headers from current source
        let cancelsHeader = ['İptal Tespit Tarihi', 'Sipariş No', 'Ürün Adı', 'Barkod', 'Adet']; // Default fallback

        if (currentRawSource && currentRawSource.length > 0) {
            // Add 'İptal Tespit Tarihi' as first column, then all source headers
            cancelsHeader = ['İptal Tespit Tarihi', ...currentRawSource[0]];
        }

        const cancelsData = [cancelsHeader];
        importedDataState['cancels'] = cancelsData;
        originalDataState['cancels'] = JSON.parse(JSON.stringify(cancelsData));

        let allIndices = cancelsHeader.map((_, index) => index);
        columnState['cancels'].indices = allIndices;
        applyDefaultVisibility('cancels', cancelsHeader);

        processAndRenderData('cancels');
        updateColumnDropdown('cancels', cancelsHeader);
        log.info('Initialized empty cancels table with all source columns');
        log.info(`Empty cancels table headers (${cancelsHeader.length} columns):`, cancelsHeader);
        log.info(`Hidden indices for empty cancels:`, Array.from(columnState['cancels'].hiddenIndices));
        return;
    }

    // If no current data, can't compare
    if (!currentRawSource || currentRawSource.length <= 1) {
        log.info('No current source data for cancel detection');
        return;
    }

    // Find column indices in previous source
    const prevHeaders = previousRawSource[0];

    // Find Order Number column (required for comparison)
    const prevOrderNoIdx = prevHeaders.findIndex(h => {
        if (!h) return false;
        const s = h.toString().toLowerCase().trim();
        return s.includes('sipariş') || s.includes('order') || s === 'no' || s.includes('siparis');
    });

    // Find column indices in current source
    const currHeaders = currentRawSource[0];
    const currOrderNoIdx = currHeaders.findIndex(h => {
        if (!h) return false;
        const s = h.toString().toLowerCase().trim();
        return s.includes('sipariş') || s.includes('order') || s === 'no' || s.includes('siparis');
    });

    if (prevOrderNoIdx === -1 || currOrderNoIdx === -1) {
        log.warn('Order number column not found in source data, cannot detect cancels');
        return;
    }

    // Build a Set of current order numbers for fast lookup
    const currentOrderNumbers = new Set();
    for (let i = 1; i < currentRawSource.length; i++) {
        const orderNo = currentRawSource[i][currOrderNoIdx];
        if (orderNo) {
            currentOrderNumbers.add(orderNo.toString().trim());
        }
    }

    // Find orders that existed in previous but missing in current
    // Copy ALL columns from the cancelled orders
    const cancelledOrders = [];
    for (let i = 1; i < previousRawSource.length; i++) {
        const row = previousRawSource[i];
        const orderNo = row[prevOrderNoIdx];

        if (orderNo) {
            const orderNoStr = orderNo.toString().trim();

            // If this order number is NOT in current source, it's cancelled
            if (!currentOrderNumbers.has(orderNoStr)) {
                // Get current timestamp for detection time
                const now = new Date();
                const detectionTime = now.toLocaleString('tr-TR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

                // Copy the ENTIRE row with ALL columns and add detection time at the beginning
                const cancelRow = [detectionTime, ...row];
                cancelledOrders.push(cancelRow);
            }
        }
    }

    // Add 'İptal Tespit Tarihi' as the first column header
    const cancelsHeader = ['İptal Tespit Tarihi', ...prevHeaders];
    const cancelsData = [cancelsHeader, ...cancelledOrders];

    importedDataState['cancels'] = cancelsData;
    originalDataState['cancels'] = JSON.parse(JSON.stringify(cancelsData));

    // Initialize cols
    let allIndices = cancelsHeader.map((_, index) => index);
    columnState['cancels'].indices = allIndices;
    applyDefaultVisibility('cancels', cancelsHeader);

    // Render
    processAndRenderData('cancels');
    updateColumnDropdown('cancels', cancelsHeader);
    log.info(`Detected ${cancelledOrders.length} cancelled orders by comparing order numbers.`);
    log.info(`Cancels table headers (${cancelsHeader.length} columns):`, cancelsHeader);
    log.info(`Hidden indices for cancels:`, Array.from(columnState['cancels'].hiddenIndices));
}

// --- FILE MANAGER LOGIC ---
function loadFileManagerPage() {
    // 1. Mağaza seçili değilse uyar ve dur
    if (!currentStore) {
        console.warn("Mağaza seçili değil, dosya yöneticisi yüklenemedi.");
        return;
    }
    const list = document.getElementById('file-manager-page-list');

    if (!list) {
        console.error("HATA: HTML'de 'file-manager-page-list' ID'li element bulunamadı!");
        return;
    }

    list.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">Yükleniyor...</td></tr>';

    const { ipcRenderer } = require('electron');

    // Hem kaynak hem hedef verilerini çek
    Promise.all([
        ipcRenderer.invoke('get-import-history', { side: 'source', storeId: currentStore.id }),
        ipcRenderer.invoke('get-import-history', { side: 'target', storeId: currentStore.id })
    ]).then(([sources, targets]) => {
        // Etiketleme
        // Gelen veri null olabilir, kontrol ekleyelim
        const safeSources = Array.isArray(sources) ? sources : [];
        const safeTargets = Array.isArray(targets) ? targets : [];

        safeSources.forEach(f => f.sideDisplay = 'Trendyol/Kaynak');
        safeTargets.forEach(f => f.sideDisplay = 'Target/Sayım');

        const all = [...safeSources, ...safeTargets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        renderFileManagerPageList(list, all);
    }).catch(err => {
        console.error('File Manager Load Error:', err);
        list.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-red-500">Hata oluştu: ' + err.message + '</td></tr>';
    });
}

// ... existing code ...

// Archive Page Logic
function loadArchivePage() {
    if (!currentStore) return;

    const isTrendyol = (currentStore.store_type || 'website').toLowerCase() === 'trendyol';
    if (!isTrendyol) {
        return loadManualArchivePage();
    }

    const listContainer = document.getElementById('archive-list-container');
    const dateInput = document.getElementById('archive-date-filter');
    const typeInput = document.getElementById('archive-type-filter');
    const rangeSelect = document.getElementById('archive-range-filter');

    if (!listContainer || !dateInput || !typeInput) return;

    // Calculate Range
    const todayStr = new Date().toISOString().split('T')[0];
    let startDate = todayStr;
    let endDate = todayStr;

    if (rangeSelect) {
        const range = rangeSelect.value;
        const d = new Date();

        switch (range) {
            case 'last_week':
                d.setDate(d.getDate() - 7);
                startDate = d.toISOString().split('T')[0];
                break;
            case 'last_2_weeks':
                d.setDate(d.getDate() - 14);
                startDate = d.toISOString().split('T')[0];
                break;
            case 'last_month':
                d.setDate(d.getDate() - 30);
                startDate = d.toISOString().split('T')[0];
                break;
            case 'today':
                // Default
                break;
            case 'specific':
                if (!dateInput.value) {
                    showAlert('Lütfen bir tarih seçiniz.', 'warning');
                    return;
                }
                startDate = dateInput.value;
                endDate = dateInput.value;
                break;
        }
    } else {
        // Fallback for old UI if select missing
        if (dateInput.value) {
            startDate = dateInput.value;
            endDate = dateInput.value;
        }
    }

    // Force type to 'cargo' based on user request to simplify
    const type = 'cargo';

    listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Yükleniyor...</td></tr>';

    const { ipcRenderer } = require('electron');
    // Using Range IPC
    ipcRenderer.invoke('param-get-daily-entries-range', {
        storeId: currentStore.id,
        startDate,
        endDate,
        type
    }).then(rows => {
        // Filter out cancels if logic requires (though user might want to see them if selected 'all')
        if (typeInput.value === 'cargo') rows = rows.filter(r => r.type === 'cargo');

        log.info(`Archive range loaded: ${rows.length} entries`);
        if (rows.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Bu aralıkta kayıt bulunamadı.</td></tr>';
            return;
        }

        listContainer.innerHTML = '';
        rows.forEach((row, rowIndex) => {
            // Data summary logic
            const rawCount = Array.isArray(row.data) ? row.data.length : 0;
            const dataSummary = rawCount > 0 ? `${rawCount - 1} kayıt (${row.entry_date})` : `Veri detayları... (${row.entry_date})`;
            const typeLabel = row.type === 'cargo' ? 'Kargo' : (row.type === 'cancel' ? 'İptal' : row.type);
            const uniqueId = `archive-detail-${rowIndex}`;

            // Main row
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-200 hover:bg-gray-50';
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${dataSummary}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button class="expand-detail-btn text-blue-600 hover:text-blue-900 p-2 hover:bg-blue-50 rounded" data-target="${uniqueId}">
                        <svg class="w-4 h-4 inline-block transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                        Detayları Göster
                    </button>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button class="text-red-600 hover:text-red-900 delete-daily-btn p-2 hover:bg-red-50 rounded" data-id="${row.id}">Sil</button>
                </td>
            `;
            listContainer.appendChild(tr);

            // Detail row (hidden by default)
            const detailTr = document.createElement('tr');
            detailTr.id = uniqueId;
            detailTr.className = 'hidden bg-gray-50';

            const tableResult = renderArchiveDetailTable(row.data, row.id, row.type);
            detailTr.innerHTML = `
                <td colspan="3" style="padding: 0; border: none; position: sticky; left: 0; z-index: 5;">
                    <div class="bg-white shadow-sm border-b border-gray-200 w-full">
                        <div class="w-full relative px-4 pb-4">
                            ${tableResult.html}
                        </div>
                    </div>
                </td>
            `;
            listContainer.appendChild(detailTr);

        }); // Close forEach
    }).catch(err => {
        console.error('Archive Load Error:', err);
        listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-red-500">Hata oluştu.</td></tr>';
    });
}

// Load Manual Archive Page (For non-Trendyol stores)
function loadManualArchivePage() {
    const listContainer = document.getElementById('archive-list-container');
    const dateInput = document.getElementById('archive-date-filter');
    const rangeSelect = document.getElementById('archive-range-filter');

    if (!listContainer) return;

    // Calculate Range
    const todayStr = new Date().toISOString().split('T')[0];
    let startDate = todayStr;
    let endDate = todayStr;

    if (rangeSelect) {
        const range = rangeSelect.value;
        const d = new Date();
        switch (range) {
            case 'last_week':
                d.setDate(d.getDate() - 7);
                startDate = d.toISOString().split('T')[0];
                break;
            case 'last_2_weeks':
                d.setDate(d.getDate() - 14);
                startDate = d.toISOString().split('T')[0];
                break;
            case 'last_month':
                d.setDate(d.getDate() - 30);
                startDate = d.toISOString().split('T')[0];
                break;
            case 'today':
                break;
            case 'specific':
                if (dateInput && dateInput.value) {
                    startDate = dateInput.value;
                    endDate = dateInput.value;
                }
                break;
        }
    } else if (dateInput && dateInput.value) {
        startDate = dateInput.value;
        endDate = dateInput.value;
    }

    listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Yükleniyor...</td></tr>';

    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('db-get-manual-cargo-entries', { storeId: currentStore.id, startDate, endDate })
        .then(rows => {
            if (!rows || rows.length === 0) {
                listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Kayıt bulunamadı.</td></tr>';
                return;
            }

            // Group by Date
            const grouped = {};
            rows.forEach(r => {
                const date = r.created_at ? r.created_at.split(' ')[0] : 'Tarihsiz';
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(r);
            });

            listContainer.innerHTML = '';

            Object.keys(grouped).sort().reverse().forEach((date, idx) => {
                const dayRows = grouped[date];
                const dataSummary = `${dayRows.length} ürün girişi (${date})`;
                const uniqueId = `manual-archive-${idx}`;

                const tr = document.createElement('tr');
                tr.className = 'border-b border-gray-200 hover:bg-gray-50';
                tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${dataSummary}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button class="expand-detail-btn text-blue-600 hover:text-blue-900 p-2 hover:bg-blue-50 rounded" data-target="${uniqueId}">
                         <svg class="w-4 h-4 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg> Detay
                    </button>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm">
                   <span class="text-xs text-gray-400">Manuel</span>
                </td>
            `;
                listContainer.appendChild(tr);

                const detailTr = document.createElement('tr');
                detailTr.id = uniqueId;
                detailTr.className = 'hidden bg-gray-50';

                let innerHTML = `
                <div class="p-4 bg-white border m-4 rounded shadow-sm">
                <table class="min-w-full divide-y divide-gray-200 text-xs">
                    <thead class="bg-gray-100"><tr><th class="px-2 py-1 text-left">Ürün</th><th class="px-2 py-1 text-left">Paket</th><th class="px-2 py-1 text-left">Adet</th><th class="px-2 py-1 text-left">Barkod</th><th class="px-2 py-1 text-left">Saat</th></tr></thead>
                    <tbody class="divide-y divide-gray-100">
            `;
                dayRows.forEach(item => {
                    const time = item.created_at ? item.created_at.split(' ')[1] : '';
                    innerHTML += `<tr>
                    <td class="px-2 py-1 font-medium text-gray-900">${item.product_name || '-'}</td>
                    <td class="px-2 py-1">${item.package_count || 0}</td>
                    <td class="px-2 py-1">${item.quantity || 0}</td>
                    <td class="px-2 py-1 font-mono text-gray-600">${item.barcode || '-'}</td>
                    <td class="px-2 py-1 text-gray-400">${time}</td>
                </tr>`;
                });
                innerHTML += `</tbody></table></div>`;

                detailTr.innerHTML = `<td colspan="3" class="p-0 border-0">${innerHTML}</td>`;
                listContainer.appendChild(detailTr);
            });

        })
        .catch(err => {
            console.error(err);
            listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">Hata: ' + err.message + '</td></tr>';
        });
}

// Load Cancels Archive Page (only cancel type)
function loadCancelsArchivePage() {
    if (!currentStore) return;

    const listContainer = document.getElementById('cancels-archive-list-container');
    const dateInput = document.getElementById('cancels-archive-date-filter');

    if (!listContainer || !dateInput) return;

    const date = dateInput.value;

    if (!date) {
        showAlert('Lütfen bir tarih seçiniz.', 'warning');
        return;
    }

    listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Yükleniyor...</td></tr>';

    const { ipcRenderer } = require('electron');
    log.info(`Loading cancels archive for Date: ${date}`);

    ipcRenderer.invoke('param-get-daily-entries', { storeId: currentStore.id, date, type: 'cancel' }).then(rows => {
        log.info(`Cancels archive rows found: ${rows.length}`);
        if (rows.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Bu tarihe ait iptal kaydı bulunamadı.</td></tr>';
            return;
        }
        listContainer.innerHTML = '';
        rows.forEach((row, rowIndex) => {
            const dataSummary = Array.isArray(row.data) ? `${row.data.length - 1} iptal` : 'Veri detayları...';
            let cancelStage = 'İptal';
            if (Array.isArray(row.data) && row.data.length > 0) {
                const headers = row.data[0];
                const stageIdx = headers.findIndex(h => h && h.toString().toLowerCase().includes('iptal aşaması'));
                if (stageIdx !== -1 && row.data.length > 1) {
                    cancelStage = row.data[1][stageIdx] || 'İptal';
                }
            }
            const uniqueId = `cancels-archive-detail-${rowIndex}`;
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-200 hover:bg-gray-50';
            tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${row.entry_date}</td><td class="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-medium">${cancelStage}</td><td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${dataSummary}</td><td class="px-6 py-4 whitespace-nowrap text-sm font-medium"><button class="expand-detail-btn text-blue-600 hover:text-blue-900 p-2 hover:bg-blue-50 rounded" data-target="${uniqueId}"><svg class="w-4 h-4 inline-block transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>Detayları Göster</button></td><td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium"><button class="text-red-600 hover:text-red-900 delete-daily-btn p-2 hover:bg-red-50 rounded" data-id="${row.id}">Sil</button></td>`;
            listContainer.appendChild(tr);
            const detailTr = document.createElement('tr');
            detailTr.id = uniqueId;
            detailTr.className = 'hidden bg-gray-50';
            const tableResult = renderArchiveDetailTable(row.data, row.id, row.type);
            detailTr.innerHTML = `
    <td colspan="5" style="padding: 0; border: none; position: sticky; left: 0; z-index: 5;">
        <div class="bg-white shadow-sm border-b border-gray-200" style="width: calc(100vw - 280px);">
            <div class="overflow-x-auto w-full relative px-4 pb-4">
                <div style="min-width: 100%; width: max-content;">
                    ${tableResult.html}
                </div>
            </div>
        </div>
    </td>
`;
            listContainer.appendChild(detailTr);
            if (tableResult.setup) { setTimeout(() => tableResult.setup(), 0); }
        });
    }).catch(err => {
        console.error('Cancels Archive Load Error:', err);
        listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-red-500">Hata oluştu.</td></tr>';
    });
}

// Helper function to render detailed archive data table with edit capability
function renderArchiveDetailTable(data, archiveId, archiveType) {
    if (!Array.isArray(data) || data.length === 0) {
        return { html: '<p class="text-sm text-gray-500">Veri bulunamadı.</p>', setup: null };
    }

    const headers = data[0];
    const rows = data.slice(1);

    if (!headers || headers.length === 0) {
        return { html: '<p class="text-sm text-gray-500">Geçersiz veri formatı.</p>', setup: null };
    }

    // --- 1. Column Analysis & Visibility Logic ---

    // Exact or reliable matchers for the columns user explicitly wants
    const desiredOrder = [
        { key: 'order_no', matches: ['sipariş numarası', 'sipariş no', 'order number', 'siparis no', 'sipariş numarasi'] },
        { key: 'status', matches: ['kargo durumu', 'durum', 'statü', 'kargo status'] },
        { key: 'product_name', matches: ['ürün adı', 'ürün ismi', 'product name'] },
        { key: 'receiver', matches: ['alıcı', 'alıcı adı', 'müşteri', 'müşteri adı', 'receiver'] },
        { key: 'barcode', matches: ['barkod', 'barcode'] },
        { key: 'tracking', matches: ['kargo kodu', 'kargo takip', 'takip no', 'gönderi kodu'] },
        { key: 'quantity', matches: ['adet', 'miktar', 'quantity', 'paket sayısı', 'adet sayısı', 'müşteri sipariş ededi'] }
    ];

    // Helper: Strict(er) matching to avoid "Alıcı - Adres" matching "Alıcı"
    const isMatch = (headerText, matches) => {
        const h = headerText.toLowerCase().trim();
        return matches.some(m => {
            // 1. Exact match
            if (h === m) return true;
            // 2. Starts with match (good for "Sipariş Numarası (Custom)")
            if (h.startsWith(m + ' ')) return true;
            // 3. Fallback: Contains match, BUT only if it's not a known exclusion
            // "Alıcı - Fatura Adresi" logic: if we match 'alıcı', check if text implies address
            if (m === 'alıcı' && (h.includes('adres') || h.includes('address'))) return false;

            return h.includes(m);
        });
    };

    // Prepare Columns Data Structure
    let columns = headers.map((h, i) => {
        return {
            originalIndex: i,
            text: h || 'N/A',
            visible: false
        };
    });

    const orderedColumns = [];
    const usedIndices = new Set();
    const editableIndices = new Set();

    // Identify editable columns for logic (Quantity fields)
    columns.forEach(col => {
        const lower = col.text.toLowerCase();
        if (lower === 'adet' || lower === 'miktar' || lower === 'quantity' ||
            lower === 'paket sayısı' || lower === 'adet sayısı') {
            editableIndices.add(col.originalIndex);
        }
    });

    // 1. Add "Desired" columns first (if found)
    desiredOrder.forEach(def => {
        // Find the BEST match (first occurrence that isn't used)
        const found = columns.find(col => !usedIndices.has(col.originalIndex) && isMatch(col.text, def.matches));
        if (found) {
            found.visible = true; // Set to Visible
            orderedColumns.push(found);
            usedIndices.add(found.originalIndex);
        }
    });

    // 2. Add "Remaining" columns (Default Hidden)
    columns.forEach(col => {
        if (!usedIndices.has(col.originalIndex)) {
            // visible remains false
            orderedColumns.push(col);
        }
    });

    const tableId = `archive-table-${archiveId}`;
    const dropdownId = `archive-cols-dropdown-${archiveId}`;
    const menuButtonId = `menu-button-${archiveId}`;

    // --- 2. Build HTML ---
    // Note: We use !important in inline styles to ensure browser respects initial state

    let tableHTML = `
        <div class="mb-3 flex justify-between items-center relative">
            <!-- Left Side: Columns Dropdown -->
            <div class="relative inline-block text-left">
                <button type="button" class="cols-toggle-btn inline-flex justify-center w-full rounded-md border border-gray-300 shadow-sm px-3 py-1.5 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none" id="${menuButtonId}" aria-expanded="true" aria-haspopup="true">
                    Columns
                    <svg class="-mr-1 ml-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>

                <div id="${dropdownId}" class="hidden origin-top-left absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50 max-h-64 overflow-y-auto" role="menu" aria-orientation="vertical" aria-labelledby="${menuButtonId}">
                    <div class="py-1" role="none">
    `;

    // Dropdown Checkboxes
    orderedColumns.forEach((col, idx) => {
        const checked = col.visible ? 'checked' : '';
        tableHTML += `
            <label class="flex items-center px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 cursor-pointer select-none">
                <input type="checkbox" class="col-visibility-checkbox form-checkbox h-3 w-3 text-blue-600 rounded mr-2" 
                    data-col-idx="${idx}" ${checked}>
                <span class="truncate">${col.text}</span>
            </label>
        `;
    });

    tableHTML += `
                    </div>
                </div>
            </div>

            <!-- Right Side: Save Button -->
            <button class="save-archive-btn px-4 py-2 text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-md transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" 
                    data-archive-id="${archiveId}" 
                    data-archive-type="${archiveType}"
                    disabled>
                <svg class="w-4 h-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                Değişiklikleri Kaydet
            </button>
        </div>
        
        <div class="overflow-x-auto">
        <table id="${tableId}" class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-100">
                <tr>
    `;

    // Render Headers
    orderedColumns.forEach((col, idx) => {
        // Crucial: Default hidden with !important if !visible
        const style = col.visible ? '' : 'display: none !important;';
        tableHTML += `<th class="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider col-cell-${idx}" style="${style}">${col.text}</th>`;
    });

    // Add Action Column Header
    tableHTML += '<th class="px-4 py-2 text-center text-xs font-medium text-gray-700 uppercase tracking-wider sticky right-0 bg-gray-100" style="min-width: 60px;">İşlem</th>';
    tableHTML += `</tr></thead><tbody class="bg-white divide-y divide-gray-100">`;

    // Render Data Rows
    rows.forEach((row, rowIndex) => {
        if (!row || row.length === 0) return;
        tableHTML += '<tr class="hover:bg-gray-50">';

        orderedColumns.forEach((col, idx) => {
            const style = col.visible ? '' : 'display: none !important;';
            const cellValue = row[col.originalIndex] !== undefined && row[col.originalIndex] !== null ? row[col.originalIndex] : '';

            if (editableIndices.has(col.originalIndex)) {
                tableHTML += `<td class="px-4 py-2 text-sm text-gray-900 whitespace-nowrap editable-cell cursor-pointer hover:bg-blue-50 col-cell-${idx}" style="${style}" data-row="${rowIndex}" data-col="${col.originalIndex}" title="Düzenlemek için tıklayın"><span class="cell-value">${cellValue}</span></td>`;
            } else {
                let displayVal = cellValue;
                if (typeof cellValue === 'string' && cellValue.toLowerCase().trim() === 'kargoya verildi') {
                    displayVal = `<span class="text-blue-600 font-bold">${cellValue}</span>`;
                }
                tableHTML += `<td class="px-4 py-2 text-sm text-gray-900 whitespace-nowrap col-cell-${idx}" style="${style}">${displayVal}</td>`;
            }
        });

        // Add Delete Button Cell
        tableHTML += `
            <td class="px-4 py-2 text-center text-sm font-medium whitespace-nowrap sticky right-0 bg-white border-l border-gray-50">
                <button class="text-red-600 hover:text-red-900 delete-detail-row-btn p-1 rounded hover:bg-red-50" data-row-idx="${rowIndex}" title="Bu satırı sil">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </td>`;
        tableHTML += '</tr>';
    });

    tableHTML += `</tbody></table></div>`;

    // --- 3. Setup Script (Event Listeners) ---
    const setup = () => {
        const table = document.getElementById(tableId);
        if (!table) return;

        // Delete Individual Row Logic
        table.querySelectorAll('.delete-detail-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent row click
                const rowIdx = parseInt(btn.getAttribute('data-row-idx'));
                showConfirmModal('Satırı Sil', 'Bu satırı silmek istediğinize emin misiniz?', async () => {
                    // Calculate real index in 'data' array (Header is 0, rows start at 1)
                    // rowIndex from loop is 0-based for rows array. rows = data.slice(1).
                    // So data index = rowIdx + 1.
                    const realIndex = rowIdx + 1;

                    // Remove from 'tableData' (clone)
                    tableData.splice(realIndex, 1);

                    const { ipcRenderer } = require('electron');
                    const res = await ipcRenderer.invoke('param-update-daily-entry', { id: archiveId, data: tableData });

                    if (res.success) {
                        loadArchivePage();
                    } else {
                        showAlert('Silme işlemi başarısız: ' + res.message, 'error');
                    }
                });
            });
        });

        const dropdownBtn = document.getElementById(menuButtonId);
        const dropdownMenu = document.getElementById(dropdownId);

        if (dropdownBtn && dropdownMenu) {
            // Toggle
            dropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownMenu.classList.toggle('hidden');
            });

            // Close outside
            document.addEventListener('click', (e) => {
                if (!dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
                    dropdownMenu.classList.add('hidden');
                }
            });

            // Visibility Toggle
            dropdownMenu.querySelectorAll('.col-visibility-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const colIdx = e.target.getAttribute('data-col-idx');
                    const isChecked = e.target.checked;

                    const cells = table.querySelectorAll(`.col-cell-${colIdx}`);
                    cells.forEach(cell => {
                        cell.style.display = isChecked ? '' : 'none';
                    });
                });
            });
        }

        // --- Edit Logic ---
        const tableData = JSON.parse(JSON.stringify(data));
        const originalData = JSON.parse(JSON.stringify(data));
        let hasChanges = false;
        const saveBtn = table.parentElement.parentElement.querySelector('.save-archive-btn');

        const checkForChanges = () => {
            hasChanges = JSON.stringify(tableData) !== JSON.stringify(originalData);
            if (saveBtn) {
                saveBtn.disabled = !hasChanges;
                // Visual feedback for save button
                if (hasChanges) {
                    saveBtn.classList.remove('bg-white', 'text-gray-700');
                    saveBtn.classList.add('bg-blue-600', 'text-white');
                } else {
                    saveBtn.classList.add('bg-white', 'text-gray-700');
                    saveBtn.classList.remove('bg-blue-600', 'text-white');
                }
            }
        };

        table.querySelectorAll('.editable-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                if (cell.querySelector('input')) return;

                const rowIndex = parseInt(cell.getAttribute('data-row'));
                const colIndex = parseInt(cell.getAttribute('data-col'));
                const currentValue = tableData[rowIndex + 1][colIndex] || '';

                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'w-full h-full px-1 py-0 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded bg-white';
                input.style.minWidth = '40px';
                input.style.maxWidth = '100px';
                input.value = currentValue;

                cell.innerHTML = '';
                cell.appendChild(input);
                input.focus();
                input.select();

                const saveCellValue = () => {
                    const newValue = input.value;
                    tableData[rowIndex + 1][colIndex] = newValue;
                    cell.innerHTML = `<span class="cell-value">${newValue}</span>`;
                    checkForChanges();
                };

                input.addEventListener('blur', saveCellValue);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') input.blur();
                    if (e.key === 'Escape') {
                        cell.innerHTML = `<span class="cell-value">${currentValue}</span>`;
                    }
                });
            });
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (!hasChanges) return;
                try {
                    saveBtn.disabled = true;
                    saveBtn.innerHTML = '<span class="animate-pulse">Kaydediliyor...</span>';

                    const { ipcRenderer } = require('electron');
                    const result = await ipcRenderer.invoke('param-update-daily-entry', {
                        id: saveBtn.getAttribute('data-archive-id'),
                        data: tableData
                    });

                    if (result.success) {
                        Object.assign(originalData, JSON.parse(JSON.stringify(tableData)));
                        hasChanges = false;
                        checkForChanges();

                        saveBtn.innerHTML = '<svg class="w-4 h-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>Kaydedildi!';

                        setTimeout(() => {
                            saveBtn.innerHTML = '<svg class="w-4 h-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>Değişiklikleri Kaydet';
                            saveBtn.disabled = true;
                        }, 2000);

                        log.info(`Archive updated successfully`);
                    } else {
                        throw new Error(result.message || 'Kaydetme başarısız');
                    }
                } catch (err) {
                    log.error('Failed to save archive changes:', err);
                    showAlert('Değişiklikler kaydedilemedi: ' + err.message, 'error');
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<svg class="w-4 h-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>Değişiklikleri Kaydet';
                }
            });
        }
    };

    return { html: tableHTML, setup };
}
// Helper to Save/Update Daily Archive
async function saveToDailyArchive(type, data) {
    if (!data || data.length === 0) return;
    if (!currentStore) return;

    const today = new Date().toISOString().split('T')[0];
    const { ipcRenderer } = require('electron');

    try {
        // Check existing
        const rows = await ipcRenderer.invoke('param-get-daily-entries', { storeId: currentStore.id, date: today, type: type });
        if (rows && rows.length > 0) {
            const entryId = rows[0].id;

            // SPECIAL HANDLING FOR CARGO: Merge instead of Overwrite (because we stop loading history)
            if (type === 'cargo') {
                try {
                    const archivedData = rows[0].data; // Already parsed by main

                    // Helper for column check
                    const checkCol = (h) => h && (
                        h.toString().toLowerCase().includes('sipariş no') ||
                        h.toString().toLowerCase().includes('sipariş numara') ||
                        h.toString().toLowerCase().includes('siparis no') ||
                        h.toString().toLowerCase().includes('siparis numara') ||
                        h.toString().toLowerCase().includes('order no') ||
                        h.toString().toLowerCase().includes('order num')
                    );

                    const headers = archivedData[0];
                    const orderIdx = headers.findIndex(checkCol);

                    const existingOrderNos = new Set();
                    if (orderIdx !== -1) {
                        for (let i = 1; i < archivedData.length; i++) {
                            const val = archivedData[i][orderIdx];
                            if (val) existingOrderNos.add(String(val).trim());
                        }
                    }

                    // Find Order No Index in New Data
                    const newHeaders = data[0];
                    const newOrderIdx = newHeaders.findIndex(checkCol);

                    // Append new rows
                    let addedCount = 0;
                    for (let i = 1; i < data.length; i++) {
                        const newRow = data[i];
                        let isDuplicate = false;

                        if (newOrderIdx !== -1 && orderIdx !== -1) {
                            const val = newRow[newOrderIdx];
                            if (val && existingOrderNos.has(String(val).trim())) {
                                isDuplicate = true;
                            }
                        }

                        if (!isDuplicate) {
                            archivedData.push(newRow);
                            addedCount++;
                        }
                    }

                    if (addedCount > 0) {
                        await ipcRenderer.invoke('param-update-daily-entry', { id: entryId, data: archivedData });
                        log.info(`Merged ${addedCount} new rows into daily entry ${type} for ${today}`);
                    } else {
                        log.info(`No new unique rows to merge for ${type}.`);
                    }

                } catch (mergeErr) {
                    log.error('Merge failed, falling back to overwrite to save data', mergeErr);
                    await ipcRenderer.invoke('param-update-daily-entry', { id: entryId, data: data });
                }
            } else {
                await ipcRenderer.invoke('param-update-daily-entry', { id: entryId, data: data });
                log.info(`Updated daily entry ${type} for ${today} (Overwrite)`);
            }
        } else {
            // Insert new
            await ipcRenderer.invoke('param-add-daily-entry', { storeId: currentStore.id, type: type, date: today, data: data });
            log.info(`Created daily entry ${type} for ${today}`);
        }
    } catch (err) {
        log.error('Failed to save daily archive:', err);
    }
}

// Helper to Load Today's Daily Archive into Tables
async function loadTodayArchiveToTables() {
    if (!currentStore) return;

    const today = new Date().toISOString().split('T')[0];
    const { ipcRenderer } = require('electron');

    try {
        // Load Cargo (Target) data
        // DISABLED (Step 516): Target table should strictly accept new input and save, not display daily history on load.
        /*
        const cargoRows = await ipcRenderer.invoke('param-get-daily-entries', {
            storeId: currentStore.id,
            date: today,
            type: 'cargo'
        });
 
        if (cargoRows && cargoRows.length > 0 && cargoRows[0].data) {
            const cargoData = cargoRows[0].data;
            if (Array.isArray(cargoData) && cargoData.length > 0) {
                importedDataState['target'] = cargoData;
                originalDataState['target'] = JSON.parse(JSON.stringify(cargoData));
 
                // Setup column state
                const headers = cargoData[0];
 
                // MIGRATION: Convert old 'Adet' column to 'Paket Sayısı' if needed
                const adetIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'adet');
                const paketSayisiIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'paket sayısı');
 
                if (adetIndex !== -1 && paketSayisiIndex === -1) {
                    // Old format detected, migrate it
                    headers[adetIndex] = 'Paket Sayısı';
                    log.info('Migrated old cargo archive format: Adet -> Paket Sayısı');
                }
 
                let allIndices = headers.map((_, index) => index);
                const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
                if (productColIndex !== -1) {
                    allIndices = allIndices.filter(i => i !== productColIndex);
                    allIndices.unshift(productColIndex);
                }
                columnState['target'].indices = allIndices;
                applyDefaultVisibility('target', headers);
 
                // Render if active tab
                if (activeRightTab === 'target') {
                    processAndRenderData('target');
                    updateColumnDropdown('target', headers);
                }
 
                log.info(`Loaded today's cargo archive: ${cargoData.length - 1} rows`);
            }
        }
        */

        // Load Cancel data
        const cancelRows = await ipcRenderer.invoke('param-get-daily-entries', {
            storeId: currentStore.id,
            date: today,
            type: 'cancel'
        });

        if (cancelRows && cancelRows.length > 0 && cancelRows[0].data) {
            const cancelData = cancelRows[0].data;
            if (Array.isArray(cancelData) && cancelData.length > 0) {
                importedDataState['cancels'] = cancelData;
                originalDataState['cancels'] = JSON.parse(JSON.stringify(cancelData));

                // Setup column state
                const headers = cancelData[0];

                // MIGRATION: Convert old 'Adet' column to 'Paket Sayısı' if needed
                const adetIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'adet');
                const paketSayisiIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'paket sayısı');

                if (adetIndex !== -1 && paketSayisiIndex === -1) {
                    // Old format detected, migrate it
                    headers[adetIndex] = 'Paket Sayısı';
                    log.info('Migrated old cancel archive format: Adet -> Paket Sayısı');
                }

                let allIndices = headers.map((_, index) => index);
                const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
                if (productColIndex !== -1) {
                    allIndices = allIndices.filter(i => i !== productColIndex);
                    allIndices.unshift(productColIndex);
                }
                columnState['cancels'].indices = allIndices;
                applyDefaultVisibility('cancels', headers);

                // Render if active tab
                if (activeRightTab === 'cancels') {
                    processAndRenderData('cancels');
                    updateColumnDropdown('cancels', headers);
                }

                log.info(`Loaded today's cancel archive: ${cancelData.length - 1} rows`);
            }
        }

    } catch (err) {
        log.error('Failed to load today\'s archive:', err);
    }
}

// Load Archive from Specific Date (for Target/Cancels toolbar date picker)
async function loadArchiveFromDate(date) {
    if (!currentStore || !date) return;

    const { ipcRenderer } = require('electron');

    try {
        // Load Cargo (Target) data for selected date
        const cargoRows = await ipcRenderer.invoke('param-get-daily-entries', {
            storeId: currentStore.id,
            date: date,
            type: 'cargo'
        });

        if (cargoRows && cargoRows.length > 0 && cargoRows[0].data) {
            const cargoData = cargoRows[0].data;
            if (Array.isArray(cargoData) && cargoData.length > 0) {
                importedDataState['target'] = cargoData;
                originalDataState['target'] = JSON.parse(JSON.stringify(cargoData));

                // Setup column state
                const headers = cargoData[0];
                let allIndices = headers.map((_, index) => index);
                const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
                if (productColIndex !== -1) {
                    allIndices = allIndices.filter(i => i !== productColIndex);
                    allIndices.unshift(productColIndex);
                }
                columnState['target'].indices = allIndices;
                applyDefaultVisibility('target', headers);

                // Render if active tab
                if (activeRightTab === 'target') {
                    processAndRenderData('target');
                    updateColumnDropdown('target', headers);
                }

                log.info(`Loaded cargo archive from ${date}: ${cargoData.length - 1} rows`);
            }
        } else {
            // No data for this date
            importedDataState['target'] = null;
            if (activeRightTab === 'target') {
                processAndRenderData('target');
            }
            log.info(`No cargo archive found for ${date}`);
        }

        // Load Cancel data for selected date
        const cancelRows = await ipcRenderer.invoke('param-get-daily-entries', {
            storeId: currentStore.id,
            date: date,
            type: 'cancel'
        });

        if (cancelRows && cancelRows.length > 0 && cancelRows[0].data) {
            const cancelData = cancelRows[0].data;
            if (Array.isArray(cancelData) && cancelData.length > 0) {
                importedDataState['cancels'] = cancelData;
                originalDataState['cancels'] = JSON.parse(JSON.stringify(cancelData));

                // Setup column state
                const headers = cancelData[0];
                let allIndices = headers.map((_, index) => index);
                const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
                if (productColIndex !== -1) {
                    allIndices = allIndices.filter(i => i !== productColIndex);
                    allIndices.unshift(productColIndex);
                }
                columnState['cancels'].indices = allIndices;
                applyDefaultVisibility('cancels', headers);

                // Render if active tab
                if (activeRightTab === 'cancels') {
                    processAndRenderData('cancels');
                    updateColumnDropdown('cancels', headers);
                }

                log.info(`Loaded cancel archive from ${date}: ${cancelData.length - 1} rows`);
            }
        } else {
            // No data for this date
            importedDataState['cancels'] = null;
            if (activeRightTab === 'cancels') {
                processAndRenderData('cancels');
            }
            log.info(`No cancel archive found for ${date}`);
        }

    } catch (err) {
        log.error(`Failed to load archive from ${date}:`, err);
    }
}

// Auto Import Button (Trendyol)
const btnAutoImport = document.getElementById('trendyol-auto-import-btn');
if (btnAutoImport) {
    btnAutoImport.addEventListener('click', async () => {
        if (!currentStore) {
            showAlert('Lütfen önce bir mağaza seçiniz/oluşturunuz.', 'warning');
            return;
        }

        // Show loading by clearing and setting message
        const listContainer = document.getElementById('source-file-list-container');
        // We don't have a direct table body for source list to show "Text" easily unless we manipulate `importedDataState`.
        // We will just invoke and let the log show or use a temporary alert/toast?
        // The user asks for "Sonuçlar tabloya girilecek". 
        // This means we should treat the fetched data as if it was imported from Excel and render it to the Source Table.

        const { ipcRenderer } = require('electron');
        log.info('Fetching Trendyol orders for store:', currentStore.name);

        try {
            // UI Feedback
            btnAutoImport.disabled = true;
            btnAutoImport.innerHTML = '<span class="animate-spin h-3 w-3 mr-1 bg-white"></span> Yükleniyor...';

            const res = await ipcRenderer.invoke('fetch-trendyol-orders', currentStore.id);

            btnAutoImport.disabled = false;
            btnAutoImport.innerHTML = `
                 <svg class="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                 </svg>
                 Auto
             `;

            if (res.success) {
                log.info(`Fetched ${res.data.length} rows from API`);

                if (res.data.length === 0) {
                    showAlert('Çekilecek sipariş bulunamadı.', 'info');
                    return;
                }

                // Convert Object Array to 2D Array (Header + Rows) for compatibility with existing render logic
                // Headers
                const headers = Object.keys(res.data[0]);
                const rows = res.data.map(obj => Object.values(obj));
                let tableData = [headers, ...rows];

                // Filter Shipped Orders
                tableData = await filterShippedOrders(tableData);

                // Update State
                importedDataState['source'] = tableData;
                originalDataState['source'] = JSON.parse(JSON.stringify(tableData));

                // Reset filtered columns to show all
                columnState['source'].indices = headers.map((_, i) => i);

                // Reset active operation state before applying new one
                activeOperationState['source'] = null;

                // Auto-Run Package Count Calculation (Aggregates items)
                performPackageCount('source');

                // Render
                processAndRenderData('source');

                // Force Sync Target and Detect Cancels (Same as Excel import)
                await syncSourceToSide('target');
                await detectAndPopulateCancels();

                // Update File Info Label
                const fileInfoBtn = document.getElementById('source-history-btn');
                const fileInfoLabel = document.getElementById('source-history-label');
                if (fileInfoLabel) fileInfoLabel.textContent = `API: ${new Date().toLocaleTimeString()} (${res.data.length} Satır)`;

                currentSourceFileId = null; // Not linked to a file batch

            } else {
                showAlert('Hata: ' + res.message, 'error');
                // importedDataState['source'] = null;
                // processAndRenderData('source'); 
            }
        } catch (err) {
            log.error('API Call Error:', err);
            showAlert('Beklenmedik bir hata oluştu.', 'error');
            btnAutoImport.disabled = false;
            btnAutoImport.innerHTML = `... Auto`; // Reset simplified
        }
    });
}

// Event Listeners for Operations Buttons
if (sourceOptPackageCount) {
    sourceOptPackageCount.addEventListener('click', () => {
        performPackageCount('source');
        sourceOperationsDropdown.classList.add('hidden');
    });
}
if (targetOptPackageCount) {
    targetOptPackageCount.addEventListener('click', () => {
        performPackageCount('target');
        targetOperationsDropdown.classList.add('hidden');
    });
}

// Helper to Generate Target/Cancels from Source
async function syncSourceToSide(destinationSide) {
    const sourceData = importedDataState['source'];
    if (!sourceData || sourceData.length < 2) return;

    // First, check if today's archive exists for this side
    // SKIP for target (Step 549 request: Target should strictly be filtered source, no history)
    if (currentStore && destinationSide !== 'target') {
        const today = new Date().toISOString().split('T')[0];
        const archiveType = destinationSide === 'target' ? 'cargo' : 'cancel';
        const { ipcRenderer } = require('electron');

        try {
            const rows = await ipcRenderer.invoke('param-get-daily-entries', {
                storeId: currentStore.id,
                date: today,
                type: archiveType
            });

            // If today's archive exists, load it instead of syncing from source
            if (rows && rows.length > 0 && rows[0].data) {
                const archiveData = rows[0].data;
                if (Array.isArray(archiveData) && archiveData.length > 0) {
                    importedDataState[destinationSide] = archiveData;
                    originalDataState[destinationSide] = JSON.parse(JSON.stringify(archiveData));
                    activeOperationState[destinationSide] = null;

                    // Setup column state
                    const headers = archiveData[0];

                    // MIGRATION: Convert old 'Adet' column to 'Paket Sayısı' if needed
                    const adetIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'adet');
                    const paketSayisiIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'paket sayısı');

                    if (adetIndex !== -1 && paketSayisiIndex === -1) {
                        // Old format detected, migrate it
                        headers[adetIndex] = 'Paket Sayısı';
                        log.info(`Migrated old ${archiveType} archive format in syncSourceToSide: Adet -> Paket Sayısı`);
                    }

                    let allIndices = headers.map((_, index) => index);
                    const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
                    if (productColIndex !== -1) {
                        allIndices = allIndices.filter(i => i !== productColIndex);
                        allIndices.unshift(productColIndex);
                    }
                    columnState[destinationSide].indices = allIndices;
                    applyDefaultVisibility(destinationSide, headers);

                    // Render if active tab
                    if (activeRightTab === destinationSide) {
                        processAndRenderData(destinationSide);
                        updateColumnDropdown(destinationSide, headers);
                    }

                    log.info(`Loaded existing ${archiveType} archive for ${destinationSide} instead of syncing from source`);
                    return; // Exit early - don't sync from source
                }
            }
        } catch (err) {
            log.error('Error checking archive before sync:', err);
            // Continue with normal sync if archive check fails
        }
    }

    // No archive exists for today, proceed with normal sync from source
    const sourceHeaders = sourceData[0];
    const nameIndex = sourceHeaders.findIndex(h => h && h.toString().toLowerCase().trim().includes('ürün') || h.toString().toLowerCase().trim().includes('product') || h.toString().toLowerCase().trim() === 'name');
    const barcodeIndex = sourceHeaders.findIndex(h => h && (h.toString().toLowerCase().trim() === 'barkod' || h.toString().toLowerCase().trim() === 'barcode'));

    if (nameIndex === -1 && barcodeIndex === -1) return;

    // Structure: Name, Barcode, Paket Sayısı, Adet Sayısı
    const destHeaders = ['Ürün Adı', 'Barkod', 'Paket Sayısı', 'Adet Sayısı'];
    const destRows = [];

    // Verify if 'Paket Sayısı' exists in source (it should if performPackageCount ran)
    const packageCountIndex = sourceHeaders.findIndex(h => h && h.toString().toLowerCase().trim() === 'paket sayısı');

    for (let i = 1; i < sourceData.length; i++) {
        const srcRow = sourceData[i];
        const name = nameIndex !== -1 ? srcRow[nameIndex] : '';
        const barcode = barcodeIndex !== -1 ? srcRow[barcodeIndex] : '';
        let packageCount = packageCountIndex !== -1 ? srcRow[packageCountIndex] : '';
        if (destinationSide === 'target') packageCount = '';

        // Create row: [Name, Barcode, Paket Sayısı, Adet Sayısı]
        destRows.push([name, barcode, packageCount, '']);
    }

    const destData = [destHeaders, ...destRows];

    // Update State
    importedDataState[destinationSide] = destData;
    originalDataState[destinationSide] = JSON.parse(JSON.stringify(destData));
    activeOperationState[destinationSide] = null;

    // Set Visibility Defaults
    let allIndices = destHeaders.map((_, index) => index);

    columnState[destinationSide].indices = allIndices;
    applyDefaultVisibility(destinationSide, destHeaders);

    // Only render if it's the active tab
    if (activeRightTab === destinationSide) {
        processAndRenderData(destinationSide);
        updateColumnDropdown(destinationSide, destHeaders);
    }

    // Auto-Save Daily Log (only when creating new data from source)
    const archiveType = destinationSide === 'target' ? 'cargo' : 'cancel';
    if (destinationSide === 'cancels') {
        // saveToDailyArchive(archiveType, destData); // DISABLED
    }
    log.info(`Created new ${archiveType} data from source for ${destinationSide}`);
}

// Autocomplete Logic
if (manualProductNameInput) {
    manualProductNameInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        manualProductSuggestions.innerHTML = '';
        selectedManualProduct = null;
        manualBarcodeDisplay.textContent = '-';

        if (term.length < 2) {
            manualProductSuggestions.classList.add('hidden');
            return;
        }

        const sourceData = importedDataState['source'];
        if (!sourceData || sourceData.length < 2) {
            // No source data to search from
            return;
        }

        const headers = sourceData[0];
        // Find indices
        const nameIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim().includes('ürün') || h.toString().toLowerCase().trim().includes('product') || h.toString().toLowerCase().trim() === 'name');
        const barcodeIndex = headers.findIndex(h => h && (h.toString().toLowerCase().trim() === 'barkod' || h.toString().toLowerCase().trim() === 'barcode'));

        if (nameIndex === -1 || barcodeIndex === -1) return;

        // Filter valid items
        const matches = [];
        // prevent duplicates in suggestions? 
        const seenBarcodes = new Set();

        for (let i = 1; i < sourceData.length; i++) {
            const row = sourceData[i];
            const name = row[nameIndex] ? row[nameIndex].toString() : '';
            const barcode = row[barcodeIndex] ? row[barcodeIndex].toString() : '';

            if (name.toLowerCase().includes(term) && barcode && !seenBarcodes.has(barcode)) {
                matches.push({ name, barcode, row });
                seenBarcodes.add(barcode);
                if (matches.length > 50) break; // Limit suggestions
            }
        }

        if (matches.length > 0) {
            manualProductSuggestions.classList.remove('hidden');
            matches.forEach(match => {
                const div = document.createElement('div');
                div.className = 'cursor-pointer hover:bg-blue-50 px-4 py-2 text-sm text-gray-700 border-b last:border-0 border-gray-100';
                div.innerHTML = `
                    <div class="font-medium">${match.name}</div>
                    <div class="text-xs text-gray-400">${match.barcode}</div>
                `;
                div.addEventListener('click', () => {
                    manualProductNameInput.value = match.name;
                    manualBarcodeDisplay.textContent = match.barcode;
                    selectedManualProduct = match;
                    manualProductSuggestions.classList.add('hidden');
                });
                manualProductSuggestions.appendChild(div);
            });
        } else {
            manualProductSuggestions.classList.add('hidden');
        }
    });

    // Close suggestions on click outside
    document.addEventListener('click', (e) => {
        if (!manualProductNameInput.contains(e.target) && !manualProductSuggestions.contains(e.target)) {
            manualProductSuggestions.classList.add('hidden');
        }
    });
}

if (manualAddConfirmBtn) {
    manualAddConfirmBtn.addEventListener('click', () => {
        if (!selectedManualProduct) {
            showAlert('Lütfen listeden bir ürün seçiniz.', 'warning');
            return;
        }

        const count = parseInt(manualPackageCountInput.value) || 0;
        if (count <= 0) {
            showAlert('Lütfen geçerli bir paket sayısı giriniz.', 'warning');
            return;
        }

        // Add to Target Data
        const side = activeRightTab;
        let targetData = importedDataState[side];
        let headers = [];

        if (!targetData) {
            // Initialize Target Data if empty
            // We need: Product Name, Barcode, Adet (maybe 0 or actual count?), Paket Sayısı
            // User said: "ürün ismi, paket sayısı, barkod" are mandatory.
            headers = ['Ürün Adı', 'Barkod', 'Paket Sayısı', 'Adet Sayısı'];
            // Append META header for manual entry tracking if it's Cancels tab
            if (side === 'cancels') headers.push('__meta_manual__');
            targetData = [headers];
        } else {
            headers = targetData[0];
            // If headers don't have meta manual and we need it
            if (side === 'cancels' && !headers.includes('__meta_manual__')) {
                headers.push('__meta_manual__');
                // We should also pad existing rows? Not strictly necessary if we check existence.
                // But better for consistency.
                for (let i = 1; i < targetData.length; i++) {
                    targetData[i].push('');
                }
            }
        }

        // Construct new row
        const newRow = new Array(headers.length).fill('');

        // Map fields
        const nameIndex = headers.findIndex(h => h.toString().toLowerCase().trim().includes('ürün') || h.toString().toLowerCase().trim().includes('product') || h.toString().toLowerCase().trim() === 'name');
        const barcodeIndex = headers.findIndex(h => h.toString().toLowerCase().trim() === 'barkod' || h.toString().toLowerCase().trim() === 'barcode');
        const packageCountIndex = headers.findIndex(h => h.toString().toLowerCase().trim() === 'paket sayısı');
        // 'Adet' is tricky. If we are entering manual, maybe we assume 1 qty per package * package count? 
        // User said: "barkod toplamı x adet = paket sayısı".
        // In manual entry, we enter 'Paket Sayısı' directly. 
        // Let's assume 'Adet' is just for reference or 0.
        const qtyIndex = headers.findIndex(h => h.toString().toLowerCase().trim() === 'adet' || h.toString().toLowerCase().trim() === 'quantity');

        // Fill data
        if (nameIndex !== -1) newRow[nameIndex] = selectedManualProduct.name;
        if (barcodeIndex !== -1) newRow[barcodeIndex] = selectedManualProduct.barcode;
        if (packageCountIndex !== -1) newRow[packageCountIndex] = count;
        // If 'Paket Sayısı' column doesn't exist yet in target (e.g. fresh import without calculation), we might need to add it?
        // But if we are in Manual Mode, we probably want to enforce this column.

        if (packageCountIndex === -1) {
            // Append new header
            headers.push('Paket Sayısı');
            newRow.push(count);
            // Update targetData[0] (headers) referentially? No, headers variable is Ref.
            // targetData[0] is array. 
            // If we modified 'headers' array (push), and headers IS targetData[0], it's updated.
            // Verify:
            /*
             if targetData was null, we created [headers]. headers is pushed. OK.
             if targetData existed, headers = targetData[0]. headers pushed. OK.
            */
        }

        if (side === 'cancels') {
            // Logic to add '1' to __meta_manual__ column
            const metaIndex = headers.indexOf('__meta_manual__');
            if (metaIndex !== -1) {
                // Pad newRow if needed (it was filled based on headers length BEFORE we might have pushed meta header? 
                // No, we fetched headers from targetData[0] which we updated.
                // But newRow was created with Array(headers.length). So it has a slot.
                newRow[metaIndex] = '1';
            }
        }

        targetData.push(newRow);

        // Update States
        importedDataState[side] = targetData;
        // Also update originalDataState to keep in sync? 
        // Logic says Manual Entry adds to the "Live" data. Should it be reversible? 
        // If we revert, we lose manual entries? 
        // If 'originalDataState' is null, init it.
        if (!originalDataState[side]) {
            originalDataState[side] = JSON.parse(JSON.stringify(targetData));
        } else {
            // Add to original too?
            // If active operation is active, we should theoretically add to original, then re-apply operation.
            // But since we are entering 'Paket Sayısı' directly manually... this bypasses calculation.
            // User entered the *result*.

            // Allow simplified flow: Manual Entry logic overrides raw data logic for that row.
            // Just push to both for now to prevent loss.
        }

        // Auto-Save Daily Log
        const archiveType = side === 'target' ? 'cargo' : 'cancel';
        if (side !== 'cancels') {
            saveToDailyArchive(archiveType, importedDataState[side]);
        }



        // Initialize visibility if needed
        if (columnState['target'].indices.length === 0) {
            let allIndices = headers.map((_, index) => index);
            // Maintain "Product Name" logic 
            const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
            if (productColIndex !== -1) {
                allIndices = allIndices.filter(i => i !== productColIndex);
                allIndices.unshift(productColIndex);
            }
            columnState[side].indices = allIndices;
        }

        // Apply default visibility
        applyDefaultVisibility(side, headers);

        processAndRenderData(side);
        // Map side to UI for dropdown update
        const uiSide = (side === 'cancels') ? 'target' : side;
        updateColumnDropdown(uiSide, headers);

        // Close Modal
        manualEntryModal.classList.add('hidden');
    });
}

function performPackageCount(side, silent = false) {
    // Check if we need to revert
    if (activeOperationState[side] === 'package_count') {
        // REVERT
        if (!originalDataState[side]) return;

        importedDataState[side] = JSON.parse(JSON.stringify(originalDataState[side]));
        activeOperationState[side] = null;

        // Reset Visuals (Checkmark removal could be done here, but simple re-render is main goal)
        // Reset column visibility logic for original headers
        const headers = importedDataState[side][0];
        let allIndices = headers.map((_, index) => index);
        const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
        if (productColIndex !== -1) {
            allIndices = allIndices.filter(i => i !== productColIndex);
            allIndices.unshift(productColIndex);
        }
        columnState[side].indices = allIndices;
        columnState[side].hiddenIndices.clear();

        // Update UI Checkbox (Optimistic)
        const btnId = side === 'source' ? 'source-opt-package-count' : 'target-opt-package-count';
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.remove('bg-purple-50', 'text-purple-700');

        processAndRenderData(side);
        updateColumnDropdown(side, headers);
        return;
    }

    // APPLY
    // Always calculate from ORIGINAL data to avoid compounding errors
    const data = originalDataState[side];
    if (!data || data.length < 2) {
        // Only show alert if not in silent mode (manual operations)
        if (!silent) {
            showAlert('İşlem yapmak için veri bulunamadı.', 'warning');
        }
        return;
    }

    const headers = data[0];
    const barcodeIndex = headers.findIndex(h => {
        if (!h) return false;
        const s = h.toString().toLowerCase().trim();
        return s === 'barkod' || s === 'barcode' || s === 'barkodu';
    });

    if (barcodeIndex === -1) {
        showAlert('"Barkod" isminde bir kolon bulunamadı!', 'error');
        return;
    }

    // Find Quantity Column
    const quantityIndex = headers.findIndex(h => {
        if (!h) return false;
        const s = h.toString().toLowerCase().trim();
        return s === 'adet' || s === 'miktar' || s === 'quantity' || s === 'qty';
    });

    if (quantityIndex === -1) {
        showAlert('"Adet" (veya Miktar/Quantity) isminde bir kolon bulunamadı!', 'error');
        return;
    }

    const counts = {};
    const packageCounts = {};
    const uniqueRowsMap = {};

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const barcode = row[barcodeIndex];

        if (!barcode) continue;

        // Parse quantity
        let qty = 1;
        if (quantityIndex !== -1) {
            const val = row[quantityIndex];
            // Try to parse number
            const parsed = parseFloat(val);
            if (!isNaN(parsed)) {
                qty = parsed;
            }
        }

        const key = barcode.toString().trim();
        if (!counts[key]) {
            counts[key] = 0;
            packageCounts[key] = 0;
            uniqueRowsMap[key] = row;
        }
        counts[key] += qty;
        packageCounts[key] += 1;
    }

    // New Headers: Remove Quantity Column, Add Package Count and Adet Sayısı
    const newHeaders = headers.filter((_, i) => i !== quantityIndex);
    newHeaders.push('Paket Sayısı');
    newHeaders.push('Adet Sayısı');

    const newRows = [];
    Object.keys(uniqueRowsMap).forEach(key => {
        const originalRow = uniqueRowsMap[key];
        const count = counts[key];

        // Remove quantity value from row
        // NOTE: originalRow indexes correspond to original headers
        const newRow = originalRow.filter((_, i) => i !== quantityIndex);

        // Pad to match header length minus the 2 columns we're about to add
        while (newRow.length < newHeaders.length - 2) {
            newRow.push('');
        }

        newRow.push(packageCounts[key]);
        newRow.push(count);
        newRows.push(newRow);
    });

    importedDataState[side] = [newHeaders, ...newRows];
    activeOperationState[side] = 'package_count';

    // Reset column state for this side because indices shifted
    let allIndices = newHeaders.map((_, index) => index);

    // Maintain "Product Name" logic if it exists
    const productColIndex = newHeaders.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
    if (productColIndex !== -1) {
        allIndices = allIndices.filter(i => i !== productColIndex);
        allIndices.unshift(productColIndex);
    }

    columnState[side].indices = allIndices;

    // Apply Default Visibility Logic for Calculated Data too (optional but good consistency)
    // Actually, user said "default olarak sadece...". This usually applies to initial load. 
    // If we just calculated "Paket Sayısı", user probably wants to see it. 
    // And "Adet" is removed.
    // So we just clear hiddenIndices for the NEW column, but keep others as is?
    // Or Reset to default visibility? 
    // Let's keep existing visibility but ensure 'Paket Sayısı' is visible.
    // Existing logic clears hiddenIndices. Let's apply default visibility rule here too.
    applyDefaultVisibility(side, newHeaders);

    // Update UI Checkbox (Optimistic)
    const btnId = side === 'source' ? 'source-opt-package-count' : 'target-opt-package-count';
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('bg-purple-50', 'text-purple-700');

    processAndRenderData(side);
    updateColumnDropdown(side, newHeaders);
}

// Logic to load data from a batch
function loadBatchData(batchId, side) {
    if (!batchId) return;

    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('load-batch-data', batchId).then(async data => {
        if (data && data.length > 0) {
            // If loading source data, save the previous raw data for cancel detection
            if (side === 'source' && originalDataState['source']) {
                previousRawSourceData = JSON.parse(JSON.stringify(originalDataState['source']));
                log.info('Saved previous source data for cancel detection (from history)');
            }

            importedDataState[side] = data;
            // Backup for operations
            originalDataState[side] = JSON.parse(JSON.stringify(data));
            // Reset active operation
            activeOperationState[side] = null;

            // Process Headers
            const headers = data[0];
            let allIndices = headers.map((_, index) => index);

            const productColIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'ürün adı');
            if (productColIndex !== -1) {
                allIndices = allIndices.filter(i => i !== productColIndex);
                allIndices.unshift(productColIndex);
            }

            // Reset visibility
            columnState[side].indices = allIndices;
            applyDefaultVisibility(side, headers);

            // Render Raw First
            processAndRenderData(side);
            updateColumnDropdown(side, headers);

            // Auto-Run Package Count Calculation
            performPackageCount(side);

            // If Source loaded, sync Target and Cancels (using the calculated data)
            if (side === 'source') {
                const targetData = importedDataState['target'];

                // ONLY initialize Target from Source if Target is completely empty
                // This preserves manual edits and existing target data when browsing source history
                if (!targetData || targetData.length <= 1) {
                    await syncSourceToSide('target');
                } else {
                    // Target already has data, preserve it
                    log.info('Target table has existing data, preserving it when loading source history');
                }

                // Always update cancels based on current source vs target
                await detectAndPopulateCancels();
            }

            // Auto-save to daily archive for Target only (Cancels disabled)
            if (side === 'target') {
                const archiveType = 'cargo';
                saveToDailyArchive(archiveType, importedDataState[side]);
            }
        }
    });
}

// Event Listener for Native Select (Target)
const existingSelectors = [sourceHistorySelect, targetHistorySelect];
existingSelectors.forEach(select => {
    if (select) {
        select.addEventListener('change', (e) => {
            const side = select.id.includes('source') ? 'source' : activeRightTab;
            loadBatchData(e.target.value, side);
        });
    }
});

// Event Listeners for Import Buttons
if (sourceImportBtn) {
    sourceImportBtn.addEventListener('click', () => {
        fileInputSource.click();
    });
}

if (targetImportBtn) {
    targetImportBtn.addEventListener('click', () => {
        fileInputTarget.click();
    });
}

if (cancelsImportBtn) {
    cancelsImportBtn.addEventListener('click', () => {
        if (fileInputCancels) fileInputCancels.click();
    });
}

if (cancelsLoadArchiveBtn) {
    cancelsLoadArchiveBtn.addEventListener('click', () => {
        const date = cancelsDateFilter.value;
        if (date) {
            // Load both for now as per loadArchiveFromDate logic, or create separate if needed.
            // But usually this button is in Cancels toolbar, implying we want to see cancels for that date.
            loadArchiveFromDate(date);
        } else {
            showAlert('Lütfen bir tarih seçiniz.', 'warning');
        }
    });
}

// Event Listeners for File Inputs
if (fileInputSource) fileInputSource.addEventListener('change', (e) => handleFileSelect(e, 'source'));
if (fileInputTarget) fileInputTarget.addEventListener('change', (e) => handleFileSelect(e, 'target'));
if (fileInputCancels) fileInputCancels.addEventListener('change', (e) => handleFileSelect(e, 'cancels'));


// Event Listeners for Dropdown Toggles
setupDropdown(sourceColumnsBtn, sourceColumnDropdown);
setupDropdown(sourceHistoryBtn, sourceHistoryDropdown);

// For Target/Cancels, buttons are shared. 
// We need to ensure that when we click them, they operate on activeRightTab.
// But setupDropdown is generic UI toggling. The CONTENT update happens elsewhere.
// So just keeping them attached to the DOM elements is fine.
// The content logic (updateColumnDropdown) will need to know which data to show.
// We call updateColumnDropdown(activeRightTab) on switch.
setupDropdown(targetColumnsBtn, targetColumnDropdown);
setupDropdown(cancelsColumnsBtn, cancelsColumnDropdown);
setupDropdown(targetHistoryBtn, targetHistoryDropdown);
setupDropdown(sourceOperationsBtn, sourceOperationsDropdown);
setupDropdown(targetOperationsBtn, targetOperationsDropdown);

function setupDropdown(btn, dropdown) {
    if (!btn || !dropdown) return;

    // Toggle menu
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close others
        [
            sourceColumnDropdown, targetColumnDropdown, cancelsColumnDropdown,
            sourceHistoryDropdown, targetHistoryDropdown,
            sourceOperationsDropdown, targetOperationsDropdown
        ].forEach(d => {
            if (d && d !== dropdown) d.classList.add('hidden');
        });
        dropdown.classList.toggle('hidden');
    });

    // ... search logic remains same, but history dropdown has no search input currently.
    // So checking for input existence is good.
    const input = dropdown.querySelector('input');
    if (input) {
        input.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const list = dropdown.querySelector('.overflow-y-auto');
            const items = list.querySelectorAll('label'); // This was specific to columns (label tags)
            // It won't affect history dropdown as it has no labels/input usually, but good to keep in mind
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(term) ? 'flex' : 'none';
            });
        });

        input.addEventListener('click', (e) => e.stopPropagation());
    }
}

// Global click to close dropdowns
document.addEventListener('click', (e) => {
    [
        { btn: sourceColumnsBtn, menu: sourceColumnDropdown },
        { btn: targetColumnsBtn, menu: targetColumnDropdown },
        { btn: cancelsColumnsBtn, menu: cancelsColumnDropdown },
        { btn: sourceHistoryBtn, menu: sourceHistoryDropdown },
        { btn: targetHistoryBtn, menu: targetHistoryDropdown },
        { btn: sourceOperationsBtn, menu: sourceOperationsDropdown },
        { btn: targetOperationsBtn, menu: targetOperationsDropdown }
    ].forEach(({ btn, menu }) => {
        if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });
});

// Handle File Selection


// Helper for Default Visibility
function applyDefaultVisibility(side, headers) {
    const state = columnState[side];
    state.hiddenIndices.clear();

    // For CANCELS table: Show only specific important columns by default
    if (side === 'cancels') {
        const visibleKeywords = [
            'iptal tespit tarihi',
            'ürün adı', 'urun adi', 'product name', 'name',
            'sipariş no', 'siparis no', 'order no', 'order number',
            'kargo kodu', 'kargo kod', 'tracking', 'cargo code',
            'sipariş tarihi', 'siparis tarihi', 'order date',
            'alıcı', 'alici', 'customer', 'müşteri', 'musteri',
            'il', 'city', 'şehir', 'sehir',
            'adet', 'quantity', 'qty', 'miktar'
        ];

        headers.forEach((h, index) => {
            if (!h) {
                state.hiddenIndices.add(index);
                return;
            }
            const s = h.toString().toLowerCase().trim();
            // Check if matches any visible keyword
            const isVisible = visibleKeywords.some(keyword => s.includes(keyword) || keyword.includes(s));

            if (!isVisible) {
                state.hiddenIndices.add(index);
            }
        });
        return;
    }

    // For SOURCE and TARGET tables: Apply default visibility rules
    // User wants ONLY: 'Ürün Adı', 'Barkod', 'Paket Sayısı', 'Adet Sayısı' visible.
    // Others disabled (hidden).

    const visibleKeywords = ['ürün adı', 'product name', 'name', 'barkod', 'barcode', 'barkodu', 'paket sayısı', 'adet sayısı'];
    // __meta_manual__ is explicitly NOT in this list, so it will be hidden.

    headers.forEach((h, index) => {
        if (!h) {
            state.hiddenIndices.add(index);
            return;
        }
        const s = h.toString().toLowerCase().trim();
        // Check if matches any keyword
        const isVisible = visibleKeywords.some(keyword => s === keyword);

        if (!isVisible) {
            state.hiddenIndices.add(index);
        }
    });
}

// Process Data and Render Table (HTML Table Version)
// Process Data and Render Table (HTML Table Version)
// Process Data and Render Table (HTML Table Version)
function processAndRenderData(side) {
    const data = importedDataState[side];

    // Handle Empty Data
    if (!data) {
        const listContainerId = side === 'source' ? 'source-list-container' : (side === 'cancels' ? 'cancels-list-container' : 'target-list-container');
        const listContainer = document.getElementById(listContainerId);
        if (listContainer) listContainer.innerHTML = '';

        const emptyStateId = side === 'source' ? 'source-empty-state' : (side === 'cancels' ? 'cancels-empty-state' : 'target-empty-state');
        const emptyState = document.getElementById(emptyStateId);
        if (emptyState) emptyState.classList.remove('hidden');

        const headerRowId = side === 'source' ? 'source-header-row' : (side === 'cancels' ? 'cancels-header-row' : 'target-header-row');
        const headerRow = document.getElementById(headerRowId);
        if (headerRow) headerRow.innerHTML = '';
        return;
    }

    const rawData = data;
    const headers = rawData[0]; // Original headers from data
    const rows = rawData.slice(1);
    const state = columnState[side];

    // Validation Status for coloring (ONLY for Target)
    let validation = null;
    let barcodeColumnIndex = -1;

    // Per request: "Hazırlanmayı bekleyen siparişler" (Source) colors shouldn't change.
    // Only Target gets validation coloring.
    if (side === 'target') {
        validation = getValidationStatus();
        barcodeColumnIndex = headers.findIndex(h => h && (h.toString().toLowerCase().trim() === 'barkod' || h.toString().toLowerCase().trim() === 'barcode'));
    }

    // Filter indices based on visibility
    const visibleIndices = state.indices.filter(index => !state.hiddenIndices.has(index));

    // Filter headers
    const filteredHeaders = visibleIndices.map(index => {
        const h = headers[index];
        return h ? h.toString() : `Col ${index + 1}`;
    });

    const headerRowId = side === 'source' ? 'source-header-row' : (side === 'cancels' ? 'cancels-header-row' : 'target-header-row');
    const headerRow = document.getElementById(headerRowId);
    if (headerRow) {
        headerRow.innerHTML = '';
    }

    // Check for Package Count and Piece Count column indices for specific cell highlighting
    const paketSayisiIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'paket sayısı');
    const adetSayisiIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'adet sayısı');

    // Indices for editing (Target/Cancels only)
    let editableIndices = new Set();
    if (side === 'target' || side === 'cancels') {
        // FORCE Indices 2 and 3 (Paket Sayısı, Adet Sayısı) to be editable
        editableIndices.add(2);
        editableIndices.add(3);

        headers.forEach((h, i) => {
            if (!h) return;
            const lower = h.toString().toLowerCase().trim();
            if (lower.includes('paket') || lower.includes('adet') || lower.includes('quantity')) {
                editableIndices.add(i);
            }
        });
        console.log('Editable Indices (Forced 2,3 + Detected):', Array.from(editableIndices));
    }

    // Build Header
    if (headerRow) {
        filteredHeaders.forEach(header => {
            const th = document.createElement('th');
            th.className = 'px-2 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100 bg-gray-50/90 backdrop-blur sticky top-0 z-10 border-r last:border-r-0 resizable-th relative group';

            const textSpan = document.createElement('span');
            textSpan.textContent = header;
            textSpan.className = 'block truncate';
            th.appendChild(textSpan);

            const resizer = document.createElement('div');
            resizer.className = 'resizer';
            th.appendChild(resizer);

            th.style.width = '200px';
            th.style.minWidth = '100px';

            let startX, startWidth;
            resizer.addEventListener('mousedown', function (e) {
                e.preventDefault();
                e.stopPropagation();
                startX = e.pageX;
                startWidth = th.offsetWidth;
                document.body.style.cursor = 'col-resize';
                th.classList.add('resizing');
                const onMouseMove = function (e) {
                    const diffX = e.pageX - startX;
                    const newWidth = Math.max(50, startWidth + diffX);
                    th.style.width = `${newWidth}px`;
                    th.style.minWidth = `${newWidth}px`;
                };
                const onMouseUp = function () {
                    document.body.style.cursor = '';
                    th.classList.remove('resizing');
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
            headerRow.appendChild(th);
        });
    }

    // Build Body
    const listContainerId = side === 'source' ? 'source-list-container' : (side === 'cancels' ? 'cancels-list-container' : 'target-list-container');
    const listContainer = document.getElementById(listContainerId);
    if (listContainer) listContainer.innerHTML = '';

    const emptyStateId = side === 'source' ? 'source-empty-state' : (side === 'cancels' ? 'cancels-empty-state' : 'target-empty-state');
    const emptyState = document.getElementById(emptyStateId);

    if (rows.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
    } else {
        if (emptyState) emptyState.classList.add('hidden');
    }

    rows.forEach((row, rowIndex) => {
        if (!row || row.length === 0) return; // Skip empty rows

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50/50 transition-colors border-b border-gray-50 last:border-0';

        // Red Text Logic for Manual Entries in Cancels
        if (side === 'cancels') {
            const metaIndex = headers.findIndex(h => h === '__meta_manual__');
            if (metaIndex !== -1 && row[metaIndex] == '1') {
                tr.classList.add('text-red-600', 'font-medium');
            }
        }

        // Validation Logic (Target Row coloring)
        let rowStatus = { validPacket: true, validPiece: true, rowValid: true };

        if (side === 'target' && validation && barcodeColumnIndex !== -1) {
            const barcode = row[barcodeColumnIndex] ? row[barcodeColumnIndex].toString().trim() : null;
            if (barcode && validation.map.has(barcode)) {
                rowStatus = validation.map.get(barcode);
                if (!rowStatus.rowValid) {
                    tr.classList.add('bg-red-50');
                } else {
                    tr.classList.add('bg-green-50');
                }
            }
        }

        visibleIndices.forEach(index => {
            const cellVal = row[index] !== undefined && row[index] !== null ? row[index].toString() : '';
            const td = document.createElement('td');
            // Added h-12 for fixed height for ALL tables
            td.className = 'px-2 py-2 text-sm text-gray-900 border-r border-gray-100 last:border-r-0 overflow-hidden whitespace-nowrap relative h-12';
            td.style.maxWidth = '0';

            // EDITING RESTRICTION LOGIC
            const isEditable = (side === 'target' || side === 'cancels') &&
                editableIndices.has(index) &&
                (side !== 'target' || isPreparationStarted);

            if (isEditable) {
                // Determine if we should show input DIRECTLY (Target + Prep Started) or Click-to-Edit (Others)
                const showInputDirectly = side === 'target' && isPreparationStarted;

                if (showInputDirectly) {
                    // RENDER INPUT DIRECTLY WITH VALIDATION COLORING
                    const currentVal = row[index] || '';
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'w-full h-full px-1 py-0.5 text-sm border-0 bg-transparent focus:ring-2 focus:ring-blue-400 rounded focus:outline-none font-bold';

                    // Apply validation-based coloring to the TD cell background
                    if (rowStatus) {
                        if (index === paketSayisiIndex) {
                            if (rowStatus.validPacket) {
                                td.classList.add('bg-green-50');
                                input.classList.add('text-green-600');
                            } else {
                                td.classList.add('bg-red-50');
                                input.classList.add('text-red-600');
                            }
                        } else if (index === adetSayisiIndex) {
                            if (rowStatus.validPiece) {
                                td.classList.add('bg-green-50');
                                input.classList.add('text-green-600');
                            } else {
                                td.classList.add('bg-red-50');
                                input.classList.add('text-red-600');
                            }
                        }
                    }

                    input.value = currentVal;

                    // Bind Events - Re-render on blur to update validation colors
                    const save = () => {
                        const newVal = input.value;
                        importedDataState[side][rowIndex + 1][index] = newVal;
                        if (originalDataState[side]) {
                            originalDataState[side][rowIndex + 1][index] = newVal;
                        }
                        // Re-render to update validation colors
                        processAndRenderData(side);
                        processAndRenderData('source');
                    };

                    input.addEventListener('blur', save);
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            input.blur();
                        }
                    });

                    td.innerHTML = '';
                    td.appendChild(input);

                } else {
                    // CLICK TO EDIT LEGACY
                    td.classList.add('cursor-pointer', 'hover:bg-gray-100');
                    td.title = 'Düzenlemek için tıklayın';

                    td.addEventListener('click', (e) => {
                        if (td.querySelector('input')) return;

                        const currentVal = row[index] || '';
                        const input = document.createElement('input');
                        input.type = 'number';
                        input.className = 'w-full h-full px-1 py-0.5 text-sm border border-blue-400 rounded focus:outline-none';
                        if (tr.classList.contains('text-red-600')) {
                            input.style.color = '#dc2626';
                        }
                        input.value = currentVal;

                        td.innerHTML = '';
                        td.appendChild(input);
                        input.focus();

                        const save = () => {
                            const newVal = input.value;
                            importedDataState[side][rowIndex + 1][index] = newVal;
                            if (originalDataState[side]) {
                                originalDataState[side][rowIndex + 1][index] = newVal;
                            }

                            processAndRenderData(side);
                            // Refresh the other side to updates colors
                            if (side === 'target') processAndRenderData('source');
                            if (side === 'source') processAndRenderData('target');
                        };

                        input.addEventListener('blur', save);
                        input.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                input.blur();
                            }
                        });

                        e.stopPropagation();
                    });
                }
            }

            // Only append innerDiv if we're NOT showing an input directly
            if (!(isEditable && side === 'target' && isPreparationStarted)) {
                const innerDiv = document.createElement('div');
                innerDiv.className = 'fade-text';
                innerDiv.textContent = cellVal;
                if (!isEditable) innerDiv.title = cellVal;

                // --- CELL SPECIFIC COLORING for TARGET ---
                if (side === 'target') {
                    if (index === paketSayisiIndex) {
                        if (!rowStatus.validPacket) {
                            innerDiv.classList.add('text-red-600', 'font-bold');
                        }
                    } else if (index === adetSayisiIndex) {
                        if (!rowStatus.validPiece) {
                            innerDiv.classList.add('text-red-600', 'font-bold');
                        }
                    }
                } else {
                    // For Source or others, keep existing logic for Package Count if present
                    if (index === paketSayisiIndex || index === adetSayisiIndex) {
                        innerDiv.classList.add('text-green-600', 'font-bold', 'bg-green-50', 'inline-block', 'px-2', 'rounded-full');
                    }
                }

                td.appendChild(innerDiv);
            }
            tr.appendChild(td);
        });
        if (listContainer) listContainer.appendChild(tr);
    });

    // Update Mark Shipped Button State
    if (side === 'target') {
        const btnMarkShipped = document.getElementById('btn-mark-shipped');
        if (btnMarkShipped) {
            if (validation && !validation.allValid) {
                btnMarkShipped.disabled = true;
                btnMarkShipped.classList.add('opacity-50', 'cursor-not-allowed');
                btnMarkShipped.title = 'Tüm ürünler eşleşmeden kargoya verilemez.';
            } else {
                btnMarkShipped.disabled = false;
                btnMarkShipped.classList.remove('opacity-50', 'cursor-not-allowed');
                btnMarkShipped.title = '';
            }
        }
    }
}

function updateColumnDropdown(side, headers) {
    const dropdownListId = side === 'source' ? 'source-column-list' : (side === 'cancels' ? 'cancels-column-list' : 'target-column-list');
    const listContainer = document.getElementById(dropdownListId);
    const state = columnState[side];

    listContainer.innerHTML = '';

    state.indices.forEach(colIndex => {
        const headerName = headers[colIndex] ? headers[colIndex].toString() : `Column ${colIndex + 1}`;
        const isHidden = state.hiddenIndices.has(colIndex);

        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-xs text-gray-700 select-none border-b border-gray-50 last:border-0';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !isHidden;
        checkbox.className = 'rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer';

        const span = document.createElement('span');
        span.textContent = headerName;
        span.className = 'truncate flex-1';

        label.appendChild(checkbox);
        label.appendChild(span);

        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.hiddenIndices.delete(colIndex);
            } else {
                state.hiddenIndices.add(colIndex);
            }
            // Correctly re-render THIS specific side
            processAndRenderData(side);
        });

        listContainer.appendChild(label);
    });
}

// SETTINGS & STORE MANAGEMENT LOGIC
function setupSettingsView() {
    const navDashboard = document.getElementById('nav-dashboard');
    const navSettings = document.getElementById('nav-settings');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewSettings = document.getElementById('view-settings');

    // Navigation
    if (navDashboard) {
        navDashboard.addEventListener('click', (e) => {
            e.preventDefault();
            viewDashboard.classList.remove('hidden');
            viewSettings.classList.add('hidden');
            navDashboard.classList.add('bg-blue-50', 'text-blue-700');
            navDashboard.classList.remove('text-gray-600', 'hover:bg-gray-50');
            // Reset Settings button style
            navSettings.classList.remove('bg-blue-50', 'text-blue-700');
            navSettings.classList.add('text-gray-600', 'hover:bg-gray-50');
        });
    }

    if (navSettings) {
        navSettings.addEventListener('click', (e) => {
            e.preventDefault();
            viewDashboard.classList.add('hidden');
            viewSettings.classList.remove('hidden');
            navSettings.classList.add('bg-blue-50', 'text-blue-700');
            navSettings.classList.remove('text-gray-600', 'hover:bg-gray-50');
            // Reset Dashboard button style
            navDashboard.classList.remove('bg-blue-50', 'text-blue-700');
            navDashboard.classList.add('text-gray-600', 'hover:bg-gray-50');

            // Settings are now initialized globally on load (initSettingsLogic)
            log.info('Navigating to settings view');
        });
    }
}

// --- INTEGRATED SETTINGS LOGIC WITH LOGGING ---
// Store variables removed: setStoreSelect, setAddStoreBtn

function initSettingsLogic() {
    log.info('Initializing Settings Logic (Integrated)...');

    // Just init integration UI
    initIntegrationSettings();

    // If we already have a current store, load its settings
    if (currentStore) {
        updateSettingsHeader(currentStore);
        handleSettingsStoreChange(currentStore.id);
    }
}

function updateSettingsHeader(store) {
    const el = document.getElementById('settings-header-store-name');
    if (el) el.textContent = store ? store.name : '-';
}

function handleSettingsStoreChange(storeId) {
    if (storeId) {
        if (setIntSection) setIntSection.classList.remove('hidden'); // Show Integration
        loadStoreIntegration(storeId); // Load Integration Data
    } else {
        if (setIntSection) setIntSection.classList.add('hidden');
    }
}



// loadSettingsStores removed




// Integration Settings Logic
let setIntSection, setApiKeyInput, setApiSecretInput, setSellerIdInput, setSaveIntegrationBtn;

function initIntegrationSettings() {
    setIntSection = document.getElementById('settings-integration-section');
    setApiKeyInput = document.getElementById('input-api-key');
    setApiSecretInput = document.getElementById('input-api-secret');
    setSellerIdInput = document.getElementById('input-seller-id');
    setSaveIntegrationBtn = document.getElementById('btn-save-integration');

    if (!setIntSection) return;

    // Save Integration
    if (setSaveIntegrationBtn) {
        setSaveIntegrationBtn.addEventListener('click', () => {
            const storeId = currentStore ? currentStore.id : null;
            const apiKey = setApiKeyInput ? setApiKeyInput.value.trim() : '';
            const apiSecret = setApiSecretInput ? setApiSecretInput.value.trim() : '';
            const sellerId = setSellerIdInput ? setSellerIdInput.value.trim() : '';

            if (!storeId) {
                showAlert('Lütfen bir mağaza seçiniz.', 'warning');
                return;
            }

            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('db-update-store-integration', { id: storeId, apiKey, apiSecret, sellerId }).then(res => {
                if (res.success) {
                    showAlert('Entegrasyon ayarları kaydedildi.', 'success');
                } else {
                    showAlert('Kaydetme başarısız: ' + res.message, 'error');
                }
            });
        });
    }
}

function loadStoreIntegration(storeId) {
    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('db-get-store', storeId).then(store => {
        if (store) {
            if (setApiKeyInput) setApiKeyInput.value = store.api_key || '';
            if (setApiSecretInput) setApiSecretInput.value = store.api_secret || '';
            if (setSellerIdInput) setSellerIdInput.value = store.seller_id || '';
        }
    });
}

// --- DASHBOARD HEADER & FILE MANAGER ---
// --- DASHBOARD HEADER & NAVIGATION LOGIC ---
let btnNavDashboard, btnNavFiles, btnNavSettings, btnNavArchive;
let viewDashboard, viewSettings, viewFiles, viewArchive;

function initNavigation() {
    viewDashboard = document.getElementById('view-dashboard');
    viewSettings = document.getElementById('view-settings');
    viewFiles = document.getElementById('view-file-manager');
    viewArchive = document.getElementById('view-archive');
    viewCancels = document.getElementById('view-cancels');
    viewCancelsArchive = document.getElementById('view-cancels-archive');
    viewNoStore = document.getElementById('view-no-store');

    btnNavDashboard = document.getElementById('btn-nav-dashboard');
    btnNavFiles = document.getElementById('btn-nav-files');
    btnNavSettings = document.getElementById('btn-nav-settings');
    btnNavArchive = document.getElementById('btn-nav-archive');
    btnNavCancelsArchive = document.getElementById('btn-nav-cancels-archive');

    log.info('Dosya butonu bulundu mu?', btnNavFiles);
    log.info('Ayarlar butonu bulundu mu?', btnNavSettings);
    log.info('Arşiv butonu bulundu mu?', btnNavArchive);
    log.info('Dashboard butonu bulundu mu?', btnNavDashboard);

    if (btnNavDashboard) btnNavDashboard.addEventListener('click', () => switchView('dashboard'));
    if (btnNavFiles) btnNavFiles.addEventListener('click', () => switchView('files'));
    if (btnNavSettings) btnNavSettings.addEventListener('click', () => switchView('settings'));
    if (btnNavArchive) btnNavArchive.addEventListener('click', () => switchView('archive'));
    if (btnNavCancelsArchive) btnNavCancelsArchive.addEventListener('click', () => switchView('cancels-archive'));

    // No Store Add Button
    const btnNoStoreAdd = document.getElementById('btn-no-store-add');
    if (btnNoStoreAdd) {
        btnNoStoreAdd.addEventListener('click', () => {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('open-stores-window');
        });
    }

    // Archive Filter Listeners
    const btnRefresh = document.getElementById('btn-refresh-archive');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => loadArchivePage());
    }

    const rangeSelect = document.getElementById('archive-range-filter');
    const dateContainer = document.getElementById('archive-date-picker-container');
    if (rangeSelect && dateContainer) {
        rangeSelect.addEventListener('change', () => {
            if (rangeSelect.value === 'specific') {
                dateContainer.style.display = 'flex';
            } else {
                dateContainer.style.display = 'none';
                loadArchivePage(); // Auto-load on range change
            }
        });
    }

    // Cancels Archive Filter Listeners
    const btnRefreshCancels = document.getElementById('btn-refresh-cancels-archive');
    if (btnRefreshCancels) {
        btnRefreshCancels.addEventListener('click', () => loadCancelsArchivePage());
    }
}

function switchView(viewName) {
    // Hide all
    if (viewDashboard) viewDashboard.classList.add('hidden');
    if (viewSettings) viewSettings.classList.add('hidden');
    if (viewFiles) viewFiles.classList.add('hidden');
    if (viewArchive) viewArchive.classList.add('hidden');
    if (viewCancelsArchive) viewCancelsArchive.classList.add('hidden');
    if (viewNoStore) viewNoStore.classList.add('hidden');

    // Reset Buttons
    [btnNavDashboard, btnNavFiles, btnNavSettings, btnNavArchive, btnNavCancelsArchive].forEach(btn => {
        if (btn) {
            // Remove Active Classes
            btn.classList.remove('bg-blue-600', 'text-white', 'shadow-sm', 'hover:bg-blue-700');
            // Add Inactive Classes (Sidebar Style)
            btn.classList.add('text-gray-800', 'hover:bg-blue-600', 'hover:text-white');
            // Ensure no old header styles remain
            btn.classList.remove('bg-white', 'border', 'border-gray-200', 'hover:bg-gray-50', 'text-gray-700');
        }
    });

    // Show selected and Styling
    let targetBtn = null;
    if (viewName === 'dashboard') {
        if (viewDashboard) viewDashboard.classList.remove('hidden');
        targetBtn = btnNavDashboard;
    } else if (viewName === 'settings') {
        if (viewSettings) viewSettings.classList.remove('hidden');
        targetBtn = btnNavSettings;
    } else if (viewName === 'files') {
        if (viewFiles) viewFiles.classList.remove('hidden');
        targetBtn = btnNavFiles;
        loadFileManagerPage();
    } else if (viewName === 'archive') {
        log.info('Switching to archive view');
        log.info('View archive:', viewArchive);
        if (viewArchive) viewArchive.classList.remove('hidden');
        targetBtn = btnNavArchive;
        // Set default date to today if empty
        const dateInput = document.getElementById('archive-date-filter');
        if (dateInput && !dateInput.value) {
            dateInput.valueAsDate = new Date();
        }
        loadArchivePage();
    } else if (viewName === 'cancels-archive') {
        log.info('Switching to cancels archive view');
        if (viewCancelsArchive) viewCancelsArchive.classList.remove('hidden');
        targetBtn = btnNavCancelsArchive;
        // Set default date to today if empty
        const dateInput = document.getElementById('cancels-archive-date-filter');
        if (dateInput && !dateInput.value) {
            dateInput.valueAsDate = new Date();
        }
        loadCancelsArchivePage();
    } else if (viewName === 'no-store') {
        if (viewNoStore) viewNoStore.classList.remove('hidden');
    }

    if (targetBtn) {
        // Remove Inactive Classes
        targetBtn.classList.remove('text-gray-800', 'hover:bg-blue-600', 'hover:text-white');
        // Add Active Classes
        targetBtn.classList.add('bg-blue-600', 'text-white', 'shadow-sm', 'hover:bg-blue-700');
    }
}



function renderFileManagerPageList(container, files) {
    container.innerHTML = '';
    if (files.length === 0) {
        container.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">Dosya bulunamadı.</td></tr>';
        return;
    }

    files.forEach(file => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${file.filename}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${file.sideDisplay}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(file.created_at).toLocaleString('tr-TR')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button class="text-red-600 hover:text-red-900 delete-file-btn p-2 hover:bg-red-50 rounded" data-id="${file.id}">Sil</button>
            </td>
        `;
        container.appendChild(tr);
    });

    const deleteBtns = container.querySelectorAll('.delete-file-btn');
    deleteBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const { ipcRenderer } = require('electron');

            showConfirm(
                'Dosya Sil',
                'Dosyayı ve içerdiği verileri silmek istediğinize emin misiniz?',
                () => {
                    ipcRenderer.invoke('db-delete-batch', id).then(res => {
                        if (res.success) {
                            loadFileManagerPage();
                            loadImportHistory('source');
                            loadImportHistory('target');
                            loadImportHistory('cancels');
                        } else {
                            showAlert('Silme başarısız', 'error');
                        }
                    });
                },
                null,
                'Sil',
                'İptal'
            );
        });
    });
}

// Archive Page Logic

// Helper to Save/Update Daily Archive

// ===== REALTIME TRACKING LOGIC =====

let realtimeTrackingEvents = [];
let previousSourceSnapshot = null; // Stores strictly the ORDER NUMBERS for comparison

async function handleSourceDataUpdate(newTableData, isApi = false) {
    // 1. Extract Order Numbers from New Data
    const headers = newTableData[0];
    const orderNoIdx = headers.findIndex(h => h && (
        h.toString().toLowerCase().includes('sipariş no') ||
        h.toString().toLowerCase().includes('sipariş numara') ||
        h.toString().toLowerCase().includes('order number') ||
        h.toString().toLowerCase().includes('order no')
    ));

    const productIdx = headers.findIndex(h => h && (
        h.toString().toLowerCase().includes('ürün adı') ||
        h.toString().toLowerCase().includes('product name')
    ));

    if (orderNoIdx === -1) {
        // Can't track if no order number
        return;
    }

    const currentOrders = new Map(); // OrderNo -> ProductName
    for (let i = 1; i < newTableData.length; i++) {
        const row = newTableData[i];
        const orderNo = row[orderNoIdx] ? row[orderNoIdx].toString().trim() : null;
        const productName = (productIdx !== -1 && row[productIdx]) ? row[productIdx] : 'Bilinmiyor';

        if (orderNo) {
            currentOrders.set(orderNo, productName);
        }
    }

    // 2. Compare with Previous Snapshot
    if (previousSourceSnapshot) {
        const prevOrderNos = previousSourceSnapshot; // Map<OrderNo, ProductName>
        const timestamp = new Date().toLocaleTimeString('tr-TR');
        const { ipcRenderer } = require('electron');

        // Check for NEW orders
        for (const [orderNo, prodName] of currentOrders) {
            if (!prevOrderNos.has(orderNo)) {
                // NEW ORDER
                const event = {
                    time: timestamp,
                    orderNo: orderNo,
                    productName: prodName,
                    status: 'Yeni',
                    type: 'new',
                    color: 'green' // UI helper
                };

                realtimeTrackingEvents.unshift(event);

                // Persist
                if (currentStore) {
                    ipcRenderer.invoke('add-tracking-event', {
                        storeId: currentStore.id,
                        eventType: 'new',
                        orderNumber: orderNo,
                        productName: prodName
                    });
                }
            }
        }

        // Check for CANCELLED orders (In previous but not in current)
        // ONLY if this is an API update or explicitly reliable source 
        // (Excel might just be a different partial list, but user said "Varsayılan sistemimizde... eksik olanlar")
        for (const [orderNo, prodName] of prevOrderNos) {
            if (!currentOrders.has(orderNo)) {
                // CANCELLED (or removed)
                const event = {
                    time: timestamp,
                    orderNo: orderNo,
                    productName: prodName,
                    status: 'İptal',
                    type: 'cancel',
                    color: 'red'
                };

                realtimeTrackingEvents.unshift(event);

                // Persist
                if (currentStore) {
                    ipcRenderer.invoke('add-tracking-event', {
                        storeId: currentStore.id,
                        eventType: 'cancel',
                        orderNumber: orderNo,
                        productName: prodName
                    });
                }
            }
        }

        // Limit local events list
        if (realtimeTrackingEvents.length > 50) {
            realtimeTrackingEvents = realtimeTrackingEvents.slice(0, 50);
        }

        renderRealtimeTracking();
    }

    // 3. Update Snapshot
    previousSourceSnapshot = currentOrders;
}

function renderRealtimeTracking() {
    const container = document.getElementById('realtime-tracking-list');
    if (!container) return;

    if (realtimeTrackingEvents.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="5" class="px-4 py-8 text-center text-gray-400">
                    Henüz değişiklik tespit edilmedi
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = realtimeTrackingEvents.map(event => {
        const bgColor = event.type === 'new' ? 'bg-green-50' : 'bg-red-50';
        const textColor = event.type === 'new' ? 'text-green-700' : 'text-red-700';
        const badge = event.type === 'new' ?
            '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Yeni</span>' :
            '<span class="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">İptal</span>';

        const changeIcon = event.type === 'new' ?
            '<span class="flex items-center gap-1">➕ <span class="text-xs opacity-75">Eklendi</span></span>' :
            '<span class="flex items-center gap-1">❌ <span class="text-xs opacity-75">Düştü</span></span>';

        return `
            <tr class="${bgColor} ${textColor} border-b border-gray-100 last:border-0 hover:brightness-95 transition-all">
                <td class="px-2 py-2 text-xs whitespace-nowrap opacity-75">${event.time}</td>
                <td class="px-2 py-2 text-xs font-bold font-mono">${event.orderNo}</td>
                <td class="px-2 py-2 text-xs truncate max-w-[200px]" title="${event.productName}">${event.productName}</td>
                <td class="px-2 py-2 text-xs">${badge}</td>
                <td class="px-2 py-2 text-xs font-medium">${changeIcon}</td>
            </tr>
        `;
    }).join('');
}

// Clear Tracking History
const btnClearTracking = document.getElementById('btn-clear-tracking');
if (btnClearTracking) {
    btnClearTracking.addEventListener('click', async () => {
        realtimeTrackingEvents = [];
        renderRealtimeTracking();
        previousSourceSnapshot = null; // Reset snapshot too? Or keep current state?
        // Usually reset snapshot is bad because next update will think everything is new.
        // Keeping snapshot is better.

        // Also clear DB?
        if (currentStore) {
            const { ipcRenderer } = require('electron');
            await ipcRenderer.invoke('cleanup-tracking-events', currentStore.id);
        }
    });
}

// Helper: Show Generic Confirmation Modal
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmation-modal');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const btnConfirm = document.getElementById('btn-modal-confirm');
    const btnCancel = document.getElementById('btn-modal-cancel');

    if (!modal || !btnConfirm || !btnCancel) return;

    if (title) titleEl.textContent = title;
    if (message) msgEl.textContent = message;

    // Reset Listeners (cloneNode trick to strip old listeners)
    const newConfirm = btnConfirm.cloneNode(true);
    const newCancel = btnCancel.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
    btnCancel.parentNode.replaceChild(newCancel, btnCancel);

    newConfirm.addEventListener('click', () => {
        onConfirm();
        modal.classList.add('hidden');
    });

    newCancel.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.classList.remove('hidden');
}

/* Filter Info Banner Close Logic */
const btnCloseFilterInfo = document.getElementById('btn-close-filter-info');
if (btnCloseFilterInfo) {
    btnCloseFilterInfo.addEventListener('click', () => {
        const banner = document.getElementById('source-filter-info');
        if (banner) banner.classList.add('hidden');
    });
}

// --- TRENDYOL CANCELS LOGIC ---

const btnFetchTrendyolCancels = document.getElementById('btn-fetch-trendyol-cancels');
if (btnFetchTrendyolCancels) {
    btnFetchTrendyolCancels.addEventListener('click', () => loadTrendyolCancels());
}

async function loadTrendyolCancels() {
    if (!currentStore) {
        showAlert("Lütfen önce bir mağaza seçiniz.", 'warning');
        return;
    }

    const listContainer = document.getElementById('cancels-archive-list-container');
    const rangeSelect = document.getElementById('cancels-range-filter');
    if (!listContainer || !rangeSelect) return;

    // 1. Calculate Date Range
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    let startDate = todayStr;
    const endDate = todayStr;

    const d = new Date();
    switch (rangeSelect.value) {
        case 'last_3_days': d.setDate(today.getDate() - 3); startDate = d.toISOString().split('T')[0]; break;
        case 'last_week': d.setDate(today.getDate() - 7); startDate = d.toISOString().split('T')[0]; break;
        case 'last_month': d.setDate(today.getDate() - 30); startDate = d.toISOString().split('T')[0]; break;
        default: break; // today
    }

    // UI Loading
    listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Trendyol verileri çekiliyor...</td></tr>';

    const { ipcRenderer } = require('electron');

    try {
        // 2. Fetch Trendyol Cancels
        const startTs = new Date(startDate).setHours(0, 0, 0, 0);
        const endTs = new Date(endDate).setHours(23, 59, 59, 999);

        const apiRes = await ipcRenderer.invoke('fetch-trendyol-cancelled', {
            storeId: currentStore.id,
            startDate: startTs,
            endDate: endTs
        });

        if (!apiRes.success) {
            showAlert('Hata: ' + apiRes.message, 'error');
            listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-red-500">Veri çekilemedi.</td></tr>';
            return;
        }

        const trendyolCancels = apiRes.data; // Array of {orderNumber, ...}

        if (trendyolCancels.length === 0) {
            listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">İptal edilen sipariş bulunamadı.</td></tr>';
            return;
        }

        // 3. Fetch Local Data for Comparison
        // FIX: Search explicitly from a wide range (past 1 year) to ensure we find the cargo entry 
        // even if it was shipped days/weeks ago.
        const pastDate = new Date();
        pastDate.setFullYear(pastDate.getFullYear() - 1); // 1 year ago
        const wideStartDate = pastDate.toISOString().split('T')[0];

        const localEntries = await ipcRenderer.invoke('param-get-daily-entries-range', {
            storeId: currentStore.id,
            startDate: wideStartDate, // Use wide range for comparison
            endDate,
            type: 'all'
        });

        // Build Sets
        const cargoMap = new Map(); // OrderNo -> FullEntry (for update)
        const cancelMap = new Map(); // OrderNo -> FullEntry (for delete)

        localEntries.forEach(entry => {
            const rows = entry.data || [];
            if (rows.length < 2) return;
            const headers = rows[0];
            // Enhanced Column Detection
            const orderIdx = headers.findIndex(h => h && (
                h.toString().toLowerCase().trim() === 'sipariş no' ||
                h.toString().toLowerCase().includes('sipariş no') ||
                h.toString().toLowerCase().includes('sipariş numara') ||
                h.toString().toLowerCase().includes('sipariş numarası') ||
                h.toString().toLowerCase().includes('siparis no') || // Covering generic cases
                h.toString().toLowerCase().trim() === 'barkod'
            ));

            // Console Debugging
            if (headers.some(h => h.toString().includes('Sipariş No'))) {
                console.log('Found a header with Sipariş No:', headers);
                console.log('Calculated OrderIdx:', orderIdx);
            }

            log.info(`Checking Entry ID: ${entry.id}, Headers: ${headers.join(', ')}, OrderIdx: ${orderIdx}`);

            if (orderIdx === -1) return;

            for (let i = 1; i < rows.length; i++) {
                const orderNo = rows[i][orderIdx];
                if (orderNo) {
                    const sOrder = String(orderNo).trim();
                    console.log('Archive Order Found:', sOrder, 'Type:', entry.type); // DEBUG
                    if (entry.type === 'cargo') {
                        cargoMap.set(sOrder, entry);
                    } else if (entry.type === 'cancel') {
                        cancelMap.set(sOrder, entry);
                    }
                }
            }
        });

        console.log('--- DEBUG MAPS ---');
        console.log('Cancel Map Keys:', Array.from(cancelMap.keys()));
        console.log('Target Dummy Order:', '12933331383');
        console.log('In Map?', cancelMap.has('12933331383'));
        console.log('------------------');

        log.info(`Cargo Map Size: ${cargoMap.size}, Cancel Map Size: ${cancelMap.size}`);

        // 4. Render
        listContainer.innerHTML = '';

        trendyolCancels.forEach(item => {
            const orderNo = String(item.orderNumber).trim();
            let status = 'İptal';
            let statusColor = 'text-red-600 bg-red-100';
            let actionHtml = '';
            let entryJson = '';

            // Check match (Reverted forced check)
            if (cargoMap.has(orderNo)) {
                status = 'Kargoya Verilen İptal';
                statusColor = 'text-orange-700 bg-orange-100';

                // Use existing entry if found, otherwise mock one for the dummy
                const entry = cargoMap.get(orderNo);

                actionHtml = `
                    <label class="flex items-center space-x-1 cursor-pointer" title="İade Al">
                        <input type="checkbox" class="form-checkbox h-4 w-4 text-orange-600 return-confirm-cb" 
                            data-order="${orderNo}" data-entry-id="${entry.id}">
                        <span class="text-xs text-gray-600">İade</span>
                    </label>
                 `;
            } else if (cancelMap.has(orderNo)) {
                status = 'Hazırlanırken İptal';
                statusColor = 'text-gray-600 bg-gray-100';

                const entry = cancelMap.get(orderNo);
                actionHtml = `
                    <label class="flex items-center space-x-1 cursor-pointer" title="Listeden Sil">
                        <input type="checkbox" class="form-checkbox h-4 w-4 text-gray-600 ack-cancel-cb" 
                            data-order="${orderNo}" data-entry-id="${entry.id}">
                        <span class="text-xs text-gray-600">Sil</span>
                    </label>
                `;
            }

            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-100 hover:bg-gray-50';
            // Helper for short date format (dd.mm.yy HH:MM)
            const formatDate = (d) => d ? new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

            // Truncate product name
            const productName = item.productName || '-';
            const shortProductName = productName.length > 12 ? productName.slice(0, 12) + '...' : productName;

            tr.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDate(item.orderDate)}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDate(item.statusDate)}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900 overflow-hidden text-ellipsis max-w-[150px]" title="${item.customer}">${item.customer || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono">${item.cargoTrackingNumber || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-mono">${orderNo}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm font-medium">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">${status}</span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500" title="${productName}">
                    <div>${shortProductName}</div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-right">
                    ${actionHtml}
                </td>
             `;
            listContainer.appendChild(tr);
        });

        // 5. Attach Listeners
        document.querySelectorAll('.return-confirm-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    e.target.checked = false; // Reset visually immediately
                    const orderNo = e.target.getAttribute('data-order');
                    const entryId = e.target.getAttribute('data-entry-id');

                    showConfirmModal(
                        'İade Onayı',
                        'Bu ürünü kargodan geri teslim aldığınızı onaylıyor musunuz? Onaylarsanız kargo arşivinden silinecektir.',
                        async () => {
                            await deleteOrderFromEntry(entryId, orderNo);
                            loadTrendyolCancels(); // Refresh
                        }
                    );
                }
            });
        });

        document.querySelectorAll('.ack-cancel-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    e.target.checked = false;
                    const orderNo = e.target.getAttribute('data-order');
                    const entryId = e.target.getAttribute('data-entry-id');

                    showConfirmModal(
                        'İptal Onayı',
                        'Bu siparişin iptal işlemini (hazırlanırken iptal) onaylıyor musunuz? Onaylarsanız kargoya vermediğinizi doğrularsınız.',
                        async () => {
                            await deleteOrderFromEntry(entryId, orderNo);
                            loadTrendyolCancels(); // Refresh
                        }
                    );
                }
            });
        });

    } catch (err) {
        log.error(err);
        listContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-red-500">Hata: ' + err.message + '</td></tr>';
    }
}

async function deleteOrderFromEntry(entryId, orderNoToDelete) {
    const { ipcRenderer } = require('electron');
    try {
        const res = await ipcRenderer.invoke('param-remove-order-from-entry', {
            entryId,
            orderNo: orderNoToDelete
        });

        if (!res.success) {
            showAlert('Silme işlemi başarısız: ' + (res.message || 'Bilinmeyen hata'), 'error');
        }
    } catch (err) {
        log.error('Delete order error:', err);
        showAlert('İşlem sırasında hata oluştu.', 'error');
    }
}


// ==========================================
// MANUAL CARGO ENTRY LOGIC
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const btnManualCargoAdd = document.getElementById('btn-manual-cargo-add');
    const manualCargoModal = document.getElementById('manual-cargo-modal');
    const btnCloseManualModal = document.getElementById('btn-close-manual-modal');
    const btnSaveManualCargo = document.getElementById('btn-save-manual-cargo');
    const btnAddManualRow = document.getElementById('btn-add-manual-row');
    const manualCargoTableBody = document.getElementById('manual-cargo-table-body');
    const manualCargoModalBackdrop = document.getElementById('manual-cargo-modal-backdrop');

    if (btnManualCargoAdd) {
        btnManualCargoAdd.addEventListener('click', () => {
            if (!currentStore) {
                showAlert('Lütfen önce bir mağaza seçiniz.', 'warning');
                return;
            }
            // Clear existing rows
            if (manualCargoTableBody) {
                manualCargoTableBody.innerHTML = '';
                // Add initial empty row
                addManualCargoRow();
            }
            if (manualCargoModal) manualCargoModal.classList.remove('hidden');
        });
    }

    if (btnCloseManualModal) {
        btnCloseManualModal.addEventListener('click', closeManualCargoModal);
    }

    if (manualCargoModalBackdrop) {
        manualCargoModalBackdrop.addEventListener('click', closeManualCargoModal);
    }

    function closeManualCargoModal() {
        if (manualCargoModal) manualCargoModal.classList.add('hidden');
    }

    if (btnAddManualRow) {
        btnAddManualRow.addEventListener('click', addManualCargoRow);
    }

    function addManualCargoRow() {
        if (!manualCargoTableBody) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-2 py-2"><input type="text" class="manual-product-name w-full border border-gray-300 rounded-md px-2 py-1 focus:ring-blue-500 focus:border-blue-500 text-sm" placeholder="Ürün Adı"></td>
            <td class="px-2 py-2"><input type="number" class="manual-package-count w-full border border-gray-300 rounded-md px-2 py-1 focus:ring-blue-500 focus:border-blue-500 text-sm" placeholder="0"></td>
            <td class="px-2 py-2"><input type="number" class="manual-quantity w-full border border-gray-300 rounded-md px-2 py-1 focus:ring-blue-500 focus:border-blue-500 text-sm" placeholder="0"></td>
            <td class="px-2 py-2"><input type="text" class="manual-barcode w-full border border-gray-300 rounded-md px-2 py-1 focus:ring-blue-500 focus:border-blue-500 text-sm" placeholder="Barkod"></td>
            <td class="px-2 py-2 text-center">
                <button type="button" class="text-red-600 hover:text-red-800" onclick="this.closest('tr').remove()">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            </td>
        `;
        manualCargoTableBody.appendChild(tr);
    }

    if (btnSaveManualCargo) {
        btnSaveManualCargo.addEventListener('click', async () => {
            const { ipcRenderer } = require('electron');
            if (!currentStore) return;

            const rows = manualCargoTableBody.querySelectorAll('tr');
            const entries = [];

            rows.forEach(row => {
                const productName = row.querySelector('.manual-product-name').value.trim();
                const packageCount = parseInt(row.querySelector('.manual-package-count').value) || 0;
                const quantity = parseInt(row.querySelector('.manual-quantity').value) || 0;
                const barcode = row.querySelector('.manual-barcode').value.trim();

                if (productName || barcode || packageCount > 0 || quantity > 0) {
                    entries.push({ productName, packageCount, quantity, barcode });
                }
            });

            if (entries.length === 0) {
                showAlert('Lütfen en az bir satır veri giriniz.', 'warning');
                return;
            }

            try {
                // Show loading state
                const originalText = btnSaveManualCargo.textContent;
                btnSaveManualCargo.disabled = true;
                btnSaveManualCargo.textContent = 'Kaydediliyor...';

                const result = await ipcRenderer.invoke('db-save-manual-cargo-entry', {
                    storeId: currentStore.id,
                    entries: entries
                });

                if (result.success) {
                    showAlert(`${result.count} adet kayıt başarıyla eklendi.`, 'success');
                    closeManualCargoModal();
                } else {
                    showAlert('Kayıt sırasında bir hata oluştu.', 'error');
                }
            } catch (error) {
                console.error('Save error:', error);
                showAlert('Hata: ' + error.message, 'error');
            } finally {
                btnSaveManualCargo.disabled = false;
                btnSaveManualCargo.textContent = 'Kaydet';

                // Focus Restoration Logic
                if (manualCargoModal && !manualCargoModal.classList.contains('hidden')) {
                    // If modal stays open (error), focus the button to keep tab index active
                    btnSaveManualCargo.focus();
                } else {
                    // If modal closed, focus the trigger button on main page
                    const btnOpen = document.getElementById('btn-manual-cargo-add');
                    if (btnOpen) btnOpen.focus();
                }
            }
        });
    }
});


function setupArchiveEventDelegation() {
    const archiveListContainer = document.getElementById('archive-list-container');
    const cancelsListContainer = document.getElementById('cancels-archive-list-container');

    const handleExpandCallback = (e) => {
        const btn = e.target.closest('.expand-detail-btn');
        if (!btn) return;

        const targetId = btn.getAttribute('data-target');
        const detailRow = document.getElementById(targetId);
        const svg = btn.querySelector('svg');

        if (!detailRow) return;

        if (detailRow.classList.contains('hidden')) {
            detailRow.classList.remove('hidden');
            if (svg) svg.style.transform = 'rotate(180deg)';
            btn.innerHTML = `
                <svg class="w-4 h-4 inline-block transition-transform" style="transform: rotate(180deg);" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
                Gizle
            `;
        } else {
            detailRow.classList.add('hidden');
            if (svg) svg.style.transform = 'rotate(0deg)';
            btn.innerHTML = `
                <svg class="w-4 h-4 inline-block transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
                Detay
            `;
        }
    };

    const handleDeleteCallback = (e) => {
        const btn = e.target.closest('.delete-daily-btn');
        if (!btn) return;

        const id = btn.getAttribute('data-id');
        const { ipcRenderer } = require('electron');

        const confirmMsg = 'Bu kaydı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.';

        if (typeof showConfirmModal === 'function') {
            showConfirmModal('Kaydı Sil', confirmMsg, () => {
                executeDelete(id);
            });
        } else {
            showConfirm('Kaydı Sil', confirmMsg, () => {
                executeDelete(id);
            });
        }


        function executeDelete(entryId) {
            const isCancel = btn.closest('#cancels-archive-list-container') !== null;

            if (isCancel) {
                ipcRenderer.invoke('param-delete-daily-entry', { id: entryId }).then(res => {
                    if (res.success) loadCancelsArchivePage();
                });
            } else {
                ipcRenderer.invoke('param-delete-daily-entry', entryId).then(res => {
                    if (res.success) loadArchivePage();
                });
            }
        }
    };

    if (archiveListContainer) {
        archiveListContainer.addEventListener('click', handleExpandCallback);
        archiveListContainer.addEventListener('click', handleDeleteCallback);
    }

    if (cancelsListContainer) {
        cancelsListContainer.addEventListener('click', handleExpandCallback);
        cancelsListContainer.addEventListener('click', handleDeleteCallback);
    }
}


