import msgpack from "msgpack-lite"

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
    const buffer = Buffer.from(encodedParam, "base64")

    // Msgpack decode the buffer into an object
    const decodedObject = msgpack.decode(buffer) as any
    return decodedObject["state"] as T
  } catch (error) {
    console.error("Error decoding query parameter:", error)
    return null
  }
}
