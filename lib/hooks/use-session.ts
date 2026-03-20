'use client'

export function useSession(): { customerId: string | null } {
  const cookie =
    typeof document !== 'undefined'
      ? document.cookie
          .split('; ')
          .find((c) => c.startsWith('zeno_session='))
      : null
  return { customerId: cookie?.split('=')[1] ?? null }
}
