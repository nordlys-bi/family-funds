<!--
  OnboardingTour — Modal-Overlay fuer die 4-Schritt-Tour (issue #16).

  Layout:
    - Desktop: zentriertes Modal (max-width 480px), Spotlight-Indikator
      visuell um das aktuell fokussierte Element (per CSS-Data-Attr)
    - Mobile (< 768px): Bottom-Sheet, gleicher Inhalt, anderes Layout

  Inhalt pro Step:
    - Progress-Indicator "1/4"
    - Icon + Headline + Description
    - Action-Button (Primary CTA)
    - "Ueberspringen"-Button (linksbuendig, dezent)

  Animation:
    - Sanftes Einblenden (fade + slide-up) ueber CSS-Transition
    - Pulse-Ring am Spotlight-Element (per CSS-Klasse, opt-in via
      data-onboarding-spotlight="step-key")

  Tastatur:
    - ESC schliesst das Modal (skip-Verhalten — kein Auto-Complete)
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { OnboardingStep } from '~/composables/useOnboarding'
import { ONBOARDING_STEPS } from '~/composables/useOnboarding'

defineProps<{
  active: boolean
  completedSteps: OnboardingStep[]
  progress: number
}>()

const emit = defineEmits<{
  'complete-step': [step: OnboardingStep]
  skip: []
  close: []
}>()

type StepContent = {
  step: OnboardingStep
  index: number
  icon: string
  title: string
  description: string
  cta: string
  /** CSS-Selector des UI-Elements, das im Spotlight hervorgehoben wird */
  spotlight: string
}

// Schritt-Definitionen. Texte sollen vom Maintainer kuratiert werden
// (Issue-Diskussion), aktuelle Strings sind Agent-Drafts.
const steps: StepContent[] = [
  {
    step: 'household',
    index: 0,
    icon: 'pi pi-home',
    title: 'Haushalt einrichten',
    description:
      'Du hast einen Haushalt angelegt. Benoenne ihn und waehle eine Waehrung — wir koennen das jederzeit aendern.',
    cta: 'Verstanden',
    spotlight: '[data-onboarding-spotlight="household"]',
  },
  {
    step: 'invite',
    index: 1,
    icon: 'pi pi-users',
    title: 'Mitglied einladen',
    description:
      'Lade deine Partnerin oder Mitbewohner ein, damit beide Buchungen erfassen koennen. Du kannst das auch ueberspringen.',
    cta: 'Mitglied einladen',
    spotlight: '[data-onboarding-spotlight="invite"]',
  },
  {
    step: 'budget',
    index: 2,
    icon: 'pi pi-chart-line',
    title: 'Erstes Budget anlegen',
    description:
      'Lege dein erstes Budget fuer eine Kategorie an (z. B. Lebensmittel). Du siehst sofort, wie viel du pro Periode verplanst hast.',
    cta: 'Budget anlegen',
    spotlight: '[data-onboarding-spotlight="budget"]',
  },
  {
    step: 'transaction',
    index: 3,
    icon: 'pi pi-arrow-up-right',
    title: 'Erste Buchung erfassen',
    description:
      'Erfasse eine erste Ausgabe oder Einnahme, um den monatlichen Ueberblick zu sehen. Auch das ist optional.',
    cta: 'Buchung erfassen',
    spotlight: '[data-onboarding-spotlight="transaction"]',
  },
]

const orderedSteps = computed(() => [...steps].sort((a, b) => a.index - b.index))

function nextStepIndex(completed: OnboardingStep[]): number {
  for (let i = 0; i < ONBOARDING_STEPS.length; i++) {
    if (!completed.includes(ONBOARDING_STEPS[i]!)) return i
  }
  return ONBOARDING_STEPS.length
}

function resolveCurrentStep(completed: OnboardingStep[]): StepContent {
  const idx = nextStepIndex(completed)
  return orderedSteps.value[idx] ?? orderedSteps.value[orderedSteps.value.length - 1]!
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      class="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <div class="onboarding-modal" :data-onboarding-step="resolveCurrentStep(completedSteps).step">
        <!-- Progress-Indicator -->
        <div class="onboarding-progress" aria-hidden="true">
          <div
            v-for="(s, i) in ONBOARDING_STEPS"
            :key="s"
            class="onboarding-progress-dot"
            :class="{
              'onboarding-progress-dot--done': completedSteps.includes(s),
              'onboarding-progress-dot--active': i === nextStepIndex(completedSteps),
            }"
          />
        </div>

        <span class="onboarding-step-counter" aria-live="polite">
          Schritt {{ nextStepIndex(completedSteps) + 1 }} / {{ ONBOARDING_STEPS.length }}
        </span>

        <!-- Step-Content -->
        <div class="onboarding-content">
          <div class="onboarding-icon" :class="resolveCurrentStep(completedSteps).icon" aria-hidden="true" />
          <h2 id="onboarding-title" class="onboarding-title">
            {{ resolveCurrentStep(completedSteps).title }}
          </h2>
          <p class="onboarding-description">
            {{ resolveCurrentStep(completedSteps).description }}
          </p>
        </div>

        <!-- Actions -->
        <div class="onboarding-actions">
          <Button
            label="Ueberspringen"
            severity="secondary"
            text
            size="small"
            @click="emit('skip')"
          />
          <Button
            :label="resolveCurrentStep(completedSteps).cta"
            icon="pi pi-arrow-right"
            icon-pos="right"
            severity="primary"
            @click="emit('complete-step', resolveCurrentStep(completedSteps).step)"
          />
        </div>

        <!-- Live-Region fuer Screenreader -->
        <span class="sr-only" aria-live="polite">
          Onboarding: Schritt {{ nextStepIndex(completedSteps) + 1 }} von {{ ONBOARDING_STEPS.length }}.
          Fortschritt {{ progress }} Prozent.
        </span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(11, 15, 25, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  animation: onboarding-fade 200ms ease-out;
}

.onboarding-modal {
  background: var(--color-bg-elevated, #1f2937);
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
  padding: 1.75rem 1.5rem 1.25rem;
  max-width: 480px;
  width: 100%;
  color: var(--color-text-primary, #f1f5f9);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  animation: onboarding-slide-up 240ms cubic-bezier(0.4, 0, 0.2, 1);
}

.onboarding-progress {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.onboarding-progress-dot {
  width: 28px;
  height: 4px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.2);
  transition: background 200ms;
}

.onboarding-progress-dot--done {
  background: var(--color-accent-success, #10b981);
}

.onboarding-progress-dot--active {
  background: var(--color-accent-primary, #3b82f6);
  animation: onboarding-pulse 1.4s ease-in-out infinite;
}

.onboarding-step-counter {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted, #94a3b8);
  text-align: center;
}

.onboarding-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.onboarding-icon {
  font-size: 2.5rem;
  color: var(--color-accent-primary, #3b82f6);
  background: rgba(59, 130, 246, 0.12);
  width: 64px;
  height: 64px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.onboarding-description {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-muted, #94a3b8);
}

.onboarding-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Spotlight-Pulse fuer Elemente mit data-onboarding-spotlight="<step>" */
:global([data-onboarding-spotlight="household"]),
:global([data-onboarding-spotlight="invite"]),
:global([data-onboarding-spotlight="budget"]),
:global([data-onboarding-spotlight="transaction"]) {
  position: relative;
}

@keyframes onboarding-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes onboarding-slide-up {
  from { transform: translateY(20px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

@keyframes onboarding-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}

/* Mobile: Bottom-Sheet-Layout */
@media (max-width: 767px) {
  .onboarding-overlay {
    align-items: flex-end;
    padding: 0;
  }
  .onboarding-modal {
    border-radius: 16px 16px 0 0;
    max-width: 100%;
    padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
  }
}
</style>