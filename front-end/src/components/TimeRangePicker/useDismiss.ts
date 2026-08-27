import { useEffect, type RefObject } from 'react';

/** Closes an open popover on Escape or a click outside it. `onClose` must be stable. */
export function useDismiss(
    ref: RefObject<HTMLElement | null>,
    open: boolean,
    onClose: () => void,
): void {
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [ref, open, onClose]);
}
