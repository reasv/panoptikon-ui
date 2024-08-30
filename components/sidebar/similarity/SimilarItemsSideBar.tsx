"use client"

import { useDatabase, useDetailsPane, useItemSelection } from "@/lib/zust"
import { FilterContainer } from "../options/FilterContainer"
import { components } from "@/lib/panoptikon"
import { MultiBoxResponsive } from "@/components/multiCombobox"
import { $api } from "@/lib/api"
import { ConfidenceFilter } from "../options/confidenceFilter"
import { Button } from "@/components/ui/button"
import { Delete } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/use-toast"

export function SimilarItems() {
    const selected = useItemSelection((state) => state.getSelected())
    return (
        <div className="mt-4">

        </div>
    )
}