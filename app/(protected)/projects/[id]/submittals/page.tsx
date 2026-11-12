'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { useFormDraftState } from '@/lib/form-drafts'
import { supabase } from '@/lib/supabase'
import {
  BALL_IN_COURT_OPTIONS,
  calendarDaysBetween,
  currentActiveRevision,
  deriveSubmittalStatus,
  formatDateForDisplay,
  localDateString,
  SUBMITTAL_TYPES,
  submittalIsApproved,
  submittalIsOverdue,
  type BallInCourt,
  type Submittal,
  type SubmittalOverallStatus,
  type SubmittalType
} from '@/lib/submittals'

type FilterTab = 'All' | 'Open' | 'Awaiting Response' | 'Needs Resubmittal' | 'Approved' | 'Overdue'
type SortKey = 'name' | 'status' | 'required_by_date' | 'item_number'

interface CreateForm {
  name: string
  type: SubmittalType
  spec_section: string
  description: string
  responsible_party: string
  ball_in_court: BallInCourt
  required_by_date: string
  notes: string
  followup_interval_business_days: number
}

const EMPTY_FORM: CreateForm = {
  name: '',
  type: 'Product Data',
  spec_section: '',
  description: '',
  responsible_party: '',
  ball_in_court: 'Us',
  required_by_date: '',
  notes: '',
  followup_interval_business_days: 5
}

const FILTER_TABS: FilterTab[] = [
  'All',
  'Open',
  'Awaiting Response',
  'Needs Resubmittal',
  'Approved',
  'Overdue'
]

function statusClass(status: SubmittalOverallStatus) {
  switch (status) {
    case 'Awaiting Response':
      return 'bg-blue-100 text-blue-800'
    case 'Needs Resubmittal':
      return 'bg-rose-100 text-rose-800'
    case 'Closed (Approved)':
      return 'bg-emerald-100 text-emerald-800'
    case 'Void':
      return 'bg-gray-200 text-gray-700'
    default:
      return 'bg-amber-100 text-amber-900'
  }
}

function itemLabel(itemNumber: number) {
  return `S-${String(itemNumber).padStart(3, '0')}`
}

function daysOutstanding(submittal: Submittal, today: string) {
  const sentDate = currentActiveRevision(submittal.submittal_revisions)?.date_sent
  return sentDate && !submittalIsApproved(submittal.submittal_revisions)
    ? Math.max(0, calendarDaysBetween(sentDate, today))
    : null
}

