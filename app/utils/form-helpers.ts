/*
 * Geteilte Helper-Texte und Konstanten fuer Form-Felder.
 *
 * Aktuell nur ein Datum-Helper-Text, aber DRY lohnt sich: kommt an drei
 * Stellen vor (Expense-Form, Income-Form, Sparziel-Booking-Dialog) und
 * bei einer Copy-Aenderung wuerde man sonst drei Stellen pflegen muessen.
 *
 * Pattern-Notiz (issue #54): die Helper-Texte sind bewusst kurz und
 * erklaerend — der User soll wissen, dass das Datum im Default-Flow auf
 * "heute" steht, ohne erst das leere Feld raten zu muessen.
 */

/**
 * Helper-Text fuer Datums-Felder, deren Default-Wert das aktuelle Datum
 * ist. Wird unter dem DatePicker als dezenter Hinweis gerendert.
 *
 * Verwendung:
 *   <DatePicker v-model="form.date" ... />
 *   <small class="form-field-helper">{{ todayDateHelperText }}</small>
 *
 * Die zugehoerige CSS-Klasse `.form-field-helper` ist global in
 * `app/assets/css/base.css` definiert.
 */
export const todayDateHelperText = 'Voreinstellung: heute. Nur bei Bedarf ändern.'
