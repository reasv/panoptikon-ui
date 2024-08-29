import { create } from "zustand"

interface GalleryState {
  isGalleryOpen: boolean
  selectedImageIndex: number
  horizontalThumbnails: boolean
  openGallery: (index: number) => void
  closeGallery: () => void
  nextImage: (maxIndex: number) => void
  prevImage: (maxIndex: number) => void
  setIndex: (index: number) => void
  setThumbnailsOpen: (open: boolean) => void
  getImageIndex: (maxIndex: number) => number
}

export const useGallery = create<GalleryState>((set, get) => ({
  isGalleryOpen: false,
  selectedImageIndex: 0,
  horizontalThumbnails: true,
  getImageIndex: (maxIndex) => get().selectedImageIndex! % maxIndex,
  setThumbnailsOpen: (open) => set({ horizontalThumbnails: open }),
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
  setIndex: (index) => set({ selectedImageIndex: index }),
}))
