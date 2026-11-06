-- ============================================================================
-- TEST DATA: one full year of realistic Cairo spending for ONE account.
-- Account: mohamed@unifiedhive.com → its Personal workspace (EGP).
-- Period: 6 Nov 2025 → today.  Same numbers every run (fixed random seed).
--
-- Every row is marked so it can be removed with seed_full_year_test_data_REMOVE.sql:
--   expenses: tag 'test-seed' and notes 'Seeded test data'
--   incomes, bills, savings goals: created_at = 2001-01-01 00:00:07.777+00 (hidden marker)
-- Running it again first removes the previous seed, so it never doubles up.
-- ============================================================================
DO $$
DECLARE
    v_email   TEXT := 'mohamed@unifiedhive.com';
    v_marker  TIMESTAMPTZ := '2001-01-01 00:00:07.777+00';
    v_user    UUID;
    v_ws      UUID;
    v_cur     TEXT;
    d         DATE;
    v_start   DATE := DATE '2025-11-06';
    v_end     DATE := (now() AT TIME ZONE 'Africa/Cairo')::date;
    m         DATE;
    v_ramadan BOOLEAN;
    v_summer  BOOLEAN;
    n         INT;
    i         INT;
    v_count   INT;
    pick      TEXT[];
BEGIN
    PERFORM setseed(0.4242);

    SELECT u.id INTO v_user FROM public.users u JOIN auth.users a ON a.id = u.auth_id WHERE lower(a.email) = v_email;
    IF v_user IS NULL THEN RAISE EXCEPTION 'No Zaylo account found for %. Sign in to Zaylo with it once, then run this again.', v_email; END IF;

    SELECT w.id, w.currency INTO v_ws, v_cur FROM public.workspaces w
     WHERE w.owner_id = v_user AND w.type = 'personal' AND NOT coalesce(w.is_archived, false)
     ORDER BY w.created_at LIMIT 1;
    IF v_ws IS NULL THEN RAISE EXCEPTION 'That account has no Personal workspace yet. Open Zaylo with it once, then run this again.'; END IF;
    IF v_cur <> 'EGP' THEN RAISE NOTICE 'Note: this workspace''s currency is %, the test data is in EGP.', v_cur; END IF;

    -- Start clean (removes only an earlier seed)
    DELETE FROM public.expenses WHERE workspace_id = v_ws AND 'test-seed' = ANY (tags);
    DELETE FROM public.incomes WHERE workspace_id = v_ws AND created_at = v_marker;
    DELETE FROM public.monthly_bills WHERE workspace_id = v_ws AND created_at = v_marker;
    DELETE FROM public.savings_goals WHERE workspace_id = v_ws AND created_at = v_marker;

    CREATE TEMP TABLE seed_exp (merchant TEXT, description TEXT, category TEXT, payment_method TEXT, amount NUMERIC, at TIMESTAMPTZ, source TEXT) ON COMMIT DROP;

    -- ---------------------------------------------------------------- monthly: salary, bills, savings transfer
    m := date_trunc('month', v_start)::date;
    WHILE m <= v_end LOOP
        v_summer := extract(month FROM m) IN (6, 7, 8);
        -- salary on the 25th (raise from April 2026)
        IF (m + 24) BETWEEN v_start AND v_end THEN
            INSERT INTO public.incomes (workspace_id, created_by, name, amount, currency, type, income_date, created_at)
            VALUES (v_ws, v_user, 'Salary', CASE WHEN m >= DATE '2026-04-01' THEN 74000 ELSE 68000 END, 'EGP', 'fixed', (m + 24) + time '09:00', v_marker);
        END IF;
        -- bills paid each month
        FOR pick IN SELECT ARRAY[n_, c_, p_, a_::text, d_::text] FROM (VALUES
            ('Rent', 'other', 'bank_transfer', 12500, 1),
            ('Gym membership', 'healthcare', 'card', 1200, 3),
            ('WE home internet', 'utilities', 'card', 750, 5),
            ('Electricity bill', 'utilities', 'wallet', CASE WHEN v_summer THEN 1850 ELSE 920 END, 10),
            ('Vodafone mobile', 'utilities', 'wallet', 450, 12),
            ('Netflix', 'entertainment', 'card', 280, 15),
            ('Car instalment', 'transport', 'bank_transfer', 6800, 20)
        ) AS b(n_, c_, p_, a_, d_) LOOP
            IF (m + pick[5]::int - 1) BETWEEN v_start AND v_end THEN
                INSERT INTO seed_exp VALUES (pick[1], 'Monthly bill', pick[2], pick[3],
                    round(pick[4]::numeric * CASE WHEN pick[1] = 'Electricity bill' THEN 0.85 + random()::numeric * 0.3 ELSE 1 END, 2),
                    (m + pick[5]::int - 1) + time '10:00' + (random() * interval '8 hours'), 'bill');
            END IF;
        END LOOP;
        IF (m + 25) BETWEEN v_start AND v_end THEN
            INSERT INTO seed_exp VALUES ('Transfer to savings', 'Monthly saving', 'savings', 'bank_transfer', 4000, (m + 25) + time '11:00', 'manual');
        END IF;
        m := (m + interval '1 month')::date;
    END LOOP;

    -- occasional income
    INSERT INTO public.incomes (workspace_id, created_by, name, amount, currency, type, income_date, created_at) VALUES
        (v_ws, v_user, 'Freelance design project', 12000, 'EGP', 'variable', '2025-12-14 15:00+02', v_marker),
        (v_ws, v_user, 'Freelance website', 18500, 'EGP', 'variable', '2026-02-09 15:00+02', v_marker),
        (v_ws, v_user, 'Annual bonus', 40000, 'EGP', 'variable', '2026-03-28 10:00+02', v_marker),
        (v_ws, v_user, 'Gam3ya payout', 60000, 'EGP', 'variable', '2026-07-05 12:00+03', v_marker),
        (v_ws, v_user, 'Freelance consulting', 9500, 'EGP', 'variable', '2026-09-17 15:00+03', v_marker),
        (v_ws, v_user, 'Sold old phone', 7000, 'EGP', 'variable', '2026-10-03 18:00+03', v_marker);

    -- ---------------------------------------------------------------- everyday spending, day by day
    d := v_start;
    WHILE d <= v_end LOOP
        v_ramadan := d BETWEEN DATE '2026-02-18' AND DATE '2026-03-19';
        -- groceries: ~3 a week, bigger in Ramadan
        IF random()::numeric < (CASE WHEN v_ramadan THEN 0.6 ELSE 0.42 END) THEN
            i := 1 + floor(random()::numeric * 6)::int; pick := ARRAY[(ARRAY[ARRAY['Carrefour','groceries'], ARRAY['Kazyon','groceries'], ARRAY['Seoudi Market','groceries'], ARRAY['Gourmet Egypt','groceries'], ARRAY['Metro Market','groceries'], ARRAY['Breadfast','groceries']])[i][1], (ARRAY[ARRAY['Carrefour','groceries'], ARRAY['Kazyon','groceries'], ARRAY['Seoudi Market','groceries'], ARRAY['Gourmet Egypt','groceries'], ARRAY['Metro Market','groceries'], ARRAY['Breadfast','groceries']])[i][2]];
            INSERT INTO seed_exp VALUES (pick[1], 'Groceries', 'groceries', (ARRAY['card','card','cash','wallet'])[1 + floor(random()::numeric * 4)::int],
                round((200 + random()::numeric * 1300) * CASE WHEN v_ramadan THEN 1.45 ELSE 1 END, 2), d + time '17:00' + random() * interval '4 hours', 'manual');
        END IF;
        -- dining / delivery: ~4 a week (iftar outings in Ramadan)
        IF random()::numeric < 0.55 THEN
            i := 1 + floor(random()::numeric * 8)::int; pick := ARRAY[(ARRAY[ARRAY['Talabat','Delivery'], ARRAY['elmenus','Delivery'], ARRAY['Zooba','Dinner'], ARRAY['Koshary Abou Tarek','Lunch'], ARRAY['Starbucks','Coffee'], ARRAY['Cilantro','Coffee'], ARRAY['Bazooka','Dinner'], ARRAY['Abou Shakra','Iftar' ]])[i][1], (ARRAY[ARRAY['Talabat','Delivery'], ARRAY['elmenus','Delivery'], ARRAY['Zooba','Dinner'], ARRAY['Koshary Abou Tarek','Lunch'], ARRAY['Starbucks','Coffee'], ARRAY['Cilantro','Coffee'], ARRAY['Bazooka','Dinner'], ARRAY['Abou Shakra','Iftar' ]])[i][2]];
            INSERT INTO seed_exp VALUES (pick[1], pick[2], 'dining', (ARRAY['card','wallet','cash'])[1 + floor(random()::numeric * 3)::int],
                round(CASE WHEN pick[2] = 'Coffee' THEN 90 + random()::numeric * 160 ELSE 180 + random()::numeric * 720 END, 2), d + time '13:00' + random() * interval '9 hours', 'manual');
        END IF;
        -- rides: ~5 a week
        IF random()::numeric < 0.7 THEN
            INSERT INTO seed_exp VALUES ((ARRAY['Uber','Careem','inDrive','Uber'])[1 + floor(random()::numeric * 4)::int], 'Ride', 'transport', (ARRAY['card','cash'])[1 + floor(random()::numeric * 2)::int],
                round(55 + random()::numeric * 290, 2), d + time '08:00' + random() * interval '13 hours', 'manual');
        END IF;
        -- fuel: ~every 12 days
        IF random()::numeric < 0.085 THEN
            INSERT INTO seed_exp VALUES ((ARRAY['Wataniya','TotalEnergies','Misr Petroleum'])[1 + floor(random()::numeric * 3)::int], 'Fuel', 'transport', 'card', round(750 + random()::numeric * 450, 2), d + time '19:00', 'manual');
        END IF;
        -- shopping: ~3 a month
        IF random()::numeric < 0.07 THEN
            i := 1 + floor(random()::numeric * 6)::int; pick := ARRAY[(ARRAY[ARRAY['Amazon.eg','Home'], ARRAY['Noon','Electronics accessory'], ARRAY['Zara','Clothes'], ARRAY['H&M','Clothes'], ARRAY['IKEA','Home'], ARRAY['Decathlon','Sports gear']])[i][1], (ARRAY[ARRAY['Amazon.eg','Home'], ARRAY['Noon','Electronics accessory'], ARRAY['Zara','Clothes'], ARRAY['H&M','Clothes'], ARRAY['IKEA','Home'], ARRAY['Decathlon','Sports gear']])[i][2]];
            INSERT INTO seed_exp VALUES (pick[1], pick[2], 'shopping', 'card', round(350 + random()::numeric * 3600, 2), d + time '18:00' + random() * interval '3 hours', 'manual');
        END IF;
        -- entertainment: ~2 a month
        IF random()::numeric < 0.065 THEN
            INSERT INTO seed_exp VALUES ((ARRAY['VOX Cinemas','PlayStation Store','Cairo Jazz Club','Bowling at Mall of Egypt'])[1 + floor(random()::numeric * 4)::int], 'Night out', 'entertainment', 'card', round(250 + random()::numeric * 1100, 2), d + time '20:00', 'manual');
        END IF;
        -- health: ~2 a month
        IF random()::numeric < 0.06 THEN
            INSERT INTO seed_exp VALUES ((ARRAY['El Ezaby Pharmacy','Seif Pharmacy','Dr. clinic visit','Al Borg Lab'])[1 + floor(random()::numeric * 4)::int], 'Health', 'healthcare', (ARRAY['cash','card'])[1 + floor(random()::numeric * 2)::int], round(120 + random()::numeric * 1300, 2), d + time '12:00', 'manual');
        END IF;
        d := d + 1;
    END LOOP;

    -- ---------------------------------------------------------------- one-off and seasonal
    INSERT INTO seed_exp VALUES
        ('Black Friday – Noon', 'New headphones', 'shopping', 'card', 6499, '2025-11-28 21:10+02', 'manual'),
        ('Ain Sokhna weekend', 'Hotel, 2 nights', 'travel', 'card', 9800, '2026-01-16 14:00+02', 'manual'),
        ('Udemy', 'React course', 'education', 'card', 449, '2026-01-22 22:00+02', 'manual'),
        ('Ramadan groceries – Carrefour', 'Monthly Ramadan stock-up', 'groceries', 'card', 6850, '2026-02-15 16:00+02', 'manual'),
        ('Ramadan charity box', 'Kartonet Ramadan', 'other', 'cash', 2500, '2026-02-20 15:00+02', 'manual'),
        ('Eid clothes – City Stars', 'Eid al-Fitr', 'shopping', 'card', 7400, '2026-03-17 19:00+02', 'manual'),
        ('Eidiya', 'Eid al-Fitr gifts for the kids', 'other', 'cash', 3000, '2026-03-20 11:00+02', 'manual'),
        ('Dahab trip – Go Bus', 'Bus tickets', 'travel', 'wallet', 1800, '2026-04-23 07:00+02', 'manual'),
        ('Dahab trip – Lodge', 'Hostel, 4 nights', 'travel', 'card', 7200, '2026-04-23 15:00+02', 'manual'),
        ('Car service – Toyota', '40,000 km service', 'transport', 'card', 5600, '2026-05-09 10:00+03', 'manual'),
        ('Eid al-Adha – butcher', 'Udhiya share', 'groceries', 'cash', 9500, '2026-05-26 09:00+03', 'manual'),
        ('Sahel – Marassi chalet', 'Summer holiday, 5 nights', 'travel', 'bank_transfer', 22000, '2026-08-08 16:00+03', 'manual'),
        ('Sahel – beach & dining', 'Summer holiday', 'dining', 'card', 4800, '2026-08-11 21:00+03', 'manual'),
        ('School supplies', 'Back to school', 'education', 'card', 3200, '2026-09-20 18:00+03', 'manual'),
        ('School fees – first term', 'Back to school', 'education', 'bank_transfer', 28000, '2026-09-25 10:00+03', 'manual'),
        ('B.TECH', 'New washing machine', 'shopping', 'card', 18999, '2026-10-12 17:00+03', 'manual');

    INSERT INTO public.expenses (workspace_id, created_by, amount, currency, merchant, description, category, payment_method, last4, tags, notes, source, purchased_at)
    SELECT v_ws, v_user, amount, 'EGP', merchant, description, category, payment_method,
           CASE WHEN payment_method = 'card' THEN '4821' END, ARRAY['test-seed'], 'Seeded test data', source, at
      FROM seed_exp WHERE at::date BETWEEN v_start AND v_end + 1 AND at <= now();
    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- ---------------------------------------------------------------- bills (recurring) and savings goals
    INSERT INTO public.monthly_bills (workspace_id, created_by, name, amount, currency, category, payment_method, due_day, last_paid_month, created_at) VALUES
        (v_ws, v_user, 'Rent', 12500, 'EGP', 'other', 'bank_transfer', 1, to_char(v_end, 'YYYY-MM'), v_marker),
        (v_ws, v_user, 'Gym membership', 1200, 'EGP', 'healthcare', 'card', 3, to_char(v_end, 'YYYY-MM'), v_marker),
        (v_ws, v_user, 'WE home internet', 750, 'EGP', 'utilities', 'card', 5, to_char(v_end, 'YYYY-MM'), v_marker),
        (v_ws, v_user, 'Electricity bill', 920, 'EGP', 'utilities', 'wallet', 10, to_char(v_end - interval '1 month', 'YYYY-MM'), v_marker),
        (v_ws, v_user, 'Vodafone mobile', 450, 'EGP', 'utilities', 'wallet', 12, to_char(v_end - interval '1 month', 'YYYY-MM'), v_marker),
        (v_ws, v_user, 'Netflix', 280, 'EGP', 'entertainment', 'card', 15, to_char(v_end - interval '1 month', 'YYYY-MM'), v_marker),
        (v_ws, v_user, 'Car instalment', 6800, 'EGP', 'transport', 'bank_transfer', 20, to_char(v_end - interval '1 month', 'YYYY-MM'), v_marker);

    INSERT INTO public.savings_goals (workspace_id, name, reason, target_amount, saved_amount, currency, color, icon, created_at) VALUES
        (v_ws, 'Emergency fund', '6 months of expenses', 150000, 62000, 'EGP', '#2563FF', '🛟', v_marker),
        (v_ws, 'Sahel 2027', 'Summer holiday', 40000, 18500, 'EGP', '#22D3EE', '🏖️', v_marker),
        (v_ws, 'New laptop', 'For freelance work', 65000, 30000, 'EGP', '#7C3AED', '💻', v_marker);

    RAISE NOTICE 'Seeded % expenses, % incomes, 7 bills and 3 savings goals into workspace %.', v_count,
        (SELECT count(*) FROM public.incomes WHERE workspace_id = v_ws AND created_at = v_marker), v_ws;
END $$;

SELECT 'test data seeded' AS result,
       (SELECT count(*) FROM public.expenses WHERE 'test-seed' = ANY (tags)) AS expenses,
       (SELECT count(*) FROM public.incomes WHERE created_at = '2001-01-01 00:00:07.777+00') AS incomes,
       (SELECT round(sum(amount)) FROM public.expenses WHERE 'test-seed' = ANY (tags)) AS total_spent_egp;
