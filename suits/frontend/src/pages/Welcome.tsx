import OnboardingFlow from '@/components/onboarding/OnboardingFlow'
import { useUser } from '@/context/UserContext'
import { onboard } from '@/api/client'
import { answersToOnboardPayload, profileToUserData } from '@/lib/profile'

interface WelcomeProps {
  onComplete: () => void
}

export default function Welcome({ onComplete }: WelcomeProps) {
  const { user, setUser } = useUser()

  const handleOnboardingComplete = async (data: {
    location: string
    profession: string
    purpose: string
  }) => {
    // Optimistically update the local cache so the UI advances immediately,
    // then persist to the server. If the server call fails the user can still
    // use the app — onboarding will retry next time the profile is fetched.
    setUser({ ...data, onboarded: true })
    onComplete()

    try {
      const payload = answersToOnboardPayload({ name: user.name, ...data })
      const profile = await onboard(payload)
      setUser(profileToUserData(profile))
    } catch (err) {
      console.error('Failed to persist onboarding to server', err)
    }
  }

  return (
    <div className="fixed inset-0 bg-cream">
      <OnboardingFlow
        userName={user.name || 'there'}
        onComplete={handleOnboardingComplete}
      />
    </div>
  )
}
