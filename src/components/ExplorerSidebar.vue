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
  OracleConnectRequest,
  OracleObjectEntry,
  OracleSessionSummary,
} from "../types/clarity";

const selectedProfileId = defineModel<string>("selectedProfileId", { required: true });
const profileName = defineModel<string>("profileName", { required: true });
const saveProfilePassword = defineModel<boolean>("saveProfilePassword", { required: true });

const props = defineProps<{
  connection: OracleConnectRequest;
  connectionError: string;
  connectionProfiles: ConnectionProfile[];
  selectedProfile: ConnectionProfile | null;
  busy: BusyState;
  isConnected: boolean;
  session: OracleSessionSummary | null;
  connectedSchema: string;
  objectTree: ObjectTreeNode[];
  selectedObject: OracleObjectEntry | null;
  isObjectTypeExpanded: (objectType: string) => boolean;
  onSyncSelectedProfileUi: () => void;
  onApplySelectedProfile: () => void;
  onDeleteSelectedProfile: () => void;
  onSaveConnectionProfile: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshObjects: () => void;
  onToggleObjectType: (objectType: string) => void;
  onOpenObjectFromExplorer: (object: OracleObjectEntry) => void;
  createObjectTypes: CreateObjectTypeOption[];
  onRequestCreateObject: (objectType: string) => void;
}>();

const connectionPanelCollapsed = ref(props.isConnected);
const createContextMenu = ref<{
  x: number;
  y: number;
  preferredObjectType: string | null;
} | null>(null);
const createContextMenuEl = ref<HTMLElement | null>(null);

const canOpenCreateContextMenu = computed(
  () => props.isConnected && props.createObjectTypes.length > 0,
);
const createContextMenuOptions = computed<CreateObjectTypeOption[]>(() => {
  const preferredType = createContextMenu.value?.preferredObjectType;
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

watch(
  () => props.isConnected,
  (isConnected, wasConnected) => {
    if (isConnected && !wasConnected) {
      connectionPanelCollapsed.value = true;
      return;
    }

    if (!isConnected && wasConnected) {
      connectionPanelCollapsed.value = false;
    }
  },
);
watch(
  () => props.isConnected,
  (isConnected) => {
    if (!isConnected) {
      closeCreateContextMenu();
    }
  },
);

function toggleConnectionPanel(): void {
  connectionPanelCollapsed.value = !connectionPanelCollapsed.value;
}

function normalizeObjectType(value: string): string {
  return value.trim().toUpperCase();
}

function closeCreateContextMenu(): void {
  createContextMenu.value = null;
}

function clampCreateContextMenuPosition(): void {
  if (!createContextMenu.value || !createContextMenuEl.value) {
    return;
  }

  const menuRect = createContextMenuEl.value.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 8;
  const clampedX = Math.min(
    Math.max(createContextMenu.value.x, margin),
    Math.max(margin, viewportWidth - menuRect.width - margin),
  );
  const clampedY = Math.min(
    Math.max(createContextMenu.value.y, margin),
    Math.max(margin, viewportHeight - menuRect.height - margin),
  );
  createContextMenu.value = {
    ...createContextMenu.value,
    x: clampedX,
    y: clampedY,
  };
}

async function openCreateContextMenu(
  event: MouseEvent,
  preferredObjectType: string | null,
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  if (!canOpenCreateContextMenu.value) {
    closeCreateContextMenu();
    return;
  }

  createContextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    preferredObjectType: preferredObjectType
      ? normalizeObjectType(preferredObjectType)
      : null,
  };
  await nextTick();
  clampCreateContextMenuPosition();
}

function requestCreateObject(objectType: string): void {
  closeCreateContextMenu();
  props.onRequestCreateObject(objectType);
}

function onGlobalPointerDown(event: MouseEvent): void {
  if (!createContextMenu.value) {
    return;
  }

  const target = event.target as Node | null;
  if (target && createContextMenuEl.value?.contains(target)) {
    return;
  }

  closeCreateContextMenu();
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeCreateContextMenu();
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", onGlobalPointerDown);
  window.addEventListener("keydown", onGlobalKeyDown);
  window.addEventListener("resize", closeCreateContextMenu);
  window.addEventListener("blur", closeCreateContextMenu);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onGlobalPointerDown);
  window.removeEventListener("keydown", onGlobalKeyDown);
  window.removeEventListener("resize", closeCreateContextMenu);
  window.removeEventListener("blur", closeCreateContextMenu);
});
</script>

