"""kdeconnect-skin: a themeable window for the KDE Connect daemon.

A GTK4 window holding a WebKit view. The page (web/) draws everything; this
file is the bridge between it and the KDE Connect daemon on the session bus.

The page calls `window.webkit.messageHandlers.kdc.postMessage({id, method,
args})`; the reply comes back through `window.kdc.reply(id, result, error)`.
State is pushed the other way as a whole snapshot (`window.kdc.state(...)`)
whenever a daemon signal says something changed, so the page never polls.
"""

import json
import os
import re
import sys
import time
import uuid
import zlib
from pathlib import Path

import gi

gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

APP_ID = "io.github.mukheshpugal.KdeconnectSkin"
WEB_DIR = Path(os.environ.get("KDECONNECT_SKIN_WEB_DIR", Path(__file__).parent / "web"))
DEBUG = bool(os.environ.get("KDECONNECT_SKIN_DEBUG"))
CONFIG_DIR = Path(GLib.get_user_config_dir())
SETTINGS_FILE = CONFIG_DIR / "kdeconnect-skin" / "settings.json"
KDECONNECT_CONFIG = CONFIG_DIR / "kdeconnect"
VCARD_DIR = Path(GLib.get_user_data_dir()) / "kpeoplevcard"
STATE_DIR = Path(GLib.get_user_state_dir()) / "kdeconnect-skin"

BUS = "org.kde.kdeconnect"
ROOT = "/modules/kdeconnect"
DAEMON_IF = "org.kde.kdeconnect.daemon"
DEVICE_IF = "org.kde.kdeconnect.device"
PROPS_IF = "org.freedesktop.DBus.Properties"
NOTIF_IF = "org.kde.kdeconnect.device.notifications.notification"

# Plugin metadata, from plugins/*/kdeconnect_*.json in the kdeconnect-kde
# source (26.04). The daemon only exposes plugin ids over D-Bus.
PLUGINS = {
    "kdeconnect_battery": ("Battery monitor", "Share the battery status between devices"),
    "kdeconnect_clipboard": ("Clipboard sync", "Share the clipboard between devices"),
    "kdeconnect_connectivity_report": ("Connectivity monitor", "Show the phone's network signal strength"),
    "kdeconnect_contacts": ("Sync contacts", "Synchronize contacts from the connected device"),
    "kdeconnect_digitizer": ("Drawing tablet", "Use the device as a pressure sensitive drawing tablet"),
    "kdeconnect_findmyphone": ("Find other devices", "Make your lost phone play an alarm sound"),
    "kdeconnect_findthisdevice": ("Find this device", "Let the phone make this computer play an alarm sound"),
    "kdeconnect_lockdevice": ("Lock device", "Remotely lock and unlock your screen"),
    "kdeconnect_mmtelephony": ("ModemManager telephony", "Show notifications for incoming calls"),
    "kdeconnect_mousepad": ("Receive remote input", "Use your phone as a touchpad and keyboard"),
    "kdeconnect_mpriscontrol": ("Multimedia control receiver", "Let the phone control music and video here"),
    "kdeconnect_mprisremote": ("Send media commands", "Control the phone's media players from here"),
    "kdeconnect_notifications": ("Receive notifications", "Show the device's notifications here and keep them in sync"),
    "kdeconnect_pausemusic": ("Pause media during calls", "Pause music and video during a phone call"),
    "kdeconnect_ping": ("Ping", "Send and receive pings"),
    "kdeconnect_presenter": ("Presenter", "Use your phone as a presentation pointer"),
    "kdeconnect_remotecommands": ("Send commands to execute", "Trigger commands predefined on the remote device"),
    "kdeconnect_remotecontrol": ("Send remote mouse input", "Use your mouse to send input to another device"),
    "kdeconnect_remotekeyboard": ("Send remote keyboard input", "Use your keyboard to send input to another device"),
    "kdeconnect_remotesystemvolume": ("Remote volume control", "Control the volume of the connected device"),
    "kdeconnect_runcommand": ("Run commands", "Let the device run commands set on this computer"),
    "kdeconnect_screensaver_inhibit": ("Inhibit screensaver", "Inhibit the screensaver while the device is connected"),
    "kdeconnect_sendnotifications": ("Send notifications", "Show this computer's notifications on other devices"),
    "kdeconnect_sftp": ("Remote filesystem browser", "Browse the device's files over SFTP"),
    "kdeconnect_shareinputdevices": ("Share input devices", "Share mouse and keyboard with the remote device"),
    "kdeconnect_shareinputdevicesremote": ("Shared input receiver", "Receive mouse and keyboard from the remote device"),
    "kdeconnect_share": ("Share and receive", "Receive and send files, URLs or plain text"),
    "kdeconnect_sms": ("SMS", "Read and send text messages"),
    "kdeconnect_systemvolume": ("Receive volume controls", "Let the connected device control volume"),
    "kdeconnect_telephony": ("Telephony integration", "Show notifications for incoming calls"),
    "kdeconnect_virtualmonitor": ("Virtual monitor", "Use your devices as virtual monitors"),
}

