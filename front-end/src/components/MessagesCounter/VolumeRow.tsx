import { formatWindow, type MessageVolume } from './messageVolume';
import styles from './MessagesCounter.module.css';

interface VolumeRowProps {
    label: string;
    volume: MessageVolume | null;
    comparedTo: string;
}

/** One "label — count, delta" line under the headline. */
export const VolumeRow = ({ label, volume, comparedTo }: VolumeRowProps) => (
    <div className={styles.secondary}>
        <span className={styles.caption}>{label}</span>
        <span className={styles.rowValue}>
            <span className={styles.secondaryValue}>
                {/* Like the headline: a refresh keeps the number it already has. */}
                {volume == null ? '—' : volume.current.toLocaleString()}
            </span>
            {volume && <Delta volume={volume} comparedTo={comparedTo} />}
        </span>
    </div>
);

/**
 * The change against the previous window. Coloured by direction rather than by good/bad: more
 * traffic through the gateway is not inherently either.
 */
const Delta = ({ volume, comparedTo }: { volume: MessageVolume; comparedTo: string }) => {
    if (volume.changePercent == null) return null;

    const { arrow, tone } = direction(volume.changePercent);
    const size = Math.abs(volume.changePercent).toLocaleString(undefined, { maximumFractionDigits: 1 });

    return (
        <span
            className={`${styles.delta} ${tone}`}
            title={`${volume.previous.toLocaleString()} in the previous ${formatWindow(volume.windowSeconds)}`}
        >
            {arrow} {size}%
            <span className={styles.deltaSuffix}> vs {comparedTo}</span>
        </span>
    );
};

function direction(changePercent: number): { arrow: string; tone: string } {
    if (changePercent === 0) return { arrow: '', tone: styles.deltaFlat };
    if (changePercent > 0) return { arrow: '▲', tone: styles.deltaUp };
    return { arrow: '▼', tone: styles.deltaDown };
}
