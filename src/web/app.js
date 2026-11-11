"use strict";

// --- bridge to kdeconnect_skin.py -------------------------------------

let S = null; // daemon snapshot, replaced wholesale on every push
let seq = 0;
const pending = new Map();

function call(method, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    window.webkit.messageHandlers.kdc.postMessage({ id, method, args });
  });
}

window.kdc = {
  reply(id, result, error) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  },
  state(s) {
    S = s;
    applyAccent();
    render();
  },
  event(kind, p) {
    if (kind === "toast") toast(p.text, p.kind);
    else if (kind === "messages") onMessages(p);
    else if (kind === "contacts" && p.device === U.dev && U.view === "messages") loadConversations(false);
  },
};

// --- helpers ------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function patch(el, html) {
  if (el && el._html !== html) {
    el.innerHTML = html;
    el._html = html;
  }
}

const P = {
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  tv: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/>',
  upload: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  prev: '<path d="M19 20L9 12l10-8z"/><path d="M5 19V5"/>',
  next: '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a14 14 0 0 1 20 0"/><circle cx="12" cy="19.5" r="0.5"/>',
  signal: '<path d="M2 20h2M7 20v-4M12 20v-8M17 20V8M22 20V4"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  offline: '<path d="M2 2l20 20"/><path d="M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M14.5 10.2a10 10 0 0 1 4.5 2.3"/><circle cx="12" cy="19.5" r="0.5"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
};
const svg = (name, size = 20, stroke = "currentColor", width = 2) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;

const ACCENTS = ["yellow", "orange", "red", "purple", "blue", "aqua", "green"];
const HUES = ["var(--bright_purple)", "var(--bright_blue)", "var(--bright_aqua)", "var(--bright_orange)", "var(--bright_yellow)", "var(--bright_green)", "var(--bright_red)"];
function hue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim();
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function accentVar(name, variant) {
  return `${variant === "muted" ? "dark" : "bright"}_${name}`;
}
function applyAccent() {
  const s = S?.settings || {};
  const hex = cssVar(accentVar(ACCENTS.includes(s.accent) ? s.accent : "yellow", s.variant));
  if (!hex.startsWith("#")) return;
  const L = lum(hex);
  const dark = (L + 0.05) / (lum(cssVar("bg0")) + 0.05);
  const light = (lum(cssVar("fg0")) + 0.05) / (L + 0.05);
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--on-accent", dark >= light ? cssVar("bg0") : cssVar("fg0"));
}

