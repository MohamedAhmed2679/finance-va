export const locale = (lang: string) => (lang === 'ar' ? 'ar-EG' : 'en-GB');
export const fmtDateTime = (iso: string, lang: string) => new Date(iso).toLocaleString(locale(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso: string, lang: string) => new Date(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short', year: 'numeric' });
