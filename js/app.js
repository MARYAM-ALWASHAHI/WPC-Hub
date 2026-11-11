import * as D from "./domain.js";
import { state, connect, onChange, saveDoc, nextRef, newId, audit, errorMessage } from "./store.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const routes = [
  ["dashboard", "Overview"], ["meetings", "Meetings"], ["items", "Agenda items"],
  ["actions", "Actions"], ["review", "Review & signatures"], ["records", "Change log"], ["admin", "Administration"],
];
let routeName = location.hash.slice(1) || "dashboard";

function rowsTable(headers, rows, empty) {
  return `<div class="table-card"><div class="table-scroll"><table class="grid"><thead><tr>${headers.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td class="empty-cell" colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div></div>`;
}
function pageHead(title, sub, actions = "") {
  return `<header class="ph"><div class="ph-row"><div class="ph-title"><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div><div class="ph-actions">${actions}</div></div></header>`;
}
function button(label, action, kind = "secondary") {
  return `<button class="btn ${kind}" data-action="${esc(action)}">${esc(label)}</button>`;
}
function itemRows(items) {
  return items.map(it => `<tr><td><span class="ref">${esc(it.ref)}</span></td><td><strong>${esc(it.title)}</strong><div class="hint">${esc(it.sub || "")}</div></td><td>${esc(it.category)}</td><td>${esc(it.dept)}</td><td>${esc(it.owner)}</td><td>${it.status === "CLOSED" ? "Closed" : "Open"}</td></tr>`);
}
function render() {
  const nav = $("#nav");
  if (!nav) return;
  nav.innerHTML = routes.map(([key, title]) => `<a href="#${key}" class="${routeName === key ? "on" : ""}" ${routeName === key ? 'aria-current="page"' : ""}>${esc(title)}</a>`).join("");
  const me = state.session.me;
  $("#user").innerHTML = me ? `<span class="u-meta"><span class="u-name">${esc(me.name || "Secretary")}</span><span class="u-role">Standalone demo</span></span>` : "";
  $("#live").innerHTML = `<span>Local browser record</span>`;
  $("#live").className = "live off";

  const main = $("#main");
  if (!state.session.ready) {
    main.innerHTML = '<div class="loading" role="status">Loading WPC Hub…</div>';
    return;
  }
  const items = Object.values(state.data.items || {}).filter(x => !x.archived);
  const meetings = Object.values(state.data.meetings || {}).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const actions = Object.values(state.data.actions || {});
  const open = items.filter(D.isItemOpen);
  const closed = items.filter(x => x.status === "CLOSED");
  const overdue = actions.filter(a => D.isOverdue(a, D.isoToday()));
  const itemAction = button("New agenda item", "new-item", "primary");
  const meetingAction = button("New meeting", "new-meeting", "primary");

  if (routeName === "items") {
    main.innerHTML = `${pageHead("Agenda items", "One reference per request, retained through follow-up and closure.", itemAction)}${rowsTable(["Reference", "Request", "Category", "Department", "Responsible", "Status"], itemRows(items), "No agenda items yet.")}`;
  } else if (routeName === "meetings") {
    const rows = meetings.map(m => `<tr><td><span class="ref">${esc(m.ref || "—")}</span></td><td><strong>${esc(m.title)}</strong></td><td>${esc(m.date || "—")}</td><td>${(m.agenda || []).length}</td><td>${esc(D.MEETING_STATES[m.status]?.label || m.status)}</td><td>v${m.version || 0}</td></tr>`);
    main.innerHTML = `${pageHead("Meetings", "Prepare monthly agendas and keep the meeting record together.", meetingAction)}${rowsTable(["Reference", "Meeting", "Date", "Items", "Stage", "Minutes"], rows, "No meetings yet.")}`;
  } else if (routeName === "actions") {
    const rows = actions.map(a => `<tr><td>${esc(state.data.items[a.itemId]?.ref || "—")}</td><td>${esc(a.text)}</td><td>${esc(a.owner)}</td><td>${esc(a.due || "—")}</td><td>${D.isOverdue(a, D.isoToday()) ? "Overdue" : esc(a.status || "Open")}</td></tr>`);
    main.innerHTML = `${pageHead("Follow-up actions", "Owners and due dates agreed by the committee.")}${rowsTable(["Item", "Action", "Responsible", "Due date", "Status"], rows, "No follow-up actions yet.")}`;
  } else if (routeName === "review") {
    const rows = meetings.filter(m => ["circulated", "archived"].includes(m.status)).map(m => {
      const s = D.signatureState(m, state.data.sigs || {});
      return `<tr><td>${esc(m.title)}</td><td>v${m.version || 0}</td><td>${s.signed}/${s.total} signed</td><td>${s.pending} pending</td><td>${s.corrections.length ? "Correction requested" : D.meetingPhase(m, state.data.sigs || {}).label}</td></tr>`;
    });
    main.innerHTML = `${pageHead("Review & signatures", "Signature progress is separate from agenda-item closure.")}${rowsTable(["Meeting", "Version", "Signed", "Pending", "Status"], rows, "No minutes are awaiting or have completed review.")}`;
  } else if (routeName === "records") {
    const events = Object.values(state.data.audit || {}).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    const rows = events.map(e => `<tr><td>${esc(e.at || "")}</td><td>${esc(e.ref || "")}</td><td>${esc(e.action || "")}</td><td>${esc(e.detail || "")}</td></tr>`);
    main.innerHTML = `${pageHead("Change log", "Recorded changes in this browser profile.")}${rowsTable(["Time", "Reference", "Event", "Details"], rows, "No changes recorded yet.")}`;
  } else if (routeName === "admin") {
    main.innerHTML = `${pageHead("Administration", "Prototype mode stores data in this browser only.")}<section class="card"><h2>Important before real use</h2><p>localStorage is not shared between committee members or devices and is not a secure production database. For simultaneous secretary access, authentication, email notifications, and reliable electronic approvals, connect a secured shared backend before using real employee information.</p></section>`;
  } else {
    const categoryRows = Object.keys(D.CATEGORIES).map(category => {
      const o = open.filter(x => x.category === category).length;
      const c = closed.filter(x => x.category === category).length;
      return `<tr><td>${esc(category)}</td><td>${o}</td><td>${c}</td><td>${o + c}</td></tr>`;
    });
    main.innerHTML = `${pageHead("Workforce Planning Committee", "Monthly committee workspace · live overview", itemAction + meetingAction)}
      <section class="kpi-strip"><article class="kpi"><span class="kpi-l">Open items</span><strong class="kpi-v">${open.length}</strong><span class="kpi-note">Awaiting decisions or follow-up</span></article><article class="kpi"><span class="kpi-l">Closed items</span><strong class="kpi-v">${closed.length}</strong><span class="kpi-note">Follow-up completed</span></article><article class="kpi ${overdue.length ? "bad" : ""}"><span class="kpi-l">Overdue actions</span><strong class="kpi-v">${overdue.length}</strong><span class="kpi-note">Past their due date</span></article><article class="kpi"><span class="kpi-l">Meetings</span><strong class="kpi-v">${meetings.length}</strong><span class="kpi-note">In this browser record</span></article></section>
      <section class="card"><div class="card-h"><h2>Items by category</h2></div>${rowsTable(["Category", "Open", "Closed", "Total"], categoryRows, "No items yet.")}</section>
      <section class="card"><div class="card-h"><h2>Recent agenda items</h2><a href="#items">View all</a></div>${rowsTable(["Reference", "Request", "Category", "Department", "Responsible", "Status"], itemRows(items.slice(0, 5)), "Create an agenda item to get started.")}</section>
      <section class="msg warn"><div class="msg-body"><strong>Prototype storage:</strong> records are saved only in this browser. They are not yet synchronized among the three secretaries.</div></section>`;
  }
}

