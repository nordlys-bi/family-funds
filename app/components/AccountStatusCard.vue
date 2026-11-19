<!--
  AccountStatusCard — Status der Konten zuerst (issue #198).

  Sagt, was zu tun ist, statt zu rechnen: Fehlbetraege (rot) und Hinweise
  (gelb) als Saetze mit einer Aktion, die Betrag und Konten vorbelegt. Die
  Rechnung selbst steht in `account-coverage.ts` und auf der Konten-Seite
  unter "Wie gerechnet?".

  `compact` (Dashboard): nur eine Zeile, und nur wenn etwas ansteht.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { AccountStatus, CoverageFinding, SuggestedTransfer } from '~/utils/account-coverage'

const props = defineProps<{
  status: AccountStatus
  accountNames: Record<string, string>
  currency: string
  compact?: boolean
}>()

const quickCapture = useQuickCapture()
const money = (cents: number) => formatMoneyFromCents(cents, props.currency)

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`
const headline = computed(() => {
  const { problems, hints } = props.status
  if (problems > 0) {
    return `${count(problems, 'Sache', 'Sachen')} zu erledigen${hints > 0 ? ` · ${count(hints, 'Hinweis', 'Hinweise')}` : ''}`
  }
  if (hints > 0) return `Gedeckt, ${count(hints, 'Hinweis', 'Hinweise')}`
  return 'Alles gedeckt'
})
const tone = computed(() => (props.status.problems > 0 ? 'problem' : props.status.hints > 0 ? 'hint' : 'ok'))
const hasFindings = computed(() => props.status.findings.length > 0)

function transferLabel(transfer: SuggestedTransfer) {
  return `${money(transfer.amount)} ${props.accountNames[transfer.fromAccountId] ?? ''} → ${props.accountNames[transfer.toAccountId] ?? ''}`
}

function bookTransfer(transfer: SuggestedTransfer) {
  quickCapture.open('accountTransfer', {
    accountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    amountCents: transfer.amount,
    note: 'Ausgleich Deckung',
  })
}

function reconcileLink(accountId: string) {
  return `/households/accounts/${accountId}?abgleich=1`
}

function title(finding: CoverageFinding) {
  switch (finding.kind) {
    case 'missing':
      return `Auf ${finding.groupLabel} fehlen ${money(finding.amount)}`
    case 'surplus':
      return `Auf ${finding.groupLabel} liegen ${money(finding.amount)} unverplant`
    case 'tight':
      return `Bis Monatsende wird es auf ${finding.groupLabel} knapp`
    case 'reconcile':
      return finding.never ? `${finding.accountName}: noch nie abgeglichen` : `${finding.accountName}: seit ${finding.days} Tagen nicht abgeglichen`
  }
}

function detail(finding: CoverageFinding) {
  switch (finding.kind) {
    case 'missing':
      if (!finding.transfer) {
        return 'Kein anderes Konto hat genug übrig: Die Umschläge versprechen mehr Geld, als da ist. Konten abgleichen oder Umschläge kürzen.'
      }
      return [
        `Auf ${finding.sourceLabel} liegt mehr, als seine Umschläge brauchen. Meist fehlt ein Kontoübertrag.`,
        finding.transfer.amount < finding.amount ? `Der Übertrag deckt ${money(finding.transfer.amount)}, insgesamt fehlen ${money(finding.amount)}.` : '',
      ].filter(Boolean).join(' ')
    case 'surplus':
      return `Mehr, als die Umschläge dort brauchen. Freies Geld gehört auf ${finding.homeLabel}: dort zuteilen oder übertragen.`
    case 'tight':
      return `Die vorgemerkten Zuteilungen (${money(finding.reserved)}) brauchen ${money(finding.amount)} mehr, als dort übrig ist. Kommt vorher Geld auf ${finding.mainAccountName}, z. B. das Gehalt, erledigt sich das.`
    case 'reconcile':
      return 'Die Deckung stimmt nur, wenn die Kontostände stimmen.'
  }
}
</script>

<template>
  <NuxtLink
    v-if="compact && hasFindings"
    to="/households/accounts"
    :class="['account-status-line', `account-status--${tone}`]"
  >
    <i :class="tone === 'problem' ? 'pi pi-exclamation-triangle' : 'pi pi-info-circle'" aria-hidden="true" />
    <span>Konten: {{ headline }}</span>
    <i class="pi pi-angle-right account-status-line__chevron" aria-hidden="true" />
  </NuxtLink>

  <section v-else-if="!compact" :class="['account-status', `account-status--${tone}`]" aria-label="Status der Konten">
    <header class="account-status__head">
      <i
        :class="tone === 'ok' ? 'pi pi-check-circle' : tone === 'problem' ? 'pi pi-exclamation-triangle' : 'pi pi-info-circle'"
        aria-hidden="true"
      />
      <strong>{{ headline }}</strong>
    </header>
    <p v-if="!status.coverage.hasBindings" class="account-status__detail">
      Noch prüft die App nicht, ob das Geld auf dem richtigen Konto liegt. Binde z. B. Rücklagen ans Sparkonto, dann
      siehst du hier sofort, wenn ein Übertrag fehlt.
      <NuxtLink to="/budgeting/envelopes">Umschläge binden</NuxtLink>
    </p>
    <p v-else-if="!hasFindings" class="account-status__detail">
      Jede Kontogruppe hat mindestens so viel, wie ihre Umschläge brauchen.
    </p>

    <ul v-if="hasFindings" class="account-status__findings">
      <li
        v-for="(finding, index) in status.findings"
        :key="index"
        :class="['account-status__finding', `account-status__finding--${finding.severity}`]"
      >
        <div class="account-status__finding-text">
          <span class="account-status__finding-title">{{ title(finding) }}</span>
          <span class="account-status__detail">{{ detail(finding) }}</span>
        </div>
        <div class="account-status__actions">
          <Button
            v-if="(finding.kind === 'missing' || finding.kind === 'surplus') && finding.transfer"
            :label="transferLabel(finding.transfer)"
            icon="pi pi-arrow-right-arrow-left"
            size="small"
            :severity="finding.severity === 'problem' ? 'danger' : 'secondary'"
            :outlined="finding.severity !== 'problem'"
            @click="bookTransfer(finding.transfer)"
          />
          <Button
            v-if="finding.kind === 'surplus'"
            label="Zuteilen"
            icon="pi pi-inbox"
            size="small"
            severity="secondary"
            text
            @click="quickCapture.open('transfer')"
          />
          <NuxtLink v-if="finding.kind === 'missing' && finding.accountId" :to="reconcileLink(finding.accountId)" class="account-status__link">
            Andere Ursache? Abgleichen
          </NuxtLink>
          <NuxtLink v-if="finding.kind === 'reconcile'" :to="reconcileLink(finding.accountId)" class="account-status__link">
            Abgleichen
          </NuxtLink>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.account-status {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 12px 14px;
  border: 1px solid var(--color-border-subtle);
  border-left-width: 4px;
  border-radius: 12px;
  background: rgba(148, 163, 184, 0.06);
}

.account-status--ok {
  border-left-color: var(--color-accent-success-text);
}

.account-status--hint {
  border-left-color: var(--color-accent-warning-text);
}

.account-status--problem {
  border-left-color: var(--color-accent-danger-text);
}

.account-status__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.account-status--ok .account-status__head i {
  color: var(--color-accent-success-text);
}

.account-status--hint .account-status__head i {
  color: var(--color-accent-warning-text);
}

.account-status--problem .account-status__head i {
  color: var(--color-accent-danger-text);
}

.account-status__detail {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.account-status__findings {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.account-status__finding {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--color-border-subtle);
}

.account-status__finding-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 18rem;
  min-width: 0;
}

.account-status__finding-title {
  font-weight: 600;
  font-size: 0.9rem;
}

.account-status__finding--problem .account-status__finding-title {
  color: var(--color-accent-danger-text);
}

.account-status__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.account-status__link {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.account-status-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--color-border-subtle);
  border-left-width: 4px;
  border-radius: 10px;
  color: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
}

.account-status-line.account-status--hint {
  border-left-color: var(--color-accent-warning-text);
}

.account-status-line.account-status--problem {
  border-left-color: var(--color-accent-danger-text);
}

.account-status-line__chevron {
  margin-left: auto;
  color: var(--color-text-muted);
}
</style>
