import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  startTransition,
} from 'react';
import { PLAN_CATALOG } from '../../../shared/plans';
import { api, createIdempotencyKey, streamWorkspaceEvents } from '../services/api';
import { useAuth } from './AuthContext';
import { useToast } from '../ui/SileoToast';

const DataContext = createContext();
export function DataProvider({ children }) {
  const { user, org } = useAuth();
  const scope = JSON.stringify([org?.id, user?.id, user?.role]);
  return <ScopedDataProvider key={scope}>{children}</ScopedDataProvider>;
}

function ScopedDataProvider({ children }) {
  const { user, syncMemberPermissions } = useAuth();
  const { showToast, showUndo } = useToast();

  const [complaints, setComplaints] = useState([]);
  const [selectedComplaintId, setSelectedComplaintId] = useState(null);
  const [bots, setBots] = useState([]);
  const [team, setTeam] = useState({
    members: [],
    invitations: [],
    quota: { current: 0, max: 3, remaining: 3 },
  });
  const [subscription, setSubscription] = useState({
    plan: PLAN_CATALOG[0],
    usage: {
      bots: { current: 0, max: 1, available: 1 },
      team_members: { current: 1, max: 2, available: 1 },
    },
  });
  const [loading, setLoading] = useState(true);
  const [complaintError, setComplaintError] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const inFlight = useRef(new Set());
  const refreshVersion = useRef(0);

  const [optimisticComplaints, applyComplaint] = useOptimistic(
    complaints,
    (state, action) => {
      if (action.type === 'status') {
        return state.map((c) => (c.id === action.id ? { ...c, status: action.status } : c));
      }
      if (action.type === 'reply') {
        return state.map((c) =>
          c.id === action.id
            ? { ...c, messages: [...(c.messages || []), action.message], status: c.status === 'pending' ? 'in_progress' : c.status }
            : c
        );
      }
      return state;
    }
  );

  const [optimisticTeam, applyTeam] = useOptimistic(team, (state, action) => {
    if (action.type === 'remove') {
      return { ...state, members: state.members.filter((m) => m.id !== action.id) };
    }
    return state;
  });

  const [optimisticBots, applyBots] = useOptimistic(bots, (state, action) => {
    if (action.type === 'remove') return state.filter((b) => b.id !== action.id);
    if (action.type === 'restore') return [...state, action.bot].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return state;
  });

  const total = optimisticComplaints.length;
  const pending = optimisticComplaints.filter((c) => c.status === 'pending').length;
  const in_progress = optimisticComplaints.filter((c) => c.status === 'in_progress').length;
  const closed = optimisticComplaints.filter((c) => c.status === 'closed' || c.status === 'resolved').length;
  const resolution_rate_percent = total > 0 ? Math.round((closed / total) * 100) : 0;

  const stats = {
    total,
    pending,
    in_progress,
    closed,
    resolution_rate_percent,
    active_bots: optimisticBots.length,
    max_bots: subscription?.plan?.max_bots || 1,
    team_count: optimisticTeam.members.length || 1,
    max_members: subscription?.plan?.max_members || 3,
  };

  const categoriesList = ['product', 'delivery', 'billing', 'service', 'other'];
  const categoriesBreakdown = categoriesList.map((cat) => {
    const count = optimisticComplaints.filter((c) => c.category === cat).length;
    return { category: cat, count, percent: total > 0 ? Math.round((count / total) * 100) : 0 };
  });

  const refreshAll = useCallback(async ({ background = false } = {}) => {
    if (!user) return;
    const version = ++refreshVersion.current;
    if (!background) setLoading(true);
    try {
      const [complaintsData, botsData, teamData, subData] = await Promise.allSettled([
        api.getComplaints(),
        api.getBots(),
        api.getTeam(),
        api.getSubscription(),
      ]);

      if (version !== refreshVersion.current) return;
      setComplaintError(complaintsData.status === 'rejected');
      if (complaintsData.status === 'fulfilled' && Array.isArray(complaintsData.value)) {
        setComplaints(complaintsData.value);
      } else if ([401, 403].includes(complaintsData.reason?.status)) {
        setComplaints([]);
        setSelectedComplaintId(null);
      }
      if (botsData.status === 'fulfilled' && botsData.value?.bots) {
        setBots(botsData.value.bots);
      }
      if (teamData.status === 'fulfilled' && teamData.value) {
        setTeam(teamData.value);
        const currentMember = teamData.value.members.find(member => member.id === user.id);
        if (currentMember) syncMemberPermissions(currentMember);
      }
      if (subData.status === 'fulfilled' && subData.value) {
        setSubscription(subData.value);
      }
    } finally {
      if (version === refreshVersion.current) {
        setLoading(false);
        setHydrated(true);
      }
    }
  }, [user?.id, syncMemberPermissions]);

  useEffect(() => {
    if (!user) return undefined;
    refreshAll();

    const onFocus = () => refreshAll({ background: true });
    const onOnline = () => refreshAll({ background: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshAll({ background: true });
    };
    document.addEventListener('visibilitychange', onVisibility);

    const controller = new AbortController();
    let retry;
    let refreshTimer;
    let connected = false;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        refreshAll({ background: true });
      }, 250);
    };
    const connect = async () => {
      let retryDelay = 100;
      try {
        await streamWorkspaceEvents(() => {
          if (controller.signal.aborted) return;
          connected = true;
          scheduleRefresh();
        }, controller.signal);
      } catch {
        retryDelay = 3000;
      } finally {
        connected = false;
        if (!controller.signal.aborted) retry = window.setTimeout(connect, retryDelay);
      }
    };
    void connect();
    const interval = window.setInterval(() => {
      if (!connected) scheduleRefresh();
    }, 12000);
    return () => {
      controller.abort();
      window.clearTimeout(retry);
      window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshAll]);

  const fetchComplaintDetails = useCallback(async (id) => {
    if (!id) return null;
    try {
      const detailed = await api.getComplaint(id);
      if (detailed) {
        setComplaints((prev) => {
          const exists = prev.some((c) => c.id === id);
          if (!exists) return [detailed, ...prev];
          return prev.map((c) => (c.id === id ? { ...c, ...detailed } : c));
        });
        return detailed;
      }
    } catch (err) {
      console.warn('Could not fetch complaint details:', err.message);
    }
    return null;
  }, []);

  const visibleComplaints = ['owner', 'admin'].includes(user?.role)
    ? optimisticComplaints
    : optimisticComplaints.filter(item => item.assigned_to === user?.id || item.collaborator_ids?.includes(user?.id));
  const selectedComplaint = visibleComplaints.find((c) => c.id === selectedComplaintId) || null;

  const updateComplaintStatus = async (id, newStatus, userActor) => {
    const previous = complaints;
    startTransition(() => applyComplaint({ type: 'status', id, status: newStatus }));
    try {
      await api.updateStatus(id, newStatus);
      setComplaints((prev) => prev.map((c) => {
        if (c.id !== id) return c;
        return {
          ...c,
          status: newStatus,
          closed_at: newStatus === 'closed' || newStatus === 'resolved' ? new Date().toISOString() : c.closed_at,
          messages: [...(c.messages || []), {
            id: `audit-${Date.now()}`,
            sender_type: 'system',
            sender_name: 'System',
            message_text: `Status set to ${newStatus.replace('_', ' ')} by ${userActor?.name || 'staff'}.`,
            created_at: new Date().toISOString(),
          }],
        };
      }));
      fetchComplaintDetails(id);
      showToast(`Status updated to ${newStatus.replace('_', ' ')}`);
    } catch (e) {
      setComplaints(previous);
      showToast(e.message || 'Could not update status', 'error');
      throw e;
    }
  };

  const assignComplaint = async (id, assigneeId, assigneeName) => {
    const { message, ...updated } = await api.assignComplaint(id, assigneeId);
    setComplaints(previous => previous.map(item => item.id === id ? {
      ...item,
      ...updated,
      assignee: assigneeId ? { id: assigneeId, name: assigneeName } : null,
      messages: message ? [...(item.messages || []), message] : item.messages,
    } : item));
    showToast(assigneeId ? `Assigned to ${assigneeName}` : 'Ticket unassigned');
    refreshAll({ background: true });
  };

  const changeCollaborator = async (id, memberIds, add) => {
    const updated = await api.changeCollaborator(id, memberIds, add);
    setComplaints(previous => previous.map(item => item.id === id
      ? { ...item, collaborator_ids: updated.collaborator_ids }
      : item));
    refreshAll({ background: true });
  };

  const addComplaintNote = async (id, text) => {
    const note = await api.addComplaintNote(id, text, createIdempotencyKey());
    setComplaints(previous => previous.map(item => item.id === id
      ? { ...item, messages: [...(item.messages || []).filter(message => message.id !== note.id), note] }
      : item));
    refreshAll({ background: true });
  };

  const replyToComplaint = async (id, text, senderName = 'Support') => {
    const key = createIdempotencyKey();
    const tempId = `msg-${Date.now()}`;
    const tempMessage = {
      id: tempId,
      sender_type: 'agent',
      sender_name: senderName,
      message_text: text,
      created_at: new Date().toISOString(),
    };
    const previous = complaints;
    startTransition(() => applyComplaint({ type: 'reply', id, message: tempMessage }));
    try {
      const realMessage = await api.replyToComplaint(id, text, key);
      setComplaints((prev) => prev.map((c) => {
        if (c.id !== id) return c;
        const msgList = (c.messages || []).filter((m) => m.id !== tempId);
        return {
          ...c,
          status: c.status === 'pending' ? 'in_progress' : c.status,
          messages: [...msgList, realMessage || tempMessage],
        };
      }));
      fetchComplaintDetails(id);
      showToast('Reply sent to customer via Telegram');
      return realMessage;
    } catch (e) {
      setComplaints(previous);
      showToast(e.message || 'Reply failed', 'error');
      throw e;
    }
  };

  const updateMemberPermissions = async (memberId, permissions) => {
    const updatedUser = await api.updatePermissions(memberId, permissions);
    if (!updatedUser) throw new Error('Could not save permissions.');
    setTeam((prev) => ({
      ...prev,
      members: prev.members.map(member => member.id === memberId ? updatedUser : member),
    }));
    showToast('Permissions updated');
    refreshAll({ background: true });
  };

  const revokeInvitation = async (id) => {
    await api.revokeInvitation(id);
    setTeam(previous => ({
      ...previous,
      invitations: previous.invitations.filter(invitation => invitation.id !== id),
    }));
    showToast('Invitation deleted');
    refreshAll({ background: true });
  };

  const inviteMember = async (payload, idempotencyKey) => {
    const key = idempotencyKey || createIdempotencyKey();
    try {
      const res = await api.inviteMember(payload, key);
      await refreshAll({ background: true });
      showToast(res.message || `Invitation sent to ${payload.email}`);
      return res;
    } catch (e) {
      refreshAll({ background: true });
      showToast(e.message || 'Failed to send invite', 'error');
      throw e;
    }
  };

  const linkBot = async ({ bot_token, bot_title }, idempotencyKey) => {
    const key = idempotencyKey || createIdempotencyKey();
    try {
      await api.linkBot(bot_token, bot_title, key);
      await refreshAll({ background: true });
      showToast('Bot connected');
    } catch (err) {
      showToast(err.message || 'Failed to link bot', 'error');
      throw err;
    }
  };

  const upgradePlan = async (planId, billingPeriod, idempotencyKey) => {
    const key = idempotencyKey || createIdempotencyKey();
    try {
      const res = await api.upgradeSubscription(planId, billingPeriod, key);
      const live = await api.getSubscription();
      if (live) setSubscription(live);
      showToast(res?.message || 'Plan updated');
      return res;
    } catch (err) {
      showToast(err.message || 'Could not update plan', 'error');
      throw err;
    }
  };

  const activateBot = async (botId) => {
    try {
      await api.activateBot(botId);
      await refreshAll({ background: true });
      showToast('Bot activated');
    } catch (err) {
      showToast(err.message || 'Failed to activate bot', 'error');
      throw err;
    }
  };

  const pauseBot = async (botId) => {
    try {
      await api.pauseBot(botId);
      await refreshAll({ background: true });
      showToast('Bot paused');
    } catch (err) {
      showToast(err.message || 'Failed to pause bot', 'error');
      throw err;
    }
  };

  const deleteBot = async (botId) => {
    const bot = bots.find((b) => b.id === botId);
    startTransition(() => applyBots({ type: 'remove', id: botId }));
    setBots((prev) => prev.filter((b) => b.id !== botId));
    showUndo({
      message: 'Bot scheduled for removal',
      duration: 8000,
      onUndo: () => {
        if (bot) setBots((prev) => [...prev, bot]);
      },
      onCommit: async () => {
        try {
          await api.deleteBot(botId);
          await refreshAll({ background: true });
        } catch (err) {
          if (bot) setBots((prev) => [...prev, bot]);
          showToast(err.message || 'Failed to delete bot', 'error');
        }
      },
    });
  };

  const deleteMember = async (memberId) => {
    const member = team.members.find((m) => m.id === memberId);
    startTransition(() => applyTeam({ type: 'remove', id: memberId }));
    setTeam((prev) => ({ ...prev, members: prev.members.filter((m) => m.id !== memberId) }));
    showUndo({
      message: 'Member scheduled for removal',
      duration: 8000,
      onUndo: () => {
        if (member) setTeam((prev) => ({ ...prev, members: [...prev.members, member] }));
      },
      onCommit: async () => {
        try {
          await api.deleteMember(memberId);
          await refreshAll({ background: true });
        } catch (err) {
          if (member) setTeam((prev) => ({ ...prev, members: [...prev.members, member] }));
          showToast(err.message || 'Failed to remove member', 'error');
        }
      },
    });
  };

  return (
    <DataContext.Provider
      value={{
        complaints: visibleComplaints,
        selectedComplaint,
        selectedComplaintId,
        setSelectedComplaintId,
        bots: optimisticBots,
        team: optimisticTeam,
        subscription,
        complaintError,
        stats,
        categoriesBreakdown,
        loading,
        hydrated,
        refreshAll,
        fetchComplaintDetails,
        updateComplaintStatus,
        assignComplaint,
        changeCollaborator,
        addComplaintNote,
        replyToComplaint,
        updateMemberPermissions,
        inviteMember,
        revokeInvitation,
        linkBot,
        activateBot,
        pauseBot,
        deleteBot,
        deleteMember,
        upgradePlan,
        showToast,
        createIdempotencyKey,
        inFlight,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);