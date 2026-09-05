#!/usr/bin/env python3
"""
One-time Dropbox OAuth2 setup.
Saves DROPBOX_REFRESH_TOKEN to .env

Usage:
    python scripts/dropbox_auth.py
"""

import os
import urllib.parse
import urllib.request
import json
import base64

ENV_FILE = ".env"


def load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip()
    return env


def save_refresh_token(token: str):
    lines = []
    found = False
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            lines = f.readlines()
        for i, line in enumerate(lines):
            if line.startswith("DROPBOX_REFRESH_TOKEN="):
                lines[i] = f"DROPBOX_REFRESH_TOKEN={token}\n"
                found = True
                break
    if not found:
        lines.append(f"DROPBOX_REFRESH_TOKEN={token}\n")
    with open(ENV_FILE, "w") as f:
        f.writelines(lines)


def main():
    env = load_env()
    app_key = env.get("DROPBOX_APP_KEY") or input("Enter DROPBOX_APP_KEY: ").strip()
    app_secret = env.get("DROPBOX_APP_SECRET") or input("Enter DROPBOX_APP_SECRET: ").strip()

    if env.get("DROPBOX_REFRESH_TOKEN"):
        print("Already authenticated (DROPBOX_REFRESH_TOKEN found in .env).")
        print("Run `just dropbox-auth --force` or delete DROPBOX_REFRESH_TOKEN from .env to re-auth.")
        return

    auth_url = (
        "https://www.dropbox.com/oauth2/authorize"
        f"?client_id={app_key}"
        "&response_type=code"
        "&token_access_type=offline"
    )
    print(f"\n1. Open this URL in your browser:\n\n   {auth_url}\n")
    print("2. Click 'Allow', then copy the authorization code shown.")
    code = input("\nPaste the authorization code here: ").strip()

    credentials = base64.b64encode(f"{app_key}:{app_secret}".encode()).decode()
    data = urllib.parse.urlencode({
        "code": code,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(
        "https://api.dropboxapi.com/oauth2/token",
        data=data,
        headers={"Authorization": f"Basic {credentials}"},
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())

    refresh_token = result.get("refresh_token")
    if not refresh_token:
        print(f"Error: {result}")
        raise SystemExit(1)

    save_refresh_token(refresh_token)
    print(f"\nSaved DROPBOX_REFRESH_TOKEN to {ENV_FILE}")
    print("You're all set — run `just pull` anytime.")


if __name__ == "__main__":
    main()