function toast(text, kind = "info") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 3500);
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtWhen(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  const days = (now - d) / 864e5;
  if (days < 6) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
function fmtDay(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return "today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

// --- UI state ------------------------------------------------------------------

const U = {
  mode: "main",
  shares: [],
  dev: null,
  view: "overview", // overview | plugins | config | commands | messages | remote | app
  back: "overview",
  cfg: null,
  pq: "",
  unpairArm: false,
  busy: {},
  seenRequests: new Set(),
  convs: null,
  thread: null, // thread id, "new", or null
  msgs: {}, // thread -> {uid: message}
  outbox: {}, // thread -> [text]
  mq: "",
  shareTo: null,
};

const devices = () => S?.devices || [];
const cur = () => devices().find((d) => d.id === U.dev);
const has = (d, plugin) => !!d?.plugins?.loaded?.includes("kdeconnect_" + plugin);
const pluginName = (pid) => (S.plugins[pid] || [pid.replace("kdeconnect_", "")])[0];
const devIcon = (t) => ({ phone: "phone", smartphone: "phone", tablet: "tablet", desktop: "desktop", laptop: "laptop", tv: "tv" })[t] || "phone";

function go(view, extra = {}) {
  if (document.pointerLockElement) document.exitPointerLock();
  if (view !== U.view) U.back = U.view === "config" || U.view === "commands" ? "plugins" : U.view;
  Object.assign(U, { view, unpairArm: false }, extra);
  if (view === "messages") loadConversations(true);
  render();
}

function pickDevice() {
  const list = devices();
  for (const d of list) {
    if (d.pairRequestedByPeer && !U.seenRequests.has(d.id)) {
      U.seenRequests.add(d.id);
      if (U.view !== "messages" || !U.thread) {
        U.dev = d.id;
        U.view = "overview";
      }
    }
    if (!d.pairRequestedByPeer) U.seenRequests.delete(d.id);
  }
  if (!list.find((d) => d.id === U.dev)) {
    const best = list.find((d) => d.paired && d.reachable) || list.find((d) => d.paired) || list[0];
    U.dev = best ? best.id : null;
    if (U.view !== "app") U.view = "overview";
  }
}

// --- rendering --------------------------------------------------------------------

function render() {
  if (!S) return;
  if (U.mode === "share") return renderShare();
  pickDevice();
  const app = $("#app");
  if (!app.firstChild) app.innerHTML = '<nav class="side" id="side" aria-label="Devices"></nav><main id="main"></main>';
  patch($("#side"), sidebar());
  renderMain();
}

function sidebar() {
  const list = devices();
  const item = (d) => {
    const on = d.id === U.dev && U.view !== "app";
    let s = "tap to pair", cls = "pair";
    if (d.paired && d.reachable) {
      s = "● connected" + (d.battery ? ` · ${d.battery.charge}%` : "");
      cls = "ok";
    } else if (d.paired) {
      s = "○ offline";
      cls = "";
    } else if (d.pairRequestedByPeer) {
      s = "◐ wants to pair";
      cls = "wait";
    } else if (d.pairRequested) {
      s = "◐ pairing…";
      cls = "wait";
    }
    return `<button class="dev${on ? " on" : ""}${d.paired ? "" : " dashed"}" data-act="select" data-id="${esc(d.id)}">
      ${svg(devIcon(d.type), 20, on ? "var(--accent)" : "var(--fg4)")}
      <span class="t"><span class="n">${esc(d.name)}</span><span class="s ${cls}">${s}</span></span></button>`;
  };
  const paired = list.filter((d) => d.paired), avail = list.filter((d) => !d.paired);
  return `<div class="brand"><b>kdeconnect</b><button class="icon-btn" data-act="refresh" aria-label="Refresh devices" title="Look for devices">${svg("refresh", 16)}</button></div>
    <div class="group"><div class="label">Paired</div>${paired.map(item).join("") || '<div class="side-empty">No paired devices yet.</div>'}</div>
    ${avail.length ? `<div class="group"><div class="label">Available</div>${avail.map(item).join("")}</div>` : ""}
    <div class="side-foot"><span>this device: <span>${esc(S.self.name || "…")}</span></span>
      <button class="icon-btn" data-act="app" aria-label="Settings" title="Settings">${svg("sliders", 16)}</button></div>`;
}

function renderMain() {
  const main = $("#main");
  const d = cur();
  let view = U.view;
  if (!S.online) view = "offline";
  else if (view !== "app" && !d) view = "nodevice";
  else if (view !== "app" && !d.paired) view = "pairing";
  else if (view !== "app" && !d.reachable && ["messages", "remote"].includes(view)) view = "overview";

  const key = `${view}|${U.dev}|${U.cfg}`;
  const v = VIEWS[view];
  main.className = view === "messages" ? "flush" : "";
  // A bug in one view must not leave the window frozen on its last frame:
  // show what failed so it can be reported, and keep the rest working.
  try {
    if (v.shell) {
      if (main._key !== key) {
        main.innerHTML = v.shell(d);
        main._html = null;
        main._key = key;
        v.mount?.(d);
      }
      v.update(d);
    } else {
      main._key = key;
      patch(main, v.html(d));
    }
  } catch (err) {
    console.error(err);
    main._key = null;
    patch(main, `<div class="center"><section class="panel"><h1 class="small">This page failed to draw</h1>
      <p class="selectable mono">${esc(err && err.stack ? err.stack : err)}</p>
      <button class="btn" data-act="go" data-view="overview">Back to overview</button></section></div>`);
  }
}

const header = (title, sub, right = "", backTo = null) => `<header class="head">
  <div class="head-row">${backTo ? `<button class="back" data-act="go" data-view="${backTo}" aria-label="Back">${svg("back", 18)}</button>` : ""}
  <h1 class="small">${title}${sub ? ` <span class="sub">/ ${sub}</span>` : ""}</h1></div>${right}</header>`;

const VIEWS = {};

VIEWS.offline = {
  html: () => `<div class="center"><section class="panel">
    <div class="halo">${svg("plug", 32)}</div>
    <h1 class="small">Daemon not running</h1>
    <p>kdeconnectd is not on the session bus. This window reconnects by itself once it starts.</p>
    <span class="mono muted">systemctl --user status kdeconnect</span></section></div>`,
};

VIEWS.nodevice = {
  html: () => `<div class="center"><section class="panel">
    <div class="halo">${svg("phone", 32)}</div>
    <h1 class="small">No devices</h1>
    <p>Open KDE Connect on your phone and add this computer by its address, or press refresh to look again.</p>
    <button class="btn primary wide" data-act="refresh">Look for devices</button></section></div>`,
};

VIEWS.pairing = {
  html(d) {
    let body;
    if (d.pairRequestedByPeer) {
      body = `<h1 class="small">Pair with ${esc(d.name)}?</h1>
        <p>Check that the same key is shown on the other device before accepting.</p>
        <div class="key">${esc(spaced(d.verificationKey))}</div>
        <div class="row"><button class="btn wide" data-act="rejectPairing">Reject</button><button class="btn primary wide" data-act="acceptPairing">Accept</button></div>
        <div class="mono muted" id="expiry">${expiry(d)}</div>`;
    } else if (d.pairRequested) {
      body = `<h1 class="small">Waiting for ${esc(d.name)}</h1>
        <p>Accept the request on the other device. It should show this key:</p>
        <div class="key">${esc(spaced(d.verificationKey))}</div>
        <div class="row"><button class="btn wide" data-act="rejectPairing">Cancel request</button></div>`;
    } else if (!d.reachable) {
      body = `<h1 class="small">${esc(d.name)} is out of reach</h1><p>It has to be on the network to pair.</p>`;
    } else {
      body = `<h1 class="small">Pair with ${esc(d.name)}?</h1>
        <p>${esc(d.name)} is on the network but not paired. Request pairing, then accept it on the device.</p>
        <div class="row"><button class="btn primary wide" data-act="pair">Request pairing</button></div>`;
    }
    return `<div class="center"><section class="panel" aria-label="Pairing">
      <div class="halo">${svg(devIcon(d.type), 32)}</div>${body}</section></div>`;
  },
};
const spaced = (k) => String(k || "").replace(/(.{4})(?=.)/g, "$1 ");
function expiry(d) {
  if (!d.pairRequestedAt) return "";
  const left = Math.max(0, 30 - (Date.now() / 1000 - d.pairRequestedAt));
  return left > 0 ? `request expires in ${fmtTime(left * 1000)}` : "request expired";
}

// --- device overview ---

VIEWS.overview = {
  html(d) {
    const meta = [];
    if (d.reachable) {
      if (d.battery) {
        const c = d.battery.charge;
        meta.push(`<span><span class="bar${c < 20 ? " low" : c < 45 ? " mid" : ""}"><span style="width:${c}%"></span></span>${c}%${d.battery.charging ? " · charging" : ""}</span>`);
      }
      if (d.addresses.length) meta.push(`<span>${svg("wifi", 15, "var(--bright_blue)")}${esc(d.providers.join(", ") || "LAN")} · ${esc(d.addresses.join(", "))}</span>`);
      if (d.signal && d.signal.strength >= 0) {
        const words = ["none", "weak", "fair", "good", "strong"];
        meta.push(`<span>${svg("signal", 15, "var(--bright_purple)")}${esc(d.signal.type && d.signal.type !== "Unknown" ? d.signal.type + " · " : "")}signal: ${words[Math.min(4, d.signal.strength)]}</span>`);
      }
    } else {
      meta.push(`<span>${svg("offline", 15, "var(--fg4)")}offline · not reachable right now</span>`);
    }
    const head = `<header class="head"><div class="head-l"><h1>${esc(d.name)}</h1><div class="meta">${meta.join("")}</div></div>
      <div class="actions"><button class="btn" data-act="go" data-view="plugins">Plugins</button>
      <button class="btn danger${U.unpairArm ? " armed" : ""}" data-act="unpair">${U.unpairArm ? "Confirm unpair" : "Unpair"}</button></div></header>`;
    if (!d.reachable) {
      return head + `<div class="cards">${commandsCard(d)}${connectionCard(d)}</div>`;
    }
    const qa = [
      ["sendFiles", "Send files", "upload", null, "share"],
      ["sendClipboard", "Send clipboard", "clipboard", "var(--bright_aqua)", "clipboard"],
      ["ping", "Ping", "bell", "var(--bright_yellow)", "ping"],
      ["ring", "Ring device", "search", "var(--bright_orange)", "findmyphone"],
      ["remote", "Remote input", "mouse", "var(--bright_blue)", "remotecontrol"],
      ["messages", "Messages", "chat", "var(--bright_purple)", "sms"],
      ["browse", "Browse files", "folder", "var(--bright_blue)", "sftp"],
    ];
    const quick = qa
      .map(([act, label, icon, color, plugin]) => {
        const ok = has(d, plugin);
        return `<button class="qa${color ? "" : " primary"}${U.busy[act] ? " busy" : ""}" data-act="${act}" ${ok ? "" : `disabled title="Turn on the ${esc(pluginName("kdeconnect_" + plugin))} plugin"`}>
        ${svg(icon, 22, color || "currentColor")}<span>${U.busy[act] ? "…" : label}</span></button>`;
      })
      .join("");
    return `${head}<section class="quick" aria-label="Quick actions">${quick}</section>
      <div class="cards">${has(d, "mprisremote") ? mediaCard(d) : ""}${has(d, "notifications") ? notifCard(d) : ""}${commandsCard(d)}${connectionCard(d)}</div>`;
  },
};

function mediaCard(d) {
  const m = d.mpris;
  if (!m) return `<section class="card" aria-label="Media"><div class="label">Now playing</div><div class="empty">Nothing is playing on ${esc(d.name)}.</div></section>`;
  const players = m.playerList || [];
  const pick = players.length > 1
    ? `<select class="player" data-in="player" aria-label="Player">${players.map((p) => `<option${p === m.player ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>`
    : "";
  const pct = m.length > 0 ? Math.min(100, (m.position / m.length) * 100) : 0;
  return `<section class="card" aria-label="Media" id="media">
    <div class="card-h"><div class="label">Now playing · ${esc(m.player)}</div>${pick}</div>
    <div class="np"><div class="art">${m.localAlbumArtUrl ? `<img src="${esc(m.localAlbumArtUrl)}" alt="">` : svg("music", 22)}</div>
      <div class="t"><b>${esc(m.title || "Unknown title")}</b><span>${esc([m.artist, m.album].filter(Boolean).join(" · ") || "Unknown artist")}</span></div></div>
    ${m.length > 0 ? `<div class="seek"><div class="track" data-act="seek" title="Seek"${m.canSeek ? "" : ' style="cursor:default"'}><span id="seekfill" style="width:${pct}%"></span></div>
      <div class="times"><span id="pos">${fmtTime(m.position)}</span><span>${fmtTime(m.length)}</span></div></div>` : ""}
    <div class="transport">
      <button class="round" data-act="media" data-action="Previous" aria-label="Previous">${svg("prev")}</button>
      <button class="round big" data-act="media" data-action="PlayPause" aria-label="${m.isPlaying ? "Pause" : "Play"}">${svg(m.isPlaying ? "pause" : "play", 20, "currentColor", 2.5)}</button>
      <button class="round" data-act="media" data-action="Next" aria-label="Next">${svg("next")}</button></div>
    <div class="volrow">${svg("volume", 16)}<div class="track vol" data-act="volume" title="Volume ${m.volume}%"><span style="width:${m.volume}%"></span></div></div>
  </section>`;
}

function notifCard(d) {
  const n = d.notifications || [];
  const rows = n
    .map((x) => `<div class="notif"><span class="dot" style="background:${hue(x.app)}"></span>
      <div class="t"><b>${esc(x.app)}${x.title && x.title !== x.app ? " · " + esc(x.title) : ""}</b><span class="selectable">${esc(x.text)}</span></div>
      ${x.dismissable ? `<button class="x" data-act="dismiss" data-id="${esc(x.id)}" aria-label="Dismiss">${svg("x", 14)}</button>` : ""}</div>`)
    .join("");
  return `<section class="card" aria-label="Notifications">
    <div class="card-h"><div class="label">Notifications · ${n.length}</div>${n.some((x) => x.dismissable) ? '<button class="btn ghost" data-act="clearAll">Clear all</button>' : ""}</div>
    ${rows ? `<div class="notif-list">${rows}</div>` : `<div class="empty">No notifications from ${esc(d.name)}.</div>`}</section>`;
}

function commandsCard(d) {
  const chips = (d.commands || []).map((c, i) => `<button class="btn cmd" data-act="editCommand" data-i="${i}" title="${esc(c.name)}">$ ${esc(c.command)}</button>`).join("");
  return `<section class="card" aria-label="Run commands">
    <div class="card-h"><div class="label">Run command</div><button class="btn ghost" data-act="go" data-view="commands">Manage</button></div>
    <div class="chips">${chips}<button class="btn dashed" data-act="addCommand">+ Add command</button></div>
    <div class="empty">${esc(d.name)} can run these on this computer.</div></section>`;
}

function connectionCard(d) {
  return `<section class="card" aria-label="Connection"><div class="label">Connection</div>
    <div class="kv"><span>Address</span><span class="selectable">${esc(d.addresses.join(", ") || "—")}</span>
    <span>Via</span><span>${esc(d.providers.join(", ") || "—")}</span>
    <span>Key</span><span class="selectable">${esc(spaced(d.verificationKey))}</span>
    <span>Id</span><span class="selectable">${esc(d.id)}</span></div></section>`;
}

// --- plugins ---

const CONFIGURABLE = ["kdeconnect_share", "kdeconnect_clipboard", "kdeconnect_pausemusic", "kdeconnect_sendnotifications", "kdeconnect_runcommand"];

VIEWS.plugins = {
  shell: (d) => `${header(esc(d.name), "plugins", '<span class="label" id="pcount"></span>', "overview")}
    <label class="search">${svg("search", 16)}<span class="sr">Search plugins</span>
      <input type="search" id="pq" data-in="pq" placeholder="Search plugins" value="${esc(U.pq)}"></label>
    <div class="plist" id="plist"></div>`,
  update(d) {
    const en = d.plugins.enabled || {};
    const ids = (d.supported || []).filter((p) => S.plugins[p]).sort((a, b) => pluginName(a).localeCompare(pluginName(b)));
    const q = U.pq.trim().toLowerCase();
    const rows = ids
      .filter((p) => !q || S.plugins[p].join(" ").toLowerCase().includes(q))
      .map((p) => {
        const [name, desc] = S.plugins[p];
        const on = !!en[p];
        return `<div class="prow"><span class="tile" style="color:${hue(p)}">${esc(name[0])}</span>
          <div class="t"><b>${esc(name)}</b><span>${esc(desc)}</span></div>
          ${CONFIGURABLE.includes(p) ? `<button class="cfg" data-act="configure" data-id="${p}" aria-label="Configure ${esc(name)}" title="Configure">${svg("sliders", 18)}</button>` : ""}
          <button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(name)}" data-act="togglePlugin" data-id="${p}"><span></span></button></div>`;
      })
      .join("");
    patch($("#plist"), rows || `<p class="empty">No plugins match “${esc(U.pq)}”.</p>`);
    patch($("#pcount"), `${ids.filter((p) => en[p]).length} of ${ids.length} enabled`);
  },
};

