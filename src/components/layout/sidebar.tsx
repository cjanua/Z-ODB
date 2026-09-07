import { Link, useNavigate } from '@tanstack/react-router'
import {
  Home, Route, Heart, Fuel, Thermometer,
  Zap, FlaskConical, User, ShieldCheck, LogOut, Car,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDropbox } from '@/hooks/use-dropbox'
import { Button } from '@/components/ui/button'

interface NavItem {
  to:    string
  label: string
  icon:  React.ComponentType<{ className?: string }>
}

const NAV: NavItem[] = [
  { to: '/dashboard',   label: 'Garage',       icon: Home         },
  { to: '/trips',       label: 'Trips',        icon: Route        },
  { to: '/engine',      label: 'Engine Health', icon: Heart        },
  { to: '/fuel',        label: 'Fuel & Economy',icon: Fuel         },
  { to: '/thermals',    label: 'Thermals',      icon: Thermometer  },
  { to: '/performance', label: 'Performance',   icon: Zap          },
  { to: '/modlab',      label: 'Mod Lab',       icon: FlaskConical },
  { to: '/driver',      label: 'Driver',        icon: User         },
  { to: '/quality',     label: 'Data Quality',  icon: ShieldCheck  },
]

export function Sidebar() {
  const { logout } = useDropbox()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    void navigate({ to: '/auth/login' })
  }

  return (
    <aside className="flex h-screen w-52 flex-col border-r bg-card shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <Car className="h-5 w-5 text-primary" />
        <span className="font-semibold tracking-tight">Z OBD</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 p-2 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}>
            {({ isActive }) => (
              <span
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
