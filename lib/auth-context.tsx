'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { loginToAuthEmail } from '@/lib/usernames'
import { clearUserFormDrafts } from '@/lib/form-drafts'

export const APP_ROLES = ['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'] as const
export type AppRole = (typeof APP_ROLES)[number]

interface AuthContextValue {
  user: User | null
  roles: AppRole[]
  loading: boolean
  rolesLoading: boolean
  error: string | null
  signIn: (usernameOrEmail: string, password: string) => Promise<string | null>
  signOut: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [loading, setLoading] = useState(true)
  const [rolesLoading, setRolesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let roleRequest = 0

    async function loadRoles(userId: string) {
      const requestId = ++roleRequest
      setRolesLoading(true)
      setError(null)
      const { data, error: roleError } = await supabase
        .from('app_members')
        .select('role')
        .eq('user_id', userId)

      if (!active || requestId !== roleRequest) return
      if (roleError) {
        setRoles([])
        setError(`Unable to load your app permissions: ${roleError.message}`)
      } else {
        setRoles((data || []).map(row => row.role as AppRole))
      }
      setRolesLoading(false)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      if (session?.user) {
        window.setTimeout(() => void loadRoles(session.user.id), 0)
      } else {
        roleRequest += 1
        setRoles([])
        setError(null)
        setRolesLoading(false)
      }
      setLoading(false)
    })

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(`Unable to check your sign-in: ${sessionError.message}`)
      setUser(data.session?.user ?? null)
      if (data.session?.user) void loadRoles(data.session.user.id)
      else setRolesLoading(false)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (usernameOrEmail: string, password: string) => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginToAuthEmail(usernameOrEmail),
      password
    })
    return signInError?.message ?? null
  }, [])

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut()
    if (!signOutError && user) clearUserFormDrafts(user.id)
    return signOutError?.message ?? null
  }, [user])

  const value = useMemo(() => ({
    user,
    roles,
    loading,
    rolesLoading,
    error,
    signIn,
    signOut
  }), [user, roles, loading, rolesLoading, error, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

export function hasAnyRole(userRoles: AppRole[], allowedRoles: AppRole[]) {
  return userRoles.some(role => allowedRoles.includes(role))
}
