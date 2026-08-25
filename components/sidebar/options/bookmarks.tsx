import { $api } from "@/lib/api"
import { useBookmarkCustomNs, useBookmarkNs, } from "@/lib/state/zust"
import { Label } from "../../ui/label"
import { Input } from "../../ui/input";
import { useState } from "react";
import { Plus, Bookmark } from "lucide-react";
import { Button } from "../../ui/button";
import { ComboBoxResponsive } from "../../combobox";
import { Toggle } from "@/components/ui/toggle";
import { useSelectedDBs } from "@/lib/state/database";
import { useAlwaysShowBookmarkBtn } from "@/lib/state/alwaysShowBookmarks";

export function SwitchBookmarkNs() {
    const [dbs, ___] = useSelectedDBs()
    const { data } = $api.useQuery("get", "/api/bookmarks/ns", {
        params: {
            query: dbs
        }
    })
    const customNs = useBookmarkCustomNs((state) => state.namespaces)
    const namespace = useBookmarkNs((state) => state.namespace)
    const [inputValue, setInputValue] = useState('');
    const setBookmarks = useBookmarkNs((state) => state.setBookmarks)
    const addBookmarkCustomNs = useBookmarkCustomNs((state) => state.addNs)
    const [alwaysShow, setAlwaysShow] = useAlwaysShowBookmarkBtn()
    function setBookmarkCustomNs(ns: string) {
        addBookmarkCustomNs(ns)
        setBookmarks(ns)
    }
    const mergedNamespaces = Array.from(new Set([
        ...(data?.namespaces || []),
        ...(customNs || []),
        namespace
    ]));
    function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter' && inputValue !== '') {
            setBookmarkCustomNs(inputValue)
            setInputValue('')
        }
    }
    function onClickAdd() {
        if (inputValue === '') return
        setBookmarkCustomNs(inputValue)
        setInputValue('')
    }
    function onSelectOption(option: string | null) {
        if (option === null) return
        setBookmarks(option)
    }
    function onClickAlwaysShow() {
        setAlwaysShow(!alwaysShow)
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        Bookmarks Group
                    </Label>
                    <div className="text-gray-400">
                        New bookmarks will be added to this group
                    </div>
                </div>
                <Toggle
                    pressed={alwaysShow}
                    onClick={() => onClickAlwaysShow()}
                    title={(!alwaysShow ? "Click to always show the bookmark button on bookmarked items" : "Click to hide the bookmark button when not hovering on a thumbnail")}
                    aria-label="Toggle show bookmark icon persistently"
                >
                    <Bookmark className="h-4 w-4" />
                </Toggle>
            </div>
            {/* THE TWO CONTROLS COMPETE, and left alone the input wins
                outright: `Input` carries `w-full`, so as a flex item it asks
                for the entire row, while the combobox trigger is
                content-sized and carries `min-w-0` — so the trigger gave up
                everything and rendered the group name as "def…" with room to
                spare beside it.

                Fixed here rather than in ComboBoxResponsive: this is the only
                one of its thirteen call sites that puts an Input next to it,
                so the squeeze is this row's problem and not the component's.
                The `min-w-0`/`max-w-full` on the trigger are right for the
                twelve rows where it stands alone.

                The combobox states what it needs — its label's own width,
                capped so a long group name cannot eat the row (the trigger
                truncates past that) — and the input takes what is left:
                `flex-1` sets a 0% basis, which is what finally overrides that
                `w-full`, and `min-w-0` lets it shrink rather than push.

                No `min-w` on the wrapper, deliberately: the trigger is an
                `inline-flex` Button and does not stretch, so a floor wider
                than a short group name would sit the control against dead
                space instead of widening it. Content width IS the fix. */}
            <div className="flex flex-row items-center space-x-2 mt-3 w-full">
                <div className="shrink-0 max-w-[45%]">
                    <ComboBoxResponsive
                        options={mergedNamespaces.map((ns) => ({ value: ns, label: ns }))}
                        currentValue={namespace}
                        onChangeValue={onSelectOption}
                        placeholder="Groups..."
                    />
                </div>
                <Input
                    className="min-w-0 flex-1"
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a new name and press Enter" />
                <Button className="shrink-0" title="Add new group name" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}