"use client"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

// App-styled replacement for window.confirm — never use the browser's
// native confirm/alert/prompt dialogs. Controlled: the caller owns the
// open state and gets exactly one of onConfirm/onCancel (Escape and
// backdrop clicks cancel).
export function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel = "Delete",
    destructive = true,
    onConfirm,
    onCancel,
}: {
    open: boolean
    title: string
    description?: string
    confirmLabel?: string
    destructive?: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onCancel()
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && (
                        <DialogDescription className="whitespace-pre-line">
                            {description}
                        </DialogDescription>
                    )}
                </DialogHeader>
                <DialogFooter>
                    <Button variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        onClick={onConfirm}
                        autoFocus
                    >
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