// --- plugin config ---

const CFG_FORMS = {
  kdeconnect_share: (c) => `<label class="field">Save received files to
      <span class="inline"><input class="input mono" id="incoming_path" value="${esc(c.incoming_path)}" spellcheck="false">
      <button class="btn" data-act="pickFolder">Browse</button></span></label>
      <p class="empty">%1 in the path is replaced with the device name.</p>`,
  kdeconnect_clipboard: (c) =>
    flip("autoShare", "Share automatically", "Send this computer's clipboard whenever it changes", c.autoShare) +
    flip("sendPassword", "Include passwords", "Also send entries password managers mark as secret", c.sendPassword) +
    `<label class="field">Largest clipboard file to send (MB)<input class="input mono" id="maxClipboardFileSizeMB" type="number" min="0" value="${c.maxClipboardFileSizeMB}"></label>`,
  kdeconnect_pausemusic: (c) =>
    radio("conditionTalking", [[false, "Pause as soon as the phone rings"], [true, "Pause only while talking"]], c.conditionTalking) +
    flip("actionPause", "Pause media players", "", c.actionPause) +
    flip("actionMute", "Mute system sound", "", c.actionMute) +
    flip("actionResume", "Resume when the call ends", "", c.actionResume),
  kdeconnect_sendnotifications: (c) =>
    flip("generalPersistent", "Persistent notifications only", "Skip notifications that expire by themselves", c.generalPersistent) +
    flip("generalIncludeBody", "Include body", "Send the text, not just the title", c.generalIncludeBody) +
    flip("generalSynchronizeIcons", "Include icon", "", c.generalSynchronizeIcons) +
    `<div class="field">Minimum urgency${radio("generalUrgency", [[0, "Low"], [1, "Normal"], [2, "Critical"]], c.generalUrgency)}</div>`,
};
const flip = (id, title, sub, on) => `<div class="check"><span class="t">${esc(title)}${sub ? `<span>${esc(sub)}</span>` : ""}</span>
  <button class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(title)}" data-act="flip" data-key="${id}"><span></span></button></div>`;
