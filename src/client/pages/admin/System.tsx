import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_LABELS, ROLES, type Role } from '../../../shared/permissions'
import { TICKET_TYPE_LABELS } from '../../../shared/schemas'
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Input, Notice, Pagination, QueryError, Select, Spinner, Textarea } from '../../components/ui'
import { mediaUrl } from '../../lib/api'
import { imageUploadForm } from '../../lib/image'
import { formatDateTime } from '../../lib/format'
import { ErrorNote, MoneyInput, PageHead, Table, td, useAdminQuery, useCan, useDo, useMe } from './shared'

export function Staff() {
  const me = useMe().data
  const list = useAdminQuery<{ staff: Array<{ id: string; name: string; email: string; phone: string; role: Role; is_active: number; must_change_password: number; last_login_at: string | null }> }>('/system/staff')
  const [editing, setEditing] = useState<null | { id?: string; name: string; email: string; phone: string; role: Role; isActive: boolean; password: string }>(null)
  const act = useDo(() => setEditing(null))
  const assignable = ROLES.filter((role) => role !== 'RIDER')
  return (
    <>
      <PageHead title="Staff" sub="Each role can only do its own job. This is enforced on the server, not just by hiding screens."><Button size="sm" onClick={() => setEditing({ name: '', email: '', phone: '', role: 'OPERATIONS', isActive: true, password: '' })}><Plus className="size-4" /> Add staff member</Button></PageHead>
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : (
        <Table head={['Name', 'Role', 'Last sign-in', 'Account', '']}>
          {list.data.staff.map((s) => <tr key={s.id}><td className={td}><span className="font-semibold">{s.name}</span><div className="text-xs text-ink-soft">{s.email}</div></td><td className={td}>{ROLE_LABELS[s.role]}</td><td className={td}>{s.last_login_at ? formatDateTime(s.last_login_at) : 'Never'}{s.must_change_password ? <div><Badge tone="warn">Must change password</Badge></div> : null}</td><td className={td}>{s.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Off</Badge>}</td><td className={td}><Button size="sm" variant="ghost" onClick={() => setEditing({ id: s.id, name: s.name, email: s.email, phone: s.phone, role: s.role, isActive: !!s.is_active, password: '' })}>{s.id === me?.id ? 'Edit (you)' : 'Edit'}</Button></td></tr>)}
        </Table>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? 'Edit staff member' : 'Add staff member'}>
        {editing && <div className="space-y-3">
          <Input label="Name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          <Input label="Email (used to sign in)" type="email" disabled={Boolean(editing.id)} value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} />
          <Input label="Phone" optional value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} />
          <Select label="Role" value={editing.role} onChange={(event) => setEditing({ ...editing, role: event.target.value as Role })}>{assignable.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</Select>
          <Input label={editing.id ? 'New temporary password' : 'Temporary password'} optional={Boolean(editing.id)} hint="At least 10 characters. They must change it when they next sign in." value={editing.password} onChange={(event) => setEditing({ ...editing, password: event.target.value })} />
          {editing.id && <Checkbox label="Account is active" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />}
          <ErrorNote error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Back</Button><Button loading={act.isPending} disabled={!editing.name.trim() || (!editing.id && (!editing.email || editing.password.length < 10)) || (editing.password.length > 0 && editing.password.length < 10)} onClick={() => act.mutate(editing.id ? { path: `/system/staff/${editing.id}`, method: 'PATCH', body: { name: editing.name.trim(), phone: editing.phone, role: editing.role, isActive: editing.isActive, ...(editing.password ? { temporaryPassword: editing.password } : {}) } } : { path: '/system/staff', body: { name: editing.name.trim(), email: editing.email, phone: editing.phone, role: editing.role, temporaryPassword: editing.password } })}>Save</Button></div>
        </div>}
      </Dialog>
    </>
  )
}

type ZoneRow = {
  id: string; name: string; slug: string; pin_codes: string; min_order_paise: number; delivery_charge_paise: number; small_order_below_paise: number; small_order_charge_paise: number
  free_above_paise: number | null; quote_only: number; estimated_time: string; own_rider_enabled: number; third_party_enabled: number; publish_landing_page: number; landing_description: string; is_active: number
  slots: Array<{ id: string; label: string; is_active: number }>
}
type ZoneForm = { id?: string; name: string; pinCodes: string; minOrder: number | null; charge: number | null; smallBelow: number | null; smallCharge: number | null; freeAbove: number | null; quoteOnly: boolean; estimatedTime: string; own: boolean; third: boolean; landing: boolean; landingText: string; active: boolean; slots: Array<{ id?: string; label: string; isActive: boolean }> }

