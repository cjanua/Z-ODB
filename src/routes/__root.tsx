import { useState, useEffect, useRef } from 'react'
import { createRootRoute, Outlet, Navigate, useLocation, useNavigate } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { SyncStatus } from '@/components/layout/sync-status'
import { isAuthenticated } from '@/lib/dropbox'
import { useDuckDB, useInvalidateDuckDB, useRebuild } from '@/hooks/use-duckdb'
import { useSync } from '@/hooks/use-sync'
import { isTauri } from '@/lib/platform'
import { getSelectedVin } from '@/lib/vin'
import { Button } from '@/components/ui/button'

function RootLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const onAuthRoute = pathname.startsWith('/auth')

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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { ready, error: dbError } = useDuckDB()
  const invalidate  = useInvalidateDuckDB()
  const rebuild     = useRebuild()
  const { progress, syncing, sync } = useSync(invalidate)

  const didAutoSync = useRef(false)
  useEffect(() => {
    if (ready && !didAutoSync.current && getSelectedVin()) {
      didAutoSync.current = true
      void sync()
    }
  }, [ready, sync])

  if (dbError) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="text-center max-w-md">
          <p className="text-red-400 font-medium">DuckDB failed to initialize</p>
          <p className="text-xs text-muted-foreground mt-2 break-all">{dbError}</p>
        </div>
      </div>
    )
  }

  async function handleRebuild() {
    await rebuild()
    void sync()
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center border-b px-4 py-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden mr-2"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <SyncStatus
            progress={progress}
            syncing={syncing}
            onSync={() => void sync()}
            onRebuild={() => void handleRebuild()}
          />
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
