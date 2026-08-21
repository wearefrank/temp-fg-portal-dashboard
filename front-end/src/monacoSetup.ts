import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
// yaml.worker.js is ESM and still imports bare specifiers (vscode-uri, yaml, ...),
// so it has to go through Vite's ?worker bundling. Serving it by ?url instead makes
// the worker fail on its first import, which is why its language features never worked.
import YamlWorker from 'monaco-yaml/yaml.worker.js?worker';

// Use the locally-installed monaco-editor package instead of CDN so that
// monaco-yaml workers are built against the same Monaco version as the editor.
loader.config({ monaco });

// Provide web workers for Monaco's language services.
window.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
        if (label === 'yaml') return new YamlWorker();
        return new EditorWorker();
    },
};
