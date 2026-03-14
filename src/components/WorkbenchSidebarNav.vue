<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";

type SidebarSection =
  | "connections"
  | "explorer"
  | "query"
  | "object"
  | "settings";

const props = defineProps<{
  activeSection: SidebarSection;
  isConnected: boolean;
  providerLabel: string;
  connectedSchema: string;
  selectedObjectLabel: string;
}>();

const emit = defineEmits<{
  navigate: [section: SidebarSection];
}>();

const navItems = [
  {
    id: "connections" as const,
    label: "Connections",
    icon: "plug" as const,
  },
  {
    id: "explorer" as const,
    label: "Explorer",
    icon: "object" as const,
  },
  {
    id: "query" as const,
    label: "Workspace",
    icon: "play" as const,
  },
  {
    id: "object" as const,
    label: "Object",
    icon: "save" as const,
  },
  {
    id: "settings" as const,
    label: "Settings",
    icon: "settings" as const,
  },
];

const sessionSummary = computed<string>(() => {
  if (!props.isConnected) {
    return "Offline";
  }

  return props.connectedSchema || "Connected";
});
</script>

<template>
  <aside class="sidebar-nav">
    <div class="sidebar-brand">
      <div class="brand-mark">
        <AppIcon name="database" :size="20" :stroke-width="1.7" />
      </div>
      <div class="brand-name">Clarity</div>
    </div>

    <nav class="nav-list" aria-label="Primary navigation">
      <button
        v-for="item in navItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: props.activeSection === item.id }"
        type="button"
        :aria-current="props.activeSection === item.id ? 'page' : undefined"
        @click="emit('navigate', item.id)"
      >
        <span class="nav-icon">
          <AppIcon :name="item.icon" :size="16" />
        </span>
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </nav>

    <section class="nav-context">
      <div class="nav-context-label">Connection</div>
      <div class="nav-context-value">{{ sessionSummary }}</div>
      <div class="nav-context-meta">{{ props.providerLabel }}</div>
      <div
        v-if="props.selectedObjectLabel"
        class="nav-context-meta nav-context-object"
      >
        {{ props.selectedObjectLabel }}
      </div>
    </section>
  </aside>
</template>

<style scoped>
.sidebar-nav {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 0.75rem;
  min-height: 0;
  padding: 0.85rem 0 0.85rem 0.85rem;
}

.sidebar-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  padding-right: 0.85rem;
}

.brand-mark {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-strong);
  background: var(--bg-surface);
  border: 1px solid var(--border);
}

.brand-name {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
}

.nav-list {
  display: grid;
  align-content: start;
  gap: 0.35rem;
  padding-right: 0.85rem;
}

.nav-item {
  border: 1px solid transparent;
  background: var(--bg-sidebar);
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 0.55rem 0.45rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  cursor: pointer;
  text-align: center;
}

.nav-item:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
  border-color: var(--border);
}

.nav-item.active {
  background: var(--bg-surface);
  color: var(--text-primary);
  border-color: var(--tab-active-border);
}

.nav-item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.nav-icon {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface-muted);
  color: var(--text-secondary);
}

.nav-item.active .nav-icon {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.nav-label {
  font-size: 0.67rem;
  font-weight: 600;
}

.nav-context {
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  padding: 0.65rem;
  display: grid;
  gap: 0.2rem;
  margin-right: 0.85rem;
}

.nav-context-label {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.nav-context-value {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
}

.nav-context-meta {
  font-size: 0.68rem;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.nav-context-object {
  margin-top: 0.3rem;
  padding-top: 0.45rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
}

@media (max-width: 1100px) {
  .sidebar-nav {
    grid-template-rows: auto;
    padding: 1rem 0 0 1rem;
  }

  .nav-context {
    display: none;
  }
}

@media (max-width: 980px) {
  .sidebar-nav {
    padding: 1rem 1rem 0 1rem;
  }

  .nav-list {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .nav-item {
    padding: 0.8rem 0.55rem;
    justify-items: center;
    text-align: center;
  }

  .nav-caption {
    display: none;
  }
}
</style>
