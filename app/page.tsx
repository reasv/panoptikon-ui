import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <ScrollArea className="overflow-y-auto">
      <div className="max-h-[100vh]">
        <div className="font-sans flex flex-col items-center justify-center min-h-screen p-8 pb-20 sm:p-20">
          <main className="flex flex-col gap-8 items-center text-center sm:text-left max-w-lg">

            <div className="flex justify-center w-full">
              <Image
                src="/spinner_text.svg"
                alt="Panoptikon logo"
                width={256}
                height={256}
              />
            </div>
            <div className="flex flex-col">
              <div className="space-y-0.5">
                <Label className="text-2xl">
                  Getting Started
                </Label>
                <div className="text-gray-400 text-xl">
                  Welcome to Panoptikon! This is a tool for indexing and searching files on your computer using AI.
                </div>
              </div>
              <div className="mt-4 w-full">
                <div className="space-y-0.5">
                  <Label className="text-base">
                    1. Add Your Folders
                  </Label>
                  <div className="text-gray-400">
                    Start by adding directories to scan
                  </div>
                </div>
                <br />
                <p className="text-left">
                  Visit the <Link href={"/scan"} className="underline">Scan</Link> page, paste the directories you want to scan
                  into the <b>Included Directories</b> textbox, and click <b>Save And Scan New Paths</b>.
                  A file scan will be added to the job queue and begin running shortly.
                  <br />
                  <br />
                  The scan adds files from your filesystem to the database.
                  However, before you can actually perform searches on your files, you need to extract data from them which will be indexed and used by the search engine.
                  <br />
                  <br />
                </p>
                <div className="space-y-0.5">
                  <Label className="text-base">
                    2. Extract Data For Searching
                  </Label>
                  <div className="text-gray-400">
                    Schedule AI data extraction jobs to run on the scanned files
                  </div>
                </div>
                <br />
                <p className="text-left">
                  With the file scan still running, you can already begin scheduling Data Extraction Jobs.
                  The job queue ensures these will run as soon as the scan is complete.
                  <br />
                  Select an AI model category tab (Tags, Text Embeddings, Image Embeddings etc) to see the available models and schedule a job
                  by selecting a model using the checkbox on the corresponding table row and clicking the <b>Run Job(s) for Selected</b> button.
                  <br />
                  This process ensures that Panoptikon has data to search your files with.
                  <br />
                  <br />
                </p>
                <div className="space-y-0.5">
                  <Label className="text-base">
                    3. Search Your Files
                  </Label>
                  <div className="text-gray-400">
                    You can now search your files
                  </div>
                </div>
                <br />
                <p className="text-left">
                  Once the scan is complete and the data extraction jobs have run, you can start searching your files.
                  Visit the <Link href={"/search"} className="underline">Search</Link> page to begin your queries.
                </p>
              </div>
            </div>
          </main>
        </div>

      </div>
    </ScrollArea>
  );
}
