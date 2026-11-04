'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

const INVOICE_BUCKET = 'project-invoices'
const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

interface Material {
  id: string
  item_number: number | null
  description: string
  quantity: number
  unit: string
}

interface Supplier {
  id: string
  company_name: string
  is_active: boolean | null
}

interface InvoiceItem {
  id: string
  source_material_id: string | null
  item_number: number | null
  description: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
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

interface DraftInvoiceItem {
  source_material_id: string
  description: string
  quantity: string
  unit: string
  unit_price: string
}

function localDateString() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function currency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function newDraftItem(): DraftInvoiceItem {
  return { source_material_id: '', description: '', quantity: '1', unit: 'EA', unit_price: '' }
}

function safeFileName(name: string) {
  return name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180)
}

export default function ProjectCostsPage() {
  const params = useParams()
  const projectId = params?.id as string
  const { roles } = useAuth()
  const canEditCosts = hasAnyRole(roles, ['ADMIN', 'COST_EDITOR'])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [projectName, setProjectName] = useState('')
  const [budgetValue, setBudgetValue] = useState('')
  const [budget, setBudget] = useState<number | null>(null)
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [materials, setMaterials] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [savingInvoice, setSavingInvoice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [vendorName, setVendorName] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(localDateString)
  const [invoiceTotal, setInvoiceTotal] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [draftItems, setDraftItems] = useState<DraftInvoiceItem[]>([newDraftItem()])
  const [totalDifferenceConfirmed, setTotalDifferenceConfirmed] = useState(false)
  const [openingInvoiceId, setOpeningInvoiceId] = useState<string | null>(null)

  const fetchProjectCosts = useCallback(async () => {
    if (!projectId) return
    try {
      const [projectResult, materialResult, supplierResult, invoiceResult] = await Promise.all([
        supabase.from('projects').select('name, material_budget').eq('id', projectId).single(),
        supabase.from('materials').select('id, item_number, description, quantity, unit').eq('project_id', projectId).order('item_number', { ascending: true }),
        supabase.from('suppliers').select('id, company_name, is_active').order('company_name', { ascending: true }),
        supabase.from('material_invoices').select('id, supplier_id, vendor_name, invoice_number, invoice_date, invoice_total, notes, file_path, file_name, file_mime_type, status, created_at, void_reason, material_invoice_items(id, source_material_id, item_number, description, quantity, unit, unit_price, line_total)').eq('project_id', projectId).order('invoice_date', { ascending: false })
      ])

      const failures = [
        projectResult.error && `project: ${projectResult.error.message}`,
        materialResult.error && `materials: ${materialResult.error.message}`,
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
      setMaterials((materialResult.data || []) as Material[])
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

  const postedExpenses = useMemo(
    () => invoices.filter(invoice => invoice.status === 'POSTED').reduce((sum, invoice) => sum + Number(invoice.invoice_total), 0),
    [invoices]
  )
  const remainingBudget = budget == null ? null : budget - postedExpenses
  const draftLineTotal = useMemo(
    () => draftItems.reduce((sum, item) => {
      const quantity = Number(item.quantity)
      const price = Number(item.unit_price)
      return sum + (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price >= 0 ? quantity * price : 0)
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

  function handleMaterialSelect(index: number, materialId: string) {
    const material = materials.find(item => item.id === materialId)
    setDraftItems(current => current.map((item, currentIndex) => {
      if (currentIndex !== index) return item
      if (!material) return { ...item, source_material_id: '' }
      return {
        ...item,
        source_material_id: material.id,
        description: material.description,
        quantity: String(material.quantity),
        unit: material.unit
      }
    }))
  }

  function updateDraftItem(index: number, field: keyof DraftInvoiceItem, value: string) {
    setDraftItems(current => current.map((item, currentIndex) => currentIndex === index
      ? { ...item, [field]: value }
      : item))
    if (field === 'quantity' || field === 'unit_price') setTotalDifferenceConfirmed(false)
  }

  function addDraftItem() {
    setDraftItems(current => [...current, newDraftItem()])
  }

  function removeDraftItem(index: number) {
    setDraftItems(current => current.filter((_, currentIndex) => currentIndex !== index))
    setTotalDifferenceConfirmed(false)
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
    if (!invoiceFile) {
      setError('Select the invoice PDF or image to upload.')
      return
    }
    if (!ACCEPTED_TYPES.includes(invoiceFile.type)) {
      setError('Invoice files must be PDF, JPEG, PNG, or WebP.')
      return
    }
    if (invoiceFile.size > MAX_FILE_SIZE) {
      setError('Invoice files must be 20 MB or smaller.')
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
      quantity: number
      unit: string
      unit_price: number
    }> = []
    for (const [index, item] of draftItems.entries()) {
      const quantity = Number(item.quantity)
      const unitPrice = Number(item.unit_price)
      if (!item.description.trim() || !Number.isFinite(quantity) || quantity <= 0 || !item.unit.trim()
        || !item.unit_price.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) {
        setError(`Complete the description, quantity, unit, and unit price for invoice line ${index + 1}.`)
        return
      }
      parsedItems.push({
        source_material_id: item.source_material_id || null,
        item_number: index + 1,
        description: item.description.trim(),
        quantity,
        unit: item.unit.trim(),
        unit_price: unitPrice
      })
    }

    if (totalDifference > 0.01 && !totalDifferenceConfirmed) {
      setError('The invoice total differs from the line-item sum. Review the difference and check the confirmation box before saving.')
      return
    }

    setSavingInvoice(true)
    const safeName = safeFileName(invoiceFile.name) || 'invoice'
    const filePath = `${projectId}/${crypto.randomUUID()}/${safeName}`
    let uploaded = false
    try {
      const { error: uploadError } = await supabase.storage
        .from(INVOICE_BUCKET)
        .upload(filePath, invoiceFile, { contentType: invoiceFile.type, upsert: false })
      if (uploadError) {
        setError(`Unable to upload invoice file: ${uploadError.message}`)
        return
      }
      uploaded = true

      const { error: insertError } = await supabase.rpc('create_material_invoice', {
        p_project_id: projectId,
        p_supplier_id: supplierId || null,
        p_vendor_name: vendorName.trim(),
        p_invoice_number: invoiceNumber.trim() || null,
        p_invoice_date: invoiceDate,
        p_invoice_total: parsedInvoiceTotal,
        p_notes: invoiceNotes.trim() || null,
        p_file_path: filePath,
        p_file_name: invoiceFile.name,
        p_file_mime_type: invoiceFile.type,
        p_items: parsedItems
      })

      if (insertError) {
        const { error: cleanupError } = await supabase.storage.from(INVOICE_BUCKET).remove([filePath])
        uploaded = Boolean(cleanupError)
        setError(`Unable to save the invoice record: ${insertError.message}${cleanupError ? ` The uploaded file could not be removed: ${cleanupError.message}` : ''}`)
        return
      }

      uploaded = false
      setNotice('Invoice recorded. Its total is counted once against the project material budget.')
      setSupplierId('')
      setVendorName('')
      setInvoiceNumber('')
      setInvoiceDate(localDateString())
      setInvoiceTotal('')
      setInvoiceNotes('')
      setInvoiceFile(null)
      setDraftItems([newDraftItem()])
      setTotalDifferenceConfirmed(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await fetchProjectCosts()
    } catch (saveError) {
      if (uploaded) {
        const { error: cleanupError } = await supabase.storage.from(INVOICE_BUCKET).remove([filePath])
        setError(`Unable to save the invoice: ${saveError instanceof Error ? saveError.message : 'Unexpected network error.'}${cleanupError ? ` The uploaded file could not be removed: ${cleanupError.message}` : ''}`)
      } else {
        setError(`Unable to save the invoice: ${saveError instanceof Error ? saveError.message : 'Unexpected network error.'}`)
      }
    } finally {
      setSavingInvoice(false)
    }
  }

  async function handleOpenInvoice(invoice: Invoice) {
    setOpeningInvoiceId(invoice.id)
    setError(null)
    try {
      const { data, error: signedUrlError } = await supabase.storage
        .from(INVOICE_BUCKET)
        .createSignedUrl(invoice.file_path, 60)
      if (signedUrlError || !data?.signedUrl) {
        setError(`Unable to open invoice file: ${signedUrlError?.message || 'Supabase did not return a signed link.'}`)
        return
      }
      window.location.assign(data.signedUrl)
    } catch (openError) {
      setError(`Unable to open invoice file: ${openError instanceof Error ? openError.message : 'Unexpected network error.'}`)
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

      {loading ? (
        <p className="py-12 text-center text-sm text-gray-500">Loading budget and invoices…</p>
      ) : (
        <>
          <section className="mb-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase text-gray-500">Material budget</p>
              <p className="mt-2 text-2xl font-bold text-gray-800">{budget == null ? 'Not set' : currency(budget)}</p>
              {canEditCosts ? (
                <form onSubmit={handleSaveBudget} className="mt-4 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={budgetValue}
                    onChange={event => setBudgetValue(event.target.value)}
                    aria-label="Manual material budget"
                    placeholder="Enter budget"
                    className="min-w-0 flex-1 rounded border p-2 text-sm"
                  />
                  <button disabled={budgetSaving} className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                    {budgetSaving ? 'Saving…' : 'Save'}
                  </button>
                </form>
              ) : <p className="mt-2 text-xs text-gray-500">Only Admins and Cost Editors can change the budget.</p>}
            </div>
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase text-gray-500">Invoice expenses</p>
              <p className="mt-2 text-2xl font-bold text-gray-800">{currency(postedExpenses)}</p>
              <p className="mt-2 text-xs text-gray-500">Sum of posted invoice totals only; line items are not added separately.</p>
            </div>
            <div className={`rounded-xl border p-5 shadow-sm ${remainingBudget != null && remainingBudget < 0 ? 'border-red-200 bg-red-50' : 'bg-white'}`}>
              <p className="text-xs font-semibold uppercase text-gray-500">Budget remaining</p>
              <p className={`mt-2 text-2xl font-bold ${remainingBudget != null && remainingBudget < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                {remainingBudget == null ? 'Set a budget' : currency(remainingBudget)}
              </p>
              {remainingBudget != null && <p className="mt-2 text-xs text-gray-500">{budget === 0 ? 'Budget is zero.' : `${((postedExpenses / (budget || 1)) * 100).toFixed(1)}% of budget spent`}</p>}
            </div>
          </section>

          {canEditCosts && (
            <section className="mb-8 rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">Record a material invoice</h2>
              <p className="mt-1 text-xs text-gray-500">Files are stored privately in Supabase and are visible only to signed-in team members. Invoice text is not sent to an external extraction service.</p>
              <form onSubmit={handleSaveInvoice} className="mt-5 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-sm font-medium text-gray-700">
                    Vendor
                    <select value={supplierId} onChange={event => handleSupplierChange(event.target.value)} className="mt-1 w-full rounded border bg-white p-2.5">
                      <option value="">Enter vendor manually</option>
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
                  <label className="text-sm font-medium text-gray-700 sm:col-span-2 lg:col-span-3">
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
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-gray-800">Purchased materials</h3>
                      <p className="text-xs text-gray-500">Optional takeoff matching helps identify the project material; invoice descriptions and costs are kept as their own snapshot.</p>
                    </div>
                    <button type="button" onClick={addDraftItem} className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700">Add line</button>
                  </div>
                  <div className="space-y-3">
                    {draftItems.map((item, index) => {
                      const lineTotal = Number(item.quantity) * Number(item.unit_price)
                      return (
                        <div key={index} className="grid gap-3 rounded-lg border bg-gray-50 p-3 md:grid-cols-12">
                          <label className="text-xs font-medium text-gray-600 md:col-span-3">
                            Match takeoff (optional)
                            <select value={item.source_material_id} onChange={event => handleMaterialSelect(index, event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm">
                              <option value="">No match</option>
                              {materials.map(material => <option key={material.id} value={material.id}>{material.item_number ?? '—'}. {material.description}</option>)}
                            </select>
                          </label>
                          <label className="text-xs font-medium text-gray-600 md:col-span-4">
                            Invoice description
                            <input required value={item.description} onChange={event => updateDraftItem(index, 'description', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <label className="text-xs font-medium text-gray-600 md:col-span-1">
                            Qty
                            <input required type="number" min="0.0001" step="any" value={item.quantity} onChange={event => updateDraftItem(index, 'quantity', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <label className="text-xs font-medium text-gray-600 md:col-span-1">
                            Unit
                            <input required value={item.unit} onChange={event => updateDraftItem(index, 'unit', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <label className="text-xs font-medium text-gray-600 md:col-span-1">
                            Unit price
                            <input required type="number" min="0" step="0.0001" value={item.unit_price} onChange={event => updateDraftItem(index, 'unit_price', event.target.value)} className="mt-1 w-full rounded border bg-white p-2 text-sm" />
                          </label>
                          <div className="flex items-end justify-between gap-2 md:col-span-2">
                            <span className="pb-2 text-sm font-semibold">{Number.isFinite(lineTotal) ? currency(lineTotal) : '—'}</span>
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
                    {savingInvoice ? 'Uploading and saving…' : 'Upload and record invoice'}
                  </button>
                </div>
              </form>
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
                {invoices.map(invoice => (
                  <article key={invoice.id} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${invoice.status === 'VOID' ? 'opacity-75' : ''}`}>
                    <header className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-gray-800">{invoice.vendor_name}</h3>
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${invoice.status === 'POSTED' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{invoice.status}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                          {invoice.invoice_number ? `Invoice ${invoice.invoice_number} · ` : ''}{invoice.invoice_date}
                          {invoice.supplier_id && supplierById.has(invoice.supplier_id) ? ` · ${supplierById.get(invoice.supplier_id)}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">{invoice.file_name} · {invoice.material_invoice_items?.length || 0} line{invoice.material_invoice_items?.length === 1 ? '' : 's'}</p>
                        {invoice.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{invoice.notes}</p>}
                        {invoice.status === 'VOID' && invoice.void_reason && <p className="mt-2 text-xs text-gray-600">Void reason: {invoice.void_reason}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase text-gray-500">{invoice.status === 'POSTED' ? 'Expense total' : 'Voided total'}</p>
                        <p className={`text-2xl font-bold ${invoice.status === 'POSTED' ? 'text-gray-800' : 'text-gray-500 line-through'}`}>{currency(Number(invoice.invoice_total))}</p>
                        <div className="mt-3 flex justify-end gap-2">
                          <button disabled={openingInvoiceId === invoice.id} onClick={() => void handleOpenInvoice(invoice)} className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-50">
                            {openingInvoiceId === invoice.id ? 'Opening…' : 'View invoice file'}
                          </button>
                          {canEditCosts && invoice.status === 'POSTED' && (
                            <button onClick={() => void handleVoidInvoice(invoice)} className="rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">
                              Void invoice
                            </button>
                          )}
                        </div>
                      </div>
                    </header>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[600px] text-left text-sm">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                          <tr><th className="p-3">#</th><th className="p-3">Purchased material</th><th className="p-3">Quantity</th><th className="p-3">Unit price</th><th className="p-3 text-right">Line total</th></tr>
                        </thead>
                        <tbody className="divide-y">
                          {(invoice.material_invoice_items || []).map((item, index) => (
                            <tr key={item.id}>
                              <td className="p-3 text-gray-500">{item.item_number ?? index + 1}</td>
                              <td className="p-3 font-medium text-gray-800">{item.description}</td>
                              <td className="p-3">{item.quantity} {item.unit}</td>
                              <td className="p-3">{currency(Number(item.unit_price))}</td>
                              <td className="p-3 text-right font-semibold">{currency(Number(item.line_total))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