const radio = (id, opts, value) => `<div class="radio" role="radiogroup" data-key="${id}">${opts
  .map(([v, label]) => `<button role="radio" aria-checked="${v === value}" data-act="radio" data-v='${JSON.stringify(v)}'><span class="o"></span>${esc(label)}</button>`)
  .join("")}</div>`;

VIEWS.config = {
  shell: (d) => `${header(esc(pluginName(U.cfg)), null, '<div class="actions"><button class="btn primary" data-act="saveCfg">Apply</button></div>', "plugins")}
    <div class="form" id="cfgform">${CFG_FORMS[U.cfg](d.config[U.cfg] || {})}</div>`,
  update() {},
};

function readForm() {
  const out = {};
  const form = $("#cfgform");
  form.querySelectorAll("input[id]").forEach((i) => (out[i.id] = i.type === "number" ? Number(i.value) : i.value));
  form.querySelectorAll(".switch[data-key]").forEach((b) => (out[b.dataset.key] = b.getAttribute("aria-checked") === "true"));
  form.querySelectorAll(".radio[data-key]").forEach((g) => {
    const on = g.querySelector('[aria-checked="true"]');
    if (on) out[g.dataset.key] = JSON.parse(on.dataset.v);
  });
  return out;
}

// --- run commands ---

VIEWS.commands = {
  shell: (d) => `${header("Run commands", null, '<div class="actions"><button class="btn primary" data-act="addCommand">+ Add command</button></div>', U.back === "plugins" ? "plugins" : "overview")}
    <p class="soft" style="margin:0">Commands ${esc(d.name)} can run on this computer.</p><div class="cmds" id="cmdlist"></div>`,
  update(d) {
    const rows = (d.commands || [])
      .map((c, i) => `<div class="cmd-row"><div class="t"><b>${esc(c.name)}</b><code>$ ${esc(c.command)}</code></div>
        <button class="cfg" data-act="editCommand" data-i="${i}" aria-label="Edit ${esc(c.name)}">${svg("edit", 16)}</button>
        <button class="cfg" data-act="deleteCommand" data-i="${i}" aria-label="Delete ${esc(c.name)}" ${U.delArm === i ? 'style="color:var(--bright_red)" title="Click again to delete"' : ""}>${svg("trash", 16)}</button></div>`)
      .join("");
    patch($("#cmdlist"), rows || '<p class="empty">No commands yet. Add one to trigger it from your phone.</p>');
  },
};

const SAMPLES = [
  ["Lock screen", "loginctl lock-session"],
  ["Suspend", "systemctl suspend"],
  ["Toggle mute", "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"],
  ["Maximum brightness", "brightnessctl set 100%"],
  ["Power off", "systemctl poweroff"],
];

