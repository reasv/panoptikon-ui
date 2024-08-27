import { StateStorage } from "zustand/middleware"
import msgpack from "msgpack-lite"
import lz4 from "lz4js"
const getUrlSearch = () => {
  return window.location.search.slice(1)
}
const isClient = typeof window !== "undefined"

export const persistLocalStorage: StateStorage = {
  getItem: (key): string => {
    return JSON.parse(localStorage.getItem(key) as string)
  },
  setItem: (key, newValue): void => {
    localStorage.setItem(key, JSON.stringify(newValue))
  },
  removeItem: (key): void => {
    localStorage.removeItem(key)
  },
}
function msgEncode(value: string): string {
  // Parse the JSON string into an object
  const obj = JSON.parse(value)
  const buffer = msgpack.encode(obj)
  const compressedBuffer = Buffer.from(lz4.compress(buffer))
  return compressedBuffer.toString("base64")
}

function msgDecode(value: string): string {
  const compressedBuffer = Buffer.from(value, "base64")
  const decompressedBuffer = Buffer.from(lz4.decompress(compressedBuffer))
  const obj = msgpack.decode(decompressedBuffer)

  // Convert the object back to a JSON string
  return JSON.stringify(obj)
}

export const compactUrlOnlyStorage: StateStorage = {
  getItem: (key) => {
    if (!isClient) {
      return null
    }
    // Check URL first
    if (getUrlSearch()) {
      const searchParams = new URLSearchParams(getUrlSearch())
      const storedValue = searchParams.get(key) as string
      if (storedValue) {
        try {
          return msgDecode(storedValue)
        } catch (e) {
          console.error(e)
          const searchParams = new URLSearchParams(getUrlSearch())
          searchParams.delete(key)
          window.location.search = searchParams.toString()
          return null
        }
      }
    }
    return null
  },
  setItem: (key, newValue): void => {
    if (!isClient) {
      return
    }
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.set(key, msgEncode(newValue))
    window.history.replaceState(null, "", `?${searchParams.toString()}`)
  },
  removeItem: (key): void => {
    if (!isClient) {
      return
    }
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.delete(key)
    window.location.search = searchParams.toString()
  },
}
