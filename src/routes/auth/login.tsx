import { createFileRoute } from '@tanstack/react-router'
import { Car, CloudDownload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDropbox } from '@/hooks/use-dropbox'

function LoginPage() {
  const { login, loading, error } = useDropbox()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 max-w-sm w-full px-6">
        <div className="flex items-center gap-3">
          <Car className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Z OBD Dashboard</h1>
        </div>

        <p className="text-center text-muted-foreground text-sm">
          Connect your Dropbox to sync OBD Fusion CSVs and analyse your drives
          in-browser with DuckDB.
        </p>

        <Button
          size="lg"
          className="w-full gap-2"
          disabled={loading}
          onClick={() => void login()}
        >
          <CloudDownload className="h-5 w-5" />
          {loading ? 'Redirecting…' : 'Connect Dropbox'}
        </Button>

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Uses PKCE OAuth — no client secret stored. Tokens stay in your browser.
        </p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/auth/login')({
  component: LoginPage,
})
