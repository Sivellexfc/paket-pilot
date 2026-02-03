// ===== ORDER MANAGEMENT IPC HANDLERS =====
// Add these to main.js before the createWindow() function

// Sync orders from API to database
ipcMain.handle('orders-sync-from-api', async (event, { storeId, orders }) => {
    return new Promise((resolve, reject) => {
        if (!storeId || !orders || !Array.isArray(orders)) {
            resolve({ success: false, message: 'Invalid parameters' })
            return
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION')

            const stmt = db.prepare(`
                INSERT OR REPLACE INTO orders 
                (store_id, order_number, package_number, product_name, barcode, quantity, status, order_data, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `)

            orders.forEach(order => {
                stmt.run(
                    storeId,
                    order.orderNumber,
                    order.packageNumber,
                    order.productName,
                    order.barcode,
                    order.quantity,
                    order.status || 'waiting',
                    JSON.stringify(order)
                )
            })

            stmt.finalize((err) => {
                if (err) {
                    db.run('ROLLBACK')
                    reject(err)
                } else {
                    db.run('COMMIT')
                    resolve({ success: true })
                }
            })
        })
    })
})

// Get orders by status
ipcMain.handle('orders-get-by-status', async (event, { storeId, status }) => {
    return new Promise((resolve, reject) => {
        let query = 'SELECT * FROM orders WHERE store_id = ?'
        let params = [storeId]

        if (status) {
            query += ' AND status = ?'
            params.push(status)
        }

        query += ' ORDER BY created_at DESC'

        db.all(query, params, (err, rows) => {
            if (err) reject(err)
            else {
                const parsed = rows.map(r => ({
                    ...r,
                    order_data: r.order_data ? JSON.parse(r.order_data) : null
                }))
                resolve(parsed)
            }
        })
    })
})

// Update order status
ipcMain.handle('orders-update-status', async (event, { orderIds, status, cancelStage }) => {
    return new Promise((resolve, reject) => {
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            resolve({ success: false, message: 'No order IDs provided' })
            return
        }

        const placeholders = orderIds.map(() => '?').join(',')
        let query = `UPDATE orders SET status = ?, updated_at = datetime('now')`
        let params = [status]

        if (cancelStage) {
            query += ', cancel_stage = ?'
            params.push(cancelStage)
        }

        query += ` WHERE id IN (${placeholders})`
        params.push(...orderIds)

        db.run(query, params, function (err) {
            if (err) reject(err)
            else resolve({ success: true, changes: this.changes })
        })
    })
})

// Mark orders as returned
ipcMain.handle('orders-mark-returned', async (event, { orderIds }) => {
    return new Promise((resolve, reject) => {
        if (!orderIds || !Array.isArray(orderIds)) {
            resolve({ success: false, message: 'Invalid order IDs' })
            return
        }

        const placeholders = orderIds.map(() => '?').join(',')
        const query = `UPDATE orders SET is_returned = 1, updated_at = datetime('now') WHERE id IN (${placeholders})`

        db.run(query, orderIds, function (err) {
            if (err) reject(err)
            else resolve({ success: true, changes: this.changes })
        })
    })
})

// Detect cancelled orders by comparing with current API list
ipcMain.handle('orders-detect-cancellations', async (event, { storeId, currentOrderNumbers }) => {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM orders WHERE store_id = ? AND status != ?',
            [storeId, 'cancelled'],
            (err, rows) => {
                if (err) {
                    reject(err)
                    return
                }

                const currentSet = new Set(currentOrderNumbers)
                const cancelledOrders = rows.filter(order => !currentSet.has(order.order_number))

                if (cancelledOrders.length === 0) {
                    resolve({ success: true, cancelled: [] })
                    return
                }

                db.serialize(() => {
                    db.run('BEGIN TRANSACTION')

                    cancelledOrders.forEach(order => {
                        let cancelStage = 'before_prep'
                        if (order.status === 'preparing') cancelStage = 'during_prep'
                        if (order.status === 'shipped') cancelStage = 'after_ship'

                        db.run(
                            'UPDATE orders SET status = ?, cancel_stage = ?, updated_at = datetime(\'now\') WHERE id = ?',
                            ['cancelled', cancelStage, order.id]
                        )
                    })

                    db.run('COMMIT', (err) => {
                        if (err) {
                            db.run('ROLLBACK')
                            reject(err)
                        } else {
                            resolve({ success: true, cancelled: cancelledOrders })
                        }
                    })
                })
            }
        )
    })
})
