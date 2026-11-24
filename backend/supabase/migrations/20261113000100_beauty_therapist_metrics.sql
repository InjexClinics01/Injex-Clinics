-- =============================================================================
-- Migration: Beauty Therapist performance metrics
--
-- Seeded from the Beauty Therapist performance spreadsheet ("Performance Metrics - Alana").
-- Configures input metrics (Hours, Revenue, Rebooking %, Tickets, Retail/Units)
-- and calculated ratios (Hourly Revenue, Revenue Per Ticket, Retail Per Hour).
--
-- Idempotent: safe to re-run.
-- =============================================================================

insert into public.metric_definitions
  (category, key, name, kind, data_type, unit, aggregation, is_required, min_value, max_value,
   default_target, counts_as_unit, is_goal_eligible, is_scoring_eligible, sort_order)
values
  ('beauty_therapist', 'hours_worked',   'Hours Worked',      'input', 'decimal',    'h',       'sum',     true,  0, 24,   null, false, false, false, 10),
  ('beauty_therapist', 'revenue',        'Revenue',           'input', 'currency',   '$',       'sum',     true,  0, null, null, false, true,  true,  20),
  ('beauty_therapist', 'rebooking_pct',  'Rebooking %',       'input', 'percentage', '%',       'average', true,  0, 100,  null, false, true,  true,  30),
  ('beauty_therapist', 'tickets',        'Number of Tickets', 'input', 'integer',    'tickets', 'sum',     true,  0, null, null, false, true,  true,  40),
  ('beauty_therapist', 'retail_units',   'Retail / Units',    'input', 'decimal',    'units',   'sum',     false, 0, null, null, false, true,  true,  50)
on conflict (category, key) do update set
  name = excluded.name,
  data_type = excluded.data_type,
  unit = excluded.unit,
  aggregation = excluded.aggregation,
  is_required = excluded.is_required,
  min_value = excluded.min_value,
  max_value = excluded.max_value,
  default_target = excluded.default_target,
  is_goal_eligible = excluded.is_goal_eligible,
  is_scoring_eligible = excluded.is_scoring_eligible,
  sort_order = excluded.sort_order;

insert into public.metric_definitions
  (category, key, name, description, kind, data_type, unit, numerator_metric_id, numerator_is_unit_total,
   denominator_metric_id, default_target, is_goal_eligible, is_scoring_eligible, sort_order)
select 'beauty_therapist', v.key, v.name, v.description, 'calculated', v.data_type::public.metric_data_type, v.unit,
       (select id from public.metric_definitions where category = 'beauty_therapist' and key = v.numerator),
       false,
       (select id from public.metric_definitions where category = 'beauty_therapist' and key = v.denominator),
       v.default_target,
       true, true, v.sort_order
from (values
  ('hourly_revenue',     'Hourly Revenue',     'Revenue ÷ Hours Worked',               'currency', '$/h',      'revenue',      'hours_worked', null::numeric, 60),
  ('revenue_per_ticket', 'Revenue Per Ticket', 'Revenue ÷ Number of Tickets',          'currency', '$/ticket', 'revenue',      'tickets',      80::numeric,   70),
  ('retail_per_hour',    'Retail Per Hour',    'Retail / Units Sold ÷ Hours Worked',   'decimal',  'units/h',  'retail_units', 'hours_worked', 0.5::numeric,  80)
) as v(key, name, description, data_type, unit, numerator, denominator, default_target, sort_order)
on conflict (category, key) do update set
  name = excluded.name,
  description = excluded.description,
  data_type = excluded.data_type,
  unit = excluded.unit,
  numerator_metric_id = excluded.numerator_metric_id,
  numerator_is_unit_total = excluded.numerator_is_unit_total,
  denominator_metric_id = excluded.denominator_metric_id,
  default_target = excluded.default_target,
  is_goal_eligible = excluded.is_goal_eligible,
  is_scoring_eligible = excluded.is_scoring_eligible,
  sort_order = excluded.sort_order;
