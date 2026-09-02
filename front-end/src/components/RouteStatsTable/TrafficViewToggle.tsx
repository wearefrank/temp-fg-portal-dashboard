import type { View } from './trafficChartData';
import styles from './RouteStatsTable.module.css';

const VIEWS: { value: View; label: string; title: string }[] = [
    { value: 'status', label: 'By status', title: 'Stacked by status class — what broke, and when' },
    { value: 'route', label: 'By route', title: 'One line per route — what went quiet, and when' },
];

interface TrafficViewToggleProps {
    value: View;
    onChange: (view: View) => void;
    disabled: boolean;
}

export const TrafficViewToggle = ({ value, onChange, disabled }: TrafficViewToggleProps) => (
    <div className={styles.viewToggle}>
        {VIEWS.map(view => (
            <button
                key={view.value}
                type="button"
                className={`${styles.viewBtn} ${value === view.value ? styles.viewBtnActive : ''}`}
                onClick={() => onChange(view.value)}
                disabled={disabled}
                title={view.title}
            >
                {view.label}
            </button>
        ))}
        <span className={`text-small text-muted ${styles.zoomHint}`}>
            click a bucket or drag across the chart to zoom
        </span>
    </div>
);
