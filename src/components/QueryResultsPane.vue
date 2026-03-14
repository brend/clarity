<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DbQueryResult, WorkspaceQueryResultPane } from "../types/clarity";

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

type SortDirection = "asc" | "desc";

type SortState = {
  columnIndex: number;
  direction: SortDirection;
};

interface DbFilteredQueryRequest {
  sessionId: number;
  sql: string;
  rowLimit?: number;
  globalSearch?: string;
  columnFilters?: string[];
}

const columnWidths = ref<number[]>([]);
const resizeState = ref<ColumnResizeState | null>(null);
const paneSearchTerms = ref<Record<string, string>>({});
const paneColumnFilters = ref<Record<string, string[]>>({});
const paneSortStates = ref<Record<string, SortState | null>>({});
const paneFilteredResults = ref<Record<string, DbQueryResult | null>>({});
const paneFilterLoading = ref<Record<string, boolean>>({});
const paneFilterError = ref<Record<string, string>>({});
const activePaneId = computed<string>(() => activePane.value?.id ?? "");
const activeBaseResult = computed<DbQueryResult | null>(
  () => activePane.value?.queryResult ?? null,
);
const baseColumns = computed<string[]>(() => activeBaseResult.value?.columns ?? []);
const baseRows = computed<string[][]>(() => activeBaseResult.value?.rows ?? []);
const activeRemoteFilteredResult = computed<DbQueryResult | null>(() => {
  if (!activePaneId.value) {
    return null;
  }

  return paneFilteredResults.value[activePaneId.value] ?? null;
});
const activeRemoteFilterLoading = computed<boolean>(() => {
  if (!activePaneId.value) {
    return false;
  }

  return paneFilterLoading.value[activePaneId.value] === true;
});
const activeRemoteFilterError = computed<string>(() => {
  if (!activePaneId.value) {
    return "";
  }

  return paneFilterError.value[activePaneId.value] ?? "";
});
const activeColumns = computed<string[]>(() => {
  const hasLocalFilterCriteria =
    currentSearchTerm.value.trim().length > 0 ||
    currentColumnFilters.value.some((value) => value.trim().length > 0);
  if (hasLocalFilterCriteria && activeRemoteFilteredResult.value) {
    return activeRemoteFilteredResult.value.columns;
  }

  return baseColumns.value;
});
const activeRows = computed<string[][]>(() => {
  const hasLocalFilterCriteria =
    currentSearchTerm.value.trim().length > 0 ||
    currentColumnFilters.value.some((value) => value.trim().length > 0);
  if (hasLocalFilterCriteria && activeRemoteFilteredResult.value) {
    return activeRemoteFilteredResult.value.rows;
  }

  return baseRows.value;
});
const visibleColumnCount = computed<number>(() => Math.max(1, activeColumns.value.length));
const resultsContentEl = ref<HTMLElement | null>(null);
const resultsScrollTop = ref(0);
const resultsViewportHeight = ref(0);
const resultRowHeight = ref(DEFAULT_ROW_HEIGHT);
let resizeRafId: number | null = null;
let pendingResizePointerX: number | null = null;
let resultsResizeObserver: ResizeObserver | null = null;
let filterRefreshDebounceHandle: ReturnType<typeof setTimeout> | null = null;
let filterRefreshRequestToken = 0;

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase();
}

function ensurePaneGridState(paneId: string, columnCount: number): void {
  if (!(paneId in paneSearchTerms.value)) {
    paneSearchTerms.value[paneId] = "";
  }

  const existingFilters = paneColumnFilters.value[paneId];
  if (!existingFilters || existingFilters.length !== columnCount) {
    paneColumnFilters.value[paneId] = Array.from(
      { length: columnCount },
      (_, index) => existingFilters?.[index] ?? "",
    );
  }

  const existingSortState = paneSortStates.value[paneId];
  if (existingSortState && existingSortState.columnIndex >= columnCount) {
    paneSortStates.value[paneId] = null;
  }
}

