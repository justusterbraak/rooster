-- Database setup for the rooster app. Run once in Supabase: SQL Editor > New query > Run.
--
-- Security model (Row Level Security):
--   * Admins (emails in the "admins" table) may read and change everything.
--   * An employee is linked to a login by email address. They can only read
--     their own employee row, their own shifts and the clients they visit.
--   * Not logged in: no access at all.
-- Turn OFF "Allow new users to sign up" in Authentication, so only accounts
-- created by the admin can log in.

create table public.admins (
  email text primary key
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

-- weekday: 0 = Monday ... 6 = Sunday
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  client_id uuid not null references public.clients (id) on delete restrict,
  employee_id uuid not null references public.employees (id) on delete restrict,
  created_at timestamptz not null default now()
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

create function public.my_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employees where lower(email) = lower(auth.jwt() ->> 'email');
$$;

alter table public.admins enable row level security;
alter table public.employees enable row level security;
alter table public.clients enable row level security;
alter table public.shifts enable row level security;

-- admins: no policies, so the table is not readable through the API.

create policy "admin full access" on public.employees
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "employee reads self" on public.employees
  for select to authenticated using (id = public.my_employee_id());

create policy "admin full access" on public.clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "employee reads own clients" on public.clients
  for select to authenticated using (
    exists (
      select 1 from public.shifts s
      where s.client_id = clients.id and s.employee_id = public.my_employee_id()
    )
  );

create policy "admin full access" on public.shifts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "employee reads own shifts" on public.shifts
  for select to authenticated using (employee_id = public.my_employee_id());

grant select, insert, update, delete on public.employees, public.clients, public.shifts to authenticated;
grant execute on function public.is_admin() to authenticated;
