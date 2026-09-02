/**
 * Series colours and dash patterns, shared by every chart and status badge on the dashboard,
 * so a 502 is the same red wherever it appears.
 */

export interface SeriesMaps {
    colorMap: Record<string, string>;
    dashMap: Record<string, string>;
}

// One ramp per status family, so 500/502/503 arrive as distinguishable reds.
const CODE_FAMILY_PALETTES: Record<string, string[]> = {
    '2': ['#22c55e', '#16a34a', '#65a30d', '#0d9488', '#15803d'],
    '3': ['#3b82f6', '#0ea5e9', '#6366f1', '#2563eb', '#8b5cf6'],
    '4': ['#f97316', '#f59e0b', '#eab308', '#ea580c', '#e11d48'],
    '5': ['#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'],
};

// For codes outside 2xx-5xx.
const FALLBACK_COLORS = ['#94a3b8', '#64748b', '#475569'];

const GENERIC_PALETTE = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#f59e0b', '#84cc16'];

export const DASH_PATTERNS = ['', '6 3', '2 3', '8 3 2 3', '4 2 2 2'];

/** Colours status codes by family, so the class is readable before the exact code is. */
export function buildCodeMaps(codes: string[]): SeriesMaps {
    const familyCounters: Record<string, number> = {};
    const colorMap: Record<string, string> = {};
    const dashMap: Record<string, string> = {};

    for (const code of [...codes].sort()) {
        const family = code[0];
        const palette = CODE_FAMILY_PALETTES[family] ?? FALLBACK_COLORS;
        const index = familyCounters[family] ?? 0;
        colorMap[code] = palette[index % palette.length];
        dashMap[code] = DASH_PATTERNS[index % DASH_PATTERNS.length];
        familyCounters[family] = index + 1;
    }

    return { colorMap, dashMap };
}

/** For series that are not status codes - routes, say - in the same order and style. */
export function buildGenericMaps(keys: string[]): SeriesMaps {
    const colorMap: Record<string, string> = {};
    const dashMap: Record<string, string> = {};

    keys.forEach((key, i) => {
        colorMap[key] = GENERIC_PALETTE[i % GENERIC_PALETTE.length];
        dashMap[key] = DASH_PATTERNS[i % DASH_PATTERNS.length];
    });

    return { colorMap, dashMap };
}

const srgbToLinear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/**
 * Readable text for a swatch used as a fill. These colours are picked to be told apart as
 * lines on a chart, not to be written on: the 4xx ramp is yellow, and a status badge with
 * white on it could not be read at all. 0.179 is where white and black swap places.
 */
export function textOn(background: string | undefined): string {
    if (!background || !/^#[0-9a-f]{6}$/i.test(background)) return 'inherit';

    const [r, g, b] = [1, 3, 5].map(at => srgbToLinear(parseInt(background.slice(at, at + 2), 16) / 255));
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    return luminance > 0.179 ? '#1a1a1a' : '#ffffff';
}
