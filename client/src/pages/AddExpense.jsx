import { useCategories } from '../hooks/useCategories';
import { ExpenseForm } from '../components/ExpenseForm';

export function AddExpense({ groupId, members, onAdded }) {
  const categories = useCategories();
  if (categories.length === 0) return null;
  return <ExpenseForm groupId={groupId} members={members} categories={categories} onSaved={onAdded} />;
}
