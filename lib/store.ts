import { StateStorage } from "zustand/middleware"
import msgpack from "msgpack-lite"

const getUrlSearch = () => {
  return window.location.search.slice(1)
}

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
  const obj = JSON.parse(value)
  const buffer = msgpack.encode(obj)
  return buffer.toString("base64")
}
function msgDecode(value: string): string {
  const buffer = Buffer.from(value, "base64")
  const obj = msgpack.decode(buffer)
  return JSON.stringify(obj)
}

export const compactUrlLocalStorage: StateStorage = {
  getItem: (key) => {
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
        }
      }
    } else {
      // Otherwise, we should load from localstorage or alternative storage
      return JSON.parse(localStorage.getItem(key) as string)
    }
    return null
  },
  setItem: (key, newValue): void => {
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.set(key, msgEncode(newValue))
    window.history.replaceState(null, "", `?${searchParams.toString()}`)
    localStorage.setItem(key, JSON.stringify(newValue))
  },
  removeItem: (key): void => {
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.delete(key)
    window.location.search = searchParams.toString()
    localStorage.removeItem(key)
  },
}

export const compactUrlOnlyStorage: StateStorage = {
  getItem: (key) => {
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
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.set(key, msgEncode(newValue))
    window.history.replaceState(null, "", `?${searchParams.toString()}`)
  },
  removeItem: (key): void => {
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.delete(key)
    window.location.search = searchParams.toString()
  },
}
