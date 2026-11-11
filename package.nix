# Build with `pkgs.callPackage ./package.nix { }`.
#
# Pick the colours with one of:
#   theme = ./themes/catppuccin-mocha.css;   # a theme file
#   colors = { bg0_hard = "#1d2021"; ... }; # an attrset of the same names,
#                                            # e.g. a palette from your dotfiles
# `colors` wins when both are given. Extra names in it are passed through.
{
  lib,
  stdenvNoCC,
  writeText,
  python3,
  gtk4,
  webkitgtk_6_0,
  glib-networking,
  gobject-introspection,
  wrapGAppsHook4,
  makeWrapper,
  inter,
  theme ? ./themes/gruvbox-dark.css,
  colors ? null,
}:

let
  paletteCss =
    if colors == null then
      theme
    else
      writeText "palette.css" ''
        :root {
        ${lib.concatStrings (lib.mapAttrsToList (name: value: "  --${name}: ${value};\n") colors)}}
      '';

  # Inter is the body face; bundling it means the page looks the same whether
  # or not it is installed system-wide.
  fontsCss = writeText "fonts.css" ''
    @font-face {
      font-family: "Inter";
      src: url("file://${inter}/share/fonts/truetype/InterVariable.ttf") format("truetype");
      font-weight: 100 900;
      font-style: normal;
    }
  '';

  python = python3.withPackages (ps: [ ps.pygobject3 ]);
in
stdenvNoCC.mkDerivation {
  pname = "kdeconnect-skin";
  version = "0.1.0";

  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./src
      ./Makefile
      ./data
    ];
  };

  nativeBuildInputs = [
    wrapGAppsHook4
    gobject-introspection
    makeWrapper
  ];

  buildInputs = [
    gtk4
    webkitgtk_6_0
    glib-networking
  ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall
    make install PREFIX=$out DESKTOP_EXEC=kdeconnect-skin PYTHON=${python}/bin/python3 THEME_CSS=${paletteCss} FONTS_CSS=${fontsCss}
    runHook postInstall
  '';

  # wrapGAppsHook4 only wraps ELF files; fold its environment (GI_TYPELIB_PATH,
  # GIO modules, XDG_DATA_DIRS) into the launcher script instead.
  dontWrapGApps = true;
  preFixup = ''
    wrapProgram $out/bin/kdeconnect-skin "''${gappsWrapperArgs[@]}"
  '';

  meta = {
    description = "A themeable window for the KDE Connect daemon";
    homepage = "https://github.com/mukheshpugal/kdeconnect-skin";
    mainProgram = "kdeconnect-skin";
    platforms = lib.platforms.linux;
  };
}