<template>
  <aside class="explorer-sidebar">
    <header class="sidebar-header">Object Explorer</header>

    <section class="connect-box">
      <div class="connect-heading">
        <div class="connect-title">Database Connection</div>
        <button
          class="btn connect-toggle"
          type="button"
          :title="connectionPanelCollapsed ? 'Show connection panel' : 'Hide connection panel'"
          :aria-expanded="!connectionPanelCollapsed"
          aria-controls="connection-panel-body"
          @click="toggleConnectionPanel"
        >
          <AppIcon
            name="chevron-right"
            class="connect-toggle-icon"
            :class="{ expanded: !connectionPanelCollapsed }"
            aria-hidden="true"
          />
        </button>
      </div>

      <div class="session-line">
        {{ props.session ? props.session.displayName : "No active connection" }}
      </div>

      <div v-show="!connectionPanelCollapsed" id="connection-panel-body" class="connect-body">
        <div class="profile-controls">
          <label>
            Profiles
            <select v-model="selectedProfileId" @change="props.onSyncSelectedProfileUi">
              <option value="">(Select profile)</option>
              <option v-for="profile in props.connectionProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name }}
              </option>
            </select>
          </label>
          <div class="profile-actions">
            <button
              class="btn"
              :disabled="!props.selectedProfile || props.busy.loadingProfileSecret || props.busy.loadingProfiles"
              @click="props.onApplySelectedProfile"
            >
              {{ props.busy.loadingProfileSecret ? "Loading..." : "Load Profile" }}
            </button>
            <button
              class="btn"
              :disabled="!props.selectedProfile || props.busy.deletingProfile"
              @click="props.onDeleteSelectedProfile"
            >
              {{ props.busy.deletingProfile ? "Deleting..." : "Delete" }}
            </button>
          </div>
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
          <label class="profile-password-toggle">
            <input v-model="saveProfilePassword" type="checkbox" />
            Save password in OS keychain
          </label>
          <button class="btn" :disabled="props.busy.savingProfile" @click="props.onSaveConnectionProfile">
            {{ props.busy.savingProfile ? "Saving..." : "Save Profile" }}
          </button>
        </div>

        <div class="field-grid">
          <label>
            Provider
            <select v-model="props.connection.provider">
              <option value="oracle">Oracle</option>
              <option value="postgres" disabled>PostgreSQL (Soon)</option>
              <option value="mysql" disabled>MySQL (Soon)</option>
              <option value="sqlite" disabled>SQLite (Soon)</option>
            </select>
          </label>

          <label>
            Host
            <input
              v-model.trim="props.connection.host"
              placeholder="db.example.com"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label>
            Port
            <input
              v-model.number="props.connection.port"
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

          <label>
            Service
            <input
              v-model.trim="props.connection.serviceName"
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
              v-model.trim="props.connection.username"
              placeholder="hr"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label v-if="props.connection.provider === 'oracle'">
            Auth Mode
            <select v-model="props.connection.oracleAuthMode">
              <option value="normal">Normal</option>
              <option value="sysdba">SYSDBA</option>
            </select>
          </label>

          <label>
            Schema
            <input
              v-model.trim="props.connection.schema"
              placeholder="HR"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label>
            Password
            <input
              v-model="props.connection.password"
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

        <div class="connect-actions">
          <button class="btn primary" :disabled="props.busy.connecting || props.isConnected" @click="props.onConnect">
            <AppIcon name="plug" class="btn-icon" aria-hidden="true" />
            {{ props.busy.connecting ? "Connecting..." : "Connect" }}
          </button>
          <button class="btn" :disabled="!props.isConnected" @click="props.onDisconnect">
            <AppIcon name="plug-off" class="btn-icon" aria-hidden="true" />
            Disconnect
          </button>
          <button class="btn" :disabled="!props.isConnected || props.busy.loadingObjects" @click="props.onRefreshObjects">
            <AppIcon name="refresh" class="btn-icon" aria-hidden="true" />
            {{ props.busy.loadingObjects ? "Refreshing..." : "Refresh" }}
          </button>
        </div>
        <p v-if="props.connectionError" class="connect-error">{{ props.connectionError }}</p>
      </div>
    </section>

    <section class="tree-area" @contextmenu="(event) => void openCreateContextMenu(event, null)">
      <div class="tree-caption">{{ props.connectedSchema }} Objects</div>
      <p v-if="!props.objectTree.length" class="muted">No objects loaded.</p>
      <ul v-else class="tree-root" role="tree" aria-label="Database object explorer">
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
            @contextmenu="(event) => void openCreateContextMenu(event, typeNode.objectType)"
          >
            <AppIcon name="chevron-right" class="tree-caret-icon" aria-hidden="true" />
            <span class="tree-type-label">
              {{ typeNode.objectType }} <span class="tree-count">({{ typeNode.entries.length }})</span>
            </span>
          </button>

          <ul v-show="props.isObjectTypeExpanded(typeNode.objectType)" class="tree-children" role="group">
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
                @contextmenu="(event) => void openCreateContextMenu(event, entry.objectType)"
              >
                <AppIcon name="object" class="tree-leaf-icon" aria-hidden="true" />
                <span>{{ entry.objectName }}</span>
              </button>
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <div
      v-if="createContextMenu"
      ref="createContextMenuEl"
      class="explorer-context-menu"
      :style="{
        left: `${createContextMenu.x}px`,
        top: `${createContextMenu.y}px`,
      }"
      role="menu"
      aria-label="Create object"
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
    </div>
  </aside>
