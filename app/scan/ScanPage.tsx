"use client"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { SidebarClose } from "lucide-react"
import Link from "next/link"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"
import { useMemo } from "react"
import { ScanInternal } from "@/components/scan/ScanDrawer"

export function ScanPage() {
  const dbs = useSelectedDBs()[0]
  const searchLink = useMemo(() => {
    return selectedDBsSerializer("/search", {
      index_db: dbs.index_db,
      user_data_db: dbs.user_data_db,
    })
  }, [dbs])
  return (
    <div className="flex w-full h-screen">
      <div className={"p-4 mx-auto w-full"}>
        <ScrollArea className="overflow-y-auto">
          <div className="max-h-[100vh] mr-4">
            <Link
              href={searchLink}
            >
              <Button title="Back to Search" variant="ghost" size="icon">
                <SidebarClose className="h-4 w-4" />
              </Button>
            </Link>
            <ScanInternal />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

