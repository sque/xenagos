# Scenario coverage (task 8.2)

Every scenario of the nine specs, with what checks it. Server tests are in `server/tests/`, viewer tests in
`web/src/` (`*.browser.test.*` run in Chromium against a fake review server). "8.1" names a manual check the end-to-end
note from task 8.1 must record; those are the scenarios that need a real Claude Code session, a real browser on the
real server, or a person's judgement. Written 2026-11-18; 91 scenarios: 76 covered by tests alone, 14 that also need a check in 8.1, and 1 waiting for task 3.3.

## review-session

| Scenario | Covered by |
|---|---|
| Just look | `test_cli.py::test_default_target_starts_server_for_current_branch`; `test_agent.py::test_review_without_session_says_so`; `App.test.tsx`: opens in browse mode without a walkthrough |
| After implementing | `test_agent_commands.py::test_agent_opens_a_review_and_writes_its_walkthrough` |
| Two reviews at once | `test_registry.py::test_two_reviews_run_side_by_side_and_stop_independently` |
| Agent opens what the person already has open | `test_registry.py::test_reopening_a_target_presents_the_running_review`; `test_agent_commands.py::test_review_keeps_the_session_it_has` |
| List | `test_registry.py::test_two_reviews_run_side_by_side_and_stop_independently`; `test_agent_commands.py::test_review_keeps_the_session_it_has` (session name) |
| Reopen tomorrow | `test_agent.py::test_questions_and_progress_survive_the_server`, `::test_session_survives_the_server`; `test_agent_commands.py::test_ended_review_is_started_again_with_its_state`; `Outline.browser.test.tsx`: a review opened again starts where it was left |
| Forgotten review | `test_agent_commands.py::test_review_ends_once_its_viewer_has_been_closed_for_the_idle_period`, `::test_review_never_opened_ends_after_the_longer_period` |
| Session ends | `test_agent.py::test_session_that_no_longer_exists_has_ended`; `App.test.tsx`: offers a new session when the session has ended |
| Request without the secret | `test_access.py::test_request_without_secret_is_refused` |
| Another review's secret | `test_access.py::test_another_reviews_secret_is_refused`, `::test_another_reviews_cookie_name_is_ignored` |
| Request from another site's page | `test_access.py::test_foreign_origin_is_refused_even_with_the_secret`, `::test_foreign_host_is_refused_even_with_the_secret` |

## review-target

