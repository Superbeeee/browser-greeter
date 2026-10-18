// 實測頻率：統計最近 windowMs 內發生幾次，換算成每秒次數

export function createRateMeter(windowMs = 1000) {
  const stamps: number[] = []
  return {
    tick(t: number): void {
      stamps.push(t)
    },
    rate(now: number): number {
      while (stamps.length > 0 && now - stamps[0]! > windowMs) stamps.shift()
      return (stamps.length * 1000) / windowMs
    },
  }
}
