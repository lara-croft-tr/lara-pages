// Availability Chart Component
const CALENDAR_URL = 'https://outlook.office365.com/owa/calendar/2de378d87d6c456f9364e0a0c654eb54@jmjcloud.com/48ed222d250a4317a1ead60e24b4d7d52656075883492544971/calendar.ics';
const WORK_HOURS_START = 8;   // 8 AM
const WORK_HOURS_END = 18;    // 6 PM
const PREFERRED_START = 9;    // Preferred hours: 9 AM
const PREFERRED_END = 13;     // Preferred hours: 1 PM
const LUNCH_HOUR = 13;        // 1 PM (always blocked)
const DAYS_TO_SHOW = 14;      // Show 14 days of availability

// Timezone offset in hours to convert TO CST (UTC-6)
// Positive = timezone is ahead of CST, so subtract to get CST
const TIMEZONE_OFFSETS = {
    'Central Standard Time': 0,
    'Central Daylight Time': 0,
    'GMT Standard Time': 6,
    'GMT Daylight Time': 5,
    'Eastern Standard Time': 1,
    'Eastern Daylight Time': 1,
    'Pacific Standard Time': -2,
    'Pacific Daylight Time': -2,
    'India Standard Time': 11.5,
    'Arabian Standard Time': 9,
    'W. Europe Standard Time': 7,
    'AUS Eastern Standard Time': 16,
    'UTC': 6
};

// Day name to number mapping for RRULE BYDAY
const DAY_MAP = { 'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6 };

// Parse ICS format date and convert to CST
function parseICSDate(dateStr, defaultTZ = 'Central Standard Time') {
    if (!dateStr) return null;
    
    let timezone = defaultTZ;
    let dateValue = dateStr;
    
    // Extract timezone: DTSTART;TZID=Central Standard Time:20260201T140000
    if (dateStr.includes('TZID=')) {
        const colonIdx = dateStr.indexOf(':');
        const tzPart = dateStr.substring(0, colonIdx);
        timezone = tzPart.split('TZID=')[1];
        dateValue = dateStr.substring(colonIdx + 1);
    } else if (dateStr.includes(':')) {
        dateValue = dateStr.split(':').pop();
    }
    
    // Handle UTC indicator (Z suffix)
    if (dateValue.endsWith('Z')) {
        timezone = 'UTC';
        dateValue = dateValue.slice(0, -1);
    }
    
    // Parse YYYYMMDDTHHMMSS or YYYYMMDD
    const year = parseInt(dateValue.substring(0, 4));
    const month = parseInt(dateValue.substring(4, 6)) - 1;
    const day = parseInt(dateValue.substring(6, 8));
    const hour = dateValue.length > 8 ? parseInt(dateValue.substring(9, 11)) : 0;
    const minute = dateValue.length > 11 ? parseInt(dateValue.substring(11, 13)) : 0;
    
    // Create date in the event's timezone
    const date = new Date(year, month, day, hour, minute, 0);
    
    // Convert to CST
    const offset = TIMEZONE_OFFSETS[timezone] || 0;
    if (offset !== 0) {
        date.setHours(date.getHours() - offset);
    }
    
    return date;
}

// Parse RRULE string into object
function parseRRule(rruleStr) {
    if (!rruleStr) return null;
    
    const rule = {};
    const parts = rruleStr.replace('RRULE:', '').split(';');
    
    for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 'FREQ') rule.freq = value;
        else if (key === 'UNTIL') rule.until = parseICSDate(value);
        else if (key === 'INTERVAL') rule.interval = parseInt(value) || 1;
        else if (key === 'BYDAY') rule.byDay = value.split(',').map(d => DAY_MAP[d.replace(/^-?\d+/, '')]);
        else if (key === 'COUNT') rule.count = parseInt(value);
    }
    
    rule.interval = rule.interval || 1;
    return rule;
}

