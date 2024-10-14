import { $api } from "@/lib/api"
import { useState } from "react";
import { Plus } from "lucide-react";
import { useSelectedDBs } from "@/lib/state/database";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export function CreateNewDB() {
    const [dbs, setDbs] = useSelectedDBs()
    const [inputValue, setInputValue] = useState('');
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const createDB = $api.useMutation("post", "/api/db/create", {
        onSuccess: (data) => {
            queryClient.invalidateQueries({
                queryKey: [
                    "get",
                    "/api/db",
                ],
            })
            setDbs({
                index_db: data.index_db,
            })
            console.log(data)
            setInputValue('')
            toast({
                title: "Success",
                description: "Created Index DB If it didn't exist and switched to it",
            })
        }
    })
    const validateName = (name: string) => {
        if (name.length < 3 || name.length > 32) {
            toast({
                title: "Error",
                description: "Name must be between 3 and 32 characters long",
                variant: "destructive"
            })
            return false
        }
        const reg = /^[a-zA-Z0-9_]+$/
        if (!reg.test(name)) {
            toast({
                title: "Error",
                description: "Name can only contain letters, numbers or underscores",
                variant: "destructive"
            })
            return false
        }
        return true
    }
    function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            if (validateName(inputValue))
                createDB.mutate({ params: { query: { new_index_db: inputValue } } })
        }
    }
    function onClickAdd() {
        if (validateName(inputValue))
            createDB.mutate({ params: { query: { new_index_db: inputValue } } })
    }
    return (
        <div className="flex flex-col items-left rounded-lg border p-4 mt-4">
            <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        New Index DB
                    </Label>
                    <div className="text-gray-400">
                        Create a new index database
                    </div>
                </div>
            </div>
            <div className="flex flex-row items-center space-x-2 mt-4 w-full justify-center">
                <Input
                    pattern="[a-zA-Z0-9_]+"
                    minLength={3}
                    maxLength={16}
                    onChange={(e) => setInputValue(e.target.value)}
                    value={inputValue}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a name and press Enter" />
                <Button title="Create DB" onClick={onClickAdd} variant="ghost" size="icon">
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}