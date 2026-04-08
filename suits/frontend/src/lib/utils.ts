import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function riskColor(score: number): string {
  if (score <= 3) return 'text-risk-low'
  if (score <= 6) return 'text-risk-medium'
  if (score <= 8) return 'text-risk-high'
  return 'text-risk-critical'
}

export function riskBg(score: number): string {
  if (score <= 3) return 'bg-risk-low'
  if (score <= 6) return 'bg-risk-medium'
  if (score <= 8) return 'bg-risk-high'
  return 'bg-risk-critical'
}

export function riskLabel(score: number): string {
  if (score <= 3) return 'Low'
  if (score <= 6) return 'Medium'
  if (score <= 8) return 'High'
  return 'Critical'
}
