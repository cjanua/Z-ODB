set dotenv-load := true

_default:
    @just --list

# ─── Environment ─────────────────────────────────────────────────────────────
# ENVS and validation live in scripts/env.sh (single source of truth).
# Usage as a recipe dependency:  recipe: (_require "PROD")
[private]
_require required:
    bash scripts/env.sh "{{required}}"

# ─── Bootstrap ───────────────────────────────────────────────────────────────

[group('ci')]
[doc('Install Nix + enable flakes — run once on a fresh machine')]
bootstrap:
    bash scripts/bootstrap.sh

# ─── App (run inside `nix develop`) ──────────────────────────────────────────

# Targets: web | tauri
[group('app')]
[doc('Dev server — just dev web | just dev tauri')]
dev target="web":
    #!/usr/bin/env bash
    case "{{target}}" in
      web)   bun run dev-web ;;
      tauri) bun run dev ;;
      *) printf 'Unknown target "%s". Valid: web | tauri\n' "{{target}}" >&2; exit 1 ;;
    esac

[group('app')]
[doc('Install JS dependencies')]
install:
    bun install

# Targets: web | linux | mac | ios
[group('build')]
[doc('Build for target — just build web | linux | mac | ios')]
build target="web":
    #!/usr/bin/env bash
    case "{{target}}" in
      web)
        DOCKER_BUILDKIT=1 docker build --target web --output type=local,dest=dist -f Dockerfile .
        echo "dist/ ready for 'just deploy-web'"
        ;;
      linux)
        DOCKER_BUILDKIT=1 docker build --target linux --output type=local,dest=bundle -f Dockerfile .
        echo "bundle/ contains .deb and .AppImage"
        ;;
      mac)   bun run build-tauri -- --target universal-apple-darwin ;;
      ios)   bunx tauri ios build ;;
      *) printf 'Unknown target "%s". Valid: web | linux | mac | ios\n' "{{target}}" >&2; exit 1 ;;
    esac

# ─── Deploy ──────────────────────────────────────────────────────────────────

[group('ci')]
[doc('Deploy dist/ to Cloudflare Pages (requires ENV=PROD in .env)')]
deploy-web: (build "web") (_require "PROD")
    bunx wrangler pages deploy dist/ --project-name z-obd

# ─── DropBox ─────────────────────────────────────────────────────────────────────

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
