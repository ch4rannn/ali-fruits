import { Link } from 'react-router-dom'
import { Card, EmptyState, Notice, QueryError, Spinner, Stat } from '../../components/ui'
import { formatINR } from '../../lib/format'
import { PageHead, RangePicker, useAdminQuery, useCan, useRange } from './shared'

type Overview = {
  from: string
  to: string
  counts: { ordersInRange: number; pending: number; awaitingApproval: number; confirmed: number; inProgress: number; refundPending: number; completed: number; cancelled: number; openEnquiries: number; openTickets: number }
  finance: null | {
    revenue: number; todayRevenue: number; monthRevenue: number; fruitCost: number; grossProfit: number; grossMarginPercent: number | null; packaging: number; deliveryCost: number
    contribution: number; averageOrderValue: number; averageContribution: number; completedOrders: number; cancellationRate: number
    unlinkedVariableExpenses: number; fixedExpenses: number; contributionAfterUnlinked: number; customers: number; repeatCustomers: number; repeatRate: number
  }
}

export default function Overview() {
  const range = useRange('today')
  const can = useCan()
  const query = useAdminQuery<Overview>(`/finance/overview?from=${range.range.from}&to=${range.range.to}`, { refetchInterval: 60_000 })
  const data = query.data
  const c = data?.counts
  const f = data?.finance

  return (
    <>
      <PageHead title="Overview" sub="Figures come straight from your orders and records. Nothing here is estimated."><RangePicker state={range} /></PageHead>
      {query.isPending ? <Spinner /> : query.isError ? <QueryError error={query.error} retry={() => void query.refetch()} /> : (
        <div className="space-y-6">
          {c && (c.pending > 0 || c.awaitingApproval > 0 || c.openEnquiries > 0 || c.openTickets > 0) && (
            <Notice tone="warn" title="Needs your attention">
              <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                {c.pending > 0 && <li><Link className="font-semibold underline" to="/admin/orders?status=PENDING_REVIEW">{c.pending} {c.pending === 1 ? 'order' : 'orders'} to check</Link></li>}
                {c.awaitingApproval > 0 && <li><Link className="font-semibold underline" to="/admin/orders?status=AWAITING_CUSTOMER_APPROVAL">{c.awaitingApproval} waiting for customer approval</Link></li>}
                {c.openEnquiries > 0 && <li>{c.openEnquiries} open enquiries</li>}
                {c.openTickets > 0 && <li><Link className="font-semibold underline" to="/admin/support">{c.openTickets} support requests</Link></li>}
              </ul>
            </Notice>
          )}
          {c && (
            <section aria-label="Orders">
              <h2 className="mb-2 text-xl">Orders</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Orders in this period" value={c.ordersInRange} />
                <Stat label="Pending review" value={c.pending} tone={c.pending ? 'bad' : undefined} sub="right now" />
                <Stat label="Awaiting approval" value={c.awaitingApproval} sub="right now" />
                <Stat label="Confirmed" value={c.confirmed} sub="right now" />
                <Stat label="In progress" value={c.inProgress} sub="buying to delivery, right now" />
                <Stat label="Completed" value={c.completed} sub="placed in this period" />
                <Stat label="Cancelled or rejected" value={c.cancelled} sub="placed in this period" />
                <Stat label="Refunds pending" value={c.refundPending} />
              </div>
            </section>
          )}
          {can('reports.read') && f ? (
            <>
              <section aria-label="Money">
                <h2 className="mb-1 text-xl">Money</h2>
                <p className="mb-2 text-sm text-ink-soft">Orders count on the day they finish. Revenue is only counted once an order is delivered, and costs are counted even if an order fails.</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Revenue today" value={formatINR(f.todayRevenue)} />
                  <Stat label="Revenue this month" value={formatINR(f.monthRevenue)} />
                  <Stat label="Revenue in period" value={formatINR(f.revenue)} />
                  <Stat label="Average order value" value={formatINR(f.averageOrderValue)} sub={`${f.completedOrders} delivered`} />
                </div>
              </section>
              <section aria-label="Costs and contribution">
                <h2 className="mb-2 text-xl">Costs and contribution</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Fruit purchase cost" value={formatINR(f.fruitCost)} />
                  <Stat label="Gross profit" value={formatINR(f.grossProfit)} tone={f.grossProfit < 0 ? 'bad' : 'good'} sub={f.grossMarginPercent === null ? 'No sales yet' : `${f.grossMarginPercent}% margin on fruit`} />
                  <Stat label="Packaging" value={formatINR(f.packaging)} />
                  <Stat label="Delivery cost" value={formatINR(f.deliveryCost)} />
                  <Stat label="Contribution" value={formatINR(f.contribution)} tone={f.contribution < 0 ? 'bad' : 'good'} sub="revenue minus all variable costs" />
                  <Stat label="Average contribution per order" value={formatINR(f.averageContribution)} />
                  <Stat label="Repeat customers" value={`${f.repeatCustomers} of ${f.customers}`} sub={`${f.repeatRate}%`} />
                  <Stat label="Cancellation rate" value={`${f.cancellationRate}%`} />
                </div>
                {(f.unlinkedVariableExpenses > 0 || f.fixedExpenses > 0) && (
                  <Card className="mt-3 p-4 text-sm">
                    <p>Other costs not tied to an order in this period: variable {formatINR(f.unlinkedVariableExpenses)}, fixed {formatINR(f.fixedExpenses)}.</p>
                    <p className="mt-1 font-semibold">Contribution after variable costs not tied to an order: {formatINR(f.contributionAfterUnlinked)}</p>
                  </Card>
                )}
                <p className="mt-3 text-xs text-ink-soft">These are management figures to help you run the business. They are not a replacement for formal accounting or tax records.</p>
              </section>
            </>
          ) : !f && can('reports.read') ? <EmptyState title="No figures yet" /> : null}
        </div>
      )}
    </>
  )
}
