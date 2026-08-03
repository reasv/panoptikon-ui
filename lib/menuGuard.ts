import { useSyncExternalStore } from "react"

// Re-entrancy guards for menu-triggered async work, held at MODULE scope on
// purpose: Radix unmounts the menu — and with it any component state — the
// moment a row is selected, so a useState flag would be destroyed by the
// very click it is meant to guard against, leaving a second click free to
// start a second full-resolution composite (and OOM the tab, or race two
// writes of the same preview).
//
// The flag is checked and set synchronously inside the action and cleared
// in its finally; the subscription exists only so the rows of a REOPENED
// menu can still render themselves disabled while the first run is in
// flight. One guard instance per verb — they are independent.

export type MenuGuard = {
    /** Synchronous read, for the check-and-set at the top of the action. */
    readonly busy: boolean
    /** Set from the action itself: true before the work, false in finally. */
    set: (value: boolean) => void
    /** Subscribed read, so menu rows re-render when the flag flips. */
    useBusy: () => boolean
}

export function createMenuGuard(): MenuGuard {
    let busy = false
    const listeners = new Set<() => void>()

    const subscribe = (onChange: () => void) => {
        listeners.add(onChange)
        return () => {
            listeners.delete(onChange)
        }
    }

    function useBusy(): boolean {
        return useSyncExternalStore(
            subscribe,
            () => busy,
            () => false,
        )
    }

    return {
        get busy() {
            return busy
        },
        set(value: boolean) {
            busy = value
            for (const listener of listeners) listener()
        },
        useBusy,
    }
}
