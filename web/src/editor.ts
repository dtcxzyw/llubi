import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentService,
  indentUnit,
  type IndentContext,
  StreamLanguage,
  StringStream,
  syntaxHighlighting,
} from '@codemirror/language';
import { setDiagnostics, lintGutter } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  crosshairCursor,
  Decoration,
  DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

import type { CompletionCatalog, Diagnostic } from './protocol';

const completionSection = {
  symbol: { name: 'Symbols', rank: 0 },
  instruction: { name: 'Instructions', rank: 1 },
  keyword: { name: 'Keywords', rank: 2 },
  type: { name: 'Types', rank: 3 },
  attribute: { name: 'Attributes', rank: 4 },
  metadata: { name: 'Metadata', rank: 5 },
  function: { name: 'Functions', rank: 6 },
};

const integerTypePattern = /\b(?:v\d+)?[ib]\d+\b/g;
const vectorTypePattern = /\bx\d+[ib]\d+\b/g;

function collectSymbols(state: EditorState, prefix: string, pos: number): string[] {
  const re = prefix === '%' ? /%[-a-zA-Z$._0-9]+/g : /@[-a-zA-Z$._0-9]+/g;
  const text = state.doc.toString();
  const symbols = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index !== pos) symbols.add(match[0]);
  }
  return [...symbols].sort();
}

function collectTypeHints(state: EditorState): string[] {
  const text = state.doc.toString();
  const names = new Set<string>();
  for (const pattern of [integerTypePattern, vectorTypePattern]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) names.add(match[0]);
  }
  return [...names].sort();
}

function inCommentOrString(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  let inString = false;
  let escaped = false;
  for (const ch of before) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    else if (ch === ';' && !inString) return true;
  }
  return inString;
}

function makeCompletions(catalog: CompletionCatalog): Completion[] {
  const instructions: Completion[] = catalog.instructions.map((label) => ({
    label,
    type: 'keyword',
    section: completionSection.instruction,
  }));
  const keywords: Completion[] = catalog.keywords.map((label) => ({
    label,
    type: 'keyword',
    section: completionSection.keyword,
  }));
  const types: Completion[] = catalog.types.map((label) => ({
    label,
    type: 'type',
    section: completionSection.type,
  }));
  const attributes: Completion[] = catalog.attributes.map((label) => ({
    label,
    type: 'property',
    section: completionSection.attribute,
  }));
  const intrinsics: Completion[] = catalog.intrinsics.map(
    ({ name, overloaded }) => {
      const label = `@${name}${overloaded ? '.' : ''}`;
      return {
        label,
        detail: overloaded ? 'overloaded intrinsic' : 'intrinsic',
        type: 'function',
        section: completionSection.function,
        info: overloaded
          ? 'LLVM overloaded intrinsic names include type suffixes derived from the operand types. Add the suffix that matches this call.'
          : undefined,
      };
    },
  );
  const metadata: Completion[] = catalog.metadata.map((name) => ({
    label: `!${name}`,
    detail: 'fixed metadata',
    type: 'property',
    section: completionSection.metadata,
  }));
  const libcalls: Completion[] = catalog.libcalls.map((name) => ({
    label: `@${name}`,
    detail: 'libcall',
    type: 'function',
    section: completionSection.function,
  }));
  return [
    ...instructions,
    ...keywords,
    ...types,
    ...attributes,
    ...metadata,
    ...intrinsics,
    ...libcalls,
  ];
}

function createCompletionSource(
  catalog: CompletionCatalog,
): (context: CompletionContext) => CompletionResult | null {
  const baseCompletions = makeCompletions(catalog);
  return (context) => {
    if (!context.explicit && inCommentOrString(context.state, context.pos))
      return null;
    const word = context.matchBefore(/[@%!]?[-a-zA-Z$._0-9]+/);
    if (!word && !context.explicit) return null;
    if (word && word.from === word.to && !context.explicit) return null;

    const from = word ? word.from : context.pos;
    let options: Completion[] = baseCompletions;
    if (word) {
      const prefix = context.state.sliceDoc(word.from, word.to);
      if (prefix.startsWith('%') || prefix.startsWith('@')) {
        const symbols = collectSymbols(context.state, prefix[0], word.from).map(
          (label) => ({
            label,
            type: 'variable',
            section: completionSection.symbol,
            boost: 20,
          }),
        );
        options = [...symbols, ...baseCompletions];
      } else {
        const types = collectTypeHints(context.state).map((label) => ({
          label,
          type: 'type',
          section: completionSection.type,
          boost: 10,
        }));
        options = [...types, ...baseCompletions];
      }
    }

    return {
      from,
      options,
      validFor: /^[@%!]?[-a-zA-Z$._0-9]*$/,
    };
  };
}

