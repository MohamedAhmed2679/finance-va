-- Finance VA Patch V12: Add missing onboarding column
-- Run this in the Supabase SQL Editor

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS show_onboarding BOOLEAN DEFAULT TRUE;
