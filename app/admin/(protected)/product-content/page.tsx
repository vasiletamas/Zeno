/**
 * Admin ProductContent Governance (E1 erratum 7, T11.D2)
 *
 * Server component. Lists the versioned authored claim rows grouped by
 * (field, addon, version) with locale coverage and status — the minimal
 * review surface over the draft→published workflow. Publishing runs
 * through POST /api/admin/product-content (the ONE publish path with the
 * locale-complete + no-numerals gates); authoring stays with seeds and
 * operator tooling.
 */

import { prisma } from '@/lib/db'

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-800',
  DRAFT: 'bg-amber-100 text-amber-800',
  RETIRED: 'bg-linen text-muted',
}

export default async function ProductContentPage() {
  const rows = await prisma.productContent.findMany({
    orderBy: [{ field: 'asc' }, { version: 'desc' }, { locale: 'asc' }],
    include: {
      product: { select: { code: true } },
      addon: { select: { code: true } },
    },
  })

  return (
    <div>
      <h2 className="mb-2 text-xl font-medium text-night">Product content</h2>
      <p className="mb-6 text-sm text-muted">
        Versioned authored claims (draft → published → retired). Publish via POST
        /api/admin/product-content — the gate enforces both locales and the
        no-numerals rule; amounts ride {'{{coverage:CODE}}'} placeholders.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-linen text-left text-muted">
            <th className="py-2 pr-4">Product</th>
            <th className="py-2 pr-4">Addon</th>
            <th className="py-2 pr-4">Field</th>
            <th className="py-2 pr-4">Locale</th>
            <th className="py-2 pr-4">Version</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Authored by</th>
            <th className="py-2 pr-4">Approved by</th>
            <th className="py-2">Published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-linen/60">
              <td className="py-2 pr-4">{row.product.code}</td>
              <td className="py-2 pr-4">{row.addon?.code ?? '—'}</td>
              <td className="py-2 pr-4 font-mono text-xs">{row.field}</td>
              <td className="py-2 pr-4">{row.locale}</td>
              <td className="py-2 pr-4">v{row.version}</td>
              <td className="py-2 pr-4">
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[row.status] ?? ''}`}>{row.status}</span>
              </td>
              <td className="py-2 pr-4">{row.authoredBy}</td>
              <td className="py-2 pr-4">{row.approvedBy ?? '—'}</td>
              <td className="py-2">{row.publishedAt ? row.publishedAt.toISOString().split('T')[0] : '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="py-6 text-center text-muted">No authored content rows.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
