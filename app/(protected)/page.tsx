'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasAnyRole, useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

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
  const [projects, setProjects] = useState<Project[]>([])
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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

  return (
    <main className="mx-auto w-full max-w-7xl p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Projects</h1>
          <p className="mt-1 text-sm text-gray-600">Shared project takeoffs and RFQ history for your team.</p>
        </div>
        {canCreateProjects && (
          <form onSubmit={handleCreateProject} className="flex flex-wrap gap-2">
            <input
              required
              value={projectName}
              onChange={event => setProjectName(event.target.value)}
              placeholder="New project name"
              aria-label="New project name"
              className="rounded border px-3 py-2 text-sm"
            />
            <button disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? 'Creating…' : 'Create project'}
            </button>
          </form>
        )}
      </div>

      {error && <p role="alert" className="mt-5 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-gray-500">Loading projects…</p>
      ) : (
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => (
            <button
              key={project.id}
              onClick={() => router.push(`/projects/${project.id}`)}
              className="rounded-lg border bg-white p-5 text-left shadow-sm transition hover:border-blue-400 hover:bg-blue-50/40"
            >
              <span className="block text-lg font-semibold text-gray-800">{project.name}</span>
              <span className="mt-2 block text-xs text-gray-500">
                {project.job_number ? `Job ${project.job_number}` : 'No job number'}
                {project.location ? ` · ${project.location}` : ''}
              </span>
              <span className="mt-3 inline-block rounded bg-gray-100 px-2 py-1 text-xs capitalize text-gray-600">
                {project.status || 'bidding'}
              </span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="rounded-lg border border-dashed p-8 text-sm text-gray-500 sm:col-span-2 lg:col-span-3">
              No projects found. {canCreateProjects ? 'Create a project to get started.' : 'Ask an RFQ Manager to create a project.'}
            </p>
          )}
        </section>
      )}
    </main>
  )
}
