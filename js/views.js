/**
 * WPC Hub — views.
 */
import {
  CATEGORIES, DEPARTMENTS, MEETING_STATES, ITEM_STAGES, ACTION_LABELS, PERMISSIONS, ROLES,
  meetingPhase, signatureState, sigFor, awaitingSignature, itemStage, isItemOpen, isActionOpen, isOverdue,
  canEditAgenda, canEditMinutes, daysBetween, diffSnapshots,
} from "./domain.js";
import { esc, icon, badge, btn, pageHeader, dataTable, field, msg, fmtDate, fmtDateTime, monthLabel, panelHead } from "./ui.js";

const itemsArr = ctx => Object.values(ctx.d.items);
const meetingsArr = ctx => Object.values(ctx.d.meetings).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const actionsArr = ctx => Object.values(ctx.d.actions);
const meetingsOf = (ctx, it) => meetingsArr(ctx).filter(m => m.agenda.includes(it.id));
const stageOf = (ctx, it) => itemStage(it, ctx.d);
const phaseBadge = (ctx, m) => { const p = meetingPhase(m, ctx.d.sigs); return badge(p.label, { approved: "ok", archived: "ok", correction: "bad", signing: "warn", awaiting_chair: "warn", signed: "warn" }[p.key] || "neutral"); };
const refLink = it => `<a href="#items" class="ref" data-action="item.open" data-id="${esc(it.id)}">${esc(it.ref)}</a>`;
const person = (ctx, uid) => `<span class="person">${esc(ctx.name(uid))}</span>`;
const readOnlyNote = ctx => ctx.role === "Secretary" ? "" : msg("info", `You are signed in as <b>${esc(ctx.role)}</b>. You can view records${ctx.role === "Viewer" ? "" : " and sign minutes"}; only secretaries can modify data.`);

