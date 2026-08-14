-- ============================================================
-- MIGRATION: Support text-based questions/options (not just images)
-- Run this in Supabase SQL Editor (safe to run once)
-- ============================================================

alter table questions add column if not exists text_content text;
alter table questions add column if not exists solution_text text;
alter table options add column if not exists text_content text;

-- Refresh the student-safe views to include the new text columns
create or replace view questions_for_student as
  select id, section_id, image_url, text_content, order_no, positive_marks, negative_marks
  from questions;

create or replace view options_for_student as
  select id, question_id, label, image_url, text_content, order_no
  from options;

revoke all on questions_for_student from public, anon;
revoke all on options_for_student from public, anon;
grant select on questions_for_student to authenticated;
grant select on options_for_student to authenticated;

-- Updated grading function: also returns solution_text (text fallback for solutions)
create or replace function submit_attempt(
  p_test_id uuid,
  p_answers jsonb,
  p_time_taken_ms bigint,
  p_tab_switches int default 0,
  p_fullscreen_exits int default 0
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_detail jsonb := '[]'::jsonb;
  v_total_score numeric := 0;
  v_correct int := 0;
  v_incorrect int := 0;
  v_unattempted int := 0;
  q record;
  v_chosen_id text;
  v_chosen_is_correct boolean;
  v_correct_opt_id uuid;
  v_gained numeric;
  v_outcome text;
  v_result_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  for q in
    select qu.id, qu.section_id, se.name as section_name, qu.positive_marks,
           qu.negative_marks, qu.solution_image_url, qu.solution_text
    from questions qu
    join sections se on se.id = qu.section_id
    where se.test_id = p_test_id
    order by se.order_no, qu.order_no
  loop
    v_chosen_id := p_answers->>(q.id::text);

    select id into v_correct_opt_id from options
      where question_id = q.id and is_correct = true limit 1;

    if v_chosen_id is null or v_chosen_id = '' then
      v_outcome := 'unattempted';
      v_gained := 0;
      v_unattempted := v_unattempted + 1;
    else
      select is_correct into v_chosen_is_correct from options where id = v_chosen_id::uuid;
      if coalesce(v_chosen_is_correct, false) then
        v_outcome := 'correct';
        v_gained := q.positive_marks;
        v_correct := v_correct + 1;
      else
        v_outcome := 'incorrect';
        v_gained := -q.negative_marks;
        v_incorrect := v_incorrect + 1;
      end if;
    end if;

    v_total_score := v_total_score + v_gained;

    v_detail := v_detail || jsonb_build_object(
      'question_id', q.id,
      'section_name', q.section_name,
      'chosen_option_id', v_chosen_id,
      'correct_option_id', v_correct_opt_id,
      'outcome', v_outcome,
      'gained', v_gained,
      'solution_image_url', q.solution_image_url,
      'solution_text', q.solution_text
    );
  end loop;

  insert into results (user_id, test_id, total_score, total_correct, total_incorrect,
                        total_unattempted, time_taken_ms, detail, tab_switch_count, fullscreen_exit_count)
  values (auth.uid(), p_test_id, v_total_score, v_correct, v_incorrect,
          v_unattempted, p_time_taken_ms, v_detail, p_tab_switches, p_fullscreen_exits)
  returning id into v_result_id;

  return jsonb_build_object(
    'result_id', v_result_id,
    'total_score', v_total_score,
    'total_correct', v_correct,
    'total_incorrect', v_incorrect,
    'total_unattempted', v_unattempted,
    'time_taken_ms', p_time_taken_ms,
    'detail', v_detail
  );
end;
$$;

grant execute on function submit_attempt(uuid, jsonb, bigint, int, int) to authenticated;
