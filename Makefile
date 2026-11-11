# make install            -> ~/.local, gruvbox-dark
# make install THEME=catppuccin-mocha PREFIX=/usr/local
# make run                -> build into ./build and start it with debug output
#
# The Nix package (package.nix) calls `make install` too, passing THEME_CSS,
# FONTS_CSS and PYTHON.

PREFIX ?= $(HOME)/.local
PYTHON ?= python3
THEME ?= gruvbox-dark
THEME_CSS ?= themes/$(THEME).css
FONTS_CSS ?=
APP_ID = io.github.mukheshpugal.KdeconnectSkin
SHARE = $(PREFIX)/share/kdeconnect-skin
BIN = $(PREFIX)/bin/kdeconnect-skin
APPS = $(PREFIX)/share/applications
# What the desktop entries run. The Nix package sets this to the bare name, so
# a launcher that caches entries keeps working across rebuilds.
DESKTOP_EXEC ?= $(abspath $(BIN))

.PHONY: install uninstall run

install:
	install -Dm644 src/kdeconnect_skin.py $(SHARE)/kdeconnect_skin.py
	install -Dm644 src/demo.py $(SHARE)/demo.py
	install -Dm644 -t $(SHARE)/web src/web/index.html src/web/app.css src/web/app.js
	install -Dm644 $(THEME_CSS) $(SHARE)/web/palette.css
	if [ -n "$(FONTS_CSS)" ]; then install -Dm644 $(FONTS_CSS) $(SHARE)/web/fonts.css; \
	else install -Dm644 /dev/null $(SHARE)/web/fonts.css; fi
	install -d $(PREFIX)/bin $(APPS)
	printf '#!/bin/sh\nKDECONNECT_SKIN_WEB_DIR=%s/web exec %s %s/kdeconnect_skin.py "$$@"\n' \
		"$(abspath $(SHARE))" "$(PYTHON)" "$(abspath $(SHARE))" > $(BIN)
	chmod 755 $(BIN)
	sed "s|@BIN@|$(DESKTOP_EXEC)|" data/kdeconnect-skin.desktop.in > $(APPS)/$(APP_ID).desktop
	sed "s|@BIN@|$(DESKTOP_EXEC)|" data/kdeconnect-skin-share.desktop.in > $(APPS)/$(APP_ID).Share.desktop

uninstall:
	rm -rf $(SHARE) $(BIN) $(APPS)/$(APP_ID).desktop $(APPS)/$(APP_ID).Share.desktop

run:
	$(MAKE) install PREFIX=build
	KDECONNECT_SKIN_DEBUG=1 build/bin/kdeconnect-skin