// Expand recurring event into individual occurrences
function expandRecurringEvent(event, startRange, endRange) {
    const occurrences = [];
    const rule = parseRRule(event.rrule);
    if (!rule) return occurrences;
    
    const eventStart = parseICSDate(event.start);
    const eventEnd = parseICSDate(event.end);
    if (!eventStart || !eventEnd) return occurrences;
    
    const duration = eventEnd.getTime() - eventStart.getTime();
    const until = rule.until || endRange;
    
    let current = new Date(eventStart);
    let count = 0;
    const maxIterations = 500; // Safety limit
    
    while (current <= until && current <= endRange && count < maxIterations) {
        // Check if this occurrence falls within our range
        if (current >= startRange || (current.getTime() + duration) >= startRange.getTime()) {
            // For WEEKLY with BYDAY, check if current day matches
            if (rule.freq === 'WEEKLY' && rule.byDay) {
                if (rule.byDay.includes(current.getDay())) {
                    if (current >= startRange) {
                        occurrences.push({
                            start: new Date(current),
                            end: new Date(current.getTime() + duration),
                            summary: event.summary
                        });
                    }
                }
            } else if (rule.freq === 'DAILY' || (rule.freq === 'WEEKLY' && !rule.byDay)) {
                if (current >= startRange) {
                    occurrences.push({
                        start: new Date(current),
                        end: new Date(current.getTime() + duration),
                        summary: event.summary
                    });
                }
            } else if (rule.freq === 'MONTHLY') {
                if (current >= startRange) {
                    occurrences.push({
                        start: new Date(current),
                        end: new Date(current.getTime() + duration),
                        summary: event.summary
                    });
                }
            }
        }
        
        // Advance to next occurrence
        if (rule.freq === 'DAILY') {
            current.setDate(current.getDate() + rule.interval);
        } else if (rule.freq === 'WEEKLY') {
            if (rule.byDay && rule.byDay.length > 0) {
                // Move to next day, will check byDay match above
                current.setDate(current.getDate() + 1);
            } else {
                current.setDate(current.getDate() + (7 * rule.interval));
            }
        } else if (rule.freq === 'MONTHLY') {
            current.setMonth(current.getMonth() + rule.interval);
        } else {
            break;
        }
        
        count++;
        if (rule.count && occurrences.length >= rule.count) break;
    }
    
    return occurrences;
}

// Parse ICS calendar data
function parseICS(icsData) {
    const events = [];
    const lines = icsData.split(/\r?\n/);
    let currentEvent = null;
    let lastKey = '';
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Handle line continuations (lines starting with space or tab)
        while (i + 1 < lines.length && (lines[i + 1].startsWith(' ') || lines[i + 1].startsWith('\t'))) {
            i++;
            line += lines[i].substring(1);
        }
        
        if (line === 'BEGIN:VEVENT') {
            currentEvent = {};
        } else if (line === 'END:VEVENT' && currentEvent) {
            if (currentEvent.start) {
                events.push(currentEvent);
            }
            currentEvent = null;
        } else if (currentEvent) {
            if (line.startsWith('DTSTART')) {
                currentEvent.start = line;
            } else if (line.startsWith('DTEND')) {
                currentEvent.end = line;
            } else if (line.startsWith('SUMMARY:')) {
                currentEvent.summary = line.substring(8);
            } else if (line.startsWith('RRULE:')) {
                currentEvent.rrule = line;
            } else if (line.startsWith('X-MICROSOFT-CDO-BUSYSTATUS:')) {
                currentEvent.busyStatus = line.split(':')[1];
            }
        }
    }
    
    return events;
}

// Expand all events (single + recurring) for date range
function expandAllEvents(events, startRange, endRange) {
    const expanded = [];
    
    for (const event of events) {
        // Skip FREE events
        if (event.busyStatus === 'FREE') continue;
        
        if (event.rrule) {
            // Recurring event - expand it
            const occurrences = expandRecurringEvent(event, startRange, endRange);
            expanded.push(...occurrences);
        } else {
            // Single event
            const start = parseICSDate(event.start);
            const end = parseICSDate(event.end);
            if (start && end) {
                // Check if within range
                if (end >= startRange && start <= endRange) {
                    expanded.push({ start, end, summary: event.summary });
                }
            }
        }
    }
    
    return expanded;
}

// Check time slot status
function getTimeSlotStatus(date, hour, expandedEvents) {
    // Always block lunch hour (1-2 PM)
    if (hour === LUNCH_HOUR) {
        return 'lunch';
    }
    
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    
    const slotEnd = new Date(date);
    slotEnd.setHours(hour + 1, 0, 0, 0);
    
    // Check for calendar events
    for (const event of expandedEvents) {
        // Check if event overlaps with this slot
        if (event.start < slotEnd && event.end > slotStart) {
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
function generateAvailability(expandedEvents) {
    const availability = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let dayOffset = 0; dayOffset < DAYS_TO_SHOW; dayOffset++) {
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
                status: getTimeSlotStatus(date, hour, expandedEvents)
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
    html += '<div class="time-label"></div>';
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
            <span>Preferred (9-1)</span>
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
            <span>Lunch</span>
        </div>
    </div>`;
    
    container.innerHTML = html;
}

// Fetch and display availability
async function loadAvailability() {
    try {
        const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(CALENDAR_URL)}`);
        const icsData = await response.text();
        
        // Parse events
        const events = parseICS(icsData);
        
        // Calculate date range
        const startRange = new Date();
        startRange.setHours(0, 0, 0, 0);
        const endRange = new Date(startRange);
        endRange.setDate(endRange.getDate() + DAYS_TO_SHOW);
        
        // Expand all events (including recurring)
        const expandedEvents = expandAllEvents(events, startRange, endRange);
        
        // Generate and render availability
        const availability = generateAvailability(expandedEvents);
        renderAvailabilityChart(availability);
        
        console.log(`Loaded ${events.length} events, expanded to ${expandedEvents.length} occurrences`);
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
