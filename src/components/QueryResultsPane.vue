<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceQueryResultPane } from "../types/clarity";

const props = defineProps<{
  resultPanes: WorkspaceQueryResultPane[];
  activeResultPaneId: string | null;
  emptyStateMessage: string;
  isLikelyNumeric: (value: string) => boolean;
}>();

const emit = defineEmits<{
  activatePane: [paneId: string];
}>();

const activePane = computed<WorkspaceQueryResultPane | null>(() => {
  if (!props.resultPanes.length) {
    return null;
  }

  const currentPane = props.resultPanes.find((pane) => pane.id === props.activeResultPaneId);
  return currentPane ?? props.resultPanes[0];
});
</script>

<template>
  <section class="results-pane">
    <div class="results-header">
      <div v-if="props.resultPanes.length" class="results-tabs" role="tablist" aria-label="Result tabs">
        <button
          v-for="pane in props.resultPanes"
          :key="pane.id"
          type="button"
          role="tab"
          class="results-tab"
          :class="{ active: pane.id === activePane?.id }"
          :aria-selected="pane.id === activePane?.id"
          @click="emit('activatePane', pane.id)"
        >
          {{ pane.title }}
        </button>
      </div>
      <div v-else class="results-title">Results</div>
      <div v-if="activePane?.errorMessage" class="error-inline">{{ activePane.errorMessage }}</div>
    </div>

    <div class="results-content">
      <p v-if="!activePane || !activePane.queryResult" class="muted">{{ props.emptyStateMessage }}</p>

      <p v-else-if="activePane.queryResult.rowsAffected !== null" class="muted">
        Rows affected: {{ activePane.queryResult.rowsAffected }}
      </p>

      <table v-else-if="activePane.queryResult.columns.length" class="results-table">
        <thead>
          <tr>
            <th v-for="column in activePane.queryResult.columns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in activePane.queryResult.rows" :key="`row-${rowIndex}`">
            <td
              v-for="(value, colIndex) in row"
              :key="`col-${rowIndex}-${colIndex}`"
              :class="{ 'results-cell-number': props.isLikelyNumeric(value) }"
            >
              {{ value }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.results-pane {
  display: grid;
  grid-template-rows: 30px 1fr;
  min-height: 0;
  background: var(--bg-surface);
  overflow: hidden;
}

.results-header {
  display: flex;
  align-items: center;
  padding: 0 0.48rem;
  border-bottom: 1px solid var(--panel-separator);
  background: var(--table-header-bg);
}

.results-title {
  font-size: 0.73rem;
  font-weight: 500;
  color: var(--text-primary);
}

.results-tabs {
  display: flex;
  align-items: stretch;
  min-width: 0;
  height: 100%;
}

.results-tab {
  height: 100%;
  border: 0;
  border-right: 1px solid var(--panel-separator);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.69rem;
  font-weight: 500;
  padding: 0 0.58rem;
  cursor: pointer;
}

.results-tab:hover {
  background: var(--bg-hover);
}

.results-tab.active {
  background: var(--tab-active-bg);
  color: var(--text-primary);
}

.error-inline {
  margin-left: auto;
  font-size: 0.69rem;
  color: var(--danger);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-content {
  min-height: 0;
  overflow: auto;
  padding: 0;
  margin: 0;
  font-family: Consolas, "Courier New", monospace;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.73rem;
  margin: 0;
}

.results-table th,
.results-table td {
  border: 0;
  border-bottom: 1px solid var(--table-divider);
  text-align: left;
  padding: 0.26rem 0.38rem;
}

.results-table th {
  background: var(--table-header-bg);
  position: sticky;
  top: 0;
  font-weight: 600;
}

.results-table tbody tr:nth-child(even) {
  background: var(--table-row-alt);
}

.results-table tbody tr:hover {
  background: var(--bg-hover);
}

.results-cell-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--text-secondary);
  font-size: 0.71rem;
}
</style>
