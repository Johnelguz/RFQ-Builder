import { NextResponse } from 'next/server'
import { getInvoiceApiContext, INVOICE_BUCKET } from '@/lib/invoice-api'

type RouteContext = { params: Promise<{ id: string }> }

const INVOICE_READ_ROLES = ['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId, INVOICE_READ_ROLES)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { invoiceId?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide an invoice ID as JSON.', 400)
  }
  if (typeof input.invoiceId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.invoiceId)) {
    return errorResponse('Invalid invoice ID.', 400)
  }

  const { data: invoice, error: invoiceError } = await result.context.adminClient
    .from('material_invoices')
    .select('file_path')
    .eq('id', input.invoiceId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (invoiceError) return errorResponse('Unable to load the invoice record.', 500)
  if (!invoice) return errorResponse('Invoice not found.', 404)

  const { data, error: signedUrlError } = await result.context.adminClient.storage
    .from(INVOICE_BUCKET)
    .createSignedUrl(invoice.file_path, 300)
  if (signedUrlError || !data?.signedUrl) {
    return errorResponse(
      signedUrlError?.message === 'Object not found'
        ? 'The invoice record exists, but its file is missing from private storage. Contact an administrator to restore the file.'
        : `Unable to create an invoice preview link: ${signedUrlError?.message || 'Supabase did not return a signed link.'}`,
      signedUrlError?.message === 'Object not found' ? 404 : 502
    )
  }

  return NextResponse.json({ signedUrl: data.signedUrl })
}
