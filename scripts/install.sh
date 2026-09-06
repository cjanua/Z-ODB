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

# Determinate Nix 3.x graduates flakes/nix-command out of experimental —
# they're always on and won't appear in `nix config show experimental-features`.
# Detect DS Nix by checking the build-hook path; skip enable_flakes if found.
if nix config show 2>/dev/null | grep -q "determinate-nix"; then
  info "Determinate Nix detected — flakes enabled by default, skipping user conf patch"
elif nix config show 2>/dev/null | grep -q "flakes"; then
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

# ─── 4. Install direnv + hook into shell rc ──────────────────────────────────

if ! command -v direnv &>/dev/null; then
  info "Installing direnv via nix profile…"
  nix profile install nixpkgs#direnv

  # Resolve the user's shell from $SHELL, falling back to /bin/sh
  user_shell="$(basename "${SHELL:-$(getent passwd "$USER" | cut -d: -f7 || echo /bin/sh)}")"

  case "${user_shell}" in
    zsh)  RC="${ZDOTDIR:-$HOME}/.zshrc"  ; HOOK='eval "$(direnv hook zsh)"'  ;;
    bash) RC="$HOME/.bashrc"             ; HOOK='eval "$(direnv hook bash)"' ;;
    fish) RC="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
          HOOK='direnv hook fish | source'                                    ;;
    *)    RC="$HOME/.profile"            ; HOOK='eval "$(direnv hook bash)"' ;;
  esac

  if grep -qF "direnv hook" "${RC}" 2>/dev/null; then
    info "direnv hook already present in ${RC}"
  else
    printf '\n# direnv — auto-load nix flake dev shells\n%s\n' "${HOOK}" >> "${RC}"
    info "Added direnv hook to ${RC}"
    warn "Run: source ${RC}  (or open a new terminal) to activate the hook"
  fi

  # Reload direnv into the current session so the rest of the script can use it
  eval "$(direnv hook bash)" 2>/dev/null || true
else
  info "direnv already installed: $(direnv version)"
fi

# ─── 5. Init flake shell via direnv ──────────────────────────────────────────

if [ ! -f .envrc ]; then
  echo 'use flake' > .envrc
  info "Created .envrc"
fi

direnv allow
info "direnv allow — flake dev shell will activate on cd"

# ─── 6. Install dependencies inside the flake shell ─────────────────────────

info "Installing JS + Rust dependencies inside the flake shell…"
direnv exec . bash -c 'bun install && cd src-tauri && cargo fetch'

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLD}Install complete.${RST}"
echo ""
echo "  Next steps:"
echo "    cd .                 # re-enter the directory — direnv loads the flake shell automatically"
echo "    cp .env.example .env # fill in VITE_DROPBOX_APP_KEY"
echo "    just dev-web         # start Vite dev server"
echo ""
