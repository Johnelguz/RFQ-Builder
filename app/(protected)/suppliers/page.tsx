'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { hasAnyRole, useAuth } from '@/lib/auth-context'

interface Supplier {
  id: string
  company_name: string
  contact_name: string
  email: string
  specialties: string[]
  is_active: boolean
}

export default function SuppliersPage() {
  const { roles } = useAuth()
  const canManageSuppliers = hasAnyRole(roles, ['ADMIN', 'RFQ_MANAGER'])
  const isAdmin = hasAnyRole(roles, ['ADMIN'])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null)
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    specialties: ''
  })

  useEffect(() => {
    fetchSuppliers()
  }, [])

  async function fetchSuppliers() {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('company_name', { ascending: true })

    if (error) {
      alert('Error fetching suppliers: ' + error.message)
    } else if (data) {
      setSuppliers(data)
    }
  }

  async function handleAddSupplier(e: React.FormEvent) {
    e.preventDefault()

    const specArray = form.specialties
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    const supplierData = {
      company_name: form.company_name,
      contact_name: form.contact_name,
      email: form.email,
      specialties: specArray
    }
    const { error } = editingSupplierId
      ? await supabase.from('suppliers').update(supplierData).eq('id', editingSupplierId)
      : await supabase.from('suppliers').insert([{ ...supplierData, is_active: true }])

    if (error) {
      alert(`${editingSupplierId ? 'Error updating supplier: ' : 'Error adding supplier: '}${error.message}`)
    } else {
      setForm({ company_name: '', contact_name: '', email: '', specialties: '' })
      setEditingSupplierId(null)
      fetchSuppliers()
    }
  }

  function handleEditSupplier(supplier: Supplier) {
    setEditingSupplierId(supplier.id)
    setForm({
      company_name: supplier.company_name,
      contact_name: supplier.contact_name || '',
      email: supplier.email,
      specialties: supplier.specialties?.join(', ') || ''
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleCancelEdit() {
    setEditingSupplierId(null)
    setForm({ company_name: '', contact_name: '', email: '', specialties: '' })
  }

  async function handleDeleteSupplier(id: string, companyName: string) {
    if (!confirm(`Permanently delete ${companyName}? Associated RFQ dispatch history will also be deleted. Invoices and vendor quotes will retain their saved vendor names.`)) return

    const { error: batchError } = await supabase.from('rfq_batches').delete().eq('supplier_id', id)
    if (batchError) {
      alert(`Unable to delete associated RFQ dispatch history: ${batchError.message}`)
      return
    }

    const { error } = await supabase.from('suppliers').delete().eq('id', id)

    if (error) {
      alert('Delete error: ' + error.message)
    } else {
      fetchSuppliers()
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 font-sans">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Supplier & Sales Rep Directory</h1>
          <p className="text-xs text-gray-500 mt-1">Manage vendor contacts and direct email dispatch addresses</p>
        </div>
        <Link href="/" className="text-xs text-blue-600 hover:underline font-semibold">
          ← Back to Dashboard
        </Link>
      </div>

      {canManageSuppliers && <>
      {/* Add Supplier Form */}
      <div className="bg-gray-50 p-4 rounded-lg border mb-8">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
          {editingSupplierId ? 'Edit Supplier / Sales Rep' : 'Add New Supplier / Sales Rep'}
        </h3>
        <form onSubmit={handleAddSupplier} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Company Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Cooper Electric"
              value={form.company_name}
              onChange={e => setForm({ ...form, company_name: e.target.value })}
              className="w-full p-2 border rounded text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Sales Rep Name</label>
            <input
              type="text"
              placeholder="e.g. Dan Miller"
              value={form.contact_name}
              onChange={e => setForm({ ...form, contact_name: e.target.value })}
              className="w-full p-2 border rounded text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Email Address</label>
            <input
              type="email"
              required
              placeholder="e.g. rep@cooperelectric.com"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full p-2 border rounded text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Specialties (comma separated)</label>
            <input
              type="text"
              placeholder="e.g. Gear, Lighting, Enclosures"
              value={form.specialties}
              onChange={e => setForm({ ...form, specialties: e.target.value })}
              className="w-full p-2 border rounded text-sm bg-white"
            />
          </div>
          <div className="md:col-span-2 lg:col-span-4 flex justify-end pt-2">
            <button
              type="submit"
              className="bg-blue-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {editingSupplierId ? 'Save Supplier' : '+ Add Supplier'}
            </button>
            {editingSupplierId && (
              <button type="button" onClick={handleCancelEdit} className="rounded border bg-white px-4 py-2 text-sm font-medium text-gray-700">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
      </>}

      {/* Supplier Directory Table */}
      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b text-xs text-gray-700 uppercase">
              <th className="p-3">Company</th>
              <th className="p-3">Sales Rep</th>
              <th className="p-3">Email</th>
              <th className="p-3">Specialties</th>
              {canManageSuppliers && <th className="p-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {suppliers.map(sup => (
              <tr key={sup.id} className="hover:bg-gray-50">
                <td className="p-3 font-semibold text-gray-800">{sup.company_name}</td>
                <td className="p-3 text-gray-600">{sup.contact_name || '—'}</td>
                <td className="p-3 font-mono text-xs text-blue-600">{sup.email}</td>
                <td className="p-3 text-xs text-gray-500">
                  {sup.specialties && sup.specialties.length > 0
                    ? sup.specialties.join(', ')
                    : 'General'}
                </td>
                {canManageSuppliers && <td className="p-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleEditSupplier(sup)}
                      className="rounded border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                    >
                      Edit
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handleDeleteSupplier(sup.id, sup.company_name)}
                        className="rounded border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>}
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={canManageSuppliers ? 5 : 4} className="p-6 text-center text-gray-400">
                  No suppliers found. {canManageSuppliers ? 'Use the form above to add your primary vendors.' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}