# Plugins with a config page in the UI, and the keys (with the daemon's own
# defaults) that page edits. Keys are the ones each plugin reads through
# KdeConnectPluginConfig.
PLUGIN_CONFIG = {
    "kdeconnect_share": {"incoming_path": str(Path(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) or Path.home() / "Downloads"))},
    "kdeconnect_clipboard": {"autoShare": True, "sendPassword": True, "maxClipboardFileSizeMB": 50},
    "kdeconnect_pausemusic": {"conditionTalking": False, "actionPause": True, "actionMute": False, "actionResume": True},
    "kdeconnect_sendnotifications": {"generalPersistent": False, "generalIncludeBody": True, "generalSynchronizeIcons": True, "generalUrgency": 0},
}

DEFAULT_SETTINGS = {"accent": "yellow", "variant": "bright"}


def device_path(dev):
    return f"{ROOT}/devices/{dev}"


# --- QSettings INI, as kdeconnect's plugin configs are stored --------------


def ini_read(path):
    """Return the [General] group of a QSettings INI file as raw strings."""
    out = {}
    try:
        text = path.read_text()
    except OSError:
        return out
    group = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            group = line[1:-1]
        elif "=" in line and group == "General":
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def ini_decode(raw):
    if raw.startswith('"') and raw.endswith('"'):
        raw = raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if raw.startswith("@ByteArray(") and raw.endswith(")"):
        return raw[len("@ByteArray(") : -1]
    return raw


