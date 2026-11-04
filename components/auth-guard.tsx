'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useState } from 'react'
import { hasAnyRole, useAuth } from '@/lib/auth-context'

const roleLabels: Record<string, string> = {
  ADMIN: 'Admin',
  RFQ_MANAGER: 'RFQ Manager',
  REVIEWER: 'Reviewer',
  COST_EDITOR: 'Cost Editor',
  VIEWER: 'Viewer'
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, roles, loading, rolesLoading, error, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOut() {
    const message = await signOut()
    if (message) setSignOutError(`Unable to sign out: ${message}`)
  }

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [loading, user, router])

  if (loading || (user && rolesLoading)) {
    return <div className="p-12 text-center text-gray-500">Checking your sign-in and access…</div>
  }

  if (!user) return <div className="p-12 text-center text-gray-500">Redirecting to sign in…</div>

  if (error || roles.length === 0) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-bold text-gray-800">Access not available</h1>
        <p className="mt-2 text-sm text-gray-600">
          {error || 'Your account does not have an app role yet. Ask an administrator to grant access.'}
        </p>
        <button onClick={() => void handleSignOut()} className="mt-5 rounded bg-gray-800 px-4 py-2 text-sm text-white">
          Sign out
        </button>
        {signOutError && <p role="alert" className="mt-3 text-sm text-red-700">{signOutError}</p>}
      </main>
    )
  }

  const isAdmin = hasAnyRole(roles, ['ADMIN'])

  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <nav className="flex flex-wrap items-center gap-4 text-sm font-medium">
            <Link href="/" className="text-gray-800 hover:text-blue-700">Projects</Link>
            <Link href="/suppliers" className="text-gray-600 hover:text-blue-700">Suppliers</Link>
            <Link href="/history" className="text-gray-600 hover:text-blue-700">RFQ history</Link>
            {isAdmin && <Link href="/team" className="text-gray-600 hover:text-blue-700">Team access</Link>}
          </nav>
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span>{user.email} · {roles.map(role => roleLabels[role] || role).join(', ')}</span>
            <button onClick={() => void handleSignOut()} className="rounded border px-3 py-1.5 font-semibold hover:bg-gray-50">
              Sign out
            </button>
          </div>
        </div>
        {signOutError && <p role="alert" className="mx-auto max-w-7xl px-6 pb-2 text-xs text-red-700">{signOutError}</p>}
      </header>
      {children}
    </>
  )
}
