<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import AppIcon from "./AppIcon.vue";
import type { CreateObjectTypeOption } from "../constants/createObjectTemplates";
import type {
  BusyState,
  ConnectionProfile,
  ObjectTreeNode,
  DbObjectEntry,
  DbSessionSummary,
  OracleConnectionProfile,
  OracleDbConnectRequest,
} from "../types/clarity";

const selectedProfileId = defineModel<string>("selectedProfileId", { required: true });
const profileName = defineModel<string>("profileName", { required: true });
const saveProfilePassword = defineModel<boolean>("saveProfilePassword", { required: true });

const props = defineProps<{
  connection: OracleDbConnectRequest;
  connectionError: string;
  connectionProfiles: ConnectionProfile[];
  selectedProfile: OracleConnectionProfile | null;
  busy: BusyState;
  isConnected: boolean;
  session: DbSessionSummary | null;
  connectedSchema: string;
  selectedProviderLabel: string;
  highlightedSection: "connections" | "explorer";
  objectTree: ObjectTreeNode[];
  selectedObject: DbObjectEntry | null;
  isObjectTypeExpanded: (objectType: string) => boolean;
  onSyncSelectedProfileUi: () => void;
  onApplySelectedProfile: () => void;
  onDeleteSelectedProfile: () => void;
  onSaveConnectionProfile: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshObjects: () => void;
  onToggleObjectType: (objectType: string) => void;
  onOpenObjectFromExplorer: (object: DbObjectEntry) => void;
  createObjectTypes: CreateObjectTypeOption[];
  onRequestCreateObject: (objectType: string) => void;
}>();

const showAdvancedConnectionOptions = ref(false);
const isConnectionPaneCollapsed = ref(false);
const explorerContextMenu = ref<{
  x: number;
  y: number;
  preferredObjectType: string | null;
  refreshObjectType: string | null;
} | null>(null);
const explorerContextMenuEl = ref<HTMLElement | null>(null);

const canOpenExplorerContextMenu = computed(() => props.isConnected);
const createContextMenuOptions = computed<CreateObjectTypeOption[]>(() => {
  const preferredType = explorerContextMenu.value?.preferredObjectType;
  if (!preferredType) {
    return props.createObjectTypes;
  }

  const preferredOption = props.createObjectTypes.find(
    (option) => normalizeObjectType(option.value) === preferredType,
  );
  if (!preferredOption) {
    return props.createObjectTypes;
  }

  return [
    preferredOption,
    ...props.createObjectTypes.filter(
      (option) => option.value !== preferredOption.value,
    ),
  ];
});
const refreshContextMenuLabel = computed(() => {
  if (props.busy.loadingObjects) {
    return "Refreshing...";
  }

  const refreshObjectType = explorerContextMenu.value?.refreshObjectType;
  return refreshObjectType ? `Refresh ${refreshObjectType}` : "Refresh Explorer";
});

watch(
  () => props.isConnected,
  (isConnected, wasConnected) => {
    if (!isConnected) {
      closeExplorerContextMenu();
      isConnectionPaneCollapsed.value = false;
      return;
    }

    if (!wasConnected) {
      isConnectionPaneCollapsed.value = true;
    }
  },
);

function toggleConnectionPaneCollapsed(): void {
  isConnectionPaneCollapsed.value = !isConnectionPaneCollapsed.value;
}

function onSelectedProfileChange(): void {
  props.onSyncSelectedProfileUi();
  if (!props.selectedProfile) {
    return;
  }
  void props.onApplySelectedProfile();
}

function normalizeObjectType(value: string): string {
  return value.trim().toUpperCase();
}

function closeExplorerContextMenu(): void {
  explorerContextMenu.value = null;
}

