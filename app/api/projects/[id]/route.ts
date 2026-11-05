import { NextResponse } from 'next/server'
import { getInvoiceApiContext, INVOICE_BUCKET } from '@/lib/invoice-api'

type RouteContext = { params: Promise<{ id: string }> }

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId, ['ADMIN'])
  if (!result.context) return errorResponse(result.error, result.status)

  const { data: invoices, error: invoiceError } = await result.context.adminClient
    .from('material_invoices')
    .select('file_path')
    .eq('project_id', projectId)
  if (invoiceError) return errorResponse('Unable to load invoice files for project cleanup.', 500)

  const { data: deletedProject, error: deleteError } = await result.context.adminClient
    .from('projects')
    .delete()
    .eq('id', projectId)
    .select('id')
    .maybeSingle()
  if (deleteError) return errorResponse(`Unable to delete the project: ${deleteError.message}`, 500)
  if (!deletedProject) return errorResponse('Project was not deleted.', 500)

  const filePaths = (invoices || []).map(invoice => invoice.file_path)
  if (filePaths.length) {
    const { error: storageError } = await result.context.adminClient.storage
      .from(INVOICE_BUCKET)
      .remove(filePaths)
    if (storageError) {
      return NextResponse.json({
        deleted: true,
        warning: `The project and its records were deleted, but some stored invoice files could not be removed: ${storageError.message}`
      })
    }
  }

  return NextResponse.json({ deleted: true, warning: null })
}
