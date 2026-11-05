import { NextResponse } from 'next/server'
import { getInvoiceApiContext, INVOICE_BUCKET } from '@/lib/invoice-api'

type RouteContext = { params: Promise<{ id: string; invoiceId: string }> }

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id: projectId, invoiceId } = await params
  const result = await getInvoiceApiContext(request, projectId, ['ADMIN'])
  if (!result.context) return errorResponse(result.error, result.status)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
    return errorResponse('Invalid invoice ID.', 400)
  }

  const { data: invoice, error: invoiceError } = await result.context.adminClient
    .from('material_invoices')
    .select('id, file_path')
    .eq('id', invoiceId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (invoiceError) return errorResponse('Unable to load the invoice record.', 500)
  if (!invoice) return errorResponse('Invoice not found.', 404)

  const { data: deletedInvoice, error: deleteError } = await result.context.adminClient
    .from('material_invoices')
    .delete()
    .eq('id', invoiceId)
    .eq('project_id', projectId)
    .select('id')
    .maybeSingle()
  if (deleteError) return errorResponse(`Unable to delete the invoice record: ${deleteError.message}`, 500)
  if (!deletedInvoice) return errorResponse('Invoice was not deleted.', 500)

  const { error: storageError } = await result.context.adminClient.storage
    .from(INVOICE_BUCKET)
    .remove([invoice.file_path])
  if (storageError) {
    return NextResponse.json({
      deleted: true,
      warning: `The invoice record was deleted, but its stored file could not be removed: ${storageError.message}`
    })
  }

  return NextResponse.json({ deleted: true, warning: null })
}
