/**
 * Compute integer age from a date of birth as of a given moment.
 * Returns null when dateOfBirth is null. Pure: all inputs explicit.
 */
export function calculateAge(dateOfBirth: Date | null, now: Date): number | null {
  if (!dateOfBirth) return null
  let age = now.getFullYear() - dateOfBirth.getFullYear()
  const monthDiff = now.getMonth() - dateOfBirth.getMonth()
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())
  ) {
    age--
  }
  return age
}
