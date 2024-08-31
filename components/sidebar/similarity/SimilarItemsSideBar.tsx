"use client"

import { ClipItemSimilarity } from "./ClipSimilarItems"
import { TextEmbeddingsSimilarity } from "./TextSimilarItems"

export function SimilarItemsSideBar() {
    return (
        <div className="mt-4">
            <ClipItemSimilarity />
            <TextEmbeddingsSimilarity />
        </div>
    )
}

