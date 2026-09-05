import { useState, useCallback } from 'react'
import { startOAuthFlow, exchangeCode, saveTokens, isAuthenticated, clearTokens } from '@/lib/dropbox'

export interface UseDropbox {
  authed:       boolean
  loading:      boolean
  error:        string | null
  login:        () => Promise<void>
  logout:       () => void
  handleCode:   (code: string) => Promise<void>
}

export function useDropbox(): UseDropbox {
  const [authed,  setAuthed]  = useState(isAuthenticated)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const login = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await startOAuthFlow()
    } catch (e) {
      setError(String(e))
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    clearTokens()
    setAuthed(false)
  }, [])

  const handleCode = useCallback(async (code: string) => {
    setLoading(true)
    setError(null)
    try {
      const tokens = await exchangeCode(code)
      saveTokens(tokens)
      setAuthed(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { authed, loading, error, login, logout, handleCode }
}
