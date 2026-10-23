export function expectedPool(targetAmount: number, eligibleMembers: number): number {
  if (!Number.isSafeInteger(targetAmount) || targetAmount <= 0 || !Number.isSafeInteger(eligibleMembers) || eligibleMembers < 0) return 0
  return targetAmount * eligibleMembers
}

export function validateRoundSetup(period: string, targetAmount: number, deadline: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return 'Choose a valid month.'
  if (!Number.isSafeInteger(targetAmount) || targetAmount <= 0) return 'Target must be a positive whole amount.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline.slice(0, 7) !== period || Number.isNaN(Date.parse(`${deadline}T00:00:00Z`)) || new Date(`${deadline}T00:00:00Z`).toISOString().slice(0, 10) !== deadline) return 'Choose a valid deadline within the selected month.'
  return null
}
