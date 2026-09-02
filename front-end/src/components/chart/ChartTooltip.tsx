import styles from './ChartTooltip.module.css';

/** One "colour, label, value" line in the tooltip. */
export interface ChartTooltipEntry {
    key: string;
    label: string;
    color: string;
    value: number;
}

interface ChartTooltipProps {
    active?: boolean;
    header: string;
    entries: ChartTooltipEntry[];
}

/** The tooltip every chart on the dashboard uses, so hovering reads the same everywhere. */
export const ChartTooltip = ({ active, header, entries }: ChartTooltipProps) => {
    if (!active || entries.length === 0) return null;

    return (
        <div className={styles.tooltipContainer}>
            <div className={styles.tooltipHeader}>{header}</div>
            <div className={styles.tooltipBody}>
                {entries.map(entry => (
                    <div key={entry.key} className={styles.tooltipRow}>
                        <span className={styles.tooltipRowLabel}>
                            <span className={styles.tooltipDot} style={{ background: entry.color }} />
                            {entry.label}
                        </span>
                        <strong className={styles.tooltipValue}>{entry.value.toLocaleString()}</strong>
                    </div>
                ))}
            </div>
        </div>
    );
};