function clampExplorerContextMenuPosition(): void {
  if (!explorerContextMenu.value || !explorerContextMenuEl.value) {
    return;
  }

  const menuRect = explorerContextMenuEl.value.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 8;
  const clampedX = Math.min(
    Math.max(explorerContextMenu.value.x, margin),
    Math.max(margin, viewportWidth - menuRect.width - margin),
  );
  const clampedY = Math.min(
    Math.max(explorerContextMenu.value.y, margin),
    Math.max(margin, viewportHeight - menuRect.height - margin),
  );
  explorerContextMenu.value = {
    ...explorerContextMenu.value,
    x: clampedX,
    y: clampedY,
  };
}

async function openExplorerContextMenu(
  event: MouseEvent,
  preferredObjectType: string | null,
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  if (!canOpenExplorerContextMenu.value) {
    closeExplorerContextMenu();
    return;
  }

  const normalizedObjectType = preferredObjectType
    ? normalizeObjectType(preferredObjectType)
    : null;

  explorerContextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    preferredObjectType: normalizedObjectType,
    refreshObjectType: normalizedObjectType,
  };
  await nextTick();
  clampExplorerContextMenuPosition();
}

function requestCreateObject(objectType: string): void {
  closeExplorerContextMenu();
  props.onRequestCreateObject(objectType);
}

function refreshExplorerContext(): void {
  if (props.busy.loadingObjects) {
    return;
  }

  closeExplorerContextMenu();
  void props.onRefreshObjects();
}

function onGlobalPointerDown(event: MouseEvent): void {
  if (!explorerContextMenu.value) {
    return;
  }

  const target = event.target as Node | null;
  if (target && explorerContextMenuEl.value?.contains(target)) {
    return;
  }

  closeExplorerContextMenu();
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeExplorerContextMenu();
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", onGlobalPointerDown);
  window.addEventListener("keydown", onGlobalKeyDown);
  window.addEventListener("resize", closeExplorerContextMenu);
  window.addEventListener("blur", closeExplorerContextMenu);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onGlobalPointerDown);
  window.removeEventListener("keydown", onGlobalKeyDown);
  window.removeEventListener("resize", closeExplorerContextMenu);
  window.removeEventListener("blur", closeExplorerContextMenu);
});
</script>

