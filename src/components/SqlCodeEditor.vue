<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { openSearchPanel, search } from "@codemirror/search";
import { basicSetup } from "codemirror";
import { sql } from "@codemirror/lang-sql";
import { tags } from "@lezer/highlight";
import type { SqlCompletionSchema } from "../types/clarity";
import type { ThemeSetting } from "../types/settings";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    readOnly?: boolean;
    targetLine?: number | null;
    focusToken?: number;
    completionSchema?: SqlCompletionSchema | null;
    completionDefaultSchema?: string;
    theme?: ThemeSetting;
    aiSuggestionActive?: boolean;
  }>(),
  {
    placeholder: "",
    readOnly: false,
    targetLine: null,
    focusToken: 0,
    completionSchema: null,
    completionDefaultSchema: "",
    theme: "light",
    aiSuggestionActive: false,
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "request-ai-suggestion"): void;
  (event: "accept-ai-suggestion"): void;
  (event: "dismiss-ai-suggestion"): void;
}>();

const hostEl = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

const readOnlyCompartment = new Compartment();
const placeholderCompartment = new Compartment();
const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const syntaxCompartment = new Compartment();
const searchCompartment = new Compartment();

function buildEditorTheme(theme: ThemeSetting): Extension {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        border: "0",
        background: "var(--editor-surface)",
      },
      ".cm-scroller": {
        height: "100%",
        minHeight: "0",
        overflow: "auto",
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: "0.92rem",
        lineHeight: "1.5",
        color: "var(--editor-text)",
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "0.7rem 0 1.2rem",
        caretColor: "var(--editor-caret)",
      },
      ".cm-line": {
        padding: "0 0.85rem",
        color: "var(--editor-text)",
      },
      ".cm-gutters": {
        borderRight: "1px solid var(--editor-gutter-border)",
        background: "var(--editor-gutter-bg)",
        color: "var(--editor-gutter-text)",
        minWidth: "2.5rem",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--editor-active-line)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--editor-active-gutter)",
      },
      ".cm-selectionBackground": {
        backgroundColor: "var(--editor-selection)",
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
        {
          backgroundColor: "var(--editor-selection-focused)",
        },
      ".cm-cursor": {
        borderLeftColor: "var(--editor-caret)",
      },
      ".cm-placeholder": {
        color: "var(--editor-placeholder)",
      },
    },
    { dark: theme === "dark" },
  );
}

function buildHighlightTheme(): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [tags.keyword, tags.controlKeyword, tags.modifier],
        color: "var(--editor-token-keyword)",
      },
      {
        tag: [tags.operator, tags.derefOperator],
        color: "var(--editor-token-operator)",
      },
      {
        tag: [tags.string, tags.special(tags.string)],
        color: "var(--editor-token-string)",
      },
      {
        tag: [tags.number, tags.bool, tags.null],
        color: "var(--editor-token-number)",
      },
      {
        tag: [tags.comment, tags.lineComment, tags.blockComment],
        color: "var(--editor-token-comment)",
      },
      {
        tag: [tags.typeName, tags.className, tags.namespace],
        color: "var(--editor-token-type)",
      },
      {
        tag: [tags.variableName, tags.standard(tags.name)],
        color: "var(--editor-token-variable)",
      },
      {
        tag: [tags.propertyName, tags.attributeName],
        color: "var(--editor-token-property)",
      },
      {
        tag: [
          tags.function(tags.variableName),
          tags.function(tags.propertyName),
        ],
        color: "var(--editor-token-function)",
      },
      {
        tag: [tags.punctuation, tags.bracket, tags.paren],
        color: "var(--editor-text)",
      },
    ]),
  );
}

function buildPlaceholderExtension(value: string): Extension {
  return value ? cmPlaceholder(value) : [];
}

function buildLanguageExtension(
  completionSchema: SqlCompletionSchema | null,
  completionDefaultSchema: string,
): Extension {
  const defaultSchema = completionDefaultSchema.trim().toUpperCase();
  if (!completionSchema || Object.keys(completionSchema).length < 1) {
    return sql({ upperCaseKeywords: true });
  }

  return sql({
    schema: completionSchema,
    defaultSchema: defaultSchema || undefined,
    upperCaseKeywords: true,
  });
}

function buildShortcutExtensions(): Extension {
  return keymap.of([
    {
      key: "Mod-Space",
      run: () => {
        emit("request-ai-suggestion");
        return true;
      },
    },
    {
      key: "Tab",
      run: () => {
        if (!props.aiSuggestionActive) {
          return false;
        }
        emit("accept-ai-suggestion");
        return true;
      },
    },
    {
      key: "Escape",
      run: () => {
        if (!props.aiSuggestionActive) {
          return false;
        }
        emit("dismiss-ai-suggestion");
        return true;
      },
    },
  ]);
}

function syncSearchPanelInputs(view: EditorView): void {
  const inputs = view.dom.querySelectorAll<HTMLInputElement>(
    '.cm-panel.cm-search input[name="search"], .cm-panel.cm-search input[name="replace"]',
  );

  for (const input of inputs) {
    input.spellcheck = false;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("data-gramm", "false");
  }
}

function buildSearchInputSanitizer(): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        syncSearchPanelInputs(view);
      }

      update(update: ViewUpdate): void {
        syncSearchPanelInputs(update.view);
      }
    },
  );
}

