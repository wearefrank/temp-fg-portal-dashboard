import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import { type MonacoYaml } from 'monaco-yaml';
import { type ValidationLog } from '../../../../actions/ValidationLogger';
import { parseYamlDoc, resolvePathToNode, buildCategoryLineMap, type ParsedDoc } from '../../yamlLineUtils';
import { beforeMount, getMonacoTheme, monacoYamlInstance } from './monacoThemes';
import { pushSchema } from './monacoSchemaSync';
import { CATEGORY_DEFINITIONS } from '../../../../config/categoryDefinitions';
import type { ApisixConfig, SchemaCatalog } from '../../../../actions/SchemaValidation';
import type { DesignerSettings } from '../../../../hooks/useDesignerSettings';
import { useEditorDecorations, type LogEntry } from './useEditorDecorations';
import { useEditorProviders } from '../providers/useEditorProviders';
import { useCursorWidgets } from '../widgets/useCursorWidgets';
import { useIdTemplateWidget } from '../widgets/idTemplateWidget/useIdTemplateWidget';
import { buildErrorAnnotations, buildReferenceAnnotations, buildIdLineMap } from './configEditorAnnotations';
import styles from '../../YamlEditor.module.css';
import '../../monacoStyles.css';

interface ConfigEditorProps {
    configText: string;
    showWhitespace: boolean;
    fillDefaults: boolean;
    validConfig: boolean;
    yamlValid: boolean;
    validationLogs?: ValidationLog[];
    config?: ApisixConfig | null;
    schema?: SchemaCatalog | null;
    designerSettings?: DesignerSettings;
    onConfigChange: (newValue: string) => void;
    onToggleWhitespace: () => void;
    onToggleFillDefaults: () => void;
    onLineClick?: (log: ValidationLog) => void;
    scrollToTarget?: { path: string; key: number } | null;
}

