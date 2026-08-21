import { EditorState } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { languages } from '@codemirror/language-data'

/**
 * Resolve a CodeMirror language extension by `@codemirror/language-data` name.
 * Modes are loaded on demand rather than bundled up front.
 */
async function loadLanguage (name) {
  if (!name) return []

  const description = languages.find((lang) => lang.name === name)
  if (!description) return []

  const support = await description.load()
  return [support]
}

function baseExtensions (handle) {
  return [
    basicSetup,
    oneDark,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && typeof handle.onChange === 'function') {
        handle.onChange(update.state.doc.toString())
      }

      if (
        (update.selectionSet || update.docChanged) &&
        typeof handle.onCursor === 'function'
      ) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        handle.onCursor({ line: line.number, col: pos - line.from + 1 })
      }
    })
  ]
}

/**
 * Mount a single EditorView. The same view is reused for the whole session;
 * `setFile` swaps its state instead of recreating it. `handle.onChange` can be
 * set by the caller to be notified of document edits (used for dirty tracking).
 */
export function mount (parent) {
  const handle = { onChange: null }

  const view = new EditorView({
    state: EditorState.create({ extensions: baseExtensions(handle) }),
    parent
  })

  handle.view = view

  handle.setFile = async ({ content = '', language = null } = {}) => {
    const languageExtension = await loadLanguage(language)

    view.setState(EditorState.create({
      doc: content,
      extensions: [...baseExtensions(handle), ...languageExtension]
    }))

    // A new file should be read from the top, not inherit the previous
    // document's scroll offset.
    view.scrollDOM.scrollTop = 0

    // setState does not fire an update, so report the reset cursor explicitly.
    if (typeof handle.onCursor === 'function') {
      handle.onCursor({ line: 1, col: 1 })
    }
  }

  handle.getContent = () => view.state.doc.toString()

  handle.destroy = () => view.destroy()

  return handle
}
