import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useCategories } from '../hooks/useCategories';
import { ExpenseList } from '../components/ExpenseList';
import { BalanceList } from '../components/BalanceList';
import { ActivityFeed } from '../components/ActivityFeed';
import { AddExpense } from './AddExpense';

export function GroupDetail() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const categories = useCategories();

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [balances, setBalances] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState(null);
  const [memberError, setMemberError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [groupRes, expenseRes, balanceRes, activityRes] = await Promise.all([
      api.get(`/api/groups/${groupId}`),
      api.get(`/api/groups/${groupId}/expenses`),
      api.get(`/api/groups/${groupId}/balances`),
      api.get(`/api/groups/${groupId}/activity`),
    ]);
    setGroup(groupRes.group);
    setMembers(groupRes.members);
    setCurrentUserRole(groupRes.currentUserRole);
    setExpenses(expenseRes.expenses);
    setBalances(balanceRes.balances);
    setTransfers(balanceRes.transfers);
    setActivity(activityRes.activity);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const invite = async (e) => {
    e.preventDefault();
    setInviteError(null);
    try {
      await api.post(`/api/groups/${groupId}/members`, { email: inviteEmail });
      setInviteEmail('');
      await loadAll();
    } catch (err) {
      setInviteError(err.message);
    }
  };

  const removeMember = async (memberId, name) => {
    const isSelf = memberId === user.id;
    const verb = isSelf ? 'leave this group' : `remove ${name} from this group`;
    if (!window.confirm(`Are you sure you want to ${verb}?`)) return;
    setMemberError(null);
    try {
      await api.del(`/api/groups/${groupId}/members/${memberId}`);
      await loadAll();
    } catch (err) {
      setMemberError(err.message);
    }
  };

  if (loading || categories.length === 0) return <div className="page-loading">Loading…</div>;

  const isDirect = group.kind === 'friend';
  const other = isDirect ? members.find((m) => m.id !== user.id) : null;
  const title = isDirect ? `Direct expenses with ${other?.name ?? 'friend'}` : group.name;

  return (
    <div className="page">
      <div className="card">
        <h2>{title}</h2>
        <p className="hint">Currency: {group.currency}</p>
        {!isDirect && (
          <>
            <ul className="member-list">
              {members.map((m) => (
                <li key={m.id}>
                  {m.name} {m.role === 'owner' && <span className="pill">owner</span>}
                  {(m.id === user.id || currentUserRole === 'owner') && (
                    <button className="btn btn-ghost btn-sm" onClick={() => removeMember(m.id, m.name)}>
                      {m.id === user.id ? 'Leave' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {memberError && <p className="hint hint-error">{memberError}</p>}
            <form className="invite-form" onSubmit={invite}>
              <input
                type="email"
                placeholder="Add a member by email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <button className="btn btn-ghost btn-sm" type="submit">
                Invite
              </button>
            </form>
            {inviteError && <p className="hint hint-error">{inviteError}</p>}
          </>
        )}
      </div>

      <BalanceList
        groupId={groupId}
        currentUserId={user.id}
        currency={group.currency}
        balances={balances}
        transfers={transfers}
        onSettled={loadAll}
      />

      <div className="card">
        <h3>Expenses</h3>
        <ExpenseList
          groupId={groupId}
          expenses={expenses}
          members={members}
          categories={categories}
          currentUserId={user.id}
          onChanged={loadAll}
        />
      </div>

      <AddExpense groupId={groupId} members={members} onAdded={loadAll} />

      <div className="card">
        <h3>Activity</h3>
        <ActivityFeed activity={activity} />
      </div>
    </div>
  );
}
