import { getRedirectUri, isTauri } from './platform'

const CLIENT_ID = import.meta.env['VITE_DROPBOX_APP_KEY'] as string

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const AUTH_URL  = 'https://www.dropbox.com/oauth2/authorize'
const API_URL   = 'https://api.dropboxapi.com/2'
const CONTENT_URL = 'https://content.dropboxapi.com/2'

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generateVerifier(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier)
  const digest  = await crypto.subtle.digest('SHA-256', encoded)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ─── Auth flow ───────────────────────────────────────────────────────────────

export async function startOAuthFlow(): Promise<void> {
  const verifier   = generateVerifier()
  const challenge  = await generateChallenge(verifier)
  const redirectUri = getRedirectUri()

  sessionStorage.setItem('pkce_verifier',    verifier)
  sessionStorage.setItem('pkce_redirect_uri', redirectUri)

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          redirectUri,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    token_access_type:     'offline',
  })

  const url = `${AUTH_URL}?${params}`

  if (isTauri()) {
    // Open in the system browser; deep link z://auth/callback will bring us back
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } else {
    window.location.href = url
  }
}

export interface TokenResponse {
  access_token:  string
  refresh_token: string
  expires_in:    number
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const verifier   = sessionStorage.getItem('pkce_verifier') ?? ''
  const redirectUri = sessionStorage.getItem('pkce_redirect_uri') ?? getRedirectUri()

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     CLIENT_ID,
      code_verifier: verifier,
    }),
  })

  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  return res.json() as Promise<TokenResponse>
}

// ─── Stored tokens ───────────────────────────────────────────────────────────

const KEYS = {
  access:  'dbx_access_token',
  refresh: 'dbx_refresh_token',
  expiry:  'dbx_token_expiry',
}

/** Cursors are per-folder: a cursor from one VIN's folder is meaningless in another. */
const CURSOR_PREFIX = 'dbx_list_cursor'

function cursorKey(folder: string): string {
  return `${CURSOR_PREFIX}:${folder.toLowerCase()}`
}

export function getStoredCursor(folder: string): string | null {
  return localStorage.getItem(cursorKey(folder))
}

/**
 * Persist a listing cursor. Only call this once the listed entries have actually
 * been ingested — a cursor advanced past un-ingested files hides them forever,
 * since list_folder/continue only ever returns changes made after it.
 */
export function commitCursor(folder: string, cursor: string): void {
  localStorage.setItem(cursorKey(folder), cursor)
}

export function clearAllCursors(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k === CURSOR_PREFIX || k?.startsWith(`${CURSOR_PREFIX}:`)) localStorage.removeItem(k)
  }
}

export function saveTokens(t: TokenResponse): void {
  localStorage.setItem(KEYS.access,  t.access_token)
  localStorage.setItem(KEYS.refresh, t.refresh_token)
  localStorage.setItem(KEYS.expiry,  String(Date.now() + t.expires_in * 1000))
}

export function getAccessToken(): string | null {
  return localStorage.getItem(KEYS.access)
}

export function isAuthenticated(): boolean {
  // Has refresh token → can always get a new access token
  if (localStorage.getItem(KEYS.refresh)) return true
  const token  = localStorage.getItem(KEYS.access)
  const expiry = localStorage.getItem(KEYS.expiry)
  if (!token || !expiry) return false
  return Date.now() < parseInt(expiry) - 60_000
}

let _refreshPromise: Promise<void> | null = null

async function refreshAccessToken(): Promise<void> {
  // Coalesce concurrent refresh calls — only one in-flight at a time
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = (async () => {
    const refreshToken = localStorage.getItem(KEYS.refresh)
    if (!refreshToken) throw new Error('No refresh token stored')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     CLIENT_ID,
      }),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
    saveTokens(await res.json() as TokenResponse)
  })().finally(() => { _refreshPromise = null })
  return _refreshPromise
}

