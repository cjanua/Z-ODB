import { createFileRoute, Navigate } from '@tanstack/react-router'
import { isAuthenticated } from '@/lib/dropbox'

function IndexPage() {
  if (!isAuthenticated()) {
    return <Navigate to="/auth/login" />
  }
  return <Navigate to="/dashboard" />
}

export const Route = createFileRoute('/')({
  component: IndexPage,
})
