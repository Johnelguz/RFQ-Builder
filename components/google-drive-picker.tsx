'use client'

import { useState } from 'react'
import type { DriveFileReference } from '@/lib/google-drive'

interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface PickerDocument {
  id?: string
  name?: string
  mimeType?: string
  url?: string
}

interface PickerResponse {
  action: string
  docs?: PickerDocument[]
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

interface PickerInstance {
  setVisible(visible: boolean): void
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setCallback(callback: (response: PickerResponse) => void): PickerBuilder
  build(): PickerInstance
}

interface GoogleDrivePickerApi {
  View: new (viewId: string) => unknown
  PickerBuilder: new () => PickerBuilder
  Action: { PICKED: string; CANCEL: string }
}

interface GoogleApi {
  load(api: string, options: { callback: () => void; onerror: () => void }): void
  picker?: GoogleDrivePickerApi
}

interface GoogleIdentityApi {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string
        scope: string
        callback: (response: GoogleTokenResponse) => void
        error_callback: (error: { message?: string }) => void
      }): TokenClient
    }
  }
}

declare global {
  interface Window {
    gapi?: GoogleApi
    google?: GoogleIdentityApi
  }
}

function loadScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null
    if (existing?.dataset.loaded === 'true') {
      resolve()
      return
    }

    const script = existing || document.createElement('script')
    const handleLoad = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    const handleError = () => reject(new Error(`Unable to load Google Drive Picker script: ${src}`))

    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    if (!existing) {
      script.id = id
      script.src = src
      script.async = true
      document.head.appendChild(script)
    }
  })
}

function loadPickerApi(gapi: GoogleApi) {
  return new Promise<void>((resolve, reject) => {
    gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Unable to load Google Drive Picker.')) })
  })
}

function requestDriveToken(identity: GoogleIdentityApi, clientId: string) {
  return new Promise<string>((resolve, reject) => {
    const tokenClient = identity.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: response => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google did not provide a Drive access token.'))
          return
        }
        resolve(response.access_token)
      },
      error_callback: error => reject(new Error(error.message || 'Google authorization failed.'))
    })
    tokenClient.requestAccessToken({ prompt: '' })
  })
}

export function GoogleDrivePickerButton({
  onSelect,
  disabled = false
}: {
  onSelect: (file: DriveFileReference) => Promise<void>
  disabled?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
    if (!apiKey || !clientId) {
      setError('Google Drive Picker is not configured. Set the public Picker API key and OAuth client ID.')
      return
    }

    setLoading(true)
    try {
      await Promise.all([
        loadScript('google-identity-services', 'https://accounts.google.com/gsi/client'),
        loadScript('google-picker-api', 'https://apis.google.com/js/api.js')
      ])
      const identity = window.google
      const gapi = window.gapi
      if (!identity || !gapi) throw new Error('Google Drive Picker did not initialize.')

      const accessToken = await requestDriveToken(identity, clientId)
      await loadPickerApi(gapi)
      if (!gapi.picker) throw new Error('Google Drive Picker is unavailable.')

      await new Promise<void>((resolve, reject) => {
        const picker = new gapi.picker!.PickerBuilder()
          .addView(new gapi.picker!.View('DOCS'))
          .setOAuthToken(accessToken)
          .setDeveloperKey(apiKey)
          .setCallback(response => {
            if (response.action === gapi.picker!.Action.CANCEL) {
              resolve()
              return
            }
            if (response.action !== gapi.picker!.Action.PICKED) return
            const selected = response.docs?.[0]
            if (!selected?.id || !selected.name) {
              reject(new Error('Google Drive did not return the selected file details.'))
              return
            }
            void onSelect({
              id: selected.id,
              name: selected.name,
              mimeType: selected.mimeType || null,
              url: selected.url || `https://drive.google.com/file/d/${encodeURIComponent(selected.id)}/view`
            }).then(resolve, reject)
          })
          .build()
        picker.setVisible(true)
      })
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : 'Unable to open Google Drive Picker.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => void handleClick()}
        className="rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Connecting to Drive…' : 'Attach from Drive'}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
