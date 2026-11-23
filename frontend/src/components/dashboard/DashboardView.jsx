import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { CATEGORY_LABEL, PRIORITY_LABEL } from '../../lib/format';
import { ease, MetricNumber, PageHeading, Segments } from '../../workspace/controls';

const format = new Intl.NumberFormat();
const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDay = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const priorityLevels = ['urgent', 'high', 'medium', 'low'];
const isResolved = ({ status }) => status === 'resolved' || status === 'closed';

function dayKey(date) {
  return [date.getFullYear(), date.getMonth(), date.getDate()].join('-');
}

function getDays(length) {
  const today = new Date();
  return Array.from({ length }, (_, index) => ({
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - length + index + 1),
    count: 0,
  }));
}

function VolumeChart({ days }) {
  const [active, setActive] = useState(null);
  const reduce = useReducedMotion();
  const max = Math.max(4, Math.ceil(Math.max(...days.map(day => day.count)) / 4) * 4);
  const current = days[active];

  return (
    <section className="rd-panel rd-volume" aria-labelledby="volume-heading">
      <div className="rd-panel-heading">
        <div><h2 id="volume-heading">Complaint volume</h2><p>New complaints by day</p></div>
        <div className="rd-chart-readout" aria-live="polite">{current
          ? <>{shortDay.format(current.date)} <strong>{format.format(current.count)}</strong></>
          : <><span className="rd-dot" /> Received</>}</div>
      </div>
      <div className="rd-plot">
        <div className="rd-gridlines" aria-hidden>{[1, .75, .5, .25, 0].map(level => <div key={level}><span>{format.format(max * level)}</span></div>)}</div>
        <div className="rd-bars" onMouseLeave={() => setActive(null)}>
          {days.map(({ date, count }, index) => (
            <button type="button" key={dayKey(date)} aria-label={`${fullDay.format(date)}, ${count} complaints`}
              onFocus={() => setActive(index)} onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(index)} onClick={() => setActive(index)}
              data-active={active === index}>
              <motion.span key={count} initial={reduce ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }} transition={{ duration: .36, delay: reduce ? 0 : Math.min(index * .03, .27), ease }}
                style={{ height: count ? `${count / max * 100}%` : '2px' }} />
            </button>
          ))}
        </div>
      </div>
      <div className="rd-dates" aria-hidden>{[0, Math.floor(days.length / 2), days.length - 1].map(i => <span key={i}>{shortDay.format(days[i].date)}</span>)}</div>
    </section>
  );
}

export function DashboardView() {
  const { complaints, complaintError, refreshAll } = useData();
  const { user } = useAuth();
  return <ComplaintInsights complaints={complaints} all={['owner', 'admin'].includes(user?.role)}
    complaintError={complaintError} refreshAll={refreshAll} />;
}

export function ComplaintInsights({ complaints, all, complaintError, refreshAll, demo = false }) {
  const [period, setPeriod] = useState(14);
  const { days, recent, categories, priorities, workload } = useMemo(() => {
    const days = getDays(period);
    const lookup = new Map(days.map(day => [dayKey(day.date), day]));
    const categories = new Map();
    const workload = new Map();
    const priorities = { urgent: 0, high: 0, medium: 0, low: 0, unset: 0 };
    const recent = [];
    for (const complaint of complaints) {
      const day = lookup.get(dayKey(new Date(complaint.created_at)));
      if (!day) continue;
      day.count++;
      recent.push(complaint);
      const priority = complaint.priority === 'normal' ? 'medium' : complaint.priority;
      priorities[priorityLevels.includes(priority) ? priority : 'unset']++;
      const category = complaint.category || 'other';
      categories.set(category, (categories.get(category) || 0) + 1);
      const id = complaint.assigned_to || 'unassigned';
      const row = workload.get(id) || { id, name: complaint.assignee?.name || (complaint.assigned_to ? 'Team member' : 'Unassigned'), active: 0, resolved: 0 };
      row[isResolved(complaint) ? 'resolved' : 'active']++;
      workload.set(id, row);
    }
    return { days, recent, priorities, categories: [...categories].sort((a, b) => b[1] - a[1]), workload: [...workload.values()].sort((a, b) => b.active - a.active || b.resolved - a.resolved) };
  }, [complaints, period]);

  const resolved = recent.filter(isResolved).length;
  const unassigned = recent.filter(item => !item.assigned_to && !isResolved(item)).length;
  const metrics = [
    ['Received', recent.length], ['Open', recent.length - resolved], ['Resolved', resolved],
    [all ? 'Unassigned open' : 'Resolution rate', all ? unassigned : recent.length ? `${Math.round(resolved / recent.length * 100)}%` : '—'],
  ];

  return (
    <>
      <PageHeading title="Complaint insights" description={all ? 'Track incoming cases and how your team is handling them.' : 'Track the cases assigned to you.'}
        action={!demo && <Link className="rd-primary" to="/app/inbox">Open inbox <ArrowUpRight aria-hidden /></Link>} />
      {complaintError && <div className="rd-notice" role="alert">Couldn’t load the latest complaints. <button onClick={() => refreshAll()}>Retry</button></div>}
      <div className="rd-report-tools"><span><ArrowDownRight aria-hidden /> New cases in this period</span>
        <Segments label="Date range" value={period} onChange={setPeriod} options={[[7, '7 days'], [14, '14 days'], [30, '30 days']]} />
      </div>
      <div className="rd-metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{typeof value === 'number' ? <MetricNumber value={value} format={format} /> : value}</strong></div>)}</div>
      <div className="rd-insight-grid">
        <VolumeChart key={period} days={days} />
        <section className="rd-panel rd-categories">
          <div className="rd-panel-heading"><div><h2>Complaint categories</h2><p>Share of incoming cases</p></div></div>
          {categories.length ? <ul>{categories.map(([category, count]) => <li key={category}>
            <span>{CATEGORY_LABEL[category] || category}</span><strong>{format.format(count)}</strong>
            <div><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: count / recent.length }} transition={{ duration: .35, ease }} /></div>
          </li>)}</ul> : <div className="rd-empty"><Inbox aria-hidden /><p>No complaints in this period</p></div>}
        </section>
      </div>
      {!demo && <section className="rd-panel rd-priority-insights" aria-labelledby="priority-insights-heading">
        <div className="rd-panel-heading"><div><h2 id="priority-insights-heading">Complaint priorities</h2><p>Current priority of cases received in this period</p></div></div>
        <ul>{[...priorityLevels, ...(priorities.unset ? ['unset'] : [])].map(priority => (
          <li key={priority}>
            <span className="rd-priority" data-priority={priority}>{PRIORITY_LABEL[priority] || 'Unset'}</span>
            <strong>{format.format(priorities[priority])}</strong>
            <progress aria-label={`${PRIORITY_LABEL[priority] || 'Unset'} share of complaints`}
              value={priorities[priority]} max={recent.length || 1} />
          </li>
        ))}</ul>
      </section>}
      <section className="rd-panel rd-workload">
        <div className="rd-panel-heading"><div><h2>{all ? 'Workload by assignee' : 'Your workload'}</h2><p>Current status of cases received in this period</p></div></div>
        <table><thead><tr><th scope="col">Assignee</th><th scope="col">Open</th><th scope="col">Resolved</th><th scope="col">Total</th></tr></thead>
          <tbody>{workload.length ? workload.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{format.format(row.active)}</td><td>{format.format(row.resolved)}</td><td>{format.format(row.active + row.resolved)}</td></tr>) : <tr><td colSpan={4}>No cases for this period.</td></tr>}</tbody>
        </table>
      </section>
    </>
  );
}
