import "server-only";
import { z } from "zod";
import { transaction } from "@/server/db/pool";
import { invalid } from "@/server/db/http";
import { reserve } from "@/server/quotas/usage";

export const filtersSchema = z.object({
  folder: z.uuid().optional(),
  tag: z.uuid().optional(),
  type: z.string().max(120).optional(),
  favorite: z.boolean().optional(),
  after: z.iso.date().optional()
}).strict();
export type Filters = z.infer<typeof filtersSchema>;

const cursorSchema = z.tuple([z.number().min(0).max(100),z.uuid()]);
function startAt(cursor?: string) {
  if (!cursor) return [null,null];
  try { return cursorSchema.parse(JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"))); }
  catch { throw invalid("Search cursor has expired. Repeat the search."); }
}

export function segments(text: string, input: string, radius = 98) {
  const words = input.match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length <= 80).slice(0,18) ?? [];
  if (!words.length) return [{ text:text.slice(0,radius*2), match:false }];
  const match = new RegExp(words.sort((a,b) => b.length-a.length).join("|"),"giu");
  const index = match.exec(text)?.index ?? 0;
  const start = Math.max(0,index-radius);
  const finish = Math.min(text.length,index+radius+60);
  const excerpt = text.slice(start,finish);
  const parts: {text:string;match:boolean}[] = [];
  let offset = 0;
  if (start) parts.push({ text:"…", match:false });
  for (const hit of excerpt.matchAll(new RegExp(match.source,"giu"))) {
    if (hit.index > offset) parts.push({ text:excerpt.slice(offset,hit.index), match:false });
    parts.push({ text:hit[0], match:true });
    offset = hit.index+hit[0].length;
  }
  if (offset < excerpt.length) parts.push({ text:excerpt.slice(offset), match:false });
  if (finish < text.length) parts.push({ text:"…", match:false });
  return parts;
}

export const searchQuery = `
WITH input AS NOT MATERIALIZED (
 SELECT websearch_to_tsquery('simple',$2) AS query
), candidates AS MATERIALIZED (
 SELECT * FROM search_candidates($2)
), matches AS (
 SELECT c.id AS key, d.id AS "documentId",c.id AS "chunkId",d.title,c.text,c.page,c.section,'source'::text AS kind,
        h.score
 FROM candidates h JOIN document_chunks c ON c.workspace_id=$1 AND c.id=h.key AND h.kind='source'
 JOIN documents d ON d.workspace_id=c.workspace_id AND d.id=c.document_id
 WHERE d.workspace_id=$1 AND d.status='READY'
   AND ($3::uuid IS NULL OR d.folder_id=$3) AND ($4::uuid IS NULL OR EXISTS
     (SELECT 1 FROM document_tags dt WHERE dt.workspace_id=d.workspace_id AND dt.document_id=d.id AND dt.tag_id=$4))
   AND ($5::text IS NULL OR d.mime=$5) AND (NOT $6::boolean OR d.favorite)
   AND ($7::date IS NULL OR d.created_at >= $7::date)
 UNION ALL
 SELECT d.id,d.id,NULL,d.title,d.title,NULL,NULL,'document',
   coalesce(h.score,1.1)
 FROM documents d CROSS JOIN input i LEFT JOIN candidates h ON h.kind='document' AND h.key=d.id
 WHERE d.workspace_id=$1 AND d.status='READY'
   AND (h.key IS NOT NULL
     OR EXISTS (SELECT 1 FROM folders f WHERE f.workspace_id=d.workspace_id AND f.id=d.folder_id
          AND to_tsvector('simple',f.name) @@ i.query)
     OR EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON t.workspace_id=dt.workspace_id AND t.id=dt.tag_id
          WHERE dt.workspace_id=d.workspace_id AND dt.document_id=d.id AND to_tsvector('simple',t.name) @@ i.query))
   AND ($3::uuid IS NULL OR d.folder_id=$3) AND ($4::uuid IS NULL OR EXISTS
     (SELECT 1 FROM document_tags dt WHERE dt.workspace_id=d.workspace_id AND dt.document_id=d.id AND dt.tag_id=$4))
   AND ($5::text IS NULL OR d.mime=$5) AND (NOT $6::boolean OR d.favorite)
   AND ($7::date IS NULL OR d.created_at >= $7::date)
 UNION ALL
 SELECT n.id,NULL,NULL,n.title,n.text,NULL,NULL,'note',
   h.score
 FROM candidates h JOIN notes n ON h.kind='note' AND n.workspace_id=$1 AND n.id=h.key
 WHERE n.workspace_id=$1
   AND $3::uuid IS NULL AND $4::uuid IS NULL AND $5::text IS NULL AND NOT $6::boolean
   AND ($7::date IS NULL OR n.created_at >= $7::date)
)
SELECT * FROM matches
WHERE $8::numeric IS NULL OR (score,key)<($8::numeric,$9::uuid)
ORDER BY score DESC,key DESC LIMIT 21`;

export async function search(workspace: string, raw: string, filters: Filters, cursor?: string) {
  const input = raw.normalize("NFC").trim().replace(/\s+/g," ");
  if (!/[\p{L}\p{N}]/u.test(input)) return { results:[],nextCursor:null };
  const [score,id] = startAt(cursor);
  return transaction(async db => {
    await reserve(db,workspace,"search",180,"minute");
    const result = await db.query(searchQuery,[workspace,input,filters.folder,filters.tag,filters.type,!!filters.favorite,filters.after,score,id]);
    const rows = result.rows.slice(0,20);
    const { score:lastScore,key } = rows.at(-1) ?? {};
    return {
      results: rows.map(({ text,score,...row }) => ({ ...row, score:Number(score), snippetSegments:segments(text,input) })),
      nextCursor: result.rows[20] ? Buffer.from(JSON.stringify([Number(lastScore),key])).toString("base64url") : null
    };
  },workspace);
}
