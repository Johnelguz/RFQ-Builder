import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('./form-draft-storage.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText
const { clearUserDraftsFromStorage, formDraftStorageKey } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)

function memoryStorage(initialKeys) {
  const keys = [...initialKeys]
  return {
    keys,
    get length() {
      return keys.length
    },
    key(index) {
      return keys[index] ?? null
    },
    removeItem(key) {
      const index = keys.indexOf(key)
      if (index !== -1) keys.splice(index, 1)
    }
  }
}

test('draft storage keys are scoped to a user and safely encode account IDs', () => {
  assert.equal(formDraftStorageKey('user/1', 'quotes'), 'electrical-rfq-app:form-draft:v1:user%2F1:quotes')
  assert.notEqual(formDraftStorageKey('user-1', 'quotes'), formDraftStorageKey('user-2', 'quotes'))
})

test('clearing a user drafts leaves other accounts untouched', () => {
  const userOneDraft = formDraftStorageKey('user-1', 'supplier-form')
  const userTwoDraft = formDraftStorageKey('user-2', 'supplier-form')
  const legacyTakeoffDraft = 'takeoff-draft:v1:user-1:project-1'
  const storage = memoryStorage([
    userOneDraft,
    userTwoDraft,
    legacyTakeoffDraft,
    'other-app:setting'
  ])

  clearUserDraftsFromStorage(storage, 'user-1')

  assert.deepEqual(storage.keys, [userTwoDraft, 'other-app:setting'])
})
