CREATE TABLE public.submittals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (nullif(btrim(name), '') IS NOT NULL),
  item_number integer NOT NULL,
  spec_section varchar(100),
  description text,
  type text NOT NULL CHECK (type IN (
    'Shop Drawing', 'Product Data', 'Sample', 'Mockup', 'Test Report',
    'Certificate', 'O&M Manual', 'Other'
  )),
  responsible_party text,
  ball_in_court text NOT NULL DEFAULT 'Us' CHECK (ball_in_court IN (
    'Us', 'GC', 'Architect', 'Engineer', 'Owner', 'Supplier', 'Other'
  )),
  required_by_date date,
  notes text,
  followup_interval_business_days integer NOT NULL DEFAULT 5
    CHECK (followup_interval_business_days BETWEEN 1 AND 60),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, item_number)
);

CREATE UNIQUE INDEX idx_submittals_project_name
  ON public.submittals(project_id, lower(btrim(name)));
CREATE INDEX idx_submittals_project_id ON public.submittals(project_id);

CREATE TABLE public.submittal_revisions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  submittal_id uuid NOT NULL REFERENCES public.submittals(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number >= 0),
  status text NOT NULL DEFAULT 'Not Started' CHECK (status IN (
    'Not Started', 'Preparing', 'Sent', 'Approved', 'Approved as Noted',
    'Revise & Resubmit', 'Rejected', 'Void'
  )),
  transmittal_number varchar(255),
  sent_to text,
  date_sent date,
  response_date date,
  reviewer_comments text,
  next_followup_date date,
  followup_count integer NOT NULL DEFAULT 0 CHECK (followup_count >= 0),
  sent_via text CHECK (sent_via IS NULL OR sent_via IN ('Gmail Draft', 'Manual')),
  draft_pending boolean NOT NULL DEFAULT false,
  draft_created_at timestamptz,
  gmail_draft_id text,
  draft_subject text,
  draft_type text CHECK (draft_type IS NULL OR draft_type IN ('Initial', 'Resubmittal', 'Follow-up')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submittal_id, revision_number),
  CHECK (response_date IS NULL OR date_sent IS NULL OR response_date >= date_sent)
);

CREATE INDEX idx_submittal_revisions_submittal_id ON public.submittal_revisions(submittal_id);
CREATE INDEX idx_submittal_revisions_status ON public.submittal_revisions(status);
CREATE INDEX idx_submittal_revisions_next_followup
  ON public.submittal_revisions(next_followup_date)
  WHERE next_followup_date IS NOT NULL;

CREATE TABLE public.submittal_activities (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  submittal_id uuid NOT NULL REFERENCES public.submittals(id) ON DELETE CASCADE,
  revision_id uuid REFERENCES public.submittal_revisions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'status_change', 'followup_logged', 'note', 'revision_created',
    'doc_attached', 'details_updated', 'draft_created', 'sent_confirmed',
    'draft_discarded', 'reopened', 'voided'
  )),
  description text NOT NULL CHECK (nullif(btrim(description), '') IS NOT NULL),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_submittal_activities_submittal_time
  ON public.submittal_activities(submittal_id, timestamp DESC);
CREATE INDEX idx_submittal_activities_revision_id ON public.submittal_activities(revision_id);

CREATE OR REPLACE FUNCTION public.assign_submittal_item_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.projects AS project
  WHERE project.id = NEW.project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  SELECT COALESCE(MAX(submittal.item_number), 0) + 1
  INTO NEW.item_number
  FROM public.submittals AS submittal
  WHERE submittal.project_id = NEW.project_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER assign_submittal_item_number
  BEFORE INSERT ON public.submittals
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_submittal_item_number();

CREATE TRIGGER update_submittals_modtime
  BEFORE UPDATE ON public.submittals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER update_submittal_revisions_modtime
  BEFORE UPDATE ON public.submittal_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_timestamp();

ALTER TABLE public.submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submittal_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submittal_activities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.submittals, public.submittal_revisions, public.submittal_activities
  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.submittals, public.submittal_revisions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.submittal_activities TO authenticated;

CREATE POLICY submittals_member_read ON public.submittals
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY submittals_manager_insert ON public.submittals
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY submittals_manager_update ON public.submittals
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));

CREATE POLICY submittal_revisions_member_read ON public.submittal_revisions
  FOR SELECT TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'])
    AND EXISTS (
      SELECT 1 FROM public.submittals AS parent
      WHERE parent.id = submittal_id
    )
  );
CREATE POLICY submittal_revisions_manager_insert ON public.submittal_revisions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1 FROM public.submittals AS parent
      WHERE parent.id = submittal_id
    )
  );
CREATE POLICY submittal_revisions_manager_update ON public.submittal_revisions
  FOR UPDATE TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1 FROM public.submittals AS parent
      WHERE parent.id = submittal_id
    )
  )
  WITH CHECK (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1 FROM public.submittals AS parent
      WHERE parent.id = submittal_id
    )
  );

