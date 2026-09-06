#!/usr/bin/env bash
# scripts/env.sh — single source of truth for valid environments.
# Source this file to get ENVS and a validated ENV.
#
# Usage (source):  source scripts/env.sh [required]
# Usage (exec):    bash scripts/env.sh [required]
#
# Arguments:
#   [required]  optional — if given, also asserts ENV == required
#
# On success: exits 0, ENVS and ENV are set in the caller's scope (when sourced).
# On failure: prints an error to stderr and exits 1.

declare -r -a ENVS=("DEV" "RUNNER" "PROD")

# ── Validate ENV ∈ ENVS ───────────────────────────────────────────────────────

_env_valid() {
    local current="${ENV:-}"
    if [[ -z "${current}" ]]; then
        printf '\033[31mERROR\033[0m ENV is not set. Add ENV=<value> to .env\n' >&2
        printf '      Valid values: %s\n' "${ENVS[*]}" >&2
        return 1
    fi
    for e in "${ENVS[@]}"; do
        [[ "${e}" == "${current}" ]] && return 0
    done
    printf '\033[31mERROR\033[0m ENV="%s" is not valid.\n' "${current}" >&2
    printf '      Valid values: %s\n' "${ENVS[*]}" >&2
    return 1
}

# ── Optionally assert ENV == required ─────────────────────────────────────────

_env_require() {
    local required="${1:-}"
    [[ -z "${required}" ]] && return 0
    [[ "${ENV}" == "${required}" ]] && return 0
    printf '\033[31mERROR\033[0m Requires ENV=%s  (current: ENV=%s)\n' \
        "${required}" "${ENV:-<unset>}" >&2
    return 1
}

_env_valid    || exit 1
_env_require "${1:-}" || exit 1
