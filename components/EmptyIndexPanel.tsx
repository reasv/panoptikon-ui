"use client"

import Link from "next/link"
import { useMemo } from "react"
import { Label } from "@/components/ui/label"
import { selectedDBsSerializer, useSelectedDBs } from "@/lib/state/database"

/**
 * What the Results tab shows in place of an empty grid when the selected
 * index database holds no files at all — the getting-started guide that used
 * to be the site root ("/", which now always redirects to /search).
 *
 * It lives here rather than on a landing page because this is the one moment
 * it is true: a guide on "/" was shown on every visit, to users with fully
 * indexed databases, and hidden from anyone who arrived at /search directly.
 * Keyed on the index being EMPTY, not on a query matching nothing: a search
 * with no hits over a populated index is an ordinary result and keeps the
 * ordinary empty grid.
 *
 * Three audiences, told apart by the caller from the client config:
 * - "server": a server-only install has no setup wizard, so the Scan page
 *   steps ARE its onboarding.
 * - "desktop": Desktop users onboard through the app's own setup window,
 *   which also opens /search the moment it finishes — usually while the first
 *   scan is still running. The Scan page steps would be the wrong instructions,
 *   so this only points back at the app.
 * - "restricted": the policy denies scan and job management, so there is
 *   nothing the viewer can do about it; no links to pages they cannot use.
 */
export type EmptyIndexAudience = "server" | "desktop" | "restricted"

export function EmptyIndexPanel({ audience }: { audience: EmptyIndexAudience }) {
    const dbs = useSelectedDBs()[0]
    // The selected databases ride along, so the Scan page opens on the index
    // this panel is about rather than on the server's default one.
    const scanLink = useMemo(() => selectedDBsSerializer("/scan", {
        index_db: dbs.index_db,
        user_data_db: dbs.user_data_db,
    }), [dbs.index_db, dbs.user_data_db])
    return (
        <div className="flex justify-center p-8">
            <div className="flex max-w-lg flex-col gap-4">
                <div className="space-y-0.5">
                    <Label className="text-2xl">
                        {audience === "server" ? "Getting Started" : "Nothing Indexed Yet"}
                    </Label>
                    <div className="text-xl text-gray-400">
                        This database does not contain any files yet.
                    </div>
                </div>
                {audience === "desktop" && (
                    <p>
                        Choose the folders to index from the Panoptikon app&apos;s
                        setup. If you have just finished setup, the first scan
                        may still be running: reload this page once files have
                        been added.
                    </p>
                )}
                {audience === "restricted" && (
                    <p>
                        Files will be searchable here once the server&apos;s
                        administrator has scanned them.
                    </p>
                )}
                {audience === "server" && (
                    <>
                        <div className="space-y-0.5">
                            <Label className="text-base">
                                1. Add Your Folders
                            </Label>
                            <div className="text-gray-400">
                                Start by adding directories to scan
                            </div>
                        </div>
                        <p>
                            Visit the <Link href={scanLink} className="underline">Scan</Link> page,
                            paste the directories you want to scan into the <b>Included
                            Directories</b> textbox, and click <b>Save And Scan New Paths</b>.
                            A file scan will be added to the job queue and begin running shortly.
                            The scan adds files from your filesystem to the database.
                        </p>
                        <div className="space-y-0.5">
                            <Label className="text-base">
                                2. Extract Data For Searching
                            </Label>
                            <div className="text-gray-400">
                                Schedule AI data extraction jobs to run on the scanned files
                            </div>
                        </div>
                        <p>
                            With the file scan still running, you can already begin
                            scheduling Data Extraction Jobs. The job queue ensures these
                            will run as soon as the scan is complete. Select an AI model
                            category tab (Tags, Text Embeddings, Image Embeddings etc) to
                            see the available models and schedule a job by selecting a
                            model using the checkbox on the corresponding table row and
                            clicking the <b>Run Job(s) for Selected</b> button.
                        </p>
                        <div className="space-y-0.5">
                            <Label className="text-base">
                                3. Search Your Files
                            </Label>
                            <div className="text-gray-400">
                                Come back here once the jobs have run
                            </div>
                        </div>
                        <p>
                            Scanned files show up here as soon as the scan adds them;
                            reload this page to see them. Searching by tags, text or
                            image similarity works once the matching extraction jobs
                            have run.
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
