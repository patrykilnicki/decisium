-- Seed daily entries, daily/weekly/monthly summaries for a fake UI designer job.
-- Data is inserted for the first user in public.users (by created_at).

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM public.users
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No users found. Skipping UI designer seed.';
    RETURN;
  END IF;

  -- Daily events: Jan 6 – Jan 17, 2025 (UI designer workflow)
  -- Use explicit created_at to satisfy (user_id, date, created_at) unique constraint.

  INSERT INTO public.daily_events (user_id, date, role, type, content, created_at) VALUES
    (v_user_id, '2025-01-06', 'user', 'note', 'Kicked off redesign of onboarding flow. Mapped current user journey with PM and identified drop-off at step 3.', '2025-01-06 09:00:00+00'),
    (v_user_id, '2025-01-06', 'user', 'question', 'Should we use a tabbed stepper or single-scroll layout for the multi-step onboarding form?', '2025-01-06 12:30:00+00'),
    (v_user_id, '2025-01-06', 'agent', 'answer', 'Tabbed steppers typically improve completion when steps have distinct context. Single-scroll works better if steps are short and users prefer to skim. Given your drop-off at step 3, a stepper with a visible progress indicator is likely to help.', '2025-01-06 12:35:00+00'),
    (v_user_id, '2025-01-07', 'user', 'note', 'Refined onboarding wireframes. Added progress indicator and reduced copy on step 3. Shared with dev for feasibility.', '2025-01-07 10:00:00+00'),
    (v_user_id, '2025-01-07', 'user', 'note+question', 'Stakeholder wants more illustrations in the app. Budget is tight. Best way to add personality without commissioning custom illustrations?', '2025-01-07 14:00:00+00'),
    (v_user_id, '2025-01-07', 'agent', 'answer', 'Consider: (1) curated royalty-free sets (e.g. unDraw, Humaaans) with a consistent style, (2) subtle use of abstract shapes or gradients for empty states, (3) small animated micro-interactions instead of static art. Align style with your design system and use sparingly.', '2025-01-07 14:05:00+00'),
    (v_user_id, '2025-01-08', 'user', 'note', 'Design review for new dashboard layout. Feedback: simplify nav, add global search. Updated Figma and created tickets.', '2025-01-08 09:30:00+00'),
    (v_user_id, '2025-01-08', 'user', 'question', 'How do we balance “simplify nav” with “add global search” when both affect the header?', '2025-01-08 11:00:00+00'),
    (v_user_id, '2025-01-08', 'agent', 'answer', 'Treat search as primary nav: a single search affordance (icon + shortcut) can replace several nav items if discovery is search-first. Keep 3–5 top-level nav items and move the rest into search, settings, or secondary menus. Test with users to confirm they find key flows.', '2025-01-08 11:05:00+00'),
    (v_user_id, '2025-01-09', 'user', 'note', 'Worked on design system: button variants, spacing scale. Documented in Storybook. Synced with frontend lead.', '2025-01-09 10:00:00+00'),
    (v_user_id, '2025-01-09', 'user', 'note', 'Ran quick accessibility pass on onboarding. Fixed focus order and contrast on CTA buttons.', '2025-01-09 15:00:00+00'),
    (v_user_id, '2025-01-10', 'user', 'note', 'Usability test for onboarding flow. 5 participants. Step 3 still confused 2 users; considering splitting into two smaller steps.', '2025-01-10 09:00:00+00'),
    (v_user_id, '2025-01-10', 'user', 'question', 'Is it better to split a long step into two short steps or keep one step but add more inline help?', '2025-01-10 13:00:00+00'),
    (v_user_id, '2025-01-10', 'agent', 'answer', 'Split when the tasks are logically separate and users can tick off progress. Inline help when the step is one conceptual task but unfamiliar. For onboarding, smaller steps often reduce perceived effort and increase completion; use inline help for edge cases rather than core flow.', '2025-01-10 13:05:00+00'),
    (v_user_id, '2025-01-13', 'user', 'note', 'Implemented split for step 3. Updated prototypes and shared with PM. Planning design-dev handoff for next sprint.', '2025-01-13 10:00:00+00'),
    (v_user_id, '2025-01-13', 'user', 'note', 'Explored illustration style (line + flat color) for empty states. Picked 3 candidates from unDraw to test with stakeholders.', '2025-01-13 14:00:00+00'),
    (v_user_id, '2025-01-14', 'user', 'note', 'Dashboard header redesign: global search bar, reduced nav to 4 items. First round of feedback mostly positive.', '2025-01-14 09:30:00+00'),
    (v_user_id, '2025-01-14', 'user', 'question', 'Stakeholders keep asking for “more modern” but can’t specify what. How to push back and get actionable feedback?', '2025-01-14 11:30:00+00'),
    (v_user_id, '2025-01-14', 'agent', 'answer', 'Ask for references: “Which apps or sites feel modern to you?” Then extract concrete traits (e.g. rounded corners, more whitespace, subtle motion). Run a short mood-board exercise or A/B test specific treatments. Document decisions so “modern” maps to clear patterns you can reuse.', '2025-01-14 11:35:00+00'),
    (v_user_id, '2025-01-15', 'user', 'note', 'Finalised empty-state illustrations. Updated Figma library. Handoff doc ready for dev.', '2025-01-15 10:00:00+00'),
    (v_user_id, '2025-01-15', 'user', 'note', 'Design system review: agreed on motion tokens (duration, easing) for consistency across the product.', '2025-01-15 15:00:00+00'),
    (v_user_id, '2025-01-16', 'user', 'note', 'Support for new onboarding flow built in dev. Did UX review; a few alignment tweaks logged. Overall looks good.', '2025-01-16 09:00:00+00'),
    (v_user_id, '2025-01-16', 'user', 'note+question', 'PM wants to ship onboarding ASAP. I’d like one more round of usability testing. How to make the case without blocking launch?', '2025-01-16 14:00:00+00'),
    (v_user_id, '2025-01-16', 'agent', 'answer', 'Propose a lightweight “smoke test”: 3–5 users, 30 min each, focus only on critical path. Run it in parallel with bug-fixing. Share findings as “pre-launch checklist” rather than a gate. If you find a showstopper, you have evidence; if not, you build trust and ship with slightly more confidence.', '2025-01-16 14:05:00+00'),
    (v_user_id, '2025-01-17', 'user', 'note', 'Scheduled quick usability smoke test for next week. Prepared script and tasks. Onboarding handoff complete.', '2025-01-17 10:00:00+00');

  -- Daily summaries (facts: 2–4, insight, optional suggestion)
  INSERT INTO public.daily_summaries (user_id, date, content) VALUES
    (v_user_id, '2025-01-06', '{"facts": ["Started onboarding flow redesign", "Aligned with PM on user journey and drop-off at step 3", "Evaluated stepper vs single-scroll for multi-step form"], "insight": "Step 3 is a critical drop-off point; a clear progress indicator and stepper could help completion.", "suggestion": "Validate stepper with a quick prototype before full build."}'::jsonb),
    (v_user_id, '2025-01-07', '{"facts": ["Refined onboarding wireframes and added progress indicator", "Reduced copy on step 3 and synced with dev", "Explored illustration options under tight budget"], "insight": "Stakeholder desire for ‘more personality’ can be addressed with curated assets and consistent style.", "suggestion": "Lock illustration style and set first by end of week."}'::jsonb),
    (v_user_id, '2025-01-08', '{"facts": ["Design review for dashboard layout", "Feedback: simplify nav and add global search", "Created Figma updates and tickets"], "insight": "Simplifying nav and adding search can work together if search becomes a primary way to access features.", "suggestion": "Prototype header with search-first nav and validate with one round of feedback."}'::jsonb),
    (v_user_id, '2025-01-09', '{"facts": ["Design system work: button variants and spacing scale", "Documented components in Storybook", "Accessibility pass on onboarding: focus order and contrast fixes"], "insight": "Design system and a11y improvements compound across the product; small fixes now reduce rework later.", "suggestion": "Add a11y checklist to design handoff process."}'::jsonb),
    (v_user_id, '2025-01-10', '{"facts": ["Ran usability test for onboarding with 5 participants", "Step 3 still confused 2 users", "Considering splitting step 3 into two smaller steps"], "insight": "Splitting a complex step often reduces perceived effort and improves completion more than inline help alone.", "suggestion": "Implement split, then run a quick follow-up test before dev handoff."}'::jsonb),
    (v_user_id, '2025-01-13', '{"facts": ["Implemented split for step 3 and updated prototypes", "Shared updates with PM", "Explored illustration style and shortlisted 3 options from unDraw"], "insight": "Breaking down step 3 and clarifying illustration direction both reduce ambiguity for dev and stakeholders.", "suggestion": "Finalise illustration set and prepare handoff doc."}'::jsonb),
    (v_user_id, '2025-01-14', '{"facts": ["Dashboard header redesign with global search and reduced nav", "First feedback round mostly positive", "Reflected on how to get actionable feedback when stakeholders say ‘more modern’"], "insight": "Asking for references and extracting concrete traits turns vague feedback into repeatable design decisions.", "suggestion": "Run a short mood-board or A/B test for ‘modern’ treatments."}'::jsonb),
    (v_user_id, '2025-01-15', '{"facts": ["Finalised empty-state illustrations and updated Figma library", "Handoff doc prepared for dev", "Design system: agreed motion tokens for duration and easing"], "insight": "Consistent motion tokens will make interactions feel cohesive as the product grows.", "suggestion": "Document motion usage in Storybook."}'::jsonb),
    (v_user_id, '2025-01-16', '{"facts": ["UX review of built onboarding flow", "Noted minor alignment tweaks", "Discussed timing of one more usability round vs launch"], "insight": "A lightweight smoke test can reduce risk without blocking ship, and builds confidence with PM.", "suggestion": "Schedule 3–5 user smoke test and run in parallel with bug-fixing."}'::jsonb),
    (v_user_id, '2025-01-17', '{"facts": ["Scheduled usability smoke test for next week", "Prepared script and tasks", "Completed onboarding handoff"], "insight": "Closing the loop with a smoke test and clear handoff keeps quality high while supporting ship velocity.", "suggestion": "Run smoke test and share pre-launch checklist with team."}'::jsonb);

  -- Weekly summaries (week_start = Monday). Jan 6–12 and Jan 13–19.
  INSERT INTO public.weekly_summaries (user_id, week_start, content) VALUES
    (v_user_id, '2025-01-06', '{"patterns": ["Focus on onboarding redesign and step 3 drop-off", "Regular sync with PM and dev", "Exploring stepper vs single-scroll and illustration options"], "themes": ["Onboarding optimisation", "Design system and consistency", "Stakeholder alignment"], "insights": ["Step 3 is the main friction point; splitting and progress feedback are promising.", "Illustration and ‘personality’ can be achieved with curated assets and a clear style.", "Nav simplification and global search can coexist with a search-first approach."]}'::jsonb),
    (v_user_id, '2025-01-13', '{"patterns": ["Implementing step 3 split and moving to handoff", "Dashboard header iteration and design system motion", "Planning usability smoke test before launch"], "themes": ["Ship readiness", "Design system maturity", "Evidence-based decisions"], "insights": ["Lightweight smoke tests reduce risk without blocking launch.", "Motion tokens and illustration consistency support scalability.", "Actionable feedback comes from references and concrete traits, not vague ‘modern’ requests."]}'::jsonb);

  -- Monthly summary (January 2025)
  INSERT INTO public.monthly_summaries (user_id, month_start, content) VALUES
    (v_user_id, '2025-01-01', '{"trends": ["Product focus on activation and onboarding", "Design system adoption and documentation", "More structured feedback loops with PM and dev"], "strategic_insights": ["Onboarding is a key lever for activation; step 3 is the main bottleneck.", "Investing in design system and a11y pays off across the product.", "Smoke tests and clear handoffs support both quality and ship velocity."], "reflections": ["Strong collaboration with PM on user journey and prioritisation.", "Would benefit from more frequent user research; smoke tests are a good step.", "Illustration and motion strategy now clearer; ready to scale."]}'::jsonb);

  RAISE NOTICE 'Seeded UI designer data for user %', v_user_id;
END $$;
