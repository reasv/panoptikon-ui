import { StateStorage } from "zustand/middleware"

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