function updateCompartment(
  compartment: Compartment,
  extension: Extension,
): void {
  if (!editorView) {
    return;
  }

  editorView.dispatch({
    effects: compartment.reconfigure(extension),
  });
}

function revealLine(lineNumber: number): void {
  if (!editorView || !Number.isFinite(lineNumber)) {
    return;
  }

  const maxLine = editorView.state.doc.lines;
  const normalized = Math.max(1, Math.min(maxLine, Math.trunc(lineNumber)));
  const line = editorView.state.doc.line(normalized);

  editorView.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    scrollIntoView: true,
  });
  editorView.focus();
}

function openSearch(): void {
  if (!editorView) {
    return;
  }

  openSearchPanel(editorView);
}

onMounted(() => {
  if (!hostEl.value) {
    return;
  }

  editorView = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        themeCompartment.of(buildEditorTheme(props.theme)),
        syntaxCompartment.of(buildHighlightTheme()),
        searchCompartment.of(search({ top: true })),
        buildSearchInputSanitizer(),
        languageCompartment.of(
          buildLanguageExtension(
            props.completionSchema,
            props.completionDefaultSchema,
          ),
        ),
        buildShortcutExtensions(),
        readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly)),
        placeholderCompartment.of(buildPlaceholderExtension(props.placeholder)),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (!update.docChanged) {
            return;
          }

          emit("update:modelValue", update.state.doc.toString());
        }),
      ],
    }),
    parent: hostEl.value,
  });

  if (props.targetLine !== null && props.targetLine !== undefined) {
    revealLine(props.targetLine);
  }
});

watch(
  () => props.modelValue,
  (nextValue) => {
    if (!editorView) {
      return;
    }

    const current = editorView.state.doc.toString();
    if (nextValue === current) {
      return;
    }

    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: nextValue,
      },
    });
  },
);

watch(
  () => props.readOnly,
  (isReadOnly) => {
    updateCompartment(readOnlyCompartment, EditorState.readOnly.of(isReadOnly));
  },
);

watch(
  () => props.placeholder,
  (placeholderValue) => {
    updateCompartment(
      placeholderCompartment,
      buildPlaceholderExtension(placeholderValue),
    );
  },
);

watch(
  () => props.theme,
  (nextTheme) => {
    updateCompartment(themeCompartment, buildEditorTheme(nextTheme));
    updateCompartment(syntaxCompartment, buildHighlightTheme());
  },
);

watch(
  () => [props.completionSchema, props.completionDefaultSchema] as const,
  ([completionSchema, completionDefaultSchema]) => {
    updateCompartment(
      languageCompartment,
      buildLanguageExtension(completionSchema, completionDefaultSchema),
    );
  },
);

watch(
  () => `${props.focusToken}:${props.targetLine ?? ""}`,
  () => {
    if (props.targetLine === null || props.targetLine === undefined) {
      return;
    }

    revealLine(props.targetLine);
  },
);

function getSelectedText(): string {
  if (!editorView) {
    return "";
  }

  return editorView.state.sliceDoc(
    editorView.state.selection.main.from,
    editorView.state.selection.main.to,
  );
}

defineExpose({ getSelectedText, openSearch });

onBeforeUnmount(() => {
  editorView?.destroy();
  editorView = null;
});
</script>

<template>
  <div ref="hostEl" class="sql-code-editor"></div>
</template>

<style scoped>
.sql-code-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.sql-code-editor :deep(.cm-editor.cm-focused) {
  outline: 1px solid var(--editor-focus-outline);
  outline-offset: -1px;
}

.sql-code-editor :deep(.cm-panels) {
  background: color-mix(in srgb, var(--editor-surface) 94%, transparent);
  color: var(--editor-text);
  border-color: var(--editor-gutter-border);
}

.sql-code-editor :deep(.cm-panels-top) {
  border-bottom: 1px solid var(--editor-gutter-border);
}

.sql-code-editor :deep(.cm-panel.cm-search) {
  gap: 0.45rem;
  padding: 0.55rem 0.75rem;
  font-family: inherit;
  font-size: 0.74rem;
  align-items: center;
}

.sql-code-editor :deep(.cm-panel.cm-search label) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-secondary);
}

.sql-code-editor :deep(.cm-panel.cm-search input) {
  border: 1px solid var(--control-border);
  border-radius: 0.5rem;
  background: var(--control-bg);
  color: var(--text-primary);
  padding: 0.38rem 0.55rem;
}

.sql-code-editor :deep(.cm-panel.cm-search input[type="checkbox"]) {
  width: 0.9rem;
  height: 0.9rem;
  padding: 0;
}

.sql-code-editor :deep(.cm-panel.cm-search button) {
  border: 0;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--control-bg) 92%, transparent);
  color: var(--text-primary);
  padding: 0.3rem 0.58rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.sql-code-editor :deep(.cm-panel.cm-search button:hover:not(:disabled)) {
  background: var(--control-hover);
}

.sql-code-editor :deep(.cm-panel.cm-search button[name="close"]) {
  min-width: 1.9rem;
  padding-inline: 0;
}

.sql-code-editor :deep(.cm-searchMatch) {
  background: color-mix(in srgb, var(--accent-soft) 82%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
}

.sql-code-editor :deep(.cm-searchMatch.cm-searchMatch-selected) {
  background: color-mix(in srgb, var(--accent) 24%, transparent);
}
</style>