export function Zones() {
  const list = useAdminQuery<{ zones: ZoneRow[] }>('/system/zones')
  const [form, setForm] = useState<ZoneForm | null>(null)
  const act = useDo(() => setForm(null))
  const blank: ZoneForm = { name: '', pinCodes: '', minOrder: 0, charge: 0, smallBelow: 0, smallCharge: 0, freeAbove: null, quoteOnly: false, estimatedTime: '', own: true, third: false, landing: false, landingText: '', active: false, slots: [{ label: '', isActive: true }] }
  const edit = (z: ZoneRow): ZoneForm => ({ id: z.id, name: z.name, pinCodes: z.pin_codes.split(',').join(', '), minOrder: z.min_order_paise, charge: z.delivery_charge_paise, smallBelow: z.small_order_below_paise, smallCharge: z.small_order_charge_paise, freeAbove: z.free_above_paise, quoteOnly: !!z.quote_only, estimatedTime: z.estimated_time, own: !!z.own_rider_enabled, third: !!z.third_party_enabled, landing: !!z.publish_landing_page, landingText: z.landing_description, active: !!z.is_active, slots: z.slots.map((s) => ({ id: s.id, label: s.label, isActive: !!s.is_active })) })
  const save = () => form && act.mutate({
    path: form.id ? `/system/zones/${form.id}` : '/system/zones', method: form.id ? 'PUT' : 'POST',
    body: { name: form.name.trim(), pinCodes: form.pinCodes, minOrderPaise: form.minOrder ?? 0, deliveryChargePaise: form.charge ?? 0, smallOrderBelowPaise: form.smallBelow ?? 0, smallOrderChargePaise: form.smallCharge ?? 0, freeAbovePaise: form.freeAbove, quoteOnly: form.quoteOnly, estimatedTime: form.estimatedTime, ownRiderEnabled: form.own, thirdPartyEnabled: form.third, publishLandingPage: form.landing, landingDescription: form.landingText, isActive: form.active, slots: form.slots.filter((s) => s.label.trim()).map((s) => ({ ...s, label: s.label.trim() })) },
  })
  return (
    <>
      <PageHead title="Delivery zones" sub="Only active zones are shown to customers. Listing an area here does not mean you can deliver there yet."><Button size="sm" onClick={() => setForm(blank)}><Plus className="size-4" /> Add zone</Button></PageHead>
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : list.data.zones.length === 0 ? <EmptyState title="No zones yet">Add the places you can really deliver to, such as Kharar Main Market or Sunny Enclave.</EmptyState> : (
        <Table head={['Zone', 'PIN codes', 'Delivery', 'Minimum', 'Slots', 'Status', '']}>
          {list.data.zones.map((z) => <tr key={z.id}><td className={td}><span className="font-semibold">{z.name}</span><div className="text-xs text-ink-soft">{z.estimated_time}</div></td><td className={td}>{z.pin_codes.split(',').join(', ')}</td><td className={td}>{z.quote_only ? 'Quoted by us' : `₹${z.delivery_charge_paise / 100}`}</td><td className={td}>₹{z.min_order_paise / 100}</td><td className={td}>{z.slots.filter((s) => s.is_active).map((s) => s.label).join(', ')}</td><td className={td}>{z.is_active ? <Badge tone="good">Active</Badge> : <Badge>Hidden</Badge>}</td><td className={td}><Button size="sm" variant="ghost" onClick={() => setForm(edit(z))}>Edit</Button></td></tr>)}
        </Table>
      )}
      <Dialog open={form !== null} onClose={() => setForm(null)} title={form?.id ? 'Edit zone' : 'Add zone'}>
        {form && <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <Input label="Zone name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input label="PIN codes" hint="Separate with commas, for example 140301, 140306." value={form.pinCodes} onChange={(event) => setForm({ ...form, pinCodes: event.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyInput label="Minimum order (₹)" value={form.minOrder} onChange={(minOrder) => setForm({ ...form, minOrder })} />
            <MoneyInput label="Normal delivery charge (₹)" value={form.charge} onChange={(charge) => setForm({ ...form, charge })} />
            <MoneyInput label="Small order is below (₹)" value={form.smallBelow} onChange={(smallBelow) => setForm({ ...form, smallBelow })} />
            <MoneyInput label="Small order charge (₹)" value={form.smallCharge} onChange={(smallCharge) => setForm({ ...form, smallCharge })} />
            <MoneyInput label="Free delivery from (₹)" optional hint="Leave empty for never." value={form.freeAbove} onChange={(freeAbove) => setForm({ ...form, freeAbove })} />
            <Input label="Usual delivery time" optional placeholder="Within 2 hours" value={form.estimatedTime} onChange={(event) => setForm({ ...form, estimatedTime: event.target.value })} />
          </div>
          <Checkbox label="Quote the delivery charge for each order (long distance)" checked={form.quoteOnly} onChange={(event) => setForm({ ...form, quoteOnly: event.target.checked })} />
          <div className="flex flex-wrap gap-x-6 gap-y-2"><Checkbox label="Own riders can deliver here" checked={form.own} onChange={(event) => setForm({ ...form, own: event.target.checked })} /><Checkbox label="Third-party delivery allowed" checked={form.third} onChange={(event) => setForm({ ...form, third: event.target.checked })} /></div>
          <fieldset className="space-y-2 rounded-md border border-line p-3"><legend className="px-1 text-sm font-semibold">Delivery slots</legend>
            {form.slots.map((slot, index) => <div key={index} className="flex items-center gap-2"><Input label="Slot" className="flex-1 [&_label]:sr-only" placeholder="6 pm to 8 pm" value={slot.label} onChange={(event) => setForm({ ...form, slots: form.slots.map((s, i) => (i === index ? { ...s, label: event.target.value } : s)) })} /><Checkbox label="On" checked={slot.isActive} onChange={(event) => setForm({ ...form, slots: form.slots.map((s, i) => (i === index ? { ...s, isActive: event.target.checked } : s)) })} /></div>)}
            <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, slots: [...form.slots, { label: '', isActive: true }] })}>Add a slot</Button>
          </fieldset>
          <Checkbox label="Active: show this area to customers and take orders for it" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
          <fieldset className="space-y-2 rounded-md border border-line p-3"><legend className="px-1 text-sm font-semibold">Search engine page</legend>
            <Checkbox label="Publish a page for this area" checked={form.landing} onChange={(event) => setForm({ ...form, landing: event.target.checked })} />
            <p className="text-xs text-ink-soft">Only for places you really deliver to. The zone must be active.</p>
            {form.landing && <Textarea label="Short description for this area" value={form.landingText} onChange={(event) => setForm({ ...form, landingText: event.target.value })} />}
          </fieldset>
          <ErrorNote error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>Back</Button><Button loading={act.isPending} disabled={!form.name.trim() || !form.pinCodes.trim()} onClick={save}>Save zone</Button></div>
        </div>}
      </Dialog>
    </>
  )
}

