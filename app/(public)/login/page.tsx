'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useFormDraftState } from '@/lib/form-drafts'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading, signIn } = useAuth()
  const [username, setUsername] = useFormDraftState('anonymous', 'login:username', '')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [showPasswordForm, setShowPasswordForm] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href)
      if (
        url.searchParams.get('mode') === 'recovery'
        || url.searchParams.get('type') === 'recovery'
        || new URLSearchParams(url.hash.slice(1)).get('type') === 'recovery'
      ) {
        setPasswordRecovery(true)
        setShowPasswordForm(true)
      }
    }, 0)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        setShowPasswordForm(true)
        setNotice('Choose a new password to finish resetting your account.')
      }
    })
    return () => {
      window.clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [])

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const signInError = await signIn(username, password)
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

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-gray-500">Checking your sign-in…</main>
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <section className="w-full max-w-md rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-800">M Phase RFQ Builder</h1>
        <p className="mt-2 text-sm text-gray-600">
          {passwordRecovery
            ? 'You are signed in through a password reset link. Create a new password below to finish.'
            : user
              ? 'You are signed in. Continue to the app or set a password for future sign-ins.'
              : 'Sign in with your team account.'}
        </p>

        {user && (passwordRecovery || showPasswordForm) ? (
          <form onSubmit={handleSetPassword} className="mt-6 space-y-4">
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
            <button disabled={busy} className="w-full rounded bg-blue-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60">
              {busy ? 'Saving…' : 'Save new password'}
            </button>
            {!passwordRecovery && (
              <button type="button" onClick={() => setShowPasswordForm(false)} className="w-full rounded border px-4 py-2.5 text-sm font-semibold text-gray-700">
                Cancel
              </button>
            )}
          </form>
        ) : user ? (
          <div className="mt-6 space-y-3">
            <button onClick={() => router.replace('/')} className="w-full rounded bg-blue-600 px-4 py-2.5 font-semibold text-white">
              Continue to app
            </button>
            <button onClick={() => setShowPasswordForm(true)} className="w-full rounded border px-4 py-2.5 font-semibold text-gray-700">
              Set or change password
            </button>
          </div>
        ) : (
          <form onSubmit={handleSignIn} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              Username
              <input
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={event => setUsername(event.target.value)}
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
        {notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <p className="mt-5 text-xs text-gray-500">Your administrator will provide your username and password and can reset your password if needed.</p>
      </section>
    </main>
  )
}
