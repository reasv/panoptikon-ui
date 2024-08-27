import msgpack from "msgpack-lite"
import lz4 from "lz4js"

export function decodeQueryParam<T>(
  key: string,
  searchParams?: { [key: string]: string | string[] | undefined }
): T | null {
  if (!searchParams || !searchParams[key]) {
    return null
  }
  try {
    // Get the encoded parameter from the searchParams
    const encodedParam = searchParams[key] as string

    // Base64 decode the parameter
    const compressedBuffer = Buffer.from(encodedParam, "base64")
    const decompressedBuffer = Buffer.from(lz4.decompress(compressedBuffer))
    // Msgpack decode the buffer into an object
    const decodedObject = msgpack.decode(decompressedBuffer) as any
    return decodedObject.state as T
  } catch (error) {
    console.error("Error decoding query parameter:", error)
    return null
  }
}
