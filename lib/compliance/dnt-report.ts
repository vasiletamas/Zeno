/**
 * DNT Suitability Report PDF Generator
 *
 * Generates an IDD-compliant suitability report (Raport de Suitabilitate DNT)
 * as a multi-page PDF for each completed insurance sale.
 *
 * Structure:
 *  Page 1: Header + customer data
 *  Page 2+: DNT questionnaire answers grouped by section
 *  Page 3+: Product recommendation + coverage table + premium
 *  Last page: Client confirmation + legal disclaimer
 */

import fs from 'fs'
import path from 'path'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { prisma } from '@/lib/db'
import { decrypt, maskCnp } from '@/lib/security/encryption'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getReportsPath(): string {
  return process.env.REPORTS_PATH ?? './tmp/reports'
}

function getLocalizedText(json: unknown, lang = 'ro'): string {
  if (!json) return '-'
  if (typeof json === 'string') return json
  if (typeof json === 'object' && json !== null) {
    const obj = json as Record<string, string>
    return obj[lang] || obj.ro || obj.en || Object.values(obj)[0] || '-'
  }
  return '-'
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('ro-RO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatCurrency(amount: number, currency = 'RON'): string {
  return `${amount.toLocaleString('ro-RO')} ${currency}`
}

function formatAddress(address: unknown): string {
  if (!address) return '-'
  if (typeof address === 'string') return address
  if (typeof address === 'object' && address !== null) {
    const a = address as Record<string, string>
    if (a.raw) return a.raw
    const parts = [a.street, a.city, a.county, a.postalCode].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : '-'
  }
  return '-'
}

// ─────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────

export async function generateDntReport(policyId: string): Promise<Buffer> {
  // ── Load all data ─────────────────────────
  const policy = await prisma.policy.findUniqueOrThrow({
    where: { id: policyId },
    include: {
      product: true,
      customer: true,
      quote: {
        include: {
          application: {
            include: {
              tier: true,
              level: true,
              // B4: answers key on the application, not the conversation
              answers: {
                include: {
                  question: {
                    include: {
                      group: true,
                    },
                  },
                },
                orderBy: { answeredAt: 'asc' },
              },
            },
          },
        },
      },
    },
  })

  const { customer, product, quote } = policy
  const application = quote?.application
  // B2.6: DNT answers live on the signed Dnt's source session (customer-
  // scoped); application-scoped Answer rows carry the application answers.
  const signedDnt = await prisma.dnt.findFirst({
    where: { customerId: customer.id, status: 'ACTIVE' },
    orderBy: { signedAt: 'desc' },
    include: {
      sourceSession: {
        include: {
          answers: {
            include: { question: { include: { group: true } } },
            orderBy: { answeredAt: 'asc' },
          },
        },
      },
    },
  })
  const answers = [...(signedDnt?.sourceSession.answers ?? []), ...(application?.answers ?? [])]
  // Decrypt CNP for masked display
  let maskedCnp = '-'
  if (customer.cnpEncrypted && customer.cnpIv && customer.cnpTag) {
    try {
      const plainCnp = decrypt(customer.cnpEncrypted, customer.cnpIv, customer.cnpTag)
      maskedCnp = maskCnp(plainCnp)
    } catch {
      maskedCnp = '*** (decryption error)'
    }
  }

  // Load coverage amounts for the pricing level
  const levelId = application?.levelId
  let coverageAmounts: Array<{
    name: string
    amount: number
    currency: string
  }> = []

  if (levelId) {
    const dbCoverages = await prisma.coverageAmount.findMany({
      where: { pricingLevelId: levelId },
      include: { coverageType: true },
    })
    coverageAmounts = dbCoverages.map((ca) => ({
      name: getLocalizedText(ca.coverageType.name),
      amount: ca.amount,
      currency: ca.currency,
    }))
  }

  // Load addon coverages if applicable
  let addonCoverageAmounts: Array<{
    name: string
    amount: number
    currency: string
  }> = []

  if (application?.includesAddon) {
    const addon = await prisma.addon.findFirst({
      where: { productId: product.id, isActive: true },
      include: {
        coverageAmounts: { include: { coverageType: true } },
      },
    })
    if (addon) {
      addonCoverageAmounts = addon.coverageAmounts.map((ca) => ({
        name: getLocalizedText(ca.coverageType.name),
        amount: ca.amount,
        currency: ca.currency,
      }))
    }
  }

  // ── Create PDF ────────────────────────────
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 20
  const contentWidth = pageWidth - margin * 2
  let y = margin

  // Utility to check page overflow and add new page
  function checkPageBreak(neededHeight: number) {
    const pageHeight = doc.internal.pageSize.getHeight()
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
  }

  // ── PAGE 1: Header + Customer Data ────────
  // Header
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('RAPORT DE SUITABILITATE (DNT)', pageWidth / 2, y, { align: 'center' })
  y += 8
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'Conform Directivei (UE) 2016/97 privind distributia de asigurari (IDD)',
    pageWidth / 2,
    y,
    { align: 'center' },
  )
  y += 12

  // Separator
  doc.setDrawColor(100, 100, 100)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  // Report metadata
  const shortId = policyId.slice(0, 8)
  const reportDate = new Date()
  const reportNumber = `DNT-${shortId}-${reportDate.toISOString().slice(0, 10)}`

  doc.setFontSize(10)
  const metaLines = [
    `Numar raport: ${reportNumber}`,
    `Data generarii: ${formatDate(reportDate)}`,
    'Agent: Zeno (sistem automatizat)',
    'Asigurator: Allianz-Tiriac Asigurari S.A.',
  ]
  for (const line of metaLines) {
    doc.text(line, margin, y)
    y += 6
  }
  y += 8

  // Customer data section
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('DATELE CLIENTULUI', margin, y)
  y += 2
  doc.line(margin, y, margin + 60, y)
  y += 6

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const customerLines = [
    `Nume: ${customer.name ?? '-'}`,
    `CNP: ${maskedCnp}`,
    `Data nasterii: ${formatDate(customer.dateOfBirth)}`,
    `Adresa: ${formatAddress(customer.address)}`,
    `Email: ${customer.email ?? '-'}`,
    `Telefon: ${customer.phone ?? '-'}`,
  ]
  for (const line of customerLines) {
    doc.text(line, margin, y)
    y += 6
  }
  y += 10

  // ── PAGE 2+: DNT Answers ─────────────────
  checkPageBreak(20)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('ANALIZA NEVOILOR SI CERINTELOR (DNT)', margin, y)
  y += 2
  doc.line(margin, y, margin + 100, y)
  y += 8

  // Group answers by question group
  const answerGroups = new Map<
    string,
    { groupName: string; orderIndex: number; answers: typeof answers }
  >()
  for (const answer of answers) {
    const groupCode = answer.question.group.code
    if (!answerGroups.has(groupCode)) {
      answerGroups.set(groupCode, {
        groupName: getLocalizedText(answer.question.group.name),
        orderIndex: answer.question.group.orderIndex,
        answers: [],
      })
    }
    answerGroups.get(groupCode)!.answers.push(answer)
  }

  // Sort groups by orderIndex
  const sortedGroups = Array.from(answerGroups.entries()).sort(
    (a, b) => a[1].orderIndex - b[1].orderIndex,
  )

  for (const [, group] of sortedGroups) {
    checkPageBreak(20)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(`Sectiunea: ${group.groupName}`, margin, y)
    y += 4

    const tableBody = group.answers.map((answer) => [
      getLocalizedText(answer.question.text),
      answer.value,
    ])

    autoTable(doc, {
      startY: y,
      head: [['Intrebare', 'Raspuns']],
      body: tableBody,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [60, 80, 60], textColor: 255 },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.65 },
        1: { cellWidth: contentWidth * 0.35 },
      },
      theme: 'grid',
    })

    // Get the final Y after the table
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable?.finalY ?? y + 20
    y += 8
  }

  // ── PAGE 3+: Product Recommendation ───────
  checkPageBreak(30)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('RECOMANDAREA PRODUSULUI', margin, y)
  y += 2
  doc.line(margin, y, margin + 70, y)
  y += 8

  const tierName = application?.tier
    ? getLocalizedText(application.tier.name)
    : 'Standard'
  const levelName = application?.level
    ? getLocalizedText(application.level.name)
    : '-'

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Produs recomandat: Protect ${tierName} ${levelName}`, margin, y)
  y += 6
  if (application?.includesAddon) {
    doc.text('Addon: Tratament Medical in Strainatate (BD)', margin, y)
    y += 6
  }
  y += 4

  // Recommendation rationale
  const rationale =
    'Pe baza analizei nevoilor clientului (venitul familiei, numar de dependenti, ' +
    'preferinta pentru protectie), produsul recomandat ofera cel mai bun raport ' +
    'intre acoperire si cost.'
  const rationaleLines = doc.splitTextToSize(`Motivare: ${rationale}`, contentWidth)
  doc.text(rationaleLines, margin, y)
  y += rationaleLines.length * 5 + 8

  // Coverage table
  checkPageBreak(20)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('ACOPERIRI INCLUSE', margin, y)
  y += 6

  const allCoverages = [
    ...coverageAmounts.map((c) => [c.name, formatCurrency(c.amount, c.currency)]),
    ...addonCoverageAmounts.map((c) => [
      `${c.name} (addon)`,
      formatCurrency(c.amount, c.currency),
    ]),
  ]

  if (allCoverages.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Acoperire', 'Suma']],
      body: allCoverages,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [60, 80, 60], textColor: 255 },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.6 },
        1: { cellWidth: contentWidth * 0.4 },
      },
      theme: 'grid',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable?.finalY ?? y + 20
    y += 8
  }

  // Premium section
  checkPageBreak(30)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('PRIMA DE ASIGURARE', margin, y)
  y += 6

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')

  const premiumLines = [
    `Prima anuala: ${formatCurrency(policy.premiumAnnual, policy.currency)}`,
    `Prima lunara: ${formatCurrency(policy.premiumMonthly, policy.currency)}`,
    `Frecventa platii: ${policy.paymentFrequency ?? 'Anuala'}`,
  ]
  for (const line of premiumLines) {
    doc.text(line, margin, y)
    y += 6
  }
  y += 10

  // ── LAST PAGE: Signatures + Legal ─────────
  checkPageBreak(60)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('CONFIRMAREA CLIENTULUI', margin, y)
  y += 2
  doc.line(margin, y, margin + 70, y)
  y += 8

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')

  const dntSignedLabel = signedDnt ? formatDate(signedDnt.signedAt) : '-'

  const validityDate = signedDnt?.validUntil ?? null

  const confirmLines = [
    `Clientul a confirmat semnatura electronica: Da`,
    `Consimtamant GDPR: Da`,
    `Data semnarii: ${dntSignedLabel}`,
    `Valabilitate: ${validityDate ? formatDate(validityDate) : '-'}`,
  ]
  for (const line of confirmLines) {
    doc.text(line, margin, y)
    y += 6
  }
  y += 12

  // Legal disclaimer
  checkPageBreak(40)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('DISCLAIMER LEGAL', margin, y)
  y += 2
  doc.line(margin, y, margin + 50, y)
  y += 8

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  const disclaimer =
    'Acest raport a fost generat automat de sistemul Zeno in conformitate cu cerintele ' +
    'Directivei IDD (UE) 2016/97 si reglementarile ASF. ' +
    'Agent de asigurare pentru Allianz-Tiriac Asigurari S.A.'
  const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth)
  doc.text(disclaimerLines, margin, y)

  // ── Save to filesystem ────────────────────
  const reportsPath = getReportsPath()
  fs.mkdirSync(reportsPath, { recursive: true })

  const filePath = path.join(reportsPath, `${policyId}.pdf`)

  // Get PDF as buffer
  const pdfOutput = doc.output('arraybuffer')
  const pdfBuffer = Buffer.from(pdfOutput)

  fs.writeFileSync(filePath, pdfBuffer)

  // Update Policy with report path
  await prisma.policy.update({
    where: { id: policyId },
    data: { suitabilityReportPath: filePath },
  })

  console.log(`[DntReport] Generated report for policy ${policyId} at ${filePath}`)

  return pdfBuffer
}