export function clearTokens(): void {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k))
  clearAllCursors()
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(endpoint: string, body: unknown): Promise<Response> {
  const token = getAccessToken()
  return fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/**
 * Send a request with a valid access token: refresh proactively when the stored
 * one has expired, and retry once on 401. `send` is a thunk so the retry reads
 * the freshly stored token rather than a captured stale one.
 */
async function authedFetch(send: () => Promise<Response>): Promise<Response> {
  const expiry = localStorage.getItem(KEYS.expiry)
  if (expiry && Date.now() >= parseInt(expiry) - 60_000) {
    await refreshAccessToken()
  }

  const res = await send()
  if (res.status !== 401) return res

  // Token may have been invalidated server-side — refresh and try once more
  await refreshAccessToken()
  return send()
}

async function rpc<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await authedFetch(() => apiFetch(endpoint, body))
  if (!res.ok) throw new Error(`Dropbox API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

// ─── Folder listing with cursor (incremental sync) ───────────────────────────

export interface DropboxEntry {
  '.tag':  'file' | 'folder' | 'deleted'
  name:    string
  path_lower: string
  id?:     string
}

interface ListFolderResult {
  entries: DropboxEntry[]
  cursor:  string
  has_more: boolean
}

export interface ListResult {
  entries: DropboxEntry[]
  cursor:  string
  /** true when this was a full folder listing rather than a delta from a stored cursor */
  full:    boolean
}

/**
 * List a folder: a delta from the stored cursor when there is one, otherwise the
 * full folder. The returned cursor is NOT persisted — the caller commits it with
 * `commitCursor` once the entries have been ingested.
 */
export async function listNewEntries(
  folder: string,
  opts: { full?: boolean } = {},
): Promise<ListResult> {
  const storedCursor = opts.full ? null : getStoredCursor(folder)
  let result: ListFolderResult
  let full = true

  const listFull = () => rpc<ListFolderResult>('/files/list_folder', {
    path: folder,
    recursive: false,
  })

  if (storedCursor) {
    try {
      result = await rpc<ListFolderResult>('/files/list_folder/continue', {
        cursor: storedCursor,
      })
      full = false
    } catch (err) {
      // Stale or rejected cursor (folder moved, reset_cursor, expired). Fall back
      // to a full listing instead of silently reporting "nothing new".
      console.warn('[dropbox] stored cursor rejected, re-listing folder:', err)
      result = await listFull()
    }
  } else {
    result = await listFull()
  }

  // Drain pagination
  while (result.has_more) {
    const next = await rpc<ListFolderResult>('/files/list_folder/continue', {
      cursor: result.cursor,
    })
    result.entries = [...result.entries, ...next.entries]
    result.cursor  = next.cursor
    result.has_more = next.has_more
  }

  return { entries: result.entries, cursor: result.cursor, full }
}

// ─── Folder listing (for VIN discovery) ─────────────────────────────────────

export async function listSubfolders(path: string): Promise<string[]> {
  const result = await rpc<{ entries: DropboxEntry[] }>('/files/list_folder', {
    path,
    recursive: false,
  })
  return result.entries
    .filter(e => e['.tag'] === 'folder')
    .map(e => e.name)
}

// ─── Space usage ────────────────────────────────────────────────────────────

export interface SpaceUsage {
  used:       number
  allocated:  number
}

export async function getSpaceUsage(): Promise<SpaceUsage> {
  const data = await rpc<{
    used: number
    allocation: { '.tag': string; allocated?: number; individual?: { allocated: number } }
  }>('/users/get_space_usage', null)
  const alloc = data.allocation
  const allocated = alloc.allocated ?? alloc.individual?.allocated ?? 0
  return { used: data.used, allocated }
}

/** Download a single file as text. */
export async function downloadFile(path: string): Promise<string> {
  const res = await authedFetch(() => fetch(`${CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${getAccessToken()}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  }))
  if (!res.ok) throw new Error(`Download failed for ${path}: ${await res.text()}`)
  return res.text()
}
