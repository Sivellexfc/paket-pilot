
# Fixed: Archive Detail View Layout

I have improved the layout of the Archive Detail view (when you expand a row "Detayları Göster"):

## Changes:
1.  **Fixed Dropdown Clipping:** The "Columns" dropdown menu is no longer cut off. It now sits outside the scrolling area of the table.
2.  **Fixed Page Scroll:** The "Değişiklikleri Kaydet" (Save) button section no longer pushes off the right side of the screen. I removed the forced width calculation that was causing the main page to scroll horizontally.
3.  **Targeted Scrolling:** Now, only the inner data table has a scrollbar if the columns are too wide, keeping the rest of the interface stable.

The interface should now be much cleaner and behave correctly on different screen sizes.
