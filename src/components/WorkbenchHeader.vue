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
    <div class="header-main">
      <div class="header-tab-strip">
        <span class="header-app-badge">Clarity</span>
        <span v-if="props.workspaceLabel" class="header-workspace-tab">
          {{ props.workspaceLabel }}
        </span>
      </div>
      <p class="header-subtitle">
        {{ props.statusMessage || props.connectionLabel || "No active connection" }}
      </p>
    </div>

    <div class="header-status">
      <span class="status-chip" :class="{ connected: props.isConnected }">
        {{ props.isConnected ? "Connected" : "Offline" }}
      </span>
      <span class="status-chip">{{ props.providerLabel }}</span>
      <span class="status-chip">{{ props.connectedSchema || "No schema" }}</span>
      <span class="status-chip">
        {{ props.transactionActive ? "Transaction" : "Auto-commit" }}
      </span>
    </div>

    <div class="header-actions">
      <button class="header-action" type="button" @click="emit('openExport')">
        <AppIcon name="save" :size="15" />
        Export
      </button>
      <button class="header-action" type="button" @click="emit('openSettings')">
        <AppIcon name="settings" :size="15" />
        Settings
      </button>
    </div>
  </header>
</template>

<style scoped>
.workbench-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0.55rem 0.55rem;
  border-radius: 20px 20px 12px 12px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 82%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 94%, transparent) 100%
    );
}

.header-main {
  min-width: 0;
}

.header-tab-strip {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.header-app-badge {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0 0.8rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-surface-muted) 88%, transparent);
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--text-primary);
}

.header-workspace-tab {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0 0.9rem;
  border-radius: 14px 14px 6px 6px;
  background: color-mix(in srgb, var(--bg-selected) 40%, var(--bg-surface));
  border: 0;
  box-shadow: inset 0 -2px 0 var(--accent);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.header-subtitle {
  margin: 0.35rem 0 0 0.15rem;
  color: var(--text-secondary);
  font-size: 0.7rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-status {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.9rem;
  padding: 0.2rem 0.7rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface-muted) 86%, transparent);
  font-size: 0.68rem;
  color: var(--text-secondary);
}

.status-chip.connected {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, var(--bg-surface));
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.header-action {
  border: 0;
  border-radius: 12px;
  background: color-mix(in srgb, var(--control-bg) 92%, transparent);
  color: var(--text-primary);
  padding: 0.58rem 0.82rem;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
}

.header-action:hover {
  background: var(--control-hover);
}

.header-action:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

@media (max-width: 1220px) {
  .workbench-header {
    grid-template-columns: 1fr;
  }

  .header-status,
  .header-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 700px) {
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
