set dotenv-load := true

_default:
    @just --list

# ─── Environment ─────────────────────────────────────────────────────────────
# ENVS and validation live in scripts/env.sh (single source of truth).
# Usage as a recipe dependency:  recipe: (_require "PROD")
[private]
_require required:
    bash scripts/env.sh "{{required}}"

# ─── App (run inside `nix develop`) ──────────────────────────────────────────

# Targets: web | gui
[group('app')]
[doc('Dev server — just dev [web | gui]')]
dev target="gui": (_require "DEV")
    #!/usr/bin/env bash
    export WEBKIT_DISABLE_COMPOSITING_MODE=1
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
    case "{{target}}" in
      web) exec bun run dev-web ;;
      gui) ;;
      *) printf 'Unknown target "%s". Valid: web | gui\n' "{{target}}" >&2; exit 1 ;;
    esac
    # gui: clippy watcher in background, Tauri dev wrapped with nixGLIntel (AMD/Mesa fix)
    watchexec \
        --watch src-tauri/src \
        --exts rs \
        --workdir src-tauri \
        --restart \
        -- bash -c 'cargo clippy 2>&1 | sed "s/^/\x1b[33m[clippy]\x1b[0m /"' &
    CLIPPY_PID=$!
    cleanup() { kill -- -"$CLIPPY_PID" "$CLIPPY_PID" 2>/dev/null; wait "$CLIPPY_PID" 2>/dev/null; }
    trap cleanup EXIT INT TERM HUP
    nixGLIntel bun run dev

_install_js:
    bun install

_install_rs:
    cd src-tauri && cargo fetch

[parallel]
_install_all: _install_js _install_rs

# Targets: all | js | cargo
[group('app')]
[doc('Install dependencies — just install [all | js | cargo]')]
reinstall target="all":
    #!/usr/bin/env bash
    case "{{target}}" in
      all)   @just _install_all ;;
      js)    @just _install_js ;;
      cargo) @just _install_rs ;;
      hard)  scripts/install.sh ;;
      *) printf 'Unknown target "%s". Valid: all | js | cargo\n' "{{target}}" >&2; exit 1 ;;
    esac

[private]
_check-docker:
    #!/usr/bin/env bash
    if ! groups | grep -qw docker; then
        printf '\033[31mERROR\033[0m User "%s" is not in the docker group.\n' "$USER" >&2
        printf '      Fix: sudo usermod -aG docker $USER  then log out and back in.\n' >&2
        exit 1
    fi
    if ! docker info &>/dev/null; then
        printf '\033[31mERROR\033[0m Docker daemon is not running.\n' >&2
        printf '      Start:       sudo systemctl start docker\n' >&2
        printf '      Enable boot: sudo systemctl enable --now docker\n' >&2
        exit 1
    fi

# CI only (requires ENV=BUILD). Targets: web | linux | mac | ios
# Default builds both web + linux. Override: just build web
[group('ci')]
[doc('Build artifacts — CI only (ENV=BUILD). Defaults to web+linux.')]
build target="all": (_require "BUILD") _check-docker
    #!/usr/bin/env bash
    _load_build_image() {
        echo "Building z-obd-build image via nix..."
        nix build .#docker-build --out-link /tmp/z-obd-build
        docker load < /tmp/z-obd-build
    }
    _build_web() {
        _load_build_image
        docker run --rm -v "$(pwd):/app" z-obd-build:latest \
            bash -c 'bun install --frozen-lockfile && bun run build'
        printf '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n' \
            > dist/_headers
        echo "dist/ ready"
    }
    _build_linux() {
        _load_build_image
        docker run --rm -v "$(pwd):/app" z-obd-build:latest \
            bash -c 'bun install --frozen-lockfile && bun run build && cd src-tauri && cargo tauri build'
        echo "bundle/ contains .deb and .AppImage"
    }
    case "{{target}}" in
      all)   _build_web; _build_linux ;;
      web)   _build_web ;;
      linux) _build_linux ;;
      mac)   bun run build-tauri -- --target universal-apple-darwin ;;
      ios)   bunx tauri ios build ;;
      *) printf 'Unknown target "%s". Valid: all | web | linux | mac | ios\n' "{{target}}" >&2; exit 1 ;;
    esac

