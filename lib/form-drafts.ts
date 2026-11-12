import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { clearUserDraftsFromStorage, formDraftStorageKey } from '@/lib/form-draft-storage'

const draftListeners = new Map<string, Set<() => void>>()
const storageErrorListeners = new Set<() => void>()
let draftStorageError: string | null = null

function emitDraftChange(key: string) {
  draftListeners.get(key)?.forEach(listener => listener())
}

function subscribeToDraft(key: string | null, listener: () => void) {
  if (!key || typeof window === 'undefined') return () => undefined

  const listeners = draftListeners.get(key) || new Set<() => void>()
  listeners.add(listener)
  draftListeners.set(key, listeners)
  const handleStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener()
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) draftListeners.delete(key)
    window.removeEventListener('storage', handleStorage)
  }
}

function getDraftSnapshot(key: string | null) {
  if (!key || typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    window.setTimeout(() => reportDraftStorageError(error), 0)
    return null
  }
}

function setDraftStorageError(error: string | null) {
  draftStorageError = error
  storageErrorListeners.forEach(listener => listener())
}

function reportDraftStorageError(error: unknown) {
  const detail = error instanceof Error ? error.message : 'Browser storage is unavailable.'
  setDraftStorageError(`Unable to preserve form drafts in this browser: ${detail}`)
}

function subscribeToStorageError(listener: () => void) {
  storageErrorListeners.add(listener)
  return () => {
    storageErrorListeners.delete(listener)
  }
}

function getStorageError() {
  return draftStorageError
}

function serializeDraft(value: unknown) {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Draft data could not be serialized.')
  return serialized
}

function parseDraft<T>(serialized: string, initialValue: T) {
  try {
    return { value: JSON.parse(serialized) as T, valid: true }
  } catch {
    return { value: initialValue, valid: false }
  }
}

function areDraftValuesEqual<T>(left: T, right: T) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return Object.is(left, right)
  }
}

export function useFormDraftStorageError() {
  return useSyncExternalStore(subscribeToStorageError, getStorageError, () => null)
}

export function clearUserFormDrafts(userId: string) {
  if (typeof window === 'undefined') return

  try {
    const clearedKeys = clearUserDraftsFromStorage(window.localStorage, userId)
    clearUserDraftsFromStorage(window.sessionStorage, userId)
    clearedKeys.forEach(emitDraftChange)
    setDraftStorageError(null)
  } catch (error) {
    reportDraftStorageError(error)
  }
}

export function useFormDraftState<T>(
  userId: string | null,
  draftName: string,
  initialValue: T
): [T, Dispatch<SetStateAction<T>>, Dispatch<SetStateAction<T>>] {
  const storageKey = userId ? formDraftStorageKey(userId, draftName) : null
  const subscribe = useCallback((listener: () => void) => subscribeToDraft(storageKey, listener), [storageKey])
  const getSnapshot = useCallback(() => getDraftSnapshot(storageKey), [storageKey])
  const serializedDraft = useSyncExternalStore(subscribe, getSnapshot, () => null)
  const parsedDraft = useMemo(
    () => serializedDraft === null ? null : parseDraft(serializedDraft, initialValue),
    [initialValue, serializedDraft]
  )
  const [fallback, setFallback] = useState<{ key: string | null; value: T }>({ key: storageKey, value: initialValue })
  const value = parsedDraft?.valid ? parsedDraft.value : fallback.key === storageKey ? fallback.value : initialValue
  const valueRef = useRef(value)
  const storageKeyRef = useRef(storageKey)
  const serializedDraftRef = useRef(serializedDraft)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    storageKeyRef.current = storageKey
    serializedDraftRef.current = serializedDraft
  }, [serializedDraft, storageKey])

  useEffect(() => {
    if (!storageKey || serializedDraft === null || parsedDraft?.valid !== false) return
    try {
      window.localStorage.removeItem(storageKey)
      emitDraftChange(storageKey)
      reportDraftStorageError(new Error('A saved form draft was invalid and has been cleared.'))
    } catch (error) {
      reportDraftStorageError(error)
    }
  }, [parsedDraft?.valid, serializedDraft, storageKey])

  const setDraftValue = useCallback<Dispatch<SetStateAction<T>>>(nextValue => {
    const currentValue = valueRef.current
    const next = typeof nextValue === 'function'
      ? (nextValue as (previous: T) => T)(currentValue)
      : nextValue
    valueRef.current = next
    setFallback({ key: storageKey, value: next })

    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, serializeDraft(next))
      emitDraftChange(storageKey)
      setDraftStorageError(null)
    } catch (error) {
      reportDraftStorageError(error)
    }
  }, [storageKey])

  const setFromServer = useCallback<Dispatch<SetStateAction<T>>>(nextValue => {
    const currentValue = valueRef.current
    const isUpdater = typeof nextValue === 'function'
    const next = isUpdater ? (nextValue as (previous: T) => T)(currentValue) : nextValue
    const savedDraft = serializedDraftRef.current
    if (isUpdater || savedDraft === null || areDraftValuesEqual(currentValue, next)) {
      valueRef.current = next
      setFallback({ key: storageKeyRef.current, value: next })
    }
  }, [])

  return [value, setDraftValue, setFromServer]
}
