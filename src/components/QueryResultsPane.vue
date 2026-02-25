<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
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

const MIN_COLUMN_WIDTH = 88;
const DEFAULT_COLUMN_WIDTH = 180;

type ColumnResizeState = {
  index: number;
  startX: number;
  startWidth: number;
};

const columnWidths = ref<number[]>([]);
const resizeState = ref<ColumnResizeState | null>(null);
const activeColumns = computed<string[]>(() => activePane.value?.queryResult?.columns ?? []);

function resetColumnWidths(): void {
  columnWidths.value = activeColumns.value.map(() => DEFAULT_COLUMN_WIDTH);
}

watch(
  () => [activePane.value?.id ?? "", activeColumns.value.length],
  () => {
    resetColumnWidths();
  },
  { immediate: true },
);

function getColumnWidth(index: number): number {
  return columnWidths.value[index] ?? DEFAULT_COLUMN_WIDTH;
}

function onColumnResizeMove(event: MouseEvent): void {
  const state = resizeState.value;
  if (!state) {
    return;
  }

  const nextWidth = Math.max(MIN_COLUMN_WIDTH, state.startWidth + (event.clientX - state.startX));
  const nextWidths = [...columnWidths.value];
  nextWidths[state.index] = nextWidth;
  columnWidths.value = nextWidths;
}

function stopColumnResize(): void {
  if (!resizeState.value) {
    return;
  }

  resizeState.value = null;
  window.removeEventListener("mousemove", onColumnResizeMove);
  window.removeEventListener("mouseup", stopColumnResize);
}

function startColumnResize(index: number, event: MouseEvent): void {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  resizeState.value = {
    index,
    startX: event.clientX,
    startWidth: getColumnWidth(index),
  };
  window.addEventListener("mousemove", onColumnResizeMove);
  window.addEventListener("mouseup", stopColumnResize);
}

onBeforeUnmount(() => {
  stopColumnResize();
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

      <table v-else-if="activePane.queryResult.columns.length" class="results-table" :class="{ 'is-resizing': !!resizeState }">
        <thead>
          <tr>
            <th
              v-for="(column, columnIndex) in activePane.queryResult.columns"
              :key="column"
              :style="{
                width: `${getColumnWidth(columnIndex)}px`,
                minWidth: `${getColumnWidth(columnIndex)}px`,
                maxWidth: `${getColumnWidth(columnIndex)}px`,
              }"
            >
              <span class="results-cell-text" :title="column">{{ column }}</span>
              <button
                class="results-col-resize-handle"
                type="button"
                tabindex="-1"
                aria-hidden="true"
                @mousedown="startColumnResize(columnIndex, $event)"
              ></button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in activePane.queryResult.rows" :key="`row-${rowIndex}`">
            <td
              v-for="(value, colIndex) in row"
              :key="`col-${rowIndex}-${colIndex}`"
              :class="{ 'results-cell-number': props.isLikelyNumeric(value) }"
              :style="{
                width: `${getColumnWidth(colIndex)}px`,
                minWidth: `${getColumnWidth(colIndex)}px`,
                maxWidth: `${getColumnWidth(colIndex)}px`,
              }"
            >
              <span class="results-cell-text" :title="value">{{ value }}</span>
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
  width: auto;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: auto;
  font-size: 0.73rem;
  margin: 0;
}

.results-table th,
.results-table td {
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--table-divider) 65%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--table-divider) 70%, transparent);
  color: var(--text-primary);
  text-align: left;
  padding: 0.26rem 0.38rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-table th {
  background: var(--table-header-bg);
  position: sticky;
  top: 0;
  font-weight: 600;
  z-index: 2;
  padding-right: 0.5rem;
  overflow: visible;
}

.results-table th:last-child,
.results-table td:last-child {
  border-right: 0;
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

.results-cell-text {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-col-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 9px;
  height: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: col-resize;
  z-index: 3;
}

.results-col-resize-handle::after {
  content: "";
  position: absolute;
  top: 22%;
  bottom: 22%;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: transparent;
}

.results-table th:hover .results-col-resize-handle::after {
  background: color-mix(in srgb, var(--table-divider) 80%, transparent);
}

.results-table.is-resizing {
  user-select: none;
  cursor: col-resize;
}

.muted {
  color: var(--text-secondary);
  font-size: 0.71rem;
}
</style>