# ─── Deploy ──────────────────────────────────────────────────────────────────

# Targets: web | linux | mac | ios | all
[group('ci')]
[doc('Build + deploy — just deploy [web | linux | mac | ios | all]')]
deploy target="web": (_require "BUILD")
    #!/usr/bin/env bash
    _version() {
        jq -r .version src-tauri/tauri.conf.json
    }

    _deploy_web() {
        just build web
        bunx wrangler pages deploy dist/ --project-name z-obd
        echo "Web deployed to Cloudflare Pages"
    }

    _deploy_linux() {
        just build linux
        TAG="v$(_version)"
        shopt -s nullglob
        ARTIFACTS=(
            src-tauri/target/release/bundle/deb/*.deb
            src-tauri/target/release/bundle/appimage/*.AppImage
        )
        if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
            printf '\033[31mERROR\033[0m No Linux artifacts found in src-tauri/target/release/bundle/\n' >&2
            exit 1
        fi
        gh release create "$TAG" \
            --title "Z OBD Dashboard $TAG" \
            --generate-notes \
            "${ARTIFACTS[@]}"
        echo "Linux binaries published to GitHub Releases as $TAG"
    }

    _deploy_mac() {
        just build mac
        TAG="v$(_version)"
        shopt -s nullglob
        ARTIFACTS=(src-tauri/target/release/bundle/macos/*.dmg)
        gh release create "$TAG" \
            --title "Z OBD Dashboard $TAG" \
            --generate-notes \
            "${ARTIFACTS[@]}"
        echo "macOS dmg published to GitHub Releases as $TAG"
    }

    _deploy_ios() {
        just build ios
        echo "iOS: submit via Xcode / Transporter after build"
    }

    case "{{target}}" in
      web)   _deploy_web ;;
      linux) _deploy_linux ;;
      mac)   _deploy_mac ;;
      ios)   _deploy_ios ;;
      all)   _deploy_web; _deploy_linux ;;
      *) printf 'Unknown target "%s". Valid: web | linux | mac | ios | all\n' "{{target}}" >&2; exit 1 ;;
    esac

# ─── DropBox ─────────────────────────────────────────────────────────────────────

[group('dropbox')]
[private]
[doc('One-time Dropbox OAuth setup — saves refresh token to .env')]
auth:
    uv run python scripts/dropbox/auth.py

[group('dropbox')]
[doc('List contents of a Dropbox folder')]
[arg("folder", help="Dropbox path to list (default: root)")]
ls folder="": auth
    #!/usr/bin/env -S uv run --script
    # /// script
    # dependencies = ["dropbox", "python-dotenv"]
    # ///
    import os, dropbox
    from dotenv import load_dotenv
    load_dotenv()
    dbx = dropbox.Dropbox(
        app_key=os.environ["DROPBOX_APP_KEY"],
        app_secret=os.environ["DROPBOX_APP_SECRET"],
        oauth2_refresh_token=os.environ["DROPBOX_REFRESH_TOKEN"],
    )
    dbx.check_and_refresh_access_token()
    res = dbx.files_list_folder("{{folder}}")
    for e in sorted(res.entries, key=lambda x: x.name):
        kind = "DIR " if isinstance(e, dropbox.files.FolderMetadata) else "FILE"
        print(f"  {kind}  {e.path_display}")

[group('dropbox')]
[doc('Fetch files from Dropbox folder')]
[arg("folder", help="Dropbox path to list")]
[arg("dest", help="Local destination directory")]
[arg("limit", help="Number of recent files, or 'all'")]
pull folder="$FUSION_DBX_PATH/CsvLogs/$MY_VIN" dest="./data" limit="1": auth
    mkdir -p {{dest}}
    uv run python scripts/dropbox/fetch.py --folder "{{folder}}" --dest "{{dest}}" --limit {{limit}}
