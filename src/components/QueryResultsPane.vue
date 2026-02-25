<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
const DEFAULT_ROW_HEIGHT = 28;
const VIRTUAL_OVERSCAN_ROWS = 20;

type ColumnResizeState = {
  index: number;
  startX: number;
  startWidth: number;
};

const columnWidths = ref<number[]>([]);
const resizeState = ref<ColumnResizeState | null>(null);
const activeColumns = computed<string[]>(() => activePane.value?.queryResult?.columns ?? []);
const activeRows = computed<string[][]>(() => activePane.value?.queryResult?.rows ?? []);
const visibleColumnCount = computed<number>(() => Math.max(1, activeColumns.value.length));
const resultsContentEl = ref<HTMLElement | null>(null);
const resultsScrollTop = ref(0);
const resultsViewportHeight = ref(0);
const resultRowHeight = ref(DEFAULT_ROW_HEIGHT);
let resizeRafId: number | null = null;
let pendingResizePointerX: number | null = null;
let resultsResizeObserver: ResizeObserver | null = null;

function resetColumnWidths(): void {
  columnWidths.value = activeColumns.value.map(() => DEFAULT_COLUMN_WIDTH);
}

watch(
  () => [activePane.value?.id ?? "", activeColumns.value.length],
  () => {
    resetColumnWidths();
    resultRowHeight.value = DEFAULT_ROW_HEIGHT;
    const contentEl = resultsContentEl.value;
    if (contentEl) {
      contentEl.scrollTop = 0;
    }
    resultsScrollTop.value = 0;
    void nextTick(() => {
      updateResultsViewportMetrics();
      measureResultRowHeight();
    });
  },
  { immediate: true },
);

watch(
  () => activeRows.value.length,
  () => {
    void nextTick(() => {
      updateResultsViewportMetrics();
      measureResultRowHeight();
    });
  },
);

function getColumnWidth(index: number): number {
  return columnWidths.value[index] ?? DEFAULT_COLUMN_WIDTH;
}

function onColumnResizeMove(event: MouseEvent): void {
  if (!resizeState.value) {
    return;
  }

  pendingResizePointerX = event.clientX;
  if (resizeRafId !== null) {
    return;
  }

  resizeRafId = window.requestAnimationFrame(() => {
    resizeRafId = null;
    const state = resizeState.value;
    const pointerX = pendingResizePointerX;
    if (!state || pointerX === null) {
      return;
    }

    const nextWidth = Math.max(
      MIN_COLUMN_WIDTH,
      state.startWidth + (pointerX - state.startX),
    );
    columnWidths.value[state.index] = nextWidth;
  });
}

function stopColumnResize(): void {
  if (!resizeState.value) {
    return;
  }

  resizeState.value = null;
  pendingResizePointerX = null;
  if (resizeRafId !== null) {
    window.cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
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
  pendingResizePointerX = event.clientX;
  window.addEventListener("mousemove", onColumnResizeMove);
  window.addEventListener("mouseup", stopColumnResize);
}

function updateResultsViewportMetrics(): void {
  const contentEl = resultsContentEl.value;
  if (!contentEl) {
    resultsViewportHeight.value = 0;
    return;
  }

  resultsViewportHeight.value = contentEl.clientHeight;
  resultsScrollTop.value = contentEl.scrollTop;
}

function onResultsScroll(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }

  resultsScrollTop.value = target.scrollTop;
}

function measureResultRowHeight(): void {
  const contentEl = resultsContentEl.value;
  if (!contentEl) {
    return;
  }

  const firstRow = contentEl.querySelector<HTMLTableRowElement>(
    "tr[data-result-row]",
  );
  if (!firstRow) {
    return;
  }

  const measuredHeight = firstRow.getBoundingClientRect().height;
  if (Number.isFinite(measuredHeight) && measuredHeight > 1) {
    resultRowHeight.value = measuredHeight;
  }
}

const visibleStartRow = computed<number>(() => {
  if (!activeRows.value.length || resultRowHeight.value <= 0) {
    return 0;
  }

  const rawStart = Math.floor(resultsScrollTop.value / resultRowHeight.value);
  return Math.max(0, rawStart - VIRTUAL_OVERSCAN_ROWS);
});

