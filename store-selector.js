const { ipcRenderer } = require('electron');

// UI Elements
const storeGrid = document.getElementById('store-grid');
const emptyState = document.getElementById('empty-state');
const btnManageStores = document.getElementById('btn-manage-stores');

// Management Modal Elements
const manageModal = document.getElementById('manage-modal');
const manageOverlay = document.getElementById('manage-modal-overlay');
const btnCloseManageModal = document.getElementById('btn-close-manage-modal');
const inputNewStoreName = document.getElementById('new-store-name');
const btnAddNewStore = document.getElementById('btn-add-new-store');
const manageStoreList = document.getElementById('manage-store-list');

let stores = [];

// ==========================================
// CUSTOM ALERT MODAL FUNCTION
// ==========================================
function showAlert(message, type = 'info', title = null) {
    const modal = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-title');
    const messageEl = document.getElementById('alert-message');
    const iconContainer = document.getElementById('alert-icon-container');
    const okBtn = document.getElementById('btn-alert-ok');

    if (!modal || !titleEl || !messageEl || !iconContainer || !okBtn) {
        alert(message);
        return;
    }

    messageEl.textContent = message;

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
    titleEl.textContent = title || config.title;
    iconContainer.className = `mx-auto flex items-center justify-center h-12 w-12 rounded-full ${config.bgColor}`;
    iconContainer.innerHTML = `<div class="${config.iconColor}">${config.icon}</div>`;
    okBtn.className = `px-4 py-2 text-white text-sm font-medium rounded-md w-full shadow-sm focus:outline-none focus:ring-2 ${config.btnColor}`;

    modal.classList.remove('hidden');

    const closeModal = () => {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', closeModal);
        modal.removeEventListener('click', outsideClickHandler);
    };

    const outsideClickHandler = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };

    okBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', outsideClickHandler);
}

