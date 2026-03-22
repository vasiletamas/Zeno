import Link from 'next/link'

interface ApplicationRow {
  id: string
  status: string
  createdAt: Date
  customer: { name: string | null; email: string | null } | null
  product: { name: unknown } | null
}

interface ApplicationTableProps {
  applications: ApplicationRow[]
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    OPEN: 'bg-sage/10 text-sage',
    PAUSED: 'bg-sand/10 text-sand',
    COMPLETED: 'bg-forest/10 text-forest',
  }
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-muted/10 text-muted'}`}
    >
      {status}
    </span>
  )
}

function getProductName(name: unknown): string {
  if (!name) return '-'
  if (typeof name === 'string') return name
  if (typeof name === 'object' && name !== null) {
    const n = name as Record<string, string>
    return n.ro || n.en || Object.values(n)[0] || '-'
  }
  return '-'
}

export default function ApplicationTable({ applications }: ApplicationTableProps) {
  if (applications.length === 0) {
    return (
      <p className="rounded-lg border border-warm-border bg-white p-6 text-center text-sm text-muted">
        Nu exista aplicatii.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-warm-border bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-warm-border bg-linen/50">
            <th className="px-4 py-3 font-medium text-muted">Client</th>
            <th className="px-4 py-3 font-medium text-muted">Produs</th>
            <th className="px-4 py-3 font-medium text-muted">Status</th>
            <th className="px-4 py-3 font-medium text-muted">Data</th>
            <th className="px-4 py-3 font-medium text-muted"></th>
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr
              key={app.id}
              className="border-b border-warm-border last:border-0 hover:bg-linen/30 transition-colors"
            >
              <td className="px-4 py-3 text-night">
                {app.customer?.name ?? app.customer?.email ?? 'Anonim'}
              </td>
              <td className="px-4 py-3 text-night">
                {getProductName(app.product?.name)}
              </td>
              <td className="px-4 py-3">{statusBadge(app.status)}</td>
              <td className="px-4 py-3 text-muted">
                {new Date(app.createdAt).toLocaleDateString('ro-RO')}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/applications/${app.id}`}
                  className="text-sage hover:underline"
                >
                  Detalii
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
