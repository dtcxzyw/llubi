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
  StreamLanguage,
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

import type { Diagnostic } from './protocol';

const keywords = new Set([
  'define',
  'declare',
  'ret',
  'br',
  'switch',
  'indirectbr',
  'invoke',
  'callbr',
  'call',
  'resume',
  'catchswitch',
  'catchret',
  'cleanupret',
  'unreachable',
  'add',
  'sub',
  'mul',
  'udiv',
  'sdiv',
  'urem',
  'srem',
  'fadd',
  'fsub',
  'fmul',
  'fdiv',
  'frem',
  'shl',
  'lshr',
  'ashr',
  'and',
  'or',
  'xor',
  'extractelement',
  'insertelement',
  'shufflevector',
  'extractvalue',
  'insertvalue',
  'alloca',
  'load',
  'store',
  'fence',
  'cmpxchg',
  'atomicrmw',
  'getelementptr',
  'trunc',
  'zext',
  'sext',
  'fptrunc',
  'fpext',
  'fptoui',
  'fptosi',
  'uitofp',
  'sitofp',
  'ptrtoint',
  'inttoptr',
  'bitcast',
  'addrspacecast',
  'icmp',
  'fcmp',
  'phi',
  'select',
  'freeze',
  'va_arg',
  'landingpad',
  'catchpad',
  'cleanuppad',
  'musttail',
  'tail',
  'notail',
  'volatile',
  'atomic',
  'syncscope',
  'nsw',
  'nuw',
  'exact',
  'inbounds',
  'inrange',
  'disjoint',
  'nnan',
  'ninf',
  'nsz',
  'arcp',
  'contract',
  'afn',
  'reassoc',
  'fast',
  'true',
  'false',
  'null',
  'none',
  'undef',
  'poison',
  'zeroinitializer',
  'blockaddress',
  'x',
  'to',
  'unwind',
  'within',
  'from',
  'cleanup',
  'catch',
  'filter',
  'label',
  'metadata',
  'token',
  'ptr',
  'opaque',
]);

const types = new Set([
  'void',
  'half',
  'bfloat',
  'float',
  'double',
  'fp128',
  'x86_fp80',
  'ppc_fp128',
  'x86_mmx',
  'x86_amx',
  'target',
  'type',
]);

const attributes = new Set([
  'align',
  'alignstack',
  'allocsize',
  'alwaysinline',
  'byval',
  'byref',
  'cold',
  'dereferenceable',
  'dereferenceable_or_null',
  'disable_sanitizer_instrumentation',
  'elementtype',
  'immarg',
  'inalloca',
  'inreg',
  'minsize',
  'mustprogress',
  'naked',
  'noalias',
  'nobuiltin',
  'nocallback',
  'nocapture',
  'nocf_check',
  'nofree',
  'noint',
  'noinline',
  'nomerge',
  'nonlazybind',
  'nonnull',
  'noprofile',
  'norecurse',
  'noundef',
  'nounwind',
  'nosync',
  'optforfuzzing',
  'optnone',
  'optsize',
  'preallocated',
  'readnone',
  'readonly',
  'returned',
  'sret',
  'sanitize_address',
  'sanitize_memory',
  'sanitize_thread',
  'signext',
  'speculatable',
  'swiftasync',
  'swifterror',
  'swiftself',
  'uwtable',
  'willreturn',
  'writable',
  'writeonly',
  'zeroext',
]);

const llvmIR = StreamLanguage.define<null>({
  name: 'llvm-ir',
  startState: () => null,
  languageData: {
    commentTokens: { line: ';' },
  },
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/;.*/)) return 'comment';
    if (stream.match(/"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/![-a-zA-Z$._0-9]+/)) return 'meta';
    if (stream.match(/#[0-9]+/)) return 'attributeName';
    if (stream.match(/!?\{/)) return 'bracket';
    if (stream.match(/[{}()[\],]/)) return 'bracket';
    if (stream.match(/%[-a-zA-Z$._0-9]+/)) return 'variableName';
    if (stream.match(/@[-a-zA-Z$._0-9]+/)) return 'className';
    if (
      stream.match(
        /[-+]?(?:0x[0-9a-fA-F]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)/,
      )
    )
      return 'number';
    if (stream.match(/[a-zA-Z_][\w.]*/)) {
      const word = stream.current();
      if (keywords.has(word)) return 'keyword';
      if (types.has(word) || /^(?:i\d+|v\d+i\d+|x\d+i\d+|<\d+ x)/.test(word))
        return 'typeName';
      if (attributes.has(word)) return 'attributeName';
      if (stream.peek() === ':') return 'labelName';
      return null;
    }
    if (stream.match(/[=<>!+\-*\/|&^~]+/)) return 'operator';
    stream.next();
    return null;
  },
});

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
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        errorLineField,
        llvmIR,
        syntaxHighlighting(highlightStyle),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

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
