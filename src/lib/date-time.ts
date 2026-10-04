const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i

export function parseApiDateTime(value: string): Date {
  const timestamp = hasTimezone.test(value) ? value : `${value}Z`
  return new Date(timestamp)
}

export function formatApiDateTime(value: string): string {
  const date = parseApiDateTime(value)
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
}
