// jest-dom 匹配器（With Vitest）与 RTL 每个测试后的自动清理（RTL Setup: Auto Cleanup in Vitest）。
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
