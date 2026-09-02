import { useState } from 'react';
import styles from './LokiLogTable.module.css';

export interface ColumnToggle {
    id: string;
    label: string;
    visible: boolean;
    toggle: () => void;
}

interface ColumnsMenuProps {
    columns: ColumnToggle[];
}

/** Which columns are drawn. Owns whether it is open; nothing outside needs to know. */
export const ColumnsMenu = ({ columns }: ColumnsMenuProps) => {
    const [open, setOpen] = useState(false);

    return (
        <div className={styles.columnsMenuWrap}>
            <button
                className={styles.toolbarBtn}
                type="button"
                onClick={() => setOpen(current => !current)}
                aria-expanded={open}
            >
                Columns ▾
            </button>
            {open && (
                <div className={styles.columnsMenu}>
                    {columns.map(column => (
                        <label key={column.id} className={styles.columnsMenuItem}>
                            <input type="checkbox" checked={column.visible} onChange={column.toggle} />
                            {column.label}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};
