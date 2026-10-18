import { useState } from 'react';
import { useCategories } from '../hooks/useCategories';
import { ExpenseForm } from '../components/ExpenseForm';
import { ScanReceipt } from '../components/ScanReceipt';
import { api } from '../api/client';
import { formatMoney } from '../utils/money';

export function AddExpense({ groupId, members, onAdded }) {
  const categories = useCategories();
  const [prefill, setPrefill] = useState(null);
  const [scanNote, setScanNote] = useState(null);
  const [pendingReceipt, setPendingReceipt] = useState(null);

  if (categories.length === 0) return null;

  const onScanned = (result, jpegBlob) => {
    setPrefill({ description: result.description, amountCents: result.amountCents, category: result.category });
    setPendingReceipt(jpegBlob);

    const notes = [];
    if (!result.readable) notes.push("Couldn't read that clearly — check the details below before saving.");
    if (result.convertedFrom) {
      notes.push(
        `Converted from ${formatMoney(result.convertedFrom.amountCents, result.convertedFrom.currency)} at today's rate.`
      );
    }
    if (result.notes) notes.push(result.notes);
    setScanNote(notes.join(' ') || null);
  };

  // The expense is created first (so participants/split are whatever the
  // user chose in the form); only once it exists is the scanned photo
  // attached to it as a receipt, reusing the same upload the receipts
  // feature already has.
  const onSaved = async (expenseId) => {
    if (pendingReceipt && expenseId) {
      const formData = new FormData();
      formData.append('file', pendingReceipt, 'receipt.jpg');
      try {
        await api.upload(`/api/groups/${groupId}/expenses/${expenseId}/receipts`, formData);
      } catch {
        // The expense itself was created fine either way — losing the
        // auto-attach isn't worth surfacing as an error here.
      }
    }
    setPrefill(null);
    setScanNote(null);
    setPendingReceipt(null);
    onAdded?.();
  };

  return (
    <div className="card">
      <h3>Add an expense</h3>
      <ScanReceipt groupId={groupId} onScanned={onScanned} />
      {scanNote && <p className="hint scan-note">{scanNote}</p>}
      <ExpenseForm groupId={groupId} members={members} categories={categories} prefill={prefill} onSaved={onSaved} />
    </div>
  );
}
