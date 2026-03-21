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
} from "../types/clarity";

const selectedProfileId = defineModel<string>("selectedProfileId", {
    required: true,
});

const props = defineProps<{
    connectionProfiles: ConnectionProfile[];
    selectedProfile: OracleConnectionProfile | null;
    busy: BusyState;
    isConnected: boolean;
    session: DbSessionSummary | null;
    connectedSchema: string;
    objectTree: ObjectTreeNode[];
    selectedObject: DbObjectEntry | null;
    isObjectTypeExpanded: (objectType: string) => boolean;
    onSyncSelectedProfileUi: () => void;
    onApplySelectedProfile: () => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onRefreshObjects: () => void;
    onToggleObjectType: (objectType: string) => void;
    onOpenObjectFromExplorer: (object: DbObjectEntry) => void;
    onOpenConnectionDialog: (mode: "new" | "edit") => void;
    createObjectTypes: CreateObjectTypeOption[];
    onRequestCreateObject: (objectType: string) => void;
}>();
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
    return refreshObjectType
        ? `Refresh ${refreshObjectType}`
        : "Refresh Explorer";
});

watch(
    () => props.isConnected,
    (isConnected) => {
        if (!isConnected) {
            closeExplorerContextMenu();
        }
    },
);

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

function isInvalidObject(entry: DbObjectEntry): boolean {
    return entry.status?.trim().toUpperCase() === "INVALID";
}

function isPackageBodyEntry(entry: DbObjectEntry): boolean {
    return normalizeObjectType(entry.objectType) === "PACKAGE BODY";
}

function getObjectEntryLabel(entry: DbObjectEntry): string {
    return isPackageBodyEntry(entry)
        ? `${entry.objectName} (Body)`
        : entry.objectName;
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
        <section class="connect-box">
            <select
                class="connect-profile-select"
                v-model="selectedProfileId"
                :disabled="
                    props.busy.loadingProfiles ||
                    props.busy.loadingProfileSecret
                "
                @change="onSelectedProfileChange"
            >
                <option value="">(No connection selected)</option>
                <option
                    v-for="profile in props.connectionProfiles"
                    :key="profile.id"
                    :value="profile.id"
                >
                    {{ profile.name }}
                </option>
            </select>

            <div class="connect-actions">
                <button
                    class="btn primary btn-connect"
                    :disabled="props.busy.connecting || !selectedProfileId"
                    @click="
                        props.isConnected
                            ? props.onDisconnect()
                            : props.onConnect()
                    "
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
                    v-if="selectedProfileId"
                    class="btn"
                    title="Edit connection"
                    @click="props.onOpenConnectionDialog('edit')"
                >
                    <AppIcon
                        name="settings"
                        class="btn-icon"
                        aria-hidden="true"
                    />
                </button>
                <button
                    class="btn"
                    title="New connection"
                    @click="props.onOpenConnectionDialog('new')"
                >
                    <AppIcon name="plus" class="btn-icon" aria-hidden="true" />
                </button>
            </div>
        </section>

        <section
            class="sidebar-card tree-area"
            @contextmenu="(event) => void openExplorerContextMenu(event, null)"
        >
            <header class="card-header">
                <div class="card-heading">
                    <p class="card-kicker">Database Explorer</p>
                    <h2 class="card-title">
                        {{ props.connectedSchema || "Object tree" }}
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
                    <AppIcon
                        name="refresh"
                        class="btn-icon"
                        aria-hidden="true"
                    />
                    Refresh
                </button>
            </header>

            <div class="explorer-meta-row">
                <span class="meta-pill">
                    {{ props.objectTree.length }} type{{
                        props.objectTree.length === 1 ? "" : "s"
                    }}
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
                        :aria-expanded="
                            props.isObjectTypeExpanded(typeNode.objectType)
                        "
                    >
                        <button
                            class="tree-row tree-type"
                            :class="{
                                expanded: props.isObjectTypeExpanded(
                                    typeNode.objectType,
                                ),
                            }"
                            @click="
                                props.onToggleObjectType(typeNode.objectType)
                            "
                            @contextmenu="
                                (event) =>
                                    void openExplorerContextMenu(
                                        event,
                                        typeNode.objectType,
                                    )
                            "
                        >
                            <AppIcon
                                name="chevron-right"
                                class="tree-caret-icon"
                                aria-hidden="true"
                            />
                            <span class="tree-type-label">
                                {{ typeNode.objectType }}
                                <span class="tree-count">{{
                                    typeNode.entries.length
                                }}</span>
                            </span>
                        </button>

                        <ul
                            v-show="
                                props.isObjectTypeExpanded(typeNode.objectType)
                            "
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
                                            props.selectedObject?.schema ===
                                                entry.schema &&
                                            props.selectedObject?.objectName ===
                                                entry.objectName &&
                                            props.selectedObject?.objectType ===
                                                entry.objectType,
                                    }"
                                    @click="
                                        props.onOpenObjectFromExplorer(entry)
                                    "
                                    @contextmenu="
                                        (event) =>
                                            void openExplorerContextMenu(
                                                event,
                                                entry.objectType,
                                            )
                                    "
                                >
                                    <AppIcon
                                        name="object"
                                        class="tree-leaf-icon"
                                        aria-hidden="true"
                                    />
                                    <span class="tree-node-label">{{
                                        getObjectEntryLabel(entry)
                                    }}</span>
                                    <span
                                        v-if="isInvalidObject(entry)"
                                        class="tree-status-pill invalid"
                                        :title="
                                            entry.invalidReason ||
                                            'Oracle reports this object as invalid.'
                                        "
                                    >
                                        Invalid
                                    </span>
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
            <div
                v-if="createContextMenuOptions.length"
                class="explorer-context-menu-separator"
            ></div>
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
    border-radius: 4px;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--bg-surface-muted) 58%, transparent) 0%,
        color-mix(in srgb, var(--bg-surface) 94%, transparent) 100%
    );
    box-shadow: var(--card-shadow);
    overflow: hidden;
}

.tree-node-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tree-status-pill {
    margin-left: auto;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
}

.tree-status-pill.invalid {
    color: color-mix(in srgb, var(--danger) 88%, #ffffff 12%);
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
}

.connect-box {
    display: grid;
    gap: 0.45rem;
    padding: 0.7rem;
}

.connect-profile-select {
    width: 100%;
    min-width: 0;
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

label {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
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
    border-radius: 3px;
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

.btn {
    border: 0;
    border-radius: 4px;
    background: color-mix(in srgb, var(--control-bg) 92%, transparent);
    padding: 0.5rem 0.68rem;
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
    border-radius: 3px;
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
    background: color-mix(
        in srgb,
        var(--accent-soft) 60%,
        var(--control-hover)
    );
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
    background: color-mix(
        in srgb,
        var(--accent-soft) 44%,
        var(--control-hover)
    );
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

.muted {
    color: var(--text-secondary);
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
    border-radius: 4px;
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

    .connection-summary {
        grid-template-columns: 1fr;
    }

    .tree-area {
        min-height: 20rem;
    }
}
</style>
