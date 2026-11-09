// Run with: node tests/schedule.test.js
const s = require("../schedule.js");

let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FOUT", label, ok ? "" : `-> kreeg ${JSON.stringify(got)}, verwacht ${JSON.stringify(want)}`);
}

const d = s.parseDate;
const mon = d("2026-11-09"); // week 46, even
const sh = (o) => ({ weekday: 0, start: "09:00", end: "11:00", frequency: "weekly", employeeId: "e1", clientId: "c1", ...o });
const clash = (a, b, extra = []) => {
  const candidate = sh(a);
  const others = [sh({ id: "x", ...b }), ...extra];
  return !!s.findClash(candidate, others, mon, s.buildOverrides([...others, candidate]));
};

// ISO weeks
eq("week 9 nov 2026 = 46", s.isoWeek(d("2026-11-09")), 46);
eq("week 28 dec 2026 = 53", s.isoWeek(d("2026-12-28")), 53);
eq("week 3 jan 2027 = 53", s.isoWeek(d("2027-01-03")), 53);
eq("week 4 jan 2027 = 1", s.isoWeek(d("2027-01-04")), 1);
eq("week 29 dec 2025 = 1", s.isoWeek(d("2025-12-29")), 1);
eq("week 29 mrt 2026 (zomertijd) = 13", s.isoWeek(d("2026-03-29")), 13);
eq("maandag van zo 15 nov", s.isoDate(s.mondayOf(d("2026-11-15"))), "2026-11-09");

// Repeat patterns
eq("even in week 46", s.inPattern(sh({ frequency: "even" }), mon), true);
eq("oneven niet in week 46", s.inPattern(sh({ frequency: "odd" }), mon), false);
const e4 = sh({ frequency: "every4", firstWeek: "2026-11-11" });
eq("1x/4wk: week 0", s.inPattern(e4, mon), true);
eq("1x/4wk: week +1", s.inPattern(e4, s.addDays(mon, 7)), false);
eq("1x/4wk: week +4", s.inPattern(e4, s.addDays(mon, 28)), true);
eq("1x/4wk: voor eerste keer", s.inPattern(e4, s.addDays(mon, -28)), false);
eq("1x/3wk: over zomertijd (+21 wk)", s.inPattern(sh({ frequency: "every3", firstWeek: "2026-11-09" }), s.addDays(mon, 21 * 7)), true);

// Pause
const p = sh({ weekday: 2, pauseFrom: "2026-11-11", pauseUntil: "2026-11-20" });
eq("pauze: woensdag 11 nov gaat niet door", s.occursIn(p, mon), null);
eq("pauze: status paused", s.statusIn(p, mon).status, "paused");
eq("pauze: woensdag 25 nov gaat door", s.isoDate(s.occursIn(p, s.addDays(mon, 14))), "2026-11-25");

// End date
const ending = sh({ weekday: 2, endDate: "2026-11-18" });
eq("einddatum: wo 18 nov gaat nog door", s.isoDate(s.occursIn(ending, s.addDays(mon, 7))), "2026-11-18");
eq("einddatum: wo 25 nov niet meer", s.statusIn(ending, s.addDays(mon, 14)), null);

// One-off shifts
const once = sh({ id: "o", frequency: "once", onDate: "2026-11-12", weekday: 3 });
eq("eenmalig: in week 46 op do 12 nov", s.isoDate(s.occursIn(once, mon)), "2026-11-12");
eq("eenmalig: niet in week 47", s.occursIn(once, s.addDays(mon, 7)), null);

// One-time changes of a recurring shift
const base = sh({ id: "b" });
const sub = sh({ id: "r", frequency: "once", onDate: "2026-11-16", weekday: 0, replaces: "b", employeeId: "e2" });
const cancel = sh({ id: "c", frequency: "once", onDate: "2026-11-23", weekday: 0, replaces: "b", cancelled: true });
const ov = s.buildOverrides([base, sub, cancel]);
eq("vervangen: status replaced op 16 nov", s.statusIn(base, s.addDays(mon, 7), ov).status, "replaced");
eq("vervangen: invaldienst gaat door", s.isoDate(s.occursIn(sub, s.addDays(mon, 7), ov)), "2026-11-16");
eq("afgezegd: status cancelled op 23 nov", s.statusIn(base, s.addDays(mon, 14), ov).status, "cancelled");
eq("afgezegd: afzegging is zelf geen dienst", s.statusIn(cancel, s.addDays(mon, 14), ov), null);
eq("week erna weer normaal", s.statusIn(base, s.addDays(mon, 21), ov).status, "normal");

