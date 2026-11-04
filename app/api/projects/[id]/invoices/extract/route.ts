import { v1 } from '@google-cloud/documentai'
import type { protos } from '@google-cloud/documentai'
import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient, GoogleAuth } from 'google-auth-library'
import { NextResponse } from 'next/server'
import { getInvoiceApiContext, INVOICE_BUCKET, isInvoiceFilePath } from '@/lib/invoice-api'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

type RouteContext = { params: Promise<{ id: string }> }
type Entity = protos.google.cloud.documentai.v1.Document.IEntity

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function entityValue(entity: Entity): string {
  const normalized = entity.normalizedValue
  if (normalized?.moneyValue) {
    const units = Number(normalized.moneyValue.units || 0)
    const nanos = Number(normalized.moneyValue.nanos || 0)
    return String(units + nanos / 1_000_000_000)
  }
  if (normalized?.dateValue) {
    const { year, month, day } = normalized.dateValue
    if (year && month && day) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return normalized?.text?.trim() || entity.mentionText?.trim() || ''
}

function findEntity(entities: Entity[], ...types: string[]) {
  return entities.find(entity => types.includes(entity.type || ''))
}

function parseAmount(value: string) {
  if (!value.trim()) return null
  const normalized = value.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseQuantity(value: string) {
  const parsed = parseAmount(value)
  if (parsed != null) return parsed

  const fraction = value.trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*\/\s*(\d[\d,]*(?:\.\d+)?)/)
  if (fraction) {
    const numerator = Number(fraction[1].replace(/,/g, ''))
    const denominator = Number(fraction[2].replace(/,/g, ''))
    return denominator === 0 ? null : numerator / denominator
  }

  const numericPrefix = value.trim().match(/^(\d[\d,]*(?:\.\d+)?)/)
  if (!numericPrefix) return null
  const quantity = Number(numericPrefix[1].replace(/,/g, ''))
  return Number.isFinite(quantity) ? quantity : null
}

function dateToIso(value: string) {
  let year: number
  let month: number
  let day: number
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const usDate = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (isoDate) {
    year = Number(isoDate[1])
    month = Number(isoDate[2])
    day = Number(isoDate[3])
  } else if (usDate) {
    year = Number(usDate[3].length === 2 ? `20${usDate[3]}` : usDate[3])
    month = Number(usDate[1])
    day = Number(usDate[2])
  } else {
    return ''
  }
  const parsedDate = new Date(Date.UTC(year, month - 1, day))
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function findLineProperty(entities: Entity[], suffixes: string[]) {
  return entities.find(entity => suffixes.some(suffix => (entity.type || '').endsWith(suffix)))
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { filePath?: unknown; fileName?: unknown; mimeType?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide invoice file details as JSON.', 400)
  }
  if (typeof input.filePath !== 'string' || !isInvoiceFilePath(projectId, input.filePath)
    || typeof input.fileName !== 'string' || !input.fileName.trim()
    || typeof input.mimeType !== 'string' || !ACCEPTED_TYPES.has(input.mimeType)) {
    return errorResponse('Invalid invoice file details.', 400)
  }

  const { data: existingInvoice, error: existingInvoiceError } = await result.context.adminClient
    .from('material_invoices')
    .select('id')
    .eq('file_path', input.filePath)
    .maybeSingle()
  if (existingInvoiceError) return errorResponse('Unable to verify invoice extraction access.', 500)
  if (existingInvoice) return errorResponse('This file is already attached to a saved invoice.', 409)

  const projectIdFromEnv = process.env.GCP_PROJECT_ID
  const projectNumber = process.env.GCP_PROJECT_NUMBER
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL
  const workloadIdentityPoolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID
  const workloadIdentityProviderId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
  const oidcAudience = process.env.GCP_AUDIENCE
  if (!projectIdFromEnv || !projectNumber || !location || !processorId || !serviceAccountEmail
    || !workloadIdentityPoolId || !workloadIdentityProviderId || !oidcAudience) {
    return errorResponse('Google Document AI workload identity is not configured on the server.', 503)
  }

  const { data: file, error: downloadError } = await result.context.adminClient.storage
    .from(INVOICE_BUCKET)
    .download(input.filePath)
  if (downloadError || !file) return errorResponse(`Unable to read the private invoice upload: ${downloadError?.message || 'File not found.'}`, 404)
  if (file.size === 0 || file.size > MAX_FILE_SIZE) return errorResponse('Invoice file must be between 1 byte and 20 MB.', 400)
  if (file.type && file.type !== input.mimeType) return errorResponse('The uploaded file type does not match the selected file type.', 400)

  const providerResource = `projects/${projectNumber}/locations/global/workloadIdentityPools/${workloadIdentityPoolId}/providers/${workloadIdentityProviderId}`
  const externalAuthClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/${providerResource}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken({ audience: oidcAudience })
    }
  })
  if (!externalAuthClient) return errorResponse('Unable to initialize Google workload identity.', 500)

  const auth = new GoogleAuth({
    projectId: projectIdFromEnv,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    authClient: externalAuthClient
  })
  const client = new v1.DocumentProcessorServiceClient({
    apiEndpoint: `${location}-documentai.googleapis.com`,
    projectId: projectIdFromEnv,
    auth
  })

  try {
    const [response] = await client.processDocument({
      name: `projects/${projectIdFromEnv}/locations/${location}/processors/${processorId}`,
      rawDocument: {
        content: Buffer.from(await file.arrayBuffer()),
        mimeType: input.mimeType
      }
    })
    const entities = response.document?.entities || []
    const vendor = findEntity(entities, 'supplier_name', 'vendor_name')
    const invoiceNumber = findEntity(entities, 'invoice_id', 'invoice_number')
    const invoiceDate = findEntity(entities, 'invoice_date')
    const invoiceTotal = findEntity(entities, 'total_amount', 'invoice_total')
    const invoiceTax = findEntity(entities, 'total_tax_amount', 'tax_amount')
    let linesWithoutExtractedQuantity = 0
    let linesWithEstimatedQuantity = 0
    const lineItems: Array<{
      item_number: number
      description: string
      quantity: string
      quantityEstimated: boolean
      unit: string
      unit_price: string
      actual_line_cost?: string
      isTax?: boolean
    }> = entities.filter(entity => entity.type === 'line_item').map((entity, index) => {
      const fields = entity.properties || []
      const description = findLineProperty(fields, ['/description'])
        || findLineProperty(fields, ['/product_code'])
      const quantity = findLineProperty(fields, ['/quantity'])
      const unit = findLineProperty(fields, ['/unit'])
      const unitPrice = findLineProperty(fields, ['/unit_price'])
      const amount = findLineProperty(fields, ['/amount'])
      const quantityValue = parseQuantity(quantity ? entityValue(quantity) : '')
      const amountValue = parseAmount(amount ? entityValue(amount) : '')
      const priceValue = parseAmount(unitPrice ? entityValue(unitPrice) : '')
      const inferredQuantity = amountValue != null && priceValue != null && priceValue > 0
        ? amountValue / priceValue
        : null
      const quantityEstimated = quantityValue == null || quantityValue < 0
      const quantityInferred = quantityEstimated && inferredQuantity != null
        && Number.isFinite(inferredQuantity) && inferredQuantity > 0
      if (quantityEstimated) {
        if (quantityInferred) linesWithEstimatedQuantity += 1
        else linesWithoutExtractedQuantity += 1
      }
      const savedQuantity = quantityValue != null && quantityValue >= 0
        ? String(quantityValue)
        : quantityInferred
          ? Number(inferredQuantity.toFixed(4)).toString()
          : ''
      const inferredPrice = amountValue != null && Number(savedQuantity) > 0
        ? amountValue / Number(savedQuantity)
        : priceValue
      return {
        item_number: index + 1,
        description: description ? entityValue(description) : '',
        quantity: savedQuantity,
        quantityEstimated,
        unit: unit ? entityValue(unit) : 'EA',
        unit_price: inferredPrice == null ? '' : String(inferredPrice),
        ...(amountValue == null ? {} : { actual_line_cost: amountValue.toFixed(2) })
      }
    }).filter(item => item.description || item.quantity || item.unit_price || item.actual_line_cost)
    const taxAmount = parseAmount(invoiceTax ? entityValue(invoiceTax) : '')
    if (taxAmount != null && taxAmount > 0) {
      lineItems.push({
        item_number: lineItems.length + 1,
        description: 'Sales tax',
        quantity: '1',
        quantityEstimated: false,
        unit: 'TAX',
        unit_price: taxAmount.toFixed(2),
        actual_line_cost: taxAmount.toFixed(2),
        isTax: true
      })
    }

    const extractedTotal = parseAmount(invoiceTotal ? entityValue(invoiceTotal) : '')
    const extractedDate = dateToIso(invoiceDate ? entityValue(invoiceDate) : '')
    const extracted = {
      vendorName: vendor ? entityValue(vendor) : '',
      invoiceNumber: invoiceNumber ? entityValue(invoiceNumber) : '',
      invoiceDate: extractedDate,
      invoiceTotal: extractedTotal == null ? '' : extractedTotal.toFixed(2),
      items: lineItems
    }
    const warnings = []
    if (!extracted.vendorName) warnings.push('Vendor name was not confidently extracted.')
    if (!extracted.invoiceDate) warnings.push('Invoice date was not confidently extracted.')
    if (!extracted.invoiceTotal) warnings.push('Invoice total was not confidently extracted.')
    if (lineItems.length === 0) warnings.push('No invoice line items were detected.')
    else if (lineItems.some(item => !item.description || (!item.unit_price && !item.actual_line_cost))) {
      warnings.push('Some line items are missing descriptions or actual costs. Review them before recording.')
    }
    if (linesWithEstimatedQuantity > 0) {
      warnings.push(`${linesWithEstimatedQuantity} line item quantity${linesWithEstimatedQuantity === 1 ? ' was' : 'ies were'} estimated from the extracted line amount and unit price. Review before recording.`)
    }
    if (linesWithoutExtractedQuantity > 0) {
      warnings.push(`${linesWithoutExtractedQuantity} line item${linesWithoutExtractedQuantity === 1 ? ' has' : 's have'} no detected or derivable quantity. The quantity is left blank, the extracted actual line amount is preserved, and a quantity is required before recording.`)
    }

    return NextResponse.json({ extracted, warnings })
  } catch (error) {
    return errorResponse(`Google Document AI could not process this invoice: ${error instanceof Error ? error.message : 'Unexpected processing error.'}`, 502)
  } finally {
    await client.close()
  }
}
