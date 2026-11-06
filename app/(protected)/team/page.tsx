'use client'

import { useCallback, useEffect, useState } from 'react'
import { APP_ROLES, type AppRole, hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

interface TeamUser {
  id: string
  email: string
  username: string
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
  const [usernameDrafts, setUsernameDrafts] = useState<Record<string, string>>({})
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({})
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [inviteRoles, setInviteRoles] = useState<AppRole[]>(['VIEWER'])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const adminRequest = useCallback(async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: object) => {
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
    const result = await response.json() as {
      error?: string
      users?: TeamUser[]
      truncated?: boolean
      username?: string
    }
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
      setUsernameDrafts(Object.fromEntries(teamUsers.map(user => [user.id, user.username])))
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

  async function handleCreateUser(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const username = newUsername.trim().toLowerCase()
      await adminRequest('POST', { username, password: newPassword, roles: inviteRoles })
      setNewUsername('')
      setNewPassword('')
      setNotice(`Created ${username}. Share the login link, username, and password with them securely.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create the account.')
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
      setNotice(`Updated access for ${user.username || user.email}.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save role changes.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveCredentials(user: TeamUser) {
    const username = (usernameDrafts[user.id] || '').trim().toLowerCase()
    const password = passwordDrafts[user.id] || ''
    const usernameChanged = username !== user.username
    if (!usernameChanged && !password) return

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await adminRequest('PATCH', {
        userId: user.id,
        ...(usernameChanged ? { username } : {}),
        ...(password ? { password } : {})
      })
      setPasswordDrafts(current => ({ ...current, [user.id]: '' }))
      setNotice(`Updated credentials for ${username || user.username || user.email}.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update account credentials.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteUser(user: TeamUser) {
    const accountName = user.username || user.email || 'this account'
    if (!window.confirm(`Permanently delete ${accountName}? This removes their access and cannot be undone.`)) return

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await adminRequest('DELETE', { userId: user.id })
      setNotice(`Deleted ${accountName}.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete the account.')
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
      <p className="mt-1 text-sm text-gray-600">Create username and password accounts, manage roles, reset passwords, or remove access.</p>
      <p className="mt-1 text-sm text-gray-600">
        Share the <a href="/login" className="font-medium text-blue-700 underline">login page</a> with your team. Existing email accounts can be given usernames below.
      </p>

      <section className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="text-sm font-bold uppercase text-gray-600">Create an account</h2>
        <form onSubmit={handleCreateUser} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Username
            <input
              type="text"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,30}[A-Za-z0-9]"
              autoComplete="off"
              value={newUsername}
              onChange={event => setNewUsername(event.target.value)}
              className="mt-1 w-full max-w-md rounded border p-2.5"
              placeholder="e.g. alex.smith"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Temporary password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              className="mt-1 w-full max-w-md rounded border p-2.5"
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
            {busy ? 'Working…' : 'Create account'}
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
                      <p className="font-medium text-gray-800">{user.username || user.email || 'Username unavailable'}</p>
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
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block text-xs font-medium text-gray-600">
                      Username
                      <input
                        type="text"
                        required
                        minLength={3}
                        maxLength={32}
                        pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,30}[A-Za-z0-9]"
                        value={usernameDrafts[user.id] || ''}
                        onChange={event => setUsernameDrafts(current => ({ ...current, [user.id]: event.target.value }))}
                        className="mt-1 block w-48 rounded border p-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-medium text-gray-600">
                      New password
                      <input
                        type="password"
                        minLength={8}
                        autoComplete="new-password"
                        value={passwordDrafts[user.id] || ''}
                        onChange={event => setPasswordDrafts(current => ({ ...current, [user.id]: event.target.value }))}
                        className="mt-1 block w-48 rounded border p-2 text-sm"
                        placeholder="Leave blank to keep"
                      />
                    </label>
                    <button
                      onClick={() => void handleSaveCredentials(user)}
                      disabled={busy || ((usernameDrafts[user.id] || '').trim().toLowerCase() === user.username && !(passwordDrafts[user.id] || ''))}
                      className="rounded border px-3 py-2 text-xs font-semibold disabled:opacity-40"
                    >
                      Save credentials
                    </button>
                    <button
                      onClick={() => void handleDeleteUser(user)}
                      disabled={busy}
                      className="rounded border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40"
                    >
                      Delete account
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
