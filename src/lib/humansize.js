const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/**
 * Format bytes into human-readable string (e.g. "4 KB", "12.4 MB").
 * Base 1024, one decimal place above KB when fractional.
 */
export function formatHumanSize (bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) {
    return '0 B'
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }

  let unitIndex = 0
  let value = bytes

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex++
  }

  const rounded = Number(value.toFixed(1))
  return `${rounded} ${UNITS[unitIndex]}`
}