// Clashes
eq("zelfde tijd elke week", clash({}, {}), true);
eq("aansluitend 11-13", clash({ start: "11:00", end: "13:00" }, {}), false);
eq("even vs oneven: geen botsing", clash({ frequency: "even" }, { frequency: "odd" }), false);
eq("even vs elke week: botsing", clash({ frequency: "even" }, {}), true);
eq("nacht ma 23-07 vs di 06-08", clash({ start: "23:00", end: "07:00" }, { weekday: 1, start: "06:00", end: "08:00" }), true);
eq("nacht ma 23-07 vs di 07-09", clash({ start: "23:00", end: "07:00" }, { weekday: 1, start: "07:00", end: "09:00" }), false);
eq("nacht zo (even) vs ma 06-08 (oneven)", clash({ weekday: 6, start: "23:00", end: "07:00", frequency: "even" }, { weekday: 0, start: "06:00", end: "08:00", frequency: "odd" }), true);
// Week 53 (odd) is followed by week 1 (odd): Sunday 3 Jan night runs into Monday 4 Jan.
const yearEnd = s.findClash(
  sh({ weekday: 6, start: "23:00", end: "07:00", frequency: "odd" }),
  [sh({ id: "x", weekday: 0, start: "06:00", end: "08:00", frequency: "odd" })],
  mon
);
eq("nacht zo (oneven) vs ma (oneven): alleen rond jaarwisseling", s.isoDate(yearEnd.date), "2027-01-03");
eq("1x/3wk vs 1x/4wk andere start: botsen ooit", clash({ frequency: "every3", firstWeek: "2026-11-09" }, { frequency: "every4", firstWeek: "2026-11-16" }), true);
eq("1x/4wk vs 1x/4wk andere week: nooit", clash({ frequency: "every4", firstWeek: "2026-11-09" }, { frequency: "every4", firstWeek: "2026-11-16" }), false);
eq("botsing valt in pauze: geen botsing", clash({ pauseFrom: "2026-01-01", pauseUntil: "2028-01-01" }, {}), false);
eq("zichzelf bewerken", !!s.findClash(sh({ id: "x" }), [sh({ id: "x" })], mon), false);
eq("reeks met einddatum vs reeks erna: geen botsing", clash({ endDate: "2026-12-31" }, { frequency: "once", onDate: "2027-01-04" }), false);
eq("eenmalig vs vaste dienst zelfde moment: botsing", clash({ frequency: "once", onDate: "2026-11-16", weekday: 0 }, {}), true);
// Invaller e2 takes over b on 16 Nov; e1 (owner of b) is free then.
eq("invaller: botst niet met de dienst die hij vervangt",
  clash({ id: "r", frequency: "once", onDate: "2026-11-16", replaces: "x", employeeId: "e2" }, { employeeId: "e1" }), false);
eq("vaste werknemer is vrij op vervangen dag",
  !!s.findClash(sh({ frequency: "once", onDate: "2026-11-16", clientId: "c9" }), [base], mon, s.buildOverrides([base, sub])), false);
eq("vaste werknemer is vrij op afgezegde dag",
  !!s.findClash(sh({ frequency: "once", onDate: "2026-11-23", clientId: "c9" }), [base], mon, s.buildOverrides([base, cancel])), false);
eq("invaller zelf bezet op dat moment",
  !!s.findClash(sub, [sh({ id: "y", employeeId: "e2", clientId: "c7" })], mon, s.buildOverrides([base, sub])), true);

eq("label nacht", s.timeLabel(sh({ start: "23:00", end: "07:00" })), "23:00 - 07:00 (volgende dag)");

// Hours per month (November 2026 has 5 Mondays: 2, 9, 16, 23, 30)
const nov = [d("2026-11-01"), d("2026-11-30")];
const hours = (list) => s.minutesByEmployee(list, ...nov);
const weeklyMon = sh({ id: "m", type: "dag" }); // 2 hours
eq("uren: 5 maandagen x 2 uur", hours([weeklyMon]).e1, { count: 5, dag: 600, avond: 0, slaap: 0, total: 600 });
eq("uren: nachtdienst telt volledig (8 uur), 4 zaterdagen",
  hours([sh({ id: "z", weekday: 5, start: "23:00", end: "07:00", type: "slaap" })]).e1.slaap, 4 * 480);
// Saturday 31 Oct 23:00 starts in October; Monday 30 Nov night starts in November.
eq("uren: nacht vanaf 31 okt telt niet voor november",
  hours([sh({ id: "o", frequency: "once", onDate: "2026-10-31", weekday: 5, start: "23:00", end: "07:00", type: "slaap" })]).e1, undefined);
eq("uren: nacht op 30 nov telt voor november",
  hours([sh({ id: "o", frequency: "once", onDate: "2026-11-30", weekday: 0, start: "23:00", end: "07:00", type: "slaap" })]).e1.slaap, 480);
const subNov = sh({ id: "r", frequency: "once", onDate: "2026-11-16", replaces: "m", employeeId: "e2", type: "avond" });
const cancelNov = sh({ id: "c", frequency: "once", onDate: "2026-11-23", replaces: "m", cancelled: true });
const withChanges = hours([weeklyMon, subNov, cancelNov]);
eq("uren: vaste werknemer zonder invaldag en afgezegde dag", withChanges.e1.total, 3 * 120);
eq("uren: invaller krijgt de uren, met eigen type", withChanges.e2, { count: 1, dag: 0, avond: 120, slaap: 0, total: 120 });
eq("uren: gepauzeerde weken tellen niet",
  hours([sh({ id: "p", pauseFrom: "2026-11-01", pauseUntil: "2026-11-15" })]).e1.total, 3 * 120);

console.log(failed ? `\n${failed} FOUT` : "\nalles OK");
process.exitCode = failed ? 1 : 0;
