export interface DriveFileReference {
  id: string
  name: string
  mimeType: string | null
  url: string
}

export function parseDriveFileUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }

  const allowedHosts = new Set(['drive.google.com', 'docs.google.com'])
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) return null

  const pathId = url.pathname.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([a-zA-Z0-9_-]+)/)?.[1]
  const queryId = url.searchParams.get('id')
  const fileId = pathId || queryId
  return fileId && /^[a-zA-Z0-9_-]+$/.test(fileId) ? fileId : null
}

export function driveFileUrl(fileId: string) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
}

export function drivePreviewUrl(fileId: string) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
}

export function isDrivePreviewable(mimeType: string | null) {
  if (!mimeType) return true
  return mimeType === 'application/pdf'
    || mimeType === 'text/plain'
    || mimeType.startsWith('image/')
    || [
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.drawing'
    ].includes(mimeType)
}

export function parseDriveFolderUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'drive.google.com') return null
  const folderId = url.pathname.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/)?.[1]
  return folderId && /^[a-zA-Z0-9_-]+$/.test(folderId) ? folderId : null
}

export function driveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
}
