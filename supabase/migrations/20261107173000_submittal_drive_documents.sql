ALTER TABLE public.projects
  ADD COLUMN drive_folder_url text
    CHECK (drive_folder_url IS NULL OR drive_folder_url ~ '^https://drive\.google\.com/drive/folders/[A-Za-z0-9_-]+/?$');

ALTER TABLE public.submittal_activities
  DROP CONSTRAINT submittal_activities_event_type_check,
  ADD CONSTRAINT submittal_activities_event_type_check
    CHECK (event_type IN (
      'status_change', 'followup_logged', 'note', 'revision_created',
      'doc_attached', 'doc_detached', 'details_updated', 'draft_created',
      'sent_confirmed', 'draft_discarded', 'reopened', 'voided'
    ));

CREATE TABLE public.submittal_documents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  revision_id uuid NOT NULL REFERENCES public.submittal_revisions(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL CHECK (nullif(btrim(drive_file_id), '') IS NOT NULL),
  drive_url text NOT NULL CHECK (drive_url ~ '^https://(drive|docs)\.google\.com/'),
  file_name text NOT NULL CHECK (nullif(btrim(file_name), '') IS NOT NULL),
  mime_type text,
  label text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, drive_file_id)
);

CREATE INDEX idx_submittal_documents_revision_id
  ON public.submittal_documents(revision_id);

ALTER TABLE public.submittal_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.submittal_documents FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.submittal_documents TO authenticated;

CREATE POLICY submittal_documents_member_read ON public.submittal_documents
  FOR SELECT TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'])
    AND EXISTS (
      SELECT 1
      FROM public.submittal_revisions AS revision
      JOIN public.submittals AS parent ON parent.id = revision.submittal_id
      WHERE revision.id = revision_id
    )
  );
CREATE POLICY submittal_documents_manager_insert ON public.submittal_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1
      FROM public.submittal_revisions AS revision
      JOIN public.submittals AS parent ON parent.id = revision.submittal_id
      WHERE revision.id = revision_id
        AND revision.status <> 'Void'
    )
  );
CREATE POLICY submittal_documents_manager_delete ON public.submittal_documents
  FOR DELETE TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1
      FROM public.submittal_revisions AS revision
      JOIN public.submittals AS parent ON parent.id = revision.submittal_id
      WHERE revision.id = revision_id
    )
  );

CREATE OR REPLACE FUNCTION public.attach_submittal_document(
  p_revision_id uuid,
  p_drive_file_id text,
  p_drive_url text,
  p_file_name text,
  p_mime_type text,
  p_label text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_submittal_id uuid;
  revision_number integer;
  document_id uuid;
BEGIN
  IF NOT public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']) THEN
    RAISE EXCEPTION 'Only administrators and RFQ managers can attach submittal documents';
  END IF;

  SELECT revision.submittal_id, revision.revision_number
  INTO parent_submittal_id, revision_number
  FROM public.submittal_revisions AS revision
  WHERE revision.id = p_revision_id AND revision.status <> 'Void';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submittal revision was not found or is void';
  END IF;

  INSERT INTO public.submittal_documents (
    revision_id, drive_file_id, drive_url, file_name, mime_type, label, created_by
  )
  VALUES (
    p_revision_id, btrim(p_drive_file_id), p_drive_url, btrim(p_file_name),
    NULLIF(btrim(p_mime_type), ''), NULLIF(btrim(p_label), ''), (SELECT auth.uid())
  )
  RETURNING id INTO document_id;

  INSERT INTO public.submittal_activities (
    submittal_id, revision_id, event_type, description, created_by
  )
  VALUES (
    parent_submittal_id, p_revision_id, 'doc_attached',
    format('Document "%s" attached to Rev %s', btrim(p_file_name), revision_number),
    (SELECT auth.uid())
  );

  RETURN document_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.detach_submittal_document(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  document_row public.submittal_documents%ROWTYPE;
  revision_number integer;
BEGIN
  IF NOT public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']) THEN
    RAISE EXCEPTION 'Only administrators and RFQ managers can detach submittal documents';
  END IF;

  SELECT document.* INTO document_row
  FROM public.submittal_documents AS document
  WHERE document.id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submittal document not found';
  END IF;

  SELECT revision.revision_number INTO revision_number
  FROM public.submittal_revisions AS revision
  WHERE revision.id = document_row.revision_id;

  DELETE FROM public.submittal_documents WHERE id = p_document_id;

  INSERT INTO public.submittal_activities (
    submittal_id, revision_id, event_type, description, created_by
  )
  SELECT revision.submittal_id, revision.id, 'doc_detached',
         format('Document "%s" detached from Rev %s', document_row.file_name, revision_number),
         (SELECT auth.uid())
  FROM public.submittal_revisions AS revision
  WHERE revision.id = document_row.revision_id;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_submittal_document(uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detach_submittal_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_submittal_document(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detach_submittal_document(uuid) TO authenticated;
