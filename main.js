const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const sqlite3 = require('sqlite3').verbose()
const log = require('electron-log');

log.info("Veritabanı Yolu:", path.join(app.getPath('userData'), 'stok-takip.db'));

let selectorWindow = null; // Store selector window
let storeWindows = new Map(); // Map of storeId -> BrowserWindow

log.info('Bu mesaj hem dosyaya yazılır hem de konsola basılır');

require('electron-reload')(__dirname, {
    // CSS değişimlerinde Hard Reset atmadan yumuşak geçiş yapması için:
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
});

// Database Setup
const dbPath = path.join(app.getPath('userData'), 'stok-takip.db')
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database opening error: ', err.message)
    } else {
        console.log('Connected to the SQLite database.')
        initializeTables()
    }
})

function initializeTables() {
    db.serialize(() => {
        // Table to track import sessions/files
        db.run(`CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER,
      filename TEXT NOT NULL,
      side TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)

        // Updated table to link to batch
        db.run(`CREATE TABLE IF NOT EXISTS imported_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER,
      row_data TEXT NOT NULL,
      FOREIGN KEY(batch_id) REFERENCES import_batches(id)
    )`)
        // Stores Table
        db.run(`CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      store_type TEXT DEFAULT 'website',
      api_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)



        // Daily Entries Table (For Kargo/Cancels dynamic logging)
        db.run(`CREATE TABLE IF NOT EXISTS daily_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER,
      type TEXT NOT NULL, -- 'cargo' or 'cancel'
      entry_date TEXT NOT NULL, -- YYYY-MM-DD
      data TEXT NOT NULL, -- JSON string
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)

        // Orders Table (For tracking Trendyol orders and their lifecycle)
        db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      package_number TEXT,
      product_name TEXT,
      barcode TEXT,
      quantity INTEGER,
      status TEXT NOT NULL, -- 'waiting', 'preparing', 'shipped', 'cancelled'
      cancel_stage TEXT, -- 'before_prep', 'during_prep', 'after_ship'
      is_returned BOOLEAN DEFAULT 0,
      order_data TEXT, -- JSON string with full order details
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
    )`)

        // Other Stores Cargo Info Table (Manual Entry)
        db.run(`CREATE TABLE IF NOT EXISTS other_stores_cargo_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      product_name TEXT,
      package_count INTEGER,
      quantity INTEGER,
      barcode TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
    )`)

        performMigrations();
    })
}

function performMigrations() {
    // Add store_id to import_batches if not exists
    db.all("PRAGMA table_info(import_batches)", (err, rows) => {
        if (!err && rows) {
            const hasStoreId = rows.some(r => r.name === 'store_id');
            if (!hasStoreId) {
                db.run("ALTER TABLE import_batches ADD COLUMN store_id INTEGER", (err) => {
                    if (err) console.error("Migration error (import_batches):", err.message);
                    else console.log("Added store_id to import_batches");
                });
            }
        }
    });

    // Add store_id to daily_entries if not exists
    db.all("PRAGMA table_info(daily_entries)", (err, rows) => {
        if (!err && rows) {
            const hasStoreId = rows.some(r => r.name === 'store_id');
            if (!hasStoreId) {
                db.run("ALTER TABLE daily_entries ADD COLUMN store_id INTEGER", (err) => {
                    if (err) console.error("Migration error (daily_entries):", err.message);
                    else console.log("Added store_id to daily_entries");
                });
            }
        }
    });

    // Add api_key and created_at to stores if not exists
    db.all("PRAGMA table_info(stores)", (err, rows) => {
        if (!err && rows) {
            const hasApiKey = rows.some(r => r.name === 'api_key');
            if (!hasApiKey) {
                db.run("ALTER TABLE stores ADD COLUMN api_key TEXT", (err) => {
                    if (err) console.error("Migration error (stores api_key):", err.message);
                    else console.log("Added api_key to stores");
                });
            }

            const hasSellerId = rows.some(r => r.name === 'seller_id');
            if (!hasSellerId) {
                db.run("ALTER TABLE stores ADD COLUMN seller_id TEXT", (err) => {
                    if (err) console.error("Migration error (stores seller_id):", err.message);
                    else console.log("Added seller_id to stores");
                });
            }

            const hasApiSecret = rows.some(r => r.name === 'api_secret');
            if (!hasApiSecret) {
                db.run("ALTER TABLE stores ADD COLUMN api_secret TEXT", (err) => {
                    if (err) console.error("Migration error (stores api_secret):", err.message);
                    else console.log("Added api_secret to stores");
                });
            }

            const hasCreatedAt = rows.some(r => r.name === 'created_at');
            if (!hasCreatedAt) {
                db.run("ALTER TABLE stores ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP", (err) => {
                    if (err) console.error("Migration error (stores created_at):", err.message);
                    else console.log("Added created_at to stores");
                });
            }

            const hasStoreType = rows.some(r => r.name === 'store_type');
            if (!hasStoreType) {
                db.run("ALTER TABLE stores ADD COLUMN store_type TEXT DEFAULT 'website'", (err) => {
                    if (err) console.error("Migration error (stores store_type):", err.message);
                    else console.log("Added store_type to stores");
                });
            }

            // USER REQUEST: Update all existing stores to 'trendyol'
            db.run("UPDATE stores SET store_type = 'trendyol'", (err) => {
                if (!err) console.log("All stores updated to Trendyol type");
            });
        }
    });
}