export default function SubmittalsPage() {
  const params = useParams()
  const projectId = params?.id as string
  const { roles, user } = useAuth()
  const canManage = hasAnyRole(roles, ['ADMIN', 'RFQ_MANAGER'])
  const [projectName, setProjectName] = useState('')
  const [submittals, setSubmittals] = useState<Submittal[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:search`, '')
  const [activeTab, setActiveTab] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:filter-tab`, 'All' as FilterTab)
  const [typeFilter, setTypeFilter] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:type-filter`, '')
  const [ballFilter, setBallFilter] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:ball-filter`, '')
  const [responsibleFilter, setResponsibleFilter] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:responsible-filter`, '')
  const [sortKey, setSortKey] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:sort-key`, 'name' as SortKey)
  const [sortAscending, setSortAscending] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:sort-ascending`, true)
  const [showCreateForm, setShowCreateForm] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:create-open`, false)
  const [form, setForm] = useFormDraftState(user?.id ?? null, `project:${projectId}:submittals:create-form`, EMPTY_FORM)
  const today = localDateString()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    const [projectResult, submittalResult] = await Promise.all([
      supabase.from('projects').select('name').eq('id', projectId).single(),
      supabase
        .from('submittals')
        .select('*, submittal_revisions(*)')
        .eq('project_id', projectId)
        .order('item_number', { ascending: true })
    ])

    if (projectResult.error) setError(`Unable to load project: ${projectResult.error.message}`)
    else setProjectName(projectResult.data.name)

    if (submittalResult.error) {
      setError(current => [
        current,
        `Unable to load submittals: ${submittalResult.error.message}`
      ].filter(Boolean).join(' '))
    } else {
      setSubmittals((submittalResult.data || []) as unknown as Submittal[])
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchData(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  const responsibleOptions = useMemo(
    () => [...new Set(submittals.map(item => item.responsible_party).filter((value): value is string => Boolean(value)))].sort(),
    [submittals]
  )

  const counts = useMemo(() => {
    const statuses = submittals.map(item => deriveSubmittalStatus(item.submittal_revisions))
    const approved = statuses.filter(status => status === 'Closed (Approved)').length
    return {
      total: submittals.length,
      awaiting: statuses.filter(status => status === 'Awaiting Response').length,
      resubmittal: statuses.filter(status => status === 'Needs Resubmittal').length,
      approved,
      overdue: submittals.filter(item => submittalIsOverdue(item, today)).length,
      approvedPercent: submittals.length === 0 ? 0 : Math.round((approved / submittals.length) * 100)
    }
  }, [submittals, today])

  const filteredSubmittals = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = submittals.filter(item => {
      const status = deriveSubmittalStatus(item.submittal_revisions)
      if (activeTab === 'Open' && (status === 'Closed (Approved)' || status === 'Void')) return false
      if (activeTab === 'Awaiting Response' && status !== 'Awaiting Response') return false
      if (activeTab === 'Needs Resubmittal' && status !== 'Needs Resubmittal') return false
      if (activeTab === 'Approved' && status !== 'Closed (Approved)') return false
      if (activeTab === 'Overdue' && !submittalIsOverdue(item, today)) return false
      if (typeFilter && item.type !== typeFilter) return false
      if (ballFilter && item.ball_in_court !== ballFilter) return false
      if (responsibleFilter && item.responsible_party !== responsibleFilter) return false
      if (!query) return true
      return [item.name, item.description, item.spec_section]
        .some(value => value?.toLowerCase().includes(query))
    })

    return filtered.sort((a, b) => {
      let comparison = 0
      if (sortKey === 'name') comparison = a.name.localeCompare(b.name)
      if (sortKey === 'status') comparison = deriveSubmittalStatus(a.submittal_revisions).localeCompare(deriveSubmittalStatus(b.submittal_revisions))
      if (sortKey === 'required_by_date') comparison = (a.required_by_date || '9999-12-31').localeCompare(b.required_by_date || '9999-12-31')
      if (sortKey === 'item_number') comparison = a.item_number - b.item_number
      return comparison * (sortAscending ? 1 : -1)
    })
  }, [activeTab, ballFilter, responsibleFilter, search, sortAscending, sortKey, submittals, today, typeFilter])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAscending(value => !value)
    else {
      setSortKey(key)
      setSortAscending(true)
    }
  }

  async function handleCreateSubmittal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) {
      setError('Enter a submittal name.')
      return
    }
    setSaving(true)
    setError(null)

    const { data: existingNames, error: existingError } = await supabase
      .from('submittals')
      .select('name')
      .eq('project_id', projectId)

    if (existingError) {
      setError(`Unable to check for duplicate names: ${existingError.message}`)
      setSaving(false)
      return
    }
    if (existingNames?.some(item => item.name.trim().toLowerCase() === name.toLowerCase())) {
      setError(`A submittal named "${name}" already exists in this project. Choose a unique name.`)
      setSaving(false)
      return
    }

    const { data, error: createError } = await supabase.rpc('create_submittal', {
      p_project_id: projectId,
      p_name: name,
      p_type: form.type,
      p_spec_section: form.spec_section,
      p_description: form.description,
      p_responsible_party: form.responsible_party,
      p_ball_in_court: form.ball_in_court,
      p_required_by_date: form.required_by_date || null,
      p_notes: form.notes,
      p_followup_interval_business_days: form.followup_interval_business_days
    })

    if (createError || !data) {
      setError(`Unable to create submittal: ${createError?.message || 'No submittal ID was returned.'}`)
      setSaving(false)
      return
    }
    setForm(EMPTY_FORM)
    setShowCreateForm(false)
    await fetchData()
    setSaving(false)
  }

  return (
    <main className="mx-auto max-w-7xl p-4 font-sans sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/projects/${projectId}`} className="text-sm font-semibold text-blue-700 hover:underline">
            ← {projectName || 'Project'}
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Submittal Log</h1>
          <p className="mt-1 text-sm text-gray-600">{projectName}</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => { setError(null); setShowCreateForm(value => !value) }}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            {showCreateForm ? 'Cancel' : '+ Add Submittal'}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {showCreateForm && canManage && (
        <form onSubmit={handleCreateSubmittal} className="mb-6 rounded-xl border bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-4 text-lg font-bold text-gray-900">Add Submittal</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-medium text-gray-700">
              Name <span className="text-red-600">*</span>
              <input required maxLength={255} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded border p-2" placeholder="Concrete Mix Design" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Type
              <select value={form.type} onChange={event => setForm({ ...form, type: event.target.value as SubmittalType })} className="mt-1 w-full rounded border bg-white p-2">
                {SUBMITTAL_TYPES.map(type => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">
              Spec Section (optional)
              <input maxLength={100} value={form.spec_section} onChange={event => setForm({ ...form, spec_section: event.target.value })} className="mt-1 w-full rounded border p-2" placeholder="03 30 00" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Responsible Party
              <input value={form.responsible_party} onChange={event => setForm({ ...form, responsible_party: event.target.value })} className="mt-1 w-full rounded border p-2" placeholder="Supplier, subcontractor, or me" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Ball in Court
              <select value={form.ball_in_court} onChange={event => setForm({ ...form, ball_in_court: event.target.value as BallInCourt })} className="mt-1 w-full rounded border bg-white p-2">
                {BALL_IN_COURT_OPTIONS.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">
              Needed By
              <input type="date" value={form.required_by_date} onChange={event => setForm({ ...form, required_by_date: event.target.value })} className="mt-1 w-full rounded border p-2" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Follow-up interval (business days)
              <input type="number" min={1} max={60} required value={form.followup_interval_business_days} onChange={event => setForm({ ...form, followup_interval_business_days: Number(event.target.value) })} className="mt-1 w-full rounded border p-2" />
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">
              Description
              <input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className="mt-1 w-full rounded border p-2" />
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2 lg:col-span-3">
              Notes
              <textarea rows={2} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} className="mt-1 w-full rounded border p-2" />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? 'Saving…' : 'Create Rev 0'}
            </button>
          </div>
        </form>
      )}

      <section aria-label="Submittal summary" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Awaiting Response', counts.awaiting],
          ['Needs Resubmittal', counts.resubmittal],
          ['Overdue', counts.overdue],
          ['Approved', counts.approved],
          ['Total', counts.total]
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="text-xs font-semibold text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
          </div>
        ))}
      </section>

      <section aria-label="Submittal progress" className="mb-5 rounded-lg border bg-white p-3 shadow-sm">
        <div className="mb-2 flex justify-between text-xs font-semibold text-gray-600">
          <span>Approved progress</span><span>{counts.approvedPercent}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Percent of submittals approved"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={counts.approvedPercent}
          className="h-2 overflow-hidden rounded-full bg-gray-100"
        >
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${counts.approvedPercent}%` }} />
        </div>
      </section>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter submittals">
        {FILTER_TABS.map(tab => (
          <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeTab === tab ? 'border-blue-700 bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
            {tab}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input aria-label="Search submittals" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, description, spec…" className="rounded border bg-white p-2 text-sm" />
        <select aria-label="Filter by type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="rounded border bg-white p-2 text-sm">
          <option value="">All types</option>{SUBMITTAL_TYPES.map(type => <option key={type}>{type}</option>)}
        </select>
        <select aria-label="Filter by ball in court" value={ballFilter} onChange={event => setBallFilter(event.target.value)} className="rounded border bg-white p-2 text-sm">
          <option value="">All ball-in-court values</option>{BALL_IN_COURT_OPTIONS.map(value => <option key={value}>{value}</option>)}
        </select>
        <select aria-label="Filter by responsible party" value={responsibleFilter} onChange={event => setResponsibleFilter(event.target.value)} className="rounded border bg-white p-2 text-sm">
          <option value="">All responsible parties</option>{responsibleOptions.map(value => <option key={value}>{value}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        {loading ? (
          <p className="p-10 text-center text-sm text-gray-500">Loading submittals…</p>
        ) : (
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="p-3"><button onClick={() => toggleSort('name')}>Name ↕</button></th>
                <th className="p-3">Type</th>
                <th className="p-3">Current Rev</th>
                <th className="p-3"><button onClick={() => toggleSort('status')}>Status ↕</button></th>
                <th className="p-3">Ball in Court</th>
                <th className="p-3">Date Sent</th>
                <th className="p-3">Days Out</th>
                <th className="p-3"><button onClick={() => toggleSort('required_by_date')}>Needed By ↕</button></th>
                <th className="p-3">Next Follow-up</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredSubmittals.map(item => {
                const status = deriveSubmittalStatus(item.submittal_revisions)
                const revision = currentActiveRevision(item.submittal_revisions)
                const overdue = submittalIsOverdue(item, today)
                return (
                  <tr key={item.id} className={overdue ? 'bg-rose-50' : 'hover:bg-gray-50'}>
                    <td className="p-3">
                      <Link href={`/projects/${projectId}/submittals/${item.id}`} className="font-semibold text-blue-800 hover:underline">{item.name}</Link>
                      <div className="mt-0.5 text-xs text-gray-500">{itemLabel(item.item_number)}{item.spec_section ? ` · ${item.spec_section}` : ''}</div>
                    </td>
                    <td className="p-3">{item.type}</td>
                    <td className="p-3">{revision ? `Rev ${revision.revision_number}` : '—'}</td>
                    <td className="p-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClass(status)}`}>{status}</span></td>
                    <td className="p-3">{item.ball_in_court}</td>
                    <td className="p-3">{formatDateForDisplay(revision?.date_sent || null)}</td>
                    <td className="p-3">{daysOutstanding(item, today) ?? '—'}</td>
                    <td className="p-3">{formatDateForDisplay(item.required_by_date)}</td>
                    <td className="p-3">{formatDateForDisplay(revision?.next_followup_date || null)}</td>
                  </tr>
                )
              })}
              {filteredSubmittals.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-sm text-gray-500">{submittals.length ? 'No submittals match these filters.' : 'No submittals yet. Add one to start the project log.'}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-right text-xs text-gray-500">
        {filteredSubmittals.length} of {submittals.length} submittals
        <button type="button" onClick={() => toggleSort('item_number')} className="ml-3 text-blue-700 hover:underline">Sort by item number</button>
      </p>
    </main>
  )
}
