import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AVAILABILITY, AVAILABILITY_LABELS, type Availability } from '../../../shared/schemas'
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Input, LinkButton, Notice, QueryError, Select, Spinner, Textarea } from '../../components/ui'
import { mediaUrl } from '../../lib/api'
import { imageUploadForm } from '../../lib/image'
import { formatDateTime, formatINR, todayIst } from '../../lib/format'
import { ConfirmButton, ErrorNote, MoneyInput, PageHead, Table, td, useAdminQuery, useCan, useDo } from './shared'

type ListedProduct = {
  id: string; name: string; category_name: string; availability: Availability; is_featured: number; is_seasonal: number; is_active: number
  variants: Array<{ id: string; label: string; retail_price_paise: number; is_active: number }>; images: Array<{ object_key: string }>
}

export function Products() {
  const [params, setParams] = useSearchParams()
  const archived = params.get('archived') === '1'
  const q = params.get('q') ?? ''
  const categories = useAdminQuery<{ categories: Array<{ id: string; name: string }> }>('/catalog/categories')
  const list = useAdminQuery<{ products: ListedProduct[] }>(`/catalog/products?archived=${archived ? 1 : 0}${q ? `&q=${encodeURIComponent(q)}` : ''}${params.get('categoryId') ? `&categoryId=${params.get('categoryId')}` : ''}`)
  const [selected, setSelected] = useState<string[]>([])
  const act = useDo(() => setSelected([]))
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  const bulk = (body: Record<string, unknown>, ids = selected) => act.mutate({ path: '/catalog/products/bulk', body: { productIds: ids, ...body } })

  return (
    <>
      <PageHead title="Products" sub="Availability here only controls what customers can order. It is not a stock count."><LinkButton to="/admin/products/new" size="sm"><Plus className="size-4" /> Add product</LinkButton></PageHead>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input label="Search" defaultValue={q} onChange={(event) => set('q', event.target.value.trim())} />
        <Select label="Category" value={params.get('categoryId') ?? ''} onChange={(event) => set('categoryId', event.target.value)}><option value="">All categories</option>{categories.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select label="Show" value={archived ? '1' : '0'} onChange={(event) => set('archived', event.target.value === '1' ? '1' : '')}><option value="0">Active products</option><option value="1">Archived</option></Select>
      </div>
      {selected.length > 0 && (
        <Card className="mb-3 flex flex-wrap items-center gap-2 bg-cream p-3 text-sm"><strong>{selected.length} selected</strong>
          {AVAILABILITY.map((a) => <Button key={a} size="sm" variant="secondary" onClick={() => bulk({ availability: a })}>{AVAILABILITY_LABELS[a]}</Button>)}
          <Button size="sm" variant="secondary" onClick={() => bulk({ isFeatured: true })}>Feature</Button>
          <Button size="sm" variant="secondary" onClick={() => bulk({ isActive: archived })}>{archived ? 'Restore' : 'Archive'}</Button>
        </Card>
      )}
      <ErrorNote error={act.error} />
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} retry={() => void list.refetch()} /> : list.data.products.length === 0 ? <EmptyState title="No products here" action={<LinkButton to="/admin/products/new" size="sm">Add your first product</LinkButton>} /> : (
        <Table head={['', 'Product', 'Category', 'Prices', 'Availability', '']}>
          {list.data.products.map((p) => (
            <tr key={p.id}>
              <td className={td}><input type="checkbox" aria-label={`Select ${p.name}`} className="size-4 accent-forest" checked={selected.includes(p.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))} /></td>
              <td className={td}><Link className="font-semibold text-forest underline" to={`/admin/products/${p.id}`}>{p.name}</Link><div className="flex gap-1">{p.is_featured ? <Badge tone="info">Featured</Badge> : null}{p.is_seasonal ? <Badge>Seasonal</Badge> : null}</div></td>
              <td className={td}>{p.category_name}</td>
              <td className={td}>{p.variants.filter((v) => v.is_active).map((v) => <div key={v.id}>{v.label}: {formatINR(v.retail_price_paise)}</div>)}</td>
              <td className={td}><select aria-label={`Availability of ${p.name}`} className="rounded-md border border-line bg-paper px-2 py-1" value={p.availability} onChange={(event) => bulk({ availability: event.target.value }, [p.id])}>{AVAILABILITY.map((a) => <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>)}</select></td>
              <td className={td}><Link className="text-forest underline" to={`/admin/products/${p.id}`}>Edit</Link></td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

type VariantForm = { id?: string; label: string; unitKind: 'WEIGHT' | 'COUNT'; unitSize: number; retail: number | null; wholesale: number | null; minQty: number; qtyStep: number; isActive: boolean }
const PRESETS: Array<Pick<VariantForm, 'label' | 'unitKind' | 'unitSize'>> = [
  { label: '250 g', unitKind: 'WEIGHT', unitSize: 250 }, { label: '500 g', unitKind: 'WEIGHT', unitSize: 500 }, { label: '1 kg', unitKind: 'WEIGHT', unitSize: 1000 },
  { label: '2 kg', unitKind: 'WEIGHT', unitSize: 2000 }, { label: '1 piece', unitKind: 'COUNT', unitSize: 1 }, { label: '1 dozen', unitKind: 'COUNT', unitSize: 12 },
]

export function ProductEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const can = useCan()
  const canPrice = can('pricing.write')
  const categories = useAdminQuery<{ categories: Array<{ id: string; name: string }> }>('/catalog/categories')
  const existing = useAdminQuery<{ product: any; variants: any[]; images: Array<{ object_key: string; alt: string }> }>(`/catalog/products/${id}`, { enabled: !isNew })
  const [form, setForm] = useState({ name: '', description: '', categoryId: '', availability: 'AVAILABLE' as Availability, isFeatured: false, isSeasonal: false, isCombo: false, displayPriority: 0, isActive: true })
  const [variants, setVariants] = useState<VariantForm[]>([{ label: '1 kg', unitKind: 'WEIGHT', unitSize: 1000, retail: null, wholesale: null, minQty: 1, qtyStep: 1, isActive: true }])
  const [images, setImages] = useState<Array<{ key: string; alt: string }>>([])
  const [loaded, setLoaded] = useState(isNew)
  const save = useDo()
  const upload = useDo()

  useEffect(() => {
    if (!existing.data || loaded) return
    const { product, variants: v, images: imgs } = existing.data
    setForm({ name: product.name, description: product.description, categoryId: product.category_id, availability: product.availability, isFeatured: !!product.is_featured, isSeasonal: !!product.is_seasonal, isCombo: !!product.is_combo, displayPriority: product.display_priority, isActive: !!product.is_active })
    setVariants(v.filter((x) => x.is_active).map((x) => ({ id: x.id, label: x.label, unitKind: x.unit_kind, unitSize: x.unit_size, retail: x.retail_price_paise, wholesale: x.wholesale_price_paise ?? null, minQty: x.min_qty, qtyStep: x.qty_step, isActive: true })))
    setImages(imgs.map((x) => ({ key: x.object_key, alt: x.alt })))
    setLoaded(true)
  }, [existing.data, loaded])

  if (!isNew && existing.isPending) return <Spinner />
  if (!isNew && existing.isError) return <QueryError error={existing.error} />

  const patchVariant = (index: number, next: Partial<VariantForm>) => setVariants((current) => current.map((v, i) => (i === index ? { ...v, ...next } : v)))
  const valid = form.name.trim() && form.categoryId && variants.length > 0 && variants.every((v) => v.label.trim() && v.retail)

  const submit = () => save.mutate({
    path: isNew ? '/catalog/products' : `/catalog/products/${id}`, method: isNew ? 'POST' : 'PUT',
    body: {
      ...form, name: form.name.trim(), images,
      variants: variants.map((v) => ({ id: v.id, label: v.label.trim(), unitKind: v.unitKind, unitSize: v.unitSize, retailPricePaise: v.retail, ...(canPrice ? { wholesalePricePaise: v.wholesale } : {}), minQty: v.minQty, qtyStep: v.qtyStep, isActive: true })),
    },
  }, { onSuccess: () => navigate('/admin/products') })

  const onFile = (file: File | undefined) => {
    if (!file) return
    void imageUploadForm(file, 'products').then((data) =>
      upload.mutate({ path: '/uploads', method: 'POST', formData: data }, { onSuccess: (result: any) => setImages((current) => [...current, { key: result.key, alt: form.name }]) }),
    )
  }

  return (
    <>
      <PageHead title={isNew ? 'Add product' : form.name || 'Edit product'}><Link className="text-sm text-forest underline" to="/admin/products">All products</Link></PageHead>
      <div className="space-y-5">
        <Card className="space-y-3 p-4">
          <Input label="Product name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Textarea label="Description" optional value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} hint="Describe only what is true. Avoid claims such as organic or farm-direct unless verified." />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Category" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Choose</option>{categories.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select label="Availability" value={form.availability} onChange={(event) => setForm({ ...form, availability: event.target.value as Availability })}>{AVAILABILITY.map((a) => <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>)}</Select>
            <Input label="Display priority" type="number" hint="Higher shows first." value={form.displayPriority} onChange={(event) => setForm({ ...form, displayPriority: Number(event.target.value) || 0 })} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label="Featured" checked={form.isFeatured} onChange={(event) => setForm({ ...form, isFeatured: event.target.checked })} />
            <Checkbox label="Seasonal" checked={form.isSeasonal} onChange={(event) => setForm({ ...form, isSeasonal: event.target.checked })} />
            <Checkbox label="Fruit combination or box" checked={form.isCombo} onChange={(event) => setForm({ ...form, isCombo: event.target.checked })} />
            <Checkbox label="Shown on the shop" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-xl">Selling units and prices</h2>
          <p className="mb-3 text-sm text-ink-soft">Each fruit can be sold in different units. Retail prices are public. {canPrice ? 'Wholesale prices are private to staff.' : ''}</p>
          <div className="space-y-3">
            {variants.map((v, index) => (
              <div key={v.id ?? index} className="grid items-end gap-2 rounded-md border border-line p-3 sm:grid-cols-6">
                <Input label="Unit label" value={v.label} onChange={(event) => patchVariant(index, { label: event.target.value })} />
                <Select label="Type" value={v.unitKind} onChange={(event) => patchVariant(index, { unitKind: event.target.value as VariantForm['unitKind'] })}><option value="WEIGHT">Weight</option><option value="COUNT">Count</option></Select>
                <Input label={v.unitKind === 'WEIGHT' ? 'Grams' : 'Pieces'} type="number" min={1} value={v.unitSize} onChange={(event) => patchVariant(index, { unitSize: Math.max(1, Number(event.target.value) || 1) })} />
                <MoneyInput label="Retail price (₹)" value={v.retail} onChange={(retail) => patchVariant(index, { retail })} />
                {canPrice ? <MoneyInput label="Wholesale (₹)" optional value={v.wholesale} onChange={(wholesale) => patchVariant(index, { wholesale })} /> : <span />}
                <div className="flex items-end gap-2">
                  <Input label="Min qty" type="number" min={1} value={v.minQty} onChange={(event) => patchVariant(index, { minQty: Math.max(1, Number(event.target.value) || 1) })} />
                  <Input label="Step" type="number" min={1} value={v.qtyStep} onChange={(event) => patchVariant(index, { qtyStep: Math.max(1, Number(event.target.value) || 1) })} />
                  <Button variant="ghost" size="sm" aria-label="Remove unit" disabled={variants.length === 1} onClick={() => setVariants((current) => current.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.filter((p) => !variants.some((v) => v.label === p.label)).map((p) => <Button key={p.label} size="sm" variant="secondary" onClick={() => setVariants((current) => [...current, { ...p, retail: null, wholesale: null, minQty: 1, qtyStep: 1, isActive: true }])}>+ {p.label}</Button>)}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-xl">Photographs</h2>
          <p className="mb-3 text-sm text-ink-soft">Use your own photographs of the fruit you sell. Until you add one, the shop shows the fruit&rsquo;s name instead of a stock picture. JPEG, PNG or WebP, up to 5 MB.</p>
          <ul className="flex flex-wrap gap-3">
            {images.map((image, index) => (
              <li key={image.key} className="w-32"><img src={mediaUrl(image.key)!} alt={image.alt} className="aspect-square w-full rounded-md border border-line object-cover" /><Button size="sm" variant="ghost" full onClick={() => setImages((current) => current.filter((_, i) => i !== index))}>Remove</Button></li>
            ))}
            <li><label className="grid size-32 cursor-pointer place-items-center rounded-md border-2 border-dashed border-line text-center text-sm text-ink-soft hover:border-forest"><span><ImagePlus className="mx-auto size-6" />Add photo</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = '' }} /></label></li>
          </ul>
          {upload.isPending && <p className="mt-2 text-sm">Uploading…</p>}
          <ErrorNote error={upload.error} />
        </Card>

        <ErrorNote error={save.error} />
        <div className="flex gap-2"><Button size="lg" disabled={!valid} loading={save.isPending} onClick={submit}>{isNew ? 'Add product' : 'Save changes'}</Button>{!isNew && form.isActive && <ConfirmButton size="lg" variant="secondary" onConfirm={() => save.mutate({ path: `/catalog/products/${id}/archive`, method: 'POST' }, { onSuccess: () => navigate('/admin/products') })}>Archive</ConfirmButton>}</div>
      </div>
    </>
  )
}

export function Categories() {
  const list = useAdminQuery<{ categories: Array<{ id: string; name: string; description: string; image_key: string | null; sort_order: number; is_active: number; product_count: number }> }>('/catalog/categories')
  const [editing, setEditing] = useState<null | { id?: string; name: string; description: string; imageKey: string | null; sortOrder: number; isActive: boolean }>(null)
  const act = useDo(() => setEditing(null))
  const upload = useDo()
  const onFile = (file: File | undefined) => {
    if (!file) return
    void imageUploadForm(file, 'categories').then((data) =>
      upload.mutate({ path: '/uploads', method: 'POST', formData: data }, { onSuccess: (result: any) => setEditing((current) => (current ? { ...current, imageKey: result.key } : current)) }),
    )
  }
  return (
    <>
      <PageHead title="Categories" sub="Add, rename, reorder or hide categories without touching code."><Button size="sm" onClick={() => setEditing({ name: '', description: '', imageKey: null, sortOrder: 0, isActive: true })}><Plus className="size-4" /> Add category</Button></PageHead>
      {list.isPending ? <Spinner /> : list.isError ? <QueryError error={list.error} /> : (
        <Table head={['Order', 'Name', 'Products', 'Shown', '']}>
          {list.data.categories.map((c) => (
            <tr key={c.id}><td className={td}>{c.sort_order}</td><td className={td}><span className="font-semibold">{c.name}</span><div className="text-xs text-ink-soft">{c.description}</div></td><td className={td}>{c.product_count}</td><td className={td}>{c.is_active ? <Badge tone="good">Yes</Badge> : <Badge>Hidden</Badge>}</td>
              <td className={td}><Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, name: c.name, description: c.description, imageKey: c.image_key, sortOrder: c.sort_order, isActive: !!c.is_active })}>Edit</Button>{c.product_count === 0 && <ConfirmButton size="sm" variant="ghost" onConfirm={() => act.mutate({ path: `/catalog/categories/${c.id}`, method: 'DELETE' })}>Delete</ConfirmButton>}</td></tr>
          ))}
        </Table>
      )}
      <ErrorNote error={act.error} />
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? 'Edit category' : 'Add category'}>
        {editing && <div className="space-y-3">
          <Input label="Name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          <Textarea label="Description" optional value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
          <Input label="Display order" type="number" hint="Lower shows first." value={editing.sortOrder} onChange={(event) => setEditing({ ...editing, sortOrder: Number(event.target.value) || 0 })} />
          <Checkbox label="Shown on the shop" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />
          <div className="flex items-center gap-3">
            {editing.imageKey && <img src={mediaUrl(editing.imageKey)!} alt="" className="size-14 rounded-md border border-line object-cover" />}
            <label className="cursor-pointer text-sm font-semibold text-forest underline">{editing.imageKey ? 'Change image' : 'Add image'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => onFile(event.target.files?.[0])} /></label>
            {editing.imageKey && <Button size="sm" variant="ghost" onClick={() => setEditing({ ...editing, imageKey: null })}>Remove</Button>}
          </div>
          <ErrorNote error={upload.error} />
          <ErrorNote error={act.error} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Back</Button><Button disabled={!editing.name.trim()} loading={act.isPending} onClick={() => act.mutate({ path: editing.id ? `/catalog/categories/${editing.id}` : '/catalog/categories', method: editing.id ? 'PUT' : 'POST', body: { name: editing.name.trim(), description: editing.description, imageKey: editing.imageKey, sortOrder: editing.sortOrder, isActive: editing.isActive } })}>Save</Button></div>
        </div>}
      </Dialog>
    </>
  )
}

type PriceRow = { variant_id: string; label: string; retail_price_paise: number; wholesale_price_paise: number | null; updated_at: string; product_name: string; category_name: string; availability: Availability; updated_by: string | null; effective_date: string | null }

export function Pricing() {
  const prices = useAdminQuery<{ prices: PriceRow[] }>('/catalog/pricing')
  const [edits, setEdits] = useState<Record<string, { retail?: number | null; wholesale?: number | null }>>({})
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayIst())
  const [history, setHistory] = useState<PriceRow | null>(null)
  const act = useDo(() => { setEdits({}); setNote('') })
  const hist = useAdminQuery<{ history: Array<{ id: string; retail_price_paise: number; wholesale_price_paise: number | null; effective_date: string; note: string; updated_by_name: string | null; created_at: string }> }>(`/catalog/pricing/${history?.variant_id}/history`, { enabled: history !== null })
  if (prices.isPending) return <Spinner />
  if (prices.isError) return <QueryError error={prices.error} retry={() => void prices.refetch()} />
  const changed = Object.entries(edits).filter(([id, e]) => { const row = prices.data.prices.find((p) => p.variant_id === id)!; return (e.retail !== undefined && e.retail !== row.retail_price_paise) || (e.wholesale !== undefined && e.wholesale !== row.wholesale_price_paise) })
  const save = () => act.mutate({ path: '/catalog/pricing', body: { effectiveDate: date, note, prices: changed.map(([variantId, e]) => { const row = prices.data.prices.find((p) => p.variant_id === variantId)!; return { variantId, retailPricePaise: e.retail ?? row.retail_price_paise, wholesalePricePaise: e.wholesale === undefined ? undefined : e.wholesale } }) } })
  return (
    <>
      <PageHead title="Daily prices" sub="Update today's rates here. Customers see retail prices. Wholesale prices stay private to staff."><Button disabled={changed.length === 0} loading={act.isPending} onClick={save}>Save {changed.length || ''} {changed.length === 1 ? 'change' : 'changes'}</Button></PageHead>
      <div className="mb-3 grid gap-3 sm:grid-cols-2"><Input label="Effective date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><Input label="Note" optional placeholder="e.g. Mandi rates after rain" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <ErrorNote error={act.error} />
      <Table head={['Fruit', 'Unit', 'Retail (₹)', 'Wholesale (₹)', 'Margin', 'Last updated', '']}>
        {prices.data.prices.map((row) => {
          const e = edits[row.variant_id] ?? {}
          const retail = e.retail === undefined ? row.retail_price_paise : e.retail
          const wholesale = e.wholesale === undefined ? row.wholesale_price_paise : e.wholesale
          return (
            <tr key={row.variant_id}>
              <td className={td}><span className="font-semibold">{row.product_name}</span><div className="text-xs text-ink-soft">{row.category_name}{row.availability !== 'AVAILABLE' ? ` · ${AVAILABILITY_LABELS[row.availability]}` : ''}</div></td>
              <td className={td}>{row.label}</td>
              <td className={`${td} w-32`}><MoneyInput label="Retail" value={retail} onChange={(value) => setEdits({ ...edits, [row.variant_id]: { ...e, retail: value } })} className="[&_label]:sr-only" /></td>
              <td className={`${td} w-32`}><MoneyInput label="Wholesale" value={wholesale} onChange={(value) => setEdits({ ...edits, [row.variant_id]: { ...e, wholesale: value } })} className="[&_label]:sr-only" /></td>
              <td className={td}>{retail && wholesale ? <span className={retail - wholesale < 0 ? 'text-berry' : 'text-forest'}>{formatINR(retail - wholesale)}</span> : '–'}</td>
              <td className={`${td} text-xs text-ink-soft`}>{row.effective_date ?? ''}<div>{row.updated_by}</div></td>
              <td className={td}><Button size="sm" variant="ghost" onClick={() => setHistory(row)}>History</Button></td>
            </tr>
          )
        })}
      </Table>
      <Dialog open={history !== null} onClose={() => setHistory(null)} title={`${history?.product_name ?? ''} ${history?.label ?? ''} price history`}>
        {hist.isPending ? <Spinner /> : <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">{hist.data?.history.map((h) => <li key={h.id} className="rounded-md border border-line p-2"><strong>{formatINR(h.retail_price_paise)}</strong> retail{h.wholesale_price_paise !== null ? ` · ${formatINR(h.wholesale_price_paise)} wholesale` : ''}<div className="text-xs text-ink-soft">{h.effective_date} · {h.updated_by_name ?? 'System'} · {formatDateTime(h.created_at)}{h.note ? ` · ${h.note}` : ''}</div></li>)}</ul>}
        <div className="mt-3 flex justify-end"><Button variant="ghost" onClick={() => setHistory(null)}>Close</Button></div>
      </Dialog>
      {prices.data.prices.length === 0 && <div className="mt-4"><Notice>Add products first. Their prices will appear here for daily updates.</Notice></div>}
    </>
  )
}
