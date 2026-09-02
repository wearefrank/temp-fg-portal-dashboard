import styles from './LokiLogTable.module.css';

const PAGE_SIZES = [25, 50, 100];

interface PageSizeSelectProps {
    value: number;
    onChange: (size: number) => void;
}

export const PageSizeSelect = ({ value, onChange }: PageSizeSelectProps) => (
    <select
        className={styles.pageSize}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        aria-label="Rows per page"
    >
        {PAGE_SIZES.map(size => <option key={size} value={size}>{size} / page</option>)}
    </select>
);
