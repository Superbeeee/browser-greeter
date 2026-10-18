// 所有判定門檻集中在這裡。數值依我的鏡頭（約 1 公尺、640×480）校準，換環境要重調。

export interface PresenceConfig {
  /** idle → approaching：臉寬比達到這個值 */
  enterRatio: number
  /** 低於這個值視為「不夠近」；比 enterRatio 小一截形成遲滯，避免在門檻附近來回跳 */
  exitRatio: number
  /** approaching 要持續滿這麼久才 greeted，濾掉路過的人 */
  dwellMs: number
  /** greeted 停留多久後進 cooldown（讓招呼顯示完） */
  greetHoldMs: number
  /** cooldown 中，人離開（沒臉或不夠近）滿這麼久才回 idle */
  absentMs: number
  /** approaching 中臉短暫消失的寬限，避免掉幀被當成離開 */
  faceLostGraceMs: number
}

export interface WaveConfig {
  /** 只看最近這段時間內的折返點 */
  windowMs: number
  /** 時間視窗內至少要折返幾次 */
  minReversals: number
  /** 視窗內手腕 x 的最大擺幅（正規化座標） */
  minAmplitude: number
  /** 反向移動超過這個距離才算折返，濾掉抖動 */
  deadband: number
  /** 手短暫沒偵測到的寬限，超過就清掉軌跡 */
  dropoutGraceMs: number
  /** 判定揮手後這段時間內不再觸發 */
  refractoryMs: number
}

export const PRESENCE_CONFIG: PresenceConfig = {
  enterRatio: 0.22,
  exitRatio: 0.17,
  dwellMs: 1000,
  greetHoldMs: 2500,
  absentMs: 2000,
  faceLostGraceMs: 400,
}

export const WAVE_CONFIG: WaveConfig = {
  windowMs: 1200,
  minReversals: 3,
  minAmplitude: 0.08,
  deadband: 0.02,
  dropoutGraceMs: 400,
  refractoryMs: 1500,
}

/** 偵測迴圈的目標頻率 */
export const DETECTION_FPS = {
  face: 8,
  /** 揮手一下只有 300~500ms，需要更密的採樣 */
  wave: 12,
} as const
