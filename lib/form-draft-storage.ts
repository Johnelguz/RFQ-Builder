const FORM_DRAFT_PREFIX = 'electrical-rfq-app:form-draft:v1:'

export interface DraftStorage {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

export function formDraftStorageKey(userId: string, draftName: string) {
  return `${FORM_DRAFT_PREFIX}${encodeURIComponent(userId)}:${draftName}`
}

export function clearUserDraftsFromStorage(storage: DraftStorage, userId: string) {
  const encodedUserId = encodeURIComponent(userId)
  const prefixes = [
    `${FORM_DRAFT_PREFIX}${encodedUserId}:`,
    `takeoff-draft:v1:${encodedUserId}:`,
    `rfq-workflow:v1:${encodedUserId}:`,
    `invoice-draft:v1:${encodedUserId}:`
  ]
  const removed: string[] = []
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (key && prefixes.some(prefix => key.startsWith(prefix))) {
      storage.removeItem(key)
      removed.push(key)
    }
  }
  return removed
}
