import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Inbox, Search } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { CATEGORY_LABEL, STATUS_LABEL, timeAgo } from '../../lib/format';
import { ease, PageHeading, Segments } from '../../workspace/controls';

import { Dropdown, DropdownSelect } from '../../workspace/Dropdown';

const filters = [['all', 'All statuses'], ['pending', 'Pending'], ['in_progress', 'In progress'], ['resolved', 'Resolved']];

export function ComplaintsView({ onSelectComplaint: selectComplaint } = {}) {
  const route = useOutletContext();
  const onSelectComplaint = selectComplaint || route?.onSelectComplaint;
  const { complaints, complaintError, refreshAll } = useData();
  const { user } = useAuth();
  const [scope, setScope] = useState('all');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [order, setOrder] = useState('recent');
  const [query, setQuery] = useState('');
  const reduce = useReducedMotion();
  const canSeeAll = ['owner', 'admin'].includes(user?.role);
  const results = complaints.filter(item => {
    if (scope === 'mine' && item.assigned_to !== user?.id) return false;
    if (scope === 'unassigned' && item.assigned_to) return false;
    const closed = ['resolved', 'closed'].includes(item.status);
    if (status === 'resolved' ? !closed : status !== 'all' && item.status !== status) return false;
    if (category !== 'all' && item.category !== category) return false;
    return [item.ticket_number, item.title, item.description, item.customer?.name, item.assignee?.name]
      .some(value => String(value ?? '').toLowerCase().includes(query.trim().toLowerCase()));
  });
  const priority = { urgent: 4, high: 3, medium: 2, normal: 2, low: 1 };
  results.sort((a, b) => {
    const byDate = new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
    if (order === 'priority') return (priority[b.priority] || 0) - (priority[a.priority] || 0) || byDate;
    return order === 'oldest' ? -byDate : byDate;
  });
  const filtered = Boolean(query || status !== 'all' || category !== 'all');

  return (
    <>
      <PageHeading title="Complaint inbox" description={canSeeAll ? 'Triage and reply to Telegram complaints.' : 'Reply to customers and track the cases assigned to you.'} />
      {complaintError && <div className="rd-notice" role="alert">Couldn’t load the latest complaints. <button onClick={() => refreshAll()}>Retry</button></div>}
      <section className="rd-panel rd-inbox">
        <div className="rd-inbox-tools">
          {canSeeAll && <Segments label="Assignment" value={scope} onChange={setScope} options={[[ 'all', 'Everyone'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned']]} />}
          <div className="rd-inbox-filters">
            <label className="rd-search"><Search aria-hidden /><input type="search" aria-label="Search complaints" placeholder="Search complaints" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <DropdownSelect label="Complaint status" value={status} onChange={setStatus} options={filters} />
            <Dropdown label="More filters">
              {() => <div className="rd-filter-fields">
                <div>Category<DropdownSelect label="Category" value={category} onChange={setCategory}
                  options={[[ 'all', 'All categories'], ...Object.entries(CATEGORY_LABEL)]} /></div>
                <div>Sort by<DropdownSelect label="Sort by" value={order} onChange={setOrder}
                  options={[[ 'recent', 'Last updated'], ['oldest', 'Oldest update'], ['priority', 'Priority']]} /></div>
              </div>}
            </Dropdown>
          </div>
        </div>
        <div className="rd-inbox-count" aria-live="polite">{results.length} {results.length === 1 ? 'complaint' : 'complaints'}</div>
        {results.length ? <ul className="rd-inbox-list">
          {results.map((item, index) => <motion.li key={item.id}
            initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: .2, delay: Math.min(.03 * index, .24), ease }}>
            <button type="button" className="rd-complaint-row" onClick={() => onSelectComplaint(item.id)}>
              <span className="rd-initial" aria-hidden>{(item.customer?.name || 'Customer').slice(0, 1)}</span>
              <span className="rd-row-subject"><strong>{item.title || item.description || 'Telegram complaint'}</strong>
                <small>{item.customer?.name || 'Telegram customer'}{item.category && ` · ${CATEGORY_LABEL[item.category] || item.category}`}</small></span>
              <span className="rd-row-assignee">{item.assignee?.name || 'Unassigned'}</span>
              <span className="rd-row-status" data-status={item.status}><i />{STATUS_LABEL[item.status] || item.status}</span>
              <time dateTime={item.updated_at || item.created_at}>{timeAgo(item.updated_at || item.created_at)}</time>
              <ArrowUpRight className="rd-row-arrow" aria-hidden />
            </button>
          </motion.li>)}
        </ul> : <div className="rd-empty"><Inbox aria-hidden /><h2>{filtered ? 'No matching complaints' : 'No complaints in this view'}</h2>
          {filtered && <button className="rd-secondary" onClick={() => { setQuery(''); setStatus('all'); setCategory('all'); }}>Clear filters</button>}</div>}
      </section>
    </>
  );
}