const GATE_INFO = {
  SELLER_DETAILS_VERIFIED: ['Seller details verified', 'The legal seller name and address below are correct and belong to the business that will sell.'],
  FSSAI_COVERAGE_VERIFIED: ['FSSAI coverage verified', 'You have checked that the FSSAI licence really covers selling fruit online, and the contract with the licence holder is in place.'],
  ONLINE_SALES_ENABLED: ['Online selling enabled', 'Customers can place binding orders and make payments. Until this is on, the site only takes non-binding enquiries.'],
} as const

type SettingsData = { settings: Record<string, string>; goLive: { gates: Record<keyof typeof GATE_INFO, { deployment: boolean; admin: boolean }>; licenceExpired: boolean; live: boolean }; integrations: Record<string, { status: string; note: string }> }

function GoLive({ data }: { data: SettingsData }) {
  const can = useCan()
  const [asking, setAsking] = useState<null | { key: keyof typeof GATE_INFO; value: boolean }>(null)
  const [note, setNote] = useState('')
  const act = useDo(() => { setAsking(null); setNote('') })
  return (
    <Card className="border-2 border-citrus p-4">
      <h2 className="text-xl">Going live with real orders</h2>
      <Notice className="my-3" tone="warn" title="This is a record of your own checks, not an approval">
        Switching these on does not make your business legally approved to sell online. Check your food-business licence and the arrangement with the licence holder yourselves first, and keep your evidence.
      </Notice>
      <p className="mb-3 text-sm">Right now: {data.goLive.live ? <Badge tone="good">Live orders are ON</Badge> : <Badge tone="warn">Enquiries only. No live orders or payments</Badge>}{data.goLive.licenceExpired && <Badge tone="bad" className="ml-2">FSSAI licence date has passed</Badge>}</p>
      <ul className="space-y-3">{(Object.keys(GATE_INFO) as Array<keyof typeof GATE_INFO>).map((key) => {
        const gate = data.goLive.gates[key]
        return (
          <li key={key} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{GATE_INFO[key][0]}</p><p className="text-sm text-ink-soft">{GATE_INFO[key][1]}</p></div>
              <div className="flex items-center gap-2"><Badge tone={gate.admin ? 'good' : 'neutral'}>Admin: {gate.admin ? 'on' : 'off'}</Badge><Badge tone={gate.deployment ? 'good' : 'warn'}>Server: {gate.deployment ? 'on' : 'off'}</Badge></div></div>
            {!gate.deployment && <p className="mt-1 text-xs text-ink-soft">The server setting {key} is false. It must also be set to true in the deployment configuration (see the README).</p>}
            {can('golive.manage') && <div className="mt-2">{gate.admin ? <Button size="sm" variant="dangerOutline" onClick={() => setAsking({ key, value: false })}>Turn off</Button> : <Button size="sm" onClick={() => setAsking({ key, value: true })}>Turn on</Button>}</div>}
          </li>
        )
      })}</ul>
      {!can('golive.manage') && <p className="mt-3 text-sm text-ink-soft">Only a super admin can change these.</p>}
      <Dialog open={asking !== null} onClose={() => setAsking(null)} title={asking ? `${asking.value ? 'Turn on' : 'Turn off'}: ${GATE_INFO[asking.key][0]}` : ''}>
        {asking?.value && <Textarea label="What did you check, and who confirmed it?" hint="For example: Checked the FSSAI licence on the FSSAI portal with the licence holder on 3 Nov." value={note} onChange={(event) => setNote(event.target.value)} />}
        {asking && !asking.value && <p className="text-sm">This will stop live orders and payments straight away. Customers will only be able to send enquiries.</p>}
        <ErrorNote error={act.error} />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setAsking(null)}>Back</Button><Button loading={act.isPending} disabled={Boolean(asking?.value) && !note.trim()} onClick={() => asking && act.mutate({ path: '/system/settings/go-live', body: { key: asking.key, value: asking.value, attestation: note.trim() } })}>Confirm</Button></div>
      </Dialog>
    </Card>
  )
}

