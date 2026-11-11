export const SUBMITTAL_TYPES = [
  'Shop Drawing',
  'Product Data',
  'Sample',
  'Mockup',
  'Test Report',
  'Certificate',
  'O&M Manual',
  'Other'
] as const

export const BALL_IN_COURT_OPTIONS = [
  'Us',
  'GC',
  'Architect',
  'Engineer',
  'Owner',
  'Supplier',
  'Other'
] as const

export const REVISION_STATUSES = [
  'Not Started',
  'Preparing',
  'Sent',
  'Approved',
  'Approved as Noted',
  'Revise & Resubmit',
  'Rejected',
  'Void'
] as const

export type SubmittalType = (typeof SUBMITTAL_TYPES)[number]
export type BallInCourt = (typeof BALL_IN_COURT_OPTIONS)[number]
export type RevisionStatus = (typeof REVISION_STATUSES)[number]
export type SubmittalOverallStatus =
  | 'In Progress'
  | 'Awaiting Response'
  | 'Needs Resubmittal'
  | 'Closed (Approved)'
  | 'Void'

export interface SubmittalRevision {
  id: string
  submittal_id: string
  revision_number: number
  status: RevisionStatus
  transmittal_number: string | null
  sent_to: string | null
  date_sent: string | null
  response_date: string | null
  reviewer_comments: string | null
  next_followup_date: string | null
  followup_count: number
  sent_via: 'Gmail Draft' | 'Manual' | null
  draft_pending: boolean
  draft_created_at: string | null
  gmail_draft_id: string | null
  draft_subject: string | null
  draft_type: 'Initial' | 'Resubmittal' | 'Follow-up' | null
  submittal_documents?: SubmittalDocument[]
  created_at: string
  updated_at: string
}

export interface Submittal {
  id: string
  project_id: string
  name: string
  item_number: number
  spec_section: string | null
  description: string | null
  type: SubmittalType
  responsible_party: string | null
  ball_in_court: BallInCourt
  required_by_date: string | null
  notes: string | null
  followup_interval_business_days: number
  created_at: string
  updated_at: string
  submittal_revisions: SubmittalRevision[]
}

export interface SubmittalActivity {
  id: string
  submittal_id: string
  revision_id: string | null
  event_type: string
  description: string
  created_by: string | null
  timestamp: string
}

export interface SubmittalDocument {
  id: string
  revision_id: string
  drive_file_id: string
  drive_url: string
  file_name: string
  mime_type: string | null
  label: string | null
  created_by: string | null
  created_at: string
}

export interface NextRevisionDraft {
  revision_number: number
  status: 'Preparing'
  sent_to: string | null
}

export function latestRevision(revisions: SubmittalRevision[]) {
  return [...revisions].sort((a, b) => b.revision_number - a.revision_number)[0] ?? null
}

export function currentActiveRevision(revisions: SubmittalRevision[]) {
  return [...revisions]
    .filter(revision => revision.status !== 'Void')
    .sort((a, b) => b.revision_number - a.revision_number)[0] ?? null
}

export function nextRevisionNumber(revisions: Pick<SubmittalRevision, 'revision_number'>[]) {
  return revisions.reduce((highest, revision) => Math.max(highest, revision.revision_number), -1) + 1
}

export function buildNextRevision(revisions: SubmittalRevision[]): NextRevisionDraft {
  return {
    revision_number: nextRevisionNumber(revisions),
    status: 'Preparing',
    sent_to: latestRevision(revisions)?.sent_to || null
  }
}

export function deriveSubmittalStatus(revisions: SubmittalRevision[]): SubmittalOverallStatus {
  if (revisions.length === 0) return 'In Progress'
  if (revisions.every(revision => revision.status === 'Void')) return 'Void'

  const activeRevision = currentActiveRevision(revisions)

  if (!activeRevision) return 'Void'
  switch (activeRevision.status) {
    case 'Approved':
    case 'Approved as Noted':
      return 'Closed (Approved)'
    case 'Revise & Resubmit':
    case 'Rejected':
      return 'Needs Resubmittal'
    case 'Sent':
      return 'Awaiting Response'
    case 'Not Started':
    case 'Preparing':
    case 'Void':
      return 'In Progress'
  }
}

function parseDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function addBusinessDays(date: string, businessDays: number) {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new RangeError('Business days must be a non-negative integer.')
  }
  const result = parseDate(date)
  let remaining = businessDays
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    const weekday = result.getUTCDay()
    if (weekday !== 0 && weekday !== 6) remaining -= 1
  }
  return formatDate(result)
}

export function calendarDaysBetween(startDate: string, endDate: string) {
  return Math.floor((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 86_400_000)
}

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatDateForDisplay(date: string | null) {
  if (!date) return '—'
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString()
}

export function submittalIsApproved(revisions: SubmittalRevision[]) {
  return deriveSubmittalStatus(revisions) === 'Closed (Approved)'
}

export function submittalIsOverdue(submittal: Submittal, today = localDateString()) {
  const status = deriveSubmittalStatus(submittal.submittal_revisions)
  if (status === 'Closed (Approved)' || status === 'Void') return false
  const latest = currentActiveRevision(submittal.submittal_revisions)
  return Boolean(
    (submittal.required_by_date && submittal.required_by_date < today)
    || (latest?.next_followup_date && latest.next_followup_date < today)
  )
}
