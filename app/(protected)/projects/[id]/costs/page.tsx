'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

const INVOICE_BUCKET = 'project-invoices'
const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

interface Supplier {
  id: string
  company_name: string
  is_active: boolean | null
}

interface InvoiceItem {
  id: string
  item_number: number | null
  description: string
  quantity: number | null
  unit: string
  unit_price: number
  actual_line_cost: number | null
  line_total: number | null
}

interface Invoice {
  id: string
  supplier_id: string | null
  vendor_name: string
  invoice_number: string | null
  invoice_date: string
  invoice_total: number
  notes: string | null
  file_path: string
  file_name: string
  file_mime_type: string
  status: 'POSTED' | 'VOID'
  created_at: string
  void_reason: string | null
  material_invoice_items: InvoiceItem[]
}

interface InvoiceHeaderDraft {
  supplierId: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceTotal: string
  notes: string
}

interface DraftInvoiceItem {
  description: string
  quantity: string
  unit: string
  unit_price: string
  actual_line_cost?: string
  isTax?: boolean
}

interface ExtractedInvoice {
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceTotal: string
  items: Array<{
    item_number: number
    description: string
    quantity: string
    quantityEstimated: boolean
    unit: string
    unit_price: string
    actual_line_cost?: string
    isTax?: boolean
  }>
}