def ini_encode(value, bytearray_=False):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    s = f"@ByteArray({value})" if bytearray_ else str(value)
    if bytearray_ or re.search(r'[",;=\\\s#]', s):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def ini_write(path, updates):
    """Update keys in [General], keeping everything else in the file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        lines = path.read_text().splitlines()
    except OSError:
        lines = []
    if "[General]" not in [l.strip() for l in lines]:
        lines = ["[General]"] + lines
    pending = dict(updates)
    group = None
    out = []
    for line in lines:
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            if group == "General":
                out.extend(f"{k}={v}" for k, v in pending.items())
                pending = {}
            group = s[1:-1]
        elif group == "General" and "=" in s and s.split("=", 1)[0].strip() in pending:
            k = s.split("=", 1)[0].strip()
            out.append(f"{k}={pending.pop(k)}")
            continue
        out.append(line)
    out.extend(f"{k}={v}" for k, v in pending.items())
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n")
    tmp.replace(path)


def as_bool(raw, default):
    if raw is None:
        return default
    return raw.lower() in ("true", "1")


# --- Contacts ----------------------------------------------------------------


def digits(number):
    d = re.sub(r"\D", "", number or "")
    return d[-10:] if len(d) >= 10 else d


def load_contacts(dev):
    """Map normalised phone numbers to names from the synced vCards.

    The contacts plugin writes one .vcf per contact under
    ~/.local/share/kpeoplevcard/kdeconnect-<device>/ when the phone answers a
    synchronizeRemoteWithLocal request.
    """
    names = {}
    folder = VCARD_DIR / f"kdeconnect-{dev}"
    for f in folder.glob("*.vcf") if folder.is_dir() else []:
        name, tels = None, []
        try:
            # Unfold continuation lines (RFC 6350 3.2) before splitting.
            text = re.sub(r"\r?\n[ \t]", "", f.read_text(errors="replace"))
        except OSError:
            continue
        for line in text.splitlines():
            key, _, val = line.partition(":")
            # "item1.TEL;TYPE=CELL" -> "TEL"
            key = key.split(";")[0].split(".")[-1].upper()
            if key == "FN":
                name = re.sub(r"\\(.)", r"\1", val.strip())
            elif key == "TEL":
                tels.append(val.strip())
        for t in tels:
            if name and digits(t):
                names[digits(t)] = name
    return names


def address_key(addresses):
    return ",".join(sorted(digits(a) for a in addresses if digits(a)))


# --- Messages sent from this window ---------------------------------------------
#
# Some phones (Samsung Messages among them) never report outgoing SMS back to
# KDE Connect, so a message sent from here would vanish from its thread. Each
# one is kept in ~/.local/state/kdeconnect-skin/sent-<device>.json and merged
# into the thread until the phone reports a matching message itself.


def sent_path(dev):
    return STATE_DIR / f"sent-{dev}.json"


def sent_load(dev):
    try:
        data = json.loads(sent_path(dev).read_text())
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def sent_add(dev, thread, addresses, body):
    rec = {"id": uuid.uuid4().hex, "thread": thread, "addresses": addresses, "body": body, "date": int(time.time() * 1000)}
    records = sent_load(dev) + [rec]
    path = sent_path(dev)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(records, indent=1))
    tmp.replace(path)
    return rec


def pseudo_thread(addresses):
    """A stable negative id for a conversation the phone has not reported."""
    return -(zlib.crc32(address_key(addresses).encode()) + 1)


# --- Daemon ------------------------------------------------------------------


class Daemon:
    """Reads kdeconnectd over D-Bus and keeps a snapshot for the page."""

    def __init__(self, push):
        self.push = push  # push(kind, payload)
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.online = False
        self.devices = {}  # id -> dict of sections
        self.dirty = set()  # (dev, section) or ("*", "list")
        self.flush_id = 0
        self.threads = {}  # dev -> {threadId: [messages]}
        self.contacts = {}
        self.thread_keys = {}  # dev -> {address_key: threadId}, from the last listing
        self.pair_seen = {}  # dev -> time a peer pairing request was first seen
        self.msg_queue = {}  # dev -> [messages] waiting for flush_messages
        self.msg_flush_id = 0
        self.last_resync = {}  # dev -> time of the last requestAllConversationThreads

        self.bus.signal_subscribe(BUS, None, None, None, None, Gio.DBusSignalFlags.NONE, self.on_signal)
        Gio.bus_watch_name_on_connection(self.bus, BUS, Gio.BusNameWatcherFlags.AUTO_START, self.on_appeared, self.on_vanished)
        GLib.timeout_add_seconds(15, self.poll)

    # D-Bus helpers

    def call(self, path, iface, method, sig=None, args=None, reply=None, timeout=4000):
        params = GLib.Variant(sig, tuple(args or ())) if sig else None
        res = self.bus.call_sync(BUS, path, iface, method, params, GLib.VariantType(reply) if reply else None, Gio.DBusCallFlags.NONE, timeout, None)
        out = res.unpack() if res is not None else ()
        return out[0] if len(out) == 1 else out

    def call_async(self, path, iface, method, sig=None, args=None, done=None, timeout=30000):
        params = GLib.Variant(sig, tuple(args or ())) if sig else None

        def finish(bus, result):
            try:
                res = bus.call_finish(result)
                out = res.unpack() if res is not None else ()
                if done:
                    done(out[0] if len(out) == 1 else out, None)
            except GLib.Error as e:
                if done:
                    done(None, e.message)
                else:
                    self.push("toast", {"kind": "error", "text": e.message})

        self.bus.call(BUS, path, iface, method, params, None, Gio.DBusCallFlags.NONE, timeout, None, finish)

    def props(self, path, iface):
        try:
            return self.call(path, PROPS_IF, "GetAll", "(s)", (iface,), "(a{sv})")
        except GLib.Error:
            return {}

    def set_prop(self, path, iface, name, variant):
        self.call(path, PROPS_IF, "Set", "(ssv)", (iface, name, variant))

    # Signal routing: mark the sections a signal can have changed, then
    # rebuild them together on the next idle tick.

    def on_appeared(self, *_):
        self.online = True
        self.mark("*", "list")

    def on_vanished(self, *_):
        self.online = False
        self.devices = {}
        self.push("state", self.snapshot())

    def on_signal(self, _bus, _sender, path, iface, member, params):
        if path == ROOT or iface == DAEMON_IF:
            self.mark("*", "list")
            return
        m = re.match(re.escape(ROOT) + r"/devices/([^/]+)(?:/([^/]+))?", path)
        if not m:
            return
        dev, sub = m.group(1), m.group(2)
        if iface == "org.kde.kdeconnect.device.conversations":
            self.on_conversation(dev, member, params)
            return
        if sub is None:
            self.mark(dev, "core")
            if member == "pluginsChanged":
                self.mark(dev, "plugins")
                for s in ("battery", "signal", "mpris", "notifications"):
                    self.mark(dev, s)
        elif sub == "battery":
            self.mark(dev, "battery")
        elif sub == "contacts" and member == "localCacheSynchronized":
            # New vCards on disk: drop the name cache so the next listing
            # re-reads them, and tell the page to fetch that listing.
            self.contacts.pop(dev, None)
            self.push("contacts", {"device": dev})
        elif sub == "connectivity_report":
            self.mark(dev, "signal")
        elif sub == "mprisremote":
            self.mark(dev, "mpris")
        elif sub == "notifications":
            self.mark(dev, "notifications")
        elif sub == "telephony" and member == "callReceived":
            event, number, name = params.unpack()
            self.push("toast", {"kind": "call", "text": f"{event}: {name or number}"})
        elif sub == "share" and member == "shareReceived":
            self.push("toast", {"kind": "info", "text": "Received " + Path(params.unpack()[0]).name})

    def mark(self, dev, section):
        self.dirty.add((dev, section))
        if not self.flush_id:
            self.flush_id = GLib.timeout_add(60, self.flush)

    def poll(self):
        # Pairing state and reachability have signals, but a missed one would
        # leave the sidebar wrong until restart; a slow poll costs nothing.
        self.mark("*", "list")
        return True

    def flush(self):
        self.flush_id = 0
        dirty, self.dirty = self.dirty, set()
        try:
            if ("*", "list") in dirty:
                self.refresh_list()
            for dev, section in dirty:
                if dev in self.devices:
                    self.refresh(dev, section)
        except GLib.Error as e:
            print("refresh failed:", e.message, file=sys.stderr)
        self.push("state", self.snapshot())
        return False

    # Snapshot building

    def refresh_list(self):
        if not self.online:
            return
        ids = self.call(ROOT, DAEMON_IF, "devices", "(bb)", (False, False), "(as)")
        for dev in list(self.devices):
            if dev not in ids:
                del self.devices[dev]
        for dev in ids:
            if dev not in self.devices:
                self.devices[dev] = {}
                for s in ("core", "plugins", "battery", "signal", "mpris", "notifications"):
                    self.refresh(dev, s)
            else:
                self.refresh(dev, "core")

    def refresh(self, dev, section):
        d = self.devices[dev]
        path = device_path(dev)
        if section == "core":
            p = self.props(path, DEVICE_IF)
            d["core"] = {
                "id": dev,
                "name": p.get("name", dev),
                "type": p.get("type", "phone"),
                "reachable": p.get("isReachable", False),
                "paired": p.get("isPaired", False),
                "pairRequested": p.get("isPairRequested", False),
                "pairRequestedByPeer": p.get("isPairRequestedByPeer", False),
                "verificationKey": p.get("verificationKey", ""),
                "addresses": list(p.get("reachableAddresses", [])),
                "providers": list(p.get("activeProviderNames", [])),
                "supported": list(p.get("supportedPlugins", [])),
            }
            if d["core"]["pairRequestedByPeer"]:
                self.pair_seen.setdefault(dev, time.time())
            else:
                self.pair_seen.pop(dev, None)
            d["core"]["pairRequestedAt"] = self.pair_seen.get(dev)
            if "plugins" not in d:
                self.refresh(dev, "plugins")
        elif section == "plugins":
            core = d.get("core") or {}
            loaded = set()
            enabled = {}
            if core.get("paired"):
                try:
                    loaded = set(self.call(path, DEVICE_IF, "loadedPlugins", reply="(as)"))
                    for pid in core.get("supported", []):
                        enabled[pid] = self.call(path, DEVICE_IF, "isPluginEnabled", "(s)", (pid,), "(b)")
                except GLib.Error:
                    pass
            d["plugins"] = {"loaded": sorted(loaded), "enabled": enabled}
        elif section == "battery":
            p = self.props(path + "/battery", "org.kde.kdeconnect.device.battery") if self.has(dev, "kdeconnect_battery") else {}
            d["battery"] = {"charge": p["charge"], "charging": p.get("isCharging", False)} if "charge" in p and p["charge"] >= 0 else None
        elif section == "signal":
            p = self.props(path + "/connectivity_report", "org.kde.kdeconnect.device.connectivity_report") if self.has(dev, "kdeconnect_connectivity_report") else {}
            d["signal"] = {"type": p.get("cellularNetworkType", ""), "strength": p.get("cellularNetworkStrength", -1)} if p else None
        elif section == "mpris":
            p = self.props(path + "/mprisremote", "org.kde.kdeconnect.device.mprisremote") if self.has(dev, "kdeconnect_mprisremote") else {}
            if p and p.get("playerList"):
                p = {k: (list(v) if isinstance(v, (list, tuple)) else v) for k, v in p.items()}
                p["fetchedAt"] = time.time() * 1000
                d["mpris"] = p
            else:
                d["mpris"] = None
        elif section == "notifications":
            items = []
            if self.has(dev, "kdeconnect_notifications"):
                try:
                    ids = self.call(path + "/notifications", "org.kde.kdeconnect.device.notifications", "activeNotifications", reply="(as)")
                except GLib.Error:
                    ids = []
                for nid in ids:
                    p = self.props(f"{path}/notifications/{nid}", NOTIF_IF)
                    if p:
                        items.append({"id": nid, "app": p.get("appName", ""), "title": p.get("title", ""), "text": p.get("text", ""), "dismissable": p.get("dismissable", False), "replyId": p.get("replyId", ""), "icon": p.get("iconPath", "") if p.get("hasIcon") else ""})
            d["notifications"] = items

    def has(self, dev, plugin):
        return plugin in (self.devices.get(dev, {}).get("plugins") or {}).get("loaded", [])

    def snapshot(self):
        devices = []
        for dev, d in self.devices.items():
            if "core" not in d:
                continue
            entry = dict(d["core"])
            entry.update(
                plugins=d.get("plugins", {}),
                battery=d.get("battery"),
                signal=d.get("signal"),
                mpris=d.get("mpris"),
                notifications=d.get("notifications", []),
                commands=self.commands(dev) if entry["paired"] else [],
                config={pid: self.plugin_config(dev, pid) for pid in PLUGIN_CONFIG} if entry["paired"] else {},
            )
            devices.append(entry)
        devices.sort(key=lambda e: (not e["paired"], not e["reachable"], e["name"].lower()))
        me = {"id": "", "name": ""}
        providers = []
        if self.online:
            try:
                me = {"id": self.call(ROOT, DAEMON_IF, "selfId", reply="(s)"), "name": self.call(ROOT, DAEMON_IF, "announcedName", reply="(s)")}
                for line in self.call(ROOT, DAEMON_IF, "linkProviders", reply="(as)"):
                    display, name, state = (line.split("|") + ["", "", ""])[:3]
                    providers.append({"display": display, "name": name, "enabled": state == "enabled"})
            except GLib.Error:
                pass
        return {"online": self.online, "self": me, "providers": providers, "devices": devices, "plugins": PLUGINS, "settings": load_settings()}

    # Plugin configs

    def config_path(self, dev, plugin):
        return KDECONNECT_CONFIG / dev / plugin / "config"

    def config_changed(self, dev, plugin):
        # What KdeConnectPluginConfig listens for; the running plugin re-reads
        # its config on this signal (runcommand also re-sends its list).
        self.bus.emit_signal(None, f"/kdeconnect/{dev}/{plugin}", "org.kde.kdeconnect.config", "configChanged", None)

    def commands(self, dev):
        raw = ini_read(self.config_path(dev, "kdeconnect_runcommand")).get("commands")
        try:
            data = json.loads(ini_decode(raw)) if raw else {}
        except ValueError:
            data = {}
        return [{"key": k, "name": v.get("name", ""), "command": v.get("command", "")} for k, v in data.items()]

    def save_commands(self, dev, cmds):
        data = {}
        for c in cmds:
            key = c.get("key") or str(uuid.uuid4()).replace("-", "_")
            data[key] = {"name": c["name"], "command": c["command"]}
        ini_write(self.config_path(dev, "kdeconnect_runcommand"), {"commands": ini_encode(json.dumps(data, separators=(",", ":")), bytearray_=True)})
        self.config_changed(dev, "kdeconnect_runcommand")

    def plugin_config(self, dev, plugin):
        raw = ini_read(self.config_path(dev, plugin))
        out = {}
        for key, default in PLUGIN_CONFIG[plugin].items():
            r = raw.get(key)
            if isinstance(default, bool):
                out[key] = as_bool(ini_decode(r) if r else None, default)
            elif isinstance(default, int):
                try:
                    out[key] = int(ini_decode(r)) if r else default
                except ValueError:
                    out[key] = default
            else:
                out[key] = ini_decode(r) if r else default
        return out

    def save_plugin_config(self, dev, plugin, values):
        allowed = PLUGIN_CONFIG[plugin]
        updates = {}
        for k, v in values.items():
            if k in allowed:
                kind = type(allowed[k])
                updates[k] = ini_encode(kind(v))
        ini_write(self.config_path(dev, plugin), updates)
        self.config_changed(dev, plugin)

    # Messages

    def message(self, tup):
        event, body, addrs, date, mtype, read, thread, uid, _sub, attachments = tup
        return {"body": body, "addresses": [a[0] for a in addrs], "date": date, "type": mtype, "read": bool(read), "thread": thread, "uid": uid, "attachments": len(attachments)}

    def on_conversation(self, dev, member, params):
        # A resync makes the phone send thousands of these; queue them and
        # hand the page one batch every 250 ms instead of one call each.
        # conversationLoaded carries nothing the page uses, so it is dropped.
        if member in ("conversationCreated", "conversationUpdated"):
            msg = self.message(params.unpack()[0])
            thread = self.threads.setdefault(dev, {}).setdefault(msg["thread"], {})
            thread[msg["uid"]] = msg
            self.msg_queue.setdefault(dev, []).append(msg)
            if not self.msg_flush_id:
                self.msg_flush_id = GLib.timeout_add(250, self.flush_messages)

    def flush_messages(self):
        self.msg_flush_id = 0
        queue, self.msg_queue = self.msg_queue, {}
        for dev, msgs in queue.items():
            self.push("messages", {"device": dev, "messages": msgs})
        return False

    def name_for(self, dev, addresses):
        if dev not in self.contacts:
            self.contacts[dev] = load_contacts(dev)
        names = [self.contacts[dev].get(digits(a), a) for a in addresses]
        return ", ".join(names)

    def conversations_async(self, dev, done):
        """Fetch the thread list without blocking the window.

        The reply can be several MB (each thread's latest message carries its
        attachment thumbnails), and the daemon can be slow to answer while the
        phone is resyncing, so this must not be a blocking call.
        """

        def got(raw, error):
            done(None if error else self.build_conversations(dev, raw), error)

        self.call_async(device_path(dev), "org.kde.kdeconnect.device.conversations", "activeConversations", done=got, timeout=60000)

    def build_conversations(self, dev, raw):
        by_thread = {}
        for v in raw:
            m = self.message(v)
            m["name"] = self.name_for(dev, m["addresses"])
            by_thread[m["thread"]] = m
        self.thread_keys[dev] = {address_key(m["addresses"]): t for t, m in by_thread.items()}
        # A locally recorded message newer than a thread's latest becomes its
        # preview, keeping the thread's own name and numbers (a reply's record
        # may have none); one to a number with no thread yet becomes its own
        # entry.
        for rec in sent_load(dev):
            tid = self.resolve_thread(dev, rec)
            latest = by_thread.get(tid)
            local = self.local_message(dev, rec, tid)
            if latest is None:
                if not local["addresses"]:
                    continue  # a reply to a thread the phone no longer lists
                local["name"] = self.name_for(dev, local["addresses"])
                by_thread[tid] = local
            elif rec["date"] > latest["date"]:
                by_thread[tid] = {**local, "addresses": latest["addresses"], "name": latest["name"]}
        return sorted(by_thread.values(), key=lambda m: -m["date"])

    def resolve_thread(self, dev, rec):
        if rec.get("thread") is not None:
            return rec["thread"]
        return self.thread_keys.get(dev, {}).get(address_key(rec["addresses"])) or pseudo_thread(rec["addresses"])

    def local_message(self, dev, rec, tid):
        return {"body": rec["body"], "addresses": rec["addresses"], "date": rec["date"], "type": 2, "read": True, "thread": tid, "uid": "local-" + rec["id"], "attachments": 0, "local": True}

    def thread(self, dev, tid):
        msgs = dict(self.threads.get(dev, {}).get(tid, {}))
        for rec in sent_load(dev):
            if self.resolve_thread(dev, rec) == tid:
                m = self.local_message(dev, rec, tid)
                msgs[m["uid"]] = m
        return sorted(msgs.values(), key=lambda m: m["date"])

    def thread_addresses(self, dev, tid):
        """Addresses for a pseudo thread, from the records that created it."""
        for rec in sent_load(dev):
            if self.resolve_thread(dev, rec) == tid:
                return rec["addresses"]
        return []


# --- Settings ------------------------------------------------------------------


def theme_background():
    """The theme's --bg0_hard, so the window paints that before the page loads."""
    try:
        m = re.search(r"--bg0_hard:\s*(#[0-9a-fA-F]{6})", (WEB_DIR / "palette.css").read_text())
        return m.group(1) if m else "#000000"
    except OSError:
        return "#000000"


