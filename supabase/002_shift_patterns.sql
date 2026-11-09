-- Migration 002: shift type, repeat pattern, pause period and night shifts.
-- Run once in Supabase: SQL Editor > New query > Run (after schema.sql).
-- Existing shifts become "every week" day shifts.

alter table public.shifts
  add column shift_type text not null default 'dag'
    check (shift_type in ('dag', 'avond', 'slaap')),
  -- weekly | even / odd (ISO week number) | every3 / every4 (counted from first_week)
  add column frequency text not null default 'weekly'
    check (frequency in ('weekly', 'even', 'odd', 'every3', 'every4')),
  add column first_week date, -- Monday of the first occurrence, needed for every3 / every4
  add column pause_from date, -- shift does not take place between these dates (inclusive)
  add column pause_until date;

alter table public.shifts
  add constraint shifts_first_week_needed
    check (frequency not in ('every3', 'every4') or first_week is not null),
  add constraint shifts_pause_complete
    check ((pause_from is null) = (pause_until is null)),
  add constraint shifts_pause_order
    check (pause_until >= pause_from),
  add constraint shifts_not_zero_length
    check (end_time <> start_time);

-- Night shifts: end_time may now be earlier than start_time (the shift ends the
-- next morning), so drop the old "end_time > start_time" check.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.shifts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%end_time > start_time%'
  loop
    execute format('alter table public.shifts drop constraint %I', c);
  end loop;
end $$;
