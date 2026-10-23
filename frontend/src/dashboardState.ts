export type DashboardLoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string }

export async function loadDashboard<T>(
  load: () => Promise<T>,
  report: (state: DashboardLoadState<T>) => void,
) {
  report({ status: 'loading' })
  try {
    const value = await load()
    report({ status: 'ready', value })
  } catch (cause) {
    report({ status: 'error', message: cause instanceof Error ? cause.message : 'Could not load dashboard.' })
  }
}
