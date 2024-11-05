import { ContextMenuContent, ContextMenuItem } from "../ui/context-menu";

export function PinBoardCtx({
    sha256,
    file_url,
    onLayoutChange,
    layout,
    pinboardRef,
    columns,
    rowHeight,
}: {
    sha256: string
    file_url: string
    onLayoutChange: (layout: ReactGridLayout.Layout[]) => void
    layout: ReactGridLayout.Layout[],
    pinboardRef: React.RefObject<HTMLDivElement>,
    columns: number,
    rowHeight: number,
}) {
    function openURL() {
        window.open(file_url, "_blank")
    }
    function increaseSize() {
        console.log(pinboardRef.current?.clientHeight, pinboardRef.current?.clientWidth)
        onLayoutChange(layout.map(l => {
            if (l.i === sha256) {
                return { ...l, w: l.w + 1, h: l.h + 1 }
            }
            return l
        }))
    }
    function decreaseSize() {
        onLayoutChange(layout.map(l => {
            if (l.i === sha256) {
                return { ...l, w: l.w - 1, h: l.h - 1 }
            }
            return l
        }))
    }
    return <ContextMenuContent>
        <ContextMenuItem onClick={() => openURL()}>Open in New Tab</ContextMenuItem>
        <ContextMenuItem onClick={() => increaseSize()}>Increase Size</ContextMenuItem>
        <ContextMenuItem onClick={() => decreaseSize()}>Decrease Size</ContextMenuItem>
    </ContextMenuContent>
}