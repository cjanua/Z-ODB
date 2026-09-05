{
  description = "Z OBD Dashboard — Tauri 2.0 + React + DuckDB-WASM dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        # Stable Rust with mobile + wasm targets
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
          targets = [
            "x86_64-unknown-linux-gnu"
            "aarch64-unknown-linux-gnu"
            "wasm32-unknown-unknown"
          ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            "aarch64-apple-darwin"
            "x86_64-apple-darwin"
            "aarch64-apple-ios"
            "aarch64-apple-ios-sim"
            "x86_64-apple-ios"
          ];
        };

        # Tauri needs these on Linux
        linuxDeps = pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
          webkitgtk_4_1
          gtk3
          at-spi2-atk
          atkmm
          cairo
          gdk-pixbuf
          glib
          gobject-introspection
          harfbuzz
          librsvg
          libsoup_3
          openssl
          pango
          xdotool
          xorg.libX11
          xorg.libXext
          # GStreamer for media support in WebKitGTK
          gst_all_1.gstreamer
          gst_all_1.gst-plugins-base
          gst_all_1.gst-plugins-good
          gst_all_1.gst-plugins-bad
        ]);

        macosDeps = pkgs.lib.optionals pkgs.stdenv.isDarwin (with pkgs; [
          darwin.apple_sdk.frameworks.WebKit
          darwin.apple_sdk.frameworks.Security
          darwin.apple_sdk.frameworks.CoreServices
          darwin.apple_sdk.frameworks.CoreFoundation
          darwin.apple_sdk.frameworks.SystemConfiguration
        ]);

      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Rust toolchain
            rustToolchain

            # Frontend
            bun

            # Task runner + Python pipeline
            just
            uv

            # Build tools
            pkg-config
            openssl.dev

            # Docker (for build-web / build-linux targets)
            docker
            docker-compose

            # cargo-tauri CLI (builds the Tauri binary)
            # Install via: cargo install tauri-cli --version "^2"
            # (kept out of nix to match exact Tauri version in Cargo.toml)
          ] ++ linuxDeps ++ macosDeps;

          shellHook = ''
            export PKG_CONFIG_PATH="${pkgs.openssl.dev}/lib/pkgconfig''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"

            ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              export WEBKIT_DISABLE_COMPOSITING_MODE=1
              export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
              export GDK_BACKEND=x11
            ''}

            echo ""
            echo "  Z OBD dev shell"
            echo "  rust  : $(rustc --version 2>/dev/null || echo 'not found')"
            echo "  bun   : $(bun --version 2>/dev/null || echo 'not found')"
            echo "  just  : $(just --version 2>/dev/null || echo 'not found')"
            echo "  uv    : $(uv --version 2>/dev/null || echo 'not found')"
            echo ""
            echo "  Run 'just' to list all commands."
            echo ""
          '';
        };
      }
    );
}
