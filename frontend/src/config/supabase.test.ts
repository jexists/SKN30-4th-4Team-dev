import { describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })))
const authStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('./authStorage', () => ({ authStorage }))
vi.mock('./env', () => ({
  ENV: {
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'anon-key',
  },
}))

import './supabase'

describe('Supabase PKCE client', () => {
  it('callback에서 수동 교환하므로 URL의 code를 자동 교환하지 않는다', () => {
    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key',
      {
        auth: {
          storage: authStorage,
          flowType: 'pkce',
          detectSessionInUrl: false,
        },
      },
    )
  })
})