<template>
  <div class="explorer-sidebar">
    <section
      class="sidebar-card connect-box"
      :class="{ spotlight: props.highlightedSection === 'connections' }"
    >
      <header class="card-header">
        <div class="card-heading">
          <p class="card-kicker">Connection Console</p>
          <h2 class="card-title">Database Session</h2>
          <p class="card-description">
            {{ props.session ? props.session.displayName : "No active connection" }}
          </p>
        </div>
        <div class="connect-header-actions">
          <span class="connect-state-pill" :class="{ connected: props.isConnected }">
            {{ props.isConnected ? "Connected" : "Offline" }}
          </span>
          <button
            class="collapse-toggle"
            type="button"
            :aria-expanded="!isConnectionPaneCollapsed"
            :title="isConnectionPaneCollapsed ? 'Expand connection pane' : 'Collapse connection pane'"
            @click="toggleConnectionPaneCollapsed"
          >
            <AppIcon
              name="chevron-right"
              class="collapse-toggle-icon"
              :class="{ expanded: !isConnectionPaneCollapsed }"
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      <div class="connection-summary">
        <div class="summary-tile">
          <span class="summary-label">Provider</span>
          <span class="summary-value">{{ props.selectedProviderLabel }}</span>
        </div>
        <div class="summary-tile">
          <span class="summary-label">Schema</span>
          <span class="summary-value">{{
            props.connectedSchema || props.connection.connection.schema || "Pending"
          }}</span>
        </div>
        <div class="summary-tile">
          <span class="summary-label">Session</span>
          <span class="summary-value">{{ props.session ? "Live" : "Draft" }}</span>
        </div>
      </div>

      <div
        v-if="!isConnectionPaneCollapsed"
        class="connect-pane-body"
      >
        <div class="connect-actions">
        <button
          class="btn primary btn-connect"
          :disabled="props.busy.connecting"
          @click="props.isConnected ? props.onDisconnect() : props.onConnect()"
        >
          <AppIcon
            :name="props.isConnected ? 'plug-off' : 'plug'"
            class="btn-icon"
            aria-hidden="true"
          />
          {{
            props.busy.connecting
              ? "Connecting..."
              : props.isConnected
                ? "Disconnect"
                : "Connect"
          }}
        </button>
        <button
          class="btn"
          :disabled="!props.isConnected || props.busy.loadingObjects"
          @click="props.onRefreshObjects"
        >
          <AppIcon name="refresh" class="btn-icon" aria-hidden="true" />
          {{ props.busy.loadingObjects ? "Refreshing..." : "Refresh" }}
        </button>
        </div>

        <div class="connection-core-fields">
          <div class="field-grid">
          <label>
            Host
            <input
              v-model.trim="props.connection.connection.host"
              placeholder="db.example.com"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label>
            Service
            <input
              v-model.trim="props.connection.connection.serviceName"
              placeholder="XEPDB1"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label>
            Username
            <input
              v-model.trim="props.connection.connection.username"
              placeholder="hr"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label>
            Schema
            <input
              v-model.trim="props.connection.connection.schema"
              placeholder="HR"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label class="field-span">
            Password
            <input
              v-model="props.connection.connection.password"
              type="password"
              placeholder="********"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>
          </div>
        </div>

        <div class="profile-inline">
          <label class="profile-select">
            Profile
            <select
              v-model="selectedProfileId"
              :disabled="
                props.busy.loadingProfiles || props.busy.loadingProfileSecret
              "
              @change="onSelectedProfileChange"
            >
              <option value="">(Select profile)</option>
              <option
                v-for="profile in props.connectionProfiles"
                :key="profile.id"
                :value="profile.id"
              >
                {{ profile.name }}
              </option>
            </select>
          </label>

          <details class="profile-details">
            <summary class="btn profile-manage-toggle">
              <AppIcon
                name="chevron-right"
                class="connect-toggle-icon"
                aria-hidden="true"
              />
              Manage profiles
            </summary>

            <div class="profile-controls">
              <label>
                Profile Name
                <input
                  v-model.trim="profileName"
                  placeholder="Local Oracle Dev"
                  spellcheck="false"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  data-gramm="false"
                />
              </label>
              <div class="profile-save-row">
                <label class="profile-password-toggle">
                  <input v-model="saveProfilePassword" type="checkbox" />
                  Save password in OS keychain
                </label>
                <div class="profile-actions">
                  <button
                    class="btn"
                    :disabled="props.busy.savingProfile"
                    @click="props.onSaveConnectionProfile"
                  >
                    {{ props.busy.savingProfile ? "Saving..." : "Save" }}
                  </button>
                  <button
                    class="btn"
                    :disabled="!props.selectedProfile || props.busy.deletingProfile"
                    @click="props.onDeleteSelectedProfile"
                  >
                    {{ props.busy.deletingProfile ? "Deleting..." : "Delete" }}
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>

        <button
          class="btn connect-advanced-toggle"
          type="button"
          :aria-expanded="showAdvancedConnectionOptions"
          @click="showAdvancedConnectionOptions = !showAdvancedConnectionOptions"
        >
          <AppIcon
            name="chevron-right"
            class="connect-toggle-icon"
            :class="{ expanded: showAdvancedConnectionOptions }"
            aria-hidden="true"
          />
          {{
            showAdvancedConnectionOptions
              ? "Hide advanced options"
              : "Show advanced options"
          }}
        </button>

        <div v-show="showAdvancedConnectionOptions" class="field-grid advanced-grid">
          <label>
            Port
            <input
              v-model.number="props.connection.connection.port"
              type="number"
              min="1"
              max="65535"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label v-if="props.connection.provider === 'oracle'">
            Auth Mode
            <select v-model="props.connection.connection.oracleAuthMode">
              <option value="normal">Normal</option>
              <option value="sysdba">SYSDBA</option>
            </select>
          </label>
        </div>

        <p v-if="props.connectionError" class="connect-error">
          {{ props.connectionError }}
        </p>
      </div>
    </section>

    <section
      class="sidebar-card tree-area"
      :class="{ spotlight: props.highlightedSection === 'explorer' }"
      @contextmenu="(event) => void openExplorerContextMenu(event, null)"
    >
      <header class="card-header">
        <div class="card-heading">
          <p class="card-kicker">Database Explorer</p>
          <h2 class="card-title">
            {{
              props.connectedSchema ||
              props.connection.connection.schema ||
              "Object tree"
            }}
          </h2>
          <p class="card-description">
            {{
              props.selectedObject
                ? `${props.selectedObject.objectName} selected`
                : "Browse objects and open their workspace tabs."
            }}
          </p>
        </div>
        <button
          class="btn explorer-refresh-btn"
          :disabled="!props.isConnected || props.busy.loadingObjects"
          @click.stop="props.onRefreshObjects"
        >
          <AppIcon name="refresh" class="btn-icon" aria-hidden="true" />
          Refresh
        </button>
      </header>

      <div class="explorer-meta-row">
        <span class="meta-pill">
          {{ props.objectTree.length }} type{{ props.objectTree.length === 1 ? "" : "s" }}
        </span>
        <span class="meta-pill">
          {{
            props.selectedObject
              ? props.selectedObject.objectType
              : props.isConnected
                ? "Connected"
                : "Offline"
          }}
        </span>
      </div>

      <p v-if="!props.objectTree.length" class="muted empty-copy">
        Connect and refresh to load objects for this schema.
      </p>

      <div v-else class="tree-scroll">
        <ul
          class="tree-root"
          role="tree"
          aria-label="Database object explorer"
        >
          <li
            v-for="typeNode in props.objectTree"
            :key="typeNode.objectType"
            class="tree-branch"
            role="treeitem"
            :aria-expanded="props.isObjectTypeExpanded(typeNode.objectType)"
          >
            <button
              class="tree-row tree-type"
              :class="{ expanded: props.isObjectTypeExpanded(typeNode.objectType) }"
              @click="props.onToggleObjectType(typeNode.objectType)"
              @contextmenu="
                (event) => void openExplorerContextMenu(event, typeNode.objectType)
              "
            >
              <AppIcon
                name="chevron-right"
                class="tree-caret-icon"
                aria-hidden="true"
              />
              <span class="tree-type-label">
                {{ typeNode.objectType }}
                <span class="tree-count">{{ typeNode.entries.length }}</span>
              </span>
            </button>

            <ul
              v-show="props.isObjectTypeExpanded(typeNode.objectType)"
              class="tree-children"
              role="group"
            >
              <li
                v-for="entry in typeNode.entries"
                :key="`${entry.schema}-${entry.objectType}-${entry.objectName}`"
                class="tree-leaf"
                role="treeitem"
              >
                <button
                  class="tree-row tree-node"
                  :class="{
                    selected:
                      props.selectedObject?.schema === entry.schema &&
                      props.selectedObject?.objectName === entry.objectName &&
                      props.selectedObject?.objectType === entry.objectType,
                  }"
                  @click="props.onOpenObjectFromExplorer(entry)"
                  @contextmenu="
                    (event) => void openExplorerContextMenu(event, entry.objectType)
                  "
                >
                  <AppIcon
                    name="object"
                    class="tree-leaf-icon"
                    aria-hidden="true"
                  />
                  <span>{{ entry.objectName }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </section>

    <div
      v-if="explorerContextMenu"
      ref="explorerContextMenuEl"
      class="explorer-context-menu"
      :style="{
        left: `${explorerContextMenu.x}px`,
        top: `${explorerContextMenu.y}px`,
      }"
      role="menu"
      aria-label="Object explorer actions"
    >
      <button
        v-for="option in createContextMenuOptions"
        :key="option.value"
        class="explorer-context-menu-item"
        type="button"
        role="menuitem"
        @click.stop="requestCreateObject(option.value)"
      >
        Create {{ option.label }}...
      </button>
      <div v-if="createContextMenuOptions.length" class="explorer-context-menu-separator"></div>
      <button
        class="explorer-context-menu-item"
        type="button"
        role="menuitem"
        :disabled="props.busy.loadingObjects"
        @click.stop="refreshExplorerContext"
      >
        {{ refreshContextMenuLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.explorer-sidebar {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.6rem;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 0.7rem 0.7rem 0.7rem 0;
  overflow: hidden;
}

.sidebar-card {
  min-width: 0;
  border-radius: 18px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 58%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 94%, transparent) 100%
    );
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.sidebar-card.spotlight {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent), var(--card-shadow);
}

