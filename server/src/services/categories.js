// A small curated set, matching the common Splitwise categories closely
// enough to be familiar, without trying to replicate its full category tree.
export const EXPENSE_CATEGORIES = [
  { id: 'general', label: 'General', icon: '🧾' },
  { id: 'food', label: 'Food & drink', icon: '🍽️' },
  { id: 'groceries', label: 'Groceries', icon: '🛒' },
  { id: 'transport', label: 'Transportation', icon: '🚕' },
  { id: 'lodging', label: 'Accommodation', icon: '🏨' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { id: 'utilities', label: 'Utilities', icon: '💡' },
  { id: 'rent', label: 'Rent & housing', icon: '🏠' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'medical', label: 'Medical', icon: '🩺' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'other', label: 'Other', icon: '🔖' },
];

export const CATEGORY_IDS = EXPENSE_CATEGORIES.map((c) => c.id);
