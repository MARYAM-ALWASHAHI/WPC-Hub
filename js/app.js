/**
 * WPC Hub — application controller.
 */
import * as D from "./domain.js";
import { state, connect, onChange, saveDoc, nextRef, newId, audit, writeSignature, errorMessage, setPresence, WriteError } from "./store.js";
import { esc, icon, toast, openPanel, closePanel, panelOpen, confirmDialog, readForm, msg, btn, panelHead } from "./ui.js";
import * as V from "./views.js";

const TABLE = (sort, dir = "asc") => ({ sort, dir, page: 1, size: 25 });
const ITEM_FILTER = () => ({ q: "", status: "open", cat: "", dept: "", stage: "", owner: "", month: "", pending: false, overdue: false, archived: false });
const ui = {
  route: "dashboard", meetingId: null, meetingTab: "agenda", openItem: null,
  itemFilter: ITEM_FILTER(),
  actionFilter: { status: "active", owner: "", overdue: false },
  auditFilter: { q: "", entity: "" },
  tables: { items: TABLE("ref", "desc"), meetings: TABLE("date", "desc"), actions: TABLE("due"), audit: TABLE("at", "desc") },
};
const ROUTES = { dashboard: V.dashboard, meetings: V.meetingsView, items: V.itemsView, actions: V.actionsView, review: V.reviewView, records: V.recordsView, admin: V.adminView };
const NAV = [["dashboard", "Overview", "dashboard"], ["meetings", "Meetings", "meeting"], ["items", "Agenda items", "items"], ["actions", "Actions", "actions"], ["review", "Review and signatures", "sign"], ["records", "Records", "history"], ["admin", "Admin", "users"]];

const names = {};
function name(uid) { if (!uid) return "Unknown"; if (!(uid in names)) names[uid] = ""; return names[uid] || (uid === state.session.myId ? (state.session.me?.name || "You") : "Committee member"); }
function ctx() {
  const s = state.session;
  const role = D.roleOf(s.myId, s.isEditor, state.data.roster);
  return { d: state.data, s, ui, role, today: D.isoToday(), name, presence: state.presence };
}

let deferred = false;
function render() {
  const c = ctx();
  renderShell(c);
  const main = document.getElementById("main");
  if (!state.session.ready) main.innerHTML = '<div class="loading" role="status">Loading WPC Hub…</div>';
  else {
    const html = ROUTES[ui.route] ? ROUTES[ui.route](c) : V.dashboard(c);
    main.innerHTML = html;
  }
}

function renderShell(c) {
  document.getElementById("nav").innerHTML = NAV.map(([k, l, ic]) => `<a href="#${k}" class="${ui.route === k ? "on" : ""}" ${ui.route === k ? 'aria-current="page"' : ""}>${icon(ic)}<span>${l}</span></a>`).join("");
  const u = document.getElementById("user");
  u.innerHTML = state.session.me ? `<span class="avatar"><img src="${esc(state.session.me.avatarUrl || "")}" alt=""></span><span class="u-meta"><span class="u-name">${esc(state.session.me.name || "You")}</span><span class="u-role">${esc(c.role)}</span></span>` : "";
  const live = document.getElementById("live");
  live.innerHTML = `${icon("live")}<span>${state.session.db ? "Live shared record" : "Standalone local record"}</span>`;
  live.className = `live ${state.session.db ? "on" : "off"}`;
}

function route() {
  const h = (location.hash || "#dashboard").slice(1);
  ui.route = h in ROUTES ? h : "dashboard";
  render();
}

async function run(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok, "ok"); return r ?? true; }
  catch (e) { console.warn(e); toast(errorMessage(e), "error"); return false; }
}
const requireSecretary = () => { if (ctx().role !== "Secretary") { toast("Only secretaries can make this change.", "error"); return false; } return true; };

const COMMANDS = {
  "layer.close": () => { closePanel(); ui.openItem = null; },
  "nav.go": el => { if (el.dataset.to) location.hash = el.dataset.to; },
  "nav.items": el => { ui.itemFilter = { ...ITEM_FILTER(), status: "", ...JSON.parse(el.dataset.filter || "{}") }; ui.tables.items.page = 1; location.hash = "#items"; },
  "nav.actions": el => { ui.actionFilter = { status: "active", owner: "", overdue: false, ...JSON.parse(el.dataset.filter || "{}") }; location.hash = "#actions"; },
  "table.sort": el => { const t = ui.tables[el.dataset.table]; if (t.sort === el.dataset.key) t.dir = t.dir === "asc" ? "desc" : "asc"; else { t.sort = el.dataset.key; t.dir = "asc"; } t.page = 1; render(); },
  "table.page": el => { ui.tables[el.dataset.table].page = +el.dataset.page; render(); },
  "filter.clear": () => { ui.itemFilter = ITEM_FILTER(); ui.itemFilter.status = ""; render(); },
  "item.new": el => { if (!requireSecretary()) return; openPanel(`<div class="panel-body"><p>Standalone mode: create an agenda item from the form.</p></div>`, "New agenda item"); },
  "meeting.new": () => { if (!requireSecretary()) return; toast("Meeting creation is available in standalone mode.", "ok"); },
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const cmd = COMMANDS[el.dataset.action];
  if (cmd) cmd(el, e);
});
document.addEventListener("change", async e => {
  const el = e.target;
  const a = el.dataset.action;
  if (a === "filter.items") { ui.itemFilter[el.dataset.key] = el.type === "checkbox" ? el.checked : el.value; ui.tables.items.page = 1; render(); }
  else if (a === "filter.actions") { ui.actionFilter[el.dataset.key] = el.type === "checkbox" ? el.checked : el.value; ui.tables.actions.page = 1; render(); }
});
window.addEventListener("hashchange", route);

onChange(render);
route();
connect().catch(err => { console.error(err); state.session.ready = true; state.error = "nodb"; render(); });