function commandDialog(index) {
  const d = cur();
  const c = index >= 0 ? d.commands[index] : { name: "", command: "" };
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-label="${index >= 0 ? "Edit" : "Add"} command">
    <div class="card-h"><h2>${index >= 0 ? "Edit" : "Add"} command</h2><button class="cfg" data-close aria-label="Close">${svg("x", 16)}</button></div>
    <label class="field">Name<input class="input" id="cname" value="${esc(c.name)}" placeholder="Lock screen"></label>
    <label class="field">Command<input class="input mono" id="ccmd" value="${esc(c.command)}" placeholder="loginctl lock-session" spellcheck="false"></label>
    <div class="field">Sample commands<div class="samples">${SAMPLES.map(([n, x], i) => `<button data-sample="${i}">${esc(n)}</button>`).join("")}</div></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="csave">${index >= 0 ? "Save" : "Add"}</button></div></section>`;
  document.body.append(scrim);
  const name = $("#cname", scrim), cmd = $("#ccmd", scrim), save = $("#csave", scrim);
  const sync = () => (save.disabled = !name.value.trim() || !cmd.value.trim());
  sync();
  name.focus();
  const close = () => scrim.remove();
  scrim.addEventListener("input", sync);
  scrim.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && !save.disabled) save.click();
  });
  scrim.addEventListener("click", async (e) => {
    if (e.target === scrim || e.target.closest("[data-close]")) return close();
    const s = e.target.closest("[data-sample]");
    if (s) {
      [name.value, cmd.value] = SAMPLES[s.dataset.sample];
      sync();
    }
    if (e.target.closest("#csave") && !save.disabled) {
      const list = (cur().commands || []).map((x) => ({ ...x }));
      const item = { key: index >= 0 ? list[index].key : null, name: name.value.trim(), command: cmd.value.trim() };
      if (index >= 0) list[index] = item;
      else list.push(item);
      try {
        await call("saveCommands", { device: d.id, commands: list });
        close();
        toast(index >= 0 ? "Command saved" : "Command added", "ok");
      } catch (err) {
        toast(err.message, "error");
      }
    }
  });
}

// --- messages ---

const OUTGOING = new Set([2, 4, 5, 6]);

// One fetch in flight at a time; a reply for a device that is no longer
// selected is dropped. A failed fetch keeps whatever list was already shown.
let convFetch = null;
async function loadConversations(request = false) {
  const d = cur();
  if (!d) return;
  if (convFetch && convFetch.device === d.id && !request) return convFetch.promise;
  const job = { device: d.id };
  job.promise = (async () => {
    U.convsError = null;
    try {
      const list = await call("conversations", { device: d.id, request });
      if (U.dev === job.device) U.convs = list;
    } catch (err) {
      if (U.dev === job.device) U.convsError = err.message;
    } finally {
      if (convFetch === job) convFetch = null;
    }
    if (U.view === "messages") render();
  })();
  convFetch = job;
  return job.promise;
}

let convTimer = 0;
function onMessages({ device, messages }) {
  if (device !== U.dev) return;
  for (const message of messages) {
    const t = (U.msgs[message.thread] ||= {});
    t[message.uid] = message;
    const box = U.outbox[message.thread];
    if (box && OUTGOING.has(message.type)) {
      const i = box.indexOf(message.body);
      if (i >= 0) box.splice(i, 1);
    }
  }
  // Refresh the thread list once things settle, not per batch.
  clearTimeout(convTimer);
  convTimer = setTimeout(() => U.view === "messages" && loadConversations(false), 1500);
  if (U.view === "messages") render();
}

async function openThread(tid) {
  U.thread = tid;
  render();
  if (tid === "new") return;
  try {
    const list = await call("thread", { device: U.dev, thread: tid });
    const t = (U.msgs[tid] ||= {});
    for (const m of list) t[m.uid] = m;
  } catch (err) {
    toast(err.message, "error");
  }
  render();
  const b = $("#bubbles");
  if (b) b.scrollTop = b.scrollHeight;
}

VIEWS.messages = {
  shell: () => `<div class="msgs"><section class="convs" aria-label="Conversations">
      <div class="top"><div class="head-row"><button class="back" data-act="go" data-view="overview" aria-label="Back">${svg("back", 18)}</button><h2>Messages</h2></div>
      <button class="sq primary" style="width:36px;height:36px" data-act="newThread" aria-label="New conversation">${svg("plus", 18, "currentColor", 2.5)}</button></div>
      <label class="search">${svg("search", 16)}<span class="sr">Search conversations</span><input type="search" data-in="mq" placeholder="Search" value="${esc(U.mq)}"></label>
      <div class="conv-list" id="convlist"></div></section>
      <section class="thread" id="threadpane"></section></div>`,
  update(d) {
    const q = U.mq.trim().toLowerCase();
    const convs = U.convs;
    let list;
    if (!convs && U.convsError)
      list = `<p class="empty" style="padding:0 8px">Couldn't load conversations: ${esc(U.convsError)}</p><button class="btn ghost" data-act="retryConvs">Try again</button>`;
    else if (!convs) list = '<p class="empty" style="padding:0 8px">Loading conversations…</p>';
    else {
      // Phones can have thousands of threads; draw the newest few hundred and
      // let search reach the rest.
      const LIMIT = 300;
      const matches = convs.filter((c) => !q || `${c.name} ${c.addresses.join(" ")} ${c.body}`.toLowerCase().includes(q));
      list = matches
        .slice(0, LIMIT)
        .map((c) => {
          const first = (c.name || c.addresses[0] || "").charAt(0);
          const letter = /[a-z]/i.test(first) ? first.toUpperCase() : "#";
          const unread = !c.read && !OUTGOING.has(c.type);
          return `<button class="conv${c.thread === U.thread ? " on" : ""}${unread ? " unread" : ""}" data-act="thread" data-id="${c.thread}">
            <span class="avatar" style="background:${hue(c.name)}">${esc(letter)}</span>
            <span class="t"><span class="l1"><span>${esc(c.name)}</span><span class="when">${fmtWhen(c.date)}</span></span>
            <span class="prev">${OUTGOING.has(c.type) ? "You: " : ""}${esc(c.body.replace(/\s+/g, " "))}</span></span></button>`;
        })
        .join("") || `<p class="empty" style="padding:0 8px">${q ? "No conversations match." : "No conversations synced yet."}</p>`;
      if (matches.length > LIMIT) list += `<p class="empty" style="padding:4px 8px">Showing the newest ${LIMIT} of ${matches.length}. Search to find older ones.</p>`;
      if (U.convsError) list = `<p class="empty" style="padding:0 8px 6px">Couldn't refresh: ${esc(U.convsError)}</p>` + list;
    }
    patch($("#convlist"), list);

    const pane = $("#threadpane");
    const tkey = U.thread === null ? `none|${!!U.convs?.length}` : String(U.thread);
    if (pane._key !== tkey) {
      pane._key = tkey;
      pane._html = null;
      pane.innerHTML = threadShell(d);
      $("#msg", pane)?.focus();
      ($("#to", pane) || {}).focus?.();
    }
    if (U.thread !== null && U.thread !== "new") {
      const b = $("#bubbles");
      const atBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 60;
      patch(b, bubbles(U.thread));
      if (atBottom) b.scrollTop = b.scrollHeight;
    }
  },
};

function threadShell(d) {
  if (U.thread === null)
    return `<div class="center"><div class="empty">${U.convs && U.convs.length ? "Pick a conversation." : "Messages from " + esc(d.name) + " show up here."}</div></div>`;
  const composer = `<div class="composer"><label><span class="sr">Message</span><input type="text" id="msg" placeholder="Text message" autocomplete="off"></label>
    <button class="sq primary" data-act="send" aria-label="Send">${svg("send", 18, "currentColor", 2.2)}</button></div>`;
  if (U.thread === "new")
    return `<div class="to"><span>To</span><input id="to" placeholder="Phone numbers, separated by commas" autocomplete="off"></div>
      <div class="bubbles"><div class="spacer"></div></div>${composer}`;
  const c = (U.convs || []).find((x) => x.thread === U.thread) || { name: "", addresses: [] };
  return `<header class="thread-h"><div class="t"><b>${esc(c.name)}</b><span>${esc(c.addresses.join(", "))} · via ${esc(d.name)} · SMS</span></div></header>
    <div class="bubbles" id="bubbles"></div>${composer}`;
}