function llvmIndent(context: IndentContext, pos: number): number {
  const line = context.state.doc.lineAt(pos);
  const beforeText = line.text.slice(0, pos - line.from);
  const afterText = line.text.slice(pos - line.from).trimStart();
  const current = /^\s*/.exec(line.text)?.[0].length ?? 0;
  const trimmed = line.text.trim();
  const unit = context.unit;

  if (afterText.startsWith('}') || afterText.startsWith(']'))
    return Math.max(0, current - unit);
  if (/[{\[(]\s*$/.test(beforeText)) return current + unit;
  if (/^[-a-zA-Z$._0-9]+:$/.test(trimmed)) return Math.max(unit, current);
  if (/}\s*$/.test(beforeText)) return Math.max(0, current - unit);
  return current;
}

function createLlvmTokenMatcher(catalog: CompletionCatalog) {
  const instructions = new Set(catalog.instructions);
  const keywords = new Set(catalog.keywords);
  const types = new Set(catalog.types);
  const attributes = new Set(catalog.attributes);

  return (stream: StringStream): string | null => {
    if (stream.eatSpace()) return null;
    if (stream.match(/;.*/)) return 'comment';
    if (stream.match(/"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/![-a-zA-Z$._0-9]+/)) return 'meta';
    if (stream.match(/#[0-9]+/)) return 'attributeName';
    if (stream.match(/!?\{/)) return 'bracket';
    if (stream.match(/[{}()\[\],]/)) return 'bracket';
    if (stream.match(/%[-a-zA-Z$._0-9]+/)) return 'variableName';
    if (stream.match(/@[-a-zA-Z$._0-9]+/)) return 'className';
    if (stream.match(/[-+](?:inf|qnan|s?nan\(0x[0-9a-fA-F]+\))/))
      return 'number';
    if (stream.match(/[us]0x[0-9a-fA-F]+/)) return 'number';
    if (stream.match(/f0x[0-9a-fA-F]+/)) return 'number';
    if (
      stream.match(
        /[-+]?0x(?:[KLMHR][0-9a-fA-F]+|[0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?(?:[pP][-+]?\d+)?)/,
      )
    )
      return 'number';
    if (
      stream.match(
        /[-+]?(?:(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)/,
      )
    )
      return 'number';
    if (stream.match(/[a-zA-Z_][\w.]*/)) {
      const word = stream.current();
      if (instructions.has(word) || keywords.has(word)) return 'keyword';
      if (types.has(word) || /^(?:[ib]\d+|v\d+[ib]\d+|x\d+[ib]\d+|<-?\d+ x)/.test(word))
        return 'typeName';
      if (attributes.has(word)) return 'attributeName';
      if (stream.peek() === ':') return 'labelName';
      return null;
    }
    if (stream.match(/[=<>!+\-*\/|&^~]+/)) return 'operator';
    stream.next();
    return null;
  };
}

function createLlvmLanguage(catalog: CompletionCatalog) {
  return StreamLanguage.define<null>({
    name: 'llvm-ir',
    startState: () => null,
    languageData: {
      commentTokens: { line: ';' },
      closeBrackets: { brackets: ['(', '[', '{', '"'] },
    },
    token: createLlvmTokenMatcher(catalog),
  });
}

export function createLlvmHighlighter(
  catalog: CompletionCatalog,
): (text: string) => DocumentFragment {
  const token = createLlvmTokenMatcher(catalog);
  return (text: string) => {
    const fragment = document.createDocumentFragment();
    const stream = new StringStream(text, 2, 2);
    while (stream.pos < text.length) {
      const start = stream.pos;
      stream.start = start;
      const type = token(stream);
      if (stream.pos === start) stream.next();
      const end = stream.pos;
      if (end <= start) break;
      const span = document.createElement('span');
      if (type) span.className = `tok-${type.replace(/\./g, '-')}`;
      span.textContent = text.slice(start, end);
      fragment.append(span);
    }
    return fragment;
  };
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.typeName, color: 'var(--syntax-type)' },
  { tag: tags.variableName, color: 'var(--syntax-local)' },
  { tag: tags.className, color: 'var(--syntax-global)' },
  { tag: tags.labelName, color: 'var(--syntax-label)' },
  { tag: tags.attributeName, color: 'var(--syntax-attribute)' },
  { tag: tags.meta, color: 'var(--syntax-meta)' },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: tags.bracket, color: 'var(--syntax-punctuation)' },
  { tag: tags.invalid, color: 'var(--error)' },
]);

const setErrorLines = StateEffect.define<readonly number[]>();

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, tr) {
    let next = lines.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLines)) continue;
      const ranges = [...new Set(effect.value)]
        .filter((line) => line >= 1 && line <= tr.state.doc.lines)
        .sort((a, b) => a - b)
        .map((line) =>
          Decoration.line({ class: 'cm-error-line' }).range(
            tr.state.doc.line(line).from,
          ),
        );
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface EditorController {
  view: EditorView;
  getValue(): string;
  setValue(value: string): void;
  setDiagnostics(diagnostics: Diagnostic[]): void;
  clearDiagnostics(): void;
  revealLine(line: number): void;
}

export function createEditor(
  parent: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
  catalog: CompletionCatalog,
  onLineClick?: (line: number) => boolean,
  onLineSelect?: (line: number) => void,
): EditorController {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of('  '),
        indentService.of(llvmIndent),
        EditorView.contentAttributes.of({
          'aria-label': 'LLVM IR editor',
          tabindex: '0',
          'data-gramm': 'false',
          'data-gramm_editor': 'false',
          'data-enable-grammarly': 'false',
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          translate: 'no',
        }),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        errorLineField,
        createLlvmLanguage(catalog),
        closeBrackets(),
        autocompletion({
          override: [createCompletionSource(catalog)],
          maxRenderedOptions: 80,
        }),
        syntaxHighlighting(highlightStyle),
        keymap.of([
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            const line = update.state.doc.lineAt(
              update.state.selection.main.head,
            ).number;
            onLineSelect?.(line);
          }
        }),
      ],
    }),
  });

  if (onLineClick) {
    view.dom
      .querySelector('.cm-lineNumbers')
      ?.setAttribute('title', 'Click a line number to jump to its verbose trace');
    view.dom.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      const gutterElement = target?.closest<HTMLElement>(
        '.cm-lineNumbers .cm-gutterElement',
      );
      if (!gutterElement) return;
      const line = Number(gutterElement.textContent);
      if (!Number.isInteger(line) || line <= 0) return;
      event.preventDefault();
      const position = view.state.doc.line(line).from;
      view.dispatch({
        selection: EditorSelection.cursor(position),
      });
      view.focus();
      onLineClick(line);
    });
    view.contentDOM.addEventListener('click', () => {
      const line = view.state.doc.lineAt(view.state.selection.main.head).number;
      onLineClick(line);
    });
  }

  const lineForDiagnostic = (diagnostic: Diagnostic): number => {
    if (diagnostic.line && diagnostic.line > 0) return diagnostic.line;
    const frame = diagnostic.frames?.find((item) => (item.line ?? 0) > 0);
    return frame?.line ?? 0;
  };

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(value: string) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: EditorSelection.cursor(0),
      });
    },
    setDiagnostics(diagnostics: Diagnostic[]) {
      const cmDiagnostics = [];
      const lines = [];
      for (const diagnostic of diagnostics) {
        const lineNumber = lineForDiagnostic(diagnostic);
        if (!lineNumber || lineNumber > view.state.doc.lines) continue;
        const line = view.state.doc.line(lineNumber);
        const column = Math.max(1, diagnostic.column ?? 1);
        const from = Math.min(line.to, line.from + column - 1);
        cmDiagnostics.push({
          from,
          to: line.to,
          severity:
            diagnostic.severity === 'warning'
              ? ('warning' as const)
              : ('error' as const),
          message: diagnostic.message,
          source: diagnostic.phase,
        });
        lines.push(lineNumber);
        for (const frame of diagnostic.frames ?? []) {
          if (frame.line) lines.push(frame.line);
        }
      }
      view.dispatch(setDiagnostics(view.state, cmDiagnostics));
      view.dispatch({ effects: setErrorLines.of(lines) });
    },
    clearDiagnostics() {
      view.dispatch(setDiagnostics(view.state, []));
      view.dispatch({ effects: setErrorLines.of([]) });
    },
    revealLine(line: number) {
      if (line < 1 || line > view.state.doc.lines) return;
      const position = view.state.doc.line(line).from;
      view.dispatch({
        selection: EditorSelection.cursor(position),
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
      });
      view.focus();
    },
  };
}
