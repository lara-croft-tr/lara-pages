// Availability Chart Component
const CALENDAR_URL = 'https://outlook.office365.com/owa/calendar/2de378d87d6c456f9364e0a0c654eb54@jmjcloud.com/48ed222d250a4317a1ead60e24b4d7d52656075883492544971/calendar.ics';
const WORK_HOURS_START = 8;   // 8 AM
const WORK_HOURS_END = 18;    // 6 PM
const PREFERRED_START = 9;    // Preferred hours: 9 AM
const PREFERRED_END = 13;     // Preferred hours: 1 PM
const LUNCH_HOUR = 13;        // 1 PM (always blocked)

// Timezone offset mapping to convert to CST (UTC-6)
const TIMEZONE_OFFSETS = {
    'Central Standard Time': 0,
    'GMT Standard Time': 6,
    'Eastern Standard Time': 1,
    'Pacific Standard Time': -2,
    'India Standard Time': 11.5,
    'Arabian Standard Time': 9,
    'UTC': 6
};

// Parse ICS format date and convert to CST
function parseICSDate(dateStr) {
    if (!dateStr) return null;
    
    let timezone = 'Central Standard Time';
    let dateValue = dateStr;
    
    // Extract timezone if present: DTSTART;TZID=Central Standard Time:20260201T140000
    if (dateStr.includes('TZID=')) {
        const parts = dateStr.split(':');
        const tzPart = parts[0];
        timezone = tzPart.split('TZID=')[1];
        dateValue = parts.slice(1).join(':');
    } else if (dateStr.includes(':')) {
        dateValue = dateStr.split(':')[1];
    }
    
    // Handle DATE format (all-day events): VALUE=DATE:20260203
    if (dateValue.includes('VALUE=DATE')) {
        dateValue = dateValue.split(':')[1];
    }
    
    // Parse YYYYMMDDTHHMMSS format or YYYYMMDD format
    const year = dateValue.substring(0, 4);
    const month = dateValue.substring(4, 6);
    const day = dateValue.substring(6, 8);
    const hour = dateValue.substring(9, 11) || '00';
    const minute = dateValue.substring(11, 13) || '00';
    const second = dateValue.substring(13, 15) || '00';
    
    // Create date object
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    
    // Convert to CST if needed
    const offset = TIMEZONE_OFFSETS[timezone] || 0;
    if (offset !== 0) {
        date.setHours(date.getHours() - offset);
    }
    
    return date;
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

// Check time slot status
function getTimeSlotStatus(date, hour, events) {
    // Always block lunch hour (1-2 PM)
    if (hour === LUNCH_HOUR) {
        return 'lunch';
    }
    
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    
    const slotEnd = new Date(date);
    slotEnd.setHours(hour + 1, 0, 0, 0);
    
    // Check for calendar events
    for (const event of events) {
        const eventStart = parseICSDate(event.start);
        const eventEnd = parseICSDate(event.end);
        
        if (!eventStart || !eventEnd) continue;
        
        // Check if event overlaps with this slot
        if (eventStart < slotEnd && eventEnd > slotStart) {
            return 'busy';
        }
    }
    
    // Check if this is in preferred hours (9 AM - 1 PM)
    if (hour >= PREFERRED_START && hour < PREFERRED_END) {
        return 'preferred';
    }
    
    return 'available';
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
                status: getTimeSlotStatus(date, hour, events)
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
        const displayHour = hour % 12 || 12;
        const ampm = hour < 12 ? 'AM' : 'PM';
        html += `<div class="time-label">${displayHour}${ampm}</div>`;
        
        availability.forEach(day => {
            const slot = day.slots.find(s => s.hour === hour);
            const status = slot ? slot.status : 'busy';
            html += `<div class="slot ${status}"></div>`;
        });
        
        html += '</div>';
    }
    
    html += '</div>';
    
    // Legend
    html += `<div class="availability-legend">
        <div class="legend-item">
            <div class="slot preferred"></div>
            <span>Available (Preferred 9-1)</span>
        </div>
        <div class="legend-item">
            <div class="slot available"></div>
            <span>Available</span>
        </div>
        <div class="legend-item">
            <div class="slot busy"></div>
            <span>Busy</span>
        </div>
        <div class="legend-item">
            <div class="slot lunch"></div>
            <span>Lunch (1-2 PM)</span>
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