const FIELD_GROUPS: Array<{ title: string; hint?: string; fields: Array<{ key: string; label: string; type?: 'text' | 'date' | 'area' | 'check'; hint?: string }> }> = [
  { title: 'Brand', fields: [{ key: 'brand_name', label: 'Brand name' }, { key: 'brand_tagline', label: 'Tagline' }] },
  { title: 'Promotional banner', hint: 'An optional image on the home page. Only advertise offers you really run.', fields: [{ key: 'promo_banner_alt', label: 'What the banner says (for screen readers)' }] },
  { title: 'Seller and licence details', hint: 'Enter only what is true. The site shows these publicly only after you confirm them under "Going live".', fields: [
    { key: 'legal_seller_name', label: 'Legal seller name' }, { key: 'business_address', label: 'Business address', type: 'area' }, { key: 'business_phone', label: 'Business phone' }, { key: 'whatsapp_number', label: 'WhatsApp support number', hint: '10 digits, or with country code.' },
    { key: 'support_email', label: 'Support email' }, { key: 'operating_hours', label: 'Operating hours' }, { key: 'fssai_number', label: 'FSSAI licence number' }, { key: 'fssai_category', label: 'FSSAI licence category' },
    { key: 'fssai_valid_until', label: 'FSSAI valid until', type: 'date' }, { key: 'gstin', label: 'GSTIN (if applicable)' },
  ] },
  { title: 'UPI payments', hint: 'Shown to customers after they approve a UPI order.', fields: [{ key: 'upi_id', label: 'UPI ID' }, { key: 'upi_display_name', label: 'Account name shown to customers' }, { key: 'upi_instructions', label: 'Payment instructions', type: 'area' }] },
  { title: 'Delivery', fields: [{ key: 'delivery_otp_enabled', label: 'Ask riders for a delivery code from the customer', type: 'check' }] },
  { title: 'Reviews', hint: 'Add only genuine reviews from real customers, one per line as: Name | What they said. Leave empty until you have some.', fields: [{ key: 'testimonials', label: 'Customer reviews', type: 'area' }] },
  { title: 'Pages', hint: 'Write the text for each page. Start a line with # for a heading. Leave a page empty to hide it from search engines.', fields: [
    { key: 'page_about', label: 'About us', type: 'area' }, { key: 'page_delivery', label: 'Delivery policy', type: 'area' }, { key: 'page_cancellation', label: 'Cancellation policy', type: 'area' },
    { key: 'page_refund', label: 'Refund and replacement policy', type: 'area' }, { key: 'page_privacy', label: 'Privacy policy', type: 'area' }, { key: 'page_terms', label: 'Terms and conditions', type: 'area' },
  ] },
]