function resetColumnWidths(): void {
  columnWidths.value = activeColumns.value.map(() => DEFAULT_COLUMN_WIDTH);
}

const currentSearchTerm = computed<string>({
  get: () => {
    const paneId = activePaneId.value;
    if (!paneId) {
      return "";
    }

    return paneSearchTerms.value[paneId] ?? "";
  },
  set: (value) => {
    const paneId = activePaneId.value;
    if (!paneId) {
      return;
    }

    paneSearchTerms.value[paneId] = value;
  },
});

const currentColumnFilters = computed<string[]>(() => {
  const paneId = activePaneId.value;
  if (!paneId) {
    return [];
  }

  return paneColumnFilters.value[paneId] ?? [];
});

const currentSortState = computed<SortState | null>(() => {
  const paneId = activePaneId.value;
  if (!paneId) {
    return null;
  }

  return paneSortStates.value[paneId] ?? null;
});

const normalizedGlobalSearchTerm = computed<string>(() =>
  normalizeSearchText(currentSearchTerm.value.trim()),
);
const normalizedColumnFilters = computed<string[]>(() =>
  currentColumnFilters.value.map((value) => normalizeSearchText(value.trim())),
);
const hasActiveFilterCriteria = computed<boolean>(() => {
  if (normalizedGlobalSearchTerm.value.length > 0) {
    return true;
  }

  return normalizedColumnFilters.value.some((value) => value.length > 0);
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unexpected error";
  }
}

async function refreshServerFilteredRows(): Promise<void> {
  const pane = activePane.value;
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  if (!hasActiveFilterCriteria.value) {
    paneFilterLoading.value[paneId] = false;
    paneFilterError.value[paneId] = "";
    paneFilteredResults.value[paneId] = null;
    return;
  }

  if (
    !pane?.queryResult ||
    !pane.sourceSql ||
    !Number.isFinite(pane.sourceSessionId) ||
    pane.sourceSessionId === null
  ) {
    paneFilterLoading.value[paneId] = false;
    paneFilterError.value[paneId] = "";
    paneFilteredResults.value[paneId] = null;
    return;
  }

  const requestToken = ++filterRefreshRequestToken;
  paneFilterLoading.value[paneId] = true;
  paneFilterError.value[paneId] = "";
  paneFilteredResults.value[paneId] = null;

  const request: DbFilteredQueryRequest = {
    sessionId: pane.sourceSessionId,
    sql: pane.sourceSql,
    rowLimit: pane.sourceRowLimit ?? undefined,
    globalSearch: currentSearchTerm.value.trim() || undefined,
    columnFilters: currentColumnFilters.value.map((value) => value.trim()),
  };

  try {
    const result = await invoke<DbQueryResult>("db_run_query_filtered", {
      request,
    });
    if (requestToken !== filterRefreshRequestToken) {
      return;
    }

    paneFilteredResults.value[paneId] = result;
  } catch (error) {
    if (requestToken !== filterRefreshRequestToken) {
      return;
    }

    paneFilterError.value[paneId] = toErrorMessage(error);
    paneFilteredResults.value[paneId] = null;
  } finally {
    if (requestToken === filterRefreshRequestToken) {
      paneFilterLoading.value[paneId] = false;
    }
  }
}

const filteredRows = computed<Array<{ row: string[]; sourceRowIndex: number }>>(() => {
  if (!activeRows.value.length) {
    return [];
  }

  const globalTerm = normalizedGlobalSearchTerm.value;
  const columnFilters = normalizedColumnFilters.value;

  return activeRows.value
    .map((row, sourceRowIndex) => ({ row, sourceRowIndex }))
    .filter(({ row }) => {
      if (globalTerm) {
        const matchesGlobalSearch = row.some((value) =>
          normalizeSearchText(value ?? "").includes(globalTerm),
        );
        if (!matchesGlobalSearch) {
          return false;
        }
      }

      for (let columnIndex = 0; columnIndex < columnFilters.length; columnIndex += 1) {
        const filterTerm = columnFilters[columnIndex];
        if (!filterTerm) {
          continue;
        }

        const cellValue = normalizeSearchText(row[columnIndex] ?? "");
        if (!cellValue.includes(filterTerm)) {
          return false;
        }
      }

      return true;
    });
});

