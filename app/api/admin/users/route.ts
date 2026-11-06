import { NextResponse } from 'next/server'
import { APP_ROLES, getAdminRequestContext, isAppRole } from '@/lib/admin-api'
import { isValidUsername, usernameToAuthEmail } from '@/lib/usernames'

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function readUserInput(request: Request) {
  try {
    return await request.json() as {
      username?: unknown
      password?: unknown
      userId?: unknown
      roles?: unknown
    }
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
      username: typeof user.user_metadata?.username === 'string' ? user.user_metadata.username : '',
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
  if (!body || typeof body.username !== 'string' || !isValidUsername(body.username.trim())
    || typeof body.password !== 'string' || body.password.length < 8
    || !validateRoles(body.roles) || body.roles.length === 0) {
    return errorResponse('Provide a username (3–32 letters, numbers, dots, underscores or hyphens), a password with at least 8 characters, and at least one valid role.', 400)
  }

  const username = body.username.trim().toLowerCase()
  const { data: created, error: createError } = await result.context.adminClient.auth.admin.createUser({
    email: usernameToAuthEmail(username),
    password: body.password,
    email_confirm: true,
    user_metadata: { username }
  })
  if (createError || !created.user) {
    return errorResponse(`Unable to create user: ${createError?.message || 'Supabase did not return a user.'}`, 400)
  }

  const { error: roleError } = await result.context.adminClient.rpc('set_app_member_roles', {
    target_user_id: created.user.id,
    new_roles: body.roles,
    actor_user_id: result.context.user.id
  })
  if (roleError) {
    const { error: cleanupError } = await result.context.adminClient.auth.admin.deleteUser(created.user.id)
    return errorResponse(
      cleanupError
        ? `User was created but role assignment failed, and automatic cleanup failed. Remove account ${created.user.id} manually. Details: ${roleError.message}; cleanup: ${cleanupError.message}`
        : `Unable to assign roles; the new account was removed. Details: ${roleError.message}`,
      500
    )
  }

  return NextResponse.json({ id: created.user.id, username, roles: body.roles }, { status: 201 })
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

export async function PATCH(request: Request) {
  const result = await getAdminRequestContext(request)
  if (!result.context) return errorResponse(result.error, result.status)

  const body = await readUserInput(request)
  if (!body || typeof body.userId !== 'string') {
    return errorResponse('Provide a user ID and a username or password to update.', 400)
  }
  const hasUsername = body.username !== undefined
  const hasPassword = body.password !== undefined
  if ((!hasUsername && !hasPassword)
    || (hasUsername && (typeof body.username !== 'string' || !isValidUsername(body.username.trim())))
    || (hasPassword && (typeof body.password !== 'string' || body.password.length < 8))) {
    return errorResponse('Provide a valid username (3–32 letters, numbers, dots, underscores or hyphens) and/or a password with at least 8 characters.', 400)
  }

  const { data: target, error: targetError } = await result.context.adminClient.auth.admin.getUserById(body.userId)
  if (targetError || !target.user) return errorResponse('User was not found.', 404)

  const updates: {
    email?: string
    email_confirm?: boolean
    password?: string
    user_metadata?: Record<string, unknown>
  } = {}
  let username: string | undefined
  if (hasUsername) {
    username = (body.username as string).trim().toLowerCase()
    updates.email = usernameToAuthEmail(username)
    updates.email_confirm = true
    updates.user_metadata = { ...target.user.user_metadata, username }
  }
  if (hasPassword) updates.password = body.password as string

  const { error: updateError } = await result.context.adminClient.auth.admin.updateUserById(body.userId, updates)
  if (updateError) return errorResponse(`Unable to update account credentials: ${updateError.message}`, 400)

  return NextResponse.json({ id: body.userId, username: username || target.user.user_metadata?.username || '' })
}

export async function DELETE(request: Request) {
  const result = await getAdminRequestContext(request)
  if (!result.context) return errorResponse(result.error, result.status)

  const body = await readUserInput(request)
  if (!body || typeof body.userId !== 'string') return errorResponse('Provide a user ID.', 400)
  if (body.userId === result.context.user.id) return errorResponse('You cannot delete your own account.', 400)

  const { data: target, error: targetError } = await result.context.adminClient.auth.admin.getUserById(body.userId)
  if (targetError || !target.user) return errorResponse('User was not found.', 404)

  const { data: memberships, error: membershipError } = await result.context.adminClient
    .from('app_members')
    .select('role')
    .eq('user_id', body.userId)
  if (membershipError) return errorResponse(`Unable to verify the account roles: ${membershipError.message}`, 500)
  if (memberships?.some(membership => membership.role === 'ADMIN')) {
    const { count, error: adminCountError } = await result.context.adminClient
      .from('app_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('role', 'ADMIN')
    if (adminCountError) return errorResponse(`Unable to verify administrator accounts: ${adminCountError.message}`, 500)
    if ((count || 0) <= 1) return errorResponse('The last administrator account cannot be deleted.', 400)
  }

  const { error: deleteError } = await result.context.adminClient.auth.admin.deleteUser(body.userId)
  if (deleteError) return errorResponse(`Unable to delete account: ${deleteError.message}`, 400)

  return NextResponse.json({ id: body.userId, deleted: true })
}
