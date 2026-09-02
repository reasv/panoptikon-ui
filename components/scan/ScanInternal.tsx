"use client"
import { SwitchDB } from "@/components/sidebar/options/switchDB"
import { CreateNewDB } from "@/components/scan/CreateDB"
import { Config } from "@/components/scan/Config"
import { VectorQuantization } from "@/components/scan/VectorQuantization"
import { ContinuousScan } from "@/components/scan/ContinuousScan"
import { GroupList } from "@/components/scan/GroupLists"
import { JobQueue } from "@/components/scan/JobQueue"
import { JobHistory } from "@/components/scan/JobHistory"
import { FailedFiles } from "@/components/scan/FailedFiles"
import { FolderLists } from "@/components/scan/FolderLists"

export function ScanInternal() {
    // pb-4: cards only carry a top margin (FilterContainer), so without this
    // the last card sits flush against the scroll viewport's bottom edge.
    return <div className="pb-4">
        <div className='grid gap-4 grid-cols-1 lg:grid-cols-2'>
            <SwitchDB />
            <CreateNewDB />
        </div>
        <Config />
        <FolderLists />
        <ContinuousScan />
        <VectorQuantization />
        <GroupList />
        <JobQueue />
        <JobHistory />
        <FailedFiles />
    </div>
}
