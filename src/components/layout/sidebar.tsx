import { Link } from '@tanstack/react-router'
import { LayoutDashboard, Route, Activity, LogOut, Car } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDropbox } from '@/hooks/use-dropbox'
import { Button } from '@/components/ui/button'

interface NavItem {
  to:    string
  label: string
  icon:  React.ComponentType<{ className?: string }>
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/trips',     label: 'Trips',      icon: Route },
  { to: '/live',      label: 'Live',       icon: Activity },
]

export function Sidebar() {
  const { logout } = useDropbox()

  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b">
        <Car className="h-5 w-5 text-primary" />
        <span className="font-semibold tracking-tight">Z OBD</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}>
            {({ isActive }) => (
              <span
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={logout}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
