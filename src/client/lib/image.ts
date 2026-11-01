const MAX_SIDE = 1600
const LEAVE_ALONE_BELOW = 300 * 1024

/**
 * Shrinks phone photos in the browser before upload, so product images load quickly on slow connections
 * without a paid image service. If anything fails, the original file is used and the server still checks it.
 */
async function shrink(file: File): Promise<File> {
  if (file.size < LEAVE_ALONE_BELOW) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file
    return new File([blob], 'photo.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

export async function imageUploadForm(file: File, folder: 'products' | 'categories' | 'branding' | 'promotions'): Promise<FormData> {
  const form = new FormData()
  form.set('folder', folder)
  form.set('file', await shrink(file))
  return form
}
