'use client'

import { useState, useEffect, Suspense } from 'react'
import { supabase } from '@/lib/supabase'

interface Supplier {
  id: string
  company_name: string
  contact_name: string
  email: string
  specialties: string[]
  is_active: boolean
}

function SupplierManagementContent() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  // Form state
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [specialtiesText, setSpecialtiesText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    fetchSuppliers()
  }, [])

  async function fetchSuppliers() {
    setLoading(true)
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('company_name', { ascending: true })

    if (error) {
      alert('Error fetching suppliers: ' + error.message)
    } else if (data) {
      setSuppliers(data)
    }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const specialtiesArray = specialtiesText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    if (editingId) {
      // Update existing supplier
      const { error } = await supabase
        .from('suppliers')
        .update({
          company_name: companyName,
          contact_name: contactName,
          email: email,
          specialties: specialtiesArray
        })
        .eq('id', editingId)

      if (error) {
        alert('Update error: ' + error.message)
      } else {
        resetForm()
        fetchSuppliers()
      }
    } else {
      // Insert new supplier
      const { error } = await supabase
        .from('suppliers')
        .insert([{
          company_name: companyName,
          contact_name: contactName,
          email: email,
          specialties: specialtiesArray,
          is_active: true
        }])

      if (error) {
        alert('Insert error: ' + error.message)
      } else {
        resetForm()
        fetchSuppliers()
      }
    }
  }

  function handleEdit(sup: Supplier) {
    setEditingId(sup.id)
    setCompanyName(sup.company_name)
    setContactName(sup.contact_name || '')
    setEmail(sup.email)
    setSpecialtiesText(sup.specialties ? sup.specialties.join(', ') : '')
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this supplier?')) return
    const { error } = await supabase.from('suppliers').delete().eq('id', id)
    if (error) {
      alert('Delete error: ' + error.message)
    } else {
      fetchSuppliers()
    }
  }

  function resetForm() {
    setEditingId(null)
    setCompanyName('')
    setContactName('')
    setEmail('')
    setSpecialtiesText('')
  }

  return (
    <div className="max-w-6xl mx-auto p-6 font-sans">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Supplier & Vendor Directory</h1>
          <p className="text-xs text-gray-500">Manage supplier contact details, sales reps, and quote destinations.</p>
        </div>
        <a href="/" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          ← Back to Dashboard
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Form Column */}
        <div className="bg-gray-50 p-5 rounded-lg border h-fit">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">
            {editingId ? 'Edit Supplier' : 'Add New Supplier'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Company Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Cooper Electric"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="w-full p-2 border rounded text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Sales Rep / Contact Name</label>
              <input
                type="text"
                placeholder="e.g. Dan / Dave (optional)"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                className="w-full p-2 border rounded text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Email Address</label>
              <input
                type="email"
                required
                placeholder="e.g. quotes@cooper.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full p-2 border rounded text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Specialties (comma separated)</label>
              <input
                type="text"
                placeholder="e.g. Gear, Lighting, Conduit"
                value={specialtiesText}
                onChange={e => setSpecialtiesText(e.target.value)}
                className="w-full p-2 border rounded text-sm bg-white"
              />
            </div>
            <div className="pt-2 flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                {editingId ? 'Update Supplier' : 'Save Supplier'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm font-medium hover:bg-gray-300"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Directory List Column */}
        <div className="md:col-span-2">
          <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b text-xs text-gray-700 uppercase">
                  <th className="p-3">Company</th>
                  <th className="p-3">Rep Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Specialties</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm">
                {suppliers.map(sup => (
                  <tr key={sup.id} className="hover:bg-gray-50">
                    <td className="p-3 font-semibold text-gray-800">{sup.company_name}</td>
                    <td className="p-3 text-gray-700">{sup.contact_name || '—'}</td>
                    <td className="p-3 text-blue-600 font-mono text-xs">{sup.email}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {sup.specialties?.map((spec, i) => (
                          <span key={i} className="bg-gray-100 text-gray-600 text-[11px] px-1.5 py-0.5 rounded">
                            {spec}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => handleEdit(sup)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-semibold"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(sup.id)}
                        className="text-red-600 hover:text-red-800 text-xs font-semibold"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {suppliers.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-400">
                      No suppliers configured yet. Add your first supplier using the form on the left!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SuppliersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500 font-sans">Loading directory...</div>}>
      <SupplierManagementContent />
    </Suspense>
  )
}