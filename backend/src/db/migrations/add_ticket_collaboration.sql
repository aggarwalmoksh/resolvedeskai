ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS collaborator_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_complaints_collaborators
  ON public.complaints USING gin (collaborator_ids);

NOTIFY pgrst, 'reload schema';
