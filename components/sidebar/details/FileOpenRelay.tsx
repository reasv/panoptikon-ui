import { Input } from "../../ui/input"
import { useState } from "react"
import { Save } from "lucide-react"
import { Button } from "../../ui/button"
import { FilterContainer } from "../base/FilterContainer"
import { useToast } from "@/components/ui/use-toast"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useRelayConfigState } from "@/lib/state/relayConfig"
import { File, FolderOpen } from "lucide-react"
import { useMutation } from "@tanstack/react-query"

export function RelayConfig() {
    const [enabled, setEnabled] = useRelayConfigState((state) => [state.enabled, state.setEnabled])
    const [savedURL, setSavedURL] = useRelayConfigState((state) => [state.relayURL, state.setRelayURL])
    const [savedAPIKey, setSavedAPIKey] = useRelayConfigState((state) => [state.apiKey, state.setApiKey])
    const [inputURL, setInputURL] = useState<string>(savedURL)
    const [inputAPIKey, setInputAPIkey] = useState<string>(savedAPIKey)
    const [inputURLEdited, setInputURLEdited] = useState<boolean>(false)
    const [inputAPIKeyEdited, setInputAPIKeyEdited] = useState<boolean>(false)

    const { toast } = useToast()
    function setRelayEnabled(e: boolean) {
        setEnabled(e)
        toast({
            title: `Relay ${e ? "Enabled" : "Disabled"}`,
            description: e ? "Show/Open File buttons will use the relay" : "Show/Open File buttons will not use the relay",
            variant: "default",
            duration: 2000,
        })
    }
    function saveURL() {
        if (inputURL.length == 0) {
            toast({
                title: "Error",
                description: `Relay URL cannot be empty`,
                variant: "destructive",
                duration: 2000,
            })
            return
        }
        setSavedURL(inputURL)
        toast({
            title: "Saved Relay URL",
            description: `The Relay URL is ${inputURL}`,
            variant: "default",
            duration: 2000,
        })
    }
    function saveAPIKey() {
        setSavedAPIKey(inputAPIKey)
        toast({
            title: "Saved API Key",
            description: inputAPIKey ? `The API Key is ${inputAPIKey}` : "API Key has been set to an empty string",
            variant: "default",
            duration: 2000,
        })
    }

    const openConfigMutation = useMutation({
        mutationKey: ["relayConfig"],
        mutationFn: async (verb: "file" | "folder") => {
            const requestURL = savedURL.endsWith("/") ? savedURL.slice(0, -1) : savedURL
            const url = verb === "file" ? `${requestURL}/config` : `${requestURL}/config?verb=folder`
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": savedAPIKey.length ? `Bearer ${savedAPIKey}` : "",
                },
            })
            if (!response.ok) {
                throw new Error(`Failed to open relay config: ${response.statusText}`)
            }
        },
        onSuccess: () => {
            toast({
                title: "Opening Relay Config",
                description: "Relay configuration file opened successfully.",
                variant: "default",
                duration: 2000,
            })
        },
        onError: (error) => {
            toast({
                title: "Error Opening Relay Config",
                description: error.message || "An error occurred while opening the relay configuration.",
                variant: "destructive",
                duration: 2000,
            })
        },
    })
    function openConfigFile() {
        openConfigMutation.mutate("file")
    }
    function openConfigFolder() {
        openConfigMutation.mutate("folder")
    }
    return (
        <FilterContainer
            label={<span>File Open Relay</span>}
            description={<span>Connect to the Relay companion app</span>}
            storageKey="panptikon-relay-open"
            unMountOnCollapse
        >
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Enable
                        </Label>
                        <div className="text-gray-400">
                            Show/Open File buttons will use the relay
                        </div>
                    </div>
                    <Switch checked={enabled} onCheckedChange={(value) => setRelayEnabled(value)} />
                </div>
            </div>
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Relay URL
                        </Label>
                        <div className="text-gray-400">
                            API URL for your Panoptikon Relay
                        </div>
                    </div>
                </div>
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                    <Input
                        onChange={(e) => {
                            setInputURLEdited(true)
                            setInputURL(e.target.value)
                        }}
                        value={inputURLEdited ? inputURL : savedURL}
                        placeholder="http://127.0.0.1:17600" />
                    <Button title="Save API URL" onClick={saveURL} variant="ghost" size="icon">
                        <Save className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
                <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">
                            Relay API Key
                        </Label>
                        <div className="text-gray-400">
                            API Key for your Panoptikon Relay
                        </div>
                    </div>
                </div>
                <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                    <Input
                        onChange={(e) => {
                            setInputAPIKeyEdited(true)
                            setInputAPIkey(e.target.value)
                        }}
                        value={inputAPIKeyEdited ? inputAPIKey : savedAPIKey}
                        placeholder="Paste your API key secret" />
                    <Button title="Save API Key" onClick={saveAPIKey} variant="ghost" size="icon">
                        <Save className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <div className="border rounded-lg p-4 mt-4">
                <div className="flex flex-col space-y-2">
                    <div className="w-full ">
                        Open Relay Configuration File/Folder
                    </div>
                    <div className="flex flex-row space-x-2">
                        <Button
                            title="Open Relay config file"
                            onClick={() => openConfigFile()}
                            variant="ghost"
                            size="icon"
                        >
                            <File
                                className="w-4 h-4"
                            />
                        </Button>
                        <Button
                            title="Open Relay config folder"
                            onClick={() => openConfigFolder()}
                            variant="ghost"
                            size="icon"
                        >
                            <FolderOpen
                                className="w-4 h-4"
                            />
                        </Button>
                    </div>
                </div>
            </div>
        </FilterContainer>
    )
}
