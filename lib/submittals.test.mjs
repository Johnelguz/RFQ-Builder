import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('./submittals.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText
const {
  addBusinessDays,
  buildNextRevision,
  currentActiveRevision,
  deriveSubmittalStatus
} = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)

function revision(revision_number, status) {
  return { revision_number, status }
}

test('derives overall status from the latest non-void revision', () => {
  assert.equal(deriveSubmittalStatus([revision(0, 'Sent')]), 'Awaiting Response')
  assert.equal(deriveSubmittalStatus([revision(0, 'Rejected')]), 'Needs Resubmittal')
  assert.equal(deriveSubmittalStatus([revision(0, 'Approved as Noted')]), 'Closed (Approved)')
  assert.equal(
    deriveSubmittalStatus([revision(0, 'Sent'), revision(1, 'Void')]),
    'Awaiting Response'
  )
  assert.equal(deriveSubmittalStatus([revision(0, 'Void')]), 'Void')
  assert.equal(deriveSubmittalStatus([]), 'In Progress')
  assert.equal(currentActiveRevision([revision(1, 'Sent'), revision(2, 'Void')]).revision_number, 1)
})

test('adds business days while skipping weekends', () => {
  assert.equal(addBusinessDays('2026-11-06', 1), '2026-11-09')
  assert.equal(addBusinessDays('2026-11-07', 1), '2026-11-09')
  assert.equal(addBusinessDays('2026-11-06', 5), '2026-11-13')
  assert.equal(addBusinessDays('2026-11-06', 0), '2026-11-06')
  assert.throws(() => addBusinessDays('2026-11-06', -1), RangeError)
})

test('prepares the next revision with the next number and prior recipient', () => {
  assert.deepEqual(buildNextRevision([]), {
    revision_number: 0,
    status: 'Preparing',
    sent_to: null
  })
  assert.deepEqual(buildNextRevision([
    { revision_number: 0, status: 'Sent', sent_to: 'GC reviewer' },
    { revision_number: 2, status: 'Rejected', sent_to: 'Updated reviewer' }
  ]), {
    revision_number: 3,
    status: 'Preparing',
    sent_to: 'Updated reviewer'
  })
})
