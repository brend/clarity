<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  workspaceLabel: string;
  statusMessage: string;
  isConnected: boolean;
  connectionLabel: string;
  providerLabel: string;
  connectedSchema: string;
  transactionActive: boolean;
}>();

const emit = defineEmits<{
  openExport: [];
  openSettings: [];
}>();
</script>

<template>
  <header class="workbench-header">
    <div class="header-intro">
      <div class="header-eyebrow">Oracle-first desktop workbench</div>
      <div class="header-title-row">
        <h1 class="header-title">Clarity</h1>
        <span class="header-workspace">{{ props.workspaceLabel }}</span>
      </div>
      <p class="header-subtitle">
        {{ props.statusMessage || "Designed for calm, focused database work." }}
      </p>
    </div>

    <div class="header-status">
      <div class="status-label">Session context</div>
      <div class="status-chip-row">
        <span class="status-pill" :class="{ connected: props.isConnected }">
          {{ props.isConnected ? "Connected" : "Offline" }}
        </span>
        <span class="status-chip">{{ props.providerLabel }}</span>
        <span class="status-chip">{{ props.connectedSchema || "No schema" }}</span>
        <span
          class="status-chip"
          :class="{ 'status-chip-accent': props.transactionActive }"
        >
          {{ props.transactionActive ? "Transaction active" : "Auto-commit" }}
        </span>
      </div>
      <span class="status-connection" :title="props.connectionLabel">
        {{ props.connectionLabel }}
      </span>
    </div>

    <div class="header-actions">
      <button class="header-action" type="button" @click="emit('openExport')">
        <AppIcon name="save" :size="15" />
        Export Schema
      </button>
      <button class="header-action accent" type="button" @click="emit('openSettings')">
        <AppIcon name="settings" :size="15" />
        Settings
      </button>
    </div>
  </header>
</template>

<style scoped>
.workbench-header {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: center;
  padding: 1.35rem 1.5rem;
  border-radius: 1.8rem;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-surface) 92%, white);
  box-shadow: var(--card-shadow);
}

.header-intro {
  min-width: 0;
}

.header-eyebrow {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-subtle);
  margin-bottom: 0.35rem;
}

.header-title-row {
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
  flex-wrap: wrap;
}

.header-title {
  margin: 0;
  font-size: clamp(1.6rem, 2vw, 2.15rem);
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.header-workspace {
  font-size: 0.86rem;
  color: var(--accent-strong);
  font-weight: 600;
}

.header-subtitle {
  margin: 0.45rem 0 0;
  color: var(--text-secondary);
  font-size: 0.83rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-status {
  display: grid;
  gap: 0.45rem;
  align-content: center;
}

.status-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.status-chip-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.status-pill,
.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2rem;
  padding: 0.35rem 0.72rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-surface-muted);
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.status-pill {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.status-pill.connected {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
  background: color-mix(in srgb, var(--success) 11%, white);
}

.status-chip-accent {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.status-connection {
  font-size: 0.77rem;
  color: var(--text-subtle);
  min-width: 0;
  max-width: 24rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}

.header-action {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-primary);
  padding: 0.72rem 1rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.77rem;
  font-weight: 600;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease;
}

.header-action:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(31, 41, 55, 0.08);
}

.header-action:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.header-action.accent {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

@media (max-width: 1220px) {
  .workbench-header {
    grid-template-columns: 1fr;
  }

  .header-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 700px) {
  .workbench-header {
    padding: 1.1rem;
    border-radius: 1.3rem;
  }

  .header-actions {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .header-action {
    justify-content: center;
  }
}
</style>
