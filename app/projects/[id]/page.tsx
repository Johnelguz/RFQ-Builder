/* VERSION: v2.5.4 START */
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
  
  // Tab switcher state
  const [activeTab, setActiveTab] = useState<'STANDARD' | 'WIRE_APP'>('STANDARD')
  
  // Standard Form Autocomplete state
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

  // Wire App Form state (using greenWireSize consistently)
  const [wireForm, setWireForm] = useState({
    pullId: '',
    wireSize: '',
    wireType: '',
    wireMaterial: '',
    wireLength: '',
    wireColors: '',
    greenWireSize: ''
  })

  const [preparations, setPreparations] = useState<string[]>([])

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

  const hasGreenWire = wireForm.wireColors.toLowerCase().includes('green')

  async function handleAddWirePull(e: React.FormEvent) {
    e.preventDefault()
    if (!wireForm.pullId || !wireForm.wireSize || !wireForm.wireType || !wireForm.wireMaterial || !wireForm.wireLength || !wireForm.wireColors) {
      alert('Please fill out all required wire pull fields.')
      return
    }

    const length = parseFloat(wireForm.wireLength)
    const prepString = preparations.length > 0 ? ` [Prep: ${preparations.join(', ')}]` : ''
    
    const colorPart = wireForm.wireColors.includes(':') ? wireForm.wireColors.split(':')[1].trim() : wireForm.wireColors
    const colors = colorPart.split('/').map(c => c.trim())

    let currentItemNum = materials.length + 1

    for (const color of colors) {
      if (color.toLowerCase() === 'green') continue
      const desc = `WIRE, ${wireForm.wireSize} ${wireForm.wireType} ${wireForm.wireMaterial} - ${color} (${wireForm.pullId})${prepString}`
      
      await supabase.from('materials').insert([{
        project_id: projectId,
        item_number: currentItemNum++,
        quantity: length,
        unit: 'FT',
        description: desc,
        manufacturer: wireForm.wireMaterial,
        model_number: wireForm.wireType,
        sheet_reference: wireForm.pullId,
        notes: `Wire Pull ID: ${wireForm.pullId}${prepString}`
      }])
    }

    if (hasGreenWire) {
      const gSize = wireForm.greenWireSize || wireForm.wireSize
      const greenDesc = `WIRE, ${gSize} ${wireForm.wireType} ${wireForm.wireMaterial} - Green Ground (${wireForm.pullId})${prepString}`
      await supabase.from('materials').insert([{
        project_id: projectId,
        item_number: currentItemNum++,
        quantity: length,
        unit: 'FT',
        description: greenDesc,
        manufacturer: wireForm.wireMaterial,
        model_number: wireForm.wireType,
        sheet_reference: wireForm.pullId,
        notes: `Green Ground Wire for Pull ID: ${wireForm.pullId}`
      }])
    }

    setCatalogToast(`⚡ Added Wire Pull "${wireForm.pullId}" (${length} FT) to Takeoff`)
    setTimeout(() => setCatalogToast(null), 4000)

    setWireForm({
      pullId: '',
      wireSize: '',
      wireType: '',
      wireMaterial: '',
      wireLength: '',
      wireColors: '',
      greenWireSize: ''
    })
    setPreparations([])
    fetchMaterials()
  }

  function handlePrepCheckboxChange(val: string) {
    setPreparations(prev => 
      prev.includes(val) ? prev.filter(p => p !== val) : [...prev, val]
    )
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
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">M Phase RFQ Builder</h1>
            <span className="bg-amber-100 text-amber-800 text-[10px] font-mono px-2 py-0.5 rounded font-bold">v2.5.4 Active</span>
          </div>
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

      {/* Tab Switcher */}
      <div className="mb-6 flex border-b">
        <button
          onClick={() => setActiveTab('STANDARD')}
          className={`px-4 py-2 text-xs font-bold uppercase border-b-2 transition-colors ${activeTab === 'STANDARD' ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
        >
          📦 Standard Material Entry
        </button>
        <button
          onClick={() => setActiveTab('WIRE_APP')}
          className={`px-4 py-2 text-xs font-bold uppercase border-b-2 transition-colors ${activeTab === 'WIRE_APP' ? 'border-amber-600 text-amber-700 bg-amber-50/50' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
        >
          ⚡ Wire Order App Integration
        </button>
      </div>

      {/* Tab 1: Standard Material Form */}
      {activeTab === 'STANDARD' && (
        <div className="mb-8">
          <form onSubmit={handleAddMaterial} className="bg-gray-50 p-4 rounded-lg border grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative" ref={dropdownRef}>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Description / Spec <span className="text-gray-400">(Auto-adds if new)</span></label>
              <input 
                type="text"