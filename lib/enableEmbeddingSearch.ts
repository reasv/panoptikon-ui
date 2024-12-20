import { useEmbedArgs } from "@/lib/state/searchQuery/clientHooks"
import { $api } from "@/lib/api"
import { splitByFirstSlash } from "@/components/SearchTypeSelector"
import { useToast } from "@/components/ui/use-toast"
import { useLastModelSelection } from "./state/lastModel"
import { useEffect } from "react"

export function useEnableEmbeddingSearch({
  setEnable,
  model,
  setModel,
  models,
  type,
}: {
  setEnable: (value: boolean) => void
  model: string
  setModel: (value: string) => void
  models: string[]
  type: "image" | "text" | "audio"
}) {
  const [getLastModel, setLastModel] = useLastModelSelection((state) => [
    state.getLastSelectedModel,
    state.setLastSelectedModel,
  ])
  useEffect(() => {
    const lastModel = getLastModel(type)
    if (model.length > 0 && lastModel !== model) {
      setLastModel(type, model)
    }
  }, [model])

  const getDefaultModel = () => {
    if (models.length === 0) {
      return ""
    }
    const lastModel = getLastModel(type)
    if (lastModel && models.includes(lastModel)) {
      return lastModel
    }
    return models[0]
  }

  const [embedArgs, setEmbedArgs] = useEmbedArgs()
  const loadModel = $api.useMutation(
    "put",
    "/api/inference/load/{group}/{inference_id}"
  )
  const { refetch } = $api.useQuery("get", "/api/inference/cache")
  const { toast } = useToast()
  const onEnableChange = async (value: boolean) => {
    if (models.length === 0) {
      return
    }
    let currentModel = model
    if (model.length === 0) {
      const defaultModel = getDefaultModel()
      setModel(defaultModel)
      currentModel = defaultModel
    }
    if (currentModel.length === 0) {
      setEnable(false)
      return
    }
    if (value) {
      const { data } = await refetch()
      if (
        data &&
        data.cache[currentModel] &&
        data.cache[currentModel].length > 0
      ) {
        setEnable(true)
        toast({
          title: "Enabled",
          description: `Semantic ${
            type === "image" ? "Image" : type === "text" ? "Text" : "Audio"
          } Search is now enabled`,
        })
        return
      }
      if (loadModel.isPending) {
        return
      }
      toast({
        title: "Loading Model...",
        description: "Embedding model is being loaded into memory...",
      })
      loadModel.mutate(
        {
          params: {
            path: {
              group: splitByFirstSlash(currentModel)[0],
              inference_id: splitByFirstSlash(currentModel)[1],
            },
            query: {
              ...embedArgs,
            },
          },
        },
        {
          onSuccess: () => {
            setEnable(true)
            toast({
              title: "Model Loaded",
              description: `Semantic ${
                type === "image" ? "Image" : type === "text" ? "Text" : "Audio"
              } Search is now enabled`,
            })
          },
          onError: (error) => {
            toast({
              title: "Error loading model",
              description: (error as any).message || "Unknown error",
              variant: "destructive",
            })
          },
        }
      )
    } else {
      toast({
        title: "Disabled",
        description: `Semantic ${
          type === "image" ? "Image" : type === "text" ? "Text" : "Audio"
        } Search is now disabled`,
      })
      setModel("")
      setEnable(false)
    }
  }
  return [onEnableChange, loadModel.isPending] as const
}
