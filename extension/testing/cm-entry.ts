import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
// @ts-expect-error codemirror does not declare package.json in exports
import cmPkg from 'codemirror/package.json';

if (typeof window !== 'undefined') {
  (window as unknown as { CodeMirror: unknown }).CodeMirror = {
    EditorView,
    EditorState,
    basicSetup,
    version: cmPkg.version || '6.0.2',
  };
}

export { EditorView, EditorState, basicSetup };
