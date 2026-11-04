'use client'

import { useCallback, useEffect, useState } from 'react'
import { APP_ROLES, type AppRole, hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

interface TeamUser {
  id: string
  email: string
  roles: AppRole[]
  invitedAt: string | null
  lastSignInAt: string | null
}

const roleLabels: Record<AppRole, string> = {
  ADMIN: 'Admin',
  RFQ_MANAGER: 'RFQ Manager',
  REVIEWER: 'Reviewer',
  COST_EDITOR: 'Cost Editor',
  VIEWER: 'Viewer'
}

export default function TeamPage() {
  const { roles } = useAuth()
  const isAdmin = hasAnyRole(roles, ['ADMIN'])
  const [users, setUsers] = useState<TeamUser[]>([])
  const [pendingRoles, setPendingRoles] = useState<Record<string, AppRole[]>>({})
  const [email, setEmail] = useState('')
  const [inviteRoles, setInviteRoles] = useState<AppRole[]>(['VIEWER'])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const adminRequest = useCallback(async (method: 'GET' | 'POST' | 'PUT', body?: object) => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw new Error(`Unable to verify your sign-in: ${sessionError.message}`)
    if (!session?.access_token) throw new Error('Your session expired. Sign in again.')

    const response = await fetch('/api/admin/users', {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const result = await response.json() as { error?: string; users?: TeamUser[]; truncated?: boolean }
    if (!response.ok) throw new Error(result.error || 'The user management request failed.')
    return result
  }, [])

  const loadUsers = useCallback(async () => {
    setError(null)
    try {
      const result = await adminRequest('GET')
      const teamUsers = result.users || []
      setUsers(teamUsers)
      setPendingRoles(Object.fromEntries(teamUsers.map(user => [user.id, user.roles])))
      setTruncated(Boolean(result.truncated))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load team users.')
    } finally {
      setLoading(false)
    }
  }, [adminRequest])

  useEffect(() => {
    if (!isAdmin) return
    const timer = window.setTimeout(() => void loadUsers(), 0)
    return () => window.clearTimeout(timer)
  }, [isAdmin, loadUsers])

  function toggleRole(current: AppRole[], role: AppRole) {
    return current.includes(role) ? current.filter(item => item !== role) : [...current, role]
  }

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await adminRequest('POST', { email: email.trim(), roles: inviteRoles })
      setEmail('')
      setNotice(`Invitation sent to ${email.trim()}.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send invitation.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveRoles(user: TeamUser) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await adminRequest('PUT', { userId: user.id, roles: pendingRoles[user.id] || [] })
      setNotice(`Updated access for ${user.email}.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save role changes.')
    } finally {
      setBusy(false)
    }
  }

  function handleRefreshUsers() {
    setLoading(true)
    void loadUsers()
  }

  if (!isAdmin) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-gray-600">Administrator access is required to manage team accounts.</main>
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold text-gray-800">Team access</h1>
      <p className="mt-1 text-sm text-gray-600">Invite teammates and assign one or more roles.</p>

      <section className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="text-sm font-bold uppercase text-gray-600">Invite a teammate</h2>
        <form onSubmit={handleInvite} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="mt-1 w-full max-w-md rounded border p-2.5"
              placeholder="teammate@company.com"
            />
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-gray-700">Roles</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {APP_ROLES.map(role => (
                <label key={role} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={inviteRoles.includes(role)}
                    onChange={() => setInviteRoles(current => toggleRole(current, role))}
                  />
                  {roleLabels[role]}
                </label>
              ))}
            </div>
          </fieldset>
          <button disabled={busy || inviteRoles.length === 0} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? 'Working…' : 'Send invitation'}
          </button>
        </form>
      </section>

      {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
      {truncated && <p className="mt-4 text-sm text-amber-700">Showing the first 500 accounts. Contact support if your team has more.</p>}

      <section className="mt-6 overflow-hidden rounded-lg border bg-white">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold text-gray-800">Team accounts</h2>
          <button onClick={handleRefreshUsers} className="rounded border px-3 py-1.5 text-xs font-semibold">Refresh</button>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-gray-500">Loading team accounts…</p>
        ) : (
          <div className="divide-y">
            {users.map(user => {
              const selectedRoles = pendingRoles[user.id] || []
              const hasChanges = selectedRoles.length !== user.roles.length || selectedRoles.some(role => !user.roles.includes(role))
              return (
                <div key={user.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-800">{user.email || 'Email unavailable'}</p>
                      <p className="text-xs text-gray-500">
                        {user.lastSignInAt ? `Last sign-in ${new Date(user.lastSignInAt).toLocaleDateString()}` : 'Has not signed in yet'}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleSaveRoles(user)}
                      disabled={busy || !hasChanges}
                      className="rounded border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    >
                      Save roles
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {APP_ROLES.map(role => (
                      <label key={role} className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedRoles.includes(role)}
                          onChange={() => setPendingRoles(current => ({
                            ...current,
                            [user.id]: toggleRole(current[user.id] || [], role)
                          }))}
                        />
                        {roleLabels[role]}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
            {users.length === 0 && <p className="p-6 text-sm text-gray-500">No accounts found.</p>}
          </div>
        )}
      </section>
    </main>
  )
}
