'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
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

  async function handleRequestReset(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const redirectTo = `${window.location.origin}/login?mode=recovery`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    setBusy(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setNotice('If an account exists for that email, Supabase will send a reset link. Open it in this browser to choose a new password.')
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
            ? 'Your reset link signed you in. Create a new password below to finish.'
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
        ) : passwordRecovery ? (
          <div className="mt-6 rounded bg-amber-50 p-4 text-sm text-amber-900">
            This reset link is invalid or has expired. Request another reset link below.
            <form onSubmit={handleRequestReset} className="mt-4 space-y-3">
              <label className="block text-sm font-medium">
                Email
                <input type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded border p-2.5" />
              </label>
              <button disabled={busy} className="w-full rounded bg-blue-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60">
                {busy ? 'Sending…' : 'Send another reset link'}
              </button>
            </form>
          </div>
        ) : (
          <>
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
            <form onSubmit={handleRequestReset} className="mt-4 text-center">
              <button type="submit" disabled={busy || !email.includes('@')} className="text-sm font-medium text-blue-700 underline disabled:text-gray-400">
                Forgot or need to set your password?
              </button>
            </form>
          </>
        )}

        {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <p className="mt-5 text-xs text-gray-500">Accounts are invite-only. Contact an administrator if you need access.</p>
      </section>
    </main>
  )
}
