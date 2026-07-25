import { beforeEach, describe, expect, it } from 'vitest'

import { authStorage, keepSignedIn } from './authStorage'

const KEY = 'sb-test-auth-token'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('keepSignedIn', () => {
  it('저장된 선택이 없으면 기본은 유지(true)다', () => {
    expect(keepSignedIn.get()).toBe(true)
  })

  it('set(false) 이후에는 false 를 돌려준다', () => {
    keepSignedIn.set(false)
    expect(keepSignedIn.get()).toBe(false)
  })
})

describe('authStorage', () => {
  it('유지 ON 이면 localStorage 에만 저장한다', () => {
    keepSignedIn.set(true)
    authStorage.setItem(KEY, 'token-1')

    expect(window.localStorage.getItem(KEY)).toBe('token-1')
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('유지 OFF 이면 sessionStorage 에만 저장한다', () => {
    keepSignedIn.set(false)
    authStorage.setItem(KEY, 'token-2')

    expect(window.sessionStorage.getItem(KEY)).toBe('token-2')
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('getItem 은 어느 저장소에 있든 찾아낸다', () => {
    window.sessionStorage.setItem(KEY, 'from-session')
    expect(authStorage.getItem(KEY)).toBe('from-session')

    window.sessionStorage.clear()
    window.localStorage.setItem(KEY, 'from-local')
    expect(authStorage.getItem(KEY)).toBe('from-local')
  })

  it('모드를 바꿔 다시 저장하면 반대쪽 잔여값을 지운다', () => {
    keepSignedIn.set(true)
    authStorage.setItem(KEY, 'first') // localStorage 에 기록

    keepSignedIn.set(false)
    authStorage.setItem(KEY, 'second') // 이제 sessionStorage 로, localStorage 잔여값 제거

    expect(window.sessionStorage.getItem(KEY)).toBe('second')
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('removeItem 은 양쪽 저장소를 모두 비운다', () => {
    window.localStorage.setItem(KEY, 'a')
    window.sessionStorage.setItem(KEY, 'b')

    authStorage.removeItem(KEY)

    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })
})
