#!/usr/bin/env bash
# bootstrap.sh — Install Nix (with flakes) and drop into the dev shell
# Usage: bash scripts/bootstrap.sh
set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLD='\033[1m'; RST='\033[0m'

info()  { echo -e "${GRN}[bootstrap]${RST} $*"; }
warn()  { echo -e "${YLW}[bootstrap]${RST} $*"; }
fatal() { echo -e "${RED}[bootstrap] ERROR:${RST} $*" >&2; exit 1; }

# ─── 1. Install Nix if missing ────────────────────────────────────────────────

if command -v nix &>/dev/null; then
  info "Nix already installed: $(nix --version)"
else
  info "Installing Nix via Determinate Systems installer…"
  info "(This is the recommended installer — enables flakes by default, supports uninstall)"

  curl --proto '=https' --tlsv1.2 -sSf \
    https://install.determinate.systems/nix | sh -s -- install --no-confirm

  # Source Nix into current shell session
  if [ -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
    # shellcheck source=/dev/null
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  elif [ -e "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.nix-profile/etc/profile.d/nix.sh"
  fi

  info "Nix installed: $(nix --version)"
fi

# ─── 2. Ensure flakes + nix-command are enabled ───────────────────────────────

NIX_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/nix/nix.conf"

enable_flakes() {
  mkdir -p "$(dirname "$NIX_CONF")"
  if grep -q "experimental-features" "$NIX_CONF" 2>/dev/null; then
    # Already has the key — check if both features are present
    if grep -q "nix-command" "$NIX_CONF" && grep -q "flakes" "$NIX_CONF"; then
      info "Flakes already enabled in $NIX_CONF"
      return
    fi
    # Patch existing line
    sed -i.bak 's/^experimental-features.*/experimental-features = nix-command flakes/' "$NIX_CONF"
    warn "Updated experimental-features in $NIX_CONF (backup: ${NIX_CONF}.bak)"
  else
    echo "experimental-features = nix-command flakes" >> "$NIX_CONF"
    info "Wrote experimental-features to $NIX_CONF"
  fi
}

# Determinate Systems installer enables flakes globally (/etc/nix/nix.conf).
# For standard Nix installs we write to the user conf.
if nix show-config 2>/dev/null | grep -q "flakes"; then
  info "Flakes already active (system or user config)"
else
  warn "Flakes not detected — enabling in $NIX_CONF"
  enable_flakes
fi

# ─── 3. Sanity-check the flake ────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

info "Checking flake.nix…"
nix flake check --no-build 2>/dev/null \
  || warn "nix flake check reported warnings (non-fatal)"

# ─── 4. Optional: install direnv for automatic shell activation ───────────────

if ! command -v direnv &>/dev/null; then
  echo ""
  warn "direnv not found. You can install it for automatic 'nix develop' on cd:"
  warn "  nix profile install nixpkgs#direnv"
  warn "Then add to your shell rc:  eval \"\$(direnv hook bash)\""
  warn "And run: echo 'use flake' > .envrc && direnv allow"
  echo ""
else
  if [ ! -f .envrc ]; then
    echo 'use flake' > .envrc
    direnv allow
    info "Created .envrc and ran 'direnv allow'"
  fi
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLD}Bootstrap complete.${RST}"
echo ""
echo "  Next steps:"
echo "    nix develop          # enter the dev shell (bun, rust, just, docker…)"
echo "    bun install          # install JS deps"
echo "    cp .env.example .env # fill in VITE_DROPBOX_APP_KEY"
echo "    just dev-web         # start Vite dev server"
echo ""
