/*
 * User-Facing Labels für Domain-Rollen.
 *
 * Auto-importiert in allen Vue-Komponenten unter `app/` via Nuxt-Utils-Konvention
 * (jeder Export aus `app/utils/` ist ohne expliziten Import verfügbar).
 *
 * Enthalten:
 * - roleLabel(): Deutsche Anzeige-Labels für 'OWNER' | 'MEMBER'.
 *   Konsistent mit `RoleTag`, das die Caps-Variante für Tag-Badges behält —
 *   roleLabel() ist für Fließtext (z. B. "Du bist Owner").
 */

export type HouseholdRole = 'OWNER' | 'MEMBER' | string

/** Anzeige-Label für eine Haushaltsrolle. Single-Source-of-Truth in DE-Locale. */
export function roleLabel(role: HouseholdRole): string {
  switch (role) {
    case 'OWNER':
      return 'Owner'
    case 'MEMBER':
      return 'Member'
    default:
      return role
  }
}
