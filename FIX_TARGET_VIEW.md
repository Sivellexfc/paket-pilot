
# Fixed: Target Table Synchronization

I have corrected the behavior specifically for the "Kargo Durumları" table.

## Changes:
1.  **Strict Synchronization:** When you load data into "Hazırlanmayı Bekleyen Siparişler", the "Kargo Durumları" table now effectively **resets** and refills based ONLY on that new filtered list.
2.  **No Old History Shown:** It will no longer pull previous shipped orders from the database into the view. You will only see the current batch.
3.  **Background Merging Preserved:** When you click "Kargolar Kargoya Verildi", it continues to save to your history in the background so that future filtering works correctly.

This aligns perfectly with your screenshot request.
