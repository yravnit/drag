import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  repositories: {
    chunks: r.many.chunks(),
    files: r.many.repositoryFiles(),
  },
  chunks: {
    repository: r.one.repositories({
      from: r.chunks.repositoryId,
      to: r.repositories.id,
    }),
  },
  repositoryFiles: {
    repository: r.one.repositories({
      from: r.repositoryFiles.repositoryId,
      to: r.repositories.id,
    }),
  },
}));
