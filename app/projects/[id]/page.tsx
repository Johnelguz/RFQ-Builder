export default function Home() {
  const defaultProjectId = 'a0ee8229-373b-4886-8bb0-264024b4220b'

  return (
    <div className="max-w-4xl mx-auto p-8 font-sans">
      <h1 className="text-2xl font-bold mb-4 text-gray-800">Electrical Procurement Dashboard</h1>
      <p className="text-sm text-gray-600 mb-6">Select a section below to get started:</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a 
          href={`/projects/${defaultProjectId}`}
          className="p-6 border rounded-lg bg-gray-50 hover:bg-blue-50 hover:border-blue-500 transition-colors shadow-sm block"
        >
          <div className="font-bold text-gray-800 text-lg">📋 Active Takeoff & RFQ Builder</div>
          <div className="text-xs text-gray-500 mt-1">Open current takeoff project & dispatch vendor RFQs</div>
        </a>

        <a 
          href="/suppliers"
          className="p-6 border rounded-lg bg-gray-50 hover:bg-blue-50 hover:border-blue-500 transition-colors shadow-sm block"
        >
          <div className="font-bold text-gray-800 text-lg">⚙️ Supplier & Sales Rep Directory</div>
          <div className="text-xs text-gray-500 mt-1">Manage vendor contacts, rep names, and email destinations</div>
        </a>

        <a 
          href="/history"
          className="p-6 border rounded-lg bg-gray-50 hover:bg-blue-50 hover:border-blue-500 transition-colors shadow-sm block md:col-span-2"
        >
          <div className="font-bold text-gray-800 text-lg">📁 Sent RFQ History & Records</div>
          <div className="text-xs text-gray-500 mt-1">View historical records of dispatched RFQs, vendors, itemized material packages, and clear closed job logs</div>
        </a>
      </div>
    </div>
  )
}