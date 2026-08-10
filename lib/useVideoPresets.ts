import { $api } from "@/lib/api"
import {
  useVideoComposeEnabled,
  useVideoTranscodeEnabled,
} from "@/lib/useClientConfig"
import type { components } from "@/lib/panoptikon"

// `GET /api/video/presets`, the one table every transcode surface builds its
// rows from (docs/video-transcoding-implementation.md §3 U1).
//
// The presets are RESOLVED server-side (built-ins merged with the user's
// `[transcode.profiles]`) and filtered by the matched policy's
// `[policies.client] transcode_presets`, so a client that renders whatever
// comes back is automatically correct for a restricted profile: a policy that
// offers nothing yields an empty list, and the hide-don't-disable rule turns
// that into no menu at all rather than a row that 422s.
//
// Each row carries its own `ext`, `channel` and `surfaces`, which is what
// keeps the client free of lookup tables (design §0.4): a user-declared
// profile appears in the right menu, under its own label, with no UI change.

export type TranscodePreset = components["schemas"]["TranscodePresetInfo"]
export type TranscodeLimits = components["schemas"]["TranscodeLimits"]
export type TranscodeSurface = components["schemas"]["Surface"]

export type VideoPresets = {
  /** The presets tagged with the requested surface, in server order. */
  presets: TranscodePreset[]
  /**
   * The composition limits that ride in the same envelope. Unused by clip
   * export; Phase 4's pinboard/mosaic builder clamps against them, and they
   * cost nothing to expose from the request that is already being made.
   */
  limits: TranscodeLimits | null
  /** The capability itself, so a caller can tell "off" from "still loading". */
  enabled: boolean
  /** A successful response has landed. */
  loaded: boolean
}

/**
 * The presets this policy exposes for one surface.
 *
 * `enabled` is STRICT true on the client config — the same rule
 * `useVideoTranscodeEnabled` documents for the play affordance. While the
 * config is in flight the answer is "no capability", so a loading page never
 * fires a request the policy may 403; the cost is that the chevron appears a
 * moment late, which is exactly what a menu that does not exist yet looks
 * like.
 *
 * WHICH capability depends on the surface, because the two surfaces post to
 * two separately rule-able routes: `playback` and `clip` act through
 * `/api/video/transcode`, `mosaic` through `/api/video/compose`. A policy that
 * allows compositions but denies single-file re-encodes must still get its
 * mosaic rows — and a policy that allows clips but denies mosaics must not get
 * them — so the row list is gated per surface while the presets REQUEST (a
 * plain GET, and one table for both) fires as soon as either is allowed.
 *
 * `staleTime: Infinity`: the table changes only when the server's config
 * does, and that means a restart. One fetch per session, shared by every
 * player surface and every pin menu through the query cache.
 */
export function useVideoPresets(surface: TranscodeSurface): VideoPresets {
  const transcodeEnabled = useVideoTranscodeEnabled()
  const composeEnabled = useVideoComposeEnabled()
  const enabled = surface === "mosaic" ? composeEnabled : transcodeEnabled
  const query = $api.useQuery(
    "get",
    "/api/video/presets",
    {},
    { enabled: transcodeEnabled || composeEnabled, staleTime: Infinity },
  )
  const all = enabled ? query.data?.presets : undefined
  return {
    presets: all ? all.filter((preset) => preset.surfaces.includes(surface)) : [],
    limits: query.data?.limits ?? null,
    enabled,
    loaded: enabled && !!query.data,
  }
}