function compareCellValues(leftValue: string | undefined, rightValue: string | undefined): number {
  const left = (leftValue ?? "").trim();
  const right = (rightValue ?? "").trim();
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (
    left.length > 0 &&
    right.length > 0 &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber)
  ) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

const filteredAndSortedRows = computed<Array<{ row: string[]; sourceRowIndex: number }>>(() => {
  const rows = [...filteredRows.value];
  const sortState = currentSortState.value;
  if (!sortState) {
    return rows;
  }

  const directionMultiplier = sortState.direction === "asc" ? 1 : -1;
  return rows.sort((left, right) => {
    const comparison = compareCellValues(
      left.row[sortState.columnIndex],
      right.row[sortState.columnIndex],
    );
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    return left.sourceRowIndex - right.sourceRowIndex;
  });
});

const visibleRowCount = computed<number>(() => filteredAndSortedRows.value.length);
const hasFilteredRows = computed<boolean>(() => visibleRowCount.value > 0);
const hasActiveColumnFilters = computed<boolean>(() =>
  currentColumnFilters.value.some((value) => value.trim().length > 0),
);
const canClearGridTools = computed<boolean>(
  () =>
    currentSearchTerm.value.trim().length > 0 ||
    hasActiveColumnFilters.value ||
    currentSortState.value !== null,
);
const canExportCsv = computed<boolean>(() => activeColumns.value.length > 0);
const rowSummaryLabel = computed<string>(() => {
  if (hasActiveFilterCriteria.value && activeRemoteFilterLoading.value) {
    return "Filtering...";
  }

  const totalRows = activeRows.value.length;
  const shownRows = visibleRowCount.value;
  const rowLabel = shownRows === 1 ? "row" : "rows";

  if (hasActiveFilterCriteria.value) {
    return `${shownRows} filtered ${rowLabel}`;
  }

  if (shownRows === totalRows) {
    return `${shownRows} ${rowLabel}`;
  }

  return `${shownRows} of ${totalRows} rows`;
});

function setCurrentSortState(nextSortState: SortState | null): void {
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  paneSortStates.value[paneId] = nextSortState;
}

function toggleColumnSort(columnIndex: number): void {
  const sortState = currentSortState.value;
  if (!sortState || sortState.columnIndex !== columnIndex) {
    setCurrentSortState({
      columnIndex,
      direction: "asc",
    });
    return;
  }

  if (sortState.direction === "asc") {
    setCurrentSortState({
      columnIndex,
      direction: "desc",
    });
    return;
  }

  setCurrentSortState(null);
}

function getColumnSortIndicator(columnIndex: number): string {
  const sortState = currentSortState.value;
  if (!sortState || sortState.columnIndex !== columnIndex) {
    return "";
  }

  return sortState.direction === "asc" ? "^" : "v";
}

function getColumnSortLabel(column: string, columnIndex: number): string {
  const sortState = currentSortState.value;
  if (!sortState || sortState.columnIndex !== columnIndex) {
    return `Sort ${column} ascending`;
  }

  if (sortState.direction === "asc") {
    return `Sort ${column} descending`;
  }

  return `Clear sort for ${column}`;
}

function onColumnFilterInput(columnIndex: number, event: Event): void {
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  const target = event.target as HTMLInputElement | null;
  if (!target) {
    return;
  }

  ensurePaneGridState(paneId, baseColumns.value.length);
  const nextFilters = [...(paneColumnFilters.value[paneId] ?? [])];
  nextFilters[columnIndex] = target.value;
  paneColumnFilters.value[paneId] = nextFilters;
}

function clearGridTools(): void {
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  paneSearchTerms.value[paneId] = "";
  paneSortStates.value[paneId] = null;
  paneColumnFilters.value[paneId] = baseColumns.value.map(() => "");
}

