/**
 * WPC Hub — data layer.
 * Works with Claude runtime when available, otherwise uses localStorage.
 */
import { normalizeMeeting, formatRef, nextRefNumber, isoToday, sigKey } from "./domain.js";

export const COLLECTIONS = ["items", "meetings", "minutes", "actions", "signatures", "audit", "config"];

export const state = {
  data: { items: {}, meetings: {}, minutes: {}, actions: {}, sigs: {}, audit: {}, roster: { members: [], chairman: null } },
  loaded: Object.fromEntries(COLLECTIONS.map(c => [c, false])),
  session: { ready: false, db: null, user: null, room: null, downloads: null, me: null, myId: null, isEditor: false },
  presence: {},
  loadSlow: false,
  error: null,
};

const listeners = new Set();
export const onChange = fn => (listeners.add(fn), () => listeners.delete(fn));
let scheduled = false;
export function notify() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; listeners.forEach(fn => fn()); });
}

const STORAGE_KEY = "wpc-hub-standalone";
const DEFAULT_USERS = [
  { id: "u_sec", name: "Secretary One", avatarUrl: "" },
  { id: "u_mem", name: "Member One", avatarUrl: "" },
  { id: "u_chair", name: "Chairman One", avatarUrl: "" },
];

function loadStandaloneState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function saveStandaloneState(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

async function seedStandaloneState() {
  const existing = loadStandaloneState();
  if (existing) return existing;

  const demo = {
    items: {},
    meetings: {},
    minutes: {},
    actions: {},
    sigs: {},
    audit: {},
    roster: { chairman: "u_chair", members: ["u_mem"] },
    counters: { item2026: 0, meeting2026: 0 },
  };

  try {
    const res = await fetch("./seed.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      Object.assign(demo, data);
    }
  } catch (_) {
    // boot with empty demo state if the file is unavailable
  }

  saveStandaloneState(demo);
  return demo;
}

export async function connect() {
  const c = window.claude;
  if (!c || typeof c.use !== "function") {
    const store = await seedStandaloneState();

    state.session.user = {
      me: async () => ({ id: "u_sec", name: "Secretary One", avatarUrl: "", isOwner: true, canEdit: true }),
      canEdit: async () => true,
      profiles: async ids => Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map(id => [id, DEFAULT_USERS.find(u => u.id === id) || { id, name: id }])),
      search: async q => DEFAULT_USERS.filter(u => !q || u.name.toLowerCase().includes(String(q).toLowerCase())),
    };

    state.session.me = { id: "u_sec", name: "Secretary One", avatarUrl: "", isOwner: true, canEdit: true };
    state.session.myId = "u_sec";
    state.session.isEditor = true;
    state.session.downloads = { save: async req => {
      const blob = new Blob([req.data || ""], { type: req.type || "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = req.filename || "export.json";
      a.click();
      URL.revokeObjectURL(url);
      return { status: "saved" };
    } };

    state.data.items = store.items || {};
    state.data.meetings = Object.fromEntries(Object.entries(store.meetings || {}).map(([k, v]) => [k, normalizeMeeting(v)]));
    state.data.minutes = store.minutes || {};
    state.data.actions = store.actions || {};
    state.data.sigs = store.sigs || store.signatures || {};
    state.data.audit = store.audit || {};
    state.data.roster = store.roster || { chairman: "u_chair", members: ["u_mem"] };
    state.session.ready = true;
    state.error = null;
    notify();
    return;
  }

  const [db, user, room, downloads] = await Promise.all(["db", "user", "room", "downloads"].map(n => c.use(n).catch(() => null)));
  Object.assign(state.session, { db, user, room, downloads });

  if (user) {
    const me = await user.me();
    state.session.me = me;
    state.session.myId = me.id;
    state.session.isEditor = !!(await user.canEdit());
  }

  state.session.ready = true;
  if (!db) {
    state.error = "nodb";
    notify();
    return;
  }

  const timer = setTimeout(() => { state.loadSlow = true; notify(); }, 10000);
  const done = key => {
    state.loaded[key] = true;
    if (Object.values(state.loaded).every(Boolean)) {
      clearTimeout(timer);
      state.loadSlow = false;
    }
  };

  const sub = (col, apply) => db.collection(col).onSnapshot(
    snap => { apply(snap.docs); if (!snap.metadata.fromCache) done(col); notify(); },
    err => { done(col); if (err.code !== "revoked") state.error = "partial"; notify(); }
  );

  const byId = (docs, map = x => x) => Object.fromEntries(docs.map(d => [d.id, map({ ...d.data(), id: d.data().id || d.id })]));

  sub("items", docs => { state.data.items = byId(docs); });
  sub("meetings", docs => { state.data.meetings = byId(docs, normalizeMeeting); });
  sub("minutes", docs => { state.data.minutes = Object.fromEntries(docs.map(d => [d.id, { ...d.data() }])); });
  sub("actions", docs => { state.data.actions = byId(docs); });
  sub("signatures", docs => { state.data.sigs = Object.fromEntries(docs.map(d => [d.id, { ...d.data() }])); });
  sub("audit", docs => { state.data.audit = Object.fromEntries(docs.map(d => [d.id, { ...d.data() }])); });
  sub("config", docs => {
    const r = docs.find(d => d.id === "roster");
    state.data.roster = r ? { members: [], chairman: null, ...r.data() } : { members: [], chairman: null };
  });

  if (room) {
    room.onPeers(change => {
      const p = {};
      for (const peer of change.peers || []) {
        if (peer.isMe || peer.kind !== "viewer" || !peer.presence?.editing) continue;
        p[peer.peer] = { user: peer.by || peer.presence.user || null, editing: String(peer.presence.editing) };
      }
      state.presence = p;
      notify();
    }, () => {});
  }

  notify();
}

export function setPresence(editing) {
  try { state.session.room?.presence({ user: state.session.myId, editing: editing || null }); } catch (_) { /* presence is optional */ }
}

export class WriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const db = () => {
  if (!state.session.db) throw new WriteError("unavailable", "The shared record is not connected.");
  return state.session.db;
};

const now = () => new Date().toISOString();
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);

export async function audit(entity, entityId, action, detail = "", ref = "") {
  try {
    const id = `${Date.now().toString(36)}-${newId()}`;
    if (state.session.db) {
      await db().doc(`audit/${id}`).set({ at: now(), by: state.session.myId, entity, entityId, ref, action, detail: String(detail).slice(0, 500) });
      return;
    }

    const store = loadStandaloneState() || { items: {}, meetings: {}, minutes: {}, actions: {}, sigs: {}, audit: {}, roster: { members: [], chairman: null } };
    store.audit[id] = { id, at: now(), by: state.session.myId, entity, entityId, ref, action, detail: String(detail).slice(0, 500) };
    saveStandaloneState(store);
    state.data.audit = store.audit;
  } catch (_) {
    // ignore audit write failures; they must never block the main action
  }
}

async function withRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e?.code === "unavailable") {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
      return fn();
    }
    throw e;
  }
}

