import LandingHeader from '@/components/landing/landing-header'
import HeroSection from '@/components/landing/hero-section'
import BenefitsSection from '@/components/landing/benefits-section'
import HowItWorksSection from '@/components/landing/how-it-works-section'
import LandingFooter from '@/components/landing/landing-footer'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-soft-white">
      <LandingHeader />
      <HeroSection />
      <BenefitsSection />
      <HowItWorksSection />
      <LandingFooter />
    </div>
  )
}
