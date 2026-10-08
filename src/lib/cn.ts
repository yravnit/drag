/**
 * Joins class names and drops falsy entries. The repo has no `clsx`/`tailwind-merge`
 * and adding one for this would be a dependency used in exactly one place.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}