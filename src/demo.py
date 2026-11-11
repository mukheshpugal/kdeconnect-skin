"""Demo mode: KDECONNECT_SKIN_DEMO=1 kdeconnect-skin

Runs the window against made-up devices, messages and notifications instead
of kdeconnectd, so screenshots never show anyone's real data. Nothing here
touches the session bus; actions update the fake state in memory or do
nothing.
"""

import time

from gi.repository import GLib

from kdeconnect_skin import PLUGIN_CONFIG, PLUGINS, Daemon, load_settings

MIN = 60_000
HOUR = 60 * MIN
DAY = 24 * HOUR

ALL_PLUGINS = sorted(p for p in PLUGINS if p != "kdeconnect_shareinputdevicesremote")
OFF_BY_DEFAULT = {"kdeconnect_screensaver_inhibit", "kdeconnect_sendnotifications", "kdeconnect_shareinputdevices", "kdeconnect_virtualmonitor"}

# (thread, name, number, [(minutes ago, outgoing, text), ...]) -- oldest first.
CONVERSATIONS = [
    (101, "Maya Okafor", "+1 555 0142", [
        (190, False, "Are you still coming to the climbing gym tonight?"),
        (186, True, "Yes! Leaving work around 6."),
        (185, False, "Perfect. I booked the 6:30 slot for both of us."),
        (40, False, "Running 10 minutes late, grab a warm-up wall"),
        (38, True, "No rush, I'll be on the blue route"),
        (12, False, "Here now. Which wall?"),
    ]),
    (102, "Dad", "+1 555 0177", [
        (26 * 60, False, "Did the package arrive?"),
        (25 * 60, True, "It did, thanks. The lamp looks great."),
        (3 * 60, False, "Call me this weekend when you have a minute"),
    ]),
    (103, "Sam Lindqvist", "+1 555 0110", [
        (3 * 24 * 60, True, "Sending the slides over now"),
        (3 * 24 * 60 - 5, False, "Got them. The charts on page 4 are great"),
    ]),
    (104, "Pharmacy", "55012", [
        (4 * 24 * 60, False, "Your prescription is ready for pickup at the Main St store."),
    ]),
    (105, "Priya Nair", "+1 555 0193", [
        (6 * 24 * 60, False, "Happy birthday!! Dinner on me next week"),
        (6 * 24 * 60 - 30, True, "Thank you! Thursday works"),
    ]),
    (106, "Book club", "+1 555 0120", [
        (9 * 24 * 60, False, "Next pick: The Left Hand of Darkness"),
    ]),
]


