
# Changed: Cargo Status Logic

I have updated the "Kargolar Kargoya Verildi" behavior as requested.

## New Behavior:
1.  **Check:** The system checks if a column named **"Sipariş Statüsü"**, "Kargo Durumu", or "Status" already exists.
2.  **Update:** If found, it updates the value in that column to **"Kargoya Verildi"** directly (keeping the table structure clean).
3.  **Fallback:** Only if no such column is found will it add a new one.

This prevents duplicate columns and matches your Trendyol data structure perfectly.