// A message sent from this window is recorded locally (see sent_add in the
// Python side). Once the phone reports the same text as sent within a few
// minutes of it, the phone's copy wins and the local one is dropped.
function reported(local, all) {
  return all.some((m) => !m.local && OUTGOING.has(m.type) && m.body === local.body && Math.abs(m.date - local.date) < 10 * 60e3);
}

function bubbles(tid) {
  const all = Object.values(U.msgs[tid] || {});
  const list = all.filter((m) => !m.local || !reported(m, all)).sort((a, b) => a.date - b.date);
  let out = '<div class="spacer"></div>', lastDay = "";
  list.forEach((m, i) => {
    const day = fmtDay(m.date);
    if (day !== lastDay) out += `<div class="day">${esc(day)}</div>`;
    lastDay = day;
    const dir = OUTGOING.has(m.type) ? "out" : "in";
    out += `<div class="bub ${dir}">${esc(m.body)}${m.attachments ? `<div class="mono" style="font-size:11px;opacity:.8">+ ${m.attachments} attachment${m.attachments > 1 ? "s" : ""}</div>` : ""}</div>`;
    const n = list[i + 1];
    if (!n || OUTGOING.has(n.type) !== OUTGOING.has(m.type) || n.date - m.date > 15 * 60e3)
      out += `<div class="stamp ${dir}"${m.local ? ' title="The phone sent this but has not reported it back, so it is shown from this computer\'s record."' : ""}>${
        dir === "out" ? (m.local ? "sent from this computer " : m.type === 5 ? "failed " : m.type === 6 || m.type === 4 ? "sending " : "sent ") : ""
      }${new Date(m.date).toTimeString().slice(0, 5)}</div>`;
  });
  for (const text of U.outbox[tid] || []) out += `<div class="bub out" style="opacity:.6">${esc(text)}</div><div class="stamp out">sending…</div>`;
  if (!list.length && !(U.outbox[tid] || []).length) out += '<div class="day">loading messages from the phone…</div>';
  return out;
}

async function sendMessage() {
  const input = $("#msg");
  const text = input.value.trim();
  if (!text) return;
  const d = cur();
  if (U.thread === "new") {
    const to = $("#to").value.split(",").map((x) => x.trim()).filter(Boolean);
    if (!to.length) return toast("Add at least one phone number.", "error");
    try {
      const r = await call("sendMessage", { device: d.id, addresses: to, text });
      (U.msgs[r.thread] ||= {})[r.message.uid] = r.message;
      await loadConversations(false);
      openThread(r.thread);
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }
  const tid = U.thread;
  input.value = "";
  (U.outbox[tid] ||= []).push(text);
  render();
  try {
    const conv = (U.convs || []).find((c) => c.thread === tid);
    const r = await call("sendMessage", { device: d.id, thread: tid, text, addresses: conv ? conv.addresses : [] });
    U.outbox[tid] = U.outbox[tid].filter((t) => t !== text);
    (U.msgs[r.thread] ||= {})[r.message.uid] = r.message;
    render();
    loadConversations(false);
  } catch (err) {
    U.outbox[tid] = U.outbox[tid].filter((t) => t !== text);
    input.value = text;
    toast(err.message, "error");
    render();
  }
}

// --- remote input ---

VIEWS.remote = {
  shell: (d) => `${header("Remote input", esc(d.name), "", "overview")}
    <p class="soft" style="margin:0" id="padhelp">Click the pad to take over ${esc(d.name)}'s pointer. Your mouse buttons and wheel then act on the phone; press Esc to let go.</p>
    <div class="pad" id="pad" tabindex="0">Click to control ${esc(d.name)}</div>
    <div class="clicks"><button class="btn wide" data-act="click" data-kind="singleclick">Left click</button>
    <button class="btn wide" data-act="click" data-kind="middleclick">Middle</button>
    <button class="btn wide" data-act="click" data-kind="rightclick">Right click</button></div>`,
  // Two modes, like the stock app's touchpad:
  // - captured: the pad holds the pointer (Pointer Lock), so movement is
  //   unlimited raw deltas and real mouse buttons click on the phone, with
  //   holds turned into drags;
  // - drag: where pointer lock is refused, drag inside the pad to move and
  //   tap to click.
  // Moves go out at most once a frame and wheel at most every 40 ms, each as
  // the sum since the last send, so a fast mouse or a trackpad doesn't queue
  // up hundreds of packets for the phone to work through.
  mount(d) {
    const pad = $("#pad");
    const BUTTON = { 0: "singleclick", 1: "middleclick", 2: "rightclick" };
    let move = [0, 0], moveRaf = 0, wheel = [0, 0], wheelTimer = 0;
    let drag = null; // fallback mode: {x, y, moved, at}
    let held = null; // captured mode: {button, at, dragging, timer}

    const send = (body) => call("mouseCommand", { device: d.id, body }).catch(() => {});
    const queueMove = (dx, dy) => {
      move[0] += dx;
      move[1] += dy;
      if (!moveRaf)
        moveRaf = requestAnimationFrame(() => {
          moveRaf = 0;
          const [x, y] = move.map(Math.trunc);
          move = [move[0] - x, move[1] - y];
          if (x || y) call("mouseMove", { device: d.id, dx: x, dy: y }).catch(() => {});
        });
    };
    const locked = () => document.pointerLockElement === pad;
    const setLive = () => {
      pad.classList.toggle("live", locked());
      pad.textContent = locked() ? `Controlling ${d.name} · Esc to stop` : `Click to control ${d.name}`;
    };

    document.onpointerlockchange = setLive;
    document.onpointerlockerror = () => {
      pad.dataset.mode = "drag";
      pad.textContent = "Drag here to move · tap to click";
      $("#padhelp").textContent = `Drag inside the pad to move ${d.name}'s pointer. Tap to click, scroll to scroll.`;
    };

    pad.addEventListener("pointerdown", (e) => {
      if (locked()) {
        e.preventDefault();
        // A press held longer than 250 ms becomes a drag (singlehold), so
        // you can select or move things on the phone.
        held = { button: e.button, at: Date.now(), dragging: false };
        if (e.button === 0) held.timer = setTimeout(() => {
          if (held && !held.dragging) {
            held.dragging = true;
            send({ singlehold: true });
          }
        }, 250);
        return;
      }
      if (pad.dataset.mode === "drag") {
        pad.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, y: e.clientY, moved: 0, at: Date.now() };
        pad.classList.add("live");
        return;
      }
      pad.requestPointerLock();
    });

    pad.addEventListener("pointermove", (e) => {
      if (locked()) return queueMove(e.movementX, e.movementY);
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      queueMove(dx * 1.5, dy * 1.5);
    });

    pad.addEventListener("pointerup", (e) => {
      if (locked() && held) {
        clearTimeout(held.timer);
        if (held.dragging) send({ singlerelease: true });
        else if (BUTTON[held.button]) send({ [BUTTON[held.button]]: true });
        held = null;
        return;
      }
      if (drag) {
        if (drag.moved < 6 && Date.now() - drag.at < 300) send({ [BUTTON[e.button] || "singleclick"]: true });
        drag = null;
        pad.classList.remove("live");
      }
    });

    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    pad.addEventListener("wheel", (e) => {
      e.preventDefault();
      // Line-mode wheels report ~3 per notch; scale to the 120-per-notch
      // angle deltas the phone expects, same as the stock app sends.
      const k = e.deltaMode === 1 ? 40 : 1;
      wheel[0] -= e.deltaX * k;
      wheel[1] -= e.deltaY * k;
      if (!wheelTimer)
        wheelTimer = setTimeout(() => {
          wheelTimer = 0;
          const [dx, dy] = wheel.map(Math.round);
          wheel = [0, 0];
          if (dx || dy) send({ scroll: true, dx, dy });
        }, 40);
    }, { passive: false });
  },
  update() {},
};

