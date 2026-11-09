// Date and repeat-pattern logic for shifts. No DOM, so it can be tested in Node.
// Dates are local dates; strings are "YYYY-MM-DD", times "HH:MM".

const DAY_MS = 86400000;

const TYPES = [
  ["dag", "Dagdienst"],
  ["avond", "Avonddienst"],
  ["slaap", "Slaapdienst"],
];
const TYPE_LABELS = Object.fromEntries(TYPES);

const FREQUENCIES = [
  ["weekly", "Elke week"],
  ["even", "Even weken (week A)"],
  ["odd", "Oneven weken (week B)"],
  ["every3", "1x per 3 weken"],
  ["every4", "1x per 4 weken"],
  ["once", "Eenmalig"],
];
const RECURRING = ["weekly", "even", "odd", "every3", "every4"];
const FREQUENCY_TAGS = {
  weekly: "",
  even: "Even weken",
  odd: "Oneven weken",
  every3: "Om de 3 weken",
  every4: "Om de 4 weken",
  once: "Eenmalig",
};

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// 0 = Monday ... 6 = Sunday
function weekdayOf(d) {
  return (d.getDay() + 6) % 7;
}

function mondayOf(d) {
  return addDays(d, -weekdayOf(d));
}

// Whole days since 1970 for a local date, unaffected by daylight saving time.
function dayNumber(d) {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

// ISO week number: the week belongs to the year of its Thursday.
function isoWeek(d) {
  const thursday = addDays(d, 3 - ((d.getDay() + 6) % 7));
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  return Math.floor((dayNumber(thursday) - dayNumber(jan1)) / 7) + 1;
}

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// A shift whose end is earlier than its start runs until the next morning.
function isNight(shift) {
  return shift.end < shift.start;
}

function timeLabel(shift) {
  return `${shift.start} - ${shift.end}${isNight(shift) ? " (volgende dag)" : ""}`;
}

function isPaused(shift, date) {
  if (!shift.pauseFrom) return false;
  const iso = isoDate(date);
  return iso >= shift.pauseFrom && iso <= shift.pauseUntil;
}

// Does the repeat pattern put this shift in the week starting on `monday`? Ignores pauses.
function inPattern(shift, monday) {
  switch (shift.frequency) {
    case "even":
      return isoWeek(monday) % 2 === 0;
    case "odd":
      return isoWeek(monday) % 2 === 1;
    case "every3":
    case "every4": {
      const interval = shift.frequency === "every3" ? 3 : 4;
      const weeks = (dayNumber(monday) - dayNumber(mondayOf(parseDate(shift.firstWeek)))) / 7;
      return weeks >= 0 && weeks % interval === 0;
    }
    default:
      return true;
  }
}

// One-time changes (one-off shifts that replace or cancel a recurring shift on
// one date), keyed by "<recurring shift id>|<date>".
function buildOverrides(shifts) {
  const overrides = new Map();
  for (const s of shifts) {
    if (s.replaces) overrides.set(`${s.replaces}|${s.onDate}`, s);
  }
  return overrides;
}

// The shift in the week of `monday`: null when it is not scheduled that week,
// otherwise { date, status, change } with status "normal", "paused", "cancelled"
// or "replaced" (change = the one-time change for the last two).
function statusIn(shift, monday, overrides = new Map()) {
  if (shift.cancelled) return null; // a cancellation is not a shift itself
  if (shift.frequency === "once") {
    const date = parseDate(shift.onDate);
    return isoDate(mondayOf(date)) === isoDate(monday) ? { date, status: "normal" } : null;
  }
  const date = addDays(monday, shift.weekday);
  if (shift.endDate && isoDate(date) > shift.endDate) return null;
  if (!inPattern(shift, monday)) return null;
  const change = overrides.get(`${shift.id}|${isoDate(date)}`);
  if (change) return { date, status: change.cancelled ? "cancelled" : "replaced", change };
  if (isPaused(shift, date)) return { date, status: "paused" };
  return { date, status: "normal" };
}

// The date the shift actually takes place in the week of `monday`, or null.
function occursIn(shift, monday, overrides) {
  const state = statusIn(shift, monday, overrides);
  return state && state.status === "normal" ? state.date : null;
}

// Length of a shift in minutes; a night shift runs until the next morning.
function shiftMinutes(shift) {
  const length = toMinutes(shift.end) - toMinutes(shift.start);
  return length > 0 ? length : length + 1440;
}

// Each occurrence in `weeks` weeks from `fromMonday` as absolute minutes [start, end).
function occurrences(shift, fromMonday, weeks, overrides) {
  const result = [];
  for (let w = 0; w < weeks; w++) {
    const date = occursIn(shift, addDays(fromMonday, w * 7), overrides);
    if (!date) continue;
    const start = dayNumber(date) * 1440 + toMinutes(shift.start);
    result.push({ start, end: start + shiftMinutes(shift), date });
  }
  return result;
}

// Planned minutes per employee for shifts that start between `from` and `until`
// (inclusive), as { [employeeId]: { count, dag, avond, slaap, total } }.
// Substitutes get the hours, cancelled and paused shifts do not count.
function minutesByEmployee(shifts, from, until) {
  const overrides = buildOverrides(shifts);
  const first = isoDate(from);
  const last = isoDate(until);
  const result = {};
  for (let monday = mondayOf(from); monday <= until; monday = addDays(monday, 7)) {
    for (const shift of shifts) {
      const date = occursIn(shift, monday, overrides);
      if (!date || isoDate(date) < first || isoDate(date) > last) continue;
      const row = (result[shift.employeeId] ??= { count: 0, dag: 0, avond: 0, slaap: 0, total: 0 });
      const minutes = shiftMinutes(shift);
      row.count += 1;
      row[shift.type] += minutes;
      row.total += minutes;
    }
  }
  return result;
}

// First other shift that overlaps the candidate within `weeks` weeks from `fromMonday`,
// as { shift, date } (date of the candidate's occurrence), or null.
// Shifts that only touch (11:00 end, 11:00 start) do not overlap.
// `overrides` must already contain the candidate if it is a one-time change.
function findClash(candidate, others, fromMonday, overrides = new Map(), weeks = 53) {
  const mine = occurrences(candidate, fromMonday, weeks, overrides);
  for (const other of others) {
    if (other.id && other.id === candidate.id) continue;
    // Start one week earlier so a Sunday night shift running into Monday is included.
    for (const o of occurrences(other, addDays(fromMonday, -7), weeks + 1, overrides)) {
      const hit = mine.find((m) => m.start < o.end && o.start < m.end);
      if (hit) return { shift: other, date: hit.date };
    }
  }
  return null;
}

if (typeof module !== "undefined") {
  module.exports = {
    isoWeek, mondayOf, addDays, parseDate, isoDate, weekdayOf, inPattern, statusIn, occursIn,
    isPaused, buildOverrides, findClash, timeLabel, isNight, minutesByEmployee,
  };
}
