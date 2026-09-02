import type { Header, ReactTable, Row } from '@tanstack/react-table';
import type { logTableFeatures } from './features';
import type { LogEntry } from './types';

/** The table instance, named once so the pieces below can take it as a prop. */
export type LogTableInstance = ReactTable<typeof logTableFeatures, LogEntry>;
export type LogTableRow = Row<typeof logTableFeatures, LogEntry>;
export type LogTableHeader = Header<typeof logTableFeatures, LogEntry>;
