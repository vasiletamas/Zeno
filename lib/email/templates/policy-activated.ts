/**
 * Policy-activated notification (D4.3): the SOP-promised email, real at
 * last. Localized by the customer language; carries the Allianz number,
 * effective dates and the frozen free-look deadline.
 */

export function policyActivatedEmail(input: {
  customerName: string
  allianzPolicyNumber: string
  effectiveFrom: Date
  effectiveUntil: Date | null
  freeLookEndsAt: Date | null
  language: 'ro' | 'en'
}): { subject: string; html: string } {
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString(input.language === 'ro' ? 'ro-RO' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '-')
  if (input.language === 'en') {
    return {
      subject: `Your policy ${input.allianzPolicyNumber} is now active`,
      html: `
        <p>Hello ${input.customerName},</p>
        <p>Your insurance policy <strong>${input.allianzPolicyNumber}</strong> has been activated.</p>
        <ul>
          <li>Effective from: <strong>${fmt(input.effectiveFrom)}</strong></li>
          <li>Effective until: <strong>${fmt(input.effectiveUntil)}</strong></li>
          <li>Free-look cancellation window until: <strong>${fmt(input.freeLookEndsAt)}</strong></li>
        </ul>
        <p>Within the free-look window you may cancel with a full refund of captured payments.</p>
        <p>Zeno · Allianz Țiriac</p>
      `,
    }
  }
  return {
    subject: `Polița ta ${input.allianzPolicyNumber} a fost activată`,
    html: `
      <p>Bună, ${input.customerName},</p>
      <p>Polița ta de asigurare <strong>${input.allianzPolicyNumber}</strong> a fost activată.</p>
      <ul>
        <li>Valabilă de la: <strong>${fmt(input.effectiveFrom)}</strong></li>
        <li>Valabilă până la: <strong>${fmt(input.effectiveUntil)}</strong></li>
        <li>Drept de renunțare (free-look) până la: <strong>${fmt(input.freeLookEndsAt)}</strong></li>
      </ul>
      <p>În perioada de renunțare poți anula polița cu rambursarea integrală a plăților încasate.</p>
      <p>Zeno · Allianz Țiriac</p>
    `,
  }
}
