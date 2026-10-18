// 鏡頭：640×480，推論用的 video 元素不進 DOM。
// USB 鏡頭長時間運轉偶爾會斷線，監聽 track ended，3 秒後自動重試。

export type CameraStatus = 'off' | 'starting' | 'live' | 'reconnecting' | 'denied' | 'error'

const RETRY_DELAY_MS = 3000

export function useCamera() {
  const status = ref<CameraStatus>('off')
  const errorMessage = ref<string | null>(null)
  const stream = shallowRef<MediaStream | null>(null)

  // 推論用的 video：直接交給 MediaPipe 走 GPU 紋理路徑，不必掛進 DOM
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true

  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = true

  function clearRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  function scheduleRetry() {
    clearRetry()
    status.value = 'reconnecting'
    retryTimer = setTimeout(() => void open(), RETRY_DELAY_MS)
  }

  function releaseStream() {
    for (const track of stream.value?.getTracks() ?? []) {
      track.onended = null
      track.stop()
    }
    stream.value = null
    video.srcObject = null
  }

  async function open() {
    if (stopped) return
    status.value = status.value === 'reconnecting' ? 'reconnecting' : 'starting'
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      if (stopped) {
        for (const track of media.getTracks()) track.stop()
        return
      }
      for (const track of media.getVideoTracks()) {
        track.onended = () => {
          console.warn(`[camera] 鏡頭斷線，${RETRY_DELAY_MS / 1000} 秒後重試`)
          releaseStream()
          if (!stopped) scheduleRetry()
        }
      }
      stream.value = media
      video.srcObject = media
      await video.play()
      status.value = 'live'
      errorMessage.value = null
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      errorMessage.value = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        // 使用者拒絕授權，重試也沒用
        status.value = 'denied'
        return
      }
      console.warn('[camera] 開啟失敗，稍後重試', errorMessage.value)
      scheduleRetry()
    }
  }

  async function start() {
    if (!stopped) return
    stopped = false
    await open()
  }

  function stop() {
    stopped = true
    clearRetry()
    releaseStream()
    status.value = 'off'
  }

  onBeforeUnmount(stop)

  return { video, stream, status, errorMessage, start, stop }
}
