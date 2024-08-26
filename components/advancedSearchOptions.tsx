"use client"
import { $api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { SidebarClose } from "lucide-react"

import { Button } from "@/components/ui/button"

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDatabase } from "@/lib/zust"
import { Label } from "./ui/label"
import { SwitchDB } from "./switchDB"
import { SwitchBookmarkNs } from "./bookmarks"

export function AdvancedSearchOptions({
    onClose,
}: {
    onClose: () => void
}) {

    return (
        <div className="fixed top-0 left-0 w-1/4 h-full p-4 shadow-lg z-50">
            <Card>
                <CardHeader>
                    <CardTitle>
                        <div className="flex gap-2">
                            <h2 className="text-lg font-semibold w-full">Advanced Search Options</h2>
                            <Button title="Close Advanced Options" onClick={onClose} variant="ghost" size="icon">
                                <SidebarClose className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <SwitchDB />
                    <SwitchBookmarkNs />
                </CardContent>
            </Card>
        </div>
    )
}