<script setup lang="ts">
type IconName =
  | "chevron-right"
  | "object"
  | "plug"
  | "plug-off"
  | "refresh"
  | "play"
  | "save"
  | "plus"
  | "close"
  | "search"
  | "settings";

withDefaults(
  defineProps<{
    name: IconName;
    size?: number | string;
    strokeWidth?: number | string;
  }>(),
  {
    size: 16,
    strokeWidth: 1.8,
  },
);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-if="name === 'chevron-right'" d="m9 6 6 6-6 6" />

    <g v-else-if="name === 'object'">
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.25" />
      <path d="M8 8h8M8 12h8M8 16h4" />
    </g>

    <g v-else-if="name === 'plug'">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8H6a2 2 0 0 0-2 2v3a6 6 0 0 0 12 0v-3a2 2 0 0 0-2-2Z" />
    </g>

    <g v-else-if="name === 'plug-off'">
      <path d="M2 2l20 20" />
      <path d="M15 2v5" />
      <path d="M9 2v2" />
      <path d="M18 8H9.5a5.5 5.5 0 0 0-4 1.7" />
      <path d="M12 22v-5" />
    </g>

    <g v-else-if="name === 'refresh'">
      <path d="M3 12a9 9 0 0 1 15.5-6.4" />
      <path d="M21 12a9 9 0 0 1-15.5 6.4" />
      <path d="M18.5 2.5v4h-4" />
      <path d="M5.5 21.5v-4h4" />
    </g>

    <path v-else-if="name === 'play'" d="m9 7 8 5-8 5z" />

    <g v-else-if="name === 'save'">
      <path d="M4 4h13l3 3v13H4z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 20v-6h8v6" />
    </g>

    <path v-else-if="name === 'plus'" d="M12 5v14M5 12h14" />

    <path v-else-if="name === 'close'" d="M6 6l12 12M18 6l-12 12" />

    <g v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </g>

    <g v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="2.6" />
      <path d="M19.4 14a1 1 0 0 0 .2 1.1l.1.1a1 1 0 1 1-1.4 1.4l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V18a1 1 0 1 1-2 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 1 1-1.4-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H10a1 1 0 1 1 0-2h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 1 1 1.4-1.4l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V6a1 1 0 1 1 2 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 1 1 1.4 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a1 1 0 1 1 0 2h-.2a1 1 0 0 0-.9.6Z" />
    </g>
  </svg>
</template>
