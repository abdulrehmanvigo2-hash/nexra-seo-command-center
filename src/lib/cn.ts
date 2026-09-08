/**
 * Minimal class-name joiner.
 *
 * Deliberately dependency-free — the shell only needs conditional class
 * composition, which does not justify pulling in `clsx` or `tailwind-merge`.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
