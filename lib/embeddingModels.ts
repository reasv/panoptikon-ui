/**
 * Audio (clap/) and image (clip/) embeddings are both stored under the "clip"
 * data type, so the setter list for CLIP similarity holds both kinds and the
 * order it arrives in carries no meaning. Taking the first entry therefore
 * lands on an audio model for an image item whenever clap/ happens to come
 * first, which produces a query that can never match.
 *
 * The model group prefix is the only modality signal available — the setter
 * list has no type of its own — and it is already what Semantic Image/Audio
 * Search splits on (see ImageEmbeddingsSearch).
 */
export function isAudioEmbeddingModel(model: string): boolean {
  return model.startsWith("clap")
}

/**
 * The model to preselect for a similarity query against `mimeType`: the first
 * one whose modality matches the target (audio files → clap/, everything else
 * → clip/), falling back to the first model when nothing matches, so a DB with
 * only one kind of embedding still selects something usable.
 */
export function pickDefaultEmbeddingModel(
  models: string[],
  mimeType?: string | null
): string {
  if (models.length === 0) {
    return ""
  }
  const wantAudio = !!mimeType && mimeType.startsWith("audio")
  return models.find((m) => isAudioEmbeddingModel(m) === wantAudio) ?? models[0]
}
