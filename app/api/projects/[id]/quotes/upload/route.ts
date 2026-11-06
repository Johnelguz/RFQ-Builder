import { NextResponse } from 'next/server'
import { getInvoiceApiContext } from '@/lib/invoice-api'

const QUOTE_BUCKET = 'project-vendor-quotes'
const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const QUOTE_MANAGER_ROLES = ['ADMIN', 'RFQ_MANAGER']

type RouteContext = { params: Promise<{ id: string }> }

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function isQuoteFilePath(projectId: string, filePath: string) {
  const [folder, objectId, fileName, ...extraParts] = filePath.split('/')
  return folder === projectId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(objectId || '')
    && Boolean(fileName)
    && !extraParts.length
    && filePath.length <= 512
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId, QUOTE_MANAGER_ROLES)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { fileName?: unknown; mimeType?: unknown; size?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide quote file details as JSON.', 400)
  }

  if (typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 255
    || typeof input.mimeType !== 'string' || !ACCEPTED_TYPES.has(input.mimeType)
    || typeof input.size !== 'number' || !Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_FILE_SIZE) {
    return errorResponse('Choose a named PDF, JPEG, PNG, or WebP quote up to 20 MB.', 400)
  }

  const safeFileName = input.fileName.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'quote'
  const filePath = `${projectId}/${crypto.randomUUID()}/${safeFileName}`
  const { data, error } = await result.context.adminClient.storage
    .from(QUOTE_BUCKET)
    .createSignedUploadUrl(filePath, { upsert: false })
  if (error || !data?.token) {
    return errorResponse(`Unable to prepare private quote upload: ${error?.message || 'Supabase did not return an upload token.'}`, 502)
  }

  return NextResponse.json({ filePath: data.path, token: data.token })
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId, QUOTE_MANAGER_ROLES)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { filePath?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide the quote file path as JSON.', 400)
  }
  if (typeof input.filePath !== 'string' || !isQuoteFilePath(projectId, input.filePath)) {
    return errorResponse('Invalid quote file path.', 400)
  }

  const { data: quote, error: quoteError } = await result.context.adminClient
    .from('vendor_quotes')
    .select('id')
    .eq('file_path', input.filePath)
    .maybeSingle()
  if (quoteError) return errorResponse('Unable to verify whether the file is attached to a saved quote.', 500)
  if (quote) return errorResponse('A saved quote file cannot be deleted here.', 409)

  const { error } = await result.context.adminClient.storage.from(QUOTE_BUCKET).remove([input.filePath])
  if (error) return errorResponse(`Unable to remove the unused quote upload: ${error.message}`, 502)
  return new NextResponse(null, { status: 204 })
}
