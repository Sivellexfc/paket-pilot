
# Fixed: Auto Import Behavior

I have updated the Trendyol Auto Import logic to match the Excel import process exactly.

## What Changed:
When you click "Auto", the system now performs the entire pipeline:
1.  **Filter**: Removes already shipped orders.
2.  **Aggregate**: Automatically calculates Package Counts (grouping items).
3.  **Sync**: Instantly updates the "Kargo Durumları" (Right) table to match the new source data.
4.  **Detect Cancels**: Checks for any cancellations against previous data.

The "Auto" button now behaves identically to uploading an Excel file manually.