</template>

<style scoped>
.explorer-sidebar {
  border-right: 1px solid var(--panel-separator);
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sidebar-header {
  height: var(--pane-header-height);
  padding: 0 0.68rem;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--panel-separator);
  font-size: 0.77rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  background: var(--bg-surface-muted);
}

.connect-box {
  padding: 0.5rem 0.55rem;
  border-bottom: 1px solid var(--panel-separator);
}

.connect-title {
  font-size: 0.76rem;
  font-weight: 500;
}

.connect-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
}

.connect-toggle {
  padding: 0.2rem;
  min-width: 1.55rem;
  min-height: 1.55rem;
  justify-content: center;
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

.connect-body {
  margin-top: 0.45rem;
}

.profile-controls {
  display: grid;
  gap: 0.38rem;
  margin-bottom: 0.52rem;
  padding-bottom: 0.52rem;
  border-bottom: 1px solid var(--panel-separator);
}

.profile-actions {
  display: flex;
  gap: 0.34rem;
}

.profile-password-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.profile-password-toggle input {
  margin: 0;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.71rem;
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
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  color: var(--text-primary);
  padding: 0.27rem 0.36rem;
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
  margin-top: 0.45rem;
  display: flex;
  gap: 0.34rem;
}

.connect-error {
  margin: 0.4rem 0 0;
  color: var(--danger);
  font-size: 0.69rem;
  line-height: 1.28;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.btn {
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  padding: 0.24rem 0.46rem;
  font-size: 0.71rem;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
}

.btn:hover:not(:disabled) {
  background: var(--control-hover);
  border-color: var(--control-border);
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

.session-line {
  margin-top: 0.24rem;
  font-size: 0.69rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.48rem 0.52rem;
}

.tree-caption {
  font-size: 0.71rem;
  color: var(--text-secondary);
  margin-bottom: 0.45rem;
}

.tree-root,
.tree-children {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tree-children {
  padding-left: 0.8rem;
}

.tree-row {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.26rem;
  padding: 0.2rem 0.28rem;
  border-radius: 5px;
  font-size: 0.71rem;
  cursor: pointer;
}

.tree-type {
  font-weight: 600;
  color: var(--text-primary);
}

.tree-type:hover {
  background: var(--control-hover);
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
  color: var(--text-secondary);
  font-weight: 500;
}

.tree-type-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-node {
  color: var(--text-primary);
}

.tree-node:hover {
  background: var(--control-hover);
}

.tree-node.selected {
  background: var(--tab-active-bg);
  border-color: var(--tab-active-border);
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
  font-size: 0.71rem;
}

.explorer-context-menu {
  position: fixed;
  z-index: 90;
  min-width: 12.5rem;
  padding: 0.26rem;
  border-radius: 8px;
  border: 1px solid var(--control-border);
  background: var(--bg-surface);
  box-shadow: var(--dialog-shadow);
  display: grid;
  gap: 0.12rem;
}

.explorer-context-menu-item {
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.73rem;
  text-align: left;
  padding: 0.32rem 0.45rem;
  cursor: pointer;
}

.explorer-context-menu-item:hover,
.explorer-context-menu-item:focus-visible {
  background: var(--control-hover);
  outline: none;
}

@media (max-width: 980px) {
  .explorer-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--panel-separator);
  }

  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
