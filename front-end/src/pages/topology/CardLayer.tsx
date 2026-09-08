import React from 'react';
import {Link} from 'react-router-dom';
import {useViewport} from '@xyflow/react';
import type {Edge} from '@xyflow/react';
import {dump} from 'js-yaml';
import type {ConfigNodeData} from './buildTopology';
import {CATEGORY_COLOR, CATEGORY_LABEL} from './ConfigNode';
import { getDisplayId } from '../../config/categoryDefinitions';
import styles from './TopologyPage.module.css';

export type DetailCard = {
    id: string;
    data: ConfigNodeData;
    x: number; // flow-space coordinates
    y: number;
    scale: number;
};

type CardLayerProps = {
    cards: DetailCard[];
    edges: Edge[];
    closeCard: (id: string) => void;
    onHeaderMouseDown: (e: React.MouseEvent, id: string) => void;
    onResizeMouseDown: (e: React.MouseEvent, id: string) => void;
    /** Off for the live view, where nodes have no matching entry in the edited config. */
    showEditorLinks?: boolean;
    /** Short warning shown above the YAML, e.g. that this isn't the config file. */
    notice?: string;
};

export function CardLayer({
    cards, edges, closeCard, onHeaderMouseDown, onResizeMouseDown,
    showEditorLinks = true, notice,
}: CardLayerProps) {
    const {x: vpX, y: vpY, zoom} = useViewport();

    return (
        <div className={styles.cardStack}>
            {cards.map(card => {
                const color     = CATEGORY_COLOR[card.data.category] ?? '#64748b';
                const label     = CATEGORY_LABEL[card.data.category] ?? card.data.category;
                const entry     = card.data.entry as Record<string, unknown>;
                const title     = getDisplayId(card.data.category, entry) || '—';
                const edgeCount = edges.filter(e => e.source === card.id || e.target === card.id).length;
                const yamlText  = dump(entry, {indent: 2, noRefs: true});

                // card.id has format `${category}-${displayId}` (built with the correct index in buildTopology).
                // Strip the category prefix to recover the exact display ID that getCategoryEntry uses for lookup.
                const focusId = encodeURIComponent(card.id.slice(card.data.category.length + 1));
                const configFocusHref = `/yamlEditor?focusCategory=${card.data.category}&focusId=${focusId}`;

                // Convert flow-space position to screen-space
                const sx = card.x * zoom + vpX;
                const sy = card.y * zoom + vpY;

                return (
                    <div key={card.id} className={styles.detailCard}
                         style={{left: sx, top: sy, transform: `scale(${zoom * card.scale})`, transformOrigin: 'top left'}}>
                        <div className={styles.cardHeader} style={{background: color}}
                             onMouseDown={e => onHeaderMouseDown(e, card.id)}>
                            <span className={styles.cardCategory}>{label}</span>
                            <button className={styles.cardCloseBtn} onClick={() => closeCard(card.id)}>✕</button>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.cardTitle}>{title}</div>
                            {edgeCount > 0 && (
                                <div className={styles.cardMeta}>{edgeCount} connection{edgeCount !== 1 ? 's' : ''}</div>
                            )}
                            {notice && <CardNotice text={notice}/>}
                            <pre className={styles.cardYaml}>{yamlText}</pre>
                        </div>
                        {showEditorLinks && (
                            <div className={styles.cardActions}>
                                <div className={styles.cardActionsLabel}>Open in</div>
                                <div className={styles.cardActionsBtns}>
                                    <Link to={configFocusHref} className={styles.cardActionBtn}>YAML Editor</Link>
                                    <Link to={`/designer?category=${card.data.category}&focusId=${focusId}`} className={styles.cardActionBtn}>Config Designer</Link>
                                </div>
                            </div>
                        )}
                        <div className={styles.cardResizeFooter} onMouseDown={e => onResizeMouseDown(e, card.id)}>
                            <svg width="10" height="10" viewBox="0 0 10 10" className={styles.cardResizeIcon}>
                                <line x1="3" y1="10" x2="10" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                <line x1="6" y1="10" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** Small warning line inside a detail card. */
function CardNotice({text}: {text: string}) {
    return (
        <div className={styles.cardNotice} role="note">
            <span className={styles.cardNoticeIcon} aria-hidden="true">⚠</span>
            <span>{text}</span>
        </div>
    );
}
