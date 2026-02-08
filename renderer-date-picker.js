
// ==========================================
// CUSTOM DATE RANGE PICKER COMPONENT
// ==========================================

class DateRangePicker {
    constructor(config) {
        this.elementId = config.elementId || 'custom-date-picker-modal';
        this.onApply = config.onApply || (() => { });
        this.onCancel = config.onCancel || (() => { });
        this.maxRangeDays = config.maxRangeDays || 100; // Default limit extended for wider ranges

        this.state = {
            startDate: null,
            endDate: null,
            viewDate: new Date(), // The month shown in the first calendar
            hoverDate: null
        };

        this.init();
    }

    init() {
        this.modal = document.getElementById(this.elementId);
        if (!this.modal) return;

        this.bindEvents();
        this.renderCalendar();
    }

    open() {
        this.modal.classList.remove('hidden');
        this.renderCalendar();
    }

    close() {
        this.modal.classList.add('hidden');
    }

    bindEvents() {
        // Preset Buttons
        this.modal.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const preset = e.target.dataset.preset;
                this.handlePreset(preset);
            });
        });

        // Navigation Buttons
        document.getElementById('dp-prev-month').addEventListener('click', () => {
            this.state.viewDate.setMonth(this.state.viewDate.getMonth() - 1);
            this.renderCalendar();
        });

        document.getElementById('dp-next-month').addEventListener('click', () => {
            this.state.viewDate.setMonth(this.state.viewDate.getMonth() + 1);
            this.renderCalendar();
        });

        // Action Buttons
        document.getElementById('dp-btn-cancel').addEventListener('click', () => {
            this.close();
            this.onCancel();
        });

        document.getElementById('dp-btn-apply').addEventListener('click', () => {
            if (this.state.startDate && this.state.endDate) {
                this.onApply(this.state.startDate, this.state.endDate);
                this.close();
            } else if (this.state.startDate) {
                // If only start date is selected, treat as single day
                this.onApply(this.state.startDate, this.state.startDate);
                this.close();
            } else {
                // Warning handled in generic alert if needed
            }
        });

        // Backdrop
        document.getElementById('date-picker-backdrop').addEventListener('click', () => {
            this.close();
        });
    }

    handlePreset(preset) {
        const today = new Date();
        let start = new Date();
        let end = new Date();

        switch (preset) {
            case 'today':
                break; // start/end are today
            case 'yesterday':
                start.setDate(today.getDate() - 1);
                end.setDate(today.getDate() - 1);
                break;
            case 'last7':
                start.setDate(today.getDate() - 6);
                break;
            case 'lastWeek':
                start.setDate(today.getDate() - 7);
                end.setDate(today.getDate() - 1);
                break;
            case 'last2Weeks':
                start.setDate(today.getDate() - 14);
                // end defaults to today
                break;
            case 'lastMonth':
                start.setMonth(today.getMonth() - 1);
                break;
            case 'last3Months':
                start.setMonth(today.getMonth() - 3);
                break;
        }

        this.state.startDate = start;
        this.state.endDate = end;
        this.state.viewDate = new Date(start); // Jump view to selection
        this.renderCalendar();
    }

    handleDateClick(date) {
        // Reset if both selected or picking new range
        if (this.state.startDate && this.state.endDate) {
            this.state.startDate = date;
            this.state.endDate = null;
        } else if (!this.state.startDate) {
            this.state.startDate = date;
        } else {
            // Second click (End Date)
            let start = this.state.startDate;
            let end = date;

            // Swap if end is before start
            if (end < start) {
                [start, end] = [end, start];
            }

            // CHECK MAX RANGE
            const diffTime = Math.abs(end - start);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays > this.maxRangeDays) {
                // If range too big, just set the clicked date as the new start date
                // Or cap it? User requested max 2 weeks selection capable.
                // Let's reset to new start date to enforce manual re-selection or show warning.
                // Better UX: Just assume they want to start a new range from this date.
                // alert('Maksimum 2 haftalık aralık seçebilirsiniz.'); 
                // Instead of alerting, let's just make the collection valid by resetting or clamping.
                // Let's Clamp:
                // end = new Date(start);
                // end.setDate(start.getDate() + 14);

                // Alert via existing system would be nice but we are in component.
                // Let's just reset standard behavior: Click means new Start Date.
                this.state.startDate = date;
                this.state.endDate = null;
            } else {
                this.state.startDate = start;
                this.state.endDate = end;
            }
        }
        this.renderCalendar();
    }

    renderCalendar() {
        const leftCalendar = document.getElementById('dp-calendar-left');
        const rightCalendar = document.getElementById('dp-calendar-right');
        const rangeText = document.getElementById('dp-selected-range-text');

        // Logic to show Previous Month on Left, Current View on Right
        // OR: Current View on Left, Next View on Right. Let's do Current + Next
        const m1 = new Date(this.state.viewDate);
        m1.setDate(1);
        const m2 = new Date(this.state.viewDate);
        m2.setMonth(m2.getMonth() + 1);
        m2.setDate(1);

        // Update Headers
        document.getElementById('dp-month-left').textContent = m1.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });
        document.getElementById('dp-month-right').textContent = m2.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });

        this.renderMonthGrid(leftCalendar, m1);
        this.renderMonthGrid(rightCalendar, m2);

        // Update Footer Label
        if (this.state.startDate && this.state.endDate) {
            const s = this.state.startDate.toLocaleDateString('tr-TR');
            const e = this.state.endDate.toLocaleDateString('tr-TR');
            rangeText.textContent = `${s} - ${e}`;
        } else if (this.state.startDate) {
            rangeText.textContent = `${this.state.startDate.toLocaleDateString('tr-TR')} - ...`;
        } else {
            rangeText.textContent = 'Bir aralık seçiniz';
        }
    }

    renderMonthGrid(container, date) {
        container.innerHTML = '';

        // Days Header
        const days = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
        const headerRow = document.createElement('div');
        headerRow.className = 'grid grid-cols-7 mb-2';
        days.forEach(d => {
            const el = document.createElement('div');
            el.className = 'text-xs text-center text-gray-400 font-medium py-1';
            el.textContent = d;
            headerRow.appendChild(el);
        });
        container.appendChild(headerRow);

        // Dates Grid
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-7 gap-1';

        const year = date.getFullYear();
        const month = date.getMonth();

        const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 is Sunday
        // Convert to Mon-Sun (0-6) where 0 is Mon
        const startOffset = (firstDayOfMonth + 6) % 7;

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Empty cells
        for (let i = 0; i < startOffset; i++) {
            const empty = document.createElement('div');
            grid.appendChild(empty);
        }

        // Days
        for (let d = 1; d <= daysInMonth; d++) {
            const currentDate = new Date(year, month, d);
            const btn = document.createElement('div');
            btn.className = 'h-8 w-8 flex items-center justify-center text-sm rounded-full cursor-pointer transition-colors text-gray-700 hover:bg-gray-100';
            btn.textContent = d;

            // Styles
            const isStart = this.isSameDay(currentDate, this.state.startDate);
            const isEnd = this.isSameDay(currentDate, this.state.endDate);
            const isInRange = this.state.startDate && this.state.endDate && currentDate > this.state.startDate && currentDate < this.state.endDate;

            if (isStart || isEnd) {
                btn.className = 'h-8 w-8 flex items-center justify-center text-sm rounded-full cursor-pointer bg-blue-600 text-white shadow-sm';
            } else if (isInRange) {
                btn.className = 'h-8 w-8 flex items-center justify-center text-sm rounded-full cursor-pointer bg-blue-50 text-blue-700';
            }

            // Max Range Constraint Visualization (Optional: Disable dates out of range if Start is selected)
            if (this.state.startDate && !this.state.endDate) {
                const diffDays = Math.ceil(Math.abs(currentDate - this.state.startDate) / (1000 * 60 * 60 * 24));
                if (diffDays > this.maxRangeDays) {
                    btn.classList.add('opacity-30', 'pointer-events-none');
                }
            }

            btn.addEventListener('click', () => this.handleDateClick(currentDate));
            grid.appendChild(btn);
        }

        container.appendChild(grid);
    }

    isSameDay(d1, d2) {
        if (!d1 || !d2) return false;
        return d1.getFullYear() === d2.getFullYear() &&
            d1.getMonth() === d2.getMonth() &&
            d1.getDate() === d2.getDate();
    }
}

// Global instance variable
let manualArchiveDatePicker = null;

// Initialize function
function openManualArchiveDatePicker(currentStart, currentEnd, onApplyCallback) {
    if (!manualArchiveDatePicker) {
        manualArchiveDatePicker = new DateRangePicker({
            elementId: 'custom-date-picker-modal',
            maxRangeDays: 14,
            onApply: onApplyCallback,
            onCancel: () => { console.log('Cancelled'); }
        });
    } else {
        // Update callback if needed or just re-bind
        manualArchiveDatePicker.onApply = onApplyCallback;
    }

    // Set initial state if provided
    if (currentStart) manualArchiveDatePicker.state.startDate = new Date(currentStart);
    if (currentEnd) manualArchiveDatePicker.state.endDate = new Date(currentEnd);

    manualArchiveDatePicker.open();
}
