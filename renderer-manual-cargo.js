
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
                alert('Lütfen önce bir mağaza seçiniz.');
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
                alert('Lütfen en az bir satır veri giriniz.');
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
                    alert(`${result.count} adet kayıt başarıyla eklendi.`);
                    closeManualCargoModal();
                } else {
                    alert('Kayıt sırasında bir hata oluştu.');
                }
            } catch (error) {
                console.error('Save error:', error);
                alert('Hata: ' + error.message);
            } finally {
                btnSaveManualCargo.disabled = false;
                btnSaveManualCargo.textContent = 'Kaydet';
            }
        });
    }
});
