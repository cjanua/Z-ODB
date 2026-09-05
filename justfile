set dotenv-load := true

_default:
    @just --list

# ─── Bootstrap ───────────────────────────────────────────────────────────────

[group('ci')]
[doc('Install Nix + enable flakes — run once on a fresh machine')]
bootstrap:
    bash scripts/bootstrap.sh

# ─── App (run inside `nix develop`) ──────────────────────────────────────────

[group('app')]
[doc('Start Tauri desktop dev window (needs nix develop)')]
dev:
    bun run dev

[group('app')]
[doc('Start Vite dev server only — browser, no Tauri shell')]
dev-web:
    bun run dev-web

[group('app')]
[doc('Install JS dependencies')]
install:
    bun install

# ─── Build (via Docker — no local Rust/bun needed) ───────────────────────────

[group('build')]
[doc('Build web dist/ in Docker for Cloudflare Pages')]
build-web:
    DOCKER_BUILDKIT=1 docker build \
        --target web \
        --output type=local,dest=dist \
        -f Dockerfile .
    @echo "dist/ ready for 'just deploy-web'"

[group('build')]
[doc('Build Linux .deb/.AppImage in Docker')]
build-linux:
    DOCKER_BUILDKIT=1 docker build \
        --target linux \
        --output type=local,dest=bundle \
        -f Dockerfile .
    @echo "bundle/ contains .deb and .AppImage"

[group('build')]
[doc('Build macOS app (run on mac mini, needs nix develop)')]
build-mac:
    bun run build-tauri -- --target universal-apple-darwin

[group('build')]
[doc('Build iOS app (run on mac mini, needs nix develop + Xcode)')]
build-ios:
    bunx tauri ios build

# ─── Deploy ──────────────────────────────────────────────────────────────────

[group('ci')]
[doc('Deploy dist/ to Cloudflare Pages')]
deploy-web: build-web
    bunx wrangler pages deploy dist/ --project-name z-obd

# ─── Nix ─────────────────────────────────────────────────────────────────────

[group('ci')]
[doc('Update flake.lock')]
flake-update:
    nix flake update

[group('ci')]
[doc('Check flake outputs')]
flake-check:
    nix flake check

[group('dropbox')]
[private]
[doc('One-time Dropbox OAuth setup — saves refresh token to .env')]
ensure-auth:
    uv run python scripts/dropbox/auth.py

[group('dropbox')]
[doc('List contents of a Dropbox folder')]
[arg("folder", help="Dropbox path to list (default: root)")]
ls folder="": ensure-auth
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
pull folder="$FUSION_DBX_PATH/CsvLogs/$MY_VIN" dest="./data" limit="1": ensure-auth
    mkdir -p {{dest}}
    uv run python scripts/dropbox/fetch.py --folder "{{folder}}" --dest "{{dest}}" --limit {{limit}}
