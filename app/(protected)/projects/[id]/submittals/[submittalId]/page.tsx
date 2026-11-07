'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import {
  addBusinessDays,
  BALL_IN_COURT_OPTIONS,
  buildNextRevision,
  currentActiveRevision,
  deriveSubmittalStatus,
  formatDateForDisplay,
  latestRevision,
  localDateString,
  SUBMITTAL_TYPES,
  type BallInCourt,
  type RevisionStatus,
  type Submittal,
  type SubmittalActivity,
  type SubmittalOverallStatus,
  type SubmittalType
} from '@/lib/submittals'

type DetailTab = 'Overview' | 'Revisions' | 'Notes / History'

interface OverviewForm {
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

const RESPONSE_STATUSES: RevisionStatus[] = ['Approved', 'Approved as Noted', 'Revise & Resubmit', 'Rejected']

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

function revisionStatusClass(status: RevisionStatus) {
  if (status === 'Approved' || status === 'Approved as Noted') return 'bg-emerald-100 text-emerald-800'
  if (status === 'Revise & Resubmit' || status === 'Rejected') return 'bg-rose-100 text-rose-800'
  if (status === 'Sent') return 'bg-blue-100 text-blue-800'
  if (status === 'Void') return 'bg-gray-200 text-gray-700'
  return 'bg-amber-100 text-amber-900'
}

function toOverviewForm(submittal: Submittal): OverviewForm {
  return {
    name: submittal.name,
    type: submittal.type,
    spec_section: submittal.spec_section || '',
    description: submittal.description || '',
    responsible_party: submittal.responsible_party || '',
    ball_in_court: submittal.ball_in_court,
    required_by_date: submittal.required_by_date || '',
    notes: submittal.notes || '',
    followup_interval_business_days: submittal.followup_interval_business_days
  }
}

function itemLabel(itemNumber: number) {
  return `S-${String(itemNumber).padStart(3, '0')}`
}

export default function SubmittalDetailPage() {
  const params = useParams()
  const projectId = params?.id as string
  const submittalId = params?.submittalId as string
  const { roles, user } = useAuth()
  const canManage = hasAnyRole(roles, ['ADMIN', 'RFQ_MANAGER'])
  const [projectName, setProjectName] = useState('')
  const [submittal, setSubmittal] = useState<Submittal | null>(null)
  const [activities, setActivities] = useState<SubmittalActivity[]>([])
  const [overview, setOverview] = useState<OverviewForm | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('Overview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showMarkSent, setShowMarkSent] = useState(false)
  const [showResponse, setShowResponse] = useState(false)
  const [sentDate, setSentDate] = useState(localDateString())
  const [sentTo, setSentTo] = useState('')
  const [responseStatus, setResponseStatus] = useState<RevisionStatus>('Approved')
  const [responseDate, setResponseDate] = useState(localDateString())
  const [reviewerComments, setReviewerComments] = useState('')
  const [createNextRevision, setCreateNextRevision] = useState(false)
  const [note, setNote] = useState('')

  const fetchData = useCallback(async () => {
    if (!projectId || !submittalId) return
    setLoading(true)
    setError(null)
    const [projectResult, submittalResult, activityResult] = await Promise.all([
      supabase.from('projects').select('name').eq('id', projectId).single(),
      supabase
        .from('submittals')
        .select('*, submittal_revisions(*)')
        .eq('id', submittalId)
        .eq('project_id', projectId)
        .single(),
      supabase
        .from('submittal_activities')
        .select('*')
        .eq('submittal_id', submittalId)
        .order('timestamp', { ascending: false })
    ])

    if (projectResult.error) setError(`Unable to load project: ${projectResult.error.message}`)
    else setProjectName(projectResult.data.name)

    if (submittalResult.error) {
      setError(current => [current, `Unable to load submittal: ${submittalResult.error.message}`].filter(Boolean).join(' '))
    } else {
      const loaded = submittalResult.data as unknown as Submittal
      loaded.submittal_revisions.sort((a, b) => a.revision_number - b.revision_number)
      setSubmittal(loaded)
      setOverview(toOverviewForm(loaded))
    }

    if (activityResult.error) {
      setError(current => [current, `Unable to load activity history: ${activityResult.error.message}`].filter(Boolean).join(' '))
    } else {
      setActivities((activityResult.data || []) as SubmittalActivity[])
    }
    setLoading(false)
  }, [projectId, submittalId])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchData(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  const sortedRevisions = useMemo(
    () => [...(submittal?.submittal_revisions || [])].sort((a, b) => b.revision_number - a.revision_number),
    [submittal]
  )
  const currentRevision = submittal ? latestRevision(submittal.submittal_revisions) : null
  const latest = submittal ? currentActiveRevision(submittal.submittal_revisions) : null
  const overallStatus = submittal ? deriveSubmittalStatus(submittal.submittal_revisions) : 'In Progress'
  const canMarkSent = Boolean(latest && ['Not Started', 'Preparing'].includes(latest.status))
  const canLogResponse = Boolean(latest?.status === 'Sent')

  async function handleSaveOverview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!overview || !submittal) return
    setSaving(true)
    setError(null)
    const { error: saveError } = await supabase.rpc('update_submittal_details', {
      p_submittal_id: submittal.id,
      p_name: overview.name,
      p_type: overview.type,
      p_spec_section: overview.spec_section,
      p_description: overview.description,
      p_responsible_party: overview.responsible_party,
      p_ball_in_court: overview.ball_in_court,
      p_required_by_date: overview.required_by_date || null,
      p_notes: overview.notes,
      p_followup_interval_business_days: overview.followup_interval_business_days
    })
    if (saveError) setError(`Unable to save submittal: ${saveError.message}`)
    else {
      setNotice('Submittal details saved.')
      await fetchData()
    }
    setSaving(false)
  }

  async function handleMarkSent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!latest || !submittal) return
    if (!sentDate) {
      setError('Enter the date this revision was sent.')
      return
    }
    if (!window.confirm('No linked Drive documents are tracked yet. You can continue and record this revision as sent. Continue?')) return
    setSaving(true)
    setError(null)
    let nextFollowupDate: string
    try {
      nextFollowupDate = addBusinessDays(sentDate, submittal.followup_interval_business_days)
    } catch (dateError) {
      setError(dateError instanceof Error ? dateError.message : 'Unable to calculate the next follow-up date.')
      setSaving(false)
      return
    }
    const { error: sendError } = await supabase.rpc('mark_submittal_revision_sent', {
      p_revision_id: latest.id,
      p_date_sent: sentDate,
      p_next_followup_date: nextFollowupDate,
      p_sent_to: sentTo
    })
    if (sendError) setError(`Unable to mark revision as sent: ${sendError.message}`)
    else {
      setNotice(`Rev ${latest.revision_number} marked sent.`)
      setShowMarkSent(false)
      await fetchData()
    }
    setSaving(false)
  }

  async function handleLogResponse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!latest || !submittal) return
    if (latest.date_sent && responseDate < latest.date_sent) {
      setError('Response date cannot be before the sent date.')
      return
    }
    const shouldCreateNext = createNextRevision
      && (responseStatus === 'Revise & Resubmit' || responseStatus === 'Rejected')
    const newRevisionNumber = buildNextRevision(submittal.submittal_revisions).revision_number
    if (shouldCreateNext && !window.confirm(`Save this response and create Rev ${newRevisionNumber}?`)) return

    setSaving(true)
    setError(null)
    const { error: responseError } = await supabase.rpc('log_submittal_revision_response', {
      p_revision_id: latest.id,
      p_status: responseStatus,
      p_response_date: responseDate,
      p_reviewer_comments: reviewerComments,
      p_create_next_revision: shouldCreateNext
    })
    if (responseError) setError(`Unable to save response: ${responseError.message}`)
    else {
      setNotice(shouldCreateNext ? `Response saved and Rev ${newRevisionNumber} created.` : 'Response saved.')
      setShowResponse(false)
      setCreateNextRevision(false)
      setReviewerComments('')
      await fetchData()
    }
    setSaving(false)
  }

  async function handleCreateRevision(reopen = false) {
    if (!submittal) return
    const currentRevision = buildNextRevision(submittal.submittal_revisions).revision_number
    const confirmation = reopen
      ? 'Reopen this approved submittal by creating a new revision?'
      : `Create Rev ${currentRevision}?`
    if (!window.confirm(confirmation)) return
    setSaving(true)
    setError(null)
    const { error: revisionError } = await supabase.rpc('create_submittal_revision', {
      p_submittal_id: submittal.id,
      p_reopen: reopen
    })
    if (revisionError) setError(`Unable to create revision: ${revisionError.message}`)
    else {
      setNotice(reopen ? 'Submittal reopened with a new revision.' : 'New revision created.')
      await fetchData()
    }
    setSaving(false)
  }

  async function handleVoidRevision(revisionId: string, revisionNumber: number) {
    if (!window.confirm(`Void Rev ${revisionNumber}? Revisions are retained in the history and cannot be deleted.`)) return
    setSaving(true)
    setError(null)
    const { error: voidError } = await supabase.rpc('void_submittal_revision', { p_revision_id: revisionId })
    if (voidError) setError(`Unable to void revision: ${voidError.message}`)
    else {
      setNotice(`Rev ${revisionNumber} voided.`)
      await fetchData()
    }
    setSaving(false)
  }

  async function handleAddNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!submittal || !note.trim()) return
    setSaving(true)
    setError(null)
    const { error: noteError } = await supabase.from('submittal_activities').insert({
      submittal_id: submittal.id,
      revision_id: latest?.id || null,
      event_type: 'note',
      description: note.trim(),
      created_by: user?.id || null
    })
    if (noteError) setError(`Unable to add note: ${noteError.message}`)
    else {
      setNote('')
      setNotice('Note added to the activity history.')
      await fetchData()
    }
    setSaving(false)
  }

  if (loading) return <main className="mx-auto max-w-5xl p-6 text-sm text-gray-500">Loading submittal…</main>
  if (!submittal) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error || 'Submittal not found.'}</p>
        <Link href={`/projects/${projectId}/submittals`} className="mt-4 inline-block text-sm text-blue-700 hover:underline">← Back to submittals</Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl p-4 font-sans sm:p-6">
      <Link href={`/projects/${projectId}/submittals`} className="text-sm font-semibold text-blue-700 hover:underline">← Submittal Log</Link>
      <header className="mb-5 mt-3 rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">{itemLabel(submittal.item_number)}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(overallStatus)}`}>{overallStatus}</span>
              <span className="text-xs text-gray-500">{submittal.ball_in_court} in court</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{submittal.name}</h1>
            <p className="mt-1 text-sm text-gray-600">{projectName} · {submittal.type}{submittal.spec_section ? ` · Spec ${submittal.spec_section}` : ''}</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {canMarkSent && <button type="button" onClick={() => { setSentDate(localDateString()); setSentTo(latest?.sent_to || ''); setShowMarkSent(true) }} className="rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800">Mark Sent</button>}
              {canLogResponse && <button type="button" onClick={() => { setResponseDate(localDateString()); setShowResponse(true) }} className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">Log Response</button>}
              {overallStatus === 'Closed (Approved)'
                ? <button type="button" disabled={saving} onClick={() => void handleCreateRevision(true)} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50">Reopen</button>
                : <button type="button" disabled={saving} onClick={() => void handleCreateRevision()} className="rounded border px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-50">Create New Revision</button>}
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-gray-500">Current Revision</div><div className="font-semibold">{currentRevision ? `Rev ${currentRevision.revision_number}` : '—'}</div></div>
          <div><div className="text-xs text-gray-500">Date Sent</div><div className="font-semibold">{formatDateForDisplay(latest?.date_sent || null)}</div></div>
          <div><div className="text-xs text-gray-500">Needed By</div><div className="font-semibold">{formatDateForDisplay(submittal.required_by_date)}</div></div>
          <div><div className="text-xs text-gray-500">Next Follow-up</div><div className="font-semibold">{formatDateForDisplay(latest?.next_followup_date || null)}</div></div>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="mb-4 flex flex-wrap gap-2 border-b" role="tablist" aria-label="Submittal detail sections">
        {(['Overview', 'Revisions', 'Notes / History'] as const).map(tab => (
          <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`border-b-2 px-4 py-2 text-sm font-semibold ${activeTab === tab ? 'border-blue-700 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Overview' && overview && (
        <form onSubmit={handleSaveOverview} className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-lg font-bold text-gray-900">Submittal Details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">Name
              <input required maxLength={255} readOnly={!canManage} value={overview.name} onChange={event => setOverview({ ...overview, name: event.target.value })} className="mt-1 w-full rounded border p-2 read-only:bg-gray-50" />
            </label>
            <label className="text-sm font-medium text-gray-700">Type
              <select disabled={!canManage} value={overview.type} onChange={event => setOverview({ ...overview, type: event.target.value as SubmittalType })} className="mt-1 w-full rounded border bg-white p-2 disabled:bg-gray-50">
                {SUBMITTAL_TYPES.map(type => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">Spec Section
              <input readOnly={!canManage} value={overview.spec_section} onChange={event => setOverview({ ...overview, spec_section: event.target.value })} className="mt-1 w-full rounded border p-2 read-only:bg-gray-50" />
            </label>
            <label className="text-sm font-medium text-gray-700">Responsible Party
              <input readOnly={!canManage} value={overview.responsible_party} onChange={event => setOverview({ ...overview, responsible_party: event.target.value })} className="mt-1 w-full rounded border p-2 read-only:bg-gray-50" />
            </label>
            <label className="text-sm font-medium text-gray-700">Ball in Court
              <select disabled={!canManage} value={overview.ball_in_court} onChange={event => setOverview({ ...overview, ball_in_court: event.target.value as BallInCourt })} className="mt-1 w-full rounded border bg-white p-2 disabled:bg-gray-50">
                {BALL_IN_COURT_OPTIONS.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">Required By
              <input type="date" readOnly={!canManage} value={overview.required_by_date} onChange={event => setOverview({ ...overview, required_by_date: event.target.value })} className="mt-1 w-full rounded border p-2 read-only:bg-gray-50" />
            </label>
            <label className="text-sm font-medium text-gray-700">Default Follow-up Interval (business days)
              <input type="number" min={1} max={60} readOnly={!canManage} value={overview.followup_interval_business_days} onChange={event => setOverview({ ...overview, followup_interval_business_days: Number(event.target.value) })} className="mt-1 w-full rounded border p-2 read-only:bg-gray-50" />
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Description
              <textarea rows={2} readOnly={!canManage} value={overview.description} onChange={event => setOverview({ ...overview, description: event.target.value })} className="mt-1 w-full rounded border p-2 read-only:bg-gray-50" />
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Notes
              <textarea rows={3} readOnly={!canManage} value={overview.notes} onChange={event => setOverview({ ...overview, notes: event.target.value })} className="mt-1 w-full rounded border p-2 read-only:bg-gray-50" />
            </label>
          </div>
          {canManage && <div className="mt-4 flex justify-end"><button disabled={saving} className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save Details'}</button></div>}
        </form>
      )}

      {activeTab === 'Revisions' && (
        <section className="space-y-4">
          {!canManage && <p className="rounded border bg-white p-3 text-xs text-gray-600">Mark Sent and response actions are managed by an RFQ manager.</p>}
          {sortedRevisions.map(revision => (
            <article key={revision.id} className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">Rev {revision.revision_number}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${revisionStatusClass(revision.status)}`}>{revision.status}</span>
                  {revision.draft_pending && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Draft created - confirm when sent</span>}
                </div>
                {canManage && revision.status !== 'Void' && (
                  <button disabled={saving} type="button" onClick={() => void handleVoidRevision(revision.id, revision.revision_number)} className="rounded border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50">Void revision</button>
                )}
              </header>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-xs text-gray-500">Sent To</dt><dd>{revision.sent_to || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Date Sent</dt><dd>{formatDateForDisplay(revision.date_sent)}</dd></div>
                <div><dt className="text-xs text-gray-500">Sent Via</dt><dd>{revision.sent_via || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Response Date</dt><dd>{formatDateForDisplay(revision.response_date)}</dd></div>
                <div><dt className="text-xs text-gray-500">Next Follow-up</dt><dd>{formatDateForDisplay(revision.next_followup_date)}</dd></div>
                <div><dt className="text-xs text-gray-500">Follow-ups Logged</dt><dd>{revision.followup_count}</dd></div>
                <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-gray-500">Reviewer Comments</dt><dd className="whitespace-pre-wrap">{revision.reviewer_comments || '—'}</dd></div>
              </dl>
            </article>
          ))}
          {sortedRevisions.length === 0 && <p className="rounded border bg-white p-8 text-center text-sm text-gray-500">No revisions recorded.</p>}
        </section>
      )}

      {activeTab === 'Notes / History' && (
        <section className="space-y-4">
          {canManage && (
            <form onSubmit={handleAddNote} className="rounded-xl border bg-white p-4 shadow-sm">
              <label htmlFor="submittal-note" className="mb-2 block text-sm font-semibold text-gray-700">Add note</label>
              <textarea id="submittal-note" required rows={3} value={note} onChange={event => setNote(event.target.value)} className="w-full rounded border p-2 text-sm" placeholder="Add a note to the permanent activity history…" />
              <div className="mt-2 flex justify-end"><button disabled={saving} className="rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Add Note</button></div>
            </form>
          )}
          <ol className="space-y-3">
            {activities.map(activity => (
              <li key={activity.id} className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex flex-col justify-between gap-1 sm:flex-row">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{activity.event_type.replaceAll('_', ' ')}</span>
                  <time className="text-xs text-gray-500">{new Date(activity.timestamp).toLocaleString()}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{activity.description}</p>
              </li>
            ))}
            {activities.length === 0 && <li className="rounded border bg-white p-8 text-center text-sm text-gray-500">No activity recorded yet.</li>}
          </ol>
        </section>
      )}

      {showMarkSent && latest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleMarkSent} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="mb-1 text-lg font-bold">Mark Rev {latest.revision_number} Sent</h2>
            <p className="mb-4 text-xs text-gray-600">This records a manual send. The next follow-up date will be {submittal.followup_interval_business_days} business days later.</p>
            <label className="mb-3 block text-sm font-medium">Date Sent
              <input type="date" required value={sentDate} onChange={event => setSentDate(event.target.value)} className="mt-1 w-full rounded border p-2" />
            </label>
            <label className="mb-4 block text-sm font-medium">Sent To
              <input value={sentTo} onChange={event => setSentTo(event.target.value)} className="mt-1 w-full rounded border p-2" placeholder="Name or email" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowMarkSent(false)} className="rounded border px-3 py-2 text-sm">Cancel</button>
              <button disabled={saving} className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Confirm Sent'}</button>
            </div>
          </form>
        </div>
      )}

      {showResponse && latest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleLogResponse} className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Log Response for Rev {latest.revision_number}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">Response
                <select value={responseStatus} onChange={event => { setResponseStatus(event.target.value as RevisionStatus); setCreateNextRevision(false) }} className="mt-1 w-full rounded border bg-white p-2">
                  {RESPONSE_STATUSES.map(status => <option key={status}>{status}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">Response Date
                <input type="date" required min={latest.date_sent || undefined} value={responseDate} onChange={event => setResponseDate(event.target.value)} className="mt-1 w-full rounded border p-2" />
              </label>
              <label className="text-sm font-medium sm:col-span-2">Reviewer Comments
                <textarea rows={4} value={reviewerComments} onChange={event => setReviewerComments(event.target.value)} className="mt-1 w-full rounded border p-2" />
              </label>
            </div>
            {(responseStatus === 'Revise & Resubmit' || responseStatus === 'Rejected') && (
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={createNextRevision} onChange={event => setCreateNextRevision(event.target.checked)} className="mt-1" />
                <span>Create Rev {buildNextRevision(submittal.submittal_revisions).revision_number} now (Preparing), carrying forward the recipient</span>
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowResponse(false)} className="rounded border px-3 py-2 text-sm">Cancel</button>
              <button disabled={saving} className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save Response'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
