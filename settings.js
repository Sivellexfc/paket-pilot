
// DOM Elements references
let viewSettings, storeSelect, addStoreBtn, prodSection, addProductBtn, nameInput, barcodeInput, productListBody, productEmptyState;

// Initial Setup
function initializeSettings() {
    log.info('Initializing Settings Module...');

    // Select elements here to ensure they exist
    viewSettings = document.getElementById('view-settings');
    storeSelect = document.getElementById('settings-store-select');
    addStoreBtn = document.getElementById('btn-add-store-prompt');
    prodSection = document.getElementById('settings-product-section');
    addProductBtn = document.getElementById('btn-add-product');
    nameInput = document.getElementById('setting-prod-name');
    barcodeInput = document.getElementById('setting-prod-barcode');
    productListBody = document.getElementById('settings-product-list');
    productEmptyState = document.getElementById('settings-empty-state');

    // Check elements
    if (!storeSelect || !addStoreBtn) {
        log.error('Settings elements not found in DOM');
        return;
    }

    log.info('Attaching listeners to settings elements');

    // Attach Event Listeners
    addStoreBtn.onclick = handleAddStore;
    storeSelect.onchange = handleStoreChange;
    addProductBtn.onclick = handleAddProduct;

    // Load initial data
    loadStores();
}

// Handlers
function handleAddStore() {
    log.info('Add store clicked');
    // Using simple prompt for now as requested, but custom modal is better.
    // If prompt is blocked, we might need a custom modal.
    // Let's force a custom simple modal or use the existing modal structure if possible.
    // Since user says it "doesn't open", maybe prompt is blocked.
    // Let's create a temporary prompt in UI if needed, but first try prompt again with log.

    const name = prompt('Yeni mağaza adını giriniz:');
    if (name && name.trim()) {
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('db-add-store', name.trim()).then(res => {
            if (res.success) {
                loadStores();
            } else {
                alert('Hata: ' + (res.message || 'Mağaza eklenemedi.'));
            }
        });
    }
}

function handleStoreChange(e) {
    const storeId = e.target.value;
    if (storeId) {
        prodSection.classList.remove('hidden');
        loadProducts(storeId);
    } else {
        prodSection.classList.add('hidden');
    }
}

function handleAddProduct() {
    const storeId = storeSelect.value;
    if (!storeId) return;

    const name = nameInput.value.trim();
    const barcode = barcodeInput.value.trim();

    if (!name || !barcode) {
        alert('Ürün Adı ve Barkod zorunludur.');
        return;
    }

    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('db-add-product', { storeId, name, barcode }).then(res => {
        if (res.success) {
            nameInput.value = '';
            barcodeInput.value = '';
            loadProducts(storeId);
        } else {
            alert('Hata: Ürün eklenemedi.');
        }
    });
}

// Data Loading
function loadStores() {
    const { ipcRenderer } = require('electron');
    const currentVal = storeSelect.value;

    ipcRenderer.invoke('db-get-stores').then(stores => {
        // Clear options except first
        while (storeSelect.options.length > 1) {
            storeSelect.remove(1);
        }

        stores.forEach(store => {
            const opt = document.createElement('option');
            opt.value = store.id;
            opt.textContent = store.name;
            storeSelect.add(opt);
        });

        if (currentVal) {
            let exists = Array.from(storeSelect.options).some(o => o.value === currentVal);
            if (exists) storeSelect.value = currentVal;
            else {
                storeSelect.value = "";
                prodSection.classList.add('hidden');
            }
        }
    });
}

function loadProducts(storeId) {
    const { ipcRenderer } = require('electron');

    ipcRenderer.invoke('db-get-products', storeId).then(products => {
        productListBody.innerHTML = '';

        if (products.length === 0) {
            productEmptyState.classList.remove('hidden');
        } else {
            productEmptyState.classList.add('hidden');
        }

        products.forEach(prod => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50/50 transition-colors border-b border-gray-50 last:border-0';

            tr.innerHTML = `
                <td class="px-2 py-2 text-sm text-gray-900 border-r border-gray-100 last:border-r-0 truncate font-medium">${prod.name}</td>
                <td class="px-2 py-2 text-sm text-gray-500 border-r border-gray-100 last:border-r-0 truncate font-mono">${prod.barcode}</td>
                <td class="px-2 py-2 text-sm text-gray-900 border-r border-gray-100 last:border-r-0 text-center">
                    <button class="text-red-500 hover:text-red-700 delete-prod-btn text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors" data-id="${prod.id}">
                        Sil
                    </button>
                </td>
            `;

            productListBody.appendChild(tr);
        });

        // Delete listeners
        const deleteBtns = productListBody.querySelectorAll('.delete-prod-btn');
        deleteBtns.forEach(btn => {
            btn.onclick = (e) => {
                const id = e.target.getAttribute('data-id');
                if (confirm('Ürünü silmek istediğinize emin misiniz?')) {
                    ipcRenderer.invoke('db-delete-product', id).then(res => {
                        if (res.success) {
                            loadProducts(storeId);
                        }
                    });
                }
            };
        });
    });
}

// Export initialization checking if we are using modules, but since we are in Electron renderer, 
// we can just attach to window or call it.
// Exporting for use in main renderer file.
module.exports = { initializeSettings };
