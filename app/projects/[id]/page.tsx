'use client'

import { useState, useEffect, Suspense } from 'react'
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

interface Project {
  id: string
  name: string
}

function TakeoffDashboard() {
  const params = useParams()
  const projectId = params?.id as string
  
  const [project, setProject] = useState<Project | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  
  const [dispatchedSupplierIds, setDispatchedSupplierIds] = useState<string[]>([])
  const [showCatalogModal, setShowCatalogModal] = useState<boolean>(false)
  
  const [form, setForm] = useState({
    quantity: 1,
    unit: 'EA',
    description: '',
    manufacturer: '',
    model_number: '',
    sheet_reference: '',
    notes: '',
    saveToCatalog: false
  })

  useEffect(() => {
    if (projectId) {
      fetchProjectDetails()
      fetchMaterials()
      fetchSuppliers()
      fetchCatalog()
    }
  }, [projectId])

  async function fetchProjectDetails() {
    if (!projectId) return
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single()
    
    if (data) {
      setProject(data)
    } else {
      // Fail-safe fallback if project ID isn't in DB yet
      setProject({ id: projectId, name: 'Active Takeoff Project' })
    }
  }

  async function fetchMaterials() {
    const { data } = await supabase
      .from('materials')
      .select('*')
      .eq('project_id', projectId)
      .order('item_number', { ascending: true })
    
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

  async function handleAddMaterial(e: React.FormEvent) {
    e.preventDefault()

    let catalogItemId = null
    if (form.saveToCatalog) {
      const existingCatalogItem = catalogItems.find(
        c => c.description?.trim().toLowerCase() === form.description?.trim().toLowerCase()
      )

      if (existingCatalogItem) {
        catalogItemId = existingCatalogItem.id
        await supabase
          .from('material_catalog')
          .update({ default_unit: form.unit, manufacturer: form.manufacturer, model_number: form.model_number })
          .eq('id', existingCatalogItem.id)
      } else {
        const { data: catalogData, error: catalogError } = await supabase
          .from('material_catalog')
          .insert([{
            description: form.description,
            manufacturer: form.manufacturer,
            model_number: form.model_number,
            default_unit: form.unit
          }])
          .select()
          .single()
        
        if (catalogError) {
          alert('Catalog Error: ' + catalogError.message)
          return
        }
        if (catalogData) {
          catalogItemId = catalogData.id
          fetchCatalog()
        }
      }
    }

    const nextItemNumber = materials.length + 1
    const { error } = await supabase.from('materials').insert([{
      project_id: projectId,
      catalog_item_id: catalogItemId,
      item_number: nextItemNumber,
      quantity: form.quantity,
      unit: form.unit,
      description: form.description,
      manufacturer: form.manufacturer,
      model_number: form.model_number,
      sheet_reference: form.sheet_reference,
      notes: form.notes
    }])

    if (error) {
      alert('Material Insert Error: ' + error.message)
    } else {
      setForm({ quantity: 1, unit: 'EA', description: '', manufacturer: '', model_number: '', sheet_reference: '', notes: '', saveToCatalog: false })
      fetchMaterials()
    }
  }

  async function handleDeleteMaterial(materialId: string) {
    const { error } = await supabase.from('materials').delete().eq('id', materialId)
    if (error) {
      alert('Error deleting material: ' + error.message)
    } else {
      setMaterials(prev => prev.filter(m => m.id !== materialId))
    }
  }

  async function handleClearAllMaterials() {
    if (!confirm('Are you sure you want to clear all items from this project takeoff?')) return
    const { error } = await supabase.from('materials').delete().eq('project_id', projectId)
    if (error) {
      alert('Error clearing materials: ' + error.message)
    } else {
      setMaterials([])
      setDispatchedSupplierIds([])
    }
  }

  async function handleDeleteCatalogItem(catalogId: string) {
    if (!confirm('Are you sure you want to remove this item from the Master Catalog?')) return
    const { error } = await supabase.from('material_catalog').delete().eq('id', catalogId)
    if (error) {
      alert('Error deleting catalog item: ' + error.message)
    } else {
      fetchCatalog()
    }
  }

  function handleSelectFromCatalog(item: CatalogItem) {
    setForm({
      quantity: 1,
      unit: item.default_unit || 'EA',
      description: item.description || '',
      manufacturer: item.manufacturer || '',
      model_number: item.model_number || '',
      sheet_reference: '',
      notes: '',
      saveToCatalog: false
    })
    setShowCatalogModal(false)
  }

  function getEmailBodyText(sup: Supplier) {
    const greeting = sup.contact_name?.trim()
      ? `Hello ${sup.contact_name},`
      : `Hello ${sup.company_name} Team,`

    let body = `${greeting}\n\n`
    body += `Please provide pricing and availability for the following material package:\n\n`
    materials.forEach(item => {
      body += `• Item #${item.item_number}: ${item.quantity} ${item.unit} - ${item.description}`
      if (item.manufacturer || item.model_number) {
        body += ` (${item.manufacturer} ${item.model_number})`
      }
      if (item.sheet_reference) body += ` [Ref: ${item.sheet_reference}]`
      if (item.notes) body += ` - Note: ${item.notes}`
      body += `\n`
    })
    body += `\nPlease reply with pricing, lead times, and freight terms at your earliest convenience.\n\nThank you,\nJohn Guzman`
    return body
  }

  async function handleOpenSupplierGmail(sup: Supplier) {
    if (materials.length === 0) {
      alert('Please add at least one material line item to the takeoff before dispatching an RFQ.')
      return
    }

    const projectName = project?.name?.trim() ? project.name.trim() : 'Project'
    const subjectLine = `RFQ for ${projectName}`

    const { data: batch, error } = await supabase
      .from('rfq_batches')
      .insert([{
        project_id: projectId,
        supplier_id: sup.id,
        subject: subjectLine,
        status: 'DRAFT'
      }])
      .select()
      .single()

    if (batch && !error) {
      const rfqLineItems = materials.map(item => ({
        rfq_batch_id: batch.id,
        material_id: item.id
      }))
      await supabase.from('rfq_line_items').insert(rfqLineItems)
    }

    if (!dispatchedSupplierIds.includes(sup.id)) {
      setDispatchedSupplierIds(prev => [...prev, sup.id])
    }

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(sup.email)}&su=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(getEmailBodyText(sup))}`
    window.open(gmailUrl, '_blank')
  }

  return (
    <div className="max-w-7xl mx-auto p-6 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            {project?.name ? `Material Takeoff & RFQ Builder — ${project.name}` : 'Specialized Material Takeoff & RFQ Builder'}
          </h1>
          <div className="flex gap-4 mt-1">
            <a href="/" className="text-xs text-blue-600 hover:underline font-semibold">← Back to Dashboard</a>
            <a href="/suppliers" className="text-xs text-blue-600 hover:underline font-semibold">⚙️ Manage Suppliers & Sales Reps</a>
          </div>
        </div>
        <button 
          onClick={() => setShowCatalogModal(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-sm flex items-center justify-center gap-2"
        >
          📂 Browse Master Catalog ({catalogItems.length})
        </button>
      </div>

      {/* Section 1: Add Material Form */}
      <div className="mb-8">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">1. Material Entry & Specification</h3>
        <form onSubmit={handleAddMaterial} className="bg-gray-50 p-4 rounded-lg border grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description / Spec</label>
            <input type="text" required placeholder="e.g. NEMA 4X Enclosure" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Manufacturer</label>
            <input type="text" placeholder="e.g. Hoffman / Cooper" value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Model / Part #</label>
            <input type="text" placeholder="e.g. JIC-12106-CH" value={form.model_number} onChange={e => setForm({...form, model_number: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Qty</label>
              <input type="number" step="any" required value={form.quantity} onChange={e => setForm({...form, quantity: parseFloat(e.target.value)})} className="w-full p-2 border rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Unit</label>
              <select value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} className="w-full p-2 border rounded text-sm bg-white">
                <option value="EA">EA</option>
                <option value="FT">FT</option>
                <option value="SET">SET</option>
                <option value="LOT">LOT</option>
                <option value="BOX">BOX</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Sheet Reference</label>
            <input type="text" placeholder="e.g. Sheet E-501" value={form.sheet_reference} onChange={e => setForm({...form, sheet_reference: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notes / Specifications</label>
            <input type="text" placeholder="e.g. Stainless steel mounting brackets required" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
          </div>
          <div className="flex items-center space-x-2 pt-4">
            <input type="checkbox" id="catalog" checked={form.saveToCatalog} onChange={e => setForm({...form, saveToCatalog: e.target.checked})} className="h-4 w-4" />
            <label htmlFor="catalog" className="text-xs font-medium text-gray-700">Save to Master Catalog for future projects</label>
          </div>
          <div className="flex items-end">
            <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded text-sm font-medium hover:bg-blue-700">Add Line Item</button>
          </div>
        </form>
      </div>

      {/* Section 2: Material Takeoff Table */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">2. Compiled Project Material Takeoff</h3>
          {materials.length > 0 && (
            <button 
              onClick={handleClearAllMaterials}
              className="text-xs font-semibold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded transition-colors"
            >
              Clear Entire Takeoff ✕
            </button>
          )}
        </div>
        <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b text-xs text-gray-700 uppercase">
                <th className="p-3 w-12">#</th>
                <th className="p-3">Qty / Unit</th>
                <th className="p-3">Description</th>
                <th className="p-3">Manufacturer & Model #</th>
                <th className="p-3">Sheet Ref</th>
                <th className="p-3">Notes</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {materials.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-500">{item.item_number}</td>
                  <td className="p-3 font-semibold">{item.quantity} {item.unit}</td>
                  <td className="p-3">{item.description}</td>
                  <td className="p-3 text-gray-600">{item.manufacturer} <span className="font-mono text-xs bg-gray-100 px-1 rounded">{item.model_number}</span></td>
                  <td className="p-3"><span className="bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded font-medium">{item.sheet_reference}</span></td>
                  <td className="p-3 text-gray-500 text-xs">{item.notes}</td>
                  <td className="p-3 text-right">
                    <button 
                      onClick={() => handleDeleteMaterial(item.id)}
                      className="text-gray-400 hover:text-red-600 text-xs font-bold p-1 rounded transition-colors"
                      title="Remove item"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {materials.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-400">No specialized materials added to this project yet. Use the form above or browse the Master Catalog.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: Clean Streamlined Supplier Dispatch List */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">3. Supplier Dispatch ({materials.length} items ready)</h3>
        <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b text-xs text-gray-700 uppercase">
                <th className="p-3">Company</th>
                <th className="p-3">Email</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {suppliers.map(sup => {
                const isDispatched = dispatchedSupplierIds.includes(sup.id)
                return (
                  <tr key={sup.id} className="hover:bg-gray-50">
                    <td className="p-3 font-semibold text-gray-800">
                      {sup.company_name}
                    </td>
                    <td className="p-3 font-mono text-xs text-blue-600">
                      {sup.email}
                    </td>
                    <td className="p-3 text-center">
                      {isDispatched ? (
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                          ✓ RFQ Dispatched
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">Pending</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleOpenSupplierGmail(sup)}
                        className={`text-xs px-3.5 py-1.5 rounded font-medium transition-colors shadow-xs inline-flex items-center gap-1.5 ${isDispatched ? 'bg-gray-700 hover:bg-gray-800 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                      >
                        ✉️ {isDispatched ? 'Open Again' : 'Open Gmail Draft'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-400">
                    No suppliers configured yet. <a href="/suppliers" className="text-blue-600 underline">Add suppliers here</a>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Master Catalog Modal */}
      {showCatalogModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
              <h2 className="text-lg font-bold text-gray-800">Master Material Catalog</h2>
              <button onClick={() => setShowCatalogModal(false)} className="text-gray-400 hover:text-gray-600 font-bold text-lg">✕</button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Select an item below to prefill Section 1 (including its default unit), or remove items you no longer use.</p>
            
            <div className="overflow-y-auto flex-grow border rounded-lg divide-y">
              {catalogItems.map((cat) => (
                <div key={cat.id} className="p-3 hover:bg-gray-50 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-sm text-gray-800">{cat.description}</div>
                    <div className="text-xs text-gray-500">
                      {cat.manufacturer} <span className="font-mono bg-gray-100 px-1 rounded">{cat.model_number}</span> • Unit: <span className="font-bold">{cat.default_unit || 'EA'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleSelectFromCatalog(cat)}
                      className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded font-medium hover:bg-blue-700 whitespace-nowrap"
                    >
                      Use in Entry Form ➔
                    </button>
                    <button 
                      onClick={() => handleDeleteCatalogItem(cat.id)}
                      className="bg-red-50 text-red-600 hover:bg-red-100 text-xs px-2.5 py-1.5 rounded font-medium transition-colors"
                      title="Delete from Master Catalog"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {catalogItems.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No items saved in the master catalog yet. Check "Save to Master Catalog" when adding items!</div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t flex justify-end">
              <button onClick={() => setShowCatalogModal(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm font-medium hover:bg-gray-300">Close</button>
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