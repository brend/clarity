<script setup lang="ts">
type SummaryTone = "default" | "accent" | "muted";

defineProps<{
  cards: Array<{
    key: string;
    label: string;
    value: string;
    meta: string;
    tone?: SummaryTone;
  }>;
}>();
</script>

<template>
  <section class="summary-grid" aria-label="Workbench summary">
    <article
      v-for="card in cards"
      :key="card.key"
      class="summary-card"
      :class="`summary-card-${card.tone ?? 'default'}`"
    >
      <div class="summary-label">{{ card.label }}</div>
      <div class="summary-value" :title="card.value">{{ card.value }}</div>
      <div class="summary-meta">{{ card.meta }}</div>
    </article>
  </section>
</template>

<style scoped>
.summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
}

.summary-card {
  min-width: 0;
  padding: 0.7rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  display: grid;
  gap: 0.25rem;
}

.summary-card-accent {
  border-left: 3px solid var(--accent);
}

.summary-card-muted {
  background: var(--bg-surface-muted);
}

.summary-label {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.summary-value {
  min-width: 0;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.summary-meta {
  font-size: 0.68rem;
  color: var(--text-secondary);
  line-height: 1.35;
}

@media (max-width: 1280px) {
  .summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
