/**
 * Purchase Confirmation Email Template
 *
 * Generates a Zeno-branded HTML email for policy purchase confirmation.
 * Uses inline CSS for email client compatibility.
 * Supports Romanian and English languages.
 */

// Zeno brand colors
const FOREST = '#1A3A2F'
const LINEN = '#F5EDE3'
const MUTED = '#8A8680'
const SOFT_WHITE = '#FAF8F5'
const BORDER = '#E5E0D8'
const SAGE = '#2D6B52'

interface PurchaseConfirmationData {
  customerName: string
  tierName: string
  levelName: string
  includesAddon: boolean
  premiumMonthly: number
  currency: string
  coverages: { name: string; amount: number; currency: string }[]
  dashboardUrl: string
  language: 'ro' | 'en'
}

const COPY = {
  ro: {
    subject: 'Felicitări! Polița ta Allianz-Țiriac este în curs de activare',
    headline: (name: string) => `Felicitări, ${name}!`,
    intro: 'Mulțumim pentru încrederea ta. Polița ta de asigurare este în curs de procesare.',
    policyTitle: 'Detaliile poliței tale',
    plan: 'Plan',
    level: 'Nivel',
    addon: 'Addon BD inclus',
    addonYes: 'Da',
    addonNo: 'Nu',
    coverages: 'Acoperiri',
    monthlyPremium: 'Primă lunară',
    activating: 'Polița ta va fi activată de echipa noastră în cel mai scurt timp.',
    ctaButton: 'Accesează contul tău',
    footer: 'Zeno — powered by Allianz-Țiriac',
    footerNote: 'Acest email a fost trimis automat. Dacă ai întrebări, discută cu Zeno sau contactează-ne la support@zeno.ro.',
  },
  en: {
    subject: 'Congratulations! Your Allianz-Țiriac policy is being activated',
    headline: (name: string) => `Congratulations, ${name}!`,
    intro: 'Thank you for your trust. Your insurance policy is being processed.',
    policyTitle: 'Your policy details',
    plan: 'Plan',
    level: 'Level',
    addon: 'BD Addon included',
    addonYes: 'Yes',
    addonNo: 'No',
    coverages: 'Coverages',
    monthlyPremium: 'Monthly premium',
    activating: 'Your policy will be activated by our team as soon as possible.',
    ctaButton: 'Access your account',
    footer: 'Zeno — powered by Allianz-Țiriac',
    footerNote: 'This email was sent automatically. If you have questions, talk to Zeno or contact us at support@zeno.ro.',
  },
}

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`
}

export function purchaseConfirmationEmail(
  data: PurchaseConfirmationData,
): { subject: string; html: string } {
  const c = COPY[data.language]

  const coverageRows = data.coverages
    .map(
      (cov) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${BORDER}; font-size: 14px; color: ${FOREST};">
            ${cov.name}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${BORDER}; font-size: 14px; color: ${FOREST}; text-align: right; font-weight: 500;">
            ${formatAmount(cov.amount, cov.currency)}
          </td>
        </tr>`,
    )
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="${data.language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${c.subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${SOFT_WHITE}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${SOFT_WHITE};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #FFFFFF; border-radius: 12px; overflow: hidden; border: 1px solid ${BORDER};">

          <!-- Logo -->
          <tr>
            <td style="padding: 32px 40px 16px 40px;">
              <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 500; color: ${FOREST}; letter-spacing: -0.5px;">Zeno</span>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding: 0 40px 8px 40px;">
              <h1 style="margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 600; color: ${FOREST}; line-height: 1.3;">
                ${c.headline(data.customerName)}
              </h1>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 0 40px 24px 40px;">
              <p style="margin: 0; font-size: 16px; color: ${FOREST}; line-height: 1.5;">
                ${c.intro}
              </p>
            </td>
          </tr>

          <!-- Policy Summary -->
          <tr>
            <td style="padding: 0 40px 24px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${LINEN}; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: ${FOREST}; text-transform: uppercase; letter-spacing: 0.5px;">
                      ${c.policyTitle}
                    </h2>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: ${MUTED};">${c.plan}</td>
                        <td style="padding: 6px 0; font-size: 14px; color: ${FOREST}; text-align: right; font-weight: 500;">${data.tierName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: ${MUTED};">${c.level}</td>
                        <td style="padding: 6px 0; font-size: 14px; color: ${FOREST}; text-align: right; font-weight: 500;">${data.levelName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: ${MUTED};">${c.addon}</td>
                        <td style="padding: 6px 0; font-size: 14px; color: ${FOREST}; text-align: right; font-weight: 500;">${data.includesAddon ? c.addonYes : c.addonNo}</td>
                      </tr>
                    </table>

                    <!-- Coverages -->
                    <h3 style="margin: 16px 0 8px 0; font-size: 14px; font-weight: 600; color: ${FOREST};">
                      ${c.coverages}
                    </h3>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid ${BORDER};">
                      ${coverageRows}
                    </table>

                    <!-- Monthly Premium -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 16px; border-top: 2px solid ${FOREST};">
                      <tr>
                        <td style="padding: 12px 0 0 0; font-size: 16px; font-weight: 600; color: ${FOREST};">
                          ${c.monthlyPremium}
                        </td>
                        <td style="padding: 12px 0 0 0; font-size: 20px; font-weight: 700; color: ${FOREST}; text-align: right;">
                          ${formatAmount(data.premiumMonthly, data.currency)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Activating message -->
          <tr>
            <td style="padding: 0 40px 24px 40px;">
              <p style="margin: 0; font-size: 15px; color: ${FOREST}; line-height: 1.5; font-style: italic;">
                ${c.activating}
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 32px 40px;" align="center">
              <a href="${data.dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: ${FOREST}; color: ${LINEN}; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px;">
                ${c.ctaButton}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: ${LINEN}; border-top: 1px solid ${BORDER};">
              <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 500; color: ${FOREST};">
                ${c.footer}
              </p>
              <p style="margin: 0; font-size: 12px; color: ${MUTED}; line-height: 1.5;">
                ${c.footerNote}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject: c.subject, html }
}
