
# Fixed: Individual Row Deletion

I have added the ability to delete specific rows within the Archive Details.

## Changes:
1.  **Delete Button:** Added an "İşlem" column to the details table with a delete (trash) icon for each row.
2.  **Logic:** Clicking the delete icon prompts for confirmation (using the new modal).
3.  **Result:** Upon confirmation, only that specific line item is removed from the database, leaving the rest of the day's records intact.
