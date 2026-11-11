{
  description = "A themeable window for the KDE Connect daemon";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAll (pkgs: {
        default = pkgs.callPackage ./package.nix { };
        catppuccin-mocha = pkgs.callPackage ./package.nix { theme = ./themes/catppuccin-mocha.css; };
      });

      # pkgs.kdeconnect-skin, overridable with { theme = ...; } or { colors = ...; }.
      overlays.default = final: _: { kdeconnect-skin = final.callPackage ./package.nix { }; };

      formatter = forAll (pkgs: pkgs.nixfmt-tree);
    };
}
