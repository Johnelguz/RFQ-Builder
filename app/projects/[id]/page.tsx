/* VERSION: v2.4.0 START */
'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Material {
  id: string
  item_number: number
  quantity: number
  unit: string
  description: string
  manufacturer: string
  model_number: string
  sheet_reference: string
  notes: string
}

interface Supplier {
  id: string
  company_name: string
  contact_name: string
  email: string
  specialties: string[]
}

interface CatalogItem {
  id: string
  description: string
  manufacturer: string
  model_number: string
  default_unit: string
  typical_notes: string
}

function TakeoffDashboard() {
  const params = useParams()
  const projectId = params?.id as string
  
  const [projectName, setProjectName] = useState<string>('')
  const [materials, setMaterials] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  
  // Modal & Tab states
  const [activeTab, setActiveTab] = useState<'STANDARD' | 'WIRE_BUNDLE'>('STANDARD')
  const [showCatalogDropdown, setShowCatalogDropdown] = useState<boolean>(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [catalogToast, setCatalogToast] = useState<string | null>(null)

  // RFQ Wizard states
  const [dispatchedSupplierIds, setDispatchedSupplierIds] = useState<string[]>([])
  const [showCatalogModal, setShowCatalogModal] = useState<boolean>(false)
  const [showRfqWizard, setShowRfqWizard] = useState<boolean>(false)
  const [wizardStep, setWizardStep] = useState<'PROJECT_NAME' | 'SUPPLIER_LIST'>('PROJECT_NAME')
  
  // Standard Material Form state
  const [form, setForm] = useState({
    quantity: 1,
    unit: 'EA',
    description: '',
    manufacturer: '',
    model_number: '',
    sheet_reference: '',
    notes: ''
  })

  // Wire Feeder Configurator Form state
  const [wireForm, setWireForm] = useState({
    preset: '3-Phase 4-Wire (300 MCM + #3 Ground)',
    runType: 'PARALLEL', // SINGLE or PARALLEL
    conduitsCount: 2,
    phaseSize: '300 MCM',
    phaseType: 'THHN Copper',
    neutralSize: '300 MCM',
    greenSize: '#3 AWG', // Adjustable green wire size
    lengthFeet: 150,
    sheetReference: '',
    notes: 'Main Service Feeder Run'
  })

  useEffect(() => {
    if (projectId) {
      fetchProjectDetails()
      fetchMaterials()
      fetchSuppliers()
      fetchCatalog()
    }
  }, [projectId])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCatalogDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchProjectDetails() {
    if (!projectId) return
    const { data } = await supabase.from('projects').select('name').eq('id', projectId).single()
    if (data?.name) setProjectName(data.name)
  }

  async function fetchMaterials() {
    const { data } = await supabase.from('materials').select('*').eq('project_id', projectId).order('item_number', { ascending: true })
    if (data) setMaterials(data)
  }

  async function fetchSuppliers() {
    const { data } = await supabase.from('suppliers').select('*').eq('is_active', true)
    if (data) setSuppliers(data)
  }

  async function fetchCatalog() {
    const { data } = await supabase.from('material_catalog').select('*').order('description', { ascending: true })
    if (data) setCatalogItems(data)
  }

  const filteredCatalog = catalogItems.filter(item => {
    const query = form.description.toLowerCase()
    return (
      item.description?.toLowerCase().includes(query) ||
      item.manufacturer?.toLowerCase().includes(query) ||
      item.model_number?.toLowerCase().includes(query)
    )
  })

  function handleSelectAutocomplete(item: CatalogItem) {
    setForm(prev => ({
      ...prev,
      description: item.description || '',
      manufacturer: item.manufacturer || '',
      model_number: item.model_number || '',
      unit: item.default_unit || prev.unit
    }))
    setShowCatalogDropdown(false)
  }

  // Handle adding standard material with auto-catalog insertion
  async function handleAddMaterial(e: React.FormEvent) {
    e.preventDefault()
    const trimmedDesc = form.description.trim()
    let catalogItemId = null

    const existingCatalogItem = catalogItems.find(
      c => c.description?.trim().toLowerCase() === trimmedDesc.toLowerCase()
    )

    if (existingCatalogItem) {
      catalogItemId = existingCatalogItem.id
    } else {
      const { data: catalogData } = await supabase
        .from('material_catalog')
        .insert([{ description: trimmedDesc, manufacturer: form.manufacturer, model_number: form.model_number, default_unit: form.unit }])
        .select()
        .single()
      
      if (catalogData) {
        catalogItemId = catalogData.id
        fetchCatalog()
        setCatalogToast(`✨ Auto-added "${trimmedDesc}" to Master Catalog`)
        setTimeout(() => setCatalogToast(null), 4000)
      }
    }

    const nextItemNumber = materials.length + 1
    await supabase.from('materials').insert([{
      project_id: projectId,
      catalog_item_id: catalogItemId,
      item_number: nextItemNumber,
      quantity: form.quantity,
      unit: form.unit,
      description: trimmedDesc,
      manufacturer: form.manufacturer,
      model_number: form.model_number,
      sheet_reference: form.sheet_reference,
      notes: form.notes
    }])

    setForm({ quantity: 1, unit: 'EA', description: '', manufacturer: '', model_number: '', sheet_reference: '', notes: '' })
    setShowCatalogDropdown(false)
    fetchMaterials()
  }

  // Handle adding a Wire Bundle / Feeder run (automatically generates multiple line items)
  async function handleAddWireBundle(e: React.FormEvent) {
    e.preventDefault()
    const multiplier = wireForm.runType === 'PARALLEL' ? wireForm.conduitsCount : 1
    const totalLength = wireForm.lengthFeet * multiplier

    const wireLines = [
      { desc: `WIRE, ${wireForm.phaseSize}, ${wireForm.phaseType} (Phase Conductors)`, qty: totalLength * 3 },
      { desc: `WIRE, ${wireForm.neutralSize}, ${wireForm.phaseType} (Neutral)`, qty: totalLength },
      { desc: `WIRE, ${wireForm.greenSize}, COPPER THHN (Ground / Green Wire)`, qty: totalLength }
    ]

    let currentItemNum = materials.length + 1
    for (const wl of wireLines) {
      await supabase.from('materials').insert([{
        project_id: projectId,
        item_number: currentItemNum++,
        quantity: wl.qty,
        unit: 'FT',
        description: wl.desc,
        manufacturer: 'Standard',
        model_number: 'THHN',
        sheet_reference: wireForm.sheetReference,
        notes: `${wireForm.runType} Run (${wireForm.conduitsCount} Conduits) - ${wireForm.notes}`
      }])
    }

    setCatalogToast(`⚡ Added Wire Feeder Bundle (${totalLength} FT total conductors)`)
    setTimeout(() => setCatalogToast(null), 4000)
    fetchMaterials()
  }

  async function handleUpdateQuantity(materialId: string, newQty: number) {
    if (isNaN(newQty) || newQty <= 0) return
    setMaterials(prev => prev.map(m => m.id === materialId ? { ...m, quantity: newQty } : m))
    await supabase.from('materials').update({ quantity: newQty }).eq('id', materialId)
  }

  async function handleDeleteMaterial(materialId: string) {
    await supabase.from('materials').delete().eq('id', materialId)
    setMaterials(prev => prev.filter(m => m.id !== materialId))
  }

  async function handleClearAllMaterials() {
    if (!confirm('Are you sure you want to clear all items from this project takeoff?')) return
    await supabase.from('materials').delete().eq('project_id', projectId)
    setMaterials([])
    setDispatchedSupplierIds([])
  }

  async function handleDeleteCatalogItem(catalogId: string) {
    if (!confirm('Remove item from Master Catalog?')) return
    await supabase.from('material_catalog').delete().eq('id', catalogId)
    fetchCatalog()
  }

  function handleOpenRfqWizard() {
    if (materials.length === 0) {
      alert('Please add at least one material line item before generating an RFQ.')
      return
    }
    setWizardStep('PROJECT_NAME')
    setShowRfqWizard(true)
  }

  async function handleProceedToSuppliers(e: React.FormEvent) {
    e.preventDefault()
    if (!projectName.trim()) {
      alert('Please enter a project name.')
      return
    }
    await supabase.from('projects').upsert([{ id: projectId, name: projectName.trim() }])
    setWizardStep('SUPPLIER_LIST')
  }

  function getEmailBodyText(sup: Supplier) {
    const greeting = sup.contact_name?.trim() ? `Hello ${sup.contact_name},` : `Hello ${sup.company_name} Team,`
    let body = `${greeting}\n\nPlease provide pricing and availability for the following material package (${projectName}):\n\n`
    materials.forEach(item => {
      body += `• Item #${item.item_number}: ${item.quantity} ${item.unit} - ${item.description}`
      if (item.manufacturer || item.model_number) body += ` (${item.manufacturer} ${item.model_number})`
      if (item.sheet_reference) body += ` [Ref: ${item.sheet_reference}]`
      if (item.notes) body += ` - Note: ${item.notes}`
      body += `\n`
    })
    body += `\nPlease reply with pricing, lead times, and freight terms at your earliest convenience.\n\nThank you,\nJohn Guzman`
    return body
  }

  async function handleOpenSupplierGmail(sup: Supplier) {
    const subjectLine = `RFQ for ${projectName.trim()}`
    const { data: batch } = await supabase.from('rfq_batches').insert([{ project_id: projectId, supplier_id: sup.id, subject: subjectLine, status: 'DRAFT' }]).select().single()

    if (batch) {
      const rfqLineItems = materials.map(item => ({ rfq_batch_id: batch.id, material_id: item.id }))
      await supabase.from('rfq_line_items').insert(rfqLineItems)
    }

    if (!dispatchedSupplierIds.includes(sup.id)) setDispatchedSupplierIds(prev => [...prev, sup.id])
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(sup.email)}&su=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(getEmailBodyText(sup))}`
    window.open(gmailUrl, '_blank')
  }

  async function handleResetTakeoffAndClose() {
    if (confirm('Clear entire takeoff list and start fresh?')) {
      await supabase.from('materials').delete().eq('project_id', projectId)
      setMaterials([])
      setDispatchedSupplierIds([])
      setShowRfqWizard(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-6 font-sans relative">
      {catalogToast && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2">
          <span>{catalogToast}</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">M Phase RFQ Builder</h1>
          <div className="flex gap-4 mt-2">
            <a href="/" className="text-xs text-blue-600 hover:underline font-semibold">← Dashboard</a>
            <a href="/suppliers" className="text-xs text-blue-600 hover:underline font-semibold">⚙️ Suppliers</a>
            <a href="/history" className="text-xs text-blue-600 hover:underline font-semibold">📁 Sent RFQ History</a>
          </div>
        </div>
        <button onClick={() => setShowCatalogModal(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-sm">
          📂 Master Catalog ({catalogItems.length})
        </button>
      </div>

      {/* Section 1: Entry Mode Switcher (Standard vs Wire Feeder Configurator) */}
      <div className="mb-6 flex border-b">
        <button
          onClick={() => setActiveTab('STANDARD')}
          className={`px-4 py-2 text-xs font-bold uppercase border-b-2 transition-colors ${activeTab === 'STANDARD' ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
        >
          📦 Standard Material / Equipment Entry
        </button>
        <button
          onClick={() => setActiveTab('WIRE_BUNDLE')}
          className={`px-4 py-2 text-xs font-bold uppercase border-b-2 transition-colors ${activeTab === 'WIRE_BUNDLE' ? 'border-amber-600 text-amber-700 bg-amber-50/50' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
        >
          ⚡ Wire Feeder & Parallel Run Configurator
        </button>
      </div>

      {/* Tab 1: Standard Material Form */}
      {activeTab === 'STANDARD' && (
        <div className="mb-8">
          <form onSubmit={handleAddMaterial} className="bg-gray-50 p-4 rounded-lg border grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative" ref={dropdownRef}>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Description / Spec</label>
              <input 
                type="text" 
                required 
                placeholder="e.g. Enclosure / conduit" 
                value={form.description} 
                onFocus={() => setShowCatalogDropdown(true)}
                onChange={e => { setForm({...form, description: e.target.value}); setShowCatalogDropdown(true) }} 
                className="w-full p-2 border rounded text-sm bg-white" 
              />
              {showCatalogDropdown && form.description.trim().length > 0 && filteredCatalog.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto z-40 divide-y">
                  {filteredCatalog.map(item => (
                    <button key={item.id} type="button" onClick={() => handleSelectAutocomplete(item)} className="w-full text-left p-2.5 hover:bg-blue-50 text-xs">
                      <div className="font-bold text-gray-800">{item.description}</div>
                      <div className="text-[11px] text-gray-500">{item.manufacturer} <span className="font-mono">{item.model_number}</span></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Manufacturer</label>
              <input type="text" placeholder="e.g. Hoffman" value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Model / Part #</label>
              <input type="text" placeholder="e.g. JIC-12106" value={form.model_number} onChange={e => setForm({...form, model_number: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Qty</label>
                <input type="number" step="any" required value={form.quantity} onChange={e => setForm({...form, quantity: parseFloat(e.target.value)})} className="w-full p-2 border rounded text-sm bg-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Unit</label>
                <select value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} className="w-full p-2 border rounded text-sm bg-white">
                  <option value="EA">EA</option><option value="FT">FT</option><option value="SET">SET</option><option value="LOT">LOT</option><option value="BOX">BOX</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Sheet Reference</label>
              <input type="text" placeholder="e.g. E-501" value={form.sheet_reference} onChange={e => setForm({...form, sheet_reference: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
              <input type="text" placeholder="Additional requirements" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div className="md:col-span-2 flex items-end">
              <button type="submit" className="w-full bg-blue-600 text-white p-2.5 rounded text-sm font-medium hover:bg-blue-700">Add Line Item</button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 2: Wire Feeder & Parallel Run Configurator */}
      {activeTab === 'WIRE_BUNDLE' && (
        <div className="mb-8">
          <form onSubmit={handleAddWireBundle} className="bg-amber-50/50 p-4 rounded-lg border border-amber-200 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Run Structure</label>
              <select value={wireForm.runType} onChange={e => setWireForm({...wireForm, runType: e.target.value})} className="w-full p-2 border rounded text-sm bg-white">
                <option value="PARALLEL">Parallel Run</option>
                <option value="SINGLE">Single Run</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Conduits / Sets</label>
              <input type="number" min="1" value={wireForm.conduitsCount} onChange={e => setWireForm({...wireForm, conduitsCount: parseInt(e.target.value)})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Phase Conductor Size</label>
              <input type="text" required value={wireForm.phaseSize} onChange={e => setWireForm({...wireForm, phaseSize: e.target.value})} placeholder="e.g. 300 MCM / 500 MCM" className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Neutral Size</label>
              <input type="text" required value={wireForm.neutralSize} onChange={e => setWireForm({...wireForm, neutralSize: e.target.value})} placeholder="e.g. 300 MCM" className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Green / Ground Wire Size (Adjustable)</label>
              <input type="text" required value={wireForm.greenSize} onChange={e => setWireForm({...wireForm, greenSize: e.target.value})} placeholder="e.g. #3 AWG / 1/0 AWG" className="w-full p-2 border rounded text-sm bg-white text-emerald-700 font-bold" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Run Length (Feet)</label>
              <input type="number" step="any" required value={wireForm.lengthFeet} onChange={e => setWireForm({...wireForm, lengthFeet: parseFloat(e.target.value)})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Sheet Reference</label>
              <input type="text" value={wireForm.sheetReference} onChange={e => setWireForm({...wireForm, sheetReference: e.target.value})} placeholder="e.g. E-201" className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-900 mb-1">Notes</label>
              <input type="text" value={wireForm.notes} onChange={e => setWireForm({...wireForm, notes: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-6 py-2.5 rounded text-sm shadow-sm">
                ⚡ Add Complete Wire Feeder Bundle to Takeoff
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Section 2: Compiled Takeoff Table */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">2. Compiled Project Material Takeoff ({materials.length} items)</h3>
          {materials.length > 0 && (
            <button onClick={handleClearAllMaterials} className="text-xs font-semibold text-red-600 hover:text-red-800 bg-red-50 px-2.5 py-1 rounded">
              Clear Takeoff ✕
            </button>
          )}
        </div>
        <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100 border-b text-xs text-gray-700 uppercase">
                <th className="p-3 w-12">#</th>
                <th className="p-3">Qty & Unit (Editable)</th>
                <th className="p-3">Description</th>
                <th className="p-3">Manufacturer & Model #</th>
                <th className="p-3">Sheet Ref</th>
                <th className="p-3">Notes</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {materials.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-500">{item.item_number}</td>
                  <td className="p-3 font-semibold">
                    <div className="flex items-center gap-1.5">
                      <input type="number" step="any" value={item.quantity} onChange={e => handleUpdateQuantity(item.id, parseFloat(e.target.value))} className="w-20 p-1 border rounded text-sm font-bold bg-white" />
                      <span className="text-xs text-gray-600 uppercase">{item.unit}</span>
                    </div>
                  </td>
                  <td className="p-3">{item.description}</td>
                  <td className="p-3 text-gray-600">{item.manufacturer} <span className="font-mono text-xs bg-gray-100 px-1 rounded">{item.model_number}</span></td>
                  <td className="p-3"><span className="bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded font-medium">{item.sheet_reference}</span></td>
                  <td className="p-3 text-gray-500 text-xs">{item.notes}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDeleteMaterial(item.id)} className="text-gray-400 hover:text-red-600 text-xs font-bold p-1">✕</button>
                  </td>
                </tr>
              ))}
              {materials.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-gray-400">No items added yet. Use standard entry or wire bundle configurator above.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {materials.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button onClick={handleOpenRfqWizard} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base px-6 py-3 rounded-lg shadow-md flex items-center gap-2">
              ✉️ Generate RFQs ({materials.length} Line Items) ➔
            </button>
          </div>
        )}
      </div>

      {/* RFQ Wizard Modal */}
      {showRfqWizard && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl flex flex-col">
            {wizardStep === 'PROJECT_NAME' && (
              <div>
                <div className="flex justify-between items-center mb-4 pb-2 border-b">
                  <h2 className="text-lg font-bold text-gray-800">Step 1: Set Job / Project Name</h2>
                  <button onClick={() => setShowRfqWizard(false)} className="text-gray-400 font-bold text-lg">✕</button>
                </div>
                <form onSubmit={handleProceedToSuppliers} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Project Name</label>
                    <input type="text" required value={projectName} onChange={e => setProjectName(e.target.value)} className="w-full p-3 border rounded-lg text-base font-semibold bg-gray-50" autoFocus />
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                    <strong>Subject Line:</strong> <span className="font-mono">RFQ for {projectName.trim() || '[Project Name]'}</span>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowRfqWizard(false)} className="px-4 py-2 rounded text-sm bg-gray-100">Cancel</button>
                    <button type="submit" className="px-5 py-2 rounded text-sm text-white bg-blue-600">Continue to Suppliers ➔</button>
                  </div>
                </form>
              </div>
            )}

            {wizardStep === 'SUPPLIER_LIST' && (
              <div>
                <div className="flex justify-between items-center mb-4 pb-2 border-b">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">Step 2: Dispatch RFQs to Vendors</h2>
                    <p className="text-xs text-gray-500">Job: <span className="text-blue-600">{projectName}</span></p>
                  </div>
                  <button onClick={() => setShowRfqWizard(false)} className="text-gray-400 font-bold text-lg">✕</button>
                </div>
                <div className="border rounded-lg overflow-hidden divide-y max-h-[50vh] overflow-y-auto mb-4">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead><tr className="bg-gray-100 text-xs text-gray-700 uppercase"><th className="p-3">Supplier</th><th className="p-3 text-center">Status</th><th className="p-3 text-right">Action</th></tr></thead>
                    <tbody className="divide-y">
                      {suppliers.map(sup => {
                        const isDispatched = dispatchedSupplierIds.includes(sup.id)
                        return (
                          <tr key={sup.id} className="hover:bg-gray-50">
                            <td className="p-3">
                              <div className="font-semibold text-gray-800">{sup.company_name}</div>
                              <div className="text-xs text-gray-500">{sup.email}</div>
                            </td>
                            <td className="p-3 text-center">
                              {isDispatched ? <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full">✓ Dispatched</span> : <span className="text-gray-400 text-xs">Pending</span>}
                            </td>
                            <td className="p-3 text-right">
                              <button onClick={() => handleOpenSupplierGmail(sup)} className={`text-xs px-3.5 py-1.5 rounded font-medium ${isDispatched ? 'bg-gray-700 text-white' : 'bg-red-600 text-white'}`}>
                                ✉️ {isDispatched ? 'Open Again' : 'Open Gmail Draft'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center pt-3 border-t">
                  <button onClick={handleResetTakeoffAndClose} className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded font-semibold">Clear Takeoff & Start New Quote ✕</button>
                  <div className="flex gap-2">
                    <button onClick={() => setWizardStep('PROJECT_NAME')} className="px-3 py-2 rounded text-xs bg-gray-100">← Back</button>
                    <button onClick={() => setShowRfqWizard(false)} className="px-4 py-2 rounded text-xs text-white bg-blue-600">Done / Return</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Master Catalog Modal */}
      {showCatalogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
              <h2 className="text-lg font-bold text-gray-800">Master Material Catalog</h2>
              <button onClick={() => setShowCatalogModal(false)} className="text-gray-400 font-bold">✕</button>
            </div>
            <div className="overflow-y-auto flex-grow border rounded-lg divide-y">
              {catalogItems.map(cat => (
                <div key={cat.id} className="p-3 hover:bg-gray-50 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-sm text-gray-800">{cat.description}</div>
                    <div className="text-xs text-gray-500">{cat.manufacturer} <span className="font-mono">{cat.model_number}</span> • Unit: <span className="font-bold">{cat.default_unit}</span></div>
                  </div>
                  <button onClick={() => handleDeleteCatalogItem(cat.id)} className="bg-red-50 text-red-600 text-xs px-2.5 py-1.5 rounded">Delete</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProjectTakeoffPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500 font-sans">Loading takeoff dashboard...</div>}>
      <TakeoffDashboard />
    </Suspense>
  )
}
/* VERSION: v2.4.0 END */