def load_settings():
    try:
        data = json.loads(SETTINGS_FILE.read_text())
        return {**DEFAULT_SETTINGS, **{k: v for k, v in data.items() if k in DEFAULT_SETTINGS}}
    except (OSError, ValueError):
        return dict(DEFAULT_SETTINGS)


def save_settings(values):
    current = load_settings()
    current.update({k: str(v) for k, v in values.items() if k in DEFAULT_SETTINGS})
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(current, indent=2) + "\n")
    return current


# --- Bridge ---------------------------------------------------------------------


class Bridge:
    """One page's view of the daemon: dispatches its calls, pushes events."""

    def __init__(self, app, webview, window, mode="main", shares=None):
        self.app, self.view, self.window = app, webview, window
        self.mode, self.shares = mode, shares or []
        self.ready = False
        mgr = webview.get_user_content_manager()
        mgr.register_script_message_handler("kdc", None)
        mgr.connect("script-message-received::kdc", self.on_message)

    @property
    def d(self):
        return self.app.daemon

    def js(self, fn, *args):
        if not self.ready and fn != "reply":
            return
        payload = ",".join(json.dumps(a) for a in args)
        self.view.evaluate_javascript(f"window.kdc && window.kdc.{fn}({payload})", -1, None, None, None, None, None)

    def push(self, kind, payload):
        if kind == "state":
            self.js("state", payload)
        else:
            self.js("event", kind, payload)

    def on_message(self, _mgr, value):
        try:
            msg = json.loads(value.to_json(0))
        except ValueError:
            return
        mid, method, args = msg.get("id"), msg.get("method", ""), msg.get("args") or {}
        handler = getattr(self, "m_" + method.replace(".", "_"), None)
        if handler is None:
            self.js("reply", mid, None, f"unknown method {method}")
            return

        def done(result=None, error=None):
            self.js("reply", mid, result, error)

        try:
            result = handler(args, done)
            if result is not ASYNC:
                done(result)
        except GLib.Error as e:
            done(None, e.message)
        except (KeyError, TypeError, ValueError, OSError) as e:
            done(None, str(e))

    # Each m_* handler takes (args, done). Returning ASYNC means it will call
    # done() itself later.

    def m_hello(self, a, done):
        self.ready = True
        return {"mode": self.mode, "shares": self.shares, "state": self.d.snapshot()}

    def m_refresh(self, a, done):
        self.d.call_async(ROOT, DAEMON_IF, "forceOnNetworkChange")
        self.d.mark("*", "list")

    def dev_call(self, a, sub, iface, method, sig=None, args=None, done=None):
        path = device_path(a["device"]) + (f"/{sub}" if sub else "")
        self.d.call_async(path, iface, method, sig, args, (lambda r, e: done(None, e)) if done else None)
        return ASYNC if done else None

    def m_pair(self, a, done):
        return self.dev_call(a, None, DEVICE_IF, "requestPairing", done=done)

    def m_acceptPairing(self, a, done):
        return self.dev_call(a, None, DEVICE_IF, "acceptPairing", done=done)

    def m_rejectPairing(self, a, done):
        return self.dev_call(a, None, DEVICE_IF, "cancelPairing", done=done)

    def m_unpair(self, a, done):
        return self.dev_call(a, None, DEVICE_IF, "unpair", done=done)

    def m_setPlugin(self, a, done):
        self.d.call(device_path(a["device"]), DEVICE_IF, "setPluginEnabled", "(sb)", (a["plugin"], bool(a["enabled"])))
        self.d.mark(a["device"], "plugins")

    def m_ping(self, a, done):
        return self.dev_call(a, "ping", "org.kde.kdeconnect.device.ping", "sendPing", done=done)

    def m_ring(self, a, done):
        return self.dev_call(a, "findmyphone", "org.kde.kdeconnect.device.findmyphone", "ring", done=done)

    def m_sendClipboard(self, a, done):
        return self.dev_call(a, "clipboard", "org.kde.kdeconnect.device.clipboard", "sendClipboard", done=done)

    def m_browse(self, a, done):
        # The daemon's own startBrowsing mounts the phone and then opens a
        # kdeconnect:// URL through KIO, which does nothing without a KDE file
        # manager. Mount, then open the mounted folder with whatever handles
        # directories on this desktop.
        path = device_path(a["device"]) + "/sftp"
        iface = "org.kde.kdeconnect.device.sftp"

        def mounted(ok, err):
            if err or not ok:
                try:
                    err = err or self.d.call(path, iface, "getMountError", reply="(s)") or "Could not mount the device"
                except GLib.Error as e:
                    err = e.message
                done(None, err)
                return
            try:
                dirs = self.d.call(path, iface, "getDirectories", reply="(a{sv})")
                folder = next(iter(dirs), None) or self.d.call(path, iface, "mountPoint", reply="(s)")
                Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(folder).get_uri(), None)
                done({"path": folder})
            except GLib.Error as e:
                done(None, f"Mounted, but nothing opened the folder: {e.message}")

        self.d.call_async(path, iface, "mountAndWait", done=mounted, timeout=60000)
        return ASYNC

    def m_sendFiles(self, a, done):
        dialog = Gtk.FileDialog(title="Send files", modal=True)

        def picked(dlg, result):
            try:
                files = dlg.open_multiple_finish(result)
            except GLib.Error:
                done({"sent": 0})
                return
            uris = [files.get_item(i).get_uri() for i in range(files.get_n_items())]
            self.share(a["device"], uris, done)

        dialog.open_multiple(self.window, None, picked)
        return ASYNC

    def share(self, dev, items, done):
        uris = []
        for item in items:
            if re.match(r"^[a-z][a-z0-9+.-]*:", item):
                uris.append(item)
            else:
                uris.append(Gio.File.new_for_path(item).get_uri())
        path = device_path(dev) + "/share"
        iface = "org.kde.kdeconnect.device.share"
        if len(uris) == 1 and not uris[0].startswith("file:"):
            self.d.call_async(path, iface, "shareUrl", "(s)", (uris[0],), lambda r, e: done({"sent": 1}, e))
        else:
            self.d.call_async(path, iface, "shareUrls", "(as)", (uris,), lambda r, e: done({"sent": len(uris)}, e))
        return ASYNC

    def m_share(self, a, done):
        return self.share(a["device"], a["items"], done)

    def m_shareText(self, a, done):
        return self.dev_call(a, "share", "org.kde.kdeconnect.device.share", "shareText", "(s)", (a["text"],), done)

    def m_media(self, a, done):
        return self.dev_call(a, "mprisremote", "org.kde.kdeconnect.device.mprisremote", "sendAction", "(s)", (a["action"],), done)

    def m_mediaSet(self, a, done):
        path = device_path(a["device"]) + "/mprisremote"
        iface = "org.kde.kdeconnect.device.mprisremote"
        name = a["prop"]
        variant = GLib.Variant("s", a["value"]) if name == "player" else GLib.Variant("i", int(a["value"]))
        if name not in ("player", "volume", "position"):
            raise ValueError(name)
        self.d.set_prop(path, iface, name, variant)
        self.d.mark(a["device"], "mpris")

    def m_dismiss(self, a, done):
        path = f"{device_path(a['device'])}/notifications/{a['id']}"
        self.d.call_async(path, NOTIF_IF, "dismiss")
        self.d.mark(a["device"], "notifications")

    def m_replyNotification(self, a, done):
        return self.dev_call(a, "notifications", "org.kde.kdeconnect.device.notifications", "sendReply", "(ss)", (a["replyId"], a["text"]), done)

    def m_mouseMove(self, a, done):
        path = device_path(a["device"]) + "/remotecontrol"
        self.d.call_async(path, "org.kde.kdeconnect.device.remotecontrol", "moveCursor", "((ii))", ((int(a["dx"]), int(a["dy"])),))

    def m_mouseCommand(self, a, done):
        body = {}
        for k, v in a["body"].items():
            body[k] = GLib.Variant("b", v) if isinstance(v, bool) else GLib.Variant("i", int(v))
        path = device_path(a["device"]) + "/remotecontrol"
        self.d.call_async(path, "org.kde.kdeconnect.device.remotecontrol", "sendCommand", "(a{sv})", (body,))

    def m_saveCommands(self, a, done):
        self.d.save_commands(a["device"], a["commands"])
        self.push("state", self.d.snapshot())

    def m_savePluginConfig(self, a, done):
        if a["plugin"] not in PLUGIN_CONFIG:
            raise ValueError("no config for " + a["plugin"])
        self.d.save_plugin_config(a["device"], a["plugin"], a["values"])
        self.push("state", self.d.snapshot())

    def m_pickFolder(self, a, done):
        dialog = Gtk.FileDialog(title="Save received files to", modal=True)
        if a.get("current"):
            dialog.set_initial_folder(Gio.File.new_for_path(a["current"]))

        def picked(dlg, result):
            try:
                done({"path": dlg.select_folder_finish(result).get_path()})
            except GLib.Error:
                done({"path": None})

        dialog.select_folder(self.window, None, picked)
        return ASYNC

    def m_setName(self, a, done):
        self.d.call(ROOT, DAEMON_IF, "setAnnouncedName", "(s)", (a["name"].strip(),))
        self.d.mark("*", "list")

    def m_setProvider(self, a, done):
        self.d.call(ROOT, DAEMON_IF, "setLinkProviderState", "(sb)", (a["name"], bool(a["enabled"])))
        self.d.mark("*", "list")

    def m_saveSettings(self, a, done):
        s = save_settings(a)
        self.app.broadcast_state()
        return s

    def m_conversations(self, a, done):
        dev = a["device"]
        # A full resync makes the phone resend every thread (thousands of
        # signals, and a busy daemon for tens of seconds), so do it at most
        # every five minutes rather than every time Messages opens. New
        # messages arrive as signals in between anyway.
        if a.get("request") and time.time() - self.d.last_resync.get(dev, 0) > 300:
            self.d.last_resync[dev] = time.time()
            self.d.call_async(device_path(dev), "org.kde.kdeconnect.device.conversations", "requestAllConversationThreads", done=lambda r, e: None)
            # Names come from the phone's contacts; ask for a fresh copy. The
            # answer arrives as localCacheSynchronized (see on_signal).
            if self.d.has(dev, "kdeconnect_contacts"):
                self.d.call_async(device_path(dev) + "/contacts", "org.kde.kdeconnect.device.contacts", "synchronizeRemoteWithLocal", done=lambda r, e: None)
        self.d.conversations_async(dev, lambda result, error: done(result, error))
        return ASYNC

    def m_thread(self, a, done):
        dev, tid = a["device"], int(a["thread"])
        if tid >= 0:  # negative ids are local-only threads; the phone has nothing
            self.d.call_async(device_path(dev), "org.kde.kdeconnect.device.conversations", "requestConversation", "(xii)", (tid, 0, int(a.get("count", 60))))
        return self.d.thread(dev, tid)

    def m_sendMessage(self, a, done):
        dev, text = a["device"], a["text"]
        iface = "org.kde.kdeconnect.device.conversations"
        tid = int(a["thread"]) if a.get("thread") is not None else None
        if tid is not None and tid >= 0:
            # Kept with the record so it still names the thread if the phone
            # later drops the thread from its list.
            addresses = [x for x in (a.get("addresses") or []) if x]
            method, sig, args = "replyToConversation", "(xsav)", (tid, text, [])
        else:
            addresses = [x.strip() for x in (a.get("addresses") or self.d.thread_addresses(dev, tid)) if x.strip()]
            if not addresses:
                raise ValueError("no recipient")
            tid = None
            variants = [GLib.Variant("(s)", (x,)) for x in addresses]
            method, sig, args = "sendWithoutConversation", "(avsav)", (variants, text, [])

        def sent(_result, error):
            if error:
                done(None, error)
                return
            rec = sent_add(dev, tid, addresses, text)
            thread = self.d.resolve_thread(dev, rec)
            done({"thread": thread, "message": self.d.local_message(dev, rec, thread)})

        self.d.call_async(device_path(dev), iface, method, sig, args, sent)
        return ASYNC

    def m_close(self, a, done):
        self.window.close()