CREATE POLICY submittal_activities_member_read ON public.submittal_activities
  FOR SELECT TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'])
    AND EXISTS (
      SELECT 1 FROM public.submittals AS parent
      WHERE parent.id = submittal_id
    )
  );
CREATE POLICY submittal_activities_manager_insert ON public.submittal_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1 FROM public.submittals AS parent
      WHERE parent.id = submittal_id
    )
  );

CREATE OR REPLACE FUNCTION public.create_submittal(
  p_project_id uuid,
  p_name text,
  p_type text,
  p_spec_section text,
  p_description text,
  p_responsible_party text,
  p_ball_in_court text,
  p_required_by_date date,
  p_notes text,
  p_followup_interval_business_days integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  new_submittal_id uuid;
  actor_id uuid := (SELECT auth.uid());
BEGIN
  INSERT INTO public.submittals (
    project_id, name, type, spec_section, description, responsible_party,
    ball_in_court, required_by_date, notes, followup_interval_business_days, created_by
  )
  VALUES (
    p_project_id, btrim(p_name), p_type, NULLIF(btrim(p_spec_section), ''),
    NULLIF(btrim(p_description), ''), NULLIF(btrim(p_responsible_party), ''),
    COALESCE(p_ball_in_court, 'Us'), p_required_by_date, NULLIF(btrim(p_notes), ''),
    COALESCE(p_followup_interval_business_days, 5), actor_id
  )
  RETURNING id INTO new_submittal_id;

  INSERT INTO public.submittal_revisions (
    submittal_id, revision_number, status, created_by
  )
  VALUES (new_submittal_id, 0, 'Not Started', actor_id);

  INSERT INTO public.submittal_activities (
    submittal_id, revision_id, event_type, description, created_by
  )
  SELECT new_submittal_id, revision.id, 'revision_created', 'Submittal created with Rev 0', actor_id
  FROM public.submittal_revisions AS revision
  WHERE revision.submittal_id = new_submittal_id AND revision.revision_number = 0;

  RETURN new_submittal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_submittal_revision(
  p_submittal_id uuid,
  p_reopen boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  next_revision_number integer;
  prior_sent_to text;
  new_revision_id uuid;
  actor_id uuid := (SELECT auth.uid());
BEGIN
  PERFORM 1 FROM public.submittals
  WHERE id = p_submittal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submittal not found';
  END IF;

  SELECT COALESCE(MAX(revision_number), -1) + 1
  INTO next_revision_number
  FROM public.submittal_revisions
  WHERE submittal_id = p_submittal_id;

  SELECT revision.sent_to
  INTO prior_sent_to
  FROM public.submittal_revisions AS revision
  WHERE revision.submittal_id = p_submittal_id
  ORDER BY revision.revision_number DESC
  LIMIT 1;

  INSERT INTO public.submittal_revisions (
    submittal_id, revision_number, status, sent_to, created_by
  )
  VALUES (p_submittal_id, next_revision_number, 'Preparing', prior_sent_to, actor_id)
  RETURNING id INTO new_revision_id;

  INSERT INTO public.submittal_activities (
    submittal_id, revision_id, event_type, description, created_by
  )
  VALUES (
    p_submittal_id, new_revision_id,
    CASE WHEN p_reopen THEN 'reopened' ELSE 'revision_created' END,
    CASE WHEN p_reopen
      THEN format('Submittal reopened as Rev %s', next_revision_number)
      ELSE format('Rev %s created', next_revision_number)
    END,
    actor_id
  );

  RETURN new_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_submittal_revision_sent(
  p_revision_id uuid,
  p_date_sent date,
  p_next_followup_date date,
  p_sent_to text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  revision_row public.submittal_revisions%ROWTYPE;
BEGIN
  SELECT * INTO revision_row
  FROM public.submittal_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submittal revision not found';
  END IF;
  IF revision_row.status NOT IN ('Not Started', 'Preparing') THEN
    RAISE EXCEPTION 'Only a not-started or preparing revision can be marked sent';
  END IF;
  IF p_date_sent IS NULL OR p_next_followup_date IS NULL OR p_next_followup_date <= p_date_sent THEN
    RAISE EXCEPTION 'A valid sent date and later follow-up date are required';
  END IF;

  UPDATE public.submittal_revisions
  SET status = 'Sent', date_sent = p_date_sent, sent_via = 'Manual',
      next_followup_date = p_next_followup_date,
      sent_to = NULLIF(btrim(p_sent_to), '')
  WHERE id = p_revision_id;

  INSERT INTO public.submittal_activities (
    submittal_id, revision_id, event_type, description, created_by
  )
  VALUES (
    revision_row.submittal_id, p_revision_id, 'status_change',
    format('Rev %s marked sent manually on %s', revision_row.revision_number, p_date_sent),
    (SELECT auth.uid())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.log_submittal_revision_response(
  p_revision_id uuid,
  p_status text,
  p_response_date date,
  p_reviewer_comments text,
  p_create_next_revision boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  revision_row public.submittal_revisions%ROWTYPE;
  next_revision_id uuid;
  next_revision_number integer;
BEGIN
  IF p_status NOT IN ('Approved', 'Approved as Noted', 'Revise & Resubmit', 'Rejected') THEN
    RAISE EXCEPTION 'Invalid submittal response status';
  END IF;
  IF p_response_date IS NULL THEN
    RAISE EXCEPTION 'A response date is required';
  END IF;

  SELECT * INTO revision_row
  FROM public.submittal_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submittal revision not found';
  END IF;
  IF revision_row.status <> 'Sent' THEN
    RAISE EXCEPTION 'Only a sent revision can receive a response';
  END IF;
  IF revision_row.date_sent IS NOT NULL AND p_response_date < revision_row.date_sent THEN
    RAISE EXCEPTION 'Response date cannot be before the sent date';
  END IF;
  IF p_create_next_revision AND p_status NOT IN ('Revise & Resubmit', 'Rejected') THEN
    RAISE EXCEPTION 'A new revision can only follow a revise/resubmit or rejected response';
  END IF;

  UPDATE public.submittal_revisions
  SET status = p_status, response_date = p_response_date,
      reviewer_comments = NULLIF(btrim(p_reviewer_comments), ''),
      next_followup_date = NULL
  WHERE id = p_revision_id;

  INSERT INTO public.submittal_activities (
    submittal_id, revision_id, event_type, description, created_by
  )
  VALUES (
    revision_row.submittal_id, p_revision_id, 'status_change',
    format('Rev %s response: %s on %s', revision_row.revision_number, p_status, p_response_date),
    (SELECT auth.uid())
  );

  IF p_create_next_revision THEN
    PERFORM 1 FROM public.submittals
    WHERE id = revision_row.submittal_id
    FOR UPDATE;

    SELECT COALESCE(MAX(revision_number), -1) + 1
    INTO next_revision_number
    FROM public.submittal_revisions
    WHERE submittal_id = revision_row.submittal_id;

    INSERT INTO public.submittal_revisions (
      submittal_id, revision_number, status, sent_to, created_by
    )
    VALUES (
      revision_row.submittal_id, next_revision_number, 'Preparing',
      revision_row.sent_to, (SELECT auth.uid())
    )
    RETURNING id INTO next_revision_id;

    INSERT INTO public.submittal_activities (
      submittal_id, revision_id, event_type, description, created_by
    )
    VALUES (
      revision_row.submittal_id, next_revision_id, 'revision_created',
      format('Rev %s created after %s response', next_revision_number, p_status),
      (SELECT auth.uid())
    );
  END IF;

  RETURN next_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_submittal_revision(p_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  revision_row public.submittal_revisions%ROWTYPE;
BEGIN
  SELECT * INTO revision_row
  FROM public.submittal_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submittal revision not found';
  END IF;

  UPDATE public.submittal_revisions
  SET status = 'Void', next_followup_date = NULL
  WHERE id = p_revision_id;

  INSERT INTO public.submittal_activities (
    submittal_id, revision_id, event_type, description, created_by
  )
  VALUES (
    revision_row.submittal_id, p_revision_id, 'voided',
    format('Rev %s voided', revision_row.revision_number),
    (SELECT auth.uid())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_submittal_details(
  p_submittal_id uuid,
  p_name text,
  p_type text,
  p_spec_section text,
  p_description text,
  p_responsible_party text,
  p_ball_in_court text,
  p_required_by_date date,
  p_notes text,
  p_followup_interval_business_days integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.submittals
  SET name = btrim(p_name), type = p_type,
      spec_section = NULLIF(btrim(p_spec_section), ''),
      description = NULLIF(btrim(p_description), ''),
      responsible_party = NULLIF(btrim(p_responsible_party), ''),
      ball_in_court = p_ball_in_court,
      required_by_date = p_required_by_date,
      notes = NULLIF(btrim(p_notes), ''),
      followup_interval_business_days = p_followup_interval_business_days
  WHERE id = p_submittal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submittal not found';
  END IF;

  INSERT INTO public.submittal_activities (submittal_id, event_type, description, created_by)
  VALUES (p_submittal_id, 'details_updated', 'Submittal details updated', (SELECT auth.uid()));
END;
$$;

REVOKE ALL ON FUNCTION public.assign_submittal_item_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_submittal(uuid, text, text, text, text, text, text, date, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_submittal_revision(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_submittal_revision_sent(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_submittal_revision_response(uuid, text, date, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_submittal_revision(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_submittal_details(uuid, text, text, text, text, text, text, date, text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_submittal(uuid, text, text, text, text, text, text, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_submittal_revision(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_submittal_revision_sent(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_submittal_revision_response(uuid, text, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_submittal_revision(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_submittal_details(uuid, text, text, text, text, text, text, date, text, integer) TO authenticated;
