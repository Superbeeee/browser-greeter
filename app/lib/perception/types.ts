// 感知層：只回報「這一幀看到什麼」，沒有狀態、沒有判斷。
// 判定層只依賴這個檔案的型別，不知道背後是哪個偵測引擎。

/** GestureRecognizer 內建（canned）的靜態手勢分類 */
export const GESTURE_NAMES = [
  'None',
  'Closed_Fist',
  'Open_Palm',
  'Pointing_Up',
  'Thumb_Down',
  'Thumb_Up',
  'Victory',
  'ILoveYou',
] as const
export type GestureName = (typeof GESTURE_NAMES)[number]

export type Delegate = 'GPU' | 'CPU'

/** 正規化座標，0~1，相對於影像寬高（未鏡像） */
export interface Point2D {
  x: number
  y: number
}

export interface Landmark extends Point2D {
  /** 相對深度，以手腕為基準，數值越小越靠近鏡頭 */
  z: number
}

export interface NormalizedBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FaceFact {
  /** 臉框寬度 / 影像寬度，距離的代理指標：越近越大 */
  widthRatio: number
  /** 偵測信心值 0~1；畫面上有多張臉時取最高的那張 */
  score: number
  box: NormalizedBox
}

export interface HandFact {
  /** 靜態手勢分類，模型沒給分類時為 null */
  gesture: { name: GestureName; score: number } | null
  /** 21 個關節點，固定編號：0 手腕、4 拇指尖、8 食指尖、20 小指尖 */
  landmarks: readonly Landmark[]
  /** 手腕座標，等同 landmarks[0] */
  wrist: Point2D
}

/** 單一幀的事實 */
export interface FrameFacts {
  /** 推論時使用的 timestamp（performance.now()），與節流共用同一個值 */
  t: number
  face: FaceFact | null
  hand: HandFact | null
  /** 手勢模型這一幀有沒有在跑；用來區分「沒有手」與「沒有在看手」 */
  handTracking: boolean
  /**
   * 引擎直接給的「正在揮手」機率。給沒有手部關節點、無法追蹤手腕軌跡的引擎用（JevImageProvider）。
   * v2 新增：v1 的介面假設所有引擎都能給關節點。
   */
  waving?: number
}

export interface ProviderInfo {
  /** 臉部偵測跑在哪裡；遠端引擎為 'remote' */
  face: Delegate | 'remote'
  /** 手勢模型尚未載入時為 null */
  gesture: Delegate | 'remote' | null
}

export interface PerceptionProvider {
  readonly name: string
  /** 載入 runtime 與臉部模型 */
  init(): Promise<ProviderInfo>
  /** 開關手勢追蹤；第一次開啟時才載入手勢模型 */
  setHandTracking(enabled: boolean): Promise<ProviderInfo>
  /**
   * 對一幀做推論；t 必須單調遞增。
   * v2 改成非同步：遠端引擎（JevImageProvider）要打網路。呼叫端保證同一時間只有一個在途。
   */
  detect(video: HTMLVideoElement, t: number): Promise<FrameFacts>
  dispose(): void
}