function toCsvCell(value: string): string {
  if (/["\r\n,]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}

function sanitizeFileNameSegment(value: string): string {
  return (
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "results"
  );
}

function exportCsv(): void {
  if (!canExportCsv.value || !activePane.value) {
    return;
  }

  const columns = activeColumns.value;
  const csvRows = filteredAndSortedRows.value.map(({ row }) =>
    columns.map((_, columnIndex) => row[columnIndex] ?? ""),
  );
  const csvLines = [
    columns.map((value) => toCsvCell(value)).join(","),
    ...csvRows.map((row) => row.map((value) => toCsvCell(value)).join(",")),
  ];
  const csvText = `${csvLines.join("\r\n")}\r\n`;
  const blob = new Blob([csvText], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
  const fileName = `${sanitizeFileNameSegment(activePane.value.title)}-${timestamp}.csv`;
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

watch(
  () => [activePaneId.value, baseColumns.value.length],
  () => {
    if (activePaneId.value) {
      ensurePaneGridState(activePaneId.value, baseColumns.value.length);
    }

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
  () => [activeRows.value.length, filteredAndSortedRows.value.length],
  () => {
    void nextTick(() => {
      updateResultsViewportMetrics();
      measureResultRowHeight();
    });
  },
);

const gridViewStateToken = computed<string>(() => {
  const sortState = currentSortState.value;
  return [
    activePaneId.value,
    currentSearchTerm.value,
    normalizedColumnFilters.value.join("\u001f"),
    sortState ? `${sortState.columnIndex}:${sortState.direction}` : "",
  ].join("\u001e");
});

watch(gridViewStateToken, () => {
  const contentEl = resultsContentEl.value;
  if (contentEl) {
    contentEl.scrollTop = 0;
  }

  resultsScrollTop.value = 0;
  void nextTick(() => {
    updateResultsViewportMetrics();
    measureResultRowHeight();
  });
});

const filterRefreshToken = computed<string>(() => {
  const pane = activePane.value;
  return [
    activePaneId.value,
    pane?.sourceSql ?? "",
    pane?.sourceSessionId ?? "",
    pane?.sourceRowLimit ?? "",
    normalizedGlobalSearchTerm.value,
    normalizedColumnFilters.value.join("\u001f"),
  ].join("\u001e");
});

watch(
  filterRefreshToken,
  () => {
    if (filterRefreshDebounceHandle) {
      window.clearTimeout(filterRefreshDebounceHandle);
      filterRefreshDebounceHandle = null;
    }

    if (!hasActiveFilterCriteria.value) {
      void refreshServerFilteredRows();
      return;
    }

    filterRefreshDebounceHandle = window.setTimeout(() => {
      filterRefreshDebounceHandle = null;
      void refreshServerFilteredRows();
    }, 220);
  },
  { immediate: true },
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
  if (!filteredAndSortedRows.value.length || resultRowHeight.value <= 0) {
    return 0;
  }

  const rawStart = Math.floor(resultsScrollTop.value / resultRowHeight.value);
  return Math.max(0, rawStart - VIRTUAL_OVERSCAN_ROWS);
});

const visibleEndRow = computed<number>(() => {
  const rowCount = filteredAndSortedRows.value.length;
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

const visibleRows = computed<
  Array<{ row: string[]; rowIndex: number; sourceRowIndex: number }>
>(() => {
  if (!filteredAndSortedRows.value.length) {
    return [];
  }

  return filteredAndSortedRows.value
    .slice(visibleStartRow.value, visibleEndRow.value)
    .map(({ row, sourceRowIndex }, localIndex) => ({
      row,
      rowIndex: visibleStartRow.value + localIndex,
      sourceRowIndex,
    }));
});

const topSpacerHeight = computed<number>(() => {
  return visibleStartRow.value * resultRowHeight.value;
});

const bottomSpacerHeight = computed<number>(() => {
  const remainingRows = Math.max(
    0,
    filteredAndSortedRows.value.length - visibleEndRow.value,
  );
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
  if (filterRefreshDebounceHandle) {
    window.clearTimeout(filterRefreshDebounceHandle);
    filterRefreshDebounceHandle = null;
  }
  filterRefreshRequestToken += 1;
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
      <div
        v-if="props.resultPanes.length"
        class="results-tabs"
        role="tablist"
        aria-label="Result tabs"
      >
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
      <div v-if="!activePane || !activePane.queryResult" class="results-empty-state">
        <div class="results-empty-label">No results yet</div>
        <p class="muted">{{ props.emptyStateMessage }}</p>
      </div>

      <template v-else>
        <div v-if="activePane.queryResult.columns.length" class="results-toolbar">
          <input
            v-model="currentSearchTerm"
            class="results-search-input"
            type="search"
            placeholder="Search visible result rows"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            data-gramm="false"
          />
          <span class="muted results-row-summary">{{ rowSummaryLabel }}</span>
          <button
            class="results-toolbar-btn"
            type="button"
            :disabled="!canClearGridTools"
            @click="clearGridTools"
          >
            Clear
          </button>
          <button
            class="results-toolbar-btn"
            type="button"
            :disabled="!canExportCsv"
            @click="exportCsv"
          >
            Export CSV
          </button>
        </div>

        <p v-if="activePane.errorMessage" class="results-error">
          {{ activePane.errorMessage }}
        </p>

        <p v-if="activePane.queryResult.message" class="muted results-message">
          {{ activePane.queryResult.message }}
        </p>

        <p v-if="activePane.queryResult.rowsAffected !== null" class="muted">
          Rows affected: {{ activePane.queryResult.rowsAffected }}
        </p>
        <p
          v-else-if="baseRows.length > 0 && !hasFilteredRows"
          class="muted results-empty-filtered"
        >
          No rows match current search or column filters.
        </p>
        <p
          v-if="hasActiveFilterCriteria && activeRemoteFilterError"
          class="muted results-filter-fallback"
          :title="activeRemoteFilterError"
        >
          Showing matches from loaded rows only.
        </p>

        <div v-if="activePane.queryResult.columns.length" class="results-grid-shell">
          <table
            class="results-table"
            :class="{ 'is-resizing': !!resizeState }"
          >
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
                  :key="`${column}-${columnIndex}`"
                  :class="{
                    'results-sort-active':
                      currentSortState?.columnIndex === columnIndex,
                  }"
                >
                  <button
                    class="results-col-sort-button"
                    type="button"
                    :aria-label="getColumnSortLabel(column, columnIndex)"
                    @click="toggleColumnSort(columnIndex)"
                  >
                    <span class="results-cell-text" :title="column">{{ column }}</span>
                    <span class="results-sort-indicator" aria-hidden="true">
                      {{ getColumnSortIndicator(columnIndex) }}
                    </span>
                  </button>
                  <button
                    class="results-col-resize-handle"
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    @mousedown="startColumnResize(columnIndex, $event)"
                  ></button>
                </th>
              </tr>
              <tr class="results-filter-row">
                <th
                  v-for="(column, columnIndex) in activePane.queryResult.columns"
                  :key="`filter-${column}-${columnIndex}`"
                >
                  <input
                    class="results-filter-input"
                    :value="currentColumnFilters[columnIndex] ?? ''"
                    :placeholder="`Filter ${column}`"
                    type="search"
                    spellcheck="false"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    data-gramm="false"
                    @input="onColumnFilterInput(columnIndex, $event)"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="topSpacerHeight > 0" class="results-spacer-row" aria-hidden="true">
                <td :colspan="visibleColumnCount" :style="{ height: `${topSpacerHeight}px` }"></td>
              </tr>
              <tr
                v-for="{ row, rowIndex, sourceRowIndex } in visibleRows"
                :key="`row-${sourceRowIndex}-${rowIndex}`"
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
      </template>
    </div>
  </section>
</template>

<style scoped>
.results-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 1.8rem;
  background: color-mix(in srgb, var(--bg-surface) 92%, white);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.results-header {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  min-height: 3.8rem;
  padding: 1rem 1.15rem;
  border-bottom: 1px solid var(--panel-separator);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-soft) 36%, white) 0%,
      color-mix(in srgb, var(--table-header-bg) 88%, white) 100%
    );
}

.results-title {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text-primary);
}

.results-tabs {
  display: flex;
  align-items: stretch;
  min-width: 0;
  height: 100%;
  gap: 0.35rem;
}

.results-tab {
  min-height: 2.35rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0 0.9rem;
  cursor: pointer;
}

.results-tab:hover {
  background: var(--bg-hover);
}

.results-tab.active {
  background: var(--tab-active-bg);
  color: var(--text-primary);
  border-color: var(--tab-active-border);
  box-shadow: 0 10px 24px rgba(89, 70, 80, 0.08);
}

.error-inline {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--danger);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-content {
  min-height: 0;
  overflow: auto;
  padding: 1rem;
  margin: 0;
  font-family: Consolas, "Courier New", monospace;
}

.results-empty-state {
  display: grid;
  gap: 0.35rem;
  align-content: start;
  padding: 1rem 1.1rem;
  border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-surface-muted) 76%, white);
}

.results-empty-label {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.results-toolbar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-surface-muted) 86%, white);
  margin-bottom: 0.85rem;
}

