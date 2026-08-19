import { configureMonacoYaml, type MonacoYaml } from 'monaco-yaml';
import type { BeforeMount } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';

// Singleton - configureMonacoYaml registers language features globally and must run once,
// before any editor model is created. The instance is read back in handleMount.
export let monacoYamlInstance: MonacoYaml | null = null;

export function getMonacoTheme(): string {
    const saved = localStorage.getItem('theme');
    const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDark ? 'fedgw-dark' : 'fedgw-light';
}

// The built-in YAML tokenizer gives quoted and unquoted values the same 'string.yaml'
// token, so a custom Monarch tokenizer is the only way to style them differently.
// See: https://microsoft.github.io/monaco-editor/monarch.html
const YAML_TOKENIZER: MonacoType.languages.IMonarchLanguage = {
    defaultToken: '',

    keywords: ['true', 'false', 'null', '~'],

    tokenizer: {
        root: [
            { include: '@whitespace' },

            // Document markers
            [/---/, 'keyword'],
            [/\.\.\./, 'keyword'],

            // Keys: word chars before ": " or ":" at end of line
            [/\w[\w\-. ]*(?=\s*:(?:\s|$))/, 'type.yaml'],

            // Strings
            [/"([^"\\]|\\.)*$/, 'string.invalid'],
            [/"/, { token: 'string.quoted.yaml', next: '@dqstring' }],
            [/'[^']*'/, 'string.quoted.yaml'],

            // Numbers
            [/0x[\da-fA-F]+/, 'number'],
            [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'number'],

            // Block scalar indicators
            [/[|>][-+]?\d*/, 'keyword'],

            // Keywords (booleans, null)
            [/\S+/, { cases: { '@keywords': 'keyword', '@default': '' } }],
        ],

        dqstring: [
            [/[^"\\]+/, 'string.quoted.yaml'],
            [/\\./, 'string.quoted.yaml'],
            [/"/, { token: 'string.quoted.yaml', next: '@pop' }],
        ],

        whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/#.*$/, 'comment'],
        ],
    },
};

const DARK_THEME: MonacoType.editor.IStandaloneThemeData = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: 'type.yaml',          foreground: 'd4916a' },
        { token: 'string.quoted.yaml', foreground: '98c379' },
        { token: 'comment',            foreground: '777777' },
        { token: 'keyword',            foreground: 'd4916a' },
        { token: 'number',             foreground: 'e5c07b' },
    ],
    colors: {
        'editor.background':                  '#252525',
        'editor.foreground':                  '#eeeeee',
        'editorLineNumber.foreground':         '#555555',
        'editorLineNumber.activeForeground':   '#aaaaaa',
        'editor.lineHighlightBackground':      '#2d2d2d',
        'editorCursor.foreground':             '#eeeeee',
        'editor.selectionBackground':          '#3a3a5a',
        'editorIndentGuide.background1':       '#333333',
        'editorIndentGuide.activeBackground1': '#555555',
        'scrollbarSlider.background':          '#ffffff22',
        'scrollbarSlider.hoverBackground':     '#ffffff44',
    },
};

const LIGHT_THEME: MonacoType.editor.IStandaloneThemeData = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: 'type.yaml',   foreground: 'd4916a' },
        { token: 'string.quoted.yaml', foreground: '4e9a5e' },
        { token: 'comment',     foreground: '888888' },
        { token: 'keyword',     foreground: 'd4916a' },
        { token: 'number',      foreground: 'a67d3d' },
    ],
    colors: {
        'editor.background':                  '#ffffff',
        'editor.foreground':                  '#212529',
        'editorLineNumber.foreground':         '#aaaaaa',
        'editorLineNumber.activeForeground':   '#495057',
        'editor.lineHighlightBackground':      '#f1f3f5',
        'editor.selectionBackground':          '#dae4f0',
        'scrollbarSlider.background':          '#00000022',
        'scrollbarSlider.hoverBackground':     '#00000044',
    },
};

export const beforeMount: BeforeMount = (monaco) => {
    if (!monacoYamlInstance) {
        // Defensive: monaco-yaml's providers reject when their worker is unreachable, so wrap
        // provideHover to return null instead of throwing.
        const origRegisterHover = monaco.languages.registerHoverProvider.bind(monaco.languages);
        (monaco.languages as unknown as Record<string, unknown>).registerHoverProvider = (
            selector: Parameters<typeof monaco.languages.registerHoverProvider>[0],
            provider: Parameters<typeof monaco.languages.registerHoverProvider>[1],
        ) => {
            const orig = provider.provideHover?.bind(provider);
            if (orig) {
                provider.provideHover = async (...args: Parameters<typeof orig>) => {
                    try {
                        return await orig(...args);
                    } catch {
                        return null;
                    }
                };
            }
            return origRegisterHover(selector, provider);
        };

        // Same guard as hover above, for doDefinition - return undefined instead of throwing.
        const origRegisterDefinition = monaco.languages.registerDefinitionProvider.bind(monaco.languages);
        (monaco.languages as unknown as Record<string, unknown>).registerDefinitionProvider = (
            selector: Parameters<typeof monaco.languages.registerDefinitionProvider>[0],
            provider: Parameters<typeof monaco.languages.registerDefinitionProvider>[1],
        ) => {
            const orig = provider.provideDefinition?.bind(provider);
            if (orig) {
                provider.provideDefinition = async (...args: Parameters<typeof orig>) => {
                    try {
                        return await orig(...args);
                    } catch {
                        return undefined;
                    }
                };
            }
            return origRegisterDefinition(selector, provider);
        };

        // Same guard as hover above, for getCodeAction - return no actions instead of throwing.
        const origRegister = monaco.languages.registerCodeActionProvider.bind(monaco.languages);
        (monaco.languages as unknown as Record<string, unknown>).registerCodeActionProvider = (
            selector: Parameters<typeof monaco.languages.registerCodeActionProvider>[0],
            provider: Parameters<typeof monaco.languages.registerCodeActionProvider>[1],
        ) => {
            const orig = provider.provideCodeActions?.bind(provider);
            if (orig) {
                provider.provideCodeActions = async (...args: Parameters<typeof orig>) => {
                    try {
                        return await orig(...args);
                    } catch {
                        return { actions: [], dispose: () => {} };
                    }
                };
            }
            return origRegister(selector, provider);
        };

        // fileMatch ['**'] matches any URI including in-memory models
        // (e.g. inmemory://model/apisix-config.yaml). Schema starts empty
        // and is pushed via update() once ConfigEditor receives the catalog.
        // format stays off: useEditorProviders.ts registers a prettier formatter instead,
        // so the editor formats the same way the rest of the toolchain does.
        monacoYamlInstance = configureMonacoYaml(monaco as never, {
            validate: false,
            completion: false,
            format: { enable: false },
            schemas: [],
        });

        monaco.languages.registerCodeActionProvider = origRegister;
        monaco.languages.registerHoverProvider = origRegisterHover;
        monaco.languages.registerDefinitionProvider = origRegisterDefinition;

        monaco.languages.setMonarchTokensProvider('yaml', YAML_TOKENIZER);
    }
    monaco.editor.defineTheme('fedgw-dark', DARK_THEME);
    monaco.editor.defineTheme('fedgw-light', LIGHT_THEME);
};
