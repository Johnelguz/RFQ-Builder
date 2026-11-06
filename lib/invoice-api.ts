import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const INVOICE_BUCKET = 'project-invoices'

interface InvoiceApiContext {
  adminClient: SupabaseClient<InvoiceApiDatabase>
}

interface InvoiceApiDatabase {
  public: {
    Tables: {
      app_members: {
        Row: { user_id: string; role: string }
        Insert: { user_id: string; role: string }
        Update: { user_id?: string; role?: string }
        Relationships: []
      }
      projects: {
        Row: { id: string }
        Insert: { id?: string }
        Update: { id?: string }
        Relationships: []
      }
      material_invoices: {
        Row: { id: string; project_id: string; file_path: string }
        Insert: { id?: string; project_id: string; file_path: string }
        Update: { id?: string; project_id?: string; file_path?: string }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type InvoiceApiContextResult =
  | { context: InvoiceApiContext; error: null; status: 200 }
  | { context: null; error: string; status: 400 | 401 | 403 | 404 | 500 }

export async function getInvoiceApiContext(
  request: Request,
  projectId: string,
  allowedRoles: string[] = ['ADMIN', 'COST_EDITOR']
): Promise<InvoiceApiContextResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    return { context: null, error: 'Invalid project ID.', status: 400 }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { context: null, error: 'Server authentication and storage are not configured.', status: 500 }
  }

  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return { context: null, error: 'Sign-in is required.', status: 401 }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) return { context: null, error: 'Your session is invalid or expired.', status: 401 }

  const adminClient = createClient<InvoiceApiDatabase>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const [{ data: memberships, error: membershipError }, { data: project, error: projectError }] = await Promise.all([
    adminClient.from('app_members').select('role').eq('user_id', user.id).in('role', allowedRoles),
    adminClient.from('projects').select('id').eq('id', projectId).maybeSingle()
  ])

  if (membershipError || projectError) {
    return { context: null, error: 'Unable to verify project access.', status: 500 }
  }
  if (!memberships?.length) {
    return { context: null, error: 'You do not have permission to access files for this project.', status: 403 }
  }
  if (!project) return { context: null, error: 'Project not found.', status: 404 }

  return { context: { adminClient }, error: null, status: 200 }
}

export function isInvoiceFilePath(projectId: string, filePath: string) {
  const [folder, objectId, fileName, ...extraParts] = filePath.split('/')
  return folder === projectId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(objectId || '')
    && Boolean(fileName)
    && !extraParts.length
    && filePath.length <= 512
}

export { INVOICE_BUCKET }
