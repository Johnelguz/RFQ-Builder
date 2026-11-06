'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

const QUOTE_BUCKET = 'project-vendor-quotes'
const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const QUOTE_CATEGORIES = ['General', 'Panelboards', 'Lighting', 'Switchgear', 'Wiring', 'Fire Alarm', 'Other']

interface Material {
  id: string
  item_number: number | null
  quantity: number
  unit: string
  description: string
  manufacturer: string | null
  model_number: string | null
  sheet_reference: string | null
  notes: string | null
}

interface Supplier {
  id: string
  company_name: string
  is_active: boolean | null
}

interface QuoteItem {
  id: string
  source_material_id: string | null
  item_number: number | null
  quantity: number
  unit: string
  description: string
  manufacturer: string | null
  model_number: string | null
  sheet_reference: string | null
  notes: string | null
  quoted_unit_price: number | null
}

interface VendorQuote {
  id: string
  project_id: string
  supplier_id: string | null
  supplier_name: string | null
  quote_reference: string | null
  material_category: string
  quoted_total: number | null
  file_path: string | null
  file_name: string | null
  file_mime_type: string | null
  quoted_date: string
  notes: string | null
  freight: number
  tax: number
  other_charges: number
  created_at: string
  vendor_quote_items: QuoteItem[]
}

interface QuoteDraftItem extends Material {
  quoted_unit_price: string
}

function localDateString() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function quoteSubtotal(items: QuoteItem[]) {
  return items.reduce((total, item) => {
    return total + (item.quoted_unit_price == null ? 0 : Number(item.quantity) * Number(item.quoted_unit_price))
  }, 0)
}

function pricedItemCount(items: QuoteItem[]) {
  return items.filter(item => item.quoted_unit_price != null).length
}

function quoteTotal(quote: VendorQuote) {
  return quote.quoted_total == null
    ? quoteSubtotal(quote.vendor_quote_items || [])
      + Number(quote.freight || 0)
      + Number(quote.tax || 0)
      + Number(quote.other_charges || 0)
    : Number(quote.quoted_total)
}

function formatPrice(value: number | null) {
  return value == null ? 'Not priced' : currency(value)
}

function isMissingSupplierNameColumn(error: { code?: string; message: string }) {
  const message = error.message.toLowerCase()
  return error.code === '42703'
    || (message.includes('supplier_name') && (message.includes('does not exist') || message.includes('schema cache')))
}