// ==========================================
// CUSTOM CONFIRM MODAL FUNCTION
// ==========================================
function showConfirm(title, message, onConfirm, onCancel = null, confirmText = 'Evet', cancelText = 'İptal') {
    const modal = document.getElementById('confirmation-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('btn-modal-confirm');
    const cancelBtn = document.getElementById('btn-modal-cancel');

    if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
        if (confirm(message)) {
            if (onConfirm) onConfirm();
        } else {
            if (onCancel) onCancel();
        }
        return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    modal.classList.remove('hidden');

    const closeModal = () => {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', confirmHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
        modal.removeEventListener('click', outsideClickHandler);
    };

    const confirmHandler = () => {
        closeModal();
        if (onConfirm) onConfirm();
    };

    const cancelHandler = () => {
        closeModal();
        if (onCancel) onCancel();
    };

    const outsideClickHandler = (e) => {
        if (e.target === modal) {
            cancelHandler();
        }
    };

    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
    modal.addEventListener('click', outsideClickHandler);
}

// Trendyol Logo SVG path
// Helper to get icon by type
function getStoreIcon(type) {
    const t = (type || 'website').toLowerCase();
    switch (t) {
        case 'trendyol': return `<img src="./icons/trendyol.png" class="w-8 h-8 object-contain">`;
        case 'hepsiburada': return `<img src="./icons/hepsiburada.png" class="w-8 h-8 object-contain">`;
        case 'amazon': return `<img src="./icons/amazon.png" class="w-8 h-8 object-contain">`;
        case 'idefix': return `<img src="./icons/idefix.png" class="w-8 h-8 object-contain">`;
        case 'n11': return `<div class="w-8 h-8 flex items-center justify-center bg-gray-100 rounded text-xs font-bold text-red-600">N11</div>`;
        default: return `<svg class="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>`;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStores();

    // Event Listeners for Management Modal
    if (btnManageStores) {
        btnManageStores.addEventListener('click', openManagementModal);
    }

    if (btnCloseManageModal) btnCloseManageModal.addEventListener('click', closeManagementModal);
    if (manageOverlay) manageOverlay.addEventListener('click', closeManagementModal);

    if (btnAddNewStore) {
        btnAddNewStore.addEventListener('click', addNewStore);
    }

    // Listen for store updates from other windows
    ipcRenderer.on('stores-updated', () => {
        loadStores();
    });

    // Listen for close confirmation request from main process
    ipcRenderer.on('request-close-confirmation', (event, data) => {
        showConfirm(
            'Uygulamayı Kapat',
            data.message,
            () => {
                // User confirmed - send response to main
                ipcRenderer.send('close-confirmation-response', true);
            },
            () => {
                // User cancelled - send response to main
                ipcRenderer.send('close-confirmation-response', false);
            },
            'Kapat',
            'İptal'
        );
    });
});

async function loadStores() {
    try {
        stores = await ipcRenderer.invoke('db-get-stores');
        renderStores();
        // If management modal is open, refresh its list too
        if (!manageModal.classList.contains('hidden')) {
            renderManagementList();
        }
    } catch (err) {
        console.error('Error loading stores:', err);
    }
}

async function renderStores() {
    if (stores.length === 0) {
        storeGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    storeGrid.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // Get list of already opened stores
    const openedStores = await ipcRenderer.invoke('get-opened-stores');
    const openedStoreIds = new Set(openedStores);

    storeGrid.innerHTML = '';

    stores.forEach(store => {
        const isOpened = openedStoreIds.has(store.id);

        const card = document.createElement('div');

        let cardClasses = "relative group bg-white border rounded-xl p-3 flex items-center justify-between transition-all duration-200 ease-in-out";

        if (isOpened) {
            cardClasses += " border-green-200 bg-green-50 cursor-default opacity-90";
        } else {
            cardClasses += " border-gray-200 hover:border-orange-400 hover:shadow-md cursor-pointer";
        }

        card.className = cardClasses;

        card.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex-shrink-0">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden border border-gray-100 bg-white">
                        ${getStoreIcon(store.store_type)}
                    </div>
                </div>
                <div>
                    <h3 class="text-lg font-semibold text-gray-900 ${isOpened ? 'text-green-800' : 'group-hover:text-orange-700'} transition-colors">${store.name}</h3>
                    <p class="text-sm text-gray-500 flex items-center gap-1">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        ${store.created_at ? new Date(store.created_at).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Tarih yok'}
                    </p>
                </div>
            </div>
            
            <div class="flex items-center">
                ${isOpened
                ? `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                         <span class="w-2 h-2 mr-1.5 rounded-full bg-green-500"></span>
                         Açık
                       </span>`
                : `<svg class="w-6 h-6 text-gray-300 group-hover:text-orange-500 transform group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                       </svg>`
            }
            </div>
        `;

        if (!isOpened) {
            card.addEventListener('click', () => {
                openStoreWindow(store);
            });
        }

        storeGrid.appendChild(card);
    });
}

function openManagementModal() {
    inputNewStoreName.value = '';
    renderManagementList();
    manageModal.classList.remove('hidden');
}

function closeManagementModal() {
    manageModal.classList.add('hidden');
}

function renderManagementList() {
    manageStoreList.innerHTML = '';

    if (stores.length === 0) {
        manageStoreList.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 text-center h-full">
                <div class="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                    <svg class="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                </div>
                <p class="text-sm text-gray-500 font-medium">Henüz kayıtlı mağaza yok.</p>
                <p class="text-xs text-gray-400 mt-1">Sol taraftaki formu kullanarak yeni bir mağaza ekleyebilirsiniz.</p>
            </div>`;
        return;
    }

    stores.forEach(store => {
        const li = document.createElement('li');
        li.className = "grid grid-cols-12 gap-4 px-4 py-3 hover:bg-blue-50 transition-colors items-center group border-b border-gray-50 last:border-0";

        // Generate icon
        const iconHtml = getStoreIcon(store.store_type);

        li.innerHTML = `
            <div class="col-span-8 md:col-span-9 flex items-center gap-3 overflow-hidden">
                <div class="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 p-1 shadow-sm">
                    ${iconHtml}
                </div>
                <div class="flex-1 min-w-0 mr-2">
                    <input type="text" value="${store.name}" 
                        class="store-name-input bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 rounded px-2 py-1.5 w-full text-sm text-gray-700 font-medium transition-all"
                        data-id="${store.id}"
                        placeholder="Mağaza Adı"
                    >
                </div>
            </div>
            <div class="col-span-4 md:col-span-3 flex justify-end items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                <button class="btn-save-name hidden text-green-600 hover:bg-green-50 p-1.5 rounded-md transition-colors" title="Kaydet">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                </button>
                <div class="h-4 w-px bg-gray-200 mx-1"></div>
                <button class="btn-delete-store text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition-colors" title="Sil" data-id="${store.id}">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        `;

        // Handle Inline Editing
        const input = li.querySelector('.store-name-input');
        const btnSave = li.querySelector('.btn-save-name');

        input.addEventListener('focus', () => {
            input.classList.remove('border-transparent', 'bg-transparent');
            input.classList.add('bg-white');
        });

        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (document.activeElement !== btnSave) {
                    input.classList.add('border-transparent', 'bg-transparent');
                    input.classList.remove('bg-white');
                    input.value = store.name; // Reset if not saved
                    btnSave.classList.add('hidden');
                }
            }, 200);
        });

        input.addEventListener('input', () => {
            if (input.value.trim() !== store.name) {
                btnSave.classList.remove('hidden');
            } else {
                btnSave.classList.add('hidden');
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                updateStoreName(store.id, input.value);
            }
        });

        btnSave.addEventListener('click', () => {
            updateStoreName(store.id, input.value);
        });

        // Handle Delete
        const btnDelete = li.querySelector('.btn-delete-store');
        btnDelete.addEventListener('click', () => {
            deleteStore(store.id, store.name);
        });

        manageStoreList.appendChild(li);
    });
}

