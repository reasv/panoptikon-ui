"use client"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SwitchDB } from "@/components/sidebar/options/switchDB"
import { CreateNewDB } from "@/components/scan/CreateDB"
import { Config } from "@/components/scan/Config"
import { GroupList } from "@/components/scan/GroupLists"
import { JobQueue } from "@/components/scan/JobQueue"
import { JobHistory } from "@/components/scan/JobHistory"
import { FolderLists } from "@/components/scan/FolderLists"

export function ScanPage() {
  return (
    <div className="flex w-full h-screen">
      <div className={"p-4 mx-auto w-full"}>
        <ScrollArea className="overflow-y-auto">
          <div className="max-h-[100vh] mr-4">
            <div className='grid gap-4 grid-cols-1 lg:grid-cols-2'>
              <SwitchDB />
              <CreateNewDB />
            </div>
            <Config />
            <FolderLists />
            <GroupList />
            <JobQueue />
            <JobHistory />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

