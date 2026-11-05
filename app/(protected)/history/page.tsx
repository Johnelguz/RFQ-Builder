'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { hasAnyRole, useAuth } from '@/lib/auth-context'

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
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = searchParams.get('projectId')
  const { roles } = useAuth()
  const canManageRfqs = hasAnyRole(roles, ['ADMIN', 'RFQ_MANAGER'])
  const [history, setHistory] = useState<RFQHistoryItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState<boolean>(true)
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(() => new Set())
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredHistory = normalizedSearchQuery
    ? history.filter(batch => {
        const projectName = batch.projects?.name || ''
        const supplierName = batch.suppliers?.company_name || ''
        const supplierContact = batch.suppliers?.contact_name || ''
        const supplierEmail = batch.suppliers?.email || ''
        const dispatchDate = new Date(batch.created_at).toLocaleString()
        const hasMatchingDescription = batch.rfq_line_items?.some(lineItem =>
          [lineItem.materials?.description, lineItem.materials?.manufacturer, lineItem.materials?.model_number]
            .some(value => value?.toLowerCase().includes(normalizedSearchQuery))
        )
        return projectName.toLowerCase().includes(normalizedSearchQuery)
          || supplierName.toLowerCase().includes(normalizedSearchQuery)
          || supplierContact.toLowerCase().includes(normalizedSearchQuery)
          || supplierEmail.toLowerCase().includes(normalizedSearchQuery)
          || dispatchDate.toLowerCase().includes(normalizedSearchQuery)
          || batch.subject.toLowerCase().includes(normalizedSearchQuery)
          || hasMatchingDescription
      })
    : history

  const fetchRFQHistory = useCallback(async () => {
    setLoading(true)
    let query = supabase
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
    if (projectId) query = query.eq('project_id', projectId)
    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      alert('Error fetching RFQ history: ' + error.message)
    } else if (data) {
      setHistory(data as unknown as RFQHistoryItem[])
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchRFQHistory(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchRFQHistory])

  function toggleBatchExpanded(batchId: string) {
    setExpandedBatchIds(current => {
      const next = new Set(current)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
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
    router.push(`/projects/${batch.project_id}`)
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
          <h1 className="text-2xl font-bold text-gray-800">
            {projectId ? 'Project RFQ History' : 'All Sent RFQ History'}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {projectId
              ? 'Review RFQs dispatched for this project.'
              : 'Search and review dispatched material packages across all projects.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {projectId && (
            <Link href="/history" className="text-xs font-semibold text-blue-700 hover:underline">
              View all RFQ history
            </Link>
          )}
          {!projectId && canManageRfqs && history.length > 0 && (
            <button
              onClick={handleClearAllHistory}
              className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
            >
              Clear All RFQ Records ✕
            </button>
          )}
          <Link href="/" className="text-xs text-blue-600 hover:underline font-semibold bg-gray-50 border px-3 py-2 rounded-lg">
            ← Back to Dashboard
          </Link>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-md">
            <label htmlFor="rfq-history-search" className="mb-1 block text-sm font-semibold text-gray-700">
              Search records
            </label>
            <input
              id="rfq-history-search"
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Supplier, project, date, or product"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {!loading && (
            <span className="text-xs text-gray-600">
              Showing {filteredHistory.length} of {history.length} RFQ records
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-500">Loading RFQ history records...</div>
      ) : (
        <div className="space-y-4">
          {filteredHistory.map(batch => {
            const dispatchDate = new Date(batch.created_at).toLocaleString()
            const jobName = batch.projects?.name || 'Unknown Project'
            const companyName = batch.suppliers?.company_name || 'Unknown Supplier'
            const contactName = batch.suppliers?.contact_name || 'General Team'
            const email = batch.suppliers?.email || ''
            const isExpanded = expandedBatchIds.has(batch.id)

            return (
              <article key={batch.id} className="overflow-hidden rounded-lg border bg-white shadow-sm">
                <header className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 p-3">
                  <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-3">
                    <span className="truncate text-sm font-semibold text-gray-800">{companyName}</span>
                    <span className="truncate text-xs text-gray-500">{dispatchDate}</span>
                    <Link
                      href={`/projects/${batch.project_id}`}
                      className="truncate text-xs font-medium text-blue-700 hover:underline"
                    >
                      {jobName}
                    </Link>
                  </div>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleBatchExpanded(batch.id)}
                    className="rounded border px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </button>
                </header>
                {isExpanded && (
                  <div className="border-t p-4">
                    <div className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-base font-bold text-gray-800">
                          {companyName}{' '}
                          <span className="text-sm font-normal text-gray-600">
                            ({contactName} — <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a>)
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{batch.subject} · {batch.status}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {canManageRfqs && <button
                          onClick={() => handleReloadBatchIntoProject(batch)}
                          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                          title="Load these items back into the active takeoff list"
                        >
                          🔄 Load into Active Takeoff ➔
                        </button>}
                        {canManageRfqs && <button
                          onClick={() => handleDeleteBatch(batch.id)}
                          className="p-1 text-xs font-bold text-gray-400 transition-colors hover:text-red-600"
                          title="Delete RFQ Record"
                        >
                          ✕ Delete
                        </button>}
                      </div>
                    </div>

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
                )}
              </article>
            )
          })}

          {history.length > 0 && filteredHistory.length === 0 && (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-400 text-sm">
              No RFQ records match “{searchQuery.trim()}”.
            </div>
          )}

          {history.length === 0 && (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-400 text-sm">
              {projectId
                ? 'No RFQ records found for this project.'
                : 'No sent RFQ records found. Dispatched vendor quotes from your project dashboards will automatically log here!'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}