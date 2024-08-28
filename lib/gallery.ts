import { create } from "zustand"

interface GalleryState {
  isGalleryOpen: boolean
  selectedImageIndex: number
  openGallery: (index: number) => void
  closeGallery: () => void
  nextImage: (maxIndex: number) => void
  prevImage: (maxIndex: number) => void
}

export const useGallery = create<GalleryState>((set) => ({
  isGalleryOpen: false,
  selectedImageIndex: 0,
  openGallery: (index) =>
    set({ isGalleryOpen: true, selectedImageIndex: index }),
  closeGallery: () => set({ isGalleryOpen: false, selectedImageIndex: 0 }),
  nextImage: (maxIndex) =>
    set((state) => ({
      selectedImageIndex: (state.selectedImageIndex! + 1) % maxIndex,
    })),
  prevImage: (maxIndex) =>
    set((state) => ({
      selectedImageIndex: (state.selectedImageIndex! - 1 + maxIndex) % maxIndex,
    })),
}))
