const DAYS = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

const app = document.getElementById("app");
const dlg = document.getElementById("dlg");

let user = null; // { role: "admin" } or { role: "employee", id }
let loginError = "";
let adminTab = "rooster";
let filterEmployee = "";
let viewMonday = mondayOf(new Date());
let viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function nameOf(list, id) {
  return list.find((x) => x.id === id)?.name ?? "?";
}

function shortDate(d) {
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function longDate(d) {
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

function weekNav() {
  const week = isoWeek(viewMonday);
  const isCurrent = isoDate(viewMonday) === isoDate(mondayOf(new Date()));
  return `
    <div class="weeknav">
      <button data-week="-1" aria-label="Vorige week">‹</button>
      <div>
        <strong>Week ${week} (${week % 2 ? "oneven" : "even"})</strong><br>
        <span class="muted">${shortDate(viewMonday)} - ${shortDate(addDays(viewMonday, 6))}</span>
      </div>
      <button data-week="1" aria-label="Volgende week">›</button>
    </div>
    ${isCurrent ? "" : `<button class="link" data-week="0">Naar deze week</button>`}`;
}

function bindWeekNav() {
  app.querySelectorAll("[data-week]").forEach((b) => {
    b.onclick = () => {
      const step = Number(b.dataset.week);
      viewMonday = step === 0 ? mondayOf(new Date()) : addDays(viewMonday, 7 * step);
      render();
    };
  });
}

function dayHeading(i) {
  return `${DAYS[i]} <span class="muted">${shortDate(addDays(viewMonday, i))}</span>`;
}

async function render() {
  try {
    if (!user) return renderLogin();
    if (user.role === "admin") return await renderAdmin();
    return await renderEmployee();
  } catch (e) {
    app.innerHTML = `<div class="card"><p class="error">Er ging iets mis: ${esc(e.message)}</p>
      <button onclick="location.reload()">Opnieuw proberen</button></div>`;
  }
}

async function start() {
  try {
    user = await db.currentUser();
  } catch (e) {
    loginError = e.message;
  }
  render();
}

// ---------- Login ----------

function renderLogin() {
  app.innerHTML = `
    <form class="card login" id="login">
      <h1>Rooster</h1>
      <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
      <label>Wachtwoord<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" ${loginError ? "" : "hidden"}>${esc(loginError)}</p>
      <button type="submit" class="primary">Inloggen</button>
    </form>`;

  const form = document.getElementById("login");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await db.signIn(form.email.value, form.password.value);
      user = await db.currentUser();
      loginError = "";
    } catch (err) {
      loginError = err.message;
    }
    render();
  };
}

function header(title) {
  return `<header><h1>${esc(title)}</h1><button id="logout" class="link">Uitloggen</button></header>`;
}

function bindLogout() {
  document.getElementById("logout").onclick = async () => {
    await db.signOut();
    user = null;
    viewMonday = mondayOf(new Date());
    render();
  };
}

// ---------- Admin ----------

