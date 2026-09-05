import { createRootRoute, Outlet, Navigate } from '@tanstack/react-router'
import { Sidebar } from '@/components/layout/sidebar'
import { SyncStatus } from '@/components/layout/sync-status'
import { isAuthenticated } from '@/lib/dropbox'
import { useManifest } from '@/hooks/use-duckdb'

function RootLayout() {
  // If not authenticated, redirect to auth flow
  if (!isAuthenticated()) {
    return <Navigate to="/auth/login" />
  }

  return <AuthenticatedShell />
}

function AuthenticatedShell() {
  const { refresh } = useManifest()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-end border-b px-4 py-2 shrink-0">
          <SyncStatus onSynced={refresh} />
        </header>
        {/* Main content */}
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