interface SavedInvoiceDraft {
  version: 1
  filePath: string
  fileName: string
  mimeType: string
  extracted: boolean
  supplierId: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceTotal: string
  invoiceNotes: string
  extractionWarnings: string[]
  draftItems: DraftInvoiceItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDraftInvoiceItem(value: unknown): value is DraftInvoiceItem {
  return isRecord(value)
    && typeof value.description === 'string'
    && typeof value.quantity === 'string'
    && typeof value.unit === 'string'
    && typeof value.unit_price === 'string'
    && (value.actual_line_cost === undefined || typeof value.actual_line_cost === 'string')
    && (value.isTax === undefined || typeof value.isTax === 'boolean')
}

function isSavedInvoiceDraft(value: unknown): value is SavedInvoiceDraft {
  return isRecord(value)
    && value.version === 1
    && typeof value.filePath === 'string'
    && typeof value.fileName === 'string'
    && ACCEPTED_TYPES.includes(String(value.mimeType))
    && typeof value.extracted === 'boolean'
    && typeof value.supplierId === 'string'
    && typeof value.vendorName === 'string'
    && typeof value.invoiceNumber === 'string'
    && typeof value.invoiceDate === 'string'
    && typeof value.invoiceTotal === 'string'
    && typeof value.invoiceNotes === 'string'
    && Array.isArray(value.extractionWarnings)
    && value.extractionWarnings.every(warning => typeof warning === 'string')
    && Array.isArray(value.draftItems)
    && value.draftItems.every(isDraftInvoiceItem)
}

function isExtractedInvoice(value: unknown): value is ExtractedInvoice {
  if (!isRecord(value)
    || typeof value.vendorName !== 'string'
    || typeof value.invoiceNumber !== 'string'
    || typeof value.invoiceDate !== 'string'
    || typeof value.invoiceTotal !== 'string'
    || !Array.isArray(value.items)) {
    return false
  }
  return value.items.every(item =>
    isRecord(item)
    && typeof item.item_number === 'number'
    && typeof item.description === 'string'
    && typeof item.quantity === 'string'
    && typeof item.quantityEstimated === 'boolean'
    && typeof item.unit === 'string'
    && typeof item.unit_price === 'string'
    && (item.actual_line_cost === undefined || typeof item.actual_line_cost === 'string')
    && (item.isTax === undefined || typeof item.isTax === 'boolean')
  )
}

function currency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function newDraftItem(): DraftInvoiceItem {
  return { description: '', quantity: '1', unit: 'EA', unit_price: '' }
}

export default function ProjectCostsPage() {
  const params = useParams()
  const projectId = params?.id as string
  const { roles, user } = useAuth()
  const canEditCosts = hasAnyRole(roles, ['ADMIN', 'COST_EDITOR'])
  const canEditInvoiceDetails = hasAnyRole(roles, ['ADMIN', 'RFQ_MANAGER'])
  const isAdmin = hasAnyRole(roles, ['ADMIN'])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftStorageKey = useMemo(
    () => user?.id && projectId ? `invoice-draft:v1:${user.id}:${projectId}` : null,
    [projectId, user?.id]
  )
  const collapsedInvoicesStorageKey = user?.id && projectId
    ? `collapsed-invoices:v1:${user.id}:${projectId}`
    : null
  const [projectName, setProjectName] = useState('')
  const [budgetValue, setBudgetValue] = useState('')
  const [budget, setBudget] = useState<number | null>(null)
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [savingInvoice, setSavingInvoice] = useState(false)
  const [extractingInvoice, setExtractingInvoice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [vendorName, setVendorName] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [invoiceTotal, setInvoiceTotal] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [invoiceFileName, setInvoiceFileName] = useState('')
  const [invoiceMimeType, setInvoiceMimeType] = useState('')
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null)
  const [invoiceExtracted, setInvoiceExtracted] = useState(false)
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([])
  const [draftItems, setDraftItems] = useState<DraftInvoiceItem[]>([newDraftItem()])
  const [totalDifferenceConfirmed, setTotalDifferenceConfirmed] = useState(false)
  const [openingInvoiceId, setOpeningInvoiceId] = useState<string | null>(null)
  const [invoicePreview, setInvoicePreview] = useState<{ invoice: Invoice; url: string } | null>(null)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  const [invoiceHeaderDraft, setInvoiceHeaderDraft] = useState<InvoiceHeaderDraft | null>(null)
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null)
  const [collapsedInvoiceIds, setCollapsedInvoiceIds] = useState<Set<string>>(() => new Set())
  const [restoredCollapsedInvoicesKey, setRestoredCollapsedInvoicesKey] = useState<string | null>(null)
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null)

  const fetchProjectCosts = useCallback(async () => {
    if (!projectId) return
    try {
      const [projectResult, supplierResult, invoiceResult] = await Promise.all([
        supabase.from('projects').select('name, material_budget').eq('id', projectId).single(),
        supabase.from('suppliers').select('id, company_name, is_active').order('company_name', { ascending: true }),
        supabase.from('material_invoices').select('id, supplier_id, vendor_name, invoice_number, invoice_date, invoice_total, notes, file_path, file_name, file_mime_type, status, created_at, void_reason, material_invoice_items(id, item_number, description, quantity, unit, unit_price, actual_line_cost, line_total)').eq('project_id', projectId).order('invoice_date', { ascending: false })
      ])

      const failures = [
        projectResult.error && `project: ${projectResult.error.message}`,
        supplierResult.error && `suppliers: ${supplierResult.error.message}`,
        invoiceResult.error && `invoices: ${invoiceResult.error.message}`
      ].filter(Boolean)

      if (failures.length) {
        setError(`Unable to load project cost data (${failures.join('; ')}).`)
        return
      }

      setProjectName(projectResult.data?.name || '')
      const currentBudget = projectResult.data?.material_budget
      setBudget(currentBudget == null ? null : Number(currentBudget))
      setBudgetValue(currentBudget == null ? '' : String(currentBudget))
      setSuppliers((supplierResult.data || []) as Supplier[])
      setInvoices((invoiceResult.data || []) as unknown as Invoice[])
      setError(null)
    } catch (loadError) {
      setError(`Unable to load project cost data: ${loadError instanceof Error ? loadError.message : 'Unexpected network error.'}`)
    }
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchProjectCosts().finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchProjectCosts])

  useEffect(() => {
    if (!collapsedInvoicesStorageKey) return

    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(collapsedInvoicesStorageKey)
        if (saved) {
          const invoiceIds: unknown = JSON.parse(saved)
          if (!Array.isArray(invoiceIds) || !invoiceIds.every(id => typeof id === 'string')) {
            window.localStorage.removeItem(collapsedInvoicesStorageKey)
            setError('Saved invoice display preferences were invalid and have been cleared.')
          } else {
            setCollapsedInvoiceIds(new Set(invoiceIds))
          }
        } else {
          setCollapsedInvoiceIds(new Set())
        }
      } catch (restoreError) {
        setError(`Unable to restore invoice display preferences: ${restoreError instanceof Error ? restoreError.message : 'Browser storage is unavailable.'}`)
      } finally {
        setRestoredCollapsedInvoicesKey(collapsedInvoicesStorageKey)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [collapsedInvoicesStorageKey])

  useEffect(() => {
    if (!collapsedInvoicesStorageKey || restoredCollapsedInvoicesKey !== collapsedInvoicesStorageKey) return
    try {
      window.localStorage.setItem(collapsedInvoicesStorageKey, JSON.stringify([...collapsedInvoiceIds]))
    } catch (saveError) {
      const message = `Unable to save invoice display preferences: ${saveError instanceof Error ? saveError.message : 'Browser storage is unavailable.'}`
      window.setTimeout(() => setError(message), 0)
    }
  }, [collapsedInvoicesStorageKey, collapsedInvoiceIds, restoredCollapsedInvoicesKey])

  useEffect(() => {
    if (!draftStorageKey) return

    const timer = window.setTimeout(() => {
      try {
        const saved = window.sessionStorage.getItem(draftStorageKey)
        if (saved) {
          const draft: unknown = JSON.parse(saved)
          if (!isSavedInvoiceDraft(draft) || !draft.filePath.startsWith(`${projectId}/`)) {
            window.sessionStorage.removeItem(draftStorageKey)
            setError('The saved invoice draft was invalid and has been cleared. Upload the invoice again to continue.')
          } else {
            setUploadedFilePath(draft.filePath)
            setInvoiceFileName(draft.fileName)
            setInvoiceMimeType(draft.mimeType)
            setInvoiceExtracted(draft.extracted)
            setSupplierId(draft.supplierId)
            setVendorName(draft.vendorName)
            setInvoiceNumber(draft.invoiceNumber)
            setInvoiceDate(draft.invoiceDate)
            setInvoiceTotal(draft.invoiceTotal)
            setInvoiceNotes(draft.invoiceNotes)
            setExtractionWarnings(draft.extractionWarnings)
            setDraftItems(draft.draftItems)
            setNotice(draft.extracted
              ? 'Your invoice draft was restored. Review its details and record it when ready.'
              : 'Your uploaded invoice was restored. Extract its details to continue.')
          }
        }
      } catch (restoreError) {
        setError(`Unable to restore the saved invoice draft: ${restoreError instanceof Error ? restoreError.message : 'Browser storage is unavailable.'}`)
      } finally {
        setRestoredDraftKey(draftStorageKey)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [draftStorageKey, projectId])

  useEffect(() => {
    if (!draftStorageKey || restoredDraftKey !== draftStorageKey) return
    try {
      if (!uploadedFilePath) {
        window.sessionStorage.removeItem(draftStorageKey)
        return
      }
      const draft: SavedInvoiceDraft = {
        version: 1,
        filePath: uploadedFilePath,
        fileName: invoiceFileName,
        mimeType: invoiceMimeType,
        extracted: invoiceExtracted,
        supplierId,
        vendorName,
        invoiceNumber,
        invoiceDate,
        invoiceTotal,
        invoiceNotes,
        extractionWarnings,
        draftItems
      }
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify(draft))
    } catch (saveDraftError) {
      const message = `Unable to preserve the invoice draft in this browser tab: ${saveDraftError instanceof Error ? saveDraftError.message : 'Browser storage is unavailable.'}`
      window.setTimeout(() => setError(message), 0)
    }
  }, [
    draftStorageKey,
    restoredDraftKey,
    uploadedFilePath,
    invoiceFileName,
    invoiceMimeType,
    invoiceExtracted,
    supplierId,
    vendorName,
    invoiceNumber,
    invoiceDate,
    invoiceTotal,
    invoiceNotes,
    extractionWarnings,
    draftItems
  ])

  const postedExpenses = useMemo(
    () => invoices.filter(invoice => invoice.status === 'POSTED').reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0),
    [invoices]
  )
  const remainingBudget = budget == null ? null : budget - postedExpenses
  const budgetUsagePercent = budget != null && budget > 0 ? (postedExpenses / budget) * 100 : 0
  const budgetBarWidth = budget == null
    ? 0
    : budget > 0
      ? Math.min(budgetUsagePercent, 100)
      : postedExpenses > 0 ? 100 : 0
  const draftLineTotal = useMemo(
    () => draftItems.reduce((sum, item) => {
      const quantity = Number(item.quantity)
      const price = Number(item.unit_price)
      const actualLineCost = item.actual_line_cost?.trim() ? Number(item.actual_line_cost) : null
      if (actualLineCost != null && Number.isFinite(actualLineCost) && actualLineCost >= 0) return sum + actualLineCost
      return sum + (Number.isFinite(quantity) && quantity >= 0 && Number.isFinite(price) && price >= 0 ? quantity * price : 0)
    }, 0),
    [draftItems]
  )
  const enteredInvoiceTotal = invoiceTotal.trim() ? Number(invoiceTotal) : null
  const totalDifference = enteredInvoiceTotal != null && Number.isFinite(enteredInvoiceTotal)
    ? Math.abs(enteredInvoiceTotal - draftLineTotal)
    : 0
  const supplierById = useMemo(() => new Map(suppliers.map(supplier => [supplier.id, supplier.company_name])), [suppliers])

  function handleSupplierChange(id: string) {
    setSupplierId(id)
    if (id) setVendorName(supplierById.get(id) || '')
  }

  function updateDraftItem(index: number, field: keyof DraftInvoiceItem, value: string) {
    setDraftItems(current => current.map((item, currentIndex) => {
      if (currentIndex !== index) return item
      const updated = { ...item, [field]: value }
      if (field === 'quantity' && item.actual_line_cost) {
        const quantity = Number(value)
        const actualLineCost = Number(item.actual_line_cost)
        updated.unit_price = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(actualLineCost)
          ? (actualLineCost / quantity).toFixed(2)
          : ''
      } else if (field === 'unit_price') {
        delete updated.actual_line_cost
      }
      return updated
    }))
    if (field === 'quantity' || field === 'unit_price') setTotalDifferenceConfirmed(false)
  }

  function addDraftItem() {
    setDraftItems(current => [...current, newDraftItem()])
  }

  function addSalesTaxLine() {
    setDraftItems(current => current.some(item => item.isTax)
      ? current
      : [...current, {
        ...newDraftItem(),
        description: 'Sales tax',
        unit: 'TAX',
        isTax: true
      }])
    setTotalDifferenceConfirmed(false)
  }

  function removeDraftItem(index: number) {
    setDraftItems(current => current.filter((_, currentIndex) => currentIndex !== index))
    setTotalDifferenceConfirmed(false)
  }

  async function getAccessToken() {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw new Error(`Unable to verify your sign-in: ${sessionError.message}`)
    if (!data.session?.access_token) throw new Error('Sign in again before uploading an invoice.')
    return data.session.access_token
  }

  async function handleExtractInvoice() {
    setError(null)
    setNotice(null)
    if (!canEditCosts) {
      setError('Only administrators and cost editors may upload invoices.')
      return
    }
    if (!uploadedFilePath && !invoiceFile) {
      setError('Choose an invoice PDF or image first.')
      return
    }
    if (!uploadedFilePath && invoiceFile
      && (!ACCEPTED_TYPES.includes(invoiceFile.type) || invoiceFile.size === 0 || invoiceFile.size > MAX_FILE_SIZE)) {
      setError('Invoice files must be a non-empty PDF, JPEG, PNG, or WebP no larger than 20 MB.')
      return
    }

    setExtractingInvoice(true)
    try {
      const accessToken = await getAccessToken()
      let filePath = uploadedFilePath
      let fileName = invoiceFileName
      let mimeType = invoiceMimeType

      if (!filePath && invoiceFile) {
        const uploadUrlResponse = await fetch(`/api/projects/${projectId}/invoices/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: invoiceFile.name, mimeType: invoiceFile.type, size: invoiceFile.size })
        })
        const uploadUrlData: unknown = await uploadUrlResponse.json()
        if (!uploadUrlResponse.ok || !isRecord(uploadUrlData)
          || typeof uploadUrlData.filePath !== 'string' || typeof uploadUrlData.token !== 'string') {
          const message = isRecord(uploadUrlData) && typeof uploadUrlData.error === 'string'
            ? uploadUrlData.error
            : 'Unable to prepare the private invoice upload.'
          throw new Error(message)
        }

        filePath = uploadUrlData.filePath
        fileName = invoiceFile.name
        mimeType = invoiceFile.type
        const { error: uploadError } = await supabase.storage
          .from(INVOICE_BUCKET)
          .uploadToSignedUrl(filePath, uploadUrlData.token, invoiceFile, {
            contentType: mimeType,
            upsert: false
          })
        if (uploadError) throw new Error(`Unable to upload invoice file: ${uploadError.message}`)
        setUploadedFilePath(filePath)
        setInvoiceFileName(fileName)
        setInvoiceMimeType(mimeType)
        setInvoiceExtracted(false)
        setInvoiceFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }

      if (!filePath || !fileName || !ACCEPTED_TYPES.includes(mimeType)) {
        throw new Error('The saved invoice upload is missing valid file details. Discard it and upload the invoice again.')
      }

      const extractionResponse = await fetch(`/api/projects/${projectId}/invoices/extract`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          fileName,
          mimeType
        })
      })
      const extractionData: unknown = await extractionResponse.json()
      if (!extractionResponse.ok || !isRecord(extractionData) || !isExtractedInvoice(extractionData.extracted)) {
        const message = isRecord(extractionData) && typeof extractionData.error === 'string'
          ? extractionData.error
          : 'Unable to extract invoice details.'
        throw new Error(message)
      }

      const extracted = extractionData.extracted
      const matchingSupplier = suppliers.find(supplier =>
        supplier.company_name.trim().toLowerCase() === extracted.vendorName.trim().toLowerCase()
      )
      setSupplierId(matchingSupplier?.id || '')
      setVendorName(extracted.vendorName)
      setInvoiceNumber(extracted.invoiceNumber)
      setInvoiceDate(extracted.invoiceDate)
      setInvoiceTotal(extracted.invoiceTotal)
      setInvoiceNotes('')
      setDraftItems(extracted.items.map(item => {
        return {
          description: item.description,
          quantity: item.quantity,
          unit: item.unit || 'EA',
          unit_price: item.unit_price,
          ...(item.actual_line_cost ? { actual_line_cost: item.actual_line_cost } : {}),
          ...(item.isTax ? { isTax: true } : {})
        }
      }))
      setUploadedFilePath(filePath)
      setInvoiceFileName(fileName)
      setInvoiceMimeType(mimeType)
      setInvoiceExtracted(true)
      setExtractionWarnings(Array.isArray(extractionData.warnings)
        ? extractionData.warnings.filter((warning): warning is string => typeof warning === 'string')
        : [])
      setTotalDifferenceConfirmed(false)
      setNotice('Invoice extracted. Review the detected details and actual line costs before recording it.')
    } catch (extractError) {
      setError(`${extractError instanceof Error ? extractError.message : 'Unexpected invoice extraction error.'} The uploaded file is kept so you can retry without uploading again.`)
    } finally {
      setExtractingInvoice(false)
    }
  }

  async function handleDiscardInvoice() {
    if (!uploadedFilePath) return
    setError(null)
    try {
      const accessToken = await getAccessToken()
      const response = await fetch(`/api/projects/${projectId}/invoices/upload`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: uploadedFilePath })
      })
      const responseData: unknown = response.status === 204 ? null : await response.json()
      if (!response.ok) {
        const message = isRecord(responseData) && typeof responseData.error === 'string'
          ? responseData.error
          : 'Unable to discard the uploaded invoice.'
        setError(message)
        return
      }
      setUploadedFilePath(null)
      setInvoiceFileName('')
      setInvoiceMimeType('')
      setInvoiceExtracted(false)
      setExtractionWarnings([])
      setInvoiceFile(null)
      setSupplierId('')
      setVendorName('')
      setInvoiceNumber('')
      setInvoiceDate('')
      setInvoiceTotal('')
      setInvoiceNotes('')
      setDraftItems([newDraftItem()])
      setTotalDifferenceConfirmed(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (discardError) {
      setError(`Unable to discard the uploaded invoice: ${discardError instanceof Error ? discardError.message : 'Unexpected network error.'}`)
    }
  }

  async function handleSaveBudget(event: React.FormEvent) {
    event.preventDefault()
    if (!canEditCosts) return

    let newBudget: number | null = null
    if (budgetValue.trim()) {
      newBudget = Number(budgetValue)
      if (!Number.isFinite(newBudget) || newBudget < 0) {
        setError('Enter a valid non-negative material budget, or leave it blank to mark it as not set.')
        return
      }
    }

    setBudgetSaving(true)
    setError(null)
    setNotice(null)
    try {
      const { error: saveError } = await supabase.rpc('set_project_material_budget', {
        p_project_id: projectId,
        p_material_budget: newBudget
      })

      if (saveError) {
        setError(`Unable to save the material budget: ${saveError.message}`)
        return
      }
      setBudget(newBudget)
      setBudgetValue(newBudget == null ? '' : String(newBudget))
      setNotice('Project material budget saved.')
    } catch (saveError) {
      setError(`Unable to save the material budget: ${saveError instanceof Error ? saveError.message : 'Unexpected network error.'}`)
    } finally {
      setBudgetSaving(false)
    }
  }

  async function handleSaveInvoice(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (!canEditCosts) {
      setError('Only administrators and cost editors may record invoices.')
      return
    }
    if (!uploadedFilePath || !invoiceFileName || !invoiceMimeType || !invoiceExtracted) {
      setError('Upload and extract the invoice before recording it.')
      return
    }
    if (!vendorName.trim()) {
      setError('Enter the vendor name shown on the invoice.')
      return
    }
    const parsedInvoiceTotal = Number(invoiceTotal)
    if (!invoiceTotal.trim() || !Number.isFinite(parsedInvoiceTotal) || parsedInvoiceTotal < 0) {
      setError('Enter a valid non-negative invoice total.')
      return
    }
    if (!invoiceDate) {
      setError('Enter the invoice date.')
      return
    }
    if (draftItems.length === 0) {
      setError('Add at least one purchased material line item.')
      return
    }

    const parsedItems: Array<{
      source_material_id: string | null
      item_number: number
      description: string
      quantity: number | null
      unit: string
      unit_price: number
      actual_line_cost: number | null
    }> = []
    for (const [index, item] of draftItems.entries()) {
      const quantity = item.quantity.trim() ? Number(item.quantity) : null
      const actualLineCost = item.actual_line_cost?.trim() ? Number(item.actual_line_cost) : null
      const enteredUnitPrice = Number(item.unit_price)
      const hasValidActualLineCost = actualLineCost != null && Number.isFinite(actualLineCost) && actualLineCost >= 0
      const unitPrice = hasValidActualLineCost && quantity != null && quantity > 0
        ? Number((actualLineCost / quantity).toFixed(2))
        : enteredUnitPrice
      if (!item.description.trim() || (quantity != null && (!Number.isFinite(quantity) || quantity < 0)) || !item.unit.trim()
        || (!hasValidActualLineCost && (!item.unit_price.trim() || !Number.isFinite(unitPrice) || unitPrice < 0))) {
        setError(`Complete the description and unit for invoice line ${index + 1}; enter a non-negative quantity if known, and a unit cost if no actual line cost was extracted.`)
        return
      }
      parsedItems.push({
        source_material_id: null,
        item_number: index + 1,
        description: item.description.trim(),
        quantity,
        unit: item.unit.trim(),
        unit_price: unitPrice,
        actual_line_cost: hasValidActualLineCost ? actualLineCost : null
      })
    }

    if (totalDifference > 0.01 && !totalDifferenceConfirmed) {
      setError('The invoice total differs from the line-item sum. Review the difference and check the confirmation box before saving.')
      return
    }

    setSavingInvoice(true)
    try {
      const { error: insertError } = await supabase.rpc('create_material_invoice', {
        p_project_id: projectId,
        p_supplier_id: supplierId || null,
        p_vendor_name: vendorName.trim(),
        p_invoice_number: invoiceNumber.trim() || null,
        p_invoice_date: invoiceDate,
        p_invoice_total: parsedInvoiceTotal,
        p_notes: invoiceNotes.trim() || null,
        p_file_path: uploadedFilePath,
        p_file_name: invoiceFileName,
        p_file_mime_type: invoiceMimeType,
        p_items: parsedItems
      })

      if (insertError) {
        setError(`Unable to save the invoice record: ${insertError.message}`)
        return
      }

      setNotice('Invoice recorded. Its total is counted once against the project material budget.')
      setSupplierId('')
      setVendorName('')
      setInvoiceNumber('')
      setInvoiceDate('')
      setInvoiceTotal('')
      setInvoiceNotes('')
      setInvoiceFile(null)
      setInvoiceFileName('')
      setInvoiceMimeType('')
      setUploadedFilePath(null)
      setInvoiceExtracted(false)
      setExtractionWarnings([])
      setDraftItems([newDraftItem()])
      setTotalDifferenceConfirmed(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await fetchProjectCosts()
    } catch (saveError) {
      setError(`Unable to save the invoice: ${saveError instanceof Error ? saveError.message : 'Unexpected network error.'}`)
    } finally {
      setSavingInvoice(false)
    }
  }

  async function handleOpenInvoice(invoice: Invoice) {
    setOpeningInvoiceId(invoice.id)
    setError(null)
    try {
      const accessToken = await getAccessToken()
      const response = await fetch(`/api/projects/${projectId}/invoices/preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ invoiceId: invoice.id })
      })
      const responseData: unknown = await response.json()
      if (!response.ok || !isRecord(responseData) || typeof responseData.signedUrl !== 'string') {
        const message = isRecord(responseData) && typeof responseData.error === 'string'
          ? responseData.error
          : 'Unable to create an invoice preview link.'
        setError(`Unable to preview invoice file: ${message}`)
        return
      }
      setInvoicePreview({ invoice, url: responseData.signedUrl })
    } catch (openError) {
      setError(`Unable to preview invoice file: ${openError instanceof Error ? openError.message : 'Unexpected network error.'}`)
    } finally {
      setOpeningInvoiceId(null)
    }
  }

  async function handleVoidInvoice(invoice: Invoice) {
    const reason = window.prompt(`Why are you voiding invoice ${invoice.invoice_number || invoice.file_name}? The file and record will be kept, but the invoice total will no longer count against the budget.`)
    if (reason == null) return
    if (!reason.trim()) {
      setError('Enter a reason to void the invoice.')
      return
    }
    setError(null)
    setNotice(null)
    try {
      const { error: voidError } = await supabase
        .from('material_invoices')
        .update({ status: 'VOID', void_reason: reason.trim() })
        .eq('id', invoice.id)
        .select('id')
        .single()
      if (voidError) {
        setError(`Unable to void invoice: ${voidError.message}`)
        return
      }
      setInvoices(current => current.map(item => item.id === invoice.id
        ? { ...item, status: 'VOID', void_reason: reason.trim() }
        : item))
      setNotice('Invoice voided. It remains in the history and no longer counts against the budget.')
    } catch (voidError) {
      setError(`Unable to void invoice: ${voidError instanceof Error ? voidError.message : 'Unexpected network error.'}`)
    }
  }

  function startEditingInvoice(invoice: Invoice) {
    setEditingInvoiceId(invoice.id)
    setInvoiceHeaderDraft({
      supplierId: invoice.supplier_id || '',
      vendorName: invoice.vendor_name,
      invoiceNumber: invoice.invoice_number || '',
      invoiceDate: invoice.invoice_date,
      invoiceTotal: String(invoice.invoice_total),
      notes: invoice.notes || ''
    })
    setError(null)
    setNotice(null)
  }

  async function handleSaveInvoiceHeader(event: React.FormEvent, invoice: Invoice) {
    event.preventDefault()
    if (!invoiceHeaderDraft || !canEditInvoiceDetails) return
    const parsedTotal = Number(invoiceHeaderDraft.invoiceTotal)
    if (!invoiceHeaderDraft.vendorName.trim()) {
      setError('Enter the vendor name shown on the invoice.')
      return
    }
    if (!invoiceHeaderDraft.invoiceDate) {
      setError('Enter the invoice date.')
      return
    }
    if (!invoiceHeaderDraft.invoiceTotal.trim() || !Number.isFinite(parsedTotal) || parsedTotal < 0) {
      setError('Enter a valid non-negative invoice total.')
      return
    }

    setError(null)
    setNotice(null)
    try {
      const { data, error: updateError } = await supabase
        .from('material_invoices')
        .update({
          supplier_id: invoiceHeaderDraft.supplierId || null,
          vendor_name: invoiceHeaderDraft.vendorName.trim(),
          invoice_number: invoiceHeaderDraft.invoiceNumber.trim() || null,
          invoice_date: invoiceHeaderDraft.invoiceDate,
          invoice_total: parsedTotal,
          notes: invoiceHeaderDraft.notes.trim() || null
        })
        .eq('id', invoice.id)
        .eq('project_id', projectId)
        .eq('status', 'POSTED')
        .select('id')
        .single()

      if (updateError || !data) {
        setError(`Unable to update invoice details: ${updateError?.message || 'Invoice was not found or is no longer posted.'}`)
        return
      }

      setInvoices(current => current.map(item => item.id === invoice.id
        ? {
            ...item,
            supplier_id: invoiceHeaderDraft.supplierId || null,
            vendor_name: invoiceHeaderDraft.vendorName.trim(),
            invoice_number: invoiceHeaderDraft.invoiceNumber.trim() || null,
            invoice_date: invoiceHeaderDraft.invoiceDate,
            invoice_total: parsedTotal,
            notes: invoiceHeaderDraft.notes.trim() || null
          }
        : item))
      setEditingInvoiceId(null)
      setInvoiceHeaderDraft(null)
      setNotice('Invoice details updated.')
    } catch (updateError) {
      setError(`Unable to update invoice details: ${updateError instanceof Error ? updateError.message : 'Unexpected network error.'}`)
    }
  }

  async function handleDeleteInvoice(invoice: Invoice) {
    if (!isAdmin) return
    if (!confirm(`Permanently delete invoice ${invoice.invoice_number || invoice.file_name} and its uploaded file? This cannot be undone.`)) return

    setDeletingInvoiceId(invoice.id)
    setError(null)
    setNotice(null)
    try {
      const accessToken = await getAccessToken()
      const response = await fetch(`/api/projects/${projectId}/invoices/${invoice.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const responseData: unknown = await response.json()
      if (!response.ok || !isRecord(responseData) || responseData.deleted !== true) {
        const message = isRecord(responseData) && typeof responseData.error === 'string'
          ? responseData.error
          : 'Unable to delete invoice.'
        setError(message)
        return
      }

      setInvoices(current => current.filter(item => item.id !== invoice.id))
      setEditingInvoiceId(null)
      setInvoiceHeaderDraft(null)
      if (invoicePreview?.invoice.id === invoice.id) setInvoicePreview(null)
      setNotice(typeof responseData.warning === 'string'
        ? responseData.warning
        : 'Invoice and its uploaded file deleted.')
    } catch (deleteError) {
      setError(`Unable to delete invoice: ${deleteError instanceof Error ? deleteError.message : 'Unexpected network error.'}`)
    } finally {
      setDeletingInvoiceId(null)
    }
  }

  function toggleInvoiceCollapsed(invoiceId: string) {
    setCollapsedInvoiceIds(current => {
      const next = new Set(current)
      if (next.has(invoiceId)) next.delete(invoiceId)
      else next.add(invoiceId)
      return next
    })
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-sm font-semibold text-blue-600 hover:underline">← Back to project takeoff</Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-800">Material budget & invoices</h1>
          <p className="mt-1 text-sm text-gray-600">{projectName || 'Project'} · Invoice totals count as expenses; invoice lines are detail only.</p>
        </div>
        <Link href={`/projects/${projectId}/quotes`} className="rounded border bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">Vendor quotes</Link>
      </div>

      {error && <p role="alert" className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {invoicePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setInvoicePreview(null)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-preview-title"
            className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 id="invoice-preview-title" className="truncate text-sm font-semibold text-gray-800">
                  {invoicePreview.invoice.file_name}
                </h2>
                <p className="text-xs text-gray-500">
                  {invoicePreview.invoice.vendor_name}
                  {invoicePreview.invoice.invoice_number ? ` · Invoice ${invoicePreview.invoice.invoice_number}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={invoicePreview.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Open in new tab
                </a>
                <button
                  type="button"
                  onClick={() => setInvoicePreview(null)}
                  aria-label="Close invoice preview"
                  className="rounded border px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </header>
            <iframe
              title={`Invoice preview: ${invoicePreview.invoice.file_name}`}
              src={invoicePreview.url}
              className="min-h-0 flex-1 bg-gray-100"
            />
          </section>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-gray-500">Loading budget and invoices…</p>
      ) : (
        <>
          <section className="mb-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase text-gray-500">Material budget</p>
              <p className="mt-1 text-xl font-bold text-gray-800">{budget == null ? 'Not set' : currency(budget)}</p>
              {canEditCosts ? (
                <form onSubmit={handleSaveBudget} className="mt-2 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={budgetValue}
                    onChange={event => setBudgetValue(event.target.value)}
                    aria-label="Manual material budget"
                    placeholder="Enter budget"
                    className="min-w-0 flex-1 rounded border px-2 py-1.5 text-sm"
                  />
                  <button disabled={budgetSaving} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                    {budgetSaving ? 'Saving…' : 'Save'}
                  </button>
                </form>
              ) : <p className="mt-1 text-xs text-gray-500">Only Admins and Cost Editors can change the budget.</p>}
            </div>
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase text-gray-500">Invoice expenses</p>
              <p className="mt-1 text-xl font-bold text-gray-800">{currency(postedExpenses)}</p>
              <p className="mt-1 text-xs text-gray-500">Posted invoice totals only; line items are not added separately.</p>
            </div>
            <div className={`rounded-xl border p-3 shadow-sm ${remainingBudget != null && remainingBudget < 0 ? 'border-red-200 bg-red-50' : 'bg-white'}`}>
              <p className="text-xs font-semibold uppercase text-gray-500">Budget remaining</p>
              <p className={`mt-1 text-xl font-bold ${remainingBudget != null && remainingBudget < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                {remainingBudget == null ? 'Set a budget' : currency(remainingBudget)}
              </p>
              {remainingBudget != null && <p className="mt-1 text-xs text-gray-500">{budget === 0 ? 'Budget is zero.' : `${((postedExpenses / (budget || 1)) * 100).toFixed(1)}% of budget spent`}</p>}
            </div>
          </section>

          <section aria-labelledby="budget-expenses-heading" className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="budget-expenses-heading" className="text-base font-semibold text-gray-800">Budget vs. expenses</h2>
                <p className="mt-1 text-xs text-gray-500">Posted invoice totals compared with the manual material budget.</p>
              </div>
              {budget != null && budget > 0 && (
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                  {budgetUsagePercent.toFixed(1)}% used
                </span>
              )}
            </div>

            {budget == null ? (
              <p className="mt-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
                Set a material budget above to compare it with posted invoice expenses.
              </p>
            ) : (
              <>
                <div className="mt-4" role="group" aria-label="Posted expenses as a proportion of the material budget">
                  <div
                    role="progressbar"
                    aria-label="Material budget spent"
                    aria-valuemin={0}
                    aria-valuemax={budget > 0 ? budget : 1}
                    aria-valuenow={budget > 0
                      ? Math.min(postedExpenses, budget)
                      : postedExpenses > 0 ? 1 : 0}
                    aria-valuetext={budget === 0
                      ? `${currency(postedExpenses)} expenses against a ${currency(budget)} budget`
                      : `${currency(postedExpenses)} of ${currency(budget)} spent`}
                    className={`h-3 overflow-hidden rounded-full ${
                      budget === 0 && postedExpenses === 0 ? 'bg-gray-100' : 'bg-emerald-500'
                    }`}
                  >
                    <div
                      className="h-full rounded-full bg-red-600 transition-[width] duration-500"
                      style={{ width: `${budgetBarWidth}%` }}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-x-5 gap-y-2 text-sm">
                  <div className="flex items-center">
                    <span aria-hidden="true" className="mr-2 h-2.5 w-2.5 rounded-full bg-red-600" />
                    <span className="text-gray-500">Expenses</span>
                    <span className="ml-2 font-semibold text-gray-800">{currency(postedExpenses)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Budget</span>
                    <span className="ml-2 font-semibold text-gray-800">{currency(budget)}</span>
                  </div>
                  <div className="flex items-center sm:text-right">
                    {remainingBudget != null && remainingBudget >= 0 && (
                      <span aria-hidden="true" className="mr-2 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    )}
                    <span className="text-gray-500">{remainingBudget != null && remainingBudget < 0 ? 'Over budget' : 'Remaining'}</span>
                    <span className={`ml-2 font-semibold ${remainingBudget != null && remainingBudget < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                      {currency(Math.abs(remainingBudget ?? 0))}
                    </span>
                  </div>
                </div>
                {budget === 0 && (
                  <p className={`mt-3 text-xs ${postedExpenses > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                    {postedExpenses > 0 ? 'Expenses exceed the zero-dollar budget.' : 'Budget is zero; any expense will exceed it.'}
                  </p>
                )}
              </>
            )}
          </section>

          {canEditCosts && (
            <section className="mb-8 rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">Record a material invoice</h2>
              <p className="mt-1 text-xs text-gray-500">Upload a PDF or image to extract invoice details and line items with Google Document AI. We use each invoice line amount as its actual cost; missing quantities may be left blank. Only the invoice total counts as the project expense.</p>
              <div className="mt-5 space-y-5">
                {!uploadedFilePath ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="min-w-64 flex-1 text-sm font-medium text-gray-700">
                      Invoice PDF or image
                      <input
                        ref={fileInputRef}
                        required
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                        onChange={event => setInvoiceFile(event.target.files?.[0] || null)}
                        className="mt-1 block w-full rounded border p-2 text-sm"
                      />
                      <span className="mt-1 block text-xs font-normal text-gray-500">PDF, JPEG, PNG, or WebP; up to 20 MB.</span>
                    </label>
                    <button
                      type="button"
                      disabled={extractingInvoice || !invoiceFile}
                      onClick={() => void handleExtractInvoice()}
                      className="rounded bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {extractingInvoice ? 'Uploading and extracting…' : 'Upload and extract'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                    <span>{invoiceExtracted ? 'Uploaded and extracted:' : 'Invoice uploaded; extraction can be retried:'} <strong>{invoiceFileName}</strong></span>
                    <div className="flex gap-2">
                      {!invoiceExtracted && (
                        <button
                          type="button"
                          disabled={extractingInvoice}
                          onClick={() => void handleExtractInvoice()}
                          className="rounded border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                        >
                          {extractingInvoice ? 'Extracting…' : 'Extract details'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={savingInvoice || extractingInvoice}
                        onClick={() => void handleDiscardInvoice()}
                        className="rounded border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                      >
                        Discard and choose another
                      </button>
                    </div>
                  </div>
                )}
                {extractionWarnings.length > 0 && (
                  <div role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-semibold">Please check the extracted information:</p>
                    <ul className="mt-1 list-inside list-disc">
                      {extractionWarnings.map(warning => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              {uploadedFilePath && invoiceExtracted && (
              <form onSubmit={handleSaveInvoice} className="mt-5 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-sm font-medium text-gray-700">
                    Match vendor (optional)
                    <select value={supplierId} onChange={event => handleSupplierChange(event.target.value)} className="mt-1 w-full rounded border bg-white p-2.5">
                      <option value="">No supplier match</option>
                      {suppliers.filter(supplier => supplier.is_active).map(supplier => (
                        <option key={supplier.id} value={supplier.id}>{supplier.company_name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    Vendor name on invoice
                    <input required value={vendorName} onChange={event => setVendorName(event.target.value)} className="mt-1 w-full rounded border p-2.5" />
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    Invoice number
                    <input value={invoiceNumber} onChange={event => setInvoiceNumber(event.target.value)} className="mt-1 w-full rounded border p-2.5" placeholder="Optional" />
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    Invoice date
                    <input required type="date" value={invoiceDate} onChange={event => setInvoiceDate(event.target.value)} className="mt-1 w-full rounded border p-2.5" />
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    Invoice total
                    <input required type="number" min="0" step="0.01" value={invoiceTotal} onChange={event => { setInvoiceTotal(event.target.value); setTotalDifferenceConfirmed(false) }} className="mt-1 w-full rounded border p-2.5" placeholder="Amount charged" />
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-gray-800">Invoice line items</h3>
                      <p className="text-xs text-gray-500">Review material lines and invoice charges such as sales tax.</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={draftItems.some(item => item.isTax)} onClick={addSalesTaxLine} className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-50">
                        {draftItems.some(item => item.isTax) ? 'Sales tax added' : 'Add sales tax'}
                      </button>
                      <button type="button" onClick={addDraftItem} className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700">Add line</button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {draftItems.map((item, index) => {
                      const extractedLineCost = item.actual_line_cost?.trim() ? Number(item.actual_line_cost) : null
                      const calculatedLineTotal = item.quantity.trim()
                        ? Number(item.quantity) * Number(item.unit_price)
                        : Number.NaN
                      const lineTotal = extractedLineCost != null && Number.isFinite(extractedLineCost)
                        ? extractedLineCost
                        : calculatedLineTotal
                      return (
                        <div key={index} className="grid gap-3 rounded-lg border bg-gray-50 p-3 md:grid-cols-9">
                          <label className="text-xs font-medium text-gray-600 md:col-span-4">
                            Invoice description
                            <input required value={item.description} onChange={event => updateDraftItem(index, 'description', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <label className="text-xs font-medium text-gray-600 md:col-span-1">
                            Qty (optional)
                            <input type="number" min="0" step="any" value={item.quantity} onChange={event => updateDraftItem(index, 'quantity', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <label className="text-xs font-medium text-gray-600 md:col-span-1">
                            Unit
                            <input required value={item.unit} onChange={event => updateDraftItem(index, 'unit', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <label className="text-xs font-medium text-gray-600 md:col-span-1">
                            Unit cost
                            <input required={!item.actual_line_cost} type="number" min="0" step="0.01" value={item.unit_price} onChange={event => updateDraftItem(index, 'unit_price', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <div className="flex items-end justify-between gap-2 md:col-span-2">
                            <span className="pb-2 text-sm font-semibold">
                              <span className="block text-[10px] font-medium uppercase text-gray-500">Line cost</span>
                              {Number.isFinite(lineTotal) ? currency(lineTotal) : '—'}
                            </span>
                            <button type="button" disabled={draftItems.length === 1} onClick={() => removeDraftItem(index)} className="mb-1 rounded px-2 py-1 text-xs text-red-700 disabled:opacity-40">Remove</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50 p-3 text-sm">
                    <span>Line-item total: <strong>{currency(draftLineTotal)}</strong></span>
                    <span>Invoice expense: <strong>{enteredInvoiceTotal == null || !Number.isFinite(enteredInvoiceTotal) ? 'Enter invoice total above' : currency(enteredInvoiceTotal)}</strong></span>
                    {enteredInvoiceTotal != null && Number.isFinite(enteredInvoiceTotal) && totalDifference > 0.01 && (
                      <label className="flex w-full items-start gap-2 border-t border-blue-100 pt-3 text-xs text-amber-900">
                        <input type="checkbox" checked={totalDifferenceConfirmed} onChange={event => setTotalDifferenceConfirmed(event.target.checked)} className="mt-0.5" />
                        <span>The invoice total differs from line items by {currency(totalDifference)} (for example, tax or freight). I reviewed it and confirm the invoice total is the amount to count against the budget.</span>
                      </label>
                    )}
                  </div>
                </div>

                <label className="block text-sm font-medium text-gray-700">
                  Notes
                  <textarea rows={2} value={invoiceNotes} onChange={event => setInvoiceNotes(event.target.value)} className="mt-1 w-full rounded border p-2.5" placeholder="Optional notes about this invoice" />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="max-w-2xl text-xs text-gray-500">After you save, the invoice total is posted once as a project expense. Line-item totals are retained for detail and do not add another expense.</p>
                  <button disabled={savingInvoice} className="rounded bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                    {savingInvoice ? 'Saving invoice…' : 'Record extracted invoice'}
                  </button>
                </div>
              </form>
              )}
            </section>
          )}

          <section>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Invoice history</h2>
                <p className="text-xs text-gray-500">Posted invoices count as expenses. Voided invoices remain in history but are excluded from the budget totals.</p>
              </div>
              <span className="text-xs text-gray-500">{invoices.length} invoice{invoices.length === 1 ? '' : 's'}</span>
            </div>
            {invoices.length === 0 ? (
              <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">No material invoices have been recorded for this project.</p>
            ) : (
              <div className="space-y-4">
                {invoices.map(invoice => {
                  const isCollapsed = collapsedInvoiceIds.has(invoice.id)
                  return (
                  <article key={invoice.id} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${invoice.status === 'VOID' ? 'opacity-75' : ''}`}>
                    <header className={isCollapsed
                      ? 'grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-3 p-3'
                      : 'flex flex-wrap items-start justify-between gap-4 p-5'}>
                      <div className={isCollapsed ? 'contents' : ''}>
                        <h3 className={isCollapsed ? 'truncate text-sm font-bold text-gray-800' : 'text-lg font-bold text-gray-800'}>
                          {invoice.supplier_id && supplierById.has(invoice.supplier_id)
                            ? supplierById.get(invoice.supplier_id)
                            : invoice.vendor_name}
                        </h3>
                        <p className={isCollapsed ? 'truncate text-xs text-gray-500' : 'mt-1 text-sm text-gray-500'}>
                          {invoice.invoice_number ? `Invoice ${invoice.invoice_number} · ` : ''}{invoice.invoice_date}
                        </p>
                        {isCollapsed
                          ? <p className="truncate text-xs text-gray-600" title={invoice.notes || 'No notes'}>{invoice.notes || 'No notes'}</p>
                          : invoice.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{invoice.notes}</p>}
                      </div>
                      <div className={isCollapsed ? 'contents' : 'flex items-center gap-4'}>
                        <div className="text-right">
                          {isCollapsed
                            ? <p className={`whitespace-nowrap text-sm font-bold ${invoice.status === 'POSTED' ? 'text-gray-800' : 'text-gray-500 line-through'}`}>
                                {invoice.status === 'POSTED' ? 'Total' : 'Voided'} {currency(Number(invoice.invoice_total))}
                              </p>
                            : <>
                                <p className="text-xs uppercase text-gray-500">{invoice.status === 'POSTED' ? 'Expense total' : 'Voided total'}</p>
                                <p className={`text-xl font-bold ${invoice.status === 'POSTED' ? 'text-gray-800' : 'text-gray-500 line-through'}`}>{currency(Number(invoice.invoice_total))}</p>
                              </>}
                        </div>
                        <button
                          type="button"
                          aria-expanded={!isCollapsed}
                          onClick={() => toggleInvoiceCollapsed(invoice.id)}
                          className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          {isCollapsed ? 'Expand' : 'Collapse'}
                        </button>
                      </div>
                    </header>
                    {!isCollapsed && (
                      <>
                        {editingInvoiceId === invoice.id && invoiceHeaderDraft && (
                          <form onSubmit={event => void handleSaveInvoiceHeader(event, invoice)} className="space-y-3 border-t bg-blue-50/40 p-4">
                            <p className="text-xs font-semibold text-gray-700">Edit invoice header details. Recorded line items and the uploaded file are unchanged.</p>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <label className="text-xs font-medium text-gray-600">
                                Supplier
                                <select
                                  value={invoiceHeaderDraft.supplierId}
                                  onChange={event => setInvoiceHeaderDraft({ ...invoiceHeaderDraft, supplierId: event.target.value })}
                                  className="mt-1 w-full rounded border bg-white p-2 text-sm"
                                >
                                  <option value="">No supplier linked</option>
                                  {suppliers.map(supplier => (
                                    <option key={supplier.id} value={supplier.id}>{supplier.company_name}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-xs font-medium text-gray-600">
                                Vendor name on invoice
                                <input
                                  required
                                  value={invoiceHeaderDraft.vendorName}
                                  onChange={event => setInvoiceHeaderDraft({ ...invoiceHeaderDraft, vendorName: event.target.value })}
                                  className="mt-1 w-full rounded border bg-white p-2 text-sm"
                                />
                              </label>
                              <label className="text-xs font-medium text-gray-600">
                                Invoice number
                                <input
                                  value={invoiceHeaderDraft.invoiceNumber}
                                  onChange={event => setInvoiceHeaderDraft({ ...invoiceHeaderDraft, invoiceNumber: event.target.value })}
                                  className="mt-1 w-full rounded border bg-white p-2 text-sm"
                                />
                              </label>
                              <label className="text-xs font-medium text-gray-600">
                                Invoice date
                                <input
                                  required
                                  type="date"
                                  value={invoiceHeaderDraft.invoiceDate}
                                  onChange={event => setInvoiceHeaderDraft({ ...invoiceHeaderDraft, invoiceDate: event.target.value })}
                                  className="mt-1 w-full rounded border bg-white p-2 text-sm"
                                />
                              </label>
                              <label className="text-xs font-medium text-gray-600">
                                Invoice total
                                <input
                                  required
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={invoiceHeaderDraft.invoiceTotal}
                                  onChange={event => setInvoiceHeaderDraft({ ...invoiceHeaderDraft, invoiceTotal: event.target.value })}
                                  className="mt-1 w-full rounded border bg-white p-2 text-sm"
                                />
                              </label>
                              <label className="text-xs font-medium text-gray-600 sm:col-span-2 lg:col-span-1">
                                Notes
                                <input
                                  value={invoiceHeaderDraft.notes}
                                  onChange={event => setInvoiceHeaderDraft({ ...invoiceHeaderDraft, notes: event.target.value })}
                                  className="mt-1 w-full rounded border bg-white p-2 text-sm"
                                />
                              </label>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => { setEditingInvoiceId(null); setInvoiceHeaderDraft(null) }}
                                className="rounded border bg-white px-3 py-1.5 text-xs font-semibold text-gray-700"
                              >
                                Cancel
                              </button>
                              <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                                Save invoice
                              </button>
                            </div>
                          </form>
                        )}
                        <div className="flex flex-wrap items-start justify-between gap-4 border-t p-5">
                          <div>
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${invoice.status === 'POSTED' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{invoice.status}</span>
                            <p className="mt-2 text-xs text-gray-500">{invoice.file_name} · {invoice.material_invoice_items?.length || 0} line{invoice.material_invoice_items?.length === 1 ? '' : 's'}</p>
                            {invoice.status === 'VOID' && invoice.void_reason && <p className="mt-2 text-xs text-gray-600">Void reason: {invoice.void_reason}</p>}
                          </div>
                          <div className="text-right">
                            <div className="mt-3 flex justify-end gap-2">
                              <button disabled={openingInvoiceId === invoice.id} onClick={() => void handleOpenInvoice(invoice)} className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-50">
                                {openingInvoiceId === invoice.id ? 'Opening…' : 'View invoice file'}
                              </button>
                              {canEditInvoiceDetails && invoice.status === 'POSTED' && editingInvoiceId !== invoice.id && (
                                <button onClick={() => startEditingInvoice(invoice)} className="rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700">
                                  Edit invoice
                                </button>
                              )}
                              {canEditCosts && invoice.status === 'POSTED' && (
                                <button onClick={() => void handleVoidInvoice(invoice)} className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">
                                  Void invoice
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  disabled={deletingInvoiceId === invoice.id}
                                  onClick={() => void handleDeleteInvoice(invoice)}
                                  className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                                >
                                  {deletingInvoiceId === invoice.id ? 'Deleting…' : 'Delete invoice'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[600px] text-left text-sm">
                            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                              <tr><th className="p-3">#</th><th className="p-3">Item / charge</th><th className="p-3">Quantity</th><th className="p-3">Unit cost</th><th className="p-3 text-right">Actual line cost</th></tr>
                            </thead>
                            <tbody className="divide-y">
                              {(invoice.material_invoice_items || []).map((item, index) => (
                                <tr key={item.id}>
                                  <td className="p-3 text-gray-500">{item.item_number ?? index + 1}</td>
                                  <td className="p-3 font-medium text-gray-800">{item.description}</td>
                                  <td className="p-3">{item.quantity == null ? '—' : `${item.quantity} ${item.unit}`}</td>
                                  <td className="p-3">{currency(Number(item.unit_price))}</td>
                                  <td className="p-3 text-right font-semibold">{item.line_total == null ? '—' : currency(Number(item.line_total))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </article>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
