<script setup lang="ts">
import type { OracleQueryResult } from "../types/clarity";

const props = defineProps<{
  queryResult: OracleQueryResult | null;
  errorMessage: string;
  isLikelyNumeric: (value: string) => boolean;
}>();
</script>

<template>
  <section class="results-pane">
    <div class="results-header">
      <div class="results-title">Results</div>
      <div v-if="props.errorMessage" class="error-inline">{{ props.errorMessage }}</div>
    </div>

    <div class="results-content">
      <p v-if="!props.queryResult" class="muted">Run a query to see results.</p>

      <p v-else-if="props.queryResult.rowsAffected !== null" class="muted">
        Rows affected: {{ props.queryResult.rowsAffected }}
      </p>

      <table v-else-if="props.queryResult.columns.length" class="results-table">
        <thead>
          <tr>
            <th v-for="column in props.queryResult.columns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in props.queryResult.rows" :key="`row-${rowIndex}`">
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
  grid-template-rows: 34px 1fr;
  min-height: 0;
  background: var(--bg-surface);
  overflow: hidden;
}

.results-header {
  display: flex;
  align-items: center;
  padding: 0 0.55rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.results-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
}

.error-inline {
  margin-left: auto;
  font-size: 0.74rem;
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
  font-size: 0.78rem;
  margin: 0;
}

.results-table th,
.results-table td {
  border: 1px solid var(--border);
  text-align: left;
  padding: 0.32rem 0.44rem;
}

.results-table th {
  background: var(--bg-surface-muted);
  position: sticky;
  top: 0;
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
  font-size: 0.76rem;
}
</style>