async function renderAdmin() {
  const [employees, clients, shifts] = await Promise.all([db.listEmployees(), db.listClients(), db.listShifts()]);

  const tabs = [
    ["rooster", "Rooster"],
    ["werknemers", "Werknemers"],
    ["zorgvragers", "Zorgvragers"],
    ["uren", "Uren"],
  ];
  const nav = `<nav class="tabs">${tabs
    .map(([key, label]) => `<button data-tab="${key}" class="${key === adminTab ? "active" : ""}">${label}</button>`)
    .join("")}</nav>`;

  let body;
  if (adminTab === "rooster") body = rosterTab(employees, clients, shifts);
  else if (adminTab === "werknemers") body = employeesTab(employees);
  else if (adminTab === "zorgvragers") body = clientsTab(clients);
  else body = hoursTab(employees, shifts);

  app.innerHTML = header("Beheer") + nav + body;
  bindLogout();
  app.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      adminTab = b.dataset.tab;
      render();
    };
  });

  if (adminTab === "rooster") {
    bindWeekNav();
    document.getElementById("filter").onchange = (e) => {
      filterEmployee = e.target.value;
      render();
    };
    const ctx = { employees, clients, shifts };
    const overrides = buildOverrides(shifts);
    document.getElementById("add").onclick = () => shiftForm(null, ctx);
    app.querySelectorAll("[data-shift]").forEach((b) => {
      b.onclick = () => {
        const shift = shifts.find((s) => s.id === b.dataset.shift);
        shiftClicked(shift, statusIn(shift, viewMonday, overrides), ctx);
      };
    });
  } else if (adminTab === "werknemers") {
    document.getElementById("add").onclick = () => employeeForm(null);
    app.querySelectorAll("[data-employee]").forEach((b) => {
      b.onclick = () => employeeForm(employees.find((e) => e.id === b.dataset.employee));
    });
  } else if (adminTab === "zorgvragers") {
    document.getElementById("add").onclick = () => clientForm(null);
    app.querySelectorAll("[data-client]").forEach((b) => {
      b.onclick = () => clientForm(clients.find((c) => c.id === b.dataset.client));
    });
  } else {
    app.querySelectorAll("[data-month]").forEach((b) => {
      b.onclick = () => {
        const step = Number(b.dataset.month);
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + step, 1);
        render();
      };
    });
    document.getElementById("download").onclick = () =>
      downloadHours(employees, shifts).catch((e) => alert(e.message));
  }
}

function rosterTab(employees, clients, shifts) {
  const overrides = buildOverrides(shifts);
  const visible = filterEmployee ? shifts.filter((s) => s.employeeId === filterEmployee) : shifts;
  return `
    <div class="toolbar">
      <select id="filter">
        <option value="">Alle werknemers</option>
        ${employees
          .map((e) => `<option value="${esc(e.id)}" ${e.id === filterEmployee ? "selected" : ""}>${esc(e.name)}</option>`)
          .join("")}
      </select>
      <button id="add" class="primary">+ Nieuwe dienst</button>
    </div>
    ${weekNav()}
    ${DAYS.map((day, i) => {
      // Paused and cancelled shifts stay visible (greyed out) so the admin can find
      // and change them. A replaced shift is hidden; its replacement is shown instead.
      const list = visible
        .map((shift) => ({ shift, state: statusIn(shift, viewMonday, overrides) }))
        .filter(({ state }) => state && state.status !== "replaced" && weekdayOf(state.date) === i)
        .sort((a, b) => a.shift.start.localeCompare(b.shift.start));
      return `<section><h2>${dayHeading(i)}</h2>${
        list.length
          ? list.map(({ shift, state }) => adminShiftCard(shift, state, employees, clients, shifts)).join("")
          : `<p class="muted">Geen diensten</p>`
      }</section>`;
    }).join("")}`;
}

function adminShiftCard(s, state, employees, clients, shifts) {
  const greyed = state.status === "paused" || state.status === "cancelled";
  const original = s.replaces && shifts.find((x) => x.id === s.replaces);
  const tags = [
    TYPE_LABELS[s.type],
    FREQUENCY_TAGS[s.frequency],
    original && `invaller voor ${nameOf(employees, original.employeeId)}`,
    s.endDate && `t/m ${shortDate(parseDate(s.endDate))}`,
    state.status === "paused" && `Pauze tot en met ${shortDate(parseDate(s.pauseUntil))}`,
    state.status === "cancelled" && "Gaat deze keer niet door",
  ].filter(Boolean);
  return `
    <button class="item ${greyed ? "paused" : ""}" data-shift="${esc(s.id)}">
      <span class="time">${esc(timeLabel(s))}</span>
      <span>${esc(nameOf(clients, s.clientId))}</span>
      <span class="muted">${esc(nameOf(employees, s.employeeId))}</span>
      <span class="tags">${esc(tags.join(" · "))}</span>
    </button>`;
}

