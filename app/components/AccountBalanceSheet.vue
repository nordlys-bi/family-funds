<!--
  AccountBalanceSheet — Bilanz einer Kontengruppe (issue #198).

  Links "Liegt auf" (Konten), rechts "Ist gedacht fuer" (Umschlaege), unten
  auf beiden Seiten dieselbe Summe. Die Rechnung steht in
  `buildBalanceSheet` (account-coverage.ts).

  Wichtig (ADR-0006): Die Seiten sind zwei unabhaengige Listen. Keine Zeile
  links gehoert zu einer Zeile rechts; deshalb fluchten die Zeilen nicht,
  nur die Summenzeile steht auf einer Hoehe.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { accountTypeIcon, type AccountType } from '~/utils/account-options'
import type { BalanceSheet, GroupStatus, SuggestedTransfer } from '~/utils/account-coverage'

type SheetAccount = { id: string; name: string; type: AccountType; balance: number; closedAt: string | null }

const props = defineProps<{
  label: string
  state: GroupStatus
  sheet: BalanceSheet
  accounts: SheetAccount[]
  /** Konten mit ueberfaelligem Abgleich. */
  overdueIds: string[]
  /** Vorschlag fuer den Fehlbetrag, aus den Befunden. */
  transfer?: SuggestedTransfer | null
  accountNames: Record<string, string>
  currency: string
  /** Heimatgruppe mit ungebundenen Umschlaegen: Der Ausgleichsposten enthaelt auch deren Geld. */
  includesUnbound?: boolean
}>()

const quickCapture = useQuickCapture()
const money = (cents: number) => formatMoneyFromCents(cents, props.currency)

const stateText = computed(() => {
  if (props.state === 'missing') return `fehlen ${money(props.sheet.missing)}`
  if (props.state === 'surplus') return `${money(props.sheet.balancing?.amount ?? 0)} unverplant`
  return 'gedeckt'
})

const balancingLabel = computed(() => {
  if (props.sheet.balancing?.kind === 'unplanned') return 'unverplant'
  return props.includesUnbound ? 'Zu verteilen & ohne Bindung' : 'Zu verteilen'
})

function bookTransfer(transfer: SuggestedTransfer) {
  quickCapture.open('accountTransfer', {
    accountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    amountCents: transfer.amount,
    note: 'Ausgleich Deckung',
  })
}
</script>

<template>
  <section :class="['sheet', `sheet--${state}`]" :aria-label="`Bilanz ${label}`">
    <header class="sheet__head">
      <h3 class="sheet__label">{{ label }}</h3>
      <span :class="['sheet__state', `sheet__state--${state}`]">
        <i :class="state === 'missing' ? 'pi pi-exclamation-triangle' : 'pi pi-check'" aria-hidden="true" />
        {{ stateText }}
      </span>
    </header>

    <div class="sheet__grid">
      <div class="sheet__col-head">Liegt auf</div>
      <div class="sheet__col-head">Ist gedacht für</div>

      <ul class="sheet__list">
        <li v-for="account in accounts" :key="account.id" class="sheet__item">
          <span class="sheet__name">
            <i :class="accountTypeIcon(account.type)" aria-hidden="true" />
            <NuxtLink :to="`/households/accounts/${account.id}`" class="sheet__link">{{ account.name }}</NuxtLink>
            <span v-if="overdueIds.includes(account.id)" class="sheet__tag">Abgleich fällig</span>
          </span>
          <span :class="['sheet__amount', { 'sheet__amount--negative': account.balance < 0 }]">{{ money(account.balance) }}</span>
        </li>
        <li v-if="sheet.missing > 0" class="sheet__item sheet__item--missing">
          <span class="sheet__name">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" />
            fehlt auf den Konten
          </span>
          <span class="sheet__amount">{{ money(sheet.missing) }}</span>
          <Button
            v-if="transfer"
            class="sheet__action"
            :label="`${money(transfer.amount)} ${accountNames[transfer.fromAccountId] ?? ''} → ${accountNames[transfer.toAccountId] ?? ''}`"
            icon="pi pi-arrow-right-arrow-left"
            size="small"
            severity="danger"
            @click="bookTransfer(transfer)"
          />
        </li>
      </ul>

      <ul class="sheet__list">
        <li v-for="line in sheet.lines" :key="line.kind === 'group' ? `g-${line.group}` : line.envelope.id" class="sheet__item">
          <template v-if="line.kind === 'group'">
            <details class="sheet__group">
              <summary>
                <span class="sheet__name">{{ line.label }} <span class="sheet__count">({{ line.envelopes.length }})</span></span>
                <span class="sheet__amount">{{ money(line.total) }}</span>
              </summary>
              <ul class="sheet__sublist">
                <li v-for="envelope in line.envelopes" :key="envelope.id">
                  <span>{{ envelope.name }}</span>
                  <span class="sheet__amount">{{ money(envelope.balance) }}</span>
                </li>
              </ul>
            </details>
          </template>
          <template v-else>
            <span class="sheet__name">
              <i v-if="line.envelope.balance < 0" class="pi pi-exclamation-triangle sheet__warn" aria-hidden="true" />
              {{ line.envelope.name }}
            </span>
            <span :class="['sheet__amount', { 'sheet__amount--negative': line.envelope.balance < 0 }]">{{ money(line.envelope.balance) }}</span>
          </template>
        </li>
        <li v-if="sheet.lines.length === 0" class="sheet__item sheet__empty">Keine gebundenen Umschläge</li>
        <li v-if="sheet.balancing" :class="['sheet__item', 'sheet__item--balancing', `sheet__item--${sheet.balancing.kind}`]">
          <span class="sheet__name">{{ balancingLabel }}</span>
          <span class="sheet__amount">{{ money(sheet.balancing.amount) }}</span>
        </li>
      </ul>

      <div class="sheet__sum">
        <span>Summe</span>
        <span class="sheet__amount">{{ money(sheet.total) }}</span>
      </div>
      <div class="sheet__sum">
        <span>Summe</span>
        <span class="sheet__amount">{{ money(sheet.total) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 12px 14px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}

.sheet--missing {
  border-color: color-mix(in srgb, var(--color-accent-danger-text) 45%, transparent);
}

.sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--color-border-subtle);
}

