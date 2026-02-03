
# Filter Code Logic

Here is the exact code implementing the filtering logic. I have also added logging to these sections so you can see what is happening in the logs.

## 1. Main Process (Getting Shipped Orders)
In `main.js`, this handler scans the database for past shipments:

```javascript
ipcMain.handle("get-shipped-order-numbers", async (event, storeId) => {
    return new Promise((resolve, reject) => {
        // ... (fetch query)
        
        // Scan rows
        rows.forEach(row => {
            try {
                const data = JSON.parse(row.data);
                if (Array.isArray(data) && data.length > 1) {
                     // Find Column
                     const headers = data[0];
                     const orderNoIdx = headers.findIndex(h => 
                         h && (h.toString().toLowerCase().includes('sipariş no') || 
                               h.toString().toLowerCase().includes('sipariş numara') || // <-- ADDED THIS
                               h.toString().toLowerCase().includes('order no') ||
                               h.toString().toLowerCase().includes('order num'))
                     );
                     
                     if (orderNoIdx !== -1) {
                         // Collect Order Numbers
                         for(let i=1; i<data.length; i++) {
                             const val = data[i][orderNoIdx];
                             if(val) shippedOrders.add(val.toString().trim());
                         }
                     }
                }
            } catch(e) { ... }
        });
        
        console.log(`[Main] Shipped Check: Collected ${shippedOrders.size} unique order numbers.`);
        resolve(Array.from(shippedOrders));
    });
});
```

## 2. Renderer Process (Filtering Import)
In `renderer.js`, this helper function filters the incoming Excel data:

```javascript
async function filterShippedOrders(data) {
    // ... (call main process)
    const shippedOrders = await ipcRenderer.invoke('get-shipped-order-numbers', currentStore.id);
    
    // Find Column in NEW Data
    const headers = data[0];
    const orderNoIdx = headers.findIndex(h => h && (
        h.toString().toLowerCase().includes('sipariş no') || 
        h.toString().toLowerCase().includes('sipariş numara') || // <-- ADDED THIS
        h.toString().toLowerCase().includes('order no')
    ));

    if (orderNoIdx === -1) {
        log.warn('[Filter] Could not find "Sipariş Numarası" column...');
        return data; // returns unfiltered if column not found
    }

    // Filter
    const shippedSet = new Set(shippedOrders);
    const filteredData = [headers];
    
    for(let i=1; i<data.length; i++) {
        const row = data[i];
        const orderNo = row[orderNoIdx];
        
        // Check if in set
        if (orderNo && shippedSet.has(orderNo.toString().trim())) {
            filteredCount++; // Skip adding to result
        } else {
            filteredData.push(row); // Keep
        }
    }
    
    log.info(`Filtered out ${filteredCount} already shipped orders.`);
    return filteredData;
}
```

The issue was likely that `sipariş numara` was missing from the check (we only had `sipariş no`). I have added it now.