// What happens when the admin clicks a shift in the week view.
function shiftClicked(shift, state, ctx) {
  const { clients, shifts } = ctx;
  if (shift.frequency === "once") {
    const original = shift.replaces && shifts.find((s) => s.id === shift.replaces);
    return original ? changeForm(original, state.date, ctx, shift) : shiftForm(shift, ctx);
  }
  const title = `${nameOf(clients, shift.clientId)}, ${longDate(state.date)}`;
  if (state.status === "cancelled") {
    return openChoice(title, "Deze dienst gaat deze keer niet door.", [
      ["Toch laten doorgaan", () => db.deleteShift(state.change.id)],
      ["Vaste dienst wijzigen", () => shiftForm(shift, ctx)],
    ]);
  }
  if (state.status === "paused") return shiftForm(shift, ctx);
  openChoice(title, `${timeLabel(shift)}, ${FREQUENCY_TAGS[shift.frequency] || "elke week"}`, [
    ["Alleen deze keer wijzigen (bijv. invaller)", () => changeForm(shift, state.date, ctx, null)],
    [
      "Gaat deze keer niet door",
      () =>
        db.saveShift({
          ...shift,
          id: undefined,
          frequency: "once",
          onDate: isoDate(state.date),
          firstWeek: null,
          endDate: null,
          pauseFrom: null,
          pauseUntil: null,
          replaces: shift.id,
          cancelled: true,
        }),
    ],
    ["Vaste dienst wijzigen (alle weken)", () => shiftForm(shift, ctx)],
  ]);
}

// Change one occurrence of a recurring shift, e.g. a substitute employee.
// `existing` is the earlier change for that date, if any.
function changeForm(original, date, ctx, existing) {
  const { employees, clients, shifts } = ctx;
  const base = existing ?? original;
  openForm({
    title: `${nameOf(clients, original.clientId)}, alleen ${longDate(date)}`,
    fields: [
      { name: "employeeId", label: "Werknemer", type: "select", options: employees.map((e) => [e.id, e.name]), value: base.employeeId },
      { name: "type", label: "Type dienst", type: "select", options: TYPES, value: base.type },
      { name: "start", label: "Van", type: "time", value: base.start, required: true },
      { name: "end", label: "Tot (eerder dan Van = volgende ochtend)", type: "time", value: base.end, required: true },
    ],
    onSave: async (v) => {
      const candidate = {
        ...v,
        id: existing?.id,
        frequency: "once",
        onDate: isoDate(date),
        weekday: weekdayOf(date),
        clientId: original.clientId,
        replaces: original.id,
      };
      if (candidate.start === candidate.end) throw new Error("Begin- en eindtijd mogen niet gelijk zijn.");
      checkOverlap(candidate, shifts, employees, clients);
      await db.saveShift(candidate);
    },
    onDelete: existing && (() => db.deleteShift(existing.id)),
    deleteLabel: "Wijziging terugdraaien",
  });
}

function employeesTab(employees) {
  return `
    <div class="toolbar"><span class="spacer"></span><button id="add" class="primary">+ Nieuwe werknemer</button></div>
    ${employees
      .map(
        (e) => `
      <button class="item" data-employee="${esc(e.id)}">
        <strong>${esc(e.name)}</strong>
        <span class="muted">${esc(e.email)}</span>
      </button>`
      )
      .join("") || `<p class="muted">Nog geen werknemers</p>`}`;
}

function clientsTab(clients) {
  return `
    <div class="toolbar"><span class="spacer"></span><button id="add" class="primary">+ Nieuwe zorgvrager</button></div>
    ${clients
      .map(
        (c) => `
      <button class="item" data-client="${esc(c.id)}">
        <strong>${esc(c.name)}</strong>
        <span class="muted">${esc(c.address)}</span>
      </button>`
      )
      .join("") || `<p class="muted">Nog geen zorgvragers</p>`}`;
}