.connect-box {
  display: grid;
  gap: 0.5rem;
  padding: 0.72rem;
}

.tree-area {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 0.6rem;
  min-height: 0;
  padding: 0.85rem;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.connect-box > .card-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem 0.7rem;
}

.connect-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  flex: 0 0 auto;
}

.card-heading {
  min-width: 0;
  display: grid;
  gap: 0.2rem;
}

.card-kicker {
  margin: 0;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.connect-box .card-title {
  font-size: 0.92rem;
}

.card-description {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-secondary);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.connect-box .card-description {
  font-size: 0.66rem;
  line-height: 1.3;
}

.connect-state-pill {
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface-muted) 88%, transparent);
  color: var(--text-secondary);
  padding: 0.28rem 0.62rem;
  font-size: 0.58rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.connect-state-pill.connected {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, white);
}

.collapse-toggle {
  border: 0;
  background: color-mix(in srgb, var(--bg-surface-muted) 88%, transparent);
  color: var(--text-secondary);
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: 0 0 auto;
}

.collapse-toggle:hover {
  background: var(--control-hover);
  color: var(--text-primary);
}

.collapse-toggle-icon {
  width: 0.78rem;
  height: 0.78rem;
  transition: transform 0.12s ease;
}

.collapse-toggle-icon.expanded {
  transform: rotate(90deg);
}

