-- Example daily summary entries for 2026-02-01, 2026-02-02, 2026-02-03
-- Uses the first user from public.users. Change (SELECT id FROM public.users LIMIT 1) to a literal UUID if you prefer.

INSERT INTO public.daily_summaries (user_id, date, content) VALUES
  (
    (SELECT id FROM public.users LIMIT 1),
    '2026-02-01',
    '{"score": 78, "score_label": "Solid", "explanation": "You made steady progress and kept focus without draining energy.", "time_allocation": {"meetings": 20, "deep_work": 65, "other": 15}, "notes_added": 3, "new_ideas": 1, "narrative_summary": "Morning was spent on design review and alignment. Afternoon focused on implementation and documentation. One new idea captured for later."}'::jsonb
  ),
  (
    (SELECT id FROM public.users LIMIT 1),
    '2026-02-02',
    '{"score": 85, "score_label": "Excellent", "explanation": "Strong momentum with clear blocks of deep work and minimal context switching.", "time_allocation": {"meetings": 10, "deep_work": 75, "other": 15}, "notes_added": 5, "new_ideas": 2, "narrative_summary": "Most of the day in focused work on the main feature. Short sync in the morning. Notes and ideas logged throughout the day."}'::jsonb
  ),
  (
    (SELECT id FROM public.users LIMIT 1),
    '2026-02-03',
    '{"score": 72, "score_label": "Solid", "explanation": "A mix of collaboration and solo work; energy held up well.", "time_allocation": {"meetings": 30, "deep_work": 50, "other": 20}, "notes_added": 2, "new_ideas": 0, "narrative_summary": "More meetings than usual—stakeholder sync and planning. Still carved out time for coding and follow-up tasks."}'::jsonb
  )
ON CONFLICT (user_id, date) DO UPDATE SET content = EXCLUDED.content;
