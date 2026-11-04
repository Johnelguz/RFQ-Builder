'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

export default function LoginPage() {
  const router = useRouter()
  const { user, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const signInError = await signIn(email.trim(), password)
    setBusy(false)
    if (signInError) {
      setError(signInError)
      return
    }
    router.replace('/')
  }

  async function handleSetPassword(event: React.FormEvent) {
    event.preventDefault()
    if (newPassword.length < 8) {
      setError('Use a password with at least 8 characters.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    router.replace('/')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <section className="w-full max-w-md rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-800">M Phase RFQ Builder</h1>
        <p className="mt-2 text-sm text-gray-600">
          {user ? 'You are signed in. Set a password if you are accepting an invitation, or continue to the app.' : 'Sign in with your team account.'}
        </p>

        {user ? (
          <div className="mt-6 space-y-4">
            <button onClick={() => router.replace('/')} className="w-full rounded bg-blue-600 px-4 py-2.5 font-semibold text-white">
              Continue to app
            </button>
            <form onSubmit={handleSetPassword} className="space-y-4 border-t pt-4">
              <label className="block text-sm font-medium text-gray-700">
                New password
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                  className="mt-1 w-full rounded border p-2.5"
                />
              </label>
              <button disabled={busy} className="w-full rounded border px-4 py-2.5 font-semibold text-gray-700 disabled:opacity-60">
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={handleSignIn} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              Email
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={event => setEmail(event.target.value)}
                className="mt-1 w-full rounded border p-2.5"
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className="mt-1 w-full rounded border p-2.5"
              />
            </label>
            <button disabled={busy} className="w-full rounded bg-blue-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <p className="mt-5 text-xs text-gray-500">Accounts are invite-only. Contact an administrator if you need access.</p>
      </section>
    </main>
  )
}
