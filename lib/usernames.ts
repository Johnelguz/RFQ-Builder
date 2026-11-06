export const USERNAME_AUTH_DOMAIN = 'users.rfqapp.invalid'

export function isValidUsername(value: string) {
  return /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/i.test(value)
}

export function usernameToAuthEmail(username: string) {
  return `${username.trim().toLowerCase()}@${USERNAME_AUTH_DOMAIN}`
}

export function loginToAuthEmail(usernameOrEmail: string) {
  const value = usernameOrEmail.trim()
  return value.includes('@') ? value : usernameToAuthEmail(value)
}