// ---------- Hours per month ----------

function monthLabel() {
  return viewMonth.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

// One row per employee plus a total row, with minutes per shift type.
function hoursRows(employees, shifts) {
  const lastDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
  const minutes = minutesByEmployee(shifts, viewMonth, lastDay);
  const empty = { count: 0, dag: 0, avond: 0, slaap: 0, total: 0 };
  const rows = employees.map((e) => ({ name: e.name, ...(minutes[e.id] ?? empty) }));
  const total = { name: "Totaal", ...empty };
  for (const row of rows) for (const key of Object.keys(empty)) total[key] += row[key];
  return { rows, total };
}

function formatHours(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function hoursTab(employees, shifts) {
  const { rows, total } = hoursRows(employees, shifts);
  const tr = (r, cell) => `<tr>
      <${cell}>${esc(r.name)}</${cell}><${cell}>${r.count}</${cell}>
      <${cell}>${formatHours(r.dag)}</${cell}><${cell}>${formatHours(r.avond)}</${cell}>
      <${cell}>${formatHours(r.slaap)}</${cell}><${cell}>${formatHours(r.total)}</${cell}>
    </tr>`;
  return `
    <div class="weeknav">
      <button data-month="-1" aria-label="Vorige maand">‹</button>
      <strong>${esc(monthLabel())}</strong>
      <button data-month="1" aria-label="Volgende maand">›</button>
    </div>
    <p class="muted">Geplande uren volgens het rooster. Een nachtdienst telt mee in de maand waarin hij begint.</p>
    <div class="table-wrap">
      <table class="hours">
        <thead><tr><th>Werknemer</th><th>Diensten</th><th>Dag</th><th>Avond</th><th>Slaap</th><th>Totaal</th></tr></thead>
        <tbody>${rows.map((r) => tr(r, "td")).join("")}</tbody>
        <tfoot>${tr(total, "th")}</tfoot>
      </table>
    </div>
    <button id="download">Download als Excel</button>`;
}

// SheetJS (Excel files) is only loaded when someone downloads, to keep the app light.
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Downloaden lukt nu niet. Controleer je internetverbinding."));
    document.head.appendChild(script);
  });
}

