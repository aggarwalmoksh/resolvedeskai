import React, { useEffect, useRef, useState } from 'react';
import { Check, Send, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL, timeAgo } from '../../lib/format';
import { Dropdown, DropdownSelect } from '../../workspace/Dropdown';
import { Segments, WorkspaceDialog } from '../../workspace/controls';

export function ComplaintDetailSheet({ complaint, open, onClose }) {
  return open && complaint ? <Conversation key={complaint.id} complaint={complaint} onClose={onClose} /> : null;
}

function Conversation({ complaint, onClose }) {
  const { team, updateComplaintStatus, updateComplaintPriority, assignComplaint, changeCollaborator, addComplaintNote, replyToComplaint, fetchComplaintDetails } = useData();
  const { user, can } = useAuth();
  const [text, setText] = useState('');
  const [selectedCollaborators, setSelectedCollaborators] = useState([]);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState('conversation');
  const conversation = tab === 'conversation';
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const end = useRef(null);
  const { id, messages = [], status } = complaint;
  const customer = complaint.customer?.name || 'Telegram customer';
  const collaborators = complaint.collaborator_ids || [];
  const staff = team.members.filter(member => member.is_active !== false);
  const availableCollaborators = staff.filter(member => member.id !== complaint.assigned_to && !collaborators.includes(member.id));
  const selectedIds = availableCollaborators.filter(member => selectedCollaborators.includes(member.id)).map(member => member.id);
  const canManage = complaint.assigned_to === user?.id ||
    (['admin', 'owner'].includes(user?.role) && can('can_assign'));
  const canEditPriority = complaint.assigned_to === user?.id || ['admin', 'owner'].includes(user?.role);
  const priority = complaint.priority === 'normal' ? 'medium' : complaint.priority;
  const closed = ['closed', 'resolved'].includes(status);

  useEffect(() => { fetchComplaintDetails(id); }, [id, fetchComplaintDetails]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, tab]);

  async function perform(action, operation) {
    if (busy) return;
    setBusy(action);
    setError('');
    try { await operation(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }

  function send(event) {
    event.preventDefault();
    if (text.trim()) perform('reply', async () => {
      await replyToComplaint(id, text.trim(), user?.name);
      setText('');
    });
  }

  const firstMessage = complaint.customer_message || complaint.description;
  const showFirst = firstMessage && !messages.some(message => message.sender_type === 'customer' && (message.message_text || message.text) === firstMessage);

  return <WorkspaceDialog title={complaint.title || customer} drawer onClose={onClose}>
    <div className="rd-conversation-meta"><div><strong>{customer}</strong><small>{complaint.ticket_number} · {CATEGORY_LABEL[complaint.category] || 'Other'}</small>
      <span className="rd-priority" data-priority={complaint.priority}>{PRIORITY_LABEL[complaint.priority] || 'Unset'} priority</span></div>
      {can('can_update_status') ? <button className="rd-secondary" disabled={Boolean(busy)} onClick={() => perform('status', () => updateComplaintStatus(id, closed ? 'in_progress' : 'resolved', user))}>
        <Check aria-hidden /> {closed ? 'Reopen' : 'Resolve'}
      </button> : <span>{STATUS_LABEL[status]}</span>}
    </div>
    <div className="rd-assignment">
      <div className="rd-assignment-field">
        <span>{STATUS_LABEL[status]}</span>
        {canEditPriority && <DropdownSelect label="Change ticket priority" disabled={Boolean(busy)}
          value={priority || ''}
          options={['low', 'medium', 'high', 'urgent'].map(value => [value, `${PRIORITY_LABEL[value]} priority`])}
          onChange={value => perform('priority', () => updateComplaintPriority(id, value))} />}
      </div>
      {canManage ? <div className="rd-assignment-field">{can('can_assign') ? 'Assignee' : 'Forward ticket'}
        <DropdownSelect label="Forward or assign ticket" disabled={Boolean(busy)} value={complaint.assigned_to || ''}
          options={[...(can('can_assign') ? [['', 'Unassigned']] : []), ...staff.map(member => [member.id, member.name || member.email])]}
          onChange={assigneeId => {
            if (assigneeId === complaint.assigned_to) return;
            const member = staff.find(item => item.id === assigneeId);
            perform('assignment', async () => {
              await assignComplaint(id, member?.id || null, member?.name);
              if (!['admin', 'owner'].includes(user?.role) && !collaborators.includes(user?.id)) onClose();
            });
          }} />
      </div>
        : <span>{complaint.assignee?.name || 'Unassigned'}</span>}
    </div>
    <div className="rd-ticket-collaboration">
      <div className="rd-ticket-collaborators">
        <span>Collaborators</span>
        {staff.filter(member => collaborators.includes(member.id)).map(member => <span className="rd-ticket-collaborator" key={member.id}>
          {member.name || member.email}
          {canManage && <button type="button" disabled={Boolean(busy)} aria-label={`Remove ${member.name || member.email} from ticket`}
            onClick={() => perform('collaborator', () => changeCollaborator(id, [member.id], false))}><X aria-hidden /></button>}
        </span>)}
        {canManage && availableCollaborators.length > 0 && <Dropdown label="Add collaborators" disabled={Boolean(busy)}>
          {close => <div className="rd-collaborator-picker">
            <div className="rd-collaborator-options">
              {availableCollaborators.map(member => <label key={member.id}>
                <input type="checkbox" checked={selectedIds.includes(member.id)} disabled={Boolean(busy)}
                  onChange={event => {
                    const checked = event.target.checked;
                    setSelectedCollaborators(previous => checked
                      ? [...previous, member.id]
                      : previous.filter(id => id !== member.id));
                  }} />
                <span>{member.name || member.email}</span>
              </label>)}
            </div>
            <button type="button" className="rd-primary" disabled={!selectedIds.length || Boolean(busy)}
              onClick={() => perform('collaborator', async () => {
                await changeCollaborator(id, selectedIds, true);
                setSelectedCollaborators([]);
                close();
              })}>{selectedIds.length ? `Add ${selectedIds.length} selected` : 'Add selected'}</button>
          </div>}
        </Dropdown>}
      </div>
      <Segments label="Ticket thread" value={tab} onChange={setTab} options={[[ 'conversation', 'Conversation'], ['notes', 'Internal notes']]} />
    </div>
    <div className="rd-thread" aria-label={conversation ? 'Conversation' : 'Internal notes'}>
      {conversation && showFirst && <div className="rd-message"><small>{customer} · {timeAgo(complaint.created_at)}</small><p>{firstMessage}</p></div>}
      {!conversation && !messages.some(message => message.sender_type === 'internal_note') && <p>No internal notes yet.</p>}
      {messages.filter(message => (message.sender_type !== 'internal_note') === conversation).map((message, index) => <div key={message.id || index} className="rd-message" data-sender={message.sender_type}>
        <small>{message.sender_name || (message.sender_type === 'customer' ? customer : 'Support')} · {timeAgo(message.created_at)}</small>
        <p>{message.message_text || message.text || message.message}</p>
      </div>)}
      <div ref={end} />
    </div>
    {error && <p className="rd-form-error" role="alert">{error}</p>}
    {conversation && can('can_reply') && <form className="rd-composer" onSubmit={send}>
      <textarea aria-label="Telegram reply" rows={3} placeholder="Reply to the customer on Telegram…" value={text} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send(event); }} />
      <button className="rd-primary" disabled={Boolean(busy) || !text.trim()}>{busy === 'reply' ? 'Sending…' : 'Send reply'} <Send aria-hidden /></button>
    </form>}
    {!conversation && <form className="rd-composer" onSubmit={event => {
      event.preventDefault();
      if (!note.trim()) return;
      perform('note', async () => {
        await addComplaintNote(id, note.trim());
        setNote('');
      });
    }}>
      <textarea aria-label="Private internal note" maxLength={4000} rows={3}
        placeholder="Add context for the ticket team…" value={note} onChange={event => setNote(event.target.value)} />
      <button className="rd-primary" disabled={Boolean(busy) || !note.trim()}>{busy === 'note' ? 'Saving…' : 'Save private note'}</button>
    </form>}
  </WorkspaceDialog>;
}