export async function saveDoc(col, id, next, { baseRev, force = false, create = false } = {}) {
  return withRetry(async () => {
    if (!state.session.db) {
      const store = loadStandaloneState() || { items: {}, meetings: {}, minutes: {}, actions: {}, sigs: {}, audit: {}, roster: { members: [], chairman: null } };
      if (!create && !store[col]?.[id]) throw new WriteError("not_found", "This record no longer exists.");
      if (create && store[col]?.[id]) throw new WriteError("duplicate", "A record with this id already exists.");

      const cur = store[col]?.[id] || {};
      if (!force && baseRev != null && cur.rev !== baseRev) {
        throw Object.assign(new WriteError("conflict", "Another secretary changed this record while you were editing."), { current: cur });
      }

      const body = { ...(cur || {}), ...next, rev: (cur?.rev || 0) + 1, updatedAt: now(), updatedBy: state.session.myId };
      store[col] = { ...(store[col] || {}), [id]: body };
      saveStandaloneState(store);

      state.data[col] = store[col];
      if (col === "items") state.data.items = store.items;
      if (col === "meetings") state.data.meetings = Object.fromEntries(Object.entries(store.meetings || {}).map(([k, v]) => [k, normalizeMeeting(v)]));
      if (col === "minutes") state.data.minutes = store.minutes;
      if (col === "actions") state.data.actions = store.actions;
      if (col === "config") state.data.roster = store.config?.roster || store.roster || { members: [], chairman: null };
      return body;
    }

    const ref = db().doc(`${col}/${id}`);
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : null;
    if (!create && !cur) throw new WriteError("not_found", "This record no longer exists. It may have been removed by another secretary.");
    if (create && cur) throw new WriteError("duplicate", "A record with this id already exists.");
    if (!force && baseRev != null && cur && (cur.rev || 0) !== baseRev) {
      throw Object.assign(new WriteError("conflict", "Another secretary changed this record while you were editing."), { current: cur });
    }

    const body = { ...(cur || {}), ...next, rev: (cur?.rev || 0) + 1, updatedAt: now(), updatedBy: state.session.myId };
    await ref.set(body);
    return body;
  });
}

