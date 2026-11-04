import { NextResponse } from 'next/server'
import { APP_ROLES, getAdminRequestContext, isAppRole } from '@/lib/admin-api'

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function readUserInput(request: Request) {
  try {
    return await request.json() as { email?: unknown; userId?: unknown; roles?: unknown }
  } catch {
    return null
  }
}

function validateRoles(value: unknown): value is typeof APP_ROLES[number][] {
  return Array.isArray(value) && value.every(isAppRole)
}

export async function GET(request: Request) {
  const result = await getAdminRequestContext(request)
  if (!result.context) return errorResponse(result.error, result.status)

  const { data: userPage, error: usersError } = await result.context.adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 500
  })
  if (usersError) return errorResponse(`Unable to load users: ${usersError.message}`, 500)

  const { data: memberships, error: membershipsError } = await result.context.adminClient
    .from('app_members')
    .select('user_id, role')
  if (membershipsError) return errorResponse(`Unable to load user roles: ${membershipsError.message}`, 500)

  const rolesByUser = new Map<string, string[]>()
  for (const membership of memberships || []) {
    const userRoles = rolesByUser.get(membership.user_id) || []
    userRoles.push(membership.role)
    rolesByUser.set(membership.user_id, userRoles)
  }

  return NextResponse.json({
    users: userPage.users.map(user => ({
      id: user.id,
      email: user.email || '',
      roles: rolesByUser.get(user.id) || [],
      invitedAt: user.invited_at || null,
      lastSignInAt: user.last_sign_in_at || null
    })),
    truncated: userPage.users.length === 500
  })
}

export async function POST(request: Request) {
  const result = await getAdminRequestContext(request)
  if (!result.context) return errorResponse(result.error, result.status)

  const body = await readUserInput(request)
  if (!body || typeof body.email !== 'string' || !body.email.includes('@') || !validateRoles(body.roles) || body.roles.length === 0) {
    return errorResponse('Provide a valid email address and at least one valid role.', 400)
  }

  const { data: invited, error: inviteError } = await result.context.adminClient.auth.admin.inviteUserByEmail(
    body.email.trim(),
    { redirectTo: new URL('/login', request.url).toString() }
  )
  if (inviteError || !invited.user) {
    return errorResponse(`Unable to invite user: ${inviteError?.message || 'Supabase did not return a user.'}`, 400)
  }

  const { error: roleError } = await result.context.adminClient.rpc('set_app_member_roles', {
    target_user_id: invited.user.id,
    new_roles: body.roles,
    actor_user_id: result.context.user.id
  })
  if (roleError) {
    return errorResponse(`The invitation was sent, but role assignment failed. Assign roles to ${body.email} before they sign in. Details: ${roleError.message}`, 500)
  }

  return NextResponse.json({ id: invited.user.id, email: invited.user.email, roles: body.roles }, { status: 201 })
}

export async function PUT(request: Request) {
  const result = await getAdminRequestContext(request)
  if (!result.context) return errorResponse(result.error, result.status)

  const body = await readUserInput(request)
  if (!body || typeof body.userId !== 'string' || !validateRoles(body.roles)) {
    return errorResponse('Provide a user ID and a list of valid roles.', 400)
  }

  const { data: target, error: targetError } = await result.context.adminClient.auth.admin.getUserById(body.userId)
  if (targetError || !target.user) return errorResponse('User was not found.', 404)

  const { error: roleError } = await result.context.adminClient.rpc('set_app_member_roles', {
    target_user_id: body.userId,
    new_roles: body.roles,
    actor_user_id: result.context.user.id
  })
  if (roleError) return errorResponse(`Unable to update roles: ${roleError.message}`, 400)

  return NextResponse.json({ id: body.userId, email: target.user.email, roles: body.roles })
}
