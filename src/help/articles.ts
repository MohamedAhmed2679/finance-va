/**
 * Help Center articles. They describe what the app does today: when a feature changes,
 * change its article in the same pull request. No article may promise something the app can't do.
 */
export interface Article {
    id: string;
    topic: 'start' | 'transactions' | 'planning' | 'workspaces' | 'account' | 'privacy';
    /** Page this article is about: shown as an "Open …" button. */
    page?: string;
    keywords: string;
    en: { title: string; summary: string; steps: string[]; notes?: string[] };
    ar: { title: string; summary: string; steps: string[]; notes?: string[] };
}

export const TOPICS: Record<Article['topic'], { en: string; ar: string }> = {
    start: { en: 'Getting started', ar: 'البداية' },
    transactions: { en: 'Expenses and income', ar: 'المصروفات والدخل' },
    planning: { en: 'Bills, savings and shopping', ar: 'الفواتير والادخار والتسوق' },
    workspaces: { en: 'Workspaces and sharing', ar: 'مساحات العمل والمشاركة' },
    account: { en: 'Account and sign-in', ar: 'الحساب وتسجيل الدخول' },
    privacy: { en: 'Privacy and your data', ar: 'الخصوصية وبياناتك' },
};

export const ARTICLES: Article[] = [
    {
        id: 'add-expense', topic: 'transactions', page: 'expenses',
        keywords: 'add expense record spend receipt scan voice paste sms photo pdf مصروف إضافة إيصال صوت',
        en: {
            title: 'Add an expense',
            summary: 'Type it, say it, scan a receipt, or paste a bank message. You always review before anything is saved.',
            steps: [
                'Press the + button.',
                'Choose how to add it: type the details, record a voice note, scan a receipt with the camera, upload a photo or PDF, or paste a bank SMS.',
                'Check the amount, shop, category and date that Zaylo filled in. Change anything that is wrong.',
                'Save. The expense appears in Expenses and in your totals for this cycle.',
            ],
            notes: [
                'Voice notes, receipts and pasted text are read by Zaylo AI, which you must allow first. Typing an expense by hand never uses AI.',
                'An expense keeps the currency you entered it in. Totals are shown in the workspace currency using the rate on the day you added it.',
            ],
        },
        ar: {
            title: 'إضافة مصروف',
            summary: 'اكتبه، أو قله بصوتك، أو امسح إيصالًا، أو الصق رسالة البنك. تراجع دائمًا قبل الحفظ.',
            steps: [
                'اضغط زر +.',
                'اختر طريقة الإضافة: كتابة التفاصيل، تسجيل ملاحظة صوتية، مسح إيصال بالكاميرا، رفع صورة أو ملف PDF، أو لصق رسالة بنكية.',
                'راجع المبلغ والمتجر والفئة والتاريخ التي ملأها Zaylo، وعدّل ما هو خطأ.',
                'احفظ. يظهر المصروف في المصروفات وفي إجماليات هذه الدورة.',
            ],
            notes: [
                'الملاحظات الصوتية والإيصالات والنص الملصق يقرؤها Zaylo AI، ويجب أن تسمح بذلك أولًا. كتابة المصروف يدويًا لا تستخدم الذكاء الاصطناعي أبدًا.',
                'يحتفظ المصروف بالعملة التي أدخلته بها. تُعرض الإجماليات بعملة مساحة العمل بسعر يوم الإضافة.',
            ],
        },
    },
    {
        id: 'income-cycle', topic: 'transactions', page: 'earnings',
        keywords: 'income salary payday cycle start day budget month دخل راتب دورة ميزانية',
        en: {
            title: 'Income, payday and your budget cycle',
            summary: 'Your cycle starts on your salary day, so "this cycle" matches how you are actually paid.',
            steps: [
                'Open Transactions, then Income & Earnings.',
                'Add your salary as fixed income and set the day of the month it arrives.',
                'Add one-off income (a bonus, a sale) with its own date.',
                'To change the salary day later, edit it on the Income page.',
            ],
            notes: ['Changing the salary day changes which dates count as "this cycle" on Home and in Insights. No records are altered.'],
        },
        ar: {
            title: 'الدخل ويوم الراتب ودورة الميزانية',
            summary: 'تبدأ دورتك في يوم راتبك، لتطابق "هذه الدورة" الطريقة التي تُدفع لك بها فعلًا.',
            steps: [
                'افتح المعاملات ثم الدخل والأرباح.',
                'أضف راتبك كدخل ثابت وحدد يوم وصوله من الشهر.',
                'أضف الدخل غير المتكرر (مكافأة، بيع) بتاريخه.',
                'لتغيير يوم الراتب لاحقًا، عدّله من صفحة الدخل.',
            ],
            notes: ['تغيير يوم الراتب يغيّر التواريخ المحسوبة ضمن "هذه الدورة" في الرئيسية والتحليلات. لا تُعدَّل أي سجلات.'],
        },
    },
    {
        id: 'autotrack', topic: 'transactions', page: 'autotrack',
        keywords: 'autotrack bank sms wallet alert import pending review needs review automatic الرسائل البنكية تلقائي مراجعة',
        en: {
            title: 'AutoTrack: records from bank and wallet alerts',
            summary: 'AutoTrack turns bank and wallet alerts into records. It is off until you set it up, and by default every record waits for your review.',
            steps: [
                'Open Transactions, then AutoTrack, and follow the three setup steps.',
                'On Android you can let Zaylo receive alerts from the bank senders you choose. On iPhone you share or forward alerts with the Shortcut. On any device you can paste an alert.',
                'Open Needs Review to confirm, change or ignore each record.',
                'In AutoTrack settings you can switch to adding recognised alerts automatically, and you can delete everything AutoTrack imported.',
            ],
            notes: [
                'Security codes (OTP) are never read, kept or sent anywhere.',
                'A record marked pending comes from an alert that says the payment is not final yet. It is not counted as completed until you confirm it.',
                'Alerts are read on your device. The optional AI reading for unfamiliar formats is a separate switch and is off by default.',
            ],
        },
        ar: {
            title: 'AutoTrack: سجلات من تنبيهات البنك والمحفظة',
            summary: 'يحوّل AutoTrack تنبيهات البنك والمحفظة إلى سجلات. يبقى متوقفًا حتى تُعدّه، وافتراضيًا ينتظر كل سجل مراجعتك.',
            steps: [
                'افتح المعاملات ثم AutoTrack واتبع خطوات الإعداد الثلاث.',
                'على أندرويد يمكنك السماح لـ Zaylo باستقبال التنبيهات من مُرسلي البنوك الذين تختارهم. على آيفون تشارك التنبيهات أو تحوّلها عبر الاختصار. وعلى أي جهاز يمكنك لصق التنبيه.',
                'افتح "بحاجة إلى مراجعة" لتأكيد كل سجل أو تعديله أو تجاهله.',
                'من إعدادات AutoTrack يمكنك التحويل إلى الإضافة التلقائية للتنبيهات المعروفة، وحذف كل ما استورده AutoTrack.',
            ],
            notes: [
                'رموز الأمان (OTP) لا تُقرأ ولا تُحفظ ولا تُرسل إلى أي مكان.',
                'السجل المعلَّم "معلّق" مصدره تنبيه يقول إن الدفعة لم تكتمل بعد. لا يُحتسب مكتملًا حتى تؤكده.',
                'تُقرأ التنبيهات على جهازك. قراءة الذكاء الاصطناعي الاختيارية للصيغ غير المألوفة مفتاح منفصل ومتوقف افتراضيًا.',
            ],
        },
    },
    {
        id: 'bills', topic: 'planning', page: 'bills',
        keywords: 'bill commitment recurring reminder due rent subscription فاتورة التزام متكرر تذكير إيجار اشتراك',
        en: {
            title: 'Organize recurring bills',
            summary: 'Add each bill once with its due day. Zaylo reminds you and shows what is still unpaid this month.',
            steps: [
                'Open Planning, then Bills & Commitments.',
                'Add a bill with its name, amount, currency and the day of the month it is due.',
                'When you pay it, mark it as paid for this month.',
                'Turn on notifications in Settings to be reminded the day before and on the due day.',
            ],
            notes: ['Zaylo does not pay bills or move money. Marking a bill as paid only updates your records.'],
        },
        ar: {
            title: 'تنظيم الفواتير المتكررة',
            summary: 'أضف كل فاتورة مرة واحدة مع يوم استحقاقها. يذكّرك Zaylo ويعرض ما لم يُدفع هذا الشهر.',
            steps: [
                'افتح التخطيط ثم الفواتير والالتزامات.',
                'أضف فاتورة باسمها ومبلغها وعملتها ويوم استحقاقها من الشهر.',
                'عند دفعها، علّمها كمدفوعة لهذا الشهر.',
                'فعّل الإشعارات من الإعدادات ليصلك تذكير قبل الاستحقاق بيوم وفي يومه.',
            ],
            notes: ['Zaylo لا يدفع الفواتير ولا ينقل الأموال. تعليم الفاتورة كمدفوعة يحدّث سجلاتك فقط.'],
        },
    },
    {
        id: 'savings-goal', topic: 'planning', page: 'savings',
        keywords: 'savings goal target save progress ادخار هدف توفير',
        en: {
            title: 'Create a savings goal',
            summary: 'Set a target, then record what you put aside. Zaylo shows how far along you are.',
            steps: [
                'Open Planning, then Savings.',
                'Create a goal with a name and a target amount.',
                'Each time you set money aside, add that amount to the goal.',
            ],
            notes: ['A goal is a record of money you keep elsewhere. Zaylo does not hold your money and does not pay interest or returns.'],
        },
        ar: {
            title: 'إنشاء هدف ادخار',
            summary: 'حدد هدفًا ثم سجّل ما تدّخره. يعرض Zaylo مدى تقدمك.',
            steps: [
                'افتح التخطيط ثم الادخار.',
                'أنشئ هدفًا باسم ومبلغ مستهدف.',
                'كلما ادّخرت مبلغًا، أضفه إلى الهدف.',
            ],
            notes: ['الهدف سجلّ لمال تحتفظ به في مكان آخر. Zaylo لا يحتفظ بأموالك ولا يدفع فوائد أو عوائد.'],
        },
    },
    {
        id: 'smart-cart', topic: 'planning', page: 'smart-cart',
        keywords: 'smart cart shopping estimate price tag scan vat tax total عربة تسوق تقدير سعر ضريبة',
        en: {
            title: 'Smart Cart: estimate a shop before you pay',
            summary: 'Scan price tags as you shop and see a running estimate. The total is an estimate until you pay.',
            steps: [
                'Open Planning, then Smart Cart.',
                'Scan a price tag, or add an item by hand. Check the name, price and quantity.',
                'Choose how VAT applies: already included in prices, or added on top.',
                'When you have paid, confirm the cart to save it as one expense, and correct the total if the receipt differs.',
            ],
            notes: [
                'The estimate uses the prices you scanned or typed. Offers, loyalty discounts, weighed items and fees at the till can change the final amount.',
                'Scanning uses Zaylo AI, which you must allow first. Adding items by hand does not.',
            ],
        },
        ar: {
            title: 'Smart Cart: قدّر مشترياتك قبل الدفع',
            summary: 'امسح بطاقات الأسعار أثناء التسوق وشاهد تقديرًا متجددًا. الإجمالي تقدير حتى تدفع.',
            steps: [
                'افتح التخطيط ثم Smart Cart.',
                'امسح بطاقة سعر أو أضف منتجًا يدويًا. راجع الاسم والسعر والكمية.',
                'اختر طريقة احتساب الضريبة: مشمولة في الأسعار أو مضافة عليها.',
                'بعد الدفع، أكّد العربة لحفظها كمصروف واحد، وصحّح الإجمالي إن اختلف الإيصال.',
            ],
            notes: [
                'يعتمد التقدير على الأسعار التي مسحتها أو كتبتها. العروض وخصومات الولاء والمنتجات الموزونة والرسوم عند الدفع قد تغيّر المبلغ النهائي.',
                'المسح يستخدم Zaylo AI ويجب أن تسمح به أولًا. إضافة المنتجات يدويًا لا تستخدمه.',
            ],
        },
    },
    {
        id: 'workspaces', topic: 'workspaces', page: 'workspaces',
        keywords: 'workspace shared family invite member role viewer admin leave remove مساحة عمل مشتركة دعوة عضو صلاحية',
        en: {
            title: 'Share a workspace with family or a team',
            summary: 'A workspace is a separate set of records. Your personal workspace is private; a shared one is visible to its members.',
            steps: [
                'Open Workspaces and create a shared workspace.',
                'Add people by their Zaylo ID, email or an invite link. They must accept before they can see anything.',
                'Choose a role for each person: admins manage members, members add records, viewers only look.',
                'To stop sharing, remove the person or leave the workspace.',
            ],
            notes: ['Members of a shared workspace see its records and its chat. They never see your personal workspace.'],
        },
        ar: {
            title: 'مشاركة مساحة عمل مع العائلة أو الفريق',
            summary: 'مساحة العمل مجموعة سجلات مستقلة. مساحتك الشخصية خاصة، والمشتركة يراها أعضاؤها.',
            steps: [
                'افتح مساحات العمل وأنشئ مساحة مشتركة.',
                'أضف الأشخاص بمعرّف Zaylo أو البريد الإلكتروني أو رابط دعوة. يجب أن يقبلوا قبل أن يروا أي شيء.',
                'اختر دورًا لكل شخص: المشرفون يديرون الأعضاء، الأعضاء يضيفون السجلات، والمشاهدون يطّلعون فقط.',
                'لإيقاف المشاركة، أزل الشخص أو غادر المساحة.',
            ],
            notes: ['أعضاء المساحة المشتركة يرون سجلاتها ومحادثتها. لا يرون مساحتك الشخصية أبدًا.'],
        },
    },
    {
        id: 'sync-offline', topic: 'start',
        keywords: 'sync offline not syncing failed internet missing data device مزامنة بدون اتصال فشل بيانات جهاز',
        en: {
            title: 'Syncing and working offline',
            summary: 'Zaylo keeps a copy on your device, so you can add records without a connection. They upload when you are back online.',
            steps: [
                'Look at the dot beside your workspace name: Synced, Syncing, Offline or Sync failed.',
                'If it says Offline, keep working. Your changes are queued on this device.',
                'If it says Sync failed, check your connection, then reopen the app. Changes that were queued are sent again.',
                'If a record is on one device but not another after both show Synced, contact support and tell us which record.',
            ],
            notes: ['Do not remove the app\'s data from a device that shows Offline or Sync failed: changes that have not uploaded yet would be lost.'],
        },
        ar: {
            title: 'المزامنة والعمل بدون اتصال',
            summary: 'يحتفظ Zaylo بنسخة على جهازك لتضيف السجلات بدون اتصال. تُرفع عند عودة الاتصال.',
            steps: [
                'انظر إلى النقطة بجوار اسم مساحة العمل: تمت المزامنة، جارٍ المزامنة، غير متصل، أو فشلت المزامنة.',
                'إن ظهر "غير متصل" فواصل العمل. تغييراتك محفوظة في قائمة انتظار على هذا الجهاز.',
                'إن ظهر "فشلت المزامنة" فتحقق من اتصالك ثم أعد فتح التطبيق. تُرسل التغييرات المنتظرة مجددًا.',
                'إن وُجد سجل على جهاز دون آخر بعد اكتمال المزامنة على الاثنين، تواصل مع الدعم وأخبرنا أي سجل.',
            ],
            notes: ['لا تحذف بيانات التطبيق من جهاز يعرض "غير متصل" أو "فشلت المزامنة": ستفقد التغييرات التي لم تُرفع بعد.'],
        },
    },
    {
        id: 'app-lock', topic: 'account', page: 'settings',
        keywords: 'pin lock biometric face id fingerprint auto lock security قفل رمز بصمة وجه أمان',
        en: {
            title: 'Lock the app with a PIN, Face ID or fingerprint',
            summary: 'The app lock keeps your records private from anyone who picks up your unlocked device.',
            steps: [
                'Open your account menu, then Settings, then Security & Privacy.',
                'Set a 4-digit PIN. On a phone you can also turn on Face ID or fingerprint.',
                'Choose how long the app waits before it locks.',
            ],
            notes: ['The app lock protects this device only. It is separate from your account password or sign-in method.'],
        },
        ar: {
            title: 'قفل التطبيق برمز PIN أو بصمة الوجه أو الإصبع',
            summary: 'قفل التطبيق يحفظ خصوصية سجلاتك ممن يمسك جهازك وهو مفتوح.',
            steps: [
                'افتح قائمة حسابك ثم الإعدادات ثم الأمان والخصوصية.',
                'عيّن رمز PIN من 4 أرقام. على الهاتف يمكنك أيضًا تفعيل بصمة الوجه أو الإصبع.',
                'اختر المدة قبل أن يُقفل التطبيق.',
            ],
            notes: ['قفل التطبيق يحمي هذا الجهاز فقط. وهو منفصل عن كلمة مرور حسابك أو طريقة تسجيل دخولك.'],
        },
    },
    {
        id: 'export-backup', topic: 'privacy', page: 'settings',
        keywords: 'export download csv pdf excel backup copy my data تصدير تنزيل نسخة احتياطية بياناتي',
        en: {
            title: 'Export or back up your data',
            summary: 'You can take a copy of your records at any time.',
            steps: [
                'Open your account menu, then Settings, then Export Data.',
                'Choose Create a report, pick what to include, and download it as an Excel workbook or a PDF.',
                'Cloud Backup in Settings can also save a monthly copy to your own cloud storage. If it shows "Not available yet", use the report instead.',
            ],
        },
        ar: {
            title: 'تصدير بياناتك أو نسخها احتياطيًا',
            summary: 'يمكنك أخذ نسخة من سجلاتك في أي وقت.',
            steps: [
                'افتح قائمة حسابك ثم الإعدادات ثم تصدير البيانات.',
                'اختر إنشاء تقرير، وحدد ما يتضمنه، ونزّله كملف Excel أو PDF.',
                'النسخ الاحتياطي السحابي في الإعدادات يحفظ أيضًا نسخة شهرية في تخزينك السحابي. إن ظهر "غير متاح بعد" فاستخدم التقرير.',
            ],
        },
    },
    {
        id: 'ai-privacy', topic: 'privacy', page: 'settings',
        keywords: 'ai privacy data sent gemini google consent turn off withdraw assistant الذكاء الاصطناعي خصوصية موافقة إيقاف',
        en: {
            title: 'What Zaylo AI sees, and how to turn it off',
            summary: 'AI features are optional. Nothing is sent to the AI provider until you allow it, and you can withdraw that at any time.',
            steps: [
                'The first time you use an AI feature, Zaylo shows what would be sent and to whom, and asks you to allow it.',
                'To review or change your choice, open your account menu, then Settings, then AI and data.',
                'Turn AI off there to stop all AI processing for your account. Your records are not affected.',
            ],
            notes: [
                'AI answers can be wrong. Check amounts against your own records before you rely on them.',
                'Zaylo AI is not a financial, tax or legal adviser, and it cannot move money or change your records.',
                'Never type passwords, card numbers or security codes into the assistant.',
            ],
        },
        ar: {
            title: 'ما الذي يراه Zaylo AI وكيف توقفه',
            summary: 'ميزات الذكاء الاصطناعي اختيارية. لا يُرسل شيء إلى مزوّد الذكاء الاصطناعي حتى تسمح، ويمكنك سحب السماح في أي وقت.',
            steps: [
                'عند أول استخدام لميزة ذكاء اصطناعي، يعرض Zaylo ما سيُرسل وإلى من، ويطلب سماحك.',
                'لمراجعة اختيارك أو تغييره، افتح قائمة حسابك ثم الإعدادات ثم الذكاء الاصطناعي والبيانات.',
                'أوقف الذكاء الاصطناعي من هناك لإيقاف كل المعالجة لحسابك. لا تتأثر سجلاتك.',
            ],
            notes: [
                'إجابات الذكاء الاصطناعي قد تكون خاطئة. راجع المبالغ مع سجلاتك قبل الاعتماد عليها.',
                'Zaylo AI ليس مستشارًا ماليًا أو ضريبيًا أو قانونيًا، ولا يستطيع نقل الأموال أو تغيير سجلاتك.',
                'لا تكتب كلمات المرور أو أرقام البطاقات أو رموز الأمان في المساعد أبدًا.',
            ],
        },
    },
    {
        id: 'delete-account', topic: 'privacy', page: 'settings',
        keywords: 'delete account close remove erase data حذف الحساب إغلاق مسح البيانات',
        en: {
            title: 'Delete your account',
            summary: 'You can delete your account yourself. It is permanent.',
            steps: [
                'Open your account menu, then Settings, then Security & Privacy.',
                'Choose Delete account. Zaylo lists what will be deleted and what happens to shared workspaces you own.',
                'Type your email address to confirm.',
            ],
            notes: [
                'Export your data first if you want to keep a copy: a deleted account cannot be restored.',
                '"Remove data from this device" is different: it only clears the copy on the device and keeps your account.',
            ],
        },
        ar: {
            title: 'حذف حسابك',
            summary: 'يمكنك حذف حسابك بنفسك. الحذف نهائي.',
            steps: [
                'افتح قائمة حسابك ثم الإعدادات ثم الأمان والخصوصية.',
                'اختر حذف الحساب. يعرض Zaylo ما سيُحذف وما يحدث للمساحات المشتركة التي تملكها.',
                'اكتب بريدك الإلكتروني للتأكيد.',
            ],
            notes: [
                'صدّر بياناتك أولًا إن أردت الاحتفاظ بنسخة: الحساب المحذوف لا يمكن استرجاعه.',
                '"إزالة البيانات من هذا الجهاز" أمر مختلف: يمسح النسخة على الجهاز فقط ويُبقي حسابك.',
            ],
        },
    },
];

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[ً-ْ̀-ͯ]/g, '');