class DemoDaemon(Daemon):
    def __init__(self, push):
        self.push = push
        self.online = True
        self.threads = {}
        self.contacts = {}
        self.thread_keys = {}
        self.pair_seen = {}
        self.last_resync = {}
        self.name = "workstation"
        self.providers = [
            {"display": "Bluetooth", "name": "BluetoothLinkProvider", "enabled": True},
            {"display": "LAN", "name": "LanLinkProvider", "enabled": True},
        ]
        now = time.time()
        enabled = {p: p not in OFF_BY_DEFAULT for p in ALL_PLUGINS}
        phone = {
            "id": "demo_pixel",
            "name": "Pixel 8",
            "type": "phone",
            "reachable": True,
            "paired": True,
            "pairRequested": False,
            "pairRequestedByPeer": False,
            "verificationKey": "A3F9217C",
            "addresses": ["192.168.1.42"],
            "providers": ["LAN"],
            "supported": ALL_PLUGINS,
            "pairRequestedAt": None,
            "plugins": {"loaded": [p for p, on in enabled.items() if on], "enabled": enabled},
            "battery": {"charge": 78, "charging": True},
            "signal": {"type": "5G", "strength": 4},
            "mpris": {
                "playerList": ["Spotify", "YouTube Music"],
                "player": "Spotify",
                "title": "Northern Lights",
                "artist": "The Quiet Hours",
                "album": "Field Recordings",
                "length": 247_000,
                "position": 104_000,
                "isPlaying": True,
                "volume": 64,
                "canSeek": True,
                "localAlbumArtUrl": "",
                "fetchedAt": now * 1000,
            },
            "notifications": [
                {"id": "n1", "app": "Messages", "title": "Maya Okafor", "text": "Here now. Which wall?", "dismissable": True, "replyId": "", "icon": ""},
                {"id": "n2", "app": "Calendar", "title": "Design review", "text": "Today at 3:00 PM · Room 2B", "dismissable": True, "replyId": "", "icon": ""},
                {"id": "n3", "app": "Phone", "title": "Missed call", "text": "Dad", "dismissable": True, "replyId": "", "icon": ""},
            ],
            "commands": [
                {"key": "c1", "name": "Lock screen", "command": "loginctl lock-session"},
                {"key": "c2", "name": "Suspend", "command": "systemctl suspend"},
                {"key": "c3", "name": "Toggle mute", "command": "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"},
            ],
            "config": {pid: dict(defaults) for pid, defaults in PLUGIN_CONFIG.items()},
        }
        laptop = {
            **phone,
            "id": "demo_laptop",
            "name": "thinkpad",
            "type": "laptop",
            "reachable": False,
            "verificationKey": "71C0E2B4",
            "addresses": [],
            "providers": [],
            "battery": None,
            "signal": None,
            "mpris": None,
            "notifications": [],
            "commands": [],
        }
        tablet = {
            **laptop,
            "id": "demo_tablet",
            "name": "Galaxy Tab S9",
            "type": "tablet",
            "reachable": True,
            "paired": False,
            "pairRequestedByPeer": True,
            "pairRequestedAt": now,
            "verificationKey": "5D2E9A07",
            "addresses": ["192.168.1.57"],
            "providers": ["LAN"],
            "plugins": {"loaded": [], "enabled": {}},
            "config": {},
        }
        self.devices = {d["id"]: d for d in (phone, laptop, tablet)}

        base = now * 1000
        for tid, name, number, msgs in CONVERSATIONS:
            thread = self.threads.setdefault("demo_pixel", {}).setdefault(tid, {})
            for i, (ago, out, text) in enumerate(msgs):
                uid = tid * 100 + i
                thread[uid] = {"body": text, "addresses": [number], "date": int(base - ago * MIN), "type": 2 if out else 1, "read": out or ago > 30, "thread": tid, "uid": uid, "attachments": 0}
            self.contacts.setdefault("demo_pixel", {})[number] = name

    # Everything the bridge asks of the real daemon, answered from memory.

    def snapshot(self):
        return {
            "online": True,
            "self": {"id": "demo_workstation", "name": self.name},
            "providers": self.providers,
            "devices": list(self.devices.values()),
            "plugins": PLUGINS,
            "settings": load_settings(),
        }

    def changed(self):
        GLib.idle_add(lambda: self.push("state", self.snapshot()) and False)

    def mark(self, dev, section):
        self.changed()

    def has(self, dev, plugin):
        return plugin in self.devices.get(dev, {}).get("plugins", {}).get("loaded", [])

    def call(self, path, iface, method, sig=None, args=None, reply=None, timeout=4000):
        if method == "setAnnouncedName":
            self.name = args[0]
        elif method == "setLinkProviderState":
            for p in self.providers:
                if p["name"] == args[0]:
                    p["enabled"] = args[1]
        elif method == "setPluginEnabled":
            dev = self.devices[path.rsplit("/", 1)[-1]]
            dev["plugins"]["enabled"][args[0]] = args[1]
            loaded = set(dev["plugins"]["loaded"])
            (loaded.add if args[1] else loaded.discard)(args[0])
            dev["plugins"]["loaded"] = sorted(loaded)
        return None

    def call_async(self, path, iface, method, sig=None, args=None, done=None, timeout=30000):
        if method == "acceptPairing":
            self.devices["demo_tablet"].update(paired=True, pairRequestedByPeer=False)
        elif method == "cancelPairing":
            self.devices["demo_tablet"].update(pairRequestedByPeer=False)
        elif method == "dismiss":
            nid = path.rsplit("/", 1)[-1]
            phone = self.devices["demo_pixel"]
            phone["notifications"] = [n for n in phone["notifications"] if n["id"] != nid]
        self.changed()
        if done:
            error = "Demo mode has no phone to browse" if method == "mountAndWait" else None
            GLib.idle_add(lambda: done(None if error else True, error) and False)

    def set_prop(self, path, iface, name, variant):
        m = self.devices["demo_pixel"]["mpris"]
        m[name] = variant.unpack()
        if name == "position":
            m["fetchedAt"] = time.time() * 1000

    def name_for(self, dev, addresses):
        return ", ".join(self.contacts.get(dev, {}).get(a, a) for a in addresses)

    def conversations_async(self, dev, done):
        GLib.idle_add(lambda: done(self.conversations(dev), None) and False)

    def conversations(self, dev):
        out = []
        for tid, msgs in self.threads.get(dev, {}).items():
            last = dict(max(msgs.values(), key=lambda m: m["date"]))
            last["name"] = self.name_for(dev, last["addresses"])
            out.append(last)
        self.thread_keys[dev] = {}
        return sorted(out, key=lambda m: -m["date"])

    def thread(self, dev, tid):
        return sorted(self.threads.get(dev, {}).get(tid, {}).values(), key=lambda m: m["date"])

    def save_commands(self, dev, cmds):
        self.devices[dev]["commands"] = [dict(c, key=c.get("key") or str(i)) for i, c in enumerate(cmds)]

    def save_plugin_config(self, dev, plugin, values):
        self.devices[dev]["config"][plugin].update(values)
