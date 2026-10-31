/* VERSION: v2.0.0 START */
export default function Home() {
  const defaultProjectId = 'a0ee8229-373b-4886-8bb0-264024b4220b'

  return (
    <div className="max-w-4xl mx-auto p-8 font-sans">
      {/* Header with M Phase Branding and Logo */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
            M Phase Procurement Dashboard
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Commercial Electrical Takeoffs, RFQ Generation & Vendor Management
          </p>
        </div>
        {/* Page Logo Placeholder: Commercial Electrical & Aviation Facility Logistics */}
        <div className="flex items-center gap-2 bg-slate-900 text-white px-3.5 py-2 rounded-xl shadow-md border border-slate-700">
          <span className="text-xl">✈️⚡</span>
          <div className="text-[10px] font-mono leading-tight">
            <div className="font-bold text-amber-400">M PHASE</div>
            <div className="text-slate-300">Commercial / Airport</div>
          </div>
        </div>
      </div>
      
      <p className="text-xs text-gray-600 mb-6 font-medium uppercase tracking-wider">
        Select a section below to get started:
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a 
          href={`/projects/${defaultProjectId}`}
          className="p-6 border rounded-xl bg-gray-50 hover:bg-blue-50 hover:border-blue-500 transition-all shadow-sm block group"
        >
          <div className="font-bold text-gray-800 text-lg group-hover:text-blue-700 flex items-center justify-between">
            <span>📋 RFQ Builder</span>
            <span className="text-blue-600 font-normal text-sm opacity-0 group-hover:opacity-100 transition-opacity">Open ➔</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">Open current material takeoff & dispatch vendor RFQ packages</div>
        </a>

        <a 
          href="/suppliers"
          className="p-6 border rounded-xl bg-gray-50 hover:bg-blue-50 hover:border-blue-500 transition-all shadow-sm block group"
        >
          <div className="font-bold text-gray-800 text-lg group-hover:text-blue-700 flex items-center justify-between">
            <span>⚙️ Supplier & Sales Rep Directory</span>
            <span className="text-blue-600 font-normal text-sm opacity-0 group-hover:opacity-100 transition-opacity">Manage ➔</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">Manage vendor contacts, rep names, and direct email destinations</div>
        </a>

        <a 
          href="/history"
          className="p-6 border rounded-xl bg-gray-50 hover:bg-blue-50 hover:border-blue-500 transition-all shadow-sm block md:col-span-2 group"
        >
          <div className="font-bold text-gray-800 text-lg group-hover:text-blue-700 flex items-center justify-between">
            <span>📁 Sent RFQ History & Records</span>
            <span className="text-blue-600 font-normal text-sm opacity-0 group-hover:opacity-100 transition-opacity">View Logs ➔</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">View historical records of dispatched RFQs, vendors, itemized material packages, and clear closed job logs</div>
        </a>
      </div>
    </div>
  )
}
/* VERSION: v2.0.0 END */