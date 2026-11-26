-- Non-leakproof text operators cannot use their GIN indexes behind the runtime RLS barrier.
-- This static, read-only function pins the search path and explicitly scopes every branch to the transaction tenant.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE POLICY documents_search_owner ON documents FOR SELECT TO CURRENT_USER USING (true);
CREATE POLICY chunks_search_owner ON document_chunks FOR SELECT TO CURRENT_USER USING (true);
CREATE POLICY notes_search_owner ON notes FOR SELECT TO CURRENT_USER USING (true);

CREATE FUNCTION search_candidates(raw text)
RETURNS TABLE(kind text,key uuid,score numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $search$
  WITH input AS NOT MATERIALIZED (
    SELECT websearch_to_tsquery('simple',raw) AS terms,lower(raw) AS needle,public.tenant() AS workspace
    WHERE length(raw) BETWEEN 1 AND 160
  )
  SELECT 'source'::text,c.id,(2+ts_rank_cd(c.search_vector,i.terms,32)*8)::numeric(9,4)
  FROM public.document_chunks c CROSS JOIN input i
  WHERE c.workspace_id=i.workspace AND c.search_vector @@ i.terms
  UNION ALL
  SELECT 'document',d.id,(CASE WHEN lower(d.title)=i.needle THEN 12
    WHEN d.title_vector @@ i.terms THEN 5.5
    ELSE 1+greatest(similarity(lower(d.title),i.needle),word_similarity(i.needle,lower(d.title))) END)::numeric(9,4)
  FROM public.documents d CROSS JOIN input i
  WHERE d.workspace_id=i.workspace AND d.status='READY'
    AND (d.title_vector @@ i.terms OR lower(d.title) % i.needle OR lower(d.title) %> i.needle)
  UNION ALL
  SELECT 'note',n.id,(2+ts_rank_cd(n.search_vector,i.terms,32)*7)::numeric(9,4)
  FROM public.notes n CROSS JOIN input i
  WHERE n.workspace_id=i.workspace AND n.search_vector @@ i.terms
$search$;

REVOKE ALL ON FUNCTION search_candidates(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_candidates(text) TO docmivo_runtime;
