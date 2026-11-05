'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { Archive, ArrowUpRight, CircleCheck, ClipboardList, Gavel, LoaderCircle, Plus, Trash2 } from 'lucide-react'

interface Project {
  id: string
  name: string
  job_number: string | null
  location: string | null
  status: string | null
  updated_at: string | null
}

export default function Home() {
  const router = useRouter()
  const { roles } = useAuth()
  const canCreateProjects = hasAnyRole(roles, ['ADMIN', 'RFQ_MANAGER'])
  const isAdmin = hasAnyRole(roles, ['ADMIN'])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectName, setProjectName] = useState('')
  const [rfqProjectId, setRfqProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingStatusProjectId, setSavingStatusProjectId] = useState<string | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchProjects() {
    const { data, error: projectError } = await supabase
      .from('projects')
      .select('id, name, job_number, location, status, updated_at')
      .order('updated_at', { ascending: false })

    if (projectError) setError(`Unable to load projects: ${projectError.message}`)
    else {
      setProjects(data || [])
      setError(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchProjects(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function handleCreateProject(event: React.FormEvent) {
    event.preventDefault()
    const name = projectName.trim()
    if (!name) return

    setSaving(true)
    setError(null)
    const { data, error: insertError } = await supabase
      .from('projects')
      .insert({ name })
      .select('id')
      .single()

    if (insertError || !data) {
      setError(`Unable to create project: ${insertError?.message || 'No project ID was returned.'}`)
      setSaving(false)
      return
    }
    router.push(`/projects/${data.id}`)
  }

  function handleStartRfq(event: React.FormEvent) {
    event.preventDefault()
    if (!rfqProjectId) return
    router.push(`/projects/${rfqProjectId}?openRfq=1`)
  }

  async function handleProjectStatusChange(projectId: string, status: string) {
    setSavingStatusProjectId(projectId)
    setError(null)
    try {
      const { data, error: updateError } = await supabase
        .from('projects')
        .update({ status })
        .eq('id', projectId)
        .select('id')
        .single()

      if (updateError || !data) {
        setError(`Unable to update project status: ${updateError?.message || 'Project was not found.'}`)
        return
      }

      setProjects(current => current.map(project => project.id === projectId ? { ...project, status } : project))
    } catch (updateError) {
      setError(`Unable to update project status: ${updateError instanceof Error ? updateError.message : 'Unexpected network error.'}`)
    } finally {
      setSavingStatusProjectId(null)
    }
  }

  async function handleDeleteProject(project: Project) {
    if (!confirm(`Permanently delete "${project.name}" and all associated takeoff, RFQ, quote, and invoice records? This cannot be undone.`)) return

    setDeletingProjectId(project.id)
    setError(null)
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session.session?.access_token) {
        setError(`Unable to verify your sign-in: ${sessionError?.message || 'Sign in again before deleting a project.'}`)
        return
      }

      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.session.access_token}` }
      })
      const responseData: unknown = await response.json()
      if (!response.ok || typeof responseData !== 'object' || responseData === null
        || !('deleted' in responseData) || responseData.deleted !== true) {
        const message = typeof responseData === 'object' && responseData !== null
          && 'error' in responseData && typeof responseData.error === 'string'
          ? responseData.error
          : 'Unable to delete project.'
        setError(message)
        return
      }

      setProjects(current => current.filter(item => item.id !== project.id))
      setRfqProjectId(current => current === project.id ? '' : current)
      if ('warning' in responseData && typeof responseData.warning === 'string') setError(responseData.warning)
    } catch (deleteError) {
      setError(`Unable to delete project: ${deleteError instanceof Error ? deleteError.message : 'Unexpected network error.'}`)
    } finally {
      setDeletingProjectId(null)
    }
  }

  function renderProjectCard(project: Project) {
    const status = (project.status || 'bidding').toLowerCase()
    return (
      <article
        key={project.id}
        className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:border-blue-300 hover:shadow-lg active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-800"
      >
        <button
          type="button"
          onClick={() => router.push(`/projects/${project.id}`)}
          className="flex w-full items-center justify-between gap-3 text-left text-base font-semibold text-slate-900 transition-colors group-hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-slate-100 dark:group-hover:text-blue-300 dark:focus-visible:ring-offset-slate-900"
        >
          <span className="truncate">{project.name}</span>
          <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 opacity-70 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-blue-600 group-hover:opacity-100 dark:group-hover:text-blue-300" />
        </button>
        <span className="mt-2 block text-xs leading-5 text-slate-500 dark:text-slate-400">
          {project.job_number ? `Job ${project.job_number}` : 'No job number'}
          {project.location ? ` · ${project.location}` : ''}
        </span>
        {canCreateProjects ? (
          <label className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            Status
            <select
              value={status}
              disabled={savingStatusProjectId === project.id}
              onChange={event => void handleProjectStatusChange(project.id, event.target.value)}
              aria-label={`Status for ${project.name}`}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {!knownStatuses.includes(status) && <option value={status}>{project.status}</option>}
              <option value="awarded">Awarded</option>
              <option value="bidding">Bidding</option>
              <option value="closed">Closed</option>
            </select>
            {savingStatusProjectId === project.id && (
              <span role="status" aria-label="Saving status">
                <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-blue-600" />
              </span>
            )}
          </label>
        ) : (
          <span className="mt-4 inline-block rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {project.status || 'bidding'}
          </span>
        )}
        {isAdmin && (
          <button
            type="button"
            disabled={deletingProjectId === project.id}
            onClick={() => void handleDeleteProject(project)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            {deletingProjectId === project.id ? 'Deleting…' : 'Delete project'}
          </button>
        )}
      </article>
    )
  }

  const projectColumns = [
    { status: 'awarded', title: 'Awarded', Icon: CircleCheck, iconClass: 'text-emerald-600 dark:text-emerald-400' },
    { status: 'bidding', title: 'Bidding', Icon: Gavel, iconClass: 'text-blue-600 dark:text-blue-400' },
    { status: 'closed', title: 'Closed', Icon: Archive, iconClass: 'text-slate-500 dark:text-slate-400' }
  ].map(column => ({
    ...column,
    projects: projects.filter(project => (project.status || 'bidding').toLowerCase() === column.status)
  }))
  const knownStatuses = projectColumns.map(column => column.status)
  const otherProjects = projects.filter(project =>
    !knownStatuses.includes((project.status || 'bidding').toLowerCase())
  )

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:py-10 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold tracking-wide text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/60 dark:text-blue-300">
              <ClipboardList aria-hidden="true" className="h-3.5 w-3.5" />
              PROJECT WORKSPACE
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Projects</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              Shared project takeoffs and RFQ history for your team.
            </p>
          </div>
          {canCreateProjects && (
            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[38rem]">
              <form onSubmit={handleStartRfq} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Start an RFQ for
                  <select
                    required
                    value={rfqProjectId}
                    onChange={event => setRfqProjectId(event.target.value)}
                    aria-label="Choose a project for the RFQ"
                    className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Choose project…</option>
                    {projects.map(project => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!rfqProjectId}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ClipboardList aria-hidden="true" className="h-4 w-4" />
                  Create RFQ
                </button>
              </form>
              <form onSubmit={handleCreateProject} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <label htmlFor="new-project-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Add a project
                </label>
                <input
                  id="new-project-name"
                  required
                  value={projectName}
                  onChange={event => setProjectName(event.target.value)}
                  placeholder="New project name"
                  aria-label="New project name"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800 placeholder:text-slate-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <button
                  disabled={saving}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:bg-blue-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:cursor-wait disabled:opacity-60"
                >
                  {saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
                  {saving ? 'Creating…' : 'Create project'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl">
        {error && (
          <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {loading ? (
          <section aria-label="Loading projects" aria-busy="true" className="grid items-start gap-5 md:grid-cols-3">
            <div role="status" className="sr-only">Loading projects</div>
            {[0, 1, 2].map(column => (
              <div key={column} aria-hidden="true" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
                  <div className="h-6 w-8 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
                </div>
                <div className="space-y-3">
                  {[0, 1].map(card => (
                    <div key={card} className="animate-pulse rounded-xl border border-slate-100 p-4 motion-reduce:animate-none dark:border-slate-800">
                      <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="mt-3 h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
                      <div className="mt-4 h-6 w-20 rounded-lg bg-slate-100 dark:bg-slate-800" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <section aria-label="Projects by status" className="grid items-start gap-5 md:grid-cols-3">
            {projectColumns.map(column => (
              <div key={column.status} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="mb-4 flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <column.Icon aria-hidden="true" className={`h-4 w-4 ${column.iconClass}`} />
                    {column.title}
                  </h2>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                    {column.projects.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {column.projects.map(renderProjectCard)}
                  {column.projects.length === 0 && (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
                      No {column.title.toLowerCase()} projects.
                    </p>
                  )}
                </div>
              </div>
            ))}
            {otherProjects.length > 0 && (
              <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="mb-4 flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Other</h2>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                    {otherProjects.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {otherProjects.map(renderProjectCard)}
                </div>
              </div>
            )}
            {projects.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center md:col-span-3 dark:border-slate-700 dark:bg-slate-900">
                <ClipboardList aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500" />
                <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">No projects yet</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {canCreateProjects ? 'Create a project to get started.' : 'Ask an RFQ Manager to create a project.'}
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
