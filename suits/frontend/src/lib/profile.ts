import type { UserData } from '@/context/UserContext'
import type { ProfileResponse } from '@/api/client'

// Maps between the frontend onboarding vocabulary (location/profession/purpose)
// and the backend Supabase profile schema (jurisdiction/role/use_case). Keep
// these in sync with the choices rendered in OnboardingFlow / SettingsPage.

const LOCATION_TO_JURISDICTION: Record<string, string> = {
  india: 'India',
  usa: 'United States',
  uk: 'United Kingdom',
  canada: 'Canada',
  uae: 'UAE',
  singapore: 'Singapore',
}

const JURISDICTION_TO_LOCATION: Record<string, string> = Object.fromEntries(
  Object.entries(LOCATION_TO_JURISDICTION).map(([k, v]) => [v, k]),
)

type Role = ProfileResponse['role']

const PROFESSION_TO_ROLE: Record<string, Role> = {
  lawyer: 'lawyer',
  business: 'business',
  corporate: 'business',
  freelancer: 'individual',
  student: 'student',
}

const ROLE_TO_PROFESSION: Record<Role, string> = {
  lawyer: 'lawyer',
  business: 'business',
  individual: 'freelancer',
  student: 'student',
}

export interface OnboardingAnswers {
  name: string
  location: string
  profession: string
  purpose: string
}

export function answersToOnboardPayload(answers: OnboardingAnswers) {
  return {
    name: answers.name?.trim() || 'New User',
    role: PROFESSION_TO_ROLE[answers.profession] ?? 'individual',
    organization: '',
    use_case: answers.purpose || '',
    jurisdiction: LOCATION_TO_JURISDICTION[answers.location] ?? answers.location ?? 'India',
  }
}

export function profileToUserData(profile: ProfileResponse): Partial<UserData> {
  return {
    name: profile.name || '',
    location: JURISDICTION_TO_LOCATION[profile.jurisdiction] ?? profile.jurisdiction.toLowerCase(),
    profession: ROLE_TO_PROFESSION[profile.role] ?? 'freelancer',
    purpose: profile.use_case || '',
    // The backend schema has no "onboarded" flag; we infer it from `use_case`
    // because that field has no default and is only set when the user finishes
    // the onboarding wizard (see answersToOnboardPayload).
    onboarded: Boolean(profile.use_case),
  }
}
