export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message)
  }
}

type Init = { method?: string; body?: unknown; formData?: FormData; signal?: AbortSignal }

export async function api<T = any>(path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = {}
  let body: BodyInit | undefined
  if (init.formData) body = init.formData
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  let response: Response
  try {
    response = await fetch(`/api${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, signal: init.signal, credentials: 'same-origin' })
  } catch {
    throw new ApiRequestError(0, 'OFFLINE', 'You appear to be offline. Check your connection and try again.')
  }
  const text = await response.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const error = data?.error
    throw new ApiRequestError(response.status, error?.code ?? 'ERROR', error?.message ?? 'Something went wrong. Please try again.', error?.details)
  }
  return data as T
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.')

export const mediaUrl = (key: string | null | undefined) => (key ? `/media/${key}` : null)
