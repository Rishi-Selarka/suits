import { useState, useCallback } from 'react'
import { type UploadResponse, uploadDocument } from '@/api/client'

export function useFileUpload() {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const upload = useCallback(async (file: File) => {
    setIsUploading(true)
    setError(null)
    setUploadResult(null)

    try {
      const result = await uploadDocument(file)
      setUploadResult(result)
      return result
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Upload failed'
      setError(message)
      return null
    } finally {
      setIsUploading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setIsUploading(false)
    setUploadResult(null)
    setError(null)
    setDragActive(false)
  }, [])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        return upload(files[0])
      }
      return null
    },
    [upload],
  )

  return {
    isUploading,
    uploadResult,
    error,
    dragActive,
    upload,
    reset,
    handleDrag,
    handleDrop,
  }
}