| Scenario | Covered by |
|---|---|
| Branch against base | `test_target.py::test_current_branch_against_named_base`, `::test_default_is_current_branch_against_default_from_fork_point`; `App.test.tsx`: shows the target and both pinned commit ids |
| Unknown revision | `test_target.py::test_unknown_revision_is_named`; `test_cli.py::test_unknown_target_exits_with_its_name` |
| Branch moves during review | `test_target_status.py::test_branch_moved_past_the_pinned_head_is_reported_and_the_review_stays_pinned`; `App.test.tsx`: reports a moved branch |
| Reviewing a head that is not checked out | `test_target_status.py::test_browsing_a_head_that_is_not_checked_out_leaves_the_checkout_alone` (xenagos's own reads). The private checkout for the agent is task 3.3, open |
| Dirty working tree | `test_target_status.py::test_uncommitted_changes_to_reviewed_files_are_named_without_touching_the_index`; `App.test.tsx`: reports uncommitted changes |
| On the default branch | `test_target.py::test_no_default_target_on_default_branch`; `test_cli.py::test_no_default_target_opens_nothing_and_asks_for_one` |

## configuration

| Scenario | Covered by |
|---|---|
| Custom configuration home | `test_config.py::test_custom_configuration_home` |
| No configuration | `test_config.py::test_no_configuration_means_built_in_defaults` |
| Partial override | `test_config.py::test_repository_overrides_only_what_it_sets` |
| Link only | `test_config.py::test_agent_open_decides_whether_a_window_opens` |
| Misspelled setting | `test_config.py::test_misspelled_setting_names_file_and_setting`, `::test_xen_refuses_to_start_with_invalid_configuration` |
| Name template | `test_config.py::test_started_session_carries_the_configured_name_and_mode` |

## diff-browser

| Scenario | Covered by |
|---|---|
| Lock file | `test_categories.py::test_rules_by_name`, `::test_categories_follow_attributes_at_the_head`; `test_browse.py::test_combined_changes_with_counts_and_categories` |
| Category correction | `test_browse.py::test_category_correction_lasts_for_the_review`; `Browse.browser.test.tsx`: a file moved to another category stays there |
| Two files in one folder | `Browse.browser.test.tsx`: files grouped by category (one `scheduler` folder holding three files) |
| Folder split across categories | `Browse.browser.test.tsx`: files grouped by category (`scheduler` under Code and Generated) |
| Large lock file | `Browse.browser.test.tsx`: generated diffs not rendered until opened (4,000 lines, not fetched until opened) |
| Layout switch | `Browse.browser.test.tsx`: unified and side by side |
| Expand whole file | `Browse.browser.test.tsx`: a file with two distant hunks expands in steps and in full |
| Pick one commit | `test_browse.py::test_one_commit_shows_only_what_it_changed`; `Browse.browser.test.tsx`: one commit of three, under its message |

## walkthrough-plan

| Scenario | Covered by |
|---|---|
| Intent inferred | `test_plan.py::test_orientation_names_its_document_only_when_taken_from_one` (format); 8.1: the orientation of a real plan marks its source |
| Idea spanning files | `test_anchors.py::test_sample_plan_passes` (format allows it); 8.1: sections of a real plan are ideas, not files |
| Refresher on untouched code | `test_anchors.py::test_unchanged_code_can_be_targeted`; `stage.browser.test.ts`: a step on code the change did not touch |
| Line range past end of file | `test_anchors.py::test_target_past_end_of_file_is_named`; `test_app.py::test_rejected_plan_names_problems_and_keeps_the_previous_plan` |
| Uncovered code change | `test_coverage.py::test_one_unclaimed_hunk_is_listed_with_category_and_line_counts`; `NotCovered.browser.test.tsx`; `Explorer.browser.test.tsx` (changed but not in this walkthrough) |
| No verdict | `guide.py` rules; 8.1: no section or step of a real plan contains a verdict |
| First walkthrough | `test_agent.py::test_question_without_session_starts_one_with_it`; `App.test.tsx`: asks the agent for a walkthrough; 8.1 and task 7.9: live, once the fixture folder is trusted |

## walkthrough-narration

| Scenario | Covered by |
|---|---|
| Step in another file | `player.test.ts` (order of a step); `stage.browser.test.ts`: a step in a file not yet open |
| Caption appears | `stage.browser.test.ts`: the caption sits beside a target without covering it; `codeView.browser.test.ts` (overlay measured) |
| Caption in the way | `stage.browser.test.ts`: hiding the caption keeps the spotlight |
| Next step further down the same file | `player.test.ts`; `motion.test.ts`: scroll duration grows with distance |
| Reduced motion | `motion.test.ts`: under reduced motion every scroll is immediate |
| Circle on one call | `codeView.browser.test.ts`: circle follows its text |
| Markup in narration | `test_config.py::test_markup_is_refused_under_any_style` |
| Style named in the viewer | `Layout.browser.test.tsx`: the outline names the style |
| Edit the style | `test_config.py::test_guide_includes_the_active_style_and_follows_a_change` |
| Repository overrides user | `test_config.py::test_styles_are_found_in_repository_then_user_then_built_in` |
| Step that builds on the last one | 8.1: narration of a real plan under the default style |
| Line number under the default style | `test_config.py::test_line_number_is_refused_under_the_default_style` |
| Try another style on the same walkthrough | `test_config.py::test_renarration_is_checked_against_and_recorded_with_the_active_style`; `test_agent.py::test_narration_submit_changes_narration_only` |
| End of section | `player.test.ts` (stops at the end); `Outline.browser.test.tsx` (section done) |
| Wander off and return | `Outline.browser.test.tsx`: scrolling or clicking in the code pauses; `Explorer.browser.test.tsx`: choosing a file pauses |
| Switch provider | `test_voice.py` (cache key includes the provider); `voice.browser.test.ts`; 8.1: by ear |
| User command as provider | `test_voice.py::test_command_gets_the_narration_and_its_audio_is_cached`, `::test_macos_say_example_writes_wav` |
| Provider fails | `test_voice.py::test_failures_are_explained_and_not_cached`; `voiceNotice.browser.test.tsx`: a failing voice is reported once |
| Voice off | `voice.browser.test.ts` (reading pace); `NarrationMenu.browser.test.tsx` (switch); `voiceNotice.browser.test.tsx` |
| File with a deletion | `codeView.browser.test.ts`: shows the change in place, a deleted line without a number |
| Long explanation | `Outline.browser.test.tsx`: header row |
| Jump to a later step | `Outline.browser.test.tsx`: outline |
| Reviewer looks for the style | `NarrationMenu.browser.test.tsx` |

## repository-explorer

| Scenario | Covered by |
|---|---|
| Deleted file | `test_tree.py::test_tree_without_a_plan_lists_head_files_and_deleted_ones`; `Explorer.browser.test.tsx`: marks |
| Collapsed folder with a change | `Explorer.browser.test.tsx`: marks (dot kept when collapsed) |
| Step in a file inside a collapsed folder | `Explorer.browser.test.tsx`: follows the narrator into a collapsed folder |
| Refresher file | `test_tree.py::test_tree_marks_coverage_and_visited_files_from_the_plan`; `Explorer.browser.test.tsx` |
| Changed file the walkthrough skips | `test_tree.py::test_tree_marks_coverage_and_visited_files_from_the_plan`; `Explorer.browser.test.tsx` |
| Default view of a large repository | `tree.test.ts`: narrow view (400 files, 6 shown, 394 hidden) |
| Look elsewhere during playback | `Explorer.browser.test.tsx`: choosing a file pauses playback, resume returns to the step |

## section-visuals

| Scenario | Covered by |
|---|---|
| Interactive model | `VisualFrame.browser.test.tsx` (scripts run in the frame: Mermaid); 8.1: a widget with inputs in a real plan |
| Section without a visual | `VisualPane.browser.test.tsx` |
| Collapse to read code | `VisualPane.browser.test.tsx` |
| Click a node | `VisualFrame.browser.test.tsx` (link messages of declared elements); `VisualPane.browser.test.tsx` (code shown out of turn opens and is spotlighted) |
| Undeclared element | `VisualFrame.browser.test.tsx`; `test_agent.py::test_visual_element_must_be_declared` |
| Visual attempts a network call | `VisualFrame.browser.test.tsx`: a visual cannot reach the network |
| Malformed diagram | `VisualFrame.browser.test.tsx`: a visual that fails shows a notice, invalid Mermaid shows the notice |

## agent-link

| Scenario | Covered by |
|---|---|
| Permission request | `test_agent.py::test_pane_attaches_and_passes_keys_and_size`; 8.1: a real prompt answered in the pane (seen live for task 7.1) |
| Project instructions apply | `test_agent.py` (sessions start in the repository); 8.1: a real session's answer follows the repository's instructions |
| Default mode | `test_agent.py::test_started_session_uses_claude_codes_default_mode` |
| Review of an agent's own work | `test_agent_commands.py::test_agent_opens_a_review_and_writes_its_walkthrough`; 8.1: the pane shows the earlier conversation |
| Review opened by a hand-started session | `test_agent.py::test_hand_started_session_still_open_is_not_continued`; `App.test.tsx`: says why the session cannot be shown |
| Continue a hand-started session | `test_agent.py::test_closed_hand_started_session_is_continued_with_its_id_and_name`; `App.test.tsx` |
| Still open elsewhere | `test_agent.py::test_copy_of_a_session_open_elsewhere_is_removed`; `App.test.tsx`: continues a session that cannot be shown |
| Ask on a selection | `test_agent.py::test_question_is_pasted_and_submitted`, `::test_selection_across_sides`; `AskPrompt.test.tsx`; `codeView.browser.test.ts`: a selection names its file, sides and lines |
| Visual tries to speak to the agent | `VisualFrame.browser.test.tsx`: only link and select of declared elements, without any text |
| Question containing an escape sequence | `test_agent.py::test_question_is_pasted_and_submitted`, `::test_visible_text_keeps_lines_and_drops_controls` |
| Ask during work | 8.1: a question sent while the session works is queued and answered (spike 2.1) |
| Answer that points | `test_agent.py::test_viewer_hears_of_plan_changes_and_pointing`; `VisualPane.browser.test.tsx` (the viewer opens and spotlights); 8.1: a real answer uses `xen show` |
| Fix asked during playback | `test_skill.py::test_skill_names_every_agent_command_and_the_rules_for_fixes`; 8.1: a real fix stays uncommitted and the plan survives |
| Fix asked in the private checkout | Waits for task 3.3 and the author's decision on sessions in private checkouts |
| Interrupt and resume | `player.test.ts`: pause keeps the step and resume plays it again; 8.1: asking from a selection pauses and resume continues (seen live for task 7.8) |
| Same session open twice | `test_agent.py::test_another_terminal_showing_the_session_is_noticed`; `App.test.tsx`: display is shared |
