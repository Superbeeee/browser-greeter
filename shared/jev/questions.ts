// 題組定義。前端只送題組 ID，題目內容、題數與模型都由 server 決定。
import type { BoxQuestion, ChoiceQuestion, NoulQuestion } from '@typesafe-ai/sdk'

export const INTENT_LABELS = ['engage', 'passing'] as const
export const MOTION_LABELS = ['approaching', 'staying', 'leaving'] as const
export type IntentLabel = (typeof INTENT_LABELS)[number]
export type MotionLabel = (typeof MOTION_LABELS)[number]

/** Hybrid：對 MediaPipe 事實的文字摘要做判斷 */
export const HYBRID_QUESTIONS = {
  intent: {
    type: 'choice',
    instructions:
      '這段文字是螢幕前鏡頭在最近幾秒觀察到的一個人。判斷這個人是想跟螢幕互動，還是只是路過。',
    criteria: {
      engage: '想互動：靠近後停留在鏡頭前、距離穩定或持續靠近，或主動對鏡頭揮手',
      passing: '只是路過：短暫出現、距離沒有停留、正在變遠或離開',
    },
  },
  waving: {
    type: 'noul',
    instructions: '根據這段鏡頭觀察摘要，這個人現在是否正在對鏡頭揮手？',
    criteria: {
      true: '手腕在短時間內左右來回擺動多次，擺幅明顯',
      false: '沒有偵測到手、手大致靜止，或只是單向移動一次',
    },
  },
  motion: {
    type: 'choice',
    instructions: '根據這段鏡頭觀察摘要，這個人相對鏡頭的移動方向是什麼？臉寬比越大代表離鏡頭越近。',
    criteria: {
      approaching: '正在靠近：臉寬比持續變大',
      staying: '停留：臉寬比大致不變',
      leaving: '正在離開：臉寬比持續變小，或臉已經消失',
    },
  },
} as const satisfies {
  intent: ChoiceQuestion<Record<IntentLabel, string>>
  waving: NoulQuestion
  motion: ChoiceQuestion<Record<MotionLabel, string>>
}

/** Image（實驗性）：直接看一張鏡頭畫面 */
export const IMAGE_QUESTIONS = {
  person: {
    type: 'noul',
    instructions: '這張鏡頭畫面裡是否有一張清楚可見的人臉？',
    criteria: {
      true: '畫面中至少有一張人臉，五官大致可辨識',
      false: '畫面中沒有人，或只有背影、局部肢體、無法辨識的模糊人形',
    },
  },
  face: {
    type: 'box',
    instructions: '畫面中最大、最靠近鏡頭的那張人臉（只框臉，不含頭髮與脖子）',
  },
  waving: {
    type: 'noul',
    instructions: '這張鏡頭畫面裡的人是否正在對鏡頭揮手？',
    criteria: {
      true: '有人舉起張開的手掌朝向鏡頭，姿勢像在打招呼或揮手',
      false: '沒有人、手放下，或手的姿勢不像在揮手',
    },
  },
} as const satisfies {
  person: NoulQuestion
  face: BoxQuestion
  waving: NoulQuestion
}

export const QUESTION_SETS = {
  hybrid: HYBRID_QUESTIONS,
  image: IMAGE_QUESTIONS,
} as const

export type QuestionSetId = keyof typeof QUESTION_SETS
