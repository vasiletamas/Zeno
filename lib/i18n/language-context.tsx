'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import type { Language } from './translations'

interface LanguageContextType {
  lang: Language
  toggleLanguage: () => void
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'ro',
  toggleLanguage: () => {},
})

export function LanguageProvider({
  children,
  initialLang = 'ro',
}: {
  children: ReactNode
  initialLang?: Language
}) {
  const [lang, setLang] = useState<Language>(initialLang)

  useEffect(() => {
    const cookie = document.cookie
      .split('; ')
      .find((c) => c.startsWith('zeno_lang='))
    if (cookie) {
      const value = cookie.split('=')[1]
      if (value === 'ro' || value === 'en') {
        setLang(value)
      }
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.cookie = `zeno_lang=${lang};path=/;max-age=2592000;samesite=lax`
  }, [lang])

  const toggleLanguage = () =>
    setLang((prev) => (prev === 'ro' ? 'en' : 'ro'))

  return (
    <LanguageContext.Provider value={{ lang, toggleLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
