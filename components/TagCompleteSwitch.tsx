import { useTagCompletionEnabled } from "@/lib/enableTagsHook"
import { useToast } from "./ui/use-toast"
import { Toggle } from "./ui/toggle"
import { Tag } from "lucide-react"

export function TagCompletionSwitch() {
    const [isEnabled, setEnabled, tagsExist] = useTagCompletionEnabled()
    const { toast } = useToast()

    const onClickToggle = () => {
        const newValue = !isEnabled
        setEnabled(newValue)

        let description = "Tag completion will be enabled"
        if (!newValue) {
            description = "Tag completion will be disabled"
        }
        toast({
            title: `Tag Completion is ${newValue ? "ON" : "OFF"}`,
            description,
            duration: 2000
        })
    }

    return (
        tagsExist &&
        <Toggle
            pressed={isEnabled}
            onClick={onClickToggle}
            title={isEnabled ? "Tag Completion Enabled" : "Tag Completion Disabled"}
            aria-label={isEnabled ? "Disable Tag Completion" : "Enable Tag Completion"}
        >
            <Tag className="h-4 w-4" />
        </Toggle>
    )
}
