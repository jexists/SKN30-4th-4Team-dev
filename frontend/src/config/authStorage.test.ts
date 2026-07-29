import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authStorage, keepSignedIn, savedEmail } from './authStorage'

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

describe('savedEmail', () => {
  it('저장된 값이 없으면 null 을 돌려준다', () => {
    expect(savedEmail.get()).toBeNull()
  })

  it('set 으로 저장한 이메일을 get 으로 그대로 돌려받는다', () => {
    savedEmail.set('user@example.com')
    expect(savedEmail.get()).toBe('user@example.com')
  })

  it('clear 로 지우면 다시 null 이 된다', () => {
    savedEmail.set('user@example.com')
    savedEmail.clear()
    expect(savedEmail.get()).toBeNull()
  })

  it('빈 문자열이나 공백만 저장돼 있으면 null 로 취급한다', () => {
    savedEmail.set('')
    expect(savedEmail.get()).toBeNull()

    savedEmail.set('   ')
    expect(savedEmail.get()).toBeNull()
  })

  it('앞뒤 공백은 떼고 저장한다', () => {
    savedEmail.set('  user@example.com  ')

    expect(window.localStorage.getItem('homeshield.savedEmail')).toBe('user@example.com')
    expect(savedEmail.get()).toBe('user@example.com')
  })

  it('저장소가 예외를 던져도 밖으로 새지 않고 null 로 취급한다', () => {
    const broken = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(broken as unknown as Storage)

    expect(() => savedEmail.set('user@example.com')).not.toThrow()
    expect(savedEmail.get()).toBeNull()
    expect(() => savedEmail.clear()).not.toThrow()

    vi.restoreAllMocks()
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

  // 사파리 프라이빗 모드·쿠키 차단에서는 저장소 접근 자체가 던진다. 그 예외가 새어 나가면
  // Supabase 세션 처리(=로그인)가 통째로 실패하므로 어댑터 안에서 삼켜야 한다.
  it('저장소가 예외를 던져도 밖으로 새지 않는다', () => {
    const broken = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(broken as unknown as Storage)

    expect(() => authStorage.setItem(KEY, 'x')).not.toThrow()
    expect(() => authStorage.removeItem(KEY)).not.toThrow()
    // localStorage 가 죽어도 sessionStorage 쪽은 그대로 읽는다.
    window.sessionStorage.setItem(KEY, 'alive')
    expect(authStorage.getItem(KEY)).toBe('alive')

    vi.restoreAllMocks()
  })
})
