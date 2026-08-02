export class MinHeap<T> {
  private values: Array<{ value: T; priority: number }> = []

  get size() {
    return this.values.length
  }

  push(value: T, priority: number) {
    this.values.push({ value, priority })
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.values[parent]!.priority <= priority) break
      this.values[index] = this.values[parent]!
      index = parent
    }
    this.values[index] = { value, priority }
  }

  pop(): T | undefined {
    const root = this.values[0]
    const tail = this.values.pop()
    if (!root) return undefined
    if (!tail || this.values.length === 0) return root.value

    let index = 0
    this.values[0] = tail
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (
        left < this.values.length &&
        this.values[left]!.priority < this.values[smallest]!.priority
      ) {
        smallest = left
      }
      if (
        right < this.values.length &&
        this.values[right]!.priority < this.values[smallest]!.priority
      ) {
        smallest = right
      }
      if (smallest === index) break
      const swap = this.values[index]!
      this.values[index] = this.values[smallest]!
      this.values[smallest] = swap
      index = smallest
    }
    return root.value
  }
}
