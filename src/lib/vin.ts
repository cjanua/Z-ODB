import { clearAllCursors, getResolvedBase } from './dropbox'

/**
 * Dropbox rejects a path with a trailing slash (path/malformed_path), and the
 * configured value routinely has one. Root is `''`, which is how the API
 * spells it.
 */
function normalizePath(p: string): string {
  const trimmed = p.trim().replace(/\/+$/, '')
  return trimmed === '/' ? '' : trimmed
}

const CONFIGURED_BASE = normalizePath(
  (import.meta.env['VITE_DROPBOX_FOLDER'] as string) || '/Apps/OBD Fusion/CsvLogs',
)
const STORAGE_KEY = 'z_selected_vin'

export function getSelectedVin(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setSelectedVin(vin: string): void {
  const prev = localStorage.getItem(STORAGE_KEY)
  localStorage.setItem(STORAGE_KEY, vin)
  if (prev !== vin) {
    clearAllCursors()
  }
}

/** The configured base folder, as set by VITE_DROPBOX_FOLDER. */
export function getConfiguredBaseFolder(): string {
  return CONFIGURED_BASE
}

/**
 * The base folder to address over the API — the configured one, unless folder
 * listing found the app to be app-folder scoped and resolved a different path.
 */
export function getBaseFolder(): string {
  const resolved = getResolvedBase()
  return resolved === null ? CONFIGURED_BASE : normalizePath(resolved)
}

export function getDropboxFolder(): string {
  const base = getBaseFolder()
  const vin  = getSelectedVin()
  if (!vin) return base
  return `${base}/${vin}`
}
