import { useEmbedArgs } from "@/lib/state/searchQuery/clientHooks"
import { EmbedArgs } from "../base/EmbedArgs"

export function ModelOptions() {
    const [args, setArgs] = useEmbedArgs()
    return (
        <EmbedArgs embedArgs={args} setEmbedArgs={setArgs} />
    )
}