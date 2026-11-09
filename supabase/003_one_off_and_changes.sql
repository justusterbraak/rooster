-- Migration 003: one-off shifts, one-time changes / cancellations of a recurring
-- shift, and an end date for a recurring series.
-- Run once in Supabase: SQL Editor > New query > Run (after 002).
--
-- A one-time change is stored as a one-off shift ("once") that points to the
-- recurring shift it replaces on that date. With cancelled = true the recurring
-- shift simply does not take place that day.

alter table public.shifts drop constraint if exists shifts_frequency_check;
alter table public.shifts add constraint shifts_frequency_check
  check (frequency in ('weekly', 'even', 'odd', 'every3', 'every4', 'once'));

alter table public.shifts
  add column on_date date,   -- date of a one-off shift
  add column end_date date,  -- last day of a recurring series (inclusive), null = no end
  add column replaces uuid references public.shifts (id) on delete cascade,
  add column cancelled boolean not null default false;

alter table public.shifts
  add constraint shifts_once_has_date check (frequency <> 'once' or on_date is not null),
  add constraint shifts_replaces_is_once check (replaces is null or frequency = 'once'),
  add constraint shifts_cancel_needs_replaces check (not cancelled or replaces is not null),
  add constraint shifts_one_change_per_day unique (replaces, on_date);

-- Employees must see changes to their own recurring shifts (e.g. a colleague
-- takes over), otherwise their own schedule would still show the shift.
-- A security definer function avoids a policy on shifts that queries shifts.
create function public.is_my_shift(shift_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shifts
    where id = shift_id and employee_id = public.my_employee_id()
  );
$$;

create policy "employee reads changes to own shifts" on public.shifts
  for select to authenticated using (replaces is not null and public.is_my_shift(replaces));
