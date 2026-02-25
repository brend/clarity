<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, placeholder as cmPlaceholder, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
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
  }>(),
  {
    placeholder: "",
    readOnly: false,
    targetLine: null,
    focusToken: 0,
    completionSchema: null,
    completionDefaultSchema: "",
    theme: "light",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
}>();

const hostEl = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

const readOnlyCompartment = new Compartment();
const placeholderCompartment = new Compartment();
const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const syntaxCompartment = new Compartment();

function buildEditorTheme(theme: ThemeSetting): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      border: "0",
      background: "var(--editor-surface)",
    },
    ".cm-scroller": {
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: "0.8rem",
      lineHeight: "1.38",
      color: "var(--editor-text)",
    },
    ".cm-content": {
      padding: "0.44rem 0",
      caretColor: "var(--editor-caret)",
    },
    ".cm-line": {
      padding: "0 0.5rem",
      color: "var(--editor-text)",
    },
    ".cm-gutters": {
      borderRight: "1px solid var(--editor-gutter-border)",
      background: "var(--editor-gutter-bg)",
      color: "var(--editor-gutter-text)",
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
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "var(--editor-selection-focused)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--editor-caret)",
    },
    ".cm-placeholder": {
      color: "var(--editor-placeholder)",
    },
  }, { dark: theme === "dark" });
}

function buildHighlightTheme(): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: [tags.keyword, tags.controlKeyword, tags.modifier], color: "var(--editor-token-keyword)" },
      { tag: [tags.operator, tags.derefOperator], color: "var(--editor-token-operator)" },
      { tag: [tags.string, tags.special(tags.string)], color: "var(--editor-token-string)" },
      { tag: [tags.number, tags.bool, tags.null], color: "var(--editor-token-number)" },
      { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--editor-token-comment)" },
      { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--editor-token-type)" },
      { tag: [tags.variableName, tags.standard(tags.name)], color: "var(--editor-token-variable)" },
      { tag: [tags.propertyName, tags.attributeName], color: "var(--editor-token-property)" },
      { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--editor-token-function)" },
      { tag: [tags.punctuation, tags.bracket, tags.paren], color: "var(--editor-text)" },
    ]),
  );
}

function buildPlaceholderExtension(value: string): Extension {
  return value ? cmPlaceholder(value) : [];
}

function buildLanguageExtension(completionSchema: SqlCompletionSchema | null, completionDefaultSchema: string): Extension {
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

function updateCompartment(compartment: Compartment, extension: Extension): void {
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
        languageCompartment.of(buildLanguageExtension(props.completionSchema, props.completionDefaultSchema)),
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
    updateCompartment(placeholderCompartment, buildPlaceholderExtension(placeholderValue));
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
</style>
