import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('./google-drive.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText
const {
  driveFileUrl,
  driveFolderUrl,
  drivePreviewUrl,
  isDrivePreviewable,
  parseDriveFileUrl,
  parseDriveFolderUrl
} = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)

test('parses supported Google Drive file URL formats', () => {
  assert.equal(parseDriveFileUrl('https://drive.google.com/file/d/file_123/view'), 'file_123')
  assert.equal(parseDriveFileUrl('https://docs.google.com/document/d/doc-123/edit'), 'doc-123')
  assert.equal(parseDriveFileUrl('https://drive.google.com/open?id=query_id'), 'query_id')
  assert.equal(parseDriveFileUrl('  https://docs.google.com/spreadsheets/d/sheet_1/edit  '), 'sheet_1')
})

test('rejects invalid and non-Google file URLs', () => {
  assert.equal(parseDriveFileUrl('not a url'), null)
  assert.equal(parseDriveFileUrl('http://drive.google.com/file/d/file_123'), null)
  assert.equal(parseDriveFileUrl('https://drive.google.evil.com/file/d/file_123'), null)
  assert.equal(parseDriveFileUrl('https://example.com/?id=file_123'), null)
  assert.equal(parseDriveFileUrl('https://drive.google.com/open?id=bad%2Fid'), null)
})

test('parses and builds Drive folder, file, and preview URLs', () => {
  assert.equal(parseDriveFolderUrl('https://drive.google.com/drive/folders/folder-123'), 'folder-123')
  assert.equal(parseDriveFolderUrl('https://docs.google.com/drive/folders/folder-123'), null)
  assert.equal(driveFolderUrl('folder-123'), 'https://drive.google.com/drive/folders/folder-123')
  assert.equal(driveFileUrl('file_123'), 'https://drive.google.com/file/d/file_123/view')
  assert.equal(drivePreviewUrl('file_123'), 'https://drive.google.com/file/d/file_123/preview')
})

test('identifies supported Drive preview file types', () => {
  assert.equal(isDrivePreviewable('application/pdf'), true)
  assert.equal(isDrivePreviewable('image/png'), true)
  assert.equal(isDrivePreviewable('application/vnd.google-apps.document'), true)
  assert.equal(isDrivePreviewable('application/zip'), false)
  assert.equal(isDrivePreviewable(null), true)
})