// A real .xlsx, so it opens the same in Dutch and English Excel and hours are numbers.
async function downloadHours(employees, shifts) {
  const { rows, total } = hoursRows(employees, shifts);
  const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;
  const data = [
    ["Werknemer", "Diensten", "Dag (uren)", "Avond (uren)", "Slaap (uren)", "Totaal (uren)"],
    ...[...rows, total].map((r) => [r.name, r.count, hours(r.dag), hours(r.avond), hours(r.slaap), hours(r.total)]),
  ];
  const month = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}`;

  await loadSheetJs();
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 13 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, `Uren ${month}`);
  XLSX.writeFile(book, `uren-${month}.xlsx`);
}

// Throws if the employee or the client already has another shift at the same time
// in the coming 12 months, taking repeat patterns, pauses, one-time changes and
// night shifts into account.
function checkOverlap(candidate, shifts, employees, clients) {
  const from = mondayOf(new Date());
  const overrides = buildOverrides([...shifts.filter((s) => s.id !== candidate.id), candidate]);
  const describe = (clash) =>
    `${DAYS[clash.shift.weekday].toLowerCase()} ${timeLabel(clash.shift)}`;
  const when = (clash) => `${longDate(clash.date)} (week ${isoWeek(clash.date)})`;

  const byEmployee = findClash(candidate, shifts.filter((s) => s.employeeId === candidate.employeeId), from, overrides);
  if (byEmployee) {
    throw new Error(
      `Botsing op ${when(byEmployee)}: ${nameOf(employees, candidate.employeeId)} werkt dan al bij ${nameOf(clients, byEmployee.shift.clientId)} (${describe(byEmployee)}).`
    );
  }
  const byClient = findClash(candidate, shifts.filter((s) => s.clientId === candidate.clientId), from, overrides);
  if (byClient) {
    throw new Error(
      `Botsing op ${when(byClient)}: ${nameOf(clients, candidate.clientId)} heeft dan al een dienst met ${nameOf(employees, byClient.shift.employeeId)} (${describe(byClient)}).`
    );
  }
}

// Create or edit a recurring series or a one-off shift.
function shiftForm(shift, { employees, clients, shifts }) {
  if (!employees.length || !clients.length) {
    alert("Voeg eerst minstens één werknemer en één zorgvrager toe.");
    return;
  }
  const recurringOnly = { field: "frequency", values: RECURRING };
  openForm({
    title: shift ? "Dienst bewerken" : "Nieuwe dienst",
    fields: [
      { name: "frequency", label: "Herhaling", type: "select", options: FREQUENCIES, value: shift?.frequency ?? "weekly" },
      {
        name: "onDate",
        label: "Datum",
        type: "date",
        value: shift?.onDate ?? isoDate(viewMonday),
        showWhen: { field: "frequency", values: ["once"] },
      },
      { name: "weekday", label: "Dag", type: "select", options: DAYS.map((d, i) => [String(i), d]), value: String(shift?.weekday ?? 0), showWhen: recurringOnly },
      {
        name: "firstWeek",
        label: "Eerste keer in de week van",
        type: "date",
        value: shift?.firstWeek ?? isoDate(viewMonday),
        showWhen: { field: "frequency", values: ["every3", "every4"] },
      },
      { name: "type", label: "Type dienst", type: "select", options: TYPES, value: shift?.type ?? "dag" },
      { name: "start", label: "Van", type: "time", value: shift?.start ?? "09:00", required: true },
      { name: "end", label: "Tot (eerder dan Van = volgende ochtend)", type: "time", value: shift?.end ?? "11:00", required: true },
      { name: "clientId", label: "Zorgvrager", type: "select", options: clients.map((c) => [c.id, c.name]), value: shift?.clientId },
      { name: "employeeId", label: "Werknemer", type: "select", options: employees.map((e) => [e.id, e.name]), value: shift?.employeeId ?? filterEmployee },
      { name: "endDate", label: "Laatste dag van de reeks (optioneel)", type: "date", value: shift?.endDate, showWhen: recurringOnly },
      { name: "pauseFrom", label: "Pauze van (optioneel)", type: "date", value: shift?.pauseFrom, showWhen: recurringOnly },
      { name: "pauseUntil", label: "Pauze tot en met (optioneel)", type: "date", value: shift?.pauseUntil, showWhen: recurringOnly },
    ],
    onSave: async (v) => {
      const candidate = { id: shift?.id, ...v };
      if (candidate.start === candidate.end) throw new Error("Begin- en eindtijd mogen niet gelijk zijn.");
      if (candidate.frequency === "once") {
        if (!candidate.onDate) throw new Error("Kies een datum.");
        Object.assign(candidate, {
          weekday: weekdayOf(parseDate(candidate.onDate)),
          firstWeek: null,
          endDate: null,
          pauseFrom: null,
          pauseUntil: null,
        });
      } else {
        candidate.weekday = Number(candidate.weekday);
        candidate.onDate = null;
        if (candidate.frequency === "every3" || candidate.frequency === "every4") {
          if (!candidate.firstWeek) throw new Error("Kies in welke week de dienst voor het eerst is.");
          candidate.firstWeek = isoDate(mondayOf(parseDate(candidate.firstWeek)));
        } else {
          candidate.firstWeek = null;
        }
        if (!candidate.pauseFrom !== !candidate.pauseUntil) throw new Error("Vul bij een pauze zowel de begin- als de einddatum in.");
        if (candidate.pauseFrom && candidate.pauseUntil < candidate.pauseFrom) throw new Error("De pauze moet eindigen na de begindatum.");
      }
      checkOverlap(candidate, shifts, employees, clients);
      await db.saveShift(candidate);
    },
    onDelete: shift && (() => db.deleteShift(shift.id)),
  });
}

function employeeForm(employee) {
  openForm({
    title: employee ? "Werknemer bewerken" : "Nieuwe werknemer",
    fields: [
      { name: "name", label: "Naam", value: employee?.name, required: true },
      { name: "email", label: "E-mail", type: "email", value: employee?.email, required: true },
    ],
    onSave: (v) => db.saveEmployee({ id: employee?.id, ...v }),
    onDelete: employee && (() => db.deleteEmployee(employee.id)),
  });
}

function clientForm(client) {
  openForm({
    title: client ? "Zorgvrager bewerken" : "Nieuwe zorgvrager",
    fields: [
      { name: "name", label: "Naam", value: client?.name, required: true },
      { name: "address", label: "Adres", value: client?.address, required: true },
      { name: "note", label: "Notitie voor werknemers (geen medische info)", type: "textarea", value: client?.note },
    ],
    onSave: (v) => db.saveClient({ id: client?.id, ...v }),
    onDelete: client && (() => db.deleteClient(client.id)),
  });
}

// ---------- Generic form dialog ----------

function fieldHtml(f) {
  const value = esc(f.value ?? "");
  let input;
  if (f.type === "select") {
    input = `<select name="${f.name}">${f.options
      .map(([val, label]) => `<option value="${esc(val)}" ${val === f.value ? "selected" : ""}>${esc(label)}</option>`)
      .join("")}</select>`;
  } else if (f.type === "textarea") {
    input = `<textarea name="${f.name}" rows="3">${value}</textarea>`;
  } else {
    input = `<input name="${f.name}" type="${f.type || "text"}" value="${value}" ${f.required ? "required" : ""}>`;
  }
  const showWhen = f.showWhen
    ? ` data-show-field="${f.showWhen.field}" data-show-values="${f.showWhen.values.join(",")}"`
    : "";
  return `<label${showWhen}>${esc(f.label)}${input}</label>`;
}

function openForm({ title, fields, onSave, onDelete, deleteLabel = "Verwijderen" }) {
  dlg.innerHTML = `
    <form>
      <h2>${esc(title)}</h2>
      ${fields.map(fieldHtml).join("")}
      <p class="error" hidden></p>
      <div class="actions">
        ${onDelete ? `<button type="button" class="danger" data-act="delete">${esc(deleteLabel)}</button>` : ""}
        <span class="spacer"></span>
        <button type="button" data-act="cancel">Annuleren</button>
        <button type="submit" class="primary">Opslaan</button>
      </div>
    </form>`;

  const form = dlg.querySelector("form");
  const error = dlg.querySelector(".error");
  const run = async (fn) => {
    try {
      await fn();
      dlg.close();
      render();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  };

  // Fields with showWhen are only visible for certain values of another field.
  const updateVisibility = () => {
    form.querySelectorAll("[data-show-field]").forEach((label) => {
      const value = form.elements[label.dataset.showField].value;
      label.hidden = !label.dataset.showValues.split(",").includes(value);
    });
  };
  form.onchange = updateVisibility;
  updateVisibility();

  form.onsubmit = (e) => {
    e.preventDefault();
    run(() => onSave(Object.fromEntries(new FormData(form))));
  };
  dlg.querySelector('[data-act="cancel"]').onclick = () => dlg.close();
  if (onDelete) {
    dlg.querySelector('[data-act="delete"]').onclick = () => {
      if (confirm("Weet je het zeker?")) run(onDelete);
    };
  }
  if (!dlg.open) dlg.showModal();
}

// A dialog with a few options. An option that returns a promise (a database change)
// is awaited and followed by a re-render; other options open the next dialog.
function openChoice(title, text, choices) {
  dlg.innerHTML = `
    <div class="choice">
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(text)}</p>
      ${choices.map(([label], i) => `<button type="button" data-choice="${i}">${esc(label)}</button>`).join("")}
      <p class="error" hidden></p>
      <button type="button" class="link" data-act="cancel">Annuleren</button>
    </div>`;

  dlg.querySelectorAll("[data-choice]").forEach((b) => {
    b.onclick = async () => {
      const result = choices[Number(b.dataset.choice)][1]();
      if (!(result instanceof Promise)) return;
      try {
        await result;
        dlg.close();
        render();
      } catch (e) {
        const error = dlg.querySelector(".error");
        error.textContent = e.message;
        error.hidden = false;
      }
    };
  });
  dlg.querySelector('[data-act="cancel"]').onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
}

// ---------- Employee ----------

async function renderEmployee() {
  const [employees, clients, shifts] = await Promise.all([db.listEmployees(), db.listClients(), db.listShifts()]);
  const me = employees.find((e) => e.id === user.id);
  if (!me) {
    await db.signOut();
    user = null;
    return render();
  }
  // `shifts` holds the employee's own shifts plus changes to them made for a
  // colleague (see the "changes to own shifts" policy in the database).
  const overrides = buildOverrides(shifts);
  const mine = shifts.filter((s) => s.employeeId === me.id);
  const today = isoDate(new Date());

  app.innerHTML =
    header(`Hoi ${me.name.split(" ")[0]}`) +
    weekNav() +
    DAYS.map((day, i) => {
      const date = addDays(viewMonday, i);
      const isToday = isoDate(date) === today;
      const list = mine
        .map((shift) => ({ shift, state: statusIn(shift, viewMonday, overrides) }))
        .filter(({ shift, state }) => {
          if (!state || state.status === "paused" || weekdayOf(state.date) !== i) return false;
          // Changed for this employee only (e.g. other times): the change itself is shown.
          return !(state.status === "replaced" && state.change.employeeId === me.id);
        })
        .sort((a, b) => a.shift.start.localeCompare(b.shift.start));
      return `<section class="${isToday ? "today" : ""}">
        <h2>${dayHeading(i)}${isToday ? ' <span class="badge">Vandaag</span>' : ""}</h2>
        ${
          list.length
            ? list.map(({ shift, state }) => employeeShiftCard(shift, state, clients, shifts)).join("")
            : `<p class="muted">Vrij</p>`
        }
      </section>`;
    }).join("");
  bindLogout();
  bindWeekNav();
}

function employeeShiftCard(s, state, clients, shifts) {
  const c = clients.find((x) => x.id === s.clientId) ?? {};
  const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(c.address ?? "");
  const notHappening =
    state.status === "cancelled" ? "Gaat deze keer niet door" :
    state.status === "replaced" ? "Een collega neemt deze dienst over" : "";
  // A change to one of the employee's own shifts is "Gewijzigd"; a change to a
  // colleague's shift (not readable for this employee) means they are the substitute.
  const label = s.replaces
    ? shifts.some((x) => x.id === s.replaces) ? "Gewijzigd" : "Invaldienst"
    : s.frequency === "once" ? "Eenmalig" : "";
  const tags = [TYPE_LABELS[s.type], label, notHappening].filter(Boolean);
  return `<div class="item ${notHappening ? "paused" : ""}">
    <span class="time">${esc(timeLabel(s))}</span>
    <strong>${esc(c.name)}</strong>
    ${notHappening ? "" : `<a href="${esc(maps)}" target="_blank" rel="noopener">${esc(c.address)}</a>`}
    ${c.note && !notHappening ? `<span class="muted">${esc(c.note)}</span>` : ""}
    <span class="tags">${esc(tags.join(" · "))}</span>
  </div>`;
}

start();
