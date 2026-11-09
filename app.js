const DAYS = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

const app = document.getElementById("app");
const dlg = document.getElementById("dlg");

let user = null; // { role: "admin" } or { role: "employee", id }
let loginError = "";
let adminTab = "rooster";
let filterEmployee = "";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function todayIndex() {
  return (new Date().getDay() + 6) % 7; // 0 = Monday
}

function nameOf(list, id) {
  return list.find((x) => x.id === id)?.name ?? "?";
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
  ];
  const nav = `<nav class="tabs">${tabs
    .map(([key, label]) => `<button data-tab="${key}" class="${key === adminTab ? "active" : ""}">${label}</button>`)
    .join("")}</nav>`;

  let body;
  if (adminTab === "rooster") body = rosterTab(employees, clients, shifts);
  else if (adminTab === "werknemers") body = employeesTab(employees);
  else body = clientsTab(clients);

  app.innerHTML = header("Beheer") + nav + body;
  bindLogout();
  app.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      adminTab = b.dataset.tab;
      render();
    };
  });

  if (adminTab === "rooster") {
    document.getElementById("filter").onchange = (e) => {
      filterEmployee = e.target.value;
      render();
    };
    document.getElementById("add").onclick = () => shiftForm(null, employees, clients, shifts);
    app.querySelectorAll("[data-shift]").forEach((b) => {
      b.onclick = () => shiftForm(shifts.find((s) => s.id === b.dataset.shift), employees, clients, shifts);
    });
  } else if (adminTab === "werknemers") {
    document.getElementById("add").onclick = () => employeeForm(null);
    app.querySelectorAll("[data-employee]").forEach((b) => {
      b.onclick = () => employeeForm(employees.find((e) => e.id === b.dataset.employee));
    });
  } else {
    document.getElementById("add").onclick = () => clientForm(null);
    app.querySelectorAll("[data-client]").forEach((b) => {
      b.onclick = () => clientForm(clients.find((c) => c.id === b.dataset.client));
    });
  }
}

function rosterTab(employees, clients, shifts) {
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
    ${DAYS.map((day, i) => {
      const list = visible.filter((s) => s.weekday === i);
      return `<section><h2>${day}</h2>${
        list.length
          ? list
              .map(
                (s) => `
            <button class="item" data-shift="${esc(s.id)}">
              <span class="time">${esc(s.start)} - ${esc(s.end)}</span>
              <span>${esc(nameOf(clients, s.clientId))}</span>
              <span class="muted">${esc(nameOf(employees, s.employeeId))}</span>
            </button>`
              )
              .join("")
          : `<p class="muted">Geen diensten</p>`
      }</section>`;
    }).join("")}`;
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

// Throws if the employee or the client already has another shift at the same time.
// Shifts that only touch (11:00 end, 11:00 start) are allowed.
function checkOverlap(candidate, shifts, employees, clients) {
  const overlapping = shifts.filter(
    (s) =>
      s.id !== candidate.id &&
      s.weekday === candidate.weekday &&
      s.start < candidate.end &&
      candidate.start < s.end
  );
  const day = DAYS[candidate.weekday].toLowerCase();

  const sameEmployee = overlapping.find((s) => s.employeeId === candidate.employeeId);
  if (sameEmployee) {
    throw new Error(
      `${nameOf(employees, candidate.employeeId)} werkt op ${day} van ${sameEmployee.start} tot ${sameEmployee.end} al bij ${nameOf(clients, sameEmployee.clientId)}.`
    );
  }
  const sameClient = overlapping.find((s) => s.clientId === candidate.clientId);
  if (sameClient) {
    throw new Error(
      `${nameOf(clients, candidate.clientId)} heeft op ${day} van ${sameClient.start} tot ${sameClient.end} al een dienst met ${nameOf(employees, sameClient.employeeId)}.`
    );
  }
}

function shiftForm(shift, employees, clients, shifts) {
  if (!employees.length || !clients.length) {
    alert("Voeg eerst minstens één werknemer en één zorgvrager toe.");
    return;
  }
  openForm({
    title: shift ? "Dienst bewerken" : "Nieuwe dienst",
    fields: [
      { name: "weekday", label: "Dag", type: "select", options: DAYS.map((d, i) => [String(i), d]), value: String(shift?.weekday ?? 0) },
      { name: "start", label: "Van", type: "time", value: shift?.start ?? "09:00", required: true },
      { name: "end", label: "Tot", type: "time", value: shift?.end ?? "11:00", required: true },
      { name: "clientId", label: "Zorgvrager", type: "select", options: clients.map((c) => [c.id, c.name]), value: shift?.clientId },
      { name: "employeeId", label: "Werknemer", type: "select", options: employees.map((e) => [e.id, e.name]), value: shift?.employeeId ?? filterEmployee },
    ],
    onSave: async (v) => {
      const candidate = { id: shift?.id, ...v, weekday: Number(v.weekday) };
      if (candidate.end <= candidate.start) throw new Error("De eindtijd moet na de begintijd liggen.");
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
  return `<label>${esc(f.label)}${input}</label>`;
}

function openForm({ title, fields, onSave, onDelete }) {
  dlg.innerHTML = `
    <form>
      <h2>${esc(title)}</h2>
      ${fields.map(fieldHtml).join("")}
      <p class="error" hidden></p>
      <div class="actions">
        ${onDelete ? `<button type="button" class="danger" data-act="delete">Verwijderen</button>` : ""}
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
  dlg.showModal();
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
  const mine = shifts.filter((s) => s.employeeId === me.id);
  const today = todayIndex();

  app.innerHTML =
    header(`Hoi ${me.name.split(" ")[0]}`) +
    `<p class="muted">Jouw vaste weekrooster</p>` +
    DAYS.map((day, i) => {
      const list = mine.filter((s) => s.weekday === i);
      return `<section class="${i === today ? "today" : ""}">
        <h2>${day}${i === today ? ' <span class="badge">Vandaag</span>' : ""}</h2>
        ${
          list.length
            ? list
                .map((s) => {
                  const c = clients.find((x) => x.id === s.clientId) ?? {};
                  const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(c.address ?? "");
                  return `<div class="item">
                    <span class="time">${esc(s.start)} - ${esc(s.end)}</span>
                    <strong>${esc(c.name)}</strong>
                    <a href="${esc(maps)}" target="_blank" rel="noopener">${esc(c.address)}</a>
                    ${c.note ? `<span class="muted">${esc(c.note)}</span>` : ""}
                  </div>`;
                })
                .join("")
            : `<p class="muted">Vrij</p>`
        }
      </section>`;
    }).join("");
  bindLogout();
}

start();
