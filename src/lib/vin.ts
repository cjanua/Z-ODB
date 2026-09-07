const BASE_FOLDER = import.meta.env['VITE_DROPBOX_FOLDER'] as string || '/Apps/OBD Fusion/CsvLogs'
const STORAGE_KEY = 'z_selected_vin'

export function getSelectedVin(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setSelectedVin(vin: string): void {
  const prev = localStorage.getItem(STORAGE_KEY)
  localStorage.setItem(STORAGE_KEY, vin)
  if (prev !== vin) {
    localStorage.removeItem('dbx_list_cursor')
  }
}

export function getBaseFolder(): string {
  return BASE_FOLDER
}

export function getDropboxFolder(): string {
  const vin = getSelectedVin()
  if (!vin) return BASE_FOLDER
  return `${BASE_FOLDER.replace(/\/$/, '')}/${vin}`
}
