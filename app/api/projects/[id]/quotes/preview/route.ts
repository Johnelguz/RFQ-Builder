import { NextResponse } from 'next/server'
import { getInvoiceApiContext } from '@/lib/invoice-api'

const QUOTE_BUCKET = 'project-vendor-quotes'
const QUOTE_READ_ROLES = ['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']

type RouteContext = { params: Promise<{ id: string }> }

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId, QUOTE_READ_ROLES)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { quoteId?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide a quote ID as JSON.', 400)
  }
  if (typeof input.quoteId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.quoteId)) {
    return errorResponse('Invalid quote ID.', 400)
  }

  const { data: quote, error: quoteError } = await result.context.adminClient
    .from('vendor_quotes')
    .select('file_path')
    .eq('id', input.quoteId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (quoteError) return errorResponse('Unable to load the quote record.', 500)
  if (!quote?.file_path) return errorResponse('Quote file not found.', 404)

  const { data, error } = await result.context.adminClient.storage
    .from(QUOTE_BUCKET)
    .createSignedUrl(quote.file_path, 300)
  if (error || !data?.signedUrl) {
    return errorResponse(
      error?.message === 'Object not found'
        ? 'The quote record exists, but its file is missing from private storage.'
        : `Unable to create a quote preview link: ${error?.message || 'Supabase did not return a signed link.'}`,
      error?.message === 'Object not found' ? 404 : 502
    )
  }

  return NextResponse.json({ signedUrl: data.signedUrl })
}