async function addNewStore() {
    const name = inputNewStoreName.value.trim();
    const typeFn = document.querySelector('input[name="store_type"]:checked');
    const type = typeFn ? typeFn.value : 'website';

    if (!name) {
        showAlert('Lütfen mağaza adı giriniz.', 'warning');
        return;
    }

    try {
        const res = await ipcRenderer.invoke('db-add-store', { name, type });
        if (res.success) {
            inputNewStoreName.value = '';
            await loadStores(); // Refresh global list
            renderManagementList(); // Refresh modal list
            ipcRenderer.send('notify-stores-updated');
            // FIX: Restore focus to avoid freeze sensation
            setTimeout(() => inputNewStoreName.focus(), 100);
        } else {
            showAlert('Ekleme başarısız: ' + (res.message || ''), 'error');
            setTimeout(() => inputNewStoreName.focus(), 100);
        }
    } catch (err) {
        console.error('Error adding store:', err);
        showAlert('Bir hata oluştu: ' + err.message, 'error');
    }
}

async function updateStoreName(id, newName) {
    if (!newName.trim()) return;

    try {
        const res = await ipcRenderer.invoke('db-update-store', { id, name: newName });
        if (res.success) {
            await loadStores();
            renderManagementList();
            ipcRenderer.send('notify-stores-updated');
        } else {
            showAlert('Güncelleme başarısız: ' + res.message, 'error');
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteStore(id, name) {
    showConfirm(
        'Mağaza Sil',
        `${name} mağazasını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
        async () => {
            try {
                const res = await ipcRenderer.invoke('db-delete-store', id);
                if (res.success) {
                    await loadStores();
                    renderManagementList();
                    ipcRenderer.send('notify-stores-updated');
                } else {
                    showAlert('Silme başarısız: ' + res.message, 'error');
                }
            } catch (err) {
                console.error(err);
                showAlert('Bir hata oluştu.', 'error');
            }
        },
        null,
        'Sil',
        'İptal'
    );
}

async function openStoreWindow(store) {
    try {
        const result = await ipcRenderer.invoke('open-store-window', store.id);
        if (result.success) {
            // Refresh the list to show the store as opened
            await loadStores();
        } else {
            if (result.message) {
                // Don't show alert for "already open" message, just focus the window
                console.log(result.message);
            }
            await loadStores();
        }
    } catch (err) {
        console.error('Error opening store window:', err);
        showAlert('Bir hata oluştu: ' + err.message, 'error');
    }
}
