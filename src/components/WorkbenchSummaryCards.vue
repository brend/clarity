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
  gap: 0.95rem;
}

.summary-card {
  position: relative;
  min-width: 0;
  padding: 1.1rem 1.1rem 1.05rem;
  border-radius: 1.45rem;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-surface) 94%, white);
  box-shadow: var(--card-shadow);
  display: grid;
  gap: 0.35rem;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.summary-card::before {
  content: "";
  position: absolute;
  top: 0.8rem;
  left: 1.1rem;
  width: 2.4rem;
  height: 0.18rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.summary-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 34px rgba(89, 70, 80, 0.1);
}

.summary-card-accent {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-soft) 52%, white) 0%,
    color-mix(in srgb, var(--bg-surface) 92%, white) 100%
  );
}

.summary-card-muted {
  background: color-mix(in srgb, var(--bg-surface-muted) 82%, white);
}

.summary-label {
  margin-top: 0.45rem;
  font-size: 0.69rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.summary-value {
  min-width: 0;
  font-size: 1.02rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.summary-meta {
  font-size: 0.76rem;
  color: var(--text-secondary);
  line-height: 1.45;
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
