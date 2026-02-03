
# Update: Target Table Behavior

I have updated the "Kargo Durumları" (Target) table behavior as requested:

1.  **No Auto-Load:** The table will no longer load past saved data for the day when you start the app. It will only show what you are currently working on.
2.  **Safe Saving:** When you save new data to the archive, it will **MERGE** with the existing daily record instead of overwriting it.
    - This ensures that your shipped order history remains complete (so the Source filter continues to work correctly).
    - Duplicate orders (same Order Number) will not be added twice to the archive.

You can now use the Target table strictly for adding new shipments without seeing the old ones, while the system quietly maintains the full history in the background.
