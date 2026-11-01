import { Link, useSearchParams } from 'react-router-dom'
import { ORDER_STATUSES, STATUS_LABELS, type OrderStatus } from '../../../shared/order-state'
import { Badge, EmptyState, Input, Pagination, QueryError, Select, Spinner } from '../../components/ui'
import { formatDateTime, formatINR } from '../../lib/format'
import { Money, PageHead, Table, td, useAdminQuery } from './shared'

type Row = {
  id: string; order_number: string; order_type: 'ORDER' | 'ENQUIRY'; status: OrderStatus; customer_name: string; customer_phone: string; locality: string; slot_label: string
  payment_method: string | null; payment_preference: string; payment_status: string; estimated_total_paise: number; total_paise: number; current_revision: number; created_at: string
}

export const statusTone = (status: string) =>
  status === 'PENDING_REVIEW' ? 'bad' : status === 'AWAITING_CUSTOMER_APPROVAL' ? 'warn' : status === 'DELIVERED' || status === 'CONFIRMED' ? 'good' : ['REJECTED', 'CANCELLED', 'FAILED_DELIVERY', 'REFUND_PENDING'].includes(status) ? 'bad' : 'info'

export default function Orders() {
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') ?? 1)
  const query = new URLSearchParams()
  for (const key of ['q', 'status', 'from', 'to']) if (params.get(key)) query.set(key, params.get(key)!)
  query.set('page', String(page))
  const orders = useAdminQuery<{ orders: Row[]; total: number; pendingReview: number; page: number; pageSize: number }>(`/orders?${query}`, { refetchInterval: 30_000 })
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHead title="Orders" sub={orders.data ? `${orders.data.pendingReview} waiting for review` : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Search" placeholder="Order number, name or phone" defaultValue={params.get('q') ?? ''} onChange={(event) => set('q', event.target.value.trim())} />
        <Select label="Status" value={params.get('status') ?? ''} onChange={(event) => set('status', event.target.value)}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </Select>
        <Input label="From" type="date" value={params.get('from') ?? ''} onChange={(event) => set('from', event.target.value)} />
        <Input label="To" type="date" value={params.get('to') ?? ''} onChange={(event) => set('to', event.target.value)} />
      </div>
      {orders.isPending ? <Spinner /> : orders.isError ? <QueryError error={orders.error} retry={() => void orders.refetch()} /> : orders.data.orders.length === 0 ? <EmptyState title="No orders match" /> : (
        <>
          <Table head={['Order', 'Customer', 'Area and slot', 'Total', 'Payment', 'Status', 'Placed']}>
            {orders.data.orders.map((order) => (
              <tr key={order.id} className={order.status === 'PENDING_REVIEW' ? 'bg-berry-soft/40' : undefined}>
                <td className={td}>
                  <Link className="font-semibold text-forest underline" to={`/admin/orders/${order.id}`}>{order.order_number}</Link>
                  {order.order_type === 'ENQUIRY' && <div><Badge tone="warn">Enquiry</Badge></div>}
                </td>
                <td className={td}>{order.customer_name}<div className="text-xs text-ink-soft">{order.customer_phone}</div></td>
                <td className={td}>{order.locality}<div className="text-xs text-ink-soft">{order.slot_label}</div></td>
                <td className={td}>{order.current_revision > 0 ? <Money paise={order.total_paise} /> : <span title="Estimate">~{formatINR(order.estimated_total_paise)}</span>}</td>
                <td className={td}>{order.payment_method ?? order.payment_preference}<div className="text-xs text-ink-soft">{order.payment_status.replace('_', ' ').toLowerCase()}</div></td>
                <td className={td}><Badge tone={statusTone(order.status)}>{STATUS_LABELS[order.status]}</Badge></td>
                <td className={`${td} text-ink-soft`}>{formatDateTime(order.created_at)}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageSize={orders.data.pageSize} total={orders.data.total} onChange={(next) => set('page', String(next))} />
        </>
      )}
    </>
  )
}
