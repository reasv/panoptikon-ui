import { $api } from "@/lib/api"
import { useSelectedDBs } from "@/lib/state/database"
import { useTagCompletionSettings } from "./state/tagCompletion"

export function useTagCompletionEnabled() {
  const { data } = $api.useQuery("get", "/api/search/stats", {
    params: {
      query: {
        ...useSelectedDBs()[0],
      },
    },
  })
  const tags = data?.setters.filter((setter) => setter[0] === "tags") || []
  const tagsExist = tags.length > 0
  const enabled = useTagCompletionSettings((state) => state.enabled)
  const setEnabled = useTagCompletionSettings((state) => state.setEnabled)
  return [tagsExist && enabled, setEnabled] as const
}
