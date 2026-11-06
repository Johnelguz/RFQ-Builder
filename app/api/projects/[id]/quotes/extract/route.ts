import { v1 } from '@google-cloud/documentai'
import type { protos } from '@google-cloud/documentai'
import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient, GoogleAuth } from 'google-auth-library'
import { NextResponse } from 'next/server'
import { getInvoiceApiContext } from '@/lib/invoice-api'

const QUOTE_BUCKET = 'project-vendor-quotes'
const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const QUOTE_READ_ROLES = ['ADMIN', 'RFQ_MANAGER']

type RouteContext = { params: Promise<{ id: string }> }
type Entity = protos.google.cloud.documentai.v1.Document.IEntity

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function entityValue(entity: Entity): string {
  const money = entity.normalizedValue?.moneyValue
  if (money) return String(Number(money.units || 0) + Number(money.nanos || 0) / 1_000_000_000)
  return entity.normalizedValue?.text?.trim() || entity.mentionText?.trim() || ''
}

function parseAmount(value: string) {
  const normalized = value.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  const amount = Number(normalized)
  return value.trim() && Number.isFinite(amount) && amount >= 0 ? amount : null
}

function extractTotal(entities: Entity[], documentText: string) {
  const totalEntity = entities.find(entity =>
    ['total_amount', 'invoice_total', 'amount_due', 'grand_total', 'total'].includes(entity.type || '')
  )
  const extractedAmount = totalEntity ? parseAmount(entityValue(totalEntity)) : null
  if (extractedAmount != null) return extractedAmount

  const labeledTotals = [...documentText.matchAll(
    /(?:quote\s+total|grand\s+total|total\s+due|amount\s+due|total)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/gi
  )]
  for (const match of labeledTotals.reverse()) {
    const amount = parseAmount(match[1])
    if (amount != null) return amount
  }
  return null
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id: projectId } = await params
  const result = await getInvoiceApiContext(request, projectId, QUOTE_READ_ROLES)
  if (!result.context) return errorResponse(result.error, result.status)

  let input: { filePath?: unknown; mimeType?: unknown }
  try {
    input = await request.json() as typeof input
  } catch {
    return errorResponse('Provide quote file details as JSON.', 400)
  }

  const filePath = input.filePath
  if (typeof filePath !== 'string'
    || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]{1,180}$/i.test(filePath)
    || !filePath.startsWith(`${projectId}/`)
    || typeof input.mimeType !== 'string'
    || !ACCEPTED_TYPES.has(input.mimeType)) {
    return errorResponse('Invalid quote file details.', 400)
  }

  const { data: file, error: downloadError } = await result.context.adminClient.storage
    .from(QUOTE_BUCKET)
    .download(filePath)
  if (downloadError || !file) return errorResponse(`Unable to read the private quote upload: ${downloadError?.message || 'File not found.'}`, 404)
  if (file.size === 0 || file.size > MAX_FILE_SIZE) return errorResponse('Quote file must be between 1 byte and 20 MB.', 400)
  if (file.type && file.type !== input.mimeType) return errorResponse('The uploaded file type does not match the selected file type.', 400)

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
    const quotedTotal = extractTotal(response.document?.entities || [], response.document?.text || '')
    return NextResponse.json({ quotedTotal })
  } catch (error) {
    return errorResponse(`Google Document AI could not process this quote: ${error instanceof Error ? error.message : 'Unexpected processing error.'}`, 502)
  } finally {
    await client.close()
  }
}
