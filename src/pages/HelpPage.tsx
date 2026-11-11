import { useEffect, useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Activity, ArrowLeft, BookOpen, ChevronRight, Inbox, LifeBuoy, Search, ShieldAlert, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { tx } from '../i18n/translations';
import { useStore } from '../store/useStore';
import { ARTICLES, TOPICS, searchArticles, type Article } from '../help/articles';
import { NAV, navLabel } from '../components/nav';
import { listMessages, listRequests, categoryLabel, type SupportRequest } from '../services/support';
import RequestForm from '../help/RequestForm';
import RequestThread, { StatusBadge } from '../help/RequestThread';
import StatusPanel from '../help/StatusPanel';
import { fmtDate } from '../help/format';

type View = 'hub' | 'articles' | 'contact' | 'requests' | 'security' | 'status';
const VIEWS: View[] = ['hub', 'articles', 'contact', 'requests', 'security', 'status'];

const TITLES: Record<Exclude<View, 'hub'>, { title: string; subtitle: string }> = {
    articles: { title: 'Help Center', subtitle: 'Step-by-step guides for every part of Zaylo.' },
    contact: { title: 'Contact support', subtitle: 'Send a request to the Zaylo team. A person reads every request.' },
    requests: { title: 'Support requests', subtitle: 'Your requests and the team\'s replies.' },
    security: { title: 'Report a security concern', subtitle: 'A confidential report to the Zaylo team.' },
    status: { title: 'Service status', subtitle: 'Whether Zaylo is reachable from this device right now.' },
};

/** Help: search, guides, the AI assistant, support requests, security reports and service status. */
export default function HelpPage() {
    const lang = (useStore(s => s.user?.language) ?? 'en') as 'en' | 'ar';
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const articleId = params.get('article');
    const requestId = params.get('request');
    const view: View = VIEWS.includes(params.get('view') as View) ? (params.get('view') as View) : 'hub';
    const article = articleId ? ARTICLES.find(a => a.id === articleId) : undefined;
    const open = (next: Record<string, string>) => { setParams(next); window.scrollTo({ top: 0 }); };

    // Move focus to the page heading when the view changes, so keyboard and screen-reader users land in the new content.
    const headingId = useId();
    useEffect(() => { if (view !== 'hub' || articleId || requestId) document.getElementById(headingId)?.focus(); }, [view, articleId, requestId, headingId]);

    const back = (to: Record<string, string>, label: string) => (
        <button className="btn btn-ghost btn-sm help-back" onClick={() => open(to)}><ArrowLeft size={16} className="flip-rtl" aria-hidden /> {tx(label)}</button>
    );

    if (article) return (
        <div className="page help-page">
            {back(view === 'articles' ? { view: 'articles' } : {}, view === 'articles' ? 'Help Center' : 'Help and Support')}
            <ArticleView article={article} lang={lang} headingId={headingId} onOpenPage={p => navigate(`/${p}`)} onContact={() => open({ view: 'contact' })} />
        </div>
    );

    if (requestId) return (
        <div className="page help-page">
            {back({ view: 'requests' }, 'Support requests')}
            <h1 className="sr-only" id={headingId} tabIndex={-1}>{tx('Support request')}</h1>
            <RequestThread requestId={requestId === 'earlier' ? null : requestId} />
        </div>
    );

    if (view !== 'hub') return (
        <div className="page help-page">
            {back({}, 'Help and Support')}
            <div className="page-header">
                <div>
                    <h1 className="page-title" id={headingId} tabIndex={-1}>{tx(TITLES[view].title)}</h1>
                    <p className="page-subtitle">{tx(TITLES[view].subtitle)}</p>
                </div>
                {view === 'requests' && <button className="btn btn-primary" onClick={() => open({ view: 'contact' })}>{tx('New request')}</button>}
            </div>
            {view === 'articles' && <ArticleIndex lang={lang} onOpen={id => open({ view: 'articles', article: id })} />}
            {view === 'contact' && <RequestForm kind="support" preset={params.get('category') ? { category: params.get('category')! } : undefined}
                onCancel={() => open({})} onCreated={r => { toast.success(`${tx('Request sent. Your request number is')} #${r.number}`); open({ request: r.id }); }} />}
            {view === 'security' && <RequestForm kind="security"
                onCancel={() => open({})} onCreated={r => { toast.success(`${tx('Report sent. Your request number is')} #${r.number}`); open({ request: r.id }); }} />}
            {view === 'requests' && <RequestList lang={lang} onOpen={id => open({ request: id })} onNew={() => open({ view: 'contact' })} />}
            {view === 'status' && <StatusPanel />}
        </div>
    );

    return <Hub lang={lang} headingId={headingId} open={open} onAssistant={() => navigate('/assistant')} />;
}

// ───────────────────────── Hub ─────────────────────────
function Hub({ lang, headingId, open, onAssistant }: { lang: 'en' | 'ar'; headingId: string; open: (p: Record<string, string>) => void; onAssistant: () => void }) {
    const [query, setQuery] = useState('');
    const [requests, setRequests] = useState<SupportRequest[] | null | 'error'>(null);
    const results = query.trim().length > 1 ? searchArticles(query, lang) : null;
    const searchId = useId();

    useEffect(() => { listRequests().then(setRequests).catch(() => setRequests('error')); }, []);

    const actions: { icon: LucideIcon; title: string; desc: string; go: () => void }[] = [
        { icon: Sparkles, title: 'Ask Zaylo AI', desc: 'Instant answers about using Zaylo. Answers are written by AI.', go: onAssistant },
        { icon: BookOpen, title: 'Browse Help Center', desc: 'Guides for expenses, bills, savings, workspaces and your account.', go: () => open({ view: 'articles' }) },
        { icon: LifeBuoy, title: 'Contact support', desc: 'Send a request to the Zaylo team and get a reply here.', go: () => open({ view: 'contact' }) },
        { icon: Inbox, title: 'View support requests', desc: 'Check the status of your requests and read replies.', go: () => open({ view: 'requests' }) },
        { icon: ShieldAlert, title: 'Report a security concern', desc: 'Account access, suspicious activity, privacy or a weakness you found.', go: () => open({ view: 'security' }) },
        { icon: Activity, title: 'Check service status', desc: 'See whether Zaylo is reachable from this device.', go: () => open({ view: 'status' }) },
    ];
    const active = Array.isArray(requests) ? requests.filter(r => r.status === 'open' || r.status === 'waiting_on_you') : [];

    return (
        <div className="page help-page">
            <div className="page-header">
                <div>
                    <h1 className="page-title" id={headingId} tabIndex={-1}>{tx('Help and Support')}</h1>
                    <p className="page-subtitle">{tx('Get answers, troubleshoot problems, or contact the Zaylo support team.')}</p>
                </div>
            </div>

            <div className="help-search" role="search">
                <label className="sr-only" htmlFor={searchId}>{tx('Search help articles and common questions')}</label>
                <Search size={18} aria-hidden />
                <input id={searchId} type="search" className="form-input" value={query} onChange={e => setQuery(e.target.value)}
                    placeholder={tx('Search help articles and common questions')} autoComplete="off" enterKeyHint="search" />
            </div>

            {results ? (
                <section aria-live="polite" aria-label={tx('Search results')}>
                    <p className="help-count">{results.length === 0 ? tx('No articles match your search.') : `${results.length} ${results.length === 1 ? tx('article') : tx('articles')}`}</p>
                    {results.length > 0
                        ? <ArticleRows list={results} lang={lang} onOpen={id => open({ article: id })} />
                        : (
                            <div className="card help-noresult">
                                <p>{tx('Try different words, or ask one of these instead:')}</p>
                                <div className="help-noresult-actions">
                                    <button className="btn btn-secondary" onClick={onAssistant}><Sparkles size={16} /> {tx('Ask Zaylo AI')}</button>
                                    <button className="btn btn-secondary" onClick={() => open({ view: 'contact' })}><LifeBuoy size={16} /> {tx('Contact support')}</button>
                                </div>
                            </div>
                        )}
                </section>
            ) : (
                <>
                    <ul className="help-actions" aria-label={tx('Ways to get help')}>
                        {actions.map(a => (
                            <li key={a.title}>
                                <button className="help-action" onClick={a.go}>
                                    <span className="help-action-icon" aria-hidden><a.icon size={20} /></span>
                                    <span className="help-action-text"><strong>{tx(a.title)}</strong><span>{tx(a.desc)}</span></span>
                                    <ChevronRight size={18} className="flip-rtl help-action-arrow" aria-hidden />
                                </button>
                            </li>
                        ))}
                    </ul>

                    <div className="help-columns">
                        <section className="card" aria-labelledby="help-open-req">
                            <div className="card-head">
                                <h2 className="card-title" id="help-open-req">{tx('Your open requests')}</h2>
                                {Array.isArray(requests) && requests.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => open({ view: 'requests' })}>{tx('See all')}</button>}
                            </div>
                            {requests === null && <div className="skeleton" style={{ height: 44 }} />}
                            {requests === 'error' && <p className="form-hint">{tx('Your requests couldn\'t be loaded. Check your connection and open this page again.')}</p>}
                            {Array.isArray(requests) && active.length === 0 && <p className="form-hint">{tx('You have no open requests.')}</p>}
                            {active.slice(0, 3).map(r => <RequestRow key={r.id} r={r} lang={lang} onOpen={() => open({ request: r.id })} />)}
                        </section>
                        <section className="card" aria-labelledby="help-common">
                            <div className="card-head">
                                <h2 className="card-title" id="help-common">{tx('Common questions')}</h2>
                                <button className="btn btn-ghost btn-sm" onClick={() => open({ view: 'articles' })}>{tx('All guides')}</button>
                            </div>
                            <ArticleRows compact list={['add-expense', 'savings-goal', 'bills', 'ai-privacy', 'sync-offline'].map(id => ARTICLES.find(a => a.id === id)!).filter(Boolean)} lang={lang} onOpen={id => open({ article: id })} />
                        </section>
                    </div>

                    <footer className="help-about">
                        <span translate="no">Zaylo {__APP_VERSION__}</span>
                        <a href="https://zaylo.cc/privacy" target="_blank" rel="noreferrer">{tx('Privacy policy')}</a>
                        <a href="https://zaylo.cc/terms" target="_blank" rel="noreferrer">{tx('Terms of service')}</a>
                        <a href="https://zaylo.cc/security" target="_blank" rel="noreferrer">{tx('Security overview')}</a>
                        <a href="https://zaylo.cc/delete-account" target="_blank" rel="noreferrer">{tx('How to delete your account')}</a>
                    </footer>
                </>
            )}
        </div>
    );
}