.connection-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.connect-pane-body {
  display: grid;
  gap: 0.65rem;
}

.summary-tile:last-child {
  grid-column: auto;
}

.summary-tile {
  display: grid;
  gap: 0.14rem;
  padding: 0.5rem 0.58rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-surface-muted) 84%, transparent);
}

.summary-label {
  font-size: 0.54rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.summary-value {
  min-width: 0;
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
}

@media (max-width: 1240px) {
  .connection-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.connect-toggle-icon {
  width: 0.72rem;
  height: 0.72rem;
  color: var(--text-subtle);
  transition: transform 0.12s ease;
}

.connect-toggle-icon.expanded {
  transform: rotate(90deg);
}

.connection-core-fields {
  padding: 0.65rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-surface-muted) 82%, transparent);
}

.profile-inline {
  display: grid;
  gap: 0.45rem;
}

.profile-select {
  min-width: 0;
}

.profile-details {
  min-width: 0;
}

.profile-details > summary {
  list-style: none;
}

.profile-details > summary::-webkit-details-marker {
  display: none;
}

.profile-details[open] .connect-toggle-icon {
  transform: rotate(90deg);
}

.profile-controls {
  display: grid;
  gap: 0.45rem;
  padding: 0.56rem;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-surface-muted) 82%, transparent);
}

.profile-actions {
  display: flex;
  gap: 0.34rem;
  justify-content: flex-end;
}

.profile-manage-toggle {
  width: fit-content;
  white-space: nowrap;
  justify-content: flex-start;
}

.profile-details > .profile-controls {
  margin-top: 0.34rem;
}

.profile-save-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.34rem;
}

.profile-password-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: var(--text-secondary);
  min-width: 0;
}

.profile-password-toggle input {
  margin: 0;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.field-span {
  grid-column: 1 / -1;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.66rem;
  color: var(--text-secondary);
}

input,
select,
textarea,
button {
  font: inherit;
}

input,
select,
textarea {
  border: 0;
  border-radius: 10px;
  background: color-mix(in srgb, var(--control-bg) 92%, transparent);
  color: var(--text-primary);
  padding: 0.48rem 0.58rem;
}

button {
  color: var(--text-primary);
}

input:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 1px solid var(--focus-ring);
  outline-offset: 1px;
}

