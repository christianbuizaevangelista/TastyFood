// Shared rules for applicant meetings: when they can be booked, and where the
// office actually is. Both the public booking form and the emails read from
// here so the two can never drift apart.

// Office visits happen at the plant. Both the address and the maps link are
// read from here so the booking form and the emails never drift apart.
export const OFFICE_ADDRESS =
  '171 Purok 5, Brgy. Banay Banay, Amadeo, Cavite';
// Address-based Google Maps search for the new location. Swap in the company's
// own precise pin (a short maps.app.goo.gl link) once available — a search can
// land on the wrong side of a long street.
export const OFFICE_MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=171+Purok+5+Brgy+Banay+Banay+Amadeo+Cavite';

// The standing Zoom room for applicant meetings. It lives in an environment
// variable rather than in this file because the link carries its own passcode
// and this repository is public — committing it would let anyone join.
// Unset simply means the Principal types a link when confirming.
export function defaultZoomLink(): string | null {
  return process.env.ZOOM_DEFAULT_LINK?.trim() || null;
}

// The only times a meeting can be booked, in Manila hours. Kept as start/end so
// the applicant sees a window rather than a single instant.
export const SLOTS = [
  { start: '10:00', end: '11:30', label: '10:00 AM – 11:30 AM' },
  { start: '13:30', end: '15:00', label: '1:30 PM – 3:00 PM' },
  { start: '15:30', end: '17:00', label: '3:30 PM – 5:00 PM' },
] as const;

export type SlotStart = (typeof SLOTS)[number]['start'];

// Manila wall-clock parts of an instant, which is what the rules are written in.
function manilaParts(d: Date): { weekday: number; hhmm: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    weekday: days.indexOf(parts.weekday as string),
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

// Why a requested time is not bookable, or null when it is fine. Returning the
// reason rather than a boolean lets the applicant be told what to change.
export function slotProblem(at: Date): string | null {
  const { weekday, hhmm } = manilaParts(at);
  if (weekday < 1 || weekday > 5) {
    return 'Meetings are held Monday to Friday only. Please pick a weekday.';
  }
  if (!SLOTS.some((s) => s.start === hhmm)) {
    const times = SLOTS.map((s) => s.label).join(', ');
    return `Please choose one of our meeting times: ${times}.`;
  }
  return null;
}

// The window an instant falls in, for showing back to people.
export function slotLabel(at: Date): string | null {
  const { hhmm } = manilaParts(at);
  return SLOTS.find((s) => s.start === hhmm)?.label ?? null;
}