/** Simple on-device search: every word of the query must appear in the title, summary, steps or keywords. */
export function searchArticles(query: string, lang: 'en' | 'ar'): Article[] {
    const words = norm(query).split(/\s+/).filter(w => w.length > 1);
    if (!words.length) return [];
    const scored = ARTICLES.map(a => {
        const l = a[lang];
        const title = norm(`${a.en.title} ${a.ar.title}`);
        const rest = norm(`${a.keywords} ${l.summary} ${l.steps.join(' ')} ${(l.notes || []).join(' ')} ${a.en.summary}`);
        let score = 0;
        for (const w of words) { if (title.includes(w)) score += 3; else if (rest.includes(w)) score += 1; else return { a, score: 0 }; }
        return { a, score };
    }).filter(x => x.score > 0).sort((x, y) => y.score - x.score);
    return scored.map(x => x.a);
}

/** Articles related to a piece of text (used under AI answers). Looser than search: any two keyword hits. */
export function relatedArticles(text: string, limit = 2): Article[] {
    const t = norm(text);
    return ARTICLES.map(a => ({ a, hits: a.keywords.split(' ').filter(k => k.length > 3 && t.includes(norm(k))).length }))
        .filter(x => x.hits >= 2).sort((x, y) => y.hits - x.hits).slice(0, limit).map(x => x.a);
}
