// Availability Chart Component
const CALENDAR_URL = 'https://outlook.office365.com/owa/calendar/2de378d87d6c456f9364e0a0c654eb54@jmjcloud.com/48ed222d250a4317a1ead60e24b4d7d52656075883492544971/calendar.ics';
const WORK_HOURS_START = 9;  // 9 AM
const WORK_HOURS_END = 16;   // 4 PM

// Parse ICS format date
function parseICSDate(dateStr) {
    if (!dateStr) return null;
    
    // Handle TZID format: DTSTART;TZID=Central Standard Time:20260201T140000
    if (dateStr.includes(':')) {
        dateStr = dateStr.split(':')[1];
    }
    
    // Parse YYYYMMDDTHHMMSS format
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    const hour = dateStr.substring(9, 11) || '00';
    const minute = dateStr.substring(11, 13) || '00';
    
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
}

// Parse ICS calendar data
function parseICS(icsData) {
    const events = [];
    const lines = icsData.split('\n');
    let currentEvent = null;
    let currentField = '';
    
    for (let line of lines) {
        line = line.trim();
        
        if (line === 'BEGIN:VEVENT') {
            currentEvent = {};
        } else if (line === 'END:VEVENT' && currentEvent) {
            events.push(currentEvent);
            currentEvent = null;
        } else if (currentEvent) {
            if (line.startsWith('DTSTART')) {
                currentEvent.start = line;
                currentField = 'start';
            } else if (line.startsWith('DTEND')) {
                currentEvent.end = line;
                currentField = 'end';
            } else if (line.startsWith('SUMMARY:')) {
                currentEvent.summary = line.substring(8);
                currentField = 'summary';
            } else if (line.startsWith(' ') && currentField) {
                // Continuation line
                currentEvent[currentField] += line.substring(1);
            }
        }
    }
    
    return events.filter(e => e.start && e.end);
}

// Check if time slot is available
function isTimeSlotAvailable(date, hour, events) {
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    
    const slotEnd = new Date(date);
    slotEnd.setHours(hour + 1, 0, 0, 0);
    
    for (const event of events) {
        const eventStart = parseICSDate(event.start);
        const eventEnd = parseICSDate(event.end);
        
        if (!eventStart || !eventEnd) continue;
        
        // Check if event overlaps with this slot
        if (eventStart < slotEnd && eventEnd > slotStart) {
            return false;
        }
    }
    
    return true;
}

// Generate availability for next 14 days
function generateAvailability(events) {
    const availability = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
        const date = new Date(today);
        date.setDate(today.getDate() + dayOffset);
        
        // Skip weekends
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        
        const dayData = {
            date: date,
            dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
            slots: []
        };
        
        for (let hour = WORK_HOURS_START; hour < WORK_HOURS_END; hour++) {
            dayData.slots.push({
                hour: hour,
                available: isTimeSlotAvailable(date, hour, events)
            });
        }
        
        availability.push(dayData);
    }
    
    return availability;
}

// Render availability chart
function renderAvailabilityChart(availability) {
    const container = document.getElementById('availability-chart');
    if (!container) return;
    
    let html = '<div class="availability-grid">';
    
    // Header with days
    html += '<div class="availability-header">';
    html += '<div class="time-label">Time</div>';
    availability.forEach(day => {
        html += `<div class="day-header">
            <div class="day-name">${day.dayName}</div>
            <div class="day-date">${day.dateStr}</div>
        </div>`;
    });
    html += '</div>';
    
    // Time slots
    for (let hour = WORK_HOURS_START; hour < WORK_HOURS_END; hour++) {
        html += '<div class="availability-row">';
        html += `<div class="time-label">${hour % 12 || 12}${hour < 12 ? 'AM' : 'PM'}</div>`;
        
        availability.forEach(day => {
            const slot = day.slots.find(s => s.hour === hour);
            const className = slot && slot.available ? 'slot available' : 'slot busy';
            html += `<div class="${className}"></div>`;
        });
        
        html += '</div>';
    }
    
    html += '</div>';
    
    // Legend
    html += `<div class="availability-legend">
        <div class="legend-item">
            <div class="slot available"></div>
            <span>Available</span>
        </div>
        <div class="legend-item">
            <div class="slot busy"></div>
            <span>Busy</span>
        </div>
    </div>`;
    
    container.innerHTML = html;
}

// Fetch and display availability
async function loadAvailability() {
    try {
        const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(CALENDAR_URL)}`);
        const icsData = await response.text();
        
        const events = parseICS(icsData);
        const availability = generateAvailability(events);
        renderAvailabilityChart(availability);
    } catch (error) {
        console.error('Error loading availability:', error);
        document.getElementById('availability-chart').innerHTML = 
            '<p class="availability-error">Unable to load availability. Please contact directly.</p>';
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAvailability);
} else {
    loadAvailability();
}
