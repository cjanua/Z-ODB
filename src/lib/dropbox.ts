import { getRedirectUri } from './platform'

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

  window.location.href = `${AUTH_URL}?${params}`
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
  cursor:  'dbx_list_cursor',
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
  const token  = localStorage.getItem(KEYS.access)
  const expiry = localStorage.getItem(KEYS.expiry)
  if (!token || !expiry) return false
  return Date.now() < parseInt(expiry) - 60_000
}

export function clearTokens(): void {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k))
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function rpc<T>(endpoint: string, body: unknown): Promise<T> {
  const token = getAccessToken()
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
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

/** Initial list or resume from stored cursor. */
export async function listNewEntries(folder: string): Promise<{
  entries: DropboxEntry[]
  cursor:  string
}> {
  const storedCursor = localStorage.getItem(KEYS.cursor)
  let result: ListFolderResult

  if (storedCursor) {
    result = await rpc<ListFolderResult>('/files/list_folder/continue', {
      cursor: storedCursor,
    })
  } else {
    result = await rpc<ListFolderResult>('/files/list_folder', {
      path: folder,
      recursive: false,
    })
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

  localStorage.setItem(KEYS.cursor, result.cursor)
  return { entries: result.entries, cursor: result.cursor }
}

/** Download a single file as text. */
export async function downloadFile(path: string): Promise<string> {
  const token = getAccessToken()
  const res = await fetch(`${CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  })
  if (!res.ok) throw new Error(`Download failed for ${path}: ${await res.text()}`)
  return res.text()
}