// ───────────────────────── Articles ─────────────────────────
function ArticleRows({ list, lang, onOpen, compact }: { list: Article[]; lang: 'en' | 'ar'; onOpen: (id: string) => void; compact?: boolean }) {
    return (
        <ul className={`help-rows ${compact ? 'compact' : ''}`}>
            {list.map(a => (
                <li key={a.id}>
                    <button onClick={() => onOpen(a.id)}>
                        <span><strong>{a[lang].title}</strong>{!compact && <span>{a[lang].summary}</span>}</span>
                        <ChevronRight size={16} className="flip-rtl" aria-hidden />
                    </button>
                </li>
            ))}
        </ul>
    );
}

function ArticleIndex({ lang, onOpen }: { lang: 'en' | 'ar'; onOpen: (id: string) => void }) {
    return (
        <div className="help-topics">
            {(Object.keys(TOPICS) as Article['topic'][]).map(topic => {
                const list = ARTICLES.filter(a => a.topic === topic);
                if (!list.length) return null;
                return (
                    <section key={topic} className="card" aria-labelledby={`topic-${topic}`}>
                        <h2 className="card-title" id={`topic-${topic}`}>{TOPICS[topic][lang]}</h2>
                        <ArticleRows list={list} lang={lang} onOpen={onOpen} />
                    </section>
                );
            })}
        </div>
    );
}

