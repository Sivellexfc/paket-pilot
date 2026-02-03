
// ===== ORDER WORKFLOW BUTTONS =====
// Add these event listeners to renderer.js

// Get button references
const btnStartPreparation = document.getElementById('btn-start-preparation');
const btnMarkShipped = document.getElementById('btn-mark-shipped');

// Hazırlamaya Başla Button Handler
if (btnStartPreparation) {
    btnStartPreparation.addEventListener('click', async () => {
        if (!currentStore) {
            alert('Lütfen önce bir mağaza seçiniz.');
            return;
        }

        // TODO: Get selected orders from the table
        // For now, this is a placeholder
        const confirmed = confirm('Seçili siparişleri hazırlamaya başlamak istediğinize emin misiniz?');
        if (!confirmed) return;

        try {
            // TODO: Implement order selection logic
            // const selectedOrderIds = getSelectedOrderIds();

            // Update status to 'preparing'
            // const { ipcRenderer } = require('electron');
            // const result = await ipcRenderer.invoke('orders-update-status', {
            //     orderIds: selectedOrderIds,
            //     status: 'preparing'
            // });

            // if (result.success) {
            //     alert(`${result.changes} sipariş hazırlık moduna alındı.`);
            //     // Refresh the table
            //     await loadTrendyolOrders();
            // }

            alert('Bu özellik henüz tamamlanmadı. Sipariş seçimi ve durum güncelleme mantığı eklenecek.');
        } catch (error) {
            console.error('Hazırlık başlatma hatası:', error);
            alert('Bir hata oluştu: ' + error.message);
        }
    });
}

// Kargolar Kargoya Verildi Button Handler
if (btnMarkShipped) {
    btnMarkShipped.addEventListener('click', async () => {
        if (!currentStore) {
            alert('Lütfen önce bir mağaza seçiniz.');
            return;
        }

        const confirmed = confirm('Hazırlanan kargolar kargoya verildi olarak işaretlenecek ve iptal kontrolü yapılacak. Devam etmek istiyor musunuz?');
        if (!confirmed) return;

        try {
            const { ipcRenderer } = require('electron');

            // TODO: Get prepared orders
            // const preparedOrderIds = getPreparedOrderIds();

            // Step 1: Mark as shipped
            // const shipResult = await ipcRenderer.invoke('orders-update-status', {
            //     orderIds: preparedOrderIds,
            //     status: 'shipped'
            // });

            // Step 2: Sync with API to detect cancellations
            // await syncTrendyolOrders();

            // alert(`${shipResult.changes} sipariş kargoya verildi olarak işaretlendi.`);

            alert('Bu özellik henüz tamamlanmadı. Kargolama ve iptal kontrolü mantığı eklenecek.');
        } catch (error) {
            console.error('Kargolama hatası:', error);
            alert('Bir hata oluştu: ' + error.message);
        }
    });
}

// ===== TRENDYOL ORDER SYNC FUNCTION =====
// This function should be called periodically and when marking as shipped

async function syncTrendyolOrders() {
    if (!currentStore) return;

    try {
        const { ipcRenderer } = require('electron');

        // Fetch orders from Trendyol API
        const apiResult = await ipcRenderer.invoke('fetch-trendyol-orders', currentStore.id);

        if (!apiResult.success) {
            console.error('API fetch failed:', apiResult.message);
            return;
        }

        const apiOrders = apiResult.data || [];

        // Sync to database
        await ipcRenderer.invoke('orders-sync-from-api', {
            storeId: currentStore.id,
            orders: apiOrders.map(order => ({
                orderNumber: order['Sipariş Numarası'],
                packageNumber: order['Paket No'],
                productName: order['Ürün Adı'],
                barcode: order['Barkod'],
                quantity: order['Adet'],
                status: 'waiting' // New orders are waiting
            }))
        });

        // Detect cancellations
        const orderNumbers = apiOrders.map(o => o['Sipariş Numarası']);
        const cancelResult = await ipcRenderer.invoke('orders-detect-cancellations', {
            storeId: currentStore.id,
            currentOrderNumbers: orderNumbers
        });

        if (cancelResult.success && cancelResult.cancelled.length > 0) {
            log.info(`Detected ${cancelResult.cancelled.length} cancelled orders`);
            // TODO: Highlight cancelled orders in UI
            highlightCancelledOrders(cancelResult.cancelled);
        }

        return { success: true, orders: apiOrders, cancelled: cancelResult.cancelled };
    } catch (error) {
        console.error('Sync error:', error);
        return { success: false, error: error.message };
    }
}

// Highlight cancelled orders in the UI
function highlightCancelledOrders(cancelledOrders) {
    cancelledOrders.forEach(order => {
        // TODO: Find the row in the table and highlight it
        // const row = document.querySelector(`[data-order-id="${order.id}"]`);
        // if (row) {
        //     row.classList.add('bg-red-50');
        //     row.querySelector('.status-cell').textContent = 'İptal Edildi';
        //     // Disable action buttons
        //     row.querySelectorAll('input, button').forEach(el => el.disabled = true);
        // }

        log.info(`Order ${order.order_number} was cancelled at stage: ${order.cancel_stage}`);
    });
}

// Periodic sync (every 5 minutes)
setInterval(async () => {
    if (currentStore) {
        await syncTrendyolOrders();
    }
}, 5 * 60 * 1000);
