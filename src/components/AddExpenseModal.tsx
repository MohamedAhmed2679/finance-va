import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { CURRENCIES } from '../constants';
import { X, Camera, Upload, RefreshCw, FileText } from 'lucide-react';
import Webcam from 'react-webcam';
import Tesseract from 'tesseract.js';

interface Props { onClose: () => void; editId?: string; }

export default function AddExpenseModal({ onClose, editId }: Props) {
    const { user, activeWorkspaceId, workspaces, addExpense, updateExpense, expenses, categories, paymentMethods } = useStore();
    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    const editingExp = editId ? expenses.find(e => e.id === editId) : null;

    const [amount, setAmount] = useState(editingExp ? String(editingExp.amount) : '');
    const [currency, setCurrency] = useState(editingExp?.currency ?? ws?.currency ?? 'USD');
    const [merchant, setMerchant] = useState(editingExp?.merchant ?? '');
    const [description, setDescription] = useState(editingExp?.description ?? '');
    const [category, setCategory] = useState<string>(editingExp?.category ?? 'other');
    const [paymentMethod, setPaymentMethod] = useState<string>(editingExp?.paymentMethod ?? 'card');
    const [last4, setLast4] = useState(editingExp?.last4 ?? '');
    const [notes, setNotes] = useState(editingExp?.notes ?? '');
    const [purchaseAt, setPurchaseAt] = useState(editingExp?.purchaseAt ? editingExp.purchaseAt.slice(0, 16) : new Date().toISOString().slice(0, 16));

    const [step, setStep] = useState<'scan' | 'amount' | 'details'>(editId ? 'details' : 'scan');

    // Scanner state
    const webcamRef = useRef<Webcam>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scanError, setScanError] = useState('');

    const uid = user?.id ?? 'user_demo_001';
    const userName = user?.name ?? 'User';

    function handleKeypad(val: string) {
        if (val === '⌫') { setAmount(a => a.slice(0, -1)); return; }
        if (val === '.' && amount.includes('.')) return;
        if (val === '.' && !amount) { setAmount('0.'); return; }
        setAmount(a => (a + val).replace(/^0+(\d)/, '$1'));
    }

    const processImage = async (imageSrc: string) => {
        setIsScanning(true);
        setScanError('');
        try {
            const result = await Tesseract.recognize(imageSrc, 'eng', { logger: m => console.log(m) });
            const text = result.data.text;

            // Basic OCR Parsing Logic
            const lines = text.split('\n');

            // Try to find total amount (look for $, £, €, E£, or just large numbers at bottom)
            const numberRegex = /[\d,]+\.\d{2}/g;
            const amounts: number[] = [];
            let foundMerchant = '';

            lines.forEach((line, index) => {
                // Merchant is usually at the top
                if (index < 3 && !foundMerchant && line.trim().length > 3 && !line.match(/\d/)) {
                    foundMerchant = line.trim();
                }

                const matches = line.match(numberRegex);
                if (matches) {
                    matches.forEach(m => amounts.push(parseFloat(m.replace(/,/g, ''))));
                }
            });

            if (amounts.length > 0) {
                // Assume largest number is total
                const maxAmount = Math.max(...amounts);
                setAmount(maxAmount.toString());
            }

            if (foundMerchant) {
                setMerchant(foundMerchant);
            }

            setNotes(`Scanned text: \n${text.substring(0, 100)}...`);
            setStep('details');
        } catch (err) {
            setScanError('Failed to read text from receipt. Try again.');
            console.error(err);
        } finally {
            setIsScanning(false);
        }
    };

    const capture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) processImage(imageSrc);
    }, [webcamRef]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (e.target?.result) processImage(e.target.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    function handleSave() {
        if (!amount || !merchant) return;
        const expData = { workspaceId: activeWorkspaceId, createdByUid: uid, createdByName: userName, purchaseAt: new Date(purchaseAt).toISOString(), amount: parseFloat(amount), currency, merchant, description, category, paymentMethod, last4, tags: [], notes, source: (step === 'scan' ? 'ocr' : 'manual') as 'ocr' | 'manual' };
        if (editId) { updateExpense(editId, expData); } else { addExpense(expData); }
        onClose();
    }

    // const catInfo = getCategoryInfo(category); // This variable was unused and has been commented out or removed if it was part of the original instruction.

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal animate-slideUp">
                <div className="modal-header">
                    <h2 className="modal-title">{editId ? 'Edit Expense' : 'Add Expense'}</h2>
                    <button className="modal-close" onClick={onClose}><X size={20} /></button>
                </div>

                {step === 'scan' && !editId ? (
                    <div className="animate-fadeIn" style={{ textAlign: 'center' }}>
                        <div style={{ marginBottom: 24 }}>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                                <button className={`btn btn-primary`} style={{ flex: 1 }} onClick={() => setStep('scan')}><Camera size={16} /> Scan</button>
                                <button className={`btn btn-ghost`} style={{ flex: 1 }} onClick={() => setStep('amount')}><FileText size={16} /> Manual</button>
                            </div>

                            <div style={{ position: 'relative', background: '#000', borderRadius: 16, overflow: 'hidden', height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {isScanning ? (
                                    <div style={{ color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                                        <RefreshCw className="animate-spin" size={32} />
                                        <p>Scanning receipt...</p>
                                    </div>
                                ) : (
                                    <>
                                        <Webcam
                                            audio={false}
                                            ref={webcamRef}
                                            screenshotFormat="image/jpeg"
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            videoConstraints={{ facingMode: "environment" }}
                                        />
                                        <div style={{ position: 'absolute', inset: 0, border: '2px solid rgba(255,255,255,0.4)', margin: 24, borderRadius: 12, pointerEvents: 'none' }} />
                                    </>
                                )}
                            </div>
                        </div>

                        {scanError && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{scanError}</div>}

                        <div style={{ display: 'flex', gap: 12 }}>
                            <label className="btn btn-secondary" style={{ flex: 1, cursor: 'pointer' }}>
                                <Upload size={16} /> Upload Image
                                <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                            </label>
                            <button className="btn btn-primary" style={{ flex: 2 }} onClick={capture} disabled={isScanning}>
                                <Camera size={16} /> Capture Receipt
                            </button>
                        </div>
                    </div>
                ) : step === 'amount' && !editId ? (
                    <div className="animate-fadeIn">
                        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep('scan')}><Camera size={16} /> Scan</button>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep('amount')}><FileText size={16} /> Manual</button>
                        </div>
                        <div className="amount-display">
                            <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)} style={{ padding: '4px 8px', borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--text-muted)', fontWeight: 600, appearance: 'none', cursor: 'pointer', fontSize: 18 }}>
                                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                            </select>
                            {amount || '0'}
                        </div>
                        <div className="keypad">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => (
                                <button key={k} className="keypad-btn" onClick={() => handleKeypad(k)}>{k}</button>
                            ))}
                        </div>
                        <button className="btn btn-primary w-full" style={{ marginTop: 24 }} onClick={() => setStep('details')} disabled={!amount || amount === '0'}>Continue →</button>
                    </div>
                ) : (
                    <div className="animate-fadeIn">
                        {!editId && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, background: 'var(--primary-soft)', borderRadius: 12, padding: '12px 16px', cursor: 'pointer' }} onClick={() => setStep('amount')}>
                                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--primary-light)' }}>{currency} {amount}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>tap to change</div>
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
                            <div className="form-group">
                                <label className="form-label">Merchant *</label>
                                <input className="form-input" value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="e.g. Whole Foods Market" required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Currency</label>
                                <select className="form-input form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Description</label>
                            <input className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?" />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Category</label>
                            <div className="category-chips" style={{ flexWrap: 'wrap' }}>
                                {categories.map(cat => (
                                    <div key={cat.key} className={`category-chip ${category === cat.key ? 'selected' : ''}`} onClick={() => setCategory(cat.key)}>
                                        {cat.emoji} {cat.label}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Payment Method</label>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {paymentMethods.map(pm => (
                                    <div key={pm.key} className={`category-chip ${paymentMethod === pm.key ? 'selected' : ''}`} onClick={() => setPaymentMethod(pm.key)}>
                                        {pm.emoji} {pm.label}
                                    </div>
                                ))}
                            </div>
                            {paymentMethod === 'card' && <input className="form-input" style={{ marginTop: 8 }} value={last4} onChange={e => setLast4(e.target.value.slice(-4))} placeholder="Last 4 digits (optional)" maxLength={4} />}
                        </div>

                        <div className="form-group">
                            <label className="form-label">Date & Time</label>
                            <input type="datetime-local" className="form-input" value={purchaseAt} onChange={e => setPurchaseAt(e.target.value)} />
                        </div>

                        {editId && (
                            <div className="form-group">
                                <label className="form-label">Amount ({ws?.currency ?? 'USD'})</label>
                                <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} step="0.01" min="0" />
                            </div>
                        )}

                        <div className="form-group">
                            <label className="form-label">Notes</label>
                            <textarea className="form-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." rows={2} style={{ resize: 'none' }} />
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                            {!editId && <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep('amount')}>← Back</button>}
                            <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave} disabled={!merchant || !amount}>
                                {editId ? 'Save Changes' : '✓ Add Expense'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
