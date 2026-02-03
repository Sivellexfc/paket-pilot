const { ipcRenderer } = require('electron');

const listBody = document.getElementById('store-list');
const btnAdd = document.getElementById('btn-add-store');
const modal = document.getElementById('store-modal');
const btnSave = document.getElementById('btn-modal-save');
const btnCancel = document.getElementById('btn-modal-cancel');
const nameInput = document.getElementById('modal-store-name');
const idInput = document.getElementById('modal-store-id');
const modalTitle = document.getElementById('modal-title');

document.addEventListener('DOMContentLoaded', () => {
    loadStores();

    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            openModal();
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', saveStore);
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', closeModal);
    }
});

function loadStores() {
    listBody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">Yükleniyor...</td></tr>';

    ipcRenderer.invoke('db-get-stores').then(stores => {
        if (stores.length === 0) {
            listBody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">Kayıtlı mağaza yok.</td></tr>';
            return;
        }

        listBody.innerHTML = '';
        stores.forEach(store => {
            const tr = document.createElement('tr');

            const created = store.created_at ? new Date(store.created_at).toLocaleString('tr-TR') : '-';
            const apiKeyDisplay = 'Gizli'; // Request says not to show it/edit it.

            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${store.name}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 italic">${apiKeyDisplay}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${created}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button class="text-blue-600 hover:text-blue-900 mr-3 edit-btn" data-id="${store.id}" data-name="${store.name}">Düzenle</button>
                    <button class="text-red-600 hover:text-red-900 delete-btn" data-id="${store.id}">Sil</button>
                </td>
            `;
            listBody.appendChild(tr);
        });

        // Attach listeners
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                const name = e.target.getAttribute('data-name');
                openModal(id, name);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                if (confirm('Mağazayı silmek istediğinize emin misiniz?')) {
                    ipcRenderer.invoke('db-delete-store', id).then(res => {
                        if (res.success) {
                            loadStores();
                            // Notify main window to refresh? 
                            // Since this is a separate window, we might rely on the main window reloading manually or we send a broadcast.
                            // For now, standalone management is fine.
                        } else {
                            alert('Hata: ' + res.message);
                        }
                    });
                }
            });
        });
    });
}

function openModal(id = null, name = '') {
    idInput.value = id || '';
    nameInput.value = name || '';
    modalTitle.textContent = id ? 'Mağaza Düzenle' : 'Yeni Mağaza Ekle';

    modal.classList.remove('hidden');
    nameInput.focus();
}

function closeModal() {
    modal.classList.add('hidden');
}

function saveStore() {
    const name = nameInput.value.trim();
    const id = idInput.value;

    if (!name) {
        alert('Lütfen mağaza adı giriniz.');
        return;
    }

    if (id) {
        // Update
        ipcRenderer.invoke('db-update-store', { id, name }).then(res => {
            if (res.success) {
                closeModal();
                loadStores();
            } else {
                alert('Güncelleme başarısız: ' + (res.message || ''));
            }
        });
    } else {
        // Create
        ipcRenderer.invoke('db-add-store', name).then(res => {
            if (res.success) {
                closeModal();
                loadStores();
            } else {
                alert('Ekleme başarısız: ' + (res.message || 'Store already exists?'));
            }
        });
    }
}
