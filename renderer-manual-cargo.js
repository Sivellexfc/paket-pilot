
// ==========================================
// MANUAL CARGO ENTRY LOGIC V2
// ==========================================
const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const btnManualCargoAdd = document.getElementById('btn-manual-cargo-add-v2');
    const manualCargoModal = document.getElementById('manual-cargo-modal-v2');
    const btnCloseManualModal = document.getElementById('btn-close-manual-modal-v2');
    const btnSaveManualCargo = document.getElementById('btn-save-manual-cargo-v2');
    const btnAddManualRow = document.getElementById('btn-add-manual-row-v2');
    const manualCargoTableBody = document.getElementById('manual-cargo-table-body-v2');
    const manualCargoModalBackdrop = document.getElementById('manual-cargo-modal-backdrop-v2');

    if (btnManualCargoAdd) {
        // Check Visibility when store is loaded
        const storeVisibilityCheck = setInterval(() => {
            if (typeof currentStore !== 'undefined' && currentStore) {
                const isTrendyol = (currentStore.store_type || 'website').toLowerCase() === 'trendyol';
                if (isTrendyol) {
                    btnManualCargoAdd.classList.add('hidden');
                } else {
                    btnManualCargoAdd.classList.remove('hidden');
                }
                clearInterval(storeVisibilityCheck); // Run once after store is found
            }
        }, 500);

        btnManualCargoAdd.addEventListener('click', () => {
            // currentStore renderer.js dosyasından gelmeli.
            // Eğer undefined ise, store seçilmemiş demektir.
            if (typeof currentStore === 'undefined' || !currentStore) {
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
        tr.className = "hover:bg-gray-50 transition-colors";
        tr.innerHTML = `
            <td class="px-2 py-2 align-middle">
                <input type="text" class="manual-product-name w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 transition-shadow shadow-sm" placeholder="Ürün Adı Giriniz">
            </td>
            <td class="px-2 py-2 align-middle">
                <input type="number" class="manual-package-count w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 transition-shadow shadow-sm" placeholder="0">
            </td>
            <td class="px-2 py-2 align-middle">
                <input type="number" class="manual-quantity w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 transition-shadow shadow-sm" placeholder="0">
            </td>
            <td class="px-2 py-2 text-center align-middle whitespace-nowrap w-10">
                <button type="button" class="group flex items-center justify-center w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1" onclick="this.closest('tr').remove()" title="Bu satırı sil">
                    <svg class="w-4 h-4 transform group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </td>
        `;
        manualCargoTableBody.appendChild(tr);
    }

    if (btnSaveManualCargo) {
        btnSaveManualCargo.addEventListener('click', async () => {
            if (typeof currentStore === 'undefined' || !currentStore) return;

            const rows = manualCargoTableBody.querySelectorAll('tr');
            const entries = [];
            let hasError = false;
            let errorMessage = '';

            for (const row of rows) {
                const productNameInput = row.querySelector('.manual-product-name');
                const packageCountInput = row.querySelector('.manual-package-count');
                const quantityInput = row.querySelector('.manual-quantity');

                if (!productNameInput || !packageCountInput || !quantityInput) continue;

                // Reset Validations
                productNameInput.classList.remove('border-red-500', 'ring-1', 'ring-red-500');
                packageCountInput.classList.remove('border-red-500', 'ring-1', 'ring-red-500');
                quantityInput.classList.remove('border-red-500', 'ring-1', 'ring-red-500');

                const productName = productNameInput.value.trim();
                const packageCountStr = packageCountInput.value.trim();
                const quantityStr = quantityInput.value.trim();

                // Skip completely empty rows
                if (!productName && packageCountStr === '' && quantityStr === '') continue;

                // Validate Product Name
                if (!productName) {
                    hasError = true;
                    errorMessage = 'Ürün adı boş bırakılamaz.';
                    productNameInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                    break;
                }

                // Validate Package Count
                if (packageCountStr === '') {
                    hasError = true;
                    errorMessage = 'Paket sayısı girilmelidir.';
                    packageCountInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                    break;
                }

                // Validate Quantity
                if (quantityStr === '') {
                    hasError = true;
                    errorMessage = 'Adet sayısı girilmelidir.';
                    quantityInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                    break;
                }

                const packageCount = parseInt(packageCountStr);
                const quantity = parseInt(quantityStr);
                const barcode = "";

                entries.push({ productName, packageCount, quantity, barcode });
            }

            if (hasError) {
                showAlert(errorMessage, 'warning');
                return;
            }

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
            }
        });
    }
});
