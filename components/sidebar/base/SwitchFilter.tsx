import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"
import { ReactNode } from "react"

export function SwitchFilter({
    label,
    description,
    value,
    onChange,
}: {
    label: ReactNode
    description?: ReactNode
    value: boolean
    onChange: (value: boolean) => void
}) {
    return <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
        <div className="flex flex-row items-center justify-between">
            <div className="space-y-0.5">
                <Label className="text-base">
                    {label}
                </Label>
                <div className="text-gray-400">
                    {description}
                </div>
            </div>
            <Switch checked={value} onCheckedChange={onChange} />
        </div>
    </div>
}
