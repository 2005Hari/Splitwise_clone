import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ExpenseList } from '../components/ExpenseList';
import { BalanceList } from '../components/BalanceList';
import { AddExpense } from './AddExpense';

export function GroupDetail() {
  const { groupId } = useParams();
  const { user } = useAuth();

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [balances, setBalances] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [groupRes, expenseRes, balanceRes] = await Promise.all([
      api.get(`/api/groups/${groupId}`),
      api.get(`/api/groups/${groupId}/expenses`),
      api.get(`/api/groups/${groupId}/balances`),
    ]);
    setGroup(groupRes.group);
    setMembers(groupRes.members);
    setExpenses(expenseRes.expenses);
    setBalances(balanceRes.balances);
    setTransfers(balanceRes.transfers);
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

  if (loading) return <div className="page-loading">Loading…</div>;

  return (
    <div className="page">
      <div className="card">
        <h2>{group.name}</h2>
        <p className="hint">{members.map((m) => m.name).join(', ')}</p>
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
      </div>

      <BalanceList
        groupId={groupId}
        currentUserId={user.id}
        balances={balances}
        transfers={transfers}
        onSettled={loadAll}
      />

      <div className="card">
        <h3>Expenses</h3>
        <ExpenseList expenses={expenses} />
      </div>

      <AddExpense groupId={groupId} members={members} onAdded={loadAll} />
    </div>
  );
}
