import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button, Card, Input, Notice, Spinner } from './ui'

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      client.clear()
      window.location.assign(window.location.pathname.startsWith('/rider') ? '/rider' : '/admin')
    },
  })
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-cream px-4 py-10">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-3xl">{title}</h1>
        {children}
      </Card>
    </div>
  )
}

export function SignIn({ title, allowSetup }: { title: string; allowSetup?: boolean }) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['bootstrap'], queryFn: () => api<{ needed: boolean }>('/auth/bootstrap-status'), enabled: allowSetup, staleTime: 0 })
  const [form, setForm] = useState({ email: '', password: '', name: '', token: '' })
  const login = useMutation({
    mutationFn: () => api('/auth/login', { body: { email: form.email, password: form.password } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  })
  const setup = useMutation({
    mutationFn: async () => {
      await api('/auth/bootstrap', { body: { token: form.token, name: form.name, email: form.email, password: form.password } })
      await api('/auth/login', { body: { email: form.email, password: form.password } })
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  })
  if (allowSetup && status.isPending) return <Spinner />
  const settingUp = allowSetup && status.data?.needed
  const mutation = settingUp ? setup : login
  return (
    <Shell title={settingUp ? 'First-time setup' : title}>
      {settingUp && <Notice className="mt-3" tone="info">Create the first administrator account. You need the setup token that was stored as a secret when this site was deployed. See the README.</Notice>}
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
        {settingUp && <Input label="Setup token" type="password" autoComplete="off" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} />}
        {settingUp && <Input label="Your name" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
        <Input label="Email" type="email" autoComplete="username" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <Input label="Password" type="password" autoComplete={settingUp ? 'new-password' : 'current-password'} hint={settingUp ? 'At least 10 characters.' : undefined} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        {mutation.error && <Notice tone="bad">{errorMessage(mutation.error)}</Notice>}
        <Button type="submit" full size="lg" loading={mutation.isPending} disabled={!form.email || !form.password}>{settingUp ? 'Create administrator' : 'Sign in'}</Button>
      </form>
    </Shell>
  )
}

export function ChangePassword() {
  const client = useQueryClient()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', again: '' })
  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { body: { currentPassword: form.currentPassword, newPassword: form.newPassword } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  })
  const mismatch = form.again.length > 0 && form.again !== form.newPassword
  return (
    <Shell title="Choose a new password">
      <p className="mt-2 text-sm text-ink-soft">You signed in with a temporary password. Choose your own to continue.</p>
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); change.mutate() }}>
        <Input label="Temporary password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} />
        <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters." value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} />
        <Input label="New password again" type="password" autoComplete="new-password" error={mismatch ? 'The passwords do not match' : undefined} value={form.again} onChange={(event) => setForm({ ...form, again: event.target.value })} />
        {change.error && <Notice tone="bad">{errorMessage(change.error)}</Notice>}
        <Button type="submit" full size="lg" loading={change.isPending} disabled={form.newPassword.length < 10 || mismatch || !form.currentPassword}>Save password</Button>
      </form>
    </Shell>
  )
}
