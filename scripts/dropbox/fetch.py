#!/usr/bin/env python3
"""
Fetch the latest file(s) from a Dropbox folder, sorted by most recent.

Usage:
    python scripts/dropbox_fetch.py [--folder /path] [--dest ./output] [--limit 1|all]
"""

import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import dropbox
from dropbox.exceptions import AuthError, ApiError

load_dotenv()


def get_client() -> dropbox.Dropbox:
    app_key = os.environ["DROPBOX_APP_KEY"]
    app_secret = os.environ["DROPBOX_APP_SECRET"]
    refresh_token = os.environ["DROPBOX_REFRESH_TOKEN"]
    dbx = dropbox.Dropbox(
        app_key=app_key,
        app_secret=app_secret,
        oauth2_refresh_token=refresh_token,
    )
    dbx.check_and_refresh_access_token()
    return dbx


def list_files(dbx: dropbox.Dropbox, folder: str):
    try:
        result = dbx.files_list_folder(folder)
    except ApiError as e:
        print(f"Error listing folder '{folder}': {e}")
        sys.exit(1)

    entries = [e for e in result.entries if isinstance(e, dropbox.files.FileMetadata)]
    while result.has_more:
        result = dbx.files_list_folder_continue(result.cursor)
        entries += [e for e in result.entries if isinstance(e, dropbox.files.FileMetadata)]

    return sorted(entries, key=lambda e: e.server_modified, reverse=True)


def download(dbx: dropbox.Dropbox, dropbox_path: str, dest_dir: Path):
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(dropbox_path).name
    dest_path = dest_dir / filename
    print(f"  Downloading: {dropbox_path} → {dest_path}")
    _, response = dbx.files_download(dropbox_path)
    dest_path.write_bytes(response.content)
    print(f"  Saved ({len(response.content) / 1024:.1f} KB)")


def main():
    parser = argparse.ArgumentParser(description="Fetch latest Dropbox file(s)")
    parser.add_argument("--folder", default="", help="Dropbox folder path (default: root)")
    parser.add_argument("--dest", default=".", help="Local destination directory")
    parser.add_argument("--limit", default="1", help="Number of latest files to fetch, or 'all' (default: 1)")
    args = parser.parse_args()

    if args.limit == "all":
        limit = None
    else:
        try:
            limit = int(args.limit)
        except ValueError:
            print(f"Invalid --limit value: {args.limit!r}. Use a number or 'all'.")
            sys.exit(1)

    try:
        dbx = get_client()
        dbx.users_get_current_account()  # validate credentials
    except AuthError as e:
        print(f"Auth failed: {e}")
        print("Run `just dropbox-auth` to re-authenticate.")
        sys.exit(1)

    folder = args.folder.rstrip("/")
    dest = Path(args.dest)

    print(f"Listing files in Dropbox:{folder or '/'} ...")
    files = list_files(dbx, folder)

    if not files:
        print("No files found.")
        sys.exit(0)

    targets = files if limit is None else files[:limit]
    print(f"Found {len(files)} file(s). Fetching {len(targets)}:\n")
    for f in targets:
        download(dbx, f.path_display, dest)

    print("\nDone.")


if __name__ == "__main__":
    main()
