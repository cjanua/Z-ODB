import { useEffect, useRef } from 'react'
import { createRootRoute, Outlet, Navigate, useLocation, useNavigate } from '@tanstack/react-router'
import { Sidebar } from '@/components/layout/sidebar'
import { SyncStatus } from '@/components/layout/sync-status'
import { isAuthenticated } from '@/lib/dropbox'
import { useDuckDB, useInvalidateDuckDB, useRebuild } from '@/hooks/use-duckdb'
import { useSync } from '@/hooks/use-sync'
import { isTauri } from '@/lib/platform'

function RootLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const onAuthRoute = pathname.startsWith('/auth')

  // Tauri: listen for z://auth/callback deep link
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('z-auth-callback', event => {
        const url = new URL(event.payload)
        const code = url.searchParams.get('code')
        if (code) void navigate({ to: '/auth/callback', search: { code } })
      }).then(fn => { unlisten = fn })
    })
    return () => unlisten?.()
  }, [navigate])

  if (onAuthRoute) return <Outlet />
  if (!isAuthenticated()) return <Navigate to="/auth/login" />

  return <AuthenticatedShell />
}

function AuthenticatedShell() {
  const { ready }   = useDuckDB()
  const invalidate  = useInvalidateDuckDB()
  const rebuild     = useRebuild()
  const { progress, syncing, sync } = useSync(invalidate)

  // Auto-sync once after DuckDB is ready
  const didAutoSync = useRef(false)
  useEffect(() => {
    if (ready && !didAutoSync.current) {
      didAutoSync.current = true
      void sync()
    }
  }, [ready, sync])

  async function handleRebuild() {
    await rebuild()
    void sync()
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-end border-b px-4 py-2 shrink-0">
          <SyncStatus
            progress={progress}
            syncing={syncing}
            onSync={() => void sync()}
            onRebuild={() => void handleRebuild()}
          />
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
