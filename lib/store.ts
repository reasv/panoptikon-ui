import { StateStorage } from "zustand/middleware"
import msgpack from "msgpack-lite"

const getUrlSearch = () => {
  return window.location.search.slice(1)
}

export const urlStorage: StateStorage = {
  getItem: (key): string => {
    // Check URL first
    if (getUrlSearch()) {
      const searchParams = new URLSearchParams(getUrlSearch())
      const storedValue = searchParams.get(key)
      return JSON.parse(storedValue as string)
    } else {
      // Otherwise, we should load from localstorage or alternative storage
      return JSON.parse(localStorage.getItem(key) as string)
    }
  },
  setItem: (key, newValue): void => {
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.set(key, JSON.stringify(newValue))
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

export const persistentStorage: StateStorage = {
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

export const compactUrlLocalStorage: StateStorage = {
  getItem: (key) => {
    // Check URL first
    if (getUrlSearch()) {
      const searchParams = new URLSearchParams(getUrlSearch())
      const storedValue = searchParams.get(key) as string
      if (storedValue) {
        try {
          const buffer = Buffer.from(storedValue, "base64")
          return msgpack.decode(buffer)
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
    searchParams.set(key, msgpack.encode(newValue).toString("base64"))
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
          const buffer = Buffer.from(storedValue, "base64")
          return msgpack.decode(buffer)
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
    searchParams.set(key, msgpack.encode(newValue).toString("base64"))
    window.history.replaceState(null, "", `?${searchParams.toString()}`)
  },
  removeItem: (key): void => {
    const searchParams = new URLSearchParams(getUrlSearch())
    searchParams.delete(key)
    window.location.search = searchParams.toString()
  },
}
