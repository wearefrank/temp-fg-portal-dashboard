/** Shape of GET /logs/count. */
export interface LogCount {
    count: number;
    query: string;
    /** The span the count covers. Resolved server-side, so it is the only word on it. */
    windowSeconds: number;
}

/** Shape of GET /logs/volume - two adjacent windows counted out of Loki. */
export interface MessageVolume {
    current: number;
    previous: number;
    /** null when the previous window counted nothing; see MessageVolumeDto. */
    changePercent: number | null;
    windowSeconds: number;
    query: string;
}

/** A URL with the search filter attached only when there is one. */
export function countEndpoint(path: string, params: Record<string, string>, search: string): string {
    const query = new URLSearchParams(params);
    if (search) query.set('search', search);
    const text = query.toString();
    return text ? `${path}?${text}` : path;
}

/**
 * Why the comparison is missing. Both cases arrive as previous === 0 and are worth telling
 * apart: an idle gateway is a real answer, whereas a window older than Loki's retention means
 * the data was never there to count.
 */
export function noComparisonReason(volume: MessageVolume): string {
    return volume.current === 0
        ? 'no messages in either week'
        : 'no comparison — nothing logged in the previous week yet';
}

/** Seconds as plain English; whole days above a day. */
export function formatWindow(seconds: number): string {
    const days = Math.round(seconds / 86_400);
    if (days >= 1) return days === 1 ? 'day' : `${days} days`;
    const hours = Math.round(seconds / 3_600);
    return hours === 1 ? 'hour' : `${hours} hours`;
}
