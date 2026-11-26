import { pgTable, text, uuid } from "drizzle-orm/pg-core";

const collectionColumns = () => ({
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text().notNull()
});
export const folders = pgTable("folders",collectionColumns());
export const tags = pgTable("tags",collectionColumns());