function ArticleView({ article, lang, headingId, onOpenPage, onContact }: { article: Article; lang: 'en' | 'ar'; headingId: string; onOpenPage: (page: string) => void; onContact: () => void }) {
    const a = article[lang];
    const page = article.page ? NAV.find(n => n.key === article.page) : undefined;
    return (
        <article className="card help-article">
            <p className="help-article-topic">{TOPICS[article.topic][lang]}</p>
            <h1 id={headingId} tabIndex={-1}>{a.title}</h1>
            <p className="help-article-summary">{a.summary}</p>
            <ol>{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {a.notes && a.notes.length > 0 && (
                <div className="help-article-notes">
                    <h2>{tx('Good to know')}</h2>
                    <ul>{a.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </div>
            )}
            <div className="help-article-actions">
                {article.page && <button className="btn btn-primary" onClick={() => onOpenPage(article.page!)}>{tx('Open')} {article.page === 'settings' ? tx('Settings') : page ? navLabel(lang, page) : ''}</button>}
                <button className="btn btn-secondary" onClick={onContact}>{tx('This didn\'t solve it: contact support')}</button>
            </div>
        </article>
    );
}

// ───────────────────────── Requests ─────────────────────────
function RequestRow({ r, lang, onOpen }: { r: SupportRequest; lang: string; onOpen: () => void }) {
    return (
        <button className="help-req-row" onClick={onOpen}>
            <span className="help-req-main">
                <strong><span className="help-req-number" translate="no">#{r.number}</span> <span translate="no">{r.subject}</span></strong>
                <span>{tx(categoryLabel(r.category))} · {tx('Updated')} {fmtDate(r.updated_at, lang)}</span>
            </span>
            <StatusBadge status={r.status} />
        </button>
    );
}

function RequestList({ lang, onOpen, onNew }: { lang: string; onOpen: (id: string) => void; onNew: () => void }) {
    const [requests, setRequests] = useState<SupportRequest[] | null>(null);
    const [earlier, setEarlier] = useState(0);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server
        setError('');
        listRequests().then(setRequests).catch(e => { setRequests([]); setError(e instanceof Error ? e.message : 'Your requests couldn\'t be loaded. Try again.'); });
        listMessages(null).then(m => setEarlier(m.length)).catch(() => {});
    }, [attempt]);

    if (requests === null) return <div className="card" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 48, marginBottom: 10 }} />)}</div>;
    if (error) return <div className="card"><div className="empty-state"><div className="empty-title">{tx(error)}</div><button className="btn btn-secondary mt-4" onClick={() => setAttempt(a => a + 1)}>{tx('Try again')}</button></div></div>;
    if (requests.length === 0 && earlier === 0) return (
        <div className="card"><div className="empty-state">
            <div className="empty-title">{tx('No support requests yet')}</div>
            <div className="empty-desc">{tx('When you contact support, your request and the team\'s replies appear here.')}</div>
            <button className="btn btn-primary mt-4" onClick={onNew}>{tx('Contact support')}</button>
        </div></div>
    );
    return (
        <div className="card help-req-list">
            {requests.map(r => <RequestRow key={r.id} r={r} lang={lang} onOpen={() => onOpen(r.id)} />)}
            {earlier > 0 && (
                <button className="help-req-row" onClick={() => onOpen('earlier')}>
                    <span className="help-req-main"><strong>{tx('Earlier conversation')}</strong><span>{tx('Messages you exchanged with the Zaylo team before support requests were introduced.')}</span></span>
                    <ChevronRight size={16} className="flip-rtl" aria-hidden />
                </button>
            )}
        </div>
    );
}
