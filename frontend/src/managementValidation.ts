export function validateMemberInvite(name: string, email: string, phone: string): string | null {
  const normalizedName = name.trim()
  const normalizedEmail = email.trim()
  if (normalizedName.length < 2 || normalizedName.length > 100) return 'Enter a member name between 2 and 100 characters.'
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return 'Enter a valid email address.'
  if (phone.trim().length > 30) return 'Phone number must be 30 characters or fewer.'
  return null
}

export function normalizeInstallmentAmount(value: unknown): number | null {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized || !/^\d+$/.test(normalized)) return null
    const amount = Number(normalized)
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export function validateInstallmentAmount(value: unknown, remaining: number): string | null {
  const amount = normalizeInstallmentAmount(value)
  if (amount === null) return 'Installment must be a positive whole amount.'
  if (!Number.isSafeInteger(remaining) || remaining < 0) return 'The remaining monthly target is unavailable. Refresh and try again.'
  if (amount > remaining) return 'Installment cannot exceed the remaining monthly target.'
  return null
}
