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

function baseExtensions () {
  return [basicSetup, oneDark]
}

/**
 * Mount a single EditorView. The same view is reused for the whole session;
 * `setFile` swaps its state instead of recreating it.
 */
export function mount (parent) {
  const view = new EditorView({
    state: EditorState.create({ extensions: baseExtensions() }),
    parent
  })

  return {
    view,

    async setFile ({ content = '', language = null } = {}) {
      const languageExtension = await loadLanguage(language)

      view.setState(EditorState.create({
        doc: content,
        extensions: [...baseExtensions(), ...languageExtension]
      }))
    },

    getContent () {
      return view.state.doc.toString()
    },

    destroy () {
      view.destroy()
    }
  }
}