.connect-actions {
  display: flex;
  gap: 0.45rem;
}

.btn-connect {
  flex: 1;
  justify-content: center;
}

.connect-advanced-toggle {
  justify-content: flex-start;
}

.advanced-grid {
  padding: 0.25rem 0 0.1rem;
}

.connect-error {
  margin: 0;
  color: var(--danger);
  font-size: 0.72rem;
  line-height: 1.28;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.btn {
  border: 0;
  border-radius: 12px;
  background: color-mix(in srgb, var(--control-bg) 92%, transparent);
  padding: 0.5rem 0.68rem;
  font-size: 0.69rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.btn:hover:not(:disabled) {
  background: var(--control-hover);
  border-color: var(--control-border);
}

.btn:focus-visible,
.tree-row:focus-visible,
.explorer-context-menu-item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.btn.primary:hover:not(:disabled) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

.btn-icon {
  width: 0.85rem;
  height: 0.85rem;
  flex: 0 0 auto;
}

.explorer-refresh-btn {
  white-space: nowrap;
}

.explorer-meta-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  min-height: 1.65rem;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface-muted) 84%, transparent);
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 600;
}

.tree-scroll {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding-top: 0.35rem;
  padding-right: 0.2rem;
}

.tree-root,
.tree-children {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tree-children {
  padding-left: 1rem;
}

.tree-row {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.36rem;
  padding: 0.42rem 0.5rem;
  border-radius: 10px;
  font-size: 0.72rem;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
}

.tree-type {
  font-weight: 600;
  color: var(--text-primary);
}

.tree-type:hover {
  background: color-mix(in srgb, var(--accent-soft) 60%, var(--control-hover));
}

.tree-caret-icon {
  width: 0.62rem;
  height: 0.62rem;
  color: var(--text-subtle);
  transform-origin: center;
  transition: transform 0.12s ease;
  flex: 0 0 auto;
}

.tree-type.expanded .tree-caret-icon {
  transform: rotate(90deg);
}

.tree-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface-muted) 88%, transparent);
  color: var(--text-secondary);
  font-weight: 500;
  margin-left: 0.35rem;
}

.tree-type-label {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-node {
  color: var(--text-primary);
}

.tree-node:hover {
  background: color-mix(in srgb, var(--accent-soft) 44%, var(--control-hover));
}

.tree-node.selected {
  background: color-mix(in srgb, var(--accent-soft) 82%, var(--bg-surface));
  color: var(--tree-selected-text);
}

.tree-leaf-icon {
  width: 0.62rem;
  height: 0.62rem;
  color: var(--text-subtle);
  flex: 0 0 auto;
}

.tree-node span:last-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.muted {
  color: var(--text-secondary);
  font-size: 0.74rem;
}

.empty-copy {
  margin: 0;
  padding: 0.25rem 0;
}

.explorer-context-menu {
  position: fixed;
  z-index: 90;
  min-width: 13rem;
  padding: 0.35rem;
  border-radius: 14px;
  background: var(--bg-surface);
  box-shadow: var(--dialog-shadow);
  display: grid;
  gap: 0.12rem;
}

.explorer-context-menu-item {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.74rem;
  text-align: left;
  padding: 0.5rem 0.7rem;
  cursor: pointer;
}

.explorer-context-menu-item:hover:not(:disabled),
.explorer-context-menu-item:focus-visible:not(:disabled) {
  background: var(--control-hover);
  outline: none;
}

.explorer-context-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.explorer-context-menu-separator {
  height: 1px;
  margin: 0.18rem 0.2rem;
  background: var(--panel-separator);
}

@media (max-width: 980px) {
  .explorer-sidebar {
    padding: 0 1rem 1rem;
  }

  .profile-save-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .connection-summary,
  .field-grid {
    grid-template-columns: 1fr;
  }

  .tree-area {
    min-height: 20rem;
  }
}
</style>
