// Data layer: talks to Supabase. Row Level Security in the database decides who
// may see or change what (see supabase/schema.sql); this file only translates
// between the app and the tables.

const SUPABASE_URL = "https://cfkoqwtmbigadcvmoodw.supabase.co";
const SUPABASE_KEY = "sb_publishable_4ul89VgbiEIk66i3jWGksA_QlW3UkzJ"; // publishable key, safe to ship

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ERRORS = {
  23505: "Dit e-mailadres is al in gebruik bij een andere werknemer.",
  23503: "Dit wordt nog gebruikt in het rooster. Verwijder of verplaats die diensten eerst.",
};

async function q(request) {
  const { data, error } = await request;
  if (error) throw new Error(ERRORS[error.code] ?? error.message);
  return data;
}

function toShift(row) {
  return {
    id: row.id,
    weekday: row.weekday,
    start: row.start_time.slice(0, 5),
    end: row.end_time.slice(0, 5),
    clientId: row.client_id,
    employeeId: row.employee_id,
    type: row.shift_type,
    frequency: row.frequency,
    firstWeek: row.first_week,
    pauseFrom: row.pause_from,
    pauseUntil: row.pause_until,
    onDate: row.on_date,
    endDate: row.end_date,
    replaces: row.replaces,
    cancelled: row.cancelled,
  };
}

function save(table, id, row) {
  return q(id ? sb.from(table).update(row).eq("id", id) : sb.from(table).insert(row));
}

const db = {
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error("Inloggen mislukt. Controleer je e-mail en wachtwoord.");
  },
  async signOut() {
    await sb.auth.signOut();
  },
  // Returns { role: "admin" }, { role: "employee", id } or null when not logged in.
  async currentUser() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    if (await q(sb.rpc("is_admin"))) return { role: "admin" };
    const rows = await q(sb.from("employees").select("id"));
    if (rows.length === 1) return { role: "employee", id: rows[0].id };
    await sb.auth.signOut();
    throw new Error("Dit account is niet gekoppeld aan een werknemer. Vraag de beheerder om je e-mailadres toe te voegen.");
  },

  async listEmployees() {
    return q(sb.from("employees").select("id, name, email").order("name"));
  },
  async saveEmployee({ id, name, email }) {
    await save("employees", id, { name, email: email.trim().toLowerCase() });
  },
  async deleteEmployee(id) {
    await q(sb.from("employees").delete().eq("id", id));
  },

  async listClients() {
    return q(sb.from("clients").select("id, name, address, note").order("name"));
  },
  async saveClient({ id, name, address, note }) {
    await save("clients", id, { name, address, note });
  },
  async deleteClient(id) {
    await q(sb.from("clients").delete().eq("id", id));
  },

  async listShifts() {
    const rows = await q(sb.from("shifts").select("*").order("weekday").order("start_time"));
    return rows.map(toShift);
  },
  async saveShift({ id, weekday, start, end, clientId, employeeId, type, frequency, firstWeek, pauseFrom, pauseUntil, onDate, endDate, replaces, cancelled }) {
    await save("shifts", id, {
      weekday,
      start_time: start,
      end_time: end,
      client_id: clientId,
      employee_id: employeeId,
      shift_type: type,
      frequency,
      first_week: firstWeek || null,
      pause_from: pauseFrom || null,
      pause_until: pauseUntil || null,
      on_date: onDate || null,
      end_date: endDate || null,
      replaces: replaces || null,
      cancelled: !!cancelled,
    });
  },
  async deleteShift(id) {
    await q(sb.from("shifts").delete().eq("id", id));
  },
};
