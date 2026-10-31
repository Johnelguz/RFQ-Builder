'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface RFQHistoryItem {
  id: string
  project_id: string
  created_at: string
  subject: string
  status: string
  projects?: {
    name: string
  }
  suppliers?: {
    company_name: string
    contact_name: string
    email: string
  }
  rfq_line_items?: {
    materials?: {
      item_number: number
      quantity: number
      unit: string
      description: string
      manufacturer: string
      model_number: string
      sheet_reference: string
      notes: string
    }
  }[]
}

export default function RFQHistoryPage() {
  const [history, setHistory] = useState<RFQHistoryItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    fetchRFQHistory()
  }, [])

  async function fetchRFQHistory() {
    setLoading(true)
    const { data, error } = await supabase
      .from('rfq_batches')
      .select(`
        id,
        project_id,
        created_at,
        subject,
        status,
        projects ( name ),
        suppliers ( company_name, contact_name, email ),
        rfq_line_items (
          materials (
            item_number,
            quantity,
            unit,
            description,
            manufacturer,
            model_number,
            sheet_reference,
            notes
          )
        )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      alert('Error fetching RFQ history: ' + error.message)
    } else if (data) {
      setHistory(data as unknown as RFQHistoryItem[])
    }
    setLoading(false)
  }

  async function handleReloadBatchIntoProject(batch: RFQHistoryItem) {
    if (!batch.project_id) {
      alert('Project ID not found for this history record.')
      return
    }

    if (!confirm(`Load all items from "${batch.projects?.name || 'this order'}" into the active takeoff? This will add them to the project list.`)) return

    // Extract materials from the batch line items
    const materialsToAdd = batch.rfq_line_items
      ?.map(li => li.materials)
      .filter(Boolean)

    if (!materialsToAdd || materialsToAdd.length === 0) {
      alert('No itemized materials found in this history record.')
      return
    }

    // Insert items into the project's active materials table
    let successCount = 0
    for (const mat of materialsToAdd) {
      if (!mat) continue
      const { error } = await supabase.from('materials').insert([{
        project_id: batch.project_id,
        quantity: mat.quantity,
        unit: mat.unit || 'EA',
        description: mat.description,
        manufacturer: mat.manufacturer || '',
        model_number: mat.model_number || '',
        sheet_reference: mat.sheet_reference || '',
        notes: mat.notes || '',
        item_number: successCount + 1
      }])
      if (!error) successCount++
    }

    alert(`Successfully loaded ${successCount} items into the project takeoff!`)
    window.location.href = `/projects/${batch.project_id}`
  }

  async function handleDeleteBatch(batchId: string) {
    if (!confirm('Are you sure you want to delete this RFQ record?')) return

    await supabase.from('rfq_line_items').delete().eq('rfq_batch_id', batchId)
    const { error } = await supabase.from('rfq_batches').delete().eq('id', batchId)

    if (error) {
      alert('Error deleting record: ' + error.message)
    } else {
      setHistory(prev => prev.filter(item => item.id !== batchId))
    }
  }

  async function handleClearAllHistory() {
    if (!confirm('Are you sure you want to clear ALL RFQ history records? This is ideal for cleaning up as jobs close out.')) return

    const { error: lineError } = await supabase.from('rfq_line_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    const { error: batchError } = await supabase.from('rfq_batches').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    if (lineError || batchError) {
      alert('Error clearing history records.')
    } else {
      setHistory([])
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Sent RFQ History & Records</h1>
          <p className="text-xs text-gray-500 mt-1">Review dispatched material packages, reload past orders for resending, and clear records as jobs close.</p>
        </div>
        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <button
              onClick={handleClearAllHistory}
              className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
            >
              Clear All RFQ Records ✕
            </button>
          )}
          <a href="/" className="text-xs text-blue-600 hover:underline font-semibold bg-gray-50 border px-3 py-2 rounded-lg">
            ← Back to Dashboard
          </a>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-500">Loading RFQ history records...</div>
      ) : (
        <div className="space-y-4">
          {history.map(batch => {
            const dispatchDate = new Date(batch.created_at).toLocaleString()
            const jobName = batch.projects?.name || 'Unknown Project'
            const companyName = batch.suppliers?.company_name || 'Unknown Supplier'
            const contactName = batch.suppliers?.contact_name || 'General Team'
            const email = batch.suppliers?.email || ''

            return (
              <div key={batch.id} className="bg-white border rounded-lg p-5 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 mb-3 border-b gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-0.5 rounded">
                        Job: {jobName}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">Dispatched: {dispatchDate}</span>
                    </div>
                    <div className="text-base font-bold text-gray-800 mt-1">
                      {companyName} <span className="text-sm font-normal text-gray-600">({contactName} — <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a>)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleReloadBatchIntoProject(batch)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors shadow-xs"
                      title="Load these items back into the active takeoff list"
                    >
                      🔄 Load into Active Takeoff ➔
                    </button>
                    <button
                      onClick={() => handleDeleteBatch(batch.id)}
                      className="text-xs text-gray-400 hover:text-red-600 font-bold p-1 transition-colors"
                      title="Delete RFQ Record"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Itemized Material Package ({batch.rfq_line_items?.length || 0} items)</h4>
                  <div className="border rounded bg-gray-50 overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-100 border-b text-gray-600">
                          <th className="p-2 w-10">#</th>
                          <th className="p-2">Qty / Unit</th>
                          <th className="p-2">Description</th>
                          <th className="p-2">Manufacturer & Model</th>
                          <th className="p-2">Sheet Ref</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {batch.rfq_line_items?.map((li, idx) => {
                          const mat = li.materials
                          if (!mat) return null
                          return (
                            <tr key={idx} className="hover:bg-white">
                              <td className="p-2 text-gray-500">{mat.item_number}</td>
                              <td className="p-2 font-semibold">{mat.quantity} {mat.unit}</td>
                              <td className="p-2 text-gray-800">{mat.description}</td>
                              <td className="p-2 text-gray-600">{mat.manufacturer} <span className="font-mono bg-white px-1 border rounded">{mat.model_number}</span></td>
                              <td className="p-2 text-blue-600 font-medium">{mat.sheet_reference || '—'}</td>
                            </tr>
                          )
                        })}
                        {(!batch.rfq_line_items || batch.rfq_line_items.length === 0) && (
                          <tr>
                            <td colSpan={5} className="p-3 text-center text-gray-400">No itemized details recorded for this batch.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })}

          {history.length === 0 && (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-400 text-sm">
              No sent RFQ records found. Dispatched vendor quotes from your project dashboards will automatically log here!
            </div>
          )}
        </div>
      )}
    </div>
  )
}