export const ConfigEditor = ({
    configText,
    showWhitespace,
    fillDefaults,
    validConfig,
    yamlValid,
    validationLogs = [],
    config,
    schema,
    designerSettings,
    onConfigChange,
    onToggleWhitespace,
    onToggleFillDefaults,
    onLineClick,
    scrollToTarget,
}: ConfigEditorProps) => {
    // Editor instances
    const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof MonacoType | null>(null);
    const monacoYamlRef = useRef<MonacoYaml | null>(null);

    // Stable values for event callbacks
    const schemaRef = useRef<SchemaCatalog | null | undefined>(schema);
    const configRef = useRef<ApisixConfig | null | undefined>(config);
    const parsedDocRef = useRef<ParsedDoc | null>(null);
    const designerSettingsRef = useRef<DesignerSettings | null | undefined>(designerSettings);

    // Callback refs (prevent stale closures in Monaco event handlers)
    const onLineClickRef = useRef(onLineClick);
    const scrollToTargetRef = useRef(scrollToTarget);

    // Snapshot refs for Monaco scroll and provider callbacks
    const categoryLineMapRef = useRef<Map<number, string>>(new Map());
    const referenceTargetMapRef = useRef<Map<number, string>>(new Map());
    const referenceValueRangesRef = useRef<Map<number, { startCol: number; endCol: number }>>(new Map());
    const idLineMapRef = useRef<Map<number, { category: string; idValue: string | number }>>(new Map());

    const [visibleCategory, setVisibleCategory] = useState<string | null>(null);
    const [monacoTheme, setMonacoTheme] = useState(getMonacoTheme);
    const [settingsOpen, setSettingsOpen] = useState(false);

    // Derived data

    const parsedDoc = useMemo(() => {
        if (!configText) return null;
        try { return parseYamlDoc(configText); }
        catch { return null; }
    }, [configText]);

    const categoryLineMap = useMemo(() => {
        if (!parsedDoc) return new Map<number, string>();
        return buildCategoryLineMap(parsedDoc.doc, parsedDoc.lineCounter);
    }, [parsedDoc]);

    const categoryStartLines = useMemo(() => {
        const starts = new Map<string, number>();
        for (const [line, cat] of categoryLineMap) {
            const existing = starts.get(cat);
            if (existing === undefined || line < existing) starts.set(cat, line);
        }
        return starts;
    }, [categoryLineMap]);

    const { errorEntries, warningEntries, syntaxErrorOffsets } = useMemo(() => {
        if (!parsedDoc) return {
            errorEntries: [] as LogEntry[],
            warningEntries: [] as LogEntry[],
            syntaxErrorOffsets: [] as number[],
        };
        return buildErrorAnnotations(parsedDoc, validationLogs);
    }, [parsedDoc, validationLogs]);

    const { referenceHintMap, referenceTargetMap, referenceValueRanges } = useMemo(() => {
        const empty = {
            referenceHintMap: new Map<number, string>(),
            referenceTargetMap: new Map<number, string>(),
            referenceValueRanges: new Map<number, { startCol: number; endCol: number }>(),
        };
        if (!parsedDoc || !config) return empty;
        return buildReferenceAnnotations(parsedDoc, config);
    }, [parsedDoc, config]);

    const idLineMap = useMemo(() => {
        if (!parsedDoc || !config) return new Map<number, { category: string; idValue: string | number }>();
        return buildIdLineMap(parsedDoc, config);
    }, [parsedDoc, config]);

    // Keep refs current for Monaco event callbacks (these give errors of not set)

    useEffect(() => { onLineClickRef.current = onLineClick; }, [onLineClick]);
    useEffect(() => { scrollToTargetRef.current = scrollToTarget; }, [scrollToTarget]);
    useEffect(() => { configRef.current = config; }, [config]);
    useEffect(() => { designerSettingsRef.current = designerSettings; }, [designerSettings]);
    useEffect(() => { parsedDocRef.current = parsedDoc; }, [parsedDoc]);
    useEffect(() => { categoryLineMapRef.current = categoryLineMap; }, [categoryLineMap]);
    useEffect(() => { referenceTargetMapRef.current = referenceTargetMap; }, [referenceTargetMap]);
    useEffect(() => { referenceValueRangesRef.current = referenceValueRanges; }, [referenceValueRanges]);
    useEffect(() => { idLineMapRef.current = idLineMap; }, [idLineMap]);

    // Watch for data-theme attribute changes to switch Monaco theme
    useEffect(() => {
        const observer = new MutationObserver(() => setMonacoTheme(getMonacoTheme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    // Push schema updates to the YAML language service
    useEffect(() => {
        schemaRef.current = schema;
        if (!schema || !monacoYamlRef.current) return;
        pushSchema(monacoYamlRef.current, schema);
    }, [schema]);

    useEffect(() => {
        editorRef.current?.updateOptions({ renderWhitespace: showWhitespace ? 'all' : 'none' });
    }, [showWhitespace]);

    useEffect(() => {
        if (!scrollToTarget || !editorRef.current) return;
        const doc = parsedDocRef.current;
        if (!doc) return;
        const node = resolvePathToNode(doc.doc, scrollToTarget.path);
        if (!node?.range) return;
        const line = doc.lineCounter.linePos(node.range[0]).line;
        editorRef.current.revealLineInCenter(line);
    }, [scrollToTarget]);

    // Decoration and provider hooks

    const { initCollections, errorLineLogMapRef, warningLineLogMapRef } = useEditorDecorations(
        editorRef,
        monacoRef,
        { errorEntries, warningEntries, syntaxErrorOffsets, categoryLineMap, configText, referenceHintMap, referenceValueRanges },
    );

    const { registerProviders } = useEditorProviders(
        schemaRef,
        configRef,
        parsedDocRef,
        referenceValueRangesRef,
        referenceTargetMapRef,
        idLineMapRef,
    );

    // Cursor-triggered Monaco widgets
    const idTemplateWidgetDef = useIdTemplateWidget(designerSettingsRef);
    const cursorWidgetDefs = useMemo(() => [idTemplateWidgetDef], [idTemplateWidgetDef]);
    const { registerCursorWidgets } = useCursorWidgets(cursorWidgetDefs);

    // Editor mount

    const handleMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // monacoYamlInstance was already initialized in beforeMount; just grab the reference.
        // If schema loaded before the editor mounted, push it now.
        monacoYamlRef.current = monacoYamlInstance;
        const initialSchema = schemaRef.current;
        if (initialSchema && monacoYamlRef.current) {
            pushSchema(monacoYamlRef.current, initialSchema);
        }

        document.fonts.ready.then(() => editor.layout());

        // If a scroll target was queued before the editor finished mounting, apply it now.
        const pending = scrollToTargetRef.current;
        const doc = parsedDocRef.current;
        if (pending && doc) {
            const node = resolvePathToNode(doc.doc, pending.path);
            if (node?.range) {
                const line = doc.lineCounter.linePos(node.range[0]).line;
                editor.revealLineInCenter(line);
            }
        }

        initCollections(editor, monaco);
        registerProviders(monaco);
        registerCursorWidgets(editor, monaco);

        editor.onDidScrollChange(() => {
            const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
            if (lineHeight <= 0) return;
            const topLine = Math.ceil(editor.getScrollTop() / lineHeight) + 1;
            setVisibleCategory(categoryLineMapRef.current.get(topLine) ?? null);
        });

        editor.onMouseDown((e) => {
            const line = e.target.position?.lineNumber;
            if (!line) return;
            const isGutter =
                e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
                e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;
            if (isGutter) {
                const logs = errorLineLogMapRef.current.get(line) ?? warningLineLogMapRef.current.get(line);
                if (logs?.length) onLineClickRef.current?.(logs[0]);
            }
            if ((e.event.ctrlKey || e.event.metaKey) && idLineMapRef.current.has(line)) {
                editor.setPosition(e.target.position!);
                editor.trigger('mouse', 'editor.action.referenceSearch.trigger', {});
            }
        });
    }, [initCollections, registerProviders, registerCursorWidgets, errorLineLogMapRef, warningLineLogMapRef, idLineMapRef]);

    const handleJumpToCategory = useCallback((category: string) => {
        const line = categoryStartLines.get(category);
        if (line === undefined || !editorRef.current) return;
        editorRef.current.revealLineInCenter(line);
    }, [categoryStartLines]);

    // Render

    let statusClass: string | null = null;
    let statusLabel: string | null = null;
    if (configText) {
        if (!yamlValid) { statusClass = styles.statusError; statusLabel = 'YAML error'; }
        else if (!validConfig) { statusClass = styles.statusWarning; statusLabel = 'Has errors'; }
        else { statusClass = styles.statusValid; statusLabel = 'Valid'; }
    }

    return (
        <div className={`card flex flex-column ${styles.configCard} ${!validConfig ? styles.configCardInvalid : ''}`}>
            <div className="card-header flex align-center gap-sm">
                Parsed Configuration
                {statusClass && <span className={statusClass}>{statusLabel}</span>}
                <span className="text-small text-muted" style={{ marginLeft: 'auto' }}>
                    Ctrl+Space for autocomplete - f1 for command palette
                </span>
                <button
                    className={`text-small ${styles.btnIcon} ${styles.settingsToggle}`}
                    onClick={() => setSettingsOpen(o => !o)}
                    title="Editor settings"
                >
                    ⚙
                </button>
            </div>

            {settingsOpen && (
                <div className={styles.editorToolbar}>
                    <button
                        className={showWhitespace ? `btn-primary text-small ${styles.btnIcon}` : `text-small ${styles.btnIcon}`}
                        onClick={onToggleWhitespace}
                        title="Show Whitespace"
                    >
                        {showWhitespace ? 'Hide Whitespaces' : 'Show Whitespaces'}
                    </button>
                    <button
                        className={fillDefaults ? `btn-primary text-small ${styles.btnIcon}` : `text-small ${styles.btnIcon}`}
                        onClick={onToggleFillDefaults}
                        title="Fill in Defaults"
                    >
                        {fillDefaults ? "Don't fill defaults" : 'Fill defaults'}
                    </button>
                </div>
            )}

            <div
                className={styles.categoryBanner}
                style={visibleCategory ? { borderLeftColor: CATEGORY_DEFINITIONS[visibleCategory]?.color } : undefined}
            >
                <span>{visibleCategory ? CATEGORY_DEFINITIONS[visibleCategory]?.label : ''}</span>
                {categoryStartLines.size > 0 && (
                    <div className={styles.categoryNavPills}>
                        {[...categoryStartLines.keys()].map(cat => {
                            const def = CATEGORY_DEFINITIONS[cat];
                            const isActive = cat === visibleCategory;
                            return (
                                <button
                                    key={cat}
                                    className={isActive ? styles.categoryNavPillActive : styles.categoryNavPill}
                                    style={{ '--pill-color': def?.color } as React.CSSProperties}
                                    onClick={() => handleJumpToCategory(cat)}
                                >
                                    {def?.label ?? cat}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className={styles.monacoWrapper}>
                <Editor
                    language="yaml"
                    path="apisix-config.yaml"
                    value={configText}
                    theme={monacoTheme}
                    beforeMount={beforeMount}
                    onMount={handleMount}
                    onChange={(v) => onConfigChange(v ?? '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineHeight: 21,
                        fontFamily: "'JetBrains Mono', monospace",
                        renderWhitespace: showWhitespace ? 'all' : 'none',
                        scrollBeyondLastLine: false,
                        wordWrap: 'off',
                        lineDecorationsWidth: 4,
                        glyphMargin: false,
                        folding: true,
                        foldingStrategy: 'indentation',
                        automaticLayout: true,
                        overviewRulerBorder: false,
                        overviewRulerLanes: 0,
                        hideCursorInOverviewRuler: true,
                        wordBasedSuggestions: 'off',
                        quickSuggestions: { other: true, comments: false, strings: true },
                        suggestOnTriggerCharacters: true,
                        scrollbar: { vertical: 'auto', horizontal: 'auto' },
                        links: false,
                        stickyScroll: { enabled: false },
                    }}
                />
            </div>
        </div>
    );
};
