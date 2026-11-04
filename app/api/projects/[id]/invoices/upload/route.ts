import { NextResponse } from 'next/server'
import { getInvoiceApiContext, INVOICE_BUCKET, isInvoiceFilePath } from '@/lib/invoice-api'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

type RouteContext = { params: Promise<{ id: string }> }

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function safeFileName(name: string) {
  return name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'invoice'
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { fileName?: unknown; mimeType?: unknown; size?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide invoice file details as JSON.', 400)
  }

  if (typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 255
    || typeof input.mimeType !== 'string' || !ACCEPTED_TYPES.has(input.mimeType)
    || typeof input.size !== 'number' || !Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_FILE_SIZE) {
    return errorResponse('Choose a named PDF, JPEG, PNG, or WebP invoice up to 20 MB.', 400)
  }

  const filePath = `${projectId}/${crypto.randomUUID()}/${safeFileName(input.fileName)}`
  const { data, error } = await result.context.adminClient.storage
    .from(INVOICE_BUCKET)
    .createSignedUploadUrl(filePath, { upsert: false })
  if (error || !data?.token) {
    return errorResponse(`Unable to prepare private invoice upload: ${error?.message || 'Supabase did not return an upload token.'}`, 502)
  }

  return NextResponse.json({ filePath: data.path, token: data.token })
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { filePath?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide the invoice file path as JSON.', 400)
  }
  if (typeof input.filePath !== 'string' || !isInvoiceFilePath(projectId, input.filePath)) {
    return errorResponse('Invalid invoice file path.', 400)
  }

  const { data: invoice, error: invoiceError } = await result.context.adminClient
    .from('material_invoices')
    .select('id')
    .eq('file_path', input.filePath)
    .maybeSingle()
  if (invoiceError) return errorResponse('Unable to verify whether the file is attached to a saved invoice.', 500)
  if (invoice) return errorResponse('A saved invoice file cannot be deleted here.', 409)

  const { error } = await result.context.adminClient.storage.from(INVOICE_BUCKET).remove([input.filePath])
  if (error) return errorResponse(`Unable to remove the unused invoice upload: ${error.message}`, 502)
  return new NextResponse(null, { status: 204 })
}