export function Settings() {
  const can = useCan()
  const query = useAdminQuery<SettingsData>('/system/settings')
  const [values, setValues] = useState<Record<string, string>>({})
  const save = useDo(() => setValues({}))
  const upload = useDo()
  useEffect(() => setValues({}), [query.dataUpdatedAt])
  if (query.isPending) return <Spinner />
  if (query.isError) return <QueryError error={query.error} retry={() => void query.refetch()} />
  const data = query.data
  const current = (key: string) => values[key] ?? data.settings[key] ?? ''
  const dirty = Object.keys(values).length > 0
  const editable = can('settings.write')
  const uploadImage = (key: string, folder: 'branding' | 'promotions', file: File | undefined) => {
    if (!file) return
    void imageUploadForm(file, folder).then((form) =>
      upload.mutate({ path: '/uploads', method: 'POST', formData: form }, { onSuccess: (result: any) => setValues((v) => ({ ...v, [key]: result.key })) }),
    )
  }
  return (
    <>
      <PageHead title="Business settings" sub="Everything customers see about your business comes from here. Nothing is made up.">
        {editable && <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ path: '/system/settings', method: 'PUT', body: { values } })}>Save changes</Button>}
      </PageHead>
      <ErrorNote error={save.error} />
      <div className="space-y-5">
        <GoLive data={data} />
        {FIELD_GROUPS.map((group) => (
          <Card key={group.title} className="space-y-3 p-4">
            <div><h2 className="text-xl">{group.title}</h2>{group.hint && <p className="text-sm text-ink-soft">{group.hint}</p>}</div>
            {group.fields.map((field) => field.type === 'check' ? <Checkbox key={field.key} label={field.label} disabled={!editable} checked={current(field.key) === 'true'} onChange={(event) => setValues({ ...values, [field.key]: String(event.target.checked) })} />
              : field.type === 'area' ? <Textarea key={field.key} label={field.label} hint={field.hint} rows={field.key.startsWith('page_') || field.key === 'testimonials' ? 8 : 3} disabled={!editable} value={current(field.key)} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
              : <Input key={field.key} label={field.label} hint={field.hint} type={field.type === 'date' ? 'date' : 'text'} disabled={!editable} value={current(field.key)} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />)}
            {group.title === 'Brand' && editable && (
              <div className="flex items-center gap-3">{current('logo_key') && <img src={mediaUrl(current('logo_key'))!} alt="Logo" className="size-12 rounded-md border border-line object-contain" />}<label className="cursor-pointer text-sm font-semibold text-forest underline">Upload logo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => uploadImage('logo_key', 'branding', event.target.files?.[0])} /></label></div>
            )}
            {group.title === 'Promotional banner' && editable && (
              <div className="flex flex-wrap items-center gap-3">{current('promo_banner_key') && <img src={mediaUrl(current('promo_banner_key'))!} alt="" className="h-16 rounded-md border border-line object-contain" />}<label className="cursor-pointer text-sm font-semibold text-forest underline">Upload banner<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => uploadImage('promo_banner_key', 'promotions', event.target.files?.[0])} /></label>{current('promo_banner_key') && <Button size="sm" variant="ghost" onClick={() => setValues({ ...values, promo_banner_key: '' })}>Remove</Button>}</div>
            )}
            {group.title === 'UPI payments' && editable && (
              <div className="flex items-center gap-3">{current('upi_qr_key') && <img src={mediaUrl(current('upi_qr_key'))!} alt="UPI QR code" className="size-20 rounded-md border border-line object-contain" />}<label className="cursor-pointer text-sm font-semibold text-forest underline">Upload UPI QR code<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => uploadImage('upi_qr_key', 'branding', event.target.files?.[0])} /></label></div>
            )}
          </Card>
        ))}
        <ErrorNote error={upload.error} />
        <Card className="p-4"><h2 className="text-xl">Connections</h2><p className="mb-2 text-sm text-ink-soft">What is and is not connected. Nothing below is faked.</p>
          <ul className="space-y-2 text-sm">{Object.entries(data.integrations).map(([key, info]) => <li key={key} className="flex flex-wrap items-center gap-2"><Badge tone={info.status === 'NOT_CONFIGURED' ? 'warn' : 'neutral'}>{info.status.replace('_', ' ').toLowerCase()}</Badge><strong>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</strong><span className="text-ink-soft">{info.note}</span></li>)}</ul>
        </Card>
      </div>
    </>
  )
}

