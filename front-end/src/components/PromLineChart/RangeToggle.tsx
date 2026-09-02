import { RANGE_OPTIONS, type RangeLabel } from './promRange';
import styles from './PromLineChart.module.css';

interface RangeToggleProps {
    value: RangeLabel;
    onChange: (label: RangeLabel) => void;
}

export const RangeToggle = ({ value, onChange }: RangeToggleProps) => (
    <div className={styles.rangeToggle}>
        {RANGE_OPTIONS.map(option => (
            <button
                key={option.label}
                type="button"
                className={`${styles.rangeBtn} ${value === option.label ? styles.rangeBtnActive : ''}`}
                onClick={() => onChange(option.label)}
            >
                {option.label}
            </button>
        ))}
    </div>
);