export default function ProjectQuotesPage() {
  const params = useParams()
  const projectId = params?.id as string
  const { roles } = useAuth()
  const canManageQuotes = hasAnyRole(roles, ['ADMIN', 'RFQ_MANAGER'])
  const [projectName, setProjectName] = useState('')
  const [materials, setMaterials] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [quotes, setQuotes] = useState<VendorQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [quoteReference, setQuoteReference] = useState('')
  const [quotedDate, setQuotedDate] = useState(localDateString)
  const [notes, setNotes] = useState('')
  const [freight, setFreight] = useState('0')
  const [tax, setTax] = useState('0')
  const [otherCharges, setOtherCharges] = useState('0')
  const [draftItems, setDraftItems] = useState<QuoteDraftItem[]>([])
  const [materialCategory, setMaterialCategory] = useState('General')
  const [uploadSupplierId, setUploadSupplierId] = useState('')
  const [uploadCategory, setUploadCategory] = useState('General')
  const [quoteLabel, setQuoteLabel] = useState('')
  const [quoteFile, setQuoteFile] = useState<File | null>(null)
  const [uploadingQuote, setUploadingQuote] = useState(false)
  const [collapsedQuoteIds, setCollapsedQuoteIds] = useState<Set<string>>(new Set())
  const [openingQuoteId, setOpeningQuoteId] = useState<string | null>(null)
  const [quotePreview, setQuotePreview] = useState<{ quote: VendorQuote; url: string } | null>(null)

  const fetchProjectData = useCallback(async () => {
    if (!projectId) return
    let projectResult
    let materialResult
    let supplierResult
    let quoteResult
    try {
      [projectResult, materialResult, supplierResult, quoteResult] = await Promise.all([
        supabase.from('projects').select('name').eq('id', projectId).single(),
        supabase.from('materials').select('id, item_number, quantity, unit, description, manufacturer, model_number, sheet_reference, notes').eq('project_id', projectId).order('item_number', { ascending: true }),
        supabase.from('suppliers').select('id, company_name, is_active').order('company_name', { ascending: true }),
        supabase.from('vendor_quotes').select('id, project_id, supplier_id, quote_reference, material_category, quoted_total, file_path, file_name, file_mime_type, quoted_date, notes, freight, tax, other_charges, created_at, vendor_quote_items(id, source_material_id, item_number, quantity, unit, description, manufacturer, model_number, sheet_reference, notes, quoted_unit_price)').eq('project_id', projectId).order('quoted_date', { ascending: false })
      ])
    } catch (loadError) {
      setError(`Unable to load quote data: ${loadError instanceof Error ? loadError.message : 'Unexpected network error.'}`)
      return
    }

    const errors = [
      projectResult.error && `project: ${projectResult.error.message}`,
      materialResult.error && `takeoff: ${materialResult.error.message}`,
      supplierResult.error && `suppliers: ${supplierResult.error.message}`,
      quoteResult.error && `quotes: ${quoteResult.error.message}`
    ].filter(Boolean)

    if (errors.length) {
      setError(`Unable to load quote data (${errors.join('; ')}).`)
      return
    }

    const savedSupplierNames = new Map<string, string>()
    if (quoteResult.data?.some(quote => !quote.supplier_id)) {
      const supplierNameResult = await supabase.from('vendor_quotes')
        .select('id, supplier_name')
        .eq('project_id', projectId)
      if (supplierNameResult.error && !isMissingSupplierNameColumn(supplierNameResult.error)) {
        setError(`Unable to load saved quote vendor names: ${supplierNameResult.error.message}`)
        return
      }
      if (!supplierNameResult.error) {
        for (const quote of supplierNameResult.data || []) {
          if (typeof quote.supplier_name === 'string') savedSupplierNames.set(quote.id, quote.supplier_name)
        }
      }
    }

    setProjectName(projectResult.data?.name || '')
    const projectMaterials = (materialResult.data || []) as Material[]
    setMaterials(projectMaterials)
    setSuppliers((supplierResult.data || []) as Supplier[])
    setQuotes((quoteResult.data || []).map(quote => ({
      ...quote,
      supplier_name: savedSupplierNames.get(quote.id) || null
    })) as unknown as VendorQuote[])
    setDraftItems(projectMaterials.map(material => ({ ...material, quoted_unit_price: '' })))
    setError(null)
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchProjectData().finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchProjectData])

  const supplierById = useMemo(() => new Map(suppliers.map(supplier => [supplier.id, supplier])), [suppliers])
  const quoteGroups = useMemo(() => {
    const groups = new Map<string, { category: string; quotes: VendorQuote[] }>()
    for (const quote of quotes) {
      const category = quote.material_category?.trim() || 'General'
      const key = category.toLowerCase()
      const group = groups.get(key)
      if (group) group.quotes.push(quote)
      else groups.set(key, { category, quotes: [quote] })
    }
    return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category))
  }, [quotes])
  const draftSubtotal = useMemo(() => draftItems.reduce((sum, item) => {
    const price = item.quoted_unit_price.trim() === '' ? null : Number(item.quoted_unit_price)
    return sum + (price == null || !Number.isFinite(price) ? 0 : Number(item.quantity) * price)
  }, 0), [draftItems])

  const extraCharges = useMemo(() => {
    return [freight, tax, otherCharges].reduce((sum, value) => {
      const parsed = Number(value)
      return sum + (Number.isFinite(parsed) && parsed >= 0 ? parsed : 0)
    }, 0)
  }, [freight, tax, otherCharges])

  function updateDraftPrice(materialId: string, value: string) {
    setDraftItems(current => current.map(item => item.id === materialId
      ? { ...item, quoted_unit_price: value }
      : item))
  }

  async function handleSaveQuote(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (!canManageQuotes) {
      setError('You do not have permission to enter vendor quotes.')
      return
    }
    if (!supplierId) {
      setError('Select a vendor for this quote.')
      return
    }
    if (draftItems.length === 0) {
      setError('This project has no takeoff items to include in a quote.')
      return
    }

    const enteredPrices: number[] = []
    for (const item of draftItems) {
      if (!item.quoted_unit_price.trim()) continue
      const price = Number(item.quoted_unit_price)
      if (!Number.isFinite(price) || price < 0) {
        setError(`Enter a valid non-negative unit price for item #${item.item_number ?? '—'}, or leave it blank if the vendor did not price it.`)
        return
      }
      enteredPrices.push(price)
    }
    if (enteredPrices.length === 0) {
      setError('Enter at least one quoted unit price before saving.')
      return
    }

    const charges = [freight, tax, otherCharges].map(Number)
    if (charges.some(value => !Number.isFinite(value) || value < 0)) {
      setError('Freight, tax, and other charges must be valid non-negative amounts.')
      return
    }
    if (!quotedDate) {
      setError('Enter the date shown on the vendor quote.')
      return
    }

    setSaving(true)
    try {
      const { error: saveError } = await supabase.rpc('create_vendor_quote', {
        p_project_id: projectId,
        p_supplier_id: supplierId,
        p_quote_reference: quoteReference.trim() || null,
        p_quoted_date: quotedDate,
        p_notes: notes.trim() || null,
        p_freight: charges[0],
        p_tax: charges[1],
        p_other_charges: charges[2],
        p_material_category: materialCategory.trim() || 'General',
        p_items: draftItems.map(item => ({
          source_material_id: item.id,
          item_number: item.item_number,
          quantity: item.quantity,
          unit: item.unit,
          description: item.description,
          manufacturer: item.manufacturer,
          model_number: item.model_number,
          sheet_reference: item.sheet_reference,
          notes: item.notes,
          quoted_unit_price: item.quoted_unit_price.trim() ? Number(item.quoted_unit_price) : null
        }))
      })

      if (saveError) {
        setError(`Unable to save the quote: ${saveError.message}`)
        return
      }

      const selectedSupplier = supplierById.get(supplierId)?.company_name || 'Vendor'
      setNotice(`Quote from ${selectedSupplier} saved.`)
      setSupplierId('')
      setQuoteReference('')
      setQuotedDate(localDateString())
      setNotes('')
      setFreight('0')
      setTax('0')
      setOtherCharges('0')
      setMaterialCategory('General')
      await fetchProjectData()
    } catch (saveError) {
      setError(`Unable to save the quote: ${saveError instanceof Error ? saveError.message : 'Unexpected network error.'}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteQuote(quote: VendorQuote) {
    const vendorName = quote.supplier_name || (quote.supplier_id ? supplierById.get(quote.supplier_id)?.company_name : null) || 'this vendor'
    if (!confirm(`Delete the quote from ${vendorName}${quote.quote_reference ? ` (${quote.quote_reference})` : ''}? This cannot be undone.`)) return

    try {
      const { error: deleteError } = await supabase.from('vendor_quotes').delete().eq('id', quote.id)
      if (deleteError) {
        setError(`Unable to delete quote: ${deleteError.message}`)
        return
      }
      if (quote.file_path) {
        const { error: fileError } = await supabase.storage.from(QUOTE_BUCKET).remove([quote.file_path])
        if (fileError) {
          setError(`Quote deleted, but its uploaded file could not be removed: ${fileError.message}`)
          setQuotes(current => current.filter(item => item.id !== quote.id))
          return
        }
      }
      setQuotes(current => current.filter(item => item.id !== quote.id))
      setNotice('Quote deleted.')
    } catch (deleteError) {
      setError(`Unable to delete quote: ${deleteError instanceof Error ? deleteError.message : 'Unexpected network error.'}`)
    }
  }

  async function handleUploadQuote(event: React.FormEvent) {
      event.preventDefault()
      setError(null)
      setNotice(null)
      if (!canManageQuotes) {
        setError('You do not have permission to upload vendor quotes.')
        return
      }
      if (!uploadSupplierId || !quoteFile || !uploadCategory.trim()) {
        setError('Select a vendor, choose a material category, and select a quote file.')
        return
      }
      if (!ACCEPTED_TYPES.includes(quoteFile.type) || quoteFile.size === 0 || quoteFile.size > MAX_FILE_SIZE) {
        setError('Quote files must be a non-empty PDF, JPEG, PNG, or WebP no larger than 20 MB.')
        return
      }

      setUploadingQuote(true)
      let uploadedFilePath: string | null = null
      let fileUploaded = false
      let accessToken = ''
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw new Error(`Unable to verify your sign-in: ${sessionError.message}`)
        accessToken = sessionData.session?.access_token || ''
        if (!accessToken) throw new Error('Sign in again before uploading a vendor quote.')

        const uploadUrlResponse = await fetch(`/api/projects/${projectId}/quotes/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: quoteFile.name, mimeType: quoteFile.type, size: quoteFile.size })
        })
        const uploadUrlData: unknown = await uploadUrlResponse.json()
        if (!uploadUrlResponse.ok || typeof uploadUrlData !== 'object' || uploadUrlData === null
          || !('filePath' in uploadUrlData) || typeof uploadUrlData.filePath !== 'string'
          || !('token' in uploadUrlData) || typeof uploadUrlData.token !== 'string') {
          const message = typeof uploadUrlData === 'object' && uploadUrlData !== null
            && 'error' in uploadUrlData && typeof uploadUrlData.error === 'string'
            ? uploadUrlData.error
            : 'Unable to prepare private quote upload.'
          throw new Error(message)
        }

        uploadedFilePath = uploadUrlData.filePath
        const { error: uploadError } = await supabase.storage.from(QUOTE_BUCKET)
          .uploadToSignedUrl(uploadedFilePath, uploadUrlData.token, quoteFile, {
            contentType: quoteFile.type,
            upsert: false
          })
        if (uploadError) throw new Error(`Unable to upload quote file: ${uploadError.message}`)
        fileUploaded = true

        let quotedTotal: number | null = null
        let extractionNotice = ''
        try {
          const response = await fetch(`/api/projects/${projectId}/quotes/extract`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: uploadedFilePath, mimeType: quoteFile.type })
          })
          const result: unknown = await response.json()
          if (response.ok && typeof result === 'object' && result !== null
            && 'quotedTotal' in result && (typeof result.quotedTotal === 'number' || result.quotedTotal === null)) {
            quotedTotal = result.quotedTotal
            if (quotedTotal == null) extractionNotice = ' The quote was saved, but its total could not be detected; the uploaded file is available to preview.'
          } else {
            const detail = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
              ? ` (${result.error})`
              : ''
            extractionNotice = ` The quote was saved, but its total could not be detected${detail}; the uploaded file is available to preview.`
          }
        } catch (extractionError) {
          const detail = extractionError instanceof Error ? ` (${extractionError.message})` : ''
          extractionNotice = ` The quote was saved, but total extraction failed${detail}; the uploaded file is available to preview.`
        }

        const { error: insertError } = await supabase.from('vendor_quotes').insert({
          project_id: projectId,
          supplier_id: uploadSupplierId,
          quote_reference: quoteLabel.trim() || quoteFile.name.replace(/\.[^.]+$/, ''),
          material_category: uploadCategory.trim(),
          quoted_total: quotedTotal,
          file_path: uploadedFilePath,
          file_name: quoteFile.name,
          file_mime_type: quoteFile.type,
          quoted_date: localDateString()
        })
        if (insertError) throw new Error(`Unable to save the uploaded quote: ${insertError.message}`)

        setNotice(`Quote uploaded.${quotedTotal == null ? extractionNotice : ' Its total was extracted automatically.'}`)
        setUploadSupplierId('')
        setUploadCategory('General')
        setQuoteLabel('')
        setQuoteFile(null)
        await fetchProjectData()
      } catch (uploadError) {
        let message = uploadError instanceof Error ? uploadError.message : 'Unexpected upload error.'
        if (uploadedFilePath && fileUploaded) {
          try {
            const cleanupResponse = await fetch(`/api/projects/${projectId}/quotes/upload`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: uploadedFilePath })
            })
            if (!cleanupResponse.ok) {
              const cleanupData: unknown = await cleanupResponse.json()
              const cleanupMessage = typeof cleanupData === 'object' && cleanupData !== null
                && 'error' in cleanupData && typeof cleanupData.error === 'string'
                ? cleanupData.error
                : 'Unable to remove the unused quote upload.'
              message += ` ${cleanupMessage}`
            }
          } catch (cleanupError) {
            message += ` Unable to remove the unused quote upload: ${cleanupError instanceof Error ? cleanupError.message : 'Unexpected network error.'}`
          }
        }
        setError(message)
      } finally {
        setUploadingQuote(false)
      }
    }

  async function handleOpenQuote(quote: VendorQuote) {
      if (!quote.file_path) return
      setOpeningQuoteId(quote.id)
      setError(null)
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !sessionData.session?.access_token) {
          throw new Error(sessionError?.message || 'Sign in again before previewing a quote.')
        }
        const response = await fetch(`/api/projects/${projectId}/quotes/preview`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ quoteId: quote.id })
        })
        const responseData: unknown = await response.json()
        if (!response.ok || typeof responseData !== 'object' || responseData === null
          || !('signedUrl' in responseData) || typeof responseData.signedUrl !== 'string') {
          const message = typeof responseData === 'object' && responseData !== null
            && 'error' in responseData && typeof responseData.error === 'string'
            ? responseData.error
            : 'Unable to create a quote preview link.'
          setError(`Unable to preview quote file: ${message}`)
          return
        }
        setQuotePreview({ quote, url: responseData.signedUrl })
      } catch (previewError) {
        setError(`Unable to preview quote file: ${previewError instanceof Error ? previewError.message : 'Unexpected network error.'}`)
      } finally {
        setOpeningQuoteId(null)
      }
    }

  function toggleQuoteCollapsed(quoteId: string) {
    setCollapsedQuoteIds(current => {
      const next = new Set(current)
      if (next.has(quoteId)) next.delete(quoteId)
      else next.add(quoteId)
      return next
    })
  }

  const quotedBySource = useMemo(() => {
    const indexed = new Map<string, Map<string, QuoteItem>>()
    for (const quote of quotes) {
      for (const item of quote.vendor_quote_items || []) {
        if (!item.source_material_id) continue
        const byQuote = indexed.get(item.source_material_id) || new Map<string, QuoteItem>()
        byQuote.set(quote.id, item)
        indexed.set(item.source_material_id, byQuote)
      }
    }
    return indexed
  }, [quotes])

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-sm font-semibold text-blue-600 hover:underline">← Back to project takeoff</Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-800">Vendor quotes</h1>
          <p className="mt-1 text-sm text-gray-600">{projectName || 'Project'} · Uploaded quotes and category-based comparison</p>
        </div>
        <span className="rounded bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800">{quotes.length} quote{quotes.length === 1 ? '' : 's'}</span>
      </div>

      {error && <p role="alert" className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      {loading ? (
        <p className="py-12 text-center text-sm text-gray-500">Loading project quotes…</p>
      ) : (
        <>
          {canManageQuotes && (
            <section className="mb-6 rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">Upload a vendor quote</h2>
              <p className="mt-1 text-xs text-gray-500">Upload the quote as received. We’ll try to read its total automatically; no line-by-line verification is required.</p>
              <form onSubmit={event => void handleUploadQuote(event)} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <label className="text-sm font-medium text-gray-700">
                  Vendor
                  <select required value={uploadSupplierId} onChange={event => setUploadSupplierId(event.target.value)} className="mt-1 w-full rounded border bg-white p-2.5">
                    <option value="">Select vendor</option>
                    {suppliers.filter(supplier => supplier.is_active).map(supplier => (
                      <option key={supplier.id} value={supplier.id}>{supplier.company_name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Material category
                  <input required list="quote-material-categories" value={uploadCategory} onChange={event => setUploadCategory(event.target.value)} className="mt-1 w-full rounded border p-2.5" placeholder="e.g. Panelboards" />
                  <datalist id="quote-material-categories">
                    {QUOTE_CATEGORIES.map(category => <option key={category} value={category} />)}
                  </datalist>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Quote name
                  <input value={quoteLabel} onChange={event => setQuoteLabel(event.target.value)} className="mt-1 w-full rounded border p-2.5" placeholder="Defaults to file name" />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Quote file
                  <input required type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={event => setQuoteFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded border p-2 text-sm" />
                  <span className="mt-1 block text-xs font-normal text-gray-500">PDF, JPEG, PNG, or WebP; up to 20 MB.</span>
                </label>
                <button disabled={uploadingQuote} className="self-end rounded bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {uploadingQuote ? 'Uploading quote…' : 'Upload quote'}
                </button>
              </form>
            </section>
          )}

          {canManageQuotes && (
            <section className="mb-8 rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">Record a vendor quote</h2>
              <p className="mt-1 text-xs text-gray-500">Prices are saved with a snapshot of today’s takeoff, so later takeoff edits won’t alter this quote.</p>
              {materials.length === 0 ? (
                <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">Add project takeoff materials before recording a quote.</p>
              ) : (
                <form onSubmit={handleSaveQuote} className="mt-5 space-y-5">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <label className="text-sm font-medium text-gray-700">
                      Vendor
                      <select required value={supplierId} onChange={event => setSupplierId(event.target.value)} className="mt-1 w-full rounded border bg-white p-2.5">
                        <option value="">Select vendor</option>
                        {suppliers.filter(supplier => supplier.is_active).map(supplier => (
                          <option key={supplier.id} value={supplier.id}>{supplier.company_name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Quote number / reference
                      <input value={quoteReference} onChange={event => setQuoteReference(event.target.value)} className="mt-1 w-full rounded border p-2.5" placeholder="Optional" />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Material category
                      <input required value={materialCategory} onChange={event => setMaterialCategory(event.target.value)} className="mt-1 w-full rounded border p-2.5" placeholder="e.g. Panelboards" />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Quote date
                      <input type="date" required value={quotedDate} onChange={event => setQuotedDate(event.target.value)} className="mt-1 w-full rounded border p-2.5" />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Freight
                      <input type="number" min="0" step="0.01" value={freight} onChange={event => setFreight(event.target.value)} className="mt-1 w-full rounded border p-2.5" />
                    </label>
                  </div>

                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[800px] text-left text-sm">
                      <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">Quantity</th>
                          <th className="p-3">Material</th>
                          <th className="p-3">Manufacturer / model</th>
                          <th className="p-3">Quoted unit price</th>
                          <th className="p-3 text-right">Line total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {draftItems.map(item => {
                          const price = item.quoted_unit_price.trim() ? Number(item.quoted_unit_price) : null
                          return (
                            <tr key={item.id}>
                              <td className="p-3 text-gray-500">{item.item_number ?? '—'}</td>
                              <td className="p-3">{item.quantity} {item.unit}</td>
                              <td className="p-3">
                                <span className="font-medium text-gray-800">{item.description}</span>
                                {item.sheet_reference && <span className="ml-2 text-xs text-gray-500">Ref: {item.sheet_reference}</span>}
                              </td>
                              <td className="p-3 text-gray-600">{[item.manufacturer, item.model_number].filter(Boolean).join(' · ') || '—'}</td>
                              <td className="p-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.quoted_unit_price}
                                  onChange={event => updateDraftPrice(item.id, event.target.value)}
                                  aria-label={`Quoted unit price for ${item.description}`}
                                  placeholder="Leave blank if unpriced"
                                  className="w-44 rounded border p-2"
                                />
                              </td>
                              <td className="p-3 text-right font-medium">{price == null || !Number.isFinite(price) ? '—' : currency(Number(item.quantity) * price)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">
                      Quote notes
                      <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded border p-2.5" placeholder="Availability, exclusions, validity period, or other terms" />
                    </label>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-gray-600">
                          Tax
                          <input type="number" min="0" step="0.01" value={tax} onChange={event => setTax(event.target.value)} className="mt-1 w-full rounded border p-2 text-sm" />
                        </label>
                        <label className="text-xs font-medium text-gray-600">
                          Other charges
                          <input type="number" min="0" step="0.01" value={otherCharges} onChange={event => setOtherCharges(event.target.value)} className="mt-1 w-full rounded border p-2 text-sm" />
                        </label>
                      </div>
                      <div className="mt-4 space-y-1 border-t pt-3 text-sm">
                        <div className="flex justify-between"><span>Priced materials subtotal</span><strong>{currency(draftSubtotal)}</strong></div>
                        <div className="flex justify-between text-gray-600"><span>Freight, tax, and other charges</span><span>{currency(extraCharges)}</span></div>
                        <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Quote total</span><span>{currency(draftSubtotal + extraCharges)}</span></div>
                      </div>
                      <button disabled={saving || !supplierId} className="mt-4 w-full rounded bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                        {saving ? 'Saving quote…' : 'Save vendor quote'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </section>
          )}

          <section className="mb-8 rounded-xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="text-lg font-semibold text-gray-800">Quote comparison</h2>
              <p className="mt-1 text-xs text-gray-500">Quotes are grouped and compared only with quotes for the same material category.</p>
            </div>
            {quotes.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No vendor quotes have been recorded for this project yet.</p>
            ) : (
              <div className="divide-y">
                {quoteGroups.map(({ category, quotes: categoryQuotes }) => {
                  const categoryMaterials = materials.filter(material =>
                    categoryQuotes.some(quote => quotedBySource.get(material.id)?.has(quote.id))
                  )
                  return (
                    <div key={category} className="p-5">
                      <h3 className="mb-3 text-base font-semibold text-gray-800">{category}</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-left text-sm">
                          <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                            <tr>
                              <th className="p-3">Project material</th>
                              {categoryQuotes.map(quote => (
                                <th key={quote.id} className="min-w-40 p-3">
                                  <span className="block text-gray-800">{quote.supplier_name || (quote.supplier_id ? supplierById.get(quote.supplier_id)?.company_name : null) || 'Unknown vendor'}</span>
                                  <span className="mt-1 block font-normal normal-case text-gray-500">{quote.quote_reference || quote.file_name || quote.quoted_date}</span>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {categoryMaterials.map(material => (
                              <tr key={material.id}>
                                <td className="p-3">
                                  <span className="font-medium text-gray-800">{material.item_number ?? '—'}. {material.description}</span>
                                  <span className="mt-1 block text-xs text-gray-500">{material.quantity} {material.unit}</span>
                                </td>
                                {categoryQuotes.map(quote => {
                                  const item = quotedBySource.get(material.id)?.get(quote.id)
                                  return (
                                    <td key={quote.id} className="p-3">
                                      {!item
                                        ? <span className="text-xs text-gray-400">Not included</span>
                                        : item.quoted_unit_price == null
                                          ? <span className="text-xs text-amber-700">Not priced</span>
                                          : <><span className="block font-semibold">{currency(Number(item.quantity) * Number(item.quoted_unit_price))}</span><span className="text-xs text-gray-500">{item.quantity} {item.unit} at {currency(Number(item.quoted_unit_price))} / {item.unit}</span></>}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                            {categoryMaterials.length > 0 && (
                              <tr className="bg-gray-50 font-semibold">
                                <td className="p-3">Materials subtotal</td>
                                {categoryQuotes.map(quote => <td key={quote.id} className="p-3">{currency(quoteSubtotal(quote.vendor_quote_items || []))}</td>)}
                              </tr>
                            )}
                            <tr className="bg-blue-50 font-bold text-blue-900">
                              <td className="p-3">Quote total</td>
                              {categoryQuotes.map(quote => (
                                <td key={quote.id} className="p-3">
                                  {quote.quoted_total == null && quote.vendor_quote_items.length === 0
                                    ? <span className="text-sm font-normal text-amber-800">Total not detected</span>
                                    : <span>{currency(quoteTotal(quote))}</span>}
                                  {quote.quoted_total == null && quote.vendor_quote_items.length > pricedItemCount(quote.vendor_quote_items) && (
                                    <span className="mt-1 block text-[11px] font-normal text-amber-800">
                                      {quote.vendor_quote_items.length - pricedItemCount(quote.vendor_quote_items)} line(s) not priced
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                        {categoryMaterials.length === 0 && <p className="mt-2 text-xs text-gray-500">Uploaded quotes are compared by their total price.</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-800">Saved quote details</h2>
            {quotes.length === 0 ? (
              <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">Saved vendor quotes, uploaded files, and any itemized prices will appear here.</p>
            ) : (
              <div className="space-y-6">
                {quoteGroups.map(({ category, quotes: categoryQuotes }) => (
                  <section key={category} className="space-y-3">
                    <h3 className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-bold text-gray-800">{category}</h3>
                    {categoryQuotes.map(quote => {
                      const supplier = quote.supplier_name || (quote.supplier_id ? supplierById.get(quote.supplier_id)?.company_name : null) || 'Unknown vendor'
                      const quoteItems = quote.vendor_quote_items || []
                      const isCollapsed = collapsedQuoteIds.has(quote.id)
                      return (
                        <article key={quote.id} className="overflow-hidden rounded-xl border bg-white shadow-sm">
                          <header className="flex flex-wrap items-center justify-between gap-4 border-b p-4">
                            <div className="min-w-0">
                              <h4 className="truncate font-bold text-gray-800">{supplier}</h4>
                              <p className="truncate text-xs text-gray-500">{quote.quote_reference || quote.file_name || 'Vendor quote'} · {quote.quoted_date}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="whitespace-nowrap text-sm font-bold text-blue-800">
                                {quote.quoted_total == null && quoteItems.length === 0 ? 'Total not detected' : currency(quoteTotal(quote))}
                              </p>
                              <button type="button" aria-expanded={!isCollapsed} onClick={() => toggleQuoteCollapsed(quote.id)} className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                                {isCollapsed ? 'Expand' : 'Collapse'}
                              </button>
                              {canManageQuotes && (
                                <button type="button" onClick={() => void handleDeleteQuote(quote)} className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                                  Delete
                                </button>
                              )}
                            </div>
                          </header>
                          {!isCollapsed && (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 text-sm text-gray-600">
                                <span>{quote.file_name || 'Manually entered quote'} · {quoteItems.length} itemized line{quoteItems.length === 1 ? '' : 's'}</span>
                                {quote.file_path && (
                                  <button type="button" disabled={openingQuoteId === quote.id} onClick={() => void handleOpenQuote(quote)} className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-50">
                                    {openingQuoteId === quote.id ? 'Opening…' : 'Preview quote file'}
                                  </button>
                                )}
                              </div>
                              {quote.notes && <p className="border-b p-4 text-sm text-gray-600">{quote.notes}</p>}
                              {quoteItems.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full min-w-[700px] text-left text-sm">
                                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                      <tr><th className="p-3">#</th><th className="p-3">Qty / unit</th><th className="p-3">Quoted material</th><th className="p-3">Vendor unit price</th><th className="p-3 text-right">Line total</th></tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {quoteItems.map(item => (
                                        <tr key={item.id}>
                                          <td className="p-3 text-gray-500">{item.item_number ?? '—'}</td>
                                          <td className="p-3">{item.quantity} {item.unit}</td>
                                          <td className="p-3">
                                            <span className="font-medium text-gray-800">{item.description}</span>
                                            {([item.manufacturer, item.model_number].filter(Boolean).length > 0) && <span className="mt-1 block text-xs text-gray-500">{[item.manufacturer, item.model_number].filter(Boolean).join(' · ')}</span>}
                                            {(item.sheet_reference || item.notes) && <span className="mt-1 block text-xs text-gray-500">{[item.sheet_reference && `Ref: ${item.sheet_reference}`, item.notes].filter(Boolean).join(' · ')}</span>}
                                          </td>
                                          <td className="p-3">{formatPrice(item.quoted_unit_price)}</td>
                                          <td className="p-3 text-right font-semibold">{item.quoted_unit_price == null ? '—' : currency(Number(item.quantity) * Number(item.quoted_unit_price))}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="p-4 text-sm text-gray-500">This uploaded quote is compared by category and total price; its line items are not verified.</p>
                              )}
                            </>
                          )}
                        </article>
                      )
                    })}
                  </section>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {quotePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Vendor quote preview">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white">
            <header className="flex items-center justify-between gap-4 border-b p-4">
              <h2 className="truncate font-semibold text-gray-800">{quotePreview.quote.file_name || 'Vendor quote'}</h2>
              <button type="button" onClick={() => setQuotePreview(null)} className="rounded border px-3 py-1.5 text-sm font-semibold text-gray-700">Close preview</button>
            </header>
            <iframe title={quotePreview.quote.file_name || 'Vendor quote'} src={quotePreview.url} className="min-h-0 flex-1" />
          </div>
        </div>
      )}
    </main>
  )
}