.results-search-input,
.results-filter-input {
  border: 1px solid var(--control-border);
  border-radius: 0.9rem;
  background: var(--control-bg);
  color: var(--text-primary);
  font-family: inherit;
}

.results-search-input {
  flex: 1 1 14rem;
  min-width: 11rem;
  padding: 0.62rem 0.75rem;
  font-size: 0.72rem;
}

.results-filter-input {
  width: 100%;
  padding: 0.48rem 0.58rem;
  font-size: 0.68rem;
}

.results-toolbar-btn {
  border: 1px solid var(--control-border);
  border-radius: 999px;
  background: var(--control-bg);
  color: var(--text-primary);
  font-size: 0.69rem;
  font-weight: 600;
  padding: 0.56rem 0.82rem;
  cursor: pointer;
}

.results-toolbar-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.results-toolbar-btn:not(:disabled):hover {
  background: var(--control-hover);
}

.results-row-summary {
  white-space: nowrap;
  margin-left: auto;
}

.results-table {
  width: auto;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 0.73rem;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  overflow: hidden;
  background: var(--bg-surface);
}

.results-grid-shell {
  border-radius: 1.2rem;
  overflow: hidden;
}

.results-table th,
.results-table td {
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--table-divider) 65%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--table-divider) 70%, transparent);
  color: var(--text-primary);
  text-align: left;
  padding: 0.62rem 0.8rem;
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
  padding-right: 0.8rem;
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

.results-sort-active {
  background: color-mix(in srgb, var(--table-header-bg) 80%, var(--accent) 20%);
}

.results-col-sort-button {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: calc(100% - 10px);
  min-width: 0;
  text-align: left;
  padding: 0;
  cursor: pointer;
}

.results-sort-indicator {
  width: 0.68rem;
  min-width: 0.68rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.63rem;
}

.results-filter-row th {
  position: static;
  top: auto;
  z-index: 1;
  background: var(--bg-surface-muted);
  padding: 0.45rem 0.58rem;
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
  font-size: 0.73rem;
}

.results-message {
  margin: 0 0 0.45rem;
}

.results-empty-filtered {
  margin-bottom: 0.45rem;
}

.results-filter-fallback {
  margin-bottom: 0.45rem;
}

.results-error {
  color: var(--danger);
  font-size: 0.73rem;
  margin: 0 0 0.45rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 980px) {
  .results-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .results-content {
    padding: 0.85rem;
  }

  .results-toolbar {
    flex-wrap: wrap;
  }
}
</style>