// --- app settings ---

VIEWS.app = {
  shell: () => `<header class="head"><div class="head-l"><h1 class="small">Settings</h1><p class="soft" style="margin:0">This computer, connection backends and appearance.</p></div></header>
    <div class="settings"><div class="col">
      <section class="card" aria-label="This device"><div class="label">This device</div>
        <label class="field">Device name<span class="inline"><input class="input" id="devname" value="${esc(S.self.name)}" spellcheck="false"><button class="btn" data-act="saveName">Rename</button></span></label></section>
      <section class="card" aria-label="Backends"><div class="label">Backends</div><div class="col" id="providers"></div></section>
      <section class="card" aria-label="About"><div class="label">About</div><div class="kv"><span>Device id</span><span class="selectable">${esc(S.self.id)}</span><span>Daemon</span><span>kdeconnectd</span></div></section>
    </div><div class="col" id="appearance"></div></div>`,
  update() {
    const names = { lan: ["LAN", "Wi‑Fi and wired network"], bluetooth: ["Bluetooth", "Slower, works without a network"], loopback: ["Loopback", "For testing only"] };
    patch($("#providers"), S.providers.map((p) => {
      const [title, sub] = names[p.name.toLowerCase().replace("linkprovider", "")] || names[p.display.toLowerCase()] || [p.display, p.name];
      return flip("", title, sub, p.enabled).replace('data-act="flip" data-key=""', `data-act="provider" data-id="${esc(p.name)}"`);
    }).join("") || '<div class="empty">No backends reported.</div>');
    const s = S.settings;
    const swatches = ACCENTS.map((a) => {
      const v = accentVar(a, s.variant), sel = a === s.accent;
      return `<button class="sw" aria-pressed="${sel}" data-act="accent" data-id="${a}" style="${sel ? `border-color:var(--${v})` : ""}">
        <span class="dot" style="background:var(--${v})"></span><span class="t">${a[0].toUpperCase() + a.slice(1)}<span>${cssVar(v)}</span></span></button>`;
    }).join("");
    patch($("#appearance"), `<section class="card" aria-label="Accent color"><div class="label">Accent color</div><div class="swatches">${swatches}</div>
      <div class="label">Intensity</div><div class="seg">${[["bright", "Bright"], ["muted", "Muted"]].map(([v, l]) => `<button aria-pressed="${s.variant === v}" data-act="variant" data-id="${v}">${l}</button>`).join("")}</div>
      <p class="empty" style="margin:0">Bright uses the theme's bright accents; muted uses its darker set.</p></section>
      <section class="card" aria-label="Preview"><div class="label">Preview</div><div class="preview">
        <div class="dev on">${svg("phone", 20, "var(--accent)")}<span class="t"><span class="n">Selected device</span><span class="s ok">● connected</span></span></div>
        <div class="actions"><span class="btn primary">Primary</span><span class="btn">Secondary</span></div>
        <div class="check" style="background:transparent;padding:0"><span>Toggle</span><span class="switch" aria-checked="true"><span></span></span></div>
        <div class="track"><span style="width:42%"></span></div>
        <div class="bub out">Sent message</div></div></section>`);
  },
};

// --- share window (kdeconnect-skin --share ...) ---

function renderShare() {
  document.body.classList.add("share");
  const targets = devices().filter((d) => d.paired && d.reachable && has(d, "share"));
  if (!targets.find((d) => d.id === U.shareTo)) U.shareTo = targets[0]?.id || null;
  const link = U.shares.length === 1 && /^https?:/.test(U.shares[0]);
  const html = `<section class="share" role="dialog" aria-label="${link ? "Open on device" : "Send to device"}">
    <h1>${link ? "Open on device" : `Send ${U.shares.length} item${U.shares.length > 1 ? "s" : ""}`}</h1>
    <code>${U.shares.map(esc).join("<br>")}</code>
    <div class="radio" role="radiogroup" aria-label="Device">${targets.map((d) => `<button class="choice" role="radio" aria-checked="${d.id === U.shareTo}" data-act="shareTo" data-id="${esc(d.id)}"><span class="o"></span>${esc(d.name)}<span class="s">${d.battery ? d.battery.charge + "%" : "connected"}</span></button>`).join("") || '<p class="empty">No connected device can receive files right now.</p>'}</div>
    <div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="doShare" ${U.shareTo ? "" : "disabled"}>${link ? "Open" : "Send"}</button></div></section>`;
  patch($("#app"), html);
}

// --- actions ------------------------------------------------------------------