// IPC Handlers
ipcMain.handle('fetch-trendyol-orders', async (event, storeId) => {
    return new Promise(async (resolve, reject) => {
        if (!storeId) {
            resolve({ success: false, message: 'Store ID required' })
            return
        }

        // Get Credentials
        db.get('SELECT api_key, api_secret, seller_id FROM stores WHERE id = ?', [storeId], async (err, row) => {
            if (err) {
                resolve({ success: false, message: 'Database error: ' + err.message })
                return
            }
            if (!row || !row.seller_id || (!row.api_key && !row.api_secret)) {
                resolve({ success: false, message: 'API Credentials missing for this store.' })
                return
            }

            const { api_key, api_secret, seller_id } = row
            log.info(api_key, api_secret, seller_id)

            // Bugünün tarihini al (UNIX timestamp - milisaniye cinsinden)
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Günün başlangıcı
            const startDate = today.getTime(); // Bugünün başlangıcı

            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999); // Günün sonu
            const endDate = endOfDay.getTime(); // Bugünün sonu

            const url = `https://api.trendyol.com/sapigw/suppliers/${seller_id}/orders?status=Picking&startDate=${startDate}&endDate=${endDate}&orderBy=Date&direction=DESC&size=200`

            try {
                // Determine headers
                // Logic: 
                // If api_secret exists: assume Basic Auth: base64(apiKey:apiSecret)
                // If only api_key exists: assume Basic Auth: base64(apiKey) or base64(apiKey:)

                const appName = "BenimStokUygulamam";
                const authString = `${api_key}:${api_secret}`;
                const encodedAuth = Buffer.from(authString).toString('base64');

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${encodedAuth}`,
                        'User-Agent': `${seller_id} - ${appName}`
                    }
                })
                log.info('API Status Code:', response.status, response.statusText);
                if (!response.ok) {
                    const errorText = await response.text()
                    resolve({ success: false, message: `API Error: ${response.status} - ${errorText}` })
                    return
                }

                const data = await response.json()

                // Parse and Map
                // Expected output: Array of objects with keys matching table columns or similar
                // The renderer expects "rows" usually as objects or arrays? 
                // The `save-excel-data` handler takes `data` which is array of objects.
                // We will return array of objects matching the CSV structure.

                const mappedRows = []

                if (data.content && Array.isArray(data.content)) {
                    data.content.forEach(pkg => {
                        if (pkg.lines && Array.isArray(pkg.lines)) {
                            pkg.lines.forEach(line => {
                                mappedRows.push({
                                    'Paket No': pkg.id,
                                    'Sipariş Numarası': pkg.orderNumber,
                                    'Sipariş Statüsü': pkg.status,
                                    'İl': pkg.shipmentAddress ? pkg.shipmentAddress.city : '',
                                    'Teslimat Adresi': pkg.shipmentAddress ? pkg.shipmentAddress.fullAddress : '',
                                    'Ürün Adı': line.productName,
                                    'Barkod': line.barcode,
                                    'Adet': line.quantity,
                                    'Birim Fiyatı': line.amount
                                })
                            })
                        }
                    })
                }

                resolve({ success: true, data: mappedRows })

            } catch (error) {
                resolve({ success: false, message: 'Request Failed: ' + error.message })
            }
        })
    })
})

ipcMain.handle('save-excel-data', async (event, { storeId, side, data, filename }) => {
    return new Promise((resolve, reject) => {
        if (!data || !Array.isArray(data) || data.length === 0) {
            resolve({ success: false, message: 'No data to save' })
            return
        }

        if (!storeId) {
            resolve({ success: false, message: 'Store ID required' })
            return
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION')

            // 1. Create a Batch Record
            const stmtBatch = db.prepare('INSERT INTO import_batches (store_id, filename, side) VALUES (?, ?, ?)')
            stmtBatch.run(storeId, filename || 'Unknown File', side, function (err) {
                if (err) {
                    db.run('ROLLBACK')
                    reject(err)
                    return
                }

                const batchId = this.lastID

                // 2. Insert Rows
                const stmtRows = db.prepare('INSERT INTO imported_data (batch_id, row_data) VALUES (?, ?)')
                data.forEach(row => {
                    stmtRows.run(batchId, JSON.stringify(row))
                })
                stmtRows.finalize()

                db.run('COMMIT', (err) => {
                    if (err) reject(err)
                    else resolve({ success: true, batchId })
                })
            })
            stmtBatch.finalize()
        })
    })
})

ipcMain.handle('get-import-history', async (event, { side, storeId }) => {
    return new Promise((resolve, reject) => {
        let query = 'SELECT * FROM import_batches WHERE side = ?';
        let params = [side];

        if (storeId) {
            query += ' AND store_id = ?';
            params.push(storeId);
        }

        query += ' ORDER BY created_at DESC';

        db.all(query, params, (err, rows) => {
            if (err) reject(err)
            else resolve(rows)
        })
    })
})

ipcMain.handle('load-batch-data', async (event, batchId) => {
    return new Promise((resolve, reject) => {
        db.all('SELECT row_data FROM imported_data WHERE batch_id = ?', [batchId], (err, rows) => {
            if (err) reject(err)
            else {
                // Parse JSON strings back to objects/arrays
                const parsedRows = rows.map(r => JSON.parse(r.row_data))
                resolve(parsedRows)
            }
        })
    })
})

// Store & Product IPC Handlers
ipcMain.handle('db-add-store', async (event, { name, type }) => {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO stores (name, store_type) VALUES (?, ?)', [name, type], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    resolve({ success: false, message: 'Store already exists' })
                } else {
                    reject(err)
                }
            } else {
                resolve({ success: true, id: this.lastID })
            }
        })
    })
})

ipcMain.handle('db-get-stores', async () => {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM stores ORDER BY name ASC', (err, rows) => {
            if (err) reject(err)
            else resolve(rows)
        })
    })
})



// ... existing code ...

let storesWindow = null;

function createStoresWindow() {
    if (storesWindow && !storesWindow.isDestroyed()) {
        storesWindow.focus();
        return;
    }

    storesWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        title: 'Mağazalar Yönetimi',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true
    });

    storesWindow.loadFile('stores.html');

    storesWindow.on('closed', () => {
        storesWindow = null;
        // Notify main window to refresh sidebar when management closes, just in case
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('stores-updated');
        }
    });
}

ipcMain.handle('open-stores-window', () => {
    createStoresWindow();
    return { success: true };
});

// Open a store-specific window
ipcMain.handle('open-store-window', async (event, storeId) => {
    if (!storeId) {
        return { success: false, message: 'Store ID is required' };
    }

    // Check if already open
    if (storeWindows.has(storeId)) {
        const existingWindow = storeWindows.get(storeId);
        if (!existingWindow.isDestroyed()) {
            existingWindow.focus();
            return { success: false, message: 'Bu mağaza zaten açık' };
        }
    }

    createStoreWindow(storeId);
    return { success: true };
});

// Get list of opened store IDs
ipcMain.handle('get-opened-stores', async () => {
    const openedStoreIds = [];
    storeWindows.forEach((window, storeId) => {
        if (!window.isDestroyed()) {
            openedStoreIds.push(storeId);
        }
    });
    return openedStoreIds;
});

// Notify all windows about store updates
ipcMain.on('notify-stores-updated', () => {
    // Notify selector window
    if (selectorWindow && !selectorWindow.isDestroyed()) {
        selectorWindow.webContents.send('stores-updated');
    }

    // Notify all store windows
    storeWindows.forEach((window) => {
        if (!window.isDestroyed()) {
            window.webContents.send('stores-updated');
        }
    });

    // Notify stores management window if open
    if (storesWindow && !storesWindow.isDestroyed()) {
        storesWindow.webContents.send('stores-updated');
    }
});

// Close all store windows (called when selector window is closing)
ipcMain.on('close-all-store-windows', () => {
    storeWindows.forEach((window, storeId) => {
        if (!window.isDestroyed()) {
            window.close();
        }
    });
    storeWindows.clear();
});



ipcMain.handle('db-update-store-integration', async (event, { id, apiKey, apiSecret, sellerId }) => {
    return new Promise((resolve, reject) => {
        db.run('UPDATE stores SET api_key = ?, api_secret = ?, seller_id = ? WHERE id = ?', [apiKey, apiSecret, sellerId, id], function (err) {
            if (err) reject(err)
            else resolve({ success: true })
        })
    })
})

ipcMain.handle('db-update-store', async (event, { id, name }) => {
    return new Promise((resolve, reject) => {
        db.run('UPDATE stores SET name = ? WHERE id = ?', [name, id], function (err) {
            if (err) reject(err)
            else resolve({ success: true })
        })
    })
})

ipcMain.handle('db-get-store', async (event, id) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM stores WHERE id = ?', [id], (err, row) => {
            if (err) reject(err)
            else resolve(row)
        })
    })
})

ipcMain.handle('db-save-manual-cargo-entry', async (event, { storeId, entries }) => {
    return new Promise((resolve, reject) => {
        if (!storeId || !entries || !Array.isArray(entries)) {
            return reject(new Error('Invalid inputs'));
        }

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare("INSERT INTO other_stores_cargo_info (store_id, product_name, package_count, quantity, barcode) VALUES (?, ?, ?, ?, ?)");

            try {
                for (const entry of entries) {
                    stmt.run(storeId, entry.productName, entry.packageCount, entry.quantity, entry.barcode);
                }
                stmt.finalize();
                db.run("COMMIT", (err) => {
                    if (err) reject(err);
                    else resolve({ success: true, count: entries.length });
                });
            } catch (err) {
                db.run("ROLLBACK");
                reject(err);
            }
        });
    });
})

ipcMain.handle("db-delete-batch", async (event, batchId) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION")
            // Delete imported_data linked to batch first (handled by FK cascade if enabled, but manual is safer here if not)
            db.run("DELETE FROM imported_data WHERE batch_id = ?", [batchId])
            db.run("DELETE FROM import_batches WHERE id = ?", [batchId], function (err) {
                if (err) {
                    db.run("ROLLBACK")
                    reject(err)
                } else {
                    db.run("COMMIT")
                    resolve({ success: true })
                }
            })
        })
    })
})

// Daily Entries Handlers
ipcMain.handle("param-add-daily-entry", async (event, { storeId, type, date, data }) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT INTO daily_entries (store_id, type, entry_date, data) VALUES (?, ?, ?, ?)")
        stmt.run(storeId, type, date, JSON.stringify(data), function (err) {
            if (err) reject(err)
            else resolve({ success: true, id: this.lastID })
        })
        stmt.finalize()
    })
})

ipcMain.handle("param-update-daily-entry", async (event, { id, data }) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE daily_entries SET data = ? WHERE id = ?", [JSON.stringify(data), id], function (err) {
            if (err) reject(err)
            else resolve({ success: true })
        })
    })
})

ipcMain.handle("param-delete-daily-entry", async (event, id) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM daily_entries WHERE id = ?", [id], function (err) {
            if (err) reject(err)
            else resolve({ success: true })
        })
    })
})

ipcMain.handle("get-shipped-order-numbers", async (event, storeId) => {
    return new Promise((resolve, reject) => {
        if (!storeId) {
            resolve([]);
            return;
        }
        // Fetch ALL cargo entries for this store
        // We only need the DATA column.
        const query = "SELECT data FROM daily_entries WHERE store_id = ? AND type = 'cargo'";
        db.all(query, [storeId], (err, rows) => {
            if (err) {
                log.error("Error fetching shipped orders:", err);
                resolve([]); // Fail gracefully by returning empty
                return;
            }
            log.info(`[Main] Shipped Check: Found ${rows.length} cargo archive entries.`);
            const shippedOrders = new Set();

            rows.forEach(row => {
                try {
                    const data = JSON.parse(row.data);
                    if (Array.isArray(data) && data.length > 1) {
                        // Find Order Number Index in this specfic archive entry
                        const headers = data[0];
                        const orderNoIdx = headers.findIndex(h =>
                            h && (h.toString().toLowerCase().includes('sipariş no') ||
                                h.toString().toLowerCase().includes('sipariş numarası') ||
                                h.toString().toLowerCase().includes('siparis numara')
                            )
                        );

                        if (orderNoIdx !== -1) {
                            // Iterate rows
                            for (let i = 1; i < data.length; i++) {
                                const val = data[i][orderNoIdx];
                                if (val) shippedOrders.add(val.toString().trim());
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error parsing archive JSON for shipped check", e);
                }
            });

            console.log(`[Main] Shipped Check: Collected ${shippedOrders.size} unique order numbers.`);
            if (shippedOrders.size > 0) {
                console.log(`[Main] Example Order Numbers: ${Array.from(shippedOrders).slice(0, 3).join(', ')}`);
            }
            resolve(Array.from(shippedOrders));
        });
    });
});

ipcMain.handle("param-get-daily-entries", async (event, { storeId, date, type }) => {
    return new Promise((resolve, reject) => {
        let query = "SELECT * FROM daily_entries WHERE entry_date = ?"
        let params = [date]

        if (storeId) {
            query += " AND store_id = ?"
            params.push(storeId)
        }

        if (type) {
            query += " AND type = ?"
            params.push(type)
        }
        query += " ORDER BY id DESC"
        db.all(query, params, (err, rows) => {
            if (err) reject(err)
            else {
                // Parse JSON
                const parsed = rows.map(r => ({ ...r, data: JSON.parse(r.data) }))
                resolve(parsed)
            }
        })
    })
})

ipcMain.handle("param-get-daily-entries-range", async (event, { storeId, startDate, endDate, type }) => {
    return new Promise((resolve, reject) => {
        let query = "SELECT * FROM daily_entries WHERE entry_date >= ? AND entry_date <= ?"
        let params = [startDate, endDate]

        if (storeId) {
            query += " AND store_id = ?"
            params.push(storeId)
        }

        if (type && type !== 'all') {
            query += " AND type = ?"
            params.push(type)
        }

        query += " ORDER BY entry_date DESC, id DESC"

        db.all(query, params, (err, rows) => {
            if (err) reject(err)
            else {
                // Parse JSON
                const parsed = rows.map(r => {
                    try {
                        return { ...r, data: JSON.parse(r.data) };
                    } catch (e) {
                        return { ...r, data: [] };
                    }
                })
                resolve(parsed)
            }
        })
    })
})






ipcMain.handle('param-remove-order-from-entry', async (event, { entryId, orderNo }) => {
    return new Promise((resolve, reject) => {
        // 1. Get Entry
        db.get('SELECT * FROM daily_entries WHERE id = ?', [entryId], (err, row) => {
            if (err) {
                resolve({ success: false, message: err.message });
                return;
            }
            if (!row) {
                resolve({ success: false, message: 'Entry not found' });
                return;
            }

            let data;
            try {
                data = JSON.parse(row.data);
            } catch (e) {
                resolve({ success: false, message: 'Invalid data format' });
                return;
            }

            if (!Array.isArray(data) || data.length < 2) {
                // Already empty or just header, maybe delete?
                db.run('DELETE FROM daily_entries WHERE id = ?', [entryId], (delErr) => {
                    resolve({ success: true, deleted: true });
                });
                return;
            }

            const headers = data[0];
            const orderIdx = headers.findIndex(h => h && (
                h.toString().toLowerCase().includes('sipariş no') ||
                h.toString().toLowerCase().includes('sipariş numara') ||
                h.toString().toLowerCase().includes('order no') ||
                h.toString().toLowerCase().includes('order num') ||
                h.toString().toLowerCase().includes('siparis numarası')
            ));

            if (orderIdx === -1) {
                resolve({ success: false, message: 'Order number column not found in entry' });
                return;
            }

            // Filter
            const newData = [headers];
            let found = false;
            for (let i = 1; i < data.length; i++) {
                const rowVal = data[i][orderIdx];
                if (rowVal && rowVal.toString().trim() === orderNo.toString().trim()) {
                    found = true;
                    // Skip (Delete)
                } else {
                    newData.push(data[i]);
                }
            }

            if (!found) {
                resolve({ success: true, message: 'Order not found in this entry, nothing changed.' });
                return;
            }

            // If empty now
            if (newData.length < 2) {
                db.run('DELETE FROM daily_entries WHERE id = ?', [entryId], (delErr) => {
                    if (delErr) resolve({ success: false, message: delErr.message });
                    else resolve({ success: true, deleted: true });
                });
            } else {
                // Update
                const jsonStr = JSON.stringify(newData);
                db.run('UPDATE daily_entries SET data = ? WHERE id = ?', [jsonStr, entryId], (updErr) => {
                    if (updErr) resolve({ success: false, message: updErr.message });
                    else resolve({ success: true, updated: true });
                });
            }
        });
    });
});

ipcMain.handle('db-delete-store', async (event, storeId) => {
    return new Promise((resolve, reject) => {
        // Cascade delete should handle products but sqlite driver needs FK support on.
        // It's safer to delete manually or trust user knows.
        db.run('DELETE FROM stores WHERE id = ?', [storeId], function (err) {
            if (err) reject(err)
            else resolve({ success: true })
        })
    })
})

// Create Store Selector Window
function createSelectorWindow() {
    if (selectorWindow && !selectorWindow.isDestroyed()) {
        selectorWindow.focus();
        return;
    }

    selectorWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        title: 'Mağaza Seçimi - PaketPilot',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        backgroundColor: '#667eea'
    });

    selectorWindow.loadFile('store-selector.html');

    // Handle close attempt
    selectorWindow.on('close', (e) => {
        if (storeWindows.size > 0) {
            const choice = dialog.showMessageBoxSync(selectorWindow, {
                type: 'question',
                buttons: ['Evet', 'Hayır'],
                title: 'Onay',
                message: 'Mağaza seçim ekranını kapatırsanız, tüm açık mağaza pencereleri de kapanacak. Devam etmek istiyor musunuz?',
                defaultId: 0,
                cancelId: 1
            });

            if (choice === 1) { // Hayır (1)
                e.preventDefault();
            } else { // Evet (0)
                // Force close all store windows first
                storeWindows.forEach((win) => {
                    if (!win.isDestroyed()) win.close();
                });
                storeWindows.clear();
            }
        }
    });

    selectorWindow.on('closed', () => {
        selectorWindow = null;
        // If all store windows are also closed, quit the app
        if (storeWindows.size === 0) {
            app.quit();
        }
    });
}

// Focus Selector Window
ipcMain.on('focus-selector-window', () => {
    if (selectorWindow && !selectorWindow.isDestroyed()) {
        if (selectorWindow.isMinimized()) selectorWindow.restore();
        selectorWindow.focus();
    } else {
        // Re-create if it doesn't exist (optional, but good UX)
        createSelectorWindow();
    }
});
// Create Store-Specific Window
function createStoreWindow(storeId) {
    // Check if window already exists for this store
    if (storeWindows.has(storeId)) {
        const existingWindow = storeWindows.get(storeId);
        if (!existingWindow.isDestroyed()) {
            existingWindow.focus();
            return existingWindow;
        } else {
            storeWindows.delete(storeId);
        }
    }

    // Get store details
    db.get('SELECT * FROM stores WHERE id = ?', [storeId], (err, store) => {
        if (err || !store) {
            console.error('Store not found:', storeId);
            return;
        }

        const storeWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            title: `PaketPilot - ${store.name}`,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                additionalArguments: [`--store-id=${storeId}`]
            },
            autoHideMenuBar: true
        });

        storeWindow.loadFile('index.html');

        // Send store ID to renderer after page loads
        storeWindow.webContents.on('did-finish-load', () => {
            storeWindow.webContents.send('set-store-id', storeId);
        });

        storeWindow.on('closed', () => {
            storeWindows.delete(storeId);
            // Notify selector window to update
            if (selectorWindow && !selectorWindow.isDestroyed()) {
                selectorWindow.webContents.send('stores-updated');
            }
        });

        storeWindows.set(storeId, storeWindow);
    });
}

app.whenReady().then(() => {
    createSelectorWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createSelectorWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        db.close()
        app.quit()
    }
})

ipcMain.handle('fetch-trendyol-cancelled', async (event, { storeId, startDate, endDate }) => {
    return new Promise(async (resolve, reject) => {
        if (!storeId) {
            resolve({ success: false, message: 'Store ID required' })
            return
        }

        // Get Credentials
        db.get('SELECT api_key, api_secret, seller_id FROM stores WHERE id = ?', [storeId], async (err, row) => {
            if (err) {
                resolve({ success: false, message: 'Database error: ' + err.message })
                return
            }
            if (!row || !row.seller_id || (!row.api_key && !row.api_secret)) {
                resolve({ success: false, message: 'API Credentials missing for this store.' })
                return
            }

            const { api_key, api_secret, seller_id } = row

            // Format URL
            // Status: Cancelled
            const url = `https://api.trendyol.com/sapigw/suppliers/${seller_id}/orders?status=Cancelled&startDate=${startDate}&endDate=${endDate}&orderBy=Date&direction=DESC&size=200`

            try {
                const authString = `${api_key}:${api_secret}`;
                const encodedAuth = Buffer.from(authString).toString('base64');

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${encodedAuth}`,
                        'User-Agent': `${seller_id} - BenimStokUygulamam`
                    }
                })

                if (!response.ok) {
                    const errorText = await response.text()
                    resolve({ success: false, message: `API Error: ${response.status} - ${errorText}` })
                    return
                }

                const data = await response.json()
                const mappedRows = []

                if (data.content && Array.isArray(data.content)) {
                    data.content.forEach(pkg => {
                        if (pkg.lines && Array.isArray(pkg.lines)) {
                            pkg.lines.forEach(line => {
                                mappedRows.push({
                                    'orderNumber': pkg.orderNumber,
                                    'status': pkg.status,
                                    'productName': line.productName,
                                    'barcode': line.barcode,
                                    'quantity': line.quantity,
                                    'customer': pkg.customerFirstName + ' ' + pkg.customerLastName,
                                    'cargoTrackingNumber': pkg.cargoTrackingNumber,
                                    'orderDate': pkg.orderDate,
                                    'statusDate': pkg.lastModifiedDate,
                                    'reason': line.merchantSku
                                })
                            })
                        }
                    })
                }

                // DUMMY DATA FOR TESTING (Step 416 Request)
                mappedRows.push({
                    'orderNumber': '12933331383',
                    'status': 'Cancelled',
                    'productName': 'Test Ürünü (Arşivde Var)',
                    'barcode': 'DUMMY_ARCHIVE_MATCH',
                    'quantity': 1,
                    'customer': 'Test Müşteri',
                    'cargoTrackingNumber': '1234567890',
                    'orderDate': Date.now() - 86400000,
                    'statusDate': Date.now(),
                    'reason': 'Test Reason'
                });

                resolve({ success: true, data: mappedRows })

            } catch (error) {
                resolve({ success: false, message: 'Fetch error: ' + error.message })
            }
        })
    })
})

ipcMain.handle("get-entry-by-id", async (event, id) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM daily_entries WHERE id = ?", [id], (err, row) => {
            if (err) resolve(null);
            else if (!row) resolve(null);
            else {
                try {
                    row.data = JSON.parse(row.data);
                } catch (e) {
                    row.data = [];
                }
                resolve(row);
            }
        })
    })
})