ASYNC = object()


# --- Application ------------------------------------------------------------------


class App(Gtk.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.daemon = None
        self.bridges = []
        self.main = None

    def do_startup(self):
        Gtk.Application.do_startup(self)
        if os.environ.get("KDECONNECT_SKIN_DEMO"):
            from demo import DemoDaemon  # made-up data, never touches the bus

            self.daemon = DemoDaemon(self.broadcast)
        else:
            self.daemon = Daemon(self.broadcast)

    def broadcast(self, kind, payload):
        for b in list(self.bridges):
            b.push(kind, payload)

    def broadcast_state(self):
        self.broadcast("state", self.daemon.snapshot())

    def do_command_line(self, cmdline):
        argv = cmdline.get_arguments()[1:]
        cwd = cmdline.get_cwd() or os.getcwd()
        if argv and argv[0] in ("-h", "--help"):
            cmdline.print_literal("usage: kdeconnect-skin [--share FILE|URL ...]\n")
            return 0
        if argv and argv[0] == "--share":
            items = [x if re.match(r"^[a-z][a-z0-9+.-]*:", x) else os.path.join(cwd, x) for x in argv[1:]]
            if items:
                self.open_window("share", items)
            return 0
        self.open_window("main")
        return 0

    def open_window(self, mode, shares=None):
        if mode == "main" and self.main:
            self.main.present()
            return
        win = Gtk.ApplicationWindow(application=self, title="KDE Connect" if mode == "main" else "Send to device")
        if mode == "main":
            win.set_default_size(1180, 780)
            self.main = win
            win.connect("close-request", lambda *_: setattr(self, "main", None) or False)
        else:
            win.set_default_size(480, 340)
        view = WebKit.WebView()
        settings = view.get_settings()
        settings.set_allow_file_access_from_file_urls(True)
        settings.set_enable_developer_extras(DEBUG)
        settings.set_enable_write_console_messages_to_stdout(DEBUG)
        bg = Gdk.RGBA()
        bg.parse(theme_background())
        view.set_background_color(bg)
        if not DEBUG:
            view.connect("context-menu", lambda *_: True)
        view.connect("decide-policy", self.on_policy)
        bridge = Bridge(self, view, win, mode, shares)
        self.bridges.append(bridge)
        win.connect("destroy", lambda *_: self.bridges.remove(bridge))
        win.set_child(view)
        view.load_uri((WEB_DIR / "index.html").as_uri() + ("#share" if mode == "share" else ""))
        win.present()

    def on_policy(self, view, decision, kind):
        # Links out of the page open in the default browser, not in the view.
        if kind == WebKit.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith("file:"):
                decision.ignore()
                Gio.AppInfo.launch_default_for_uri(uri, None)
                return True
        return False


def main():
    return App().run(sys.argv)


if __name__ == "__main__":
    sys.exit(main())
