import { useState } from 'react';
import { Camera } from '@phosphor-icons/react';
import { api } from '../api/client';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

// Downscales a phone-camera photo before it's uploaded — keeps the AI call
// fast and cheap, and the result is still what gets attached as the
// expense's receipt, so there's no second, larger upload later.
async function resizeToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))), 'image/jpeg', JPEG_QUALITY);
  });
}

// "Scan a receipt": AI (Claude, via the server — see server/src/services/receiptAI.js)
// reads a photo of a bill and returns a suggested description/amount/category.
// It never creates the expense itself — onScanned hands the result (and the
// photo, for later receipt-attachment) up to the parent, which pre-fills the
// normal Add Expense form so the person still picks who to split with.
export function ScanReceipt({ groupId, onScanned }) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setScanning(true);
    try {
      const jpeg = await resizeToJpeg(file);
      const formData = new FormData();
      formData.append('file', jpeg, 'receipt.jpg');
      const result = await api.upload(`/api/groups/${groupId}/expenses/scan`, formData);
      onScanned(result, jpeg);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="scan-receipt">
      <label className="btn btn-primary btn-sm scan-receipt-btn">
        <Camera size={16} weight="bold" />
        {scanning ? 'Reading receipt…' : 'Scan a receipt'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChosen}
          disabled={scanning}
          hidden
        />
      </label>
      {error && <p className="hint hint-error">{error}</p>}
    </div>
  );
}