const visibleEndRow = computed<number>(() => {
  const rowCount = activeRows.value.length;
  if (!rowCount || resultRowHeight.value <= 0) {
    return 0;
  }

  const visibleRows = Math.ceil(
    Math.max(resultsViewportHeight.value, resultRowHeight.value) /
      resultRowHeight.value,
  );
  const bufferedEnd = visibleStartRow.value + visibleRows + VIRTUAL_OVERSCAN_ROWS * 2;
  return Math.min(rowCount, bufferedEnd);
});

const visibleRows = computed<Array<{ row: string[]; rowIndex: number }>>(() => {
  if (!activeRows.value.length) {
    return [];
  }

  return activeRows.value
    .slice(visibleStartRow.value, visibleEndRow.value)
    .map((row, localIndex) => ({
      row,
      rowIndex: visibleStartRow.value + localIndex,
    }));
});

const topSpacerHeight = computed<number>(() => {
  return visibleStartRow.value * resultRowHeight.value;
});

const bottomSpacerHeight = computed<number>(() => {
  const remainingRows = Math.max(0, activeRows.value.length - visibleEndRow.value);
  return remainingRows * resultRowHeight.value;
});

onMounted(() => {
  window.addEventListener("resize", updateResultsViewportMetrics);
  if (typeof ResizeObserver !== "undefined" && resultsContentEl.value) {
    resultsResizeObserver = new ResizeObserver(() => {
      updateResultsViewportMetrics();
    });
    resultsResizeObserver.observe(resultsContentEl.value);
  }
  void nextTick(() => {
    updateResultsViewportMetrics();
    measureResultRowHeight();
  });
});

onBeforeUnmount(() => {
  stopColumnResize();
  if (resultsResizeObserver) {
    resultsResizeObserver.disconnect();
    resultsResizeObserver = null;
  }
  window.removeEventListener("resize", updateResultsViewportMetrics);
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

    <div ref="resultsContentEl" class="results-content" @scroll="onResultsScroll">
      <p v-if="!activePane || !activePane.queryResult" class="muted">{{ props.emptyStateMessage }}</p>

      <p v-else-if="activePane.queryResult.rowsAffected !== null" class="muted">
        Rows affected: {{ activePane.queryResult.rowsAffected }}
      </p>

      <table v-else-if="activePane.queryResult.columns.length" class="results-table" :class="{ 'is-resizing': !!resizeState }">
        <colgroup>
          <col
            v-for="(column, columnIndex) in activePane.queryResult.columns"
            :key="`col-${column}-${columnIndex}`"
            :style="{ width: `${getColumnWidth(columnIndex)}px` }"
          />
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="(column, columnIndex) in activePane.queryResult.columns"
              :key="column"
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
          <tr v-if="topSpacerHeight > 0" class="results-spacer-row" aria-hidden="true">
            <td :colspan="visibleColumnCount" :style="{ height: `${topSpacerHeight}px` }"></td>
          </tr>
          <tr
            v-for="{ row, rowIndex } in visibleRows"
            :key="`row-${rowIndex}`"
            :data-result-row="rowIndex"
            :class="{ 'results-row-alt': rowIndex % 2 === 1 }"
          >
            <td
              v-for="(value, colIndex) in row"
              :key="`col-${rowIndex}-${colIndex}`"
              :class="{ 'results-cell-number': props.isLikelyNumeric(value) }"
            >
              <span class="results-cell-text" :title="value">{{ value }}</span>
            </td>
          </tr>
          <tr v-if="bottomSpacerHeight > 0" class="results-spacer-row" aria-hidden="true">
            <td :colspan="visibleColumnCount" :style="{ height: `${bottomSpacerHeight}px` }"></td>
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
  table-layout: fixed;
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

.results-table tbody tr.results-row-alt {
  background: var(--table-row-alt);
}

.results-table tbody tr:not(.results-spacer-row):hover {
  background: var(--bg-hover);
}

.results-spacer-row td {
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
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
