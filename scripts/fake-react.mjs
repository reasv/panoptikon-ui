// A ~50-line stand-in for React's hook runtime, so scripts/endaction.test.mjs
// can drive lib/videoTrim.ts's useVideoTrim in plain node — no DOM, no
// renderer, no test framework (this repo has none of the three).
//
// scripts/react-hooks.mjs resolves the bare specifier "react" here, so the
// module under test imports THIS object without knowing it. Nothing in the
// production code is shaped for testability by it.
//
// It models exactly what useVideoTrim uses: one component, hook slots by call
// order, and commit-phase effects with React's own ordering (every stale
// cleanup runs before any new effect body).

const slots = []
let cursor = 0
let pending = []

function slot(init) {
  const k = cursor++
  if (slots.length <= k) slots[k] = init()
  return slots[k]
}

const React = {
  useRef(initial) {
    return slot(() => ({ current: initial }))
  },
  useState(initial) {
    const s = slot(() => ({
      value: typeof initial === "function" ? initial() : initial,
    }))
    return [s.value, (v) => { s.value = typeof v === "function" ? v(s.value) : v }]
  },
  useEffect(fn, deps) {
    const s = slot(() => ({ deps: null, cleanup: null, first: true }))
    const changed =
      s.first ||
      deps == null ||
      s.deps == null ||
      deps.length !== s.deps.length ||
      deps.some((d, i) => !Object.is(d, s.deps[i]))
    s.deps = deps
    s.first = false
    if (changed) pending.push([s, fn])
  },
}

// One render pass of a component whose whole body is `body`, followed by the
// commit. Call it again to re-render with new props.
export function render(body) {
  cursor = 0
  pending = []
  const out = body()
  const batch = pending
  pending = []
  for (const [s] of batch) if (s.cleanup) { s.cleanup(); s.cleanup = null }
  for (const [s, fn] of batch) s.cleanup = fn() || null
  return out
}

// Unmount: run every live cleanup and forget the slots, so one test file can
// hold several independent scenarios.
export function reset() {
  for (const s of slots) if (s && s.cleanup) s.cleanup()
  slots.length = 0
  cursor = 0
  pending = []
}

export default React
