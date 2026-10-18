// 疊加繪製：臉框與手部骨架。
// canvas 跟預覽一起被 CSS scaleX(-1) 鏡像，座標照原始影像畫即可；
// 只有文字會被翻成反的，要在繪製時局部再翻一次。
import type { FaceFact, HandFact } from '../perception/types'

export interface OverlayStyle {
  faceColor: string
  handColor: string
  wristColor: string
}

export interface OverlayInput {
  face: FaceFact | null
  hand: HandFact | null
  connections: ReadonlyArray<{ start: number; end: number }>
  /** 預覽是否鏡像；決定文字要不要局部翻回來 */
  mirrored: boolean
  style: OverlayStyle
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  mirrored: boolean,
) {
  ctx.save()
  ctx.translate(x, y)
  if (mirrored) ctx.scale(-1, 1)
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  // 鏡像後原本的左上角會跑到右上角，文字往反方向對齊才會貼著框
  ctx.textAlign = mirrored ? 'right' : 'left'
  const width = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(mirrored ? -width - 6 : 0, -20, width + 6, 20)
  ctx.fillStyle = '#fff'
  ctx.fillText(text, mirrored ? -3 : 3, -3)
  ctx.restore()
}

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  const { face, hand, connections, mirrored, style } = input

  if (face) {
    const x = face.box.x * width
    const y = face.box.y * height
    const w = face.box.width * width
    const h = face.box.height * height
    ctx.lineWidth = 3
    ctx.strokeStyle = style.faceColor
    ctx.strokeRect(x, y, w, h)
    // 鏡像時框的視覺左上角是原始座標的右上角
    // 框貼著畫面頂端時，標籤改畫在框內，免得超出 canvas
    const labelY = y < 22 ? y + 22 : y
    drawLabel(ctx, `臉寬比 ${face.widthRatio.toFixed(2)}`, mirrored ? x + w : x, labelY, mirrored)
  }

  if (hand) {
    const px = (i: number) => {
      const p = hand.landmarks[i]
      return p ? { x: p.x * width, y: p.y * height } : null
    }
    ctx.lineWidth = 2
    ctx.strokeStyle = style.handColor
    ctx.beginPath()
    for (const { start, end } of connections) {
      const a = px(start)
      const b = px(end)
      if (!a || !b) continue
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()

    ctx.fillStyle = style.handColor
    for (let i = 0; i < hand.landmarks.length; i++) {
      const p = px(i)
      if (!p) continue
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // 手腕是揮手判定追蹤的點，標大一點
    const wrist = { x: hand.wrist.x * width, y: hand.wrist.y * height }
    ctx.fillStyle = style.wristColor
    ctx.beginPath()
    ctx.arc(wrist.x, wrist.y, 7, 0, Math.PI * 2)
    ctx.fill()
    if (hand.gesture) {
      drawLabel(ctx, `${hand.gesture.name} ${hand.gesture.score.toFixed(2)}`, wrist.x, wrist.y + 30, mirrored)
    }
  }
}
