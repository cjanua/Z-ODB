import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useDropbox } from '@/hooks/use-dropbox'

function CallbackPage() {
  const navigate = useNavigate()
  const { handleCode, error } = useDropbox()

  useEffect(() => {
    // Parse ?code= from the URL (web) or z://auth/callback?code= (Tauri deep link)
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')

    if (!code) {
      void navigate({ to: '/auth/login' })
      return
    }

    handleCode(code).then(() => {
      void navigate({ to: '/dashboard' })
    }).catch(() => {
      // error is set by hook
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 font-medium">Authentication failed</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
          <a href="/auth/login" className="text-sm underline mt-4 block">Try again</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Completing sign-in…</span>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/auth/callback')({
  component: CallbackPage,
})
