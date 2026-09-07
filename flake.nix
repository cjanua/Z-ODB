{
  description = "Z OBD Dashboard — Tauri 2.0 + React + DuckDB-WASM";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils.url = "github:numtide/flake-utils";
    nixgl = {
      url = "github:nix-community/nixGL";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils, nixgl }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) nixgl.overlay ];
        pkgs = import nixpkgs { localSystem.system = system; inherit overlays; };

        # ── Rust toolchains ────────────────────────────────────────────────────

        # DEV: full toolchain with IDE + lint niceties
        rustDev = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
          targets = [
            "x86_64-unknown-linux-gnu"
            "aarch64-unknown-linux-gnu"
            "wasm32-unknown-unknown"
          ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
            "aarch64-apple-darwin"
            "x86_64-apple-darwin"
            "aarch64-apple-ios"
            "aarch64-apple-ios-sim"
            "x86_64-apple-ios"
          ];
        };

        # BUILD: minimal — just rustc + cargo, no IDE extensions
        rustBuild = pkgs.rust-bin.stable.latest.minimal.override {
          targets = [ "x86_64-unknown-linux-gnu" "wasm32-unknown-unknown" ];
        };

        # ── Linux system deps (Tauri / WebKitGTK) ─────────────────────────────
        linuxDeps = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux (with pkgs; [
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
          libx11
          libxext
          gst_all_1.gstreamer
          gst_all_1.gst-plugins-base
          gst_all_1.gst-plugins-good
          gst_all_1.gst-plugins-bad
        ]);

        macosDeps = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin (with pkgs; [
          darwin.apple_sdk.frameworks.WebKit
          darwin.apple_sdk.frameworks.Security
          darwin.apple_sdk.frameworks.CoreServices
          darwin.apple_sdk.frameworks.CoreFoundation
          darwin.apple_sdk.frameworks.SystemConfiguration
        ]);

        # ── BUILD image contents ───────────────────────────────────────────────
        buildPkgs = with pkgs; [
          rustBuild
          bun
          pkg-config
          openssl
          bashInteractive
          coreutils
          findutils
          gnused
          git
        ] ++ linuxDeps;

        # ── PROD nginx config (SPA + COOP/COEP for DuckDB-WASM) ───────────────
        nginxConf = pkgs.writeText "z-obd-nginx.conf" ''
          pid /tmp/nginx.pid;
          error_log stderr;
          events { worker_connections 1024; }
          http {
            include ${pkgs.nginx}/conf/mime.types;
            access_log /dev/stdout;
            gzip on;
            gzip_types
              text/plain text/css text/javascript
              application/javascript application/json
              application/wasm image/svg+xml;
            server {
              listen 80;
              root /srv/www;
              location / {
                try_files $uri $uri/ /index.html;
                add_header Cross-Origin-Opener-Policy  "same-origin"   always;
                add_header Cross-Origin-Embedder-Policy "require-corp" always;
              }
            }
          }
        '';

      in {

        # ── DEV shell ─────────────────────────────────────────────────────────
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            rustDev
            bun
            just
            uv
            pkg-config
            openssl.dev
            docker
            docker-compose
            watchexec
            tmux
            pkgs.nixgl.nixGLIntel
            playwright-driver
          ] ++ linuxDeps ++ macosDeps;

          shellHook = ''
            export PKG_CONFIG_PATH="${pkgs.openssl.dev}/lib/pkgconfig''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              export WEBKIT_DISABLE_COMPOSITING_MODE=1
              export WEBKIT_DISABLE_DMABUF_RENDERER=1
              export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
            ''}
            set +a && source .env && set -a
          '';
        };

        # ── Docker images (Linux-only — Docker images are always linux/amd64) ─
        packages = pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {

          # BUILD: compile tools only, no rust-analyzer / clippy / watchexec
          docker-build = pkgs.dockerTools.buildLayeredImage {
            name = "z-obd-build";
            tag  = "latest";
            contents = buildPkgs;
            config = {
              WorkingDir = "/app";
              Env = [
                "PATH=${pkgs.lib.makeBinPath buildPkgs}"
                "PKG_CONFIG_PATH=${pkgs.openssl.dev}/lib/pkgconfig"
                "WEBKIT_DISABLE_COMPOSITING_MODE=1"
                "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              ];
            };
          };

          # PROD: nginx only — mount dist/ at /srv/www or bake it in
          docker-prod = pkgs.dockerTools.buildLayeredImage {
            name = "z-obd-prod";
            tag  = "latest";
            contents = with pkgs; [ nginx bash coreutils ];
            extraCommands = "mkdir -p srv/www tmp";
            config = {
              ExposedPorts = { "80/tcp" = {}; };
              Cmd = [ "${pkgs.nginx}/bin/nginx" "-c" "${nginxConf}" "-g" "daemon off;" ];
            };
          };

        };
      }
    );
}
