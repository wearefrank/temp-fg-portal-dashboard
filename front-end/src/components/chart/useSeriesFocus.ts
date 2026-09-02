import { useCallback, useState } from 'react';

/**
 * Which chart series are hidden and which one the legend is hovering.
 *
 * Hiding is the only way to read a small series next to one two orders of magnitude busier;
 * hovering dims the rest so a single line stands out without hiding anything.
 */
export function useSeriesFocus() {
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const [hovered, setHovered] = useState<string | null>(null);

    const toggle = useCallback((key: string) => {
        setHidden(previous => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    return {
        toggle,
        hover: setHovered,
        isHidden: (key: string) => hidden.has(key),
        isHighlighted: (key: string) => hovered === key,
        isDimmed: (key: string) => hovered !== null && hovered !== key,
    };
}
