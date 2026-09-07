/** True when running inside a Tauri shell (desktop or mobile). */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** True when running on iOS inside Tauri. */
export const isIOS = (): boolean =>
  isTauri() && /iPhone|iPad|iPod/.test(navigator.userAgent)

/** True when running as a plain web app (no Tauri). */
export const isWeb = (): boolean => !isTauri()

/**
 * Returns the OAuth redirect URI appropriate for the current platform.
 *   - Tauri (desktop/iOS): z://auth/callback  (deep link)
 *   - Web:                  <origin>/auth/callback
 */
export function getRedirectUri(): string {
  if (isTauri()) return 'z://auth/callback'
  // BASE_URL is set by Vite from the `base` config (e.g. '/Z-ODB/' on GH Pages)
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${window.location.origin}${base}/auth/callback`
}
