/*
 * useListSwipe — entscheidet, ob Swipe-Gesten (SwipeableListItem) auf den
 * Planungs-Listen (Budgets, Wiederkehrend, Sparziele) aktiv sind (issue #132).
 *
 * Swipe ist dort nur aktiv, wenn BEIDES zutrifft:
 *   - Mobil (< 640px): ab 640px ist `ItemCard` eine Karte mit Hover-Actions;
 *     der deckende Hintergrund des Swipe-Wrappers wuerde den Look zerstoeren,
 *     und dort gibt es die Icon-Buttons weiterhin. Die Schwelle ist dieselbe
 *     wie in ItemCard/ListPanel (`max-width: 639px`), damit "Buttons weg" und
 *     "Swipe an" nie auseinanderlaufen.
 *   - Der User darf Planungs-Eintraege verwalten (Owner): Bearbeiten/Loeschen
 *     sind serverseitig Owner-only (issue #128) — ein Swipe wuerde MEMBER nur
 *     in ein 403 laufen lassen.
 *
 * Verwendung:
 *   const { swipeDisabled } = useListSwipe()
 *   <SwipeableListItem :disabled="swipeDisabled" ...>
 */

import { computed } from 'vue'
import { useHousehold } from './useHousehold'
import { useMediaQuery } from './useMediaQuery'

/** Muss zur Mobil-Schwelle in ItemCard.vue / ListPanel.vue passen. */
export const MOBILE_LIST_QUERY = '(max-width: 639px)'

export function useListSwipe() {
  const { canManageHousehold } = useHousehold()
  const isMobileList = useMediaQuery(MOBILE_LIST_QUERY)

  const swipeDisabled = computed(() => !isMobileList.value || !canManageHousehold.value)

  return { swipeDisabled }
}