export function Audit() {
  const [page, setPage] = useState(1)
  const list = useAdminQuery<{ logs: Array<{ id: string; actor_label: string; action: string; entity_type: string; entity_id: string; details_json: string; created_at: string }>; total: number; pageSize: number }>(`/system/audit?page=${page}`)
  return (
    <>
      <PageHead title="Audit log" sub="A record of who changed what. It cannot be edited from here." />
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : (
        <>
          <Table head={['When', 'Who', 'What', 'Details']}>{list.data.logs.map((l) => <tr key={l.id}><td className={`${td} whitespace-nowrap`}>{formatDateTime(l.created_at)}</td><td className={td}>{l.actor_label}</td><td className={td}>{l.action.replaceAll('_', ' ').toLowerCase()}<div className="text-xs text-ink-soft">{l.entity_type}</div></td><td className={`${td} break-all text-xs text-ink-soft`}>{l.details_json === '{}' ? '' : l.details_json}</td></tr>)}</Table>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
    </>
  )
}

export function Support() {
  const [status, setStatus] = useState('open')
  const [page, setPage] = useState(1)
  const list = useAdminQuery<{ tickets: Array<{ id: string; ticket_type: keyof typeof TICKET_TYPE_LABELS; customer_name: string; customer_phone: string; order_number: string; linked_order_id: string | null; message: string; status: string; resolution: string; created_at: string }>; total: number; pageSize: number }>(`/system/tickets?page=${page}&status=${status}`)
  const [editing, setEditing] = useState<null | { id: string; status: string; resolution: string }>(null)
  const act = useDo(() => setEditing(null))
  return (
    <>
      <PageHead title="Support requests" sub="Enquiries, complaints, damaged or missing items and refund requests from customers. Offer only what your own policy allows." />
      <div className="mb-4 max-w-xs"><Select label="Show" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="open">Open</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option><option value="">Everything</option></Select></div>
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : list.data.tickets.length === 0 ? <EmptyState title="No requests" /> : (
        <>
          <ul className="space-y-3">{list.data.tickets.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{TICKET_TYPE_LABELS[t.ticket_type]} <Badge tone={t.status === 'OPEN' ? 'bad' : t.status === 'IN_PROGRESS' ? 'warn' : 'good'}>{t.status.replace('_', ' ').toLowerCase()}</Badge></p><span className="text-xs text-ink-soft">{formatDateTime(t.created_at)}</span></div>
              <p className="mt-1 text-sm">{t.customer_name} · <a className="text-forest underline" href={`tel:${t.customer_phone}`}>{t.customer_phone}</a>{t.order_number && <> · {t.linked_order_id ? <Link className="text-forest underline" to={`/admin/orders/${t.linked_order_id}`}>{t.order_number}</Link> : t.order_number}</>}</p>
              <p className="mt-2 whitespace-pre-line text-sm">{t.message}</p>
              {t.resolution && <p className="mt-2 rounded-md bg-leaf-soft p-2 text-sm">Resolution: {t.resolution}</p>}
              <Button className="mt-3" size="sm" variant="secondary" onClick={() => setEditing({ id: t.id, status: t.status, resolution: t.resolution })}>Update</Button>
            </Card>))}</ul>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Update request">
        {editing && <div className="space-y-3"><Select label="Status" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></Select><Textarea label="What was done" optional value={editing.resolution} onChange={(event) => setEditing({ ...editing, resolution: event.target.value })} /><ErrorNote error={act.error} /><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Back</Button><Button loading={act.isPending} onClick={() => act.mutate({ path: `/system/tickets/${editing.id}`, method: 'PATCH', body: { status: editing.status, resolution: editing.resolution } })}>Save</Button></div></div>}
      </Dialog>
    </>
  )
}