.sheet__label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.sheet__state {
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.sheet__state i {
  font-size: 0.75rem;
  margin-right: 0.25rem;
}

.sheet__state--ok {
  color: var(--color-accent-success-text);
}

.sheet__state--surplus {
  color: var(--color-accent-warning-text);
}

.sheet__state--missing {
  color: var(--color-accent-danger-text);
}

/* Zwei Spalten, drei Zeilen: Kopf, Listen, Summe. Nur die Summen stehen auf
   einer Hoehe; die Listen sind unabhaengig (keine Zuordnung). */
.sheet__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 1.75rem;
}

.sheet__col-head {
  padding-bottom: 6px;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.sheet__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sheet__list + .sheet__list {
  /* Trennlinie mittig in der Spaltenluecke, damit links nichts klebt. */
  padding-left: 0.875rem;
  margin-left: -0.875rem;
  border-left: 1px solid var(--color-border-subtle);
}

.sheet__col-head + .sheet__col-head {
  /* Trennlinie mittig in der Spaltenluecke, damit links nichts klebt. */
  padding-left: 0.875rem;
  margin-left: -0.875rem;
  border-left: 1px solid var(--color-border-subtle);
}

.sheet__item,
.sheet__group summary,
.sheet__sublist li,
.sheet__sum {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 0.75rem;
  font-size: 0.875rem;
}

.sheet__name {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-width: 0;
}

.sheet__name > i {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.sheet__link {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
}

.sheet__link:hover,
.sheet__link:focus-visible {
  text-decoration: underline;
}

.sheet__tag {
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--color-accent-warning-soft);
  color: var(--color-accent-warning-text);
  font-size: 0.7rem;
  font-weight: 600;
}

.sheet__amount {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sheet__amount--negative,
.sheet__item--missing,
.sheet__warn {
  color: var(--color-accent-danger-text);
}

.sheet__item--missing .sheet__name > i {
  color: inherit;
}

.sheet__action {
  margin-top: 4px;
}

.sheet__item--balancing {
  color: var(--color-text-secondary);
  font-style: italic;
}

.sheet__item--unplanned {
  color: var(--color-accent-warning-text);
}

.sheet__count {
  color: var(--color-text-muted);
}

.sheet__group {
  width: 100%;
}

.sheet__group summary {
  cursor: pointer;
  list-style: none;
}

.sheet__group summary::-webkit-details-marker {
  display: none;
}

.sheet__group summary .sheet__name::before {
  content: '▸';
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.sheet__group[open] summary .sheet__name::before {
  content: '▾';
}

.sheet__sublist {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0 2px;
  padding: 0 0 0 0.9rem;
  list-style: none;
}

.sheet__sublist li {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.sheet__empty {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.sheet__sum {
  align-self: end;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 2px solid var(--color-border-subtle);
  font-weight: 700;
}

.sheet__sum + .sheet__sum {
  /* Trennlinie mittig in der Spaltenluecke, damit links nichts klebt. */
  padding-left: 0.875rem;
  margin-left: -0.875rem;
}

/* Mobil: schmale Spalten, Betraege unter den Namen. */
@media (max-width: 520px) {
  .sheet__grid {
    column-gap: 1rem;
  }

  .sheet__list + .sheet__list,
  .sheet__col-head + .sheet__col-head,
  .sheet__sum + .sheet__sum {
    padding-left: 0.5rem;
    margin-left: -0.5rem;
  }

  .sheet__item,
  .sheet__group summary,
  .sheet__sum {
    flex-direction: column;
    align-items: stretch;
    font-size: 0.8rem;
  }

  .sheet__amount {
    text-align: right;
  }

  .sheet__tag {
    font-size: 0.65rem;
  }
}
</style>
