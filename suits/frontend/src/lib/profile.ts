import type { UserData } from '@/context/UserContext'
import type { ProfileResponse } from '@/api/client'

// Maps between the frontend onboarding vocabulary (profession/purpose) and the
// backend Supabase profile schema (role/use_case). Jurisdiction is fixed to
// India — the product is India-only for now, so the country selection has
// been removed from onboarding and settings.

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
  profession: string
  purpose: string
}

export function answersToOnboardPayload(answers: OnboardingAnswers) {
  return {
    name: answers.name?.trim() || 'New User',
    role: PROFESSION_TO_ROLE[answers.profession] ?? 'individual',
    organization: '',
    use_case: answers.purpose || '',
    jurisdiction: 'India',
  }
}

export function profileToUserData(profile: ProfileResponse): Partial<UserData> {
  return {
    name: profile.name || '',
    profession: ROLE_TO_PROFESSION[profile.role] ?? 'freelancer',
    purpose: profile.use_case || '',
    // The backend schema has no "onboarded" flag; we infer it from `use_case`
    // because that field has no default and is only set when the user finishes
    // the onboarding wizard (see answersToOnboardPayload).
    onboarded: Boolean(profile.use_case),
  }
}
