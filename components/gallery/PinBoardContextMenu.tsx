import { ContextMenuContent, ContextMenuItem } from "../ui/context-menu";

export function PinBoardCtx({
    sha256,
    file_url,
    onLayoutChange,
    layout,
}: {
    sha256: string
    file_url: string
    onLayoutChange: (layout: ReactGridLayout.Layout[]) => void
    layout: ReactGridLayout.Layout[]
}) {
    function openURL() {
        window.open(file_url, "_blank")
    }
    return <ContextMenuContent>
        <ContextMenuItem onClick={() => openURL()}>Open in New Tab</ContextMenuItem>
    </ContextMenuContent>
}