function showForm(kind) {
  const item = kind === "item";
  const title = item ? "New agenda item" : "New meeting";
  const content = item
    ? `<form id="create-form" data-kind="item" class="form"><label>Title<input name="title" required minlength="5" maxlength="150"></label><label>Category<select name="category">${Object.keys(D.CATEGORIES).map(c => `<option>${esc(c)}</option>`).join("")}</select></label><label>Subcategory<select name="sub">${D.CATEGORIES["Manpower requirement"].map(s => `<option>${esc(s)}</option>`).join("")}</select></label><label>Requesting department<select name="dept">${D.DEPARTMENTS.map(d => `<option>${esc(d)}</option>`).join("")}</select></label><label>Responsible<input name="owner" required></label><label>Request<textarea name="request" required minlength="10"></textarea></label><button class="btn primary" type="submit">Save item</button></form>`
    : `<form id="create-form" data-kind="meeting" class="form"><label>Meeting title<input name="title" required minlength="3" value="WPC Monthly Meeting"></label><label>Meeting date<input name="date" type="date" required value="${D.isoToday()}"></label><button class="btn primary" type="submit">Create meeting</button></form>`;
  $("#layer").innerHTML = `<div class="scrim" data-action="close"></div><aside class="panel md" role="dialog" aria-modal="true" aria-label="${title}"><div class="panel-head"><h2>${title}</h2><button class="btn ghost" data-action="close" aria-label="Close">×</button></div><div class="panel-body">${content}</div></aside>`;
  const cat = $("#create-form [name=category]");
  cat?.addEventListener("change", () => { $("#create-form [name=sub]").innerHTML = D.CATEGORIES[cat.value].map(s => `<option>${esc(s)}</option>`).join(""); });
}

$("#main").addEventListener("click", e => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  if (b.dataset.action === "new-item") showForm("item");
  if (b.dataset.action === "new-meeting") showForm("meeting");
  if (b.dataset.action === "close") $("#layer").innerHTML = "";
});
document.addEventListener("submit", async e => {
  const form = e.target.closest("#create-form");
  if (!form) return;
  e.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const kind = form.dataset.kind;
  try {
    if (kind === "item") {
      const errors = D.validateItem(values);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(" "));
      const id = newId();
      const ref = await nextRef("item");
      await saveDoc("items", id, { ...values, id, ref, status: "OPEN", archived: false, createdAt: D.isoToday() }, { create: true });
      await audit("item", id, "Created", values.title, ref);
    } else {
      const errors = D.validateMeeting(values);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(" "));
      const id = newId();
      const ref = await nextRef("meeting");
      await saveDoc("meetings", id, { ...values, id, ref, status: "preparation", agenda: [], members: [], versions: [], version: 0, createdAt: new Date().toISOString() }, { create: true });
      await audit("meeting", id, "Created", values.title, ref);
    }
    $("#layer").innerHTML = "";
    render();
  } catch (error) {
    window.alert(errorMessage(error) || error.message);
  }
});
document.addEventListener("click", e => {
  const link = e.target.closest("#nav a");
  if (link) routeName = link.hash.slice(1) || "dashboard";
});
window.addEventListener("hashchange", () => { routeName = location.hash.slice(1) || "dashboard"; render(); });
onChange(render);
render();
connect().catch(error => {
  console.error("WPC Hub startup failed:", error);
  state.session.ready = true;
  const main = $("#main");
  if (main) main.innerHTML = `<section class="card"><h1>WPC Hub could not start</h1><p>${esc(error?.message || "Check the browser console for details.")}</p></section>`;
});