export function dashboard(ctx) {
  const items = itemsArr(ctx).filter(i => !i.archived);
  const open = items.filter(isItemOpen), closed = items.filter(i => i.status === "CLOSED");
  const acts = actionsArr(ctx);
  const overdue = acts.filter(a => isOverdue(a, ctx.today));
  const review = meetingsArr(ctx).filter(m => m.status === "circulated");
  const pendSigs = review.reduce((n, m) => n + signatureState(m, ctx.d.sigs).pending, 0);
  const stageCounts = ITEM_STAGES.map(s => [s, items.filter(i => stageOf(ctx, i) === s).length]);
  const depts = DEPARTMENTS.map(d => [d, open.filter(i => i.dept === d).length, closed.filter(i => i.dept === d).length]).filter(r => r[1] + r[2]);
  const kpi = (label, val, note, filter, tone = "") => `<button class="kpi ${tone}" data-action="nav.items" data-filter="${esc(JSON.stringify(filter))}"><span class="kpi-l">${esc(label)}</span><span class="kpi-v">${esc(String(val))}</span><span class="kpi-note">${esc(note)}</span></button>`;
  return `${pageHeader({ title: "Committee overview", sub: `Live figures as of ${fmtDate(ctx.today)}. Each agenda item is counted once.`, actions: ctx.role === "Secretary" ? btn("New agenda item", "item.new", { ic: "plus" }) + btn("New meeting", "meeting.new", { kind: "primary", ic: "plus" }) : "" })}
  <section class="kpi-strip" aria-label="Key figures">
    ${kpi("Open items", open.length, "Awaiting decision or follow-up", { status: "open" })}
    ${kpi("Closed items", closed.length, "Follow-up complete", { status: "CLOSED" })}
    <button class="kpi ${overdue.length ? "bad" : ""}" data-action="nav.actions" data-filter='{"overdue":true}'><span class="kpi-l">Overdue actions</span><span class="kpi-v">${overdue.length}</span><span class="kpi-note">Follow-up due dates missed</span></button>
    ${kpi("Pending signatures", pendSigs, `Across ${review.length} set${review.length === 1 ? "" : "s"} of minutes under review`, { pending: true }, pendSigs ? "warn" : "")}
  </section>
  <div class="cols-2">
    <section class="card"><div class="card-h"><h2>Items by category</h2><span class="hint">Select a count to see the items</span></div>
      <table class="grid compact"><thead><tr><th scope="col">Category</th><th scope="col" class="num">Open</th><th scope="col" class="num">Closed</th><th scope="col" class="num">Total</th></tr></thead><tbody>
      ${Object.keys(CATEGORIES).map(c => { const o = open.filter(i => i.category === c).length, cl = closed.filter(i => i.category === c).length; return `<tr><td>${esc(c)}</td><td class="num">${o ? `<button class="count-link" data-action="nav.items" data-filter='${JSON.stringify({ cat: c, status: "open" })}'>${o}</button>` : "0"}</td><td class="num">${cl ? `<button class="count-link" data-action="nav.items" data-filter='${JSON.stringify({ cat: c, status: "CLOSED" })}'>${cl}</button>` : "0"}</td><td class="num">${o + cl}</td></tr>`; }).join("")}
      </tbody></table>
    </section>
    <section class="card"><div class="card-h"><h2>Items by stage</h2><span class="hint">Stage progression</span></div>
      <div class="bars">${stageCounts.map(([s, n]) => `<button class="bar-row" data-action="nav.items" data-filter='${JSON.stringify({ stage: s, status: "" })}' ${n ? "" : "disabled"}><span class="bar-label">${esc(s)}</span><span class="bar-value">${n}</span></button>`).join("")}</div>
    </section>
  </div>
  <section class="card"><div class="card-h"><h2>Overdue follow-up actions</h2>${overdue.length ? btn("View all actions", "nav.go", { kind: "ghost", data: { to: "actions" } }) : ""}</div>
    ${overdue.length ? `<table class="grid compact"><thead><tr><th scope="col">Item</th><th scope="col">Action</th><th scope="col">Responsible</th><th scope="col">Due</th></tr></thead><tbody>${overdue.slice(0,5).map(a => `<tr class="row-bad"><td>${(ctx.d.items[a.itemId] && refLink(ctx.d.items[a.itemId])) || "—"}</td><td>${esc(a.text)}</td><td>${esc(a.owner)}</td><td>${fmtDate(a.due)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No overdue actions.</p>`}
  </section>`;
}

export function filterItems(ctx) {
  const f = ctx.ui.itemFilter;
  return itemsArr(ctx).filter(it => {
    if (!f.archived && it.archived) return false;
    if (f.archived && !it.archived) return false;
    if (f.status === "open" && !isItemOpen(it)) return false;
    if (f.status && f.status !== "open" && it.status !== f.status) return false;
    if (f.cat && it.category !== f.cat) return false;
    if (f.dept && it.dept !== f.dept) return false;
    if (f.stage && stageOf(ctx, it) !== f.stage) return false;
    if (f.owner && it.owner !== f.owner && !actionsArr(ctx).some(a => a.itemId === it.id && a.owner === f.owner)) return false;
    const ms = meetingsOf(ctx, it);
    if (f.month && !ms.some(m => (m.date || "").slice(0, 7) === f.month)) return false;
    if (f.pending && !ms.some(m => awaitingSignature(m, ctx.d.sigs))) return false;
    if (f.overdue && !actionsArr(ctx).some(a => a.itemId === it.id && isOverdue(a, ctx.today))) return false;
    if (f.q) { const q = f.q.toLowerCase(); if (!`${it.ref} ${it.title} ${it.request} ${it.owner}`.toLowerCase().includes(q)) return false; }
    return true;
  });
}

export function itemsView(ctx) {
  const f = ctx.ui.itemFilter;
  const rows = filterItems(ctx);
  const owners = [...new Set([...itemsArr(ctx).map(i => i.owner), ...actionsArr(ctx).map(a => a.owner)].filter(Boolean))].sort();
  const months = [...new Set(meetingsArr(ctx).map(m => (m.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const sel = (name, label, opts) => `<label class="fb"><span>${esc(label)}</span><select data-action="filter.items" data-key="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f[name]) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const active = ["cat", "dept", "stage", "owner", "month"].filter(k => f[k]).length + (f.pending ? 1 : 0) + (f.overdue ? 1 : 0) + (f.q ? 1 : 0);
  return `${pageHeader({ title: "Agenda items", sub: "One record per item, from submission to closure.", actions: ctx.role === "Secretary" ? btn("New agenda item", "item.new", { kind: "primary", ic: "plus" }) : "" })}
  ${readOnlyNote(ctx)}
  <section class="filterbar" aria-label="Filters">
    <label class="fb search">${icon("search")}<input type="search" data-action="filter.items" data-key="q" value="${esc(f.q)}" placeholder="Search reference, title, request" aria-label="Search items"></label>
    ${sel("status", "Status", [["open", "Open"], ["CLOSED", "Closed"], ["WITHDRAWN", "Withdrawn"], ["", "All"]])}
    ${sel("stage", "Stage", [["", "All stages"], ...ITEM_STAGES.map(s => [s, s])])}
    ${sel("cat", "Category", [["", "All categories"], ...Object.keys(CATEGORIES).map(c => [c, c])])}
    ${sel("dept", "Department", [["", "All departments"], ...DEPARTMENTS.map(d => [d, d])])}
    ${sel("owner", "Responsible", [["", "Anyone"], ...owners.map(o => [o, o])])}
    ${sel("month", "Meeting month", [["", "Any month"], ...months.map(m => [m, monthLabel(m)])])}
    <label class="fb chk"><input type="checkbox" data-action="filter.items" data-key="pending" ${f.pending ? "checked" : ""}> Pending signatures</label>
    <label class="fb chk"><input type="checkbox" data-action="filter.items" data-key="overdue" ${f.overdue ? "checked" : ""}> Overdue actions</label>
    <label class="fb chk"><input type="checkbox" data-action="filter.items" data-key="archived" ${f.archived ? "checked" : ""}> Archived only</label>
    ${active ? btn(`Clear ${active} filter${active > 1 ? "s" : ""}`, "filter.clear", { kind: "ghost" }) : ""}
  </section>
  ${dataTable({ id: "items", rows, tstate: ctx.ui.tables.items, caption: "Agenda items", rowAttrs: r => `class="clickable ${actionsArr(ctx).some(a => a.itemId === r.id && isOverdue(a, ctx.today)) ? "row-bad" : ""}" data-action="item.open" data-id="${esc(r.id)}" tabindex="0"`, empty: "No items match these filters.", columns: [
      { key: "ref", label: "Reference", render: r => `<span class="ref">${esc(r.ref)}</span>`, width: "120px" },
      { key: "title", label: "Item", render: r => `${esc(r.title)}${r.example ? ` <span class="tag">Example</span>` : ""}<div class="hint">${esc(r.sub || "")}</div>` },
      { key: "category", label: "Category" },
      { key: "dept", label: "Department" },
      { key: "owner", label: "Responsible" },
      { key: "meetings", label: "Meetings", num: true, value: r => meetingsOf(ctx, r).length, render: r => String(meetingsOf(ctx, r).length) },
      { key: "openActions", label: "Open actions", num: true, value: r => actionsArr(ctx).filter(a => a.itemId === r.id && isActionOpen(a)).length, render: r => String(actionsArr(ctx).filter(a => a.itemId === r.id && isActionOpen(a)).length) },
      { key: "stage", label: "Stage", value: r => ITEM_STAGES.indexOf(stageOf(ctx, r)), render: r => badge(stageOf(ctx, r)) },
    ] })}`;
}

export function meetingsView(ctx) {
  const rows = meetingsArr(ctx);
  return `${pageHeader({ title: "Meetings", sub: "Each monthly meeting from agenda preparation to archived minutes.", actions: ctx.role === "Secretary" ? btn("New meeting", "meeting.new", { kind: "primary", ic: "plus" }) : "" })}
  ${dataTable({ id: "meetings", rows, tstate: ctx.ui.tables.meetings, caption: "Meetings", rowAttrs: r => `class="clickable" data-action="meeting.open" data-id="${esc(r.id)}" tabindex="0"`, empty: "No meetings yet.", columns: [
      { key: "ref", label: "Reference", render: r => `<span class="ref">${esc(r.ref)}</span>`, width: "110px" },
      { key: "title", label: "Meeting" },
      { key: "date", label: "Date", render: r => fmtDate(r.date) },
      { key: "agenda", label: "Items", num: true, value: r => r.agenda.length, render: r => String(r.agenda.length) },
      { key: "status", label: "Status", value: r => MEETING_STATES[r.status]?.order, render: r => phaseBadge(ctx, r) },
    ] })}`;
}

export function actionsView(ctx) {
  const f = ctx.ui.actionFilter;
  const rows = actionsArr(ctx).filter(a => (!f.overdue || isOverdue(a, ctx.today)) && (!f.status || (f.status === "active" ? isActionOpen(a) : a.status === f.status)) && (!f.owner || a.owner === f.owner));
  const owners = [...new Set(actionsArr(ctx).map(a => a.owner).filter(Boolean))].sort();
  const sec = ctx.role === "Secretary";
  return `${pageHeader({ title: "Follow-up actions", sub: "Every action agreed in the minutes, with Responsible and due date." })}
  <section class="filterbar" aria-label="Filters">
    <label class="fb"><span>Status</span><select data-action="filter.actions" data-key="status"><option value="">All</option><option value="active" ${f.status === "active" ? "selected" : ""}>Open and in progress</option><option value="DONE" ${f.status === "DONE" ? "selected" : ""}>Done</option><option value="CANCELLED" ${f.status === "CANCELLED" ? "selected" : ""}>Cancelled</option></select></label>
    <label class="fb"><span>Responsible</span><select data-action="filter.actions" data-key="owner"><option value="">Anyone</option>${owners.map(o => `<option ${f.owner === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
    <label class="fb chk"><input type="checkbox" data-action="filter.actions" data-key="overdue" ${f.overdue ? "checked" : ""}> Overdue only</label>
  </section>
  ${dataTable({ id: "actions", rows, tstate: ctx.ui.tables.actions, caption: "Follow-up actions", empty: "No actions match.", rowAttrs: a => isOverdue(a, ctx.today) ? 'class="row-bad"' : "", columns: [
      { key: "item", label: "Item", value: a => ctx.d.items[a.itemId]?.ref, render: a => ctx.d.items[a.itemId] ? refLink(ctx.d.items[a.itemId]) : "—", width: "120px" },
      { key: "text", label: "Action" },
      { key: "owner", label: "Responsible" },
      { key: "meeting", label: "Agreed in", value: a => ctx.d.meetings[a.meetingId]?.date, render: a => esc(ctx.d.meetings[a.meetingId]?.title || "—") },
      { key: "due", label: "Due", render: a => fmtDate(a.due) },
      { key: "status", label: "Status", value: a => ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"].indexOf(a.status), render: a => badge(a.status === "DONE" ? "Done" : a.status === "CANCELLED" ? "Cancelled" : isOverdue(a, ctx.today) ? "Overdue" : ACTION_LABELS[a.status] || "Open") },
    ] })}`;
}

export function reviewView(ctx) {
  const tasks = Object.values(ctx.d.meetings).filter(m => m.status === "circulated");
  return `${pageHeader({ title: "Review and signatures", sub: "Minutes waiting for review and signature.” })}
  <section class="card"><div class="card-h"><h2>Minutes under review</h2></div>
    ${tasks.length ? `<table class="grid compact"><thead><tr><th scope="col">Meeting</th><th scope="col">Version</th><th scope="col">Status</th></tr></thead><tbody>${tasks.map(m => `<tr><td><a href="#meetings" data-action="meeting.open" data-id="${esc(m.id)}">${esc(m.title)}</a></td><td>v${m.version}</td><td>${phaseBadge(ctx, m)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No circulated minutes.</p>`}
  </section>`;
}

export function recordsView(ctx) {
  const rows = Object.values(ctx.d.audit).sort((a, b) => b.at.localeCompare(a.at));
  return `${pageHeader({ title: "Historical records", sub: "Audit trail of changes and signatures." })}
  ${dataTable({ id: "audit", rows, tstate: ctx.ui.tables.audit, caption: "Audit trail", empty: "No events match.", columns: [
      { key: "at", label: "When", render: e => fmtDateTime(e.at), width: "170px" },
      { key: "by", label: "Who", value: e => ctx.name(e.by), render: e => esc(ctx.name(e.by)) },
      { key: "entity", label: "Record type" },
      { key: "ref", label: "Reference", render: e => `<span class="ref">${esc(e.ref || "")}</span>` },
      { key: "action", label: "Event" },
      { key: "detail", label: "Detail", sortable: false, render: e => `<span class="hint">${esc(e.detail || "")}</span>` },
    ] })}`;
}

export function adminView(ctx) {
  const r = ctx.d.roster;
  return `${pageHeader({ title: "Users and permissions", sub: "Who does what in WPC Hub." })}
  <div class="cols-2">
    <section class="card"><div class="card-h"><h2>Committee roster</h2></div>
      <table class="grid compact"><thead><tr><th>Person</th><th>Committee role</th></tr></thead><tbody>
        ${r.chairman ? `<tr><td>${esc(ctx.name(r.chairman))}</td><td>Chairman</td></tr>` : ""}
        ${(r.members || []).map(u => `<tr><td>${esc(ctx.name(u))}</td><td>Member</td></tr>`).join("")}
      </tbody></table>
    </section>
    <section class="card"><div class="card-h"><h2>Permissions matrix</h2></div>
      <table class="grid compact"><thead><tr><th>Permission</th>${ROLES.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>
      ${PERMISSIONS.map(([p, roles]) => `<tr><td>${esc(p)}</td>${ROLES.map(r => `<td>${roles.includes(r) ? "✓" : "—"}</td>`).join("")}</tr>`).join("")}
      </tbody></table>
    </section>
  </div>`;
}
