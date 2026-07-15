export type PanoptikonPage = "search" | "scan"

export function openPanoptikonPage(page: PanoptikonPage, indexDb: string): Promise<void> {
  const invoke = window.__TAURI__?.core?.invoke
  if (invoke) {
    return invoke("open_panoptikon_page", { page, indexDb })
  }

  const url = new URL(`/${page}`, window.location.origin)
  url.searchParams.set("index_db", indexDb)
  window.open(url, "_blank", "noopener,noreferrer")
  return Promise.resolve()
}
