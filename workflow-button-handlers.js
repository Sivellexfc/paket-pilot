// ===== WORKFLOW BUTTON HANDLERS =====
// Add this code to renderer.js after the DOMContentLoaded section

// Get button references
const btnStartPreparation = document.getElementById('btn-start-preparation');
const btnMarkShipped = document.getElementById('btn-mark-shipped');

// Track preparation state
let isPreparationStarted = false;

// Hazırlamaya Başla Button Handler
if (btnStartPreparation) {
    btnStartPreparation.addEventListener('click', () => {
        if (isPreparationStarted) return; // Already started

        // Update button state
        isPreparationStarted = true;
        btnStartPreparation.disabled = true;
        btnStartPreparation.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btnStartPreparation.classList.add('bg-gray-400', 'cursor-not-allowed');
        btnStartPreparation.innerHTML = `
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Hazırlanmaya Başlandı
        `;

        log.info('Preparation started');
    });
}

// Kargolar Kargoya Verildi Button Handler
if (btnMarkShipped) {
    btnMarkShipped.addEventListener('click', async () => {
        if (!currentStore) {
            alert('Lütfen önce bir mağaza seçiniz.');
            return;
        }

        // Validate that target table has at least one complete row
        const targetData = importedDataState['target'];
        if (!targetData || targetData.length < 2) {
            alert('Kargo durumları tablosunda en az bir satır olmalıdır.');
            return;
        }

        // Check if all fields in at least one row are filled
        const headers = targetData[0];
        let hasCompleteRow = false;

        for (let i = 1; i < targetData.length; i++) {
            const row = targetData[i];
            const isComplete = row.every((cell, index) => {
                // Skip hidden meta columns
                if (headers[index] && headers[index].toString().startsWith('__meta')) {
                    return true;
                }
                // Check if cell has value
                return cell !== null && cell !== undefined && cell.toString().trim() !== '';
            });

            if (isComplete) {
                hasCompleteRow = true;
                break;
            }
        }

        if (!hasCompleteRow) {
            alert('Kargo durumları tablosunda en az bir satırın tüm alanları dolu olmalıdır.');
            return;
        }

        const confirmed = confirm('Kargolar kargoya verildi olarak işaretlenecek. Devam etmek istiyor musunuz?');
        if (!confirmed) return;

        try {
            // Save Target (Kargo Durumları) to daily archive
            const archiveType = 'cargo';
            await saveToDailyArchive(archiveType, targetData);

            // CRITICAL: Filter and save ONLY cancelled orders (DURUM = "Düştü")
            const cancelsData = importedDataState['cancels'];
            if (cancelsData && cancelsData.length > 1) {
                const headers = cancelsData[0];

                // Find DURUM column index
                const durumIndex = headers.findIndex(h => h && h.toString().toLowerCase().trim() === 'durum');

                if (durumIndex !== -1) {
                    // Filter: Keep only rows where DURUM = "Düştü"
                    const onlyDroppedOrders = [headers]; // Start with headers

                    for (let i = 1; i < cancelsData.length; i++) {
                        const row = cancelsData[i];
                        const durum = row[durumIndex];

                        if (durum && durum.toString().trim() === 'Düştü') {
                            onlyDroppedOrders.push(row);
                        }
                    }

                    // Save only if there are dropped orders
                    if (onlyDroppedOrders.length > 1) {
                        await saveToDailyArchive('cancels', onlyDroppedOrders);
                        log.info(`Saved ${onlyDroppedOrders.length - 1} dropped orders to daily archive`);
                    } else {
                        log.info('No dropped orders to save');
                    }
                } else {
                    log.warn('DURUM column not found in cancels data');
                }
            }

            alert('Kargolar başarıyla kaydedildi.');
            log.info('Cargo data saved to daily archive');

            // Reset preparation state
            isPreparationStarted = false;
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

        } catch (error) {
            console.error('Kargolama hatası:', error);
            alert('Bir hata oluştu: ' + error.message);
        }
    });
}