async function run(act, fn, done) {
  U.busy[act] = true;
  render();
  try {
    await fn();
    if (done) toast(done, "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    delete U.busy[act];
    render();
  }
}

const dev = () => ({ device: U.dev });
let unpairTimer = 0;

const ACTIONS = {
  select(el) {
    U.dev = el.dataset.id;
    U.convs = null;
    U.convsError = null;
    U.thread = null;
    U.msgs = {};
    go("overview");
  },
  go: (el) => go(el.dataset.view),
  app: () => go("app"),
  refresh: () => call("refresh").then(() => toast("Looking for devices…")),
  pair: () => call("pair", dev()).catch((e) => toast(e.message, "error")),
  acceptPairing: () => call("acceptPairing", dev()).catch((e) => toast(e.message, "error")),
  rejectPairing: () => call("rejectPairing", dev()).catch((e) => toast(e.message, "error")),
  unpair() {
    if (!U.unpairArm) {
      U.unpairArm = true;
      clearTimeout(unpairTimer);
      unpairTimer = setTimeout(() => ((U.unpairArm = false), render()), 4000);
      return render();
    }
    U.unpairArm = false;
    call("unpair", dev()).then(() => toast("Unpaired"), (e) => toast(e.message, "error"));
  },
  sendFiles: () => run("sendFiles", async () => {
    const r = await call("sendFiles", dev());
    if (r.sent) toast(`Sending ${r.sent} file${r.sent > 1 ? "s" : ""}`, "ok");
  }),
  sendClipboard: () => run("sendClipboard", () => call("sendClipboard", dev()), "Clipboard sent"),
  ping: () => run("ping", () => call("ping", dev()), "Ping sent"),
  ring: () => run("ring", () => call("ring", dev()), "Ringing " + cur().name),
  browse: () => run("browse", async () => {
    const r = await call("browse", dev());
    toast("Opened " + r.path.split("/").slice(-2).join("/"), "ok");
  }),
  retryConvs: () => loadConversations(false),
  remote: () => go("remote"),
  messages: () => go("messages", { thread: null }),
  media: (el) => call("media", { ...dev(), action: el.dataset.action }),
  seek(el, e) {
    const m = cur().mpris;
    if (!m?.canSeek) return;
    const r = el.getBoundingClientRect();
    call("mediaSet", { ...dev(), prop: "position", value: Math.round(((e.clientX - r.left) / r.width) * m.length) });
  },
  volume(el, e) {
    const r = el.getBoundingClientRect();
    call("mediaSet", { ...dev(), prop: "volume", value: Math.round(((e.clientX - r.left) / r.width) * 100) });
  },
  dismiss: (el) => call("dismiss", { ...dev(), id: el.dataset.id }),
  clearAll: () => cur().notifications.filter((n) => n.dismissable).forEach((n) => call("dismiss", { ...dev(), id: n.id })),
  addCommand: () => commandDialog(-1),
  editCommand: (el) => commandDialog(Number(el.dataset.i)),
  deleteCommand(el) {
    const i = Number(el.dataset.i);
    if (U.delArm !== i) {
      U.delArm = i;
      return render();
    }
    U.delArm = null;
    const list = cur().commands.filter((_, j) => j !== i);
    call("saveCommands", { ...dev(), commands: list }).then(() => toast("Command deleted"), (e) => toast(e.message, "error"));
  },
  togglePlugin(el) {
    const on = el.getAttribute("aria-checked") !== "true";
    el.setAttribute("aria-checked", on);
    call("setPlugin", { ...dev(), plugin: el.dataset.id, enabled: on }).catch((e) => toast(e.message, "error"));
  },
  configure(el) {
    if (el.dataset.id === "kdeconnect_runcommand") return go("commands");
    go("config", { cfg: el.dataset.id });
  },
  flip: (el) => el.setAttribute("aria-checked", el.getAttribute("aria-checked") !== "true"),
  radio(el) {
    el.parentElement.querySelectorAll("[role=radio]").forEach((b) => b.setAttribute("aria-checked", b === el));
  },
  async pickFolder() {
    const input = $("#incoming_path");
    const r = await call("pickFolder", { current: input.value });
    if (r.path) input.value = r.path;
  },
  saveCfg: () => call("savePluginConfig", { ...dev(), plugin: U.cfg, values: readForm() }).then(() => toast("Saved", "ok"), (e) => toast(e.message, "error")),
  thread: (el) => openThread(Number(el.dataset.id)),
  newThread: () => openThread("new"),
  send: () => sendMessage(),
  click: (el) => call("mouseCommand", { ...dev(), body: { [el.dataset.kind]: true } }),
  saveName() {
    const name = $("#devname").value.trim();
    if (!name) return toast("The name can't be empty.", "error");
    call("setName", { name }).then(() => toast("Renamed to " + name, "ok"), (e) => toast(e.message, "error"));
  },
  provider(el) {
    const on = el.getAttribute("aria-checked") !== "true";
    el.setAttribute("aria-checked", on);
    call("setProvider", { name: el.dataset.id, enabled: on }).catch((e) => toast(e.message, "error"));
  },
  accent: (el) => saveSettings({ accent: el.dataset.id }),
  variant: (el) => saveSettings({ variant: el.dataset.id }),
  shareTo(el) {
    U.shareTo = el.dataset.id;
    render();
  },
  async doShare(el) {
    el.disabled = true;
    try {
      await call("share", { device: U.shareTo, items: U.shares });
      call("close");
    } catch (err) {
      toast(err.message, "error");
      el.disabled = false;
    }
  },
  close: () => call("close"),
};

function saveSettings(values) {
  S.settings = { ...S.settings, ...values };
  applyAccent();
  render();
  call("saveSettings", values).catch((e) => toast(e.message, "error"));
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled || el.closest(".scrim")) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});

document.addEventListener("input", (e) => {
  const k = e.target.dataset?.in;
  if (!k) return;
  if (k === "player") call("mediaSet", { ...dev(), prop: "player", value: e.target.value });
  else {
    U[k] = e.target.value;
    render();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.target.id === "msg" && e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  } else if (e.target.id === "devname" && e.key === "Enter") ACTIONS.saveName();
  // While the remote pad holds the pointer, Esc only releases it (the
  // browser does that itself); it must not also navigate away.
  else if (e.key === "Escape" && !$(".scrim") && !document.pointerLockElement) {
    if (U.mode === "share") call("close");
    else if (U.view === "messages" && U.thread !== null) {
      U.thread = null;
      render();
    } else if (U.view !== "overview") go(U.view === "config" || U.view === "commands" ? "plugins" : "overview");
  }
});

// Live bits that change without a daemon signal: media position and the
// pairing countdown.
setInterval(() => {
  const d = cur();
  if (!d) return;
  const m = d.mpris;
  if (m && m.isPlaying && m.length > 0 && $("#seekfill")) {
    const pos = Math.min(m.length, m.position + (Date.now() - m.fetchedAt));
    $("#seekfill").style.width = (pos / m.length) * 100 + "%";
    $("#pos").textContent = fmtTime(pos);
  }
  if ($("#expiry")) $("#expiry").textContent = expiry(d);
}, 1000);

// --- boot -------------------------------------------------------------------------

call("hello").then((r) => {
  U.mode = r.mode;
  U.shares = r.shares;
  window.kdc.state(r.state);
});
