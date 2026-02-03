
# Feature Implementation: Filter Shipped Orders

I have implemented the filtering logic as requested. Every time you import data into the "Hazırlanmayı Bekleyen Siparişler" (Source) table (via Excel or API), the system now checks your "Kargo Arşivi" (Shipped Orders).

## How it works:
1.  **Check Archive**: The system scans all your past "Kargoya Verildi" (Cargo) archives.
2.  **Filter**: If an order number in the new import matches an order you previously marked as shipped, it is **automatically removed** from the import.
3.  **Result**: The Source table will only show orders that have *not* yet been marked as shipped.

## Technical Details:
- Added `get-shipped-order-numbers` handler to the main process for efficient querying.
- Added `filterShippedOrders` helper in the renderer to strip duplicates before they reach the UI.
- Applied this logic to both Excel Import and Auto (API) Import.
