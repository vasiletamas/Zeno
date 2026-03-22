/**
 * Magic Link Email Template
 *
 * Generates a Zeno-branded HTML email for customer magic link authentication.
 * Uses inline CSS for email client compatibility.
 * Supports Romanian and English languages.
 */

// Zeno brand colors
const FOREST = '#1A3A2F'
const LINEN = '#F5EDE3'
const MUTED = '#8A8680'
const SOFT_WHITE = '#FAF8F5'
const BORDER = '#E5E0D8'

interface MagicLinkEmailData {
  customerName: string
  magicLink: string
  language: 'ro' | 'en'
}

const COPY = {
  ro: {
    subject: 'Link de acces - Zeno',
    headline: (name: string) => `Buna, ${name}!`,
    intro: 'Ai solicitat un link de acces la contul tau Zeno.',
    ctaButton: 'Acceseaza contul',
    expiry: 'Acest link este valabil 30 de minute si poate fi folosit o singura data.',
    ignore: 'Daca nu ai solicitat acest link, te rugam sa ignori acest email.',
    footer: 'Zeno — powered by Allianz-Tiriac',
    footerNote: 'Acest email a fost trimis automat. Daca ai intrebari, discuta cu Zeno sau contacteaza-ne la support@zeno.ro.',
  },
  en: {
    subject: 'Access Link - Zeno',
    headline: (name: string) => `Hi, ${name}!`,
    intro: 'You requested an access link to your Zeno account.',
    ctaButton: 'Access your account',
    expiry: 'This link is valid for 30 minutes and can only be used once.',
    ignore: 'If you did not request this link, please ignore this email.',
    footer: 'Zeno — powered by Allianz-Tiriac',
    footerNote: 'This email was sent automatically. If you have questions, talk to Zeno or contact us at support@zeno.ro.',
  },
}

export function magicLinkEmail(
  data: MagicLinkEmailData,
): { subject: string; html: string } {
  const c = COPY[data.language]

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

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 24px 40px;" align="center">
              <a href="${data.magicLink}" style="display: inline-block; padding: 14px 32px; background-color: ${FOREST}; color: ${LINEN}; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px;">
                ${c.ctaButton}
              </a>
            </td>
          </tr>

          <!-- Expiry notice -->
          <tr>
            <td style="padding: 0 40px 12px 40px;">
              <p style="margin: 0; font-size: 14px; color: ${MUTED}; line-height: 1.5;">
                ${c.expiry}
              </p>
            </td>
          </tr>

          <!-- Ignore notice -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0; font-size: 14px; color: ${MUTED}; line-height: 1.5;">
                ${c.ignore}
              </p>
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
