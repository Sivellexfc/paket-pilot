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

        let cardClasses = "relative group bg-white border rounded-xl p-4 flex items-center justify-between transition-all duration-200 ease-in-out";

        if (isOpened) {
            cardClasses += " border-green-200 bg-green-50 cursor-default opacity-90";
        } else {
            cardClasses += " border-gray-200 hover:border-orange-400 hover:shadow-md cursor-pointer";
        }

        card.className = cardClasses;

        card.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex-shrink-0">
                    <div class="w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden border border-gray-100 bg-white">
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
        manageStoreList.innerHTML = '<li class="p-4 text-center text-gray-500 italic">Kayıtlı mağaza yok.</li>';
        return;
    }

    stores.forEach(store => {
        const li = document.createElement('li');
        li.className = "px-4 py-3 flex items-center justify-between hover:bg-gray-50";

        li.innerHTML = `
            <div class="flex-1 mr-4">
                <input type="text" value="${store.name}" 
                    class="store-name-input bg-transparent border-transparent hover:border-gray-300 focus:border-orange-500 rounded px-2 py-1 w-full text-sm text-gray-800 transition-colors"
                    data-id="${store.id}"
                >
            </div>
            <div class="flex items-center gap-2">
                <button class="btn-save-name hidden text-green-600 hover:text-green-800 p-1" title="Kaydet">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                </button>
                <button class="btn-delete-store text-red-400 hover:text-red-700 p-1" title="Sil" data-id="${store.id}">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        `;

        // Handle Inline Editing
        const input = li.querySelector('.store-name-input');
        const btnSave = li.querySelector('.btn-save-name');

        input.addEventListener('focus', () => {
            input.classList.remove('border-transparent');
            input.classList.add('border-gray-300', 'bg-white');
        });

        input.addEventListener('blur', () => {
            // Delay to allow click on save button
            setTimeout(() => {
                if (document.activeElement !== btnSave) {
                    input.classList.add('border-transparent');
                    input.classList.remove('border-gray-300', 'bg-white');
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
        alert('Lütfen mağaza adı giriniz.');
        return;
    }

    try {
        const res = await ipcRenderer.invoke('db-add-store', { name, type });
        if (res.success) {
            inputNewStoreName.value = '';
            await loadStores(); // Refresh global list
            renderManagementList(); // Refresh modal list
            ipcRenderer.send('notify-stores-updated');
        } else {
            alert('Ekleme başarısız: ' + (res.message || ''));
        }
    } catch (err) {
        console.error('Error adding store:', err);
        alert('Bir hata oluştu: ' + err.message);
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
            alert('Güncelleme başarısız: ' + res.message);
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteStore(id, name) {
    if (confirm(`${name} mağazasını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) {
        try {
            const res = await ipcRenderer.invoke('db-delete-store', id);
            if (res.success) {
                await loadStores();
                renderManagementList();
                ipcRenderer.send('notify-stores-updated');
            } else {
                alert('Silme başarısız: ' + res.message);
            }
        } catch (err) {
            console.error(err);
            alert('Bir hata oluştu.');
        }
    }
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
        alert('Bir hata oluştu: ' + err.message);
    }
}
