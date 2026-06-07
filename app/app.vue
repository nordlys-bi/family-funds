<template>
  <div class="my-app-dark app-shell">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

<style>
/* Global foundation styles */
html,
body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background-color: #0b0f19;
  color-scheme: dark;
}

body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #f1f5f9;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app-shell {
  min-height: 100vh;
  background: radial-gradient(circle at top, rgba(59, 130, 246, 0.08), transparent 30%), #0b0f19;
}

.my-app-dark :where(.p-inputtext, .p-select, .p-inputnumber, .p-datepicker) {
  background: rgba(8, 15, 30, 0.96);
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.28);
}

.my-app-dark :where(.p-inputtext, .p-select, .p-inputnumber-input, .p-datepicker-input) {
  background: rgba(8, 15, 30, 0.96);
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.28);
}

.my-app-dark :where(.p-inputtext, .p-select, .p-inputnumber-input, .p-datepicker-input) {
  border-radius: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 0 0 1px rgba(15, 23, 42, 0.1);
}

.my-app-dark :where(.p-inputtext::placeholder, .p-inputnumber-input::placeholder, .p-datepicker-input::placeholder) {
  color: #64748b;
}

.my-app-dark :where(.p-select-label) {
  color: #f8fafc;
}

.my-app-dark :where(.p-inputtext:hover, .p-select:hover, .p-inputnumber-input:hover, .p-datepicker-input:hover) {
  border-color: rgba(96, 165, 250, 0.58);
}

.my-app-dark :where(.p-inputtext:focus, .p-inputnumber-input:focus, .p-datepicker-input:focus) {
  border-color: rgba(96, 165, 250, 0.9);
  box-shadow:
    0 0 0 4px rgba(59, 130, 246, 0.16),
    0 0 0 1px rgba(96, 165, 250, 0.3);
}

.my-app-dark :where(.p-select:focus-within, .p-inputnumber:focus-within, .p-datepicker:focus-within) {
  border-color: rgba(96, 165, 250, 0.9);
  box-shadow:
    0 0 0 4px rgba(59, 130, 246, 0.16),
    0 0 0 1px rgba(96, 165, 250, 0.3);
}

.my-app-dark :where(.p-button) {
  border-radius: 14px;
}
</style>
