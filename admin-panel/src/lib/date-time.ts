const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i

export function parseApiDateTime(value: string): Date {
  const timestamp = hasTimezone.test(value) ? value : `${value}Z`
  return new Date(timestamp)
}

export function formatApiDateTime(value: string): string {
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
