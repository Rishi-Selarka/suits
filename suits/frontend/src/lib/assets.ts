// ── Asset paths ──
// Drop your files into public/images/ and public/videos/ and they'll resolve here.
// Vite serves everything in /public at the root URL.

export const ASSETS = {
  /** Splash screen hero — professional suited man. Drop as public/images/splash-hero.jpg */
  splashHero: '/images/splash-hero.jpg',

  /** Onboarding intro video — man in suit walks toward camera. Drop as public/videos/onboarding.mp4 */
  onboardingVideo: '/videos/onboarding.mp4',

  /** Suits AI tie logo icon */
  logo: '/images/suits-logo.png',
} as const