export async function nextRef(kind) {
  const year = new Date().getFullYear();
  const key = `${kind}${year}`;

  if (!state.session.db) {
    const store = loadStandaloneState() || { items: {}, meetings: {}, minutes: {}, actions: {}, sigs: {}, audit: {}, config: {}, roster: { members: [], chairman: null }, counters: {} };
    const existing = kind === "item" ? Object.values(state.data.items).map(x => x.ref) : Object.values(state.data.meetings).map(x => x.ref);
    const n = nextRefNumber(kind, year, store.counters?.[key] || 0, existing);
    store.counters = { ...(store.counters || {}), [key]: n };
    saveStandaloneState(store);
    return formatRef(kind, year, n);
  }

  const ref = db().doc("counters/refs");
  const existing = kind === "item" ? Object.values(state.data.items).map(x => x.ref) : Object.values(state.data.meetings).map(x => x.ref);
  for (let i = 0; i < 6; i++) {
    let lease = { acquired: true };
    try { lease = await ref.acquire({ holder: `${state.session.myId || "anon"}:${newId()}`, ttlMs: 4000 }); } catch (_) { }
    if (lease.acquired) {
      const snap = await ref.get();
      const d = snap.exists ? { ...snap.data() } : {};
      const n = nextRefNumber(kind, year, d[key], existing);
      await ref.set({ ...d, [key]: n });
      return formatRef(kind, year, n);
    }
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
  }
  throw new WriteError("busy", "Another secretary is creating a record. Try again in a moment.");
}

export async function writeSignature(meeting, status, role, comment = "") {
  const uid = state.session.myId;
  if (!uid) throw new WriteError("invalid_argument", "Sign in to sign the minutes.");

  return withRetry(async () => {
    if (!state.session.db) {
      const store = loadStandaloneState() || { items: {}, meetings: {}, minutes: {}, actions: {}, sigs: {}, audit: {}, roster: { members: [], chairman: null } };
      const doc = store.sigs?.[uid] || {};
      const key = sigKey(meeting.id, role);
      const prev = doc[key] || {};
      const at = now();
      const event = { v: meeting.version, status, role, at, comment };
      doc[key] = { v: meeting.version, status, role, at, comment, history: [...(prev.history || []), event].slice(-30) };
      store.sigs = { ...(store.sigs || {}), [uid]: doc };
      saveStandaloneState(store);
      state.data.sigs = store.sigs;
      return;
    }

    const ref = db().doc(`signatures/${uid}`);
    const snap = await ref.get();
    const d = snap.exists ? { ...snap.data() } : {};
    const key = sigKey(meeting.id, role);
    const prev = d[key] || {};
    const at = now();
    const event = { v: meeting.version, status, role, at, comment };
    d[key] = { v: meeting.version, status, role, at, comment, history: [...(prev.history || []), event].slice(-30) };
    await ref.set(d);
  });
}

export const today = () => isoToday();

export function errorMessage(e) {
  switch (e?.code) {
    case "invalid_argument": return "You do not have permission for this change.";
    case "quota_exceeded": return "The record has reached its storage limit.";
    case "conflict":
    case "not_found":
    case "busy":
    case "duplicate":
      return e.message;
    case "revoked": return "Your access to this record was changed. Reload the page.";
    default: return "The change was not saved. Check your connection and try again.";
  }
}
