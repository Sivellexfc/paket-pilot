
# Fix: Column Name Recognition for Filtering

I have updated the filtering logic to correctly identify the "SIPARIŞ NUMARASI" column.

## Changes:
1.  **Updated Main Process**: The system now searches for `sipariş numara`, `siparis numara`, `order num` (and variations) when scanning your Cargo Archives.
2.  **Updated Renderer**: The import filter now recognizes these column headers as well.

This ensures that even if your Excel file uses "SIPARIŞ NUMARASI" instead of "Sipariş No", the system will correctly find the order numbers and filter out those that are already shipped.
