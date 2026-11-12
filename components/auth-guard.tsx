'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useState } from 'react'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { useFormDraftStorageError } from '@/lib/form-drafts'

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
  const draftStorageError = useFormDraftStorageError()

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
  const displayName = typeof user.user_metadata?.username === 'string'
    ? user.user_metadata.username
    : user.email

  return (
    <>
      <header className="border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <nav className="flex flex-wrap items-center gap-4 text-sm font-medium">
            <Link href="/" className="rounded-md text-slate-900 transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-100 dark:hover:text-blue-300">Projects</Link>
            <Link href="/suppliers" className="rounded-md text-slate-600 transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-400 dark:hover:text-blue-300">Suppliers</Link>
            <Link href="/history" className="rounded-md text-slate-600 transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-400 dark:hover:text-blue-300">RFQ history</Link>
            {isAdmin && <Link href="/team" className="rounded-md text-slate-600 transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-400 dark:hover:text-blue-300">Team access</Link>}
          </nav>
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
            <span>{displayName} · {roles.map(role => roleLabels[role] || role).join(', ')}</span>
            <button onClick={() => void handleSignOut()} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold transition-colors hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:hover:bg-slate-800">
              Sign out
            </button>
          </div>
        </div>
        {signOutError && <p role="alert" className="mx-auto max-w-7xl px-6 pb-2 text-xs text-red-700">{signOutError}</p>}
      </header>
      {draftStorageError && <p role="alert" className="mx-auto max-w-7xl px-6 pb-2 text-xs text-red-700">{draftStorageError}</p>}
      {children}
    </>
  )
}
