import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'

export const APP_ROLES = ['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'] as const
export type AppRole = (typeof APP_ROLES)[number]

interface AdminDatabase {
  public: {
    Tables: {
      app_members: {
        Row: { user_id: string; role: string; assigned_by: string | null; created_at: string }
        Insert: { user_id: string; role: string; assigned_by?: string | null; created_at?: string }
        Update: { user_id?: string; role?: string; assigned_by?: string | null; created_at?: string }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      set_app_member_roles: {
        Args: { target_user_id: string; new_roles: string[]; actor_user_id: string }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.includes(value as AppRole)
}

interface AdminRequestContext {
  user: User
  adminClient: SupabaseClient<AdminDatabase>
}

type AdminContextResult =
  | { context: AdminRequestContext; error: null; status: 200 }
  | { context: null; error: string; status: 401 | 403 | 500 }

export async function getAdminRequestContext(request: Request): Promise<AdminContextResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { context: null, error: 'Server authentication is not configured.', status: 500 }
  }

  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return { context: null, error: 'Sign-in is required.', status: 401 }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) return { context: null, error: 'Your session is invalid or expired.', status: 401 }

  const adminClient = createClient<AdminDatabase>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: memberships, error: membershipError } = await adminClient
    .from('app_members')
    .select('role')
    .eq('user_id', user.id)

  if (membershipError) {
    return { context: null, error: `Unable to verify administrator access: ${membershipError.message}`, status: 500 }
  }
  if (!memberships?.some(membership => membership.role === 'ADMIN')) {
    return { context: null, error: 'Administrator access is required.', status: 403 }
  }

  return { context: { user, adminClient }, error: null, status: 200 }
}
