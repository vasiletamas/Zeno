/**
 * Re-engagement outbound templates (E4.5, M2) — bilingual per trigger,
 * embedding the B3 magic link that verifies AND returns the customer to
 * their conversation. Numbers-free by design: the email invites the
 * customer back; the conversation speaks the figures.
 */
import type { ReEngagementTrigger } from '@/lib/engagement/select-candidates'

export function reEngagementEmail(input: {
  trigger: ReEngagementTrigger
  magicLinkUrl: string
  locale: 'ro' | 'en'
}): { subject: string; html: string } {
  const { trigger, magicLinkUrl, locale } = input
  if (trigger === 'abandoned_payment') {
    return locale === 'ro'
      ? {
          subject: 'Polița ta te așteaptă — mai e un singur pas',
          html: `<p>Bună,</p><p>Oferta ta a fost acceptată, mai rămâne doar plata pentru ca protecția să înceapă.</p><p><a href="${magicLinkUrl}">Continuă de unde ai rămas</a> — linkul te aduce direct înapoi în conversație.</p><p>Dacă ai întrebări, răspunde-ne în conversație oricând.</p>`,
        }
      : {
          subject: 'Your policy is one step away',
          html: `<p>Hi,</p><p>Your quote was accepted — only the payment remains before your protection starts.</p><p><a href="${magicLinkUrl}">Pick up where you left off</a> — the link takes you straight back to the conversation.</p><p>Questions? Just reply in the conversation.</p>`,
        }
  }
  return locale === 'ro'
    ? {
        subject: 'Oferta ta expiră în curând',
        html: `<p>Bună,</p><p>Oferta ta de asigurare este încă valabilă, dar expiră în curând.</p><p><a href="${magicLinkUrl}">Revino în conversație</a> ca să o vezi sau să o accepți — linkul te autentifică și te aduce direct înapoi.</p>`,
      }
    : {
        subject: 'Your quote expires soon',
        html: `<p>Hi,</p><p>Your insurance quote is still valid, but it expires soon.</p><p><a href="${magicLinkUrl}">Return to the conversation</a> to review or accept it — the link signs you in and brings you straight back.</p>`,
      }
}
